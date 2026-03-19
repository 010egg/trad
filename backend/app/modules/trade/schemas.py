from pydantic import BaseModel


class CreateOrderRequest(BaseModel):
    symbol: str
    side: str  # BUY / SELL
    position_side: str  # LONG / SHORT
    order_type: str  # MARKET / LIMIT
    quantity: float
    price: float | None = None
    stop_loss: float
    take_profit: float | None = None
    trade_reason: str


class OrderResponse(BaseModel):
    id: str
    symbol: str
    side: str
    position_side: str
    order_type: str
    quantity: float
    price: float | None
    stop_loss: float
    take_profit: float | None
    trade_reason: str
    status: str


class PositionResponse(BaseModel):
    symbol: str
    side: str
    quantity: float
    entry_price: float
    unrealized_pnl: float
    order_id: str


class TradeSettingsResponse(BaseModel):
    trade_mode: str
    default_market: str
    default_leverage: int


class TradeSettingsUpdate(BaseModel):
    trade_mode: str | None = None
    default_market: str | None = None
    default_leverage: int | None = None
