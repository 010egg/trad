import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select

from app.deps import DB
from app.modules.auth.models import User
from app.modules.auth.router import get_current_user
from app.modules.trade.models import ApiKey
from app.modules.account.schemas import BindApiKeyRequest, ApiKeyResponse, BalanceResponse
from app.modules.account.service import encrypt_value, mask_key, decrypt_value

router = APIRouter()
logger = logging.getLogger(__name__)


def _wrap(data):
    return {"code": 0, "data": data, "message": "ok"}


@router.post("/api-keys")
async def bind_api_key(req: BindApiKeyRequest, db: DB, user: User = Depends(get_current_user)):
    api_key_record = ApiKey(
        user_id=user.id,
        exchange="binance",
        api_key_enc=encrypt_value(req.api_key),
        api_secret_enc=encrypt_value(req.api_secret),
        permissions="[\"read\",\"spot\",\"futures\"]",
        is_active=True,
    )
    db.add(api_key_record)
    await db.commit()
    await db.refresh(api_key_record)

    return _wrap(ApiKeyResponse(
        id=api_key_record.id,
        exchange=api_key_record.exchange,
        masked_key=mask_key(req.api_key),
        is_active=api_key_record.is_active,
    ).model_dump())


@router.get("/api-keys")
async def list_api_keys(db: DB, user: User = Depends(get_current_user)):
    result = await db.execute(select(ApiKey).where(ApiKey.user_id == user.id))
    keys = result.scalars().all()

    return _wrap([
        ApiKeyResponse(
            id=k.id,
            exchange=k.exchange,
            masked_key=mask_key(decrypt_value(k.api_key_enc)),
            is_active=k.is_active,
        ).model_dump()
        for k in keys
    ])


@router.delete("/api-keys/{key_id}")
async def delete_api_key(key_id: str, db: DB, user: User = Depends(get_current_user)):
    result = await db.execute(select(ApiKey).where(ApiKey.id == key_id, ApiKey.user_id == user.id))
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(status_code=404, detail="API Key 不存在")

    await db.delete(key)
    await db.commit()

    return _wrap({"success": True})


@router.get("/balance")
async def get_balance(
    db: DB,
    user: User = Depends(get_current_user),
    trade_mode: str | None = Query(default=None),
    market: str | None = Query(default=None),
):
    """获取账户余额"""
    from sqlalchemy import select

    # 获取交易设置
    from app.modules.trade.models import TradeSettings

    result = await db.execute(
        select(TradeSettings).where(TradeSettings.user_id == user.id)
    )
    settings = result.scalar_one_or_none()

    resolved_trade_mode = (trade_mode or (settings.trade_mode if settings else "SIMULATED")).upper()
    resolved_market = (market or (settings.default_market if settings else "SPOT")).upper()

    if resolved_trade_mode not in {"SIMULATED", "LIVE"}:
        raise HTTPException(status_code=400, detail="无效的交易模式")
    if resolved_market not in {"SPOT", "FUTURES"}:
        raise HTTPException(status_code=400, detail="无效的市场类型")

    balance = 10000.0 if resolved_trade_mode == "SIMULATED" else 0.0

    # 如果是真实模式，尝试获取真实余额
    if resolved_trade_mode == "LIVE":
        # 获取 API Key
        result = await db.execute(
            select(ApiKey).where(
                ApiKey.user_id == user.id,
                ApiKey.is_active == True,  # noqa: E712
            )
        )
        api_key_record = result.scalar_one_or_none()

        if api_key_record:
            from app.modules.binance.client import BinanceClient

            api_key = decrypt_value(api_key_record.api_key_enc)
            api_secret = decrypt_value(api_key_record.api_secret_enc)
            client = BinanceClient(api_key, api_secret, testnet=False)

            try:
                if resolved_market == "FUTURES":
                    balances = await client.get_futures_account_balance()
                    usdt_balance = next(
                        (float(item.get("balance", 0)) for item in balances if item.get("asset") == "USDT"),
                        0.0,
                    )
                    balance = usdt_balance
                else:
                    spot_balance = await client.get_spot_balance("USDT")
                    balance = float(spot_balance.get("free", 0))
            except Exception:
                logger.exception(
                    "Failed to load Binance balance for user %s (%s/%s)",
                    user.id,
                    resolved_trade_mode,
                    resolved_market,
                )
            finally:
                await client.close()

    return _wrap(
        BalanceResponse(
            balance=balance,
            mode=resolved_trade_mode,
            market=resolved_market,
        ).model_dump()
    )
