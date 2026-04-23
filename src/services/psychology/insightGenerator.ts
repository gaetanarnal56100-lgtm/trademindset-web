// src/services/psychology/insightGenerator.ts
// Automated insight & coaching alert generation

import type { MoodEntry, Trade, EmotionalState } from '@/services/firestore'
import { tradePnL } from '@/services/firestore'
import type {
  TradingInsight,
  CoachingAlert,
  BehavioralPattern,
  PerformanceSegment,
  OptimalZone,
  PsychologyScore,
} from './types'

let insightIdCounter = 0
function newId() { return `ins_${Date.now()}_${++insightIdCounter}` }

// ── Insight Generators ───────────────────────────────────────────────────────

export function generateSegmentInsights(segments: PerformanceSegment[]): TradingInsight[] {
  const insights: TradingInsight[] = []
  const now = new Date()

  // Best segment
  const best = segments.find(s => s.isSignificant && s.avgPnL > 0)
  if (best) {
    insights.push({
      id: newId(),
      type: 'optimal_zone',
      title: `✅ Best state: ${best.emotion} (${best.intensity} intensity)`,
      description: `When you trade in a ${best.emotion} state at ${best.intensity} intensity, your average PnL is ${best.avgPnL > 0 ? '+' : ''}${best.avgPnL.toFixed(1)} with a ${(best.winRate * 100).toFixed(0)}% win rate (${best.sampleSize} trades).`,
      impact: 'positive',
      magnitude: Math.min(best.winRate, 1),
      evidence: [`${best.sampleSize} trades`, `WR: ${(best.winRate * 100).toFixed(0)}%`, `Avg PnL: ${best.avgPnL.toFixed(1)}`],
      recommendation: `Prioritize entering trades only when you feel ${best.emotion} at ${best.intensity} intensity.`,
      detectedAt: now,
      isNew: true,
    })
  }

  // Worst segment
  const worst = [...segments].reverse().find(s => s.isSignificant && s.avgPnL < 0)
  if (worst) {
    insights.push({
      id: newId(),
      type: 'warning',
      title: `⚠️ Danger zone: ${worst.emotion} (${worst.intensity} intensity)`,
      description: `Trading while ${worst.emotion} at ${worst.intensity} intensity costs you an average of ${worst.avgPnL.toFixed(1)} per trade (${(worst.winRate * 100).toFixed(0)}% win rate, ${worst.sampleSize} trades). Avoid trading in this state.`,
      impact: 'negative',
      magnitude: Math.min(Math.abs(worst.avgPnL) / 100, 1),
      evidence: [`${worst.sampleSize} trades`, `WR: ${(worst.winRate * 100).toFixed(0)}%`, `Avg PnL: ${worst.avgPnL.toFixed(1)}`],
      recommendation: `When you feel ${worst.emotion} at ${worst.intensity} intensity, apply a mandatory 30-minute cooldown before entering.`,
      detectedAt: now,
      isNew: true,
    })
  }

  return insights
}

export function generatePatternInsights(patterns: BehavioralPattern[]): TradingInsight[] {
  return patterns.slice(0, 3).map(p => ({
    id: newId(),
    type: 'pattern' as const,
    title: formatPatternTitle(p.type),
    description: p.evidence.description,
    impact: 'negative' as const,
    magnitude: p.severity === 'critical' ? 1 : p.severity === 'high' ? 0.8 : p.severity === 'medium' ? 0.5 : 0.3,
    evidence: [
      `${p.evidence.tradeIds.length} affected trades`,
      `Severity: ${p.severity}`,
      p.isActive ? '🔴 Currently Active' : '⚪ Historical',
    ],
    recommendation: p.recommendation,
    detectedAt: new Date(),
    isNew: p.isActive,
  }))
}

function formatPatternTitle(type: BehavioralPattern['type']): string {
  const titles: Record<BehavioralPattern['type'], string> = {
    revenge_trading: '🔁 Revenge Trading Detected',
    tilt_cycle: '🌀 Tilt Cycle Detected',
    overconfidence: '📈 Overconfidence Risk',
    fear_hesitation: '😰 Fear-Hesitation Pattern',
    size_escalation: '📊 Dangerous Size Escalation',
    emotional_spiral: '🌪️ Emotional Spiral',
    recovery_sequence: '✨ Recovery Sequence',
  }
  return titles[type] ?? type
}

export function generateScoreInsights(score: PsychologyScore): TradingInsight[] {
  const insights: TradingInsight[] = []
  const now = new Date()

  if (score.eds < 40) {
    insights.push({
      id: newId(),
      type: 'performance',
      title: '📉 Low Emotional Discipline',
      description: `Your EDS score is ${score.eds}/100. You frequently trade in sub-optimal emotional states. This is your primary improvement area.`,
      impact: 'negative',
      magnitude: (100 - score.eds) / 100,
      evidence: [`EDS: ${score.eds}/100`],
      recommendation: 'Before every trade, log your mood. If it\'s not calm, focused, or confident — wait.',
      detectedAt: now,
      isNew: score.edsTrend < -5,
    })
  } else if (score.eds >= 75) {
    insights.push({
      id: newId(),
      type: 'performance',
      title: '🏆 Strong Emotional Discipline',
      description: `Your EDS score is ${score.eds}/100 — excellent! You consistently trade in positive emotional states.`,
      impact: 'positive',
      magnitude: score.eds / 100,
      evidence: [`EDS: ${score.eds}/100`],
      detectedAt: now,
      isNew: score.edsTrend > 5,
    })
  }

  if (score.stressPerformance < 35) {
    insights.push({
      id: newId(),
      type: 'pattern',
      title: '💥 Performance Collapses Under Stress',
      description: `You perform significantly worse under high-stress emotions. Stress Performance score: ${score.stressPerformance}/100.`,
      impact: 'negative',
      magnitude: (100 - score.stressPerformance) / 100,
      evidence: [`Stress Performance: ${score.stressPerformance}/100`],
      recommendation: 'Implement a hard rule: no new entries when stressed, fearful, or frustrated.',
      detectedAt: now,
      isNew: false,
    })
  }

  if (score.consistency < 40) {
    insights.push({
      id: newId(),
      type: 'pattern',
      title: '📊 Inconsistent Emotional State Week-over-Week',
      description: `Your consistency score is ${score.consistency}/100. Your emotional state varies significantly across weeks.`,
      impact: 'negative',
      magnitude: (100 - score.consistency) / 100,
      evidence: [`Consistency: ${score.consistency}/100`],
      recommendation: 'Establish a pre-trading routine (meditation, review of rules, mood check) to create a consistent baseline.',
      detectedAt: now,
      isNew: false,
    })
  }

  return insights
}

export function generateZoneInsights(zones: OptimalZone[]): TradingInsight[] {
  const top = zones.slice(0, 2)
  return top
    .filter(z => z.winRate >= 0.55 && z.confidence !== 'low')
    .map(z => ({
      id: newId(),
      type: 'optimal_zone' as const,
      title: `🎯 Optimal Zone: ${z.emotion} ${z.intensityMin}–${z.intensityMax}`,
      description: `Your personalized optimal zone: ${z.emotion} at intensity ${z.intensityMin}–${z.intensityMax}. Win rate: ${(z.winRate * 100).toFixed(0)}%, Avg PnL: ${z.avgPnL > 0 ? '+' : ''}${z.avgPnL.toFixed(1)} (${z.sampleSize} trades, ${z.confidence} confidence).`,
      impact: 'positive' as const,
      magnitude: z.winRate,
      evidence: [`${z.sampleSize} trades`, `${z.confidence} confidence`, `WR ${(z.winRate * 100).toFixed(0)}%`],
      recommendation: `When logging mood before a trade, aim for ${z.emotion} intensity ${z.intensityMin}–${z.intensityMax}.`,
      detectedAt: new Date(),
      isNew: z.confidence === 'high',
    }))
}

// ── Coaching Alerts ──────────────────────────────────────────────────────────

export function generateCoachingAlerts(
  recentMoods: MoodEntry[],
  recentTrades: Trade[],
  patterns: BehavioralPattern[],
  zones: OptimalZone[],
): CoachingAlert[] {
  const alerts: CoachingAlert[] = []
  const now = Date.now()

  // Get the most recent mood (last 2 hours)
  const latestMood = [...recentMoods]
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .find(m => now - m.timestamp.getTime() < 2 * 3600_000)

  if (latestMood) {
    const state = latestMood.emotionalState
    const intensity = latestMood.intensity

    // Tilt warning
    if (['stressed', 'fearful', 'frustrated'].includes(state) && intensity >= 7) {
      const activePattern = patterns.find(p =>
        (p.type === 'tilt_cycle' || p.type === 'revenge_trading') && p.isActive
      )
      if (activePattern) {
        alerts.push({
          type: 'tilt_warning',
          severity: 'critical',
          title: '🚨 TILT WARNING',
          message: `You're ${state} at intensity ${intensity}/10 and an active ${activePattern.type} pattern is detected. High risk of destructive trading.`,
          action: 'Close all charts. Take a 60-minute break minimum.',
          cooldownMinutes: 60,
          sizeMultiplier: 0,
          expiresAt: new Date(now + 2 * 3600_000),
        })
      } else {
        alerts.push({
          type: 'cooldown_recommended',
          severity: 'high',
          title: '⚠️ High Stress Detected',
          message: `Current state: ${state} at ${intensity}/10. Trading in this state statistically reduces your performance.`,
          action: 'Log your mood again in 30 minutes before entering any trade.',
          cooldownMinutes: 30,
          sizeMultiplier: 0.5,
          expiresAt: new Date(now + 90 * 60_000),
        })
      }
    }

    // Revenge risk (recent loss)
    const lastTrade = [...recentTrades]
      .sort((a, b) => b.date.getTime() - a.date.getTime())[0]
    if (lastTrade) {
      const lastPnL = tradePnL(lastTrade)
      const timeSinceLoss = now - lastTrade.date.getTime()
      if (lastPnL < 0 && timeSinceLoss < 90 * 60_000 &&
          ['frustrated', 'impatient', 'greedy'].includes(state)) {
        alerts.push({
          type: 'revenge_risk',
          severity: 'high',
          title: '🔁 Revenge Trade Risk',
          message: `Loss detected ${Math.round(timeSinceLoss / 60_000)}min ago + ${state} state = revenge trading risk. Your data shows this pattern ends badly.`,
          action: 'Wait the full 90-minute cooling period before your next trade.',
          cooldownMinutes: Math.max(0, 90 - Math.floor(timeSinceLoss / 60_000)),
          sizeMultiplier: 0,
          expiresAt: new Date(lastTrade.date.getTime() + 90 * 60_000),
        })
      }
    }

    // Optimal state alert
    const bestZone = zones.find(z =>
      z.emotion === state &&
      intensity >= z.intensityMin &&
      intensity <= z.intensityMax &&
      z.winRate >= 0.55
    )
    if (bestZone) {
      alerts.push({
        type: 'optimal_state',
        severity: 'low',
        title: '✅ Optimal Trading State',
        message: `You're in your confirmed optimal zone: ${state} at ${intensity}/10. Your historical win rate in this state is ${(bestZone.winRate * 100).toFixed(0)}%.`,
        action: 'This is your green light. Trade at normal position size.',
        sizeMultiplier: 1.0,
        expiresAt: new Date(now + 4 * 3600_000),
      })
    }
  }

  // Active pattern alerts
  const activePatterns = patterns.filter(p => p.isActive)
  for (const p of activePatterns.slice(0, 2)) {
    if (!alerts.some(a => a.type === 'tilt_warning')) {
      alerts.push({
        type: p.type === 'overconfidence' ? 'overconfidence_risk' : 'tilt_warning',
        severity: p.severity,
        title: formatPatternTitle(p.type),
        message: p.evidence.description,
        action: p.recommendation,
        expiresAt: new Date(now + 24 * 3600_000),
      })
    }
  }

  return alerts
}

// ── All Insights ─────────────────────────────────────────────────────────────
export function generateAllInsights(
  segments: PerformanceSegment[],
  patterns: BehavioralPattern[],
  score: PsychologyScore,
  zones: OptimalZone[],
): TradingInsight[] {
  return [
    ...generateSegmentInsights(segments),
    ...generatePatternInsights(patterns),
    ...generateScoreInsights(score),
    ...generateZoneInsights(zones),
  ].sort((a, b) => {
    const order = { warning: 0, pattern: 1, performance: 2, optimal_zone: 3, correlation: 4 }
    return (order[a.type] ?? 5) - (order[b.type] ?? 5)
  })
}
