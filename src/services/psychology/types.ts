// src/services/psychology/types.ts
// Interfaces for the Behavioral Analysis Engine

import type { EmotionalState, MoodContext } from '@/services/firestore'

// ── Enhanced Emotion Log ────────────────────────────────────────────────────
export interface EnhancedEmotionLog {
  id: string
  emotionalState: EmotionalState
  intensity: number                    // 1–10
  timestamp: Date
  context: MoodContext
  tags: string[]
  isExceptional: boolean
  tradeId?: string
  notes?: string

  // Enhanced fields
  physicalState?: 'rested' | 'tired' | 'very_tired'
  marketState?: 'trending' | 'ranging' | 'volatile' | 'calm'
  sessionDuration?: number             // minutes since start of trading session
  consecutiveLosses?: number           // losses in a row before this log
  consecutiveWins?: number             // wins in a row before this log
  isRevengeTrade?: boolean
  sizeDeviation?: number               // % deviation from normal size (0 = normal)
  timeInTrade?: number                 // minutes
  tradeContext?: 'breakout' | 'reversal' | 'continuation' | 'scalp' | 'swing'
}

// ── Behavioral Patterns ─────────────────────────────────────────────────────
export type PatternType =
  | 'revenge_trading'
  | 'tilt_cycle'
  | 'overconfidence'
  | 'fear_hesitation'
  | 'size_escalation'
  | 'emotional_spiral'
  | 'recovery_sequence'

export type PatternSeverity = 'low' | 'medium' | 'high' | 'critical'

export interface BehavioralPattern {
  type: PatternType
  severity: PatternSeverity
  detectedAt: Date
  evidence: {
    tradeIds: string[]
    moodIds: string[]
    description: string
  }
  metrics: Record<string, number>
  recommendation: string
  isActive: boolean                    // currently happening vs historical
}

// ── Performance Segment ──────────────────────────────────────────────────────
export interface PerformanceSegment {
  emotion: EmotionalState
  intensity: 'low' | 'medium' | 'high'   // 1-4, 5-7, 8-10
  context?: MoodContext
  marketState?: string
  physicalState?: string
  sampleSize: number
  avgPnL: number
  winRate: number
  avgRR: number                        // avg risk/reward
  volatility: number                   // std dev of PnL
  correlation: number                  // Pearson with performance
  significanceP: number                // p-value (< 0.05 = significant)
  isSignificant: boolean
}

// ── Optimal Emotional Zone ───────────────────────────────────────────────────
export interface OptimalZone {
  emotion: EmotionalState
  intensityMin: number
  intensityMax: number
  avgPnL: number
  winRate: number
  sampleSize: number
  confidence: 'low' | 'medium' | 'high'
  label: string                        // e.g. "Optimal zone for confident"
}

// ── Psychology Scores ────────────────────────────────────────────────────────
export interface PsychologyScore {
  // Emotional Discipline Score: do you trade consistently at your best emotional state?
  eds: number                          // 0–100
  edsLabel: 'poor' | 'developing' | 'good' | 'excellent'

  // Stability: standard deviation of emotional states before trades
  stability: number                    // 0–100
  stabilityLabel: 'volatile' | 'moderate' | 'stable' | 'very_stable'

  // Stress Performance: how well you trade under pressure
  stressPerformance: number            // 0–100
  stressPerformanceLabel: 'collapses' | 'degrades' | 'holds' | 'thrives'

  // Consistency: repeatability of good states over time
  consistency: number                  // 0–100
  consistencyLabel: 'erratic' | 'developing' | 'consistent' | 'highly_consistent'

  // Overall composite
  overall: number                      // 0–100
  overallLabel: string

  // Trend vs last period
  edsTrend: number                     // delta vs previous 30 days
  stabilityTrend: number
  stressPerformanceTrend: number
  consistencyTrend: number
  overallTrend: number

  computedAt: Date
}

// ── Coaching Alert ───────────────────────────────────────────────────────────
export type CoachingAlertType =
  | 'tilt_warning'
  | 'revenge_risk'
  | 'overconfidence_risk'
  | 'size_warning'
  | 'cooldown_recommended'
  | 'optimal_state'
  | 'recovery_detected'

export interface CoachingAlert {
  type: CoachingAlertType
  severity: PatternSeverity
  title: string
  message: string
  action?: string                      // specific actionable step
  cooldownMinutes?: number             // recommended break duration
  sizeMultiplier?: number              // recommended position size multiplier
  expiresAt?: Date                     // when this alert is no longer relevant
}

// ── Insight ──────────────────────────────────────────────────────────────────
export interface TradingInsight {
  id: string
  type: 'performance' | 'pattern' | 'correlation' | 'optimal_zone' | 'warning'
  title: string
  description: string
  impact: 'positive' | 'negative' | 'neutral'
  magnitude: number                    // 0–1, how strong the finding is
  evidence: string[]
  recommendation?: string
  detectedAt: Date
  isNew: boolean                       // detected in last 7 days
}

// ── Markov Chain Transition ──────────────────────────────────────────────────
export interface EmotionalTransition {
  from: EmotionalState
  to: EmotionalState
  count: number
  probability: number
  avgPnLAfter: number                  // average PnL on trades after this transition
}

// ── Full Analysis Report ─────────────────────────────────────────────────────
export interface BehavioralReport {
  userId: string
  computedAt: Date
  periodDays: number
  sampleSize: number

  psychologyScore: PsychologyScore
  segments: PerformanceSegment[]
  patterns: BehavioralPattern[]
  optimalZones: OptimalZone[]
  insights: TradingInsight[]
  transitions: EmotionalTransition[]
  coachingAlerts: CoachingAlert[]
}
