from pydantic import BaseModel


class KlineRequest(BaseModel):
    symbol: str = "BTCUSDT"
    interval: str = "15m"
    limit: int = 500


class KlineItem(BaseModel):
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float


class SymbolInfo(BaseModel):
    symbol: str
    base_asset: str
    quote_asset: str
