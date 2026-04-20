import React from 'react'

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'profit' | 'loss' | 'cyan' | 'warning'
  children: React.ReactNode
}

/**
 * Badge component — Small colored indicators
 * Variants: profit (green), loss (red), cyan (accent), warning (orange)
 */
export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className = '', variant = 'cyan', children, ...props }, ref) => {
    const variantClasses = {
      profit: 'badge-profit',
      loss: 'badge-loss',
      cyan: 'badge-cyan',
      warning: 'text-xs font-semibold px-2 py-0.5 rounded-md bg-yellow-900/20 text-yellow-400',
    }

    return (
      <span
        ref={ref}
        className={`${variantClasses[variant]} ${className}`}
        {...props}
      >
        {children}
      </span>
    )
  }
)

Badge.displayName = 'Badge'
