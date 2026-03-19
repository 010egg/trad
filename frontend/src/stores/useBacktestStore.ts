import { create } from 'zustand'
import api from '@/lib/api'

export interface BacktestRecord {
  id: string
  name: string
  symbol: string
  interval: string
  start_date: string
  end_date: string
  leverage: number
  stop_loss_pct: number
  take_profit_pct: number
  risk_per_trade: number
  total_return: number
  win_rate: number
  profit_factor: number
  max_drawdown: number
  sharpe_ratio: number
  total_trades: number
  avg_holding_hours: number
  created_at: string
}

export interface BacktestRecordDetail extends BacktestRecord {
  entry_conditions: string
  exit_conditions: string
  trades: string
}

interface BacktestState {
  records: BacktestRecord[]
  fetchRecords: () => Promise<void>
  deleteRecord: (id: string) => Promise<void>
  updateRecord: (id: string, data: { name: string }) => Promise<void>
  getRecord: (id: string) => Promise<BacktestRecordDetail>
}

export const useBacktestStore = create<BacktestState>((set) => ({
  records: [],

  fetchRecords: async () => {
    const records: BacktestRecord[] = await api.get('/backtest/records')
    set({ records })
  },

  deleteRecord: async (id) => {
    await api.delete(`/backtest/records/${id}`)
    set((state) => ({ records: state.records.filter((r) => r.id !== id) }))
  },

  updateRecord: async (id, data) => {
    await api.put(`/backtest/records/${id}`, data)
    set((state) => ({
      records: state.records.map((r) => (r.id === id ? { ...r, ...data } : r)),
    }))
  },

  getRecord: async (id) => {
    return api.get(`/backtest/records/${id}`)
  },
}))
