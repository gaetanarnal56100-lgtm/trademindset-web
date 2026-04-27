// OUChannelIndicator.tsx — v1
// Canal Adaptatif Ornstein-Uhlenbeck + Détecteur d'Excès Statistiques
// VMC enrichi avec Efficiency Ratio de Kaufman (ER)
// Inspiré des indicateurs OU Trend Channel Pro et MRE-VWAP

import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchCandles } from './OscillatorCharts'
import type { } from './OscillatorCharts'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Candle { o: number; h: number; l: number; c: number; v: number; t: number }

interface OUResult {
  mean:        number[]   // mean-reversion level (mu)
  upper1:      number[]   // +1σ band
  upper2:      number[]   // +2σ band (excess zone)
  lower1:      number[]   // -1σ band
  lower2:      number[]   // -2σ band (excess zone)
  zscore:      number[]   // standardized position
  kappa:       number[]   // mean-reversion speed (regime-local)
  sigma:       number[]   // local vol
  excess:      ('none' | 'overbought' | 'oversold' | 'extreme_ob' | 'extreme_os')[]
  regime:      ('trending' | 'ranging' | 'breakout')[]
}

interface KaufmanERResult {
  er:          number[]   // Efficiency Ratio 0-1 (1=trending, 0=noisy)
  fastAlpha:   number     // current dynamic alpha
  erSmoothed:  number[]   // EMA of ER for regime filter
}

interface VMCEnhancedResult {
  sig:         number[]
  sigSignal:   number[]
  momentum:    number[]
  er:          number[]
  erSmoothed:  number[]
  status:      string
  statusColor: string
  excessLevel: number
  erQuality:   'strong' | 'moderate' | 'weak'
  erColor:     string
  confluence:  number    // -1 to +1
  trendBias:   'bullish' | 'bearish' | 'neutral'
}

// ─── Math helpers ─────────────────────────────────────────────────────────────
function emaArr(vals: number[], length: number): number[] {
  if (!vals.length || length <= 0) return vals.map(() => 0)
  const k = 2 / (length + 1)
  const out = [vals[0]]
  for (let i = 1; i < vals.length; i++) out.push(vals[i] * k + out[i-1] * (1-k))
  return out
}

function rollingStd(arr: number[], len: number): number[] {
  const out = new Array(arr.length).fill(0)
  for (let i = len - 1; i < arr.length; i++) {
    const slice = arr.slice(i - len + 1, i + 1)
    const mean = slice.reduce((a, b) => a + b, 0) / len
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / len
    out[i] = Math.sqrt(variance)
  }
  return out
}


// ─── Ornstein-Uhlenbeck Channel ───────────────────────────────────────────────
// Process: dX = κ(μ - X)dt + σdW
// Approche correcte : on travaille directement en prix (résidus = close - EMA)
// σ_OU = std(résidus) sur fenêtre glissante — bandes naturellement calibrées
// κ = -ln(autocorr AR(1) des résidus) — vitesse de retour à la moyenne
export function calcOUChannel(candles: Candle[], lookback = 50, sigmaWindow = 30): OUResult {
  const n = candles.length
  const empty: OUResult = {
    mean: [], upper1: [], upper2: [], lower1: [], lower2: [],
    zscore: [], kappa: [], sigma: [], excess: [], regime: [],
  }
  if (n < lookback + 10) return empty

  const close = candles.map(c => c.c)

  // μ : EMA(lookback) = niveau d'équilibre OU
  const mean = emaArr(close, lookback)

  // Résidus = close - μ (processus centré autour de 0)
  const residuals = close.map((c, i) => c - mean[i])

  // σ_OU = std rolling des résidus sur sigmaWindow barres (en unités de prix)
  const sigmaArr = rollingStd(residuals, sigmaWindow)

  // κ = -ln(ρ₁) où ρ₁ = autocorrélation lag-1 des résidus (fenêtre glissante)
  const kappaArr = new Array(n).fill(0.3)
  const kappaWin = Math.max(sigmaWindow, 20)
  for (let i = kappaWin; i < n; i++) {
    const res = residuals.slice(i - kappaWin, i)
    const mu_res = res.reduce((a, b) => a + b, 0) / kappaWin
    const centered = res.map(v => v - mu_res)
    let num = 0, den = 0
    for (let j = 1; j < centered.length; j++) {
      num += centered[j-1] * centered[j]
      den += centered[j-1] ** 2
    }
    const rho = den > 0 ? Math.max(0.001, Math.min(0.999, num / den)) : 0.5
    // κ > 1 → retour rapide (range), κ < 0.3 → retour lent (tendance)
    kappaArr[i] = -Math.log(rho)
  }

  // Bandes adaptatives : μ ± n × σ_OU × facteur(κ)
  // Le facteur(κ) module les bandes selon le régime :
  //   κ élevé (range) → bandes normales, κ faible (trend) → bandes légèrement élargies
  const upper1: number[] = [], upper2: number[] = []
  const lower1: number[] = [], lower2: number[] = []
  const zscore: number[] = []
  const excess: OUResult['excess'] = []
  const regime: OUResult['regime'] = []

  for (let i = 0; i < n; i++) {
    const mu = mean[i]
    const price = close[i]
    const kappa = kappaArr[i]

    // std des résidus — jamais inférieure à 0.3% du prix pour éviter les bandes nulles
    const rawSigma = sigmaArr[i] > 0 ? sigmaArr[i] : mu * 0.003
    const sigma = Math.max(rawSigma, mu * 0.003)

    // Facteur adaptatif : en range (κ élevé) les bandes restent normales,
    // en tendance (κ faible) on les élargit légèrement pour éviter les faux signaux
    const kappaFactor = kappa > 0 ? Math.min(1.5, Math.max(0.7, 1 / Math.sqrt(kappa))) : 1.0
    const adaptedSigma = sigma * kappaFactor

    upper1.push(mu + 1.0 * adaptedSigma)
    upper2.push(mu + 2.0 * adaptedSigma)
    lower1.push(mu - 1.0 * adaptedSigma)
    lower2.push(mu - 2.0 * adaptedSigma)

    // Z-score = (prix - μ) / σ_OU — normalisé dans l'espace OU
    const z = adaptedSigma > 0 ? (price - mu) / adaptedSigma : 0
    zscore.push(z)

    // Détection d'excès statistiques
    if (z > 2.5)       excess.push('extreme_ob')
    else if (z > 1.5)  excess.push('overbought')
    else if (z < -2.5) excess.push('extreme_os')
    else if (z < -1.5) excess.push('oversold')
    else               excess.push('none')

    // Régime : κ → vitesse de retour
    // κ > 1.0 = range fort (retour rapide)
    // κ < 0.25 = tendance forte (retour lent)
    // entre les deux + z extrême = breakout potentiel
    if (kappa > 1.0)             regime.push('ranging')
    else if (kappa < 0.25)       regime.push('trending')
    else if (Math.abs(z) > 1.8)  regime.push('breakout')
    else                          regime.push('ranging')
  }

  return {
    mean, upper1, upper2, lower1, lower2,
    zscore, kappa: kappaArr, sigma: sigmaArr, excess, regime,
  }
}

// ─── Kaufman Efficiency Ratio ─────────────────────────────────────────────────
// ER = |net price change| / sum(abs(period-over-period changes))
// ER → 1 = strong trend (price goes one direction)
// ER → 0 = choppy/noise
export function calcKaufmanER(candles: Candle[], period = 14, erSmoothing = 10): KaufmanERResult {
  const close = candles.map(c => c.c)
  const n = close.length
  const er = new Array(n).fill(0)

  for (let i = period; i < n; i++) {
    const direction = Math.abs(close[i] - close[i - period])
    let volatility = 0
    for (let j = i - period + 1; j <= i; j++) {
      volatility += Math.abs(close[j] - close[j-1])
    }
    er[i] = volatility > 0 ? direction / volatility : 0
  }

  const erSmoothed = emaArr(er, erSmoothing)
  const fastAlpha = erSmoothed[n-1] ?? 0.5

  return { er, erSmoothed, fastAlpha }
}

// ─── Enhanced VMC with Kaufman ER ────────────────────────────────────────────
function rollingSum(arr: number[], length: number): number[] {
  const out = new Array(arr.length).fill(0)
  let s = 0
  for (let i = 0; i < arr.length; i++) {
    s += arr[i]
    if (i >= length) s -= arr[i-length]
    out[i] = s
  }
  return out
}

export function calcVMCEnhanced(candles: Candle[], erPeriod = 14): VMCEnhancedResult {
  const EMPTY: VMCEnhancedResult = {
    sig: [], sigSignal: [], momentum: [], er: [], erSmoothed: [],
    status: 'NEUTRAL', statusColor: '#8E8E93', excessLevel: 0,
    erQuality: 'weak', erColor: '#8E8E93', confluence: 0, trendBias: 'neutral',
  }
  if (candles.length < 60) return EMPTY

  const close = candles.map(c => c.c)
  const vol   = candles.map(c => c.v)
  const hlc3  = candles.map(c => (c.h + c.l + c.c) / 3)
  const n     = candles.length

  // RSI(14)
  const rsiLen = 14
  const gains  = hlc3.map((v, i) => i === 0 ? 0 : Math.max(v - hlc3[i-1], 0))
  const losses = hlc3.map((v, i) => i === 0 ? 0 : Math.max(hlc3[i-1] - v, 0))
  const agArr  = emaArr(gains, rsiLen)
  const alArr  = emaArr(losses, rsiLen)
  const rsi    = agArr.map((g, i) => alArr[i] === 0 ? 100 : 100 - 100 / (1 + g / alArr[i]))

  // MFI(7)
  const tp = hlc3
  const pmf = new Array(n).fill(0), nmf = new Array(n).fill(0)
  for (let i = 1; i < n; i++) {
    const raw = tp[i] * vol[i]
    if (tp[i] > tp[i-1]) pmf[i] = raw
    else if (tp[i] < tp[i-1]) nmf[i] = raw
  }
  const sPMF = rollingSum(pmf, 7), sNMF = rollingSum(nmf, 7)
  const mfi  = sPMF.map((p, i) => {
    const d = p + sNMF[i]
    return d === 0 ? 50 : (p / d) * 100
  })

  // Stochastic RSI
  const computeStoch = (src: number[], len: number) => {
    const out = src.map((v, i) => {
      const win = src.slice(Math.max(0, i - len + 1), i + 1)
      const mn = Math.min(...win), mx = Math.max(...win)
      return mx - mn === 0 ? 50 : ((v - mn) / (mx - mn)) * 100
    })
    return emaArr(out, 2)
  }
  const stoch = computeStoch(rsi, rsiLen)

  // Core VMC
  const mfiW = 0.40, stochW = 0.40, denom = 1 + mfiW + stochW
  const core = rsi.map((r, i) => (r + mfiW * mfi[i] + stochW * stoch[i]) / denom)
  const transform = (arr: number[]) => arr.map(v => {
    const tmp = (v / 100 - 0.5) * 2
    return 100 * (tmp >= 0 ? 1 : -1) * Math.pow(Math.abs(tmp), 0.75)
  })
  const sig       = transform(emaArr(core, 10))
  const sigSignal = transform(emaArr(core, 18))
  const momentum  = sig.map((s, i) => s - sigSignal[i])

  // Kaufman ER
  const { er, erSmoothed } = calcKaufmanER(candles, erPeriod, 10)

  const last      = n - 1
  const sigLast   = sig[last] ?? 0
  const momLast   = momentum[last] ?? 0
  const erLast    = erSmoothed[last] ?? 0.5

  // ER quality classification
  let erQuality: VMCEnhancedResult['erQuality']
  let erColor: string
  if (erLast > 0.65) { erQuality = 'strong';   erColor = '#34C759' }
  else if (erLast > 0.40) { erQuality = 'moderate'; erColor = '#FF9500' }
  else { erQuality = 'weak'; erColor = '#FF453A' }

  // ER-weighted trend bias
  // High ER = trend is real → amplify VMC signal
  // Low ER = noise → dampened signal, range mode
  const erWeight = erLast
  const biasScore = sigLast * erWeight + momLast * 0.5

  let trendBias: VMCEnhancedResult['trendBias']
  if (biasScore > 5) trendBias = 'bullish'
  else if (biasScore < -5) trendBias = 'bearish'
  else trendBias = 'neutral'

  // Status with ER integration
  let status = 'NEUTRAL'
  let statusColor = '#8E8E93'

  if (erQuality === 'weak') {
    // Low ER: range mode signals
    if (sigLast < -40) { status = 'ZONE ACHAT (Consolidation)'; statusColor = '#42A5F5' }
    else if (sigLast > 40) { status = 'ZONE VENTE (Consolidation)'; statusColor = '#FF9500' }
    else { status = 'RANGE · ER Faible'; statusColor = '#8E8E93' }
  } else if (erQuality === 'strong') {
    // High ER: trend confirmed signals
    if (trendBias === 'bullish') { status = 'TENDANCE HAUSSIÈRE ✓'; statusColor = '#34C759' }
    else if (trendBias === 'bearish') { status = 'TENDANCE BAISSIÈRE ✓'; statusColor = '#FF3B30' }
    else { status = 'TENDANCE NEUTRE'; statusColor = '#FF9500' }
  } else {
    // Moderate ER: standard signals
    if (sigLast < -40) { status = 'SURVENTE'; statusColor = '#34C759' }
    else if (sigLast > 40) { status = 'SURACHAT'; statusColor = '#FF3B30' }
    else if (trendBias === 'bullish') { status = 'BIAIS HAUSSIER'; statusColor = '#66BB6A' }
    else if (trendBias === 'bearish') { status = 'BIAIS BAISSIER'; statusColor = '#EF5350' }
    else { status = 'NEUTRE'; statusColor = '#8E8E93' }
  }

  // Confluence score -1 to +1
  const confluence = Math.max(-1, Math.min(1, biasScore / 50))
  const excessLevel = Math.abs(sigLast)

  return {
    sig, sigSignal, momentum, er, erSmoothed,
    status, statusColor, excessLevel,
    erQuality, erColor, confluence, trendBias,
  }
}

// ─── Canvas renderer helpers ──────────────────────────────────────────────────
function resolveCSSColor(v: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || fallback
}

// ─── OU Channel Chart ─────────────────────────────────────────────────────────
interface OUChannelChartProps {
  candles:   Candle[]
  ou:        OUResult
  height?:   number
}
function OUChannelChart({ candles, ou, height = 200 }: OUChannelChartProps) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || candles.length < 20 || ou.mean.length < 20) return

    const dpr = window.devicePixelRatio || 1
    const W   = canvas.offsetWidth || 800
    const H   = height
    canvas.width  = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    const profit = resolveCSSColor('--tm-profit', '#22C759')
    const loss   = resolveCSSColor('--tm-loss',   '#FF3B30')

    // Y range: price range
    const prices = candles.map(c => c.c)
    const allBands = [...ou.upper2.filter(Boolean), ...ou.lower2.filter(Boolean)]
    const yMin = Math.min(...prices, ...allBands) * 0.997
    const yMax = Math.max(...prices, ...allBands) * 1.003
    const yRange = yMax - yMin || 1

    const toY = (v: number) => H - ((v - yMin) / yRange) * H
    const toX = (i: number) => (i / (candles.length - 1)) * W

    // Background
    ctx.fillStyle = '#080C14'
    ctx.fillRect(0, 0, W, H)

    // OU excess zones (fill between ±2σ and ±1σ)
    // Upper excess zone (overbought): between upper1 and upper2
    ctx.beginPath()
    ou.upper1.forEach((v, i) => {
      const x = toX(i), y = toY(v)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    for (let i = ou.upper2.length - 1; i >= 0; i--) {
      ctx.lineTo(toX(i), toY(ou.upper2[i]))
    }
    ctx.closePath()
    ctx.fillStyle = 'rgba(255,59,48,0.10)'
    ctx.fill()

    // Lower excess zone (oversold): between lower2 and lower1
    ctx.beginPath()
    ou.lower1.forEach((v, i) => {
      const x = toX(i), y = toY(v)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    for (let i = ou.lower2.length - 1; i >= 0; i--) {
      ctx.lineTo(toX(i), toY(ou.lower2[i]))
    }
    ctx.closePath()
    ctx.fillStyle = 'rgba(52,199,89,0.10)'
    ctx.fill()

    // OU ±1σ band fill (normal zone)
    ctx.beginPath()
    ou.upper1.forEach((v, i) => {
      const x = toX(i), y = toY(v)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    for (let i = ou.lower1.length - 1; i >= 0; i--) {
      ctx.lineTo(toX(i), toY(ou.lower1[i]))
    }
    ctx.closePath()
    ctx.fillStyle = 'rgba(0,229,255,0.04)'
    ctx.fill()

    // Draw bands
    const drawLine = (pts: number[], color: string, lw = 1, dash?: number[]) => {
      ctx.beginPath()
      if (dash) ctx.setLineDash(dash)
      else ctx.setLineDash([])
      pts.forEach((v, i) => {
        if (!v) return
        const x = toX(i), y = toY(v)
        i === 0 || !pts[i-1] ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      })
      ctx.strokeStyle = color
      ctx.lineWidth = lw
      ctx.stroke()
      ctx.setLineDash([])
    }

    drawLine(ou.upper2, 'rgba(255,59,48,0.6)',  1, [4, 3])
    drawLine(ou.upper1, 'rgba(255,149,0,0.5)',  1, [3, 3])
    drawLine(ou.mean,   'rgba(0,229,255,0.7)',   1.5)
    drawLine(ou.lower1, 'rgba(52,199,89,0.5)',   1, [3, 3])
    drawLine(ou.lower2, 'rgba(0,200,100,0.6)',   1, [4, 3])

    // Price line — colored by zone
    for (let i = 1; i < candles.length; i++) {
      const excess = ou.excess[i]
      let color = 'rgba(255,255,255,0.7)'
      if (excess === 'extreme_ob' || excess === 'overbought') color = loss
      else if (excess === 'extreme_os' || excess === 'oversold') color = profit

      ctx.beginPath()
      ctx.moveTo(toX(i-1), toY(candles[i-1].c))
      ctx.lineTo(toX(i),   toY(candles[i].c))
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    // Regime markers — dots at bottom
    const regimeY = H - 6
    ou.regime.forEach((r, i) => {
      if (i % 5 !== 0) return
      const x = toX(i)
      ctx.beginPath()
      ctx.arc(x, regimeY, 2, 0, Math.PI * 2)
      if (r === 'trending')  ctx.fillStyle = 'rgba(255,149,0,0.6)'
      else if (r === 'ranging')  ctx.fillStyle = 'rgba(0,229,255,0.4)'
      else ctx.fillStyle = 'rgba(191,90,242,0.7)' // breakout
      ctx.fill()
    })

    // Excess event markers
    ou.excess.forEach((e, i) => {
      if (e === 'none') return
      const x = toX(i)
      const y = toY(candles[i].c)
      const isOB = e.includes('ob')
      ctx.beginPath()
      ctx.arc(x, y, e.includes('extreme') ? 4 : 3, 0, Math.PI * 2)
      ctx.fillStyle = isOB ? loss : profit
      ctx.fill()
      ctx.strokeStyle = '#080C14'
      ctx.lineWidth = 1
      ctx.stroke()
    })

  }, [candles, ou, height])

  if (candles.length < 20) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tm-text-muted)', fontSize: 12, background: '#080C14', borderRadius: 8 }}>
        Données insuffisantes…
      </div>
    )
  }

  return (
    <canvas ref={ref} style={{ width: '100%', height, borderRadius: 8, display: 'block' }} />
  )
}

// ─── Z-Score Oscillator Chart ─────────────────────────────────────────────────
function ZScoreChart({ zscore, excess, height = 100 }: { zscore: number[]; excess: OUResult['excess']; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || zscore.length < 10) return

    const dpr = window.devicePixelRatio || 1
    const W   = canvas.offsetWidth || 800
    const H   = height
    canvas.width  = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    ctx.fillStyle = '#080C14'
    ctx.fillRect(0, 0, W, H)

    const yMin = -4, yMax = 4, yRange = yMax - yMin
    const toY = (v: number) => H - ((v - yMin) / yRange) * H
    const toX = (i: number) => (i / (zscore.length - 1)) * W

    // Reference lines
    const lines: [number, string][] = [
      [2.5, 'rgba(255,59,48,0.4)'],
      [1.5, 'rgba(255,149,0,0.3)'],
      [0,   'rgba(255,255,255,0.15)'],
      [-1.5, 'rgba(52,199,89,0.3)'],
      [-2.5, 'rgba(52,199,89,0.5)'],
    ]
    lines.forEach(([v, color]) => {
      ctx.beginPath()
      ctx.moveTo(0, toY(v))
      ctx.lineTo(W, toY(v))
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.stroke()
    })
    ctx.setLineDash([])

    // Fill between ±1.5 (normal zone)
    ctx.beginPath()
    ctx.rect(0, toY(1.5), W, toY(-1.5) - toY(1.5))
    ctx.fillStyle = 'rgba(0,229,255,0.03)'
    ctx.fill()

    // Z-score bars
    for (let i = 1; i < zscore.length; i++) {
      const z     = zscore[i]
      const x     = toX(i)
      const zY    = toY(z)
      const midY  = toY(0)
      const exc   = excess[i]

      let color = 'rgba(0,229,255,0.6)'
      if (exc === 'extreme_ob') color = 'rgba(255,59,48,0.85)'
      else if (exc === 'overbought') color = 'rgba(255,149,0,0.7)'
      else if (exc === 'extreme_os') color = 'rgba(52,199,89,0.85)'
      else if (exc === 'oversold')   color = 'rgba(42,160,80,0.7)'

      ctx.fillStyle = color
      ctx.fillRect(x - 1, Math.min(zY, midY), 2, Math.abs(zY - midY))
    }

    // Z-score line
    ctx.beginPath()
    zscore.forEach((v, i) => {
      const x = toX(i), y = toY(v)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.strokeStyle = 'rgba(0,229,255,0.5)'
    ctx.lineWidth = 1
    ctx.stroke()

  }, [zscore, excess, height])

  return <canvas ref={ref} style={{ width: '100%', height, borderRadius: 8, display: 'block' }} />
}

// ─── VMC+ER Chart ─────────────────────────────────────────────────────────────
function VMCEnhancedChart({ vmc, height = 130 }: { vmc: VMCEnhancedResult; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || vmc.sig.length < 10) return

    const dpr = window.devicePixelRatio || 1
    const W   = canvas.offsetWidth || 800
    const H   = height
    canvas.width  = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    ctx.fillStyle = '#080C14'
    ctx.fillRect(0, 0, W, H)

    const n = vmc.sig.length
    const yMin = -80, yMax = 80, yRange = yMax - yMin
    const toY  = (v: number) => H * 0.85 - ((v - yMin) / yRange) * (H * 0.85)
    const toX  = (i: number) => (i / (n - 1)) * W

    // ER panel (bottom 15%)
    const erPanelTop = H * 0.88
    const erPanelH   = H * 0.10
    const toYER = (v: number) => erPanelTop + erPanelH - v * erPanelH

    // Reference lines
    ctx.setLineDash([3, 3])
    ;[40, 0, -40].forEach(v => {
      ctx.beginPath()
      ctx.moveTo(0, toY(v))
      ctx.lineTo(W, toY(v))
      ctx.strokeStyle = v === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)'
      ctx.lineWidth = 1
      ctx.stroke()
    })
    ctx.setLineDash([])

    // Overbought/oversold zones
    ctx.fillStyle = 'rgba(255,59,48,0.06)'
    ctx.fillRect(0, 0, W, toY(40))
    ctx.fillStyle = 'rgba(52,199,89,0.06)'
    ctx.fillRect(0, toY(-40), W, H - toY(-40))

    // Momentum bars colored by ER quality
    for (let i = 1; i < n; i++) {
      const mom = vmc.momentum[i]
      const er  = vmc.erSmoothed[i] ?? 0.5
      const x   = toX(i)
      const zeroY = toY(0)
      const momY  = toY(mom)

      let alpha = 0.3 + er * 0.5
      const isPos = mom >= 0
      const color = isPos
        ? `rgba(52,199,89,${alpha.toFixed(2)})`
        : `rgba(255,59,48,${alpha.toFixed(2)})`

      ctx.fillStyle = color
      ctx.fillRect(x - 1.5, Math.min(momY, zeroY), 3, Math.abs(momY - zeroY))
    }

    // Signal line
    ctx.beginPath()
    vmc.sigSignal.forEach((v, i) => {
      const x = toX(i), y = toY(v)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.strokeStyle = 'rgba(255,149,0,0.7)'
    ctx.lineWidth = 1.2
    ctx.stroke()

    // Main VMC line — colored by ER quality
    ctx.beginPath()
    vmc.sig.forEach((v, i) => {
      const x = toX(i), y = toY(v)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    const lineColor = vmc.erQuality === 'strong' ? '#34C759' : vmc.erQuality === 'moderate' ? '#FF9500' : '#8E8E93'
    ctx.strokeStyle = lineColor
    ctx.lineWidth = 1.8
    ctx.stroke()

    // ER bar at bottom
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    ctx.fillRect(0, erPanelTop, W, erPanelH)
    for (let i = 1; i < n; i++) {
      const er = vmc.erSmoothed[i] ?? 0
      const x  = toX(i)
      const erColor = er > 0.65 ? `rgba(52,199,89,0.7)` : er > 0.4 ? `rgba(255,149,0,0.6)` : `rgba(255,59,48,0.5)`
      ctx.fillStyle = erColor
      ctx.fillRect(x - 1.5, toYER(er), 3, toYER(0) - toYER(er))
    }
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.font = '8px JetBrains Mono, monospace'
    ctx.fillText('ER', 4, erPanelTop + 10)

  }, [vmc, height])

  if (vmc.sig.length < 10) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tm-text-muted)', fontSize: 12, background: '#080C14', borderRadius: 8 }}>
        Chargement VMC…
      </div>
    )
  }

  return <canvas ref={ref} style={{ width: '100%', height, borderRadius: 8, display: 'block' }} />
}

// ─── Timeframe selector ───────────────────────────────────────────────────────
const TF_OPTIONS = [
  { label: '15m', interval: '15m', limit: 300 },
  { label: '1H',  interval: '1h',  limit: 300 },
  { label: '4H',  interval: '4h',  limit: 300 },
  { label: '12H', interval: '12h', limit: 200 },
  { label: '1J',  interval: '1d',  limit: 200 },
  { label: '1S',  interval: '1w',  limit: 150 },
]

// ─── MTF Heatmap row ──────────────────────────────────────────────────────────
interface MTFRow {
  tf:       string
  zscore:   number
  excess:   string
  erScore:  number
  vmcBias:  string
  regime:   string
}

// ─── Main Component ───────────────────────────────────────────────────────────
interface OUChannelIndicatorProps {
  symbol:         string
  syncInterval?:  string
  visibleRange?:  { from: number; to: number } | null
}

export default function OUChannelIndicator({ symbol, syncInterval, visibleRange }: OUChannelIndicatorProps) {
  const [tf, setTf]               = useState('1h')
  const [candles, setCandles]     = useState<Candle[]>([])
  const [ou, setOu]               = useState<OUResult | null>(null)
  const [vmc, setVmc]             = useState<VMCEnhancedResult | null>(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [mtfRows, setMtfRows]     = useState<MTFRow[]>([])
  const [mtfLoading, setMtfLoading] = useState(false)
  const [activeView, setActiveView] = useState<'channel' | 'zscore' | 'vmc'>('channel')
  const loadRef = useRef(0)

  // Sync with parent timeframe if provided
  useEffect(() => {
    if (syncInterval) {
      const match = TF_OPTIONS.find(t => t.interval === syncInterval)
      if (match) setTf(match.interval)
    }
  }, [syncInterval])

  const loadData = useCallback(async (interval: string) => {
    if (!symbol) return
    const id = ++loadRef.current
    setLoading(true)
    setError('')
    try {
      const opt = TF_OPTIONS.find(t => t.interval === interval) ?? TF_OPTIONS[1]
      const data = await fetchCandles(symbol, opt.interval, opt.limit)
      if (id !== loadRef.current) return

      setCandles(data)

      // OU Channel
      const ouResult = calcOUChannel(data, 50, 20)
      setOu(ouResult)

      // Enhanced VMC
      const vmcResult = calcVMCEnhanced(data, 14)
      setVmc(vmcResult)

    } catch (e: unknown) {
      if (id === loadRef.current) {
        setError(e instanceof Error ? e.message : 'Erreur de chargement')
      }
    } finally {
      if (id === loadRef.current) setLoading(false)
    }
  }, [symbol])

  useEffect(() => { loadData(tf) }, [tf, loadData])

  // MTF scan
  const loadMTF = useCallback(async () => {
    if (!symbol) return
    setMtfLoading(true)
    const tfs = ['15m', '1h', '4h', '1d']
    const rows: MTFRow[] = []
    await Promise.all(tfs.map(async (interval) => {
      try {
        const data = await fetchCandles(symbol, interval, 150)
        const ouR = calcOUChannel(data, 50, 20)
        const vmcR = calcVMCEnhanced(data, 14)
        const n = data.length - 1
        rows.push({
          tf:       interval,
          zscore:   ouR.zscore[n] ?? 0,
          excess:   ouR.excess[n] ?? 'none',
          erScore:  vmcR.erSmoothed[n] ?? 0,
          vmcBias:  vmcR.trendBias,
          regime:   ouR.regime[n] ?? 'ranging',
        })
      } catch { /* ignore */ }
    }))
    rows.sort((a, b) => {
      const order: Record<string, number> = { '15m': 0, '1h': 1, '4h': 2, '1d': 3 }
      return (order[a.tf] ?? 99) - (order[b.tf] ?? 99)
    })
    setMtfRows(rows)
    setMtfLoading(false)
  }, [symbol])

  useEffect(() => { loadMTF() }, [loadMTF])

  // ── Current stats ──
  const n         = candles.length - 1
  const curZ      = ou?.zscore[n] ?? 0
  const curExcess = ou?.excess[n] ?? 'none'
  const curRegime = ou?.regime[n] ?? 'ranging'
  const curKappa  = ou?.kappa[n] ?? 0
  const curMean   = ou?.mean[n] ?? 0
  const curPrice  = candles[n]?.c ?? 0

  const zColor = curExcess === 'extreme_ob' ? '#FF3B30'
    : curExcess === 'overbought' ? '#FF9500'
    : curExcess === 'extreme_os' ? '#22C759'
    : curExcess === 'oversold'   ? '#42A5F5'
    : '#8E8E93'

  const regimeColor = curRegime === 'trending' ? '#FF9500'
    : curRegime === 'breakout' ? '#BF5AF2'
    : '#00E5FF'

  const excessLabel = {
    extreme_ob: '⚠️ Excès Extrême',
    overbought: '🔴 Surachat OU',
    extreme_os: '🚀 Rebond Extrême',
    oversold:   '🟢 Survente OU',
    none:       '🔵 Zone Neutre',
  }[curExcess] ?? '—'

  function fmtP(p: number): string {
    if (p >= 10000) return `$${p.toLocaleString('en', { maximumFractionDigits: 0 })}`
    if (p >= 1)     return `$${p.toFixed(2)}`
    return `$${p.toFixed(5)}`
  }

  const C = {
    card: {
      background:  'rgba(13,17,35,0.7)',
      border:      '1px solid rgba(255,255,255,0.06)',
      borderRadius: 16,
      overflow:    'hidden' as const,
      position:    'relative' as const,
      backdropFilter: 'blur(12px)',
    },
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'relative', zIndex: 1 }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes ouPulse { 0%,100%{opacity:0.6}50%{opacity:1} }
      `}</style>

      {/* ── Header Card ── */}
      <div style={{ ...C.card, padding: '14px 18px', borderColor: `${zColor}40` }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg,transparent,${zColor}80,transparent)`,
        }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          {/* Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: `linear-gradient(135deg,rgba(0,229,255,0.15),rgba(191,90,242,0.15))`,
              border: '1px solid rgba(0,229,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16,
            }}>〜</div>
            <div>
              <div style={{
                fontSize: 13, fontWeight: 800, color: 'var(--tm-text-primary)',
                fontFamily: 'Syne,sans-serif',
              }}>
                Canal OU · Excès Statistiques
              </div>
              <div style={{ fontSize: 10, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono,monospace' }}>
                Ornstein-Uhlenbeck · VMC + Kaufman ER
              </div>
            </div>
          </div>

          {/* Key stats */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Z-score badge */}
            <div style={{
              padding: '5px 12px', borderRadius: 8,
              background: `${zColor}15`,
              border: `1px solid ${zColor}40`,
              display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}>
              <span style={{ fontSize: 9, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono' }}>Z-SCORE OU</span>
              <span style={{ fontSize: 16, fontWeight: 800, color: zColor, fontFamily: 'JetBrains Mono' }}>
                {curZ >= 0 ? '+' : ''}{curZ.toFixed(2)}σ
              </span>
            </div>

            {/* Excess label */}
            <div style={{
              padding: '5px 12px', borderRadius: 8,
              background: `${zColor}10`,
              border: `1px solid ${zColor}25`,
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: zColor }}>{excessLabel}</span>
            </div>

            {/* Regime */}
            <div style={{
              padding: '5px 10px', borderRadius: 8,
              background: `${regimeColor}10`,
              border: `1px solid ${regimeColor}25`,
              display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}>
              <span style={{ fontSize: 9, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono' }}>RÉGIME</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: regimeColor, textTransform: 'uppercase' }}>
                {curRegime === 'trending' ? '📈 Tendance' : curRegime === 'breakout' ? '💥 Breakout' : '🔄 Range'}
              </span>
            </div>

            {/* κ (mean-reversion speed) */}
            <div style={{
              padding: '5px 10px', borderRadius: 8,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}>
              <span style={{ fontSize: 9, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono' }}>κ REVERSION</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#BF5AF2', fontFamily: 'JetBrains Mono' }}>
                {curKappa.toFixed(2)}
              </span>
            </div>

            {/* VMC ER quality */}
            {vmc && (
              <div style={{
                padding: '5px 10px', borderRadius: 8,
                background: `${vmc.erColor}10`,
                border: `1px solid ${vmc.erColor}25`,
                display: 'flex', flexDirection: 'column', alignItems: 'center',
              }}>
                <span style={{ fontSize: 9, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono' }}>ER KAUFMAN</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: vmc.erColor, fontFamily: 'JetBrains Mono' }}>
                  {vmc.erQuality === 'strong' ? '⚡ Fort' : vmc.erQuality === 'moderate' ? '◐ Modéré' : '○ Faible'}
                </span>
              </div>
            )}

            {/* Mean price */}
            {curMean > 0 && (
              <div style={{
                padding: '5px 10px', borderRadius: 8,
                background: 'rgba(0,229,255,0.05)',
                border: '1px solid rgba(0,229,255,0.15)',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
              }}>
                <span style={{ fontSize: 9, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono' }}>μ OU</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#00E5FF', fontFamily: 'JetBrains Mono' }}>
                  {fmtP(curMean)}
                </span>
              </div>
            )}

            {/* Reload */}
            <button onClick={() => loadData(tf)} disabled={loading} style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'none', border: '1px solid rgba(255,255,255,0.1)',
              cursor: loading ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--tm-text-muted)', fontSize: 14,
            }}>
              {loading ? <div style={{ width: 12, height: 12, border: '2px solid #2A2F3E', borderTopColor: '#00E5FF', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> : '↻'}
            </button>
          </div>
        </div>

        {/* VMC Status bar */}
        {vmc && (
          <div style={{
            marginTop: 10, padding: '6px 12px', borderRadius: 8,
            background: `${vmc.statusColor}10`,
            border: `1px solid ${vmc.statusColor}25`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: vmc.statusColor, boxShadow: `0 0 6px ${vmc.statusColor}` }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: vmc.statusColor, fontFamily: 'Syne,sans-serif' }}>
                {vmc.status}
              </span>
            </div>
            {/* Confluence bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, color: 'var(--tm-text-muted)' }}>Confluence</span>
              <div style={{ width: 80, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', position: 'relative' }}>
                <div style={{
                  position: 'absolute',
                  left: vmc.confluence >= 0 ? '50%' : `${(0.5 + vmc.confluence * 0.5) * 100}%`,
                  width: `${Math.abs(vmc.confluence) * 50}%`,
                  height: '100%',
                  background: vmc.confluence > 0 ? '#34C759' : '#FF3B30',
                  borderRadius: 3,
                  transition: 'all 0.3s',
                }} />
                <div style={{ position: 'absolute', left: '50%', top: '-1px', width: 1, height: 8, background: 'rgba(255,255,255,0.3)' }} />
              </div>
              <span style={{
                fontSize: 10, fontWeight: 700,
                color: vmc.confluence > 0.2 ? '#34C759' : vmc.confluence < -0.2 ? '#FF3B30' : '#8E8E93',
                fontFamily: 'JetBrains Mono',
              }}>
                {vmc.confluence >= 0 ? '+' : ''}{(vmc.confluence * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── View selector + TF ── */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* View tabs */}
        {((['channel', 'zscore', 'vmc'] as const).map(v => ({
          id: v,
          label: v === 'channel' ? '〜 Canal OU' : v === 'zscore' ? '± Z-Score' : '≋ VMC + ER',
        }))).map(tab => (
          <button key={tab.id} onClick={() => setActiveView(tab.id)} style={{
            padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600,
            cursor: 'pointer',
            background: activeView === tab.id ? 'rgba(0,229,255,0.12)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${activeView === tab.id ? 'rgba(0,229,255,0.4)' : 'rgba(255,255,255,0.08)'}`,
            color: activeView === tab.id ? '#00E5FF' : 'var(--tm-text-muted)',
            transition: 'all 0.15s',
          }}>
            {tab.label}
          </button>
        ))}

        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />

        {/* TF selector */}
        {TF_OPTIONS.map(opt => (
          <button key={opt.label} onClick={() => setTf(opt.interval)} style={{
            padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600,
            cursor: 'pointer',
            background: tf === opt.interval ? 'rgba(191,90,242,0.15)' : 'transparent',
            border: `1px solid ${tf === opt.interval ? 'rgba(191,90,242,0.5)' : 'rgba(255,255,255,0.07)'}`,
            color: tf === opt.interval ? '#BF5AF2' : 'var(--tm-text-muted)',
            transition: 'all 0.15s',
          }}>
            {opt.label}
          </button>
        ))}
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{ padding: '10px 16px', borderRadius: 10, background: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.3)', color: '#FF3B30', fontSize: 12 }}>
          ⚠️ {error}
        </div>
      )}

      {/* ── Charts ── */}
      {loading && !candles.length ? (
        <div style={{ ...C.card, padding: 40, textAlign: 'center' as const, color: 'var(--tm-text-muted)', fontSize: 12 }}>
          <div style={{ width: 20, height: 20, border: '2px solid #2A2F3E', borderTopColor: '#00E5FF', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 8px' }} />
          Calcul du processus OU…
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Legend */}
          <div style={{
            display: 'flex', gap: 12, flexWrap: 'wrap',
            padding: '6px 12px',
            background: 'rgba(0,0,0,0.3)', borderRadius: '8px 8px 0 0',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            {activeView === 'channel' && [
              ['rgba(0,229,255,0.7)', 'μ (moyenne OU)'],
              ['rgba(255,149,0,0.5)', '+/-1σ adaptatif'],
              ['rgba(255,59,48,0.6)', '+/-2σ (excès)'],
              ['#22C759', 'Prix en survente'],
              ['#FF3B30', 'Prix en surachat'],
            ].map(([c, l]) => (
              <div key={l as string} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 14, height: 2, background: c as string, borderRadius: 1 }} />
                <span style={{ fontSize: 9, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono,monospace' }}>{l as string}</span>
              </div>
            ))}
            {activeView === 'zscore' && [
              ['rgba(255,59,48,0.8)', '> +2.5σ Extrême'],
              ['rgba(255,149,0,0.7)', '+1.5 à +2.5σ Surachat'],
              ['rgba(0,229,255,0.6)', 'Zone neutre'],
              ['rgba(42,160,80,0.7)', '-1.5 à -2.5σ Survente'],
              ['rgba(52,199,89,0.8)', '< -2.5σ Extrême'],
            ].map(([c, l]) => (
              <div key={l as string} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 10, height: 10, background: c as string, borderRadius: 2 }} />
                <span style={{ fontSize: 9, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono,monospace' }}>{l as string}</span>
              </div>
            ))}
            {activeView === 'vmc' && [
              ['#34C759', 'VMC (ER Fort)'],
              ['#FF9500', 'VMC Signal'],
              ['rgba(52,199,89,0.6)', 'Momentum +'],
              ['rgba(255,59,48,0.6)', 'Momentum -'],
              ['#34C759', 'ER > 0.65 (tendance)'],
              ['#FF453A', 'ER < 0.40 (range)'],
            ].map(([c, l]) => (
              <div key={l as string} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 14, height: 2, background: c as string, borderRadius: 1 }} />
                <span style={{ fontSize: 9, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono,monospace' }}>{l as string}</span>
              </div>
            ))}
            {/* Regime legend */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {[['#FF9500', '● Tendance'], ['#00E5FF', '● Range'], ['#BF5AF2', '● Breakout']].map(([c, l]) => (
                <span key={l as string} style={{ fontSize: 9, color: c as string, fontFamily: 'JetBrains Mono' }}>{l as string}</span>
              ))}
            </div>
          </div>

          {/* Chart area */}
          <div style={{
            background: '#080C14', borderRadius: '0 0 8px 8px',
            border: '1px solid rgba(255,255,255,0.06)',
            borderTop: 'none', overflow: 'hidden',
          }}>
            {activeView === 'channel' && ou && (
              <OUChannelChart candles={candles} ou={ou} height={220} />
            )}
            {activeView === 'zscore' && ou && (
              <ZScoreChart zscore={ou.zscore} excess={ou.excess} height={130} />
            )}
            {activeView === 'vmc' && vmc && (
              <VMCEnhancedChart vmc={vmc} height={150} />
            )}
          </div>
        </div>
      )}

      {/* ── MTF Confluence Table ── */}
      <div style={{ ...C.card, padding: '12px 14px' }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 1,
          background: 'linear-gradient(90deg,transparent,rgba(0,229,255,0.15),transparent)',
        }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-text-primary)', fontFamily: 'Syne,sans-serif' }}>
            📊 Confluence Multi-Timeframes
          </span>
          {mtfLoading && (
            <div style={{ width: 12, height: 12, border: '2px solid #2A2F3E', borderTopColor: '#00E5FF', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          )}
        </div>

        {/* Column headers */}
        <div style={{
          display: 'grid', gridTemplateColumns: '60px 90px 100px 80px 100px 80px',
          gap: 4, marginBottom: 6,
        }}>
          {['TF', 'Z-Score OU', 'Excès OU', 'ER Kaufman', 'VMC Biais', 'Régime'].map(h => (
            <div key={h} style={{ fontSize: 9, fontWeight: 700, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</div>
          ))}
        </div>

        {/* Rows */}
        {mtfRows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--tm-text-muted)', fontSize: 12 }}>Calcul MTF en cours…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {mtfRows.map(row => {
              const zc = Math.abs(row.zscore) > 2.5 ? '#FF3B30' : Math.abs(row.zscore) > 1.5 ? '#FF9500' : '#8E8E93'
              const ec = row.excess.includes('ob') ? '#FF3B30' : row.excess.includes('os') ? '#34C759' : '#8E8E93'
              const erc = row.erScore > 0.65 ? '#34C759' : row.erScore > 0.4 ? '#FF9500' : '#FF453A'
              const bc = row.vmcBias === 'bullish' ? '#34C759' : row.vmcBias === 'bearish' ? '#FF3B30' : '#8E8E93'
              const rc = row.regime === 'trending' ? '#FF9500' : row.regime === 'breakout' ? '#BF5AF2' : '#00E5FF'
              const isActive = row.tf === tf

              return (
                <div
                  key={row.tf}
                  onClick={() => setTf(row.tf)}
                  style={{
                    display: 'grid', gridTemplateColumns: '60px 90px 100px 80px 100px 80px',
                    gap: 4, padding: '6px 8px', borderRadius: 8, cursor: 'pointer',
                    background: isActive ? 'rgba(0,229,255,0.06)' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${isActive ? 'rgba(0,229,255,0.2)' : 'transparent'}`,
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: isActive ? '#00E5FF' : 'var(--tm-text-primary)', fontFamily: 'JetBrains Mono' }}>{row.tf}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: zc, fontFamily: 'JetBrains Mono' }}>
                    {row.zscore >= 0 ? '+' : ''}{row.zscore.toFixed(2)}σ
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: ec }}>
                    {row.excess === 'extreme_ob' ? '⚠️ Extrême OB' : row.excess === 'overbought' ? '🔴 Surachat' : row.excess === 'extreme_os' ? '🚀 Extrême OS' : row.excess === 'oversold' ? '🟢 Survente' : '● Neutre'}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: erc, fontFamily: 'JetBrains Mono' }}>
                    {row.erScore.toFixed(2)} {row.erScore > 0.65 ? '⚡' : row.erScore > 0.4 ? '◐' : '○'}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: bc }}>
                    {row.vmcBias === 'bullish' ? '▲ Haussier' : row.vmcBias === 'bearish' ? '▼ Baissier' : '● Neutre'}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: rc }}>
                    {row.regime === 'trending' ? '📈 Trend' : row.regime === 'breakout' ? '💥 Break' : '🔄 Range'}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* Overall confluence signal */}
        {mtfRows.length > 0 && (() => {
          const bulls = mtfRows.filter(r => r.vmcBias === 'bullish').length
          const bears = mtfRows.filter(r => r.vmcBias === 'bearish').length
          const osRows = mtfRows.filter(r => r.excess.includes('os')).length
          const obRows = mtfRows.filter(r => r.excess.includes('ob')).length
          const strongER = mtfRows.filter(r => r.erScore > 0.6).length

          const signal = bulls > bears + 1 ? { color: '#34C759', label: '✅ Confluence Haussière', sub: `${bulls}/${mtfRows.length} TF bullish · ER fort sur ${strongER} TF` }
            : bears > bulls + 1 ? { color: '#FF3B30', label: '⚠️ Confluence Baissière', sub: `${bears}/${mtfRows.length} TF bearish · ${obRows} TF en surachat OU` }
            : osRows >= 2 ? { color: '#42A5F5', label: '🟢 Multi-TF Survente OU', sub: `${osRows} timeframes en zone survente — rebond probable` }
            : obRows >= 2 ? { color: '#FF9500', label: '🔴 Multi-TF Surachat OU', sub: `${obRows} timeframes en zone surachat — prudence` }
            : { color: '#8E8E93', label: '⚖️ Pas de confluence claire', sub: 'Signaux mixtes — attendre la confirmation' }

          return (
            <div style={{
              marginTop: 10, padding: '8px 12px', borderRadius: 8,
              background: `${signal.color}10`,
              border: `1px solid ${signal.color}30`,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: signal.color, marginBottom: 2 }}>{signal.label}</div>
              <div style={{ fontSize: 10, color: 'var(--tm-text-muted)' }}>{signal.sub}</div>
            </div>
          )
        })()}
      </div>

      {/* ── Theory explainer ── */}
      <div style={{
        padding: '10px 14px', borderRadius: 10,
        background: 'rgba(0,229,255,0.03)', border: '1px solid rgba(0,229,255,0.08)',
        fontSize: 10, color: 'rgba(255,255,255,0.35)', lineHeight: 1.7,
        fontFamily: 'JetBrains Mono,monospace',
      }}>
        <span style={{ color: '#00E5FF' }}>OU</span>: dX = κ(μ−X)dt + σdW · Bandes ±1σ/±2σ adaptatives
        &nbsp;|&nbsp;
        <span style={{ color: '#BF5AF2' }}>κ</span>: vitesse de retour à la moyenne (élevée = range)
        &nbsp;|&nbsp;
        <span style={{ color: '#FF9500' }}>ER Kaufman</span>: |Δprix| / Σ|Δ| — 1=tendance pure, 0=bruit
        &nbsp;|&nbsp;
        <span style={{ color: '#34C759' }}>VMC+ER</span>: signal amplifié par la qualité du mouvement
      </div>
    </div>
  )
}
