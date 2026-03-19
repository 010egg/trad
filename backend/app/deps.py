from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db

DB = Annotated[AsyncSession, Depends(get_db)]

# Phase 3 添加：
# from app.modules.auth.service import get_current_user
# CurrentUser = Annotated[User, Depends(get_current_user)]
