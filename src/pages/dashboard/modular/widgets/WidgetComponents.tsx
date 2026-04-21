// ─── Widget Components v2 ─────────────────────────────────────────────────────
// Tous les widgets : journal (KPI, P&L, heatmap...) + analyse (RSI, MACD...)
// Futuristic Cyberpunk Flat Design — neon glow, glassmorphism, animated accents

import { useContext, useRef } from 'react'
import { motion } from 'framer-motion'
import { WidgetDataContext, type WidgetDataContextType } from '../WidgetDataContext'
import { DashboardCard, StatsRow } from '@/components/ui'

// ─── Shared helpers (copiés depuis DashboardPage pour cohérence) ──────────────
function fmtK(n: number) {
  const abs = Math.abs(n), s = n < 0 ? '-' : '+'
  if (abs >= 1_000_000) return `${s}$${(abs/1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `${s}$${(abs/1_000).toFixed(1)}K`
  return `${s}$${abs.toFixed(2)}`
}
function fmt(n: number, d = 2) { return Math.abs(n).toFixed(d) }
function fmtDate(d: Date) { return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) }
function Skel({ h = 20 }: { h?: number }) {
  return <div style={{ height: h, background: 'rgba(255,255,255,0.04)', borderRadius: 6 }} />
}

// ─── Futuristic KPI Card ─────────────────────────────────────────────────────
function FuturisticKPICard({
  label, value, sub, color, glowColor, icon,
}: {
  label: string; value: string; sub: string
  color: string; glowColor: string; icon: string
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl flex flex-col justify-between p-4 group"
      style={{
        background: 'rgba(10, 14, 23, 0.85)',
        border: `1px solid ${glowColor}30`,
        backdropFilter: 'blur(12px)',
        boxShadow: `0 0 20px ${glowColor}12, inset 0 1px 0 ${glowColor}15`,
        transition: 'all 0.2s cubic-bezier(0.16,1,0.3,1)',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = `0 0 30px ${glowColor}30, inset 0 1px 0 ${glowColor}25`
        ;(e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'
        ;(e.currentTarget as HTMLDivElement).style.borderColor = `${glowColor}60`
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = `0 0 20px ${glowColor}12, inset 0 1px 0 ${glowColor}15`
        ;(e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'
        ;(e.currentTarget as HTMLDivElement).style.borderColor = `${glowColor}30`
      }}
    >
      {/* Animated moving halo */}
      <motion.div
        className="absolute w-16 h-16 rounded-full blur-2xl pointer-events-none"
        style={{ background: `${glowColor}18` }}
        animate={{
          top: ['10%', '10%', '70%', '70%', '10%'],
          left: ['10%', '75%', '75%', '10%', '10%'],
        }}
        transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
      />

      {/* Top scan line */}
      <div className="absolute top-0 left-0 right-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${glowColor}60, transparent)` }} />

      {/* Corner accents */}
      <div className="absolute top-0 left-0 w-3 h-3 border-t border-l rounded-tl-2xl"
        style={{ borderColor: `${glowColor}80` }} />
      <div className="absolute top-0 right-0 w-3 h-3 border-t border-r rounded-tr-2xl"
        style={{ borderColor: `${glowColor}80` }} />
      <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l rounded-bl-2xl"
        style={{ borderColor: `${glowColor}50` }} />
      <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r rounded-br-2xl"
        style={{ borderColor: `${glowColor}50` }} />

      {/* Header */}
      <div className="flex items-center justify-between mb-3 relative z-10">
        <span className="text-[9px] font-bold tracking-[0.15em] uppercase"
          style={{ color: `${glowColor}99` }}>{label}</span>
        <span className="text-sm opacity-60">{icon}</span>
      </div>

      {/* Value */}
      <motion.div
        className="relative z-10 font-black font-mono leading-none"
        style={{
          fontSize: 'clamp(16px, 2vw, 24px)',
          color,
          textShadow: `0 0 20px ${glowColor}60`,
        }}
        animate={{ textShadow: [`0 0 12px ${glowColor}40`, `0 0 24px ${glowColor}70`, `0 0 12px ${glowColor}40`] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      >
        {value}
      </motion.div>

      {/* Sub */}
      <div className="text-[10px] mt-2 relative z-10"
        style={{ color: 'rgba(143,148,163,0.7)' }}>{sub}</div>

      {/* Bottom micro progress line */}
      <motion.div
        className="absolute bottom-0 left-0 h-[2px]"
        style={{ background: `linear-gradient(90deg, transparent, ${glowColor}, transparent)` }}
        animate={{ left: ['-100%', '100%'] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'linear', repeatDelay: 1 }}
      />
    </div>
  )
}

// ─── KPI Bar ─────────────────────────────────────────────────────────────────
export function KPIBarWidget() {
  const { s, loading, closed, open } = useContext(WidgetDataContext)
  const pnlPositive = s.totalPnL >= 0
  const winGood = s.winRate >= 50

  const items = [
    {
      label: 'Total P&L',
      value: loading ? '···' : fmtK(s.totalPnL),
      sub: `${closed.length} trades fermés`,
      color: pnlPositive ? '#22C759' : '#FF3B30',
      glowColor: pnlPositive ? '#22C759' : '#FF3B30',
      icon: pnlPositive ? '📈' : '📉',
    },
    {
      label: 'Win Rate',
      value: loading ? '···' : `${s.winRate.toFixed(1)}%`,
      sub: `${s.wins}W · ${s.losses}L`,
      color: winGood ? '#22C759' : '#FF3B30',
      glowColor: '#00E5FF',
      icon: '🎯',
    },
    {
      label: 'Ratio R/R',
      value: loading ? '···' : s.payoffRatio.toFixed(2),
      sub: 'Rendement / Risque',
      color: '#00E5FF',
      glowColor: '#0A85FF',
      icon: '⚖️',
    },
    {
      label: 'Positions',
      value: loading ? '···' : String(open.length),
      sub: open.length > 0 ? 'En cours' : 'Aucune ouverte',
      color: open.length > 0 ? '#FF9500' : 'rgba(143,148,163,0.6)',
      glowColor: open.length > 0 ? '#FF9500' : '#2A2F3E',
      icon: open.length > 0 ? '⚡' : '○',
    },
  ]

  return (
    <div className="grid grid-cols-4 gap-2.5 p-3 h-full">
      {items.map(item => (
        <FuturisticKPICard key={item.label} {...item} />
      ))}
    </div>
  )
}

// ─── Long / Short ─────────────────────────────────────────────────────────────
export function LongShortWidget() {
  const { s, loading } = useContext(WidgetDataContext)
  return (
    <div className="p-4 h-full flex flex-col gap-3">
      <div className="text-[9px] font-bold tracking-[0.15em] uppercase" style={{ color: 'rgba(0,229,255,0.6)' }}>Direction</div>
      <div className="grid grid-cols-2 gap-3 flex-1">
        {[
          { label:'LONG',  icon:'↑', wr:s.longWR,  pnl:s.longPnL,  count:s.longs,  c:'#22C759', glow:'#22C759' },
          { label:'SHORT', icon:'↓', wr:s.shortWR, pnl:s.shortPnL, count:s.shorts, c:'#FF3B30', glow:'#FF3B30' },
        ].map(({ label, icon, wr, pnl, count, c, glow }) => (
          <div key={label} className="relative rounded-2xl p-3 flex flex-col gap-2 overflow-hidden"
            style={{
              background: 'rgba(10,14,23,0.85)',
              border: `1px solid ${glow}25`,
              boxShadow: `0 0 16px ${glow}10, inset 0 1px 0 ${glow}12`,
              backdropFilter: 'blur(8px)',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = `0 0 28px ${glow}28, inset 0 1px 0 ${glow}20`; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = `0 0 16px ${glow}10, inset 0 1px 0 ${glow}12`; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)' }}
          >
            {/* Top scan line */}
            <div className="absolute top-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${glow}50, transparent)` }} />
            <div className="flex items-center gap-2 relative z-10">
              <div className="w-7 h-7 rounded-xl flex items-center justify-center text-sm font-black flex-shrink-0"
                style={{ background: `${glow}15`, color: c, border: `1px solid ${glow}30`, textShadow: `0 0 8px ${glow}` }}>{icon}</div>
              <span className="text-xs font-black tracking-widest" style={{ color: c, textShadow: `0 0 8px ${glow}50` }}>{label}</span>
            </div>
            {loading ? <Skel h={36} /> : (
              <>
                <motion.div className="text-2xl font-black font-mono relative z-10" style={{ color: c, textShadow: `0 0 16px ${glow}60` }}
                  animate={{ textShadow: [`0 0 8px ${glow}40`, `0 0 20px ${glow}70`, `0 0 8px ${glow}40`] }}
                  transition={{ duration: 3, repeat: Infinity }}>
                  {wr.toFixed(1)}<span className="text-sm font-normal" style={{ color: 'rgba(143,148,163,0.5)' }}>%</span>
                </motion.div>
                <div className="text-[10px] relative z-10" style={{ color: 'rgba(143,148,163,0.6)' }}>{count} trades</div>
                <div className="text-xs font-black font-mono relative z-10" style={{ color: pnl>=0?'#22C759':'#FF3B30', textShadow: `0 0 8px ${pnl>=0?'#22C75940':'#FF3B3040'}` }}>{fmtK(pnl)}</div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main Metrics ─────────────────────────────────────────────────────────────
export function MainMetricsWidget() {
  const { s, loading, closed } = useContext(WidgetDataContext)
  const items = loading ? [] : [
    { icon:'📈', value:`${s.winRate.toFixed(1)}%`, label:'Win Rate',    sub:`${s.wins}W / ${s.losses}L`, c:'#22C759', glow:'#22C759' },
    { icon:'💰', value:fmtK(s.totalPnL),           label:'Total P&L',   sub:`${closed.length} trades`,   c:'#00E5FF', glow:'#00E5FF' },
    { icon:'⇄',  value:s.payoffRatio.toFixed(2),   label:'Payoff Ratio',sub:'Gain / Perte',              c:'#0A85FF', glow:'#0A85FF' },
    { icon:'💳', value:fmtK(-s.fees),              label:'Fees',        sub:'Total estimé',              c:'#BF5AF2', glow:'#BF5AF2' },
  ]
  return (
    <div className="p-4 h-full flex flex-col gap-3">
      <div className="text-[9px] font-bold tracking-[0.15em] uppercase" style={{ color: 'rgba(0,229,255,0.6)' }}>Metrics</div>
      <div className="grid grid-cols-2 gap-2 flex-1">
        {loading ? [1,2,3,4].map(i => <Skel key={i} h={80} />) : items.map(({ icon, value, label, sub, c, glow }) => (
          <div key={label} className="relative rounded-2xl p-3 flex flex-col gap-1 overflow-hidden"
            style={{
              background: 'rgba(10,14,23,0.85)',
              border: `1px solid ${glow}25`,
              boxShadow: `0 0 12px ${glow}10`,
              backdropFilter: 'blur(8px)',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = `0 0 20px ${glow}25`; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLDivElement).style.borderColor = `${glow}40` }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = `0 0 12px ${glow}10`; (e.currentTarget as HTMLDivElement).style.transform = ''; (e.currentTarget as HTMLDivElement).style.borderColor = `${glow}25` }}
          >
            <div className="absolute top-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${glow}50, transparent)` }} />
            <span className="text-xs relative z-10">{icon}</span>
            <motion.div className="text-base font-black font-mono relative z-10" style={{ color: c }}
              animate={{ textShadow: [`0 0 6px ${glow}30`, `0 0 16px ${glow}60`, `0 0 6px ${glow}30`] }}
              transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}>
              {value}
            </motion.div>
            <div className="text-[9px] font-bold tracking-wide relative z-10" style={{ color: `${glow}80` }}>{label}</div>
            <div className="text-[9px] relative z-10" style={{ color: 'rgba(143,148,163,0.5)' }}>{sub}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Advanced Metrics ─────────────────────────────────────────────────────────
export function AdvancedMetricsWidget() {
  const { s, loading } = useContext(WidgetDataContext)
  const items = loading ? [] : [
    { icon:'📉', value:fmtK(-s.maxDD),       label:'Max Drawdown', sub:'Max loss',       c:'var(--tm-loss)',    bg:'rgba(255,59,48,0.07)',  border:'rgba(255,59,48,0.2)' },
    { icon:'📊', value:s.sharpe.toFixed(2),   label:'Sharpe Ratio', sub:'Return/Risk',    c:'var(--tm-blue)',   bg:'rgba(10,133,255,0.07)', border:'rgba(10,133,255,0.2)' },
    { icon:'🎯', value:fmtK(s.expectancy),    label:'Expectancy',   sub:'Avg gain/trade', c:'var(--tm-accent)', bg:'rgba(0,229,255,0.07)',  border:'rgba(0,229,255,0.2)' },
    { icon:'🔥', value:String(s.bestStreak),  label:'Best Streak',  sub:`${s.worstStreak} max losses`, c:'var(--tm-warning)', bg:'rgba(255,149,0,0.07)', border:'rgba(255,149,0,0.2)' },
  ]
  return (
    <div className="p-4 h-full flex flex-col gap-3">
      <div className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Advanced Metrics</div>
      <div className="grid grid-cols-2 gap-2 flex-1">
        {loading ? [1,2,3,4].map(i => <Skel key={i} h={80} />) : items.map(({ icon, value, label, sub, c, bg, border }) => (
          <div key={label} className="rounded-2xl p-3 flex flex-col gap-1 transition-all duration-150 hover:-translate-y-px"
            style={{ background: bg, border: `1px solid ${border}` }}>
            <span className="text-sm">{icon}</span>
            <div className="text-base font-black font-mono" style={{ color: c }}>{value}</div>
            <div className="text-[10px] font-semibold text-text-secondary">{label}</div>
            <div className="text-[10px] text-text-muted">{sub}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Emotions ─────────────────────────────────────────────────────────────────
export function EmotionsWidget() {
  const { emo, loading } = useContext(WidgetDataContext)
  if (!emo && !loading) return (
    <div className="p-4 text-xs text-text-muted text-center pt-8">Aucune donnée émotionnelle</div>
  )
  const items = emo ? [
    { tag:'ÉTAT MOYEN',    icon:'✅', value:emo.avgState, sub:`${emo.entries} entrées`,     c:'var(--tm-profit)', bg:'rgba(var(--tm-profit-rgb,34,199,89),0.06)',  bdr:'rgba(var(--tm-profit-rgb,34,199,89),0.15)' },
    { tag:'IMPACT',        icon:'⊜',  value:emo.impact,  sub:'Corrélation P&L',            c:'var(--tm-text-secondary)', bg:'rgba(255,255,255,0.02)',bdr:'var(--tm-border-sub)' },
    { tag:'RISQUE ÉMOTIONNEL', icon:'⚠️', value:emo.risk, sub:emo.consec>0?`${emo.consec} pertes consec.`:'Aucune série', c:'var(--tm-warning)', bg:'rgba(var(--tm-warning-rgb,255,149,0),0.06)', bdr:'rgba(var(--tm-warning-rgb,255,149,0),0.15)' },
    { tag:'IA CONSEIL',    icon:'▶',  value:emo.advice,  sub:'Recommandation',             c:'var(--tm-profit)', bg:'rgba(var(--tm-profit-rgb,34,199,89),0.06)',  bdr:'rgba(var(--tm-profit-rgb,34,199,89),0.15)' },
  ] : []
  return (
    <div className="p-4 h-full flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-purple-500/15 flex items-center justify-center text-base">💜</div>
        <span className="text-[11px] font-semibold text-text-secondary">Emotional Summary</span>
      </div>
      <div className="grid grid-cols-2 gap-2 flex-1">
        {loading ? [1,2,3,4].map(i => <Skel key={i} h={80} />) : items.map(({ tag, icon, value, sub, c, bg, bdr }) => (
          <div key={tag} className="rounded-xl p-3 flex flex-col gap-1" style={{ background:bg, border:`1px solid ${bdr}` }}>
            <div className="flex items-center gap-1.5">
              <span className="text-xs">{icon}</span>
              <span className="text-[8px] font-bold text-text-muted tracking-widest">{tag}</span>
            </div>
            <div className="text-sm font-bold text-text-primary">{value}</div>
            <div className="text-[10px]" style={{ color:c }}>{sub}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Recent Trades ────────────────────────────────────────────────────────────
export function RecentTradesWidget() {
  const { recent, loading, systems, tradePnLFn } = useContext(WidgetDataContext)
  const systemName  = (id: string) => systems.find(s => s.id === id)?.name  ?? '—'
  const systemColor = (id: string) => systems.find(s => s.id === id)?.color ?? 'var(--tm-accent)'
  return (
    <div className="p-4 h-full flex flex-col gap-3 overflow-auto">
      <div className="text-[11px] font-semibold text-text-secondary uppercase tracking-widest">Trades récents</div>
      {loading ? [1,2,3].map(i => <Skel key={i} h={44} />) : recent.length === 0 ? (
        <div className="text-center text-text-muted text-xs pt-6">Aucun trade</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {recent.map(t => {
            const pnl = tradePnLFn(t)
            const isLong = t.type === 'Long'
            return (
              <div key={t.id} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all duration-150 hover:-translate-y-px"
                style={{ background:'rgba(255,255,255,0.025)', border: '1px solid rgba(42,47,62,0.5)' }}>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{
                    background: isLong ? 'rgba(34,199,89,0.12)' : 'rgba(255,59,48,0.12)',
                    color: isLong ? 'var(--tm-profit)' : 'var(--tm-loss)',
                    border: `1px solid ${isLong ? 'rgba(34,199,89,0.2)' : 'rgba(255,59,48,0.2)'}`,
                  }}>
                  {isLong ? '↑' : '↓'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold font-mono text-text-primary truncate">{t.symbol}</div>
                  <div className="text-[10px] text-text-muted">{fmtDate(t.date)} · <span style={{ color:systemColor(t.systemId) }}>{systemName(t.systemId)}</span></div>
                </div>
                {t.status==='open'
                  ? <span className="text-[9px] font-bold px-2 py-0.5 rounded-lg uppercase tracking-wide" style={{ background:'rgba(255,149,0,0.12)', color:'var(--tm-warning)', border:'1px solid rgba(255,149,0,0.2)' }}>Live</span>
                  : <span className="text-xs font-bold font-mono" style={{ color:pnl>=0?'var(--tm-profit)':'var(--tm-loss)' }}>{fmtK(pnl)}</span>
                }
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Stats Summary ────────────────────────────────────────────────────────────
export function StatsSummaryWidget() {
  const { s, loading, closed } = useContext(WidgetDataContext)
  const rows = [
    { label:'Trades fermés',   value: closed.length,                    c:'var(--tm-text-primary)' },
    { label:'Gain moyen',      value: `+$${fmt(s.avgWin)}`,             c:'var(--tm-profit)' },
    { label:'Perte moyenne',   value: `-$${fmt(s.avgLoss)}`,            c:'var(--tm-loss)' },
    { label:'Série gagnante',  value: `${s.bestStreak} trades`,         c:'var(--tm-warning)' },
    { label:'Série perdante',  value: `${s.worstStreak} trades`,        c:'var(--tm-loss)' },
    { label:'Streak actuel',   value: s.currentStreak>0 ? `+${s.currentStreak} wins` : `${Math.abs(s.currentStreak)} losses`, c: s.currentStreak>0?'var(--tm-profit)':'var(--tm-loss)' },
  ]
  return (
    <div className="p-4 h-full flex flex-col gap-3 overflow-auto">
      <div className="text-[11px] font-semibold text-text-secondary uppercase tracking-widest">Statistiques</div>
      {loading ? [1,2,3,4,5].map(i => <Skel key={i} />) : (
        <div className="flex flex-col gap-2">
          {rows.map(({ label, value, c }) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-xs text-text-secondary">{label}</span>
              <span className="text-xs font-bold font-mono" style={{ color:c }}>{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Analysis widgets (RSI, MACD, Divergence, S/R, Volume/CVD) ───────────────
// Ces widgets utilisent symbol du store directement via props

export function RSIWidget({ symbol }: { symbol: string }) {
  const data = [
    { tf:'5m',  value:62.4, signal:'bull' as const },
    { tf:'15m', value:55.8, signal:'bull' as const },
    { tf:'1h',  value:71.2, signal:'bull' as const },
    { tf:'4h',  value:48.3, signal:'neutral' as const },
    { tf:'1d',  value:38.7, signal:'bear' as const },
  ]
  return (
    <div className="p-4 flex flex-col gap-2 h-full overflow-auto">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono px-2 py-0.5 rounded border font-semibold tracking-widest bg-profit/10 text-profit border-profit/20">HAUSSIER</span>
        <span className="text-[9px] font-mono text-text-muted">RSI(14)</span>
      </div>
      {data.map(d => {
        const color = d.signal==='bull' ? 'var(--tm-profit)' : d.signal==='bear' ? 'var(--tm-loss)' : 'var(--tm-warning)'
        return (
          <div key={d.tf} className="flex items-center gap-2 py-1 border-b border-border-subtle last:border-0">
            <span className="text-[10px] font-mono text-text-muted w-8 flex-shrink-0">{d.tf}</span>
            <div className="flex-1 h-1 bg-bg-tertiary rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width:`${d.value}%`, background:color }} />
            </div>
            <span className="text-xs font-mono font-semibold w-10 text-right" style={{ color }}>{d.value.toFixed(1)}</span>
          </div>
        )
      })}
    </div>
  )
}

export function MACDWidget({ symbol }: { symbol: string }) {
  const data = [
    { tf:'5m',  macd:0.024,  sig:0.018,  hist:0.006,  bull:true },
    { tf:'15m', macd:0.182,  sig:0.145,  hist:0.037,  bull:true },
    { tf:'1h',  macd:0.921,  sig:0.876,  hist:0.045,  bull:true },
    { tf:'4h',  macd:-0.43,  sig:-0.21,  hist:-0.22,  bull:false },
  ]
  return (
    <div className="p-4 flex flex-col gap-2 h-full overflow-auto">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono px-2 py-0.5 rounded border font-semibold tracking-widest bg-profit/10 text-profit border-profit/20">HAUSSIER</span>
        <span className="text-[9px] font-mono text-text-muted">MACD(12,26,9)</span>
      </div>
      <table className="w-full text-[10px] font-mono">
        <thead><tr className="text-text-muted border-b border-border-subtle">
          <th className="text-left pb-1 font-medium">TF</th>
          <th className="text-right pb-1 font-medium">MACD</th>
          <th className="text-right pb-1 font-medium">Hist.</th>
          <th className="text-right pb-1"></th>
        </tr></thead>
        <tbody>
          {data.map(d => (
            <tr key={d.tf} className="border-b border-border-subtle last:border-0">
              <td className="py-1 text-text-muted">{d.tf}</td>
              <td className={`py-1 text-right ${d.macd>=0?'text-profit':'text-loss'}`}>{d.macd>0?'+':''}{d.macd.toFixed(3)}</td>
              <td className={`py-1 text-right font-semibold ${d.hist>=0?'text-profit':'text-loss'}`}>{d.hist>0?'+':''}{d.hist.toFixed(3)}</td>
              <td className="py-1 text-right">{d.bull?'▲':'▼'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function DivergenceWidget({ symbol }: { symbol: string }) {
  const divs = [
    { tf:'1h', type:'Baissière cachée',   indicator:'RSI',  strength:78, color:'var(--tm-loss)' },
    { tf:'4h', type:'Haussière régulière',indicator:'MACD', strength:62, color:'var(--tm-profit)' },
    { tf:'1d', type:'Haussière cachée',   indicator:'VMC',  strength:45, color:'var(--tm-profit)' },
  ]
  return (
    <div className="p-4 flex flex-col gap-2 h-full overflow-auto">
      <span className="text-[10px] text-text-secondary">{divs.length} divergences actives</span>
      {divs.map((d, i) => (
        <div key={i} className="flex items-start gap-2 p-2 bg-bg-tertiary rounded-xl">
          <div className="w-0.5 self-stretch rounded-full flex-shrink-0" style={{ background:d.color }} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-text-primary truncate">{d.type}</span>
              <span className="text-[9px] font-mono text-text-muted flex-shrink-0">{d.tf}</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-bg-card text-text-secondary border border-border-subtle">{d.indicator}</span>
              <div className="flex-1 h-1 bg-bg-card rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width:`${d.strength}%`, background:d.color, opacity:0.7 }} />
              </div>
              <span className="text-[9px] font-mono text-text-muted">{d.strength}%</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function SRWidget({ symbol }: { symbol: string }) {
  const levels = [
    { price:71200, type:'R3', dist:+4.9, strength:3 },
    { price:69500, type:'R2', dist:+2.4, strength:2 },
    { price:68100, type:'R1', dist:+0.4, strength:1 },
    { price:67842, type:'PRIX', dist:0,  strength:0 },
    { price:66800, type:'S1', dist:-1.5, strength:1 },
    { price:65200, type:'S2', dist:-3.9, strength:2 },
    { price:63000, type:'S3', dist:-7.1, strength:3 },
  ]
  return (
    <div className="p-3 flex flex-col gap-0.5 h-full overflow-auto">
      {levels.map(l => (
        <div key={l.type}
          className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${l.type==='PRIX'?'bg-brand-cyan/10 border border-brand-cyan/20':'hover:bg-bg-tertiary'}`}>
          <span className={`text-[10px] font-mono font-semibold w-8 ${l.type.startsWith('R')?'text-loss':l.type==='PRIX'?'text-brand-cyan':'text-profit'}`}>{l.type}</span>
          <span className="text-xs font-mono text-text-primary flex-1">{l.price.toLocaleString('fr-FR')}</span>
          {l.dist !== 0 && <span className={`text-[10px] font-mono ${l.dist>0?'text-loss':'text-profit'}`}>{l.dist>0?'+':''}{l.dist.toFixed(1)}%</span>}
          <div className="flex gap-0.5">{[1,2,3].map(s=><div key={s} className={`w-1 h-1 rounded-full ${s<=l.strength?'bg-text-tertiary':'bg-bg-tertiary'}`}/>)}</div>
        </div>
      ))}
    </div>
  )
}

export function VolumeCVDWidget({ symbol }: { symbol: string }) {
  const bars = Array.from({ length: 24 }, (_, i) => ({
    vol: Math.random() * 100 + 20,
    delta: (Math.random() - 0.45) * 80,
    cvd: (i - 8) * 12 + Math.random() * 20,
  }))
  const maxVol = Math.max(...bars.map(b => b.vol))
  return (
    <div className="p-4 flex flex-col gap-3 h-full overflow-auto">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono px-2 py-0.5 rounded border font-semibold bg-profit/10 text-profit border-profit/20">HAUSSIER</span>
        <div className="flex gap-3 text-[10px] font-mono">
          <span className="text-profit">CVD +2.1M</span>
          <span className="text-brand-cyan">Vol 84.2K</span>
        </div>
      </div>
      <div className="flex items-end gap-0.5 flex-1 min-h-0" style={{ maxHeight: 80 }}>
        {bars.map((b, i) => (
          <div key={i} className="flex-1 flex flex-col justify-end">
            <div className="rounded-sm opacity-70" style={{
              height:`${(b.vol/maxVol)*100}%`,
              background: b.delta>=0 ? 'var(--tm-profit)' : 'var(--tm-loss)',
            }}/>
          </div>
        ))}
      </div>
      <div className="flex gap-3 text-[10px] text-text-muted font-mono">
        <span>Delta: <span className="text-profit">+18.4K</span></span>
        <span>OI: <span className="text-text-secondary">12.3B</span></span>
        <span>L/S: <span className="text-warning">0.94</span></span>
      </div>
    </div>
  )
}

export function NewsTickerWidget() {
  return (
    <div className="px-4 py-2 flex items-center gap-3 overflow-hidden h-full">
      <span className="text-[9px] font-mono font-bold px-2 py-0.5 bg-warning/10 text-warning border border-warning/20 rounded flex-shrink-0 animate-pulse">LIVE</span>
      <div className="flex-1 overflow-hidden">
        <p className="animate-ticker whitespace-nowrap text-[11px] text-text-secondary font-mono">
          BTC +2.3% · ETH +1.8% · SOL +4.1% · BNB -0.2% · DOGE +6.7% · FED rate decision pending · Macro data mixed · Options expiry Friday
        </p>
      </div>
    </div>
  )
}
