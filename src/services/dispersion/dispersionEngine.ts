/**
 * Dispersion Analysis Engine — Institutional Grade
 *
 * Math references:
 *   Cross-sectional dispersion:  d_t = std({r_i,t})
 *   Implied index vol:           σ_idx² = Σ w_i²σ_i² + 2·Σ_{i<j} w_i·w_j·ρ_ij·σ_i·σ_j
 *   Realized dispersion premium: RDP = avg(σ_i) - σ_idx  (positive = components > index)
 *   Average correlation:         ρ̄ = 2/(N·(N-1)) · Σ_{i<j} ρ_ij
 */

import type {
  AssetConfig, RawCandle, ComponentSnapshot,
  DispersionResult, DispersionRegime, DispersionHistory
} from './types'

// ─── Math helpers ─────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  if (!arr.length) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function std(arr: number[], m?: number): number {
  if (arr.length < 2) return 0
  const mu = m ?? mean(arr)
  return Math.sqrt(arr.reduce((a, b) => a + (b - mu) ** 2, 0) / arr.length)
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 3) return 0
  const ma = mean(a.slice(-n)), mb = mean(b.slice(-n))
  let num = 0, da = 0, db = 0
  for (let i = a.length - n; i < a.length; i++) {
    const ai = a[i] - ma, bi = b[i] - mb
    num += ai * bi; da += ai * ai; db += bi * bi
  }
  const denom = Math.sqrt(da * db)
  return denom === 0 ? 0 : Math.max(-1, Math.min(1, num / denom))
}

function ema(arr: number[], period: number): number[] {
  if (!arr.length) return []
  const k = 2 / (period + 1)
  const out: number[] = [arr[0]]
  for (let i = 1; i < arr.length; i++) out.push(arr[i] * k + out[i - 1] * (1 - k))
  return out
}

function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50
  let gains = 0, losses = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    d >= 0 ? (gains += d) : (losses -= d)
  }
  let avgGain = gains / period, avgLoss = losses / period
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period
  }
  return avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
}

function realizedVol(closes: number[], window = 20): number {
  if (closes.length < 2) return 0
  const slice = closes.slice(-Math.min(window + 1, closes.length))
  const returns: number[] = []
  for (let i = 1; i < slice.length; i++) returns.push(Math.log(slice[i] / slice[i - 1]))
  return std(returns) * Math.sqrt(365) // annualized
}

function vwap(candles: RawCandle[]): number {
  let cumPV = 0, cumV = 0
  for (const c of candles) {
    const tp = (c.h + c.l + c.c) / 3
    cumPV += tp * c.v; cumV += c.v
  }
  return cumV === 0 ? 0 : cumPV / cumV
}

function percentileRank(value: number, history: number[]): number {
  if (!history.length) return 50
  const below = history.filter(v => v < value).length
  return (below / history.length) * 100
}

function zScore(value: number, mu: number, sigma: number): number {
  return sigma === 0 ? 0 : (value - mu) / sigma
}

// ─── Core computation ─────────────────────────────────────────────────────────

export interface ComputeInput {
  configs: AssetConfig[]
  candleMap: Map<string, RawCandle[]>   // symbol → candles
  lookback?: number    // bars used for rolling stats (default 50)
  returnWindow?: number // bars for return calc (default 1)
}

export function computeDispersion(input: ComputeInput): DispersionResult | null {
  const { configs, candleMap, lookback = 50, returnWindow = 1 } = input
  const N = configs.length
  if (N < 2) return null

  // Validate all assets have data
  const validConfigs = configs.filter(c => {
    const d = candleMap.get(c.symbol)
    return d && d.length >= Math.max(51, lookback + returnWindow)
  })
  if (validConfigs.length < 2) return null

  // Equal weights if not specified
  const weights = validConfigs.map(c => c.weight ?? 1 / validConfigs.length)
  const wSum = weights.reduce((a, b) => a + b, 0)
  const w = weights.map(wi => wi / wSum)

  // ── Closes matrix ──
  const closesMatrix: number[][] = validConfigs.map(c => {
    const candles = candleMap.get(c.symbol)!
    return candles.map(x => x.c)
  })

  // Align lengths (take last min-length bars)
  const minLen = Math.min(...closesMatrix.map(c => c.length))
  const aligned = closesMatrix.map(c => c.slice(-minLen))

  // ── Returns (last `returnWindow` bars) ──
  const getReturn = (closes: number[], win: number): number => {
    const len = closes.length
    if (len < win + 1) return 0
    return (closes[len - 1] - closes[len - 1 - win]) / closes[len - 1 - win]
  }
  const returns1d = aligned.map(c => getReturn(c, 1))
  const returns5d = aligned.map(c => getReturn(c, Math.min(5, returnWindow)))
  const returnsWin = aligned.map(c => getReturn(c, returnWindow))

  // ── Cross-sectional dispersion ──
  const dispersionRaw = std(returnsWin)

  // Rolling dispersion series for historical context
  const dispersionHistory: number[] = []
  for (let t = lookback; t <= minLen - 1; t++) {
    const slice_returns = aligned.map(c => (c[t] - c[t - returnWindow]) / c[t - returnWindow])
    dispersionHistory.push(std(slice_returns))
  }
  const dispMA = mean(dispersionHistory)
  const dispStd = std(dispersionHistory)
  const dispZScore = zScore(dispersionRaw, dispMA, dispStd)
  const dispPercentile = percentileRank(dispersionRaw, dispersionHistory)

  // ── Correlation matrix (NxN on rolling window returns) ──
  const rollingReturns = aligned.map(closes => {
    const ret: number[] = []
    for (let i = 1; i < closes.length; i++) ret.push((closes[i] - closes[i - 1]) / closes[i - 1])
    return ret.slice(-lookback)
  })
  const corrMatrix: number[][] = Array.from({ length: N }, () => Array(N).fill(0))
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      corrMatrix[i][j] = i === j ? 1 : pearson(rollingReturns[i], rollingReturns[j])
    }
  }
  // Average upper triangle
  let corrSum = 0, corrCount = 0
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { corrSum += corrMatrix[i][j]; corrCount++ }
  const avgCorrelation = corrCount > 0 ? corrSum / corrCount : 0

  // Rolling avg correlation history
  const corrHistory: number[] = []
  for (let t = lookback; t <= minLen - 1; t++) {
    const rr = aligned.map(closes => {
      const ret: number[] = []
      for (let i = Math.max(1, t - lookback + 1); i <= t; i++) ret.push((closes[i] - closes[i-1]) / closes[i-1])
      return ret
    })
    let s = 0, cnt = 0
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { s += pearson(rr[i], rr[j]); cnt++ }
    corrHistory.push(cnt > 0 ? s / cnt : 0)
  }
  const corrMA = mean(corrHistory), corrStd = std(corrHistory)
  const corrZScore = zScore(avgCorrelation, corrMA, corrStd)
  const corrPercentile = percentileRank(avgCorrelation, corrHistory)

  // ── Realized vols ──
  const componentVols = aligned.map(c => realizedVol(c, 20))
  const avgComponentVol = mean(componentVols)

  // Implied index vol via covariance model
  let impliedIndexVar = 0
  for (let i = 0; i < N; i++) {
    impliedIndexVar += w[i] * w[i] * componentVols[i] * componentVols[i]
    for (let j = i + 1; j < N; j++) {
      impliedIndexVar += 2 * w[i] * w[j] * corrMatrix[i][j] * componentVols[i] * componentVols[j]
    }
  }
  const impliedIndexVol = Math.sqrt(Math.max(0, impliedIndexVar))

  // Realized index vol (actual basket price series)
  const basketCloses: number[] = []
  for (let t = 0; t < minLen; t++) {
    basketCloses.push(aligned.reduce((sum, c, i) => sum + w[i] * c[t], 0))
  }
  const realizedIndexVol = realizedVol(basketCloses, 20)
  const volSpread = avgComponentVol - realizedIndexVol

  // Vol regime classification
  const volSpreadHistory: number[] = []
  for (let t = lookback + 20; t < minLen; t++) {
    const subVols = aligned.map(c => realizedVol(c.slice(0, t), 20))
    const subBasket = basketCloses.slice(0, t)
    volSpreadHistory.push(mean(subVols) - realizedVol(subBasket, 20))
  }
  const vsMA = mean(volSpreadHistory), vsStd = std(volSpreadHistory)
  const vsZScore = zScore(volSpread, vsMA, vsStd)
  const volRegime = vsZScore > 1.5 ? 'expansion' : vsZScore < -1 ? 'squeeze' : 'normal'

  // ── Breadth ──
  const pctUp = (returns1d.filter(r => r > 0).length / N) * 100
  const closes = aligned.map(c => c[c.length - 1])
  const pctAboveEma20 = aligned.filter((c, i) => {
    const emas = ema(c, 20)
    return closes[i] > emas[emas.length - 1]
  }).length / N * 100
  const pctAboveEma50 = aligned.filter((c, i) => {
    const emas = ema(c, 50)
    return closes[i] > emas[emas.length - 1]
  }).length / N * 100
  const advances = returns1d.filter(r => r > 0).length
  const declines = returns1d.filter(r => r < 0).length
  const advanceDeclineRatio = declines === 0 ? advances : advances / Math.max(1, declines)
  const participationScore = Math.round(
    0.4 * pctUp + 0.3 * pctAboveEma20 + 0.3 * pctAboveEma50
  )

  // ── Smart money signals ──
  const basketReturn = returns1d.reduce((s, r, i) => s + w[i] * r, 0)
  const medianReturn = [...returns1d].sort((a, b) => a - b)[Math.floor(N / 2)]
  const indexVsMedianDivergence = basketReturn - medianReturn

  // Hidden strength: breadth expanding but basket lagging
  const hiddenStrength = pctUp > 60 && basketReturn < mean(returns1d) * 0.7
  // Hidden weakness: basket up but participation narrow
  const hiddenWeakness = basketReturn > 0 && pctUp < 40

  // Smart money bias
  let smartMoneyBias: DispersionResult['smartMoneyBias'] = 'neutral'
  if (hiddenStrength && avgCorrelation < 0.4) smartMoneyBias = 'accumulation'
  else if (hiddenWeakness && dispersionRaw > dispMA) smartMoneyBias = 'distribution'

  const distributionScore = Math.round(
    (hiddenWeakness ? 40 : 0) +
    (avgCorrelation < corrMA ? 20 : 0) +
    (dispersionRaw > dispMA * 1.3 ? 20 : 0) +
    (pctUp < 40 ? 20 : 0)
  )
  const accumulationScore = Math.round(
    (hiddenStrength ? 40 : 0) +
    (avgCorrelation > corrMA ? 20 : 0) +
    (dispersionRaw < dispMA * 0.7 ? 20 : 0) +
    (pctUp > 60 ? 20 : 0)
  )

  // ── Component snapshots ──
  const basketReturnHistory = basketCloses.map((_, i, arr) =>
    i === 0 ? 0 : (arr[i] - arr[i - 1]) / arr[i - 1]
  )
  const bkMu = mean(basketReturnHistory), bkSd = std(basketReturnHistory)
  const components: ComponentSnapshot[] = validConfigs.map((cfg, i) => {
    const c = aligned[i]
    const emas20 = ema(c, 20)
    const emas50 = ema(c, 50)
    const candles = candleMap.get(cfg.symbol)!
    const vwapVal = vwap(candles.slice(-20))
    const componentRetHistory = c.map((_, t, arr) => t === 0 ? 0 : (arr[t] - arr[t-1]) / arr[t-1])
    const mu = mean(componentRetHistory), sd = std(componentRetHistory)
    return {
      symbol: cfg.symbol,
      label: cfg.label,
      return1d: returns1d[i],
      return5d: returns5d[i],
      realizedVol: componentVols[i],
      rsi14: rsi(c, 14),
      aboveEma20: c[c.length - 1] > emas20[emas20.length - 1],
      aboveEma50: c[c.length - 1] > emas50[emas50.length - 1],
      aboveVwap: c[c.length - 1] > vwapVal,
      zScore: sd === 0 ? 0 : (returns1d[i] - mu) / sd,
      momentum: ema(componentRetHistory.slice(-10), 5)[4] ?? 0,
      divergenceFromBasket: returns1d[i] - basketReturn,
    }
  })

  // ── Regime classification ──
  const { regime, regimeConfidence } = classifyRegime({
    dispersionZScore: dispZScore,
    dispersionPercentile: dispPercentile,
    avgCorrelation,
    corrZScore,
    pctUp,
    participationScore,
    volRegime,
    vsZScore,
  })

  // ── Risk-on score ──
  const riskOnScore = Math.round(
    0.25 * participationScore +
    0.25 * (pctAboveEma20) +
    0.20 * ((basketReturn > 0 ? 1 : 0) * 100) +
    0.15 * Math.max(0, 100 - dispZScore * 20) +
    0.15 * Math.max(0, 100 - corrZScore * 20)
  )

  // ── Overall score (-100 to +100) ──
  const bullSignals = [
    pctUp > 50 ? 1 : 0,
    avgCorrelation < 0.5 ? 0.5 : 0,
    basketReturn > 0 ? 1 : 0,
    hiddenStrength ? 1 : 0,
    rsi(basketCloses, 14) > 50 ? 0.5 : 0,
  ].reduce((a, b) => a + b, 0)
  const bearSignals = [
    pctUp < 50 ? 1 : 0,
    hiddenWeakness ? 1 : 0,
    basketReturn < 0 ? 1 : 0,
    rsi(basketCloses, 14) < 50 ? 0.5 : 0,
  ].reduce((a, b) => a + b, 0)
  const overallScore = Math.round(((bullSignals - bearSignals) / 4) * 100)
  const overallBias = overallScore > 20 ? 'bullish' : overallScore < -20 ? 'bearish' : 'neutral'

  return {
    timestamp: Date.now(),
    components,
    dispersionRaw,
    dispersionMA: dispMA,
    dispersionStd: dispStd,
    dispersionZScore: dispZScore,
    dispersionPercentile: dispPercentile,
    correlationMatrix: corrMatrix,
    avgCorrelation,
    correlationZScore: corrZScore,
    correlationPercentile: corrPercentile,
    avgComponentVol,
    impliedIndexVol,
    realizedIndexVol,
    volSpread,
    volRegime,
    volZScore: vsZScore,
    pctUp,
    pctAboveEma20,
    pctAboveEma50,
    advanceDeclineRatio,
    participationScore,
    regime,
    regimeConfidence,
    basketReturn,
    medianReturn,
    indexVsMedianDivergence,
    hiddenStrength,
    hiddenWeakness,
    smartMoneyBias,
    distributionScore,
    accumulationScore,
    riskOnScore,
    overallBias,
    overallScore,
  }
}

// ─── Regime classifier ────────────────────────────────────────────────────────

interface RegimeInput {
  dispersionZScore: number
  dispersionPercentile: number
  avgCorrelation: number
  corrZScore: number
  pctUp: number
  participationScore: number
  volRegime: 'squeeze' | 'normal' | 'expansion'
  vsZScore: number
}

function classifyRegime(inp: RegimeInput): { regime: DispersionRegime; regimeConfidence: number } {
  const scores: Record<DispersionRegime, number> = {
    compression: 0, expansion: 0, panic: 0, trending: 0, rotating: 0, unknown: 0,
  }

  // Compression: low dispersion + high correlation
  if (inp.dispersionZScore < -1) scores.compression += 30
  if (inp.avgCorrelation > 0.7) scores.compression += 30
  if (inp.volRegime === 'squeeze') scores.compression += 20
  if (inp.participationScore > 60) scores.compression += 20

  // Expansion: high dispersion + low correlation
  if (inp.dispersionZScore > 1.5) scores.expansion += 30
  if (inp.avgCorrelation < 0.3) scores.expansion += 30
  if (inp.volRegime === 'expansion') scores.expansion += 20
  if (inp.vsZScore > 1) scores.expansion += 20

  // Panic: high dispersion + high vol + narrow breadth
  if (inp.dispersionZScore > 2) scores.panic += 30
  if (inp.pctUp < 25) scores.panic += 30
  if (inp.volRegime === 'expansion') scores.panic += 20
  if (inp.avgCorrelation > 0.6) scores.panic += 20

  // Trending: low dispersion + directional + high breadth
  if (Math.abs(inp.dispersionZScore) < 0.5) scores.trending += 20
  if (inp.participationScore > 65) scores.trending += 30
  if (inp.pctUp > 70 || inp.pctUp < 30) scores.trending += 30
  if (inp.avgCorrelation > 0.5 && inp.avgCorrelation < 0.8) scores.trending += 20

  // Rotating: medium dispersion, medium correlation
  if (inp.dispersionPercentile > 40 && inp.dispersionPercentile < 70) scores.rotating += 30
  if (inp.avgCorrelation > 0.2 && inp.avgCorrelation < 0.6) scores.rotating += 30
  if (inp.pctUp > 40 && inp.pctUp < 65) scores.rotating += 20
  if (inp.corrZScore < 0) scores.rotating += 20

  // Find max
  const entries = Object.entries(scores) as [DispersionRegime, number][]
  const [regime, confidence] = entries.reduce((best, cur) => cur[1] > best[1] ? cur : best, ['unknown' as DispersionRegime, 0])
  return { regime, regimeConfidence: Math.min(100, confidence) }
}

// ─── Fetch + compute pipeline ─────────────────────────────────────────────────

export async function fetchAndCompute(
  configs: AssetConfig[],
  interval = '1h',
  limit = 150,
  lookback = 50,
): Promise<DispersionResult | null> {
  const candleMap = new Map<string, RawCandle[]>()

  await Promise.all(configs.map(async cfg => {
    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${cfg.symbol.toUpperCase()}&interval=${interval}&limit=${limit}`
      const res = await fetch(url)
      if (!res.ok) return
      const raw = await res.json() as unknown[][]
      candleMap.set(cfg.symbol, raw.map((k) => ({
        t: k[0] as number,
        o: parseFloat(k[1] as string),
        h: parseFloat(k[2] as string),
        l: parseFloat(k[3] as string),
        c: parseFloat(k[4] as string),
        v: parseFloat(k[5] as string),
      })))
    } catch { /* skip asset */ }
  }))

  return computeDispersion({ configs, candleMap, lookback })
}

// ─── Build historical series ──────────────────────────────────────────────────

export function buildHistory(
  configs: AssetConfig[],
  candleMap: Map<string, RawCandle[]>,
  lookback = 50,
  historyPoints = 30,
): DispersionHistory {
  const minLen = Math.min(...configs.map(c => candleMap.get(c.symbol)?.length ?? 0))
  const step = Math.max(1, Math.floor((minLen - lookback) / historyPoints))
  const timestamps: number[] = []
  const dispersion: number[] = []
  const avgCorrelation: number[] = []
  const pctUp: number[] = []
  const volSpread: number[] = []
  const riskOnScore: number[] = []

  for (let end = lookback + step; end <= minLen; end += step) {
    const subMap = new Map<string, RawCandle[]>()
    configs.forEach(c => {
      const candles = candleMap.get(c.symbol)
      if (candles) subMap.set(c.symbol, candles.slice(0, end))
    })
    const result = computeDispersion({ configs, candleMap: subMap, lookback })
    if (!result) continue
    timestamps.push(result.timestamp)
    dispersion.push(result.dispersionRaw)
    avgCorrelation.push(result.avgCorrelation)
    pctUp.push(result.pctUp)
    volSpread.push(result.volSpread)
    riskOnScore.push(result.riskOnScore)
  }

  return { timestamps, dispersion, avgCorrelation, pctUp, volSpread, riskOnScore }
}
