"""Binance API 异步客户端封装"""

import logging
from binance import AsyncClient
from binance.base_client import BaseClient
from binance.exceptions import BinanceAPIException
from typing import Optional

from app.config import settings

logger = logging.getLogger(__name__)

class BinanceClient:
    """Binance API 异步封装类"""

    def __init__(self, api_key: str, api_secret: str, testnet: bool = True):
        self.api_key = api_key
        self.api_secret = api_secret
        self.testnet = testnet
        self._client: Optional[AsyncClient] = None
        self._connected_endpoint: Optional[str] = None

    def _candidate_base_endpoints(self) -> list[str]:
        if self.testnet:
            return [BaseClient.BASE_ENDPOINT_DEFAULT]

        if settings.binance_base_endpoint:
            return [settings.binance_base_endpoint]

        return [
            BaseClient.BASE_ENDPOINT_DEFAULT,
            BaseClient.BASE_ENDPOINT_1,
            BaseClient.BASE_ENDPOINT_2,
            BaseClient.BASE_ENDPOINT_3,
            BaseClient.BASE_ENDPOINT_4,
        ]

    async def get_client(self) -> AsyncClient:
        """延迟初始化 AsyncClient"""
        if self._client is None:
            last_error: Exception | None = None

            for endpoint in self._candidate_base_endpoints():
                endpoint_label = endpoint or "default"
                try:
                    self._client = await AsyncClient.create(
                        api_key=self.api_key,
                        api_secret=self.api_secret,
                        testnet=self.testnet,
                        tld=settings.binance_tld,
                        base_endpoint=endpoint,
                        https_proxy=settings.binance_https_proxy,
                        session_params={"trust_env": True},
                    )
                    self._connected_endpoint = endpoint_label
                    logger.info("Connected to Binance endpoint: %s", endpoint_label)
                    break
                except Exception as exc:
                    last_error = exc
                    logger.warning("Failed to connect Binance endpoint %s: %s", endpoint_label, exc)

            if self._client is None:
                raise ConnectionError("Cannot connect to Binance API") from last_error

        return self._client

    async def close(self):
        """关闭连接"""
        if self._client:
            await self._client.close_connection()

    # ============ 现货交易 ============

    async def create_market_order(self, symbol: str, side: str, quantity: float) -> dict:
        """现货市价单"""
        client = await self.get_client()
        try:
            return await client.order_market_symbol(
                symbol=symbol.upper(),
                side=side.upper(),
                quantity=quantity,
            )
        except BinanceAPIException as e:
            logger.error(f"Binance API Error (Market Order): {e}")
            raise

    # ============ 合约交易 ============

    async def create_futures_order(
        self,
        symbol: str,
        side: str,
        position_side: str,
        order_type: str,
        quantity: float,
        price: Optional[float] = None,
        stop_price: Optional[float] = None,
        leverage: int = 1,
    ) -> dict:
        """合约下单"""
        client = await self.get_client()
        try:
            # 只有在杠杆不同时才调用设置杠杆（优化延迟）
            # 注意：实际生产中建议在初始化或专门的设置接口中设置杠杆
            await client.futures_change_leverage(
                symbol=symbol.upper(), leverage=leverage
            )

            params = {
                "symbol": symbol.upper(),
                "side": side.upper(),
                "positionSide": position_side.upper(),
                "type": order_type.upper(),
                "quantity": quantity,
            }
            if price:
                params["price"] = str(price)
            if stop_price:
                params["stopPrice"] = str(stop_price)
            if order_type.upper() == "LIMIT":
                params["timeInForce"] = "GTC"

            return await client.futures_create_order(**params)
        except BinanceAPIException as e:
            logger.error(f"Binance API Error (Futures Order): {e}")
            raise

    async def get_futures_position(self, symbol: Optional[str] = None) -> list:
        """查询合约持仓"""
        client = await self.get_client()
        if symbol:
            return await client.futures_position_information(symbol=symbol.upper())
        return await client.futures_position_information()

    async def get_futures_account_balance(self) -> list:
        """查询合约账户余额"""
        client = await self.get_client()
        return await client.futures_account_balance()

    async def get_spot_account_info(self) -> dict:
        """查询现货账户信息"""
        client = await self.get_client()
        return await client.get_account()

    async def get_spot_balance(self, asset: str) -> dict:
        """查询现货资产余额"""
        client = await self.get_client()
        balance = await client.get_asset_balance(asset=asset.upper())
        return balance or {"asset": asset.upper(), "free": "0", "locked": "0"}

    async def get_my_trades(
        self,
        symbol: str,
        start_time: int | None = None,
        end_time: int | None = None,
        limit: int | None = None,
        from_id: int | None = None,
    ) -> list:
        """查询成交历史"""
        client = await self.get_client()
        params = {"symbol": symbol.upper()}
        if start_time is not None:
            params["startTime"] = start_time
        if end_time is not None:
            params["endTime"] = end_time
        if limit is not None:
            params["limit"] = limit
        if from_id is not None:
            params["fromId"] = from_id
        return await client.get_my_trades(**params)
