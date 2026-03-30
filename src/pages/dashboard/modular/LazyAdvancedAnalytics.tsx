// ─── LazyAdvancedAnalytics ───────────────────────────────────────────────────
// Réutilise les données du WidgetDataContext pour les analytics avancées.

import { useContext, useState, useMemo } from 'react'
import { WidgetDataContext } from './WidgetDataContext'
import { tradePnL } from '@/services/firestore'

function fmtK(n: number) {
  const abs = Math.abs(n), s = n < 0 ? '-' : '+'
  if (abs >= 1_000_000) return `${s}$${(abs/1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `${s}$${(abs/1_000).toFixed(1)}K`
  return `${s}$${abs.toFixed(2)}`
}

type MainTab = 'analytics' | 'metrics' | 'calendar'
type MetricsTab = 'month' | 'session' | 'day'

export default function LazyAdvancedAnalytics() {
  const { trades, loading } = useContext(WidgetDataContext)
  const [tab, setTab] = useState<MainTab>('analytics')
  const [metricsTab, setMetricsTab] = useState<MetricsTab>('month')

  const closed = useMemo(() => trades.filter(t => t.status === 'closed'), [trades])

  const months = useMemo(() => {
    const map: Record<string,number> = {}
    for (const t of closed) {
      const k = t.date.toLocaleDateString('fr-FR', { month:'short' })
      map[k] = (map[k]||0) + tradePnL(t)
    }
    const order = ['jan.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.']
    return order.filter(m => map[m] != null).map(m => ({ label:m.slice(0,3), full:m, value:map[m]! }))
  }, [closed])

  const maxAbsM = Math.max(...months.map(m => Math.abs(m.value)), 1)

  const dayData = useMemo(() => {
    const days = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim']
    return days.map((name, i) => {
      const dt = closed.filter(t => { const d = t.date.getDay(); return (d===0?6:d-1)===i })
      return { name, pnl:dt.reduce((a,t)=>a+tradePnL(t),0), count:dt.length }
    })
  }, [closed])

  const sessions = useMemo(() => [
    { name:'Asie',     s:0,  e:8  },
    { name:'Londres',  s:8,  e:16 },
    { name:'New York', s:13, e:21 },
  ].map(r => {
    const rt = closed.filter(t => { const h = t.date.getHours(); return h>=r.s && h<r.e })
    return { ...r, pnl:rt.reduce((a,t)=>a+tradePnL(t),0), count:rt.length }
  }), [closed])

  const tabBtn = (id: MainTab, label: string) => (
    <button onClick={() => setTab(id)}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border
        ${tab===id ? 'border-transparent text-white' : 'border-border text-text-muted hover:text-text-secondary'}`}
      style={tab===id ? { background:'linear-gradient(135deg,#6B3FE7,#BF5AF2)' } : {}}>
      {label}
    </button>
  )

  if (loading) return <div className="p-4 text-xs text-text-muted animate-pulse">Chargement…</div>

  return (
    <div className="p-4 flex flex-col gap-4 h-full overflow-auto">
      <div>
        <div className="text-sm font-bold text-text-primary">Advanced Analytics</div>
        <div className="text-[10px] text-text-muted">Analyse de performance en détail</div>
      </div>
      <div className="flex gap-2 flex-wrap">
        {tabBtn('analytics','📊 Analytics')}
        {tabBtn('metrics','🕐 Metrics')}
      </div>

      {tab === 'analytics' && (
        <div className="flex flex-col gap-3">
          <div className="text-xs font-semibold text-text-secondary">Performance par mois</div>
          {months.length === 0
            ? <div className="text-xs text-text-muted text-center py-4">Pas de données</div>
            : <>
                <div className="flex items-end gap-1 h-24">
                  {months.map((m, i) => {
                    const h = Math.max((Math.abs(m.value)/maxAbsM)*100, 4)
                    const c = m.value>=0 ? 'var(--tm-profit)' : 'var(--tm-loss)'
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${m.full}: ${fmtK(m.value)}`}>
                        <div className="w-full rounded-t-sm transition-all" style={{ height:`${h}%`, background:c, opacity:0.8 }} />
                        <span className="text-[8px] text-text-muted">{m.label}</span>
                      </div>
                    )
                  })}
                </div>
              </>
          }
        </div>
      )}

      {tab === 'metrics' && (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            {(['month','session','day'] as MetricsTab[]).map(t => (
              <button key={t} onClick={() => setMetricsTab(t)}
                className={`px-2 py-1 rounded-full text-[10px] font-semibold border transition-all
                  ${metricsTab===t ? 'border-brand-blue/50 bg-brand-blue/15 text-brand-blue' : 'border-border text-text-muted'}`}>
                {t==='month'?'Mois':t==='session'?'Session':'Jour'}
              </button>
            ))}
          </div>

          {metricsTab === 'month' && (
            <div className="flex flex-col gap-1.5">
              {months.map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] text-text-muted w-8">{m.label}</span>
                  <div className="flex-1 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width:`${Math.abs(m.value)/maxAbsM*100}%`, background:m.value>=0?'var(--tm-profit)':'var(--tm-loss)' }} />
                  </div>
                  <span className="text-[10px] font-mono font-semibold w-20 text-right" style={{ color:m.value>=0?'var(--tm-profit)':'var(--tm-loss)' }}>{fmtK(m.value)}</span>
                </div>
              ))}
            </div>
          )}

          {metricsTab === 'session' && (
            <div className="grid grid-cols-3 gap-2">
              {sessions.map(s => (
                <div key={s.name} className="bg-bg-tertiary rounded-xl p-3">
                  <div className="text-[10px] font-semibold text-text-secondary mb-1">{s.name}</div>
                  <div className="text-sm font-bold font-mono" style={{ color:s.pnl>=0?'var(--tm-profit)':'var(--tm-loss)' }}>{fmtK(s.pnl)}</div>
                  <div className="text-[9px] text-text-muted mt-1">{s.count} trades</div>
                </div>
              ))}
            </div>
          )}

          {metricsTab === 'day' && (
            <div className="grid grid-cols-4 gap-2">
              {dayData.map(d => (
                <div key={d.name} className="bg-bg-tertiary rounded-xl p-3">
                  <div className="text-[10px] font-semibold text-text-secondary mb-1">{d.name}</div>
                  <div className="text-sm font-bold font-mono" style={{ color:d.pnl>=0?'var(--tm-profit)':'var(--tm-loss)' }}>{fmtK(d.pnl)}</div>
                  <div className="text-[9px] text-text-muted mt-1">{d.count} trades</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
