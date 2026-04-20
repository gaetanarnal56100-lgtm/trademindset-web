import React from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  icon?: React.ReactNode
  iconPosition?: 'left' | 'right'
}

/**
 * Input component — Flat Design with optional label, error, and hint
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', label, error, hint, icon, iconPosition = 'left', ...props }, ref) => {
    const hasIcon = !!icon

    return (
      <div className="form-group">
        {label && <label className="form-group-label">{label}</label>}

        <div className="relative">
          {icon && iconPosition === 'left' && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none">
              {icon}
            </div>
          )}

          <input
            ref={ref}
            className={`input ${hasIcon && iconPosition === 'left' ? 'pl-9' : ''} ${hasIcon && iconPosition === 'right' ? 'pr-9' : ''} ${className}`}
            {...props}
          />

          {icon && iconPosition === 'right' && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none">
              {icon}
            </div>
          )}
        </div>

        {error ? (
          <div className="form-group-error">{error}</div>
        ) : hint ? (
          <div className="form-group-hint">{hint}</div>
        ) : null}
      </div>
    )
  }
)

Input.displayName = 'Input'
