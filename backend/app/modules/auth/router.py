from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import DB
from app.modules.auth.models import User
from app.modules.auth.schemas import (
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from app.modules.auth.service import (
    create_token,
    decode_token,
    get_user_by_email,
    get_user_by_id,
    hash_password,
    verify_password,
)

router = APIRouter()
security = HTTPBearer(auto_error=False)


def _wrap(data):
    return {"code": 0, "data": data, "message": "ok"}


@router.post("/register")
async def register(req: RegisterRequest, db: DB):
    existing = await get_user_by_email(db, req.email)
    if existing:
        raise HTTPException(status_code=409, detail="邮箱已被注册")

    user = User(
        username=req.username,
        email=req.email,
        password_hash=hash_password(req.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return _wrap(UserResponse(id=str(user.id), username=user.username, email=user.email).model_dump())


@router.post("/login")
async def login(req: LoginRequest, db: DB):
    user = await get_user_by_email(db, req.email)
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="邮箱或密码错误")

    access_token = create_token(str(user.id), "access")
    refresh_token = create_token(str(user.id), "refresh")

    return _wrap(TokenResponse(access_token=access_token, refresh_token=refresh_token).model_dump())


@router.post("/refresh")
async def refresh(req: RefreshRequest, db: DB):
    payload = decode_token(req.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="无效的 refresh token")

    user = await get_user_by_id(db, payload["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")

    access_token = create_token(str(user.id), "access")

    return _wrap({"access_token": access_token, "token_type": "bearer"})


async def get_current_user(
    db: DB,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> User:
    if not credentials:
        raise HTTPException(status_code=401, detail="未提供认证信息")

    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="无效的 token")

    user = await get_user_by_id(db, payload["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")

    return user


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return _wrap(UserResponse(id=str(user.id), username=user.username, email=user.email).model_dump())
