// src/components/share/ShareStatsCard.tsx
// Carte visuelle — conçue pour html-to-image (aucune interaction)
import { useEffect, useRef } from 'react'

// ── Config ──────────────────────────────────────────────────────────────────

export type CardTheme = 'cyan' | 'purple' | 'gold' | 'minimal'

export interface ShareCardConfig {
  metrics: {
    winRate:      boolean
    payoffRatio:  boolean
    totalPnL:     boolean
    totalTrades:  boolean
    maxDD:        boolean
    expectancy:   boolean
    sharpe:       boolean
    bestStreak:   boolean
  }
  showSparkline: boolean
  showEmotion:   boolean
  showAvatar:    boolean
  showBranding:  boolean
  theme:         CardTheme
}

export const DEFAULT_CONFIG: ShareCardConfig = {
  metrics: {
    winRate:     true,
    payoffRatio: true,
    totalPnL:    true,
    totalTrades: true,
    maxDD:       false,
    expectancy:  false,
    sharpe:      false,
    bestStreak:  false,
  },
  showSparkline: true,
  showEmotion:   true,
  showAvatar:    true,
  showBranding:  true,
  theme:         'cyan',
}

export const THEME_COLORS: Record<CardTheme, string> = {
  cyan:    '#00E5FF',
  purple:  '#BF5AF2',
  gold:    '#F59714',
  minimal: '#8B949E',
}

// ── Props ────────────────────────────────────────────────────────────────────

export interface ShareStatsCardProps {
  displayName:     string
  photoURL:        string | null
  winRate:         number
  payoffRatio:     number
  totalPnL:        number
  totalTrades:     number
  maxDD:           number
  expectancy:      number
  sharpe:          number
  bestStreak:      number
  dominantEmotion: string | null
  pnlCurve:        number[]
  period:          string
  currency?:       string
  config:          ShareCardConfig
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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
function hex2rgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ curve, accent }: { curve: number[]; accent: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const cssW = 600, cssH = 68
    const dpr = window.devicePixelRatio || 1
    canvas.width  = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    canvas.style.width  = cssW + 'px'
    canvas.style.height = cssH + 'px'
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, cssW, cssH)
    if (curve.length < 2) return
    const min = Math.min(...curve), max = Math.max(...curve)
    const range = max - min || 1
    const pad = { l: 6, r: 6, t: 6, b: 6 }
    const W = cssW - pad.l - pad.r, H = cssH - pad.t - pad.b
    const toX = (i: number) => pad.l + (i / (curve.length - 1)) * W
    const toY = (v: number) => pad.t + H - ((v - min) / range) * H
    const lastVal = curve[curve.length - 1]
    const positive = lastVal >= 0
    const color = positive ? '#22C759' : '#FF3B30'
    // Gradient fill
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + H)
    grad.addColorStop(0, positive ? 'rgba(34,199,89,0.32)' : 'rgba(255,59,48,0.32)')
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
    // Accent end line (theme color)
    ctx.beginPath()
    ctx.moveTo(toX(curve.length - 1), pad.t)
    ctx.lineTo(toX(curve.length - 1), cssH)
    ctx.strokeStyle = hex2rgba(accent, 0.25)
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])
    ctx.stroke()
    ctx.setLineDash([])
  }, [curve, accent])
  return <canvas ref={canvasRef} style={{ display: 'block' }} />
}

// ── Card ─────────────────────────────────────────────────────────────────────

export default function ShareStatsCard({
  displayName, photoURL, winRate, payoffRatio, totalPnL, totalTrades,
  maxDD, expectancy, sharpe, bestStreak, dominantEmotion,
  pnlCurve, period, currency = '$', config,
}: ShareStatsCardProps) {
  const accent = THEME_COLORS[config.theme]
  const emo = emotionInfo(dominantEmotion)
  const pnlColor = totalPnL >= 0 ? '#22C759' : '#FF3B30'
  const periodLabel = period === '1M' ? '1 mois' : period === '3M' ? '3 mois' : 'Tout'

  // Build all possible KPIs, filter by config, take first 4 active
  const ALL_KPIS = [
    { key: 'winRate',     label: 'Win Rate',   value: `${winRate.toFixed(1)}%`,       color: winRate >= 50 ? '#22C759' : '#FF3B30' },
    { key: 'payoffRatio', label: 'R/R Ratio',  value: `×${payoffRatio.toFixed(2)}`,    color: payoffRatio >= 1 ? '#22C759' : '#FF9800' },
    { key: 'totalPnL',    label: 'P&L Net',    value: fmtPnL(totalPnL, currency),      color: pnlColor },
    { key: 'totalTrades', label: 'Trades',     value: String(totalTrades),             color: '#C5C8D6' },
    { key: 'maxDD',       label: 'Max DD',     value: fmtPnL(-maxDD, currency),        color: '#FF3B30' },
    { key: 'expectancy',  label: 'Espérance',  value: fmtPnL(expectancy, currency),    color: expectancy >= 0 ? '#22C759' : '#FF3B30' },
    { key: 'sharpe',      label: 'Sharpe',     value: sharpe.toFixed(2),               color: sharpe >= 1 ? '#22C759' : sharpe >= 0 ? '#FF9800' : '#FF3B30' },
    { key: 'bestStreak',  label: 'Streak Max', value: `${bestStreak} wins`,            color: '#F59714' },
  ] as const

  const activeKpis = ALL_KPIS
    .filter(k => config.metrics[k.key as keyof typeof config.metrics])
    .slice(0, 4)

  const cols = activeKpis.length || 1

  return (
    <div
      data-share-card
      style={{
        width: 640,
        background: '#0D1117',
        border: `1px solid ${hex2rgba(accent, 0.15)}`,
        borderRadius: 16,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        flexShrink: 0,
      }}
    >
      {/* ── Accent top line ── */}
      <div style={{ height: 3, background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />

      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px 12px',
        borderBottom: `1px solid rgba(255,255,255,0.06)`,
      }}>
        {/* Left: avatar + name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {config.showAvatar && (
            <div style={{
              width: 42, height: 42, borderRadius: '50%',
              background: hex2rgba(accent, 0.1),
              border: `2px solid ${hex2rgba(accent, 0.3)}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 17, fontWeight: 700, color: accent,
              overflow: 'hidden', flexShrink: 0,
            }}>
              {photoURL
                ? <img src={photoURL} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : displayName?.[0]?.toUpperCase() ?? 'T'
              }
            </div>
          )}
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#F0F2F5', lineHeight: 1.2 }}>{displayName}</div>
            <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Trader · TradeMindset
            </div>
          </div>
        </div>

        {/* Right: logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: hex2rgba(accent, 0.1),
            border: `1px solid ${hex2rgba(accent, 0.25)}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2.5" strokeLinecap="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
              <polyline points="16 7 22 7 22 13" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#F0F2F5', letterSpacing: '-0.01em' }}>TradeMindset</div>
            <div style={{ fontSize: 8, color: accent, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Pro</div>
          </div>
        </div>
      </div>

      {/* ── KPIs ── */}
      {activeKpis.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          padding: '14px 20px',
          borderBottom: `1px solid rgba(255,255,255,0.06)`,
          gap: 8,
        }}>
          {activeKpis.map(k => (
            <div key={k.key} style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: cols <= 3 ? 24 : 20,
                fontWeight: 800, color: k.color,
                fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.1,
              }}>
                {k.value}
              </div>
              <div style={{ fontSize: 10, color: '#6B7280', marginTop: 3, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                {k.label}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Sparkline ── */}
      {config.showSparkline && pnlCurve.length >= 2 && (
        <div style={{ padding: '10px 20px 6px' }}>
          <Sparkline curve={pnlCurve} accent={accent} />
        </div>
      )}

      {/* ── Emotion row ── */}
      {config.showEmotion && dominantEmotion && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14,
          padding: '8px 20px',
          borderTop: `1px solid rgba(255,255,255,0.06)`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14 }}>{emo.emoji}</span>
            <span style={{ fontSize: 11, color: emo.color, fontWeight: 600 }}>{emo.label}</span>
          </div>
          <div style={{ width: 1, height: 13, background: 'rgba(255,255,255,0.08)' }} />
          <div style={{ fontSize: 11, color: '#6B7280' }}>
            État émotionnel dominant · Période : {periodLabel}
          </div>
        </div>
      )}

      {/* ── Footer branding ── */}
      {config.showBranding && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 20px 12px',
          borderTop: `1px solid rgba(255,255,255,0.06)`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: accent, fontWeight: 600 }}>
            <span>🌐</span>
            <span>trademindset.app</span>
          </div>
          {!config.showEmotion && (
            <div style={{ fontSize: 10, color: '#6B7280' }}>
              Période : {periodLabel}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
