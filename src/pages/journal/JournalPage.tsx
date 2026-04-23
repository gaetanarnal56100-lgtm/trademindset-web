// src/pages/journal/JournalPage.tsx — Connecté à Firestore users/{uid}/moods

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { subscribeMoods, subscribeTrades, createMood, deleteMood, tradePnL, type MoodEntry, type Trade, type EmotionalState, type MoodContext } from '@/services/firestore'
import ShareStatsModal from '@/components/share/ShareStatsModal'
import PropFirmTracker from './PropFirmTracker'
import BehaviorPatternEngine from './BehaviorPatternEngine'
import DecisionDelayModal from './DecisionDelayModal'
import ExchangeSyncModal from './ExchangeSyncModal'

const EMOTIONS: { v: EmotionalState; emoji: string; labelKey: string; fallback: string; color: string }[] = [
  { v:'confident',  emoji:'😎', labelKey:'journal.emotions.confident',  fallback:'Confident',   color:'#4CAF50' },
  { v:'calm',       emoji:'😌', labelKey:'journal.emotions.calm',        fallback:'Calm',        color:'#2196F3' },
  { v:'focused',    emoji:'🎯', labelKey:'journal.emotions.focused',     fallback:'Focused',     color:'#00BCD4' },
  { v:'excited',    emoji:'🤩', labelKey:'journal.emotions.excited',     fallback:'Excited',     color:'#E91E63' },
  { v:'stressed',   emoji:'😰', labelKey:'journal.emotions.stressed',    fallback:'Stressed',    color:'#F44336' },
  { v:'impatient',  emoji:'😤', labelKey:'journal.emotions.impatient',   fallback:'Impatient',   color:'#FF9800' },
  { v:'fearful',    emoji:'😨', labelKey:'journal.emotions.fearful',     fallback:'Fearful',     color:'#9C27B0' },
  { v:'greedy',     emoji:'💰', labelKey:'journal.emotions.greedy',      fallback:'Greedy',      color:'#FFC107' },
  { v:'frustrated', emoji:'😡', labelKey:'journal.emotions.frustrated',  fallback:'Frustrated',  color:'#795548' },
  { v:'distracted', emoji:'🤔', labelKey:'journal.emotions.distracted',  fallback:'Distracted',  color:'#607D8B' },
]

const CONTEXTS: { v: MoodContext; labelKey: string; fallback: string }[] = [
  { v:'beforeTrade', labelKey:'journal.beforeTrade', fallback:'Before trade' },
  { v:'afterTrade',  labelKey:'journal.afterTrade',  fallback:'After trade'  },
  { v:'duringTrade', labelKey:'journal.duringTrade', fallback:'During trade' },
  { v:'general',     labelKey:'journal.general',     fallback:'General'      },
]

function contextLabel(v: MoodContext, t: (key: string) => string): string {
  const ctx = CONTEXTS.find(c => c.v === v)
  return ctx ? t(ctx.labelKey) : v
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
}

function emotionInfo(v: EmotionalState, t?: (key: string) => string): { v: EmotionalState; emoji: string; label: string; labelKey: string; fallback: string; color: string } {
  const em = EMOTIONS.find(e => e.v === v) ?? EMOTIONS[1]
  return { ...em, label: t ? t(em.labelKey) : em.fallback }
}

// Canvas cannot use CSS vars — resolve at draw time
function resolveCSSColor(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback
}
function getCSSPurpleColor(alpha: number): string {
  const rgb = resolveCSSColor('--tm-purple-rgb', '191,90,242')
  return `rgba(${rgb},${alpha})`
}

// ── Emotion score mapping ─────────────────────────────────────────────────────
const EMOTION_SCORE: Record<EmotionalState, number> = {
  confident:5, calm:4.5, focused:5, excited:3.5,
  stressed:2, impatient:2, fearful:1, greedy:2.5,
  frustrated:1.5, distracted:2.5,
}

// ── AI Analysis types ─────────────────────────────────────────────────────────
interface EmotionalAnalysis {
  dominantEmotion: EmotionalState
  averageIntensity: number
  emotionalVolatility: number
  correlationWithPerformance: number | null
  insights: string[]
  recommendations: string[]
  totalEntries: number
  periodDays: number
}

function computeAnalysis(moods: MoodEntry[], trades: Trade[]): EmotionalAnalysis | null {
  if (moods.length === 0) return null

  // Dominant emotion
  const counts: Record<string, number> = {}
  moods.forEach(m => { counts[m.emotionalState] = (counts[m.emotionalState] || 0) + 1 })
  const dominantEmotion = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'calm') as EmotionalState

  // Average intensity
  const averageIntensity = moods.reduce((s, m) => s + m.intensity, 0) / moods.length

  // Emotional volatility (std dev of emotion scores)
  const scores = moods.map(m => EMOTION_SCORE[m.emotionalState] ?? 3)
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length
  const variance = scores.reduce((a, b) => a + Math.pow(b - avgScore, 2), 0) / scores.length
  const emotionalVolatility = Math.sqrt(variance)

  // Correlation with performance (for linked trades)
  let correlationWithPerformance: number | null = null
  const linkedPairs: { score: number; pnl: number }[] = []
  moods.forEach(m => {
    if (!m.tradeId) return
    const trade = trades.find(t => t.id === m.tradeId)
    if (trade) {
      const pnl = tradePnL(trade)
      if (pnl !== 0) linkedPairs.push({ score: EMOTION_SCORE[m.emotionalState] ?? 3, pnl })
    }
  })
  if (linkedPairs.length >= 3) {
    const n = linkedPairs.length
    const meanScore = linkedPairs.reduce((a, p) => a + p.score, 0) / n
    const meanPnl = linkedPairs.reduce((a, p) => a + p.pnl, 0) / n
    const cov = linkedPairs.reduce((a, p) => a + (p.score - meanScore) * (p.pnl - meanPnl), 0) / n
    const stdScore = Math.sqrt(linkedPairs.reduce((a, p) => a + Math.pow(p.score - meanScore, 2), 0) / n)
    const stdPnl = Math.sqrt(linkedPairs.reduce((a, p) => a + Math.pow(p.pnl - meanPnl, 2), 0) / n)
    if (stdScore > 0 && stdPnl > 0) correlationWithPerformance = Math.max(-1, Math.min(1, cov / (stdScore * stdPnl)))
  }

  // Period in days
  const times = moods.map(m => m.timestamp.getTime())
  const periodDays = moods.length > 1 ? Math.ceil((Math.max(...times) - Math.min(...times)) / 86_400_000) : 1

  // Insights (as translation key tokens — rendered via t() in the panel)
  const insights: string[] = []
  const dominantInfo = emotionInfo(dominantEmotion)
  const dominantPct = Math.round((counts[dominantEmotion] / moods.length) * 100)
  insights.push(`__dominant:${dominantInfo.emoji}:${dominantInfo.fallback.toLowerCase()}:${dominantPct}`)

  if (emotionalVolatility > 1.5) {
    insights.push('__key:journal.insightHighVolatility')
  } else if (emotionalVolatility < 0.7) {
    insights.push('__key:journal.insightStableState')
  }

  if (averageIntensity >= 7) {
    insights.push('__key:journal.insightHighIntensity')
  } else if (averageIntensity <= 4) {
    insights.push('__key:journal.insightLowIntensity')
  }

  if (correlationWithPerformance !== null) {
    if (correlationWithPerformance > 0.4) {
      insights.push('__key:journal.insightPositiveCorr')
    } else if (correlationWithPerformance < -0.4) {
      insights.push('__key:journal.insightNegativeCorr')
    } else {
      insights.push('__key:journal.insightNeutralCorr')
    }
  }

  const highStressCount = moods.filter(m => ['stressed','fearful','frustrated'].includes(m.emotionalState)).length
  const stressPct = Math.round((highStressCount / moods.length) * 100)
  if (stressPct > 30) {
    insights.push(`__stress:${stressPct}`)
  }

  // Recommendations (as translation key tokens)
  const recommendations: string[] = []
  switch (dominantEmotion) {
    case 'stressed':
    case 'fearful':
      recommendations.push('__key:journal.recBreathing')
      recommendations.push('__key:journal.recAvoidStressed')
      break
    case 'greedy':
      recommendations.push('__key:journal.recProfitTargets')
      recommendations.push('__key:journal.recStopLoss')
      break
    case 'frustrated':
      recommendations.push('__key:journal.recDecompress')
      recommendations.push('__key:journal.recAnalyzeErrors')
      break
    case 'confident':
    case 'focused':
      recommendations.push('__key:journal.recCultivate')
      recommendations.push('__key:journal.recRefineStrategy')
      break
    case 'excited':
      recommendations.push('__key:journal.recOvertrading')
      recommendations.push('__key:journal.recDoubleCheck')
      break
    default:
      recommendations.push('__key:journal.recKeepLogging')
  }

  if (emotionalVolatility > 1.5) {
    recommendations.push('__key:journal.recReduceSize')
  }

  if (correlationWithPerformance !== null && correlationWithPerformance < -0.3) {
    recommendations.push('__key:journal.recCoaching')
  }

  return { dominantEmotion, averageIntensity, emotionalVolatility, correlationWithPerformance, insights, recommendations, totalEntries: moods.length, periodDays }
}

// ── Insight/recommendation string renderer ────────────────────────────────────
function renderAnalysisString(raw: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (raw.startsWith('__dominant:')) {
    const [, emoji, label, pct] = raw.split(':')
    return t('journal.insightDominant', { emoji, label, pct })
  }
  if (raw.startsWith('__stress:')) {
    const pct = raw.split(':')[1]
    return t('journal.insightStress', { pct })
  }
  if (raw.startsWith('__key:')) {
    return t(raw.slice(6))
  }
  return raw
}

// ── AI Analysis Panel ─────────────────────────────────────────────────────────
function AIAnalysisPanel({ moods, trades }: { moods: MoodEntry[]; trades: Trade[] }) {
  const { t } = useTranslation()
  const analysis = useMemo(() => computeAnalysis(moods, trades), [moods, trades])
  const [expanded, setExpanded] = useState(true)

  if (moods.length === 0) {
    return (
      <div style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:12, padding:'16px 16px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
          <div style={{ width:28, height:28, borderRadius:8, background:'rgba(191,90,242,0.15)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}>✨</div>
          <span style={{ fontSize:13, fontWeight:700, color:'var(--tm-text-primary)' }}>{t('journal.aiAnalysis')}</span>
        </div>
        <div style={{ fontSize:12, color:'var(--tm-text-muted)', textAlign:'center', padding:'20px 0' }}>
          {t('journal.noDataForAnalysis')}
        </div>
      </div>
    )
  }

  if (!analysis) return null

  const dom = emotionInfo(analysis.dominantEmotion, t)
  const corrPct = analysis.correlationWithPerformance !== null ? Math.round(Math.abs(analysis.correlationWithPerformance) * 100) : null
  const corrColor = analysis.correlationWithPerformance === null ? 'var(--tm-text-muted)'
    : analysis.correlationWithPerformance > 0.2 ? 'var(--tm-profit)'
    : analysis.correlationWithPerformance < -0.2 ? 'var(--tm-loss)'
    : 'var(--tm-warning)'

  return (
    <div style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:12, overflow:'hidden' }}>
      {/* Header */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px', cursor:'pointer', borderBottom: expanded ? '1px solid rgba(255,255,255,0.04)' : 'none' }}
      >
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:28, height:28, borderRadius:8, background:'rgba(191,90,242,0.15)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}>✨</div>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--tm-text-primary)' }}>{t('journal.aiAnalysis')}</div>
            <div style={{ fontSize:10, color:'var(--tm-text-muted)' }}>{t('journal.analysisSubtitle', { count: analysis.totalEntries, days: analysis.periodDays })}</div>
          </div>
        </div>
        <span style={{ color:'var(--tm-text-muted)', fontSize:11 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ padding:'14px 16px', display:'flex', flexDirection:'column', gap:14 }}>
          {/* Dominant emotion */}
          <div style={{ background:`${dom.color}12`, border:`1px solid ${dom.color}30`, borderRadius:10, padding:'12px 14px', display:'flex', alignItems:'center', gap:12 }}>
            <span style={{ fontSize:32 }}>{dom.emoji}</span>
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:dom.color }}>{dom.label}</div>
              <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginTop:2 }}>{t('journal.dominantEmotion')}</div>
              <div style={{ fontSize:10, color:'var(--tm-text-secondary)', marginTop:1 }}>
                {t('journal.avgIntensity')} {analysis.averageIntensity.toFixed(1)}/10 · {t('journal.volatility')} {analysis.emotionalVolatility.toFixed(1)}
              </div>
            </div>
          </div>

          {/* Metrics grid */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            {[
              { label:t('journal.avgIntensity'), value:`${analysis.averageIntensity.toFixed(1)}/10`, color:'#2196F3', icon:'💪' },
              { label:t('journal.volatility'), value:analysis.emotionalVolatility.toFixed(1), color:'#FF9800', icon:'⚡' },
              { label:t('journal.correlation'), value: corrPct !== null ? `${corrPct}%` : '—', color:corrColor, icon:'📊' },
              { label:t('journal.period'), value:`${analysis.periodDays}j`, color:'#9C27B0', icon:'📅' },
            ].map(({ label, value, color, icon }) => (
              <div key={label} style={{ background:'rgba(255,255,255,0.02)', border:'1px solid #1E2330', borderRadius:8, padding:'8px 10px' }}>
                <div style={{ fontSize:9, color:'var(--tm-text-muted)', marginBottom:3 }}>{icon} {label}</div>
                <div style={{ fontSize:13, fontWeight:700, color, fontFamily:'JetBrains Mono,monospace' }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Correlation description */}
          {analysis.correlationWithPerformance !== null && (
            <div style={{ background:'rgba(255,255,255,0.02)', border:'1px solid #1E2330', borderRadius:10, padding:'10px 12px' }}>
              <div style={{ fontSize:11, fontWeight:600, color:'var(--tm-text-primary)', marginBottom:6, display:'flex', alignItems:'center', gap:6 }}>
                <span>{t('journal.impactTitle')}</span>
                {/* Mini ring */}
                <svg width={28} height={28} style={{ flexShrink:0 }}>
                  <circle cx={14} cy={14} r={10} fill="none" stroke="#2A2F3E" strokeWidth={3} />
                  <circle
                    cx={14} cy={14} r={10} fill="none"
                    stroke={analysis.correlationWithPerformance > 0 ? '#4CAF50' : '#F44336'}
                    strokeWidth={3}
                    strokeDasharray={`${Math.abs(analysis.correlationWithPerformance) * 62.8} 62.8`}
                    strokeLinecap="round"
                    transform="rotate(-90 14 14)"
                  />
                  <text x={14} y={17} textAnchor="middle" fontSize={7} fontWeight={700} fill={analysis.correlationWithPerformance > 0 ? '#4CAF50' : '#F44336'}>
                    {corrPct}%
                  </text>
                </svg>
              </div>
              <div style={{ fontSize:11, color:'var(--tm-text-secondary)', lineHeight:1.6 }}>
                {analysis.correlationWithPerformance > 0.5
                  ? t('journal.strongPositiveImpact')
                  : analysis.correlationWithPerformance > 0.2
                  ? t('journal.weakPositiveImpact')
                  : analysis.correlationWithPerformance > -0.2
                  ? t('journal.noImpact')
                  : analysis.correlationWithPerformance > -0.5
                  ? t('journal.weakNegativeImpact')
                  : t('journal.strongNegativeImpact')}
              </div>
            </div>
          )}

          {/* Insights */}
          <div>
            <div style={{ fontSize:11, fontWeight:600, color:'var(--tm-text-primary)', marginBottom:8 }}>{t('journal.insights')}</div>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {analysis.insights.map((ins, i) => (
                <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:8, padding:'7px 10px', background:'rgba(255,255,255,0.02)', borderRadius:8, border:'1px solid #1E2330' }}>
                  <span style={{ fontSize:11, color:'var(--tm-text-secondary)', lineHeight:1.5 }}>{renderAnalysisString(ins, t)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recommendations */}
          <div style={{ background:'rgba(76,175,80,0.05)', border:'1px solid rgba(76,175,80,0.15)', borderRadius:10, padding:'12px 14px' }}>
            <div style={{ fontSize:11, fontWeight:600, color:'var(--tm-text-primary)', marginBottom:8 }}>{t('journal.recommendations')}</div>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {analysis.recommendations.map((rec, i) => (
                <div key={i} style={{ fontSize:11, color:'var(--tm-text-secondary)', lineHeight:1.6, paddingLeft:4 }}>
                  {renderAnalysisString(rec, t)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function JournalPage() {
  const { t } = useTranslation()
  const [moods,   setMoods]   = useState<MoodEntry[]>([])
  const [trades,  setTrades]  = useState<Trade[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [showDelay, setShowDelay] = useState(false)  // Decision Delay System
  const [showImport, setShowImport] = useState(false) // Exchange Import
  const [filter,  setFilter]  = useState<EmotionalState | 'all'>('all')

  useEffect(() => {
    const unsubM = subscribeMoods(m => { setMoods(m); setLoading(false) })
    const unsubT = subscribeTrades(setTrades)
    return () => { unsubM(); unsubT() }
  }, [])

  const filtered = filter === 'all' ? moods : moods.filter(m => m.emotionalState === filter)

  // Emotion distribution
  const emotionCounts = EMOTIONS.map(e => ({
    ...e,
    label: t(e.labelKey),
    count: moods.filter(m => m.emotionalState === e.v).length,
  })).sort((a, b) => b.count - a.count)

  const avgIntensity = moods.length > 0
    ? (moods.reduce((s, m) => s + m.intensity, 0) / moods.length).toFixed(1)
    : '—'

  // FOMO / Revenge trading detector
  const fomoAlerts = useMemo(() => {
    const alerts: { type: 'revenge' | 'fomo' | 'oversize'; message: string; tradeId?: string }[] = []
    const closedTrades = trades
      .filter(t => t.status === 'closed')
      .sort((a, b) => {
        const ta = typeof a.date?.seconds === 'number' ? a.date.seconds * 1000 : typeof a.date?.getTime === 'function' ? a.date.getTime() : 0
        const tb = typeof b.date?.seconds === 'number' ? b.date.seconds * 1000 : typeof b.date?.getTime === 'function' ? b.date.getTime() : 0
        return ta - tb
      })
    for (let i = 1; i < closedTrades.length; i++) {
      const prev = closedTrades[i - 1]
      const curr = closedTrades[i]
      const prevPnL = tradePnL(prev)
      const currPnL = tradePnL(curr)
      // Revenge trade: negative then immediately another trade, possibly larger
      if (prevPnL < 0) {
        const ta = typeof curr.date?.seconds === 'number' ? curr.date.seconds * 1000 : 0
        const tb = typeof prev.date?.seconds === 'number' ? prev.date.seconds * 1000 : 0
        const gapMinutes = (ta - tb) / 60000
        if (gapMinutes < 30 && gapMinutes >= 0) {
          alerts.push({ type: 'revenge', message: `Trade potentiellement revanche : ${curr.symbol} ouvert ${Math.round(gapMinutes)}min après une perte sur ${prev.symbol}`, tradeId: curr.id })
        }
      }
      // Streak of losses -> possible FOMO
      if (i >= 3) {
        const last3 = closedTrades.slice(i - 3, i).map(t => tradePnL(t))
        if (last3.every(p => p < 0) && currPnL < 0) {
          alerts.push({ type: 'fomo', message: `4 pertes consécutives détectées — risque de revenge trading élevé`, tradeId: curr.id })
        }
      }
    }
    // Deduplicate
    const seen = new Set<string>()
    return alerts.filter(a => { const k = a.type + a.message; if (seen.has(k)) return false; seen.add(k); return true }).slice(0, 5)
  }, [trades])

  const tradeName = (id?: string) => {
    if (!id) return null
    const trade = trades.find(tr => tr.id === id)
    return trade ? `${trade.symbol} ${trade.type}` : null
  }

  return (
    <div style={{ padding:'24px 28px 60px', maxWidth:1400, margin:'0 auto' }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:'var(--tm-text-primary)', margin:0, fontFamily:'Syne, sans-serif' }}>{t('journal.title')}</h1>
          <p style={{ fontSize:13, color:'var(--tm-text-secondary)', margin:'3px 0 0' }}>
            {loading ? t('journal.loading') : `${t('journal.entries', { count: moods.length })} · ${t('journal.avgIntensity')} ${avgIntensity}/10`}
          </p>
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button
            onClick={() => setShowImport(true)}
            style={{ padding:'8px 14px', borderRadius:10, border:'1px solid rgba(255,149,0,0.3)', background:'rgba(255,149,0,0.06)', color:'#FF9500', fontSize:12, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}
          >
            📥 Importer via API
          </button>
          <button
            onClick={() => setShowDelay(true)}
            style={{ padding:'8px 14px', borderRadius:10, border:'1px solid rgba(34,199,89,0.3)', background:'rgba(34,199,89,0.06)', color:'#22C759', fontSize:12, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}
          >
            ⚡ Avant un trade
          </button>
          <button
            onClick={() => setShowShare(true)}
            style={{ padding:'8px 14px', borderRadius:10, border:'1px solid rgba(0,229,255,0.3)', background:'rgba(0,229,255,0.06)', color:'var(--tm-accent)', fontSize:12, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}
          >
            📤 Partager
          </button>
          <button onClick={() => setShowAdd(true)} style={{ padding:'8px 16px', borderRadius:10, border:'none', background:'var(--tm-accent)', color:'var(--tm-bg)', fontSize:13, fontWeight:600, cursor:'pointer' }}>
            {t('journal.addEntry')}
          </button>
        </div>
      </div>

      {/* Two-column layout */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 320px', gap:20, alignItems:'start' }}>
        {/* Left — journal content */}
        <div>
          {/* Emotion breakdown */}
          {!loading && moods.length > 0 && (
            <div style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:12, padding:'14px 16px', marginBottom:16 }}>
              <div style={{ fontSize:12, fontWeight:600, color:'var(--tm-text-primary)', marginBottom:12 }}>{t('journal.emotionDistribution')}</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                {emotionCounts.filter(e => e.count > 0).map(e => (
                  <button key={e.v} onClick={() => setFilter(filter === e.v ? 'all' : e.v)}
                    style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 10px', borderRadius:20, border:`1px solid ${filter === e.v ? e.color : 'var(--tm-border)'}`, background: filter === e.v ? `${e.color}` : 'var(--tm-bg-tertiary)', cursor:'pointer' }}>
                    <span>{e.emoji}</span>
                    <span style={{ fontSize:11, color: filter === e.v ? e.color : 'var(--tm-text-secondary)' }}>{e.label}</span>
                    <span style={{ fontSize:10, fontWeight:700, color: filter === e.v ? e.color : 'var(--tm-text-muted)', background:'var(--tm-border)', padding:'1px 5px', borderRadius:10 }}>{e.count}</span>
                  </button>
                ))}
                {filter !== 'all' && (
                  <button onClick={() => setFilter('all')} style={{ padding:'5px 10px', borderRadius:20, border:'1px solid #2A2F3E', background:'none', cursor:'pointer', fontSize:11, color:'var(--tm-text-muted)' }}>{t('journal.showAll')}</button>
                )}
              </div>
            </div>
          )}

          {/* FOMO / Revenge Detector */}
          {!loading && fomoAlerts.length > 0 && (
            <div style={{ background:'rgba(255,59,48,0.06)', border:'1px solid rgba(255,59,48,0.2)', borderRadius:12, padding:'12px 16px', marginBottom:16 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#FF3B30', marginBottom:10, display:'flex', alignItems:'center', gap:6 }}>
                ⚠️ Détecteur FOMO / Revenge Trading
              </div>
              {fomoAlerts.map((a, i) => (
                <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:8, padding:'6px 0', borderTop: i > 0 ? '1px solid rgba(255,59,48,0.1)' : 'none' }}>
                  <span style={{ fontSize:14, flexShrink:0 }}>{a.type === 'revenge' ? '🔄' : a.type === 'fomo' ? '😱' : '📊'}</span>
                  <span style={{ fontSize:11, color:'rgba(255,255,255,0.7)', lineHeight:1.5 }}>{a.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Behavior Pattern Engine */}
          {!loading && <BehaviorPatternEngine trades={trades} />}

          {/* Emotion curve chart */}
          {!loading && moods.length >= 2 && <EmotionCurve moods={moods} />}

          {/* Entries */}
          {loading ? (
            <div style={{ textAlign:'center', padding:48, color:'var(--tm-text-muted)' }}>
              <div style={{ width:24, height:24, border:'2px solid #2A2F3E', borderTopColor:'var(--tm-accent)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto 12px' }} />
              {t('journal.loading')}
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign:'center', padding:48, color:'var(--tm-text-muted)', fontSize:14 }}>
              {moods.length === 0 ? t('journal.noEntries') : t('journal.noEntriesFiltered')}
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {filtered.map(mood => {
                const em = emotionInfo(mood.emotionalState, t as (key: string) => string)
                const ctxLabel = contextLabel(mood.context, t as (key: string) => string)
                const linkedTrade = tradeName(mood.tradeId)
                return (
                  <div key={mood.id} style={{ background:'var(--tm-bg-secondary)', border:`1px solid ${em.color}30`, borderRadius:12, padding:'12px 14px' }}>
                    <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
                      {/* Emotion circle */}
                      <div style={{ width:42, height:42, borderRadius:12, background:`${em.color}20`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, flexShrink:0 }}>
                        {em.emoji}
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4, flexWrap:'wrap' }}>
                          <span style={{ fontSize:13, fontWeight:700, color:em.color }}>{em.label}</span>
                          {/* Intensity bar */}
                          <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                            <div style={{ width:60, height:5, background:'var(--tm-border)', borderRadius:3, overflow:'hidden' }}>
                              <div style={{ width:`${mood.intensity * 10}%`, height:'100%', background:em.color, borderRadius:3 }} />
                            </div>
                            <span style={{ fontSize:10, color:'var(--tm-text-muted)' }}>{mood.intensity}/10</span>
                          </div>
                          <span style={{ fontSize:10, color:'var(--tm-text-muted)', background:'var(--tm-bg-tertiary)', padding:'1px 7px', borderRadius:4 }}>{ctxLabel}</span>
                          {mood.isExceptional && <span style={{ fontSize:9, color:'#FFD700', background:'rgba(255,215,0,0.1)', padding:'1px 6px', borderRadius:4 }}>{t('journal.exceptional')}</span>}
                        </div>
                        <div style={{ fontSize:11, color:'var(--tm-text-muted)', marginBottom: mood.notes ? 6 : 0 }}>
                          {fmtDate(mood.timestamp)}
                          {linkedTrade && <span style={{ marginLeft:8, color:'var(--tm-accent)' }}>→ {linkedTrade}</span>}
                        </div>
                        {mood.notes && <div style={{ fontSize:12, color:'#C5C8D6', lineHeight:1.6, marginBottom:4 }}>{mood.notes}</div>}
                        {mood.aiSummary && (
                          <div style={{ fontSize:11, color:'var(--tm-text-secondary)', background:`rgba(${resolveCSSColor('var(--tm-accent-rgb','0,229,255')},0.05)`, border:'1px solid rgba(var(--tm-accent-rgb,0,229,255),0.1)', borderRadius:6, padding:'5px 8px', marginTop:4 }}>
                            ✨ {mood.aiSummary}
                          </div>
                        )}
                        {mood.tags.length > 0 && (
                          <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginTop:5 }}>
                            {mood.tags.map(tag => (
                              <span key={tag} style={{ fontSize:10, color:'var(--tm-text-muted)', background:'var(--tm-bg-tertiary)', padding:'1px 6px', borderRadius:4 }}>#{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button onClick={() => { if(confirm('Supprimer ?')) deleteMood(mood.id) }} style={{ background:'none', border:'none', color:'var(--tm-text-muted)', cursor:'pointer', fontSize:12, flexShrink:0 }}>✕</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Right — AI Analysis sticky panel */}
        <div style={{ position:'sticky', top:20, display:'flex', flexDirection:'column', gap:12 }}>
          <PropFirmTracker trades={trades} />
          <AIAnalysisPanel moods={moods} trades={trades} />

          {/* Quick Stats mini-card */}
          {!loading && moods.length > 0 && (
            <div style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:12, padding:'14px 16px' }}>
              <div style={{ fontSize:11, fontWeight:600, color:'var(--tm-text-primary)', marginBottom:10 }}>{t('journal.quickStats')}</div>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {EMOTIONS.filter(e => moods.some(m => m.emotionalState === e.v))
                  .map(e => {
                    const cnt = moods.filter(m => m.emotionalState === e.v).length
                    const pct = Math.round((cnt / moods.length) * 100)
                    return (
                      <div key={e.v} style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <span style={{ fontSize:14, width:20, textAlign:'center', flexShrink:0 }}>{e.emoji}</span>
                        <div style={{ flex:1 }}>
                          <div style={{ height:5, background:'var(--tm-border)', borderRadius:3, overflow:'hidden' }}>
                            <div style={{ width:`${pct}%`, height:'100%', background:e.color, borderRadius:3, transition:'width 0.4s' }} />
                          </div>
                        </div>
                        <span style={{ fontSize:10, color:'var(--tm-text-muted)', fontFamily:'JetBrains Mono,monospace', width:30, textAlign:'right', flexShrink:0 }}>{pct}%</span>
                      </div>
                    )
                  })}
              </div>
            </div>
          )}
        </div>
      </div>

      {showAdd && <AddMoodModal trades={trades} onClose={() => setShowAdd(false)} />}
      {showShare && (
        <ShareStatsModal
          trades={trades}
          moods={moods}
          onClose={() => setShowShare(false)}
        />
      )}
      {showDelay && (
        <DecisionDelayModal
          onConfirm={() => { setShowDelay(false); setShowAdd(true) }}
          onCancel={() => setShowDelay(false)}
        />
      )}
      {showImport && <ExchangeSyncModal onClose={() => setShowImport(false)} />}
    </div>
  )
}

// ── Emotion Curve Chart ────────────────────────────────────────────────────

function EmotionCurve({ moods }: { moods: MoodEntry[] }) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hoverIdx, setHoverIdx] = useState<number|null>(null)
  const [period, setPeriod] = useState<'7j'|'1M'|'3M'|'all'>('all')

  const sorted = [...moods].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

  const periodDays = period === '7j' ? 7 : period === '1M' ? 30 : period === '3M' ? 90 : 99999
  const cutoff = Date.now() - periodDays * 86400000
  const filtered = sorted.filter(m => m.timestamp.getTime() >= cutoff)

  const emotionToScore = (e: EmotionalState): number => EMOTION_SCORE[e] ?? 3

  const points = filtered.map(m => {
    const em = EMOTIONS.find(e => e.v === m.emotionalState)
    return {
      date: m.timestamp,
      score: emotionToScore(m.emotionalState),
      intensity: m.intensity,
      emotion: m.emotionalState,
      emoji: em?.emoji ?? '😐',
      label: em ? (em.labelKey ? t(em.labelKey) : em.fallback) : '—',
      color: em?.color ?? 'var(--tm-text-secondary)',
      notes: m.notes,
    }
  })

  // Moving average (3 pts)
  const ma = points.map((p, i) => {
    if (i < 1) return p.score
    const win = points.slice(Math.max(0, i - 2), i + 1)
    return win.reduce((a, b) => a + b.score, 0) / win.length
  })

  // Stats
  const avgScore = points.length ? points.reduce((a, p) => a + p.score, 0) / points.length : 0
  const trend = points.length >= 3 ? (ma[ma.length - 1] - ma[Math.max(0, ma.length - 4)]) : 0
  const bestEmotion = points.length ? (() => {
    const counts: Record<string, number> = {}
    points.forEach(p => { counts[p.label] = (counts[p.label] || 0) + 1 })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
  })() : '—'

  useEffect(() => {
    const c = canvasRef.current; if (!c || points.length < 2) return
    const dpr = window.devicePixelRatio || 1
    const cssW = c.offsetWidth || 700, cssH = 180
    c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr)
    c.style.width = cssW + 'px'; c.style.height = cssH + 'px'
    const ctx = c.getContext('2d')!; ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, cssW, cssH)

    const PAD = { t:14, r:12, b:26, l:40 }
    const cW = cssW - PAD.l - PAD.r, cH = cssH - PAD.t - PAD.b
    const toX = (i: number) => PAD.l + (i / (points.length - 1)) * cW
    const toY = (v: number) => PAD.t + cH - ((v - 0.5) / 5) * cH

    // Colored zone backgrounds
    const zones = [
      { y1:5, y2:3.5, color:`rgba(${resolveCSSColor('var(--tm-profit-rgb','34,199,89')},0.04)`, label:'Zone optimale' },
      { y1:3.5, y2:2.5, color:`rgba(${resolveCSSColor('var(--tm-warning-rgb','255,149,0')},0.03)`, label:'Zone neutre' },
      { y1:2.5, y2:0.5, color:`rgba(${resolveCSSColor('var(--tm-loss-rgb','255,59,48')},0.04)`, label:'Zone à risque' },
    ]
    zones.forEach(z => {
      ctx.fillStyle = z.color
      ctx.fillRect(PAD.l, toY(z.y1), cW, toY(z.y2) - toY(z.y1))
    })

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1
    for (let v = 1; v <= 5; v++) {
      const y = toY(v)
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(cssW - PAD.r, y); ctx.stroke()
    }
    // Dashed middle line
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.setLineDash([4, 4])
    ctx.beginPath(); ctx.moveTo(PAD.l, toY(3)); ctx.lineTo(cssW - PAD.r, toY(3)); ctx.stroke()
    ctx.setLineDash([])

    // Y labels
    ctx.font = '9px JetBrains Mono,monospace'; ctx.textAlign = 'right'
    ctx.fillStyle = resolveCSSColor('--tm-profit','#22C759'); ctx.fillText('😎 5', PAD.l - 4, toY(5) + 4)
    ctx.fillStyle = resolveCSSColor('--tm-text-secondary','#8F94A3'); ctx.fillText('😐 3', PAD.l - 4, toY(3) + 4)
    ctx.fillStyle = resolveCSSColor('--tm-loss','#FF3B30'); ctx.fillText('😰 1', PAD.l - 4, toY(1) + 4)

    // Moving average fill
    const maG = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + cH)
    maG.addColorStop(0, getCSSPurpleColor(0.15)); maG.addColorStop(1, getCSSPurpleColor(0))
    ctx.beginPath()
    ma.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)))
    ctx.lineTo(toX(points.length - 1), PAD.t + cH); ctx.lineTo(toX(0), PAD.t + cH)
    ctx.closePath(); ctx.fillStyle = maG; ctx.fill()

    // Moving average line
    ctx.beginPath(); ctx.strokeStyle = `rgba(${resolveCSSColor('var(--tm-purple-rgb','191,90,242')},0.5)`; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3])
    ma.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)))
    ctx.stroke(); ctx.setLineDash([])

    // Main line with gradient color
    for (let i = 1; i < points.length; i++) {
      const x1 = toX(i - 1), y1t = toY(points[i - 1].score)
      const x2 = toX(i), y2t = toY(points[i].score)
      ctx.beginPath(); ctx.moveTo(x1, y1t); ctx.lineTo(x2, y2t)
      ctx.strokeStyle = points[i].score >= 3.5 ? 'var(--tm-profit)' : points[i].score >= 2.5 ? 'var(--tm-warning)' : 'var(--tm-loss)'
      ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.stroke()
    }

    // Dots with emoji color
    points.forEach((p, i) => {
      const x = toX(i), y = toY(p.score)
      const isHov = i === hoverIdx
      ctx.beginPath(); ctx.arc(x, y, isHov ? 7 : 3.5, 0, Math.PI * 2)
      ctx.fillStyle = isHov ? p.color : p.color + '99'; ctx.fill()
      if (isHov) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke() }
    })

    // X labels
    const step = Math.max(1, Math.ceil(points.length / 8))
    ctx.fillStyle = resolveCSSColor('--tm-text-muted','#555C70'); ctx.font = '9px JetBrains Mono,monospace'; ctx.textAlign = 'center'
    points.forEach((p, i) => {
      if (i % step === 0 || i === points.length - 1)
        ctx.fillText(p.date.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit' }), toX(i), cssH - 6)
    })

    // Crosshair
    if (hoverIdx !== null && hoverIdx >= 0 && hoverIdx < points.length) {
      const hx = toX(hoverIdx)
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3])
      ctx.beginPath(); ctx.moveTo(hx, PAD.t); ctx.lineTo(hx, PAD.t + cH); ctx.stroke()
      ctx.setLineDash([])
    }
  }, [points, hoverIdx, ma])

  const onMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current; if (!c || points.length < 2) return
    const rect = c.getBoundingClientRect()
    const PAD_L = 40, PAD_R = 12
    const x = e.clientX - rect.left
    const pct = Math.max(0, Math.min(1, (x - PAD_L) / (rect.width - PAD_L - PAD_R)))
    setHoverIdx(Math.round(pct * (points.length - 1)))
  }, [points.length])

  const hoveredPt = hoverIdx !== null ? points[hoverIdx] : null

  if (points.length < 2) return null

  return (
    <div ref={wrapRef} style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:12, padding:'14px 16px', marginBottom:16 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:28, height:28, borderRadius:8, background:`rgba(${resolveCSSColor('var(--tm-purple-rgb','191,90,242')},0.15)`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}>📈</div>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--tm-text-primary)' }}>{t('journal.emotionCurve')}</div>
            <div style={{ fontSize:10, color:'var(--tm-text-muted)' }}>{points.length} entrées · {t('journal.avgScore')} {avgScore.toFixed(1)}/5</div>
          </div>
        </div>
        <div style={{ display:'flex', gap:4 }}>
          {(['7j','1M','3M','all'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              padding:'3px 10px', borderRadius:20, fontSize:10, fontWeight:600, cursor:'pointer',
              border:`1px solid ${period === p ? 'var(--tm-purple)' : 'var(--tm-border)'}`,
              background: period === p ? `rgba(${resolveCSSColor('var(--tm-purple-rgb','191,90,242')},0.15)` : 'transparent',
              color: period === p ? 'var(--tm-purple)' : 'var(--tm-text-muted)',
            }}>{p === 'all' ? t('common.all') : p}</button>
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, marginBottom:12 }}>
        {[
          { label:t('journal.avgScore'), value:avgScore.toFixed(1), color:avgScore>=3.5?'var(--tm-profit)':avgScore>=2.5?'var(--tm-warning)':'var(--tm-loss)', icon:'📊' },
          { label:t('journal.trend'), value:trend>0.2?t('journal.improving'):trend<-0.2?t('journal.declining'):t('journal.stable'), color:trend>0.2?'var(--tm-profit)':trend<-0.2?'var(--tm-loss)':'var(--tm-text-secondary)', icon:trend>0.2?'📈':trend<-0.2?'📉':'➡️' },
          { label:t('journal.dominantEmotion'), value:bestEmotion, color:'var(--tm-purple)', icon:'💜' },
          { label:t('journal.lastEntry'), value:points[points.length-1]?.label, color:points[points.length-1]?.color ?? 'var(--tm-text-secondary)', icon:'🕐' },
        ].map(({ label, value, color, icon }) => (
          <div key={label} style={{ background:'rgba(255,255,255,0.02)', border:'1px solid #1E2330', borderRadius:8, padding:'8px 10px' }}>
            <div style={{ fontSize:9, color:'var(--tm-text-muted)', marginBottom:3 }}>{icon} {label}</div>
            <div style={{ fontSize:11, fontWeight:700, color, fontFamily:'JetBrains Mono,monospace' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Hover info */}
      {hoveredPt && (
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 10px', background:`rgba(${resolveCSSColor('var(--tm-purple-rgb','191,90,242')},0.06)`, border:'1px solid rgba(var(--tm-purple-rgb,191,90,242),0.15)', borderRadius:8, marginBottom:8 }}>
          <span style={{ fontSize:18 }}>{hoveredPt.emoji}</span>
          <div style={{ flex:1 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:12, fontWeight:700, color:hoveredPt.color }}>{hoveredPt.label}</span>
              <span style={{ fontSize:10, color:'var(--tm-text-muted)', fontFamily:'JetBrains Mono,monospace' }}>Score: {hoveredPt.score}/5</span>
              <span style={{ fontSize:10, color:'var(--tm-text-muted)' }}>·</span>
              <span style={{ fontSize:10, color:'var(--tm-text-secondary)' }}>{t('journal.intensityLabel', { value: hoveredPt.intensity })}</span>
            </div>
            <div style={{ fontSize:10, color:'var(--tm-text-muted)', fontFamily:'JetBrains Mono,monospace' }}>
              {hoveredPt.date.toLocaleDateString('fr-FR', { weekday:'short', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
            </div>
          </div>
          {hoveredPt.notes && <div style={{ fontSize:10, color:'var(--tm-text-secondary)', maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>"{hoveredPt.notes}"</div>}
        </div>
      )}

      <canvas ref={canvasRef} width={700} height={180}
        onMouseMove={onMove} onMouseLeave={() => setHoverIdx(null)}
        style={{ width:'100%', height:180, display:'block', borderRadius:8, cursor:'crosshair' }} />

      {/* Legend */}
      <div style={{ display:'flex', gap:14, marginTop:8, justifyContent:'center' }}>
        {[
          { color:'var(--tm-profit)', label:t('journal.zoneOptimal') },
          { color:'var(--tm-warning)', label:t('journal.zoneNeutral') },
          { color:'var(--tm-loss)', label:t('journal.riskZone') },
          { color:`rgba(${resolveCSSColor('var(--tm-purple-rgb','191,90,242')},0.5)`, label:t('journal.movingAvg'), dash:true },
        ].map(({ color, label, dash }) => (
          <div key={label} style={{ display:'flex', alignItems:'center', gap:4 }}>
            <div style={{ width:12, height:2, background:color, borderRadius:1, ...(dash ? { backgroundImage:`repeating-linear-gradient(90deg,${color} 0,${color} 4px,transparent 4px,transparent 7px)`, background:'none' } : {}) }} />
            <span style={{ fontSize:9, color:'var(--tm-text-muted)' }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Add Mood Modal ─────────────────────────────────────────────────────────

function AddMoodModal({ trades, onClose }: { trades: Trade[]; onClose: () => void }) {
  const { t } = useTranslation()
  const [state,   setState]   = useState<EmotionalState>('calm')
  const [intensity, setIntensity] = useState(5)
  const [context, setContext] = useState<MoodContext>('general')
  const [notes,   setNotes]   = useState('')
  const [tradeId, setTradeId] = useState('')
  const [saving,  setSaving]  = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await createMood({
        id: crypto.randomUUID(),
        emotionalState: state,
        intensity,
        timestamp: new Date(),
        context,
        tags: [],
        isExceptional: intensity >= 9,
        tradeId: tradeId || undefined,
        notes: notes || undefined,
      })
      onClose()
    } catch(e) { alert((e as Error).message) }
    finally { setSaving(false) }
  }

  const em = emotionInfo(state)

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
      <div style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:16, padding:24, width:460, maxWidth:'95vw', maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:18 }}>
          <span style={{ fontSize:16, fontWeight:700, color:'var(--tm-text-primary)' }}>{t('journal.newEntry')}</span>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--tm-text-muted)', cursor:'pointer', fontSize:18 }}>✕</button>
        </div>

        {/* Emotion grid */}
        <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:8 }}>{t('journal.emotionalState')}</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:6, marginBottom:14 }}>
          {EMOTIONS.map(e => (
            <button key={e.v} onClick={() => setState(e.v)} style={{ padding:'8px 4px', borderRadius:8, border:`1px solid ${state===e.v?e.color:'var(--tm-border)'}`, background: state===e.v?`${e.color}`:'var(--tm-bg-tertiary)', cursor:'pointer', textAlign:'center' }}>
              <div style={{ fontSize:18 }}>{e.emoji}</div>
              <div style={{ fontSize:9, color: state===e.v?e.color:'var(--tm-text-muted)', marginTop:2 }}>{t(e.labelKey)}</div>
            </button>
          ))}
        </div>

        {/* Intensity */}
        <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:6 }}>{t('journal.intensityLabel', { value: intensity })}</div>
        <input type="range" min={1} max={10} value={intensity} onChange={e => setIntensity(Number(e.target.value))}
          style={{ width:'100%', marginBottom:14, accentColor:em.color }} />

        {/* Context */}
        <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:6 }}>{t('journal.context')}</div>
        <div style={{ display:'flex', gap:6, marginBottom:14, flexWrap:'wrap' }}>
          {CONTEXTS.map(c => (
            <button key={c.v} onClick={() => setContext(c.v)} style={{ padding:'5px 10px', borderRadius:6, border:`1px solid ${context===c.v?'var(--tm-accent)':'var(--tm-border)'}`, background: context===c.v?`rgba(${resolveCSSColor('var(--tm-accent-rgb','0,229,255')},0.1)`:'var(--tm-bg-tertiary)', cursor:'pointer', fontSize:11, color: context===c.v?'var(--tm-accent)':'var(--tm-text-secondary)' }}>
              {t(c.labelKey)}
            </button>
          ))}
        </div>

        {/* Linked trade */}
        {trades.length > 0 && (
          <>
            <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:6 }}>{t('journal.linkedTrade')}</div>
            <select value={tradeId} onChange={e => setTradeId(e.target.value)}
              style={{ width:'100%', padding:'8px 10px', borderRadius:8, border:'1px solid #2A2F3E', background:'var(--tm-bg-tertiary)', color:'var(--tm-text-primary)', fontSize:13, outline:'none', marginBottom:14, cursor:'pointer' }}>
              <option value="">{t('journal.noTrade')}</option>
              {trades.slice(0,20).map(tr => (
                <option key={tr.id} value={tr.id}>{tr.symbol} {tr.type} {tr.date.toLocaleDateString('fr-FR')}</option>
              ))}
            </select>
          </>
        )}

        {/* Notes */}
        <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:6 }}>{t('journal.notes')}</div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('journal.notesPlaceholder')} rows={3}
          style={{ width:'100%', padding:'8px 10px', borderRadius:8, border:'1px solid #2A2F3E', background:'var(--tm-bg-tertiary)', color:'var(--tm-text-primary)', fontSize:13, outline:'none', resize:'vertical', marginBottom:16, boxSizing:'border-box' }} />

        <button onClick={save} disabled={saving} style={{ width:'100%', padding:10, borderRadius:10, border:'none', background:'var(--tm-accent)', color:'var(--tm-bg)', fontSize:14, fontWeight:600, cursor:'pointer' }}>
          {saving ? t('common.saving') : `${t('common.save')} — ${em.emoji} ${t(em.labelKey)} ${intensity}/10`}
        </button>
      </div>
    </div>
  )
}
