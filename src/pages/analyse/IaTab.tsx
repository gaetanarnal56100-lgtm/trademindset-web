// IaTab — Onglet Analyse IA complète
// Synthèse de TOUS les indicateurs disponibles (chart + oscillateurs + dérivés + dispersion)
import React, { useState, useCallback, useRef, useEffect } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'
import type { LightweightChartHandle } from './LightweightChart'
import type { MTFSnapshot } from './MTFDashboard'
import { fetchAndCompute } from '@/services/dispersion/dispersionEngine'
import { CRYPTO_BASKET } from '@/services/dispersion/types'
import { saveIaAnalysis, getIaHistory, updateIaOutcome } from '@/services/firestore/iaHistory'
import type { IaAnalysisRecord } from '@/services/firestore/iaHistory'
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

// ── Main component ───────────────────────────────────────────────────────────
export default function IaTab({ symbol, isCrypto, lwChartRef, dispersionCtx, pressure, liqLong1h, liqShort1h, pdfMtfSnap, ouSignal, fng }: Props) {
  const user = useUser()
  const [result, setResult] = useState<AiResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [usedSources, setUsedSources] = useState<Record<string, 'prop' | 'auto' | 'none'> | null>(null)
  const [allHistory, setAllHistory] = useState<IaAnalysisRecord[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [historyFilter, setHistoryFilter] = useState<'all' | string>('all')
  const lastSavedId = useRef<string | null>(null)

  // Derived: filtered history for display
  const history = historyFilter === 'all' ? allHistory : allHistory.filter(r => r.symbol === historyFilter)

  // Load ALL history on mount (no symbol filter — no composite index needed)
  useEffect(() => {
    if (!user?.uid) return
    getIaHistory(user.uid, undefined, 100).then(setAllHistory).catch(() => {})
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
        }
      } catch { /* skip */ }
    }
    // Refresh after evaluation
    getIaHistory(uid, undefined, 100).then(setAllHistory).catch(() => {})
  }, [history, symbol])

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
      const systemPrompt = `You are an elite institutional trading analyst. Synthesize ALL provided market data into actionable trading analysis. Rules:
1. ALL price levels (keyLevels, targets, trades) MUST be derived from the actual data provided — never invent levels unrelated to the data.
2. Current price is explicitly stated. For BULLISH setups: tp1 > tp2 > entry_price > sl. For BEARISH setups: tp1 < tp2 < entry_price < sl. NEVER put tp below entry for a BULLISH trade.
3. Provide 2-3 distinct trade setups in "trades" array covering different timeframes or scenarios.
4. keyLevels must be real S/R levels from SMC/MSD data or 50-bar range extremes.
5. Respond ONLY with valid JSON, no markdown, no extra text.`

      const userPrompt = `=== ASSET ===
Symbol: ${symbol} | Timeframe: ${tf} | CURRENT PRICE: ${curPrice.toFixed(2)} (${chg}%) | ATR(14): ${atr.toFixed(2)} (${cur ? ((atr/cur.close)*100).toFixed(2) : '?'}%)
50-bar range: High=${high50.toFixed(2)} Low=${low50.toFixed(2)} | Price at ${cur && high50 !== low50 ? (((cur.close-low50)/(high50-low50))*100).toFixed(0) : '?'}% of range
Closes (last 50): ${closes50}
Volume: ${volTrend}

=== PRICE INDICATORS ===
RSI(14): ${rsi} | VMC status: ${vmcStatus}
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

Current price is ${curPrice.toFixed(2)}. All TP/SL levels must be consistent with this price and with the bias direction.

Respond with EXACTLY this JSON (no example values — compute everything from the data above):
{"bias":"BULLISH|BEARISH|NEUTRAL","score":0,"conviction":0,"horizon":"Xh-Yh","quality":"Low|Medium|High","keyLevels":["LEVEL1","LEVEL2","LEVEL3","LEVEL4"],"catalyst":"specific catalyst from data","targets":{"tp1":"PRICE","tp2":"PRICE","sl":"PRICE"},"momentum":"BULLISH|BEARISH|NEUTRAL","regimeContext":"dispersion regime context","summary":"3-4 sentences with specific data references","risk":"specific risk factors","divergence":"divergence observations","mtfAnalysis":"MTF alignment with specific TF signals","whaleAnalysis":"whale/liq analysis with numbers","scenarios":{"bull":"bullish scenario with trigger and target","bear":"bearish scenario with invalidation"},"trades":[{"label":"Primary setup label","direction":"LONG|SHORT","entry":"PRICE","tp1":"PRICE","tp2":"PRICE","sl":"PRICE","rr":"X.X","probability":0,"horizon":"Xh","rationale":"1 sentence"},{"label":"Alternative setup","direction":"LONG|SHORT","entry":"PRICE","tp1":"PRICE","tp2":"PRICE","sl":"PRICE","rr":"X.X","probability":0,"horizon":"Xh","rationale":"1 sentence"}]}`

      const fn = httpsCallable<Record<string,unknown>, {choices?: {message:{content:string}}[]}>(fbFn, 'openaiChat')
      const res = await fn({ messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], model: 'gpt-4o-mini', max_tokens: 1200 })
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

      // ── Save to Firestore + trigger backtest evaluation ───────────────────
      if (user?.uid && cur) {
        const record = {
          uid: user.uid, symbol, timestamp: Date.now(),
          bias: parsed.bias, score: parsed.score, conviction: parsed.conviction,
          horizon: parsed.horizon, entryPrice: cur.close,
          targets: parsed.targets, trades: parsed.trades ?? [],
        }
        saveIaAnalysis(record).then(id => {
          lastSavedId.current = id
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

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
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

      {/* ── Backtest IA — Global Stats + History ── */}
      {(() => {
        const closed = allHistory.filter(r => r.outcome !== 'open' && r.outcome !== 'expired')
        const wins   = closed.filter(r => r.outcome === 'tp1_hit' || r.outcome === 'tp2_hit')
        const losses = closed.filter(r => r.outcome === 'sl_hit')
        const open   = allHistory.filter(r => r.outcome === 'open')
        const winRate = closed.length ? wins.length / closed.length : 0
        const avgR    = closed.length ? closed.reduce((s,r) => s + (r.outcomeR ?? 0), 0) / closed.length : 0
        const totalR  = closed.reduce((s,r) => s + (r.outcomeR ?? 0), 0)
        // Symbols in history
        const symbols = [...new Set(allHistory.map(r => r.symbol))]
        return (
          <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden' }}>
            {/* Header + toggle */}
            <button onClick={() => setShowHistory(h => !h)} style={{
              width: '100%', background: 'rgba(255,255,255,0.03)', border: 'none',
              padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.6)' }}>📊 Backtest IA</span>
              {/* Global stats pills */}
              <span style={{ fontSize: 10, fontWeight: 700, color: winRate >= 0.5 ? '#34C759' : winRate > 0 ? '#FF9500' : '#8E8E93',
                background: 'rgba(255,255,255,0.05)', borderRadius: 5, padding: '2px 8px' }}>
                {closed.length > 0 ? `${Math.round(winRate*100)}% win` : 'Pas encore de résultats'}
              </span>
              {closed.length > 0 && <>
                <span style={{ fontSize: 10, color: avgR >= 0 ? '#34C759' : '#FF3B30', fontFamily: 'JetBrains Mono,monospace' }}>avg {avgR.toFixed(2)}R</span>
                <span style={{ fontSize: 10, color: totalR >= 0 ? '#34C759' : '#FF3B30', fontFamily: 'JetBrains Mono,monospace' }}>total {totalR.toFixed(1)}R</span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{wins.length}W · {losses.length}L · {open.length} open</span>
              </>}
              <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>{allHistory.length} analyses {showHistory ? '▲' : '▼'}</span>
            </button>

            {showHistory && (
              <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* Symbol filter */}
                {symbols.length > 1 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                    {(['all', ...symbols] as string[]).map(s => (
                      <button key={s} onClick={() => setHistoryFilter(s)} style={{
                        background: historyFilter === s ? 'rgba(191,90,242,0.15)' : 'none',
                        border: `1px solid ${historyFilter === s ? '#BF5AF2' : 'rgba(255,255,255,0.1)'}`,
                        borderRadius: 5, color: historyFilter === s ? '#BF5AF2' : 'rgba(255,255,255,0.4)',
                        fontSize: 10, fontWeight: 600, cursor: 'pointer', padding: '2px 8px',
                      }}>{s === 'all' ? 'Tous' : s}</button>
                    ))}
                  </div>
                )}

                {/* Stats by symbol if showing all */}
                {historyFilter === 'all' && symbols.length > 1 && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    {symbols.map(sym => {
                      const symClosed = allHistory.filter(r => r.symbol === sym && r.outcome !== 'open' && r.outcome !== 'expired')
                      const symWins   = symClosed.filter(r => r.outcome === 'tp1_hit' || r.outcome === 'tp2_hit')
                      const symR      = symClosed.length ? symClosed.reduce((s,r) => s + (r.outcomeR ?? 0), 0) / symClosed.length : 0
                      return symClosed.length > 0 ? (
                        <div key={sym} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6,
                          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
                          fontFamily: 'JetBrains Mono,monospace', color: 'rgba(255,255,255,0.5)' }}>
                          <span style={{ color: 'rgba(255,255,255,0.8)', fontWeight: 700 }}>{sym}</span>
                          {' '}{Math.round(symWins.length/symClosed.length*100)}% · {symR.toFixed(2)}R
                        </div>
                      ) : null
                    })}
                  </div>
                )}

                {/* Trade rows */}
                {history.length === 0
                  ? <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', padding: '8px 0', textAlign: 'center' }}>
                      Lance une analyse pour commencer à construire l'historique
                    </div>
                  : history.map(rec => {
                    const oc = rec.outcome ?? 'open'
                    const ocColor = oc === 'tp1_hit' || oc === 'tp2_hit' ? '#34C759' : oc === 'sl_hit' ? '#FF3B30' : oc === 'expired' ? '#8E8E93' : '#FF9500'
                    const ocLabel = oc === 'tp1_hit' ? 'TP1 ✅' : oc === 'tp2_hit' ? 'TP2 ✅' : oc === 'sl_hit' ? 'SL ❌' : oc === 'expired' ? 'Expiré' : '⏳'
                    const bc = rec.bias === 'BULLISH' ? '#34C759' : rec.bias === 'BEARISH' ? '#FF3B30' : '#8E8E93'
                    return (
                      <div key={rec.id} style={{
                        display: 'grid', gridTemplateColumns: '90px 70px 50px 1fr 55px 40px',
                        gap: 6, alignItems: 'center', padding: '5px 8px',
                        background: 'rgba(255,255,255,0.02)', borderRadius: 6,
                        fontSize: 10, fontFamily: 'JetBrains Mono,monospace', borderLeft: `2px solid ${bc}40`,
                      }}>
                        <span style={{ color: 'rgba(255,255,255,0.35)' }}>
                          {new Date(rec.timestamp).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'})} {new Date(rec.timestamp).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}
                        </span>
                        <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{rec.symbol}</span>
                        <span style={{ color: bc, fontWeight: 700 }}>{rec.bias.slice(0,4)}</span>
                        <span style={{ color: 'rgba(255,255,255,0.4)' }}>
                          {rec.entryPrice.toFixed(0)} → TP {rec.targets.tp1} · SL {rec.targets.sl}
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
