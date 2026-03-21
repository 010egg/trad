"""交易服务层"""

import asyncio
import logging
from decimal import Decimal
from typing import Any, Optional
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.trade.models import Order, TradeSettings
from app.modules.trade.schemas import CreateOrderRequest
from app.modules.risk.service import check_single_trade_risk, get_or_create_config
from app.modules.risk.service import check_daily_loss_circuit
from app.modules.binance.client import BinanceClient
from app.modules.account.service import decrypt_value, encrypt_value, mask_key
from app.modules.trade.models import ApiKey
from app.modules.intel.prompts import get_default_intel_system_prompt

logger = logging.getLogger(__name__)
RECENT_SPOT_TRADES_LIMIT = 1000
LLM_PROVIDER_VALUES = {"OPENAI", "ANTHROPIC"}
MINIMAX_API_HOSTS = {"api.minimax.io", "api.minimax.chat", "api.minimaxi.com"}


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
        elif not (self._settings.llm_system_prompt or "").strip():
            self._settings.llm_system_prompt = get_default_intel_system_prompt()
            await self.db.commit()
            await self.db.refresh(self._settings)
        return self._settings

    async def update_trade_settings(
        self,
        trade_mode: Optional[str] = None,
        default_market: Optional[str] = None,
        default_leverage: Optional[int] = None,
        llm_enabled: Optional[bool] = None,
        llm_provider: Optional[str] = None,
        llm_base_url: Optional[str] = None,
        llm_model: Optional[str] = None,
        llm_system_prompt: Optional[str] = None,
        llm_api_key: Optional[str] = None,
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

        if llm_enabled is not None:
            settings.llm_enabled = llm_enabled

        if llm_provider is not None:
            llm_provider = llm_provider.strip().upper()
            if llm_provider not in LLM_PROVIDER_VALUES:
                raise ValueError("Invalid LLM provider")
            settings.llm_provider = llm_provider

        if llm_base_url is not None:
            settings.llm_base_url = normalize_llm_base_url(
                settings.llm_provider or "OPENAI",
                llm_base_url,
            )

        if llm_model is not None:
            settings.llm_model = (llm_model.strip() or "minimax")

        if llm_system_prompt is not None:
            settings.llm_system_prompt = llm_system_prompt.strip() or get_default_intel_system_prompt()

        if llm_api_key is not None:
            llm_api_key = llm_api_key.strip()
            settings.llm_api_key_enc = encrypt_value(llm_api_key) if llm_api_key else None

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
        if req.price:
            fill_price = req.price
        else:
            from app.modules.market.service import fetch_current_prices
            prices = await fetch_current_prices([req.symbol])
            fill_price = prices.get(req.symbol, 0.0)

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
            filled_price=Decimal(str(fill_price)),
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
                spot_positions = []
                for balance in account_info.get("balances", []):
                    total = float(balance.get("free", 0)) + float(balance.get("locked", 0))
                    if total > 0.0001:
                        asset = balance.get("asset", "")
                        if asset not in ("USDT", "BUSD", "USD"):
                            symbol = f"{asset}USDT"
                            spot_positions.append({
                                "asset": asset,
                                "symbol": symbol,
                                "side": "LONG",
                                "quantity": total,
                                "unrealized_pnl": 0,
                                "market_type": "SPOT",
                            })

                if not spot_positions:
                    return []

                entry_prices = await asyncio.gather(
                    *[
                        self._get_average_entry_price(
                            client,
                            position["symbol"],
                            position["asset"],
                            position["quantity"],
                        )
                        for position in spot_positions
                    ],
                    return_exceptions=True,
                )

                result = []
                for position, entry_price in zip(spot_positions, entry_prices):
                    resolved_entry_price = 0.0
                    if isinstance(entry_price, Exception):
                        logger.warning(
                            "Failed to calculate spot entry price for %s",
                            position["symbol"],
                            exc_info=entry_price,
                        )
                    else:
                        resolved_entry_price = float(entry_price or 0.0)

                    result.append({
                        "symbol": position["symbol"],
                        "side": position["side"],
                        "quantity": position["quantity"],
                        "entry_price": resolved_entry_price,
                        "unrealized_pnl": position["unrealized_pnl"],
                        "market_type": position["market_type"],
                    })
                return result
        except Exception as e:
            logger.exception("Error getting live positions")
            raise RuntimeError("无法连接 Binance 持仓接口，请检查网络或代理配置") from e
        finally:
            await client.close()

    def _calculate_spot_cost_basis(self, trades: list[dict], asset: str) -> tuple[float, float]:
        """根据现货成交历史计算当前剩余持仓的成本和数量"""
        total_cost = 0.0
        total_quantity = 0.0

        for trade in sorted(trades, key=lambda item: item.get("time", 0)):
            raw_qty = float(trade.get("qty", 0))
            quote_qty = float(trade.get("quoteQty", 0))
            commission = float(trade.get("commission", 0))
            commission_asset = trade.get("commissionAsset", "")

            if raw_qty <= 0:
                continue

            if trade.get("isBuyer", False):
                net_qty = raw_qty - commission if commission_asset == asset else raw_qty
                if net_qty <= 0:
                    continue
                total_quantity += net_qty
                total_cost += quote_qty + (commission if commission_asset == "USDT" else 0.0)
            else:
                sell_qty = raw_qty + (commission if commission_asset == asset else 0.0)
                if total_quantity <= 0 or sell_qty <= 0:
                    continue

                sold_qty = min(sell_qty, total_quantity)
                avg_cost_per_unit = total_cost / total_quantity if total_quantity > 0 else 0.0
                total_cost -= avg_cost_per_unit * sold_qty
                total_quantity -= sold_qty

                if total_quantity <= 1e-12:
                    total_cost = 0.0
                    total_quantity = 0.0

        return total_cost, total_quantity

    async def _get_average_entry_price(
        self,
        client: BinanceClient,
        symbol: str,
        asset: str,
        current_quantity: float,
    ) -> float:
        """从最近成交历史计算平均成本"""
        try:
            trades = await client.get_my_trades(symbol=symbol, limit=RECENT_SPOT_TRADES_LIMIT)

            if not trades:
                return 0.0

            total_cost, total_quantity = self._calculate_spot_cost_basis(trades, asset)
            quantity_tolerance = max(current_quantity * 0.01, 1e-8)

            if total_quantity > 0 and abs(total_quantity - current_quantity) <= quantity_tolerance:
                return total_cost / total_quantity

            logger.info(
                "Spot entry price unavailable for %s: trade_qty=%s current_qty=%s recent_trades=%s",
                symbol,
                total_quantity,
                current_quantity,
                len(trades),
            )
            return 0.0
        except Exception as e:
            logger.warning("Error getting average entry price for %s (%s): %s", symbol, asset, e)
            return 0.0


def serialize_trade_settings(settings: TradeSettings) -> dict[str, Any]:
    masked_api_key = None
    has_api_key = bool(settings.llm_api_key_enc)

    if has_api_key:
        try:
            masked_api_key = mask_key(decrypt_value(settings.llm_api_key_enc))
        except Exception:
            masked_api_key = "***"

    return {
        "trade_mode": settings.trade_mode,
        "default_market": settings.default_market,
        "default_leverage": settings.default_leverage,
        "llm_enabled": settings.llm_enabled,
        "llm_provider": settings.llm_provider or "OPENAI",
        "llm_base_url": normalize_llm_base_url(settings.llm_provider or "OPENAI", settings.llm_base_url or ""),
        "llm_model": settings.llm_model or "minimax",
        "llm_system_prompt": settings.llm_system_prompt or get_default_intel_system_prompt(),
        "llm_has_api_key": has_api_key,
        "llm_api_key_masked": masked_api_key,
    }


def has_custom_llm_settings(settings: TradeSettings) -> bool:
    return bool(settings.llm_enabled or settings.llm_base_url or settings.llm_api_key_enc)


def build_user_llm_runtime_config(settings: TradeSettings) -> dict[str, str] | None:
    if not settings.llm_enabled:
        return None
    if not settings.llm_base_url or not settings.llm_model or not settings.llm_api_key_enc:
        return None

    try:
        api_key = decrypt_value(settings.llm_api_key_enc)
    except Exception:
        return None

    return {
        "provider": settings.llm_provider or "OPENAI",
        "base_url": normalize_llm_base_url(settings.llm_provider or "OPENAI", settings.llm_base_url),
        "model": settings.llm_model,
        "system_prompt": settings.llm_system_prompt.strip() or get_default_intel_system_prompt(),
        "api_key": api_key,
    }


def normalize_llm_base_url(provider: str, base_url: str) -> str:
    provider = (provider or "OPENAI").strip().upper()
    base_url = (base_url or "").strip().rstrip("/")
    if not base_url:
        return ""

    parsed = urlparse(base_url)
    host = (parsed.netloc or "").lower()
    path = parsed.path or ""

    if host in MINIMAX_API_HOSTS:
        if provider == "ANTHROPIC":
            normalized_path = path.rstrip("/")
            if normalized_path.endswith("/v1/messages"):
                normalized_path = normalized_path[:-len("/v1/messages")]
            elif normalized_path.endswith("/messages"):
                normalized_path = normalized_path[:-len("/messages")]
            if normalized_path.endswith("/v1"):
                normalized_path = normalized_path[:-len("/v1")]
            if path in {"", "/"}:
                return f"{parsed.scheme}://{parsed.netloc}/anthropic"
            if normalized_path:
                return f"{parsed.scheme}://{parsed.netloc}{normalized_path}"
        if provider == "OPENAI":
            if path in {"", "/"}:
                return f"{parsed.scheme}://{parsed.netloc}/v1"
            if path.endswith("/chat/completions"):
                return f"{parsed.scheme}://{parsed.netloc}{path[:-len('/chat/completions')]}"

    return base_url
