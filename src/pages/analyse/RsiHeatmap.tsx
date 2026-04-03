// src/pages/analyse/RsiHeatmap.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Carte Thermique RSI — Scatter plot interactif inspiré de Coinglass
// Compatible thèmes TradeMindset (CSS vars --tm-*)
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'

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
type FilterZone = 'all' | RsiZone

interface RsiHeatmapProps {
  tokens?: TokenRSI[]
  defaultTimeframe?: Timeframe
  onTimeframeChange?: (tf: Timeframe) => void
  onTokenClick?: (symbol: string) => void
}

// ── Resolve CSS var for canvas ───────────────────────────────────────────────

function resolveCSSColor(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback
}

// ── Zone config ──────────────────────────────────────────────────────────────

const ZONE_META: Record<RsiZone, { label: string; range: string }> = {
  overbought: { label: 'Suracheté',  range: '≥ 75' },
  strong:     { label: 'Fort',       range: '60–74' },
  neutral:    { label: 'Neutre',     range: '40–59' },
  weak:       { label: 'Faible',     range: '30–39' },
  oversold:   { label: 'Survendu',   range: '< 30' },
}

function getZone(rsi: number): RsiZone {
  if (rsi >= 75) return 'overbought'
  if (rsi >= 60) return 'strong'
  if (rsi >= 40) return 'neutral'
  if (rsi >= 30) return 'weak'
  return 'oversold'
}

function zoneColor(rsi: number): string {
  if (rsi >= 75) return '#ff3b5c'
  if (rsi >= 60) return '#ff6b8a'
  if (rsi >= 40) return '#6b7280'
  if (rsi >= 30) return '#4ecdc4'
  return '#00d4aa'
}

function zoneBg(zone: RsiZone): string {
  return {
    overbought: 'rgba(255,59,92,0.055)',
    strong: 'rgba(255,107,138,0.03)',
    neutral: 'transparent',
    weak: 'rgba(78,205,196,0.03)',
    oversold: 'rgba(0,212,170,0.055)',
  }[zone]
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
  'NEO','ONT','QTUM','ICX','ZEN','BTG','DASH','IOTA','NANO','WAVES','COTI',
  'HIVE','WAX','WIN','SUN','BTT','RSR','CKB','FLUX','MOVR','GLMR','APE','CAKE',
  'GMT','MINA','CSPR','POWR','MTL','FUN','ATA','DIA','SAFE','KAITO','BSV','MON',
  'INIT','KAIA','DEEP','HFT','TAIKO','GTC','FRAX','MBOX','COS','FLUID',
]

function simulateData(seed: number): TokenRSI[] {
  return SYMBOLS.map((symbol, i) => {
    const r = Math.abs(Math.sin(i * 1337.7 + seed * 7919.3))
    const r2 = Math.abs(Math.sin(i * 997.1 + seed * 3571.9))
    return {
      symbol,
      rsi: +(r * 82 + 8).toFixed(2),
      change24h: +((r2 - 0.5) * 28).toFixed(2),
      volume: r2 * 400_000_000 + 500_000,
      price: r * 60000 + 0.001,
    }
  })
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

function Tooltip({ token, x, y, bounds }: {
  token: TokenRSI | null; x: number; y: number; bounds: DOMRect | null
}) {
  if (!token || !bounds) return null
  const zone = getZone(token.rsi)
  const color = zoneColor(token.rsi)
  const profit = resolveCSSColor('--tm-profit', '#22C759')
  const loss = resolveCSSColor('--tm-loss', '#FF3B30')
  const w = 215, h = 160
  let left = x + 16, top = y - h / 2
  if (left + w > bounds.width) left = x - w - 16
  if (top < 4) top = 4
  if (top + h > bounds.height) top = bounds.height - h - 4

  return (
    <div style={{
      position: 'absolute', left, top, width: w, zIndex: 50, pointerEvents: 'none',
      background: resolveCSSColor('--tm-bg', '#0D1117') + 'F2',
      border: `1px solid ${color}40`, borderRadius: 10, padding: '13px 15px',
      backdropFilter: 'blur(14px)',
      boxShadow: `0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 ${color}10`,
      fontFamily: "'JetBrains Mono','Fira Code',monospace",
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
        <span style={{ color: resolveCSSColor('--tm-text-primary', '#F0F3FF'), fontSize: 15, fontWeight: 700, letterSpacing: 0.6 }}>{token.symbol}</span>
        <span style={{ color, fontSize: 10, fontWeight: 700, padding: '2px 8px', background: `${color}18`, borderRadius: 4 }}>
          {ZONE_META[zone].label}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 10px', fontSize: 11.5 }}>
        <span style={{ color: resolveCSSColor('--tm-text-muted', '#555C70') }}>RSI</span>
        <span style={{ color, fontWeight: 700, textAlign: 'right' }}>{token.rsi}</span>
        <span style={{ color: resolveCSSColor('--tm-text-muted', '#555C70') }}>24h</span>
        <span style={{ color: token.change24h >= 0 ? profit : loss, fontWeight: 700, textAlign: 'right' }}>
          {token.change24h >= 0 ? '+' : ''}{token.change24h}%
        </span>
        <span style={{ color: resolveCSSColor('--tm-text-muted', '#555C70') }}>Prix</span>
        <span style={{ color: resolveCSSColor('--tm-text-secondary', '#8F94A3'), fontWeight: 600, textAlign: 'right' }}>
          ${token.price < 1 ? token.price.toFixed(6) : token.price < 100 ? token.price.toFixed(2) : token.price.toFixed(0)}
        </span>
        <span style={{ color: resolveCSSColor('--tm-text-muted', '#555C70') }}>Vol.</span>
        <span style={{ color: resolveCSSColor('--tm-text-secondary', '#8F94A3'), fontWeight: 600, textAlign: 'right' }}>
          ${(token.volume / 1e6).toFixed(1)}M
        </span>
      </div>
    </div>
  )
}

// ── SVG Scatter Chart ────────────────────────────────────────────────────────

function ScatterChart({ tokens, hoveredToken, setHoveredToken, setMousePos, onTokenClick }: {
  tokens: TokenRSI[]
  hoveredToken: TokenRSI | null
  setHoveredToken: (t: TokenRSI | null) => void
  setMousePos: (p: { x: number; y: number }) => void
  onTokenClick?: (symbol: string) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const pad = { top: 18, right: 56, bottom: 26, left: 44 }
  const W = 1200, H = 560
  const iW = W - pad.left - pad.right, iH = H - pad.top - pad.bottom
  const rsiMin = 5, rsiMax = 95

  const yScale = (rsi: number) => pad.top + iH - ((rsi - rsiMin) / (rsiMax - rsiMin)) * iH
  const xScale = (i: number) => pad.left + (i / (tokens.length - 1 || 1)) * iW

  const avgRsi = tokens.length ? +(tokens.reduce((s, t) => s + t.rsi, 0) / tokens.length).toFixed(2) : 50

  const handleMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const sx = W / rect.width, sy = H / rect.height
    const mx = (e.clientX - rect.left) * sx
    const my = (e.clientY - rect.top) * sy
    let best: TokenRSI | null = null, bestD = 30
    tokens.forEach((t, i) => {
      const d = Math.hypot(mx - xScale(i), my - yScale(t.rsi))
      if (d < bestD) { bestD = d; best = t }
    })
    setHoveredToken(best)
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }, [tokens, setHoveredToken, setMousePos])

  const handleClick = useCallback(() => {
    if (hoveredToken && onTokenClick) onTokenClick(hoveredToken.symbol)
  }, [hoveredToken, onTokenClick])

  const zones: { yStart: number; yEnd: number; zone: RsiZone }[] = [
    { yStart: 75, yEnd: 95, zone: 'overbought' },
    { yStart: 60, yEnd: 75, zone: 'strong' },
    { yStart: 40, yEnd: 60, zone: 'neutral' },
    { yStart: 30, yEnd: 40, zone: 'weak' },
    { yStart: 5, yEnd: 30, zone: 'oversold' },
  ]

  const ticks = [10, 20, 30, 40, 50, 60, 70, 80, 90]

  // Decide which labels to show: always extremes + hovered, random ~30% for mid
  const showLabel = useCallback((t: TokenRSI, i: number) => {
    if (hoveredToken?.symbol === t.symbol) return true
    if (t.rsi >= 78 || t.rsi <= 25) return true
    // Stable pseudo-random based on symbol to avoid flickering
    const hash = t.symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
    return hash % 4 === 0
  }, [hoveredToken])

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: 'auto', display: 'block', cursor: 'crosshair' }}
      onMouseMove={handleMove}
      onMouseLeave={() => setHoveredToken(null)}
      onClick={handleClick}
    >
      {/* Zone backgrounds */}
      {zones.map(z => (
        <g key={z.zone}>
          <rect x={pad.left} y={yScale(z.yEnd)} width={iW} height={yScale(z.yStart) - yScale(z.yEnd)} fill={zoneBg(z.zone)} />
          <text x={W - 8} y={(yScale(z.yStart) + yScale(z.yEnd)) / 2 + 4}
            textAnchor="end" fontSize={10} fontWeight={600} fill={zoneColor(z.zone === 'neutral' ? 50 : z.zone === 'overbought' ? 80 : z.zone === 'strong' ? 65 : z.zone === 'weak' ? 35 : 20)} opacity={0.35}
            fontFamily="'JetBrains Mono',monospace">{ZONE_META[z.zone].label}</text>
        </g>
      ))}

      {/* Grid */}
      {ticks.map(t => (
        <g key={t}>
          <line x1={pad.left} x2={pad.left + iW} y1={yScale(t)} y2={yScale(t)}
            stroke={resolveCSSColor('--tm-border-sub', '#1E2330')} strokeWidth={1}
            strokeDasharray={t === 50 ? 'none' : '2,5'} />
          <text x={pad.left - 8} y={yScale(t) + 4} textAnchor="end" fontSize={10}
            fill={resolveCSSColor('--tm-text-muted', '#555C70')} fontFamily="'JetBrains Mono',monospace">{t}</text>
        </g>
      ))}

      {/* Average RSI */}
      <line x1={pad.left} x2={pad.left + iW} y1={yScale(avgRsi)} y2={yScale(avgRsi)}
        stroke={resolveCSSColor('--tm-warning', '#FF9500')} strokeWidth={1.5} strokeDasharray="6,4" opacity={0.55} />
      <rect x={pad.left + iW - 135} y={yScale(avgRsi) - 11} width={130} height={19} rx={4}
        fill="rgba(255,149,0,0.12)" />
      <text x={pad.left + iW - 70} y={yScale(avgRsi) + 3} textAnchor="middle" fontSize={10.5} fontWeight={700}
        fill={resolveCSSColor('--tm-warning', '#FF9500')} fontFamily="'JetBrains Mono',monospace">
        RSI Moy : {avgRsi}
      </text>

      {/* Decorative vertical dashes */}
      {[0.18, 0.36, 0.54, 0.72].map((p, i) => (
        <line key={i} x1={pad.left + p * iW} x2={pad.left + p * iW}
          y1={pad.top} y2={pad.top + iH}
          stroke="#ff3b5c" strokeWidth={0.4} strokeDasharray="3,7" opacity={0.15} />
      ))}

      {/* Token dots */}
      {tokens.map((t, i) => {
        const cx = xScale(i), cy = yScale(t.rsi)
        const c = zoneColor(t.rsi)
        const hovered = hoveredToken?.symbol === t.symbol
        return (
          <g key={t.symbol} style={{ cursor: 'pointer' }}>
            {hovered && <circle cx={cx} cy={cy} r={15} fill={`${c}18`} stroke={c} strokeWidth={1} opacity={0.5}>
              <animate attributeName="r" from="12" to="18" dur="0.8s" repeatCount="indefinite" />
              <animate attributeName="opacity" from="0.5" to="0" dur="0.8s" repeatCount="indefinite" />
            </circle>}
            <circle cx={cx} cy={cy} r={hovered ? 6.5 : 4} fill={c} opacity={hovered ? 1 : 0.75}
              style={{ transition: 'r 0.12s, opacity 0.12s' }} />
            {showLabel(t, i) && (
              <text x={cx} y={cy - (hovered ? 12 : 8)} textAnchor="middle"
                fontSize={hovered ? 11 : 8.5} fontWeight={hovered ? 700 : 500}
                fill={hovered ? resolveCSSColor('--tm-text-primary', '#F0F3FF') : resolveCSSColor('--tm-text-muted', '#555C70')}
                fontFamily="'JetBrains Mono',monospace" opacity={hovered ? 1 : 0.65}>
                {t.symbol}
              </text>
            )}
          </g>
        )
      })}

      {/* Axis borders */}
      <line x1={pad.left} x2={pad.left} y1={pad.top} y2={pad.top + iH}
        stroke={resolveCSSColor('--tm-border-sub', '#1E2330')} strokeWidth={1} />
      <line x1={pad.left} x2={pad.left + iW} y1={pad.top + iH} y2={pad.top + iH}
        stroke={resolveCSSColor('--tm-border-sub', '#1E2330')} strokeWidth={1} />
    </svg>
  )
}

// ── Distribution Bar ─────────────────────────────────────────────────────────

function DistributionBar({ tokens }: { tokens: TokenRSI[] }) {
  const total = tokens.length || 1
  const segments = [
    { zone: 'overbought' as RsiZone, color: '#ff3b5c', count: tokens.filter(t => t.rsi >= 75).length },
    { zone: 'strong' as RsiZone, color: '#ff6b8a', count: tokens.filter(t => t.rsi >= 60 && t.rsi < 75).length },
    { zone: 'neutral' as RsiZone, color: '#6b7280', count: tokens.filter(t => t.rsi >= 40 && t.rsi < 60).length },
    { zone: 'weak' as RsiZone, color: '#4ecdc4', count: tokens.filter(t => t.rsi >= 30 && t.rsi < 40).length },
    { zone: 'oversold' as RsiZone, color: '#00d4aa', count: tokens.filter(t => t.rsi < 30).length },
  ]
  return (
    <div style={{ padding: '0 2px' }}>
      <div style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', background: 'var(--tm-bg-secondary)' }}>
        {segments.map((s, i) => (
          <div key={i} style={{ width: `${(s.count / total) * 100}%`, background: s.color, transition: 'width 0.4s ease' }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        {segments.map((s, i) => (
          <span key={i} style={{ fontSize: 10, fontWeight: 600, color: s.color, fontFamily: "'JetBrains Mono',monospace" }}>
            {s.count} <span style={{ color: 'var(--tm-text-muted)', fontWeight: 400, fontSize: 9 }}>{ZONE_META[s.zone].label}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ══════════════════════════════════════════════════════════════════════════════

export default function RsiHeatmap({ tokens: externalTokens, defaultTimeframe = '4h', onTimeframeChange, onTokenClick }: RsiHeatmapProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>(defaultTimeframe)
  const [filter, setFilter] = useState<FilterZone>('all')
  const [hoveredToken, setHoveredToken] = useState<TokenRSI | null>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null)

  // Seed changes on timeframe to simulate different data per TF
  const tfSeed: Record<Timeframe, number> = { '5m': 1, '15m': 2, '1h': 3, '4h': 4, '1d': 5 }

  const allTokens = useMemo(() => {
    if (externalTokens && externalTokens.length > 0) return externalTokens
    return simulateData(tfSeed[timeframe])
  }, [externalTokens, timeframe])

  const filtered = useMemo(() => {
    if (filter === 'all') return allTokens
    return allTokens.filter(t => getZone(t.rsi) === filter)
  }, [allTokens, filter])

  const sorted = useMemo(() => [...filtered].sort((a, b) => b.rsi - a.rsi), [filtered])

  const handleTfChange = (tf: Timeframe) => {
    setTimeframe(tf)
    onTimeframeChange?.(tf)
  }

  useEffect(() => {
    const upd = () => {
      if (containerRef.current) setContainerRect(containerRef.current.getBoundingClientRect())
    }
    upd()
    window.addEventListener('resize', upd)
    return () => window.removeEventListener('resize', upd)
  }, [])

  const timeframes: Timeframe[] = ['5m', '15m', '1h', '4h', '1d']
  const filters: { value: FilterZone; label: string }[] = [
    { value: 'all', label: 'Tous' },
    { value: 'overbought', label: 'Suracheté' },
    { value: 'strong', label: 'Fort' },
    { value: 'neutral', label: 'Neutre' },
    { value: 'weak', label: 'Faible' },
    { value: 'oversold', label: 'Survendu' },
  ]

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
    fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono',monospace",
    background: active ? 'var(--tm-bg-tertiary)' : 'transparent',
    color: active ? 'var(--tm-text-primary)' : 'var(--tm-text-muted)',
    transition: 'all 0.15s',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Header + controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14 }}>🌡️</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-primary)' }}>Carte Thermique RSI</span>
          <span style={{
            fontSize: 10, color: 'var(--tm-text-muted)', background: 'var(--tm-bg-secondary)',
            padding: '2px 8px', borderRadius: 4, border: '1px solid var(--tm-border-sub)',
          }}>
            {sorted.length} tokens
          </span>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {/* Timeframe */}
          <div style={{ display: 'flex', gap: 1, background: 'var(--tm-bg-secondary)', borderRadius: 7, padding: 2, border: '1px solid var(--tm-border-sub)' }}>
            {timeframes.map(tf => (
              <button key={tf} onClick={() => handleTfChange(tf)} style={btnStyle(timeframe === tf)}>{tf.toUpperCase()}</button>
            ))}
          </div>
          {/* Filter */}
          <div style={{ display: 'flex', gap: 1, background: 'var(--tm-bg-secondary)', borderRadius: 7, padding: 2, border: '1px solid var(--tm-border-sub)' }}>
            {filters.map(f => (
              <button key={f.value} onClick={() => setFilter(f.value)} style={btnStyle(filter === f.value)}>{f.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {(['overbought', 'strong', 'neutral', 'weak', 'oversold'] as RsiZone[]).map(z => {
          const c = zoneColor(z === 'neutral' ? 50 : z === 'overbought' ? 80 : z === 'strong' ? 65 : z === 'weak' ? 35 : 20)
          return (
            <div key={z} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: c, boxShadow: `0 0 5px ${c}50` }} />
              <span style={{ color: 'var(--tm-text-muted)', fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace" }}>
                {ZONE_META[z].label} <span style={{ opacity: 0.5 }}>({ZONE_META[z].range})</span>
              </span>
            </div>
          )
        })}
      </div>

      {/* Chart */}
      <div ref={containerRef} style={{
        position: 'relative',
        background: 'var(--tm-bg)',
        border: '1px solid var(--tm-border-sub)',
        borderRadius: 10,
        overflow: 'hidden',
      }}>
        <ScatterChart
          tokens={sorted}
          hoveredToken={hoveredToken}
          setHoveredToken={setHoveredToken}
          setMousePos={setMousePos}
          onTokenClick={onTokenClick}
        />
        <Tooltip
          token={hoveredToken}
          x={mousePos.x}
          y={mousePos.y}
          bounds={containerRect}
        />
      </div>

      {/* Distribution */}
      <DistributionBar tokens={sorted} />

      {/* Footer */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 10, color: 'var(--tm-text-muted)', fontFamily: "'JetBrains Mono',monospace",
        opacity: 0.5,
      }}>
        <span>RSI {timeframe.toUpperCase()} · {externalTokens ? 'Données live' : 'Données simulées'}</span>
        <span>TradeMindset</span>
      </div>
    </div>
  )
}
