// ── Types mirroring iOS Models/CoreModels.swift ──────────────────────────────

export type TradeDirection = 'long' | 'short'
export type TradeStatus    = 'open' | 'closed' | 'cancelled'
export type AssetType      = 'crypto' | 'forex' | 'stocks' | 'futures' | 'options' | 'other'
export type StorageMode    = 'firebase' | 'local'

export interface Trade {
  id:           string
  symbol:       string
  direction:    TradeDirection
  status:       TradeStatus
  assetType:    AssetType
  entryPrice:   number
  exitPrice?:   number
  quantity:     number
  leverage:     number
  fees:         number
  pnl?:         number
  pnlPercent?:  number
  riskReward?:  number
  entryDate:    Date
  exitDate?:    Date
  notes?:       string
  tags:         string[]
  systemId?:    string
  exchangeId?:  string
  emotion?:     EmotionType
  confidence?:  number       // 0–100
  userId:       string
  createdAt:    Date
  updatedAt:    Date
}

export type EmotionType =
  | 'calm'
  | 'confident'
  | 'anxious'
  | 'fearful'
  | 'greedy'
  | 'frustrated'
  | 'euphoric'
  | 'disciplined'

export interface MoodEntry {
  id:        string
  date:      Date
  emotion:   EmotionType
  intensity: number   // 0–10
  notes?:    string
  tradeId?:  string
  userId:    string
}

export interface Exchange {
  id:       string
  name:     string
  apiKey?:  string
  isActive: boolean
  userId:   string
}

export interface TradingSystem {
  id:          string
  name:        string
  description: string
  winRate?:    number
  riskReward?: number
  userId:      string
  createdAt:   Date
}

export type AlertSeverity = 'info' | 'normal' | 'high'
export type AlertSource   = 'tradingView' | 'custom' | 'other'

export interface Alert {
  id:            string
  createdAt:     Date
  symbol:        string
  exchange?:     string
  price?:        number
  message:       string
  severity:      AlertSeverity
  tags:          string[]
  payloadJSON:   string
  isRead:        boolean
  source:        AlertSource
  linkedTradeId?: string
  userId:        string
}

// ── Statistics (mirrors Statistics.swift) ────────────────────────────────────

export interface TradeStats {
  totalTrades:     number
  winningTrades:   number
  losingTrades:    number
  winRate:         number
  totalPnL:        number
  averagePnL:      number
  bestTrade:       number
  worstTrade:      number
  payoffRatio:     number
  expectancy:      number
  maxDrawdown:     number
  sharpeRatio:     number
  profitFactor:    number
  avgHoldTime:     number   // hours
  longsCount:      number
  shortsCount:     number
  longWinRate:     number
  shortWinRate:    number
  currentStreak:   number
  maxWinStreak:    number
  maxLossStreak:   number
}

// ── User / Auth ───────────────────────────────────────────────────────────────

export interface UserProfile {
  uid:         string
  email:       string
  displayName: string
  photoURL?:   string
  isPremium:   boolean
  language?:   string
  createdAt:   Date
}

// ── Market data ───────────────────────────────────────────────────────────────

export interface MarketPrice {
  symbol:    string
  price:     number
  change24h: number
  change24hPercent: number
  volume24h: number
  updatedAt: Date
}

export interface NewsItem {
  id:        string
  headline:  string
  summary:   string
  source:    string
  url:       string
  imageUrl?: string
  datetime:  Date
  category:  string
  sentiment?: 'positive' | 'negative' | 'neutral'
}

// ── AI Analysis ───────────────────────────────────────────────────────────────

export interface ChartAnalysis {
  id:           string
  imageUrl?:    string
  symbol:       string
  timeframe:    string
  trend:        'bullish' | 'bearish' | 'neutral'
  confidence:   number
  entryZone?:   [number, number]
  targetPrice?: number
  stopLoss?:    number
  riskReward?:  number
  analysis:     string
  signals:      AnalysisSignal[]
  createdAt:    Date
  userId:       string
}

export interface AnalysisSignal {
  type:        string
  value:       string
  confidence:  number
  description: string
}

// ── MTF Indicator ─────────────────────────────────────────────────────────────

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w'

export interface MTFReading {
  timeframe:   Timeframe
  wtSignal:    number
  rsiValue:    number
  vmcValue?:   number
  trend:       'bullish' | 'bearish' | 'neutral'
  updatedAt:   Date
}
