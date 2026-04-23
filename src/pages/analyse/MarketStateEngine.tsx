// src/pages/analyse/MarketStateEngine.tsx

import { useState, useEffect } from 'react'

type MarketState = 'trend' | 'range' | 'news'

interface CacheEntry {
  data: number[][]
  ts: number
}

// Module-level cache: Map<symbol, {data, ts}>
const candleCache = new Map<string, CacheEntry>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

const CRYPTO_RE = /USDT$|BUSD$|BTC$|ETH$|BNB$/i

function isCryptoSymbol(symbol: string): boolean {
  return CRYPTO_RE.test(symbol)
}

async function fetchCandles(symbol: string): Promise<number[][] | null> {
  const now = Date.now()
  const cached = candleCache.get(symbol)
  if (cached && now - cached.ts < CACHE_TTL) return cached.data

  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=50`
    const res = await fetch(url)
    if (!res.ok) return null
    const data: number[][] = await res.json()
    candleCache.set(symbol, { data, ts: now })
    return data
  } catch {
    return null
  }
}

interface ADXResult {
  adx: number
  atr: number
  atrHistory: number[]
  state: MarketState
}

function computeADXATR(candles: number[][]): ADXResult | null {
  if (candles.length < 16) return null

  const highs = candles.map(c => parseFloat(String(c[2])))
  const lows = candles.map(c => parseFloat(String(c[3])))
  const closes = candles.map(c => parseFloat(String(c[4])))

  const period = 14
  const n = candles.length

  // Calculate TR, +DM, -DM for each bar (starting from index 1)
  const trArr: number[] = []
  const plusDMArr: number[] = []
  const minusDMArr: number[] = []

  for (let i = 1; i < n; i++) {
    const high = highs[i]
    const low = lows[i]
    const prevClose = closes[i - 1]
    const prevHigh = highs[i - 1]
    const prevLow = lows[i - 1]

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    )
    trArr.push(tr)

    const upMove = high - prevHigh
    const downMove = prevLow - low

    const plusDM = upMove > 0 && upMove > downMove ? upMove : 0
    const minusDM = downMove > 0 && downMove > upMove ? downMove : 0
    plusDMArr.push(plusDM)
    minusDMArr.push(minusDM)
  }

  if (trArr.length < period) return null

  // Wilder's smoothing initialization (sum of first 14 values)
  let atr = trArr.slice(0, period).reduce((a, b) => a + b, 0)
  let smoothPlusDM = plusDMArr.slice(0, period).reduce((a, b) => a + b, 0)
  let smoothMinusDM = minusDMArr.slice(0, period).reduce((a, b) => a + b, 0)

  const atrHistory: number[] = [atr / period]
  const dxArr: number[] = []

  for (let i = period; i < trArr.length; i++) {
    atr = atr - atr / period + trArr[i]
    smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDMArr[i]
    smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDMArr[i]

    const atrVal = atr / period
    atrHistory.push(atrVal)

    const plusDI = atr !== 0 ? 100 * smoothPlusDM / atr : 0
    const minusDI = atr !== 0 ? 100 * smoothMinusDM / atr : 0

    const diSum = plusDI + minusDI
    const dx = diSum !== 0 ? 100 * Math.abs(plusDI - minusDI) / diSum : 0
    dxArr.push(dx)
  }

  if (dxArr.length < period) return null

  // ADX = Wilder smoothing of DX over 14 periods
  let adxVal = dxArr.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < dxArr.length; i++) {
    adxVal = (adxVal * (period - 1) + dxArr[i]) / period
  }

  const currentAtr = atrHistory[atrHistory.length - 1]
  const last20Atrs = atrHistory.slice(-20)
  const avgAtr20 = last20Atrs.reduce((a, b) => a + b, 0) / last20Atrs.length

  let state: MarketState
  if (adxVal > 25) {
    state = 'trend'
  } else if (currentAtr > 1.5 * avgAtr20) {
    state = 'news'
  } else {
    state = 'range'
  }

  return { adx: adxVal, atr: currentAtr, atrHistory, state }
}

export default function MarketStateEngine({ symbol }: { symbol: string }) {
  const [result, setResult] = useState<ADXResult | null | 'loading'>('loading')

  useEffect(() => {
    if (!isCryptoSymbol(symbol)) {
      setResult(null)
      return
    }

    setResult('loading')
    let cancelled = false

    const load = async () => {
      const candles = await fetchCandles(symbol)
      if (cancelled) return
      if (!candles) { setResult(null); return }
      const computed = computeADXATR(candles)
      if (!cancelled) setResult(computed)
    }

    load()

    // Refresh every 5 minutes
    const interval = setInterval(load, CACHE_TTL)
    return () => { cancelled = true; clearInterval(interval) }
  }, [symbol])

  if (result === null) return null

  if (result === 'loading') {
    return (
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 99,
        fontSize: 11,
        fontWeight: 600,
        border: '1px solid #2A2F3E',
        background: 'rgba(255,255,255,0.04)',
        color: '#555C70',
      }}>
        ---
      </div>
    )
  }

  const configs: Record<MarketState, { bg: string; borderColor: string; color: string; label: string }> = {
    trend: {
      bg: 'rgba(34,199,89,0.12)',
      borderColor: 'rgba(34,199,89,0.3)',
      color: '#22C759',
      label: `🟢 Trend · ADX ${result.adx.toFixed(0)}`,
    },
    range: {
      bg: 'rgba(255,204,0,0.1)',
      borderColor: 'rgba(255,204,0,0.3)',
      color: '#FFCC00',
      label: `🟡 Range · ADX ${result.adx.toFixed(0)}`,
    },
    news: {
      bg: 'rgba(255,59,48,0.12)',
      borderColor: 'rgba(255,59,48,0.3)',
      color: '#FF3B30',
      label: '⚡ News-driven',
    },
  }

  const cfg = configs[result.state]

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 10px',
      borderRadius: 99,
      fontSize: 11,
      fontWeight: 600,
      border: `1px solid ${cfg.borderColor}`,
      background: cfg.bg,
      color: cfg.color,
    }}>
      {cfg.label}
    </div>
  )
}
