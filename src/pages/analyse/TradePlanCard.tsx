// TradePlanCard.tsx — Dynamic Execution-Ready Trade Plan
// Full context-aware system: activation conditions, dynamic probability, NO TRADE, adaptive risk

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'

const fbFn = getFunctions(app, 'europe-west1')

// ── Types ──────────────────────────────────────────────────────────────────

interface KeyLevel { price: number; type: string; strength?: number }

interface TradeScenario {
  entry?: number
  stop?: number
  tp1?: number; tp1RR?: string
  tp2?: number; tp2RR?: string
  tp3?: number; tp3RR?: string
  entryType?: string
  signalStrength?: 'none'|'moderate'|'strong'|'premium'
  activationConditions?: string[]
  notes?: string
  isCounterTrend?: boolean
}

interface TradePlanData {
  bull: TradeScenario
  bear: TradeScenario
  globalScore: number
  bullProb: number
  riskLevel: 'low'|'medium'|'high'
  context: string
  // Extended fields
  setupQuality: 'low'|'medium'|'high'
  noTrade: boolean
  noTradeReason?: string
  primaryBias: 'bull'|'bear'|'neutral'
  confluenceScore: number
  sessionAdvice?: string
}

interface GPTSections {
  riskLines: string[]
  timingLines: string[]
  technicalLines: string[]
  infoLines: string[]
  fundamentalLines: string[]
  scoreExplanation: string
}

export type { TradePlanData, GPTSections, TradeScenario }

// ── Timeframe presets ──────────────────────────────────────────────────────

type TradingStyle = 'scalping' | 'intraday' | 'swing' | 'position'

interface StyleConfig {
  id: TradingStyle
  emoji: string
  label: string
  sublabel: string        // duration hint
  chartTfs: string[]      // chart intervals that map here by default
  atrMult: number         // multiplier on base ATR for stop sizing
  tpMult: number          // multiplier on risk for TP1/2/3
  riskPct: string         // suggested % per trade
  sessionCritical: boolean
  color: string
}

const STYLES: StyleConfig[] = [
  {
    id: 'scalping',
    emoji: '⚡', label: 'Scalping', sublabel: 'Minutes · 1–5m',
    chartTfs: ['1m','3m','5m'],
    atrMult: 0.25, tpMult: 1.0,
    riskPct: '0.25–0.5%', sessionCritical: true, color: '#BF5AF2',
  },
  {
    id: 'intraday',
    emoji: '🌅', label: 'Intraday', sublabel: 'Hours · 15m–1h',
    chartTfs: ['15m','30m','1h'],
    atrMult: 1.0, tpMult: 1.0,
    riskPct: '0.5–1%', sessionCritical: true, color: '#0A85FF',
  },
  {
    id: 'swing',
    emoji: '📈', label: 'Swing', sublabel: 'Days · 4h–1d',
    chartTfs: ['4h','8h','12h','1d'],
    atrMult: 2.5, tpMult: 1.5,
    riskPct: '1–2%', sessionCritical: false, color: '#34C759',
  },
  {
    id: 'position',
    emoji: '🏔️', label: 'Position', sublabel: 'Weeks · 1w+',
    chartTfs: ['3d','1w'],
    atrMult: 5.0, tpMult: 2.0,
    riskPct: '2–3%', sessionCritical: false, color: '#FF9500',
  },
]

function styleFromInterval(interval: string): TradingStyle {
  for (const s of STYLES) {
    if (s.chartTfs.includes(interval)) return s.id
  }
  // fallback heuristic
  if (['1m','3m','5m'].includes(interval)) return 'scalping'
  if (['15m','30m','1h'].includes(interval)) return 'intraday'
  if (['4h','8h','12h','1d'].includes(interval)) return 'swing'
  return 'position'
}

interface Props {
  symbol: string
  price: number
  chartInterval?: string  // current chart TF → sets default style
  mtfScore?: number
  mtfSignal?: string
  mtfConfluence?: number
  wtStatus?: string
  vmcStatus?: string
  ouExcess?: string
  ouZ?: number
  ouRegime?: string
  confluenceSignal?: string
  keyLevels?: KeyLevel[]
  isCrypto?: boolean
  onPlanReady?: (plan: TradePlanData, gptSections: GPTSections | null) => void
}

// ── Formatters ─────────────────────────────────────────────────────────────

function fmtP(p: number): string {
  return p >= 10000 ? p.toFixed(0) : p >= 100 ? p.toFixed(2) : p >= 1 ? p.toFixed(4) : p.toFixed(6)
}

function fmtPct(n: number): string { return `${n.toFixed(0)}%` }

function calcATR(price: number, mtfScore: number): number {
  const basePct = price > 50000 ? 0.012 : price > 1000 ? 0.018 : price > 10 ? 0.025 : 0.03
  return price * basePct * (1 + Math.abs(mtfScore) / 200)
}

// ── Smart level finder ─────────────────────────────────────────────────────

function nearestLevel(price: number, levels: KeyLevel[], direction: 'above'|'below', maxPct = 0.05): KeyLevel | null {
  const candidates = levels.filter(l => {
    const pct = Math.abs(l.price - price) / price
    return pct < maxPct && (direction === 'above' ? l.price > price : l.price < price)
  })
  if (!candidates.length) return null
  return candidates.sort((a, b) =>
    Math.abs(a.price - price) - Math.abs(b.price - price)
  )[0]
}

// ── Core decision engine ────────────────────────────────────────────────────

function generateScenarios(
  price: number,
  mtfScore: number,
  mtfConfluence: number,
  wtStatus: string,
  vmcStatus: string,
  ouExcess: string,
  ouZ: number,
  ouRegime: string,
  confluenceSignal: string,
  keyLevels: KeyLevel[],
  _isCrypto: boolean,
  style: StyleConfig,
): TradePlanData {
  const baseAtr = calcATR(price, mtfScore)
  const atr = baseAtr * style.atrMult

  // ── 1. Signal alignment ──────────────────────────────────────────────────
  const wtBull = ['Bullish Reversal','Smart Bullish','Oversold'].includes(wtStatus)
  const wtBear = ['Bearish Reversal','Smart Bearish','Overbought'].includes(wtStatus)
  const vmcBull = ['BUY','OVERSOLD'].includes(vmcStatus)
  const vmcBear = ['SELL','OVERBOUGHT'].includes(vmcStatus)
  const ouBull  = ouExcess === 'oversold' || ouExcess === 'extreme_os'
  const ouBear  = ouExcess === 'overbought' || ouExcess === 'extreme_ob'
  const mtfBull = mtfScore < -20
  const mtfBear = mtfScore > 20
  const confBull = confluenceSignal === 'long' || confluenceSignal === 'setup_long'
  const confBear = confluenceSignal === 'short' || confluenceSignal === 'setup_short'

  // Signal counts
  const bullSignals = [wtBull, vmcBull, ouBull, mtfBull, confBull].filter(Boolean).length
  const bearSignals = [wtBear, vmcBear, ouBear, mtfBear, confBear].filter(Boolean).length

  // ── 2. Primary bias ──────────────────────────────────────────────────────
  const primaryBias: TradePlanData['primaryBias'] =
    bullSignals >= 3 ? 'bull'
    : bearSignals >= 3 ? 'bear'
    : bullSignals > bearSignals ? 'bull'
    : bearSignals > bullSignals ? 'bear'
    : 'neutral'

  // ── 3. Confluence score (0–100) ──────────────────────────────────────────
  // MTF confluence weight 40%, signal alignment 35%, OU regime 25%
  const signalAlignPct = primaryBias === 'bull' ? (bullSignals / 5) * 100
    : primaryBias === 'bear' ? (bearSignals / 5) * 100
    : 50 - Math.abs(bullSignals - bearSignals) * 10
  const ouRegimeBonus = ouRegime === 'ranging' ? 20 : ouRegime === 'breakout' ? 10 : 0
  const confluenceScore = Math.round(
    mtfConfluence * 0.40 + signalAlignPct * 0.35 + ouRegimeBonus * 0.25
  )

  // ── 4. NO TRADE detection ────────────────────────────────────────────────
  const conflicting = (wtBull && vmcBear) || (wtBear && vmcBull)
  const noTrade = confluenceScore < 25
    || (Math.abs(ouZ) < 0.5 && ouRegime === 'ranging' && bullSignals === bearSignals)
    || conflicting
  const noTradeReason = conflicting
    ? 'Conflicting signals (WT vs VMC)'
    : confluenceScore < 25
      ? `Low confluence (${confluenceScore}%) — wait for alignment`
      : 'Market in equilibrium — no statistical edge'

  // ── 5. Setup quality ─────────────────────────────────────────────────────
  const setupQuality: TradePlanData['setupQuality'] =
    confluenceScore >= 65 ? 'high'
    : confluenceScore >= 40 ? 'medium'
    : 'low'

  // ── 6. Bull scenario ─────────────────────────────────────────────────────
  const bullStrength: TradeScenario['signalStrength'] =
    bullSignals >= 4 ? 'premium'
    : bullSignals >= 3 ? 'strong'
    : bullSignals >= 2 ? 'moderate'
    : 'none'

  // Find nearest support for stop, resistance for TP
  const nearSupport  = nearestLevel(price, keyLevels, 'below')
  const nearResist   = nearestLevel(price, keyLevels, 'above')

  const bullMult = { premium:0.8, strong:1.0, moderate:1.4, none:2.0 }[bullStrength]
  const bullEntry = nearSupport
    ? Math.min(price + atr * 0.15, price + atr * 0.3 * bullMult)
    : price + atr * 0.3 * bullMult
  const bullStop = nearSupport
    ? Math.min(nearSupport.price - atr * 0.3, price - atr * 1.2 * bullMult)
    : price - atr * 1.5 * bullMult
  const bullRisk = Math.max(bullEntry - bullStop, atr * 0.5)
  const bullTp1 = nearResist ? Math.min(nearResist.price * 0.998, bullEntry + bullRisk * 1.5 * style.tpMult) : bullEntry + bullRisk * 1.5 * style.tpMult
  const bullTp2 = bullEntry + bullRisk * 2.5 * style.tpMult
  const bullTp3 = bullEntry + bullRisk * 4.0 * style.tpMult

  const bullConditions: string[] = []
  if (ouBear || ouExcess === 'none') bullConditions.push('OU oversold confirmation (Z < −1.0σ)')
  if (!wtBull) bullConditions.push('WT bullish cross or oversold touch')
  if (!vmcBull) bullConditions.push('VMC momentum turns positive')
  if (nearResist) bullConditions.push(`Break & hold above ${fmtP(nearResist.price)}`)
  if (!bullConditions.length) bullConditions.push('Active — conditions met')

  const bull: TradeScenario = {
    entry: bullEntry, stop: bullStop,
    tp1: bullTp1, tp1RR: `${((bullTp1 - bullEntry) / bullRisk).toFixed(1)}R`,
    tp2: bullTp2, tp2RR: `${((bullTp2 - bullEntry) / bullRisk).toFixed(1)}R`,
    tp3: bullTp3, tp3RR: `${((bullTp3 - bullEntry) / bullRisk).toFixed(1)}R`,
    entryType: bullStrength,
    signalStrength: bullStrength,
    activationConditions: bullConditions,
    notes: nearSupport ? `Support zone at ${fmtP(nearSupport.price)}` : undefined,
    isCounterTrend: bearSignals > bullSignals,
  }

  // ── 7. Bear scenario ─────────────────────────────────────────────────────
  const bearStrength: TradeScenario['signalStrength'] =
    bearSignals >= 4 ? 'premium'
    : bearSignals >= 3 ? 'strong'
    : bearSignals >= 2 ? 'moderate'
    : 'none'

  const bearMult = { premium:0.8, strong:1.0, moderate:1.4, none:2.0 }[bearStrength]
  const bearEntry = nearResist
    ? Math.max(price - atr * 0.15, price - atr * 0.3 * bearMult)
    : price - atr * 0.3 * bearMult
  const bearStop = nearResist
    ? Math.max(nearResist.price + atr * 0.3, price + atr * 1.2 * bearMult)
    : price + atr * 1.5 * bearMult
  const bearRisk = Math.max(bearStop - bearEntry, atr * 0.5)
  const bearTp1 = nearSupport ? Math.max(nearSupport.price * 1.002, bearEntry - bearRisk * 1.5 * style.tpMult) : bearEntry - bearRisk * 1.5 * style.tpMult
  const bearTp2 = bearEntry - bearRisk * 2.5 * style.tpMult
  const bearTp3 = bearEntry - bearRisk * 4.0 * style.tpMult

  const bearConditions: string[] = []
  if (ouBull || ouExcess === 'none') bearConditions.push('OU overbought confirmation (Z > +1.0σ)')
  if (!wtBear) bearConditions.push('WT bearish cross or overbought rejection')
  if (!vmcBear) bearConditions.push('VMC momentum turns negative')
  if (nearSupport) bearConditions.push(`Break & hold below ${fmtP(nearSupport.price)}`)
  if (!bearConditions.length) bearConditions.push('Active — conditions met')

  const bear: TradeScenario = {
    entry: bearEntry, stop: bearStop,
    tp1: bearTp1, tp1RR: `${((bearEntry - bearTp1) / bearRisk).toFixed(1)}R`,
    tp2: bearTp2, tp2RR: `${((bearEntry - bearTp2) / bearRisk).toFixed(1)}R`,
    tp3: bearTp3, tp3RR: `${((bearEntry - bearTp3) / bearRisk).toFixed(1)}R`,
    entryType: bearStrength,
    signalStrength: bearStrength,
    activationConditions: bearConditions,
    notes: nearResist ? `Resistance zone at ${fmtP(nearResist.price)}` : undefined,
    isCounterTrend: bullSignals > bearSignals,
  }

  // ── 8. Probability & risk ─────────────────────────────────────────────────
  const bullProb = noTrade ? 0.5
    : primaryBias === 'bull' ? 0.45 + (bullSignals / 5) * 0.35
    : primaryBias === 'bear' ? 0.50 - (bearSignals / 5) * 0.25
    : 0.5

  const riskLevel: TradePlanData['riskLevel'] =
    setupQuality === 'high' ? 'low'
    : setupQuality === 'medium' ? 'medium'
    : 'high'

  const context = mtfScore < -40 ? 'contextBullFavorable'
    : mtfScore < -10 ? 'contextBullMod'
    : mtfScore > 40 ? 'contextBearFavorable'
    : mtfScore > 10 ? 'contextBearMod'
    : 'contextNeutral'

  // ── 9. Session advice ─────────────────────────────────────────────────────
  const hour = new Date().getUTCHours()
  const session = hour >= 8 && hour < 12 ? 'London Open 🇬🇧'
    : hour >= 13 && hour < 17 ? 'New York Open 🗽'
    : hour >= 0 && hour < 4 ? 'Asia Session 🌏'
    : 'Off-peak — lower liquidity'
  const sessionWarning = style.sessionCritical && (hour < 7 || (hour >= 12 && hour < 13) || hour >= 22)
    ? ' ⚠️ Low liquidity — avoid' : ''
  const sessionAdvice = `${session}${sessionWarning} · ${ouRegime === 'trending' ? 'Trend-following favored' : ouRegime === 'breakout' ? 'Breakout mode — tight stops' : 'Range-bound — fade extremes'}`

  return {
    bull, bear, globalScore: mtfScore, bullProb, riskLevel, context,
    setupQuality, noTrade, noTradeReason, primaryBias, confluenceScore, sessionAdvice,
  }
}

// ── GPT Parser ─────────────────────────────────────────────────────────────

function parseGPTSections(raw: string): GPTSections {
  const result: GPTSections = {
    riskLines: [], timingLines: [], technicalLines: [],
    infoLines: [], fundamentalLines: [], scoreExplanation: ''
  }
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  let sec = 0
  const sectionMap: [string, number][] = [
    ['1️⃣', 1], ['2️⃣', 2], ['3️⃣', 3], ['4️⃣', 4], ['5️⃣', 5],
    ['6️⃣', 6], ['7️⃣', 7], ['8️⃣', 8], ['9️⃣', 9]
  ]
  for (const line of lines) {
    if (line.match(/^[-=─]+$/) || line.length === 0) continue
    const found = sectionMap.find(([emoji]) => line.includes(emoji))
    if (found) { sec = found[1]; continue }
    switch (sec) {
      case 4: result.riskLines.push(line); break
      case 5: result.timingLines.push(line); break
      case 6: result.technicalLines.push(line); break
      case 7: result.infoLines.push(line); break
      case 8: result.fundamentalLines.push(line); break
      case 9: result.scoreExplanation += (result.scoreExplanation ? ' ' : '') + line; break
    }
  }
  return result
}

// ── AI enrichment ──────────────────────────────────────────────────────────

async function enrichWithAI(
  symbol: string, price: number, plan: TradePlanData,
  mtfSignal: string, mtfConfluence: number,
  wtStatus: string, vmcStatus: string,
  ouExcess: string, ouZ: number, ouRegime: string,
  confluenceSignal: string, isCrypto: boolean,
  style: StyleConfig,
): Promise<string> {
  try {
    const fn = httpsCallable<Record<string,unknown>, {choices?: {message:{content:string}}[]}>(fbFn, 'openaiChat')

    const systemPrompt = `You are an institutional trading desk AI specialized in ${style.label} trading (${style.sublabel}, suggested risk ${style.riskPct}/trade). Your role is to produce execution-ready, context-aware trade analysis — not generic advice. Adapt all timing, stop logic, and position sizing to this specific trading style.

STRUCTURE your response EXACTLY like this:

1️⃣ DECISION SUMMARY
Bias: [BULLISH / BEARISH / NEUTRAL / NO TRADE]
Setup Quality: [Low / Medium / High]
Confluence Score: [X/100]
Primary driver: [1 sentence — the single most important factor]

2️⃣ SCENARIO PROBABILITIES
${plan.noTrade ? 'NO TRADE: conditions not favorable\nReason: [explain why — conflicting signals, low confluence, equilibrium]' : `${plan.primaryBias === 'bull' ? 'PRIMARY' : 'SECONDARY'} BULL: ${fmtPct(plan.bullProb * 100)}\n${plan.primaryBias === 'bear' ? 'PRIMARY' : 'SECONDARY'} BEAR: ${fmtPct((1 - plan.bullProb) * 100)}`}

3️⃣ TRADE PLAN
(Already generated by the system — do not repeat)

4️⃣ RISK MANAGEMENT
Position sizing: [% of capital, based on setup quality]
Stop logic: [ATR-based / structure-based / volatility-adjusted]
Invalidation: [exact price or condition that cancels the setup]
Dynamic stop: [when to trail, when to protect breakeven]

5️⃣ TIMING & MARKET CONDITIONS
Session: [optimal / avoid]
Volatility: [current regime assessment]
Catalysts: [upcoming events or "None identified"]
Avoid if: [specific conditions that make this setup invalid]

6️⃣ TECHNICAL ANALYSIS
Key Indicators: [WaveTrend + VMC + OU synthesis — 2 lines max]
Regime: [trend / range / breakout — what this means for entries]
Key levels: [nearest support and resistance with context]
FVG / Order Blocks: [if relevant, otherwise omit]

7️⃣ IMPORTANT INFORMATION
[⚡BULLISH] Title — 1-sentence impact
[⚡NEUTRAL] Title — 1-sentence impact
[⚡BEARISH] Title — 1-sentence impact
(3–5 items total, be specific to the asset)

8️⃣ FUNDAMENTAL ANALYSIS
${isCrypto ? 'On-chain / market structure context (narrative, TVL, network activity)' : 'P/E, earnings, corporate news — concise'}

9️⃣ SCORE EXPLANATION
(3–4 lines referencing sub-scores: MTF confluence, OU regime, momentum alignment)

STYLE: institutional, precise, no disclaimers, actionable. If NO TRADE — be direct about why.`

    const userMessage = `Trading Style: ${style.emoji} ${style.label} (${style.sublabel}) — Risk/trade: ${style.riskPct}
Asset: ${symbol} | Price: $${fmtP(price)}
MTF Signal: ${mtfSignal} | MTF Confluence: ${mtfConfluence.toFixed(0)}%
WaveTrend: ${wtStatus} | VMC: ${vmcStatus}
OU Z-Score: ${ouZ >= 0 ? '+' : ''}${ouZ.toFixed(2)}σ | OU Excess: ${ouExcess} | Regime: ${ouRegime}
Confluence Signal: ${confluenceSignal}

Decision: Bias=${plan.primaryBias.toUpperCase()} | Setup=${plan.setupQuality.toUpperCase()} | Confluence=${plan.confluenceScore}/100 | NO TRADE=${plan.noTrade}
${plan.noTrade ? `No Trade Reason: ${plan.noTradeReason}` : ''}

Bull: Entry $${fmtP(plan.bull.entry||0)} → SL $${fmtP(plan.bull.stop||0)} → TP1 $${fmtP(plan.bull.tp1||0)} | TP2 $${fmtP(plan.bull.tp2||0)} | TP3 $${fmtP(plan.bull.tp3||0)}
Bull activation: ${plan.bull.activationConditions?.join(' / ')}

Bear: Entry $${fmtP(plan.bear.entry||0)} → SL $${fmtP(plan.bear.stop||0)} → TP1 $${fmtP(plan.bear.tp1||0)} | TP2 $${fmtP(plan.bear.tp2||0)} | TP3 $${fmtP(plan.bear.tp3||0)}
Bear activation: ${plan.bear.activationConditions?.join(' / ')}

Session: ${plan.sessionAdvice}

Generate the full analysis following the structure above.`

    const res = await fn({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      model: 'gpt-4o-mini',
      max_tokens: 1400,
    })
    return res.data.choices?.[0]?.message?.content || ''
  } catch { return '' }
}

// ── UI Components ──────────────────────────────────────────────────────────

// ── Style Selector ─────────────────────────────────────────────────────────

function StyleSelector({ selected, onChange }: { selected: TradingStyle; onChange: (s: TradingStyle) => void }) {
  return (
    <div style={{ display:'flex', gap:4, padding:'8px 16px 0' }}>
      {STYLES.map(s => {
        const isActive = s.id === selected
        return (
          <button
            key={s.id}
            onClick={() => onChange(s.id)}
            style={{
              flex:1, padding:'6px 4px', borderRadius:10, cursor:'pointer',
              background: isActive ? `${s.color}18` : 'rgba(255,255,255,0.03)',
              border: `1px solid ${isActive ? s.color + '50' : 'rgba(255,255,255,0.07)'}`,
              boxShadow: isActive ? `0 0 12px ${s.color}20` : 'none',
              transition:'all 0.15s', outline:'none',
              display:'flex', flexDirection:'column', alignItems:'center', gap:2,
            }}
          >
            <span style={{ fontSize:14, lineHeight:1 }}>{s.emoji}</span>
            <span style={{ fontSize:9, fontWeight:700, color: isActive ? s.color : 'rgba(143,148,163,0.5)',
              fontFamily:'JetBrains Mono,monospace', letterSpacing:'0.03em', whiteSpace:'nowrap' }}>
              {s.label}
            </span>
            <span style={{ fontSize:8, color:'rgba(143,148,163,0.35)', fontFamily:'JetBrains Mono,monospace', whiteSpace:'nowrap' }}>
              {s.sublabel.split('·')[0].trim()}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function QualityBadge({ quality }: { quality: 'low'|'medium'|'high' }) {
  const cfg = {
    high:   { label: 'HIGH', color: '#34C759', bg: 'rgba(52,199,89,0.12)', border: 'rgba(52,199,89,0.3)' },
    medium: { label: 'MEDIUM', color: '#FF9500', bg: 'rgba(255,149,0,0.12)', border: 'rgba(255,149,0,0.3)' },
    low:    { label: 'LOW', color: '#FF3B30', bg: 'rgba(255,59,48,0.1)', border: 'rgba(255,59,48,0.25)' },
  }[quality]
  return (
    <span style={{ fontSize:9, fontWeight:800, fontFamily:'JetBrains Mono,monospace', letterSpacing:'0.08em',
      color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`,
      padding:'2px 7px', borderRadius:6 }}>
      {cfg.label}
    </span>
  )
}

function ActivationRow({ conditions, color }: { conditions: string[]; color: string }) {
  const isActive = conditions.length === 1 && conditions[0].startsWith('Active')
  return (
    <div style={{ padding:'8px 14px', background:`${color}06`, borderBottom:`1px solid ${color}10` }}>
      <div style={{ fontSize:9, fontWeight:700, color:'rgba(143,148,163,0.5)', fontFamily:'JetBrains Mono,monospace',
        letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:5 }}>
        {isActive ? '✅ Active' : '⏳ Activate only if'}
      </div>
      {!isActive && conditions.map((c, i) => (
        <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:6, marginBottom:3 }}>
          <span style={{ color:'rgba(255,149,0,0.8)', fontSize:9, lineHeight:1.6, flexShrink:0 }}>→</span>
          <span style={{ fontSize:10, color:'rgba(200,205,220,0.8)', fontFamily:'JetBrains Mono,monospace', lineHeight:1.5 }}>{c}</span>
        </div>
      ))}
    </div>
  )
}

function ScenarioCard({ type, scenario, price, isPrimary }: { type: 'bull'|'bear'; scenario: TradeScenario; price: number; isPrimary: boolean }) {
  const { t } = useTranslation()
  const isBull = type === 'bull'
  const color  = isBull ? '#34C759' : '#FF3B30'
  const bgCol  = isBull ? 'rgba(52,199,89,0.05)' : 'rgba(255,59,48,0.05)'
  const strengthColor = { premium:'#FFD700', strong:'#34C759', moderate:'#FF9500', none:'rgba(143,148,163,0.6)' }[scenario.signalStrength||'none']
  const strengthLabel = { premium: t('analyse.strengthPremium'), strong: t('analyse.strengthStrong'), moderate: t('analyse.strengthModerate'), none: t('analyse.strengthWeak') }[scenario.signalStrength||'none']
  const rr = (entry?: number, stop?: number, tp?: number) => {
    if (!entry || !stop || !tp) return '—'
    const risk = Math.abs(entry - stop)
    if (risk === 0) return '—'
    return `${(Math.abs(tp - entry)/risk).toFixed(1)}R`
  }
  return (
    <div style={{ flex:1, background:bgCol, border:`1px solid ${color}25`, borderRadius:14, overflow:'hidden', position:'relative' }}>
      {/* Primary badge */}
      {isPrimary && (
        <div style={{ position:'absolute', top:8, right:8, fontSize:8, fontWeight:800, color:'#000',
          background: color, padding:'2px 6px', borderRadius:4, letterSpacing:'0.05em' }}>
          PRIMARY
        </div>
      )}
      {scenario.isCounterTrend && (
        <div style={{ position:'absolute', top: isPrimary ? 26 : 8, right:8, fontSize:8, fontWeight:700,
          color:'#FF9500', background:'rgba(255,149,0,0.15)', border:'1px solid rgba(255,149,0,0.3)',
          padding:'2px 6px', borderRadius:4 }}>
          COUNTER-TREND
        </div>
      )}

      {/* Header */}
      <div style={{ padding:'10px 14px', borderBottom:`1px solid ${color}15`, display:'flex', alignItems:'center', gap:8 }}>
        <div style={{ width:7, height:7, borderRadius:'50%', background:color }} />
        <span style={{ fontSize:13, fontWeight:700, color:'var(--tm-text-primary)' }}>{isBull ? t('analyse.bullScenario') : t('analyse.bearScenario')}</span>
        <span style={{ fontSize:9, fontWeight:700, color:strengthColor, background:`${strengthColor}15`, padding:'1px 6px', borderRadius:6, marginLeft:'auto' }}>{strengthLabel}</span>
      </div>

      {/* Activation conditions */}
      {scenario.activationConditions && (
        <ActivationRow conditions={scenario.activationConditions} color={color} />
      )}

      {/* Prices */}
      <div style={{ padding:'10px 14px', display:'flex', flexDirection:'column', gap:7 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:11, color:'rgba(143,148,163,0.7)' }}>{t('analyse.entry')}</span>
          <span style={{ fontSize:13, fontWeight:700, color, fontFamily:'JetBrains Mono,monospace' }}>${fmtP(scenario.entry||0)}</span>
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:11, color:'rgba(143,148,163,0.7)' }}>Stop Loss</span>
          <span style={{ fontSize:12, fontWeight:700, color:'#FF3B30', fontFamily:'JetBrains Mono,monospace' }}>${fmtP(scenario.stop||0)}</span>
        </div>
        <div style={{ height:1, background:`${color}15`, margin:'1px 0' }} />
        <div style={{ fontSize:10, fontWeight:600, color:'rgba(143,148,163,0.5)', marginBottom:1, textTransform:'uppercase', letterSpacing:'0.06em' }}>Targets</div>
        {([['TP1', scenario.tp1, scenario.tp1RR], ['TP2', scenario.tp2, scenario.tp2RR], ['TP3', scenario.tp3, scenario.tp3RR]] as [string, number|undefined, string|undefined][]).map(([label, tp, rrStr]) => tp && (
          <div key={label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ fontSize:10, color:'rgba(143,148,163,0.5)', fontFamily:'JetBrains Mono,monospace', width:24 }}>{label}</span>
              <span style={{ fontSize:12, fontWeight:600, color:'#34C759', fontFamily:'JetBrains Mono,monospace' }}>${fmtP(tp)}</span>
            </div>
            <span style={{ fontSize:10, fontWeight:700, color:'#FFD700', background:'rgba(255,215,0,0.10)', padding:'1px 6px', borderRadius:5 }}>
              {rrStr ?? rr(scenario.entry, scenario.stop, tp)}
            </span>
          </div>
        ))}
        {scenario.notes && (
          <div style={{ marginTop:4, padding:'5px 8px', background:'rgba(255,255,255,0.03)', borderRadius:6 }}>
            <span style={{ fontSize:9, color:'rgba(143,148,163,0.5)', fontFamily:'JetBrains Mono,monospace' }}>📍 {scenario.notes}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function NoTradeCard({ reason }: { reason: string }) {
  return (
    <div style={{ padding:'16px 20px', background:'rgba(142,142,147,0.06)', border:'1px solid rgba(142,142,147,0.2)',
      borderRadius:14, textAlign:'center' }}>
      <div style={{ fontSize:24, marginBottom:8 }}>⏳</div>
      <div style={{ fontSize:14, fontWeight:800, color:'#8E8E93', fontFamily:'Syne,sans-serif', letterSpacing:'0.04em', marginBottom:6 }}>
        NO TRADE
      </div>
      <div style={{ fontSize:11, color:'rgba(143,148,163,0.65)', fontFamily:'JetBrains Mono,monospace', lineHeight:1.6 }}>
        {reason}
      </div>
    </div>
  )
}

function ConfluenceBar({ score }: { score: number }) {
  const color = score >= 65 ? '#34C759' : score >= 40 ? '#FF9500' : '#FF3B30'
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <span style={{ fontSize:9, color:'rgba(143,148,163,0.5)', fontFamily:'JetBrains Mono,monospace', whiteSpace:'nowrap' }}>CONFLUENCE</span>
      <div style={{ flex:1, height:4, background:'rgba(255,255,255,0.07)', borderRadius:2, position:'relative' }}>
        <div style={{ position:'absolute', top:0, left:0, height:'100%', width:`${score}%`,
          background:`linear-gradient(90deg, #FF3B30 0%, #FF9500 50%, #34C759 100%)`,
          borderRadius:2, transition:'width 0.6s cubic-bezier(0.4,0,0.2,1)' }} />
        <div style={{ position:'absolute', top:'50%', transform:'translate(-50%,-50%)',
          left:`${score}%`, width:7, height:7, borderRadius:'50%',
          background:color, border:'1.5px solid #080C14',
          boxShadow:`0 0 5px ${color}80`, transition:'left 0.6s cubic-bezier(0.4,0,0.2,1)' }} />
      </div>
      <span style={{ fontSize:10, fontWeight:700, color, fontFamily:'JetBrains Mono,monospace', minWidth:30 }}>{score}/100</span>
    </div>
  )
}

function SectionLabel({ icon, label, color }: { icon: string; label: string; color: string }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
      <span style={{ fontSize:16 }}>{icon}</span>
      <span style={{ fontSize:13, fontWeight:700, color:'var(--tm-text-primary)' }}>{label}</span>
      <div style={{ flex:1, height:1, background:`${color}30` }} />
    </div>
  )
}

function KVCard({ lines, accent }: { lines: string[]; accent: string }) {
  return (
    <div style={{ background:'rgba(255,255,255,0.03)', border:`1px solid ${accent}20`, borderRadius:12, padding:'12px 14px', marginBottom:16, display:'flex', flexDirection:'column', gap:6 }}>
      {lines.map((line, i) => {
        const colonIdx = line.indexOf(':')
        if (colonIdx > 0 && colonIdx < 40) {
          const key = line.slice(0, colonIdx).trim().replace(/^[-•→]\s*/, '')
          const val = line.slice(colonIdx + 1).trim()
          return (
            <div key={i} style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
              <span style={{ fontSize:11, fontWeight:600, color:`${accent}CC`, minWidth:120, flexShrink:0 }}>{key}</span>
              <span style={{ fontSize:12, color:'#C5C8D6', lineHeight:1.5 }}>{val}</span>
            </div>
          )
        }
        return <div key={i} style={{ fontSize:12, color:'#C5C8D6', lineHeight:1.5, paddingLeft:4 }}>{line.replace(/^[-•→]\s*/, '')}</div>
      })}
    </div>
  )
}

function NewsCard({ lines }: { lines: string[] }) {
  return (
    <div style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,149,0,0.2)', borderRadius:12, padding:'12px 14px', marginBottom:16, display:'flex', flexDirection:'column', gap:8 }}>
      {lines.map((line, i) => {
        const isBull = line.includes('[⚡BULLISH]') || line.includes('[⚡HAUSSIER]')
        const isBear = line.includes('[⚡BEARISH]') || line.includes('[⚡BAISSIER]')
        const clr = isBull ? '#34C759' : isBear ? '#FF3B30' : '#FF9500'
        const clean = line.replace(/\[⚡(BULLISH|BEARISH|NEUTRAL|HAUSSIER|BAISSIER|NEUTRE)\]\s*/g, '').trim()
        return (
          <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:8 }}>
            <span style={{ fontSize:12, color:clr, flexShrink:0 }}>⚡</span>
            <span style={{ fontSize:12, color:'#C5C8D6', lineHeight:1.5 }}>{clean}</span>
          </div>
        )
      })}
    </div>
  )
}

function CollapsibleSection({ icon, label, color, preview, children }: { icon:string; label:string; color:string; preview:string; children:React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginBottom:0 }}>
      <button onClick={() => setOpen(x => !x)} style={{ width:'100%', background:'none', border:'none', padding:0, cursor:'pointer', textAlign:'left' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom: open ? 8 : 4 }}>
          <span style={{ fontSize:16 }}>{icon}</span>
          <span style={{ fontSize:13, fontWeight:700, color:'var(--tm-text-primary)' }}>{label}</span>
          <div style={{ flex:1, height:1, background:`${color}30` }} />
          <span style={{ fontSize:10, color:'var(--tm-text-muted)' }}>{open ? '▲' : '▼'}</span>
        </div>
        {!open && preview && (
          <div style={{ fontSize:11, color:'var(--tm-text-muted)', paddingLeft:24, marginBottom:8, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{preview}</div>
        )}
      </button>
      {open && children}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function TradePlanCard({
  symbol, price: priceProp, chartInterval = '1h',
  mtfScore = 0, mtfSignal = 'NEUTRAL', mtfConfluence = 0,
  wtStatus = 'Neutral', vmcStatus = 'NEUTRAL',
  ouExcess = 'none', ouZ = 0, ouRegime = 'ranging',
  confluenceSignal = 'neutral',
  keyLevels = [], isCrypto = false,
  onPlanReady,
}: Props) {
  const { t } = useTranslation()
  const [plan,         setPlan]         = useState<TradePlanData|null>(null)
  const [price,        setPrice]        = useState(0)
  const [sections,     setSections]     = useState<GPTSections|null>(null)
  const [aiLoading,    setAiLoading]    = useState(false)
  const [expanded,     setExpanded]     = useState(true)
  const [selectedStyle, setSelectedStyle] = useState<TradingStyle>(() => styleFromInterval(chartInterval))
  const symbolRef = useRef('')
  const priceRef  = useRef(0)

  // Sync default style when chart timeframe changes externally
  useEffect(() => {
    setSelectedStyle(styleFromInterval(chartInterval))
  }, [chartInterval])

  // ── Price fetch ──────────────────────────────────────────────────────────
  useEffect(() => {
    const sym = symbol.toUpperCase()
    if (symbolRef.current !== sym) {
      symbolRef.current = sym
      priceRef.current = 0
      setPrice(0); setPlan(null); setSections(null)
    }
    const isCr = /USDT$|BUSD$|BTC$|ETH$|BNB$/i.test(sym)
    if (isCr) {
      if (priceProp > 0) { priceRef.current = priceProp; setPrice(priceProp); return }
      fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`)
        .then(r => r.json()).then(d => {
          if (symbolRef.current !== sym) return
          if (d.price) { priceRef.current = parseFloat(d.price); setPrice(parseFloat(d.price)) }
        }).catch(() => {})
    } else {
      const fn2 = httpsCallable<Record<string,unknown>, {s:string; candles:{c:number}[]}>(fbFn, 'fetchYahooCandles')
      fn2({ symbol: sym, interval: '1d', range: '5d' }).then(res => {
        if (symbolRef.current !== sym) return
        if (res.data.s === 'ok' && res.data.candles?.length > 0) {
          const p = res.data.candles[res.data.candles.length - 1].c
          if (p > 0) { priceRef.current = p; setPrice(p) }
        }
      }).catch(() => {})
    }
  }, [symbol, priceProp])

  // ── Generate plan ────────────────────────────────────────────────────────
  useEffect(() => {
    if (price <= 0) return
    const style = STYLES.find(s => s.id === selectedStyle) ?? STYLES[1]
    const newPlan = generateScenarios(
      price, mtfScore, mtfConfluence,
      wtStatus, vmcStatus,
      ouExcess, ouZ, ouRegime,
      confluenceSignal, keyLevels, isCrypto, style,
    )
    setPlan(newPlan)
    setSections(null) // reset AI when style or context changes
    onPlanReady?.(newPlan, null)
  }, [symbol, price, mtfScore, mtfConfluence, wtStatus, vmcStatus, ouExcess, ouZ, ouRegime, confluenceSignal, selectedStyle]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── AI enrichment ────────────────────────────────────────────────────────
  const loadAI = useCallback(async () => {
    if (!plan || aiLoading || price <= 0) return
    setAiLoading(true)
    const style = STYLES.find(s => s.id === selectedStyle) ?? STYLES[1]
    const text = await enrichWithAI(
      symbol, price, plan,
      mtfSignal, mtfConfluence,
      wtStatus, vmcStatus,
      ouExcess, ouZ, ouRegime,
      confluenceSignal, isCrypto, style,
    )
    if (text) {
      const parsed = parseGPTSections(text)
      setSections(parsed)
      if (plan) onPlanReady?.(plan, parsed)
    }
    setAiLoading(false)
  }, [plan, symbol, price, mtfSignal, mtfConfluence, wtStatus, vmcStatus, ouExcess, ouZ, ouRegime, confluenceSignal, isCrypto, selectedStyle, aiLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  if (price <= 0) return (
    <div style={{ background:'rgba(13,17,35,0.75)', backdropFilter:'blur(12px)', border:'1px solid rgba(255,255,255,0.06)', borderRadius:16, padding:'20px 16px', display:'flex', alignItems:'center', gap:10 }}>
      <div style={{ width:18, height:18, border:'2px solid #2A2F3E', borderTopColor:'var(--tm-blue)', borderRadius:'50%', animation:'spin 0.7s linear infinite', flexShrink:0 }} />
      <span style={{ fontSize:12, color:'var(--tm-text-muted)' }}>{t('analyse.currentPrice')} {symbol}...</span>
    </div>
  )
  if (!plan) return null

  const biasColor = plan.primaryBias === 'bull' ? '#34C759' : plan.primaryBias === 'bear' ? '#FF3B30' : '#8E8E93'
  const riskColor = { low:'#34C759', medium:'#FF9500', high:'#FF3B30' }[plan.riskLevel]
  const riskLabel = { low: t('analyse.riskLow'), medium: t('analyse.riskMedium'), high: t('analyse.riskHigh') }[plan.riskLevel]
  const activeStyle = STYLES.find(s => s.id === selectedStyle) ?? STYLES[1]

  return (
    <div style={{ background:'rgba(13,17,35,0.75)', backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)',
      border:'1px solid rgba(255,255,255,0.06)', borderRadius:16, boxShadow:'0 4px 24px rgba(0,0,0,0.5)', overflow:'hidden' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ padding:'12px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer',
        borderBottom: expanded ? '1px solid rgba(255,255,255,0.05)' : 'none' }}
        onClick={() => setExpanded(x=>!x)}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:32, height:32, borderRadius:9, background:'linear-gradient(135deg,#0A85FF,#00E5FF)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16 }}>📋</div>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--tm-text-primary)' }}>{t('analyse.tradePlan')}</div>
            <div style={{ display:'flex', alignItems:'center', gap:5, marginTop:1 }}>
              <span style={{ fontSize:9, color:'var(--tm-text-muted)', fontFamily:'JetBrains Mono,monospace' }}>
                {symbol} · ${fmtP(price)}
              </span>
              <span style={{ fontSize:8, color:'rgba(255,255,255,0.12)' }}>|</span>
              <span style={{ fontSize:9, fontWeight:700, color: activeStyle.color, fontFamily:'JetBrains Mono,monospace',
                background:`${activeStyle.color}15`, padding:'1px 5px', borderRadius:4 }}>
                {activeStyle.emoji} {activeStyle.label} · {chartInterval.toUpperCase()}
              </span>
            </div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {/* Bias pill */}
          <div style={{ display:'flex', alignItems:'center', gap:5, padding:'3px 10px', borderRadius:8,
            background:`${biasColor}12`, border:`1px solid ${biasColor}30` }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background:biasColor, display:'inline-block' }} />
            <span style={{ fontSize:10, fontWeight:800, color:biasColor, fontFamily:'JetBrains Mono,monospace' }}>
              {plan.noTrade ? 'NO TRADE' : plan.primaryBias.toUpperCase()}
            </span>
          </div>
          <QualityBadge quality={plan.setupQuality} />
          <span style={{ fontSize:10, fontWeight:700, color:riskColor, background:`${riskColor}12`, padding:'2px 7px', borderRadius:6, border:`1px solid ${riskColor}25` }}>
            {t('analyse.riskLabel', { level: riskLabel })}
          </span>
          <span style={{ fontSize:10, color:'var(--tm-text-muted)' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <>
          {/* ── Style selector ───────────────────────────────────────────── */}
          <StyleSelector selected={selectedStyle} onChange={setSelectedStyle} />

          {/* ── Confluence bar ────────────────────────────────────────────── */}
          <div style={{ padding:'10px 16px 0', display:'flex', flexDirection:'column', gap:8 }}>
            {/* Risk per trade hint */}
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ fontSize:9, color:'rgba(143,148,163,0.4)', fontFamily:'JetBrains Mono,monospace', textTransform:'uppercase', letterSpacing:'0.08em' }}>
                Suggested risk/trade
              </span>
              <span style={{ fontSize:9, fontWeight:700, color: activeStyle.color, fontFamily:'JetBrains Mono,monospace',
                background:`${activeStyle.color}12`, padding:'1px 6px', borderRadius:4, border:`1px solid ${activeStyle.color}25` }}>
                {activeStyle.riskPct} of capital
              </span>
            </div>
            <ConfluenceBar score={plan.confluenceScore} />

            {/* Session */}
            {plan.sessionAdvice && (
              <div style={{ fontSize:10, color:'rgba(143,148,163,0.6)', fontFamily:'JetBrains Mono,monospace',
                padding:'5px 10px', background:'rgba(255,255,255,0.03)', borderRadius:8, border:'1px solid rgba(255,255,255,0.05)' }}>
                🕐 {plan.sessionAdvice}
              </div>
            )}
          </div>

          {/* ── NO TRADE or scenarios ──────────────────────────────────────── */}
          <div style={{ padding:'12px 16px', display:'flex', flexDirection:'column', gap:12 }}>
            {plan.noTrade ? (
              <>
                <NoTradeCard reason={plan.noTradeReason || 'Conditions not favorable'} />
                {/* Still show scenarios as reference, grayed out */}
                <div style={{ opacity:0.45, pointerEvents:'none' }}>
                  <div style={{ fontSize:9, fontWeight:700, color:'rgba(143,148,163,0.4)', fontFamily:'JetBrains Mono,monospace',
                    letterSpacing:'0.1em', marginBottom:6 }}>REFERENCE ONLY — NOT ACTIVE</div>
                  <div style={{ display:'flex', gap:10 }}>
                    <ScenarioCard type="bull" scenario={plan.bull} price={price} isPrimary={false} />
                    <ScenarioCard type="bear" scenario={plan.bear} price={price} isPrimary={false} />
                  </div>
                </div>
              </>
            ) : (
              <div style={{ display:'flex', gap:10 }}>
                <ScenarioCard type="bull" scenario={plan.bull} price={price} isPrimary={plan.primaryBias === 'bull'} />
                <ScenarioCard type="bear" scenario={plan.bear} price={price} isPrimary={plan.primaryBias === 'bear'} />
              </div>
            )}
          </div>

          {/* ── Context ───────────────────────────────────────────────────── */}
          <div style={{ margin:'0 16px 12px', padding:'8px 12px', background:'rgba(10,133,255,0.06)',
            border:'1px solid rgba(10,133,255,0.15)', borderRadius:10 }}>
            <span style={{ fontSize:11, fontWeight:600, color:'var(--tm-accent)' }}>{t('analyse.context')} : </span>
            <span style={{ fontSize:11, color:'var(--tm-text-secondary)', lineHeight:1.6 }}>{t(`analyse.${plan.context}`)}</span>
          </div>

          {/* ── AI sections ───────────────────────────────────────────────── */}
          {sections ? (
            <div style={{ padding:'0 16px 16px', display:'flex', flexDirection:'column', gap:4 }}>
              {sections.technicalLines.length > 0 && (
                <CollapsibleSection icon="📈" label="Technical Analysis" color="var(--tm-blue)"
                  preview={sections.technicalLines.slice(0,2).join(' · ')}>
                  <KVCard lines={sections.technicalLines} accent="var(--tm-blue)" />
                </CollapsibleSection>
              )}
              {sections.riskLines.length > 0 && <>
                <SectionLabel icon="🛡️" label="Risk Management" color="#FF3B30" />
                <KVCard lines={sections.riskLines} accent="#FF3B30" />
              </>}
              {sections.timingLines.length > 0 && <>
                <SectionLabel icon="🕐" label="Timing & Context" color="#FF9500" />
                <KVCard lines={sections.timingLines} accent="#FF9500" />
              </>}
              {sections.infoLines.length > 0 && (
                <CollapsibleSection icon="⚡" label="Important Information" color="#FF9500"
                  preview={sections.infoLines.slice(0,2).join(' · ').replace(/\[⚡(BULLISH|BEARISH|NEUTRAL|HAUSSIER|BAISSIER|NEUTRE)\]\s*/g, '')}>
                  <NewsCard lines={sections.infoLines} />
                </CollapsibleSection>
              )}
              {sections.fundamentalLines.length > 0 && !sections.fundamentalLines[0].toLowerCase().includes('not applicable') && (
                <CollapsibleSection icon="🏢" label="Fundamental Analysis" color="var(--tm-accent)"
                  preview={sections.fundamentalLines.slice(0,1).join('')}>
                  <KVCard lines={sections.fundamentalLines} accent="var(--tm-accent)" />
                </CollapsibleSection>
              )}
              {sections.scoreExplanation && (
                <div style={{ padding:'10px 12px', background:'rgba(191,90,242,0.06)', border:'1px solid rgba(191,90,242,0.15)', borderRadius:10, marginTop:4 }}>
                  <div style={{ fontSize:10, color:'var(--tm-purple)', fontWeight:600, marginBottom:4 }}>✨ AI Score</div>
                  <div style={{ fontSize:11, color:'var(--tm-text-secondary)', lineHeight:1.6 }}>{sections.scoreExplanation}</div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ margin:'0 16px 16px', padding:'10px 12px', background:'rgba(0,0,0,0.3)', border:'1px solid #2A2F3E', borderRadius:10 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <span style={{ fontSize:11, color:'var(--tm-text-muted)' }}>Deep analysis: Risk · Timing · Technical · Catalysts</span>
                <button onClick={loadAI} disabled={aiLoading} style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 12px', borderRadius:8,
                  background: aiLoading ? 'var(--tm-bg-tertiary)' : 'rgba(191,90,242,0.15)',
                  color: aiLoading ? 'var(--tm-text-muted)' : 'var(--tm-purple)',
                  cursor: aiLoading ? 'not-allowed' : 'pointer', fontSize:11, fontWeight:600,
                  border:'1px solid rgba(191,90,242,0.3)' }}>
                  {aiLoading
                    ? <><div style={{ width:12, height:12, border:'2px solid #2A2F3E', borderTopColor:'var(--tm-purple)', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} /> Analyzing...</>
                    : '✨ Analyze with AI'
                  }
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
