from pydantic import BaseModel


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


class BacktestRequest(BaseModel):
    symbol: str
    interval: str = "15m"
    start_date: str  # YYYY-MM-DD
    end_date: str
    entry_conditions: list[ConditionItem] = []
    exit_conditions: list[ConditionItem] = []
    # 双向交易专用：分别设置做多和做空的入场条件
    long_entry_conditions: list[ConditionItem] | None = None
    short_entry_conditions: list[ConditionItem] | None = None
    stop_loss_pct: float = 2.0
    take_profit_pct: float = 6.0
    risk_per_trade: float = 2.0
    leverage: int = 1
    strategy_mode: str = "long_only"  # long_only, short_only, bidirectional
    name: str | None = None
    # 兼容旧接口
    entry_indicator: str | None = None
    entry_fast: int | None = None
    entry_slow: int | None = None
    entry_condition: str | None = None


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
    total_return: float
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
    stop_loss_pct: float
    take_profit_pct: float
    risk_per_trade: float
    total_return: float
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
