import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import String, Boolean, DateTime, ForeignKey, Integer, Numeric, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RiskConfig(Base):
    __tablename__ = "risk_configs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), unique=True)
    max_loss_per_trade: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("2.00"))
    max_daily_loss: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("5.00"))
    require_stop_loss: Mapped[bool] = mapped_column(Boolean, default=True)
    require_trade_reason: Mapped[bool] = mapped_column(Boolean, default=True)
    require_take_profit: Mapped[bool] = mapped_column(Boolean, default=False)
    max_open_positions: Mapped[int] = mapped_column(Integer, default=3)
    max_leverage: Mapped[int] = mapped_column(Integer, default=10)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class DailyLossRecord(Base):
    """日亏损记录"""
    __tablename__ = "daily_loss_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    date: Mapped[str] = mapped_column(String(10))  # YYYY-MM-DD
    total_pnl: Mapped[Decimal] = mapped_column(Numeric(20, 8), default=Decimal("0"))
    trade_count: Mapped[int] = mapped_column(Integer, default=0)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    unlock_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
