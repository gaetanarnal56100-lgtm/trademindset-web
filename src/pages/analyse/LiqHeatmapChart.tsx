// LiqHeatmapChart.tsx — Liquidation Heatmap approximée depuis Binance klines
// Algo : pour chaque bougie, distribution des liquidations estimées par levier (5×→100×)
// Rendu : canvas 2D (grille colorée violette→jaune) + bougies superposées + tooltip hover
import { useEffect, useRef, useState, useCallback } from 'react'
import { getAuth } from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/services/firebase/config'
import { getNotifSettings } from '@/services/firestore/customAlerts'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Kline {
  openTime: number; open: number; high: number; low: number; close: number
  volume: number; closeTime: number
}
interface TooltipData {
  x: number; y: number          // pixel position in container
  price: number
  kline: Kline | null
  totalLiq: number              // estimated USD liq at this price level
  leverageBreakdown: { lev: number; amount: number }[]
  timeLabel: string
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
const N_PRICE_BINS  = 250
const MAINT_MARGIN  = 0.004
const LONG_FRAC     = 0.55
const LABEL_W       = 64

// ── Color scale ────────────────────────────────────────────────────────────────
function intensityToColor(t: number): string {
  if (t <= 0) return 'transparent'
  const alpha = Math.min(0.92, 0.25 + t * 0.67)
  if (t < 0.25) {
    const s = t / 0.25
    return `rgba(${Math.round(80+s*(30-80))},${Math.round(s*50)},${Math.round(160+s*95)},${alpha})`
  }
  if (t < 0.55) {
    const s = (t - 0.25) / 0.30
    return `rgba(${Math.round(30-s*30)},${Math.round(50+s*170)},${Math.round(255-s*175)},${alpha})`
  }
  if (t < 0.80) {
    const s = (t - 0.55) / 0.25
    return `rgba(${Math.round(s*180)},${Math.round(220+s*35)},${Math.round(80-s*80)},${alpha})`
  }
  const s = (t - 0.80) / 0.20
  return `rgba(${Math.round(180+s*75)},255,0,${alpha})`
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtPrice(p: number) {
  return p >= 10000 ? `$${p.toFixed(0)}` : p >= 100 ? `$${p.toFixed(2)}` : `$${p.toFixed(4)}`
}
function fmtUSD(v: number) {
  if (v >= 1e9) return `$${(v/1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v/1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v/1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}
function fmtTime(ts: number) {
  const d = new Date(ts)
  return `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
}

// ── Zone extraction ────────────────────────────────────────────────────────────
interface LiqZone {
  price: number
  strength: number    // 0..1 relative to global max
  stars: string       // ★ x 1..5
  side: 'above' | 'below'
  type: string        // "Long Squeeze" | "Short Squeeze"
}

function extractLiqZones(
  grid: Float32Array, klines: Kline[], pMin: number, pMax: number,
): LiqZone[] {
  const N = klines.length
  const pRange = pMax - pMin
  const currentPrice = klines[N - 1]?.close ?? 0

  // Aggregate grid across time
  const bins = new Float32Array(N_PRICE_BINS)
  for (let t = 0; t < N; t++)
    for (let b = 0; b < N_PRICE_BINS; b++)
      bins[b] += grid[t * N_PRICE_BINS + b]

  const binToPrice = (b: number) => pMin + ((b + 0.5) / N_PRICE_BINS) * pRange
  const globalMax = Math.max(...Array.from(bins))
  const threshold = globalMax * 0.15

  // Find local maxima (clusters)
  const zones: LiqZone[] = []
  for (let b = 3; b < N_PRICE_BINS - 3; b++) {
    const v = bins[b]
    if (v < threshold) continue
    const isLocalMax = v >= bins[b-1] && v >= bins[b+1] && v >= bins[b-2] && v >= bins[b+2]
    if (!isLocalMax) continue
    const price = binToPrice(b)
    const strength = v / globalMax
    const stars = '★'.repeat(Math.max(1, Math.min(5, Math.round(strength * 5))))
    const side = price > currentPrice ? 'above' : 'below'
    zones.push({
      price, strength, stars, side,
      type: side === 'above' ? 'Liquidation Longs (Short Squeeze)' : 'Liquidation Shorts (Long Squeeze)',
    })
  }

  // Sort by strength, keep top 12
  return zones.sort((a, b) => b.strength - a.strength).slice(0, 12)
}

function buildPrompt(symbol: string, tf: string, klines: Kline[], zones: LiqZone[]): string {
  const last = klines[klines.length - 1]
  const prev = klines[klines.length - 2]
  const change24h = ((last.close - prev.close) / prev.close * 100).toFixed(2)
  const above = zones.filter(z => z.side === 'above').sort((a, b) => a.price - b.price)
  const below = zones.filter(z => z.side === 'below').sort((a, b) => b.price - a.price)

  const fmtZone = (z: LiqZone) =>
    `  ${fmtPrice(z.price)} ${z.stars} (force ${(z.strength * 100).toFixed(0)}%) — ${z.type}`

  return `Tu es un analyste technique expert en crypto. Analyse ce liquidation heatmap.

DONNÉES MARCHÉ:
Symbole: ${symbol} | TF: ${tf} | Bougies analysées: ${klines.length}
Prix actuel: ${fmtPrice(last.close)} | Variation: ${change24h}%
High période: ${fmtPrice(Math.max(...klines.map(k => k.high)))}
Low période: ${fmtPrice(Math.min(...klines.map(k => k.low)))}

ZONES DE LIQUIDATION AU-DESSUS (résistances / long squeeze si price monte):
${above.length ? above.map(fmtZone).join('\n') : '  Aucune zone significative'}

ZONES DE LIQUIDATION EN DESSOUS (supports / short squeeze si price baisse):
${below.length ? below.map(fmtZone).join('\n') : '  Aucune zone significative'}

LÉGENDE ÉTOILES: ★ faible / ★★★ modéré / ★★★★★ cluster majeur

Fournis une analyse structurée EN FRANÇAIS (max 220 mots) avec ces sections exactes:
📊 BIAIS: Haussier/Baissier/Neutre + justification courte basée sur asymétrie des zones
🎯 CIBLE PRINCIPALE: niveau le plus attractif à atteindre en premier (avec raison)
🔥 ZONES CLÉS: liste 3-4 niveaux critiques avec ce qu'il se passera si prix les touche
⚠️ INVALIDATION: niveau qui invaliderait le scénario principal
💡 STRATÉGIE: conseil actionnable concret (attendre retest, éviter, surveiller, etc.)

Ton analyse doit être précise, chiffrée, professionnelle.`
}

async function callGPTAnalysis(prompt: string): Promise<string> {
  const fn = httpsCallable<unknown, { choices: { message: { content: string } }[] }>(functions, 'openaiChat')
  const res = await fn({
    model: 'gpt-4o',
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }],
  })
  return res.data.choices[0]?.message?.content ?? ''
}

// ── Fetch ──────────────────────────────────────────────────────────────────────
async function fetchKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
  const r = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`)
  if (!r.ok) throw new Error(`Binance ${r.status}`)
  const data = await r.json() as [number,string,string,string,string,string,number,...unknown[]][]
  return data.map(k => ({
    openTime: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
    low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]), closeTime: k[6],
  }))
}

// ── Build grid ─────────────────────────────────────────────────────────────────
function buildGrid(klines: Kline[]): {
  grid: Float32Array; pMin: number; pMax: number; maxVal: number
} {
  const allP = klines.flatMap(k => [k.high, k.low])
  const rawMin = Math.min(...allP), rawMax = Math.max(...allP)
  const margin = (rawMax - rawMin) * 0.20
  const pMin = rawMin - margin, pMax = rawMax + margin
  const pRange = pMax - pMin
  const N = klines.length
  const grid = new Float32Array(N * N_PRICE_BINS)

  const toBin = (p: number) => Math.max(0, Math.min(N_PRICE_BINS-1, Math.floor(((p-pMin)/pRange)*N_PRICE_BINS)))
  const add = (t: number, p: number, val: number) => {
    const bin = toBin(p)
    for (let d = -2; d <= 2; d++) {
      const b = bin + d
      if (b < 0 || b >= N_PRICE_BINS) continue
      grid[t * N_PRICE_BINS + b] += val * (1 - Math.abs(d) * 0.3)
    }
  }

  for (let i = 0; i < N; i++) {
    const k = klines[i]
    for (const { lev, weight } of LEVERAGE_TIERS) {
      const c = k.volume * weight
      add(i, k.close * (1 - (1/lev) + MAINT_MARGIN), c * LONG_FRAC)
      add(i, k.close * (1 + (1/lev) - MAINT_MARGIN), c * (1 - LONG_FRAC))
      add(i, k.high  * (1 - (1/lev) + MAINT_MARGIN), c * LONG_FRAC  * 0.35)
      add(i, k.low   * (1 + (1/lev) - MAINT_MARGIN), c * (1-LONG_FRAC) * 0.35)
    }
  }

  let maxVal = 0
  for (let i = 0; i < grid.length; i++) maxVal = Math.max(maxVal, grid[i])
  return { grid, pMin, pMax, maxVal }
}

// ── Draw ───────────────────────────────────────────────────────────────────────
function drawHeatmap(
  canvas: HTMLCanvasElement,
  klines: Kline[], grid: Float32Array,
  pMin: number, pMax: number, maxVal: number,
  showCandles: boolean,
  crosshair?: { tIdx: number; priceY: number } | null,
) {
  const dpr = window.devicePixelRatio || 1
  const W = canvas.clientWidth, H = canvas.clientHeight
  if (!W || !H) return
  canvas.width = W * dpr; canvas.height = H * dpr
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)

  ctx.fillStyle = '#080C14'; ctx.fillRect(0, 0, W, H)

  const N = klines.length
  const CHART_W = W - LABEL_W
  const cellW = CHART_W / N
  const cellH = H / N_PRICE_BINS
  const pRange = pMax - pMin
  const pToY = (p: number) => H - ((p - pMin) / pRange) * H

  // Heatmap cells
  for (let t = 0; t < N; t++) {
    for (let b = 0; b < N_PRICE_BINS; b++) {
      const val = grid[t * N_PRICE_BINS + b]
      if (val <= 0) continue
      const color = intensityToColor(Math.pow(val / maxVal, 0.45))
      if (color === 'transparent') continue
      ctx.fillStyle = color
      ctx.fillRect(t * cellW, H - (b+1)*cellH, cellW+0.5, cellH+0.5)
    }
  }

  // Candlesticks
  if (showCandles) {
    const cW = Math.max(2, cellW * 0.7)
    for (let i = 0; i < N; i++) {
      const k = klines[i], x = i * cellW + cellW / 2
      const isUp = k.close >= k.open
      const clr = isUp ? '#26C281' : '#E74C3C'
      ctx.strokeStyle = clr; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(x, pToY(k.high)); ctx.lineTo(x, pToY(k.low)); ctx.stroke()
      const bTop = pToY(Math.max(k.open, k.close))
      const bBot = pToY(Math.min(k.open, k.close))
      ctx.fillStyle = clr
      ctx.fillRect(x - cW/2, bTop, cW, Math.max(1, bBot - bTop))
    }
  }

  // Crosshair
  if (crosshair) {
    const cx = crosshair.tIdx * cellW + cellW / 2
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.setLineDash([4,4])
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, crosshair.priceY); ctx.lineTo(CHART_W, crosshair.priceY); ctx.stroke()
    ctx.setLineDash([])
    // Highlight column
    ctx.fillStyle = 'rgba(255,255,255,0.04)'
    ctx.fillRect(crosshair.tIdx * cellW, 0, cellW, H)
  }

  // Price axis
  ctx.fillStyle = '#080C14'; ctx.fillRect(CHART_W, 0, LABEL_W, H)
  const currentPrice = klines[klines.length - 1]?.close ?? 0
  for (let i = 0; i <= 8; i++) {
    const p = pMin + (pRange * i) / 8
    const y = pToY(p)
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CHART_W, y); ctx.stroke()
    ctx.fillStyle = 'rgba(143,148,163,0.5)'; ctx.font = '9px JetBrains Mono,monospace'
    ctx.textAlign = 'left'
    const lbl = p >= 10000 ? `$${(p/1000).toFixed(1)}k` : `$${p.toFixed(p<10?4:2)}`
    ctx.fillText(lbl, CHART_W + 4, y + 3)
  }
  // Current price dashed line + badge
  const cy = pToY(currentPrice)
  ctx.strokeStyle = '#00E5FF'; ctx.lineWidth = 1; ctx.setLineDash([4,4])
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(CHART_W, cy); ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = '#00E5FF'
  ctx.fillRect(CHART_W + 2, cy - 8, LABEL_W - 4, 16)
  ctx.fillStyle = '#000'; ctx.font = '700 9px JetBrains Mono,monospace'; ctx.textAlign = 'center'
  ctx.fillText(currentPrice >= 10000 ? `$${currentPrice.toFixed(0)}` : `$${currentPrice.toFixed(2)}`, CHART_W + LABEL_W/2, cy + 3)
  ctx.textAlign = 'left'

  // Time labels
  const step = Math.max(1, Math.floor(N / 8))
  ctx.font = '9px JetBrains Mono,monospace'; ctx.fillStyle = 'rgba(143,148,163,0.4)'; ctx.textAlign = 'center'
  for (let i = 0; i < N; i += step) {
    const d = new Date(klines[i].openTime)
    ctx.fillText(`${d.getDate()}/${d.getMonth()+1} ${d.getHours().toString().padStart(2,'0')}h`, i * cellW + cellW/2, H - 3)
  }
}

// ── Compute tooltip data from mouse position ────────────────────────────────────
function computeTooltip(
  e: React.MouseEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement,
  klines: Kline[], grid: Float32Array,
  pMin: number, pMax: number, maxVal: number,
): { tooltip: TooltipData; crosshair: { tIdx: number; priceY: number } } | null {
  const rect = canvas.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  const W = rect.width, H = rect.height
  const CHART_W = W - LABEL_W
  if (mx > CHART_W || mx < 0) return null

  const N = klines.length
  const cellW = CHART_W / N
  const tIdx = Math.min(N - 1, Math.max(0, Math.floor(mx / cellW)))
  const pRange = pMax - pMin
  const price = pMin + ((H - my) / H) * pRange
  const priceBin = Math.floor(((price - pMin) / pRange) * N_PRICE_BINS)

  // Total liq at this price bin (sum across all times, weighted by recency)
  let totalLiq = 0
  for (let t = 0; t < N; t++) {
    const b = Math.max(0, Math.min(N_PRICE_BINS-1, priceBin))
    totalLiq += grid[t * N_PRICE_BINS + b]
  }
  // Normalize to USD estimate (rough)
  const normTotal = maxVal > 0 ? (totalLiq / (maxVal * N)) * 100 : 0

  // Leverage breakdown at current time column
  const leverageBreakdown = LEVERAGE_TIERS.map(({ lev, weight }) => ({
    lev,
    amount: grid[tIdx * N_PRICE_BINS + Math.max(0, Math.min(N_PRICE_BINS-1, priceBin))] * weight * 100,
  }))

  const k = klines[tIdx] ?? null

  return {
    tooltip: {
      x: mx, y: my,
      price,
      kline: k,
      totalLiq: normTotal,
      leverageBreakdown,
      timeLabel: k ? fmtTime(k.openTime) : '',
    },
    crosshair: { tIdx, priceY: my },
  }
}

// ── Discord send ────────────────────────────────────────────────────────────────
async function sendCanvasToDiscord(
  canvas: HTMLCanvasElement,
  symbol: string,
  tf: string,
  webhookUrl: string,
): Promise<void> {
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png', 0.95)
  )
  const fd = new FormData()
  const now = new Date().toLocaleString('fr-FR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
  fd.append('files[0]', blob, `liq_heatmap_${symbol}_${tf}.png`)
  fd.append('payload_json', JSON.stringify({
    content: `🔥 **Liquidation Heatmap** — ${symbol} (${tf})\n⏰ ${now}\n*Estimation zones de liquidation · TradeMindSet*`,
  }))
  const r = await fetch(webhookUrl, { method: 'POST', body: fd })
  if (!r.ok && r.status !== 204) throw new Error(`Discord ${r.status}`)
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function LiqHeatmapChart({ symbol }: { symbol: string }) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const wrapRef      = useRef<HTMLDivElement>(null)
  const dataRef      = useRef<{ klines: Kline[]; grid: Float32Array; pMin: number; pMax: number; maxVal: number } | null>(null)

  const [tf,           setTf]           = useState<HeatTF>('1h')
  const [limit,        setLimit]        = useState(200)
  const [showCandles,  setShowCandles]  = useState(true)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string|null>(null)
  const [lastUpdate,   setLastUpdate]   = useState(0)
  const [tooltip,      setTooltip]      = useState<TooltipData | null>(null)
  const [crosshair,    setCrosshair]    = useState<{ tIdx: number; priceY: number } | null>(null)
  const [sending,      setSending]      = useState(false)
  const [sendStatus,   setSendStatus]   = useState<'idle'|'ok'|'error'|'nowebhook'>('idle')
  const [analysis,     setAnalysis]     = useState<string>('')
  const [analyzing,    setAnalyzing]    = useState(false)
  const [analysisErr,  setAnalysisErr]  = useState<string>('')
  const [showAnalysis, setShowAnalysis] = useState(false)

  const redraw = useCallback((ch?: { tIdx: number; priceY: number } | null) => {
    const c = canvasRef.current, d = dataRef.current
    if (!c || !d) return
    drawHeatmap(c, d.klines, d.grid, d.pMin, d.pMax, d.maxVal, showCandles, ch ?? crosshair)
  }, [showCandles, crosshair])

  const fetchAndDraw = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const klines = await fetchKlines(symbol, tf, limit)
      const { grid, pMin, pMax, maxVal } = buildGrid(klines)
      dataRef.current = { klines, grid, pMin, pMax, maxVal }
      setLastUpdate(Date.now())
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }, [symbol, tf, limit])

  useEffect(() => { fetchAndDraw() }, [fetchAndDraw])
  useEffect(() => { const id = setInterval(fetchAndDraw, 2*60*1000); return () => clearInterval(id) }, [fetchAndDraw])
  useEffect(() => { redraw() }, [lastUpdate, redraw])
  useEffect(() => {
    const obs = new ResizeObserver(() => redraw())
    if (wrapRef.current) obs.observe(wrapRef.current)
    return () => obs.disconnect()
  }, [redraw])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current, d = dataRef.current
    if (!canvas || !d) return
    const res = computeTooltip(e, canvas, d.klines, d.grid, d.pMin, d.pMax, d.maxVal)
    if (!res) { setTooltip(null); setCrosshair(null); return }
    setTooltip(res.tooltip)
    setCrosshair(res.crosshair)
    redraw(res.crosshair)
  }, [redraw])

  const handleMouseLeave = useCallback(() => {
    setTooltip(null); setCrosshair(null); redraw(null)
  }, [redraw])

  const handleSendDiscord = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    setSending(true)
    try {
      const uid = getAuth().currentUser?.uid
      if (!uid) throw new Error('non connecté')
      const settings = await getNotifSettings(uid)
      if (!settings.discordWebhook) { setSendStatus('nowebhook'); setTimeout(() => setSendStatus('idle'), 3000); return }
      await sendCanvasToDiscord(canvas, symbol, tf, settings.discordWebhook)
      setSendStatus('ok')
    } catch { setSendStatus('error') }
    finally { setSending(false); setTimeout(() => setSendStatus('idle'), 3000) }
  }, [symbol, tf])

  const handleAnalyze = useCallback(async () => {
    const d = dataRef.current
    if (!d) return
    setAnalyzing(true)
    setAnalysisErr('')
    setShowAnalysis(true)
    try {
      const zones = extractLiqZones(d.grid, d.klines, d.pMin, d.pMax)
      const prompt = buildPrompt(symbol, tf, d.klines, zones)
      const text = await callGPTAnalysis(prompt)
      setAnalysis(text)
    } catch (e) {
      setAnalysisErr((e as Error).message)
    } finally {
      setAnalyzing(false)
    }
  }, [symbol, tf])

  // ── Styles ──
  const btn = (active: boolean): React.CSSProperties => ({
    padding:'5px 10px', borderRadius:7, fontSize:11, fontWeight:700, cursor:'pointer',
    border:`1px solid ${active ? 'rgba(0,229,255,0.5)' : 'rgba(255,255,255,0.08)'}`,
    background: active ? 'rgba(0,229,255,0.12)' : 'rgba(255,255,255,0.03)',
    color: active ? '#00E5FF' : 'rgba(143,148,163,0.7)', transition:'all 0.15s',
  })

  const sendColor = sendStatus === 'ok' ? '#34C759' : sendStatus === 'error' ? '#FF3B30' : sendStatus === 'nowebhook' ? '#FF9500' : '#5856D6'
  const sendLabel = sending ? '⟳' : sendStatus === 'ok' ? '✓ Envoyé' : sendStatus === 'error' ? '✗ Erreur' : sendStatus === 'nowebhook' ? '⚠ No webhook' : '📤 Discord'

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10, height:'100%' }}>
      {/* Toolbar */}
      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', padding:'8px 14px', background:'rgba(13,17,35,0.85)', border:'1px solid rgba(0,229,255,0.12)', borderRadius:12, backdropFilter:'blur(8px)' }}>
        <span style={{ fontSize:12, fontWeight:800, color:'#00E5FF', fontFamily:'JetBrains Mono,monospace' }}>{symbol}</span>
        <div style={{ width:1, height:16, background:'rgba(255,255,255,0.1)' }} />
        <div style={{ display:'flex', gap:4 }}>
          {TF_OPTIONS.map(t => <button key={t} style={btn(tf===t)} onClick={() => setTf(t)}>{t}</button>)}
        </div>
        <div style={{ width:1, height:16, background:'rgba(255,255,255,0.1)' }} />
        {([100,200,300] as const).map(n => <button key={n} style={btn(limit===n)} onClick={() => setLimit(n)}>{n}</button>)}
        <div style={{ width:1, height:16, background:'rgba(255,255,255,0.1)' }} />
        <button style={btn(showCandles)} onClick={() => setShowCandles(v => !v)}>🕯 Bougies</button>
        <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
          {/* AI Analyse */}
          <button
            style={{ ...btn(showAnalysis), color: analyzing ? '#FF9500' : showAnalysis ? '#BF5AF2' : '#BF5AF2', borderColor: showAnalysis ? 'rgba(191,90,242,0.5)' : 'rgba(191,90,242,0.25)', background: showAnalysis ? 'rgba(191,90,242,0.12)' : 'rgba(191,90,242,0.05)' }}
            onClick={handleAnalyze}
            disabled={analyzing || !lastUpdate}
            title="Analyse GPT-4o des zones de liquidation"
          >{analyzing ? '⟳ Analyse…' : '🤖 Analyser'}</button>

          {/* Discord send */}
          <button
            style={{ ...btn(false), color: sendColor, borderColor:`${sendColor}50`, background:`${sendColor}12` }}
            onClick={handleSendDiscord}
            disabled={sending}
            title="Envoyer screenshot au webhook Discord configuré dans les Alertes"
          >{sendLabel}</button>
          <button style={btn(false)} onClick={fetchAndDraw} disabled={loading}>{loading ? '⟳' : '↻'}</button>
          {lastUpdate > 0 && (
            <span style={{ fontSize:9, color:'rgba(143,148,163,0.4)', fontFamily:'JetBrains Mono,monospace' }}>
              {new Date(lastUpdate).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}
            </span>
          )}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display:'flex', alignItems:'center', gap:6, paddingLeft:4 }}>
        <span style={{ fontSize:9, color:'rgba(143,148,163,0.5)', fontFamily:'JetBrains Mono,monospace' }}>LIQ CONCENTRATION</span>
        <div style={{ width:120, height:8, borderRadius:4, background:'linear-gradient(to right, rgba(80,0,160,0.6),rgba(30,50,255,0.7),rgba(0,220,80,0.8),rgba(180,255,0,0.9),rgba(255,255,0,1))' }} />
        <span style={{ fontSize:9, color:'rgba(143,148,163,0.5)', fontFamily:'JetBrains Mono,monospace' }}>MAX</span>
      </div>

      {/* Canvas + tooltip */}
      <div ref={wrapRef} style={{ flex:1, position:'relative', borderRadius:12, overflow:'hidden', border:'1px solid rgba(0,229,255,0.10)', minHeight:400 }}>
        {loading && (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(8,12,20,0.75)', zIndex:10, borderRadius:12 }}>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:28, animation:'spin 1s linear infinite', marginBottom:8 }}>⟳</div>
              <div style={{ fontSize:12, color:'rgba(0,229,255,0.8)', fontFamily:'JetBrains Mono,monospace' }}>Calcul heatmap…</div>
            </div>
          </div>
        )}
        {error && (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(8,12,20,0.9)', zIndex:10, borderRadius:12 }}>
            <span style={{ fontSize:12, color:'#FF3B30', fontFamily:'JetBrains Mono,monospace' }}>⚠ {error}</span>
          </div>
        )}

        <canvas
          ref={canvasRef}
          style={{ width:'100%', height:'100%', display:'block', cursor:'crosshair' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />

        {/* Tooltip */}
        {tooltip && (
          <div style={{
            position:'absolute',
            left: tooltip.x > (wrapRef.current?.clientWidth ?? 0) / 2 ? tooltip.x - 210 : tooltip.x + 16,
            top: Math.max(8, Math.min(tooltip.y - 80, (wrapRef.current?.clientHeight ?? 0) - 220)),
            width: 200,
            background:'rgba(10,14,28,0.96)',
            border:'1px solid rgba(0,229,255,0.25)',
            borderRadius:10,
            padding:'10px 13px',
            pointerEvents:'none',
            zIndex:20,
            fontFamily:'JetBrains Mono,monospace',
            boxShadow:'0 4px 24px rgba(0,0,0,0.5)',
          }}>
            {/* Time + candle */}
            {tooltip.kline && (<>
              <div style={{ fontSize:10, color:'rgba(0,229,255,0.7)', marginBottom:6, fontWeight:700 }}>
                {tooltip.timeLabel}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'3px 8px', marginBottom:8 }}>
                {[
                  { l:'O', v: fmtPrice(tooltip.kline.open),  c:'rgba(143,148,163,0.8)' },
                  { l:'H', v: fmtPrice(tooltip.kline.high),  c:'#34C759' },
                  { l:'L', v: fmtPrice(tooltip.kline.low),   c:'#FF3B30' },
                  { l:'C', v: fmtPrice(tooltip.kline.close), c: tooltip.kline.close >= tooltip.kline.open ? '#34C759' : '#FF3B30' },
                ].map(({ l, v, c }) => (
                  <div key={l} style={{ display:'flex', gap:4, alignItems:'baseline' }}>
                    <span style={{ fontSize:9, color:'rgba(143,148,163,0.5)', width:8 }}>{l}</span>
                    <span style={{ fontSize:10, fontWeight:700, color:c }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize:9, color:'rgba(143,148,163,0.5)', marginBottom:2 }}>Volume</div>
              <div style={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.8)', marginBottom:8 }}>
                {tooltip.kline.volume >= 1000 ? `${(tooltip.kline.volume/1000).toFixed(1)}K` : tooltip.kline.volume.toFixed(2)}
              </div>
            </>)}

            {/* Price at cursor */}
            <div style={{ borderTop:'1px solid rgba(255,255,255,0.07)', paddingTop:7, marginBottom:6 }}>
              <div style={{ fontSize:9, color:'rgba(143,148,163,0.5)', marginBottom:2 }}>PRIX CURSEUR</div>
              <div style={{ fontSize:12, fontWeight:800, color:'#00E5FF' }}>{fmtPrice(tooltip.price)}</div>
            </div>

            {/* Leverage breakdown */}
            <div style={{ borderTop:'1px solid rgba(255,255,255,0.07)', paddingTop:7 }}>
              <div style={{ fontSize:9, color:'rgba(143,148,163,0.5)', marginBottom:6 }}>LEVIERS LIQUIDÉS ICI</div>
              {tooltip.leverageBreakdown.map(({ lev, amount }) => {
                const w = Math.min(100, (amount / Math.max(...tooltip.leverageBreakdown.map(x => x.amount))) * 100)
                return (
                  <div key={lev} style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                    <span style={{ fontSize:9, color:'rgba(143,148,163,0.6)', width:32, flexShrink:0 }}>{lev}×</span>
                    <div style={{ flex:1, height:4, background:'rgba(255,255,255,0.06)', borderRadius:2 }}>
                      <div style={{ width:`${w}%`, height:'100%', borderRadius:2, background: w > 60 ? '#FFD700' : w > 30 ? '#00C853' : '#0080FF' }} />
                    </div>
                    <span style={{ fontSize:9, color:'rgba(143,148,163,0.5)', width:28, textAlign:'right' }}>{w.toFixed(0)}%</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* AI Analysis Panel */}
      {showAnalysis && (
        <div style={{
          background:'rgba(13,17,35,0.95)',
          border:'1px solid rgba(191,90,242,0.3)',
          borderRadius:14,
          padding:'16px 20px',
          backdropFilter:'blur(12px)',
          boxShadow:'0 0 24px rgba(191,90,242,0.08)',
          position:'relative',
        }}>
          {/* Header */}
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
            <div style={{ width:32, height:32, borderRadius:10, background:'rgba(191,90,242,0.15)', border:'1px solid rgba(191,90,242,0.3)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>🤖</div>
            <div>
              <div style={{ fontSize:13, fontWeight:700, color:'#BF5AF2', fontFamily:'Syne,sans-serif' }}>Analyse IA — Liquidation Heatmap</div>
              <div style={{ fontSize:10, color:'rgba(191,90,242,0.6)', fontFamily:'JetBrains Mono,monospace' }}>{symbol} · {tf} · GPT-4o</div>
            </div>
            <button
              onClick={() => setShowAnalysis(false)}
              style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:'rgba(143,148,163,0.5)', fontSize:16, padding:4 }}
            >✕</button>
          </div>

          {/* Loading */}
          {analyzing && (
            <div style={{ display:'flex', alignItems:'center', gap:10, padding:'20px 0' }}>
              <div style={{ fontSize:20, animation:'spin 1s linear infinite' }}>⟳</div>
              <span style={{ fontSize:12, color:'rgba(191,90,242,0.7)', fontFamily:'JetBrains Mono,monospace' }}>
                Extraction des zones · Appel GPT-4o…
              </span>
            </div>
          )}

          {/* Error */}
          {analysisErr && !analyzing && (
            <div style={{ fontSize:12, color:'#FF3B30', fontFamily:'JetBrains Mono,monospace', padding:'8px 0' }}>
              ⚠ {analysisErr}
            </div>
          )}

          {/* Analysis text */}
          {analysis && !analyzing && (
            <div style={{ fontSize:13, color:'rgba(220,225,240,0.92)', lineHeight:1.75, whiteSpace:'pre-wrap', fontFamily:'system-ui,sans-serif' }}>
              {analysis.split('\n').map((line, i) => {
                // Highlight section headers
                const isBias    = line.startsWith('📊')
                const isTarget  = line.startsWith('🎯')
                const isZones   = line.startsWith('🔥')
                const isInval   = line.startsWith('⚠️') || line.startsWith('⚠')
                const isStrat   = line.startsWith('💡')
                const isHeader  = isBias || isTarget || isZones || isInval || isStrat
                return (
                  <div
                    key={i}
                    style={{
                      marginBottom: isHeader ? 8 : line === '' ? 10 : 2,
                      fontWeight: isHeader ? 700 : 400,
                      color: isBias
                        ? (line.toLowerCase().includes('hausse') || line.toLowerCase().includes('bull') ? '#34C759' : line.toLowerCase().includes('baisse') || line.toLowerCase().includes('bear') ? '#FF3B30' : '#FF9500')
                        : isTarget ? '#00E5FF'
                        : isZones ? '#FF9500'
                        : isInval ? '#FF3B30'
                        : isStrat ? '#BF5AF2'
                        : 'rgba(220,225,240,0.85)',
                      fontSize: isHeader ? 13 : 12,
                      paddingLeft: isHeader ? 0 : 4,
                      borderLeft: isHeader ? '2px solid currentColor' : 'none',
                      paddingTop: isHeader && i > 0 ? 6 : 0,
                    }}
                  >
                    {line}
                  </div>
                )
              })}
            </div>
          )}

          {/* Re-analyze button */}
          {analysis && !analyzing && (
            <div style={{ marginTop:14, paddingTop:12, borderTop:'1px solid rgba(255,255,255,0.05)', display:'flex', gap:10 }}>
              <button
                onClick={handleAnalyze}
                style={{ padding:'6px 14px', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer', border:'1px solid rgba(191,90,242,0.3)', background:'rgba(191,90,242,0.08)', color:'#BF5AF2' }}
              >↻ Actualiser l'analyse</button>
              <span style={{ fontSize:10, color:'rgba(143,148,163,0.4)', fontFamily:'JetBrains Mono,monospace', alignSelf:'center' }}>
                basé sur {dataRef.current?.klines.length ?? 0} bougies
              </span>
            </div>
          )}
        </div>
      )}

      <div style={{ fontSize:9, color:'rgba(143,148,163,0.3)', fontFamily:'JetBrains Mono,monospace', paddingLeft:4 }}>
        Estimation · volume Binance × leviers 5×→100× · pas les données réelles Coinglass · 📤 Discord = webhook configuré dans Alertes
      </div>
    </div>
  )
}
