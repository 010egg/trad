import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import api from '@/lib/api'
import { MainLayout } from '@/layouts/MainLayout'
import { useBacktestStore, type BacktestRecord, type BacktestRecordDetail } from '@/stores/useBacktestStore'
import { useBacktestSignalStore } from '@/stores/useBacktestSignalStore'

interface Trade {
  entry_time: string; exit_time: string; side: string; entry_price: number;
  exit_price: number; pnl: number; pnl_pct: number; duration: string;
}

interface Result {
  total_return_pct: number; win_rate: number; profit_factor: number;
  max_drawdown: number; sharpe_ratio: number; total_trades: number;
  avg_holding_hours: number; sortino_ratio: number;
  max_consecutive_losses: number; max_dd_duration_hours: number;
  tail_ratio: number; trades: Trade[]; record_id?: string;
  final_balance?: number;
}

interface AvailableDataItem {
  symbol: string
  interval: string
  count: number
  start_date: string
  end_date: string
}

interface StoredCondition {
  type?: string
  op?: string
  fast?: number
  slow?: number
  n?: number
  line?: string
  target_line?: string
  period?: number
  value?: number
  fast_period?: number
  slow_period?: number
  signal?: number
}

interface Condition {
  id: number
  type: string
  op: string
  fast?: number
  slow?: number
  n?: number
  line?: string
  target_line?: string
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

function parseJsonArray<T>(raw: string): T[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function formatNumber(value: number, digits: number = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '--'
}

function formatPercent(value: number, digits: number = 2, signed: boolean = false): string {
  return `${signed && value > 0 ? '+' : ''}${formatNumber(value, digits)}%`
}

function formatMultiplier(value: number, digits: number = 0): string {
  return `${formatNumber(value, digits)}x`
}

function formatHours(value: number, digits: number = 1): string {
  return `${formatNumber(value, digits)}h`
}

function formatAssetAmount(value: number, asset: string | null, digits: number = 2, signed: boolean = false): string {
  return `${signed && value > 0 ? '+' : ''}${formatNumber(value, digits)} ${asset || 'quote_asset'}`
}

function toPrettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function sanitizeFileName(value: string): string {
  const invalidFileNameChars = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])

  return value
    .trim()
    .split('')
    .filter((char) => char.charCodeAt(0) >= 32 && !invalidFileNameChars.has(char))
    .join('')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'backtest'
}

function detectQuoteAsset(symbol: string): string | null {
  const knownQuoteAssets = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'BTC', 'ETH', 'BNB']
  return knownQuoteAssets.find((asset) => symbol.endsWith(asset)) || null
}

function parseDurationHours(duration: string): number | null {
  const parsed = Number(duration.replace(/h$/i, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function buildAiRecord(detail: BacktestRecordDetail, entryConditions: StoredCondition[], exitConditions: StoredCondition[], trades: Trade[]) {
  const quoteAsset = detectQuoteAsset(detail.symbol)
  const normalizedTrades = trades.map((trade, index) => ({
    index: index + 1,
    side: trade.side,
    entry_time: trade.entry_time,
    exit_time: trade.exit_time,
    entry_price: formatAssetAmount(trade.entry_price, quoteAsset, 2),
    exit_price: formatAssetAmount(trade.exit_price, quoteAsset, 2),
    pnl: formatAssetAmount(trade.pnl, quoteAsset, 2, true),
    pnl_pct: formatPercent(trade.pnl_pct, 2, true),
    duration: trade.duration,
    duration_hours: parseDurationHours(trade.duration),
  }))

  return {
    schema_version: 'backtest_record_export_v3',
    export_purpose: 'ai_readable_backtest_record',
    exported_at: new Date().toLocaleString('zh-CN', { hour12: false }),
    record: {
      id: detail.id,
      name: detail.name,
      symbol: detail.symbol,
      quote_asset: quoteAsset,
      interval: detail.interval,
      start_date: detail.start_date,
      end_date: detail.end_date,
      strategy_parameters: {
        leverage: formatMultiplier(detail.leverage),
        stop_loss_pct: formatPercent(detail.stop_loss_pct),
        take_profit_pct: formatPercent(detail.take_profit_pct),
      },
      balances: {
        initial_balance: formatAssetAmount(detail.initial_balance, quoteAsset, 2),
        final_balance: formatAssetAmount(detail.final_balance, quoteAsset, 2),
      },
      metrics: {
        total_return_pct: formatPercent(detail.total_return_pct, 2, true),
        win_rate: formatPercent(detail.win_rate, 1),
        profit_factor: formatMultiplier(detail.profit_factor, 2),
        max_drawdown: formatPercent(detail.max_drawdown),
        sharpe_ratio: formatNumber(detail.sharpe_ratio),
        total_trades: detail.total_trades,
        avg_holding_hours: formatHours(detail.avg_holding_hours, 1),
      },
      strategy_conditions: {
        entry_conditions: entryConditions,
        exit_conditions: exitConditions,
      },
      trades: normalizedTrades,
      created_at: detail.created_at,
    },
  }
}

function buildBacktestMarkdown(detail: BacktestRecordDetail): string {
  const entryConditions = parseJsonArray<StoredCondition>(detail.entry_conditions)
  const exitConditions = parseJsonArray<StoredCondition>(detail.exit_conditions)
  const trades = parseJsonArray<Trade>(detail.trades)
  const aiRecord = buildAiRecord(detail, entryConditions, exitConditions, trades)

  return [
    `# ${detail.name}`,
    '',
    '## record_json',
    '```json',
    toPrettyJson(aiRecord),
    '```',
  ].filter(Boolean).join('\n')
}

function downloadMarkdown(detail: BacktestRecordDetail): void {
  const markdown = buildBacktestMarkdown(detail)
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = `${sanitizeFileName(`${detail.name || detail.symbol}-${detail.start_date}-${detail.end_date}`)}.md`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.URL.revokeObjectURL(url)
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

function storedCondToCondition(sc: StoredCondition): Condition {
  const type = sc.type || 'MA'
  const base = newCondition(type)
  return {
    ...base,
    op: sc.op ?? base.op,
    fast: sc.fast ?? base.fast,
    slow: sc.slow ?? base.slow,
    n: sc.n ?? base.n,
    line: sc.line ?? base.line,
    target_line: sc.target_line ?? base.target_line,
    period: sc.period ?? base.period,
    value: sc.value ?? base.value,
  }
}

function ConditionEditor({ cond, onChange, onRemove }: { cond: Condition; onChange: (c: Condition) => void; onRemove: () => void }) {
  const handleTypeChange = (type: string) => onChange(newCondition(type))
  return (
    <div className="bg-[var(--color-bg-input)] rounded-lg p-3 mb-2">
      <div className="flex items-center justify-between mb-2">
        <select value={cond.type} onChange={(e) => handleTypeChange(e.target.value)} className="!w-auto !px-2 !py-1 text-sm font-semibold">
          {CONDITION_TYPES.map((ct) => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
        </select>
        <button onClick={onRemove} className="text-xs px-2 py-1 rounded border-none bg-transparent text-[var(--color-text-disabled)] hover:text-[var(--color-short)] cursor-pointer">x</button>
      </div>
      <div className="flex flex-col gap-2">
        <select value={cond.op} onChange={(e) => onChange({ ...cond, op: e.target.value })} className="!px-2 !py-1 text-xs">
          {(OP_OPTIONS[cond.type] || []).map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
        </select>
        {(cond.type === 'MA' || cond.type === 'EMA') && (
          <div className="flex gap-2 items-center text-xs">
            <span className="text-[var(--color-text-secondary)]">快线</span>
            <input type="text" inputMode="numeric" value={cond.fast ?? ''} onChange={(e) => { const v = e.target.value; if (v === '' || /^\d+$/.test(v)) onChange({ ...cond, fast: v === '' ? undefined : +v }) }} className="!w-16 !px-2 !py-1 text-xs font-[var(--font-mono)]" />
            <span className="text-[var(--color-text-secondary)]">慢线</span>
            <input type="text" inputMode="numeric" value={cond.slow ?? ''} onChange={(e) => { const v = e.target.value; if (v === '' || /^\d+$/.test(v)) onChange({ ...cond, slow: v === '' ? undefined : +v }) }} className="!w-16 !px-2 !py-1 text-xs font-[var(--font-mono)]" />
          </div>
        )}
        {cond.type === 'KDJ' && (
          <div className="flex gap-2 items-center text-xs">
            <span className="text-[var(--color-text-secondary)]">N周期</span>
            <input type="text" inputMode="numeric" value={cond.n ?? ''} onChange={(e) => { const v = e.target.value; if (v === '' || /^\d+$/.test(v)) onChange({ ...cond, n: v === '' ? undefined : +v }) }} className="!w-16 !px-2 !py-1 text-xs font-[var(--font-mono)]" />
          </div>
        )}
        {cond.type === 'RSI' && (
          <div className="flex gap-2 items-center text-xs">
            <span className="text-[var(--color-text-secondary)]">周期</span>
            <input type="text" inputMode="numeric" value={cond.period ?? ''} onChange={(e) => { const v = e.target.value; if (v === '' || /^\d+$/.test(v)) onChange({ ...cond, period: v === '' ? undefined : +v }) }} className="!w-16 !px-2 !py-1 text-xs font-[var(--font-mono)]" />
            <span className="text-[var(--color-text-secondary)]">阈值</span>
            <input type="text" inputMode="numeric" value={cond.value ?? ''} onChange={(e) => { const v = e.target.value; if (v === '' || /^\d+$/.test(v)) onChange({ ...cond, value: v === '' ? undefined : +v }) }} className="!w-16 !px-2 !py-1 text-xs font-[var(--font-mono)]" />
          </div>
        )}
        {cond.type === 'BOLL' && (
          <div className="flex gap-2 items-center text-xs">
            <span className="text-[var(--color-text-secondary)]">周期</span>
            <input type="text" inputMode="numeric" value={cond.period ?? ''} onChange={(e) => { const v = e.target.value; if (v === '' || /^\d+$/.test(v)) onChange({ ...cond, period: v === '' ? undefined : +v }) }} className="!w-16 !px-2 !py-1 text-xs font-[var(--font-mono)]" />
          </div>
        )}
      </div>
    </div>
  )
}

const LEVERAGE_PRESETS = [1, 2, 3, 5, 10, 20, 50, 75, 100, 125]

type HistorySortField = 'total_return_pct' | 'win_rate' | 'profit_factor' | 'max_drawdown' | 'sharpe_ratio' | 'sortino_ratio' | 'max_consecutive_losses' | 'max_dd_duration_hours' | 'tail_ratio' | 'total_trades' | 'avg_holding_hours' | 'position_pct' | 'leverage' | 'created_at'

const HISTORY_SORT_OPTIONS: { value: HistorySortField; label: string }[] = [
  { value: 'total_return_pct', label: '收益率' },
  { value: 'win_rate', label: '胜率' },
  { value: 'profit_factor', label: '盈亏比' },
  { value: 'max_drawdown', label: '回撤' },
  { value: 'sharpe_ratio', label: '夏普' },
  { value: 'sortino_ratio', label: 'Sortino' },
  { value: 'max_consecutive_losses', label: '连亏' },
  { value: 'max_dd_duration_hours', label: '回撤时长' },
  { value: 'tail_ratio', label: '尾部' },
  { value: 'total_trades', label: '交易数' },
  { value: 'avg_holding_hours', label: '持仓' },
  { value: 'position_pct', label: '仓位' },
  { value: 'leverage', label: '杠杆' },
  { value: 'created_at', label: '时间' },
]

function getRecordSortValue(record: BacktestRecord, field: HistorySortField): number {
  if (field === 'created_at') return Date.parse(record.created_at) || 0
  return record[field]
}

export function BacktestPage() {
  const navigate = useNavigate()
  const records = useBacktestStore((state) => state.records)
  const fetchRecords = useBacktestStore((state) => state.fetchRecords)
  const deleteRecord = useBacktestStore((state) => state.deleteRecord)
  const updateRecord = useBacktestStore((state) => state.updateRecord)
  const getRecord = useBacktestStore((state) => state.getRecord)
  const toggleFavorite = useBacktestStore((state) => state.toggleFavorite)
  const updateTags = useBacktestStore((state) => state.updateTags)
  const setSignals = useBacktestSignalStore((state) => state.setSignals)
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [interval, setInterval] = useState('15m')
  const [startDate, setStartDate] = useState('2025-01-01')
  const [endDate, setEndDate] = useState('2025-06-01')
  const [sl, setSl] = useState<string>('2')
  const [tp, setTp] = useState<string>('6')
  const [positionPct, setPositionPct] = useState<string>('50')
  const [leverage, setLeverage] = useState(1)
  const [strategyName, setStrategyName] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [strategyMode, setStrategyMode] = useState<'long_only' | 'short_only' | 'bidirectional' | 'dca' | 'martingale'>('long_only')
  // DCA 参数
  const [dcaIntervalBars, setDcaIntervalBars] = useState<string>('24')
  const [dcaAmount, setDcaAmount] = useState<string>('100')
  const [dcaTakeProfitPct, setDcaTakeProfitPct] = useState<string>('')
  // 马丁格尔参数
  const [martingaleMultiplier, setMartingaleMultiplier] = useState<string>('2')
  const [martingaleMaxRounds, setMartingaleMaxRounds] = useState<string>('4')
  const [martingaleResetOnWin, setMartingaleResetOnWin] = useState(true)
  const [entryConditions, setEntryConditions] = useState<Condition[]>([newCondition('MA')])
  const [exitConditions, setExitConditions] = useState<Condition[]>([])
  const [longEntryConditions, setLongEntryConditions] = useState<Condition[]>([newCondition('BOLL')])
  const [shortEntryConditions, setShortEntryConditions] = useState<Condition[]>([{ ...newCondition('BOLL'), op: 'touch_upper' }])
  const [activeTab, setActiveTab] = useState<'result' | 'history'>('result')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [detailResult, setDetailResult] = useState<Result | null>(null)
  const [detailRecord, setDetailRecord] = useState<BacktestRecordDetail | null>(null)
  const [historySortField, setHistorySortField] = useState<HistorySortField>('total_return_pct')
  const [historySortDirection, setHistorySortDirection] = useState<'desc' | 'asc'>('desc')
  const [availableData, setAvailableData] = useState<AvailableDataItem[]>([])
  const [tagFilters, setTagFilters] = useState<string[]>([])
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  const [addingTagFor, setAddingTagFor] = useState<string | null>(null)
  const [newTagInput, setNewTagInput] = useState('')

  // 收集所有已使用的 tag（去重、排序）
  const allTags = [...new Set(records.flatMap((r) => r.tags))].sort()

  const handleNumberInputChange = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    if (val === '' || /^\d*\.?\d*$/.test(val)) setter(val)
  }

  useEffect(() => { void fetchRecords() }, [fetchRecords])

  useEffect(() => {
    const fetchAvailableData = async () => {
      try {
        const rows: AvailableDataItem[] = await api.get('/backtest/available-data')
        setAvailableData(rows)
      } catch (error) {
        console.error('Failed to fetch available historical data:', error)
      }
    }

    void fetchAvailableData()
  }, [])

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
      const slVal = parseFloat(sl) || 0
      // 仓位占比 → risk_per_trade：引擎用 risk/sl 算仓位比例，反推即 positionPct/100 * sl
      const riskPerTrade = (parseFloat(positionPct) || 50) * slVal / 100
      const payload: any = { symbol, interval, start_date: startDate, end_date: endDate, strategy_mode: strategyMode, stop_loss_pct: slVal, take_profit_pct: parseFloat(tp) || 0, risk_per_trade: riskPerTrade, leverage, name: strategyName || undefined }
      console.log('[handleRun] payload.strategy_mode:', payload.strategy_mode, '| entryConditions[0].op:', entryConditions[0]?.op)
      if (strategyMode === 'dca') {
        payload.dca_interval_bars = parseInt(dcaIntervalBars) || 24
        payload.dca_amount = parseFloat(dcaAmount) || 100
        payload.dca_take_profit_pct = dcaTakeProfitPct ? parseFloat(dcaTakeProfitPct) : null
      } else if (strategyMode === 'martingale') {
        payload.entry_conditions = entryConditions.map(condToApi); payload.exit_conditions = exitConditions.map(condToApi)
        payload.martingale_multiplier = parseFloat(martingaleMultiplier) || 2
        payload.martingale_max_rounds = parseInt(martingaleMaxRounds) || 4
        payload.martingale_reset_on_win = martingaleResetOnWin
      } else if (strategyMode === 'bidirectional') { payload.long_entry_conditions = longEntryConditions.map(condToApi); payload.short_entry_conditions = shortEntryConditions.map(condToApi) }
      else { payload.entry_conditions = entryConditions.map(condToApi); payload.exit_conditions = exitConditions.map(condToApi) }
      const resultData: Result = await api.post('/backtest/run', payload)
      setResult(resultData); setActiveTab('result'); setDetailResult(null); setDetailRecord(null); void fetchRecords()
    } catch {}
    setLoading(false)
  }

  const updateEntry = (i: number, c: Condition) => setEntryConditions((prev) => prev.map((p, idx) => idx === i ? { ...c, id: p.id } : p))
  const updateExit = (i: number, c: Condition) => setExitConditions((prev) => prev.map((p, idx) => idx === i ? { ...c, id: p.id } : p))
  const updateLongEntry = (i: number, c: Condition) => setLongEntryConditions((prev) => prev.map((p, idx) => idx === i ? { ...c, id: p.id } : p))
  const updateShortEntry = (i: number, c: Condition) => setShortEntryConditions((prev) => prev.map((p, idx) => idx === i ? { ...c, id: p.id } : p))

  const handleViewDetail = async (id: string) => {
    const detail = await getRecord(id)
    setDetailRecord(detail)
    setDetailResult({
      total_return_pct: detail.total_return_pct,
      win_rate: detail.win_rate,
      profit_factor: detail.profit_factor,
      max_drawdown: detail.max_drawdown,
      sharpe_ratio: detail.sharpe_ratio,
      sortino_ratio: detail.sortino_ratio,
      max_consecutive_losses: detail.max_consecutive_losses,
      max_dd_duration_hours: detail.max_dd_duration_hours,
      tail_ratio: detail.tail_ratio,
      total_trades: detail.total_trades,
      avg_holding_hours: detail.avg_holding_hours,
      trades: parseJsonArray<Trade>(detail.trades),
      record_id: detail.id,
      final_balance: detail.final_balance,
    })
    setActiveTab('result')
  }

  const handleRename = async (id: string) => { if (!editName.trim()) return; await updateRecord(id, { name: editName.trim() }); setEditingId(null) }

  const handleApplyToDashboard = async (record: any) => {
    try {
      const detail = await getRecord(record.id); const trades = JSON.parse(detail.trades)
      if (!Array.isArray(trades) || trades.length === 0) return
      setSignals(trades, record.id, record.name, record.symbol, record.interval)
      setTimeout(() => { navigate(`/?symbol=${record.symbol}&interval=${record.interval}&t=${Date.now()}`) }, 300)
    } catch (error) { console.error('Failed to apply signals to dashboard:', error) }
  }

  const handleApplyToStrategy = async (record: BacktestRecordDetail) => {
    try {
      const detail = detailRecord?.id === record.id ? record : await getRecord(record.id)
      setSymbol(detail.symbol)
      setInterval(detail.interval)
      setStartDate(detail.start_date)
      setEndDate(detail.end_date)
      setSl(String(detail.stop_loss_pct))
      setTp(String(detail.take_profit_pct))
      setLeverage(detail.leverage)
      setStrategyName('')
      // 直接使用后端已计算好的 position_pct，避免 Math.round 精度丢失
      setPositionPct(String(detail.position_pct))
      // 恢复原始策略模式
      let mode = (detail.strategy_mode || 'long_only') as typeof strategyMode
      // 如果后端没有返回 strategy_mode，尝试从交易数据推断
      if (!detail.strategy_mode) {
        try {
          const trades = parseJsonArray<any>(detail.trades)
          if (trades.length > 0) {
            const hasShort = trades.some((t: any) => t.side === 'SHORT')
            const hasLong = trades.some((t: any) => t.side === 'LONG')
            if (hasShort && !hasLong) {
              mode = 'short_only'
              console.log('[applyToStrategy] inferred mode from trades: short_only')
            } else if (hasLong && !hasShort) {
              mode = 'long_only'
              console.log('[applyToStrategy] inferred mode from trades: long_only')
            } else if (hasShort && hasLong) {
              mode = 'bidirectional'
              console.log('[applyToStrategy] inferred mode from trades: bidirectional')
            }
          }
        } catch (e) {
          console.error('Failed to parse trades for mode inference:', e)
        }
      }
      console.log('[applyToStrategy] mode from record:', detail.strategy_mode, '→ setting state to:', mode)
      setStrategyMode(mode)
      const entryGroups = parseJsonArray<StoredCondition[]>(detail.entry_conditions)
      const exitGroups = parseJsonArray<StoredCondition[]>(detail.exit_conditions)
      const entryConds = entryGroups.flat()
      const exitConds = exitGroups.flat()
      if (mode === 'bidirectional') {
        if (entryGroups.length >= 2) {
          setLongEntryConditions(entryGroups[0].map(storedCondToCondition))
          setShortEntryConditions(entryGroups[1].map(storedCondToCondition))
        } else if (entryConds.length > 0) {
          setLongEntryConditions(entryConds.map(storedCondToCondition))
        }
      } else {
        if (entryConds.length > 0) setEntryConditions(entryConds.map(storedCondToCondition))
        setExitConditions(exitConds.map(storedCondToCondition))
      }
      setDetailResult(null)
      setDetailRecord(null)
      setActiveTab('result')
    } catch (error) {
      console.error('Failed to apply to strategy:', error)
    }
  }

  const handleExportMarkdown = async (recordId: string) => {
    try {
      const detail = detailRecord?.id === recordId ? detailRecord : await getRecord(recordId)
      downloadMarkdown(detail)
    } catch (error) {
      console.error('Failed to export markdown:', error)
    }
  }

  const displayResult = detailResult || result

  // 实时推导每笔交易的实际影响，直接基于用户填的仓位占比
  const slNum = parseFloat(sl) || 0
  const tpNum = parseFloat(tp) || 0
  const positionPctNum = parseFloat(positionPct) || 0
  // 仓位上限是 100%（不能投入超过账户的钱），杠杆只放大收益/亏损倍率
  const effectivePositionPct = Math.min(positionPctNum, 100)
  const isCapped = positionPctNum > 100
  // 触发止损/止盈时账户实际变化 = 仓位% × 价格波动% × 杠杆
  const actualLossPct = effectivePositionPct * slNum * leverage / 100
  const actualGainPct = effectivePositionPct * tpNum * leverage / 100
  const initialBalance = 4000
  const lossAmount = initialBalance * actualLossPct / 100
  const gainAmount = initialBalance * actualGainPct / 100
  const positionAmount = initialBalance * effectivePositionPct / 100
  const riskInfoBlock = (
    <div className="mt-3 space-y-1.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-[var(--color-text-disabled)]">投入仓位</span>
        <span className="font-black font-[var(--font-mono)]">
          {effectivePositionPct.toFixed(0)}% · {positionAmount.toFixed(0)} U{isCapped && <span className="ml-1 text-[var(--color-short)] text-[9px]">(上限100%)</span>}
        </span>
      </div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-[var(--color-text-disabled)]">触发止损亏</span>
        <span className="font-black font-[var(--font-mono)] text-[var(--color-short)]">-{actualLossPct.toFixed(1)}% · -{lossAmount.toFixed(0)} U</span>
      </div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-[var(--color-text-disabled)]">触发止盈赚</span>
        <span className="font-black font-[var(--font-mono)] text-[var(--color-long)]">+{actualGainPct.toFixed(1)}% · +{gainAmount.toFixed(0)} U</span>
      </div>
    </div>
  )
  const selectedDataCoverage = availableData.find((item) => item.symbol === symbol && item.interval === interval)
  // 收藏过滤 + 标签过滤（多选 OR），最后按指标排序（收藏置顶）
  const filteredRecords = records.filter((r) => {
    if (showFavoritesOnly && !r.is_favorite) return false
    if (tagFilters.length > 0 && !tagFilters.some((t) => r.tags.includes(t))) return false
    return true
  })
  const sortedRecords = [...filteredRecords].sort((a, b) => {
    // 收藏优先
    if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1
    const aValue = getRecordSortValue(a, historySortField)
    const bValue = getRecordSortValue(b, historySortField)
    if (aValue === bValue) return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0)
    return historySortDirection === 'desc' ? bValue - aValue : aValue - bValue
  })
  const hasActiveFilter = showFavoritesOnly || tagFilters.length > 0

  return (
    <MainLayout>
      <div className="flex h-full bg-[var(--color-bg-primary)]">
        <div className="w-[380px] bg-[var(--color-bg-card)] border-r border-[var(--color-border)] overflow-y-auto flex flex-col custom-scrollbar">
          <div className="p-4 border-b border-[var(--color-border)]">
            <div className="text-sm font-bold mb-4 flex items-center gap-2">
              <span className="w-1.5 h-4 bg-[var(--color-accent)] rounded-full"></span>基础策略配置
            </div>
            <div className="space-y-4">
              <div><label className="block text-[10px] font-bold text-[var(--color-text-disabled)] uppercase mb-1.5">策略名称</label>
                <input type="text" value={strategyName} onChange={(e) => setStrategyName(e.target.value)} placeholder="留空自动生成" className="w-full text-sm font-medium" /></div>
              <div><label className="block text-[10px] font-bold text-[var(--color-text-disabled)] uppercase mb-1.5">交易模式</label>
                <select value={strategyMode} onChange={(e) => setStrategyMode(e.target.value as any)} className="w-full font-bold">
                  <option value="long_only">仅做多 (Long Only)</option><option value="short_only">仅做空 (Short Only)</option><option value="bidirectional">双向自动 (Bi-directional)</option><option value="dca">定投 (DCA)</option><option value="martingale">马丁格尔 (Martingale)</option>
                </select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-[10px] font-bold text-[var(--color-text-disabled)] uppercase mb-1.5">交易对</label>
                  <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="w-full font-bold"><option>BTCUSDT</option><option>ETHUSDT</option><option>SOLUSDT</option><option>BNBUSDT</option><option>XRPUSDT</option><option>DOGEUSDT</option></select></div>
                <div><label className="block text-[10px] font-bold text-[var(--color-text-disabled)] uppercase mb-1.5">K线周期</label>
                  <select value={interval} onChange={(e) => setInterval(e.target.value)} className="w-full font-bold"><option value="1m">1m</option><option value="5m">5m</option><option value="15m">15m</option><option value="1h">1h</option><option value="4h">4h</option><option value="1d">1d</option></select></div>
              </div>
              <div><label className="block text-[10px] font-bold text-[var(--color-text-disabled)] uppercase mb-1.5">时间范围</label>
                <div className="flex gap-2 items-center"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="flex-1 font-[var(--font-mono)] text-xs font-bold" /><span className="text-[var(--color-text-disabled)]">-</span><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="flex-1 font-[var(--font-mono)] text-xs font-bold" /></div></div>
              <div className={`rounded-lg border px-3 py-2 text-xs ${selectedDataCoverage ? 'border-[var(--color-accent)]/20 bg-[var(--color-accent)]/5' : 'border-[var(--color-short)]/20 bg-[var(--color-short)]/5'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-[var(--color-text-disabled)]">数据库历史数据</div>
                    {selectedDataCoverage ? (
                      <div className="mt-1 leading-relaxed">
                        已缓存 {selectedDataCoverage.start_date} 到 {selectedDataCoverage.end_date}
                        <span className="ml-2 font-[var(--font-mono)] text-[var(--color-text-secondary)]">{selectedDataCoverage.count} 条</span>
                      </div>
                    ) : (
                      <div className="mt-1 text-[var(--color-short)]">当前 {symbol} / {interval} 还没有缓存数据</div>
                    )}
                  </div>
                  {selectedDataCoverage && (
                    <button
                      type="button"
                      onClick={() => {
                        setStartDate(selectedDataCoverage.start_date)
                        setEndDate(selectedDataCoverage.end_date)
                      }}
                      className="shrink-0 rounded-md border border-[var(--color-accent)]/30 bg-[var(--color-bg-card)] px-2.5 py-1 text-[10px] font-black uppercase text-[var(--color-accent)] transition-all hover:bg-[var(--color-accent)] hover:text-white"
                    >
                      套用范围
                    </button>
                  )}
                </div>
              </div>
              <div><label className="block text-[10px] font-bold text-[var(--color-text-disabled)] uppercase mb-1.5">杠杆倍数</label>
                <div className="flex items-center gap-3"><input type="range" min={1} max={125} value={leverage} onChange={(e) => setLeverage(+e.target.value)} className="flex-1 h-1 accent-[var(--color-accent)]" /><span className="text-sm font-black font-[var(--font-mono)] text-[var(--color-accent)] min-w-[32px]">{leverage}x</span></div>
                <div className="flex gap-1 mt-2 flex-wrap">{LEVERAGE_PRESETS.map((v) => <button key={v} onClick={() => setLeverage(v)} className={`text-[10px] px-1.5 py-0.5 rounded border transition-all font-bold ${leverage === v ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]' : 'bg-transparent text-[var(--color-text-disabled)] border-[var(--color-border)] hover:text-[var(--color-text-primary)]'}`}>{v}x</button>)}</div></div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {strategyMode === 'dca' ? (
              <div className="p-4 border-b border-[var(--color-border)]">
                <div className="text-[10px] font-bold text-[var(--color-accent)] uppercase tracking-widest mb-4 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse"></span>定投参数 (DCA)</div>
                <div className="text-[10px] text-[var(--color-text-disabled)] mb-4 leading-relaxed">定期等额买入，不依赖技术指标信号。适合长期看好的标的，通过时间分散降低择时风险。</div>
                <div className="bg-[var(--color-bg-input)]/50 border border-[var(--color-border)] rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between"><label className="text-[10px] font-bold text-[var(--color-text-disabled)] uppercase">买入间隔</label><div className="flex items-center gap-1.5"><input type="text" inputMode="numeric" value={dcaIntervalBars} onChange={handleNumberInputChange(setDcaIntervalBars)} className="!w-14 !px-1.5 !py-0.5 text-xs text-center font-bold font-[var(--font-mono)] bg-transparent border-b border-[var(--color-border)] rounded-none" /><span className="text-[10px] font-bold text-[var(--color-text-disabled)]">根K线</span></div></div>
                  <div className="flex items-center justify-between"><label className="text-[10px] font-bold text-[var(--color-text-disabled)] uppercase">每次金额</label><div className="flex items-center gap-1.5"><input type="text" inputMode="decimal" value={dcaAmount} onChange={handleNumberInputChange(setDcaAmount)} className="!w-14 !px-1.5 !py-0.5 text-xs text-center font-bold font-[var(--font-mono)] bg-transparent border-b border-[var(--color-border)] rounded-none" /><span className="text-[10px] font-bold text-[var(--color-text-disabled)]">USDT</span></div></div>
                  <div className="flex items-center justify-between"><label className="text-[10px] font-bold text-[var(--color-text-disabled)] uppercase">止盈卖出</label><div className="flex items-center gap-1.5"><input type="text" inputMode="decimal" value={dcaTakeProfitPct} onChange={handleNumberInputChange(setDcaTakeProfitPct)} placeholder="不设" className="!w-14 !px-1.5 !py-0.5 text-xs text-center font-bold font-[var(--font-mono)] bg-transparent border-b border-[var(--color-border)] rounded-none" /><span className="text-[10px] font-bold text-[var(--color-text-disabled)]">%</span></div></div>
                </div>
                <div className="mt-3 text-[10px] text-[var(--color-text-disabled)] leading-relaxed">
                  {interval && dcaIntervalBars && <>每 {parseInt(dcaIntervalBars) || 24} 根 {interval} K线买入 {dcaAmount || '100'} USDT</>}
                </div>
              </div>
            ) : strategyMode === 'martingale' ? (
              <><div className="p-4 border-b border-[var(--color-border)]">
                  <div className="text-[10px] font-bold text-[var(--color-accent)] uppercase tracking-widest mb-4 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[var(--color-short)] animate-pulse"></span>马丁格尔参数</div>
                  <div className="text-[10px] text-[var(--color-text-disabled)] mb-4 leading-relaxed">亏损后按倍数加大仓位，盈利后重置。需要配合入场/出场信号使用。高风险策略，请谨慎设置最大轮次。</div>
                  <div className="bg-[var(--color-bg-input)]/50 border border-[var(--color-border)] rounded-lg p-3 space-y-3">
                    <div className="flex items-center justify-between"><label className="text-[10px] font-bold text-[var(--color-text-disabled)] uppercase">加倍倍数</label><div className="flex items-center gap-1.5"><input type="text" inputMode="decimal" value={martingaleMultiplier} onChange={handleNumberInputChange(setMartingaleMultiplier)} className="!w-12 !px-1.5 !py-0.5 text-xs text-center font-bold font-[var(--font-mono)] bg-transparent border-b border-[var(--color-border)] rounded-none" /><span className="text-[10px] font-bold text-[var(--color-text-disabled)]">x</span></div></div>
                    <div className="flex items-center justify-between"><label className="text-[10px] font-bold text-[var(--color-text-disabled)] uppercase">最大轮次</label><div className="flex items-center gap-1.5"><input type="text" inputMode="numeric" value={martingaleMaxRounds} onChange={handleNumberInputChange(setMartingaleMaxRounds)} className="!w-12 !px-1.5 !py-0.5 text-xs text-center font-bold font-[var(--font-mono)] bg-transparent border-b border-[var(--color-border)] rounded-none" /><span className="text-[10px] font-bold text-[var(--color-text-disabled)]">次</span></div></div>
                    <div className="flex items-center justify-between"><label className="text-[10px] font-bold text-[var(--color-text-disabled)] uppercase">盈利后重置</label><button onClick={() => setMartingaleResetOnWin(!martingaleResetOnWin)} className={`text-[10px] px-2 py-0.5 rounded border font-bold transition-all ${martingaleResetOnWin ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]' : 'bg-transparent text-[var(--color-text-disabled)] border-[var(--color-border)]'}`}>{martingaleResetOnWin ? '是' : '否'}</button></div>
                  </div>
                  <div className="mt-3 text-[10px] text-[var(--color-short)] leading-relaxed font-bold">
                    最大仓位：{positionPct}% x {martingaleMultiplier}^{martingaleMaxRounds} = {Math.min(parseFloat(positionPct) * Math.pow(parseFloat(martingaleMultiplier) || 2, parseInt(martingaleMaxRounds) || 4), leverage * 100).toFixed(0)}% 余额
                  </div>
                </div>
                <div className="p-4 border-b border-[var(--color-border)]">
                  <div className="flex items-center justify-between mb-4"><span className="text-[10px] font-bold text-[var(--color-long)] uppercase tracking-widest">入场条件 (Entry)</span><button onClick={() => setEntryConditions((prev) => [...prev, newCondition()])} className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-long)] text-[var(--color-long)] hover:bg-[var(--color-long)] hover:text-white transition-all font-bold">+ 添加</button></div>
                  <div className="space-y-2">{entryConditions.map((cond, i) => <ConditionEditor key={cond.id} cond={cond} onChange={(c) => updateEntry(i, c)} onRemove={() => setEntryConditions((prev) => prev.filter((_, idx) => idx !== i))} />)}</div>
                </div>
                <div className="p-4 border-b border-[var(--color-border)]">
                  <div className="flex items-center justify-between mb-4"><span className="text-[10px] font-bold text-[var(--color-short)] uppercase tracking-widest">出场条件 (Exit)</span><button onClick={() => setExitConditions((prev) => [...prev, newCondition('RSI')])} className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-short)] text-[var(--color-short)] hover:bg-[var(--color-short)] hover:text-white transition-all font-bold">+ 添加</button></div>
                  {exitConditions.length === 0 && <div className="text-[10px] text-[var(--color-text-disabled)] py-1">留空则仅靠止损/止盈出场</div>}
                  <div className="space-y-2">{exitConditions.map((cond, i) => <ConditionEditor key={cond.id} cond={cond} onChange={(c) => updateExit(i, c)} onRemove={() => setExitConditions((prev) => prev.filter((_, idx) => idx !== i))} />)}</div>
                </div>
                <div className="p-4 border-b border-[var(--color-border)] bg-[var(--color-bg-hover)]/20">
                  <div className="text-[10px] font-bold text-[var(--color-text-disabled)] uppercase tracking-widest mb-4">风险与止盈止损</div>
                  <div className="bg-[var(--color-bg-input)]/50 border border-[var(--color-border)] rounded-lg p-3 space-y-3">
                    <div className="flex items-center justify-between"><label className="text-[10px] font-bold text-[var(--color-text-disabled)] uppercase">止损百分比</label><div className="flex items-center gap-1.5"><input type="text" inputMode="decimal" value={sl} onChange={handleNumberInputChange(setSl)} className="!w-12 !px-1.5 !py-0.5 text-xs text-center font-bold font-[var(--font-mono)] bg-transparent border-b border-[var(--color-border)] rounded-none" /><span className="text-[10px] font-bold text-[var(--color-text-disabled)]">%</span></div></div>
                    <div className="flex items-center justify-between"><label className="text-[10px] font-bold text-[var(--color-text-disabled)] uppercase">止盈百分比</label><div className="flex items-center gap-1.5"><input type="text" inputMode="decimal" value={tp} onChange={handleNumberInputChange(setTp)} className="!w-12 !px-1.5 !py-0.5 text-xs text-center font-bold font-[var(--font-mono)] bg-transparent border-b border-[var(--color-border)] rounded-none" /><span className="text-[10px] font-bold text-[var(--color-text-disabled)]">%</span></div></div>
                    <div className="flex items-center justify-between"><label className="text-[10px] font-bold text-[var(--color-text-disabled)] uppercase">基础仓位</label><div className="flex items-center gap-1.5"><input type="text" inputMode="decimal" value={positionPct} onChange={(e) => { const v = e.target.value; if (v === '' || /^\d*\.?\d*$/.test(v)) { const num = parseFloat(v); if (v === '' || num <= 100) setPositionPct(v) } }} className="!w-12 !px-1.5 !py-0.5 text-xs text-center font-bold font-[var(--font-mono)] bg-transparent border-b border-[var(--color-border)] rounded-none" /><span className="text-[10px] font-bold text-[var(--color-text-disabled)]">%</span></div></div>
                    {riskInfoBlock}
                  </div>
                </div></>
            ) : strategyMode !== 'bidirectional' ? (
              <><div className="p-4 border-b border-[var(--color-border)]">
                  <div className="flex items-center justify-between mb-4"><span className="text-[10px] font-bold text-[var(--color-long)] uppercase tracking-widest">入场条件 (Entry)</span><button onClick={() => setEntryConditions((prev) => [...prev, newCondition()])} className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-long)] text-[var(--color-long)] hover:bg-[var(--color-long)] hover:text-white transition-all font-bold">+ 添加</button></div>
                  <div className="space-y-2">{entryConditions.map((cond, i) => <ConditionEditor key={cond.id} cond={cond} onChange={(c) => updateEntry(i, c)} onRemove={() => setEntryConditions((prev) => prev.filter((_, idx) => idx !== i))} />)}</div>
                </div>
                <div className="p-4 border-b border-[var(--color-border)]">
                  <div className="flex items-center justify-between mb-4"><span className="text-[10px] font-bold text-[var(--color-short)] uppercase tracking-widest">出场条件 (Exit)</span><button onClick={() => setExitConditions((prev) => [...prev, newCondition('RSI')])} className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-short)] text-[var(--color-short)] hover:bg-[var(--color-short)] hover:text-white transition-all font-bold">+ 添加</button></div>
                  {exitConditions.length === 0 && <div className="text-[10px] text-[var(--color-text-disabled)] py-1">留空则仅靠止损/止盈出场</div>}
                  <div className="space-y-2">{exitConditions.map((cond, i) => <ConditionEditor key={cond.id} cond={cond} onChange={(c) => updateExit(i, c)} onRemove={() => setExitConditions((prev) => prev.filter((_, idx) => idx !== i))} />)}</div>
                </div>
                <div className="p-4 border-b border-[var(--color-border)] bg-[var(--color-bg-hover)]/20">
                  <div className="text-[10px] font-bold text-[var(--color-text-disabled)] uppercase tracking-widest mb-4">风险与止盈止损</div>
                  <div className="bg-[var(--color-bg-input)]/50 border border-[var(--color-border)] rounded-lg p-3 space-y-3">
                    <div className="flex items-center justify-between"><label className="text-[10px] font-bold text-[var(--color-text-disabled)] uppercase">止损百分比</label><div className="flex items-center gap-1.5"><input type="text" inputMode="decimal" value={sl} onChange={handleNumberInputChange(setSl)} className="!w-12 !px-1.5 !py-0.5 text-xs text-center font-bold font-[var(--font-mono)] bg-transparent border-b border-[var(--color-border)] rounded-none" /><span className="text-[10px] font-bold text-[var(--color-text-disabled)]">%</span></div></div>
                    <div className="flex items-center justify-between"><label className="text-[10px] font-bold text-[var(--color-text-disabled)] uppercase">止盈百分比</label><div className="flex items-center gap-1.5"><input type="text" inputMode="decimal" value={tp} onChange={handleNumberInputChange(setTp)} className="!w-12 !px-1.5 !py-0.5 text-xs text-center font-bold font-[var(--font-mono)] bg-transparent border-b border-[var(--color-border)] rounded-none" /><span className="text-[10px] font-bold text-[var(--color-text-disabled)]">%</span></div></div>
                    <div className="flex items-center justify-between"><label className="text-[10px] font-bold text-[var(--color-text-disabled)] uppercase">每笔仓位</label><div className="flex items-center gap-1.5"><input type="text" inputMode="decimal" value={positionPct} onChange={(e) => { const v = e.target.value; if (v === '' || /^\d*\.?\d*$/.test(v)) { const num = parseFloat(v); if (v === '' || num <= 100) setPositionPct(v) } }} className="!w-12 !px-1.5 !py-0.5 text-xs text-center font-bold font-[var(--font-mono)] bg-transparent border-b border-[var(--color-border)] rounded-none" /><span className="text-[10px] font-bold text-[var(--color-text-disabled)]">%</span></div></div>
                    {riskInfoBlock}
                  </div>
                </div></>
            ) : (
              <><div className="p-4 border-b border-[var(--color-border)]">
                  <div className="flex items-center justify-between mb-4 text-[var(--color-long)]"><span className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[var(--color-long)] animate-pulse"></span>做多条件</span><button onClick={() => setLongEntryConditions((prev) => [...prev, newCondition('BOLL')])} className="text-[10px] px-2 py-0.5 rounded-full border border-current hover:bg-[var(--color-long)] hover:text-white transition-all font-bold">+ 添加</button></div>
                  <div className="space-y-2">{longEntryConditions.map((cond, i) => <ConditionEditor key={cond.id} cond={cond} onChange={(c) => updateLongEntry(i, c)} onRemove={() => setLongEntryConditions((prev) => prev.filter((_, idx) => idx !== i))} />)}</div>
                </div>
                <div className="p-4 border-b border-[var(--color-border)]">
                  <div className="flex items-center justify-between mb-4 text-[var(--color-short)]"><span className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[var(--color-short)] animate-pulse"></span>做空条件</span><button onClick={() => setShortEntryConditions((prev) => [...prev, { ...newCondition('BOLL'), op: 'touch_upper' }])} className="text-[10px] px-2 py-0.5 rounded-full border border-current hover:bg-[var(--color-short)] hover:text-white transition-all font-bold">+ 添加</button></div>
                  <div className="space-y-2">{shortEntryConditions.map((cond, i) => <ConditionEditor key={cond.id} cond={cond} onChange={(c) => updateShortEntry(i, c)} onRemove={() => setShortEntryConditions((prev) => prev.filter((_, idx) => idx !== i))} />)}</div>
                </div>
                <div className="p-4 border-b border-[var(--color-border)] bg-[var(--color-bg-hover)]/20">
                  <div className="text-[10px] font-bold text-[var(--color-text-disabled)] uppercase tracking-widest mb-4">通用风控配置</div>
                  <div className="bg-[var(--color-bg-input)]/50 border border-[var(--color-border)] rounded-lg p-3 space-y-3">
                    <div className="flex items-center justify-between"><label className="text-[10px] font-bold text-[var(--color-text-disabled)] uppercase">止损百分比</label><div className="flex items-center gap-1.5"><input type="text" inputMode="decimal" value={sl} onChange={handleNumberInputChange(setSl)} className="!w-12 !px-1.5 !py-0.5 text-xs text-center font-bold font-[var(--font-mono)] bg-transparent border-b border-[var(--color-border)] rounded-none" /><span className="text-[10px] font-bold text-[var(--color-text-disabled)]">%</span></div></div>
                    <div className="flex items-center justify-between"><label className="text-[10px] font-bold text-[var(--color-text-disabled)] uppercase">止盈百分比</label><div className="flex items-center gap-1.5"><input type="text" inputMode="decimal" value={tp} onChange={handleNumberInputChange(setTp)} className="!w-12 !px-1.5 !py-0.5 text-xs text-center font-bold font-[var(--font-mono)] bg-transparent border-b border-[var(--color-border)] rounded-none" /><span className="text-[10px] font-bold text-[var(--color-text-disabled)]">%</span></div></div>
                    <div className="flex items-center justify-between"><label className="text-[10px] font-bold text-[var(--color-text-disabled)] uppercase">每笔仓位</label><div className="flex items-center gap-1.5"><input type="text" inputMode="decimal" value={positionPct} onChange={(e) => { const v = e.target.value; if (v === '' || /^\d*\.?\d*$/.test(v)) { const num = parseFloat(v); if (v === '' || num <= 100) setPositionPct(v) } }} className="!w-12 !px-1.5 !py-0.5 text-xs text-center font-bold font-[var(--font-mono)] bg-transparent border-b border-[var(--color-border)] rounded-none" /><span className="text-[10px] font-bold text-[var(--color-text-disabled)]">%</span></div></div>
                    {riskInfoBlock}
                  </div>
                </div></>
            )}
          </div>
          <div className="p-5 mt-auto"><button onClick={runBacktest} disabled={loading || (strategyMode === 'dca' ? false : strategyMode === 'bidirectional' ? longEntryConditions.length === 0 || shortEntryConditions.length === 0 : entryConditions.length === 0)} className="w-full py-3.5 bg-[var(--color-accent)] text-white rounded-lg font-black text-sm tracking-widest cursor-pointer hover:shadow-lg hover:shadow-[var(--color-accent)]/20 active:translate-y-[1px] transition-all disabled:opacity-30 disabled:translate-y-0 border-none">{loading ? '正在回测...' : '开始回测'}</button></div>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col bg-[var(--color-bg-primary)]">
          <div className="flex border-b border-[var(--color-border)] bg-[var(--color-bg-card)] shrink-0 px-2">
            <button onClick={() => { setActiveTab('result'); setDetailResult(null); setDetailRecord(null) }} className={`px-5 py-3 text-[10px] font-black tracking-widest uppercase border-none cursor-pointer transition-all ${activeTab === 'result' ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)] bg-transparent' : 'text-[var(--color-text-disabled)] bg-transparent hover:text-[var(--color-text-secondary)]'}`}>本次回测结果</button>
            <button onClick={() => setActiveTab('history')} className={`px-5 py-3 text-[10px] font-black tracking-widest uppercase border-none cursor-pointer transition-all ${activeTab === 'history' ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)] bg-transparent' : 'text-[var(--color-text-disabled)] bg-transparent hover:text-[var(--color-text-secondary)]'}`}>历史回测记录{records.length > 0 && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-bg-input)]">{records.length}</span>}</button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
            {activeTab === 'result' ? (!displayResult ? (
                <div className="h-full flex flex-col items-center justify-center text-[var(--color-text-disabled)] opacity-30"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-4"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21v-5h5"/></svg><div className="text-sm font-bold uppercase tracking-widest">配置策略并运行以查看表现</div></div>
              ) : (
                <div className="flex flex-col gap-8 max-w-[1200px] mx-auto w-full">
                  {detailRecord && (
                    <div className="flex items-center justify-between p-4 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-sm">
                      <div className="flex items-center gap-3">
                        <button onClick={() => { setDetailResult(null); setDetailRecord(null); setActiveTab('history') }} className="p-1.5 rounded-full hover:bg-[var(--color-bg-input)] transition-all"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg></button>
                        <div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => { void toggleFavorite(detailRecord.id); setDetailRecord((prev) => prev ? { ...prev, is_favorite: !prev.is_favorite } : prev) }} className={`text-[16px] leading-none ${detailRecord.is_favorite ? 'text-yellow-400' : 'text-[var(--color-border)]'}`}>{detailRecord.is_favorite ? '★' : '☆'}</button>
                            <div className="text-sm font-black">{detailRecord.name}</div>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="text-[10px] text-[var(--color-text-disabled)] font-bold uppercase">{detailRecord.symbol} · {detailRecord.interval} · {detailRecord.leverage}x · <span className={detailRecord.strategy_mode === 'short_only' ? 'text-red-400' : detailRecord.strategy_mode === 'bidirectional' ? 'text-green-400' : 'text-[var(--color-text-disabled)]'}>{detailRecord.strategy_mode === 'short_only' ? '仅做空' : detailRecord.strategy_mode === 'bidirectional' ? '双向' : detailRecord.strategy_mode === 'dca' ? 'DCA' : detailRecord.strategy_mode === 'martingale' ? '马丁' : '仅做多'}</span></div>
                            {detailRecord.tags.map((tag) => (
                              <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--color-bg-input)] border border-[var(--color-border)] text-[var(--color-text-secondary)] font-bold">{tag}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => { void handleExportMarkdown(detailRecord.id) }} className="px-4 py-2 rounded-lg bg-[var(--color-bg-input)] text-[var(--color-text-primary)] border border-[var(--color-border)] text-[10px] font-black uppercase hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-all">导出 MD</button>
                        <button onClick={(e) => { e.stopPropagation(); void handleApplyToStrategy(detailRecord) }} className="px-4 py-2 rounded-lg bg-[var(--color-bg-input)] text-[var(--color-text-primary)] border border-[var(--color-border)] text-[10px] font-black uppercase hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-all">应用回基础策略</button>
                        <button onClick={() => handleApplyToDashboard({ id: detailRecord.id, name: detailRecord.name, symbol: detailRecord.symbol, interval: detailRecord.interval })} className="px-4 py-2 rounded-lg bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/30 text-[10px] font-black uppercase hover:bg-[var(--color-accent)] hover:text-white transition-all">应用到行情看板</button>
                      </div>
                    </div>
                  )}
                  {!detailRecord && displayResult.record_id && (
                    <div className="flex justify-end">
                      <button onClick={() => { void handleExportMarkdown(displayResult.record_id as string) }} className="px-4 py-2 rounded-lg bg-[var(--color-bg-card)] text-[var(--color-text-primary)] border border-[var(--color-border)] text-[10px] font-black uppercase hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-all">导出当前结果 MD</button>
                    </div>
                  )}
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-5">
                    {[
                      { label: '总收益率', value: `${displayResult.total_return_pct > 0 ? '+' : ''}${displayResult.total_return_pct}%`, color: displayResult.total_return_pct >= 0 ? 'var(--color-long)' : 'var(--color-short)' },
                      { label: '胜率', value: `${displayResult.win_rate}%`, color: 'var(--color-text-primary)' },
                      { label: '盈亏比', value: `${displayResult.profit_factor}x`, color: 'var(--color-accent)' },
                      { label: '最大回撤', value: `-${displayResult.max_drawdown}%`, color: 'var(--color-short)' },
                      { label: '夏普比率', value: `${displayResult.sharpe_ratio}`, color: 'var(--color-text-primary)' },
                      { label: 'Sortino', value: `${displayResult.sortino_ratio}`, color: 'var(--color-text-primary)' },
                      { label: '最大连亏', value: `${displayResult.max_consecutive_losses}次`, color: displayResult.max_consecutive_losses >= 5 ? 'var(--color-short)' : 'var(--color-text-primary)' },
                      { label: '回撤恢复', value: displayResult.max_dd_duration_hours >= 24 ? `${(displayResult.max_dd_duration_hours / 24).toFixed(1)}天` : `${displayResult.max_dd_duration_hours}h`, color: 'var(--color-text-primary)' },
                      { label: '尾部比率', value: `${displayResult.tail_ratio}`, color: displayResult.tail_ratio >= 1 ? 'var(--color-long)' : displayResult.tail_ratio > 0 ? 'var(--color-short)' : 'var(--color-text-primary)' },
                      { label: '总成交笔数', value: `${displayResult.total_trades}`, color: 'var(--color-text-primary)' },
                    ].map((s) => (
                      <div key={s.label} className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl p-5 shadow-sm hover:translate-y-[-2px] transition-all"><div className="text-[10px] text-[var(--color-text-disabled)] uppercase tracking-widest font-bold mb-2">{s.label}</div><div className="text-3xl font-black font-[var(--font-mono)] tracking-tighter" style={{ color: s.color }}>{s.value}</div></div>
                    ))}
                  </div>
                  <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl overflow-hidden shadow-sm">
                    <div className="px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-bg-hover)]/30 flex items-center justify-between"><span className="text-[10px] font-black uppercase tracking-widest">历史交易执行明细</span><span className="text-[10px] font-bold text-[var(--color-text-disabled)]">{displayResult.trades.length} 个仓位</span></div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead><tr className="text-[10px] text-[var(--color-text-disabled)] uppercase font-bold tracking-wider"><th className="px-5 py-3 border-b border-[var(--color-border)]">#</th><th className="px-4 py-3 border-b border-[var(--color-border)]">入场时间</th><th className="px-4 py-3 border-b border-[var(--color-border)] text-center">方向</th><th className="px-4 py-3 border-b border-[var(--color-border)] text-right">入场价</th><th className="px-4 py-3 border-b border-[var(--color-border)] text-right">出场价</th><th className="px-4 py-3 border-b border-[var(--color-border)] text-right">收益%</th><th className="px-5 py-3 border-b border-[var(--color-border)] text-right">持仓时长</th></tr></thead>
                        <tbody className="divide-y divide-[var(--color-border)]/50">
                          {displayResult.trades.map((t, i) => (
                            <tr key={i} className="hover:bg-[var(--color-bg-hover)] transition-colors"><td className="px-5 py-3 text-[10px] font-bold text-[var(--color-text-disabled)]">{i + 1}</td><td className="px-4 py-3 text-[11px] font-bold font-[var(--font-mono)]">{t.entry_time}</td><td className="px-4 py-3 text-center"><span className={`text-[9px] px-1.5 py-0.5 rounded font-black uppercase ${t.side === 'LONG' ? 'bg-[var(--color-long)]/10 text-[var(--color-long)]' : 'bg-[var(--color-short)]/10 text-[var(--color-short)]'}`}>{t.side === 'LONG' ? '做多' : '做空'}</span></td><td className="px-4 py-3 text-[11px] font-bold font-[var(--font-mono)] text-right">{t.entry_price.toLocaleString()}</td><td className="px-4 py-3 text-[11px] font-bold font-[var(--font-mono)] text-right">{t.exit_price.toLocaleString()}</td><td className={`px-4 py-3 text-[11px] font-black font-[var(--font-mono)] text-right ${t.pnl_pct >= 0 ? 'text-[var(--color-long)]' : 'text-[var(--color-short)]'}`}>{t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct.toFixed(2)}%</td><td className="px-5 py-3 text-[10px] font-bold text-[var(--color-text-secondary)] text-right">{t.duration}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )
            ) : (
              records.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-[var(--color-text-disabled)] opacity-30"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-3"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="11" y2="17"/></svg><div className="text-sm font-bold uppercase tracking-widest">暂无回测记录</div></div>
              ) : sortedRecords.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-[var(--color-text-disabled)] opacity-30"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-3"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg><div className="text-sm font-bold uppercase tracking-widest">{showFavoritesOnly && tagFilters.length > 0 ? '没有同时满足收藏和所选标签的记录' : showFavoritesOnly ? '暂无收藏记录' : `没有标签为「${tagFilters.join('、')}」的记录`}</div><button onClick={() => { setTagFilters([]); setShowFavoritesOnly(false) }} className="mt-3 text-xs px-4 py-2 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] font-bold hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]">清除过滤</button></div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] font-black uppercase tracking-widest text-[var(--color-text-disabled)]">筛选</div>
                      {hasActiveFilter && (
                        <button onClick={() => { setTagFilters([]); setShowFavoritesOnly(false) }} className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-disabled)] font-bold hover:border-[var(--color-short)] hover:text-[var(--color-short)] transition-all">清除筛选</button>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button onClick={() => setShowFavoritesOnly(!showFavoritesOnly)} className={`text-[10px] px-2 py-0.5 rounded-full border font-bold transition-all ${showFavoritesOnly ? 'bg-yellow-400/15 text-yellow-400 border-yellow-400/50' : 'bg-transparent text-[var(--color-text-disabled)] border-[var(--color-border)] hover:border-yellow-400/50 hover:text-yellow-400'}`}>★ 收藏</button>
                      <span className="w-px h-3.5 bg-[var(--color-border)]"></span>
                      <button onClick={() => setTagFilters([])} className={`text-[10px] px-2 py-0.5 rounded-full border font-bold transition-all ${tagFilters.length === 0 ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]' : 'bg-transparent text-[var(--color-text-disabled)] border-[var(--color-border)] hover:border-[var(--color-accent)]'}`}>全部标签</button>
                      {allTags.map((tag) => (
                        <button key={tag} onClick={() => setTagFilters((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])} className={`text-[10px] px-2 py-0.5 rounded-full border font-bold transition-all ${tagFilters.includes(tag) ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]' : 'bg-transparent text-[var(--color-text-disabled)] border-[var(--color-border)] hover:border-[var(--color-accent)]'}`}>{tag}</button>
                      ))}
                    </div>
                    {hasActiveFilter && (
                      <div className="text-[10px] text-[var(--color-text-disabled)] font-bold">
                        {filteredRecords.length} / {records.length} 条记录
                      </div>
                    )}
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-input)]">
                          <th className="px-3 py-2.5 text-left font-black uppercase text-[var(--color-text-disabled)] w-7">★</th>
                          <th className="px-3 py-2.5 text-left font-black uppercase text-[var(--color-text-disabled)]">策略名称</th>
                          {HISTORY_SORT_OPTIONS.map((opt) => (
                            <th
                              key={opt.value}
                              onClick={() => {
                                if (historySortField === opt.value) setHistorySortDirection((p) => p === 'desc' ? 'asc' : 'desc')
                                else { setHistorySortField(opt.value as HistorySortField); setHistorySortDirection('desc') }
                              }}
                              className={`px-3 py-2.5 text-right font-black uppercase cursor-pointer select-none transition-all hover:text-[var(--color-accent)] whitespace-nowrap ${historySortField === opt.value ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-disabled)]'}`}
                            >
                              {opt.label}{historySortField === opt.value ? (historySortDirection === 'desc' ? ' ↓' : ' ↑') : ''}
                            </th>
                          ))}
                          <th className="px-3 py-2.5 text-right font-black uppercase text-[var(--color-text-disabled)] w-16">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedRecords.map((r) => (
                          <tr key={r.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-input)] transition-colors group">
                            <td className="px-3 py-2">
                              <button onClick={() => void toggleFavorite(r.id)} className={`text-sm leading-none transition-all ${r.is_favorite ? 'text-yellow-400' : 'text-[var(--color-border)]'}`}>{r.is_favorite ? '★' : '☆'}</button>
                            </td>
                            <td className="px-3 py-2 min-w-0">
                              {editingId === r.id ? (
                                <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} onBlur={() => handleRename(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') handleRename(r.id); if (e.key === 'Escape') setEditingId(null) }} autoFocus className="text-xs font-black !py-0.5 !px-1 w-full" />
                              ) : (
                                <div onClick={() => handleViewDetail(r.id)} className="font-black truncate cursor-pointer group-hover:text-[var(--color-accent)] transition-colors">{r.name}</div>
                              )}
                              <div className="flex items-center gap-1.5 flex-wrap">
                              <div className="text-[9px] text-[var(--color-text-disabled)] font-bold uppercase">{r.symbol} · {r.interval} · {r.leverage}x</div>
                              <span className={`text-[8px] px-1 py-0 rounded border font-black ${r.strategy_mode === 'short_only' ? 'text-red-400 border-red-400/40' : r.strategy_mode === 'bidirectional' ? 'text-green-400 border-green-400/40' : r.strategy_mode === 'dca' ? 'text-blue-400 border-blue-400/40' : r.strategy_mode === 'martingale' ? 'text-yellow-400 border-yellow-400/40' : 'text-[var(--color-text-disabled)] border-[var(--color-border)]'}`}>{r.strategy_mode === 'short_only' ? '做空' : r.strategy_mode === 'bidirectional' ? '双向' : r.strategy_mode === 'dca' ? 'DCA' : r.strategy_mode === 'martingale' ? '马丁' : '做多'}</span>
                            </div>
                              {r.tags.length > 0 && (
                                <div className="flex flex-wrap gap-0.5 mt-0.5">
                                  {r.tags.map((tag) => (
                                    <span key={tag} className="flex items-center gap-0.5 text-[9px] px-1 py-0 rounded-full bg-[var(--color-bg-input)] border border-[var(--color-border)] text-[var(--color-text-secondary)] font-bold">
                                      <span onClick={() => setTagFilters((prev) => prev.includes(tag) ? prev : [...prev, tag])} className="hover:text-[var(--color-accent)] cursor-pointer">{tag}</span>
                                      <button onClick={() => void updateTags(r.id, r.tags.filter((t) => t !== tag))} className="text-[var(--color-text-disabled)] hover:text-[var(--color-short)] leading-none">×</button>
                                    </span>
                                  ))}
                                </div>
                              )}
                              {addingTagFor === r.id ? (
                                <div className="flex items-center gap-1 mt-0.5">
                                  <input type="text" value={newTagInput} onChange={(e) => setNewTagInput(e.target.value)} onKeyDown={(e) => {
                                    if (e.key === 'Enter' && newTagInput.trim()) {
                                      const tag = newTagInput.trim()
                                      if (!r.tags.includes(tag)) void updateTags(r.id, [...r.tags, tag])
                                      setNewTagInput(''); setAddingTagFor(null)
                                    }
                                    if (e.key === 'Escape') { setNewTagInput(''); setAddingTagFor(null) }
                                  }} placeholder="回车确认" className="!w-24 !px-1.5 !py-0.5 text-[9px] font-bold" autoFocus />
                                  <button onClick={() => { if (newTagInput.trim() && !r.tags.includes(newTagInput.trim())) void updateTags(r.id, [...r.tags, newTagInput.trim()]); setNewTagInput(''); setAddingTagFor(null) }} className="text-[9px] px-1 py-0.5 rounded bg-[var(--color-accent)] text-white font-bold">✓</button>
                                  <button onClick={() => { setNewTagInput(''); setAddingTagFor(null) }} className="text-[9px] text-[var(--color-text-disabled)] font-bold">✕</button>
                                </div>
                              ) : (
                                <button onClick={() => { setAddingTagFor(r.id); setNewTagInput('') }} className="text-[9px] text-[var(--color-text-disabled)] hover:text-[var(--color-accent)] font-bold mt-0.5">+ 标签</button>
                              )}
                            </td>
                            <td className={`px-3 py-2 text-right font-black font-[family-name:var(--font-mono)] whitespace-nowrap ${r.total_return_pct >= 0 ? 'text-[var(--color-long)]' : 'text-[var(--color-short)]'}`}>{r.total_return_pct > 0 ? '+' : ''}{r.total_return_pct}%</td>
                            <td className="px-3 py-2 text-right font-black font-[family-name:var(--font-mono)] whitespace-nowrap">{r.win_rate}%</td>
                            <td className="px-3 py-2 text-right font-black font-[family-name:var(--font-mono)] whitespace-nowrap">{r.profit_factor}</td>
                            <td className="px-3 py-2 text-right font-black font-[family-name:var(--font-mono)] whitespace-nowrap text-[var(--color-short)]">{r.max_drawdown}%</td>
                            <td className="px-3 py-2 text-right font-black font-[family-name:var(--font-mono)] whitespace-nowrap">{r.sharpe_ratio}</td>
                            <td className="px-3 py-2 text-right font-black font-[family-name:var(--font-mono)] whitespace-nowrap">{r.sortino_ratio}</td>
                            <td className={`px-3 py-2 text-right font-black font-[family-name:var(--font-mono)] whitespace-nowrap ${r.max_consecutive_losses >= 5 ? 'text-[var(--color-short)]' : ''}`}>{r.max_consecutive_losses}</td>
                            <td className="px-3 py-2 text-right font-black font-[family-name:var(--font-mono)] whitespace-nowrap text-[var(--color-text-secondary)]">{r.max_dd_duration_hours >= 24 ? `${(r.max_dd_duration_hours / 24).toFixed(1)}d` : `${r.max_dd_duration_hours}h`}</td>
                            <td className={`px-3 py-2 text-right font-black font-[family-name:var(--font-mono)] whitespace-nowrap ${r.tail_ratio >= 1 ? 'text-[var(--color-long)]' : r.tail_ratio > 0 ? 'text-[var(--color-short)]' : ''}`}>{r.tail_ratio}</td>
                            <td className="px-3 py-2 text-right font-black font-[family-name:var(--font-mono)] whitespace-nowrap">{r.total_trades}</td>
                            <td className="px-3 py-2 text-right font-black font-[family-name:var(--font-mono)] whitespace-nowrap text-[var(--color-text-secondary)]">{r.avg_holding_hours}h</td>
                            <td className="px-3 py-2 text-right font-black font-[family-name:var(--font-mono)] whitespace-nowrap">{r.position_pct}%</td>
                            <td className="px-3 py-2 text-right font-black font-[family-name:var(--font-mono)] whitespace-nowrap">{r.leverage}×</td>
                            <td className="px-3 py-2 text-right font-black whitespace-nowrap text-[var(--color-text-secondary)]">{new Date(r.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => void handleExportMarkdown(r.id)} className="px-1.5 py-0.5 rounded bg-[var(--color-bg-input)] text-[9px] font-black uppercase text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-all">MD</button>
                                <button onClick={() => deleteRecord(r.id)} className="p-1 rounded-full hover:bg-[var(--color-short)]/10 text-[var(--color-text-disabled)] hover:text-[var(--color-short)] transition-all"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {sortedRecords.length === 0 && (
                          <tr><td colSpan={HISTORY_SORT_OPTIONS.length + 3} className="px-4 py-8 text-center text-[var(--color-text-disabled)] font-bold">暂无回测记录</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  )
}
