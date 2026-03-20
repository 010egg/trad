import pytest


async def _get_token(client):
    await client.post("/api/v1/auth/register", json={
        "username": "tradeuser",
        "email": "trade@example.com",
        "password": "Test1234",
    })
    resp = await client.post("/api/v1/auth/login", json={
        "email": "trade@example.com",
        "password": "Test1234",
    })
    return resp.json()["data"]["access_token"]


@pytest.mark.asyncio
async def test_create_order_success(client):
    token = await _get_token(client)
    # 使用合理的止损价以通过风控检查（亏损不超过2%）
    # 账户10000U，0.01手，最大亏损200U，止损价与入场价差距需小于20000
    response = await client.post("/api/v1/trade/orders", json={
        "symbol": "BTCUSDT",
        "side": "BUY",
        "position_side": "LONG",
        "order_type": "LIMIT",
        "quantity": 0.01,
        "price": 67000,
        "stop_loss": 66900,  # 亏损100U = 1%，通过风控
        "take_profit": 70000,
        "trade_reason": "MA20上穿MA60，KDJ金叉确认",
    }, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["symbol"] == "BTCUSDT"
    assert data["trade_reason"] == "MA20上穿MA60，KDJ金叉确认"
    assert data["status"] == "FILLED"


@pytest.mark.asyncio
async def test_create_order_without_reason(client):
    """缺少交易理由应失败"""
    token = await _get_token(client)
    response = await client.post("/api/v1/trade/orders", json={
        "symbol": "BTCUSDT",
        "side": "BUY",
        "position_side": "LONG",
        "order_type": "MARKET",
        "quantity": 0.001,  # 小数量以通过风控
        "stop_loss": 66000,
        "trade_reason": "",
    }, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_list_orders(client):
    token = await _get_token(client)
    # 使用小数量和合理止损价以通过风控检查
    await client.post("/api/v1/trade/orders", json={
        "symbol": "BTCUSDT", "side": "BUY", "position_side": "LONG",
        "order_type": "LIMIT", "quantity": 0.001, "price": 67000,
        "stop_loss": 66900, "trade_reason": "测试下单",
    }, headers={"Authorization": f"Bearer {token}"})

    response = await client.get("/api/v1/trade/orders",
                                headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert len(response.json()["data"]) >= 1


@pytest.mark.asyncio
async def test_list_positions(client):
    token = await _get_token(client)
    await client.post("/api/v1/trade/orders", json={
        "symbol": "ETHUSDT", "side": "BUY", "position_side": "LONG",
        "order_type": "LIMIT", "quantity": 0.1, "price": 3500,
        "stop_loss": 3490, "trade_reason": "看多ETH",
    }, headers={"Authorization": f"Bearer {token}"})

    response = await client.get("/api/v1/trade/positions",
                                headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    positions = response.json()["data"]
    assert len(positions) >= 1
    assert positions[0]["symbol"] == "ETHUSDT"


@pytest.mark.asyncio
async def test_list_live_spot_positions_returns_entry_price(client, monkeypatch):
    token = await _get_token(client)

    class FakeBinanceClient:
        async def get_spot_account_info(self):
            return {
                "balances": [
                    {"asset": "BTC", "free": "0.6", "locked": "0"},
                    {"asset": "USDT", "free": "1000", "locked": "0"},
                ]
            }

        async def get_my_trades(
            self,
            symbol: str,
            start_time: int | None = None,
            end_time: int | None = None,
            limit: int | None = None,
            from_id: int | None = None,
        ):
            assert symbol == "BTCUSDT"
            assert limit == 1000
            return [
                {"time": 1, "isBuyer": True, "qty": "1", "quoteQty": "100"},
                {"time": 2, "isBuyer": False, "qty": "0.4", "quoteQty": "48"},
            ]

        async def close(self):
            return None

    async def fake_get_binance_client(self, testnet: bool = False):
        return FakeBinanceClient()

    async def fake_fetch_current_prices(symbols):
        assert symbols == ["BTCUSDT"]
        return {"BTCUSDT": 110.0}

    monkeypatch.setattr(
        "app.modules.trade.service.TradeService.get_binance_client",
        fake_get_binance_client,
    )
    monkeypatch.setattr(
        "app.modules.trade.router.fetch_current_prices",
        fake_fetch_current_prices,
    )

    settings_resp = await client.put(
        "/api/v1/trade/settings",
        json={"trade_mode": "LIVE", "default_market": "SPOT"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert settings_resp.status_code == 200

    key_resp = await client.post(
        "/api/v1/account/api-keys",
        json={"api_key": "test-key", "api_secret": "test-secret"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert key_resp.status_code == 200

    response = await client.get(
        "/api/v1/trade/positions",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200

    positions = response.json()["data"]
    assert len(positions) == 1
    assert positions[0]["symbol"] == "BTCUSDT"
    assert positions[0]["trade_mode"] == "LIVE"
    assert positions[0]["entry_price"] == pytest.approx(100.0)
    assert positions[0]["current_price"] == pytest.approx(110.0)
    assert positions[0]["price_change_pct"] == pytest.approx(10.0)


@pytest.mark.asyncio
async def test_close_position(client):
    token = await _get_token(client)
    # 开仓（使用小数量和合理止损价）
    order_resp = await client.post("/api/v1/trade/orders", json={
        "symbol": "BTCUSDT", "side": "BUY", "position_side": "LONG",
        "order_type": "LIMIT", "quantity": 0.001, "price": 67000,
        "stop_loss": 66900, "trade_reason": "测试平仓",
    }, headers={"Authorization": f"Bearer {token}"})
    order_id = order_resp.json()["data"]["id"]

    # 平仓
    response = await client.post(f"/api/v1/trade/positions/{order_id}/close",
                                 headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["data"]["success"] is True

    # 确认持仓列表中已无此仓位
    pos_resp = await client.get("/api/v1/trade/positions",
                                headers={"Authorization": f"Bearer {token}"})
    open_ids = [p["order_id"] for p in pos_resp.json()["data"]]
    assert order_id not in open_ids
