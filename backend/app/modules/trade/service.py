"""交易服务层"""

import logging
from decimal import Decimal
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.trade.models import Order, TradeSettings
from app.modules.trade.schemas import CreateOrderRequest
from app.modules.risk.service import check_single_trade_risk, get_or_create_config
from app.modules.risk.service import check_daily_loss_circuit
from app.modules.binance.client import BinanceClient
from app.modules.account.service import decrypt_value
from app.modules.trade.models import ApiKey

logger = logging.getLogger(__name__)


class TradeService:
    """交易服务层 - 核心业务逻辑"""

    def __init__(self, db: AsyncSession, user_id: str):
        self.db = db
        self.user_id = user_id
        self._settings: Optional[TradeSettings] = None
        self._binance_client: Optional[BinanceClient] = None

    # ============ 交易设置 ============

    async def get_trade_settings(self) -> TradeSettings:
        """获取用户交易设置"""
        if self._settings:
            return self._settings

        result = await self.db.execute(
            select(TradeSettings).where(TradeSettings.user_id == self.user_id)
        )
        self._settings = result.scalar_one_or_none()
        if not self._settings:
            self._settings = TradeSettings(user_id=self.user_id)
            self.db.add(self._settings)
            await self.db.commit()
            await self.db.refresh(self._settings)
        return self._settings

    async def update_trade_settings(
        self,
        trade_mode: Optional[str] = None,
        default_market: Optional[str] = None,
        default_leverage: Optional[int] = None,
    ) -> TradeSettings:
        """更新交易设置"""
        settings = await self.get_trade_settings()

        if trade_mode is not None:
            if trade_mode not in ("SIMULATED", "LIVE"):
                raise ValueError("Invalid trade mode")
            settings.trade_mode = trade_mode

        if default_market is not None:
            if default_market not in ("SPOT", "FUTURES"):
                raise ValueError("Invalid market type")
            settings.default_market = default_market

        if default_leverage is not None:
            settings.default_leverage = default_leverage

        await self.db.commit()
        await self.db.refresh(settings)
        return settings

    # ============ Binance 客户端 ============

    async def get_binance_client(self, testnet: bool = True) -> BinanceClient:
        """获取 Binance 客户端"""
        result = await self.db.execute(
            select(ApiKey).where(
                ApiKey.user_id == self.user_id,
                ApiKey.is_active == True,  # noqa: E712
            )
        )
        api_key_record = result.scalar_one_or_none()

        if not api_key_record:
            raise ValueError("未绑定 API Key")

        api_key = decrypt_value(api_key_record.api_key_enc)
        api_secret = decrypt_value(api_key_record.api_secret_enc)

        return BinanceClient(api_key, api_secret, testnet=testnet)

    # ============ 风控检查 ============

    async def check_risk(
        self,
        symbol: str,
        side: str,
        quantity: float,
        stop_loss: float,
        entry_price: float,
        account_balance: float,
    ) -> dict:
        """执行风控检查"""
        config = await get_or_create_config(self.db, self.user_id)

        # 单笔风控检查
        risk_result = check_single_trade_risk(
            entry_price=entry_price,
            stop_loss=stop_loss,
            quantity=quantity,
            account_balance=account_balance,
            max_loss_pct=float(config.max_loss_per_trade),
        )

        if not risk_result["allowed"]:
            return risk_result

        # 日亏损熔断检查
        circuit_result = await check_daily_loss_circuit(
            self.db,
            self.user_id,
            account_balance,
            float(config.max_daily_loss),
        )

        if not circuit_result["allowed"]:
            return circuit_result

        return {"allowed": True, "reason": None}

    # ============ 创建订单 ============

    async def create_order(
        self,
        req: CreateOrderRequest,
        account_balance: float,
    ) -> Order:
        """创建订单 - 根据模式选择模拟或真实交易"""
        settings = await self.get_trade_settings()

        # 风控检查
        entry_price = req.price or 0
        risk_result = await self.check_risk(
            symbol=req.symbol,
            side=req.side,
            quantity=req.quantity,
            stop_loss=req.stop_loss,
            entry_price=entry_price,
            account_balance=account_balance,
        )

        if not risk_result["allowed"]:
            from fastapi import HTTPException

            raise HTTPException(status_code=400, detail=risk_result["reason"])

        # 根据模式执行
        if settings.trade_mode == "SIMULATED":
            return await self._create_simulated_order(req, settings)
        else:
            return await self._create_live_order(req, settings)

    async def _create_simulated_order(
        self, req: CreateOrderRequest, settings: TradeSettings
    ) -> Order:
        """模拟交易 - 直接标记为 FILLED"""
        order = Order(
            user_id=self.user_id,
            symbol=req.symbol,
            side=req.side,
            position_side=req.position_side,
            order_type=req.order_type,
            quantity=Decimal(str(req.quantity)),
            price=Decimal(str(req.price)) if req.price else None,
            stop_loss=Decimal(str(req.stop_loss)),
            take_profit=Decimal(str(req.take_profit)) if req.take_profit else None,
            trade_reason=req.trade_reason,
            status="FILLED",
            trade_mode="SIMULATED",
            market_type=settings.default_market,
            leverage=settings.default_leverage,
            filled_price=Decimal(str(req.price or 0)),
        )
        self.db.add(order)
        await self.db.commit()
        await self.db.refresh(order)
        return order

    async def _create_live_order(
        self, req: CreateOrderRequest, settings: TradeSettings
    ) -> Order:
        """真实交易 - 调用 Binance API"""
        client = await self.get_binance_client(testnet=False)
        try:
            if settings.default_market == "FUTURES":
                response = await client.create_futures_order(
                    symbol=req.symbol,
                    side=req.side,
                    position_side=req.position_side,
                    order_type=req.order_type,
                    quantity=req.quantity,
                    price=req.price,
                    leverage=settings.default_leverage,
                )
            else:
                # 现货市价单
                response = await client.create_market_order(
                    symbol=req.symbol,
                    side=req.side,
                    quantity=req.quantity,
                )
        finally:
            await client.close()

        order = Order(
            user_id=self.user_id,
            symbol=req.symbol,
            side=req.side,
            position_side=req.position_side,
            order_type=req.order_type,
            quantity=Decimal(str(req.quantity)),
            price=Decimal(str(req.price)) if req.price else None,
            stop_loss=Decimal(str(req.stop_loss)),
            take_profit=Decimal(str(req.take_profit)) if req.take_profit else None,
            trade_reason=req.trade_reason,
            status=response.get("status", "NEW"),
            trade_mode="LIVE",
            market_type=settings.default_market,
            leverage=settings.default_leverage,
            binance_order_id=str(response.get("orderId", "")),
            binance_client_order_id=response.get("clientOrderId"),
            filled_price=Decimal(str(response.get("fills", [{}])[0].get("price", 0)))
            if response.get("fills")
            else None,
        )
        self.db.add(order)
        await self.db.commit()
        await self.db.refresh(order)
        return order

    # ============ 平仓 ============

    async def close_position(
        self, order_id: str, quantity: Optional[float] = None, close_price: Optional[float] = None
    ) -> Order:
        """平仓并计算盈亏"""
        result = await self.db.execute(
            select(Order).where(Order.id == order_id, Order.user_id == self.user_id)
        )
        order = result.scalar_one_or_none()

        if not order:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="持仓不存在")

        if order.pnl is not None:
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail="该持仓已平仓")

        settings = await self.get_trade_settings()

        if settings.trade_mode == "SIMULATED":
            # 模拟交易：使用传入的平仓价或当前市价（如果有）
            # 这里简单逻辑：计算买入和卖出的价差
            filled_price = float(order.filled_price or order.price or 0)
            if not close_price:
                # 如果没有传平仓价，暂时用止损价或止盈价模拟（实际应取实时行情）
                close_price = float(order.stop_loss)
            
            pnl_per_unit = (close_price - filled_price) if order.side == "BUY" else (filled_price - close_price)
            order.pnl = Decimal(str(pnl_per_unit * float(order.quantity) * order.leverage))
            order.pnl_percent = Decimal(str((pnl_per_unit / filled_price * 100 * order.leverage))) if filled_price > 0 else 0
            order.status = "CLOSED"
        else:
            # 真实交易
            client = await self.get_binance_client(testnet=False)
            try:
                # 平仓逻辑：如果是做多，卖出；如果是做空，买入
                close_side = "SELL" if order.side == "BUY" else "BUY"
                await client.create_market_order(
                    symbol=order.symbol,
                    side=close_side,
                    quantity=float(quantity or order.quantity),
                )
                order.status = "CLOSED"
            finally:
                await client.close()

        await self.db.commit()
        await self.db.refresh(order)
        return order

    # ============ Binance 真实持仓 ============

    async def get_live_positions(self) -> list:
        """获取 Binance 真实持仓"""
        settings = await self.get_trade_settings()

        if settings.trade_mode != "LIVE":
            return []

        client = await self.get_binance_client(testnet=False)
        try:
            if settings.default_market == "FUTURES":
                # 合约持仓
                positions = await client.get_futures_position()
                result = []
                for pos in positions:
                    if float(pos.get("positionAmt", 0)) != 0:
                        result.append({
                            "symbol": pos.get("symbol", ""),
                            "side": "LONG" if float(pos.get("positionAmt", 0)) > 0 else "SHORT",
                            "quantity": abs(float(pos.get("positionAmt", 0))),
                            "entry_price": float(pos.get("entryPrice", 0)),
                            "unrealized_pnl": float(pos.get("unRealizedProfit", 0)),
                            "leverage": int(pos.get("leverage", 1)),
                            "market_type": "FUTURES",
                        })
                return result
            else:
                # 现货持仓
                account_info = await client.get_spot_account_info()
                result = []
                for balance in account_info.get("balances", []):
                    total = float(balance.get("free", 0)) + float(balance.get("locked", 0))
                    if total > 0.0001:
                        asset = balance.get("asset", "")
                        if asset not in ("USDT", "BUSD", "USD"):
                            symbol = f"{asset}USDT"
                            result.append({
                                "symbol": symbol,
                                "side": "LONG",
                                "quantity": total,
                                # 现货平均成本需要逐个拉成交历史，接口会非常慢。
                                # 看板先返回可用持仓和现价，成本后续再异步优化。
                                "entry_price": 0.0,
                                "unrealized_pnl": 0,
                                "market_type": "SPOT",
                            })
                return result
        except Exception as e:
            logger.exception("Error getting live positions")
            raise RuntimeError("无法连接 Binance 持仓接口，请检查网络或代理配置") from e
        finally:
            await client.close()

    async def _get_average_entry_price(self, client: BinanceClient, symbol: str, asset: str) -> float:
        """从历史成交计算平均成本"""
        try:
            from datetime import datetime, timedelta
            end_time = int(datetime.now().timestamp() * 1000)
            start_time = int((datetime.now() - timedelta(days=90)).timestamp() * 1000)

            trades = await client.get_my_trades(symbol=symbol, start_time=start_time, end_time=end_time)
            # ... (后续计算逻辑保持不变，但已经是异步获取数据)

            if not trades:
                # 如果没有成交记录，返回0，让前端用当前价格显示
                return 0.0

            total_cost = 0.0
            total_quantity = 0.0

            for trade in trades:
                # BUY 交易增加持仓
                if trade.get("isBuyer", False):
                    total_cost += float(trade.get("quoteQty", 0))
                    total_quantity += float(trade.get("qty", 0))
                # SELL 交易减少持仓（使用平均成本计算）
                else:
                    sold_qty = float(trade.get("qty", 0))
                    quoteQty = float(trade.get("quoteQty", 0))
                    avg_cost_per_unit = total_cost / total_quantity if total_quantity > 0 else 0
                    # 正确计算：加上卖出所得，减去卖出部分的成本
                    total_cost = total_cost + quoteQty - avg_cost_per_unit * sold_qty
                    total_quantity -= sold_qty

            if total_quantity > 0:
                return total_cost / total_quantity
            return 0.0
        except Exception as e:
            print(f"[Trade] Error getting average entry price for {symbol}: {e}")
            return 0.0
