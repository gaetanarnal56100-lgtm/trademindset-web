// ─── LazyCalendarHeatmap ─────────────────────────────────────────────────────
// Wrapper léger qui récupère les trades depuis le WidgetDataContext
// et réutilise le composant CalendarHeatmap de DashboardPage.

import { useContext, useState } from 'react'
import { WidgetDataContext } from './WidgetDataContext'
import { tradePnL } from '@/services/firestore'

// ── Inline minimal heatmap (no circular import) ───────────────────────────────
function fmtK(n: number) {
  const abs = Math.abs(n), s = n < 0 ? '-' : '+'
  if (abs >= 1_000_000) return `${s}$${(abs/1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `${s}$${(abs/1_000).toFixed(1)}K`
  return `${s}$${abs.toFixed(2)}`
}

export default function LazyCalendarHeatmap() {
  const { trades, loading } = useContext(WidgetDataContext)
  const [period, setPeriod] = useState('1M')

  const days = period==='7j'?7:period==='1M'?30:period==='3M'?90:period==='6M'?180:365
  const since = new Date(Date.now() - days * 86400000)
  const today = new Date(); today.setHours(0,0,0,0)

  const byDay: Record<string,{pnl:number,count:number}> = {}
  for (const t of trades.filter(t => t.status==='closed' && t.date >= since)) {
    const k = t.date.toISOString().slice(0,10)
    if (!byDay[k]) byDay[k] = { pnl:0, count:0 }
    byDay[k].pnl += tradePnL(t)
    byDay[k].count++
  }

  const maxAbs = Math.max(...Object.values(byDay).map(d => Math.abs(d.pnl)), 1)
  const startDay = new Date(today); startDay.setDate(today.getDate()-days+1)
  const gridStart = new Date(startDay); gridStart.setDate(gridStart.getDate()-gridStart.getDay())
  const cells: { date:Date; key:string; inRange:boolean }[] = []
  const d = new Date(gridStart)
  while (d <= today || cells.length % 7 !== 0) {
    const key = d.toISOString().slice(0,10)
    cells.push({ date:new Date(d), key, inRange:d>=startDay&&d<=today })
    d.setDate(d.getDate()+1)
  }

  if (loading) return <div className="h-20 bg-bg-tertiary rounded-xl animate-pulse mx-4 my-3" />

  return (
    <div className="p-4 flex flex-col gap-3 h-full overflow-auto">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] font-semibold text-text-secondary">Heatmap P&L</div>
          <div className="text-[10px] text-text-muted">Cliquez sur un jour pour le détail</div>
        </div>
        <div className="flex gap-1">
          {['7j','1M','3M','6M','1A'].map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all border
                ${period===p ? 'border-brand-blue/50 bg-brand-blue/15 text-brand-blue' : 'border-border text-text-muted hover:text-text-secondary'}`}>
              {p}
            </button>
          ))}
        </div>
      </div>
      {/* Day labels */}
      <div className="grid gap-0.5" style={{ gridTemplateColumns:'repeat(7,1fr)' }}>
        {['D','L','M','M','J','V','S'].map((l,i) => (
          <div key={i} className="text-[8px] text-text-muted text-center font-semibold">{l}</div>
        ))}
      </div>
      {/* Grid */}
      <div className="grid gap-0.5" style={{ gridTemplateColumns:'repeat(7,1fr)' }}>
        {cells.map(({ date, key, inRange }) => {
          const data = byDay[key]; const pnl = data?.pnl
          const intensity = pnl != null ? Math.min(Math.abs(pnl)/maxAbs, 1) : 0
          const isToday = date.toDateString() === today.toDateString()
          let bg = 'rgba(255,255,255,0.03)'
          if (inRange && pnl != null) bg = pnl>0 ? `rgba(34,199,89,${0.12+intensity*0.68})` : `rgba(255,59,48,${0.12+intensity*0.68})`
          else if (!inRange) bg = 'transparent'
          return (
            <div key={key} title={inRange&&data?`${key}: ${fmtK(pnl!)}`:undefined}
              className="aspect-square rounded-sm transition-transform hover:scale-110 cursor-pointer"
              style={{ background:bg, border: isToday?'1px solid rgba(255,255,255,0.3)':'1px solid transparent' }}
            />
          )
        })}
      </div>
      <div className="flex gap-2 items-center justify-end">
        <div className="w-2 h-2 rounded-sm bg-profit opacity-70"/><span className="text-[9px] text-text-muted">Gains</span>
        <div className="w-2 h-2 rounded-sm bg-loss opacity-70 ml-2"/><span className="text-[9px] text-text-muted">Pertes</span>
      </div>
    </div>
  )
}
