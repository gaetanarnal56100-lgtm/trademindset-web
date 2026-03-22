// PnLModal.tsx — Courbe P&L avancée : modal plein écran, zoom, stats complètes
// Standalone — utilise les mêmes types que DashboardPage (Trade, tradePnL, safeTime)

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { tradePnL, type Trade } from '@/services/firestore'

// ── Helpers partagés ───────────────────────────────────────────────────────
function safeTime(d: any): number {
  if (!d) return 0
  if (typeof d?.getTime === 'function') { const t = d.getTime(); return isNaN(t) ? 0 : t }
  if (typeof d?.seconds === 'number') return d.seconds * 1000
  if (typeof d === 'number') return d
  return 0
}
function fmtK(n: number, decimals = 2): string {
  const abs = Math.abs(n), s = n < 0 ? '-' : '+'
  if (abs >= 1_000_000) return `${s}$${(abs/1_000_000).toFixed(decimals)}M`
  if (abs >= 1_000)     return `${s}$${(abs/1_000).toFixed(1)}k`
  return `${s}$${abs.toFixed(decimals)}`
}
function fmtDate(d: Date, short = false): string {
  return d.toLocaleDateString('fr-FR', short
    ? { day: '2-digit', month: '2-digit' }
    : { day: '2-digit', month: 'short', year: '2-digit' })
}

// ── Types ──────────────────────────────────────────────────────────────────
// ── Periods ────────────────────────────────────────────────────────────────
export type PnLPeriod = '1J'|'2J'|'3J'|'5J'|'1S'|'2S'|'3S'|'1M'|'2M'|'3M'|'6M'|'YTD'|'1A'|'2A'|'ALL'

// Grouped for the UI
const PERIOD_GROUPS: { label: string; periods: PnLPeriod[] }[] = [
  { label: 'J',   periods: ['1J','2J','3J','5J'] },
  { label: 'S',   periods: ['1S','2S','3S'] },
  { label: 'M',   periods: ['1M','2M','3M','6M'] },
  { label: 'A',   periods: ['YTD','1A','2A'] },
  { label: '',    periods: ['ALL'] },
]
const PERIOD_LABELS: Record<PnLPeriod,string> = {
  '1J':'1J','2J':'2J','3J':'3J','5J':'5J',
  '1S':'1S','2S':'2S','3S':'3S',
  '1M':'1M','2M':'2M','3M':'3M','6M':'6M',
  'YTD':'YTD','1A':'1A','2A':'2A','ALL':'Tout',
}
const PERIOD_DAYS: Record<PnLPeriod,number> = {
  '1J':1,'2J':2,'3J':3,'5J':5,
  '1S':7,'2S':14,'3S':21,
  '1M':30,'2M':60,'3M':90,'6M':180,
  'YTD':0,'1A':365,'2A':730,'ALL':0,
}

// ── Timeframe aggregation ───────────────────────────────────────────────────
export type PnLTimeframe = 'TRADE'|'DAY'|'WEEK'|'MONTH'
const TF_LABELS: Record<PnLTimeframe,string> = {
  'TRADE':'Par trade','DAY':'Journalier','WEEK':'Hebdo','MONTH':'Mensuel',
}

interface PnLPoint {
  date: Date; cumPnL: number; tradePnL: number
  drawdown: number; peakPnL: number
  symbol: string; direction: string; idx: number
  tradeCount?: number  // for aggregated points
}

// ── Build data ─────────────────────────────────────────────────────────────
function getPeriodCutoff(period: PnLPeriod): number {
  if (period === 'YTD') return new Date(new Date().getFullYear(), 0, 1).getTime()
  const days = PERIOD_DAYS[period]
  return days > 0 ? Date.now() - days * 864e5 : 0
}

function getBucketKey(date: Date, tf: PnLTimeframe): string {
  if (tf === 'TRADE') return date.toISOString()
  if (tf === 'DAY')   return date.toISOString().slice(0,10)
  if (tf === 'WEEK') {
    const d = new Date(date); d.setHours(0,0,0,0)
    d.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1))  // Monday
    return d.toISOString().slice(0,10)
  }
  // MONTH
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`
}

function buildData(trades: Trade[], period: PnLPeriod, tf: PnLTimeframe = 'TRADE'): PnLPoint[] {
  const cutoff = getPeriodCutoff(period)
  const cl = [...trades]
    .filter(t => t.status === 'closed' && safeTime(t.date) >= cutoff)
    .sort((a, b) => safeTime(a.date) - safeTime(b.date))

  if (cl.length === 0) return []

  // Aggregate by timeframe bucket
  const buckets = new Map<string, { date: Date; pnl: number; count: number; sym: string; dir: string }>()
  for (const t of cl) {
    const d = new Date(safeTime(t.date))
    const key = getBucketKey(d, tf)
    if (!buckets.has(key)) buckets.set(key, { date: d, pnl: 0, count: 0, sym: t.symbol, dir: t.type })
    const b = buckets.get(key)!
    b.pnl += tradePnL(t); b.count++
    b.sym = t.symbol; b.dir = t.type  // last trade in bucket
  }

  let cum = 0, peak = 0, idx = 0
  return Array.from(buckets.values()).map(b => {
    cum += b.pnl
    if (cum > peak) peak = cum
    const dd = peak > 0 ? ((peak - cum) / Math.abs(peak)) * 100 : 0
    return {
      date: b.date,
      cumPnL: Math.round(cum * 100) / 100,
      tradePnL: Math.round(b.pnl * 100) / 100,
      drawdown: Math.round(dd * 10) / 10,
      peakPnL: Math.round(peak * 100) / 100,
      symbol: b.sym, direction: b.dir, idx: idx++,
      tradeCount: b.count,
    }
  })
}

// ── Advanced Stats ─────────────────────────────────────────────────────────
function computeStats(data: PnLPoint[]) {
  if (data.length === 0) return null
  const pnls = data.map(d => d.tradePnL)
  const wins = pnls.filter(p => p > 0), losses = pnls.filter(p => p <= 0)
  const totalPnL = data[data.length-1].cumPnL
  const winRate = pnls.length > 0 ? wins.length / pnls.length : 0
  const avgWin = wins.length > 0 ? wins.reduce((a,b) => a+b, 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? losses.reduce((a,b) => a+b, 0) / losses.length : 0
  const payoff = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0
  const expectancy = pnls.reduce((a, b) => a+b, 0) / pnls.length
  const maxDD = Math.max(...data.map(d => d.drawdown), 0)
  const maxDDPoint = data.find(d => d.drawdown === maxDD)
  const best = Math.max(...pnls), worst = Math.min(...pnls)
  const bestTrade = data.find(d => d.tradePnL === best)
  const worstTrade = data.find(d => d.tradePnL === worst)
  // Profit Factor
  const grossProfit = wins.reduce((a, b) => a+b, 0)
  const grossLoss = Math.abs(losses.reduce((a, b) => a+b, 0))
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0
  // Consecutive streaks
  let curStreak = 0, bestStreak = 0, worstStreak = 0, tempStreak = 0
  pnls.forEach(p => {
    if (p > 0) { tempStreak = tempStreak > 0 ? tempStreak+1 : 1 }
    else { tempStreak = tempStreak < 0 ? tempStreak-1 : -1 }
    if (tempStreak > bestStreak) bestStreak = tempStreak
    if (tempStreak < worstStreak) worstStreak = tempStreak
  })
  curStreak = tempStreak
  // Recovery factor
  const recoveryFactor = maxDD > 0 ? totalPnL / (maxDD/100 * (data[data.length-1]?.peakPnL||1)) : 0
  // Calmar ratio (annualized return / max DD)
  const daysCovered = data.length > 1
    ? (data[data.length-1].date.getTime() - data[0].date.getTime()) / 864e5 : 1
  const annualizedReturn = daysCovered > 0 ? (totalPnL / daysCovered) * 365 : 0
  const calmar = maxDD > 0 ? Math.abs(annualizedReturn / (maxDD/100 * 1000)) : 0

  return {
    totalPnL, winRate, avgWin, avgLoss, payoff, expectancy, maxDD, maxDDPoint,
    best, worst, bestTrade, worstTrade, profitFactor, grossProfit, grossLoss,
    bestStreak, worstStreak, curStreak, count: pnls.length,
    wins: wins.length, losses: losses.length, recoveryFactor, calmar,
    daysCovered: Math.round(daysCovered),
  }
}

// ── Canvas Draw ────────────────────────────────────────────────────────────
interface ZoomState { startIdx: number; endIdx: number }

function drawChart(
  canvas: HTMLCanvasElement, data: PnLPoint[], W: number, H: number,
  hoverIdx: number|null, zoom: ZoomState, showDD: boolean, showTrades: boolean
) {
  const DPR = window.devicePixelRatio || 1
  canvas.width = W*DPR; canvas.height = H*DPR
  canvas.style.width = `${W}px`; canvas.style.height = `${H}px`
  const ctx = canvas.getContext('2d')!; ctx.scale(DPR, DPR)

  const slice = data.slice(zoom.startIdx, zoom.endIdx + 1)
  if (slice.length < 2) return

  const PAD = { top: 20, right: 16, bot: 36, left: 72 }
  const cW = W - PAD.left - PAD.right, cH = H - PAD.top - PAD.bot

  ctx.clearRect(0, 0, W, H)
  const vals = slice.map(d => d.cumPnL)
  const minV = Math.min(...vals, 0), maxV = Math.max(...vals, 0)
  const range = maxV - minV || 1, pad = range * 0.12
  const toX = (i: number) => PAD.left + (i / (slice.length-1)) * cW
  const toY = (v: number) => PAD.top + cH - ((v - minV + pad) / (range + pad*2)) * cH
  const zY = toY(0)

  // Grid lines
  const gridSteps = 5
  for (let i = 0; i <= gridSteps; i++) {
    const v = minV + (range * i / gridSteps)
    const y = toY(v)
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1; ctx.setLineDash([])
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W-PAD.right, y); ctx.stroke()
    ctx.fillStyle = '#555C70'; ctx.font = '10px JetBrains Mono,monospace'; ctx.textAlign = 'right'
    ctx.fillText(fmtK(v, 0), PAD.left-6, y+4)
  }

  // Zero line
  if (zY >= PAD.top && zY <= PAD.top+cH) {
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.setLineDash([5,4])
    ctx.beginPath(); ctx.moveTo(PAD.left, zY); ctx.lineTo(W-PAD.right, zY); ctx.stroke()
    ctx.setLineDash([])
  }

  // Drawdown zone
  if (showDD) {
    ctx.fillStyle = 'rgba(255,59,48,0.1)'
    ctx.beginPath()
    slice.forEach((d, i) => i === 0 ? ctx.moveTo(toX(i), toY(d.peakPnL)) : ctx.lineTo(toX(i), toY(d.peakPnL)))
    for (let i = slice.length-1; i >= 0; i--) ctx.lineTo(toX(i), toY(slice[i].cumPnL))
    ctx.closePath(); ctx.fill()
  }

  const isPos = (slice[slice.length-1]?.cumPnL ?? 0) >= 0
  const lc = isPos ? '#22C759' : '#FF3B30'

  // Fill
  const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top+cH)
  grad.addColorStop(0, lc+'2A'); grad.addColorStop(0.65, lc+'06'); grad.addColorStop(1, lc+'00')
  ctx.beginPath()
  slice.forEach((d, i) => i === 0 ? ctx.moveTo(toX(i), toY(d.cumPnL)) : ctx.lineTo(toX(i), toY(d.cumPnL)))
  ctx.lineTo(toX(slice.length-1), Math.max(zY, PAD.top+cH))
  ctx.lineTo(toX(0), Math.max(zY, PAD.top+cH))
  ctx.closePath(); ctx.fillStyle = grad; ctx.fill()

  // Line
  ctx.beginPath(); ctx.strokeStyle = lc; ctx.lineWidth = 2.5
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  slice.forEach((d, i) => i === 0 ? ctx.moveTo(toX(i), toY(d.cumPnL)) : ctx.lineTo(toX(i), toY(d.cumPnL)))
  ctx.stroke()

  // Trade dots
  if (showTrades) {
    slice.forEach((d, i) => {
      const x = toX(i), y = toY(d.cumPnL)
      const c = d.tradePnL >= 0 ? '#22C759' : '#FF3B30'
      const isHov = i === (hoverIdx !== null ? hoverIdx - zoom.startIdx : -1)
      ctx.beginPath(); ctx.arc(x, y, isHov ? 6 : 2.5, 0, Math.PI*2)
      ctx.fillStyle = isHov ? c : c + '99'; ctx.fill()
      if (isHov) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke() }
    })
  }

  // X labels
  const maxLbl = Math.min(10, slice.length)
  const step = Math.max(1, Math.ceil(slice.length / maxLbl))
  ctx.fillStyle = '#555C70'; ctx.font = '10px JetBrains Mono,monospace'; ctx.textAlign = 'center'
  slice.forEach((d, i) => {
    if (i % step === 0 || i === slice.length-1)
      ctx.fillText(fmtDate(d.date, true), toX(i), H-10)
  })

  // Crosshair
  if (hoverIdx !== null) {
    const localIdx = hoverIdx - zoom.startIdx
    if (localIdx >= 0 && localIdx < slice.length) {
      const x = toX(localIdx), y = toY(slice[localIdx].cumPnL)
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.setLineDash([4,4])
      ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top+cH); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W-PAD.right, y); ctx.stroke()
      ctx.setLineDash([])
    }
  }
}

// ── Stat Box Component ─────────────────────────────────────────────────────
function StatBox({ label, value, sub, color = '#F0F3FF', warn = false }: {
  label: string; value: string; sub?: string; color?: string; warn?: boolean
}) {
  return (
    <div style={{ padding: '12px 16px', background: '#0D1117', border: `1px solid ${warn ? 'rgba(255,149,0,0.2)' : '#1E2330'}`, borderRadius: 10 }}>
      <div style={{ fontSize: 9, color: '#555C70', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color, fontFamily: 'JetBrains Mono,monospace', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#3D4254', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

// ── Full PnL Component (inline + modal) ───────────────────────────────────

interface Props { trades: Trade[]; compact?: boolean }

export default function PnLCurve({ trades, compact = false }: Props) {
  const [period, setPeriod]     = useState<PnLPeriod>('ALL')
  const [tf, setTf]             = useState<PnLTimeframe>('TRADE')
  const [showDD, setShowDD]     = useState(true)
  const [showDots, setShowDots] = useState(true)
  const [modal, setModal]       = useState(false)
  const [hoverIdx, setHoverIdx] = useState<number|null>(null)
  const [zoom, setZoom]         = useState<ZoomState>({ startIdx: 0, endIdx: 0 })
  const [dragStart, setDragStart] = useState<number|null>(null)
  const [selRange, setSelRange]   = useState<{s:number;e:number}|null>(null)
  const [tab, setTab]           = useState<'chart'|'stats'|'trades'>('chart')

  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [W, setW]   = useState(800)
  const H = compact ? 180 : 340

  const data  = useMemo(() => buildData(trades, period, tf), [trades, period, tf])
  const stats = useMemo(() => computeStats(data), [data])

  // Reset zoom when data changes
  useEffect(() => {
    setZoom({ startIdx: 0, endIdx: Math.max(0, data.length-1) })
    setSelRange(null)
  }, [data])

  // Responsive width
  useEffect(() => {
    const el = containerRef.current; if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el); return () => ro.disconnect()
  }, [modal])

  // Draw
  useEffect(() => {
    const c = canvasRef.current; if (!c || data.length < 2) return
    const effectiveZoom = selRange
      ? { startIdx: Math.min(selRange.s, selRange.e), endIdx: Math.max(selRange.s, selRange.e) }
      : zoom
    drawChart(c, data, W, H, hoverIdx, effectiveZoom, showDD, showDots)
  }, [data, W, H, hoverIdx, zoom, selRange, showDD, showDots])

  // Mouse helpers
  const xToIdx = useCallback((clientX: number, rect: DOMRect) => {
    const PAD_LEFT = 72, PAD_RIGHT = 16, cW = W - PAD_LEFT - PAD_RIGHT
    const pct = Math.max(0, Math.min(1, (clientX - rect.left - PAD_LEFT) / cW))
    const effectiveZoom = selRange
      ? { startIdx: Math.min(selRange.s, selRange.e), endIdx: Math.max(selRange.s, selRange.e) }
      : zoom
    const span = effectiveZoom.endIdx - effectiveZoom.startIdx
    return Math.round(effectiveZoom.startIdx + pct * span)
  }, [W, zoom, selRange])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (data.length < 2) return
    const rect = canvasRef.current!.getBoundingClientRect()
    const idx = xToIdx(e.clientX, rect)
    setHoverIdx(Math.min(Math.max(idx, 0), data.length-1))
    if (dragStart !== null) {
      const end = xToIdx(e.clientX, rect)
      setSelRange({ s: dragStart, e: end })
    }
  }, [data, xToIdx, dragStart])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    setDragStart(xToIdx(e.clientX, rect))
    setSelRange(null)
  }, [xToIdx])

  const handleMouseUp = useCallback(() => {
    if (selRange && Math.abs(selRange.e - selRange.s) > 1) {
      setZoom({ startIdx: Math.min(selRange.s, selRange.e), endIdx: Math.max(selRange.s, selRange.e) })
    }
    setSelRange(null)
    setDragStart(null)
  }, [selRange])

  const resetZoom = () => setZoom({ startIdx: 0, endIdx: Math.max(0, data.length-1) })
  const isZoomed = zoom.startIdx > 0 || zoom.endIdx < data.length - 1

  const hovered = hoverIdx !== null ? data[hoverIdx] : null
  const visibleSlice = data.slice(zoom.startIdx, zoom.endIdx + 1)
  const isPos = (visibleSlice[visibleSlice.length-1]?.cumPnL ?? 0) >= (visibleSlice[0]?.cumPnL ?? 0) - (visibleSlice[0]?.tradePnL ?? 0)

  // ── Controls bar ───────────────────────────────────────────────────────
  const Controls = ({ full = false }: { full?: boolean }) => (
    <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
      {/* Period selector — groupé par J / S / M / A */}
      <div style={{ display:'flex', alignItems:'center', gap:4, background:'#0D1117', borderRadius:7, padding:'2px 4px', border:'1px solid #1E2330' }}>
        {PERIOD_GROUPS.map((group, gi) => (
          <div key={gi} style={{ display:'flex', alignItems:'center', gap:1 }}>
            {/* Séparateur entre groupes */}
            {gi > 0 && <div style={{ width:1, height:14, background:'#2A2F3E', margin:'0 3px' }}/>}
            {/* Label du groupe */}
            {group.label && (
              <span style={{ fontSize:9, color:'#3D4254', fontFamily:'JetBrains Mono,monospace', paddingRight:2, userSelect:'none' }}>
                {group.label}
              </span>
            )}
            {/* Boutons du groupe */}
            {group.periods.map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                style={{ padding:'3px 8px', borderRadius:5, fontSize:10, fontWeight:600, cursor:'pointer', border:'none',
                  fontFamily:'JetBrains Mono,monospace', transition:'all 0.1s',
                  background: period===p ? '#1C2130' : 'transparent',
                  color: period===p ? '#F0F3FF' : '#555C70',
                  outline: period===p ? '1px solid #2A2F3E' : 'none' }}>
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div style={{ width:1, height:16, background:'#2A2F3E', flexShrink:0 }}/>

      {/* Timeframe aggregation — plus visible en mode full */}
      <div style={{ display:'flex', background:'#0D1117', borderRadius:7, padding:2, gap:1, border:'1px solid #1E2330' }}>
        {(Object.keys(TF_LABELS) as PnLTimeframe[]).map(t => (
          <button key={t} onClick={() => setTf(t)}
            style={{ padding:'3px 9px', borderRadius:5, fontSize:10, fontWeight:600, cursor:'pointer', border:'none',
              background:tf===t?'rgba(0,229,255,0.12)':'transparent',
              color:tf===t?'#00E5FF':'#555C70',
              outline:tf===t?'1px solid rgba(0,229,255,0.3)':'none' }}>
            {TF_LABELS[t]}
          </button>
        ))}
      </div>

      <div style={{ width:1, height:16, background:'#2A2F3E', flexShrink:0 }}/>

      {/* Toggles */}
      {[
        { label:'Drawdown', active:showDD,   toggle:()=>setShowDD(x=>!x),   color:'#FF3B30' },
        { label:'Points',   active:showDots, toggle:()=>setShowDots(x=>!x), color:'#F59714' },
      ].map(({ label, active, toggle, color }) => (
        <button key={label} onClick={toggle}
          style={{ display:'flex', alignItems:'center', gap:5, padding:'3px 9px', borderRadius:6, fontSize:10,
            fontWeight:500, cursor:'pointer',
            border:`1px solid ${active ? color+'50' : '#2A2F3E'}`,
            background:active?color+'10':'transparent', color:active?color:'#555C70' }}>
          <div style={{ width:7, height:7, borderRadius:1, background:active?color:'#555C70' }}/>{label}
        </button>
      ))}

      {/* Zoom reset */}
      {isZoomed && (
        <button onClick={resetZoom}
          style={{ display:'flex', alignItems:'center', gap:5, padding:'3px 9px', borderRadius:6, fontSize:10,
            fontWeight:600, cursor:'pointer', border:'1px solid rgba(0,229,255,0.4)',
            background:'rgba(0,229,255,0.08)', color:'#00E5FF' }}>
          ↺ Reset zoom
        </button>
      )}
    </div>
  )

  // ── Stats panel ────────────────────────────────────────────────────────
  const StatsPanel = () => {
    if (!stats) return <div style={{ color:'#555C70', padding:20, textAlign:'center' }}>Pas de données</div>
    const s = stats
    return (
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))', gap:8 }}>
        <StatBox label="P&L Total" value={fmtK(s.totalPnL)} color={s.totalPnL>=0?'#22C759':'#FF3B30'} sub={`${s.count} trades`}/>
        <StatBox label="Win Rate" value={`${(s.winRate*100).toFixed(1)}%`} color={s.winRate>=0.5?'#22C759':'#FF9500'} sub={`${s.wins}W / ${s.losses}L`}/>
        <StatBox label="Profit Factor" value={isFinite(s.profitFactor)?s.profitFactor.toFixed(2):'∞'} color={s.profitFactor>=1.5?'#22C759':s.profitFactor>=1?'#FF9500':'#FF3B30'} sub={`G:${fmtK(s.grossProfit,0)} P:${fmtK(-s.grossLoss,0)}`}/>
        <StatBox label="Payoff Ratio" value={s.payoff.toFixed(2)} color={s.payoff>=1.5?'#22C759':s.payoff>=1?'#FF9500':'#FF3B30'} sub={`Moy win/loss`}/>
        <StatBox label="Expectancy" value={fmtK(s.expectancy)} color={s.expectancy>=0?'#22C759':'#FF3B30'} sub="par trade"/>
        <StatBox label="Max Drawdown" value={`${s.maxDD.toFixed(1)}%`} color={s.maxDD>20?'#FF3B30':s.maxDD>10?'#FF9500':'#22C759'} warn={s.maxDD>15} sub={s.maxDDPoint?fmtDate(s.maxDDPoint.date):undefined}/>
        <StatBox label="Meilleur trade" value={fmtK(s.best)} color="#22C759" sub={s.bestTrade?`${s.bestTrade.symbol} ${fmtDate(s.bestTrade.date)}`:undefined}/>
        <StatBox label="Pire trade" value={fmtK(s.worst)} color="#FF3B30" sub={s.worstTrade?`${s.worstTrade.symbol} ${fmtDate(s.worstTrade.date)}`:undefined}/>
        <StatBox label="Série gagnante" value={`+${s.bestStreak}`} color="#22C759" sub="trades consécutifs"/>
        <StatBox label="Série perdante" value={`${s.worstStreak}`} color="#FF3B30" sub="trades consécutifs"/>
        <StatBox label="Série actuelle" value={s.curStreak>=0?`+${s.curStreak}`:`${s.curStreak}`} color={s.curStreak>=0?'#22C759':'#FF3B30'}/>
        <StatBox label="Moy. gain" value={fmtK(s.avgWin)} color="#22C759"/>
        <StatBox label="Moy. perte" value={fmtK(s.avgLoss)} color="#FF3B30"/>
        <StatBox label="Recovery Factor" value={s.recoveryFactor.toFixed(2)} color={s.recoveryFactor>=2?'#22C759':s.recoveryFactor>=1?'#FF9500':'#FF3B30'}/>
        <StatBox label="Durée analysée" value={`${s.daysCovered}j`} color="#8F94A3"/>
      </div>
    )
  }

  // ── Trades table ───────────────────────────────────────────────────────
  const TradesTable = () => (
    <div style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
        <thead>
          <tr style={{ borderBottom:'1px solid #2A2F3E' }}>
            {['#','Date','Symbole','Direction','P&L trade','P&L cumulé','Drawdown'].map(h => (
              <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontSize:9, color:'#555C70', textTransform:'uppercase', letterSpacing:'0.06em', fontWeight:600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.slice(zoom.startIdx, zoom.endIdx+1).map((d, i) => (
            <tr key={i} style={{ borderBottom:'1px solid rgba(255,255,255,0.04)', cursor:'default' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background='rgba(255,255,255,0.02)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background='transparent'}>
              <td style={{ padding:'7px 12px', color:'#555C70', fontFamily:'monospace' }}>{zoom.startIdx+i+1}</td>
              <td style={{ padding:'7px 12px', color:'#8F94A3', fontFamily:'monospace' }}>{fmtDate(d.date)}</td>
              <td style={{ padding:'7px 12px', fontWeight:600, color:'#F0F3FF' }}>{d.symbol}</td>
              <td style={{ padding:'7px 12px' }}>
                <span style={{ fontSize:10, fontWeight:700, color:d.direction==='Long'?'#22C759':'#FF3B30', background:d.direction==='Long'?'rgba(34,199,89,0.1)':'rgba(255,59,48,0.1)', padding:'1px 8px', borderRadius:4 }}>
                  {d.direction==='Long'?'▲ Long':'▼ Short'}
                </span>
              </td>
              <td style={{ padding:'7px 12px', fontFamily:'monospace', fontWeight:600, color:d.tradePnL>=0?'#22C759':'#FF3B30' }}>{fmtK(d.tradePnL)}</td>
              <td style={{ padding:'7px 12px', fontFamily:'monospace', color:'#F0F3FF' }}>{fmtK(d.cumPnL)}</td>
              <td style={{ padding:'7px 12px', fontFamily:'monospace', color:d.drawdown>10?'#FF3B30':d.drawdown>5?'#FF9500':'#555C70' }}>
                {d.drawdown > 0 ? `-${d.drawdown.toFixed(1)}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  // ── Inline version (compact pour dashboard) ────────────────────────────
  const ChartArea = () => (
    <div ref={containerRef} style={{ position:'relative', userSelect:'none' }}>
      {data.length < 2 ? (
        <div style={{ height:H, display:'flex', alignItems:'center', justifyContent:'center', color:'#3D4254', fontSize:13 }}>
          Pas encore assez de trades fermés
        </div>
      ) : (
        <>
          <canvas ref={canvasRef}
            onMouseMove={handleMouseMove} onMouseLeave={() => setHoverIdx(null)}
            onMouseDown={handleMouseDown} onMouseUp={handleMouseUp}
            style={{ width:'100%', height:H, display:'block', cursor: dragStart!==null?'col-resize':'crosshair' }}
            width={W} height={H}
          />
          <div style={{ position:'absolute', bottom:42, right:8, fontSize:9, color:'#3D4254' }}>
            {isZoomed ? `${zoom.endIdx-zoom.startIdx+1} trades` : ''} {data.length > 1 ? '← glisser pour zoomer' : ''}
          </div>

          {/* Hover tooltip */}
          {hovered && (() => {
            const localIdx = (hoverIdx ?? 0) - zoom.startIdx
            const span = zoom.endIdx - zoom.startIdx
            const PAD_L = 72, cW = W - PAD_L - 16
            const dotX = PAD_L + (span > 0 ? (localIdx / span) * cW : 0)
            const tW = 200, left = Math.min(dotX+14, W-tW-8), top = 12
            return (
              <div style={{ position:'absolute', left, top, width:tW, background:'#161B22', border:'1px solid #2A2F3E', borderRadius:10, padding:'10px 12px', pointerEvents:'none', boxShadow:'0 8px 28px rgba(0,0,0,0.6)', zIndex:10 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8, fontSize:10, color:'#555C70' }}>
                  <span>{fmtDate(hovered.date)}</span>
                  <span style={{ color:hovered.tradePnL>=0?'#22C759':'#FF3B30', fontWeight:700 }}>
                    {hovered.tradeCount && hovered.tradeCount > 1
                      ? `${hovered.tradeCount} trades`
                      : `${hovered.direction==='Long'?'▲':'▼'} ${hovered.symbol}`}
                  </span>
                </div>
                {[
                  { label:'Ce trade', value:fmtK(hovered.tradePnL), color:hovered.tradePnL>=0?'#22C759':'#FF3B30', size:14 },
                  { label:'Cumulé', value:fmtK(hovered.cumPnL), color:'#F0F3FF', size:12 },
                  ...(hovered.drawdown > 0 ? [{ label:'Drawdown', value:`-${hovered.drawdown.toFixed(1)}%`, color:'#FF9500', size:11 }] : []),
                ].map(({ label, value, color, size }, i, arr) => (
                  <div key={label} style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom: i<arr.length-1?5:0, paddingBottom: i<arr.length-1?5:0, borderBottom: i<arr.length-1?'1px solid #2A2F3E':'none' }}>
                    <span style={{ fontSize:10, color:'#555C70' }}>{label}</span>
                    <span style={{ fontSize:size, fontWeight:700, color, fontFamily:'JetBrains Mono,monospace' }}>{value}</span>
                  </div>
                ))}
              </div>
            )
          })()}
        </>
      )}
    </div>
  )

  // ── Modal ──────────────────────────────────────────────────────────────
  if (modal) return (
    <div style={{ position:'fixed', inset:0, zIndex:500, background:'rgba(0,0,0,0.85)', display:'flex', alignItems:'stretch' }}>
      <div style={{ flex:1, background:'#0D1117', display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* Modal header */}
        <div style={{ padding:'16px 24px', borderBottom:'1px solid #1E2330', display:'flex', alignItems:'center', gap:16, flexShrink:0 }}>
          <div>
            <div style={{ fontSize:11, color:'#555C70', textTransform:'uppercase', letterSpacing:'0.08em' }}>Courbe P&L</div>
            <div style={{ fontSize:26, fontWeight:700, color:isPos?'#22C759':'#FF3B30', fontFamily:'JetBrains Mono,monospace', lineHeight:1.1 }}>
              {stats ? fmtK(stats.totalPnL) : '—'}
            </div>
          </div>
          {stats && (
            <div style={{ display:'flex', gap:24, marginLeft:8 }}>
              {[
                { l:'Win Rate', v:`${(stats.winRate*100).toFixed(0)}%`, c:stats.winRate>=0.5?'#22C759':'#FF9500' },
                { l:'Profit Factor', v:isFinite(stats.profitFactor)?stats.profitFactor.toFixed(2):'∞', c:stats.profitFactor>=1.5?'#22C759':'#FF9500' },
                { l:'Max DD', v:`${stats.maxDD.toFixed(1)}%`, c:stats.maxDD>20?'#FF3B30':stats.maxDD>10?'#FF9500':'#22C759' },
                { l:'Expectancy', v:fmtK(stats.expectancy), c:stats.expectancy>=0?'#22C759':'#FF3B30' },
              ].map(({ l, v, c }) => (
                <div key={l}>
                  <div style={{ fontSize:9, color:'#555C70', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:2 }}>{l}</div>
                  <div style={{ fontSize:15, fontWeight:700, color:c, fontFamily:'JetBrains Mono,monospace' }}>{v}</div>
                </div>
              ))}
            </div>
          )}
          <button onClick={() => setModal(false)} style={{ marginLeft:'auto', background:'#1C2130', border:'1px solid #2A2F3E', borderRadius:8, padding:'6px 14px', cursor:'pointer', color:'#8F94A3', fontSize:12 }}>✕ Fermer</button>
        </div>

        {/* Tabs */}
        <div style={{ padding:'0 24px', borderBottom:'1px solid #1E2330', display:'flex', gap:0, flexShrink:0 }}>
          {([['chart','📈 Graphique'],['stats','📊 Statistiques'],['trades','📋 Trades']] as [typeof tab, string][]).map(([t,l]) => (
            <button key={t} onClick={() => setTab(t)} style={{ padding:'12px 18px', background:'none', border:'none', borderBottom:`2px solid ${tab===t?'#00E5FF':'transparent'}`, cursor:'pointer', color:tab===t?'#00E5FF':'#555C70', fontSize:12, fontWeight:tab===t?600:400, transition:'all 0.15s' }}>{l}</button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex:1, overflow:'auto', padding:24 }}>
          {tab === 'chart' && (
            <>
              <div style={{ marginBottom:14, display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
                <Controls />
                <div style={{ fontSize:10, color:'#3D4254' }}>Glisser pour zoomer · Reset double-clic</div>
              </div>
              <ChartArea />
            </>
          )}
          {tab === 'stats' && (
            <>
              <div style={{ marginBottom:16 }}><Controls /></div>
              <StatsPanel />
            </>
          )}
          {tab === 'trades' && (
            <>
              <div style={{ marginBottom:16, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <Controls />
                <div style={{ fontSize:11, color:'#555C70' }}>{zoom.endIdx-zoom.startIdx+1} trades affichés</div>
              </div>
              <TradesTable />
            </>
          )}
        </div>
      </div>
    </div>
  )

  // ── Inline (dashboard) ─────────────────────────────────────────────────
  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12, gap:8, flexWrap:'wrap' }}>
        <Controls />
        <button onClick={() => setModal(true)} style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 12px', borderRadius:7, fontSize:11, fontWeight:600, cursor:'pointer', border:'1px solid #2A2F3E', background:'#1C2130', color:'#8F94A3', transition:'all 0.15s' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor='#00E5FF'; (e.currentTarget as HTMLElement).style.color='#00E5FF' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor='#2A2F3E'; (e.currentTarget as HTMLElement).style.color='#8F94A3' }}>
          ⛶ Plein écran
        </button>
      </div>
      <ChartArea />
    </div>
  )
}
