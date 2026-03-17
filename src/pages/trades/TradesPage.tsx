// src/pages/trades/TradesPage.tsx
import { IconTrades } from '@/components/ui/Icons'
export default function TradesPage() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-3"><IconTrades size={22} /> Trades</h1>
        <p className="text-sm text-text-secondary mt-1">Journal de tous vos trades</p>
      </div>
      <div className="card flex flex-col items-center gap-3 py-12 text-text-tertiary">
        <IconTrades size={36} />
        <div className="text-sm">Section Trades — en cours de développement</div>
        <div className="text-xs text-text-muted">Les trades Firebase se chargent déjà via le store</div>
      </div>
    </div>
  )
}
