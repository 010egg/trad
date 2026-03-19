import pytest


async def _get_token(client):
    await client.post("/api/v1/auth/register", json={
        "username": "riskuser",
        "email": "risk@example.com",
        "password": "Test1234",
    })
    resp = await client.post("/api/v1/auth/login", json={
        "email": "risk@example.com",
        "password": "Test1234",
    })
    return resp.json()["data"]["access_token"]


@pytest.mark.asyncio
async def test_get_default_risk_config(client):
    """首次获取风控配置应返回默认值"""
    token = await _get_token(client)
    response = await client.get("/api/v1/risk/config",
                                headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    data = response.json()["data"]
    assert float(data["max_loss_per_trade"]) == 2.0
    assert float(data["max_daily_loss"]) == 5.0
    assert data["require_stop_loss"] is True
    assert data["require_trade_reason"] is True


@pytest.mark.asyncio
async def test_update_risk_config(client):
    token = await _get_token(client)
    # 先获取一次触发创建默认配置
    await client.get("/api/v1/risk/config",
                     headers={"Authorization": f"Bearer {token}"})
    # 更新
    response = await client.put("/api/v1/risk/config", json={
        "max_loss_per_trade": 1.5,
        "max_daily_loss": 3.0,
        "require_take_profit": True,
        "max_open_positions": 5,
    }, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    data = response.json()["data"]
    assert float(data["max_loss_per_trade"]) == 1.5
    assert float(data["max_daily_loss"]) == 3.0
    assert data["require_take_profit"] is True
    assert data["max_open_positions"] == 5


@pytest.mark.asyncio
async def test_cannot_disable_stop_loss(client):
    """强制止损不可关闭"""
    token = await _get_token(client)
    await client.get("/api/v1/risk/config",
                     headers={"Authorization": f"Bearer {token}"})
    response = await client.put("/api/v1/risk/config", json={
        "require_stop_loss": False,
    }, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    # 即使传了 false，止损仍然是 true
    data = response.json()["data"]
    assert data["require_stop_loss"] is True


@pytest.mark.asyncio
async def test_risk_check_pass(client):
    """风控检查通过"""
    token = await _get_token(client)
    await client.get("/api/v1/risk/config",
                     headers={"Authorization": f"Bearer {token}"})
    response = await client.post("/api/v1/risk/check", json={
        "symbol": "BTCUSDT",
        "side": "BUY",
        "quantity": 0.01,
        "stop_loss": 66000,
        "entry_price": 67000,
        "account_balance": 10000,
    }, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["allowed"] is True


@pytest.mark.asyncio
async def test_risk_check_exceeds_max_loss(client):
    """单笔亏损超过限制应被拦截"""
    token = await _get_token(client)
    await client.get("/api/v1/risk/config",
                     headers={"Authorization": f"Bearer {token}"})
    response = await client.post("/api/v1/risk/check", json={
        "symbol": "BTCUSDT",
        "side": "BUY",
        "quantity": 1.0,
        "stop_loss": 60000,
        "entry_price": 67000,
        "account_balance": 10000,
    }, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["allowed"] is False
    assert "recommended_quantity" in data


@pytest.mark.asyncio
async def test_risk_status(client):
    token = await _get_token(client)
    response = await client.get("/api/v1/risk/status",
                                headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    data = response.json()["data"]
    assert "daily_loss_current" in data
    assert "is_locked" in data
