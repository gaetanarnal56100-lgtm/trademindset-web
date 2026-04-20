import React from 'react'

interface IndicatorBadgeProps {
  name: string
  status: 'active' | 'inactive' | 'alert'
  value?: string | number
  className?: string
}

/**
 * IndicatorBadge component — Status indicator for oscillators (WaveTrend, VMC, RSI, etc.)
 * Shows indicator name with pulsing dot and optional value
 */
export const IndicatorBadge: React.FC<IndicatorBadgeProps> = ({
  name,
  status,
  value,
  className = '',
}) => {
  const statusColor = {
    active: 'bg-cyan-900/40 border-cyan-500/40',
    inactive: 'bg-gray-900/40 border-gray-500/20',
    alert: 'bg-red-900/40 border-red-500/40',
  }

  const dotColor = {
    active: 'bg-cyan-400',
    inactive: 'bg-gray-500',
    alert: 'bg-red-500',
  }

  return (
    <div className={`indicator-badge ${statusColor[status]} ${className}`}>
      <span className={`indicator-badge-dot ${dotColor[status]}`} />
      <span className="font-medium">{name}</span>
      {value && <span className="text-text-secondary ml-1">({value})</span>}
    </div>
  )
}

IndicatorBadge.displayName = 'IndicatorBadge'
