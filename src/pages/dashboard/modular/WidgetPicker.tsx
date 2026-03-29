// ─── Widget Picker ───────────────────────────────────────────────────────────
// Panel to add widgets to the dashboard in edit mode.

import { useState } from 'react'
import { WIDGET_REGISTRY, WidgetId, WidgetConfig } from './types'
import { useDashboardStore } from './store'

const CATEGORIES = [
  { id: 'analysis', label: 'Analyse' },
  { id: 'chart',    label: 'Graphiques' },
  { id: 'journal',  label: 'Journal' },
  { id: 'info',     label: 'Info' },
] as const

export function WidgetPicker({ onClose }: { onClose: () => void }) {
  const { addWidget, layout } = useDashboardStore()
  const [activeCategory, setActiveCategory] = useState<string>('analysis')

  const widgets = Object.values(WIDGET_REGISTRY).filter(
    (w) => w.category === activeCategory
  )

  const isAlreadyAdded = (id: WidgetId) =>
    layout.some((l) => l.widgetId === id)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full sm:w-[480px] bg-bg-secondary border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl animate-slide-up overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Ajouter un widget</h3>
            <p className="text-[11px] text-text-tertiary mt-0.5">Glissez pour réorganiser après ajout</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-text-secondary hover:bg-bg-tertiary transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>

        {/* Category tabs */}
        <div className="flex items-center gap-1 px-5 pt-3">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`
                px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                ${activeCategory === cat.id
                  ? 'bg-brand-cyan/15 text-brand-cyan'
                  : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-tertiary'
                }
              `}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Widget grid */}
        <div className="p-5 grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto">
          {widgets.map((w) => {
            const added = isAlreadyAdded(w.id)
            return (
              <button
                key={w.id}
                onClick={() => { addWidget(w.id); onClose() }}
                disabled={added && w.id !== 'rsi_block'} // allow multiples of some
                className={`
                  relative flex flex-col items-start gap-2 p-4 rounded-xl border text-left
                  transition-all duration-150
                  ${added
                    ? 'border-border-subtle opacity-50 cursor-not-allowed'
                    : 'border-border hover:border-brand-cyan/40 hover:bg-bg-tertiary cursor-pointer active:scale-95'
                  }
                `}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-xl">{w.icon}</span>
                  {added && (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-bg-card text-text-muted border border-border-subtle">
                      ajouté
                    </span>
                  )}
                </div>
                <div>
                  <div className="text-xs font-semibold text-text-primary">{w.label}</div>
                  <div className="text-[10px] text-text-muted mt-0.5 leading-relaxed">{w.description}</div>
                </div>
                <div
                  className="w-full h-0.5 rounded-full opacity-40"
                  style={{ background: w.accentColor }}
                />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
