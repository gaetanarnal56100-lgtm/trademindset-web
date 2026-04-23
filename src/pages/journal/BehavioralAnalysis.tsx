// src/pages/journal/BehavioralAnalysis.tsx
// Behavioral Analysis Dashboard — Psychology scoring + pattern detection + insights

import { useMemo, useState } from 'react'
import type { MoodEntry, Trade } from '@/services/firestore'
import { detectAllPatterns } from '@/services/psychology/patternDetector'
import { computePsychologyScore, computePerformanceSegments, computeOptimalZones, computeTransitions } from '@/services/psychology/scoringEngine'
import { generateAllInsights, generateCoachingAlerts } from '@/services/psychology/insightGenerator'
import type { PsychologyScore, BehavioralPattern, TradingInsight, CoachingAlert, PerformanceSegment, OptimalZone, EmotionalTransition } from '@/services/psychology/types'

// ── Helpers ──────────────────────────────────────────────────────────────────
const GLASS = {
  background: 'rgba(13,17,35,0.75)',
  backdropFilter: 'blur(12px)',
  border: '1px solid rgba(255,255,255,0.06)',
}

function neonText(color: string) {
  return { color, textShadow: `0 0 8px ${color}66` }
}

function scoreColor(v: number) {
  if (v >= 75) return '#34C759'
  if (v >= 55) return '#00D9FF'
  if (v >= 35) return '#FF9500'
  return '#FF3B30'
}

function trendArrow(v: number) {
  if (v > 2) return <span style={{ color: '#34C759', fontSize: 11 }}>▲ +{Math.round(v)}</span>
  if (v < -2) return <span style={{ color: '#FF3B30', fontSize: 11 }}>▼ {Math.round(v)}</span>
  return <span style={{ color: '#8E8E93', fontSize: 11 }}>— {Math.round(v) >= 0 ? '+' : ''}{Math.round(v)}</span>
}

function severityColor(s: BehavioralPattern['severity']) {
  return s === 'critical' ? '#FF3B30' : s === 'high' ? '#FF9500' : s === 'medium' ? '#FFD60A' : '#8E8E93'
}

function emotionEmoji(e: string) {
  const m: Record<string, string> = {
    confident: '😎', calm: '😌', focused: '🎯', excited: '🤩',
    stressed: '😰', impatient: '😤', fearful: '😨', greedy: '💰',
    frustrated: '😡', distracted: '🤔',
  }
  return m[e] ?? '😶'
}

// ── Score Ring ───────────────────────────────────────────────────────────────
function ScoreRing({ value, label, sublabel, trend }: {
  value: number; label: string; sublabel: string; trend: number
}) {
  const r = 38
  const circ = 2 * Math.PI * r
  const filled = (value / 100) * circ
  const color = scoreColor(value)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div style={{ position: 'relative', width: 96, height: 96 }}>
        <svg width={96} height={96} viewBox="0 0 96 96">
          <circle cx={48} cy={48} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={8} />
          <circle
            cx={48} cy={48} r={r} fill="none"
            stroke={color} strokeWidth={8}
            strokeDasharray={`${filled} ${circ}`}
            strokeLinecap="round"
            transform="rotate(-90 48 48)"
            style={{ filter: `drop-shadow(0 0 6px ${color}88)` }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: 22, fontWeight: 700, ...neonText(color) }}>{value}</span>
          <div style={{ marginTop: 2 }}>{trendArrow(trend)}</div>
        </div>
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: '#fff', textAlign: 'center' }}>{label}</span>
      <span style={{ fontSize: 10, color: '#8E8E93', textAlign: 'center' }}>{sublabel}</span>
    </div>
  )
}

// ── Coaching Alert Card ──────────────────────────────────────────────────────
function AlertCard({ alert }: { alert: CoachingAlert }) {
  const borderColor = alert.severity === 'critical' ? '#FF3B30'
    : alert.severity === 'high' ? '#FF9500'
    : alert.severity === 'medium' ? '#FFD60A'
    : '#34C759'

  return (
    <div style={{
      ...GLASS,
      borderLeft: `3px solid ${borderColor}`,
      borderRadius: 10,
      padding: '12px 16px',
      marginBottom: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{alert.title}</span>
        {alert.sizeMultiplier !== undefined && alert.sizeMultiplier !== 1 && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
            background: alert.sizeMultiplier === 0 ? 'rgba(255,59,48,0.2)' : 'rgba(255,149,0,0.2)',
            color: alert.sizeMultiplier === 0 ? '#FF3B30' : '#FF9500',
          }}>
            {alert.sizeMultiplier === 0 ? 'NO TRADE' : `SIZE ×${alert.sizeMultiplier}`}
          </span>
        )}
      </div>
      <p style={{ fontSize: 12, color: '#EBEBF5CC', margin: 0, lineHeight: 1.5 }}>{alert.message}</p>
      {alert.action && (
        <div style={{
          marginTop: 8, padding: '6px 10px', borderRadius: 6,
          background: 'rgba(255,255,255,0.04)',
          fontSize: 11, color: '#00D9FF', fontWeight: 600,
        }}>
          → {alert.action}
        </div>
      )}
      {alert.cooldownMinutes != null && alert.cooldownMinutes > 0 && (
        <div style={{ marginTop: 6, fontSize: 10, color: '#8E8E93' }}>
          ⏱ Recommended cooldown: {alert.cooldownMinutes}min
        </div>
      )}
    </div>
  )
}

// ── Pattern Card ─────────────────────────────────────────────────────────────
function PatternCard({ pattern }: { pattern: BehavioralPattern }) {
  const [expanded, setExpanded] = useState(false)
  const sc = severityColor(pattern.severity)

  return (
    <div style={{
      ...GLASS, borderRadius: 10, padding: '12px 14px', cursor: 'pointer',
      borderLeft: `3px solid ${sc}`,
    }} onClick={() => setExpanded(e => !e)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 20,
            background: `${sc}22`, color: sc, textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            {pattern.severity}
          </span>
          {pattern.isActive && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 20,
              background: 'rgba(255,59,48,0.15)', color: '#FF3B30',
              animation: 'pulse 2s ease-in-out infinite',
            }}>ACTIVE</span>
          )}
        </div>
        <span style={{ fontSize: 11, color: '#8E8E93' }}>{pattern.evidence.tradeIds.length} trades</span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginTop: 6 }}>
        {formatPatternName(pattern.type)}
      </div>
      {expanded && (
        <>
          <p style={{ fontSize: 11, color: '#EBEBF5CC', marginTop: 6, lineHeight: 1.6 }}>
            {pattern.evidence.description}
          </p>
          <div style={{
            marginTop: 8, padding: '8px 10px', borderRadius: 6,
            background: 'rgba(0,217,255,0.06)', borderLeft: '2px solid rgba(0,217,255,0.3)',
            fontSize: 11, color: '#00D9FF', lineHeight: 1.5,
          }}>
            💡 {pattern.recommendation}
          </div>
        </>
      )}
    </div>
  )
}

function formatPatternName(type: BehavioralPattern['type']) {
  const n: Record<BehavioralPattern['type'], string> = {
    revenge_trading: '🔁 Revenge Trading',
    tilt_cycle: '🌀 Tilt Cycle',
    overconfidence: '📈 Overconfidence',
    fear_hesitation: '😰 Fear-Hesitation',
    size_escalation: '📊 Size Escalation',
    emotional_spiral: '🌪️ Emotional Spiral',
    recovery_sequence: '✨ Recovery Sequence',
  }
  return n[type] ?? type
}

// ── Segment Table ────────────────────────────────────────────────────────────
function SegmentTable({ segments }: { segments: PerformanceSegment[] }) {
  const visible = segments.filter(s => s.sampleSize >= 3).slice(0, 12)
  if (visible.length === 0) return (
    <div style={{ color: '#8E8E93', fontSize: 12, textAlign: 'center', padding: 20 }}>
      Not enough data yet (need ≥3 trades per state)
    </div>
  )

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ color: '#8E8E93', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 500 }}>State</th>
            <th style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 500 }}>Intensity</th>
            <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 500 }}>Avg PnL</th>
            <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 500 }}>Win %</th>
            <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 500 }}>N</th>
            <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 500 }}>Sig.</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((s, i) => {
            const bg = s.avgPnL > 0 ? 'rgba(52,199,89,0.05)' : 'rgba(255,59,48,0.05)'
            const pnlColor = s.avgPnL > 0 ? '#34C759' : '#FF3B30'
            return (
              <tr key={i} style={{ background: i % 2 === 0 ? bg : 'transparent', transition: 'background 0.2s' }}>
                <td style={{ padding: '7px 8px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span>{emotionEmoji(s.emotion)}</span>
                    <span style={{ color: '#fff', textTransform: 'capitalize' }}>{s.emotion}</span>
                  </span>
                </td>
                <td style={{ padding: '7px 8px', textAlign: 'center' }}>
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 10,
                    background: s.intensity === 'high' ? 'rgba(255,59,48,0.15)'
                      : s.intensity === 'medium' ? 'rgba(255,149,0,0.15)'
                      : 'rgba(52,199,89,0.15)',
                    color: s.intensity === 'high' ? '#FF3B30'
                      : s.intensity === 'medium' ? '#FF9500' : '#34C759',
                    fontWeight: 600,
                  }}>
                    {s.intensity}
                  </span>
                </td>
                <td style={{ padding: '7px 8px', textAlign: 'right', color: pnlColor, fontWeight: 600, fontFamily: 'monospace' }}>
                  {s.avgPnL > 0 ? '+' : ''}{s.avgPnL.toFixed(1)}
                </td>
                <td style={{ padding: '7px 8px', textAlign: 'right', color: '#EBEBF5CC' }}>
                  {(s.winRate * 100).toFixed(0)}%
                </td>
                <td style={{ padding: '7px 8px', textAlign: 'right', color: '#8E8E93' }}>
                  {s.sampleSize}
                </td>
                <td style={{ padding: '7px 8px', textAlign: 'right' }}>
                  {s.isSignificant
                    ? <span style={{ color: '#34C759', fontSize: 11 }}>✓ p&lt;0.05</span>
                    : <span style={{ color: '#8E8E93', fontSize: 10 }}>—</span>
                  }
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Optimal Zones ────────────────────────────────────────────────────────────
function OptimalZones({ zones }: { zones: OptimalZone[] }) {
  const visible = zones.slice(0, 6)
  if (visible.length === 0) return (
    <div style={{ color: '#8E8E93', fontSize: 12, textAlign: 'center', padding: 20 }}>
      Not enough data yet
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {visible.map((z, i) => (
        <div key={i} style={{
          ...GLASS, borderRadius: 8, padding: '10px 14px',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ fontSize: 22 }}>{emotionEmoji(z.emotion)}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', textTransform: 'capitalize' }}>
              {z.emotion} — intensity {z.intensityMin}–{z.intensityMax}
            </div>
            <div style={{ fontSize: 10, color: '#8E8E93', marginTop: 2 }}>
              {z.sampleSize} trades · {z.confidence} confidence
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#34C759' }}>
              {(z.winRate * 100).toFixed(0)}%
            </div>
            <div style={{ fontSize: 10, color: '#8E8E93' }}>win rate</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: z.avgPnL >= 0 ? '#34C759' : '#FF3B30', fontFamily: 'monospace' }}>
              {z.avgPnL >= 0 ? '+' : ''}{z.avgPnL.toFixed(1)}
            </div>
            <div style={{ fontSize: 10, color: '#8E8E93' }}>avg PnL</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Transition Matrix Preview ────────────────────────────────────────────────
function TransitionPreview({ transitions }: { transitions: EmotionalTransition[] }) {
  const top = transitions.slice(0, 8)
  if (top.length === 0) return (
    <div style={{ color: '#8E8E93', fontSize: 12, textAlign: 'center', padding: 20 }}>
      Not enough mood entries yet
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {top.map((tr, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px', borderRadius: 8,
          background: 'rgba(255,255,255,0.03)',
        }}>
          <span style={{ fontSize: 14 }}>{emotionEmoji(tr.from)}</span>
          <span style={{ color: '#8E8E93', fontSize: 11 }}>→</span>
          <span style={{ fontSize: 14 }}>{emotionEmoji(tr.to)}</span>
          <span style={{ flex: 1, fontSize: 11, color: '#EBEBF5CC' }}>
            {tr.from} → {tr.to}
          </span>
          <span style={{ fontSize: 10, color: '#8E8E93' }}>
            {(tr.probability * 100).toFixed(0)}%
          </span>
          {tr.avgPnLAfter !== 0 && (
            <span style={{
              fontSize: 11, fontWeight: 600, fontFamily: 'monospace',
              color: tr.avgPnLAfter >= 0 ? '#34C759' : '#FF3B30',
            }}>
              {tr.avgPnLAfter >= 0 ? '+' : ''}{tr.avgPnLAfter.toFixed(1)}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Insight Card ─────────────────────────────────────────────────────────────
function InsightCard({ insight }: { insight: TradingInsight }) {
  const bgMap = {
    warning: 'rgba(255,59,48,0.06)',
    pattern: 'rgba(255,149,0,0.06)',
    performance: 'rgba(0,217,255,0.06)',
    optimal_zone: 'rgba(52,199,89,0.06)',
    correlation: 'rgba(191,90,242,0.06)',
  }
  const borderMap = {
    warning: '#FF3B30',
    pattern: '#FF9500',
    performance: '#00D9FF',
    optimal_zone: '#34C759',
    correlation: '#BF5AF2',
  }
  return (
    <div style={{
      borderRadius: 10,
      padding: '12px 14px',
      background: bgMap[insight.type] ?? 'rgba(255,255,255,0.03)',
      borderLeft: `3px solid ${borderMap[insight.type] ?? '#8E8E93'}`,
      marginBottom: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{insight.title}</span>
        {insight.isNew && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 10,
            background: 'rgba(0,217,255,0.15)', color: '#00D9FF',
          }}>NEW</span>
        )}
      </div>
      <p style={{ fontSize: 12, color: '#EBEBF5CC', marginTop: 6, marginBottom: 0, lineHeight: 1.6 }}>
        {insight.description}
      </p>
      {insight.recommendation && (
        <div style={{
          marginTop: 8, fontSize: 11, color: '#00D9FF', fontWeight: 500, lineHeight: 1.5,
        }}>
          💡 {insight.recommendation}
        </div>
      )}
      <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {insight.evidence.map((e, i) => (
          <span key={i} style={{
            fontSize: 10, padding: '1px 7px', borderRadius: 10,
            background: 'rgba(255,255,255,0.06)', color: '#8E8E93',
          }}>{e}</span>
        ))}
      </div>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────
interface Props {
  moods: MoodEntry[]
  trades: Trade[]
}

type Tab = 'overview' | 'patterns' | 'segments' | 'zones' | 'insights'

export default function BehavioralAnalysis({ moods, trades }: Props) {
  const [tab, setTab] = useState<Tab>('overview')

  // Split data: current 30 days vs previous 30 days (for trend calculation)
  const now = Date.now()
  const cutoff30 = now - 30 * 86_400_000
  const cutoff60 = now - 60 * 86_400_000

  const recentMoods = useMemo(() => moods.filter(m => m.timestamp.getTime() > cutoff30), [moods])
  const recentTrades = useMemo(() => trades.filter(t => t.date.getTime() > cutoff30), [trades])
  const prevMoods = useMemo(() => moods.filter(m => m.timestamp.getTime() > cutoff60 && m.timestamp.getTime() <= cutoff30), [moods])
  const prevTrades = useMemo(() => trades.filter(t => t.date.getTime() > cutoff60 && t.date.getTime() <= cutoff30), [trades])

  // Compute all analysis (memoized)
  const score = useMemo(() =>
    computePsychologyScore(recentTrades, recentMoods, prevTrades, prevMoods),
    [recentTrades, recentMoods, prevTrades, prevMoods]
  )
  const patterns = useMemo(() =>
    detectAllPatterns(recentTrades, recentMoods),
    [recentTrades, recentMoods]
  )
  const segments = useMemo(() =>
    computePerformanceSegments(recentTrades, recentMoods),
    [recentTrades, recentMoods]
  )
  const zones = useMemo(() =>
    computeOptimalZones(recentTrades, recentMoods),
    [recentTrades, recentMoods]
  )
  const transitions = useMemo(() =>
    computeTransitions(recentMoods, recentTrades),
    [recentMoods, recentTrades]
  )
  const insights = useMemo(() =>
    generateAllInsights(segments, patterns, score, zones),
    [segments, patterns, score, zones]
  )
  const coachingAlerts = useMemo(() =>
    generateCoachingAlerts(recentMoods, recentTrades, patterns, zones),
    [recentMoods, recentTrades, patterns, zones]
  )

  const activeAlerts = coachingAlerts.filter(a =>
    !a.expiresAt || a.expiresAt.getTime() > now
  )

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'overview', label: '🧠 Overview', badge: activeAlerts.length },
    { id: 'patterns', label: '⚠️ Patterns', badge: patterns.length },
    { id: 'segments', label: '📊 Segments' },
    { id: 'zones', label: '🎯 Optimal Zones' },
    { id: 'insights', label: '💡 Insights', badge: insights.filter(i => i.isNew).length },
  ]

  const hasEnoughData = moods.length >= 5

  if (!hasEnoughData) {
    return (
      <div style={{
        ...GLASS, borderRadius: 12, padding: 32, textAlign: 'center',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
      }}>
        <div style={{ fontSize: 48 }}>🧠</div>
        <h3 style={{ color: '#fff', margin: 0, fontSize: 16 }}>Behavioral Analysis</h3>
        <p style={{ color: '#8E8E93', fontSize: 13, maxWidth: 300, lineHeight: 1.6 }}>
          Log at least 5 mood entries to unlock your personalized behavioral analysis and psychology scoring.
        </p>
        <div style={{
          padding: '8px 16px', borderRadius: 20, background: 'rgba(0,217,255,0.1)',
          color: '#00D9FF', fontSize: 12, fontWeight: 600,
        }}>
          {moods.length}/5 entries logged
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Tab Bar */}
      <div style={{
        display: 'flex', gap: 6, flexWrap: 'wrap',
        padding: '4px 4px', borderRadius: 10,
        background: 'rgba(255,255,255,0.04)',
      }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: '0 1 auto',
            padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 600,
            background: tab === t.id ? 'rgba(0,217,255,0.15)' : 'transparent',
            color: tab === t.id ? '#00D9FF' : '#8E8E93',
            transition: 'all 0.2s',
            position: 'relative',
          }}>
            {t.label}
            {(t.badge ?? 0) > 0 && (
              <span style={{
                position: 'absolute', top: 2, right: 2,
                minWidth: 16, height: 16, borderRadius: 8,
                background: tab === 'patterns' && t.id === 'patterns' ? '#FF3B30' : '#00D9FF',
                color: '#000', fontSize: 9, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {tab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Coaching Alerts */}
          {activeAlerts.length > 0 && (
            <div>
              <h4 style={{ color: '#fff', fontSize: 13, fontWeight: 600, margin: '0 0 10px 0' }}>
                ⚡ Live Coaching
              </h4>
              {activeAlerts.map((a, i) => <AlertCard key={i} alert={a} />)}
            </div>
          )}

          {/* Score Overview */}
          <div style={{ ...GLASS, borderRadius: 12, padding: '16px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h4 style={{ color: '#fff', fontSize: 13, fontWeight: 600, margin: 0 }}>
                🧠 Psychology Score
              </h4>
              <div style={{
                padding: '4px 12px', borderRadius: 20,
                background: `${scoreColor(score.overall)}22`,
                color: scoreColor(score.overall),
                fontSize: 12, fontWeight: 700,
              }}>
                {score.overallLabel}
              </div>
            </div>

            {/* Overall big score */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 48, fontWeight: 800, ...neonText(scoreColor(score.overall)) }}>
                  {score.overall}
                </div>
                <div style={{ fontSize: 11, color: '#8E8E93', marginTop: 2 }}>Overall / 100</div>
              </div>
            </div>

            {/* 4 sub-scores */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))',
              gap: 16,
            }}>
              <ScoreRing
                value={score.eds}
                label="Discipline"
                sublabel={score.edsLabel}
                trend={score.edsTrend}
              />
              <ScoreRing
                value={score.stability}
                label="Stability"
                sublabel={score.stabilityLabel}
                trend={score.stabilityTrend}
              />
              <ScoreRing
                value={score.stressPerformance}
                label="Under Stress"
                sublabel={score.stressPerformanceLabel}
                trend={score.stressPerformanceTrend}
              />
              <ScoreRing
                value={score.consistency}
                label="Consistency"
                sublabel={score.consistencyLabel}
                trend={score.consistencyTrend}
              />
            </div>

            <div style={{ marginTop: 12, fontSize: 10, color: '#8E8E93', textAlign: 'center' }}>
              Based on last 30 days · {recentTrades.length} trades · {recentMoods.length} mood logs
            </div>
          </div>

          {/* Top insight(s) */}
          {insights.length > 0 && (
            <div>
              <h4 style={{ color: '#fff', fontSize: 13, fontWeight: 600, margin: '0 0 10px 0' }}>
                💡 Top Insight
              </h4>
              <InsightCard insight={insights[0]} />
            </div>
          )}
        </div>
      )}

      {/* ── PATTERNS TAB ── */}
      {tab === 'patterns' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: '#8E8E93', marginBottom: 4 }}>
            {patterns.length === 0
              ? '✅ No behavioral anti-patterns detected in the last 30 days.'
              : `${patterns.length} pattern(s) detected — tap to expand.`
            }
          </div>
          {patterns.map((p, i) => <PatternCard key={i} pattern={p} />)}

          {/* Transition Preview */}
          {transitions.length > 0 && (
            <div style={{ ...GLASS, borderRadius: 12, padding: '16px' }}>
              <h4 style={{ color: '#fff', fontSize: 13, fontWeight: 600, margin: '0 0 12px 0' }}>
                🔄 Emotional Transitions
              </h4>
              <div style={{ fontSize: 11, color: '#8E8E93', marginBottom: 8 }}>
                Most frequent state changes and their trading outcomes
              </div>
              <TransitionPreview transitions={transitions} />
            </div>
          )}
        </div>
      )}

      {/* ── SEGMENTS TAB ── */}
      {tab === 'segments' && (
        <div style={{ ...GLASS, borderRadius: 12, padding: '16px' }}>
          <h4 style={{ color: '#fff', fontSize: 13, fontWeight: 600, margin: '0 0 4px 0' }}>
            📊 Performance by Emotional State
          </h4>
          <p style={{ color: '#8E8E93', fontSize: 11, margin: '0 0 14px 0', lineHeight: 1.5 }}>
            Conditional correlation: how each emotion × intensity bucket affects your PnL.
            Statistically significant results (p&lt;0.05, N≥5) are marked with ✓.
          </p>
          <SegmentTable segments={segments} />
        </div>
      )}

      {/* ── OPTIMAL ZONES TAB ── */}
      {tab === 'zones' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ ...GLASS, borderRadius: 12, padding: '16px' }}>
            <h4 style={{ color: '#fff', fontSize: 13, fontWeight: 600, margin: '0 0 4px 0' }}>
              🎯 Your Optimal Emotional Zones
            </h4>
            <p style={{ color: '#8E8E93', fontSize: 11, margin: '0 0 14px 0', lineHeight: 1.5 }}>
              Personalized intensity ranges where you perform best. Use as a pre-trade checklist.
            </p>
            <OptimalZones zones={zones} />
          </div>

          {zones.length > 0 && (
            <div style={{
              ...GLASS, borderRadius: 12, padding: '14px 16px',
              borderLeft: '3px solid #00D9FF',
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#00D9FF', marginBottom: 6 }}>
                💡 How to use this
              </div>
              <p style={{ fontSize: 11, color: '#EBEBF5CC', margin: 0, lineHeight: 1.7 }}>
                Before entering a trade, log your current emotion and intensity.
                If it matches your top optimal zone — green light.
                If it's in a red zone (stress/fear/frustration at high intensity) — mandatory 30min wait.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── INSIGHTS TAB ── */}
      {tab === 'insights' && (
        <div>
          {insights.length === 0 ? (
            <div style={{ ...GLASS, borderRadius: 12, padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
              <p style={{ color: '#8E8E93', fontSize: 12 }}>
                Not enough data to generate significant insights yet.
                Keep logging your moods before and after trades.
              </p>
            </div>
          ) : (
            insights.map((ins, i) => <InsightCard key={i} insight={ins} />)
          )}
        </div>
      )}
    </div>
  )
}
