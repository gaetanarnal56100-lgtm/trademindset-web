// src/pages/analytics/MultiAssetAnalytics.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Multi-Asset Institutional Analytics — Equities · Forex · Macro · Crypto
// Indicators: Relative Strength · MTF Returns · Rolling Sharpe · Volatility
// Regime · VaR · Drawdown · Trend Regime · Market Breadth · Sector Rotation
// Macro: DXY · US10Y · CPI · M2 | Forex: Currency Strength · Carry · Correlation
// Composite Scores: Macro Risk · Trend Strength (normalized 0–1)
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ── Types ─────────────────────────────────────────────────────────────────────

type AssetClass = 'all' | 'equities' | 'forex' | 'macro' | 'crypto'
type Section = 'performance' | 'risk' | 'structure' | 'macro' | 'forex' | 'scores'

interface AssetData {
  ticker: string
  name: string
  class: Exclude<AssetClass, 'all'>
  price: number
  change1D: number
  change1W: number
  change1M: number
  changeYTD: number
  vs_benchmark: number  // relative strength vs benchmark
  sharpe: number        // rolling 365d Sharpe
  atr: number           // ATR %
  volatilityRegime: 'low' | 'expansion' | 'panic'
  var95: number         // 95% VaR
  maxDrawdown: number   // max drawdown %
  recoveryDays: number | null
  ma50: number
  ma200: number
  trendRegime: 'strong_bull' | 'bull' | 'neutral' | 'bear' | 'strong_bear'
}

interface MacroData {
  dxy: number; dxyChange: number
  us10y: number; us10yChange: number
  cpi: number; cpiChange: number
  m2: number; m2Change: number
  macroRiskScore: number
}

interface ForexCurrency {
  code: string; flag: string; strength: number; rate: number; change: number; interestRate: number
}

interface SectorData {
  name: string; emoji: string; return1M: number; return1W: number; return1D: number; color: string
}

// ── Mock Data Generation ──────────────────────────────────────────────────────

function seed(s: number) {
  let x = Math.sin(s) * 10000
  return x - Math.floor(x)
}

function genAssets(): AssetData[] {
  const base: Array<Omit<AssetData, 'price'|'change1D'|'change1W'|'change1M'|'changeYTD'|'vs_benchmark'|'sharpe'|'atr'|'volatilityRegime'|'var95'|'maxDrawdown'|'recoveryDays'|'ma50'|'ma200'|'trendRegime'>> = [
    { ticker:'SPY',   name:'S&P 500 ETF',         class:'equities' },
    { ticker:'QQQ',   name:'Nasdaq 100 ETF',       class:'equities' },
    { ticker:'AAPL',  name:'Apple Inc.',           class:'equities' },
    { ticker:'NVDA',  name:'NVIDIA Corp.',         class:'equities' },
    { ticker:'MSFT',  name:'Microsoft Corp.',      class:'equities' },
    { ticker:'AMZN',  name:'Amazon.com Inc.',      class:'equities' },
    { ticker:'TSLA',  name:'Tesla Inc.',           class:'equities' },
    { ticker:'META',  name:'Meta Platforms',       class:'equities' },
    { ticker:'EUR/USD',name:'Euro / Dollar',       class:'forex' },
    { ticker:'GBP/USD',name:'Sterling / Dollar',  class:'forex' },
    { ticker:'USD/JPY',name:'Dollar / Yen',        class:'forex' },
    { ticker:'USD/CHF',name:'Dollar / Swiss Fr.', class:'forex' },
    { ticker:'AUD/USD',name:'Aussie / Dollar',    class:'forex' },
    { ticker:'NZD/USD',name:'Kiwi / Dollar',      class:'forex' },
    { ticker:'DXY',   name:'Dollar Index',         class:'macro' },
    { ticker:'US10Y', name:'US 10Y Treasury',      class:'macro' },
    { ticker:'GOLD',  name:'Gold Spot',            class:'macro' },
    { ticker:'OIL',   name:'Crude Oil WTI',        class:'macro' },
    { ticker:'BTC',   name:'Bitcoin',              class:'crypto' },
    { ticker:'ETH',   name:'Ethereum',             class:'crypto' },
  ]

  const regimes: AssetData['volatilityRegime'][] = ['low','expansion','panic']
  const trends: AssetData['trendRegime'][] = ['strong_bull','bull','neutral','bear','strong_bear']

  return base.map((b, i) => {
    const r = (offset = 0) => (seed(i * 17 + offset) * 2 - 1)
    const price = 50 + seed(i * 7) * 4000
    const change1D = r(1) * 3
    const change1W = r(2) * 8
    const change1M = r(3) * 20
    const changeYTD = r(4) * 45
    const sharpe = -0.5 + seed(i * 11) * 3.5
    const atr = 0.5 + seed(i * 13) * 4
    const var95 = atr * 1.65
    const maxDrawdown = -(5 + seed(i * 19) * 55)
    const ma50 = price * (1 + r(5) * 0.15)
    const ma200 = price * (1 + r(6) * 0.25)
    const trendIdx = Math.floor(seed(i * 23) * 5)
    const volIdx = Math.floor(seed(i * 29) * 3)
    const inRecovery = seed(i * 31) > 0.5
    return {
      ...b, price, change1D, change1W, change1M, changeYTD,
      vs_benchmark: r(7) * 25,
      sharpe, atr, volatilityRegime: regimes[volIdx],
      var95, maxDrawdown,
      recoveryDays: inRecovery ? Math.floor(seed(i * 37) * 180) : null,
      ma50, ma200, trendRegime: trends[trendIdx],
    }
  })
}

function genMacro(): MacroData {
  return {
    dxy: 103.4, dxyChange: -0.32,
    us10y: 4.28, us10yChange: 0.05,
    cpi: 3.2, cpiChange: -0.1,
    m2: 21.3, m2Change: 0.8,
    macroRiskScore: 0.62,
  }
}

function genCurrencies(): ForexCurrency[] {
  return [
    { code:'USD', flag:'🇺🇸', strength: 68, rate: 1,      change:  0.1, interestRate: 5.33 },
    { code:'EUR', flag:'🇪🇺', strength: 54, rate: 1.082,  change: -0.3, interestRate: 4.00 },
    { code:'GBP', flag:'🇬🇧', strength: 61, rate: 1.264,  change:  0.2, interestRate: 5.25 },
    { code:'JPY', flag:'🇯🇵', strength: 29, rate: 0.0066, change: -0.8, interestRate: 0.10 },
    { code:'CHF', flag:'🇨🇭', strength: 72, rate: 1.124,  change:  0.4, interestRate: 1.75 },
    { code:'AUD', flag:'🇦🇺', strength: 43, rate: 0.648,  change: -0.2, interestRate: 4.35 },
    { code:'NZD', flag:'🇳🇿', strength: 41, rate: 0.597,  change: -0.1, interestRate: 5.50 },
    { code:'CAD', flag:'🇨🇦', strength: 47, rate: 0.738,  change:  0.0, interestRate: 5.00 },
  ]
}

function genSectors(): SectorData[] {
  return [
    { name:'Technology',   emoji:'💻', return1M:  8.2, return1W:  2.1, return1D:  0.8, color:'#0A85FF' },
    { name:'Healthcare',   emoji:'🏥', return1M:  3.1, return1W:  0.4, return1D: -0.2, color:'#34C759' },
    { name:'Financials',   emoji:'🏦', return1M:  5.7, return1W:  1.2, return1D:  0.5, color:'#BF5AF2' },
    { name:'Energy',       emoji:'⚡', return1M: -2.3, return1W: -1.0, return1D: -0.6, color:'#FF9500' },
    { name:'Consumer Disc.',emoji:'🛍', return1M:  4.8, return1W:  0.9, return1D:  0.3, color:'#FF2D55' },
    { name:'Industrials',  emoji:'⚙️', return1M:  2.2, return1W:  0.3, return1D:  0.1, color:'#00E5FF' },
    { name:'Materials',    emoji:'⛏️', return1M: -1.1, return1W:  0.2, return1D: -0.3, color:'#FFD60A' },
    { name:'Real Estate',  emoji:'🏢', return1M: -3.8, return1W: -0.8, return1D: -0.4, color:'#FF6961' },
    { name:'Utilities',    emoji:'💡', return1M: -0.5, return1W:  0.1, return1D:  0.0, color:'#5AC8FA' },
    { name:'Comm. Services',emoji:'📡',return1M:  6.3, return1W:  1.5, return1D:  0.7, color:'#AF52DE' },
    { name:'Staples',      emoji:'🛒', return1M:  1.4, return1W:  0.2, return1D:  0.1, color:'#6C6C70' },
  ]
}

// ── Helper Components ─────────────────────────────────────────────────────────

function Pill({ value, suffix = '%' }: { value: number; suffix?: string }) {
  const pos = value >= 0
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 7px', borderRadius: 99, fontSize: 11, fontWeight: 700,
      background: pos ? 'rgba(52,199,89,0.12)' : 'rgba(255,59,48,0.12)',
      color: pos ? '#34C759' : '#FF3B30',
      border: `1px solid ${pos ? 'rgba(52,199,89,0.25)' : 'rgba(255,59,48,0.25)'}`,
    }}>
      {pos ? '▲' : '▼'} {Math.abs(value).toFixed(2)}{suffix}
    </span>
  )
}

function RegimeBadge({ regime }: { regime: AssetData['volatilityRegime'] }) {
  const cfg = {
    low:       { label: 'Low Vol',   color: '#34C759', bg: 'rgba(52,199,89,0.12)' },
    expansion: { label: 'Expansion', color: '#FF9500', bg: 'rgba(255,149,0,0.12)' },
    panic:     { label: 'PANIC',     color: '#FF3B30', bg: 'rgba(255,59,48,0.12)' },
  }[regime]
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 800, letterSpacing: '0.08em',
      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}40`,
    }}>{cfg.label}</span>
  )
}

function TrendBadge({ trend }: { trend: AssetData['trendRegime'] }) {
  const cfg = {
    strong_bull: { label: '⬆⬆ Strong Bull', color: '#34C759' },
    bull:        { label: '⬆ Bull',          color: '#30D158' },
    neutral:     { label: '→ Neutral',        color: '#8F94A3' },
    bear:        { label: '⬇ Bear',           color: '#FF9500' },
    strong_bear: { label: '⬇⬇ Strong Bear', color: '#FF3B30' },
  }[trend]
  return (
    <span style={{ color: cfg.color, fontSize: 11, fontWeight: 700 }}>{cfg.label}</span>
  )
}

function GaugeBar({ value, max = 1, color = '#00E5FF', label }: { value: number; max?: number; color?: string; label?: string }) {
  const pct = Math.min(100, (value / max) * 100)
  return (
    <div>
      {label && <div style={{ fontSize: 10, color: 'rgba(143,148,163,0.7)', marginBottom: 4 }}>{label}</div>}
      <div style={{ height: 6, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1, ease: 'easeOut' }}
          style={{ height: '100%', borderRadius: 99, background: color, boxShadow: `0 0 8px ${color}60` }}
        />
      </div>
    </div>
  )
}

function SectionHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h2 style={{ fontSize: 14, fontWeight: 800, color: '#F0F3FF', letterSpacing: '0.06em', textTransform: 'uppercase', margin: 0 }}>{title}</h2>
      <p style={{ fontSize: 11, color: 'rgba(143,148,163,0.6)', margin: '4px 0 0' }}>{sub}</p>
    </div>
  )
}

// ── Card wrapper ──────────────────────────────────────────────────────────────
function Card({ children, glow = '#00E5FF', style = {} }: { children: React.ReactNode; glow?: string; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'rgba(10,14,23,0.85)',
      border: `1px solid ${glow}20`,
      borderRadius: 16,
      padding: '18px 20px',
      backdropFilter: 'blur(12px)',
      position: 'relative',
      overflow: 'hidden',
      ...style,
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${glow}50, transparent)` }} />
      {children}
    </div>
  )
}

// ── Macro KPI Card ────────────────────────────────────────────────────────────
function MacroKPI({ label, value, change, suffix = '', icon, glow }: {
  label: string; value: string | number; change: number; suffix?: string; icon: string; glow: string
}) {
  return (
    <Card glow={glow}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.15em', textTransform: 'uppercase', color: `${glow}99` }}>{label}</span>
        <span style={{ fontSize: 18 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 900, fontFamily: 'JetBrains Mono, monospace', color: glow, marginTop: 8, textShadow: `0 0 20px ${glow}50` }}>
        {value}{suffix}
      </div>
      <div style={{ marginTop: 8 }}>
        <Pill value={change} suffix={suffix === '' ? '%' : suffix} />
      </div>
    </Card>
  )
}

// ── Score Gauge ───────────────────────────────────────────────────────────────
function ScoreGauge({ score, label, description, glow }: { score: number; label: string; description: string; glow: string }) {
  const pct = score * 100
  const angle = -140 + (score * 280)
  const risk = score > 0.7 ? 'HIGH' : score > 0.4 ? 'MODERATE' : 'LOW'
  const riskColor = score > 0.7 ? '#FF3B30' : score > 0.4 ? '#FF9500' : '#34C759'

  return (
    <Card glow={glow} style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.15em', textTransform: 'uppercase', color: `${glow}99`, marginBottom: 16 }}>{label}</div>
      
      {/* SVG Arc Gauge */}
      <div style={{ position: 'relative', width: 140, height: 90, margin: '0 auto' }}>
        <svg viewBox="0 0 140 90" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
          {/* Background arc */}
          <path d="M 15 85 A 55 55 0 0 1 125 85" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" strokeLinecap="round" />
          {/* Colored arc */}
          <path d="M 15 85 A 55 55 0 0 1 125 85" fill="none" stroke={glow} strokeWidth="10" strokeLinecap="round"
            strokeDasharray={`${pct * 1.72} 172`}
            style={{ filter: `drop-shadow(0 0 6px ${glow}80)` }}
          />
          {/* Needle */}
          <g transform={`translate(70,85) rotate(${angle})`}>
            <line x1="0" y1="0" x2="0" y2="-48" stroke={glow} strokeWidth="2" strokeLinecap="round" />
            <circle cx="0" cy="0" r="4" fill={glow} />
          </g>
          {/* Value */}
          <text x="70" y="78" textAnchor="middle" fontSize="20" fontWeight="900" fill={glow} fontFamily="JetBrains Mono, monospace">
            {Math.round(pct)}
          </text>
        </svg>
      </div>

      <div style={{ marginTop: 8 }}>
        <span style={{
          fontSize: 11, fontWeight: 800, letterSpacing: '0.1em',
          padding: '3px 12px', borderRadius: 99,
          background: `${riskColor}18`, color: riskColor,
          border: `1px solid ${riskColor}40`,
        }}>{risk} RISK</span>
      </div>
      <div style={{ fontSize: 10, color: 'rgba(143,148,163,0.6)', marginTop: 10, lineHeight: 1.5 }}>{description}</div>
    </Card>
  )
}

// ── Correlation Matrix ────────────────────────────────────────────────────────
function CorrelationMatrix({ assets }: { assets: string[] }) {
  const correlations = useMemo(() => {
    const matrix: number[][] = []
    for (let i = 0; i < assets.length; i++) {
      matrix[i] = []
      for (let j = 0; j < assets.length; j++) {
        if (i === j) { matrix[i][j] = 1; continue }
        const s = seed(i * 37 + j * 13 + 7)
        matrix[i][j] = parseFloat((s * 2 - 1).toFixed(2))
      }
    }
    return matrix
  }, [assets.join(',')])

  function corrColor(v: number) {
    if (v >= 0.7)  return { bg: 'rgba(52,199,89,0.7)',  color: '#fff' }
    if (v >= 0.3)  return { bg: 'rgba(52,199,89,0.3)',  color: '#34C759' }
    if (v >= -0.3) return { bg: 'rgba(143,148,163,0.1)', color: '#8F94A3' }
    if (v >= -0.7) return { bg: 'rgba(255,59,48,0.3)',  color: '#FF3B30' }
    return           { bg: 'rgba(255,59,48,0.7)',  color: '#fff' }
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 10, width: '100%' }}>
        <thead>
          <tr>
            <th style={{ width: 60 }} />
            {assets.map(a => (
              <th key={a} style={{ color: '#8F94A3', fontWeight: 700, padding: '4px 6px', textAlign: 'center', whiteSpace: 'nowrap' }}>{a}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {assets.map((rowAsset, i) => (
            <tr key={rowAsset}>
              <td style={{ color: '#8F94A3', fontWeight: 700, padding: '4px 6px', whiteSpace: 'nowrap' }}>{rowAsset}</td>
              {correlations[i].map((v, j) => {
                const { bg, color } = corrColor(v)
                return (
                  <td key={j} style={{ padding: 3, textAlign: 'center' }}>
                    <div style={{
                      background: bg, color, borderRadius: 6, padding: '4px 6px',
                      fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
                    }}>
                      {i === j ? '—' : v.toFixed(2)}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Carry Trade Table ─────────────────────────────────────────────────────────
function CarryTable({ currencies }: { currencies: ForexCurrency[] }) {
  const sorted = [...currencies].sort((a, b) => b.interestRate - a.interestRate)
  const pairs = []
  for (let i = 0; i < 2; i++) {
    for (let j = sorted.length - 1; j >= sorted.length - 3; j--) {
      const diff = sorted[i].interestRate - sorted[j].interestRate
      pairs.push({ long: sorted[i], short: sorted[j], diff })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {pairs.slice(0, 5).map((p, idx) => (
        <div key={idx} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderRadius: 10,
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14 }}>{p.long.flag}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#34C759' }}>LONG {p.long.code}</span>
            <span style={{ color: 'rgba(143,148,163,0.4)', fontSize: 10 }}>vs</span>
            <span style={{ fontSize: 14 }}>{p.short.flag}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#FF3B30' }}>SHORT {p.short.code}</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', color: '#00E5FF' }}>
              +{p.diff.toFixed(2)}%
            </div>
            <div style={{ fontSize: 9, color: 'rgba(143,148,163,0.5)' }}>rate differential</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Breadth Indicator ─────────────────────────────────────────────────────────
function MarketBreadth() {
  const aboveMA200 = 67
  const advDecline = 2.3
  return (
    <Card glow='#0A85FF'>
      <SectionHeader title='Market Breadth' sub='% stocks above MA200 · Advance / Decline ratio' />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div style={{ fontSize: 10, color: 'rgba(143,148,163,0.6)', marginBottom: 6 }}>% Above MA200</div>
          <div style={{ fontSize: 32, fontWeight: 900, fontFamily: 'JetBrains Mono, monospace', color: '#0A85FF' }}>{aboveMA200}%</div>
          <GaugeBar value={aboveMA200} max={100} color='#0A85FF' />
          <div style={{ fontSize: 10, color: 'rgba(143,148,163,0.5)', marginTop: 6 }}>
            {aboveMA200 > 70 ? '🟢 Bullish breadth' : aboveMA200 > 50 ? '🟡 Moderate' : '🔴 Weak breadth'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'rgba(143,148,163,0.6)', marginBottom: 6 }}>Advance / Decline</div>
          <div style={{ fontSize: 32, fontWeight: 900, fontFamily: 'JetBrains Mono, monospace', color: '#34C759' }}>{advDecline}x</div>
          <GaugeBar value={advDecline} max={5} color='#34C759' />
          <div style={{ fontSize: 10, color: 'rgba(143,148,163,0.5)', marginTop: 6 }}>
            {advDecline > 2 ? '🟢 Advancing' : advDecline > 1 ? '🟡 Mixed' : '🔴 Declining'}
          </div>
        </div>
      </div>
    </Card>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const TAB_CONFIG: Array<{ id: AssetClass; label: string; icon: string; color: string }> = [
  { id:'all',      label:'All Assets',  icon:'🌐', color:'#00E5FF' },
  { id:'equities', label:'Equities',    icon:'📈', color:'#34C759' },
  { id:'forex',    label:'Forex',       icon:'💱', color:'#BF5AF2' },
  { id:'macro',    label:'Macro',       icon:'🏛️', color:'#FF9500' },
  { id:'crypto',   label:'Crypto',      icon:'₿',  color:'#0A85FF' },
]

const SECTION_CONFIG: Array<{ id: Section; label: string; icon: string }> = [
  { id:'performance', label:'Performance',     icon:'📊' },
  { id:'risk',        label:'Risk',            icon:'⚠️' },
  { id:'structure',   label:'Market Structure',icon:'🏗️' },
  { id:'macro',       label:'Macro',           icon:'🏛️' },
  { id:'forex',       label:'Forex',           icon:'💱' },
  { id:'scores',      label:'Composite Scores',icon:'🎯' },
]

export default function MultiAssetAnalytics() {
  const [activeClass, setActiveClass] = useState<AssetClass>('all')
  const [activeSection, setActiveSection] = useState<Section>('performance')
  const [sortField, setSortField] = useState<'ticker'|'change1D'|'changeYTD'|'sharpe'|'var95'|'maxDrawdown'>('changeYTD')
  const [sortDir, setSortDir] = useState<1|-1>(-1)
  const [selectedAsset, setSelectedAsset] = useState<AssetData | null>(null)
  const [sectorTimeframe, setSectorTimeframe] = useState<'1D'|'1W'|'1M'>('1M')
  const [loaded, setLoaded] = useState(false)

  const ASSETS = useMemo(() => genAssets(), [])
  const MACRO = useMemo(() => genMacro(), [])
  const CURRENCIES = useMemo(() => genCurrencies(), [])
  const SECTORS = useMemo(() => genSectors(), [])

  useEffect(() => { setTimeout(() => setLoaded(true), 100) }, [])

  const filtered = useMemo(() => {
    let assets = ASSETS
    if (activeClass !== 'all') assets = assets.filter(a => a.class === activeClass)
    return [...assets].sort((a, b) => {
      const av = a[sortField] as number
      const bv = b[sortField] as number
      return (bv - av) * sortDir
    })
  }, [ASSETS, activeClass, sortField, sortDir])

  const trendStrengthScore = useMemo(() => {
    const bullCount = filtered.filter(a => a.trendRegime === 'bull' || a.trendRegime === 'strong_bull').length
    return filtered.length ? bullCount / filtered.length : 0.5
  }, [filtered])

  function toggleSort(field: typeof sortField) {
    if (sortField === field) setSortDir(d => d === 1 ? -1 : 1)
    else { setSortField(field); setSortDir(-1) }
  }

  const sectorReturnKey = sectorTimeframe === '1D' ? 'return1D' : sectorTimeframe === '1W' ? 'return1W' : 'return1M'
  const sortedSectors = [...SECTORS].sort((a, b) => b[sectorReturnKey] - a[sectorReturnKey])

  const corrAssets = ['EUR/USD','GBP/USD','USD/JPY','DXY','GOLD','SPY','BTC','US10Y']

  const activeTabConfig = TAB_CONFIG.find(t => t.id === activeClass)!

  // Sections to show based on asset class
  const visibleSections: Section[] = useMemo(() => {
    if (activeClass === 'forex') return ['performance','risk','forex','scores']
    if (activeClass === 'macro') return ['performance','macro','scores']
    if (activeClass === 'crypto') return ['performance','risk','structure','scores']
    return ['performance','risk','structure','macro','forex','scores']
  }, [activeClass])

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto', minHeight: '100vh' }}
    >
      {/* ── Page Header ── */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
          }}>🌐</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: '#F0F3FF', fontFamily: 'Syne, sans-serif' }}>
              Multi-Asset Analytics
            </h1>
            <p style={{ margin: 0, fontSize: 11, color: 'rgba(143,148,163,0.6)' }}>
              Institutional-grade indicators — Equities · Forex · Macro · Crypto
            </p>
          </div>
        </div>

        {/* Live indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#34C759', boxShadow: '0 0 8px rgba(52,199,89,0.8)', animation: 'pulse 2s infinite' }} />
          <span style={{ fontSize: 10, color: '#34C759', fontWeight: 700, letterSpacing: '0.1em' }}>LIVE DATA</span>
          <span style={{ fontSize: 10, color: 'rgba(143,148,163,0.4)' }}>· Simulated for demo</span>
        </div>
      </div>

      {/* ── Asset Class Tabs ── */}
      <div style={{
        display: 'flex', gap: 6, marginBottom: 24, overflowX: 'auto', paddingBottom: 4,
        scrollbarWidth: 'none',
      }}>
        {TAB_CONFIG.map(tab => {
          const active = activeClass === tab.id
          return (
            <button key={tab.id} onClick={() => setActiveClass(tab.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 16px', borderRadius: 10, border: 'none', cursor: 'pointer',
                fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', transition: 'all 0.2s',
                background: active ? `rgba(${tab.color === '#00E5FF' ? '0,229,255' : tab.color === '#34C759' ? '52,199,89' : tab.color === '#BF5AF2' ? '191,90,242' : tab.color === '#FF9500' ? '255,149,0' : '10,133,255'},0.15)` : 'rgba(255,255,255,0.04)',
                color: active ? tab.color : 'rgba(143,148,163,0.7)',
                border: `1px solid ${active ? `${tab.color}50` : 'rgba(255,255,255,0.06)'}`,
                boxShadow: active ? `0 0 16px ${tab.color}20` : 'none',
              }}
            >
              <span>{tab.icon}</span> {tab.label}
            </button>
          )
        })}
      </div>

      {/* ── Section Nav ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 28, overflowX: 'auto', scrollbarWidth: 'none' }}>
        {SECTION_CONFIG.filter(s => visibleSections.includes(s.id)).map(sec => {
          const active = activeSection === sec.id
          return (
            <button key={sec.id} onClick={() => setActiveSection(sec.id)}
              style={{
                padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', transition: 'all 0.15s',
                background: active ? 'rgba(0,229,255,0.12)' : 'transparent',
                color: active ? '#00E5FF' : 'rgba(143,148,163,0.5)',
                borderBottom: active ? '2px solid #00E5FF' : '2px solid transparent',
              }}
            >
              {sec.icon} {sec.label}
            </button>
          )
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={activeSection + activeClass}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
        >

          {/* ══════════════════════════════════════════════════════════════════
           *  PERFORMANCE SECTION
           * ══════════════════════════════════════════════════════════════════ */}
          {activeSection === 'performance' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <SectionHeader title='Performance Analysis' sub='Relative strength · Multi-timeframe returns · Rolling Sharpe ratio' />

              {/* Relative Strength Strip */}
              <Card glow='#34C759'>
                <div style={{ marginBottom: 14 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: 'rgba(52,199,89,0.8)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    Relative Strength vs Benchmark
                  </span>
                  <span style={{ marginLeft: 8, fontSize: 10, color: 'rgba(143,148,163,0.5)' }}>
                    {activeClass === 'equities' ? 'vs S&P 500' : activeClass === 'forex' ? 'vs DXY' : activeClass === 'crypto' ? 'vs BTC' : 'vs S&P 500 / DXY'}
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {filtered.slice(0, 12).map(a => (
                    <div key={a.ticker} style={{
                      padding: '8px 12px', borderRadius: 10,
                      background: a.vs_benchmark >= 0 ? 'rgba(52,199,89,0.08)' : 'rgba(255,59,48,0.08)',
                      border: `1px solid ${a.vs_benchmark >= 0 ? 'rgba(52,199,89,0.2)' : 'rgba(255,59,48,0.2)'}`,
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                    onClick={() => setSelectedAsset(a)}
                    >
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#F0F3FF' }}>{a.ticker}</div>
                      <div style={{ fontSize: 12, fontWeight: 900, fontFamily: 'JetBrains Mono, monospace', color: a.vs_benchmark >= 0 ? '#34C759' : '#FF3B30', marginTop: 2 }}>
                        {a.vs_benchmark >= 0 ? '+' : ''}{a.vs_benchmark.toFixed(1)}%
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* MTF Returns Table */}
              <Card glow='#0A85FF'>
                <div style={{ marginBottom: 14 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: 'rgba(10,133,255,0.8)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    Multi-Timeframe Returns
                  </span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>
                        {['Asset','Price','1D','1W','1M','YTD','Sharpe'].map(h => (
                          <th key={h} style={{
                            padding: '6px 10px', textAlign: h === 'Asset' ? 'left' : 'right',
                            color: 'rgba(143,148,163,0.5)', fontSize: 10, fontWeight: 700,
                            letterSpacing: '0.08em', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)',
                            cursor: h !== 'Asset' && h !== 'Price' ? 'pointer' : 'default',
                            userSelect: 'none',
                          }}
                          onClick={() => {
                            if (h === '1D') toggleSort('change1D')
                            if (h === 'YTD') toggleSort('changeYTD')
                            if (h === 'Sharpe') toggleSort('sharpe')
                          }}
                          >
                            {h} {h === '1D' && sortField === 'change1D' ? (sortDir === -1 ? '↓' : '↑') : ''}
                            {h === 'YTD' && sortField === 'changeYTD' ? (sortDir === -1 ? '↓' : '↑') : ''}
                            {h === 'Sharpe' && sortField === 'sharpe' ? (sortDir === -1 ? '↓' : '↑') : ''}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((a, i) => (
                        <motion.tr key={a.ticker}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.02 }}
                          onClick={() => setSelectedAsset(a)}
                          style={{ cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.025)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <td style={{ padding: '8px 10px' }}>
                            <div style={{ fontWeight: 700, color: '#F0F3FF', fontSize: 12 }}>{a.ticker}</div>
                            <div style={{ fontSize: 9, color: 'rgba(143,148,163,0.5)' }}>{a.name}</div>
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#F0F3FF' }}>
                            {a.price < 10 ? a.price.toFixed(4) : a.price.toFixed(2)}
                          </td>
                          {[a.change1D, a.change1W, a.change1M, a.changeYTD].map((v, idx) => (
                            <td key={idx} style={{ padding: '8px 10px', textAlign: 'right' }}>
                              <Pill value={v} />
                            </td>
                          ))}
                          <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                            <span style={{
                              fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700,
                              color: a.sharpe > 1 ? '#34C759' : a.sharpe > 0 ? '#FF9500' : '#FF3B30',
                            }}>
                              {a.sharpe.toFixed(2)}
                            </span>
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
           *  RISK SECTION
           * ══════════════════════════════════════════════════════════════════ */}
          {activeSection === 'risk' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <SectionHeader title='Risk Analysis' sub='Volatility regime · Value at Risk · Drawdown analysis' />

              {/* Volatility Regime Grid */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,149,0,0.8)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
                  Volatility Regime (ATR-based)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                  {filtered.map(a => (
                    <div key={a.ticker} style={{
                      padding: '12px 14px', borderRadius: 12,
                      background: 'rgba(10,14,23,0.8)', border: '1px solid rgba(255,255,255,0.07)',
                      display: 'flex', flexDirection: 'column', gap: 8, cursor: 'pointer',
                    }}
                    onClick={() => setSelectedAsset(a)}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 800, fontSize: 12, color: '#F0F3FF' }}>{a.ticker}</span>
                        <RegimeBadge regime={a.volatilityRegime} />
                      </div>
                      <div style={{ display: 'flex', gap: 12 }}>
                        <div>
                          <div style={{ fontSize: 9, color: 'rgba(143,148,163,0.5)' }}>ATR%</div>
                          <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: '#FF9500' }}>{a.atr.toFixed(2)}%</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 9, color: 'rgba(143,148,163,0.5)' }}>VaR 95%</div>
                          <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: '#FF3B30' }}>{a.var95.toFixed(2)}%</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Drawdown Analysis */}
              <Card glow='#FF3B30'>
                <div style={{ marginBottom: 14 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,59,48,0.8)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    Drawdown Analysis
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {filtered.sort((a,b) => a.maxDrawdown - b.maxDrawdown).slice(0, 10).map(a => (
                    <div key={a.ticker} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 70, fontSize: 11, fontWeight: 700, color: '#F0F3FF', flexShrink: 0 }}>{a.ticker}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ height: 6, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.abs(a.maxDrawdown)}%` }}
                            transition={{ duration: 0.8, ease: 'easeOut' }}
                            style={{ height: '100%', borderRadius: 99, background: `linear-gradient(90deg, #FF3B30, #FF9500)` }}
                          />
                        </div>
                      </div>
                      <div style={{ width: 60, textAlign: 'right', fontSize: 12, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: '#FF3B30' }}>
                        {a.maxDrawdown.toFixed(1)}%
                      </div>
                      <div style={{ width: 80, textAlign: 'right', fontSize: 10, color: 'rgba(143,148,163,0.5)' }}>
                        {a.recoveryDays != null ? `${a.recoveryDays}d recovery` : 'In drawdown'}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* VaR Summary */}
              <Card glow='#BF5AF2'>
                <div style={{ marginBottom: 14 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: 'rgba(191,90,242,0.8)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    Value at Risk (95% confidence, 1 day)
                  </span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>
                        {['Asset','VaR 95%','VaR 99%','Vol Regime','ATR'].map(h => (
                          <th key={h} style={{ padding: '6px 10px', textAlign: h === 'Asset' ? 'left' : 'right', color: 'rgba(143,148,163,0.5)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.sort((a,b) => b.var95 - a.var95).map(a => (
                        <tr key={a.ticker} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ padding: '8px 10px', fontWeight: 700, color: '#F0F3FF' }}>{a.ticker}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono', color: '#FF3B30', fontWeight: 700 }}>{a.var95.toFixed(2)}%</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono', color: '#FF3B30', fontWeight: 700 }}>{(a.var95 * 1.38).toFixed(2)}%</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right' }}><RegimeBadge regime={a.volatilityRegime} /></td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono', color: '#FF9500', fontSize: 11 }}>{a.atr.toFixed(2)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
           *  MARKET STRUCTURE SECTION
           * ══════════════════════════════════════════════════════════════════ */}
          {activeSection === 'structure' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <SectionHeader title='Market Structure' sub='Trend regime · MA50/MA200 alignment · Market breadth · Sector rotation' />

              {/* Trend Regime Table */}
              <Card glow='#00E5FF'>
                <div style={{ marginBottom: 14 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: 'rgba(0,229,255,0.8)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    Trend Regime — MA50 / MA200 Alignment
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                  {filtered.map(a => {
                    const bullish = a.ma50 > a.ma200
                    const spread = ((a.ma50 - a.ma200) / a.ma200 * 100)
                    return (
                      <div key={a.ticker} style={{
                        padding: '12px 14px', borderRadius: 12,
                        background: 'rgba(10,14,23,0.8)', border: '1px solid rgba(255,255,255,0.07)',
                        cursor: 'pointer',
                      }}
                      onClick={() => setSelectedAsset(a)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ fontWeight: 800, fontSize: 12, color: '#F0F3FF' }}>{a.ticker}</span>
                          <TrendBadge trend={a.trendRegime} />
                        </div>
                        <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                          <div>
                            <div style={{ fontSize: 9, color: 'rgba(143,148,163,0.5)' }}>MA50</div>
                            <div style={{ fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono', color: '#0A85FF' }}>{a.ma50.toFixed(2)}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 9, color: 'rgba(143,148,163,0.5)' }}>MA200</div>
                            <div style={{ fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono', color: '#BF5AF2' }}>{a.ma200.toFixed(2)}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 9, color: 'rgba(143,148,163,0.5)' }}>Spread</div>
                            <div style={{ fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono', color: bullish ? '#34C759' : '#FF3B30' }}>
                              {spread >= 0 ? '+' : ''}{spread.toFixed(1)}%
                            </div>
                          </div>
                        </div>
                        {/* MA alignment visual */}
                        <div style={{ position: 'relative', height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.06)' }}>
                          <div style={{
                            position: 'absolute', height: '100%', borderRadius: 99,
                            background: bullish ? 'linear-gradient(90deg, #0A85FF, #34C759)' : 'linear-gradient(90deg, #BF5AF2, #FF3B30)',
                            width: `${Math.min(100, 50 + Math.abs(spread) * 2)}%`,
                          }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Card>

              {/* Market Breadth (equities only or all) */}
              {(activeClass === 'equities' || activeClass === 'all') && <MarketBreadth />}

              {/* Sector Rotation */}
              {(activeClass === 'equities' || activeClass === 'all') && (
                <Card glow='#FF9500'>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,149,0,0.8)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                      Sector Rotation
                    </span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {(['1D','1W','1M'] as const).map(tf => (
                        <button key={tf} onClick={() => setSectorTimeframe(tf)}
                          style={{
                            padding: '3px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                            fontSize: 10, fontWeight: 700,
                            background: sectorTimeframe === tf ? 'rgba(255,149,0,0.15)' : 'transparent',
                            color: sectorTimeframe === tf ? '#FF9500' : 'rgba(143,148,163,0.5)',
                            border: `1px solid ${sectorTimeframe === tf ? 'rgba(255,149,0,0.3)' : 'transparent'}`,
                          }}
                        >{tf}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {sortedSectors.map((s, i) => {
                      const val = s[sectorReturnKey]
                      const maxAbs = Math.max(...SECTORS.map(s => Math.abs(s[sectorReturnKey])))
                      return (
                        <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 20, fontSize: 14 }}>{s.emoji}</div>
                          <div style={{ width: 130, fontSize: 11, fontWeight: 600, color: '#F0F3FF', flexShrink: 0 }}>{s.name}</div>
                          <div style={{ flex: 1, position: 'relative', height: 6, borderRadius: 99, background: 'rgba(255,255,255,0.06)' }}>
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${(Math.abs(val) / maxAbs) * 100}%` }}
                              transition={{ duration: 0.6, delay: i * 0.03 }}
                              style={{
                                height: '100%', borderRadius: 99,
                                background: val >= 0 ? `linear-gradient(90deg, rgba(52,199,89,0.6), #34C759)` : `linear-gradient(90deg, rgba(255,59,48,0.6), #FF3B30)`,
                              }}
                            />
                          </div>
                          <div style={{ width: 60, textAlign: 'right' }}>
                            <Pill value={val} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
           *  MACRO SECTION
           * ══════════════════════════════════════════════════════════════════ */}
          {activeSection === 'macro' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <SectionHeader title='Macro Environment' sub='DXY · US 10Y yield · CPI inflation · M2 liquidity' />

              {/* Macro KPIs */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
                <MacroKPI label='Dollar Index (DXY)' value={MACRO.dxy.toFixed(2)} change={MACRO.dxyChange} icon='💵' glow='#00E5FF' />
                <MacroKPI label='US 10Y Yield' value={MACRO.us10y.toFixed(2)} change={MACRO.us10yChange} suffix='%' icon='📊' glow='#FF9500' />
                <MacroKPI label='CPI Inflation (YoY)' value={MACRO.cpi.toFixed(1)} change={MACRO.cpiChange} suffix='%' icon='📈' glow='#FF3B30' />
                <MacroKPI label='M2 Money Supply' value={`$${MACRO.m2.toFixed(1)}T`} change={MACRO.m2Change} icon='🏦' glow='#BF5AF2' />
              </div>

              {/* Macro Dashboard Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {/* DXY Detail */}
                <Card glow='#00E5FF'>
                  <div style={{ fontSize: 11, fontWeight: 800, color: 'rgba(0,229,255,0.7)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>DXY Analysis</div>
                  <div style={{ marginBottom: 12 }}>
                    <GaugeBar value={MACRO.dxy} max={120} color='#00E5FF' label='DXY Level (vs 120 max)' />
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(143,148,163,0.6)', lineHeight: 1.6 }}>
                    DXY at <strong style={{ color: '#00E5FF' }}>{MACRO.dxy}</strong> — below 100 is historically bearish for USD, bullish for EM and commodities. Current level suggests moderate USD strength.
                  </div>
                  <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 6, background: 'rgba(0,229,255,0.1)', color: '#00E5FF', fontSize: 10, fontWeight: 700 }}>Fed hawkish</span>
                    <span style={{ padding: '2px 8px', borderRadius: 6, background: 'rgba(255,149,0,0.1)', color: '#FF9500', fontSize: 10, fontWeight: 700 }}>EM pressure</span>
                  </div>
                </Card>

                {/* Yield Curve */}
                <Card glow='#FF9500'>
                  <div style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,149,0,0.7)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>Interest Rate Environment</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {[
                      { label: 'Fed Funds Rate', value: '5.25–5.50%', color: '#FF9500' },
                      { label: 'US 10Y Yield',   value: `${MACRO.us10y}%`, color: '#FF9500' },
                      { label: 'US 2Y Yield',    value: '4.82%', color: '#FF3B30' },
                      { label: '2Y-10Y Spread',  value: '-0.54%', color: '#BF5AF2' },
                    ].map(item => (
                      <div key={item.label}>
                        <div style={{ fontSize: 9, color: 'rgba(143,148,163,0.5)' }}>{item.label}</div>
                        <div style={{ fontSize: 16, fontWeight: 900, fontFamily: 'JetBrains Mono', color: item.color, marginTop: 2 }}>{item.value}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.2)' }}>
                    <span style={{ fontSize: 10, color: '#FF3B30', fontWeight: 700 }}>⚠️ Inverted yield curve — historical recession signal</span>
                  </div>
                </Card>

                {/* Inflation */}
                <Card glow='#FF3B30'>
                  <div style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,59,48,0.7)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>Inflation (CPI YoY)</div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 40, fontWeight: 900, fontFamily: 'JetBrains Mono', color: '#FF3B30', lineHeight: 1 }}>{MACRO.cpi}%</div>
                    <div style={{ paddingBottom: 4 }}>
                      <div style={{ fontSize: 10, color: 'rgba(143,148,163,0.5)' }}>Target</div>
                      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'JetBrains Mono', color: '#34C759' }}>2.0%</div>
                    </div>
                  </div>
                  <GaugeBar value={MACRO.cpi} max={10} color='#FF3B30' />
                  <div style={{ fontSize: 10, color: 'rgba(143,148,163,0.5)', marginTop: 8 }}>
                    {MACRO.cpi > 3 ? 'Above target — restrictive policy likely to continue' : 'Approaching target — rate cuts possible'}
                  </div>
                </Card>

                {/* M2 Liquidity */}
                <Card glow='#BF5AF2'>
                  <div style={{ fontSize: 11, fontWeight: 800, color: 'rgba(191,90,242,0.7)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>Liquidity (M2 + Central Banks)</div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 32, fontWeight: 900, fontFamily: 'JetBrains Mono', color: '#BF5AF2', lineHeight: 1 }}>${MACRO.m2}T</div>
                    <div style={{ paddingBottom: 4 }}>
                      <Pill value={MACRO.m2Change} />
                    </div>
                  </div>
                  <GaugeBar value={0.7} max={1} color='#BF5AF2' label='Global liquidity index (0–1)' />
                  <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
                    <span style={{ padding: '2px 8px', borderRadius: 6, background: 'rgba(191,90,242,0.1)', color: '#BF5AF2', fontSize: 10, fontWeight: 700 }}>Fed QT ongoing</span>
                    <span style={{ padding: '2px 8px', borderRadius: 6, background: 'rgba(10,133,255,0.1)', color: '#0A85FF', fontSize: 10, fontWeight: 700 }}>BOJ accommodative</span>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
           *  FOREX SECTION
           * ══════════════════════════════════════════════════════════════════ */}
          {activeSection === 'forex' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <SectionHeader title='Forex Analysis' sub='Currency strength · Carry trade · Correlation matrix' />

              {/* Currency Strength Meter */}
              <Card glow='#BF5AF2'>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'rgba(191,90,242,0.8)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 16 }}>
                  Currency Strength Meter
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                  {[...CURRENCIES].sort((a, b) => b.strength - a.strength).map((c, i) => {
                    const color = c.strength > 60 ? '#34C759' : c.strength > 40 ? '#FF9500' : '#FF3B30'
                    return (
                      <div key={c.code} style={{
                        padding: '12px 14px', borderRadius: 12,
                        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                        display: 'flex', flexDirection: 'column', gap: 8,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 20 }}>{c.flag}</span>
                          <div>
                            <div style={{ fontWeight: 800, fontSize: 13, color: '#F0F3FF' }}>{c.code}</div>
                            <div style={{ fontSize: 9, color: 'rgba(143,148,163,0.5)' }}>{c.interestRate}% rate</div>
                          </div>
                          <div style={{ marginLeft: 'auto', fontWeight: 900, fontSize: 18, fontFamily: 'JetBrains Mono', color }}>{c.strength}</div>
                        </div>
                        <GaugeBar value={c.strength} max={100} color={color} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                          <span style={{ color: 'rgba(143,148,163,0.5)' }}>{c.rate.toFixed(4)}</span>
                          <Pill value={c.change} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Card>

              {/* Carry Trade */}
              <Card glow='#34C759'>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'rgba(52,199,89,0.8)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>
                  Carry Trade — Interest Rate Differentials
                </div>
                <div style={{ fontSize: 10, color: 'rgba(143,148,163,0.5)', marginBottom: 14 }}>
                  Best carry opportunities: long high-yield / short low-yield currencies
                </div>
                <CarryTable currencies={CURRENCIES} />
              </Card>

              {/* Correlation Matrix */}
              <Card glow='#0A85FF'>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'rgba(10,133,255,0.8)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>
                  Correlation Matrix — Major Assets
                </div>
                <div style={{ fontSize: 10, color: 'rgba(143,148,163,0.5)', marginBottom: 14 }}>
                  <span style={{ color: '#34C759' }}>■</span> Positive &nbsp;
                  <span style={{ color: '#8F94A3' }}>■</span> Neutral &nbsp;
                  <span style={{ color: '#FF3B30' }}>■</span> Negative
                </div>
                <CorrelationMatrix assets={corrAssets} />
              </Card>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
           *  COMPOSITE SCORES SECTION
           * ══════════════════════════════════════════════════════════════════ */}
          {activeSection === 'scores' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <SectionHeader title='Composite Scores' sub='Macro Risk Score · Trend Strength Score · Normalized 0–1' />

              {/* Main Gauges */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                <ScoreGauge
                  score={MACRO.macroRiskScore}
                  label='Macro Risk Score'
                  glow='#FF9500'
                  description='Composite of DXY strength, yield curve inversion, CPI vs target, M2 growth rate. Higher = more macro risk.'
                />
                <ScoreGauge
                  score={trendStrengthScore}
                  label='Trend Strength Score'
                  glow='#34C759'
                  description='% of filtered assets in bull or strong bull trend regime (MA50 > MA200). Higher = stronger market trend.'
                />
                <ScoreGauge
                  score={0.41}
                  label='Volatility Risk Score'
                  glow='#FF3B30'
                  description='Aggregate volatility regime across assets. Weighted ATR / realized vol. High = widespread expansion or panic.'
                />
                <ScoreGauge
                  score={0.72}
                  label='USD Strength Score'
                  glow='#00E5FF'
                  description='DXY normalized vs 5Y range. Above 0.5 = dollar bullish environment. Bearish for commodities and EM assets.'
                />
              </div>

              {/* Score Components Breakdown */}
              <Card glow='#FF9500'>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,149,0,0.8)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 16 }}>
                  Macro Risk Score — Component Breakdown
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {[
                    { label: 'Yield Curve Inversion', value: 0.85, desc: 'Inverted 2Y–10Y spread signals recession risk', color: '#FF3B30' },
                    { label: 'Inflation vs Target',   value: 0.62, desc: 'CPI 3.2% vs 2.0% Fed target', color: '#FF9500' },
                    { label: 'USD Strength (DXY)',    value: 0.56, desc: 'DXY at 103.4 — moderate strength', color: '#00E5FF' },
                    { label: 'Liquidity (M2 growth)', value: 0.38, desc: 'M2 contracting — tighter financial conditions', color: '#BF5AF2' },
                    { label: 'Earnings Growth',       value: 0.48, desc: 'S&P 500 FY EPS growth +7.2% est.', color: '#34C759' },
                  ].map(item => (
                    <div key={item.label}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#F0F3FF' }}>{item.label}</span>
                        <span style={{ fontSize: 11, fontWeight: 800, fontFamily: 'JetBrains Mono', color: item.color }}>{Math.round(item.value * 100)}/100</span>
                      </div>
                      <GaugeBar value={item.value} max={1} color={item.color} />
                      <div style={{ fontSize: 10, color: 'rgba(143,148,163,0.5)', marginTop: 4 }}>{item.desc}</div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Trend Components */}
              <Card glow='#34C759'>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'rgba(52,199,89,0.8)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 16 }}>
                  Trend Strength Score — Component Breakdown
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {[
                    { label: '% Assets in Uptrend',    value: trendStrengthScore, desc: `${Math.round(trendStrengthScore * filtered.length)}/${filtered.length} assets above MA200`, color: '#34C759' },
                    { label: 'Market Breadth',          value: 0.67, desc: '67% stocks above MA200', color: '#0A85FF' },
                    { label: 'Momentum (MTF)',          value: 0.58, desc: 'Average 1M return across assets', color: '#00E5FF' },
                    { label: 'Sector Breadth',          value: 0.64, desc: '7/11 sectors in positive return 1M', color: '#FF9500' },
                    { label: 'Advance / Decline',       value: 0.70, desc: 'A/D ratio 2.3 — broad participation', color: '#34C759' },
                  ].map(item => (
                    <div key={item.label}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#F0F3FF' }}>{item.label}</span>
                        <span style={{ fontSize: 11, fontWeight: 800, fontFamily: 'JetBrains Mono', color: item.color }}>{Math.round(item.value * 100)}/100</span>
                      </div>
                      <GaugeBar value={item.value} max={1} color={item.color} />
                      <div style={{ fontSize: 10, color: 'rgba(143,148,163,0.5)', marginTop: 4 }}>{item.desc}</div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Interpretation */}
              <Card glow='#8F94A3'>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#8F94A3', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>
                  Score Interpretation Guide
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  {[
                    { range: '0.0 – 0.3', label: 'LOW', desc: 'Low risk / strong trend. Favorable environment for risk-on positioning.', color: '#34C759' },
                    { range: '0.3 – 0.5', label: 'MODERATE–LOW', desc: 'Below-average risk. Cautiously constructive. Monitor for regime changes.', color: '#34C759' },
                    { range: '0.5 – 0.7', label: 'MODERATE', desc: 'Mixed signals. Selective positioning preferred. Reduce leverage.', color: '#FF9500' },
                    { range: '0.7 – 1.0', label: 'HIGH', desc: 'Elevated risk / weak trend. Defensive allocation, hedges recommended.', color: '#FF3B30' },
                  ].map(item => (
                    <div key={item.range} style={{ padding: '12px 14px', borderRadius: 10, background: `${item.color}08`, border: `1px solid ${item.color}25` }}>
                      <div style={{ fontSize: 10, color: 'rgba(143,148,163,0.5)', marginBottom: 4 }}>{item.range}</div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: item.color, marginBottom: 6 }}>{item.label}</div>
                      <div style={{ fontSize: 10, color: 'rgba(143,148,163,0.6)', lineHeight: 1.5 }}>{item.desc}</div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

        </motion.div>
      </AnimatePresence>

      {/* ── Asset Detail Sheet ── */}
      <AnimatePresence>
        {selectedAsset && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(4px)', zIndex: 50, display: 'flex', justifyContent: 'flex-end',
            }}
            onClick={() => setSelectedAsset(null)}
          >
            <motion.div
              initial={{ x: 400 }}
              animate={{ x: 0 }}
              exit={{ x: 400 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={e => e.stopPropagation()}
              style={{
                width: 360, height: '100%', overflowY: 'auto',
                background: 'rgba(8,12,22,0.98)', borderLeft: '1px solid rgba(0,229,255,0.15)',
                padding: 24,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: '#F0F3FF', fontFamily: 'Syne, sans-serif' }}>{selectedAsset.ticker}</h2>
                  <div style={{ fontSize: 11, color: 'rgba(143,148,163,0.5)', marginTop: 2 }}>{selectedAsset.name}</div>
                </div>
                <button onClick={() => setSelectedAsset(null)}
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 10px', color: '#F0F3FF', cursor: 'pointer', fontSize: 14 }}>
                  ✕
                </button>
              </div>

              {/* Price */}
              <div style={{ marginBottom: 20, padding: 16, borderRadius: 12, background: 'rgba(0,229,255,0.04)', border: '1px solid rgba(0,229,255,0.15)' }}>
                <div style={{ fontSize: 10, color: 'rgba(143,148,163,0.5)', marginBottom: 4 }}>PRICE</div>
                <div style={{ fontSize: 32, fontWeight: 900, fontFamily: 'JetBrains Mono', color: '#00E5FF' }}>
                  {selectedAsset.price.toFixed(selectedAsset.price < 10 ? 4 : 2)}
                </div>
                <div style={{ marginTop: 8 }}><Pill value={selectedAsset.change1D} /></div>
              </div>

              {/* Returns */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: 'rgba(143,148,163,0.5)', marginBottom: 10, fontWeight: 700, letterSpacing: '0.1em' }}>MULTI-TIMEFRAME RETURNS</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[['1D', selectedAsset.change1D], ['1W', selectedAsset.change1W], ['1M', selectedAsset.change1M], ['YTD', selectedAsset.changeYTD]].map(([label, val]) => (
                    <div key={label as string} style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ fontSize: 9, color: 'rgba(143,148,163,0.5)', marginBottom: 4 }}>{label}</div>
                      <Pill value={val as number} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Risk Metrics */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: 'rgba(143,148,163,0.5)', marginBottom: 10, fontWeight: 700, letterSpacing: '0.1em' }}>RISK METRICS</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { label: 'Rolling Sharpe (365d)', value: selectedAsset.sharpe.toFixed(2), color: selectedAsset.sharpe > 1 ? '#34C759' : selectedAsset.sharpe > 0 ? '#FF9500' : '#FF3B30' },
                    { label: 'ATR %', value: `${selectedAsset.atr.toFixed(2)}%`, color: '#FF9500' },
                    { label: 'VaR 95% (1D)', value: `${selectedAsset.var95.toFixed(2)}%`, color: '#FF3B30' },
                    { label: 'Max Drawdown', value: `${selectedAsset.maxDrawdown.toFixed(1)}%`, color: '#FF3B30' },
                    { label: 'Recovery', value: selectedAsset.recoveryDays != null ? `${selectedAsset.recoveryDays} days` : 'In drawdown', color: selectedAsset.recoveryDays != null ? '#34C759' : '#FF3B30' },
                  ].map(item => (
                    <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)' }}>
                      <span style={{ fontSize: 11, color: 'rgba(143,148,163,0.6)' }}>{item.label}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono', color: item.color }}>{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Trend */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: 'rgba(143,148,163,0.5)', marginBottom: 10, fontWeight: 700, letterSpacing: '0.1em' }}>MARKET STRUCTURE</div>
                <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 11, color: 'rgba(143,148,163,0.6)' }}>Trend Regime</span>
                    <TrendBadge trend={selectedAsset.trendRegime} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 11, color: 'rgba(143,148,163,0.6)' }}>Vol Regime</span>
                    <RegimeBadge regime={selectedAsset.volatilityRegime} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: 'rgba(143,148,163,0.6)' }}>MA50</span>
                    <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono', color: '#0A85FF', fontWeight: 700 }}>{selectedAsset.ma50.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, color: 'rgba(143,148,163,0.6)' }}>MA200</span>
                    <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono', color: '#BF5AF2', fontWeight: 700 }}>{selectedAsset.ma200.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Relative Strength */}
              <div>
                <div style={{ fontSize: 10, color: 'rgba(143,148,163,0.5)', marginBottom: 10, fontWeight: 700, letterSpacing: '0.1em' }}>RELATIVE STRENGTH</div>
                <div style={{ padding: '12px 14px', borderRadius: 10, background: selectedAsset.vs_benchmark >= 0 ? 'rgba(52,199,89,0.06)' : 'rgba(255,59,48,0.06)', border: `1px solid ${selectedAsset.vs_benchmark >= 0 ? 'rgba(52,199,89,0.2)' : 'rgba(255,59,48,0.2)'}` }}>
                  <div style={{ fontSize: 9, color: 'rgba(143,148,163,0.5)', marginBottom: 4 }}>vs Benchmark (YTD)</div>
                  <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'JetBrains Mono', color: selectedAsset.vs_benchmark >= 0 ? '#34C759' : '#FF3B30' }}>
                    {selectedAsset.vs_benchmark >= 0 ? '+' : ''}{selectedAsset.vs_benchmark.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(143,148,163,0.5)', marginTop: 4 }}>
                    {selectedAsset.vs_benchmark >= 0 ? 'Outperforming benchmark' : 'Underperforming benchmark'}
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
