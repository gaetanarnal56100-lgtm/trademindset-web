// ─── DraggableWidget v2 ───────────────────────────────────────────────────────
// Shell de widget avec :
//   • Drag (poignée en haut à gauche) via dnd-kit
//   • Resize E (largeur), S (hauteur), SE (diagonal) via pointermove natif
//   • Snap-to-grid automatique
//   • Contrôles edit mode : visibilité, suppression
// Le resize est en colonnes/rangées — pas en px bruts — pour un rendu propre.

import { useRef, useState, useCallback } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { LayoutItem, WIDGET_REGISTRY, GRID_COLS, ROW_HEIGHT, COL_MIN, ROW_MIN } from './types'
import { useDashboardStore } from './store'

interface DraggableWidgetProps {
  item: LayoutItem
  containerWidth: number  // largeur px du container grid
  children: React.ReactNode
}

// ─── Resize handle ─────────────────────────────────────────────────────────────
type ResizeDir = 'e' | 's' | 'se'

interface ResizeHandleProps {
  dir: ResizeDir
  onResizeStart: (dir: ResizeDir, e: React.PointerEvent) => void
}

function ResizeHandle({ dir, onResizeStart }: ResizeHandleProps) {
  const base: React.CSSProperties = {
    position: 'absolute', zIndex: 20,
    background: 'transparent',
    transition: 'background 0.15s',
  }
  const styles: Record<ResizeDir, React.CSSProperties> = {
    e:  { ...base, right: 0, top: '20%', bottom: '20%', width: 8,  cursor: 'ew-resize' },
    s:  { ...base, bottom: 0, left: '20%', right: '20%', height: 8, cursor: 'ns-resize' },
    se: { ...base, right: 0,  bottom: 0,  width: 16, height: 16,   cursor: 'se-resize' },
  }
  return (
    <div
      style={styles[dir]}
      onPointerDown={e => { e.stopPropagation(); onResizeStart(dir, e) }}
      className="resize-handle group-hover:bg-brand-cyan/20 hover:!bg-brand-cyan/40"
    >
      {dir === 'se' && (
        <svg
          style={{ position:'absolute', bottom:2, right:2, opacity:0.4 }}
          width="10" height="10" viewBox="0 0 10 10"
        >
          <path d="M2 8 L8 2 M5 8 L8 5 M8 8 L8 8" stroke="#00E5FF" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      )}
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────
export function DraggableWidget({ item, containerWidth, children }: DraggableWidgetProps) {
  const { editMode, updateItem, toggleWidget, removeWidget } = useDashboardStore()
  const cfg = WIDGET_REGISTRY[item.widgetId]
  if (!cfg) return null

  // px per column
  const colW = containerWidth > 0 ? containerWidth / GRID_COLS : 80

  // Resize state
  const resizeRef = useRef<{
    dir: ResizeDir
    startX: number; startY: number
    startW: number; startH: number
  } | null>(null)
  const [resizing, setResizing] = useState(false)
  const [liveSize, setLiveSize] = useState<{ w: number; h: number } | null>(null)

  const handleResizeStart = useCallback((dir: ResizeDir, e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    resizeRef.current = { dir, startX: e.clientX, startY: e.clientY, startW: item.w, startH: item.h }
    setResizing(true)
    setLiveSize({ w: item.w, h: item.h })
  }, [item.w, item.h])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!resizeRef.current) return
    const { dir, startX, startY, startW, startH } = resizeRef.current
    const dx = e.clientX - startX
    const dy = e.clientY - startY

    let newW = startW
    let newH = startH

    if (dir === 'e' || dir === 'se') {
      newW = Math.round(startW + dx / colW)
      newW = Math.max(cfg.minW, Math.min(cfg.maxW, newW))
    }
    if (dir === 's' || dir === 'se') {
      newH = Math.round(startH + dy / ROW_HEIGHT)
      newH = Math.max(cfg.minH, Math.min(cfg.maxH, newH))
    }
    setLiveSize({ w: newW, h: newH })
  }, [colW, cfg.minW, cfg.maxW, cfg.minH, cfg.maxH])

  const handlePointerUp = useCallback(() => {
    if (!resizeRef.current || !liveSize) { setResizing(false); return }
    updateItem(item.id, { w: liveSize.w, h: liveSize.h })
    resizeRef.current = null
    setResizing(false)
    setLiveSize(null)
  }, [liveSize, item.id, updateItem])

  // dnd-kit sortable
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id: item.id, disabled: !editMode || resizing })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: resizing ? undefined : transition || undefined,
    opacity: isDragging ? 0.35 : 1,
    zIndex: isDragging ? 50 : resizing ? 40 : undefined,
  }

  const displayW = liveSize?.w ?? item.w
  const displayH = liveSize?.h ?? item.h
  const widgetH = displayH * ROW_HEIGHT

  if (!item.visible && !editMode) return null

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        gridColumn: `span ${displayW}`,
        minHeight: widgetH,
      }}
      className={`
        relative group flex flex-col
        ${isDragging ? 'shadow-2xl' : ''}
        ${!item.visible ? 'opacity-40' : ''}
      `}
      onPointerMove={resizing ? handlePointerMove : undefined}
      onPointerUp={resizing ? handlePointerUp : undefined}
      onPointerCancel={resizing ? handlePointerUp : undefined}
    >
      <div
        className={`
          flex flex-col h-full overflow-hidden rounded-2xl
          bg-bg-card border border-border
          ${editMode ? 'border-border ring-1 ring-inset ring-white/[0.04]' : ''}
          ${isDragging ? 'ring-brand-cyan/30 shadow-2xl scale-[1.01]' : ''}
          ${resizing ? 'ring-1 ring-brand-cyan/50' : ''}
          transition-shadow duration-200
        `}
        style={{ height: widgetH, boxShadow: '0 1px 0 rgba(255,255,255,0.03) inset, 0 2px 8px rgba(0,0,0,0.3)' }}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {editMode && (
              <button
                ref={setActivatorNodeRef}
                {...listeners}
                {...attributes}
                className="text-text-muted hover:text-brand-cyan cursor-grab active:cursor-grabbing p-0.5 flex-shrink-0 select-none touch-none"
                tabIndex={-1}
              >
                <DragIcon />
              </button>
            )}
            <span className="text-sm leading-none flex-shrink-0">{cfg.icon}</span>
            <span className="text-[11px] font-medium text-text-secondary tracking-wide truncate">
              {cfg.label}
            </span>
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: cfg.accentColor }} />
          </div>

          {editMode && (
            <div className="flex items-center gap-1 flex-shrink-0">
              {/* Size indicator */}
              <span className="text-[9px] font-mono text-text-muted px-1.5 py-0.5 bg-bg-tertiary rounded border border-border-subtle select-none">
                {displayW}×{displayH}
              </span>
              {/* Visibility */}
              <button
                onClick={() => toggleWidget(item.id)}
                className="p-1 rounded-lg text-text-muted hover:text-text-secondary transition-colors"
                title={item.visible ? 'Masquer' : 'Afficher'}
              >
                {item.visible ? <EyeIcon /> : <EyeOffIcon />}
              </button>
              {/* Remove */}
              <button
                onClick={() => removeWidget(item.id)}
                className="p-1 rounded-lg text-text-muted hover:text-loss transition-colors"
                title="Supprimer"
              >
                <TrashIcon />
              </button>
            </div>
          )}
        </div>

        {/* ── Content ── */}
        <div className={`flex-1 overflow-auto min-h-0 ${!item.visible ? 'pointer-events-none select-none' : ''}`}>
          {children}
        </div>
      </div>

      {/* ── Resize handles (edit mode only) ── */}
      {editMode && (
        <>
          <ResizeHandle dir="e"  onResizeStart={handleResizeStart} />
          <ResizeHandle dir="s"  onResizeStart={handleResizeStart} />
          <ResizeHandle dir="se" onResizeStart={handleResizeStart} />
        </>
      )}

      {/* ── Live resize overlay ── */}
      {resizing && (
        <div
          className="absolute inset-0 rounded-2xl pointer-events-none ring-2 ring-brand-cyan/60"
          style={{ background: 'rgba(0,229,255,0.03)' }}
        >
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-mono text-brand-cyan bg-bg-secondary/90 px-2 py-0.5 rounded-full border border-brand-cyan/30">
            {displayW} col × {displayH} rang
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────
function DragIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <circle cx="3.5" cy="2.5" r="1.1"/><circle cx="8.5" cy="2.5" r="1.1"/>
      <circle cx="3.5" cy="6"   r="1.1"/><circle cx="8.5" cy="6"   r="1.1"/>
      <circle cx="3.5" cy="9.5" r="1.1"/><circle cx="8.5" cy="9.5" r="1.1"/>
    </svg>
  )
}
function EyeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  )
}
function EyeOffIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  )
}
function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
    </svg>
  )
}
