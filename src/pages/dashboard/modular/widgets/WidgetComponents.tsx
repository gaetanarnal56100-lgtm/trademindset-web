// ─── Widget Components ───────────────────────────────────────────────────────
// Each widget is self-contained and receives symbol via props.
// In production: replace mock data with real hooks pulling from MTFDashboard logic.

import { useState, useEffect, useRef } from 'react'

interface WidgetProps {
  symbol: string
}

// ─── Shared utils ────────────────────────────────────────────────────────────

function SignalBadge({ signal }: { signal: 'BUY' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'SELL' }) {
  const map = {
    BUY:     { text: 'ACHAT',    cls: 'bg-profit/10 text-profit border-profit/20' },
    BULLISH: { text: 'HAUSSIER', cls: 'bg-profit/10 text-profit border-profit/20' },
    NEUTRAL: { text: 'NEUTRE',   cls: 'bg-warning/10 text-warning border-warning/20' },
    BEARISH: { text: 'BAISSIER', cls: 'bg-loss/10 text-loss border-loss/20' },
    SELL:    { text: 'VENTE',    cls: 'bg-loss/10 text-loss border-loss/20' },
  }
  const { text, cls } = map[signal]
  return (
    <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border tracking-wider ${cls}`}>
      {text}
    </span>
  )
}

function TFRow({ tf, value, signal }: { tf: string; value: number; signal: 'bull' | 'bear' | 'neutral' }) {
  const color = signal === 'bull' ? '#22C759' : signal === 'bear' ? '#FF3B30' : '#FF9500'
  const pct = Math.min(100, Math.max(0, value))
  return (
    <div className="flex items-center gap-3 py-1.5 border-b border-border-subtle last:border-0">
      <span className="text-[10px] font-mono text-text-tertiary w-8 flex-shrink-0">{tf}</span>
      <div className="flex-1 h-1 bg-bg-tertiary rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-mono font-medium w-10 text-right" style={{ color }}>
        {value.toFixed(1)}
      </span>
    </div>
  )
}

function MiniSparkline({ values, color }: { values: number[]; color: string }) {
  if (!values.length) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const w = 80, h = 32
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * w,
    h - ((v - min) / range) * h,
  ])
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ')
  return (
    <svg width={w} height={h} className="overflow-visible">
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── RSI Widget ──────────────────────────────────────────────────────────────
export function RSIWidget({ symbol }: WidgetProps) {
  const data = [
    { tf: '5m', value: 62.4, signal: 'bull' as const },
    { tf: '15m', value: 55.8, signal: 'bull' as const },
    { tf: '1h', value: 71.2, signal: 'bull' as const },
    { tf: '4h', value: 48.3, signal: 'neutral' as const },
    { tf: '1d', value: 38.7, signal: 'bear' as const },
  ]
  const spark = [45, 50, 58, 55, 62, 68, 62, 65, 62]

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <SignalBadge signal="BULLISH" />
        <MiniSparkline values={spark} color="#0A85FF" />
      </div>
      <div className="flex flex-col">
        {data.map((d) => <TFRow key={d.tf} {...d} />)}
      </div>
      <div className="flex items-center justify-between pt-1">
        <span className="text-[10px] text-text-tertiary">Survente &lt;30 | Surachat &gt;70</span>
        <span className="text-[10px] font-mono text-brand-blue">RSI(14)</span>
      </div>
    </div>
  )
}

// ─── MACD Widget ─────────────────────────────────────────────────────────────
export function MACDWidget({ symbol }: WidgetProps) {
  const data = [
    { tf: '5m',  macd: 0.024, signal_line: 0.018, hist: 0.006,  cross: 'bull' as const },
    { tf: '15m', macd: 0.182, signal_line: 0.145, hist: 0.037,  cross: 'bull' as const },
    { tf: '1h',  macd: 0.921, signal_line: 0.876, hist: 0.045,  cross: 'bull' as const },
    { tf: '4h',  macd: -0.43, signal_line: -0.21, hist: -0.22,  cross: 'bear' as const },
  ]
  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <SignalBadge signal="BULLISH" />
        <span className="text-[10px] font-mono text-text-tertiary">MACD(12,26,9)</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] font-mono">
          <thead>
            <tr className="text-text-muted border-b border-border-subtle">
              <th className="text-left pb-1.5 font-medium">TF</th>
              <th className="text-right pb-1.5 font-medium">MACD</th>
              <th className="text-right pb-1.5 font-medium">Sig.</th>
              <th className="text-right pb-1.5 font-medium">Hist.</th>
              <th className="text-right pb-1.5 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.tf} className="border-b border-border-subtle last:border-0">
                <td className="py-1.5 text-text-tertiary">{d.tf}</td>
                <td className={`py-1.5 text-right ${d.macd >= 0 ? 'text-profit' : 'text-loss'}`}>
                  {d.macd > 0 ? '+' : ''}{d.macd.toFixed(3)}
                </td>
                <td className="py-1.5 text-right text-text-secondary">{d.signal_line.toFixed(3)}</td>
                <td className={`py-1.5 text-right font-semibold ${d.hist >= 0 ? 'text-profit' : 'text-loss'}`}>
                  {d.hist > 0 ? '+' : ''}{d.hist.toFixed(3)}
                </td>
                <td className="py-1.5 text-right">
                  <span className={`text-base ${d.cross === 'bull' ? 'text-profit' : 'text-loss'}`}>
                    {d.cross === 'bull' ? '▲' : '▼'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Divergence Widget ───────────────────────────────────────────────────────
export function DivergenceWidget({ symbol }: WidgetProps) {
  const divs = [
    { tf: '1h',  type: 'Baissière cachée', indicator: 'RSI',  strength: 78, color: '#FF3B30' },
    { tf: '4h',  type: 'Haussière régulière', indicator: 'MACD', strength: 62, color: '#22C759' },
    { tf: '1d',  type: 'Haussière cachée', indicator: 'VMC',  strength: 45, color: '#22C759' },
  ]
  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-secondary">{divs.length} divergences actives</span>
      </div>
      {divs.map((d, i) => (
        <div key={i} className="flex items-start gap-3 p-3 bg-bg-tertiary rounded-xl">
          <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ background: d.color }} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-text-primary truncate">{d.type}</span>
              <span className="text-[10px] font-mono text-text-tertiary flex-shrink-0">{d.tf}</span>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-bg-card text-text-secondary border border-border-subtle">
                {d.indicator}
              </span>
              <div className="flex-1 h-1 bg-bg-card rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${d.strength}%`, background: d.color, opacity: 0.7 }} />
              </div>
              <span className="text-[9px] font-mono text-text-muted">{d.strength}%</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── S/R Widget ──────────────────────────────────────────────────────────────
export function SRWidget({ symbol }: WidgetProps) {
  const price = 67842
  const levels = [
    { price: 71200, type: 'R3', dist: +4.9, strength: 3 },
    { price: 69500, type: 'R2', dist: +2.4, strength: 2 },
    { price: 68100, type: 'R1', dist: +0.4, strength: 1 },
    { price: 67842, type: 'PRIX', dist: 0,  strength: 0 },
    { price: 66800, type: 'S1', dist: -1.5, strength: 1 },
    { price: 65200, type: 'S2', dist: -3.9, strength: 2 },
    { price: 63000, type: 'S3', dist: -7.1, strength: 3 },
  ]
  return (
    <div className="p-4 flex flex-col gap-1">
      {levels.map((l) => (
        <div key={l.type}
          className={`flex items-center gap-3 px-3 py-1.5 rounded-lg transition-colors
            ${l.type === 'PRIX' ? 'bg-brand-cyan/10 border border-brand-cyan/20' : 'hover:bg-bg-tertiary'}`}
        >
          <span className={`text-[10px] font-mono font-semibold w-8
            ${l.type.startsWith('R') ? 'text-loss' : l.type === 'PRIX' ? 'text-brand-cyan' : 'text-profit'}`}>
            {l.type}
          </span>
          <span className="text-xs font-mono text-text-primary flex-1">
            {l.price.toLocaleString('fr-FR')}
          </span>
          {l.dist !== 0 && (
            <span className={`text-[10px] font-mono ${l.dist > 0 ? 'text-loss' : 'text-profit'}`}>
              {l.dist > 0 ? '+' : ''}{l.dist.toFixed(1)}%
            </span>
          )}
          <div className="flex gap-0.5">
            {[1, 2, 3].map((s) => (
              <div key={s} className={`w-1 h-1 rounded-full ${s <= l.strength ? 'bg-text-tertiary' : 'bg-bg-tertiary'}`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Volume / CVD Widget ─────────────────────────────────────────────────────
export function VolumeCVDWidget({ symbol }: WidgetProps) {
  const bars = Array.from({ length: 24 }, (_, i) => ({
    vol: Math.random() * 100 + 20,
    delta: (Math.random() - 0.45) * 80,
    cvd: (i - 8) * 12 + Math.random() * 20,
  }))

  const maxVol = Math.max(...bars.map((b) => b.vol))
  const maxAbs = Math.max(...bars.map((b) => Math.abs(b.delta)))

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <SignalBadge signal="BULLISH" />
        <div className="flex items-center gap-3 text-[10px] font-mono">
          <span className="text-profit">CVD +2.1M</span>
          <span className="text-text-tertiary">|</span>
          <span className="text-brand-cyan">Vol 84.2K</span>
        </div>
      </div>

      {/* Volume bars */}
      <div className="flex items-end gap-0.5 h-14">
        {bars.map((b, i) => (
          <div key={i} className="flex-1 flex flex-col justify-end gap-0.5">
            <div
              className="rounded-sm opacity-70 transition-all"
              style={{
                height: `${(b.vol / maxVol) * 100}%`,
                background: b.delta >= 0 ? '#22C759' : '#FF3B30',
              }}
            />
          </div>
        ))}
      </div>

      {/* CVD line */}
      <div className="h-10 relative">
        <svg width="100%" height="100%" preserveAspectRatio="none" viewBox={`0 0 ${bars.length} 100`}>
          <defs>
            <linearGradient id="cvdGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#00E5FF" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#00E5FF" stopOpacity="0" />
            </linearGradient>
          </defs>
          {(() => {
            const cvds = bars.map((b) => b.cvd)
            const min = Math.min(...cvds), max = Math.max(...cvds)
            const range = max - min || 1
            const pts = cvds.map((v, i) => `${i},${100 - ((v - min) / range) * 90}`)
            const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p}`).join(' ')
            const fill = `${line} L${cvds.length - 1},100 L0,100 Z`
            return (
              <>
                <path d={fill} fill="url(#cvdGrad)" />
                <path d={line} fill="none" stroke="#00E5FF" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              </>
            )
          })()}
        </svg>
        <span className="absolute bottom-0 right-0 text-[9px] font-mono text-brand-cyan/60">CVD</span>
      </div>

      <div className="flex items-center gap-4 text-[10px] text-text-muted font-mono">
        <span>Delta: <span className="text-profit">+18.4K</span></span>
        <span>OI: <span className="text-text-secondary">12.3B</span></span>
        <span>L/S: <span className="text-warning">0.94</span></span>
      </div>
    </div>
  )
}

// ─── Trade Stats Widget (minimal, full version in TradesPage) ────────────────
export function TradeStatsWidget({ symbol }: WidgetProps) {
  const stats = [
    { label: 'Win rate',    value: '67.3%', color: '#22C759' },
    { label: 'Profit factor', value: '2.14', color: '#22C759' },
    { label: 'Expectancy',  value: '+0.82R', color: '#22C759' },
    { label: 'Max DD',      value: '-8.4%', color: '#FF3B30' },
    { label: 'Trades',      value: '124', color: '#8F94A3' },
    { label: 'Avg R:R',     value: '1:2.3', color: '#0A85FF' },
  ]
  return (
    <div className="p-4 grid grid-cols-2 gap-2">
      {stats.map((s) => (
        <div key={s.label} className="bg-bg-tertiary rounded-xl p-3">
          <div className="text-[10px] text-text-muted mb-1">{s.label}</div>
          <div className="text-sm font-mono font-semibold" style={{ color: s.color }}>{s.value}</div>
        </div>
      ))}
    </div>
  )
}
