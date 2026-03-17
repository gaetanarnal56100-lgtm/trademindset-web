import { IconAlertes } from '@/components/ui/Icons'
export default function AlertesPage() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-3"><IconAlertes size={22} /> Alertes</h1>
        <p className="text-sm text-text-secondary mt-1">Alertes TradingView · Webhooks · Notifications</p>
      </div>
      <div className="card flex flex-col items-center gap-3 py-12 text-text-tertiary">
        <IconAlertes size={36} />
        <div className="text-sm">Section Alertes — en cours de développement</div>
      </div>
    </div>
  )
}
