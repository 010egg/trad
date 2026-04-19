import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class IntelItem(Base):
    __tablename__ = "intel_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    source_type: Mapped[str] = mapped_column(String(20), default="external", index=True)
    source_name: Mapped[str] = mapped_column(String(120), index=True)
    source_item_id: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)
    title: Mapped[str] = mapped_column(String(500))
    ai_title: Mapped[str] = mapped_column(String(240), default="")
    source_url: Mapped[str] = mapped_column(String(1000), default="")
    content_raw: Mapped[str] = mapped_column(Text, default="")
    summary_ai: Mapped[str] = mapped_column(Text, default="")
    signal: Mapped[str] = mapped_column(String(20), default="NEUTRAL", index=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    reasoning: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(30), default="macro", index=True)
    published_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    ingested_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    score: Mapped[float] = mapped_column(Float, default=0.0, index=True)
    source_score: Mapped[float] = mapped_column(Float, default=0.5)
    confirmation_count: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    symbol_links: Mapped[list["IntelItemSymbol"]] = relationship(
        back_populates="item",
        cascade="all, delete-orphan",
    )


class IntelItemSymbol(Base):
    __tablename__ = "intel_item_symbols"
    __table_args__ = (
        UniqueConstraint("intel_item_id", "symbol", name="uq_intel_item_symbol"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    intel_item_id: Mapped[str] = mapped_column(String(36), ForeignKey("intel_items.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(20), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    item: Mapped[IntelItem] = relationship(back_populates="symbol_links")
