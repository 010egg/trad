import pytest


@pytest.mark.asyncio
async def test_register_success(client):
    response = await client.post("/api/v1/auth/register", json={
        "username": "testuser",
        "email": "test@example.com",
        "password": "Test1234",
    })
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["username"] == "testuser"
    assert data["email"] == "test@example.com"
    assert "id" in data


@pytest.mark.asyncio
async def test_register_duplicate_email(client):
    """重复邮箱注册应失败"""
    payload = {
        "username": "user1",
        "email": "dup@example.com",
        "password": "Test1234",
    }
    await client.post("/api/v1/auth/register", json=payload)
    response = await client.post("/api/v1/auth/register", json={
        "username": "user2",
        "email": "dup@example.com",
        "password": "Test1234",
    })
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_register_weak_password(client):
    """密码太短应失败"""
    response = await client.post("/api/v1/auth/register", json={
        "username": "weakuser",
        "email": "weak@example.com",
        "password": "123",
    })
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_login_success(client):
    # 先注册
    await client.post("/api/v1/auth/register", json={
        "username": "loginuser",
        "email": "login@example.com",
        "password": "Test1234",
    })
    # 再登录
    response = await client.post("/api/v1/auth/login", json={
        "email": "login@example.com",
        "password": "Test1234",
    })
    assert response.status_code == 200
    data = response.json()["data"]
    assert "access_token" in data
    assert "refresh_token" in data


@pytest.mark.asyncio
async def test_login_wrong_password(client):
    await client.post("/api/v1/auth/register", json={
        "username": "wrongpw",
        "email": "wrongpw@example.com",
        "password": "Test1234",
    })
    response = await client.post("/api/v1/auth/login", json={
        "email": "wrongpw@example.com",
        "password": "WrongPass",
    })
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_login_nonexistent_user(client):
    response = await client.post("/api/v1/auth/login", json={
        "email": "nobody@example.com",
        "password": "Test1234",
    })
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_protected_route_without_token(client):
    """无 Token 访问受保护接口应返回 401"""
    response = await client.get("/api/v1/auth/me")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_protected_route_with_token(client):
    """携带有效 Token 应返回用户信息"""
    await client.post("/api/v1/auth/register", json={
        "username": "meuser",
        "email": "me@example.com",
        "password": "Test1234",
    })
    login_resp = await client.post("/api/v1/auth/login", json={
        "email": "me@example.com",
        "password": "Test1234",
    })
    token = login_resp.json()["data"]["access_token"]

    response = await client.get("/api/v1/auth/me", headers={
        "Authorization": f"Bearer {token}",
    })
    assert response.status_code == 200
    assert response.json()["data"]["email"] == "me@example.com"


@pytest.mark.asyncio
async def test_refresh_token(client):
    await client.post("/api/v1/auth/register", json={
        "username": "refreshuser",
        "email": "refresh@example.com",
        "password": "Test1234",
    })
    login_resp = await client.post("/api/v1/auth/login", json={
        "email": "refresh@example.com",
        "password": "Test1234",
    })
    refresh_token = login_resp.json()["data"]["refresh_token"]

    response = await client.post("/api/v1/auth/refresh", json={
        "refresh_token": refresh_token,
    })
    assert response.status_code == 200
    assert "access_token" in response.json()["data"]
