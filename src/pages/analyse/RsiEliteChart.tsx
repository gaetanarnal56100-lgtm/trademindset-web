// RsiEliteChart.tsx — RSI Elite Toolkit (inspiré du script Pine Script RSI Elite Toolkit)
// RSI 14 + MA lissée + zones OB/OS + marqueurs de divergences haussières/baissières

import { useState, useEffect, useRef, useCallback } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'

const fbFn = getFunctions(app, 'europe-west1')

// ── Types ──────────────────────────────────────────────────────────────────
interface Candle { o: number; h: number; l: number; c: number; v: number; t: number }

const TF_OPTIONS = [
  { label:'15m', interval:'15m', limit:200 },
  { label:'1H',  interval:'1h',  limit:200 },
  { label:'4H',  interval:'4h',  limit:200 },
  { label:'1J',  interval:'1d',  limit:200 },
  { label:'1S',  interval:'1w',  limit:200 },
]

function isCryptoSymbol(symbol: string) {
  return /USDT$|BUSD$|BTC$|ETH$|BNB$/i.test(symbol)
}

// ── Candle fetcher (same pattern as OscillatorCharts) ──────────────────────
async function fetchCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  const sym = symbol.toUpperCase()
  if (isCryptoSymbol(sym)) {
    const binanceSymbols = [sym, sym.replace(/USDT$/i,'')+'USDT']
    for (const bSym of binanceSymbols) {
      for (const base of ['https://fapi.binance.com/fapi/v1', 'https://api.binance.com/api/v3']) {
        try {
          const r = await fetch(`${base}/klines?symbol=${bSym}&interval=${interval}&limit=${limit}`)
          if (r.ok) {
            const data = await r.json() as unknown[][]
            if (Array.isArray(data) && data.length > 10) {
              return data.map(a => ({
                t: Number(a[0]), o: parseFloat(a[1] as string), h: parseFloat(a[2] as string),
                l: parseFloat(a[3] as string), c: parseFloat(a[4] as string), v: parseFloat(a[5] as string),
              }))
            }
          }
        } catch {/**/}
      }
    }
    throw new Error(`Crypto ${sym} introuvable`)
  }
  const TF_TO_YH: Record<string,string> = {'15m':'15m','1h':'1h','4h':'1h','1d':'1d','1w':'1wk'}
  const TF_RANGE: Record<string,string> = {'15m':'5d','1h':'1mo','4h':'3mo','1d':'1y','1w':'2y'}
  const yhInterval = TF_TO_YH[interval] || '1d'
  const yhRange    = TF_RANGE[interval]  || '1y'
  const fn = httpsCallable<Record<string,unknown>, {s:string; candles:{t:number;o:number;h:number;l:number;c:number;v:number}[]}>(fbFn, 'fetchYahooCandles')
  const res = await fn({ symbol: sym, interval: yhInterval, range: yhRange })
  if (res.data.s === 'ok' && res.data.candles && res.data.candles.length > 5) {
    return res.data.candles.map(c => ({ t: c.t * 1000, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }))
  }
  throw new Error(`${sym} introuvable`)
}

// ── RSI computation (Wilder smoothing) ─────────────────────────────────────
function calcRSIArr(closes: number[], period = 14): number[] {
  const out = new Array(closes.length).fill(50)
  if (closes.length <= period) return out
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) avgGain += d; else avgLoss -= d
  }
  avgGain /= period; avgLoss /= period
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    const gain = d > 0 ? d : 0; const loss = d < 0 ? -d : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}

// ── EMA ────────────────────────────────────────────────────────────────────
function emaArr(vals: number[], length: number): number[] {
  if (!vals.length || length <= 0) return vals.map(() => 0)
  const k = 2 / (length + 1); const out = [vals[0]]
  for (let i = 1; i < vals.length; i++) out.push(vals[i] * k + out[i-1] * (1-k))
  return out
}

// ── Pivot detection ─────────────────────────────────────────────────────────
function findPivotLows(arr: number[], lb = 5, rb = 5): number[] {
  const pivots: number[] = []
  for (let i = lb; i < arr.length - rb; i++) {
    const v = arr[i]; let ok = true
    for (let j = i - lb; j <= i + rb; j++) { if (j !== i && arr[j] <= v) { ok = false; break } }
    if (ok) pivots.push(i)
  }
  return pivots
}

function findPivotHighs(arr: number[], lb = 5, rb = 5): number[] {
  const pivots: number[] = []
  for (let i = lb; i < arr.length - rb; i++) {
    const v = arr[i]; let ok = true
    for (let j = i - lb; j <= i + rb; j++) { if (j !== i && arr[j] >= v) { ok = false; break } }
    if (ok) pivots.push(i)
  }
  return pivots
}

// ── Divergence markers ──────────────────────────────────────────────────────
interface DivMarker { idx: number; type: 'bull' | 'bear' }

function detectDivergenceMarkers(closes: number[], rsiArr: number[]): DivMarker[] {
  const markers: DivMarker[] = []
  if (closes.length < 25) return markers

  const priceLows  = findPivotLows(closes)
  const rsiLows    = findPivotLows(rsiArr)
  const priceHighs = findPivotHighs(closes)
  const rsiHighs   = findPivotHighs(rsiArr)

  // Regular bull divergence: price lower low + RSI higher low
  for (let pi = 1; pi < priceLows.length; pi++) {
    const i1 = priceLows[pi - 1], i2 = priceLows[pi]
    // Find the nearest RSI pivot low close to i2
    const rsiLowNear = rsiLows.filter(r => Math.abs(r - i2) <= 3)
    if (rsiLowNear.length === 0) continue
    const ri2 = rsiLowNear[rsiLowNear.length - 1]
    const rsiLowBefore = rsiLows.filter(r => r < ri2 && r >= i1 - 3)
    if (rsiLowBefore.length === 0) continue
    const ri1 = rsiLowBefore[rsiLowBefore.length - 1]
    if (closes[i2] < closes[i1] && rsiArr[ri2] > rsiArr[ri1] + 2) {
      markers.push({ idx: i2, type: 'bull' })
    }
  }

  // Regular bear divergence: price higher high + RSI lower high
  for (let pi = 1; pi < priceHighs.length; pi++) {
    const i1 = priceHighs[pi - 1], i2 = priceHighs[pi]
    const rsiHighNear = rsiHighs.filter(r => Math.abs(r - i2) <= 3)
    if (rsiHighNear.length === 0) continue
    const ri2 = rsiHighNear[rsiHighNear.length - 1]
    const rsiHighBefore = rsiHighs.filter(r => r < ri2 && r >= i1 - 3)
    if (rsiHighBefore.length === 0) continue
    const ri1 = rsiHighBefore[rsiHighBefore.length - 1]
    if (closes[i2] > closes[i1] && rsiArr[ri2] < rsiArr[ri1] - 2) {
      markers.push({ idx: i2, type: 'bear' })
    }
  }

  return markers
}

// ── Canvas drawing ──────────────────────────────────────────────────────────
function resolveCSS(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback
}

function drawRsiElite(
  canvas: HTMLCanvasElement,
  rsiArr: number[],
  rsiMA: number[],
  markers: DivMarker[],
  startIdx: number,
  maLen: number,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const W = canvas.width, H = canvas.height
  ctx.clearRect(0, 0, W, H)

  const PAD_L = 42, PAD_R = 8, PAD_T = 12, PAD_B = 20
  const chartW = W - PAD_L - PAD_R
  const chartH = H - PAD_T - PAD_B
  const visible = rsiArr.slice(startIdx)
  const N = visible.length
  if (N < 2) return

  const toX = (i: number) => PAD_L + (i / (N - 1)) * chartW
  const toY = (v: number) => PAD_T + (1 - (v - 0) / 100) * chartH

  const profit = resolveCSS('--tm-profit', '#22C759')
  const loss   = resolveCSS('--tm-loss',   '#FF3B30')
  const acc    = resolveCSS('--tm-accent', '#00E5FF')
  const muted  = resolveCSS('--tm-text-muted', '#545B7A')
  const bg2    = resolveCSS('--tm-bg-secondary', '#161B22')

  // ── Background zones ───────────────────────────────────────────────────
  // OB zone (70–100)
  ctx.fillStyle = 'rgba(255,59,48,0.06)'
  ctx.fillRect(PAD_L, toY(100), chartW, toY(70) - toY(100))

  // Neutral zone (30–70)
  ctx.fillStyle = 'rgba(255,255,255,0.02)'
  ctx.fillRect(PAD_L, toY(70), chartW, toY(30) - toY(70))

  // OS zone (0–30)
  ctx.fillStyle = 'rgba(34,199,89,0.06)'
  ctx.fillRect(PAD_L, toY(30), chartW, toY(0) - toY(30))

  // ── Level lines ─────────────────────────────────────────────────────────
  const levels = [70, 50, 30]
  levels.forEach(lv => {
    const y = toY(lv)
    ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R, y)
    ctx.strokeStyle = lv === 50 ? 'rgba(255,255,255,0.1)' : lv === 70 ? 'rgba(255,59,48,0.25)' : 'rgba(34,199,89,0.25)'
    ctx.lineWidth = lv === 50 ? 1 : 0.8
    ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([])
    // Labels
    ctx.fillStyle = muted; ctx.font = '9px JetBrains Mono, monospace'
    ctx.textAlign = 'right'; ctx.fillText(`${lv}`, PAD_L - 4, y + 3)
  })

  // ── RSI color fill (gradient: green below 50, red above) ────────────────
  const midY = toY(50)
  // Upper fill (RSI > 50 → red tint)
  const gradUp = ctx.createLinearGradient(0, toY(100), 0, midY)
  gradUp.addColorStop(0, 'rgba(255,59,48,0.25)')
  gradUp.addColorStop(1, 'rgba(255,59,48,0.0)')
  ctx.beginPath()
  ctx.moveTo(toX(0), midY)
  for (let i = 0; i < N; i++) {
    const y = Math.min(toY(visible[i]), midY)
    i === 0 ? ctx.moveTo(toX(i), y) : ctx.lineTo(toX(i), y)
  }
  ctx.lineTo(toX(N - 1), midY); ctx.closePath()
  ctx.fillStyle = gradUp; ctx.fill()

  // Lower fill (RSI < 50 → green tint)
  const gradDn = ctx.createLinearGradient(0, midY, 0, toY(0))
  gradDn.addColorStop(0, 'rgba(34,199,89,0.0)')
  gradDn.addColorStop(1, 'rgba(34,199,89,0.25)')
  ctx.beginPath()
  for (let i = 0; i < N; i++) {
    const y = Math.max(toY(visible[i]), midY)
    i === 0 ? ctx.moveTo(toX(i), y) : ctx.lineTo(toX(i), y)
  }
  ctx.lineTo(toX(N - 1), midY); ctx.lineTo(toX(0), midY); ctx.closePath()
  ctx.fillStyle = gradDn; ctx.fill()

  // ── RSI line ───────────────────────────────────────────────────────────
  ctx.beginPath()
  for (let i = 0; i < N; i++) {
    const x = toX(i), y = toY(visible[i])
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.strokeStyle = acc; ctx.lineWidth = 1.5; ctx.stroke()

  // ── RSI MA line ────────────────────────────────────────────────────────
  const maVisible = rsiMA.slice(startIdx)
  if (maVisible.length >= 2) {
    ctx.beginPath()
    let started = false
    for (let i = 0; i < maVisible.length && i < N; i++) {
      const v = maVisible[i]; if (!v || v === 0 || i < maLen - 1) continue
      const x = toX(i), y = toY(v)
      if (!started) { ctx.moveTo(x, y); started = true } else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = '#FFD700'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([])
  }

  // ── Divergence markers ─────────────────────────────────────────────────
  markers.forEach(m => {
    const localIdx = m.idx - startIdx
    if (localIdx < 0 || localIdx >= N) return
    const x = toX(localIdx)
    const rsiVal = rsiArr[m.idx]
    const y = m.type === 'bull' ? toY(rsiVal) + 10 : toY(rsiVal) - 10
    const color = m.type === 'bull' ? profit : loss
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2)
    ctx.fillStyle = color + 'CC'; ctx.fill()
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke()
    ctx.fillStyle = '#fff'; ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(m.type === 'bull' ? '▲' : '▼', x, y + 2.5)
  })

  // ── Current RSI value label ─────────────────────────────────────────────
  const lastRSI = visible[N - 1]
  if (lastRSI !== undefined) {
    const y = toY(lastRSI)
    const color = lastRSI > 70 ? loss : lastRSI < 30 ? profit : acc
    ctx.fillStyle = bg2; ctx.fillRect(W - PAD_R - 34, y - 9, 34, 14)
    ctx.fillStyle = color; ctx.font = 'bold 9px JetBrains Mono, monospace'
    ctx.textAlign = 'center'; ctx.fillText(lastRSI.toFixed(1), W - PAD_R - 17, y + 3)
  }

  // ── Time axis ──────────────────────────────────────────────────────────
  // (minimal — just show first and last ticks)
  ctx.fillStyle = muted; ctx.font = '8px sans-serif'; ctx.textAlign = 'center'
}

// ── Main component ──────────────────────────────────────────────────────────
export default function RsiEliteChart({ symbol: initialSymbol }: { symbol: string }) {
  const [symbol,   setSymbol]   = useState(initialSymbol)
  const [tf,       setTf]       = useState(TF_OPTIONS[1]) // 1H default
  const [maLen,    setMaLen]    = useState(14)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [rsi,      setRsi]      = useState<number[]>([])
  const [rsiMA,    setRsiMA]    = useState<number[]>([])
  const [markers,  setMarkers]  = useState<DivMarker[]>([])
  const [currRSI,  setCurrRSI]  = useState<number | null>(null)
  const [lastClose, setLastClose] = useState<number | null>(null)
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // ── Load data ─────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const candles = await fetchCandles(symbol, tf.interval, tf.limit)
      const closes  = candles.map(c => c.c)
      const rsiArr  = calcRSIArr(closes)
      const ma      = emaArr(rsiArr.slice(14).filter(v => !isNaN(v) && v > 0), maLen)
      const fullMA  = new Array(14).fill(0).concat(ma)
      const divs    = detectDivergenceMarkers(closes, rsiArr)
      setRsi(rsiArr); setRsiMA(fullMA); setMarkers(divs)
      setCurrRSI(rsiArr[rsiArr.length - 1] ?? null)
      setLastClose(closes[closes.length - 1] ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur de chargement')
    } finally { setLoading(false) }
  }, [symbol, tf, maLen])

  useEffect(() => { load() }, [load])
  useEffect(() => { setSymbol(initialSymbol) }, [initialSymbol])

  // ── Draw on canvas ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || rsi.length < 2) return
    const startIdx = Math.max(0, rsi.length - 120)
    drawRsiElite(canvas, rsi, rsiMA, markers, startIdx, maLen)
  }, [rsi, rsiMA, markers, maLen])

  // ── Resize observer ───────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ro = new ResizeObserver(() => {
      canvas.width  = container.clientWidth
      canvas.height = 220
      if (rsi.length >= 2) {
        const startIdx = Math.max(0, rsi.length - 120)
        drawRsiElite(canvas, rsi, rsiMA, markers, startIdx, maLen)
      }
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [rsi, rsiMA, markers, maLen])

  // ── RSI status ────────────────────────────────────────────────────────
  const rsiStatus = currRSI === null ? null
    : currRSI > 70 ? { label: 'Surachat', color: 'var(--tm-loss)' }
    : currRSI < 30 ? { label: 'Survente', color: 'var(--tm-profit)' }
    : currRSI > 55 ? { label: 'Haussier', color: 'var(--tm-profit)' }
    : currRSI < 45 ? { label: 'Baissier', color: 'var(--tm-loss)' }
    : { label: 'Neutre', color: 'var(--tm-text-muted)' }

  const bullDivs = markers.filter(m => m.type === 'bull').length
  const bearDivs = markers.filter(m => m.type === 'bear').length

  return (
    <div style={{ background: 'var(--tm-bg-secondary)', border: '1px solid #1E2330', borderRadius: 16, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, borderBottom: '1px solid #1E2330' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--tm-text-secondary)' }}>📉 RSI Elite</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--tm-accent)', fontFamily: 'JetBrains Mono, monospace' }}>{symbol}</span>
          {rsiStatus && (
            <span style={{ fontSize: 10, fontWeight: 700, color: rsiStatus.color, background: `${rsiStatus.color}18`, padding: '2px 8px', borderRadius: 8 }}>
              {currRSI?.toFixed(1)} · {rsiStatus.label}
            </span>
          )}
          {bullDivs > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--tm-profit)', background: 'rgba(34,199,89,0.12)', padding: '2px 8px', borderRadius: 8 }}>
              ↗ {bullDivs} div. bull
            </span>
          )}
          {bearDivs > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--tm-loss)', background: 'rgba(255,59,48,0.12)', padding: '2px 8px', borderRadius: 8 }}>
              ↘ {bearDivs} div. bear
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* MA length */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--tm-text-muted)' }}>MA</span>
            {[9, 14, 21].map(v => (
              <button key={v} onClick={() => setMaLen(v)} style={{
                padding: '2px 7px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${maLen === v ? '#FFD700' : 'var(--tm-border)'}`,
                background: maLen === v ? 'rgba(255,215,0,0.12)' : 'transparent',
                color: maLen === v ? '#FFD700' : 'var(--tm-text-muted)',
              }}>{v}</button>
            ))}
          </div>
          {/* Timeframe */}
          {TF_OPTIONS.map(t => (
            <button key={t.label} onClick={() => setTf(t)} style={{
              padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${tf.label === t.label ? 'var(--tm-accent)' : 'var(--tm-border)'}`,
              background: tf.label === t.label ? 'rgba(0,229,255,0.08)' : 'transparent',
              color: tf.label === t.label ? 'var(--tm-accent)' : 'var(--tm-text-muted)',
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div style={{ padding: '6px 16px', display: 'flex', gap: 16, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 16, height: 2, background: 'var(--tm-accent)', borderRadius: 1 }} />
          <span style={{ fontSize: 10, color: 'var(--tm-text-muted)' }}>RSI(14)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 16, height: 2, background: '#FFD700', borderRadius: 1, borderTop: '1px dashed #FFD700' }} />
          <span style={{ fontSize: 10, color: 'var(--tm-text-muted)' }}>MA({maLen})</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(34,199,89,0.8)', border: '1.5px solid #22C759' }} />
          <span style={{ fontSize: 10, color: 'var(--tm-text-muted)' }}>Div. Haussière</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(255,59,48,0.8)', border: '1.5px solid #FF3B30' }} />
          <span style={{ fontSize: 10, color: 'var(--tm-text-muted)' }}>Div. Baissière</span>
        </div>
      </div>

      {/* Canvas */}
      <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(13,17,23,0.7)', zIndex: 2 }}>
            <div style={{ width: 20, height: 20, border: '2px solid #2A2F3E', borderTopColor: 'var(--tm-accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          </div>
        )}
        {error && (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--tm-text-muted)', fontSize: 12 }}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>⚠️</div>
            {error}
          </div>
        )}
        <canvas ref={canvasRef} width={600} height={220} style={{ display: 'block', width: '100%', height: 220 }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  )
}
