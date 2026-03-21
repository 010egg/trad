import { create } from 'zustand'
import type { IntelItem } from '@/stores/useIntelStore'

interface IntelAiState {
  open: boolean
  item: IntelItem | null
  toggle: () => void
  close: () => void
  openWithItem: (item: IntelItem) => void
  setItem: (item: IntelItem | null) => void
}

export const useIntelAiStore = create<IntelAiState>((set) => ({
  open: false,
  item: null,
  toggle: () => set((state) => ({ open: !state.open })),
  close: () => set({ open: false }),
  openWithItem: (item) => set({ item, open: true }),
  setItem: (item) => set({ item }),
}))
