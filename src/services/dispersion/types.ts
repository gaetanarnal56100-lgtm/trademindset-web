// Dispersion Analysis Engine — Types
// Institutional-grade market internals analysis

export interface AssetConfig {
  symbol: string
  label: string
  weight?: number
  sector?: string
}

export interface RawCandle {
  t: number; o: number; h: number; l: number; c: number; v: number
}

// ─── Per-component snapshot ──────────────────────────────────────────────────
export interface ComponentSnapshot {
  symbol: string
  label: string
  return1d: number
  return5d: number
  realizedVol: number          // annualized realized vol (20-bar)
  rsi14: number
  aboveEma20: boolean
  aboveEma50: boolean
  aboveVwap: boolean
  zScore: number               // return z-score vs own history
  momentum: number             // EMA(return, 5)
  divergenceFromBasket: number // component return - basket return
  // ── New institutional fields ──
  hurstExponent: number        // H: 0.5=random, >0.5=trend, <0.5=mean-rev
  autocorr: number             // lag-1 autocorrelation of returns
  meanReversionScore: number   // 0–100: how overextended vs basket mean
  contributionPct: number      // weight * return1d (contribution to basket)
  sharpeLike: number           // return1d / realizedVol (daily Sharpe proxy)
  rank: number                 // 1 = best return in basket
}

// ─── Core result ─────────────────────────────────────────────────────────────
export type DispersionRegime =
  | 'compression'  // Low dispersion, high correlation — macro-driven
  | 'expansion'    // High dispersion, low correlation — stock-picking
  | 'panic'        // High dispersion + high vol + low breadth
  | 'trending'     // Low dispersion, directional, high breadth
  | 'rotating'     // Medium dispersion, sector rotation
  | 'unknown'

export interface TradeSignal {
  action: 'dispersion' | 'momentum' | 'neutral'
  direction: 'buy_laggards' | 'buy_leaders' | 'neutral'
  score: number        // 0–100
  confidence: number   // 0–100
  reasoning: string[]
  topLongs: string[]   // asset labels
  topShorts: string[]
}

export interface InlineHistory {
  timestamps: number[]
  dispersion: number[]
  avgCorrelation: number[]
  pctUp: number[]
  volSpread: number[]
  regimes: DispersionRegime[]
}

export interface TrendArrows {
  dispersion: '↑' | '↓' | '→'
  correlation: '↑' | '↓' | '→'
  breadth: '↑' | '↓' | '→'
  volSpread: '↑' | '↓' | '→'
}

export interface DispersionResult {
  timestamp: number
  components: ComponentSnapshot[]

  // ── Cross-sectional dispersion ──
  dispersionRaw: number
  dispersionMA: number
  dispersionStd: number
  dispersionZScore: number
  dispersionPercentile: number

  // ── Correlation ──
  correlationMatrix: number[][]
  avgCorrelation: number
  correlationZScore: number
  correlationPercentile: number

  // ── Volatility regime ──
  avgComponentVol: number
  impliedIndexVol: number
  realizedIndexVol: number
  volSpread: number
  volRegime: 'squeeze' | 'normal' | 'expansion'
  volZScore: number

  // ── Breadth ──
  pctUp: number
  pctAboveEma20: number
  pctAboveEma50: number
  advanceDeclineRatio: number
  participationScore: number

  // ── Regime ──
  regime: DispersionRegime
  regimeConfidence: number

  // ── Smart money ──
  basketReturn: number
  medianReturn: number
  indexVsMedianDivergence: number
  hiddenStrength: boolean
  hiddenWeakness: boolean
  smartMoneyBias: 'accumulation' | 'distribution' | 'neutral'
  distributionScore: number
  accumulationScore: number

  // ── New: Basket-level quant metrics ──
  basketHurst: number          // H exponent on basket return series
  basketAutocorr: number       // lag-1 autocorrelation on basket
  crossSectionalMomentum: number // top quartile return - bottom quartile return
  returnKurtosis: number       // excess kurtosis of component returns
  returnSkew: number           // skewness of component returns

  // ── New: Synthesized trade signal ──
  tradeSignal: TradeSignal

  // ── New: Rolling history (computed inline from candle slices) ──
  history: InlineHistory

  // ── New: Trend arrows (direction of change vs recent history) ──
  trendArrows: TrendArrows

  // ── Summary ──
  riskOnScore: number
  overallBias: 'bullish' | 'bearish' | 'neutral'
  overallScore: number
}

// ─── Alert thresholds ────────────────────────────────────────────────────────
export interface DispersionAlertConfig {
  dispersionExpansion: number
  correlationCollapse: number
  participationFailure: number
  hiddenWeaknessConfirm: boolean
  regimeShift: boolean
}

// ─── Historical series (external) ────────────────────────────────────────────
export interface DispersionHistory {
  timestamps: number[]
  dispersion: number[]
  avgCorrelation: number[]
  pctUp: number[]
  volSpread: number[]
  riskOnScore: number[]
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
