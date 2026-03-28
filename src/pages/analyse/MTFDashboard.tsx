// MTFDashboard.tsx
// Miroir exact de MTFDashboardView.swift + MTFCombiner.swift + VMCCalculator.swift + RSICalculator.swift
// Timeframes : 3M, 1M, 1S, 1J, 12H, 4H, 2H, 1H, 30m, 15m, 5m
// Score combiné = RSI×40% + VMC×60%

import { useState, useEffect, useCallback } from 'react'
import { signalService } from '@/services/notifications/SignalNotificationService'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'

const fbFn = getFunctions(app, 'europe-west1')

function isCrypto(symbol: string) { return /USDT$|BUSD$|BTC$|ETH$|BNB$/i.test(symbol) }

const TF_TO_TWELVEDATA: Record<string, string> = {
  '1m':'1min','5m':'5min','15m':'15min','30m':'30min','1h':'1h','2h':'2h',
  '4h':'4h','12h':'12h','1d':'1day','1w':'1week','1M':'1month',
}

async function fetchTF(symbol: string, interval: string, limit: number) {
  const sym = symbol.toUpperCase()

  if (isCrypto(sym)) {
    // Futures first
    try {
      const r = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${interval}&limit=${limit}`)
      if (r.ok) {
        const d = await r.json() as unknown[][]
        if (Array.isArray(d) && d.length > 10)
          return d.map(a => ({ o:parseFloat(a[1] as string), h:parseFloat(a[2] as string), l:parseFloat(a[3] as string), c:parseFloat(a[4] as string) }))
      }
    } catch {/**/}
    // Spot fallback
    try {
      const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${limit}`)
      if (r.ok) {
        const d = await r.json() as unknown[][]
        if (Array.isArray(d) && d.length > 10)
          return d.map(a => ({ o:parseFloat(a[1] as string), h:parseFloat(a[2] as string), l:parseFloat(a[3] as string), c:parseFloat(a[4] as string) }))
      }
    } catch {/**/}
    throw new Error(`${sym} introuvable`)
  }

  // Non-crypto → TwelveData (essaie plusieurs variantes) puis Finnhub fallback
  const tdInterval = TF_TO_TWELVEDATA[interval] || '1h'
  
  for (const variant of [sym, `${sym}:NYSE`, `${sym}:NASDAQ`, `${sym}:BATS`]) {
    try {
      const fn = httpsCallable<Record<string,unknown>, {values?:{open:string;high:string;low:string;close:string}[]}>(fbFn, 'fetchTimeSeries')
      const res = await fn({ symbol: variant, interval: tdInterval, outputSize: limit })
      const values = res.data.values || []
      if (values.length > 5)
        return values.map(v => ({ o:parseFloat(v.open), h:parseFloat(v.high), l:parseFloat(v.low), c:parseFloat(v.close) }))
    } catch {/*try next*/}
  }
  
  // Finnhub fallback
  try {
    const now = Math.floor(Date.now()/1000)
    const secsMap: Record<string,number> = {'5min':300,'15min':900,'30min':1800,'1h':3600,'2h':7200,'4h':14400,'12h':43200,'1day':86400,'1week':604800}
    const resMap: Record<string,string> = {'5min':'5','15min':'15','30min':'30','1h':'60','2h':'120','4h':'D','12h':'D','1day':'D','1week':'W'}
    const from = now - (secsMap[tdInterval]||3600)*limit
    const fn2 = httpsCallable<Record<string,unknown>, {c?:number[];h?:number[];l?:number[];o?:number[];s?:string}>(fbFn, 'fetchStockCandles')
    const res2 = await fn2({ symbol: sym, resolution: resMap[tdInterval]||'60', from, to: now })
    if (res2.data.s === 'ok' && res2.data.c && res2.data.c.length > 5)
      return res2.data.c.map((_,i) => ({ o:res2.data.o![i], h:res2.data.h![i], l:res2.data.l![i], c:res2.data.c![i] }))
  } catch {/**/}
  
  throw new Error(`${sym} non trouvé`)
}

// ── Live refresh: toutes les 2 minutes (candles MTF lentes) ─────────────────
const MTF_REFRESH_MS = 2 * 60 * 1000

// ── Types ──────────────────────────────────────────────────────────────────

type Signal = 'BUY' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'SELL'

interface MTFReading {
  tf: string
  label: string
  rsi: number
  rsiNorm: number
  vmc: number
  score: number
  signal: Signal
  divergence: boolean
}

interface MTFSnapshot {
  readings: MTFReading[]
  globalRSI: number
  globalVMC: number
  globalScore: number
  globalSignal: Signal
  confluence: number        // % de TFs alignés
  isTurningUp: boolean
  isTurningDown: boolean
}

// ── Timeframes ─────────────────────────────────────────────────────────────

const TIMEFRAMES = [
  { tf: '1M',  interval: '1M',  limit: 200, label: '1M',  minutes: 43200*30 },
  { tf: '1S',  interval: '1w',  limit: 200, label: '1S',  minutes: 43200*7  },
  { tf: '1J',  interval: '1d',  limit: 200, label: '1J',  minutes: 1440     },
  { tf: '12H', interval: '12h', limit: 200, label: '12H', minutes: 720      },
  { tf: '4H',  interval: '4h',  limit: 200, label: '4H',  minutes: 240      },
  { tf: '2H',  interval: '2h',  limit: 150, label: '2H',  minutes: 120      },
  { tf: '1H',  interval: '1h',  limit: 150, label: '1H',  minutes: 60       },
  { tf: '30m', interval: '30m', limit: 100, label: '30m', minutes: 30       },
  { tf: '15m', interval: '15m', limit: 100, label: '15m', minutes: 15       },
  { tf: '5m',  interval: '5m',  limit: 80,  label: '5m',  minutes: 5        },
]

// ── Algorithms (miroir exact Swift) ───────────────────────────────────────

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 2) return 50
  let gains = 0, losses = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i-1]
    if (d > 0) gains += d; else losses -= d
  }
  let avgGain = gains / period, avgLoss = losses / period
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i-1]
    avgGain = (avgGain * (period-1) + Math.max(d, 0)) / period
    avgLoss = (avgLoss * (period-1) + Math.max(-d, 0)) / period
  }
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

function normalizeRSI(rsi: number): number {
  if (rsi < 30)  return -100 + ((rsi) / 30) * 60
  if (rsi < 50)  return -40  + ((rsi - 30) / 20) * 40
  if (rsi < 70)  return       ((rsi - 50) / 20) * 40
  return 40 + ((rsi - 70) / 30) * 60
}

function ema(vals: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const out: number[] = [vals[0]]
  for (let i = 1; i < vals.length; i++) out.push(vals[i] * k + out[i-1] * (1-k))
  return out
}

function linearRegression(source: number[], length: number): number[] {
  const out: number[] = []
  for (let i = length - 1; i < source.length; i++) {
    const slice = source.slice(i - length + 1, i + 1)
    const n = slice.length
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
    slice.forEach((y, x) => { sumX += x; sumY += y; sumXY += x*y; sumX2 += x*x })
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
    const intercept = (sumY - slope * sumX) / n
    out.push(slope * (n-1) + intercept)
  }
  return out
}

function calcVMC(candles: {h:number;l:number;c:number}[], length = 7, smoothing = 3): number {
  if (candles.length < length * 2) return 0
  const hl2 = candles.map(c => (c.h + c.l) / 2)
  const rawVMC: number[] = []
  for (let i = length - 1; i < candles.length; i++) {
    const win = candles.slice(i - length + 1, i + 1)
    const hi = Math.max(...win.map(c => c.h))
    const lo = Math.min(...win.map(c => c.l))
    const av = hl2.slice(i - length + 1, i + 1).reduce((s, v) => s+v, 0) / length
    const denom = hi - lo
    if (denom === 0) { rawVMC.push(0); continue }
    rawVMC.push(((candles[i].c - (hi + lo + av) / 3) / denom) * 100)
  }
  if (rawVMC.length < length) return 0
  const linreg = linearRegression(rawVMC, Math.min(length, rawVMC.length))
  const smoothed = ema(linreg, smoothing)
  return smoothed[smoothed.length - 1] ?? 0
}

function combinedScore(rsiNorm: number, vmc: number): number {
  return rsiNorm * 0.4 + vmc * 0.6
}

function scoreToSignal(score: number): Signal {
  if (score < -40) return 'BUY'
  if (score < -10) return 'BULLISH'
  if (score <=  10) return 'NEUTRAL'
  if (score <  40) return 'BEARISH'
  return 'SELL'
}

const SIGNAL_CFG: Record<Signal, { label: string; color: string; bg: string }> = {
  BUY:     { label: 'ACHETER', color: '#22C759', bg: 'rgba(34,199,89,0.25)'    },
  BULLISH: { label: 'BAISSIER',color: '#FFD60A', bg: 'rgba(255,214,10,0.2)'   },
  NEUTRAL: { label: 'NEUTRE',  color: '#8F94A3', bg: 'rgba(143,148,163,0.15)' },
  BEARISH: { label: 'HAUSSIER',color: '#FF9500', bg: 'rgba(255,149,0,0.2)'    },
  SELL:    { label: 'VENDRE',  color: '#FF3B30', bg: 'rgba(255,59,48,0.25)'   },
}

// ── Fetch + Compute ────────────────────────────────────────────────────────


async function computeMTF(symbol: string): Promise<MTFSnapshot> {
  const results = await Promise.allSettled(
    TIMEFRAMES.map(({ interval, limit }) => fetchTF(symbol, interval, limit))
  )

  const readings: MTFReading[] = []

  TIMEFRAMES.forEach(({ tf, label, minutes }, i) => {
    const r = results[i]
    if (r.status !== 'fulfilled' || r.value.length < 20) return
    const candles = r.value
    const closes  = candles.map(c => c.c)
    const rsi     = calcRSI(closes)
    const rsiNorm = normalizeRSI(rsi)
    const vmc     = calcVMC(candles)
    const score   = combinedScore(rsiNorm, vmc)
    const signal  = scoreToSignal(score)
    const divergence = (rsiNorm > 0 && vmc < 0) || (rsiNorm < 0 && vmc > 0)
    readings.push({ tf, label, rsi, rsiNorm, vmc, score, signal, divergence })
  })

  if (readings.length === 0) throw new Error('No data')

  // Global weighted (miroir Swift: poids = minutes)
  const totalW = readings.reduce((s, r) => {
    const cfg = TIMEFRAMES.find(t => t.tf === r.tf)
    return s + (cfg?.minutes || 1)
  }, 0)
  const weightedRSI = readings.reduce((s, r) => {
    const w = TIMEFRAMES.find(t => t.tf === r.tf)?.minutes || 1
    return s + r.rsiNorm * w
  }, 0) / totalW
  const weightedVMC = readings.reduce((s, r) => {
    const w = TIMEFRAMES.find(t => t.tf === r.tf)?.minutes || 1
    return s + r.vmc * w
  }, 0) / totalW
  const globalScore  = combinedScore(weightedRSI, weightedVMC)
  const globalSignal = scoreToSignal(globalScore)

  // Confluence (% TFs dont le signal == globalSignal, ou dans la même direction)
  const sameDir = readings.filter(r => {
    const gBull = globalScore < -10
    const gBear = globalScore > 10
    const rBull = r.score < -10
    const rBear = r.score > 10
    return (gBull && rBull) || (gBear && rBear) || (!gBull && !gBear && !rBull && !rBear)
  }).length
  const confluence = Math.round(sameDir / readings.length * 100)

  const prevScore = readings.slice(-3).reduce((s, r) => s + r.score, 0) / 3
  const isTurningUp   = globalScore < prevScore && globalScore < -15
  const isTurningDown = globalScore > prevScore && globalScore > 15

  return {
    readings,
    globalRSI: weightedRSI,
    globalVMC: weightedVMC,
    globalScore,
    globalSignal,
    confluence,
    isTurningUp,
    isTurningDown,
  }
}

// ── RSI Bar ────────────────────────────────────────────────────────────────
function RSIBar({ rsi, norm, width = 22 }: { rsi: number; norm: number; width?: number }) {
  const H = 90
  const fillH = Math.abs(norm) / 100 * H
  const color = norm < -40 ? '#42A5F5' : norm < 0 ? '#7E57C2' : norm < 40 ? '#CE93D8' : '#EF5350'
  const fromBottom = norm < 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <div style={{ width, height: H, background: '#0D1117', borderRadius: 4, position: 'relative', border: '1px solid #2A2F3E', overflow: 'hidden' }}>
        {/* Zero line */}
        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: '#2A2F3E' }} />
        {/* Fill */}
        <div style={{
          position: 'absolute', left: 2, right: 2,
          height: fillH, borderRadius: 3,
          bottom: fromBottom ? 2 : undefined,
          top: fromBottom ? undefined : H/2,
          background: color,
          opacity: 0.85,
        }} />
      </div>
      <div style={{ fontSize: 8, color: '#8F94A3', fontFamily: 'monospace' }}>{rsi.toFixed(0)}</div>
    </div>
  )
}

// ── VMC Bar ────────────────────────────────────────────────────────────────
function VMCBar({ vmc, width = 28 }: { vmc: number; width?: number }) {
  const H = 90
  const clamped = Math.max(-100, Math.min(100, vmc))
  const fillH = Math.abs(clamped) / 100 * H
  const color = clamped < -25 ? '#22C759' : clamped < 0 ? '#66BB6A' : clamped < 35 ? '#CE93D8' : '#EF5350'
  const fromBottom = clamped < 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <div style={{ width, height: H, background: '#0D1117', borderRadius: 4, position: 'relative', border: '1px solid #2A2F3E', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: '#2A2F3E' }} />
        <div style={{
          position: 'absolute', left: 2, right: 2,
          height: fillH, borderRadius: 3,
          bottom: fromBottom ? 2 : undefined,
          top: fromBottom ? undefined : H/2,
          background: color,
          opacity: 0.85,
        }} />
      </div>
      <div style={{ fontSize: 8, color: '#8F94A3', fontFamily: 'monospace' }}>{vmc.toFixed(1)}</div>
    </div>
  )
}

// ── Signal Detail Modal ────────────────────────────────────────────────────
function SignalDetailModal({ r, onClose }: { r: MTFReading; onClose: () => void }) {
  const sig = SIGNAL_CFG[r.signal]
  const scoreColor = r.score < -40 ? '#22C759' : r.score < -10 ? '#FFD60A' : r.score > 40 ? '#FF3B30' : r.score > 10 ? '#FF9500' : '#8F94A3'
  const rsiZone = r.rsi < 30 ? 'Survente' : r.rsi > 70 ? 'Surachat' : 'Neutre'
  const rsiZoneColor = r.rsi < 30 ? '#42A5F5' : r.rsi > 70 ? '#EF5350' : '#8F94A3'
  const vmcZone = r.vmc < -25 ? 'Fort négatif' : r.vmc > 35 ? 'Fort positif' : 'Neutre'
  const vmcZoneColor = r.vmc < -25 ? '#22C759' : r.vmc > 35 ? '#EF5350' : '#8F94A3'
  const interpretation = r.score < -40
    ? 'Zone d\'achat forte — RSI en survente + VMC très négatif. Potentiel de rebond élevé. Attendre une confirmation de retournement avant d\'entrer.'
    : r.score < -10
    ? 'Biais haussier — Les indicateurs montrent un momentum ascendant. Le RSI remonte depuis les zones basses et le VMC confirme.'
    : r.score > 40
    ? 'Zone de vente forte — RSI en surachat + VMC très positif. Risque de correction élevé. Envisager de prendre des profits ou de shorter.'
    : r.score > 10
    ? 'Biais baissier — Le momentum faiblit. Le RSI est élevé et le VMC indique une pression vendeuse croissante.'
    : 'Zone neutre — Pas de signal directionnel clair. Les indicateurs sont équilibrés. Attendre un signal plus marqué.'

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:'#161B22', border:`2px solid ${sig.color}50`, borderRadius:16, padding:24, width:420, maxWidth:'95vw', maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ fontSize:14, fontWeight:800, color:sig.color, background:sig.bg, padding:'4px 14px', borderRadius:20, border:`1px solid ${sig.color}60` }}>{sig.label}</div>
            <div style={{ fontSize:16, fontWeight:700, color:'#F0F3FF' }}>{r.label}</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#555C70', cursor:'pointer', fontSize:18 }}>✕</button>
        </div>
        {/* Score */}
        <div style={{ textAlign:'center', marginBottom:20, padding:'16px', background:`${scoreColor}10`, border:`1px solid ${scoreColor}30`, borderRadius:12 }}>
          <div style={{ fontSize:9, color:'#555C70', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>Score combiné (RSI×40% + VMC×60%)</div>
          <div style={{ fontSize:32, fontWeight:800, color:scoreColor, fontFamily:'JetBrains Mono,monospace' }}>{r.score.toFixed(1)}</div>
        </div>
        {/* Details */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 }}>
          <div style={{ background:'rgba(255,255,255,0.02)', border:'1px solid #2A2F3E', borderRadius:10, padding:'12px 14px' }}>
            <div style={{ fontSize:9, color:'#555C70', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>RSI (14)</div>
            <div style={{ fontSize:20, fontWeight:700, color:'#F0F3FF', fontFamily:'JetBrains Mono,monospace' }}>{r.rsi.toFixed(1)}</div>
            <div style={{ fontSize:10, color:rsiZoneColor, marginTop:4 }}>{rsiZone}</div>
            <div style={{ fontSize:9, color:'#3D4254', marginTop:2 }}>Normalisé: {r.rsiNorm.toFixed(1)}</div>
          </div>
          <div style={{ background:'rgba(255,255,255,0.02)', border:'1px solid #2A2F3E', borderRadius:10, padding:'12px 14px' }}>
            <div style={{ fontSize:9, color:'#555C70', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>VMC</div>
            <div style={{ fontSize:20, fontWeight:700, color:'#F0F3FF', fontFamily:'JetBrains Mono,monospace' }}>{r.vmc.toFixed(1)}</div>
            <div style={{ fontSize:10, color:vmcZoneColor, marginTop:4 }}>{vmcZone}</div>
            {r.divergence && <div style={{ fontSize:9, color:'#FF9500', marginTop:2 }}>⚡ Divergence RSI/VMC</div>}
          </div>
        </div>
        {/* Interpretation */}
        <div style={{ background:'rgba(191,90,242,0.06)', border:'1px solid rgba(191,90,242,0.2)', borderRadius:10, padding:'12px 16px' }}>
          <div style={{ fontSize:10, fontWeight:700, color:'#BF5AF2', marginBottom:6 }}>✨ Interprétation</div>
          <div style={{ fontSize:12, color:'#C5C8D6', lineHeight:1.7 }}>{interpretation}</div>
        </div>
      </div>
    </div>
  )
}

// ── Column ─────────────────────────────────────────────────────────────────
function TFColumn({ r, onSelect }: { r: MTFReading; onSelect: (r: MTFReading) => void }) {
  const sig = SIGNAL_CFG[r.signal]
  const scoreColor = r.score < -40 ? '#22C759' : r.score < -10 ? '#FFD60A' : r.score > 40 ? '#FF3B30' : r.score > 10 ? '#FF9500' : '#8F94A3'
  return (
    <div onClick={() => onSelect(r)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '8px 6px', background: '#111520', border: `1px solid ${sig.color}30`, borderRadius: 10, minWidth: 70, position: 'relative', cursor:'pointer', transition:'all 0.15s' }}
      onMouseEnter={e=>(e.currentTarget.style.borderColor=sig.color+'80')}
      onMouseLeave={e=>(e.currentTarget.style.borderColor=sig.color+'30')}>
      {/* Signal badge */}
      <div style={{ fontSize: 9, fontWeight: 700, color: sig.color, background: sig.bg, padding: '2px 7px', borderRadius: 20, border: `1px solid ${sig.color}60`, textAlign: 'center' }}>
        {sig.label}
      </div>
      {r.divergence && (
        <div style={{ position: 'absolute', top: 4, right: 4, fontSize: 8, color: '#FF9500' }}>⚡</div>
      )}
      {/* Bars */}
      <div style={{ display: 'flex', gap: 5, alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <div style={{ fontSize: 7, color: '#555C70' }}>RSI</div>
          <RSIBar rsi={r.rsi} norm={r.rsiNorm} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <div style={{ fontSize: 7, color: '#555C70' }}>VMC</div>
          <VMCBar vmc={r.vmc} />
        </div>
      </div>
      {/* Labels RSI/VMC */}
      <div style={{ display: 'flex', gap: 4, fontSize: 7, color: '#555C70' }}>
        <span>RSI</span><span>VMC</span>
      </div>
      {/* Score */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'white', background: `${scoreColor}25`, border: `1px solid ${scoreColor}50`, borderRadius: 6, padding: '2px 8px', fontFamily: 'monospace' }}>
        {r.score.toFixed(0)}
      </div>
      {/* TF label */}
      <div style={{ fontSize: 10, fontWeight: 600, color: '#8F94A3' }}>{r.label}</div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function MTFDashboard({ symbol }: { symbol: string }) {
  const [snap,        setSnap]        = useState<MTFSnapshot | null>(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [nextRefresh, setNextRefresh] = useState(MTF_REFRESH_MS/1000)
  const [selectedReading, setSelectedReading] = useState<MTFReading | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const s = await computeMTF(symbol)
      setSnap(s)
      // Signal detection
      signalService.checkMTF(symbol, s.globalSignal, s.confluence, s.globalScore)
    } catch(e) { setError((e as Error).message) }
    setLoading(false)
  }, [symbol])

  useEffect(() => { load() }, [load])

  // Live refresh every 2 minutes
  useEffect(() => {
    const t = setInterval(() => load(), MTF_REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  // Countdown
  useEffect(() => {
    setNextRefresh(MTF_REFRESH_MS/1000)
    const t = setInterval(() => setNextRefresh(x => x<=1?MTF_REFRESH_MS/1000:x-1), 1000)
    return () => clearInterval(t)
  }, [symbol])

  if (loading) return (
    <div style={{ background: '#161B22', border: '1px solid #1E2330', borderRadius: 16, padding: '24px', textAlign: 'center' }}>
      <div style={{ width: 24, height: 24, border: '2px solid #2A2F3E', borderTopColor: '#FF9500', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 10px' }} />
      <div style={{ fontSize: 12, color: '#555C70' }}>Calcul RSI + VMC sur {TIMEFRAMES.length} timeframes...</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  if (error) return (
    <div style={{ background: '#161B22', border: '1px solid #1E2330', borderRadius: 16, padding: '16px', textAlign: 'center' }}>
      <div style={{ fontSize: 12, color: '#555C70', marginBottom: 8 }}>{error}</div>
      <button onClick={load} style={{ fontSize: 11, color: '#00E5FF', background: 'none', border: '1px solid #00E5FF40', borderRadius: 6, padding: '4px 12px', cursor: 'pointer' }}>Réessayer</button>
    </div>
  )

  if (!snap) return null

  const gSig = SIGNAL_CFG[snap.globalSignal]
  const confColor = snap.confluence >= 70 ? '#22C759' : snap.confluence >= 50 ? '#FF9500' : '#8F94A3'
  const scoreColor = snap.globalScore < -40 ? '#22C759' : snap.globalScore < -10 ? '#FFD60A' : snap.globalScore > 40 ? '#FF3B30' : snap.globalScore > 10 ? '#FF9500' : '#8F94A3'

  return (
    <div style={{ background: '#161B22', border: '1px solid #1E2330', borderRadius: 16, overflow: 'hidden', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.05),transparent)' }} />

      {/* Header */}
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: '#555C70', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Global Signal</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: gSig.color, fontFamily: 'Syne, sans-serif' }}>{gSig.label}</div>
        </div>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: '#555C70', marginBottom: 2 }}>Combined Score</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: scoreColor, fontFamily: 'JetBrains Mono, monospace' }}>
              {snap.globalScore >= 0 ? '+' : ''}{snap.globalScore.toFixed(1)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: '#555C70', marginBottom: 2 }}>Confluence</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: confColor, fontFamily: 'JetBrains Mono, monospace' }}>{snap.confluence}%</div>
              {snap.confluence >= 70 && <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#22C75920', border: '2px solid #22C759', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#22C759' }}>✓</div>}
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:5,padding:'2px 8px',background:'rgba(34,199,89,0.1)',border:'1px solid rgba(34,199,89,0.25)',borderRadius:6}}>
            <div style={{width:5,height:5,borderRadius:'50%',background:'#22C759',animation:'pulse 1.5s ease-in-out infinite'}}/>
            <span style={{fontSize:9,fontWeight:700,color:'#22C759',fontFamily:'monospace'}}>LIVE</span>
            <span style={{fontSize:9,color:'#555C70',fontFamily:'monospace'}}>{Math.floor(nextRefresh/60)}:{String(nextRefresh%60).padStart(2,'0')}</span>
          </div>
          <button onClick={load} style={{ background: '#1C2130', border: '1px solid #2A2F3E', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 11, color: '#8F94A3' }}>↻</button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ padding: '0 16px 10px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {[
          { color: '#42A5F5', label: 'RSI Survente (<30)' },
          { color: '#7E57C2', label: 'RSI Neutre' },
          { color: '#EF5350', label: 'RSI Surachat (>70)' },
          { color: '#22C759', label: 'VMC Fort négatif' },
          { color: '#CE93D8', label: 'VMC Neutre' },
          { color: '#EF5350', label: 'VMC Fort positif' },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
            <span style={{ fontSize: 9, color: '#555C70' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Columns — horizontal scroll */}
      <div style={{ overflowX: 'auto', scrollbarWidth: 'none' }}>
        <div style={{ display: 'flex', gap: 8, padding: '0 16px 16px', width: 'max-content' }}>
          {/* Ticker column */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '8px 10px', background: '#111520', border: '1px solid #2A2F3E', borderRadius: 10, minWidth: 64 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#F59714' }}>
              {symbol.replace('USDT', '')}
            </div>
            <div style={{ fontSize: 10, color: '#F5971460', marginTop: 2 }}>USDT</div>
          </div>

          {/* Global column */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '8px 6px', background: '#111520', border: `2px solid ${gSig.color}50`, borderRadius: 10, minWidth: 70 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: gSig.color, background: gSig.bg, padding: '2px 7px', borderRadius: 20, border: `1px solid ${gSig.color}60` }}>
              {gSig.label}
            </div>
            <div style={{ display: 'flex', gap: 5, alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <div style={{ fontSize: 7, color: '#555C70' }}>Dash</div>
                <RSIBar rsi={50 + snap.globalRSI/2} norm={snap.globalRSI} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <div style={{ fontSize: 7, color: '#555C70' }}>Add</div>
                <VMCBar vmc={snap.globalVMC} />
              </div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'white', background: `${scoreColor}25`, border: `1px solid ${scoreColor}50`, borderRadius: 6, padding: '2px 8px', fontFamily: 'monospace' }}>
              {snap.globalScore >= 0 ? '+' : ''}{snap.globalScore.toFixed(1)}
            </div>
            <div style={{ fontSize: 9, display: 'flex', alignItems: 'center', gap: 3, color: snap.isTurningUp ? '#22C759' : snap.isTurningDown ? '#FF3B30' : '#555C70' }}>
              {snap.isTurningUp ? '↑' : snap.isTurningDown ? '↓' : '●'} Global
            </div>
          </div>

          {/* TF columns */}
          {snap.readings.map(r => <TFColumn key={r.tf} r={r} onSelect={setSelectedReading} />)}
        </div>
      </div>
      {selectedReading && <SignalDetailModal r={selectedReading} onClose={() => setSelectedReading(null)} />}
    </div>
  )
}
