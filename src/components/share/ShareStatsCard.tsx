// src/components/share/ShareStatsCard.tsx
// Carte visuelle 640×340px — conçue pour html-to-image (aucune interaction)
import { useEffect, useRef } from 'react'

export interface ShareStatsCardProps {
  displayName: string
  photoURL: string | null
  winRate: number          // ex: 68.5 (%)
  payoffRatio: number      // ex: 1.8
  totalPnL: number         // ex: 2340
  totalTrades: number
  maxDD: number
  expectancy: number
  dominantEmotion: string | null
  pnlCurve: number[]       // cumPnL au fil du temps
  period: string           // '1M' | '3M' | 'ALL'
  currency?: string        // '$' par défaut
}

const EMOTIONS: Record<string, { emoji: string; label: string; color: string }> = {
  confident:  { emoji: '😎', label: 'Confiant',   color: '#4CAF50' },
  calm:       { emoji: '😌', label: 'Calme',      color: '#2196F3' },
  focused:    { emoji: '🎯', label: 'Concentré',  color: '#00BCD4' },
  excited:    { emoji: '🤩', label: 'Excité',     color: '#E91E63' },
  stressed:   { emoji: '😰', label: 'Stressé',    color: '#F44336' },
  impatient:  { emoji: '😤', label: 'Impatient',  color: '#FF9800' },
  fearful:    { emoji: '😨', label: 'Peur',       color: '#9C27B0' },
  greedy:     { emoji: '💰', label: 'Avarice',    color: '#FFC107' },
  frustrated: { emoji: '😡', label: 'Frustré',   color: '#795548' },
  distracted: { emoji: '🤔', label: 'Distrait',  color: '#607D8B' },
}

function emotionInfo(v: string | null) {
  if (!v) return { emoji: '😐', label: 'Neutre', color: '#888' }
  return EMOTIONS[v] ?? { emoji: '😐', label: v, color: '#888' }
}

function fmtPnL(n: number, currency = '$') {
  const s = n >= 0 ? '+' : '-'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${s}${currency}${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `${s}${currency}${(abs / 1_000).toFixed(1)}K`
  return `${s}${currency}${abs.toFixed(2)}`
}

function Sparkline({ curve }: { curve: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const cssW = 600, cssH = 72
    const dpr = window.devicePixelRatio || 1
    canvas.width  = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    canvas.style.width  = cssW + 'px'
    canvas.style.height = cssH + 'px'
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, cssW, cssH)

    if (curve.length < 2) return

    const min = Math.min(...curve)
    const max = Math.max(...curve)
    const range = max - min || 1
    const pad = { l: 6, r: 6, t: 8, b: 8 }
    const W = cssW - pad.l - pad.r
    const H = cssH - pad.t - pad.b

    const toX = (i: number) => pad.l + (i / (curve.length - 1)) * W
    const toY = (v: number) => pad.t + H - ((v - min) / range) * H

    const lastVal = curve[curve.length - 1]
    const positive = lastVal >= 0
    const color = positive ? '#22C759' : '#FF3B30'

    // Fill gradient
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + H)
    grad.addColorStop(0, positive ? 'rgba(34,199,89,0.35)' : 'rgba(255,59,48,0.35)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.beginPath()
    ctx.moveTo(toX(0), toY(curve[0]))
    for (let i = 1; i < curve.length; i++) ctx.lineTo(toX(i), toY(curve[i]))
    ctx.lineTo(toX(curve.length - 1), cssH)
    ctx.lineTo(toX(0), cssH)
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()

    // Line
    ctx.beginPath()
    ctx.moveTo(toX(0), toY(curve[0]))
    for (let i = 1; i < curve.length; i++) ctx.lineTo(toX(i), toY(curve[i]))
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.stroke()

    // End dot
    ctx.beginPath()
    ctx.arc(toX(curve.length - 1), toY(lastVal), 4, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
  }, [curve])

  return <canvas ref={canvasRef} style={{ display: 'block' }} />
}

export default function ShareStatsCard({
  displayName, photoURL, winRate, payoffRatio, totalPnL, totalTrades,
  maxDD, expectancy, dominantEmotion, pnlCurve, period, currency = '$',
}: ShareStatsCardProps) {
  const emo = emotionInfo(dominantEmotion)
  const pnlColor = totalPnL >= 0 ? '#22C759' : '#FF3B30'
  const periodLabel = period === '1M' ? '1 mois' : period === '3M' ? '3 mois' : 'Tout'

  const kpis = [
    { label: 'Win Rate',  value: `${winRate.toFixed(1)}%`,        color: winRate >= 50 ? '#22C759' : '#FF3B30' },
    { label: 'R/R Ratio', value: `×${payoffRatio.toFixed(2)}`,     color: payoffRatio >= 1 ? '#22C759' : '#FF9800' },
    { label: 'P&L Net',   value: fmtPnL(totalPnL, currency),       color: pnlColor },
    { label: 'Trades',    value: String(totalTrades),               color: '#C5C8D6' },
  ]

  return (
    <div
      data-share-card
      style={{
        width: 640, height: 340, borderRadius: 16,
        background: '#0D1117',
        border: '1px solid #1E2330',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        boxSizing: 'border-box',
        flexShrink: 0,
      }}
    >
      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 20px 12px',
        borderBottom: '1px solid #1E2330',
      }}>
        {/* Left: avatar + name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'linear-gradient(135deg, #0A85FF33, #00E5FF33)',
            border: '2px solid rgba(0,229,255,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, fontWeight: 700, color: '#00E5FF',
            overflow: 'hidden', flexShrink: 0,
          }}>
            {photoURL
              ? <img src={photoURL} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : displayName?.[0]?.toUpperCase() ?? 'T'
            }
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#F0F2F5', lineHeight: 1.2 }}>{displayName}</div>
            <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Trader · TradeMindset
            </div>
          </div>
        </div>

        {/* Right: TradeMindset logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'rgba(0,229,255,0.1)',
            border: '1px solid rgba(0,229,255,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
              <polyline points="16 7 22 7 22 13" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#F0F2F5', letterSpacing: '-0.01em' }}>TradeMindset</div>
            <div style={{ fontSize: 8, color: '#00E5FF', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Pro</div>
          </div>
        </div>
      </div>

      {/* ── 4 KPIs ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4,1fr)',
        padding: '12px 20px',
        borderBottom: '1px solid #1E2330',
        gap: 8,
      }}>
        {kpis.map(k => (
          <div key={k.label} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: k.color, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.1 }}>
              {k.value}
            </div>
            <div style={{ fontSize: 10, color: '#6B7280', marginTop: 3, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              {k.label}
            </div>
          </div>
        ))}
      </div>

      {/* ── Sparkline ── */}
      <div style={{ padding: '8px 20px 0', flex: 1 }}>
        <Sparkline curve={pnlCurve} />
      </div>

      {/* ── Emotion + stats row ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '6px 20px',
        borderTop: '1px solid #1E2330',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14 }}>{emo.emoji}</span>
          <span style={{ fontSize: 11, color: emo.color, fontWeight: 600 }}>{emo.label}</span>
        </div>
        <div style={{ width: 1, height: 14, background: '#1E2330' }} />
        <div style={{ fontSize: 11, color: '#6B7280' }}>
          MaxDD <span style={{ color: '#FF3B30', fontWeight: 600 }}>{fmtPnL(-maxDD, currency)}</span>
        </div>
        <div style={{ width: 1, height: 14, background: '#1E2330' }} />
        <div style={{ fontSize: 11, color: '#6B7280' }}>
          Espérance <span style={{ color: expectancy >= 0 ? '#22C759' : '#FF3B30', fontWeight: 600 }}>
            {fmtPnL(expectancy, currency)}/trade
          </span>
        </div>
      </div>

      {/* ── Footer branding ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 20px 10px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#00E5FF', fontWeight: 600 }}>
          <span>🌐</span>
          <span>trademindset.app</span>
        </div>
        <div style={{ fontSize: 10, color: '#6B7280' }}>
          Période : {periodLabel}
        </div>
      </div>
    </div>
  )
}
