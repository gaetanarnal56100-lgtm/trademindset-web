// ─── RenderWidget v2 ─────────────────────────────────────────────────────────
// Mappe un widgetId vers son composant.

import { lazy, Suspense } from 'react'
import { useState, useEffect } from 'react'
import { WidgetId } from '../types'
import {
  KPIBarWidget, LongShortWidget, MainMetricsWidget, AdvancedMetricsWidget,
  EmotionsWidget, RecentTradesWidget, StatsSummaryWidget,
  RSIWidget, MACDWidget, DivergenceWidget, SRWidget, VolumeCVDWidget, NewsTickerWidget,
} from './WidgetComponents'
import { subscribeTrades, tradePnL } from '@/services/firestore'
import type { Trade } from '@/services/firestore'

const MTFDashboard   = lazy(() => import('@/pages/analyse/MTFDashboard'))
const TradePlanCard  = lazy(() => import('@/pages/analyse/TradePlanCard'))
const PnLCurve       = lazy(() => import('../../PnLModal'))
const CalendarHeatmap = lazy(() => import('../LazyCalendarHeatmap'))
const AdvancedAnalytics = lazy(() => import('../LazyAdvancedAnalytics'))

function Skeleton() {
  return (
    <div className="p-4 flex flex-col gap-3 animate-pulse">
      {[40,60,80,55,70].map((w,i) => (
        <div key={i} className="h-3 bg-bg-tertiary rounded-full" style={{ width:`${w}%` }} />
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
    // ── Journal widgets (data via context) ──
    case 'kpi_bar':           return <KPIBarWidget />
    case 'long_short':        return <LongShortWidget />
    case 'main_metrics':      return <MainMetricsWidget />
    case 'advanced_metrics':  return <AdvancedMetricsWidget />
    case 'emotions':          return <EmotionsWidget />
    case 'recent_trades':     return <RecentTradesWidget />
    case 'stats_summary':     return <StatsSummaryWidget />

    // ── Heavy chart widgets ──
    case 'pnl_curve':
      return <PnLCurveWrapper />

    case 'heatmap':
      return (
        <Suspense fallback={<Skeleton />}>
          <CalendarHeatmap />
        </Suspense>
      )

    case 'advanced_analytics':
      return (
        <Suspense fallback={<Skeleton />}>
          <AdvancedAnalytics />
        </Suspense>
      )

    // ── Analysis widgets ──
    case 'rsi_block':          return <RSIWidget symbol={symbol} />
    case 'macd_block':         return <MACDWidget symbol={symbol} />
    case 'divergence_block':   return <DivergenceWidget symbol={symbol} />
    case 'sr_block':           return <SRWidget symbol={symbol} />
    case 'volume_cvd':         return <VolumeCVDWidget symbol={symbol} />
    case 'news_ticker':        return <NewsTickerWidget />

    case 'mtf_dashboard':
      return (
        <Suspense fallback={<Skeleton />}>
          <MTFDashboard symbol={symbol} />
        </Suspense>
      )

    case 'trade_plan':
      return <TradePlanWrapper symbol={symbol} />

    default:
      return (
        <div className="p-4 text-xs text-text-muted font-mono">
          Widget <code className="text-brand-cyan">{widgetId}</code> — à implémenter
        </div>
      )
  }
}

// ─── PnL Curve wrapper ────────────────────────────────────────────────────────
function PnLCurveWrapper() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [moods, setMoods] = useState<any[]>([])
  useEffect(() => subscribeTrades(setTrades), [])
  return (
    <Suspense fallback={<Skeleton />}>
      <PnLCurve trades={trades} moods={moods} />
    </Suspense>
  )
}

// ─── TradePlan wrapper ────────────────────────────────────────────────────────
function TradePlanWrapper({ symbol }: { symbol: string }) {
  const [price, setPrice] = useState(0)
  useEffect(() => {
    const isCrypto = /USDT$|BUSD$|BTC$|ETH$|BNB$/i.test(symbol)
    if (isCrypto) {
      fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol.toUpperCase()}`)
        .then(r => r.json()).then(d => setPrice(parseFloat(d.price ?? '0'))).catch(() => {})
    } else {
      setPrice(100)
    }
  }, [symbol])
  if (!price) return <Skeleton />
  return (
    <Suspense fallback={<Skeleton />}>
      <TradePlanCard symbol={symbol} price={price} />
    </Suspense>
  )
}
