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

// ── Analysis types ─────────────────────────────────────────────────────────────
interface LiqZone {
  price: number; strength: number; stars: string
  side: 'above' | 'below'; type: string
}

interface CascadeNode {
  price: number
  strength: number    // 0..1
  side: 'above' | 'below'
  order: number       // 1 = nearest/primary target, 2 = second, etc.
  label: string       // "T1 Short Squeeze" etc.
}

interface CanvasAnnotation {
  price: number
  type: 'target' | 'resistance' | 'support' | 'invalidation' | 'zone'
  label: string    // e.g. "🎯 Cible"
  detail: string   // short description drawn on chart
  color: string
}

interface AnalysisResult {
  bias: 'HAUSSIER' | 'BAISSIER' | 'NEUTRE'
  biasReason: string
  strategy: string
  annotations: CanvasAnnotation[]
  textSections: { bias: string; target: string; zones: string; invalidation: string; strategy: string }
}

// ── Zone extraction ────────────────────────────────────────────────────────────
function extractLiqZones(grid: Float32Array, klines: Kline[], pMin: number, pMax: number): LiqZone[] {
  const N = klines.length
  const pRange = pMax - pMin
  const currentPrice = klines[N - 1]?.close ?? 0
  const bins = new Float32Array(N_PRICE_BINS)
  for (let t = 0; t < N; t++)
    for (let b = 0; b < N_PRICE_BINS; b++)
      bins[b] += grid[t * N_PRICE_BINS + b]
  const binToPrice = (b: number) => pMin + ((b + 0.5) / N_PRICE_BINS) * pRange
  const globalMax = Math.max(...Array.from(bins))
  if (globalMax <= 0) return []
  const threshold = globalMax * 0.06
  const zones: LiqZone[] = []
  for (let b = 1; b < N_PRICE_BINS - 1; b++) {
    const v = bins[b]
    if (v < threshold) continue
    if (!(v >= bins[b-1] && v >= bins[b+1])) continue
    const price = binToPrice(b)
    const strength = v / globalMax
    const side = price > currentPrice ? 'above' : 'below'
    zones.push({ price, strength, stars: '★'.repeat(Math.max(1, Math.min(5, Math.round(strength * 5)))), side,
      type: side === 'above' ? 'Liquidation Longs (Short Squeeze)' : 'Liquidation Shorts (Long Squeeze)' })
  }
  // Suppress duplicates within same 3-bin window — keep strongest
  const filtered: LiqZone[] = []
  zones.sort((a, b) => b.strength - a.strength).forEach(z => {
    const tooClose = filtered.some(f => Math.abs(f.price - z.price) / pRange < 0.015)
    if (!tooClose) filtered.push(z)
  })
  return filtered.slice(0, 20)
}

// ── Cascade chain builder ──────────────────────────────────────────────────────
function computeCascadeChain(zones: LiqZone[], currentPrice: number): CascadeNode[] {
  // above = short squeeze cascade (price rises, shorts liquidated, buy pressure pushes higher)
  const above = zones
    .filter(z => z.side === 'above')
    .sort((a, b) => a.price - b.price)     // nearest first

  // below = long squeeze cascade (price falls, longs liquidated, sell pressure pushes lower)
  const below = zones
    .filter(z => z.side === 'below')
    .sort((a, b) => b.price - a.price)     // nearest first

  const chain: CascadeNode[] = []
  above.slice(0, 4).forEach((z, i) => chain.push({
    price: z.price, strength: z.strength, side: 'above', order: i + 1,
    label: `T${i+1} Short Squeeze`,
  }))
  below.slice(0, 4).forEach((z, i) => chain.push({
    price: z.price, strength: z.strength, side: 'below', order: i + 1,
    label: `T${i+1} Long Squeeze`,
  }))
  return chain
}

// ── Draw cascade chain on canvas ───────────────────────────────────────────────
function drawCascadeChain(
  ctx: CanvasRenderingContext2D,
  chain: CascadeNode[],
  pMin: number, pMax: number,
  W: number, H: number, CHART_W: number,
) {
  const pRange = pMax - pMin
  const pToY = (p: number) => H - ((p - pMin) / pRange) * H

  const aboveNodes = chain.filter(n => n.side === 'above').sort((a, b) => a.price - b.price)
  const belowNodes = chain.filter(n => n.side === 'below').sort((a, b) => b.price - a.price)

  const drawNodes = (nodes: CascadeNode[], baseColor: string) => {
    nodes.forEach((node) => {
      const y = pToY(node.price)
      if (y < -10 || y > H + 10) return

      const alpha = node.order === 1 ? 0.85 : node.order === 2 ? 0.55 : 0.35
      const lineW = node.order === 1 ? 1.5 : 1

      // Thin full-width line only — no labels on chart
      ctx.strokeStyle = baseColor
      ctx.lineWidth = lineW
      ctx.globalAlpha = alpha
      ctx.setLineDash(node.order === 1 ? [10, 5] : [3, 6])
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(CHART_W, y)
      ctx.stroke()
      ctx.setLineDash([])

      // Tiny T# badge on left edge only
      const badgeSize = 14
      const badgeX = 4
      const badgeY = y - badgeSize / 2
      ctx.globalAlpha = alpha
      ctx.fillStyle = baseColor
      ctx.beginPath()
      ctx.roundRect(badgeX, badgeY, badgeSize, badgeSize, 3)
      ctx.fill()
      ctx.fillStyle = '#000'
      ctx.font = '800 9px JetBrains Mono,monospace'
      ctx.textAlign = 'center'
      ctx.fillText(`T${node.order}`, badgeX + badgeSize / 2, y + 3)
      ctx.textAlign = 'left'
      ctx.globalAlpha = 1
    })
  }

  // Short squeeze chain = orange (#FF9500), Long squeeze chain = cyan (#00C8FF)
  drawNodes(aboveNodes, '#FF9500')
  drawNodes(belowNodes, '#00C8FF')
}

// ── JSON prompt ────────────────────────────────────────────────────────────────
function buildStructuredPrompt(symbol: string, tf: string, klines: Kline[], zones: LiqZone[]): string {
  const last = klines[klines.length - 1]
  const prev = klines[klines.length - 2]
  const chg = ((last.close - prev.close) / prev.close * 100).toFixed(2)
  const above = zones.filter(z => z.side === 'above').sort((a, b) => a.price - b.price)
  const below = zones.filter(z => z.side === 'below').sort((a, b) => b.price - a.price)
  const fZ = (z: LiqZone) => `${fmtPrice(z.price)} ${z.stars} (${(z.strength*100).toFixed(0)}%) — ${z.type}`

  return `Tu es un analyste expert en liquidations et market structure crypto. Analyse ce liquidation heatmap pour prévoir les cascades de liquidation.

MARCHÉ: ${symbol} | TF: ${tf} | ${klines.length} bougies
Prix actuel: ${fmtPrice(last.close)} | Variation: ${chg}%
High: ${fmtPrice(Math.max(...klines.map(k=>k.high)))} | Low: ${fmtPrice(Math.min(...klines.map(k=>k.low)))}

CHAÎNE DE CASCADE — SHORT SQUEEZE (prix monte, shorts liquidés, buy pressure pousse plus haut):
${above.map((z, i) => `T${i+1}: ${fZ(z)}`).join(' | ') || 'aucune zone above'}

CHAÎNE DE CASCADE — LONG SQUEEZE (prix baisse, longs liquidés, sell pressure pousse plus bas):
${below.map((z, i) => `T${i+1}: ${fZ(z)}`).join(' | ') || 'aucune zone below'}

LOGIQUE CASCADE: quand une zone (T1) est atteinte, les liquidations forcées créent du momentum qui pousse vers T2, puis T2→T3.
Analyse: biais directionnel dominant, quelle cascade est la plus probable (SHORT ou LONG squeeze), distance au T1 most likely, force des zones.

Réponds UNIQUEMENT en JSON valide (aucun texte autour), structure exacte:
{
  "bias": "HAUSSIER",
  "biasReason": "justification courte (max 15 mots)",
  "strategy": "conseil actionnable concret (max 20 mots)",
  "annotations": [
    { "price": 82100, "type": "target", "label": "🎯 T1 Short Squeeze", "detail": "1er cluster — cascade probable", "color": "#FF9500" },
    { "price": 84500, "type": "target", "label": "🔥 T2 Extension", "detail": "Si T1 touché → flush ici", "color": "#FF6B35" },
    { "price": 79800, "type": "invalidation", "label": "⚠️ Invalidation", "detail": "Cassure = scenario baissier", "color": "#FF3B30" }
  ],
  "textSections": {
    "bias": "📊 BIAIS: ...",
    "target": "🎯 CASCADE PROBABLE: T1 à X → si touché T2 à Y",
    "zones": "🔥 ZONES CLÉS: force et distance des clusters",
    "invalidation": "⚠️ INVALIDATION: ...",
    "strategy": "💡 STRATÉGIE: ..."
  }
}
RÈGLES: max 5 annotations | prix = valeurs réelles des zones | bias ∈ HAUSSIER/BAISSIER/NEUTRE
types: target=#FF9500(short squeeze) target=#00C8FF(long squeeze) invalidation=#FF3B30 zone=#BF5AF2`
}

async function callGPTAnalysis(prompt: string): Promise<AnalysisResult> {
  const fn = httpsCallable<unknown, { choices: { message: { content: string } }[] }>(functions, 'openaiChat')
  const res = await fn({ model: 'gpt-4o', temperature: 0.2, responseFormat: 'json', messages: [{ role: 'user', content: prompt }] })
  const raw = res.data.choices[0]?.message?.content ?? '{}'
  const parsed = JSON.parse(raw) as AnalysisResult
  // Validate
  if (!parsed.annotations) parsed.annotations = []
  if (!parsed.textSections) parsed.textSections = { bias:'', target:'', zones:'', invalidation:'', strategy:'' }
  return parsed
}

// ── Draw annotations on canvas ─────────────────────────────────────────────────
function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: CanvasAnnotation[],
  bias: 'HAUSSIER' | 'BAISSIER' | 'NEUTRE',
  biasReason: string,
  pMin: number, pMax: number,
  W: number, H: number, CHART_W: number,
) {
  const pRange = pMax - pMin
  const pToY = (p: number) => H - ((p - pMin) / pRange) * H

  // Draw each annotation
  annotations.forEach((ann, idx) => {
    const y = pToY(ann.price)
    if (y < 0 || y > H) return

    // Band: semi-transparent horizontal zone ±0.3%
    const bandPx = (0.003 * H) / (pRange / pMax) // rough pixel height for 0.3%
    ctx.fillStyle = ann.color + '18'
    ctx.fillRect(0, y - bandPx, CHART_W, bandPx * 2)

    // Solid full-width line
    ctx.strokeStyle = ann.color
    ctx.lineWidth = 1.5
    ctx.setLineDash([6, 4])
    ctx.globalAlpha = 0.7
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(CHART_W, y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1

    // Tiny circular marker on left (offset per idx to avoid overlap)
    const dotX = 24 + idx * 4
    ctx.fillStyle = ann.color
    ctx.beginPath()
    ctx.arc(dotX, y, 4, 0, Math.PI * 2)
    ctx.fill()
  })

  // Compact bias chip top-left (no full reason text — moved to HTML panel)
  const biasColor = bias === 'HAUSSIER' ? '#34C759' : bias === 'BAISSIER' ? '#FF3B30' : '#FF9500'
  const biasIcon  = bias === 'HAUSSIER' ? '↑' : bias === 'BAISSIER' ? '↓' : '→'
  const chipW = 92, chipH = 22
  ctx.fillStyle = 'rgba(8,12,20,0.85)'
  ctx.beginPath()
  ctx.roundRect(8, 8, chipW, chipH, 6)
  ctx.fill()
  ctx.strokeStyle = biasColor
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(8, 8, chipW, chipH, 6)
  ctx.stroke()
  ctx.fillStyle = biasColor
  ctx.font = '800 11px JetBrains Mono,monospace'
  ctx.textAlign = 'left'
  ctx.fillText(`${biasIcon} ${bias}`, 14, 23)
  // Suppress unused param warning
  void biasReason
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
    // Recency weight: recent candles have more active OI (exponential ramp)
    const recencyWeight = 0.25 + 0.75 * Math.pow(i / (N - 1), 0.6)

    for (const { lev, weight } of LEVERAGE_TIERS) {
      const c = k.volume * weight * recencyWeight
      // Long liquidations: below entry price
      add(i, k.close * (1 - 1/lev + MAINT_MARGIN), c * LONG_FRAC)
      add(i, k.open  * (1 - 1/lev + MAINT_MARGIN), c * LONG_FRAC * 0.35)
      add(i, k.high  * (1 - 1/lev + MAINT_MARGIN), c * LONG_FRAC * 0.20)
      // Short liquidations: above entry price
      add(i, k.close * (1 + 1/lev - MAINT_MARGIN), c * (1 - LONG_FRAC))
      add(i, k.open  * (1 + 1/lev - MAINT_MARGIN), c * (1 - LONG_FRAC) * 0.35)
      add(i, k.low   * (1 + 1/lev - MAINT_MARGIN), c * (1 - LONG_FRAC) * 0.20)
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
  analysisResult?: AnalysisResult | null,
  chain?: CascadeNode[] | null,
  view?: { min: number; max: number } | null,
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
  const pRange = pMax - pMin
  const vMin = view?.min ?? pMin
  const vMax = view?.max ?? pMax
  const vRange = vMax - vMin
  const binPriceWidth = pRange / N_PRICE_BINS
  const cellH = (H * binPriceWidth) / vRange
  const pToY = (p: number) => H - ((p - vMin) / vRange) * H

  // Heatmap cells (skip bins outside viewport)
  const binMin = Math.max(0, Math.floor(((vMin - pMin) / pRange) * N_PRICE_BINS) - 1)
  const binMax = Math.min(N_PRICE_BINS - 1, Math.ceil(((vMax - pMin) / pRange) * N_PRICE_BINS) + 1)
  for (let t = 0; t < N; t++) {
    for (let b = binMin; b <= binMax; b++) {
      const val = grid[t * N_PRICE_BINS + b]
      if (val <= 0) continue
      const color = intensityToColor(Math.pow(val / maxVal, 0.45))
      if (color === 'transparent') continue
      const binPrice = pMin + ((b + 0.5) / N_PRICE_BINS) * pRange
      const y = pToY(binPrice)
      ctx.fillStyle = color
      ctx.fillRect(t * cellW, y - cellH / 2, cellW + 0.5, cellH + 0.6)
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

  // Price axis (use viewport range)
  ctx.fillStyle = '#080C14'; ctx.fillRect(CHART_W, 0, LABEL_W, H)
  const currentPrice = klines[klines.length - 1]?.close ?? 0
  for (let i = 0; i <= 8; i++) {
    const p = vMin + (vRange * i) / 8
    const y = pToY(p)
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CHART_W, y); ctx.stroke()
    ctx.fillStyle = 'rgba(143,148,163,0.5)'; ctx.font = '9px JetBrains Mono,monospace'
    ctx.textAlign = 'left'
    const lbl = p >= 10000 ? `$${(p/1000).toFixed(1)}k` : `$${p.toFixed(p<10?4:2)}`
    ctx.fillText(lbl, CHART_W + 4, y + 3)
  }
  // Current price dashed line + badge (only if in viewport)
  if (currentPrice >= vMin && currentPrice <= vMax) {
    const cy = pToY(currentPrice)
    ctx.strokeStyle = '#00E5FF'; ctx.lineWidth = 1; ctx.setLineDash([4,4])
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(CHART_W, cy); ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#00E5FF'
    ctx.fillRect(CHART_W + 2, cy - 8, LABEL_W - 4, 16)
    ctx.fillStyle = '#000'; ctx.font = '700 9px JetBrains Mono,monospace'; ctx.textAlign = 'center'
    ctx.fillText(currentPrice >= 10000 ? `$${currentPrice.toFixed(0)}` : `$${currentPrice.toFixed(2)}`, CHART_W + LABEL_W/2, cy + 3)
    ctx.textAlign = 'left'
  }

  // Cascade chain (use viewport range for pToY)
  if (chain?.length) {
    drawCascadeChain(ctx, chain, vMin, vMax, W, H, CHART_W)
  }

  // Annotations overlay (use viewport range)
  if (analysisResult?.annotations?.length) {
    drawAnnotations(ctx, analysisResult.annotations, analysisResult.bias, analysisResult.biasReason, vMin, vMax, W, H, CHART_W)
  }

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
  view?: { min: number; max: number } | null,
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
  const vMin = view?.min ?? pMin
  const vMax = view?.max ?? pMax
  const vRange = vMax - vMin
  const price = vMin + ((H - my) / H) * vRange
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
function buildDiscordEmbed(
  symbol: string, tf: string,
  chain: CascadeNode[] | null,
  currentPrice: number,
  analysis: AnalysisResult | null,
): Record<string, unknown> {
  const colorByBias: Record<string, number> = { HAUSSIER: 0x34C759, BAISSIER: 0xFF3B30, NEUTRE: 0xFF9500 }
  const color = analysis ? colorByBias[analysis.bias] ?? 0xBF5AF2 : 0x00C8FF

  const fields: { name: string; value: string; inline?: boolean }[] = []

  // Bias
  if (analysis) {
    const icon = analysis.bias === 'HAUSSIER' ? '↑' : analysis.bias === 'BAISSIER' ? '↓' : '→'
    fields.push({
      name: `${icon} Biais — ${analysis.bias}`,
      value: analysis.biasReason || '—',
      inline: false,
    })
  }

  // Cascade chains
  if (chain && chain.length > 0) {
    const fmtNode = (n: CascadeNode) => {
      const dist = currentPrice ? `${(((n.price - currentPrice) / currentPrice) * 100).toFixed(2)}%` : ''
      const stars = '●'.repeat(Math.max(1, Math.round(n.strength * 4)))
      return `**T${n.order}** ${fmtPrice(n.price)} \`${dist}\` ${stars}`
    }
    const above = chain.filter(n => n.side === 'above').sort((a, b) => a.order - b.order)
    const below = chain.filter(n => n.side === 'below').sort((a, b) => a.order - b.order)
    if (above.length) fields.push({ name: '↑ Short Squeeze (above)', value: above.map(fmtNode).join(' → '), inline: false })
    if (below.length) fields.push({ name: '↓ Long Squeeze (below)',  value: below.map(fmtNode).join(' → '), inline: false })
  }

  // Analysis text sections
  if (analysis?.textSections) {
    const ts = analysis.textSections
    if (ts.target)       fields.push({ name: '🎯 Cascade probable', value: ts.target.replace(/^[^:]+:\s*/, ''), inline: false })
    if (ts.zones)        fields.push({ name: '🔥 Zones clés',        value: ts.zones.replace(/^[^:]+:\s*/, ''), inline: false })
    if (ts.invalidation) fields.push({ name: '⚠️ Invalidation',       value: ts.invalidation.replace(/^[^:]+:\s*/, ''), inline: false })
    if (ts.strategy)     fields.push({ name: '💡 Stratégie',          value: ts.strategy.replace(/^[^:]+:\s*/, ''), inline: false })
  }

  // Truncate any field that exceeds Discord 1024 char limit
  for (const f of fields) if (f.value.length > 1020) f.value = f.value.slice(0, 1017) + '…'

  return {
    title: `🔥 Liquidation Heatmap — ${symbol} (${tf})`,
    description: currentPrice ? `Prix actuel: **${fmtPrice(currentPrice)}**` : undefined,
    color,
    fields,
    image: { url: `attachment://liq_heatmap_${symbol}_${tf}.png` },
    footer: { text: 'TradeMindSet · Estimation Binance' },
    timestamp: new Date().toISOString(),
  }
}

async function sendCanvasToDiscord(
  canvas: HTMLCanvasElement,
  symbol: string,
  tf: string,
  webhookUrl: string,
  chain: CascadeNode[] | null,
  currentPrice: number,
  analysis: AnalysisResult | null,
): Promise<void> {
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png', 0.95)
  )
  const fd = new FormData()
  fd.append('files[0]', blob, `liq_heatmap_${symbol}_${tf}.png`)
  fd.append('payload_json', JSON.stringify({
    embeds: [buildDiscordEmbed(symbol, tf, chain, currentPrice, analysis)],
  }))
  const r = await fetch(webhookUrl, { method: 'POST', body: fd })
  if (!r.ok && r.status !== 204) throw new Error(`Discord ${r.status}`)
}

// ── Local download (composite image: canvas + analysis sidebar) ────────────────
async function downloadComposite(
  canvas: HTMLCanvasElement,
  symbol: string, tf: string,
  chain: CascadeNode[] | null,
  currentPrice: number,
  analysis: AnalysisResult | null,
): Promise<void> {
  const W = canvas.clientWidth
  const H = canvas.clientHeight
  const dpr = window.devicePixelRatio || 1
  const sidebar = analysis || (chain && chain.length > 0) ? 360 : 0
  const out = document.createElement('canvas')
  out.width = (W + sidebar) * dpr
  out.height = H * dpr
  const ctx = out.getContext('2d')!
  ctx.scale(dpr, dpr)
  ctx.fillStyle = '#080C14'
  ctx.fillRect(0, 0, W + sidebar, H)
  // Copy main canvas
  ctx.drawImage(canvas, 0, 0, W, H)

  if (sidebar > 0) {
    let y = 16
    const x0 = W + 16
    ctx.fillStyle = '#0E1424'
    ctx.fillRect(W, 0, sidebar, H)

    // Header
    ctx.fillStyle = '#BF5AF2'
    ctx.font = '800 14px Syne,sans-serif'
    ctx.fillText(`🔥 ${symbol} · ${tf}`, x0, y); y += 18
    ctx.fillStyle = 'rgba(143,148,163,0.7)'
    ctx.font = '10px JetBrains Mono,monospace'
    ctx.fillText(`Prix: ${fmtPrice(currentPrice)}`, x0, y); y += 20

    // Bias
    if (analysis) {
      const biasColor = analysis.bias === 'HAUSSIER' ? '#34C759' : analysis.bias === 'BAISSIER' ? '#FF3B30' : '#FF9500'
      ctx.fillStyle = biasColor
      ctx.font = '800 13px Syne,sans-serif'
      ctx.fillText(`${analysis.bias === 'HAUSSIER' ? '↑' : analysis.bias === 'BAISSIER' ? '↓' : '→'} ${analysis.bias}`, x0, y); y += 16
      ctx.fillStyle = 'rgba(220,225,240,0.85)'
      ctx.font = '10px JetBrains Mono,monospace'
      y = wrapText(ctx, analysis.biasReason || '', x0, y, sidebar - 32, 14) + 12
    }

    // Cascade
    if (chain && chain.length > 0) {
      const drawSide = (label: string, color: string, nodes: CascadeNode[]) => {
        if (!nodes.length) return
        ctx.fillStyle = color
        ctx.font = '700 11px Syne,sans-serif'
        ctx.fillText(label, x0, y); y += 14
        ctx.font = '10px JetBrains Mono,monospace'
        nodes.forEach(n => {
          const dist = currentPrice ? `${(((n.price - currentPrice) / currentPrice) * 100).toFixed(2)}%` : ''
          const stars = '●'.repeat(Math.max(1, Math.round(n.strength * 4)))
          ctx.fillStyle = color
          ctx.fillText(`T${n.order}`, x0, y)
          ctx.fillStyle = 'rgba(220,225,240,0.9)'
          ctx.fillText(fmtPrice(n.price), x0 + 26, y)
          ctx.fillStyle = 'rgba(143,148,163,0.55)'
          ctx.fillText(`${dist} ${stars}`, x0 + 100, y)
          y += 13
        })
        y += 6
      }
      const above = chain.filter(n => n.side === 'above').sort((a, b) => a.order - b.order)
      const below = chain.filter(n => n.side === 'below').sort((a, b) => a.order - b.order)
      drawSide('↑ SHORT SQUEEZE', '#FF9500', above)
      drawSide('↓ LONG SQUEEZE',  '#00C8FF', below)
    }

    // Analysis sections
    if (analysis?.textSections) {
      const ts = analysis.textSections
      const sections: { label: string; text: string; color: string }[] = [
        { label: '🎯 CASCADE',       text: ts.target,       color: '#00E5FF' },
        { label: '🔥 ZONES',         text: ts.zones,        color: '#FF9500' },
        { label: '⚠️ INVALIDATION',  text: ts.invalidation, color: '#FF3B30' },
        { label: '💡 STRATÉGIE',     text: ts.strategy,     color: '#BF5AF2' },
      ]
      sections.forEach(s => {
        if (!s.text || y > H - 20) return
        ctx.fillStyle = s.color
        ctx.font = '700 10px Syne,sans-serif'
        ctx.fillText(s.label, x0, y); y += 12
        ctx.fillStyle = 'rgba(220,225,240,0.8)'
        ctx.font = '10px JetBrains Mono,monospace'
        const txt = s.text.replace(/^[^:]+:\s*/, '')
        y = wrapText(ctx, txt, x0, y, sidebar - 32, 13) + 8
      })
    }

    // Footer
    ctx.fillStyle = 'rgba(143,148,163,0.4)'
    ctx.font = '9px JetBrains Mono,monospace'
    ctx.fillText(new Date().toLocaleString('fr-FR'), x0, H - 10)
  }

  const url = out.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = url
  a.download = `liq_heatmap_${symbol}_${tf}_${Date.now()}.png`
  a.click()
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number): number {
  const words = text.split(' ')
  let line = ''
  let cy = y
  for (const w of words) {
    const test = line ? line + ' ' + w : w
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, cy)
      cy += lineH
      line = w
    } else {
      line = test
    }
  }
  if (line) { ctx.fillText(line, x, cy); cy += lineH }
  return cy
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function LiqHeatmapChart({ symbol }: { symbol: string }) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const wrapRef      = useRef<HTMLDivElement>(null)
  const dataRef      = useRef<{ klines: Kline[]; grid: Float32Array; pMin: number; pMax: number; maxVal: number; chain: CascadeNode[] } | null>(null)

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
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [analyzing,      setAnalyzing]      = useState(false)
  const [analysisErr,    setAnalysisErr]    = useState<string>('')
  const [showAnalysis,   setShowAnalysis]   = useState(false)
  const [chainState,     setChainState]     = useState<CascadeNode[]>([])
  const [currentPrice,   setCurrentPrice]   = useState(0)
  const [view,           setView]           = useState<{ min: number; max: number } | null>(null)

  const analysisRef = useRef<AnalysisResult | null>(null)
  const redraw = useCallback((ch?: { tIdx: number; priceY: number } | null) => {
    const c = canvasRef.current, d = dataRef.current
    if (!c || !d) return
    drawHeatmap(c, d.klines, d.grid, d.pMin, d.pMax, d.maxVal, showCandles, ch ?? crosshair, analysisRef.current, d.chain, view)
  }, [showCandles, crosshair, view])

  const fetchAndDraw = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const klines = await fetchKlines(symbol, tf, limit)
      const { grid, pMin, pMax, maxVal } = buildGrid(klines)
      const zones = extractLiqZones(grid, klines, pMin, pMax)
      const cur = klines[klines.length - 1]?.close ?? 0
      const chain = computeCascadeChain(zones, cur)
      dataRef.current = { klines, grid, pMin, pMax, maxVal, chain }
      setChainState(chain)
      setCurrentPrice(cur)
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
    const res = computeTooltip(e, canvas, d.klines, d.grid, d.pMin, d.pMax, d.maxVal, view)
    if (!res) { setTooltip(null); setCrosshair(null); return }
    setTooltip(res.tooltip)
    setCrosshair(res.crosshair)
    redraw(res.crosshair)
  }, [redraw, view])

  const handleMouseLeave = useCallback(() => {
    setTooltip(null); setCrosshair(null); redraw(null)
  }, [redraw])

  // Native wheel listener (passive:false so we can preventDefault)
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const handler = (e: WheelEvent) => {
      const d = dataRef.current; if (!d) return
      e.preventDefault()
      const rect = c.getBoundingClientRect()
      const my = e.clientY - rect.top
      const H = rect.height
      const v = view ?? { min: d.pMin, max: d.pMax }
      const cursorPrice = v.min + ((H - my) / H) * (v.max - v.min)
      const factor = e.deltaY > 0 ? 1.25 : 0.8
      const newRange = (v.max - v.min) * factor
      const fullRange = d.pMax - d.pMin
      if (newRange >= fullRange) { setView(null); return }
      if (newRange < fullRange * 0.015) return
      const ratio = (cursorPrice - v.min) / (v.max - v.min)
      let newMin = cursorPrice - ratio * newRange
      let newMax = newMin + newRange
      if (newMin < d.pMin) { newMin = d.pMin; newMax = newMin + newRange }
      if (newMax > d.pMax) { newMax = d.pMax; newMin = newMax - newRange }
      setView({ min: newMin, max: newMax })
    }
    c.addEventListener('wheel', handler, { passive: false })
    return () => c.removeEventListener('wheel', handler)
  }, [view])

  // Redraw on view change
  useEffect(() => { redraw() }, [view, redraw])

  // Reset view when data changes (new symbol/tf)
  useEffect(() => { setView(null) }, [symbol, tf])

  const handleSendDiscord = useCallback(async () => {
    const canvas = canvasRef.current
    const d = dataRef.current
    if (!canvas || !d) return
    setSending(true)
    try {
      const uid = getAuth().currentUser?.uid
      if (!uid) throw new Error('non connecté')
      const settings = await getNotifSettings(uid)
      if (!settings.discordWebhook) { setSendStatus('nowebhook'); setTimeout(() => setSendStatus('idle'), 3000); return }
      await sendCanvasToDiscord(canvas, symbol, tf, settings.discordWebhook, d.chain, currentPrice, analysisRef.current)
      setSendStatus('ok')
    } catch { setSendStatus('error') }
    finally { setSending(false); setTimeout(() => setSendStatus('idle'), 3000) }
  }, [symbol, tf, currentPrice])

  const handleDownload = useCallback(async () => {
    const canvas = canvasRef.current
    const d = dataRef.current
    if (!canvas || !d) return
    try {
      await downloadComposite(canvas, symbol, tf, d.chain, currentPrice, analysisRef.current)
    } catch (e) { console.error(e) }
  }, [symbol, tf, currentPrice])

  const handleAnalyze = useCallback(async () => {
    const d = dataRef.current
    if (!d) return
    setAnalyzing(true)
    setAnalysisErr('')
    setShowAnalysis(true)
    try {
      const zones = extractLiqZones(d.grid, d.klines, d.pMin, d.pMax)
      const prompt = buildStructuredPrompt(symbol, tf, d.klines, zones)
      const result = await callGPTAnalysis(prompt)
      analysisRef.current = result
      setAnalysisResult(result)
      redraw()
    } catch (e) {
      setAnalysisErr((e as Error).message)
    } finally {
      setAnalyzing(false)
    }
  }, [symbol, tf, redraw])

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
        {view && (
          <button style={{ ...btn(false), color:'#FF9500', borderColor:'rgba(255,149,0,0.4)', background:'rgba(255,149,0,0.1)' }} onClick={() => setView(null)}>🔍 Reset zoom</button>
        )}
        <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
          {/* AI Analyse */}
          <button
            style={{ ...btn(showAnalysis), color: analyzing ? '#FF9500' : showAnalysis ? '#BF5AF2' : '#BF5AF2', borderColor: showAnalysis ? 'rgba(191,90,242,0.5)' : 'rgba(191,90,242,0.25)', background: showAnalysis ? 'rgba(191,90,242,0.12)' : 'rgba(191,90,242,0.05)' }}
            onClick={handleAnalyze}
            disabled={analyzing || !lastUpdate}
            title="Analyse GPT-4o des zones de liquidation"
          >{analyzing ? '⟳ Analyse…' : '🤖 Analyser'}</button>

          {/* Local download */}
          <button
            style={{ ...btn(false), color:'#0A85FF', borderColor:'rgba(10,133,255,0.4)', background:'rgba(10,133,255,0.08)' }}
            onClick={handleDownload}
            title="Télécharger image PNG avec analyse IA + cascade"
          >💾 PNG</button>

          {/* Discord send */}
          <button
            style={{ ...btn(false), color: sendColor, borderColor:`${sendColor}50`, background:`${sendColor}12` }}
            onClick={handleSendDiscord}
            disabled={sending}
            title="Envoyer image + analyse IA + cascade au webhook Discord"
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

      {/* Cascade Summary Panel */}
      {chainState.length > 0 && (() => {
        const aboveChain = chainState.filter(n => n.side === 'above').sort((a, b) => a.order - b.order)
        const belowChain = chainState.filter(n => n.side === 'below').sort((a, b) => a.order - b.order)
        const renderChain = (nodes: CascadeNode[], color: string, arrow: string, label: string) => (
          <div style={{ flex:1, display:'flex', alignItems:'center', gap:6, padding:'6px 10px', background:`${color}0D`, border:`1px solid ${color}30`, borderRadius:8, minWidth:0 }}>
            <span style={{ fontSize:10, fontWeight:800, color, fontFamily:'Syne,sans-serif', flexShrink:0 }}>{arrow} {label}</span>
            <div style={{ display:'flex', gap:4, alignItems:'center', overflow:'hidden', flex:1 }}>
              {nodes.length === 0 ? (
                <span style={{ fontSize:10, color:'rgba(143,148,163,0.4)', fontFamily:'JetBrains Mono,monospace' }}>aucun cluster</span>
              ) : nodes.map((n, i) => {
                const dist = Math.abs(((n.price - currentPrice) / currentPrice) * 100).toFixed(2)
                return (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:3, flexShrink:0 }}>
                    {i > 0 && <span style={{ fontSize:9, color:`${color}80` }}>→</span>}
                    <div style={{ display:'flex', alignItems:'center', gap:3, padding:'3px 6px', background:n.order === 1 ? `${color}25` : 'rgba(255,255,255,0.03)', border:`1px solid ${n.order === 1 ? color + '70' : color + '20'}`, borderRadius:5 }}>
                      <span style={{ fontSize:9, fontWeight:800, color, fontFamily:'JetBrains Mono,monospace' }}>T{n.order}</span>
                      <span style={{ fontSize:10, fontWeight:700, color:'rgba(220,225,240,0.9)', fontFamily:'JetBrains Mono,monospace' }}>{fmtPrice(n.price)}</span>
                      <span style={{ fontSize:8, color:'rgba(143,148,163,0.5)', fontFamily:'JetBrains Mono,monospace' }}>{dist}%</span>
                      <span style={{ fontSize:8, color:`${color}AA` }}>{'●'.repeat(Math.max(1, Math.round(n.strength * 4)))}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
        return (
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {renderChain(aboveChain, '#FF9500', '↑', 'SHORT SQUEEZE')}
            {renderChain(belowChain, '#00C8FF', '↓', 'LONG SQUEEZE')}
          </div>
        )
      })()}

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

          {/* Analysis sections */}
          {analysisResult && !analyzing && (() => {
            const ts = analysisResult.textSections
            const biasColor = analysisResult.bias === 'HAUSSIER' ? '#34C759' : analysisResult.bias === 'BAISSIER' ? '#FF3B30' : '#FF9500'
            return (
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {/* Bias badge */}
                <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background:`${biasColor}12`, border:`1px solid ${biasColor}40`, borderRadius:10 }}>
                  <span style={{ fontSize:20 }}>{analysisResult.bias === 'HAUSSIER' ? '↑' : analysisResult.bias === 'BAISSIER' ? '↓' : '→'}</span>
                  <div>
                    <div style={{ fontSize:13, fontWeight:800, color:biasColor, fontFamily:'Syne,sans-serif' }}>{analysisResult.bias}</div>
                    <div style={{ fontSize:11, color:'rgba(200,205,220,0.7)' }}>{analysisResult.biasReason}</div>
                  </div>
                </div>
                {/* Annotation list */}
                {analysisResult.annotations.length > 0 && (
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {analysisResult.annotations.map((ann, i) => (
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 12px', background:'rgba(255,255,255,0.03)', border:`1px solid ${ann.color}30`, borderRadius:8, borderLeft:`3px solid ${ann.color}` }}>
                        <span style={{ fontSize:11, fontWeight:700, color:ann.color, minWidth:90, fontFamily:'JetBrains Mono,monospace' }}>{fmtPrice(ann.price)}</span>
                        <span style={{ fontSize:11, fontWeight:700, color:ann.color }}>{ann.label}</span>
                        <span style={{ fontSize:10, color:'rgba(200,205,220,0.6)', marginLeft:'auto' }}>{ann.detail}</span>
                      </div>
                    ))}
                  </div>
                )}
                {/* Text sections */}
                {[
                  { key:'target', text:ts.target, color:'#00E5FF' },
                  { key:'zones', text:ts.zones, color:'#FF9500' },
                  { key:'invalidation', text:ts.invalidation, color:'#FF3B30' },
                  { key:'strategy', text:ts.strategy, color:'#BF5AF2' },
                ].map(({ key, text, color }) => text ? (
                  <div key={key} style={{ fontSize:12, color:'rgba(220,225,240,0.85)', lineHeight:1.7, paddingLeft:10, borderLeft:`2px solid ${color}60` }}>
                    <span style={{ fontWeight:700, color }}>{text.split(':')[0]}: </span>
                    {text.split(':').slice(1).join(':').trim()}
                  </div>
                ) : null)}
              </div>
            )
          })()}

          {/* Re-analyze */}
          {analysisResult && !analyzing && (
            <div style={{ marginTop:14, paddingTop:12, borderTop:'1px solid rgba(255,255,255,0.05)', display:'flex', gap:10 }}>
              <button onClick={handleAnalyze} style={{ padding:'6px 14px', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer', border:'1px solid rgba(191,90,242,0.3)', background:'rgba(191,90,242,0.08)', color:'#BF5AF2' }}>↻ Actualiser</button>
              <span style={{ fontSize:10, color:'rgba(143,148,163,0.4)', fontFamily:'JetBrains Mono,monospace', alignSelf:'center' }}>annotations visibles sur le chart</span>
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
