from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.modules.market.service import SUPPORTED_SYMBOLS, fetch_klines
from app.modules.backtest.engine import calc_indicators

router = APIRouter()


def _wrap(data):
    return {"code": 0, "data": data, "message": "ok"}


@router.get("/symbols")
async def list_symbols():
    return _wrap(SUPPORTED_SYMBOLS)


@router.get("/klines")
async def get_klines(
    symbol: str = Query(default="BTCUSDT"),
    interval: str = Query(default="15m"),
    limit: int = Query(default=500, le=1000),
):
    klines = await fetch_klines(symbol, interval, limit)
    return _wrap(klines)


class IndicatorItem(BaseModel):
    type: str
    period: int | None = None
    n: int | None = None
    fast: int | None = None
    slow: int | None = None
    signal: int | None = None


class IndicatorsRequest(BaseModel):
    symbol: str = "BTCUSDT"
    interval: str = "15m"
    limit: int = 500
    indicators: list[IndicatorItem]


@router.post("/indicators")
async def get_indicators(req: IndicatorsRequest):
    """获取 K 线数据 + 技术指标叠加数据"""
    klines = await fetch_klines(req.symbol, req.interval, req.limit)
    indicator_configs = [ind.model_dump(exclude_none=True) for ind in req.indicators]
    indicator_data = calc_indicators(klines, indicator_configs)
    return _wrap(indicator_data)
