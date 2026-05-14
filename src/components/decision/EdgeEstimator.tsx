// src/components/decision/EdgeEstimator.tsx — AI edge estimator with external signals
import { useState, useEffect, useRef, useCallback } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions as fbFn } from '@/services/firebase/config'

// ── Types ──────────────────────────────────────────────────────────────────

interface MTFSnapshot { globalScore: number; confluence: number; globalSignal: string }
interface WhalePressure { score: number }
interface FngData { value: number; label: string }

interface Props {
  symbol:           string
  mtfSnap:          MTFSnapshot | null
  pressure:         WhalePressure | null
  liqLong1h:        number
  liqShort1h:       number
  isCrypto:         boolean
  ouExcess:         string
  ouRegime:         string
  ouZ:              number
  vmcStatus:        string
  confluenceSignal: string
  fng:              FngData | null
}

interface EdgeSignals {
  currency: string
  deribit: {
    pcRatio: number | null
    maxPain: number | null
    totalCallOI: number
    totalPutOI: number
    bias: string
  } | null
  news: {
    bullish: number
    bearish: number
    important: number
    total: number
    sentiment: string
    headlines: string[]
  }
  trending: {
    rank: number | null
    isHot: boolean
  }
}

interface EdgeResponse {
  probability:  number
  direction:    'LONG' | 'SHORT' | 'NEUTRE'
  horizon:      string
  catalyst:     string
  invalidation: string
  stars:        number
  reasoning:    string
}

// ── Helpers ────────────────────────────────────────────────────────────────

function dirColor(d: string) {
  if (d === 'LONG')  return '#34C759'
  if (d === 'SHORT') return '#FF3B30'
  return '#8E8E93'
}

function Stars({ n }: { n: number }) {
  return (
    <span style={{ letterSpacing: 1, fontSize: 11 }}>
      {[1,2,3,4,5].map(i => (
        <span key={i} style={{ color: i <= n ? '#FF9500' : 'rgba(255,255,255,0.15)' }}>★</span>
      ))}
    </span>
  )
}

function ProbBar({ pct, dir }: { pct: number; dir: string }) {
  const clr = dirColor(dir)
  return (
    <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', width: 90, flexShrink: 0 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: clr, borderRadius: 2, transition: 'width 0.6s ease' }} />
    </div>
  )
}

function buildPrompt(
  symbol: string,
  mtfSnap: MTFSnapshot | null,
  pressure: WhalePressure | null,
  liqLong1h: number, liqShort1h: number,
  isCrypto: boolean,
  ouExcess: string, ouRegime: string, ouZ: number,
  vmcStatus: string, confluenceSignal: string,
  fng: FngData | null,
  ext: EdgeSignals | null,
): string {
  const liqBias = liqLong1h - liqShort1h
  const liqStr  = liqBias > 0
    ? `+$${(liqBias/1e6).toFixed(1)}M (shorts liq'd)`
    : `-$${(Math.abs(liqBias)/1e6).toFixed(1)}M (longs liq'd)`
  const whalePct = isCrypto && pressure ? (pressure.score * 100).toFixed(0) : 'N/A'

  const lines: string[] = [
    `=== INTERNAL INDICATORS ===`,
    `Symbol: ${symbol}`,
    `MTF Score: ${mtfSnap?.globalScore ?? 'N/A'}/100 | Signal: ${mtfSnap?.globalSignal ?? 'N/A'} | Confluence: ${mtfSnap?.confluence ?? 'N/A'}%`,
    `OU Excess: ${ouExcess} | Z-score: ${ouZ.toFixed(2)} | Regime: ${ouRegime}`,
    `VMC: ${vmcStatus} | Confluence Signal: ${confluenceSignal}`,
  ]
  if (isCrypto) lines.push(`Whale Pressure: ${whalePct}% | Liq Bias: ${liqStr}`)
  if (fng) lines.push(`Fear & Greed: ${fng.value} (${fng.label})`)

  if (ext) {
    lines.push(``, `=== EXTERNAL SIGNALS (market has NOT fully priced these) ===`)

    if (ext.deribit) {
      const d = ext.deribit
      lines.push(`OPTIONS MARKET (Deribit smart money):`)
      lines.push(`  Put/Call OI ratio: ${d.pcRatio ?? 'N/A'} → ${d.bias.toUpperCase()}`)
      if (d.maxPain) lines.push(`  Max Pain strike: $${d.maxPain.toLocaleString()} (options sellers want price here)`)
      lines.push(`  Call OI: ${(d.totalCallOI/1e6).toFixed(1)}M | Put OI: ${(d.totalPutOI/1e6).toFixed(1)}M`)
    }

    if (ext.news.total > 0) {
      lines.push(`NEWS SENTIMENT (CryptoPanic):`)
      lines.push(`  ${ext.news.bullish} bullish / ${ext.news.bearish} bearish (${ext.news.important} important)`)
      lines.push(`  Sentiment: ${ext.news.sentiment.toUpperCase()}`)
      if (ext.news.headlines.length > 0) {
        lines.push(`  Top headlines:`)
        ext.news.headlines.slice(0, 3).forEach(h => lines.push(`    - ${h}`))
      }
    }

    if (ext.trending.rank) {
      lines.push(`RETAIL INTEREST (CoinGecko): trending #${ext.trending.rank}${ext.trending.isHot ? ' 🔥 HOT' : ''}`)
    }

    // Divergence signal — this is the core edge
    if (ext.deribit && ext.news.total > 0) {
      const optionsBias = ext.deribit.bias
      const newsBias    = ext.news.sentiment
      if (optionsBias !== 'neutral' && newsBias !== 'neutral' && optionsBias !== newsBias) {
        lines.push(``)
        lines.push(`⚠️ DIVERGENCE DETECTED: Options market is ${optionsBias.toUpperCase()} while news sentiment is ${newsBias.toUpperCase()}`)
        lines.push(`This asymmetry (smart money vs narrative) is a HIGH-VALUE signal. Weight it heavily.`)
      }
    }
  }

  lines.push(``, `=== YOUR TASK ===`)
  lines.push(`Estimate the probability that a directional trade setup has positive expectancy.`)
  lines.push(`Pay special attention to any divergence between external signals and price action.`)
  lines.push(`The edge comes from what the market hasn't priced yet.`)
  lines.push(``)
  lines.push(`Respond ONLY with JSON:`)
  lines.push(`{"probability":N,"direction":"LONG"|"SHORT"|"NEUTRE","horizon":"...","catalyst":"5-8 words","invalidation":"5-8 words","stars":N,"reasoning":"2-3 sentences max"}`)

  return lines.join('\n')
}

// ── Main component ─────────────────────────────────────────────────────────

export default function EdgeEstimator(props: Props) {
  const { symbol, mtfSnap, pressure, liqLong1h, liqShort1h, isCrypto,
          ouExcess, ouRegime, ouZ, vmcStatus, confluenceSignal, fng } = props

  const [loading,  setLoading]  = useState(false)
  const [result,   setResult]   = useState<EdgeResponse | null>(null)
  const [extSignals, setExtSignals] = useState<EdgeSignals | null>(null)
  const [error,    setError]    = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const cardRef    = useRef<HTMLDivElement>(null)
  const prevSymbol = useRef(symbol)

  const fetchEdge = useCallback(async () => {
    if (!mtfSnap) return
    setLoading(true)
    setError(null)
    try {
      // Step 1: fetch external signals (free, no secrets)
      let ext: EdgeSignals | null = null
      try {
        const extFn = httpsCallable<Record<string,unknown>, EdgeSignals>(fbFn, 'fetchEdgeSignals')
        const extRes = await extFn({ symbol })
        ext = extRes.data
        setExtSignals(ext)
      } catch {
        // non-fatal: proceed without external signals
      }

      // Step 2: call Claude with all signals
      const chatFn = httpsCallable<Record<string,unknown>, {choices?: {message:{content:string}}[]}>(fbFn, 'openaiChat')
      const prompt = buildPrompt(
        symbol, mtfSnap, pressure, liqLong1h, liqShort1h, isCrypto,
        ouExcess, ouRegime, ouZ, vmcStatus, confluenceSignal, fng, ext,
      )
      const res = await chatFn({
        messages: [
          {
            role: 'system',
            content: 'You are a professional crypto trading analyst specializing in finding information asymmetries between smart money positioning and retail sentiment. Given market signals, estimate setup edge probability. Be concise and data-driven. Respond ONLY with valid JSON.',
          },
          { role: 'user', content: prompt },
        ],
        model: 'gpt-4o-mini',
        max_tokens: 400,
      })
      const raw     = res.data.choices?.[0]?.message?.content ?? '{}'
      const cleaned = raw.replace(/```json\n?|```\n?/g, '').trim()
      const parsed  = JSON.parse(cleaned) as EdgeResponse
      setResult(parsed)
    } catch (e) {
      setError('Analyse indisponible')
      console.error('[EdgeEstimator]', e)
    } finally {
      setLoading(false)
    }
  }, [symbol, mtfSnap, pressure, liqLong1h, liqShort1h, isCrypto,
      ouExcess, ouRegime, ouZ, vmcStatus, confluenceSignal, fng])

  useEffect(() => {
    if (prevSymbol.current !== symbol) {
      prevSymbol.current = symbol
      setResult(null)
      setExtSignals(null)
    }
    fetchEdge()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol])

  useEffect(() => {
    if (!expanded) return
    function onOutside(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) setExpanded(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [expanded])

  const clr = result ? dirColor(result.direction) : 'var(--tm-accent)'
  const pct = result?.probability ?? 0

  // Detect divergence for badge
  const hasDivergence = extSignals?.deribit && extSignals.news.total > 0
    && extSignals.deribit.bias !== 'neutral'
    && extSignals.news.sentiment !== 'neutral'
    && extSignals.deribit.bias !== extSignals.news.sentiment

  return (
    <div
      ref={cardRef}
      style={{
        position: 'relative',
        background: 'rgba(13,17,35,0.75)',
        backdropFilter: 'blur(12px)',
        borderRadius: 14,
        border: `1px solid ${hasDivergence ? '#FF9500' : clr}25`,
        padding: '10px 14px',
        minWidth: 240,
        maxWidth: 330,
        cursor: 'default',
        boxShadow: `0 0 18px ${hasDivergence ? '#FF9500' : clr}12`,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--tm-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'Syne, sans-serif' }}>
            ⚡ Edge Estimator
          </span>
          {hasDivergence && (
            <span style={{ fontSize: 9, fontWeight: 700, color: '#FF9500', background: 'rgba(255,149,0,0.12)', borderRadius: 4, padding: '1px 5px', border: '1px solid rgba(255,149,0,0.3)' }}>
              DIVERGENCE
            </span>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); fetchEdge() }}
          disabled={loading}
          title="Relancer l'analyse"
          style={{ background: 'none', border: 'none', cursor: loading ? 'default' : 'pointer', color: 'var(--tm-text-muted)', padding: 2, lineHeight: 1 }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
            style={{ display: 'block', animation: loading ? 'edge-spin 1s linear infinite' : 'none' }}>
            <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>

      {/* External signals mini-row (when available) */}
      {extSignals && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          {extSignals.deribit && extSignals.deribit.pcRatio !== null && (
            <span style={{
              fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
              background: extSignals.deribit.bias === 'bullish' ? 'rgba(52,199,89,0.12)' : extSignals.deribit.bias === 'bearish' ? 'rgba(255,59,48,0.12)' : 'rgba(255,255,255,0.06)',
              color: extSignals.deribit.bias === 'bullish' ? '#34C759' : extSignals.deribit.bias === 'bearish' ? '#FF3B30' : '#8E8E93',
              border: '1px solid currentColor', opacity: 0.8,
            }}>
              OPT P/C {extSignals.deribit.pcRatio}
            </span>
          )}
          {extSignals.news.total > 0 && (
            <span style={{
              fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
              background: extSignals.news.sentiment === 'bullish' ? 'rgba(52,199,89,0.12)' : extSignals.news.sentiment === 'bearish' ? 'rgba(255,59,48,0.12)' : 'rgba(255,255,255,0.06)',
              color: extSignals.news.sentiment === 'bullish' ? '#34C759' : extSignals.news.sentiment === 'bearish' ? '#FF3B30' : '#8E8E93',
              border: '1px solid currentColor', opacity: 0.8,
            }}>
              NEWS {extSignals.news.bullish}↑ {extSignals.news.bearish}↓
            </span>
          )}
          {extSignals.trending.rank && (
            <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,149,0,0.12)', color: '#FF9500', border: '1px solid rgba(255,149,0,0.3)' }}>
              🔥 #{extSignals.trending.rank} trending
            </span>
          )}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[100, 70, 85].map((w, i) => (
            <div key={i} style={{ height: 10, borderRadius: 5, background: 'rgba(255,255,255,0.07)', width: `${w}%`, animation: 'edge-pulse 1.5s ease-in-out infinite' }} />
          ))}
        </div>
      )}

      {error && !loading && (
        <div style={{ fontSize: 11, color: '#FF3B30', opacity: 0.8 }}>{error}</div>
      )}

      {result && !loading && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: clr, background: `${clr}18`, borderRadius: 6, padding: '2px 8px', border: `1px solid ${clr}30` }}>
              {result.direction}
            </span>
            <span style={{ fontSize: 16, fontWeight: 800, color: clr, fontFamily: 'JetBrains Mono, monospace' }}>
              {result.probability}%
            </span>
            <ProbBar pct={pct} dir={result.direction} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Stars n={result.stars} />
            <span style={{ fontSize: 11, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
              {result.horizon}
            </span>
          </div>

          <div style={{ fontSize: 11, color: 'var(--tm-text-secondary)', marginBottom: 3, lineHeight: 1.4 }}>
            <span style={{ color: 'var(--tm-text-muted)' }}>Catalyseur · </span>{result.catalyst}
          </div>

          <div style={{ fontSize: 11, color: 'var(--tm-text-secondary)', marginBottom: 6, lineHeight: 1.4 }}>
            <span style={{ color: '#FF3B30', opacity: 0.7 }}>Invalidation · </span>{result.invalidation}
          </div>

          <button
            onClick={() => setExpanded(v => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--tm-text-muted)', padding: 0, display: 'flex', alignItems: 'center', gap: 3 }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
              style={{ transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'none' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
            {expanded ? 'Réduire' : 'Raisonnement'}
          </button>

          {expanded && (
            <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', fontSize: 11, color: 'var(--tm-text-secondary)', lineHeight: 1.6, fontStyle: 'italic' }}>
              {result.reasoning}
            </div>
          )}
        </>
      )}

      <style>{`
        @keyframes edge-spin  { to { transform: rotate(360deg); } }
        @keyframes edge-pulse { 0%,100% { opacity:.4; } 50% { opacity:.8; } }
      `}</style>
    </div>
  )
}
