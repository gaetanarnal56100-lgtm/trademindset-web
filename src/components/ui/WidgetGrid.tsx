import React from 'react'

interface WidgetGridProps {
  children: React.ReactNode
  cols?: number
  gap?: number
  className?: string
}

/**
 * WidgetGrid component — Responsive grid for dashboard widgets
 * Default: 1 col on mobile, 2 on tablet, auto-fit on desktop
 */
export const WidgetGrid: React.FC<WidgetGridProps> = ({
  children,
  cols = 2,
  gap = 4,
  className = '',
}) => {
  const gridClasses = `grid gap-${gap} grid-cols-1 md:grid-cols-2 lg:grid-cols-${cols} ${className}`

  return <div className={gridClasses}>{children}</div>
}

WidgetGrid.displayName = 'WidgetGrid'
