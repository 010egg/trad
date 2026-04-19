import type { IntelItem } from '@/stores/useIntelStore'

export interface IntelCardAiActionHandlers {
  openAiDialog: (item: IntelItem) => void
  refreshItem: (itemId: string) => Promise<IntelItem | null>
  selectItem: (itemId: string | null) => void
  setRefreshingItemId: (itemId: string | null) => void
}

export async function triggerIntelCardAiAction(
  item: IntelItem,
  handlers: IntelCardAiActionHandlers,
) {
  handlers.openAiDialog(item)
  handlers.setRefreshingItemId(item.id)
  try {
    const nextItem = await handlers.refreshItem(item.id)
    if (nextItem) {
      handlers.selectItem(nextItem.id)
    }
  } finally {
    handlers.setRefreshingItemId(null)
  }
}
