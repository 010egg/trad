from fastapi import APIRouter, Depends

from app.deps import DB
from app.modules.auth.models import User
from app.modules.auth.router import get_current_user
from app.modules.risk.schemas import (
    RiskCheckRequest,
    RiskCheckResponse,
    RiskConfigResponse,
    RiskConfigUpdate,
    RiskStatusResponse,
)
from app.modules.risk.service import get_or_create_config, check_single_trade_risk, get_daily_loss_status

router = APIRouter()


def _wrap(data):
    return {"code": 0, "data": data, "message": "ok"}


@router.get("/config")
async def get_config(db: DB, user: User = Depends(get_current_user)):
    config = await get_or_create_config(db, user.id)
    return _wrap(RiskConfigResponse(
        max_loss_per_trade=float(config.max_loss_per_trade),
        max_daily_loss=float(config.max_daily_loss),
        require_stop_loss=config.require_stop_loss,
        require_trade_reason=config.require_trade_reason,
        require_take_profit=config.require_take_profit,
        max_open_positions=config.max_open_positions,
        max_leverage=config.max_leverage,
    ).model_dump())


@router.put("/config")
async def update_config(req: RiskConfigUpdate, db: DB, user: User = Depends(get_current_user)):
    config = await get_or_create_config(db, user.id)

    if req.max_loss_per_trade is not None:
        config.max_loss_per_trade = req.max_loss_per_trade
    if req.max_daily_loss is not None:
        config.max_daily_loss = req.max_daily_loss
    # require_stop_loss 强制为 True，不可关闭
    config.require_stop_loss = True
    if req.require_trade_reason is not None:
        config.require_trade_reason = req.require_trade_reason
    if req.require_take_profit is not None:
        config.require_take_profit = req.require_take_profit
    if req.max_open_positions is not None:
        config.max_open_positions = req.max_open_positions
    if req.max_leverage is not None:
        config.max_leverage = req.max_leverage

    await db.commit()
    await db.refresh(config)

    return _wrap(RiskConfigResponse(
        max_loss_per_trade=float(config.max_loss_per_trade),
        max_daily_loss=float(config.max_daily_loss),
        require_stop_loss=config.require_stop_loss,
        require_trade_reason=config.require_trade_reason,
        require_take_profit=config.require_take_profit,
        max_open_positions=config.max_open_positions,
        max_leverage=config.max_leverage,
    ).model_dump())


@router.post("/check")
async def risk_check(req: RiskCheckRequest, db: DB, user: User = Depends(get_current_user)):
    config = await get_or_create_config(db, user.id)
    result = check_single_trade_risk(
        entry_price=req.entry_price,
        stop_loss=req.stop_loss,
        quantity=req.quantity,
        account_balance=req.account_balance,
        max_loss_pct=float(config.max_loss_per_trade),
    )
    return _wrap(RiskCheckResponse(**result).model_dump())


@router.get("/status")
async def risk_status(db: DB, user: User = Depends(get_current_user)):
    config = await get_or_create_config(db, user.id)

    # 获取日亏损状态
    account_balance = 10000.0  # TODO: 从 account 模块获取真实余额
    daily_status = await get_daily_loss_status(db, user.id, account_balance)

    # 获取持仓数量
    from sqlalchemy import select, func
    from app.modules.trade.models import Order

    result = await db.execute(
        select(func.count()).where(
            Order.user_id == user.id,
            Order.status == "FILLED",
            Order.pnl.is_(None),
        )
    )
    open_positions_count = result.scalar() or 0

    return _wrap(RiskStatusResponse(
        daily_loss_current=daily_status["daily_loss_current"],
        daily_loss_percent=daily_status["daily_loss_percent"],
        daily_loss_limit=float(config.max_daily_loss),
        is_locked=daily_status["is_locked"],
        open_positions_count=open_positions_count,
        trade_count_today=daily_status["trade_count_today"],
    ).model_dump())
