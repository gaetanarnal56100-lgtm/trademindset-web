// LiquidationMap.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Vue "Liquidation Map" style Coinglass :
//   • X = niveaux de prix
//   • Y gauche = liquidation leverage estimé ($)
//   • Barres orange/jaune : clusters de liquidations par niveau
//   • Ligne rouge  : Cumulative Long Liq Leverage (longs liquidés si prix descend jusque-là)
//   • Ligne verte  : Cumulative Short Liq Leverage (shorts liquidés si prix monte jusque-là)
//   • Ligne pointillée blanche : prix courant
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

interface Kline { openTime: Date; open: number; high: number; low: number; close: number; volume: number }

interface MapData {
  buckets:     number        // nombre de buckets prix
  pMin:        number
  pMax:        number
  step:        number
  longLiq:     Float64Array  // liquidations longs à chaque niveau de prix
  shortLiq:    Float64Array  // liquidations shorts
  cumLong:     Float64Array  // cumulatif longs (prix courant → bas)
  cumShort:    Float64Array  // cumulatif shorts (prix courant → haut)
  currentPrice: number
}

interface Tip { price: number; longV: number; shortV: number; x: number; y: number }

// ── Constantes ─────────────────────────────────────────────────────────────

const BUCKETS = 300

const PAD_L = 68   // axe Y gauche
const PAD_R = 72   // axe Y droite (cumulatif)
const PAD_T = 24
const PAD_B = 36   // axe X prix

const CANVAS_H = 340

const PERIODS = [
  { v:'24h',  label:'24h',    interval:'5m',  limit:288  },
  { v:'3j',   label:'3 jours',interval:'15m', limit:288  },
  { v:'1sem', label:'1 sem',  interval:'30m', limit:336  },
  { v:'2sem', label:'2 sem',  interval:'1h',  limit:336  },
  { v:'1m',   label:'1 mois', interval:'2h',  limit:360  },
  { v:'3m',   label:'3 mois', interval:'6h',  limit:360  },
]

// Leverages et poids relatifs
const LEVERAGES = [2,3,5,10,15,20,25,33,50,75,100,125]
const LEV_W     = [0.10,0.18,0.35,0.70,0.90,1.10,1.40,1.25,1.70,1.15,1.45,0.95]

// ── Fetch ──────────────────────────────────────────────────────────────────

async function fetchKlines(sym: string, interval: string, limit: number): Promise<Kline[]> {
  for (const base of ['https://fapi.binance.com/fapi/v1', 'https://api.binance.com/api/v3']) {
    try {
      const r = await fetch(`${base}/klines?symbol=${sym}&interval=${interval}&limit=${limit}`)
      if (!r.ok) continue
      const raw: unknown[][] = await r.json()
      const k = raw.map(a => ({
        openTime: new Date(Number(a[0])),
        open:  parseFloat(a[1] as string),
        high:  parseFloat(a[2] as string),
        low:   parseFloat(a[3] as string),
        close: parseFloat(a[4] as string),
        volume: parseFloat(a[5] as string),
      }))
      if (k.length) return k
    } catch { continue }
  }
  throw new Error('Binance indisponible')
}

// ── Algorithme ─────────────────────────────────────────────────────────────

function buildMapData(candles: Kline[]): MapData {
  if (!candles.length) throw new Error('Pas de données')

  const currentPrice = candles[candles.length - 1].close

  const rawMin = Math.min(...candles.map(c => c.low))
  const rawMax = Math.max(...candles.map(c => c.high))
  const pad    = (rawMax - rawMin) * 0.15
  const pMin   = rawMin - pad
  const pMax   = rawMax + pad
  const step   = (pMax - pMin) / BUCKETS

  const longLiq  = new Float64Array(BUCKETS)
  const shortLiq = new Float64Array(BUCKETS)

  for (const c of candles) {
    const notional = c.close * c.volume

    for (let li = 0; li < LEVERAGES.length; li++) {
      const lev = LEVERAGES[li]
      const w   = LEV_W[li]

      // Niveau de liquidation long (trader long se fait liq si prix descend ici)
      const longLiqPrice  = c.close * (1 - 1 / lev)
      // Niveau de liquidation short (trader short se fait liq si prix monte ici)
      const shortLiqPrice = c.close * (1 + 1 / lev)

      const lb = Math.round((longLiqPrice  - pMin) / step)
      const sb = Math.round((shortLiqPrice - pMin) / step)

      if (lb >= 0 && lb < BUCKETS) {
        longLiq[lb]  += notional * w
        if (lb > 0)        longLiq[lb - 1]  += notional * w * 0.08
        if (lb < BUCKETS - 1) longLiq[lb + 1]  += notional * w * 0.08
      }
      if (sb >= 0 && sb < BUCKETS) {
        shortLiq[sb] += notional * w
        if (sb > 0)        shortLiq[sb - 1] += notional * w * 0.08
        if (sb < BUCKETS - 1) shortLiq[sb + 1] += notional * w * 0.08
      }
    }
  }

  // Cumulatif Long : partir du prix courant vers le bas (longs liquidés à mesure que le prix baisse)
  const curBucket = Math.round((currentPrice - pMin) / step)
  const cumLong   = new Float64Array(BUCKETS)
  let acc = 0
  for (let b = curBucket; b >= 0; b--) { acc += longLiq[b]; cumLong[b] = acc }

  // Cumulatif Short : partir du prix courant vers le haut
  const cumShort = new Float64Array(BUCKETS)
  acc = 0
  for (let b = curBucket; b < BUCKETS; b++) { acc += shortLiq[b]; cumShort[b] = acc }

  return { buckets: BUCKETS, pMin, pMax, step, longLiq, shortLiq, cumLong, cumShort, currentPrice }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function hiDPI(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; W: number; H: number } {
  const dpr = window.devicePixelRatio || 1
  const W   = canvas.offsetWidth  || 800
  const H   = canvas.offsetHeight || CANVAS_H
  canvas.width  = Math.round(W * dpr)
  canvas.height = Math.round(H * dpr)
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)
  return { ctx, W, H }
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

// Couleur barre selon mix long/short : rouge → orange → jaune → vert
function barColor(longV: number, shortV: number): string {
  const total = longV + shortV
  if (total === 0) return 'rgba(255,140,0,0.6)'
  const shortRatio = shortV / total // 0 = tout long (rouge), 1 = tout short (vert)
  const r = Math.round(220 - shortRatio * 80)
  const g = Math.round(80  + shortRatio * 120)
  const b = Math.round(20  + shortRatio * 30)
  return `rgba(${r},${g},${b},0.75)`
}

const fmtP = (p: number) => p >= 10000 ? `$${p.toFixed(0)}` : p >= 1000 ? `$${p.toFixed(1)}` : `$${p.toFixed(2)}`
const fmtM = (v: number) => {
  const a = Math.abs(v)
  if (a >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`
  if (a >= 1e6)  return `$${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3)  return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

// ── Draw ───────────────────────────────────────────────────────────────────

function drawMap(canvas: HTMLCanvasElement, data: MapData, tip: Tip | null) {
  const { ctx, W, H } = hiDPI(canvas)

  const chartW = W - PAD_L - PAD_R
  const chartH = H - PAD_T - PAD_B

  // Fond
  ctx.fillStyle = '#050210'
  ctx.fillRect(0, 0, W, H)

  // Zones d'axe
  ctx.fillStyle = 'rgba(0,0,0,0.4)'
  ctx.fillRect(0, 0, PAD_L, H)
  ctx.fillRect(W - PAD_R, 0, PAD_R, H)

  if (!chartW || !chartH) return

  const bW   = chartW / data.buckets   // largeur d'un bucket en pixels
  const pRange = data.pMax - data.pMin

  // Maxima pour normalisation
  const maxBar = Math.max(
    Math.max(...data.longLiq),
    Math.max(...data.shortLiq),
    1
  )
  const maxCum = Math.max(
    Math.max(...data.cumLong),
    Math.max(...data.cumShort),
    1
  )

  // Helper : bucket → X
  const bx = (b: number) => PAD_L + b * bW

  // Helper : valeur barre → Y (axe gauche)
  const byBar = (v: number) => PAD_T + chartH * (1 - v / maxBar)

  // Helper : valeur cum → Y (axe droite)
  const byCum = (v: number) => PAD_T + chartH * (1 - v / maxCum)

  // ── Grille horizontale ─────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'
  ctx.lineWidth   = 0.5
  ctx.setLineDash([])
  for (let i = 1; i <= 4; i++) {
    const y = PAD_T + (chartH * i) / 4 + 0.5
    ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(PAD_L + chartW, y); ctx.stroke()
  }

  // ── Barres ────────────────────────────────────────────────────────────
  const curBucket = Math.round((data.currentPrice - data.pMin) / data.step)

  for (let b = 0; b < data.buckets; b++) {
    const lv = data.longLiq[b]
    const sv = data.shortLiq[b]
    const total = lv + sv
    if (total < maxBar * 0.002) continue

    const x    = bx(b)
    const barH = chartH * (total / maxBar)
    const y    = PAD_T + chartH - barH

    // Barre principale
    ctx.fillStyle = barColor(lv, sv)
    ctx.fillRect(Math.floor(x), Math.floor(y), Math.max(Math.ceil(bW), 1), Math.ceil(barH))
  }

  // ── Ligne cumulatif Long (rouge, côté gauche du prix courant) ──────────
  ctx.save()
  ctx.beginPath()
  let firstLong = true
  for (let b = curBucket; b >= 0; b--) {
    if (data.cumLong[b] === 0) continue
    const x = bx(b) + bW / 2
    const y = byCum(data.cumLong[b])
    if (firstLong) { ctx.moveTo(x, y); firstLong = false } else { ctx.lineTo(x, y) }
  }
  ctx.strokeStyle = 'rgba(255,80,60,0.9)'
  ctx.lineWidth   = 2
  ctx.setLineDash([])
  ctx.stroke()
  ctx.restore()

  // ── Ligne cumulatif Short (verte, côté droit du prix courant) ─────────
  ctx.save()
  ctx.beginPath()
  let firstShort = true
  for (let b = curBucket; b < data.buckets; b++) {
    if (data.cumShort[b] === 0) continue
    const x = bx(b) + bW / 2
    const y = byCum(data.cumShort[b])
    if (firstShort) { ctx.moveTo(x, y); firstShort = false } else { ctx.lineTo(x, y) }
  }
  ctx.strokeStyle = 'rgba(34,199,89,0.9)'
  ctx.lineWidth   = 2
  ctx.setLineDash([])
  ctx.stroke()
  ctx.restore()

  // ── Ligne prix courant (verticale pointillée blanche) ─────────────────
  const cpX = Math.round(bx(curBucket) + bW / 2) + 0.5
  ctx.save()
  ctx.setLineDash([5, 4])
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'
  ctx.lineWidth   = 1.5
  ctx.beginPath()
  ctx.moveTo(cpX, PAD_T)
  ctx.lineTo(cpX, PAD_T + chartH)
  ctx.stroke()
  ctx.restore()

  // Label prix courant
  const cpLabel = fmtP(data.currentPrice)
  const cpLW    = Math.max(cpLabel.length * 7 + 14, 70)
  const cpLX    = Math.min(Math.max(cpX - cpLW / 2, PAD_L), PAD_L + chartW - cpLW)
  ctx.fillStyle = '#5B5EF4'
  rr(ctx, cpLX, PAD_T - 20, cpLW, 18, 4); ctx.fill()
  ctx.fillStyle = 'white'; ctx.font = 'bold 9px monospace'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(cpLabel, cpLX + cpLW / 2, PAD_T - 11)

  // ── Axe X prix ────────────────────────────────────────────────────────
  ctx.font = '9px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  const xTicks = 7
  for (let i = 0; i <= xTicks; i++) {
    const p = data.pMin + (pRange * i) / xTicks
    const x = PAD_L + (chartW * i) / xTicks
    ctx.fillText(fmtP(p), x, PAD_T + chartH + 5)
  }

  // ── Axe Y gauche (barres) ─────────────────────────────────────────────
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
  for (let i = 0; i <= 4; i++) {
    const v = (maxBar * (4 - i)) / 4
    const y = PAD_T + (chartH * i) / 4
    ctx.fillText(fmtM(v), PAD_L - 4, y)
  }

  // ── Axe Y droite (cumulatif) ──────────────────────────────────────────
  ctx.textAlign = 'left'
  for (let i = 0; i <= 4; i++) {
    const v = (maxCum * (4 - i)) / 4
    const y = PAD_T + (chartH * i) / 4
    ctx.fillText(fmtM(v), W - PAD_R + 4, y)
  }

  // ── Crosshair hover + tooltip ─────────────────────────────────────────
  if (tip) {
    ctx.save()
    ctx.setLineDash([3, 3])
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'
    ctx.lineWidth   = 0.8
    ctx.beginPath(); ctx.moveTo(tip.x, PAD_T); ctx.lineTo(tip.x, PAD_T + chartH); ctx.stroke()
    ctx.restore()

    // Dot crosshair
    ctx.fillStyle = 'white'
    ctx.beginPath(); ctx.arc(tip.x, PAD_T + chartH / 2, 3.5, 0, Math.PI * 2); ctx.fill()

    // Tooltip
    const TW = 210, TH = 90
    const tx = tip.x > PAD_L + chartW * 0.6 ? tip.x - TW - 12 : tip.x + 12
    const ty = PAD_T + 8
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 14
    ctx.fillStyle   = 'rgba(6,3,20,0.96)'
    rr(ctx, tx, ty, TW, TH, 10); ctx.fill()
    ctx.shadowBlur  = 0
    ctx.strokeStyle = 'rgba(91,94,244,0.5)'; ctx.lineWidth = 1
    rr(ctx, tx, ty, TW, TH, 10); ctx.stroke()

    ctx.font = 'bold 10px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.fillText(fmtP(tip.price), tx + 10, ty + 10)

    const rows: [string, string, string][] = [
      ['Long Liq',  fmtM(tip.longV),  'rgba(255,80,60,0.9)'],
      ['Short Liq', fmtM(tip.shortV), 'rgba(34,199,89,0.9)'],
    ]
    rows.forEach(([label, value, color], idx) => {
      const ly = ty + 32 + idx * 25
      ctx.fillStyle = color
      ctx.beginPath(); ctx.arc(tx + 14, ly + 6, 4, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '9px monospace'
      ctx.fillText(label, tx + 24, ly + 1)
      ctx.fillStyle = 'white'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'right'
      ctx.fillText(value, tx + TW - 10, ly + 1)
      ctx.textAlign = 'left'
    })
  }
}

// ── Component ──────────────────────────────────────────────────────────────

export default function LiquidationMap({ symbol = 'BTCUSDT', embedded = false }: { symbol?: string; embedded?: boolean }) {
  const [period,  setPeriod]  = useState(PERIODS[0])  // 24h par défaut
  const [data,    setData]    = useState<MapData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [tip,     setTip]     = useState<Tip | null>(null)

  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const dataRef    = useRef<MapData | null>(null)
  const tipTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (sym: string, per: typeof PERIODS[0]) => {
    setLoading(true); setError(null); setTip(null); setData(null)
    try {
      const klines = await fetchKlines(sym, per.interval, per.limit)
      const md     = buildMapData(klines)
      dataRef.current = md
      setData(md)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(symbol, period) }, [symbol, period, load])
  useEffect(() => {
    const t = setInterval(() => load(symbol, period), 60_000)
    return () => clearInterval(t)
  }, [symbol, period, load])
  useEffect(() => {
    if (canvasRef.current && data) drawMap(canvasRef.current, data, tip)
  }, [data, tip])

  const handlePointer = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const d = dataRef.current
    if (!d || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    let cx: number
    if ('touches' in e) { cx = e.touches[0].clientX } else { cx = (e as React.MouseEvent).clientX }
    const x = cx - rect.left

    const chartW = rect.width - PAD_L - PAD_R
    if (x < PAD_L || x > PAD_L + chartW) return

    const bW    = chartW / d.buckets
    const b     = Math.min(Math.max(Math.floor((x - PAD_L) / bW), 0), d.buckets - 1)
    const price = d.pMin + (b + 0.5) * d.step

    setTip({ price, longV: d.longLiq[b], shortV: d.shortLiq[b], x, y: 0 })
    if (tipTimer.current) clearTimeout(tipTimer.current)
    tipTimer.current = setTimeout(() => setTip(null), 3500)
  }, [])

  const cumLongMax  = data ? Math.max(...data.cumLong)  : 0
  const cumShortMax = data ? Math.max(...data.cumShort) : 0

  const content = (
    <>
      {/* Header — masqué quand embedded (géré par le parent LiquidationHeatmap) */}
      {!embedded && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>💧</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'white' }}>Liquidation Map</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{symbol}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
                <div style={{ width: 10, height: 10, border: '1.5px solid rgba(120,0,255,0.3)', borderTopColor: '#9B59B6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                Calcul...
              </div>
            )}
            {data && (
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace' }}>
                {fmtP(data.currentPrice)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Info chargement quand embedded */}
      {embedded && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 14px 2px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
                <div style={{ width: 10, height: 10, border: '1.5px solid rgba(120,0,255,0.3)', borderTopColor: '#9B59B6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                Calcul...
              </div>
            )}
          </div>
          {data && (
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace' }}>
              {fmtP(data.currentPrice)}
            </span>
          )}
        </div>
      )}

      {/* Sélecteur période */}
      <div style={{ display: 'flex', gap: 3, padding: '0 14px 8px', overflowX: 'auto', scrollbarWidth: 'none' }}>
        {PERIODS.map(p => (
          <button key={p.v} onClick={() => setPeriod(p)} style={{
            padding: '3px 9px', borderRadius: 5, fontSize: 10, cursor: 'pointer', border: 'none', flexShrink: 0,
            fontWeight: period.v === p.v ? 700 : 400,
            background: period.v === p.v ? 'rgba(100,0,255,0.5)' : 'rgba(255,255,255,0.05)',
            color: period.v === p.v ? 'white' : 'rgba(255,255,255,0.4)',
          }}>{p.label}</button>
        ))}
      </div>

      {/* Légende */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '0 14px 6px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 24, height: 3, background: 'rgba(255,80,60,0.9)', borderRadius: 2 }} />
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)' }}>
            Cumul. Long Liq {cumLongMax > 0 && <span style={{ color: 'rgba(255,80,60,0.8)', fontWeight: 700 }}>{fmtM(cumLongMax)}</span>}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 24, height: 3, background: 'rgba(34,199,89,0.9)', borderRadius: 2 }} />
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)' }}>
            Cumul. Short Liq {cumShortMax > 0 && <span style={{ color: 'rgba(34,199,89,0.8)', fontWeight: 700 }}>{fmtM(cumShortMax)}</span>}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 16, height: 10, background: 'rgba(200,120,30,0.75)', borderRadius: 2 }} />
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)' }}>Clusters Liq.</span>
        </div>
      </div>

      {/* Canvas */}
      {error ? (
        <div style={{ height: CANVAS_H, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <span style={{ fontSize: 24, opacity: 0.3 }}>📊</span>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>{error}</span>
          <button onClick={() => load(symbol, period)} style={{ color: '#7B61FF', background: 'none', border: '1px solid #7B61FF40', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 11 }}>Réessayer</button>
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width: '100%', height: CANVAS_H, cursor: 'crosshair' }}
          onMouseMove={handlePointer}
          onMouseDown={handlePointer}
          onMouseLeave={() => { if (tipTimer.current) clearTimeout(tipTimer.current); setTip(null) }}
          onTouchStart={handlePointer}
          onTouchMove={handlePointer}
          onTouchEnd={() => { if (tipTimer.current) clearTimeout(tipTimer.current); tipTimer.current = setTimeout(() => setTip(null), 2500) }}
        />
      )}

      {/* Note méthodologie */}
      <div style={{ padding: '6px 14px 10px', fontSize: 9, color: 'rgba(255,255,255,0.2)', lineHeight: 1.4 }}>
        Estimation basée sur les niveaux de liq. théoriques (leviers 2×→125×) calculés à partir des klines Binance.
      </div>
    </>
  )

  if (embedded) return <div style={{ userSelect: 'none' }}>{content}</div>

  return (
    <div style={{ background: '#050210', borderRadius: 16, border: '1px solid rgba(80,0,180,0.35)', overflow: 'hidden', userSelect: 'none' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      {content}
    </div>
  )
}
