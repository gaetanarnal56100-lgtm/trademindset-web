// src/components/layout/MobileNav.tsx
import { NavLink } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  IconDashboard, IconTrades, IconAnalyse, IconJournal, IconAlertes,
} from '@/components/ui/Icons'

const NAV = [
  { to: '/app',          label: 'Dashboard', Icon: IconDashboard, end: true },
  { to: '/app/trades',  label: 'Trades',    Icon: IconTrades },
  { to: '/app/analyse', label: 'Analyse',   Icon: IconAnalyse },
  { to: '/app/journal', label: 'Journal',   Icon: IconJournal },
  { to: '/app/alertes', label: 'Alertes',   Icon: IconAlertes },
]

export default function MobileNav() {
  return (
    <nav className="fixed bottom-0 inset-x-0 bg-bg-secondary border-t border-border z-50 px-2 pb-safe">
      <div className="flex items-center justify-around py-2">
        {NAV.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to} to={to} end={end}
            className={({ isActive }) => clsx(
              'flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-all duration-150',
              isActive ? 'text-brand-cyan' : 'text-text-tertiary'
            )}
          >
            {({ isActive }) => (
              <>
                <Icon size={22} className={isActive ? 'text-brand-cyan' : ''} />
                <span className="text-[10px] font-medium">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
