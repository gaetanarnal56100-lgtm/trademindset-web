import React from 'react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'accent'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  children: React.ReactNode
}

/**
 * Button component — Flat Design with moderate animations
 * Variants: primary (cyan), secondary (muted), ghost (transparent), danger (red), outline (cyan border), accent (purple)
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', loading = false, disabled = false, children, ...props }, ref) => {
    const baseClasses = 'font-medium transition-all duration-150 active:scale-95'

    const variantClasses = {
      primary: 'btn-primary',
      secondary: 'btn-secondary',
      ghost: 'btn-ghost',
      danger: 'btn-danger',
      outline: 'btn-outline',
      accent: 'bg-brand-purple text-white px-4 py-2 rounded-xl text-sm hover:brightness-110',
    }

    const sizeClasses = {
      sm: 'px-3 py-1.5 text-xs',
      md: 'px-4 py-2 text-sm',
      lg: 'px-6 py-3 text-base',
    }

    return (
      <button
        ref={ref}
        disabled={loading || disabled}
        className={`${baseClasses} ${variantClasses[variant]} ${className}`}
        {...props}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            {children}
          </span>
        ) : (
          children
        )}
      </button>
    )
  }
)

Button.displayName = 'Button'
