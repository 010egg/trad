import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'react-router'
import { useMarketStore } from '@/stores/useMarketStore'
import { useAccountStore } from '@/stores/useAccountStore'
import { useRiskStore } from '@/stores/useRiskStore'
import { useTradeStore } from '@/stores/useTradeStore'
import { useBacktestSignalStore } from '@/stores/useBacktestSignalStore'
import { useMarketWebSocket } from '@/hooks/useMarketWebSocket'
import { MainLayout } from '@/layouts/MainLayout'
import { LazyKlineChart as KlineChart } from '@/features/chart/LazyKlineChart'
import type { IndicatorConfig } from '@/features/chart/LazyKlineChart'
import { OrderForm } from '@/features/trade/OrderForm'

const INDICATOR_PRESETS: { label: string; config: IndicatorConfig }[] = [
  { label: 'MA20', config: { type: 'MA', period: 20 } },
  { label: 'MA60', config: { type: 'MA', period: 60 } },
  { label: 'EMA20', config: { type: 'EMA', period: 20 } },
  { label: 'EMA60', config: { type: 'EMA', period: 60 } },
  { label: 'BOLL', config: { type: 'BOLL', period: 20 } },
  { label: 'RSI', config: { type: 'RSI', period: 14 } },
  { label: 'KDJ', config: { type: 'KDJ', n: 9 } },
  { label: 'MACD', config: { type: 'MACD' } },
]

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d']

export function DashboardPage() {
  const [searchParams] = useSearchParams()
  const symbol = useMarketStore((state) => state.symbol)
  const interval = useMarketStore((state) => state.interval)
  const klinesLength = useMarketStore((state) => state.klines.length)
  const symbols = useMarketStore((state) => state.symbols)
  const fetchKlines = useMarketStore((state) => state.fetchKlines)
  const fetchSymbols = useMarketStore((state) => state.fetchSymbols)
  const positions = useAccountStore((state) => state.positions)
  const positionsLoading = useAccountStore((state) => state.positionsLoading)
  const positionsLoaded = useAccountStore((state) => state.positionsLoaded)
  const positionsError = useAccountStore((state) => state.positionsError)
  const fetchPositions = useAccountStore((state) => state.fetchPositions)
  const closePosition = useAccountStore((state) => state.closePosition)
  const status = useRiskStore((state) => state.status)
  const fetchStatus = useRiskStore((state) => state.fetchStatus)
  const fetchConfig = useRiskStore((state) => state.fetchConfig)
  const balance = useTradeStore((state) => state.balance)
  const balanceMode = useTradeStore((state) => state.balanceMode)
  const balanceMarket = useTradeStore((state) => state.balanceMarket)
  const fetchBalance = useTradeStore((state) => state.fetchBalance)
  const recordName = useBacktestSignalStore((state) => state.recordName)
  const clearSignals = useBacktestSignalStore((state) => state.clearSignals)
  const signalSymbol = useBacktestSignalStore((state) => state.symbol)
  const signalInterval = useBacktestSignalStore((state) => state.interval)
  const [activeIndicators, setActiveIndicators] = useState<IndicatorConfig[]>([])
  const [hideSmallPositions, setHideSmallPositions] = useState(false)
  const initialLoadRef = useRef(false)

  const filteredPositions = hideSmallPositions
    ? positions.filter(p => {
        const totalValue = p.quantity * (p.current_price || p.entry_price || 0)
        return totalValue >= 10
      })
    : positions

  useMarketWebSocket()

  useEffect(() => {
    void Promise.allSettled([
      fetchSymbols(),
      fetchPositions(),
      fetchStatus(),
      fetchConfig(),
      fetchBalance(),
    ])
  }, [fetchBalance, fetchConfig, fetchPositions, fetchStatus, fetchSymbols, fetchKlines])

  useEffect(() => {
    const urlSymbol = searchParams.get('symbol')
    const urlInterval = searchParams.get('interval')
    const targetSymbol = urlSymbol || signalSymbol || symbol
    const targetInterval = urlInterval || signalInterval || interval

    if (!initialLoadRef.current && klinesLength === 0) {
      initialLoadRef.current = true
      fetchKlines(targetSymbol, targetInterval)
      return
    }

    const needsFetch = (targetSymbol !== symbol) || (targetInterval !== interval)
    if (needsFetch) {
      fetchKlines(targetSymbol, targetInterval)
    }
  }, [searchParams, signalSymbol, signalInterval, klinesLength, symbol, interval])

  const handleChangeTf = (tf: string) => void fetchKlines(symbol, tf)
  const handleChangeSymbol = (s: string) => void fetchKlines(s, interval)
  const handleClose = async (orderId: string | null) => {
    if (!orderId) return
    await closePosition(orderId)
    void fetchPositions()
  }

  const toggleIndicator = (preset: typeof INDICATOR_PRESETS[number]) => {
    setActiveIndicators((prev) => {
      const exists = prev.some(
        (ind) => ind.type === preset.config.type && ind.period === preset.config.period && ind.n === preset.config.n
      )
      if (exists) {
        return prev.filter(
          (ind) => !(ind.type === preset.config.type && ind.period === preset.config.period && ind.n === preset.config.n)
        )
      }
      return [...prev, preset.config]
    })
  }

  const isActive = (preset: typeof INDICATOR_PRESETS[number]) =>
    activeIndicators.some(
      (ind) => ind.type === preset.config.type && ind.period === preset.config.period && ind.n === preset.config.n
    )

  return (
    <MainLayout>
      <div className="flex flex-col h-full bg-[var(--color-bg-primary)]">
        <div className="flex flex-1 overflow-hidden min-h-0">
          <div className="flex-1 flex flex-col min-w-0 border-r border-[var(--color-border)]">
            <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-card)]/80 backdrop-blur-sm z-10 shrink-0">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <select value={symbol} onChange={(e) => handleChangeSymbol(e.target.value)}
                    className="!w-auto pl-2 pr-8 py-1 font-bold text-sm bg-[var(--color-bg-input)] border-[var(--color-border)] rounded hover:border-[var(--color-accent)] transition-colors appearance-none cursor-pointer">
                    {symbols.map((s) => <option key={s.symbol} value={s.symbol}>{s.base_asset}/{s.quote_asset}</option>)}
                  </select>
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--color-text-disabled)]">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                  </div>
                </div>
                <div className="flex p-0.5 bg-[var(--color-bg-input)] rounded-md">
                  {TIMEFRAMES.map((tf) => (
                    <button key={tf} onClick={() => handleChangeTf(tf)}
                      className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${interval === tf ? 'bg-[var(--color-bg-card)] text-[var(--color-accent)] shadow-sm' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>{tf}</button>
                  ))}
                </div>
                <div className="w-px h-4 bg-[var(--color-border)] mx-1" />
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar max-w-[400px]">
                  {INDICATOR_PRESETS.map((preset) => (
                    <button key={preset.label} onClick={() => toggleIndicator(preset)}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-all whitespace-nowrap ${isActive(preset) ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)] text-[var(--color-accent)]' : 'bg-transparent border-[var(--color-border)] text-[var(--color-text-disabled)] hover:border-[var(--color-text-secondary)] hover:text-[var(--color-text-secondary)]'}`}>{preset.label}</button>
                  ))}
                </div>
              </div>
              {recordName && (
                <button onClick={clearSignals} className="px-2.5 py-1 rounded text-[10px] font-bold border border-[var(--color-short)] text-[var(--color-short)] hover:bg-[var(--color-short)] hover:text-white transition-all flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-short)] animate-pulse" />清除回测信号
                </button>
              )}
            </div>
            <div className="flex-1 min-h-0 bg-[var(--color-bg-primary)]">
              <KlineChart indicators={activeIndicators} />
            </div>
          </div>

          <div className="w-[340px] flex flex-col overflow-y-auto bg-[var(--color-bg-card)] border-l border-[var(--color-border)] custom-scrollbar">
            <div className="p-5 border-b border-[var(--color-border)] bg-gradient-to-b from-[var(--color-bg-hover)] to-transparent">
              <div className="flex items-center justify-between mb-4">
                <span className="text-[10px] text-[var(--color-text-disabled)] uppercase tracking-widest font-bold">账户总览</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${balanceMode === 'SIMULATED' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : 'bg-blue-500/10 text-blue-500 border border-blue-500/20'}`}>
                  {balanceMode === 'SIMULATED' ? '模拟' : '实盘'}
                </span>
              </div>
              <div className="space-y-4">
                <div>
                  <div className="text-[10px] text-[var(--color-text-disabled)] mb-1">可用余额 (USDT)</div>
                  <div className="text-2xl font-bold tracking-tight font-[var(--font-mono)] text-[var(--color-text-primary)]">
                    {balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div className="flex items-center gap-6 pt-1">
                  <div>
                    <div className="text-[10px] text-[var(--color-text-disabled)] mb-1">活跃持仓</div>
                    <div className="text-sm font-bold font-[var(--font-mono)]">{hideSmallPositions ? `${filteredPositions.length} / ${positions.length}` : positions.length}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--color-text-disabled)] mb-1">交易市场</div>
                    <div className="text-sm font-bold text-[var(--color-text-secondary)]">{balanceMarket === 'SPOT' ? '现货 SPOT' : '合约 FUTURES'}</div>
                  </div>
                </div>
              </div>
            </div>
            <OrderForm />
            {status && (
              <div className="p-5 mt-auto border-t border-[var(--color-border)] bg-[var(--color-bg-hover)]/30">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[10px] text-[var(--color-text-disabled)] uppercase tracking-widest font-bold">今日风控监控</span>
                  {status.is_locked && <span className="flex h-2 w-2 rounded-full bg-[var(--color-short)] animate-ping" />}
                </div>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between items-end mb-2">
                      <span className="text-xs text-[var(--color-text-secondary)]">当日最大回撤率</span>
                      <span className={`text-sm font-bold font-[var(--font-mono)] ${status.daily_loss_percent >= status.daily_loss_limit * 0.8 ? 'text-[var(--color-short)]' : 'text-[var(--color-text-primary)]'}`}>
                        {status.daily_loss_percent.toFixed(2)}% / {status.daily_loss_limit}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-[var(--color-bg-input)] rounded-full overflow-hidden">
                      <div className={`h-full transition-all duration-500 ${status.daily_loss_percent >= status.daily_loss_limit * 0.8 ? 'bg-[var(--color-short)]' : 'bg-[var(--color-accent)]'}`} style={{ width: `${Math.min((status.daily_loss_percent / status.daily_loss_limit) * 100, 100)}%` }} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-2.5 rounded bg-[var(--color-bg-input)]/50 border border-[var(--color-border)]">
                      <div className="text-[10px] text-[var(--color-text-disabled)] mb-1">今日成交</div>
                      <div className="text-sm font-bold font-[var(--font-mono)]">{status.trade_count_today} 次</div>
                    </div>
                    <div className="p-2.5 rounded bg-[var(--color-bg-input)]/50 border border-[var(--color-border)]">
                      <div className="text-[10px] text-[var(--color-text-disabled)] mb-1">交易状态</div>
                      <div className={`text-sm font-bold ${status.is_locked ? 'text-[var(--color-short)]' : 'text-[var(--color-long)]'}`}>{status.is_locked ? '已熔断' : '正常'}</div>
                    </div>
                  </div>
                  {status.is_locked && (
                    <div className="p-3 bg-[var(--color-short)]/10 border border-[var(--color-short)]/20 rounded-md text-[11px] text-[var(--color-short)] font-medium leading-relaxed">
                      ⚠️ 触发风控熔断限制。为了保护您的资产，当前账户已禁止建立新头寸，请等待下一个交易周期。
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col bg-[var(--color-bg-card)] border-t border-[var(--color-border)] min-h-[140px] max-h-[35%] overflow-hidden shrink-0">
          <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-hover)]/30">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 cursor-pointer group">
                <input type="checkbox" id="hideSmall" checked={hideSmallPositions} onChange={(e) => setHideSmallPositions(e.target.checked)}
                  className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-bg-input)] text-[var(--color-accent)] focus:ring-0 cursor-pointer" />
                <label htmlFor="hideSmall" className="text-xs font-bold text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)] transition-colors cursor-pointer select-none">隐藏小额持仓 (&lt;10U)</label>
              </div>
              <div className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--color-bg-input)] text-[var(--color-text-disabled)] border border-[var(--color-border)]">{filteredPositions.length} 个头寸</div>
            </div>
            <button type="button" onClick={() => void fetchPositions()} disabled={positionsLoading}
              className="px-3 py-1.5 text-[11px] font-bold rounded border border-[var(--color-border)] bg-[var(--color-bg-input)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-card)] hover:text-[var(--color-text-primary)] transition-all disabled:opacity-50 flex items-center gap-2">
              {positionsLoading ? <div className="w-3 h-3 border-2 border-[var(--color-text-disabled)] border-t-transparent rounded-full animate-spin" /> : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21v-5h5"/></svg>}
              {positionsLoading ? '同步中...' : '刷新持仓'}
            </button>
          </div>
          <div className="flex-1 overflow-auto custom-scrollbar">
            {filteredPositions.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center py-10 opacity-40">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-3"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                <div className="text-sm font-medium">{!positionsLoaded || positionsLoading ? '正在同步云端持仓数据...' : positionsError || '当前无活跃持仓'}</div>
              </div>
            ) : (
              <table className="w-full text-left border-collapse min-w-[1000px]">
                <thead className="sticky top-0 z-20 bg-[var(--color-bg-card)] shadow-sm">
                  <tr className="text-[10px] text-[var(--color-text-disabled)] uppercase tracking-wider">
                    <th className="px-5 py-3 border-b border-[var(--color-border)] font-bold">交易对</th>
                    <th className="px-4 py-3 border-b border-[var(--color-border)] font-bold text-center">方向</th>
                    <th className="px-4 py-3 border-b border-[var(--color-border)] font-bold text-right">数量</th>
                    <th className="px-4 py-3 border-b border-[var(--color-border)] font-bold text-right">开仓价</th>
                    <th className="px-4 py-3 border-b border-[var(--color-border)] font-bold text-right">当前价</th>
                    <th className="px-4 py-3 border-b border-[var(--color-border)] font-bold text-right">涨跌幅</th>
                    <th className="px-4 py-3 border-b border-[var(--color-border)] font-bold text-right">名义价值</th>
                    <th className="px-4 py-3 border-b border-[var(--color-border)] font-bold text-right">未实现盈亏</th>
                    <th className="px-5 py-3 border-b border-[var(--color-border)] font-bold text-center">管理</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]/50">
                  {filteredPositions.map((p) => {
                    const totalValue = p.quantity * (p.current_price || p.entry_price || 0)
                    const pnl = p.unrealized_pnl || 0
                    const isPositive = pnl >= 0
                    const isLong = p.side === 'LONG'
                    return (
                      <tr key={p.order_id || p.symbol} className="group hover:bg-[var(--color-bg-hover)] transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="text-sm font-bold tracking-tight">{p.symbol}</div>
                          <div className="text-[10px] text-[var(--color-text-disabled)] font-bold uppercase tracking-widest">{p.trade_mode === 'SIMULATED' ? '模拟' : '实盘'}</div>
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <span className={`inline-flex items-center px-2 py-1 rounded text-[10px] font-black uppercase ${isLong ? 'bg-[var(--color-long)]/10 text-[var(--color-long)]' : 'bg-[var(--color-short)]/10 text-[var(--color-short)]'}`}>{isLong ? '做多 / Long' : '做空 / Short'}</span>
                        </td>
                        <td className="px-4 py-3.5 text-right font-[var(--font-mono)] text-sm font-medium">{p.quantity}</td>
                        <td className="px-4 py-3.5 text-right font-[var(--font-mono)] text-sm text-[var(--color-text-secondary)]">{p.entry_price > 0 ? p.entry_price.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '--'}</td>
                        <td className="px-4 py-3.5 text-right font-[var(--font-mono)] text-sm text-[var(--color-text-primary)] font-bold">{p.current_price > 0 ? p.current_price.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '--'}</td>
                        <td className={`px-4 py-3.5 text-right font-[var(--font-mono)] text-sm font-bold ${p.price_change_pct >= 0 ? 'text-[var(--color-long)]' : 'text-[var(--color-short)]'}`}>
                          <span className={`px-1.5 py-0.5 rounded-sm ${p.price_change_pct >= 0 ? 'bg-[var(--color-long)]/5' : 'bg-[var(--color-short)]/5'}`}>{p.price_change_pct !== 0 ? `${p.price_change_pct >= 0 ? '▲' : '▼'} ${Math.abs(p.price_change_pct).toFixed(2)}%` : '--'}</span>
                        </td>
                        <td className="px-4 py-3.5 text-right font-[var(--font-mono)] text-sm text-[var(--color-text-secondary)]">{totalValue.toFixed(2)} <span className="text-[10px] opacity-40">USDT</span></td>
                        <td className={`px-4 py-3.5 text-right font-[var(--font-mono)] text-sm font-black ${isPositive ? 'text-[var(--color-long)]' : 'text-[var(--color-short)]'}`}>{pnl !== 0 ? `${isPositive ? '+' : '-'}${Math.abs(pnl).toFixed(2)}` : '0.00'}</td>
                        <td className="px-5 py-3.5 text-center">
                          {p.trade_mode === 'SIMULATED' && p.order_id ? (
                            <button onClick={() => handleClose(p.order_id)} className="px-3 py-1 text-[10px] font-black border border-[var(--color-border)] rounded bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] hover:border-[var(--color-short)] hover:text-[var(--color-short)] hover:bg-[var(--color-short)]/5 transition-all shadow-sm">一键平仓</button>
                          ) : (
                            <div className="flex flex-col items-center"><span className="text-[10px] font-bold text-[var(--color-accent)] opacity-80">BINANCE</span><span className="text-[8px] text-[var(--color-text-disabled)] uppercase font-bold">托管账户</span></div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  )
}
