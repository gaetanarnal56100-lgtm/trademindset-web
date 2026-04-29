// src/components/layout/Sidebar.tsx — Flat Design v3
import XPBar from '@/components/gamification/XPBar'
import { useState, useEffect } from 'react'
import NotificationBell from '@/components/notifications/NotificationBell'
import { NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { logout } from '@/services/firebase/auth'
import { useUser } from '@/hooks/useAuth'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/services/firebase/config'
import {
  IconDashboard, IconTrades, IconAnalyse, IconJournal,
  IconAlertes, IconSystemes, IconProfil, IconSettings, IconLogout, IconCalendrier, IconStar, IconMarches, IconWhale,
} from '@/components/ui/Icons'

export default function Sidebar() {
  const { t } = useTranslation()
  const user     = useUser()
  const navigate = useNavigate()

  const NAV = [
    { to: '/app',              label: t('nav.dashboard'),   Icon: IconDashboard,  end: true },
    { to: '/app/trades',      label: t('nav.trades'),      Icon: IconTrades },
    { to: '/app/analyse',     label: t('nav.analyse'),     Icon: IconAnalyse },
    { to: '/app/marches',     label: t('nav.marches'),     Icon: IconMarches },
    { to: '/app/whales',      label: 'Whale Alerts',        Icon: IconWhale },
    { to: '/app/journal',     label: t('nav.journal'),     Icon: IconJournal },
    { to: '/app/alertes',     label: t('nav.alertes'),     Icon: IconAlertes },
  ]
  const NAV_BOTTOM = [
    { to: '/app/badges',   label: t('nav.badges'),   Icon: IconStar },
    { to: '/app/referral', label: t('nav.referral'), Icon: IconStar },
    { to: '/app/profil',   label: t('nav.profil'),   Icon: IconProfil },
    { to: '/app/settings', label: t('nav.settings'), Icon: IconSettings },
  ]
  const [profilePhoto, setProfilePhoto] = useState<string|null>(null)
  const [profileName, setProfileName] = useState<string|null>(null)
  async function handleLogout() { await logout(); navigate('/') }

  useEffect(() => {
    const uid = user?.uid
    if (!uid) return
    const unsub = onSnapshot(doc(db, 'users', uid), (snap) => {
      if (snap.exists()) {
        const d = snap.data()
        const photo = d.photoBase64 || d.photoURL || null
        setProfilePhoto(photo)
        if (d.displayName) setProfileName(d.displayName)
      }
    }, () => {})
    return () => unsub()
  }, [user?.uid])

  return (
    <aside className="w-[220px] flex-shrink-0 flex flex-col h-screen sticky top-0"
      style={{ background: 'var(--tm-bg)', borderRight: '1px solid rgba(42,47,62,0.7)' }}>

      {/* ── Logo ── */}
      <div className="px-4 py-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        {/* Subtle gradient top line */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, var(--tm-accent), transparent)', opacity: 0.4 }} />
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(var(--tm-accent-rgb,0,229,255),0.1)', border: '1px solid rgba(var(--tm-accent-rgb,0,229,255),0.25)' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--tm-accent)" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
              <polyline points="16 7 22 7 22 13" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight" style={{ fontFamily: 'Syne, sans-serif', color: 'var(--tm-text-primary)' }}>TradeMindset</div>
            <div className="text-[9px] font-bold tracking-widest uppercase" style={{ color: 'var(--tm-accent)', marginTop: 1 }}>Pro</div>
          </div>
        </div>
      </div>

      {/* ── Main nav ── */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 flex flex-col gap-0.5">
        {NAV.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="no-underline block">
            {({ isActive }) => (
              <div className={`
                flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer relative
                transition-all duration-150 text-sm
                ${isActive
                  ? 'font-semibold'
                  : 'font-normal hover:bg-white/[0.04]'
                }
              `}
              style={{
                color: isActive ? 'var(--tm-accent)' : 'var(--tm-text-secondary)',
                background: isActive ? 'rgba(var(--tm-accent-rgb,0,229,255),0.1)' : undefined,
              }}>
                {/* Active indicator bar */}
                {isActive && (
                  <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full"
                    style={{ background: 'var(--tm-accent)', boxShadow: '0 0 8px var(--tm-accent)' }} />
                )}
                <Icon size={15} />
                <span>{label}</span>
              </div>
            )}
          </NavLink>
        ))}

        {/* Coach IA — temporairement masqué */}
      </nav>

      {/* ── Bottom ── */}
      <div className="px-2 pb-2 flex flex-col gap-0.5" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        {NAV_BOTTOM.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className="no-underline block">
            {({ isActive }) => (
              <div className={`
                flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer text-sm
                transition-all duration-150
                ${isActive ? 'font-semibold' : 'font-normal hover:bg-white/[0.04]'}
              `}
              style={{
                color: isActive ? 'var(--tm-accent)' : 'var(--tm-text-secondary)',
                background: isActive ? 'rgba(var(--tm-accent-rgb,0,229,255),0.1)' : undefined,
              }}>
                <Icon size={15} />
                <span>{label}</span>
              </div>
            )}
          </NavLink>
        ))}

        <div className="mt-1">
          <XPBar />
        </div>

        {/* User row */}
        <div className="flex items-center gap-2.5 px-3 py-2.5 mt-1 rounded-xl"
          style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #0A85FF33, #00E5FF33)', border: '1px solid rgba(var(--tm-accent-rgb,0,229,255),0.25)', color: 'var(--tm-accent)' }}>
            {profilePhoto
              ? <img src={profilePhoto} alt="" className="w-full h-full object-cover" />
              : (profileName || user?.displayName)?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? 'G'
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate" style={{ color: 'var(--tm-text-primary)' }}>
              {profileName || user?.displayName || 'Trader'}
            </div>
            <div className="text-[10px] truncate" style={{ color: 'var(--tm-text-muted)' }}>
              {user?.email}
            </div>
          </div>
          <NotificationBell />
          <button onClick={handleLogout} title={t('nav.logout')}
            className="p-1.5 rounded-lg transition-colors hover:bg-white/5 cursor-pointer"
            style={{ background: 'none', border: 'none', color: 'var(--tm-text-muted)' }}>
            <IconLogout size={14} />
          </button>
        </div>
      </div>
    </aside>
  )
}
