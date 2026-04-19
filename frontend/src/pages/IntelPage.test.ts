import { describe, expect, it, vi } from 'vitest'
import { triggerIntelCardAiAction, type IntelCardAiActionHandlers } from '@/features/intel/intelCardAiAction'
import type { IntelItem } from '@/stores/useIntelStore'

function createIntelItem(): IntelItem {
  return {
    id: 'intel-1',
    source_type: 'external',
    source_name: 'CoinDesk',
    title: 'Original English title',
    ai_title: '原始中文标题',
    source_url: 'https://example.com/intel-1',
    summary_ai: 'summary',
    signal: 'BULLISH',
    confidence: 0.8,
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

describe('triggerIntelCardAiAction', () => {
  it('opens the AI dialog and refreshes the item in one click', async () => {
    const item = createIntelItem()
    const refreshedItem = { ...item, ai_title: '刷新后的中文标题' }
    const sequence: string[] = []

    const handlers: IntelCardAiActionHandlers = {
      openAiDialog: (nextItem) => {
        sequence.push(`open:${nextItem.id}`)
      },
      refreshItem: async (itemId) => {
        sequence.push(`refresh:${itemId}`)
        return refreshedItem
      },
      selectItem: (itemId) => {
        sequence.push(`select:${itemId}`)
      },
      setRefreshingItemId: (itemId) => {
        sequence.push(`loading:${itemId ?? 'null'}`)
      },
    }

    await triggerIntelCardAiAction(item, handlers)

    expect(sequence).toEqual([
      'open:intel-1',
      'loading:intel-1',
      'refresh:intel-1',
      'select:intel-1',
      'loading:null',
    ])
  })

  it('still clears loading state when refresh fails', async () => {
    const item = createIntelItem()
    const handlers: IntelCardAiActionHandlers = {
      openAiDialog: vi.fn(),
      refreshItem: vi.fn().mockRejectedValue(new Error('boom')),
      selectItem: vi.fn(),
      setRefreshingItemId: vi.fn(),
    }

    await expect(triggerIntelCardAiAction(item, handlers)).rejects.toThrow('boom')

    expect(handlers.openAiDialog).toHaveBeenCalledWith(item)
    expect(handlers.setRefreshingItemId).toHaveBeenNthCalledWith(1, item.id)
    expect(handlers.setRefreshingItemId).toHaveBeenLastCalledWith(null)
    expect(handlers.selectItem).not.toHaveBeenCalled()
  })
})
