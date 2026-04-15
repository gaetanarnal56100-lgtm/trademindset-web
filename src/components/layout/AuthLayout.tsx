// src/components/layout/AuthLayout.tsx
import { Outlet, Link } from 'react-router-dom'

export default function AuthLayout() {
  return (
    <div className="min-h-screen bg-bg-primary grid-pattern flex items-center justify-center p-4">
      {/* Glow ambiance */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full bg-brand-cyan opacity-[0.04] blur-[100px] pointer-events-none" />

      <div className="w-full max-w-md">
        {/* Logo */}
        <Link to="/" className="flex flex-col items-center gap-3 mb-8" style={{ textDecoration: 'none' }}>
          <div className="w-12 h-12 rounded-2xl bg-brand-cyan bg-opacity-10 border border-brand-cyan border-opacity-20 flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--tm-accent)" strokeWidth="2" strokeLinecap="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
              <polyline points="16 7 22 7 22 13" />
            </svg>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold text-text-primary font-display">TradeMindset</div>
            <div className="text-xs text-text-tertiary mt-0.5">Journal de trading professionnel</div>
          </div>
        </Link>

        {/* Page content */}
        <Outlet />
      </div>
    </div>
  )
}
