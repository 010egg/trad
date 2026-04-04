from datetime import datetime

import pytest
from sqlalchemy import select


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


def _parse_sse_events(payload: str) -> list[tuple[str, str]]:
    events: list[tuple[str, str]] = []
    for block in payload.strip().split("\n\n"):
        if not block.strip():
            continue
        event_type = "message"
        data_lines: list[str] = []
        for line in block.splitlines():
            if line.startswith("event:"):
                event_type = line.split(":", 1)[1].strip() or "message"
            elif line.startswith("data:"):
                data_lines.append(line.split(":", 1)[1].strip())
        events.append((event_type, "\n".join(data_lines)))
    return events


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
async def test_global_intel_chat_stream_returns_sse_events(client, monkeypatch):
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

    async def fake_stream_chat_with_intel_assistant(
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

        async def generator():
            yield {"type": "delta", "content": "先盯风险资产波动，"}
            yield {"type": "delta", "content": "再看 ETF 资金流。"}
            yield {
                "type": "done",
                "reply": "先盯风险资产波动，再看 ETF 资金流。",
                "model": "MiniMax-M2.7",
                "latency_ms": 187,
            }

        return generator()

    monkeypatch.setattr(
        "app.modules.intel.router.stream_chat_with_intel_assistant",
        fake_stream_chat_with_intel_assistant,
    )

    response = await client.post(
        "/api/v1/intel/chat/stream",
        json={
            "question": "今天更该盯哪些市场风险？",
            "history": [{"role": "user", "content": "先给我一句话结论"}],
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    events = _parse_sse_events(response.text)
    assert events == [
        ("delta", '{"content": "先盯风险资产波动，"}'),
        ("delta", '{"content": "再看 ETF 资金流。"}'),
        (
            "done",
            '{"reply": "先盯风险资产波动，再看 ETF 资金流。", "model": "MiniMax-M2.7", "latency_ms": 187}',
        ),
    ]


@pytest.mark.asyncio
async def test_intel_item_chat_stream_returns_sse_events(client, monkeypatch):
    token = await _get_token(client)

    async def fake_fetch_external_intel_items():
        return [
            {
                "source_type": "external",
                "source_name": "Binance Announcements",
                "source_item_id": "binance-stream-1",
                "title": "Binance launches SOL perpetuals after strong Solana demand",
                "source_url": "https://example.com/binance-stream-1",
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

    async def fake_stream_chat_with_intel_item(
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

        async def generator():
            yield {"type": "delta", "content": "偏多，"}
            yield {"type": "delta", "content": "但更适合短中期观察。"}
            yield {
                "type": "done",
                "reply": "偏多，但更适合短中期观察。",
                "model": "MiniMax-M2.7",
                "latency_ms": 321,
            }

        return generator()

    monkeypatch.setattr(
        "app.modules.intel.router.stream_chat_with_intel_item",
        fake_stream_chat_with_intel_item,
    )

    response = await client.post(
        f"/api/v1/intel/{item_id}/chat/stream",
        json={
            "question": "这条情报对 SOL 的影响是什么？",
            "history": [{"role": "user", "content": "先给我一个简版结论"}],
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    events = _parse_sse_events(response.text)
    assert events == [
        ("delta", '{"content": "偏多，"}'),
        ("delta", '{"content": "但更适合短中期观察。"}'),
        (
            "done",
            '{"reply": "偏多，但更适合短中期观察。", "model": "MiniMax-M2.7", "latency_ms": 321}',
        ),
    ]


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
    assert enriched["confidence"] == 0.53
    assert enriched["symbols"] == ["BTCUSDT"]
    assert enriched["reasoning"] == "战争升级和 ETF 流出意味着短线风险偏好下降。"


@pytest.mark.asyncio
async def test_fetch_binance_announcements_pages_large_limits(monkeypatch):
    from app.modules.intel import service

    requests: list[dict[str, int]] = []

    class FakeResponse:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            del args, kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            del exc_type, exc, tb
            return False

        async def get(self, url, params=None):
            assert url == service.BINANCE_ANNOUNCEMENTS_URL
            assert params is not None
            requests.append({"pageNo": params["pageNo"], "pageSize": params["pageSize"]})
            assert params["pageSize"] <= service.BINANCE_ANNOUNCEMENTS_MAX_PAGE_SIZE

            page_no = params["pageNo"]
            articles = [
                {
                    "code": f"binance-{idx}",
                    "title": f"Announcement {idx}",
                    "releaseDate": f"2026-04-{idx:02d}T00:00:00",
                }
                for idx in range((page_no - 1) * 5 + 1, (page_no - 1) * 5 + params["pageSize"] + 1)
            ]
            return FakeResponse({"data": {"catalogs": [{"articles": articles}]}})

    monkeypatch.setattr(service.httpx, "AsyncClient", FakeAsyncClient)

    items = await service.fetch_binance_announcements(limit=8)

    assert len(items) == 8
    assert requests == [{"pageNo": 1, "pageSize": 5}, {"pageNo": 2, "pageSize": 3}]
    assert items[0]["source_item_id"] == "binance-1"
    assert items[-1]["source_item_id"] == "binance-8"


@pytest.mark.asyncio
async def test_fetch_fred_items_preserves_observation_date(monkeypatch):
    from app.modules.intel import service

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "observations": [
                    {"date": "2026-04-02", "value": "4.31"},
                    {"date": "2026-04-01", "value": "4.33"},
                ]
            }

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            del args, kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            del exc_type, exc, tb
            return False

        async def get(self, url, params=None):
            assert url == f"{service.FRED_BASE_URL}/series/observations"
            assert params is not None
            return FakeResponse()

    monkeypatch.setattr(service.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(service.settings, "fred_api_key", "fred-test")
    monkeypatch.setattr(
        service,
        "FRED_SERIES",
        [{"id": "DGS10", "name": "10年期美债收益率", "unit": "%"}],
    )

    items = await service.fetch_fred_items()

    assert len(items) == 1
    assert items[0]["source_item_id"] == "DGS10_2026-04-02"
    assert items[0]["published_at"] == datetime(2026, 4, 2, 0, 0, 0)
    assert "2026-04-02" in items[0]["title"]


@pytest.mark.asyncio
async def test_fetch_rss_items_parses_generic_feed(monkeypatch):
    from app.modules.intel import service

    payload = """<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <item>
          <title>Judge continues Nevada ban on Kalshi sports markets</title>
          <link>https://example.com/post-1</link>
          <guid>post-1</guid>
          <description><![CDATA[<p>Kalshi remains blocked in Nevada.</p>]]></description>
          <pubDate>Sat, 04 Apr 2026 07:04:16 +0000</pubDate>
        </item>
      </channel>
    </rss>
    """

    class FakeResponse:
        text = payload

        def raise_for_status(self):
            return None

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            del args, kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            del exc_type, exc, tb
            return False

        async def get(self, url):
            assert url == "https://example.com/feed.xml"
            return FakeResponse()

    monkeypatch.setattr(service.httpx, "AsyncClient", FakeAsyncClient)

    items = await service.fetch_rss_items(
        source_name="CoinDesk",
        rss_url="https://example.com/feed.xml",
        limit=5,
    )

    assert len(items) == 1
    assert items[0]["source_name"] == "CoinDesk"
    assert items[0]["source_item_id"] == "post-1"
    assert items[0]["source_url"] == "https://example.com/post-1"
    assert items[0]["content_raw"] == "Kalshi remains blocked in Nevada."
    assert items[0]["published_at"] == datetime(2026, 4, 4, 7, 4, 16)


@pytest.mark.asyncio
async def test_upsert_intel_items_updates_source_item_id_when_matching_by_source_url(db_session):
    from app.modules.intel.models import IntelItem
    from app.modules.intel.service import upsert_intel_items

    source_url = "https://fred.stlouisfed.org/series/DGS10"

    await upsert_intel_items(
        db_session,
        [
            {
                "source_type": "external",
                "source_name": "FRED",
                "source_item_id": "DGS10_2026-03-30",
                "title": "旧数据",
                "source_url": source_url,
                "content_raw": "旧数据",
                "summary_ai": "旧摘要",
                "signal": "NEUTRAL",
                "confidence": 0.5,
                "reasoning": "旧推理",
                "category": "macro",
                "published_at": datetime(2026, 3, 30, 0, 0, 0),
                "symbols": [],
            }
        ],
    )
    await db_session.commit()

    await upsert_intel_items(
        db_session,
        [
            {
                "source_type": "external",
                "source_name": "FRED",
                "source_item_id": "DGS10_2026-04-02",
                "title": "新数据",
                "source_url": source_url,
                "content_raw": "新数据",
                "summary_ai": "新摘要",
                "signal": "NEUTRAL",
                "confidence": 0.6,
                "reasoning": "新推理",
                "category": "macro",
                "published_at": datetime(2026, 4, 2, 0, 0, 0),
                "symbols": [],
            }
        ],
    )
    await db_session.commit()

    rows = (await db_session.execute(select(IntelItem))).scalars().all()

    assert len(rows) == 1
    assert rows[0].source_item_id == "DGS10_2026-04-02"
    assert rows[0].published_at == datetime(2026, 4, 2, 0, 0, 0)
    assert rows[0].title == "新数据"


@pytest.mark.asyncio
async def test_query_intel_feed_orders_and_paginates_by_ingested_at(db_session):
    from app.modules.intel.models import IntelItem
    from app.modules.intel.service import query_intel_feed

    db_session.add_all(
        [
            IntelItem(
                id="intel-a",
                source_type="external",
                source_name="Cointelegraph",
                source_item_id="ct-a",
                title="Older publish, latest ingest",
                source_url="https://example.com/a",
                content_raw="A",
                summary_ai="A",
                signal="NEUTRAL",
                confidence=0.5,
                reasoning="A",
                category="macro",
                published_at=datetime(2026, 4, 1, 10, 0, 0),
                ingested_at=datetime(2026, 4, 4, 12, 0, 0),
                score=0.5,
                source_score=0.5,
                confirmation_count=1,
                is_active=True,
            ),
            IntelItem(
                id="intel-b",
                source_type="external",
                source_name="Cointelegraph",
                source_item_id="ct-b",
                title="Newer publish, earlier ingest",
                source_url="https://example.com/b",
                content_raw="B",
                summary_ai="B",
                signal="NEUTRAL",
                confidence=0.5,
                reasoning="B",
                category="macro",
                published_at=datetime(2026, 4, 3, 10, 0, 0),
                ingested_at=datetime(2026, 4, 4, 11, 0, 0),
                score=0.5,
                source_score=0.5,
                confirmation_count=1,
                is_active=True,
            ),
            IntelItem(
                id="intel-c",
                source_type="external",
                source_name="Cointelegraph",
                source_item_id="ct-c",
                title="Earliest ingest",
                source_url="https://example.com/c",
                content_raw="C",
                summary_ai="C",
                signal="NEUTRAL",
                confidence=0.5,
                reasoning="C",
                category="macro",
                published_at=datetime(2026, 4, 2, 10, 0, 0),
                ingested_at=datetime(2026, 4, 4, 10, 0, 0),
                score=0.5,
                source_score=0.5,
                confirmation_count=1,
                is_active=True,
            ),
        ]
    )
    await db_session.commit()

    first_page = await query_intel_feed(db_session, limit=2)

    assert [item["id"] for item in first_page["items"]] == ["intel-a", "intel-b"]
    assert first_page["next_cursor"] == "2026-04-04T11:00:00|intel-b"

    second_page = await query_intel_feed(db_session, limit=2, cursor=first_page["next_cursor"])

    assert [item["id"] for item in second_page["items"]] == ["intel-c"]
    assert second_page["next_cursor"] is None


@pytest.mark.asyncio
async def test_intel_filters_requires_auth(client):
    response = await client.get("/api/v1/intel/filters")
    assert response.status_code == 401
