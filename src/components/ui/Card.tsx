import React from 'react'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'flat' | 'hover' | 'accent' | 'kpi'
  children: React.ReactNode
}

/**
 * Card component — Flat Design with border-based styling
 * Variants: default, flat, hover (with lift effect), accent (cyan on hover), kpi (with top accent line)
 */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className = '', variant = 'default', children, ...props }, ref) => {
    const variantClasses = {
      default: 'card',
      flat: 'card-flat',
      hover: 'card-hover',
      accent: 'card-accent',
      kpi: 'kpi-card',
    }

    return (
      <div
        ref={ref}
        className={`${variantClasses[variant]} ${className}`}
        {...props}
      >
        {children}
      </div>
    )
  }
)

Card.displayName = 'Card'
