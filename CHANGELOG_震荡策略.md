# 🎉 回测功能更新 - 震荡策略支持

## 📅 更新时间
2026-03-02

## ✨ 新增功能

### 1️⃣ 双向交易支持
- ✅ **做多（LONG）**: 原有功能
- ✅ **做空（SHORT）**: 新增做空支持，收益计算自动反向
- ✅ **双向交易（BIDIRECTIONAL）**: 可同时持有多空仓位

### 2️⃣ 震荡策略引擎
专为震荡市场设计的交易引擎：

```python
# 策略逻辑
- 价格触及布林带下轨 → 开多单
- 价格触及布林带上轨 → 开空单
- 价格回归中轨 → 平仓
- 突破止损/止盈 → 强制平仓
```

### 3️⃣ 策略预设系统
内置3个经典策略预设，开箱即用：

1. **布林带震荡策略** - 适合横盘市
2. **MA趋势跟踪** - 适合趋势市
3. **RSI反转策略** - 适合超买超卖

### 4️⃣ API 增强
- 新增 `GET /api/v1/backtest/presets` - 获取策略预设
- 更新 `POST /api/v1/backtest/run` - 支持 `strategy_mode` 参数

## 🔧 技术改进

### 回测引擎重构
```python
# 之前：单向交易
def run_backtest(...):
    # 只支持做多

# 现在：多模式支持
def run_backtest(..., strategy_mode="long_only"):
    if strategy_mode == "bidirectional":
        return _run_bidirectional_backtest(...)
    else:
        return _run_unidirectional_backtest(..., side)
```

### 新增函数
- `_run_unidirectional_backtest()` - 单向交易引擎
- `_run_bidirectional_backtest()` - 双向交易引擎
- `_check_boll_middle_cross()` - 布林带中轨判断

## 📝 使用示例

### 快速测试
```bash
cd /Users/xionghaoqiang/Trade/tradeguard
python3 test_oscillation_strategy.py
```

### API 调用
```python
import requests

response = requests.post(
    "http://localhost:8000/api/v1/backtest/run",
    headers={"Authorization": f"Bearer {token}"},
    json={
        "symbol": "BTCUSDT",
        "interval": "15m",
        "start_date": "2026-02-01",
        "end_date": "2026-03-02",
        "strategy_mode": "bidirectional",  # 🆕 双向交易
        "entry_conditions": [
            {"type": "BOLL", "op": "touch_lower", "period": 20}
        ],
        "exit_conditions": [
            {"type": "BOLL", "op": "touch_upper", "period": 20}
        ],
        "stop_loss_pct": 3.0,
        "take_profit_pct": 5.0
    }
)
```

## 📊 回测结果示例

```
✅ 回测完成！

📈 绩效指标:
  总收益率:        12.45%
  胜率:            65.0%
  盈亏比:           1.85
  最大回撤:         8.30%
  夏普比率:         1.42
  总交易次数:         25
  平均持仓时长:     4.2小时

💼 交易明细:
🟢 做多交易 (13 笔):
2026-02-15 10:30     2026-02-15 14:45     LONG   66500.00   67200.00     3.15%    105.23
...

🔴 做空交易 (12 笔):
2026-02-18 16:20     2026-02-18 19:30     SHORT  68300.00   67800.00     2.92%     97.50
...
```

## 🎯 适用场景

### ✅ 适合震荡策略的市场
- 横盘整理
- 区间震荡
- 有明显支撑阻力

### ❌ 不适合的市场
- 强势单边上涨
- 恐慌性下跌
- 趋势刚刚形成

## ⚠️ 注意事项

1. **回测仅供参考**
   - 未包含滑点和手续费
   - 历史不代表未来
   - 建议小仓位实盘验证

2. **风险控制**
   - `risk_per_trade` 建议 ≤ 2%
   - 双向交易时自动减半仓位
   - 及时止损，严格执行

3. **市场判断**
   - 震荡策略需要先判断市场状态
   - 可配合趋势指标（ADX）过滤
   - 趋势市场应切换为趋势跟踪策略

## 🚀 未来规划

### 短期计划
- [ ] 手续费和滑点模拟
- [ ] 前端震荡策略配置界面
- [ ] 策略性能对比图表

### 中期计划
- [ ] 参数优化器（网格搜索/遗传算法）
- [ ] Walk-forward 分析
- [ ] 更多技术指标（ATR, ADX, CCI）

### 长期计划
- [ ] 多品种组合回测
- [ ] 高级仓位管理（凯利公式）
- [ ] 实时策略监控
- [ ] 半自动/全自动交易

## 📖 相关文档

- 📘 [回测功能说明.md](./回测功能说明.md) - 完整使用文档
- 🧪 [test_oscillation_strategy.py](./test_oscillation_strategy.py) - 测试脚本
- 🌐 [API 文档](http://localhost:8000/docs) - Swagger 接口文档

## 🙏 鸣谢

感谢使用 TradeGuard！如有问题欢迎反馈。

---

**Happy Trading! 📈💰**
