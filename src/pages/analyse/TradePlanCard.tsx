// TradePlanCard.tsx — Plan de Trade IA
// Miroir de TradeScenarioGenerator.swift + AnalysisContentView.swift
// Génération locale basée sur MTF score + WT + VMC (sans API call pour la base)
// Enrichissement IA via openaiChat Cloud Function

import { useState, useEffect, useCallback } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'

const fbFn = getFunctions(app, 'europe-west1')

// ── Types ──────────────────────────────────────────────────────────────────

interface TradeScenario {
  entry?: number
  stop?: number
  tp1?: number; tp1RR?: string
  tp2?: number; tp2RR?: string
  tp3?: number; tp3RR?: string
  entryType?: string
  signalStrength?: 'none'|'moderate'|'strong'|'premium'
}

interface TradePlanData {
  bull: TradeScenario
  bear: TradeScenario
  globalScore: number     // -100 → +100
  bullProb: number        // 0 → 1
  riskLevel: 'low'|'medium'|'high'
  context: string         // résumé du contexte technique
  aiAnalysis?: string     // enrichissement GPT (optionnel)
}

interface Props {
  symbol: string
  price: number           // prix courant
  mtfScore?: number       // score MTF combiné (-100 → +100)
  mtfSignal?: string      // 'BUY'|'BULLISH'|'NEUTRAL'|'BEARISH'|'SELL'
  wtStatus?: string       // status WaveTrend
  vmcStatus?: string      // status VMC
}

// ── Scenario Generator (miroir TradeScenarioGenerator.swift) ───────────────

function fmtP(p: number): string {
  return p >= 10000 ? p.toFixed(0) : p >= 100 ? p.toFixed(2) : p >= 1 ? p.toFixed(4) : p.toFixed(6)
}

function calcATR(price: number, mtfScore: number): number {
  // ATR estimé basé sur le prix et la volatilité implicite du score MTF
  const basePct = price > 50000 ? 0.012 : price > 1000 ? 0.018 : price > 10 ? 0.025 : 0.03
  const volMultiplier = 1 + Math.abs(mtfScore) / 200
  return price * basePct * volMultiplier
}

function generateScenarios(
  price: number,
  mtfScore: number,
  wtStatus: string,
  vmcStatus: string,
): TradePlanData {
  const atr = calcATR(price, mtfScore)

  // Détecter les cross signals (miroir Swift detectCrossSignals)
  const wtBull = wtStatus === 'Bullish Reversal' || wtStatus === 'Smart Bullish' || wtStatus === 'Oversold'
  const wtBear = wtStatus === 'Bearish Reversal' || wtStatus === 'Smart Bearish' || wtStatus === 'Overbought'
  const vmcBull = vmcStatus === 'BUY' || vmcStatus === 'OVERSOLD'
  const vmcBear = vmcStatus === 'SELL' || vmcStatus === 'OVERBOUGHT'

  const doubleBull = wtBull && vmcBull
  const doubleBear = wtBear && vmcBear
  const bullStrength: TradeScenario['signalStrength'] = doubleBull ? 'premium' : wtBull || vmcBull ? 'strong' : mtfScore < -10 ? 'moderate' : 'none'
  const bearStrength: TradeScenario['signalStrength'] = doubleBear ? 'premium' : wtBear || vmcBear ? 'strong' : mtfScore > 10 ? 'moderate' : 'none'

  // Multiplicateurs selon la force du signal
  const bullMult = { premium: 1.0, strong: 1.2, moderate: 1.5, none: 2.0 }[bullStrength]
  const bearMult = { premium: 1.0, strong: 1.2, moderate: 1.5, none: 2.0 }[bearStrength]

  // Bull scenario (miroir generateBullScenario)
  const bullEntry = price + atr * 0.3 * bullMult
  const bullStop  = price - atr * 1.5 * bullMult
  const bullRisk  = bullEntry - bullStop
  const bull: TradeScenario = {
    entry: bullEntry, stop: bullStop,
    tp1: bullEntry + bullRisk * 1.5,  tp1RR: '1.5R',
    tp2: bullEntry + bullRisk * 2.5,  tp2RR: '2.5R',
    tp3: bullEntry + bullRisk * 4.0,  tp3RR: '4.0R',
    entryType: bullStrength === 'premium' ? 'Double Cross Extrême' : bullStrength === 'strong' ? 'Signal Confirmé' : bullStrength === 'moderate' ? 'Setup Modéré' : 'Contre-tendance',
    signalStrength: bullStrength,
  }

  // Bear scenario
  const bearEntry = price - atr * 0.3 * bearMult
  const bearStop  = price + atr * 1.5 * bearMult
  const bearRisk  = bearStop - bearEntry
  const bear: TradeScenario = {
    entry: bearEntry, stop: bearStop,
    tp1: bearEntry - bearRisk * 1.5, tp1RR: '1.5R',
    tp2: bearEntry - bearRisk * 2.5, tp2RR: '2.5R',
    tp3: bearEntry - bearRisk * 4.0, tp3RR: '4.0R',
    entryType: bearStrength === 'premium' ? 'Double Cross Extrême' : bearStrength === 'strong' ? 'Signal Confirmé' : bearStrength === 'moderate' ? 'Setup Modéré' : 'Contre-tendance',
    signalStrength: bearStrength,
  }

  // Probabilité haussière basée sur le score MTF (miroir calculatedBullProbability)
  const bullProb = (mtfScore + 100) / 200

  // Contexte
  const context = mtfScore < -40
    ? 'Conditions d\'achat favorables — MTF fortement baissier (signal d\'achat contrarian)'
    : mtfScore < -10
    ? 'Biais baissier modéré — surveillance des niveaux de support'
    : mtfScore > 40
    ? 'Conditions de vente favorables — MTF fortement haussier (signal de vente contrarian)'
    : mtfScore > 10
    ? 'Biais haussier modéré — surveillance des résistances'
    : 'Marché sans direction claire — attendre une confirmation de signal'

  const riskLevel: TradePlanData['riskLevel'] =
    (bullStrength === 'premium' || bearStrength === 'premium') ? 'low' :
    (bullStrength === 'strong' || bearStrength === 'strong') ? 'medium' : 'high'

  return { bull, bear, globalScore: mtfScore, bullProb, riskLevel, context }
}

// ── AI Enrichment via openaiChat ───────────────────────────────────────────

async function enrichWithAI(symbol: string, price: number, plan: TradePlanData, mtfSignal: string): Promise<string> {
  try {
    const fn = httpsCallable<Record<string,unknown>, {choices?: {message:{content:string}}[]}>(fbFn, 'openaiChat')
    const prompt = `Tu es un expert en trading. Analyse ce plan de trade en 3-4 phrases CONCISES.

Symbole: ${symbol} | Prix actuel: $${fmtP(price)}
Signal MTF global: ${mtfSignal} (score: ${plan.globalScore.toFixed(0)}/100)
Probabilité haussière: ${(plan.bullProb * 100).toFixed(0)}%
Risque: ${plan.riskLevel}

Plan Bull: Entrée $${fmtP(plan.bull.entry||0)} | Stop $${fmtP(plan.bull.stop||0)} | TP1 $${fmtP(plan.bull.tp1||0)} | TP2 $${fmtP(plan.bull.tp2||0)}
Plan Bear: Entrée $${fmtP(plan.bear.entry||0)} | Stop $${fmtP(plan.bear.stop||0)} | TP1 $${fmtP(plan.bear.tp1||0)} | TP2 $${fmtP(plan.bear.tp2||0)}

Donne une analyse de confluence, le scénario le plus probable, et un conseil de gestion du risque.`

    const res = await fn({
      messages: [{ role: 'user', content: prompt }],
      model: 'gpt-4o-mini',
      max_tokens: 250,
    })
    return res.data.choices?.[0]?.message?.content || ''
  } catch { return '' }
}

// ── Scenario Card ──────────────────────────────────────────────────────────

function ScenarioCard({ type, scenario, price }: { type: 'bull'|'bear'; scenario: TradeScenario; price: number }) {
  const isBull = type === 'bull'
  const color  = isBull ? '#22C759' : '#FF3B30'
  const bgCol  = isBull ? 'rgba(34,199,89,0.06)' : 'rgba(255,59,48,0.06)'
  const strengthColor = { premium:'#FFD700', strong:'#22C759', moderate:'#FF9500', none:'#555C70' }[scenario.signalStrength||'none']
  const strengthLabel = { premium:'⭐ Premium', strong:'● Signal Fort', moderate:'◎ Modéré', none:'○ Faible' }[scenario.signalStrength||'none']

  const rr = (entry?: number, stop?: number, tp?: number) => {
    if (!entry || !stop || !tp) return '—'
    const risk = Math.abs(entry - stop)
    if (risk === 0) return '—'
    const reward = Math.abs(tp - entry)
    return `${(reward/risk).toFixed(1)}R`
  }

  return (
    <div style={{ flex:1, background:bgCol, border:`1px solid ${color}30`, borderRadius:14, overflow:'hidden' }}>
      {/* Header */}
      <div style={{ padding:'10px 14px', borderBottom:`1px solid ${color}20`, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:8, height:8, borderRadius:'50%', background:color }} />
          <span style={{ fontSize:13, fontWeight:700, color:'#F0F3FF' }}>{isBull ? 'Scénario Haussier' : 'Scénario Baissier'}</span>
        </div>
        <span style={{ fontSize:10, fontWeight:700, color:strengthColor, background:`${strengthColor}15`, padding:'2px 8px', borderRadius:10, border:`1px solid ${strengthColor}30` }}>{strengthLabel}</span>
      </div>

      {/* Entry type */}
      {scenario.entryType && (
        <div style={{ padding:'6px 14px', background:`${color}08`, borderBottom:`1px solid ${color}10` }}>
          <span style={{ fontSize:11, color:`${color}CC` }}>🚩 Type : {scenario.entryType}</span>
        </div>
      )}

      {/* Levels */}
      <div style={{ padding:'12px 14px', display:'flex', flexDirection:'column', gap:8 }}>
        {/* Entry */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:12, color:'#8F94A3' }}>Entrée</span>
          <span style={{ fontSize:13, fontWeight:700, color, fontFamily:'monospace' }}>${fmtP(scenario.entry||0)}</span>
        </div>
        {/* Stop */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:12, color:'#8F94A3' }}>Stop Loss</span>
          <span style={{ fontSize:13, fontWeight:700, color:'#FF3B30', fontFamily:'monospace' }}>${fmtP(scenario.stop||0)}</span>
        </div>

        <div style={{ height:1, background:`${color}20`, margin:'2px 0' }} />

        {/* TPs */}
        <div style={{ fontSize:11, fontWeight:600, color:'#8F94A3', marginBottom:2 }}>Objectifs</div>
        {[
          ['TP1', scenario.tp1, rr(scenario.entry, scenario.stop, scenario.tp1)],
          ['TP2', scenario.tp2, rr(scenario.entry, scenario.stop, scenario.tp2)],
          ['TP3', scenario.tp3, rr(scenario.entry, scenario.stop, scenario.tp3)],
        ].map(([label, tp, rrVal]) => tp && (
          <div key={label as string} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ fontSize:11, color:'#555C70', width:24 }}>{label}</span>
              <span style={{ fontSize:12, fontWeight:600, color:'#22C759', fontFamily:'monospace' }}>${fmtP(tp as number)}</span>
            </div>
            <span style={{ fontSize:11, fontWeight:700, color:'#FFD700', background:'rgba(255,215,0,0.12)', padding:'1px 7px', borderRadius:6 }}>{rrVal}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function TradePlanCard({ symbol, price, mtfScore = 0, mtfSignal = 'NEUTRAL', wtStatus = 'Neutral', vmcStatus = 'NEUTRAL' }: Props) {
  const [plan,      setPlan]      = useState<TradePlanData|null>(null)
  const [aiText,    setAiText]    = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [expanded,  setExpanded]  = useState(true)

  // Génération locale dès que les props changent
  useEffect(() => {
    if (price <= 0) return
    const p = generateScenarios(price, mtfScore, wtStatus, vmcStatus)
    setPlan(p)
    setAiText('')
  }, [symbol, price, mtfScore, wtStatus, vmcStatus])

  const loadAI = useCallback(async () => {
    if (!plan || aiLoading) return
    setAiLoading(true)
    const text = await enrichWithAI(symbol, price, plan, mtfSignal)
    setAiText(text)
    setAiLoading(false)
  }, [plan, symbol, price, mtfSignal, aiLoading])

  if (!plan || price <= 0) return null

  const scoreColor = plan.globalScore < -40 ? '#22C759' : plan.globalScore < -10 ? '#FFD60A' : plan.globalScore > 40 ? '#FF3B30' : plan.globalScore > 10 ? '#FF9500' : '#8F94A3'
  const riskColor  = { low:'#22C759', medium:'#FF9500', high:'#FF3B30' }[plan.riskLevel]
  const riskLabel  = { low:'Faible', medium:'Modéré', high:'Élevé' }[plan.riskLevel]

  return (
    <div style={{ background:'#161B22', border:'1px solid #1E2330', borderRadius:16, overflow:'hidden' }}>
      <div style={{ position:'absolute', top:0, left:0, right:0, height:1, background:'linear-gradient(90deg,transparent,rgba(255,255,255,0.05),transparent)', position:'relative' as 'relative' }} />

      {/* Header */}
      <div style={{ padding:'12px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer' }} onClick={() => setExpanded(x=>!x)}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:32, height:32, borderRadius:9, background:'linear-gradient(135deg,#0A85FF,#00E5FF)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16 }}>📋</div>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:'#F0F3FF' }}>Plan de Trade</div>
            <div style={{ fontSize:10, color:'#555C70' }}>{symbol} · ${fmtP(price)}</div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {/* Bull probability bar */}
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize:10, color:'#555C70' }}>Bull</span>
            <div style={{ width:60, height:6, background:'#1C2130', borderRadius:3, overflow:'hidden' }}>
              <div style={{ width:`${plan.bullProb*100}%`, height:'100%', background:`linear-gradient(to right,#22C759,#22C759)`, borderRadius:3 }} />
            </div>
            <span style={{ fontSize:10, fontWeight:700, color:'#22C759', fontFamily:'monospace' }}>{(plan.bullProb*100).toFixed(0)}%</span>
          </div>
          <span style={{ fontSize:10, fontWeight:700, color:riskColor, background:`${riskColor}15`, padding:'2px 8px', borderRadius:6 }}>Risque {riskLabel}</span>
          <span style={{ fontSize:10, color:'#555C70' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && <>
        {/* Context */}
        <div style={{ margin:'0 16px 12px', padding:'10px 12px', background:'rgba(10,133,255,0.06)', border:'1px solid rgba(10,133,255,0.15)', borderRadius:10 }}>
          <div style={{ fontSize:11, color:'#8F94A3', lineHeight:1.6 }}>
            <span style={{ fontWeight:600, color:'#00E5FF' }}>Contexte : </span>{plan.context}
          </div>
        </div>

        {/* Scenarios */}
        <div style={{ padding:'0 16px', display:'flex', gap:12, marginBottom:12 }}>
          <ScenarioCard type="bull" scenario={plan.bull} price={price} />
          <ScenarioCard type="bear" scenario={plan.bear} price={price} />
        </div>

        {/* AI enrichment */}
        <div style={{ margin:'0 16px 16px', padding:'10px 12px', background:'rgba(0,0,0,0.3)', border:'1px solid #2A2F3E', borderRadius:10 }}>
          {aiText ? (
            <div>
              <div style={{ fontSize:10, color:'#555C70', marginBottom:6, display:'flex', alignItems:'center', gap:4 }}>
                <span style={{ color:'#BF5AF2' }}>✨</span> Analyse IA
              </div>
              <div style={{ fontSize:12, color:'#C5C8D6', lineHeight:1.7 }}>{aiText}</div>
            </div>
          ) : (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize:11, color:'#555C70' }}>Enrichir avec l'IA (GPT-4o)</span>
              <button
                onClick={loadAI}
                disabled={aiLoading}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 12px', borderRadius:8, border:'none', background: aiLoading ? '#1C2130' : 'rgba(191,90,242,0.15)', color: aiLoading ? '#555C70' : '#BF5AF2', cursor: aiLoading ? 'not-allowed' : 'pointer', fontSize:11, fontWeight:600, border:'1px solid rgba(191,90,242,0.3)' as string }}
              >
                {aiLoading ? (
                  <><div style={{ width:12, height:12, border:'2px solid #2A2F3E', borderTopColor:'#BF5AF2', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} /> Analyse...</>
                ) : '✨ Analyser avec IA'}
              </button>
            </div>
          )}
        </div>
      </>}
    </div>
  )
}
