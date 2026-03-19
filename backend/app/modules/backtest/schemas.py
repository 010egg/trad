from typing import Any

from pydantic import BaseModel, field_validator


class ConditionItem(BaseModel):
    type: str  # MA, EMA, KDJ, MACD, RSI, BOLL
    op: str = "cross_above"  # cross_above, cross_below, gt, lt, touch_upper, touch_lower
    # MA/EMA
    fast: int | None = None
    slow: int | None = None
    # KDJ
    n: int | None = None
    line: str | None = None
    target_line: str | None = None
    # RSI / BOLL
    period: int | None = None
    value: float | None = None
    # MACD
    fast_period: int | None = None
    slow_period: int | None = None
    signal: int | None = None


def _normalize_groups(v: Any) -> list[list[Any]]:
    """
    Normalize conditions to list[list[ConditionItem]] (OR of AND groups).

    Accepts:
      - Flat list  [cond, cond]          → [[cond, cond]]        (single AND group)
      - Nested list [[cond], [cond]]     → [[cond], [cond]]      (OR of AND groups)
      - Empty list / None                → []
    """
    if not v:
        return []
    if isinstance(v[0], dict):
        # flat list of condition dicts → wrap in a single AND group
        return [v]
    return v


class BacktestRequest(BaseModel):
    symbol: str
    interval: str = "15m"
    start_date: str  # YYYY-MM-DD
    end_date: str
    # Outer list = OR;  inner list = AND.
    # Backward-compatible: a flat list of condition objects is treated as a single AND group.
    entry_conditions: list[list[ConditionItem]] = []
    exit_conditions: list[list[ConditionItem]] = []
    # 双向交易专用：分别设置做多和做空的入场条件（同样支持 OR-of-AND 格式）
    long_entry_conditions: list[list[ConditionItem]] | None = None
    short_entry_conditions: list[list[ConditionItem]] | None = None
    initial_balance: float = 10000.0
    stop_loss_pct: float = 2.0
    take_profit_pct: float = 6.0
    risk_per_trade: float = 2.0
    leverage: int = 1
    strategy_mode: str = "long_only"  # long_only, short_only, bidirectional
    name: str | None = None
    include_trades: bool = True  # False 时跳过返回交易列表，减少响应体积
    # 兼容旧接口
    entry_indicator: str | None = None
    entry_fast: int | None = None
    entry_slow: int | None = None
    entry_condition: str | None = None

    @field_validator("entry_conditions", "exit_conditions", mode="before")
    @classmethod
    def normalize_conditions(cls, v: Any) -> list:
        return _normalize_groups(v)

    @field_validator("long_entry_conditions", "short_entry_conditions", mode="before")
    @classmethod
    def normalize_optional_conditions(cls, v: Any) -> list | None:
        if v is None:
            return None
        return _normalize_groups(v)


class IndicatorRequest(BaseModel):
    type: str  # MA, EMA, KDJ, MACD, RSI, BOLL
    period: int | None = None
    n: int | None = None
    fast: int | None = None
    slow: int | None = None
    signal: int | None = None


class BacktestTradeItem(BaseModel):
    entry_time: str
    exit_time: str
    side: str
    entry_price: float
    exit_price: float
    pnl: float
    pnl_pct: float
    duration: str


class BacktestResult(BaseModel):
    total_return_pct: float
    final_balance: float
    win_rate: float
    profit_factor: float
    max_drawdown: float
    sharpe_ratio: float
    total_trades: int
    avg_holding_hours: float
    trades: list[BacktestTradeItem]


class BacktestRecordResponse(BaseModel):
    id: str
    name: str
    symbol: str
    interval: str
    start_date: str
    end_date: str
    leverage: int
    initial_balance: float
    stop_loss_pct: float
    take_profit_pct: float
    risk_per_trade: float
    total_return_pct: float
    final_balance: float
    win_rate: float
    profit_factor: float
    max_drawdown: float
    sharpe_ratio: float
    total_trades: int
    avg_holding_hours: float
    created_at: str


class BacktestRecordDetail(BacktestRecordResponse):
    entry_conditions: str
    exit_conditions: str
    trades: str


class BacktestRecordUpdate(BaseModel):
    name: str


class BatchBacktestRequest(BaseModel):
    runs: list[BacktestRequest]


class AvailableDataItem(BaseModel):
    symbol: str
    interval: str
    count: int
    start_date: str  # 最早K线日期 YYYY-MM-DD
    end_date: str    # 最新K线日期 YYYY-MM-DD
