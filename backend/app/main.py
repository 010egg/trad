import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.modules.account.router import router as account_router
from app.modules.auth.router import router as auth_router
from app.modules.backtest.router import router as backtest_router
from app.modules.intel.router import router as intel_router
from app.modules.market.router import router as market_router
from app.modules.risk.router import router as risk_router
from app.modules.trade.router import router as trade_router
from app.ws.router import router as ws_router
from app.ws.binance_ws import manager as ws_manager
from app.modules.market.service import close_market_http_client

_logger = logging.getLogger("intel.auto_refresh")


async def _intel_auto_refresh_loop() -> None:
    from app.database import async_session
    from app.modules.intel.service import INTEL_REFRESH_TTL, refresh_intel_feed

    interval = INTEL_REFRESH_TTL.total_seconds()
    while True:
        await asyncio.sleep(interval)
        try:
            async with async_session() as db:
                result = await refresh_intel_feed(db, allow_env_fallback=True)
                _logger.info(
                    "Intel auto-refresh: fetched=%d created=%d updated=%d",
                    result["fetched"], result["created"], result["updated"],
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            _logger.warning("Intel auto-refresh failed: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时自动建表（开发环境用，生产环境用 Alembic）
    async with engine.begin() as conn:
        # 导入所有 model 确保表被注册
        from app.modules.auth import models as _auth_models  # noqa: F401
        from app.modules.trade import models as _trade_models  # noqa: F401
        from app.modules.risk import models as _risk_models  # noqa: F401
        from app.modules.backtest import models as _backtest_models  # noqa: F401
        from app.modules.intel import models as _intel_models  # noqa: F401
        from app.modules.risk.models import DailyLossRecord  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)
        # 补充新增列（SQLite 不支持 create_all 自动 ALTER，逐列检查添加）
        from sqlalchemy import text
        for table_name, col, definition in [
            ("backtest_records", "initial_balance", "FLOAT NOT NULL DEFAULT 10000"),
            ("backtest_records", "final_balance", "FLOAT NOT NULL DEFAULT 10000"),
            ("backtest_records", "is_favorite", "BOOLEAN NOT NULL DEFAULT 0"),
            ("backtest_records", "tags", "TEXT NOT NULL DEFAULT '[]'"),
            ("trade_settings", "llm_enabled", "BOOLEAN NOT NULL DEFAULT 0"),
            ("trade_settings", "llm_provider", "VARCHAR(20) NOT NULL DEFAULT 'OPENAI'"),
            ("trade_settings", "llm_base_url", "VARCHAR(500) NOT NULL DEFAULT ''"),
            ("trade_settings", "llm_model", "VARCHAR(120) NOT NULL DEFAULT 'minimax'"),
            ("trade_settings", "llm_system_prompt", "TEXT NOT NULL DEFAULT ''"),
            ("trade_settings", "llm_api_key_enc", "TEXT"),
            ("intel_items", "ai_title", "VARCHAR(240) NOT NULL DEFAULT ''"),
            ("intel_items", "source_score", "FLOAT NOT NULL DEFAULT 0.5"),
            ("intel_items", "confirmation_count", "INTEGER NOT NULL DEFAULT 1"),
        ]:
            try:
                await conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {col} {definition}"))
            except Exception:
                pass  # 列已存在，忽略
    refresh_task = asyncio.create_task(_intel_auto_refresh_loop())
    yield
    refresh_task.cancel()
    await asyncio.gather(refresh_task, return_exceptions=True)
    await close_market_http_client()
    await ws_manager.shutdown()


app = FastAPI(
    title="TradeGuard API",
    version="0.1.0",
    description="交易风险管理系统",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
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


app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(account_router, prefix="/api/v1/account", tags=["account"])
app.include_router(risk_router, prefix="/api/v1/risk", tags=["risk"])
app.include_router(market_router, prefix="/api/v1/market", tags=["market"])
app.include_router(trade_router, prefix="/api/v1/trade", tags=["trade"])
app.include_router(backtest_router, prefix="/api/v1/backtest", tags=["backtest"])
app.include_router(intel_router, prefix="/api/v1/intel", tags=["intel"])
app.include_router(ws_router)
