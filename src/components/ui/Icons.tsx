// src/components/ui/Icons.tsx
// Icônes SVG inline — pas de dépendance externe

interface IconProps {
  size?: number
  className?: string
}

const icon = (path: string, viewBox = '0 0 24 24') =>
  ({ size = 20, className = '' }: IconProps) => (
    <svg
      width={size} height={size} viewBox={viewBox}
      fill="none" stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round"
      className={className}
    >
      <path d={path} />
    </svg>
  )

export const IconDashboard   = icon('M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10')
export const IconTrades      = icon('M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2 M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2 M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 M9 12h6 M9 16h4')
export const IconAnalyse     = icon('M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z')
export const IconJournal     = icon('M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z')
export const IconAlertes     = icon('M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0')
export const IconSystemes    = icon('M12 2L2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5')
export const IconProfil      = icon('M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z')
export const IconSettings    = icon('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z')
export const IconPlus        = icon('M12 5v14 M5 12h14')
export const IconClose       = icon('M18 6L6 18 M6 6l12 12')
export const IconChevronDown = icon('M6 9l6 6 6-6')
export const IconChevronRight= icon('M9 18l6-6-6-6')
export const IconSearch      = icon('M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0')
export const IconFilter      = icon('M22 3H2l8 9.46V19l4 2v-8.54L22 3z')
export const IconExport      = icon('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3')
export const IconArrowUp     = icon('M12 19V5 M5 12l7-7 7 7')
export const IconArrowDown   = icon('M12 5v14 M19 12l-7 7-7-7')
export const IconTrendUp     = icon('M23 6l-9.5 9.5-5-5L1 18')
export const IconTrendDown   = icon('M23 18l-9.5-9.5-5 5L1 6')
export const IconCalendrier = icon('M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M8 14h.01 M12 14h.01 M16 14h.01 M8 18h.01 M12 18h.01 M16 18h.01')
export const IconLogout      = icon('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9')
export const IconChart       = icon('M18 20V10 M12 20V4 M6 20v-6')
export const IconAI          = icon('M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z M12 8v4l3 3')
export const IconUpload      = icon('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12')
export const IconInfo        = icon('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 8h.01 M12 12v4')
export const IconStar        = icon('M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z')
export const IconMenu        = icon('M3 12h18 M3 6h18 M3 18h18')
export const IconX           = icon('M18 6L6 18 M6 6l12 12')
export const IconEye         = icon('M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z')
export const IconEyeOff      = icon('M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94 M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19 M1 1l22 22')
export const IconGoogle      = ({ size = 20, className = '' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
)
export const IconExchange    = icon('M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10 M12 2v2 M12 20v2 M4.93 4.93l1.41 1.41 M17.66 17.66l1.41 1.41')
