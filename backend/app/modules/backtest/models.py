import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, Integer, Float, Text, func, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class BacktestRecord(Base):
    __tablename__ = "backtest_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    symbol: Mapped[str] = mapped_column(String(20))
    interval: Mapped[str] = mapped_column(String(10))
    start_date: Mapped[str] = mapped_column(String(20))
    end_date: Mapped[str] = mapped_column(String(20))
    leverage: Mapped[int] = mapped_column(Integer, default=1)
    stop_loss_pct: Mapped[float] = mapped_column(Float, default=2.0)
    take_profit_pct: Mapped[float] = mapped_column(Float, default=6.0)
    risk_per_trade: Mapped[float] = mapped_column(Float, default=2.0)
    entry_conditions: Mapped[str] = mapped_column(Text, default="[]")
    exit_conditions: Mapped[str] = mapped_column(Text, default="[]")
    # 回测结果
    total_return: Mapped[float] = mapped_column(Float, default=0.0)
    win_rate: Mapped[float] = mapped_column(Float, default=0.0)
    profit_factor: Mapped[float] = mapped_column(Float, default=0.0)
    max_drawdown: Mapped[float] = mapped_column(Float, default=0.0)
    sharpe_ratio: Mapped[float] = mapped_column(Float, default=0.0)
    total_trades: Mapped[int] = mapped_column(Integer, default=0)
    avg_holding_hours: Mapped[float] = mapped_column(Float, default=0.0)
    trades: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
