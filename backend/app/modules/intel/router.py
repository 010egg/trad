from fastapi import APIRouter, Depends, HTTPException, Query

from app.deps import DB
from app.modules.auth.models import User
from app.modules.auth.router import get_current_user
from app.modules.intel.schemas import (
    IntelChatRequest,
    IntelChatResponse,
    IntelFeedResponse,
    IntelFiltersResponse,
    IntelRefreshResponse,
)
from app.modules.intel.service import (
    chat_with_intel_assistant,
    chat_with_intel_item,
    get_intel_detail,
    get_intel_filters,
    query_intel_feed,
    schedule_refresh_if_stale,
    trigger_intel_refresh,
)
from app.modules.trade.service import TradeService, build_user_llm_runtime_config, has_custom_llm_settings

router = APIRouter()


def _wrap(data):
    return {"code": 0, "data": data, "message": "ok"}


@router.get("/feed")
async def get_feed(
    db: DB,
    user: User = Depends(get_current_user),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    symbol: str | None = Query(default=None),
    category: str | None = Query(default=None),
    signal: str | None = Query(default=None),
    q: str | None = Query(default=None),
    min_confidence: float | None = Query(default=None, ge=0.0, le=1.0),
):
    trade_service = TradeService(db, user.id)
    trade_settings = await trade_service.get_trade_settings()
    llm_config = build_user_llm_runtime_config(trade_settings)
    allow_env_fallback = not has_custom_llm_settings(trade_settings)
    data = await query_intel_feed(
        db,
        cursor=cursor,
        limit=limit,
        symbol=symbol,
        category=category,
        signal=signal,
        q=q,
        min_confidence=min_confidence,
    )
    if data["stale"]:
        await schedule_refresh_if_stale(
            db,
            llm_config=llm_config,
            allow_env_fallback=allow_env_fallback,
        )
    return _wrap(IntelFeedResponse(**data).model_dump())


@router.get("/filters")
async def filters(user: User = Depends(get_current_user)):
    del user
    return _wrap(IntelFiltersResponse(**get_intel_filters()).model_dump())


@router.get("/{item_id}")
async def detail(item_id: str, db: DB, user: User = Depends(get_current_user)):
    del user
    data = await get_intel_detail(db, item_id)
    if data is None:
        raise HTTPException(status_code=404, detail="情报不存在")
    return _wrap(data)


@router.post("/refresh")
async def refresh(db: DB, user: User = Depends(get_current_user)):
    trade_service = TradeService(db, user.id)
    trade_settings = await trade_service.get_trade_settings()
    result = await trigger_intel_refresh(
        db,
        llm_config=build_user_llm_runtime_config(trade_settings),
        allow_env_fallback=not has_custom_llm_settings(trade_settings),
    )
    return _wrap(IntelRefreshResponse(**result).model_dump())


@router.post("/chat")
async def global_chat(req: IntelChatRequest, db: DB, user: User = Depends(get_current_user)):
    trade_service = TradeService(db, user.id)
    trade_settings = await trade_service.get_trade_settings()
    try:
        data = await chat_with_intel_assistant(
            req.question,
            [message.model_dump() for message in req.history],
            llm_config=build_user_llm_runtime_config(trade_settings),
            allow_env_fallback=not has_custom_llm_settings(trade_settings),
            user_settings=trade_settings,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _wrap(IntelChatResponse(**data).model_dump())


@router.post("/{item_id}/chat")
async def chat(item_id: str, req: IntelChatRequest, db: DB, user: User = Depends(get_current_user)):
    trade_service = TradeService(db, user.id)
    trade_settings = await trade_service.get_trade_settings()
    try:
        data = await chat_with_intel_item(
            db,
            item_id,
            req.question,
            [message.model_dump() for message in req.history],
            llm_config=build_user_llm_runtime_config(trade_settings),
            allow_env_fallback=not has_custom_llm_settings(trade_settings),
            user_settings=trade_settings,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if data is None:
        raise HTTPException(status_code=404, detail="情报不存在")
    return _wrap(IntelChatResponse(**data).model_dump())
