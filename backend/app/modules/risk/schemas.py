from pydantic import BaseModel
from decimal import Decimal


class RiskConfigResponse(BaseModel):
    max_loss_per_trade: float
    max_daily_loss: float
    require_stop_loss: bool
    require_trade_reason: bool
    require_take_profit: bool
    max_open_positions: int
    max_leverage: int


class RiskConfigUpdate(BaseModel):
    max_loss_per_trade: float | None = None
    max_daily_loss: float | None = None
    require_stop_loss: bool | None = None
    require_trade_reason: bool | None = None
    require_take_profit: bool | None = None
    max_open_positions: int | None = None
    max_leverage: int | None = None


class RiskCheckRequest(BaseModel):
    symbol: str
    side: str
    quantity: float
    stop_loss: float
    entry_price: float
    account_balance: float


class RiskCheckResponse(BaseModel):
    allowed: bool
    reason: str | None = None
    recommended_quantity: float | None = None
    max_loss_amount: float | None = None


class RiskStatusResponse(BaseModel):
    daily_loss_current: float
    daily_loss_percent: float
    daily_loss_limit: float
    is_locked: bool
    open_positions_count: int
    trade_count_today: int
