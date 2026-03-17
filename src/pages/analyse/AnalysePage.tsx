// src/pages/analyse/AnalysePage.tsx
import { IconAnalyse } from '@/components/ui/Icons'
export default function AnalysePage() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-3"><IconAnalyse size={22} /> Analyse</h1>
        <p className="text-sm text-text-secondary mt-1">Analyse AI des charts · Indicateurs MTF · Dérivés</p>
      </div>
      <div className="card flex flex-col items-center gap-3 py-12 text-text-tertiary">
        <IconAnalyse size={36} />
        <div className="text-sm">Section Analyse — en cours de développement</div>
        <div className="text-xs text-center max-w-xs">Photo Analysis · VMC · Wave Trend · RSI MTF · Liquidity Dashboard</div>
      </div>
    </div>
  )
}
