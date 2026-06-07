// IaTab — Onglet Analyse IA complète
// Synthèse de TOUS les indicateurs disponibles (chart + oscillateurs + dérivés + dispersion)
import React, { useState, useCallback, useRef, useEffect } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'
import type { LightweightChartHandle } from './LightweightChart'
import { calcVMCOscillator } from './OscillatorCharts'
import type { MTFSnapshot } from './MTFDashboard'
import { fetchAndCompute } from '@/services/dispersion/dispersionEngine'
import { CRYPTO_BASKET } from '@/services/dispersion/types'
import { saveIaAnalysis, getIaHistory, updateIaOutcome, getGlobalIaHistory, updateGlobalIaOutcome, updateIaEmbedding } from '@/services/firestore/iaHistory'
import type { ProjectionBar } from './LightweightChart'
import type { IaAnalysisRecord, IaGlobalRecord } from '@/services/firestore/iaHistory'
import { getKnowledge, saveKnowledge, formatKnowledgeForPrompt } from '@/services/firestore/iaLearning'
import type { TradingKnowledge } from '@/services/firestore/iaLearning'
import { useUser } from '@/hooks/useAuth'

const fbFn = getFunctions(app, 'europe-west1')

interface WhalePressure { score: number; buyVol: number; sellVol: number }

interface DispersionContext {
  regime: string; regimeConfidence: number
  dispersionZScore: number; dispersionPercentile: number; returnSkew: number; returnKurtosis: number
  avgCorrelation: number; correlationZScore: number; crossSectionalMomentum: number
  avgComponentVol: number; realizedIndexVol: number; impliedIndexVol: number; volSpread: number; volRegime: string; volZScore: number
  pctUp: number; pctAboveEma20: number; pctAboveEma50: number; advanceDeclineRatio: number; participationScore: number
  basketReturn: number; medianReturn: number; smartMoneyBias: string; distributionScore: number; accumulationScore: number; hiddenStrength: boolean; hiddenWeakness: boolean
  basketHurst: number; basketAutocorr: number; riskOnScore: number; overallScore: number; overallBias: string
  tradeSignal: { action: string; direction: string; bias: string; confidence: number; reasoning: string[]; topLongs: string[]; topShorts: string[] }
  historyDispersion: number[]; historyCorrelation: number[]; historyBreadth: number[]; historyRegimes: string[]
  trendArrows: { dispersion: string; correlation: string; breadth: string; volSpread: string }
}

interface OUSignal {
  excess: string; regime: string; z: number; confluenceSignal: string; vmcStatus: string
}

interface FngData { value: number; label: string; history: number[] }

interface AiTrade {
  label: string; direction: 'LONG' | 'SHORT'
  entry: string; tp1: string; tp2: string; sl: string
  rr: string; probability: number; horizon: string; rationale: string
}

interface AiResult {
  bias: string; score: number; conviction: number; horizon: string; quality: string
  keyLevels: string[]
  catalyst: string
  targets: { tp1: string; tp2: string; sl: string }
  momentum: string; regimeContext: string; summary: string; risk: string; divergence: string
  mtfAnalysis: string
  whaleAnalysis: string
  scenarios: { bull: string; bear: string }
  trades?: AiTrade[]
  projection?: ProjectionBar[]
  priceTarget24h?: string
}

interface Props {
  symbol: string
  isCrypto: boolean
  lwChartRef: React.RefObject<LightweightChartHandle>
  dispersionCtx: DispersionContext | null
  pressure: WhalePressure | null
  liqLong1h: number
  liqShort1h: number
  pdfMtfSnap: MTFSnapshot | null
  ouSignal: OUSignal
  fng: FngData | null
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function calcRSI14(closes: number[]): number {
  if (closes.length < 15) return 50
  let ag = 0, al = 0
  for (let i = closes.length - 14; i < closes.length; i++) {
    const d = closes[i] - closes[i-1]; d > 0 ? ag += d : al -= d
  }
  ag /= 14; al /= 14
  return al === 0 ? 100 : Math.round(100 - 100 / (1 + ag / al))
}

function calcATR14(candles: { high: number; low: number; close: number }[]): number {
  const n = candles.length
  if (n < 15) return 0
  let sum = 0
  for (let i = n - 14; i < n; i++) {
    const c = candles[i], p = candles[i-1]
    sum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close))
  }
  return sum / 14
}

// ── Ichimoku Kumo (forward cloud for projection S/R) ──────────────────────────
interface IchimokuResult {
  bias: 'bull' | 'bear' | 'neutral'          // current cloud color
  futureCloud: { spanA: number; spanB: number }[]  // next `displacement` bars (already known)
  convBaseCross: 'bull' | 'bear' | 'none'    // tenkan/kijun cross
}
function calcIchimoku(
  candles: { high: number; low: number; close: number }[],
  conv = 9, base = 26, spanBLen = 52, displacement = 26
): IchimokuResult {
  const n = candles.length
  const EMPTY: IchimokuResult = { bias: 'neutral', futureCloud: [], convBaseCross: 'none' }
  if (n < spanBLen + displacement) return EMPTY

  const donchian = (end: number, len: number): number => {
    let hi = -Infinity, lo = Infinity
    for (let i = Math.max(0, end - len + 1); i <= end; i++) {
      if (candles[i].high > hi) hi = candles[i].high
      if (candles[i].low < lo) lo = candles[i].low
    }
    return (hi + lo) / 2
  }

  // spanA_raw[i] = avg(conversion, base) at bar i ; spanB_raw[i] = donchian(spanBLen) at bar i
  // These get displayed `displacement` bars ahead → future cloud is known now.
  const spanARaw = (i: number) => (donchian(i, conv) + donchian(i, base)) / 2
  const spanBRaw = (i: number) => donchian(i, spanBLen)

  const last = n - 1
  // Future cloud for the next `displacement` bars = raw values from (last - displacement + d)
  const futureCloud: { spanA: number; spanB: number }[] = []
  for (let d = 1; d <= displacement; d++) {
    const srcIdx = last - displacement + d
    if (srcIdx < 0) continue
    futureCloud.push({ spanA: spanARaw(srcIdx), spanB: spanBRaw(srcIdx) })
  }

  // Current cloud color (at the latest displayed bar)
  const curSpanA = spanARaw(last - displacement + 1 >= 0 ? last : last)
  const curA = futureCloud.length ? futureCloud[0].spanA : curSpanA
  const curB = futureCloud.length ? futureCloud[0].spanB : spanBRaw(last)
  const bias: IchimokuResult['bias'] = curA > curB ? 'bull' : curA < curB ? 'bear' : 'neutral'

  // Conversion/Base cross (tenkan/kijun)
  const c0 = donchian(last, conv), b0 = donchian(last, base)
  const c1 = donchian(last - 1, conv), b1 = donchian(last - 1, base)
  const convBaseCross: IchimokuResult['convBaseCross'] =
    (c1 <= b1 && c0 > b0) ? 'bull' : (c1 >= b1 && c0 < b0) ? 'bear' : 'none'

  return { bias, futureCloud, convBaseCross }
}

// ── RAG helpers ──────────────────────────────────────────────────────────────
function cosineSim(a: number[], b: number[]): number {
  let dot = 0, ma = 0, mb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; ma += a[i] * a[i]; mb += b[i] * b[i] }
  const denom = Math.sqrt(ma) * Math.sqrt(mb)
  return denom === 0 ? 0 : dot / denom
}

function buildEmbeddingText(
  symbol: string, bias: string, rsi: number, vmcStatus: string,
  ouExcess: string, whaleScore: number, regime: string, fng: number, liqBias: number
): string {
  return `${symbol} bias:${bias} rsi:${rsi.toFixed(0)} vmc:${vmcStatus} ou:${ouExcess} whale:${whaleScore.toFixed(2)} regime:${regime} fng:${fng} liqbias:${liqBias > 0 ? 'long' : 'short'}`
}

function findSimilarSetups(
  queryEmbedding: number[],
  records: Array<IaAnalysisRecord | IaGlobalRecord>,
  topK = 3
): Array<{ record: IaAnalysisRecord | IaGlobalRecord; sim: number }> {
  const withEmb = records.filter(r =>
    r.embedding && r.embedding.length > 0 &&
    r.outcome && r.outcome !== 'open' && r.outcome !== 'expired'
  )
  return withEmb
    .map(r => ({ record: r, sim: cosineSim(queryEmbedding, r.embedding!) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, topK)
}

function formatSimilarSetups(similar: Array<{ record: IaAnalysisRecord | IaGlobalRecord; sim: number }>): string {
  if (similar.length === 0) return ''
  const lines = similar.map(({ record: r, sim }) => {
    const dt = new Date(r.timestamp).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
    const outcomeLabel = r.outcome === 'tp1_hit' ? '✅TP1' : r.outcome === 'tp2_hit' ? '✅TP2' : '❌SL'
    const rVal = r.outcomeR != null ? ` ${r.outcomeR > 0 ? '+' : ''}${r.outcomeR.toFixed(1)}R` : ''
    const condStr = [
      r.condRsi != null ? `RSI:${r.condRsi.toFixed(0)}` : '',
      r.condVmcStatus ? `VMC:${r.condVmcStatus}` : '',
      r.condOuExcess && r.condOuExcess !== 'none' ? `OU:${r.condOuExcess}` : '',
      r.condRegime ? `regime:${r.condRegime}` : '',
    ].filter(Boolean).join(' ')
    return `  [${(sim * 100).toFixed(0)}% match] ${r.symbol} ${r.bias} ${dt} — ${condStr} → ${outcomeLabel}${rVal}`
  })
  return `=== SIMILAR PAST SETUPS (RAG — most similar market conditions + outcomes) ===\n${lines.join('\n')}\n→ These real past outcomes should directly inform your probability estimates and direction bias.`
}

// ── Performance feedback brief ───────────────────────────────────────────────
function computePerformanceBrief(
  records: Array<Pick<IaAnalysisRecord, 'outcome' | 'outcomeR' | 'symbol' | 'bias' | 'conviction' | 'trades' | 'condRsi' | 'condWhaleScore' | 'condRegime' | 'condOuExcess' | 'condFng'>>,
  symbol: string
): string {
  const closed = records.filter(r => r.outcome && r.outcome !== 'open' && r.outcome !== 'expired')
  if (closed.length < 3) return 'Insufficient historical data (< 3 resolved trades) — no calibration available yet.'

  const isWin = (r: { outcome?: string }) => r.outcome === 'tp1_hit' || r.outcome === 'tp2_hit'
  const pct = (n: number, d: number) => d === 0 ? '?' : `${(n / d * 100).toFixed(0)}%`

  const wins = closed.filter(isWin)
  const winRate = pct(wins.length, closed.length)
  const avgR = (closed.reduce((s, r) => s + (r.outcomeR ?? 0), 0) / closed.length).toFixed(2)
  const totalR = closed.reduce((s, r) => s + (r.outcomeR ?? 0), 0).toFixed(1)

  // Per direction
  const allTrades = closed.flatMap(r =>
    (r.trades ?? []).map(t => ({ dir: t.direction, prob: t.probability, outcome: r.outcome!, r: r.outcomeR ?? 0 }))
  )
  const longs = allTrades.filter(t => t.dir === 'LONG')
  const shorts = allTrades.filter(t => t.dir === 'SHORT')
  const longWin = `${pct(longs.filter(t => t.outcome !== 'sl_hit').length, longs.length)} (n=${longs.length})`
  const shortWin = `${pct(shorts.filter(t => t.outcome !== 'sl_hit').length, shorts.length)} (n=${shorts.length})`

  // High conviction
  const highConv = closed.filter(r => (r.conviction ?? 0) >= 70)
  const highConvLine = highConv.length >= 2
    ? `High conviction (≥70): ${pct(highConv.filter(isWin).length, highConv.length)} win (n=${highConv.length})`
    : ''

  // Symbol-specific
  const symRecs = closed.filter(r => r.symbol === symbol)
  const symLine = symRecs.length >= 2
    ? `${symbol}: ${symRecs.filter(isWin).length}/${symRecs.length} wins (${pct(symRecs.filter(isWin).length, symRecs.length)})`
    : `${symbol}: insufficient history`

  // ── Level 2: Conditional patterns ────────────────────────────────────────
  const condLines: string[] = []

  // RSI condition
  const lowRsi = closed.filter(r => (r.condRsi ?? 50) < 35)
  const highRsi = closed.filter(r => (r.condRsi ?? 50) > 65)
  if (lowRsi.length >= 2) condLines.push(`RSI<35: ${pct(lowRsi.filter(isWin).length, lowRsi.length)} win (n=${lowRsi.length})`)
  if (highRsi.length >= 2) condLines.push(`RSI>65: ${pct(highRsi.filter(isWin).length, highRsi.length)} win (n=${highRsi.length})`)

  // Whale condition
  const whaleBull = closed.filter(r => (r.condWhaleScore ?? 0) > 0.4)
  const whaleBear = closed.filter(r => (r.condWhaleScore ?? 0) < -0.4)
  if (whaleBull.length >= 2) condLines.push(`Whale accumulation (>0.4): ${pct(whaleBull.filter(isWin).length, whaleBull.length)} win (n=${whaleBull.length})`)
  if (whaleBear.length >= 2) condLines.push(`Whale distribution (<-0.4): ${pct(whaleBear.filter(isWin).length, whaleBear.length)} win (n=${whaleBear.length})`)

  // OU oversold/overbought
  const oversold = closed.filter(r => r.condOuExcess === 'oversold' || r.condOuExcess === 'extreme_os')
  const overbought = closed.filter(r => r.condOuExcess === 'overbought' || r.condOuExcess === 'extreme_ob')
  if (oversold.length >= 2) condLines.push(`OU oversold: ${pct(oversold.filter(isWin).length, oversold.length)} win (n=${oversold.length})`)
  if (overbought.length >= 2) condLines.push(`OU overbought: ${pct(overbought.filter(isWin).length, overbought.length)} win (n=${overbought.length})`)

  // Regime
  const trending = closed.filter(r => r.condRegime === 'trending' || r.condRegime === 'TRENDING')
  const ranging = closed.filter(r => r.condRegime === 'ranging' || r.condRegime === 'RANGING')
  if (trending.length >= 2) condLines.push(`Trending regime: ${pct(trending.filter(isWin).length, trending.length)} win (n=${trending.length})`)
  if (ranging.length >= 2) condLines.push(`Ranging regime: ${pct(ranging.filter(isWin).length, ranging.length)} win (n=${ranging.length})`)

  // Fear & Greed
  const fearZone = closed.filter(r => (r.condFng ?? 50) < 30)
  const greedZone = closed.filter(r => (r.condFng ?? 50) > 70)
  if (fearZone.length >= 2) condLines.push(`FNG Fear (<30): ${pct(fearZone.filter(isWin).length, fearZone.length)} win (n=${fearZone.length})`)
  if (greedZone.length >= 2) condLines.push(`FNG Greed (>70): ${pct(greedZone.filter(isWin).length, greedZone.length)} win (n=${greedZone.length})`)

  // Probability calibration
  const highProb = allTrades.filter(t => t.prob >= 65)
  const calibLine = highProb.length >= 3
    ? `Prob calibration: ≥65% proposals → ${pct(highProb.filter(t => t.outcome !== 'sl_hit').length, highProb.length)} actual win — ${highProb.filter(t => t.outcome !== 'sl_hit').length / highProb.length >= 0.65 ? 'well calibrated' : 'OVERCONFIDENT → lower probabilities'}`
    : ''

  return [
    `=== HISTORICAL PERFORMANCE (self-calibration — ${closed.length} resolved trades) ===`,
    `Overall: Win rate ${winRate} | Avg R: ${avgR} | Total R: ${totalR}R`,
    `By direction: LONG ${longWin} win | SHORT ${shortWin} win`,
    highConvLine,
    symLine,
    condLines.length > 0 ? `Conditional patterns: ${condLines.join(' | ')}` : '',
    calibLine,
    `→ Use these stats to calibrate probability%, favor conditions with historically better win rate.`,
  ].filter(Boolean).join('\n')
}

// ── Main component ───────────────────────────────────────────────────────────
export default function IaTab({ symbol, isCrypto, lwChartRef, dispersionCtx, pressure, liqLong1h, liqShort1h, pdfMtfSnap, ouSignal, fng }: Props) {
  const user = useUser()

  // Restore result from sessionStorage on mount (survives navigation)
  const sessionKey = `iaResult_${symbol}`
  const [result, setResultState] = useState<AiResult | null>(() => {
    try { const s = sessionStorage.getItem(sessionKey); return s ? JSON.parse(s) : null } catch { return null }
  })
  const setResult = (r: AiResult | null) => {
    setResultState(r)
    try { r ? sessionStorage.setItem(sessionKey, JSON.stringify(r)) : sessionStorage.removeItem(sessionKey) } catch {}
  }

  const [loading, setLoading] = useState(false)
  const [projectionBars, setProjectionBars] = useState(30)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [usedSources, setUsedSources] = useState<Record<string, 'prop' | 'auto' | 'none'> | null>(null)
  const [allHistory, setAllHistory] = useState<IaAnalysisRecord[]>([])
  const [globalHistory, setGlobalHistory] = useState<IaGlobalRecord[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [historyFilter, setHistoryFilter] = useState<'all' | string>('all')
  const [historyTab, setHistoryTab] = useState<'personal' | 'global'>('personal')
  const [knowledge, setKnowledge] = useState<TradingKnowledge | null>(null)
  const lastSavedId = useRef<string | null>(null)

  // Derived: filtered history for display
  const history = historyFilter === 'all' ? allHistory : allHistory.filter(r => r.symbol === historyFilter)
  const globalFiltered = historyFilter === 'all' ? globalHistory : globalHistory.filter(r => r.symbol === historyFilter)

  // Re-apply projection after remount (chart needs ~1s to load candles)
  useEffect(() => {
    if (!result?.projection?.length) return
    const t = setTimeout(() => {
      lwChartRef.current?.setProjection(result.projection ?? null)
    }, 1200)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // only on mount

  // Load personal + global history + knowledge base on mount
  useEffect(() => {
    if (user?.uid) {
      getIaHistory(user.uid, undefined, 100).then(setAllHistory).catch(() => {})
      getKnowledge(user.uid).then(setKnowledge).catch(() => {})
    }
    getGlobalIaHistory(undefined, 500).then(glob => {
      setGlobalHistory(glob)
      // Evaluate open global trades
      evaluateGlobalTrades(glob)
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid])

  // Evaluate open IA trades against actual price data
  const evaluatePendingTrades = useCallback(async (uid: string) => {
    const open = history.filter(r => r.outcome === 'open' && r.trades?.length)
    for (const rec of open) {
      try {
        // Fetch klines from rec.timestamp to now (max 200 bars 15m)
        const url = `https://api.binance.com/api/v3/klines?symbol=${rec.symbol}&interval=15m&startTime=${rec.timestamp}&limit=200`
        const klines = await fetch(url).then(r => r.json()) as unknown[][]
        if (!Array.isArray(klines) || klines.length < 2) continue
        const highs = klines.map(k => parseFloat(k[2] as string))
        const lows  = klines.map(k => parseFloat(k[3] as string))
        // Check primary trade (first LONG or SHORT)
        const trade = rec.trades[0]
        if (!trade) continue
        const entry = parseFloat(trade.entry)
        const tp1   = parseFloat(trade.tp1)
        const sl    = parseFloat(trade.sl)
        if (!entry || !tp1 || !sl) continue
        let outcome: IaAnalysisRecord['outcome'] = 'open'
        let outcomeR = 0
        const riskPts = Math.abs(entry - sl)
        for (let i = 0; i < highs.length; i++) {
          if (trade.direction === 'LONG') {
            if (lows[i] <= sl)  { outcome = 'sl_hit';  outcomeR = -1; break }
            if (highs[i] >= tp1) { outcome = 'tp1_hit'; outcomeR = Math.abs(tp1 - entry) / riskPts; break }
          } else {
            if (highs[i] >= sl)  { outcome = 'sl_hit';  outcomeR = -1; break }
            if (lows[i] <= tp1)  { outcome = 'tp1_hit'; outcomeR = Math.abs(tp1 - entry) / riskPts; break }
          }
        }
        // Expire if horizon passed (> 24h open)
        if (outcome === 'open' && Date.now() - rec.timestamp > 24 * 3600_000) outcome = 'expired'
        if (outcome !== 'open' && rec.id) {
          await updateIaOutcome(uid, rec.id, outcome, outcomeR)
          // ── Post-mortem: analyze why trade succeeded/failed ───────────────
          try {
            const structuredKlines = klines.map(k => ({
              time: parseInt(k[0] as string), open: parseFloat(k[1] as string),
              high: parseFloat(k[2] as string), low: parseFloat(k[3] as string), close: parseFloat(k[4] as string),
            }))
            const analyzeFn = httpsCallable<Record<string,unknown>, { lesson: string; errorType: string; severity: string; rule: string }>(fbFn, 'analyzeTradeOutcome')
            const postMortem = await analyzeFn({ record: { ...rec, outcome, outcomeR }, klines: structuredKlines.slice(0, 100) })
            if (postMortem.data.lesson && user?.uid) {
              // Update knowledge base with this lesson
              const currentK = knowledge ?? { version: 0, rules: [], symbolNotes: {}, metaLearning: '', recentLessons: [] }
              const updateFn = httpsCallable<Record<string,unknown>, { rules: string[]; symbolNote: string; metaLearning: string }>(fbFn, 'updateKnowledge')
              const updated = await updateFn({
                uid, currentKnowledge: currentK,
                newLesson: { symbol: rec.symbol, direction: rec.trades[0]?.direction ?? '', outcome, lesson: postMortem.data.lesson, rule: postMortem.data.rule, errorType: postMortem.data.errorType, severity: postMortem.data.severity }
              })
              const newKnowledge: TradingKnowledge = {
                version: (currentK.version ?? 0) + 1,
                lastUpdated: Date.now(),
                rules: updated.data.rules ?? currentK.rules,
                symbolNotes: {
                  ...currentK.symbolNotes,
                  ...(updated.data.symbolNote ? { [rec.symbol]: [...(currentK.symbolNotes?.[rec.symbol] ?? []), updated.data.symbolNote] } : {}),
                },
                metaLearning: updated.data.metaLearning ?? currentK.metaLearning,
                recentLessons: [
                  ...(currentK.recentLessons ?? []).slice(-19),
                  { timestamp: Date.now(), symbol: rec.symbol, direction: rec.trades[0]?.direction ?? '', outcome, lesson: postMortem.data.lesson }
                ],
              }
              await saveKnowledge(uid, newKnowledge)
              setKnowledge(newKnowledge)
            }
          } catch { /* post-mortem non-blocking */ }
        }
      } catch { /* skip */ }
    }
    // Refresh after evaluation
    getIaHistory(uid, undefined, 100).then(setAllHistory).catch(() => {})
  }, [history, symbol, knowledge])

  // Evaluate open global trades (runs on load, lightweight — max 50 open at a time)
  const evaluateGlobalTrades = useCallback(async (records: IaGlobalRecord[]) => {
    const open = records.filter(r => r.outcome === 'open' && r.id && r.trades?.length)
      .slice(0, 50) // limit to avoid too many API calls
    for (const rec of open) {
      try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${rec.symbol}&interval=15m&startTime=${rec.timestamp}&limit=200`
        const klines = await fetch(url).then(r => r.json()) as unknown[][]
        if (!Array.isArray(klines) || klines.length < 2) continue
        const highs = klines.map(k => parseFloat(k[2] as string))
        const lows  = klines.map(k => parseFloat(k[3] as string))
        const trade = rec.trades[0]; if (!trade) continue
        const entry = parseFloat(trade.entry), tp1 = parseFloat(trade.tp1), sl = parseFloat(trade.sl)
        if (!entry || !tp1 || !sl) continue
        let outcome: IaAnalysisRecord['outcome'] = 'open'; let outcomeR = 0
        const riskPts = Math.abs(entry - sl)
        for (let i = 0; i < highs.length; i++) {
          if (trade.direction === 'LONG') {
            if (lows[i] <= sl)   { outcome = 'sl_hit';  outcomeR = -1; break }
            if (highs[i] >= tp1) { outcome = 'tp1_hit'; outcomeR = Math.abs(tp1-entry)/riskPts; break }
          } else {
            if (highs[i] >= sl)  { outcome = 'sl_hit';  outcomeR = -1; break }
            if (lows[i] <= tp1)  { outcome = 'tp1_hit'; outcomeR = Math.abs(tp1-entry)/riskPts; break }
          }
        }
        if (outcome === 'open' && Date.now() - rec.timestamp > 24*3600_000) outcome = 'expired'
        if (outcome !== 'open' && rec.id) {
          await updateGlobalIaOutcome(rec.id, outcome, outcomeR)
        }
      } catch { /* skip */ }
    }
    // Refresh global after evaluation
    getGlobalIaHistory(undefined, 500).then(setGlobalHistory).catch(() => {})
  }, [])

  const analyze = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      // ── 0. Auto-fetch missing data ────────────────────────────────────────
      let liveMtf: string | null = null
      let liveWhale: string | null = null
      let liveOU: string | null = null
      let liveDisp: string | null = null

      const autoFetches: Promise<void>[] = []

      // MTF — fetch RSI for 5 timeframes if pdfMtfSnap absent
      if (!pdfMtfSnap && symbol) {
        autoFetches.push((async () => {
          try {
            const TFS = ['5m','15m','1h','4h','1d']
            const base = isCrypto ? 'https://fapi.binance.com/fapi/v1' : 'https://api.binance.com/api/v3'
            const results = await Promise.all(TFS.map(t =>
              fetch(`${base}/klines?symbol=${symbol}&interval=${t}&limit=30`)
                .then(r => r.json())
                .then((k: unknown[][]) => {
                  const cls = k.map(c => parseFloat(c[4] as string))
                  const r = calcRSI14(cls)
                  return { t, r, sig: r > 60 ? 'BULLISH' : r < 40 ? 'BEARISH' : 'NEUTRAL' }
                })
                .catch(() => ({ t, r: 50, sig: 'NEUTRAL' }))
            ))
            const avg = results.reduce((s,x) => s + x.r, 0) / results.length
            const bull = results.filter(x => x.r > 55).length
            const bear = results.filter(x => x.r < 45).length
            const sig = bull >= 3 ? 'BULLISH' : bear >= 3 ? 'BEARISH' : 'NEUTRAL'
            liveMtf = `Global score: ${Math.round(avg)}/100 | Signal: ${sig} | Confluence: ${Math.round(Math.max(bull,bear)/TFS.length*100)}%
  Per-timeframe: ${results.map(x=>`${x.t}:${x.sig}(RSI${x.r.toFixed(0)})`).join(' | ')} [auto-fetched]`
          } catch {}
        })())
      }

      // Whale pressure — fetch last 500 aggTrades if pressure absent
      if (isCrypto && !pressure && symbol) {
        autoFetches.push((async () => {
          try {
            const trades = await fetch(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${symbol}&limit=500`)
              .then(r => r.json()) as { p: string; q: string; m: boolean }[]
            if (Array.isArray(trades) && trades.length > 0) {
              let bV = 0, sV = 0
              for (const t of trades) { const v = parseFloat(t.p)*parseFloat(t.q); if(t.m) sV+=v; else bV+=v }
              const tot = bV+sV, sc = tot>0 ? (bV-sV)/tot : 0
              liveWhale = `Whale pressure score: ${(sc*100).toFixed(0)}% (${sc>0.3?'ACCUMULATION':sc<-0.3?'DISTRIBUTION':'NEUTRAL'})
  Buy: $${(bV/1e6).toFixed(1)}M | Sell: $${(sV/1e6).toFixed(1)}M [auto-fetched last 500 trades]`
            }
          } catch {}
        })())
      }

      // OU Z-score — compute from 1h closes if ouSignal default
      if (ouSignal.excess === 'none' && ouSignal.z === 0 && symbol) {
        autoFetches.push((async () => {
          try {
            const kl = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=50`)
              .then(r => r.json()) as unknown[][]
            const cls = kl.map(k => parseFloat(k[4] as string))
            const mean = cls.reduce((s,c)=>s+c,0)/cls.length
            const std = Math.sqrt(cls.reduce((s,c)=>s+(c-mean)**2,0)/cls.length)
            const z = std>0 ? (cls[cls.length-1]-mean)/std : 0
            const exc = z>2?'extreme_overbought':z>1?'overbought':z<-2?'extreme_oversold':z<-1?'oversold':'none'
            liveOU = `Excess: ${exc} | Regime: auto | Z-score: ${z.toFixed(2)}σ [auto-computed 1h closes] | Confluence signal: ${z<-1?'long':z>1?'short':'neutral'}`
          } catch {}
        })())
      }

      // Dispersion engine — auto-compute CRYPTO_BASKET if no dispersionCtx
      if (isCrypto && !dispersionCtx) {
        autoFetches.push((async () => {
          try {
            const r = await fetchAndCompute(CRYPTO_BASKET, '1h', 100, 50, 20)
            if (!r) return
            liveDisp = `Regime: ${r.regime} (conf ${r.regimeConfidence}%) | Overall: ${r.overallBias} ${r.overallScore}/100 | RiskOn: ${r.riskOnScore}/100
  Trend → Dispersion:${r.trendArrows.dispersion} Correlation:${r.trendArrows.correlation} Breadth:${r.trendArrows.breadth} VolSpread:${r.trendArrows.volSpread}
  Dispersion: Z=${r.dispersionZScore.toFixed(2)}σ pct=${r.dispersionPercentile}th | Skew=${r.returnSkew.toFixed(2)} Kurt=${r.returnKurtosis.toFixed(2)}
  Correlation: avg=${r.avgCorrelation.toFixed(3)} Z=${r.correlationZScore.toFixed(2)}σ | X-sect momentum=${r.crossSectionalMomentum.toFixed(3)}
  Volatility: comp=${r.avgComponentVol.toFixed(1)}% realized=${r.realizedIndexVol.toFixed(1)}% implied=${r.impliedIndexVol.toFixed(1)}% spread=${r.volSpread.toFixed(2)}% regime=${r.volRegime} Z=${r.volZScore.toFixed(2)}σ
  Breadth: ${Math.round(r.pctUp)}% up | EMA20=${Math.round(r.pctAboveEma20)}% EMA50=${Math.round(r.pctAboveEma50)}% A/D=${r.advanceDeclineRatio.toFixed(2)} participation=${Math.round(r.participationScore)}%
  Smart money: ${r.smartMoneyBias} | basket=${r.basketReturn.toFixed(3)}% median=${r.medianReturn.toFixed(3)}% | distrib=${r.distributionScore}/100 accum=${r.accumulationScore}/100
  ${r.hiddenStrength ? '⚡ HIDDEN STRENGTH: quiet accumulation' : ''}${r.hiddenWeakness ? '⚠ HIDDEN WEAKNESS: stealth distribution' : ''}
  Quant: Hurst=${r.basketHurst.toFixed(3)} Autocorr=${r.basketAutocorr.toFixed(3)}
  Signal: ${r.tradeSignal.action} / ${r.tradeSignal.direction} (conf ${r.tradeSignal.confidence}%)
  Reasoning: ${r.tradeSignal.reasoning.join(' | ')}
  Leaders: ${r.tradeSignal.topLongs.join(', ')||'none'} | Laggards: ${r.tradeSignal.topShorts.join(', ')||'none'} [auto-computed]`
          } catch {}
        })())
      }

      await Promise.all(autoFetches)

      // ── 1. Chart data (candles + indicators from LW chart) ──────────────
      const chartData = lwChartRef.current?.getAnalysisData()
      const candles = chartData?.candles ?? []
      const tf = chartData?.tf ?? '?'
      const n = candles.length

      const closes = candles.map(c => c.close)
      const cur = candles[n - 1]
      const prev = candles[n - 2]
      const chg = cur && prev ? ((cur.close - prev.close) / prev.close * 100).toFixed(2) : '0'

      const rsi = calcRSI14(closes)
      const atr = calcATR14(candles)

      // ── VMC wave state (for projection mean-reversion cycle) ──────────────
      const vmcCandles = candles.map(c => ({ o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume ?? 0, t: c.time }))
      const vmc = calcVMCOscillator(vmcCandles)
      const vmcSig = vmc.sig
      const curVmc = vmcSig.length ? vmcSig[vmcSig.length - 1] : 0
      const vmcMom = vmc.momentum.length ? vmc.momentum[vmc.momentum.length - 1] : 0
      const obLevel = vmc.obLevel || 40, osLevel = vmc.osLevel || -40
      // Estimate VMC cycle period from sig zero-crossings (last ~100 bars)
      const vmcPeriod = (() => {
        const recent = vmcSig.slice(-100)
        const crossings: number[] = []
        for (let i = 1; i < recent.length; i++)
          if ((recent[i-1] <= 0 && recent[i] > 0) || (recent[i-1] >= 0 && recent[i] < 0)) crossings.push(i)
        if (crossings.length < 2) return 20
        const gaps = crossings.slice(1).map((c, i) => c - crossings[i])
        const avgHalf = gaps.reduce((a, b) => a + b, 0) / gaps.length
        return Math.max(8, Math.min(60, avgHalf * 2))
      })()

      // ── Ichimoku Kumo: forward cloud = known future S/R for projection ────
      const ichimoku = calcIchimoku(candles)

      const last50 = candles.slice(-50)
      const high50 = last50.length ? Math.max(...last50.map(c => c.high)) : 0
      const low50  = last50.length ? Math.min(...last50.map(c => c.low)) : 0
      const closes50 = last50.map(c => c.close.toFixed(2)).join(',')
      const vols50 = last50.map(c => c.volume ?? 0)
      const avgVol = vols50.length ? vols50.reduce((a,b)=>a+b,0) / vols50.length : 0
      const lastVol3 = vols50.slice(-3).reduce((a,b)=>a+b,0) / 3
      const volTrend = lastVol3 > avgVol * 1.3 ? `INCREASING +${Math.round((lastVol3/avgVol-1)*100)}%`
        : lastVol3 < avgVol * 0.7 ? `DECREASING -${Math.round((1-lastVol3/avgVol)*100)}%` : 'NEUTRAL'

      const vmcStatus = chartData?.vmcStatus ?? 'N/A'
      const bb = chartData?.bbResult?.slice(-1)[0]
      const bbStr = bb ? `upper=${bb.upper.toFixed(2)} mid=${bb.middle.toFixed(2)} lower=${bb.lower.toFixed(2)}` : 'N/A'
      const bbPos = bb && cur ? (cur.close > bb.upper ? 'ABOVE_UPPER (overbought)' : cur.close < bb.lower ? 'BELOW_LOWER (oversold)' : cur.close > bb.middle ? 'ABOVE_MID' : 'BELOW_MID') : 'N/A'

      // ── 2. SMC structure ─────────────────────────────────────────────────
      let smcSection = 'Not available (enable SMC indicator on chart)'
      const smc = chartData?.smcResult
      if (smc && cur) {
        const p = cur.close
        const nearBull = smc.bullOBs.filter(o => Math.abs((o.top+o.btm)/2/p-1) < 0.04).slice(0,4)
        const nearBear = smc.bearOBs.filter(o => Math.abs((o.top+o.btm)/2/p-1) < 0.04).slice(0,4)
        const bFVG = smc.bullFVGs.filter(f => Math.abs((f.top+f.btm)/2/p-1) < 0.05).slice(0,3)
        const rFVG = smc.bearFVGs.filter(f => Math.abs((f.top+f.btm)/2/p-1) < 0.05).slice(0,3)
        const rows: string[] = []
        if (nearBull.length) rows.push(`Bull OBs (demand zones): ${nearBull.map(o=>`${o.btm.toFixed(2)}-${o.top.toFixed(2)}`).join(', ')}`)
        if (nearBear.length) rows.push(`Bear OBs (supply zones): ${nearBear.map(o=>`${o.btm.toFixed(2)}-${o.top.toFixed(2)}`).join(', ')}`)
        if (bFVG.length) rows.push(`Bull FVGs (gap fill support): ${bFVG.map(f=>`${f.btm.toFixed(2)}-${f.top.toFixed(2)}`).join(', ')}`)
        if (rFVG.length) rows.push(`Bear FVGs (gap fill resistance): ${rFVG.map(f=>`${f.btm.toFixed(2)}-${f.top.toFixed(2)}`).join(', ')}`)
        smcSection = rows.length ? rows.join('\n  ') : 'No OBs/FVGs within 4-5% of price'
      }

      // ── 3. MSD structure ─────────────────────────────────────────────────
      let msdSection = 'N/A'
      const msd = chartData?.msdResult
      if (msd) {
        const highs = msd.swingHighs.slice(-5).map(s=>`${s.type}@${s.price.toFixed(2)}`).join(', ')
        const lows  = msd.swingLows.slice(-5).map(s=>`${s.type}@${s.price.toFixed(2)}`).join(', ')
        const bos   = msd.bosLines.slice(-4).map(b=>`${b.dir}@${b.price.toFixed(2)}`).join(', ')
        msdSection = `Swing highs: ${highs || 'N/A'} | Swing lows: ${lows || 'N/A'}${bos ? ` | Break of Structure: ${bos}` : ''}`
      }

      // ── 4. MTF snapshot ──────────────────────────────────────────────────
      let mtfSection = liveMtf ?? 'Not available'
      if (pdfMtfSnap) {
        const snap = pdfMtfSnap
        mtfSection = `Global score: ${snap.globalScore}/100 | Signal: ${snap.globalSignal} | Confluence: ${snap.confluence}%
  RSI overall: ${snap.globalRSI?.toFixed(1) ?? 'N/A'} | VMC overall: ${snap.globalVMC?.toFixed(1) ?? 'N/A'}
  ${snap.isTurningUp ? '↑ Market turning UP' : snap.isTurningDown ? '↓ Market turning DOWN' : '→ Market stable'}
  Per-timeframe: ${snap.readings?.slice(0,6).map(r=>`${r.tf}:${r.signal}`).join(' | ') ?? 'N/A'}`
      }

      // ── 5. OU oscillator ─────────────────────────────────────────────────
      const ouSection = liveOU ?? `Excess: ${ouSignal.excess} | Regime: ${ouSignal.regime} | Z-score: ${ouSignal.z.toFixed(2)}σ | VMC(OU): ${ouSignal.vmcStatus} | Confluence signal: ${ouSignal.confluenceSignal}`

      // ── 6. Whale & liquidations (crypto only) ───────────────────────────
      let whaleSection = 'N/A (non-crypto asset)'
      if (isCrypto) {
        if (liveWhale && !pressure) {
          const liqBias = liqLong1h - liqShort1h
          whaleSection = `${liveWhale}
  1h Liquidations: Long $${(liqLong1h/1e6).toFixed(1)}M | Short $${(liqShort1h/1e6).toFixed(1)}M
  Liq bias: ${Math.abs(liqBias) < 0.1e6 ? 'NEUTRAL' : liqBias > 0 ? `BEARISH` : `BULLISH`}`
        } else {
          const wp = pressure?.score ?? 0
          const liqBias = liqLong1h - liqShort1h
          whaleSection = `Whale pressure score: ${(wp*100).toFixed(0)}% (${wp > 0.3 ? 'ACCUMULATION' : wp < -0.3 ? 'DISTRIBUTION' : 'NEUTRAL'})
  Buy volume: $${((pressure?.buyVol ?? 0)/1e6).toFixed(1)}M | Sell volume: $${((pressure?.sellVol ?? 0)/1e6).toFixed(1)}M
  1h Liquidations: Long $${(liqLong1h/1e6).toFixed(1)}M | Short $${(liqShort1h/1e6).toFixed(1)}M
  Liq bias: ${Math.abs(liqBias) < 0.1e6 ? 'NEUTRAL' : liqBias > 0 ? `BEARISH (more longs liquidated $${(Math.abs(liqBias)/1e6).toFixed(1)}M more)` : `BULLISH (more shorts liquidated $${(Math.abs(liqBias)/1e6).toFixed(1)}M more)`}`
        }
      }

      // ── 7. Fear & Greed ──────────────────────────────────────────────────
      const fngSection = fng ? `Value: ${fng.value}/100 (${fng.label}) | 7-day trend: ${fng.history.slice(-7).join('→')}` : 'N/A'

      // ── 8. Dispersion engine ─────────────────────────────────────────────
      const d = dispersionCtx
      const dispSection = liveDisp && !d ? liveDisp : d ? `Regime: ${d.regime} (conf ${d.regimeConfidence}%) | Overall: ${d.overallBias} ${d.overallScore}/100 | RiskOn: ${d.riskOnScore}/100
  Trend → Dispersion:${d.trendArrows.dispersion} Correlation:${d.trendArrows.correlation} Breadth:${d.trendArrows.breadth} VolSpread:${d.trendArrows.volSpread}
  Dispersion: Z=${d.dispersionZScore.toFixed(2)}σ pct=${d.dispersionPercentile}th | Skew=${d.returnSkew.toFixed(2)} Kurt=${d.returnKurtosis.toFixed(2)}
  History: ${d.historyDispersion.map(v=>v.toFixed(3)).join('→')}
  Correlation: avg=${d.avgCorrelation.toFixed(3)} Z=${d.correlationZScore.toFixed(2)}σ | X-sect momentum=${d.crossSectionalMomentum.toFixed(3)}
  Corr history: ${d.historyCorrelation.map(v=>v.toFixed(3)).join('→')}
  Volatility: comp=${d.avgComponentVol.toFixed(1)}% realized=${d.realizedIndexVol.toFixed(1)}% implied=${d.impliedIndexVol.toFixed(1)}% spread=${d.volSpread.toFixed(2)}% regime=${d.volRegime} Z=${d.volZScore.toFixed(2)}σ
  Breadth: ${Math.round(d.pctUp)}% up | EMA20=${Math.round(d.pctAboveEma20)}% EMA50=${Math.round(d.pctAboveEma50)}% A/D=${d.advanceDeclineRatio.toFixed(2)} participation=${Math.round(d.participationScore)}%
  Breadth history: ${d.historyBreadth.map(v=>Math.round(v)+'%').join('→')}
  Regime history: ${d.historyRegimes.join('→')}
  Smart money: ${d.smartMoneyBias} | basket=${d.basketReturn.toFixed(3)}% median=${d.medianReturn.toFixed(3)}% | distrib=${d.distributionScore}/100 accum=${d.accumulationScore}/100
  ${d.hiddenStrength ? '⚡ HIDDEN STRENGTH: basket < median (quiet accumulation)' : ''}${d.hiddenWeakness ? '⚠ HIDDEN WEAKNESS: basket > median (stealth distribution)' : ''}
  Quant: Hurst=${d.basketHurst.toFixed(3)} (${d.basketHurst>0.55?'TRENDING':d.basketHurst<0.45?'MEAN-REVERTING':'RANDOM WALK'}) Autocorr=${d.basketAutocorr.toFixed(3)}
  Signal: ${d.tradeSignal.action} / ${d.tradeSignal.direction} (conf ${d.tradeSignal.confidence}%)
  Reasoning: ${d.tradeSignal.reasoning.join(' | ')}
  Leaders: ${d.tradeSignal.topLongs.join(', ')||'none'} | Laggards: ${d.tradeSignal.topShorts.join(', ')||'none'}` : 'Not available — visit Dispersion tab first to compute'

      // ── 9. Build prompt ──────────────────────────────────────────────────
      const curPrice = cur?.close ?? 0

      // Performance feedback: merge personal + global closed records for calibration
      const closedForBrief = [
        ...allHistory.filter(r => r.outcome && r.outcome !== 'open'),
        ...globalHistory.filter(r => r.outcome && r.outcome !== 'open').slice(0, 100),
      ]
      const perfBrief = computePerformanceBrief(closedForBrief, symbol)
      const knowledgeSection = knowledge ? formatKnowledgeForPrompt(knowledge, symbol) : ''

      // RAG: find similar past setups using embeddings (Level 3)
      const currentRegime = liveDisp
        ? (liveDisp.includes('TRENDING') ? 'trending' : 'ranging')
        : (dispersionCtx?.regime?.toLowerCase() ?? ouSignal.regime)
      let ragSection = ''
      try {
        const queryEmbText = buildEmbeddingText(
          symbol, 'UNKNOWN', rsi, ouSignal.vmcStatus, ouSignal.excess,
          pressure?.score ?? 0, currentRegime, fng?.value ?? 50, isCrypto ? liqLong1h - liqShort1h : 0
        )
        const embedFn = httpsCallable<Record<string,unknown>, { embedding: number[] }>(fbFn, 'generateEmbedding')
        const embRes = await embedFn({ text: queryEmbText })
        if (embRes.data.embedding) {
          const allRecords = [...allHistory, ...globalHistory]
          const similar = findSimilarSetups(embRes.data.embedding, allRecords, 3)
          ragSection = formatSimilarSetups(similar)
        }
      } catch { /* RAG optional — don't block analysis if it fails */ }

      const systemPrompt = `You are an elite institutional trading analyst. Synthesize ALL provided market data into actionable trading analysis. Rules:
1. ALL price levels (keyLevels, targets, trades) MUST be derived from the actual data provided — never invent levels unrelated to the data.
2. Current price is explicitly stated. For BULLISH setups: tp1 > tp2 > entry_price > sl. For BEARISH setups: tp1 < tp2 < entry_price < sl. NEVER put tp below entry for a BULLISH trade.
3. Provide 2-3 distinct trade setups in "trades" array covering different timeframes or scenarios.
4. keyLevels must be real S/R levels from SMC/MSD data or 50-bar range extremes.
5. Respond ONLY with valid JSON, no markdown, no extra text.
6. LEARNED RULES section contains post-mortem lessons from real past trades — these are MANDATORY. Do not repeat documented errors. If a rule says "don't trade X condition", do not propose it.
7. HISTORICAL PERFORMANCE section shows your past accuracy. Use it to calibrate probability% and direction bias — if SHORT trades historically underperform, lower SHORT probabilities. If overconfident, lower all probabilities.`

      const userPrompt = `=== ASSET ===
Symbol: ${symbol} | Timeframe: ${tf} | CURRENT PRICE: ${curPrice.toFixed(2)} (${chg}%) | ATR(14): ${atr.toFixed(2)} (${cur ? ((atr/cur.close)*100).toFixed(2) : '?'}%)
50-bar range: High=${high50.toFixed(2)} Low=${low50.toFixed(2)} | Price at ${cur && high50 !== low50 ? (((cur.close-low50)/(high50-low50))*100).toFixed(0) : '?'}% of range
Closes (last 50): ${closes50}
Volume: ${volTrend}

=== PRICE INDICATORS ===
RSI(14): ${rsi} | VMC status: ${vmcStatus}
VMC wave: ${curVmc.toFixed(0)} (overbought ${obLevel} / oversold ${osLevel}) momentum ${vmcMom>=0?'+':''}${vmcMom.toFixed(0)} cycle≈${vmcPeriod.toFixed(0)} bars — ${curVmc>obLevel?'OVERBOUGHT, expect pullback':curVmc<osLevel?'OVERSOLD, expect bounce':'mid-range'}
Ichimoku Kumo: cloud ${ichimoku.bias.toUpperCase()} | Conv/Base cross: ${ichimoku.convBaseCross} | Future cloud (next ${ichimoku.futureCloud.length} bars) top≈${ichimoku.futureCloud.length ? Math.max(ichimoku.futureCloud[ichimoku.futureCloud.length-1].spanA, ichimoku.futureCloud[ichimoku.futureCloud.length-1].spanB).toFixed(2) : '?'} bot≈${ichimoku.futureCloud.length ? Math.min(ichimoku.futureCloud[ichimoku.futureCloud.length-1].spanA, ichimoku.futureCloud[ichimoku.futureCloud.length-1].spanB).toFixed(2) : '?'} (known forward S/R — price reacts at these levels)
Bollinger Bands: ${bbStr} | Position: ${bbPos}
OU Channel: ${ouSection}

=== STRUCTURE (SMC / Market Structure) ===
${smcSection}
MSD: ${msdSection}

=== MULTI-TIMEFRAME (MTF) ===
${mtfSection}

=== WHALE & LIQUIDATIONS ===
${whaleSection}

=== FEAR & GREED ===
${fngSection}

=== MARKET INTERNALS (DISPERSION ENGINE — institutional grade) ===
${dispSection}

${knowledgeSection ? knowledgeSection + '\n\n' : ''}${ragSection ? ragSection + '\n\n' : ''}${perfBrief}

Current price is ${curPrice.toFixed(2)}. All TP/SL levels must be consistent with this price and with the bias direction.

Respond with EXACTLY this JSON (no example values — compute everything from the data above):
{"bias":"BULLISH|BEARISH|NEUTRAL","score":0,"conviction":0,"horizon":"Xh-Yh","quality":"Low|Medium|High","keyLevels":["LEVEL1","LEVEL2","LEVEL3","LEVEL4"],"catalyst":"specific catalyst from data","targets":{"tp1":"PRICE","tp2":"PRICE","sl":"PRICE"},"momentum":"BULLISH|BEARISH|NEUTRAL","regimeContext":"dispersion regime context","summary":"3-4 sentences with specific data references","risk":"specific risk factors","divergence":"divergence observations","mtfAnalysis":"MTF alignment with specific TF signals","whaleAnalysis":"whale/liq analysis with numbers","scenarios":{"bull":"bullish scenario with trigger and target","bear":"bearish scenario with invalidation"},"trades":[{"label":"Primary setup label","direction":"LONG|SHORT","entry":"PRICE","tp1":"PRICE","tp2":"PRICE","sl":"PRICE","rr":"X.X","probability":0,"horizon":"Xh","rationale":"1 sentence"},{"label":"Alternative setup","direction":"LONG|SHORT","entry":"PRICE","tp1":"PRICE","tp2":"PRICE","sl":"PRICE","rr":"X.X","probability":0,"horizon":"Xh","rationale":"1 sentence"}],"priceTarget24h":"PRICE expected price after the horizon — drives the chart projection"}

The "priceTarget24h" must be a single realistic price the asset will likely reach by the end of your horizon, consistent with bias and key levels. The projection candles are rendered client-side from this target.`

      const fn = httpsCallable<Record<string,unknown>, {choices?: {message:{content:string}}[]}>(fbFn, 'openaiChat')
      const res = await fn({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], model: 'gpt-4o-mini', max_tokens: 1400 })
      const raw = res.data.choices?.[0]?.message?.content || ''
      if (!raw) throw new Error('Réponse vide du modèle')
      const start = raw.indexOf('{'), end = raw.lastIndexOf('}')
      if (start === -1 || end === -1) throw new Error('JSON introuvable dans la réponse')
      const parsed: AiResult = JSON.parse(raw.slice(start, end + 1))
      if (!Array.isArray(parsed.keyLevels)) parsed.keyLevels = [parsed.keyLevels ?? ''].filter(Boolean)
      if (!parsed.targets) parsed.targets = { tp1: '', tp2: '', sl: '' }
      if (!parsed.conviction) parsed.conviction = 3
      if (!parsed.horizon) parsed.horizon = '—'
      if (!parsed.scenarios) parsed.scenarios = { bull: '', bear: '' }
      if (!Array.isArray(parsed.trades)) parsed.trades = []
      // ── Generate projection candles CLIENT-SIDE (guided by AI target) ─────
      {
        // Target price: from AI priceTarget24h, else from primary trade tp1, else bias drift
        let target = parseFloat(parsed.priceTarget24h ?? '')
        if (!isFinite(target) || target <= 0) {
          const t0 = parsed.trades?.[0]
          const tp = t0 ? parseFloat(t0.tp1) : NaN
          if (isFinite(tp) && tp > 0) target = tp
          else {
            const isBull = parsed.bias === 'BULLISH', isBear = parsed.bias === 'BEARISH'
            target = curPrice + (isBull ? atr * 4 : isBear ? -atr * 4 : 0)
          }
        }
        // ── Indicator-aware path generation ──────────────────────────────
        const totalMove = target - curPrice

        // 1. Conviction (1-5 or 0-100) → drift consistency. High conviction = smoother trend
        const convRaw = parsed.conviction ?? 3
        const conviction = convRaw > 10 ? convRaw / 100 : convRaw / 5   // normalize to 0-1
        const driftStrength = 0.5 + conviction * 0.5                     // 0.5..1.0

        // 2. Volatility from ATR + dispersion regime (high dispersion = wider candles)
        const dispVol = dispersionCtx
          ? (dispersionCtx.regime === 'HIGH_DISPERSION' || dispersionCtx.volRegime === 'high' ? 1.4 : 0.85)
          : liveDisp ? (liveDisp.includes('HIGH') ? 1.4 : 0.9) : 1.0
        const vol = Math.max(atr * 0.4, curPrice * 0.0008) * dispVol

        // 3. Momentum: early bars follow current momentum direction
        const momBull = parsed.momentum === 'BULLISH'
        const momBear = parsed.momentum === 'BEARISH'
        const momBias = momBull ? 1 : momBear ? -1 : 0

        // 4. Key levels (parse numeric S/R from keyLevels) → price reacts near them
        const keyPrices = (parsed.keyLevels ?? [])
          .map(k => parseFloat(String(k).replace(/[^0-9.]/g, '')))
          .filter(p => isFinite(p) && p > 0 && Math.abs(p / curPrice - 1) < 0.15)

        // S-curve drift: slower start, accelerate mid, ease near target (realistic path)
        const easeDrift = (i: number) => {
          const t = (i + 1) / projectionBars
          // ease-in-out cumulative fraction
          const prev = i / projectionBars
          const ease = (x: number) => x * x * (3 - 2 * x)  // smoothstep
          return totalMove * (ease(t) - ease(prev))
        }

        // 5. VMC wave: continue the oscillator cycle → mean-reversion at extremes
        const vmcAmp = Math.max(30, Math.abs(curVmc))
        const phaseDir = vmcMom >= 0 ? 1 : -1
        const vmcPhase0 = Math.asin(Math.max(-1, Math.min(1, curVmc / vmcAmp)))
        const vmcW = (2 * Math.PI) / vmcPeriod
        const vmcAt = (i: number) => vmcAmp * Math.sin(vmcPhase0 + phaseDir * vmcW * (i + 1))

        // 6. Ichimoku Kumo: future cloud = known S/R for next ~26 bars
        const cloud = ichimoku.futureCloud  // [{spanA, spanB}] indexed by future bar (0 = bar1)
        const cloudBias = ichimoku.bias === 'bull' ? 1 : ichimoku.bias === 'bear' ? -1 : 0

        let prevClose = curPrice
        parsed.projection = Array.from({ length: projectionBars }, (_, i) => {
          const open = prevClose
          let drift = easeDrift(i) * driftStrength

          // Momentum kick on first ~20% of bars
          if (i < projectionBars * 0.2) drift += momBias * vol * 0.3

          // Ichimoku cloud bias: small persistent drift in cloud direction
          drift += cloudBias * vol * 0.12

          // VMC mean-reversion: overbought (→+ob) pushes down, oversold (→-os) pushes up
          const vmcVal = vmcAt(i)
          const meanRevForce = -(vmcVal / obLevel) * vol * 0.6

          // Noise inversely proportional to conviction (high conviction = less chop)
          const noise = (Math.random() - 0.5) * vol * (2.2 - conviction)

          let close = open + drift + meanRevForce + noise

          // Key level magnetism: if close crosses a key level, dampen (price reacts)
          for (const kp of keyPrices) {
            if ((open - kp) * (close - kp) < 0) {        // crossed the level
              const overshoot = close - kp
              close = kp + overshoot * 0.4               // 60% rejection at level
            }
          }

          // Ichimoku cloud edges as dynamic S/R for this future bar
          const cb = cloud[i]
          if (cb) {
            const cloudTop = Math.max(cb.spanA, cb.spanB)
            const cloudBot = Math.min(cb.spanA, cb.spanB)
            // Reject at cloud edges (price tends to bounce off the cloud)
            for (const edge of [cloudTop, cloudBot]) {
              if ((open - edge) * (close - edge) < 0) {
                const overshoot = close - edge
                close = edge + overshoot * 0.45          // 55% rejection at cloud edge
              }
            }
          }

          const wick = vol * (0.4 + Math.random() * 0.5)
          const high = Math.max(open, close) + Math.random() * wick
          const low  = Math.min(open, close) - Math.random() * wick
          prevClose = close
          return { bar: i + 1, open, high, low, close }
        })
      }
      // Pre-compute timestamps from IaTab's own candles (bypasses chart candlesRef race)
      if (parsed.projection.length > 0 && candles.length >= 2) {
        const lastT = candles[n-1].time as number  // unix seconds
        const intervalSec = (candles[n-1].time as number) - (candles[n-2].time as number)
        parsed.projection = parsed.projection.map(b => ({
          ...b,
          time: lastT + b.bar * intervalSec,
        }))
      }
      // Push projection to chart
      if (parsed.projection.length > 0) {
        lwChartRef.current?.setProjection(parsed.projection)
        // Retry after mount in case chart wasn't ready
        setTimeout(() => lwChartRef.current?.setProjection(parsed.projection!), 800)
      }
      setUsedSources({
        chart:      lwChartRef.current?.getAnalysisData() ? 'prop' : 'none',
        mtf:        pdfMtfSnap ? 'prop' : liveMtf ? 'auto' : 'none',
        ouVmc:      (ouSignal.excess !== 'none' || ouSignal.z !== 0) ? 'prop' : liveOU ? 'auto' : 'none',
        baleines:   pressure ? 'prop' : liveWhale ? 'auto' : 'none',
        fng:        fng ? 'prop' : 'none',
        dispersion: dispersionCtx ? 'prop' : liveDisp ? 'auto' : 'none',
      })
      setResult(parsed)
      setLastUpdated(new Date())

      // ── Save to Firestore + trigger backtest evaluation + embedding ─────────
      if (user?.uid && cur) {
        // Capture market conditions for Level 2 pattern extraction
        const condRegime = liveDisp
          ? (liveDisp.includes('TRENDING') ? 'trending' : liveDisp.includes('MEAN') ? 'ranging' : 'random')
          : (dispersionCtx?.regime?.toLowerCase() ?? ouSignal.regime)
        const condRecord = {
          uid: user.uid, symbol, timestamp: Date.now(),
          bias: parsed.bias, score: parsed.score, conviction: parsed.conviction,
          horizon: parsed.horizon, entryPrice: cur.close,
          targets: parsed.targets, trades: parsed.trades ?? [],
          // Level 2 — market conditions
          condRsi: rsi,
          condWhaleScore: pressure?.score ?? (liveWhale ? parseFloat(liveWhale.match(/[-\d.]+/)?.[0] ?? '0') : 0),
          condRegime,
          condVmcStatus: ouSignal.vmcStatus,
          condOuExcess: ouSignal.excess,
          condLiqBias: isCrypto ? liqLong1h - liqShort1h : 0,
          condFng: fng?.value ?? 50,
        }
        saveIaAnalysis(condRecord).then(id => {
          lastSavedId.current = id
          // Level 3 — generate embedding async (non-blocking)
          if (id) {
            const embText = buildEmbeddingText(
              symbol, parsed.bias, rsi, ouSignal.vmcStatus, ouSignal.excess,
              condRecord.condWhaleScore, condRegime, fng?.value ?? 50, condRecord.condLiqBias
            )
            const embedFn = httpsCallable<Record<string,unknown>, { embedding: number[] }>(fbFn, 'generateEmbedding')
            embedFn({ text: embText }).then(res => {
              if (res.data.embedding) {
                updateIaEmbedding(user.uid, id, res.data.embedding, embText).catch(() => {})
              }
            }).catch(() => {}) // non-blocking — embedding failure doesn't break the flow
          }
          // Refresh all history then evaluate open trades
          getIaHistory(user.uid, undefined, 100).then(h => {
            setAllHistory(h)
            evaluatePendingTrades(user.uid)
          }).catch(() => {})
        }).catch(() => {})
      }
    } catch(e: any) {
      setError(e?.message || 'Erreur inconnue')
    }
    setLoading(false)
  }, [symbol, lwChartRef, dispersionCtx, pressure, liqLong1h, liqShort1h, pdfMtfSnap, ouSignal, fng, isCrypto])

  // ── Export PDF ───────────────────────────────────────────────────────────
  const contentRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)

  const exportPDF = useCallback(async () => {
    if (!result || !contentRef.current) return
    setExporting(true)
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ])
      // Force element to render at 800px width so layout reflows to A4-friendly proportions
      const el = contentRef.current
      const prevWidth = el.style.width
      const prevMaxWidth = el.style.maxWidth
      el.style.width = '800px'
      el.style.maxWidth = '800px'
      // Wait one frame for reflow
      await new Promise(r => requestAnimationFrame(r))
      const canvas = await html2canvas(el, {
        backgroundColor: '#0D1123',
        scale: 2,
        useCORS: true,
        logging: false,
      })
      // Restore original width
      el.style.width = prevWidth
      el.style.maxWidth = prevMaxWidth
      // Custom page size = content aspect ratio at 210mm portrait width
      // → 1 page, content fills full width, height = content height, nothing cut
      const margin = 10       // mm
      const pageW = 210       // A4 portrait width mm
      const usableW = pageW - margin * 2
      const imgW = usableW
      const imgH = (canvas.height / canvas.width) * imgW
      const pageH = imgH + margin * 2
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [pageW, pageH] })
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, margin, imgW, imgH)
      pdf.save(`${symbol}-IA-${new Date().toISOString().slice(0,10)}.pdf`)
    } catch(e) { console.error('Export IA PDF', e) }
    setExporting(false)
  }, [result, symbol])

  // ── Render ───────────────────────────────────────────────────────────────
  const bc = result ? (result.bias === 'BULLISH' ? '#30D158' : result.bias === 'BEARISH' ? '#FF453A' : '#8E8E93') : '#BF5AF2'

  return (
    <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16, minHeight: 400 }}>

      {/* ── Header bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 22 }}>🤖</span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--tm-text-primary)', fontFamily: 'Syne,sans-serif', letterSpacing: '0.02em' }}>
                Analyse IA
              </div>
              <div style={{ fontSize: 11, color: 'var(--tm-text-muted)', marginTop: 1 }}>
                Synthèse de tous les indicateurs — chart, oscillateurs, dérivés, dispersion
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Projection bars slider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(59,138,255,0.08)', border: '1px solid rgba(59,138,255,0.2)', borderRadius: 8, padding: '4px 10px' }}>
            <span style={{ fontSize: 10, color: '#3B8AFF', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>📈 {projectionBars} bougies</span>
            <input
              type="range" min={5} max={60} step={5} value={projectionBars}
              onChange={e => setProjectionBars(parseInt(e.target.value))}
              style={{ width: 70, accentColor: '#3B8AFF', cursor: 'pointer' }}
              title="Nombre de bougies de projection"
            />
          </div>
          {lastUpdated && (
            <span style={{ fontSize: 10, color: 'var(--tm-text-muted)' }}>
              Dernière analyse : {lastUpdated.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={loading ? undefined : analyze}
            disabled={loading}
            style={{
              padding: '8px 20px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: loading ? 'wait' : 'pointer',
              border: '1px solid rgba(191,90,242,0.5)', background: 'rgba(191,90,242,0.12)',
              color: '#D98EFF', display: 'flex', alignItems: 'center', gap: 8, letterSpacing: '0.03em',
              transition: 'all 0.2s',
            }}
          >
            {loading
              ? <><span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #BF5AF2', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }}/> Analyse en cours…</>
              : <><span style={{ fontSize: 15 }}>🔍</span> {result ? 'Relancer l\'analyse' : 'Lancer l\'analyse'}</>
            }
          </button>
          {result && (
            <button
              onClick={exporting ? undefined : exportPDF}
              disabled={exporting}
              title="Exporter en PDF"
              style={{
                padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700,
                cursor: exporting ? 'wait' : 'pointer',
                border: '1px solid rgba(52,199,89,0.4)', background: 'rgba(52,199,89,0.08)',
                color: '#30D158', display: 'flex', alignItems: 'center', gap: 6,
                transition: 'all 0.2s',
              }}
            >
              {exporting
                ? <><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #30D158', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }}/> Export…</>
                : <><span style={{ fontSize: 14 }}>📥</span> PDF</>
              }
            </button>
          )}
        </div>
      </div>

      {/* ── Data availability indicators ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          { label: 'Chart',        key: 'chart',      detail: 'Candles + SMC + MSD + VMC + BB',         propOk: !!(lwChartRef.current?.getAnalysisData()?.candles.length) },
          { label: 'MTF',          key: 'mtf',        detail: 'Multi-timeframe RSI/VMC scores',          propOk: !!pdfMtfSnap },
          { label: 'OU / VMC',     key: 'ouVmc',      detail: 'Oscillateur OU + VMC Kaufman',            propOk: ouSignal.excess !== 'none' || ouSignal.z !== 0 },
          { label: 'Baleines',     key: 'baleines',   detail: 'Whale pressure + liquidations',           propOk: isCrypto && !!pressure },
          { label: 'Fear & Greed', key: 'fng',        detail: 'Indice F&G',                              propOk: !!fng },
          { label: 'Dispersion',   key: 'dispersion', detail: 'Market internals institutionnels',        propOk: !!dispersionCtx },
        ].map(({ label, key, detail, propOk }) => {
          const src = usedSources?.[key]
          // post-analysis: use usedSources; pre-analysis: use prop state
          const state: 'prop' | 'auto' | 'none' = src ?? (propOk ? 'prop' : 'none')
          const dotColor  = state === 'prop' ? '#30D158' : state === 'auto' ? '#FF9500' : 'rgba(255,255,255,0.2)'
          const dotGlow   = state === 'prop' ? '0 0 5px #30D15880' : state === 'auto' ? '0 0 5px #FF950080' : 'none'
          const bgColor   = state === 'prop' ? 'rgba(48,209,88,0.08)' : state === 'auto' ? 'rgba(255,149,0,0.08)' : 'rgba(255,255,255,0.03)'
          const bdColor   = state === 'prop' ? 'rgba(48,209,88,0.25)' : state === 'auto' ? 'rgba(255,149,0,0.25)' : 'rgba(255,255,255,0.07)'
          const txtColor  = state === 'prop' ? 'rgba(48,209,88,0.9)' : state === 'auto' ? 'rgba(255,149,0,0.9)' : 'rgba(255,255,255,0.3)'
          const titleFull = state === 'auto' ? `${detail} [auto-fetché au clic]` : detail
          return (
            <div key={label} title={titleFull} style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6,
              background: bgColor, border: `1px solid ${bdColor}`,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, boxShadow: dotGlow }} />
              <span style={{ fontSize: 10, fontWeight: 600, color: txtColor }}>{label}</span>
              {state === 'auto' && <span style={{ fontSize: 8, color: 'rgba(255,149,0,0.6)', fontWeight: 700 }}>AUTO</span>}
            </div>
          )
        })}
      </div>

      {/* ── Error ── */}
      {error && !loading && (
        <div style={{ padding: '10px 14px', background: 'rgba(255,69,58,0.08)', border: '1px solid rgba(255,69,58,0.25)', borderRadius: 8, fontSize: 11, color: '#FF453A', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>⚠ {error}</span>
          <button onClick={analyze} style={{ background: 'rgba(255,149,0,0.1)', border: '1px solid rgba(255,149,0,0.3)', borderRadius: 5, color: '#FF9500', cursor: 'pointer', fontSize: 10, padding: '2px 8px', fontWeight: 600 }}>Réessayer</button>
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {loading && !result && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, padding: '40px 0', color: 'rgba(191,90,242,0.7)' }}>
          <span style={{ width: 32, height: 32, border: '3px solid #BF5AF2', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />
          <div style={{ fontSize: 13, fontWeight: 500 }}>Analyse des données en cours…</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>RSI · VMC · SMC · MTF · Baleines · Dispersion</div>
        </div>
      )}

      {/* ── Results ── */}
      {result && (
        <div ref={contentRef} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* ── Header: Bias + Score + Conviction + Targets ── */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 16, alignItems: 'start',
            padding: '14px 16px', borderRadius: 12,
            background: `linear-gradient(135deg, ${bc}08 0%, rgba(13,17,35,0.8) 100%)`,
            border: `1px solid ${bc}30`,
            boxShadow: `0 0 20px ${bc}10`,
          }}>
            {/* Bias + conviction */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: bc, boxShadow: `0 0 10px ${bc}` }} />
                <span style={{ fontSize: 18, fontWeight: 900, color: bc, fontFamily: 'JetBrains Mono,monospace', letterSpacing: '0.06em' }}>{result.bias}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: bc }}>{result.score}/100</span>
                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: `${bc}18`, border: `1px solid ${bc}35`, color: bc, fontWeight: 700 }}>{result.quality}</span>
              </div>
              <div style={{ fontSize: 11, color: '#FFD60A', letterSpacing: '0.1em' }}>
                {'★'.repeat(Math.min(5, Math.max(1, result.conviction))) + '☆'.repeat(5 - Math.min(5, Math.max(1, result.conviction)))}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'JetBrains Mono,monospace' }}>{result.horizon}</div>
            </div>

            {/* Score bar + catalyst + key levels + momentum */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Score bar */}
              <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${result.score}%`, background: `linear-gradient(90deg, ${bc}80, ${bc})`, transition: 'width 0.8s ease', boxShadow: `0 0 10px ${bc}60` }} />
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.88)', fontWeight: 500, lineHeight: 1.5 }}>
                <span style={{ color: 'rgba(255,255,255,0.3)', marginRight: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' }}>CATALYSEUR</span>
                {result.catalyst}
              </div>
              {result.keyLevels?.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontWeight: 700, letterSpacing: '0.06em' }}>NIVEAUX CLÉS</span>
                  {result.keyLevels.map((l, i) => (
                    <span key={i} style={{ fontSize: 11, fontFamily: 'JetBrains Mono,monospace', fontWeight: 700, color: '#FFD60A', background: 'rgba(255,214,10,0.1)', border: '1px solid rgba(255,214,10,0.25)', padding: '2px 8px', borderRadius: 5 }}>{l}</span>
                  ))}
                </div>
              )}
              {result.momentum && result.momentum !== 'N/A' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontWeight: 700, letterSpacing: '0.06em' }}>MOMENTUM</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: result.momentum === 'BULLISH' ? '#30D158' : result.momentum === 'BEARISH' ? '#FF453A' : '#8E8E93' }}>{result.momentum}</span>
                </div>
              )}
            </div>

            {/* Targets */}
            {(result.targets?.tp1 || result.targets?.sl) && (
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', minWidth: 140, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', marginBottom: 2 }}>OBJECTIFS</div>
                {result.targets.tp1 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
                    <span style={{ fontSize: 10, color: 'rgba(48,209,88,0.6)', fontWeight: 700 }}>TP1</span>
                    <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono,monospace', color: '#30D158', fontWeight: 800 }}>{result.targets.tp1}</span>
                  </div>
                )}
                {result.targets.tp2 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
                    <span style={{ fontSize: 10, color: 'rgba(48,209,88,0.45)', fontWeight: 700 }}>TP2</span>
                    <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono,monospace', color: 'rgba(48,209,88,0.7)', fontWeight: 800 }}>{result.targets.tp2}</span>
                  </div>
                )}
                {result.targets.sl && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, marginTop: 2, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                    <span style={{ fontSize: 10, color: 'rgba(255,69,58,0.7)', fontWeight: 700 }}>SL</span>
                    <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono,monospace', color: '#FF453A', fontWeight: 800 }}>{result.targets.sl}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Regime context (dispersion) ── */}
          {result.regimeContext && result.regimeContext !== 'N/A' && (
            <div style={{ padding: '10px 14px', background: 'rgba(191,90,242,0.06)', border: '1px solid rgba(191,90,242,0.2)', borderRadius: 10, lineHeight: 1.6 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(191,90,242,0.5)', letterSpacing: '0.08em', marginBottom: 4 }}>CONTEXTE MARCHÉ · DISPERSION</div>
              <div style={{ fontSize: 12, color: 'rgba(191,90,242,0.85)' }}>{result.regimeContext}</div>
            </div>
          )}

          {/* ── 2-column: MTF + Whale ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {result.mtfAnalysis && (
              <div style={{ padding: '10px 14px', background: 'rgba(0,213,255,0.04)', border: '1px solid rgba(0,213,255,0.15)', borderRadius: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,213,255,0.5)', letterSpacing: '0.08em', marginBottom: 6 }}>MULTI-TIMEFRAME</div>
                <div style={{ fontSize: 11, color: 'rgba(0,213,255,0.8)', lineHeight: 1.6 }}>{result.mtfAnalysis}</div>
              </div>
            )}
            {result.whaleAnalysis && isCrypto && (
              <div style={{ padding: '10px 14px', background: 'rgba(255,214,10,0.04)', border: '1px solid rgba(255,214,10,0.15)', borderRadius: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,214,10,0.5)', letterSpacing: '0.08em', marginBottom: 6 }}>BALEINES · LIQUIDATIONS</div>
                <div style={{ fontSize: 11, color: 'rgba(255,214,10,0.8)', lineHeight: 1.6 }}>{result.whaleAnalysis}</div>
              </div>
            )}
          </div>

          {/* ── Main summary ── */}
          <div style={{ padding: '12px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em', marginBottom: 8 }}>ANALYSE DÉTAILLÉE</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.82)', lineHeight: 1.7 }}>{result.summary}</div>
          </div>

          {/* ── Scenarios ── */}
          {(result.scenarios?.bull || result.scenarios?.bear) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {result.scenarios.bull && (
                <div style={{ padding: '10px 14px', background: 'rgba(48,209,88,0.05)', border: '1px solid rgba(48,209,88,0.2)', borderRadius: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(48,209,88,0.5)', letterSpacing: '0.08em', marginBottom: 6 }}>📈 SCÉNARIO HAUSSIER</div>
                  <div style={{ fontSize: 11, color: 'rgba(48,209,88,0.85)', lineHeight: 1.6 }}>{result.scenarios.bull}</div>
                </div>
              )}
              {result.scenarios.bear && (
                <div style={{ padding: '10px 14px', background: 'rgba(255,69,58,0.05)', border: '1px solid rgba(255,69,58,0.2)', borderRadius: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,69,58,0.5)', letterSpacing: '0.08em', marginBottom: 6 }}>📉 SCÉNARIO BAISSIER</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,69,58,0.85)', lineHeight: 1.6 }}>{result.scenarios.bear}</div>
                </div>
              )}
            </div>
          )}

          {/* ── Trade setups ── */}
          {result.trades && result.trades.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em', marginBottom: 8 }}>SETUPS PROPOSÉS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {result.trades.map((t, i) => {
                  const isLong = t.direction === 'LONG'
                  const clr = isLong ? '#34C759' : '#FF3B30'
                  const probColor = (t.probability ?? 0) >= 60 ? '#34C759' : (t.probability ?? 0) >= 40 ? '#FF9500' : '#FF3B30'
                  return (
                    <div key={i} style={{ padding: '10px 14px', background: `${clr}06`, border: `1px solid ${clr}25`, borderRadius: 10, display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '8px 16px', alignItems: 'start' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: clr, fontFamily: 'JetBrains Mono,monospace' }}>{t.direction}</span>
                        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>{t.horizon}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>{t.label}</span>
                        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{t.rationale}</span>
                        <div style={{ display: 'flex', gap: 10, marginTop: 2, fontFamily: 'JetBrains Mono,monospace', fontSize: 10 }}>
                          <span style={{ color: 'rgba(255,255,255,0.4)' }}>Entry <span style={{ color: 'rgba(255,255,255,0.8)' }}>{t.entry}</span></span>
                          <span style={{ color: '#34C759' }}>TP1 {t.tp1}</span>
                          <span style={{ color: '#34C759' }}>TP2 {t.tp2}</span>
                          <span style={{ color: '#FF3B30' }}>SL {t.sl}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: '#FF9500', fontFamily: 'JetBrains Mono,monospace' }}>R:{t.rr}</span>
                        <span style={{ fontSize: 10, color: probColor, fontWeight: 700 }}>{t.probability}%</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Risk + Divergence pills ── */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {result.divergence && result.divergence !== 'N/A' && (
              <span style={{ fontSize: 11, color: 'rgba(0,213,255,0.8)', background: 'rgba(0,213,255,0.07)', border: '1px solid rgba(0,213,255,0.18)', borderRadius: 6, padding: '4px 12px' }}>
                🔀 {result.divergence}
              </span>
            )}
            {result.risk && (
              <span style={{ fontSize: 11, color: 'rgba(255,149,0,0.9)', background: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.22)', borderRadius: 6, padding: '4px 12px' }}>
                ⚠ {result.risk}
              </span>
            )}
          </div>

        </div>
      )}

      {/* ── Backtest IA — Personal + Global ── */}
      {(() => {
        const activeRecords  = historyTab === 'personal' ? history : globalFiltered
        const closed  = activeRecords.filter(r => r.outcome !== 'open' && r.outcome !== 'expired')
        const wins    = closed.filter(r => r.outcome === 'tp1_hit' || r.outcome === 'tp2_hit')
        const losses  = closed.filter(r => r.outcome === 'sl_hit')
        const openR   = activeRecords.filter(r => r.outcome === 'open')
        const winRate = closed.length ? wins.length / closed.length : 0
        const avgR    = closed.length ? closed.reduce((s,r) => s + (r.outcomeR ?? 0), 0) / closed.length : 0
        const totalR  = closed.reduce((s,r) => s + (r.outcomeR ?? 0), 0)
        const allSymbols = [...new Set(activeRecords.map(r => r.symbol))]
        return (
          <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden' }}>
            {/* Header */}
            <button onClick={() => setShowHistory(h => !h)} style={{
              width: '100%', background: 'rgba(255,255,255,0.03)', border: 'none',
              padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.6)' }}>📊 Backtest IA</span>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5, background: 'rgba(255,255,255,0.05)',
                color: winRate >= 0.5 ? '#34C759' : winRate > 0 ? '#FF9500' : '#8E8E93' }}>
                {closed.length > 0 ? `${Math.round(winRate*100)}% win` : '—'}
              </span>
              {closed.length > 0 && <>
                <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono,monospace', color: avgR >= 0 ? '#34C759' : '#FF3B30' }}>avg {avgR.toFixed(2)}R</span>
                <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono,monospace', color: totalR >= 0 ? '#34C759' : '#FF3B30' }}>Σ{totalR.toFixed(1)}R</span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{wins.length}W·{losses.length}L·{openR.length}⏳</span>
              </>}
              <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>{activeRecords.length} analyses {showHistory ? '▲' : '▼'}</span>
            </button>

            {showHistory && (
              <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* Personal / Global tabs */}
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['personal', 'global'] as const).map(t => (
                    <button key={t} onClick={() => setHistoryTab(t)} style={{
                      background: historyTab === t ? 'rgba(191,90,242,0.15)' : 'none',
                      border: `1px solid ${historyTab === t ? '#BF5AF2' : 'rgba(255,255,255,0.1)'}`,
                      borderRadius: 6, color: historyTab === t ? '#BF5AF2' : 'rgba(255,255,255,0.4)',
                      fontSize: 10, fontWeight: 700, cursor: 'pointer', padding: '3px 10px',
                    }}>
                      {t === 'personal' ? `👤 Mes analyses (${allHistory.length})` : `🌍 Global (${globalHistory.length})`}
                    </button>
                  ))}
                </div>

                {/* Symbol filter */}
                {allSymbols.length > 1 && (
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {(['all', ...allSymbols] as string[]).map(s => (
                      <button key={s} onClick={() => setHistoryFilter(s)} style={{
                        background: historyFilter === s ? 'rgba(0,213,255,0.1)' : 'none',
                        border: `1px solid ${historyFilter === s ? '#00D5FF' : 'rgba(255,255,255,0.08)'}`,
                        borderRadius: 5, color: historyFilter === s ? '#00D5FF' : 'rgba(255,255,255,0.35)',
                        fontSize: 9, fontWeight: 600, cursor: 'pointer', padding: '2px 7px',
                      }}>{s === 'all' ? 'Tous' : s}</button>
                    ))}
                  </div>
                )}

                {/* Per-symbol stats strip */}
                {historyFilter === 'all' && allSymbols.length > 1 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {allSymbols.map(sym => {
                      const sc = activeRecords.filter(r => r.symbol === sym && r.outcome !== 'open' && r.outcome !== 'expired')
                      const sw = sc.filter(r => r.outcome === 'tp1_hit' || r.outcome === 'tp2_hit')
                      const sr = sc.length ? sc.reduce((s,r) => s + (r.outcomeR ?? 0), 0) / sc.length : 0
                      return sc.length > 0 ? (
                        <div key={sym} style={{ fontSize: 9, padding: '2px 8px', borderRadius: 5,
                          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
                          fontFamily: 'JetBrains Mono,monospace', color: 'rgba(255,255,255,0.45)' }}>
                          <b style={{ color: 'rgba(255,255,255,0.75)' }}>{sym}</b>
                          {' '}{Math.round(sw.length/sc.length*100)}% · {sr.toFixed(2)}R
                        </div>
                      ) : null
                    })}
                  </div>
                )}

                {/* Rows */}
                {activeRecords.length === 0
                  ? <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', padding: '10px 0', textAlign: 'center' }}>
                      {historyTab === 'personal' ? 'Lance une analyse pour commencer' : 'Aucune donnée globale encore'}
                    </div>
                  : activeRecords.map(rec => {
                    const oc = rec.outcome ?? 'open'
                    const ocColor = oc === 'tp1_hit' || oc === 'tp2_hit' ? '#34C759' : oc === 'sl_hit' ? '#FF3B30' : oc === 'expired' ? '#8E8E93' : '#FF9500'
                    const ocLabel = oc === 'tp1_hit' ? 'TP1 ✅' : oc === 'tp2_hit' ? 'TP2 ✅' : oc === 'sl_hit' ? 'SL ❌' : oc === 'expired' ? 'Exp.' : '⏳'
                    const bc = rec.bias === 'BULLISH' ? '#34C759' : rec.bias === 'BEARISH' ? '#FF3B30' : '#8E8E93'
                    return (
                      <div key={rec.id} style={{
                        display: 'grid', gridTemplateColumns: '78px 65px 46px 1fr 50px 38px',
                        gap: 5, alignItems: 'center', padding: '5px 8px',
                        background: 'rgba(255,255,255,0.02)', borderRadius: 6,
                        fontSize: 10, fontFamily: 'JetBrains Mono,monospace', borderLeft: `2px solid ${bc}40`,
                      }}>
                        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9 }}>
                          {new Date(rec.timestamp).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'})} {new Date(rec.timestamp).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}
                        </span>
                        <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{rec.symbol}</span>
                        <span style={{ color: bc, fontWeight: 700 }}>{rec.bias.slice(0,4)}</span>
                        <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9 }}>
                          {rec.entryPrice.toFixed(0)} → TP {rec.targets?.tp1} SL {rec.targets?.sl}
                        </span>
                        <span style={{ color: ocColor, fontWeight: 700 }}>{ocLabel}</span>
                        <span style={{ color: rec.outcomeR != null && rec.outcomeR > 0 ? '#34C759' : '#FF3B30', fontWeight: 700 }}>
                          {rec.outcomeR != null ? `${rec.outcomeR.toFixed(2)}R` : ''}
                        </span>
                      </div>
                    )
                  })
                }
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Empty state ── */}
      {!result && !loading && !error && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '48px 0', color: 'rgba(255,255,255,0.25)' }}>
          <span style={{ fontSize: 48 }}>🤖</span>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Prêt à analyser</div>
            <div style={{ fontSize: 12 }}>Clique sur "Lancer l'analyse" pour synthétiser tous les indicateurs</div>
            <div style={{ fontSize: 11, marginTop: 4, color: 'rgba(255,255,255,0.18)' }}>
              RSI · VMC · SMC · MSD · Bollinger · MTF · OU · Baleines · Liquidations · Fear&Greed · Dispersion
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
