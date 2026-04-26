import { Outlet } from 'react-router-dom'
import { useEffect } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/services/firebase/config'
import { cfSync } from '@/pages/journal/ExchangeSyncModal'
import Sidebar from './Sidebar'
import MobileNav from './MobileNav'
import NewsTickerBanner from '@/components/dashboard/NewsTickerBanner'
import { ToastContainer } from '@/components/notifications/NotificationBell'

const ACTIVE_EXCHANGES = [
  'binance','bybit','okx','kucoinfutures','bitget','gateio',
  'mexc','htx','kraken','phemex','deribit','oanda','ig',
  'capitalcom','alpaca','tastytrade','trading212',
] as const
type Ex = typeof ACTIVE_EXCHANGES[number]
const cfGetStatus = httpsCallable<{ exchange: Ex }, { connected: boolean }>(functions, 'getExchangeKeyStatus')

// Sync toutes les exchanges connectées — au chargement de l'app puis toutes les 5 min
function useGlobalAutoSync() {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null

    async function doSync() {
      try {
        const statuses = await Promise.all(
          ACTIVE_EXCHANGES.map(ex => cfGetStatus({ exchange: ex }).catch(() => ({ data: { connected: false } })))
        )
        const connected = ACTIVE_EXCHANGES.filter((_, i) => statuses[i].data.connected)
        if (connected.length > 0) {
          await Promise.allSettled(connected.map(ex => cfSync({ exchange: ex as any })))
        }
      } catch { /* ignore */ }
    }

    // Sync 3s après le chargement (laisse le temps à Firebase Auth de s'initialiser)
    const initial = setTimeout(doSync, 3_000)
    // Puis toutes les 5 minutes
    timer = setInterval(doSync, 300_000)
    return () => { clearTimeout(initial); if (timer) clearInterval(timer) }
  }, [])
}

export default function AppLayout() {
  useGlobalAutoSync()
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
