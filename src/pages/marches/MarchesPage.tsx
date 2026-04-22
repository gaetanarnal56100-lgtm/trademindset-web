// src/pages/marches/MarchesPage.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Page Marchés — RSI + VMC · 200 crypto + ~215 actions + Forex/Commodités
// Features: Funding Rates · Screener · MTF · Sector Rotation · Corrélation
// ─────────────────────────────────────────────────────────────────────────────

import { motion, AnimatePresence } from 'framer-motion'
import { createPortal } from 'react-dom'
import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'
import RsiHeatmap from '@/pages/analyse/RsiHeatmap'
import type { TokenRSI, Timeframe } from '@/pages/analyse/RsiHeatmap'
import AssetDetailSheet from './AssetDetailSheet'

const fbFunctions = getFunctions(app, 'europe-west1')

// ── Types ────────────────────────────────────────────────────────────────────

interface YahooCandle { t: number; o: number; h: number; l: number; c: number; v: number }
type YahooFn = { s: string; candles: YahooCandle[] }

type TokenRSIWithDiv = TokenRSI & {
  divergence?: 'bull' | 'bear'
  divergenceCandlesAgo?: number
  fundingRate?: number
  closes?: number[]
}

type CryptoSubset   = 'all' | 'top50' | 'alts'
type StockSubset    = 'all' | 'us' | 'europe' | 'cac40' | 'dax' | 'ftse' | 'asia' | 'etf'
type CryptoRef      = 'none' | 'btc' | 'eth' | 'top10avg'
type StockRef       = 'none' | 'spy' | 'qqq' | 'cac40avg' | 'sp500avg'
type StrengthFilter = 'all' | 'stronger' | 'weaker'
type Tab            = 'crypto' | 'actions' | 'forex'

// ── Screener ─────────────────────────────────────────────────────────────────

type RsiPreset    = 'all' | 'os' | 'neutral' | 'ob'
type VmcFilter    = 'all' | 'bull' | 'bear' | 'ob' | 'os'
type VolFilter    = 'all' | '10m' | '100m' | '1b'

interface ScreenerState {
  rsiPreset:   RsiPreset
  vmcZone:     VmcFilter
  volumeFilter: VolFilter
  divOnly:     boolean
}
const DEFAULT_SCREENER: ScreenerState = { rsiPreset:'all', vmcZone:'all', volumeFilter:'all', divOnly:false }

// ── MTF ───────────────────────────────────────────────────────────────────────

interface MTFData { rsi1h: number; rsi4h: number; rsi1d: number }

// ── Forex assets ──────────────────────────────────────────────────────────────

interface ForexAsset { symbol: string; displaySym: string; label: string; group: string }
const FOREX_ASSETS: ForexAsset[] = [
  { symbol: 'EURUSD=X', displaySym: 'EURUSD', label: 'EUR/USD', group: 'Forex' },
  { symbol: 'GBPUSD=X', displaySym: 'GBPUSD', label: 'GBP/USD', group: 'Forex' },
  { symbol: 'USDJPY=X', displaySym: 'USDJPY', label: 'USD/JPY', group: 'Forex' },
  { symbol: 'AUDUSD=X', displaySym: 'AUDUSD', label: 'AUD/USD', group: 'Forex' },
  { symbol: 'USDCHF=X', displaySym: 'USDCHF', label: 'USD/CHF', group: 'Forex' },
  { symbol: 'GC=F',     displaySym: 'Gold',   label: 'Gold',    group: 'Metals' },
  { symbol: 'SI=F',     displaySym: 'Silver',  label: 'Silver',  group: 'Metals' },
  { symbol: 'CL=F',     displaySym: 'WTI',     label: 'Oil WTI', group: 'Energy' },
  { symbol: 'BZ=F',     displaySym: 'Brent',   label: 'Brent',   group: 'Energy' },
  { symbol: 'BTC-USD',  displaySym: 'BTC',     label: 'BTC/USD', group: 'Crypto' },
]

// ── Crypto sectors (for rotation chart) ──────────────────────────────────────

const CRYPTO_SECTORS = [
  { label: 'Layer 1',  emoji: '⛓️',  symbols: ['BTC','ETH','SOL','ADA','AVAX','DOT','NEAR','ATOM'], color: '0,229,255' },
  { label: 'DeFi',     emoji: '🏦',  symbols: ['UNI','AAVE','CRV','COMP','MKR','SNX','BAL','SUSHI'], color: '10,133,255' },
  { label: 'Layer 2',  emoji: '⚡',  symbols: ['MATIC','ARB','OP','IMX','METIS'], color: '191,90,242' },
  { label: 'Meme',     emoji: '🐸',  symbols: ['DOGE','SHIB','PEPE','FLOKI','BONK','WIF'], color: '255,149,0' },
  { label: 'AI / Tech',emoji: '🤖',  symbols: ['FET','AGIX','RNDR','GRT','OCEAN'], color: '52,199,89' },
  { label: 'Exchange', emoji: '🔄',  symbols: ['BNB','OKB','HT'], color: '255,59,48' },
]

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
  '4h':  { interval: '1h',  range: '3mo' },
  '1d':  { interval: '1d',  range: '1mo' },
}

// ── RSI / VMC helpers ─────────────────────────────────────────────────────────

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

function findPivotLowIdxs(arr: number[], lb = 4, rb = 4): number[] {
  const pivots: number[] = []
  for (let i = lb; i < arr.length - rb; i++) {
    const v = arr[i]; let ok = true
    for (let j = i - lb; j <= i + rb; j++) { if (j !== i && arr[j] <= v) { ok = false; break } }
    if (ok) pivots.push(i)
  }
  return pivots
}

function findPivotHighIdxs(arr: number[], lb = 4, rb = 4): number[] {
  const pivots: number[] = []
  for (let i = lb; i < arr.length - rb; i++) {
    const v = arr[i]; let ok = true
    for (let j = i - lb; j <= i + rb; j++) { if (j !== i && arr[j] >= v) { ok = false; break } }
    if (ok) pivots.push(i)
  }
  return pivots
}

function detectRSIDivergence(closes: number[], rsiArr: number[], maxCandlesAgo = 4): { type: 'bull' | 'bear'; candlesAgo: number } | null {
  if (closes.length < 20 || rsiArr.length < 20) return null
  const n = closes.length
  const lows = findPivotLowIdxs(closes)
  if (lows.length >= 2) {
    const i1 = lows[lows.length - 2], i2 = lows[lows.length - 1]
    const candlesAgo = n - 1 - i2
    if (candlesAgo <= maxCandlesAgo && closes[i2] < closes[i1] && rsiArr[i2] > rsiArr[i1] + 2)
      return { type: 'bull', candlesAgo }
  }
  const highs = findPivotHighIdxs(closes)
  if (highs.length >= 2) {
    const i1 = highs[highs.length - 2], i2 = highs[highs.length - 1]
    const candlesAgo = n - 1 - i2
    if (candlesAgo <= maxCandlesAgo && closes[i2] > closes[i1] && rsiArr[i2] < rsiArr[i1] - 2)
      return { type: 'bear', candlesAgo }
  }
  return null
}

function calcWT1(candles: { o: number; h: number; l: number; c: number }[], n1 = 10, n2 = 21): number {
  try {
    if (candles.length < n1 + n2 + 5) return 0
    function ema(src: number[], period: number): number[] {
      if (src.length === 0) return []
      const k = 2 / (period + 1), out: number[] = [src[0] ?? 0]
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

// ── Colour helpers ────────────────────────────────────────────────────────────

function rsiColor(rsi: number): string {
  if (rsi < 30) return '#FF3B30'
  if (rsi < 45) return '#FF9500'
  if (rsi < 55) return '#94a3b8'
  if (rsi < 70) return '#22C759'
  return '#00E5FF'
}
function rsiBg(rsi: number): string {
  if (rsi < 30) return 'rgba(255,59,48,0.12)'
  if (rsi < 45) return 'rgba(255,149,0,0.12)'
  if (rsi < 55) return 'rgba(148,163,184,0.06)'
  if (rsi < 70) return 'rgba(34,199,89,0.12)'
  return 'rgba(0,229,255,0.12)'
}
function corrBg(val: number): string {
  if (val >= 0.99) return 'rgba(0,229,255,0.25)'
  if (val >= 0.7)  return 'rgba(0,229,255,0.18)'
  if (val >= 0.3)  return 'rgba(10,133,255,0.14)'
  if (val >= -0.3) return 'rgba(42,47,62,0.5)'
  if (val >= -0.7) return 'rgba(255,149,0,0.14)'
  return 'rgba(255,59,48,0.18)'
}
function corrText(val: number): string {
  if (val >= 0.99) return '#00E5FF'
  if (val >= 0.7)  return '#00E5FF'
  if (val >= 0.3)  return '#0A85FF'
  if (val >= -0.3) return '#64748b'
  if (val >= -0.7) return '#FF9500'
  return '#FF3B30'
}

// ── Pearson correlation ───────────────────────────────────────────────────────

function pearsonCorr(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 3) return 0
  const ra = a.slice(-n), rb = b.slice(-n)
  const da = ra.map((v, i) => i === 0 ? 0 : (v - ra[i - 1]) / (ra[i - 1] || 1))
  const db = rb.map((v, i) => i === 0 ? 0 : (v - rb[i - 1]) / (rb[i - 1] || 1))
  const mA = da.reduce((s, v) => s + v, 0) / n
  const mB = db.reduce((s, v) => s + v, 0) / n
  let cov = 0, vA = 0, vB = 0
  for (let i = 0; i < n; i++) {
    cov += (da[i] - mA) * (db[i] - mB); vA += (da[i] - mA) ** 2; vB += (db[i] - mB) ** 2
  }
  const denom = Math.sqrt(vA * vB)
  return denom === 0 ? 0 : +(cov / denom).toFixed(2)
}

// ── VMC zone helper ───────────────────────────────────────────────────────────

function getVMCZone(wt1: number): VmcFilter {
  if (wt1 > 53) return 'ob'
  if (wt1 < -53) return 'os'
  if (wt1 > 5) return 'bull'
  if (wt1 < -5) return 'bear'
  return 'all'
}

// ── Screener filter ───────────────────────────────────────────────────────────

function applyScreener(tokens: TokenRSIWithDiv[], s: ScreenerState): TokenRSIWithDiv[] {
  return tokens.filter(t => {
    if (s.rsiPreset === 'os'      && t.rsi >= 30) return false
    if (s.rsiPreset === 'neutral' && (t.rsi < 30 || t.rsi > 70)) return false
    if (s.rsiPreset === 'ob'      && t.rsi <= 70) return false
    if (s.vmcZone !== 'all') {
      const zone = getVMCZone(t.wt1 || 0)
      if (zone !== s.vmcZone) return false
    }
    const vol = t.volume || 0
    if (s.volumeFilter === '10m'  && vol < 10_000_000)  return false
    if (s.volumeFilter === '100m' && vol < 100_000_000) return false
    if (s.volumeFilter === '1b'   && vol < 1_000_000_000) return false
    if (s.divOnly && !t.divergence) return false
    return true
  })
}

// ── Stock groups ──────────────────────────────────────────────────────────────

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
      {label && <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(0,229,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', marginRight: 4 }}>{label}</span>}
      {options.map(o => {
        const active = value === o.value
        return (
          <motion.button key={o.value} onClick={() => onChange(o.value)} whileHover={{ y: -1 }}
            style={{
              padding: '4px 12px', borderRadius: 99, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${active ? 'rgba(0,229,255,0.5)' : 'rgba(255,255,255,0.07)'}`,
              background: active ? 'rgba(0,229,255,0.1)' : 'rgba(255,255,255,0.02)',
              color: active ? '#00E5FF' : 'rgba(148,163,184,0.6)',
              boxShadow: active ? '0 0 10px rgba(0,229,255,0.15)' : 'none',
              transition: 'all 0.15s',
            }}>
            {o.label}{o.sub ? <span style={{ fontSize: 9, opacity: 0.6, marginLeft: 4 }}>{o.sub}</span> : null}
          </motion.button>
        )
      })}
    </div>
  )
}

// ── Comparison bar ────────────────────────────────────────────────────────────

function CompareBar({
  refOptions, refKey, strengthFilter, onRefChange, onStrengthChange, totalAll, totalStronger, totalWeaker,
}: {
  refOptions: { value: string; label: string; rsi: number | null }[]
  refKey: string; strengthFilter: StrengthFilter
  onRefChange: (v: string) => void; onStrengthChange: (v: StrengthFilter) => void
  totalAll: number; totalStronger: number; totalWeaker: number
}) {
  const { t } = useTranslation()
  const hasRef = refKey !== 'none'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(191,90,242,0.6)', textTransform: 'uppercase', letterSpacing: '0.1em', marginRight: 4 }}>{t('marches.reference')}</span>
        {refOptions.map(opt => {
          const active = refKey === opt.value
          return (
            <motion.button key={opt.value} onClick={() => onRefChange(active ? 'none' : opt.value)} whileHover={{ y: -1 }}
              style={{
                padding: '4px 12px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                cursor: 'pointer', border: `1px solid ${active ? 'rgba(191,90,242,0.5)' : 'rgba(255,255,255,0.07)'}`,
                background: active ? 'rgba(191,90,242,0.12)' : 'rgba(255,255,255,0.02)',
                color: active ? '#BF5AF2' : 'rgba(148,163,184,0.6)',
                boxShadow: active ? '0 0 10px rgba(191,90,242,0.2)' : 'none',
                display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.15s',
              }}>
              {opt.label}
              {opt.rsi !== null && (
                <span style={{ fontSize: 10, fontWeight: 800, color: active ? '#BF5AF2' : 'rgba(148,163,184,0.5)', fontFamily: 'JetBrains Mono, monospace' }}>{opt.rsi}</span>
              )}
            </motion.button>
          )
        })}
      </div>
      {hasRef && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: 'rgba(148,163,184,0.4)', marginRight: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('marches.show')}</span>
          {([
            { v: 'stronger' as StrengthFilter, label: t('marches.strongest'), color: '#22c759', glow: '34,199,89',   count: totalStronger },
            { v: 'all'      as StrengthFilter, label: t('common.all'),        color: '#94a3b8', glow: '148,163,184', count: totalAll },
            { v: 'weaker'   as StrengthFilter, label: t('marches.weakest'),   color: '#ff3b5c', glow: '255,59,92',   count: totalWeaker },
          ]).map(({ v, label, color, glow, count }) => {
            const active = strengthFilter === v
            return (
              <motion.button key={v} onClick={() => onStrengthChange(v)} whileHover={{ y: -1 }}
                style={{
                  padding: '4px 12px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                  cursor: 'pointer', border: `1px solid ${active ? `rgba(${glow},0.5)` : 'rgba(255,255,255,0.07)'}`,
                  background: active ? `rgba(${glow},0.1)` : 'rgba(255,255,255,0.02)',
                  color: active ? color : 'rgba(148,163,184,0.5)',
                  boxShadow: active ? `0 0 10px rgba(${glow},0.18)` : 'none',
                  display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.15s',
                }}>
                {label}
                <span style={{ fontSize: 9, fontWeight: 800, background: active ? `rgba(${glow},0.15)` : 'rgba(255,255,255,0.04)', padding: '1px 6px', borderRadius: 99, color: active ? color : 'rgba(148,163,184,0.4)' }}>
                  {count}
                </span>
              </motion.button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

interface BinanceTicker { symbol: string; quoteVolume: string }
let _cachedCryptoSymbols: string[] | null = null
const _cachedVolumes: Record<string, number> = {}

async function getTopCryptoSymbols(n = 200): Promise<string[]> {
  if (_cachedCryptoSymbols) return _cachedCryptoSymbols
  const r = await fetch('https://api.binance.com/api/v3/ticker/24hr')
  const tickers: BinanceTicker[] = await r.json()
  const filtered = tickers
    .filter(t => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 500_000)
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, n)
  _cachedCryptoSymbols = filtered.map(t => t.symbol)
  filtered.forEach(t => { _cachedVolumes[t.symbol] = parseFloat(t.quoteVolume) })
  return _cachedCryptoSymbols
}

async function fetchFundingRates(): Promise<Record<string, number>> {
  try {
    const r = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex')
    const data: { symbol: string; lastFundingRate: string }[] = await r.json()
    const rates: Record<string, number> = {}
    data.forEach(d => {
      if (d.symbol.endsWith('USDT')) {
        rates[d.symbol.replace('USDT', '')] = parseFloat(d.lastFundingRate) || 0
      }
    })
    return rates
  } catch { return {} }
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
      const divResult = detectRSIDivergence(closes, rsiArr)
      const shortSym = sym.replace('USDT', '')
      return {
        symbol: shortSym,
        rsi: calcRSI(closes), wt1: calcWT1(candles),
        change24h: isNaN(change) ? 0 : change,
        volume: _cachedVolumes[sym] || volumes[volumes.length - 1],
        price: last,
        divergence: divResult?.type,
        divergenceCandlesAgo: divResult?.candlesAgo,
        closes: closes.slice(-30),
      } satisfies TokenRSIWithDiv
    }))
    results.push(...settled.flatMap(r => r.status === 'fulfilled' && r.value ? [r.value] : []))
  }
  return results
}

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
    const displaySym = symbol.replace(/\.(PA|DE|L|AS|SW|CO|ST|MI)$/, '').replace(/=.*$/, '').replace(/-USD$/, '')
    const change = prev.c !== 0 ? +((last.c - prev.c) / prev.c * 100).toFixed(2) : 0
    const rsiArr = calcRSIArr(closes)
    const divResult = detectRSIDivergence(closes, rsiArr)
    return {
      symbol: displaySym, rsi: calcRSI(closes), wt1: calcWT1(candles),
      change24h: isNaN(change) ? 0 : change, volume: last.v ?? 0, price: last.c,
      divergence: divResult?.type,
      divergenceCandlesAgo: divResult?.candlesAgo,
      closes: closes.slice(-30),
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

async function fetchMTFRSI(symbols: string[]): Promise<Record<string, MTFData>> {
  const result: Record<string, MTFData> = {}
  const BATCH = 8
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH)
    await Promise.allSettled(batch.map(async sym => {
      try {
        const s = sym + 'USDT'
        const gc = (rows: unknown[][]) => Array.isArray(rows)
          ? rows.map(k => parseFloat(k[4] as string)).filter(v => !isNaN(v))
          : []
        const [r1h, r4h, r1d] = await Promise.all([
          fetch(`https://api.binance.com/api/v3/klines?symbol=${s}&interval=1h&limit=80`).then(r => r.json()).catch(() => []),
          fetch(`https://api.binance.com/api/v3/klines?symbol=${s}&interval=4h&limit=60`).then(r => r.json()).catch(() => []),
          fetch(`https://api.binance.com/api/v3/klines?symbol=${s}&interval=1d&limit=60`).then(r => r.json()).catch(() => []),
        ])
        result[sym] = { rsi1h: calcRSI(gc(r1h)), rsi4h: calcRSI(gc(r4h)), rsi1d: calcRSI(gc(r1d)) }
      } catch { /* skip */ }
    }))
  }
  return result
}

// ── Skeleton + RefetchBadge ───────────────────────────────────────────────────

function SkeletonGroup({ label, count }: { label: string; count: number }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,229,255,0.4)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {Array.from({ length: count }).map((_, i) => (
          <motion.div key={i}
            animate={{ opacity: [0.3, 0.7, 0.3] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.04 }}
            style={{ width: 76, height: 58, borderRadius: 8, background: 'rgba(0,229,255,0.04)', border: '1px solid rgba(0,229,255,0.08)' }} />
        ))}
      </div>
    </div>
  )
}

function RefetchBadge() {
  const { t } = useTranslation()
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
      color: 'rgba(0,229,255,0.7)', padding: '4px 12px',
      background: 'rgba(0,229,255,0.05)', borderRadius: 99,
      border: '1px solid rgba(0,229,255,0.2)', marginBottom: 10,
    }}>
      <motion.div style={{ width: 8, height: 8, borderRadius: '50%', background: '#00E5FF', boxShadow: '0 0 6px #00E5FF' }}
        animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 0.8, repeat: Infinity }}/>
      {t('marches.updating')}
    </div>
  )
}

function avgRSI(tokens: TokenRSI[]): number | null {
  if (!tokens.length) return null
  return +(tokens.reduce((s, t) => s + (t.rsi ?? 50), 0) / tokens.length).toFixed(1)
}

// ── Divergence Scanner ────────────────────────────────────────────────────────

function DivergenceScanner({ tokens, onTokenClick, timeframe }: { tokens: TokenRSIWithDiv[]; onTokenClick: (sym: string) => void; timeframe: string }) {
  const { t } = useTranslation()
  const bulls = tokens.filter(tok => tok.divergence === 'bull')
  const bears = tokens.filter(tok => tok.divergence === 'bear')
  if (bulls.length === 0 && bears.length === 0) return null
  return (
    <motion.div initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.4 }}
      style={{ marginBottom: 16, padding: '14px 16px', background: 'rgba(8,12,22,0.8)', border: '1px solid rgba(0,229,255,0.15)', borderRadius: 12, backdropFilter: 'blur(12px)', position: 'relative', overflow: 'hidden', boxShadow: '0 0 30px rgba(0,229,255,0.04)' }}>
      <div style={{ position:'absolute', top:0, left:0, right:0, height:1, background:'linear-gradient(90deg,transparent,rgba(0,229,255,0.4),transparent)'}}/>
      <motion.div style={{ position:'absolute', bottom:0, left:0, height:2, width:'30%', background:'linear-gradient(90deg,transparent,rgba(0,229,255,0.6),transparent)', pointerEvents:'none' }}
        animate={{ left:['-30%','130%'] }} transition={{ duration:3, repeat:Infinity, ease:'linear', repeatDelay:2 }}/>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <motion.div style={{ width:8, height:8, borderRadius:'50%', background:'#00E5FF', boxShadow:'0 0 8px #00E5FF' }}
          animate={{ opacity:[1,0.2,1], scale:[1,1.2,1] }} transition={{ duration:1.5, repeat:Infinity }}/>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(226,232,240,0.9)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('marches.rsiDivDetected')}</span>
        <span style={{ fontSize: 9, color: 'rgba(0,229,255,0.5)', fontFamily: 'JetBrains Mono, monospace', background: 'rgba(0,229,255,0.08)', padding: '2px 7px', borderRadius: 4, border: '1px solid rgba(0,229,255,0.15)' }}>UT {timeframe.toUpperCase()}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {bulls.length > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: '#22C764', background: 'rgba(34,199,100,0.1)', padding: '2px 9px', borderRadius: 99, border: '1px solid rgba(34,199,100,0.3)' }}>↗ {bulls.length} BULL</span>}
          {bears.length > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: '#FF3B30', background: 'rgba(255,59,48,0.1)', padding: '2px 9px', borderRadius: 99, border: '1px solid rgba(255,59,48,0.3)' }}>↘ {bears.length} BEAR</span>}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {bulls.map((tok, i) => (
          <motion.button key={tok.symbol} onClick={() => onTokenClick(tok.symbol)}
            initial={{ opacity:0, scale:0.9 }} animate={{ opacity:1, scale:1 }} transition={{ delay: i * 0.04 }}
            whileHover={{ y:-2, boxShadow:'0 4px 16px rgba(34,199,100,0.25)' }}
            style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:2, padding:'7px 11px', borderRadius:8, cursor:'pointer', background:'rgba(34,199,100,0.07)', border:'1px solid rgba(34,199,100,0.3)', color:'#22C764', fontSize:11, fontWeight:700, fontFamily:'JetBrains Mono, monospace' }}>
            <span style={{ display:'flex', alignItems:'center', gap:5 }}>
              <span style={{ fontSize:10 }}>↗</span> {tok.symbol}
              <span style={{ fontSize:9, color:'rgba(148,163,184,0.6)', fontWeight:400, background:'rgba(34,199,100,0.1)', padding:'1px 5px', borderRadius:4 }}>RSI {tok.rsi}</span>
            </span>
            {tok.divergenceCandlesAgo !== undefined && (
              <span style={{ fontSize:9, color:'rgba(148,163,184,0.5)', fontWeight:400 }}>{t('marches.candlesAgo', { count: tok.divergenceCandlesAgo })}</span>
            )}
          </motion.button>
        ))}
        {bears.map((tok, i) => (
          <motion.button key={tok.symbol} onClick={() => onTokenClick(tok.symbol)}
            initial={{ opacity:0, scale:0.9 }} animate={{ opacity:1, scale:1 }} transition={{ delay: (bulls.length + i) * 0.04 }}
            whileHover={{ y:-2, boxShadow:'0 4px 16px rgba(255,59,48,0.25)' }}
            style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:2, padding:'7px 11px', borderRadius:8, cursor:'pointer', background:'rgba(255,59,48,0.07)', border:'1px solid rgba(255,59,48,0.3)', color:'#FF3B30', fontSize:11, fontWeight:700, fontFamily:'JetBrains Mono, monospace' }}>
            <span style={{ display:'flex', alignItems:'center', gap:5 }}>
              <span style={{ fontSize:10 }}>↘</span> {tok.symbol}
              <span style={{ fontSize:9, color:'rgba(148,163,184,0.6)', fontWeight:400, background:'rgba(255,59,48,0.1)', padding:'1px 5px', borderRadius:4 }}>RSI {tok.rsi}</span>
            </span>
            {tok.divergenceCandlesAgo !== undefined && (
              <span style={{ fontSize:9, color:'rgba(148,163,184,0.5)', fontWeight:400 }}>{t('marches.candlesAgo', { count: tok.divergenceCandlesAgo })}</span>
            )}
          </motion.button>
        ))}
      </div>
    </motion.div>
  )
}

// ── Funding Rates Panel ───────────────────────────────────────────────────────

function FundingRatesPanel({ rates, tokens }: { rates: Record<string, number>; tokens: TokenRSIWithDiv[] }) {
  const topTokenSymbols = tokens.slice(0, 25).map(t => t.symbol)
  const items = topTokenSymbols
    .map(sym => ({ sym, rate: rates[sym] ?? null }))
    .filter(x => x.rate !== null)
    .sort((a, b) => Math.abs(b.rate!) - Math.abs(a.rate!))

  if (!items.length) return null
  return (
    <div style={{ marginBottom: 12, padding: '10px 12px', background: 'rgba(8,12,22,0.7)', border: '1px solid rgba(0,229,255,0.1)', borderRadius: 10, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position:'absolute', top:0, left:0, right:0, height:1, background:'linear-gradient(90deg,transparent,rgba(0,229,255,0.3),transparent)'}}/>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
        <span style={{ fontSize:10, fontWeight:700, color:'rgba(0,229,255,0.6)', textTransform:'uppercase', letterSpacing:'0.08em' }}>⚡ Funding Rates</span>
        <span style={{ fontSize:9, color:'rgba(148,163,184,0.4)', fontFamily:'JetBrains Mono, monospace' }}>toutes les 8h · Binance Futures</span>
      </div>
      <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
        {items.map(({ sym, rate }) => {
          const isPos = (rate ?? 0) >= 0
          const pct = ((rate ?? 0) * 100).toFixed(4)
          const color = isPos ? '#22C759' : '#FF3B30'
          const bg    = isPos ? 'rgba(34,199,89,0.1)' : 'rgba(255,59,48,0.1)'
          const bord  = isPos ? 'rgba(34,199,89,0.25)' : 'rgba(255,59,48,0.25)'
          return (
            <div key={sym} style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 9px', borderRadius:7, background:bg, border:`1px solid ${bord}` }}>
              <span style={{ fontSize:10, fontWeight:700, color:'rgba(226,232,240,0.8)', fontFamily:'JetBrains Mono, monospace' }}>{sym}</span>
              <span style={{ fontSize:9, fontWeight:700, color, fontFamily:'JetBrains Mono, monospace' }}>{isPos ? '+' : ''}{pct}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Screener Panel ────────────────────────────────────────────────────────────

function ScreenerPanel({ state, onChange, onReset, resultCount }: {
  state: ScreenerState
  onChange: (s: ScreenerState) => void
  onReset: () => void
  resultCount: number
}) {
  const isActive = state.rsiPreset !== 'all' || state.vmcZone !== 'all' || state.volumeFilter !== 'all' || state.divOnly

  const pill = (label: string, active: boolean, onClick: () => void, color = '0,229,255') => (
    <motion.button onClick={onClick} whileHover={{ y:-1 }}
      style={{
        padding:'3px 10px', borderRadius:99, fontSize:11, fontWeight:600, cursor:'pointer',
        border:`1px solid ${active ? `rgba(${color},0.5)` : 'rgba(255,255,255,0.07)'}`,
        background: active ? `rgba(${color},0.12)` : 'rgba(255,255,255,0.02)',
        color: active ? `rgb(${color})` : 'rgba(148,163,184,0.5)',
        transition:'all 0.15s',
      }}>
      {label}
    </motion.button>
  )

  return (
    <motion.div initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:'auto' }} exit={{ opacity:0, height:0 }}
      style={{ marginBottom:12, padding:'12px 14px', background:'rgba(8,12,22,0.8)', border:'1px solid rgba(0,229,255,0.15)', borderRadius:10, overflow:'hidden', position:'relative' }}>
      <div style={{ position:'absolute', top:0, left:0, right:0, height:1, background:'linear-gradient(90deg,transparent,rgba(0,229,255,0.3),transparent)'}}/>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:12, fontWeight:700, color:'rgba(226,232,240,0.9)' }}>🔍 Screener</span>
          <span style={{ fontSize:10, fontWeight:700, color:'#00E5FF', background:'rgba(0,229,255,0.1)', padding:'2px 8px', borderRadius:99, border:'1px solid rgba(0,229,255,0.25)', fontFamily:'JetBrains Mono, monospace' }}>
            {resultCount} résultats
          </span>
        </div>
        {isActive && (
          <motion.button onClick={onReset} whileHover={{ scale:1.05 }}
            style={{ fontSize:10, color:'rgba(255,59,48,0.7)', background:'rgba(255,59,48,0.08)', border:'1px solid rgba(255,59,48,0.2)', borderRadius:6, padding:'2px 8px', cursor:'pointer' }}>
            Réinitialiser
          </motion.button>
        )}
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {/* RSI */}
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
          <span style={{ fontSize:9, fontWeight:700, color:'rgba(0,229,255,0.5)', textTransform:'uppercase', letterSpacing:'0.1em', width:50 }}>RSI</span>
          {pill('Tous', state.rsiPreset === 'all', () => onChange({ ...state, rsiPreset:'all' }))}
          {pill('Survendu < 30', state.rsiPreset === 'os', () => onChange({ ...state, rsiPreset:'os' }), '255,59,48')}
          {pill('Neutre 30–70', state.rsiPreset === 'neutral', () => onChange({ ...state, rsiPreset:'neutral' }), '148,163,184')}
          {pill('Suracheté > 70', state.rsiPreset === 'ob', () => onChange({ ...state, rsiPreset:'ob' }), '0,229,255')}
        </div>

        {/* VMC */}
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
          <span style={{ fontSize:9, fontWeight:700, color:'rgba(0,229,255,0.5)', textTransform:'uppercase', letterSpacing:'0.1em', width:50 }}>VMC</span>
          {pill('Tous', state.vmcZone === 'all', () => onChange({ ...state, vmcZone:'all' }))}
          {pill('Haussier', state.vmcZone === 'bull', () => onChange({ ...state, vmcZone:'bull' }), '34,199,89')}
          {pill('Baissier', state.vmcZone === 'bear', () => onChange({ ...state, vmcZone:'bear' }), '255,59,48')}
          {pill('Suracheté', state.vmcZone === 'ob', () => onChange({ ...state, vmcZone:'ob' }), '0,229,255')}
          {pill('Survendu', state.vmcZone === 'os', () => onChange({ ...state, vmcZone:'os' }), '191,90,242')}
        </div>

        {/* Volume + Divergence */}
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
          <span style={{ fontSize:9, fontWeight:700, color:'rgba(0,229,255,0.5)', textTransform:'uppercase', letterSpacing:'0.1em', width:50 }}>Vol.</span>
          {pill('Tous', state.volumeFilter === 'all', () => onChange({ ...state, volumeFilter:'all' }))}
          {pill('> $10M', state.volumeFilter === '10m', () => onChange({ ...state, volumeFilter:'10m' }))}
          {pill('> $100M', state.volumeFilter === '100m', () => onChange({ ...state, volumeFilter:'100m' }))}
          {pill('> $1B', state.volumeFilter === '1b', () => onChange({ ...state, volumeFilter:'1b' }))}
          <div style={{ marginLeft:8 }}>
            {pill(state.divOnly ? '✓ Divergences only' : '📡 Divergences only', state.divOnly, () => onChange({ ...state, divOnly: !state.divOnly }), '255,149,0')}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ── MTF View ──────────────────────────────────────────────────────────────────

function getMTFAlign(rsi1h: number, rsi4h: number, rsi1d: number): 'bull' | 'bear' | 'mixed' {
  const ib = (r: number) => r > 55, ibs = (r: number) => r < 45
  if (ib(rsi1h) && ib(rsi4h) && ib(rsi1d)) return 'bull'
  if (ibs(rsi1h) && ibs(rsi4h) && ibs(rsi1d)) return 'bear'
  return 'mixed'
}

function MTFView({ tokens, onTokenClick }: { tokens: TokenRSIWithDiv[]; onTokenClick: (s: string) => void }) {
  const [mtfData, setMtfData] = useState<Record<string, MTFData>>({})
  const [loading, setLoading] = useState(true)
  const symbols = tokens.map(t => t.symbol)

  useEffect(() => {
    setLoading(true)
    fetchMTFRSI(symbols).then(d => { setMtfData(d); setLoading(false) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(',')])

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', gap:4, marginTop:8 }}>
      {tokens.map((t, i) => (
        <motion.div key={t.symbol} animate={{ opacity:[0.3,0.7,0.3] }} transition={{ duration:1.5, repeat:Infinity, delay:i*0.04 }}
          style={{ height:38, borderRadius:8, background:'rgba(0,229,255,0.04)', border:'1px solid rgba(0,229,255,0.08)' }} />
      ))}
    </div>
  )

  const RSICell = ({ rsi }: { rsi: number }) => (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2, padding:'4px 10px', borderRadius:6, background:rsiBg(rsi), border:`1px solid ${rsiColor(rsi)}30` }}>
      <span style={{ fontSize:13, fontWeight:800, color:rsiColor(rsi), fontFamily:'JetBrains Mono, monospace' }}>{rsi}</span>
    </div>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:3, marginTop:8 }}>
      {/* Header */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 90px 90px 90px 80px', gap:8, padding:'4px 12px', marginBottom:4 }}>
        <span style={{ fontSize:9, fontWeight:700, color:'rgba(0,229,255,0.4)', textTransform:'uppercase' }}>Asset</span>
        {['RSI 1H','RSI 4H','RSI 1D'].map(l => (
          <span key={l} style={{ fontSize:9, fontWeight:700, color:'rgba(0,229,255,0.4)', textTransform:'uppercase', textAlign:'center' }}>{l}</span>
        ))}
        <span style={{ fontSize:9, fontWeight:700, color:'rgba(0,229,255,0.4)', textTransform:'uppercase', textAlign:'center' }}>Align.</span>
      </div>
      {tokens.map((tok, i) => {
        const mtf = mtfData[tok.symbol]
        const align = mtf ? getMTFAlign(mtf.rsi1h, mtf.rsi4h, mtf.rsi1d) : 'mixed'
        const alignLabel = align === 'bull' ? '⚡ Bull' : align === 'bear' ? '↓ Bear' : '— Mix'
        const alignColor = align === 'bull' ? '#22C759' : align === 'bear' ? '#FF3B30' : '#94a3b8'
        return (
          <motion.div key={tok.symbol}
            initial={{ opacity:0, x:-8 }} animate={{ opacity:1, x:0 }} transition={{ delay:i*0.02 }}
            onClick={() => onTokenClick(tok.symbol)}
            whileHover={{ backgroundColor:'rgba(0,229,255,0.04)' }}
            style={{ display:'grid', gridTemplateColumns:'1fr 90px 90px 90px 80px', gap:8, padding:'6px 12px', borderRadius:8, border:'1px solid rgba(0,229,255,0.06)', cursor:'pointer', alignItems:'center', background:'rgba(8,12,22,0.5)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:12, fontWeight:700, color:'rgba(226,232,240,0.9)', fontFamily:'JetBrains Mono, monospace' }}>{tok.symbol}</span>
              <span style={{ fontSize:10, color: tok.change24h >= 0 ? '#22C759' : '#FF3B30' }}>{tok.change24h >= 0 ? '+' : ''}{tok.change24h}%</span>
            </div>
            {mtf ? (
              <>
                <RSICell rsi={mtf.rsi1h} />
                <RSICell rsi={mtf.rsi4h} />
                <RSICell rsi={mtf.rsi1d} />
              </>
            ) : (
              <><div style={{ height:28 }}/><div style={{ height:28 }}/><div style={{ height:28 }}/></>
            )}
            <div style={{ textAlign:'center', fontSize:11, fontWeight:700, color:alignColor }}>
              {align === 'bull' || align === 'bear' ? alignLabel : <span style={{ color:'rgba(148,163,184,0.4)' }}>—</span>}
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}

// ── Sector Rotation Panel ─────────────────────────────────────────────────────

function SectorRotationPanel({ tokens, onClose }: { tokens: TokenRSIWithDiv[]; onClose: () => void }) {
  const sectors = CRYPTO_SECTORS.map(sector => {
    const st = tokens.filter(t => sector.symbols.includes(t.symbol))
    const avg = avgRSI(st) ?? 50
    const top = [...st].sort((a, b) => b.rsi - a.rsi)[0]
    return { ...sector, avgRSI: avg, count: st.length, top }
  }).sort((a, b) => b.avgRSI - a.avgRSI)

  return createPortal(
    <div style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <motion.div initial={{ opacity:0, scale:0.95, y:20 }} animate={{ opacity:1, scale:1, y:0 }} exit={{ opacity:0, scale:0.95 }}
        onClick={e => e.stopPropagation()}
        style={{ width:'min(520px,90vw)', background:'rgba(8,12,22,0.97)', border:'1px solid rgba(0,229,255,0.2)', borderRadius:16, padding:'24px', position:'relative', overflow:'hidden', boxShadow:'0 0 60px rgba(0,229,255,0.08)' }}>
        <div style={{ position:'absolute', top:0, left:0, right:0, height:1, background:'linear-gradient(90deg,transparent,rgba(0,229,255,0.5),transparent)'}}/>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:18 }}>🔄</span>
            <span style={{ fontSize:16, fontWeight:800, color:'rgba(226,232,240,0.95)', fontFamily:'Syne, sans-serif' }}>Rotation Sectorielle</span>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, color:'rgba(148,163,184,0.6)', fontSize:16, cursor:'pointer', width:32, height:32, display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {sectors.map((sector, i) => {
            const pct = (sector.avgRSI / 100) * 100
            const color = sector.color
            return (
              <div key={sector.label}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:5 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontSize:14 }}>{sector.emoji}</span>
                    <span style={{ fontSize:12, fontWeight:700, color:'rgba(226,232,240,0.9)' }}>{sector.label}</span>
                    <span style={{ fontSize:9, color:`rgba(${color},0.5)`, background:`rgba(${color},0.08)`, padding:'1px 6px', borderRadius:99, border:`1px solid rgba(${color},0.2)` }}>{sector.count} tokens</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    {sector.top && <span style={{ fontSize:10, color:'rgba(148,163,184,0.5)', fontFamily:'JetBrains Mono, monospace' }}>↑ {sector.top.symbol} {sector.top.rsi}</span>}
                    <span style={{ fontSize:13, fontWeight:800, color:`rgb(${color})`, fontFamily:'JetBrains Mono, monospace' }}>{sector.avgRSI}</span>
                  </div>
                </div>
                <div style={{ height:6, background:'rgba(255,255,255,0.04)', borderRadius:3, overflow:'hidden' }}>
                  <motion.div initial={{ width:0 }} animate={{ width:`${pct}%` }} transition={{ duration:0.8, delay:i*0.07, ease:'easeOut' }}
                    style={{ height:'100%', background:`linear-gradient(90deg, rgba(${color},0.6), rgba(${color},0.9))`, borderRadius:3, boxShadow:`0 0 8px rgba(${color},0.4)` }} />
                </div>
              </div>
            )
          })}
        </div>

        <p style={{ fontSize:10, color:'rgba(148,163,184,0.3)', textAlign:'center', marginTop:16, marginBottom:0 }}>
          RSI moyen par secteur · données Binance 1D
        </p>
      </motion.div>
    </div>,
    document.body
  )
}

// ── Correlation Matrix ────────────────────────────────────────────────────────

function CorrelationMatrix({ tokens, onClose }: { tokens: TokenRSIWithDiv[]; onClose: () => void }) {
  const assets = tokens.filter(t => t.closes && t.closes.length >= 5).slice(0, 10)
  const matrix = assets.map(a => assets.map(b => a.symbol === b.symbol ? 1 : pearsonCorr(a.closes!, b.closes!)))

  return createPortal(
    <div style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,0.88)', display:'flex', alignItems:'center', justifyContent:'center', padding:16, overflowY:'auto' }} onClick={onClose}>
      <motion.div initial={{ opacity:0, scale:0.95, y:20 }} animate={{ opacity:1, scale:1, y:0 }} exit={{ opacity:0, scale:0.95 }}
        onClick={e => e.stopPropagation()}
        style={{ background:'rgba(8,12,22,0.97)', border:'1px solid rgba(0,229,255,0.2)', borderRadius:16, padding:'24px', position:'relative', overflow:'auto', boxShadow:'0 0 60px rgba(0,229,255,0.08)', maxWidth:'90vw' }}>
        <div style={{ position:'absolute', top:0, left:0, right:0, height:1, background:'linear-gradient(90deg,transparent,rgba(0,229,255,0.5),transparent)'}}/>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:18 }}>🔗</span>
            <span style={{ fontSize:16, fontWeight:800, color:'rgba(226,232,240,0.95)', fontFamily:'Syne, sans-serif' }}>Matrice de Corrélation</span>
            <span style={{ fontSize:9, color:'rgba(0,229,255,0.5)', fontFamily:'JetBrains Mono, monospace', background:'rgba(0,229,255,0.08)', padding:'2px 7px', borderRadius:4, border:'1px solid rgba(0,229,255,0.15)' }}>Pearson · Returns 1D</span>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, color:'rgba(148,163,184,0.6)', fontSize:16, cursor:'pointer', width:32, height:32, display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
        </div>

        {assets.length < 2 ? (
          <p style={{ color:'rgba(148,163,184,0.5)', fontSize:12 }}>Données insuffisantes. Chargez d'abord les crypto.</p>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ borderCollapse:'separate', borderSpacing:3 }}>
              <thead>
                <tr>
                  <th style={{ width:60 }}/>
                  {assets.map(a => (
                    <th key={a.symbol} style={{ fontSize:9, fontWeight:700, color:'rgba(0,229,255,0.6)', textAlign:'center', padding:'0 4px', fontFamily:'JetBrains Mono, monospace', whiteSpace:'nowrap' }}>{a.symbol}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {assets.map((a, row) => (
                  <tr key={a.symbol}>
                    <td style={{ fontSize:9, fontWeight:700, color:'rgba(0,229,255,0.6)', paddingRight:8, fontFamily:'JetBrains Mono, monospace', whiteSpace:'nowrap', verticalAlign:'middle' }}>{a.symbol}</td>
                    {matrix[row].map((val, col) => (
                      <td key={col}>
                        <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:(row*assets.length+col)*0.01 }}
                          style={{ width:52, height:36, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, background:corrBg(val), border:`1px solid ${corrText(val)}20` }}>
                          <span style={{ fontSize:11, fontWeight:700, color:corrText(val), fontFamily:'JetBrains Mono, monospace' }}>{val.toFixed(2)}</span>
                        </motion.div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display:'flex', gap:8, marginTop:16, flexWrap:'wrap' }}>
          {[['> 0.7','Forte corrélation +','0,229,255'],['0.3 à 0.7','Corrélation mod.','10,133,255'],['−0.3 à 0.3','Neutre','100,116,139'],['−0.7 à −0.3','Corrélation mod. −','255,149,0'],['< −0.7','Forte corrélation −','255,59,48']].map(([range, label, color]) => (
            <div key={range} style={{ display:'flex', alignItems:'center', gap:5 }}>
              <div style={{ width:12, height:12, borderRadius:3, background:`rgba(${color},0.25)`, border:`1px solid rgba(${color},0.4)` }}/>
              <span style={{ fontSize:9, color:'rgba(148,163,184,0.5)' }}>{range} · {label}</span>
            </div>
          ))}
        </div>
      </motion.div>
    </div>,
    document.body
  )
}

// ── Forex Tab ─────────────────────────────────────────────────────────────────

function ForexTab({ onTokenClick, shareRef }: { onTokenClick: (sym: string) => void; shareRef: React.RefObject<HTMLDivElement> }) {
  const [tokens, setTokens] = useState<TokenRSIWithDiv[]>([])
  const [loading, setLoading] = useState(true)
  const [timeframe, setTimeframe] = useState<Timeframe>('1d')

  useEffect(() => {
    let cancelled = false
    setLoading(true); setTokens([])
    ;(async () => {
      const settled = await Promise.allSettled(FOREX_ASSETS.map(asset => fetchStockRSI(asset.symbol, timeframe)))
      if (cancelled) return
      const result: TokenRSIWithDiv[] = []
      settled.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value) {
          result.push({ ...r.value, symbol: FOREX_ASSETS[i].displaySym })
        }
      })
      setTokens(result)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [timeframe])

  const GROUPS = ['Forex', 'Metals', 'Energy', 'Crypto']

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div style={{ padding:'12px 16px', background:'rgba(8,12,22,0.8)', border:'1px solid rgba(0,229,255,0.15)', borderRadius:10, backdropFilter:'blur(8px)', position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', top:0, left:0, right:0, height:1, background:'linear-gradient(90deg,transparent,rgba(0,229,255,0.4),transparent)'}}/>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
          <motion.div style={{ width:8, height:8, borderRadius:'50%', background:'#00E5FF', boxShadow:'0 0 6px #00E5FF' }}
            animate={{ opacity:[1,0.2,1] }} transition={{ duration:0.8, repeat:Infinity }}/>
          <span style={{ fontSize:11, color:'rgba(0,229,255,0.7)', fontFamily:'JetBrains Mono, monospace', fontWeight:600 }}>Chargement Forex & Matières premières via Yahoo Finance…</span>
        </div>
        <div style={{ height:2, background:'rgba(0,229,255,0.08)', borderRadius:1, overflow:'hidden', position:'relative' }}>
          <motion.div style={{ position:'absolute', top:0, left:0, height:'100%', width:'35%', background:'linear-gradient(90deg,transparent,rgba(0,229,255,0.8),transparent)' }}
            animate={{ left:['-35%','100%'] }} transition={{ duration:1.5, repeat:Infinity, ease:'linear' }}/>
        </div>
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <motion.div key={i} animate={{ opacity:[0.2,0.6,0.2] }} transition={{ duration:1.5, repeat:Infinity, delay:i*0.08 }}
            style={{ width:90, height:58, borderRadius:8, background:'rgba(0,229,255,0.04)', border:'1px solid rgba(0,229,255,0.08)' }} />
        ))}
      </div>
    </div>
  )

  return (
    <div>
      <div style={{ marginBottom:12 }}>
        <FilterPills
          label="Timeframe"
          options={(['1d','4h','1h'] as Timeframe[]).map(v => ({ value:v, label:v.toUpperCase() }))}
          value={timeframe}
          onChange={setTimeframe}
        />
      </div>

      {GROUPS.map(group => {
        const groupAssets = FOREX_ASSETS.filter(a => a.group === group)
        const groupTokens = groupAssets.map(a => tokens.find(t => t.symbol === a.displaySym)).filter(Boolean) as TokenRSIWithDiv[]
        if (!groupTokens.length) return null

        const groupLabels: Record<string, string> = { Forex:'💱 Paires Forex', Metals:'🥇 Métaux', Energy:'🛢️ Énergie', Crypto:'₿ Crypto' }
        return (
          <div key={group} style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'rgba(0,229,255,0.5)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:10 }}>{groupLabels[group]}</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {groupTokens.map((tok, i) => {
                const isPos = tok.change24h >= 0
                return (
                  <motion.button key={tok.symbol}
                    initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ delay:i*0.05 }}
                    whileHover={{ y:-3, boxShadow:'0 8px 24px rgba(0,229,255,0.12)' }}
                    onClick={() => onTokenClick(tok.symbol)}
                    style={{ display:'flex', flexDirection:'column', gap:4, padding:'10px 14px', borderRadius:10, cursor:'pointer', background:'rgba(8,12,22,0.8)', border:`1px solid ${rsiColor(tok.rsi)}20`, textAlign:'left', minWidth:100 }}>
                    <span style={{ fontSize:11, fontWeight:700, color:'rgba(226,232,240,0.85)', fontFamily:'JetBrains Mono, monospace' }}>{tok.symbol}</span>
                    <span style={{ fontSize:15, fontWeight:800, color:rsiColor(tok.rsi), fontFamily:'JetBrains Mono, monospace' }}>RSI {tok.rsi}</span>
                    <span style={{ fontSize:10, color: isPos ? '#22C759' : '#FF3B30' }}>{isPos ? '+' : ''}{tok.change24h}%</span>
                  </motion.button>
                )
              })}
            </div>
          </div>
        )
      })}

      <div ref={shareRef} style={{ display:'none' }} />
    </div>
  )
}

// ── Stocks Tab ────────────────────────────────────────────────────────────────

function StocksTab({ onTokenClick, shareRef }: { onTokenClick: (sym: string) => void; shareRef: React.RefObject<HTMLDivElement> }) {
  const { t } = useTranslation()
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

  const handleRefChange = (v: string) => { setRefKey(v as StockRef); setStrength('all') }

  const subsetTokens = useMemo(() => {
    const allowedGroups = STOCK_SUBSET_GROUPS[subset]
    return STOCK_GROUPS.filter(g => allowedGroups.includes(g.label)).flatMap(g => groupData[g.label] ?? [])
  }, [groupData, subset])

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
        <div style={{ marginBottom:14, padding:'10px 14px', background:'rgba(8,12,22,0.8)', border:'1px solid rgba(0,229,255,0.15)', borderRadius:10, backdropFilter:'blur(8px)', position:'relative', overflow:'hidden' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
            <motion.div style={{ width:8, height:8, borderRadius:'50%', background:'#00E5FF', boxShadow:'0 0 6px #00E5FF', flexShrink:0 }}
              animate={{ opacity:[1,0.2,1] }} transition={{ duration:0.8, repeat:Infinity }}/>
            <span style={{ fontSize:11, color:'rgba(0,229,255,0.7)', fontFamily:'JetBrains Mono, monospace', fontWeight:600 }}>
              Chargement… {totalLoaded}/{totalSymbols} actions · {loadedGroups.size}/{STOCK_GROUPS.length} groupes
            </span>
          </div>
          <div style={{ height:2, background:'rgba(0,229,255,0.08)', borderRadius:1, overflow:'hidden' }}>
            <motion.div
              style={{ height:'100%', background:'linear-gradient(90deg,#0A85FF,#00E5FF)', borderRadius:1, boxShadow:'0 0 8px rgba(0,229,255,0.5)' }}
              animate={{ width:`${(loadedGroups.size / STOCK_GROUPS.length) * 100}%` }}
              transition={{ duration:0.4, ease:'easeOut' }}/>
          </div>
        </div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:12 }}>
        <FilterPills
          label="Indice"
          options={[
            { value:'all',    label:t('common.all') },
            { value:'us',     label:'🇺🇸 US' },
            { value:'europe', label:'🇪🇺 Europe' },
            { value:'cac40',  label:'🇫🇷 CAC 40' },
            { value:'dax',    label:'🇩🇪 DAX' },
            { value:'ftse',   label:'🇬🇧 FTSE' },
            { value:'asia',   label:'🌏 Asie' },
            { value:'etf',    label:'📊 ETF' },
          ]}
          value={subset}
          onChange={(v: StockSubset) => { setSubset(v); setStrength('all') }}
        />
        <CompareBar
          refOptions={refOptions} refKey={refKey} strengthFilter={strength}
          onRefChange={handleRefChange} onStrengthChange={setStrength}
          totalAll={subsetTokens.length} totalStronger={stronger} totalWeaker={weaker}
        />
      </div>

      {isFirstLoad && STOCK_GROUPS.filter(g => !loadedGroups.has(g.label)).map(g => {
        const prog = groupProgress[g.label]
        return <SkeletonGroup key={g.label} label={`${g.label} ${prog ? `(${prog.done}/${prog.total})` : ''}`} count={g.symbols.length} />
      })}

      {finalTokens.length > 0 && <DivergenceScanner tokens={finalTokens as TokenRSIWithDiv[]} onTokenClick={onTokenClick} timeframe={timeframe} />}

      {finalTokens.length > 0 && (
        <div ref={shareRef}>
          <RsiHeatmap tokens={finalTokens} timeframe={timeframe} defaultTimeframe="1d" onTimeframeChange={setTimeframe} onTokenClick={onTokenClick} />
        </div>
      )}
    </div>
  )
}

// ── Crypto Tab ────────────────────────────────────────────────────────────────

function CryptoTab({ onTokenClick, shareRef }: { onTokenClick: (sym: string) => void; shareRef: React.RefObject<HTMLDivElement> }) {
  const { t } = useTranslation()
  const [tokens,    setTokens]    = useState<TokenRSIWithDiv[]>([])
  const [loading,   setLoading]   = useState(true)
  const [timeframe, setTimeframe] = useState<Timeframe>('1d')
  const [subset,    setSubset]    = useState<CryptoSubset>('all')
  const [refKey,    setRefKey]    = useState<CryptoRef>('none')
  const [strength,  setStrength]  = useState<StrengthFilter>('all')
  const [status,    setStatus]    = useState('')

  // New feature state
  const [fundingRates, setFundingRates]   = useState<Record<string, number>>({})
  const [screenerOpen, setScreenerOpen]   = useState(false)
  const [screener,     setScreener]       = useState<ScreenerState>(DEFAULT_SCREENER)
  const [mtfMode,      setMtfMode]        = useState(false)
  const [showSector,   setShowSector]     = useState(false)
  const [showCorr,     setShowCorr]       = useState(false)

  useEffect(() => {
    fetchFundingRates().then(setFundingRates)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        setStatus(t('marches.fetchingBinance'))
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

  const subsetTokens = useMemo(() => {
    if (subset === 'top50') return tokens.slice(0, 50)
    if (subset === 'alts')  return tokens.filter(t => t.symbol !== 'BTC' && t.symbol !== 'ETH')
    return tokens
  }, [tokens, subset])

  const refRSI = useMemo((): number | null => {
    if (refKey === 'none') return null
    if (refKey === 'btc')      return tokens.find(t => t.symbol === 'BTC')?.rsi ?? null
    if (refKey === 'eth')      return tokens.find(t => t.symbol === 'ETH')?.rsi ?? null
    if (refKey === 'top10avg') return avgRSI(tokens.slice(0, 10))
    return null
  }, [tokens, refKey])

  const finalTokens = useMemo(() => {
    if (refKey === 'none' || refRSI === null || strength === 'all') return subsetTokens
    if (strength === 'stronger') return subsetTokens.filter(t => (t.rsi ?? 50) > refRSI)
    return subsetTokens.filter(t => (t.rsi ?? 50) < refRSI)
  }, [subsetTokens, refKey, refRSI, strength])

  const screenerTokens = useMemo(() => applyScreener(finalTokens, screener), [finalTokens, screener])

  const screenerActive = screener.rsiPreset !== 'all' || screener.vmcZone !== 'all' || screener.volumeFilter !== 'all' || screener.divOnly

  const refOptions = useMemo(() => [
    { value:'btc',      label:'BTC',         rsi: tokens.find(t => t.symbol === 'BTC')?.rsi ?? null },
    { value:'eth',      label:'ETH',         rsi: tokens.find(t => t.symbol === 'ETH')?.rsi ?? null },
    { value:'top10avg', label:'Moy. Top 10', rsi: avgRSI(tokens.slice(0, 10)) },
  ], [tokens])

  const stronger = refRSI !== null ? subsetTokens.filter(t => (t.rsi ?? 50) > refRSI).length : 0
  const weaker   = refRSI !== null ? subsetTokens.filter(t => (t.rsi ?? 50) < refRSI).length : 0

  const isFirstLoad  = loading && tokens.length === 0
  const isRefetching = loading && tokens.length > 0

  const ToolBtn = ({ label, active, onClick, color = '0,229,255' }: { label: string; active?: boolean; onClick: () => void; color?: string }) => (
    <motion.button onClick={onClick} whileHover={{ y:-1 }}
      style={{
        padding:'5px 12px', borderRadius:8, fontSize:11, fontWeight:600, cursor:'pointer',
        border:`1px solid ${active ? `rgba(${color},0.5)` : 'rgba(255,255,255,0.08)'}`,
        background: active ? `rgba(${color},0.12)` : 'rgba(255,255,255,0.02)',
        color: active ? `rgb(${color})` : 'rgba(148,163,184,0.5)',
        boxShadow: active ? `0 0 10px rgba(${color},0.15)` : 'none',
        transition:'all 0.15s', display:'flex', alignItems:'center', gap:4,
      }}>
      {label}
      {screenerActive && label.includes('Screener') && (
        <span style={{ fontSize:9, fontWeight:800, background:`rgba(${color},0.2)`, padding:'1px 5px', borderRadius:99, color:`rgb(${color})` }}>{screenerTokens.length}</span>
      )}
    </motion.button>
  )

  if (isFirstLoad) return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div style={{ padding:'12px 16px', background:'rgba(8,12,22,0.8)', border:'1px solid rgba(0,229,255,0.15)', borderRadius:10, backdropFilter:'blur(8px)', position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', top:0, left:0, right:0, height:1, background:'linear-gradient(90deg,transparent,rgba(0,229,255,0.4),transparent)'}}/>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
          <motion.div style={{ width:8, height:8, borderRadius:'50%', background:'#00E5FF', boxShadow:'0 0 6px #00E5FF' }}
            animate={{ opacity:[1,0.2,1] }} transition={{ duration:0.8, repeat:Infinity }}/>
          <span style={{ fontSize:11, color:'rgba(0,229,255,0.7)', fontFamily:'JetBrains Mono, monospace', fontWeight:600 }}>{status}</span>
        </div>
        <div style={{ height:2, background:'rgba(0,229,255,0.08)', borderRadius:1, overflow:'hidden', position:'relative' }}>
          <motion.div style={{ position:'absolute', top:0, left:0, height:'100%', width:'35%', background:'linear-gradient(90deg,transparent,rgba(0,229,255,0.8),transparent)' }}
            animate={{ left:['-35%','100%'] }} transition={{ duration:1.5, repeat:Infinity, ease:'linear' }}/>
        </div>
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
        {Array.from({ length: 40 }).map((_, i) => (
          <motion.div key={i} animate={{ opacity:[0.2,0.6,0.2] }} transition={{ duration:1.5, repeat:Infinity, delay:i*0.03 }}
            style={{ width:76, height:58, borderRadius:8, background:'rgba(0,229,255,0.04)', border:'1px solid rgba(0,229,255,0.08)' }} />
        ))}
      </div>
    </div>
  )

  return (
    <div>
      {isRefetching && <RefetchBadge />}

      {/* Funding Rates strip */}
      {Object.keys(fundingRates).length > 0 && <FundingRatesPanel rates={fundingRates} tokens={tokens} />}

      {/* Filters row */}
      <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:10 }}>
        <FilterPills
          label={t('marches.show')}
          options={[
            { value:'all',   label:t('marches.allCount', { count:200 }) },
            { value:'top50', label:'Top 50' },
            { value:'alts',  label:'Alts (hors BTC/ETH)' },
          ]}
          value={subset}
          onChange={(v: CryptoSubset) => { setSubset(v); setStrength('all') }}
        />
        <CompareBar
          refOptions={refOptions} refKey={refKey} strengthFilter={strength}
          onRefChange={handleRefChange} onStrengthChange={setStrength}
          totalAll={subsetTokens.length} totalStronger={stronger} totalWeaker={weaker}
        />
      </div>

      {/* Tool buttons row */}
      <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:10 }}>
        <ToolBtn label="🔍 Screener" active={screenerOpen || screenerActive} onClick={() => setScreenerOpen(o => !o)} />
        <ToolBtn label="📊 Multi-TF" active={mtfMode} onClick={() => setMtfMode(m => !m)} color="191,90,242" />
        <ToolBtn label="🔄 Rotation" onClick={() => setShowSector(true)} color="52,199,89" />
        <ToolBtn label="🔗 Corrélation" onClick={() => setShowCorr(true)} color="255,149,0" />
      </div>

      {/* Screener panel */}
      <AnimatePresence>
        {screenerOpen && (
          <ScreenerPanel state={screener} onChange={setScreener} onReset={() => setScreener(DEFAULT_SCREENER)} resultCount={screenerTokens.length} />
        )}
      </AnimatePresence>

      {/* Divergence Scanner */}
      <DivergenceScanner tokens={screenerTokens} onTokenClick={onTokenClick} timeframe={timeframe} />

      {/* Main content */}
      {mtfMode ? (
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12, padding:'8px 12px', background:'rgba(191,90,242,0.06)', border:'1px solid rgba(191,90,242,0.2)', borderRadius:8 }}>
            <span style={{ fontSize:11, color:'rgba(191,90,242,0.8)', fontWeight:600 }}>📊 Mode Multi-Timeframe · RSI 1H / 4H / 1D</span>
            <span style={{ fontSize:10, color:'rgba(148,163,184,0.4)' }}>
              {screenerTokens.slice(0,30).length} assets · {screenerTokens.length > 30 ? 'limité à 30, activez le screener pour filtrer' : ''}
            </span>
          </div>
          <MTFView tokens={screenerTokens.slice(0, 30)} onTokenClick={onTokenClick} />
        </div>
      ) : (
        <div ref={shareRef}>
          <RsiHeatmap tokens={screenerTokens} timeframe={timeframe} defaultTimeframe="1d" onTimeframeChange={setTimeframe} onTokenClick={onTokenClick} />
        </div>
      )}

      {/* Modals via portal (escape backdrop-filter stacking context) */}
      <AnimatePresence>
        {showSector && <SectorRotationPanel tokens={tokens} onClose={() => setShowSector(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {showCorr && <CorrelationMatrix tokens={tokens} onClose={() => setShowCorr(false)} />}
      </AnimatePresence>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════════

export default function MarchesPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('crypto')
  const navigate = useNavigate()
  const cryptoShareRef = useRef<HTMLDivElement>(null)
  const stocksShareRef = useRef<HTMLDivElement>(null)
  const forexShareRef  = useRef<HTMLDivElement>(null)

  const [sheetSymbol,   setSheetSymbol]   = useState<string | null>(null)
  const [sheetIsCrypto, setSheetIsCrypto] = useState(false)

  const handleTokenClick = (symbol: string) => {
    setSheetSymbol(symbol)
    setSheetIsCrypto(tab === 'crypto')
  }

  const handleOpenAnalysis = (symbol: string) => {
    localStorage.setItem('tm_analyse_symbol', sheetIsCrypto ? symbol + 'USDT' : symbol)
    navigate('/app/analyse')
  }

  const totalStocks = STOCK_GROUPS.reduce((s, g) => s + g.symbols.length, 0)

  const TABS: { id: Tab; label: string; glow: string }[] = [
    { id:'crypto',  label:'🪙 Crypto',     glow:'191,90,242' },
    { id:'actions', label:'📈 Actions',    glow:'10,133,255' },
    { id:'forex',   label:'💱 Forex & Commodités', glow:'52,199,89' },
  ]

  const activeRef = tab === 'crypto' ? cryptoShareRef : tab === 'actions' ? stocksShareRef : forexShareRef

  return (
    <div style={{ padding:'24px 28px', maxWidth:1600, margin:'0 auto',
      backgroundImage:'linear-gradient(rgba(0,229,255,0.02) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,0.02) 1px,transparent 1px)',
      backgroundSize:'40px 40px',
    }}>
      {/* ── Header HUD ── */}
      <div style={{ marginBottom:20 }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
              <div style={{ width:36, height:36, borderRadius:10, background:'rgba(0,229,255,0.08)', border:'1px solid rgba(0,229,255,0.2)', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 0 16px rgba(0,229,255,0.1)' }}>
                <span style={{ fontSize:18 }}>🌡️</span>
              </div>
              <motion.h1
                initial={{ opacity:0, x:-10 }} animate={{ opacity:1, x:0 }}
                style={{ fontSize:24, fontWeight:800, margin:0, fontFamily:'Syne, sans-serif', letterSpacing:'-0.02em',
                  background:'linear-gradient(90deg, #00E5FF, #0A85FF)',
                  WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent',
                  filter:'drop-shadow(0 0 12px rgba(0,229,255,0.3))',
                }}>
                {t('nav.marches')}
              </motion.h1>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
              {[
                { label:'200 Crypto', glow:'191,90,242' },
                { label:`${totalStocks} Actions`, glow:'10,133,255' },
                { label:'Forex · Métaux · Énergie', glow:'52,199,89' },
                { label:'RSI · VMC · Divergences', glow:'0,229,255' },
                { label:'🔴 Live Binance', glow:'255,59,48' },
              ].map(({ label, glow }) => (
                <span key={label} style={{ fontSize:10, fontWeight:600, color:`rgb(${glow})`, background:`rgba(${glow},0.08)`, border:`1px solid rgba(${glow},0.2)`, padding:'3px 9px', borderRadius:99, letterSpacing:'0.04em' }}>
                  {label}
                </span>
              ))}
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <ShareButton targetRef={activeRef} label={`marches-${tab}`} />
          </div>
        </div>
      </div>

      {/* ── Tab Navigation ── */}
      <div style={{ display:'flex', gap:6, marginBottom:0, alignItems:'center' }}>
        {TABS.map(({ id, label, glow }) => {
          const active = tab === id
          return (
            <motion.button key={id} onClick={() => setTab(id)} whileHover={{ y:-1 }}
              style={{
                padding:'9px 22px', borderRadius:'10px 10px 0 0', border:'none', cursor:'pointer',
                fontSize:13, fontWeight:active ? 700 : 500,
                background: active ? `rgba(${glow},0.1)` : 'rgba(255,255,255,0.02)',
                color: active ? `rgb(${glow})` : 'rgba(148,163,184,0.5)',
                borderTop:    `1px solid ${active ? `rgba(${glow},0.4)` : 'rgba(255,255,255,0.06)'}`,
                borderLeft:   `1px solid ${active ? `rgba(${glow},0.4)` : 'rgba(255,255,255,0.06)'}`,
                borderRight:  `1px solid ${active ? `rgba(${glow},0.4)` : 'rgba(255,255,255,0.06)'}`,
                borderBottom: active ? `2px solid rgb(${glow})` : '2px solid transparent',
                boxShadow: active ? `0 -4px 16px rgba(${glow},0.12), inset 0 1px 0 rgba(${glow},0.1)` : 'none',
                transition:'all 0.2s',
              }}>
              {label}
            </motion.button>
          )
        })}
        <div style={{ flex:1, height:1, alignSelf:'flex-end', background:'rgba(255,255,255,0.06)', marginBottom:2 }}/>
      </div>

      {/* ── Content container ── */}
      <div style={{
        background:'rgba(8,12,22,0.75)', border:'1px solid rgba(0,229,255,0.1)',
        borderTop:'none', borderRadius:'0 12px 12px 12px', padding:'20px 20px 24px', position:'relative', overflow:'hidden',
        backdropFilter:'blur(12px)', boxShadow:'0 8px 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(0,229,255,0.06)',
      }}>
        <div style={{ position:'absolute', top:0, left:0, right:0, height:1, background:'linear-gradient(90deg,transparent,rgba(0,229,255,0.25),transparent)'}}/>
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-8 }} transition={{ duration:0.25 }}>
            {tab === 'crypto'  && <CryptoTab onTokenClick={handleTokenClick} shareRef={cryptoShareRef} />}
            {tab === 'actions' && <StocksTab onTokenClick={handleTokenClick} shareRef={stocksShareRef} />}
            {tab === 'forex'   && <ForexTab  onTokenClick={handleTokenClick} shareRef={forexShareRef}  />}
          </motion.div>
        </AnimatePresence>
      </div>

      {sheetSymbol && (
        <AssetDetailSheet
          symbol={sheetSymbol}
          isCrypto={sheetIsCrypto}
          onClose={() => setSheetSymbol(null)}
          onOpenAnalysis={() => handleOpenAnalysis(sheetSymbol)}
        />
      )}
    </div>
  )
}
