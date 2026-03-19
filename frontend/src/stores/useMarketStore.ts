import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import api from '@/lib/api'

export interface Kline {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface MarketState {
  symbol: string
  interval: string
  klines: Kline[]
  latestKline: Kline | null
  symbols: { symbol: string; base_asset: string; quote_asset: string }[]
  loading: boolean
  error: string | null
  setSymbol: (s: string) => void
  setInterval: (i: string) => void
  fetchKlines: (symbol?: string, interval?: string) => Promise<void>
  syncLatestKlines: (symbol?: string, interval?: string) => Promise<void>
  fetchSymbols: () => Promise<void>
  updateKline: (kline: Kline, symbol?: string) => void
}

export function mergeLatestKlines(prev: Kline[], incoming: Kline[]): Kline[] {
  if (incoming.length === 0) return prev
  if (prev.length === 0) return incoming

  const next = [...prev]
  for (const kline of incoming) {
    const lastIdx = next.length - 1
    const last = next[lastIdx]

    if (kline.time > last.time) {
      next.push(kline)
    } else if (kline.time === last.time) {
      next[lastIdx] = kline
    } else {
      // 处理回填或乱序（极少见）
      const idx = next.findIndex((item) => item.time === kline.time)
      if (idx >= 0) {
        next[idx] = kline
      } else {
        next.push(kline)
        next.sort((a, b) => a.time - b.time)
      }
    }
  }

  return next.slice(-1000)
}

export const useMarketStore = create<MarketState>()(subscribeWithSelector((set, get) => ({
  symbol: 'BTCUSDT',
  interval: '15m',
  klines: [],
  latestKline: null,
  symbols: [],
  loading: false,
  error: null,

  setSymbol: (s) => set({ symbol: s }),
  setInterval: (i) => set({ interval: i }),

  fetchKlines: async (symbolParam?: string, intervalParam?: string) => {
    try {
      const state = get()
      const symbol = symbolParam || state.symbol
      const interval = intervalParam || state.interval

      set({ loading: true, error: null })
      const klines: Kline[] = await api.get('/market/klines', { params: { symbol, interval, limit: 1000 } })

      set({
        symbol,
        interval,
        klines: klines || [],
        latestKline: klines?.[klines.length - 1] || null,
        loading: false,
      })
    } catch (error) {
      console.error('Failed to fetch klines:', error)
      set({ loading: false, error: '加载行情失败，请稍后重试' })
    }
  },

  syncLatestKlines: async (symbolParam?: string, intervalParam?: string) => {
    try {
      const state = get()
      const symbol = symbolParam || state.symbol
      const interval = intervalParam || state.interval
      const incoming: Kline[] = await api.get('/market/klines', { params: { symbol, interval, limit: 2 } })

      set((current) => {
        if (current.symbol !== symbol || current.interval !== interval) return current
        const nextKlines = mergeLatestKlines(current.klines, incoming)
        return {
          klines: nextKlines,
          latestKline: nextKlines[nextKlines.length - 1] || null,
        }
      })
    } catch (error) {
      console.error('Failed to sync latest klines:', error)
    }
  },

  fetchSymbols: async () => {
    try {
      set({ loading: true, error: null })
      const symbols: MarketState['symbols'] = await api.get('/market/symbols')
      set({ symbols, loading: false })
    } catch (err: any) {
      set({ error: err.response?.data?.detail || '获取交易对失败', loading: false })
    }
  },

  updateKline: (kline: Kline, symbol?: string) => {
    const state = get()
    if (symbol && symbol !== state.symbol) return

    const prev = state.klines
    if (prev.length === 0) {
      set({ klines: [kline], latestKline: kline })
      return
    }

    const lastIdx = prev.length - 1
    const last = prev[lastIdx]

    if (kline.time === last.time) {
      const nextKlines = [...prev]
      nextKlines[lastIdx] = kline
      set({ klines: nextKlines, latestKline: kline })
    } else if (kline.time > last.time) {
      set({ klines: [...prev, kline], latestKline: kline })
    }
  },
})))
