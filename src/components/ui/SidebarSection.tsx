import React, { useState } from 'react'

interface SidebarSectionProps {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  className?: string
}

/**
 * SidebarSection component — Collapsible section for organizing controls
 * Used in AnalysePage oscillators sidebar
 */
export const SidebarSection: React.FC<SidebarSectionProps> = ({
  title,
  children,
  defaultOpen = true,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className={`sidebar-section ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="sidebar-section-header w-full"
      >
        <span className="sidebar-section-header-title">{title}</span>
        <span
          className="transition-transform duration-150"
          style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        >
          ▼
        </span>
      </button>

      {isOpen && <div className="sidebar-section-content">{children}</div>}
    </div>
  )
}

SidebarSection.displayName = 'SidebarSection'
