// src/components/share/ShareStatsModal.tsx
// Modal aperçu + sélecteur de période + bouton partager
import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/services/firebase/config'
import { useUser } from '@/hooks/useAuth'
import { tradePnL, type Trade, type MoodEntry, type EmotionalState } from '@/services/firestore'
import ShareStatsCard from './ShareStatsCard'

// ── Helpers ────────────────────────────────────────────────────────────────

function safeTime(d: any): number {
  if (!d) return 0
  if (typeof d?.getTime === 'function') { const t = d.getTime(); return isNaN(t) ? 0 : t }
  if (typeof d?.seconds === 'number') return d.seconds * 1000
  if (typeof d === 'number') return d
  return 0
}

/** Calcule les stats de base depuis un tableau de trades */
function calcShareStats(trades: Trade[]) {
  const closed = trades
    .filter(t => t.status === 'closed')
    .sort((a, b) => safeTime(a.date) - safeTime(b.date))
  const pnls = closed.map(tradePnL)
  const wins   = pnls.filter(p => p > 0)
  const losses = pnls.filter(p => p <= 0)
  const totalPnL   = pnls.reduce((a, b) => a + b, 0)
  const winRate    = closed.length > 0 ? (wins.length / closed.length) * 100 : 0
  const avgWin     = wins.length   > 0 ? wins.reduce((a, b) => a + b, 0)   / wins.length   : 0
  const avgLoss    = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0
  const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : 0
  const expectancy  = (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss
  let cum = 0, peak = 0, maxDD = 0
  for (const p of pnls) {
    cum += p
    if (cum > peak) peak = cum
    const dd = peak - cum
    if (dd > maxDD) maxDD = dd
  }
  return { totalPnL, winRate, payoffRatio, expectancy, maxDD, totalTrades: closed.length }
}

/** Construit la courbe PnL cumulatif filtrée par période */
function buildPnLCurve(trades: Trade[], period: '1M' | '3M' | 'ALL'): number[] {
  const days = period === '1M' ? 30 : period === '3M' ? 90 : 0
  const cutoff = days > 0 ? Date.now() - days * 864e5 : 0
  const closed = trades
    .filter(t => t.status === 'closed' && safeTime(t.date) >= cutoff)
    .sort((a, b) => safeTime(a.date) - safeTime(b.date))
  if (!closed.length) return []
  let cum = 0
  return closed.map(t => { cum += tradePnL(t); return cum })
}

/** Émotion dominante sur une période */
function dominantEmotion(moods: MoodEntry[], _trades: Trade[], period: '1M' | '3M' | 'ALL'): EmotionalState | null {
  const days = period === '1M' ? 30 : period === '3M' ? 90 : 0
  const cutoff = days > 0 ? Date.now() - days * 864e5 : 0
  const filtered = moods.filter(m => safeTime(m.timestamp) >= cutoff)
  if (!filtered.length) return null
  const counts: Record<string, number> = {}
  filtered.forEach(m => { counts[m.emotionalState] = (counts[m.emotionalState] || 0) + 1 })
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'calm') as EmotionalState
}

/** Filtre les trades par période */
function filterByPeriod(trades: Trade[], period: '1M' | '3M' | 'ALL'): Trade[] {
  const days = period === '1M' ? 30 : period === '3M' ? 90 : 0
  const cutoff = days > 0 ? Date.now() - days * 864e5 : 0
  return trades.filter(t => safeTime(t.date) >= cutoff)
}

// ── Props ──────────────────────────────────────────────────────────────────

interface ShareStatsModalProps {
  trades: Trade[]
  moods: MoodEntry[]
  onClose: () => void
}

// ── Modal ──────────────────────────────────────────────────────────────────

export default function ShareStatsModal({ trades, moods, onClose }: ShareStatsModalProps) {
  const user = useUser()
  const [period, setPeriod] = useState<'1M' | '3M' | 'ALL'>('1M')
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null)
  const [profileName, setProfileName]   = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const cardRef = useRef<HTMLDivElement>(null)

  // Subscribe to Firestore user doc
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

  // Derived stats
  const filtered  = filterByPeriod(trades, period)
  const stats     = calcShareStats(filtered)
  const pnlCurve  = buildPnLCurve(filtered, period)
  const emotion   = dominantEmotion(moods, trades, period)
  const name      = profileName || user?.displayName || 'Trader'

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

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
        width: 640,
        height: 340,
      })
      const blob = await (await fetch(dataUrl)).blob()
      const filename = `trademindset-stats-${period.toLowerCase()}.png`

      // 1. Clipboard
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        setStatus('done')
        setTimeout(() => setStatus('idle'), 2500)
        return
      } catch { /* fallthrough */ }

      // 2. Web Share (mobile)
      if (navigator.share && navigator.canShare) {
        const file = new File([blob], filename, { type: 'image/png' })
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ title: 'Mes stats TradeMindset', files: [file] })
          setStatus('done')
          setTimeout(() => setStatus('idle'), 2500)
          return
        }
      }

      // 3. Download fallback
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
      setStatus('done')
      setTimeout(() => setStatus('idle'), 2500)
    } catch (err) {
      console.warn('Share failed:', err)
      setStatus('error')
      setTimeout(() => setStatus('idle'), 2000)
    }
  }, [cardRef, status, period])

  const PERIODS: { v: '1M' | '3M' | 'ALL'; label: string }[] = [
    { v: '1M',  label: '1 mois' },
    { v: '3M',  label: '3 mois' },
    { v: 'ALL', label: 'Tout' },
  ]

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--tm-bg-secondary, #111827)',
          border: '1px solid #1E2330',
          borderRadius: 20,
          padding: '24px 24px 20px',
          display: 'flex', flexDirection: 'column', gap: 18,
          boxShadow: '0 24px 60px rgba(0,0,0,0.8)',
          maxWidth: '100%',
        }}
      >
        {/* ── Top bar ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--tm-text-primary)', fontFamily: 'Syne, sans-serif' }}>
              📤 Partager mes stats
            </div>
            <div style={{ fontSize: 11, color: 'var(--tm-text-muted)', marginTop: 2 }}>
              Capture et partage ton aperçu de performance
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--tm-text-muted)', fontSize: 20, lineHeight: 1,
              padding: 4, borderRadius: 6,
            }}
          >✕</button>
        </div>

        {/* ── Période pills ── */}
        <div style={{ display: 'flex', gap: 8 }}>
          {PERIODS.map(p => (
            <button
              key={p.v}
              onClick={() => setPeriod(p.v)}
              style={{
                padding: '6px 16px', borderRadius: 99, cursor: 'pointer',
                fontSize: 12, fontWeight: 600,
                background: period === p.v ? 'rgba(0,229,255,0.12)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${period === p.v ? 'rgba(0,229,255,0.4)' : 'rgba(255,255,255,0.08)'}`,
                color: period === p.v ? '#00E5FF' : 'var(--tm-text-muted)',
                transition: 'all 0.15s',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* ── Card preview ── */}
        <div
          ref={cardRef}
          style={{
            borderRadius: 16,
            overflow: 'hidden',
            border: '1px solid #1E2330',
            flexShrink: 0,
          }}
        >
          <ShareStatsCard
            displayName={name}
            photoURL={profilePhoto}
            winRate={stats.winRate}
            payoffRatio={stats.payoffRatio}
            totalPnL={stats.totalPnL}
            totalTrades={stats.totalTrades}
            maxDD={stats.maxDD}
            expectancy={stats.expectancy}
            dominantEmotion={emotion}
            pnlCurve={pnlCurve}
            period={period}
          />
        </div>

        {/* ── Actions ── */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '9px 18px', borderRadius: 10, cursor: 'pointer',
              fontSize: 13, fontWeight: 500,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'var(--tm-text-muted)',
            }}
          >
            Fermer
          </button>
          <button
            onClick={handleShare}
            disabled={status === 'loading'}
            style={{
              padding: '9px 20px', borderRadius: 10, cursor: status === 'loading' ? 'wait' : 'pointer',
              fontSize: 13, fontWeight: 700,
              background: status === 'done'
                ? 'rgba(34,199,89,0.15)'
                : status === 'error'
                  ? 'rgba(255,59,48,0.15)'
                  : 'rgba(0,229,255,0.12)',
              border: `1px solid ${
                status === 'done' ? 'rgba(34,199,89,0.4)'
                  : status === 'error' ? 'rgba(255,59,48,0.4)'
                  : 'rgba(0,229,255,0.3)'
              }`,
              color: status === 'done' ? '#22C759' : status === 'error' ? '#FF3B30' : '#00E5FF',
              display: 'flex', alignItems: 'center', gap: 7,
              transition: 'all 0.2s',
            }}
          >
            {status === 'loading' && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 0.8s linear infinite' }}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
            )}
            {status === 'done'    ? '✓ Copié !' : status === 'error' ? '✗ Erreur' : '📤 Copier / Partager'}
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>,
    document.body
  )
}
