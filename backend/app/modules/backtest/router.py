import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, desc

from app.deps import DB
from app.modules.auth.models import User
from app.modules.auth.router import get_current_user
from app.modules.backtest.models import BacktestRecord
from app.modules.backtest.schemas import (
    BacktestRequest,
    BacktestRecordResponse,
    BacktestRecordDetail,
    BacktestRecordUpdate,
)
from app.modules.backtest.engine import fetch_historical_klines, run_backtest

router = APIRouter()


def _wrap(data):
    return {"code": 0, "data": data, "message": "ok"}


def _auto_name(req: BacktestRequest) -> str:
    """自动生成策略名称"""
    parts = []
    for c in req.entry_conditions:
        t = c.type.upper()
        if t in ("MA", "EMA"):
            parts.append(f"{t}{c.fast or 20}x{c.slow or 60}")
        elif t == "KDJ":
            parts.append(f"KDJ{c.n or 9}")
        elif t == "MACD":
            parts.append("MACD")
        elif t == "RSI":
            parts.append(f"RSI{c.period or 14}")
        elif t == "BOLL":
            parts.append(f"BOLL{c.period or 20}")
    indicator = "+".join(parts) if parts else "Custom"
    return f"{indicator} {req.symbol} {req.start_date}~{req.end_date}"


@router.post("/run")
async def run(req: BacktestRequest, db: DB, user: User = Depends(get_current_user)):
    klines = await fetch_historical_klines(db, req.symbol, req.interval, req.start_date, req.end_date)

    if not klines:
        return _wrap({"error": "无法获取历史数据", "trades": []})

    # 转为引擎需要的 dict 格式
    entry_conds = [c.model_dump(exclude_none=True) for c in req.entry_conditions]
    exit_conds = [c.model_dump(exclude_none=True) for c in req.exit_conditions]

    # 双向交易：分别处理做多和做空的入场条件
    long_entry_conds = None
    short_entry_conds = None
    if req.strategy_mode == "bidirectional":
        if req.long_entry_conditions:
            long_entry_conds = [c.model_dump(exclude_none=True) for c in req.long_entry_conditions]
        if req.short_entry_conditions:
            short_entry_conds = [c.model_dump(exclude_none=True) for c in req.short_entry_conditions]

    # 兼容旧接口
    fast_period = None
    slow_period = None
    if not entry_conds and req.entry_fast and req.entry_slow:
        fast_period = req.entry_fast
        slow_period = req.entry_slow

    result = run_backtest(
        klines=klines,
        entry_conditions=entry_conds,
        exit_conditions=exit_conds,
        long_entry_conditions=long_entry_conds,
        short_entry_conditions=short_entry_conds,
        stop_loss_pct=req.stop_loss_pct,
        take_profit_pct=req.take_profit_pct,
        risk_per_trade=req.risk_per_trade,
        leverage=req.leverage,
        strategy_mode=req.strategy_mode,
        fast_period=fast_period,
        slow_period=slow_period,
    )

    # 保存记录到数据库
    record = BacktestRecord(
        user_id=user.id,
        name=req.name or _auto_name(req),
        symbol=req.symbol,
        interval=req.interval,
        start_date=req.start_date,
        end_date=req.end_date,
        leverage=req.leverage,
        stop_loss_pct=req.stop_loss_pct,
        take_profit_pct=req.take_profit_pct,
        risk_per_trade=req.risk_per_trade,
        entry_conditions=json.dumps(entry_conds),
        exit_conditions=json.dumps(exit_conds),
        total_return=result["total_return"],
        win_rate=result["win_rate"],
        profit_factor=result["profit_factor"],
        max_drawdown=result["max_drawdown"],
        sharpe_ratio=result["sharpe_ratio"],
        total_trades=result["total_trades"],
        avg_holding_hours=result["avg_holding_hours"],
        trades=json.dumps(result["trades"]),
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    return _wrap({**result, "record_id": record.id})


@router.get("/records")
async def list_records(db: DB, user: User = Depends(get_current_user)):
    stmt = select(BacktestRecord).where(BacktestRecord.user_id == user.id).order_by(desc(BacktestRecord.created_at))
    rows = (await db.execute(stmt)).scalars().all()
    data = [
        BacktestRecordResponse(
            id=r.id, name=r.name, symbol=r.symbol, interval=r.interval,
            start_date=r.start_date, end_date=r.end_date, leverage=r.leverage,
            stop_loss_pct=r.stop_loss_pct, take_profit_pct=r.take_profit_pct,
            risk_per_trade=r.risk_per_trade,
            total_return=r.total_return, win_rate=r.win_rate, profit_factor=r.profit_factor,
            max_drawdown=r.max_drawdown, sharpe_ratio=r.sharpe_ratio,
            total_trades=r.total_trades, avg_holding_hours=r.avg_holding_hours,
            created_at=r.created_at.isoformat(),
        ).model_dump()
        for r in rows
    ]
    return _wrap(data)


@router.get("/records/{record_id}")
async def get_record(record_id: str, db: DB, user: User = Depends(get_current_user)):
    stmt = select(BacktestRecord).where(BacktestRecord.id == record_id, BacktestRecord.user_id == user.id)
    record = (await db.execute(stmt)).scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")
    data = BacktestRecordDetail(
        id=record.id, name=record.name, symbol=record.symbol, interval=record.interval,
        start_date=record.start_date, end_date=record.end_date, leverage=record.leverage,
        stop_loss_pct=record.stop_loss_pct, take_profit_pct=record.take_profit_pct,
        risk_per_trade=record.risk_per_trade,
        total_return=record.total_return, win_rate=record.win_rate, profit_factor=record.profit_factor,
        max_drawdown=record.max_drawdown, sharpe_ratio=record.sharpe_ratio,
        total_trades=record.total_trades, avg_holding_hours=record.avg_holding_hours,
        entry_conditions=record.entry_conditions, exit_conditions=record.exit_conditions,
        trades=record.trades,
        created_at=record.created_at.isoformat(),
    ).model_dump()
    return _wrap(data)


@router.put("/records/{record_id}")
async def update_record(record_id: str, body: BacktestRecordUpdate, db: DB, user: User = Depends(get_current_user)):
    stmt = select(BacktestRecord).where(BacktestRecord.id == record_id, BacktestRecord.user_id == user.id)
    record = (await db.execute(stmt)).scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")
    record.name = body.name
    await db.commit()
    return _wrap({"id": record.id, "name": record.name})


@router.delete("/records/{record_id}")
async def delete_record(record_id: str, db: DB, user: User = Depends(get_current_user)):
    stmt = select(BacktestRecord).where(BacktestRecord.id == record_id, BacktestRecord.user_id == user.id)
    record = (await db.execute(stmt)).scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")
    await db.delete(record)
    await db.commit()
    return _wrap(None)


@router.get("/presets")
async def get_strategy_presets():
    """获取策略预设配置"""
    presets = {
        "oscillation": {
            "name": "布林带震荡策略",
            "description": "在震荡区间内逢低做多、逢高做空，价格回归中轨平仓",
            "strategy_mode": "bidirectional",
            "long_entry_conditions": [
                {
                    "type": "BOLL",
                    "op": "touch_lower",
                    "period": 20
                }
            ],
            "short_entry_conditions": [
                {
                    "type": "BOLL",
                    "op": "touch_upper",
                    "period": 20
                }
            ],
            "stop_loss_pct": 3.0,
            "take_profit_pct": 5.0,
            "risk_per_trade": 2.0,
            "leverage": 1,
            "recommended_interval": "15m",
            "tips": "适合横盘震荡行情，趋势市场慎用"
        },
        "trend_following": {
            "name": "MA趋势跟踪",
            "description": "短期均线上穿长期均线做多，下穿做空",
            "strategy_mode": "long_only",
            "entry_conditions": [
                {
                    "type": "MA",
                    "fast": 20,
                    "slow": 60,
                    "op": "cross_above"
                }
            ],
            "exit_conditions": [
                {
                    "type": "MA",
                    "fast": 20,
                    "slow": 60,
                    "op": "cross_below"
                }
            ],
            "stop_loss_pct": 2.0,
            "take_profit_pct": 8.0,
            "risk_per_trade": 2.0,
            "leverage": 1,
            "recommended_interval": "1h",
            "tips": "适合趋势明显的行情"
        },
        "rsi_reversal": {
            "name": "RSI超买超卖反转",
            "description": "RSI超卖(<30)做多，超买(>70)做空",
            "strategy_mode": "bidirectional",
            "entry_conditions": [
                {
                    "type": "RSI",
                    "period": 14,
                    "op": "lt",
                    "value": 30
                }
            ],
            "exit_conditions": [
                {
                    "type": "RSI",
                    "period": 14,
                    "op": "gt",
                    "value": 70
                }
            ],
            "stop_loss_pct": 2.5,
            "take_profit_pct": 5.0,
            "risk_per_trade": 2.0,
            "leverage": 1,
            "recommended_interval": "15m",
            "tips": "适合震荡市，需注意假突破"
        }
    }
    return _wrap(presets)
