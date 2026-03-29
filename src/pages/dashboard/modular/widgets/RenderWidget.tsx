// ─── Widget Renderer ─────────────────────────────────────────────────────────
// Maps a widgetId to its component. Add new widgets here — zero changes elsewhere.

import { lazy, Suspense, useState, useEffect } from 'react'
import { WidgetId } from '../types'
import {
  RSIWidget, MACDWidget, DivergenceWidget,
  SRWidget, VolumeCVDWidget, TradeStatsWidget,
} from './WidgetComponents'
import { subscribeTrades, tradePnL } from '@/services/firestore'
import type { Trade } from '@/services/firestore'

// Heavy widgets loaded lazily to keep initial bundle small
const MTFDashboard  = lazy(() => import('@/pages/analyse/MTFDashboard'))
const TradePlanCard = lazy(() => import('@/pages/analyse/TradePlanCard'))

function WidgetSkeleton() {
  return (
    <div className="p-4 flex flex-col gap-3 animate-pulse">
      {[40, 60, 80, 55, 70].map((w, i) => (
        <div key={i} className="h-3 bg-bg-tertiary rounded-full" style={{ width: `${w}%` }} />
      ))}
    </div>
  )
}

interface RenderWidgetProps {
  widgetId: WidgetId
  symbol: string
}

export function RenderWidget({ widgetId, symbol }: RenderWidgetProps) {
  switch (widgetId) {
    case 'rsi_block':       return <RSIWidget symbol={symbol} />
    case 'macd_block':      return <MACDWidget symbol={symbol} />
    case 'divergence_block':return <DivergenceWidget symbol={symbol} />
    case 'sr_block':        return <SRWidget symbol={symbol} />
    case 'volume_cvd':      return <VolumeCVDWidget symbol={symbol} />
    case 'trade_stats':     return <TradeStatsWidget symbol={symbol} />
    case 'pnl_curve':       return <PnLWidgetWrapper />
    case 'news_ticker':     return <NewsTickerPlaceholder />

    case 'mtf_dashboard':
      return (
        <Suspense fallback={<WidgetSkeleton />}>
          <MTFDashboard symbol={symbol} />
        </Suspense>
      )

    case 'trade_plan':
      return (
        <Suspense fallback={<WidgetSkeleton />}>
          <TradePlanCardWrapper symbol={symbol} />
        </Suspense>
      )

    default:
      return (
        <div className="p-4 text-xs text-text-muted font-mono">
          Widget <code className="text-brand-cyan">{widgetId}</code> — à implémenter
        </div>
      )
  }
}

// ─── PnL Widget Wrapper ───────────────────────────────────────────────────────
function PnLWidgetWrapper() {
  const [trades, setTrades] = useState<Trade[]>([])
  useEffect(() => subscribeTrades(setTrades), [])

  const closed = trades.filter(t => t.status === 'closed')
  let cum = 0
  const points = closed.map(t => { cum += tradePnL(t); return cum })

  if (!points.length) return <WidgetSkeleton />

  const min = Math.min(0, ...points)
  const max = Math.max(0, ...points)
  const range = max - min || 1
  const W = 300, H = 80
  const pts = points.map((v, i) =>
    `${(i / Math.max(1, points.length - 1)) * W},${H - ((v - min) / range) * H}`
  )
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p}`).join(' ')
  const last = points[points.length - 1]
  const color = last >= 0 ? '#22C759' : '#FF3B30'

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-mono font-semibold" style={{ color }}>
          {last >= 0 ? '+' : ''}{last.toFixed(2)} $
        </span>
        <span className="text-[10px] text-text-muted font-mono">{closed.length} trades fermés</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: 80 }}>
        <defs>
          <linearGradient id="pnlWidgetGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${d} L${W},${H} L0,${H} Z`} fill="url(#pnlWidgetGrad)" />
        <path d={d} fill="none" stroke={color} strokeWidth="1.5"
          vectorEffect="non-scaling-stroke" strokeLinecap="round" />
      </svg>
    </div>
  )
}

// ─── News Ticker Placeholder ──────────────────────────────────────────────────
function NewsTickerPlaceholder() {
  return (
    <div className="px-4 py-3 flex items-center gap-3 overflow-hidden">
      <span className="text-[10px] font-mono font-semibold px-2 py-0.5 bg-warning/10 text-warning border border-warning/20 rounded flex-shrink-0 animate-pulse">
        LIVE
      </span>
      <div className="flex-1 overflow-hidden">
        <p className="animate-ticker whitespace-nowrap text-[11px] text-text-secondary font-mono">
          BTC +2.3% · ETH +1.8% · SOL +4.1% · BNB -0.2% · DOGE +6.7% · Actualités en cours de chargement…
        </p>
      </div>
    </div>
  )
}

// ─── TradePlanCard Wrapper ─────────────────────────────────────────────────
// Fetches live price before rendering TradePlanCard which requires it
const TradePlanCardLazy = lazy(() => import('@/pages/analyse/TradePlanCard'))

function TradePlanCardWrapper({ symbol }: { symbol: string }) {
  const [price, setPrice] = useState(0)
  useEffect(() => {
    const isCrypto = /USDT$|BUSD$|BTC$|ETH$|BNB$/i.test(symbol)
    if (isCrypto) {
      fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol.toUpperCase()}`)
        .then(r => r.json()).then(d => setPrice(parseFloat(d.price ?? '0'))).catch(() => {})
    } else {
      setPrice(100) // fallback for stocks
    }
  }, [symbol])

  if (!price) return <WidgetSkeleton />
  return (
    <Suspense fallback={<WidgetSkeleton />}>
      <TradePlanCardLazy symbol={symbol} price={price} />
    </Suspense>
  )
}
