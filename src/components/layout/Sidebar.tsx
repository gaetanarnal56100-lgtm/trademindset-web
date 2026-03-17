// src/components/layout/Sidebar.tsx
import { NavLink, useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import { logout } from '@/services/firebase/auth'
import { useUser } from '@/hooks/useAuth'
import {
  IconDashboard, IconTrades, IconAnalyse, IconJournal,
  IconAlertes, IconSystemes, IconProfil, IconSettings, IconLogout,
} from '@/components/ui/Icons'

const NAV = [
  { to: '/',          label: 'Dashboard',  Icon: IconDashboard,  end: true },
  { to: '/trades',    label: 'Trades',     Icon: IconTrades },
  { to: '/analyse',   label: 'Analyse',    Icon: IconAnalyse },
  { to: '/journal',   label: 'Journal',    Icon: IconJournal },
  { to: '/alertes',   label: 'Alertes',    Icon: IconAlertes },
  { to: '/systemes',  label: 'Systèmes',   Icon: IconSystemes },
]

const NAV_BOTTOM = [
  { to: '/profil',    label: 'Profil',     Icon: IconProfil },
  { to: '/settings',  label: 'Paramètres', Icon: IconSettings },
]

export default function Sidebar() {
  const user     = useUser()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <aside className="w-56 shrink-0 flex flex-col h-screen sticky top-0 border-r border-border bg-bg-secondary">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-brand-cyan bg-opacity-15 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" strokeWidth="2" strokeLinecap="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
              <polyline points="16 7 22 7 22 13" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-bold text-text-primary font-display leading-none">TradeMindset</div>
            <div className="text-[10px] text-brand-cyan font-medium mt-0.5 tracking-widest uppercase">Pro</div>
          </div>
        </div>
      </div>

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {NAV.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to} to={to} end={end}
            className={({ isActive }) => clsx(
              'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 group',
              isActive
                ? 'bg-brand-cyan bg-opacity-10 text-brand-cyan font-medium'
                : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
            )}
          >
            {({ isActive }) => (
              <>
                <Icon size={17} className={isActive ? 'text-brand-cyan' : 'text-text-tertiary group-hover:text-text-secondary'} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Bottom nav */}
      <div className="px-2 py-2 border-t border-border space-y-0.5">
        {NAV_BOTTOM.map(({ to, label, Icon }) => (
          <NavLink
            key={to} to={to}
            className={({ isActive }) => clsx(
              'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 group',
              isActive
                ? 'bg-brand-cyan bg-opacity-10 text-brand-cyan font-medium'
                : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
            )}
          >
            {({ isActive }) => (
              <>
                <Icon size={17} className={isActive ? 'text-brand-cyan' : 'text-text-tertiary group-hover:text-text-secondary'} />
                {label}
              </>
            )}
          </NavLink>
        ))}

        {/* User + logout */}
        <div className="pt-2 border-t border-border mt-1">
          <div className="flex items-center gap-2.5 px-3 py-2 mb-1">
            <div className="w-7 h-7 rounded-full bg-brand-blue bg-opacity-20 flex items-center justify-center text-xs font-semibold text-brand-blue shrink-0">
              {user?.displayName?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-text-primary truncate">{user?.displayName || 'Trader'}</div>
              <div className="text-[10px] text-text-tertiary truncate">{user?.email}</div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-text-secondary hover:bg-bg-tertiary hover:text-loss w-full transition-all duration-150 group"
          >
            <IconLogout size={17} className="text-text-tertiary group-hover:text-loss" />
            Déconnexion
          </button>
        </div>
      </div>
    </aside>
  )
}
