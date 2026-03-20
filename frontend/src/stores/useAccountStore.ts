import { create } from 'zustand'
import api from '@/lib/api'

let positionsRequest: Promise<void> | null = null
let positionsRequestSeq = 0

interface FetchPositionsOptions {
  background?: boolean
  force?: boolean
}

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
  fetchPositions: (options?: FetchPositionsOptions) => Promise<void>
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

  fetchPositions: async (options = {}) => {
    const { background = false, force = false } = options
    if (positionsRequest && !force) {
      return positionsRequest
    }

    const requestSeq = ++positionsRequestSeq
    let request: Promise<void> | null = null
    request = (async () => {
      try {
        if (background) {
          set({ positionsError: null })
        } else {
          set({ loading: true, error: null, positionsLoading: true, positionsError: null })
        }

        const positions: Position[] = await api.get('/trade/positions')
        if (requestSeq !== positionsRequestSeq) {
          return
        }
        set((state) => ({
          positions,
          loading: background ? state.loading : false,
          error: background ? state.error : null,
          positionsLoading: false,
          positionsLoaded: true,
          positionsError: null,
        }))
      } catch (err: any) {
        const message = err.response?.data?.detail || 'Failed to fetch positions'
        if (requestSeq !== positionsRequestSeq) {
          return
        }
        set((state) => ({
          error: background ? state.error : message,
          loading: background ? state.loading : false,
          positionsLoading: false,
          positionsLoaded: true,
          positionsError: message,
        }))
      } finally {
        if (positionsRequest === request) {
          positionsRequest = null
        }
      }
    })()

    positionsRequest = request
    return request
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
