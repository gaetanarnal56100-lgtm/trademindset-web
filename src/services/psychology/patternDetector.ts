// src/services/psychology/patternDetector.ts
// Detects behavioral anti-patterns from trade + mood sequences

import type { MoodEntry, Trade, EmotionalState } from '@/services/firestore'
import { tradePnL } from '@/services/firestore'
import type { BehavioralPattern, PatternSeverity } from './types'

// ── Helpers ─────────────────────────────────────────────────────────────────

function severity(score: number): PatternSeverity {
  if (score >= 0.8) return 'critical'
  if (score >= 0.6) return 'high'
  if (score >= 0.3) return 'medium'
  return 'low'
}

/** Returns trades sorted by date ascending */
function sortedTrades(trades: Trade[]): Trade[] {
  return [...trades].sort((a, b) => a.date.getTime() - b.date.getTime())
}

/** Returns moods sorted by timestamp ascending */
function sortedMoods(moods: MoodEntry[]): MoodEntry[] {
  return [...moods].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
}

/** Find the mood entry closest in time before a trade */
function moodBeforeTrade(trade: Trade, moods: MoodEntry[]): MoodEntry | null {
  const tradeTime = trade.date.getTime()
  let best: MoodEntry | null = null
  let bestDelta = Infinity
  for (const m of moods) {
    const delta = tradeTime - m.timestamp.getTime()
    if (delta >= 0 && delta < bestDelta) {
      bestDelta = delta
      best = m
    }
  }
  // Only consider moods within 4 hours before the trade
  return best && bestDelta < 4 * 3600_000 ? best : null
}

// ── 1. Revenge Trading ───────────────────────────────────────────────────────
/**
 * Detects when: losing trade → high-stress emotion → next trade (same day)
 * Signals: short inter-trade gap, possibly larger size, after loss
 */
export function detectRevengeTrading(trades: Trade[], moods: MoodEntry[]): BehavioralPattern[] {
  const patterns: BehavioralPattern[] = []
  const sorted = sortedTrades(trades)
  const REVENGE_EMOTIONS: EmotionalState[] = ['frustrated', 'stressed', 'greedy', 'impatient']
  const MAX_GAP_MS = 90 * 60_000  // 90 minutes
  const MIN_EVENTS = 2

  const revengeEvents: { tradeId: string; moodId: string; ts: Date }[] = []

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    const prevPnL = tradePnL(prev)
    if (prevPnL >= 0) continue  // only after losses

    const gap = curr.date.getTime() - (prev.closedAt?.getTime() ?? prev.date.getTime())
    if (gap > MAX_GAP_MS || gap < 0) continue

    const prevMood = moodBeforeTrade(curr, moods)
    if (!prevMood) continue
    if (!REVENGE_EMOTIONS.includes(prevMood.emotionalState)) continue

    revengeEvents.push({ tradeId: curr.id, moodId: prevMood.id, ts: curr.date })
  }

  if (revengeEvents.length < MIN_EVENTS) return patterns

  const score = Math.min(revengeEvents.length / 5, 1)
  const recent = revengeEvents.slice(-3)
  const isActive = recent.length > 0 &&
    Date.now() - recent[recent.length - 1].ts.getTime() < 7 * 86_400_000

  patterns.push({
    type: 'revenge_trading',
    severity: severity(score),
    detectedAt: new Date(),
    evidence: {
      tradeIds: revengeEvents.map(e => e.tradeId),
      moodIds: revengeEvents.map(e => e.moodId),
      description: `${revengeEvents.length} instance(s) of trading quickly after a loss while in a stressed/frustrated state.`,
    },
    metrics: {
      occurrences: revengeEvents.length,
      avgGapMinutes: MAX_GAP_MS / 60_000,
      score,
    },
    recommendation: 'Apply a 90-minute cooling-off rule after any loss. Log your mood — if you feel frustrated/angry, skip the next trade.',
    isActive,
  })

  return patterns
}

// ── 2. Tilt Cycle ────────────────────────────────────────────────────────────
/**
 * Detects: escalating loss streak → increasingly negative emotional states
 * Markov: frustrated → stressed → fearful (or greedy for revenge) cascade
 */
export function detectTiltCycle(trades: Trade[], moods: MoodEntry[]): BehavioralPattern[] {
  const patterns: BehavioralPattern[] = []
  const sorted = sortedTrades(trades)
  const TILT_SEQUENCE: EmotionalState[] = ['frustrated', 'stressed', 'fearful', 'impatient']

  // Find consecutive loss streaks of 3+
  const streaks: { trades: Trade[]; moods: MoodEntry[] }[] = []
  let streak: Trade[] = []
  for (const t of sorted) {
    if (tradePnL(t) < 0) {
      streak.push(t)
    } else {
      if (streak.length >= 3) {
        const moodsInStreak = moods.filter(m => {
          const ts = m.timestamp.getTime()
          return ts >= streak[0].date.getTime() && ts <= streak[streak.length - 1].date.getTime() + 3_600_000
        })
        streaks.push({ trades: [...streak], moods: moodsInStreak })
      }
      streak = []
    }
  }
  if (streak.length >= 3) {
    const moodsInStreak = moods.filter(m => {
      const ts = m.timestamp.getTime()
      return ts >= streak[0].date.getTime() && ts <= streak[streak.length - 1].date.getTime() + 3_600_000
    })
    streaks.push({ trades: streak, moods: moodsInStreak })
  }

  if (streaks.length === 0) return patterns

  let tiltCount = 0
  for (const s of streaks) {
    const tiltMoods = s.moods.filter(m => TILT_SEQUENCE.includes(m.emotionalState))
    if (tiltMoods.length >= 2) tiltCount++
  }

  if (tiltCount === 0) return patterns

  const score = Math.min(tiltCount / 3, 1)
  const lastStreak = streaks[streaks.length - 1]
  const isActive = Date.now() - (lastStreak.trades[lastStreak.trades.length - 1].date.getTime()) < 3 * 86_400_000

  patterns.push({
    type: 'tilt_cycle',
    severity: severity(score),
    detectedAt: new Date(),
    evidence: {
      tradeIds: streaks.flatMap(s => s.trades.map(t => t.id)),
      moodIds: streaks.flatMap(s => s.moods.map(m => m.id)),
      description: `${tiltCount} tilt cycle(s) detected — loss streaks paired with escalating negative emotions.`,
    },
    metrics: {
      tiltCycles: tiltCount,
      longestStreak: Math.max(...streaks.map(s => s.trades.length)),
      score,
    },
    recommendation: 'Set a hard daily loss limit (e.g. -3R). After 3 consecutive losses, mandatory session end regardless of how you feel.',
    isActive,
  })

  return patterns
}

// ── 3. Overconfidence ────────────────────────────────────────────────────────
/**
 * Detects: win streak → confident/excited at high intensity → outsized positions or excessive trades
 */
export function detectOverconfidence(trades: Trade[], moods: MoodEntry[]): BehavioralPattern[] {
  const patterns: BehavioralPattern[] = []
  const sorted = sortedTrades(trades)
  const CONFIDENCE_EMOTIONS: EmotionalState[] = ['confident', 'excited', 'greedy']

  // Find win streaks of 4+
  const streaks: Trade[][] = []
  let streak: Trade[] = []
  for (const t of sorted) {
    if (tradePnL(t) > 0) {
      streak.push(t)
    } else {
      if (streak.length >= 4) streaks.push([...streak])
      streak = []
    }
  }
  if (streak.length >= 4) streaks.push(streak)

  if (streaks.length === 0) return patterns

  let overconfEvents = 0
  for (const s of streaks) {
    const endTime = s[s.length - 1].date.getTime()
    const moodsAfter = moods.filter(m => {
      const ts = m.timestamp.getTime()
      return ts >= endTime && ts <= endTime + 86_400_000
    })
    const highConfidence = moodsAfter.some(m =>
      CONFIDENCE_EMOTIONS.includes(m.emotionalState) && m.intensity >= 7
    )
    if (highConfidence) overconfEvents++
  }

  if (overconfEvents === 0) return patterns

  const score = Math.min(overconfEvents / 3, 1)
  patterns.push({
    type: 'overconfidence',
    severity: severity(score),
    detectedAt: new Date(),
    evidence: {
      tradeIds: streaks.flatMap(s => s.map(t => t.id)),
      moodIds: [],
      description: `${overconfEvents} instance(s) of high confidence after win streaks — potential overconfidence risk.`,
    },
    metrics: {
      occurrences: overconfEvents,
      longestWinStreak: Math.max(...streaks.map(s => s.length)),
      score,
    },
    recommendation: 'After 4+ consecutive wins, reduce position size by 20% for the next 2 trades. Pride before a fall is real.',
    isActive: false,
  })

  return patterns
}

// ── 4. Fear Hesitation ───────────────────────────────────────────────────────
/**
 * Detects: fearful/distracted moods before trades → trades with smaller-than-average size,
 * or logs showing missed entries.
 */
export function detectFearHesitation(trades: Trade[], moods: MoodEntry[]): BehavioralPattern[] {
  const patterns: BehavioralPattern[] = []
  const FEAR_EMOTIONS: EmotionalState[] = ['fearful', 'distracted', 'stressed']

  const fearMoodsBeforeTrades = trades.filter(t => {
    const m = moodBeforeTrade(t, moods)
    return m && FEAR_EMOTIONS.includes(m.emotionalState) && m.intensity >= 6
  })

  if (fearMoodsBeforeTrades.length < 3) return patterns

  // Check if these trades have worse outcomes than average
  const allPnL = trades.map(tradePnL)
  const avgPnL = allPnL.reduce((a, b) => a + b, 0) / (allPnL.length || 1)
  const fearPnL = fearMoodsBeforeTrades.map(tradePnL)
  const avgFearPnL = fearPnL.reduce((a, b) => a + b, 0) / (fearPnL.length || 1)

  const pnlDegradation = avgPnL > 0 ? (avgPnL - avgFearPnL) / Math.abs(avgPnL) : 0
  if (pnlDegradation < 0.1) return patterns

  const score = Math.min(fearMoodsBeforeTrades.length / 6, 1)

  patterns.push({
    type: 'fear_hesitation',
    severity: severity(score),
    detectedAt: new Date(),
    evidence: {
      tradeIds: fearMoodsBeforeTrades.map(t => t.id),
      moodIds: [],
      description: `${fearMoodsBeforeTrades.length} trades preceded by fear/distraction at high intensity. PnL ${(pnlDegradation * 100).toFixed(0)}% worse than baseline.`,
    },
    metrics: {
      occurrences: fearMoodsBeforeTrades.length,
      pnlDegradation,
      avgFearPnL,
      avgBasePnL: avgPnL,
      score,
    },
    recommendation: 'When you log fear/distraction ≥6, skip the trade. Your data shows this state costs you money. Wait for calm or focused state.',
    isActive: false,
  })

  return patterns
}

// ── 5. Size Escalation ───────────────────────────────────────────────────────
/**
 * Detects systematic increases in position size after losses (over-compensating).
 */
export function detectSizeEscalation(trades: Trade[]): BehavioralPattern[] {
  const patterns: BehavioralPattern[] = []
  const sorted = sortedTrades(trades).filter(t => t.quantity != null && t.quantity > 0)
  if (sorted.length < 5) return patterns

  const sizes = sorted.map(t => (t.quantity ?? 0) * (t.entryPrice ?? 1))
  const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length

  // Look for size jumps > 2x average after consecutive losses
  let escalations = 0
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    if (tradePnL(prev) >= 0) continue

    const currSize = sizes[i]
    if (currSize > avgSize * 2) escalations++
  }

  if (escalations < 2) return patterns

  const score = Math.min(escalations / 4, 1)
  patterns.push({
    type: 'size_escalation',
    severity: severity(score),
    detectedAt: new Date(),
    evidence: {
      tradeIds: sorted.map(t => t.id),
      moodIds: [],
      description: `${escalations} instances of position size > 2× average after a losing trade.`,
    },
    metrics: { escalations, avgSize, score },
    recommendation: 'Never increase position size after a loss. Use a fixed % risk model. Losses should trigger -20% sizing, not +.',
    isActive: false,
  })

  return patterns
}

// ── Main Detector ────────────────────────────────────────────────────────────
export function detectAllPatterns(trades: Trade[], moods: MoodEntry[]): BehavioralPattern[] {
  const sortedM = sortedMoods(moods)
  return [
    ...detectRevengeTrading(trades, sortedM),
    ...detectTiltCycle(trades, sortedM),
    ...detectOverconfidence(trades, sortedM),
    ...detectFearHesitation(trades, sortedM),
    ...detectSizeEscalation(trades),
  ].sort((a, b) => {
    const order: Record<PatternSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    return order[a.severity] - order[b.severity]
  })
}
