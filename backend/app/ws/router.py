"""WebSocket route for real-time market data."""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.ws.binance_ws import manager

logger = logging.getLogger(__name__)

router = APIRouter()

VALID_INTERVALS = {"1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"}


@router.websocket("/ws/market")
async def ws_market(ws: WebSocket) -> None:
    await ws.accept()
    logger.info("WS client connected")
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_text(json.dumps({"type": "error", "message": "invalid JSON"}))
                continue

            action = msg.get("action")
            if action == "subscribe":
                symbol = (msg.get("symbol") or "").upper()
                interval = msg.get("interval") or ""
                if not symbol or interval not in VALID_INTERVALS:
                    await ws.send_text(json.dumps({"type": "error", "message": "invalid symbol or interval"}))
                    continue
                # Unsubscribe from previous streams before subscribing new one
                await manager.unsubscribe(ws)
                await manager.subscribe(ws, symbol, interval)
                await ws.send_text(json.dumps({"type": "subscribed", "symbol": symbol, "interval": interval}))
            else:
                await ws.send_text(json.dumps({"type": "error", "message": f"unknown action: {action}"}))
    except WebSocketDisconnect:
        logger.info("WS client disconnected")
    finally:
        await manager.unsubscribe(ws)
