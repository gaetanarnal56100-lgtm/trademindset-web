// src/pages/analyse/RsiHeatmap.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Carte Thermique RSI / VMC — Tile grid par zone, filtrable, avec tooltip
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo, useRef, useEffect } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

export interface TokenRSI {
  symbol: string
  rsi: number
  wt1: number       // WaveTrend WT1 (VMC proxy)
  change24h: number
  volume: number
  price: number
}

type View = 'rsi' | 'vmc'
type Timeframe = '5m' | '15m' | '1h' | '4h' | '1d'

interface RsiHeatmapProps {
  tokens?: TokenRSI[]
  defaultTimeframe?: Timeframe
  onTimeframeChange?: (tf: string) => void
  onTokenClick?: (symbol: string) => void
}

// ── RSI Zone config ──────────────────────────────────────────────────────────

type RsiZone = 'overbought' | 'strong' | 'neutral' | 'weak' | 'oversold'

const RSI_ZONES: { id: RsiZone; label: string; range: string; color: string; bg: string }[] = [
  { id: 'overbought', label: 'Suracheté',  range: '≥ 75', color: '#ff3b5c', bg: 'rgba(255,59,92,0.10)' },
  { id: 'strong',     label: 'Fort',       range: '60–74', color: '#ff8c61', bg: 'rgba(255,140,97,0.08)' },
  { id: 'neutral',    label: 'Neutre',     range: '40–59', color: '#6b7280', bg: 'rgba(107,114,128,0.06)' },
  { id: 'weak',       label: 'Faible',     range: '30–39', color: '#4ecdc4', bg: 'rgba(78,205,196,0.08)' },
  { id: 'oversold',   label: 'Survendu',   range: '< 30',  color: '#00d4aa', bg: 'rgba(0,212,170,0.10)' },
]

function getRsiZone(rsi: number): RsiZone {
  if (rsi >= 75) return 'overbought'
  if (rsi >= 60) return 'strong'
  if (rsi >= 40) return 'neutral'
  if (rsi >= 30) return 'weak'
  return 'oversold'
}

// ── VMC Zone config ──────────────────────────────────────────────────────────

type VmcZone = 'vOverbought' | 'vBullish' | 'vNeutral' | 'vBearish' | 'vOversold'

const VMC_ZONES: { id: VmcZone; label: string; range: string; color: string; bg: string }[] = [
  { id: 'vOverbought', label: 'Suracheté',  range: '≥ 53',    color: '#ff3b5c', bg: 'rgba(255,59,92,0.10)' },
  { id: 'vBullish',    label: 'Haussier',   range: '20–52',   color: '#22c759', bg: 'rgba(34,199,89,0.08)' },
  { id: 'vNeutral',    label: 'Neutre',     range: '-19–19',  color: '#6b7280', bg: 'rgba(107,114,128,0.06)' },
  { id: 'vBearish',    label: 'Baissier',   range: '-52– -20',color: '#ff8c61', bg: 'rgba(255,140,97,0.08)' },
  { id: 'vOversold',   label: 'Survendu',   range: '≤ -53',   color: '#00d4aa', bg: 'rgba(0,212,170,0.10)' },
]

function getVmcZone(wt1: number): VmcZone {
  if (wt1 >= 53) return 'vOverbought'
  if (wt1 >= 20) return 'vBullish'
  if (wt1 > -20) return 'vNeutral'
  if (wt1 > -53) return 'vBearish'
  return 'vOversold'
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveCSSColor(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback
}

function fmtPrice(p: number | undefined | null): string {
  if (p == null || isNaN(p) || !isFinite(p)) return '—'
  if (p < 0.001) return p.toFixed(6)
  if (p < 1) return p.toFixed(4)
  if (p < 100) return p.toFixed(2)
  return p.toFixed(0)
}

// ── View Toggle ──────────────────────────────────────────────────────────────

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const active: React.CSSProperties = {
    padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
    fontSize: 11, fontWeight: 700, background: 'var(--tm-bg-tertiary)',
    color: 'var(--tm-text-primary)', transition: 'all 0.15s',
  }
  const inactive: React.CSSProperties = {
    ...active, background: 'transparent',
    color: 'var(--tm-text-muted)', fontWeight: 400,
  }
  return (
    <div style={{ display: 'flex', gap: 1, background: 'var(--tm-bg-secondary)', borderRadius: 7, padding: 2, border: '1px solid var(--tm-border-sub)' }}>
      <button onClick={() => onChange('rsi')} style={view === 'rsi' ? active : inactive}>RSI</button>
      <button onClick={() => onChange('vmc')} style={view === 'vmc' ? { ...active, color: '#BF5AF2' } : inactive}>VMC</button>
    </div>
  )
}

// ── Token Tile ───────────────────────────────────────────────────────────────

function TokenTile({ token, view, onClick, onHover, hovered }: {
  token: TokenRSI; view: View
  onClick?: (sym: string) => void
  onHover: (t: TokenRSI | null, el: HTMLElement | null) => void
  hovered: boolean
}) {
  const rsiZ = RSI_ZONES.find(z => z.id === getRsiZone(token.rsi ?? 50))!
  const vmcZ = VMC_ZONES.find(z => z.id === getVmcZone(token.wt1 ?? 0))!
  const z = view === 'rsi' ? rsiZ : vmcZ
  const val = view === 'rsi' ? (token.rsi ?? 50) : (token.wt1 ?? 0)

  return (
    <div
      onClick={() => onClick?.(token.symbol)}
      onMouseEnter={e => onHover(token, e.currentTarget)}
      onMouseLeave={() => onHover(null, null)}
      style={{
        width: 76, minHeight: 58, borderRadius: 8,
        background: hovered ? z.bg.replace(/[\d.]+\)$/, '0.18)') : z.bg,
        border: `1px solid ${hovered ? z.color + '88' : z.color + '30'}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 2, cursor: onClick ? 'pointer' : 'default',
        padding: '6px 4px',
        transition: 'all 0.12s',
        transform: hovered ? 'scale(1.06)' : 'scale(1)',
        boxShadow: hovered ? `0 4px 12px ${z.color}22` : 'none',
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--tm-text-primary)', letterSpacing: 0.3, fontFamily: "'JetBrains Mono',monospace" }}>
        {token.symbol}
      </div>
      <div style={{ fontSize: 13, fontWeight: 800, color: z.color, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1 }}>
        {val > 0 && view === 'vmc' ? '+' : ''}{val}
      </div>
      <div style={{
        fontSize: 9, fontWeight: 600,
        color: token.change24h >= 0 ? '#22c759' : '#ff3b5c',
        fontFamily: "'JetBrains Mono',monospace",
      }}>
        {token.change24h >= 0 ? '▲' : '▼'} {Math.abs(token.change24h).toFixed(1)}%
      </div>
    </div>
  )
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

function Tooltip({ token, anchor }: { token: TokenRSI | null; anchor: HTMLElement | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!token || !anchor || !ref.current) return
    const ar = anchor.getBoundingClientRect()
    const tr = ref.current.getBoundingClientRect()
    const sr = document.documentElement
    let left = ar.right + 10
    let top = ar.top + ar.height / 2 - tr.height / 2
    if (left + tr.width > sr.clientWidth - 10) left = ar.left - tr.width - 10
    if (top < 10) top = 10
    if (top + tr.height > sr.clientHeight - 10) top = sr.clientHeight - tr.height - 10
    setPos({ top, left })
  }, [token, anchor])

  if (!token) return null
  const rsiZ = RSI_ZONES.find(z => z.id === getRsiZone(token.rsi ?? 50))!
  const vmcZ = VMC_ZONES.find(z => z.id === getVmcZone(token.wt1 ?? 0))!
  const profit = resolveCSSColor('--tm-profit', '#22C759')
  const loss = resolveCSSColor('--tm-loss', '#FF3B30')

  return (
    <div ref={ref} style={{
      position: 'fixed', ...pos, zIndex: 9999, pointerEvents: 'none',
      width: 220,
      background: 'var(--tm-bg, #0D1117)',
      border: `1px solid ${rsiZ.color}44`,
      borderRadius: 10, padding: '12px 14px',
      backdropFilter: 'blur(16px)',
      boxShadow: `0 8px 32px rgba(0,0,0,0.55), inset 0 1px 0 ${rsiZ.color}10`,
      fontFamily: "'JetBrains Mono','Fira Code',monospace",
    }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--tm-text-primary)', marginBottom: 10, letterSpacing: 0.4 }}>
        {token.symbol}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px', fontSize: 11.5 }}>
        <span style={{ color: 'var(--tm-text-muted)' }}>RSI</span>
        <span style={{ color: rsiZ.color, fontWeight: 700, textAlign: 'right' }}>
          {token.rsi} <span style={{ fontSize: 9, opacity: 0.7 }}>({rsiZ.label})</span>
        </span>

        <span style={{ color: 'var(--tm-text-muted)' }}>VMC WT1</span>
        <span style={{ color: vmcZ.color, fontWeight: 700, textAlign: 'right' }}>
          {(token.wt1 ?? 0) > 0 ? '+' : ''}{token.wt1 ?? 0} <span style={{ fontSize: 9, opacity: 0.7 }}>({vmcZ.label})</span>
        </span>

        <span style={{ color: 'var(--tm-text-muted)' }}>24h</span>
        <span style={{ color: token.change24h >= 0 ? profit : loss, fontWeight: 700, textAlign: 'right' }}>
          {token.change24h >= 0 ? '+' : ''}{token.change24h}%
        </span>

        <span style={{ color: 'var(--tm-text-muted)' }}>Prix</span>
        <span style={{ color: 'var(--tm-text-secondary)', fontWeight: 600, textAlign: 'right' }}>
          ${fmtPrice(token.price)}
        </span>

        <span style={{ color: 'var(--tm-text-muted)' }}>Vol.</span>
        <span style={{ color: 'var(--tm-text-secondary)', fontWeight: 600, textAlign: 'right' }}>
          {token.volume ? `$${((token.volume) / 1e6).toFixed(1)}M` : '—'}
        </span>
      </div>
    </div>
  )
}

// ── Zone Section ─────────────────────────────────────────────────────────────

function ZoneSection({ zone, tokens, view, onTokenClick, onHover, hoveredSym }: {
  zone: { id: string; label: string; range: string; color: string; bg: string }
  tokens: TokenRSI[]
  view: View
  onTokenClick?: (sym: string) => void
  onHover: (t: TokenRSI | null, el: HTMLElement | null) => void
  hoveredSym: string | null
}) {
  const [collapsed, setCollapsed] = useState(false)
  if (tokens.length === 0) return null

  return (
    <div style={{ marginBottom: 8 }}>
      <button
        onClick={() => setCollapsed(c => !c)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '4px 2px', marginBottom: collapsed ? 0 : 6,
          width: '100%', textAlign: 'left',
        }}
      >
        <div style={{ width: 8, height: 8, borderRadius: 2, background: zone.color, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: zone.color }}>{zone.label}</span>
        <span style={{ fontSize: 10, color: 'var(--tm-text-muted)' }}>{zone.range}</span>
        <span style={{
          marginLeft: 4, fontSize: 10, fontWeight: 700,
          background: zone.color + '22', color: zone.color,
          padding: '1px 6px', borderRadius: 99,
        }}>{tokens.length}</span>
        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--tm-text-muted)', opacity: 0.5 }}>{collapsed ? '▶' : '▼'}</span>
      </button>

      {!collapsed && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {tokens.map(t => (
            <TokenTile
              key={t.symbol}
              token={t}
              view={view}
              onClick={onTokenClick}
              onHover={onHover}
              hovered={hoveredSym === t.symbol}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Distribution Bar ─────────────────────────────────────────────────────────

function DistributionBar({ tokens, view }: { tokens: TokenRSI[]; view: View }) {
  const total = tokens.length || 1
  const zones = view === 'rsi' ? RSI_ZONES : VMC_ZONES
  const counts = zones.map(z => ({
    ...z,
    count: view === 'rsi'
      ? tokens.filter(t => getRsiZone(t.rsi ?? 50) === z.id).length
      : tokens.filter(t => getVmcZone(t.wt1 ?? 0) === z.id).length,
  }))
  return (
    <div style={{ padding: '0 2px' }}>
      <div style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', background: 'var(--tm-bg-secondary)' }}>
        {counts.map((z, i) => (
          <div key={i} style={{ width: `${(z.count / total) * 100}%`, background: z.color, transition: 'width 0.4s ease' }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        {counts.map((z, i) => (
          <span key={i} style={{ fontSize: 10, fontWeight: 600, color: z.color, fontFamily: "'JetBrains Mono',monospace" }}>
            {z.count} <span style={{ color: 'var(--tm-text-muted)', fontWeight: 400, fontSize: 9 }}>{z.label}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Simulated data (fallback when no external tokens) ────────────────────────

const SYMBOLS_DEMO = [
  'BTC','ETH','SOL','BNB','XRP','ADA','DOGE','AVAX','DOT','LINK','UNI','ATOM',
  'APT','ARB','OP','SUI','INJ','NEAR','AAVE','MKR','CRV','LDO','RUNE','SHIB',
  'PEPE','WIF','BONK','TAO','RENDER','FET',
]

function simulateData(seed: number): TokenRSI[] {
  return SYMBOLS_DEMO.map((symbol, i) => {
    const r = Math.abs(Math.sin(i * 1337.7 + seed * 7919.3))
    const r2 = Math.abs(Math.sin(i * 997.1 + seed * 3571.9))
    const r3 = Math.abs(Math.sin(i * 541.3 + seed * 2311.7))
    return {
      symbol,
      rsi: +(r * 82 + 8).toFixed(2),
      wt1: +((r3 - 0.5) * 130).toFixed(2),
      change24h: +((r2 - 0.5) * 28).toFixed(2),
      volume: r2 * 400_000_000 + 500_000,
      price: r * 60000 + 0.001,
    }
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ══════════════════════════════════════════════════════════════════════════════

export default function RsiHeatmap({
  tokens: externalTokens,
  defaultTimeframe = '4h',
  onTimeframeChange,
  onTokenClick,
}: RsiHeatmapProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>(defaultTimeframe)
  const [view, setView] = useState<View>('rsi')
  const [search, setSearch] = useState('')
  const [hoveredToken, setHoveredToken] = useState<TokenRSI | null>(null)
  const [hoveredAnchor, setHoveredAnchor] = useState<HTMLElement | null>(null)

  const tfSeed: Record<Timeframe, number> = { '5m': 1, '15m': 2, '1h': 3, '4h': 4, '1d': 5 }

  const allTokens = useMemo(() => {
    if (externalTokens && externalTokens.length > 0) return externalTokens
    return simulateData(tfSeed[timeframe])
  }, [externalTokens, timeframe])

  const filtered = useMemo(() => {
    if (!search) return allTokens
    const q = search.toUpperCase()
    return allTokens.filter(t => t.symbol.toUpperCase().includes(q))
  }, [allTokens, search])

  const handleTfChange = (tf: Timeframe) => {
    setTimeframe(tf)
    onTimeframeChange?.(tf)
  }

  const handleHover = (t: TokenRSI | null, el: HTMLElement | null) => {
    setHoveredToken(t)
    setHoveredAnchor(el)
  }

  const timeframes: Timeframe[] = ['5m', '15m', '1h', '4h', '1d']

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
    fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono',monospace",
    background: active ? 'var(--tm-bg-tertiary)' : 'transparent',
    color: active ? 'var(--tm-text-primary)' : 'var(--tm-text-muted)',
    transition: 'all 0.15s',
  })

  // Group tokens by zone
  const zones = view === 'rsi' ? RSI_ZONES : VMC_ZONES
  const grouped = useMemo(() => {
    return zones.map(z => ({
      zone: z,
      tokens: view === 'rsi'
        ? [...filtered].filter(t => getRsiZone(t.rsi ?? 50) === z.id).sort((a, b) => (b.rsi ?? 50) - (a.rsi ?? 50))
        : [...filtered].filter(t => getVmcZone(t.wt1 ?? 0) === z.id).sort((a, b) => (b.wt1 ?? 0) - (a.wt1 ?? 0)),
    }))
  }, [filtered, view, zones])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14 }}>🌡️</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-primary)' }}>
            Carte Thermique {view === 'rsi' ? 'RSI' : 'VMC'}
          </span>
          <span style={{
            fontSize: 10, color: 'var(--tm-text-muted)', background: 'var(--tm-bg-secondary)',
            padding: '2px 8px', borderRadius: 4, border: '1px solid var(--tm-border-sub)',
          }}>
            {filtered.length} tokens
          </span>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* View toggle (RSI / VMC) */}
          <ViewToggle view={view} onChange={setView} />

          {/* Timeframe */}
          <div style={{ display: 'flex', gap: 1, background: 'var(--tm-bg-secondary)', borderRadius: 7, padding: 2, border: '1px solid var(--tm-border-sub)' }}>
            {timeframes.map(tf => (
              <button key={tf} onClick={() => handleTfChange(tf)} style={btnStyle(timeframe === tf)}>{tf.toUpperCase()}</button>
            ))}
          </div>

          {/* Search */}
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher…"
            style={{
              background: 'var(--tm-bg-secondary)', border: '1px solid var(--tm-border-sub)',
              borderRadius: 7, padding: '5px 10px', fontSize: 11,
              color: 'var(--tm-text-primary)', fontFamily: "'JetBrains Mono',monospace",
              outline: 'none', width: 130,
            }}
          />
        </div>
      </div>

      {/* Zone groups */}
      <div>
        {grouped.map(({ zone, tokens }) => (
          <ZoneSection
            key={zone.id}
            zone={zone}
            tokens={tokens}
            view={view}
            onTokenClick={onTokenClick}
            onHover={handleHover}
            hoveredSym={hoveredToken?.symbol ?? null}
          />
        ))}
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--tm-text-muted)', fontSize: 13 }}>
            Aucun token trouvé
          </div>
        )}
      </div>

      {/* Distribution bar */}
      <DistributionBar tokens={filtered} view={view} />

      {/* Footer */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 10, color: 'var(--tm-text-muted)', fontFamily: "'JetBrains Mono',monospace",
        opacity: 0.5,
      }}>
        <span>{view === 'rsi' ? 'RSI' : 'VMC WT1'} {timeframe.toUpperCase()} · {externalTokens ? 'Données live' : 'Données simulées'}</span>
        <span>TradeMindset</span>
      </div>

      {/* Tooltip (fixed position) */}
      <Tooltip token={hoveredToken} anchor={hoveredAnchor} />
    </div>
  )
}
