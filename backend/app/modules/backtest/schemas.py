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
    strategy_mode: str = "long_only"  # long_only, short_only, bidirectional, dca, martingale
    name: str | None = None
    include_trades: bool = True  # False 时跳过返回交易列表，减少响应体积
    # DCA（定投）专用参数
    dca_interval_bars: int = 24  # 每隔多少根K线买入一次
    dca_amount: float = 100.0  # 每次定投金额（USDT）
    dca_take_profit_pct: float | None = None  # 可选：累计盈利达到此百分比时全部卖出
    # 马丁格尔专用参数
    martingale_multiplier: float = 2.0  # 亏损后仓位倍数
    martingale_max_rounds: int = 4  # 最大连续加倍次数
    martingale_reset_on_win: bool = True  # 盈利后是否重置为基础仓位
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
    calmar_ratio: float = 0
    max_consecutive_losses: int = 0
    max_dd_duration_hours: float = 0
    sortino_ratio: float = 0
    tail_ratio: float = 0
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
    position_pct: float = 0.0
    strategy_mode: str = "long_only"
    total_return_pct: float
    final_balance: float
    win_rate: float
    profit_factor: float
    max_drawdown: float
    sharpe_ratio: float
    calmar_ratio: float = 0
    max_consecutive_losses: int = 0
    max_dd_duration_hours: float = 0
    sortino_ratio: float = 0
    tail_ratio: float = 0
    total_trades: int
    avg_holding_hours: float
    is_favorite: bool = False
    tags: list[str] = []
    created_at: str

    model_config = {"exclude_none": False}


class BacktestRecordDetail(BacktestRecordResponse):
    entry_conditions: str
    exit_conditions: str
    trades: str


class BacktestRecordUpdate(BaseModel):
    name: str


class BacktestRecordTagsUpdate(BaseModel):
    tags: list[str]


class BatchBacktestRequest(BaseModel):
    runs: list[BacktestRequest]


class AvailableDataItem(BaseModel):
    symbol: str
    interval: str
    count: int
    start_date: str  # 最早K线日期 YYYY-MM-DD
    end_date: str    # 最新K线日期 YYYY-MM-DD


class GridSearchParams(BaseModel):
    """可以被网格搜索扫描的参数，每个字段传一个值列表"""
    leverage: list[int] | None = None
    risk_per_trade: list[float] | None = None
    stop_loss_pct: list[float] | None = None
    take_profit_pct: list[float] | None = None
    initial_balance: list[float] | None = None


class GridSearchRequest(BaseModel):
    base: BacktestRequest              # 固定参数（symbol/interval/conditions 等）
    grid: GridSearchParams             # 要扫描的参数及候选值列表
    sort_by: str = "sharpe_ratio"      # 排序指标：sharpe_ratio / total_return_pct / max_drawdown / calmar_ratio
    top_n: int = 10                    # 只返回前 N 名
