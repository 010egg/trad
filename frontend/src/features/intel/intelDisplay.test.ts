import { describe, expect, it } from 'vitest'
import { getIntelDisplayContent, getIntelDisplayTitle } from '@/features/intel/intelDisplay'
import type { IntelItem } from '@/stores/useIntelStore'

function createIntelItem(overrides: Partial<IntelItem> = {}): IntelItem {
  return {
    id: 'intel-1',
    source_type: 'external',
    source_name: 'CoinDesk',
    title: 'Original English title',
    ai_title: 'AI 中文标题',
    display_title: 'AI 中文标题',
    source_url: 'https://example.com/intel-1',
    summary_ai: 'AI 中文摘要',
    display_content: 'AI 中文摘要',
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
    ...overrides,
  }
}

describe('intelDisplay', () => {
  it('prefers backend AI-first display fields when present', () => {
    const item = createIntelItem()

    expect(getIntelDisplayTitle(item)).toBe('AI 中文标题')
    expect(getIntelDisplayContent(item)).toBe('AI 中文摘要')
  })

  it('falls back to ai_title and summary_ai for older payloads', () => {
    const item = createIntelItem({
      display_title: '',
      display_content: '',
    })

    expect(getIntelDisplayTitle(item)).toBe('AI 中文标题')
    expect(getIntelDisplayContent(item)).toBe('AI 中文摘要')
  })

  it('falls back to original title when no AI content exists', () => {
    const item = createIntelItem({
      ai_title: '',
      display_title: '',
      summary_ai: '',
      display_content: '',
    })

    expect(getIntelDisplayTitle(item)).toBe('Original English title')
    expect(getIntelDisplayContent(item)).toBe('Original English title')
  })
})
