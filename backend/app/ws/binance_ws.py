"""Binance WebSocket manager — proxies real-time kline data to frontend clients."""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any

import websockets
from fastapi import WebSocket

from app.modules.market.service import fetch_klines
from app.ws.aggtrade_klines import apply_trade_to_kline, seed_realtime_kline
from app.ws.proxy_tunnel import build_ws_connect_kwargs

logger = logging.getLogger(__name__)

BINANCE_WS_BASE = "wss://stream.binance.com:9443/ws"


@dataclass
class _IntervalState:
    clients: set[WebSocket] = field(default_factory=set)
    kline: dict[str, Any] | None = None


@dataclass
class _TradeStreamState:
    symbol: str
    intervals: dict[str, _IntervalState] = field(default_factory=dict)
    task: asyncio.Task[None] | None = None


class BinanceWSManager:
    """Singleton that fans-out Binance real-time candles to N frontend clients."""

    _instance: BinanceWSManager | None = None

    def __new__(cls) -> BinanceWSManager:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._streams: dict[str, _TradeStreamState] = {}
        return cls._instance

    # -- public API ----------------------------------------------------------

    async def subscribe(self, client: WebSocket, symbol: str, interval: str) -> None:
        stream_key = symbol.lower()
        state = self._streams.get(stream_key)
        if state is None:
            state = _TradeStreamState(symbol=symbol)
            self._streams[stream_key] = state

        interval_state = state.intervals.get(interval)
        if interval_state is None:
            interval_state = _IntervalState()
            state.intervals[interval] = interval_state
        interval_state.clients.add(client)

        if interval_state.kline is None:
            interval_state.kline = await self._seed_interval_kline(symbol, interval)

        if state.task is None or state.task.done():
            state.task = asyncio.create_task(self._binance_listener(stream_key))
        client_count = sum(len(item.clients) for item in state.intervals.values())
        logger.info(
            "Client subscribed to %s %s via aggTrade (clients=%d)",
            symbol,
            interval,
            client_count,
        )

    async def unsubscribe(self, client: WebSocket) -> None:
        empty_streams: list[str] = []
        for key, state in list(self._streams.items()):
            empty_intervals: list[str] = []
            for interval, interval_state in state.intervals.items():
                interval_state.clients.discard(client)
                if not interval_state.clients:
                    empty_intervals.append(interval)
            for interval in empty_intervals:
                state.intervals.pop(interval, None)
                logger.info("Interval %s closed for %s (no clients)", interval, key)
            if not state.intervals:
                empty_streams.append(key)
        for key in empty_streams:
            state = self._streams.pop(key)
            if state.task and not state.task.done():
                state.task.cancel()
            logger.info("aggTrade stream %s closed (no clients)", key)

    async def shutdown(self) -> None:
        for key, state in self._streams.items():
            if state.task and not state.task.done():
                state.task.cancel()
        self._streams.clear()
        logger.info("BinanceWSManager shut down")

    # -- internals -----------------------------------------------------------

    async def _binance_listener(self, stream_key: str) -> None:
        url = f"{BINANCE_WS_BASE}/{stream_key}@aggTrade"
        backoff = 0.5
        while stream_key in self._streams and self._streams[stream_key].intervals:
            try:
                kwargs = await build_ws_connect_kwargs(url)
                logger.info("Connecting to Binance aggTrade %s", stream_key)
                async with websockets.connect(url, **kwargs) as ws:
                    logger.info("Connected to Binance aggTrade %s", stream_key)
                    backoff = 0.5  # reset on success
                    async for raw in ws:
                        data = json.loads(raw)
                        if data.get("e") != "aggTrade":
                            continue
                        await self._broadcast_trade(stream_key, data)
            except asyncio.CancelledError:
                break
            except Exception:
                logger.warning(
                    "Binance aggTrade %s disconnected, reconnecting in %.1fs",
                    stream_key, backoff,
                )
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 5.0)

    async def _broadcast_trade(self, stream_key: str, trade: dict[str, Any]) -> None:
        state = self._streams.get(stream_key)
        if not state:
            return
        event_time_ms = int(trade.get("T") or trade.get("E") or 0)
        price = float(trade["p"])
        quantity = float(trade["q"])

        for interval, interval_state in list(state.intervals.items()):
            interval_state.kline = apply_trade_to_kline(
                interval_state.kline,
                interval,
                event_time_ms,
                price,
                quantity,
            )
            payload = json.dumps({"type": "kline", "data": interval_state.kline})
            dead: list[WebSocket] = []
            for client in list(interval_state.clients):
                try:
                    await client.send_text(payload)
                except Exception:
                    dead.append(client)
            for client in dead:
                interval_state.clients.discard(client)

    async def _seed_interval_kline(self, symbol: str, interval: str) -> dict[str, Any] | None:
        try:
            klines = await fetch_klines(symbol, interval, 1)
        except Exception:
            logger.warning("Failed to seed realtime kline for %s %s", symbol, interval)
            return None
        latest = klines[-1] if klines else None
        return seed_realtime_kline(latest)


manager = BinanceWSManager()
