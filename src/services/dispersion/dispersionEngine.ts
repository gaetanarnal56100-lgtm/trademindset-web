/**
 * Dispersion Analysis Engine — Institutional Grade v2
 *
 * New in v2:
 *   - Hurst Exponent (R/S analysis) per component + basket
 *   - Lag-1 autocorrelation (momentum vs mean-reversion signal)
 *   - Return skewness + excess kurtosis
 *   - Mean reversion score per component
 *   - Cross-sectional momentum (top quartile - bottom quartile)
 *   - Synthesized trade signal (action + direction + reasoning)
 *   - Inline rolling history (30 time-slices from same candle data)
 *   - Trend arrows on key metrics
 */

import type {
  AssetConfig, RawCandle, ComponentSnapshot, DispersionResult,
  DispersionRegime, InlineHistory, TradeSignal, TrendArrows,
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

function skewness(arr: number[]): number {
  if (arr.length < 3) return 0
  const mu = mean(arr), s = std(arr)
  if (s === 0) return 0
  return arr.reduce((a, b) => a + ((b - mu) / s) ** 3, 0) / arr.length
}

function kurtosis(arr: number[]): number {
  if (arr.length < 4) return 0
  const mu = mean(arr), s = std(arr)
  if (s === 0) return 0
  return (arr.reduce((a, b) => a + ((b - mu) / s) ** 4, 0) / arr.length) - 3 // excess kurtosis
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
  return std(returns) * Math.sqrt(365)
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
  return (history.filter(v => v < value).length / history.length) * 100
}

function zScore(value: number, mu: number, sigma: number): number {
  return sigma === 0 ? 0 : (value - mu) / sigma
}

// ─── New: Hurst Exponent (R/S rescaled range analysis) ───────────────────────

function linearRegSlope(x: number[], y: number[]): number {
  const n = x.length
  if (n < 2) return 0.5
  const mx = mean(x), my = mean(y)
  let num = 0, denom = 0
  for (let i = 0; i < n; i++) { num += (x[i] - mx) * (y[i] - my); denom += (x[i] - mx) ** 2 }
  return denom === 0 ? 0.5 : num / denom
}

export function hurstExponent(series: number[]): number {
  if (series.length < 20) return 0.5
  const minLag = 4
  const maxLag = Math.min(Math.floor(series.length / 2), 40)
  const step = Math.max(1, Math.floor((maxLag - minLag) / 8))
  const logs: number[] = [], rsLogs: number[] = []

  for (let lag = minLag; lag <= maxLag; lag += step) {
    const rsArr: number[] = []
    for (let start = 0; start + lag <= series.length; start += lag) {
      const chunk = series.slice(start, start + lag)
      const m = mean(chunk)
      let cum = 0, maxCum = -Infinity, minCum = Infinity
      for (const v of chunk) { cum += v - m; maxCum = Math.max(maxCum, cum); minCum = Math.min(minCum, cum) }
      const R = maxCum - minCum
      const S = std(chunk)
      if (S > 0 && R > 0) rsArr.push(R / S)
    }
    if (rsArr.length > 0) { logs.push(Math.log(lag)); rsLogs.push(Math.log(mean(rsArr))) }
  }

  const H = linearRegSlope(logs, rsLogs)
  return Math.max(0.05, Math.min(0.95, H))
}

// ─── New: Lag-1 autocorrelation ───────────────────────────────────────────────

export function autocorrelation(series: number[], lag = 1): number {
  const n = series.length
  if (n <= lag + 2) return 0
  const mu = mean(series)
  let num = 0, denom = 0
  for (let i = lag; i < n; i++) num += (series[i] - mu) * (series[i - lag] - mu)
  for (let i = 0; i < n; i++) denom += (series[i] - mu) ** 2
  return denom === 0 ? 0 : Math.max(-1, Math.min(1, num / denom))
}

// ─── Core computation ─────────────────────────────────────────────────────────

export interface ComputeInput {
  configs: AssetConfig[]
  candleMap: Map<string, RawCandle[]>
  lookback?: number
  returnWindow?: number
}

export function computeDispersion(input: ComputeInput): DispersionResult | null {
  const { configs, candleMap, lookback = 50, returnWindow = 1 } = input
  const N = configs.length
  if (N < 2) return null

  const validConfigs = configs.filter(c => {
    const d = candleMap.get(c.symbol)
    return d && d.length >= Math.max(51, lookback + returnWindow)
  })
  if (validConfigs.length < 2) return null

  const weights = validConfigs.map(c => c.weight ?? 1 / validConfigs.length)
  const wSum = weights.reduce((a, b) => a + b, 0)
  const w = weights.map(wi => wi / wSum)

  // ── Closes matrix ──
  const closesMatrix: number[][] = validConfigs.map(c => candleMap.get(c.symbol)!.map(x => x.c))
  const minLen = Math.min(...closesMatrix.map(c => c.length))
  const aligned = closesMatrix.map(c => c.slice(-minLen))

  const getReturn = (closes: number[], win: number): number => {
    const len = closes.length
    if (len < win + 1) return 0
    return (closes[len - 1] - closes[len - 1 - win]) / closes[len - 1 - win]
  }

  const returns1d = aligned.map(c => getReturn(c, 1))
  const returns5d = aligned.map(c => getReturn(c, Math.min(5, returnWindow)))
  const returnsWin = aligned.map(c => getReturn(c, returnWindow))

  // ── Rolling returns (for Hurst, autocorr, correlation) ──
  const rollingReturns = aligned.map(closes => {
    const ret: number[] = []
    for (let i = 1; i < closes.length; i++) ret.push((closes[i] - closes[i - 1]) / closes[i - 1])
    return ret
  })

  // ── Basket price series ──
  const basketCloses: number[] = []
  for (let t = 0; t < minLen; t++) basketCloses.push(aligned.reduce((s, c, i) => s + w[i] * c[t], 0))
  const basketReturns: number[] = []
  for (let i = 1; i < basketCloses.length; i++) basketReturns.push((basketCloses[i] - basketCloses[i-1]) / basketCloses[i-1])

  // ── Cross-sectional dispersion ──
  const dispersionRaw = std(returnsWin)
  const dispersionHistory: number[] = []
  for (let t = lookback; t <= minLen - 1; t++) {
    const sliceRet = aligned.map(c => (c[t] - c[t - returnWindow]) / c[t - returnWindow])
    dispersionHistory.push(std(sliceRet))
  }
  const dispMA = mean(dispersionHistory), dispStd = std(dispersionHistory)
  const dispZScore = zScore(dispersionRaw, dispMA, dispStd)
  const dispPercentile = percentileRank(dispersionRaw, dispersionHistory)

  // ── Correlation matrix ──
  const corrMatrix: number[][] = Array.from({ length: N }, () => Array(N).fill(0))
  const rollWindow = Math.min(lookback, rollingReturns[0]?.length ?? lookback)
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      corrMatrix[i][j] = i === j ? 1 : pearson(
        rollingReturns[i].slice(-rollWindow),
        rollingReturns[j].slice(-rollWindow)
      )
    }
  }
  let corrSum = 0, corrCount = 0
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { corrSum += corrMatrix[i][j]; corrCount++ }
  const avgCorrelation = corrCount > 0 ? corrSum / corrCount : 0

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
  let impliedIndexVar = 0
  for (let i = 0; i < N; i++) {
    impliedIndexVar += w[i] * w[i] * componentVols[i] * componentVols[i]
    for (let j = i + 1; j < N; j++) {
      impliedIndexVar += 2 * w[i] * w[j] * corrMatrix[i][j] * componentVols[i] * componentVols[j]
    }
  }
  const impliedIndexVol = Math.sqrt(Math.max(0, impliedIndexVar))
  const realizedIndexVol = realizedVol(basketCloses, 20)
  const volSpread = avgComponentVol - realizedIndexVol

  const volSpreadHistory: number[] = []
  for (let t = lookback + 20; t < minLen; t++) {
    const sv = aligned.map(c => realizedVol(c.slice(0, t), 20))
    const sb = basketCloses.slice(0, t)
    volSpreadHistory.push(mean(sv) - realizedVol(sb, 20))
  }
  const vsMA = mean(volSpreadHistory), vsStd = std(volSpreadHistory)
  const vsZScore = zScore(volSpread, vsMA, vsStd)
  const volRegime = vsZScore > 1.5 ? 'expansion' : vsZScore < -1 ? 'squeeze' : 'normal'

  // ── Breadth ──
  const pctUp = (returns1d.filter(r => r > 0).length / N) * 100
  const closes = aligned.map(c => c[c.length - 1])
  const pctAboveEma20 = aligned.filter((c, i) => { const e = ema(c, 20); return closes[i] > e[e.length - 1] }).length / N * 100
  const pctAboveEma50 = aligned.filter((c, i) => { const e = ema(c, 50); return closes[i] > e[e.length - 1] }).length / N * 100
  const advances = returns1d.filter(r => r > 0).length
  const declines = returns1d.filter(r => r < 0).length
  const advanceDeclineRatio = declines === 0 ? advances : advances / Math.max(1, declines)
  const participationScore = Math.round(0.4 * pctUp + 0.3 * pctAboveEma20 + 0.3 * pctAboveEma50)

  // ── Smart money ──
  const basketReturn = returns1d.reduce((s, r, i) => s + w[i] * r, 0)
  const medianReturn = [...returns1d].sort((a, b) => a - b)[Math.floor(N / 2)]
  const indexVsMedianDivergence = basketReturn - medianReturn
  const hiddenStrength = pctUp > 60 && basketReturn < mean(returns1d) * 0.7
  const hiddenWeakness = basketReturn > 0 && pctUp < 40
  let smartMoneyBias: DispersionResult['smartMoneyBias'] = 'neutral'
  if (hiddenStrength && avgCorrelation < 0.4) smartMoneyBias = 'accumulation'
  else if (hiddenWeakness && dispersionRaw > dispMA) smartMoneyBias = 'distribution'
  const distributionScore = Math.round((hiddenWeakness ? 40 : 0) + (avgCorrelation < corrMA ? 20 : 0) + (dispersionRaw > dispMA * 1.3 ? 20 : 0) + (pctUp < 40 ? 20 : 0))
  const accumulationScore = Math.round((hiddenStrength ? 40 : 0) + (avgCorrelation > corrMA ? 20 : 0) + (dispersionRaw < dispMA * 0.7 ? 20 : 0) + (pctUp > 60 ? 20 : 0))

  // ── Return distribution shape ──
  const returnKurtosis = kurtosis(returns1d)
  const returnSkew = skewness(returns1d)

  // ── Basket Hurst + autocorr ──
  const basketHurst = hurstExponent(basketReturns.slice(-Math.min(100, basketReturns.length)))
  const basketAutocorr = autocorrelation(basketReturns.slice(-lookback))

  // ── Cross-sectional momentum ──
  const sortedRet = [...returns1d].sort((a, b) => a - b)
  const quartileSize = Math.max(1, Math.floor(N / 4))
  const bottomQ = mean(sortedRet.slice(0, quartileSize))
  const topQ = mean(sortedRet.slice(-quartileSize))
  const crossSectionalMomentum = topQ - bottomQ

  // ── Component snapshots (with new fields) ──
  const sortedForRank = [...returns1d.entries()].sort((a, b) => b[1] - a[1])
  const rankMap = new Map<number, number>()
  sortedForRank.forEach(([idx], rank) => rankMap.set(idx, rank + 1))

  const bkMu = mean(basketReturns), bkSd = std(basketReturns)

  const components: ComponentSnapshot[] = validConfigs.map((cfg, i) => {
    const c = aligned[i]
    const emas20 = ema(c, 20); const emas50 = ema(c, 50)
    const candles = candleMap.get(cfg.symbol)!
    const vwapVal = vwap(candles.slice(-20))
    const compReturns = rollingReturns[i]
    const compH = hurstExponent(compReturns.slice(-Math.min(80, compReturns.length)))
    const compAC = autocorrelation(compReturns.slice(-lookback))
    // Mean reversion score: how far return is from basket mean, normalized
    const devFromBasket = Math.abs(returns1d[i] - mean(returns1d))
    const devStd = std(returns1d)
    const meanRevScore = Math.min(100, Math.round((devFromBasket / Math.max(devStd, 0.0001)) * 33))
    const contribution = w[i] * returns1d[i]
    const sharpe = componentVols[i] === 0 ? 0 : returns1d[i] / componentVols[i]
    const muComp = mean(compReturns), sdComp = std(compReturns)
    return {
      symbol: cfg.symbol, label: cfg.label,
      return1d: returns1d[i], return5d: returns5d[i],
      realizedVol: componentVols[i], rsi14: rsi(c, 14),
      aboveEma20: c[c.length-1] > emas20[emas20.length-1],
      aboveEma50: c[c.length-1] > emas50[emas50.length-1],
      aboveVwap: c[c.length-1] > vwapVal,
      zScore: sdComp === 0 ? 0 : (returns1d[i] - muComp) / sdComp,
      momentum: ema(compReturns.slice(-10), 5)[4] ?? 0,
      divergenceFromBasket: returns1d[i] - basketReturn,
      hurstExponent: compH,
      autocorr: compAC,
      meanReversionScore: meanRevScore,
      contributionPct: contribution,
      sharpeLike: sharpe,
      rank: rankMap.get(i) ?? i + 1,
    }
  })

  // ── Regime ──
  const { regime, regimeConfidence } = classifyRegime({ dispersionZScore: dispZScore, dispersionPercentile: dispPercentile, avgCorrelation, corrZScore, pctUp, participationScore, volRegime, vsZScore })

  // ── Inline history (30 points from same candle data) ──
  const history = computeInlineHistory(aligned, w, lookback)

  // ── Trend arrows (compare current vs 3 most recent history points) ──
  const trendArrows = computeTrendArrows(history, dispersionRaw, avgCorrelation, pctUp, volSpread)

  // ── Trade signal ──
  const tradeSignal = computeTradeSignal({ dispersionZScore: dispZScore, avgCorrelation, basketHurst, components, pctUp, volRegime, corrZScore, participationScore })

  // ── Scores ──
  const riskOnScore = Math.round(0.25 * participationScore + 0.25 * pctAboveEma20 + 0.20 * ((basketReturn > 0 ? 1 : 0) * 100) + 0.15 * Math.max(0, 100 - dispZScore * 20) + 0.15 * Math.max(0, 100 - corrZScore * 20))
  const bullSignals = [pctUp > 50 ? 1 : 0, avgCorrelation < 0.5 ? 0.5 : 0, basketReturn > 0 ? 1 : 0, hiddenStrength ? 1 : 0, rsi(basketCloses, 14) > 50 ? 0.5 : 0].reduce((a, b) => a + b, 0)
  const bearSignals = [pctUp < 50 ? 1 : 0, hiddenWeakness ? 1 : 0, basketReturn < 0 ? 1 : 0, rsi(basketCloses, 14) < 50 ? 0.5 : 0].reduce((a, b) => a + b, 0)
  const overallScore = Math.round(((bullSignals - bearSignals) / 4) * 100)
  const overallBias = overallScore > 20 ? 'bullish' : overallScore < -20 ? 'bearish' : 'neutral'

  return {
    timestamp: Date.now(), components,
    dispersionRaw, dispersionMA: dispMA, dispersionStd: dispStd, dispersionZScore: dispZScore, dispersionPercentile: dispPercentile,
    correlationMatrix: corrMatrix, avgCorrelation, correlationZScore: corrZScore, correlationPercentile: corrPercentile,
    avgComponentVol, impliedIndexVol, realizedIndexVol, volSpread, volRegime, volZScore: vsZScore,
    pctUp, pctAboveEma20, pctAboveEma50, advanceDeclineRatio, participationScore,
    regime, regimeConfidence,
    basketReturn, medianReturn, indexVsMedianDivergence, hiddenStrength, hiddenWeakness, smartMoneyBias, distributionScore, accumulationScore,
    basketHurst, basketAutocorr, crossSectionalMomentum, returnKurtosis, returnSkew,
    tradeSignal, history, trendArrows,
    riskOnScore, overallBias, overallScore,
  }
}

// ─── Inline history (lightweight, no re-fetch) ───────────────────────────────

function computeInlineHistory(aligned: number[][], w: number[], lookback: number, points = 30): InlineHistory {
  const N = aligned.length
  const T = aligned[0].length
  const step = Math.max(1, Math.floor((T - lookback) / points))
  const result: InlineHistory = { timestamps: [], dispersion: [], avgCorrelation: [], pctUp: [], volSpread: [], regimes: [] }

  for (let t = lookback; t < T; t += step) {
    const ret = aligned.map(c => t > 0 ? (c[t] - c[t-1]) / c[t-1] : 0)
    const d = std(ret)
    const up = (ret.filter(r => r > 0).length / N) * 100
    result.dispersion.push(d)
    result.pctUp.push(up)

    // Rolling correlation (cheaper: use last 20 returns)
    const win = Math.min(20, t)
    const rr = aligned.map(c => {
      const s: number[] = []
      for (let i = Math.max(1, t - win); i <= t; i++) s.push((c[i] - c[i-1]) / c[i-1])
      return s
    })
    let cs = 0, cc = 0
    for (let i = 0; i < N; i++) for (let j = i+1; j < N; j++) { cs += pearson(rr[i], rr[j]); cc++ }
    const ac = cc > 0 ? cs / cc : 0
    result.avgCorrelation.push(ac)

    // Vol spread
    const compV = aligned.map(c => realizedVol(c.slice(0, t+1), Math.min(20, t)))
    const bkt = aligned[0].slice(0, t+1).map((_, i) => aligned.reduce((s, c, a) => s + w[a] * c[i], 0))
    result.volSpread.push(mean(compV) - realizedVol(bkt, Math.min(20, t)))

    // Regime from current point
    const dMean = result.dispersion.length > 1 ? mean(result.dispersion) : d
    const regime: DispersionRegime =
      d > dMean * 1.5 && ac < 0.35 ? 'expansion' :
      d < dMean * 0.7 && ac > 0.65 ? 'compression' :
      up < 25 ? 'panic' :
      up > 70 && d < dMean * 1.1 ? 'trending' :
      'rotating'
    result.regimes.push(regime)
    result.timestamps.push(t) // use bar index, convert to approx time in UI
  }

  return result
}

// ─── Trend arrows ─────────────────────────────────────────────────────────────

function computeTrendArrows(
  history: InlineHistory,
  currentDisp: number, currentCorr: number, currentPctUp: number, currentVS: number
): import('./types').TrendArrows {
  const arrow = (hist: number[], current: number): '↑' | '↓' | '→' => {
    if (hist.length < 3) return '→'
    const recent = mean(hist.slice(-3))
    const diff = (current - recent) / (Math.abs(recent) || 0.0001)
    return diff > 0.05 ? '↑' : diff < -0.05 ? '↓' : '→'
  }
  return {
    dispersion: arrow(history.dispersion, currentDisp),
    correlation: arrow(history.avgCorrelation, currentCorr),
    breadth: arrow(history.pctUp, currentPctUp),
    volSpread: arrow(history.volSpread, currentVS),
  }
}

// ─── Trade signal synthesis ───────────────────────────────────────────────────

interface SignalInputs {
  dispersionZScore: number
  avgCorrelation: number
  basketHurst: number
  components: ComponentSnapshot[]
  pctUp: number
  volRegime: 'squeeze' | 'normal' | 'expansion'
  corrZScore: number
  participationScore: number
}

function computeTradeSignal(inp: SignalInputs): TradeSignal {
  const { dispersionZScore, avgCorrelation, basketHurst, components, pctUp, volRegime, corrZScore } = inp
  const highDisp = dispersionZScore > 1.2
  const lowCorr = avgCorrelation < 0.45
  const highCorr = avgCorrelation > 0.65
  const trending = basketHurst > 0.55
  const meanRev = basketHurst < 0.45

  const sorted = [...components].sort((a, b) => b.return1d - a.return1d)
  const topN = sorted.slice(0, 3).map(c => c.label)
  const botN = sorted.slice(-3).map(c => c.label)

  const reasoning: string[] = []
  let action: TradeSignal['action'] = 'neutral'
  let direction: TradeSignal['direction'] = 'neutral'
  let score = 50, confidence = 30

  if (highDisp && lowCorr) {
    action = 'dispersion'
    score = Math.min(95, 50 + dispersionZScore * 15)
    if (meanRev) {
      direction = 'buy_laggards'
      confidence = Math.round(60 + (0.5 - basketHurst) * 80)
      reasoning.push(`📐 Dispersion élevée (Z=${dispersionZScore.toFixed(2)}σ) — composants divergent`)
      reasoning.push(`🔁 Hurst H=${basketHurst.toFixed(2)} < 0.5 → mean-reversion dominant`)
      reasoning.push(`🔗 Corrélation faible (${avgCorrelation.toFixed(2)}) — panier désynchronisé`)
      reasoning.push(`📌 Signal: acheter laggards, shorter leaders`)
    } else if (trending) {
      direction = 'buy_leaders'
      confidence = Math.round(55 + (basketHurst - 0.5) * 80)
      reasoning.push(`📐 Dispersion élevée (Z=${dispersionZScore.toFixed(2)}σ) — leaders s'accélèrent`)
      reasoning.push(`📈 Hurst H=${basketHurst.toFixed(2)} > 0.5 → momentum persistant`)
      reasoning.push(`🔗 Corrélation faible → sélection individuelle efficace`)
      reasoning.push(`📌 Signal: suivre les leaders, ignorer laggards`)
    } else {
      reasoning.push(`📐 Dispersion élevée — régime ambigu (H≈0.5)`)
      reasoning.push(`⚠️ Attendre confirmation Hurst ou breadth directionnelle`)
      confidence = 35
    }
  } else if (!highDisp && highCorr) {
    action = 'momentum'
    const bullish = pctUp > 55
    direction = bullish ? 'buy_leaders' : 'neutral'
    score = bullish ? 65 : 35
    confidence = 55
    reasoning.push(`📦 Compression: corrélation élevée (${avgCorrelation.toFixed(2)})`)
    reasoning.push(`🔗 Marché synchronisé — mouvement directionnel probable`)
    reasoning.push(bullish ? `✅ Breadth haussière (${pctUp.toFixed(0)}%) → long panier` : `⚠️ Breadth baissière → prudence`)
    if (corrZScore < -1) reasoning.push(`📉 Corrélation décroissante — rotation imminente`)
  } else {
    reasoning.push(`⏳ Pas de setup clairement défini`)
    reasoning.push(`💡 Attendre: expansion dispersion OU compression corrélation`)
    if (dispersionZScore > 0.5) reasoning.push(`👀 Dispersion en hausse — surveiller breakdown`)
  }

  if (volRegime === 'squeeze') {
    reasoning.push(`💥 Vol squeeze actif — breakout potentiellement imminent`)
    confidence = Math.min(95, confidence + 15)
  }
  if (volRegime === 'expansion') {
    reasoning.push(`⚡ Vol en expansion — position sizing réduit`)
  }

  return { action, direction, score, confidence, reasoning, topLongs: direction === 'buy_laggards' ? botN : topN, topShorts: direction === 'buy_laggards' ? topN : botN }
}

// ─── Regime classifier ────────────────────────────────────────────────────────

interface RegimeInput {
  dispersionZScore: number; dispersionPercentile: number
  avgCorrelation: number; corrZScore: number
  pctUp: number; participationScore: number
  volRegime: 'squeeze' | 'normal' | 'expansion'; vsZScore: number
}

function classifyRegime(inp: RegimeInput): { regime: DispersionRegime; regimeConfidence: number } {
  const scores: Record<DispersionRegime, number> = { compression: 0, expansion: 0, panic: 0, trending: 0, rotating: 0, unknown: 0 }
  if (inp.dispersionZScore < -1) scores.compression += 30
  if (inp.avgCorrelation > 0.7) scores.compression += 30
  if (inp.volRegime === 'squeeze') scores.compression += 20
  if (inp.participationScore > 60) scores.compression += 20
  if (inp.dispersionZScore > 1.5) scores.expansion += 30
  if (inp.avgCorrelation < 0.3) scores.expansion += 30
  if (inp.volRegime === 'expansion') scores.expansion += 20
  if (inp.vsZScore > 1) scores.expansion += 20
  if (inp.dispersionZScore > 2) scores.panic += 30
  if (inp.pctUp < 25) scores.panic += 30
  if (inp.volRegime === 'expansion') scores.panic += 20
  if (inp.avgCorrelation > 0.6) scores.panic += 20
  if (Math.abs(inp.dispersionZScore) < 0.5) scores.trending += 20
  if (inp.participationScore > 65) scores.trending += 30
  if (inp.pctUp > 70 || inp.pctUp < 30) scores.trending += 30
  if (inp.avgCorrelation > 0.5 && inp.avgCorrelation < 0.8) scores.trending += 20
  if (inp.dispersionPercentile > 40 && inp.dispersionPercentile < 70) scores.rotating += 30
  if (inp.avgCorrelation > 0.2 && inp.avgCorrelation < 0.6) scores.rotating += 30
  if (inp.pctUp > 40 && inp.pctUp < 65) scores.rotating += 20
  if (inp.corrZScore < 0) scores.rotating += 20
  const entries = Object.entries(scores) as [DispersionRegime, number][]
  const [regime, confidence] = entries.reduce((best, cur) => cur[1] > best[1] ? cur : best, ['unknown' as DispersionRegime, 0])
  return { regime, regimeConfidence: Math.min(100, confidence) }
}

// ─── Fetch + compute pipeline ─────────────────────────────────────────────────

export async function fetchAndCompute(
  configs: AssetConfig[], interval = '1h', limit = 150, lookback = 50,
): Promise<DispersionResult | null> {
  const candleMap = new Map<string, RawCandle[]>()
  await Promise.all(configs.map(async cfg => {
    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${cfg.symbol.toUpperCase()}&interval=${interval}&limit=${limit}`
      const res = await fetch(url)
      if (!res.ok) return
      const raw = await res.json() as unknown[][]
      candleMap.set(cfg.symbol, raw.map((k) => ({
        t: k[0] as number, o: parseFloat(k[1] as string), h: parseFloat(k[2] as string),
        l: parseFloat(k[3] as string), c: parseFloat(k[4] as string), v: parseFloat(k[5] as string),
      })))
    } catch { /* skip */ }
  }))
  return computeDispersion({ configs, candleMap, lookback })
}
