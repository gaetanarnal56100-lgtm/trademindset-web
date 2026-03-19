// src/utils/statistics.ts
// Miroir de Services/Analytics/Statistics.swift

import type { Trade, TradeStats } from '@/types'

function safeT(d: any): number {
  if (!d) return 0
  if (typeof d?.getTime === 'function') { const t = d.getTime(); return isNaN(t) ? 0 : t }
  if (typeof d?.seconds === 'number') return d.seconds * 1000
  return 0
}

export function computeStats(trades: Trade[]): TradeStats {
  const closed = trades.filter(t => t.status === 'closed' && t.pnl !== undefined)

  if (closed.length === 0) {
    return emptyStats()
  }

  const winners = closed.filter(t => (t.pnl ?? 0) > 0)
  const losers  = closed.filter(t => (t.pnl ?? 0) < 0)

  const totalPnL    = closed.reduce((s, t) => s + (t.pnl ?? 0), 0)
  const winRate     = winners.length / closed.length
  const avgWin      = winners.length > 0 ? winners.reduce((s, t) => s + (t.pnl ?? 0), 0) / winners.length : 0
  const avgLoss     = losers.length  > 0 ? Math.abs(losers.reduce((s, t)  => s + (t.pnl ?? 0), 0) / losers.length) : 0
  const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : 0
  const expectancy  = winRate * avgWin - (1 - winRate) * avgLoss

  const longs  = closed.filter(t => t.direction === 'long')
  const shorts = closed.filter(t => t.direction === 'short')

  // Max drawdown
  let peak = 0, maxDD = 0, running = 0
  for (const t of [...closed].sort((a, b) => safeT(a.entryDate) - safeT(b.entryDate))) {
    running += t.pnl ?? 0
    if (running > peak) peak = running
    const dd = peak - running
    if (dd > maxDD) maxDD = dd
  }

  // Sharpe (simplified, daily returns assumed)
  const pnls   = closed.map(t => t.pnl ?? 0)
  const mean   = totalPnL / closed.length
  const stddev = Math.sqrt(pnls.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / closed.length)
  const sharpe = stddev > 0 ? mean / stddev : 0

  // Profit factor
  const grossProfit = winners.reduce((s, t) => s + (t.pnl ?? 0), 0)
  const grossLoss   = Math.abs(losers.reduce((s, t) => s + (t.pnl ?? 0), 0))
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0

  // Hold time
  const holdTimes = closed
    .filter(t => t.exitDate)
    .map(t => (safeT(t.exitDate) - safeT(t.entryDate)) / 3_600_000)
  const avgHoldTime = holdTimes.length > 0
    ? holdTimes.reduce((s, h) => s + h, 0) / holdTimes.length
    : 0

  // Streaks
  const sorted = [...closed].sort((a, b) => safeT(a.entryDate) - safeT(b.entryDate))
  let curStreak = 0, maxWin = 0, maxLoss = 0
  let streak = 0
  let lastWin: boolean | null = null
  for (const t of sorted) {
    const win = (t.pnl ?? 0) > 0
    if (lastWin === null || win === lastWin) {
      streak++
    } else {
      if (lastWin) maxWin  = Math.max(maxWin, streak)
      else         maxLoss = Math.max(maxLoss, streak)
      streak = 1
    }
    lastWin = win
  }
  if (lastWin !== null) {
    if (lastWin) maxWin  = Math.max(maxWin, streak)
    else         maxLoss = Math.max(maxLoss, streak)
  }
  if (sorted.length > 0) {
    const last = sorted[sorted.length - 1]
    const lastIsWin = (last.pnl ?? 0) > 0
    curStreak = 1
    for (let i = sorted.length - 2; i >= 0; i--) {
      if (((sorted[i].pnl ?? 0) > 0) === lastIsWin) curStreak++
      else break
    }
    if (!lastIsWin) curStreak = -curStreak
  }

  return {
    totalTrades:   closed.length,
    winningTrades: winners.length,
    losingTrades:  losers.length,
    winRate,
    totalPnL,
    averagePnL:    mean,
    bestTrade:     Math.max(...closed.map(t => t.pnl ?? 0)),
    worstTrade:    Math.min(...closed.map(t => t.pnl ?? 0)),
    payoffRatio,
    expectancy,
    maxDrawdown:   maxDD,
    sharpeRatio:   sharpe,
    profitFactor,
    avgHoldTime,
    longsCount:    longs.length,
    shortsCount:   shorts.length,
    longWinRate:   longs.filter(t => (t.pnl ?? 0) > 0).length / (longs.length || 1),
    shortWinRate:  shorts.filter(t => (t.pnl ?? 0) > 0).length / (shorts.length || 1),
    currentStreak: curStreak,
    maxWinStreak:  maxWin,
    maxLossStreak: maxLoss,
  }
}

function emptyStats(): TradeStats {
  return {
    totalTrades: 0, winningTrades: 0, losingTrades: 0,
    winRate: 0, totalPnL: 0, averagePnL: 0,
    bestTrade: 0, worstTrade: 0, payoffRatio: 0,
    expectancy: 0, maxDrawdown: 0, sharpeRatio: 0,
    profitFactor: 0, avgHoldTime: 0,
    longsCount: 0, shortsCount: 0,
    longWinRate: 0, shortWinRate: 0,
    currentStreak: 0, maxWinStreak: 0, maxLossStreak: 0,
  }
}

// ── Formatters ─────────────────────────────────────────────────────────────

export function formatPnL(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency', currency,
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value)
}

export function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
}

export function formatWinRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}
