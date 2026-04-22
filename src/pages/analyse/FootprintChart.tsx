// src/pages/analyse/FootprintChart.tsx
// Professional footprint / cluster chart — canvas-based
// Data: Binance aggTrades (spot) aggregated per candle × price bin

import React, { useState, useEffect, useRef, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────
interface FPCell   { buyVol: number; sellVol: number }
interface FPCandle {
  open: number; high: number; low: number; close: number; ts: number
  levels: Map<number, FPCell>
  poc: number            // price level with highest total volume
  candleDelta: number    // sum of (buy - sell) across all levels
  totalVol: number
}
interface Tooltip  { x: number; y: number; price: number; buy: number; sell: number; delta: number; imbalance: string }

// ── Helpers ───────────────────────────────────────────────────────────────────
function snapBinSize(raw: number): number {
  const candidates = [0.01,0.05,0.1,0.25,0.5,1,2,5,10,20,25,50,100,200,250,500,1000]
  return candidates.find(c => c >= raw) ?? candidates[candidates.length - 1]
}
function fmtVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `${(v / 1_000).toFixed(0)}K`
  return v.toFixed(0)
}

// ── Core computation ──────────────────────────────────────────────────────────
function buildFootprint(
  klines: unknown[][],
  trades: { p: string; q: string; m: boolean; T: number }[],
  binSize: number
): FPCandle[] {
  return klines.map(k => {
    const openTime  = k[0] as number
    const closeTime = k[6] as number
    const open  = parseFloat(k[1] as string)
    const high  = parseFloat(k[2] as string)
    const low   = parseFloat(k[3] as string)
    const close = parseFloat(k[4] as string)

    const levels = new Map<number, FPCell>()
    let candleDelta = 0

    const candleTrades = trades.filter(t => t.T >= openTime && t.T <= closeTime)
    for (const t of candleTrades) {
      const price = parseFloat(t.p)
      const vol   = price * parseFloat(t.q)
      const level = Math.round(Math.floor(price / binSize) * binSize * 1e8) / 1e8 // avoid float issues
      if (!levels.has(level)) levels.set(level, { buyVol: 0, sellVol: 0 })
      const cell = levels.get(level)!
      if (t.m) cell.sellVol += vol   // maker = sell taker hit bid
      else     cell.buyVol  += vol   // taker = buy taker hit ask
      candleDelta += t.m ? -vol : vol
    }

    // POC = level with max total volume
    let poc = close, maxPocVol = 0
    for (const [lvl, cell] of levels) {
      const tv = cell.buyVol + cell.sellVol
      if (tv > maxPocVol) { maxPocVol = tv; poc = lvl }
    }

    return { open, high, low, close, ts: openTime, levels, poc, candleDelta, totalVol: parseFloat(k[5] as string) * close }
  })
}

// ── Main Component ────────────────────────────────────────────────────────────
const TF_OPTIONS = ['1m','3m','5m','15m'] as const
type TF = typeof TF_OPTIONS[number]
const CANDLE_COUNTS = [10, 15, 20, 30] as const

export default function FootprintChart({ symbol }: { symbol: string }) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const wrapRef    = useRef<HTMLDivElement>(null)
  const [tf,           setTf]           = useState<TF>('5m')
  const [candleCount,  setCandleCount]  = useState<number>(15)
  const [candles,      setCandles]      = useState<FPCandle[]>([])
  const [binSize,      setBinSize]      = useState(1)
  const [globalMax,    setGlobalMax]    = useState(1)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState('')
  const [tooltip,      setTooltip]      = useState<Tooltip|null>(null)
  const [priceOffset,  setPriceOffset]  = useState(0)   // Y scroll in price units
  const [cellH,        setCellH]        = useState(18)  // px per price bin
  const [lastFetch,    setLastFetch]    = useState(0)
  const dragRef = useRef<{startY:number;startOffset:number}|null>(null)

  // ── Fetch & build ──────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!symbol) return
    setLoading(true); setError('')
    try {
      // 1. Klines (includes takerBuyQuoteAssetVolume col 10 for delta fallback)
      const klinesRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=${candleCount}`)
      if (!klinesRes.ok) throw new Error(`Klines ${klinesRes.status}`)
      const klines: unknown[][] = await klinesRes.json()
      if (!Array.isArray(klines) || klines.length === 0) throw new Error('Pas de données')

      const allH = klines.map(k => parseFloat(k[2] as string))
      const allL = klines.map(k => parseFloat(k[3] as string))
      const rangeH = Math.max(...allH), rangeL = Math.min(...allL)
      const rawBin = (rangeH - rangeL) / 30  // ~30 levels target
      const bs = snapBinSize(rawBin)
      setBinSize(bs)

      // 2. aggTrades — 8 parallel batches covering the full period
      //    BTC has ~200-2000 trades/min → 1000 trades/batch × 8 = 8000 trades
      const startTime = klines[0][0] as number
      const endTime   = (klines[klines.length - 1][6] as number) || Date.now()
      const duration  = endTime - startTime
      const NUM_CHUNKS = 8
      const chunkMs   = Math.floor(duration / NUM_CHUNKS)

      const batchPromises = Array.from({ length: NUM_CHUNKS }, (_, i) => {
        const chunkStart = startTime + i * chunkMs
        return fetch(
          `https://api.binance.com/api/v3/aggTrades?symbol=${symbol}&startTime=${chunkStart}&limit=1000`
        ).then(r => r.json()).catch(() => [])
      })
      const batches = await Promise.all(batchPromises)

      // Deduplicate by aggTrade id
      const allTrades: { p:string; q:string; m:boolean; T:number }[] = []
      const seen = new Set<number>()
      for (const batch of batches) {
        if (!Array.isArray(batch)) continue
        for (const t of batch as { a:number; p:string; q:string; m:boolean; T:number }[]) {
          if (t.T >= startTime && t.T <= endTime && !seen.has(t.a)) {
            seen.add(t.a)
            allTrades.push(t)
          }
        }
      }

      // 3. Build footprint — with kline takerBuy fallback for delta
      const fp = buildFootprint(klines, allTrades, bs)

      // Inject kline-level delta fallback for candles that still have 0 trades
      for (let i = 0; i < fp.length; i++) {
        const c  = fp[i]
        const k  = klines[i]
        const klBuyVol  = parseFloat(k[10] as string) // takerBuyQuoteAssetVolume
        const klTotVol  = parseFloat(k[7]  as string) // quoteAssetVolume
        const klSellVol = klTotVol - klBuyVol
        // Only use kline fallback if footprint has no trades
        if (c.levels.size === 0) {
          // Distribute kline volume across price range as a fallback
          const mid  = (c.open + c.close) / 2
          const bin  = Math.round(Math.floor(mid / bs) * bs * 1e8) / 1e8
          c.levels.set(bin, { buyVol: klBuyVol * 0.6, sellVol: klSellVol * 0.6 })
          c.candleDelta = klBuyVol - klSellVol
          c.poc = bin
        } else if (c.candleDelta === 0) {
          // Correct delta from kline if aggTrades didn't capture it
          c.candleDelta = klBuyVol - klSellVol
        }
      }

      // 4. Global max for cell intensity
      let gmax = 1
      for (const c of fp) {
        for (const cell of c.levels.values()) {
          const tv = cell.buyVol + cell.sellVol
          if (tv > gmax) gmax = tv
        }
      }
      setGlobalMax(gmax)
      setCandles(fp)

      // 5. Center Y on last candle's mid price
      if (fp.length > 0) {
        const last = fp[fp.length - 1]
        const mid = (last.high + last.low) / 2
        setPriceOffset(mid)
      }
      setLastFetch(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau')
    } finally {
      setLoading(false)
    }
  }, [symbol, tf, candleCount])

  useEffect(() => { fetchData() }, [fetchData])

  // Auto-refresh every 30s
  useEffect(() => {
    const t = setInterval(fetchData, 30_000)
    return () => clearInterval(t)
  }, [fetchData])

  // ── Canvas render ──────────────────────────────────────────────────────────
  const PRICE_W   = 72    // price axis width
  const CANDLE_W  = 95    // each candle column width
  const DELTA_H   = 32    // delta bar height at bottom
  const VP_W      = 70    // volume profile width (right)
  const IMBALANCE_THRESHOLD = 3.0  // buy/sell ratio to highlight imbalance

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const wrap   = wrapRef.current
    if (!canvas || !wrap || candles.length === 0) return
    const dpr = window.devicePixelRatio || 1
    const W = wrap.offsetWidth || 800
    const H = wrap.offsetHeight || 520
    canvas.width  = W * dpr
    canvas.height = H * dpr
    canvas.style.width  = `${W}px`
    canvas.style.height = `${H}px`
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    const chartH = H - DELTA_H
    const visibleLevels = Math.floor(chartH / cellH)
    const halfVisible   = (visibleLevels / 2) * binSize
    const priceTop      = priceOffset + halfVisible   // highest visible price
    const priceBot      = priceOffset - halfVisible   // lowest visible price
    const toY  = (price: number) => chartH - ((price - priceBot) / (priceTop - priceBot)) * chartH
    const toP  = (y: number)     => priceBot + ((chartH - y) / chartH) * (priceTop - priceBot)

    // Background
    ctx.fillStyle = '#080C14'
    ctx.fillRect(0, 0, W, H)

    // Horizontal grid lines per price bin
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'
    ctx.lineWidth = 0.5
    ctx.setLineDash([])
    let level = Math.floor(priceBot / binSize) * binSize
    while (level <= priceTop + binSize) {
      const y = Math.round(toY(level)) + 0.5
      ctx.beginPath(); ctx.moveTo(PRICE_W, y); ctx.lineTo(W - VP_W, y); ctx.stroke()
      level = Math.round((level + binSize) * 1e8) / 1e8
    }

    // ── Volume Profile (right panel) ──────────────────────────────────────
    const vpMax = candles.reduce((mx, c) => {
      let total = 0
      for (const [lvl, cell] of c.levels) {
        if (lvl >= priceBot && lvl <= priceTop) total += cell.buyVol + cell.sellVol
      }
      return Math.max(mx, total)
    }, 1)

    const vpLevels = new Map<number, { buy: number; sell: number }>()
    for (const c of candles) {
      for (const [lvl, cell] of c.levels) {
        if (!vpLevels.has(lvl)) vpLevels.set(lvl, { buy: 0, sell: 0 })
        const vp = vpLevels.get(lvl)!
        vp.buy  += cell.buyVol
        vp.sell += cell.sellVol
      }
    }
    // Find global POC
    let globalPOC = 0, globalPOCvol = 0
    for (const [lvl, vp] of vpLevels) {
      const tv = vp.buy + vp.sell
      if (tv > globalPOCvol) { globalPOCvol = tv; globalPOC = lvl }
    }
    for (const [lvl, vp] of vpLevels) {
      if (lvl < priceBot || lvl > priceTop) continue
      const y = toY(lvl + binSize * 0.5)
      const totalV = vp.buy + vp.sell
      const barW = (totalV / (vpMax * 1.2)) * VP_W
      const isGPOC = Math.abs(lvl - globalPOC) < binSize * 0.5
      ctx.fillStyle = isGPOC ? 'rgba(255,159,28,0.5)' : 'rgba(100,160,240,0.2)'
      ctx.fillRect(W - VP_W, y - cellH * 0.5, barW, cellH * 0.9)
      if (isGPOC) {
        ctx.fillStyle = 'rgba(255,159,28,0.15)'
        ctx.fillRect(W - VP_W, y - cellH * 0.5, VP_W, cellH * 0.9)
      }
    }
    // VP border
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(W - VP_W, 0); ctx.lineTo(W - VP_W, chartH); ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.25)'
    ctx.font = '8px JetBrains Mono,monospace'
    ctx.textAlign = 'center'
    ctx.fillText('VOL', W - VP_W / 2, 10)

    // ── Candle columns ────────────────────────────────────────────────────
    const chartContentW = W - PRICE_W - VP_W
    const actualCandleW = Math.min(CANDLE_W, chartContentW / candles.length)
    ctx.textAlign = 'left'

    candles.forEach((c, ci) => {
      const x = PRICE_W + ci * actualCandleW
      if (x + actualCandleW > W - VP_W) return

      // Candle body background (light tint across the O-C range)
      const wickX = x + actualCandleW / 2
      const yOpen  = toY(c.open)
      const yClose = toY(c.close)
      const yHigh  = toY(c.high)
      const yLow   = toY(c.low)
      const isBull = c.close >= c.open
      const bodyTop    = Math.min(yOpen, yClose)
      const bodyBottom = Math.max(yOpen, yClose)
      ctx.fillStyle = isBull ? 'rgba(52,199,89,0.04)' : 'rgba(255,69,58,0.04)'
      ctx.fillRect(x + 1, bodyTop, actualCandleW - 2, bodyBottom - bodyTop)

      // Candle OHLC line (wick)
      ctx.strokeStyle = isBull ? 'rgba(52,199,89,0.5)' : 'rgba(255,69,58,0.5)'
      ctx.lineWidth = 1; ctx.setLineDash([])
      ctx.beginPath(); ctx.moveTo(wickX, yHigh); ctx.lineTo(wickX, Math.min(yOpen, yClose)); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(wickX, Math.max(yOpen, yClose)); ctx.lineTo(wickX, yLow); ctx.stroke()

      // Empty level markers within candle range (grid lines for untraded levels)
      let emptyLvl = Math.floor(c.low / binSize) * binSize
      while (emptyLvl <= c.high) {
        const lvlRounded = Math.round(emptyLvl * 1e8) / 1e8
        if (!c.levels.has(lvlRounded)) {
          const ey = toY(lvlRounded + binSize * 0.5)
          if (ey >= 0 && ey <= chartH) {
            ctx.strokeStyle = 'rgba(255,255,255,0.03)'
            ctx.lineWidth = 0.5
            ctx.beginPath(); ctx.moveTo(x + 1, ey); ctx.lineTo(x + actualCandleW - 1, ey); ctx.stroke()
          }
        }
        emptyLvl = Math.round((emptyLvl + binSize) * 1e8) / 1e8
      }

      // POC highlight line across full candle
      const pocY = toY(c.poc + binSize * 0.5)
      ctx.strokeStyle = 'rgba(255,159,28,0.9)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([2, 2])
      ctx.beginPath(); ctx.moveTo(x, pocY); ctx.lineTo(x + actualCandleW - 1, pocY); ctx.stroke()
      ctx.setLineDash([])

      // Cells
      for (const [lvl, cell] of c.levels) {
        if (lvl < priceBot || lvl > priceTop) continue
        const cy = toY(lvl + binSize * 0.5)
        const cellY = cy - cellH * 0.5
        const totalV  = cell.buyVol + cell.sellVol
        const buyRatio = totalV > 0 ? cell.buyVol / totalV : 0
        const intensity = Math.min(totalV / globalMax, 1)

        // Cell background — color by buy/sell dominance + volume intensity
        const isBuyDom  = cell.buyVol > cell.sellVol * IMBALANCE_THRESHOLD
        const isSellDom = cell.sellVol > cell.buyVol * IMBALANCE_THRESHOLD
        const isPOC     = Math.abs(lvl - c.poc) < binSize * 0.5

        if (isBuyDom) {
          ctx.fillStyle = `rgba(52,199,89,${0.25 + intensity * 0.5})`
        } else if (isSellDom) {
          ctx.fillStyle = `rgba(255,69,58,${0.25 + intensity * 0.5})`
        } else {
          const g = Math.round(buyRatio * 120)
          const r = Math.round((1 - buyRatio) * 120)
          ctx.fillStyle = `rgba(${r},${g},80,${0.08 + intensity * 0.25})`
        }
        ctx.fillRect(x + 0.5, cellY, actualCandleW - 1, cellH - 1)

        // POC cell extra border
        if (isPOC) {
          ctx.strokeStyle = 'rgba(255,159,28,0.7)'
          ctx.lineWidth = 1
          ctx.strokeRect(x + 0.5, cellY, actualCandleW - 1, cellH - 1)
        }

        // Imbalance triangle
        if (isBuyDom) {
          ctx.fillStyle = '#34C759'
          ctx.beginPath()
          ctx.moveTo(x + actualCandleW - 2, cellY + cellH / 2)
          ctx.lineTo(x + actualCandleW - 7, cellY + 3)
          ctx.lineTo(x + actualCandleW - 7, cellY + cellH - 3)
          ctx.closePath(); ctx.fill()
        } else if (isSellDom) {
          ctx.fillStyle = '#FF453A'
          ctx.beginPath()
          ctx.moveTo(x + 2, cellY + cellH / 2)
          ctx.lineTo(x + 7, cellY + 3)
          ctx.lineTo(x + 7, cellY + cellH - 3)
          ctx.closePath(); ctx.fill()
        }

        // Text inside cell (only if large enough)
        if (cellH >= 14 && actualCandleW >= 60) {
          const buyTxt  = fmtVol(cell.buyVol)
          const sellTxt = fmtVol(cell.sellVol)
          const fontSize = Math.max(7, Math.min(10, cellH - 5))
          ctx.font = `${fontSize}px JetBrains Mono,monospace`
          // Buy (left, green)
          ctx.fillStyle = `rgba(52,199,89,${0.5 + buyRatio * 0.5})`
          ctx.textAlign = 'left'
          ctx.fillText(buyTxt, x + 4, cellY + cellH * 0.65)
          // Sell (right, red)
          ctx.fillStyle = `rgba(255,69,58,${0.5 + (1 - buyRatio) * 0.5})`
          ctx.textAlign = 'right'
          ctx.fillText(sellTxt, x + actualCandleW - 4 - (isBuyDom ? 6 : 0), cellY + cellH * 0.65)
        }
      }

      // ── Delta bar at bottom ─────────────────────────────────────────────
      const delta = c.candleDelta
      const maxAbs = candles.reduce((m, cc) => Math.max(m, Math.abs(cc.candleDelta)), 1)
      const barH   = Math.abs(delta / maxAbs) * (DELTA_H - 6)
      const barY   = chartH + (delta >= 0 ? DELTA_H - 4 - barH : DELTA_H - 4)
      ctx.fillStyle = delta >= 0 ? 'rgba(52,199,89,0.75)' : 'rgba(255,69,58,0.75)'
      ctx.fillRect(x + 2, barY, actualCandleW - 4, barH)

      // Delta text
      if (DELTA_H >= 24) {
        const fontSize = 8
        ctx.font = `${fontSize}px JetBrains Mono,monospace`
        ctx.fillStyle = delta >= 0 ? '#34C759' : '#FF453A'
        ctx.textAlign = 'center'
        const dTxt = (delta >= 0 ? '+' : '') + fmtVol(delta)
        ctx.fillText(dTxt, x + actualCandleW / 2, chartH + DELTA_H - 2)
      }

      // Candle time label
      const d = new Date(c.ts)
      const timeLbl = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
      ctx.font = '8px JetBrains Mono,monospace'
      ctx.fillStyle = 'rgba(255,255,255,0.3)'
      ctx.textAlign = 'center'
      ctx.fillText(timeLbl, x + actualCandleW / 2, chartH - 2)

      // Column separator
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'
      ctx.lineWidth = 1; ctx.setLineDash([])
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, chartH); ctx.stroke()
    })

    // ── Price axis (left) ─────────────────────────────────────────────────
    ctx.fillStyle = '#080C14'
    ctx.fillRect(0, 0, PRICE_W, H)
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 1; ctx.setLineDash([])
    ctx.beginPath(); ctx.moveTo(PRICE_W, 0); ctx.lineTo(PRICE_W, chartH); ctx.stroke()

    let priceLvl = Math.floor(priceBot / binSize) * binSize
    while (priceLvl <= priceTop + binSize) {
      const y = Math.round(toY(priceLvl)) + 0.5
      if (y >= 0 && y <= chartH) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)'
        ctx.font = '9px JetBrains Mono,monospace'
        ctx.textAlign = 'right'
        ctx.fillText(priceLvl.toFixed(priceLvl < 100 ? 2 : 0), PRICE_W - 4, y + 3)
        // tick mark
        ctx.strokeStyle = 'rgba(255,255,255,0.1)'
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(PRICE_W - 3, y); ctx.lineTo(PRICE_W, y); ctx.stroke()
      }
      priceLvl = Math.round((priceLvl + binSize) * 1e8) / 1e8
    }

    // Delta axis label
    ctx.fillStyle = 'rgba(255,255,255,0.2)'
    ctx.font = '8px JetBrains Mono,monospace'
    ctx.textAlign = 'left'
    ctx.fillText('Δ', 4, chartH + 12)

    // Separator line above delta
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, chartH); ctx.lineTo(W, chartH); ctx.stroke()

  }, [candles, binSize, globalMax, priceOffset, cellH])

  useEffect(() => { draw() }, [draw])

  // Resize observer
  useEffect(() => {
    const obs = new ResizeObserver(() => draw())
    if (wrapRef.current) obs.observe(wrapRef.current)
    return () => obs.disconnect()
  }, [draw])

  // ── Mouse interactions ─────────────────────────────────────────────────────
  const getCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { mx: e.clientX - rect.left, my: e.clientY - rect.top }
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Y drag
    if (dragRef.current) {
      const { mx: _x, my } = getCoords(e)
      void _x
      const dy = my - dragRef.current.startY
      const dprice = (dy / (canvasRef.current!.offsetHeight - DELTA_H)) *
        ((candles.length > 0 ? Math.max(...candles.map(c => c.high)) - Math.min(...candles.map(c => c.low)) : 100) * 2)
      setPriceOffset(dragRef.current.startOffset - dprice)
      return
    }
    // Tooltip
    const { mx, my } = getCoords(e)
    if (!canvasRef.current || candles.length === 0) return
    const W = canvasRef.current.offsetWidth
    const H = canvasRef.current.offsetHeight
    const chartH = H - DELTA_H
    if (mx < PRICE_W || mx > W - VP_W || my > chartH) { setTooltip(null); return }

    const actualCandleW = Math.min(CANDLE_W, (W - PRICE_W - VP_W) / candles.length)
    const ci = Math.floor((mx - PRICE_W) / actualCandleW)
    if (ci < 0 || ci >= candles.length) { setTooltip(null); return }

    const c = candles[ci]
    const priceBot = priceOffset - (Math.floor(chartH / cellH) / 2) * binSize
    const priceTop = priceOffset + (Math.floor(chartH / cellH) / 2) * binSize
    const hoveredPrice = priceBot + ((chartH - my) / chartH) * (priceTop - priceBot)
    const binLevel = Math.round(Math.floor(hoveredPrice / binSize) * binSize * 1e8) / 1e8

    // Find closest level
    let closest: number | null = null
    let minDist = Infinity
    for (const lvl of c.levels.keys()) {
      const d = Math.abs(lvl - binLevel)
      if (d < minDist) { minDist = d; closest = lvl }
    }
    if (closest === null || !c.levels.has(closest)) { setTooltip(null); return }
    const cell = c.levels.get(closest)!
    const total = cell.buyVol + cell.sellVol
    const ratio  = total > 0 ? (cell.buyVol / cell.sellVol).toFixed(1) : '–'
    const imb    = cell.buyVol > cell.sellVol * IMBALANCE_THRESHOLD ? '▲ Buy Imbalance'
      : cell.sellVol > cell.buyVol * IMBALANCE_THRESHOLD ? '▼ Sell Imbalance' : 'Équilibre'
    setTooltip({ x: mx, y: my, price: closest, buy: cell.buyVol, sell: cell.sellVol, delta: cell.buyVol - cell.sellVol, imbalance: `${imb} (×${ratio})` })
  }, [candles, priceOffset, binSize, cellH, getCoords])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    if (e.shiftKey) {
      // Shift+scroll = zoom cell height
      setCellH(prev => Math.max(10, Math.min(32, prev - e.deltaY * 0.05)))
    } else {
      // Normal scroll = pan Y
      setPriceOffset(prev => prev + (e.deltaY > 0 ? -binSize * 3 : binSize * 3))
    }
  }, [binSize])

  const secondsAgo = Math.round((Date.now() - lastFetch) / 1000)

  return (
    <div style={{ background:'rgba(13,17,35,0.8)', backdropFilter:'blur(12px)', border:'1px solid rgba(255,255,255,0.06)', borderRadius:16, overflow:'hidden', display:'flex', flexDirection:'column', height:'100%' }}>
      {/* ── Toolbar ── */}
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderBottom:'1px solid rgba(255,255,255,0.05)', flexWrap:'wrap' }}>
        {/* Title */}
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:28, height:28, borderRadius:8, background:'linear-gradient(135deg,rgba(255,159,28,0.2),rgba(255,69,58,0.2))', border:'1px solid rgba(255,159,28,0.3)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, boxShadow:'0 0 10px rgba(255,159,28,0.15)' }}>⊞</div>
          <div>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--tm-text-primary)', fontFamily:'Syne,sans-serif' }}>Footprint Chart</div>
            <div style={{ fontSize:9, color:'rgba(255,159,28,0.7)', fontFamily:'JetBrains Mono,monospace' }}>{symbol}</div>
          </div>
        </div>

        {/* Timeframe */}
        <div style={{ display:'flex', gap:4 }}>
          {TF_OPTIONS.map(t => (
            <button key={t} onClick={() => setTf(t)} style={{ padding:'3px 10px', borderRadius:20, fontSize:10, fontWeight:600, cursor:'pointer', border:`1px solid ${t === tf ? 'rgba(255,159,28,0.5)' : 'rgba(255,255,255,0.08)'}`, background: t === tf ? 'rgba(255,159,28,0.12)' : 'transparent', color: t === tf ? '#FF9F1C' : 'var(--tm-text-muted)', transition:'all 0.15s' }}>{t}</button>
          ))}
        </div>

        {/* Candle count */}
        <div style={{ display:'flex', gap:4 }}>
          {CANDLE_COUNTS.map(n => (
            <button key={n} onClick={() => setCandleCount(n)} style={{ padding:'3px 10px', borderRadius:20, fontSize:10, fontWeight:600, cursor:'pointer', border:`1px solid ${n === candleCount ? 'rgba(0,229,255,0.4)' : 'rgba(255,255,255,0.08)'}`, background: n === candleCount ? 'rgba(0,229,255,0.08)' : 'transparent', color: n === candleCount ? '#00E5FF' : 'var(--tm-text-muted)', transition:'all 0.15s' }}>{n}C</button>
          ))}
        </div>

        {/* Cell height */}
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ fontSize:9, color:'var(--tm-text-muted)', fontFamily:'JetBrains Mono,monospace' }}>Bin</span>
          <button onClick={() => setCellH(h => Math.max(10, h - 2))} style={{ width:20, height:20, border:'1px solid rgba(255,255,255,0.1)', borderRadius:4, background:'transparent', cursor:'pointer', color:'var(--tm-text-muted)', fontSize:12 }}>−</button>
          <span style={{ fontSize:9, color:'var(--tm-text-muted)', fontFamily:'JetBrains Mono,monospace', minWidth:24, textAlign:'center' }}>{cellH}px</span>
          <button onClick={() => setCellH(h => Math.min(32, h + 2))} style={{ width:20, height:20, border:'1px solid rgba(255,255,255,0.1)', borderRadius:4, background:'transparent', cursor:'pointer', color:'var(--tm-text-muted)', fontSize:12 }}>+</button>
        </div>

        {/* Status + Refresh */}
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
          {loading && <div style={{ width:12, height:12, border:'2px solid #2A2F3E', borderTopColor:'#FF9F1C', borderRadius:'50%', animation:'spin 0.7s linear infinite' }}/>}
          {!loading && <span style={{ fontSize:9, color:'var(--tm-text-muted)', fontFamily:'JetBrains Mono,monospace' }}>{secondsAgo}s ago · bin {binSize}</span>}
          <button onClick={fetchData} disabled={loading} style={{ padding:'4px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.1)', background:'rgba(255,255,255,0.04)', cursor:'pointer', fontSize:11, color:'var(--tm-text-muted)' }}>↻</button>
        </div>
      </div>

      {/* ── Legend ── */}
      <div style={{ display:'flex', gap:12, padding:'5px 14px', borderBottom:'1px solid rgba(255,255,255,0.04)', flexWrap:'wrap' }}>
        {[
          { color:'rgba(52,199,89,0.7)',  label:'Buy Volume' },
          { color:'rgba(255,69,58,0.7)',  label:'Sell Volume' },
          { color:'rgba(255,159,28,0.9)', label:'POC' },
          { color:'rgba(52,199,89,0.9)',  label:'▲ Buy Imbalance (×3)' },
          { color:'rgba(255,69,58,0.9)',  label:'▼ Sell Imbalance (×3)' },
        ].map(({ color, label }) => (
          <div key={label} style={{ display:'flex', alignItems:'center', gap:4 }}>
            <div style={{ width:8, height:8, borderRadius:2, background:color }}/>
            <span style={{ fontSize:9, color:'var(--tm-text-muted)', fontFamily:'JetBrains Mono,monospace' }}>{label}</span>
          </div>
        ))}
        <span style={{ fontSize:9, color:'var(--tm-text-muted)', marginLeft:'auto' }}>Scroll ↕ = pan · Shift+Scroll = zoom · Drag = pan</span>
      </div>

      {/* ── Canvas area ── */}
      <div ref={wrapRef} style={{ flex:1, position:'relative', minHeight:400, cursor:'ns-resize' }}>
        {error && (
          <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8 }}>
            <span style={{ fontSize:22 }}>📡</span>
            <span style={{ fontSize:11, color:'var(--tm-loss)', fontWeight:600 }}>{error}</span>
            <button onClick={fetchData} style={{ padding:'6px 16px', borderRadius:8, border:'1px solid rgba(0,229,255,0.3)', background:'rgba(0,229,255,0.06)', color:'var(--tm-accent)', cursor:'pointer', fontSize:11 }}>Réessayer</button>
          </div>
        )}
        {!error && candles.length === 0 && !loading && (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--tm-text-muted)', fontSize:12 }}>Aucune donnée</div>
        )}
        <canvas
          ref={canvasRef}
          style={{ display:'block', width:'100%', height:'100%' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => { setTooltip(null); dragRef.current = null }}
          onMouseDown={e => { const { my } = getCoords(e); dragRef.current = { startY: my, startOffset: priceOffset } }}
          onMouseUp={() => { dragRef.current = null }}
          onWheel={handleWheel}
        />

        {/* Tooltip */}
        {tooltip && (
          <div style={{ position:'absolute', top: tooltip.y + 12, left: Math.min(tooltip.x + 12, (wrapRef.current?.offsetWidth ?? 400) - 180), background:'rgba(8,12,28,0.96)', border:'1px solid rgba(255,159,28,0.3)', borderRadius:10, padding:'10px 14px', pointerEvents:'none', boxShadow:'0 8px 24px rgba(0,0,0,0.6)', backdropFilter:'blur(8px)', zIndex:20, minWidth:160 }}>
            <div style={{ fontSize:10, fontWeight:700, color:'rgba(255,159,28,0.9)', fontFamily:'JetBrains Mono,monospace', marginBottom:6 }}>{tooltip.price.toFixed(tooltip.price < 100 ? 2 : 0)}</div>
            {[
              ['Buy',   fmtVol(tooltip.buy),   '#34C759'],
              ['Sell',  fmtVol(tooltip.sell),  '#FF453A'],
              ['Delta', (tooltip.delta >= 0 ? '+' : '') + fmtVol(tooltip.delta), tooltip.delta >= 0 ? '#34C759' : '#FF453A'],
            ].map(([l, v, c]) => (
              <div key={l as string} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:3 }}>
                <span style={{ fontSize:9, color:'var(--tm-text-muted)' }}>{l}</span>
                <span style={{ fontSize:11, fontWeight:700, color: c as string, fontFamily:'JetBrains Mono,monospace' }}>{v}</span>
              </div>
            ))}
            <div style={{ marginTop:6, fontSize:9, fontWeight:600, color:'rgba(255,255,255,0.5)', borderTop:'1px solid rgba(255,255,255,0.08)', paddingTop:5 }}>{tooltip.imbalance}</div>
          </div>
        )}
      </div>
    </div>
  )
}
