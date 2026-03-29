// ─── WidgetDataContext ────────────────────────────────────────────────────────
// Évite de re-fetcher les données Firestore dans chaque widget.
// Le ModularDashboard subscribe une seule fois et injecte via ce contexte.

import { createContext } from 'react'
import type { Trade, TradingSystem, MoodEntry } from '@/services/firestore'

// Re-export des types de stats (copiés depuis DashboardPage)
export interface DashboardStats {
  totalPnL: number; winRate: number; avgWin: number; avgLoss: number
  payoffRatio: number; expectancy: number; fees: number; maxDD: number
  sharpe: number; bestStreak: number; worstStreak: number; currentStreak: number
  wins: number; losses: number; total: number
  longs: number; shorts: number; longWR: number; shortWR: number
  longPnL: number; shortPnL: number
}

export interface DashboardEmotions {
  avgState: string; risk: string; impact: string; advice: string
  consec: number; entries: number
}

export interface WidgetDataContextType {
  trades: Trade[]
  systems: TradingSystem[]
  moods: MoodEntry[]
  loading: boolean
  s: DashboardStats
  emo: DashboardEmotions | null
  closed: Trade[]
  open: Trade[]
  recent: Trade[]
  period: string
  setPeriod: (p: string) => void
  tradePnLFn: (t: Trade) => number
}

const defaultStats: DashboardStats = {
  totalPnL:0, winRate:0, avgWin:0, avgLoss:0,
  payoffRatio:0, expectancy:0, fees:0, maxDD:0, sharpe:0,
  bestStreak:0, worstStreak:0, currentStreak:0,
  wins:0, losses:0, total:0,
  longs:0, shorts:0, longWR:0, shortWR:0, longPnL:0, shortPnL:0,
}

export const WidgetDataContext = createContext<WidgetDataContextType>({
  trades:[], systems:[], moods:[], loading:true,
  s: defaultStats, emo: null,
  closed:[], open:[], recent:[],
  period:'1M', setPeriod:()=>{},
  tradePnLFn:()=>0,
})
