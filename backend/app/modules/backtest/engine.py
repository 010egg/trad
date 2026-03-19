"""
回测引擎核心逻辑 + 技术指标计算库
支持指标：MA, EMA, KDJ, MACD, RSI, BOLL
"""

import math
from datetime import datetime

import httpx

BINANCE_BASE_URL = "https://api.binance.com"


# ========== 数据获取 ==========

async def fetch_historical_klines(symbol: str, interval: str, start_date: str, end_date: str) -> list[dict]:
    """获取历史 K 线数据"""
    start_ts = int(datetime.strptime(start_date, "%Y-%m-%d").timestamp() * 1000)
    end_ts = int(datetime.strptime(end_date, "%Y-%m-%d").timestamp() * 1000)

    all_klines = []
    current_start = start_ts

    async with httpx.AsyncClient() as client:
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

            for k in raw:
                all_klines.append({
                    "time": int(k[0]),
                    "open": float(k[1]),
                    "high": float(k[2]),
                    "low": float(k[3]),
                    "close": float(k[4]),
                    "volume": float(k[5]),
                })

            current_start = int(raw[-1][0]) + 1

    return all_klines


# ========== 技术指标计算 ==========

def calc_ma(closes: list[float], period: int) -> list[float | None]:
    """简单移动平均线 (SMA)"""
    result = []
    for i in range(len(closes)):
        if i < period - 1:
            result.append(None)
        else:
            result.append(sum(closes[i - period + 1:i + 1]) / period)
    return result


def calc_ema(closes: list[float], period: int) -> list[float | None]:
    """指数移动平均线 (EMA)"""
    result: list[float | None] = [None] * (period - 1)
    multiplier = 2.0 / (period + 1)
    # 初始值用 SMA
    sma = sum(closes[:period]) / period
    result.append(sma)
    for i in range(period, len(closes)):
        prev = result[-1]
        assert prev is not None
        ema = (closes[i] - prev) * multiplier + prev
        result.append(ema)
    return result


def calc_rsi(closes: list[float], period: int = 14) -> list[float | None]:
    """相对强弱指标 (RSI)"""
    result: list[float | None] = [None] * period
    gains = []
    losses = []
    for i in range(1, len(closes)):
        diff = closes[i] - closes[i - 1]
        gains.append(max(diff, 0))
        losses.append(max(-diff, 0))

    if len(gains) < period:
        return [None] * len(closes)

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    if avg_loss == 0:
        result.append(100.0)
    else:
        rs = avg_gain / avg_loss
        result.append(100 - 100 / (1 + rs))

    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        if avg_loss == 0:
            result.append(100.0)
        else:
            rs = avg_gain / avg_loss
            result.append(100 - 100 / (1 + rs))

    return result


def calc_kdj(highs: list[float], lows: list[float], closes: list[float], n: int = 9, m1: int = 3, m2: int = 3) -> tuple[list[float | None], list[float | None], list[float | None]]:
    """KDJ 随机指标"""
    k_values: list[float | None] = []
    d_values: list[float | None] = []
    j_values: list[float | None] = []
    prev_k = 50.0
    prev_d = 50.0

    for i in range(len(closes)):
        if i < n - 1:
            k_values.append(None)
            d_values.append(None)
            j_values.append(None)
            continue

        highest = max(highs[i - n + 1:i + 1])
        lowest = min(lows[i - n + 1:i + 1])

        if highest == lowest:
            rsv = 50.0
        else:
            rsv = (closes[i] - lowest) / (highest - lowest) * 100

        k = (m1 - 1) / m1 * prev_k + 1 / m1 * rsv
        d = (m2 - 1) / m2 * prev_d + 1 / m2 * k
        j = 3 * k - 2 * d

        k_values.append(round(k, 2))
        d_values.append(round(d, 2))
        j_values.append(round(j, 2))
        prev_k = k
        prev_d = d

    return k_values, d_values, j_values


def calc_macd(closes: list[float], fast: int = 12, slow: int = 26, signal: int = 9) -> tuple[list[float | None], list[float | None], list[float | None]]:
    """MACD 指标，返回 (DIF, DEA, MACD柱)"""
    ema_fast = calc_ema(closes, fast)
    ema_slow = calc_ema(closes, slow)

    dif: list[float | None] = []
    for i in range(len(closes)):
        if ema_fast[i] is None or ema_slow[i] is None:
            dif.append(None)
        else:
            dif.append(ema_fast[i] - ema_slow[i])

    # DEA = EMA(DIF, signal)
    dif_values = [v for v in dif if v is not None]
    if len(dif_values) < signal:
        return dif, [None] * len(closes), [None] * len(closes)

    dea_raw = calc_ema(dif_values, signal)
    # 对齐回原始长度
    offset = len(closes) - len(dif_values)
    dea: list[float | None] = [None] * offset
    dea.extend(dea_raw)

    macd_hist: list[float | None] = []
    for i in range(len(closes)):
        if dif[i] is not None and dea[i] is not None:
            macd_hist.append(round((dif[i] - dea[i]) * 2, 4))
        else:
            macd_hist.append(None)

    return dif, dea, macd_hist


def calc_boll(closes: list[float], period: int = 20, std_dev: float = 2.0) -> tuple[list[float | None], list[float | None], list[float | None]]:
    """布林带 (BOLL)，返回 (上轨, 中轨, 下轨)"""
    upper: list[float | None] = []
    middle: list[float | None] = []
    lower: list[float | None] = []

    for i in range(len(closes)):
        if i < period - 1:
            upper.append(None)
            middle.append(None)
            lower.append(None)
        else:
            window = closes[i - period + 1:i + 1]
            ma = sum(window) / period
            variance = sum((x - ma) ** 2 for x in window) / period
            std = math.sqrt(variance)
            middle.append(round(ma, 2))
            upper.append(round(ma + std_dev * std, 2))
            lower.append(round(ma - std_dev * std, 2))

    return upper, middle, lower


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
            fast = ind.get("fast", 12)
            slow = ind.get("slow", 26)
            signal = ind.get("signal", 9)
            dif, dea, hist = calc_macd(closes, fast, slow, signal)
            result["MACD_DIF"] = [{"time": times[i], "value": round(dif[i], 4)} for i in range(len(times)) if dif[i] is not None]
            result["MACD_DEA"] = [{"time": times[i], "value": round(dea[i], 4)} for i in range(len(times)) if dea[i] is not None]
            result["MACD_HIST"] = [{"time": times[i], "value": hist[i]} for i in range(len(times)) if hist[i] is not None]

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
        dif = indicators.get("MACD_DIF", [])
        dea = indicators.get("MACD_DEA", [])
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
    entry_conditions: list[dict],
    exit_conditions: list[dict],
    stop_loss_pct: float,
    take_profit_pct: float,
    initial_balance: float = 10000.0,
    risk_per_trade: float = 2.0,
    leverage: int = 1,
    strategy_mode: str = "long_only",  # long_only, short_only, bidirectional
    long_entry_conditions: list[dict] | None = None,  # 做多入场条件
    short_entry_conditions: list[dict] | None = None,  # 做空入场条件
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
        entry_conditions = [{"type": "MA", "fast": fast_period, "slow": slow_period, "op": "cross_above"}]
        exit_conditions = [{"type": "MA", "fast": fast_period, "slow": slow_period, "op": "cross_below"}]

    # 双向交易：如果没有单独指定做多/做空条件，使用通用条件
    if strategy_mode == "bidirectional":
        if long_entry_conditions is None:
            long_entry_conditions = entry_conditions
        if short_entry_conditions is None:
            short_entry_conditions = exit_conditions if exit_conditions else entry_conditions

    # 预计算所有需要的指标
    all_conditions = entry_conditions + exit_conditions
    if long_entry_conditions:
        all_conditions += long_entry_conditions
    if short_entry_conditions:
        all_conditions += short_entry_conditions

    indicator_data = _precompute_indicators(closes, highs, lows, all_conditions)
    # 添加收盘价到指标数据（用于布林带判断）
    indicator_data["closes"] = closes

    if strategy_mode == "bidirectional":
        return _run_bidirectional_backtest(
            klines, indicator_data, long_entry_conditions, short_entry_conditions,
            stop_loss_pct, take_profit_pct, initial_balance, risk_per_trade, leverage
        )
    else:
        return _run_unidirectional_backtest(
            klines, indicator_data, entry_conditions, exit_conditions,
            stop_loss_pct, take_profit_pct, initial_balance, risk_per_trade, leverage,
            side="LONG" if strategy_mode == "long_only" else "SHORT"
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
    stop_loss_pct, take_profit_pct, initial_balance, risk_per_trade, leverage, side
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
            all_met = entry_conditions and all(evaluate_condition(c, indicator_data, i) for c in entry_conditions)
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
            elif exit_conditions and any(evaluate_condition(c, indicator_data, i) for c in exit_conditions):
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

    return _calc_stats(trades, balance, initial_balance, max_drawdown)


def _run_bidirectional_backtest(
    klines, indicator_data, long_entry_conditions, short_entry_conditions,
    stop_loss_pct, take_profit_pct, initial_balance, risk_per_trade, leverage
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
            long_signal = long_position is None and long_entry_conditions and all(
                evaluate_condition(c, indicator_data, i) for c in long_entry_conditions
            )
            short_signal = short_position is None and short_entry_conditions and all(
                evaluate_condition(c, indicator_data, i) for c in short_entry_conditions
            )

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

    return _calc_stats(trades, balance, initial_balance, max_drawdown)


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
            needed.add(("MACD", 0))
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
            dif, dea, hist = calc_macd(closes)
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


def _empty_result():
    return {
        "total_return": 0, "win_rate": 0, "profit_factor": 0,
        "max_drawdown": 0, "sharpe_ratio": 0, "total_trades": 0,
        "avg_holding_hours": 0, "trades": [],
    }


def _calc_stats(trades, balance, initial_balance, max_drawdown):
    if not trades:
        return _empty_result()

    wins = [t for t in trades if t["pnl"] > 0]
    losses = [t for t in trades if t["pnl"] <= 0]
    total_profit = sum(t["pnl"] for t in wins)
    total_loss = abs(sum(t["pnl"] for t in losses))

    returns = [t["pnl_pct"] for t in trades]
    avg_return = sum(returns) / len(returns)
    std_return = math.sqrt(sum((r - avg_return) ** 2 for r in returns) / len(returns)) if len(returns) > 1 else 1

    return {
        "total_return": round(((balance - initial_balance) / initial_balance) * 100, 2),
        "win_rate": round(len(wins) / len(trades) * 100, 1),
        "profit_factor": round(total_profit / total_loss, 2) if total_loss > 0 else 0,
        "max_drawdown": round(max_drawdown, 2),
        "sharpe_ratio": round(avg_return / std_return, 2) if std_return > 0 else 0,
        "total_trades": len(trades),
        "avg_holding_hours": round(sum(float(t["duration"].rstrip("h")) for t in trades) / len(trades), 1),
        "trades": trades,
    }
