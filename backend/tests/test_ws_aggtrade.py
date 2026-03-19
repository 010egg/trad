from app.ws.aggtrade_klines import apply_trade_to_kline, floor_interval_start, seed_realtime_kline


def test_floor_interval_start_for_fixed_and_calendar_intervals():
    ts_ms = 1709207165123  # 2024-02-29 12:26:05.123 UTC

    assert floor_interval_start("15m", ts_ms) == 1709207100
    assert floor_interval_start("1h", ts_ms) == 1709204400
    assert floor_interval_start("1d", ts_ms) == 1709164800
    assert floor_interval_start("1w", ts_ms) == 1708905600
    assert floor_interval_start("1M", ts_ms) == 1706745600


def test_seed_realtime_kline_marks_seed_as_open_candle():
    seed = seed_realtime_kline({
        "time": 1709207100,
        "open": 100,
        "high": 110,
        "low": 95,
        "close": 108,
        "volume": 12.5,
    })

    assert seed == {
        "time": 1709207100,
        "open": 100.0,
        "high": 110.0,
        "low": 95.0,
        "close": 108.0,
        "volume": 12.5,
        "closed": False,
    }


def test_apply_trade_to_kline_updates_current_bucket():
    current = {
        "time": 1709207100,
        "open": 100.0,
        "high": 110.0,
        "low": 95.0,
        "close": 108.0,
        "volume": 12.5,
        "closed": False,
    }

    updated = apply_trade_to_kline(
        current,
        "15m",
        1709207165123,
        111.0,
        0.75,
    )

    assert updated == {
        "time": 1709207100,
        "open": 100.0,
        "high": 111.0,
        "low": 95.0,
        "close": 111.0,
        "volume": 13.25,
        "closed": False,
    }


def test_apply_trade_to_kline_rolls_to_new_bucket():
    current = {
        "time": 1709207100,
        "open": 100.0,
        "high": 110.0,
        "low": 95.0,
        "close": 108.0,
        "volume": 12.5,
        "closed": False,
    }

    updated = apply_trade_to_kline(
        current,
        "15m",
        1709208000000,
        109.0,
        0.2,
    )

    assert updated == {
        "time": 1709208000,
        "open": 109.0,
        "high": 109.0,
        "low": 109.0,
        "close": 109.0,
        "volume": 0.2,
        "closed": False,
    }
