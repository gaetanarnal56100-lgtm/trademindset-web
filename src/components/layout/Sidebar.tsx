// src/components/layout/Sidebar.tsx — Flat Design v3 + collapsible
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

  // Collapsible state persisted in localStorage
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('sidebar_collapsed') === 'true' } catch { return false }
  })

  const toggleCollapsed = () => {
    setCollapsed(c => {
      const next = !c
      try { localStorage.setItem('sidebar_collapsed', String(next)) } catch { /* noop */ }
      return next
    })
  }

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

  const w = collapsed ? 64 : 220

  return (
    <aside
      style={{
        width: w, flexShrink: 0,
        display: 'flex', flexDirection: 'column', height: '100vh',
        position: 'sticky', top: 0,
        background: 'var(--tm-bg)',
        borderRight: '1px solid rgba(42,47,62,0.7)',
        transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
        overflow: 'hidden',
      }}
    >
      {/* ── Logo ── */}
      <div
        style={{
          padding: collapsed ? '16px 0' : '16px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          display: 'flex', alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: 10, position: 'relative',
        }}
      >
        {/* Subtle gradient top line */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, var(--tm-accent), transparent)', opacity: 0.4 }} />
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(var(--tm-accent-rgb,0,229,255),0.1)', border: '1px solid rgba(var(--tm-accent-rgb,0,229,255),0.25)' }}
          title="TradeMindset"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--tm-accent)" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
            <polyline points="16 7 22 7 22 13" />
          </svg>
        </div>
        {!collapsed && (
          <div>
            <div className="text-sm font-bold tracking-tight" style={{ fontFamily: 'Syne, sans-serif', color: 'var(--tm-text-primary)' }}>TradeMindset</div>
            <div className="text-[9px] font-bold tracking-widest uppercase" style={{ color: 'var(--tm-accent)', marginTop: 1 }}>Pro</div>
          </div>
        )}
      </div>

      {/* ── Main nav ── */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 8px 0', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="no-underline block">
            {({ isActive }) => (
              <div
                title={collapsed ? label : undefined}
                style={{
                  display: 'flex', alignItems: 'center',
                  gap: collapsed ? 0 : 10,
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  padding: collapsed ? '10px 0' : '9px 12px',
                  borderRadius: 10, cursor: 'pointer', position: 'relative',
                  transition: 'all 0.15s',
                  color: isActive ? 'var(--tm-accent)' : 'var(--tm-text-secondary)',
                  background: isActive ? 'rgba(var(--tm-accent-rgb,0,229,255),0.1)' : undefined,
                  fontWeight: isActive ? 600 : 400,
                  fontSize: 13,
                }}
                className={isActive ? '' : 'hover:bg-white/[0.04]'}
              >
                {isActive && (
                  <div style={{
                    position: 'absolute', left: 0, top: '25%', bottom: '25%',
                    width: 3, borderRadius: 2,
                    background: 'var(--tm-accent)',
                    boxShadow: '0 0 8px var(--tm-accent)',
                  }} />
                )}
                <Icon size={16} />
                {!collapsed && <span style={{ marginLeft: 2 }}>{label}</span>}
              </div>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ── Bottom nav ── */}
      <div style={{ padding: '4px 8px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV_BOTTOM.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className="no-underline block">
            {({ isActive }) => (
              <div
                title={collapsed ? label : undefined}
                style={{
                  display: 'flex', alignItems: 'center',
                  gap: collapsed ? 0 : 10,
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  padding: collapsed ? '9px 0' : '8px 12px',
                  borderRadius: 10, cursor: 'pointer',
                  transition: 'all 0.15s',
                  color: isActive ? 'var(--tm-accent)' : 'var(--tm-text-secondary)',
                  background: isActive ? 'rgba(var(--tm-accent-rgb,0,229,255),0.1)' : undefined,
                  fontWeight: isActive ? 600 : 400,
                  fontSize: 13,
                }}
                className={isActive ? '' : 'hover:bg-white/[0.04]'}
              >
                <Icon size={15} />
                {!collapsed && <span>{label}</span>}
              </div>
            )}
          </NavLink>
        ))}

        {!collapsed && (
          <div style={{ marginTop: 4 }}>
            <XPBar />
          </div>
        )}

        {/* Collapse toggle button */}
        <button
          onClick={toggleCollapsed}
          title={collapsed ? 'Déplier la barre' : 'Réduire la barre'}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 6, padding: '8px',
            borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)',
            background: 'rgba(255,255,255,0.03)',
            color: 'var(--tm-text-muted)', cursor: 'pointer',
            fontSize: 12, transition: 'all 0.15s', marginTop: 4,
          }}
          className="hover:bg-white/[0.06] hover:text-text-secondary"
        >
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transition: 'transform 0.25s', transform: collapsed ? 'rotate(180deg)' : 'none' }}
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {!collapsed && <span style={{ fontSize: 11 }}>Réduire</span>}
        </button>

        {/* User row */}
        <div
          style={{
            display: 'flex', alignItems: 'center',
            gap: collapsed ? 0 : 10,
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? '10px 0' : '10px 4px',
            marginTop: 4,
            borderTop: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <div
            style={{
              width: 28, height: 28, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, flexShrink: 0, overflow: 'hidden',
              background: 'linear-gradient(135deg, #0A85FF33, #00E5FF33)',
              border: '1px solid rgba(var(--tm-accent-rgb,0,229,255),0.25)',
              color: 'var(--tm-accent)',
            }}
            title={collapsed ? (profileName || user?.displayName || 'Trader') : undefined}
          >
            {profilePhoto
              ? <img src={profilePhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : (profileName || user?.displayName)?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? 'G'
            }
          </div>
          {!collapsed && (
            <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--tm-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {profileName || user?.displayName || 'Trader'}
                </div>
                <div style={{ fontSize: 10, color: 'var(--tm-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user?.email}
                </div>
              </div>
              <NotificationBell />
              <button
                onClick={handleLogout}
                title={t('nav.logout')}
                style={{
                  padding: 6, borderRadius: 8,
                  background: 'none', border: 'none',
                  color: 'var(--tm-text-muted)', cursor: 'pointer',
                  transition: 'color 0.15s',
                }}
                className="hover:bg-white/5"
              >
                <IconLogout size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  )
}
