// LiquidationHeatmap.tsx — Rendu fidèle style Coinglass
// Algorithme : chaque colonne = profil de liquidations indépendant basé sur volume local
// Résultat : variation colonne par colonne comme Coinglass/TradingView

import { useState, useEffect, useRef, useCallback } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

interface Kline {
  openTime: Date; open: number; high: number
  low: number; close: number; volume: number
}

interface HeatmapData {
  pMin: number; pMax: number; step: number; N: number
  cols: Float32Array[]   // cols[i][bucket] = intensity 0-1
  candles: Kline[]
}

interface Tip { price: number; vol: number; ts: Date; x: number; y: number }

// ── Config ─────────────────────────────────────────────────────────────────

const BUCKETS = 120
const AXIS_W  = 56
const CANVAS_H = 340

const PERIODS = [
  { v: 'M15',  label: 'M15',  interval: '1m',  limit: 15  },
  { v: 'H1',   label: 'H1',   interval: '1m',  limit: 60  },
  { v: 'H4',   label: 'H4',   interval: '5m',  limit: 48  },
  { v: '12h',  label: '12h',  interval: '15m', limit: 48  },
  { v: '24h',  label: '24h',  interval: '30m', limit: 48  },
  { v: '3j',   label: '3j',   interval: '2h',  limit: 36  },
  { v: '1sem', label: '1sem', interval: '4h',  limit: 42  },
  { v: '2sem', label: '2sem', interval: '8h',  limit: 42  },
  { v: '1m',   label: '1m',   interval: '1d',  limit: 30  },
]

// ── Coinglass palette EXACTE ───────────────────────────────────────────────

function cgRGB(i: number): [number, number, number] {
  i = Math.max(0, Math.min(1, i))
  if (i < 0.05) return [38, 13, 64]
  if (i < 0.15) { const t = (i-.05)/.10; return [Math.round((.15+t*.15)*255), Math.round((.05+t*.05)*255), Math.round((.25+t*.15)*255)] }
  if (i < 0.30) { const t = (i-.15)/.15; return [Math.round((.30-t*.20)*255), Math.round((.10+t*.35)*255), Math.round((.40+t*.20)*255)] }
  if (i < 0.50) { const t = (i-.30)/.20; return [Math.round((.10-t*.05)*255), Math.round((.45+t*.30)*255), Math.round((.60-t*.25)*255)] }
  if (i < 0.70) { const t = (i-.50)/.20; return [Math.round((.05+t*.55)*255), Math.round((.75+t*.15)*255), Math.round((.35-t*.25)*255)] }
  if (i < 0.85) { const t = (i-.70)/.15; return [Math.round((.60+t*.35)*255), Math.round((.90+t*.10)*255), Math.round((.10-t*.05)*255)] }
  const t = (i-.85)/.15; return [Math.round((.95+t*.05)*255), 255, Math.round((.05+t*.45)*255)]
}

// ── Fetch ──────────────────────────────────────────────────────────────────

async function fetchKlines(sym: string, interval: string, limit: number): Promise<Kline[]> {
  for (const base of ['https://fapi.binance.com/fapi/v1', 'https://api.binance.com/api/v3']) {
    try {
      const r = await fetch(`${base}/klines?symbol=${sym}&interval=${interval}&limit=${limit}`)
      if (!r.ok) continue
      const raw: unknown[][] = await r.json()
      const klines = raw.map(a => ({
        openTime: new Date(Number(a[0])),
        open:  parseFloat(a[1] as string), high: parseFloat(a[2] as string),
        low:   parseFloat(a[3] as string), close: parseFloat(a[4] as string),
        volume: parseFloat(a[5] as string),
      }))
      if (klines.length) return klines
    } catch { continue }
  }
  throw new Error('Binance unavailable')
}

// ── Build Heatmap — Algorithme Coinglass correct ───────────────────────────
//
// Coinglass montre pour CHAQUE colonne (instant T) les niveaux où des positions
// seraient liquidées si le prix y allait. La concentration vient du volume
// CUMULÉ des positions ouvertes — pas d'une propagation inter-colonnes.
//
// Pour chaque colonne i :
//   Pour chaque levier [5x,10x,25x,50x,100x] :
//     liquidationPrice_long  = closePrice * (1 - 1/levier)
//     liquidationPrice_short = closePrice * (1 + 1/levier)
//     volume déposé dans ce bucket = volume_candle * weight_levier
//   Puis on lisse avec un kernel gaussien local (sigma ~2 buckets)
//   pour que les bandes aient un dégradé naturel.
//
// La clé : chaque colonne est INDÉPENDANTE → variation visuelle colonne/colonne

function buildHeatmap(candles: Kline[]): HeatmapData {
  const rawMin = Math.min(...candles.map(c => c.low))
  const rawMax = Math.max(...candles.map(c => c.high))
  const pad  = (rawMax - rawMin) * 0.15
  const pMin = rawMin - pad
  const pMax = rawMax + pad
  const step = (pMax - pMin) / BUCKETS
  const N    = candles.length

  const leverages = [5, 10, 25, 50, 100]
  const levW: Record<number, number> = { 5: 0.4, 10: 0.9, 25: 2.8, 50: 2.2, 100: 0.7 }

  // Raw matrix avant normalisation
  const raw: Float32Array[] = Array.from({ length: N }, () => new Float32Array(BUCKETS))

  // Running max volume pour donner du poids aux colonnes à fort volume
  const volMA = candles.map(c => c.volume * c.close)

  for (let ci = 0; ci < N; ci++) {
    const c   = candles[ci]
    const vol = volMA[ci]

    for (const lev of leverages) {
      const w = levW[lev]

      // Niveau de liquidation long (en dessous du close)
      const longLiqPrice  = c.close * (1 - 1 / lev)
      // Niveau de liquidation short (au dessus du close)
      const shortLiqPrice = c.close * (1 + 1 / lev)

      const lb = Math.floor((longLiqPrice  - pMin) / step)
      const sb = Math.floor((shortLiqPrice - pMin) / step)

      // Dépose le volume avec spread gaussien (sigma = 2 buckets → bandes naturelles)
      const sigma = 2.0
      const spread = Math.round(sigma * 3)

      for (let off = -spread; off <= spread; off++) {
        const g = Math.exp(-0.5 * (off / sigma) ** 2)

        if (lb + off >= 0 && lb + off < BUCKETS) {
          raw[ci][lb + off] += vol * w * g
        }
        if (sb + off >= 0 && sb + off < BUCKETS) {
          raw[ci][sb + off] += vol * w * g
        }
      }
    }

    // Bonus : positions du prix sur les bougies voisines (fenêtre ±3)
    // → crée la "mémoire" des niveaux récents sans uniformiser tout
    const window = 4
    for (let wi = Math.max(0, ci - window); wi < ci; wi++) {
      const age   = ci - wi
      const decay = Math.exp(-age * 0.4)  // décroissance rapide → pas d'uniformisation
      const wc    = candles[wi]

      for (const lev of leverages) {
        const w  = levW[lev] * decay * 0.3
        const ll = wc.close * (1 - 1 / lev)
        const sl = wc.close * (1 + 1 / lev)
        const lb2 = Math.floor((ll - pMin) / step)
        const sb2 = Math.floor((sl - pMin) / step)

        if (lb2 >= 0 && lb2 < BUCKETS) raw[ci][lb2] += volMA[wi] * w
        if (sb2 >= 0 && sb2 < BUCKETS) raw[ci][sb2] += volMA[wi] * w
      }
    }
  }

  // Normalisation PER-COLUMN (chaque colonne a son propre max)
  // → préserve la variation colonne/colonne
  const cols: Float32Array[] = raw.map(col => {
    const mx = Math.max(...col, 1e-10)
    // pow(0.42) = tone mapping pour faire ressortir les zones intermédiaires
    return Float32Array.from(col, v => Math.pow(v / mx, 0.42))
  })

  // Smoothing horizontal léger (moyenne 3 colonnes voisines) pour éviter le bruit
  const smoothed: Float32Array[] = cols.map((col, ci) => {
    if (ci === 0 || ci === cols.length - 1) return col
    return Float32Array.from({ length: BUCKETS }, (_, b) =>
      col[b] * 0.6 + (cols[ci - 1][b] ?? 0) * 0.2 + (cols[ci + 1][b] ?? 0) * 0.2
    )
  })

  return { pMin, pMax, step, N, cols: smoothed, candles }
}

// ── Draw ───────────────────────────────────────────────────────────────────

function draw(
  canvas: HTMLCanvasElement,
  data: HeatmapData,
  price: number,
  tip: Tip | null,
) {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width, H = canvas.height
  if (!data.cols.length) return

  const chartW = W - AXIS_W
  const colW   = chartW / data.N
  const rowH   = H / BUCKETS
  const range  = data.pMax - data.pMin

  // ── Background ──
  ctx.fillStyle = '#0C0516'
  ctx.fillRect(0, 0, W, H)

  // ── Heatmap — rendu direct fillRect par cellule (plus fiable que ImageData) ──
  for (let ci = 0; ci < data.N; ci++) {
    const x0 = ci * colW
    const col = data.cols[ci]

    for (let b = 0; b < BUCKETS; b++) {
      const intensity = col[b]
      if (intensity < 0.03) continue  // skip background cells

      const [r, g, bb] = cgRGB(intensity)
      const y0 = H - (b + 1) * rowH
      ctx.fillStyle = `rgb(${r},${g},${bb})`
      // Légère marge entre colonnes pour voir la variation
      ctx.fillRect(x0 + 0.3, y0 + 0.3, colW - 0.3, rowH + 0.3)
    }
  }

  // ── Candles ──
  for (let ci = 0; ci < data.N; ci++) {
    const c  = data.candles[ci]
    const cx = ci * colW + colW / 2
    const bull = c.close >= c.open

    const hY  = H * (1 - (c.high  - data.pMin) / range)
    const lY  = H * (1 - (c.low   - data.pMin) / range)
    const oY  = H * (1 - (c.open  - data.pMin) / range)
    const cY  = H * (1 - (c.close - data.pMin) / range)
    const col = bull ? 'rgba(0,215,130,0.9)' : 'rgba(232,48,68,0.9)'

    ctx.strokeStyle = col; ctx.lineWidth = 0.8
    ctx.beginPath(); ctx.moveTo(cx, hY); ctx.lineTo(cx, lY); ctx.stroke()

    ctx.fillStyle = col
    const bT = Math.min(oY, cY)
    const bH = Math.max(Math.abs(cY - oY), 1.2)
    const bW = Math.max(colW * 0.6, 1.5)
    ctx.fillRect(cx - bW / 2, bT, bW, bH)
  }

  // ── Prix courant ──
  if (price > 0 && price >= data.pMin && price <= data.pMax) {
    const py = H * (1 - (price - data.pMin) / range)
    ctx.save()
    ctx.setLineDash([5, 3]); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(chartW, py); ctx.stroke()
    ctx.restore()

    // Badge cyan
    const label = fmtP(price)
    const bw = Math.max(label.length * 7 + 12, 60)
    ctx.fillStyle = '#00E5FF'
    roundRect(ctx, chartW + 2, py - 10, bw, 20, 4); ctx.fill()
    ctx.fillStyle = '#0A1020'; ctx.font = 'bold 10px monospace'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(label, chartW + 2 + bw / 2, py)
  }

  // ── Axe prix ──
  ctx.font = '9px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
  for (let i = 0; i <= 7; i++) {
    const p = data.pMax - (range * i) / 7
    ctx.fillText(fmtC(p), W - 3, (i / 7) * H)
  }

  // ── Crosshair + tooltip ──
  if (tip) {
    ctx.save()
    ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(0, tip.y); ctx.lineTo(chartW, tip.y); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(tip.x, 0); ctx.lineTo(tip.x, H); ctx.stroke()
    ctx.restore()

    // Dot
    ctx.fillStyle = 'white'
    ctx.beginPath(); ctx.arc(tip.x, tip.y, 3.5, 0, Math.PI * 2); ctx.fill()

    // Tooltip
    const TW = 182, TH = 78
    const tx = tip.x > chartW * 0.55 ? tip.x - TW - 10 : tip.x + 10
    const ty = tip.y > H * 0.55 ? tip.y - TH - 10 : tip.y + 10

    ctx.fillStyle = 'rgba(4,2,14,0.93)'
    roundRect(ctx, tx, ty, TW, TH, 9); ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 0.5
    ctx.stroke()

    // Date
    ctx.font = '10px monospace'; ctx.fillStyle = 'white'
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'
    ctx.fillText(fmtTS(tip.ts), tx + 10, ty + 9)

    // Prix
    ctx.fillStyle = '#FFD700'
    ctx.beginPath(); ctx.arc(tx + 14, ty + 32, 3.5, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '9px monospace'
    ctx.fillText('Prix', tx + 22, ty + 28)
    ctx.fillStyle = 'white'; ctx.font = 'bold 10px monospace'
    ctx.textAlign = 'right'
    ctx.fillText(fmtP(tip.price), tx + TW - 9, ty + 28)

    // Volume liquidation
    ctx.fillStyle = '#FFD700'
    ctx.beginPath(); ctx.arc(tx + 14, ty + 54, 3.5, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '9px monospace'
    ctx.textAlign = 'left'
    ctx.fillText('Liq. Leverage', tx + 22, ty + 50)
    ctx.fillStyle = 'white'; ctx.font = 'bold 10px monospace'
    ctx.textAlign = 'right'
    ctx.fillText(fmtV(tip.vol), tx + TW - 9, ty + 50)
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r)
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h)
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r)
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y)
  ctx.closePath()
}

function fmtP(p: number) {
  return p >= 10000 ? `$${p.toFixed(0)}` : p >= 1000 ? `$${p.toFixed(1)}` : `$${p.toFixed(3)}`
}
function fmtC(p: number) {
  return p >= 10000 ? `$${(p/1000).toFixed(1)}k` : p >= 1000 ? `$${p.toFixed(0)}` : `$${p.toFixed(2)}`
}
function fmtV(v: number) {
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v/1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(v/1e6).toFixed(2)}M`
  if (a >= 1e3) return `${(v/1e3).toFixed(1)}K`
  return v > 0 ? v.toFixed(0) : '—'
}
function fmtTS(d: Date) {
  return d.toLocaleString('fr-FR', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
}

// ── Component ──────────────────────────────────────────────────────────────

export default function LiquidationHeatmap({ symbol = 'BTCUSDT' }: { symbol?: string }) {
  const [period, setPeriod]   = useState(PERIODS[4])
  const [data, setData]       = useState<HeatmapData | null>(null)
  const [price, setPrice]     = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [tip, setTip]         = useState<Tip | null>(null)

  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const tipTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (sym: string, per: typeof PERIODS[0]) => {
    setLoading(true); setError(null); setTip(null); setData(null)
    try {
      const klines = await fetchKlines(sym, per.interval, per.limit)
      setPrice(klines[klines.length - 1].close)
      setData(buildHeatmap(klines))
    } catch (e) {
      setError((e as Error).message)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load(symbol, period) }, [symbol, period, load])

  useEffect(() => {
    if (!canvasRef.current || !data) return
    draw(canvasRef.current, data, price, tip)
  }, [data, price, tip])

  const handlePointer = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!data || !canvasRef.current) return
    const rect  = canvasRef.current.getBoundingClientRect()
    const scaleX = canvasRef.current.width  / rect.width
    const scaleY = canvasRef.current.height / rect.height
    const chartW = canvasRef.current.width - AXIS_W

    let cx: number, cy: number
    if ('touches' in e) { cx = e.touches[0].clientX; cy = e.touches[0].clientY }
    else { cx = (e as React.MouseEvent).clientX; cy = (e as React.MouseEvent).clientY }

    const x = (cx - rect.left) * scaleX
    const y = (cy - rect.top)  * scaleY
    if (x > chartW || x < 0) return

    const H        = canvasRef.current.height
    const pRatio   = 1 - y / H
    const tipPrice = data.pMin + pRatio * (data.pMax - data.pMin)
    const ci       = Math.min(Math.max(Math.floor(x / chartW * data.N), 0), data.N - 1)
    const snap     = data.candles[ci]
    const bi       = Math.min(Math.max(Math.floor((tipPrice - data.pMin) / data.step), 0), BUCKETS - 1)
    const intensity = data.cols[ci][bi]
    const estVol   = intensity * snap.volume * snap.close * 800

    setTip({ price: tipPrice, vol: estVol, ts: snap.openTime, x, y })
    if (tipTimer.current) clearTimeout(tipTimer.current)
    tipTimer.current = setTimeout(() => setTip(null), 3000)
  }, [data])

  const stops = Array.from({ length: 20 }, (_, i) => { const [r,g,b] = cgRGB(i/19); return `rgb(${r},${g},${b})` }).join(',')

  return (
    <div style={{ background: '#0C0516', borderRadius: 16, border: '1px solid rgba(120,0,200,0.3)', overflow: 'hidden', userSelect: 'none' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 14px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:7 }}>
          <span>🔥</span>
          <span style={{ fontSize:13, fontWeight:600, color:'white' }}>Liquidation Heatmap</span>
          <span style={{ fontSize:10, color:'rgba(255,255,255,0.3)' }}>{symbol}</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {loading && <div style={{ width:11, height:11, border:'1.5px solid rgba(120,0,255,0.25)', borderTopColor:'#9B59B6', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />}
          {price > 0 && <span style={{ fontSize:14, fontWeight:700, color:'#00E5FF', fontFamily:'monospace' }}>{fmtP(price)}</span>}
        </div>
      </div>

      {/* Period selector */}
      <div style={{ display:'flex', gap:3, padding:'0 14px 8px', overflowX:'auto' }}>
        {PERIODS.map(p => (
          <button key={p.v} onClick={() => setPeriod(p)} style={{
            padding:'3px 9px', borderRadius:5, fontSize:10, cursor:'pointer', border:'none', flexShrink:0,
            fontWeight: period.v === p.v ? 700 : 400,
            background: period.v === p.v ? 'rgba(128,0,255,0.5)' : 'rgba(255,255,255,0.05)',
            color: period.v === p.v ? 'white' : 'rgba(255,255,255,0.38)',
            transition:'all 0.15s',
          }}>{p.label}</button>
        ))}
      </div>

      {/* Canvas */}
      {error ? (
        <div style={{ height: CANVAS_H, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10 }}>
          <span style={{ fontSize:28, opacity:0.3 }}>📊</span>
          <span style={{ color:'rgba(255,255,255,0.3)', fontSize:12 }}>{error}</span>
          <button onClick={() => load(symbol, period)} style={{ color:'#00E5FF', background:'none', border:'1px solid #00E5FF40', borderRadius:6, padding:'4px 12px', cursor:'pointer', fontSize:11 }}>Réessayer</button>
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          width={900} height={CANVAS_H}
          style={{ width:'100%', height:CANVAS_H, display:'block', cursor: data ? 'crosshair' : 'default' }}
          onMouseMove={handlePointer}
          onMouseDown={handlePointer}
          onMouseLeave={() => { if(tipTimer.current) clearTimeout(tipTimer.current); tipTimer.current = setTimeout(() => setTip(null), 500) }}
          onTouchStart={handlePointer}
          onTouchMove={handlePointer}
        />
      )}

      {/* Legend */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 14px' }}>
        <div style={{ width:130, height:8, borderRadius:2, background:`linear-gradient(to right, ${stops})`, flexShrink:0 }} />
        <span style={{ fontSize:8, color:'rgba(255,255,255,0.22)' }}>Liquidation Leverage</span>
        <div style={{ marginLeft:'auto', display:'flex', gap:10 }}>
          {[['#00D782','Bull'],['#E83044','Bear']].map(([c,l]) => (
            <span key={l} style={{ display:'flex', alignItems:'center', gap:3, fontSize:8, color:'rgba(255,255,255,0.22)' }}>
              <span style={{ width:8, height:8, borderRadius:1, background:c, display:'inline-block' }} /> {l}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
