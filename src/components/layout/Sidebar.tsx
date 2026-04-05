// src/components/layout/Sidebar.tsx
import XPBar from '@/components/gamification/XPBar'
import { useState, useEffect } from 'react'
import NotificationBell from '@/components/notifications/NotificationBell'
import { NavLink, useNavigate } from 'react-router-dom'
import { logout } from '@/services/firebase/auth'
import { useUser } from '@/hooks/useAuth'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/services/firebase/config'
import {
  IconDashboard, IconTrades, IconAnalyse, IconJournal,
  IconAlertes, IconSystemes, IconProfil, IconSettings, IconLogout, IconCalendrier, IconStar, IconAI, IconMarches,
} from '@/components/ui/Icons'

const NAV = [
  { to: '/',           label: 'Dashboard',  Icon: IconDashboard,  end: true },
  { to: '/trades',     label: 'Trades',     Icon: IconTrades },
  { to: '/analyse',    label: 'Analyse',    Icon: IconAnalyse },
  { to: '/marches',    label: 'Marchés',    Icon: IconMarches },
  { to: '/journal',    label: 'Journal',    Icon: IconJournal },
  { to: '/alertes',    label: 'Alertes',    Icon: IconAlertes },
  { to: '/calendrier', label: 'Calendrier', Icon: IconCalendrier },
  { to: '/systemes',   label: 'Systèmes',   Icon: IconSystemes },
]
const NAV_BOTTOM = [
    { to: '/badges', label: 'Badges', Icon: IconStar },
  { to: '/referral', label: 'Parrainage', Icon: IconStar },
  { to: '/profil',   label: 'Profil',     Icon: IconProfil },
  { to: '/settings', label: 'Paramètres', Icon: IconSettings },
]

export default function Sidebar() {
  const user     = useUser()
  const navigate = useNavigate()
  const [profilePhoto, setProfilePhoto] = useState<string|null>(null)
  const [profileName, setProfileName] = useState<string|null>(null)
  async function handleLogout() { await logout(); navigate('/login') }

  // Subscribe to Firestore user doc for live photo/name updates
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
    }, () => { /* ignore errors */ })
    return () => unsub()
  }, [user?.uid])

  return (
    <aside style={{
      width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column',
      height: '100vh', position: 'sticky', top: 0,
      background: 'var(--tm-bg)',
      borderRight: '1px solid var(--tm-border)',
    }}>
      {/* Logo */}
      <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(var(--tm-accent-rgb,0,229,255),0.1)', border: '1px solid rgba(var(--tm-accent-rgb,0,229,255),0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--tm-accent)" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
              <polyline points="16 7 22 7 22 13" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-primary)', fontFamily: 'Syne, sans-serif', letterSpacing: '-0.01em' }}>TradeMindset</div>
            <div style={{ fontSize: 9, color: 'var(--tm-accent)', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 1 }}>Pro</div>
          </div>
        </div>
      </div>

      {/* Main nav */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} style={{ textDecoration: 'none' }}>
            {({ isActive }) => (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px', borderRadius: 10, cursor: 'pointer',
                fontSize: 13, fontWeight: isActive ? 500 : 400,
                color: isActive ? 'var(--tm-accent)' : 'var(--tm-text-secondary)',
                background: isActive ? 'rgba(var(--tm-accent-rgb,0,229,255),0.08)' : 'transparent',
                position: 'relative',
                transition: 'all 0.15s',
              }}>
                {isActive && <div style={{ position: 'absolute', left: 0, top: '25%', bottom: '25%', width: 2, borderRadius: 99, background: 'var(--tm-accent)' }} />}
                <Icon size={16} />
                {label}
              </div>
            )}
          </NavLink>
        ))}

        {/* Coach IA — Coming Soon */}
        <div
          title="Bientôt disponible"
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 12px', borderRadius: 10, cursor: 'not-allowed',
            fontSize: 13, fontWeight: 400,
            color: 'var(--tm-text-muted)',
            opacity: 0.7,
            position: 'relative',
          }}
        >
          <IconAI size={16} />
          <span>Coach IA</span>
          <span style={{
            marginLeft: 'auto',
            fontSize: 9, fontWeight: 700,
            padding: '2px 6px', borderRadius: 99,
            background: 'linear-gradient(135deg, #BF5AF222, #0A85FF22)',
            border: '1px solid #BF5AF244',
            color: '#BF5AF2',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>
            Soon
          </span>
        </div>
      </nav>

      {/* Bottom */}
      <div style={{ padding: '8px 8px 8px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV_BOTTOM.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} style={{ textDecoration: 'none' }}>
            {({ isActive }) => (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 13, color: isActive ? 'var(--tm-accent)' : 'var(--tm-text-secondary)', background: isActive ? 'rgba(var(--tm-accent-rgb,0,229,255),0.08)' : 'transparent', transition: 'all 0.15s' }}>
                <Icon size={16} />
                {label}
              </div>
            )}
          </NavLink>
        ))}

          <XPBar />
          {/* User row */}
        <div style={{ marginTop: 6, padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, #0A85FF33, #00E5FF33)', border: '1px solid rgba(var(--tm-accent-rgb,0,229,255),0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--tm-accent)', flexShrink: 0, overflow: 'hidden' }}>
            {profilePhoto ? (
              <img src={profilePhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              (profileName || user?.displayName)?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? 'G'
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--tm-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {profileName || user?.displayName || 'Trader'}
            </div>
            <div style={{ fontSize: 10, color: 'var(--tm-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.email}
            </div>
          </div>
          <NotificationBell />
          <button onClick={handleLogout} title="Déconnexion" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, color: 'var(--tm-text-muted)', display: 'flex', alignItems: 'center' }}>
            <IconLogout size={14} />
          </button>
        </div>
      </div>
    </aside>
  )
}
