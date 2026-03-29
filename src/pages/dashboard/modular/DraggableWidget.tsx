// ─── DraggableWidget ─────────────────────────────────────────────────────────
// Outer shell for each dashboard widget. Handles:
// - dnd-kit drag handle
// - resize controls
// - visibility toggle
// - remove action

import { useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { LayoutItem, WidgetSize, SIZE_LABELS, WIDGET_REGISTRY } from './types'
import { useDashboardStore } from './store'

interface DraggableWidgetProps {
  item: LayoutItem
  children: React.ReactNode
}

const SIZE_ORDER: WidgetSize[] = ['sm', 'md', 'lg', 'xl', 'full']

export function DraggableWidget({ item, children }: DraggableWidgetProps) {
  const { editMode, resizeWidget, toggleWidget, removeWidget } = useDashboardStore()
  const cfg = WIDGET_REGISTRY[item.widgetId]
  const [showResizer, setShowResizer] = useState(false)

  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef,
    transform, transition, isDragging, over,
  } = useSortable({ id: item.id, disabled: !editMode })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition || undefined,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  }

  const minIdx = SIZE_ORDER.indexOf(cfg.minSize)
  const maxIdx = SIZE_ORDER.indexOf(cfg.maxSize)
  const availableSizes = SIZE_ORDER.slice(minIdx, maxIdx + 1)

  if (!item.visible && !editMode) return null

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        relative group flex flex-col
        transition-all duration-200
        ${isDragging ? 'shadow-2xl scale-[1.02] ring-1 ring-brand-cyan/40' : ''}
        ${!item.visible ? 'opacity-40' : ''}
      `}
      onMouseEnter={() => editMode && setShowResizer(true)}
      onMouseLeave={() => setShowResizer(false)}
    >
      {/* ── Widget card ── */}
      <div className={`
        card flex-1 flex flex-col overflow-hidden
        ${editMode ? 'border-border-subtle ring-1 ring-inset ring-white/5 cursor-grab active:cursor-grabbing' : ''}
        ${isDragging ? 'ring-brand-cyan/30' : ''}
      `}>

        {/* ── Header (always shown) ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <div className="flex items-center gap-2 min-w-0">
            {editMode && (
              <button
                ref={setActivatorNodeRef}
                {...listeners}
                {...attributes}
                className="text-text-muted hover:text-text-secondary cursor-grab active:cursor-grabbing p-0.5 -ml-1 flex-shrink-0 select-none"
                aria-label="Drag handle"
                tabIndex={-1}
              >
                <DragHandleIcon />
              </button>
            )}
            <span className="text-base leading-none">{cfg.icon}</span>
            <span className="text-xs font-medium text-text-secondary tracking-wide truncate">
              {cfg.label}
            </span>
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: cfg.accentColor }}
            />
          </div>

          {editMode && (
            <div className="flex items-center gap-1">
              {/* ── Size selector ── */}
              <div className="flex items-center gap-0.5 bg-bg-tertiary rounded-lg p-0.5">
                {availableSizes.map((s) => (
                  <button
                    key={s}
                    onClick={() => resizeWidget(item.id, s)}
                    className={`
                      px-2 py-0.5 rounded-md text-[10px] font-mono font-medium transition-all
                      ${item.size === s
                        ? 'bg-bg-card text-text-primary shadow-sm'
                        : 'text-text-tertiary hover:text-text-secondary'
                      }
                    `}
                  >
                    {SIZE_LABELS[s]}
                  </button>
                ))}
              </div>

              {/* ── Visibility toggle ── */}
              <button
                onClick={() => toggleWidget(item.id)}
                className={`
                  p-1 rounded-lg transition-colors
                  ${item.visible
                    ? 'text-text-tertiary hover:text-text-secondary'
                    : 'text-text-muted hover:text-text-tertiary'
                  }
                `}
                title={item.visible ? 'Masquer' : 'Afficher'}
              >
                {item.visible ? <EyeIcon /> : <EyeOffIcon />}
              </button>

              {/* ── Remove ── */}
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
        <div className={`flex-1 overflow-auto ${!item.visible ? 'pointer-events-none' : ''}`}>
          {children}
        </div>
      </div>
    </div>
  )
}

// ─── SVG Icons ───────────────────────────────────────────────────────────────

function DragHandleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <circle cx="4.5" cy="3" r="1.2" /><circle cx="9.5" cy="3" r="1.2" />
      <circle cx="4.5" cy="7" r="1.2" /><circle cx="9.5" cy="7" r="1.2" />
      <circle cx="4.5" cy="11" r="1.2" /><circle cx="9.5" cy="11" r="1.2" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
