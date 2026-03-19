import { create } from 'zustand'

export interface TradeSignal {
  entry_time: string
  exit_time: string
  side: string  // 'LONG' | 'SHORT'
  entry_price: number
  exit_price: number
  pnl: number
  pnl_pct: number
}

interface BacktestSignalState {
  signals: TradeSignal[]
  recordId: string | null
  recordName: string | null
  symbol: string | null
  interval: string | null
  setSignals: (signals: TradeSignal[], recordId: string, recordName: string, symbol: string, interval: string) => void
  clearSignals: () => void
}

export const useBacktestSignalStore = create<BacktestSignalState>((set) => ({
  signals: [],
  recordId: null,
  recordName: null,
  symbol: null,
  interval: null,
  setSignals: (signals, recordId, recordName, symbol, interval) =>
    set({ signals, recordId, recordName, symbol, interval }),
  clearSignals: () =>
    set({ signals: [], recordId: null, recordName: null, symbol: null, interval: null }),
}))
