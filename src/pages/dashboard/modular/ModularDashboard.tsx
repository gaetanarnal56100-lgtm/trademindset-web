// ─── ModularDashboard ────────────────────────────────────────────────────────
// Main orchestrator: DnD context + sortable grid + toolbar.
// Firestore hydration happens here on first mount (after auth is ready).

import { useState, useCallback, useEffect } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  defaultDropAnimationSideEffects,
} from '@dnd-kit/core'
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable'
import { restrictToWindowEdges } from '@dnd-kit/modifiers'

import { useDashboardStore } from './store'
import { DraggableWidget } from './DraggableWidget'
import { RenderWidget } from './widgets/RenderWidget'
import { WidgetPicker } from './WidgetPicker'
import { SIZE_COLS, WIDGET_REGISTRY, DASHBOARD_PRESETS, PresetName } from './types'

const dropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: '0.4' } },
  }),
}

export default function ModularDashboard() {
  const {
    layout, setLayout,
    editMode, setEditMode,
    activePreset, loadPreset,
    symbol, setSymbol,
    firestoreReady, initFromFirestore,
  } = useDashboardStore()

  const [activeId, setActiveId] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)

  // ── Hydrate from Firestore once on mount ─────────────────────────────────
  useEffect(() => {
    initFromFirestore()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── DnD sensors ──────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = layout.findIndex(i => i.id === active.id)
    const newIndex  = layout.findIndex(i => i.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    setLayout(arrayMove(layout, oldIndex, newIndex).map((item, idx) => ({ ...item, order: idx })))
  }, [layout, setLayout])

  const activeItem = activeId ? layout.find(i => i.id === activeId) : null

  // ── Skeleton while Firestore loads (avoids layout flash) ─────────────────
  if (!firestoreReady) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="h-9 w-64 bg-bg-secondary rounded-xl animate-pulse" />
          <div className="h-9 w-32 bg-bg-secondary rounded-xl animate-pulse" />
        </div>
        <div className="grid grid-cols-4 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="col-span-2 h-48 bg-bg-secondary rounded-2xl animate-pulse border border-border-subtle" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">

      {/* ── Toolbar ── */}
      <DashboardToolbar
        editMode={editMode}
        onToggleEdit={() => setEditMode(!editMode)}
        onOpenPicker={() => setShowPicker(true)}
        activePreset={activePreset}
        symbol={symbol}
        onSymbolChange={setSymbol}
      />

      {/* ── Sortable grid ── */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToWindowEdges]}
      >
        <SortableContext items={layout.map(i => i.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-4 gap-4 auto-rows-auto">
            {layout.map(item => (
              <div key={item.id} className={`${SIZE_COLS[item.size]} transition-all duration-200`}>
                <DraggableWidget item={item}>
                  <RenderWidget widgetId={item.widgetId} symbol={symbol} />
                </DraggableWidget>
              </div>
            ))}

            {/* Add widget placeholder */}
            {editMode && (
              <div className="col-span-1">
                <button
                  onClick={() => setShowPicker(true)}
                  className="w-full h-full min-h-[120px] flex flex-col items-center justify-center gap-2
                    border border-dashed border-border rounded-2xl text-text-muted
                    hover:border-brand-cyan/40 hover:text-brand-cyan hover:bg-brand-cyan/5
                    transition-all duration-200 group"
                >
                  <span className="text-2xl group-hover:scale-110 transition-transform">+</span>
                  <span className="text-[11px] font-medium">Ajouter widget</span>
                </button>
              </div>
            )}
          </div>
        </SortableContext>

        {/* Drag ghost overlay */}
        <DragOverlay dropAnimation={dropAnimation}>
          {activeItem ? (
            <div className={SIZE_COLS[activeItem.size]}>
              <div className="card opacity-90 shadow-2xl ring-1 ring-brand-cyan/30 rotate-1 scale-105 pointer-events-none">
                <div className="px-4 py-3 border-b border-border-subtle flex items-center gap-2">
                  <span className="text-base">{WIDGET_REGISTRY[activeItem.widgetId].icon}</span>
                  <span className="text-xs font-medium text-text-secondary">
                    {WIDGET_REGISTRY[activeItem.widgetId].label}
                  </span>
                </div>
                <div className="h-20 flex items-center justify-center text-text-muted text-xs">
                  Déposez ici…
                </div>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Widget picker modal */}
      {showPicker && <WidgetPicker onClose={() => setShowPicker(false)} />}

      {/* Firestore sync indicator */}
      <FirestoreSyncBadge />
    </div>
  )
}

// ─── Firestore sync indicator ─────────────────────────────────────────────────
function FirestoreSyncBadge() {
  const [synced, setSynced] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const handler = () => {
      setSynced(true)
      setVisible(true)
      setTimeout(() => setVisible(false), 2000)
    }
    // Listen for debounced save completions via a custom event
    window.addEventListener('dashboard:synced', handler)
    return () => window.removeEventListener('dashboard:synced', handler)
  }, [])

  if (!visible) return null
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-3 py-2
      bg-bg-secondary border border-profit/30 rounded-xl shadow-lg animate-fade-in">
      <span className="w-1.5 h-1.5 rounded-full bg-profit animate-pulse" />
      <span className="text-[11px] font-medium text-profit">Disposition sauvegardée</span>
    </div>
  )
}

// ─── Toolbar ─────────────────────────────────────────────────────────────────
interface ToolbarProps {
  editMode: boolean
  onToggleEdit: () => void
  onOpenPicker: () => void
  activePreset: PresetName
  symbol: string
  onSymbolChange: (s: string) => void
}

function DashboardToolbar({
  editMode, onToggleEdit, onOpenPicker,
  activePreset, symbol, onSymbolChange,
}: ToolbarProps) {
  const { loadPreset, resetLayout } = useDashboardStore()
  const [symbolInput, setSymbolInput] = useState(symbol)

  // Keep input in sync if symbol changes from Firestore hydration
  useEffect(() => { setSymbolInput(symbol) }, [symbol])

  const presets: { name: PresetName; label: string; icon: string }[] = [
    { name: 'scalping', label: 'Scalping', icon: '⚡' },
    { name: 'swing',    label: 'Swing',    icon: '🌊' },
    { name: 'custom',   label: 'Custom',   icon: '⚙' },
  ]

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {/* Presets */}
      <div className="flex items-center gap-1 bg-bg-secondary border border-border rounded-xl p-1">
        {presets.map(p => (
          <button key={p.name} onClick={() => loadPreset(p.name)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all
              ${activePreset === p.name
                ? 'bg-brand-cyan/15 text-brand-cyan shadow-sm'
                : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-tertiary'
              }`}
          >
            <span className="text-sm">{p.icon}</span>
            <span>{p.label}</span>
          </button>
        ))}
      </div>

      {/* Symbol search */}
      <form onSubmit={e => { e.preventDefault(); onSymbolChange(symbolInput.toUpperCase()) }}
        className="flex items-center gap-2">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[11px] font-mono">$</span>
          <input type="text" value={symbolInput}
            onChange={e => setSymbolInput(e.target.value.toUpperCase())}
            placeholder="BTCUSDT"
            className="pl-6 pr-3 py-1.5 bg-bg-secondary border border-border rounded-lg
              text-xs font-mono text-text-primary placeholder:text-text-muted
              focus:outline-none focus:border-brand-cyan/50 focus:ring-1 focus:ring-brand-cyan/20
              w-28 transition-all"
          />
        </div>
        <button type="submit"
          className="px-2.5 py-1.5 bg-brand-cyan/15 border border-brand-cyan/30 rounded-lg
            text-[11px] font-medium text-brand-cyan hover:bg-brand-cyan/20 transition-colors">
          OK
        </button>
      </form>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {editMode && (
          <button onClick={onOpenPicker}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary border border-border
              rounded-xl text-xs text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-all">
            <span>+</span><span>Widget</span>
          </button>
        )}
        {editMode && (
          <button onClick={resetLayout}
            className="px-3 py-1.5 bg-bg-secondary border border-border rounded-xl
              text-xs text-text-muted hover:text-loss hover:border-loss/30 transition-all">
            Reset
          </button>
        )}
        <button onClick={onToggleEdit}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all border
            ${editMode
              ? 'bg-brand-cyan text-bg-primary border-brand-cyan shadow-glow-cyan'
              : 'bg-bg-secondary border-border text-text-secondary hover:border-brand-cyan/40 hover:text-brand-cyan'
            }`}
        >
          {editMode ? <><CheckIcon /><span>Terminé</span></> : <><EditIcon /><span>Éditer</span></>}
        </button>
      </div>
    </div>
  )
}

function EditIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  )
}
function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
}
