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
    llm_enabled: bool
    llm_provider: str
    llm_base_url: str
    llm_model: str
    llm_system_prompt: str
    llm_has_api_key: bool
    llm_api_key_masked: str | None


class TradeSettingsUpdate(BaseModel):
    trade_mode: str | None = None
    default_market: str | None = None
    default_leverage: int | None = None
    llm_enabled: bool | None = None
    llm_provider: str | None = None
    llm_base_url: str | None = None
    llm_model: str | None = None
    llm_system_prompt: str | None = None
    llm_api_key: str | None = None


class LlmConnectivityTestRequest(BaseModel):
    provider: str = "OPENAI"
    base_url: str
    model: str
    api_key: str | None = None
    use_saved_api_key: bool = False


class LlmConnectivityTestResponse(BaseModel):
    success: bool
    latency_ms: int
    model: str
    preview: str
