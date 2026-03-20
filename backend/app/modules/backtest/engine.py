"""
回测引擎核心逻辑 + 技术指标计算库
支持指标：MA, EMA, KDJ, MACD, RSI, BOLL
"""

import math
import os
from datetime import datetime

import httpx
import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.backtest.models import HistoricalKline

BINANCE_BASE_URL = "https://api.binance.com"
PROXY = os.environ.get("http_proxy") or os.environ.get("HTTP_PROXY")
BINANCE_INTERVAL_MS = {
    "1m": 60_000,
    "3m": 3 * 60_000,
    "5m": 5 * 60_000,
    "15m": 15 * 60_000,
    "30m": 30 * 60_000,
    "1h": 60 * 60_000,
    "2h": 2 * 60 * 60_000,
    "4h": 4 * 60 * 60_000,
    "6h": 6 * 60 * 60_000,
    "8h": 8 * 60 * 60_000,
    "12h": 12 * 60 * 60_000,
    "1d": 24 * 60 * 60_000,
    "3d": 3 * 24 * 60 * 60_000,
    "1w": 7 * 24 * 60 * 60_000,
}


# ========== 数据获取 ==========

def _date_to_timestamp_ms(date_str: str) -> int:
    return int(datetime.strptime(date_str, "%Y-%m-%d").timestamp() * 1000)


def _interval_to_milliseconds(interval: str) -> int:
    if interval not in BINANCE_INTERVAL_MS:
        raise ValueError(f"unsupported interval: {interval}")
    return BINANCE_INTERVAL_MS[interval]


def _series_to_optional_list(series: pd.Series, digits: int | None = None) -> list[float | None]:
    if digits is not None:
        series = series.round(digits)
    return [None if pd.isna(value) else float(value) for value in series.tolist()]



def _macd_params(config: dict) -> tuple[int, int, int]:
    return (
        int(config.get("fast_period", config.get("fast", 12))),
        int(config.get("slow_period", config.get("slow", 26))),
        int(config.get("signal", 9)),
    )


def _macd_suffix(fast: int, slow: int, signal: int) -> str:
    return f"_{fast}_{slow}_{signal}"


def _kline_to_dict(kline: HistoricalKline) -> dict:
    return {
        "time": int(kline.open_time),
        "open": float(kline.open),
        "high": float(kline.high),
        "low": float(kline.low),
        "close": float(kline.close),
        "volume": float(kline.volume),
    }


async def _load_cached_klines(
    db: AsyncSession,
    symbol: str,
    interval: str,
    start_ts: int,
    end_ts: int,
) -> list[dict]:
    stmt = (
        select(HistoricalKline)
        .where(
            HistoricalKline.symbol == symbol,
            HistoricalKline.interval == interval,
            HistoricalKline.open_time >= start_ts,
            HistoricalKline.open_time < end_ts,
        )
        .order_by(HistoricalKline.open_time)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [_kline_to_dict(row) for row in rows]


def _find_missing_ranges(
    cached_klines: list[dict],
    start_ts: int,
    end_ts: int,
    interval_ms: int,
) -> list[tuple[int, int]]:
    if start_ts >= end_ts:
        return []
    if not cached_klines:
        return [(start_ts, end_ts)]

    missing_ranges: list[tuple[int, int]] = []
    cursor = start_ts

    for kline in cached_klines:
        open_time = int(kline["time"])
        if open_time > cursor:
            missing_ranges.append((cursor, min(open_time, end_ts)))
        cursor = max(cursor, open_time + interval_ms)
        if cursor >= end_ts:
            break

    if cursor < end_ts:
        missing_ranges.append((cursor, end_ts))

    return [(range_start, range_end) for range_start, range_end in missing_ranges if range_start < range_end]


async def _fetch_remote_klines_range(symbol: str, interval: str, start_ts: int, end_ts: int) -> list[dict]:
    interval_ms = _interval_to_milliseconds(interval)
    all_klines: list[dict] = []
    current_start = start_ts

    async with httpx.AsyncClient(proxy=PROXY, follow_redirects=True) as client:
        while current_start < end_ts:
            params = {
                "symbol": symbol,
                "interval": interval,
                "startTime": current_start,
                "endTime": end_ts,
                "limit": 1000,
            }
            resp = await client.get(f"{BINANCE_BASE_URL}/api/v3/klines", params=params, timeout=15)
            resp.raise_for_status()
            raw = resp.json()
            if not raw:
                break

            last_open_time: int | None = None
            for row in raw:
                open_time = int(row[0])
                if open_time >= end_ts:
                    break
                all_klines.append({
                    "time": open_time,
                    "open": float(row[1]),
                    "high": float(row[2]),
                    "low": float(row[3]),
                    "close": float(row[4]),
                    "volume": float(row[5]),
                })
                last_open_time = open_time

            if last_open_time is None:
                break

            next_start = last_open_time + interval_ms
            if next_start <= current_start:
                break
            current_start = next_start

    return all_klines


async def _store_klines(db: AsyncSession, symbol: str, interval: str, klines: list[dict]) -> None:
    if not klines:
        return

    deduped = sorted({int(k["time"]): k for k in klines}.values(), key=lambda item: item["time"])
    first_open_time = int(deduped[0]["time"])
    last_open_time = int(deduped[-1]["time"])

    stmt = (
        select(HistoricalKline.open_time)
        .where(
            HistoricalKline.symbol == symbol,
            HistoricalKline.interval == interval,
            HistoricalKline.open_time >= first_open_time,
            HistoricalKline.open_time <= last_open_time,
        )
    )
    existing_open_times = set((await db.execute(stmt)).scalars().all())

    rows = [
        HistoricalKline(
            symbol=symbol,
            interval=interval,
            open_time=int(k["time"]),
            open=float(k["open"]),
            high=float(k["high"]),
            low=float(k["low"]),
            close=float(k["close"]),
            volume=float(k["volume"]),
        )
        for k in deduped
        if int(k["time"]) not in existing_open_times
    ]
    if rows:
        db.add_all(rows)
        await db.flush()


async def fetch_historical_klines(
    db: AsyncSession,
    symbol: str,
    interval: str,
    start_date: str,
    end_date: str,
) -> list[dict]:
    """优先从数据库读取历史 K 线，只对缺口做增量拉取。"""
    symbol = symbol.upper()
    start_ts = _date_to_timestamp_ms(start_date)
    end_ts = _date_to_timestamp_ms(end_date)
    if start_ts >= end_ts:
        return []

    interval_ms = _interval_to_milliseconds(interval)
    cached_klines = await _load_cached_klines(db, symbol, interval, start_ts, end_ts)
    missing_ranges = _find_missing_ranges(cached_klines, start_ts, end_ts, interval_ms)

    if missing_ranges:
        fetched_klines: list[dict] = []
        for range_start, range_end in missing_ranges:
            fetched_klines.extend(await _fetch_remote_klines_range(symbol, interval, range_start, range_end))
        await _store_klines(db, symbol, interval, fetched_klines)
        cached_klines = await _load_cached_klines(db, symbol, interval, start_ts, end_ts)

    return cached_klines


# ========== 技术指标计算 ==========

def calc_ma(closes: list[float], period: int) -> list[float | None]:
    """简单移动平均线 (SMA)"""
    if len(closes) < period:
        return [None] * len(closes)
    series = pd.Series(closes, dtype="float64")
    return _series_to_optional_list(series.rolling(window=period, min_periods=period).mean())


def calc_ema(closes: list[float], period: int) -> list[float | None]:
    """指数移动平均线 (EMA)"""
    if len(closes) < period:
        return [None] * len(closes)

    series = pd.Series(closes, dtype="float64")
    seeded = pd.Series(np.nan, index=series.index, dtype="float64")
    seeded.iloc[period - 1] = float(series.iloc[:period].mean())
    if len(series) > period:
        seeded.iloc[period:] = series.iloc[period:]

    ema = seeded.ewm(span=period, adjust=False, min_periods=1).mean()
    ema.iloc[:period - 1] = np.nan
    return _series_to_optional_list(ema)


def calc_rsi(closes: list[float], period: int = 14) -> list[float | None]:
    """相对强弱指标 (RSI)"""
    if len(closes) <= period:
        return [None] * len(closes)

    close_array = np.asarray(closes, dtype=float)
    diffs = np.diff(close_array)
    gains = np.where(diffs > 0, diffs, 0.0)
    losses = np.where(diffs < 0, -diffs, 0.0)
    if len(gains) < period:
        return [None] * len(closes)

    result = np.full(len(closes), np.nan)
    avg_gain = float(gains[:period].mean())
    avg_loss = float(losses[:period].mean())
    result[period] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)

    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        result[i + 1] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)

    return _series_to_optional_list(pd.Series(result, dtype="float64"))


def calc_kdj(highs: list[float], lows: list[float], closes: list[float], n: int = 9, m1: int = 3, m2: int = 3) -> tuple[list[float | None], list[float | None], list[float | None]]:
    """KDJ 随机指标"""
    high_series = pd.Series(highs, dtype="float64")
    low_series = pd.Series(lows, dtype="float64")
    close_series = pd.Series(closes, dtype="float64")
    highest = high_series.rolling(window=n, min_periods=n).max()
    lowest = low_series.rolling(window=n, min_periods=n).min()
    denominator = highest - lowest
    rsv = ((close_series - lowest) / denominator * 100).where(denominator != 0, 50.0)

    k_values = np.full(len(closes), np.nan)
    d_values = np.full(len(closes), np.nan)
    j_values = np.full(len(closes), np.nan)
    prev_k = 50.0
    prev_d = 50.0

    for i, rsv_value in enumerate(rsv.to_numpy()):
        if np.isnan(rsv_value):
            continue
        k = (m1 - 1) / m1 * prev_k + 1 / m1 * float(rsv_value)
        d = (m2 - 1) / m2 * prev_d + 1 / m2 * k
        j = 3 * k - 2 * d

        k_values[i] = round(k, 2)
        d_values[i] = round(d, 2)
        j_values[i] = round(j, 2)
        prev_k = k
        prev_d = d

    return (
        _series_to_optional_list(pd.Series(k_values, dtype="float64")),
        _series_to_optional_list(pd.Series(d_values, dtype="float64")),
        _series_to_optional_list(pd.Series(j_values, dtype="float64")),
    )


def calc_macd(closes: list[float], fast: int = 12, slow: int = 26, signal: int = 9) -> tuple[list[float | None], list[float | None], list[float | None]]:
    """MACD 指标，返回 (DIF, DEA, MACD柱)"""
    ema_fast = pd.Series(calc_ema(closes, fast), dtype="float64")
    ema_slow = pd.Series(calc_ema(closes, slow), dtype="float64")
    dif_series = ema_fast - ema_slow
    dif = _series_to_optional_list(dif_series)

    dif_values = [value for value in dif if value is not None]
    if len(dif_values) < signal:
        return dif, [None] * len(closes), [None] * len(closes)

    dea_raw = calc_ema(dif_values, signal)
    offset = len(closes) - len(dif_values)
    dea: list[float | None] = [None] * offset + dea_raw
    hist_series = (pd.Series(dif, dtype="float64") - pd.Series(dea, dtype="float64")) * 2
    macd_hist = _series_to_optional_list(hist_series, digits=4)

    return dif, dea, macd_hist


def calc_boll(closes: list[float], period: int = 20, std_dev: float = 2.0) -> tuple[list[float | None], list[float | None], list[float | None]]:
    """布林带 (BOLL)，返回 (上轨, 中轨, 下轨)"""
    close_series = pd.Series(closes, dtype="float64")
    middle_series = close_series.rolling(window=period, min_periods=period).mean()
    std_series = close_series.rolling(window=period, min_periods=period).std(ddof=0)
    upper_series = middle_series + std_dev * std_series
    lower_series = middle_series - std_dev * std_series

    return (
        _series_to_optional_list(upper_series, digits=2),
        _series_to_optional_list(middle_series, digits=2),
        _series_to_optional_list(lower_series, digits=2),
    )


# ========== 指标计算 API（供前端图表使用） ==========

def calc_indicators(klines: list[dict], indicators: list[dict]) -> dict:
    """
    批量计算指标，返回指标数据用于前端图表叠加。
    indicators 示例：
    [
      {"type": "MA", "period": 20},
      {"type": "EMA", "period": 60},
      {"type": "KDJ", "n": 9},
      {"type": "MACD"},
      {"type": "RSI", "period": 14},
      {"type": "BOLL", "period": 20},
    ]
    """
    closes = [k["close"] for k in klines]
    highs = [k["high"] for k in klines]
    lows = [k["low"] for k in klines]
    times = [k["time"] for k in klines]

    result = {}

    for ind in indicators:
        t = ind["type"].upper()
        if t == "MA":
            period = ind.get("period", 20)
            values = calc_ma(closes, period)
            result[f"MA{period}"] = [{"time": times[i], "value": values[i]} for i in range(len(times)) if values[i] is not None]

        elif t == "EMA":
            period = ind.get("period", 20)
            values = calc_ema(closes, period)
            result[f"EMA{period}"] = [{"time": times[i], "value": values[i]} for i in range(len(times)) if values[i] is not None]

        elif t == "RSI":
            period = ind.get("period", 14)
            values = calc_rsi(closes, period)
            result[f"RSI{period}"] = [{"time": times[i], "value": values[i]} for i in range(len(times)) if values[i] is not None]

        elif t == "KDJ":
            n = ind.get("n", 9)
            k, d, j = calc_kdj(highs, lows, closes, n)
            result["KDJ_K"] = [{"time": times[i], "value": k[i]} for i in range(len(times)) if k[i] is not None]
            result["KDJ_D"] = [{"time": times[i], "value": d[i]} for i in range(len(times)) if d[i] is not None]
            result["KDJ_J"] = [{"time": times[i], "value": j[i]} for i in range(len(times)) if j[i] is not None]

        elif t == "MACD":
            fast, slow, signal = _macd_params(ind)
            dif, dea, hist = calc_macd(closes, fast, slow, signal)
            suffix = "" if (fast, slow, signal) == (12, 26, 9) else _macd_suffix(fast, slow, signal)
            result[f"MACD_DIF{suffix}"] = [{"time": times[i], "value": round(dif[i], 4)} for i in range(len(times)) if dif[i] is not None]
            result[f"MACD_DEA{suffix}"] = [{"time": times[i], "value": round(dea[i], 4)} for i in range(len(times)) if dea[i] is not None]
            result[f"MACD_HIST{suffix}"] = [{"time": times[i], "value": hist[i]} for i in range(len(times)) if hist[i] is not None]

        elif t == "BOLL":
            period = ind.get("period", 20)
            upper, mid, lower = calc_boll(closes, period)
            result["BOLL_UPPER"] = [{"time": times[i], "value": upper[i]} for i in range(len(times)) if upper[i] is not None]
            result["BOLL_MID"] = [{"time": times[i], "value": mid[i]} for i in range(len(times)) if mid[i] is not None]
            result["BOLL_LOWER"] = [{"time": times[i], "value": lower[i]} for i in range(len(times)) if lower[i] is not None]

    return result


# ========== 信号生成（多指标组合） ==========

def _cross_above(a: list[float | None], b: list[float | None], i: int) -> bool:
    if a[i] is None or b[i] is None or a[i-1] is None or b[i-1] is None:
        return False
    return a[i-1] <= b[i-1] and a[i] > b[i]


def _cross_below(a: list[float | None], b: list[float | None], i: int) -> bool:
    if a[i] is None or b[i] is None or a[i-1] is None or b[i-1] is None:
        return False
    return a[i-1] >= b[i-1] and a[i] < b[i]


def _gt(a: list[float | None], val: float, i: int) -> bool:
    return a[i] is not None and a[i] > val


def _lt(a: list[float | None], val: float, i: int) -> bool:
    return a[i] is not None and a[i] < val


def _flatten_groups(groups: list[list[dict]] | None) -> list[dict]:
    """Flatten OR-of-AND groups into a single list for indicator pre-computation."""
    if not groups:
        return []
    return [c for group in groups for c in group]


def _evaluate_condition_groups(groups: list[list[dict]], indicators: dict, i: int) -> bool:
    """
    OR-of-AND evaluation:
    Returns True if ANY group has ALL its conditions satisfied.
    Empty groups list → False (no signal).
    """
    if not groups:
        return False
    return any(
        all(evaluate_condition(c, indicators, i) for c in group)
        for group in groups
        if group  # skip empty inner lists
    )


def evaluate_condition(cond: dict, indicators: dict, i: int) -> bool:
    """
    评估单个条件。条件格式：
    {"type": "MA", "fast": 20, "slow": 60, "op": "cross_above"}
    {"type": "KDJ", "line": "K", "op": "cross_above", "target_line": "D"}
    {"type": "MACD", "line": "DIF", "op": "cross_above", "target_line": "DEA"}
    {"type": "RSI", "period": 14, "op": "gt", "value": 70}
    {"type": "RSI", "period": 14, "op": "lt", "value": 30}
    """
    t = cond["type"].upper()
    op = cond.get("op", "cross_above")

    if t in ("MA", "EMA"):
        fast_key = f"{t}{cond.get('fast', 20)}"
        slow_key = f"{t}{cond.get('slow', 60)}"
        a = indicators.get(fast_key, [])
        b = indicators.get(slow_key, [])
        if not a or not b or i >= len(a) or i >= len(b):
            return False
        if op == "cross_above":
            return _cross_above(a, b, i)
        elif op == "cross_below":
            return _cross_below(a, b, i)

    elif t == "KDJ":
        line_key = f"KDJ_{cond.get('line', 'K')}"
        target_key = f"KDJ_{cond.get('target_line', 'D')}"
        a = indicators.get(line_key, [])
        b = indicators.get(target_key, [])
        if not a or not b or i >= len(a) or i >= len(b):
            return False
        if op == "cross_above":
            return _cross_above(a, b, i)
        elif op == "cross_below":
            return _cross_below(a, b, i)

    elif t == "MACD":
        fast, slow, signal = _macd_params(cond)
        suffix = _macd_suffix(fast, slow, signal)
        dif = indicators.get(f"MACD_DIF{suffix}") or indicators.get("MACD_DIF", [])
        dea = indicators.get(f"MACD_DEA{suffix}") or indicators.get("MACD_DEA", [])
        if not dif or not dea or i >= len(dif) or i >= len(dea):
            return False
        if op == "cross_above":
            return _cross_above(dif, dea, i)
        elif op == "cross_below":
            return _cross_below(dif, dea, i)

    elif t == "RSI":
        key = f"RSI{cond.get('period', 14)}"
        values = indicators.get(key, [])
        if not values or i >= len(values):
            return False
        val = cond.get("value", 50)
        if op == "gt":
            return _gt(values, val, i)
        elif op == "lt":
            return _lt(values, val, i)

    elif t == "BOLL":
        closes_key = "closes"
        closes = indicators.get(closes_key, [])
        if op == "touch_lower":
            lower = indicators.get("BOLL_LOWER", [])
            if not lower or not closes or i >= len(lower) or i >= len(closes):
                return False
            return closes[i] is not None and lower[i] is not None and closes[i] <= lower[i]
        elif op == "touch_upper":
            upper = indicators.get("BOLL_UPPER", [])
            if not upper or not closes or i >= len(upper) or i >= len(closes):
                return False
            return closes[i] is not None and upper[i] is not None and closes[i] >= upper[i]

    return False


# ========== 回测主引擎 ==========

def run_backtest(
    klines: list[dict],
    entry_conditions: list[list[dict]],
    exit_conditions: list[list[dict]],
    stop_loss_pct: float,
    take_profit_pct: float,
    initial_balance: float = 10000.0,
    risk_per_trade: float = 2.0,
    leverage: int = 1,
    strategy_mode: str = "long_only",  # long_only, short_only, bidirectional
    long_entry_conditions: list[list[dict]] | None = None,
    short_entry_conditions: list[list[dict]] | None = None,
    include_trades: bool = True,
    # 兼容旧接口
    fast_period: int | None = None,
    slow_period: int | None = None,
) -> dict:
    """
    执行回测，支持多指标组合条件、杠杆和双向交易

    strategy_mode:
    - long_only: 仅做多（默认）
    - short_only: 仅做空
    - bidirectional: 双向交易（震荡策略）

    双向交易时：
    - long_entry_conditions: 做多的入场条件（如触及下轨）
    - short_entry_conditions: 做空的入场条件（如触及上轨）
    - 如果不指定，则使用 entry_conditions
    """
    if not klines:
        return _empty_result()

    closes = [k["close"] for k in klines]
    highs = [k["high"] for k in klines]
    lows = [k["low"] for k in klines]

    # 兼容旧接口：如果没有传 conditions，用 fast/slow MA 交叉
    if not entry_conditions and fast_period and slow_period:
        entry_conditions = [[{"type": "MA", "fast": fast_period, "slow": slow_period, "op": "cross_above"}]]
        exit_conditions = [[{"type": "MA", "fast": fast_period, "slow": slow_period, "op": "cross_below"}]]

    # 双向交易：如果没有单独指定做多/做空条件，使用通用条件
    if strategy_mode == "bidirectional":
        if long_entry_conditions is None:
            long_entry_conditions = entry_conditions
        if short_entry_conditions is None:
            short_entry_conditions = exit_conditions if exit_conditions else entry_conditions

    # 预计算所有需要的指标（将 OR-of-AND 嵌套结构展平后去重计算）
    all_flat = (
        _flatten_groups(entry_conditions)
        + _flatten_groups(exit_conditions)
        + _flatten_groups(long_entry_conditions)
        + _flatten_groups(short_entry_conditions)
    )
    indicator_data = _precompute_indicators(closes, highs, lows, all_flat)
    # 添加收盘价到指标数据（用于布林带判断）
    indicator_data["closes"] = closes

    if strategy_mode == "bidirectional":
        return _run_bidirectional_backtest(
            klines, indicator_data, long_entry_conditions, short_entry_conditions,
            stop_loss_pct, take_profit_pct, initial_balance, risk_per_trade, leverage,
            include_trades=include_trades,
        )
    else:
        return _run_unidirectional_backtest(
            klines, indicator_data, entry_conditions, exit_conditions,
            stop_loss_pct, take_profit_pct, initial_balance, risk_per_trade, leverage,
            side="LONG" if strategy_mode == "long_only" else "SHORT",
            include_trades=include_trades,
        )


def _calculate_margin_base(
    balance: float,
    entry_price: float,
    stop_loss_pct: float,
    risk_per_trade: float,
    scale: float = 1.0,
) -> float:
    """
    Calculate the 1x position value implied by the stop distance.

    Leveraged PnL is applied against this base value later so that total_return
    changes with leverage, while stop_loss_pct / take_profit_pct still express
    underlying price move thresholds.
    """
    if entry_price <= 0 or stop_loss_pct <= 0 or risk_per_trade <= 0 or scale <= 0:
        return 0.0

    sl_distance = entry_price * (stop_loss_pct / 100)
    max_loss = balance * (risk_per_trade / 100)
    position_qty = max_loss / sl_distance if sl_distance > 0 else 0.0
    return position_qty * entry_price * scale


def _run_unidirectional_backtest(
    klines, indicator_data, entry_conditions, exit_conditions,
    stop_loss_pct, take_profit_pct, initial_balance, risk_per_trade, leverage, side,
    include_trades: bool = True,
):
    """单向交易回测（仅做多或仅做空）"""
    trades = []
    balance = initial_balance
    peak_balance = initial_balance
    max_drawdown = 0.0
    in_position = False
    entry_price = 0.0
    entry_time = ""
    margin = 0.0

    for i in range(1, len(klines)):
        if not in_position:
            all_met = _evaluate_condition_groups(entry_conditions, indicator_data, i)
            if all_met:
                entry_price = klines[i]["close"]
                entry_time = datetime.fromtimestamp(klines[i]["time"] / 1000).strftime("%Y-%m-%d %H:%M")
                margin = _calculate_margin_base(
                    balance=balance,
                    entry_price=entry_price,
                    stop_loss_pct=stop_loss_pct,
                    risk_per_trade=risk_per_trade,
                )
                if margin <= 0:
                    continue
                in_position = True
                continue

        if in_position:
            current_price = klines[i]["close"]
            # 做空时收益计算相反
            if side == "SHORT":
                pnl_pct = ((entry_price - current_price) / entry_price) * 100 * leverage
            else:
                pnl_pct = ((current_price - entry_price) / entry_price) * 100 * leverage

            should_exit = False
            # 爆仓检测
            if pnl_pct <= -100:
                should_exit = True
                pnl_pct = -100
            elif pnl_pct <= -stop_loss_pct * leverage:
                should_exit = True
            elif pnl_pct >= take_profit_pct * leverage:
                should_exit = True
            elif _evaluate_condition_groups(exit_conditions, indicator_data, i):
                should_exit = True

            if should_exit:
                pnl = margin * (pnl_pct / 100)
                balance += pnl
                exit_time = datetime.fromtimestamp(klines[i]["time"] / 1000).strftime("%Y-%m-%d %H:%M")
                entry_dt = datetime.strptime(entry_time, "%Y-%m-%d %H:%M")
                exit_dt = datetime.strptime(exit_time, "%Y-%m-%d %H:%M")
                duration_hours = (exit_dt - entry_dt).total_seconds() / 3600

                trades.append({
                    "entry_time": entry_time, "exit_time": exit_time, "side": side,
                    "entry_price": round(entry_price, 2), "exit_price": round(current_price, 2),
                    "pnl": round(pnl, 2), "pnl_pct": round(pnl_pct, 2),
                    "duration": f"{duration_hours:.1f}h",
                })

                if balance > peak_balance:
                    peak_balance = balance
                dd = ((peak_balance - balance) / peak_balance) * 100
                if dd > max_drawdown:
                    max_drawdown = dd
                in_position = False

    return _calc_stats(trades, balance, initial_balance, max_drawdown, include_trades)


def _run_bidirectional_backtest(
    klines, indicator_data, long_entry_conditions, short_entry_conditions,
    stop_loss_pct, take_profit_pct, initial_balance, risk_per_trade, leverage,
    include_trades: bool = True,
):
    """
    双向交易回测（震荡策略）

    支持两种模式：
    1. 分别指定做多/做空条件
    2. 使用布林带自动双向交易（触及下轨做多，触及上轨做空）
    """
    trades = []
    balance = initial_balance
    peak_balance = initial_balance
    max_drawdown = 0.0

    # 持仓状态
    long_position = None  # {"entry_price": float, "entry_time": str, "margin": float}
    short_position = None

    # 检查是否为布林带自动双向模式
    auto_boll_mode = _is_boll_bidirectional_mode(long_entry_conditions, short_entry_conditions)

    for i in range(1, len(klines)):
        current_price = klines[i]["close"]
        current_time = datetime.fromtimestamp(klines[i]["time"] / 1000).strftime("%Y-%m-%d %H:%M")

        # 自动布林带双向模式
        if auto_boll_mode:
            # 检查布林带信号
            boll_signal = _check_boll_signal(indicator_data, current_price, i)

            # 触及下轨 → 做多
            if long_position is None and boll_signal == "touch_lower":
                long_signal = True
            else:
                long_signal = False

            # 触及上轨 → 做空
            if short_position is None and boll_signal == "touch_upper":
                short_signal = True
            else:
                short_signal = False
        else:
            # 手动指定条件模式
            long_signal = long_position is None and _evaluate_condition_groups(long_entry_conditions, indicator_data, i)
            short_signal = short_position is None and _evaluate_condition_groups(short_entry_conditions, indicator_data, i)

        # 检查是否触发做多
        if long_position is None and long_signal:
                margin = _calculate_margin_base(
                    balance=balance,
                    entry_price=current_price,
                    stop_loss_pct=stop_loss_pct,
                    risk_per_trade=risk_per_trade,
                    scale=0.5,
                )
                if margin <= 0:
                    continue
                long_position = {
                    "entry_price": current_price,
                    "entry_time": current_time,
                    "margin": margin
                }

        # 检查是否触发做空
        if short_position is None and short_signal:
                margin = _calculate_margin_base(
                    balance=balance,
                    entry_price=current_price,
                    stop_loss_pct=stop_loss_pct,
                    risk_per_trade=risk_per_trade,
                    scale=0.5,
                )
                if margin <= 0:
                    continue
                short_position = {
                    "entry_price": current_price,
                    "entry_time": current_time,
                    "margin": margin
                }

        # 检查做多仓位是否需要平仓
        if long_position:
            entry_price = long_position["entry_price"]
            pnl_pct = ((current_price - entry_price) / entry_price) * 100 * leverage

            should_exit = False
            if pnl_pct <= -100 or pnl_pct <= -stop_loss_pct * leverage:
                should_exit = True
            elif pnl_pct >= take_profit_pct * leverage:
                should_exit = True
            # 价格回归中轨也平仓（震荡策略特点）
            elif _check_boll_middle_cross(indicator_data, current_price, i):
                should_exit = True

            if should_exit:
                pnl = long_position["margin"] * (pnl_pct / 100)
                balance += pnl
                entry_dt = datetime.strptime(long_position["entry_time"], "%Y-%m-%d %H:%M")
                exit_dt = datetime.strptime(current_time, "%Y-%m-%d %H:%M")
                duration_hours = (exit_dt - entry_dt).total_seconds() / 3600

                trades.append({
                    "entry_time": long_position["entry_time"],
                    "exit_time": current_time,
                    "side": "LONG",
                    "entry_price": round(entry_price, 2),
                    "exit_price": round(current_price, 2),
                    "pnl": round(pnl, 2),
                    "pnl_pct": round(pnl_pct, 2),
                    "duration": f"{duration_hours:.1f}h",
                })

                if balance > peak_balance:
                    peak_balance = balance
                dd = ((peak_balance - balance) / peak_balance) * 100
                if dd > max_drawdown:
                    max_drawdown = dd
                long_position = None

        # 检查做空仓位是否需要平仓
        if short_position:
            entry_price = short_position["entry_price"]
            pnl_pct = ((entry_price - current_price) / entry_price) * 100 * leverage

            should_exit = False
            if pnl_pct <= -100 or pnl_pct <= -stop_loss_pct * leverage:
                should_exit = True
            elif pnl_pct >= take_profit_pct * leverage:
                should_exit = True
            elif _check_boll_middle_cross(indicator_data, current_price, i):
                should_exit = True

            if should_exit:
                pnl = short_position["margin"] * (pnl_pct / 100)
                balance += pnl
                entry_dt = datetime.strptime(short_position["entry_time"], "%Y-%m-%d %H:%M")
                exit_dt = datetime.strptime(current_time, "%Y-%m-%d %H:%M")
                duration_hours = (exit_dt - entry_dt).total_seconds() / 3600

                trades.append({
                    "entry_time": short_position["entry_time"],
                    "exit_time": current_time,
                    "side": "SHORT",
                    "entry_price": round(entry_price, 2),
                    "exit_price": round(current_price, 2),
                    "pnl": round(pnl, 2),
                    "pnl_pct": round(pnl_pct, 2),
                    "duration": f"{duration_hours:.1f}h",
                })

                if balance > peak_balance:
                    peak_balance = balance
                dd = ((peak_balance - balance) / peak_balance) * 100
                if dd > max_drawdown:
                    max_drawdown = dd
                short_position = None

    return _calc_stats(trades, balance, initial_balance, max_drawdown, include_trades)


def _check_boll_middle_cross(indicator_data, current_price, i):
    """检查价格是否接近布林带中轨"""
    boll_mid = indicator_data.get("BOLL_MID", [])
    if not boll_mid or i >= len(boll_mid) or boll_mid[i] is None:
        return False
    # 价格在中轨±0.2%范围内认为触及中轨
    mid_value = boll_mid[i]
    return abs((current_price - mid_value) / mid_value) < 0.002


def _is_boll_bidirectional_mode(long_entry_conditions, short_entry_conditions):
    """
    检查是否为布林带自动双向模式
    当两个条件都只有一个BOLL条件，且分别是touch_lower和touch_upper时，启用自动模式
    """
    if not long_entry_conditions or not short_entry_conditions:
        return False
    if len(long_entry_conditions) != 1 or len(short_entry_conditions) != 1:
        return False

    long_cond = long_entry_conditions[0]
    short_cond = short_entry_conditions[0]

    # 检查是否都是BOLL类型
    if long_cond.get("type", "").upper() != "BOLL" or short_cond.get("type", "").upper() != "BOLL":
        return False

    # 检查操作类型
    if long_cond.get("op") == "touch_lower" and short_cond.get("op") == "touch_upper":
        return True

    return False


def _check_boll_signal(indicator_data, current_price, i):
    """
    检查布林带信号
    返回: "touch_lower", "touch_upper", "middle", None
    """
    boll_upper = indicator_data.get("BOLL_UPPER", [])
    boll_lower = indicator_data.get("BOLL_LOWER", [])
    boll_mid = indicator_data.get("BOLL_MID", [])

    if not boll_upper or not boll_lower or i >= len(boll_upper) or i >= len(boll_lower):
        return None

    upper = boll_upper[i]
    lower = boll_lower[i]
    mid = boll_mid[i] if boll_mid and i < len(boll_mid) else None

    if upper is None or lower is None:
        return None

    # 触及下轨（价格 <= 下轨 * 1.002，允许0.2%误差）
    if current_price <= lower * 1.002:
        return "touch_lower"

    # 触及上轨（价格 >= 上轨 * 0.998）
    if current_price >= upper * 0.998:
        return "touch_upper"

    # 接近中轨
    if mid and abs((current_price - mid) / mid) < 0.002:
        return "middle"

    return None


def _precompute_indicators(closes, highs, lows, conditions):
    """根据条件列表预计算所有需要的指标"""
    data: dict[str, list] = {"closes": closes}
    needed = set()

    for c in conditions:
        t = c["type"].upper()
        if t in ("MA", "EMA"):
            needed.add((t, c.get("fast", 20)))
            needed.add((t, c.get("slow", 60)))
        elif t == "KDJ":
            needed.add(("KDJ", c.get("n", 9)))
        elif t == "MACD":
            needed.add(("MACD", _macd_params(c)))
        elif t == "RSI":
            needed.add(("RSI", c.get("period", 14)))
        elif t == "BOLL":
            needed.add(("BOLL", c.get("period", 20)))

    for indicator_type, param in needed:
        if indicator_type == "MA":
            data[f"MA{param}"] = calc_ma(closes, param)
        elif indicator_type == "EMA":
            data[f"EMA{param}"] = calc_ema(closes, param)
        elif indicator_type == "KDJ":
            k, d, j = calc_kdj(highs, lows, closes, param)
            data["KDJ_K"] = k
            data["KDJ_D"] = d
            data["KDJ_J"] = j
        elif indicator_type == "MACD":
            fast, slow, signal = param
            dif, dea, hist = calc_macd(closes, fast, slow, signal)
            suffix = _macd_suffix(fast, slow, signal)
            data[f"MACD_DIF{suffix}"] = dif
            data[f"MACD_DEA{suffix}"] = dea
            data[f"MACD_HIST{suffix}"] = hist
            if (fast, slow, signal) == (12, 26, 9):
                data["MACD_DIF"] = dif
                data["MACD_DEA"] = dea
                data["MACD_HIST"] = hist
        elif indicator_type == "RSI":
            data[f"RSI{param}"] = calc_rsi(closes, param)
        elif indicator_type == "BOLL":
            upper, mid, lower = calc_boll(closes, param)
            data["BOLL_UPPER"] = upper
            data["BOLL_MID"] = mid
            data["BOLL_LOWER"] = lower

    return data


def _empty_result(initial_balance: float = 10000.0):
    return {
        "total_return_pct": 0.0, "final_balance": initial_balance,
        "win_rate": 0, "profit_factor": 0,
        "max_drawdown": 0, "sharpe_ratio": 0, "calmar_ratio": 0,
        "total_trades": 0, "avg_holding_hours": 0, "trades": [],
    }


def _calc_stats(trades, balance, initial_balance, max_drawdown, include_trades: bool = True):
    if not trades:
        return _empty_result(initial_balance)

    wins = [t for t in trades if t["pnl"] > 0]
    losses = [t for t in trades if t["pnl"] <= 0]
    total_profit = sum(t["pnl"] for t in wins)
    total_loss = abs(sum(t["pnl"] for t in losses))

    returns = [t["pnl_pct"] for t in trades]
    avg_return = sum(returns) / len(returns)
    std_return = math.sqrt(sum((r - avg_return) ** 2 for r in returns) / len(returns)) if len(returns) > 1 else 1

    total_return_pct = round(((balance - initial_balance) / initial_balance) * 100, 2)
    max_drawdown_r = round(max_drawdown, 2)
    calmar = round(total_return_pct / max_drawdown_r, 2) if max_drawdown_r > 0 else 0.0

    return {
        "total_return_pct": total_return_pct,
        "final_balance": round(balance, 2),
        "win_rate": round(len(wins) / len(trades) * 100, 1),
        "profit_factor": round(total_profit / total_loss, 2) if total_loss > 0 else 0,
        "max_drawdown": max_drawdown_r,
        "sharpe_ratio": round(avg_return / std_return, 2) if std_return > 0 else 0,
        "calmar_ratio": calmar,
        "total_trades": len(trades),
        "avg_holding_hours": round(sum(float(t["duration"].rstrip("h")) for t in trades) / len(trades), 1),
        "trades": trades if include_trades else [],
    }
