import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import String, Boolean, DateTime, ForeignKey, Integer, Numeric, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    exchange: Mapped[str] = mapped_column(String(20), default="binance")
    api_key_enc: Mapped[str] = mapped_column(Text)
    api_secret_enc: Mapped[str] = mapped_column(Text)
    permissions: Mapped[str] = mapped_column(Text, default="[]")  # JSON string, 兼容 SQLite
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    symbol: Mapped[str] = mapped_column(String(20))
    side: Mapped[str] = mapped_column(String(10))
    position_side: Mapped[str] = mapped_column(String(10))
    order_type: Mapped[str] = mapped_column(String(10))
    quantity: Mapped[Decimal] = mapped_column(Numeric(20, 8))
    price: Mapped[Decimal | None] = mapped_column(Numeric(20, 8), nullable=True)
    stop_loss: Mapped[Decimal] = mapped_column(Numeric(20, 8))
    take_profit: Mapped[Decimal | None] = mapped_column(Numeric(20, 8), nullable=True)
    trade_reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="PENDING")
    # 交易模式
    trade_mode: Mapped[str] = mapped_column(String(20), default="SIMULATED")  # SIMULATED / LIVE
    market_type: Mapped[str] = mapped_column(String(10), default="SPOT")  # SPOT / FUTURES
    leverage: Mapped[int] = mapped_column(Integer, default=1)
    # Binance 订单信息
    binance_order_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    binance_client_order_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    filled_price: Mapped[Decimal | None] = mapped_column(Numeric(20, 8), nullable=True)
    filled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    pnl: Mapped[Decimal | None] = mapped_column(Numeric(20, 8), nullable=True)
    pnl_percent: Mapped[Decimal | None] = mapped_column(Numeric(8, 4), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class TradeSettings(Base):
    """用户交易设置"""
    __tablename__ = "trade_settings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), unique=True)
    trade_mode: Mapped[str] = mapped_column(String(20), default="SIMULATED")  # SIMULATED / LIVE
    default_market: Mapped[str] = mapped_column(String(10), default="SPOT")  # SPOT / FUTURES
    default_leverage: Mapped[int] = mapped_column(Integer, default=1)
    llm_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    llm_provider: Mapped[str] = mapped_column(String(20), default="OPENAI", server_default="OPENAI")
    llm_base_url: Mapped[str] = mapped_column(String(500), default="")
    llm_model: Mapped[str] = mapped_column(String(120), default="minimax", server_default="minimax")
    llm_system_prompt: Mapped[str] = mapped_column(Text, default="", server_default="")
    llm_api_key_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
