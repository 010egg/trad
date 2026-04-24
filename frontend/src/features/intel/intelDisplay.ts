import type { IntelItem } from '@/stores/useIntelStore'

function normalize(value?: string) {
  return (value || '').trim()
}

export function getIntelDisplayTitle(item: Pick<IntelItem, 'display_title' | 'ai_title' | 'title'>) {
  return normalize(item.display_title) || normalize(item.ai_title) || normalize(item.title)
}

export function getIntelDisplayContent(
  item: Pick<IntelItem, 'display_content' | 'summary_ai' | 'display_title' | 'ai_title' | 'title'>,
) {
  return normalize(item.display_content) || normalize(item.summary_ai) || getIntelDisplayTitle(item)
}
