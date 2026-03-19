import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import api from '@/lib/api'
import { MainLayout } from '@/layouts/MainLayout'
import { useBacktestStore, type BacktestRecordDetail } from '@/stores/useBacktestStore'
import { useBacktestSignalStore } from '@/stores/useBacktestSignalStore'

interface Trade {
  entry_time: string; exit_time: string; side: string; entry_price: number;
  exit_price: number; pnl: number; pnl_pct: number; duration: string;
}

interface Result {
  total_return: number; win_rate: number; profit_factor: number;
  max_drawdown: number; sharpe_ratio: number; total_trades: number;
  avg_holding_hours: number; trades: Trade[]; record_id?: string;
}

interface Condition {
  id: number
  type: string
  op: string
  // MA/EMA
  fast?: number
  slow?: number
  // KDJ
  n?: number
  line?: string
  target_line?: string
  // RSI/BOLL
  period?: number
  value?: number
}

const CONDITION_TYPES = [
  { value: 'MA', label: 'MA 均线交叉' },
  { value: 'EMA', label: 'EMA 均线交叉' },
  { value: 'KDJ', label: 'KDJ 指标' },
  { value: 'MACD', label: 'MACD 指标' },
  { value: 'RSI', label: 'RSI 指标' },
  { value: 'BOLL', label: '布林带' },
]

const OP_OPTIONS: Record<string, { value: string; label: string }[]> = {
  MA: [{ value: 'cross_above', label: '金叉 (快线上穿慢线)' }, { value: 'cross_below', label: '死叉 (快线下穿慢线)' }],
  EMA: [{ value: 'cross_above', label: '金叉 (快线上穿慢线)' }, { value: 'cross_below', label: '死叉 (快线下穿慢线)' }],
  KDJ: [{ value: 'cross_above', label: 'K 上穿 D (金叉)' }, { value: 'cross_below', label: 'K 下穿 D (死叉)' }],
  MACD: [{ value: 'cross_above', label: 'DIF 上穿 DEA (金叉)' }, { value: 'cross_below', label: 'DIF 下穿 DEA (死叉)' }],
  RSI: [{ value: 'lt', label: '低于阈值 (超卖)' }, { value: 'gt', label: '高于阈值 (超买)' }],
  BOLL: [{ value: 'touch_lower', label: '触及下轨' }, { value: 'touch_upper', label: '触及上轨' }],
}

let nextId = 1
function newCondition(type: string = 'MA'): Condition {
  const base: Condition = { id: nextId++, type, op: OP_OPTIONS[type]?.[0]?.value || 'cross_above' }
  if (type === 'MA' || type === 'EMA') { base.fast = 20; base.slow = 60 }
  if (type === 'KDJ') { base.n = 9; base.line = 'K'; base.target_line = 'D' }
  if (type === 'RSI') { base.period = 14; base.value = 30 }
  if (type === 'BOLL') { base.period = 20 }
  return base
}

function ConditionEditor({ cond, onChange, onRemove }: { cond: Condition; onChange: (c: Condition) => void; onRemove: () => void }) {
  const handleTypeChange = (type: string) => {
    onChange(newCondition(type))
  }

  return (
    <div className="bg-[var(--color-bg-input)] rounded-lg p-3 mb-2">
      <div className="flex items-center justify-between mb-2">
        <select value={cond.type} onChange={(e) => handleTypeChange(e.target.value)}
          className="!w-auto !px-2 !py-1 text-sm font-semibold">
          {CONDITION_TYPES.map((ct) => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
        </select>
        <button onClick={onRemove}
          className="text-xs px-2 py-1 rounded border-none bg-transparent text-[var(--color-text-disabled)] hover:text-[var(--color-short)] cursor-pointer">
          x
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {/* 操作类型 */}
        <select value={cond.op} onChange={(e) => onChange({ ...cond, op: e.target.value })}
          className="!px-2 !py-1 text-xs">
          {(OP_OPTIONS[cond.type] || []).map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
        </select>

        {/* MA/EMA 参数 */}
        {(cond.type === 'MA' || cond.type === 'EMA') && (
          <div className="flex gap-2 items-center text-xs">
            <span className="text-[var(--color-text-secondary)]">快线</span>
            <input
              type="text"
              inputMode="numeric"
              value={cond.fast ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '' || /^\d+$/.test(v)) onChange({ ...cond, fast: v === '' ? undefined : +v })
              }}
              className="!w-16 !px-2 !py-1 text-xs font-[var(--font-mono)]"
            />
            <span className="text-[var(--color-text-secondary)]">慢线</span>
            <input
              type="text"
              inputMode="numeric"
              value={cond.slow ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '' || /^\d+$/.test(v)) onChange({ ...cond, slow: v === '' ? undefined : +v })
              }}
              className="!w-16 !px-2 !py-1 text-xs font-[var(--font-mono)]"
            />
          </div>
        )}

        {/* KDJ 参数 */}
        {cond.type === 'KDJ' && (
          <div className="flex gap-2 items-center text-xs">
            <span className="text-[var(--color-text-secondary)]">N周期</span>
            <input
              type="text"
              inputMode="numeric"
              value={cond.n ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '' || /^\d+$/.test(v)) onChange({ ...cond, n: v === '' ? undefined : +v })
              }}
              className="!w-16 !px-2 !py-1 text-xs font-[var(--font-mono)]"
            />
          </div>
        )}

        {/* RSI 参数 */}
        {cond.type === 'RSI' && (
          <div className="flex gap-2 items-center text-xs">
            <span className="text-[var(--color-text-secondary)]">周期</span>
            <input
              type="text"
              inputMode="numeric"
              value={cond.period ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '' || /^\d+$/.test(v)) onChange({ ...cond, period: v === '' ? undefined : +v })
              }}
              className="!w-16 !px-2 !py-1 text-xs font-[var(--font-mono)]"
            />
            <span className="text-[var(--color-text-secondary)]">阈值</span>
            <input
              type="text"
              inputMode="numeric"
              value={cond.value ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '' || /^\d+$/.test(v)) onChange({ ...cond, value: v === '' ? undefined : +v })
              }}
              className="!w-16 !px-2 !py-1 text-xs font-[var(--font-mono)]"
            />
          </div>
        )}

        {/* BOLL 参数 */}
        {cond.type === 'BOLL' && (
          <div className="flex gap-2 items-center text-xs">
            <span className="text-[var(--color-text-secondary)]">周期</span>
            <input
              type="text"
              inputMode="numeric"
              value={cond.period ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '' || /^\d+$/.test(v)) onChange({ ...cond, period: v === '' ? undefined : +v })
              }}
              className="!w-16 !px-2 !py-1 text-xs font-[var(--font-mono)]"
            />
          </div>
        )}
      </div>
    </div>
  )
}

const LEVERAGE_PRESETS = [1, 2, 3, 5, 10, 20, 50, 75, 100, 125]

export function BacktestPage() {
  const navigate = useNavigate()
  const records = useBacktestStore((state) => state.records)
  const fetchRecords = useBacktestStore((state) => state.fetchRecords)
  const deleteRecord = useBacktestStore((state) => state.deleteRecord)
  const updateRecord = useBacktestStore((state) => state.updateRecord)
  const getRecord = useBacktestStore((state) => state.getRecord)
  const setSignals = useBacktestSignalStore((state) => state.setSignals)
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [interval, setInterval] = useState('15m')
  const [startDate, setStartDate] = useState('2025-01-01')
  const [endDate, setEndDate] = useState('2025-06-01')
  const [sl, setSl] = useState<string>('2')
  const [tp, setTp] = useState<string>('6')
  const [leverage, setLeverage] = useState(1)
  const [strategyName, setStrategyName] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [strategyMode, setStrategyMode] = useState<'long_only' | 'short_only' | 'bidirectional'>('long_only')
  const [entryConditions, setEntryConditions] = useState<Condition[]>([newCondition('MA')])
  const [exitConditions, setExitConditions] = useState<Condition[]>([])
  const [longEntryConditions, setLongEntryConditions] = useState<Condition[]>([newCondition('BOLL')])
  const [shortEntryConditions, setShortEntryConditions] = useState<Condition[]>([{ ...newCondition('BOLL'), op: 'touch_upper' }])
  const [activeTab, setActiveTab] = useState<'result' | 'history'>('result')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [detailResult, setDetailResult] = useState<Result | null>(null)
  const [detailRecord, setDetailRecord] = useState<BacktestRecordDetail | null>(null)

  const handleNumberInputChange = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    if (val === '' || /^\d*\.?\d*$/.test(val)) {
      setter(val)
    }
  }

  useEffect(() => {
    void fetchRecords()
  }, [fetchRecords])

  const condToApi = (cond: Condition) => {
    const obj: Record<string, unknown> = { type: cond.type, op: cond.op }
    if (cond.fast !== undefined) obj.fast = cond.fast
    if (cond.slow !== undefined) obj.slow = cond.slow
    if (cond.n !== undefined) obj.n = cond.n
    if (cond.line !== undefined) obj.line = cond.line
    if (cond.target_line !== undefined) obj.target_line = cond.target_line
    if (cond.period !== undefined) obj.period = cond.period
    if (cond.value !== undefined) obj.value = cond.value
    return obj
  }

  const runBacktest = async () => {
    setLoading(true)
    try {
      const payload: any = {
        symbol,
        interval,
        start_date: startDate,
        end_date: endDate,
        strategy_mode: strategyMode,
        stop_loss_pct: parseFloat(sl) || 0,
        take_profit_pct: parseFloat(tp) || 0,
        leverage,
        name: strategyName || undefined,
      }

      if (strategyMode === 'bidirectional') {
        payload.long_entry_conditions = longEntryConditions.map(condToApi)
        payload.short_entry_conditions = shortEntryConditions.map(condToApi)
      } else {
        payload.entry_conditions = entryConditions.map(condToApi)
        payload.exit_conditions = exitConditions.map(condToApi)
      }

      const resultData: Result = await api.post('/backtest/run', payload)
      setResult(resultData)
      setActiveTab('result')
      setDetailResult(null)
      setDetailRecord(null)
      void fetchRecords()
    } catch { /* ignore */ }
    setLoading(false)
  }

  const updateEntry = (i: number, c: Condition) => {
    setEntryConditions((prev) => prev.map((p, idx) => idx === i ? { ...c, id: p.id } : p))
  }
  const updateExit = (i: number, c: Condition) => {
    setExitConditions((prev) => prev.map((p, idx) => idx === i ? { ...c, id: p.id } : p))
  }
  const updateLongEntry = (i: number, c: Condition) => {
    setLongEntryConditions((prev) => prev.map((p, idx) => idx === i ? { ...c, id: p.id } : p))
  }
  const updateShortEntry = (i: number, c: Condition) => {
    setShortEntryConditions((prev) => prev.map((p, idx) => idx === i ? { ...c, id: p.id } : p))
  }

  const handleViewDetail = async (id: string) => {
    const detail = await getRecord(id)
    setDetailRecord(detail)
    setDetailResult({
      total_return: detail.total_return,
      win_rate: detail.win_rate,
      profit_factor: detail.profit_factor,
      max_drawdown: detail.max_drawdown,
      sharpe_ratio: detail.sharpe_ratio,
      total_trades: detail.total_trades,
      avg_holding_hours: detail.avg_holding_hours,
      trades: JSON.parse(detail.trades),
      record_id: detail.id,
    })
    setActiveTab('result')
  }

  const handleRename = async (id: string) => {
    if (!editName.trim()) return
    await updateRecord(id, { name: editName.trim() })
    setEditingId(null)
  }

  const handleApplyToDashboard = async (record: any) => {
    try {
      const detail = await getRecord(record.id)
      const trades = JSON.parse(detail.trades)
      if (!Array.isArray(trades) || trades.length === 0) return
      setSignals(trades, record.id, record.name, record.symbol, record.interval)
      setTimeout(() => {
        navigate(`/?symbol=${record.symbol}&interval=${record.interval}&t=${Date.now()}`)
      }, 300)
    } catch (error) {
      console.error('Failed to apply signals to dashboard:', error)
    }
  }

  const displayResult = detailResult || result

  return (
    <MainLayout>
      <div className="flex h-full bg-[var(--color-bg-primary)]">
        {/* 左侧配置 */}
        <div className="w-[380px] bg-[var(--color-bg-card)] border-r border-[var(--color-border)] overflow-y-auto flex flex-col custom-scrollbar">
          <div className="p-4 border-b border-[var(--color-border)]">
            <div className="text-sm font-bold mb-4 flex items-center gap-2">
              <span className="w-1.5 h-4 bg-[var(--color-accent)] rounded-full"></span>
              基础策略配置
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-[var(--color-text-disabled)] uppercase mb-1.5">Strategy Name</label>
                <input type="text" value={strategyName} onChange={(e) => setStrategyName(e.target.value)}
                  placeholder="留空自动生成名称" className="w-full text-sm font-medium" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[var(--color-text-disabled)] uppercase mb-1.5">Mode</label>
                <select value={strategyMode} onChange={(e) => setStrategyMode(e.target.value as any)} className="w-full font-bold">
                  <option value="long_only">仅做多 / Long Only</option>
                  <option value="short_only">仅做空 / Short Only</option>
                  <option value="bidirectional">双向自动 / Bi-directional</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-[var(--color-text-disabled)] uppercase mb-1.5">Symbol</label>
                  <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="w-full font-bold">
                    <option>BTCUSDT</option><option>ETHUSDT</option><option>SOLUSDT</option>
                    <option>BNBUSDT</option><option>XRPUSDT</option><option>DOGEUSDT</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[var(--color-text-disabled)] uppercase mb-1.5">Timeframe</label>
                  <select value={interval} onChange={(e) => setInterval(e.target.value)} className="w-full font-bold">
                    <option value="1m">1m</option><option value="5m">5m</option>
                    <option value="15m">15m</option><option value="1h">1h</option>
                    <option value="4h">4h</option><option value="1d">1d</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[var(--color-text-disabled)] uppercase mb-1.5">Date Range</label>
                <div className="flex gap-2 items-center">
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="flex-1 font-[var(--font-mono)] text-xs font-bold" />
                  <span className="text-[var(--color-text-disabled)]">-</span>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="flex-1 font-[var(--font-mono)] text-xs font-bold" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[var(--color-text-disabled)] uppercase mb-1.5">Leverage</label>
                <div className="flex items-center gap-3">
                  <input type="range" min={1} max={125} value={leverage} onChange={(e) => setLeverage(+e.target.value)}
                    className="flex-1 h-1 accent-[var(--color-accent)]" />
                  <span className="text-sm font-black font-[var(--font-mono)] text-[var(--color-accent)] min-w-[32px]">{leverage}x</span>
                </div>
                <div className="flex gap-1 mt-2 flex-wrap">
                  {LEVERAGE_PRESETS.map((v) => (
                    <button key={v} onClick={() => setLeverage(v)}
                      className={`text-[10px] px-1.5 py-0.5 rounded border transition-all font-bold ${
                        leverage === v ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]' : 'bg-transparent text-[var(--color-text-disabled)] border-[var(--color-border)] hover:text-[var(--color-text-primary)]'
                      }`}>
                      {v}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 条件编辑器部分 */}
          <div className="flex-1 overflow-y-auto">
            {strategyMode !== 'bidirectional' ? (
              <>
                <div className="p-4 border-b border-[var(--color-border)]">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] font-bold text-[var(--color-long)] uppercase tracking-widest">Entry Conditions</span>
                    <button onClick={() => setEntryConditions((prev) => [...prev, newCondition()])}
                      className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-long)] text-[var(--color-long)] hover:bg-[var(--color-long)] hover:text-white transition-all font-bold">
                      + ADD
                    </button>
                  </div>
                  <div className="space-y-2">
                    {entryConditions.map((cond, i) => (
                      <ConditionEditor key={cond.id} cond={cond} onChange={(c) => updateEntry(i, c)} onRemove={() => setEntryConditions((prev) => prev.filter((_, idx) => idx !== i))} />
                    ))}
                  </div>
                </div>
                <div className="p-4 border-b border-[var(--color-border)] bg-[var(--color-bg-hover)]/20">
                  <div className="text-[10px] font-bold text-[var(--color-short)] uppercase tracking-widest mb-4">Risk & Exit</div>
                  <div className="bg-[var(--color-bg-input)]/50 border border-[var(--color-border)] rounded-lg p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-[var(--color-text-disabled)] uppercase">Stop Loss</label>
                      <div className="flex items-center gap-1.5">
                        <input type="text" inputMode="decimal" value={sl} onChange={handleNumberInputChange(setSl)}
                          className="!w-12 !px-1.5 !py-0.5 text-xs text-center font-bold font-[var(--font-mono)] bg-transparent border-b border-[var(--color-border)] rounded-none" />
                        <span className="text-[10px] font-bold text-[var(--color-text-disabled)]">%</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-[var(--color-text-disabled)] uppercase">Take Profit</label>
                      <div className="flex items-center gap-1.5">
                        <input type="text" inputMode="decimal" value={tp} onChange={handleNumberInputChange(setTp)}
                          className="!w-12 !px-1.5 !py-0.5 text-xs text-center font-bold font-[var(--font-mono)] bg-transparent border-b border-[var(--color-border)] rounded-none" />
                        <span className="text-[10px] font-bold text-[var(--color-text-disabled)]">%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="p-4 border-b border-[var(--color-border)]">
                  <div className="flex items-center justify-between mb-4 text-[var(--color-long)]">
                    <span className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-long)] animate-pulse"></span>
                      Long Entry
                    </span>
                    <button onClick={() => setLongEntryConditions((prev) => [...prev, newCondition('BOLL')])}
                      className="text-[10px] px-2 py-0.5 rounded-full border border-current hover:bg-[var(--color-long)] hover:text-white transition-all font-bold">
                      + ADD
                    </button>
                  </div>
                  <div className="space-y-2">
                    {longEntryConditions.map((cond, i) => (
                      <ConditionEditor key={cond.id} cond={cond} onChange={(c) => updateLongEntry(i, c)} onRemove={() => setLongEntryConditions((prev) => prev.filter((_, idx) => idx !== i))} />
                    ))}
                  </div>
                </div>
                <div className="p-4 border-b border-[var(--color-border)]">
                  <div className="flex items-center justify-between mb-4 text-[var(--color-short)]">
                    <span className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-short)] animate-pulse"></span>
                      Short Entry
                    </span>
                    <button onClick={() => setShortEntryConditions((prev) => [...prev, { ...newCondition('BOLL'), op: 'touch_upper' }])}
                      className="text-[10px] px-2 py-0.5 rounded-full border border-current hover:bg-[var(--color-short)] hover:text-white transition-all font-bold">
                      + ADD
                    </button>
                  </div>
                  <div className="space-y-2">
                    {shortEntryConditions.map((cond, i) => (
                      <ConditionEditor key={cond.id} cond={cond} onChange={(c) => updateShortEntry(i, c)} onRemove={() => setShortEntryConditions((prev) => prev.filter((_, idx) => idx !== i))} />
                    ))}
                  </div>
                </div>
                <div className="p-4 border-b border-[var(--color-border)] bg-[var(--color-bg-hover)]/20">
                  <div className="text-[10px] font-bold text-[var(--color-text-disabled)] uppercase tracking-widest mb-4">Common Risk Control</div>
                  <div className="bg-[var(--color-bg-input)]/50 border border-[var(--color-border)] rounded-lg p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-[var(--color-text-disabled)] uppercase">Stop Loss</label>
                      <div className="flex items-center gap-1.5">
                        <input type="text" inputMode="decimal" value={sl} onChange={handleNumberInputChange(setSl)}
                          className="!w-12 !px-1.5 !py-0.5 text-xs text-center font-bold font-[var(--font-mono)] bg-transparent border-b border-[var(--color-border)] rounded-none" />
                        <span className="text-[10px] font-bold text-[var(--color-text-disabled)]">%</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-[var(--color-text-disabled)] uppercase">Take Profit</label>
                      <div className="flex items-center gap-1.5">
                        <input type="text" inputMode="decimal" value={tp} onChange={handleNumberInputChange(setTp)}
                          className="!w-12 !px-1.5 !py-0.5 text-xs text-center font-bold font-[var(--font-mono)] bg-transparent border-b border-[var(--color-border)] rounded-none" />
                        <span className="text-[10px] font-bold text-[var(--color-text-disabled)]">%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="p-5 mt-auto">
            <button onClick={runBacktest}
              disabled={loading || (strategyMode === 'bidirectional' ? longEntryConditions.length === 0 || shortEntryConditions.length === 0 : entryConditions.length === 0)}
              className="w-full py-3.5 bg-[var(--color-accent)] text-white rounded-lg font-black text-sm tracking-widest cursor-pointer hover:shadow-lg hover:shadow-[var(--color-accent)]/20 active:translate-y-[1px] transition-all disabled:opacity-30 disabled:translate-y-0 border-none">
              {loading ? 'PROCESSING...' : 'RUN BACKTEST'}
            </button>
          </div>
        </div>

        {/* 右侧结果 */}
        <div className="flex-1 overflow-y-auto flex flex-col bg-[var(--color-bg-primary)]">
          <div className="flex border-b border-[var(--color-border)] bg-[var(--color-bg-card)] shrink-0 px-2">
            <button onClick={() => { setActiveTab('result'); setDetailResult(null); setDetailRecord(null) }}
              className={`px-5 py-3 text-[10px] font-black tracking-widest uppercase border-none cursor-pointer transition-all ${activeTab === 'result' ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)] bg-transparent' : 'text-[var(--color-text-disabled)] bg-transparent hover:text-[var(--color-text-secondary)]'}`}>
              Current Result
            </button>
            <button onClick={() => setActiveTab('history')}
              className={`px-5 py-3 text-[10px] font-black tracking-widest uppercase border-none cursor-pointer transition-all ${activeTab === 'history' ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)] bg-transparent' : 'text-[var(--color-text-disabled)] bg-transparent hover:text-[var(--color-text-secondary)]'}`}>
              History Logs
              {records.length > 0 && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-bg-input)]">{records.length}</span>}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
            {activeTab === 'result' ? (
              !displayResult ? (
                <div className="h-full flex flex-col items-center justify-center text-[var(--color-text-disabled)] opacity-30">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-4"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21v-5h5"/></svg>
                  <div className="text-sm font-bold uppercase tracking-widest">Configure & Run to see performance</div>
                </div>
              ) : (
                <div className="flex flex-col gap-8 max-w-[1200px] mx-auto w-full">
                  {detailRecord && (
                    <div className="flex items-center justify-between p-4 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-sm">
                      <div className="flex items-center gap-3">
                        <button onClick={() => { setDetailResult(null); setDetailRecord(null); setActiveTab('history') }}
                          className="p-1.5 rounded-full hover:bg-[var(--color-bg-input)] transition-all"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg></button>
                        <div>
                          <div className="text-sm font-black">{detailRecord.name}</div>
                          <div className="text-[10px] text-[var(--color-text-disabled)] font-bold uppercase">{detailRecord.symbol} · {detailRecord.interval} · {detailRecord.leverage}x</div>
                        </div>
                      </div>
                      <button onClick={() => handleApplyToDashboard({ id: detailRecord.id, name: detailRecord.name, symbol: detailRecord.symbol, interval: detailRecord.interval })}
                        className="px-4 py-2 rounded-lg bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/30 text-[10px] font-black uppercase hover:bg-[var(--color-accent)] hover:text-white transition-all">Apply to Dashboard</button>
                    </div>
                  )}
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-5">
                    {[
                      { label: 'Total Return', value: `${displayResult.total_return > 0 ? '+' : ''}${displayResult.total_return}%`, color: displayResult.total_return >= 0 ? 'var(--color-long)' : 'var(--color-short)' },
                      { label: 'Win Rate', value: `${displayResult.win_rate}%`, color: 'var(--color-text-primary)' },
                      { label: 'Profit Factor', value: `${displayResult.profit_factor}x`, color: 'var(--color-accent)' },
                      { label: 'Max Drawdown', value: `-${displayResult.max_drawdown}%`, color: 'var(--color-short)' },
                      { label: 'Sharpe Ratio', value: `${displayResult.sharpe_ratio}`, color: 'var(--color-text-primary)' },
                      { label: 'Total Trades', value: `${displayResult.total_trades}`, color: 'var(--color-text-primary)' },
                    ].map((s) => (
                      <div key={s.label} className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl p-5 shadow-sm hover:translate-y-[-2px] transition-all">
                        <div className="text-[10px] text-[var(--color-text-disabled)] uppercase tracking-widest font-bold mb-2">{s.label}</div>
                        <div className="text-3xl font-black font-[var(--font-mono)] tracking-tighter" style={{ color: s.color }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl overflow-hidden shadow-sm">
                    <div className="px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-bg-hover)]/30 flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase tracking-widest">Trade Execution History</span>
                      <span className="text-[10px] font-bold text-[var(--color-text-disabled)]">{displayResult.trades.length} Positions</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="text-[10px] text-[var(--color-text-disabled)] uppercase font-bold tracking-wider">
                            <th className="px-5 py-3 border-b border-[var(--color-border)]">#</th>
                            <th className="px-4 py-3 border-b border(--color-border)]">Entry Time</th>
                            <th className="px-4 py-3 border-b border-[var(--color-border)] text-center">Side</th>
                            <th className="px-4 py-3 border-b border-[var(--color-border)] text-right">Entry</th>
                            <th className="px-4 py-3 border-b border-[var(--color-border)] text-right">Exit</th>
                            <th className="px-4 py-3 border-b border-[var(--color-border)] text-right">PnL%</th>
                            <th className="px-5 py-3 border-b border-[var(--color-border)] text-right">Duration</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--color-border)]/50">
                          {displayResult.trades.map((t, i) => (
                            <tr key={i} className="hover:bg-[var(--color-bg-hover)] transition-colors">
                              <td className="px-5 py-3 text-[10px] font-bold text-[var(--color-text-disabled)]">{i + 1}</td>
                              <td className="px-4 py-3 text-[11px] font-bold font-[var(--font-mono)]">{t.entry_time}</td>
                              <td className="px-4 py-3 text-center">
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-black uppercase ${t.side === 'LONG' ? 'bg-[var(--color-long)]/10 text-[var(--color-long)]' : 'bg-[var(--color-short)]/10 text-[var(--color-short)]'}`}>{t.side === 'LONG' ? 'Long' : 'Short'}</span>
                              </td>
                              <td className="px-4 py-3 text-[11px] font-bold font-[var(--font-mono)] text-right">{t.entry_price.toLocaleString()}</td>
                              <td className="px-4 py-3 text-[11px] font-bold font-[var(--font-mono)] text-right">{t.exit_price.toLocaleString()}</td>
                              <td className={`px-4 py-3 text-[11px] font-black font-[var(--font-mono)] text-right ${t.pnl_pct >= 0 ? 'text-[var(--color-long)]' : 'text-[var(--color-short)]'}`}>{t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct.toFixed(2)}%</td>
                              <td className="px-5 py-3 text-[10px] font-bold text-[var(--color-text-secondary)] text-right">{t.duration}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )
            ) : (
              records.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-[var(--color-text-disabled)] opacity-30">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-3"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="11" y2="17"/></svg>
                  <div className="text-sm font-bold uppercase tracking-widest">No backtest history yet</div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {records.map((r) => (
                    <div key={r.id} onClick={() => handleViewDetail(r.id)} className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl p-5 hover:border-[var(--color-accent)] cursor-pointer transition-all shadow-sm group">
                      <div className="flex items-center justify-between mb-4">
                        <div className="min-w-0">
                          {editingId === r.id ? (
                            <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} onBlur={() => handleRename(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') handleRename(r.id); if (e.key === 'Escape') setEditingId(null) }} onClick={(e) => e.stopPropagation()} autoFocus className="text-sm font-black !py-0.5 !px-1 w-full" />
                          ) : (
                            <div className="text-sm font-black truncate group-hover:text-[var(--color-accent)] transition-colors">{r.name}</div>
                          )}
                          <div className="text-[10px] text-[var(--color-text-disabled)] font-bold uppercase mt-1">{r.symbol} · {r.interval} · {r.leverage}x</div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={(e) => { e.stopPropagation(); deleteRecord(r.id) }} className="p-1.5 rounded-full hover:bg-[var(--color-short)]/10 text-[var(--color-text-disabled)] hover:text-[var(--color-short)] transition-all"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>
                        </div>
                      </div>
                      <div className="flex items-end justify-between">
                        <div>
                          <div className="text-[10px] text-[var(--color-text-disabled)] font-bold uppercase mb-1">Total Return</div>
                          <div className={`text-xl font-black font-[var(--font-mono)] ${r.total_return >= 0 ? 'text-[var(--color-long)]' : 'text-[var(--color-short)]'}`}>{r.total_return > 0 ? '+' : ''}{r.total_return}%</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[9px] text-[var(--color-text-disabled)] font-bold uppercase mb-1">Win Rate</div>
                          <div className="text-sm font-black">{r.win_rate}%</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  )
}
