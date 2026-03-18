// src/pages/analyse/LiquidationHeatmap.tsx
// Heatmap de liquidation style Coinglass
// Rendu haute fidélité avec densité gaussienne, palette exacte et interactivité complète

import { useState, useEffect, useRef, useCallback } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

interface Kline {
  openTime: Date; open: number; high: number; low: number
  close: number; volume: number
}

interface HeatmapData {
  priceMin: number; priceMax: number; priceStep: number
  bucketCount: number
  snapshots: { timestamp: Date; candle: Kline; levels: Float32Array }[]
}

interface Tooltip {
  price: number; volume: number; timestamp: Date; x: number; y: number
}

// ── Constants ──────────────────────────────────────────────────────────────

const BUCKET_COUNT = 100
const LEVERAGES    = [5, 10, 25, 50, 100]
const LEV_W: Record<number, number> = { 5: 0.5, 10: 1.0, 25: 2.5, 50: 2.0, 100: 0.8 }
const AXIS_W = 54

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

// ── Palette Coinglass EXACTE (miroir Swift coinglass()) ────────────────────

function cgColor(i: number): [number, number, number] {
  i = Math.min(Math.max(i, 0), 1)

  if (i < 0.05) return [38, 13, 64]

  if (i < 0.15) {
    const t = (i - 0.05) / 0.10
    return [
      Math.round((0.15 + t * 0.15) * 255),
      Math.round((0.05 + t * 0.05) * 255),
      Math.round((0.25 + t * 0.15) * 255),
    ]
  }
  if (i < 0.30) {
    const t = (i - 0.15) / 0.15
    return [
      Math.round((0.30 - t * 0.20) * 255),
      Math.round((0.10 + t * 0.35) * 255),
      Math.round((0.40 + t * 0.20) * 255),
    ]
  }
  if (i < 0.50) {
    const t = (i - 0.30) / 0.20
    return [
      Math.round((0.10 - t * 0.05) * 255),
      Math.round((0.45 + t * 0.30) * 255),
      Math.round((0.60 - t * 0.25) * 255),
    ]
  }
  if (i < 0.70) {
    const t = (i - 0.50) / 0.20
    return [
      Math.round((0.05 + t * 0.55) * 255),
      Math.round((0.75 + t * 0.15) * 255),
      Math.round((0.35 - t * 0.25) * 255),
    ]
  }
  if (i < 0.85) {
    const t = (i - 0.70) / 0.15
    return [
      Math.round((0.60 + t * 0.35) * 255),
      Math.round((0.90 + t * 0.10) * 255),
      Math.round((0.10 - t * 0.05) * 255),
    ]
  }
  const t = (i - 0.85) / 0.15
  return [
    Math.round((0.95 + t * 0.05) * 255),
    255,
    Math.round((0.05 + t * 0.45) * 255),
  ]
}

// ── Gaussian spread ────────────────────────────────────────────────────────

function spreadGaussian(arr: Float32Array, center: number, vol: number, sigma: number) {
  const range = Math.floor(sigma * 3)
  for (let o = -range; o <= range; o++) {
    const idx = center + o
    if (idx < 0 || idx >= arr.length) continue
    const g = Math.exp(-0.5 * (o / sigma) ** 2)
    arr[idx] += vol * g
  }
}

function wasSwept(price: number, candles: Kline[], from: number, to: number): boolean {
  for (let i = Math.max(0, from); i <= Math.min(candles.length - 1, to); i++) {
    if (price >= candles[i].low && price <= candles[i].high) return true
  }
  return false
}

// ── Fetch ──────────────────────────────────────────────────────────────────

async function fetchKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
  for (const base of [
    `https://fapi.binance.com/fapi/v1`,
    `https://api.binance.com/api/v3`,
  ]) {
    try {
      const r = await fetch(`${base}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`)
      if (!r.ok) continue
      const raw: unknown[][] = await r.json()
      const klines = raw.map(a => ({
        openTime: new Date(Number(a[0])),
        open:  parseFloat(a[1] as string),
        high:  parseFloat(a[2] as string),
        low:   parseFloat(a[3] as string),
        close: parseFloat(a[4] as string),
        volume: parseFloat(a[5] as string),
      }))
      if (klines.length) return klines
    } catch { continue }
  }
  throw new Error('Binance unavailable')
}

async function fetchDepth(symbol: string, pMin: number, step: number): Promise<Float32Array> {
  const profile = new Float32Array(BUCKET_COUNT)
  for (const base of [
    `https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=500`,
    `https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=500`,
  ]) {
    try {
      const r = await fetch(base)
      if (!r.ok) continue
      const d = await r.json()
      const orders: [string, string][] = [...(d.bids || []), ...(d.asks || [])]
      for (const [ps, qs] of orders) {
        const p = parseFloat(ps), q = parseFloat(qs)
        const idx = Math.floor((p - pMin) / step)
        if (idx >= 0 && idx < BUCKET_COUNT) profile[idx] += q * p
      }
      const mx = Math.max(...profile)
      if (mx > 0) { for (let i = 0; i < profile.length; i++) profile[i] /= mx }
      return profile
    } catch { continue }
  }
  return profile
}

// ── Build heatmap (miroir EXACT de buildHeatmap Swift) ────────────────────

function buildHeatmap(candles: Kline[], depth: Float32Array): HeatmapData {
  const rawMin = Math.min(...candles.map(c => c.low))
  const rawMax = Math.max(...candles.map(c => c.high))
  const pad    = (rawMax - rawMin) * 0.20
  const pMin   = rawMin - pad
  const pMax   = rawMax + pad
  const step   = (pMax - pMin) / BUCKET_COUNT

  const N = candles.length

  // Swept ranges
  const swLow: number[] = [], swHigh: number[] = []
  let rl = candles[0].low, rh = candles[0].high
  for (const c of candles) {
    rl = Math.min(rl, c.low); rh = Math.max(rh, c.high)
    swLow.push(rl); swHigh.push(rh)
  }

  // Matrix [col][bucket]
  const matrix: Float32Array[] = Array.from({ length: N }, () => new Float32Array(BUCKET_COUNT))

  for (let si = 0; si < N; si++) {
    const src = candles[si]
    for (const lev of LEVERAGES) {
      const w   = LEV_W[lev]
      const vol = src.volume * src.close * w
      const longLiq  = src.close * (1 - 1 / lev)
      const shortLiq = src.close * (1 + 1 / lev)

      for (let di = si; di < N; di++) {
        const age   = di - si
        const decay = Math.exp(-age * 0.008)

        // Long liquidation bucket
        const lb = Math.floor((longLiq - pMin) / step)
        if (lb >= 0 && lb < BUCKET_COUNT) {
          const bp = pMin + lb * step + step / 2
          if (!wasSwept(bp, candles, si + 1, di)) {
            spreadGaussian(matrix[di], lb, vol * decay, 1.5)
          }
        }

        // Short liquidation bucket
        const sb = Math.floor((shortLiq - pMin) / step)
        if (sb >= 0 && sb < BUCKET_COUNT) {
          const bp = pMin + sb * step + step / 2
          if (!wasSwept(bp, candles, si + 1, di)) {
            spreadGaussian(matrix[di], sb, vol * decay, 1.5)
          }
        }
      }
    }
  }

  // Blend depth profile on last quarter
  if (N > 0) {
    const lastVol  = candles[N - 1].volume * candles[N - 1].close
    const depStart = Math.max(0, N - Math.floor(N / 4))
    for (let col = depStart; col < N; col++) {
      const fade = (col - depStart) / Math.max(1, N - depStart)
      for (let b = 0; b < BUCKET_COUNT; b++) {
        matrix[col][b] += depth[b] * lastVol * 0.4 * fade
      }
    }
  }

  // Global normalize + pow(0.45) tone-mapping
  let globalMax = 0
  for (let col = 0; col < N; col++) {
    const m = Math.max(...matrix[col])
    if (m > globalMax) globalMax = m
  }

  const snapshots = candles.map((c, i) => ({
    timestamp: c.openTime,
    candle: c,
    levels: globalMax > 0
      ? Float32Array.from(matrix[i], v => Math.pow(v / globalMax, 0.45))
      : matrix[i],
  }))

  return { priceMin: pMin, priceMax: pMax, priceStep: step, bucketCount: BUCKET_COUNT, snapshots }
}

// ── Render ─────────────────────────────────────────────────────────────────

function renderHeatmap(
  canvas: HTMLCanvasElement,
  data: HeatmapData,
  currentPrice: number,
  tooltip: Tooltip | null,
) {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width, H = canvas.height
  const snaps = data.snapshots
  if (!snaps.length) return

  const chartW = W - AXIS_W
  const colW   = chartW / snaps.length
  const rowH   = H / BUCKET_COUNT
  const range  = data.priceMax - data.priceMin

  // ── Background ──
  ctx.fillStyle = '#0C0516'
  ctx.fillRect(0, 0, W, H)

  // ── Heatmap via ImageData (max performance) ──
  const iw = Math.max(1, Math.floor(chartW))
  const imgData = ctx.createImageData(iw, H)
  const px = imgData.data

  for (let col = 0; col < snaps.length; col++) {
    const snap = snaps[col]
    const x0 = Math.floor(col * colW)
    const x1 = Math.min(Math.floor((col + 1) * colW), iw)

    for (let row = 0; row < BUCKET_COUNT; row++) {
      const intensity = snap.levels[row]
      const [r, g, b] = cgColor(intensity)

      const y0 = Math.floor(H - (row + 1) * rowH)
      const y1 = Math.min(Math.floor(H - row * rowH), H)

      for (let y = Math.max(0, y0); y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (y * iw + x) * 4
          px[idx]     = r
          px[idx + 1] = g
          px[idx + 2] = b
          px[idx + 3] = 255
        }
      }
    }
  }
  ctx.putImageData(imgData, 0, 0)

  // ── Candles ──
  for (let col = 0; col < snaps.length; col++) {
    const { candle: c } = snaps[col]
    const cx = col * colW + colW / 2
    const bull = c.close >= c.open

    const highY  = H * (1 - (c.high  - data.priceMin) / range)
    const lowY   = H * (1 - (c.low   - data.priceMin) / range)
    const openY  = H * (1 - (c.open  - data.priceMin) / range)
    const closeY = H * (1 - (c.close - data.priceMin) / range)

    const color = bull ? 'rgba(0,220,140,0.85)' : 'rgba(235,50,70,0.85)'

    // Wick
    ctx.strokeStyle = color; ctx.lineWidth = 0.8
    ctx.beginPath(); ctx.moveTo(cx, highY); ctx.lineTo(cx, lowY); ctx.stroke()

    // Body
    ctx.fillStyle = color
    const bTop = Math.min(openY, closeY)
    const bH   = Math.max(Math.abs(closeY - openY), 1.2)
    const bW   = Math.max(colW * 0.65, 1.5)
    ctx.fillRect(cx - bW / 2, bTop, bW, bH)
  }

  // ── Current price dashed line ──
  if (currentPrice > 0 && currentPrice >= data.priceMin && currentPrice <= data.priceMax) {
    const py = H * (1 - (currentPrice - data.priceMin) / range)
    ctx.save()
    ctx.setLineDash([5, 3])
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth   = 0.9
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(chartW, py); ctx.stroke()
    ctx.restore()

    // Price badge (cyan)
    const label = fmtPrice(currentPrice)
    ctx.fillStyle = '#00E5FF'
    ctx.fillRect(chartW, py - 10, AXIS_W, 20)
    ctx.fillStyle = '#0D1117'
    ctx.font = 'bold 10px monospace'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, W - 3, py)
  }

  // ── Price axis ──
  ctx.font = '9px monospace'
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let i = 0; i <= 7; i++) {
    const p = data.priceMax - (range * i) / 7
    const y = (i / 7) * H
    ctx.fillText(fmtCompact(p), W - 3, y)
  }

  // ── Crosshair + tooltip ──
  if (tooltip) {
    // Crosshair lines
    ctx.save()
    ctx.setLineDash([3, 3])
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'
    ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(0, tooltip.y); ctx.lineTo(chartW, tooltip.y); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(tooltip.x, 0); ctx.lineTo(tooltip.x, H); ctx.stroke()
    ctx.restore()

    // White dot
    ctx.fillStyle = 'white'
    ctx.beginPath(); ctx.arc(tooltip.x, tooltip.y, 4, 0, Math.PI * 2); ctx.fill()

    // Tooltip box
    const TW = 178, TH = 76
    const tx = tooltip.x > chartW / 2 ? tooltip.x - TW - 10 : tooltip.x + 10
    const ty = tooltip.y > H / 2 ? tooltip.y - TH - 10 : tooltip.y + 10

    ctx.fillStyle = 'rgba(5,3,15,0.92)'
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 0.5
    roundRect(ctx, tx, ty, TW, TH, 8)
    ctx.fill(); ctx.stroke()

    // Tooltip content
    ctx.font = '10px monospace'
    ctx.fillStyle = 'white'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(fmtTimestamp(tooltip.timestamp), tx + 9, ty + 9)

    // Prix row
    ctx.fillStyle = '#FFD700'
    ctx.beginPath(); ctx.arc(tx + 14, ty + 32, 3.5, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '9px monospace'
    ctx.fillText('Prix', tx + 22, ty + 28)
    ctx.fillStyle = 'white'; ctx.font = 'bold 10px monospace'
    ctx.textAlign = 'right'
    ctx.fillText(fmtPrice(tooltip.price), tx + TW - 9, ty + 28)

    // Volume row
    ctx.fillStyle = '#FFD700'
    ctx.beginPath(); ctx.arc(tx + 14, ty + 52, 3.5, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '9px monospace'
    ctx.textAlign = 'left'
    ctx.fillText('Liq. Leverage', tx + 22, ty + 48)
    ctx.fillStyle = 'white'; ctx.font = 'bold 10px monospace'
    ctx.textAlign = 'right'
    ctx.fillText(fmtVolume(tooltip.volume), tx + TW - 9, ty + 48)
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtPrice(p: number): string {
  return p >= 10000 ? p.toFixed(0) : p >= 1000 ? p.toFixed(1) : p >= 1 ? p.toFixed(3) : p.toFixed(5)
}
function fmtCompact(p: number): string {
  return p >= 10000 ? `$${(p / 1000).toFixed(1)}k` : p >= 1000 ? `$${p.toFixed(0)}` : `$${p.toFixed(1)}`
}
function fmtVolume(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return v > 0 ? v.toFixed(0) : '—'
}
function fmtTimestamp(d: Date): string {
  return d.toLocaleString('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// ── Component ──────────────────────────────────────────────────────────────

export default function LiquidationHeatmap({ symbol = 'BTCUSDT' }: { symbol?: string }) {
  const [period, setPeriod]   = useState(PERIODS[4])   // 24h
  const [data, setData]       = useState<HeatmapData | null>(null)
  const [price, setPrice]     = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)

  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load data
  const load = useCallback(async (sym: string, per: typeof PERIODS[0]) => {
    setLoading(true); setError(null); setTooltip(null); setData(null)
    try {
      const klines = await fetchKlines(sym, per.interval, per.limit)
      setPrice(klines[klines.length - 1].close)

      // Price range for depth
      const rawMin = Math.min(...klines.map(k => k.low))
      const rawMax = Math.max(...klines.map(k => k.high))
      const pMin   = rawMin - (rawMax - rawMin) * 0.20
      const step   = ((rawMax + (rawMax - rawMin) * 0.20) - pMin) / BUCKET_COUNT

      const depth   = await fetchDepth(sym, pMin, step)
      const heatmap = buildHeatmap(klines, depth)
      setData(heatmap)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(symbol, period) }, [symbol, period, load])

  // Render
  useEffect(() => {
    if (!canvasRef.current || !data) return
    renderHeatmap(canvasRef.current, data, price, tooltip)
  }, [data, price, tooltip])

  // Pointer interaction
  const handlePointer = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!data || !canvasRef.current) return
    const rect  = canvasRef.current.getBoundingClientRect()
    const sx    = canvasRef.current.width  / rect.width
    const sy    = canvasRef.current.height / rect.height
    const chartW = canvasRef.current.width - AXIS_W

    let cx: number, cy: number
    if ('touches' in e) {
      cx = e.touches[0].clientX; cy = e.touches[0].clientY
    } else {
      cx = (e as React.MouseEvent).clientX; cy = (e as React.MouseEvent).clientY
    }

    const x = (cx - rect.left)  * sx
    const y = (cy - rect.top)   * sy
    if (x > chartW) return

    const priceRatio = 1 - y / canvasRef.current.height
    const tipPrice   = data.priceMin + priceRatio * (data.priceMax - data.priceMin)

    const colIdx  = Math.min(Math.max(Math.floor((x / chartW) * data.snapshots.length), 0), data.snapshots.length - 1)
    const snap    = data.snapshots[colIdx]
    const bIdx    = Math.min(Math.max(Math.floor((tipPrice - data.priceMin) / data.priceStep), 0), BUCKET_COUNT - 1)
    const estVol  = snap.levels[bIdx] * snap.candle.volume * snap.candle.close * 1000

    setTooltip({ price: tipPrice, volume: estVol, timestamp: snap.timestamp, x, y })

    if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
    tooltipTimer.current = setTimeout(() => setTooltip(null), 3000)
  }, [data])

  // Legend gradient
  const legendStops = Array.from({ length: 20 }, (_, i) => {
    const [r, g, b] = cgColor(i / 19)
    return `rgb(${r},${g},${b})`
  }).join(',')

  return (
    <div style={{ background: '#0C0516', borderRadius: 16, border: '1px solid rgba(120,0,200,0.25)', overflow: 'hidden', userSelect: 'none' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span>🔥</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'white' }}>Liquidation Heatmap</span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{symbol}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
              <div style={{ width: 10, height: 10, border: '1.5px solid rgba(120,0,255,0.3)', borderTopColor: '#9B59B6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              Calcul...
            </div>
          )}
          {price > 0 && (
            <span style={{ fontSize: 14, fontWeight: 700, color: '#00E5FF', fontFamily: 'monospace' }}>
              ${fmtPrice(price)}
            </span>
          )}
        </div>
      </div>

      {/* Period selector */}
      <div style={{ display: 'flex', gap: 3, padding: '0 12px 8px', overflowX: 'auto' }}>
        {PERIODS.map(p => (
          <button key={p.v} onClick={() => setPeriod(p)} style={{
            padding: '3px 9px', borderRadius: 5, fontSize: 10, cursor: 'pointer',
            border: 'none', flexShrink: 0, fontWeight: period.v === p.v ? 700 : 400,
            background: period.v === p.v ? 'rgba(128,0,255,0.45)' : 'rgba(255,255,255,0.05)',
            color: period.v === p.v ? 'white' : 'rgba(255,255,255,0.38)',
            transition: 'all 0.15s',
          }}>{p.label}</button>
        ))}
      </div>

      {/* Canvas */}
      <div style={{ position: 'relative' }}>
        {error ? (
          <div style={{ height: 320, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <span style={{ fontSize: 28, opacity: 0.3 }}>📊</span>
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>{error}</span>
            <button onClick={() => load(symbol, period)} style={{ color: '#00E5FF', background: 'none', border: '1px solid #00E5FF40', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 11 }}>Réessayer</button>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            width={900} height={320}
            style={{ width: '100%', height: 320, display: 'block', cursor: data ? 'crosshair' : 'default' }}
            onMouseMove={handlePointer}
            onMouseDown={handlePointer}
            onMouseLeave={() => {
              if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
              tooltipTimer.current = setTimeout(() => setTooltip(null), 600)
            }}
            onTouchStart={handlePointer}
            onTouchMove={handlePointer}
          />
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px' }}>
        <div style={{ width: 130, height: 8, borderRadius: 2, background: `linear-gradient(to right, ${legendStops})`, flexShrink: 0 }} />
        <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)' }}>Liquidation Leverage</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 8, color: 'rgba(255,255,255,0.25)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 1, background: '#00DC8C', display: 'inline-block' }} /> Bull
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 8, color: 'rgba(255,255,255,0.25)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 1, background: '#EB3246', display: 'inline-block' }} /> Bear
          </span>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
