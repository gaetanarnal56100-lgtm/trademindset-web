import React from 'react'

interface FormGroupProps {
  label?: string
  error?: string
  hint?: string
  children: React.ReactNode
  className?: string
}

/**
 * FormGroup component — Wrapper for form elements with label, error, and hint
 */
export const FormGroup: React.FC<FormGroupProps> = ({
  label,
  error,
  hint,
  children,
  className = '',
}) => {
  return (
    <div className={`form-group ${className}`}>
      {label && <label className="form-group-label">{label}</label>}

      <div>{children}</div>

      {error ? (
        <div className="form-group-error">{error}</div>
      ) : hint ? (
        <div className="form-group-hint">{hint}</div>
      ) : null}
    </div>
  )
}

FormGroup.displayName = 'FormGroup'
