// src/pages/analyse/FootprintChart.tsx — v4
// Professional footprint / cluster chart + trade bubbles
// TFs: 1m 3m 5m 15m 30m 1h 2h 4h 6h 12h 1d
// Bubbles: real-time WebSocket aggTrade + historical fetch
// Zoom/Pan: scroll=pan · Ctrl+scroll=zoom · Shift+scroll=binH · drag=pan XY

import React, { useState, useEffect, useRef, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────
interface FPCell      { buyVol: number; sellVol: number }
interface FPCandle    {
  open: number; high: number; low: number; close: number; ts: number
  levels: Map<number, FPCell>
  poc: number; candleDelta: number; totalVol: number
}
interface Tooltip     { x:number; y:number; price:number; buy:number; sell:number; delta:number; imbalance:string }
interface BubbleTrade { id:number; ts:number; price:number; vol:number; side:'buy'|'sell' }

// ── Constants ─────────────────────────────────────────────────────────────────
const TF_OPTIONS = ['1m','3m','5m','15m','30m','1h','2h','4h','6h','12h','1d'] as const
type TF = typeof TF_OPTIONS[number]

const SUB_TF: Record<TF, string | 'agg'> = {
  '1m':'agg', '3m':'1m', '5m':'1m', '15m':'1m',
  '30m':'3m', '1h':'5m', '2h':'15m', '4h':'15m',
  '6h':'30m', '12h':'1h', '1d':'4h',
}
// milliseconds per candle
const TF_MS: Record<TF, number> = {
  '1m':60_000,'3m':180_000,'5m':300_000,'15m':900_000,
  '30m':1_800_000,'1h':3_600_000,'2h':7_200_000,'4h':14_400_000,
  '6h':21_600_000,'12h':43_200_000,'1d':86_400_000,
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function snapBinSize(raw: number): number {
  const c = [0.01,0.05,0.1,0.25,0.5,1,2,5,10,20,25,50,100,200,250,500,1000,2000,5000]
  return c.find(v => v >= raw) ?? c[c.length-1]
}
function fmtVol(v: number): string {
  if (Math.abs(v)>=1e6) return `${(v/1e6).toFixed(1)}M`
  if (Math.abs(v)>=1e3) return `${(v/1e3).toFixed(0)}K`
  return v.toFixed(0)
}
function fmtPrice(p: number): string {
  return p>=10000 ? p.toFixed(0) : p>=100 ? p.toFixed(1) : p.toFixed(2)
}
function fmtTime(ts: number, tf: TF): string {
  const d = new Date(ts)
  if (tf==='1d')  return `${d.getDate()}/${d.getMonth()+1}`
  if (tf==='12h') return `${d.getDate()}/${d.getMonth()+1}`
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
}

// ── Sub-kline footprint builder ───────────────────────────────────────────────
function buildFromSubKlines(mainKlines:unknown[][], subKlines:unknown[][], binSize:number): FPCandle[] {
  return mainKlines.map(mk => {
    const openTime  = mk[0] as number
    const closeTime = mk[6] as number
    const open  = parseFloat(mk[1] as string)
    const high  = parseFloat(mk[2] as string)
    const low   = parseFloat(mk[3] as string)
    const close = parseFloat(mk[4] as string)
    const levels = new Map<number, FPCell>()
    let candleDelta = 0

    const mySubK = subKlines.filter(sk => {
      const t = sk[0] as number; return t >= openTime && t <= closeTime
    })

    if (mySubK.length === 0) {
      const buyVol  = parseFloat(mk[10] as string)
      const totVol  = parseFloat(mk[7] as string)
      const sellVol = Math.max(0, totVol - buyVol)
      const lo = Math.floor(low  / binSize) * binSize
      const hi = Math.ceil(high  / binSize) * binSize
      const bins: number[] = []
      let b = lo
      while (b <= hi + binSize*0.1) { bins.push(Math.round(b*1e8)/1e8); b = Math.round((b+binSize)*1e8)/1e8 }
      if (bins.length===0) bins.push(Math.round(Math.floor(close/binSize)*binSize*1e8)/1e8)
      const perBin = 1/bins.length
      for (const lvl of bins) levels.set(lvl, { buyVol: buyVol*perBin, sellVol: sellVol*perBin })
      candleDelta = buyVol - sellVol
    } else {
      for (const sk of mySubK) {
        const skH = parseFloat(sk[2] as string), skL = parseFloat(sk[3] as string)
        const skBuy = parseFloat(sk[10] as string)
        const skTot = parseFloat(sk[7] as string)
        const skSell = Math.max(0, skTot - skBuy)
        const skClose = parseFloat(sk[4] as string)
        const lo = Math.floor(skL/binSize)*binSize
        const hi = Math.ceil(skH/binSize)*binSize
        const bins: number[] = []
        let bl = lo
        while (bl <= hi+binSize*0.1) { bins.push(Math.round(bl*1e8)/1e8); bl = Math.round((bl+binSize)*1e8)/1e8 }
        if (bins.length===0) bins.push(Math.round(Math.floor((skH+skL)/2/binSize)*binSize*1e8)/1e8)
        const weights = bins.map(lvl => {
          const dist = Math.abs(lvl-skClose)/Math.max(skH-skL, binSize)
          return Math.exp(-dist*dist*2)
        })
        const wSum = weights.reduce((a,b)=>a+b, 0) || 1
        bins.forEach((lvl, i) => {
          if (!levels.has(lvl)) levels.set(lvl, { buyVol:0, sellVol:0 })
          const cell = levels.get(lvl)!
          const w = weights[i]/wSum
          cell.buyVol  += skBuy  * w
          cell.sellVol += skSell * w
        })
        candleDelta += skBuy - skSell
      }
    }
    let poc = close, pocVol = 0
    for (const [lvl, cell] of levels) {
      const tv = cell.buyVol+cell.sellVol
      if (tv>pocVol) { pocVol=tv; poc=lvl }
    }
    return { open, high, low, close, ts:openTime, levels, poc, candleDelta, totalVol: parseFloat(mk[5] as string)*close }
  })
}

// aggTrades footprint for 1m
function buildFromTrades(klines:unknown[][], trades:{p:string;q:string;m:boolean;T:number}[], binSize:number): FPCandle[] {
  return klines.map(k => {
    const openTime  = k[0] as number
    const closeTime = k[6] as number
    const levels = new Map<number, FPCell>()
    let candleDelta = 0
    for (const t of trades) {
      if (t.T<openTime || t.T>closeTime) continue
      const price = parseFloat(t.p), vol = price*parseFloat(t.q)
      const lvl = Math.round(Math.floor(price/binSize)*binSize*1e8)/1e8
      if (!levels.has(lvl)) levels.set(lvl, { buyVol:0, sellVol:0 })
      const cell = levels.get(lvl)!
      if (t.m) cell.sellVol+=vol; else cell.buyVol+=vol
      candleDelta += t.m ? -vol : vol
    }
    if (candleDelta===0) {
      const bv=parseFloat(k[10] as string), tv=parseFloat(k[7] as string)
      candleDelta = bv-(tv-bv)
    }
    if (levels.size===0) {
      const bv=parseFloat(k[10] as string), tv=parseFloat(k[7] as string)
      const close=parseFloat(k[4] as string), lvl=Math.round(Math.floor(close/binSize)*binSize*1e8)/1e8
      levels.set(lvl, { buyVol:bv, sellVol:Math.max(0,tv-bv) })
    }
    let poc=parseFloat(k[4] as string), pocVol=0
    for (const [lvl, cell] of levels) { const tv=cell.buyVol+cell.sellVol; if(tv>pocVol){pocVol=tv;poc=lvl} }
    return {
      open:parseFloat(k[1] as string), high:parseFloat(k[2] as string),
      low:parseFloat(k[3] as string),  close:parseFloat(k[4] as string),
      ts:openTime, levels, poc, candleDelta,
      totalVol: parseFloat(k[5] as string)*parseFloat(k[4] as string),
    }
  })
}

// ── Main Component ────────────────────────────────────────────────────────────
let _bubbleId = 0

export default function FootprintChart({ symbol }: { symbol: string }) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const crosshairRef = useRef<HTMLCanvasElement>(null)
  const wrapRef      = useRef<HTMLDivElement>(null)
  const dragRef      = useRef<{startX:number;startY:number;startOff:number;startPrice:number}|null>(null)
  const wsRef        = useRef<WebSocket|null>(null)

  const [tf,          setTf]         = useState<TF>('5m')
  const [allCandles,  setAllCandles] = useState<FPCandle[]>([])
  const [binSize,     setBinSize]    = useState(10)
  const [globalMax,   setGlobalMax]  = useState(1)
  const [loading,     setLoading]    = useState(false)
  const [error,       setError]      = useState('')
  const [lastFetch,   setLastFetch]  = useState(0)

  // View state
  const [viewOffset,  setViewOffset]  = useState(0)    // candles hidden from right
  const [zoomLevel,   setZoomLevel]   = useState(20)   // visible candle count
  const [priceOffset, setPriceOffset] = useState(0)    // Y center price
  const [cellH,       setCellH]       = useState(16)   // px per price bin

  // Bubbles
  const [showBubbles,     setShowBubbles]     = useState(true)
  const [bubbleThreshold, setBubbleThreshold] = useState(30_000) // min $30K
  const [bubbles,         setBubbles]         = useState<BubbleTrade[]>([])

  const [tooltip, setTooltip] = useState<Tooltip|null>(null)

  const IMBALANCE = 3.0
  const PRICE_W   = 74
  const DELTA_H   = 36
  const VP_W      = 68
  const MIN_ZOOM  = 3
  const MAX_ZOOM  = 80
  const BUFFER    = 100

  // ── Fetch footprint data ──────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!symbol) return
    setLoading(true); setError('')
    try {
      const klinesRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=${BUFFER}`)
      if (!klinesRes.ok) throw new Error(`HTTP ${klinesRes.status}`)
      const klines: unknown[][] = await klinesRes.json()
      if (!Array.isArray(klines) || klines.length===0) throw new Error('Aucune donnée')

      const allH = klines.map(k=>parseFloat(k[2] as string))
      const allL = klines.map(k=>parseFloat(k[3] as string))
      const bs = snapBinSize((Math.max(...allH)-Math.min(...allL))/30)
      setBinSize(bs)

      const startTime = klines[0][0] as number
      const endTime   = (klines[klines.length-1][6] as number) || Date.now()

      let fp: FPCandle[]
      let histBubbles: BubbleTrade[] = []

      if (tf==='1m') {
        const dur = endTime - startTime
        const chunk = Math.floor(dur/8)
        const batches = await Promise.all(
          Array.from({length:8}, (_,i) =>
            fetch(`https://api.binance.com/api/v3/aggTrades?symbol=${symbol}&startTime=${startTime+i*chunk}&limit=1000`)
              .then(r=>r.json()).catch(()=>[])
          )
        )
        const trades: {p:string;q:string;m:boolean;T:number;a:number}[] = []
        const seen = new Set<number>()
        for (const b of batches) {
          if (!Array.isArray(b)) continue
          for (const t of b as {a:number;p:string;q:string;m:boolean;T:number}[]) {
            if (!seen.has(t.a) && t.T>=startTime && t.T<=endTime) {
              seen.add(t.a); trades.push(t)
              // Collect bubble
              const price = parseFloat(t.p), vol = price*parseFloat(t.q)
              if (vol >= bubbleThreshold) {
                histBubbles.push({ id: ++_bubbleId, ts:t.T, price, vol, side: t.m?'sell':'buy' })
              }
            }
          }
        }
        fp = buildFromTrades(klines, trades, bs)
      } else {
        const subTf = SUB_TF[tf]
        const subRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${subTf}&startTime=${startTime}&limit=1000`)
        const subKlines: unknown[][] = subRes.ok ? await subRes.json() : []
        fp = buildFromSubKlines(klines, Array.isArray(subKlines)?subKlines:[], bs)
        // For non-1m, fetch recent aggTrades (last 5 candles) for historical bubbles
        const recentStart = klines[Math.max(0, klines.length-5)][0] as number
        try {
          const rtRes = await fetch(`https://api.binance.com/api/v3/aggTrades?symbol=${symbol}&startTime=${recentStart}&limit=1000`)
          const rtTrades = rtRes.ok ? await rtRes.json() : []
          if (Array.isArray(rtTrades)) {
            for (const t of rtTrades as {p:string;q:string;m:boolean;T:number;a:number}[]) {
              const price = parseFloat(t.p), vol = price*parseFloat(t.q)
              if (vol >= bubbleThreshold) {
                histBubbles.push({ id: ++_bubbleId, ts:t.T, price, vol, side: t.m?'sell':'buy' })
              }
            }
          }
        } catch {}
      }

      let gmax = 1
      for (const c of fp) {
        for (const cell of c.levels.values()) {
          const tv = cell.buyVol+cell.sellVol
          if (tv>gmax) gmax=tv
        }
      }
      setGlobalMax(gmax)
      setAllCandles(fp)
      setViewOffset(0)
      // Merge historical bubbles (keep last 2000 unique)
      setBubbles(prev => {
        const existIds = new Set(histBubbles.map(b=>b.id))
        const merged = [...prev.filter(b=>!existIds.has(b.id)), ...histBubbles]
        return merged.slice(-2000)
      })
      if (fp.length>0) {
        const last = fp[fp.length-1]
        setPriceOffset((last.high+last.low)/2)
      }
      setLastFetch(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau')
    } finally {
      setLoading(false)
    }
  }, [symbol, tf, bubbleThreshold])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { const t=setInterval(fetchData, 30_000); return ()=>clearInterval(t) }, [fetchData])

  // ── Real-time bubble WebSocket ────────────────────────────────────────────
  useEffect(() => {
    if (!symbol) return
    const sym = symbol.toLowerCase()
    // Close previous
    if (wsRef.current) { wsRef.current.close(); wsRef.current=null }
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${sym}@aggTrade`)
    wsRef.current = ws
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data)
        const price = parseFloat(d.p)
        const qty   = parseFloat(d.q)
        const vol   = price * qty
        if (vol < bubbleThreshold) return
        const bubble: BubbleTrade = { id: ++_bubbleId, ts: d.T as number, price, vol, side: d.m?'sell':'buy' }
        setBubbles(prev => prev.length > 2000 ? [...prev.slice(-1800), bubble] : [...prev, bubble])
      } catch {}
    }
    ws.onerror = () => {}
    return () => { ws.close(); wsRef.current=null }
  }, [symbol, bubbleThreshold])

  // ── Visible candles ───────────────────────────────────────────────────────
  const visibleCandles = (() => {
    const end   = allCandles.length - viewOffset
    const start = Math.max(0, end - zoomLevel)
    return allCandles.slice(start, end)
  })()

  // ── Canvas draw ────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const wrap   = wrapRef.current
    if (!canvas || !wrap || visibleCandles.length===0) return
    const dpr = window.devicePixelRatio || 1
    const W = wrap.offsetWidth || 800
    const H = wrap.offsetHeight || 500
    canvas.width  = W*dpr; canvas.height = H*dpr
    canvas.style.width  = `${W}px`; canvas.style.height = `${H}px`
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    const chartH   = H - DELTA_H
    const visLevels = Math.floor(chartH / cellH)
    const halfPH   = (visLevels/2) * binSize
    const priceTop = priceOffset + halfPH
    const priceBot = priceOffset - halfPH
    const toY = (p:number) => chartH - ((p-priceBot)/(priceTop-priceBot)) * chartH
    const cW  = (W - PRICE_W - VP_W) / visibleCandles.length

    // Background
    ctx.fillStyle = '#080C14'; ctx.fillRect(0, 0, W, H)

    // Grid
    ctx.setLineDash([])
    let gLvl = Math.floor(priceBot/binSize)*binSize
    while (gLvl <= priceTop+binSize) {
      const gy = Math.round(toY(gLvl))+0.5
      if (gy>=0 && gy<=chartH) {
        ctx.strokeStyle='rgba(255,255,255,0.035)'; ctx.lineWidth=0.5
        ctx.beginPath(); ctx.moveTo(PRICE_W,gy); ctx.lineTo(W-VP_W,gy); ctx.stroke()
      }
      gLvl = Math.round((gLvl+binSize)*1e8)/1e8
    }

    // ── Volume Profile ───────────────────────────────────────────────────
    const vpMap = new Map<number, {buy:number;sell:number}>()
    let vpMax=1, globalPOC=0, globalPOCvol=0
    for (const c of visibleCandles) {
      for (const [lvl, cell] of c.levels) {
        if (!vpMap.has(lvl)) vpMap.set(lvl, {buy:0,sell:0})
        const vp = vpMap.get(lvl)!
        vp.buy+=cell.buyVol; vp.sell+=cell.sellVol
        const tv=vp.buy+vp.sell
        if (tv>vpMax) vpMax=tv
        if (tv>globalPOCvol) { globalPOCvol=tv; globalPOC=lvl }
      }
    }
    for (const [lvl, vp] of vpMap) {
      if (lvl<priceBot || lvl>priceTop+binSize) continue
      const y  = toY(lvl+binSize*0.5)
      const tv = vp.buy+vp.sell
      const bw = (tv/vpMax)*(VP_W-6)
      const isG= Math.abs(lvl-globalPOC)<binSize*0.5
      ctx.fillStyle = isG ? 'rgba(255,159,28,0.5)' : vp.buy>vp.sell ? 'rgba(52,199,89,0.20)' : 'rgba(255,69,58,0.20)'
      ctx.fillRect(W-VP_W+2, y-cellH*0.45, bw, cellH*0.9)
      if (isG) { ctx.fillStyle='rgba(255,159,28,0.08)'; ctx.fillRect(W-VP_W, y-cellH*0.5, VP_W, cellH*0.9) }
    }
    ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.lineWidth=1
    ctx.beginPath(); ctx.moveTo(W-VP_W,0); ctx.lineTo(W-VP_W,chartH); ctx.stroke()
    ctx.fillStyle='rgba(255,255,255,0.2)'; ctx.font='8px JetBrains Mono,monospace'; ctx.textAlign='center'
    ctx.fillText('VP', W-VP_W/2, 9)

    // ── Candles ──────────────────────────────────────────────────────────
    visibleCandles.forEach((c, ci) => {
      const x = PRICE_W + ci*cW
      const isBull = c.close >= c.open

      // Body bg
      const yO=toY(c.open), yC=toY(c.close)
      const bodyT=Math.min(yO,yC), bodyB=Math.max(yO,yC)
      ctx.fillStyle = isBull ? 'rgba(52,199,89,0.05)' : 'rgba(255,69,58,0.05)'
      ctx.fillRect(x+1, bodyT, cW-2, bodyB-bodyT)

      // Wick
      const wickX = x+cW/2
      ctx.strokeStyle = isBull ? 'rgba(52,199,89,0.5)' : 'rgba(255,69,58,0.5)'
      ctx.lineWidth=1; ctx.setLineDash([])
      ctx.beginPath(); ctx.moveTo(wickX, toY(c.high)); ctx.lineTo(wickX, bodyT); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(wickX, bodyB);       ctx.lineTo(wickX, toY(c.low));  ctx.stroke()

      // Column separator
      ctx.strokeStyle='rgba(255,255,255,0.04)'; ctx.lineWidth=0.5
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,chartH); ctx.stroke()

      // Cells
      let lvl = Math.floor(c.low/binSize)*binSize
      while (lvl <= c.high+binSize*0.1) {
        const lvlR = Math.round(lvl*1e8)/1e8
        const cellY = toY(lvlR+binSize*0.5) - cellH*0.5
        if (cellY+cellH>=0 && cellY<=chartH) {
          const cell   = c.levels.get(lvlR)
          const isPOC  = Math.abs(lvlR-c.poc)<binSize*0.5
          const isGPOC = Math.abs(lvlR-globalPOC)<binSize*0.5

          if (cell) {
            const total = cell.buyVol+cell.sellVol
            const intensity = Math.min(total/globalMax, 1)
            const buyRatio  = total>0 ? cell.buyVol/total : 0.5
            const isBD = cell.buyVol > cell.sellVol*IMBALANCE
            const isSD = cell.sellVol > cell.buyVol*IMBALANCE

            // Cell background
            if (isBD) {
              ctx.fillStyle = `rgba(52,199,89,${0.18+intensity*0.52})`
            } else if (isSD) {
              ctx.fillStyle = `rgba(255,69,58,${0.18+intensity*0.52})`
            } else if (buyRatio>0.55) {
              ctx.fillStyle = `rgba(52,199,89,${0.04+(buyRatio-0.5)*intensity*0.55})`
            } else if (buyRatio<0.45) {
              ctx.fillStyle = `rgba(255,69,58,${0.04+(0.5-buyRatio)*intensity*0.55})`
            } else {
              ctx.fillStyle = `rgba(90,95,115,${0.05+intensity*0.10})`
            }
            ctx.fillRect(x+0.5, cellY, cW-1, cellH-0.5)

            // POC
            if (isPOC) {
              ctx.fillStyle='rgba(255,159,28,0.07)'
              ctx.fillRect(x, cellY, cW, cellH)
              ctx.strokeStyle='rgba(255,159,28,0.9)'; ctx.lineWidth=1.2
              ctx.setLineDash([2,2])
              ctx.strokeRect(x+1, cellY+0.5, cW-2, cellH-1)
              ctx.setLineDash([])
            }
            if (isGPOC) {
              ctx.fillStyle='rgba(255,159,28,0.05)'
              ctx.fillRect(x, cellY, cW, cellH)
            }

            // Imbalance triangle
            if (cW>=40) {
              if (isBD) {
                ctx.fillStyle='rgba(52,199,89,0.92)'
                ctx.beginPath(); ctx.moveTo(x+cW-3,cellY+cellH/2); ctx.lineTo(x+cW-9,cellY+3); ctx.lineTo(x+cW-9,cellY+cellH-3); ctx.closePath(); ctx.fill()
              } else if (isSD) {
                ctx.fillStyle='rgba(255,69,58,0.92)'
                ctx.beginPath(); ctx.moveTo(x+3,cellY+cellH/2); ctx.lineTo(x+9,cellY+3); ctx.lineTo(x+9,cellY+cellH-3); ctx.closePath(); ctx.fill()
              }
            }

            // Text
            if (cellH>=13 && cW>=55) {
              const fs = Math.max(7, Math.min(10, cellH-4))
              ctx.font = `${fs}px JetBrains Mono,monospace`
              ctx.fillStyle = isBD ? 'rgba(52,199,89,1)' : `rgba(52,199,89,${0.55+buyRatio*0.45})`
              ctx.textAlign='left'
              ctx.fillText(fmtVol(cell.buyVol), x+4, cellY+cellH*0.67)
              ctx.fillStyle='rgba(255,255,255,0.18)'; ctx.textAlign='center'
              ctx.fillText('|', x+cW/2, cellY+cellH*0.67)
              ctx.fillStyle = isSD ? 'rgba(255,69,58,1)' : `rgba(255,69,58,${0.55+(1-buyRatio)*0.45})`
              ctx.textAlign='right'
              ctx.fillText(fmtVol(cell.sellVol), x+cW-(isBD?12:4), cellY+cellH*0.67)
            }
          } else {
            ctx.strokeStyle='rgba(255,255,255,0.02)'; ctx.lineWidth=0.5
            ctx.beginPath(); ctx.moveTo(x+2, cellY+cellH/2); ctx.lineTo(x+cW-2, cellY+cellH/2); ctx.stroke()
          }
        }
        lvl = Math.round((lvl+binSize)*1e8)/1e8
      }

      // Delta bar
      const delta  = c.candleDelta
      const maxAbs = visibleCandles.reduce((m,cc)=>Math.max(m,Math.abs(cc.candleDelta)), 1)
      const bH     = Math.abs(delta/maxAbs)*(DELTA_H-10)
      const bY     = delta>=0 ? chartH+DELTA_H-5-bH : chartH+DELTA_H-5
      ctx.fillStyle = delta>=0 ? 'rgba(52,199,89,0.75)' : 'rgba(255,69,58,0.75)'
      ctx.fillRect(x+1, bY, cW-2, bH)
      if (cW>=38 && DELTA_H>=24) {
        ctx.font='7px JetBrains Mono,monospace'; ctx.textAlign='center'
        ctx.fillStyle = delta>=0 ? '#34C759' : '#FF453A'
        ctx.fillText((delta>=0?'+':'')+fmtVol(delta), x+cW/2, chartH+DELTA_H-3)
      }

      // Time label
      if (cW>=35) {
        ctx.font='7px JetBrains Mono,monospace'
        ctx.fillStyle='rgba(255,255,255,0.25)'; ctx.textAlign='center'
        ctx.fillText(fmtTime(c.ts, tf), x+cW/2, chartH-3)
      }
    })

    // ── Trade bubbles ────────────────────────────────────────────────────
    if (showBubbles && bubbles.length>0 && visibleCandles.length>0) {
      const tfDuration = TF_MS[tf]
      const visStart = visibleCandles[0].ts
      const visEnd   = visibleCandles[visibleCandles.length-1].ts + tfDuration

      for (const b of bubbles) {
        if (b.ts < visStart || b.ts > visEnd) continue
        // Find candle index
        const ci = visibleCandles.findIndex(c => b.ts >= c.ts && b.ts < c.ts + tfDuration)
        if (ci < 0) continue
        const c = visibleCandles[ci]
        // X: position within the candle proportional to timestamp
        const posW = Math.min((b.ts - c.ts) / tfDuration, 1)
        const bx = PRICE_W + ci*cW + posW*cW
        const by = toY(b.price)
        if (by<-30 || by>chartH+30) continue

        // Radius scaled by volume
        const r = Math.min(Math.max(Math.sqrt(b.vol/bubbleThreshold)*4.5, 3), 28)
        const isBuy = b.side==='buy'
        const alpha = Math.min(0.35 + (b.vol/bubbleThreshold-1)*0.04, 0.80)

        // Shadow glow for big bubbles
        if (r>12) {
          ctx.shadowColor = isBuy ? 'rgba(52,199,89,0.4)' : 'rgba(255,69,58,0.4)'
          ctx.shadowBlur  = r * 0.8
        }
        // Fill
        ctx.fillStyle = isBuy ? `rgba(52,199,89,${alpha})` : `rgba(255,69,58,${alpha})`
        ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI*2); ctx.fill()
        // Ring
        ctx.shadowBlur = 0
        ctx.strokeStyle = isBuy ? `rgba(52,199,89,${Math.min(alpha+0.2,1)})` : `rgba(255,69,58,${Math.min(alpha+0.2,1)})`
        ctx.lineWidth = 0.8
        ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI*2); ctx.stroke()
        // Volume label for big bubbles
        if (r>=14 && cW>=30) {
          ctx.fillStyle = 'rgba(255,255,255,0.9)'
          ctx.font = `bold ${Math.round(r*0.55)}px JetBrains Mono,monospace`
          ctx.textAlign = 'center'
          ctx.fillText(fmtVol(b.vol), bx, by+r*0.2)
        }
      }
      ctx.shadowBlur = 0
    }

    // ── Price axis ────────────────────────────────────────────────────────
    ctx.fillStyle='#080C14'; ctx.fillRect(0,0,PRICE_W,H)
    ctx.strokeStyle='rgba(255,255,255,0.06)'; ctx.lineWidth=1
    ctx.beginPath(); ctx.moveTo(PRICE_W,0); ctx.lineTo(PRICE_W,chartH); ctx.stroke()

    let pLvl = Math.floor(priceBot/binSize)*binSize
    while (pLvl <= priceTop+binSize) {
      const py = Math.round(toY(pLvl))+0.5
      if (py>=2 && py<=chartH-2) {
        ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.font='9px JetBrains Mono,monospace'; ctx.textAlign='right'
        ctx.fillText(fmtPrice(pLvl), PRICE_W-5, py+3)
        ctx.strokeStyle='rgba(255,255,255,0.08)'; ctx.lineWidth=0.5
        ctx.beginPath(); ctx.moveTo(PRICE_W-3,py); ctx.lineTo(PRICE_W,py); ctx.stroke()
      }
      pLvl = Math.round((pLvl+binSize)*1e8)/1e8
    }

    // Separator + delta label
    ctx.strokeStyle='rgba(255,255,255,0.07)'; ctx.lineWidth=1; ctx.setLineDash([])
    ctx.beginPath(); ctx.moveTo(0,chartH); ctx.lineTo(W,chartH); ctx.stroke()
    ctx.fillStyle='rgba(255,255,255,0.2)'; ctx.font='8px JetBrains Mono,monospace'; ctx.textAlign='left'
    ctx.fillText('Δ', 4, chartH+14)

    // Nav hint
    if (allCandles.length>0 && viewOffset>0) {
      ctx.fillStyle='rgba(255,255,255,0.3)'; ctx.font='8px JetBrains Mono,monospace'; ctx.textAlign='left'
      ctx.fillText(`◀ ${viewOffset} bougies cachées`, PRICE_W+4, 11)
    }
  }, [visibleCandles, binSize, globalMax, priceOffset, cellH, tf, allCandles.length, viewOffset, showBubbles, bubbles, bubbleThreshold])

  useEffect(() => { draw() }, [draw])
  useEffect(() => {
    const obs = new ResizeObserver(() => draw())
    if (wrapRef.current) obs.observe(wrapRef.current)
    return () => obs.disconnect()
  }, [draw])

  // ── Crosshair overlay ─────────────────────────────────────────────────────
  const drawCrosshair = useCallback((mx:number, my:number) => {
    const canvas = crosshairRef.current
    const wrap   = wrapRef.current
    if (!canvas || !wrap) return
    const dpr = window.devicePixelRatio || 1
    const W = wrap.offsetWidth, H = wrap.offsetHeight
    const chartH = H - DELTA_H
    canvas.width  = W*dpr; canvas.height = H*dpr
    canvas.style.width  = `${W}px`; canvas.style.height = `${H}px`
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, W, H)
    if (mx<PRICE_W || mx>W-VP_W || my<0 || my>chartH) return

    const visLevels = Math.floor(chartH/cellH)
    const halfPH    = (visLevels/2)*binSize
    const priceBot  = priceOffset-halfPH, priceTop = priceOffset+halfPH
    const hoveredP  = priceBot+((chartH-my)/chartH)*(priceTop-priceBot)
    const snapPrice = Math.round(Math.floor(hoveredP/binSize)*binSize*1e8)/1e8
    const snapY     = chartH-((snapPrice+binSize/2-priceBot)/(priceTop-priceBot))*chartH

    ctx.strokeStyle='rgba(255,255,255,0.22)'; ctx.lineWidth=0.75; ctx.setLineDash([5,5])
    ctx.beginPath(); ctx.moveTo(PRICE_W,snapY); ctx.lineTo(W-VP_W,snapY); ctx.stroke()
    ctx.setLineDash([])

    if (visibleCandles.length>0) {
      const cW = (W-PRICE_W-VP_W)/visibleCandles.length
      const ci = Math.floor((mx-PRICE_W)/cW)
      if (ci>=0 && ci<visibleCandles.length) {
        const colX = PRICE_W+ci*cW
        ctx.fillStyle='rgba(255,255,255,0.028)'; ctx.fillRect(colX,0,cW,chartH)
        ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.setLineDash([5,5])
        ctx.beginPath(); ctx.moveTo(colX+cW/2,0); ctx.lineTo(colX+cW/2,chartH); ctx.stroke()
        ctx.setLineDash([])
      }
    }
    ctx.fillStyle='rgba(255,159,28,0.92)'; ctx.fillRect(1,snapY-9,PRICE_W-2,18)
    ctx.fillStyle='#080C14'; ctx.font='bold 9px JetBrains Mono,monospace'; ctx.textAlign='center'
    ctx.fillText(fmtPrice(snapPrice), PRICE_W/2, snapY+3.5)
  }, [visibleCandles, priceOffset, binSize, cellH])

  const clearCrosshair = useCallback(() => {
    const cv = crosshairRef.current
    if (cv) cv.getContext('2d')?.clearRect(0,0,cv.width,cv.height)
  }, [])

  const centerOnPrice = useCallback(() => {
    if (allCandles.length===0) return
    const end = allCandles.length-viewOffset
    const slice = allCandles.slice(Math.max(0,end-zoomLevel), end)
    if (slice.length===0) return
    setPriceOffset((Math.max(...slice.map(c=>c.high))+Math.min(...slice.map(c=>c.low)))/2)
  }, [allCandles, viewOffset, zoomLevel])

  // ── Interactions ──────────────────────────────────────────────────────────
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { mx: e.clientX-r.left, my: e.clientY-r.top }
  }

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const H = wrapRef.current?.offsetHeight || 500
    const chartH = H - DELTA_H

    if (e.ctrlKey || e.metaKey) {
      // Ctrl+Scroll = horizontal zoom (candle count) — centered on cursor
      const delta = e.deltaY > 0 ? 3 : -3
      setZoomLevel(prev => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev+delta)))
    } else if (e.shiftKey) {
      // Shift+Scroll = bin height (vertical zoom)
      setCellH(prev => Math.max(10, Math.min(36, prev+(e.deltaY>0?-1:1))))
    } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)*0.5) {
      // Trackpad horizontal swipe = time pan
      const dir = e.deltaX>0 ? 1 : -1
      setViewOffset(prev => Math.max(0, Math.min(allCandles.length-MIN_ZOOM, prev+dir*Math.ceil(zoomLevel/12))))
    } else {
      // Plain vertical scroll = horizontal time pan (like TradingView)
      const dir = e.deltaY>0 ? 1 : -1
      setViewOffset(prev => Math.max(0, Math.min(allCandles.length-MIN_ZOOM, prev+dir)))
      // Alt+scroll = vertical price pan (if Alt held)
      if (e.altKey) {
        const pricePerPx = (2*(Math.floor(chartH/cellH)/2)*binSize)/chartH
        setPriceOffset(prev => prev+e.deltaY*pricePerPx*0.8)
      }
    }
  }, [allCandles.length, zoomLevel, binSize, cellH])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const {mx,my} = getCanvasCoords(e)
    dragRef.current = { startX:mx, startY:my, startOff:viewOffset, startPrice:priceOffset }
  }, [viewOffset, priceOffset])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const {mx,my} = getCanvasCoords(e)
    const W = canvasRef.current?.offsetWidth || 800
    const H = wrapRef.current?.offsetHeight || 500
    const chartH = H - DELTA_H

    if (dragRef.current && e.buttons===1) {
      const {startX,startY,startOff,startPrice} = dragRef.current
      if (visibleCandles.length>0 && W-PRICE_W-VP_W>0) {
        const cW = (W-PRICE_W-VP_W)/visibleCandles.length
        setViewOffset(Math.max(0, Math.min(allCandles.length-MIN_ZOOM, Math.round(startOff+(startX-mx)/cW))))
      }
      const pricePerPx = (2*(Math.floor(chartH/cellH)/2)*binSize)/chartH
      setPriceOffset(startPrice-(my-startY)*pricePerPx)
      return
    }

    drawCrosshair(mx, my)

    if (mx<PRICE_W || mx>W-VP_W || my>chartH) { setTooltip(null); return }
    if (visibleCandles.length===0) return
    const cW = (W-PRICE_W-VP_W)/visibleCandles.length
    const ci = Math.floor((mx-PRICE_W)/cW)
    if (ci<0 || ci>=visibleCandles.length) { setTooltip(null); return }

    const c = visibleCandles[ci]
    const halfPH = (Math.floor(chartH/cellH)/2)*binSize
    const priceBot = priceOffset-halfPH, priceTop = priceOffset+halfPH
    const hoveredP = priceBot+((chartH-my)/chartH)*(priceTop-priceBot)
    const binLvl = Math.round(Math.floor(hoveredP/binSize)*binSize*1e8)/1e8

    let closest:number|null=null, minDist=Infinity
    for (const lvl of c.levels.keys()) { const d=Math.abs(lvl-binLvl); if(d<minDist){minDist=d;closest=lvl} }
    if (closest===null || !c.levels.has(closest)) { setTooltip(null); return }
    const cell = c.levels.get(closest)!
    const ratio = cell.sellVol>0 ? (cell.buyVol/cell.sellVol).toFixed(1) : '∞'
    const imb = cell.buyVol>cell.sellVol*IMBALANCE ? `▲ Buy ×${ratio}`
      : cell.sellVol>cell.buyVol*IMBALANCE ? `▼ Sell ×${(cell.sellVol/Math.max(cell.buyVol,1)).toFixed(1)}`
      : 'Équilibre'
    setTooltip({ x:mx, y:my, price:closest, buy:cell.buyVol, sell:cell.sellVol, delta:cell.buyVol-cell.sellVol, imbalance:imb })
  }, [visibleCandles, priceOffset, binSize, cellH, allCandles.length, drawCrosshair])

  const handleMouseUp = useCallback(() => { dragRef.current=null }, [])

  const elapsed = Math.round((Date.now()-lastFetch)/1000)

  // Bubble threshold labels
  const THRESHOLDS = [10_000,30_000,50_000,100_000,250_000,500_000]
  const fmtThresh = (v:number) => v>=1_000_000 ? `$${v/1_000_000}M` : `$${v/1_000}K`

  return (
    <div style={{ background:'rgba(8,12,22,0.95)', backdropFilter:'blur(12px)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:16, overflow:'hidden', display:'flex', flexDirection:'column', height:'100%' }}>

      {/* ── Toolbar ── */}
      <div style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 12px', borderBottom:'1px solid rgba(255,255,255,0.05)', flexWrap:'wrap', flexShrink:0 }}>
        {/* Icon */}
        <div style={{ display:'flex', alignItems:'center', gap:7, marginRight:4 }}>
          <div style={{ width:26, height:26, borderRadius:7, background:'linear-gradient(135deg,rgba(255,159,28,0.22),rgba(255,69,58,0.18))', border:'1px solid rgba(255,159,28,0.35)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF9F1C" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>
          </div>
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:'#fff', fontFamily:'Syne,sans-serif', lineHeight:1 }}>Footprint</div>
            <div style={{ fontSize:8, color:'rgba(255,159,28,0.7)', fontFamily:'JetBrains Mono,monospace' }}>{symbol}</div>
          </div>
        </div>

        {/* TF */}
        <div style={{ display:'flex', gap:2, flexWrap:'wrap' }}>
          {TF_OPTIONS.map(t => (
            <button key={t} onClick={()=>setTf(t)} style={{ padding:'2px 7px', borderRadius:14, fontSize:9, fontWeight:600, cursor:'pointer', transition:'all 0.15s', border:`1px solid ${t===tf?'rgba(255,159,28,0.55)':'rgba(255,255,255,0.08)'}`, background:t===tf?'rgba(255,159,28,0.14)':'transparent', color:t===tf?'#FF9F1C':'rgba(255,255,255,0.35)' }}>{t}</button>
          ))}
        </div>

        {/* Zoom */}
        <div style={{ display:'flex', alignItems:'center', gap:3, padding:'2px 7px', background:'rgba(255,255,255,0.04)', borderRadius:8, border:'1px solid rgba(255,255,255,0.07)' }}>
          <button onClick={()=>setZoomLevel(z=>Math.max(MIN_ZOOM,z-5))} style={{ width:20,height:20,border:'none',borderRadius:3,background:'transparent',cursor:'pointer',color:'rgba(255,255,255,0.5)',fontSize:14,lineHeight:1 }}>+</button>
          <span style={{ fontSize:9,color:'rgba(255,255,255,0.35)',fontFamily:'JetBrains Mono,monospace',minWidth:28,textAlign:'center' }}>{zoomLevel}C</span>
          <button onClick={()=>setZoomLevel(z=>Math.min(MAX_ZOOM,z+5))} style={{ width:20,height:20,border:'none',borderRadius:3,background:'transparent',cursor:'pointer',color:'rgba(255,255,255,0.5)',fontSize:14,lineHeight:1 }}>−</button>
        </div>

        {/* Pan */}
        <div style={{ display:'flex',alignItems:'center',gap:2 }}>
          <button onClick={()=>setViewOffset(v=>Math.min(allCandles.length-MIN_ZOOM,v+Math.ceil(zoomLevel/2)))} style={{ padding:'2px 9px',borderRadius:7,border:'1px solid rgba(255,255,255,0.08)',background:'transparent',cursor:'pointer',color:'rgba(255,255,255,0.4)',fontSize:12 }}>◀</button>
          <button onClick={()=>setViewOffset(0)} style={{ padding:'2px 8px',borderRadius:7,border:'1px solid rgba(255,255,255,0.08)',background:viewOffset===0?'rgba(0,229,255,0.08)':'transparent',cursor:'pointer',color:viewOffset===0?'#00E5FF':'rgba(255,255,255,0.4)',fontSize:9,fontFamily:'JetBrains Mono,monospace' }}>LIVE</button>
          <button onClick={()=>setViewOffset(v=>Math.max(0,v-Math.ceil(zoomLevel/2)))} style={{ padding:'2px 9px',borderRadius:7,border:'1px solid rgba(255,255,255,0.08)',background:'transparent',cursor:'pointer',color:'rgba(255,255,255,0.4)',fontSize:12 }}>▶</button>
        </div>

        {/* Center + Bin */}
        <button onClick={centerOnPrice} title="Centrer" style={{ padding:'2px 9px',borderRadius:7,border:'1px solid rgba(0,229,255,0.2)',background:'rgba(0,229,255,0.05)',cursor:'pointer',color:'rgba(0,229,255,0.55)',fontSize:11 }}>⊙</button>

        <div style={{ display:'flex',alignItems:'center',gap:2 }}>
          <span style={{ fontSize:8,color:'rgba(255,255,255,0.25)',fontFamily:'JetBrains Mono' }}>BIN</span>
          <button onClick={()=>setCellH(h=>Math.max(10,h-2))} style={{ width:17,height:17,border:'1px solid rgba(255,255,255,0.08)',borderRadius:4,background:'transparent',cursor:'pointer',color:'rgba(255,255,255,0.4)',fontSize:11,lineHeight:1 }}>−</button>
          <span style={{ fontSize:8,color:'rgba(255,255,255,0.35)',fontFamily:'JetBrains Mono,monospace',minWidth:20,textAlign:'center' }}>{cellH}</span>
          <button onClick={()=>setCellH(h=>Math.min(36,h+2))} style={{ width:17,height:17,border:'1px solid rgba(255,255,255,0.08)',borderRadius:4,background:'transparent',cursor:'pointer',color:'rgba(255,255,255,0.4)',fontSize:11,lineHeight:1 }}>+</button>
        </div>

        {/* Bubble controls */}
        <div style={{ display:'flex',alignItems:'center',gap:4,padding:'2px 8px',background:showBubbles?'rgba(0,229,255,0.07)':'rgba(255,255,255,0.03)',borderRadius:8,border:`1px solid ${showBubbles?'rgba(0,229,255,0.25)':'rgba(255,255,255,0.07)'}`,cursor:'pointer' }} onClick={()=>setShowBubbles(v=>!v)}>
          <div style={{ width:8,height:8,borderRadius:'50%',background:showBubbles?'#00E5FF':'rgba(255,255,255,0.2)',boxShadow:showBubbles?'0 0 6px rgba(0,229,255,0.7)':'none' }}/>
          <span style={{ fontSize:9,fontWeight:600,color:showBubbles?'#00E5FF':'rgba(255,255,255,0.3)',fontFamily:'JetBrains Mono,monospace' }}>BULLES</span>
        </div>
        {showBubbles && (
          <select value={bubbleThreshold} onChange={e=>setBubbleThreshold(Number(e.target.value))}
            style={{ fontSize:9,fontFamily:'JetBrains Mono,monospace',background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:6,color:'rgba(255,255,255,0.5)',padding:'2px 4px',cursor:'pointer' }}>
            {THRESHOLDS.map(v=><option key={v} value={v}>{fmtThresh(v)}</option>)}
          </select>
        )}
        {showBubbles && bubbles.length>0 && (
          <span style={{ fontSize:8,color:'rgba(0,229,255,0.5)',fontFamily:'JetBrains Mono,monospace' }}>{bubbles.length}b</span>
        )}

        {/* Status */}
        <div style={{ marginLeft:'auto',display:'flex',alignItems:'center',gap:6 }}>
          {loading && <div style={{ width:10,height:10,border:'2px solid rgba(255,255,255,0.1)',borderTopColor:'#FF9F1C',borderRadius:'50%',animation:'spin 0.7s linear infinite' }}/>}
          {!loading && <span style={{ fontSize:8,color:'rgba(255,255,255,0.22)',fontFamily:'JetBrains Mono,monospace' }}>{elapsed}s · ×{binSize} · {allCandles.length}C</span>}
          <button onClick={fetchData} disabled={loading} style={{ padding:'2px 8px',borderRadius:6,border:'1px solid rgba(255,255,255,0.08)',background:'rgba(255,255,255,0.03)',cursor:'pointer',fontSize:11,color:'rgba(255,255,255,0.4)' }}>↻</button>
        </div>
      </div>

      {/* ── Legend ── */}
      <div style={{ display:'flex',gap:8,padding:'3px 12px',borderBottom:'1px solid rgba(255,255,255,0.04)',flexWrap:'wrap',flexShrink:0,alignItems:'center' }}>
        {[['rgba(52,199,89,0.7)','Buy'],['rgba(255,69,58,0.7)','Sell'],['rgba(255,159,28,0.9)','POC'],['rgba(52,199,89,1)','▲ ×3'],['rgba(255,69,58,1)','▼ ×3'],['rgba(0,229,255,0.7)','● Bulle buy'],['rgba(255,100,80,0.7)','● Bulle sell']].map(([c,l])=>(
          <div key={l} style={{ display:'flex',alignItems:'center',gap:3 }}>
            <div style={{ width:7,height:7,borderRadius:'50%',background:c }}/>
            <span style={{ fontSize:7,color:'rgba(255,255,255,0.28)',fontFamily:'JetBrains Mono,monospace' }}>{l}</span>
          </div>
        ))}
        <span style={{ fontSize:7,color:'rgba(255,255,255,0.18)',marginLeft:'auto' }}>Scroll=pan · Ctrl+Scroll=zoom · Shift+Scroll=bin · Drag=pan · Alt+Scroll=prix</span>
      </div>

      {/* ── Canvas area ── */}
      <div ref={wrapRef} style={{ flex:1,position:'relative',minHeight:360,cursor:dragRef.current?'grabbing':'crosshair' }}>
        {error && (
          <div style={{ position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:10 }}>
            <span style={{ fontSize:22 }}>📡</span>
            <span style={{ fontSize:11,color:'#FF453A',fontWeight:600 }}>{error}</span>
            <button onClick={fetchData} style={{ padding:'5px 16px',borderRadius:8,border:'1px solid rgba(0,229,255,0.3)',background:'rgba(0,229,255,0.07)',color:'#00E5FF',cursor:'pointer',fontSize:11 }}>Réessayer</button>
          </div>
        )}
        {!error && allCandles.length===0 && !loading && (
          <div style={{ position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',color:'rgba(255,255,255,0.2)',fontSize:12 }}>Aucune donnée</div>
        )}
        {loading && allCandles.length===0 && (
          <div style={{ position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:10 }}>
            <div style={{ width:32,height:32,border:'3px solid rgba(255,159,28,0.15)',borderTopColor:'#FF9F1C',borderRadius:'50%',animation:'spin 0.8s linear infinite' }}/>
            <span style={{ fontSize:10,color:'rgba(255,255,255,0.3)',fontFamily:'JetBrains Mono,monospace' }}>Chargement…</span>
          </div>
        )}
        <canvas ref={canvasRef}
          style={{ display:'block',position:'absolute',inset:0,width:'100%',height:'100%' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={()=>{ setTooltip(null); dragRef.current=null; clearCrosshair() }}
          onWheel={handleWheel}
        />
        <canvas ref={crosshairRef}
          style={{ display:'block',position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none' }}
        />

        {/* Tooltip */}
        {tooltip && (
          <div style={{ position:'absolute', top:tooltip.y+14, left:Math.min(tooltip.x+14,(wrapRef.current?.offsetWidth??400)-185), background:'rgba(6,10,24,0.97)', border:'1px solid rgba(255,159,28,0.3)', borderRadius:10, padding:'9px 13px', pointerEvents:'none', boxShadow:'0 8px 28px rgba(0,0,0,0.7)', backdropFilter:'blur(10px)', zIndex:20, minWidth:155 }}>
            <div style={{ fontSize:11,fontWeight:700,color:'#FF9F1C',fontFamily:'JetBrains Mono,monospace',marginBottom:6 }}>{fmtPrice(tooltip.price)}</div>
            {([['Buy',fmtVol(tooltip.buy),'#34C759'],['Sell',fmtVol(tooltip.sell),'#FF453A'],['Δ',(tooltip.delta>=0?'+':'')+fmtVol(tooltip.delta),tooltip.delta>=0?'#34C759':'#FF453A']] as [string,string,string][]).map(([l,v,c])=>(
              <div key={l} style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:2 }}>
                <span style={{ fontSize:9,color:'rgba(255,255,255,0.38)' }}>{l}</span>
                <span style={{ fontSize:10,fontWeight:700,color:c,fontFamily:'JetBrains Mono,monospace' }}>{v}</span>
              </div>
            ))}
            <div style={{ marginTop:5,fontSize:9,color:'rgba(255,255,255,0.38)',borderTop:'1px solid rgba(255,255,255,0.07)',paddingTop:4 }}>{tooltip.imbalance}</div>
          </div>
        )}
      </div>
    </div>
  )
}
