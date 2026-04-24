// src/pages/whales/WhaleAlertsPage.tsx
import { useState, useEffect } from 'react'
import { collection, query, orderBy, limit, onSnapshot, where } from 'firebase/firestore'
import { db } from '@/services/firebase/config'
import { useUser } from '@/hooks/useAuth'

// ── Types ─────────────────────────────────────────────────────────────────────
interface WhaleAlert {
  id: string
  txHash: string
  token: string
  tokenSymbol: string
  tokenName: string
  from: string
  to: string
  usdValue: number
  blockNumber: number
  timestamp: number
  chain: string
  score: number
  scoreCategory: 'legendary' | 'major' | 'significant' | 'notable'
  scoreBreakdown: { amountScore: number; relativeVolumeScore: number; velocityBonus: number }
  pairVolume24h: number
  priceAtTime: number
  notified: boolean
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function formatUSD(n: number) {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function timeAgo(ts: number) {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 60)   return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}j`
}

const CATEGORY_CONFIG = {
  legendary:   { label: '🔥 Légendaire', color: '#FF9500', bg: 'rgba(255,149,0,0.12)',   border: 'rgba(255,149,0,0.3)' },
  major:       { label: '⚡ Majeur',     color: '#BF5AF2', bg: 'rgba(191,90,242,0.10)', border: 'rgba(191,90,242,0.25)' },
  significant: { label: '🐋 Significatif', color: '#0A85FF', bg: 'rgba(10,133,255,0.10)', border: 'rgba(10,133,255,0.25)' },
  notable:     { label: '📊 Notable',    color: '#00E5FF', bg: 'rgba(0,229,255,0.08)',   border: 'rgba(0,229,255,0.2)' },
}

const SCORE_COLORS = [
  { min: 80, color: '#FF9500' },
  { min: 60, color: '#BF5AF2' },
  { min: 40, color: '#0A85FF' },
  { min: 0,  color: '#00E5FF' },
]

function scoreColor(score: number) {
  return SCORE_COLORS.find(s => score >= s.min)?.color ?? '#00E5FF'
}

// ── Composant principal ────────────────────────────────────────────────────────
export default function WhaleAlertsPage() {
  const user = useUser()
  const [alerts, setAlerts] = useState<WhaleAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'legendary' | 'major' | 'significant' | 'notable'>('all')
  const [tokenFilter, setTokenFilter] = useState<string>('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  // Écoute Firestore en temps réel
  useEffect(() => {
    if (!user?.uid) return

    const col = collection(db, 'alerts')
    const q = query(col, orderBy('timestamp', 'desc'), limit(100))

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as WhaleAlert))
      setAlerts(data)
      setLoading(false)
    }, (err) => {
      console.error('[WhaleAlerts]', err)
      setLoading(false)
    })

    return () => unsub()
  }, [user?.uid])

  // Tokens disponibles
  const tokens = ['all', ...Array.from(new Set(alerts.map(a => a.tokenSymbol))).sort()]

  // Filtrage
  const filtered = alerts.filter(a => {
    if (filter !== 'all' && a.scoreCategory !== filter) return false
    if (tokenFilter !== 'all' && a.tokenSymbol !== tokenFilter) return false
    return true
  })

  // Stats
  const stats = {
    total:     alerts.length,
    legendary: alerts.filter(a => a.scoreCategory === 'legendary').length,
    major:     alerts.filter(a => a.scoreCategory === 'major').length,
    volume:    alerts.reduce((s, a) => s + a.usdValue, 0),
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--tm-bg)', color: 'var(--tm-text-primary)' }}>

      {/* ── Header ── */}
      <div className="px-6 pt-6 pb-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg"
            style={{ background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.2)' }}>
            🐋
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'Syne, sans-serif' }}>Whale Alerts</h1>
            <p className="text-xs" style={{ color: 'var(--tm-text-muted)' }}>
              Transactions ERC-20 &gt; $500k — mise à jour toutes les minutes
            </p>
          </div>
          {/* Live indicator */}
          <div className="ml-auto flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
            style={{ background: 'rgba(52,199,89,0.1)', border: '1px solid rgba(52,199,89,0.25)', color: '#34C759' }}>
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#34C759' }} />
            Live
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total alertes',  value: stats.total.toString(),        color: 'var(--tm-accent)' },
            { label: '🔥 Légendaires', value: stats.legendary.toString(),    color: '#FF9500' },
            { label: '⚡ Majeures',    value: stats.major.toString(),        color: '#BF5AF2' },
            { label: 'Volume total',   value: formatUSD(stats.volume),       color: '#34C759' },
          ].map(s => (
            <div key={s.label} className="rounded-xl px-4 py-3"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="text-xs mb-1" style={{ color: 'var(--tm-text-muted)' }}>{s.label}</div>
              <div className="text-xl font-bold" style={{ color: s.color, fontFamily: 'Syne, sans-serif' }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Filtres ── */}
      <div className="px-6 py-3 flex items-center gap-3 flex-wrap" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        {/* Catégorie */}
        <div className="flex gap-1.5">
          {(['all', 'legendary', 'major', 'significant', 'notable'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="text-xs px-3 py-1.5 rounded-lg transition-all cursor-pointer"
              style={{
                background: filter === f ? 'rgba(0,229,255,0.12)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${filter === f ? 'rgba(0,229,255,0.3)' : 'rgba(255,255,255,0.08)'}`,
                color: filter === f ? 'var(--tm-accent)' : 'var(--tm-text-muted)',
                fontWeight: filter === f ? 600 : 400,
              }}>
              {f === 'all' ? 'Tous' : CATEGORY_CONFIG[f].label}
            </button>
          ))}
        </div>

        {/* Token */}
        <select value={tokenFilter} onChange={e => setTokenFilter(e.target.value)}
          className="text-xs px-3 py-1.5 rounded-lg ml-auto"
          style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            color: 'var(--tm-text-secondary)', outline: 'none', cursor: 'pointer',
          }}>
          {tokens.map(t => (
            <option key={t} value={t} style={{ background: 'var(--tm-bg)' }}>
              {t === 'all' ? 'Tous les tokens' : t}
            </option>
          ))}
        </select>
      </div>

      {/* ── Liste ── */}
      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-2">
        {loading && (
          <div className="flex items-center justify-center h-40 gap-3"
            style={{ color: 'var(--tm-text-muted)' }}>
            <div className="w-5 h-5 rounded-full border-2 animate-spin"
              style={{ borderColor: 'rgba(0,229,255,0.2)', borderTopColor: 'var(--tm-accent)' }} />
            Chargement des alertes…
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 gap-2"
            style={{ color: 'var(--tm-text-muted)' }}>
            <span className="text-3xl">🔍</span>
            <p className="text-sm">Aucune alerte pour ce filtre</p>
            <p className="text-xs">Les baleines se manifestent toutes les minutes</p>
          </div>
        )}

        {filtered.map(alert => {
          const cat = CATEGORY_CONFIG[alert.scoreCategory]
          const isOpen = expanded === alert.id
          const sc = scoreColor(alert.score)

          return (
            <div key={alert.id}
              className="rounded-xl overflow-hidden cursor-pointer transition-all duration-200"
              style={{ background: cat.bg, border: `1px solid ${cat.border}` }}
              onClick={() => setExpanded(isOpen ? null : alert.id)}>

              {/* Row principal */}
              <div className="px-4 py-3 flex items-center gap-3">
                {/* Score circle */}
                <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm"
                  style={{ background: `${sc}15`, border: `2px solid ${sc}`, color: sc }}>
                  {alert.score}
                </div>

                {/* Token + montant */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm" style={{ color: 'var(--tm-text-primary)' }}>
                      {alert.tokenSymbol}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                      style={{ background: `${cat.color}20`, color: cat.color }}>
                      {cat.label}
                    </span>
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--tm-text-muted)' }}>
                    {shortAddr(alert.from)} → {shortAddr(alert.to)}
                  </div>
                </div>

                {/* Valeur + temps */}
                <div className="text-right flex-shrink-0">
                  <div className="font-bold text-sm" style={{ color: '#34C759' }}>
                    {formatUSD(alert.usdValue)}
                  </div>
                  <div className="text-[10px]" style={{ color: 'var(--tm-text-muted)' }}>
                    {timeAgo(alert.timestamp)}
                  </div>
                </div>

                {/* Chevron */}
                <div className="text-xs transition-transform duration-200 ml-1"
                  style={{ color: 'var(--tm-text-muted)', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                  ▼
                </div>
              </div>

              {/* Détails expandés */}
              {isOpen && (
                <div className="px-4 pb-4 pt-0 border-t"
                  style={{ borderColor: `${cat.border}`, marginTop: 0 }}>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-3 text-xs">
                    <div>
                      <span style={{ color: 'var(--tm-text-muted)' }}>Token : </span>
                      <span style={{ color: 'var(--tm-text-secondary)' }}>{alert.tokenName}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--tm-text-muted)' }}>Prix au moment : </span>
                      <span style={{ color: 'var(--tm-text-secondary)' }}>${alert.priceAtTime.toFixed(4)}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--tm-text-muted)' }}>Volume 24h (paire) : </span>
                      <span style={{ color: 'var(--tm-text-secondary)' }}>{formatUSD(alert.pairVolume24h)}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--tm-text-muted)' }}>Block : </span>
                      <span style={{ color: 'var(--tm-text-secondary)' }}>#{alert.blockNumber.toLocaleString()}</span>
                    </div>

                    {/* Score breakdown */}
                    <div className="col-span-2 mt-2 rounded-lg p-3"
                      style={{ background: 'rgba(0,0,0,0.2)' }}>
                      <div className="text-[10px] font-bold mb-2" style={{ color: 'var(--tm-text-muted)' }}>
                        SCORE BREAKDOWN
                      </div>
                      <div className="flex gap-4">
                        {[
                          { label: 'Montant',  value: alert.scoreBreakdown.amountScore,        max: 40 },
                          { label: 'Vol. rel.', value: alert.scoreBreakdown.relativeVolumeScore, max: 40 },
                          { label: 'Vélocité', value: alert.scoreBreakdown.velocityBonus,       max: 20 },
                        ].map(b => (
                          <div key={b.label} className="flex-1">
                            <div className="flex justify-between mb-1">
                              <span style={{ color: 'var(--tm-text-muted)' }}>{b.label}</span>
                              <span style={{ color: sc }}>{b.value}/{b.max}</span>
                            </div>
                            <div className="h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                              <div className="h-full rounded-full transition-all"
                                style={{ width: `${(b.value / b.max) * 100}%`, background: sc }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Lien Etherscan */}
                    <div className="col-span-2">
                      <a href={`https://etherscan.io/tx/${alert.txHash}`}
                        target="_blank" rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-[11px] underline"
                        style={{ color: 'var(--tm-accent)' }}>
                        Voir sur Etherscan ↗
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
