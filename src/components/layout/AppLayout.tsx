// src/components/layout/AppLayout.tsx
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import MobileNav from './MobileNav'

export default function AppLayout() {
  return (
    <div className="flex min-h-screen bg-bg-primary">
      {/* Sidebar desktop */}
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

      {/* Content */}
      <main className="flex-1 min-w-0 overflow-y-auto pb-20 lg:pb-0">
        <Outlet />
      </main>

      {/* Bottom nav mobile */}
      <div className="lg:hidden">
        <MobileNav />
      </div>
    </div>
  )
}
