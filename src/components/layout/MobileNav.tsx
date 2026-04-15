// src/components/layout/MobileNav.tsx
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { clsx } from 'clsx'
import {
  IconDashboard, IconTrades, IconAnalyse, IconJournal, IconAlertes,
} from '@/components/ui/Icons'

export default function MobileNav() {
  const { t } = useTranslation()

  const NAV = [
    { to: '/app',          label: t('nav.dashboard'), Icon: IconDashboard, end: true },
    { to: '/app/trades',  label: t('nav.trades'),    Icon: IconTrades },
    { to: '/app/analyse', label: t('nav.analyse'),   Icon: IconAnalyse },
    { to: '/app/journal', label: t('nav.journal'),   Icon: IconJournal },
    { to: '/app/alertes', label: t('alerts.title').split(' ')[0], Icon: IconAlertes },
  ]

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
