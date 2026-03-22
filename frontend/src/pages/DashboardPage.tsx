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
import { Group, Panel, Separator } from 'react-resizable-panels'
import { FlashText } from '@/shared/FlashText'
import { MarketWatchlist } from '@/features/market/MarketWatchlist'

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
const POSITION_REFRESH_MS = 3000

export function DashboardPage() {
  const [searchParams] = useSearchParams()
  const symbol = useMarketStore((state) => state.symbol)
  const interval = useMarketStore((state) => state.interval)
  const klinesLength = useMarketStore((state) => state.klines.length)
  const latestKline = useMarketStore((state) => state.latestKline)
  const fetchKlines = useMarketStore((state) => state.fetchKlines)
  const fetchSymbols = useMarketStore((state) => state.fetchSymbols)
  const positions = useAccountStore((state) => state.positions)
  const positionsLoading = useAccountStore((state) => state.positionsLoading)
  const fetchPositions = useAccountStore((state) => state.fetchPositions)
  const closePosition = useAccountStore((state) => state.closePosition)
  const status = useRiskStore((state) => state.status)
  const fetchStatus = useRiskStore((state) => state.fetchStatus)
  const fetchConfig = useRiskStore((state) => state.fetchConfig)
  const balance = useTradeStore((state) => state.balance)
  const balanceMode = useTradeStore((state) => state.balanceMode)
  const fetchBalance = useTradeStore((state) => state.fetchBalance)
  const signalSymbol = useBacktestSignalStore((state) => state.symbol)
  const signalInterval = useBacktestSignalStore((state) => state.interval)
  const [activeIndicators, setActiveIndicators] = useState<IndicatorConfig[]>([])
  const initialLoadRef = useRef(false)

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
    const timer = window.setInterval(() => {
      void fetchPositions({ background: true })
    }, POSITION_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [fetchPositions])

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

    if (targetSymbol !== symbol || targetInterval !== interval) {
      fetchKlines(targetSymbol, targetInterval)
    }
  }, [searchParams, signalSymbol, signalInterval, klinesLength, symbol, interval])

  const handleChangeTf = (tf: string) => void fetchKlines(symbol, tf)
  const handleClose = async (orderId: string | null) => {
    if (!orderId) return
    await closePosition(orderId)
    void fetchPositions()
  }

  const toggleIndicator = (preset: typeof INDICATOR_PRESETS[number]) => {
    setActiveIndicators((prev) => {
      const exists = prev.some(ind => ind.type === preset.config.type && ind.period === preset.config.period)
      return exists 
        ? prev.filter(ind => !(ind.type === preset.config.type && ind.period === preset.config.period))
        : [...prev, preset.config]
    })
  }

  const isActive = (preset: typeof INDICATOR_PRESETS[number]) =>
    activeIndicators.some(ind => ind.type === preset.config.type && ind.period === preset.config.period)

  const getPositionMetrics = (p: typeof positions[number]) => {
    const currentPrice = (p.symbol === symbol && latestKline?.close) ? latestKline.close : p.current_price
    const direction = p.side === 'SHORT' ? -1 : 1
    const pnl = (p.entry_price > 0 && currentPrice > 0) ? (currentPrice - p.entry_price) * direction * p.quantity : p.unrealized_pnl
    const floatingRatio = (p.entry_price > 0 && currentPrice > 0)
      ? ((currentPrice - p.entry_price) / p.entry_price) * direction * 100
      : p.price_change_pct * direction
    return { currentPrice, pnl, floatingRatio }
  }

  return (
    <MainLayout>
      <div className="h-full bg-[var(--color-bg-primary)] overflow-hidden">
        <Group orientation="horizontal">
          <Panel defaultSize={16} minSize={10} collapsible={true} className="bg-[var(--color-bg-card)] border-r border-[var(--color-border)]">
            <MarketWatchlist />
          </Panel>

          <Separator className="resize-handle resize-handle-horizontal" />

          <Panel defaultSize={59} minSize={30}>
            <Group orientation="vertical">
              <Panel defaultSize={70} minSize={20}>
                <div className="flex flex-col h-full min-w-0">
                  <div className="flex items-center justify-between px-3 h-10 border-b border-[var(--color-border)] bg-[var(--color-bg-card)] z-10 shrink-0">
                    <div className="flex items-center gap-4">
                      <div className="flex items-baseline gap-1 shrink-0">
                        <span className="text-sm font-black text-[var(--color-text-primary)] tracking-tighter">{symbol.replace('USDT', '')}</span>
                        <span className="text-[9px] font-bold text-[var(--color-text-disabled)] uppercase">/USDT</span>
                      </div>
                      <div className="flex items-center gap-5 overflow-hidden">
                        <div className="flex flex-col">
                          <span className="text-[8px] text-[var(--color-text-disabled)] font-bold uppercase leading-none mb-1">Price</span>
                          <FlashText value={latestKline?.close || 0} className="text-sm font-black font-[var(--font-mono)] text-[var(--color-accent)] leading-none">
                            {(latestKline?.close || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </FlashText>
                        </div>
                        <div className="hidden sm:flex flex-col">
                          <span className="text-[8px] text-[var(--color-text-disabled)] font-bold uppercase leading-none mb-1">24h%</span>
                          <span className={`text-[11px] font-bold font-[var(--font-mono)] leading-none ${latestKline && latestKline.close >= latestKline.open ? 'text-[var(--color-long)]' : 'text-[var(--color-short)]'}`}>
                            {latestKline ? `${latestKline.close >= latestKline.open ? '+' : ''}${((latestKline.close - latestKline.open) / latestKline.open * 100).toFixed(2)}%` : '--'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex p-0.5 bg-[var(--color-bg-input)] rounded">
                      {TIMEFRAMES.map((tf) => (
                        <button key={tf} onClick={() => handleChangeTf(tf)}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${interval === tf ? 'bg-[var(--color-bg-card)] text-[var(--color-accent)] shadow-sm' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>{tf}</button>
                      ))}
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 relative">
                    <div className="absolute top-2 left-3 z-10 flex gap-1 items-center">
                      {INDICATOR_PRESETS.map((preset) => (
                        <button key={preset.label} onClick={() => toggleIndicator(preset)}
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold border transition-all ${isActive(preset) ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]' : 'bg-[var(--color-bg-card)]/60 backdrop-blur-md border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-primary)]'}`}>{preset.label}</button>
                      ))}
                    </div>
                    <KlineChart indicators={activeIndicators} />
                  </div>
                </div>
              </Panel>

              <Separator className="resize-handle resize-handle-vertical" />

              <Panel defaultSize={30} minSize={10}>
                <div className="flex flex-col h-full bg-[var(--color-bg-card)] border-t border-[var(--color-border)] overflow-hidden">
                  <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center justify-between h-8 bg-[var(--color-bg-hover)]/30 shrink-0">
                    <span className="text-[10px] font-bold text-[var(--color-text-disabled)] tracking-[0.18em]">当前持仓</span>
                    <button onClick={() => void fetchPositions()} disabled={positionsLoading} className="text-[10px] font-bold text-[var(--color-accent)]">刷新</button>
                  </div>
                  <div className="flex-1 overflow-auto custom-scrollbar">
                    <table className="w-full text-left border-collapse min-w-[700px]">
                      <thead className="sticky top-0 bg-[var(--color-bg-card)] z-10 shadow-sm">
                        <tr className="text-[8px] text-[var(--color-text-disabled)] uppercase font-bold border-b border-[var(--color-border)]">
                          <th className="px-4 py-1.5">交易对</th>
                          <th className="px-3 py-1.5 text-center">方向</th>
                          <th className="px-3 py-1.5 text-right">数量</th>
                          <th className="px-3 py-1.5 text-right">开仓价</th>
                          <th className="px-3 py-1.5 text-right">现价</th>
                          <th className="px-3 py-1.5 text-right">浮动盈亏</th>
                          <th className="px-4 py-1.5 text-right">浮动比率</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-border)]/20">
                        {positions.map((p) => {
                          const { currentPrice, pnl, floatingRatio } = getPositionMetrics(p)
                          const isPositive = pnl >= 0
                          const isRatioPositive = floatingRatio >= 0
                          return (
                            <tr key={p.order_id || p.symbol} className="hover:bg-[var(--color-bg-hover)] transition-colors group">
                              <td className="px-4 py-1.5 font-black text-xs">{p.symbol}</td>
                              <td className="px-3 py-1.5 text-center">
                                <span className={`px-1 py-0.5 rounded text-[8px] font-black ${p.side === 'LONG' ? 'bg-[var(--color-long)]/10 text-[var(--color-long)]' : 'bg-[var(--color-short)]/10 text-[var(--color-short)]'}`}>{p.side === 'LONG' ? '多' : '空'}</span>
                              </td>
                              <td className="px-3 py-1.5 text-right font-[var(--font-mono)] text-xs">{p.quantity}</td>
                              <td className="px-3 py-1.5 text-right font-[var(--font-mono)] text-xs text-[var(--color-text-secondary)]">{p.entry_price.toFixed(2)}</td>
                              <td className="px-3 py-1.5 text-right font-[var(--font-mono)] text-xs">
                                <FlashText value={currentPrice}>{currentPrice.toFixed(2)}</FlashText>
                              </td>
                              <td className={`px-3 py-1.5 text-right font-[var(--font-mono)] text-xs font-black ${isPositive ? 'text-[var(--color-long)]' : 'text-[var(--color-short)]'}`}>
                                <div className="flex items-center justify-end gap-2">
                                  <FlashText value={pnl}>{isPositive ? '+' : ''}{pnl.toFixed(2)}</FlashText>
                                  {p.order_id && <button onClick={() => handleClose(p.order_id)} className="text-[9px] font-black text-[var(--color-short)] hover:underline opacity-0 group-hover:opacity-100 transition-opacity">平仓</button>}
                                </div>
                              </td>
                              <td className={`px-4 py-1.5 text-right font-[var(--font-mono)] text-xs font-black ${isRatioPositive ? 'text-[var(--color-long)]' : 'text-[var(--color-short)]'}`}>
                                <FlashText value={floatingRatio}>{isRatioPositive ? '+' : ''}{floatingRatio.toFixed(2)}%</FlashText>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </Panel>
            </Group>
          </Panel>

          <Separator className="resize-handle resize-handle-horizontal" />

          <Panel defaultSize={25} minSize={20}>
            <div className="h-full flex flex-col bg-[var(--color-bg-card)] border-l border-[var(--color-border)] overflow-hidden">
              {/* 资产概览 */}
              <div className="p-4 border-b border-[var(--color-border)] shrink-0 bg-gradient-to-br from-[var(--color-bg-hover)]/50 to-transparent">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex flex-col">
                    <span className="text-[9px] text-[var(--color-text-disabled)] uppercase font-black tracking-widest leading-none mb-1.5">可用余额</span>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-black font-[var(--font-mono)] tracking-tight text-[var(--color-text-primary)] leading-none">{balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      <span className="text-[10px] font-bold text-[var(--color-text-disabled)] uppercase">USDT</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className={`text-[8px] px-1.5 py-0.5 rounded font-black tracking-tighter ${balanceMode === 'SIMULATED' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : 'bg-blue-500/10 text-blue-500 border border-blue-500/20'}`}>
                      {balanceMode === 'SIMULATED' ? '模拟账户' : '实盘账户'}
                    </span>
                  </div>
                </div>
              </div>

              {/* 交易面板 */}
              <div className="flex-1 overflow-hidden">
                <OrderForm />
              </div>

              {/* 风控监控 */}
              {status && (
                <div className="p-4 bg-[var(--color-bg-hover)]/30 border-t border-[var(--color-border)] shrink-0">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[9px] text-[var(--color-text-disabled)] uppercase font-black tracking-widest">风控实时监控</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${status.is_locked ? 'bg-[var(--color-short)]/10 text-[var(--color-short)]' : 'bg-[var(--color-long)]/10 text-[var(--color-long)]'}`}>
                      {status.is_locked ? '已熔断' : '监控中'}
                    </span>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between items-end mb-1.5 px-0.5">
                        <span className="text-[10px] font-bold text-[var(--color-text-secondary)]">当日最大回撤</span>
                        <span className={`text-[10px] font-black font-[var(--font-mono)] ${status.daily_loss_percent >= status.daily_loss_limit * 0.8 ? 'text-[var(--color-short)]' : 'text-[var(--color-text-primary)]'}`}>
                          {status.daily_loss_percent.toFixed(2)}% <span className="opacity-40 font-normal">/ {status.daily_loss_limit}%</span>
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-[var(--color-bg-input)] rounded-full overflow-hidden shadow-inner">
                        <div 
                          className={`h-full transition-all duration-700 ease-out ${status.daily_loss_percent >= status.daily_loss_limit * 0.8 ? 'bg-[var(--color-short)]' : 'bg-[var(--color-accent)]'}`} 
                          style={{ width: `${Math.min((status.daily_loss_percent / status.daily_loss_limit) * 100, 100)}%` }} 
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="px-2.5 py-2 rounded bg-[var(--color-bg-input)]/40 border border-[var(--color-border)]">
                        <div className="text-[8px] text-[var(--color-text-disabled)] font-black uppercase mb-0.5">今日成交</div>
                        <div className="text-xs font-black font-[var(--font-mono)] text-[var(--color-text-primary)]">{status.trade_count_today} <span className="text-[9px] opacity-40 font-normal">次</span></div>
                      </div>
                      <div className="px-2.5 py-2 rounded bg-[var(--color-bg-input)]/40 border border-[var(--color-border)]">
                        <div className="text-[8px] text-[var(--color-text-disabled)] font-black uppercase mb-0.5">账户状态</div>
                        <div className={`text-xs font-black ${status.is_locked ? 'text-[var(--color-short)]' : 'text-[var(--color-long)]'}`}>{status.is_locked ? 'HALTED' : 'HEALTHY'}</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Panel>
        </Group>
      </div>
    </MainLayout>
  )
}
