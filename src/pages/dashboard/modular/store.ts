// ─── Dashboard Layout Store v2 ────────────────────────────────────────────────
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { LayoutItem, PresetName, WidgetId, DASHBOARD_PRESETS, WIDGET_REGISTRY } from './types'
import { saveDashboardLayout, loadDashboardLayout } from '@/services/firestore/dashboardLayout'

const STORAGE_KEY = 'trademindset:dashboard:v4'

let _debounce: ReturnType<typeof setTimeout> | null = null
function syncFirestore(layout: LayoutItem[], activePreset: PresetName, symbol: string) {
  if (_debounce) clearTimeout(_debounce)
  _debounce = setTimeout(() => {
    saveDashboardLayout({ layout, activePreset, symbol, updatedAt: Date.now() })
  }, 1500)
}

interface DashboardStore {
  layout: LayoutItem[]
  activePreset: PresetName
  editMode: boolean
  symbol: string
  firestoreReady: boolean

  setLayout: (layout: LayoutItem[]) => void
  loadPreset: (preset: PresetName) => void
  updateItem: (id: string, patch: Partial<LayoutItem>) => void
  addWidget: (widgetId: WidgetId) => void
  removeWidget: (id: string) => void
  toggleWidget: (id: string) => void
  setEditMode: (val: boolean) => void
  setSymbol: (symbol: string) => void
  resetLayout: () => void
  initFromFirestore: () => Promise<void>
}

function buildLayout(preset: PresetName): LayoutItem[] {
  return DASHBOARD_PRESETS[preset].layout.map((item, i) => ({ ...item, order: i }))
}

export const useDashboardStore = create<DashboardStore>()(
  persist(
    (set, get) => ({
      layout: buildLayout('journal'),
      activePreset: 'journal',
      editMode: false,
      symbol: 'BTCUSDT',
      firestoreReady: false,

      setLayout: (layout) => {
        set({ layout })
        syncFirestore(layout, get().activePreset, get().symbol)
      },

      loadPreset: (preset) => {
        const layout = buildLayout(preset)
        set({ layout, activePreset: preset })
        syncFirestore(layout, preset, get().symbol)
      },

      updateItem: (id, patch) => {
        const layout = get().layout.map(i => i.id === id ? { ...i, ...patch } : i)
        set({ layout, activePreset: 'custom' })
        syncFirestore(layout, 'custom', get().symbol)
      },

      addWidget: (widgetId) => {
        const cfg = WIDGET_REGISTRY[widgetId]
        const existing = get().layout.filter(i => i.widgetId === widgetId)
        const newId = existing.length > 0 ? `${widgetId}_${Date.now()}` : widgetId
        // Place below all existing items
        const maxY = get().layout.reduce((m, i) => Math.max(m, i.y + i.h), 0)
        const layout = [...get().layout, {
          id: newId, widgetId,
          x: 0, y: maxY,
          w: cfg.defaultW, h: cfg.defaultH,
          visible: true, order: get().layout.length,
        }]
        set({ layout, activePreset: 'custom' })
        syncFirestore(layout, 'custom', get().symbol)
      },

      removeWidget: (id) => {
        const layout = get().layout.filter(i => i.id !== id)
          .map((item, idx) => ({ ...item, order: idx }))
        set({ layout, activePreset: 'custom' })
        syncFirestore(layout, 'custom', get().symbol)
      },

      toggleWidget: (id) => {
        const layout = get().layout.map(i => i.id === id ? { ...i, visible: !i.visible } : i)
        set({ layout })
        syncFirestore(layout, get().activePreset, get().symbol)
      },

      setEditMode: (val) => set({ editMode: val }),

      setSymbol: (symbol) => {
        set({ symbol })
        syncFirestore(get().layout, get().activePreset, symbol)
      },

      resetLayout: () => {
        const layout = buildLayout('journal')
        set({ layout, activePreset: 'journal' })
        syncFirestore(layout, 'journal', get().symbol)
      },

      initFromFirestore: async () => {
        try {
          const remote = await loadDashboardLayout()
          if (remote?.layout?.length) {
            set({
              layout: remote.layout,
              activePreset: remote.activePreset ?? 'journal',
              symbol: remote.symbol ?? get().symbol,
            })
          }
        } catch (err) {
          console.warn('[DashboardStore] Firestore init failed:', err)
        } finally {
          set({ firestoreReady: true })
        }
      },
    }),
    {
      name: STORAGE_KEY,
      partialize: (s) => ({ layout: s.layout, activePreset: s.activePreset, symbol: s.symbol }),
    }
  )
)
