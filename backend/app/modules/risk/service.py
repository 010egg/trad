from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.risk.models import RiskConfig, DailyLossRecord


async def get_or_create_config(db: AsyncSession, user_id: str) -> RiskConfig:
    """获取用户风控配置，不存在则创建默认配置"""
    result = await db.execute(select(RiskConfig).where(RiskConfig.user_id == user_id))
    config = result.scalar_one_or_none()
    if not config:
        config = RiskConfig(user_id=user_id)
        db.add(config)
        await db.commit()
        await db.refresh(config)
    return config


def check_single_trade_risk(
    entry_price: float,
    stop_loss: float,
    quantity: float,
    account_balance: float,
    max_loss_pct: float,
) -> dict:
    """检查单笔交易是否超过风控限制"""
    loss_per_unit = abs(entry_price - stop_loss)
    total_loss = loss_per_unit * quantity
    loss_pct = (total_loss / account_balance) * 100

    if loss_pct <= max_loss_pct:
        return {
            "allowed": True,
            "reason": None,
            "recommended_quantity": None,
            "max_loss_amount": round(total_loss, 2),
        }

    # 计算推荐仓位
    max_loss_amount = account_balance * (max_loss_pct / 100)
    recommended_qty = max_loss_amount / loss_per_unit if loss_per_unit > 0 else 0

    return {
        "allowed": False,
        "reason": f"单笔亏损 {loss_pct:.1f}% 超过限制 {max_loss_pct}%",
        "recommended_quantity": round(recommended_qty, 8),
        "max_loss_amount": round(max_loss_amount, 2),
    }


async def check_daily_loss_circuit(
    db: AsyncSession,
    user_id: str,
    account_balance: float,
    max_daily_loss_pct: float,
) -> dict:
    """检查日亏损是否触发熔断"""
    today = datetime.utcnow().date().isoformat()

    result = await db.execute(
        select(DailyLossRecord).where(
            DailyLossRecord.user_id == user_id,
            DailyLossRecord.date == today,
        )
    )
    record = result.scalar_one_or_none()

    if record and record.is_locked:
        return {
            "allowed": False,
            "reason": "今日已触发熔断，交易已被锁定",
        }

    current_loss = float(record.total_pnl) if record else 0
    # 只有当 current_loss 为负数时，才计算亏损百分比
    loss_pct = 0.0
    if current_loss < 0:
        loss_pct = abs(current_loss) / account_balance * 100 if account_balance > 0 else 0

    if current_loss < 0 and loss_pct >= max_daily_loss_pct:
        # 触发熔断
        if record:
            record.is_locked = True
            record.locked_at = datetime.utcnow()
        else:
            record = DailyLossRecord(
                user_id=user_id,
                date=today,
                total_pnl=Decimal(str(current_loss)),
                is_locked=True,
                locked_at=datetime.utcnow(),
            )
            db.add(record)
        await db.commit()

        return {
            "allowed": False,
            "reason": f"日亏损 {loss_pct:.1f}% 达到限制 {max_daily_loss_pct}%",
        }

    return {"allowed": True, "reason": None}


async def update_daily_loss(
    db: AsyncSession,
    user_id: str,
    pnl: float,
) -> DailyLossRecord:
    """更新日亏损记录"""
    today = datetime.utcnow().date().isoformat()

    result = await db.execute(
        select(DailyLossRecord).where(
            DailyLossRecord.user_id == user_id,
            DailyLossRecord.date == today,
        )
    )
    record = result.scalar_one_or_none()

    if record:
        record.total_pnl += Decimal(str(pnl))
        record.trade_count += 1
    else:
        record = DailyLossRecord(
            user_id=user_id,
            date=today,
            total_pnl=Decimal(str(pnl)),
            trade_count=1,
        )
        db.add(record)

    await db.commit()
    await db.refresh(record)
    return record


async def get_daily_loss_status(
    db: AsyncSession,
    user_id: str,
    account_balance: float,
) -> dict:
    """获取日亏损状态"""
    today = datetime.utcnow().date().isoformat()

    result = await db.execute(
        select(DailyLossRecord).where(
            DailyLossRecord.user_id == user_id,
            DailyLossRecord.date == today,
        )
    )
    record = result.scalar_one_or_none()

    current_loss = float(record.total_pnl) if record else 0
    loss_pct = abs(current_loss) / account_balance * 100 if account_balance > 0 else 0

    return {
        "daily_loss_current": current_loss,
        "daily_loss_percent": loss_pct,
        "is_locked": record.is_locked if record else False,
        "trade_count_today": record.trade_count if record else 0,
    }
