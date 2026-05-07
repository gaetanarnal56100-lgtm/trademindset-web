// LiqHeatmapChart.tsx — Liquidation Heatmap approximée depuis Binance klines
// Algo : pour chaque bougie, distribution des liquidations estimées par levier (5×→100×)
// Rendu : canvas 2D (grille colorée violette→jaune) + bougies superposées
import { useEffect, useRef, useState, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Kline {
  openTime: number; open: number; high: number; low: number; close: number
  volume: number; closeTime: number
}

// ── Constants ─────────────────────────────────────────────────────────────────
const TF_OPTIONS = ['5m','15m','30m','1h','2h','4h','1d'] as const
type HeatTF = typeof TF_OPTIONS[number]

const LEVERAGE_TIERS = [
  { lev: 5,   weight: 0.08 },
  { lev: 10,  weight: 0.27 },
  { lev: 20,  weight: 0.32 },
  { lev: 50,  weight: 0.22 },
  { lev: 100, weight: 0.11 },
]
const N_PRICE_BINS = 250
const MAINT_MARGIN  = 0.004   // Binance ~0.4% maintenance margin
const LONG_FRAC     = 0.55    // assumed 55% longs / 45% shorts on average

// ── Color scale : purple → blue → green → yellow (Coinglass-style) ────────────
function intensityToColor(t: number): string {
  // t in [0, 1]
  if (t <= 0) return 'transparent'
  const alpha = Math.min(0.92, 0.25 + t * 0.67)
  if (t < 0.25) {
    // deep purple → blue
    const s = t / 0.25
    const r = Math.round(80  + s * (30 - 80))
    const g = Math.round(0   + s * (50 - 0))
    const b = Math.round(160 + s * (255 - 160))
    return `rgba(${r},${g},${b},${alpha})`
  }
  if (t < 0.55) {
    // blue → green
    const s = (t - 0.25) / 0.30
    const r = Math.round(30  + s * (0   - 30))
    const g = Math.round(50  + s * (220 - 50))
    const b = Math.round(255 + s * (80  - 255))
    return `rgba(${r},${g},${b},${alpha})`
  }
  if (t < 0.80) {
    // green → yellow-green
    const s = (t - 0.55) / 0.25
    const r = Math.round(0   + s * (180 - 0))
    const g = Math.round(220 + s * (255 - 220))
    const b = Math.round(80  + s * (0   - 80))
    return `rgba(${r},${g},${b},${alpha})`
  }
  // yellow-green → bright yellow
  const s = (t - 0.80) / 0.20
  const r = Math.round(180 + s * (255 - 180))
  const g = 255
  const b = 0
  return `rgba(${r},${g},${b},${alpha})`
}

// ── Fetch Binance klines ───────────────────────────────────────────────────────
async function fetchKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Binance klines ${r.status}`)
  const data = await r.json() as [number,string,string,string,string,string,number,...unknown[]][]
  return data.map(k => ({
    openTime:  k[0],
    open:  parseFloat(k[1]),
    high:  parseFloat(k[2]),
    low:   parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    closeTime: k[6],
  }))
}

// ── Build heatmap grid ─────────────────────────────────────────────────────────
function buildGrid(klines: Kline[]): {
  grid: Float32Array       // [timeIdx * N_PRICE_BINS + priceIdx]
  priceMin: number
  priceMax: number
  maxVal: number
} {
  const prices = klines.flatMap(k => [k.high, k.low])
  const priceMin = Math.min(...prices)
  const priceMax = Math.max(...prices)
  const priceRange = priceMax - priceMin

  // add 20% margin above and below for liquidation levels outside range
  const pMin = priceMin - priceRange * 0.20
  const pMax = priceMax + priceRange * 0.20
  const pRange = pMax - pMin

  const N = klines.length
  const grid = new Float32Array(N * N_PRICE_BINS)

  const priceToBin = (p: number): number => {
    const bin = Math.floor(((p - pMin) / pRange) * N_PRICE_BINS)
    return Math.max(0, Math.min(N_PRICE_BINS - 1, bin))
  }

  const addToBin = (t: number, p: number, val: number) => {
    const bin = priceToBin(p)
    // spread across neighboring bins for smoothness
    for (let d = -2; d <= 2; d++) {
      const b = bin + d
      if (b < 0 || b >= N_PRICE_BINS) continue
      const w = 1 - Math.abs(d) * 0.3
      grid[t * N_PRICE_BINS + b] += val * w
    }
  }

  for (let i = 0; i < N; i++) {
    const k = klines[i]
    // Use volume as proxy for OI contribution
    // Normalize volume within dataset
    const vol = k.volume

    for (const { lev, weight } of LEVERAGE_TIERS) {
      const contribution = vol * weight

      // Longs opened near this candle's close → liquidated below
      const liqLong = k.close * (1 - (1 / lev) + MAINT_MARGIN)
      // Shorts opened near this candle's close → liquidated above
      const liqShort = k.close * (1 + (1 / lev) - MAINT_MARGIN)

      addToBin(i, liqLong,  contribution * LONG_FRAC)
      addToBin(i, liqShort, contribution * (1 - LONG_FRAC))

      // Also consider positions opened at candle high/low (wicks)
      const liqLongH  = k.high  * (1 - (1 / lev) + MAINT_MARGIN)
      const liqShortL = k.low   * (1 + (1 / lev) - MAINT_MARGIN)
      addToBin(i, liqLongH,  contribution * LONG_FRAC * 0.35)
      addToBin(i, liqShortL, contribution * (1 - LONG_FRAC) * 0.35)
    }
  }

  let maxVal = 0
  for (let i = 0; i < grid.length; i++) maxVal = Math.max(maxVal, grid[i])

  return { grid, priceMin: pMin, priceMax: pMax, maxVal }
}

// ── Draw canvas ────────────────────────────────────────────────────────────────
function drawHeatmap(
  canvas: HTMLCanvasElement,
  klines: Kline[],
  grid: Float32Array,
  priceMin: number,
  priceMax: number,
  maxVal: number,
  showCandles: boolean,
) {
  const dpr = window.devicePixelRatio || 1
  const W = canvas.clientWidth
  const H = canvas.clientHeight
  if (W === 0 || H === 0) return

  canvas.width  = W * dpr
  canvas.height = H * dpr
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)

  // Background
  ctx.fillStyle = '#080C14'
  ctx.fillRect(0, 0, W, H)

  const N = klines.length
  const LABEL_W = 64
  const CHART_W = W - LABEL_W
  const cellW = CHART_W / N
  const cellH = H / N_PRICE_BINS

  const priceRange = priceMax - priceMin
  const priceToY = (p: number) => H - ((p - priceMin) / priceRange) * H

  // ── Draw heatmap cells ──
  for (let t = 0; t < N; t++) {
    for (let b = 0; b < N_PRICE_BINS; b++) {
      const val = grid[t * N_PRICE_BINS + b]
      if (val <= 0) continue
      const intensity = Math.pow(val / maxVal, 0.45) // gamma for better contrast
      const color = intensityToColor(intensity)
      if (color === 'transparent') continue
      ctx.fillStyle = color
      const x = t * cellW
      const y = H - (b + 1) * cellH
      ctx.fillRect(x, y, cellW + 0.5, cellH + 0.5)
    }
  }

  // ── Draw candlesticks ──
  if (showCandles && klines.length > 0) {
    const candleW = Math.max(2, cellW * 0.7)
    for (let i = 0; i < N; i++) {
      const k = klines[i]
      const x = i * cellW + cellW / 2
      const isUp = k.close >= k.open
      const color = isUp ? '#26C281' : '#E74C3C'

      // Wick
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, priceToY(k.high))
      ctx.lineTo(x, priceToY(k.low))
      ctx.stroke()

      // Body
      const bodyTop    = priceToY(Math.max(k.open, k.close))
      const bodyBottom = priceToY(Math.min(k.open, k.close))
      const bodyH = Math.max(1, bodyBottom - bodyTop)
      ctx.fillStyle = color
      ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH)
    }
  }

  // ── Price axis (right) ──
  ctx.fillStyle = '#080C14'
  ctx.fillRect(CHART_W, 0, LABEL_W, H)

  const currentPrice = klines[klines.length - 1]?.close ?? 0
  const nTicks = 8
  for (let i = 0; i <= nTicks; i++) {
    const p = priceMin + (priceRange * i) / nTicks
    const y = priceToY(p)
    const isCurrent = Math.abs(p - currentPrice) < priceRange / nTicks / 2
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(CHART_W, y)
    ctx.stroke()

    ctx.fillStyle = isCurrent ? '#00E5FF' : 'rgba(143,148,163,0.6)'
    ctx.font = `${isCurrent ? '700' : '400'} 10px JetBrains Mono, monospace`
    ctx.textAlign = 'left'
    const label = p >= 10000 ? `$${(p/1000).toFixed(1)}k` : `$${p.toFixed(p < 10 ? 4 : 2)}`
    ctx.fillText(label, CHART_W + 4, y + 4)
  }

  // Current price line
  const cy = priceToY(currentPrice)
  ctx.strokeStyle = '#00E5FF'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(0, cy)
  ctx.lineTo(CHART_W, cy)
  ctx.stroke()
  ctx.setLineDash([])

  // Current price badge
  ctx.fillStyle = '#00E5FF'
  ctx.fillRect(CHART_W + 2, cy - 8, LABEL_W - 4, 16)
  ctx.fillStyle = '#000'
  ctx.font = '700 10px JetBrains Mono, monospace'
  ctx.textAlign = 'center'
  const cLabel = currentPrice >= 10000 ? `$${currentPrice.toFixed(0)}` : `$${currentPrice.toFixed(2)}`
  ctx.fillText(cLabel, CHART_W + LABEL_W / 2, cy + 4)
  ctx.textAlign = 'left'

  // ── Time axis (bottom labels on a few candles) ──
  const step = Math.max(1, Math.floor(N / 8))
  ctx.font = '9px JetBrains Mono, monospace'
  ctx.fillStyle = 'rgba(143,148,163,0.5)'
  ctx.textAlign = 'center'
  for (let i = 0; i < N; i += step) {
    const k = klines[i]
    const x = i * cellW + cellW / 2
    const d = new Date(k.openTime)
    const label = `${d.getDate()}/${d.getMonth()+1} ${d.getHours().toString().padStart(2,'0')}h`
    ctx.fillText(label, x, H - 3)
  }
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function LiqHeatmapChart({ symbol }: { symbol: string }) {
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const wrapRef     = useRef<HTMLDivElement>(null)
  const [tf,        setTf]        = useState<HeatTF>('1h')
  const [limit,     setLimit]     = useState(200)
  const [showCandles, setShowCandles] = useState(true)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string|null>(null)
  const [lastUpdate, setLastUpdate] = useState<number>(0)

  // cached data
  const dataRef = useRef<{
    klines: Kline[]; grid: Float32Array
    priceMin: number; priceMax: number; maxVal: number
  } | null>(null)

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const d = dataRef.current
    if (!canvas || !d) return
    drawHeatmap(canvas, d.klines, d.grid, d.priceMin, d.priceMax, d.maxVal, showCandles)
  }, [showCandles])

  const fetchAndDraw = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const klines = await fetchKlines(symbol, tf, limit)
      const { grid, priceMin, priceMax, maxVal } = buildGrid(klines)
      dataRef.current = { klines, grid, priceMin, priceMax, maxVal }
      setLastUpdate(Date.now())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [symbol, tf, limit])

  // Fetch on mount + params change
  useEffect(() => { fetchAndDraw() }, [fetchAndDraw])

  // Auto-refresh every 2 min
  useEffect(() => {
    const id = setInterval(fetchAndDraw, 2 * 60 * 1000)
    return () => clearInterval(id)
  }, [fetchAndDraw])

  // Redraw on data or showCandles change
  useEffect(() => { redraw() }, [lastUpdate, redraw])

  // Redraw on resize
  useEffect(() => {
    const obs = new ResizeObserver(() => redraw())
    if (wrapRef.current) obs.observe(wrapRef.current)
    return () => obs.disconnect()
  }, [redraw])

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer',
    border: `1px solid ${active ? 'rgba(0,229,255,0.5)' : 'rgba(255,255,255,0.08)'}`,
    background: active ? 'rgba(0,229,255,0.12)' : 'rgba(255,255,255,0.03)',
    color: active ? '#00E5FF' : 'rgba(143,148,163,0.7)',
    transition: 'all 0.15s',
  })

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10, height:'100%' }}>
      {/* Toolbar */}
      <div style={{
        display:'flex', alignItems:'center', gap:8, flexWrap:'wrap',
        padding:'8px 14px',
        background:'rgba(13,17,35,0.85)',
        border:'1px solid rgba(0,229,255,0.12)',
        borderRadius:12,
        backdropFilter:'blur(8px)',
      }}>
        {/* Symbol badge */}
        <span style={{
          fontSize:12, fontWeight:800, color:'#00E5FF',
          fontFamily:'JetBrains Mono,monospace', letterSpacing:'0.05em',
        }}>{symbol}</span>

        <div style={{ width:1, height:16, background:'rgba(255,255,255,0.1)' }} />

        {/* TF selector */}
        <div style={{ display:'flex', gap:4 }}>
          {TF_OPTIONS.map(t => (
            <button key={t} style={btnStyle(tf===t)} onClick={() => setTf(t)}>{t}</button>
          ))}
        </div>

        <div style={{ width:1, height:16, background:'rgba(255,255,255,0.1)' }} />

        {/* Candle count */}
        {([100, 200, 300] as const).map(n => (
          <button key={n} style={btnStyle(limit===n)} onClick={() => setLimit(n)}>{n}</button>
        ))}

        <div style={{ width:1, height:16, background:'rgba(255,255,255,0.1)' }} />

        {/* Candles toggle */}
        <button style={btnStyle(showCandles)} onClick={() => setShowCandles(v => !v)}>
          🕯 Bougies
        </button>

        {/* Refresh */}
        <button
          style={{ ...btnStyle(false), marginLeft:'auto' }}
          onClick={fetchAndDraw}
          disabled={loading}
        >
          {loading ? '⟳' : '↻'} Refresh
        </button>

        {/* Last update */}
        {lastUpdate > 0 && (
          <span style={{ fontSize:9, color:'rgba(143,148,163,0.4)', fontFamily:'JetBrains Mono,monospace' }}>
            {new Date(lastUpdate).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' })}
          </span>
        )}
      </div>

      {/* Legend */}
      <div style={{ display:'flex', alignItems:'center', gap:6, paddingLeft:4 }}>
        <span style={{ fontSize:9, color:'rgba(143,148,163,0.5)', fontFamily:'JetBrains Mono,monospace' }}>CONCENTRATION LIQUIDATIONS</span>
        <div style={{
          width:120, height:8, borderRadius:4,
          background:'linear-gradient(to right, rgba(80,0,160,0.6), rgba(30,50,255,0.7), rgba(0,220,80,0.8), rgba(180,255,0,0.9), rgba(255,255,0,1))',
        }} />
        <span style={{ fontSize:9, color:'rgba(143,148,163,0.5)', fontFamily:'JetBrains Mono,monospace' }}>MAX</span>
      </div>

      {/* Canvas */}
      <div
        ref={wrapRef}
        style={{
          flex:1, position:'relative', borderRadius:12, overflow:'hidden',
          border:'1px solid rgba(0,229,255,0.10)',
          minHeight:400,
        }}
      >
        {loading && (
          <div style={{
            position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center',
            background:'rgba(8,12,20,0.7)', zIndex:10, borderRadius:12,
          }}>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:28, animation:'spin 1s linear infinite', marginBottom:8 }}>⟳</div>
              <div style={{ fontSize:12, color:'rgba(0,229,255,0.8)', fontFamily:'JetBrains Mono,monospace' }}>
                Calcul heatmap…
              </div>
            </div>
          </div>
        )}
        {error && (
          <div style={{
            position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center',
            background:'rgba(8,12,20,0.9)', zIndex:10, borderRadius:12,
          }}>
            <div style={{ fontSize:12, color:'#FF3B30', fontFamily:'JetBrains Mono,monospace' }}>
              ⚠ {error}
            </div>
          </div>
        )}
        <canvas
          ref={canvasRef}
          style={{ width:'100%', height:'100%', display:'block' }}
        />
      </div>

      {/* Disclaimer */}
      <div style={{ fontSize:9, color:'rgba(143,148,163,0.35)', fontFamily:'JetBrains Mono,monospace', paddingLeft:4 }}>
        Estimation basée sur volume Binance × leviers 5×/10×/20×/50×/100× — approximation, pas les données réelles Coinglass
      </div>
    </div>
  )
}
