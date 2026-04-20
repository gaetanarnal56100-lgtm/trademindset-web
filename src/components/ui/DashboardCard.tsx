import React from 'react'

interface DashboardCardProps {
  label: string
  value: string | number
  change?: {
    value: number
    percent?: number
    trend: 'up' | 'down' | 'neutral'
  }
  unit?: string
  icon?: React.ReactNode
  className?: string
}

/**
 * DashboardCard component — For KPI/stats displays in Dashboard
 * Shows label, value, optional change indicator and unit
 */
export const DashboardCard: React.FC<DashboardCardProps> = ({
  label,
  value,
  change,
  unit,
  icon,
  className = '',
}) => {
  const changeColor = change
    ? change.trend === 'up'
      ? 'text-profit'
      : change.trend === 'down'
        ? 'text-loss'
        : 'text-text-secondary'
    : ''

  const changeIcon = change
    ? change.trend === 'up'
      ? '↑'
      : change.trend === 'down'
        ? '↓'
        : '→'
    : ''

  return (
    <div className={`dashboard-card ${className}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="dashboard-card-label">{label}</div>
          <div className="dashboard-card-value">
            {value}
            {unit && <span className="text-sm text-text-secondary ml-1">{unit}</span>}
          </div>
          {change && (
            <div className={`dashboard-card-change ${changeColor}`}>
              <span className="mr-1">{changeIcon}</span>
              {change.percent ? `${change.percent > 0 ? '+' : ''}${change.percent}%` : `${change.value > 0 ? '+' : ''}${change.value}`}
            </div>
          )}
        </div>
        {icon && <div className="text-2xl opacity-50">{icon}</div>}
      </div>
    </div>
  )
}

DashboardCard.displayName = 'DashboardCard'
