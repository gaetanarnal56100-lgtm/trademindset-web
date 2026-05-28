/**
 * Dispersion Analysis Dashboard v2 — Institutional Grade
 * New: History view, Leaders/Laggards waterfall, Trade Signal, Hurst, Autocorr
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchAndCompute } from '@/services/dispersion/dispersionEngine'
import type { DispersionResult, DispersionRegime } from '@/services/dispersion/types'
import { CRYPTO_BASKET, DEFI_BASKET, L2_BASKET } from '@/services/dispersion/types'
import type { AssetConfig } from '@/services/dispersion/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const REGIME_META: Record<DispersionRegime, { label: string; color: string; icon: string; desc: string }> = {
  compression: { label: 'Compression', color: '#00E5FF', icon: '🌀', desc: 'Faible dispersion + forte corrélation. Mouvement macro imminent. Surveiller breakout.' },
  expansion:   { label: 'Expansion',   color: '#BF5AF2', icon: '💥', desc: 'Forte dispersion + faible corrélation. Environnement stock-picking. Leaders/laggards distincts.' },
  panic:       { label: 'Panique',     color: '#FF3B30', icon: '🚨', desc: 'Haute dispersion + fort vol + faible participation. Capitulation potentielle.' },
  trending:    { label: 'Tendance',    color: '#34C759', icon: '📈', desc: 'Faible dispersion, haute participation. Mouvement directionnel fort.' },
  rotating:    { label: 'Rotation',   color: '#FF9500', icon: '🔄', desc: 'Rotation sectorielle active. Capital circule entre leaders et laggards.' },
  unknown:     { label: 'Analyse…',   color: '#8E8E93', icon: '⏳', desc: 'Données insuffisantes.' },
}

const BASKETS = [
  { id: 'crypto', label: '🪙 Crypto',  configs: CRYPTO_BASKET },
  { id: 'defi',   label: '🏦 DeFi',   configs: DEFI_BASKET },
  { id: 'l2',     label: '⚡ L2',     configs: L2_BASKET },
]

const INTERVALS = [
  { id: '15m', label: '15m' }, { id: '1h', label: '1h' },
  { id: '4h', label: '4h' },   { id: '1d', label: '1D' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtPct = (v: number, d = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`
const fmtVol = (v: number) => `${(v * 100).toFixed(1)}%`

const hurstLabel = (h: number) =>
  h > 0.6 ? { text: 'Trending', color: '#34C759' } :
  h < 0.4 ? { text: 'Mean-Rev', color: '#00E5FF' } :
             { text: 'Random',  color: '#8E8E93' }

// ─── Gauge ────────────────────────────────────────────────────────────────────

function Gauge({ value, label, color, size = 80 }: { value: number; label: string; color: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr; canvas.height = size * 0.6 * dpr
    const ctx = canvas.getContext('2d')!; ctx.scale(dpr, dpr)
    const cx = size / 2, cy = size * 0.55, r = size * 0.38
    const pct = Math.max(0, Math.min(1, value / 100))
    const valueA = Math.PI + pct * Math.PI
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI)
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.stroke()
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, valueA)
    ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.stroke()
    ctx.fillStyle = color; ctx.font = `bold ${size * 0.18}px JetBrains Mono, monospace`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(Math.round(value).toString(), cx, cy - 4)
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = `${size * 0.1}px Syne, sans-serif`
    ctx.fillText(label, cx, cy + size * 0.12)
  }, [value, color, size, label])
  return <canvas ref={ref} style={{ width: size, height: size * 0.6 }} />
}

// ─── History Line Chart ───────────────────────────────────────────────────────

function HistoryLineChart({ data, timestamps, label, color, regimes, valueFormat = (v: number) => v.toFixed(3), crosshairFrac, onCrosshairChange, visibleRange }: {
  data: number[]; timestamps?: number[]; label: string; color: string
  regimes?: DispersionRegime[]; valueFormat?: (v: number) => string
  crosshairFrac?: number | null; onCrosshairChange?: (frac: number | null) => void
  visibleRange?: { from: number; to: number; areaRatio?: number; fromMs?: number; toMs?: number }
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  // Mouse handlers — emit frac relative to visible window
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = ref.current; if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const padL = 4, padR = 60
    const drawW = rect.width - padL - padR
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left - padL) / drawW))
    onCrosshairChange?.(frac)
  }, [onCrosshairChange])

  const handleMouseLeave = useCallback(() => { onCrosshairChange?.(null) }, [onCrosshairChange])

  useEffect(() => {
    const canvas = ref.current; if (!canvas || data.length < 2) return
    const dpr = window.devicePixelRatio || 1
    const W = canvas.offsetWidth || 500, H = 80
    canvas.width = W * dpr; canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!; ctx.scale(dpr, dpr)
    ctx.fillStyle = '#080C14'; ctx.fillRect(0, 0, W, H)

    if (data.length < 2) return

    // Full dataset min/max so Y scale stays stable while scrolling
    const mn = Math.min(...data), mx = Math.max(...data), range = mx - mn || 0.001
    const padL = 4, padR = 60, padV = 6, padBottom = 16
    const drawW = W - padL - padR, drawH = H - padV - padBottom

    // x-axis = LW visible range; data slides left/right with the main chart
    const visFrom = visibleRange?.fromMs ?? (timestamps?.[0] ?? 0)
    const visTo   = visibleRange?.toMs   ?? (timestamps?.[timestamps!.length - 1] ?? 1)
    const tSpan   = visTo - visFrom || 1

    // Binary-search: only draw points within [visFrom, visTo]
    // No canvas overflow → no "stuck-to-right" clip artifact
    let si = 0, ei = data.length
    if (timestamps && timestamps.length >= 2) {
      let lo = 0, hi = timestamps.length
      while (lo < hi) { const mid = (lo + hi) >> 1; if (timestamps[mid] < visFrom) lo = mid + 1; else hi = mid }
      si = Math.max(0, lo - 1)
      lo = 0; hi = timestamps.length
      while (lo < hi) { const mid = (lo + hi) >> 1; if (timestamps[mid] <= visTo) lo = mid + 1; else hi = mid }
      ei = Math.min(data.length, lo + 1)
    }
    const visData    = data.slice(si, ei)
    const visTimes   = timestamps?.slice(si, ei)
    const visRegimes = regimes?.slice(si, ei)

    if (visData.length < 2) return

    const n = visData.length
    const toX = (i: number) =>
      visTimes
        ? padL + ((visTimes[i] - visFrom) / tSpan) * drawW
        : padL + (n > 1 ? (i / (n - 1)) * drawW : drawW / 2)
    const toY = (v: number) => padV + (1 - (v - mn) / range) * drawH

    // Clip draw area to [padL .. padL+drawW] — prevents time-positioned points bleeding out
    ctx.save()
    ctx.beginPath(); ctx.rect(padL, 0, drawW, H); ctx.clip()

    // Regime background
    if (visRegimes) {
      visRegimes.forEach((r, i) => {
        const x1 = toX(i), x2 = i < n - 1 ? toX(i + 1) : toX(n - 1)
        const c = r === 'expansion' ? 'rgba(191,90,242,0.07)' : r === 'compression' ? 'rgba(0,229,255,0.07)' :
          r === 'panic' ? 'rgba(255,59,48,0.09)' : r === 'trending' ? 'rgba(52,199,89,0.05)' : 'transparent'
        ctx.fillStyle = c; ctx.fillRect(x1, 0, x2 - x1, H)
      })
    }

    // Zero line
    if (mn < 0 && mx > 0) {
      const y0 = toY(0)
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3])
      ctx.beginPath(); ctx.moveTo(padL, y0); ctx.lineTo(W - padR, y0); ctx.stroke()
      ctx.setLineDash([])
    }

    // Area fill
    ctx.beginPath()
    visData.forEach((v, i) => { const x = toX(i), y = toY(v); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
    ctx.lineTo(toX(n-1), H); ctx.lineTo(toX(0), H); ctx.closePath()
    ctx.fillStyle = color + '18'; ctx.fill()

    // Line
    ctx.beginPath()
    visData.forEach((v, i) => { const x = toX(i), y = toY(v); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
    ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.stroke()

    // Current dot (last visible point)
    const lx = toX(n-1), ly = toY(visData[n-1])
    ctx.beginPath(); ctx.arc(lx, ly, 3, 0, Math.PI*2); ctx.fillStyle = color; ctx.fill()

    ctx.restore() // End clip

    // Right-side labels (show value of last VISIBLE point)
    ctx.font = '8px JetBrains Mono, monospace'; ctx.textAlign = 'left'
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillText(label, W - padR + 6, padV + 10)
    ctx.fillStyle = color; ctx.font = 'bold 9px JetBrains Mono, monospace'
    ctx.fillText(valueFormat(visData[n-1]), W - padR + 6, padV + 22)
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '7px JetBrains Mono'
    ctx.fillText(`↑${valueFormat(mx)}`, W - padR + 6, padV + 34)
    ctx.fillText(`↓${valueFormat(mn)}`, W - padR + 6, padV + 44)

    // X-axis timestamps from visible slice
    if (visTimes && visTimes.length >= 2) {
      const fmtTs = (ts: number) => {
        const d = new Date(ts)
        const h = d.getHours().toString().padStart(2, '0')
        const m = d.getMinutes().toString().padStart(2, '0')
        const day = d.getDate().toString().padStart(2, '0')
        const mon = (d.getMonth() + 1).toString().padStart(2, '0')
        const span = (visTimes[visTimes.length - 1] - visTimes[0]) / 3_600_000
        return span > 24 ? `${day}/${mon}` : `${h}:${m}`
      }
      ctx.font = '7px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(255,255,255,0.3)'
      const indices = [0, Math.floor(n / 2), n - 1]
      const aligns: CanvasTextAlign[] = ['left', 'center', 'left']
      indices.forEach((idx, k) => {
        if (!visTimes[idx]) return
        ctx.textAlign = aligns[k]
        ctx.fillText(fmtTs(visTimes[idx]), toX(idx), H - 3)
      })
    }

    // Crosshair — frac is relative to visible window
    if (crosshairFrac != null && crosshairFrac >= 0 && crosshairFrac <= 1) {
      const cx = padL + crosshairFrac * drawW
      const idx = Math.max(0, Math.min(n - 1, Math.round(crosshairFrac * (n - 1))))
      const cy = toY(visData[idx])

      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.setLineDash([2, 2])
      ctx.beginPath(); ctx.moveTo(cx, padV); ctx.lineTo(cx, H - padBottom); ctx.stroke()
      ctx.setLineDash([])

      ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = color; ctx.fill()
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke()

      const txt = valueFormat(visData[idx])
      ctx.font = 'bold 9px JetBrains Mono, monospace'
      const tw = ctx.measureText(txt).width
      const tx = Math.min(cx + 4, W - padR - tw - 2)
      ctx.fillStyle = color + 'CC'
      ctx.fillRect(tx - 2, cy - 8, tw + 4, 12)
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'
      ctx.fillText(txt, tx, cy + 1)
      ctx.restore()
    }
  }, [data, timestamps, label, color, regimes, valueFormat, crosshairFrac, visibleRange])
  return <canvas ref={ref} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} style={{ width: '100%', height: 80, display: 'block', borderRadius: 6, cursor: 'crosshair' }} />
}

// ─── Correlation Heatmap ──────────────────────────────────────────────────────

function CorrelationHeatmap({ matrix, labels, size = 200 }: { matrix: number[][]; labels: string[]; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return
    const N = labels.length; if (!N) return
    const dpr = window.devicePixelRatio || 1
    const cell = Math.floor(size / (N + 1))
    const W = cell * (N + 1), H = cell * (N + 1)
    canvas.width = W * dpr; canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!; ctx.scale(dpr, dpr)
    ctx.fillStyle = '#080C14'; ctx.fillRect(0, 0, W, H)

    const corrColor = (v: number) => v > 0
      ? `rgba(0,${Math.round(180*v)},${Math.round(255*v)},${0.25+0.75*v})`
      : `rgba(${Math.round(255*-v)},${Math.round(60*(1+v))},${Math.round(48*-v)},${0.25+0.75*-v})`

    ctx.font = `bold ${cell*0.4}px JetBrains Mono, monospace`
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    labels.forEach((lbl, i) => {
      ctx.fillText(lbl.slice(0,4), cell*(i+1)+cell/2, cell/2)
      ctx.fillText(lbl.slice(0,4), cell/2, cell*(i+1)+cell/2)
    })

    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const v = matrix[i]?.[j] ?? 0
      const x = cell*(j+1), y = cell*(i+1)
      ctx.fillStyle = corrColor(v); ctx.fillRect(x, y, cell, cell)
      if (cell > 24) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = `${cell*0.33}px JetBrains Mono`
        ctx.fillText(v.toFixed(2), x+cell/2, y+cell/2)
      }
    }
  }, [matrix, labels, size])
  const side = size + Math.floor(size / (labels.length + 1))
  return <canvas ref={ref} style={{ width: side, height: side, borderRadius: 8 }} />
}

// ─── Leaders/Laggards Waterfall ───────────────────────────────────────────────

function LeadersWaterfall({ components }: { components: DispersionResult['components'] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current; if (!canvas || !components.length) return
    const dpr = window.devicePixelRatio || 1
    const W = canvas.offsetWidth || 600
    const barH = 20, gap = 5, N = components.length
    const H = N * (barH + gap) + 30
    canvas.width = W * dpr; canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!; ctx.scale(dpr, dpr)
    ctx.fillStyle = '#080C14'; ctx.fillRect(0, 0, W, H)

    const sorted = [...components].sort((a, b) => b.contributionPct - a.contributionPct)
    const maxAbs = Math.max(...sorted.map(c => Math.abs(c.contributionPct)), 0.0001)
    const labelW = 42, valW = 80
    const barAreaW = W - labelW - valW - 8
    const midX = labelW + barAreaW / 2

    // Zero line
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(midX, 0); ctx.lineTo(midX, H - 20); ctx.stroke()

    sorted.forEach((c, i) => {
      const y = i * (barH + gap) + 4
      const pct = c.contributionPct
      const barW = Math.max(2, (Math.abs(pct) / maxAbs) * (barAreaW / 2 - 4))
      const color = pct >= 0 ? '#34C759' : '#FF3B30'
      const barX = pct >= 0 ? midX : midX - barW

      ctx.fillStyle = color + '25'; ctx.fillRect(barX, y, barW, barH)
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(barX, y, barW, barH)

      // Asset name
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = 'bold 9px JetBrains Mono'
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
      ctx.fillText(c.label, labelW - 4, y + barH/2)

      // Hurst badge
      const hMeta = hurstLabel(c.hurstExponent)
      ctx.fillStyle = hMeta.color + '30'
      const hw = 38; const hx = barX + (pct >= 0 ? 2 : barW - hw - 2)
      if (barW > hw + 4) { ctx.fillRect(hx, y + 3, hw, barH - 6); ctx.fillStyle = hMeta.color; ctx.font = '7px JetBrains Mono'; ctx.textAlign = 'center'; ctx.fillText(`H=${c.hurstExponent.toFixed(2)}`, hx + hw/2, y + barH/2) }

      // Values
      ctx.fillStyle = color; ctx.font = 'bold 9px JetBrains Mono'; ctx.textAlign = 'left'
      ctx.fillText(`${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(3)}%`, W - valW + 2, y + barH/2 - 4)
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '8px JetBrains Mono'
      ctx.fillText(`ret ${(c.return1d * 100).toFixed(1)}%`, W - valW + 2, y + barH/2 + 6)
    })

    ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.font = '8px Syne'; ctx.textAlign = 'center'
    ctx.fillText('CONTRIBUTION AU PANIER (contribution = poids × rendement)', W/2, H - 6)
  }, [components])

  const H = components.length * 25 + 30
  return <canvas ref={ref} style={{ width: '100%', height: H, display: 'block', borderRadius: 8 }} />
}

// ─── Component Hurst Chart ────────────────────────────────────────────────────

function HurstBarsChart({ components }: { components: DispersionResult['components'] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current; if (!canvas || !components.length) return
    const dpr = window.devicePixelRatio || 1
    const W = canvas.offsetWidth || 400, H = 60
    canvas.width = W * dpr; canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!; ctx.scale(dpr, dpr)
    ctx.fillStyle = '#080C14'; ctx.fillRect(0, 0, W, H)

    const N = components.length
    const bW = (W - 20) / N - 4
    const startX = 10

    // Threshold lines — semicolon-safe (avoid ASI issue: `10[...]` after no-semicolon const)
    const HURST_THRESHOLDS = [0.4, 0.5, 0.6]
    HURST_THRESHOLDS.forEach(v => {
      const y = H - 14 - v * (H - 22)
      ctx.strokeStyle = v === 0.5 ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)'
      ctx.lineWidth = v === 0.5 ? 1 : 0.5; ctx.setLineDash(v === 0.5 ? [] : [2,2])
      ctx.beginPath(); ctx.moveTo(10, y); ctx.lineTo(W - 10, y); ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.font = '6px JetBrains Mono'
      ctx.textAlign = 'left'; ctx.fillText(v.toFixed(1), 1, y + 3)
    })

    components.forEach((c, i) => {
      const x = startX + i * (bW + 4)
      const h = c.hurstExponent
      const bH = h * (H - 22)
      const y = H - 14 - bH
      const meta = hurstLabel(h)
      ctx.fillStyle = meta.color + '50'; ctx.fillRect(x, y, bW, bH)
      ctx.strokeStyle = meta.color; ctx.lineWidth = 1; ctx.strokeRect(x, y, bW, bH)
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '7px JetBrains Mono'; ctx.textAlign = 'center'
      ctx.fillText(c.label.slice(0,3), x + bW/2, H - 4)
      ctx.fillStyle = meta.color; ctx.font = 'bold 7px JetBrains Mono'
      ctx.fillText(h.toFixed(2), x + bW/2, y - 2)
    })
  }, [components])
  return <canvas ref={ref} style={{ width: '100%', height: 60, display: 'block', borderRadius: 6 }} />
}

// ─── Trade Signal Card ────────────────────────────────────────────────────────

function TradeSignalCard({ signal, basketHurst, basketAutocorr }: {
  signal: DispersionResult['tradeSignal']
  basketHurst: number
  basketAutocorr: number
}) {
  const [expanded, setExpanded] = useState(false)
  const scoreColor = signal.score > 70 ? '#34C759' : signal.score > 50 ? '#FF9500' : '#8E8E93'
  const actionColors: Record<string, string> = { dispersion: '#BF5AF2', momentum: '#00E5FF', neutral: '#8E8E93' }
  const dirLabels: Record<string, string> = { buy_laggards: '↩ Acheter laggards', buy_leaders: '↗ Suivre leaders', neutral: '— Attente' }
  const hMeta = hurstLabel(basketHurst)

  return (
    <div style={{ background: 'rgba(13,17,35,0.7)', borderRadius: 12, border: `1px solid ${actionColors[signal.action]}30`, padding: '12px 14px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 20 }}>{signal.action === 'dispersion' ? '📐' : signal.action === 'momentum' ? '📈' : '⏳'}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: actionColors[signal.action], fontFamily: 'Syne' }}>
            {signal.action === 'dispersion' ? 'DISPERSION TRADE' : signal.action === 'momentum' ? 'MOMENTUM TRADE' : 'EN ATTENTE'}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>
            {dirLabels[signal.direction]}
          </div>
        </div>
        {/* Score bar */}
        <div style={{ textAlign: 'center', minWidth: 50 }}>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'JetBrains Mono', color: scoreColor }}>{signal.score}</div>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)' }}>SCORE</div>
          <div style={{ width: 44, height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, marginTop: 2 }}>
            <div style={{ width: `${signal.score}%`, height: '100%', background: scoreColor, borderRadius: 2 }} />
          </div>
        </div>
        <div style={{ textAlign: 'center', minWidth: 50 }}>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'JetBrains Mono', color: '#FF9500' }}>{signal.confidence}</div>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)' }}>CONFIANCE</div>
          <div style={{ width: 44, height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, marginTop: 2 }}>
            <div style={{ width: `${signal.confidence}%`, height: '100%', background: '#FF9500', borderRadius: 2 }} />
          </div>
        </div>
      </div>

      {/* Basket stats */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        {[
          { label: 'Hurst', value: `H=${basketHurst.toFixed(2)}`, color: hMeta.color, sub: hMeta.text },
          { label: 'Autocorr', value: `${basketAutocorr >= 0 ? '+' : ''}${basketAutocorr.toFixed(2)}`, color: basketAutocorr > 0.1 ? '#34C759' : basketAutocorr < -0.1 ? '#FF3B30' : '#8E8E93', sub: basketAutocorr > 0.1 ? 'Momentum' : basketAutocorr < -0.1 ? 'Mean-Rev' : 'Neutre' },
        ].map(s => (
          <div key={s.label} style={{ padding: '4px 8px', borderRadius: 6, background: `${s.color}10`, border: `1px solid ${s.color}30`, textAlign: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 800, fontFamily: 'JetBrains Mono', color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)' }}>{s.sub}</div>
          </div>
        ))}
        {signal.action !== 'neutral' && (
          <>
            <div style={{ padding: '4px 8px', borderRadius: 6, background: 'rgba(52,199,89,0.08)', border: '1px solid rgba(52,199,89,0.2)' }}>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)', marginBottom: 2 }}>LONG CANDIDATES</div>
              {signal.topLongs.map(l => <div key={l} style={{ fontSize: 10, color: '#34C759', fontFamily: 'JetBrains Mono', fontWeight: 700 }}>{l}</div>)}
            </div>
            <div style={{ padding: '4px 8px', borderRadius: 6, background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.2)' }}>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)', marginBottom: 2 }}>SHORT CANDIDATES</div>
              {signal.topShorts.map(s => <div key={s} style={{ fontSize: 10, color: '#FF3B30', fontFamily: 'JetBrains Mono', fontWeight: 700 }}>{s}</div>)}
            </div>
          </>
        )}
      </div>

      {/* Reasoning */}
      <button onClick={() => setExpanded(e => !e)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 9, color: 'rgba(255,255,255,0.4)', padding: 0, marginBottom: expanded ? 8 : 0 }}>
        {expanded ? '▲' : '▼'} Raisonnement
      </button>
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {signal.reasoning.map((r, i) => (
            <div key={i} style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', padding: '3px 6px', borderLeft: `2px solid ${actionColors[signal.action]}60`, lineHeight: 1.4 }}>{r}</div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Breadth Bar ──────────────────────────────────────────────────────────────

function BreadthBar({ label, value, color, subtitle }: { label: string; value: number; color: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', fontFamily: 'Syne' }}>{label}</span>
        <span style={{ fontSize: 10, color, fontFamily: 'JetBrains Mono', fontWeight: 700 }}>{subtitle ?? `${value.toFixed(1)}%`}</span>
      </div>
      <div style={{ height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, value))}%`, background: color, borderRadius: 3, transition: 'width 0.5s', boxShadow: `0 0 6px ${color}60` }} />
      </div>
    </div>
  )
}

// ─── Component Table ──────────────────────────────────────────────────────────

function ComponentTable({ components }: { components: DispersionResult['components'] }) {
  const sorted = [...components].sort((a, b) => b.return1d - a.return1d)
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, fontFamily: 'JetBrains Mono' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            {['#', 'Asset', '1D', '5D', 'Vol', 'RSI', '≥EMA20', 'VWAP', 'Hurst', 'Autocorr', 'Sharpe', 'vs Basket'].map(h => (
              <th key={h} style={{ padding: '4px 6px', color: 'rgba(255,255,255,0.35)', textAlign: 'right', fontWeight: 600, fontSize: 9 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(c => {
            const hMeta = hurstLabel(c.hurstExponent)
            return (
              <tr key={c.symbol} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: 'rgba(255,255,255,0.35)', fontSize: 9 }}>{c.rank}</td>
                <td style={{ padding: '4px 6px', color: '#00E5FF', fontWeight: 700 }}>{c.label}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: c.return1d >= 0 ? '#34C759' : '#FF3B30' }}>{fmtPct(c.return1d*100)}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: c.return5d >= 0 ? '#34C759' : '#FF3B30' }}>{fmtPct(c.return5d*100)}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: 'rgba(255,255,255,0.6)' }}>{fmtVol(c.realizedVol)}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: c.rsi14 > 70 ? '#FF3B30' : c.rsi14 < 30 ? '#34C759' : 'rgba(255,255,255,0.7)' }}>{c.rsi14.toFixed(0)}</td>
                <td style={{ padding: '4px 6px', textAlign: 'center', color: c.aboveEma20 ? '#34C759' : '#FF3B30' }}>{c.aboveEma20 ? '✓' : '✗'}</td>
                <td style={{ padding: '4px 6px', textAlign: 'center', color: c.aboveVwap ? '#34C759' : '#FF3B30' }}>{c.aboveVwap ? '✓' : '✗'}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: hMeta.color, fontWeight: 700 }}>{c.hurstExponent.toFixed(2)}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: c.autocorr > 0.1 ? '#34C759' : c.autocorr < -0.1 ? '#FF3B30' : 'rgba(255,255,255,0.4)' }}>{c.autocorr >= 0 ? '+' : ''}{c.autocorr.toFixed(2)}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: c.sharpeLike > 0 ? '#34C759' : '#FF3B30' }}>{c.sharpeLike.toFixed(3)}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: c.divergenceFromBasket >= 0 ? '#34C759' : '#FF3B30' }}>{fmtPct(c.divergenceFromBasket*100)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

// Map main chart syncInterval → Binance kline interval for dispersion fetch
function mapChartToDispTF(interval: string): string {
  const m: Record<string, string> = {
    '5m':'5m', '15m':'15m', '30m':'30m',
    '1h':'1h', '2h':'2h', '4h':'4h',
    '12h':'12h', '1d':'1d', '1w':'1d',
  }
  return m[interval] ?? '1h'
}

export default function DispersionDashboard({ syncInterval, crosshairFrac, onCrosshairChange, visibleRange }: { syncInterval?: string; crosshairFrac?: number | null; onCrosshairChange?: (frac: number | null) => void; visibleRange?: { from: number; to: number; areaRatio?: number; fromMs?: number; toMs?: number } }) {
  const [basketId, setBasketId] = useState('crypto')
  const [tf, setTf] = useState(() => syncInterval ? mapChartToDispTF(syncInterval) : '1h')
  const [result, setResult] = useState<DispersionResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeView, setActiveView] = useState<'overview' | 'signal' | 'history' | 'leaders' | 'correlation' | 'components'>('overview')
  const timerRef = useRef<ReturnType<typeof window.setInterval> | null>(null)
  const currentBasket = BASKETS.find(b => b.id === basketId)?.configs ?? CRYPTO_BASKET

  // Sync TF when chart interval changes (unless user manually changed)
  const [userOverrideTf, setUserOverrideTf] = useState(false)
  useEffect(() => {
    if (syncInterval && !userOverrideTf) setTf(mapChartToDispTF(syncInterval))
  }, [syncInterval, userOverrideTf])

  const load = useCallback(async (configs: AssetConfig[], interval: string) => {
    setLoading(true); setError('')
    try {
      const res = await fetchAndCompute(configs, interval) // uses defaults: limit=500, historyPoints=100
      if (res) setResult(res)
      else setError('Données insuffisantes pour le panier sélectionné')
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load(currentBasket, tf)
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = window.setInterval(() => load(currentBasket, tf), 60_000)
    return () => { if (timerRef.current) window.clearInterval(timerRef.current) }
  }, [basketId, tf, load, currentBasket])

  const regime = result ? REGIME_META[result.regime] : null

  const card = (extra?: React.CSSProperties): React.CSSProperties => ({
    background: 'rgba(13,17,35,0.7)', backdropFilter: 'blur(12px)',
    borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)',
    padding: '12px 14px', ...extra,
  })
  const secTitle = (color = '#00E5FF'): React.CSSProperties => ({
    fontSize: 9, fontWeight: 700, color, letterSpacing: 1.8,
    textTransform: 'uppercase' as const, fontFamily: 'Syne', marginBottom: 10,
  })

  const arrowColor = (a: '↑'|'↓'|'→') => a === '↑' ? '#34C759' : a === '↓' ? '#FF3B30' : '#8E8E93'

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#00E5FF', fontFamily: 'Syne', flex: 1 }}>📊 Dispersion Analysis</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {BASKETS.map(b => (
            <button key={b.id} onClick={() => setBasketId(b.id)} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer', background: basketId===b.id?'rgba(0,229,255,0.15)':'rgba(255,255,255,0.04)', color: basketId===b.id?'#00E5FF':'rgba(255,255,255,0.5)', border: `1px solid ${basketId===b.id?'rgba(0,229,255,0.3)':'transparent'}` }}>{b.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {INTERVALS.map(iv => (
            <button key={iv.id} onClick={() => { setTf(iv.id); setUserOverrideTf(true) }} style={{ padding: '4px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer', background: tf===iv.id?'rgba(191,90,242,0.15)':'rgba(255,255,255,0.04)', color: tf===iv.id?'#BF5AF2':'rgba(255,255,255,0.5)', border: `1px solid ${tf===iv.id?'rgba(191,90,242,0.3)':'transparent'}` }}>{iv.label}</button>
          ))}
        </div>
        <button onClick={() => load(currentBasket, tf)} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 10, cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.1)' }}>{loading ? '⏳' : '↻'}</button>
        {syncInterval && !userOverrideTf && (
          <span style={{ fontSize: 9, color: 'rgba(0,229,255,0.6)', fontFamily: 'JetBrains Mono,monospace', border: '1px solid rgba(0,229,255,0.2)', borderRadius: 4, padding: '2px 6px' }}>
            ⚡ synced {syncInterval}
          </span>
        )}
        {userOverrideTf && (
          <button onClick={() => setUserOverrideTf(false)} style={{ fontSize: 9, color: 'rgba(255,149,0,0.7)', background: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.2)', borderRadius: 4, padding: '2px 6px', cursor: 'pointer' }}>
            🔗 resync
          </button>
        )}
      </div>

      {error && <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.2)', fontSize: 11, color: '#FF3B30' }}>{error}</div>}
      {loading && !result && <div style={{ ...card(), display:'flex', alignItems:'center', justifyContent:'center', height: 200, color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>Calcul en cours…</div>}

      {result && (<>
        {/* ── Regime Banner ── */}
        <div style={{ ...card({ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }), borderColor:`${regime?.color}40`, background:`${regime?.color}08` }}>
          <span style={{ fontSize: 22 }}>{regime?.icon}</span>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: regime?.color, fontFamily: 'Syne' }}>{regime?.label}</span>
              <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700, background:`${regime?.color}20`, color: regime?.color, fontFamily: 'JetBrains Mono' }}>{result.regimeConfidence}%</span>
            </div>
            <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', margin: 0 }}>{regime?.desc}</p>
          </div>
          {/* Hurst + autocorr pills */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(() => { const hm = hurstLabel(result.basketHurst); return (
              <div style={{ padding: '4px 10px', borderRadius: 8, background:`${hm.color}12`, border:`1px solid ${hm.color}30`, textAlign:'center' }}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>HURST PANIER</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: hm.color, fontFamily: 'JetBrains Mono' }}>H={result.basketHurst.toFixed(2)}</div>
                <div style={{ fontSize: 8, color: hm.color }}>{hm.text}</div>
              </div>
            )})()}
            <div style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>AUTOCORR</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: result.basketAutocorr > 0.1 ? '#34C759' : result.basketAutocorr < -0.1 ? '#FF3B30' : '#8E8E93', fontFamily: 'JetBrains Mono' }}>{result.basketAutocorr >= 0 ? '+' : ''}{result.basketAutocorr.toFixed(2)}</div>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)' }}>{result.basketAutocorr > 0.1 ? 'Momentum' : result.basketAutocorr < -0.1 ? 'Mean-Rev' : 'Neutre'}</div>
            </div>
            <div style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>KURTOSIS</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: Math.abs(result.returnKurtosis) > 2 ? '#FF9500' : '#8E8E93', fontFamily: 'JetBrains Mono' }}>{result.returnKurtosis >= 0 ? '+' : ''}{result.returnKurtosis.toFixed(2)}</div>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)' }}>{Math.abs(result.returnKurtosis) > 2 ? 'Fat tails' : 'Normal'}</div>
            </div>
            {result.smartMoneyBias !== 'neutral' && (
              <div style={{ padding: '4px 10px', borderRadius: 8, background: result.smartMoneyBias==='accumulation'?'rgba(52,199,89,0.1)':'rgba(255,59,48,0.1)', border: `1px solid ${result.smartMoneyBias==='accumulation'?'rgba(52,199,89,0.3)':'rgba(255,59,48,0.3)'}`, textAlign:'center' }}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>SMART MONEY</div>
                <div style={{ fontSize: 11, fontWeight: 800, color: result.smartMoneyBias==='accumulation'?'#34C759':'#FF3B30', fontFamily: 'JetBrains Mono' }}>{result.smartMoneyBias==='accumulation'?'⬆ ACCUM':'⬇ DISTRIB'}</div>
              </div>
            )}
            {result.hiddenWeakness && <div style={{ padding: '4px 8px', borderRadius: 8, background: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.2)', fontSize: 10, color: '#FF3B30' }}>⚠️ Faiblesse cachée</div>}
            {result.hiddenStrength && <div style={{ padding: '4px 8px', borderRadius: 8, background: 'rgba(52,199,89,0.1)', border: '1px solid rgba(52,199,89,0.2)', fontSize: 10, color: '#34C759' }}>💪 Force cachée</div>}
          </div>
        </div>

        {/* ── View tabs ── */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {[
            { id: 'overview',     label: '📊 Vue' },
            { id: 'signal',       label: '🎯 Signal' },
            { id: 'history',      label: '📈 Historique' },
            { id: 'leaders',      label: '🏆 Leaders' },
            { id: 'correlation',  label: '🔗 Corrélations' },
            { id: 'components',   label: '📋 Composants' },
          ].map(v => (
            <button key={v.id} onClick={() => setActiveView(v.id as typeof activeView)} style={{ padding: '5px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer', background: activeView===v.id?'rgba(0,229,255,0.12)':'rgba(255,255,255,0.04)', color: activeView===v.id?'#00E5FF':'rgba(255,255,255,0.5)', border: `1px solid ${activeView===v.id?'rgba(0,229,255,0.25)':'transparent'}` }}>{v.label}</button>
          ))}
        </div>

        {/* ── OVERVIEW ── */}
        {activeView === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
            {/* Gauges */}
            <div style={{ ...card({ gridColumn:'1/-1', display:'flex', gap:16, flexWrap:'wrap', alignItems:'center', justifyContent:'center' }) }}>
              {[
                { value: result.participationScore, label: 'Participation', color: '#34C759' },
                { value: result.riskOnScore, label: 'Risk-On', color: '#00E5FF' },
                { value: result.dispersionPercentile, label: 'Dispersion %ile', color: '#BF5AF2' },
                { value: result.correlationPercentile, label: 'Correlation %ile', color: '#FF9500' },
                { value: Math.round(50 + result.overallScore/2), label: 'Score Global', color: result.overallBias==='bullish'?'#34C759':result.overallBias==='bearish'?'#FF3B30':'#8E8E93' },
              ].map(g => <div key={g.label} style={{ textAlign:'center' }}><Gauge {...g} size={90} /></div>)}
            </div>

            {/* Dispersion */}
            <div style={card()}>
              <div style={secTitle('#BF5AF2')}>📐 Dispersion</div>
              {[
                { label: 'Brute', value: `${(result.dispersionRaw*100).toFixed(3)}%`, arrow: result.trendArrows.dispersion },
                { label: 'Moyenne hist.', value: `${(result.dispersionMA*100).toFixed(3)}%` },
                { label: 'Z-Score', value: `${result.dispersionZScore>=0?'+':''}${result.dispersionZScore.toFixed(2)}σ`, color: result.dispersionZScore>1.5?'#FF3B30':result.dispersionZScore<-1?'#34C759':'#8E8E93' },
                { label: 'Percentile', value: `${result.dispersionPercentile.toFixed(0)}e` },
                { label: 'Skew', value: `${result.returnSkew>=0?'+':''}${result.returnSkew.toFixed(2)}`, color: Math.abs(result.returnSkew)>0.5?'#FF9500':'rgba(255,255,255,0.6)' },
                { label: 'Kurtosis', value: `${result.returnKurtosis>=0?'+':''}${result.returnKurtosis.toFixed(2)}`, color: Math.abs(result.returnKurtosis)>2?'#FF9500':'rgba(255,255,255,0.6)' },
              ].map(r => (
                <div key={r.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{r.label}</span>
                  <span style={{ fontSize: 11, fontFamily:'JetBrains Mono', fontWeight:700, color: r.color??'rgba(255,255,255,0.9)', display:'flex', alignItems:'center', gap: 4 }}>
                    {r.value}
                    {r.arrow && <span style={{ color: arrowColor(r.arrow) }}>{r.arrow}</span>}
                  </span>
                </div>
              ))}
            </div>

            {/* Correlation */}
            <div style={card()}>
              <div style={secTitle('#FF9500')}>🔗 Corrélation</div>
              {[
                { label: 'Moy. pairée', value: result.avgCorrelation.toFixed(3), color: result.avgCorrelation>0.7?'#FF3B30':result.avgCorrelation<0.3?'#34C759':'#FF9500', arrow: result.trendArrows.correlation },
                { label: 'Z-Score', value: `${result.correlationZScore>=0?'+':''}${result.correlationZScore.toFixed(2)}σ` },
                { label: 'Percentile', value: `${result.correlationPercentile.toFixed(0)}e` },
                { label: 'Cross-sect mom.', value: fmtPct(result.crossSectionalMomentum*100), color: result.crossSectionalMomentum>0.01?'#34C759':result.crossSectionalMomentum<-0.01?'#FF3B30':'#8E8E93' },
                { label: 'Régime', value: result.avgCorrelation>0.7?'📦 Macro':result.avgCorrelation<0.3?'🎯 Alpha':'⚖️ Mixte' },
              ].map(r => (
                <div key={r.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{r.label}</span>
                  <span style={{ fontSize: 11, fontFamily:'JetBrains Mono', fontWeight:700, color: r.color??'rgba(255,255,255,0.9)', display:'flex', alignItems:'center', gap: 4 }}>
                    {r.value}
                    {r.arrow && <span style={{ color: arrowColor(r.arrow) }}>{r.arrow}</span>}
                  </span>
                </div>
              ))}
            </div>

            {/* Volatility */}
            <div style={card()}>
              <div style={secTitle('#00E5FF')}>📉 Volatilité</div>
              {[
                { label: 'Moy. composants', value: fmtVol(result.avgComponentVol) },
                { label: 'Indice réalisée', value: fmtVol(result.realizedIndexVol) },
                { label: 'Indice implicite', value: fmtVol(result.impliedIndexVol) },
                { label: 'RDP (spread)', value: fmtVol(result.volSpread), color: result.volSpread>0?'#34C759':'#FF3B30', arrow: result.trendArrows.volSpread },
                { label: 'Vol Z-Score', value: `${result.volZScore>=0?'+':''}${result.volZScore.toFixed(2)}σ` },
                { label: 'Régime', value: result.volRegime==='squeeze'?'🔴 Squeeze':result.volRegime==='expansion'?'🟢 Expansion':'⚪ Normal' },
              ].map(r => (
                <div key={r.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{r.label}</span>
                  <span style={{ fontSize: 11, fontFamily:'JetBrains Mono', fontWeight:700, color: r.color??'rgba(255,255,255,0.9)', display:'flex', alignItems:'center', gap: 4 }}>
                    {r.value}
                    {r.arrow && <span style={{ color: arrowColor(r.arrow) }}>{r.arrow}</span>}
                  </span>
                </div>
              ))}
            </div>

            {/* Breadth */}
            <div style={card()}>
              <div style={secTitle('#34C759')}>📊 Breadth</div>
              <BreadthBar label="% Composants haussiers" value={result.pctUp} color={result.pctUp>60?'#34C759':result.pctUp<40?'#FF3B30':'#FF9500'} />
              <BreadthBar label="% Au-dessus EMA20" value={result.pctAboveEma20} color="#00E5FF" />
              <BreadthBar label="% Au-dessus EMA50" value={result.pctAboveEma50} color="#42A5F5" />
              <BreadthBar label="Score participation" value={result.participationScore} color="#34C759" />
              <div style={{ marginTop: 6, fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'JetBrains Mono', display:'flex', gap: 8 }}>
                <span>A/D: <span style={{ color: result.advanceDeclineRatio>1?'#34C759':'#FF3B30', fontWeight:700 }}>{result.advanceDeclineRatio.toFixed(2)}</span></span>
                <span style={{ color: arrowColor(result.trendArrows.breadth) }}>{result.trendArrows.breadth}</span>
              </div>
            </div>

            {/* Smart money */}
            <div style={card()}>
              <div style={secTitle('#FF9500')}>🧠 Smart Money</div>
              {[
                { label: 'Panier', value: fmtPct(result.basketReturn*100), color: result.basketReturn>=0?'#34C759':'#FF3B30' },
                { label: 'Médiane', value: fmtPct(result.medianReturn*100) },
                { label: 'Divergence idx/med', value: fmtPct(result.indexVsMedianDivergence*100) },
                { label: 'Score distribution', value: `${result.distributionScore}/100`, color: result.distributionScore>60?'#FF3B30':'rgba(255,255,255,0.7)' },
                { label: 'Score accumulation', value: `${result.accumulationScore}/100`, color: result.accumulationScore>60?'#34C759':'rgba(255,255,255,0.7)' },
              ].map(r => (
                <div key={r.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{r.label}</span>
                  <span style={{ fontSize: 11, fontFamily:'JetBrains Mono', fontWeight:700, color: r.color??'rgba(255,255,255,0.9)' }}>{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── SIGNAL ── */}
        {activeView === 'signal' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <TradeSignalCard signal={result.tradeSignal} basketHurst={result.basketHurst} basketAutocorr={result.basketAutocorr} />

            {/* Mean reversion candidates */}
            <div style={card()}>
              <div style={secTitle('#00E5FF')}>🔁 Candidats Mean Reversion</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[...result.components].sort((a, b) => b.meanReversionScore - a.meanReversionScore).slice(0, 5).map(c => (
                  <div key={c.symbol} style={{ flex: '1 1 120px', padding: '8px 10px', borderRadius: 8, background: 'rgba(0,229,255,0.06)', border: '1px solid rgba(0,229,255,0.15)' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#00E5FF', fontFamily: 'JetBrains Mono' }}>{c.label}</div>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                      Score: <span style={{ color: '#FF9500', fontWeight: 700 }}>{c.meanReversionScore}</span>
                    </div>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)' }}>
                      vs basket: <span style={{ color: c.divergenceFromBasket >= 0 ? '#34C759' : '#FF3B30', fontWeight: 700 }}>{fmtPct(c.divergenceFromBasket*100)}</span>
                    </div>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)' }}>
                      H={c.hurstExponent.toFixed(2)} / AC={c.autocorr >= 0 ? '+' : ''}{c.autocorr.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Cross-sectional momentum */}
            <div style={card()}>
              <div style={secTitle('#34C759')}>📈 Cross-Sectional Momentum</div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'center', padding: '8px 16px', borderRadius: 8, background: result.crossSectionalMomentum>0?'rgba(52,199,89,0.1)':'rgba(255,59,48,0.1)', border: `1px solid ${result.crossSectionalMomentum>0?'rgba(52,199,89,0.3)':'rgba(255,59,48,0.3)'}` }}>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>TOP − BOTTOM QUARTILE</div>
                  <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'JetBrains Mono', color: result.crossSectionalMomentum>0?'#34C759':'#FF3B30' }}>{fmtPct(result.crossSectionalMomentum*100)}</div>
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', flex: 1 }}>
                  Mesure l'écart entre le quartile supérieur et inférieur des rendements.<br/>
                  Élevé = dispersion forte entre gagnants et perdants → opportunité long/short.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── HISTORY ── */}
        {activeView === 'history' && result.history.dispersion.length > 2 && (
          <div style={{ ...card(), display:'flex', flexDirection:'column', gap: 14 }}>
            <div style={secTitle()}>📈 Évolution des métriques clés — {result.history.dispersion.length} points</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <HistoryLineChart data={result.history.dispersion} timestamps={result.history.timestamps} label="DISPERSION" color="#BF5AF2" regimes={result.history.regimes} valueFormat={v => `${(v*100).toFixed(3)}%`} crosshairFrac={crosshairFrac} onCrosshairChange={onCrosshairChange} visibleRange={visibleRange} />
              <HistoryLineChart data={result.history.avgCorrelation} timestamps={result.history.timestamps} label="CORRÉLATION MOY" color="#FF9500" regimes={result.history.regimes} valueFormat={v => v.toFixed(3)} crosshairFrac={crosshairFrac} onCrosshairChange={onCrosshairChange} visibleRange={visibleRange} />
              <HistoryLineChart data={result.history.pctUp} timestamps={result.history.timestamps} label="BREADTH %" color="#34C759" regimes={result.history.regimes} valueFormat={v => `${v.toFixed(0)}%`} crosshairFrac={crosshairFrac} onCrosshairChange={onCrosshairChange} visibleRange={visibleRange} />
              <HistoryLineChart data={result.history.volSpread} timestamps={result.history.timestamps} label="VOL SPREAD (RDP)" color="#00E5FF" regimes={result.history.regimes} valueFormat={v => `${(v*100).toFixed(1)}%`} crosshairFrac={crosshairFrac} onCrosshairChange={onCrosshairChange} visibleRange={visibleRange} />
            </div>
            {/* Regime legend */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {(['expansion','compression','panic','trending','rotating'] as DispersionRegime[]).map(r => (
                <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: 'rgba(255,255,255,0.5)' }}>
                  <div style={{ width: 12, height: 12, borderRadius: 2, background: REGIME_META[r].color + '50' }} />
                  {REGIME_META[r].icon} {REGIME_META[r].label}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── LEADERS ── */}
        {activeView === 'leaders' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={card()}>
              <div style={secTitle('#34C759')}>🏆 Contribution au panier (waterfall)</div>
              <LeadersWaterfall components={result.components} />
            </div>
            <div style={card()}>
              <div style={secTitle(hurstLabel(result.basketHurst).color)}>📐 Hurst Exponent par composant</div>
              <HurstBarsChart components={result.components} />
              <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                {[{ label: 'H > 0.6 = Trending', color: '#34C759' }, { label: 'H ≈ 0.5 = Random walk', color: '#8E8E93' }, { label: 'H < 0.4 = Mean-reverting', color: '#00E5FF' }].map(l => (
                  <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: l.color }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: l.color }} />{l.label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── CORRELATION ── */}
        {activeView === 'correlation' && (
          <div style={{ ...card(), display:'flex', flexDirection:'column', alignItems:'center', gap: 14 }}>
            <div style={secTitle('#FF9500')}>🔗 Matrice de corrélation (Pearson rolling)</div>
            <CorrelationHeatmap matrix={result.correlationMatrix} labels={result.components.map(c => c.label)} size={Math.min(380, result.components.length*46)} />
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>🔴 = anticorrélé · ⚫ = neutre · 🔵 = corrélé</div>
          </div>
        )}

        {/* ── COMPONENTS ── */}
        {activeView === 'components' && (
          <div style={card()}>
            <div style={secTitle()}>📋 Composants — Hurst + Autocorr + Sharpe</div>
            <ComponentTable components={result.components} />
          </div>
        )}

        {/* ── Footer ── */}
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {[
            { label: 'Panier', value: fmtPct(result.basketReturn*100), color: result.basketReturn>=0?'#34C759':'#FF3B30' },
            { label: 'Biais', value: result.overallBias.toUpperCase(), color: result.overallBias==='bullish'?'#34C759':result.overallBias==='bearish'?'#FF3B30':'#8E8E93' },
            { label: 'Actifs', value: `${result.components.length}` },
            { label: 'TF', value: tf },
            { label: 'MàJ', value: new Date(result.timestamp).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) },
          ].map(s => (
            <div key={s.label} style={{ padding:'4px 10px', borderRadius:6, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.06)', display:'flex', gap:6, alignItems:'center' }}>
              <span style={{ fontSize:9, color:'rgba(255,255,255,0.4)' }}>{s.label}</span>
              <span style={{ fontSize:10, fontFamily:'JetBrains Mono', fontWeight:700, color: s.color??'rgba(255,255,255,0.8)' }}>{s.value}</span>
            </div>
          ))}
        </div>
      </>)}
    </div>
  )
}
