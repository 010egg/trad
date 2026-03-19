import asyncio
from time import monotonic

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.deps import DB
from app.modules.auth.models import User
from app.modules.auth.router import get_current_user
from app.modules.trade.models import Order, TradeSettings
from app.modules.trade.schemas import (
    CreateOrderRequest,
    OrderResponse,
    TradeSettingsResponse,
    TradeSettingsUpdate,
)
from app.modules.trade.service import TradeService
from app.modules.market.service import fetch_current_prices

router = APIRouter()
LIVE_POSITIONS_TTL_SECONDS = 3.0
_live_positions_cache: dict[tuple[str, str, str], tuple[float, list[dict]]] = {}
_live_positions_inflight: dict[tuple[str, str, str], asyncio.Task[list[dict]]] = {}


def _wrap(data):
    return {"code": 0, "data": data, "message": "ok"}


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
    return _wrap(
        TradeSettingsResponse(
            trade_mode=settings.trade_mode,
            default_market=settings.default_market,
            default_leverage=settings.default_leverage,
        ).model_dump()
    )


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
        )
        _invalidate_live_positions_cache(user.id)
        return _wrap(
            TradeSettingsResponse(
                trade_mode=settings.trade_mode,
                default_market=settings.default_market,
                default_leverage=settings.default_leverage,
            ).model_dump()
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ============ 订单 ============


@router.post("/orders")
async def create_order(
    req: CreateOrderRequest, db: DB, user: User = Depends(get_current_user)
):
    """创建订单"""
    if not req.trade_reason or len(req.trade_reason.strip()) == 0:
        raise HTTPException(status_code=422, detail="交易理由不能为空")

    service = TradeService(db, user.id)
    settings = await service.get_trade_settings()

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
