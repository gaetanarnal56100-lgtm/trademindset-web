// src/pages/arbitrage/ArbitragePage.tsx — Mispricing Scanner
// Polymarket YES+NO consistency + Crypto triangular arb + Futures basis
import { useState, useEffect, useCallback, useRef } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

interface PolyMarket {
  id: string
  question: string
  volume: number
  liquidity: number
  outcomes: string[]
  prices: number[]
  sum: number
  edge: number       // 1 - sum; positive = mispricing
  endDate: string
  url: string
}

interface TriangleArb {
  id: string
  name: string           // e.g. "ETH via BTC"
  actual: number         // ETH/USDT spot
  implied: number        // BTC/USDT × ETH/BTC
  spread: number         // % difference
  direction: string      // which leg is cheap
}

interface BasisOpp {
  symbol: string
  spotPrice: number
  perpPrice: number
  basis: number          // (perp - spot) / spot * 100
  fundingRate: number    // per 8h %
  annualizedFunding: number
  signal: 'long_basis' | 'short_basis' | 'neutral'
}

// ── Constants ─────────────────────────────────────────────────────────────

// Triangular pairs: base/quote × quote/USDT vs base/USDT
const TRIANGLES = [
  { base: 'ETH', quote: 'BTC' },
  { base: 'BNB', quote: 'BTC' },
  { base: 'SOL', quote: 'BTC' },
  { base: 'XRP', quote: 'BTC' },
  { base: 'BNB', quote: 'ETH' },
  { base: 'SOL', quote: 'ETH' },
  { base: 'AVAX', quote: 'BTC' },
  { base: 'MATIC', quote: 'BTC' },
]

const PERP_SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'AVAX', 'ARB', 'OP']

// Fees: Binance taker 0.1% per leg, 3 legs = 0.3% min threshold for triangle
const TRI_FEE_THRESHOLD = 0.15  // show if > 0.15% (after partial fees)
// Polymarket: ~1% total fees; show if edge > 0.5%
const POLY_FEE_THRESHOLD = 0.005

// ── Helpers ────────────────────────────────────────────────────────────────

function edgeColor(pct: number, thres: number) {
  if (pct > thres * 3)  return '#34C759'
  if (pct > thres * 1.5) return '#FF9500'
  return '#8E8E93'
}

function fmt(n: number, dec = 2) { return n.toFixed(dec) }
function fmtM(n: number) {
  if (n >= 1e6) return `$${(n/1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n/1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function EdgeBadge({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
      color, background: `${color}18`, border: `1px solid ${color}35`,
      borderRadius: 6, padding: '2px 8px',
    }}>
      {label} {value}
    </span>
  )
}

function SectionHeader({ title, count, accent }: { title: string; count: number; accent: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--tm-text-primary)', fontFamily: 'Syne, sans-serif' }}>
        {title}
      </span>
      {count > 0 && (
        <span style={{ fontSize: 11, fontWeight: 700, color: accent, background: `${accent}18`, borderRadius: 20, padding: '1px 8px', border: `1px solid ${accent}30` }}>
          {count}
        </span>
      )}
    </div>
  )
}

// ── Fetch functions ────────────────────────────────────────────────────────

async function fetchPolymarketOpps(): Promise<PolyMarket[]> {
  const r = await fetch(
    'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=100&order=volume&ascending=false',
    { signal: AbortSignal.timeout(8000) }
  )
  if (!r.ok) throw new Error('Polymarket API failed')
  const data = await r.json() as {
    id: string; question: string; volume: number; liquidity: number;
    outcomePrices: string; outcomes: string; endDate: string;
    conditionId?: string;
  }[]

  return data
    .map(m => {
      let prices: number[] = []
      let outcomes: string[] = []
      try { prices  = JSON.parse(m.outcomePrices).map(Number) } catch { return null }
      try { outcomes = JSON.parse(m.outcomes) } catch { outcomes = prices.map((_, i) => `Outcome ${i+1}`) }
      const sum  = prices.reduce((a, b) => a + b, 0)
      const edge = 1 - sum
      return { id: m.id, question: m.question, volume: m.volume || 0, liquidity: m.liquidity || 0, outcomes, prices, sum, edge, endDate: m.endDate || '', url: `https://polymarket.com/event/${m.id}` }
    })
    .filter((m): m is PolyMarket => m !== null && m.edge > POLY_FEE_THRESHOLD && m.prices.length >= 2 && m.liquidity > 500)
    .sort((a, b) => b.edge - a.edge)
    .slice(0, 30)
}

async function fetchCryptoData(): Promise<{ triangles: TriangleArb[]; basis: BasisOpp[] }> {
  // Fetch all spot prices in one call
  const [spotRes, perpRes, fundingRes] = await Promise.all([
    fetch('https://api.binance.com/api/v3/ticker/price', { signal: AbortSignal.timeout(6000) }),
    fetch('https://fapi.binance.com/fapi/v1/ticker/price', { signal: AbortSignal.timeout(6000) }),
    fetch('https://fapi.binance.com/fapi/v1/premiumIndex', { signal: AbortSignal.timeout(6000) }),
  ])

  const spotAll:    { symbol: string; price: string }[] = spotRes.ok    ? await spotRes.json()    : []
  const perpAll:    { symbol: string; price: string }[] = perpRes.ok    ? await perpRes.json()    : []
  const fundingAll: { symbol: string; lastFundingRate: string; markPrice: string }[] = fundingRes.ok ? await fundingRes.json() : []

  const spot:    Record<string, number> = {}
  const perp:    Record<string, number> = {}
  const funding: Record<string, number> = {}

  spotAll.forEach(t    => { spot[t.symbol]    = parseFloat(t.price) })
  perpAll.forEach(t    => { perp[t.symbol]    = parseFloat(t.price) })
  fundingAll.forEach(t => { funding[t.symbol] = parseFloat(t.lastFundingRate) })

  // ── Triangular arb ──────────────────────────────────────────────────────
  const triangles: TriangleArb[] = []
  for (const { base, quote } of TRIANGLES) {
    const baseUSDT  = spot[`${base}USDT`]
    const quoteUSDT = spot[`${quote}USDT`]
    const baseQuote = spot[`${base}${quote}`]

    if (!baseUSDT || !quoteUSDT || !baseQuote) continue

    const implied = quoteUSDT * baseQuote
    const spread  = Math.abs(implied - baseUSDT) / baseUSDT * 100

    if (spread > TRI_FEE_THRESHOLD) {
      triangles.push({
        id: `${base}-${quote}`,
        name: `${base} via ${quote}`,
        actual: baseUSDT,
        implied,
        spread,
        direction: implied > baseUSDT
          ? `Buy ${base}/USDT, Sell ${base}/${quote} + ${quote}/USDT`
          : `Buy ${base}/${quote} + ${quote}/USDT, Sell ${base}/USDT`,
      })
    }
  }
  triangles.sort((a, b) => b.spread - a.spread)

  // ── Futures basis ────────────────────────────────────────────────────────
  const basis: BasisOpp[] = []
  for (const sym of PERP_SYMBOLS) {
    const spotPrice = spot[`${sym}USDT`]
    const perpPrice = perp[`${sym}USDT`]
    const fr        = funding[`${sym}USDT`] ?? 0

    if (!spotPrice || !perpPrice) continue

    const basisPct          = (perpPrice - spotPrice) / spotPrice * 100
    const annualizedFunding = fr * 3 * 365 * 100  // 3 funding events/day

    let signal: BasisOpp['signal'] = 'neutral'
    if (basisPct > 0.3 && fr > 0.0001)  signal = 'short_basis'  // perp expensive, funding positive → short perp
    if (basisPct < -0.3 && fr < -0.0001) signal = 'long_basis'  // perp cheap, funding negative → long perp

    if (signal !== 'neutral') {
      basis.push({ symbol: sym, spotPrice, perpPrice, basis: basisPct, fundingRate: fr * 100, annualizedFunding, signal })
    }
  }
  basis.sort((a, b) => Math.abs(b.basis) - Math.abs(a.basis))

  return { triangles, basis }
}

// ── Row components ─────────────────────────────────────────────────────────

function PolyRow({ m }: { m: PolyMarket }) {
  const edgePct = m.edge * 100
  const clr     = edgeColor(m.edge, POLY_FEE_THRESHOLD)

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr auto',
      gap: 8, padding: '10px 12px',
      borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)',
      background: 'rgba(255,255,255,0.02)',
      marginBottom: 6,
    }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tm-text-primary)', lineHeight: 1.4, marginBottom: 4 }}>
          {m.question.length > 80 ? m.question.slice(0, 80) + '…' : m.question}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {m.outcomes.slice(0, 3).map((o, i) => (
            <span key={i} style={{ fontSize: 10, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
              {o}: <strong style={{ color: 'var(--tm-text-secondary)' }}>${fmt(m.prices[i] ?? 0, 3)}</strong>
            </span>
          ))}
          <span style={{ fontSize: 10, color: 'var(--tm-text-muted)' }}>
            Σ = <strong style={{ color: m.sum < 0.97 ? '#34C759' : 'var(--tm-text-secondary)' }}>{fmt(m.sum, 3)}</strong>
          </span>
          <span style={{ fontSize: 10, color: 'var(--tm-text-muted)' }}>Vol {fmtM(m.volume)}</span>
          <span style={{ fontSize: 10, color: 'var(--tm-text-muted)' }}>Liq {fmtM(m.liquidity)}</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, minWidth: 80 }}>
        <EdgeBadge value={`+${fmt(edgePct, 2)}%`} label="EDGE" color={clr} />
        <a
          href={m.url} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 10, color: 'var(--tm-accent)', textDecoration: 'none', opacity: 0.7 }}
        >
          Voir →
        </a>
      </div>
    </div>
  )
}

function TriRow({ t }: { t: TriangleArb }) {
  const clr = edgeColor(t.spread / 100, TRI_FEE_THRESHOLD / 100)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', marginBottom: 6 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tm-text-primary)', marginBottom: 4 }}>
          {t.name}
        </div>
        <div style={{ fontSize: 10, color: 'var(--tm-text-muted)', marginBottom: 2, fontFamily: 'JetBrains Mono, monospace' }}>
          Actual: <strong style={{ color: 'var(--tm-text-secondary)' }}>${fmt(t.actual, t.actual > 100 ? 2 : 4)}</strong>
          &nbsp;·&nbsp;
          Implied: <strong style={{ color: 'var(--tm-text-secondary)' }}>${fmt(t.implied, t.implied > 100 ? 2 : 4)}</strong>
        </div>
        <div style={{ fontSize: 10, color: 'var(--tm-text-muted)', lineHeight: 1.4 }}>
          → {t.direction}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, minWidth: 80 }}>
        <EdgeBadge value={`${fmt(t.spread, 3)}%`} label="Δ" color={clr} />
        <span style={{ fontSize: 9, color: 'var(--tm-text-muted)' }}>3-leg arb</span>
      </div>
    </div>
  )
}

function BasisRow({ b }: { b: BasisOpp }) {
  const isShort = b.signal === 'short_basis'
  const clr = isShort ? '#FF3B30' : '#34C759'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', marginBottom: 6 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tm-text-primary)', marginBottom: 4 }}>
          {b.symbol}/USDT — {isShort ? 'Short Perp' : 'Long Perp'}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
            Spot <strong style={{ color: 'var(--tm-text-secondary)' }}>${fmt(b.spotPrice, b.spotPrice > 100 ? 2 : 4)}</strong>
          </span>
          <span style={{ fontSize: 10, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
            Perp <strong style={{ color: 'var(--tm-text-secondary)' }}>${fmt(b.perpPrice, b.perpPrice > 100 ? 2 : 4)}</strong>
          </span>
          <span style={{ fontSize: 10, color: 'var(--tm-text-muted)' }}>
            Funding <strong style={{ color: b.fundingRate > 0 ? '#FF9500' : '#34C759' }}>{fmt(b.fundingRate, 4)}%/8h</strong>
          </span>
          <span style={{ fontSize: 10, color: 'var(--tm-text-muted)' }}>
            ~{fmt(b.annualizedFunding, 0)}%/yr
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, minWidth: 90 }}>
        <EdgeBadge value={`${b.basis > 0 ? '+' : ''}${fmt(b.basis, 3)}%`} label="BASIS" color={clr} />
        <span style={{ fontSize: 9, color: clr, opacity: 0.7 }}>{isShort ? '↓ short perp' : '↑ long perp'}</span>
      </div>
    </div>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────

function EmptyState({ label }: { label: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--tm-text-muted)', fontSize: 12 }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>✓</div>
      {label}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function ArbitragePage() {
  const [polyOpps,   setPolyOpps]   = useState<PolyMarket[]>([])
  const [triangles,  setTriangles]  = useState<TriangleArb[]>([])
  const [basis,      setBasis]      = useState<BasisOpp[]>([])
  const [loading,    setLoading]    = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [error,      setError]      = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [poly, crypto] = await Promise.allSettled([
        fetchPolymarketOpps(),
        fetchCryptoData(),
      ])
      if (poly.status === 'fulfilled')    setPolyOpps(poly.value)
      else console.warn('[Arbitrage] Polymarket:', poly.reason)

      if (crypto.status === 'fulfilled') {
        setTriangles(crypto.value.triangles)
        setBasis(crypto.value.basis)
      } else console.warn('[Arbitrage] Crypto:', crypto.reason)

      setLastUpdate(new Date())
    } catch (e) {
      setError('Erreur de chargement')
      console.error('[Arbitrage]', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!autoRefresh) { if (intervalRef.current) clearInterval(intervalRef.current); return }
    intervalRef.current = setInterval(refresh, 60_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [autoRefresh, refresh])

  const totalOpps = polyOpps.length + triangles.length + basis.length

  return (
    <div style={{ padding: '24px 28px', minHeight: '100vh', color: 'var(--tm-text-primary)', maxWidth: 1400, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, fontFamily: 'Syne, sans-serif', color: 'var(--tm-text-primary)' }}>
            🔍 Mispricing Scanner
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--tm-text-muted)' }}>
            Inconsistances mathématiques : Polymarket YES+NO · Triangulaire crypto · Basis futures
            {lastUpdate && (
              <span style={{ marginLeft: 10, opacity: 0.6 }}>
                · maj {lastUpdate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {totalOpps > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#34C759', background: 'rgba(52,199,89,0.12)', borderRadius: 20, padding: '3px 10px', border: '1px solid rgba(52,199,89,0.3)' }}>
              {totalOpps} opportunities
            </span>
          )}
          <button
            onClick={() => setAutoRefresh(v => !v)}
            style={{
              fontSize: 11, padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
              background: autoRefresh ? 'rgba(0,229,255,0.1)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${autoRefresh ? 'rgba(0,229,255,0.3)' : 'rgba(255,255,255,0.1)'}`,
              color: autoRefresh ? 'var(--tm-accent)' : 'var(--tm-text-muted)',
            }}
          >
            {autoRefresh ? '⏱ Auto 60s' : '⏱ Manuel'}
          </button>
          <button
            onClick={refresh}
            disabled={loading}
            style={{
              fontSize: 11, padding: '5px 12px', borderRadius: 8, cursor: loading ? 'default' : 'pointer',
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--tm-text-secondary)',
            }}
          >
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Explainer banner */}
      <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(0,229,255,0.05)', border: '1px solid rgba(0,229,255,0.1)', marginBottom: 24, fontSize: 11, color: 'var(--tm-text-muted)', lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--tm-text-secondary)' }}>Comment ça marche :</strong>
        {' '}Sur Polymarket, YES + NO devrait toujours = $1.00. Si la somme est &lt; $1, l'écart est un profit garanti si tu peux acheter les deux.
        En crypto, les prix de trois paires corrélées (ex: BTC/USDT × ETH/BTC ≈ ETH/USDT) doivent être cohérents.
        Les incohérences sont éphémères — les systèmes quant les capturent en millisecondes.
        <strong style={{ color: 'var(--tm-accent)' }}> Ceci est un outil de détection, pas d'exécution automatique.</strong>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.2)', marginBottom: 16, fontSize: 12, color: '#FF3B30' }}>
          {error}
        </div>
      )}

      {/* Two-column grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 20 }}>

        {/* ── Polymarket ── */}
        <div style={{ background: 'rgba(13,17,35,0.6)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.07)', padding: '16px' }}>
          <SectionHeader title="🎯 Polymarket — YES+NO ≠ $1" count={polyOpps.length} accent="#BF5AF2" />
          <p style={{ fontSize: 10, color: 'var(--tm-text-muted)', marginBottom: 12, marginTop: -8 }}>
            Marchés où la somme des issues est &lt; $1 (top par volume, liq &gt; $500)
          </p>
          {loading && polyOpps.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[1,2,3,4].map(i => (
                <div key={i} style={{ height: 68, borderRadius: 8, background: 'rgba(255,255,255,0.04)', animation: 'arb-pulse 1.4s ease-in-out infinite' }} />
              ))}
            </div>
          ) : polyOpps.length === 0 ? (
            <EmptyState label="Aucune incohérence détectée (marchés correctement pricés)" />
          ) : (
            polyOpps.map(m => <PolyRow key={m.id} m={m} />)
          )}
        </div>

        {/* ── Crypto ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Triangular */}
          <div style={{ background: 'rgba(13,17,35,0.6)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.07)', padding: '16px' }}>
            <SectionHeader title="🔺 Arbitrage Triangulaire" count={triangles.length} accent="#0A85FF" />
            <p style={{ fontSize: 10, color: 'var(--tm-text-muted)', marginBottom: 12, marginTop: -8 }}>
              Incohérence entre paires corrélées · seuil &gt; {TRI_FEE_THRESHOLD}% (après fees Binance)
            </p>
            {loading && triangles.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[1,2].map(i => <div key={i} style={{ height: 68, borderRadius: 8, background: 'rgba(255,255,255,0.04)', animation: 'arb-pulse 1.4s ease-in-out infinite' }} />)}
              </div>
            ) : triangles.length === 0 ? (
              <EmptyState label="Aucun arbitrage triangulaire détecté" />
            ) : (
              triangles.map(t => <TriRow key={t.id} t={t} />)
            )}
          </div>

          {/* Basis */}
          <div style={{ background: 'rgba(13,17,35,0.6)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.07)', padding: '16px' }}>
            <SectionHeader title="📈 Basis Futures · Spot" count={basis.length} accent="#FF9500" />
            <p style={{ fontSize: 10, color: 'var(--tm-text-muted)', marginBottom: 12, marginTop: -8 }}>
              Perp premium/discount &gt; 0.3% + funding aligné → mean reversion prévisible
            </p>
            {loading && basis.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[1,2].map(i => <div key={i} style={{ height: 68, borderRadius: 8, background: 'rgba(255,255,255,0.04)', animation: 'arb-pulse 1.4s ease-in-out infinite' }} />)}
              </div>
            ) : basis.length === 0 ? (
              <EmptyState label="Pas d'écart basis/funding significatif" />
            ) : (
              basis.map(b => <BasisRow key={b.symbol} b={b} />)
            )}
          </div>

        </div>
      </div>

      {/* Disclaimer */}
      <div style={{ marginTop: 24, padding: '10px 14px', borderRadius: 8, background: 'rgba(255,149,0,0.05)', border: '1px solid rgba(255,149,0,0.15)', fontSize: 10, color: 'var(--tm-text-muted)', lineHeight: 1.6 }}>
        ⚠️ <strong>Avertissement :</strong> Les opportunités d'arbitrage disparaissent en millisecondes dans les marchés liquides. Ce scanner détecte des incohérences ponctuelles mais ne garantit pas l'exécutabilité. Les données sont retardées (latence réseau + API). Ne pas utiliser comme seul signal de trading.
        Les arbitrages triangulaires nécessitent une exécution simultanée multi-leg impossible manuellement sur Binance standard.
      </div>

      <style>{`
        @keyframes arb-pulse { 0%,100% { opacity:.3; } 50% { opacity:.6; } }
      `}</style>
    </div>
  )
}
