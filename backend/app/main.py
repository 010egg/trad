from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.ws.binance_ws import manager as ws_manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时自动建表（开发环境用，生产环境用 Alembic）
    async with engine.begin() as conn:
        # 导入所有 model 确保表被注册
        from app.modules.auth import models as _auth_models  # noqa: F401
        from app.modules.trade import models as _trade_models  # noqa: F401
        from app.modules.risk import models as _risk_models  # noqa: F401
        from app.modules.backtest import models as _backtest_models  # noqa: F401
        from app.modules.risk.models import DailyLossRecord  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)
        # 补充新增列（SQLite 不支持 create_all 自动 ALTER，逐列检查添加）
        from sqlalchemy import text
        for col, definition in [
            ("initial_balance", "FLOAT NOT NULL DEFAULT 10000"),
            ("final_balance", "FLOAT NOT NULL DEFAULT 10000"),
        ]:
            try:
                await conn.execute(text(f"ALTER TABLE backtest_records ADD COLUMN {col} {definition}"))
            except Exception:
                pass  # 列已存在，忽略
    yield
    await ws_manager.shutdown()


app = FastAPI(
    title="TradeGuard API",
    version="0.1.0",
    description="交易风险管理系统",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/health/ready")
async def health_ready():
    return {"status": "ready"}


# 路由注册
from app.modules.auth.router import router as auth_router
from app.modules.account.router import router as account_router
from app.modules.risk.router import router as risk_router
from app.modules.market.router import router as market_router
from app.modules.trade.router import router as trade_router
from app.modules.backtest.router import router as backtest_router
from app.ws.router import router as ws_router

app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(account_router, prefix="/api/v1/account", tags=["account"])
app.include_router(risk_router, prefix="/api/v1/risk", tags=["risk"])
app.include_router(market_router, prefix="/api/v1/market", tags=["market"])
app.include_router(trade_router, prefix="/api/v1/trade", tags=["trade"])
app.include_router(backtest_router, prefix="/api/v1/backtest", tags=["backtest"])
app.include_router(ws_router)
