// src/pages/marches/MarchesPage.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Page Marchés — RSI + VMC Heatmap · 200 crypto (dynamique) + ~215 actions
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'
import RsiHeatmap from '@/pages/analyse/RsiHeatmap'
import type { TokenRSI, Timeframe } from '@/pages/analyse/RsiHeatmap'

const fbFunctions = getFunctions(app, 'europe-west1')

// ── Types ────────────────────────────────────────────────────────────────────

interface YahooCandle { t: number; o: number; h: number; l: number; c: number; v: number }
type YahooFn = { s: string; candles: YahooCandle[] }

// Extended TokenRSI with optional divergence field
type TokenRSIWithDiv = TokenRSI & { divergence?: 'bull' | 'bear' }

// Subset filters (which tokens to show)
type CryptoSubset = 'all' | 'top50' | 'alts'
type StockSubset  = 'all' | 'us' | 'europe' | 'cac40' | 'dax' | 'ftse' | 'asia' | 'etf'

// Reference comparison key
type CryptoRef = 'none' | 'btc' | 'eth' | 'top10avg'
type StockRef  = 'none' | 'spy' | 'qqq' | 'cac40avg' | 'sp500avg'

// Relative strength filter (requires a reference to be selected)
type StrengthFilter = 'all' | 'stronger' | 'weaker'

// ── Timeframe mappings ───────────────────────────────────────────────────────

const TF_TO_BINANCE: Record<Timeframe, string> = {
  '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d',
}
const TF_LIMIT: Record<Timeframe, number> = {
  '5m': 100, '15m': 100, '1h': 80, '4h': 60, '1d': 60,
}
const TF_TO_YAHOO: Record<Timeframe, { interval: string; range: string }> = {
  '5m':  { interval: '5m',  range: '5d'  },
  '15m': { interval: '15m', range: '5d'  },
  '1h':  { interval: '1h',  range: '1mo' },
  '4h':  { interval: '1h',  range: '3mo' }, // Yahoo has no 4h
  '1d':  { interval: '1d',  range: '1mo' },
}

// ── RSI helper ───────────────────────────────────────────────────────────────

function calcRSI(closes: number[], period = 14): number {
  if (closes.length <= period) return 50
  let gains = 0, losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const curr = closes[i], prev = closes[i - 1]
    if (typeof curr !== 'number' || typeof prev !== 'number' || isNaN(curr) || isNaN(prev)) continue
    const d = curr - prev
    if (d > 0) gains += d; else losses -= d
  }
  const avgG = gains / period, avgL = losses / period
  if (avgL === 0) return 100
  const result = 100 - 100 / (1 + avgG / avgL)
  return isNaN(result) ? 50 : +result.toFixed(2)
}

// ── RSI full array (Wilder smoothing) ────────────────────────────────────────

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

// ── Pivot detection ───────────────────────────────────────────────────────────

function findPivotLowIdxs(arr: number[], lb = 4, rb = 4): number[] {
  const pivots: number[] = []
  for (let i = lb; i < arr.length - rb; i++) {
    const v = arr[i]
    let ok = true
    for (let j = i - lb; j <= i + rb; j++) { if (j !== i && arr[j] <= v) { ok = false; break } }
    if (ok) pivots.push(i)
  }
  return pivots
}

function findPivotHighIdxs(arr: number[], lb = 4, rb = 4): number[] {
  const pivots: number[] = []
  for (let i = lb; i < arr.length - rb; i++) {
    const v = arr[i]
    let ok = true
    for (let j = i - lb; j <= i + rb; j++) { if (j !== i && arr[j] >= v) { ok = false; break } }
    if (ok) pivots.push(i)
  }
  return pivots
}

// ── RSI divergence detection ──────────────────────────────────────────────────

function detectRSIDivergence(closes: number[], rsiArr: number[]): 'bull' | 'bear' | null {
  if (closes.length < 20 || rsiArr.length < 20) return null
  const lows  = findPivotLowIdxs(closes)
  if (lows.length >= 2) {
    const i1 = lows[lows.length - 2], i2 = lows[lows.length - 1]
    if (closes[i2] < closes[i1] && rsiArr[i2] > rsiArr[i1] + 2) return 'bull'
  }
  const highs = findPivotHighIdxs(closes)
  if (highs.length >= 2) {
    const i1 = highs[highs.length - 2], i2 = highs[highs.length - 1]
    if (closes[i2] > closes[i1] && rsiArr[i2] < rsiArr[i1] - 2) return 'bear'
  }
  return null
}

// ── WaveTrend WT1 helper ─────────────────────────────────────────────────────

function calcWT1(candles: { o: number; h: number; l: number; c: number }[], n1 = 10, n2 = 21): number {
  try {
    if (candles.length < n1 + n2 + 5) return 0
    function ema(src: number[], period: number): number[] {
      if (src.length === 0) return []
      const k = 2 / (period + 1)
      const out: number[] = [src[0] ?? 0]
      for (let i = 1; i < src.length; i++) out.push((src[i] ?? 0) * k + out[i - 1] * (1 - k))
      return out
    }
    const hlc3 = candles.map(c => ((c.h ?? 0) + (c.l ?? 0) + (c.c ?? 0)) / 3)
    const esa  = ema(hlc3, n1)
    const d    = ema(hlc3.map((v, i) => Math.abs(v - (esa[i] ?? 0))), n1)
    const ci   = hlc3.map((v, i) => { const di = d[i] ?? 0; return di === 0 ? 0 : (v - (esa[i] ?? 0)) / (0.015 * di) })
    const tci  = ema(ci, n2)
    if (!tci.length) return 0
    const last = tci[tci.length - 1]
    if (typeof last !== 'number' || isNaN(last)) return 0
    return +last.toFixed(2)
  } catch { return 0 }
}

// ── Stock groups (~215 actions) ───────────────────────────────────────────────

const STOCK_GROUPS: { label: string; symbols: string[] }[] = [
  {
    label: '🇺🇸 US Tech',
    symbols: [
      'AAPL','MSFT','GOOGL','AMZN','META','NVDA','AMD','TSLA','NFLX','ORCL',
      'CRM','ADBE','INTC','QCOM','UBER','PYPL','SHOP','SNOW','PLTR','MSTR',
      'PANW','CRWD','ZS','NET','DDOG','MDB','GTLB','BILL','HUBS','WDAY',
    ],
  },
  {
    label: '🇺🇸 US Finance',
    symbols: [
      'JPM','GS','MS','BAC','V','MA','COIN','WFC','BLK','C',
      'AXP','SCHW','SPGI','MCO','ICE','PGR','MET','PRU','AON','MMC',
      'TFC','USB','FITB','KEY','CFG',
    ],
  },
  {
    label: '🇺🇸 US Santé',
    symbols: [
      'JNJ','UNH','PFE','LLY','ABBV','MRK','AMGN','GILD','BMY','CVS',
      'TMO','DHR','SYK','ISRG','MDT','REGN','VRTX','ZBH','EW','BIIB',
      'MRNA','BNTX','IQV','CI','HUM',
    ],
  },
  {
    label: '🇺🇸 US Industrie & Énergie',
    symbols: [
      'XOM','CVX','BA','CAT','GE','HON','RTX','LMT','DE','MMM',
      'EMR','ETN','GD','NOC','FDX','UPS','WM','CSX','NSC','COP',
      'EOG','SLB','HAL','OXY','MPC',
    ],
  },
  {
    label: '🇺🇸 US Consommation & Médias',
    symbols: [
      'WMT','TGT','COST','HD','LOW','NKE','SBUX','MCD','PEP','KO',
      'PM','MO','DIS','CMCSA','T','VZ','CHTR','PARA','WBD','EA',
      'TTWO','RBLX','SPOT','LYFT','DASH',
    ],
  },
  {
    label: '🇫🇷 CAC 40',
    symbols: [
      'TTE.PA','BNP.PA','SAN.PA','AIR.PA','MC.PA','AXA.PA','ORA.PA',
      'SGO.PA','DG.PA','AI.PA','CAP.PA','KER.PA','RMS.PA','HO.PA',
      'LR.PA','STM.PA','ENGI.PA','SU.PA','RNO.PA','PUB.PA',
      'BN.PA','CA.PA','DSY.PA','EL.PA','GLE.PA','ML.PA','SAF.PA',
      'VIE.PA','VIV.PA','FP.PA',
    ],
  },
  {
    label: '🇩🇪 DAX',
    symbols: [
      'SAP.DE','SIE.DE','ALV.DE','BMW.DE','MBG.DE','BAS.DE','BAYN.DE',
      'DTE.DE','VOW3.DE','ADS.DE','DBK.DE','MUV2.DE','RWE.DE','BEI.DE',
      'DHL.DE','HEN3.DE','MTX.DE','VNA.DE','CON.DE','DHER.DE',
    ],
  },
  {
    label: '🇬🇧 FTSE 100',
    symbols: [
      'HSBA.L','BP.L','SHEL.L','AZN.L','ULVR.L','LLOY.L','GSK.L',
      'RIO.L','BT-A.L','BATS.L','NG.L','LGEN.L','STAN.L',
      'EXPN.L','REL.L','WPP.L','IMB.L','GLEN.L','AAL.L','PRU.L',
    ],
  },
  {
    label: '🇪🇺 Europe (Autres)',
    symbols: [
      'ASML.AS','HEIA.AS','INGA.AS','AD.AS','PHIA.AS',
      'NESN.SW','NOVN.SW','ROG.SW','ABB.SW','ZURN.SW',
      'NOVO-B.CO','ORSTED.CO',
      'ERIC-B.ST','VOLV-B.ST','SAND.ST','SEB-A.ST',
      'ENI.MI','ENEL.MI','ISP.MI','UCG.MI',
    ],
  },
  {
    label: '🌏 Asie & International',
    symbols: [
      'TSM','BABA','JD','PDD','BIDU',
      'TM','HMC','SONY','NVO','SHOP',
      'RY','TD','BNS','ENB','CNQ',
    ],
  },
  {
    label: '📊 ETF & Matières premières',
    symbols: [
      'SPY','QQQ','IWM','EEM','EFA',
      'GLD','SLV','USO','GDX','IAU',
      'TLT','HYG','LQD','VXX','PDBC',
    ],
  },
]

const STOCK_SUBSET_GROUPS: Record<StockSubset, string[]> = {
  all:    STOCK_GROUPS.map(g => g.label),
  us:     ['🇺🇸 US Tech','🇺🇸 US Finance','🇺🇸 US Santé','🇺🇸 US Industrie & Énergie','🇺🇸 US Consommation & Médias'],
  europe: ['🇫🇷 CAC 40','🇩🇪 DAX','🇬🇧 FTSE 100','🇪🇺 Europe (Autres)'],
  cac40:  ['🇫🇷 CAC 40'],
  dax:    ['🇩🇪 DAX'],
  ftse:   ['🇬🇧 FTSE 100'],
  asia:   ['🌏 Asie & International'],
  etf:    ['📊 ETF & Matières premières'],
}

// ── Share button ──────────────────────────────────────────────────────────────

function ShareButton({ targetRef, label }: { targetRef: React.RefObject<HTMLDivElement>; label: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle')
  const handleShare = async () => {
    const el = targetRef.current; if (!el) return
    setState('loading')
    try {
      const { toPng } = await import('html-to-image')
      const dataUrl = await toPng(el, {
        quality: 1, pixelRatio: 2,
        backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--tm-bg').trim() || '#0D1117',
        filter: (node) => !(node instanceof HTMLButtonElement && node.dataset.shareBtn),
      })
      const blob = await (await fetch(dataUrl)).blob()
      const filename = `trademindset-${label.toLowerCase().replace(/\s+/g, '-')}.png`
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      } catch {
        if (navigator.share && navigator.canShare) {
          const file = new File([blob], filename, { type: 'image/png' })
          if (navigator.canShare({ files: [file] })) await navigator.share({ title: `TradeMindset — ${label}`, files: [file] })
        } else {
          const url = URL.createObjectURL(blob)
          Object.assign(document.createElement('a'), { href: url, download: filename }).click()
          URL.revokeObjectURL(url)
        }
      }
      setState('done'); setTimeout(() => setState('idle'), 2500)
    } catch (e) { console.warn('Share failed:', e); setState('idle') }
  }
  return (
    <button data-share-btn="true" onClick={handleShare} disabled={state === 'loading'} style={{
      padding: '5px 14px', borderRadius: 8, border: '1px solid var(--tm-border-sub)',
      background: state === 'done' ? 'rgba(34,199,89,0.15)' : 'var(--tm-bg-secondary)',
      color: state === 'done' ? '#22C759' : 'var(--tm-text-muted)',
      fontSize: 11, fontWeight: 600, cursor: state === 'loading' ? 'wait' : 'pointer',
      display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.15s',
    }}>
      {state === 'done' ? '✓ Copié' : state === 'loading' ? '⏳…' : '↗ Partager'}
    </button>
  )
}

// ── Filter pills (generic) ────────────────────────────────────────────────────

function FilterPills<T extends string>({
  options, value, onChange, label,
}: {
  options: { value: T; label: string; sub?: string }[]
  value: T; onChange: (v: T) => void; label?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      {label && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--tm-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 2 }}>{label}</span>}
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)} style={{
          padding: '3px 11px', borderRadius: 99, fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all 0.12s',
          border: `1px solid ${value === o.value ? 'var(--tm-accent)' : 'var(--tm-border-sub)'}`,
          background: value === o.value ? 'var(--tm-accent, #5B5EF4)22' : 'transparent',
          color: value === o.value ? 'var(--tm-accent, #5B5EF4)' : 'var(--tm-text-muted)',
        }}>
          {o.label}{o.sub ? <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 4 }}>{o.sub}</span> : null}
        </button>
      ))}
    </div>
  )
}

// ── Comparison bar ────────────────────────────────────────────────────────────
// Shows RSI reference selector + stronger/weaker filter

function CompareBar({
  refOptions, refKey, strengthFilter, onRefChange, onStrengthChange, totalAll, totalStronger, totalWeaker,
}: {
  refOptions: { value: string; label: string; rsi: number | null }[]
  refKey: string; strengthFilter: StrengthFilter
  onRefChange: (v: string) => void; onStrengthChange: (v: StrengthFilter) => void
  totalAll: number; totalStronger: number; totalWeaker: number
}) {
  const hasRef = refKey !== 'none'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Reference selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--tm-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Référence</span>
        {refOptions.map(opt => {
          const active = refKey === opt.value
          return (
            <button
              key={opt.value}
              onClick={() => onRefChange(active ? 'none' : opt.value)}
              style={{
                padding: '3px 11px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.12s',
                border: `1px solid ${active ? '#BF5AF2' : 'var(--tm-border-sub)'}`,
                background: active ? 'rgba(191,90,242,0.15)' : 'transparent',
                color: active ? '#BF5AF2' : 'var(--tm-text-muted)',
                display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              {opt.label}
              {opt.rsi !== null && (
                <span style={{
                  fontSize: 10, fontWeight: 800,
                  color: active ? '#BF5AF2' : 'var(--tm-text-secondary)',
                  fontFamily: "'JetBrains Mono',monospace",
                }}>
                  RSI {opt.rsi}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Stronger / Weaker chips — only visible when a reference is active */}
      {hasRef && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'var(--tm-text-muted)', marginRight: 2 }}>Afficher</span>
          {([
            { v: 'stronger' as StrengthFilter, label: `▲ Plus fort`, color: '#22c759', count: totalStronger },
            { v: 'all'      as StrengthFilter, label: `Tous`,        color: 'var(--tm-text-muted)', count: totalAll },
            { v: 'weaker'   as StrengthFilter, label: `▼ Plus faible`, color: '#ff3b5c', count: totalWeaker },
          ] as const).map(({ v, label, color, count }) => {
            const active = strengthFilter === v
            return (
              <button key={v} onClick={() => onStrengthChange(v)} style={{
                padding: '3px 11px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.12s',
                border: `1px solid ${active ? color : 'var(--tm-border-sub)'}`,
                background: active ? color + '22' : 'transparent',
                color: active ? color : 'var(--tm-text-muted)',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                {label}
                <span style={{
                  fontSize: 9, fontWeight: 800, background: active ? color + '33' : 'var(--tm-bg-secondary)',
                  padding: '0 5px', borderRadius: 99, color: active ? color : 'var(--tm-text-muted)',
                }}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Crypto fetcher ────────────────────────────────────────────────────────────

interface BinanceTicker { symbol: string; quoteVolume: string }
let _cachedCryptoSymbols: string[] | null = null

async function getTopCryptoSymbols(n = 200): Promise<string[]> {
  if (_cachedCryptoSymbols) return _cachedCryptoSymbols
  const r = await fetch('https://api.binance.com/api/v3/ticker/24hr')
  const tickers: BinanceTicker[] = await r.json()
  _cachedCryptoSymbols = tickers
    .filter(t => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 500_000)
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, n)
    .map(t => t.symbol)
  return _cachedCryptoSymbols
}

async function fetchCryptoRSI(symbols: string[], tf: Timeframe = '1d'): Promise<TokenRSIWithDiv[]> {
  const interval = TF_TO_BINANCE[tf], limit = TF_LIMIT[tf]
  const BATCH = 50, results: TokenRSIWithDiv[] = []
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH)
    const settled = await Promise.allSettled(batch.map(async sym => {
      const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${limit}`)
      const rows: unknown[][] = await r.json()
      if (!Array.isArray(rows) || rows.length < 2) return null
      const candles = rows.map(k => ({
        o: parseFloat(k[1] as string) || 0, h: parseFloat(k[2] as string) || 0,
        l: parseFloat(k[3] as string) || 0, c: parseFloat(k[4] as string) || 0,
      }))
      const closes  = candles.map(c => c.c).filter(v => v > 0)
      const volumes = rows.map(k => parseFloat(k[7] as string) || 0)
      if (closes.length < 2) return null
      const last = closes[closes.length - 1], prev = closes[closes.length - 2]
      const change = prev !== 0 ? +((last - prev) / prev * 100).toFixed(2) : 0
      const rsiArr = calcRSIArr(closes)
      const divergence = detectRSIDivergence(closes, rsiArr) ?? undefined
      return {
        symbol: sym.replace('USDT', ''),
        rsi: calcRSI(closes), wt1: calcWT1(candles),
        change24h: isNaN(change) ? 0 : change,
        volume: volumes[volumes.length - 1], price: last,
        divergence,
      } satisfies TokenRSIWithDiv
    }))
    results.push(...settled.flatMap(r => r.status === 'fulfilled' && r.value ? [r.value] : []))
  }
  return results
}

// ── Stock fetcher ─────────────────────────────────────────────────────────────

async function fetchStockRSI(symbol: string, tf: Timeframe = '1d'): Promise<TokenRSIWithDiv | null> {
  try {
    const { interval, range } = TF_TO_YAHOO[tf]
    const fn  = httpsCallable<Record<string, unknown>, YahooFn>(fbFunctions, 'fetchYahooCandles')
    const res = await fn({ symbol, interval, range })
    if (res.data.s !== 'ok' || !res.data.candles || res.data.candles.length < 3) return null
    const candles = res.data.candles
    const closes  = candles.map(c => c.c).filter((v): v is number => typeof v === 'number' && !isNaN(v))
    if (closes.length < 2) return null
    const last = candles[candles.length - 1], prev = candles[candles.length - 2]
    if (!last || !prev || last.c == null || prev.c == null) return null
    const displaySym = symbol.replace(/\.(PA|DE|L|AS|SW|CO|ST|MI)$/, '')
    const change = prev.c !== 0 ? +((last.c - prev.c) / prev.c * 100).toFixed(2) : 0
    const rsiArr = calcRSIArr(closes)
    const divergence = detectRSIDivergence(closes, rsiArr) ?? undefined
    return {
      symbol: displaySym, rsi: calcRSI(closes), wt1: calcWT1(candles),
      change24h: isNaN(change) ? 0 : change, volume: last.v ?? 0, price: last.c,
      divergence,
    }
  } catch { return null }
}

async function fetchGroupParallel(
  symbols: string[], tf: Timeframe = '1d',
  onProgress?: (done: number, total: number) => void
): Promise<TokenRSIWithDiv[]> {
  const BATCH = 10, results: TokenRSIWithDiv[] = []
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch   = symbols.slice(i, i + BATCH)
    const settled = await Promise.allSettled(batch.map(s => fetchStockRSI(s, tf)))
    results.push(...settled.flatMap(r => r.status === 'fulfilled' && r.value ? [r.value] : []))
    onProgress?.(Math.min(i + BATCH, symbols.length), symbols.length)
  }
  return results
}

// ── Skeleton + RefetchBadge ───────────────────────────────────────────────────

function SkeletonGroup({ label, count }: { label: string; count: number }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tm-text-muted)', marginBottom: 6, padding: '0 2px' }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} style={{ width: 76, height: 58, borderRadius: 7, background: 'var(--tm-bg-secondary)', border: '1px solid var(--tm-border-sub)', animation: 'pulse 1.5s ease-in-out infinite' }} />
        ))}
      </div>
    </div>
  )
}

function RefetchBadge() {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10,
      color: 'var(--tm-text-muted)', padding: '3px 10px', background: 'var(--tm-bg-secondary)',
      borderRadius: 99, border: '1px solid var(--tm-border-sub)', marginBottom: 8,
    }}>
      <div style={{ width: 10, height: 10, border: '1.5px solid var(--tm-border)', borderTopColor: 'var(--tm-accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      Mise à jour…
    </div>
  )
}

// ── Avg RSI helper ────────────────────────────────────────────────────────────

function avgRSI(tokens: TokenRSI[]): number | null {
  if (!tokens.length) return null
  const sum = tokens.reduce((s, t) => s + (t.rsi ?? 50), 0)
  return +( sum / tokens.length).toFixed(1)
}

// ── Divergence Scanner section ────────────────────────────────────────────────

function DivergenceScanner({ tokens, onTokenClick }: { tokens: TokenRSIWithDiv[]; onTokenClick: (sym: string) => void }) {
  const bulls = tokens.filter(t => t.divergence === 'bull')
  const bears = tokens.filter(t => t.divergence === 'bear')
  if (bulls.length === 0 && bears.length === 0) return null
  return (
    <div style={{ marginBottom: 16, padding: '14px 16px', background: 'rgba(255,255,255,0.02)', border: '1px solid #1E2330', borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 16 }}>🎯</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-primary)' }}>Divergences RSI détectées</span>
        <span style={{ fontSize: 10, color: 'var(--tm-text-muted)', marginLeft: 4 }}>Timeframe actuel</span>
        {bulls.length > 0 && <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: 'var(--tm-profit)', background: 'rgba(34,199,89,0.12)', padding: '2px 8px', borderRadius: 10, border: '1px solid rgba(34,199,89,0.25)' }}>↗ {bulls.length} BULL</span>}
        {bears.length > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--tm-loss)', background: 'rgba(255,59,48,0.12)', padding: '2px 8px', borderRadius: 10, border: '1px solid rgba(255,59,48,0.25)', marginLeft: bulls.length ? 4 : 'auto' }}>↘ {bears.length} BEAR</span>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {bulls.map(t => (
          <button key={t.symbol} onClick={() => onTokenClick(t.symbol)} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
            background: 'rgba(34,199,89,0.08)', border: '1px solid rgba(34,199,89,0.3)',
            color: 'var(--tm-profit)', fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
          }}>
            ↗ {t.symbol}
            <span style={{ fontSize: 9, color: 'var(--tm-text-muted)', fontWeight: 400 }}>RSI {t.rsi}</span>
          </button>
        ))}
        {bears.map(t => (
          <button key={t.symbol} onClick={() => onTokenClick(t.symbol)} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
            background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.3)',
            color: 'var(--tm-loss)', fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
          }}>
            ↘ {t.symbol}
            <span style={{ fontSize: 9, color: 'var(--tm-text-muted)', fontWeight: 400 }}>RSI {t.rsi}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Stocks tab ────────────────────────────────────────────────────────────────

function StocksTab({ onTokenClick, shareRef }: { onTokenClick: (sym: string) => void; shareRef: React.RefObject<HTMLDivElement> }) {
  const [groupData,     setGroupData]     = useState<Record<string, TokenRSIWithDiv[]>>({})
  const [groupProgress, setGroupProgress] = useState<Record<string, { done: number; total: number }>>({})
  const [loadedGroups,  setLoadedGroups]  = useState<Set<string>>(new Set())
  const [timeframe,     setTimeframe]     = useState<Timeframe>('1d')
  const [subset,        setSubset]        = useState<StockSubset>('all')
  const [refKey,        setRefKey]        = useState<StockRef>('none')
  const [strength,      setStrength]      = useState<StrengthFilter>('all')

  useEffect(() => {
    let cancelled = false
    setGroupData({}); setLoadedGroups(new Set()); setGroupProgress({})
    ;(async () => {
      for (const group of STOCK_GROUPS) {
        if (cancelled) break
        const total = group.symbols.length
        setGroupProgress(prev => ({ ...prev, [group.label]: { done: 0, total } }))
        const tokens = await fetchGroupParallel(group.symbols, timeframe, (done) => {
          if (!cancelled) setGroupProgress(prev => ({ ...prev, [group.label]: { done, total } }))
        })
        if (!cancelled) {
          setGroupData(prev => ({ ...prev, [group.label]: tokens }))
          setLoadedGroups(prev => new Set([...prev, group.label]))
        }
      }
    })()
    return () => { cancelled = true }
  }, [timeframe])

  // Reset strength filter when reference changes
  const handleRefChange = (v: string) => { setRefKey(v as StockRef); setStrength('all') }

  // All tokens for the selected subset
  const subsetTokens = useMemo(() => {
    const allowedGroups = STOCK_SUBSET_GROUPS[subset]
    return STOCK_GROUPS.filter(g => allowedGroups.includes(g.label)).flatMap(g => groupData[g.label] ?? [])
  }, [groupData, subset])

  // Reference RSI value
  const refRSI = useMemo((): number | null => {
    if (refKey === 'none') return null
    const etfGroup = groupData['📊 ETF & Matières premières'] ?? []
    if (refKey === 'spy')     return etfGroup.find(t => t.symbol === 'SPY')?.rsi ?? null
    if (refKey === 'qqq')     return etfGroup.find(t => t.symbol === 'QQQ')?.rsi ?? null
    if (refKey === 'cac40avg') return avgRSI(groupData['🇫🇷 CAC 40'] ?? [])
    if (refKey === 'sp500avg') {
      const usGroups = ['🇺🇸 US Tech','🇺🇸 US Finance','🇺🇸 US Santé','🇺🇸 US Industrie & Énergie','🇺🇸 US Consommation & Médias']
      return avgRSI(STOCK_GROUPS.filter(g => usGroups.includes(g.label)).flatMap(g => groupData[g.label] ?? []))
    }
    return null
  }, [groupData, refKey])

  // Apply strength filter
  const finalTokens = useMemo(() => {
    if (refKey === 'none' || refRSI === null || strength === 'all') return subsetTokens
    if (strength === 'stronger') return subsetTokens.filter(t => (t.rsi ?? 50) > refRSI)
    return subsetTokens.filter(t => (t.rsi ?? 50) < refRSI)
  }, [subsetTokens, refKey, refRSI, strength])

  const refOptions = useMemo(() => [
    { value: 'spy',      label: 'S&P 500 (SPY)', rsi: (groupData['📊 ETF & Matières premières'] ?? []).find(t => t.symbol === 'SPY')?.rsi ?? null },
    { value: 'qqq',      label: 'NASDAQ (QQQ)',  rsi: (groupData['📊 ETF & Matières premières'] ?? []).find(t => t.symbol === 'QQQ')?.rsi ?? null },
    { value: 'sp500avg', label: 'Moy. S&P 500',  rsi: (() => {
      const usGroups = ['🇺🇸 US Tech','🇺🇸 US Finance','🇺🇸 US Santé','🇺🇸 US Industrie & Énergie','🇺🇸 US Consommation & Médias']
      return avgRSI(STOCK_GROUPS.filter(g => usGroups.includes(g.label)).flatMap(g => groupData[g.label] ?? []))
    })() },
    { value: 'cac40avg', label: 'Moy. CAC 40',   rsi: avgRSI(groupData['🇫🇷 CAC 40'] ?? []) },
  ], [groupData])

  const allLoaded    = loadedGroups.size === STOCK_GROUPS.length
  const totalLoaded  = Object.values(groupData).flat().length
  const totalSymbols = STOCK_GROUPS.reduce((s, g) => s + g.symbols.length, 0)
  const isFirstLoad  = !allLoaded && totalLoaded === 0

  const stronger = refRSI !== null ? subsetTokens.filter(t => (t.rsi ?? 50) > refRSI).length : 0
  const weaker   = refRSI !== null ? subsetTokens.filter(t => (t.rsi ?? 50) < refRSI).length : 0

  return (
    <div>
      {!allLoaded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 11, color: 'var(--tm-text-muted)', padding: '8px 12px', background: 'var(--tm-bg-secondary)', borderRadius: 8, border: '1px solid var(--tm-border-sub)' }}>
          <div style={{ width: 14, height: 14, border: '2px solid var(--tm-border)', borderTopColor: 'var(--tm-accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
          <span>Chargement… {totalLoaded}/{totalSymbols} actions ({loadedGroups.size}/{STOCK_GROUPS.length} groupes)</span>
          <div style={{ flex: 1, height: 3, background: 'var(--tm-border-sub)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(loadedGroups.size / STOCK_GROUPS.length) * 100}%`, background: 'var(--tm-accent)', transition: 'width 0.4s ease', borderRadius: 2 }} />
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        <FilterPills
          label="Indice"
          options={[
            { value: 'all',    label: 'Tous' },
            { value: 'us',     label: '🇺🇸 US' },
            { value: 'europe', label: '🇪🇺 Europe' },
            { value: 'cac40',  label: '🇫🇷 CAC 40' },
            { value: 'dax',    label: '🇩🇪 DAX' },
            { value: 'ftse',   label: '🇬🇧 FTSE' },
            { value: 'asia',   label: '🌏 Asie' },
            { value: 'etf',    label: '📊 ETF' },
          ]}
          value={subset}
          onChange={(v: StockSubset) => { setSubset(v); setStrength('all') }}
        />
        {/* Comparison reference */}
        <CompareBar
          refOptions={refOptions}
          refKey={refKey}
          strengthFilter={strength}
          onRefChange={handleRefChange}
          onStrengthChange={setStrength}
          totalAll={subsetTokens.length}
          totalStronger={stronger}
          totalWeaker={weaker}
        />
      </div>

      {isFirstLoad && STOCK_GROUPS.filter(g => !loadedGroups.has(g.label)).map(g => {
        const prog = groupProgress[g.label]
        return <SkeletonGroup key={g.label} label={`${g.label} ${prog ? `(${prog.done}/${prog.total})` : ''}`} count={g.symbols.length} />
      })}

      {/* Divergence Scanner */}
      {finalTokens.length > 0 && <DivergenceScanner tokens={finalTokens as TokenRSIWithDiv[]} onTokenClick={onTokenClick} />}

      {finalTokens.length > 0 && (
        <div ref={shareRef}>
          <RsiHeatmap tokens={finalTokens} timeframe={timeframe} defaultTimeframe="1d" onTimeframeChange={setTimeframe} onTokenClick={onTokenClick} />
        </div>
      )}
    </div>
  )
}

// ── Crypto tab ────────────────────────────────────────────────────────────────

function CryptoTab({ onTokenClick, shareRef }: { onTokenClick: (sym: string) => void; shareRef: React.RefObject<HTMLDivElement> }) {
  const [tokens,    setTokens]    = useState<TokenRSIWithDiv[]>([])
  const [loading,   setLoading]   = useState(true)
  const [timeframe, setTimeframe] = useState<Timeframe>('1d')
  const [subset,    setSubset]    = useState<CryptoSubset>('all')
  const [refKey,    setRefKey]    = useState<CryptoRef>('none')
  const [strength,  setStrength]  = useState<StrengthFilter>('all')
  const [status,    setStatus]    = useState('Récupération du top 200 Binance…')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        setStatus('Récupération du top 200 Binance par volume…')
        const symbols = await getTopCryptoSymbols(200)
        if (cancelled) return
        setStatus(`Calcul RSI + VMC (${timeframe.toUpperCase()}) pour ${symbols.length} crypto…`)
        const data = await fetchCryptoRSI(symbols, timeframe)
        if (!cancelled) setTokens(data)
      } catch (e) { console.warn('Crypto fetch error:', e) }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [timeframe])

  const handleRefChange = (v: string) => { setRefKey(v as CryptoRef); setStrength('all') }

  // Apply subset filter first
  const subsetTokens = useMemo(() => {
    if (subset === 'top50') return tokens.slice(0, 50)
    if (subset === 'alts')  return tokens.filter(t => t.symbol !== 'BTC' && t.symbol !== 'ETH')
    return tokens
  }, [tokens, subset])

  // Reference RSI value (computed from the full tokens list, not the subset)
  const refRSI = useMemo((): number | null => {
    if (refKey === 'none') return null
    if (refKey === 'btc')     return tokens.find(t => t.symbol === 'BTC')?.rsi ?? null
    if (refKey === 'eth')     return tokens.find(t => t.symbol === 'ETH')?.rsi ?? null
    if (refKey === 'top10avg') return avgRSI(tokens.slice(0, 10))
    return null
  }, [tokens, refKey])

  // Apply strength filter
  const finalTokens = useMemo(() => {
    if (refKey === 'none' || refRSI === null || strength === 'all') return subsetTokens
    if (strength === 'stronger') return subsetTokens.filter(t => (t.rsi ?? 50) > refRSI)
    return subsetTokens.filter(t => (t.rsi ?? 50) < refRSI)
  }, [subsetTokens, refKey, refRSI, strength])

  const refOptions = useMemo(() => [
    { value: 'btc',      label: 'BTC',            rsi: tokens.find(t => t.symbol === 'BTC')?.rsi ?? null },
    { value: 'eth',      label: 'ETH',            rsi: tokens.find(t => t.symbol === 'ETH')?.rsi ?? null },
    { value: 'top10avg', label: 'Moy. Top 10',    rsi: avgRSI(tokens.slice(0, 10)) },
  ], [tokens])

  const stronger = refRSI !== null ? subsetTokens.filter(t => (t.rsi ?? 50) > refRSI).length : 0
  const weaker   = refRSI !== null ? subsetTokens.filter(t => (t.rsi ?? 50) < refRSI).length : 0

  const isFirstLoad  = loading && tokens.length === 0
  const isRefetching = loading && tokens.length > 0

  if (isFirstLoad) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--tm-text-muted)', padding: '8px 12px', background: 'var(--tm-bg-secondary)', borderRadius: 8, border: '1px solid var(--tm-border-sub)' }}>
        <div style={{ width: 16, height: 16, border: '2px solid var(--tm-border)', borderTopColor: 'var(--tm-accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
        {status}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {Array.from({ length: 40 }).map((_, i) => (
          <div key={i} style={{ width: 76, height: 58, borderRadius: 7, background: 'var(--tm-bg-secondary)', border: '1px solid var(--tm-border-sub)', animation: 'pulse 1.5s ease-in-out infinite' }} />
        ))}
      </div>
    </div>
  )

  return (
    <div>
      {isRefetching && <RefetchBadge />}

      {/* Filters */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        <FilterPills
          label="Afficher"
          options={[
            { value: 'all',   label: 'Tous (200)' },
            { value: 'top50', label: 'Top 50' },
            { value: 'alts',  label: 'Alts (hors BTC/ETH)' },
          ]}
          value={subset}
          onChange={(v: CryptoSubset) => { setSubset(v); setStrength('all') }}
        />
        {/* Comparison reference */}
        <CompareBar
          refOptions={refOptions}
          refKey={refKey}
          strengthFilter={strength}
          onRefChange={handleRefChange}
          onStrengthChange={setStrength}
          totalAll={subsetTokens.length}
          totalStronger={stronger}
          totalWeaker={weaker}
        />
      </div>

      {/* Divergence Scanner */}
      <DivergenceScanner tokens={finalTokens} onTokenClick={onTokenClick} />

      <div ref={shareRef}>
        <RsiHeatmap tokens={finalTokens} timeframe={timeframe} defaultTimeframe="1d" onTimeframeChange={setTimeframe} onTokenClick={onTokenClick} />
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════════

type Tab = 'crypto' | 'actions'

export default function MarchesPage() {
  const [tab, setTab] = useState<Tab>('crypto')
  const navigate = useNavigate()
  const cryptoShareRef = useRef<HTMLDivElement>(null)
  const stocksShareRef = useRef<HTMLDivElement>(null)

  const handleTokenClick = (symbol: string) => {
    localStorage.setItem('tm_analyse_symbol', tab === 'crypto' ? symbol + 'USDT' : symbol)
    navigate('/analyse')
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 20px', borderRadius: '8px 8px 0 0', border: 'none', cursor: 'pointer',
    fontSize: 13, fontWeight: active ? 600 : 400,
    background: active ? 'var(--tm-bg-card)' : 'transparent',
    color: active ? 'var(--tm-accent)' : 'var(--tm-text-muted)',
    borderBottom: active ? '2px solid var(--tm-accent)' : '2px solid transparent',
    transition: 'all 0.15s',
  })

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1600, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 20 }}>🌡️</span>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--tm-text-primary)', margin: 0, fontFamily: 'Syne, sans-serif' }}>Marchés</h1>
          </div>
          <p style={{ fontSize: 13, color: 'var(--tm-text-muted)', margin: 0 }}>
            Vue globale RSI & VMC — Top 200 crypto par volume · {STOCK_GROUPS.reduce((s, g) => s + g.symbols.length, 0)} actions mondiales
          </p>
        </div>
        <ShareButton targetRef={tab === 'crypto' ? cryptoShareRef : stocksShareRef} label={`marches-${tab}`} />
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--tm-border-sub)', marginBottom: 0 }}>
        <button onClick={() => setTab('crypto')}  style={tabStyle(tab === 'crypto')}>🪙 Crypto</button>
        <button onClick={() => setTab('actions')} style={tabStyle(tab === 'actions')}>📈 Actions</button>
      </div>

      <div style={{
        background: 'var(--tm-bg-card)', border: '1px solid var(--tm-border-sub)',
        borderTop: 'none', borderRadius: '0 0 14px 14px', padding: 20, position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg,transparent,var(--tm-accent),transparent)', opacity: 0.3 }} />
        {tab === 'crypto'  && <CryptoTab  onTokenClick={handleTokenClick} shareRef={cryptoShareRef} />}
        {tab === 'actions' && <StocksTab  onTokenClick={handleTokenClick} shareRef={stocksShareRef} />}
      </div>
    </div>
  )
}
