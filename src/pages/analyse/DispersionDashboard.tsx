/**
 * Dispersion Analysis Dashboard
 * Institutional-grade market internals visualizer
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchAndCompute } from '@/services/dispersion/dispersionEngine'
import type { DispersionResult, DispersionRegime } from '@/services/dispersion/types'
import { CRYPTO_BASKET, DEFI_BASKET, L2_BASKET } from '@/services/dispersion/types'
import type { AssetConfig } from '@/services/dispersion/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const REGIME_META: Record<DispersionRegime, { label: string; color: string; icon: string; desc: string }> = {
  compression: {
    label: 'Compression', color: '#00E5FF', icon: '🌀',
    desc: 'Faible dispersion + forte corrélation. Mouvement macro imminent. Surveiller breakout.',
  },
  expansion: {
    label: 'Expansion', color: '#BF5AF2', icon: '💥',
    desc: 'Forte dispersion + faible corrélation. Environnement stock-picking. Leaders/laggards distincts.',
  },
  panic: {
    label: 'Panique', color: '#FF3B30', icon: '🚨',
    desc: 'Haute dispersion + fort vol + faible participation. Capitulation potentielle.',
  },
  trending: {
    label: 'Tendance', color: '#34C759', icon: '📈',
    desc: 'Faible dispersion, haute participation. Mouvement directionnel fort. Momentum favorable.',
  },
  rotating: {
    label: 'Rotation', color: '#FF9500', icon: '🔄',
    desc: 'Rotation sectorielle active. Capital circule entre leaders et laggards.',
  },
  unknown: { label: 'Analyse…', color: '#8E8E93', icon: '⏳', desc: 'Données insuffisantes.' },
}

const BASKETS = [
  { id: 'crypto', label: '🪙 Crypto', configs: CRYPTO_BASKET },
  { id: 'defi', label: '🏦 DeFi', configs: DEFI_BASKET },
  { id: 'l2', label: '⚡ Layer 2', configs: L2_BASKET },
]

const INTERVALS = [
  { id: '15m', label: '15m' }, { id: '1h', label: '1h' },
  { id: '4h', label: '4h' }, { id: '1d', label: '1D' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPct(v: number, decimals = 2) {
  return `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`
}

function fmtVol(v: number) { return `${(v * 100).toFixed(1)}%` }

// ─── Sub-components ───────────────────────────────────────────────────────────

function Gauge({
  value, min = 0, max = 100, label, color, size = 80,
}: { value: number; min?: number; max?: number; label: string; color: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr; canvas.height = (size * 0.6) * dpr
    const ctx = canvas.getContext('2d')!; ctx.scale(dpr, dpr)
    const cx = size / 2, cy = size * 0.55
    const r = size * 0.38
    const startA = Math.PI, endA = 2 * Math.PI
    const pct = Math.max(0, Math.min(1, (value - min) / (max - min)))
    const valueA = startA + pct * Math.PI

    // Track
    ctx.beginPath(); ctx.arc(cx, cy, r, startA, endA)
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.stroke()
    // Fill
    ctx.beginPath(); ctx.arc(cx, cy, r, startA, valueA)
    ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.stroke()
    // Center text
    ctx.fillStyle = color; ctx.font = `bold ${size * 0.18}px JetBrains Mono, monospace`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(Math.round(value).toString(), cx, cy - 4)
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = `${size * 0.1}px Syne, sans-serif`
    ctx.fillText(label, cx, cy + size * 0.12)
  }, [value, min, max, color, size, label])
  return <canvas ref={ref} style={{ width: size, height: size * 0.6 }} />
}

function CorrelationHeatmap({
  matrix, labels, size = 200,
}: { matrix: number[][]; labels: string[]; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return
    const N = labels.length; if (!N) return
    const dpr = window.devicePixelRatio || 1
    const cellSize = Math.floor(size / (N + 1))
    const W = cellSize * (N + 1), H = cellSize * (N + 1)
    canvas.width = W * dpr; canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!; ctx.scale(dpr, dpr)
    ctx.fillStyle = '#080C14'; ctx.fillRect(0, 0, W, H)

    const corrColor = (v: number): string => {
      // -1 = red, 0 = dark, +1 = cyan
      if (v > 0) {
        const t = v; return `rgba(0,${Math.round(200 * t)},${Math.round(255 * t)},${0.3 + 0.7 * t})`
      } else {
        const t = -v; return `rgba(${Math.round(255 * t)},${Math.round(60 * (1 - t))},${Math.round(48 * t)},${0.3 + 0.7 * t})`
      }
    }

    // Labels row/col
    ctx.font = `bold ${cellSize * 0.4}px JetBrains Mono, monospace`
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    labels.forEach((lbl, i) => {
      const x = cellSize * (i + 1) + cellSize / 2
      ctx.fillText(lbl.slice(0, 4), x, cellSize / 2)
      ctx.fillText(lbl.slice(0, 4), cellSize / 2, cellSize * (i + 1) + cellSize / 2)
    })

    // Cells
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const v = matrix[i]?.[j] ?? 0
        const x = cellSize * (j + 1), y = cellSize * (i + 1)
        ctx.fillStyle = corrColor(v); ctx.fillRect(x, y, cellSize, cellSize)
        if (cellSize > 24) {
          ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = `${cellSize * 0.35}px JetBrains Mono, monospace`
          ctx.fillText(v.toFixed(2), x + cellSize / 2, y + cellSize / 2)
        }
      }
    }
  }, [matrix, labels, size])
  return (
    <canvas ref={ref}
      style={{ width: size + Math.floor(size / (labels.length + 1)), height: size + Math.floor(size / (labels.length + 1)), borderRadius: 8 }} />
  )
}

function BreadthBar({ label, value, max = 100, color, subtitle }: {
  label: string; value: number; max?: number; color: string; subtitle?: string
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', fontFamily: 'Syne, sans-serif' }}>{label}</span>
        <span style={{ fontSize: 10, color, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
          {subtitle ?? `${value.toFixed(1)}%`}
        </span>
      </div>
      <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`, background: color, borderRadius: 3,
          transition: 'width 0.6s ease', boxShadow: `0 0 8px ${color}60`,
        }} />
      </div>
    </div>
  )
}

function ComponentTable({ components }: { components: DispersionResult['components'] }) {
  const sorted = [...components].sort((a, b) => b.return1d - a.return1d)
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            {['Asset', '1D', '5D', 'Vol', 'RSI', 'EMA20', 'VWAP', 'Z-Score', 'vs Basket'].map(h => (
              <th key={h} style={{ padding: '4px 8px', color: 'rgba(255,255,255,0.4)', textAlign: 'right', fontWeight: 600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(c => {
            const r1Color = c.return1d >= 0 ? '#34C759' : '#FF3B30'
            const r5Color = c.return5d >= 0 ? '#34C759' : '#FF3B30'
            const rsiColor = c.rsi14 > 70 ? '#FF3B30' : c.rsi14 < 30 ? '#34C759' : 'rgba(255,255,255,0.7)'
            return (
              <tr key={c.symbol} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td style={{ padding: '5px 8px', color: '#00E5FF', fontWeight: 700 }}>{c.label}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: r1Color }}>
                  {fmtPct(c.return1d * 100)}
                </td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: r5Color }}>
                  {fmtPct(c.return5d * 100)}
                </td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: 'rgba(255,255,255,0.6)' }}>
                  {fmtVol(c.realizedVol)}
                </td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: rsiColor }}>
                  {c.rsi14.toFixed(0)}
                </td>
                <td style={{ padding: '5px 8px', textAlign: 'center', color: c.aboveEma20 ? '#34C759' : '#FF3B30' }}>
                  {c.aboveEma20 ? '✓' : '✗'}
                </td>
                <td style={{ padding: '5px 8px', textAlign: 'center', color: c.aboveVwap ? '#34C759' : '#FF3B30' }}>
                  {c.aboveVwap ? '✓' : '✗'}
                </td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: c.zScore > 1 ? '#FF9500' : c.zScore < -1 ? '#42A5F5' : 'rgba(255,255,255,0.5)' }}>
                  {c.zScore >= 0 ? '+' : ''}{c.zScore.toFixed(2)}σ
                </td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: c.divergenceFromBasket >= 0 ? '#34C759' : '#FF3B30' }}>
                  {fmtPct(c.divergenceFromBasket * 100)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ScatterPlot({
  components, size = 300,
}: { components: DispersionResult['components']; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current; if (!canvas || !components.length) return
    const dpr = window.devicePixelRatio || 1
    const W = size, H = size * 0.7
    canvas.width = W * dpr; canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!; ctx.scale(dpr, dpr)
    ctx.fillStyle = '#080C14'; ctx.fillRect(0, 0, W, H)

    // Axes
    const pad = 40
    const returns = components.map(c => c.return1d)
    const vols = components.map(c => c.realizedVol)
    const xMin = Math.min(...returns), xMax = Math.max(...returns)
    const yMin = Math.min(...vols), yMax = Math.max(...vols)
    const xRange = xMax - xMin || 0.01, yRange = yMax - yMin || 0.01

    const toX = (r: number) => pad + ((r - xMin) / xRange) * (W - pad * 2)
    const toY = (v: number) => H - pad - ((v - yMin) / yRange) * (H - pad * 2)

    // Zero line
    const zeroX = toX(0)
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3])
    ctx.beginPath(); ctx.moveTo(zeroX, pad); ctx.lineTo(zeroX, H - pad); ctx.stroke()
    ctx.setLineDash([])

    // Axis labels
    ctx.font = '8px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.textAlign = 'center'; ctx.fillText('Return →', W / 2, H - 5)
    ctx.save(); ctx.translate(12, H / 2); ctx.rotate(-Math.PI / 2)
    ctx.fillText('Vol ↑', 0, 0); ctx.restore()

    // Points
    components.forEach(c => {
      const x = toX(c.return1d), y = toY(c.realizedVol)
      const color = c.return1d >= 0 ? '#34C759' : '#FF3B30'
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2)
      ctx.fillStyle = color + '50'; ctx.fill()
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke()
      // Label
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = 'bold 8px JetBrains Mono, monospace'
      ctx.textAlign = 'center'; ctx.fillText(c.label, x, y - 10)
    })
  }, [components, size])
  return <canvas ref={ref} style={{ width: size, height: size * 0.7, borderRadius: 8, display: 'block' }} />
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function DispersionDashboard() {
  const [basketId, setBasketId] = useState('crypto')
  const [interval, setInterval] = useState('1h')
  const [result, setResult] = useState<DispersionResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeView, setActiveView] = useState<'overview' | 'correlation' | 'components' | 'scatter'>('overview')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const currentBasket = BASKETS.find(b => b.id === basketId)?.configs ?? CRYPTO_BASKET

  const load = useCallback(async (configs: AssetConfig[], tf: string) => {
    setLoading(true); setError('')
    try {
      const res = await fetchAndCompute(configs, tf, 150)
      if (res) setResult(res)
      else setError('Données insuffisantes pour le panier sélectionné')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load + interval
  useEffect(() => {
    load(currentBasket, interval)
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => load(currentBasket, interval), 60_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [basketId, interval, load, currentBasket])

  const regime = result ? REGIME_META[result.regime] : null

  // ── Styles ──
  const card = (extra?: React.CSSProperties): React.CSSProperties => ({
    background: 'rgba(13,17,35,0.7)', backdropFilter: 'blur(12px)',
    borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)',
    padding: '12px 14px', ...extra,
  })
  const sectionTitle = (color = '#00E5FF'): React.CSSProperties => ({
    fontSize: 10, fontWeight: 700, color, letterSpacing: 1.5,
    textTransform: 'uppercase' as const, fontFamily: 'Syne, sans-serif',
    marginBottom: 10,
  })

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#00E5FF', fontFamily: 'Syne', flex: 1 }}>
          📊 Dispersion Analysis
        </span>

        {/* Basket selector */}
        <div style={{ display: 'flex', gap: 4 }}>
          {BASKETS.map(b => (
            <button key={b.id} onClick={() => setBasketId(b.id)} style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer',
              background: basketId === b.id ? 'rgba(0,229,255,0.15)' : 'rgba(255,255,255,0.04)',
              color: basketId === b.id ? '#00E5FF' : 'rgba(255,255,255,0.5)',
              border: `1px solid ${basketId === b.id ? 'rgba(0,229,255,0.3)' : 'transparent'}`,
            }}>{b.label}</button>
          ))}
        </div>

        {/* Interval selector */}
        <div style={{ display: 'flex', gap: 4 }}>
          {INTERVALS.map(iv => (
            <button key={iv.id} onClick={() => setInterval(iv.id)} style={{
              padding: '4px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer',
              background: interval === iv.id ? 'rgba(191,90,242,0.15)' : 'rgba(255,255,255,0.04)',
              color: interval === iv.id ? '#BF5AF2' : 'rgba(255,255,255,0.5)',
              border: `1px solid ${interval === iv.id ? 'rgba(191,90,242,0.3)' : 'transparent'}`,
            }}>{iv.label}</button>
          ))}
        </div>

        <button onClick={() => load(currentBasket, interval)} style={{
          padding: '4px 10px', borderRadius: 6, fontSize: 10, cursor: 'pointer',
          background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)',
          border: '1px solid rgba(255,255,255,0.1)',
        }}>
          {loading ? '⏳' : '↻'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.2)', fontSize: 11, color: '#FF3B30' }}>
          {error}
        </div>
      )}

      {loading && !result && (
        <div style={{ ...card(), display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
          Calcul en cours…
        </div>
      )}

      {result && (
        <>
          {/* ── Regime Banner ── */}
          <div style={{
            ...card({ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }),
            borderColor: regime ? `${regime.color}40` : 'rgba(255,255,255,0.07)',
            background: regime ? `${regime.color}08` : 'rgba(13,17,35,0.7)',
          }}>
            <span style={{ fontSize: 22 }}>{regime?.icon}</span>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: regime?.color, fontFamily: 'Syne' }}>
                  {regime?.label}
                </span>
                <span style={{
                  padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700,
                  background: `${regime?.color}20`, color: regime?.color, fontFamily: 'JetBrains Mono',
                }}>
                  {result.regimeConfidence}% confiance
                </span>
              </div>
              <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', margin: 0, lineHeight: 1.5 }}>
                {regime?.desc}
              </p>
            </div>

            {/* Smart money badge */}
            {result.smartMoneyBias !== 'neutral' && (
              <div style={{
                padding: '6px 12px', borderRadius: 8,
                background: result.smartMoneyBias === 'accumulation' ? 'rgba(52,199,89,0.12)' : 'rgba(255,59,48,0.12)',
                border: `1px solid ${result.smartMoneyBias === 'accumulation' ? 'rgba(52,199,89,0.3)' : 'rgba(255,59,48,0.3)'}`,
              }}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginBottom: 2 }}>SMART MONEY</div>
                <div style={{ fontSize: 11, fontWeight: 800, fontFamily: 'JetBrains Mono', color: result.smartMoneyBias === 'accumulation' ? '#34C759' : '#FF3B30' }}>
                  {result.smartMoneyBias === 'accumulation' ? '⬆ ACCUMULATION' : '⬇ DISTRIBUTION'}
                </div>
              </div>
            )}

            {/* Hidden signals */}
            {result.hiddenWeakness && (
              <div style={{ padding: '6px 10px', borderRadius: 8, background: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.2)', fontSize: 10, color: '#FF3B30' }}>
                ⚠️ Faiblesse cachée
              </div>
            )}
            {result.hiddenStrength && (
              <div style={{ padding: '6px 10px', borderRadius: 8, background: 'rgba(52,199,89,0.1)', border: '1px solid rgba(52,199,89,0.2)', fontSize: 10, color: '#34C759' }}>
                💪 Force cachée
              </div>
            )}
          </div>

          {/* ── View tabs ── */}
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              { id: 'overview', label: '📊 Vue d\'ensemble' },
              { id: 'correlation', label: '🔗 Corrélations' },
              { id: 'components', label: '📋 Composants' },
              { id: 'scatter', label: '🎯 Scatter' },
            ].map(v => (
              <button key={v.id} onClick={() => setActiveView(v.id as typeof activeView)} style={{
                padding: '5px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                background: activeView === v.id ? 'rgba(0,229,255,0.12)' : 'rgba(255,255,255,0.04)',
                color: activeView === v.id ? '#00E5FF' : 'rgba(255,255,255,0.5)',
                border: `1px solid ${activeView === v.id ? 'rgba(0,229,255,0.25)' : 'transparent'}`,
              }}>{v.label}</button>
            ))}
          </div>

          {/* ── Overview ── */}
          {activeView === 'overview' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>

              {/* Gauges row */}
              <div style={{ ...card(), gridColumn: '1 / -1', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <Gauge value={result.participationScore} label="Participation" color="#34C759" size={90} />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <Gauge value={result.riskOnScore} label="Risk-On" color="#00E5FF" size={90} />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <Gauge value={result.dispersionPercentile} label="Dispersion" color="#BF5AF2" size={90} />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <Gauge value={result.correlationPercentile} label="Corrélation" color="#FF9500" size={90} />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <Gauge
                    value={Math.round(50 + result.overallScore / 2)}
                    label="Score Global"
                    color={result.overallBias === 'bullish' ? '#34C759' : result.overallBias === 'bearish' ? '#FF3B30' : '#8E8E93'}
                    size={90}
                  />
                </div>
              </div>

              {/* Dispersion card */}
              <div style={card()}>
                <div style={sectionTitle('#BF5AF2')}>📐 Dispersion</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    { label: 'Brute', value: `${(result.dispersionRaw * 100).toFixed(3)}%` },
                    { label: 'Moyenne hist.', value: `${(result.dispersionMA * 100).toFixed(3)}%` },
                    { label: 'Z-Score', value: `${result.dispersionZScore >= 0 ? '+' : ''}${result.dispersionZScore.toFixed(2)}σ`, color: result.dispersionZScore > 1.5 ? '#FF3B30' : result.dispersionZScore < -1 ? '#34C759' : '#8E8E93' },
                    { label: 'Percentile', value: `${result.dispersionPercentile.toFixed(0)}e` },
                  ].map(row => (
                    <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{row.label}</span>
                      <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono', fontWeight: 700, color: row.color ?? 'rgba(255,255,255,0.9)' }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Correlation card */}
              <div style={card()}>
                <div style={sectionTitle('#FF9500')}>🔗 Corrélation</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    { label: 'Moy. pairée', value: result.avgCorrelation.toFixed(3), color: result.avgCorrelation > 0.7 ? '#FF3B30' : result.avgCorrelation < 0.3 ? '#34C759' : '#FF9500' },
                    { label: 'Z-Score', value: `${result.correlationZScore >= 0 ? '+' : ''}${result.correlationZScore.toFixed(2)}σ` },
                    { label: 'Percentile', value: `${result.correlationPercentile.toFixed(0)}e` },
                    { label: 'Régime', value: result.avgCorrelation > 0.7 ? '📦 Macro' : result.avgCorrelation < 0.3 ? '🎯 Alpha' : '⚖️ Mixte' },
                  ].map(row => (
                    <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{row.label}</span>
                      <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono', fontWeight: 700, color: row.color ?? 'rgba(255,255,255,0.9)' }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Volatility card */}
              <div style={card()}>
                <div style={sectionTitle('#00E5FF')}>📉 Volatilité</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    { label: 'Moy. composants', value: fmtVol(result.avgComponentVol) },
                    { label: 'Indice réalisée', value: fmtVol(result.realizedIndexVol) },
                    { label: 'Indice implicite', value: fmtVol(result.impliedIndexVol) },
                    { label: 'Spread (RDP)', value: fmtVol(result.volSpread), color: result.volSpread > 0 ? '#34C759' : '#FF3B30' },
                    { label: 'Régime', value: result.volRegime === 'squeeze' ? '🔴 Squeeze' : result.volRegime === 'expansion' ? '🟢 Expansion' : '⚪ Normal' },
                  ].map(row => (
                    <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{row.label}</span>
                      <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono', fontWeight: 700, color: row.color ?? 'rgba(255,255,255,0.9)' }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Breadth card */}
              <div style={card()}>
                <div style={sectionTitle('#34C759')}>📊 Breadth</div>
                <BreadthBar label="% Composants haussiers" value={result.pctUp} color={result.pctUp > 60 ? '#34C759' : result.pctUp < 40 ? '#FF3B30' : '#FF9500'} />
                <BreadthBar label="% Au-dessus EMA20" value={result.pctAboveEma20} color="#00E5FF" />
                <BreadthBar label="% Au-dessus EMA50" value={result.pctAboveEma50} color="#42A5F5" />
                <BreadthBar label="Score participation" value={result.participationScore} color="#34C759" />
                <div style={{ marginTop: 8, fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'JetBrains Mono' }}>
                  A/D ratio: <span style={{ color: result.advanceDeclineRatio > 1 ? '#34C759' : '#FF3B30', fontWeight: 700 }}>{result.advanceDeclineRatio.toFixed(2)}</span>
                </div>
              </div>

              {/* Smart Money card */}
              <div style={card()}>
                <div style={sectionTitle('#FF9500')}>🧠 Smart Money</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    { label: 'Rendement panier', value: fmtPct(result.basketReturn * 100), color: result.basketReturn >= 0 ? '#34C759' : '#FF3B30' },
                    { label: 'Rendement médian', value: fmtPct(result.medianReturn * 100), color: result.medianReturn >= 0 ? '#34C759' : '#FF3B30' },
                    { label: 'Divergence idx/med', value: fmtPct(result.indexVsMedianDivergence * 100) },
                    { label: 'Score distribution', value: `${result.distributionScore}/100`, color: result.distributionScore > 60 ? '#FF3B30' : 'rgba(255,255,255,0.7)' },
                    { label: 'Score accumulation', value: `${result.accumulationScore}/100`, color: result.accumulationScore > 60 ? '#34C759' : 'rgba(255,255,255,0.7)' },
                  ].map(row => (
                    <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{row.label}</span>
                      <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono', fontWeight: 700, color: row.color ?? 'rgba(255,255,255,0.9)' }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Correlation view ── */}
          {activeView === 'correlation' && (
            <div style={card({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 })}>
              <div style={sectionTitle('#FF9500')}>🔗 Matrice de corrélation (Pearson · {result.components.length}d rolling)</div>
              <CorrelationHeatmap
                matrix={result.correlationMatrix}
                labels={result.components.map(c => c.label)}
                size={Math.min(400, result.components.length * 48)}
              />
              <div style={{ display: 'flex', gap: 16, fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
                <span>🔵 -1.0 (anti-corrélé)</span>
                <span>⚫ 0.0 (neutre)</span>
                <span>🔵 +1.0 (corrélé)</span>
              </div>
              {/* Avg correlation gauge */}
              <div style={{ textAlign: 'center' }}>
                <Gauge value={(result.avgCorrelation + 1) / 2 * 100} min={0} max={100}
                  label={`ρ̄ = ${result.avgCorrelation.toFixed(3)}`}
                  color={result.avgCorrelation > 0.6 ? '#FF9500' : '#34C759'} size={100} />
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                  {result.avgCorrelation > 0.7 ? 'Marché macro-dominé — mouvements synchronisés' :
                    result.avgCorrelation < 0.3 ? 'Décorrélation — environnement alpha/stock-picking' :
                      'Corrélation modérée — rotation en cours'}
                </div>
              </div>
            </div>
          )}

          {/* ── Components table ── */}
          {activeView === 'components' && (
            <div style={card()}>
              <div style={sectionTitle('#00E5FF')}>📋 Composants — classés par rendement 1D</div>
              <ComponentTable components={result.components} />
            </div>
          )}

          {/* ── Scatter plot ── */}
          {activeView === 'scatter' && (
            <div style={card({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 })}>
              <div style={sectionTitle('#BF5AF2')}>🎯 Scatter — Rendement 1D vs Volatilité Réalisée</div>
              <ScatterPlot components={result.components} size={Math.min(500, window.innerWidth - 80)} />
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textAlign: 'center', lineHeight: 1.6 }}>
                Quadrant haut-droit = performers volatils (momentum)<br />
                Quadrant haut-gauche = underperformers volatils (vulnérables)<br />
                Quadrant bas-droit = performers stables (qualité)<br />
                Quadrant bas-gauche = underperformers stables (laggards)
              </div>
            </div>
          )}

          {/* ── Footer stats ── */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { label: 'Panier', value: fmtPct(result.basketReturn * 100), color: result.basketReturn >= 0 ? '#34C759' : '#FF3B30' },
              { label: 'Biais global', value: result.overallBias.toUpperCase(), color: result.overallBias === 'bullish' ? '#34C759' : result.overallBias === 'bearish' ? '#FF3B30' : '#8E8E93' },
              { label: 'Actifs analysés', value: `${result.components.length}` },
              { label: 'Intervalle', value: interval },
              { label: 'Mis à jour', value: new Date(result.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) },
            ].map(s => (
              <div key={s.label} style={{
                padding: '4px 10px', borderRadius: 6,
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
                display: 'flex', gap: 6, alignItems: 'center',
              }}>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>{s.label}</span>
                <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono', fontWeight: 700, color: s.color ?? 'rgba(255,255,255,0.8)' }}>{s.value}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
