// Dispersion Analysis Engine — Types
// Institutional-grade market internals analysis

export interface AssetConfig {
  symbol: string
  label: string
  weight?: number      // default: equal weight
  sector?: string
}

export interface RawCandle {
  t: number   // timestamp ms
  o: number
  h: number
  l: number
  c: number
  v: number
}

// ─── Per-component snapshot ──────────────────────────────────────────────────
export interface ComponentSnapshot {
  symbol: string
  label: string
  return1d: number          // 1-bar return
  return5d: number          // 5-bar return
  realizedVol: number       // annualized realized vol (20-bar)
  rsi14: number
  aboveEma20: boolean
  aboveEma50: boolean
  aboveVwap: boolean
  zScore: number            // return z-score vs own history
  momentum: number          // EMA(return, 5) — trend bias
  divergenceFromBasket: number // component return - basket return
}

// ─── Core result ─────────────────────────────────────────────────────────────
export type DispersionRegime =
  | 'compression'   // Low dispersion, high correlation — macro-driven
  | 'expansion'     // High dispersion, low correlation — stock-picking
  | 'panic'         // High dispersion + high vol + low breadth
  | 'trending'      // Low dispersion, directional move, high breadth
  | 'rotating'      // Medium dispersion, sector rotation signal
  | 'unknown'

export interface DispersionResult {
  timestamp: number

  // ── Components ──
  components: ComponentSnapshot[]

  // ── Cross-sectional dispersion ──
  dispersionRaw: number         // std dev of component returns
  dispersionMA: number          // rolling mean (historical reference)
  dispersionStd: number         // rolling std of dispersion
  dispersionZScore: number      // (current - mean) / std
  dispersionPercentile: number  // 0–100 rank vs lookback history

  // ── Correlation ──
  correlationMatrix: number[][] // NxN pairwise Pearson (returns)
  avgCorrelation: number        // mean of upper triangle
  correlationZScore: number     // vs historical avg correlation
  correlationPercentile: number // 0–100

  // ── Volatility regime ──
  avgComponentVol: number       // mean of component realized vols
  impliedIndexVol: number       // theoretical index vol (covariance model)
  realizedIndexVol: number      // actual basket realized vol
  volSpread: number             // avgComponentVol - realizedIndexVol → realized dispersion premium
  volRegime: 'squeeze' | 'normal' | 'expansion'
  volZScore: number             // volSpread z-score

  // ── Breadth & participation ──
  pctUp: number                 // % components with positive 1d return
  pctAboveEma20: number         // % above 20-bar EMA
  pctAboveEma50: number         // % above 50-bar EMA
  advanceDeclineRatio: number   // advances / declines
  participationScore: number    // 0–100 composite

  // ── Regime ──
  regime: DispersionRegime
  regimeConfidence: number      // 0–100

  // ── Smart money / institutional ──
  basketReturn: number          // equal-weight basket return
  medianReturn: number          // median component return
  indexVsMedianDivergence: number  // basket - median (hidden leader/lagger)
  hiddenStrength: boolean       // breadth rising while basket flat/down
  hiddenWeakness: boolean       // breadth falling while basket up
  smartMoneyBias: 'accumulation' | 'distribution' | 'neutral'
  distributionScore: number     // 0–100 (high = institutional distribution)
  accumulationScore: number     // 0–100

  // ── Summary scores ──
  riskOnScore: number           // 0–100 (100 = strong risk-on)
  overallBias: 'bullish' | 'bearish' | 'neutral'
  overallScore: number          // -100 to +100
}

// ─── Historical series for charts ────────────────────────────────────────────
export interface DispersionHistory {
  timestamps: number[]
  dispersion: number[]
  avgCorrelation: number[]
  pctUp: number[]
  volSpread: number[]
  riskOnScore: number[]
}

// ─── Alert thresholds ────────────────────────────────────────────────────────
export interface DispersionAlertConfig {
  dispersionExpansion: number    // z-score threshold
  correlationCollapse: number    // avgCorrelation drop threshold
  participationFailure: number   // pctUp below this
  hiddenWeaknessConfirm: boolean
  regimeShift: boolean
}

// ─── Preset baskets ──────────────────────────────────────────────────────────
export const CRYPTO_BASKET: AssetConfig[] = [
  { symbol: 'BTCUSDT', label: 'BTC', sector: 'store-of-value' },
  { symbol: 'ETHUSDT', label: 'ETH', sector: 'smart-contract' },
  { symbol: 'SOLUSDT', label: 'SOL', sector: 'smart-contract' },
  { symbol: 'BNBUSDT', label: 'BNB', sector: 'exchange' },
  { symbol: 'XRPUSDT', label: 'XRP', sector: 'payments' },
  { symbol: 'ADAUSDT', label: 'ADA', sector: 'smart-contract' },
  { symbol: 'AVAXUSDT', label: 'AVAX', sector: 'smart-contract' },
  { symbol: 'DOGEUSDT', label: 'DOGE', sector: 'meme' },
]

export const DEFI_BASKET: AssetConfig[] = [
  { symbol: 'UNIUSDT', label: 'UNI', sector: 'dex' },
  { symbol: 'AAVEUSDT', label: 'AAVE', sector: 'lending' },
  { symbol: 'CRVUSDT', label: 'CRV', sector: 'dex' },
  { symbol: 'MKRUSDT', label: 'MKR', sector: 'lending' },
  { symbol: 'COMPUSDT', label: 'COMP', sector: 'lending' },
  { symbol: 'SUSHIUSDT', label: 'SUSHI', sector: 'dex' },
]

export const L2_BASKET: AssetConfig[] = [
  { symbol: 'MATICUSDT', label: 'MATIC', sector: 'l2' },
  { symbol: 'ARBUSDT', label: 'ARB', sector: 'l2' },
  { symbol: 'OPUSDT', label: 'OP', sector: 'l2' },
]
