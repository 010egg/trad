from pydantic import BaseModel


class BindApiKeyRequest(BaseModel):
    api_key: str
    api_secret: str


class ApiKeyResponse(BaseModel):
    id: str
    exchange: str
    masked_key: str
    is_active: bool


class BalanceResponse(BaseModel):
    balance: float
    mode: str
    market: str
