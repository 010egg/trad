from __future__ import annotations

import asyncio
import json
import os
import re
import xml.etree.ElementTree as ET
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from html import unescape
from time import monotonic
from typing import Any, AsyncIterator
from urllib.parse import urlparse

import httpx
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import async_session
from app.modules.intel.models import IntelItem, IntelItemSymbol
from app.modules.intel.prompts import get_default_intel_system_prompt
from app.modules.market.service import SUPPORTED_SYMBOLS

PROXY = os.environ.get("http_proxy") or os.environ.get("HTTP_PROXY")
BINANCE_ANNOUNCEMENTS_URL = "https://www.binance.com/bapi/composite/v1/public/cms/article/list/query"
BINANCE_ANNOUNCEMENTS_MAX_PAGE_SIZE = 5
COINTELEGRAPH_RSS_URL = "https://cointelegraph.com/rss"
COINDESK_RSS_URL = "https://www.coindesk.com/arc/outboundfeeds/rss/"
DECRYPT_RSS_URL = "https://decrypt.co/feed"
THEBLOCK_RSS_URL = "https://www.theblock.co/rss.xml"
FRED_BASE_URL = "https://api.stlouisfed.org/fred"

FRED_SERIES = [
    {"id": "DFF", "name": "联邦基金利率", "unit": "%"},
    {"id": "CPIAUCSL", "name": "CPI通胀指数", "unit": "点"},
    {"id": "UNRATE", "name": "美国失业率", "unit": "%"},
    {"id": "DGS10", "name": "10年期美债收益率", "unit": "%"},
    {"id": "M2SL", "name": "M2货币供应量", "unit": "十亿美元"},
]
INTEL_REFRESH_TTL = timedelta(minutes=5)
INTEL_REFRESH_WAIT_SECONDS = 2.0
INTEL_ENRICH_CONCURRENCY = 4
INTEL_CHAT_MAX_TOKENS = 1200
INTEL_CHAT_REPLY_CHAR_LIMIT = 4000

SIGNAL_VALUES = {"BULLISH", "BEARISH", "NEUTRAL"}
CATEGORY_VALUES = {"macro", "onchain", "exchange", "regulation", "project"}
FILTER_CATEGORIES = ["macro", "onchain", "exchange", "regulation", "project"]
FILTER_SIGNALS = ["BULLISH", "BEARISH", "NEUTRAL"]
SUPPORTED_INTEL_SYMBOLS = [item["symbol"] for item in SUPPORTED_SYMBOLS]

SYMBOL_ALIASES = {
    "BTCUSDT": ["BTC", "BITCOIN"],
    "ETHUSDT": ["ETH", "ETHER", "ETHEREUM"],
    "BNBUSDT": ["BNB", "BINANCE COIN"],
    "SOLUSDT": ["SOL", "SOLANA"],
    "XRPUSDT": ["XRP", "RIPPLE"],
    "DOGEUSDT": ["DOGE", "DOGECOIN"],
}

POSITIVE_KEYWORDS = {
    "APPROVAL",
    "APPROVE",
    "LAUNCH",
    "LISTING",
    "LIST",
    "ETF",
    "SURGE",
    "GROWTH",
    "REBOUND",
    "PARTNERSHIP",
    "UPGRADE",
    "EXPANDS",
    "INFLOW",
}
NEGATIVE_KEYWORDS = {
    "HACK",
    "EXPLOIT",
    "BAN",
    "LAWSUIT",
    "OUTFLOW",
    "DELIST",
    "LIQUIDATION",
    "ATTACK",
    "FRAUD",
    "FALL",
    "CRASH",
    "SANCTION",
    "WAR",
}

_refresh_lock = asyncio.Lock()
_refresh_task: asyncio.Task[dict[str, Any]] | None = None

# 来源可信度映射（部分匹配 source_name 小写）
SOURCE_CREDIBILITY: dict[str, float] = {
    "binance": 1.0,
    "okx": 1.0,
    "bybit": 0.95,
    "fred": 0.90,
    "coindesk": 0.85,
    "the block": 0.85,
    "reuters": 0.85,
    "bloomberg": 0.85,
    "cointelegraph": 0.75,
    "decrypt": 0.65,
}


def _source_score(source_name: str) -> float:
    key = source_name.lower()
    for name, score in SOURCE_CREDIBILITY.items():
        if name in key:
            return score
    return 0.50


def _freshness_score(published_at: datetime | None, *, reference_at: datetime | None = None) -> float:
    if not published_at:
        return 0.5
    anchor = reference_at or _utc_now_naive()
    age_minutes = max((anchor - published_at).total_seconds() / 60, 0)
    if age_minutes <= 30:
        return 1.0
    if age_minutes <= 120:
        return 0.8
    if age_minutes <= 360:
        return 0.6
    if age_minutes <= 1440:
        return 0.3
    return 0.1


def _confirmation_score(count: int) -> float:
    if count <= 1:
        return 0.30
    if count == 2:
        return 0.60
    if count == 3:
        return 0.85
    return 1.0


def _multi_dim_confidence(
    source_score: float,
    freshness_score: float,
    confirmation_count: int,
    semantic_score: float,
) -> float:
    """四维加权置信度：来源30% + 时效20% + 多源印证20% + 语义30%"""
    return round(
        source_score * 0.30
        + freshness_score * 0.20
        + _confirmation_score(confirmation_count) * 0.20
        + semantic_score * 0.30,
        2,
    )


def _derive_semantic_score(
    confidence: float,
    source_score: float,
    freshness_score: float,
    confirmation_count: int,
) -> float:
    semantic_score = (
        confidence
        - source_score * 0.30
        - freshness_score * 0.20
        - _confirmation_score(confirmation_count) * 0.20
    ) / 0.30
    return round(max(0.0, min(semantic_score, 1.0)), 2)


def _utc_now_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _datetime_to_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.replace(tzinfo=UTC).isoformat()


def _strip_html(value: str | None) -> str:
    if not value:
        return ""
    cleaned = re.sub(r"<[^>]+>", " ", value)
    cleaned = re.sub(r"\s+", " ", unescape(cleaned))
    return cleaned.strip()


def _parse_published_at(value: str | int | float | None) -> datetime:
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value) / 1000, tz=UTC).replace(tzinfo=None)
    if isinstance(value, str) and value:
        normalized = value.strip()
        try:
            if normalized.endswith("Z"):
                normalized = f"{normalized[:-1]}+00:00"
            parsed = datetime.fromisoformat(normalized)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=UTC)
            return parsed.astimezone(UTC).replace(tzinfo=None)
        except ValueError:
            pass
        try:
            parsed = parsedate_to_datetime(normalized)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=UTC)
            return parsed.astimezone(UTC).replace(tzinfo=None)
        except Exception:
            pass
    return _utc_now_naive()


def _extract_symbols(text: str) -> list[str]:
    upper = text.upper()
    found: list[str] = []
    for symbol, aliases in SYMBOL_ALIASES.items():
        for alias in aliases + [symbol]:
            pattern = rf"(?<![A-Z0-9]){re.escape(alias)}(?![A-Z0-9])"
            if re.search(pattern, upper):
                found.append(symbol)
                break
    return list(dict.fromkeys(found))


def _infer_category(item: dict[str, Any]) -> str:
    source_name = str(item.get("source_name") or "")
    text = " ".join(
        str(item.get(key) or "")
        for key in ("title", "content_raw", "summary_ai", "source_url")
    ).upper()

    if "BINANCE" in source_name.upper():
        return "exchange"
    if any(word in text for word in ("SEC", "SENATOR", "REGULATION", "POLICY", "LAW", "BILL")):
        return "regulation"
    if any(word in text for word in ("ETF", "FED", "INFLATION", "RATE", "MACRO", "GOLD", "TREASURY")):
        return "macro"
    if any(word in text for word in ("STAKING", "VALIDATOR", "ONCHAIN", "BRIDGE", "WALLET", "L2", "MAINNET")):
        return "onchain"
    return "project"


def _infer_signal(item: dict[str, Any]) -> tuple[str, float, str]:
    """返回 (signal, semantic_score, reasoning)，semantic_score 仅为语义维度得分"""
    text = " ".join(
        str(item.get(key) or "")
        for key in ("title", "content_raw", "summary_ai")
    ).upper()

    positive_hits = sum(1 for word in POSITIVE_KEYWORDS if word in text)
    negative_hits = sum(1 for word in NEGATIVE_KEYWORDS if word in text)

    if positive_hits > negative_hits:
        semantic = min(0.90, 0.50 + 0.08 * positive_hits)
        return "BULLISH", semantic, "Keyword-based positive catalysts detected."
    if negative_hits > positive_hits:
        semantic = min(0.90, 0.50 + 0.08 * negative_hits)
        return "BEARISH", semantic, "Keyword-based downside risk detected."
    return "NEUTRAL", 0.35, "No directional catalyst was strong enough."


def _fallback_enrichment(item: dict[str, Any]) -> dict[str, Any]:
    symbols = _extract_symbols(" ".join(str(item.get(key) or "") for key in ("title", "content_raw")))
    signal, semantic_score, reasoning = _infer_signal(item)
    summary = _strip_html(str(item.get("content_raw") or "")) or str(item.get("title") or "")
    summary = summary[:280].strip()

    src_score = _source_score(str(item.get("source_name") or ""))
    fresh_score = _freshness_score(item.get("published_at"))
    # confirmation_count 在 upsert 阶段批量计算，此处先用 1
    confidence = _multi_dim_confidence(src_score, fresh_score, 1, semantic_score)

    return {
        **item,
        "summary_ai": summary,
        "signal": signal,
        "semantic_score": round(semantic_score, 2),
        "source_score": round(src_score, 2),
        "freshness_score": round(fresh_score, 2),
        "confidence": confidence,
        "reasoning": reasoning,
        "category": _infer_category(item),
        "symbols": [symbol for symbol in symbols if symbol in SUPPORTED_INTEL_SYMBOLS],
        "score": confidence,
    }


def _resolve_runtime_config(
    llm_config: dict[str, str] | None = None,
    *,
    allow_env_fallback: bool = True,
) -> dict[str, str] | None:
    if llm_config is not None:
        return llm_config
    if allow_env_fallback and settings.openai_api_key and settings.openai_base_url and settings.openai_model:
        return {
            "provider": "OPENAI",
            "api_key": settings.openai_api_key,
            "base_url": settings.openai_base_url,
            "model": settings.openai_model,
        }
    return None


def _resolve_system_prompt(runtime_config: dict[str, str] | None) -> str:
    custom_prompt = str((runtime_config or {}).get("system_prompt") or "").strip()
    return custom_prompt or get_default_intel_system_prompt()


def describe_llm_unavailable_reason(
    *,
    llm_config: dict[str, str] | None = None,
    allow_env_fallback: bool = True,
    user_settings: Any | None = None,
) -> str:
    if llm_config is not None:
        return "AI 未配置，请先到基础设置填写可用的模型接口"

    if user_settings is not None:
        if not bool(getattr(user_settings, "llm_enabled", False)) and (
            getattr(user_settings, "llm_base_url", None)
            or getattr(user_settings, "llm_model", None)
            or getattr(user_settings, "llm_api_key_enc", None)
        ):
            return "AI 已配置但未启用，请到基础设置打开“启用 AI 摘要与打分”并保存"

        if bool(getattr(user_settings, "llm_enabled", False)):
            missing_fields: list[str] = []
            if not getattr(user_settings, "llm_base_url", None):
                missing_fields.append("Base URL")
            if not getattr(user_settings, "llm_model", None):
                missing_fields.append("模型名称")
            if not getattr(user_settings, "llm_api_key_enc", None):
                missing_fields.append("API Key")
            if missing_fields:
                return f"AI 配置不完整，请补齐：{' / '.join(missing_fields)}"

    if not allow_env_fallback:
        return "AI 未配置，请先到基础设置填写可用的模型接口"

    return "AI 未配置，请先到基础设置填写可用的模型接口"


def _extract_json_block(value: str) -> dict[str, Any] | None:
    match = re.search(r"\{.*\}", value, re.DOTALL)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


async def _coerce_summary_to_json(
    runtime_config: dict[str, str],
    raw_content: str,
) -> dict[str, Any] | None:
    if not raw_content.strip():
        return None

    try:
        payload = await _request_chat_completion(
            runtime_config,
            [
                {
                    "role": "system",
                    "content": _resolve_system_prompt(runtime_config),
                },
                {
                    "role": "user",
                    "content": (
                        "请把下面这段市场情报分析内容转换成严格 JSON，且只能返回一个 JSON 对象，不要输出任何额外文字。\n"
                        "JSON keys 必须且只能是: summary, signal, confidence, reasoning, symbols, category。\n"
                        "约束:\n"
                        "- signal 只能是 BULLISH, BEARISH, NEUTRAL 之一\n"
                        "- category 只能是 macro, onchain, exchange, regulation, project 之一\n"
                        "- confidence 必须是 0 到 1 之间的数字\n"
                        "- symbols 必须是数组\n"
                        "- 第一个字符必须是 {，最后一个字符必须是 }\n\n"
                        "待转换内容:\n"
                        f"{raw_content[:3000]}"
                    ),
                },
            ],
            temperature=0.0,
            max_tokens=320,
        )
    except Exception:
        return None

    normalized = _extract_response_text(payload, str(runtime_config.get("provider") or "OPENAI"))
    return _extract_json_block(normalized)


def _clean_ai_text(value: str) -> str:
    text = re.sub(r"<think>.*?</think>", "", value, flags=re.DOTALL | re.IGNORECASE)
    text = text.replace("\r\n", "\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _build_chat_messages(runtime_config: dict[str, str], prompt: str) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": _resolve_system_prompt(runtime_config),
        },
        {
            "role": "user",
            "content": prompt,
        },
    ]


async def _iter_sse_events(response: httpx.Response) -> AsyncIterator[tuple[str, str]]:
    event_name = "message"
    data_lines: list[str] = []

    async for raw_line in response.aiter_lines():
        line = raw_line.rstrip("\r")
        if not line:
            if data_lines:
                yield event_name, "\n".join(data_lines)
            event_name = "message"
            data_lines = []
            continue

        if line.startswith(":"):
            continue

        field, _, raw_value = line.partition(":")
        value = raw_value[1:] if raw_value.startswith(" ") else raw_value
        if field == "event":
            event_name = value or "message"
        elif field == "data":
            data_lines.append(value)

    if data_lines:
        yield event_name, "\n".join(data_lines)


def _flatten_stream_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if not isinstance(value, list):
        return ""

    parts: list[str] = []
    for item in value:
        if isinstance(item, str):
            parts.append(item)
            continue
        if not isinstance(item, dict):
            continue
        text = item.get("text")
        if isinstance(text, str):
            parts.append(text)
            continue
        if isinstance(text, dict):
            nested_value = text.get("value")
            if isinstance(nested_value, str):
                parts.append(nested_value)
    return "".join(parts)


def _extract_openai_stream_text(payload: dict[str, Any]) -> str:
    choices = payload.get("choices") or []
    if not choices or not isinstance(choices[0], dict):
        return ""

    choice = choices[0]
    delta = choice.get("delta") or {}
    if isinstance(delta, dict):
        content = delta.get("content")
        text = _flatten_stream_text(content)
        if text:
            return text

    message = choice.get("message") or {}
    if isinstance(message, dict):
        return _flatten_stream_text(message.get("content"))

    return ""


def _extract_anthropic_stream_text(payload: dict[str, Any]) -> str:
    if payload.get("type") != "content_block_delta":
        return ""

    delta = payload.get("delta") or {}
    if not isinstance(delta, dict) or delta.get("type") != "text_delta":
        return ""
    return str(delta.get("text") or "")


def _extract_stream_error_message(payload: dict[str, Any]) -> str:
    error = payload.get("error")
    if isinstance(error, dict):
        message = error.get("message")
        if message:
            return str(message)
        detail = error.get("detail")
        if detail:
            return str(detail)
    if payload.get("message"):
        return str(payload["message"])
    return "流式响应失败"


def _extract_openai_stream_finish_reason(payload: dict[str, Any]) -> str:
    choices = payload.get("choices") or []
    if not choices or not isinstance(choices[0], dict):
        return ""
    finish_reason = choices[0].get("finish_reason")
    return str(finish_reason or "")


def _extract_anthropic_stream_finish_reason(payload: dict[str, Any]) -> str:
    if payload.get("type") != "message_delta":
        return ""

    delta = payload.get("delta") or {}
    if isinstance(delta, dict) and delta.get("stop_reason"):
        return str(delta["stop_reason"])
    if payload.get("stop_reason"):
        return str(payload["stop_reason"])
    return ""


async def _request_chat_completion_stream(
    runtime_config: dict[str, str],
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.2,
    max_tokens: int | None = None,
) -> AsyncIterator[dict[str, Any]]:
    provider = str(runtime_config.get("provider") or "OPENAI").upper()

    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True, proxy=PROXY) as client:
        if provider == "ANTHROPIC":
            system_prompt = ""
            user_content = ""
            for message in messages:
                if message["role"] == "system":
                    system_prompt = message["content"]
                elif message["role"] == "user":
                    user_content = message["content"]

            request_body: dict[str, Any] = {
                "model": runtime_config["model"],
                "temperature": temperature,
                "max_tokens": max_tokens or 512,
                "system": system_prompt,
                "stream": True,
                "messages": [
                    {
                        "role": "user",
                        "content": [{"type": "text", "text": user_content}],
                    }
                ],
            }

            async with client.stream(
                "POST",
                f"{runtime_config['base_url'].rstrip('/')}/v1/messages",
                headers={
                    "x-api-key": runtime_config["api_key"],
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                json=request_body,
            ) as response:
                response.raise_for_status()
                async for _, data in _iter_sse_events(response):
                    if not data:
                        continue
                    payload = json.loads(data)
                    if payload.get("type") == "error":
                        raise RuntimeError(_extract_stream_error_message(payload))

                    message = payload.get("message") or {}
                    if isinstance(message, dict) and message.get("model"):
                        yield {"type": "meta", "model": str(message["model"])}

                    finish_reason = _extract_anthropic_stream_finish_reason(payload)
                    if finish_reason:
                        yield {"type": "finish", "reason": finish_reason}

                    text = _extract_anthropic_stream_text(payload)
                    if text:
                        yield {"type": "delta", "content": text}
            return

        request_body = {
            "model": runtime_config["model"],
            "temperature": temperature,
            "messages": messages,
            "stream": True,
        }
        if max_tokens is not None:
            request_body["max_tokens"] = max_tokens

        async with client.stream(
            "POST",
            f"{runtime_config['base_url'].rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {runtime_config['api_key']}",
                "Content-Type": "application/json",
            },
            json=request_body,
        ) as response:
            response.raise_for_status()
            async for _, data in _iter_sse_events(response):
                if not data:
                    continue
                if data == "[DONE]":
                    break

                payload = json.loads(data)
                if payload.get("error"):
                    raise RuntimeError(_extract_stream_error_message(payload))

                if payload.get("model"):
                    yield {"type": "meta", "model": str(payload["model"])}

                finish_reason = _extract_openai_stream_finish_reason(payload)
                if finish_reason:
                    yield {"type": "finish", "reason": finish_reason}

                text = _extract_openai_stream_text(payload)
                if text:
                    yield {"type": "delta", "content": text}


async def _stream_chat_reply(
    runtime_config: dict[str, str],
    prompt: str,
    *,
    temperature: float = 0.3,
    max_tokens: int | None = 700,
) -> AsyncIterator[dict[str, Any]]:
    started_at = monotonic()
    model = str(runtime_config["model"])
    reply_parts: list[str] = []
    total_length = 0
    finish_reason = ""

    async for event in _request_chat_completion_stream(
        runtime_config,
        _build_chat_messages(runtime_config, prompt),
        temperature=temperature,
        max_tokens=max_tokens,
    ):
        if event["type"] == "meta":
            next_model = str(event.get("model") or "").strip()
            if next_model:
                model = next_model
            continue
        if event["type"] == "finish":
            finish_reason = str(event.get("reason") or "").strip()
            continue

        chunk = str(event.get("content") or "")
        if not chunk or total_length >= INTEL_CHAT_REPLY_CHAR_LIMIT:
            continue

        remaining = INTEL_CHAT_REPLY_CHAR_LIMIT - total_length
        clipped = chunk[:remaining]
        if not clipped:
            continue

        reply_parts.append(clipped)
        total_length += len(clipped)
        yield {"type": "delta", "content": clipped}

    reply = "".join(reply_parts).strip()
    if not reply:
        raise RuntimeError("AI 未返回有效内容")

    truncated = finish_reason in {"length", "max_tokens"} or total_length >= INTEL_CHAT_REPLY_CHAR_LIMIT
    payload = {
        "type": "done",
        "reply": reply,
        "model": model,
        "latency_ms": int((monotonic() - started_at) * 1000),
    }
    if truncated:
        payload["truncated"] = True
    yield payload


async def _request_chat_completion(
    runtime_config: dict[str, str],
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.2,
    max_tokens: int | None = None,
) -> dict[str, Any]:
    provider = str(runtime_config.get("provider") or "OPENAI").upper()

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, proxy=PROXY) as client:
        if provider == "ANTHROPIC":
            system_prompt = ""
            user_content = ""
            for message in messages:
                if message["role"] == "system":
                    system_prompt = message["content"]
                elif message["role"] == "user":
                    user_content = message["content"]

            request_body: dict[str, Any] = {
                "model": runtime_config["model"],
                "temperature": temperature,
                "max_tokens": max_tokens or 512,
                "system": system_prompt,
                "messages": [
                    {
                        "role": "user",
                        "content": [{"type": "text", "text": user_content}],
                    }
                ],
            }
            response = await client.post(
                f"{runtime_config['base_url'].rstrip('/')}/v1/messages",
                headers={
                    "x-api-key": runtime_config["api_key"],
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                json=request_body,
            )
            response.raise_for_status()
            return response.json()

        request_body = {
            "model": runtime_config["model"],
            "temperature": temperature,
            "messages": messages,
        }
        if max_tokens is not None:
            request_body["max_tokens"] = max_tokens

        response = await client.post(
            f"{runtime_config['base_url'].rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {runtime_config['api_key']}",
                "Content-Type": "application/json",
            },
            json=request_body,
        )
        response.raise_for_status()
        return response.json()


def _extract_response_text(payload: dict[str, Any], provider: str) -> str:
    provider = provider.upper()
    if provider == "ANTHROPIC":
        blocks = payload.get("content") or []
        text_blocks = [str(block.get("text") or "") for block in blocks if block.get("type") == "text"]
        if text_blocks:
            return _clean_ai_text("\n".join(part for part in text_blocks if part))
        thinking_blocks = [str(block.get("thinking") or "") for block in blocks if block.get("type") == "thinking"]
        return _clean_ai_text("\n".join(part for part in thinking_blocks if part))

    return _clean_ai_text(str(payload.get("choices", [{}])[0].get("message", {}).get("content") or ""))


def _minimax_expected_base_url(provider: str, base_url: str) -> str:
    provider = provider.upper()
    parsed = urlparse((base_url or "").strip())
    host = (parsed.netloc or "").lower()

    if host.endswith("minimaxi.com"):
        root = "https://api.minimaxi.com"
    elif host.endswith("minimax.io") or host.endswith("minimax.chat"):
        root = "https://api.minimax.io"
    else:
        root = "https://api.minimax.io"

    return f"{root}/anthropic" if provider == "ANTHROPIC" else f"{root}/v1"


async def test_llm_connectivity(runtime_config: dict[str, str]) -> dict[str, Any]:
    started_at = monotonic()
    provider = str(runtime_config.get("provider") or "OPENAI").upper()
    try:
        payload = await _request_chat_completion(
            runtime_config,
            [
                {
                    "role": "system",
                    "content": "You are a connectivity probe. Reply with OK only.",
                },
                {
                    "role": "user",
                    "content": "Return OK.",
                },
            ],
            temperature=0.0,
            max_tokens=8,
        )
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text.strip()[:240] or str(exc)
        if (
            provider == "ANTHROPIC"
            and exc.response.status_code == 404
            and ("minimax" in runtime_config["base_url"].lower() or "minimaxi" in runtime_config["base_url"].lower())
            and "/anthropic" not in runtime_config["base_url"].lower()
        ):
            detail = f"Anthropic 兼容协议应使用 {_minimax_expected_base_url(provider, runtime_config['base_url'])}，当前地址不是该入口"
        raise RuntimeError(f"模型接口返回错误：HTTP {exc.response.status_code}，{detail}") from exc
    except Exception as exc:
        raise RuntimeError(f"模型接口连接失败：{exc}") from exc

    latency_ms = int((monotonic() - started_at) * 1000)
    preview = _extract_response_text(payload, provider)
    return {
        "success": True,
        "latency_ms": latency_ms,
        "model": str(payload.get("model") or runtime_config["model"]),
        "preview": preview[:120] or "OK",
    }


def _serialize_chat_history(history: list[dict[str, str]]) -> str:
    lines: list[str] = []
    for message in history[-8:]:
        role = str(message.get("role") or "").lower()
        if role not in {"user", "assistant"}:
            continue
        content = re.sub(r"\s+", " ", str(message.get("content") or "")).strip()
        if not content:
            continue
        speaker = "用户" if role == "user" else "AI"
        lines.append(f"{speaker}: {content[:1200]}")
    return "\n".join(lines)


def _build_intel_chat_payload(item: IntelItem, question: str, history: list[dict[str, str]]) -> str:
    context = {
        "title": item.title,
        "source_name": item.source_name,
        "published_at": _datetime_to_iso(item.published_at),
        "category": item.category,
        "signal": item.signal,
        "confidence": round(float(item.confidence or 0.0), 2),
        "symbols": [link.symbol for link in item.symbol_links],
        "summary_ai": item.summary_ai,
        "reasoning": item.reasoning,
        "content_raw": _strip_html(item.content_raw)[:2200],
        "source_url": item.source_url,
    }
    transcript = _serialize_chat_history(history)
    return (
        "情报上下文:\n"
        f"{json.dumps(context, ensure_ascii=False)}\n\n"
        "已有对话:\n"
        f"{transcript or '无'}\n\n"
        "当前问题:\n"
        f"{question.strip()}\n\n"
        "请基于这条情报直接回答，重点说明影响逻辑、受影响标的、时间维度、风险点和后续观察信号。"
        "默认使用简洁 Markdown 输出，使用标题、列表和加粗组织信息，不要输出 HTML。"
        "观察清单请使用普通无序列表，不要使用任务列表复选框。"
    )


def _build_intel_summary_prompt(prompt_payload: dict[str, Any]) -> str:
    return (
        "请分析下面这条加密市场情报，并严格返回一个 JSON 对象，不要输出任何 JSON 之外的文字。\n"
        "JSON keys 必须且只能是: summary, signal, confidence, reasoning, symbols, category。\n"
        "字段约束:\n"
        "- summary: 简洁摘要\n"
        "- signal: 只能是 BULLISH, BEARISH, NEUTRAL 之一\n"
        "- confidence: 0 到 1 之间的数字\n"
        "- reasoning: 简洁说明判断逻辑\n"
        "- symbols: 只能从 supported_symbols 中选择，可为空数组\n"
        "- category: 只能是 macro, onchain, exchange, regulation, project 之一\n"
        "- 第一个字符必须是 {，最后一个字符必须是 }\n\n"
        "输入数据:\n"
        f"{json.dumps(prompt_payload, ensure_ascii=False)}"
    )


def _build_general_chat_payload(question: str, history: list[dict[str, str]]) -> str:
    transcript = _serialize_chat_history(history)
    return (
        "当前没有绑定具体情报，作为全局加密市场助手回答。\n"
        "如果用户的问题缺少上下文，可以先给出保守判断，再明确说明还需要哪些信息。\n\n"
        "已有对话:\n"
        f"{transcript or '无'}\n\n"
        "当前问题:\n"
        f"{question.strip()}\n\n"
        "请直接回答，优先给出结论、核心逻辑、风险点和后续观察信号。"
        "默认使用简洁 Markdown 输出，使用标题、列表和加粗组织信息，不要输出 HTML。"
        "观察清单请使用普通无序列表，不要使用任务列表复选框。"
    )


async def fetch_binance_announcements(limit: int = 8) -> list[dict[str, Any]]:
    # Binance's CMS endpoint rejects pageSize values above 5, so fetch larger
    # result sets across multiple pages.
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True, proxy=PROXY) as client:
        items: list[dict[str, Any]] = []
        seen_codes: set[str] = set()
        page_no = 1

        while len(items) < limit:
            page_size = min(limit - len(items), BINANCE_ANNOUNCEMENTS_MAX_PAGE_SIZE)
            response = await client.get(
                BINANCE_ANNOUNCEMENTS_URL,
                params={"type": 1, "pageNo": page_no, "pageSize": page_size},
            )
            response.raise_for_status()
            payload = response.json()

            added_in_page = 0
            for catalog in payload.get("data", {}).get("catalogs", []):
                for article in catalog.get("articles", []):
                    code = str(article.get("code") or "")
                    title = str(article.get("title") or "").strip()
                    if not code or not title or code in seen_codes:
                        continue
                    seen_codes.add(code)
                    items.append(
                        {
                            "source_type": "external",
                            "source_name": "Binance Announcements",
                            "source_item_id": code,
                            "title": title,
                            "source_url": f"https://www.binance.com/en/support/announcement/detail/{code}",
                            "content_raw": title,
                            "published_at": _parse_published_at(article.get("releaseDate")),
                            "category": "exchange",
                        }
                    )
                    added_in_page += 1
                    if len(items) >= limit:
                        return items

            if added_in_page == 0:
                break
            page_no += 1
    return items


async def fetch_cointelegraph_items(limit: int = 12) -> list[dict[str, Any]]:
    return await fetch_rss_items(
        source_name="Cointelegraph",
        rss_url=COINTELEGRAPH_RSS_URL,
        limit=limit,
    )


async def fetch_rss_items(
    *,
    source_name: str,
    rss_url: str,
    limit: int = 12,
    category: str | None = None,
) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True, proxy=PROXY) as client:
        response = await client.get(rss_url)
        response.raise_for_status()
        payload = response.text

    root = ET.fromstring(payload)
    channel = root.find("channel")
    if channel is None:
        return []

    items: list[dict[str, Any]] = []
    for entry in channel.findall("item")[:limit]:
        title = (entry.findtext("title") or "").strip()
        link = (entry.findtext("link") or "").strip()
        guid = (entry.findtext("guid") or link).strip()
        description = _strip_html(entry.findtext("description") or "")
        if not title or not link:
            continue
        item = {
            "source_type": "external",
            "source_name": source_name,
            "source_item_id": guid,
            "title": title,
            "source_url": link,
            "content_raw": description or title,
            "published_at": _parse_published_at(entry.findtext("pubDate")),
        }
        if category:
            item["category"] = category
        items.append(item)
    return items


async def fetch_coindesk_items(limit: int = 10) -> list[dict[str, Any]]:
    return await fetch_rss_items(
        source_name="CoinDesk",
        rss_url=COINDESK_RSS_URL,
        limit=limit,
    )


async def fetch_decrypt_items(limit: int = 10) -> list[dict[str, Any]]:
    return await fetch_rss_items(
        source_name="Decrypt",
        rss_url=DECRYPT_RSS_URL,
        limit=limit,
    )


async def fetch_theblock_items(limit: int = 8) -> list[dict[str, Any]]:
    return await fetch_rss_items(
        source_name="The Block",
        rss_url=THEBLOCK_RSS_URL,
        limit=limit,
    )


async def fetch_fred_items() -> list[dict[str, Any]]:
    """从 FRED 获取关键宏观经济指标，写入情报 feed。"""
    api_key = settings.fred_api_key
    if not api_key:
        return []

    items: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True, proxy=PROXY) as client:
        for series in FRED_SERIES:
            try:
                resp = await client.get(
                    f"{FRED_BASE_URL}/series/observations",
                    params={
                        "series_id": series["id"],
                        "api_key": api_key,
                        "file_type": "json",
                        "limit": 2,
                        "sort_order": "desc",
                    },
                )
                resp.raise_for_status()
                observations = resp.json().get("observations", [])
                if not observations:
                    continue

                latest = observations[0]
                raw_value = latest.get("value", ".")
                if raw_value == ".":
                    continue

                value = float(raw_value)
                date = latest.get("date", "")

                change_text = ""
                if len(observations) > 1:
                    prev_raw = observations[1].get("value", ".")
                    if prev_raw != ".":
                        prev_value = float(prev_raw)
                        diff = value - prev_value
                        if abs(diff) > 0.001:
                            change_text = f"，较上期 {'+' if diff > 0 else ''}{diff:.2f}{series['unit']}"
                        else:
                            change_text = "，与上期持平"

                title = f"【宏观】{series['name']}：{value:.2f}{series['unit']}{change_text}（{date}）"
                content = (
                    f"FRED 数据更新：{series['name']}（{series['id']}）"
                    f"最新值 {value:.2f}{series['unit']}，数据日期 {date}。"
                    f"{change_text.lstrip('，') if change_text else ''}"
                )
                items.append(
                    {
                        "source_type": "external",
                        "source_name": "FRED",
                        "source_item_id": f"{series['id']}_{date}",
                        "title": title,
                        "source_url": f"https://fred.stlouisfed.org/series/{series['id']}",
                        "content_raw": content,
                        "published_at": _parse_published_at(date),
                        "category": "macro",
                    }
                )
            except Exception as exc:
                print(f"[Intel] FRED fetch failed for {series['id']}: {exc}")

    return items


async def fetch_external_intel_items() -> list[dict[str, Any]]:
    feeds = await asyncio.gather(
        fetch_binance_announcements(),
        fetch_cointelegraph_items(),
        fetch_coindesk_items(),
        fetch_decrypt_items(),
        fetch_theblock_items(),
        fetch_fred_items(),
        return_exceptions=True,
    )

    entries: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for payload in feeds:
        if isinstance(payload, Exception):
            print(f"[Intel] feed fetch failed: {payload}")
            continue
        for item in payload:
            dedupe_key = (str(item.get("source_name") or ""), str(item.get("source_item_id") or item.get("source_url") or ""))
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            entries.append(item)

    entries.sort(key=lambda item: item.get("published_at") or _utc_now_naive(), reverse=True)
    return entries
async def enrich_intel_item(
    item: dict[str, Any],
    llm_config: dict[str, str] | None = None,
    *,
    allow_env_fallback: bool = True,
) -> dict[str, Any]:
    enriched = _fallback_enrichment(item)
    runtime_config = _resolve_runtime_config(
        llm_config,
        allow_env_fallback=allow_env_fallback,
    )
    if not runtime_config:
        return enriched

    prompt_payload = {
        "title": item.get("title", ""),
        "source_name": item.get("source_name", ""),
        "content": _strip_html(str(item.get("content_raw") or ""))[:1500],
        "supported_symbols": SUPPORTED_INTEL_SYMBOLS,
        "allowed_categories": sorted(CATEGORY_VALUES),
        "allowed_signals": sorted(SIGNAL_VALUES),
    }

    try:
        payload = await _request_chat_completion(
            runtime_config,
            [
                {
                    "role": "system",
                    "content": _resolve_system_prompt(runtime_config),
                },
                {"role": "user", "content": _build_intel_summary_prompt(prompt_payload)},
            ],
            temperature=0.2,
        )
        content = _extract_response_text(payload, str(runtime_config.get("provider") or "OPENAI"))
        parsed = _extract_json_block(content)
        if not parsed:
            parsed = await _coerce_summary_to_json(runtime_config, content)
        if not parsed:
            return enriched
    except Exception as exc:
        print(f"[Intel] AI enrichment failed: {exc}")
        return enriched

    signal = str(parsed.get("signal") or enriched["signal"]).upper()
    if signal not in SIGNAL_VALUES:
        signal = enriched["signal"]

    category = str(parsed.get("category") or enriched["category"]).lower()
    if category not in CATEGORY_VALUES:
        category = enriched["category"]

    symbols = [
        str(symbol).upper()
        for symbol in (parsed.get("symbols") or enriched["symbols"])
        if str(symbol).upper() in SUPPORTED_INTEL_SYMBOLS
    ]

    try:
        semantic_score = float(parsed.get("confidence", enriched.get("semantic_score", 0.5)))
    except Exception:
        semantic_score = float(enriched.get("semantic_score", 0.5))
    semantic_score = max(0.0, min(semantic_score, 1.0))

    src_score = float(enriched.get("source_score", 0.5))
    fresh_score = float(enriched.get("freshness_score", 0.5))
    confidence = _multi_dim_confidence(src_score, fresh_score, 1, semantic_score)

    summary = str(parsed.get("summary") or enriched["summary_ai"]).strip() or enriched["summary_ai"]
    reasoning = str(parsed.get("reasoning") or enriched["reasoning"]).strip() or enriched["reasoning"]

    return {
        **enriched,
        "summary_ai": summary[:480],
        "signal": signal,
        "semantic_score": round(semantic_score, 2),
        "source_score": round(src_score, 2),
        "freshness_score": round(fresh_score, 2),
        "confidence": confidence,
        "reasoning": reasoning[:320],
        "category": category,
        "symbols": list(dict.fromkeys(symbols)) or enriched["symbols"],
        "score": confidence,
    }


async def chat_with_intel_item(
    db: AsyncSession,
    item_id: str,
    question: str,
    history: list[dict[str, str]] | None = None,
    *,
    llm_config: dict[str, str] | None = None,
    allow_env_fallback: bool = True,
    user_settings: Any | None = None,
) -> dict[str, Any] | None:
    stmt = (
        select(IntelItem)
        .where(IntelItem.id == item_id, IntelItem.is_active.is_(True))
        .options(selectinload(IntelItem.symbol_links))
    )
    item = (await db.execute(stmt)).scalar_one_or_none()
    if item is None:
        return None

    runtime_config = _resolve_runtime_config(
        llm_config,
        allow_env_fallback=allow_env_fallback,
    )
    if runtime_config is None:
        raise RuntimeError(
            describe_llm_unavailable_reason(
                llm_config=llm_config,
                allow_env_fallback=allow_env_fallback,
                user_settings=user_settings,
            )
        )

    prompt = _build_intel_chat_payload(item, question, history or [])
    started_at = monotonic()
    try:
        payload = await _request_chat_completion(
            runtime_config,
            _build_chat_messages(runtime_config, prompt),
            temperature=0.3,
            max_tokens=INTEL_CHAT_MAX_TOKENS,
        )
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text.strip()[:240] or str(exc)
        raise RuntimeError(f"AI 分析失败：HTTP {exc.response.status_code}，{detail}") from exc
    except Exception as exc:
        raise RuntimeError(f"AI 分析失败：{exc}") from exc

    content = _extract_response_text(payload, str(runtime_config.get("provider") or "OPENAI")).strip()
    if not content:
        raise RuntimeError("AI 未返回有效内容")

    return {
        "reply": content[:4000],
        "model": str(payload.get("model") or runtime_config["model"]),
        "latency_ms": int((monotonic() - started_at) * 1000),
    }


async def chat_with_intel_assistant(
    question: str,
    history: list[dict[str, str]] | None = None,
    *,
    llm_config: dict[str, str] | None = None,
    allow_env_fallback: bool = True,
    user_settings: Any | None = None,
) -> dict[str, Any]:
    runtime_config = _resolve_runtime_config(
        llm_config,
        allow_env_fallback=allow_env_fallback,
    )
    if runtime_config is None:
        raise RuntimeError(
            describe_llm_unavailable_reason(
                llm_config=llm_config,
                allow_env_fallback=allow_env_fallback,
                user_settings=user_settings,
            )
        )

    prompt = _build_general_chat_payload(question, history or [])
    started_at = monotonic()
    try:
        payload = await _request_chat_completion(
            runtime_config,
            _build_chat_messages(runtime_config, prompt),
            temperature=0.3,
            max_tokens=INTEL_CHAT_MAX_TOKENS,
        )
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text.strip()[:240] or str(exc)
        raise RuntimeError(f"AI 分析失败：HTTP {exc.response.status_code}，{detail}") from exc
    except Exception as exc:
        raise RuntimeError(f"AI 分析失败：{exc}") from exc

    content = _extract_response_text(payload, str(runtime_config.get("provider") or "OPENAI")).strip()
    if not content:
        raise RuntimeError("AI 未返回有效内容")

    return {
        "reply": content[:4000],
        "model": str(payload.get("model") or runtime_config["model"]),
        "latency_ms": int((monotonic() - started_at) * 1000),
    }


async def stream_chat_with_intel_item(
    db: AsyncSession,
    item_id: str,
    question: str,
    history: list[dict[str, str]] | None = None,
    *,
    llm_config: dict[str, str] | None = None,
    allow_env_fallback: bool = True,
    user_settings: Any | None = None,
) -> AsyncIterator[dict[str, Any]] | None:
    stmt = (
        select(IntelItem)
        .where(IntelItem.id == item_id, IntelItem.is_active.is_(True))
        .options(selectinload(IntelItem.symbol_links))
    )
    item = (await db.execute(stmt)).scalar_one_or_none()
    if item is None:
        return None

    runtime_config = _resolve_runtime_config(
        llm_config,
        allow_env_fallback=allow_env_fallback,
    )
    if runtime_config is None:
        raise RuntimeError(
            describe_llm_unavailable_reason(
                llm_config=llm_config,
                allow_env_fallback=allow_env_fallback,
                user_settings=user_settings,
            )
        )

    prompt = _build_intel_chat_payload(item, question, history or [])
    return _stream_chat_reply(runtime_config, prompt, temperature=0.3, max_tokens=INTEL_CHAT_MAX_TOKENS)


async def stream_chat_with_intel_assistant(
    question: str,
    history: list[dict[str, str]] | None = None,
    *,
    llm_config: dict[str, str] | None = None,
    allow_env_fallback: bool = True,
    user_settings: Any | None = None,
) -> AsyncIterator[dict[str, Any]]:
    runtime_config = _resolve_runtime_config(
        llm_config,
        allow_env_fallback=allow_env_fallback,
    )
    if runtime_config is None:
        raise RuntimeError(
            describe_llm_unavailable_reason(
                llm_config=llm_config,
                allow_env_fallback=allow_env_fallback,
                user_settings=user_settings,
            )
        )

    prompt = _build_general_chat_payload(question, history or [])
    return _stream_chat_reply(runtime_config, prompt, temperature=0.3, max_tokens=INTEL_CHAT_MAX_TOKENS)


async def _find_existing_item(db: AsyncSession, payload: dict[str, Any]) -> IntelItem | None:
    source_name = str(payload.get("source_name") or "")
    source_item_id = str(payload.get("source_item_id") or "")
    source_url = str(payload.get("source_url") or "")

    if source_item_id:
        stmt = select(IntelItem).where(
            IntelItem.source_name == source_name,
            IntelItem.source_item_id == source_item_id,
        )
        existing = (await db.execute(stmt)).scalar_one_or_none()
        if existing is not None:
            return existing

    if source_url:
        stmt = select(IntelItem).where(
            IntelItem.source_name == source_name,
            IntelItem.source_url == source_url,
        )
        return (await db.execute(stmt)).scalar_one_or_none()

    return None


async def _sync_item_symbols(db: AsyncSession, item: IntelItem, symbols: list[str]) -> None:
    target = set(symbols)
    current = {link.symbol: link for link in item.symbol_links}

    for symbol, link in current.items():
        if symbol not in target:
            await db.delete(link)

    for symbol in target:
        if symbol not in current:
            db.add(IntelItemSymbol(intel_item_id=item.id, symbol=symbol))


def _compute_confirmation_counts(items: list[dict[str, Any]]) -> list[int]:
    """批内多源印证：同品种 + 发布时间相差 2 小时内的条目互相印证"""
    counts = [1] * len(items)
    for i, item in enumerate(items):
        symbols_i = set(item.get("symbols") or [])
        time_i: datetime | None = item.get("published_at")
        for j, other in enumerate(items):
            if i == j:
                continue
            symbols_j = set(other.get("symbols") or [])
            if not symbols_i or not symbols_j or not (symbols_i & symbols_j):
                continue
            time_j: datetime | None = other.get("published_at")
            if time_i and time_j and abs((time_i - time_j).total_seconds()) <= 7200:
                counts[i] += 1
    return counts


async def upsert_intel_items(db: AsyncSession, items: list[dict[str, Any]]) -> dict[str, int]:
    created = 0
    updated = 0
    now = _utc_now_naive()

    confirmation_counts = _compute_confirmation_counts(items)

    for idx, payload in enumerate(items):
        confirmation_count = confirmation_counts[idx]
        # 用最终 confirmation_count 重新计算置信度
        src_score = float(payload.get("source_score") or _source_score(str(payload.get("source_name") or "")))
        fresh_score = float(payload.get("freshness_score") or _freshness_score(payload.get("published_at")))
        semantic_score = float(payload.get("semantic_score") or payload.get("confidence") or 0.35)
        final_confidence = _multi_dim_confidence(src_score, fresh_score, confirmation_count, semantic_score)
        payload = {**payload, "confidence": final_confidence, "score": final_confidence,
                   "source_score": src_score, "confirmation_count": confirmation_count}

        existing = await _find_existing_item(db, payload)
        if existing is None:
            existing = IntelItem(
                source_type=str(payload.get("source_type") or "external"),
                source_name=str(payload.get("source_name") or "Unknown"),
                source_item_id=str(payload.get("source_item_id") or "") or None,
                title=str(payload.get("title") or ""),
                source_url=str(payload.get("source_url") or ""),
                content_raw=str(payload.get("content_raw") or ""),
                summary_ai=str(payload.get("summary_ai") or ""),
                signal=str(payload.get("signal") or "NEUTRAL"),
                confidence=float(payload.get("confidence") or 0.0),
                reasoning=str(payload.get("reasoning") or ""),
                category=str(payload.get("category") or "macro"),
                published_at=payload.get("published_at") or now,
                ingested_at=now,
                score=float(payload.get("score") or 0.0),
                source_score=float(payload.get("source_score") or 0.5),
                confirmation_count=int(payload.get("confirmation_count") or 1),
                is_active=True,
            )
            db.add(existing)
            await db.flush()
            created += 1
        else:
            existing.source_type = str(payload.get("source_type") or existing.source_type)
            existing.source_name = str(payload.get("source_name") or existing.source_name)
            existing.source_item_id = str(payload.get("source_item_id") or "") or existing.source_item_id
            existing.title = str(payload.get("title") or existing.title)
            existing.source_url = str(payload.get("source_url") or existing.source_url)
            existing.content_raw = str(payload.get("content_raw") or existing.content_raw)
            existing.summary_ai = str(payload.get("summary_ai") or existing.summary_ai)
            existing.signal = str(payload.get("signal") or existing.signal)
            existing.confidence = float(payload.get("confidence") or existing.confidence or 0.0)
            existing.reasoning = str(payload.get("reasoning") or existing.reasoning)
            existing.category = str(payload.get("category") or existing.category)
            existing.published_at = payload.get("published_at") or existing.published_at
            existing.ingested_at = now
            existing.score = float(payload.get("score") or existing.score or 0.0)
            existing.source_score = float(payload.get("source_score") or existing.source_score or 0.5)
            existing.confirmation_count = max(
                int(payload.get("confirmation_count") or 1),
                int(existing.confirmation_count or 1),
            )
            existing.is_active = True
            updated += 1

        await db.refresh(existing, attribute_names=["symbol_links"])
        await _sync_item_symbols(db, existing, payload.get("symbols") or [])

    return {"fetched": len(items), "created": created, "updated": updated}


async def get_last_refresh_at(db: AsyncSession) -> datetime | None:
    stmt = select(func.max(IntelItem.ingested_at)).where(IntelItem.is_active.is_(True))
    return (await db.execute(stmt)).scalar_one_or_none()


async def is_intel_stale(db: AsyncSession) -> bool:
    last_refreshed_at = await get_last_refresh_at(db)
    if last_refreshed_at is None:
        return True
    return (_utc_now_naive() - last_refreshed_at) > INTEL_REFRESH_TTL


async def refresh_intel_feed(
    db: AsyncSession,
    *,
    llm_config: dict[str, str] | None = None,
    allow_env_fallback: bool = True,
    force: bool = False,
) -> dict[str, Any]:
    async with _refresh_lock:
        if not force and not await is_intel_stale(db):
            last_refreshed_at = await get_last_refresh_at(db)
            return {
                "fetched": 0,
                "created": 0,
                "updated": 0,
                "last_refreshed_at": _datetime_to_iso(last_refreshed_at),
            }

        external_items = await fetch_external_intel_items()

        semaphore = asyncio.Semaphore(INTEL_ENRICH_CONCURRENCY)

        async def _enrich(item: dict[str, Any]) -> dict[str, Any]:
            async with semaphore:
                return await enrich_intel_item(
                    item,
                    llm_config=llm_config,
                    allow_env_fallback=allow_env_fallback,
                )

        enriched_items = await asyncio.gather(*[_enrich(item) for item in external_items])
        result = await upsert_intel_items(db, enriched_items)
        await db.commit()
        last_refreshed_at = await get_last_refresh_at(db)
        return {**result, "last_refreshed_at": _datetime_to_iso(last_refreshed_at)}


async def _background_refresh(
    llm_config: dict[str, str] | None = None,
    allow_env_fallback: bool = True,
    *,
    force: bool = False,
) -> None:
    global _refresh_task
    try:
        async with async_session() as db:
            return await refresh_intel_feed(
                db,
                llm_config=llm_config,
                allow_env_fallback=allow_env_fallback,
                force=force,
            )
    except Exception as exc:
        print(f"[Intel] background refresh failed: {exc}")
        return {
            "fetched": 0,
            "created": 0,
            "updated": 0,
            "last_refreshed_at": None,
            "queued": False,
        }
    finally:
        _refresh_task = None


async def schedule_refresh(
    db: AsyncSession,
    *,
    llm_config: dict[str, str] | None = None,
    allow_env_fallback: bool = True,
    force: bool = False,
) -> asyncio.Task[dict[str, Any]] | None:
    global _refresh_task
    if _refresh_task is not None and not _refresh_task.done():
        return _refresh_task
    if not force and not await is_intel_stale(db):
        return None
    _refresh_task = asyncio.create_task(
        _background_refresh(
            llm_config=llm_config,
            allow_env_fallback=allow_env_fallback,
            force=force,
        )
    )
    return _refresh_task


async def schedule_refresh_if_stale(
    db: AsyncSession,
    *,
    llm_config: dict[str, str] | None = None,
    allow_env_fallback: bool = True,
) -> bool:
    task = await schedule_refresh(
        db,
        llm_config=llm_config,
        allow_env_fallback=allow_env_fallback,
        force=False,
    )
    return task is not None


async def trigger_intel_refresh(
    db: AsyncSession,
    *,
    llm_config: dict[str, str] | None = None,
    allow_env_fallback: bool = True,
) -> dict[str, Any]:
    global _refresh_task
    if _refresh_task is not None and not _refresh_task.done():
        last_refreshed_at = await get_last_refresh_at(db)
        return {
            "fetched": 0,
            "created": 0,
            "updated": 0,
            "last_refreshed_at": _datetime_to_iso(last_refreshed_at),
            "queued": True,
        }

    try:
        result = await asyncio.wait_for(
            refresh_intel_feed(
                db,
                llm_config=llm_config,
                allow_env_fallback=allow_env_fallback,
                force=True,
            ),
            timeout=INTEL_REFRESH_WAIT_SECONDS,
        )
        result["queued"] = False
        return result
    except asyncio.TimeoutError:
        await schedule_refresh(
            db,
            llm_config=llm_config,
            allow_env_fallback=allow_env_fallback,
            force=True,
        )

    last_refreshed_at = await get_last_refresh_at(db)
    return {
        "fetched": 0,
        "created": 0,
        "updated": 0,
        "last_refreshed_at": _datetime_to_iso(last_refreshed_at),
        "queued": True,
    }


def _cursor_clause(cursor: str | None):
    if not cursor:
        return None
    if "|" not in cursor:
        return None
    ingested_at_raw, item_id = cursor.split("|", 1)
    try:
        ingested_at = datetime.fromisoformat(ingested_at_raw)
    except ValueError:
        return None
    return or_(
        IntelItem.ingested_at < ingested_at,
        and_(IntelItem.ingested_at == ingested_at, IntelItem.id < item_id),
    )


def serialize_intel_item(item: IntelItem) -> dict[str, Any]:
    confidence = round(float(item.confidence or 0.0), 2)
    source_score = round(float(item.source_score or 0.5), 2)
    confirmation_count = int(item.confirmation_count or 1)
    freshness_score = round(
        _freshness_score(item.published_at, reference_at=item.ingested_at),
        2,
    )
    semantic_score = _derive_semantic_score(
        confidence,
        source_score,
        freshness_score,
        confirmation_count,
    )

    return {
        "id": item.id,
        "source_type": item.source_type,
        "source_name": item.source_name,
        "title": item.title,
        "source_url": item.source_url,
        "summary_ai": item.summary_ai,
        "signal": item.signal,
        "confidence": confidence,
        "source_score": source_score,
        "freshness_score": freshness_score,
        "semantic_score": semantic_score,
        "confirmation_count": confirmation_count,
        "reasoning": item.reasoning,
        "category": item.category,
        "published_at": _datetime_to_iso(item.published_at),
        "ingested_at": _datetime_to_iso(item.ingested_at),
        "symbols": [link.symbol for link in item.symbol_links],
    }


async def query_intel_feed(
    db: AsyncSession,
    *,
    cursor: str | None = None,
    limit: int = 20,
    symbol: str | None = None,
    category: str | None = None,
    signal: str | None = None,
    q: str | None = None,
    min_confidence: float | None = None,
) -> dict[str, Any]:
    stmt = select(IntelItem).where(IntelItem.is_active.is_(True))

    if symbol:
        stmt = stmt.join(IntelItemSymbol).where(IntelItemSymbol.symbol == symbol.upper())
    if category:
        stmt = stmt.where(IntelItem.category == category.lower())
    if signal:
        stmt = stmt.where(IntelItem.signal == signal.upper())
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                IntelItem.title.ilike(like),
                IntelItem.summary_ai.ilike(like),
                IntelItem.content_raw.ilike(like),
            )
        )
    if min_confidence is not None:
        stmt = stmt.where(IntelItem.confidence >= min_confidence)

    cursor_filter = _cursor_clause(cursor)
    if cursor_filter is not None:
        stmt = stmt.where(cursor_filter)

    stmt = (
        stmt
        .options(selectinload(IntelItem.symbol_links))
        .order_by(IntelItem.ingested_at.desc(), IntelItem.published_at.desc(), IntelItem.id.desc())
        .limit(limit + 1)
    )

    rows = (await db.execute(stmt)).scalars().unique().all()
    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = None
    if has_more and items:
        tail = items[-1]
        next_cursor = f"{tail.ingested_at.isoformat()}|{tail.id}"

    return {
        "items": [serialize_intel_item(item) for item in items],
        "next_cursor": next_cursor,
        "stale": await is_intel_stale(db),
        "last_refreshed_at": _datetime_to_iso(await get_last_refresh_at(db)),
    }


async def get_intel_detail(db: AsyncSession, item_id: str) -> dict[str, Any] | None:
    stmt = (
        select(IntelItem)
        .where(IntelItem.id == item_id, IntelItem.is_active.is_(True))
        .options(selectinload(IntelItem.symbol_links))
    )
    item = (await db.execute(stmt)).scalar_one_or_none()
    return serialize_intel_item(item) if item is not None else None


def get_intel_filters() -> dict[str, list[str]]:
    return {
        "symbols": SUPPORTED_INTEL_SYMBOLS,
        "categories": FILTER_CATEGORIES,
        "signals": FILTER_SIGNALS,
    }
