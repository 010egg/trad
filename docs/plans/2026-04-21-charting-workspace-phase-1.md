# Charting Workspace Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为当前交易终端补齐第一阶段专业图表工作区能力：多个自选表、价格警报、技术警报、多条件警报、自定义时间周期、导出图表数据、K 线回放。

**Architecture:** 这一阶段不引入脚本系统、不做 tick 数据、不做复杂图表类型，全部基于现有 React + Zustand + FastAPI + SQLAlchemy 结构扩展。后端新增 `watchlist` / `alert` 模块与少量 `market` 聚合接口；前端在现有 `DashboardPage`、`MarketWatchlist`、`KlineChart` 基础上增加工作区状态、回放模式、导出和警报管理 UI。

**Tech Stack:** FastAPI, SQLAlchemy asyncio, SQLite/PostgreSQL, React 19, Zustand, lightweight-charts, Vitest, pytest

---

## Scope

本阶段只做以下能力：

1. 多个自选表
2. 价格警报
3. 技术警报
4. 多条件警报
5. 自定义时间周期
6. 导出图表数据
7. K 线回放

明确不做：

- 每页 16 图 / 200 并行图表连接
- 每图 50 指标
- tick 周期 / 秒级历史明细存储
- Pine Script 类脚本系统
- VP/TPO/砖型图/卡吉图/点数图
- 专业市场数据购买

---

### Task 1: 建立自选表数据模型与 CRUD API

**Files:**
- Create: `backend/app/modules/watchlist/__init__.py`
- Create: `backend/app/modules/watchlist/models.py`
- Create: `backend/app/modules/watchlist/schemas.py`
- Create: `backend/app/modules/watchlist/router.py`
- Create: `backend/app/modules/watchlist/service.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/database.py` only if model import path or metadata registration needs it
- Test: `backend/tests/test_watchlist.py`

**Step 1: 写失败测试**

在 `backend/tests/test_watchlist.py` 中写这些最小 API 测试：

- 创建自选表成功
- 获取当前用户自选表列表成功
- 重命名自选表成功
- 添加 symbol 到自选表成功
- 从自选表移除 symbol 成功
- 删除自选表成功
- 非本人自选表返回 404 或 403

**Step 2: 跑测试确认失败**

Run:

```bash
cd backend && .venv/bin/python -m pytest tests/test_watchlist.py -v
```

Expected:

- 失败，提示模块或路由不存在

**Step 3: 写最小模型与 schema**

实现两张表：

- `watchlists`
  - `id`
  - `user_id`
  - `name`
  - `sort_order`
  - `created_at`
  - `updated_at`
- `watchlist_items`
  - `id`
  - `watchlist_id`
  - `symbol`
  - `sort_order`
  - `created_at`

约束：

- 同一用户自选表名允许重名先不禁止
- 同一自选表内 symbol 唯一

**Step 4: 写最小 service / router**

提供这些接口：

- `GET /api/v1/watchlists`
- `POST /api/v1/watchlists`
- `PATCH /api/v1/watchlists/{watchlist_id}`
- `DELETE /api/v1/watchlists/{watchlist_id}`
- `POST /api/v1/watchlists/{watchlist_id}/items`
- `DELETE /api/v1/watchlists/{watchlist_id}/items/{symbol}`

**Step 5: 注册路由**

在 `backend/app/main.py` 中引入并 `include_router(...)`

**Step 6: 跑测试确认通过**

Run:

```bash
cd backend && .venv/bin/python -m pytest tests/test_watchlist.py -v
```

Expected:

- 全部通过

**Step 7: Commit**

```bash
git add backend/app/modules/watchlist backend/app/main.py backend/tests/test_watchlist.py
git commit -m "feat: add watchlist backend module"
```

---

### Task 2: 前端接入多个自选表

**Files:**
- Create: `frontend/src/stores/useWatchlistStore.ts`
- Modify: `frontend/src/features/market/MarketWatchlist.tsx`
- Modify: `frontend/src/pages/DashboardPage.tsx`
- Modify: `frontend/src/lib/api.ts` only if helper types are needed
- Test: `frontend/src/stores/useWatchlistStore.test.ts`

**Step 1: 写失败测试**

在 `frontend/src/stores/useWatchlistStore.test.ts` 中写最小测试：

- 拉取自选表后能选中第一个
- 切换 active watchlist 后只暴露当前列表的 symbols
- 新增/删除 symbol 时 store 状态更新正确

**Step 2: 跑测试确认失败**

Run:

```bash
cd frontend && npm test -- useWatchlistStore.test.ts
```

Expected:

- 失败，提示 store 不存在

**Step 3: 写最小 Zustand store**

状态至少包含：

- `watchlists`
- `activeWatchlistId`
- `loading`
- `error`
- `fetchWatchlists`
- `createWatchlist`
- `renameWatchlist`
- `deleteWatchlist`
- `addSymbol`
- `removeSymbol`
- `setActiveWatchlist`

**Step 4: 改 `MarketWatchlist`**

把现有单一 `symbols` 列表改成：

- 顶部显示 watchlist 切换 tabs/dropdown
- 列表内容来自当前 active watchlist
- 点击 symbol 仍沿用现有 `fetchKlines(symbol, interval)`

**Step 5: 在 `DashboardPage` 初始化 watchlist**

首次加载时同时拉：

- 市场 symbols
- watchlists

如果无自选表：

- 自动创建默认自选表 `默认列表`

**Step 6: 跑测试确认通过**

Run:

```bash
cd frontend && npm test -- useWatchlistStore.test.ts
```

**Step 7: 手工验证**

Run:

```bash
cd frontend && npm run build
```

Expected:

- 编译通过

**Step 8: Commit**

```bash
git add frontend/src/stores/useWatchlistStore.ts frontend/src/stores/useWatchlistStore.test.ts frontend/src/features/market/MarketWatchlist.tsx frontend/src/pages/DashboardPage.tsx
git commit -m "feat: add multiple watchlists to dashboard"
```

---

### Task 3: 建立警报数据模型与规则表达

**Files:**
- Create: `backend/app/modules/alert/__init__.py`
- Create: `backend/app/modules/alert/models.py`
- Create: `backend/app/modules/alert/schemas.py`
- Create: `backend/app/modules/alert/router.py`
- Create: `backend/app/modules/alert/service.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_alert.py`

**Step 1: 写失败测试**

测试最小覆盖：

- 创建价格警报成功
- 创建技术警报成功
- 创建多条件警报成功
- 获取警报列表成功
- 暂停/恢复警报成功
- 删除警报成功

**Step 2: 跑测试确认失败**

Run:

```bash
cd backend && .venv/bin/python -m pytest tests/test_alert.py -v
```

**Step 3: 设计最小 alert 表结构**

单表即可：

- `id`
- `user_id`
- `name`
- `scope_type` (`symbol` / `watchlist`)
- `scope_ref`
- `alert_type` (`price` / `technical`)
- `condition_json`
- `enabled`
- `trigger_once`
- `last_triggered_at`
- `created_at`
- `updated_at`

规则 JSON 第一阶段固定支持：

- 价格类：`price > x`, `price < x`, `crosses_above`, `crosses_below`
- 技术类：`RSI < x`, `MA fast cross MA slow`, `MACD cross`
- 多条件：`{ operator: "AND" | "OR", conditions: [...] }`

**Step 4: 写 router / service**

接口：

- `GET /api/v1/alerts`
- `POST /api/v1/alerts`
- `PATCH /api/v1/alerts/{alert_id}`
- `DELETE /api/v1/alerts/{alert_id}`

**Step 5: 跑测试确认通过**

Run:

```bash
cd backend && .venv/bin/python -m pytest tests/test_alert.py -v
```

**Step 6: Commit**

```bash
git add backend/app/modules/alert backend/app/main.py backend/tests/test_alert.py
git commit -m "feat: add alert backend module"
```

---

### Task 4: 实现警报求值引擎

**Files:**
- Modify: `backend/app/modules/alert/service.py`
- Modify: `backend/app/modules/market/service.py`
- Modify: `backend/app/modules/market/router.py` only if extra data endpoint needed
- Reference: `backend/app/modules/backtest/engine.py`
- Test: `backend/tests/test_alert_engine.py`

**Step 1: 写失败测试**

写纯 service 层测试，不走 HTTP：

- 价格上穿阈值触发
- RSI 小于阈值触发
- MA20 上穿 MA60 触发
- AND 条件全部满足才触发
- OR 条件任一满足触发
- disabled alert 不触发

**Step 2: 跑测试确认失败**

Run:

```bash
cd backend && .venv/bin/python -m pytest tests/test_alert_engine.py -v
```

**Step 3: 最小实现**

复用 `backtest.engine.calc_indicators(...)`，不要重复造指标轮子。

新增 service 函数：

- `evaluate_alert_condition(...)`
- `evaluate_alerts_for_symbol(...)`

先只支持按单个 symbol 求值，不做消息推送。

**Step 4: 跑测试确认通过**

Run:

```bash
cd backend && .venv/bin/python -m pytest tests/test_alert_engine.py -v
```

**Step 5: Commit**

```bash
git add backend/app/modules/alert/service.py backend/tests/test_alert_engine.py
git commit -m "feat: add alert evaluation engine"
```

---

### Task 5: 加入警报轮询执行器与触发记录

**Files:**
- Modify: `backend/app/main.py`
- Modify: `backend/app/modules/alert/service.py`
- Modify: `backend/app/modules/alert/models.py`
- Test: `backend/tests/test_alert_engine.py`

**Step 1: 写失败测试**

新增测试：

- enabled alert 被触发后更新 `last_triggered_at`
- `trigger_once=true` 的警报触发后自动禁用

**Step 2: 跑测试确认失败**

Run:

```bash
cd backend && .venv/bin/python -m pytest tests/test_alert_engine.py -v
```

**Step 3: 最小实现**

在 `app.main` 中加入后台 loop：

- 每 10-15 秒轮询一次 enabled alerts
- 按 symbol 分组获取价格/指标
- 满足条件则写回 trigger 记录

第一阶段不做通知渠道，只在数据库里落触发状态。

**Step 4: 跑测试确认通过**

Run:

```bash
cd backend && .venv/bin/python -m pytest tests/test_alert_engine.py -v
```

**Step 5: Commit**

```bash
git add backend/app/main.py backend/app/modules/alert backend/tests/test_alert_engine.py
git commit -m "feat: add alert scheduler loop"
```

---

### Task 6: 前端警报管理面板

**Files:**
- Create: `frontend/src/stores/useAlertStore.ts`
- Create: `frontend/src/features/market/AlertPanel.tsx`
- Modify: `frontend/src/pages/DashboardPage.tsx`
- Test: `frontend/src/stores/useAlertStore.test.ts`

**Step 1: 写失败测试**

测试：

- fetch alerts 后列表正确
- create alert 后本地列表追加
- toggle alert 后 enabled 状态更新
- delete alert 后本地列表移除

**Step 2: 跑测试确认失败**

Run:

```bash
cd frontend && npm test -- useAlertStore.test.ts
```

**Step 3: 写最小 store**

状态：

- `alerts`
- `loading`
- `error`
- `fetchAlerts`
- `createAlert`
- `updateAlert`
- `deleteAlert`

**Step 4: 写最小 UI**

在 `DashboardPage` 右侧或底部加入 `AlertPanel`：

- 当前 symbol 快速创建价格警报
- 当前 symbol 快速创建技术警报
- 列表展示已有警报
- 可启停、删除

第一阶段不做复杂可视化规则编辑器，先用表单项组合。

**Step 5: 跑测试确认通过**

Run:

```bash
cd frontend && npm test -- useAlertStore.test.ts
```

**Step 6: 编译验证**

Run:

```bash
cd frontend && npm run build
```

**Step 7: Commit**

```bash
git add frontend/src/stores/useAlertStore.ts frontend/src/stores/useAlertStore.test.ts frontend/src/features/market/AlertPanel.tsx frontend/src/pages/DashboardPage.tsx
git commit -m "feat: add alert management panel"
```

---

### Task 7: 自定义时间周期 API

**Files:**
- Modify: `backend/app/modules/market/router.py`
- Modify: `backend/app/modules/market/service.py`
- Test: `backend/tests/test_market_custom_interval.py`

**Step 1: 写失败测试**

测试：

- `2m`、`3m`、`45m`、`2h`、`3d` 可以返回聚合结果
- 无效周期返回 422
- 聚合 OHLCV 正确

**Step 2: 跑测试确认失败**

Run:

```bash
cd backend && .venv/bin/python -m pytest tests/test_market_custom_interval.py -v
```

**Step 3: 写最小实现**

策略：

- 若请求周期是 Binance 原生支持周期，沿用现有逻辑
- 若是自定义周期，从更细粒度基础周期取数再聚合

聚合规则：

- open = 首根 open
- high = max(high)
- low = min(low)
- close = 末根 close
- volume = sum(volume)

**Step 4: 跑测试确认通过**

Run:

```bash
cd backend && .venv/bin/python -m pytest tests/test_market_custom_interval.py -v
```

**Step 5: Commit**

```bash
git add backend/app/modules/market/router.py backend/app/modules/market/service.py backend/tests/test_market_custom_interval.py
git commit -m "feat: support custom chart intervals"
```

---

### Task 8: 前端自定义周期选择器

**Files:**
- Modify: `frontend/src/pages/DashboardPage.tsx`
- Modify: `frontend/src/stores/useMarketStore.ts`
- Test: `frontend/src/stores/useMarketStore.test.ts`

**Step 1: 写失败测试**

新增测试：

- 支持设置 `2m` / `45m` 这类自定义 interval
- 切换 interval 后请求参数正确

**Step 2: 跑测试确认失败**

Run:

```bash
cd frontend && npm test -- useMarketStore.test.ts
```

**Step 3: 最小实现**

UI：

- 预设周期按钮继续保留
- 增加自定义周期输入或 dropdown + number 组合

store：

- 不限制 interval 枚举值
- 保持原有 fetchKlines 行为

**Step 4: 跑测试确认通过**

Run:

```bash
cd frontend && npm test -- useMarketStore.test.ts
```

**Step 5: 编译验证**

Run:

```bash
cd frontend && npm run build
```

**Step 6: Commit**

```bash
git add frontend/src/pages/DashboardPage.tsx frontend/src/stores/useMarketStore.ts frontend/src/stores/useMarketStore.test.ts
git commit -m "feat: add custom interval selector"
```

---

### Task 9: 图表数据导出

**Files:**
- Create: `frontend/src/features/chart/exportChartData.ts`
- Modify: `frontend/src/features/chart/KlineChart.tsx`
- Modify: `frontend/src/stores/useMarketStore.ts` if export needs extra current-state selector
- Test: `frontend/src/features/chart/exportChartData.test.ts`

**Step 1: 写失败测试**

测试：

- 将 K 线数组导出为 CSV 字符串
- 包含表头
- 包含时间、OHLCV
- 空数据时仍导出表头

**Step 2: 跑测试确认失败**

Run:

```bash
cd frontend && npm test -- exportChartData.test.ts
```

**Step 3: 写最小实现**

导出项：

- CSV
- JSON（可选）

在图表顶部工具区加入“导出 CSV”按钮。

**Step 4: 跑测试确认通过**

Run:

```bash
cd frontend && npm test -- exportChartData.test.ts
```

**Step 5: 编译验证**

Run:

```bash
cd frontend && npm run build
```

**Step 6: Commit**

```bash
git add frontend/src/features/chart/exportChartData.ts frontend/src/features/chart/exportChartData.test.ts frontend/src/features/chart/KlineChart.tsx
git commit -m "feat: add chart data export"
```

---

### Task 10: K 线回放模式

**Files:**
- Create: `frontend/src/stores/useReplayStore.ts`
- Modify: `frontend/src/features/chart/KlineChart.tsx`
- Modify: `frontend/src/stores/useMarketStore.ts`
- Test: `frontend/src/stores/useReplayStore.test.ts`

**Step 1: 写失败测试**

测试：

- 初始化回放时只显示到指定 index
- `play` 后 index 递增
- `pause` 后 index 停止
- `seek` 后显示对应切片

**Step 2: 跑测试确认失败**

Run:

```bash
cd frontend && npm test -- useReplayStore.test.ts
```

**Step 3: 写最小 store**

状态：

- `enabled`
- `playing`
- `cursor`
- `speed`
- `sourceKlines`
- `startReplay`
- `pauseReplay`
- `resumeReplay`
- `seekReplay`
- `stopReplay`

**Step 4: 改图表消费逻辑**

`KlineChart` 优先渲染：

- 回放模式：`sourceKlines.slice(0, cursor)`
- 普通模式：实时 `klines`

工具条加入：

- 开始回放
- 播放 / 暂停
- 拖动进度
- 倍速

**Step 5: 跑测试确认通过**

Run:

```bash
cd frontend && npm test -- useReplayStore.test.ts
```

**Step 6: 编译验证**

Run:

```bash
cd frontend && npm run build
```

**Step 7: Commit**

```bash
git add frontend/src/stores/useReplayStore.ts frontend/src/stores/useReplayStore.test.ts frontend/src/features/chart/KlineChart.tsx frontend/src/stores/useMarketStore.ts
git commit -m "feat: add chart replay mode"
```

---

### Task 11: 第一阶段整体验证

**Files:**
- Modify as needed based on issues found

**Step 1: 跑后端测试**

Run:

```bash
cd backend && .venv/bin/python -m pytest tests/test_watchlist.py tests/test_alert.py tests/test_alert_engine.py tests/test_market_custom_interval.py tests/test_market_service.py -v
```

**Step 2: 跑前端测试**

Run:

```bash
cd frontend && npm test -- useWatchlistStore.test.ts useAlertStore.test.ts useReplayStore.test.ts exportChartData.test.ts useMarketStore.test.ts
```

**Step 3: 跑前端构建**

Run:

```bash
cd frontend && npm run build
```

**Step 4: 跑后端编译检查**

Run:

```bash
cd backend && .venv/bin/python -m py_compile app/main.py app/modules/market/service.py app/modules/market/router.py app/modules/watchlist/router.py app/modules/watchlist/service.py app/modules/alert/router.py app/modules/alert/service.py
```

**Step 5: 手工联调**

验证以下路径：

- 登录后能看到多个自选表
- 切换自选表不影响主图 symbol 切换逻辑
- 可以创建价格警报
- 可以创建技术警报
- 自定义周期可正常拉取数据
- 图表可导出 CSV
- 回放模式可播放 / 暂停 / 拖动

**Step 6: 最终 Commit**

```bash
git add backend frontend docs/plans/2026-04-21-charting-workspace-phase-1.md
git commit -m "feat: deliver charting workspace phase 1"
```

