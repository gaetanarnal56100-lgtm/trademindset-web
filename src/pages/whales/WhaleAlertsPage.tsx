// src/pages/whales/WhaleAlertsPage.tsx — v4 with insider trades
import { useState, useEffect, useMemo, useRef } from 'react'
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '@/services/firebase/config'
import app from '@/services/firebase/config'
import { useUser } from '@/hooks/useAuth'

const fbFn = getFunctions(app, 'europe-west1')

// ── Types ──────────────────────────────────────────────────────────────────────
interface WhaleAlert {
  id: string; txHash: string; token: string
  tokenSymbol: string; tokenName: string
  from: string; fromLabel?: string; to: string; toLabel?: string
  usdValue: number; blockNumber: number; timestamp: number
  chain: string; score: number
  scoreCategory: 'MEGA_WHALE' | 'WHALE' | 'BIG_FISH' | 'SHARK'
  scoreBreakdown: { amountScore: number; relativeVolumeScore: number; velocityBonus: number }
  pairVolume24h: number; priceAtTime: number; notified: boolean
}
type Signal = 'buy' | 'sell' | 'exchange' | 'p2p' | 'spoofing'

// ── Config ─────────────────────────────────────────────────────────────────────
const CHAIN_CFG: Record<string, { label: string; color: string; bg: string; explorer: (h: string) => string }> = {
  bitcoin:  { label: 'BTC', color: '#F7931A', bg: 'rgba(247,147,26,0.15)',  explorer: h => `https://mempool.space/tx/${h}` },
  ethereum: { label: 'ETH', color: '#627EEA', bg: 'rgba(98,126,234,0.15)', explorer: h => `https://etherscan.io/tx/${h}` },
  bsc:      { label: 'BSC', color: '#F3BA2F', bg: 'rgba(243,186,47,0.15)', explorer: h => `https://bscscan.com/tx/${h}` },
}
const CAT_CFG = {
  MEGA_WHALE: { label: '🔥 Mega Whale', color: '#FF9500', bg: 'rgba(255,149,0,0.10)',   border: 'rgba(255,149,0,0.25)' },
  WHALE:      { label: '🐋 Whale',      color: '#BF5AF2', bg: 'rgba(191,90,242,0.08)', border: 'rgba(191,90,242,0.22)' },
  BIG_FISH:   { label: '🐠 Big Fish',   color: '#0A85FF', bg: 'rgba(10,133,255,0.08)', border: 'rgba(10,133,255,0.22)' },
  SHARK:      { label: '🦈 Shark',      color: '#00E5FF', bg: 'rgba(0,229,255,0.06)',  border: 'rgba(0,229,255,0.18)' },
}
const SIG_CFG: Record<Signal, { label: string; short: string; color: string; bg: string; icon: string; desc: string }> = {
  buy:      { label: 'Accumulation',    short: 'Achat',     color: '#34C759', bg: 'rgba(52,199,89,0.12)',   icon: '📥', desc: 'Retrait depuis un exchange → wallet privé. Signal haussier.' },
  sell:     { label: 'Distribution',   short: 'Vente',     color: '#FF3B30', bg: 'rgba(255,59,48,0.12)',   icon: '📤', desc: 'Dépôt vers un exchange → pression baissière potentielle.' },
  exchange: { label: 'Inter-exchange', short: 'Exchange',  color: '#FF9500', bg: 'rgba(255,149,0,0.10)',   icon: '🔄', desc: 'Transfert entre deux exchanges. Signal neutre.' },
  p2p:      { label: 'OTC / P2P',      short: 'OTC',       color: '#00E5FF', bg: 'rgba(0,229,255,0.08)',   icon: '🤝', desc: 'Transfer entre wallets inconnus. Souvent OTC — signal fort.' },
  spoofing: { label: 'Spoofing ?',     short: 'Spoofing',  color: '#BF5AF2', bg: 'rgba(191,90,242,0.12)', icon: '⚠️', desc: 'Même wallet, txs répétées rapides. Manipulation potentielle.' },
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const isEx = (addr: string, label?: string) => !!label && label !== addr && addr !== 'coinbase'

function getSignal(a: WhaleAlert): Signal {
  if ((a.scoreBreakdown?.velocityBonus ?? 0) >= 10) return 'spoofing'
  const fEx = isEx(a.from, a.fromLabel), tEx = isEx(a.to, a.toLabel)
  if (fEx && !tEx) return 'buy'
  if (!fEx && tEx) return 'sell'
  if (fEx && tEx)  return 'exchange'
  return 'p2p'
}

function fmt(n: number) {
  if (n < 0) return `-${fmt(-n)}`
  if (n >= 1e9) return `$${(n/1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n/1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n/1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}
function fmtAddr(raw: string, label?: string) {
  if (!raw || raw === 'unknown') return '?'
  if (raw === 'coinbase') return '⛏ Mining'
  if (label && label !== raw) return label
  return `${raw.slice(0,6)}…${raw.slice(-4)}`
}
function ago(ts: number) {
  const d = Math.floor((Date.now()-ts)/1000)
  if (d < 60) return `${d}s`
  if (d < 3600) return `${Math.floor(d/60)}m`
  if (d < 86400) return `${Math.floor(d/3600)}h`
  return `${Math.floor(d/86400)}j`
}
function scoreCol(s: number) {
  if (s >= 80) return '#FF9500'
  if (s >= 60) return '#BF5AF2'
  if (s >= 40) return '#0A85FF'
  return '#00E5FF'
}

// ── Verdict banner ─────────────────────────────────────────────────────────────
function VerdictBanner({ alerts }: { alerts: WhaleAlert[] }) {
  const h24 = alerts.filter(a => Date.now() - a.timestamp < 86_400_000)
  const bySignal = useMemo(() => {
    const r: Record<Signal, number> = { buy:0, sell:0, exchange:0, p2p:0, spoofing:0 }
    h24.forEach(a => r[getSignal(a)] += a.usdValue)
    return r
  }, [h24.length])

  const net = bySignal.buy - bySignal.sell
  const megaCount = h24.filter(a => a.scoreCategory === 'MEGA_WHALE').length
  const lastBig = h24.find(a => a.scoreCategory === 'MEGA_WHALE' || a.scoreCategory === 'WHALE')

  const isBull  = net > 0
  const isNeutral = Math.abs(net) < 1_000_000
  const color   = isNeutral ? '#8E8E93' : isBull ? '#34C759' : '#FF3B30'
  const verdict = isNeutral ? 'NEUTRE' : isBull ? 'HAUSSIER' : 'BAISSIER'
  const msg     = isNeutral
    ? 'Activité équilibrée entre achats et ventes'
    : isBull
    ? `Les baleines accumulent — ${fmt(bySignal.buy)} retirés des exchanges`
    : `Pression vendeuse — ${fmt(bySignal.sell)} déposés sur les exchanges`

  return (
    <div className="px-6 py-4 flex gap-4 items-stretch" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: `${color}08` }}>
      {/* Verdict principal */}
      <div className="flex-1 rounded-2xl p-4 flex flex-col justify-between"
        style={{ background: `${color}12`, border: `1px solid ${color}30` }}>
        <div className="flex items-center gap-2 mb-2">
          <div className="text-2xl">{isNeutral ? '⚖️' : isBull ? '🚀' : '🔻'}</div>
          <div>
            <div className="text-xs font-bold uppercase tracking-widest" style={{ color, opacity: 0.8 }}>Sentiment 24h</div>
            <div className="text-xl font-black" style={{ color, fontFamily: 'Syne, sans-serif', letterSpacing: '-0.5px' }}>
              {verdict}
            </div>
          </div>
          {megaCount > 0 && (
            <div className="ml-auto text-xs px-2.5 py-1 rounded-full font-bold animate-pulse"
              style={{ background: 'rgba(255,149,0,0.2)', color: '#FF9500', border: '1px solid rgba(255,149,0,0.4)' }}>
              🔥 {megaCount} Mega Whale{megaCount > 1 ? 's' : ''}
            </div>
          )}
        </div>
        <div className="text-sm" style={{ color: 'var(--tm-text-secondary)' }}>{msg}</div>
        {lastBig && (
          <div className="mt-2 text-xs" style={{ color: 'var(--tm-text-muted)' }}>
            Dernière grosse alerte : <span style={{ color }}>{lastBig.tokenSymbol} {fmt(lastBig.usdValue)}</span> — {ago(lastBig.timestamp)}
          </div>
        )}
      </div>

      {/* Flux net */}
      <div className="w-36 rounded-2xl p-4 flex flex-col justify-center items-center gap-1"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--tm-text-muted)' }}>Flux net 24h</div>
        <div className="text-2xl font-black" style={{ color, fontFamily: 'Syne, sans-serif' }}>{net >= 0 ? `+${fmt(net)}` : fmt(net)}</div>
        <div className="text-[10px]" style={{ color: 'var(--tm-text-muted)' }}>{h24.length} alertes</div>
      </div>

      {/* Mini stats */}
      <div className="flex flex-col gap-2 justify-center">
        {([['buy','sell'],['exchange','p2p']] as Signal[][]).map((pair, i) => (
          <div key={i} className="flex gap-2">
            {pair.map(sig => {
              const m = SIG_CFG[sig]
              return (
                <div key={sig} className="rounded-xl px-3 py-1.5 text-center" style={{ background: m.bg, minWidth: 80 }}>
                  <div className="text-[10px] font-semibold" style={{ color: m.color }}>{m.icon} {m.short}</div>
                  <div className="text-sm font-bold" style={{ color: 'var(--tm-text-primary)', fontFamily: 'Syne, sans-serif' }}>{fmt(bySignal[sig])}</div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Timeline SVG 24h ───────────────────────────────────────────────────────────
function TimelineChart({ alerts }: { alerts: WhaleAlert[] }) {
  const now    = Date.now()
  const h24    = alerts.filter(a => now - a.timestamp < 86_400_000)
  const curH   = new Date().getHours()

  const buckets = useMemo(() => {
    const arr = Array.from({length: 24}, () => ({ buy: 0, sell: 0, total: 0 }))
    h24.forEach(a => {
      const h = new Date(a.timestamp).getHours()
      const sig = getSignal(a)
      arr[h].total += a.usdValue
      if (sig === 'buy')  arr[h].buy  += a.usdValue
      if (sig === 'sell') arr[h].sell += a.usdValue
    })
    return arr
  }, [h24.length])

  const maxVal = Math.max(...buckets.map(b => b.total), 1)
  const W = 600, H = 80, barW = W/24 - 2

  return (
    <div className="px-6 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold" style={{ color: 'var(--tm-text-muted)', letterSpacing: '0.05em' }}>ACTIVITÉ 24H</span>
        <div className="flex items-center gap-3 text-[10px]" style={{ color: 'var(--tm-text-muted)' }}>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: '#34C759' }}/>Achats</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: '#FF3B30' }}/>Ventes</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: 'rgba(255,255,255,0.2)' }}/>Neutre</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 72 }}>
        {buckets.map((b, i) => {
          const x    = i * (W/24) + 1
          const isCur = i === curH
          const total = (b.total / maxVal) * (H - 10)
          const buyH  = total > 0 ? (b.buy / Math.max(b.total, 1)) * total : 0
          const sellH = total - buyH
          const neutH = Math.max(0, total - buyH - sellH)
          return (
            <g key={i}>
              {isCur && <rect x={x-1} y={0} width={barW+2} height={H} fill="rgba(255,255,255,0.04)" rx="2"/>}
              {/* Neutral base */}
              {total > 0 && <rect x={x} y={H - total} width={barW} height={neutH} fill="rgba(255,255,255,0.15)" rx="1"/>}
              {/* Sell on top of neutral */}
              {sellH > 0 && <rect x={x} y={H - total + neutH} width={barW} height={sellH} fill="#FF3B3088" rx="1"/>}
              {/* Buy at bottom */}
              {buyH > 0 && <rect x={x} y={H - buyH} width={barW} height={buyH} fill="#34C75988" rx="1"/>}
              {/* Hour label every 4h */}
              {i % 4 === 0 && <text x={x + barW/2} y={H+1} textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.25)">{i}h</text>}
              {isCur && <rect x={x} y={0} width={barW} height={2} fill="var(--tm-accent)" rx="1"/>}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ── Exchange net flow ──────────────────────────────────────────────────────────
function ExchangeFlow({ alerts }: { alerts: WhaleAlert[] }) {
  const h24 = alerts.filter(a => Date.now() - a.timestamp < 86_400_000)

  const flows = useMemo(() => {
    const map: Record<string, { out: number; inn: number }> = {}
    h24.forEach(a => {
      const sig = getSignal(a)
      if (sig === 'buy' && a.fromLabel && a.fromLabel !== a.from) {
        map[a.fromLabel] = map[a.fromLabel] ?? { out:0, inn:0 }
        map[a.fromLabel].out += a.usdValue
      }
      if (sig === 'sell' && a.toLabel && a.toLabel !== a.to) {
        map[a.toLabel] = map[a.toLabel] ?? { out:0, inn:0 }
        map[a.toLabel].inn += a.usdValue
      }
    })
    return Object.entries(map)
      .map(([name, v]) => ({ name, ...v, net: v.out - v.inn }))
      .filter(e => e.out + e.inn > 0)
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
      .slice(0, 5)
  }, [h24.length])

  if (flows.length === 0) return null

  const maxAbs = Math.max(...flows.map(f => Math.max(f.out, f.inn)), 1)

  return (
    <div className="px-6 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tm-text-muted)' }}>FLUX PAR EXCHANGE</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--tm-text-muted)' }}>
          24h — retraits vs dépôts
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {flows.map(f => {
          const outPct  = (f.out / maxAbs) * 100
          const innPct  = (f.inn / maxAbs) * 100
          const isBull  = f.net > 0
          const netCol  = isBull ? '#34C759' : '#FF3B30'
          return (
            <div key={f.name} className="rounded-xl px-4 py-3"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-sm font-bold w-20 flex-shrink-0" style={{ color: 'var(--tm-text-primary)' }}>{f.name}</span>
                <div className="flex-1 flex flex-col gap-1">
                  {/* OUT bar */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] w-8 text-right" style={{ color: '#34C759' }}>OUT</span>
                    <div className="flex-1 h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${outPct}%`, background: 'linear-gradient(90deg,#34C759,#34C75966)' }}/>
                    </div>
                    <span className="text-[10px] w-14 text-right font-semibold" style={{ color: '#34C759' }}>{fmt(f.out)}</span>
                  </div>
                  {/* IN bar */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] w-8 text-right" style={{ color: '#FF3B30' }}>IN</span>
                    <div className="flex-1 h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${innPct}%`, background: 'linear-gradient(90deg,#FF3B30,#FF3B3066)' }}/>
                    </div>
                    <span className="text-[10px] w-14 text-right font-semibold" style={{ color: '#FF3B30' }}>{fmt(f.inn)}</span>
                  </div>
                </div>
                {/* Net verdict */}
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-black" style={{ color: netCol, fontFamily: 'Syne, sans-serif' }}>
                    {f.net >= 0 ? `+${fmt(f.net)}` : fmt(f.net)}
                  </div>
                  <div className="text-[10px] font-semibold" style={{ color: netCol }}>
                    {isBull ? '🟢 Accumulation' : '🔴 Distribution'}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Signal legend (interactive) ────────────────────────────────────────────────
function SignalLegend() {
  const [tooltip, setTooltip] = useState<Signal | null>(null)
  return (
    <div className="px-6 py-2.5 flex items-center gap-2 flex-wrap" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: 'rgba(0,0,0,0.1)' }}>
      <span className="text-[10px] font-bold uppercase tracking-wider mr-1" style={{ color: 'var(--tm-text-muted)' }}>Signaux</span>
      {(Object.entries(SIG_CFG) as [Signal, typeof SIG_CFG[Signal]][]).map(([sig, m]) => (
        <div key={sig} className="relative">
          <button
            onMouseEnter={() => setTooltip(sig)} onMouseLeave={() => setTooltip(null)}
            className="text-[10px] px-2 py-1 rounded-lg flex items-center gap-1 cursor-help"
            style={{ background: m.bg, color: m.color, border: `1px solid ${m.color}30` }}>
            {m.icon} {m.short} <span style={{ opacity: 0.5 }}>?</span>
          </button>
          {tooltip === sig && (
            <div className="absolute bottom-full left-0 mb-1 z-50 rounded-lg px-3 py-2 text-[11px] w-52"
              style={{ background: 'var(--tm-bg)', border: `1px solid ${m.color}40`, color: 'var(--tm-text-secondary)', boxShadow: `0 4px 20px ${m.color}20` }}>
              <div className="font-semibold mb-0.5" style={{ color: m.color }}>{m.label}</div>
              {m.desc}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Alert card ─────────────────────────────────────────────────────────────────
function AlertCard({ alert, isNew }: { alert: WhaleAlert; isNew: boolean }) {
  const [open, setOpen] = useState(false)
  const cat  = CAT_CFG[alert.scoreCategory] ?? CAT_CFG['SHARK']
  const sig  = getSignal(alert)
  const sigM = SIG_CFG[sig]
  const sc   = scoreCol(alert.score)
  const ch   = CHAIN_CFG[alert.chain] ?? CHAIN_CFG['ethereum']
  const fromEx = isEx(alert.from, alert.fromLabel)
  const toEx   = isEx(alert.to, alert.toLabel)

  return (
    <div
      className="rounded-2xl overflow-hidden cursor-pointer transition-all duration-300"
      style={{
        background: 'rgba(255,255,255,0.025)',
        border: `1px solid ${isNew ? sigM.color : 'rgba(255,255,255,0.08)'}`,
        boxShadow: isNew ? `0 0 16px ${sigM.color}30` : 'none',
      }}
      onClick={() => setOpen(!open)}>

      {/* Signal color accent top bar */}
      <div className="h-0.5" style={{ background: `linear-gradient(90deg,${sigM.color}80,transparent)` }}/>

      <div className="px-4 py-3.5 flex items-center gap-4">
        {/* Amount — most important */}
        <div className="flex-shrink-0 text-right">
          <div className="text-lg font-black leading-none" style={{ color: sigM.color, fontFamily: 'Syne, sans-serif' }}>
            {fmt(alert.usdValue)}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--tm-text-muted)' }}>{ago(alert.timestamp)}</div>
        </div>

        {/* Divider */}
        <div className="w-px h-10 flex-shrink-0" style={{ background: 'rgba(255,255,255,0.08)' }}/>

        {/* Token + badges */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
            <span className="font-bold text-sm" style={{ color: 'var(--tm-text-primary)' }}>{alert.tokenSymbol}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: cat.bg, color: cat.color, border: `1px solid ${cat.border}` }}>{cat.label}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: ch.bg, color: ch.color }}>{ch.label}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: sigM.bg, color: sigM.color }}>{sigM.icon} {sigM.short}</span>
            {isNew && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold animate-pulse" style={{ background: 'rgba(0,229,255,0.15)', color: 'var(--tm-accent)', border: '1px solid rgba(0,229,255,0.3)' }}>NEW</span>}
          </div>

          {/* Flow: FROM → TO */}
          <div className="flex items-center gap-2 text-xs">
            <span className={`px-2 py-0.5 rounded-md font-medium ${fromEx ? 'font-bold' : ''}`}
              style={{ background: fromEx ? 'rgba(247,147,26,0.15)' : 'rgba(255,255,255,0.05)', color: fromEx ? '#F7931A' : 'var(--tm-text-muted)' }}>
              {fmtAddr(alert.from, alert.fromLabel)}
            </span>
            <span style={{ color: sigM.color }}>→</span>
            <span className={`px-2 py-0.5 rounded-md font-medium ${toEx ? 'font-bold' : ''}`}
              style={{ background: toEx ? 'rgba(52,199,89,0.12)' : 'rgba(255,255,255,0.05)', color: toEx ? '#34C759' : 'var(--tm-text-muted)' }}>
              {fmtAddr(alert.to, alert.toLabel)}
            </span>
          </div>
        </div>

        {/* Score ring */}
        <div className="flex-shrink-0 flex flex-col items-center gap-1">
          <svg width="36" height="36" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3"/>
            <circle cx="18" cy="18" r="15" fill="none" stroke={sc} strokeWidth="3"
              strokeDasharray={`${(alert.score/100)*94.2} 94.2`} strokeLinecap="round"
              transform="rotate(-90 18 18)" style={{ transition: 'stroke-dasharray 1s ease' }}/>
            <text x="18" y="22" textAnchor="middle" fontSize="9" fontWeight="bold" fill={sc}>{alert.score}</text>
          </svg>
          <div className="text-[9px]" style={{ color: 'var(--tm-text-muted)' }}>score</div>
        </div>

        <div className="text-[10px] flex-shrink-0" style={{ color: 'rgba(255,255,255,0.2)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</div>
      </div>

      {/* Expanded detail */}
      {open && (
        <div className="px-4 pb-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {[
              { label: 'Prix au moment', value: `$${alert.priceAtTime?.toFixed?.(4) ?? '—'}` },
              { label: 'Volume 24h paire', value: fmt(alert.pairVolume24h ?? 0) },
              { label: 'Block', value: `#${alert.blockNumber?.toLocaleString?.() ?? '—'}` },
            ].map(item => (
              <div key={item.label} className="rounded-xl p-2.5" style={{ background: 'rgba(255,255,255,0.04)' }}>
                <div className="text-[10px] mb-0.5" style={{ color: 'var(--tm-text-muted)' }}>{item.label}</div>
                <div className="text-xs font-semibold" style={{ color: 'var(--tm-text-primary)' }}>{item.value}</div>
              </div>
            ))}
          </div>

          {/* Score breakdown */}
          <div className="mt-3 rounded-xl p-3" style={{ background: 'rgba(0,0,0,0.2)' }}>
            <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--tm-text-muted)' }}>Score breakdown</div>
            <div className="flex gap-4">
              {[
                { label: 'Montant',    value: alert.scoreBreakdown?.amountScore ?? 0,         max: 40, tip: 'Impact absolu en USD' },
                { label: 'Vol. rel.',  value: alert.scoreBreakdown?.relativeVolumeScore ?? 0,  max: 40, tip: '% du volume 24h de la paire' },
                { label: 'Vélocité',  value: alert.scoreBreakdown?.velocityBonus ?? 0,         max: 20, tip: 'Txs répétées du même wallet' },
              ].map(b => (
                <div key={b.label} className="flex-1" title={b.tip}>
                  <div className="flex justify-between text-[10px] mb-1" style={{ color: 'var(--tm-text-muted)' }}>
                    <span>{b.label}</span><span style={{ color: sc }}>{b.value}/{b.max}</span>
                  </div>
                  <div className="h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${(b.value/b.max)*100}%`, background: sc }}/>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <div className="text-[10px] font-mono px-2 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--tm-text-muted)' }}>
              {alert.txHash.slice(0,12)}…{alert.txHash.slice(-8)}
            </div>
            <a href={ch.explorer(alert.txHash)} target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all hover:opacity-80"
              style={{ background: 'rgba(0,229,255,0.1)', color: 'var(--tm-accent)', border: '1px solid rgba(0,229,255,0.25)' }}>
              Voir sur {alert.chain === 'bitcoin' ? 'mempool.space' : alert.chain === 'bsc' ? 'BscScan' : 'Etherscan'} ↗
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Insider trades (Feature A) ─────────────────────────────────────────────────
interface InsiderTrade {
  symbol: string; name: string; transactionDate: string
  transactionCode: string; shares: number; pricePerShare: number; totalValue: number
}
function InsiderTradesSection() {
  const [data,    setData]    = useState<InsiderTrade[]>([])
  const [loading, setLoading] = useState(true)
  const [tab,     setTab]     = useState<'buy'|'sell'>('buy')
  const [error,   setError]   = useState(false)

  useEffect(() => {
    const fn = httpsCallable<Record<string,never>, { data: InsiderTrade[] }>(fbFn, 'fetchInsiderTrades')
    fn({}).then(r => { setData(r.data.data ?? []); setLoading(false) })
          .catch(() => { setError(true); setLoading(false) })
  }, [])

  const fmtShares = (n: number) => n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(0)}K` : `${n}`
  const fmtVal    = (n: number) => n >= 1e9 ? `$${(n/1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n/1e3).toFixed(0)}K` : `$${n.toFixed(0)}`

  const buys  = data.filter(t => t.transactionCode === 'P').slice(0, 10)
  const sells = data.filter(t => t.transactionCode === 'S').slice(0, 10)
  const shown = tab === 'buy' ? buys : sells
  const color = tab === 'buy' ? '#34C759' : '#FF3B30'
  const icon  = tab === 'buy' ? '📥' : '📤'

  return (
    <div className="px-6 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tm-text-muted)' }}>
          🏦 SMART MONEY STOCKS
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--tm-text-muted)' }}>
          Insiders SEC Form 4
        </span>
        <div className="ml-auto flex gap-1">
          {(['buy','sell'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className="text-[10px] px-2.5 py-1 rounded-lg font-semibold transition-all"
              style={{
                background: tab===t ? (t==='buy'?'rgba(52,199,89,0.15)':'rgba(255,59,48,0.15)') : 'rgba(255,255,255,0.04)',
                color: tab===t ? (t==='buy'?'#34C759':'#FF3B30') : 'var(--tm-text-muted)',
                border: `1px solid ${tab===t ? (t==='buy'?'rgba(52,199,89,0.3)':'rgba(255,59,48,0.3)') : 'rgba(255,255,255,0.08)'}`,
              }}>
              {t==='buy'?'📥 Achats':'📤 Ventes'}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-16 gap-2" style={{ color: 'var(--tm-text-muted)' }}>
          <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: 'rgba(0,229,255,0.2)', borderTopColor: 'var(--tm-accent)' }}/>
          <span className="text-xs">Chargement données SEC…</span>
        </div>
      )}

      {error && (
        <div className="text-xs text-center py-3" style={{ color: 'var(--tm-text-muted)' }}>
          Données indisponibles — réessayez dans quelques instants
        </div>
      )}

      {!loading && !error && shown.length === 0 && (
        <div className="text-xs text-center py-3" style={{ color: 'var(--tm-text-muted)' }}>
          Aucun mouvement récent de ce type
        </div>
      )}

      {!loading && !error && shown.length > 0 && (
        <div className="overflow-x-auto">
          <div className="flex flex-col gap-1.5 min-w-[380px]">
            {shown.map((t, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}>
                {/* Rank */}
                <div className="text-[10px] font-bold w-4 flex-shrink-0" style={{ color: 'var(--tm-text-muted)' }}>#{i+1}</div>
                {/* Ticker */}
                <div className="w-12 flex-shrink-0">
                  <div className="text-xs font-black" style={{ color, fontFamily: 'Syne, sans-serif' }}>{t.symbol}</div>
                </div>
                {/* Insider name */}
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold truncate" style={{ color: 'var(--tm-text-primary)' }}>{t.name}</div>
                  <div className="text-[10px]" style={{ color: 'var(--tm-text-muted)' }}>{t.transactionDate} · {fmtShares(t.shares)} actions @ ${t.pricePerShare.toFixed(2)}</div>
                </div>
                {/* Value */}
                <div className="flex-shrink-0 text-right">
                  <div className="text-sm font-black" style={{ color, fontFamily: 'Syne, sans-serif' }}>{fmtVal(t.totalValue)}</div>
                  <div className="text-[9px]" style={{ color: 'var(--tm-text-muted)' }}>{icon} {t.transactionCode === 'P' ? 'Achat' : 'Vente'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page principale ────────────────────────────────────────────────────────────
export default function WhaleAlertsPage() {
  const user   = useUser()
  const [alerts, setAlerts]     = useState<WhaleAlert[]>([])
  const [loading, setLoading]   = useState(true)
  const [catFilter, setCat]     = useState<'all'|'MEGA_WHALE'|'WHALE'|'BIG_FISH'|'SHARK'>('all')
  const [sigFilter, setSig]     = useState<'all'|Signal>('all')
  const [tokenFilter, setToken] = useState<string>('all')
  const prevIds = useRef<Set<string>>(new Set())
  const [newIds, setNewIds]     = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!user?.uid) return
    const q = query(collection(db, 'alerts'), orderBy('timestamp','desc'), limit(200))
    const unsub = onSnapshot(q, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as WhaleAlert))
      // Detect new alerts (flash animation)
      const incoming = new Set(data.map(a => a.id))
      const fresh = new Set([...incoming].filter(id => !prevIds.current.has(id)))
      if (prevIds.current.size > 0 && fresh.size > 0) {
        setNewIds(fresh)
        setTimeout(() => setNewIds(new Set()), 8000)
      }
      prevIds.current = incoming
      setAlerts(data)
      setLoading(false)
    }, err => { console.error('[WhaleAlerts]', err); setLoading(false) })
    return () => unsub()
  }, [user?.uid])

  const tokens   = ['all', ...Array.from(new Set(alerts.map(a => a.tokenSymbol))).sort()]
  const filtered = alerts.filter(a => {
    if (catFilter !== 'all' && a.scoreCategory !== catFilter) return false
    if (sigFilter !== 'all' && getSignal(a) !== sigFilter) return false
    if (tokenFilter !== 'all' && a.tokenSymbol !== tokenFilter) return false
    return true
  })
  const totalVol = alerts.reduce((s,a) => s+a.usdValue, 0)

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--tm-bg)', color: 'var(--tm-text-primary)' }}>

      {/* ── Top bar ── */}
      <div className="px-6 pt-5 pb-4 flex items-center gap-4 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div>
          <h1 className="text-lg font-black leading-none" style={{ fontFamily: 'Syne, sans-serif' }}>Whale Alerts</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--tm-text-muted)' }}>
            BTC · ETH · ERC-20 &gt; $500k
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="text-sm font-bold" style={{ color: 'var(--tm-text-muted)' }}>
            <span style={{ color: 'var(--tm-accent)' }}>{fmt(totalVol)}</span> total
          </div>
          <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
            style={{ background: 'rgba(52,199,89,0.1)', border: '1px solid rgba(52,199,89,0.25)', color: '#34C759' }}>
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#34C759' }}/>Live
          </div>
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto">

        {/* Verdict */}
        {!loading && alerts.length > 0 && <VerdictBanner alerts={alerts}/>}

        {/* Timeline */}
        {!loading && alerts.length > 0 && <TimelineChart alerts={alerts}/>}

        {/* Exchange flows */}
        {!loading && <ExchangeFlow alerts={alerts}/>}

        {/* Smart Money — Insider trades */}
        {!loading && <InsiderTradesSection/>}

        {/* Signal legend */}
        <SignalLegend/>

        {/* ── Filtres ── */}
        <div className="px-6 py-3 flex items-center gap-2 flex-wrap sticky top-0 z-10"
          style={{ background: 'var(--tm-bg)', borderBottom: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(8px)' }}>

          {/* Catégorie */}
          {(['all','MEGA_WHALE','WHALE','BIG_FISH','SHARK'] as const).map(f => (
            <button key={f} onClick={() => setCat(f)}
              className="text-xs px-2.5 py-1.5 rounded-lg cursor-pointer transition-all"
              style={{
                background: catFilter===f ? 'rgba(0,229,255,0.12)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${catFilter===f ? 'rgba(0,229,255,0.3)' : 'rgba(255,255,255,0.08)'}`,
                color: catFilter===f ? 'var(--tm-accent)' : 'var(--tm-text-muted)',
                fontWeight: catFilter===f ? 600 : 400,
              }}>
              {f === 'all' ? 'Tous' : CAT_CFG[f].label}
            </button>
          ))}

          <div className="w-px h-4 flex-shrink-0" style={{ background: 'rgba(255,255,255,0.1)' }}/>

          {/* Signal */}
          {(['all','buy','sell','spoofing','p2p','exchange'] as const).map(f => {
            const m = f === 'all' ? null : SIG_CFG[f]
            return (
              <button key={f} onClick={() => setSig(f)}
                className="text-xs px-2.5 py-1.5 rounded-lg cursor-pointer transition-all"
                style={{
                  background: sigFilter===f ? (m?`${m.color}20`:'rgba(0,229,255,0.12)') : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${sigFilter===f ? (m?`${m.color}50`:'rgba(0,229,255,0.3)') : 'rgba(255,255,255,0.08)'}`,
                  color: sigFilter===f ? (m?.color ?? 'var(--tm-accent)') : 'var(--tm-text-muted)',
                  fontWeight: sigFilter===f ? 600 : 400,
                }}>
                {f === 'all' ? 'Tous signaux' : `${m!.icon} ${m!.short}`}
              </button>
            )
          })}

          <select value={tokenFilter} onChange={e => setToken(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-lg ml-auto cursor-pointer"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--tm-text-secondary)', outline: 'none' }}>
            {tokens.map(t => <option key={t} value={t} style={{ background: 'var(--tm-bg)' }}>{t === 'all' ? 'Tous les tokens' : t}</option>)}
          </select>

          <span className="text-[10px]" style={{ color: 'var(--tm-text-muted)' }}>{filtered.length} résultat{filtered.length > 1 ? 's' : ''}</span>
        </div>

        {/* ── Liste alertes ── */}
        <div className="px-6 py-4 flex flex-col gap-2.5">
          {loading && (
            <div className="flex items-center justify-center h-48 gap-3" style={{ color: 'var(--tm-text-muted)' }}>
              <div className="w-5 h-5 rounded-full border-2 animate-spin" style={{ borderColor: 'rgba(0,229,255,0.2)', borderTopColor: 'var(--tm-accent)' }}/>
              Connexion au flux temps réel…
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 gap-3" style={{ color: 'var(--tm-text-muted)' }}>
              <span className="text-4xl">🔭</span>
              <p className="text-sm">Aucune alerte pour ce filtre</p>
              <p className="text-xs">Le scanner tourne toutes les minutes</p>
            </div>
          )}
          {filtered.map(alert => (
            <AlertCard key={alert.id} alert={alert} isNew={newIds.has(alert.id)}/>
          ))}
        </div>
      </div>
    </div>
  )
}
