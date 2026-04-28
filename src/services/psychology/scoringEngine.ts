// src/services/psychology/scoringEngine.ts
// Calculates psychology scores: EDS, Stability, Stress Performance, Consistency

import type { MoodEntry, Trade, EmotionalState } from '@/services/firestore'
import { tradePnL } from '@/services/firestore'
import type { PsychologyScore, PerformanceSegment, OptimalZone } from './types'

// ── Constants ────────────────────────────────────────────────────────────────
const POSITIVE_EMOTIONS: EmotionalState[] = ['confident', 'calm', 'focused']
const NEGATIVE_EMOTIONS: EmotionalState[] = ['stressed', 'fearful', 'frustrated', 'impatient']
const HIGH_STRESS_EMOTIONS: EmotionalState[] = ['stressed', 'fearful', 'frustrated']

const EMOTION_SCORE: Record<EmotionalState, number> = {
  confident: 5, calm: 4.5, focused: 5, excited: 3.5,
  stressed: 2, impatient: 2, fearful: 1, greedy: 2.5,
  frustrated: 1.5, distracted: 2.5,
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n < 3) return 0
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  const cov = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / n
  const sdx = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) / n)
  const sdy = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0) / n)
  if (sdx === 0 || sdy === 0) return 0
  return Math.max(-1, Math.min(1, cov / (sdx * sdy)))
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length)
}

function clamp0100(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)))
}

function moodBeforeTrade(trade: Trade, moods: MoodEntry[]): MoodEntry | null {
  const tt = trade.date.getTime()
  let best: MoodEntry | null = null
  let bestDelta = Infinity
  for (const m of moods) {
    const delta = tt - m.timestamp.getTime()
    if (delta >= 0 && delta < 4 * 3600_000 && delta < bestDelta) {
      bestDelta = delta
      best = m
    }
  }
  return best
}

// ── EDS: Emotional Discipline Score ─────────────────────────────────────────
/**
 * Measures: when you trade, how often are you in a "good" emotional state?
 * Considers intensity-weighted positiveness.
 * 100 = always calm/confident/focused, 0 = always stressed/fearful at max intensity
 */
export function calculateEDS(trades: Trade[], moods: MoodEntry[]): number {
  const pairs: { score: number; intensity: number }[] = []
  for (const t of trades) {
    const m = moodBeforeTrade(t, moods)
    if (!m) continue
    pairs.push({ score: EMOTION_SCORE[m.emotionalState] ?? 3, intensity: m.intensity })
  }
  if (pairs.length === 0) return 50  // neutral when no data

  // Weighted average (intensity weights more extreme states)
  const weightedScore = pairs.reduce((s, p) => s + p.score * (p.intensity / 10), 0)
  const totalWeight = pairs.reduce((s, p) => s + (p.intensity / 10), 0)
  const avg = weightedScore / totalWeight  // range 1–5

  return clamp0100(((avg - 1) / 4) * 100)
}

// ── Stability Score ──────────────────────────────────────────────────────────
/**
 * Measures: how consistent/predictable your emotional state is before trades.
 * Low std dev of emotion scores = high stability.
 */
export function calculateStability(trades: Trade[], moods: MoodEntry[]): number {
  const scores: number[] = []
  for (const t of trades) {
    const m = moodBeforeTrade(t, moods)
    if (m) scores.push(EMOTION_SCORE[m.emotionalState] ?? 3)
  }
  if (scores.length < 3) return 50

  const sd = stdDev(scores)
  // sd range is roughly 0 (perfect stability) to 2 (high volatility)
  return clamp0100(100 - (sd / 2) * 100)
}

// ── Stress Performance ───────────────────────────────────────────────────────
/**
 * Measures: how well you trade under high-stress emotions compared to calm.
 * = stressPnL / calmPnL as a ratio, normalized.
 */
export function calculateStressPerformance(trades: Trade[], moods: MoodEntry[]): number {
  const stressResults: number[] = []
  const calmResults: number[] = []

  for (const t of trades) {
    const m = moodBeforeTrade(t, moods)
    if (!m) continue
    const pnl = tradePnL(t)
    if (HIGH_STRESS_EMOTIONS.includes(m.emotionalState)) {
      stressResults.push(pnl)
    } else if (POSITIVE_EMOTIONS.includes(m.emotionalState)) {
      calmResults.push(pnl)
    }
  }

  if (stressResults.length < 3 || calmResults.length < 3) return 50

  const avgStress = stressResults.reduce((a, b) => a + b, 0) / stressResults.length
  const avgCalm = calmResults.reduce((a, b) => a + b, 0) / calmResults.length

  if (avgCalm === 0) return 50

  // Ratio of stress performance to calm performance
  const ratio = avgStress / Math.abs(avgCalm)
  // ratio 1.0 = performs as well under stress = score 100
  // ratio 0.0 = zero performance under stress = score 50
  // ratio -1.0 = loses under stress = score 0
  return clamp0100(50 + ratio * 50)
}

// ── Consistency Score ────────────────────────────────────────────────────────
/**
 * Measures: week-over-week consistency in being in positive states.
 * Low variance across weeks = high consistency.
 */
export function calculateConsistency(moods: MoodEntry[]): number {
  if (moods.length < 10) return 50

  // Group by week
  const weekMap: Record<number, number[]> = {}
  for (const m of moods) {
    const week = Math.floor(m.timestamp.getTime() / (7 * 86_400_000))
    if (!weekMap[week]) weekMap[week] = []
    const isPositive = POSITIVE_EMOTIONS.includes(m.emotionalState) ? 1 : 0
    weekMap[week].push(isPositive)
  }

  const weeks = Object.values(weekMap)
  if (weeks.length < 2) return 50

  const weekRates = weeks.map(w => w.reduce((a, b) => a + b, 0) / w.length)
  const sd = stdDev(weekRates)

  // sd range 0–0.5 for weekly consistency
  return clamp0100(100 - sd * 200)
}

// ── Composite Score ──────────────────────────────────────────────────────────
export function computePsychologyScore(
  trades: Trade[],
  moods: MoodEntry[],
  prevTrades?: Trade[],
  prevMoods?: MoodEntry[],
): PsychologyScore {
  const eds = calculateEDS(trades, moods)
  const stability = calculateStability(trades, moods)
  const stressPerformance = calculateStressPerformance(trades, moods)
  const consistency = calculateConsistency(moods)

  const overall = Math.round((eds * 0.35 + stability * 0.2 + stressPerformance * 0.25 + consistency * 0.2))

  // Trends
  let edsTrend = 0, stabilityTrend = 0, stressPerformanceTrend = 0, consistencyTrend = 0, overallTrend = 0
  if (prevTrades && prevMoods && prevMoods.length > 0) {
    edsTrend = eds - calculateEDS(prevTrades, prevMoods)
    stabilityTrend = stability - calculateStability(prevTrades, prevMoods)
    stressPerformanceTrend = stressPerformance - calculateStressPerformance(prevTrades, prevMoods)
    consistencyTrend = consistency - calculateConsistency(prevMoods)
    overallTrend = overall - Math.round(
      (calculateEDS(prevTrades, prevMoods) * 0.35 +
       calculateStability(prevTrades, prevMoods) * 0.2 +
       calculateStressPerformance(prevTrades, prevMoods) * 0.25 +
       calculateConsistency(prevMoods) * 0.2)
    )
  }

  return {
    eds,
    edsLabel: eds >= 75 ? 'excellent' : eds >= 55 ? 'good' : eds >= 35 ? 'developing' : 'poor',
    stability,
    stabilityLabel: stability >= 80 ? 'very_stable' : stability >= 60 ? 'stable' : stability >= 40 ? 'moderate' : 'volatile',
    stressPerformance,
    stressPerformanceLabel: stressPerformance >= 75 ? 'thrives' : stressPerformance >= 55 ? 'holds' : stressPerformance >= 35 ? 'degrades' : 'collapses',
    consistency,
    consistencyLabel: consistency >= 80 ? 'highly_consistent' : consistency >= 60 ? 'consistent' : consistency >= 40 ? 'developing' : 'erratic',
    overall,
    overallLabel: overall >= 80 ? 'Elite Mindset' : overall >= 65 ? 'Strong Discipline' : overall >= 50 ? 'Developing' : overall >= 35 ? 'Needs Work' : 'At Risk',
    edsTrend,
    stabilityTrend,
    stressPerformanceTrend,
    consistencyTrend,
    overallTrend,
    computedAt: new Date(),
  }
}

// ── Performance Segmentation ─────────────────────────────────────────────────
/**
 * For each (emotion × intensity bucket), compute avg PnL, win rate, correlation.
 * This is the conditional correlation — not global.
 */
export function computePerformanceSegments(trades: Trade[], moods: MoodEntry[]): PerformanceSegment[] {
  type Key = string
  const map: Record<Key, { pnls: number[]; emotion: EmotionalState; intensity: 'low' | 'medium' | 'high'; context?: string }> = {}

  for (const t of trades) {
    const m = moodBeforeTrade(t, moods)
    if (!m) continue
    const pnl = tradePnL(t)
    const intensityBucket: 'low' | 'medium' | 'high' =
      m.intensity <= 4 ? 'low' : m.intensity <= 7 ? 'medium' : 'high'
    const key: Key = `${m.emotionalState}__${intensityBucket}`
    if (!map[key]) map[key] = { pnls: [], emotion: m.emotionalState, intensity: intensityBucket }
    map[key].pnls.push(pnl)
  }

  const segments: PerformanceSegment[] = []

  for (const [, seg] of Object.entries(map)) {
    if (seg.pnls.length < 3) continue
    const n = seg.pnls.length
    const avgPnL = seg.pnls.reduce((a, b) => a + b, 0) / n
    const winRate = seg.pnls.filter(p => p > 0).length / n
    const vol = stdDev(seg.pnls)

    // Pearson correlation: emotion_score vs pnl
    const emScore = EMOTION_SCORE[seg.emotion] ?? 3
    const xs = seg.pnls.map(() => emScore)  // constant → use intensity
    const intNums = seg.pnls.map((_, i) => {
      const idx = Object.values(map).indexOf(seg)
      return idx >= 0 ? [1, 5, 9][['low', 'medium', 'high'].indexOf(seg.intensity)] : 5
    })
    const corr = pearson(intNums, seg.pnls)

    // Simple t-test approximation for significance
    const tStat = (corr * Math.sqrt(n - 2)) / Math.sqrt(1 - corr ** 2 + 1e-10)
    const pValue = Math.exp(-Math.abs(tStat) * 0.7)  // rough approximation

    segments.push({
      emotion: seg.emotion,
      intensity: seg.intensity,
      sampleSize: n,
      avgPnL,
      winRate,
      avgRR: winRate > 0 && winRate < 1 ? (avgPnL / (seg.pnls.filter(p => p < 0).length > 0 ? Math.abs(seg.pnls.filter(p => p < 0).reduce((a, b) => a + b, 0) / seg.pnls.filter(p => p < 0).length) : 1)) : 0,
      volatility: vol,
      correlation: corr,
      significanceP: pValue,
      isSignificant: pValue < 0.05 && n >= 5,
    })
  }

  return segments.sort((a, b) => b.avgPnL - a.avgPnL)
}

// ── Optimal Zone Calculator ──────────────────────────────────────────────────
export function computeOptimalZones(trades: Trade[], moods: MoodEntry[]): OptimalZone[] {
  type ZoneKey = string
  const map: Record<ZoneKey, { pnls: number[]; emotion: EmotionalState; intensities: number[] }> = {}

  for (const t of trades) {
    const m = moodBeforeTrade(t, moods)
    if (!m) continue
    const key: ZoneKey = m.emotionalState
    if (!map[key]) map[key] = { pnls: [], emotion: m.emotionalState, intensities: [] }
    map[key].pnls.push(tradePnL(t))
    map[key].intensities.push(m.intensity)
  }

  const zones: OptimalZone[] = []

  for (const [, z] of Object.entries(map)) {
    if (z.pnls.length < 3) continue
    const n = z.pnls.length
    const avgPnL = z.pnls.reduce((a, b) => a + b, 0) / n
    const winRate = z.pnls.filter(p => p > 0).length / n

    // Find intensity range that maximizes win rate
    const paired = z.pnls.map((pnl, i) => ({ pnl, int: z.intensities[i] }))
    const sorted = [...paired].sort((a, b) => a.int - b.int)

    let bestWr = 0, bestMin = 1, bestMax = 10
    for (let lo = 1; lo <= 8; lo++) {
      for (let hi = lo + 2; hi <= 10; hi++) {
        const slice = sorted.filter(p => p.int >= lo && p.int <= hi)
        if (slice.length < 2) continue
        const wr = slice.filter(p => p.pnl > 0).length / slice.length
        if (wr > bestWr) { bestWr = wr; bestMin = lo; bestMax = hi }
      }
    }

    const confidence: OptimalZone['confidence'] =
      n >= 15 ? 'high' : n >= 7 ? 'medium' : 'low'

    zones.push({
      emotion: z.emotion,
      intensityMin: bestMin,
      intensityMax: bestMax,
      avgPnL,
      winRate,
      sampleSize: n,
      confidence,
      label: `${z.emotion} intensity ${bestMin}–${bestMax}`,
    })
  }

  return zones.sort((a, b) => b.winRate - a.winRate)
}

// ── Emotional Transitions ────────────────────────────────────────────────────
export function computeTransitions(moods: MoodEntry[], trades: Trade[]) {
  const sorted = [...moods].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  const map: Record<string, { count: number; pnls: number[] }> = {}

  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i].emotionalState
    const to = sorted[i + 1].emotionalState
    const key = `${from}→${to}`
    if (!map[key]) map[key] = { count: 0, pnls: [] }
    map[key].count++

    // Find trade in window between the two moods
    const t1 = sorted[i].timestamp.getTime()
    const t2 = sorted[i + 1].timestamp.getTime()
    const tradesInWindow = trades.filter(t => {
      const ts = t.date.getTime()
      return ts >= t1 && ts <= t2 + 3_600_000
    })
    tradesInWindow.forEach(t => map[key].pnls.push(tradePnL(t)))
  }

  const total = Object.values(map).reduce((s, v) => s + v.count, 0)

  return Object.entries(map).map(([key, v]) => {
    const [from, to] = key.split('→') as [EmotionalState, EmotionalState]
    return {
      from,
      to,
      count: v.count,
      probability: v.count / (total || 1),
      avgPnLAfter: v.pnls.length > 0 ? v.pnls.reduce((a, b) => a + b, 0) / v.pnls.length : 0,
    }
  }).sort((a, b) => b.count - a.count)
}
