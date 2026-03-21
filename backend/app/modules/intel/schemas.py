from pydantic import BaseModel, Field


class IntelFeedItem(BaseModel):
    id: str
    source_type: str
    source_name: str
    title: str
    source_url: str
    summary_ai: str
    signal: str
    confidence: float
    reasoning: str
    category: str
    published_at: str
    ingested_at: str
    symbols: list[str] = Field(default_factory=list)


class IntelFeedResponse(BaseModel):
    items: list[IntelFeedItem]
    next_cursor: str | None = None
    stale: bool
    last_refreshed_at: str | None = None


class IntelRefreshResponse(BaseModel):
    fetched: int
    created: int
    updated: int
    last_refreshed_at: str | None = None
    queued: bool = False


class IntelFiltersResponse(BaseModel):
    symbols: list[str]
    categories: list[str]
    signals: list[str]


class IntelChatMessage(BaseModel):
    role: str
    content: str = Field(min_length=1, max_length=4000)


class IntelChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    history: list[IntelChatMessage] = Field(default_factory=list, max_length=12)


class IntelChatResponse(BaseModel):
    reply: str
    model: str
    latency_ms: int
