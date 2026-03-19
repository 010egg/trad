import asyncio
import os

import httpx

BINANCE_BASE_URL = "https://api.binance.com"

# 获取代理配置
PROXY = os.environ.get("http_proxy") or os.environ.get("HTTP_PROXY")

# MVP 支持的交易对
SUPPORTED_SYMBOLS = [
    {"symbol": "BTCUSDT", "base_asset": "BTC", "quote_asset": "USDT"},
    {"symbol": "ETHUSDT", "base_asset": "ETH", "quote_asset": "USDT"},
    {"symbol": "BNBUSDT", "base_asset": "BNB", "quote_asset": "USDT"},
    {"symbol": "SOLUSDT", "base_asset": "SOL", "quote_asset": "USDT"},
    {"symbol": "XRPUSDT", "base_asset": "XRP", "quote_asset": "USDT"},
    {"symbol": "DOGEUSDT", "base_asset": "DOGE", "quote_asset": "USDT"},
]


async def fetch_klines(symbol: str, interval: str, limit: int) -> list[dict]:
    """从 Binance 获取 K 线数据"""
    url = f"{BINANCE_BASE_URL}/api/v3/klines"
    params = {"symbol": symbol, "interval": interval, "limit": limit}

    try:
        # 使用系统代理设置（从环境变量）
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, proxy=PROXY) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            raw = resp.json()

        return [
            {
                "time": int(k[0]) // 1000,  # 毫秒转秒
                "open": float(k[1]),
                "high": float(k[2]),
                "low": float(k[3]),
                "close": float(k[4]),
                "volume": float(k[5]),
            }
            for k in raw
        ]
    except Exception as e:
        print(f"[Market] Error fetching klines: {e}")
        raise


async def fetch_current_prices(symbols: list[str]) -> dict[str, float]:
    """批量获取当前价格"""
    if not symbols:
        return {}

    unique_symbols = list(dict.fromkeys(symbols))
    url = f"{BINANCE_BASE_URL}/api/v3/ticker/price"

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, proxy=PROXY) as client:
        try:
            symbols_json = '["' + '","'.join(unique_symbols) + '"]'
            resp = await client.get(url, params={"symbols": symbols_json})
            resp.raise_for_status()
            raw = resp.json()
            return {
                item["symbol"]: float(item["price"])
                for item in raw
            }
        except Exception as e:
            print(f"[Market] Batch price fetch failed, fallback to per-symbol fetch: {e}")

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
