// src/components/decision/EdgeEstimator.tsx — AI-powered trade edge estimator
import { useState, useEffect, useRef, useCallback } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions as fbFn } from '@/services/firebase/config'

// ── Types ──────────────────────────────────────────────────────────────────

interface MTFSnapshot {
  globalScore: number
  confluence: number
  globalSignal: string
}
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

interface EdgeResponse {
  probability:  number      // 0-100
  direction:    'LONG' | 'SHORT' | 'NEUTRE'
  horizon:      string      // ex: "2-4h"
  catalyst:     string      // primary driver
  invalidation: string      // condition who kills the setup
  stars:        number      // 1-5
  reasoning:    string      // 2-3 sentences
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

// ── Main component ─────────────────────────────────────────────────────────

export default function EdgeEstimator(props: Props) {
  const { symbol, mtfSnap, pressure, liqLong1h, liqShort1h, isCrypto,
          ouExcess, ouRegime, ouZ, vmcStatus, confluenceSignal, fng } = props

  const [loading,  setLoading]  = useState(false)
  const [result,   setResult]   = useState<EdgeResponse | null>(null)
  const [error,    setError]    = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const prevSymbol = useRef(symbol)

  const buildPrompt = useCallback((): string => {
    const liqBias = liqLong1h - liqShort1h
    const liqStr  = liqBias > 0 ? `+$${(liqBias/1e6).toFixed(1)}M (shorts liq'd)` : `-$${(Math.abs(liqBias)/1e6).toFixed(1)}M (longs liq'd)`
    const whalePct = isCrypto && pressure ? (pressure.score * 100).toFixed(0) : 'N/A'

    return [
      `Symbol: ${symbol}`,
      `MTF Score: ${mtfSnap?.globalScore ?? 'N/A'}/100 | Signal: ${mtfSnap?.globalSignal ?? 'N/A'} | Confluence: ${mtfSnap?.confluence ?? 'N/A'}%`,
      `OU Excess: ${ouExcess} | Z-score: ${ouZ.toFixed(2)} | Regime: ${ouRegime}`,
      `VMC: ${vmcStatus} | Confluence Signal: ${confluenceSignal}`,
      isCrypto ? `Whale Pressure: ${whalePct}% | Liq Bias: ${liqStr}` : '',
      fng ? `Fear & Greed: ${fng.value} (${fng.label})` : '',
      '',
      'Based on these signals, estimate:',
      '- probability (0-100) that a directional setup has positive expectancy',
      '- direction: LONG, SHORT, or NEUTRE',
      '- horizon: estimated holding time (e.g. "1-2h", "4-8h", "1-3 days")',
      '- catalyst: primary driver in 5-8 words',
      '- invalidation: condition that kills the setup in 5-8 words',
      '- stars: signal quality 1-5',
      '- reasoning: 2-3 concise sentences explaining the edge',
      '',
      'Respond ONLY with JSON: {"probability":N,"direction":"LONG"|"SHORT"|"NEUTRE","horizon":"...","catalyst":"...","invalidation":"...","stars":N,"reasoning":"..."}',
    ].filter(Boolean).join('\n')
  }, [symbol, mtfSnap, pressure, liqLong1h, liqShort1h, isCrypto, ouExcess, ouRegime, ouZ, vmcStatus, confluenceSignal, fng])

  const fetchEdge = useCallback(async () => {
    if (!mtfSnap) return
    setLoading(true)
    setError(null)
    try {
      const fn = httpsCallable<Record<string,unknown>, {choices?: {message:{content:string}}[]}>(fbFn, 'openaiChat')
      const res = await fn({
        messages: [
          {
            role: 'system',
            content: 'You are a professional trading analyst. Given market signals, estimate the probability that a directional setup has positive expectancy. Be concise and data-driven. Respond ONLY with valid JSON — no markdown, no explanation outside the JSON.',
          },
          { role: 'user', content: buildPrompt() },
        ],
        model: 'gpt-4o-mini',
        max_tokens: 350,
      })
      const raw = res.data.choices?.[0]?.message?.content ?? '{}'
      const cleaned = raw.replace(/```json\n?|```\n?/g, '').trim()
      const parsed = JSON.parse(cleaned) as EdgeResponse
      setResult(parsed)
    } catch (e) {
      setError('Erreur lors de l\'analyse')
      console.error('[EdgeEstimator]', e)
    } finally {
      setLoading(false)
    }
  }, [buildPrompt, mtfSnap])

  // Auto-fetch when symbol changes or on mount
  useEffect(() => {
    if (prevSymbol.current !== symbol) {
      prevSymbol.current = symbol
      setResult(null)
    }
    fetchEdge()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol])

  // Close expanded panel on outside click
  useEffect(() => {
    if (!expanded) return
    function onOutside(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setExpanded(false)
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [expanded])

  const clr  = result ? dirColor(result.direction) : 'var(--tm-accent)'
  const pct  = result?.probability ?? 0

  return (
    <div
      ref={cardRef}
      style={{
        position: 'relative',
        background: 'rgba(13,17,35,0.75)',
        backdropFilter: 'blur(12px)',
        borderRadius: 14,
        border: `1px solid ${clr}25`,
        padding: '10px 14px',
        minWidth: 230,
        maxWidth: 320,
        cursor: 'default',
        boxShadow: `0 0 18px ${clr}12`,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--tm-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'Syne, sans-serif' }}>
          ⚡ Edge Estimator
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); fetchEdge() }}
          disabled={loading}
          title="Relancer l'analyse"
          style={{
            background: 'none', border: 'none', cursor: loading ? 'default' : 'pointer',
            color: 'var(--tm-text-muted)', padding: 2, lineHeight: 1,
            transition: 'transform 0.3s',
            transform: loading ? 'rotate(360deg)' : 'none',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ display: 'block', animation: loading ? 'spin 1s linear infinite' : 'none' }}>
            <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>

      {/* Loading skeleton */}
      {loading && !result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[100, 70, 85].map((w, i) => (
            <div key={i} style={{ height: 10, borderRadius: 5, background: 'rgba(255,255,255,0.07)', width: `${w}%`, animation: 'pulse 1.5s ease-in-out infinite' }} />
          ))}
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div style={{ fontSize: 11, color: '#FF3B30', opacity: 0.8 }}>{error}</div>
      )}

      {/* Result */}
      {result && !loading && (
        <>
          {/* Direction + probability row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{
              fontSize: 12, fontWeight: 700, color: clr,
              background: `${clr}18`, borderRadius: 6, padding: '2px 8px',
              border: `1px solid ${clr}30`,
            }}>
              {result.direction}
            </span>
            <span style={{ fontSize: 16, fontWeight: 800, color: clr, fontFamily: 'JetBrains Mono, monospace' }}>
              {result.probability}%
            </span>
            <ProbBar pct={pct} dir={result.direction} />
          </div>

          {/* Stars + horizon */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Stars n={result.stars} />
            <span style={{ fontSize: 11, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
              {result.horizon}
            </span>
          </div>

          {/* Catalyst */}
          <div style={{ fontSize: 11, color: 'var(--tm-text-secondary)', marginBottom: 3, lineHeight: 1.4 }}>
            <span style={{ color: 'var(--tm-text-muted)' }}>Catalyseur · </span>
            {result.catalyst}
          </div>

          {/* Invalidation */}
          <div style={{ fontSize: 11, color: 'var(--tm-text-secondary)', marginBottom: 6, lineHeight: 1.4 }}>
            <span style={{ color: '#FF3B30', opacity: 0.7 }}>Invalidation · </span>
            {result.invalidation}
          </div>

          {/* Detail toggle */}
          <button
            onClick={() => setExpanded(v => !v)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 10, color: 'var(--tm-text-muted)', padding: 0,
              display: 'flex', alignItems: 'center', gap: 3,
              transition: 'color 0.15s',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
              style={{ transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'none' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
            {expanded ? 'Réduire' : 'Raisonnement'}
          </button>

          {/* Expanded reasoning */}
          {expanded && (
            <div style={{
              marginTop: 8,
              padding: '8px 10px',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.06)',
              fontSize: 11,
              color: 'var(--tm-text-secondary)',
              lineHeight: 1.6,
              fontStyle: 'italic',
            }}>
              {result.reasoning}
            </div>
          )}
        </>
      )}

      {/* CSS animations */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:.4; } 50% { opacity:.8; } }
      `}</style>
    </div>
  )
}
