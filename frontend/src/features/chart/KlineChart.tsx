import { useEffect, useRef, useState } from 'react'
import { createChart, IChartApi, ISeriesApi, Time } from 'lightweight-charts'
import { MARKET_KLINE_LIMIT, useMarketStore } from '@/stores/useMarketStore'
import { useBacktestSignalStore } from '@/stores/useBacktestSignalStore'
import api from '@/lib/api'

interface TooltipData {
  time: string
  open: number
  high: number
  low: number
  close: number
  change: number
  changePct: number
  amplitude: number
}

export interface IndicatorConfig {
  type: string
  period?: number
  n?: number
  fast?: number
  slow?: number
  signal?: number
}

interface KlineChartProps {
  indicators?: IndicatorConfig[]
}

const INDICATOR_COLORS: Record<string, string> = {
  MA5: '#f5c842', MA10: '#42a5f5', MA20: '#ab47bc', MA60: '#ff7043', MA120: '#26a69a', MA200: '#ef5350',
  EMA5: '#f5c842', EMA10: '#42a5f5', EMA20: '#ab47bc', EMA60: '#ff7043', EMA120: '#26a69a', EMA200: '#ef5350',
  RSI14: '#42a5f5',
  KDJ_K: '#42a5f5', KDJ_D: '#ff7043', KDJ_J: '#ab47bc',
  MACD_DIF: '#42a5f5', MACD_DEA: '#ff7043',
  BOLL_UPPER: '#ff7043', BOLL_MID: '#ab47bc', BOLL_LOWER: '#42a5f5',
}

function getColor(key: string): string {
  // Try exact match first, then pattern match
  if (INDICATOR_COLORS[key]) return INDICATOR_COLORS[key]
  if (key.startsWith('MA')) return '#ab47bc'
  if (key.startsWith('EMA')) return '#ff7043'
  if (key.startsWith('RSI')) return '#42a5f5'
  return '#8b949e'
}

// Indicators rendered on main price chart
const OVERLAY_PREFIXES = ['MA', 'EMA', 'BOLL']
// Indicators rendered in sub-chart
const SUB_PREFIXES = ['RSI', 'KDJ', 'MACD']

function isOverlayKey(key: string): boolean {
  return OVERLAY_PREFIXES.some((p) => key.startsWith(p))
}

export function KlineChart({ indicators = [] }: KlineChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const subChartRef = useRef<HTMLDivElement>(null)
  const chartApi = useRef<IChartApi | null>(null)
  const subChartApi = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const overlaySeriesRef = useRef(new Map<string, ISeriesApi<'Line'>>())
  const subSeriesRef = useRef(new Map<string, ISeriesApi<'Line'> | ISeriesApi<'Histogram'>>())
  const entryMarkersRef = useRef<ISeriesApi<'Line'> | null>(null)
  const exitMarkersRef = useRef<ISeriesApi<'Line'> | null>(null)
  const [chartReady, setChartReady] = useState(false)

  // 仅在初始化或切换 symbol/interval 时通过 selector 获取数据
  // 使用 shallow 比较或特定字段以减少不必要的重渲染
  const symbol = useMarketStore((state) => state.symbol)
  const interval = useMarketStore((state) => state.interval)
  const signals = useBacktestSignalStore((state) => state.signals)
  const recordName = useBacktestSignalStore((state) => state.recordName)

  const [tooltip, setTooltip] = useState<TooltipData | null>(null)

  const indicatorRequestRef = useRef(0)
  const indicatorKey = JSON.stringify(indicators)

  // Create main chart
  useEffect(() => {
    if (!chartRef.current || chartApi.current) return

    const chart = createChart(chartRef.current, {
      layout: { background: { color: '#0d1117' }, textColor: '#8b949e', fontSize: 11 },
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      crosshair: { mode: 0, horzLine: { visible: false, labelVisible: false } },
      timeScale: { borderColor: '#30363d', timeVisible: true },
      rightPriceScale: { borderColor: '#30363d' },
      width: chartRef.current.clientWidth,
      height: chartRef.current.clientHeight || 600,
    })
    chartApi.current = chart
    setChartReady(true)

    candleRef.current = chart.addCandlestickSeries({
      upColor: '#3fb68b', downColor: '#ff6838',
      borderUpColor: '#3fb68b', borderDownColor: '#ff6838',
      wickUpColor: '#3fb68b', wickDownColor: '#ff6838',
    })

    volumeRef.current = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, visible: false })

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData || !candleRef.current) {
        setTooltip(null)
        return
      }
      const bar = param.seriesData.get(candleRef.current) as {
        open: number; high: number; low: number; close: number
      } | undefined
      if (!bar) { setTooltip(null); return }

      const timeVal = param.time as number
      const date = new Date(timeVal * 1000)
      const pad = (n: number) => String(n).padStart(2, '0')
      const timeStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`

      const change = bar.close - bar.open
      const changePct = bar.open !== 0 ? (change / bar.open) * 100 : 0
      const amplitude = bar.open !== 0 ? ((bar.high - bar.low) / bar.open) * 100 : 0

      setTooltip({
        time: timeStr,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        change,
        changePct,
        amplitude,
      })
    })

    const observer = new ResizeObserver((entries) => {
      if (!entries.length) return
      const { width, height } = entries[0].contentRect
      chart.applyOptions({ width, height })
    })

    if (chartRef.current) {
      observer.observe(chartRef.current)
    }

    return () => {
      observer.disconnect()
      chart.remove()
      chartApi.current = null
      candleRef.current = null
      volumeRef.current = null
      overlaySeriesRef.current.clear()
      setChartReady(false)
    }
  }, [])

  // Create sub chart
  const hasSubIndicators = indicators.some((ind) => SUB_PREFIXES.includes(ind.type.toUpperCase()))
  useEffect(() => {
    if (!subChartRef.current || !hasSubIndicators) {
      if (subChartApi.current) {
        subChartApi.current.remove()
        subChartApi.current = null
        subSeriesRef.current.clear()
      }
      return
    }
    if (subChartApi.current) return

    const chart = createChart(subChartRef.current, {
      layout: { background: { color: '#0d1117' }, textColor: '#8b949e', fontSize: 11 },
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      timeScale: { borderColor: '#30363d', timeVisible: true },
      rightPriceScale: { borderColor: '#30363d' },
      width: subChartRef.current.clientWidth,
      height: 150,
    })
    subChartApi.current = chart
    return () => {
      if (subChartApi.current) {
        subChartApi.current.remove()
        subChartApi.current = null
      }
    }
  }, [hasSubIndicators])

  // 全量重置数据：仅在 symbol 或 interval 变化时执行
  useEffect(() => {
    if (!chartReady || !candleRef.current || !volumeRef.current) return

    const fetchAndSetData = async () => {
      const klines = useMarketStore.getState().klines
      if (!klines.length) return

      candleRef.current?.setData(klines.map(k => ({
        time: k.time as Time, open: k.open, high: k.high, low: k.low, close: k.close
      })))

      volumeRef.current?.setData(klines.map(k => ({
        time: k.time as Time, value: k.volume,
        color: k.close >= k.open ? 'rgba(63,182,139,0.3)' : 'rgba(255,104,56,0.3)'
      })))

      chartApi.current?.timeScale().fitContent()
    }

    void fetchAndSetData()
  }, [chartReady, symbol, interval])

  // 实时增量更新：订阅 latestKline，实现 0 重渲染刷新
  useEffect(() => {
    if (!chartReady || !candleRef.current || !volumeRef.current) return

    const unsubscribe = useMarketStore.subscribe(
      (state) => state.latestKline,
      (latest) => {
        if (!latest || !candleRef.current || !volumeRef.current) return

        candleRef.current.update({
          time: latest.time as Time,
          open: latest.open,
          high: latest.high,
          low: latest.low,
          close: latest.close,
        })

        volumeRef.current.update({
          time: latest.time as Time,
          value: latest.volume,
          color: latest.close >= latest.open ? 'rgba(63,182,139,0.3)' : 'rgba(255,104,56,0.3)',
        })
      }
    )

    return () => unsubscribe()
  }, [chartReady])

  // Fetch & render indicators
  useEffect(() => {
    const fetchIndicators = async () => {
      if (!chartReady || !indicators.length) {
        overlaySeriesRef.current.forEach(s => { try { chartApi.current?.removeSeries(s) } catch {} })
        overlaySeriesRef.current.clear()
        subSeriesRef.current.forEach(s => { try { subChartApi.current?.removeSeries(s) } catch {} })
        subSeriesRef.current.clear()
        return
      }

      try {
        const requestId = ++indicatorRequestRef.current
        const data: Record<string, { time: number; value: number }[]> = await api.post('/market/indicators', {
          symbol, interval, limit: MARKET_KLINE_LIMIT,
          indicators: indicators.map(ind => ({ ...ind, type: ind.type }))
        })

        if (requestId !== indicatorRequestRef.current) return

        // Clear old series
        overlaySeriesRef.current.forEach(s => { try { chartApi.current?.removeSeries(s) } catch {} })
        overlaySeriesRef.current.clear()
        subSeriesRef.current.forEach(s => { try { subChartApi.current?.removeSeries(s) } catch {} })
        subSeriesRef.current.clear()

        for (const [key, points] of Object.entries(data)) {
          if (!points?.length) continue
          const lineData = points.map(p => ({ time: p.time as Time, value: p.value }))

          if (isOverlayKey(key)) {
            if (!chartApi.current) continue
            const series = chartApi.current.addLineSeries({
              color: getColor(key), lineWidth: 1, priceLineVisible: false, lastValueVisible: false
            })
            series.setData(lineData)
            overlaySeriesRef.current.set(key, series)
          } else {
            if (!subChartApi.current) continue
            const series = subChartApi.current.addLineSeries({
              color: getColor(key), lineWidth: 1, priceLineVisible: false, lastValueVisible: false
            })
            series.setData(lineData)
            subSeriesRef.current.set(key, series)
          }
        }
      } catch {}
    }

    void fetchIndicators()
  }, [chartReady, indicatorKey, symbol, interval])

  // Render backtest trade signals
  useEffect(() => {
    if (!candleRef.current || !chartApi.current) return

    // Clear existing markers
    if (entryMarkersRef.current) {
      try { chartApi.current.removeSeries(entryMarkersRef.current) } catch {}
      entryMarkersRef.current = null
    }
    if (exitMarkersRef.current) {
      try { chartApi.current.removeSeries(exitMarkersRef.current) } catch {}
      exitMarkersRef.current = null
    }

    if (!chartReady || !signals.length) return

    // Add entry markers (buy/sell signals)
    const entryMarkers = signals.map((signal) => {
      const time = new Date(signal.entry_time).getTime() / 1000
      return {
        time: time as Time,
        position: signal.side === 'LONG' ? 'belowBar' as const : 'aboveBar' as const,
        color: signal.side === 'LONG' ? '#3fb68b' : '#ff6838',
        shape: signal.side === 'LONG' ? 'arrowUp' as const : 'arrowDown' as const,
        text: `${signal.side === 'LONG' ? '做多' : '做空'} @${signal.entry_price.toFixed(2)}`,
      }
    })

    // Add exit markers
    const exitMarkers = signals.map((signal) => {
      const time = new Date(signal.exit_time).getTime() / 1000
      const pnlSign = signal.pnl >= 0 ? '+' : ''
      return {
        time: time as Time,
        position: signal.side === 'LONG' ? 'aboveBar' as const : 'belowBar' as const,
        color: signal.pnl >= 0 ? '#3fb68b' : '#ff6838',
        shape: 'circle' as const,
        text: `平仓 ${pnlSign}${signal.pnl_pct.toFixed(2)}%`,
      }
    })

    // Combine and sort markers by time (ascending order required by lightweight-charts)
    const allMarkers = [...entryMarkers, ...exitMarkers].sort((a, b) => (a.time as number) - (b.time as number))
    candleRef.current.setMarkers(allMarkers)
  }, [chartReady, signals])

  const isUp = tooltip ? tooltip.close >= tooltip.open : true
  const changeColor = isUp ? '#3fb68b' : '#ff6838'

  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-hidden">
      {recordName && (
        <div className="px-4 py-1.5 bg-[var(--color-bg-input)] border-b border-[var(--color-border)] flex items-center gap-2 shrink-0">
          <span className="text-xs text-[var(--color-text-disabled)] font-bold">REPLAY:</span>
          <span className="text-xs font-black text-[var(--color-accent)] uppercase tracking-tight">{recordName}</span>
          <span className="text-[10px] text-[var(--color-text-disabled)] font-bold bg-[var(--color-bg-primary)] px-2 py-0.5 rounded-full border border-[var(--color-border)]">
            {signals.length} TRADES
          </span>
        </div>
      )}
      <div className="relative w-full flex-1 min-h-0">
        <div ref={chartRef} className="w-full h-full" />
        {tooltip && (
          <div className="absolute top-2 left-2 z-10 pointer-events-none select-none flex items-center gap-3 px-2 py-1 rounded text-[11px] font-mono"
            style={{ background: 'rgba(13,17,23,0.85)', border: '1px solid #30363d' }}>
            <span className="text-[#8b949e]">{tooltip.time}</span>
            <span className="text-[#8b949e]">O <span style={{ color: changeColor }}>{tooltip.open.toFixed(2)}</span></span>
            <span className="text-[#8b949e]">H <span className="text-[#3fb68b]">{tooltip.high.toFixed(2)}</span></span>
            <span className="text-[#8b949e]">L <span className="text-[#ff6838]">{tooltip.low.toFixed(2)}</span></span>
            <span className="text-[#8b949e]">C <span style={{ color: changeColor }}>{tooltip.close.toFixed(2)}</span></span>
            <span style={{ color: changeColor }}>
              {tooltip.change >= 0 ? '+' : ''}{tooltip.change.toFixed(2)} ({tooltip.changePct >= 0 ? '+' : ''}{tooltip.changePct.toFixed(2)}%)
            </span>
            <span className="text-[#8b949e]">振幅 <span className="text-white">{tooltip.amplitude.toFixed(2)}%</span></span>
          </div>
        )}
      </div>
      {hasSubIndicators && (
        <div ref={subChartRef} className="w-full shrink-0 border-t border-[var(--color-border)]" style={{ height: 150 }} />
      )}
    </div>
  )
}
