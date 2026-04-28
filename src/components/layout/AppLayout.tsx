import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import MobileNav from './MobileNav'
import NewsTickerBanner from '@/components/dashboard/NewsTickerBanner'
import { ToastContainer } from '@/components/notifications/NotificationBell'

export default function AppLayout() {
  return (
    <div className="flex min-h-screen" style={{ background:"var(--tm-bg)", color:"var(--tm-text-primary)", minHeight:"100vh" }}>
      <div className="hidden lg:flex">
        <Sidebar />
      </div>
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* News ticker — tout en haut, persistant sur toutes les pages */}
        <NewsTickerBanner />
        <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">
          <Outlet />
        </main>
      </div>
      <ToastContainer />
      <div className="lg:hidden">
        <MobileNav />
      </div>
    </div>
  )
}
