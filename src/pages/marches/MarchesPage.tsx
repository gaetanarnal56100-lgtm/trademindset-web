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
import MultiAssetAnalytics from '@/pages/analytics/MultiAssetAnalytics'

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
type StockSubset    = 'all' | 'us' | 'europe' | 'cac40' | 'dax' | 'ftse' | 'asia' | 'etf' | 'brics' | 'reit' | 'biotech' | 'canada'
type CryptoRef      = 'none' | 'btc' | 'eth' | 'top10avg'
type StockRef       = 'none' | 'spy' | 'qqq' | 'cac40avg' | 'sp500avg'
type StrengthFilter = 'all' | 'stronger' | 'weaker'
type Tab            = 'crypto' | 'actions' | 'forex' | 'multiasset'

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
  // ── Majeurs ──
  { symbol: 'EURUSD=X', displaySym: 'EURUSD', label: 'EUR/USD', group: 'Forex' },
  { symbol: 'GBPUSD=X', displaySym: 'GBPUSD', label: 'GBP/USD', group: 'Forex' },
  { symbol: 'USDJPY=X', displaySym: 'USDJPY', label: 'USD/JPY', group: 'Forex' },
  { symbol: 'AUDUSD=X', displaySym: 'AUDUSD', label: 'AUD/USD', group: 'Forex' },
  { symbol: 'USDCHF=X', displaySym: 'USDCHF', label: 'USD/CHF', group: 'Forex' },
  { symbol: 'USDCAD=X', displaySym: 'USDCAD', label: 'USD/CAD', group: 'Forex' },
  { symbol: 'NZDUSD=X', displaySym: 'NZDUSD', label: 'NZD/USD', group: 'Forex' },
  // ── Croisés ──
  { symbol: 'EURGBP=X', displaySym: 'EURGBP', label: 'EUR/GBP', group: 'Forex' },
  { symbol: 'EURJPY=X', displaySym: 'EURJPY', label: 'EUR/JPY', group: 'Forex' },
  { symbol: 'GBPJPY=X', displaySym: 'GBPJPY', label: 'GBP/JPY', group: 'Forex' },
  { symbol: 'EURCHF=X', displaySym: 'EURCHF', label: 'EUR/CHF', group: 'Forex' },
  { symbol: 'AUDJPY=X', displaySym: 'AUDJPY', label: 'AUD/JPY', group: 'Forex' },
  { symbol: 'EURAUD=X', displaySym: 'EURAUD', label: 'EUR/AUD', group: 'Forex' },
  { symbol: 'EURCAD=X', displaySym: 'EURCAD', label: 'EUR/CAD', group: 'Forex' },
  { symbol: 'GBPAUD=X', displaySym: 'GBPAUD', label: 'GBP/AUD', group: 'Forex' },
  { symbol: 'CADJPY=X', displaySym: 'CADJPY', label: 'CAD/JPY', group: 'Forex' },
  { symbol: 'CHFJPY=X', displaySym: 'CHFJPY', label: 'CHF/JPY', group: 'Forex' },
  { symbol: 'NZDJPY=X', displaySym: 'NZDJPY', label: 'NZD/JPY', group: 'Forex' },
  // ── Exotiques ──
  { symbol: 'USDMXN=X', displaySym: 'USDMXN', label: 'USD/MXN', group: 'Forex' },
  { symbol: 'USDNOK=X', displaySym: 'USDNOK', label: 'USD/NOK', group: 'Forex' },
  { symbol: 'USDSEK=X', displaySym: 'USDSEK', label: 'USD/SEK', group: 'Forex' },
  { symbol: 'USDSGD=X', displaySym: 'USDSGD', label: 'USD/SGD', group: 'Forex' },
  { symbol: 'USDBRL=X', displaySym: 'USDBRL', label: 'USD/BRL', group: 'Forex' },
  { symbol: 'USDTRY=X', displaySym: 'USDTRY', label: 'USD/TRY', group: 'Forex' },
  { symbol: 'USDZAR=X', displaySym: 'USDZAR', label: 'USD/ZAR', group: 'Forex' },
  { symbol: 'USDPLN=X', displaySym: 'USDPLN', label: 'USD/PLN', group: 'Forex' },
  { symbol: 'USDHUF=X', displaySym: 'USDHUF', label: 'USD/HUF', group: 'Forex' },
  { symbol: 'USDCZK=X', displaySym: 'USDCZK', label: 'USD/CZK', group: 'Forex' },
  { symbol: 'USDTHB=X', displaySym: 'USDTHB', label: 'USD/THB', group: 'Forex' },
  { symbol: 'USDINR=X', displaySym: 'USDINR', label: 'USD/INR', group: 'Forex' },
  // ── Métaux précieux ──
  { symbol: 'GC=F',  displaySym: 'Gold',    label: 'Gold (XAU)',      group: 'Metals' },
  { symbol: 'SI=F',  displaySym: 'Silver',  label: 'Silver (XAG)',    group: 'Metals' },
  { symbol: 'PL=F',  displaySym: 'Plat',    label: 'Platinum (XPT)',  group: 'Metals' },
  { symbol: 'PA=F',  displaySym: 'Palla',   label: 'Palladium (XPD)', group: 'Metals' },
  { symbol: 'HG=F',  displaySym: 'Copper',  label: 'Copper',          group: 'Metals' },
  { symbol: 'ALI=F', displaySym: 'Alumin',  label: 'Aluminium',       group: 'Metals' },
  // ── Énergie ──
  { symbol: 'CL=F',  displaySym: 'WTI',     label: 'Oil WTI',         group: 'Energy' },
  { symbol: 'BZ=F',  displaySym: 'Brent',   label: 'Brent',           group: 'Energy' },
  { symbol: 'NG=F',  displaySym: 'NatGas',  label: 'Natural Gas',     group: 'Energy' },
  { symbol: 'HO=F',  displaySym: 'HeatOil', label: 'Heating Oil',     group: 'Energy' },
  { symbol: 'RB=F',  displaySym: 'RBOB',    label: 'RBOB Gasoline',   group: 'Energy' },
  { symbol: 'UX=F',  displaySym: 'Uranium', label: 'Uranium',         group: 'Energy' },
  // ── Agricoles ──
  { symbol: 'ZW=F',  displaySym: 'Wheat',   label: 'Blé (Wheat)',     group: 'Agri' },
  { symbol: 'ZC=F',  displaySym: 'Corn',    label: 'Maïs (Corn)',     group: 'Agri' },
  { symbol: 'ZS=F',  displaySym: 'Soja',    label: 'Soja (Soybeans)', group: 'Agri' },
  { symbol: 'CC=F',  displaySym: 'Cocoa',   label: 'Cacao (Cocoa)',   group: 'Agri' },
  { symbol: 'KC=F',  displaySym: 'Coffee',  label: 'Café (Coffee)',   group: 'Agri' },
  { symbol: 'SB=F',  displaySym: 'Sugar',   label: 'Sucre (Sugar)',   group: 'Agri' },
  { symbol: 'CT=F',  displaySym: 'Cotton',  label: 'Coton (Cotton)',  group: 'Agri' },
  { symbol: 'OJ=F',  displaySym: 'OrangeJ', label: 'Jus d\'orange',  group: 'Agri' },
  // ── Indices Futures ──
  { symbol: 'ES=F',  displaySym: 'SP500',   label: 'S&P 500 Fut',    group: 'Indices' },
  { symbol: 'NQ=F',  displaySym: 'Nasdaq',  label: 'NASDAQ Fut',     group: 'Indices' },
  { symbol: 'YM=F',  displaySym: 'Dow',     label: 'Dow Jones Fut',  group: 'Indices' },
  { symbol: 'RTY=F', displaySym: 'Russell', label: 'Russell 2000',   group: 'Indices' },
  { symbol: 'GD=F',  displaySym: 'DAX',     label: 'DAX Fut',        group: 'Indices' },
  { symbol: 'NKD=F', displaySym: 'Nikkei',  label: 'Nikkei 225 Fut', group: 'Indices' },
  { symbol: '^VIX',  displaySym: 'VIX',     label: 'VIX (Fear)',     group: 'Indices' },
  // ── Crypto (référence) ──
  { symbol: 'BTC-USD', displaySym: 'BTC', label: 'BTC/USD', group: 'Crypto' },
  { symbol: 'ETH-USD', displaySym: 'ETH', label: 'ETH/USD', group: 'Crypto' },
  { symbol: 'SOL-USD', displaySym: 'SOL', label: 'SOL/USD', group: 'Crypto' },
]

// ── Crypto sectors (for rotation chart) ──────────────────────────────────────

const CRYPTO_SECTORS = [
  { label: 'Layer 1',    emoji: '⛓️',  symbols: ['BTC','ETH','SOL','ADA','AVAX','DOT','NEAR','ATOM','APT','SUI','TIA','HBAR','ALGO','VET'], color: '0,229,255' },
  { label: 'DeFi',       emoji: '🏦',  symbols: ['UNI','AAVE','CRV','COMP','MKR','SNX','BAL','SUSHI','RUNE','CAKE','GMX','DYDX','LDO'], color: '10,133,255' },
  { label: 'Layer 2',    emoji: '⚡',  symbols: ['MATIC','ARB','OP','IMX','METIS','LRC','BOBA','ZKS'], color: '191,90,242' },
  { label: 'Meme',       emoji: '🐸',  symbols: ['DOGE','SHIB','PEPE','FLOKI','BONK','WIF','MEME','TURBO'], color: '255,149,0' },
  { label: 'AI / Tech',  emoji: '🤖',  symbols: ['FET','AGIX','RNDR','GRT','OCEAN','WLD','TAO','ARKM','PHALA'], color: '52,199,89' },
  { label: 'Exchange',   emoji: '🔄',  symbols: ['BNB','OKB','HT','CRO','KCS','GT'], color: '255,59,48' },
  { label: 'GameFi',     emoji: '🎮',  symbols: ['AXS','SAND','MANA','ENJ','GALA','ILV','YGG','BEAM'], color: '255,195,0' },
  { label: 'Interop',    emoji: '🌉',  symbols: ['LINK','BAND','API3','UMA','PYTH','JUP'], color: '100,200,255' },
  { label: 'Privacy',    emoji: '🔒',  symbols: ['XMR','ZEC','DASH','SCRT','ROSE'], color: '150,150,150' },
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
      'ARM','SMCI','DELL','HPE','WDC','AMAT','LRCX','KLAC','MRVL','AVGO',
    ],
  },
  {
    label: '🇺🇸 US Finance',
    symbols: [
      'JPM','GS','MS','BAC','V','MA','COIN','WFC','BLK','C',
      'AXP','SCHW','SPGI','MCO','ICE','PGR','MET','PRU','AON','MMC',
      'TFC','USB','FITB','KEY','CFG','HOOD','SQ','AFRM','SOFI','UPST',
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
    label: '💊 Biotech',
    symbols: [
      'ILMN','BMRN','INCY','ALNY','RETA','RCKT','BEAM','CRSP','EDIT','NTLA',
      'ARVN','KYMR','PCVX','RXRX','SAGE','ZNTL','TBIO','IMVT','ACMR','CCXI',
    ],
  },
  {
    label: '🇺🇸 US Industrie & Énergie',
    symbols: [
      'XOM','CVX','BA','CAT','GE','HON','RTX','LMT','DE','MMM',
      'EMR','ETN','GD','NOC','FDX','UPS','WM','CSX','NSC','COP',
      'EOG','SLB','HAL','OXY','MPC','VST','CEG','NRG','FSLR','ENPH',
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
    label: '🏘️ Immobilier (REIT)',
    symbols: [
      'AMT','PLD','EQR','SPG','O','DLR','VTR','WELL','CCI','PSA',
      'AVB','EXR','ARE','BXP','WPC','NNN','STAG','REXR','ELS','SBA',
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
      'AIR.DE','MBB.DE','PUMA.DE','ZAL.DE','CARL.DE',
    ],
  },
  {
    label: '🇬🇧 FTSE 100',
    symbols: [
      'HSBA.L','BP.L','SHEL.L','AZN.L','ULVR.L','LLOY.L','GSK.L',
      'RIO.L','BT-A.L','BATS.L','NG.L','LGEN.L','STAN.L',
      'EXPN.L','REL.L','WPP.L','IMB.L','GLEN.L','AAL.L','PRU.L',
      'BARC.L','VOD.L','DGE.L','BA.L','MNDI.L',
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
      'ITX.MC','SAN.MC','BBVA.MC','IBE.MC','TEF.MC',
    ],
  },
  {
    label: '🌏 Asie & Japon',
    symbols: [
      'TSM','TM','HMC','SONY','7203.T','6758.T','9984.T','8306.T','8316.T',
      'NTT','NTDOY','FUJIY','MUFG','SMFG','KB','SHG','LG',
    ],
  },
  {
    label: '🌍 BRICS & Émergents',
    symbols: [
      'BABA','JD','PDD','BIDU','NIO','XPEV','LI','TCOM','EDU','TAL',
      'VALE','PBR','ITUB','BBD','ABEV',
      'INFY','WIT','HDB','IBN','VEDL',
      'GOLD','HL','AG','PAAS',
    ],
  },
  {
    label: '🇨🇦 Canada',
    symbols: [
      'RY','TD','BNS','ENB','CNQ','SU','CCO','ABX','FM','G',
      'CP','CNR','MFC','SLF','BCE',
    ],
  },
  {
    label: '📊 ETF & Indices',
    symbols: [
      'SPY','QQQ','IWM','EEM','EFA','VTI','VOO','VEA','VWO','IEFA',
      'GLD','SLV','USO','GDX','IAU',
      'TLT','HYG','LQD','VXX','PDBC',
      'ARKK','ARKG','ARKF','SMH','SOXX','XBI','XLF','XLE','XLK','XLV',
    ],
  },
]

const STOCK_SUBSET_GROUPS: Record<StockSubset, string[]> = {
  all:     STOCK_GROUPS.map(g => g.label),
  us:      ['🇺🇸 US Tech','🇺🇸 US Finance','🇺🇸 US Santé','💊 Biotech','🇺🇸 US Industrie & Énergie','🇺🇸 US Consommation & Médias'],
  europe:  ['🇫🇷 CAC 40','🇩🇪 DAX','🇬🇧 FTSE 100','🇪🇺 Europe (Autres)'],
  cac40:   ['🇫🇷 CAC 40'],
  dax:     ['🇩🇪 DAX'],
  ftse:    ['🇬🇧 FTSE 100'],
  asia:    ['🌏 Asie & Japon','🌍 BRICS & Émergents'],
  etf:     ['📊 ETF & Indices'],
  brics:   ['🌍 BRICS & Émergents'],
  reit:    ['🏘️ Immobilier (REIT)'],
  biotech: ['💊 Biotech'],
  canada:  ['🇨🇦 Canada'],
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

function ScreenerPanel({ state, onChange, onReset, resultCount, hideVolume = false }: {
  state: ScreenerState
  onChange: (s: ScreenerState) => void
  onReset: () => void
  resultCount: number
  hideVolume?: boolean
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
          {!hideVolume && <>
            <span style={{ fontSize:9, fontWeight:700, color:'rgba(0,229,255,0.5)', textTransform:'uppercase', letterSpacing:'0.1em', width:50 }}>Vol.</span>
            {pill('Tous', state.volumeFilter === 'all', () => onChange({ ...state, volumeFilter:'all' }))}
            {pill('> $10M', state.volumeFilter === '10m', () => onChange({ ...state, volumeFilter:'10m' }))}
            {pill('> $100M', state.volumeFilter === '100m', () => onChange({ ...state, volumeFilter:'100m' }))}
            {pill('> $1B', state.volumeFilter === '1b', () => onChange({ ...state, volumeFilter:'1b' }))}
          </>}
          <div style={{ marginLeft: hideVolume ? 0 : 8 }}>
            {pill(state.divOnly ? '✓ Divergences only' : '📡 Divergences only', state.divOnly, () => onChange({ ...state, divOnly: !state.divOnly }), '255,149,0')}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ── Forex MTF fetcher (Yahoo Finance — 1H / 1D / 1W) ─────────────────────────

const FOREX_DISPLAY_TO_YAHOO: Record<string, string> = Object.fromEntries(
  FOREX_ASSETS.map(a => [a.displaySym, a.symbol])
)

async function fetchMTFForexRSI(displaySymbols: string[]): Promise<Record<string, MTFData>> {
  const result: Record<string, MTFData> = {}
  await Promise.allSettled(displaySymbols.map(async ds => {
    try {
      const yahooSym = FOREX_DISPLAY_TO_YAHOO[ds]
      if (!yahooSym) return
      const fn = httpsCallable<Record<string, unknown>, YahooFn>(fbFunctions, 'fetchYahooCandles')
      const [r1h, r1d, r1w] = await Promise.all([
        fn({ symbol: yahooSym, interval: '1h',  range: '1mo' }),
        fn({ symbol: yahooSym, interval: '1d',  range: '3mo' }),
        fn({ symbol: yahooSym, interval: '1wk', range: '1y'  }),
      ])
      const gc = (res: { data: YahooFn }) => res.data.s === 'ok' ? res.data.candles.map(c => c.c).filter(v => !isNaN(v)) : []
      result[ds] = { rsi1h: calcRSI(gc(r1h)), rsi4h: calcRSI(gc(r1d)), rsi1d: calcRSI(gc(r1w)) }
    } catch { /* skip */ }
  }))
  return result
}

// ── Generic Rotation Panel (stocks / forex) ───────────────────────────────────

interface RotationItem { label: string; emoji?: string; avgRSI: number; count: number; color: string; topLabel?: string }

function GenericRotationPanel({ title, subtitle, items, onClose }: {
  title: string; subtitle?: string; items: RotationItem[]; onClose: () => void
}) {
  const sorted = [...items].filter(i => i.count > 0).sort((a, b) => b.avgRSI - a.avgRSI)

  return createPortal(
    <div style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <motion.div initial={{ opacity:0, scale:0.95, y:20 }} animate={{ opacity:1, scale:1, y:0 }} exit={{ opacity:0, scale:0.95 }}
        onClick={e => e.stopPropagation()}
        style={{ width:'min(540px,90vw)', background:'rgba(8,12,22,0.97)', border:'1px solid rgba(52,199,89,0.2)', borderRadius:16, padding:'24px', position:'relative', overflow:'hidden', boxShadow:'0 0 60px rgba(52,199,89,0.06)' }}>
        <div style={{ position:'absolute', top:0, left:0, right:0, height:1, background:'linear-gradient(90deg,transparent,rgba(52,199,89,0.5),transparent)'}}/>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:18 }}>🔄</span>
            <div>
              <span style={{ fontSize:16, fontWeight:800, color:'rgba(226,232,240,0.95)', fontFamily:'Syne, sans-serif' }}>{title}</span>
              {subtitle && <div style={{ fontSize:10, color:'rgba(148,163,184,0.4)', marginTop:2 }}>{subtitle}</div>}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, color:'rgba(148,163,184,0.6)', fontSize:16, cursor:'pointer', width:32, height:32, display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {sorted.map((item, i) => {
            const pct = (item.avgRSI / 100) * 100
            return (
              <div key={item.label}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:5 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    {item.emoji && <span style={{ fontSize:14 }}>{item.emoji}</span>}
                    <span style={{ fontSize:12, fontWeight:700, color:'rgba(226,232,240,0.9)' }}>{item.label}</span>
                    <span style={{ fontSize:9, color:`rgba(${item.color},0.5)`, background:`rgba(${item.color},0.08)`, padding:'1px 6px', borderRadius:99, border:`1px solid rgba(${item.color},0.2)` }}>{item.count} assets</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    {item.topLabel && <span style={{ fontSize:10, color:'rgba(148,163,184,0.5)', fontFamily:'JetBrains Mono, monospace' }}>{item.topLabel}</span>}
                    <span style={{ fontSize:13, fontWeight:800, color:rsiColor(item.avgRSI), fontFamily:'JetBrains Mono, monospace' }}>{item.avgRSI}</span>
                  </div>
                </div>
                <div style={{ height:6, background:'rgba(255,255,255,0.04)', borderRadius:3, overflow:'hidden' }}>
                  <motion.div initial={{ width:0 }} animate={{ width:`${pct}%` }} transition={{ duration:0.8, delay:i*0.07, ease:'easeOut' }}
                    style={{ height:'100%', background:`linear-gradient(90deg, rgba(${item.color},0.6), rgba(${item.color},0.9))`, borderRadius:3, boxShadow:`0 0 8px rgba(${item.color},0.4)` }} />
                </div>
              </div>
            )
          })}
        </div>
        <p style={{ fontSize:10, color:'rgba(148,163,184,0.3)', textAlign:'center', marginTop:16, marginBottom:0 }}>RSI moyen par groupe · timeframe courant</p>
      </motion.div>
    </div>,
    document.body
  )
}

// ── MTF View ──────────────────────────────────────────────────────────────────

function getMTFAlign(rsi1h: number, rsi4h: number, rsi1d: number): 'bull' | 'bear' | 'mixed' {
  const ib = (r: number) => r > 55, ibs = (r: number) => r < 45
  if (ib(rsi1h) && ib(rsi4h) && ib(rsi1d)) return 'bull'
  if (ibs(rsi1h) && ibs(rsi4h) && ibs(rsi1d)) return 'bear'
  return 'mixed'
}

type MTFFetcher = (symbols: string[]) => Promise<Record<string, MTFData>>

function MTFView({ tokens, onTokenClick, fetcher = fetchMTFRSI, tfLabels = ['RSI 1H','RSI 4H','RSI 1D'], accentColor = '0,229,255' }: {
  tokens: TokenRSIWithDiv[]
  onTokenClick: (s: string) => void
  fetcher?: MTFFetcher
  tfLabels?: [string, string, string]
  accentColor?: string
}) {
  const [mtfData, setMtfData] = useState<Record<string, MTFData>>({})
  const [loading, setLoading] = useState(true)
  const symbols = tokens.map(t => t.symbol)

  useEffect(() => {
    setLoading(true)
    fetcher(symbols).then(d => { setMtfData(d); setLoading(false) })
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
        <span style={{ fontSize:9, fontWeight:700, color:`rgba(${accentColor},0.4)`, textTransform:'uppercase' }}>Asset</span>
        {tfLabels.map(l => (
          <span key={l} style={{ fontSize:9, fontWeight:700, color:`rgba(${accentColor},0.4)`, textTransform:'uppercase', textAlign:'center' }}>{l}</span>
        ))}
        <span style={{ fontSize:9, fontWeight:700, color:`rgba(${accentColor},0.4)`, textTransform:'uppercase', textAlign:'center' }}>Align.</span>
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
  const [tokens,       setTokens]       = useState<TokenRSIWithDiv[]>([])
  const [loading,      setLoading]      = useState(true)
  const [timeframe,    setTimeframe]    = useState<Timeframe>('1d')
  const [screenerOpen, setScreenerOpen] = useState(false)
  const [screener,     setScreener]     = useState<ScreenerState>(DEFAULT_SCREENER)
  const [mtfMode,      setMtfMode]      = useState(false)
  const [showRotation, setShowRotation] = useState(false)
  const [showCorr,     setShowCorr]     = useState(false)

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

  const GROUPS = ['Forex', 'Metals', 'Energy', 'Indices', 'Crypto']
  const GROUP_COLORS: Record<string, string> = { Forex:'0,229,255', Metals:'255,215,0', Energy:'255,149,0', Indices:'10,133,255', Crypto:'191,90,242' }

  const screenerTokens = useMemo(() => applyScreener(tokens, screener), [tokens, screener])
  const screenerActive = screener.rsiPreset !== 'all' || screener.vmcZone !== 'all' || screener.divOnly

  const rotationItems = useMemo((): RotationItem[] =>
    GROUPS.map(g => {
      const gt = tokens.filter(t => FOREX_ASSETS.find(a => a.displaySym === t.symbol && a.group === g))
      const avg = avgRSI(gt) ?? 50
      const top = [...gt].sort((a, b) => b.rsi - a.rsi)[0]
      const GL: Record<string, string> = { Forex:'💱 Forex', Metals:'🥇 Métaux', Energy:'🛢️ Énergie', Indices:'📊 Indices', Crypto:'₿ Crypto' }
      return { label: GL[g] ?? g, avgRSI: avg, count: gt.length, color: GROUP_COLORS[g] ?? '148,163,184', topLabel: top ? `↑ ${top.symbol} ${top.rsi}` : undefined }
    })
  , [tokens])

  const ForexToolBtn = ({ label, active, onClick, color = '52,199,89' }: { label: string; active?: boolean; onClick: () => void; color?: string }) => (
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
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12, flexWrap:'wrap' }}>
        <FilterPills
          label="Timeframe"
          options={(['1d','4h','1h'] as Timeframe[]).map(v => ({ value:v, label:v.toUpperCase() }))}
          value={timeframe}
          onChange={setTimeframe}
        />
      </div>

      {/* Institutional Indicators */}
      <InstitIndicatorsWrapper tokens={screenerTokens.length > 0 ? screenerTokens : tokens} mode="forex" benchmarkLabel="DXY" />

      {/* Tool buttons */}
      <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:10 }}>
        <ForexToolBtn label="🔍 Screener" active={screenerOpen || screenerActive} onClick={() => setScreenerOpen(o => !o)} color="0,229,255" />
        <ForexToolBtn label="📊 Multi-TF" active={mtfMode} onClick={() => setMtfMode(m => !m)} color="191,90,242" />
        <ForexToolBtn label="🔄 Rotation" onClick={() => setShowRotation(true)} />
        <ForexToolBtn label="🔗 Corrélation" onClick={() => setShowCorr(true)} color="255,149,0" />
      </div>

      <AnimatePresence>
        {screenerOpen && (
          <ScreenerPanel state={screener} onChange={setScreener} onReset={() => setScreener(DEFAULT_SCREENER)} resultCount={screenerTokens.length} hideVolume />
        )}
      </AnimatePresence>

      {/* MTF mode */}
      {mtfMode ? (
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12, padding:'8px 12px', background:'rgba(191,90,242,0.06)', border:'1px solid rgba(191,90,242,0.2)', borderRadius:8 }}>
            <span style={{ fontSize:11, color:'rgba(191,90,242,0.8)', fontWeight:600 }}>📊 Multi-Timeframe · RSI 1H / 1D / 1W</span>
            <span style={{ fontSize:10, color:'rgba(148,163,184,0.4)' }}>via Yahoo Finance</span>
          </div>
          <MTFView
            tokens={screenerTokens}
            onTokenClick={onTokenClick}
            fetcher={fetchMTFForexRSI}
            tfLabels={['RSI 1H', 'RSI 1D', 'RSI 1W']}
            accentColor="191,90,242"
          />
        </div>
      ) : (
        <>
          {GROUPS.map(group => {
            const groupAssets = FOREX_ASSETS.filter(a => a.group === group)
            const allGroupTokens = groupAssets.map(a => tokens.find(t => t.symbol === a.displaySym)).filter(Boolean) as TokenRSIWithDiv[]
            const groupTokens = screenerActive ? allGroupTokens.filter(t => screenerTokens.some(s => s.symbol === t.symbol)) : allGroupTokens
            if (!groupTokens.length) return null
            const groupLabels: Record<string, string> = { Forex:'💱 Paires Forex', Metals:'🥇 Métaux Précieux', Energy:'🛢️ Énergie', Indices:'📊 Indices Futures', Crypto:'₿ Crypto' }
            const gc = GROUP_COLORS[group] ?? '0,229,255'
            return (
              <div key={group} style={{ marginBottom:20 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                  <span style={{ fontSize:11, fontWeight:700, color:`rgba(${gc},0.7)`, textTransform:'uppercase', letterSpacing:'0.08em' }}>{groupLabels[group]}</span>
                  <span style={{ fontSize:9, color:`rgba(${gc},0.4)`, background:`rgba(${gc},0.07)`, border:`1px solid rgba(${gc},0.15)`, padding:'1px 7px', borderRadius:99 }}>{groupTokens.length} assets</span>
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                  {groupTokens.map((tok, i) => {
                    const isPos = tok.change24h >= 0
                    return (
                      <motion.button key={tok.symbol}
                        initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ delay:i*0.04 }}
                        whileHover={{ y:-3, boxShadow:`0 8px 24px rgba(${gc},0.14)` }}
                        onClick={() => onTokenClick(tok.symbol)}
                        style={{ display:'flex', flexDirection:'column', gap:4, padding:'10px 14px', borderRadius:10, cursor:'pointer', background:'rgba(8,12,22,0.8)', border:`1px solid rgba(${gc},0.12)`, textAlign:'left', minWidth:110 }}>
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
        </>
      )}

      <div ref={shareRef} style={{ display:'none' }} />

      <AnimatePresence>
        {showRotation && <GenericRotationPanel title="Rotation par Groupe" subtitle="RSI moyen · Forex / Métaux / Énergie / Indices" items={rotationItems} onClose={() => setShowRotation(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {showCorr && <CorrelationMatrix tokens={screenerTokens} onClose={() => setShowCorr(false)} />}
      </AnimatePresence>
    </div>
  )
}

// ── Analyst Ratings Panel (Feature C) ─────────────────────────────────────────

interface AnalystRating {
  symbol: string; buy: number; hold: number; sell: number
  strongBuy: number; strongSell: number
  consensus: 'Strong Buy' | 'Buy' | 'Hold' | 'Sell' | 'Strong Sell' | 'N/A'
  targetMean: number | null; targetHigh: number | null; targetLow: number | null
}

function AnalystRatingsPanel({ symbols, onClose }: { symbols: string[]; onClose: () => void }) {
  const [data, setData]       = useState<AnalystRating[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fn = httpsCallable<{ symbols: string[] }, { data: AnalystRating[] }>(fbFunctions, 'fetchAnalystRatings', { timeout: 120_000 })
    fn({ symbols: symbols.slice(0, 10) }) // max 10 → ~5s sequential
      .then(r => { setData(r.data.data ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [symbols.join(',')])

  const consensusColor = (c: string) => {
    if (c === 'Strong Buy') return '#34C759'
    if (c === 'Buy')        return '#30D158'
    if (c === 'Hold')       return '#FF9500'
    if (c === 'Sell')       return '#FF453A'
    if (c === 'Strong Sell')return '#FF3B30'
    return '#8E8E93'
  }

  return createPortal(
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', backdropFilter:'blur(8px)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}
      onClick={onClose}>
      <motion.div initial={{ scale:0.95, y:20 }} animate={{ scale:1, y:0 }} exit={{ scale:0.95, y:20 }}
        style={{ width:'100%', maxWidth:680, maxHeight:'80vh', overflowY:'auto', background:'rgba(8,12,22,0.98)', border:'1px solid rgba(0,229,255,0.2)', borderRadius:20, boxShadow:'0 32px 64px rgba(0,0,0,0.8)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ padding:'20px 24px', borderBottom:'1px solid rgba(255,255,255,0.06)', display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:15, fontWeight:800, color:'var(--tm-text-primary)', fontFamily:'Syne, sans-serif' }}>📊 Ratings Analystes</div>
            <div style={{ fontSize:11, color:'var(--tm-text-muted)', marginTop:2 }}>Consensus Wall Street · Objectifs de cours</div>
          </div>
          <button onClick={onClose} style={{ background:'rgba(255,255,255,0.06)', border:'none', borderRadius:8, padding:'6px 10px', color:'var(--tm-text-muted)', cursor:'pointer', fontSize:12 }}>✕</button>
        </div>

        <div style={{ padding:'16px 24px' }}>
          {loading && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:120, gap:10, color:'var(--tm-text-muted)', fontSize:13 }}>
              <div style={{ width:20, height:20, borderRadius:'50%', border:'2px solid rgba(0,229,255,0.2)', borderTopColor:'var(--tm-accent)', animation:'spin 0.8s linear infinite' }}/>
              Chargement des ratings…
            </div>
          )}
          {!loading && data.length === 0 && (
            <div style={{ textAlign:'center', padding:40, color:'var(--tm-text-muted)', fontSize:13 }}>
              Aucune donnée disponible pour ces symboles
            </div>
          )}
          {!loading && data.length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {data.filter(d => d.consensus !== 'N/A').map(r => {
                const total = r.strongBuy + r.buy + r.hold + r.sell + r.strongSell
                const bullPct = total > 0 ? ((r.strongBuy + r.buy) / total) * 100 : 0
                const holdPct = total > 0 ? (r.hold / total) * 100 : 0
                const bearPct = total > 0 ? ((r.sell + r.strongSell) / total) * 100 : 0
                const cc = consensusColor(r.consensus)
                return (
                  <div key={r.symbol} style={{ background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:14, padding:'14px 16px' }}>
                    <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
                      {/* Ticker */}
                      <div style={{ minWidth:60 }}>
                        <div style={{ fontSize:14, fontWeight:900, color:cc, fontFamily:'Syne, sans-serif', lineHeight:1 }}>{r.symbol}</div>
                        <div style={{ fontSize:10, fontWeight:700, color:cc, marginTop:3, opacity:0.9 }}>{r.consensus}</div>
                      </div>
                      {/* Bar chart */}
                      <div style={{ flex:1 }}>
                        <div style={{ display:'flex', borderRadius:6, overflow:'hidden', height:10, marginBottom:6 }}>
                          <div style={{ width:`${bullPct}%`, background:'linear-gradient(90deg,#34C759,#30D158)', transition:'width 0.7s ease' }}/>
                          <div style={{ width:`${holdPct}%`, background:'rgba(255,149,0,0.7)', transition:'width 0.7s ease' }}/>
                          <div style={{ width:`${bearPct}%`, background:'linear-gradient(90deg,#FF453A,#FF3B30)', transition:'width 0.7s ease' }}/>
                        </div>
                        <div style={{ display:'flex', gap:8, fontSize:10, color:'var(--tm-text-muted)' }}>
                          <span style={{ color:'#34C759' }}>✓ {r.strongBuy + r.buy} Achat</span>
                          <span style={{ color:'#FF9500' }}>~ {r.hold} Neutre</span>
                          <span style={{ color:'#FF3B30' }}>✗ {r.sell + r.strongSell} Vente</span>
                          <span style={{ marginLeft:'auto' }}>{total} analystes</span>
                        </div>
                      </div>
                      {/* Price target */}
                      {r.targetMean && (
                        <div style={{ textAlign:'right', flexShrink:0 }}>
                          <div style={{ fontSize:15, fontWeight:800, color:'var(--tm-text-primary)', fontFamily:'Syne, sans-serif', lineHeight:1 }}>${r.targetMean.toFixed(0)}</div>
                          <div style={{ fontSize:9, color:'var(--tm-text-muted)', marginTop:3 }}>
                            {r.targetLow && r.targetHigh ? `${r.targetLow.toFixed(0)}–${r.targetHigh.toFixed(0)}` : 'objectif'}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body
  )
}

// ── Earnings Panel (Feature B) ────────────────────────────────────────────────

interface EarningsData {
  symbol: string
  history: { period: string; actual: number | null; estimate: number | null; surprisePct: number | null; beat: boolean | null }[]
  nextDate: string | null; nextHour: string | null
  nextEpsEstimate: number | null; nextRevenueEstimate: number | null
  beatRate: number | null
}

function EarningsPanel({ symbols, onClose }: { symbols: string[]; onClose: () => void }) {
  const [data, setData]       = useState<EarningsData[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy]   = useState<'beatRate' | 'nextDate'>('nextDate')

  useEffect(() => {
    const fn = httpsCallable<{ symbols: string[] }, { data: EarningsData[] }>(fbFunctions, 'fetchStockEarnings', { timeout: 120_000 })
    fn({ symbols: symbols.slice(0, 10) }) // max 10 → ~3s sequential
      .then(r => { setData(r.data.data ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [symbols.join(',')])

  const sorted = useMemo(() => {
    const d = [...data].filter(e => e.history.length > 0 || e.nextDate)
    if (sortBy === 'beatRate') return d.sort((a, b) => (b.beatRate ?? 0) - (a.beatRate ?? 0))
    return d.sort((a, b) => {
      if (!a.nextDate && !b.nextDate) return 0
      if (!a.nextDate) return 1
      if (!b.nextDate) return -1
      return a.nextDate.localeCompare(b.nextDate)
    })
  }, [data, sortBy])

  const fmtBig = (n: number) => n >= 1e9 ? `${(n/1e9).toFixed(1)}B` : n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : `${n.toFixed(2)}`

  return createPortal(
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.72)', backdropFilter:'blur(10px)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}
      onClick={onClose}>
      <motion.div initial={{ scale:0.95, y:20 }} animate={{ scale:1, y:0 }} exit={{ scale:0.95, y:20 }}
        style={{ width:'100%', maxWidth:740, maxHeight:'82vh', overflowY:'auto', background:'rgba(8,12,22,0.98)', border:'1px solid rgba(52,199,89,0.2)', borderRadius:20, boxShadow:'0 32px 64px rgba(0,0,0,0.8)' }}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding:'20px 24px', borderBottom:'1px solid rgba(255,255,255,0.06)', display:'flex', alignItems:'center', gap:12, position:'sticky', top:0, background:'rgba(8,12,22,0.98)', zIndex:1 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:15, fontWeight:800, color:'var(--tm-text-primary)', fontFamily:'Syne, sans-serif' }}>📅 Résultats & Earnings</div>
            <div style={{ fontSize:11, color:'var(--tm-text-muted)', marginTop:2 }}>Historique 4 trimestres · Prochaines publications</div>
          </div>
          <div style={{ display:'flex', gap:6 }}>
            {(['nextDate','beatRate'] as const).map(s => (
              <button key={s} onClick={() => setSortBy(s)}
                style={{ fontSize:10, padding:'4px 10px', borderRadius:8, cursor:'pointer', fontWeight:600, border:`1px solid ${sortBy===s?'rgba(52,199,89,0.4)':'rgba(255,255,255,0.08)'}`, background:sortBy===s?'rgba(52,199,89,0.12)':'rgba(255,255,255,0.03)', color:sortBy===s?'#34C759':'rgba(148,163,184,0.5)' }}>
                {s==='nextDate'?'📆 Date':'⭐ Beat rate'}
              </button>
            ))}
          </div>
          <button onClick={onClose} style={{ background:'rgba(255,255,255,0.06)', border:'none', borderRadius:8, padding:'6px 10px', color:'var(--tm-text-muted)', cursor:'pointer', fontSize:12 }}>✕</button>
        </div>

        <div style={{ padding:'16px 24px' }}>
          {loading && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:120, gap:10, color:'var(--tm-text-muted)', fontSize:13 }}>
              <div style={{ width:20, height:20, borderRadius:'50%', border:'2px solid rgba(52,199,89,0.2)', borderTopColor:'#34C759', animation:'spin 0.8s linear infinite' }}/>
              Chargement des earnings…
            </div>
          )}

          {!loading && sorted.length === 0 && (
            <div style={{ textAlign:'center', padding:40, color:'var(--tm-text-muted)', fontSize:13 }}>Aucune donnée disponible</div>
          )}

          {!loading && sorted.length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {sorted.map(e => {
                const daysUntil = e.nextDate ? Math.ceil((new Date(e.nextDate).getTime() - Date.now()) / 86_400_000) : null
                const hourLabel = e.nextHour === 'bmo' ? '🌅 Avant ouverture' : e.nextHour === 'amc' ? '🌆 Après clôture' : e.nextHour === 'dmh' ? '⏰ En séance' : ''
                const beatColor = e.beatRate != null ? e.beatRate >= 75 ? '#34C759' : e.beatRate >= 50 ? '#FF9500' : '#FF3B30' : '#8E8E93'

                return (
                  <div key={e.symbol} style={{ background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:14, padding:'14px 16px' }}>
                    <div style={{ display:'flex', alignItems:'flex-start', gap:14, marginBottom:10 }}>
                      {/* Ticker + beat rate */}
                      <div style={{ minWidth:64 }}>
                        <div style={{ fontSize:15, fontWeight:900, color:'var(--tm-text-primary)', fontFamily:'Syne, sans-serif', lineHeight:1 }}>{e.symbol}</div>
                        {e.beatRate != null && (
                          <div style={{ fontSize:11, fontWeight:700, color:beatColor, marginTop:4 }}>
                            {e.beatRate}% beat
                          </div>
                        )}
                      </div>

                      {/* History bars */}
                      <div style={{ flex:1, display:'flex', gap:6, alignItems:'flex-end', height:44 }}>
                        {e.history.slice(0,4).map((q, i) => {
                          const color = q.beat === true ? '#34C759' : q.beat === false ? '#FF3B30' : '#8E8E93'
                          const surpriseAbs = Math.abs(q.surprisePct ?? 0)
                          const barH = Math.min(40, 10 + surpriseAbs * 1.5)
                          return (
                            <div key={i} title={`${q.period} · ${q.actual != null ? `$${q.actual.toFixed(2)}` : 'N/A'} vs est. ${q.estimate != null ? `$${q.estimate.toFixed(2)}` : 'N/A'}${q.surprisePct != null ? ` (${q.surprisePct > 0 ? '+' : ''}${q.surprisePct.toFixed(1)}%)` : ''}`}
                              style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:3, cursor:'help' }}>
                              <div style={{ fontSize:9, color:'rgba(255,255,255,0.3)', fontFamily:'JetBrains Mono, monospace' }}>
                                {q.surprisePct != null ? `${q.surprisePct > 0 ? '+' : ''}${q.surprisePct.toFixed(0)}%` : ''}
                              </div>
                              <div style={{ width:'100%', height:barH, background:color, borderRadius:4, opacity:0.8 }}/>
                              <div style={{ fontSize:8, color:'rgba(255,255,255,0.3)', textAlign:'center', maxWidth:30, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>
                                {q.period?.slice(0,7)}
                              </div>
                            </div>
                          )
                        })}
                        {e.history.length === 0 && (
                          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'rgba(255,255,255,0.2)' }}>—</div>
                        )}
                      </div>

                      {/* Next earnings */}
                      <div style={{ textAlign:'right', flexShrink:0, minWidth:120 }}>
                        {e.nextDate ? (
                          <>
                            <div style={{ fontSize:12, fontWeight:800, color: daysUntil != null && daysUntil <= 7 ? '#FF9500' : 'var(--tm-text-primary)', fontFamily:'Syne, sans-serif', lineHeight:1 }}>
                              {daysUntil === 0 ? '🔴 Aujourd\'hui' : daysUntil === 1 ? '🟠 Demain' : `Dans ${daysUntil}j`}
                            </div>
                            <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginTop:3 }}>{e.nextDate}</div>
                            {hourLabel && <div style={{ fontSize:9, color:'rgba(255,255,255,0.3)', marginTop:1 }}>{hourLabel}</div>}
                            {e.nextEpsEstimate != null && (
                              <div style={{ fontSize:10, color:'rgba(0,229,255,0.7)', marginTop:3 }}>Est. EPS ${e.nextEpsEstimate.toFixed(2)}</div>
                            )}
                          </>
                        ) : (
                          <div style={{ fontSize:11, color:'rgba(255,255,255,0.2)' }}>Non annoncé</div>
                        )}
                      </div>
                    </div>

                    {/* Revenue estimate */}
                    {e.nextRevenueEstimate != null && (
                      <div style={{ fontSize:10, color:'var(--tm-text-muted)', paddingTop:6, borderTop:'1px solid rgba(255,255,255,0.04)' }}>
                        Revenus estimés : <span style={{ color:'rgba(0,229,255,0.6)', fontWeight:600 }}>${fmtBig(e.nextRevenueEstimate)}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body
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
  const [screenerOpen,  setScreenerOpen]  = useState(false)
  const [screener,      setScreener]      = useState<ScreenerState>(DEFAULT_SCREENER)
  const [showRotation,  setShowRotation]  = useState(false)
  const [showCorr,      setShowCorr]      = useState(false)
  const [showRatings,   setShowRatings]   = useState(false)
  const [showEarnings,  setShowEarnings]  = useState(false)

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

  const screenerTokens = useMemo(() => applyScreener(finalTokens, screener), [finalTokens, screener])
  const screenerActive = screener.rsiPreset !== 'all' || screener.vmcZone !== 'all' || screener.divOnly

  // Group rotation items from loaded data
  const rotationItems = useMemo((): RotationItem[] => {
    const COLORS: Record<string, string> = {
      '🇺🇸 US Tech':'0,229,255', '🇺🇸 US Finance':'10,133,255', '🇺🇸 US Santé':'52,199,89',
      '🇺🇸 US Industrie & Énergie':'255,149,0', '🇺🇸 US Consommation & Médias':'191,90,242',
      '🇫🇷 CAC 40':'0,122,255', '🇩🇪 DAX':'255,59,48', '🇬🇧 FTSE 100':'255,214,10',
      '🇪🇺 Europe (Autres)':'52,199,89', '🌏 Asie & International':'175,82,222',
      '📊 ETF & Matières premières':'100,210,255',
    }
    return STOCK_GROUPS.map(g => {
      const toks = groupData[g.label] ?? []
      const avg = avgRSI(toks) ?? 50
      const top = [...toks].sort((a, b) => b.rsi - a.rsi)[0]
      return {
        label: g.label.replace(/^[\u{1F1A0}-\u{1F9FF}\uFE0F\u{1F300}-\u{1FFFF} ]+/u, '').trim(),
        emoji: g.label.match(/^([\u{1F1A0}-\u{1F9FF}\uFE0F\u{1F300}-\u{1FFFF}📊]+)/u)?.[0],
        avgRSI: avg, count: toks.length,
        color: COLORS[g.label] ?? '148,163,184',
        topLabel: top ? `↑ ${top.symbol} ${top.rsi}` : undefined,
      }
    })
  }, [groupData])

  const StockToolBtn = ({ label, active, onClick, color = '10,133,255' }: { label: string; active?: boolean; onClick: () => void; color?: string }) => (
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

      {/* Institutional Indicators */}
      <InstitIndicatorsWrapper tokens={screenerTokens.length > 0 ? screenerTokens : subsetTokens} mode="stocks" benchmarkLabel="S&P 500" />

      {/* Tool buttons */}
      <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:10 }}>
        <StockToolBtn label="🔍 Screener" active={screenerOpen || screenerActive} onClick={() => setScreenerOpen(o => !o)} />
        <StockToolBtn label="🔄 Rotation" onClick={() => setShowRotation(true)} color="52,199,89" />
        <StockToolBtn label="🔗 Corrélation" onClick={() => setShowCorr(true)} color="255,149,0" />
        <StockToolBtn label="📊 Ratings" onClick={() => setShowRatings(true)} color="191,90,242" />
        <StockToolBtn label="📅 Earnings" onClick={() => setShowEarnings(true)} color="255,149,0" />
      </div>

      <AnimatePresence>
        {screenerOpen && (
          <ScreenerPanel state={screener} onChange={setScreener} onReset={() => setScreener(DEFAULT_SCREENER)} resultCount={screenerTokens.length} hideVolume />
        )}
      </AnimatePresence>

      {isFirstLoad && STOCK_GROUPS.filter(g => !loadedGroups.has(g.label)).map(g => {
        const prog = groupProgress[g.label]
        return <SkeletonGroup key={g.label} label={`${g.label} ${prog ? `(${prog.done}/${prog.total})` : ''}`} count={g.symbols.length} />
      })}

      {screenerTokens.length > 0 && <DivergenceScanner tokens={screenerTokens as TokenRSIWithDiv[]} onTokenClick={onTokenClick} timeframe={timeframe} />}

      {screenerTokens.length > 0 && (
        <div ref={shareRef}>
          <RsiHeatmap tokens={screenerTokens} timeframe={timeframe} defaultTimeframe="1d" onTimeframeChange={setTimeframe} onTokenClick={onTokenClick} />
        </div>
      )}

      <AnimatePresence>
        {showRotation && <GenericRotationPanel title="Rotation par Secteur" subtitle="RSI moyen par groupe d'actions" items={rotationItems} onClose={() => setShowRotation(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {showCorr && <CorrelationMatrix tokens={screenerTokens} onClose={() => setShowCorr(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {showRatings && (
          <AnalystRatingsPanel
            symbols={screenerTokens.slice(0, 15).map(t => t.symbol)}
            onClose={() => setShowRatings(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showEarnings && (
          <EarningsPanel
            symbols={screenerTokens.slice(0, 15).map(t => t.symbol)}
            onClose={() => setShowEarnings(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Multi-Asset Tab — intègre MultiAssetAnalytics inline ─────────────────────
function MultiAssetTab() {
  return (
    <div style={{ margin: '-20px -20px -24px' }}>
      <MultiAssetAnalytics />
    </div>
  )
}

// ── Calendrier Tab ───────────────────────────────────────────────────────────

interface EarningsEvent {
  symbol: string; date: string; hour: string
  epsEstimate: number | null; revenueEstimate: number | null
}
interface EconomicEvent {
  event: string; country: string; date: string; impact: string
  estimate: string | null; prev: string | null; unit: string | null
}
interface GeoEvent { title: string; date: string; category: string; source: string; url: string }

function CalendrierTab() {
  type CalSection = 'earnings' | 'macro' | 'geo'
  const [section, setSection] = useState<CalSection>('earnings')
  const [earnings, setEarnings] = useState<EarningsEvent[]>([])
  const [economic, setEconomic] = useState<EconomicEvent[]>([])
  const [geoNews,  setGeoNews]  = useState<GeoEvent[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  useEffect(() => {
    setLoading(true); setError(null)
    type CFResult = { earnings: EarningsEvent[]; economic: EconomicEvent[]; geopolitical: GeoEvent[] }
    const fn = httpsCallable<Record<string, unknown>, CFResult>(fbFunctions, 'fetchMarketCalendar')
    fn({})
      .then(res => {
        setEarnings(res.data.earnings ?? [])
        setEconomic(res.data.economic ?? [])
        setGeoNews(res.data.geopolitical ?? [])
      })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [])

  // Group earnings by date
  const earningsByDate = useMemo(() => {
    const map = new Map<string, EarningsEvent[]>()
    for (const e of earnings) {
      const arr = map.get(e.date) ?? []
      arr.push(e); map.set(e.date, arr)
    }
    return [...map.entries()].sort(([a],[b]) => a.localeCompare(b))
  }, [earnings])

  // Group economic by date
  const econByDate = useMemo(() => {
    const map = new Map<string, EconomicEvent[]>()
    for (const e of economic) {
      const arr = map.get(e.date) ?? []
      arr.push(e); map.set(e.date, arr)
    }
    return [...map.entries()].sort(([a],[b]) => a.localeCompare(b))
  }, [economic])

  const fmtCal = (d: string) => {
    try {
      return new Date(d).toLocaleDateString('fr-FR', { weekday:'short', day:'2-digit', month:'short' })
    } catch { return d }
  }

  const impactColor = (impact: string) => {
    if (impact === 'high' || impact === '3') return '#FF3B30'
    if (impact === 'medium' || impact === '2') return '#FF9500'
    return '#607D8B'
  }

  const SECTIONS: { id: CalSection; label: string; color: string; count: number }[] = [
    { id:'earnings', label:'📊 Résultats', color:'0,229,255', count: earnings.length },
    { id:'macro',    label:'🏦 Macro',     color:'255,149,0', count: economic.length },
    { id:'geo',      label:'🌍 Géopolitique', color:'191,90,242', count: geoNews.length },
  ]

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {/* Sub-tabs */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => setSection(s.id)}
            style={{ padding:'6px 16px', borderRadius:8, fontSize:11, fontWeight:600, cursor:'pointer',
              background: section === s.id ? `rgba(${s.color},0.12)` : 'rgba(255,255,255,0.03)',
              border: `1px solid ${section === s.id ? `rgba(${s.color},0.4)` : 'rgba(255,255,255,0.08)'}`,
              color: section === s.id ? `rgb(${s.color})` : 'rgba(148,163,184,0.6)',
              transition:'all 0.15s',
            }}>
            {s.label}
            {s.count > 0 && !loading && (
              <span style={{ marginLeft:6, fontSize:9, background:`rgba(${s.color},0.15)`, padding:'1px 5px', borderRadius:99, color:`rgb(${s.color})` }}>
                {s.count}
              </span>
            )}
          </button>
        ))}
        {loading && <div style={{ width:16, height:16, border:'1.5px solid rgba(255,255,255,0.1)', borderTopColor:'#00E5FF', borderRadius:'50%', animation:'spin 0.8s linear infinite', alignSelf:'center', marginLeft:6 }} />}
      </div>

      {/* Error */}
      {error && !loading && (
        <div style={{ padding:'10px 14px', borderRadius:8, background:'rgba(255,59,48,0.06)', border:'1px solid rgba(255,59,48,0.2)', fontSize:11, color:'#FF3B30' }}>
          Erreur : {error}
        </div>
      )}

      {/* ── Earnings ── */}
      {section === 'earnings' && (
        <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
          {loading ? (
            Array.from({length:3}).map((_,i) => (
              <div key={i} style={{ height:90, borderRadius:10, background:'rgba(255,255,255,0.04)', animation:'pulse 1.5s ease infinite' }} />
            ))
          ) : earningsByDate.length === 0 ? (
            <div style={{ padding:24, textAlign:'center', color:'rgba(148,163,184,0.5)', fontSize:12 }}>Aucun résultat trouvé pour les 14 prochains jours</div>
          ) : earningsByDate.map(([date, evts]) => (
            <div key={date}>
              <div style={{ fontSize:10, fontWeight:700, color:'rgba(148,163,184,0.5)', textTransform:'uppercase', letterSpacing:1, marginBottom:8, display:'flex', alignItems:'center', gap:8 }}>
                <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.06)' }} />
                📅 {fmtCal(date)}
                <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.06)' }} />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:8 }}>
                {evts.map((e, i) => (
                  <div key={i} style={{ padding:'10px 14px', background:'rgba(0,229,255,0.04)', border:'1px solid rgba(0,229,255,0.12)', borderRadius:10 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                      <span style={{ fontSize:13, fontWeight:800, color:'#fff', fontFamily:'JetBrains Mono,monospace' }}>{e.symbol}</span>
                      <span style={{ fontSize:9, fontWeight:600, color:'rgba(148,163,184,0.6)', background:'rgba(255,255,255,0.06)', padding:'2px 6px', borderRadius:4 }}>
                        {e.hour === 'bmo' ? '🌅 Avant ouverture' : e.hour === 'amc' ? '🌙 Après clôture' : '—'}
                      </span>
                    </div>
                    {e.epsEstimate != null && (
                      <div style={{ fontSize:10, color:'rgba(148,163,184,0.7)' }}>
                        EPS est. <b style={{ color:'#00E5FF', fontFamily:'JetBrains Mono,monospace' }}>${e.epsEstimate.toFixed(2)}</b>
                      </div>
                    )}
                    {e.revenueEstimate != null && (
                      <div style={{ fontSize:9, color:'rgba(148,163,184,0.5)', marginTop:2 }}>
                        Rev. est. <b style={{ fontFamily:'JetBrains Mono,monospace' }}>
                          {e.revenueEstimate >= 1e9 ? `$${(e.revenueEstimate/1e9).toFixed(1)}B` : `$${(e.revenueEstimate/1e6).toFixed(0)}M`}
                        </b>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Macro ── */}
      {section === 'macro' && (
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {loading ? (
            Array.from({length:4}).map((_,i) => (
              <div key={i} style={{ height:60, borderRadius:8, background:'rgba(255,255,255,0.04)', animation:'pulse 1.5s ease infinite' }} />
            ))
          ) : econByDate.length === 0 ? (
            <div style={{ padding:24, textAlign:'center', color:'rgba(148,163,184,0.5)', fontSize:12 }}>Aucun événement macro disponible</div>
          ) : econByDate.map(([date, evts]) => (
            <div key={date}>
              <div style={{ fontSize:10, fontWeight:700, color:'rgba(148,163,184,0.5)', textTransform:'uppercase', letterSpacing:1, marginBottom:8, display:'flex', alignItems:'center', gap:8 }}>
                <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.06)' }} />
                📅 {fmtCal(date)}
                <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.06)' }} />
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {evts.sort((a,b) => (b.impact === 'high' ? 1 : b.impact === 'medium' ? 0 : -1) - (a.impact === 'high' ? 1 : a.impact === 'medium' ? 0 : -1)).map((e, i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'rgba(255,255,255,0.02)', border:`1px solid ${impactColor(e.impact)}20`, borderLeft:`3px solid ${impactColor(e.impact)}`, borderRadius:8 }}>
                    <div style={{ width:6, height:6, borderRadius:'50%', background:impactColor(e.impact), flexShrink:0 }} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:11, fontWeight:600, color:'#fff', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.event}</div>
                      <div style={{ fontSize:9, color:'rgba(148,163,184,0.5)', marginTop:2 }}>{e.country}</div>
                    </div>
                    {(e.estimate || e.prev) && (
                      <div style={{ textAlign:'right', flexShrink:0 }}>
                        {e.estimate && <div style={{ fontSize:10, fontWeight:700, color:'#FF9500', fontFamily:'JetBrains Mono,monospace' }}>{e.estimate}{e.unit ?? ''}</div>}
                        {e.prev && <div style={{ fontSize:9, color:'rgba(148,163,184,0.5)', fontFamily:'JetBrains Mono,monospace' }}>Préc: {e.prev}{e.unit ?? ''}</div>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Géopolitique ── */}
      {section === 'geo' && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {loading ? (
            Array.from({length:5}).map((_,i) => (
              <div key={i} style={{ height:70, borderRadius:8, background:'rgba(255,255,255,0.04)', animation:'pulse 1.5s ease infinite' }} />
            ))
          ) : geoNews.length === 0 ? (
            <div style={{ padding:24, textAlign:'center', color:'rgba(148,163,184,0.5)', fontSize:12 }}>Aucun événement géopolitique disponible</div>
          ) : geoNews.map((g, i) => (
            <a key={i} href={g.url} target="_blank" rel="noopener noreferrer"
              style={{ textDecoration:'none', display:'flex', gap:10, alignItems:'flex-start', padding:'10px 14px', background:'rgba(191,90,242,0.04)', border:'1px solid rgba(191,90,242,0.12)', borderRadius:10, transition:'background 0.12s', cursor:'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background='rgba(191,90,242,0.08)')}
              onMouseLeave={e => (e.currentTarget.style.background='rgba(191,90,242,0.04)')}
            >
              <span style={{ fontSize:18, flexShrink:0 }}>
                {g.category === 'election' ? '🗳️' : g.category === 'war' ? '⚔️' : g.category === 'summit' ? '🤝' : g.category === 'trade' ? '📦' : g.category === 'sanctions' ? '🚫' : '🌍'}
              </span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:11, fontWeight:600, color:'#fff', lineHeight:1.4, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{g.title}</div>
                <div style={{ display:'flex', gap:8, marginTop:4 }}>
                  <span style={{ fontSize:9, color:'#BF5AF2' }}>{g.source}</span>
                  <span style={{ fontSize:9, color:'rgba(148,163,184,0.5)' }}>{g.date}</span>
                </div>
              </div>
              <span style={{ fontSize:10, color:'#BF5AF2', flexShrink:0 }}>↗</span>
            </a>
          ))}
        </div>
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:0.5}50%{opacity:1}}`}</style>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// INSTITUTIONAL INDICATORS — intégrés dans les tabs existants
// Performance · Risk · Market Structure · Macro · Forex spécifique
// ══════════════════════════════════════════════════════════════════════════════

// ── Helpers visuels ───────────────────────────────────────────────────────────

function seed(s: number) { let x = Math.sin(s) * 10000; return x - Math.floor(x) }

function ReturnPill({ value }: { value: number }) {
  const pos = value >= 0
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 7px', borderRadius: 99, fontSize: 10, fontWeight: 700,
      background: pos ? 'rgba(52,199,89,0.12)' : 'rgba(255,59,48,0.12)',
      color: pos ? '#34C759' : '#FF3B30',
      border: `1px solid ${pos ? 'rgba(52,199,89,0.25)' : 'rgba(255,59,48,0.25)'}`,
    }}>
      {pos ? '▲' : '▼'} {Math.abs(value).toFixed(2)}%
    </span>
  )
}

function MiniGaugeBar({ value, max = 1, color = '#00E5FF' }: { value: number; max?: number; color?: string }) {
  const pct = Math.min(100, (value / max) * 100)
  return (
    <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginTop: 4 }}>
      <div style={{ height: '100%', width: `${pct}%`, borderRadius: 99, background: color, transition: 'width 0.8s ease', boxShadow: `0 0 6px ${color}60` }} />
    </div>
  )
}

function InstitCard({ children, glow = '#00E5FF', title, subtitle }: { children: React.ReactNode; glow?: string; title: string; subtitle?: string }) {
  return (
    <div style={{
      background: 'rgba(8,12,22,0.85)', border: `1px solid ${glow}18`,
      borderRadius: 12, padding: '14px 16px', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg,transparent,${glow}50,transparent)` }} />
      <div style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: `${glow}99`, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{title}</span>
        {subtitle && <span style={{ fontSize: 9, color: 'rgba(143,148,163,0.4)', marginLeft: 8 }}>{subtitle}</span>}
      </div>
      {children}
    </div>
  )
}

// ── Volatility Regime badge ───────────────────────────────────────────────────

type VolRegime = 'low' | 'expansion' | 'panic'
function volRegimeFromATR(atr: number): VolRegime {
  if (atr > 4) return 'panic'
  if (atr > 2) return 'expansion'
  return 'low'
}
function VolRegimeBadge({ regime }: { regime: VolRegime }) {
  const cfg = { low: { label:'Low Vol', color:'#34C759' }, expansion: { label:'Expansion', color:'#FF9500' }, panic: { label:'PANIC', color:'#FF3B30' } }[regime]
  return <span style={{ padding:'2px 7px', borderRadius:99, fontSize:9, fontWeight:800, letterSpacing:'0.08em', background:`${cfg.color}18`, color:cfg.color, border:`1px solid ${cfg.color}40` }}>{cfg.label}</span>
}

// ── Trend Regime badge ────────────────────────────────────────────────────────

type TrendRegime = 'strong_bull' | 'bull' | 'neutral' | 'bear' | 'strong_bear'
function trendFromMAs(ma50: number, ma200: number): TrendRegime {
  const spread = (ma50 - ma200) / ma200 * 100
  if (spread > 10) return 'strong_bull'
  if (spread > 2) return 'bull'
  if (spread > -2) return 'neutral'
  if (spread > -10) return 'bear'
  return 'strong_bear'
}
function TrendBadge({ trend }: { trend: TrendRegime }) {
  const cfg = {
    strong_bull: { label:'⬆⬆ Strong Bull', color:'#34C759' },
    bull:        { label:'⬆ Bull',          color:'#30D158' },
    neutral:     { label:'→ Neutre',         color:'#8F94A3' },
    bear:        { label:'⬇ Bear',           color:'#FF9500' },
    strong_bear: { label:'⬇⬇ Strong Bear', color:'#FF3B30' },
  }[trend]
  return <span style={{ color:cfg.color, fontSize:10, fontWeight:700 }}>{cfg.label}</span>
}

// ── Score Arc Gauge ───────────────────────────────────────────────────────────

function ScoreArc({ score, label, glow }: { score: number; label: string; glow: string }) {
  const pct = score * 100
  const angle = -140 + (score * 280)
  const risk = score > 0.7 ? 'HIGH' : score > 0.4 ? 'MOD.' : 'LOW'
  const riskColor = score > 0.7 ? '#FF3B30' : score > 0.4 ? '#FF9500' : '#34C759'
  return (
    <div style={{ textAlign:'center' }}>
      <div style={{ fontSize:8, fontWeight:800, letterSpacing:'0.12em', textTransform:'uppercase', color:`${glow}99`, marginBottom:8 }}>{label}</div>
      <div style={{ position:'relative', width:110, height:70, margin:'0 auto' }}>
        <svg viewBox="0 0 110 70" style={{ width:'100%', height:'100%', overflow:'visible' }}>
          <path d="M 12 65 A 42 42 0 0 1 98 65" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" strokeLinecap="round" />
          <path d="M 12 65 A 42 42 0 0 1 98 65" fill="none" stroke={glow} strokeWidth="8" strokeLinecap="round"
            strokeDasharray={`${pct * 1.32} 132`} style={{ filter:`drop-shadow(0 0 5px ${glow}80)` }} />
          <g transform={`translate(55,65) rotate(${angle})`}>
            <line x1="0" y1="0" x2="0" y2="-36" stroke={glow} strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="0" cy="0" r="3" fill={glow} />
          </g>
          <text x="55" y="60" textAnchor="middle" fontSize="16" fontWeight="900" fill={glow} fontFamily="JetBrains Mono, monospace">{Math.round(pct)}</text>
        </svg>
      </div>
      <span style={{ fontSize:9, fontWeight:800, letterSpacing:'0.08em', padding:'2px 8px', borderRadius:99, background:`${riskColor}18`, color:riskColor, border:`1px solid ${riskColor}40` }}>{risk}</span>
    </div>
  )
}

// ── Panel : Performance & Relative Strength ───────────────────────────────────
// Intégré dans StocksTab + ForexTab via le bouton "📊 Indicateurs Instit."

interface InstitAsset {
  symbol: string; price: number; change1D: number; change1W: number; change1M: number; changeYTD: number
  vs_benchmark: number; sharpe: number; atr: number; maxDrawdown: number; recoveryDays: number | null
  ma50: number; ma200: number
}

function buildInstitData(tokens: TokenRSIWithDiv[]): InstitAsset[] {
  return tokens.map((t, i) => {
    const r = (o = 0) => (seed(i * 17 + o) * 2 - 1)
    const price = t.price || (50 + seed(i * 7) * 2000)
    return {
      symbol: t.symbol, price,
      change1D: t.change24h ?? r(1) * 3,
      change1W: r(2) * 8, change1M: r(3) * 18, changeYTD: r(4) * 40,
      vs_benchmark: r(5) * 22,
      sharpe: -0.5 + seed(i * 11) * 3.5,
      atr: 0.4 + seed(i * 13) * 4,
      maxDrawdown: -(5 + seed(i * 19) * 55),
      recoveryDays: seed(i * 31) > 0.5 ? Math.floor(seed(i * 37) * 180) : null,
      ma50: price * (1 + r(5) * 0.12),
      ma200: price * (1 + r(6) * 0.22),
    }
  })
}

function InstitPerformancePanel({ tokens, benchmarkLabel = 'S&P 500' }: { tokens: TokenRSIWithDiv[]; benchmarkLabel?: string }) {
  const [sortField, setSortField] = useState<'changeYTD'|'change1D'|'sharpe'|'vs_benchmark'>('changeYTD')
  const [sortDir, setSortDir] = useState<1|-1>(-1)

  const data = useMemo(() => buildInstitData(tokens), [tokens.map(t=>t.symbol).join(',')])
  const sorted = useMemo(() => [...data].sort((a,b) => (b[sortField] - a[sortField]) * sortDir), [data, sortField, sortDir])

  function toggleSort(f: typeof sortField) {
    if (sortField === f) setSortDir(d => d === 1 ? -1 : 1)
    else { setSortField(f); setSortDir(-1) }
  }

  const TH = ({ label, field }: { label: string; field?: typeof sortField }) => (
    <th style={{ padding:'5px 8px', textAlign:'right', color:'rgba(143,148,163,0.5)', fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', cursor:field?'pointer':'default', userSelect:'none', whiteSpace:'nowrap' }}
      onClick={() => field && toggleSort(field)}>
      {label}{field && sortField===field ? (sortDir===-1?' ↓':' ↑'):''}
    </th>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {/* Relative Strength strip */}
      <InstitCard glow='#34C759' title='Force Relative' subtitle={`vs ${benchmarkLabel}`}>
        <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
          {sorted.slice(0,16).map(a => (
            <div key={a.symbol} style={{ padding:'7px 10px', borderRadius:8, background: a.vs_benchmark>=0?'rgba(52,199,89,0.07)':'rgba(255,59,48,0.07)', border:`1px solid ${a.vs_benchmark>=0?'rgba(52,199,89,0.2)':'rgba(255,59,48,0.2)'}` }}>
              <div style={{ fontSize:10, fontWeight:800, color:'#F0F3FF' }}>{a.symbol}</div>
              <div style={{ fontSize:12, fontWeight:900, fontFamily:'JetBrains Mono,monospace', color:a.vs_benchmark>=0?'#34C759':'#FF3B30' }}>{a.vs_benchmark>=0?'+':''}{a.vs_benchmark.toFixed(1)}%</div>
            </div>
          ))}
        </div>
      </InstitCard>

      {/* MTF Returns table */}
      <InstitCard glow='#0A85FF' title='Rendements Multi-Périodes' subtitle='1D · 1W · 1M · YTD · Sharpe'>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
            <thead>
              <tr style={{ borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
                <th style={{ padding:'5px 8px', textAlign:'left', color:'rgba(143,148,163,0.5)', fontSize:9, fontWeight:700, textTransform:'uppercase' }}>Asset</th>
                <TH label="1D" field="change1D" />
                <TH label="1W" />
                <TH label="1M" />
                <TH label="YTD" field="changeYTD" />
                <TH label="Sharpe" field="sharpe" />
                <TH label="RS" field="vs_benchmark" />
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0,20).map((a,i) => (
                <tr key={a.symbol} style={{ borderBottom:'1px solid rgba(255,255,255,0.04)' }}
                  onMouseEnter={e=>(e.currentTarget.style.background='rgba(255,255,255,0.02)')}
                  onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                  <td style={{ padding:'6px 8px', fontWeight:700, color:'#F0F3FF', fontSize:11, whiteSpace:'nowrap' }}>{a.symbol}</td>
                  {[a.change1D,a.change1W,a.change1M,a.changeYTD].map((v,j) => (
                    <td key={j} style={{ padding:'6px 8px', textAlign:'right' }}><ReturnPill value={v} /></td>
                  ))}
                  <td style={{ padding:'6px 8px', textAlign:'right', fontFamily:'JetBrains Mono,monospace', fontSize:11, fontWeight:700, color:a.sharpe>1?'#34C759':a.sharpe>0?'#FF9500':'#FF3B30' }}>{a.sharpe.toFixed(2)}</td>
                  <td style={{ padding:'6px 8px', textAlign:'right' }}><ReturnPill value={a.vs_benchmark} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </InstitCard>
    </div>
  )
}

// ── Panel : Risque ────────────────────────────────────────────────────────────

function InstitRiskPanel({ tokens }: { tokens: TokenRSIWithDiv[] }) {
  const data = useMemo(() => buildInstitData(tokens), [tokens.map(t=>t.symbol).join(',')])

  const byDrawdown = [...data].sort((a,b) => a.maxDrawdown - b.maxDrawdown).slice(0,12)
  const byATR = [...data].sort((a,b) => b.atr - a.atr).slice(0,12)

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {/* Volatility Regime */}
      <InstitCard glow='#FF9500' title='Régime de Volatilité' subtitle='ATR · Low / Expansion / Panic'>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:8 }}>
          {byATR.map(a => {
            const regime = volRegimeFromATR(a.atr)
            return (
              <div key={a.symbol} style={{ padding:'10px 12px', borderRadius:10, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ fontSize:11, fontWeight:800, color:'#F0F3FF' }}>{a.symbol}</div>
                  <div style={{ fontSize:12, fontWeight:900, fontFamily:'JetBrains Mono,monospace', color:'#FF9500', marginTop:2 }}>ATR {a.atr.toFixed(2)}%</div>
                  <div style={{ fontSize:10, color:'rgba(143,148,163,0.5)', marginTop:1 }}>VaR 95% {(a.atr*1.65).toFixed(2)}%</div>
                </div>
                <VolRegimeBadge regime={regime} />
              </div>
            )
          })}
        </div>
      </InstitCard>

      {/* Drawdown */}
      <InstitCard glow='#FF3B30' title='Analyse Drawdown' subtitle='Max drawdown · Durée de récupération'>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {byDrawdown.map(a => (
            <div key={a.symbol} style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ width:64, fontSize:11, fontWeight:700, color:'#F0F3FF', flexShrink:0 }}>{a.symbol}</div>
              <div style={{ flex:1, height:5, borderRadius:99, background:'rgba(255,255,255,0.06)', overflow:'hidden' }}>
                <div style={{ height:'100%', borderRadius:99, background:'linear-gradient(90deg,#FF3B30,#FF9500)', width:`${Math.abs(a.maxDrawdown)}%`, transition:'width 0.7s ease' }} />
              </div>
              <div style={{ width:52, textAlign:'right', fontSize:11, fontWeight:700, fontFamily:'JetBrains Mono,monospace', color:'#FF3B30', flexShrink:0 }}>{a.maxDrawdown.toFixed(1)}%</div>
              <div style={{ width:80, textAlign:'right', fontSize:9, color:'rgba(143,148,163,0.4)', flexShrink:0 }}>
                {a.recoveryDays!=null?`${a.recoveryDays}j récup.`:'En cours'}
              </div>
            </div>
          ))}
        </div>
      </InstitCard>
    </div>
  )
}

// ── Panel : Structure de marché ───────────────────────────────────────────────

function InstitStructurePanel({ tokens }: { tokens: TokenRSIWithDiv[] }) {
  const data = useMemo(() => buildInstitData(tokens), [tokens.map(t=>t.symbol).join(',')])

  const aboveMA200 = useMemo(() => Math.round((data.filter(a => a.ma50 > a.ma200).length / Math.max(1, data.length)) * 100), [data])
  const adRatio = 2.3 // simulated

  const SECTORS = [
    { name:'Technology', emoji:'💻', ret:8.2, color:'#0A85FF' },
    { name:'Healthcare',  emoji:'🏥', ret:3.1, color:'#34C759' },
    { name:'Financials',  emoji:'🏦', ret:5.7, color:'#BF5AF2' },
    { name:'Energy',      emoji:'⚡', ret:-2.3, color:'#FF9500' },
    { name:'Cons. Discr.',emoji:'🛍', ret:4.8, color:'#FF2D55' },
    { name:'Industrials', emoji:'⚙️', ret:2.2, color:'#00E5FF' },
    { name:'Materials',   emoji:'⛏️', ret:-1.1, color:'#FFD60A' },
    { name:'Real Estate', emoji:'🏢', ret:-3.8, color:'#FF6961' },
    { name:'Utilities',   emoji:'💡', ret:-0.5, color:'#5AC8FA' },
    { name:'Comm. Svc.',  emoji:'📡', ret:6.3, color:'#AF52DE' },
    { name:'Staples',     emoji:'🛒', ret:1.4, color:'#6C6C70' },
  ].sort((a,b) => b.ret - a.ret)

  const maxAbs = Math.max(...SECTORS.map(s => Math.abs(s.ret)))

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {/* Trend Regime grid */}
      <InstitCard glow='#00E5FF' title='Régime de Tendance' subtitle='MA50 / MA200 alignment'>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:8 }}>
          {data.slice(0,12).map(a => {
            const trend = trendFromMAs(a.ma50, a.ma200)
            const spread = (a.ma50-a.ma200)/a.ma200*100
            const bullish = a.ma50 > a.ma200
            return (
              <div key={a.symbol} style={{ padding:'10px 12px', borderRadius:10, background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                  <span style={{ fontSize:11, fontWeight:800, color:'#F0F3FF' }}>{a.symbol}</span>
                  <TrendBadge trend={trend} />
                </div>
                <div style={{ display:'flex', gap:10, fontSize:9, color:'rgba(143,148,163,0.5)', marginBottom:6 }}>
                  <span>MA50 <b style={{color:'#0A85FF',fontFamily:'JetBrains Mono,monospace'}}>{a.ma50.toFixed(0)}</b></span>
                  <span>MA200 <b style={{color:'#BF5AF2',fontFamily:'JetBrains Mono,monospace'}}>{a.ma200.toFixed(0)}</b></span>
                  <span style={{color:bullish?'#34C759':'#FF3B30',fontWeight:700}}>{spread>=0?'+':''}{spread.toFixed(1)}%</span>
                </div>
                <div style={{ height:3, borderRadius:99, background:'rgba(255,255,255,0.05)', overflow:'hidden' }}>
                  <div style={{ height:'100%', borderRadius:99, width:`${Math.min(100,50+Math.abs(spread)*3)}%`, background:bullish?'linear-gradient(90deg,#0A85FF,#34C759)':'linear-gradient(90deg,#BF5AF2,#FF3B30)' }} />
                </div>
              </div>
            )
          })}
        </div>
      </InstitCard>

      {/* Market Breadth */}
      <InstitCard glow='#0A85FF' title='Breadth du Marché' subtitle='% au-dessus MA200 · Advance/Decline'>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          <div>
            <div style={{ fontSize:9, color:'rgba(143,148,163,0.5)', marginBottom:4 }}>% au-dessus MA200</div>
            <div style={{ fontSize:28, fontWeight:900, fontFamily:'JetBrains Mono,monospace', color:'#0A85FF' }}>{aboveMA200}%</div>
            <MiniGaugeBar value={aboveMA200} max={100} color='#0A85FF' />
            <div style={{ fontSize:9, color:'rgba(143,148,163,0.4)', marginTop:4 }}>{aboveMA200>70?'🟢 Breadth haussier':aboveMA200>50?'🟡 Modéré':'🔴 Breadth faible'}</div>
          </div>
          <div>
            <div style={{ fontSize:9, color:'rgba(143,148,163,0.5)', marginBottom:4 }}>Advance / Decline</div>
            <div style={{ fontSize:28, fontWeight:900, fontFamily:'JetBrains Mono,monospace', color:'#34C759' }}>{adRatio}x</div>
            <MiniGaugeBar value={adRatio} max={5} color='#34C759' />
            <div style={{ fontSize:9, color:'rgba(143,148,163,0.4)', marginTop:4 }}>🟢 Large participation</div>
          </div>
        </div>
      </InstitCard>

      {/* Sector Rotation */}
      <InstitCard glow='#FF9500' title='Rotation Sectorielle' subtitle='Perf. 1M par secteur'>
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {SECTORS.map((s,i) => (
            <div key={s.name} style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:12, flexShrink:0 }}>{s.emoji}</span>
              <div style={{ width:110, fontSize:10, fontWeight:600, color:'rgba(240,243,255,0.8)', flexShrink:0 }}>{s.name}</div>
              <div style={{ flex:1, position:'relative', height:5, borderRadius:99, background:'rgba(255,255,255,0.05)', overflow:'hidden' }}>
                <div style={{ position:'absolute', height:'100%', borderRadius:99, background:s.ret>=0?`linear-gradient(90deg,rgba(52,199,89,0.5),#34C759)`:`linear-gradient(90deg,rgba(255,59,48,0.5),#FF3B30)`, width:`${(Math.abs(s.ret)/maxAbs)*100}%`, transition:`width ${0.4+i*0.04}s ease` }} />
              </div>
              <div style={{ width:52, textAlign:'right', flexShrink:0 }}><ReturnPill value={s.ret} /></div>
            </div>
          ))}
        </div>
      </InstitCard>
    </div>
  )
}

// ── Panel : Macro (DXY, Taux, CPI, M2) ───────────────────────────────────────

function InstitMacroPanel() {
  const macro = {
    dxy: 103.4, dxyChg: -0.32,
    us10y: 4.28, us10yChg: 0.05,
    cpi: 3.2, cpiChg: -0.1,
    m2: 21.3, m2Chg: 0.8,
    fedRate: 5.375, us2y: 4.82,
    macroRisk: 0.62, trendScore: 0.58,
  }

  const MACRO_SCORES = [
    { label:'Inversion courbe', value:0.85, desc:'Spread 2Y–10Y négatif : −0.54%', color:'#FF3B30' },
    { label:'Inflation vs cible', value:0.62, desc:'CPI 3.2% vs objectif Fed 2.0%', color:'#FF9500' },
    { label:'Force USD (DXY)',   value:0.56, desc:'DXY 103.4 — force modérée', color:'#00E5FF' },
    { label:'Liquidité (M2)',    value:0.38, desc:'M2 en contraction légère', color:'#BF5AF2' },
    { label:'Croissance BPA',   value:0.48, desc:'S&P 500 FY EPS +7.2% est.', color:'#34C759' },
  ]

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {/* KPI row */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:10 }}>
        {[
          { label:'Dollar Index (DXY)', value:`${macro.dxy.toFixed(2)}`, chg:macro.dxyChg, glow:'#00E5FF', icon:'💵' },
          { label:'US 10Y Yield',       value:`${macro.us10y.toFixed(2)}%`, chg:macro.us10yChg, glow:'#FF9500', icon:'📊' },
          { label:'CPI Inflation YoY',  value:`${macro.cpi.toFixed(1)}%`, chg:macro.cpiChg, glow:'#FF3B30', icon:'📈' },
          { label:'M2 Money Supply',    value:`$${macro.m2.toFixed(1)}T`, chg:macro.m2Chg, glow:'#BF5AF2', icon:'🏦' },
        ].map(k => (
          <div key={k.label} style={{ padding:'12px 14px', borderRadius:12, background:'rgba(8,12,22,0.85)', border:`1px solid ${k.glow}20`, position:'relative', overflow:'hidden' }}>
            <div style={{ position:'absolute', top:0, left:0, right:0, height:1, background:`linear-gradient(90deg,transparent,${k.glow}50,transparent)` }} />
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
              <span style={{ fontSize:8, fontWeight:800, letterSpacing:'0.12em', textTransform:'uppercase', color:`${k.glow}99` }}>{k.label}</span>
              <span style={{ fontSize:14 }}>{k.icon}</span>
            </div>
            <div style={{ fontSize:22, fontWeight:900, fontFamily:'JetBrains Mono,monospace', color:k.glow, textShadow:`0 0 16px ${k.glow}50` }}>{k.value}</div>
            <div style={{ marginTop:6 }}><ReturnPill value={k.chg} /></div>
          </div>
        ))}
      </div>

      {/* Rate Environment */}
      <InstitCard glow='#FF9500' title='Environnement de Taux'>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          {[
            { label:'Fed Funds Rate', value:`${macro.fedRate.toFixed(2)}%`, color:'#FF9500' },
            { label:'US 10Y Yield',   value:`${macro.us10y.toFixed(2)}%`, color:'#FF9500' },
            { label:'US 2Y Yield',    value:`${macro.us2y.toFixed(2)}%`, color:'#FF3B30' },
            { label:'Spread 2Y–10Y',  value:`${(macro.us10y - macro.us2y).toFixed(2)}%`, color:'#BF5AF2' },
          ].map(item => (
            <div key={item.label}>
              <div style={{ fontSize:9, color:'rgba(143,148,163,0.5)' }}>{item.label}</div>
              <div style={{ fontSize:18, fontWeight:900, fontFamily:'JetBrains Mono,monospace', color:item.color, marginTop:2 }}>{item.value}</div>
            </div>
          ))}
        </div>
        {macro.us10y - macro.us2y < 0 && (
          <div style={{ marginTop:12, padding:'8px 12px', borderRadius:8, background:'rgba(255,59,48,0.08)', border:'1px solid rgba(255,59,48,0.2)' }}>
            <span style={{ fontSize:10, color:'#FF3B30', fontWeight:700 }}>⚠️ Courbe inversée — signal historique de récession</span>
          </div>
        )}
      </InstitCard>

      {/* Composite Scores */}
      <InstitCard glow='#FF9500' title='Scores Composites' subtitle='Normalisés 0–1'>
        <div style={{ display:'flex', justifyContent:'space-around', flexWrap:'wrap', gap:16, marginBottom:20 }}>
          <ScoreArc score={macro.macroRisk} label='Macro Risk Score' glow='#FF9500' />
          <ScoreArc score={macro.trendScore} label='Trend Strength' glow='#34C759' />
          <ScoreArc score={0.41} label='Vol Risk Score' glow='#FF3B30' />
          <ScoreArc score={0.72} label='USD Strength' glow='#00E5FF' />
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {MACRO_SCORES.map(item => (
            <div key={item.label}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                <span style={{ fontSize:10, fontWeight:700, color:'rgba(240,243,255,0.8)' }}>{item.label}</span>
                <span style={{ fontSize:10, fontWeight:800, fontFamily:'JetBrains Mono,monospace', color:item.color }}>{Math.round(item.value*100)}/100</span>
              </div>
              <MiniGaugeBar value={item.value} max={1} color={item.color} />
              <div style={{ fontSize:9, color:'rgba(143,148,163,0.4)', marginTop:2 }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </InstitCard>
    </div>
  )
}

// ── Panel : Forex spécifique ──────────────────────────────────────────────────

const CURRENCIES_DATA = [
  { code:'USD', flag:'🇺🇸', strength:68, rate:1,      chg: 0.1, ir:5.33 },
  { code:'EUR', flag:'🇪🇺', strength:54, rate:1.082,  chg:-0.3, ir:4.00 },
  { code:'GBP', flag:'🇬🇧', strength:61, rate:1.264,  chg: 0.2, ir:5.25 },
  { code:'JPY', flag:'🇯🇵', strength:29, rate:0.0066, chg:-0.8, ir:0.10 },
  { code:'CHF', flag:'🇨🇭', strength:72, rate:1.124,  chg: 0.4, ir:1.75 },
  { code:'AUD', flag:'🇦🇺', strength:43, rate:0.648,  chg:-0.2, ir:4.35 },
  { code:'NZD', flag:'🇳🇿', strength:41, rate:0.597,  chg:-0.1, ir:5.50 },
  { code:'CAD', flag:'🇨🇦', strength:47, rate:0.738,  chg: 0.0, ir:5.00 },
]

function InstitForexPanel() {
  const sorted = [...CURRENCIES_DATA].sort((a,b) => b.strength - a.strength)

  // Top carry pairs
  const byCurrSorted = [...CURRENCIES_DATA].sort((a,b) => b.ir - a.ir)
  const carryPairs: Array<{long: typeof CURRENCIES_DATA[0]; short: typeof CURRENCIES_DATA[0]; diff: number}> = []
  for (let i = 0; i < 2; i++) {
    for (let j = CURRENCIES_DATA.length-1; j >= CURRENCIES_DATA.length-3; j--) {
      const diff = byCurrSorted[i].ir - byCurrSorted[j].ir
      carryPairs.push({ long: byCurrSorted[i], short: byCurrSorted[j], diff })
    }
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {/* Currency Strength Meter */}
      <InstitCard glow='#BF5AF2' title='Currency Strength Meter' subtitle='Score 0–100 par devise'>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))', gap:10 }}>
          {sorted.map(c => {
            const color = c.strength>60?'#34C759':c.strength>40?'#FF9500':'#FF3B30'
            return (
              <div key={c.code} style={{ padding:'10px 12px', borderRadius:10, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                  <span style={{ fontSize:18 }}>{c.flag}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12, fontWeight:800, color:'#F0F3FF' }}>{c.code}</div>
                    <div style={{ fontSize:9, color:'rgba(143,148,163,0.4)' }}>Rate {c.ir}%</div>
                  </div>
                  <span style={{ fontSize:18, fontWeight:900, fontFamily:'JetBrains Mono,monospace', color }}>{c.strength}</span>
                </div>
                <MiniGaugeBar value={c.strength} max={100} color={color} />
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, marginTop:4 }}>
                  <span style={{ color:'rgba(143,148,163,0.4)', fontFamily:'JetBrains Mono,monospace' }}>{c.rate.toFixed(4)}</span>
                  <ReturnPill value={c.chg} />
                </div>
              </div>
            )
          })}
        </div>
      </InstitCard>

      {/* Carry Trade */}
      <InstitCard glow='#34C759' title='Carry Trade' subtitle='Différentiels de taux'>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {carryPairs.slice(0,5).map((p,i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 12px', borderRadius:10, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:14 }}>{p.long.flag}</span>
                <span style={{ fontSize:11, fontWeight:700, color:'#34C759' }}>LONG {p.long.code}</span>
                <span style={{ color:'rgba(143,148,163,0.3)', fontSize:10 }}>vs</span>
                <span style={{ fontSize:14 }}>{p.short.flag}</span>
                <span style={{ fontSize:11, fontWeight:700, color:'#FF3B30' }}>SHORT {p.short.code}</span>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:14, fontWeight:900, fontFamily:'JetBrains Mono,monospace', color:'#00E5FF' }}>+{p.diff.toFixed(2)}%</div>
                <div style={{ fontSize:8, color:'rgba(143,148,163,0.4)' }}>rate diff</div>
              </div>
            </div>
          ))}
        </div>
      </InstitCard>
    </div>
  )
}

// ── Wrapper : bouton toggle + contenu institutionnel ──────────────────────────

type InstitTab = 'performance' | 'risque' | 'structure' | 'macro' | 'forex'

function InstitIndicatorsWrapper({ tokens, mode, benchmarkLabel }: { tokens: TokenRSIWithDiv[]; mode: 'stocks' | 'forex' | 'crypto'; benchmarkLabel?: string }) {
  const [open, setOpen]         = useState(false)
  const [activeTab, setActiveTab] = useState<InstitTab>('performance')

  const TABS_BY_MODE: Record<typeof mode, { id: InstitTab; label: string; icon: string }[]> = {
    stocks: [
      { id:'performance', label:'Performance',       icon:'📊' },
      { id:'risque',      label:'Risque',            icon:'⚠️' },
      { id:'structure',   label:'Structure Marché',  icon:'🏗️' },
      { id:'macro',       label:'Macro',             icon:'🏛️' },
    ],
    forex: [
      { id:'performance', label:'Performance',       icon:'📊' },
      { id:'risque',      label:'Risque',            icon:'⚠️' },
      { id:'forex',       label:'Forex Spécifique',  icon:'💱' },
      { id:'macro',       label:'Macro',             icon:'🏛️' },
    ],
    crypto: [
      { id:'performance', label:'Performance',       icon:'📊' },
      { id:'risque',      label:'Risque',            icon:'⚠️' },
      { id:'structure',   label:'Structure',         icon:'🏗️' },
      { id:'macro',       label:'Macro',             icon:'🏛️' },
    ],
  }

  const tabs = TABS_BY_MODE[mode]

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Toggle button */}
      <motion.button
        onClick={() => setOpen(o => !o)}
        whileHover={{ y: -1 }}
        style={{
          padding: '6px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
          fontSize: 11, fontWeight: 700, transition: 'all 0.15s',
          background: open ? 'rgba(255,149,0,0.12)' : 'rgba(255,255,255,0.04)',
          color: open ? '#FF9500' : 'rgba(143,148,163,0.6)',
          border: `1px solid ${open ? 'rgba(255,149,0,0.4)' : 'rgba(255,255,255,0.08)'}`,
          boxShadow: open ? '0 0 12px rgba(255,149,0,0.15)' : 'none',
          display: 'flex', alignItems: 'center', gap: 6,
        }}
      >
        🏛️ Indicateurs Institutionnels {open ? '▲' : '▼'}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            style={{ overflow: 'hidden', marginTop: 12 }}
          >
            {/* Sub-tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
              {tabs.map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  style={{
                    padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    fontSize: 11, fontWeight: 700, transition: 'all 0.15s',
                    background: activeTab === tab.id ? 'rgba(255,149,0,0.1)' : 'rgba(255,255,255,0.03)',
                    color: activeTab === tab.id ? '#FF9500' : 'rgba(143,148,163,0.5)',
                    borderBottom: `2px solid ${activeTab === tab.id ? '#FF9500' : 'transparent'}`,
                  }}>
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              <motion.div key={activeTab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                {activeTab === 'performance' && <InstitPerformancePanel tokens={tokens} benchmarkLabel={benchmarkLabel} />}
                {activeTab === 'risque'      && <InstitRiskPanel tokens={tokens} />}
                {activeTab === 'structure'   && <InstitStructurePanel tokens={tokens} />}
                {activeTab === 'macro'       && <InstitMacroPanel />}
                {activeTab === 'forex'       && <InstitForexPanel />}
              </motion.div>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
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

      {/* Institutional Indicators */}
      <InstitIndicatorsWrapper tokens={screenerTokens.length > 0 ? screenerTokens : tokens} mode="crypto" benchmarkLabel="BTC" />
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
    { id:'crypto',      label:'🪙 Crypto',             glow:'191,90,242' },
    { id:'actions',     label:'📈 Actions',             glow:'10,133,255' },
    { id:'forex',       label:'💱 Forex & Commodités',  glow:'52,199,89'  },
    { id:'multiasset',  label:'🌐 Multi-Asset',         glow:'255,149,0'  },
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
                { label:'16 Forex · 5 Métaux · 5 Énergie · Indices', glow:'52,199,89' },
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
            {tab === 'crypto'      && <CryptoTab     onTokenClick={handleTokenClick} shareRef={cryptoShareRef} />}
            {tab === 'actions'     && <StocksTab     onTokenClick={handleTokenClick} shareRef={stocksShareRef} />}
            {tab === 'forex'       && <ForexTab       onTokenClick={handleTokenClick} shareRef={forexShareRef}  />}
            {tab === 'multiasset'  && <MultiAssetTab />}
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
