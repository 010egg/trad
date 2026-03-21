import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, Integer, Float, Text, BigInteger, Boolean, func, ForeignKey, UniqueConstraint
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
    initial_balance: Mapped[float] = mapped_column(Float, default=10000.0, server_default="10000")
    stop_loss_pct: Mapped[float] = mapped_column(Float, default=2.0)
    take_profit_pct: Mapped[float] = mapped_column(Float, default=6.0)
    risk_per_trade: Mapped[float] = mapped_column(Float, default=2.0)
    strategy_mode: Mapped[str] = mapped_column(String(20), default="long_only", server_default="long_only")
    entry_conditions: Mapped[str] = mapped_column(Text, default="[]")
    exit_conditions: Mapped[str] = mapped_column(Text, default="[]")
    # 回测结果
    total_return: Mapped[float] = mapped_column(Float, default=0.0)
    final_balance: Mapped[float] = mapped_column(Float, default=10000.0, server_default="10000")
    win_rate: Mapped[float] = mapped_column(Float, default=0.0)
    profit_factor: Mapped[float] = mapped_column(Float, default=0.0)
    max_drawdown: Mapped[float] = mapped_column(Float, default=0.0)
    sharpe_ratio: Mapped[float] = mapped_column(Float, default=0.0)
    calmar_ratio: Mapped[float] = mapped_column(Float, default=0.0)
    max_consecutive_losses: Mapped[int] = mapped_column(Integer, default=0)
    max_dd_duration_hours: Mapped[float] = mapped_column(Float, default=0.0)
    sortino_ratio: Mapped[float] = mapped_column(Float, default=0.0)
    tail_ratio: Mapped[float] = mapped_column(Float, default=0.0)
    total_trades: Mapped[int] = mapped_column(Integer, default=0)
    avg_holding_hours: Mapped[float] = mapped_column(Float, default=0.0)
    trades: Mapped[str] = mapped_column(Text, default="[]")
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    tags: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class HistoricalKline(Base):
    __tablename__ = "historical_klines"
    __table_args__ = (
        UniqueConstraint("symbol", "interval", "open_time", name="uq_historical_kline_symbol_interval_open_time"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(20), index=True)
    interval: Mapped[str] = mapped_column(String(10), index=True)
    open_time: Mapped[int] = mapped_column(BigInteger, index=True)
    open: Mapped[float] = mapped_column(Float)
    high: Mapped[float] = mapped_column(Float)
    low: Mapped[float] = mapped_column(Float)
    close: Mapped[float] = mapped_column(Float)
    volume: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
