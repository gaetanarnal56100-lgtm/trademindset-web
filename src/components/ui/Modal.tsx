import React, { useEffect } from 'react'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  footer?: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
}

/**
 * Modal component — Flat Design with fade overlay and slide-up animation
 */
export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}) => {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])

  if (!isOpen) return null

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
  }

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div className={`modal ${sizeClasses[size]} pointer-events-auto`}>
          {title && (
            <div className="modal-header">
              <h2 className="modal-title">{title}</h2>
              <button
                onClick={onClose}
                className="modal-close text-xl leading-none hover:brightness-110"
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>
          )}

          <div className="modal-body">{children}</div>

          {footer && <div className="modal-footer">{footer}</div>}
        </div>
      </div>
    </>
  )
}

Modal.displayName = 'Modal'
