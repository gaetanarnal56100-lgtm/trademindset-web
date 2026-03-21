// TradePlanCard.tsx — Plan de Trade IA
// Miroir complet de AssistantAIService.swift + GPTAnalysisRenderer.swift
// Sections : Risk Management, Timing, Technical Analysis, Important Information, Fundamental

import { useState, useEffect, useCallback, useRef } from 'react'
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
  globalScore: number
  bullProb: number
  riskLevel: 'low'|'medium'|'high'
  context: string
}

// Sections parsées depuis la réponse GPT (miroir GPTAnalysisData Swift)
interface GPTSections {
  riskLines: string[]
  timingLines: string[]
  technicalLines: string[]
  infoLines: string[]
  fundamentalLines: string[]
  scoreExplanation: string
}

interface Props {
  symbol: string
  price: number
  mtfScore?: number
  mtfSignal?: string
  wtStatus?: string
  vmcStatus?: string
}

// ── Formatters ─────────────────────────────────────────────────────────────

function fmtP(p: number): string {
  return p >= 10000 ? p.toFixed(0) : p >= 100 ? p.toFixed(2) : p >= 1 ? p.toFixed(4) : p.toFixed(6)
}

function calcATR(price: number, mtfScore: number): number {
  const basePct = price > 50000 ? 0.012 : price > 1000 ? 0.018 : price > 10 ? 0.025 : 0.03
  const volMultiplier = 1 + Math.abs(mtfScore) / 200
  return price * basePct * volMultiplier
}

function generateScenarios(price: number, mtfScore: number, wtStatus: string, vmcStatus: string): TradePlanData {
  const atr = calcATR(price, mtfScore)
  const wtBull = wtStatus === 'Bullish Reversal' || wtStatus === 'Smart Bullish' || wtStatus === 'Oversold'
  const wtBear = wtStatus === 'Bearish Reversal' || wtStatus === 'Smart Bearish' || wtStatus === 'Overbought'
  const vmcBull = vmcStatus === 'BUY' || vmcStatus === 'OVERSOLD'
  const vmcBear = vmcStatus === 'SELL' || vmcStatus === 'OVERBOUGHT'
  const doubleBull = wtBull && vmcBull
  const doubleBear = wtBear && vmcBear
  const bullStrength: TradeScenario['signalStrength'] = doubleBull ? 'premium' : wtBull || vmcBull ? 'strong' : mtfScore < -10 ? 'moderate' : 'none'
  const bearStrength: TradeScenario['signalStrength'] = doubleBear ? 'premium' : wtBear || vmcBear ? 'strong' : mtfScore > 10 ? 'moderate' : 'none'
  const bullMult = { premium: 1.0, strong: 1.2, moderate: 1.5, none: 2.0 }[bullStrength]
  const bearMult = { premium: 1.0, strong: 1.2, moderate: 1.5, none: 2.0 }[bearStrength]
  const bullEntry = price + atr * 0.3 * bullMult
  const bullStop  = price - atr * 1.5 * bullMult
  const bullRisk  = bullEntry - bullStop
  const bull: TradeScenario = {
    entry: bullEntry, stop: bullStop,
    tp1: bullEntry + bullRisk * 1.5, tp1RR: '1.5R',
    tp2: bullEntry + bullRisk * 2.5, tp2RR: '2.5R',
    tp3: bullEntry + bullRisk * 4.0, tp3RR: '4.0R',
    entryType: bullStrength === 'premium' ? 'Double Cross Extrême' : bullStrength === 'strong' ? 'Signal Confirmé' : bullStrength === 'moderate' ? 'Setup Modéré' : 'Contre-tendance',
    signalStrength: bullStrength,
  }
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
  const bullProb = (mtfScore + 100) / 200
  const context = mtfScore < -40 ? 'Conditions d\'achat favorables — MTF fortement baissier (signal contrarian)'
    : mtfScore < -10 ? 'Biais baissier modéré — surveillance des niveaux de support'
    : mtfScore > 40 ? 'Conditions de vente favorables — MTF fortement haussier (signal contrarian)'
    : mtfScore > 10 ? 'Biais haussier modéré — surveillance des résistances'
    : 'Marché sans direction claire — attendre une confirmation de signal'
  const riskLevel: TradePlanData['riskLevel'] =
    (bullStrength === 'premium' || bearStrength === 'premium') ? 'low' :
    (bullStrength === 'strong' || bearStrength === 'strong') ? 'medium' : 'high'
  return { bull, bear, globalScore: mtfScore, bullProb, riskLevel, context }
}

// ── GPT Parser (miroir GPTParser.parse() Swift) ────────────────────────────

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

// ── AI Enrichment — prompt complet miroir Swift ────────────────────────────

async function enrichWithAI(symbol: string, price: number, plan: TradePlanData, mtfSignal: string, wtStatus: string, vmcStatus: string): Promise<string> {
  try {
    const fn = httpsCallable<Record<string,unknown>, {choices?: {message:{content:string}}[]}>(fbFn, 'openaiChat')

    const systemPrompt = `Tu es un moteur d'analyse de trading institutionnel intégré dans une application de trading premium.
Tu reçois les données indicateurs (WaveTrend, VMC) et la structure multi-timeframe.
Ta mission : produire une analyse RÉALISTE et EXPLOITABLE basée sur la logique institutionnelle.
Tu dois raisonner comme un desk de trading professionnel.

RÉPONSE STRICTEMENT STRUCTURÉE — respecte cet ordre exact :

1️⃣ AI SCORE / SCORE IA
AI SCORE: X.X / 10
Level: (Low / Neutral / Solid / High probability)
Dominant bias: (Bullish / Bearish / Neutral)
- Structure: X/3
- WaveTrend: X/2
- VMC: X/2
- Momentum: X/1

2️⃣ PROBABILITÉ DES SCÉNARIOS
Bull: XX%
Bear: XX%

3️⃣ PLAN DE TRADE
(pas de contenu ici — déjà généré localement)

4️⃣ GESTION DU RISQUE
Max risk per trade: [valeur]
Position sizing: [méthode]
Inter-TF correlation: [analyse]
Dynamic stop: [conseil]
Global invalidation: [niveau ou condition]

5️⃣ TIMING & CONTEXTE
Optimal session: [session]
Expected volatility: [niveau]
Upcoming catalysts: [événements ou "None identified"]
Index correlation: [corrélation avec indices majeurs]

6️⃣ ANALYSE TECHNIQUE
Key Indicators: [résumé WaveTrend + VMC en 1-2 lignes]
- Wave Trend: [status, cross, momentum]
- VMC: [status, compression, ribbon]
Support & Resistance:
- Major support: [niveau]
- Key resistance: [niveau]
- Order Blocks: [zones]
- FVG: [zones ou "None identified"]

7️⃣ INFORMATIONS IMPORTANTES
[⚡BULLISH] Titre — Impact (1 phrase)
[⚡NEUTRAL] Titre — Impact (1 phrase)
[⚡BEARISH] Titre — Impact (1 phrase)
(minimum 3, maximum 5 items)

8️⃣ ANALYSE FONDAMENTALE
${symbol.match(/USDT$|BTC$|ETH$|BNB$/i) ? 'Not applicable for crypto.' : 'P/E, croissance, bénéfices, actualités corporate.'}

9️⃣ EXPLICATION DU SCORE
(4 lignes max, référencer les sous-scores)

STYLE : institutionnel, concis, sans disclaimer.`

    const userMessage = `Données techniques pour ${symbol} :

Prix actuel : $${fmtP(price)}
Signal MTF global : ${mtfSignal} (score: ${plan.globalScore.toFixed(0)}/100)
WaveTrend : ${wtStatus}
VMC : ${vmcStatus}
Probabilité haussière estimée : ${(plan.bullProb * 100).toFixed(0)}%
Niveau de risque : ${plan.riskLevel}

Plan Bull : Entrée $${fmtP(plan.bull.entry||0)} | Stop $${fmtP(plan.bull.stop||0)} | TP1 $${fmtP(plan.bull.tp1||0)} | TP2 $${fmtP(plan.bull.tp2||0)} | TP3 $${fmtP(plan.bull.tp3||0)}
Plan Bear : Entrée $${fmtP(plan.bear.entry||0)} | Stop $${fmtP(plan.bear.stop||0)} | TP1 $${fmtP(plan.bear.tp1||0)} | TP2 $${fmtP(plan.bear.tp2||0)} | TP3 $${fmtP(plan.bear.tp3||0)}

Génère l'analyse complète selon l'ordre strict défini. Sois précis et exploitable.`

    const res = await fn({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      model: 'gpt-4o-mini',
      max_tokens: 1200,
    })
    return res.data.choices?.[0]?.message?.content || ''
  } catch { return '' }
}

// ── ScenarioCard ───────────────────────────────────────────────────────────

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
    return `${(Math.abs(tp - entry)/risk).toFixed(1)}R`
  }
  return (
    <div style={{ flex:1, background:bgCol, border:`1px solid ${color}30`, borderRadius:14, overflow:'hidden' }}>
      <div style={{ padding:'10px 14px', borderBottom:`1px solid ${color}20`, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:8, height:8, borderRadius:'50%', background:color }} />
          <span style={{ fontSize:13, fontWeight:700, color:'#F0F3FF' }}>{isBull ? 'Scénario Haussier' : 'Scénario Baissier'}</span>
        </div>
        <span style={{ fontSize:10, fontWeight:700, color:strengthColor, background:`${strengthColor}15`, padding:'2px 8px', borderRadius:10, border:`1px solid ${strengthColor}30` }}>{strengthLabel}</span>
      </div>
      {scenario.entryType && (
        <div style={{ padding:'6px 14px', background:`${color}08`, borderBottom:`1px solid ${color}10` }}>
          <span style={{ fontSize:11, color:`${color}CC` }}>🚩 {scenario.entryType}</span>
        </div>
      )}
      <div style={{ padding:'12px 14px', display:'flex', flexDirection:'column', gap:8 }}>
        <div style={{ display:'flex', justifyContent:'space-between' }}>
          <span style={{ fontSize:12, color:'#8F94A3' }}>Entrée</span>
          <span style={{ fontSize:13, fontWeight:700, color, fontFamily:'monospace' }}>${fmtP(scenario.entry||0)}</span>
        </div>
        <div style={{ display:'flex', justifyContent:'space-between' }}>
          <span style={{ fontSize:12, color:'#8F94A3' }}>Stop Loss</span>
          <span style={{ fontSize:13, fontWeight:700, color:'#FF3B30', fontFamily:'monospace' }}>${fmtP(scenario.stop||0)}</span>
        </div>
        <div style={{ height:1, background:`${color}20`, margin:'2px 0' }} />
        <div style={{ fontSize:11, fontWeight:600, color:'#8F94A3', marginBottom:2 }}>Objectifs</div>
        {([['TP1', scenario.tp1], ['TP2', scenario.tp2], ['TP3', scenario.tp3]] as [string, number|undefined][]).map(([label, tp]) => tp && (
          <div key={label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ fontSize:11, color:'#555C70', width:24 }}>{label}</span>
              <span style={{ fontSize:12, fontWeight:600, color:'#22C759', fontFamily:'monospace' }}>${fmtP(tp)}</span>
            </div>
            <span style={{ fontSize:11, fontWeight:700, color:'#FFD700', background:'rgba(255,215,0,0.12)', padding:'1px 7px', borderRadius:6 }}>{rr(scenario.entry, scenario.stop, tp)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Section Components (miroir GPTKVCard + GPTSectionLabel Swift) ──────────

function SectionLabel({ icon, label, color }: { icon: string; label: string; color: string }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
      <span style={{ fontSize:16 }}>{icon}</span>
      <span style={{ fontSize:13, fontWeight:700, color:'#F0F3FF' }}>{label}</span>
      <div style={{ flex:1, height:1, background:`${color}30` }} />
    </div>
  )
}

function KVCard({ lines, accent }: { lines: string[]; accent: string }) {
  return (
    <div style={{ background:'rgba(255,255,255,0.03)', border:`1px solid ${accent}20`, borderRadius:12, padding:'12px 14px', marginBottom:16, display:'flex', flexDirection:'column', gap:6 }}>
      {lines.map((line, i) => {
        // Parse "Key: Value" format
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
        return (
          <div key={i} style={{ fontSize:12, color:'#C5C8D6', lineHeight:1.5, paddingLeft:4 }}>
            {line.replace(/^[-•→]\s*/, '')}
          </div>
        )
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
        const color  = isBull ? '#22C759' : isBear ? '#FF3B30' : '#FF9500'
        const clean  = line.replace(/\[⚡(BULLISH|BEARISH|NEUTRAL|HAUSSIER|BAISSIER|NEUTRE)\]\s*/g, '').trim()
        return (
          <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:8 }}>
            <span style={{ fontSize:12, color, flexShrink:0 }}>⚡</span>
            <span style={{ fontSize:12, color:'#C5C8D6', lineHeight:1.5 }}>{clean}</span>
          </div>
        )
      })}
    </div>
  )
}

function CollapsibleSection({ icon, label, color, preview, children }: { icon: string; label: string; color: string; preview: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginBottom:0 }}>
      <button onClick={() => setOpen(x => !x)} style={{ width:'100%', background:'none', border:'none', padding:0, cursor:'pointer', textAlign:'left' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom: open ? 8 : 4 }}>
          <span style={{ fontSize:16 }}>{icon}</span>
          <span style={{ fontSize:13, fontWeight:700, color:'#F0F3FF' }}>{label}</span>
          <div style={{ flex:1, height:1, background:`${color}30` }} />
          <span style={{ fontSize:10, color:'#555C70' }}>{open ? '▲' : '▼'}</span>
        </div>
        {!open && preview && (
          <div style={{ fontSize:11, color:'#555C70', paddingLeft:24, marginBottom:8, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{preview}</div>
        )}
      </button>
      {open && children}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function TradePlanCard({ symbol, price: priceProp, mtfScore = 0, mtfSignal = 'NEUTRAL', wtStatus = 'Neutral', vmcStatus = 'NEUTRAL' }: Props) {
  const [plan,      setPlan]      = useState<TradePlanData|null>(null)
  const [price,     setPrice]     = useState(0)
  const [aiRaw,     setAiRaw]     = useState('')
  const [sections,  setSections]  = useState<GPTSections|null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [expanded,  setExpanded]  = useState(true)
  const symbolRef = useRef('')
  const priceRef  = useRef(0)

  useEffect(() => {
    const sym = symbol.toUpperCase()
    if (symbolRef.current !== sym) {
      symbolRef.current = sym
      priceRef.current = 0
      setPrice(0); setPlan(null); setAiRaw(''); setSections(null)
    }
    const isCrypto = /USDT$|BUSD$|BTC$|ETH$|BNB$/i.test(sym)

    if (isCrypto) {
      // Crypto → Binance ticker (prix temps réel)
      if (priceProp > 0) { priceRef.current = priceProp; setPrice(priceProp); return }
      fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`)
        .then(r => r.json()).then(d => {
          if (symbolRef.current !== sym) return
          if (d.price) { priceRef.current = parseFloat(d.price); setPrice(parseFloat(d.price)) }
        }).catch(() => {})
    } else {
      // Non-crypto (actions, forex, indices) → fetchYahooCandles Cloud Function
      const fetchNonCryptoPrice = async () => {
        try {
          const fn = httpsCallable<Record<string,unknown>, {s:string; candles:{t:number;o:number;h:number;l:number;c:number;v:number}[]}>(fbFn, 'fetchYahooCandles')
          const res = await fn({ symbol: sym, interval: '1d', range: '5d' })
          if (symbolRef.current !== sym) return
          if (res.data.s === 'ok' && res.data.candles?.length > 0) {
            const lastCandle = res.data.candles[res.data.candles.length - 1]
            const p = lastCandle.c
            if (p > 0) { priceRef.current = p; setPrice(p) }
          }
        } catch { /* ignore */ }
      }
      fetchNonCryptoPrice()
    }
  }, [symbol, priceProp])

  useEffect(() => {
    if (price <= 0) return
    setPlan(generateScenarios(price, mtfScore, wtStatus, vmcStatus))
  }, [symbol, price, mtfScore, wtStatus, vmcStatus])

  const loadAI = useCallback(async () => {
    if (!plan || aiLoading || price <= 0) return
    setAiLoading(true)
    const text = await enrichWithAI(symbol, price, plan, mtfSignal, wtStatus, vmcStatus)
    if (text) {
      setAiRaw(text)
      setSections(parseGPTSections(text))
    }
    setAiLoading(false)
  }, [plan, symbol, price, mtfSignal, wtStatus, vmcStatus, aiLoading])

  if (price <= 0) return (
    <div style={{ background:'#161B22', border:'1px solid #1E2330', borderRadius:16, padding:'20px 16px', display:'flex', alignItems:'center', gap:10 }}>
      <div style={{ width:18, height:18, border:'2px solid #2A2F3E', borderTopColor:'#0A85FF', borderRadius:'50%', animation:'spin 0.7s linear infinite', flexShrink:0 }} />
      <span style={{ fontSize:12, color:'#555C70' }}>Récupération du prix {symbol}...</span>
    </div>
  )
  if (!plan) return null

  const riskColor = { low:'#22C759', medium:'#FF9500', high:'#FF3B30' }[plan.riskLevel]
  const riskLabel = { low:'Faible', medium:'Modéré', high:'Élevé' }[plan.riskLevel]

  return (
    <div style={{ background:'#161B22', border:'1px solid #1E2330', borderRadius:16, overflow:'hidden' }}>

      {/* Header */}
      <div style={{ padding:'12px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer' }} onClick={() => setExpanded(x=>!x)}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:32, height:32, borderRadius:9, background:'linear-gradient(135deg,#0A85FF,#00E5FF)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16 }}>📋</div>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:'#F0F3FF' }}>Plan de Trade</div>
            <div style={{ fontSize:10, color:'#555C70' }}>{symbol} · {/USDT$|BTC$|ETH$|BNB$/i.test(symbol) ? '$' : ''}{fmtP(price)}</div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize:10, color:'#555C70' }}>Bull</span>
            <div style={{ width:60, height:6, background:'#1C2130', borderRadius:3, overflow:'hidden' }}>
              <div style={{ width:`${plan.bullProb*100}%`, height:'100%', background:'#22C759', borderRadius:3 }} />
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
          <span style={{ fontSize:11, fontWeight:600, color:'#00E5FF' }}>Contexte : </span>
          <span style={{ fontSize:11, color:'#8F94A3', lineHeight:1.6 }}>{plan.context}</span>
        </div>

        {/* Scenarios */}
        <div style={{ padding:'0 16px', display:'flex', gap:12, marginBottom:16 }}>
          <ScenarioCard type="bull" scenario={plan.bull} price={price} />
          <ScenarioCard type="bear" scenario={plan.bear} price={price} />
        </div>

        {/* ── Sections IA (affichées après analyse) ── */}
        {sections ? (
          <div style={{ padding:'0 16px 16px', display:'flex', flexDirection:'column', gap:4 }}>

            {/* Technical Analysis — collapsible */}
            {sections.technicalLines.length > 0 && (
              <CollapsibleSection
                icon="📈" label="Technical Analysis" color="#0A85FF"
                preview={sections.technicalLines.slice(0,2).join(' · ')}
              >
                <KVCard lines={sections.technicalLines} accent="#0A85FF" />
              </CollapsibleSection>
            )}

            {/* Risk Management */}
            {sections.riskLines.length > 0 && <>
              <SectionLabel icon="🛡️" label="Risk Management" color="#FF3B30" />
              <KVCard lines={sections.riskLines} accent="#FF3B30" />
            </>}

            {/* Timing & Context */}
            {sections.timingLines.length > 0 && <>
              <SectionLabel icon="🕐" label="Timing & Context" color="#FF9500" />
              <KVCard lines={sections.timingLines} accent="#FF9500" />
            </>}

            {/* Important Information — collapsible */}
            {sections.infoLines.length > 0 && (
              <CollapsibleSection
                icon="⚡" label="Important Information" color="#FF9500"
                preview={sections.infoLines.slice(0,2).join(' · ').replace(/\[⚡(BULLISH|BEARISH|NEUTRAL|HAUSSIER|BAISSIER|NEUTRE)\]\s*/g, '')}
              >
                <NewsCard lines={sections.infoLines} />
              </CollapsibleSection>
            )}

            {/* Fundamental Analysis — collapsible */}
            {sections.fundamentalLines.length > 0 && !sections.fundamentalLines[0].toLowerCase().includes('not applicable') && (
              <CollapsibleSection
                icon="🏢" label="Fundamental Analysis" color="#00E5FF"
                preview={sections.fundamentalLines.slice(0,1).join('')}
              >
                <KVCard lines={sections.fundamentalLines} accent="#00E5FF" />
              </CollapsibleSection>
            )}

            {/* Score Explanation */}
            {sections.scoreExplanation && (
              <div style={{ padding:'10px 12px', background:'rgba(191,90,242,0.06)', border:'1px solid rgba(191,90,242,0.15)', borderRadius:10, marginTop:4 }}>
                <div style={{ fontSize:10, color:'#BF5AF2', fontWeight:600, marginBottom:4 }}>✨ Score IA</div>
                <div style={{ fontSize:11, color:'#8F94A3', lineHeight:1.6 }}>{sections.scoreExplanation}</div>
              </div>
            )}
          </div>
        ) : (
          /* Bouton Analyser avec IA */
          <div style={{ margin:'0 16px 16px', padding:'10px 12px', background:'rgba(0,0,0,0.3)', border:'1px solid #2A2F3E', borderRadius:10 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize:11, color:'#555C70' }}>Analyse complète : Risk · Timing · Technical · Informations</span>
              <button
                onClick={loadAI}
                disabled={aiLoading}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 12px', borderRadius:8, background: aiLoading ? '#1C2130' : 'rgba(191,90,242,0.15)', color: aiLoading ? '#555C70' : '#BF5AF2', cursor: aiLoading ? 'not-allowed' : 'pointer', fontSize:11, fontWeight:600, border:'1px solid rgba(191,90,242,0.3)' }}
              >
                {aiLoading
                  ? <><div style={{ width:12, height:12, border:'2px solid #2A2F3E', borderTopColor:'#BF5AF2', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} /> Analyse...</>
                  : '✨ Analyser avec IA'
                }
              </button>
            </div>
          </div>
        )}
      </>}
    </div>
  )
}
