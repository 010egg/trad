import pytest


async def _register_and_login(client):
    """注册并登录，返回 access_token"""
    await client.post("/api/v1/auth/register", json={
        "username": "apiuser",
        "email": "api@example.com",
        "password": "Test1234",
    })
    resp = await client.post("/api/v1/auth/login", json={
        "email": "api@example.com",
        "password": "Test1234",
    })
    return resp.json()["data"]["access_token"]


@pytest.mark.asyncio
async def test_bind_api_key(client):
    token = await _register_and_login(client)
    response = await client.post("/api/v1/account/api-keys", json={
        "api_key": "test_api_key_123",
        "api_secret": "test_api_secret_456",
    }, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["exchange"] == "binance"
    assert data["is_active"] is True
    # 返回的 key 应该是脱敏的
    assert "***" in data["masked_key"]


@pytest.mark.asyncio
async def test_bind_api_key_without_auth(client):
    response = await client.post("/api/v1/account/api-keys", json={
        "api_key": "key",
        "api_secret": "secret",
    })
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_api_keys(client):
    token = await _register_and_login(client)
    # 先绑定
    await client.post("/api/v1/account/api-keys", json={
        "api_key": "key123",
        "api_secret": "secret456",
    }, headers={"Authorization": f"Bearer {token}"})
    # 再查询
    response = await client.get("/api/v1/account/api-keys",
                                headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    keys = response.json()["data"]
    assert len(keys) == 1
    assert "api_secret" not in str(keys)  # secret 不应出现在响应中


@pytest.mark.asyncio
async def test_delete_api_key(client):
    token = await _register_and_login(client)
    # 绑定
    bind_resp = await client.post("/api/v1/account/api-keys", json={
        "api_key": "key123",
        "api_secret": "secret456",
    }, headers={"Authorization": f"Bearer {token}"})
    key_id = bind_resp.json()["data"]["id"]
    # 删除
    response = await client.delete(f"/api/v1/account/api-keys/{key_id}",
                                   headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    # 确认已删除
    list_resp = await client.get("/api/v1/account/api-keys",
                                 headers={"Authorization": f"Bearer {token}"})
    assert len(list_resp.json()["data"]) == 0
