import { create } from 'zustand'
import api from '@/lib/api'

interface RiskConfig {
  max_loss_per_trade: number
  max_daily_loss: number
  require_stop_loss: boolean
  require_trade_reason: boolean
  require_take_profit: boolean
  max_open_positions: number
  max_leverage: number
}

interface RiskStatus {
  daily_loss_current: number
  daily_loss_percent: number
  daily_loss_limit: number
  is_locked: boolean
  open_positions_count: number
  trade_count_today: number
}

interface RiskState {
  config: RiskConfig | null
  status: RiskStatus | null
  loading: boolean
  error: string | null
  fetchConfig: () => Promise<void>
  updateConfig: (updates: Partial<RiskConfig>) => Promise<void>
  fetchStatus: () => Promise<void>
  checkRisk: (params: any) => Promise<any>
}

export const useRiskStore = create<RiskState>((set) => ({
  config: null,
  status: null,
  loading: false,
  error: null,

  fetchConfig: async () => {
    try {
      set({ loading: true, error: null })
      const config: RiskConfig = await api.get('/risk/config')
      set({ config, loading: false })
    } catch (err: any) {
      set({ error: err.response?.data?.detail || 'Failed to fetch risk config', loading: false })
    }
  },

  updateConfig: async (updates) => {
    try {
      set({ loading: true, error: null })
      const config: RiskConfig = await api.put('/risk/config', updates)
      set({ config, loading: false })
    } catch (err: any) {
      set({ error: err.response?.data?.detail || 'Failed to update risk config', loading: false })
      throw err
    }
  },

  fetchStatus: async () => {
    try {
      set({ loading: true, error: null })
      const status: RiskStatus = await api.get('/risk/status')
      set({ status, loading: false })
    } catch (err: any) {
      set({ error: err.response?.data?.detail || 'Failed to fetch risk status', loading: false })
    }
  },

  checkRisk: async (params) => {
    return api.post('/risk/check', params)
  },
}))
