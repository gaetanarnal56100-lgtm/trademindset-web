// src/components/layout/PublicLayout.tsx
import { Link, Outlet } from 'react-router-dom'

export default function PublicLayout() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--tm-bg)', color: 'var(--tm-text-primary)' }}>
      {/* Fixed Navbar */}
      <header style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        height: 64,
        background: 'rgba(10,14,23,0.85)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--tm-border)',
        display: 'flex', alignItems: 'center',
        padding: '0 32px',
      }}>
        <div style={{ maxWidth: 1200, width: '100%', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Logo */}
          <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 10,
              background: 'rgba(0,229,255,0.1)',
              border: '1px solid rgba(0,229,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--tm-accent)" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                <polyline points="16 7 22 7 22 13" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--tm-text-primary)', fontFamily: 'Syne, sans-serif', letterSpacing: '-0.01em' }}>TradeMindset</div>
              <div style={{ fontSize: 9, color: 'var(--tm-accent)', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Pro</div>
            </div>
          </Link>

          {/* CTA buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link to="/login" style={{
              textDecoration: 'none',
              padding: '8px 18px',
              borderRadius: 8,
              fontSize: 13, fontWeight: 500,
              color: 'var(--tm-text-secondary)',
              background: 'transparent',
              border: '1px solid var(--tm-border)',
              transition: 'all 0.15s',
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--tm-text-primary)'; (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(0,229,255,0.3)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--tm-text-secondary)'; (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--tm-border)' }}
            >
              Se connecter
            </Link>
            <Link to="/signup" style={{
              textDecoration: 'none',
              padding: '8px 20px',
              borderRadius: 8,
              fontSize: 13, fontWeight: 600,
              color: '#0a0e17',
              background: 'var(--tm-accent)',
              border: '1px solid transparent',
              transition: 'all 0.15s',
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '0.9' }}
              onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '1' }}
            >
              Commencer gratuitement
            </Link>
          </div>
        </div>
      </header>

      {/* Page content (offset for navbar) */}
      <div style={{ paddingTop: 64 }}>
        <Outlet />
      </div>
    </div>
  )
}
