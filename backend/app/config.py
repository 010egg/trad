from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # 数据库（本地开发默认 SQLite，生产环境通过 .env 设置 PostgreSQL）
    database_url: str = "sqlite+aiosqlite:///./tradeguard.db"

    # Redis
    redis_url: str = "redis://localhost:6379"

    # JWT
    jwt_secret: str = "dev-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 30
    jwt_refresh_token_expire_days: int = 7

    # API Key 加密
    encryption_key: str = "dev-encryption-key-change-in-prod"

    # Binance 连接
    binance_tld: str = "com"
    binance_base_endpoint: str = ""
    binance_https_proxy: str | None = None

    model_config = {"env_file": ".env"}


settings = Settings()
