// src/components/share/ShareStatsModal.tsx
// Modal aperçu + personnalisation + partage
import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/services/firebase/config'
import { useUser } from '@/hooks/useAuth'
import { tradePnL, type Trade, type MoodEntry, type EmotionalState } from '@/services/firestore'
import ShareStatsCard, {
  DEFAULT_CONFIG, THEME_COLORS,
  type ShareCardConfig, type CardTheme,
} from './ShareStatsCard'

// ── Types ──────────────────────────────────────────────────────────────────────

type Period = '1W' | '1M' | '3M' | '6M' | 'YTD' | 'ALL'

// ── Helpers ────────────────────────────────────────────────────────────────────

function safeTime(d: any): number {
  if (!d) return 0
  if (typeof d?.getTime === 'function') { const t = d.getTime(); return isNaN(t) ? 0 : t }
  if (typeof d?.seconds === 'number') return d.seconds * 1000
  if (typeof d === 'number') return d
  return 0
}

function periodCutoff(period: Period): number {
  const now = Date.now()
  switch (period) {
    case '1W':  return now - 7   * 864e5
    case '1M':  return now - 30  * 864e5
    case '3M':  return now - 90  * 864e5
    case '6M':  return now - 180 * 864e5
    case 'YTD': {
      const y = new Date().getFullYear()
      return new Date(`${y}-01-01`).getTime()
    }
    case 'ALL': return 0
  }
}

function filterByPeriod(trades: Trade[], period: Period): Trade[] {
  const cutoff = periodCutoff(period)
  return trades.filter(t => safeTime(t.date) >= cutoff)
}

function calcShareStats(trades: Trade[]) {
  const closed = trades
    .filter(t => t.status === 'closed')
    .sort((a, b) => safeTime(a.date) - safeTime(b.date))
  const pnls   = closed.map(tradePnL)
  const wins   = pnls.filter(p => p > 0)
  const losses = pnls.filter(p => p <= 0)

  const totalPnL    = pnls.reduce((a, b) => a + b, 0)
  const winRate     = closed.length > 0 ? (wins.length / closed.length) * 100 : 0
  const avgWin      = wins.length   > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0
  const avgLoss     = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0
  const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : 0
  const expectancy  = (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss
  const profitFactor = (avgLoss * losses.length) > 0
    ? (avgWin * wins.length) / (avgLoss * losses.length)
    : 0

  let cum = 0, peak = 0, maxDD = 0
  for (const p of pnls) {
    cum += p
    if (cum > peak) peak = cum
    const dd = peak - cum
    if (dd > maxDD) maxDD = dd
  }

  // Sharpe (annualisé par rapport au trade moyen)
  const returns = pnls.map(p => p / (Math.max(Math.abs(totalPnL), 1)) * 100)
  const avgRet  = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0
  const variance = returns.length ? returns.reduce((a, b) => a + Math.pow(b - avgRet, 2), 0) / returns.length : 0
  const sharpe   = Math.sqrt(variance) > 0 ? avgRet / Math.sqrt(variance) : 0

  // Best streak
  let bestStreak = 0, cur = 0
  for (const p of pnls) {
    cur = p > 0 ? (cur > 0 ? cur + 1 : 1) : (cur < 0 ? cur - 1 : -1)
    if (cur > bestStreak) bestStreak = cur
  }

  // Longs win rate
  const longs       = closed.filter(t => t.type === 'long' || t.type === 'buy')
  const longsWins   = longs.filter(t => tradePnL(t) > 0)
  const longsWR     = longs.length > 0 ? (longsWins.length / longs.length) * 100 : 0

  return {
    totalPnL, winRate, payoffRatio, expectancy, maxDD, sharpe,
    bestStreak, totalTrades: closed.length, profitFactor, avgWin, avgLoss, longsWR,
  }
}

function buildPnLCurve(trades: Trade[], period: Period): number[] {
  const cutoff = periodCutoff(period)
  const closed = trades
    .filter(t => t.status === 'closed' && safeTime(t.date) >= cutoff)
    .sort((a, b) => safeTime(a.date) - safeTime(b.date))
  if (!closed.length) return []
  let cum = 0
  return closed.map(t => { cum += tradePnL(t); return cum })
}

function dominantEmotion(moods: MoodEntry[], period: Period): EmotionalState | null {
  const cutoff = periodCutoff(period)
  const filtered = moods.filter(m => safeTime(m.timestamp) >= cutoff)
  if (!filtered.length) return null
  const counts: Record<string, number> = {}
  filtered.forEach(m => { counts[m.emotionalState] = (counts[m.emotionalState] || 0) + 1 })
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'calm') as EmotionalState
}

// ── Sub-components ────────────────────────────────────────────────────────────────

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      style={{
        width: 32, height: 18, borderRadius: 99, border: 'none', cursor: 'pointer',
        background: on ? 'rgba(0,229,255,0.8)' : 'rgba(255,255,255,0.1)',
        position: 'relative', flexShrink: 0, transition: 'background 0.2s',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: on ? 16 : 2,
        width: 14, height: 14, borderRadius: '50%',
        background: on ? '#0D1117' : 'rgba(255,255,255,0.4)',
        transition: 'left 0.2s',
      }} />
    </button>
  )
}

function MetricChip({
  label, active, disabled, onChange,
}: { label: string; active: boolean; disabled: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      title={disabled && !active ? 'Maximum 4 métriques' : undefined}
      style={{
        padding: '4px 10px', borderRadius: 99, cursor: disabled && !active ? 'not-allowed' : 'pointer',
        fontSize: 11, fontWeight: 600, border: 'none',
        background: active ? 'rgba(0,229,255,0.15)' : 'rgba(255,255,255,0.05)',
        color: active ? '#00E5FF' : disabled && !active ? '#3A3F4E' : '#6B7280',
        outline: active ? '1px solid rgba(0,229,255,0.35)' : '1px solid transparent',
        transition: 'all 0.15s',
      }}
    >
      {active && '✓ '}{label}
    </button>
  )
}

// ── Constants ──────────────────────────────────────────────────────────────────

interface ShareStatsModalProps {
  trades: Trade[]
  moods:  MoodEntry[]
  onClose: () => void
}

const METRIC_LABELS: { key: keyof ShareCardConfig['metrics']; label: string }[] = [
  { key: 'winRate',      label: 'Win Rate' },
  { key: 'payoffRatio',  label: 'R/R Ratio' },
  { key: 'totalPnL',     label: 'P&L Net' },
  { key: 'totalTrades',  label: 'Trades' },
  { key: 'maxDD',        label: 'Max Drawdown' },
  { key: 'expectancy',   label: 'Espérance' },
  { key: 'sharpe',       label: 'Sharpe Ratio' },
  { key: 'bestStreak',   label: 'Streak Max' },
  { key: 'profitFactor', label: 'Profit Factor' },
  { key: 'avgWin',       label: 'Gain Moyen' },
  { key: 'avgLoss',      label: 'Perte Moyenne' },
  { key: 'longsWR',      label: 'WR Longs' },
]

const THEMES: { v: CardTheme; label: string }[] = [
  { v: 'cyan',    label: 'Cyan' },
  { v: 'purple',  label: 'Purple' },
  { v: 'gold',    label: 'Gold' },
  { v: 'red',     label: 'Red' },
  { v: 'minimal', label: 'Minimal' },
]

const PERIODS: { v: Period; label: string }[] = [
  { v: '1W',  label: '1 sem.' },
  { v: '1M',  label: '1 mois' },
  { v: '3M',  label: '3 mois' },
  { v: '6M',  label: '6 mois' },
  { v: 'YTD', label: 'Année' },
  { v: 'ALL', label: 'Tout' },
]

// ── Modal ──────────────────────────────────────────────────────────────────────

export default function ShareStatsModal({ trades, moods, onClose }: ShareStatsModalProps) {
  const user = useUser()
  const [period, setPeriod] = useState<Period>(() => {
    try {
      const saved = localStorage.getItem('tm_share_period') as Period
      if (['1W','1M','3M','6M','YTD','ALL'].includes(saved)) return saved
    } catch { /* ignore */ }
    return '1M'
  })
  const [config, setConfig] = useState<ShareCardConfig>(() => {
    try {
      const saved = localStorage.getItem('tm_share_config')
      if (saved) {
        const parsed = JSON.parse(saved) as ShareCardConfig
        return {
          ...DEFAULT_CONFIG,
          ...parsed,
          metrics: { ...DEFAULT_CONFIG.metrics, ...parsed.metrics },
        }
      }
    } catch { /* ignore */ }
    return DEFAULT_CONFIG
  })
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null)
  const [profileName,  setProfileName]  = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [showCustomize, setShowCustomize] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  // Firestore user doc
  useEffect(() => {
    const uid = user?.uid
    if (!uid) return
    const unsub = onSnapshot(doc(db, 'users', uid), (snap) => {
      if (snap.exists()) {
        const d = snap.data()
        setProfilePhoto(d.photoBase64 || d.photoURL || null)
        if (d.displayName) setProfileName(d.displayName)
      }
    }, () => {})
    return () => unsub()
  }, [user?.uid])

  // Persistance préférences
  useEffect(() => {
    try { localStorage.setItem('tm_share_config', JSON.stringify(config)) } catch { /* ignore */ }
  }, [config])
  useEffect(() => {
    try { localStorage.setItem('tm_share_period', period) } catch { /* ignore */ }
  }, [period])

  // Fermeture Échap
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Données calculées
  const filtered  = filterByPeriod(trades, period)
  const stats     = calcShareStats(filtered)
  const pnlCurve  = buildPnLCurve(filtered, period)
  const emotion   = dominantEmotion(moods, period)
  const name      = profileName || user?.displayName || 'Trader'
  const accent    = THEME_COLORS[config.theme]

  const activeCount = Object.values(config.metrics).filter(Boolean).length

  const toggleMetric = (key: keyof ShareCardConfig['metrics']) => {
    const current = config.metrics[key]
    if (!current && activeCount >= 4) return
    setConfig(c => ({ ...c, metrics: { ...c.metrics, [key]: !current } }))
  }

  // Partage / Export
  const handleShare = useCallback(async () => {
    const el = cardRef.current
    if (!el || status === 'loading') return
    setStatus('loading')
    try {
      const { toPng } = await import('html-to-image')
      const dataUrl = await toPng(el, {
        quality: 1,
        pixelRatio: 2,
        backgroundColor: '#0D1117',
      })
      const blob = await (await fetch(dataUrl)).blob()
      const filename = `trademindset-stats-${period.toLowerCase()}.png`

      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        setStatus('done'); setTimeout(() => setStatus('idle'), 2500); return
      } catch { /* fallthrough */ }

      if (navigator.share && navigator.canShare) {
        const file = new File([blob], filename, { type: 'image/png' })
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ title: 'Mes stats TradeMindset', files: [file] })
          setStatus('done'); setTimeout(() => setStatus('idle'), 2500); return
        }
      }

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
      setStatus('done'); setTimeout(() => setStatus('idle'), 2500)
    } catch (err) {
      console.warn('Share failed:', err)
      setStatus('error'); setTimeout(() => setStatus('idle'), 2000)
    }
  }, [status, period])

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, overflowY: 'auto',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#111827',
          border: '1px solid #1E2330',
          borderRadius: 20,
          padding: '22px 24px 20px',
          display: 'flex', flexDirection: 'column', gap: 16,
          boxShadow: '0 24px 60px rgba(0,0,0,0.9)',
          width: 700, maxWidth: '100%',
        }}
      >
        {/* ── Top bar ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#F0F2F5', fontFamily: 'Syne, sans-serif' }}>
              📤 Partager mes stats
            </div>
            <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
              Personnalise et exporte ta carte de performance · trademindset.app
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: 20, padding: 4 }}>✕</button>
        </div>

        {/* ── Période ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PERIODS.map(p => (
              <button key={p.v} onClick={() => setPeriod(p.v)} style={{
                padding: '6px 13px', borderRadius: 99, cursor: 'pointer', fontSize: 11, fontWeight: 600, border: 'none',
                background: period === p.v ? `${accent}22` : 'rgba(255,255,255,0.05)',
                color: period === p.v ? accent : '#6B7280',
                outline: period === p.v ? `1px solid ${accent}55` : '1px solid transparent',
                transition: 'all 0.15s',
              }}>
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowCustomize(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 13px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 600,
              background: showCustomize ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${showCustomize ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.07)'}`,
              color: showCustomize ? '#F0F2F5' : '#6B7280',
            }}
          >
            <span style={{ fontSize: 13 }}>{showCustomize ? '▲' : '⚙️'}</span>
            Personnaliser
          </button>
        </div>

        {/* ── Panneau de personnalisation ── */}
        {showCustomize && (
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 14,
            padding: '18px 20px',
            display: 'flex', flexDirection: 'column', gap: 18,
          }}>
            {/* Métriques */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Métriques affichées
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                  background: activeCount >= 4 ? 'rgba(255,149,0,0.15)' : 'rgba(0,229,255,0.1)',
                  color: activeCount >= 4 ? '#FF9500' : '#00E5FF',
                }}>
                  {activeCount}/4 max
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {METRIC_LABELS.map(m => (
                  <MetricChip
                    key={m.key}
                    label={m.label}
                    active={config.metrics[m.key]}
                    disabled={!config.metrics[m.key] && activeCount >= 4}
                    onChange={() => toggleMetric(m.key)}
                  />
                ))}
              </div>
            </div>

            {/* Blocs d'affichage */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
                Blocs d'affichage
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
                {([
                  ['showSparkline',   '📈 Graphique P&L'],
                  ['showEmotion',     '😐 État émotionnel'],
                  ['showAvatar',      '👤 Photo de profil'],
                  ['showPeriodBadge', '📅 Badge de période'],
                  ['showDate',        '🗓 Date de génération'],
                ] as [keyof ShareCardConfig, string][]).map(([k, label]) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.03)' }}>
                    <span style={{ fontSize: 12, color: '#C5C8D6' }}>{label}</span>
                    <Toggle
                      on={config[k] as boolean}
                      onChange={v => setConfig(c => ({ ...c, [k]: v }))}
                    />
                  </div>
                ))}
                {/* Branding toujours actif — info */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: 'rgba(0,229,255,0.04)', border: '1px solid rgba(0,229,255,0.1)' }}>
                  <span style={{ fontSize: 12, color: '#00E5FF', flex: 1 }}>🌐 trademindset.app</span>
                  <span style={{ fontSize: 9, color: '#6B7280', fontStyle: 'italic' }}>Toujours visible</span>
                </div>
              </div>
            </div>

            {/* Thème */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
                Thème de couleur
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {THEMES.map(t => (
                  <button
                    key={t.v}
                    onClick={() => setConfig(c => ({ ...c, theme: t.v }))}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      padding: '6px 14px', borderRadius: 10, cursor: 'pointer',
                      fontSize: 12, fontWeight: 600, border: 'none',
                      background: config.theme === t.v ? `${THEME_COLORS[t.v]}22` : 'rgba(255,255,255,0.04)',
                      outline: config.theme === t.v ? `1px solid ${THEME_COLORS[t.v]}66` : '1px solid rgba(255,255,255,0.07)',
                      color: config.theme === t.v ? THEME_COLORS[t.v] : '#6B7280',
                      transition: 'all 0.15s',
                    }}
                  >
                    <span style={{
                      width: 11, height: 11, borderRadius: '50%',
                      background: THEME_COLORS[t.v],
                      boxShadow: config.theme === t.v ? `0 0 8px ${THEME_COLORS[t.v]}` : 'none',
                      flexShrink: 0,
                    }} />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Card preview ── */}
        <div ref={cardRef} style={{ borderRadius: 16, overflow: 'hidden', flexShrink: 0 }}>
          <ShareStatsCard
            displayName={name}
            photoURL={profilePhoto}
            winRate={stats.winRate}
            payoffRatio={stats.payoffRatio}
            totalPnL={stats.totalPnL}
            totalTrades={stats.totalTrades}
            maxDD={stats.maxDD}
            expectancy={stats.expectancy}
            sharpe={stats.sharpe}
            bestStreak={stats.bestStreak}
            profitFactor={stats.profitFactor}
            avgWin={stats.avgWin}
            avgLoss={stats.avgLoss}
            longsWR={stats.longsWR}
            dominantEmotion={emotion}
            pnlCurve={pnlCurve}
            period={period}
            config={config}
          />
        </div>

        {/* ── Stats résumé période ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
          {[
            { label: 'Trades', value: stats.totalTrades },
            { label: 'Win Rate', value: `${stats.winRate.toFixed(1)}%` },
            { label: 'P&L Net', value: stats.totalPnL >= 0 ? `+$${stats.totalPnL.toFixed(0)}` : `-$${Math.abs(stats.totalPnL).toFixed(0)}` },
            { label: 'Profit Factor', value: stats.profitFactor.toFixed(2) },
          ].map(item => (
            <div key={item.label} style={{ textAlign: 'center', padding: '8px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#F0F2F5', fontFamily: 'JetBrains Mono, monospace' }}>{item.value}</div>
              <div style={{ fontSize: 9, color: '#6B7280', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{item.label}</div>
            </div>
          ))}
        </div>

        {/* ── Actions ── */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '9px 18px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 500,
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#6B7280',
          }}>
            Fermer
          </button>
          <button
            onClick={handleShare}
            disabled={status === 'loading'}
            style={{
              padding: '9px 22px', borderRadius: 10, cursor: status === 'loading' ? 'wait' : 'pointer',
              fontSize: 13, fontWeight: 700, border: 'none',
              background: status === 'done'
                ? 'rgba(34,199,89,0.15)'
                : status === 'error'
                  ? 'rgba(255,59,48,0.15)'
                  : `${accent}22`,
              outline: `1px solid ${
                status === 'done' ? 'rgba(34,199,89,0.4)'
                  : status === 'error' ? 'rgba(255,59,48,0.4)'
                  : `${accent}55`
              }`,
              color: status === 'done' ? '#22C759' : status === 'error' ? '#FF3B30' : accent,
              display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s',
            }}
          >
            {status === 'loading' && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 0.8s linear infinite' }}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
            )}
            {status === 'done' ? '✓ Copié dans le presse-papier !' : status === 'error' ? '✗ Erreur — réessaie' : '📤 Copier / Télécharger'}
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>,
    document.body
  )
}
