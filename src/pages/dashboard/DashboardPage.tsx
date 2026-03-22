// src/pages/dashboard/DashboardPage.tsx
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { format, subDays, startOfDay } from 'date-fns'
import { fr } from 'date-fns/locale'
import { useAppStore } from '@/store/appStore'
import { formatPnL, formatWinRate } from '@/utils/statistics'
import {
  IconPlus, IconTrendUp, IconTrendDown, IconChart,
  IconTrades, IconAlertes,
} from '@/components/ui/Icons'
import { clsx } from 'clsx'
import type { Trade } from '@/types'
import PnLChart from './PnLChart'

// ── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, positive, negative,
}: {
  label: string
  value: string
  sub?: string
  positive?: boolean
  negative?: boolean
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={clsx(
        'stat-value num',
        positive && 'text-profit',
        negative && 'text-loss',
        !positive && !negative && 'text-text-primary'
      )}>
        {value}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

// ── Weekly Heatmap ─────────────────────────────────────────────────────────

function WeeklyHeatmap({ trades }: { trades: Trade[] }) {
  const days = useMemo(() => {
    const map: Record<string, number> = {}
    const last30 = trades.filter(t =>
      t.status === 'closed' && t.pnl !== undefined && t.exitDate &&
      t.exitDate >= subDays(new Date(), 29)
    )
    for (const t of last30) {
      const key = format(startOfDay(t.exitDate!), 'yyyy-MM-dd')
      map[key] = (map[key] ?? 0) + t.pnl!
    }
    return Array.from({ length: 30 }, (_, i) => {
      const d   = subDays(new Date(), 29 - i)
      const key = format(startOfDay(d), 'yyyy-MM-dd')
      return { date: d, pnl: map[key] ?? null, key }
    })
  }, [trades])

  return (
    <div>
      <div className="text-xs text-text-tertiary mb-2">30 derniers jours</div>
      <div className="flex flex-wrap gap-1">
        {days.map(d => (
          <div
            key={d.key}
            title={`${format(d.date, 'dd/MM')} — ${d.pnl !== null ? formatPnL(d.pnl) : 'Pas de trade'}`}
            className={clsx(
              'w-5 h-5 rounded-sm transition-transform hover:scale-110 cursor-default',
              d.pnl === null  && 'bg-bg-tertiary',
              d.pnl !== null && d.pnl > 0  && 'bg-profit',
              d.pnl !== null && d.pnl < 0  && 'bg-loss',
              d.pnl !== null && d.pnl === 0 && 'bg-text-tertiary',
            )}
            style={d.pnl !== null ? { opacity: Math.min(0.3 + Math.abs(d.pnl) / 500, 1) } : {}}
          />
        ))}
      </div>
      <div className="flex items-center gap-3 mt-2 text-[10px] text-text-tertiary">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-profit inline-block" /> Profit</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-loss inline-block" /> Perte</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-bg-tertiary inline-block" /> Pas de trade</span>
      </div>
    </div>
  )
}

// ── Recent Trades ──────────────────────────────────────────────────────────

function RecentTrade({ trade }: { trade: Trade }) {
  const pnl = trade.pnl ?? 0
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
      <div className={clsx(
        'w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0',
        trade.direction === 'long'
          ? 'bg-profit bg-opacity-15 text-profit'
          : 'bg-loss bg-opacity-15 text-loss'
      )}>
        {trade.direction === 'long' ? <IconTrendUp size={14} /> : <IconTrendDown size={14} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-text-primary">{trade.symbol}</div>
        <div className="text-xs text-text-tertiary">
          {format(trade.entryDate, 'dd/MM/yyyy', { locale: fr })}
          {' · '}
          <span className="capitalize">{trade.direction}</span>
        </div>
      </div>
      <div className={clsx('text-sm font-semibold num', pnl >= 0 ? 'text-profit' : 'text-loss')}>
        {pnl >= 0 ? '+' : ''}{formatPnL(pnl)}
      </div>
    </div>
  )
}

// ── Main Dashboard ─────────────────────────────────────────────────────────

export default function DashboardPage() {
  const trades = useAppStore(s => s.trades)
  const stats  = useAppStore(s => s.stats)
  const user   = useAppStore(s => s.user)

  const recentTrades = useMemo(() =>
    trades.filter(t => t.status === 'closed').slice(0, 6),
    [trades]
  )

  const openTrades = trades.filter(t => t.status === 'open')

  return (
    <div className="page">
      {/* Header */}
      <div className="page-header flex items-start justify-between">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="text-sm text-text-secondary mt-1">
            Bonjour{user?.displayName ? `, ${user.displayName}` : ''} 👋
          </p>
        </div>
        <Link to="/trades?add=1" className="btn-primary flex items-center gap-2">
          <IconPlus size={16} />
          Ajouter un trade
        </Link>
      </div>

      {/* Open positions banner */}
      {openTrades.length > 0 && (
        <div className="mb-6 p-3 rounded-xl border border-brand-blue border-opacity-30 bg-brand-blue bg-opacity-5 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-brand-blue animate-pulse-slow shrink-0" />
          <span className="text-sm text-text-secondary">
            <span className="text-text-primary font-medium">{openTrades.length} position{openTrades.length > 1 ? 's' : ''} ouverte{openTrades.length > 1 ? 's' : ''}</span>
            {' '} — {openTrades.map(t => t.symbol).join(', ')}
          </span>
          <Link to="/trades" className="ml-auto text-xs text-brand-cyan hover:underline">Voir tout</Link>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="P&L Total"
          value={stats ? formatPnL(stats.totalPnL) : '—'}
          sub={`${stats?.totalTrades ?? 0} trades fermés`}
          positive={!!stats && stats.totalPnL > 0}
          negative={!!stats && stats.totalPnL < 0}
        />
        <StatCard
          label="Win Rate"
          value={stats ? formatWinRate(stats.winRate) : '—'}
          sub={`${stats?.winningTrades ?? 0}W / ${stats?.losingTrades ?? 0}L`}
          positive={!!stats && stats.winRate >= 0.5}
          negative={!!stats && stats.winRate < 0.4}
        />
        <StatCard
          label="Payoff Ratio"
          value={stats ? stats.payoffRatio.toFixed(2) : '—'}
          sub="avg win / avg loss"
          positive={!!stats && stats.payoffRatio >= 1.5}
        />
        <StatCard
          label="Expectancy"
          value={stats ? formatPnL(stats.expectancy) : '—'}
          sub="par trade"
          positive={!!stats && stats.expectancy > 0}
          negative={!!stats && stats.expectancy < 0}
        />
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Max Drawdown"
          value={stats ? formatPnL(stats.maxDrawdown) : '—'}
          negative={!!stats && stats.maxDrawdown > 0}
        />
        <StatCard
          label="Profit Factor"
          value={stats ? stats.profitFactor.toFixed(2) : '—'}
          positive={!!stats && stats.profitFactor >= 1.5}
        />
        <StatCard
          label="Meilleur trade"
          value={stats ? formatPnL(stats.bestTrade) : '—'}
          positive
        />
        <StatCard
          label="Série en cours"
          value={stats ? (stats.currentStreak > 0 ? `+${stats.currentStreak}` : `${stats.currentStreak}`) : '—'}
          sub="trades consécutifs"
          positive={!!stats && stats.currentStreak > 0}
          negative={!!stats && stats.currentStreak < 0}
        />
      </div>

      {/* Charts + recent trades */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
        {/* PnL Curve */}
        <div className="lg:col-span-2 card">
          <PnLChart trades={trades} />
        </div>

        {/* Heatmap */}
        <div className="card">
          <div className="section-title mb-4">Heatmap</div>
          <WeeklyHeatmap trades={trades} />
        </div>
      </div>

      {/* Long/Short breakdown */}
      {stats && stats.totalTrades > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
          <div className="card">
            <div className="section-title mb-4">Long vs Short</div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-profit" />
                  <span className="text-sm text-text-secondary">Long</span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-text-primary num">{stats.longsCount} trades</div>
                  <div className="text-xs text-text-tertiary">{formatWinRate(stats.longWinRate)} win rate</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 rounded-full bg-bg-tertiary overflow-hidden">
                  <div
                    className="h-full bg-profit rounded-full transition-all"
                    style={{ width: `${stats.longWinRate * 100}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-loss" />
                  <span className="text-sm text-text-secondary">Short</span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-text-primary num">{stats.shortsCount} trades</div>
                  <div className="text-xs text-text-tertiary">{formatWinRate(stats.shortWinRate)} win rate</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 rounded-full bg-bg-tertiary overflow-hidden">
                  <div
                    className="h-full bg-loss rounded-full transition-all"
                    style={{ width: `${stats.shortWinRate * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="section-title mb-4">Métriques avancées</div>
            <div className="space-y-2">
              {[
                { label: 'Sharpe Ratio',      value: stats.sharpeRatio.toFixed(2) },
                { label: 'Temps moyen',        value: `${Math.round(stats.avgHoldTime)}h` },
                { label: 'Meilleure série',    value: `${stats.maxWinStreak} trades` },
                { label: 'Pire série',         value: `${stats.maxLossStreak} trades` },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                  <span className="text-sm text-text-secondary">{label}</span>
                  <span className="text-sm font-medium text-text-primary num">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Recent trades */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="section-title">Trades récents</div>
          <Link to="/trades" className="text-xs text-brand-cyan hover:underline flex items-center gap-1">
            <IconTrades size={13} /> Voir tout
          </Link>
        </div>
        {recentTrades.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-text-tertiary">
            <IconAlertes size={28} />
            <div className="text-sm">Aucun trade pour l'instant</div>
            <Link to="/trades?add=1" className="btn-secondary text-xs">
              Ajouter mon premier trade
            </Link>
          </div>
        ) : (
          recentTrades.map(t => <RecentTrade key={t.id} trade={t} />)
        )}
      </div>
    </div>
  )
}
