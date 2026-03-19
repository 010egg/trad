# TradeGuard

交易风险管理系统。

## 环境要求

- Python 3.11+
- Node.js 18+
- （可选）代理，用于访问 Binance（国内需要）

## 一键启动

```bash
# 终端 1：启动后端
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
BINANCE_WS_PROXY=http://127.0.0.1:7897 uvicorn app.main:app --reload --port 8000
```

```bash
# 终端 2：启动前端
cd frontend
npm install
npm run dev
```

访问 http://localhost:5173

## 说明

- 数据库：默认使用 SQLite（`backend/tradeguard.db`），首次启动自动建表，无需额外配置
- 行情数据：实时从 Binance WebSocket 拉取，不存本地数据库
- 代理：如需翻墙访问 Binance，设置环境变量 `BINANCE_WS_PROXY=http://你的代理地址:端口`

## 目录结构

```
tradeguard/
├── backend/          # FastAPI 后端
│   ├── app/
│   │   ├── modules/  # 业务模块（auth/trade/market/risk/backtest）
│   │   └── ws/       # WebSocket（Binance 实时行情）
│   └── requirements.txt
└── frontend/         # React + Vite 前端
    └── src/
```
