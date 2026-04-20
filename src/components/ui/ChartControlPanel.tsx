import React from 'react'

interface ChartControlItem {
  id: string
  label: string
  value: boolean | string | number
  type: 'toggle' | 'select' | 'input'
  options?: Array<{ label: string; value: any }>
}

interface ChartControlPanelProps {
  items: ChartControlItem[]
  onItemChange: (id: string, value: any) => void
  className?: string
}

/**
 * ChartControlPanel component — Controls for chart toggles, selects, and inputs
 * Used in AnalysePage for indicator toggle and timeframe selection
 */
export const ChartControlPanel: React.FC<ChartControlPanelProps> = ({
  items,
  onItemChange,
  className = '',
}) => {
  return (
    <div className={`chart-controls ${className}`}>
      {items.map((item) => (
        <div key={item.id} className="chart-control-item">
          <label className="chart-control-label">{item.label}</label>

          {item.type === 'toggle' && (
            <button
              onClick={() => onItemChange(item.id, !item.value)}
              className={`toggle-switch ${item.value ? 'active' : ''}`}
              role="switch"
              aria-checked={item.value}
            />
          )}

          {item.type === 'select' && (
            <select
              value={item.value}
              onChange={(e) => onItemChange(item.id, e.target.value)}
              className="select"
            >
              {item.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}

          {item.type === 'input' && (
            <input
              type="text"
              value={item.value}
              onChange={(e) => onItemChange(item.id, e.target.value)}
              className="input"
            />
          )}
        </div>
      ))}
    </div>
  )
}

ChartControlPanel.displayName = 'ChartControlPanel'
