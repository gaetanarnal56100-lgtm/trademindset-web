import React from 'react'

export interface Stat {
  label: string
  value: string | number
  unit?: string
  change?: {
    value: number
    percent?: number
    trend: 'up' | 'down' | 'neutral'
  }
}

interface StatsRowProps {
  stats: Stat[]
  className?: string
}

/**
 * StatsRow component — Display multiple KPI metrics in a responsive row
 */
export const StatsRow: React.FC<StatsRowProps> = ({ stats, className = '' }) => {
  return (
    <div className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 ${className}`}>
      {stats.map((stat, idx) => (
        <div key={idx} className="dashboard-card">
          <div className="dashboard-card-label">{stat.label}</div>
          <div className="dashboard-card-value">
            {stat.value}
            {stat.unit && <span className="text-sm text-text-secondary ml-1">{stat.unit}</span>}
          </div>
          {stat.change && (
            <div
              className={`dashboard-card-change ${
                stat.change.trend === 'up'
                  ? 'text-profit'
                  : stat.change.trend === 'down'
                    ? 'text-loss'
                    : 'text-text-secondary'
              }`}
            >
              <span className="mr-1">
                {stat.change.trend === 'up' ? '↑' : stat.change.trend === 'down' ? '↓' : '→'}
              </span>
              {stat.change.percent
                ? `${stat.change.percent > 0 ? '+' : ''}${stat.change.percent}%`
                : `${stat.change.value > 0 ? '+' : ''}${stat.change.value}`}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

StatsRow.displayName = 'StatsRow'
