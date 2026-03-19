#!/usr/bin/env python3
"""
测试震荡策略回测功能
布林带双向交易：逢低做多，逢高做空
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
        print("❌ 登录失败，请先注册用户")
        print("提示：访问 http://localhost:5173 注册用户 test/test123456")
        return None

def run_oscillation_backtest(token):
    """运行震荡策略回测"""
    headers = {"Authorization": f"Bearer {token}"}

    # 使用最近30天的数据
    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")

    payload = {
        "symbol": "BTCUSDT",
        "interval": "15m",
        "start_date": start_date,
        "end_date": end_date,
        "strategy_mode": "bidirectional",  # 双向交易
        "long_entry_conditions": [  # 做多入场条件
            {
                "type": "BOLL",
                "op": "touch_lower",
                "period": 20
            }
        ],
        "short_entry_conditions": [  # 做空入场条件
            {
                "type": "BOLL",
                "op": "touch_upper",
                "period": 20
            }
        ],
        "stop_loss_pct": 3.0,
        "take_profit_pct": 5.0,
        "risk_per_trade": 2.0,
        "leverage": 1,
        "name": "布林带震荡策略测试"
    }

    print("🚀 开始回测...")
    print(f"📅 回测期间: {start_date} 至 {end_date}")
    print(f"📊 交易对: BTCUSDT")
    print(f"⏱️  时间周期: 15分钟")
    print(f"💡 策略: 布林带(20)双向交易")
    print("-" * 60)

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
        return True
    else:
        print(f"❌ 回测失败: {resp.text}")
        return False

def print_results(result):
    """打印回测结果"""
    print("✅ 回测完成！\n")

    print("📈 绩效指标:")
    print(f"  总收益率:     {result['total_return']:>8.2f}%")
    print(f"  胜率:         {result['win_rate']:>8.1f}%")
    print(f"  盈亏比:       {result['profit_factor']:>8.2f}")
    print(f"  最大回撤:     {result['max_drawdown']:>8.2f}%")
    print(f"  夏普比率:     {result['sharpe_ratio']:>8.2f}")
    print(f"  总交易次数:   {result['total_trades']:>8d}")
    print(f"  平均持仓时长: {result['avg_holding_hours']:>8.1f}小时")

    trades = result.get("trades", [])
    if trades:
        print(f"\n💼 交易明细（共 {len(trades)} 笔）:")
        print("-" * 100)
        print(f"{'入场时间':<20} {'平仓时间':<20} {'方向':<6} {'入场价':<10} {'平仓价':<10} {'盈亏%':<10} {'盈亏$':<10}")
        print("-" * 100)

        long_trades = [t for t in trades if t["side"] == "LONG"]
        short_trades = [t for t in trades if t["side"] == "SHORT"]

        print(f"\n🟢 做多交易 ({len(long_trades)} 笔):")
        for t in long_trades[:5]:  # 只显示前5笔
            print(f"{t['entry_time']:<20} {t['exit_time']:<20} {t['side']:<6} "
                  f"{t['entry_price']:<10.2f} {t['exit_price']:<10.2f} "
                  f"{t['pnl_pct']:>8.2f}% {t['pnl']:>8.2f}")

        if len(long_trades) > 5:
            print(f"  ... 还有 {len(long_trades) - 5} 笔交易")

        print(f"\n🔴 做空交易 ({len(short_trades)} 笔):")
        for t in short_trades[:5]:  # 只显示前5笔
            print(f"{t['entry_time']:<20} {t['exit_time']:<20} {t['side']:<6} "
                  f"{t['entry_price']:<10.2f} {t['exit_price']:<10.2f} "
                  f"{t['pnl_pct']:>8.2f}% {t['pnl']:>8.2f}")

        if len(short_trades) > 5:
            print(f"  ... 还有 {len(short_trades) - 5} 笔交易")

    print("\n" + "=" * 100)
    print("💡 提示: 访问 http://localhost:5173 查看完整的回测报告和图表")
    print("=" * 100)

if __name__ == "__main__":
    print("=" * 100)
    print("🎯 震荡策略回测工具")
    print("=" * 100)

    token = login()
    if token:
        run_oscillation_backtest(token)
    else:
        print("\n请先创建测试账户:")
        print("1. 访问 http://localhost:5173")
        print("2. 注册账户: test / test123456")
        print("3. 重新运行此脚本")
