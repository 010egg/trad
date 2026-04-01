# TradeGuard

交易风险管理系统。

## 环境要求

- Docker & Docker Compose（推荐）
- 或：Python 3.11+ / Node.js 18+（本地直接运行）

## 启动方式

### 方式一：Docker 一键启动（推荐）

```bash
cp .env.example .env   # 按需填写配置
make dev               # 启动所有服务（PostgreSQL + Redis + 后端 + 前端）
```

访问 http://localhost:5173

停止：
```bash
make stop
```

### 方式二：本地直接运行

```bash
# 终端 1：启动后端
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

```bash
# 终端 2：启动前端
cd frontend
npm install
npm run dev
```

访问 http://localhost:5173

## 配置

复制 `.env.example` 为 `.env` 并按需修改：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DATABASE_URL` | 数据库连接串 | SQLite（本地模式） |
| `BINANCE_HTTPS_PROXY` | Binance 代理地址（国内需要） | 无 |
| `OPENAI_API_KEY` | AI 助手 API Key | 无 |
| `OPENAI_BASE_URL` | AI 接口地址 | 无 |
| `OPENAI_MODEL` | AI 模型名称 | `minimax` |

## 数据库迁移

```bash
make db-migrate msg="描述变更"
make db-upgrade
```

## 测试 / 代码检查

```bash
make test
make lint
```

## 目录结构

```
tradeguard/
├── backend/          # FastAPI 后端
│   ├── app/
│   │   ├── modules/  # 业务模块（auth/trade/market/risk/backtest/intel）
│   │   └── ws/       # WebSocket（Binance 实时行情）
│   └── requirements.txt
├── frontend/         # React + Vite 前端
│   └── src/
├── docker-compose.yml
└── Makefile
```

## 说明

- **数据库**：Docker 模式使用 PostgreSQL；本地模式默认 SQLite（`backend/tradeguard.db`），首次启动自动建表
- **行情数据**：实时从 Binance WebSocket 拉取，不存本地数据库
- **代理**：如需访问 Binance，设置 `BINANCE_HTTPS_PROXY=http://你的代理地址:端口`
