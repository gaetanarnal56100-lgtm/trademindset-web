// PnLChart.tsx — Courbe P&L professionnelle pour trader
// Canvas custom : crosshair, tooltip riche, drawdown ombré, filtres période, stats inline
// Design : dark premium, monospace accent, zéro dépendances externes

import { useMemo, useRef, useEffect, useState, useCallback } from 'react'
import type { Trade } from '@/types'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

// ── Types ──────────────────────────────────────────────────────────────────

interface DataPoint {
  date: Date
  dateLabel: string
  cumPnL: number
  tradePnL: number
  symbol: string
  direction: 'long' | 'short'
  drawdown: number      // drawdown depuis le peak
  peakPnL: number
}

type Period = '1W' | '1M' | '3M' | '6M' | 'YTD' | 'ALL'

const PERIOD_LABELS: Record<Period, string> = {
  '1W':'1 sem','1M':'1 mois','3M':'3 mois','6M':'6 mois','YTD':'YTD','ALL':'Tout'
}

// ── Data Builder ───────────────────────────────────────────────────────────

function buildData(trades: Trade[], period: Period): DataPoint[] {
  const now = new Date()
  const cutoff: Date = (() => {
    switch(period) {
      case '1W':  return new Date(now.getTime() - 7*86400000)
      case '1M':  return new Date(now.getTime() - 30*86400000)
      case '3M':  return new Date(now.getTime() - 90*86400000)
      case '6M':  return new Date(now.getTime() - 180*86400000)
      case 'YTD': return new Date(now.getFullYear(), 0, 1)
      default:    return new Date(0)
    }
  })()

  const closed = trades
    .filter(t => t.status === 'closed' && t.pnl !== undefined && t.exitDate && t.exitDate >= cutoff)
    .sort((a,b) => a.exitDate!.getTime() - b.exitDate!.getTime())

  // Calcul cumulatif + drawdown depuis le début de la période
  // Pour ALL, on part de 0. Pour les autres on part du P&L cumulé avant le cutoff
  let startBase = 0
  if (period !== 'ALL') {
    const before = trades
      .filter(t => t.status === 'closed' && t.pnl !== undefined && t.exitDate && t.exitDate < cutoff)
      .reduce((s, t) => s + (t.pnl ?? 0), 0)
    startBase = before
  }

  let cumPnL = startBase
  let peakPnL = startBase
  return closed.map(t => {
    cumPnL += t.pnl!
    if (cumPnL > peakPnL) peakPnL = cumPnL
    const drawdown = peakPnL > 0 ? ((peakPnL - cumPnL) / Math.abs(peakPnL)) * 100 : 0
    return {
      date:      t.exitDate!,
      dateLabel: format(t.exitDate!, 'dd MMM yy', { locale: fr }),
      cumPnL:    Math.round(cumPnL * 100) / 100,
      tradePnL:  Math.round((t.pnl ?? 0) * 100) / 100,
      symbol:    t.symbol,
      direction: t.direction,
      drawdown:  Math.round(drawdown * 10) / 10,
      peakPnL:   Math.round(peakPnL * 100) / 100,
    }
  })
}

// ── Format helpers ─────────────────────────────────────────────────────────

function fmtPnL(v: number): string {
  const abs = Math.abs(v)
  const sign = v >= 0 ? '+' : '-'
  if (abs >= 1_000_000) return `${sign}$${(abs/1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `${sign}$${(abs/1_000).toFixed(1)}k`
  return `${sign}$${abs.toFixed(2)}`
}

// ── Stats from data ────────────────────────────────────────────────────────

function computeStats(data: DataPoint[]) {
  if (data.length === 0) return null
  const totalPnL    = data[data.length-1].cumPnL - (data[0].cumPnL - data[0].tradePnL)
  const wins        = data.filter(d => d.tradePnL > 0)
  const losses      = data.filter(d => d.tradePnL < 0)
  const winRate     = data.length > 0 ? wins.length / data.length : 0
  const maxDrawdown = Math.max(...data.map(d => d.drawdown), 0)
  const bestTrade   = Math.max(...data.map(d => d.tradePnL))
  const worstTrade  = Math.min(...data.map(d => d.tradePnL))
  const avgWin      = wins.length > 0 ? wins.reduce((s,d) => s+d.tradePnL, 0)/wins.length : 0
  const avgLoss     = losses.length > 0 ? losses.reduce((s,d) => s+d.tradePnL, 0)/losses.length : 0
  const payoff      = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0
  return { totalPnL, winRate, maxDrawdown, bestTrade, worstTrade, avgWin, avgLoss, payoff, count: data.length }
}

// ── Canvas Chart ───────────────────────────────────────────────────────────

const COLORS = {
  profit:    '#22C759',
  loss:      '#FF3B30',
  drawdown:  'rgba(255,59,48,0.15)',
  grid:      'rgba(255,255,255,0.04)',
  zeroline:  'rgba(255,255,255,0.1)',
  crosshair: 'rgba(255,255,255,0.25)',
  text:      '#555C70',
  bg:        '#0D1117',
}

interface TooltipData {
  x: number; y: number
  point: DataPoint
  pct: number        // pct distance dans le dataset
}

export default function PnLChart({ trades }: { trades: Trade[] }) {
  const [period, setPeriod]   = useState<Period>('ALL')
  const [tooltip, setTooltip] = useState<TooltipData|null>(null)
  const [showDD,  setShowDD]  = useState(true)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ w: 800, h: 280 })

  const data = useMemo(() => buildData(trades, period), [trades, period])
  const stats = useMemo(() => computeStats(data), [data])
  const isPositive = (data[data.length-1]?.cumPnL ?? 0) >= (data[0]?.cumPnL ?? 0) - (data[0]?.tradePnL ?? 0)
  const lineColor = isPositive ? COLORS.profit : COLORS.loss

  // Responsive
  useEffect(() => {
    const el = containerRef.current; if (!el) return
    const ro = new ResizeObserver(() => {
      setDims({ w: el.clientWidth, h: Math.max(220, Math.min(300, el.clientWidth * 0.28)) })
    })
    ro.observe(el); return () => ro.disconnect()
  }, [])

  // Draw
  const draw = useCallback((highlight: number|null) => {
    const c = canvasRef.current; if (!c || data.length < 2) return
    const ctx = c.getContext('2d')!
    const DPR = window.devicePixelRatio || 1
    const W = dims.w, H = dims.h
    c.width = W*DPR; c.height = H*DPR
    c.style.width = `${W}px`; c.style.height = `${H}px`
    ctx.scale(DPR, DPR)

    const PAD = { top: 20, right: 16, bottom: 36, left: 72 }
    const cW = W - PAD.left - PAD.right
    const cH = H - PAD.top - PAD.bottom

    const values = data.map(d => d.cumPnL)
    const minV = Math.min(...values), maxV = Math.max(...values)
    const range = maxV - minV || 1
    const padding = range * 0.1

    const toX = (i: number) => PAD.left + (i/(data.length-1)) * cW
    const toY = (v: number) => PAD.top + cH - ((v - minV + padding) / (range + padding*2)) * cH
    const zeroY = toY(0)

    // Background
    ctx.fillStyle = COLORS.bg; ctx.fillRect(0, 0, W, H)

    // Grid lines (Y)
    const steps = 5
    for (let i=0; i<=steps; i++) {
      const v = minV + (range * i/steps)
      const y = toY(v)
      ctx.strokeStyle = COLORS.grid; ctx.lineWidth = 1
      ctx.setLineDash([])
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W-PAD.right, y); ctx.stroke()
      // Label
      ctx.fillStyle = COLORS.text; ctx.font = '10px JetBrains Mono, monospace'
      ctx.textAlign = 'right'
      ctx.fillText(fmtPnL(v), PAD.left-8, y+4)
    }

    // Zero line
    if (zeroY >= PAD.top && zeroY <= PAD.top+cH) {
      ctx.strokeStyle = COLORS.zeroline; ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath(); ctx.moveTo(PAD.left, zeroY); ctx.lineTo(W-PAD.right, zeroY); ctx.stroke()
      ctx.setLineDash([])
    }

    // Drawdown shadow
    if (showDD) {
      ctx.fillStyle = COLORS.drawdown
      ctx.beginPath()
      data.forEach((d, i) => {
        const x = toX(i), peakY = toY(d.peakPnL), curY = toY(d.cumPnL)
        if (i === 0) ctx.moveTo(x, peakY)
        else ctx.lineTo(x, peakY)
      })
      for (let i=data.length-1; i>=0; i--) {
        ctx.lineTo(toX(i), toY(data[i].cumPnL))
      }
      ctx.closePath(); ctx.fill()
    }

    // Gradient fill under curve
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top+cH)
    grad.addColorStop(0, lineColor + '30')
    grad.addColorStop(0.6, lineColor + '08')
    grad.addColorStop(1, lineColor + '00')
    ctx.beginPath()
    data.forEach((d, i) => {
      const x = toX(i), y = toY(d.cumPnL)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.lineTo(toX(data.length-1), Math.min(PAD.top+cH, Math.max(zeroY, PAD.top+cH)))
    ctx.lineTo(toX(0), Math.min(PAD.top+cH, Math.max(zeroY, PAD.top+cH)))
    ctx.closePath()
    ctx.fillStyle = grad; ctx.fill()

    // Main line
    ctx.beginPath(); ctx.strokeStyle = lineColor; ctx.lineWidth = 2
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    data.forEach((d, i) => {
      const x = toX(i), y = toY(d.cumPnL)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.stroke()

    // Per-trade dots — colored by win/loss, small
    data.forEach((d, i) => {
      const x = toX(i), y = toY(d.cumPnL)
      const color = d.tradePnL >= 0 ? COLORS.profit : COLORS.loss
      ctx.beginPath()
      ctx.arc(x, y, i === highlight ? 5 : 2.5, 0, Math.PI*2)
      ctx.fillStyle = i === highlight ? color : color+'99'
      ctx.fill()
      if (i === highlight) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke()
      }
    })

    // X axis labels — smart: show only N labels
    const maxLabels = Math.min(8, data.length)
    const step = Math.ceil(data.length / maxLabels)
    ctx.fillStyle = COLORS.text; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'center'
    data.forEach((d, i) => {
      if (i % step === 0 || i === data.length-1) {
        const x = toX(i)
        ctx.fillText(format(d.date, 'dd/MM'), x, H-10)
      }
    })

    // Crosshair on hover
    if (highlight !== null) {
      const x = toX(highlight), y = toY(data[highlight].cumPnL)
      ctx.strokeStyle = COLORS.crosshair; ctx.lineWidth = 1
      ctx.setLineDash([4,4])
      ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top+cH); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W-PAD.right, y); ctx.stroke()
      ctx.setLineDash([])
    }
  }, [data, dims, lineColor, showDD])

  useEffect(() => { draw(tooltip ? Math.round(tooltip.pct * (data.length-1)) : null) }, [draw, tooltip, data])

  // Mouse
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current; if (!c || data.length < 2) return
    const rect = c.getBoundingClientRect()
    const PAD_LEFT = 72, PAD_RIGHT = 16
    const cW = dims.w - PAD_LEFT - PAD_RIGHT
    const relX = e.clientX - rect.left - PAD_LEFT
    const pct = Math.max(0, Math.min(1, relX / cW))
    const idx = Math.round(pct * (data.length-1))
    const pt = data[idx]
    if (!pt) return
    const dotX = PAD_LEFT + pct * cW
    setTooltip({ x: dotX, y: e.clientY - rect.top, point: pt, pct })
  }, [data, dims])

  const handleMouseLeave = useCallback(() => setTooltip(null), [])

  if (data.length < 2) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:220, color:'#3D4254', gap:8 }}>
        <div style={{ fontSize:32 }}>📈</div>
        <div style={{ fontSize:13, color:'#555C70' }}>Pas encore assez de trades fermés</div>
      </div>
    )
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:0 }}>

      {/* Header — stats inline */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:16, flexWrap:'wrap', gap:12 }}>
        <div>
          <div style={{ fontSize:11, color:'#555C70', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:4 }}>P&L Cumulé</div>
          <div style={{ fontSize:28, fontWeight:700, fontFamily:'JetBrains Mono,monospace', color: isPositive?'#22C759':'#FF3B30', lineHeight:1 }}>
            {stats ? fmtPnL(stats.totalPnL) : '—'}
          </div>
        </div>

        {/* Mini stats */}
        {stats && (
          <div style={{ display:'flex', gap:20, alignItems:'flex-start', flexWrap:'wrap' }}>
            {[
              { label:'Win Rate', value:`${(stats.winRate*100).toFixed(0)}%`, color: stats.winRate>=0.5?'#22C759':'#FF3B30' },
              { label:'Payoff', value:stats.payoff.toFixed(2), color: stats.payoff>=1.5?'#22C759':'#FF9500' },
              { label:'Max DD', value:`${stats.maxDrawdown.toFixed(1)}%`, color: stats.maxDrawdown>15?'#FF3B30':'#FF9500' },
              { label:'Trades', value:String(stats.count), color:'#8F94A3' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ textAlign:'right' }}>
                <div style={{ fontSize:9, color:'#555C70', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:2 }}>{label}</div>
                <div style={{ fontSize:14, fontWeight:700, color, fontFamily:'JetBrains Mono,monospace' }}>{value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
        {/* Period selector */}
        <div style={{ display:'flex', background:'#0D1117', borderRadius:8, padding:2, gap:1, border:'1px solid #1E2330' }}>
          {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              padding:'3px 10px', borderRadius:6, fontSize:10, fontWeight:600, cursor:'pointer', border:'none', fontFamily:'JetBrains Mono,monospace',
              background: period===p ? '#1C2130' : 'transparent',
              color: period===p ? '#F0F3FF' : '#555C70',
              outline: period===p ? '1px solid #2A2F3E' : 'none',
            }}>
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>

        {/* Toggle drawdown */}
        <button onClick={() => setShowDD(x=>!x)} style={{ display:'flex', alignItems:'center', gap:5, padding:'3px 10px', borderRadius:6, fontSize:10, fontWeight:500, cursor:'pointer', border:`1px solid ${showDD?'rgba(255,59,48,0.4)':'#2A2F3E'}`, background: showDD?'rgba(255,59,48,0.08)':'transparent', color: showDD?'#FF3B30':'#555C70', transition:'all 0.15s' }}>
          <div style={{ width:8, height:8, borderRadius:1, background: showDD?'#FF3B30':'#555C70' }}/>
          Drawdown
        </button>
      </div>

      {/* Canvas */}
      <div ref={containerRef} style={{ position:'relative', width:'100%' }}>
        <canvas
          ref={canvasRef}
          style={{ display:'block', width:'100%', height:dims.h, borderRadius:8, cursor:'crosshair' }}
          width={dims.w} height={dims.h}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />

        {/* Tooltip */}
        {tooltip && (() => {
          const pt = tooltip.point
          const isWin = pt.tradePnL >= 0
          const tW = 200, tH = 140
          const left = Math.min(tooltip.x + 12, dims.w - tW - 16)
          const top  = Math.max(8, Math.min(tooltip.y - tH/2, dims.h - tH - 8))
          return (
            <div style={{ position:'absolute', left, top, width:tW, background:'#161B22', border:'1px solid #2A2F3E', borderRadius:10, padding:'10px 12px', pointerEvents:'none', boxShadow:'0 8px 24px rgba(0,0,0,0.5)' }}>
              {/* Date + symbol */}
              <div style={{ fontSize:10, color:'#555C70', marginBottom:8, display:'flex', justifyContent:'space-between' }}>
                <span>{pt.dateLabel}</span>
                <span style={{ color: isWin?'#22C759':'#FF3B30', fontWeight:700 }}>
                  {pt.direction === 'long' ? '▲' : '▼'} {pt.symbol}
                </span>
              </div>

              {/* Trade P&L */}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:6 }}>
                <span style={{ fontSize:10, color:'#555C70' }}>Ce trade</span>
                <span style={{ fontSize:14, fontWeight:700, fontFamily:'JetBrains Mono,monospace', color: isWin?'#22C759':'#FF3B30' }}>
                  {fmtPnL(pt.tradePnL)}
                </span>
              </div>

              {/* Cumulative */}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8, paddingBottom:8, borderBottom:'1px solid #2A2F3E' }}>
                <span style={{ fontSize:10, color:'#555C70' }}>Cumulé</span>
                <span style={{ fontSize:12, fontWeight:600, fontFamily:'JetBrains Mono,monospace', color:'#F0F3FF' }}>
                  {fmtPnL(pt.cumPnL)}
                </span>
              </div>

              {/* Drawdown */}
              {pt.drawdown > 0 && (
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
                  <span style={{ fontSize:10, color:'#555C70' }}>Drawdown</span>
                  <span style={{ fontSize:11, fontWeight:600, fontFamily:'JetBrains Mono,monospace', color:'#FF9500' }}>
                    -{pt.drawdown.toFixed(1)}%
                  </span>
                </div>
              )}
            </div>
          )
        })()}
      </div>

      {/* Best / Worst trade footer */}
      {stats && (
        <div style={{ display:'flex', gap:12, marginTop:12, paddingTop:12, borderTop:'1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ flex:1, padding:'8px 12px', borderRadius:8, background:'rgba(34,199,89,0.06)', border:'1px solid rgba(34,199,89,0.15)' }}>
            <div style={{ fontSize:9, color:'#555C70', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:2 }}>Meilleur trade</div>
            <div style={{ fontSize:13, fontWeight:700, color:'#22C759', fontFamily:'JetBrains Mono,monospace' }}>{fmtPnL(stats.bestTrade)}</div>
          </div>
          <div style={{ flex:1, padding:'8px 12px', borderRadius:8, background:'rgba(255,59,48,0.06)', border:'1px solid rgba(255,59,48,0.15)' }}>
            <div style={{ fontSize:9, color:'#555C70', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:2 }}>Pire trade</div>
            <div style={{ fontSize:13, fontWeight:700, color:'#FF3B30', fontFamily:'JetBrains Mono,monospace' }}>{fmtPnL(stats.worstTrade)}</div>
          </div>
          <div style={{ flex:1, padding:'8px 12px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:'1px solid #1E2330' }}>
            <div style={{ fontSize:9, color:'#555C70', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:2 }}>Moy. gain/perte</div>
            <div style={{ fontSize:11, fontWeight:600, fontFamily:'JetBrains Mono,monospace', color:'#8F94A3' }}>
              <span style={{ color:'#22C759' }}>{fmtPnL(stats.avgWin)}</span>
              {' / '}
              <span style={{ color:'#FF3B30' }}>{fmtPnL(stats.avgLoss)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
