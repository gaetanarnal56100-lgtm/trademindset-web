// src/pages/whales/WhaleAlertsPage.tsx
import { useState, useEffect, useMemo } from 'react'
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore'
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
  fromLabel?: string
  to: string
  toLabel?: string
  usdValue: number
  blockNumber: number
  timestamp: number
  chain: 'ethereum' | 'bitcoin' | 'bsc' | string
  score: number
  scoreCategory: 'MEGA_WHALE' | 'WHALE' | 'BIG_FISH' | 'SHARK'
  scoreBreakdown: { amountScore: number; relativeVolumeScore: number; velocityBonus: number }
  pairVolume24h: number
  priceAtTime: number
  notified: boolean
}

type Signal = 'buy' | 'sell' | 'exchange' | 'p2p' | 'spoofing'

// ── Helpers ────────────────────────────────────────────────────────────────────
const CHAIN_CONFIG: Record<string, { label: string; color: string; bg: string; explorer: (h: string) => string }> = {
  bitcoin:  { label: 'BTC', color: '#F7931A', bg: 'rgba(247,147,26,0.12)',  explorer: h => `https://mempool.space/tx/${h}` },
  ethereum: { label: 'ETH', color: '#627EEA', bg: 'rgba(98,126,234,0.12)', explorer: h => `https://etherscan.io/tx/${h}` },
  bsc:      { label: 'BSC', color: '#F3BA2F', bg: 'rgba(243,186,47,0.12)', explorer: h => `https://bscscan.com/tx/${h}` },
}
function getChain(chain: string) { return CHAIN_CONFIG[chain] ?? CHAIN_CONFIG['ethereum'] }

function isExchangeLabel(addr: string, label?: string) {
  return !!label && label !== addr && addr !== 'coinbase'
}

function getSignal(a: WhaleAlert): Signal {
  if (a.scoreBreakdown?.velocityBonus >= 10) return 'spoofing'
  const fromEx = isExchangeLabel(a.from, a.fromLabel)
  const toEx   = isExchangeLabel(a.to,   a.toLabel)
  if (fromEx && !toEx) return 'buy'      // retrait exchange → wallet = accumulation
  if (!fromEx && toEx) return 'sell'     // dépôt wallet → exchange = distribution
  if (fromEx && toEx)  return 'exchange' // exchange → exchange
  return 'p2p'
}

const SIGNAL_META: Record<Signal, { label: string; short: string; color: string; bg: string; icon: string }> = {
  buy:      { label: 'Accumulation',    short: 'Achats',    color: '#34C759', bg: 'rgba(52,199,89,0.12)',   icon: '📥' },
  sell:     { label: 'Distribution',   short: 'Ventes',    color: '#FF3B30', bg: 'rgba(255,59,48,0.12)',   icon: '📤' },
  exchange: { label: 'Inter-exchange', short: 'Exchanges', color: '#FF9500', bg: 'rgba(255,149,0,0.10)',   icon: '🔄' },
  p2p:      { label: 'P2P / OTC',      short: 'P2P',       color: '#8E8E93', bg: 'rgba(142,142,147,0.10)', icon: '🤝' },
  spoofing: { label: 'Spoofing ?',     short: 'Spoofing',  color: '#BF5AF2', bg: 'rgba(191,90,242,0.12)', icon: '⚠️' },
}

function formatUSD(n: number) {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function formatAddr(raw: string, label?: string) {
  if (!raw || raw === 'unknown') return '?'
  if (raw === 'coinbase') return '⛏ Coinbase tx'
  if (label && label !== raw) return label
  return `${raw.slice(0, 6)}…${raw.slice(-4)}`
}

function timeAgo(ts: number) {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 60)    return `${diff}s`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}j`
}

const CATEGORY_CONFIG = {
  MEGA_WHALE: { label: '🔥 Mega Whale', color: '#FF9500', bg: 'rgba(255,149,0,0.12)',   border: 'rgba(255,149,0,0.3)' },
  WHALE:      { label: '🐋 Whale',      color: '#BF5AF2', bg: 'rgba(191,90,242,0.10)', border: 'rgba(191,90,242,0.25)' },
  BIG_FISH:   { label: '🐠 Big Fish',   color: '#0A85FF', bg: 'rgba(10,133,255,0.10)', border: 'rgba(10,133,255,0.25)' },
  SHARK:      { label: '🦈 Shark',      color: '#00E5FF', bg: 'rgba(0,229,255,0.08)',  border: 'rgba(0,229,255,0.2)' },
}
const SCORE_COLORS = [
  { min: 80, color: '#FF9500' }, { min: 60, color: '#BF5AF2' },
  { min: 40, color: '#0A85FF' }, { min: 0,  color: '#00E5FF' },
]
function scoreColor(score: number) { return SCORE_COLORS.find(s => score >= s.min)?.color ?? '#00E5FF' }

// ── Analytics component ────────────────────────────────────────────────────────
function WhaleAnalytics({ alerts }: { alerts: WhaleAlert[] }) {
  const now = Date.now()
  const h24 = alerts.filter(a => now - a.timestamp < 86_400_000)

  const flows = useMemo(() => {
    const result: Record<Signal, number> = { buy: 0, sell: 0, exchange: 0, p2p: 0, spoofing: 0 }
    for (const a of h24) result[getSignal(a)] += a.usdValue
    return result
  }, [h24.length])

  const totalFlow  = flows.buy + flows.sell + flows.p2p + flows.exchange + flows.spoofing
  const netFlow    = flows.buy - flows.sell
  const buyPct     = totalFlow > 0 ? (flows.buy / totalFlow) * 100 : 50
  const sellPct    = totalFlow > 0 ? (flows.sell / totalFlow) * 100 : 50
  const sentiment  = netFlow > 0 ? 'BULLISH' : netFlow < 0 ? 'BEARISH' : 'NEUTRE'
  const sentColor  = netFlow > 0 ? '#34C759' : netFlow < 0 ? '#FF3B30' : '#8E8E93'

  // Top tokens (24h)
  const tokenMap: Record<string, { vol: number; buy: number; sell: number }> = {}
  for (const a of h24) {
    if (!tokenMap[a.tokenSymbol]) tokenMap[a.tokenSymbol] = { vol: 0, buy: 0, sell: 0 }
    tokenMap[a.tokenSymbol].vol += a.usdValue
    const sig = getSignal(a)
    if (sig === 'buy')  tokenMap[a.tokenSymbol].buy  += a.usdValue
    if (sig === 'sell') tokenMap[a.tokenSymbol].sell += a.usdValue
  }
  const topTokens = Object.entries(tokenMap)
    .sort((a, b) => b[1].vol - a[1].vol)
    .slice(0, 5)
  const maxTokenVol = topTokens[0]?.[1].vol ?? 1

  // Recent signals (last 10)
  const recentSignals = [...h24]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 8)
    .map(a => ({ ...a, signal: getSignal(a) }))

  // Spoofing wallets
  const spoofers = h24.filter(a => a.scoreBreakdown?.velocityBonus >= 10)
  const uniqueSpoofers = new Set(spoofers.map(a => a.from)).size

  if (h24.length === 0) return null

  return (
    <div className="px-6 pt-4 pb-5 flex flex-col gap-4"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.15)' }}>

      {/* ── Titre ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold" style={{ fontFamily: 'Syne, sans-serif', color: 'var(--tm-text-primary)' }}>
            Analyse des flux — 24h
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
            style={{ background: `${sentColor}20`, color: sentColor, border: `1px solid ${sentColor}40` }}>
            {sentiment}
          </span>
        </div>
        <span className="text-xs" style={{ color: 'var(--tm-text-muted)' }}>{h24.length} alertes</span>
      </div>

      {/* ── Flux buy/sell/exchange/p2p ── */}
      <div className="grid grid-cols-4 gap-2">
        {(['buy', 'sell', 'exchange', 'p2p'] as Signal[]).map(sig => {
          const m = SIGNAL_META[sig]
          return (
            <div key={sig} className="rounded-xl px-3 py-2.5"
              style={{ background: m.bg, border: `1px solid ${m.color}25` }}>
              <div className="flex items-center gap-1 mb-1">
                <span className="text-sm">{m.icon}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wide"
                  style={{ color: m.color }}>{m.short}</span>
              </div>
              <div className="text-base font-bold" style={{ color: 'var(--tm-text-primary)', fontFamily: 'Syne, sans-serif' }}>
                {formatUSD(flows[sig])}
              </div>
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--tm-text-muted)' }}>
                {totalFlow > 0 ? ((flows[sig] / totalFlow) * 100).toFixed(0) : 0}% du total
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Barre pression nette ── */}
      <div>
        <div className="flex justify-between text-[10px] mb-1.5" style={{ color: 'var(--tm-text-muted)' }}>
          <span style={{ color: '#34C759' }}>📥 Accumulation {buyPct.toFixed(0)}%</span>
          <span className="font-semibold" style={{ color: sentColor }}>
            Flux net : {netFlow >= 0 ? '+' : ''}{formatUSD(netFlow)}
          </span>
          <span style={{ color: '#FF3B30' }}>📤 Distribution {sellPct.toFixed(0)}%</span>
        </div>
        <div className="h-2.5 rounded-full overflow-hidden flex" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div className="h-full transition-all duration-700 rounded-l-full"
            style={{ width: `${buyPct}%`, background: 'linear-gradient(90deg, #34C759, #34C75988)' }} />
          <div className="h-full transition-all duration-700 rounded-r-full"
            style={{ width: `${sellPct}%`, background: 'linear-gradient(90deg, #FF3B3088, #FF3B30)' }} />
        </div>
      </div>

      {/* ── Spoofing + Top tokens + Signaux récents ── */}
      <div className="grid grid-cols-3 gap-3">

        {/* Spoofing */}
        <div className="rounded-xl p-3" style={{ background: 'rgba(191,90,242,0.07)', border: '1px solid rgba(191,90,242,0.2)' }}>
          <div className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: '#BF5AF2' }}>
            ⚠️ Spoofing détecté
          </div>
          {uniqueSpoofers === 0 ? (
            <div className="text-xs" style={{ color: 'var(--tm-text-muted)' }}>Aucun pattern suspect</div>
          ) : (
            <>
              <div className="text-2xl font-bold" style={{ color: '#BF5AF2', fontFamily: 'Syne, sans-serif' }}>
                {uniqueSpoofers}
              </div>
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--tm-text-muted)' }}>
                wallet{uniqueSpoofers > 1 ? 's' : ''} avec txs répétées
              </div>
              {spoofers.slice(0, 2).map(a => (
                <div key={a.txHash} className="mt-1.5 text-[10px] px-2 py-1 rounded-lg"
                  style={{ background: 'rgba(191,90,242,0.1)', color: '#BF5AF2' }}>
                  {formatAddr(a.from, a.fromLabel)} — {a.tokenSymbol} {formatUSD(a.usdValue)}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Top tokens */}
        <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--tm-text-muted)' }}>
            🔥 Top tokens actifs
          </div>
          <div className="flex flex-col gap-1.5">
            {topTokens.map(([sym, data]) => {
              const pct = (data.vol / maxTokenVol) * 100
              const netBuy = data.buy > data.sell
              return (
                <div key={sym}>
                  <div className="flex justify-between text-[10px] mb-0.5">
                    <span className="font-semibold" style={{ color: 'var(--tm-text-primary)' }}>{sym}</span>
                    <span style={{ color: 'var(--tm-text-muted)' }}>{formatUSD(data.vol)}</span>
                  </div>
                  <div className="h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div className="h-full rounded-full"
                      style={{ width: `${pct}%`, background: netBuy ? '#34C759' : '#FF3B30' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Signaux récents */}
        <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--tm-text-muted)' }}>
            ⚡ Signaux récents
          </div>
          <div className="flex flex-col gap-1.5">
            {recentSignals.map(a => {
              const m = SIGNAL_META[a.signal]
              return (
                <div key={a.txHash} className="flex items-center gap-1.5 text-[10px]">
                  <span>{m.icon}</span>
                  <span style={{ color: m.color, fontWeight: 600, minWidth: 44 }}>{m.short}</span>
                  <span className="font-semibold" style={{ color: 'var(--tm-text-primary)' }}>
                    {a.tokenSymbol}
                  </span>
                  <span style={{ color: '#34C759' }}>{formatUSD(a.usdValue)}</span>
                  <span className="ml-auto" style={{ color: 'var(--tm-text-muted)' }}>{timeAgo(a.timestamp)}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Composant principal ────────────────────────────────────────────────────────
export default function WhaleAlertsPage() {
  const user = useUser()
  const [alerts, setAlerts] = useState<WhaleAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'MEGA_WHALE' | 'WHALE' | 'BIG_FISH' | 'SHARK'>('all')
  const [signalFilter, setSignalFilter] = useState<'all' | Signal>('all')
  const [tokenFilter, setTokenFilter] = useState<string>('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.uid) return
    const col = collection(db, 'alerts')
    const q = query(col, orderBy('timestamp', 'desc'), limit(200))
    const unsub = onSnapshot(q, snap => {
      setAlerts(snap.docs.map(d => ({ id: d.id, ...d.data() } as WhaleAlert)))
      setLoading(false)
    }, err => { console.error('[WhaleAlerts]', err); setLoading(false) })
    return () => unsub()
  }, [user?.uid])

  const tokens = ['all', ...Array.from(new Set(alerts.map(a => a.tokenSymbol))).sort()]

  const filtered = alerts.filter(a => {
    if (filter !== 'all' && a.scoreCategory !== filter) return false
    if (tokenFilter !== 'all' && a.tokenSymbol !== tokenFilter) return false
    if (signalFilter !== 'all' && getSignal(a) !== signalFilter) return false
    return true
  })

  const stats = {
    total:     alerts.length,
    legendary: alerts.filter(a => a.scoreCategory === 'MEGA_WHALE').length,
    major:     alerts.filter(a => a.scoreCategory === 'WHALE').length,
    volume:    alerts.reduce((s, a) => s + a.usdValue, 0),
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--tm-bg)', color: 'var(--tm-text-primary)' }}>

      {/* ── Header ── */}
      <div className="px-6 pt-5 pb-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg"
            style={{ background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.2)' }}>
            🐋
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'Syne, sans-serif' }}>Whale Alerts</h1>
            <p className="text-xs" style={{ color: 'var(--tm-text-muted)' }}>
              BTC + ERC-20 &gt; $500k — ETH, Bitcoin — temps réel
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
            style={{ background: 'rgba(52,199,89,0.1)', border: '1px solid rgba(52,199,89,0.25)', color: '#34C759' }}>
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#34C759' }} />
            Live
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total alertes',  value: stats.total.toString(),     color: 'var(--tm-accent)' },
            { label: '🔥 Mega Whales', value: stats.legendary.toString(), color: '#FF9500' },
            { label: '🐋 Whales',      value: stats.major.toString(),     color: '#BF5AF2' },
            { label: 'Volume total',   value: formatUSD(stats.volume),    color: '#34C759' },
          ].map(s => (
            <div key={s.label} className="rounded-xl px-4 py-3"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="text-xs mb-1" style={{ color: 'var(--tm-text-muted)' }}>{s.label}</div>
              <div className="text-xl font-bold" style={{ color: s.color, fontFamily: 'Syne, sans-serif' }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Analytics ── */}
      <WhaleAnalytics alerts={alerts} />

      {/* ── Filtres ── */}
      <div className="px-6 py-3 flex items-center gap-2 flex-wrap" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        {/* Catégorie */}
        <div className="flex gap-1">
          {(['all', 'MEGA_WHALE', 'WHALE', 'BIG_FISH', 'SHARK'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="text-xs px-2.5 py-1.5 rounded-lg transition-all cursor-pointer"
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

        {/* Signal */}
        <div className="flex gap-1">
          {(['all', 'buy', 'sell', 'spoofing', 'exchange', 'p2p'] as const).map(f => {
            const m = f === 'all' ? null : SIGNAL_META[f]
            return (
              <button key={f} onClick={() => setSignalFilter(f)}
                className="text-xs px-2.5 py-1.5 rounded-lg transition-all cursor-pointer"
                style={{
                  background: signalFilter === f ? (m ? `${m.color}20` : 'rgba(0,229,255,0.12)') : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${signalFilter === f ? (m ? `${m.color}50` : 'rgba(0,229,255,0.3)') : 'rgba(255,255,255,0.08)'}`,
                  color: signalFilter === f ? (m?.color ?? 'var(--tm-accent)') : 'var(--tm-text-muted)',
                  fontWeight: signalFilter === f ? 600 : 400,
                }}>
                {f === 'all' ? 'Tous signaux' : `${m!.icon} ${m!.short}`}
              </button>
            )
          })}
        </div>

        {/* Token */}
        <select value={tokenFilter} onChange={e => setTokenFilter(e.target.value)}
          className="text-xs px-3 py-1.5 rounded-lg ml-auto"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--tm-text-secondary)', outline: 'none', cursor: 'pointer' }}>
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
          <div className="flex items-center justify-center h-40 gap-3" style={{ color: 'var(--tm-text-muted)' }}>
            <div className="w-5 h-5 rounded-full border-2 animate-spin"
              style={{ borderColor: 'rgba(0,229,255,0.2)', borderTopColor: 'var(--tm-accent)' }} />
            Chargement des alertes…
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 gap-2" style={{ color: 'var(--tm-text-muted)' }}>
            <span className="text-3xl">🔍</span>
            <p className="text-sm">Aucune alerte pour ce filtre</p>
          </div>
        )}

        {filtered.map(alert => {
          const cat    = CATEGORY_CONFIG[alert.scoreCategory] ?? CATEGORY_CONFIG['SHARK']
          const isOpen = expanded === alert.id
          const sc     = scoreColor(alert.score)
          const sig    = getSignal(alert)
          const sigM   = SIGNAL_META[sig]

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

                {/* Token + signaux */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-sm" style={{ color: 'var(--tm-text-primary)' }}>
                      {alert.tokenSymbol}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                      style={{ background: `${cat.color}20`, color: cat.color }}>
                      {cat.label}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
                      style={{ background: getChain(alert.chain).bg, color: getChain(alert.chain).color }}>
                      {getChain(alert.chain).label}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                      style={{ background: sigM.bg, color: sigM.color }}>
                      {sigM.icon} {sigM.short}
                    </span>
                  </div>
                  <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--tm-text-muted)' }}>
                    <span style={{ color: isExchangeLabel(alert.from, alert.fromLabel) ? '#F7931A' : 'inherit' }}>
                      {formatAddr(alert.from, alert.fromLabel)}
                    </span>
                    {' → '}
                    <span style={{ color: isExchangeLabel(alert.to, alert.toLabel) ? '#34C759' : 'inherit' }}>
                      {formatAddr(alert.to, alert.toLabel)}
                    </span>
                  </div>
                </div>

                {/* Valeur + temps */}
                <div className="text-right flex-shrink-0">
                  <div className="font-bold text-sm" style={{ color: sigM.color }}>{formatUSD(alert.usdValue)}</div>
                  <div className="text-[10px]" style={{ color: 'var(--tm-text-muted)' }}>{timeAgo(alert.timestamp)}</div>
                </div>

                <div className="text-xs transition-transform duration-200 ml-1"
                  style={{ color: 'var(--tm-text-muted)', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</div>
              </div>

              {/* Détails expandés */}
              {isOpen && (
                <div className="px-4 pb-4 pt-0 border-t" style={{ borderColor: cat.border }}>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-3 text-xs">
                    <div><span style={{ color: 'var(--tm-text-muted)' }}>Signal : </span>
                      <span style={{ color: sigM.color }}>{sigM.icon} {sigM.label}</span></div>
                    <div><span style={{ color: 'var(--tm-text-muted)' }}>Prix au moment : </span>
                      <span style={{ color: 'var(--tm-text-secondary)' }}>${alert.priceAtTime.toFixed(4)}</span></div>
                    <div><span style={{ color: 'var(--tm-text-muted)' }}>Volume 24h paire : </span>
                      <span style={{ color: 'var(--tm-text-secondary)' }}>{formatUSD(alert.pairVolume24h)}</span></div>
                    <div><span style={{ color: 'var(--tm-text-muted)' }}>Block : </span>
                      <span style={{ color: 'var(--tm-text-secondary)' }}>#{alert.blockNumber?.toLocaleString()}</span></div>

                    {/* Score breakdown */}
                    <div className="col-span-2 mt-2 rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.2)' }}>
                      <div className="text-[10px] font-bold mb-2" style={{ color: 'var(--tm-text-muted)' }}>SCORE BREAKDOWN</div>
                      <div className="flex gap-4">
                        {[
                          { label: 'Montant',   value: alert.scoreBreakdown?.amountScore ?? 0,         max: 40 },
                          { label: 'Vol. rel.', value: alert.scoreBreakdown?.relativeVolumeScore ?? 0,  max: 40 },
                          { label: 'Vélocité',  value: alert.scoreBreakdown?.velocityBonus ?? 0,        max: 20 },
                        ].map(b => (
                          <div key={b.label} className="flex-1">
                            <div className="flex justify-between mb-1">
                              <span style={{ color: 'var(--tm-text-muted)' }}>{b.label}</span>
                              <span style={{ color: sc }}>{b.value}/{b.max}</span>
                            </div>
                            <div className="h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                              <div className="h-full rounded-full" style={{ width: `${(b.value / b.max) * 100}%`, background: sc }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="col-span-2">
                      <a href={getChain(alert.chain).explorer(alert.txHash)}
                        target="_blank" rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-[11px] underline" style={{ color: 'var(--tm-accent)' }}>
                        Voir sur {alert.chain === 'bitcoin' ? 'mempool.space' : alert.chain === 'bsc' ? 'BscScan' : 'Etherscan'} ↗
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
