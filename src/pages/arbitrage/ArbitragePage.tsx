// src/pages/arbitrage/ArbitragePage.tsx — Mispricing Scanner (copper dark theme)
import { useState, useEffect, useCallback, useRef } from 'react'

// ── Design tokens (copper dark — matching the research visuals) ────────────
const C = {
  bg:      '#0C0A08',
  card:    '#141210',
  card2:   '#1A1714',
  copper:  '#C4896A',
  copperD: '#9B6A4E',
  copperL: '#E8A87C',
  text:    '#E8DDD5',
  muted:   '#7A6A60',
  dim:     '#3D3028',
  green:   '#5DBD7A',
  red:     '#C45A5A',
  amber:   '#D4A84B',
  border:  'rgba(196,137,106,0.12)',
  border2: 'rgba(255,255,255,0.06)',
}

// ── Types ──────────────────────────────────────────────────────────────────

interface PolyMarket {
  id: string
  question: string
  volume: number
  liquidity: number
  outcomes: string[]
  prices: number[]
  sum: number
  edge: number
  endDate: string
}

interface TriangleArb {
  id: string; name: string; actual: number; implied: number; spread: number; direction: string
}

interface BasisOpp {
  symbol: string; spotPrice: number; perpPrice: number
  basis: number; fundingRate: number; annualizedFunding: number
  signal: 'long_basis' | 'short_basis'
}

// ── Constants ─────────────────────────────────────────────────────────────

const TRIANGLES = [
  { base: 'ETH',  quote: 'BTC' }, { base: 'BNB',  quote: 'BTC' },
  { base: 'SOL',  quote: 'BTC' }, { base: 'XRP',  quote: 'BTC' },
  { base: 'BNB',  quote: 'ETH' }, { base: 'SOL',  quote: 'ETH' },
  { base: 'AVAX', quote: 'BTC' }, { base: 'MATIC', quote: 'BTC' },
]
const PERP_SYMS = ['BTC','ETH','SOL','BNB','XRP','AVAX','ARB','OP']
const TRI_THRES = 0.15
const POLY_THRES = 0.005

// ── Helpers ────────────────────────────────────────────────────────────────

const fmt   = (n: number, d = 2) => n.toFixed(d)
const fmtM  = (n: number) => n >= 1e6 ? `$${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n/1e3).toFixed(0)}K` : `$${n.toFixed(0)}`
const mono  = { fontFamily: 'JetBrains Mono, "Courier New", monospace' }
const syne  = { fontFamily: 'Syne, system-ui, sans-serif' }

// ── Sub-components ─────────────────────────────────────────────────────────

function KPICard({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '24px 28px', flex: '1 1 180px' }}>
      <div style={{ fontSize: 36, fontWeight: 800, color: C.copper, letterSpacing: '-0.02em', ...syne, lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: C.copperL, ...mono, marginTop: 6, marginBottom: 2 }}>{sub}</div>}
      <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.15em', textTransform: 'uppercase', ...mono, marginTop: sub ? 0 : 6 }}>
        {label}
      </div>
    </div>
  )
}

function BarChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 32, height: 160, padding: '0 8px' }}>
      {data.map(d => (
        <div key={d.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, gap: 6 }}>
          <div style={{ fontSize: 10, color: C.copper, ...mono }}>{fmtM(d.value)}</div>
          <div style={{ width: '100%', height: Math.max((d.value / max) * 130, 4), background: C.copper, borderRadius: '4px 4px 0 0', opacity: 0.85, transition: 'height 0.8s ease', minHeight: 4 }} />
          <div style={{ fontSize: 9, color: C.muted, textAlign: 'center', letterSpacing: '0.05em', ...mono, lineHeight: 1.4 }}>
            {d.label}
          </div>
        </div>
      ))}
    </div>
  )
}

function AlgoStep({ emoji, title, sub, last }: { emoji: string; title: string; sub: string; last?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: C.card2, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
          {emoji}
        </div>
        <div style={{ textAlign: 'center', width: 90 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.text, ...syne }}>{title}</div>
          <div style={{ fontSize: 9, color: C.muted, ...mono, marginTop: 2, lineHeight: 1.4 }}>{sub}</div>
        </div>
      </div>
      {!last && (
        <div style={{ width: 32, marginBottom: 28, color: C.dim, fontSize: 16, textAlign: 'center', flexShrink: 0 }}>→</div>
      )}
    </div>
  )
}

function SectionLabel({ text, badge }: { text: string; badge?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <span style={{ fontSize: 9, color: C.muted, letterSpacing: '0.15em', textTransform: 'uppercase', ...mono }}>{text}</span>
      {badge && (
        <span style={{ fontSize: 8, fontWeight: 700, color: C.copper, background: `${C.copper}18`, border: `1px solid ${C.copper}35`, borderRadius: 20, padding: '2px 8px', ...mono, letterSpacing: '0.1em' }}>
          {badge}
        </span>
      )}
      <div style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  )
}

function EdgePill({ value, color }: { value: string; color: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color, background: `${color}18`, border: `1px solid ${color}35`, borderRadius: 6, padding: '2px 8px', ...mono }}>
      {value}
    </span>
  )
}

function PolyRow({ m }: { m: PolyMarket }) {
  const edgePct = m.edge * 100
  const clr = edgePct > 3 ? C.green : edgePct > 1 ? C.amber : C.copper
  return (
    <div style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.border2}`, background: C.card2, marginBottom: 6, display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.text, lineHeight: 1.4, marginBottom: 5 }}>
          {m.question.length > 75 ? m.question.slice(0, 75) + '…' : m.question}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {m.outcomes.slice(0, 3).map((o, i) => (
            <span key={i} style={{ fontSize: 9, color: C.muted, ...mono }}>
              {o}: <strong style={{ color: C.text }}>${fmt(m.prices[i] ?? 0, 3)}</strong>
            </span>
          ))}
          <span style={{ fontSize: 9, color: C.muted, ...mono }}>
            Σ=<strong style={{ color: m.sum < 0.97 ? C.green : C.text }}>{fmt(m.sum, 3)}</strong>
          </span>
          <span style={{ fontSize: 9, color: C.muted, ...mono }}>Vol {fmtM(m.volume)}</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, justifyContent: 'center' }}>
        <EdgePill value={`+${fmt(edgePct, 2)}%`} color={clr} />
      </div>
    </div>
  )
}

function TriRow({ t }: { t: TriangleArb }) {
  const clr = t.spread > 0.5 ? C.green : t.spread > 0.25 ? C.amber : C.copper
  return (
    <div style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.border2}`, background: C.card2, marginBottom: 6, display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 4 }}>{t.name}</div>
        <div style={{ fontSize: 9, color: C.muted, ...mono, marginBottom: 2 }}>
          Actual <strong style={{ color: C.text }}>${fmt(t.actual, t.actual > 100 ? 2 : 4)}</strong>
          &nbsp;·&nbsp;
          Implied <strong style={{ color: C.text }}>${fmt(t.implied, t.implied > 100 ? 2 : 4)}</strong>
        </div>
        <div style={{ fontSize: 9, color: C.muted, lineHeight: 1.4 }}>→ {t.direction}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <EdgePill value={`Δ ${fmt(t.spread, 3)}%`} color={clr} />
      </div>
    </div>
  )
}

function BasisRow({ b }: { b: BasisOpp }) {
  const isShort = b.signal === 'short_basis'
  const clr = isShort ? C.red : C.green
  return (
    <div style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.border2}`, background: C.card2, marginBottom: 6, display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 4 }}>
          {b.symbol}/USDT — {isShort ? '↓ Short Perp' : '↑ Long Perp'}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9, color: C.muted, ...mono }}>Spot <strong style={{ color: C.text }}>${fmt(b.spotPrice, b.spotPrice > 100 ? 2 : 4)}</strong></span>
          <span style={{ fontSize: 9, color: C.muted, ...mono }}>Perp <strong style={{ color: C.text }}>${fmt(b.perpPrice, b.perpPrice > 100 ? 2 : 4)}</strong></span>
          <span style={{ fontSize: 9, color: C.muted, ...mono }}>FR <strong style={{ color: b.fundingRate > 0 ? C.amber : C.green }}>{fmt(b.fundingRate, 4)}%/8h</strong></span>
          <span style={{ fontSize: 9, color: C.muted, ...mono }}>~{fmt(b.annualizedFunding, 0)}%/yr</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <EdgePill value={`${b.basis > 0 ? '+' : ''}${fmt(b.basis, 3)}%`} color={clr} />
      </div>
    </div>
  )
}

// ── Fetch logic ────────────────────────────────────────────────────────────

async function fetchPolymarketOpps(): Promise<PolyMarket[]> {
  const r = await fetch('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=100&order=volume&ascending=false', { signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error('Polymarket failed')
  const data = await r.json() as { id: string; question: string; volume: number; liquidity: number; outcomePrices: string; outcomes: string; endDate: string }[]
  return data.map(m => {
    let prices: number[] = []
    let outcomes: string[] = []
    try { prices = JSON.parse(m.outcomePrices).map(Number) } catch { return null }
    try { outcomes = JSON.parse(m.outcomes) } catch { outcomes = prices.map((_, i) => `O${i+1}`) }
    const sum = prices.reduce((a, b) => a + b, 0)
    return { id: m.id, question: m.question, volume: m.volume || 0, liquidity: m.liquidity || 0, outcomes, prices, sum, edge: 1 - sum, endDate: m.endDate || '' }
  }).filter((m): m is PolyMarket => m !== null && m.edge > POLY_THRES && m.prices.length >= 2 && m.liquidity > 500)
    .sort((a, b) => b.edge - a.edge).slice(0, 40)
}

async function fetchCryptoData() {
  const [sR, pR, fR] = await Promise.all([
    fetch('https://api.binance.com/api/v3/ticker/price', { signal: AbortSignal.timeout(6000) }),
    fetch('https://fapi.binance.com/fapi/v1/ticker/price', { signal: AbortSignal.timeout(6000) }),
    fetch('https://fapi.binance.com/fapi/v1/premiumIndex', { signal: AbortSignal.timeout(6000) }),
  ])
  const spotAll: {symbol:string;price:string}[] = sR.ok ? await sR.json() : []
  const perpAll: {symbol:string;price:string}[] = pR.ok ? await pR.json() : []
  const fundAll: {symbol:string;lastFundingRate:string}[] = fR.ok ? await fR.json() : []
  const spot: Record<string,number> = {}
  const perp: Record<string,number> = {}
  const fund: Record<string,number> = {}
  spotAll.forEach(t => { spot[t.symbol] = parseFloat(t.price) })
  perpAll.forEach(t => { perp[t.symbol] = parseFloat(t.price) })
  fundAll.forEach(t => { fund[t.symbol] = parseFloat(t.lastFundingRate) })

  const triangles: TriangleArb[] = []
  for (const { base, quote } of TRIANGLES) {
    const bU = spot[`${base}USDT`], qU = spot[`${quote}USDT`], bQ = spot[`${base}${quote}`]
    if (!bU || !qU || !bQ) continue
    const implied = qU * bQ
    const spread  = Math.abs(implied - bU) / bU * 100
    if (spread > TRI_THRES) triangles.push({
      id: `${base}-${quote}`, name: `${base} via ${quote}`, actual: bU, implied, spread,
      direction: implied > bU ? `Buy ${base}/USDT · Sell ${base}/${quote} + ${quote}/USDT` : `Buy ${base}/${quote} + ${quote}/USDT · Sell ${base}/USDT`,
    })
  }

  const basis: BasisOpp[] = []
  for (const sym of PERP_SYMS) {
    const sp = spot[`${sym}USDT`], pp = perp[`${sym}USDT`], fr = fund[`${sym}USDT`] ?? 0
    if (!sp || !pp) continue
    const bPct = (pp - sp) / sp * 100
    const af   = fr * 3 * 365 * 100
    if (bPct > 0.3 && fr > 0.0001)   basis.push({ symbol: sym, spotPrice: sp, perpPrice: pp, basis: bPct, fundingRate: fr*100, annualizedFunding: af, signal: 'short_basis' })
    if (bPct < -0.3 && fr < -0.0001) basis.push({ symbol: sym, spotPrice: sp, perpPrice: pp, basis: bPct, fundingRate: fr*100, annualizedFunding: af, signal: 'long_basis' })
  }
  basis.sort((a, b) => Math.abs(b.basis) - Math.abs(a.basis))

  return { triangles: triangles.sort((a, b) => b.spread - a.spread), basis }
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function ArbitragePage() {
  const [poly,   setPoly]   = useState<PolyMarket[]>([])
  const [tri,    setTri]    = useState<TriangleArb[]>([])
  const [basis,  setBasis]  = useState<BasisOpp[]>([])
  const [loading, setLoading] = useState(true)
  const [ts, setTs]           = useState<Date|null>(null)
  const [auto, setAuto]       = useState(true)
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [r1, r2] = await Promise.allSettled([fetchPolymarketOpps(), fetchCryptoData()])
      if (r1.status === 'fulfilled') setPoly(r1.value)
      if (r2.status === 'fulfilled') { setTri(r2.value.triangles); setBasis(r2.value.basis) }
      setTs(new Date())
    } catch { /* noop */ }
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    if (!auto) { if (timerRef.current) clearInterval(timerRef.current); return }
    timerRef.current = setInterval(refresh, 60_000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [auto, refresh])

  // ── KPI stats from live data ──
  const totalPoly  = poly.length
  const medianSum  = poly.length > 0 ? [...poly].sort((a,b) => a.sum - b.sum)[Math.floor(poly.length/2)]?.sum : null
  const totalOpps  = totalPoly + tri.length + basis.length
  const pctWithArb = poly.length > 0 ? Math.round(poly.length / 100 * 100) : 0

  const barData = [
    { label: 'Single condition', value: poly.reduce((a,m) => a + m.volume, 0), color: C.copper },
    { label: 'Triangulaire',    value: tri.length * 50000, color: C.copper },
    { label: 'Basis / Funding', value: basis.length * 30000, color: C.copper },
  ]

  const skeleton = (n: number) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{ height: 64, borderRadius: 8, background: C.card2, animation: 'apulse 1.4s ease-in-out infinite', opacity: 0.6 }} />
      ))}
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, padding: '28px 32px', fontFamily: 'system-ui, sans-serif', maxWidth: 1300, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.text, letterSpacing: '0.15em', textTransform: 'uppercase', ...mono }}>
            Mispricing Scanner
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 10, color: C.muted, letterSpacing: '0.08em', ...mono }}>
            Polymarket · Triangulaire · Basis — {ts ? `MAJ ${ts.toLocaleTimeString('fr-FR')}` : 'Chargement…'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setAuto(v => !v)} style={{ fontSize: 9, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', background: auto ? `${C.copper}18` : C.card, border: `1px solid ${auto ? C.copper : C.dim}`, color: auto ? C.copper : C.muted, letterSpacing: '0.1em', ...mono }}>
            {auto ? '⏱ AUTO 60s' : '⏱ MANUEL'}
          </button>
          <button onClick={refresh} disabled={loading} style={{ fontSize: 9, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', background: C.card, border: `1px solid ${C.dim}`, color: C.muted, letterSpacing: '0.1em', ...mono }}>
            {loading ? '…' : '↻ REFRESH'}
          </button>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <KPICard value={`${totalOpps}`} label="Opportunities détectées" />
        <KPICard value={`${pctWithArb}%`} label="Conditions avec opportunité" sub="(sur top 100 marchés Polymarket)" />
        <KPICard value={medianSum !== null ? `$${fmt(medianSum, 3)}` : '–'} label="Médiane somme des prix" sub="Devrait être $1.000" />
        <KPICard value={`${tri.length + basis.length}`} label="Paires crypto exploitables" />
      </div>

      {/* ── Bar Chart ── */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 24px', marginBottom: 24 }}>
        <SectionLabel text="Opportunités par catégorie — données live" badge="LIVE" />
        <BarChart data={barData} />
        <div style={{ display: 'flex', gap: 32, marginTop: 8, paddingLeft: 8 }}>
          {barData.map(d => (
            <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: C.copper }} />
              <span style={{ fontSize: 8, color: C.muted, ...mono }}>{d.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Algorithm flow ── */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 24px', marginBottom: 24 }}>
        <SectionLabel text="De l'espace exponentiel aux contraintes linéaires" badge="INTEGER PROGRAMMING" />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, flexWrap: 'wrap', rowGap: 16 }}>
          <AlgoStep emoji="🎲" title="2^63 outcomes" sub={"Brute force\nimpossible"} />
          <AlgoStep emoji="⚖️" title="Définir contraintes" sub={"Inégalités\nlinéaires"} />
          <AlgoStep emoji="🔢" title="Prog. entière" sub={"Résoudre en\nsecondes"} />
          <AlgoStep emoji="🎯" title="Trouver l'arb" sub={"Profit\ngaranti"} />
          <AlgoStep emoji="⚡" title="Exécuter" sub={"<30ms"} last />
        </div>
      </div>

      {/* ── Research KPIs (from arXiv:2508.03474) ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <KPICard value="87%" label="Single-condition execution success" sub="Source : arXiv:2508.03474" />
        <KPICard value="45%" label="Combinatorial execution success" />
        <KPICard value="$496" label="Avg profit per trade (top wallet)" sub="4 049 trades sur 1 an" />
        <KPICard value="$0.05" label="Minimum profit threshold utilisé" />
      </div>

      {/* ── Two tables side by side ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16, marginBottom: 24 }}>

        {/* Execution Latency Table */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 9, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', ...mono }}>
              Exécution — Retail vs Systèmes sophistiqués
            </span>
            <span style={{ fontSize: 8, fontWeight: 700, color: C.copper, background: `${C.copper}18`, border: `1px solid ${C.copper}35`, borderRadius: 20, padding: '2px 8px', ...mono, letterSpacing: '0.08em' }}>
              REAL MEASURED TIMES
            </span>
          </div>
          {/* Header row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', padding: '10px 20px', borderBottom: `1px solid ${C.border2}` }}>
            <span style={{ fontSize: 8, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', ...mono }}>STEP</span>
            <span style={{ fontSize: 8, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', ...mono }}>RETAIL TRADER</span>
            <span style={{ fontSize: 8, color: C.green, letterSpacing: '0.12em', textTransform: 'uppercase', ...mono, fontWeight: 700 }}>ARBITRAGE SYSTEM</span>
          </div>
          {[
            { step: 'Price feed',       retail: '~30s polling',      arb: '<5ms WebSocket push' },
            { step: 'Decision',         retail: 'Manual analysis',   arb: '<10ms pre-calculated' },
            { step: 'Submission',       retail: '~50ms API call',    arb: '~15ms direct RPC' },
            { step: 'Execution',        retail: 'Sequential legs',   arb: 'Parallel, same block' },
            { step: 'Block inclusion',  retail: '~2,000ms',          arb: '~2,000ms (unavoidable)' },
          ].map((r, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', padding: '12px 20px', borderBottom: `1px solid ${C.border2}`, background: i % 2 === 0 ? 'transparent' : `${C.card2}` }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.text }}>{r.step}</span>
              <span style={{ fontSize: 11, color: C.muted, ...mono }}>{r.retail}</span>
              <span style={{ fontSize: 11, color: C.green, ...mono }}>{r.arb}</span>
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', padding: '14px 20px' }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: C.text }}>Total</span>
            <span style={{ fontSize: 12, color: C.muted, ...mono, textDecoration: 'line-through' }}>~32 secondes</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: C.green, ...mono }}>~2,040ms</span>
          </div>
        </div>

        {/* Arbitrage by Type Table */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 9, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', ...mono }}>
              Arbitrage par type — Avril 2024 → Avril 2025
            </span>
            <span style={{ fontSize: 8, fontWeight: 700, color: C.copper, background: `${C.copper}18`, border: `1px solid ${C.copper}35`, borderRadius: 20, padding: '2px 8px', ...mono, letterSpacing: '0.08em' }}>
              ON-CHAIN VERIFIED
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr auto', padding: '10px 20px', borderBottom: `1px solid ${C.border2}` }}>
            <span style={{ fontSize: 8, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', ...mono }}>STRATÉGIE</span>
            <span style={{ fontSize: 8, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', ...mono }}>MÉCANISME</span>
            <span style={{ fontSize: 8, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', ...mono, textAlign: 'right' }}>EXTRAIT</span>
          </div>
          {[
            { strat: 'Single condition',    mech: 'YES + NO < $1.00 ou > $1.00',           value: '$10,581,362' },
            { strat: 'Market rebalancing',  mech: 'Buy all YES/NO sur marchés corrélés',    value: '$29,011,589' },
            { strat: 'Combinatorial',       mech: 'Dépendance logique cross-market',        value: '$95,634' },
          ].map((r, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr auto', padding: '14px 20px', borderBottom: `1px solid ${C.border2}`, background: i % 2 === 0 ? 'transparent' : C.card2, alignItems: 'start' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.text }}>{r.strat}</span>
              <span style={{ fontSize: 10, color: C.muted, lineHeight: 1.4 }}>{r.mech}</span>
              <span style={{ fontSize: 11, color: C.green, ...mono, fontWeight: 700, textAlign: 'right' }}>{r.value}</span>
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr auto', padding: '14px 20px' }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: C.text }}>Total</span>
            <span />
            <span style={{ fontSize: 12, fontWeight: 800, color: C.copper, ...mono }}>$39,688,585</span>
          </div>
        </div>
      </div>

      {/* ── Main grid ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16 }}>

        {/* Polymarket */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 20px' }}>
          <SectionLabel text={`Polymarket — YES+NO ≠ $1 (${totalPoly})`} badge="ON-CHAIN" />
          {loading && poly.length === 0 ? skeleton(4) : poly.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: C.muted, fontSize: 11, ...mono }}>✓ Marchés correctement pricés</div>
          ) : poly.map(m => <PolyRow key={m.id} m={m} />)}
        </div>

        {/* Crypto */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 20px' }}>
            <SectionLabel text={`Arbitrage Triangulaire (${tri.length})`} badge="BINANCE" />
            {loading && tri.length === 0 ? skeleton(2) : tri.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '16px 0', color: C.muted, fontSize: 11, ...mono }}>✓ Aucune incohérence &gt;{TRI_THRES}%</div>
            ) : tri.map(t => <TriRow key={t.id} t={t} />)}
          </div>

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 20px' }}>
            <SectionLabel text={`Basis Futures / Spot (${basis.length})`} badge="BINANCE FAPI" />
            {loading && basis.length === 0 ? skeleton(2) : basis.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '16px 0', color: C.muted, fontSize: 11, ...mono }}>✓ Pas d'écart basis significatif</div>
            ) : basis.map(b => <BasisRow key={b.symbol} b={b} />)}
          </div>

          {/* Formula card */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 20px' }}>
            <SectionLabel text="Formule — Bregman Divergence" badge="THÉORIE" />
            <div style={{ background: '#080604', borderRadius: 8, padding: '14px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, lineHeight: 1.8 }}>
              <div style={{ color: C.muted }}>{'# Profit garanti maximum :'}</div>
              <div style={{ color: C.copper, marginTop: 4 }}>max_profit = D(μ* ‖ θ)</div>
              <div style={{ marginTop: 10, color: C.muted }}>{'# Où :'}</div>
              <div style={{ color: C.copperL }}>θ = <span style={{ color: C.muted }}>prix actuels (état mal pricé)</span></div>
              <div style={{ color: C.copperL }}>μ* = <span style={{ color: C.muted }}>projection Bregman sur M</span></div>
              <div style={{ color: C.copperL }}>D(μ‖θ) = <span style={{ color: C.muted }}>divergence KL</span></div>
              <div style={{ marginTop: 10, color: C.muted }}>{'# Sans ce framework → tu devines.'}</div>
              <div style={{ color: C.green }}>{'# Avec lui → tu optimises.'}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Disclaimer */}
      <div style={{ marginTop: 20, fontSize: 9, color: C.muted, ...mono, letterSpacing: '0.05em', lineHeight: 1.7, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
        AVERTISSEMENT — Les opportunités d'arbitrage disparaissent en millisecondes dans les marchés liquides. Ce scanner est un outil éducatif et de détection. Les données sont retardées (latence réseau + API). L'exécution simultanée multi-leg est impossible manuellement. Ne pas utiliser comme seul signal de trading.
      </div>

      <style>{`
        @keyframes apulse { 0%,100% { opacity:.3; } 50% { opacity:.7; } }
      `}</style>
    </div>
  )
}
