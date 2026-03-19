import { create } from 'zustand'
import api from '@/lib/api'

let positionsRequest: Promise<void> | null = null

interface Position {
  symbol: string
  side: string
  quantity: number
  entry_price: number
  current_price: number
  price_change_pct: number
  unrealized_pnl: number
  order_id: string | null
  trade_mode?: string  // SIMULATED / LIVE
}

interface Order {
  id: string
  symbol: string
  side: string
  position_side: string
  order_type: string
  quantity: number
  price: number | null
  stop_loss: number
  take_profit: number | null
  trade_reason: string
  status: string
}

interface AccountState {
  positions: Position[]
  orders: Order[]
  loading: boolean
  error: string | null
  positionsLoading: boolean
  positionsLoaded: boolean
  positionsError: string | null
  fetchPositions: () => Promise<void>
  fetchOrders: () => Promise<void>
  createOrder: (params: any) => Promise<any>
  closePosition: (orderId: string) => Promise<void>
}

export const useAccountStore = create<AccountState>((set) => ({
  positions: [],
  orders: [],
  loading: false,
  error: null,
  positionsLoading: false,
  positionsLoaded: false,
  positionsError: null,

  fetchPositions: async () => {
    if (positionsRequest) {
      return positionsRequest
    }

    positionsRequest = (async () => {
      try {
        set({ loading: true, error: null, positionsLoading: true, positionsError: null })
        const positions: Position[] = await api.get('/trade/positions')
        set({
          positions,
          loading: false,
          positionsLoading: false,
          positionsLoaded: true,
          positionsError: null,
        })
      } catch (err: any) {
        const message = err.response?.data?.detail || 'Failed to fetch positions'
        set({
          error: message,
          loading: false,
          positionsLoading: false,
          positionsLoaded: true,
          positionsError: message,
        })
      } finally {
        positionsRequest = null
      }
    })()

    return positionsRequest
  },

  fetchOrders: async () => {
    try {
      set({ loading: true, error: null })
      const orders: Order[] = await api.get('/trade/orders')
      set({ orders, loading: false })
    } catch (err: any) {
      set({ error: err.response?.data?.detail || 'Failed to fetch orders', loading: false })
    }
  },

  createOrder: async (params) => {
    try {
      set({ loading: true, error: null })
      const order = await api.post('/trade/orders', params)
      set({ loading: false })
      return order
    } catch (err: any) {
      set({ error: err.response?.data?.detail || 'Failed to create order', loading: false })
      throw err
    }
  },

  closePosition: async (orderId) => {
    try {
      set({ loading: true, error: null })
      await api.post(`/trade/positions/${orderId}/close`)
      set({ loading: false })
    } catch (err: any) {
      set({ error: err.response?.data?.detail || 'Failed to close position', loading: false })
      throw err
    }
  },
}))
