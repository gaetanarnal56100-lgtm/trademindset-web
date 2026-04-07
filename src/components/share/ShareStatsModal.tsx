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

// ── Helpers ────────────────────────────────────────────────────────────────

function safeTime(d: any): number {
  if (!d) return 0
  if (typeof d?.getTime === 'function') { const t = d.getTime(); return isNaN(t) ? 0 : t }
  if (typeof d?.seconds === 'number') return d.seconds * 1000
  if (typeof d === 'number') return d
  return 0
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
  const avgWin      = wins.length   > 0 ? wins.reduce((a, b) => a + b, 0)   / wins.length   : 0
  const avgLoss     = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0
  const payoffRatio = avgLoss  > 0 ? avgWin / avgLoss : 0
  const expectancy  = (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss
  let cum = 0, peak = 0, maxDD = 0
  for (const p of pnls) { cum += p; if (cum > peak) peak = cum; const dd = peak - cum; if (dd > maxDD) maxDD = dd }
  // Sharpe
  const returns = pnls.map(p => p / 1000 * 100)
  const avgRet  = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0
  const variance = returns.length ? returns.reduce((a, b) => a + Math.pow(b - avgRet, 2), 0) / returns.length : 0
  const sharpe   = Math.sqrt(variance) > 0 ? avgRet / Math.sqrt(variance) : 0
  // Best streak
  let bestStreak = 0, cur = 0
  for (const p of pnls) {
    cur = p > 0 ? (cur > 0 ? cur + 1 : 1) : (cur < 0 ? cur - 1 : -1)
    if (cur > bestStreak) bestStreak = cur
  }
  return { totalPnL, winRate, payoffRatio, expectancy, maxDD, sharpe, bestStreak, totalTrades: closed.length }
}

function buildPnLCurve(trades: Trade[], period: '1M' | '3M' | 'ALL'): number[] {
  const days   = period === '1M' ? 30 : period === '3M' ? 90 : 0
  const cutoff = days > 0 ? Date.now() - days * 864e5 : 0
  const closed = trades
    .filter(t => t.status === 'closed' && safeTime(t.date) >= cutoff)
    .sort((a, b) => safeTime(a.date) - safeTime(b.date))
  if (!closed.length) return []
  let cum = 0
  return closed.map(t => { cum += tradePnL(t); return cum })
}

function dominantEmotion(moods: MoodEntry[], period: '1M' | '3M' | 'ALL'): EmotionalState | null {
  const days   = period === '1M' ? 30 : period === '3M' ? 90 : 0
  const cutoff = days > 0 ? Date.now() - days * 864e5 : 0
  const filtered = moods.filter(m => safeTime(m.timestamp) >= cutoff)
  if (!filtered.length) return null
  const counts: Record<string, number> = {}
  filtered.forEach(m => { counts[m.emotionalState] = (counts[m.emotionalState] || 0) + 1 })
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'calm') as EmotionalState
}

function filterByPeriod(trades: Trade[], period: '1M' | '3M' | 'ALL'): Trade[] {
  const days   = period === '1M' ? 30 : period === '3M' ? 90 : 0
  const cutoff = days > 0 ? Date.now() - days * 864e5 : 0
  return trades.filter(t => safeTime(t.date) >= cutoff)
}

// ── Sub-components ────────────────────────────────────────────────────────────

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
        background: active
          ? 'rgba(0,229,255,0.15)'
          : 'rgba(255,255,255,0.05)',
        color: active ? '#00E5FF' : disabled && !active ? '#3A3F4E' : '#6B7280',
        outline: active ? '1px solid rgba(0,229,255,0.35)' : '1px solid transparent',
        transition: 'all 0.15s',
      }}
    >
      {active && '✓ '}{label}
    </button>
  )
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface ShareStatsModalProps {
  trades: Trade[]
  moods:  MoodEntry[]
  onClose: () => void
}

// ── Modal ──────────────────────────────────────────────────────────────────────

const METRIC_LABELS: { key: keyof ShareCardConfig['metrics']; label: string }[] = [
  { key: 'winRate',     label: 'Win Rate' },
  { key: 'payoffRatio', label: 'R/R Ratio' },
  { key: 'totalPnL',   label: 'P&L Net' },
  { key: 'totalTrades', label: 'Trades' },
  { key: 'maxDD',       label: 'Max DD' },
  { key: 'expectancy',  label: 'Espérance' },
  { key: 'sharpe',      label: 'Sharpe' },
  { key: 'bestStreak',  label: 'Streak Max' },
]

const THEMES: { v: CardTheme; label: string }[] = [
  { v: 'cyan',    label: 'Cyan' },
  { v: 'purple',  label: 'Purple' },
  { v: 'gold',    label: 'Gold' },
  { v: 'minimal', label: 'Minimal' },
]

const PERIODS: { v: '1M' | '3M' | 'ALL'; label: string }[] = [
  { v: '1M',  label: '1 mois' },
  { v: '3M',  label: '3 mois' },
  { v: 'ALL', label: 'Tout' },
]

export default function ShareStatsModal({ trades, moods, onClose }: ShareStatsModalProps) {
  const user = useUser()
  const [period, setPeriod]           = useState<'1M' | '3M' | 'ALL'>('1M')
  const [config, setConfig]           = useState<ShareCardConfig>(DEFAULT_CONFIG)
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null)
  const [profileName,  setProfileName]  = useState<string | null>(null)
  const [status, setStatus]           = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
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

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Derived data
  const filtered  = filterByPeriod(trades, period)
  const stats     = calcShareStats(filtered)
  const pnlCurve  = buildPnLCurve(filtered, period)
  const emotion   = dominantEmotion(moods, period)
  const name      = profileName || user?.displayName || 'Trader'
  const accent    = THEME_COLORS[config.theme]

  // Active metric count (for max-4 enforcement)
  const activeCount = Object.values(config.metrics).filter(Boolean).length

  const toggleMetric = (key: keyof ShareCardConfig['metrics']) => {
    const current = config.metrics[key]
    // Block enabling if already at 4 (unless toggling off)
    if (!current && activeCount >= 4) return
    setConfig(c => ({ ...c, metrics: { ...c.metrics, [key]: !current } }))
  }

  // Share
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
        background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(8px)',
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
          width: 688, maxWidth: '100%',
        }}
      >
        {/* ── Top bar ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#F0F2F5', fontFamily: 'Syne, sans-serif' }}>
              📤 Partager mes stats
            </div>
            <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
              Personnalise et exporte ta carte de performance
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: 20, padding: 4 }}>✕</button>
        </div>

        {/* ── Période + Personnaliser toggle ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {PERIODS.map(p => (
              <button key={p.v} onClick={() => setPeriod(p.v)} style={{
                padding: '6px 14px', borderRadius: 99, cursor: 'pointer', fontSize: 12, fontWeight: 600, border: 'none',
                background: period === p.v ? `rgba(${accent === '#00E5FF' ? '0,229,255' : accent === '#BF5AF2' ? '191,90,242' : accent === '#F59714' ? '245,151,20' : '139,148,158'},0.15)` : 'rgba(255,255,255,0.05)',
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
              padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 600,
              background: showCustomize ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: showCustomize ? '#F0F2F5' : '#6B7280',
            }}
          >
            <span>{showCustomize ? '▲' : '▼'}</span>
            Personnaliser
          </button>
        </div>

        {/* ── Panneau de personnalisation ── */}
        {showCustomize && (
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 12,
            padding: '16px 18px',
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            {/* Métriques */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
                Métriques · {activeCount}/4 max
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

            {/* Blocs */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
                Blocs
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
                {([
                  ['showSparkline', 'Graphique PnL'],
                  ['showEmotion',   'État émotionnel'],
                  ['showAvatar',    'Photo de profil'],
                  ['showBranding',  'Branding footer'],
                ] as [keyof ShareCardConfig, string][]).map(([k, label]) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 12, color: '#C5C8D6' }}>{label}</span>
                    <Toggle
                      on={config[k] as boolean}
                      onChange={v => setConfig(c => ({ ...c, [k]: v }))}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Thème */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
                Thème
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {THEMES.map(t => (
                  <button
                    key={t.v}
                    onClick={() => setConfig(c => ({ ...c, theme: t.v }))}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      padding: '5px 12px', borderRadius: 8, cursor: 'pointer',
                      fontSize: 11, fontWeight: 600, border: 'none',
                      background: config.theme === t.v
                        ? `${THEME_COLORS[t.v]}22`
                        : 'rgba(255,255,255,0.04)',
                      outline: config.theme === t.v
                        ? `1px solid ${THEME_COLORS[t.v]}55`
                        : '1px solid transparent',
                      color: config.theme === t.v ? THEME_COLORS[t.v] : '#6B7280',
                      transition: 'all 0.15s',
                    }}
                  >
                    <span style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: THEME_COLORS[t.v],
                      boxShadow: config.theme === t.v ? `0 0 6px ${THEME_COLORS[t.v]}` : 'none',
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
            dominantEmotion={emotion}
            pnlCurve={pnlCurve}
            period={period}
            config={config}
          />
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
              padding: '9px 20px', borderRadius: 10, cursor: status === 'loading' ? 'wait' : 'pointer',
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
              display: 'flex', alignItems: 'center', gap: 7, transition: 'all 0.2s',
            }}
          >
            {status === 'loading' && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 0.8s linear infinite' }}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
            )}
            {status === 'done' ? '✓ Copié !' : status === 'error' ? '✗ Erreur' : '📤 Copier / Partager'}
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>,
    document.body
  )
}
