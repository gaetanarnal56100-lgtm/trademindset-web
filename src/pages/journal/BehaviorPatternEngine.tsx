// src/pages/journal/BehaviorPatternEngine.tsx
// Analyse comportementale sur l'historique des trades — "Behavior Pattern Engine"
// Détecte : jour de la semaine, session, post-win/loss, overtrading, etc.

import { useMemo, useState } from 'react'
import { tradePnL, type Trade } from '@/services/firestore'

// ── Helpers ────────────────────────────────────────────────────────────────────

function safeTime(d: any): number {
  if (!d) return 0
  if (typeof d?.getTime === 'function') { const t = d.getTime(); return isNaN(t) ? 0 : t }
  if (typeof d?.seconds === 'number') return d.seconds * 1000
  if (typeof d === 'number') return d
  return 0
}

const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']
const DAYS_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']

function sessionLabel(hour: number): string {
  if (hour >= 0  && hour < 7)  return 'Asie'
  if (hour >= 7  && hour < 12) return 'Europe pré-open'
  if (hour >= 12 && hour < 16) return 'Europe'
  if (hour >= 16 && hour < 22) return 'New York'
  return 'After Hours'
}

interface Pattern {
  icon: string
  title: string
  insight: string
  severity: 'danger' | 'warning' | 'good' | 'info'
  value?: string
}

// ── Main computation ───────────────────────────────────────────────────────────

function computePatterns(trades: Trade[]): Pattern[] {
  const closed = trades
    .filter(t => t.status === 'closed')
    .sort((a, b) => safeTime(a.date) - safeTime(b.date))

  if (closed.length < 5) return []

  const patterns: Pattern[] = []

  // ── 1. Jour de la semaine ─────────────────────────────────────────────────
  const byDay: Record<number, { wins: number; total: number; pnl: number }> = {}
  for (let d = 0; d < 7; d++) byDay[d] = { wins: 0, total: 0, pnl: 0 }

  closed.forEach(t => {
    const d = new Date(safeTime(t.date)).getDay()
    const p = tradePnL(t)
    byDay[d].total++
    byDay[d].pnl += p
    if (p > 0) byDay[d].wins++
  })

  const activeDays = Object.entries(byDay).filter(([, v]) => v.total >= 3)
  if (activeDays.length >= 2) {
    const best  = activeDays.reduce((a, b) => (a[1].pnl > b[1].pnl ? a : b))
    const worst = activeDays.reduce((a, b) => (a[1].pnl < b[1].pnl ? a : b))

    if (worst[1].pnl < 0) {
      const wr = worst[1].total > 0 ? (worst[1].wins / worst[1].total * 100).toFixed(0) : 0
      patterns.push({
        icon: '📅',
        title: `${DAYS[+worst[0]]} = jour à risque`,
        insight: `Win Rate de ${wr}% le ${DAYS[+worst[0]].toLowerCase()} — évite de surtrader ce jour`,
        severity: 'danger',
        value: `${wr}% WR`,
      })
    }
    if (best[1].pnl > 0) {
      const wr = best[1].total > 0 ? (best[1].wins / best[1].total * 100).toFixed(0) : 0
      patterns.push({
        icon: '🏆',
        title: `${DAYS[+best[0]]} = meilleur jour`,
        insight: `P&L le plus élevé le ${DAYS[+best[0]].toLowerCase()} avec ${wr}% de Win Rate`,
        severity: 'good',
        value: `${wr}% WR`,
      })
    }
  }

  // ── 2. Performance après une perte vs après un gain ───────────────────────
  let afterWinWins = 0, afterWinTotal = 0
  let afterLossWins = 0, afterLossTotal = 0

  for (let i = 1; i < closed.length; i++) {
    const prevPnL = tradePnL(closed[i - 1])
    const currPnL = tradePnL(closed[i])
    if (prevPnL > 0) {
      afterWinTotal++
      if (currPnL > 0) afterWinWins++
    } else {
      afterLossTotal++
      if (currPnL > 0) afterLossWins++
    }
  }

  const wrAfterWin  = afterWinTotal  > 3 ? afterWinWins  / afterWinTotal  * 100 : null
  const wrAfterLoss = afterLossTotal > 3 ? afterLossWins / afterLossTotal * 100 : null

  if (wrAfterLoss !== null && wrAfterLoss < 40) {
    patterns.push({
      icon: '🔄',
      title: 'Revenge trading probable',
      insight: `Win Rate de ${wrAfterLoss.toFixed(0)}% sur le trade suivant une perte — attends avant de re-rentrer`,
      severity: 'danger',
      value: `${wrAfterLoss.toFixed(0)}% WR`,
    })
  } else if (wrAfterLoss !== null && wrAfterWin !== null) {
    const diff = wrAfterWin - wrAfterLoss
    if (diff > 15) {
      patterns.push({
        icon: '⚖️',
        title: 'Impact émotionnel détecté',
        insight: `+${diff.toFixed(0)}pts de WR après une victoire vs après une perte — tes émotions affectent tes décisions`,
        severity: 'warning',
        value: `Δ${diff.toFixed(0)}pts`,
      })
    }
  }

  // ── 3. Session horaire (si heure disponible) ───────────────────────────────
  const bySession: Record<string, { wins: number; total: number; pnl: number }> = {}

  closed.forEach(t => {
    const ts = safeTime(t.date)
    if (!ts) return
    const hour = new Date(ts).getHours()
    const session = sessionLabel(hour)
    if (!bySession[session]) bySession[session] = { wins: 0, total: 0, pnl: 0 }
    const p = tradePnL(t)
    bySession[session].total++
    bySession[session].pnl += p
    if (p > 0) bySession[session].wins++
  })

  const sessions = Object.entries(bySession).filter(([, v]) => v.total >= 3)
  if (sessions.length >= 2) {
    const bestSession  = sessions.reduce((a, b) => (a[1].pnl > b[1].pnl ? a : b))
    const worstSession = sessions.reduce((a, b) => (a[1].pnl < b[1].pnl ? a : b))

    if (bestSession[1].pnl > 0) {
      const wr = (bestSession[1].wins / bestSession[1].total * 100).toFixed(0)
      patterns.push({
        icon: '⏰',
        title: `Session ${bestSession[0]} = meilleure`,
        insight: `${wr}% Win Rate pendant la session ${bestSession[0]} — concentre ton énergie ici`,
        severity: 'good',
        value: `${wr}% WR`,
      })
    }
    if (worstSession[1].pnl < 0 && worstSession[0] !== bestSession[0]) {
      const wr = (worstSession[1].wins / worstSession[1].total * 100).toFixed(0)
      patterns.push({
        icon: '🚫',
        title: `Session ${worstSession[0]} = à risque`,
        insight: `Seulement ${wr}% Win Rate pendant ${worstSession[0]} — considère d'éviter cette session`,
        severity: 'danger',
        value: `${wr}% WR`,
      })
    }
  }

  // ── 4. Overtrading (jours avec > 2× la moyenne de trades) ────────────────
  const byDateStr: Record<string, { total: number; pnl: number }> = {}
  closed.forEach(t => {
    const ts = safeTime(t.date)
    if (!ts) return
    const key = new Date(ts).toLocaleDateString('fr-FR')
    if (!byDateStr[key]) byDateStr[key] = { total: 0, pnl: 0 }
    byDateStr[key].total++
    byDateStr[key].pnl += tradePnL(t)
  })

  const days = Object.values(byDateStr)
  if (days.length >= 5) {
    const avgPerDay = days.reduce((s, d) => s + d.total, 0) / days.length
    const overtradeDays = days.filter(d => d.total > avgPerDay * 2)
    const overtradeLossDays = overtradeDays.filter(d => d.pnl < 0)

    if (overtradeDays.length > 0) {
      const lossRate = (overtradeLossDays.length / overtradeDays.length * 100).toFixed(0)
      patterns.push({
        icon: '📈',
        title: 'Surtrading détecté',
        insight: `${lossRate}% de tes jours à fort volume (>2× la moyenne) sont perdants — moins = mieux`,
        severity: +lossRate > 50 ? 'danger' : 'warning',
        value: `Moy: ${avgPerDay.toFixed(1)}/j`,
      })
    }
  }

  // ── 5. Streak analysis — performance après 2+ gains consécutifs ───────────
  let afterHotStreak = 0, afterHotTotal = 0
  let streak = 0
  for (let i = 0; i < closed.length - 1; i++) {
    const p = tradePnL(closed[i])
    if (p > 0) { streak++ } else { streak = 0 }
    if (streak >= 2) {
      afterHotTotal++
      if (tradePnL(closed[i + 1]) > 0) afterHotStreak++
    }
  }

  if (afterHotTotal >= 3) {
    const wrHot = (afterHotStreak / afterHotTotal * 100).toFixed(0)
    if (+wrHot < 40) {
      patterns.push({
        icon: '🔥',
        title: 'Excès de confiance après une série',
        insight: `Seulement ${wrHot}% WR après 2 gains de suite — la confiance excessive coûte cher`,
        severity: 'warning',
        value: `${wrHot}% WR`,
      })
    }
  }

  return patterns.slice(0, 6)
}

// ── Component ──────────────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<Pattern['severity'], { bg: string; border: string; color: string; badge: string }> = {
  danger:  { bg: 'rgba(255,59,48,0.06)',   border: 'rgba(255,59,48,0.2)',   color: '#FF3B30', badge: 'rgba(255,59,48,0.15)' },
  warning: { bg: 'rgba(255,149,0,0.06)',   border: 'rgba(255,149,0,0.2)',   color: '#FF9500', badge: 'rgba(255,149,0,0.15)' },
  good:    { bg: 'rgba(34,199,89,0.06)',   border: 'rgba(34,199,89,0.2)',   color: '#22C759', badge: 'rgba(34,199,89,0.15)'  },
  info:    { bg: 'rgba(0,229,255,0.04)',   border: 'rgba(0,229,255,0.15)',  color: '#00E5FF', badge: 'rgba(0,229,255,0.1)'  },
}

export default function BehaviorPatternEngine({ trades }: { trades: Trade[] }) {
  const [expanded, setExpanded] = useState(true)
  const patterns = useMemo(() => computePatterns(trades), [trades])

  if (trades.filter(t => t.status === 'closed').length < 5) return null

  return (
    <div style={{
      background: 'var(--tm-bg-secondary)',
      border: '1px solid #2A2F3E',
      borderRadius: 14,
      overflow: 'hidden',
      marginBottom: 16,
    }}>
      {/* Header */}
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>🧬</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-primary)' }}>Behavior Pattern Engine</span>
          {patterns.length > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: 'rgba(255,149,0,0.15)', color: '#FF9500' }}>
              {patterns.length} insight{patterns.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <span style={{ fontSize: 12, color: 'var(--tm-text-muted)' }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {patterns.length === 0 ? (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--tm-text-muted)', fontSize: 12 }}>
              Pas assez de données — ajoute plus de trades pour générer des insights
            </div>
          ) : (
            patterns.map((p, i) => {
              const s = SEVERITY_STYLES[p.severity]
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12,
                  padding: '10px 12px', borderRadius: 10,
                  background: s.bg, border: `1px solid ${s.border}`,
                }}>
                  <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1 }}>{p.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: s.color, marginBottom: 3 }}>{p.title}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>{p.insight}</div>
                  </div>
                  {p.value && (
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: s.color,
                      padding: '3px 8px', borderRadius: 6, background: s.badge,
                      flexShrink: 0, fontFamily: 'JetBrains Mono, monospace',
                    }}>
                      {p.value}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
