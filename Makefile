.PHONY: dev stop db-migrate db-upgrade test lint

# 一键启动开发环境
dev:
	docker compose up -d

# 停止
stop:
	docker compose down

# 数据库迁移
db-migrate:
	docker compose exec backend alembic revision --autogenerate -m "$(msg)"

db-upgrade:
	docker compose exec backend alembic upgrade head

# 测试
test:
	docker compose exec backend pytest --cov=app/
	cd frontend && npm run test

# 代码检查
lint:
	docker compose exec backend ruff check .
	cd frontend && npm run lint
