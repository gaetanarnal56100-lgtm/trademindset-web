// IaTab — Onglet Analyse IA complète
// Synthèse de TOUS les indicateurs disponibles (chart + oscillateurs + dérivés + dispersion)
import React, { useState, useCallback, useRef } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'
import type { LightweightChartHandle } from './LightweightChart'
import type { MTFSnapshot } from './MTFDashboard'

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

interface AiResult {
  bias: string; score: number; conviction: number; horizon: string; quality: string
  keyLevels: string[]
  catalyst: string
  targets: { tp1: string; tp2: string; sl: string }
  momentum: string; regimeContext: string; summary: string; risk: string; divergence: string
  mtfAnalysis: string
  whaleAnalysis: string
  scenarios: { bull: string; bear: string }
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
  const [result, setResult] = useState<AiResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const analyze = useCallback(async () => {
    setLoading(true); setError(null)
    try {
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
      let mtfSection = 'Not available (load page Analyse first)'
      if (pdfMtfSnap) {
        const snap = pdfMtfSnap
        mtfSection = `Global score: ${snap.globalScore}/100 | Signal: ${snap.globalSignal} | Confluence: ${snap.confluence}%
  RSI overall: ${snap.globalRSI?.toFixed(1) ?? 'N/A'} | VMC overall: ${snap.globalVMC?.toFixed(1) ?? 'N/A'}
  ${snap.isTurningUp ? '↑ Market turning UP' : snap.isTurningDown ? '↓ Market turning DOWN' : '→ Market stable'}
  Per-timeframe: ${snap.readings?.slice(0,6).map(r=>`${r.tf}:${r.signal}`).join(' | ') ?? 'N/A'}`
      }

      // ── 5. OU oscillator ─────────────────────────────────────────────────
      const ouSection = `Excess: ${ouSignal.excess} | Regime: ${ouSignal.regime} | Z-score: ${ouSignal.z.toFixed(2)}σ | VMC(OU): ${ouSignal.vmcStatus} | Confluence signal: ${ouSignal.confluenceSignal}`

      // ── 6. Whale & liquidations (crypto only) ───────────────────────────
      let whaleSection = 'N/A (non-crypto asset)'
      if (isCrypto) {
        const wp = pressure?.score ?? 0
        const liqBias = liqLong1h - liqShort1h
        whaleSection = `Whale pressure score: ${(wp*100).toFixed(0)}% (${wp > 0.3 ? 'ACCUMULATION' : wp < -0.3 ? 'DISTRIBUTION' : 'NEUTRAL'})
  Buy volume: $${((pressure?.buyVol ?? 0)/1e6).toFixed(1)}M | Sell volume: $${((pressure?.sellVol ?? 0)/1e6).toFixed(1)}M
  1h Liquidations: Long $${(liqLong1h/1e6).toFixed(1)}M | Short $${(liqShort1h/1e6).toFixed(1)}M
  Liq bias: ${Math.abs(liqBias) < 0.1e6 ? 'NEUTRAL' : liqBias > 0 ? `BEARISH (more longs liquidated $${(Math.abs(liqBias)/1e6).toFixed(1)}M more)` : `BULLISH (more shorts liquidated $${(Math.abs(liqBias)/1e6).toFixed(1)}M more)`}`
      }

      // ── 7. Fear & Greed ──────────────────────────────────────────────────
      const fngSection = fng ? `Value: ${fng.value}/100 (${fng.label}) | 7-day trend: ${fng.history.slice(-7).join('→')}` : 'N/A'

      // ── 8. Dispersion engine ─────────────────────────────────────────────
      const d = dispersionCtx
      const dispSection = d ? `Regime: ${d.regime} (conf ${d.regimeConfidence}%) | Overall: ${d.overallBias} ${d.overallScore}/100 | RiskOn: ${d.riskOnScore}/100
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
      const systemPrompt = `You are an elite institutional trading analyst with deep expertise in quantitative analysis, Smart Money Concepts (SMC), market microstructure, and dispersion trading. Your role is to synthesize ALL available market data into a comprehensive, actionable trading analysis. Be specific with price levels, cite the data you are basing each conclusion on, and provide clear reasoning. Respond ONLY with valid JSON, no markdown, no extra text.`

      const userPrompt = `=== ASSET ===
Symbol: ${symbol} | Timeframe: ${tf} | Price: ${cur?.close.toFixed(2) ?? '?'} (${chg}%) | ATR(14): ${atr.toFixed(2)} (${cur ? ((atr/cur.close)*100).toFixed(2) : '?'}%)
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

Based on ALL the above data, provide a complete trading analysis. Respond with EXACTLY this JSON:
{"bias":"BULLISH","score":74,"conviction":4,"horizon":"4-12h","quality":"High","keyLevels":["65800","66200","67800","68500"],"catalyst":"Bull OB reclaim at 66200 with whale accumulation + hidden strength signal","targets":{"tp1":"67800","tp2":"68500","sl":"65500"},"momentum":"BULLISH","regimeContext":"Dispersion expansion regime: stock-picking environment; breadth improving confirms move","summary":"3-4 sentences integrating price structure + MTF + dispersion + whale data with specific data references.","risk":"Bear OB resistance 67800, declining volume on bounce, RSI approaching 65","divergence":"CVD bullish divergence on 1h; breadth histogram turning up","mtfAnalysis":"Brief MTF alignment analysis with specific TF signals.","whaleAnalysis":"Brief whale/liq analysis with specific numbers.","scenarios":{"bull":"Specific bullish scenario with price targets and trigger.","bear":"Specific bearish scenario with invalidation level."}}`

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
      setResult(parsed)
      setLastUpdated(new Date())
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
      const canvas = await html2canvas(contentRef.current, {
        backgroundColor: '#0D1123',
        scale: 2,
        useCORS: true,
        logging: false,
      })
      const imgW = canvas.width / 2
      const imgH = canvas.height / 2
      const pdf = new jsPDF({ orientation: imgW > imgH ? 'landscape' : 'portrait', unit: 'px', format: [imgW, imgH] })
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, imgW, imgH)
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
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[
          { label: 'Chart', ok: !!(lwChartRef.current?.getAnalysisData()?.candles.length), detail: 'Candles + SMC + MSD + VMC + BB' },
          { label: 'MTF', ok: !!pdfMtfSnap, detail: 'Multi-timeframe RSI/VMC scores' },
          { label: 'OU / VMC', ok: ouSignal.excess !== 'none' || ouSignal.z !== 0, detail: 'Oscillateur OU + VMC Kaufman' },
          { label: 'Baleines', ok: isCrypto && !!pressure, detail: 'Whale pressure + liquidations' },
          { label: 'Fear & Greed', ok: !!fng, detail: 'Indice F&G' },
          { label: 'Dispersion', ok: !!dispersionCtx, detail: 'Market internals institutionnels' },
        ].map(({ label, ok, detail }) => (
          <div key={label} title={detail} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6,
            background: ok ? 'rgba(48,209,88,0.08)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${ok ? 'rgba(48,209,88,0.25)' : 'rgba(255,255,255,0.07)'}`,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: ok ? '#30D158' : 'rgba(255,255,255,0.2)', boxShadow: ok ? '0 0 5px #30D15880' : 'none' }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: ok ? 'rgba(48,209,88,0.9)' : 'rgba(255,255,255,0.3)' }}>{label}</span>
          </div>
        ))}
        {!dispersionCtx && (
          <div style={{ fontSize: 10, color: 'rgba(255,149,0,0.7)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>⚠</span> Visite l'onglet Dispersion pour charger les internals
          </div>
        )}
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
