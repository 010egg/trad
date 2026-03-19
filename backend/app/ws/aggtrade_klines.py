from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any


_FIXED_INTERVAL_SECONDS = {
    "1m": 60,
    "3m": 3 * 60,
    "5m": 5 * 60,
    "15m": 15 * 60,
    "30m": 30 * 60,
    "1h": 60 * 60,
    "2h": 2 * 60 * 60,
    "4h": 4 * 60 * 60,
    "6h": 6 * 60 * 60,
    "8h": 8 * 60 * 60,
    "12h": 12 * 60 * 60,
    "1d": 24 * 60 * 60,
    "3d": 3 * 24 * 60 * 60,
}


def floor_interval_start(interval: str, event_time_ms: int) -> int:
    if interval in _FIXED_INTERVAL_SECONDS:
        seconds = _FIXED_INTERVAL_SECONDS[interval]
        return int((event_time_ms // 1000) // seconds * seconds)

    dt = datetime.fromtimestamp(event_time_ms / 1000, tz=timezone.utc)

    if interval == "1w":
        day_start = datetime(dt.year, dt.month, dt.day, tzinfo=timezone.utc)
        week_start = day_start - timedelta(days=day_start.weekday())
        return int(week_start.timestamp())

    if interval == "1M":
        month_start = datetime(dt.year, dt.month, 1, tzinfo=timezone.utc)
        return int(month_start.timestamp())

    raise ValueError(f"Unsupported interval: {interval}")


def seed_realtime_kline(kline: dict[str, Any] | None) -> dict[str, Any] | None:
    if not kline:
        return None
    return {
        "time": int(kline["time"]),
        "open": float(kline["open"]),
        "high": float(kline["high"]),
        "low": float(kline["low"]),
        "close": float(kline["close"]),
        "volume": float(kline["volume"]),
        "closed": False,
    }


def apply_trade_to_kline(
    current: dict[str, Any] | None,
    interval: str,
    event_time_ms: int,
    price: float,
    quantity: float,
) -> dict[str, Any]:
    bucket_start = floor_interval_start(interval, event_time_ms)

    if current is None or int(current["time"]) != bucket_start:
        return {
            "time": bucket_start,
            "open": price,
            "high": price,
            "low": price,
            "close": price,
            "volume": quantity,
            "closed": False,
        }

    return {
        "time": int(current["time"]),
        "open": float(current["open"]),
        "high": max(float(current["high"]), price),
        "low": min(float(current["low"]), price),
        "close": price,
        "volume": float(current["volume"]) + quantity,
        "closed": False,
    }
