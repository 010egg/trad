import asyncio
import json
import logging
import os

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.backtest.models import HistoricalKline

BINANCE_BASE_URL = "https://api.binance.com"
logger = logging.getLogger(__name__)

# 获取代理配置
PROXY = os.environ.get("http_proxy") or os.environ.get("HTTP_PROXY")
_market_http_client: httpx.AsyncClient | None = None

# MVP 支持的交易对
SUPPORTED_SYMBOLS = [
    {"symbol": "BTCUSDT", "base_asset": "BTC", "quote_asset": "USDT"},
    {"symbol": "ETHUSDT", "base_asset": "ETH", "quote_asset": "USDT"},
    {"symbol": "BNBUSDT", "base_asset": "BNB", "quote_asset": "USDT"},
    {"symbol": "SOLUSDT", "base_asset": "SOL", "quote_asset": "USDT"},
    {"symbol": "XRPUSDT", "base_asset": "XRP", "quote_asset": "USDT"},
    {"symbol": "DOGEUSDT", "base_asset": "DOGE", "quote_asset": "USDT"},
]


async def get_market_http_client() -> httpx.AsyncClient:
    global _market_http_client
    if _market_http_client is None or _market_http_client.is_closed:
        _market_http_client = httpx.AsyncClient(timeout=30.0, follow_redirects=True, proxy=PROXY)
    return _market_http_client


async def close_market_http_client() -> None:
    global _market_http_client
    if _market_http_client is None:
        return
    await _market_http_client.aclose()
    _market_http_client = None


async def fetch_klines(symbol: str, interval: str, limit: int) -> list[dict]:
    """从 Binance 获取 K 线数据"""
    url = f"{BINANCE_BASE_URL}/api/v3/klines"

    try:
        client = await get_market_http_client()
        all_rows: list[list] = []
        end_time: int | None = None

        while len(all_rows) < limit:
            remaining = limit - len(all_rows)
            params = {"symbol": symbol, "interval": interval, "limit": min(remaining, 1000)}
            if end_time is not None:
                params["endTime"] = end_time

            resp = await client.get(url, params=params)
            resp.raise_for_status()
            raw = resp.json()
            if not raw:
                break

            all_rows = raw + all_rows
            if len(raw) < params["limit"]:
                break

            earliest_open_time = int(raw[0][0])
            next_end_time = earliest_open_time - 1
            if end_time is not None and next_end_time >= end_time:
                break
            end_time = next_end_time

        return [
            {
                "time": int(k[0]) // 1000,  # 毫秒转秒
                "open": float(k[1]),
                "high": float(k[2]),
                "low": float(k[3]),
                "close": float(k[4]),
                "volume": float(k[5]),
            }
            for k in all_rows[-limit:]
        ]
    except Exception:
        logger.exception("Error fetching Binance klines for %s %s", symbol, interval)
        raise


def _historical_row_to_dict(row: HistoricalKline) -> dict:
    return {
        "time": int(row.open_time) // 1000,
        "open": float(row.open),
        "high": float(row.high),
        "low": float(row.low),
        "close": float(row.close),
        "volume": float(row.volume),
    }


async def _fetch_cached_klines_before(
    db: AsyncSession,
    symbol: str,
    interval: str,
    before_time_seconds: int,
    limit: int,
) -> list[dict]:
    if limit <= 0:
        return []

    stmt = (
        select(HistoricalKline)
        .where(
            HistoricalKline.symbol == symbol,
            HistoricalKline.interval == interval,
            HistoricalKline.open_time < before_time_seconds * 1000,
        )
        .order_by(HistoricalKline.open_time.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [_historical_row_to_dict(row) for row in reversed(rows)]


async def fetch_chart_klines(db: AsyncSession, symbol: str, interval: str, limit: int) -> list[dict]:
    latest_klines = await fetch_klines(symbol, interval, min(limit, 1000))
    if not latest_klines or limit <= 1000:
        return latest_klines

    earliest_remote_time = int(latest_klines[0]["time"])
    cached_older = await _fetch_cached_klines_before(
        db=db,
        symbol=symbol,
        interval=interval,
        before_time_seconds=earliest_remote_time,
        limit=limit - len(latest_klines),
    )

    deduped: dict[int, dict] = {
        int(item["time"]): item
        for item in [*cached_older, *latest_klines]
    }
    return [deduped[key] for key in sorted(deduped.keys())][-limit:]


async def fetch_current_prices(symbols: list[str]) -> dict[str, float]:
    """批量获取当前价格"""
    if not symbols:
        return {}

    unique_symbols = list(dict.fromkeys(symbols))
    url = f"{BINANCE_BASE_URL}/api/v3/ticker/price"
    client = await get_market_http_client()

    try:
        symbols_json = '["' + '","'.join(unique_symbols) + '"]'
        resp = await client.get(url, params={"symbols": symbols_json})
        resp.raise_for_status()
        raw = resp.json()
        return {
            item["symbol"]: float(item["price"])
            for item in raw
        }
    except Exception as exc:
        logger.warning("Batch price fetch failed, falling back to per-symbol fetch: %s", exc)

    async def fetch_single(symbol: str) -> tuple[str, float] | None:
        try:
            resp = await client.get(url, params={"symbol": symbol})
            resp.raise_for_status()
            raw = resp.json()
            return raw["symbol"], float(raw["price"])
        except Exception:
            # 无效/退市交易对直接跳过，不影响其他价格
            return None

    entries = await asyncio.gather(*(fetch_single(symbol) for symbol in unique_symbols))
    result: dict[str, float] = {}
    for entry in entries:
        if entry is None:
            continue
        symbol, price = entry
        result[symbol] = price

    return result


async def fetch_ticker_snapshots(symbols: list[str]) -> list[dict]:
    """批量获取最新价格和 24h 涨跌幅。"""
    if not symbols:
        return []

    unique_symbols = list(dict.fromkeys(symbol.upper() for symbol in symbols))
    url = f"{BINANCE_BASE_URL}/api/v3/ticker/24hr"
    client = await get_market_http_client()

    try:
        resp = await client.get(url, params={"symbols": json.dumps(unique_symbols, separators=(",", ":"))})
        resp.raise_for_status()
        raw = resp.json()
        if isinstance(raw, dict):
            raw = [raw]

        lookup = {
            item["symbol"]: {
                "symbol": item["symbol"],
                "price": float(item["lastPrice"]),
                "price_change_pct": float(item["priceChangePercent"]),
            }
            for item in raw
            if item.get("symbol")
        }
        return [lookup[symbol] for symbol in unique_symbols if symbol in lookup]
    except Exception as exc:
        logger.warning("Batch ticker fetch failed, falling back to per-symbol fetch: %s", exc)

    async def fetch_single(symbol: str) -> dict | None:
        try:
            resp = await client.get(url, params={"symbol": symbol})
            resp.raise_for_status()
            raw = resp.json()
            return {
                "symbol": raw["symbol"],
                "price": float(raw["lastPrice"]),
                "price_change_pct": float(raw["priceChangePercent"]),
            }
        except Exception:
            return None

    entries = await asyncio.gather(*(fetch_single(symbol) for symbol in unique_symbols))
    return [entry for entry in entries if entry is not None]
