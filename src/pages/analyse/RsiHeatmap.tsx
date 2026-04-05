// src/pages/analyse/RsiHeatmap.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Carte Thermique RSI / VMC — grille de tuiles groupées par zone
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo, useRef } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

export interface TokenRSI {
  symbol: string
  rsi: number
  wt1: number        // WaveTrend WT1 (VMC Cipher A) — [-100, +100]
  change24h: number
  volume: number
  price: number
}

type RsiZone = 'overbought' | 'strong' | 'neutral' | 'weak' | 'oversold'
type VmcZone = 'vOverbought' | 'vBullish' | 'vNeutral' | 'vBearish' | 'vOversold'
type Timeframe = '5m' | '15m' | '1h' | '4h' | '1d'
type View = 'rsi' | 'vmc'

interface RsiHeatmapProps {
  tokens?: TokenRSI[]
  defaultTimeframe?: Timeframe
  onTimeframeChange?: (tf: Timeframe) => void
  onTokenClick?: (symbol: string) => void
}

// ── RSI zone config ──────────────────────────────────────────────────────────

const RSI_ZONES: Record<RsiZone, { label: string; range: string; color: string; bg: string }> = {
  overbought: { label: 'Suracheté',  range: '≥ 75', color: '#ff3b5c', bg: 'rgba(255,59,92,0.07)' },
  strong:     { label: 'Fort',       range: '60–74', color: '#ff8c69', bg: 'rgba(255,140,105,0.05)' },
  neutral:    { label: 'Neutre',     range: '40–59', color: '#6b7280', bg: 'rgba(107,114,128,0.04)' },
  weak:       { label: 'Faible',     range: '30–39', color: '#4ecdc4', bg: 'rgba(78,205,196,0.05)' },
  oversold:   { label: 'Survendu',   range: '< 30',  color: '#00d4aa', bg: 'rgba(0,212,170,0.07)' },
}
const RSI_ORDER: RsiZone[] = ['overbought', 'strong', 'neutral', 'weak', 'oversold']

function getRsiZone(rsi: number): RsiZone {
  if (rsi >= 75) return 'overbought'
  if (rsi >= 60) return 'strong'
  if (rsi >= 40) return 'neutral'
  if (rsi >= 30) return 'weak'
  return 'oversold'
}

// ── VMC zone config (WaveTrend WT1 thresholds) ───────────────────────────────

const VMC_ZONES: Record<VmcZone, { label: string; range: string; color: string; bg: string }> = {
  vOverbought: { label: 'Suracheté',  range: '≥ 53',    color: '#ff3b5c', bg: 'rgba(255,59,92,0.07)' },
  vBullish:    { label: 'Haussier',   range: '20–52',   color: '#ff8c69', bg: 'rgba(255,140,105,0.05)' },
  vNeutral:    { label: 'Neutre',     range: '-19 – 19', color: '#6b7280', bg: 'rgba(107,114,128,0.04)' },
  vBearish:    { label: 'Baissier',   range: '-52 – -20', color: '#4ecdc4', bg: 'rgba(78,205,196,0.05)' },
  vOversold:   { label: 'Survendu',   range: '≤ -53',   color: '#00d4aa', bg: 'rgba(0,212,170,0.07)' },
}
const VMC_ORDER: VmcZone[] = ['vOverbought', 'vBullish', 'vNeutral', 'vBearish', 'vOversold']

function getVmcZone(wt1: number): VmcZone {
  if (wt1 >= 53)  return 'vOverbought'
  if (wt1 >= 20)  return 'vBullish'
  if (wt1 >= -19) return 'vNeutral'
  if (wt1 >= -53) return 'vBearish'
  return 'vOversold'
}

// ── Simulated data ───────────────────────────────────────────────────────────

const SYMBOLS = [
  'BTC','ETH','SOL','BNB','XRP','ADA','DOGE','AVAX','DOT','MATIC','LINK','UNI',
  'ATOM','FIL','APT','ARB','OP','SUI','SEI','INJ','TIA','NEAR','FTM','ALGO',
  'AAVE','MKR','CRV','LDO','RUNE','SNX','COMP','SAND','MANA','AXS','IMX','GALA',
  'ENJ','FLOW','ICP','HBAR','VET','EOS','XLM','TRX','SHIB','PEPE','WIF','BONK',
  'FLOKI','MEME','STX','ORDI','KAS','TAO','RENDER','FET','AGIX','OCEAN','AR','GRT',
]

function simulateData(seed: number): TokenRSI[] {
  return SYMBOLS.map((symbol, i) => {
    const r  = Math.abs(Math.sin(i * 1337.7 + seed * 7919.3))
    const r2 = Math.abs(Math.sin(i * 997.1  + seed * 3571.9))
    const r3 = Math.abs(Math.sin(i * 421.3  + seed * 1129.7))
    return {
      symbol,
      rsi:      +(r  * 82 + 8).toFixed(2),
      wt1:      +((r3 - 0.5) * 140).toFixed(2),  // -70 to +70 range
      change24h: +((r2 - 0.5) * 28).toFixed(2),
      volume:   r2 * 400_000_000 + 500_000,
      price:    r  * 60000 + 0.001,
    }
  })
}

// ── Token Tile ───────────────────────────────────────────────────────────────

function TokenTile({ token, view, onHover, onClick }: {
  token: TokenRSI
  view: View
  onHover: (t: TokenRSI | null, e: React.MouseEvent | null) => void
  onClick: () => void
}) {
  const isRsi = view === 'rsi'
  const color = isRsi
    ? RSI_ZONES[getRsiZone(token.rsi)].color
    : VMC_ZONES[getVmcZone(token.wt1)].color
  const value = isRsi ? token.rsi.toFixed(1) : token.wt1.toFixed(1)
  const profit = token.change24h >= 0

  return (
    <div
      onClick={onClick}
      onMouseEnter={e => onHover(token, e)}
      onMouseLeave={() => onHover(null, null)}
      onMouseOver={e  => { const el = e.currentTarget as HTMLDivElement; el.style.transform = 'scale(1.06)'; el.style.background = `${color}22` }}
      onMouseOut={e   => { const el = e.currentTarget as HTMLDivElement; el.style.transform = 'scale(1)';    el.style.background = `${color}12` }}
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
    >
      <span style={{ fontSize: 11, fontWeight: 700, color: '#F0F3FF', letterSpacing: 0.3, fontFamily: "'JetBrains Mono',monospace" }}>
        {token.symbol}
      </span>
      <span style={{ fontSize: 14, fontWeight: 800, color, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.2 }}>
        {value}
      </span>
      <span style={{ fontSize: 9, fontWeight: 600, color: profit ? '#22C759' : '#FF3B30', fontFamily: "'JetBrains Mono',monospace" }}>
        {profit ? '+' : ''}{token.change24h.toFixed(1)}%
      </span>
    </div>
  )
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

function Tooltip({ token, pos }: { token: TokenRSI | null; pos: { x: number; y: number } }) {
  if (!token) return null
  const rsiColor = RSI_ZONES[getRsiZone(token.rsi)].color
  const vmcColor = VMC_ZONES[getVmcZone(token.wt1)].color
  return (
    <div style={{
      position: 'fixed', zIndex: 9999, pointerEvents: 'none',
      left: pos.x + 14, top: pos.y - 70,
      background: '#0D1117F2', border: `1px solid ${rsiColor}50`,
      borderRadius: 10, padding: '12px 14px', width: 220,
      backdropFilter: 'blur(16px)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      fontFamily: "'JetBrains Mono',monospace",
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ color: '#F0F3FF', fontSize: 14, fontWeight: 700 }}>{token.symbol}</span>
        <span style={{ fontSize: 9, color: '#8F94A3' }}>
          {token.price < 1 ? `$${token.price.toFixed(6)}` : token.price < 100 ? `$${token.price.toFixed(2)}` : `$${token.price.toFixed(0)}`}
        </span>
      </div>
      {/* RSI row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, padding: '4px 8px', background: `${rsiColor}12`, borderRadius: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: rsiColor, padding: '1px 5px', background: `${rsiColor}20`, borderRadius: 3 }}>RSI</span>
          <span style={{ fontSize: 9, color: '#8F94A3' }}>{RSI_ZONES[getRsiZone(token.rsi)].label}</span>
        </div>
        <span style={{ fontSize: 14, fontWeight: 800, color: rsiColor }}>{token.rsi.toFixed(1)}</span>
      </div>
      {/* VMC row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, padding: '4px 8px', background: `${vmcColor}12`, borderRadius: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: vmcColor, padding: '1px 5px', background: `${vmcColor}20`, borderRadius: 3 }}>VMC</span>
          <span style={{ fontSize: 9, color: '#8F94A3' }}>{VMC_ZONES[getVmcZone(token.wt1)].label}</span>
        </div>
        <span style={{ fontSize: 14, fontWeight: 800, color: vmcColor }}>{token.wt1.toFixed(1)}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 8px', fontSize: 11 }}>
        <span style={{ color: '#555C70' }}>24h</span>
        <span style={{ textAlign: 'right', color: token.change24h >= 0 ? '#22C759' : '#FF3B30', fontWeight: 700 }}>
          {token.change24h >= 0 ? '+' : ''}{token.change24h.toFixed(2)}%
        </span>
        <span style={{ color: '#555C70' }}>Vol.</span>
        <span style={{ textAlign: 'right', color: '#8F94A3' }}>${(token.volume / 1e6).toFixed(1)}M</span>
      </div>
    </div>
  )
}

// ── Distribution Bar ─────────────────────────────────────────────────────────

function DistributionBar({ tokens, view }: { tokens: TokenRSI[]; view: View }) {
  const total = tokens.length || 1
  const isRsi = view === 'rsi'
  const segs = isRsi
    ? RSI_ORDER.map(z => ({ color: RSI_ZONES[z].color, label: RSI_ZONES[z].label, count: tokens.filter(t => getRsiZone(t.rsi) === z).length }))
    : VMC_ORDER.map(z => ({ color: VMC_ZONES[z].color, label: VMC_ZONES[z].label, count: tokens.filter(t => getVmcZone(t.wt1) === z).length }))
  return (
    <div>
      <div style={{ display: 'flex', height: 6, borderRadius: 4, overflow: 'hidden', gap: 2, marginBottom: 6 }}>
        {segs.map((s, i) => (
          <div key={i} title={`${s.label}: ${s.count}`}
            style={{ flex: s.count / total, background: s.color, minWidth: s.count ? 2 : 0, transition: 'flex 0.4s ease', borderRadius: 2 }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        {segs.map((s, i) => (
          <span key={i} style={{ fontSize: 10, color: s.color, fontFamily: "'JetBrains Mono',monospace" }}>
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

// ── View Toggle ──────────────────────────────────────────────────────────────

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const btn = (v: View, label: string, color: string) => (
    <button onClick={() => onChange(v)} style={{
      padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
      fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono',monospace",
      background: view === v ? `${color}18` : 'transparent',
      color: view === v ? color : 'var(--tm-text-muted)',
      borderBottom: view === v ? `2px solid ${color}` : '2px solid transparent',
      transition: 'all 0.15s',
    }}>{label}</button>
  )
  return (
    <div style={{ display: 'flex', gap: 2, background: 'var(--tm-bg-secondary)', borderRadius: 7, padding: 2, border: '1px solid var(--tm-border-sub)' }}>
      {btn('rsi', '📊 RSI', '#ff8c69')}
      {btn('vmc', '〰️ VMC', '#4ecdc4')}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ══════════════════════════════════════════════════════════════════════════════

export default function RsiHeatmap({ tokens: externalTokens, defaultTimeframe = '4h', onTimeframeChange, onTokenClick }: RsiHeatmapProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>(defaultTimeframe)
  const [search,    setSearch]    = useState('')
  const [view,      setView]      = useState<View>('rsi')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [hovToken,  setHovToken]  = useState<TokenRSI | null>(null)
  const [hovPos,    setHovPos]    = useState({ x: 0, y: 0 })

  const tfSeed: Record<Timeframe, number> = { '5m': 1, '15m': 2, '1h': 3, '4h': 4, '1d': 5 }

  const allTokens = useMemo(() => {
    if (externalTokens && externalTokens.length > 0) return externalTokens
    return simulateData(tfSeed[timeframe])
  }, [externalTokens, timeframe])

  const grouped = useMemo(() => {
    const q = search.trim().toUpperCase()
    const tokens = q ? allTokens.filter(t => t.symbol.includes(q)) : allTokens

    if (view === 'rsi') {
      const sorted = [...tokens].sort((a, b) => b.rsi - a.rsi)
      return RSI_ORDER.reduce((acc, z) => {
        acc[z] = sorted.filter(t => getRsiZone(t.rsi) === z)
        return acc
      }, {} as Record<string, TokenRSI[]>)
    } else {
      const sorted = [...tokens].sort((a, b) => b.wt1 - a.wt1)
      return VMC_ORDER.reduce((acc, z) => {
        acc[z] = sorted.filter(t => getVmcZone(t.wt1) === z)
        return acc
      }, {} as Record<string, TokenRSI[]>)
    }
  }, [allTokens, search, view])

  const zoneOrder = view === 'rsi' ? RSI_ORDER : VMC_ORDER
  const zoneCfg = (z: string) => view === 'rsi'
    ? RSI_ZONES[z as RsiZone]
    : VMC_ZONES[z as VmcZone]

  const totalFiltered = useMemo(() => Object.values(grouped).reduce((s, g) => s + g.length, 0), [grouped])

  const handleHover = (token: TokenRSI | null, e: React.MouseEvent | null) => {
    setHovToken(token)
    if (e) setHovPos({ x: e.clientX, y: e.clientY })
  }

  const toggleCollapse = (z: string) => {
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
          <span style={{ fontSize: 14 }}>{view === 'rsi' ? '🌡️' : '〰️'}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-primary)' }}>
            {view === 'rsi' ? 'Heatmap RSI' : 'Heatmap VMC'}
          </span>
          <span style={{
            fontSize: 10, color: 'var(--tm-text-muted)', background: 'var(--tm-bg-secondary)',
            padding: '2px 8px', borderRadius: 4, border: '1px solid var(--tm-border-sub)',
          }}>
            {totalFiltered} tokens
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* View toggle */}
          <ViewToggle view={view} onChange={setView} />
          {/* Timeframe (only for RSI as real-time TF makes sense; VMC daily) */}
          <div style={{ display: 'flex', gap: 1, background: 'var(--tm-bg-secondary)', borderRadius: 7, padding: 2, border: '1px solid var(--tm-border-sub)' }}>
            {timeframes.map(tf => (
              <button key={tf} onClick={() => { setTimeframe(tf); onTimeframeChange?.(tf) }} style={btnTf(timeframe === tf)}>{tf.toUpperCase()}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Search */}
      <SearchBar value={search} onChange={setSearch} />

      {/* Zone sections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {zoneOrder.map(zone => {
          const cfg = zoneCfg(zone)
          const tokens = grouped[zone] ?? []
          const isCollapsed = collapsed.has(zone)
          const rangeLabel = view === 'rsi'
            ? RSI_ZONES[zone as RsiZone]?.range
            : VMC_ZONES[zone as VmcZone]?.range
          return (
            <div key={zone} style={{
              background: cfg.bg,
              border: `1px solid ${cfg.color}22`,
              borderRadius: 10, overflow: 'hidden',
            }}>
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
                  {view === 'rsi' ? 'RSI' : 'VMC'} {rangeLabel}
                </span>
                <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 700, color: cfg.color, background: `${cfg.color}18`, padding: '1px 7px', borderRadius: 10 }}>
                  {tokens.length}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--tm-text-muted)' }}>{isCollapsed ? '▶' : '▼'}</span>
              </button>

              {!isCollapsed && (
                <div style={{ padding: '10px 10px 12px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {tokens.length === 0 ? (
                    <span style={{ fontSize: 11, color: 'var(--tm-text-muted)', padding: '4px 2px', fontFamily: "'JetBrains Mono',monospace" }}>
                      Aucun token dans cette zone
                    </span>
                  ) : (
                    tokens.map(t => (
                      <TokenTile
                        key={t.symbol}
                        token={t}
                        view={view}
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
      <DistributionBar tokens={allTokens} view={view} />

      {/* Footer */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 10, color: 'var(--tm-text-muted)', fontFamily: "'JetBrains Mono',monospace", opacity: 0.5,
      }}>
        <span>{view.toUpperCase()} {timeframe.toUpperCase()} · {externalTokens ? 'Données live' : 'Données simulées'}</span>
        <span>TradeMindset</span>
      </div>

      <Tooltip token={hovToken} pos={hovPos} />
    </div>
  )
}
