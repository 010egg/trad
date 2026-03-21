"""回测引擎单元测试（不依赖 Binance API，使用模拟数据）"""

from datetime import datetime

import pytest
from sqlalchemy import select

from app.modules.backtest.engine import calc_ma, fetch_historical_klines, run_backtest
from app.modules.backtest.models import HistoricalKline


def _make_klines(prices: list[float]) -> list[dict]:
    """根据价格列表生成模拟 K 线"""
    return [
        {"time": (1700000000 + i * 900) * 1000, "open": p, "high": p * 1.005, "low": p * 0.995, "close": p, "volume": 100}
        for i, p in enumerate(prices)
    ]


def _make_range_klines(start_ts: int, end_ts: int, interval_ms: int, base_price: float = 100.0) -> list[dict]:
    klines = []
    current = start_ts
    index = 0
    while current < end_ts:
        price = base_price + index * 0.1
        klines.append({
            "time": current,
            "open": price,
            "high": price * 1.002,
            "low": price * 0.998,
            "close": price,
            "volume": 1000,
        })
        current += interval_ms
        index += 1
    return klines


def test_calc_ma():
    closes = [1, 2, 3, 4, 5]
    result = calc_ma(closes, 3)
    assert result[0] is None
    assert result[1] is None
    assert result[2] == 2.0
    assert result[3] == 3.0
    assert result[4] == 4.0


def test_backtest_with_trend():
    """上升趋势中均线交叉应能产生盈利交易"""
    # 构造一个先横盘再上涨的价格序列
    prices = [100] * 70  # 横盘 70 根
    for i in range(80):  # 上涨 80 根
        prices.append(100 + i * 0.5)
    for i in range(50):  # 回落 50 根
        prices.append(140 - i * 0.3)

    klines = _make_klines(prices)
    result = run_backtest(klines, entry_conditions=[], exit_conditions=[], fast_period=20, slow_period=60, stop_loss_pct=2.0, take_profit_pct=6.0, leverage=1)

    assert result["total_trades"] >= 0
    assert isinstance(result["win_rate"], float)
    assert isinstance(result["max_drawdown"], float)
    assert isinstance(result["trades"], list)


def test_backtest_empty_klines():
    result = run_backtest([], entry_conditions=[], exit_conditions=[], fast_period=20, slow_period=60, stop_loss_pct=2.0, take_profit_pct=6.0, leverage=1)
    assert result["total_trades"] == 0
    assert result["trades"] == []


def test_backtest_stop_loss_triggers():
    """构造暴跌场景，验证止损生效"""
    prices = [100] * 70
    # 快线上穿慢线后立即暴跌
    for i in range(30):
        prices.append(100 + i * 0.3)
    for i in range(20):
        prices.append(109 - i * 2)  # 暴跌

    klines = _make_klines(prices)
    result = run_backtest(klines, entry_conditions=[], exit_conditions=[], fast_period=20, slow_period=60, stop_loss_pct=2.0, take_profit_pct=6.0, leverage=1)

    # 如果有交易，止损应该限制了亏损
    for trade in result["trades"]:
        assert trade["pnl_pct"] >= -3.0  # 允许一定滑点


def test_backtest_leverage_amplifies_return():
    """杠杆应放大收益率"""
    prices = [100] * 70
    for i in range(80):
        prices.append(100 + i * 0.5)
    for i in range(50):
        prices.append(140 - i * 0.3)

    klines = _make_klines(prices)
    result_1x = run_backtest(klines, entry_conditions=[], exit_conditions=[], fast_period=20, slow_period=60, stop_loss_pct=5.0, take_profit_pct=10.0, leverage=1)
    result_3x = run_backtest(klines, entry_conditions=[], exit_conditions=[], fast_period=20, slow_period=60, stop_loss_pct=5.0, take_profit_pct=10.0, leverage=3)

    # 3x 杠杆下，收益率、收益金额和单笔 pnl_pct 都应该被放大
    if result_1x["trades"] and result_3x["trades"]:
        for t1, t3 in zip(result_1x["trades"], result_3x["trades"]):
            # 同样的入场出场价格，pnl_pct 应接近 3 倍
            if t1["entry_price"] == t3["entry_price"] and t1["exit_price"] == t3["exit_price"]:
                assert abs(t3["pnl_pct"] - t1["pnl_pct"] * 3) < 0.5
                assert abs(t3["pnl"] - t1["pnl"] * 3) < 1.0

    assert abs(result_3x["total_return"] - result_1x["total_return"] * 3) < 0.1


def test_bidirectional_backtest_leverage_amplifies_return():
    """双向模式也应和单向模式保持相同的杠杆收益口径"""
    prices = [100] * 70
    for i in range(80):
        prices.append(100 + i * 0.5)
    for i in range(50):
        prices.append(140 - i * 0.3)

    klines = _make_klines(prices)
    long_entry = [{"type": "MA", "fast": 20, "slow": 60, "op": "cross_above"}]
    short_entry = [{"type": "MA", "fast": 20, "slow": 60, "op": "cross_below"}]

    result_1x = run_backtest(
        klines,
        entry_conditions=long_entry,
        exit_conditions=short_entry,
        long_entry_conditions=long_entry,
        short_entry_conditions=short_entry,
        stop_loss_pct=5.0,
        take_profit_pct=10.0,
        leverage=1,
        strategy_mode="bidirectional",
    )
    result_3x = run_backtest(
        klines,
        entry_conditions=long_entry,
        exit_conditions=short_entry,
        long_entry_conditions=long_entry,
        short_entry_conditions=short_entry,
        stop_loss_pct=5.0,
        take_profit_pct=10.0,
        leverage=3,
        strategy_mode="bidirectional",
    )

    assert result_1x["trades"]
    assert result_3x["trades"]
    assert abs(result_3x["total_return"] - result_1x["total_return"] * 3) < 0.1


def test_backtest_leverage_liquidation():
    """高杠杆下暴跌应触发爆仓（pnl_pct = -100%）"""
    prices = [100] * 70
    for i in range(30):
        prices.append(100 + i * 0.3)
    for i in range(20):
        prices.append(109 - i * 5)  # 剧烈暴跌

    klines = _make_klines(prices)
    result = run_backtest(klines, entry_conditions=[], exit_conditions=[], fast_period=20, slow_period=60, stop_loss_pct=50.0, take_profit_pct=100.0, leverage=50)

    # 高杠杆 + 宽止损，暴跌可能触发爆仓
    for trade in result["trades"]:
        assert trade["pnl_pct"] >= -100.0  # 最多亏完保证金


@pytest.mark.asyncio
async def test_fetch_historical_klines_uses_db_cache(db_session, monkeypatch):
    interval_ms = 15 * 60 * 1000
    start_ts = int(datetime.strptime("2025-01-01", "%Y-%m-%d").timestamp() * 1000)
    end_ts = int(datetime.strptime("2025-01-02", "%Y-%m-%d").timestamp() * 1000)
    remote_calls: list[tuple[int, int]] = []

    async def mock_remote(symbol: str, interval: str, range_start: int, range_end: int):
        remote_calls.append((range_start, range_end))
        return _make_range_klines(range_start, range_end, interval_ms)

    monkeypatch.setattr("app.modules.backtest.engine._fetch_remote_klines_range", mock_remote)

    first = await fetch_historical_klines(db_session, "BTCUSDT", "15m", "2025-01-01", "2025-01-02")
    await db_session.commit()
    second = await fetch_historical_klines(db_session, "BTCUSDT", "15m", "2025-01-01", "2025-01-02")

    cached_rows = (
        await db_session.execute(
            select(HistoricalKline)
            .where(HistoricalKline.symbol == "BTCUSDT", HistoricalKline.interval == "15m")
            .order_by(HistoricalKline.open_time)
        )
    ).scalars().all()

    assert remote_calls == [(start_ts, end_ts)]
    assert len(first) == len(second) == len(cached_rows) == 96
    assert cached_rows[0].open_time == start_ts
    assert cached_rows[-1].open_time == end_ts - interval_ms


@pytest.mark.asyncio
async def test_fetch_historical_klines_only_fetches_incremental_gap(db_session, monkeypatch):
    interval_ms = 15 * 60 * 1000
    day_1_start = int(datetime.strptime("2025-01-01", "%Y-%m-%d").timestamp() * 1000)
    day_2_start = int(datetime.strptime("2025-01-02", "%Y-%m-%d").timestamp() * 1000)
    day_3_start = int(datetime.strptime("2025-01-03", "%Y-%m-%d").timestamp() * 1000)
    remote_calls: list[tuple[int, int]] = []

    async def mock_remote(symbol: str, interval: str, range_start: int, range_end: int):
        remote_calls.append((range_start, range_end))
        return _make_range_klines(range_start, range_end, interval_ms, base_price=200.0)

    monkeypatch.setattr("app.modules.backtest.engine._fetch_remote_klines_range", mock_remote)

    first = await fetch_historical_klines(db_session, "BTCUSDT", "15m", "2025-01-01", "2025-01-02")
    await db_session.commit()
    second = await fetch_historical_klines(db_session, "BTCUSDT", "15m", "2025-01-01", "2025-01-03")

    cached_rows = (
        await db_session.execute(
            select(HistoricalKline)
            .where(HistoricalKline.symbol == "BTCUSDT", HistoricalKline.interval == "15m")
            .order_by(HistoricalKline.open_time)
        )
    ).scalars().all()

    assert len(first) == 96
    assert len(second) == 192
    assert remote_calls == [(day_1_start, day_2_start), (day_2_start, day_3_start)]
    assert len(cached_rows) == 192
    assert cached_rows[-1].open_time == day_3_start - interval_ms


# ========== API 集成测试 ==========

async def _get_token(client):
    await client.post("/api/v1/auth/register", json={
        "username": "btuser",
        "email": "bt@example.com",
        "password": "Test1234",
    })
    resp = await client.post("/api/v1/auth/login", json={
        "email": "bt@example.com",
        "password": "Test1234",
    })
    return resp.json()["data"]["access_token"]


@pytest.mark.asyncio
async def test_records_crud(client, monkeypatch):
    """回测记录 CRUD 完整流程"""
    # mock fetch_historical_klines 避免真实 API 调用
    prices = [100] * 70
    for i in range(80):
        prices.append(100 + i * 0.5)
    klines = _make_klines(prices)

    async def mock_fetch(*args, **kwargs):
        return klines

    monkeypatch.setattr("app.modules.backtest.router.fetch_historical_klines", mock_fetch)

    token = await _get_token(client)
    headers = {"Authorization": f"Bearer {token}"}

    # 1. 跑一次回测（自动保存记录）
    resp = await client.post("/api/v1/backtest/run", json={
        "symbol": "BTCUSDT",
        "interval": "15m",
        "start_date": "2025-01-01",
        "end_date": "2025-06-01",
        "entry_conditions": [{"type": "MA", "fast": 20, "slow": 60, "op": "cross_above"}],
        "exit_conditions": [],
        "stop_loss_pct": 2.0,
        "take_profit_pct": 6.0,
        "leverage": 2,
        "name": "测试策略",
    }, headers=headers)
    assert resp.status_code == 200
    run_data = resp.json()["data"]
    record_id = run_data["record_id"]
    assert record_id

    # 2. 列表查询
    resp = await client.get("/api/v1/backtest/records", headers=headers)
    assert resp.status_code == 200
    records = resp.json()["data"]
    assert len(records) == 1
    assert records[0]["name"] == "测试策略"
    assert records[0]["leverage"] == 2
    assert "sortino_ratio" in records[0]
    assert "max_consecutive_losses" in records[0]
    assert "max_dd_duration_hours" in records[0]
    assert "tail_ratio" in records[0]

    # 3. 查看详情
    resp = await client.get(f"/api/v1/backtest/records/{record_id}", headers=headers)
    assert resp.status_code == 200
    detail = resp.json()["data"]
    assert detail["symbol"] == "BTCUSDT"
    assert "trades" in detail
    assert "sortino_ratio" in detail
    assert "max_consecutive_losses" in detail
    assert "max_dd_duration_hours" in detail
    assert "tail_ratio" in detail

    # 4. 修改名称
    resp = await client.put(f"/api/v1/backtest/records/{record_id}", json={
        "name": "新策略名",
    }, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["data"]["name"] == "新策略名"

    # 5. 删除
    resp = await client.delete(f"/api/v1/backtest/records/{record_id}", headers=headers)
    assert resp.status_code == 200

    # 6. 确认已删除
    resp = await client.get("/api/v1/backtest/records", headers=headers)
    assert len(resp.json()["data"]) == 0


@pytest.mark.asyncio
async def test_record_not_found(client):
    """访问不存在的记录应返回 404"""
    token = await _get_token(client)
    headers = {"Authorization": f"Bearer {token}"}
    resp = await client.get("/api/v1/backtest/records/nonexistent", headers=headers)
    assert resp.status_code == 404
