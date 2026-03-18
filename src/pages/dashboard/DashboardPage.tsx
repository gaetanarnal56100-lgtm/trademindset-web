// src/pages/dashboard/DashboardPage.tsx — Design premium
import { useState, useEffect, useRef } from 'react'
import { subscribeTrades, subscribeSystems, tradePnL, type Trade, type TradingSystem } from '@/services/firestore'

function fmt(n: number, decimals = 2) { return Math.abs(n).toFixed(decimals) }
function fmtPnL(n: number) { return `${n >= 0 ? '+' : '-'}$${fmt(n)}` }
function fmtDate(d: Date) { return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) }
function fmtPrice(p?: number) {
  if (!p) return '—'
  return p >= 1000 ? `$${p.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}` : `$${p.toFixed(4)}`
}

function PnLCurve({ trades }: { trades: Trade[] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)
    const closed = [...trades].filter(t => t.status === 'closed').sort((a, b) => a.date.getTime() - b.date.getTime())
    if (closed.length < 2) {
      ctx.font = '12px DM Sans'; ctx.fillStyle = '#3D4254'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('Pas assez de données', W / 2, H / 2); return
    }
    let cum = 0
    const pts = closed.map(t => { cum += tradePnL(t); return cum })
    const minV = Math.min(...pts, 0), maxV = Math.max(...pts, 0)
    const range = maxV - minV || 1
    const zY = H - ((-minV) / range) * H

    // Zero line
    ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, zY); ctx.lineTo(W, zY); ctx.stroke(); ctx.setLineDash([])

    const last = pts[pts.length - 1]
    const c = last >= 0 ? '#22C759' : '#FF3B30'

    // Area gradient
    ctx.beginPath()
    pts.forEach((v, i) => {
      const x = (i / (pts.length - 1)) * W, y = H - ((v - minV) / range) * H
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.lineTo(W, zY); ctx.lineTo(0, zY); ctx.closePath()
    const grad = ctx.createLinearGradient(0, 0, 0, H)
    grad.addColorStop(0, c + '30'); grad.addColorStop(1, c + '02')
    ctx.fillStyle = grad; ctx.fill()

    // Line
    ctx.beginPath(); ctx.strokeStyle = c; ctx.lineWidth = 1.5
    pts.forEach((v, i) => {
      const x = (i / (pts.length - 1)) * W, y = H - ((v - minV) / range) * H
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }); ctx.stroke()
  }, [trades])
  return <canvas ref={ref} width={600} height={100} style={{ width: '100%', height: 100, display: 'block' }} />
}

export default function DashboardPage() {
  const [trades,  setTrades]  = useState<Trade[]>([])
  const [systems, setSystems] = useState<TradingSystem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const u1 = subscribeTrades(t => { setTrades(t); setLoading(false) })
    const u2 = subscribeSystems(setSystems)
    return () => { u1(); u2() }
  }, [])

  const closed = trades.filter(t => t.status === 'closed')
  const open   = trades.filter(t => t.status === 'open')
  const pnls   = closed.map(tradePnL)
  const total  = pnls.reduce((a, b) => a + b, 0)
  const wins   = pnls.filter(p => p > 0).length
  const losses = pnls.filter(p => p <= 0).length
  const wr     = closed.length > 0 ? (wins / closed.length * 100).toFixed(1) : null
  const avgWin = wins > 0 ? pnls.filter(p => p > 0).reduce((a, b) => a + b, 0) / wins : 0
  const avgLoss = losses > 0 ? Math.abs(pnls.filter(p => p <= 0).reduce((a, b) => a + b, 0) / losses) : 0
  const rr     = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : null

  const systemName  = (id: string) => systems.find(s => s.id === id)?.name  ?? '—'
  const systemColor = (id: string) => systems.find(s => s.id === id)?.color ?? '#00E5FF'
  const recent      = [...trades].sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 6)

  const kpis = [
    { label: 'P&L Total',     value: loading ? null : fmtPnL(total),            color: total >= 0 ? '#22C759' : '#FF3B30', sub: `${closed.length} trades fermés` },
    { label: 'Win Rate',      value: loading ? null : (wr ? `${wr}%` : '—'),    color: '#F0F3FF', sub: `${wins}W / ${losses}L` },
    { label: 'Ratio R/R',     value: loading ? null : (rr ?? '—'),              color: '#00E5FF', sub: 'Rendement/Risque' },
    { label: 'Ouverts',       value: loading ? null : String(open.length),       color: open.length > 0 ? '#FF9500' : '#8F94A3', sub: 'Positions actives' },
  ]

  return (
    <div style={{ padding: '28px 28px 40px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#F0F3FF', margin: 0, fontFamily: 'Syne, sans-serif', letterSpacing: '-0.02em' }}>Dashboard</h1>
        <p style={{ fontSize: 13, color: '#555C70', margin: '4px 0 0' }}>
          {loading ? (
            <span style={{ color: '#3D4254' }}>Connexion à Firestore...</span>
          ) : (
            `${trades.length} trade${trades.length !== 1 ? 's' : ''} · ${open.length} ouvert${open.length !== 1 ? 's' : ''}`
          )}
        </p>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
        {kpis.map(({ label, value, color, sub }) => (
          <div key={label} style={{ background: '#161B22', border: '1px solid #1E2330', borderRadius: 16, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.05), transparent)' }} />
            <div style={{ fontSize: 11, color: '#555C70', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>{label}</div>
            {value === null ? (
              <div style={{ height: 28, background: '#1C2130', borderRadius: 6, marginBottom: 6, animation: 'shimmer 1.5s infinite' }} />
            ) : (
              <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '-0.02em', marginBottom: 4 }}>{value}</div>
            )}
            <div style={{ fontSize: 11, color: '#3D4254' }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* P&L Chart */}
      <div style={{ background: '#161B22', border: '1px solid #1E2330', borderRadius: 16, padding: '18px 20px', marginBottom: 20, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.05), transparent)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#F0F3FF' }}>Courbe P&L cumulée</div>
          {!loading && total !== 0 && (
            <div style={{ fontSize: 13, fontWeight: 700, color: total >= 0 ? '#22C759' : '#FF3B30', fontFamily: 'JetBrains Mono, monospace' }}>
              {fmtPnL(total)}
            </div>
          )}
        </div>
        <PnLCurve trades={trades} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Trades récents */}
        <div style={{ background: '#161B22', border: '1px solid #1E2330', borderRadius: 16, padding: '18px 20px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.05), transparent)' }} />
          <div style={{ fontSize: 13, fontWeight: 600, color: '#F0F3FF', marginBottom: 14 }}>Trades récents</div>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1,2,3].map(i => <div key={i} style={{ height: 44, background: '#1C2130', borderRadius: 10 }} />)}
            </div>
          ) : recent.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#3D4254', fontSize: 13 }}>Aucun trade</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {recent.map(t => {
                const pnl = tradePnL(t)
                return (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: t.type === 'Long' ? 'rgba(34,199,89,0.1)' : 'rgba(255,59,48,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>
                      {t.type === 'Long' ? '↑' : '↓'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#F0F3FF', fontFamily: 'JetBrains Mono, monospace' }}>{t.symbol}</div>
                      <div style={{ fontSize: 10, color: '#555C70' }}>{fmtDate(t.date)} · <span style={{ color: systemColor(t.systemId) }}>{systemName(t.systemId)}</span></div>
                    </div>
                    {t.status === 'open' ? (
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#FF9500', background: 'rgba(255,149,0,0.1)', padding: '2px 7px', borderRadius: 5 }}>OUVERT</div>
                    ) : (
                      <div style={{ fontSize: 12, fontWeight: 700, color: pnl >= 0 ? '#22C759' : '#FF3B30', fontFamily: 'JetBrains Mono, monospace' }}>{fmtPnL(pnl)}</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Stats */}
        <div style={{ background: '#161B22', border: '1px solid #1E2330', borderRadius: 16, padding: '18px 20px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.05), transparent)' }} />
          <div style={{ fontSize: 13, fontWeight: 600, color: '#F0F3FF', marginBottom: 14 }}>Statistiques</div>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[1,2,3,4,5].map(i => <div key={i} style={{ height: 20, background: '#1C2130', borderRadius: 6 }} />)}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { label: 'Trades fermés',   value: closed.length, color: '#F0F3FF' },
                { label: 'Gains',           value: wins,          color: '#22C759' },
                { label: 'Pertes',          value: losses,        color: '#FF3B30' },
                { label: 'Gain moyen',      value: `+$${fmt(avgWin)}`,         color: '#22C759' },
                { label: 'Perte moyenne',   value: `-$${fmt(avgLoss)}`,        color: '#FF3B30' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: '#8F94A3' }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color, fontFamily: 'JetBrains Mono, monospace' }}>{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}`}</style>
    </div>
  )
}
