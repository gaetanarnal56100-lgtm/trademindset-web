// RsiEliteChart.tsx — RSI Elite Toolkit
// RSI(14) gris · MA orange · zones OB teal / OS violet · divergences avec ligne pointillée + label

import { useState, useEffect, useRef, useCallback } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'

const fbFn = getFunctions(app, 'europe-west1')

// ── Types ──────────────────────────────────────────────────────────────────
interface Candle { o: number; h: number; l: number; c: number; v: number; t: number }

const TF_OPTIONS = [
  { label: '15m', interval: '15m', limit: 200 },
  { label: '1H',  interval: '1h',  limit: 200 },
  { label: '4H',  interval: '4h',  limit: 200 },
  { label: '1J',  interval: '1d',  limit: 200 },
  { label: '1S',  interval: '1w',  limit: 200 },
]

// Une paire de pivots qui forment une divergence
interface DivPair {
  type: 'bull' | 'bear'
  idx1: number   // pivot antérieur
  idx2: number   // pivot récent
  rsi1: number
  rsi2: number
}

// ── Candle fetcher ─────────────────────────────────────────────────────────
function isCrypto(symbol: string) {
  return /USDT$|BUSD$|BTC$|ETH$|BNB$/i.test(symbol)
}

async function fetchCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  const sym = symbol.toUpperCase()
  if (isCrypto(sym)) {
    const tries = [sym, sym.replace(/USDT$/i, '') + 'USDT']
    for (const s of tries) {
      for (const base of ['https://fapi.binance.com/fapi/v1', 'https://api.binance.com/api/v3']) {
        try {
          const r = await fetch(`${base}/klines?symbol=${s}&interval=${interval}&limit=${limit}`)
          if (r.ok) {
            const d = await r.json() as unknown[][]
            if (Array.isArray(d) && d.length > 10)
              return d.map(a => ({ t: Number(a[0]), o: +String(a[1]), h: +String(a[2]), l: +String(a[3]), c: +String(a[4]), v: +String(a[5]) }))
          }
        } catch { /**/ }
      }
    }
    throw new Error(`Crypto ${sym} introuvable`)
  }
  const TF_IV: Record<string, string> = { '15m':'15m','1h':'1h','4h':'1h','1d':'1d','1w':'1wk' }
  const TF_RG: Record<string, string> = { '15m':'5d','1h':'1mo','4h':'3mo','1d':'1y','1w':'2y' }
  const fn = httpsCallable<Record<string, unknown>, { s: string; candles: { t:number;o:number;h:number;l:number;c:number;v:number }[] }>(fbFn, 'fetchYahooCandles')
  const res = await fn({ symbol: sym, interval: TF_IV[interval] ?? '1d', range: TF_RG[interval] ?? '1y' })
  if (res.data.s === 'ok' && res.data.candles?.length > 5)
    return res.data.candles.map(c => ({ t: c.t * 1000, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }))
  throw new Error(`${sym} introuvable`)
}

// ── RSI Wilder ─────────────────────────────────────────────────────────────
function calcRSIArr(closes: number[], period = 14): number[] {
  const out = new Array(closes.length).fill(50)
  if (closes.length <= period) return out
  let ag = 0, al = 0
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i-1]; if (d>0) ag+=d; else al-=d }
  ag /= period; al /= period
  out[period] = al === 0 ? 100 : 100 - 100/(1+ag/al)
  for (let i = period+1; i < closes.length; i++) {
    const d = closes[i]-closes[i-1]; const g=d>0?d:0; const l=d<0?-d:0
    ag=(ag*(period-1)+g)/period; al=(al*(period-1)+l)/period
    out[i] = al===0?100:100-100/(1+ag/al)
  }
  return out
}

// ── EMA ────────────────────────────────────────────────────────────────────
function ema(vals: number[], len: number): number[] {
  if (!vals.length) return []
  const k = 2/(len+1); const out = [vals[0]]
  for (let i=1;i<vals.length;i++) out.push(vals[i]*k+out[i-1]*(1-k))
  return out
}

// ── Pivots ─────────────────────────────────────────────────────────────────
function pivotLows(arr: number[], lb=5, rb=5): number[] {
  const p: number[] = []
  for (let i=lb; i<arr.length-rb; i++) {
    const v=arr[i]; let ok=true
    for (let j=i-lb;j<=i+rb;j++) if (j!==i&&arr[j]<=v){ok=false;break}
    if (ok) p.push(i)
  }
  return p
}
function pivotHighs(arr: number[], lb=5, rb=5): number[] {
  const p: number[] = []
  for (let i=lb; i<arr.length-rb; i++) {
    const v=arr[i]; let ok=true
    for (let j=i-lb;j<=i+rb;j++) if (j!==i&&arr[j]>=v){ok=false;break}
    if (ok) p.push(i)
  }
  return p
}

// ── Divergence pairs ───────────────────────────────────────────────────────
function detectDivPairs(closes: number[], rsiArr: number[]): DivPair[] {
  if (closes.length < 25) return []
  const pairs: DivPair[] = []

  // BULL: price lower low + RSI higher low
  const pLows = pivotLows(closes)
  const rLows = pivotLows(rsiArr)
  for (let pi=1; pi<pLows.length; pi++) {
    const i1=pLows[pi-1], i2=pLows[pi]
    // nearest RSI pivot low around i2 (±4 bars)
    const ri2candidates = rLows.filter(r => Math.abs(r-i2)<=4)
    if (!ri2candidates.length) continue
    const ri2 = ri2candidates[ri2candidates.length-1]
    const ri1candidates = rLows.filter(r => r<ri2 && Math.abs(r-i1)<=4)
    if (!ri1candidates.length) continue
    const ri1 = ri1candidates[ri1candidates.length-1]
    if (closes[i2]<closes[i1] && rsiArr[ri2]>rsiArr[ri1]+2)
      pairs.push({ type:'bull', idx1:ri1, idx2:ri2, rsi1:rsiArr[ri1], rsi2:rsiArr[ri2] })
  }

  // BEAR: price higher high + RSI lower high
  const pHighs = pivotHighs(closes)
  const rHighs = pivotHighs(rsiArr)
  for (let pi=1; pi<pHighs.length; pi++) {
    const i1=pHighs[pi-1], i2=pHighs[pi]
    const ri2candidates = rHighs.filter(r => Math.abs(r-i2)<=4)
    if (!ri2candidates.length) continue
    const ri2 = ri2candidates[ri2candidates.length-1]
    const ri1candidates = rHighs.filter(r => r<ri2 && Math.abs(r-i1)<=4)
    if (!ri1candidates.length) continue
    const ri1 = ri1candidates[ri1candidates.length-1]
    if (closes[i2]>closes[i1] && rsiArr[ri2]<rsiArr[ri1]-2)
      pairs.push({ type:'bear', idx1:ri1, idx2:ri2, rsi1:rsiArr[ri1], rsi2:rsiArr[ri2] })
  }

  return pairs
}

// ── Canvas draw (DPR-aware) ────────────────────────────────────────────────
function setCanvasHiDPI(canvas: HTMLCanvasElement, cssW: number, cssH: number): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1
  canvas.width  = Math.round(cssW * dpr)
  canvas.height = Math.round(cssH * dpr)
  canvas.style.width  = cssW + 'px'
  canvas.style.height = cssH + 'px'
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(dpr, dpr)
  return ctx
}

function draw(
  canvas: HTMLCanvasElement,
  cssW: number,
  cssH: number,
  rsiArr: number[],
  rsiMA:  number[],
  pairs:  DivPair[],
  startIdx: number,
  maLen: number,
) {
  const ctx = setCanvasHiDPI(canvas, cssW, cssH)
  if (!ctx) return

  const W = cssW, H = cssH
  const PAD_L = 44, PAD_R = 12, PAD_T = 14, PAD_B = 22
  const cW = W - PAD_L - PAD_R
  const cH = H - PAD_T - PAD_B

  const visible = rsiArr.slice(startIdx)
  const N = visible.length
  if (N < 2) return

  const toX = (i: number) => PAD_L + (i / (N-1)) * cW
  const toY = (v: number) => PAD_T + (1 - v/100) * cH

  // ── Background ────────────────────────────────────────────────────────
  ctx.fillStyle = '#0D1117'
  ctx.fillRect(0, 0, W, H)

  // OB zone (70–100) — dark teal
  ctx.fillStyle = 'rgba(0,150,136,0.18)'
  ctx.fillRect(PAD_L, toY(100), cW, toY(70)-toY(100))

  // Middle zone (25–70) — very subtle
  ctx.fillStyle = 'rgba(255,255,255,0.015)'
  ctx.fillRect(PAD_L, toY(70), cW, toY(25)-toY(70))

  // OS zone (0–25) — dark purple
  ctx.fillStyle = 'rgba(103,58,183,0.20)'
  ctx.fillRect(PAD_L, toY(25), cW, toY(0)-toY(25))

  // ── Level lines ───────────────────────────────────────────────────────
  const levels: [number, string][] = [
    [70, 'rgba(0,188,212,0.5)'],
    [50, 'rgba(255,255,255,0.12)'],
    [25, 'rgba(186,104,200,0.5)'],
  ]
  levels.forEach(([lv, col]) => {
    const y = toY(lv)
    ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W-PAD_R, y)
    ctx.strokeStyle = col
    ctx.lineWidth = lv===50 ? 0.8 : 1
    ctx.setLineDash(lv===50 ? [3,3] : [6,4]); ctx.stroke(); ctx.setLineDash([])
    // Y-axis label
    ctx.fillStyle = lv===50 ? 'rgba(255,255,255,0.3)' : col
    ctx.font = '10px "JetBrains Mono", monospace'
    ctx.textAlign = 'right'
    ctx.fillText(String(lv), PAD_L-5, y+3.5)
  })

  // ── RSI MA line (orange, solid, drawn BEFORE RSI so it's behind) ──────
  const maVis = rsiMA.slice(startIdx)
  ctx.beginPath()
  let maStarted = false
  for (let i=0; i<maVis.length && i<N; i++) {
    const v = maVis[i]
    if (!v || v<=0 || isNaN(v)) continue
    const x=toX(i), y=toY(v)
    if (!maStarted) { ctx.moveTo(x,y); maStarted=true } else ctx.lineTo(x,y)
  }
  ctx.strokeStyle = '#F59714'; ctx.lineWidth = 1.6; ctx.stroke()

  // ── RSI line (light gray) ─────────────────────────────────────────────
  ctx.beginPath()
  for (let i=0; i<N; i++) {
    const x=toX(i), y=toY(visible[i])
    i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y)
  }
  ctx.strokeStyle = '#C5C8D6'; ctx.lineWidth = 1.4; ctx.stroke()

  // ── Divergence pairs ──────────────────────────────────────────────────
  const BULL_COL  = '#FF00FF'   // magenta (comme le screenshot)
  const BEAR_COL  = '#00E5FF'   // cyan

  pairs.forEach(p => {
    const li1 = p.idx1 - startIdx
    const li2 = p.idx2 - startIdx
    if (li1 < 0 || li2 >= N) return

    const x1=toX(li1), y1=toY(p.rsi1)
    const x2=toX(li2), y2=toY(p.rsi2)
    const col = p.type==='bull' ? BULL_COL : BEAR_COL

    // Dotted connecting line
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2)
    ctx.strokeStyle = col; ctx.lineWidth = 1.2
    ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([])

    // Circle on each pivot
    ;[{x:x1,y:y1},{x:x2,y:y2}].forEach(({x,y}) => {
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI*2)
      ctx.fillStyle = col; ctx.fill()
      ctx.strokeStyle = '#0D1117'; ctx.lineWidth = 1; ctx.stroke()
    })

    // Label at most-recent pivot
    const labelY = p.type==='bull' ? y2+16 : y2-10
    ctx.font = 'bold 9px "JetBrains Mono", monospace'
    ctx.textAlign = 'center'
    ctx.fillStyle = col
    ctx.fillText(p.type==='bull' ? 'REG BULL' : 'REG BEAR', x2, labelY)
  })

  // ── Current RSI badge (right side) ────────────────────────────────────
  const lastRSI = visible[N-1]
  if (lastRSI !== undefined) {
    const y = toY(lastRSI)
    const col = lastRSI>70 ? BEAR_COL : lastRSI<25 ? BULL_COL : '#C5C8D6'
    // pill background
    const txt = lastRSI.toFixed(1)
    ctx.font = 'bold 10px "JetBrains Mono", monospace'
    ctx.textAlign = 'left'
    const tw = ctx.measureText(txt).width
    ctx.fillStyle = '#161B22'
    ctx.fillRect(W-PAD_R-tw-8, y-8, tw+8, 16)
    ctx.fillStyle = col
    ctx.fillText(txt, W-PAD_R-tw-4, y+4)
  }

  // ── Chart border ──────────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 1
  ctx.strokeRect(PAD_L, PAD_T, cW, cH)
}

// ── Main component ─────────────────────────────────────────────────────────
export default function RsiEliteChart({ symbol: initialSymbol, syncInterval, visibleRange }: { symbol: string; syncInterval?: string; visibleRange?: {from:number;to:number}|null }) {
  const [symbol,  setSymbol]  = useState(initialSymbol)
  const [tf,      setTf]      = useState(TF_OPTIONS[1])   // 1H
  const [maLen,   setMaLen]   = useState(14)

  // Sync timeframe from parent chart
  useEffect(() => {
    if (!syncInterval) return
    const found = TF_OPTIONS.find(t => t.interval === syncInterval)
    if (found) setTf(found)
  }, [syncInterval])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [rsi,     setRsi]     = useState<number[]>([])
  const [rsiMA,   setRsiMA]   = useState<number[]>([])
  const [pairs,   setPairs]   = useState<DivPair[]>([])
  const [currRSI, setCurrRSI] = useState<number | null>(null)
  const [candles, setCandles] = useState<{t:number}[]>([])
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // ── Redraw helper ───────────────────────────────────────────────────────
  const redraw = useCallback((rsiArr: number[], rsiMAArr: number[], divPairs: DivPair[], ml: number, startOverride?: number) => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || rsiArr.length < 2) return
    const cssW = container.clientWidth
    const cssH = 240
    const startIdx = startOverride !== undefined ? startOverride : Math.max(0, rsiArr.length - 150)
    draw(canvas, cssW, cssH, rsiArr, rsiMAArr, divPairs, startIdx, ml)
  }, [])

  // ── Load ────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const candles = await fetchCandles(symbol, tf.interval, tf.limit)
      setCandles(candles.map(c => ({ t: c.t })))
      const closes  = candles.map(c => c.c)
      const rsiArr  = calcRSIArr(closes)
      // Build MA over the valid RSI slice (skip the warm-up zeros)
      const rsiValid = rsiArr.map((v,i) => i<14 ? NaN : v)
      const maInput  = rsiValid.filter(v => !isNaN(v))
      const maOut    = ema(maInput, maLen)
      // Re-embed at correct positions
      const fullMA   = new Array(rsiArr.length).fill(NaN)
      let mi = 0
      rsiValid.forEach((v,i) => { if (!isNaN(v)) { fullMA[i]=maOut[mi++] } })

      const divPairs = detectDivPairs(closes, rsiArr)
      setRsi(rsiArr); setRsiMA(fullMA); setPairs(divPairs)
      setCurrRSI(rsiArr[rsiArr.length-1] ?? null)
      redraw(rsiArr, fullMA, divPairs, maLen)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur')
    } finally { setLoading(false) }
  }, [symbol, tf, maLen, redraw])

  useEffect(() => { load() }, [load])
  useEffect(() => { setSymbol(initialSymbol) }, [initialSymbol])

  // ── Compute startIdx from visibleRange ─────────────────────────────────
  const computeStart = useCallback((rsiArr: number[]): number => {
    if (!visibleRange || candles.length === 0) return Math.max(0, rsiArr.length - 150)
    const fromMs = visibleRange.from * 1000
    const s = candles.findIndex(c => c.t >= fromMs)
    return s < 0 ? Math.max(0, rsiArr.length - 150) : s
  }, [visibleRange, candles])

  // Redraw when data or visibleRange changes
  useEffect(() => { redraw(rsi, rsiMA, pairs, maLen, computeStart(rsi)) }, [rsi, rsiMA, pairs, maLen, redraw, computeStart])

  // ── Resize observer ────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => { redraw(rsi, rsiMA, pairs, maLen, computeStart(rsi)) })
    ro.observe(container)
    return () => ro.disconnect()
  }, [rsi, rsiMA, pairs, maLen, redraw, computeStart])

  // ── Status label ────────────────────────────────────────────────────────
  const rsiStatus = currRSI === null ? null
    : currRSI > 70 ? { label: 'Surachat',  color: '#00E5FF' }
    : currRSI < 25 ? { label: 'Survente',  color: '#FF00FF' }
    : currRSI > 55 ? { label: 'Haussier',  color: 'var(--tm-profit)' }
    : currRSI < 45 ? { label: 'Baissier',  color: 'var(--tm-loss)' }
    : { label: 'Neutre', color: 'var(--tm-text-muted)' }

  const bulls = pairs.filter(p => p.type==='bull').length
  const bears = pairs.filter(p => p.type==='bear').length

  return (
    <div style={{ background: '#0D1117', border: '1px solid #1E2330', borderRadius: 16, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, borderBottom: '1px solid #1E2330' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#8B949E', letterSpacing: '0.05em', textTransform: 'uppercase' }}>RSI Elite</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#C5C8D6', fontFamily: 'JetBrains Mono, monospace' }}>{symbol}</span>
          {rsiStatus && (
            <span style={{ fontSize: 10, fontWeight: 700, color: rsiStatus.color, background: `${rsiStatus.color}18`, padding: '2px 8px', borderRadius: 6, border: `1px solid ${rsiStatus.color}30` }}>
              {currRSI?.toFixed(1)} · {rsiStatus.label}
            </span>
          )}
          {bears > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: '#00E5FF', background: 'rgba(0,229,255,0.1)', padding: '2px 8px', borderRadius: 6 }}>↘ {bears} Bear</span>}
          {bulls > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: '#FF00FF', background: 'rgba(255,0,255,0.1)', padding: '2px 8px', borderRadius: 6 }}>↗ {bulls} Bull</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: '#545B7A' }}>MA</span>
          {[9, 14, 21].map(v => (
            <button key={v} onClick={() => setMaLen(v)} style={{
              padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${maLen===v ? '#F59714' : '#2A2F3E'}`,
              background: maLen===v ? 'rgba(245,151,20,0.15)' : 'transparent',
              color: maLen===v ? '#F59714' : '#545B7A',
            }}>{v}</button>
          ))}
          <div style={{ width: 1, height: 14, background: '#2A2F3E' }} />
          {!syncInterval && TF_OPTIONS.map(t => (
            <button key={t.label} onClick={() => setTf(t)} style={{
              padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${tf.label===t.label ? '#00E5FF' : '#2A2F3E'}`,
              background: tf.label===t.label ? 'rgba(0,229,255,0.08)' : 'transparent',
              color: tf.label===t.label ? '#00E5FF' : '#545B7A',
            }}>{t.label}</button>
          ))}
          {syncInterval && <span style={{fontSize:9,color:'#545B7A',padding:'3px 0',fontFamily:'monospace'}}>🔗 Synchronisé sur {syncInterval}</span>}
        </div>
      </div>

      {/* Legend strip */}
      <div style={{ padding: '5px 16px', display: 'flex', gap: 14, background: 'rgba(255,255,255,0.01)', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
        {[
          { color:'#C5C8D6', label:'RSI(14)', dash:false },
          { color:'#F59714', label:`MA(${maLen})`, dash:false },
          { color:'rgba(0,150,136,0.6)', label:'Surachat >70', dash:true },
          { color:'rgba(103,58,183,0.6)', label:'Survente <25', dash:true },
          { color:'#00E5FF', label:'Div. Bear', circle:true },
          { color:'#FF00FF', label:'Div. Bull', circle:true },
        ].map(({ color, label, dash, circle }) => (
          <div key={label} style={{ display:'flex', alignItems:'center', gap:5 }}>
            {circle
              ? <div style={{ width:8, height:8, borderRadius:'50%', background:color }} />
              : <div style={{ width:16, height:2, background:dash?'transparent':color, borderTop:dash?`2px dashed ${color}`:'none', borderRadius:1 }} />
            }
            <span style={{ fontSize:9, color:'#545B7A', whiteSpace:'nowrap' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Canvas */}
      <div ref={containerRef} style={{ position:'relative', width:'100%', background:'#0D1117' }}>
        {loading && (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(13,17,23,0.75)', zIndex:2 }}>
            <div style={{ width:20, height:20, border:'2px solid #2A2F3E', borderTopColor:'#00E5FF', borderRadius:'50%', animation:'rsiSpin 0.7s linear infinite' }} />
          </div>
        )}
        {error && !loading && (
          <div style={{ padding:'28px 16px', textAlign:'center', color:'#545B7A', fontSize:12 }}>
            <div style={{ fontSize:22, marginBottom:6 }}>⚠️</div>{error}
          </div>
        )}
        <canvas ref={canvasRef} style={{ display:'block', width:'100%', height:240 }} />
        <style>{`@keyframes rsiSpin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  )
}
