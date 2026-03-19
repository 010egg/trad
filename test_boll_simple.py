#!/usr/bin/env python3
"""
测试简化的布林带双向策略
一个配置，自动做多做空
"""

import requests
import json
from datetime import datetime, timedelta

API_BASE = "http://localhost:8000/api/v1"

def login():
    """登录获取 token"""
    resp = requests.post(f"{API_BASE}/auth/login", json={
        "username": "test",
        "password": "test123456"
    }, proxies={"http": None, "https": None})

    if resp.status_code == 200:
        data = resp.json()
        return data["data"]["access_token"]
    else:
        print("❌ 登录失败，请先注册用户 test/test123456")
        return None

def run_simple_boll_backtest(token):
    """运行简化的布林带策略"""
    headers = {"Authorization": f"Bearer {token}"}

    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")

    # 简化配置：系统自动识别双向交易
    payload = {
        "symbol": "BTCUSDT",
        "interval": "15m",
        "start_date": start_date,
        "end_date": end_date,
        "strategy_mode": "bidirectional",

        # 做多条件：触及下轨
        "long_entry_conditions": [
            {"type": "BOLL", "op": "touch_lower", "period": 20}
        ],

        # 做空条件：触及上轨
        "short_entry_conditions": [
            {"type": "BOLL", "op": "touch_upper", "period": 20}
        ],

        "stop_loss_pct": 3.0,
        "take_profit_pct": 5.0,
        "risk_per_trade": 2.0,
        "leverage": 1,
        "name": "布林带双向策略（自动模式）"
    }

    print("=" * 100)
    print("🎯 布林带双向策略回测")
    print("=" * 100)
    print(f"📅 回测期间: {start_date} 至 {end_date}")
    print(f"📊 交易对: BTCUSDT (15分钟)")
    print(f"💡 策略逻辑:")
    print(f"   📉 触及下轨 → 自动做多")
    print(f"   📈 触及上轨 → 自动做空")
    print(f"   🎯 回到中轨 → 自动平仓")
    print("-" * 100)

    resp = requests.post(
        f"{API_BASE}/backtest/run",
        json=payload,
        headers=headers,
        proxies={"http": None, "https": None},
        timeout=60
    )

    if resp.status_code == 200:
        result = resp.json()["data"]
        print_results(result)
    else:
        print(f"❌ 回测失败: {resp.text}")

def print_results(result):
    """打印回测结果"""
    print("\n✅ 回测完成！\n")
    print("📈 绩效指标:")
    print(f"  总收益率:        {result['total_return']:>8.2f}%")
    print(f"  胜率:            {result['win_rate']:>8.1f}%")
    print(f"  盈亏比:          {result['profit_factor']:>8.2f}")
    print(f"  最大回撤:        {result['max_drawdown']:>8.2f}%")
    print(f"  夏普比率:        {result['sharpe_ratio']:>8.2f}")
    print(f"  总交易次数:      {result['total_trades']:>8d}")
    print(f"  平均持仓时长:    {result['avg_holding_hours']:>8.1f}小时")

    trades = result.get("trades", [])
    if trades:
        long_trades = [t for t in trades if t["side"] == "LONG"]
        short_trades = [t for t in trades if t["side"] == "SHORT"]

        print(f"\n💼 交易统计:")
        print(f"  🟢 做多交易: {len(long_trades)} 笔")
        print(f"  🔴 做空交易: {len(short_trades)} 笔")

        if long_trades:
            long_profit = sum(t["pnl"] for t in long_trades)
            long_wins = len([t for t in long_trades if t["pnl"] > 0])
            print(f"\n  做多统计:")
            print(f"    总盈亏: ${long_profit:.2f}")
            print(f"    胜率: {long_wins/len(long_trades)*100:.1f}%")

        if short_trades:
            short_profit = sum(t["pnl"] for t in short_trades)
            short_wins = len([t for t in short_trades if t["pnl"] > 0])
            print(f"\n  做空统计:")
            print(f"    总盈亏: ${short_profit:.2f}")
            print(f"    胜率: {short_wins/len(short_trades)*100:.1f}%")

        print(f"\n📋 最近5笔交易:")
        print("-" * 100)
        for i, t in enumerate(trades[-5:], 1):
            side_emoji = "🟢" if t["side"] == "LONG" else "🔴"
            pnl_sign = "+" if t["pnl"] > 0 else ""
            print(f"{i}. {side_emoji} {t['side']:<5} | "
                  f"{t['entry_time']:<16} → {t['exit_time']:<16} | "
                  f"${t['entry_price']:<8.2f} → ${t['exit_price']:<8.2f} | "
                  f"{pnl_sign}{t['pnl_pct']:>6.2f}% ({pnl_sign}${t['pnl']:.2f})")

    print("\n" + "=" * 100)

if __name__ == "__main__":
    token = login()
    if token:
        run_simple_boll_backtest(token)
    else:
        print("\n请先访问 http://localhost:5173 注册用户 test/test123456")
