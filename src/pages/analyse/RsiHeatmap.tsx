// src/pages/analyse/RsiHeatmap.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Carte Thermique RSI — Grille de tuiles groupées par zone
// Compatible thèmes TradeMindset (CSS vars --tm-*)
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo, useRef } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

interface TokenRSI {
  symbol: string
  rsi: number
  change24h: number
  volume: number
  price: number
}

type RsiZone = 'overbought' | 'strong' | 'neutral' | 'weak' | 'oversold'
type Timeframe = '5m' | '15m' | '1h' | '4h' | '1d'

interface RsiHeatmapProps {
  tokens?: TokenRSI[]
  defaultTimeframe?: Timeframe
  onTimeframeChange?: (tf: Timeframe) => void
  onTokenClick?: (symbol: string) => void
}

// ── Zone config ──────────────────────────────────────────────────────────────

const ZONE_CFG: Record<RsiZone, { label: string; range: string; color: string; bg: string }> = {
  overbought: { label: 'Suracheté',  range: '≥ 75', color: '#ff3b5c', bg: 'rgba(255,59,92,0.07)' },
  strong:     { label: 'Fort',       range: '60–74', color: '#ff8c69', bg: 'rgba(255,140,105,0.05)' },
  neutral:    { label: 'Neutre',     range: '40–59', color: '#6b7280', bg: 'rgba(107,114,128,0.04)' },
  weak:       { label: 'Faible',     range: '30–39', color: '#4ecdc4', bg: 'rgba(78,205,196,0.05)' },
  oversold:   { label: 'Survendu',   range: '< 30',  color: '#00d4aa', bg: 'rgba(0,212,170,0.07)' },
}

const ZONE_ORDER: RsiZone[] = ['overbought', 'strong', 'neutral', 'weak', 'oversold']

function getZone(rsi: number): RsiZone {
  if (rsi >= 75) return 'overbought'
  if (rsi >= 60) return 'strong'
  if (rsi >= 40) return 'neutral'
  if (rsi >= 30) return 'weak'
  return 'oversold'
}

function rsiColor(rsi: number): string {
  if (rsi >= 75) return '#ff3b5c'
  if (rsi >= 60) return '#ff8c69'
  if (rsi >= 40) return '#6b7280'
  if (rsi >= 30) return '#4ecdc4'
  return '#00d4aa'
}

// ── Simulated data ───────────────────────────────────────────────────────────

const SYMBOLS = [
  'BTC','ETH','SOL','BNB','XRP','ADA','DOGE','AVAX','DOT','MATIC','LINK','UNI',
  'ATOM','FIL','APT','ARB','OP','SUI','SEI','INJ','TIA','NEAR','FTM','ALGO',
  'AAVE','MKR','CRV','LDO','RUNE','SNX','COMP','SAND','MANA','AXS','IMX','GALA',
  'ENJ','FLOW','ICP','HBAR','VET','EOS','XLM','TRX','SHIB','PEPE','WIF','BONK',
  'FLOKI','MEME','STX','ORDI','KAS','TAO','RENDER','FET','AGIX','OCEAN','AR','GRT',
  'THETA','ROSE','ZIL','ONE','CELO','KAVA','OSMO','WLD','BLUR','MAGIC','GMX',
  'RDNT','PENDLE','JOE','DYDX','TWT','MASK','BAL','SUSHI','1INCH','ANKR','SKL',
  'STORJ','GNO','LRC','ZRX','KNC','JASMY','CHZ','ENS','ACH','PERP','HIGH',
  'LEVER','BICO','RARE','REQ','PROM','SLP','PYR','SUPER','GODS','ILV','YGG',
  'RONIN','PRIME','PIXEL','PORTAL','XAI','MANTA','DYM','STRK','MODE','ETHFI',
  'NOT','IO','ZK','ZRO','LISTA','BLAST','EIGEN','HMSTR','NEIRO','TURBO','BRETT',
  'PEOPLE','BOME','MEW','POPCAT','JTO','PYTH','JUP','ONDO','ENA','AEVO','ALT',
]

function simulateData(seed: number): TokenRSI[] {
  return SYMBOLS.map((symbol, i) => {
    const r  = Math.abs(Math.sin(i * 1337.7 + seed * 7919.3))
    const r2 = Math.abs(Math.sin(i * 997.1  + seed * 3571.9))
    return {
      symbol,
      rsi:      +(r  * 82 + 8).toFixed(2),
      change24h: +((r2 - 0.5) * 28).toFixed(2),
      volume:   r2 * 400_000_000 + 500_000,
      price:    r  * 60000 + 0.001,
    }
  })
}

// ── Token Tile ───────────────────────────────────────────────────────────────

function TokenTile({
  token, onHover, onClick,
}: { token: TokenRSI; onHover: (t: TokenRSI | null, e: React.MouseEvent | null) => void; onClick: () => void }) {
  const color = rsiColor(token.rsi)
  const profit = token.change24h >= 0
  return (
    <div
      onClick={onClick}
      onMouseEnter={e => onHover(token, e)}
      onMouseLeave={() => onHover(null, null)}
      style={{
        width: 76, minHeight: 58, borderRadius: 7, cursor: 'pointer',
        background: `${color}12`,
        border: `1px solid ${color}28`,
        borderBottom: `3px solid ${color}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 1, padding: '6px 4px',
        transition: 'transform 0.1s, background 0.1s',
        userSelect: 'none',
      }}
      onMouseOver={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.06)'; (e.currentTarget as HTMLDivElement).style.background = `${color}22` }}
      onMouseOut={e  => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)';    (e.currentTarget as HTMLDivElement).style.background = `${color}12` }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, color: '#F0F3FF', letterSpacing: 0.3, fontFamily: "'JetBrains Mono',monospace" }}>
        {token.symbol}
      </span>
      <span style={{ fontSize: 14, fontWeight: 800, color, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.2 }}>
        {token.rsi.toFixed(1)}
      </span>
      <span style={{ fontSize: 9, fontWeight: 600, color: profit ? '#22C759' : '#FF3B30', fontFamily: "'JetBrains Mono',monospace" }}>
        {profit ? '+' : ''}{token.change24h.toFixed(1)}%
      </span>
    </div>
  )
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

function Tooltip({ token, pos }: { token: TokenRSI | null; pos: { x: number; y: number; rect: DOMRect | null } }) {
  const ref = useRef<HTMLDivElement>(null)
  if (!token || !pos.rect) return null
  const color = rsiColor(token.rsi)
  const zone  = getZone(token.rsi)
  return (
    <div ref={ref} style={{
      position: 'fixed', zIndex: 9999, pointerEvents: 'none',
      left: pos.x + 14, top: pos.y - 60,
      background: '#0D1117F2', border: `1px solid ${color}50`,
      borderRadius: 10, padding: '12px 14px', width: 210,
      backdropFilter: 'blur(16px)', boxShadow: `0 8px 32px rgba(0,0,0,0.6)`,
      fontFamily: "'JetBrains Mono',monospace",
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ color: '#F0F3FF', fontSize: 14, fontWeight: 700 }}>{token.symbol}</span>
        <span style={{ color, fontSize: 9, fontWeight: 700, padding: '2px 7px', background: `${color}20`, borderRadius: 4 }}>
          {ZONE_CFG[zone].label}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px', fontSize: 11 }}>
        {[
          ['RSI',    <span style={{ color, fontWeight: 700 }}>{token.rsi.toFixed(2)}</span>],
          ['24h',    <span style={{ color: token.change24h >= 0 ? '#22C759' : '#FF3B30', fontWeight: 700 }}>{token.change24h >= 0 ? '+' : ''}{token.change24h.toFixed(2)}%</span>],
          ['Prix',   <span style={{ color: '#8F94A3' }}>${token.price < 1 ? token.price.toFixed(6) : token.price < 100 ? token.price.toFixed(2) : token.price.toFixed(0)}</span>],
          ['Vol.',   <span style={{ color: '#8F94A3' }}>${(token.volume / 1e6).toFixed(1)}M</span>],
        ].map(([label, val], i) => (
          <>
            <span key={`l${i}`} style={{ color: '#555C70' }}>{label as string}</span>
            <span key={`v${i}`} style={{ textAlign: 'right' }}>{val as React.ReactNode}</span>
          </>
        ))}
      </div>
    </div>
  )
}

// ── Distribution Bar ─────────────────────────────────────────────────────────

function DistributionBar({ tokens }: { tokens: TokenRSI[] }) {
  const total = tokens.length || 1
  const segs = ZONE_ORDER.map(z => ({
    z, color: ZONE_CFG[z].color, label: ZONE_CFG[z].label,
    count: tokens.filter(t => getZone(t.rsi) === z).length,
  }))
  return (
    <div>
      <div style={{ display: 'flex', height: 6, borderRadius: 4, overflow: 'hidden', gap: 2, marginBottom: 6 }}>
        {segs.map(s => (
          <div key={s.z} title={`${s.label}: ${s.count}`}
            style={{ flex: s.count / total, background: s.color, minWidth: s.count ? 2 : 0, transition: 'flex 0.4s ease', borderRadius: 2 }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        {segs.map(s => (
          <span key={s.z} style={{ fontSize: 10, color: s.color, fontFamily: "'JetBrains Mono',monospace" }}>
            {s.count} <span style={{ color: 'var(--tm-text-muted)', fontWeight: 400, fontSize: 9 }}>{s.label}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Search Bar ───────────────────────────────────────────────────────────────

function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ position: 'relative' }}>
      <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--tm-text-muted)', pointerEvents: 'none' }}>🔍</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Chercher un token…"
        style={{
          width: '100%', boxSizing: 'border-box',
          background: 'var(--tm-bg-secondary)', border: '1px solid var(--tm-border-sub)',
          borderRadius: 7, padding: '6px 10px 6px 28px',
          color: 'var(--tm-text-primary)', fontSize: 12, outline: 'none',
          fontFamily: "'JetBrains Mono',monospace",
        }}
      />
      {value && (
        <button onClick={() => onChange('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tm-text-muted)', fontSize: 13, lineHeight: 1 }}>×</button>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ══════════════════════════════════════════════════════════════════════════════

export default function RsiHeatmap({ tokens: externalTokens, defaultTimeframe = '4h', onTimeframeChange, onTokenClick }: RsiHeatmapProps) {
  const [timeframe,  setTimeframe]  = useState<Timeframe>(defaultTimeframe)
  const [search,     setSearch]     = useState('')
  const [hovToken,   setHovToken]   = useState<TokenRSI | null>(null)
  const [hovPos,     setHovPos]     = useState<{ x: number; y: number; rect: DOMRect | null }>({ x: 0, y: 0, rect: null })
  const [collapsed,  setCollapsed]  = useState<Set<RsiZone>>(new Set())

  const tfSeed: Record<Timeframe, number> = { '5m': 1, '15m': 2, '1h': 3, '4h': 4, '1d': 5 }

  const allTokens = useMemo(() => {
    if (externalTokens && externalTokens.length > 0) return externalTokens
    return simulateData(tfSeed[timeframe])
  }, [externalTokens, timeframe])

  // Apply search filter, then group by zone sorted by RSI desc
  const grouped = useMemo(() => {
    const q = search.trim().toUpperCase()
    const tokens = q ? allTokens.filter(t => t.symbol.includes(q)) : allTokens
    const sorted = [...tokens].sort((a, b) => b.rsi - a.rsi)
    return ZONE_ORDER.reduce((acc, z) => {
      acc[z] = sorted.filter(t => getZone(t.rsi) === z)
      return acc
    }, {} as Record<RsiZone, TokenRSI[]>)
  }, [allTokens, search])

  const totalFiltered = useMemo(() => Object.values(grouped).reduce((s, g) => s + g.length, 0), [grouped])

  const handleHover = (token: TokenRSI | null, e: React.MouseEvent | null) => {
    setHovToken(token)
    if (e) setHovPos({ x: e.clientX, y: e.clientY, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })
  }

  const toggleCollapse = (z: RsiZone) => {
    setCollapsed(prev => { const s = new Set(prev); s.has(z) ? s.delete(z) : s.add(z); return s })
  }

  const timeframes: Timeframe[] = ['5m', '15m', '1h', '4h', '1d']

  const btnTf = (active: boolean): React.CSSProperties => ({
    padding: '4px 11px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
    fontFamily: "'JetBrains Mono',monospace",
    background: active ? 'var(--tm-bg-tertiary)' : 'transparent',
    color: active ? 'var(--tm-text-primary)' : 'var(--tm-text-muted)',
    transition: 'all 0.15s',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14 }}>🌡️</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-primary)' }}>Carte Thermique RSI</span>
          <span style={{
            fontSize: 10, color: 'var(--tm-text-muted)', background: 'var(--tm-bg-secondary)',
            padding: '2px 8px', borderRadius: 4, border: '1px solid var(--tm-border-sub)',
          }}>
            {totalFiltered} tokens
          </span>
        </div>
        <div style={{ display: 'flex', gap: 1, background: 'var(--tm-bg-secondary)', borderRadius: 7, padding: 2, border: '1px solid var(--tm-border-sub)' }}>
          {timeframes.map(tf => (
            <button key={tf} onClick={() => { setTimeframe(tf); onTimeframeChange?.(tf) }} style={btnTf(timeframe === tf)}>{tf.toUpperCase()}</button>
          ))}
        </div>
      </div>

      {/* Search */}
      <SearchBar value={search} onChange={setSearch} />

      {/* Zone sections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ZONE_ORDER.map(zone => {
          const cfg = ZONE_CFG[zone]
          const tokens = grouped[zone]
          const isCollapsed = collapsed.has(zone)
          return (
            <div key={zone} style={{
              background: cfg.bg,
              border: `1px solid ${cfg.color}22`,
              borderRadius: 10, overflow: 'hidden',
            }}>
              {/* Zone header */}
              <button
                onClick={() => toggleCollapse(zone)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer',
                  borderBottom: isCollapsed ? 'none' : `1px solid ${cfg.color}18`,
                }}
              >
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: cfg.color, boxShadow: `0 0 6px ${cfg.color}70`, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: cfg.color, fontFamily: "'JetBrains Mono',monospace" }}>
                  {cfg.label}
                </span>
                <span style={{ fontSize: 10, color: 'var(--tm-text-muted)', fontFamily: "'JetBrains Mono',monospace" }}>
                  RSI {cfg.range}
                </span>
                <span style={{
                  marginLeft: 4, fontSize: 10, fontWeight: 700, color: cfg.color,
                  background: `${cfg.color}18`, padding: '1px 7px', borderRadius: 10,
                }}>
                  {tokens.length}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--tm-text-muted)' }}>
                  {isCollapsed ? '▶' : '▼'}
                </span>
              </button>

              {/* Tiles grid */}
              {!isCollapsed && (
                <div style={{
                  padding: '10px 10px 12px',
                  display: 'flex', flexWrap: 'wrap', gap: 6,
                }}>
                  {tokens.length === 0 ? (
                    <span style={{ fontSize: 11, color: 'var(--tm-text-muted)', padding: '4px 2px', fontFamily: "'JetBrains Mono',monospace" }}>
                      Aucun token dans cette zone
                    </span>
                  ) : (
                    tokens.map(t => (
                      <TokenTile
                        key={t.symbol}
                        token={t}
                        onHover={handleHover}
                        onClick={() => onTokenClick?.(t.symbol)}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Distribution bar */}
      <DistributionBar tokens={allTokens} />

      {/* Footer */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 10, color: 'var(--tm-text-muted)', fontFamily: "'JetBrains Mono',monospace", opacity: 0.5,
      }}>
        <span>RSI {timeframe.toUpperCase()} · {externalTokens ? 'Données live' : 'Données simulées'}</span>
        <span>TradeMindset</span>
      </div>

      {/* Tooltip */}
      <Tooltip token={hovToken} pos={hovPos} />
    </div>
  )
}
