import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import api from '@/lib/api'
import { useIntelStore, type IntelItem } from '@/stores/useIntelStore'

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

const mockedApiGet = api.get as Mock

function createItem(id: string, aiTitle: string): IntelItem {
  return {
    id,
    source_type: 'external',
    source_name: 'CoinDesk',
    title: `${id}-title`,
    ai_title: aiTitle,
    display_title: aiTitle,
    source_url: `https://example.com/${id}`,
    summary_ai: 'summary',
    display_content: 'summary',
    signal: 'BULLISH',
    confidence: 0.9,
    source_score: 0.8,
    freshness_score: 0.8,
    semantic_score: 0.8,
    confirmation_count: 1,
    reasoning: 'reasoning',
    category: 'macro',
    published_at: '2026-04-19T00:00:00Z',
    ingested_at: '2026-04-19T00:01:00Z',
    symbols: ['BTCUSDT'],
  }
}

function resetIntelStore() {
  useIntelStore.setState({
    feed: [],
    selectedId: null,
    filters: {
      symbol: 'ALL',
      category: 'ALL',
      signal: 'ALL',
      q: '',
      min_confidence: 0,
    },
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
  })
}

describe('useIntelStore.fetchFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetIntelStore()
  })

  it('ignores stale feed responses from earlier requests', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined
    let resolveSecond: ((value: unknown) => void) | undefined

    mockedApiGet
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSecond = resolve
      }))

    const first = useIntelStore.getState().fetchFeed({
      reset: true,
      filters: { q: 'first' },
    })
    const second = useIntelStore.getState().fetchFeed({
      reset: true,
      filters: { q: 'second' },
    })

    resolveSecond?.({
      items: [createItem('intel-2', '第二次请求')],
      next_cursor: null,
      stale: false,
      last_refreshed_at: '2026-04-20T00:00:00Z',
    })
    await second

    resolveFirst?.({
      items: [createItem('intel-1', '第一次请求')],
      next_cursor: null,
      stale: false,
      last_refreshed_at: '2026-04-19T00:00:00Z',
    })
    await first

    expect(useIntelStore.getState().feed.map((item) => item.id)).toEqual(['intel-2'])
    expect(useIntelStore.getState().filters.q).toBe('second')
    expect(useIntelStore.getState().lastRefreshedAt).toBe('2026-04-20T00:00:00Z')
  })

  it('aborts the previous feed request when a newer request starts', async () => {
    const requestConfigs: { signal?: AbortSignal }[] = []

    mockedApiGet
      .mockImplementationOnce((_url, config) => {
        requestConfigs.push(config as { signal?: AbortSignal })
        return new Promise(() => undefined)
      })
      .mockResolvedValueOnce({
        items: [createItem('intel-2', '第二次请求')],
        next_cursor: null,
        stale: false,
        last_refreshed_at: '2026-04-20T00:00:00Z',
      })

    void useIntelStore.getState().fetchFeed({
      reset: true,
      filters: { q: 'first' },
    })

    expect(requestConfigs[0]?.signal?.aborted).toBe(false)

    await useIntelStore.getState().fetchFeed({
      reset: true,
      filters: { q: 'second' },
    })

    expect(requestConfigs[0]?.signal?.aborted).toBe(true)
  })

  it('stores total count and today signal stats from the feed payload', async () => {
    mockedApiGet.mockResolvedValueOnce({
      items: [createItem('intel-1', '第一条')],
      next_cursor: null,
      total_count: 37,
      today_signal_stats: {
        date: '2026-04-22',
        total_count: 12,
        bullish_count: 5,
        bearish_count: 4,
        neutral_count: 3,
        bullish_ratio: 5 / 12,
        bearish_ratio: 4 / 12,
        neutral_ratio: 3 / 12,
      },
      stale: false,
      last_refreshed_at: '2026-04-22T00:00:00Z',
    })

    await useIntelStore.getState().fetchFeed({ reset: true })

    expect(useIntelStore.getState().totalCount).toBe(37)
    expect(useIntelStore.getState().todaySignalStats).toEqual({
      date: '2026-04-22',
      total_count: 12,
      bullish_count: 5,
      bearish_count: 4,
      neutral_count: 3,
      bullish_ratio: 5 / 12,
      bearish_ratio: 4 / 12,
      neutral_ratio: 3 / 12,
    })
  })
})
