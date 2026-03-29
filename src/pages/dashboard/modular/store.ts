// ─── Dashboard Layout Store ───────────────────────────────────────────────────
// Zustand store with dual persistence:
//   1. localStorage  → instant restore on page load (no flicker)
//   2. Firestore     → cross-device / post-logout sync (authoritative)
//
// Write strategy:
//   Every state change → localStorage immediately (via zustand/persist)
//   Every state change → Firestore debounced 1 500 ms (avoid write spam)
//
// Read strategy (priority order):
//   1. Firestore (loaded async on mount via initFromFirestore())
//   2. localStorage fallback (already hydrated by zustand/persist)
//   3. Default preset

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  LayoutItem, PresetName, WidgetId, WidgetSize,
  DASHBOARD_PRESETS, WIDGET_REGISTRY,
} from './types'
import {
  saveDashboardLayout,
  loadDashboardLayout,
} from '@/services/firestore/dashboardLayout'

const STORAGE_KEY = 'trademindset:dashboard:v2'

// ── Debounce helper ───────────────────────────────────────────────────────────
let firestoreDebounceTimer: ReturnType<typeof setTimeout> | null = null
function debouncedFirestoreSave(layout: LayoutItem[], activePreset: PresetName, symbol: string) {
  if (firestoreDebounceTimer) clearTimeout(firestoreDebounceTimer)
  firestoreDebounceTimer = setTimeout(() => {
    saveDashboardLayout({ layout, activePreset, symbol, updatedAt: Date.now() })
  }, 1500)
}

// ── Store interface ───────────────────────────────────────────────────────────
interface DashboardStore {
  layout: LayoutItem[]
  activePreset: PresetName
  editMode: boolean
  symbol: string
  firestoreReady: boolean   // true once Firestore hydration attempt completes

  // Actions
  setLayout: (layout: LayoutItem[]) => void
  loadPreset: (preset: PresetName) => void
  toggleWidget: (id: string) => void
  resizeWidget: (id: string, size: WidgetSize) => void
  addWidget: (widgetId: WidgetId) => void
  removeWidget: (id: string) => void
  setEditMode: (val: boolean) => void
  setSymbol: (symbol: string) => void
  resetLayout: () => void

  // Firestore hydration (called once on mount when user is authenticated)
  initFromFirestore: () => Promise<void>
}

function buildLayoutFromPreset(preset: PresetName): LayoutItem[] {
  return DASHBOARD_PRESETS[preset].layout.map((item, index) => ({ ...item, order: index }))
}

function persist_and_sync(
  get: () => DashboardStore,
  partial: Partial<Pick<DashboardStore, 'layout' | 'activePreset' | 'symbol'>>
) {
  const { layout, activePreset, symbol } = { ...get(), ...partial }
  debouncedFirestoreSave(layout, activePreset, symbol)
}

export const useDashboardStore = create<DashboardStore>()(
  persist(
    (set, get) => ({
      layout: buildLayoutFromPreset('custom'),
      activePreset: 'custom',
      editMode: false,
      symbol: 'BTCUSDT',
      firestoreReady: false,

      setLayout: (layout) => {
        set({ layout })
        persist_and_sync(get, { layout })
      },

      loadPreset: (preset) => {
        const layout = buildLayoutFromPreset(preset)
        set({ layout, activePreset: preset })
        persist_and_sync(get, { layout, activePreset: preset })
      },

      toggleWidget: (id) => {
        const layout = get().layout.map(item =>
          item.id === id ? { ...item, visible: !item.visible } : item
        )
        set({ layout })
        persist_and_sync(get, { layout })
      },

      resizeWidget: (id, size) => {
        const layout = get().layout.map(item =>
          item.id === id ? { ...item, size } : item
        )
        set({ layout, activePreset: 'custom' })
        persist_and_sync(get, { layout, activePreset: 'custom' })
      },

      addWidget: (widgetId) => {
        const cfg = WIDGET_REGISTRY[widgetId]
        const existing = get().layout.filter(i => i.widgetId === widgetId)
        const newId = existing.length > 0 ? `${widgetId}_${existing.length + 1}` : widgetId
        const layout = [
          ...get().layout,
          { id: newId, widgetId, size: cfg.defaultSize, visible: true, order: get().layout.length },
        ]
        set({ layout, activePreset: 'custom' })
        persist_and_sync(get, { layout, activePreset: 'custom' })
      },

      removeWidget: (id) => {
        const layout = get().layout
          .filter(i => i.id !== id)
          .map((item, idx) => ({ ...item, order: idx }))
        set({ layout, activePreset: 'custom' })
        persist_and_sync(get, { layout, activePreset: 'custom' })
      },

      setEditMode: (val) => set({ editMode: val }),

      setSymbol: (symbol) => {
        set({ symbol })
        persist_and_sync(get, { symbol })
      },

      resetLayout: () => {
        const layout = buildLayoutFromPreset('custom')
        set({ layout, activePreset: 'custom' })
        persist_and_sync(get, { layout, activePreset: 'custom' })
      },

      // ── Firestore hydration ──────────────────────────────────────────────
      // Called once from the dashboard component after auth resolves.
      // Firestore is authoritative: if updatedAt is more recent than what we
      // loaded from localStorage, we overwrite. Otherwise we keep localStorage.
      initFromFirestore: async () => {
        try {
          const remote = await loadDashboardLayout()
          if (remote && remote.layout?.length > 0) {
            set({
              layout: remote.layout,
              activePreset: remote.activePreset ?? 'custom',
              symbol: remote.symbol ?? get().symbol,
            })
          }
        } catch (err) {
          console.warn('[DashboardStore] Firestore init failed, keeping localStorage:', err)
        } finally {
          set({ firestoreReady: true })
        }
      },
    }),
    {
      name: STORAGE_KEY,
      // Only persist layout-relevant fields, not editMode or firestoreReady
      partialize: (state) => ({
        layout: state.layout,
        activePreset: state.activePreset,
        symbol: state.symbol,
      }),
    }
  )
)
