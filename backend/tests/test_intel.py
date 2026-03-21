import pytest


async def _get_token(client):
    await client.post("/api/v1/auth/register", json={
        "username": "inteluser",
        "email": "intel@example.com",
        "password": "Test1234",
    })
    resp = await client.post("/api/v1/auth/login", json={
        "email": "intel@example.com",
        "password": "Test1234",
    })
    return resp.json()["data"]["access_token"]


@pytest.mark.asyncio
async def test_refresh_and_filter_intel_feed(client, monkeypatch):
    token = await _get_token(client)

    async def fake_fetch_external_intel_items():
        return [
            {
                "source_type": "external",
                "source_name": "Binance Announcements",
                "source_item_id": "binance-1",
                "title": "Binance launches SOL perpetuals after strong Solana demand",
                "source_url": "https://example.com/binance-1",
                "content_raw": "Solana derivatives launch broadens access.",
                "published_at": __import__("datetime").datetime(2026, 3, 21, 0, 0, 0),
                "category": "exchange",
            },
            {
                "source_type": "external",
                "source_name": "Cointelegraph",
                "source_item_id": "ct-1",
                "title": "US senators advance crypto market structure bill",
                "source_url": "https://example.com/ct-1",
                "content_raw": "A major policy breakthrough could shape the market.",
                "published_at": __import__("datetime").datetime(2026, 3, 20, 12, 0, 0),
                "category": "regulation",
            },
        ]

    async def fake_enrich_intel_item(item, llm_config=None, allow_env_fallback=True):
        if "SOL" in item["title"].upper():
            return {
                **item,
                "summary_ai": "Solana derivatives expansion is treated as a bullish exchange catalyst.",
                "signal": "BULLISH",
                "confidence": 0.86,
                "reasoning": "New derivatives listings usually add liquidity and attention.",
                "category": "exchange",
                "symbols": ["SOLUSDT"],
                "score": 0.86,
            }
        return {
            **item,
            "summary_ai": "Legislative progress is a regulatory catalyst with broad market impact.",
            "signal": "NEUTRAL",
            "confidence": 0.58,
            "reasoning": "Policy progress matters, but directional impact is still mixed.",
            "category": "regulation",
            "symbols": ["BTCUSDT", "ETHUSDT"],
            "score": 0.58,
        }

    monkeypatch.setattr(
        "app.modules.intel.service.fetch_external_intel_items",
        fake_fetch_external_intel_items,
    )
    monkeypatch.setattr(
        "app.modules.intel.service.enrich_intel_item",
        fake_enrich_intel_item,
    )

    refresh = await client.post(
        "/api/v1/intel/refresh",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert refresh.status_code == 200
    refresh_data = refresh.json()["data"]
    assert refresh_data["created"] == 2

    feed = await client.get(
        "/api/v1/intel/feed?symbol=SOLUSDT&signal=BULLISH",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert feed.status_code == 200
    items = feed.json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["symbols"] == ["SOLUSDT"]
    assert items[0]["signal"] == "BULLISH"

    detail = await client.get(
        f"/api/v1/intel/{items[0]['id']}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert detail.status_code == 200
    assert detail.json()["data"]["source_name"] == "Binance Announcements"


@pytest.mark.asyncio
async def test_intel_item_chat_with_ai(client, monkeypatch):
    token = await _get_token(client)

    async def fake_fetch_external_intel_items():
        return [
            {
                "source_type": "external",
                "source_name": "Binance Announcements",
                "source_item_id": "binance-chat-1",
                "title": "Binance launches SOL perpetuals after strong Solana demand",
                "source_url": "https://example.com/binance-chat-1",
                "content_raw": "Solana derivatives launch broadens access.",
                "published_at": __import__("datetime").datetime(2026, 3, 21, 0, 0, 0),
                "category": "exchange",
            }
        ]

    async def fake_enrich_intel_item(item, llm_config=None, allow_env_fallback=True):
        return {
            **item,
            "summary_ai": "Solana derivatives expansion is treated as a bullish exchange catalyst.",
            "signal": "BULLISH",
            "confidence": 0.86,
            "reasoning": "New derivatives listings usually add liquidity and attention.",
            "category": "exchange",
            "symbols": ["SOLUSDT"],
            "score": 0.86,
        }

    monkeypatch.setattr(
        "app.modules.intel.service.fetch_external_intel_items",
        fake_fetch_external_intel_items,
    )
    monkeypatch.setattr(
        "app.modules.intel.service.enrich_intel_item",
        fake_enrich_intel_item,
    )

    refresh = await client.post(
        "/api/v1/intel/refresh",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert refresh.status_code == 200

    feed = await client.get(
        "/api/v1/intel/feed?symbol=SOLUSDT",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert feed.status_code == 200
    item_id = feed.json()["data"]["items"][0]["id"]

    settings_resp = await client.put(
        "/api/v1/trade/settings",
        json={
            "llm_enabled": True,
            "llm_provider": "OPENAI",
            "llm_base_url": "https://api.minimaxi.com",
            "llm_model": "MiniMax-M2.7",
            "llm_api_key": "sk-test-12345678",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert settings_resp.status_code == 200

    async def fake_chat_with_intel_item(
        db,
        incoming_item_id,
        question,
        history=None,
        *,
        llm_config=None,
        allow_env_fallback=True,
        user_settings=None,
    ):
        del db, allow_env_fallback, user_settings
        assert incoming_item_id == item_id
        assert question == "这条情报对 SOL 的影响是什么？"
        assert history == [{"role": "user", "content": "先给我一个简版结论"}]
        assert llm_config is not None
        assert llm_config["model"] == "MiniMax-M2.7"
        return {
            "reply": "偏多，但更适合短中期交易观察。",
            "model": "MiniMax-M2.7",
            "latency_ms": 321,
        }

    monkeypatch.setattr(
        "app.modules.intel.router.chat_with_intel_item",
        fake_chat_with_intel_item,
    )

    response = await client.post(
        f"/api/v1/intel/{item_id}/chat",
        json={
            "question": "这条情报对 SOL 的影响是什么？",
            "history": [{"role": "user", "content": "先给我一个简版结论"}],
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["reply"] == "偏多，但更适合短中期交易观察。"
    assert data["latency_ms"] == 321


@pytest.mark.asyncio
async def test_global_intel_chat_without_item_context(client, monkeypatch):
    token = await _get_token(client)

    settings_resp = await client.put(
        "/api/v1/trade/settings",
        json={
            "llm_enabled": True,
            "llm_provider": "OPENAI",
            "llm_base_url": "https://api.minimaxi.com",
            "llm_model": "MiniMax-M2.7",
            "llm_api_key": "sk-test-12345678",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert settings_resp.status_code == 200

    async def fake_chat_with_intel_assistant(
        question,
        history=None,
        *,
        llm_config=None,
        allow_env_fallback=True,
        user_settings=None,
    ):
        del allow_env_fallback, user_settings
        assert question == "今天更该盯哪些市场风险？"
        assert history == [{"role": "user", "content": "先给我一句话结论"}]
        assert llm_config is not None
        assert llm_config["model"] == "MiniMax-M2.7"
        return {
            "reply": "先盯风险资产波动、ETF 资金流和监管 headline。",
            "model": "MiniMax-M2.7",
            "latency_ms": 187,
        }

    monkeypatch.setattr(
        "app.modules.intel.router.chat_with_intel_assistant",
        fake_chat_with_intel_assistant,
    )

    response = await client.post(
        "/api/v1/intel/chat",
        json={
            "question": "今天更该盯哪些市场风险？",
            "history": [{"role": "user", "content": "先给我一句话结论"}],
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["reply"] == "先盯风险资产波动、ETF 资金流和监管 headline。"
    assert data["latency_ms"] == 187


@pytest.mark.asyncio
async def test_intel_item_chat_reports_disabled_ai_more_clearly(client, monkeypatch):
    token = await _get_token(client)

    async def fake_fetch_external_intel_items():
        return [
            {
                "source_type": "external",
                "source_name": "Cointelegraph",
                "source_item_id": "ct-disabled-1",
                "title": "ETH ETF flows stabilize after volatile session",
                "source_url": "https://example.com/ct-disabled-1",
                "content_raw": "ETF flows remain mixed but stable.",
                "published_at": __import__("datetime").datetime(2026, 3, 21, 0, 0, 0),
                "category": "macro",
            }
        ]

    async def fake_enrich_intel_item(item, llm_config=None, allow_env_fallback=True):
        return {
            **item,
            "summary_ai": "ETF flow stabilization matters for ETH sentiment.",
            "signal": "NEUTRAL",
            "confidence": 0.55,
            "reasoning": "Mixed flows reduce directional certainty.",
            "category": "macro",
            "symbols": ["ETHUSDT"],
            "score": 0.55,
        }

    monkeypatch.setattr(
        "app.modules.intel.service.fetch_external_intel_items",
        fake_fetch_external_intel_items,
    )
    monkeypatch.setattr(
        "app.modules.intel.service.enrich_intel_item",
        fake_enrich_intel_item,
    )

    refresh = await client.post(
        "/api/v1/intel/refresh",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert refresh.status_code == 200

    feed = await client.get(
        "/api/v1/intel/feed?symbol=ETHUSDT",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert feed.status_code == 200
    item_id = feed.json()["data"]["items"][0]["id"]

    settings_resp = await client.put(
        "/api/v1/trade/settings",
        json={
            "llm_enabled": False,
            "llm_provider": "OPENAI",
            "llm_base_url": "https://api.minimaxi.com/v1",
            "llm_model": "MiniMax-M2.7",
            "llm_api_key": "sk-test-12345678",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert settings_resp.status_code == 200

    response = await client.post(
        f"/api/v1/intel/{item_id}/chat",
        json={"question": "这条消息值得交易吗？"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 400
    assert "已配置但未启用" in response.json()["detail"]


@pytest.mark.asyncio
async def test_enrich_intel_item_coerces_non_json_ai_response(monkeypatch):
    from app.modules.intel.service import enrich_intel_item

    responses = [
        {
            "content": [
                {
                    "type": "text",
                    "text": (
                        "Let me analyze this news article.\n\n"
                        "**Signal Analysis:** This is clearly BEARISH.\n"
                        "**Confidence:** around 0.74.\n"
                        "**Category:** macro.\n"
                        "**Symbols:** BTCUSDT."
                    ),
                }
            ],
            "model": "MiniMax-M2.7",
        },
        {
            "content": [
                {
                    "type": "text",
                    "text": (
                        '{"summary":"地缘冲突与 ETF 资金流出共同压制风险偏好。",'
                        '"signal":"BEARISH","confidence":0.74,'
                        '"reasoning":"战争升级和 ETF 流出意味着短线风险偏好下降。",'
                        '"symbols":["BTCUSDT"],"category":"macro"}'
                    ),
                }
            ],
            "model": "MiniMax-M2.7",
        },
    ]

    async def fake_request_chat_completion(runtime_config, messages, **kwargs):
        del runtime_config, messages, kwargs
        return responses.pop(0)

    monkeypatch.setattr(
        "app.modules.intel.service._request_chat_completion",
        fake_request_chat_completion,
    )

    item = {
        "source_type": "external",
        "source_name": "Cointelegraph",
        "source_item_id": "ct-json-coerce",
        "title": "Bitcoin weakness deepens as war pushes traders to reassess risk",
        "source_url": "https://example.com/ct-json-coerce",
        "content_raw": "Bitcoin price remains rocky as ETF outflows rise.",
        "published_at": __import__("datetime").datetime(2026, 3, 21, 0, 0, 0),
    }

    enriched = await enrich_intel_item(
        item,
        llm_config={
            "provider": "ANTHROPIC",
            "base_url": "https://api.minimaxi.com/anthropic",
            "model": "MiniMax-M2.7",
            "api_key": "sk-test-12345678",
        },
        allow_env_fallback=False,
    )

    assert enriched["summary_ai"] == "地缘冲突与 ETF 资金流出共同压制风险偏好。"
    assert enriched["signal"] == "BEARISH"
    assert enriched["confidence"] == 0.74
    assert enriched["symbols"] == ["BTCUSDT"]
    assert enriched["reasoning"] == "战争升级和 ETF 流出意味着短线风险偏好下降。"


@pytest.mark.asyncio
async def test_intel_filters_requires_auth(client):
    response = await client.get("/api/v1/intel/filters")
    assert response.status_code == 401
