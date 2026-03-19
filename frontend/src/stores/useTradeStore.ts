import { create } from 'zustand'
import api from '@/lib/api'

interface TradeSettings {
  trade_mode: string  // SIMULATED / LIVE
  default_market: string  // SPOT / FUTURES
  default_leverage: number
}

interface TradeState {
  settings: TradeSettings | null
  balance: number
  balanceMode: string
  balanceMarket: string
  loading: boolean
  error: string | null
  fetchSettings: () => Promise<void>
  updateSettings: (updates: Partial<TradeSettings>) => Promise<void>
  fetchBalance: () => Promise<void>
}

export const useTradeStore = create<TradeState>((set) => ({
  settings: null,
  balance: 10000,
  balanceMode: 'SIMULATED',
  balanceMarket: 'SPOT',
  loading: false,
  error: null,

  fetchSettings: async () => {
    try {
      set({ loading: true, error: null })
      const settings: TradeSettings = await api.get('/trade/settings')
      set({ settings, loading: false })
    } catch (err: any) {
      set({ error: err.response?.data?.detail || 'Failed to fetch settings', loading: false })
    }
  },

  updateSettings: async (updates) => {
    try {
      set({ loading: true, error: null })
      const settings: TradeSettings = await api.put('/trade/settings', updates)
      set({ settings, loading: false })
      // 如果交易模式改变，重新获取余额
      if (updates.trade_mode !== undefined || updates.default_market !== undefined) {
        const balance: { balance: number; mode: string; market: string } = await api.get('/account/balance')
        set({
          balance: balance.balance,
          balanceMode: balance.mode,
          balanceMarket: balance.market,
        })
      }
    } catch (err: any) {
      set({ error: err.response?.data?.detail || 'Failed to update settings', loading: false })
      throw err
    }
  },

  fetchBalance: async () => {
    try {
      set({ loading: true, error: null })
      const balance: { balance: number; mode: string; market: string } = await api.get('/account/balance')
      set({
        balance: balance.balance,
        balanceMode: balance.mode,
        balanceMarket: balance.market,
        loading: false,
      })
    } catch (err: any) {
      set({ error: err.response?.data?.detail || 'Failed to fetch balance', loading: false })
    }
  },
}))
