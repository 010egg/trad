import asyncio
from time import monotonic
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.deps import DB
from app.modules.auth.models import User
from app.modules.auth.router import get_current_user
from app.modules.trade.models import Order
from app.modules.trade.schemas import (
    CreateOrderRequest,
    LlmConnectivityTestRequest,
    LlmConnectivityTestResponse,
    OrderResponse,
    TradeSettingsResponse,
    TradeSettingsUpdate,
)
from app.modules.trade.service import TradeService, normalize_llm_base_url, serialize_trade_settings
from app.modules.market.service import fetch_current_prices
from app.modules.account.service import decrypt_value
from app.modules.intel.service import test_llm_connectivity

router = APIRouter()
LIVE_POSITIONS_TTL_SECONDS = 3.0
_live_positions_cache: dict[tuple[str, str, str], tuple[float, list[dict]]] = {}
_live_positions_inflight: dict[tuple[str, str, str], asyncio.Task[list[dict]]] = {}


def _wrap(data):
    return {"code": 0, "data": data, "message": "ok"}


def _ensure_ascii_input(value: str, field_name: str) -> str:
    try:
        value.encode("ascii")
    except UnicodeEncodeError as exc:
        bad_char = value[exc.start:exc.start + 1]
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} 包含非法字符 `{bad_char}`，请检查是否粘贴了表格分隔符、中文标点或不可见字符",
        ) from exc
    return value


def _validate_base_url(base_url: str) -> str:
    base_url = _ensure_ascii_input(base_url.strip(), "Base URL")
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Base URL 格式无效，需要以 http:// 或 https:// 开头")
    return base_url


def _validate_llm_provider(provider: str) -> str:
    provider = provider.strip().upper()
    if provider not in {"OPENAI", "ANTHROPIC"}:
        raise HTTPException(status_code=400, detail="协议类型无效，仅支持 OPENAI 或 ANTHROPIC")
    return provider


def _positions_cache_key(user_id: str, trade_mode: str, market: str) -> tuple[str, str, str]:
    return (user_id, trade_mode, market)


def _get_cached_positions(key: tuple[str, str, str]) -> list[dict] | None:
    cached = _live_positions_cache.get(key)
    if not cached:
        return None

    cached_at, positions = cached
    if monotonic() - cached_at > LIVE_POSITIONS_TTL_SECONDS:
        _live_positions_cache.pop(key, None)
        return None

    return positions


def _set_cached_positions(key: tuple[str, str, str], positions: list[dict]) -> None:
    _live_positions_cache[key] = (monotonic(), positions)


def _invalidate_live_positions_cache(user_id: str) -> None:
    for key in [key for key in _live_positions_cache if key[0] == user_id]:
        _live_positions_cache.pop(key, None)
    for key in [key for key in _live_positions_inflight if key[0] == user_id]:
        _live_positions_inflight.pop(key, None)


async def _build_live_positions(service: TradeService) -> list[dict]:
    live_positions = await service.get_live_positions()
    symbols = [position["symbol"] for position in live_positions]
    current_prices = await fetch_current_prices(symbols) if symbols else {}

    positions = []
    for position in live_positions:
        symbol = position["symbol"]
        current_price = current_prices.get(symbol, 0.0)
        entry_price = position["entry_price"]

        if entry_price > 0 and current_price > 0:
            price_change_pct = ((current_price - entry_price) / entry_price) * 100
            unrealized_pnl = (current_price - entry_price) * position["quantity"]
        else:
            price_change_pct = 0.0
            unrealized_pnl = 0.0

        positions.append({
            "symbol": symbol,
            "side": position["side"],
            "quantity": position["quantity"],
            "entry_price": entry_price,
            "current_price": current_price,
            "price_change_pct": price_change_pct,
            "unrealized_pnl": unrealized_pnl,
            "order_id": None,
            "trade_mode": "LIVE",
        })

    positions.sort(
        key=lambda pos: pos.get("quantity", 0) * pos.get("current_price", 0),
        reverse=True,
    )
    return positions


# ============ 交易设置 ============


@router.get("/settings")
async def get_settings(db: DB, user: User = Depends(get_current_user)):
    """获取交易设置"""
    service = TradeService(db, user.id)
    settings = await service.get_trade_settings()
    return _wrap(TradeSettingsResponse(**serialize_trade_settings(settings)).model_dump())


@router.put("/settings")
async def update_settings(
    req: TradeSettingsUpdate, db: DB, user: User = Depends(get_current_user)
):
    """更新交易设置"""
    service = TradeService(db, user.id)
    try:
        settings = await service.update_trade_settings(
            trade_mode=req.trade_mode,
            default_market=req.default_market,
            default_leverage=req.default_leverage,
            llm_enabled=req.llm_enabled,
            llm_provider=req.llm_provider,
            llm_base_url=req.llm_base_url,
            llm_model=req.llm_model,
            llm_system_prompt=req.llm_system_prompt,
            llm_api_key=req.llm_api_key,
        )
        _invalidate_live_positions_cache(user.id)
        return _wrap(TradeSettingsResponse(**serialize_trade_settings(settings)).model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/settings/llm-test")
async def llm_test_connection(
    req: LlmConnectivityTestRequest,
    db: DB,
    user: User = Depends(get_current_user),
):
    service = TradeService(db, user.id)
    settings = await service.get_trade_settings()
    provider = _validate_llm_provider(req.provider)

    base_url = _validate_base_url(normalize_llm_base_url(provider, req.base_url))
    model = req.model.strip()
    if not base_url:
        raise HTTPException(status_code=400, detail="Base URL 不能为空")
    if not model:
        raise HTTPException(status_code=400, detail="模型名称不能为空")

    api_key = (req.api_key or "").strip()
    if not api_key and req.use_saved_api_key and settings.llm_api_key_enc:
        try:
            api_key = decrypt_value(settings.llm_api_key_enc)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="已保存的 API Key 无法解密，请重新填写") from exc

    if not api_key:
        raise HTTPException(status_code=400, detail="API Key 不能为空")
    api_key = _ensure_ascii_input(api_key, "API Key")

    try:
        result = await test_llm_connectivity({
            "provider": provider,
            "base_url": base_url,
            "model": model,
            "api_key": api_key,
        })
        return _wrap(LlmConnectivityTestResponse(**result).model_dump())
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ============ 订单 ============


@router.post("/orders")
async def create_order(
    req: CreateOrderRequest, db: DB, user: User = Depends(get_current_user)
):
    """创建订单"""
    if not req.trade_reason or len(req.trade_reason.strip()) == 0:
        raise HTTPException(status_code=422, detail="交易理由不能为空")

    service = TradeService(db, user.id)
    # 获取账户余额（暂时使用默认值，真实余额后续从 account 模块获取）
    account_balance = 10000.0  # TODO: 从 account 模块获取真实余额

    try:
        order = await service.create_order(req, account_balance)
        _invalidate_live_positions_cache(user.id)
        return _wrap(
            OrderResponse(
                id=order.id,
                symbol=order.symbol,
                side=order.side,
                position_side=order.position_side,
                order_type=order.order_type,
                quantity=float(order.quantity),
                price=float(order.price) if order.price else None,
                stop_loss=float(order.stop_loss),
                take_profit=float(order.take_profit) if order.take_profit else None,
                trade_reason=order.trade_reason,
                status=order.status,
            ).model_dump()
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/orders")
async def list_orders(db: DB, user: User = Depends(get_current_user)):
    """查询订单列表"""
    result = await db.execute(
        select(Order)
        .where(Order.user_id == user.id)
        .order_by(Order.created_at.desc())
        .limit(50)
    )
    orders = result.scalars().all()
    return _wrap(
        [
            OrderResponse(
                id=o.id,
                symbol=o.symbol,
                side=o.side,
                position_side=o.position_side,
                order_type=o.order_type,
                quantity=float(o.quantity),
                price=float(o.price) if o.price else None,
                stop_loss=float(o.stop_loss),
                take_profit=float(o.take_profit) if o.take_profit else None,
                trade_reason=o.trade_reason,
                status=o.status,
            ).model_dump()
            for o in orders
        ]
    )


# ============ 持仓 ============


@router.get("/positions")
async def list_positions(db: DB, user: User = Depends(get_current_user)):
    """查询持仓列表（包含模拟持仓和真实持仓）"""
    service = TradeService(db, user.id)
    settings = await service.get_trade_settings()

    positions = []

    # 1. 模拟模式持仓（从数据库查询）
    if settings.trade_mode == "SIMULATED":
        result = await db.execute(
            select(Order).where(
                Order.user_id == user.id, Order.status == "FILLED", Order.pnl.is_(None)
            )
        )
        orders = result.scalars().all()
        # 获取所有持仓的交易对
        order_symbols = list(set([p.symbol for p in orders]))
        current_prices = await fetch_current_prices(order_symbols) if order_symbols else {}

        for p in orders:
            entry_price = float(p.filled_price or p.price or 0)
            current_price = current_prices.get(p.symbol, 0.0)
            # 计算涨跌幅
            if entry_price > 0 and current_price > 0:
                price_change_pct = ((current_price - entry_price) / entry_price) * 100
                unrealized_pnl = (current_price - entry_price) * float(p.quantity)
            else:
                price_change_pct = 0.0
                unrealized_pnl = 0.0

            positions.append({
                "symbol": p.symbol,
                "side": p.position_side,
                "quantity": float(p.quantity),
                "entry_price": entry_price,
                "current_price": current_price,
                "price_change_pct": price_change_pct,
                "unrealized_pnl": unrealized_pnl,
                "order_id": p.id,
                "trade_mode": "SIMULATED",
            })
    # 2. 真实模式持仓（从 Binance API 查询）
    else:
        cache_key = _positions_cache_key(user.id, settings.trade_mode, settings.default_market)
        cached_positions = _get_cached_positions(cache_key)
        if cached_positions is not None:
            return _wrap(cached_positions)

        task = _live_positions_inflight.get(cache_key)
        if task is None:
            task = asyncio.create_task(_build_live_positions(service))
            _live_positions_inflight[cache_key] = task

        try:
            positions = await task
        except RuntimeError as e:
            raise HTTPException(status_code=502, detail=str(e))
        finally:
            if _live_positions_inflight.get(cache_key) is task:
                _live_positions_inflight.pop(cache_key, None)

        _set_cached_positions(cache_key, positions)
        return _wrap(positions)

    # 按总价值排序（quantity * current_price）
    positions.sort(key=lambda pos: pos.get("quantity", 0) * pos.get("current_price", 0), reverse=True)

    return _wrap(positions)


@router.post("/positions/{order_id}/close")
async def close_position(
    order_id: str, db: DB, user: User = Depends(get_current_user)
):
    """平仓"""
    service = TradeService(db, user.id)
    try:
        order = await service.close_position(order_id)
        _invalidate_live_positions_cache(user.id)
        return _wrap({"success": True, "order_id": order.id})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
