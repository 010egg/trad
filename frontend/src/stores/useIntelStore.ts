import { create } from 'zustand'
import api from '@/lib/api'

export type IntelSignal = 'BULLISH' | 'BEARISH' | 'NEUTRAL'
export type IntelCategory = 'macro' | 'onchain' | 'exchange' | 'regulation' | 'project'

export interface IntelItem {
  id: string
  source_type: string
  source_name: string
  title: string
  ai_title: string
  display_title?: string
  source_url: string
  summary_ai: string
  display_content?: string
  signal: IntelSignal
  confidence: number
  source_score: number
  freshness_score: number
  semantic_score: number
  confirmation_count: number
  reasoning: string
  category: IntelCategory
  published_at: string
  ingested_at: string
  symbols: string[]
}

export interface IntelFilters {
  symbol: string
  category: string
  signal: string
  q: string
  min_confidence: number
}

export interface IntelTodaySignalStats {
  date: string
  total_count: number
  bullish_count: number
  bearish_count: number
  neutral_count: number
  bullish_ratio: number
  bearish_ratio: number
  neutral_ratio: number
}

interface IntelFilterOptions {
  symbols: string[]
  categories: string[]
  signals: string[]
}

interface IntelFeedPayload {
  items: IntelItem[]
  next_cursor: string | null
  total_count: number
  today_signal_stats: IntelTodaySignalStats
  stale: boolean
  last_refreshed_at: string | null
}

interface IntelRefreshPayload {
  fetched: number
  created: number
  updated: number
  last_refreshed_at: string | null
  queued: boolean
}

interface IntelState {
  feed: IntelItem[]
  selectedId: string | null
  filters: IntelFilters
  filterOptions: IntelFilterOptions
  nextCursor: string | null
  totalCount: number
  todaySignalStats: IntelTodaySignalStats | null
  stale: boolean
  lastRefreshedAt: string | null
  loading: boolean
  loadingMore: boolean
  refreshing: boolean
  error: string | null
  selectItem: (id: string | null) => void
  fetchFilters: () => Promise<void>
  fetchFeed: (options?: { reset?: boolean; filters?: Partial<IntelFilters> }) => Promise<void>
  refreshFeed: () => Promise<void>
  refreshItem: (itemId: string) => Promise<IntelItem | null>
}

const DEFAULT_FILTERS: IntelFilters = {
  symbol: 'ALL',
  category: 'ALL',
  signal: 'ALL',
  q: '',
  min_confidence: 0,
}

function buildParams(filters: IntelFilters, cursor: string | null) {
  const params: Record<string, string | number> = { limit: 20 }
  if (cursor) params.cursor = cursor
  if (filters.symbol !== 'ALL') params.symbol = filters.symbol
  if (filters.category !== 'ALL') params.category = filters.category
  if (filters.signal !== 'ALL') params.signal = filters.signal
  if (filters.q.trim()) params.q = filters.q.trim()
  if (filters.min_confidence > 0) params.min_confidence = filters.min_confidence
  return params
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

let latestFeedRequestId = 0
let feedAbortController: AbortController | null = null

export const useIntelStore = create<IntelState>((set, get) => ({
  feed: [],
  selectedId: null,
  filters: DEFAULT_FILTERS,
  filterOptions: {
    symbols: [],
    categories: [],
    signals: [],
  },
  nextCursor: null,
  totalCount: 0,
  todaySignalStats: null,
  stale: false,
  lastRefreshedAt: null,
  loading: false,
  loadingMore: false,
  refreshing: false,
  error: null,

  selectItem: (id) => set({ selectedId: id }),

  fetchFilters: async () => {
    try {
      const data: IntelFilterOptions = await api.get('/intel/filters')
      set({
        filterOptions: {
          symbols: data.symbols || [],
          categories: data.categories || [],
          signals: data.signals || [],
        },
      })
    } catch (error) {
      console.error('Failed to fetch intel filters:', error)
    }
  },

  fetchFeed: async (options) => {
    const state = get()
    const reset = options?.reset ?? true
    const requestId = ++latestFeedRequestId
    feedAbortController?.abort()
    const abortController = new AbortController()
    feedAbortController = abortController
    const nextFilters = {
      ...state.filters,
      ...(options?.filters || {}),
    }

    try {
      set({
        filters: nextFilters,
        loading: reset,
        loadingMore: !reset,
        error: null,
      })

      const data: IntelFeedPayload = await api.get('/intel/feed', {
        params: buildParams(nextFilters, reset ? null : state.nextCursor),
        signal: abortController.signal,
      })

      if (requestId !== latestFeedRequestId) {
        return
      }

      set((current) => {
        const nextFeed = reset ? data.items || [] : [...current.feed, ...(data.items || [])]
        const hasSelected = current.selectedId && nextFeed.some((item) => item.id === current.selectedId)
        return {
          feed: nextFeed,
          nextCursor: data.next_cursor || null,
          totalCount: data.total_count || 0,
          todaySignalStats: data.today_signal_stats || null,
          stale: !!data.stale,
          lastRefreshedAt: data.last_refreshed_at || null,
          loading: false,
          loadingMore: false,
          selectedId: hasSelected ? current.selectedId : nextFeed[0]?.id || null,
        }
      })
    } catch (error) {
      if (requestId !== latestFeedRequestId) {
        return
      }

      console.error('Failed to fetch intel feed:', error)
      set({
        loading: false,
        loadingMore: false,
        error: '加载情报失败，请稍后重试',
      })
    } finally {
      if (requestId === latestFeedRequestId) {
        feedAbortController = null
      }
    }
  },

  refreshFeed: async () => {
    try {
      set({ refreshing: true, error: null })
      const previousRefreshedAt = get().lastRefreshedAt
      const result: IntelRefreshPayload = await api.post('/intel/refresh')

      await get().fetchFeed({ reset: true })

      if (result.queued) {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const state = get()
          if (!state.stale && state.lastRefreshedAt && state.lastRefreshedAt !== previousRefreshedAt) {
            break
          }
          await sleep(1500)
          await get().fetchFeed({ reset: true })
        }
      }
    } catch (error) {
      console.error('Failed to refresh intel feed:', error)
      const detail = (error as any)?.response?.data?.detail || (error as any)?.message || '刷新情报失败，请稍后重试'
      set({ error: detail })
    } finally {
      set({ refreshing: false })
    }
  },

  refreshItem: async (itemId) => {
    try {
      set({ error: null })
      const item: IntelItem = await api.post(`/intel/${itemId}/refresh`)

      set((current) => ({
        feed: current.feed.map((entry) => (entry.id === itemId ? item : entry)),
        lastRefreshedAt: item.ingested_at || current.lastRefreshedAt,
      }))

      return item
    } catch (error) {
      console.error('Failed to refresh intel item:', error)
      const detail = (error as any)?.response?.data?.detail || (error as any)?.message || '刷新单条情报失败，请稍后重试'
      set({ error: detail })
      return null
    }
  },
}))
