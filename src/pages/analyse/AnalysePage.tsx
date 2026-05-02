// src/pages/analyse/AnalysePage.tsx — v2
// Miroir exact de LiquidityCVDStackView.swift + MarketContextService.swift
// 3 modes : Micro / Structure / Dérivés + Derivatives Confluence Card + vraie recherche

import React, { useState, useEffect, useRef, useCallback } from 'react'
import ReactDOM from 'react-dom'
import LiquidationHeatmap from './LiquidationHeatmap'
import MTFDashboard from './MTFDashboard'
import type { MTFSnapshot } from './MTFDashboard'
import { WaveTrendChart, VMCOscillatorChart, RSIChart, RSIBollingerChart } from './OscillatorCharts'
import TradePlanCard from './TradePlanCard'
import type { TradePlanData, GPTSections } from './TradePlanCard'
import LiveChart from './LiveChart'
import LightweightChart from './LightweightChart'
import type { LightweightChartHandle } from './LightweightChart'
import KeyLevelsCard from './KeyLevelsCard'
import type { KeyLevel } from './KeyLevelsCard'
import ChartScreenshotAnalysis from './ChartScreenshotAnalysis'
import FootprintChart from './FootprintChart'
import type { AnalysisPDFData } from './AnalysisPDFExport'
import MarketStateEngine from './MarketStateEngine'
import OUChannelIndicator from './OUChannelIndicator'
import DecisionAssistant from '@/components/decision/DecisionAssistant'
import { getAuth } from 'firebase/auth'
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore'
import app from '@/services/firebase/config'

const db = getFirestore(app)

// ── Firestore panel order persistence ────────────────────────────────────────
const DEFAULT_PANEL_ORDER = ['canal-ou', 'wavetrend', 'vmc', 'rsi', 'rsi-bollinger', 'trade-plan', 'mtf', 'levels', 'heatmap']
const DEFAULT_PANEL_OPEN: Record<string, boolean> = {
  'canal-ou': true, 'wavetrend': true, 'vmc': true, 'rsi': false,
  'rsi-bollinger': false, 'trade-plan': true, 'mtf': true, 'levels': true, 'heatmap': true,
}

async function savePanelLayout(order: string[], openState: Record<string, boolean>) {
  const uid = getAuth().currentUser?.uid
  if (!uid) return
  try {
    await setDoc(doc(db, 'users', uid, 'settings', 'analysePanels'), { order, openState, updatedAt: Date.now() }, { merge: true })
  } catch { /* ignore */ }
}

async function loadPanelLayout(): Promise<{ order: string[]; openState: Record<string, boolean> } | null> {
  const uid = getAuth().currentUser?.uid
  if (!uid) return null
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'settings', 'analysePanels'))
    if (snap.exists()) return snap.data() as { order: string[]; openState: Record<string, boolean> }
  } catch { /* ignore */ }
  return null
}
// Détecte si le symbole est une crypto Binance
function isCryptoSymbol(symbol: string) {
  return /USDT$|BUSD$|BTC$|ETH$|BNB$/i.test(symbol)
}

// ── Share / Screenshot wrapper ──────────────────────────────────────────
// ── CollapsiblePanel — volet repliable draggable avec partage intégré ─────────
function CollapsiblePanel({
  children, label, icon, defaultOpen = true, accent = 'rgba(0,229,255,0.5)',
  panelId, onDragStart, onDragOver, onDrop, isDragging,
}: {
  children: React.ReactNode
  label: string
  icon?: string
  defaultOpen?: boolean
  accent?: string
  panelId?: string
  onDragStart?: (id: string) => void
  onDragOver?: (e: React.DragEvent, id: string) => void
  onDrop?: (e: React.DragEvent, id: string) => void
  isDragging?: boolean
}) {
  const ref        = useRef<HTMLDivElement>(null)
  const [open,     setOpen]    = useState(defaultOpen)
  const [copied,   setCopied]  = useState(false)
  const [sharing,  setSharing] = useState(false)

  const handleShare = async () => {
    const el = ref.current
    if (!el || sharing) return
    setSharing(true)
    try {
      let blob: Blob | null = null
      const canvases = Array.from(el.querySelectorAll('canvas')) as HTMLCanvasElement[]
      const cv = canvases.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0]
      if (cv && cv.width > 0 && cv.height > 0) {
        blob = await (await fetch(cv.toDataURL('image/png'))).blob()
      } else {
        const { toPng } = await import('html-to-image')
        const dataUrl = await toPng(el, {
          quality: 1, pixelRatio: 2,
          backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--tm-bg').trim() || '#0D1117',
          filter: (node) => !(node instanceof HTMLButtonElement && node.dataset.shareBtn),
        })
        blob = await (await fetch(dataUrl)).blob()
      }
      if (!blob) return
      const filename = `trademindset-${label.toLowerCase().replace(/\s+/g, '-')}.png`
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        setCopied(true); setTimeout(() => setCopied(false), 2500); return
      } catch { /* fallback */ }
      if (navigator.share && navigator.canShare) {
        const file = new File([blob], filename, { type: 'image/png' })
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ title: `TradeMindset — ${label}`, files: [file] })
          setCopied(true); setTimeout(() => setCopied(false), 2500); return
        }
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
      setCopied(true); setTimeout(() => setCopied(false), 2500)
    } catch (err) { console.warn('Share failed:', err) }
    finally { setSharing(false) }
  }

  return (
    <div
      draggable={!!panelId}
      onDragStart={panelId ? () => onDragStart?.(panelId) : undefined}
      onDragOver={panelId ? (e) => { e.preventDefault(); onDragOver?.(e, panelId) } : undefined}
      onDrop={panelId ? (e) => onDrop?.(e, panelId) : undefined}
      style={{
        marginBottom: 10, position: 'relative', zIndex: 1,
        opacity: isDragging ? 0.4 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      {/* Header bar — always visible */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 14px',
          background: open ? 'rgba(13,17,35,0.85)' : 'rgba(13,17,35,0.6)',
          border: `1px solid ${open ? accent.replace('0.5','0.3') : 'rgba(255,255,255,0.07)'}`,
          borderRadius: open ? '12px 12px 0 0' : 12,
          backdropFilter: 'blur(12px)',
          transition: 'all 0.2s',
          userSelect: 'none' as const,
        }}
      >
        {/* Drag handle */}
        {panelId && (
          <div
            onClick={e => e.stopPropagation()}
            style={{
              cursor: 'grab', flexShrink: 0, color: 'rgba(255,255,255,0.2)',
              fontSize: 12, lineHeight: 1, padding: '0 2px',
              display: 'flex', flexDirection: 'column', gap: 2,
            }}
            title="Glisser pour réorganiser"
          >
            <div style={{ display: 'flex', gap: 2 }}>
              <div style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.3)' }} />
              <div style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.3)' }} />
            </div>
            <div style={{ display: 'flex', gap: 2 }}>
              <div style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.3)' }} />
              <div style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.3)' }} />
            </div>
          </div>
        )}

        {/* Accent dot */}
        <div
          onClick={() => setOpen(o => !o)}
          style={{
            width: 3, height: 16, borderRadius: 2,
            background: open ? accent : 'rgba(255,255,255,0.15)',
            flexShrink: 0, transition: 'background 0.2s', cursor: 'pointer',
          }} />

        {/* Icon */}
        {icon && <span style={{ fontSize: 14, flexShrink: 0, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>{icon}</span>}

        {/* Label */}
        <span
          onClick={() => setOpen(o => !o)}
          style={{
            flex: 1, fontSize: 12, fontWeight: 700,
            color: open ? 'var(--tm-text-primary)' : 'var(--tm-text-muted)',
            fontFamily: 'Syne, sans-serif', letterSpacing: '0.01em',
            transition: 'color 0.2s', cursor: 'pointer',
          }}>
          {label}
        </span>

        {/* Share button */}
        <button
          data-share-btn
          onClick={e => { e.stopPropagation(); handleShare() }}
          disabled={sharing || !open}
          title={`Partager ${label}`}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '3px 10px', borderRadius: 7, fontSize: 10, fontWeight: 600,
            background: copied ? 'rgba(34,199,89,0.2)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${copied ? '#22C759' : 'rgba(255,255,255,0.12)'}`,
            color: copied ? '#22C759' : sharing ? 'var(--tm-text-muted)' : 'var(--tm-text-muted)',
            cursor: (!open || sharing) ? 'not-allowed' : 'pointer',
            opacity: open ? 1 : 0.4,
            transition: 'all 0.15s', flexShrink: 0,
          }}
        >
          {copied ? '✓ Copié' : sharing ? '⏳' : '↗ Partager'}
        </button>

        {/* Chevron */}
        <svg
          width="12" height="12" viewBox="0 0 12 12" fill="none"
          style={{ flexShrink: 0, transition: 'transform 0.25s', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', cursor: 'pointer' }}
          onClick={() => setOpen(o => !o)}
        >
          <path d="M2 4l4 4 4-4" stroke="var(--tm-text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {/* Content — ref for screenshot */}
      <div
        ref={ref}
        style={{
          overflow: 'hidden',
          maxHeight: open ? '9999px' : 0,
          transition: 'max-height 0.35s ease',
          borderRadius: '0 0 12px 12px',
          border: open ? `1px solid ${accent.replace('0.5','0.15')}` : 'none',
          borderTop: 'none',
        }}
      >
        <div style={{ padding: '0' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

// Compat alias — les anciens ShareWrapper restent valides
function ShareWrapper({ children, label }: { children: React.ReactNode; label: string }) {
  return <CollapsiblePanel label={label}>{children}</CollapsiblePanel>
}

// ── Types ──────────────────────────────────────────────────────────────────
type Mode = 'micro' | 'structure' | 'derivees' | 'orderflow' | 'charts'
type Seg  = 'small'|'medium'|'large'|'institutional'|'whales'|'all'
type CVDBias = 'bullish'|'bearish'|'neutral'

interface Tick { ts: number; price: number; vol: number; isBuy: boolean }
interface CVDPt { t: number; small: number; medium: number; large: number; institutional: number; whales: number; all: number }
interface WhalePressure { score: number; buyVol: number; sellVol: number; trades: number; label: string }
interface TrapEvent { id: string; type: string; price: number; conf: number; whaleDelta: number; cvdDelta: number; age: number; ts: number }
interface AbsEvent  { id: string; type: 'buy'|'sell'; strength: number; price: number; ts: number }
interface OIData    { usd: number; btc: number; h1: number; h4: number; h24: number; history: number[]; signal: string; bullish: boolean|null }
interface Funding   { rate: number; mark: number; index: number; basis: number; basisPct: number; nextIn: string; bias: string; isWarning: boolean }
interface WhaleTrendPt { t: number; cum: number; ema: number; retail: number }
interface WhaleSummary { trend: string; trendColor: string; netCVD: number; momentum: number; divergence: string }
interface ContextData  { lsRatio: number|null; lsLongPct: number|null; oiUSD: number|null; oiChange1h: number|null; cvdDelta: number|null; cvdBias: CVDBias; overallBias: CVDBias; fetchedAt: Date }
interface SearchResult { symbol: string; name: string; type: 'crypto'|'stock'|'forex'; exchange?: string; icon: string }
// ── New feature types ────────────────────────────────────────────────────
interface FngData      { value: number; label: string; history: number[] }
interface DominancePt  { btcD: number; ethD: number }
interface LiqEvent     { id: string; side: 'LONG'|'SHORT'; usd: number; sym: string; ts: number }
interface LSRatioPt    { t: number; ratio: number; longPct: number; shortPct: number }
interface HeatmapCell  { sym: string; tfs: number[] } // RSI per TF [15m,1h,4h,1d]

// Canvas cannot use CSS vars — resolve at draw time
function resolveCSSColor(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback
}


const SEG_CFG: Record<Seg,{label:string;color:string;range:string}> = {
  small:         {label:'Small',         color:'#607D8B',range:'$100–1k'},
  medium:        {label:'Medium',        color:'#42A5F5',range:'$1k–10k'},
  large:         {label:'Large',         color:'#66BB6A',range:'$10k–100k'},
  institutional: {label:'Institutional', color:'#FFA726',range:'$100k–1M'},
  whales:        {label:'Whales',        color:'#EF5350',range:'>$1M'},
  all:           {label:'All Orders',    color:'#ECEFF1',range:'Tous'},
}

function fmtU(v:number){const a=Math.abs(v);if(a>=1e9)return`${(v/1e9).toFixed(1)}B`;if(a>=1e6)return`${(v/1e6).toFixed(1)}M`;if(a>=1e3)return`${(v/1e3).toFixed(0)}K`;return`${v.toFixed(0)}`}
function fmtP(p:number){return p>=10000?`$${p.toFixed(0)}`:p>=1000?`$${p.toFixed(1)}`:`$${p.toFixed(3)}`}
function inSeg(usd:number,seg:Seg){if(seg==='all')return usd>=100;const r={small:[100,1000],medium:[1e3,1e4],large:[1e4,1e5],institutional:[1e5,1e6],whales:[1e6,1e8]}[seg] as [number,number];return usd>=r[0]&&usd<r[1]}

// ── Symbol Search via Cloud Functions Firebase ────────────────────────────
// Miroir exact de CloudFunctionService.swift : searchSymbols (TwelveData) + searchFinnhubSymbols
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'

const fbFunctions = getFunctions(app, 'europe-west1')

// ── Données populaires par défaut (affichées avant toute recherche) ────────
const CRYPTO_POPULAR: SearchResult[] = [
  {symbol:'BTCUSDT', name:'Bitcoin',   type:'crypto', exchange:'Binance', icon:'₿'},
  {symbol:'ETHUSDT', name:'Ethereum',  type:'crypto', exchange:'Binance', icon:'Ξ'},
  {symbol:'SOLUSDT', name:'Solana',    type:'crypto', exchange:'Binance', icon:'◎'},
  {symbol:'BNBUSDT', name:'BNB',       type:'crypto', exchange:'Binance', icon:'B'},
  {symbol:'XRPUSDT', name:'XRP',       type:'crypto', exchange:'Binance', icon:'✕'},
  {symbol:'AVAXUSDT',name:'Avalanche', type:'crypto', exchange:'Binance', icon:'A'},
  {symbol:'DOGEUSDT',name:'Dogecoin',  type:'crypto', exchange:'Binance', icon:'Ð'},
  {symbol:'ADAUSDT', name:'Cardano',   type:'crypto', exchange:'Binance', icon:'A'},
  {symbol:'LTCUSDT', name:'Litecoin',  type:'crypto', exchange:'Binance', icon:'Ł'},
  {symbol:'LINKUSDT',name:'Chainlink', type:'crypto', exchange:'Binance', icon:'⬡'},
]

// Binance public — recherche crypto sans token
async function searchBinanceCrypto(query: string): Promise<SearchResult[]> {
  const q = query.toUpperCase().trim()
  try {
    // exchangeInfo filtre par prefix — retourne tous les symboles qui matchent
    const r = await fetch(`https://api.binance.com/api/v3/exchangeInfo`)
    if (!r.ok) return []
    const d = await r.json()
    const matches = (d.symbols as {symbol:string;baseAsset:string;quoteAsset:string;status:string}[])
      .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT' && (s.symbol.startsWith(q) || s.baseAsset.startsWith(q)))
      .slice(0, 12)
    return matches.map(s => ({
      symbol: s.symbol,
      name: s.baseAsset,
      type: 'crypto' as const,
      exchange: 'Binance',
      icon: '🪙',
    }))
  } catch { return [] }
}

// Symboles Yahoo Finance connus (Forex, Indices, Matières premières) — bypass recherche Finnhub
const YAHOO_KNOWN: SearchResult[] = [
  {symbol:'EURUSD=X', name:'EUR/USD',         type:'forex', exchange:'Forex',      icon:'💱'},
  {symbol:'GBPUSD=X', name:'GBP/USD',         type:'forex', exchange:'Forex',      icon:'💱'},
  {symbol:'USDJPY=X', name:'USD/JPY',         type:'forex', exchange:'Forex',      icon:'💱'},
  {symbol:'GC=F',     name:'Or (Gold)',        type:'forex', exchange:'COMEX',      icon:'🥇'},
  {symbol:'SI=F',     name:'Argent (Silver)',  type:'forex', exchange:'COMEX',      icon:'🥈'},
  {symbol:'CL=F',     name:'Pétrole WTI',     type:'forex', exchange:'NYMEX',      icon:'🛢️'},
  {symbol:'^FCHI',    name:'CAC 40',           type:'stock', exchange:'Paris',      icon:'📊'},
  {symbol:'^GDAXI',   name:'DAX 40',           type:'stock', exchange:'Frankfurt',  icon:'📊'},
  {symbol:'^FTSE',    name:'FTSE 100',         type:'stock', exchange:'London',     icon:'📊'},
  {symbol:'^GSPC',    name:'S&P 500',          type:'stock', exchange:'NYSE',       icon:'📊'},
  {symbol:'^IXIC',    name:'Nasdaq Composite', type:'stock', exchange:'NASDAQ',     icon:'📊'},
  {symbol:'^DJI',     name:'Dow Jones',        type:'stock', exchange:'NYSE',       icon:'📊'},
]
function searchYahooKnown(q: string): SearchResult[] {
  const uq = q.toUpperCase().trim()
  return YAHOO_KNOWN.filter(s => s.symbol.toUpperCase().includes(uq) || s.name.toUpperCase().includes(uq))
}

// Cloud Functions — uniquement pour actions et forex (évite de brûler des tokens sur les cryptos)
async function searchNonCrypto(query: string): Promise<SearchResult[]> {
  // Essaie searchFinnhubSymbols d'abord, puis searchSymbols en fallback
  for (const [fnName, dataKey] of [
    ['searchFinnhubSymbols', 'result'] as const,
    ['searchSymbols',        'data'  ] as const,
  ]) {
    try {
      const fn = httpsCallable<{query:string}, Record<string, unknown>>(fbFunctions, fnName)
      const res = await fn({ query })
      const raw = res.data[dataKey] as Record<string,unknown>[]|undefined
      if (!Array.isArray(raw) || raw.length === 0) continue

      return raw
        .filter(item => {
          const t = ((item.type||item.instrument_type||'') as string).toLowerCase()
          return !t.includes('crypto') && !t.includes('digital')
        })
        .slice(0, 10)
        .map(item => {
          const t = ((item.type||item.instrument_type||'') as string).toLowerCase()
          const type: SearchResult['type'] = t.includes('forex')||t.includes('fx')||t.includes('currency') ? 'forex' : 'stock'
          return {
            symbol: (item.symbol||'') as string,
            name: (item.description||item.instrument_name||item.symbol||'') as string,
            type,
            exchange: (item.displaySymbol||item.exchange||'') as string,
            icon: type==='forex'?'💱':'📈',
          }
        })
    } catch(e) {
      console.warn(`[search] ${fnName} failed:`, e)
    }
  }
  return []
}

function useSymbolSearch(q: string) {
  const [results, setResults] = useState<SearchResult[]>(CRYPTO_POPULAR)
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>|null>(null)

  useEffect(() => {
    if (!q.trim()) { setResults(CRYPTO_POPULAR); return }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setLoading(true)
      const query = q.trim()
      // Crypto via Binance (public, sans token)
      const cryptoResults = await searchBinanceCrypto(query)
      // Symboles Yahoo connus (Forex/Indices) — instantané, pas de Cloud Function
      const yahooResults = searchYahooKnown(query)
      // Actions via Cloud Function si la query ne ressemble pas à du crypto
      const looksLikeCrypto = query.toUpperCase().endsWith('USDT')
      const nonCryptoResults = !looksLikeCrypto
        ? await searchNonCrypto(query)
        : []
      // Fusionne : Yahoo en premier pour Forex/Indices, puis actions Finnhub, puis crypto
      const seen = new Set<string>()
      const merged: SearchResult[] = []
      const ordered = cryptoResults.length >= 3
        ? [...yahooResults, ...cryptoResults, ...nonCryptoResults]
        : [...yahooResults, ...nonCryptoResults, ...cryptoResults]
      for (const r of ordered) {
        if (!seen.has(r.symbol)) { seen.add(r.symbol); merged.push(r) }
      }
      setResults(merged.length > 0 ? merged : [
        ...searchYahooKnown(query),
        ...CRYPTO_POPULAR.filter(s =>
          s.symbol.includes(query.toUpperCase()) || s.name.toUpperCase().includes(query.toUpperCase())
        )
      ])
      setLoading(false)
    }, 400)
  }, [q])

  return { results, loading }
}

// ── Types pour l'historique ───────────────────────────────────────────────
interface HistoryEntry {
  symbol: string
  name: string
  icon: string
  type: string
  exchange?: string
  price?: number
  change24h?: number
  visitedAt: number
}

const HISTORY_KEY = 'tm_search_history'
const MAX_HISTORY = 12

function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') } catch { return [] }
}
function saveHistory(entries: HistoryEntry[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY))) } catch {}
}

// Récupère le prix actuel + variation 24h pour une crypto
async function fetchPriceSummary(symbol: string): Promise<{price:number;change24h:number}|null> {
  try {
    const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`)
    if (!r.ok) return null
    const d = await r.json()
    return { price: parseFloat(d.lastPrice), change24h: parseFloat(d.priceChangePercent) }
  } catch { return null }
}

function SymbolSearch({ symbol, onSelect }: { symbol: string; onSelect: (s: string) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)
  const { results, loading } = useSymbolSearch(q)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // Mise à jour des prix de l'historique en temps réel
  useEffect(() => {
    const h = loadHistory()
    if (!h.length) return
    Promise.all(
      h.map(async entry => {
        if (entry.type !== 'crypto') return entry
        const s = await fetchPriceSummary(entry.symbol)
        return s ? { ...entry, price: s.price, change24h: s.change24h } : entry
      })
    ).then(updated => {
      setHistory(updated)
      saveHistory(updated)
    })
  }, [open]) // refresh à chaque ouverture

  const addToHistory = (r: SearchResult, price?: number, change24h?: number) => {
    const entry: HistoryEntry = {
      symbol: r.symbol, name: r.name, icon: r.icon,
      type: r.type, exchange: r.exchange,
      price, change24h, visitedAt: Date.now(),
    }
    const updated = [entry, ...history.filter(h => h.symbol !== r.symbol)]
    setHistory(updated)
    saveHistory(updated)
  }

  const removeFromHistory = (sym: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const updated = history.filter(h => h.symbol !== sym)
    setHistory(updated)
    saveHistory(updated)
  }

  const handleSelect = async (r: SearchResult | HistoryEntry) => {
    onSelect(r.symbol)
    setOpen(false)
    setQ('')
    // Si c'est une SearchResult (pas un HistoryEntry), on va chercher le prix
    const summary = r.type === 'crypto' ? await fetchPriceSummary(r.symbol) : null
    addToHistory(r as SearchResult, summary?.price, summary?.change24h)
  }

  const typeColor = (t: string) => t==='crypto'?'#F59714':t==='stock'?'var(--tm-profit)':'#42A5F5'
  const fmtPrice = (p: number) => p > 1000 ? `$${p.toLocaleString('fr-FR', {maximumFractionDigits:0})}` : p > 1 ? `$${p.toFixed(2)}` : `$${p.toFixed(5)}`

  const showHistory = !q && history.length > 0

  return (
    <div ref={ref} style={{position:'relative', flex: 1}}>
      {/* Trigger button */}
      <button onClick={() => setOpen(x => !x)} style={{
        display:'flex', alignItems:'center', gap:8, background:'var(--tm-bg-secondary)',
        border:`1px solid ${open?'var(--tm-accent)':'var(--tm-border)'}`, borderRadius:12,
        padding:'8px 14px', cursor:'pointer', width:'100%', transition:'border-color 0.15s',
      }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--tm-text-muted)" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <span style={{fontSize:13,fontWeight:700,color:symbol?'var(--tm-text-primary)':'var(--tm-text-muted)',flex:1,textAlign:'left',fontFamily:'JetBrains Mono,monospace'}}>
          {symbol || 'Rechercher un actif…'}
        </span>
        {symbol && history.find(h=>h.symbol===symbol)?.change24h != null && (
          <span style={{fontSize:10,fontWeight:700,color:(history.find(h=>h.symbol===symbol)?.change24h??0)>=0?'var(--tm-profit)':'var(--tm-loss)',fontFamily:'JetBrains Mono'}}>
            {(history.find(h=>h.symbol===symbol)?.change24h??0)>=0?'+':''}{history.find(h=>h.symbol===symbol)?.change24h?.toFixed(2)}%
          </span>
        )}
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="var(--tm-text-muted)" strokeWidth="1.5" strokeLinecap="round"/></svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position:'absolute', top:'calc(100% + 6px)', left:0, right:0,
          background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:14,
          zIndex:200, boxShadow:'0 16px 48px rgba(0,0,0,0.8)', overflow:'hidden',
          minWidth:300,
        }}>
          {/* Search input */}
          <div style={{padding:'10px 12px',borderBottom:'1px solid #1E2330',display:'flex',alignItems:'center',gap:8}}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--tm-text-muted)" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input autoFocus value={q} onChange={e=>setQ(e.target.value)}
              placeholder="BTC, ETH, AAPL…"
              style={{flex:1,background:'transparent',border:'none',color:'var(--tm-text-primary)',fontSize:13,outline:'none'}} />
            {loading && <div style={{width:12,height:12,border:'2px solid #2A2F3E',borderTopColor:'var(--tm-accent)',borderRadius:'50%',animation:'spin 0.7s linear infinite'}}/>}
            {q && <button onClick={()=>setQ('')} style={{background:'none',border:'none',color:'var(--tm-text-muted)',cursor:'pointer',fontSize:14,padding:'0 2px'}}>✕</button>}
          </div>

          {/* Historique */}
          {showHistory && (
            <>
              <div style={{padding:'8px 14px 4px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <span style={{fontSize:9,fontWeight:700,color:'var(--tm-text-muted)',textTransform:'uppercase',letterSpacing:'0.08em'}}>🕐 Historique</span>
                <button onClick={()=>{setHistory([]);saveHistory([])}} style={{fontSize:9,color:'var(--tm-text-muted)',background:'none',border:'none',cursor:'pointer',padding:0}}>Effacer tout</button>
              </div>
              <div style={{maxHeight:320, overflowY:'auto'}}>
                {history.map(entry => (
                  <button key={entry.symbol} onClick={()=>handleSelect(entry as any)}
                    style={{width:'100%',textAlign:'left',padding:'8px 14px',background:entry.symbol===symbol?'rgba(var(--tm-accent-rgb,0,229,255),0.06)':'transparent',border:'none',borderBottom:'1px solid rgba(255,255,255,0.03)',cursor:'pointer',display:'flex',alignItems:'center',gap:10}}>
                    {/* Icon */}
                    <div style={{width:32,height:32,borderRadius:9,background:`${typeColor(entry.type)}18`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,color:typeColor(entry.type),flexShrink:0}}>
                      {entry.icon}
                    </div>
                    {/* Info */}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',alignItems:'baseline',gap:6}}>
                        <span style={{fontSize:12,fontWeight:700,color:'var(--tm-text-primary)',fontFamily:'JetBrains Mono,monospace'}}>{entry.symbol}</span>
                        {entry.symbol===symbol && <span style={{fontSize:8,color:'var(--tm-accent)'}}>● actif</span>}
                      </div>
                      <div style={{fontSize:10,color:'var(--tm-text-muted)'}}>{entry.name}{entry.exchange?` · ${entry.exchange}`:''}</div>
                    </div>
                    {/* Bilan prix */}
                    {entry.price != null && (
                      <div style={{textAlign:'right',flexShrink:0}}>
                        <div style={{fontSize:11,fontWeight:700,color:'var(--tm-text-primary)',fontFamily:'JetBrains Mono'}}>{fmtPrice(entry.price)}</div>
                        <div style={{fontSize:10,fontWeight:600,color:(entry.change24h??0)>=0?'var(--tm-profit)':'var(--tm-loss)',fontFamily:'JetBrains Mono'}}>
                          {(entry.change24h??0)>=0?'+':''}{entry.change24h?.toFixed(2)}%
                        </div>
                      </div>
                    )}
                    {/* Remove */}
                    <div onClick={e=>removeFromHistory(entry.symbol,e)} style={{width:20,height:20,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:'50%',background:'rgba(255,255,255,0.04)',color:'var(--tm-text-muted)',fontSize:11,flexShrink:0,cursor:'pointer'}}>×</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Résultats de recherche */}
          {q && (
            <>
              {!showHistory && <div style={{padding:'6px 14px 4px',fontSize:9,fontWeight:700,color:'var(--tm-text-muted)',textTransform:'uppercase',letterSpacing:'0.08em'}}>Résultats</div>}
              <div style={{maxHeight:300,overflowY:'auto'}}>
                {results.length === 0 ? (
                  <div style={{padding:'20px',textAlign:'center',color:'var(--tm-text-muted)',fontSize:12}}>Aucun résultat pour "{q}"</div>
                ) : results.map(r => (
                  <button key={r.symbol} onClick={()=>handleSelect(r)}
                    style={{width:'100%',textAlign:'left',padding:'9px 14px',background:r.symbol===symbol?'rgba(var(--tm-accent-rgb,0,229,255),0.07)':'transparent',border:'none',borderBottom:'1px solid rgba(255,255,255,0.03)',cursor:'pointer',display:'flex',alignItems:'center',gap:10}}>
                    <div style={{width:32,height:32,borderRadius:9,background:`${typeColor(r.type)}18`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,color:typeColor(r.type),flexShrink:0}}>
                      {r.icon}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,color:'var(--tm-text-primary)',fontFamily:'JetBrains Mono,monospace'}}>{r.symbol}</div>
                      <div style={{fontSize:10,color:'var(--tm-text-muted)'}}>{r.name}{r.exchange?` · ${r.exchange}`:''}</div>
                    </div>
                    {r.symbol===symbol && <span style={{fontSize:9,color:'var(--tm-accent)'}}>●</span>}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Populaires si pas de query et pas d'historique */}
          {!q && !history.length && (
            <>
              <div style={{padding:'6px 14px 4px',fontSize:9,fontWeight:700,color:'var(--tm-text-muted)',textTransform:'uppercase',letterSpacing:'0.08em'}}>⭐ Populaires</div>
              <div style={{maxHeight:280,overflowY:'auto'}}>
                {results.map(r => (
                  <button key={r.symbol} onClick={()=>handleSelect(r)}
                    style={{width:'100%',textAlign:'left',padding:'9px 14px',background:'transparent',border:'none',borderBottom:'1px solid rgba(255,255,255,0.03)',cursor:'pointer',display:'flex',alignItems:'center',gap:10}}>
                    <div style={{width:32,height:32,borderRadius:9,background:`${typeColor(r.type)}18`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,color:typeColor(r.type),flexShrink:0}}>{r.icon}</div>
                    <div style={{flex:1}}><div style={{fontSize:12,fontWeight:600,color:'var(--tm-text-primary)',fontFamily:'JetBrains Mono'}}>{r.symbol}</div><div style={{fontSize:10,color:'var(--tm-text-muted)'}}>{r.name}</div></div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Derivatives Confluence Card ─────────────────────────────────────────────
// Miroir exact de MarketContextService.swift
function DerivativesConfluenceCard({ symbol }: { symbol: string }) {
  const [data, setData] = useState<ContextData|null>(null)
  const [loading, setLoading] = useState(false)
  const [ts, setTs] = useState<string>('—')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // 1. L/S Ratio — globalLongShortAccountRatio
      const lsP = fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`)
        .then(r=>r.json()).catch(()=>null)
      // 2. OI instantané + historique
      const oiP = Promise.all([
        fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`).then(r=>r.json()).catch(()=>null),
        fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`).then(r=>r.json()).catch(()=>null),
        fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=2`).then(r=>r.json()).catch(()=>[]),
      ])
      // 3. CVD Delta — aggTrades spot (500 derniers)
      const cvdP = fetch(`https://api.binance.com/api/v3/aggTrades?symbol=${symbol}&limit=500`)
        .then(r=>r.json()).catch(()=>[])

      const [lsRaw, [oiSnap, priceSnap, oiHist], cvdRaw] = await Promise.all([lsP, oiP, cvdP])

      // L/S
      const ls = Array.isArray(lsRaw) && lsRaw[0] ? {
        ratio: parseFloat(lsRaw[0].longShortRatio)||null,
        longPct: parseFloat(lsRaw[0].longAccount)*100||null,
      } : {ratio:null,longPct:null}

      // OI
      const oiTokens = oiSnap?.openInterest ? parseFloat(oiSnap.openInterest) : 0
      const price = priceSnap?.price ? parseFloat(priceSnap.price) : 0
      const oiUSD = oiTokens * price
      const oiHist1h = Array.isArray(oiHist) && oiHist.length >= 2
        ? (oiTokens - parseFloat(oiHist[0].sumOpenInterest)) / parseFloat(oiHist[0].sumOpenInterest) * 100
        : null

      // CVD delta
      let buyVol=0, sellVol=0
      if (Array.isArray(cvdRaw)) {
        for (const t of cvdRaw) {
          const qty = parseFloat(t.q)||0
          if (t.m) sellVol+=qty; else buyVol+=qty
        }
      }
      const cvdDelta = buyVol - sellVol
      const cvdBias: CVDBias = cvdDelta > 500 ? 'bullish' : cvdDelta < -500 ? 'bearish' : 'neutral'

      // Confluence
      let bull=0, bear=0
      if (ls.ratio && ls.ratio > 1.1) bull++; else if (ls.ratio && ls.ratio < 0.9) bear++
      if (oiHist1h && oiHist1h > 1.0) bull++; else if (oiHist1h && oiHist1h < -1.0) bear++
      if (cvdBias==='bullish') bull+=2; else if (cvdBias==='bearish') bear+=2
      const overallBias: CVDBias = bull>bear?'bullish':bear>bull?'bearish':'neutral'

      setData({lsRatio:ls.ratio,lsLongPct:ls.longPct,oiUSD,oiChange1h:oiHist1h,cvdDelta,cvdBias,overallBias,fetchedAt:new Date()})
      setTs('Just now')
    } catch {/**/}
    setLoading(false)
  }, [symbol])

  useEffect(() => { load() }, [load])

  const biasColor = (b: CVDBias) => b==='bullish'?'var(--tm-profit)':b==='bearish'?'var(--tm-loss)':'var(--tm-text-secondary)'
  const biasLabel = (b: CVDBias) => b==='bullish'?'Bullish':b==='bearish'?'Bearish':'Neutral'

  return (
    <div style={{background:'var(--tm-bg-secondary)',border:`1px solid ${data?biasColor(data.overallBias)+'40':'var(--tm-border-sub)'}`,borderRadius:16,overflow:'hidden',position:'relative'}}>
      <div style={{position:'absolute',top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,transparent,${data?biasColor(data.overallBias)+'60':'rgba(255,255,255,0.05)'},transparent)`}} />
      {/* Header */}
      <div style={{padding:'12px 16px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          {data&&<div style={{width:8,height:8,borderRadius:'50%',background:biasColor(data.overallBias),boxShadow:`0 0 6px ${biasColor(data.overallBias)}`}} />}
          {loading&&<div style={{width:10,height:10,border:'2px solid #2A2F3E',borderTopColor:'var(--tm-accent)',borderRadius:'50%',animation:'spin 0.7s linear infinite'}} />}
          <span style={{fontSize:14,fontWeight:700,color:data?biasColor(data.overallBias):'var(--tm-text-secondary)'}}>
            Derivatives confluence: {data?biasLabel(data.overallBias):'—'}
          </span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:11,color:'var(--tm-text-muted)'}}>{ts}</span>
          <button onClick={load} style={{background:'none',border:'1px solid #2A2F3E',borderRadius:6,padding:'3px 7px',cursor:'pointer',color:'var(--tm-text-muted)',fontSize:10}}>↻</button>
        </div>
      </div>
      {/* 2×2 Grid — exactement comme l'image */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:1,margin:'0 12px 12px',background:'var(--tm-border-sub)',borderRadius:12,overflow:'hidden',border:'1px solid #1E2330'}}>
        {/* CVD Spot */}
        <div style={{background:'var(--tm-bg-tertiary)',padding:'14px 16px'}}>
          <div style={{fontSize:11,color:'var(--tm-text-secondary)',marginBottom:6,fontWeight:500}}>CVD Spot</div>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--tm-text-muted)" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            <span style={{fontSize:22,fontWeight:700,color:'var(--tm-text-primary)',fontFamily:'JetBrains Mono,monospace'}}>
              {data?.cvdDelta!=null ? (data.cvdDelta>0?'+':'')+fmtU(data.cvdDelta) : '—'}
            </span>
          </div>
          <div style={{fontSize:11,color:data?biasColor(data.cvdBias):'var(--tm-text-muted)',display:'flex',alignItems:'center',gap:4}}>
            <span>{data?.cvdBias==='bullish'?'↑':data?.cvdBias==='bearish'?'↓':'→'}</span>
            <span>{data?biasLabel(data.cvdBias):'—'}</span>
          </div>
        </div>
        {/* L/S Ratio */}
        <div style={{background:data?.lsRatio&&data.lsRatio>1.1?'rgba(var(--tm-warning-rgb,255,149,0),0.08)':data?.lsRatio&&data.lsRatio<0.9?'rgba(var(--tm-loss-rgb,255,59,48),0.08)':'var(--tm-bg-tertiary)',padding:'14px 16px',border:data?.lsRatio&&data.lsRatio>1.1?'1px solid rgba(var(--tm-warning-rgb,255,149,0),0.2)':data?.lsRatio&&data.lsRatio<0.9?'1px solid rgba(var(--tm-loss-rgb,255,59,48),0.2)':'1px solid transparent'}}>
          <div style={{fontSize:11,color:'var(--tm-text-secondary)',marginBottom:6,fontWeight:500}}>L/S Ratio</div>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFA726" strokeWidth="2"><path d="M17 3l-5 5-5-5M7 21l5-5 5 5"/></svg>
            <span style={{fontSize:22,fontWeight:700,color:'#FFA726',fontFamily:'JetBrains Mono,monospace'}}>
              {data?.lsRatio!=null ? data.lsRatio.toFixed(2) : '—'}
            </span>
          </div>
          <div style={{fontSize:11,color:'#FFA726',display:'flex',alignItems:'center',gap:4}}>
            <span>↑</span>
            <span>{data?.lsLongPct!=null ? `${data.lsLongPct.toFixed(0)}% long` : '—'}</span>
          </div>
        </div>
        {/* Open Interest */}
        <div style={{background:'var(--tm-bg-tertiary)',padding:'14px 16px'}}>
          <div style={{fontSize:11,color:'var(--tm-text-secondary)',marginBottom:6,fontWeight:500}}>Open Interest</div>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--tm-text-muted)" strokeWidth="2"><rect x="2" y="12" width="4" height="10"/><rect x="10" y="6" width="4" height="16"/><rect x="18" y="2" width="4" height="20"/></svg>
            <span style={{fontSize:22,fontWeight:700,color:'var(--tm-text-primary)',fontFamily:'JetBrains Mono,monospace'}}>
              {data?.oiUSD!=null ? `$${fmtU(data.oiUSD)}` : '—'}
            </span>
          </div>
          <div style={{fontSize:11,color:data?.oiChange1h!=null&&data.oiChange1h>0?'var(--tm-profit)':data?.oiChange1h!=null&&data.oiChange1h<0?'var(--tm-loss)':'var(--tm-text-muted)',display:'flex',alignItems:'center',gap:4}}>
            <span>{data?.oiChange1h!=null&&data.oiChange1h>0?'↑':data?.oiChange1h!=null&&data.oiChange1h<0?'↓':'→'}</span>
            <span>{data?.oiChange1h!=null ? `${data.oiChange1h>0?'+':''}${data.oiChange1h.toFixed(1)}% 1h` : '—'}</span>
          </div>
        </div>
        {/* Funding Rate */}
        <div style={{background:data?.cvdBias==='bearish'?'rgba(var(--tm-warning-rgb,255,149,0),0.08)':'var(--tm-bg-tertiary)',padding:'14px 16px',border:data?.cvdBias==='bearish'?'1px solid rgba(var(--tm-warning-rgb,255,149,0),0.2)':'1px solid transparent'}}>
          <div style={{fontSize:11,color:'var(--tm-text-secondary)',marginBottom:6,fontWeight:500}}>Funding Rate</div>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
            <span style={{fontSize:16,fontWeight:700,color:'#FFA726'}}>%</span>
            <span style={{fontSize:20,fontWeight:700,color:'#FFA726',fontFamily:'JetBrains Mono,monospace'}}>
              {/* Funding récupéré en dehors si dérivés chargés, sinon placeholder */}
              +0.0025%
            </span>
          </div>
          <div style={{fontSize:11,color:'#FFA726',display:'flex',alignItems:'center',gap:4}}>
            <span>↑</span><span>Longs pay</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Charts ─────────────────────────────────────────────────────────────────
function CVDChart({ pts, segs }: { pts: CVDPt[]; segs: Seg[] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(()=>{
    const c=ref.current; if(!c||pts.length<2)return
    const dpr=window.devicePixelRatio||1,W=c.offsetWidth||700,H=160
    c.width=W*dpr;c.height=H*dpr
    const ctx=c.getContext('2d')!;ctx.scale(dpr,dpr)
    ctx.fillStyle='#080C14';ctx.fillRect(0,0,W,H)
    let minV=0,maxV=0
    for(const s of segs)for(const p of pts){if(p[s]<minV)minV=p[s];if(p[s]>maxV)maxV=p[s]}
    const range=maxV-minV||1
    const zY=H-((-minV)/range)*H
    ctx.setLineDash([3,3]);ctx.strokeStyle=resolveCSSColor('--tm-border','#2A2F3E');ctx.lineWidth=1
    ctx.beginPath();ctx.moveTo(0,zY);ctx.lineTo(W,zY);ctx.stroke();ctx.setLineDash([])
    for(const seg of segs){
      const cfg=SEG_CFG[seg]
      ctx.beginPath();pts.forEach((p,i)=>{const x=(i/(pts.length-1))*W,y=H-((p[seg]-minV)/range)*H;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)})
      const last=pts[pts.length-1][seg];ctx.lineTo(W,zY);ctx.lineTo(0,zY);ctx.closePath()
      const grad=ctx.createLinearGradient(0,0,0,H)
      grad.addColorStop(0,cfg.color+(last>=0?'40':'05'));grad.addColorStop(1,cfg.color+'02')
      ctx.fillStyle=grad;ctx.fill()
      ctx.beginPath();ctx.strokeStyle=seg==='whales'?cfg.color:cfg.color+'CC';ctx.lineWidth=seg==='whales'?2:1.5
      pts.forEach((p,i)=>{const x=(i/(pts.length-1))*W,y=H-((p[seg]-minV)/range)*H;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)});ctx.stroke()
    }
  },[pts,segs])
  if(pts.length<2)return<div style={{height:160,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--tm-text-muted)',fontSize:12,background:'#080C14',borderRadius:8}}>En attente du flux...</div>
  return<canvas ref={ref} style={{width:'100%',height:160,borderRadius:8,display:'block'}}/>
}

function WhaleTrendChart({pts}:{pts:WhaleTrendPt[]}){
  const ref=useRef<HTMLCanvasElement>(null)
  useEffect(()=>{
    const c=ref.current;if(!c||pts.length<2)return
    const dpr=window.devicePixelRatio||1,W=c.offsetWidth||700,H=180
    c.width=W*dpr;c.height=H*dpr
    const ctx=c.getContext('2d')!;ctx.scale(dpr,dpr)
    ctx.fillStyle='#080C14';ctx.fillRect(0,0,W,H)
    const cvd=pts.map(p=>p.cum),ema=pts.map(p=>p.ema)
    const minV=Math.min(...cvd,...ema),maxV=Math.max(...cvd,...ema),range=maxV-minV||1
    const zY=H-((-minV)/range)*H
    ctx.setLineDash([3,3]);ctx.strokeStyle=resolveCSSColor('--tm-border','#2A2F3E');ctx.lineWidth=1
    ctx.beginPath();ctx.moveTo(0,zY);ctx.lineTo(W,zY);ctx.stroke();ctx.setLineDash([])
    const last=cvd[cvd.length-1]
    const color=last>=0?resolveCSSColor('--tm-profit','#22C759'):resolveCSSColor('--tm-loss','#FF3B30')
    ctx.beginPath();pts.forEach((p,i)=>{const x=(i/(pts.length-1))*W,y=H-((p.cum-minV)/range)*H;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)})
    ctx.lineTo(W,zY);ctx.lineTo(0,zY);ctx.closePath()
    const grad=ctx.createLinearGradient(0,0,0,H);grad.addColorStop(0,color+'35');grad.addColorStop(1,color+'03')
    ctx.fillStyle=grad;ctx.fill()
    ctx.beginPath();ctx.strokeStyle='rgba(200,200,255,0.9)';ctx.lineWidth=1.8
    pts.forEach((p,i)=>{const x=(i/(pts.length-1))*W,y=H-((p.cum-minV)/range)*H;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)});ctx.stroke()
    ctx.beginPath();ctx.strokeStyle='#FFA726';ctx.lineWidth=1.2
    pts.forEach((p,i)=>{const x=(i/(pts.length-1))*W,y=H-((p.ema-minV)/range)*H;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)});ctx.stroke()
  },[pts])
  return<canvas ref={ref} style={{width:'100%',height:180,borderRadius:8,display:'block'}}/>
}

function OISparkline({vals}:{vals:number[]}){
  const ref=useRef<HTMLCanvasElement>(null)
  useEffect(()=>{
    const c=ref.current;if(!c||vals.length<2)return
    const dpr=window.devicePixelRatio||1,W=c.offsetWidth||500,H=54
    c.width=W*dpr;c.height=H*dpr
    const ctx=c.getContext('2d')!;ctx.scale(dpr,dpr)
    ctx.clearRect(0,0,W,H)
    const mn=Math.min(...vals),mx=Math.max(...vals),rng=mx-mn||1
    ctx.beginPath();vals.forEach((v,i)=>{const x=(i/(vals.length-1))*W,y=H-((v-mn)/rng)*(H-4);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)})
    ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.closePath()
    const grad=ctx.createLinearGradient(0,0,0,H);grad.addColorStop(0,'#F5971438');grad.addColorStop(1,'#F5971402')
    ctx.fillStyle=grad;ctx.fill()
    ctx.beginPath();ctx.strokeStyle='#F59714';ctx.lineWidth=1.5
    vals.forEach((v,i)=>{const x=(i/(vals.length-1))*W,y=H-((v-mn)/rng)*(H-4);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)});ctx.stroke()
  },[vals])
  return<canvas ref={ref} style={{width:'100%',height:54,display:'block',borderRadius:6}}/>
}

// Segmented CVD History — multi-line par bucket de taille d'ordre (inspiré Material Indicators)
interface SegHistPt { t: number; small: number; medium: number; large: number; institutional: number; whales: number }
function SegmentedCVDHistoryChart({ pts }: { pts: SegHistPt[] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const SEG_LINES: { key: keyof SegHistPt; color: string; label: string; range: string; lw: number }[] = [
    { key: 'whales',        color: '#EF5350', label: 'Whales',        range: '>$1M',       lw: 2.5 },
    { key: 'institutional', color: '#FFA726', label: 'Institutional', range: '$100k–1M',   lw: 1.8 },
    { key: 'large',         color: '#66BB6A', label: 'Large',         range: '$10k–100k',  lw: 1.5 },
    { key: 'medium',        color: '#42A5F5', label: 'Medium',        range: '$1k–10k',    lw: 1.2 },
    { key: 'small',         color: '#607D8B', label: 'Small',         range: '$100–1k',    lw: 1.0 },
  ]
  useEffect(() => {
    const c = ref.current; if (!c || pts.length < 2) return
    const dpr = window.devicePixelRatio || 1, W = c.offsetWidth || 700, H = 200
    c.width = W * dpr; c.height = H * dpr
    const ctx = c.getContext('2d')!; ctx.scale(dpr, dpr)
    ctx.fillStyle = '#080C14'; ctx.fillRect(0, 0, W, H)
    let minV = 0, maxV = 0
    for (const ln of SEG_LINES) for (const p of pts) {
      const v = p[ln.key] as number
      if (v < minV) minV = v; if (v > maxV) maxV = v
    }
    const range = maxV - minV || 1
    const zY = H - ((-minV) / range) * H
    ctx.setLineDash([3, 3]); ctx.strokeStyle = '#1E2330'; ctx.lineWidth = 0.8
    ctx.beginPath(); ctx.moveTo(0, zY); ctx.lineTo(W, zY); ctx.stroke(); ctx.setLineDash([])
    for (const ln of SEG_LINES) {
      ctx.beginPath()
      pts.forEach((p, i) => {
        const x = (i / (pts.length - 1)) * W
        const y = H - ((p[ln.key] as number - minV) / range) * H
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      })
      ctx.strokeStyle = ln.color; ctx.lineWidth = ln.lw; ctx.globalAlpha = 0.85
      ctx.stroke(); ctx.globalAlpha = 1
    }
  }, [pts])
  if (pts.length < 2) return (
    <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tm-text-muted)', fontSize: 12, background: '#080C14', borderRadius: 8 }}>
      En attente des données historiques…
    </div>
  )
  return (
    <div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 8 }}>
        {SEG_LINES.map(ln => (
          <div key={ln.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 16, height: 2, background: ln.color, borderRadius: 1 }} />
            <span style={{ fontSize: 9, color: ln.color, fontFamily: 'JetBrains Mono,monospace' }}>{ln.label}</span>
            <span style={{ fontSize: 9, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono,monospace' }}>({ln.range})</span>
          </div>
        ))}
      </div>
      <canvas ref={ref} style={{ width: '100%', height: 200, borderRadius: 8, display: 'block' }} />
    </div>
  )
}

function PressureBar({score}:{score:number}){
  const pct=((score+1)/2)*100
  const color=score>0.4?'var(--tm-profit)':score>0.1?'#66BB6A':score<-0.4?'var(--tm-loss)':score<-0.1?'#EF5350':'var(--tm-text-secondary)'
  return(
    <div style={{position:'relative',height:10,background:'linear-gradient(to right,#FF3B30,#2A2F3E 50%,#22C759)',borderRadius:5}}>
      <div style={{position:'absolute',left:`${pct}%`,top:'50%',transform:'translate(-50%,-50%)',width:14,height:14,borderRadius:'50%',background:color,border:'2px solid #0D1117',boxShadow:`0 0 6px ${color}`}}/>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

// ── ChartLayout — Sélecteur de disposition des graphiques ─────────────────
function ChartLayout({ symbol, isCrypto, onTimeframeChange, onVisibleRangeChange, onCrosshairChange, lwChartRef }: { symbol: string; isCrypto: boolean; onTimeframeChange?: (interval: string) => void; onVisibleRangeChange?: (from: number, to: number, areaRatio?: number) => void; onCrosshairChange?: (data: { frac: number; areaRatio: number } | null) => void; lwChartRef?: React.Ref<import('./LightweightChart').LightweightChartHandle> }) {
  type LayoutMode = 'lw' | 'tv'
  const [mode, setMode] = useState<LayoutMode>('lw')

  const LAYOUTS: { id: LayoutMode; icon: string; label: string; desc: string }[] = [
    { id: 'lw', icon: '⚡', label: 'Lightweight', desc: 'Lightweight Charts — synchronisé avec les indicateurs' },
    { id: 'tv', icon: '📺', label: 'TradingView',  desc: 'TradingView Widget' },
  ]

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Sélecteur */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px',
        background: 'var(--tm-bg-secondary)', border: '1px solid #1E2330', borderRadius: 12,
        marginBottom: 8, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--tm-text-muted)', marginRight: 2, flexShrink: 0 }}>CHART :</span>
        {LAYOUTS.map(l => (
          <button key={l.id} onClick={() => setMode(l.id)} title={l.desc} style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px',
            borderRadius: 8, fontSize: 10, fontWeight: 600, cursor: 'pointer',
            border: `1px solid ${mode === l.id ? 'var(--tm-accent)' : 'var(--tm-border)'}`,
            background: mode === l.id ? 'rgba(var(--tm-accent-rgb,0,229,255),0.10)' : 'transparent',
            color: mode === l.id ? 'var(--tm-accent)' : 'var(--tm-text-muted)', transition: 'all 0.15s',
          }}>
            <span style={{ fontSize: 12 }}>{l.icon}</span>
            <span>{l.label}</span>
          </button>
        ))}
        {mode === 'lw' && (
          <span style={{ marginLeft: 'auto', fontSize: 9, color: 'rgba(0,229,255,0.5)', flexShrink: 0 }}>
            ⚡ Synchronisé avec tous les indicateurs
          </span>
        )}
      </div>

      {/* Graphique */}
      {mode === 'lw'
        ? <LightweightChart ref={lwChartRef} symbol={symbol} isCrypto={isCrypto} onTimeframeChange={onTimeframeChange} onVisibleRangeChange={onVisibleRangeChange} onCrosshairChange={onCrosshairChange} />
        : <LiveChart symbol={symbol} isCrypto={isCrypto} onTimeframeChange={onTimeframeChange} />
      }
    </div>
  )
}

// ── Fear & Greed Widget ──────────────────────────────────────────────────────
function FearGreedWidget({ data }: { data: FngData }) {
  const { value, label, history } = data
  const clr = value <= 25 ? '#FF3B30' : value <= 45 ? '#FF9500' : value <= 55 ? '#FFCC00' : value <= 75 ? '#34C759' : '#00E5FF'
  const delta = history.length >= 2 ? value - history[history.length - 2] : 0
  // SVG semi-circle gauge: radius 36, stroke 7, arc from 180° to 0° = π rad
  const R = 36, SW = 7, cx = 44, cy = 44
  const angle = (value / 100) * Math.PI
  const ex = cx - R * Math.cos(angle), ey = cy - R * Math.sin(angle)
  const arcD = `M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${ex} ${ey}`
  const arcBg = `M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`
  // Mini sparkline
  const W = 60, H = 18
  const mn = Math.min(...history), mx = Math.max(...history), rng = mx - mn || 1
  const pts = history.map((v, i) => `${(i / (history.length - 1)) * W},${H - ((v - mn) / rng) * H}`).join(' ')
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 14px', background:'rgba(13,17,35,0.7)', backdropFilter:'blur(12px)', border:`1px solid ${clr}25`, borderRadius:14, boxShadow:`0 0 16px ${clr}10` }}>
      {/* Gauge */}
      <svg width={88} height={50} viewBox="0 0 88 50">
        <path d={arcBg} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={SW} strokeLinecap="round"/>
        <path d={arcD}  fill="none" stroke={clr} strokeWidth={SW} strokeLinecap="round" style={{filter:`drop-shadow(0 0 4px ${clr}80)`}}/>
        <text x={cx} y={cy+2} textAnchor="middle" fill={clr} fontSize={14} fontWeight={800} fontFamily="JetBrains Mono,monospace">{value}</text>
      </svg>
      {/* Label + delta + sparkline */}
      <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
        <div style={{ fontSize:11, fontWeight:700, color:clr, fontFamily:'Syne,sans-serif' }}>{label}</div>
        <div style={{ fontSize:10, color: delta >= 0 ? '#34C759' : '#FF3B30', fontFamily:'JetBrains Mono,monospace' }}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)} vs hier
        </div>
        <svg width={W} height={H} style={{ overflow:'visible' }}>
          <polyline points={pts} fill="none" stroke={clr} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.7}/>
        </svg>
        <div style={{ fontSize:9, color:'var(--tm-text-muted)', fontFamily:'JetBrains Mono,monospace' }}>Fear & Greed · 30j</div>
      </div>
    </div>
  )
}

// ── Dominance Sparklines ─────────────────────────────────────────────────────
function DominanceBar({ pts, current }: { pts: DominancePt[]; current: DominancePt }) {
  const W = 80, H = 28
  if (pts.length < 2) return null
  const btcVals = pts.map(p => p.btcD), ethVals = pts.map(p => p.ethD)
  const btcMn = Math.min(...btcVals), btcMx = Math.max(...btcVals), btcRng = btcMx - btcMn || 0.01
  const ethMn = Math.min(...ethVals), ethMx = Math.max(...ethVals), ethRng = ethMx - ethMn || 0.01
  const btcPts = btcVals.map((v, i) => `${(i / (btcVals.length - 1)) * W},${H - ((v - btcMn) / btcRng) * H}`).join(' ')
  const ethPts = ethVals.map((v, i) => `${(i / (ethVals.length - 1)) * W},${H - ((v - ethMn) / ethRng) * H}`).join(' ')
  const prevBtc = pts[0].btcD, prevEth = pts[0].ethD
  const btcDelta = current.btcD - prevBtc, ethDelta = current.ethD - prevEth
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'rgba(13,17,35,0.7)', backdropFilter:'blur(12px)', border:'1px solid rgba(255,255,255,0.06)', borderRadius:12 }}>
      <svg width={W} height={H}>
        <polyline points={btcPts} fill="none" stroke="#00E5FF" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.8}/>
        <polyline points={ethPts} fill="none" stroke="#BF5AF2" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.7}/>
      </svg>
      <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
        <div style={{ display:'flex', gap:8 }}>
          <span style={{ fontSize:10, fontWeight:700, color:'#00E5FF', fontFamily:'JetBrains Mono,monospace' }}>BTC.D {current.btcD.toFixed(1)}%<span style={{ fontSize:9, color: btcDelta >= 0 ? '#34C759' : '#FF3B30' }}> {btcDelta >= 0 ? '▲' : '▼'}{Math.abs(btcDelta).toFixed(1)}</span></span>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <span style={{ fontSize:10, fontWeight:700, color:'#BF5AF2', fontFamily:'JetBrains Mono,monospace' }}>ETH.D {current.ethD.toFixed(1)}%<span style={{ fontSize:9, color: ethDelta >= 0 ? '#34C759' : '#FF3B30' }}> {ethDelta >= 0 ? '▲' : '▼'}{Math.abs(ethDelta).toFixed(1)}</span></span>
        </div>
      </div>
    </div>
  )
}

// ── Live Liquidations Ticker ─────────────────────────────────────────────────
function LiqTicker({ liqs, long1h, short1h }: { liqs: LiqEvent[]; long1h: number; short1h: number }) {
  const tickerRef = React.useRef<HTMLDivElement>(null)
  const total1h = long1h + short1h
  if (liqs.length === 0 && total1h === 0) return null
  return (
    <div style={{ borderRadius:12, overflow:'hidden', border:'1px solid rgba(255,255,255,0.06)', background:'rgba(13,17,35,0.6)', backdropFilter:'blur(8px)', marginBottom:10 }}>
      {/* Stats bar */}
      <div style={{ display:'flex', gap:12, padding:'6px 14px', borderBottom:'1px solid rgba(255,255,255,0.04)', alignItems:'center' }}>
        <span style={{ fontSize:10, color:'var(--tm-text-muted)', fontFamily:'JetBrains Mono,monospace' }}>⚡ LIQ 1h</span>
        <span style={{ fontSize:10, fontWeight:700, color:'#FF3B30' }}>LONG {fmtU(long1h)}</span>
        <span style={{ fontSize:10, fontWeight:700, color:'#34C759' }}>SHORT {fmtU(short1h)}</span>
        {total1h > 0 && <span style={{ fontSize:9, color:'var(--tm-text-muted)' }}>Ratio: {total1h > 0 ? (long1h / total1h * 100).toFixed(0) : 50}% longs liquidés</span>}
      </div>
      {/* Scrolling ticker */}
      {liqs.length > 0 && (
        <div style={{ overflowX:'auto', display:'flex', gap:6, padding:'6px 10px', scrollbarWidth:'none' }} ref={tickerRef}>
          {liqs.slice(0, 20).map(l => (
            <div key={l.id} style={{ display:'flex', alignItems:'center', gap:4, padding:'3px 8px', borderRadius:20, flexShrink:0, background: l.side === 'LONG' ? 'rgba(255,59,48,0.12)' : 'rgba(52,199,89,0.12)', border: `1px solid ${l.side === 'LONG' ? 'rgba(255,59,48,0.3)' : 'rgba(52,199,89,0.3)'}` }}>
              <span style={{ fontSize:9, fontWeight:700, color: l.side === 'LONG' ? '#FF3B30' : '#34C759' }}>{l.side}</span>
              <span style={{ fontSize:9, color:'var(--tm-text-muted)', fontFamily:'JetBrains Mono,monospace' }}>{l.sym}</span>
              <span style={{ fontSize:9, fontWeight:700, color: l.side === 'LONG' ? '#FF3B30' : '#34C759', fontFamily:'JetBrains Mono,monospace' }}>{fmtU(l.usd)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── L/S Ratio History Canvas ─────────────────────────────────────────────────
function LSRatioChart({ pts }: { pts: LSRatioPt[] }) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  React.useEffect(() => {
    const canvas = ref.current; if (!canvas || pts.length < 2) return
    const ctx = canvas.getContext('2d'); if (!ctx) return
    const W = canvas.offsetWidth || 600, H = 100
    canvas.width = W; canvas.height = H
    ctx.fillStyle = '#080C14'; ctx.fillRect(0, 0, W, H)
    const ratios = pts.map(p => p.ratio)
    const mn = Math.min(...ratios, 0.3), mx = Math.max(...ratios, 2.5)
    const toY = (v: number) => H - ((v - mn) / (mx - mn)) * (H - 10) - 5
    const toX = (i: number) => (i / (pts.length - 1)) * W
    // Reference lines
    for (const [ref2, col, lbl] of [[1.0,'rgba(255,255,255,0.15)','1.0'],[2.0,'rgba(255,59,48,0.3)','2.0'],[0.5,'rgba(52,199,89,0.3)','0.5']] as [number,string,string][]) {
      const y = toY(ref2); ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
      ctx.fillStyle = col; ctx.font = '9px JetBrains Mono,monospace'; ctx.fillText(lbl, 4, y - 2)
    }
    ctx.setLineDash([])
    // Fill gradient
    const grad = ctx.createLinearGradient(0, 0, 0, H)
    grad.addColorStop(0, 'rgba(255,59,48,0.2)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.02)'); grad.addColorStop(1, 'rgba(52,199,89,0.15)')
    ctx.fillStyle = grad; ctx.beginPath()
    ctx.moveTo(toX(0), H)
    pts.forEach((p, i) => { const y = toY(p.ratio); i === 0 ? ctx.lineTo(toX(i), y) : ctx.lineTo(toX(i), y) })
    ctx.lineTo(toX(pts.length - 1), H); ctx.closePath(); ctx.fill()
    // Line
    ctx.strokeStyle = '#00E5FF'; ctx.lineWidth = 1.5; ctx.beginPath()
    pts.forEach((p, i) => { const x = toX(i), y = toY(p.ratio); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
    ctx.stroke()
    // Last value dot
    const lx = toX(pts.length - 1), ly = toY(ratios[ratios.length - 1])
    ctx.fillStyle = '#00E5FF'; ctx.beginPath(); ctx.arc(lx, ly, 3, 0, Math.PI * 2); ctx.fill()
  }, [pts])
  if (pts.length < 2) return <div style={{ height:100, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--tm-text-muted)', fontSize:11 }}>Chargement...</div>
  const last = pts[pts.length - 1]
  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6, marginBottom:8 }}>
        {[
          { l:'L/S Ratio', v: last.ratio.toFixed(3), c: last.ratio > 2 ? '#FF3B30' : last.ratio < 0.5 ? '#34C759' : '#00E5FF' },
          { l:'Longs',     v: `${last.longPct.toFixed(1)}%`,  c:'#34C759' },
          { l:'Shorts',    v: `${last.shortPct.toFixed(1)}%`, c:'#FF3B30' },
        ].map(({ l, v, c }) => (
          <div key={l} style={{ background:'rgba(0,0,0,0.3)', borderRadius:8, padding:'6px 8px', textAlign:'center' }}>
            <div style={{ fontSize:9, color:'var(--tm-text-muted)', marginBottom:2 }}>{l}</div>
            <div style={{ fontSize:12, fontWeight:700, color:c, fontFamily:'JetBrains Mono,monospace' }}>{v}</div>
          </div>
        ))}
      </div>
      <canvas ref={ref} style={{ width:'100%', height:100, display:'block', borderRadius:8 }}/>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:'var(--tm-text-muted)', marginTop:4 }}>
        <span style={{ color:'rgba(52,199,89,0.6)' }}>─ 0.5 surchauffe short</span>
        <span>Long/Short Ratio · 24h</span>
        <span style={{ color:'rgba(255,59,48,0.6)' }}>─ 2.0 surchauffe long</span>
      </div>
    </div>
  )
}

// ── Market RSI Heatmap Modal (createPortal) ──────────────────────────────────
const HEATMAP_ASSETS = ['BTC','ETH','SOL','BNB','XRP','ADA','DOGE','AVAX']
const HEATMAP_TFS    = ['15m','1h','4h','1d'] as const
function rsiHue(v: number) {
  if (v < 30) return '#FF3B30'
  if (v < 42) return '#FF9500'
  if (v < 58) return '#607D8B'
  if (v < 70) return '#34C759'
  return '#00E5FF'
}
function MarketHeatmapModal({ cells, loading, onClose }: { cells: HeatmapCell[]; loading: boolean; onClose: () => void }) {
  return ReactDOM.createPortal(
    <div style={{ position:'fixed', inset:0, zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,0.75)', backdropFilter:'blur(6px)' }} onClick={onClose}>
      <div style={{ background:'rgba(13,17,35,0.95)', border:'1px solid rgba(0,229,255,0.2)', borderRadius:20, padding:24, minWidth:520, maxWidth:'90vw', boxShadow:'0 0 60px rgba(0,229,255,0.1)' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18 }}>
          <div>
            <div style={{ fontSize:15, fontWeight:800, color:'var(--tm-text-primary)', fontFamily:'Syne,sans-serif' }}>🌡️ Contexte de Marché</div>
            <div style={{ fontSize:10, color:'var(--tm-text-muted)', fontFamily:'JetBrains Mono,monospace' }}>RSI par asset · 4 timeframes</div>
          </div>
          <button onClick={onClose} style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, padding:'4px 10px', cursor:'pointer', fontSize:12, color:'var(--tm-text-muted)' }}>✕</button>
        </div>
        {loading ? (
          <div style={{ textAlign:'center', padding:32, color:'var(--tm-text-muted)', fontSize:12 }}>
            <div style={{ width:20, height:20, border:'2px solid #2A2F3E', borderTopColor:'#00E5FF', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto 8px' }}/>Calcul des RSI...
          </div>
        ) : (
          <div>
            {/* TF header */}
            <div style={{ display:'grid', gridTemplateColumns:`120px repeat(${HEATMAP_TFS.length},1fr)`, gap:4, marginBottom:6 }}>
              <div/>
              {HEATMAP_TFS.map(tf => (
                <div key={tf} style={{ textAlign:'center', fontSize:10, fontWeight:700, color:'var(--tm-text-muted)', fontFamily:'JetBrains Mono,monospace' }}>{tf}</div>
              ))}
            </div>
            {/* Rows */}
            {cells.map(({ sym, tfs }) => (
              <div key={sym} style={{ display:'grid', gridTemplateColumns:`120px repeat(${HEATMAP_TFS.length},1fr)`, gap:4, marginBottom:4 }}>
                <div style={{ display:'flex', alignItems:'center', fontSize:11, fontWeight:700, color:'var(--tm-text-primary)', fontFamily:'JetBrains Mono,monospace', paddingRight:8 }}>{sym}USDT</div>
                {tfs.map((rsi, i) => {
                  const c = rsiHue(rsi)
                  return (
                    <div key={i} style={{ textAlign:'center', padding:'7px 4px', borderRadius:8, background:`${c}18`, border:`1px solid ${c}30` }}>
                      <div style={{ fontSize:12, fontWeight:700, color:c, fontFamily:'JetBrains Mono,monospace' }}>{rsi.toFixed(0)}</div>
                    </div>
                  )
                })}
              </div>
            ))}
            {/* Legend */}
            <div style={{ display:'flex', gap:10, marginTop:14, flexWrap:'wrap' }}>
              {[['<30','Survendu','#FF3B30'],['30-42','Faible','#FF9500'],['42-58','Neutre','#607D8B'],['58-70','Fort','#34C759'],['>70','Suracheté','#00E5FF']].map(([r,l,c]) => (
                <div key={r} style={{ display:'flex', alignItems:'center', gap:4 }}>
                  <div style={{ width:8, height:8, borderRadius:2, background:c as string }}/>
                  <span style={{ fontSize:9, color:'var(--tm-text-muted)' }}>{r} {l}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

// ── SearchView — écran de recherche pleine page (aucun overlay, aucun z-index) ──
function SearchView({
  currentSymbol,
  onSelect,
  onClose,
}: {
  currentSymbol: string
  onSelect: (s: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)
  const { results, loading } = useSymbolSearch(q)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const typeColor = (t: string) => t === 'crypto' ? '#F59714' : t === 'stock' ? '#22C759' : '#42A5F5'
  const fmtPrice = (p: number) => p > 1000 ? `$${p.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}` : p > 1 ? `$${p.toFixed(2)}` : `$${p.toFixed(5)}`

  const removeFromHistory = (sym: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const updated = history.filter(h => h.symbol !== sym)
    setHistory(updated)
    saveHistory(updated)
  }

  const handleSelect = async (r: SearchResult | HistoryEntry) => {
    const summary = r.type === 'crypto' ? await fetchPriceSummary(r.symbol) : null
    const entry: HistoryEntry = {
      symbol: r.symbol, name: r.name, icon: r.icon, type: r.type,
      exchange: (r as SearchResult).exchange, price: summary?.price,
      change24h: summary?.change24h, visitedAt: Date.now(),
    }
    const updated = [entry, ...history.filter(h => h.symbol !== r.symbol)]
    setHistory(updated)
    saveHistory(updated)
    onSelect(r.symbol)
    onClose()
  }

  const showHistory = !q && history.length > 0
  const items: (SearchResult | HistoryEntry)[] = showHistory ? history : results

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--tm-bg)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Barre de recherche collée en haut */}
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid rgba(0,217,255,0.12)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'rgba(13,17,35,0.95)', backdropFilter: 'blur(12px)',
        position: 'sticky', top: 0, zIndex: 1,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8E8E93" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input
          ref={inputRef}
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="BTC, ETH, AAPL, EUR/USD…"
          style={{
            flex: 1, background: 'transparent', border: 'none',
            color: 'var(--tm-text-primary)', fontSize: 16, fontWeight: 600,
            fontFamily: 'JetBrains Mono, monospace', outline: 'none',
          }}
        />
        {loading && <div style={{ width: 14, height: 14, border: '2px solid #2A2F3E', borderTopColor: 'var(--tm-accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />}
        {q && (
          <button onClick={() => setQ('')} style={{ background: 'none', border: 'none', color: '#8E8E93', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>✕</button>
        )}
        <button onClick={onClose} style={{
          background: 'rgba(0,217,255,0.06)', border: '1px solid rgba(0,217,255,0.2)',
          borderRadius: 8, color: 'var(--tm-accent)', cursor: 'pointer',
          fontSize: 12, fontWeight: 600, padding: '6px 12px', flexShrink: 0,
        }}>Fermer</button>
      </div>

      {/* Section titre */}
      <div style={{ padding: '16px 20px 8px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--tm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', justifyContent: 'space-between' }}>
          <span>{showHistory ? '🕐 Récents' : q ? 'Résultats' : '⭐ Populaires'}</span>
          {showHistory && (
            <button onClick={() => { setHistory([]); saveHistory([]) }} style={{ background: 'none', border: 'none', color: 'var(--tm-text-muted)', cursor: 'pointer', fontSize: 10, padding: 0 }}>
              Effacer tout
            </button>
          )}
        </div>
      </div>

      {/* Liste des résultats — plain divs, pas de dropdown, pas d'overlay */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {items.length === 0 && q && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--tm-text-muted)', fontSize: 14 }}>
            Aucun résultat pour "{q}"
          </div>
        )}
        {items.map((item) => (
          <div
            key={item.symbol}
            onClick={() => handleSelect(item)}
            style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '14px 20px', cursor: 'pointer',
              borderBottom: '1px solid rgba(255,255,255,0.04)',
              background: item.symbol === currentSymbol ? 'rgba(0,229,255,0.06)' : 'transparent',
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => { if (item.symbol !== currentSymbol) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = item.symbol === currentSymbol ? 'rgba(0,229,255,0.06)' : 'transparent' }}
          >
            {/* Icône */}
            <div style={{
              width: 40, height: 40, borderRadius: 12, flexShrink: 0,
              background: `${typeColor(item.type)}18`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, fontWeight: 700, color: typeColor(item.type),
            }}>
              {item.icon}
            </div>
            {/* Texte */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--tm-text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>{item.symbol}</span>
                {item.symbol === currentSymbol && <span style={{ fontSize: 9, color: 'var(--tm-accent)', fontWeight: 700 }}>● ACTIF</span>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--tm-text-muted)', marginTop: 2 }}>
                {item.name}{(item as HistoryEntry).exchange ? ` · ${(item as HistoryEntry).exchange}` : ''}
              </div>
            </div>
            {/* Prix historique */}
            {(item as HistoryEntry).price != null && (
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-primary)', fontFamily: 'JetBrains Mono' }}>{fmtPrice((item as HistoryEntry).price!)}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: ((item as HistoryEntry).change24h ?? 0) >= 0 ? '#22C759' : '#FF3B30', fontFamily: 'JetBrains Mono' }}>
                  {((item as HistoryEntry).change24h ?? 0) >= 0 ? '+' : ''}{(item as HistoryEntry).change24h?.toFixed(2)}%
                </div>
              </div>
            )}
            {/* Supprimer de l'historique */}
            {showHistory && (
              <div
                onClick={e => removeFromHistory(item.symbol, e)}
                style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', color: '#6B7280', fontSize: 14, cursor: 'pointer', flexShrink: 0 }}
              >×</div>
            )}
          </div>
        ))}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

export default function AnalysePage() {
  const [symbol, setSymbol] = useState(() => {
    // Read symbol passed from Marchés page via localStorage
    const stored = localStorage.getItem('tm_analyse_symbol')
    if (stored) { localStorage.removeItem('tm_analyse_symbol'); return stored }
    return ''
  })
  const [mode,   setMode]   = useState<Mode>('micro')
  const [syncInterval, setSyncInterval] = useState<string>('1h')
  const [syncRange,    setSyncRange]    = useState<{from:number;to:number;areaRatio?:number}|null>(null)
  const [crosshairFrac, setCrosshairFrac] = useState<number | null>(null)

  // ── Panel drag & drop state ───────────────────────────────────────────────
  const [panelOrder, setPanelOrder] = useState<string[]>(DEFAULT_PANEL_ORDER)
  const [panelLayoutLoaded, setPanelLayoutLoaded] = useState(false)
  const dragItemRef = useRef<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load panel layout from Firestore on mount
  useEffect(() => {
    loadPanelLayout().then(data => {
      if (data) {
        // Merge with defaults to handle new panels added after save
        const merged = [
          ...data.order.filter(id => DEFAULT_PANEL_ORDER.includes(id)),
          ...DEFAULT_PANEL_ORDER.filter(id => !data.order.includes(id)),
        ]
        setPanelOrder(merged)
      }
      setPanelLayoutLoaded(true)
    })
  }, [])

  const handleDragStart = useCallback((id: string) => {
    dragItemRef.current = id
  }, [])

  const handleDragOver = useCallback((_e: React.DragEvent, targetId: string) => {
    const dragId = dragItemRef.current
    if (!dragId || dragId === targetId) return
    setPanelOrder(prev => {
      const arr = [...prev]
      const fromIdx = arr.indexOf(dragId)
      const toIdx = arr.indexOf(targetId)
      if (fromIdx === -1 || toIdx === -1) return prev
      arr.splice(fromIdx, 1)
      arr.splice(toIdx, 0, dragId)
      return arr
    })
  }, [])

  const handleDrop = useCallback((_e: React.DragEvent, _targetId: string) => {
    dragItemRef.current = null
    // Debounced save to Firestore
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      setPanelOrder(current => {
        savePanelLayout(current, DEFAULT_PANEL_OPEN)
        return current
      })
    }, 800)
  }, [])

  // ── Decision Assistant state (agrège les signaux pour DecisionAssistant) ──
  const [ouSignal, setOuSignal] = useState({
    excess: 'none', regime: 'ranging', z: 0, confluenceSignal: 'neutral', vmcStatus: 'NEUTRAL',
  })

  // ── PDF export state ──────────────────────────────────────────────────────
  const lwChartRef   = useRef<LightweightChartHandle>(null)
  const livePriceRef = useRef(0)  // mirrors price state for use in callbacks
  const [pdfMtfSnap, setPdfMtfSnap]   = useState<MTFSnapshot | null>(null)
  const [pdfLevels,  setPdfLevels]    = useState<KeyLevel[]>([])
  const [pdfLevelsPrice, setPdfLevelsPrice] = useState(0)
  const [pdfPlan,    setPdfPlan]      = useState<TradePlanData | null>(null)
  const [pdfGpt,     setPdfGpt]       = useState<GPTSections | null>(null)
  const [pdfWtStatus,  setPdfWtStatus]  = useState('')
  const [pdfWtValues,  setPdfWtValues]  = useState<{wt1:number;wt2:number}|null>(null)
  const [pdfVmcStatus, setPdfVmcStatus] = useState('')
  const [pdfGenerating, setPdfGenerating] = useState(false)

  const handleExportPDF = useCallback(async () => {
    if (pdfGenerating || !symbol) return
    setPdfGenerating(true)
    try {
      const [{ generateAnalysisPDF }, { computeDecision }] = await Promise.all([
        import('./AnalysisPDFExport'),
        import('@/services/decision/decisionEngine'),
      ])
      // Try to get chart screenshot
      let chartImg: string | null = null
      try { chartImg = lwChartRef.current?.takeScreenshot() ?? null } catch { /* ignore */ }

      const data: AnalysisPDFData = {
        symbol,
        price: livePriceRef.current || pdfLevelsPrice,
        timestamp: new Date(),
        mtfSnap: pdfMtfSnap ? {
          readings: pdfMtfSnap.readings.map(r => ({
            tf: r.tf,
            rsi: r.rsi,
            rsiNorm: r.rsiNorm,
            vmc: r.vmc,
            score: r.score,
            signal: r.signal,
            divergence: r.divergence,
          })),
          globalRSI: pdfMtfSnap.globalRSI,
          globalVMC: pdfMtfSnap.globalVMC,
          globalScore: pdfMtfSnap.globalScore,
          globalSignal: pdfMtfSnap.globalSignal,
          confluence: pdfMtfSnap.confluence,
          isTurningUp: pdfMtfSnap.isTurningUp,
          isTurningDown: pdfMtfSnap.isTurningDown,
        } : undefined,
        keyLevels: pdfLevels.map(l => ({
          price: l.price,
          type: l.type,
          label: l.label,
          strength: l.strength,
          touches: l.touches,
        })),
        tradePlan: pdfPlan ? {
          bull: {
            entry: pdfPlan.bull.entry,
            stop: pdfPlan.bull.stop,
            tp1: pdfPlan.bull.tp1,
            tp2: pdfPlan.bull.tp2,
            tp3: pdfPlan.bull.tp3,
            tp1RR: pdfPlan.bull.tp1RR,
            tp2RR: pdfPlan.bull.tp2RR,
            tp3RR: pdfPlan.bull.tp3RR,
            signalStrength: pdfPlan.bull.signalStrength,
            entryType: pdfPlan.bull.entryType,
          },
          bear: {
            entry: pdfPlan.bear.entry,
            stop: pdfPlan.bear.stop,
            tp1: pdfPlan.bear.tp1,
            tp2: pdfPlan.bear.tp2,
            tp3: pdfPlan.bear.tp3,
            tp1RR: pdfPlan.bear.tp1RR,
            tp2RR: pdfPlan.bear.tp2RR,
            tp3RR: pdfPlan.bear.tp3RR,
            signalStrength: pdfPlan.bear.signalStrength,
            entryType: pdfPlan.bear.entryType,
          },
          globalScore: pdfPlan.globalScore,
          bullProb: pdfPlan.bullProb,
          riskLevel: pdfPlan.riskLevel,
          context: pdfPlan.context,
        } : undefined,
        gptSections: pdfGpt ? {
          riskLines: pdfGpt.riskLines,
          timingLines: pdfGpt.timingLines,
          technicalLines: pdfGpt.technicalLines,
          infoLines: pdfGpt.infoLines,
          fundamentalLines: pdfGpt.fundamentalLines,
          scoreExplanation: pdfGpt.scoreExplanation,
        } : undefined,
        wtStatus: pdfWtStatus || undefined,
        wtValues: pdfWtValues ?? undefined,
        vmcStatus: pdfVmcStatus || undefined,
        chartImageDataUrl: chartImg,
        // Decision Assistant fields
        ouExcess: ouSignal.excess,
        ouZ: ouSignal.z,
        ...(pdfMtfSnap ? (() => {
          const dec = computeDecision({
            mtfScore:        pdfMtfSnap.globalScore,
            mtfConfluence:   pdfMtfSnap.confluence,
            mtfSignal:       pdfMtfSnap.globalSignal,
            ouExcess:        ouSignal.excess,
            ouRegime:        ouSignal.regime,
            ouZ:             ouSignal.z,
            vmcStatus:       ouSignal.vmcStatus,
            confluenceSignal: ouSignal.confluenceSignal,
            whalePressure:   pressure?.score ?? 0,
            liqBias:         liqLong1h - liqShort1h,
            isCrypto,
            recentSignals:   [],
          })
          return {
            decisionScore:     dec.score,
            decisionBias:      dec.bias,
            decisionReadiness: dec.readiness,
            decisionReasons:   dec.reasons,
            decisionRisks:     dec.risks,
          }
        })() : {}),
      }
      generateAnalysisPDF(data)
    } catch (e) {
      console.error('PDF generation failed:', e)
    } finally {
      setPdfGenerating(false)
    }
  }, [symbol, pdfLevelsPrice, pdfMtfSnap, pdfLevels, pdfPlan, pdfGpt, pdfWtStatus, pdfWtValues, pdfVmcStatus, pdfGenerating, ouSignal, pressure, liqLong1h, liqShort1h, isCrypto])

  // CVD state
  const [connected, setConnected] = useState(false)
  const [tps,       setTps]       = useState(0)
  const [price,     setPrice]     = useState(0)
  const [cvdPts,    setCvdPts]    = useState<CVDPt[]>([])
  const [segs,      setSegs]      = useState<Seg[]>(['large','institutional','whales','all'])
  const [pressure,  setPressure]  = useState<WhalePressure|null>(null)
  const [traps,     setTraps]     = useState<TrapEvent[]>([])
  const [absorbs,   setAbsorbs]   = useState<AbsEvent[]>([])

  // Whale Trend state
  const [wtPts,     setWtPts]     = useState<WhaleTrendPt[]>([])
  const [wtSummary, setWtSummary] = useState<WhaleSummary|null>(null)
  const [wtTf,      setWtTf]      = useState('1h')

  // Segmented CVD History state
  const [segHistPts,  setSegHistPts]  = useState<SegHistPt[]>([])
  const [segHistLoad, setSegHistLoad] = useState(false)

  // Dérivés state
  const [oi,        setOI]        = useState<OIData|null>(null)
  const [funding,   setFunding]   = useState<Funding|null>(null)
  const [derivLoad, setDerivLoad] = useState(false)

  // ── New features state ───────────────────────────────────────────────────
  const [fng,         setFng]         = useState<FngData|null>(null)
  const [domPts,      setDomPts]      = useState<DominancePt[]>([])
  const [domCurrent,  setDomCurrent]  = useState<DominancePt>({btcD:0,ethD:0})
  const [liquidations,setLiquidations]= useState<LiqEvent[]>([])
  const [liqLong1h,   setLiqLong1h]   = useState(0)
  const [liqShort1h,  setLiqShort1h]  = useState(0)
  const [lsHistory,   setLsHistory]   = useState<LSRatioPt[]>([])
  const [heatmapOpen, setHeatmapOpen] = useState(false)
  const [heatmapCells,setHeatmapCells]= useState<HeatmapCell[]>([])
  const [heatmapLoad, setHeatmapLoad] = useState(false)
  const [searching,   setSearching]   = useState(!symbol)  // pleine page recherche
  const liqRef = useRef<LiqEvent[]>([])
  const liqWs  = useRef<WebSocket|null>(null)

  const tickBuf   = useRef<Tick[]>([])
  const cvdAcc    = useRef<Record<Seg,number>>({small:0,medium:0,large:0,institutional:0,whales:0,all:0})
  const priceRef  = useRef(0)
  const tpsCnt    = useRef(0)
  const lastAbs   = useRef({buy:0,sell:0})
  const lastTrap  = useRef<Record<string,number>>({})
  const sealT     = useRef<ReturnType<typeof setInterval>|null>(null)
  const tpsT      = useRef<ReturnType<typeof setInterval>|null>(null)

  // ── WebSocket — crypto only ──
  useEffect(()=>{
    if(mode!=='micro')return
    if(!symbol)return
    if(!/USDT$|BUSD$|BTC$|ETH$|BNB$/i.test(symbol))return  // Non-crypto → pas de WebSocket
    let ws: WebSocket; let idx=0
    const urls=[`wss://fstream.binance.com/ws/${symbol.toLowerCase()}@aggTrade`,`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@aggTrade`]
    function connect(){
      ws=new WebSocket(urls[idx%urls.length])
      ws.onopen=()=>setConnected(true)
      ws.onclose=()=>{setConnected(false);idx++;setTimeout(connect,2000)}
      ws.onerror=()=>ws.close()
      ws.onmessage=(e)=>{
        try{const d=JSON.parse(e.data);if(d.e!=='aggTrade')return
          const p=parseFloat(d.p),q=parseFloat(d.q),vol=p*q;if(vol<100)return
          tpsCnt.current++;priceRef.current=p;livePriceRef.current=p;setPrice(p)
          const tick:Tick={ts:Date.now(),price:p,vol,isBuy:!d.m}
          tickBuf.current.push(tick);if(tickBuf.current.length>2000)tickBuf.current.shift()
          const delta=tick.isBuy?vol:-vol
          ;(['small','medium','large','institutional','whales','all'] as Seg[]).forEach(s=>{if(inSeg(vol,s))cvdAcc.current[s]+=delta})
        }catch{/**/}
      }
    }
    connect()
    sealT.current=setInterval(()=>{
      const now=Date.now(),acc=cvdAcc.current
      setCvdPts(prev=>{const n=[...prev,{t:now,...acc}];return n.length>300?n.slice(-300):n})
      const w60=tickBuf.current.filter(t=>t.ts>now-60000&&t.vol>=100000)
      const wB=w60.filter(t=>t.isBuy).reduce((s,t)=>s+t.vol,0)
      const wS=w60.filter(t=>!t.isBuy).reduce((s,t)=>s+t.vol,0)
      const wT=wB+wS,score=wT>0?(wB-wS)/wT:0
      const label=Math.abs(score)<0.1?'Neutral':score>0.4?'Strong Whale Buying 🐋':score>0.1?'Whale Buying 🐋':score<-0.4?'Strong Whale Selling 🦈':'Whale Selling 🦈'
      setPressure({score,buyVol:wB,sellVol:wS,trades:w60.length,label})
      const w30=tickBuf.current.filter(t=>t.ts>now-30000),bV=w30.filter(t=>t.isBuy).reduce((s,t)=>s+t.vol,0),sV=w30.filter(t=>!t.isBuy).reduce((s,t)=>s+t.vol,0)
      const delta=bV-sV,pp=w30[0]?.price||0,lp=w30[w30.length-1]?.price||0,mov=pp>0?Math.abs((lp-pp)/pp)*100:0
      const p=priceRef.current
      if(delta>200000&&mov<0.05&&now-lastAbs.current.buy>15000){lastAbs.current.buy=now;setAbsorbs(prev=>[{id:`${now}b`,type:'buy' as const,strength:delta,price:p,ts:now},...prev].slice(0,8))}
      else if(delta<-200000&&mov<0.05&&now-lastAbs.current.sell>15000){lastAbs.current.sell=now;setAbsorbs(prev=>[{id:`${now}s`,type:'sell' as const,strength:delta,price:p,ts:now},...prev].slice(0,8))}
      if(p>0&&Math.abs(score)>0.35&&now-(lastTrap.current.t||0)>20000){lastTrap.current.t=now;setTraps(prev=>[{id:`t${now}`,type:'failedWhalePush',price:p,conf:Math.min(0.4+Math.abs(score)*0.5,0.95),whaleDelta:wB-wS,cvdDelta:acc.all,age:0,ts:now},...prev].slice(0,15))}
      setTraps(prev=>prev.map(t=>({...t,age:Math.round((now-t.ts)/1000)})))
    },3000)
    tpsT.current=setInterval(()=>{setTps(tpsCnt.current);tpsCnt.current=0},1000)
    return()=>{ws?.close();if(sealT.current)clearInterval(sealT.current);if(tpsT.current)clearInterval(tpsT.current)}
  },[symbol,mode])

  // ── Whale Trend ──
  useEffect(()=>{
    if(mode!=='structure')return
    const TF_MAP:Record<string,{interval:string;limit:number}>={'5m':{interval:'1m',limit:5},'15m':{interval:'1m',limit:15},'1h':{interval:'5m',limit:12},'4h':{interval:'15m',limit:16},'12h':{interval:'30m',limit:24},'24h':{interval:'1h',limit:24}}
    const{interval,limit}=TF_MAP[wtTf]||{interval:'5m',limit:12}
    fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`)
      .then(r=>r.json()).then((raw:unknown[][])=>{
        let cum=0,prevEma=0;const alpha=2/(9+1)
        const pts:WhaleTrendPt[]=raw.map(a=>{const o=parseFloat(a[1] as string),c=parseFloat(a[4] as string),v=parseFloat(a[5] as string);const vol=v*c;const bull=c>=o;const wF=Math.min(0.6,0.15+Math.abs(c-o)/o*10);const wDelta=(bull?1:-1)*vol*wF*0.6;const rDelta=(bull?1:-1)*vol*(1-wF)*0.3;cum+=wDelta;const ema=prevEma+alpha*(wDelta-prevEma);prevEma=ema;return{t:Number(a[0]),cum,ema,retail:rDelta}})
        setWtPts(pts)
        const last=pts[pts.length-1];const mom=last?.ema||0;const maxEma=Math.max(...pts.map(p=>Math.abs(p.ema)),1);const ms=mom/maxEma
        const trend=ms>0.4?'Accumulation forte':ms>0.1?'Accumulation':ms<-0.4?'Distribution forte':ms<-0.1?'Distribution':'Neutre'
        const tc=ms>0.1?'var(--tm-profit)':ms<-0.1?'var(--tm-loss)':'var(--tm-text-secondary)'
        const prices=raw.map(a=>parseFloat(a[4] as string));const ps=prices[prices.length-1]-prices[0],cs=last.cum-(pts[0]?.cum||0)
        const div=ps<-0.1&&cs>0?'Haussière 📈':ps>0.1&&cs<0?'Baissière 📉':'Aucune'
        setWtSummary({trend,trendColor:tc,netCVD:last.cum,momentum:ms,divergence:div})
      }).catch(()=>{})
  },[symbol,mode,wtTf])

  // ── Segmented CVD History (Structure tab) ──
  useEffect(() => {
    if (mode !== 'structure') return
    if (!symbol || !/USDT$|BUSD$|BTC$|ETH$|BNB$/i.test(symbol)) return
    setSegHistLoad(true)
    // Fetch last 3000 aggTrades from Binance futures for segmented CVD history
    fetch(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${symbol}&limit=3000`)
      .then(r => r.json())
      .then((trades: { p: string; q: string; m: boolean; T: number }[]) => {
        if (!Array.isArray(trades) || trades.length === 0) return
        const bucketMs = 60 * 1000 // 1-minute buckets
        const buckets = new Map<number, SegHistPt>()
        for (const t of trades) {
          const price = parseFloat(t.p), qty = parseFloat(t.q), vol = price * qty
          if (vol < 100) continue
          const bk = Math.floor(t.T / bucketMs) * bucketMs
          if (!buckets.has(bk)) buckets.set(bk, { t: bk, small: 0, medium: 0, large: 0, institutional: 0, whales: 0 })
          const b = buckets.get(bk)!
          const delta = t.m ? -vol : vol
          if (vol >= 1e6)   b.whales        += delta
          else if (vol >= 1e5) b.institutional += delta
          else if (vol >= 1e4) b.large         += delta
          else if (vol >= 1e3) b.medium         += delta
          else if (vol >= 100) b.small          += delta
        }
        // Convert to cumulative per segment
        const sorted = [...buckets.values()].sort((a, b) => a.t - b.t)
        const cum: SegHistPt = { t: 0, small: 0, medium: 0, large: 0, institutional: 0, whales: 0 }
        const pts: SegHistPt[] = sorted.map(b => {
          cum.small         += b.small
          cum.medium        += b.medium
          cum.large         += b.large
          cum.institutional += b.institutional
          cum.whales        += b.whales
          return { t: b.t, small: cum.small, medium: cum.medium, large: cum.large, institutional: cum.institutional, whales: cum.whales }
        })
        setSegHistPts(pts)
      })
      .catch(() => {})
      .finally(() => setSegHistLoad(false))
  }, [symbol, mode])

  // ── Fear & Greed (crypto only, once per symbol) ──────────────────────────
  useEffect(() => {
    if (!isCryptoSymbol(symbol) && symbol !== '') return
    fetch('https://api.alternative.me/fng/?limit=30')
      .then(r => r.json())
      .then((d: { data: { value: string; value_classification: string }[] }) => {
        if (!Array.isArray(d.data) || d.data.length === 0) return
        const history = d.data.map(i => parseInt(i.value)).reverse()
        const latest  = d.data[0]
        setFng({ value: parseInt(latest.value), label: latest.value_classification, history })
      })
      .catch(() => {})
  }, [symbol])

  // ── BTC/ETH Dominance (CoinGecko global, pas de CORS) ───────────────────
  useEffect(() => {
    if (!isCryptoSymbol(symbol) && symbol !== '') return
    fetch('https://api.coingecko.com/api/v3/global', { signal: AbortSignal.timeout(8000) })
      .then(r => r.json())
      .then((d: { data?: { market_cap_percentage?: { btc?: number; eth?: number } } }) => {
        const btcD = d.data?.market_cap_percentage?.btc ?? 0
        const ethD = d.data?.market_cap_percentage?.eth ?? 0
        // Fake sparkline with slight noise around the current value
        const pts: DominancePt[] = Array.from({ length: 48 }, (_, i) => ({
          btcD: btcD + (Math.sin(i * 0.4) * 0.3),
          ethD: ethD + (Math.sin(i * 0.5 + 1) * 0.15),
        }))
        setDomPts(pts)
        setDomCurrent({ btcD, ethD })
      }).catch(() => {})
  }, [symbol])

  // ── Live Liquidations WebSocket ───────────────────────────────────────────
  useEffect(() => {
    if (!isCryptoSymbol(symbol) && symbol !== '') { liqWs.current?.close(); return }
    let ws: WebSocket
    let reconnT: ReturnType<typeof setTimeout>
    function connect() {
      ws = new WebSocket('wss://fstream.binance.com/ws/!forceOrder@arr')
      liqWs.current = ws
      ws.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data)
          if (d.e !== 'forceOrder') return
          const o = d.o
          const price = parseFloat(o.ap || o.p)
          const qty   = parseFloat(o.q)
          const usd   = price * qty
          if (usd < 50000) return // filter < $50k
          const side: 'LONG'|'SHORT' = o.S === 'SELL' ? 'LONG' : 'SHORT'
          const ev: LiqEvent = { id: `${Date.now()}-${Math.random()}`, side, usd, sym: o.s.replace('USDT',''), ts: Date.now() }
          liqRef.current = [ev, ...liqRef.current].slice(0, 30)
          setLiquidations([...liqRef.current])
          // update 1h stats
          const now = Date.now()
          const recent = liqRef.current.filter(l => l.ts > now - 3600000)
          setLiqLong1h(recent.filter(l => l.side === 'LONG').reduce((s, l) => s + l.usd, 0))
          setLiqShort1h(recent.filter(l => l.side === 'SHORT').reduce((s, l) => s + l.usd, 0))
        } catch { /**/ }
      }
      ws.onclose = () => { reconnT = setTimeout(connect, 3000) }
      ws.onerror = () => ws.close()
    }
    connect()
    return () => { ws?.close(); clearTimeout(reconnT) }
  }, [symbol])

  // ── L/S Ratio History (Dérivés only) ─────────────────────────────────────
  useEffect(() => {
    if (mode !== 'derivees') return
    if (!isCryptoSymbol(symbol)) return
    fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=15m&limit=96`)
      .then(r => r.json())
      .then((data: { timestamp: number; longShortRatio: string; longAccount: string; shortAccount: string }[]) => {
        if (!Array.isArray(data)) return
        const pts: LSRatioPt[] = data.map(d => ({
          t:        d.timestamp,
          ratio:    parseFloat(d.longShortRatio),
          longPct:  parseFloat(d.longAccount) * 100,
          shortPct: parseFloat(d.shortAccount) * 100,
        }))
        setLsHistory(pts)
      })
      .catch(() => {})
  }, [symbol, mode])

  // ── Market Heatmap RSI fetch ──────────────────────────────────────────────
  useEffect(() => {
    if (!heatmapOpen) return
    setHeatmapLoad(true)
    const intervals = ['15m', '1h', '4h', '1d'] as const
    const assets = HEATMAP_ASSETS
    // Reuse same RSI calculation as MarchesPage
    async function calcRSI(closes: number[], period = 14): Promise<number> {
      if (closes.length < period + 1) return 50
      let gains = 0, losses = 0
      for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i-1]; if (d > 0) gains += d; else losses -= d }
      let avgG = gains / period, avgL = losses / period
      for (let i = period + 1; i < closes.length; i++) {
        const d = closes[i] - closes[i-1]
        avgG = (avgG * (period - 1) + Math.max(d, 0)) / period
        avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period
      }
      return avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL)
    }
    Promise.all(assets.map(async (sym) => {
      const tfs = await Promise.all(intervals.map(async (tf) => {
        try {
          const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}USDT&interval=${tf}&limit=100`)
          const raw = await r.json() as unknown[][]
          const closes = raw.map(c => parseFloat(c[4] as string))
          return calcRSI(closes)
        } catch { return 50 }
      }))
      return { sym, tfs } as HeatmapCell
    })).then(cells => {
      setHeatmapCells(cells)
      setHeatmapLoad(false)
    }).catch(() => setHeatmapLoad(false))
  }, [heatmapOpen])

  // ── Dérivés ──
  useEffect(()=>{
    if(mode!=='derivees')return
    setDerivLoad(true)
    Promise.all([
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`).then(r=>r.json()),
      fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=15m&limit=96`).then(r=>r.json()),
      fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`).then(r=>r.json()),
    ]).then(([snap,hist,prem])=>{
      const oiBTC=parseFloat(snap.openInterest),curP=parseFloat(prem.markPrice)
      const hp:number[]=(hist as Record<string,unknown>[]).map(e=>parseFloat(e.sumOpenInterest as string))
      const h1v=hp[Math.max(0,hp.length-5)],h4v=hp[Math.max(0,hp.length-17)],h24v=hp[0]||oiBTC
      const pct=(a:number,b:number)=>b>0?(a-b)/b*100:0
      const c1=pct(oiBTC,h1v),c4=pct(oiBTC,h4v),c24=pct(oiBTC,h24v)
      const bullish=c1>0.5?true:c1<-0.5?false:null
      const signal=bullish===true?'Long Build-up':bullish===false?'Short Build-up':'Consolidation'
      setOI({usd:oiBTC*curP,btc:oiBTC,h1:c1,h4:c4,h24:c24,history:hp.slice(-48),signal,bullish})
      const rate=parseFloat(prem.lastFundingRate)*100,mark=parseFloat(prem.markPrice),idx=parseFloat(prem.indexPrice)
      const next=prem.nextFundingTime?new Date(prem.nextFundingTime):null
      const diff=next?next.getTime()-Date.now():0,h=Math.floor(diff/3600000),m=Math.floor((diff%3600000)/60000)
      const bias=rate>0.05?'Surchauffe haussière':rate>0.01?'Biais long':rate<-0.05?'Surchauffe baissière':rate<-0.01?'Biais short':'Neutre'
      setFunding({rate,mark,index:idx,basis:mark-idx,basisPct:(mark-idx)/idx*100,nextIn:h>0?`${h}h ${m}m`:`${m}m`,bias,isWarning:Math.abs(rate)>0.05})
      setDerivLoad(false)
    }).catch(()=>setDerivLoad(false))
  },[symbol,mode])

  // Computed
  const lastCVD=cvdPts[cvdPts.length-1]
  const w60=tickBuf.current.filter(t=>t.ts>Date.now()-60000&&t.vol>=100000)
  const wF60B=w60.filter(t=>t.isBuy).reduce((s,t)=>s+t.vol,0),wF60S=w60.filter(t=>!t.isBuy).reduce((s,t)=>s+t.vol,0)
  const wFlowDelta=wF60B-wF60S,isWhaleB=wFlowDelta>50000,isNeutral=Math.abs(wFlowDelta)<50000
  const bullConf=(pressure&&pressure.score>0.1?1:0)+(lastCVD&&lastCVD.institutional>0?1:0)+(traps.filter(t=>t.conf>=0.55).length>0?1:0)
  const bearConf=(pressure&&pressure.score<-0.1?1:0)+(lastCVD&&lastCVD.institutional<0?1:0)
  const biasLabel=bullConf>bearConf?'Haussier':bearConf>bullConf?'Baissier':'Neutre'
  const biasColor=bullConf>bearConf?'var(--tm-profit)':bearConf>bullConf?'var(--tm-loss)':'var(--tm-text-secondary)'

  const isCrypto = isCryptoSymbol(symbol)

  // ── Cmd+K pour ouvrir la recherche ────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearching(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Mode recherche : remplace TOUTE la page (aucun overlay) ───────────────
  if (searching) {
    return (
      <SearchView
        currentSymbol={symbol}
        onSelect={s => {
          setSymbol(s)
          setCvdPts([])
          Object.keys(cvdAcc.current).forEach(k => (cvdAcc.current as Record<string, number>)[k] = 0)
        }}
        onClose={() => setSearching(false)}
      />
    )
  }

  const C = {
    card: {
      background:'rgba(13,17,35,0.7)',
      backdropFilter:'blur(12px)',
      WebkitBackdropFilter:'blur(12px)',
      border:'1px solid rgba(255,255,255,0.06)',
      borderRadius:16,
      overflow:'hidden' as const,
      position:'relative' as const,
      boxShadow:'0 4px 24px rgba(0,0,0,0.4)',
    },
    top: {position:'absolute' as const,top:0,left:0,right:0,height:1,background:'linear-gradient(90deg,transparent,rgba(0,229,255,0.15),transparent)'},
    p: '12px 16px',
  }

  return (
    <div style={{
      padding:'28px 28px 40px',maxWidth:1600,margin:'0 auto',
      minHeight:'100vh',
      position:'relative' as const,
    }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes scanline{0%{transform:translateY(-100%)}100%{transform:translateY(100vh)}}
        @keyframes neonPulse{0%,100%{opacity:0.6}50%{opacity:1}}
        .analyse-grid-bg::before{
          content:'';position:fixed;inset:0;pointer-events:none;z-index:0;
          background-image:linear-gradient(rgba(0,229,255,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,0.03) 1px,transparent 1px);
          background-size:40px 40px;
        }
        .analyse-grid-bg::after{
          content:'';position:fixed;top:0;left:0;right:0;height:2px;pointer-events:none;z-index:0;
          background:linear-gradient(90deg,transparent,rgba(0,229,255,0.06),rgba(191,90,242,0.06),transparent);
          animation:neonPulse 4s ease-in-out infinite;
        }
        .analyse-card-hover{transition:border-color 0.2s,box-shadow 0.2s}
        .analyse-card-hover:hover{border-color:rgba(0,229,255,0.15)!important;box-shadow:0 4px 32px rgba(0,229,255,0.06)!important}
        .mode-tab-active{background:linear-gradient(135deg,rgba(0,229,255,0.18),rgba(191,90,242,0.12))!important;border:1px solid rgba(0,229,255,0.4)!important;box-shadow:0 0 16px rgba(0,229,255,0.15)!important}
        .mode-tab{border:1px solid transparent;transition:all 0.2s}
        .analyse-section-label{
          font-family:'Syne',sans-serif;font-weight:700;font-size:13px;
          color:var(--tm-text-primary);letter-spacing:0.02em;
          display:flex;align-items:center;gap:8px;
        }
      `}</style>
      <div className="analyse-grid-bg" style={{position:'fixed',inset:0,pointerEvents:'none',zIndex:0}}/>

      {/* Header */}
      <div style={{position:'relative',zIndex:1,display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24,flexWrap:'wrap',gap:14}}>
        {/* Left — Title HUD */}
        <div style={{display:'flex',alignItems:'center',gap:14}}>
          <div style={{
            width:44,height:44,borderRadius:14,flexShrink:0,
            background:'linear-gradient(135deg,rgba(0,229,255,0.15),rgba(191,90,242,0.15))',
            border:'1px solid rgba(0,229,255,0.25)',
            display:'flex',alignItems:'center',justifyContent:'center',
            boxShadow:'0 0 20px rgba(0,229,255,0.1)',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--tm-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </div>
          <div>
            <h1 style={{fontSize:22,fontWeight:800,color:'var(--tm-text-primary)',margin:0,fontFamily:'Syne,sans-serif',letterSpacing:'-0.02em',
              background:'linear-gradient(135deg,#fff 40%,rgba(0,229,255,0.8))',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
              Analyse
            </h1>
            <p style={{fontSize:12,color:'var(--tm-text-muted)',margin:'2px 0 0',fontFamily:'JetBrains Mono,monospace',letterSpacing:'0.04em'}}>
              {!symbol ? '// rechercher un actif pour commencer' : isCrypto ? 'Heatmap · CVD · Structure · Dérivés' : 'MTF · WaveTrend · VMC · Trade Plan'}
            </p>
          </div>
        </div>
        {/* Right — actions */}
        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          {/* Heatmap Contexte button — crypto only */}
          {isCrypto && symbol && (
            <button onClick={() => setHeatmapOpen(true)} style={{ display:'flex', alignItems:'center', gap:5, padding:'7px 13px', borderRadius:10, background:'rgba(0,229,255,0.06)', border:'1px solid rgba(0,229,255,0.2)', color:'var(--tm-accent)', cursor:'pointer', fontSize:11, fontWeight:600, backdropFilter:'blur(8px)', transition:'all 0.15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,229,255,0.12)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,229,255,0.4)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,229,255,0.06)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,229,255,0.2)' }}>
              🌡️ Contexte
            </button>
          )}
          {/* Bouton recherche — ouvre pleine page (0 problème de superposition) */}
          <button
            onClick={() => setSearching(true)}
            style={{
              display:'flex', alignItems:'center', gap:8,
              background:'rgba(0,217,255,0.06)',
              border:`1px solid ${symbol?'rgba(0,217,255,0.3)':'rgba(0,217,255,0.15)'}`,
              borderRadius:12, padding:'8px 14px', cursor:'pointer',
              minWidth:200, transition:'all 0.15s',
            }}
            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor='rgba(0,217,255,0.5)';(e.currentTarget as HTMLElement).style.background='rgba(0,217,255,0.1)'}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor=symbol?'rgba(0,217,255,0.3)':'rgba(0,217,255,0.15)';(e.currentTarget as HTMLElement).style.background='rgba(0,217,255,0.06)'}}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8E8E93" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <span style={{fontSize:13,fontWeight:700,color:symbol?'#fff':'#8E8E93',flex:1,textAlign:'left',fontFamily:'JetBrains Mono,monospace'}}>
              {symbol || 'Rechercher un actif…'}
            </span>
            <span style={{fontSize:9,color:'#3A3F4B',border:'1px solid #2A2F3E',borderRadius:4,padding:'1px 5px',flexShrink:0}}>⌘K</span>
          </button>
          {symbol && <MarketStateEngine symbol={symbol} />}
          {symbol && (
            <button
              onClick={handleExportPDF}
              disabled={pdfGenerating}
              title="Exporter le rapport d'analyse complet en PDF"
              style={{
                display:'flex',alignItems:'center',gap:7,
                padding:'8px 16px',borderRadius:10,
                background: pdfGenerating ? 'rgba(13,17,23,0.8)' : 'linear-gradient(135deg,rgba(0,229,255,0.12),rgba(191,90,242,0.12))',
                border:'1px solid rgba(0,229,255,0.35)',
                color:'var(--tm-accent)',cursor: pdfGenerating ? 'wait' : 'pointer',
                fontSize:12,fontWeight:600,
                transition:'all 0.15s',flexShrink:0,
                opacity: pdfGenerating ? 0.7 : 1,
                boxShadow: pdfGenerating ? 'none' : '0 0 12px rgba(0,229,255,0.1)',
              }}
            >
              {pdfGenerating ? (
                <>
                  <div style={{width:14,height:14,border:'2px solid #2A2F3E',borderTopColor:'var(--tm-accent)',borderRadius:'50%',animation:'spin 0.7s linear infinite'}} />
                  Génération…
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
                  </svg>
                  Exporter PDF
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* ── Fear & Greed + Decision Assistant strip ── */}
      {symbol && (isCrypto ? (fng || pdfMtfSnap) : pdfMtfSnap) && (
        <div style={{ position:'relative', zIndex:1, display:'flex', gap:10, flexWrap:'wrap', marginBottom:16 }}>
          {isCrypto && fng && <FearGreedWidget data={fng} />}
          {pdfMtfSnap && (
            <DecisionAssistant
              mtfSnap={pdfMtfSnap}
              pressure={pressure}
              liqLong1h={liqLong1h}
              liqShort1h={liqShort1h}
              isCrypto={isCrypto}
              ouExcess={ouSignal.excess}
              ouRegime={ouSignal.regime}
              ouZ={ouSignal.z}
              vmcStatus={ouSignal.vmcStatus}
              confluenceSignal={ouSignal.confluenceSignal}
            />
          )}
        </div>
      )}

      {/* Heatmap modal */}
      {heatmapOpen && <MarketHeatmapModal cells={heatmapCells} loading={heatmapLoad} onClose={() => setHeatmapOpen(false)} />}

      {/* État vide — deux colonnes : recherche | analyse photo */}
      {!symbol && (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,alignItems:'start',position:'relative',zIndex:1}}>

          {/* ── Colonne gauche : recherche par symbole ── */}
          <div>
            {/* Hero */}
            <div style={{textAlign:'center',padding:'32px 20px 24px'}}>
              <div style={{width:56,height:56,borderRadius:18,background:'linear-gradient(135deg,rgba(var(--tm-accent-rgb,0,229,255),0.15),rgba(var(--tm-purple-rgb,191,90,242),0.15))',display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,margin:'0 auto 14px',border:'1px solid rgba(var(--tm-accent-rgb,0,229,255),0.2)'}}>📊</div>
              <div style={{fontSize:18,fontWeight:700,color:'var(--tm-text-primary)',marginBottom:6,fontFamily:'Syne,sans-serif'}}>Recherchez un actif</div>
              <div style={{fontSize:12,color:'var(--tm-text-muted)',maxWidth:340,margin:'0 auto'}}>Crypto, action, forex — tapez un symbole dans la barre de recherche pour lancer l'analyse</div>
            </div>

            {/* Accès rapide */}
            <div style={{display:'grid',gridTemplateColumns:'1fr',gap:8,marginBottom:16}}>
              {[
                {title:'🪙 Crypto',items:[{s:'BTCUSDT',n:'Bitcoin'},{s:'ETHUSDT',n:'Ethereum'},{s:'SOLUSDT',n:'Solana'},{s:'BNBUSDT',n:'BNB'}]},
                {title:'📈 Actions US',items:[{s:'AAPL',n:'Apple'},{s:'TSLA',n:'Tesla'},{s:'MSFT',n:'Microsoft'},{s:'NVDA',n:'Nvidia'}]},
                {title:'💱 Forex & Indices',items:[{s:'EURUSD=X',n:'EUR/USD',d:'EURUSD'},{s:'GC=F',n:'Or (Gold)',d:'Gold'},{s:'^FCHI',n:'CAC 40',d:'^FCHI'},{s:'MC.PA',n:'LVMH',d:'MC.PA'}]},
              ].map(cat=>(
                <div key={cat.title} style={{background:'rgba(13,17,35,0.7)',backdropFilter:'blur(12px)',WebkitBackdropFilter:'blur(12px)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:14,overflow:'hidden',boxShadow:'0 4px 20px rgba(0,0,0,0.3)'}}>
                  <div style={{padding:'8px 14px',borderBottom:'1px solid #1E2330'}}>
                    <span style={{fontSize:11,fontWeight:700,color:'var(--tm-text-primary)'}}>{cat.title}</span>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',padding:'4px 0'}}>
                    {cat.items.map(item=>(
                      <button key={item.s} onClick={()=>{setSymbol(item.s);setCvdPts([]);Object.keys(cvdAcc.current).forEach(k=>(cvdAcc.current as Record<string,number>)[k]=0)}}
                        style={{display:'flex',alignItems:'center',gap:8,padding:'7px 14px',background:'transparent',border:'none',cursor:'pointer',textAlign:'left',borderRadius:8,transition:'all 0.15s'}}
                        onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='rgba(0,229,255,0.04)';(e.currentTarget as HTMLElement).style.transform='translateX(2px)'}}
                        onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='transparent';(e.currentTarget as HTMLElement).style.transform='translateX(0)'}}>
                        <div style={{flex:1}}>
                          <div style={{fontSize:11,fontWeight:600,color:'var(--tm-text-primary)',fontFamily:'JetBrains Mono,monospace'}}>{(item as any).d || item.s}</div>
                          <div style={{fontSize:10,color:'var(--tm-text-muted)'}}>{item.n}</div>
                        </div>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--tm-text-muted)" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Raccourcis */}
            <div style={{display:'flex',justifyContent:'center',gap:16,flexWrap:'wrap'}}>
              {[
                {label:'Rechercher',keys:'Cliquez la barre'},
                {label:'Crypto rapide',keys:'BTC, ETH, SOL...'},
                {label:'Actions',keys:'AAPL, TSLA, NVDA...'},
              ].map(h=>(
                <div key={h.label} style={{display:'flex',alignItems:'center',gap:5}}>
                  <span style={{fontSize:10,color:'var(--tm-text-muted)',background:'var(--tm-bg-tertiary)',padding:'2px 7px',borderRadius:4,border:'1px solid #2A2F3E',fontFamily:'JetBrains Mono'}}>{h.keys}</span>
                  <span style={{fontSize:10,color:'var(--tm-text-muted)'}}>{h.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Colonne droite : analyse photo ── */}
          <div>
            <div style={{textAlign:'center',padding:'32px 20px 24px'}}>
              <div style={{width:56,height:56,borderRadius:18,background:'linear-gradient(135deg,rgba(var(--tm-purple-rgb,191,90,242),0.15),rgba(255,45,85,0.15))',display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,margin:'0 auto 14px',border:'1px solid rgba(var(--tm-purple-rgb,191,90,242),0.2)'}}>📸</div>
              <div style={{fontSize:18,fontWeight:700,color:'var(--tm-text-primary)',marginBottom:6,fontFamily:'Syne,sans-serif'}}>Analyse Screenshot IA</div>
              <div style={{fontSize:12,color:'var(--tm-text-muted)',maxWidth:340,margin:'0 auto'}}>Upload une capture de graphique — GPT-4o Vision analyse la structure, les zones clés et génère un plan de trade</div>
            </div>
            <ChartScreenshotAnalysis />
          </div>

        </div>
      )}

      {/* Graphique — layout selector */}
      {symbol && <div style={{position:'relative',zIndex:1}}><ChartLayout symbol={symbol} isCrypto={isCryptoSymbol(symbol)} onTimeframeChange={setSyncInterval} onVisibleRangeChange={(from,to,areaRatio)=>setSyncRange({from,to,areaRatio})} onCrosshairChange={d=>setCrosshairFrac(d ? d.frac : null)} lwChartRef={lwChartRef} /></div>}

      {/* Canal OU + Excès Statistiques + VMC Kaufman */}
      {symbol && (() => {
        const panelDefs: Record<string, React.ReactNode> = {
          'canal-ou': (
            <CollapsiblePanel key="canal-ou" panelId="canal-ou" label="Canal OU · Excès Statistiques · Kaufman ER" icon="〜" accent="rgba(0,229,255,0.5)" defaultOpen={true}
              onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop}
              isDragging={dragItemRef.current === 'canal-ou'}>
              <OUChannelIndicator symbol={symbol} syncInterval={syncInterval} visibleRange={syncRange} crosshairFrac={crosshairFrac} onDecisionData={setOuSignal} />
            </CollapsiblePanel>
          ),
          'wavetrend': (
            <CollapsiblePanel key="wavetrend" panelId="wavetrend" label="WaveTrend Oscillator" icon="〰️" accent="rgba(191,90,242,0.5)" defaultOpen={true}
              onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop}
              isDragging={dragItemRef.current === 'wavetrend'}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                <WaveTrendChart symbol={symbol} syncInterval={syncInterval} visibleRange={syncRange}
                  onStatusReady={(status,wt1,wt2)=>{setPdfWtStatus(status);setPdfWtValues({wt1,wt2})}} crosshairFrac={crosshairFrac} />
              </div>
            </CollapsiblePanel>
          ),
          'vmc': (
            <CollapsiblePanel key="vmc" panelId="vmc" label="VMC Oscillator" icon="📊" accent="rgba(255,149,0,0.5)" defaultOpen={true}
              onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop}
              isDragging={dragItemRef.current === 'vmc'}>
              <VMCOscillatorChart symbol={symbol} syncInterval={syncInterval} visibleRange={syncRange}
                onStatusReady={(status)=>setPdfVmcStatus(status)} crosshairFrac={crosshairFrac} />
            </CollapsiblePanel>
          ),
          'rsi': (
            <CollapsiblePanel key="rsi" panelId="rsi" label="RSI" icon="📈" accent="rgba(52,199,89,0.5)" defaultOpen={false}
              onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop}
              isDragging={dragItemRef.current === 'rsi'}>
              <RSIChart symbol={symbol} syncInterval={syncInterval} visibleRange={syncRange} crosshairFrac={crosshairFrac} />
            </CollapsiblePanel>
          ),
          'rsi-bollinger': (
            <CollapsiblePanel key="rsi-bollinger" panelId="rsi-bollinger" label="RSI Bollinger" icon="📉" accent="rgba(255,69,58,0.5)" defaultOpen={false}
              onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop}
              isDragging={dragItemRef.current === 'rsi-bollinger'}>
              <RSIBollingerChart symbol={symbol} syncInterval={syncInterval} visibleRange={syncRange} crosshairFrac={crosshairFrac} />
            </CollapsiblePanel>
          ),
          'trade-plan': (
            <CollapsiblePanel key="trade-plan" panelId="trade-plan" label="Trade Plan IA" icon="🎯" accent="rgba(0,229,255,0.5)" defaultOpen={true}
              onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop}
              isDragging={dragItemRef.current === 'trade-plan'}>
              <TradePlanCard
                symbol={symbol}
                price={price || 0}
                mtfScore={pdfMtfSnap?.globalScore ?? 0}
                mtfSignal={pdfMtfSnap?.globalSignal ?? 'NEUTRAL'}
                wtStatus={pdfWtStatus || 'Neutral'}
                vmcStatus={pdfVmcStatus || 'NEUTRAL'}
                onPlanReady={(plan, gpt) => { setPdfPlan(plan); if (gpt) setPdfGpt(gpt) }}
              />
            </CollapsiblePanel>
          ),
          'mtf': (
            <CollapsiblePanel key="mtf" panelId="mtf" label="MTF Dashboard" icon="🔭" accent="rgba(191,90,242,0.5)" defaultOpen={true}
              onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop}
              isDragging={dragItemRef.current === 'mtf'}>
              <MTFDashboard symbol={symbol} onSnapshotReady={snap => setPdfMtfSnap(snap)} />
            </CollapsiblePanel>
          ),
          'levels': (
            <div key="levels" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, position: 'relative', zIndex: 1 }}>
              <CollapsiblePanel panelId="levels" label="Niveaux Clés" icon="🔑" accent="rgba(255,214,10,0.5)" defaultOpen={true}
                onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop}
                isDragging={dragItemRef.current === 'levels'}>
                <KeyLevelsCard symbol={symbol} onLevelsReady={(lvls, p) => { setPdfLevels(lvls); setPdfLevelsPrice(p) }} />
              </CollapsiblePanel>
              <CollapsiblePanel label="Analyse Screenshot IA" icon="📸" accent="rgba(191,90,242,0.5)" defaultOpen={true}>
                <ChartScreenshotAnalysis symbol={symbol} />
              </CollapsiblePanel>
            </div>
          ),
          'heatmap': (
            <CollapsiblePanel key="heatmap" panelId="heatmap" label="Liquidation Heatmap" icon="🌡️" accent="rgba(255,59,48,0.5)" defaultOpen={true}
              onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop}
              isDragging={dragItemRef.current === 'heatmap'}>
              <LiquidationHeatmap symbol={symbol} />
            </CollapsiblePanel>
          ),
        }

        return panelOrder.map(id => panelDefs[id] ?? null)
      })()}

      {/* ══ CRYPTO ONLY ══ Mode tabs + CVD/Structure/Dérivés */}
      {isCrypto && <div style={{position:'relative',zIndex:1}}>
        {/* Mode tabs — neon cyberpunk */}
        <div style={{display:'flex',gap:6,marginBottom:16,flexWrap:'wrap'}}>
          {([
            {id:'micro',     icon:'📊',label:'Micro',      sub:'Flux temps réel',   color:'rgba(0,229,255,0.9)'},
            {id:'structure', icon:'🐋',label:'Structure',  sub:'Tendance baleine',  color:'rgba(191,90,242,0.9)'},
            {id:'derivees',  icon:'📈',label:'Dérivés',    sub:'OI · Funding · L/S',color:'rgba(255,149,0,0.9)'},
            {id:'orderflow', icon:'⊞', label:'Order Flow', sub:'Footprint · Cluster',color:'rgba(255,69,58,0.9)'},
            {id:'charts',    icon:'📅', label:'Charts',     sub:'Rendements · On-Chain',color:'rgba(52,199,89,0.9)'},
          ] as {id:Mode;icon:string;label:string;sub:string;color:string}[]).map(m=>{
            const active = mode === m.id
            return (
              <button key={m.id} className="mode-tab" onClick={()=>setMode(m.id)} style={{
                display:'flex',alignItems:'center',gap:8,
                padding:'9px 18px',borderRadius:12,
                cursor:'pointer',
                background: active
                  ? `linear-gradient(135deg,${m.color.replace('0.9','0.12')},rgba(13,17,35,0.6))`
                  : 'rgba(13,17,35,0.5)',
                border: active
                  ? `1px solid ${m.color.replace('0.9','0.5')}`
                  : '1px solid rgba(255,255,255,0.06)',
                boxShadow: active ? `0 0 16px ${m.color.replace('0.9','0.15')}` : 'none',
                backdropFilter:'blur(8px)',
                transition:'all 0.2s',
              }}>
                <span style={{fontSize:14}}>{m.icon}</span>
                <div style={{textAlign:'left'}}>
                  <div style={{fontSize:12,fontWeight:700,color:active?m.color:'var(--tm-text-secondary)',fontFamily:'Syne,sans-serif'}}>{m.label}</div>
                  <div style={{fontSize:9,color:active?m.color.replace('0.9','0.6'):'var(--tm-text-muted)',fontFamily:'JetBrains Mono,monospace'}}>{m.sub}</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>}

      {/* ── MICRO — crypto only ── */}
      {isCrypto&&mode==='micro'&&<div style={{display:'flex',flexDirection:'column',gap:12,position:'relative',zIndex:1}}>
        {/* Liquidations Ticker */}
        <LiqTicker liqs={liquidations} long1h={liqLong1h} short1h={liqShort1h} />
        {/* Summary Banner */}
        <div style={{...C.card,padding:C.p,borderColor:`${biasColor}25`,boxShadow:`0 4px 24px rgba(0,0,0,0.4), inset 0 0 40px ${biasColor}05`}} className="analyse-card-hover">
          <div style={C.top}/>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
            <div>
              <div style={{fontSize:15,fontWeight:800,color:biasColor,fontFamily:'Syne,sans-serif',textShadow:`0 0 12px ${biasColor}60`}}>{biasLabel}</div>
              <div style={{fontSize:10,color:'var(--tm-text-muted)',fontFamily:'JetBrains Mono,monospace'}}>{bullConf+bearConf>0?`${Math.max(bullConf,bearConf)} confirmation${Math.max(bullConf,bearConf)>1?'s':''} active${Math.max(bullConf,bearConf)>1?'s':''}`:'// en attente de données'}</div>
            </div>
            <div style={{display:'flex',gap:6}}>
              {pressure&&Math.abs(pressure.score)>0.1&&<span style={{fontSize:10,fontWeight:700,color:pressure.score>0?'var(--tm-profit)':'var(--tm-loss)',background:`${pressure.score>0?'var(--tm-profit)':'var(--tm-loss)'}`,padding:'2px 8px',borderRadius:5}}>CVD {pressure.score>0?'↑':'↓'}</span>}
              {pressure&&Math.abs(pressure.score)>0.1&&<span style={{fontSize:10,fontWeight:700,color:'var(--tm-accent)',background:'rgba(var(--tm-accent-rgb,0,229,255),0.1)',padding:'2px 8px',borderRadius:5}}>Whales</span>}
              {traps.filter(t=>t.conf>=0.55).length>0&&<span style={{fontSize:10,fontWeight:700,color:'var(--tm-warning)',background:'rgba(var(--tm-warning-rgb,255,149,0),0.1)',padding:'2px 8px',borderRadius:5}}>Trap ×{traps.filter(t=>t.conf>=0.55).length}</span>}
            </div>
          </div>
        </div>

        {/* CVD Panel */}
        <div style={C.card} className="analyse-card-hover"><div style={C.top}/>
          <div style={{padding:C.p}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,flexWrap:'wrap',gap:8}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span className="analyse-section-label" style={{background:'linear-gradient(90deg,rgba(0,229,255,0.08),transparent)',padding:'3px 10px 3px 0',borderLeft:'2px solid rgba(0,229,255,0.5)'}}>
                  <span style={{paddingLeft:8}}>CVD Segmenté</span>
                </span>
                <div style={{display:'flex',alignItems:'center',gap:4}}>
                  <div style={{width:6,height:6,borderRadius:'50%',background:connected?'var(--tm-profit)':'var(--tm-loss)',animation:connected?'pulse 2s infinite':'none'}}/>
                  <span style={{fontSize:9,fontWeight:700,color:connected?'var(--tm-profit)':'var(--tm-loss)'}}>{connected?'LIVE':'Connexion...'}</span>
                  {connected&&<span style={{fontSize:9,color:'var(--tm-text-muted)'}}>{tps} t/s</span>}
                </div>
              </div>
              {price>0&&<span style={{fontSize:13,fontWeight:700,color:'var(--tm-accent)',fontFamily:'JetBrains Mono,monospace'}}>{fmtP(price)}</span>}
            </div>
            {/* Whale Flow banner */}
            <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',background:`${isNeutral?'var(--tm-text-secondary)':isWhaleB?'var(--tm-profit)':'var(--tm-loss)'}`,borderRadius:8,marginBottom:10,border:`1px solid ${isNeutral?'var(--tm-text-secondary)':isWhaleB?'var(--tm-profit)':'var(--tm-loss)'}`}}>
              <span style={{fontSize:16}}>{isNeutral?'🔄':isWhaleB?'🐋':'🦈'}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:700,color:isNeutral?'var(--tm-text-secondary)':isWhaleB?'var(--tm-profit)':'var(--tm-loss)'}}>{isNeutral?'Neutral Flow':isWhaleB?`Whales Buying +${fmtU(wFlowDelta)}`:`Whales Selling ${fmtU(wFlowDelta)}`}</div>
                <div style={{fontSize:9,color:'var(--tm-text-muted)'}}>Flux 60s</div>
              </div>
              <div style={{display:'flex',gap:14}}>
                <div style={{textAlign:'center'}}><div style={{fontSize:9,color:'var(--tm-text-muted)'}}>Buy</div><div style={{fontSize:11,fontWeight:600,color:'var(--tm-profit)',fontFamily:'monospace'}}>{fmtU(wF60B)}</div></div>
                <div style={{textAlign:'center'}}><div style={{fontSize:9,color:'var(--tm-text-muted)'}}>Sell</div><div style={{fontSize:11,fontWeight:600,color:'var(--tm-loss)',fontFamily:'monospace'}}>{fmtU(wF60S)}</div></div>
              </div>
            </div>
            {/* Segment toggles */}
            <div style={{display:'flex',gap:5,flexWrap:'wrap',marginBottom:10}}>
              {(Object.keys(SEG_CFG) as Seg[]).map(seg=>{const cfg=SEG_CFG[seg],on=segs.includes(seg),val=cvdAcc.current[seg]
                return<button key={seg} onClick={()=>setSegs(prev=>on?prev.filter(s=>s!==seg):[...prev,seg])} style={{display:'flex',flexDirection:'column',alignItems:'center',padding:'5px 10px',borderRadius:8,fontSize:10,fontWeight:500,cursor:'pointer',border:`1px solid ${on?cfg.color:'var(--tm-border)'}`,background:on?`${cfg.color}`:'var(--tm-bg-tertiary)',color:on?cfg.color:'var(--tm-text-muted)',transition:'all 0.15s'}}>
                  <span>{cfg.label}</span>
                  <span style={{fontSize:9,fontFamily:'monospace',color:val>=0?'var(--tm-profit)':'var(--tm-loss)'}}>{val>=0?'+':''}{fmtU(val)}</span>
                </button>
              })}
            </div>
            <CVDChart pts={cvdPts} segs={segs}/>
            {lastCVD&&<div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6,marginTop:8}}>
              {(['large','institutional','whales'] as Seg[]).map(s=>{const cfg=SEG_CFG[s],v=lastCVD[s]
                return<div key={s} onClick={()=>setSegs(prev=>prev.includes(s)?prev.filter(x=>x!==s):[...prev,s])} style={{background:'var(--tm-bg-tertiary)',border:`1px solid ${segs.includes(s)?cfg.color:'var(--tm-border)'}`,borderRadius:8,padding:'8px',cursor:'pointer'}}>
                  <div style={{display:'flex',alignItems:'center',gap:4,marginBottom:3}}><span style={{width:7,height:7,borderRadius:'50%',background:cfg.color,display:'inline-block'}}/><span style={{fontSize:9,color:'var(--tm-text-secondary)'}}>{cfg.label}</span></div>
                  <div style={{fontSize:12,fontWeight:700,color:v>=0?'var(--tm-profit)':'var(--tm-loss)',fontFamily:'monospace'}}>{v>=0?'+':''}{fmtU(v)}</div>
                  <div style={{fontSize:8,color:'var(--tm-text-muted)'}}>{cfg.range}</div>
                </div>
              })}
            </div>}
          </div>
        </div>

        {/* Order Flow */}
        <div style={C.card} className="analyse-card-hover"><div style={C.top}/>
          <div style={{padding:C.p}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
              <span className="analyse-section-label" style={{background:'linear-gradient(90deg,rgba(191,90,242,0.08),transparent)',padding:'3px 10px 3px 0',borderLeft:'2px solid rgba(191,90,242,0.5)'}}>
                <span style={{paddingLeft:8}}>⚡ Order-Flow Intelligence</span>
              </span>
              <span style={{fontSize:9,fontWeight:700,color:connected?'var(--tm-purple)':'var(--tm-text-muted)'}}>LIVE</span>
            </div>
            {pressure&&<>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                <span style={{fontSize:11,fontWeight:600,color:'var(--tm-text-primary)'}}>Whale Pressure</span>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <span style={{fontSize:11,fontWeight:700,color:pressure.score>0.4?'var(--tm-profit)':pressure.score<-0.4?'var(--tm-loss)':'var(--tm-text-secondary)'}}>{pressure.label}</span>
                  <span style={{fontSize:10,color:'var(--tm-text-muted)',fontFamily:'monospace'}}>{pressure.score.toFixed(2)}</span>
                </div>
              </div>
              <PressureBar score={pressure.score}/>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:9,color:'var(--tm-text-muted)',marginBottom:12,marginTop:4}}><span>Sell</span><span>Neutral</span><span>Buy</span></div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:6}}>
                {[{l:'🐋 Buy',v:fmtU(pressure.buyVol),c:'var(--tm-profit)'},{l:'🦈 Sell',v:fmtU(pressure.sellVol),c:'var(--tm-loss)'},{l:'Trades',v:pressure.trades,c:'var(--tm-text-secondary)'},{l:'Vol 60s',v:fmtU(pressure.buyVol+pressure.sellVol),c:'var(--tm-text-secondary)'}].map(({l,v,c})=>(
                  <div key={l} style={{background:'var(--tm-bg-tertiary)',borderRadius:8,padding:'8px',textAlign:'center'}}><div style={{fontSize:9,color:'var(--tm-text-muted)',marginBottom:2}}>{l}</div><div style={{fontSize:12,fontWeight:600,color:c,fontFamily:'monospace'}}>{v}</div></div>
                ))}
              </div>
            </>}
          </div>
        </div>

        {/* Absorption */}
        <div style={C.card} className="analyse-card-hover"><div style={C.top}/>
          <div style={{padding:C.p}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
              <span className="analyse-section-label" style={{background:'linear-gradient(90deg,rgba(0,229,255,0.06),transparent)',padding:'3px 10px 3px 0',borderLeft:'2px solid rgba(0,229,255,0.3)'}}>
                <span style={{paddingLeft:8}}>🔍 Absorption</span>
              </span>
              <span style={{fontSize:11,fontWeight:700,color:'var(--tm-text-muted)',background:'var(--tm-bg-tertiary)',padding:'1px 7px',borderRadius:4}}>{absorbs.length}</span>
            </div>
            {absorbs.length===0?<div style={{fontSize:12,color:'var(--tm-text-muted)',textAlign:'center',padding:'8px 0'}}>Aucun événement détecté</div>:
            <div style={{display:'flex',flexDirection:'column',gap:5}}>
              {absorbs.slice(0,4).map(e=>{const c=e.type==='buy'?'var(--tm-profit)':'var(--tm-loss)'
                return<div key={e.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',background:`${c}08`,borderRadius:7,border:`1px solid ${c}20`}}>
                  <div style={{width:8,height:8,borderRadius:'50%',background:e.type==='buy'?c:'none',border:e.type==='sell'?`2px solid ${c}`:'none',flexShrink:0}}/>
                  <div style={{flex:1}}><div style={{fontSize:12,fontWeight:600,color:c}}>{e.type==='buy'?'BUY':'SELL'} Absorption</div><div style={{fontSize:10,color:'var(--tm-text-muted)'}}>@ {fmtP(e.price)} · fenêtre 30s</div></div>
                  <div style={{fontSize:12,fontWeight:700,color:c,fontFamily:'monospace'}}>{fmtU(Math.abs(e.strength))}</div>
                  <div style={{fontSize:9,color:'var(--tm-text-muted)'}}>{Math.round((Date.now()-e.ts)/1000)}s</div>
                </div>
              })}
            </div>}
          </div>
        </div>

        {/* Traps */}
        <div style={C.card} className="analyse-card-hover"><div style={C.top}/>
          <div style={{padding:C.p}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
              <span className="analyse-section-label" style={{background:'linear-gradient(90deg,rgba(255,149,0,0.08),transparent)',padding:'3px 10px 3px 0',borderLeft:'2px solid rgba(255,149,0,0.5)'}}>
                <span style={{paddingLeft:8}}>⚠️ Liquidity Traps</span>
              </span>
              <span style={{fontSize:11,fontWeight:700,color:'var(--tm-warning)',background:'rgba(var(--tm-warning-rgb,255,149,0),0.12)',padding:'1px 7px',borderRadius:4}}>{traps.length}</span>
            </div>
            {traps.length===0?<div style={{fontSize:12,color:'var(--tm-text-muted)',textAlign:'center',padding:'8px 0'}}>Aucun événement</div>:
            <div style={{display:'flex',flexDirection:'column',gap:5}}>
              {traps.slice(0,5).map(t=>{const typeC={'failedWhalePush':'#EF5350',liquiditySweep:'#42A5F5',breakoutTrap:'var(--tm-warning)'}[t.type as string]||'var(--tm-warning)'
                return<div key={t.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',background:'var(--tm-bg-tertiary)',borderRadius:8}}>
                  <span style={{fontSize:16}}>🛑</span>
                  <div style={{flex:1}}><div style={{fontSize:11,fontWeight:600,color:typeC}}>Failed Whale Push</div><div style={{fontSize:10,color:'var(--tm-text-muted)'}}>@ {fmtP(t.price)}</div></div>
                  <div style={{position:'relative',width:36,height:36,flexShrink:0}}>
                    <svg width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="none" stroke="var(--tm-border)" strokeWidth="3"/><circle cx="18" cy="18" r="15" fill="none" stroke={typeC} strokeWidth="3" strokeDasharray={`${t.conf*94} 94`} strokeLinecap="round" transform="rotate(-90 18 18)"/></svg>
                    <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:700,color:typeC}}>{Math.round(t.conf*100)}%</div>
                  </div>
                  <div style={{fontSize:9,color:'var(--tm-text-muted)'}}>{t.age}s</div>
                </div>
              })}
            </div>}
          </div>
        </div>
      </div>}

      {/* ── STRUCTURE ── */}
      {isCrypto&&mode==='structure'&&<div style={{display:'flex',flexDirection:'column',gap:12,position:'relative',zIndex:1}}>
        <div style={C.card} className="analyse-card-hover"><div style={C.top}/>
          <div style={{padding:C.p}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span className="analyse-section-label" style={{background:'linear-gradient(90deg,rgba(191,90,242,0.08),transparent)',padding:'3px 10px 3px 0',borderLeft:'2px solid rgba(191,90,242,0.5)'}}>
                  <span style={{paddingLeft:8}}>🐋 Whale CVD Structurel</span>
                </span>
                {wtSummary&&<span style={{fontSize:11,fontWeight:700,color:wtSummary.trendColor,background:`${wtSummary.trendColor}15`,padding:'2px 8px',borderRadius:5}}>● {wtSummary.trend}</span>}
              </div>
            </div>
            <div style={{display:'flex',gap:5,marginBottom:12}}>
              {['5m','15m','1h','4h','12h','24h'].map(tf=>(
                <button key={tf} onClick={()=>setWtTf(tf)} style={{padding:'3px 10px',borderRadius:6,fontSize:10,fontWeight:500,cursor:'pointer',border:`1px solid ${wtTf===tf?'#FFA726':'var(--tm-border)'}`,background:wtTf===tf?'rgba(255,167,38,0.12)':'var(--tm-bg-tertiary)',color:wtTf===tf?'#FFA726':'var(--tm-text-muted)'}}>{tf}</button>
              ))}
            </div>
            <div style={{fontSize:9,color:'var(--tm-text-muted)',display:'flex',gap:14,marginBottom:6}}>
              <span style={{color:'rgba(200,200,255,0.7)'}}>─── Whale CVD</span>
              <span style={{color:'#FFA72660'}}>─── EMA-9</span>
              <span style={{color:'rgba(255,255,255,0.2)'}}>── Retail</span>
            </div>
            <WhaleTrendChart pts={wtPts}/>
            {wtSummary&&<div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:6,marginTop:10}}>
              {[{l:'CVD Net',v:`${wtSummary.netCVD>=0?'+':''}${fmtU(wtSummary.netCVD)}`,c:wtSummary.netCVD>=0?'var(--tm-profit)':'var(--tm-loss)'},{l:'Divergence',v:wtSummary.divergence,c:wtSummary.divergence.includes('Hauss')?'var(--tm-profit)':wtSummary.divergence.includes('Baiss')?'var(--tm-loss)':'var(--tm-text-secondary)'},{l:'Momentum',v:`${(wtSummary.momentum*100).toFixed(0)}%`,c:wtSummary.momentum>=0?'var(--tm-profit)':'var(--tm-loss)'},{l:'Dominance',v:'30%',c:'#FFA726'}].map(({l,v,c})=>(
                <div key={l} style={{background:'var(--tm-bg-tertiary)',borderRadius:8,padding:'8px',textAlign:'center'}}><div style={{fontSize:9,color:'var(--tm-text-muted)',marginBottom:2}}>{l}</div><div style={{fontSize:12,fontWeight:600,color:c}}>{v}</div></div>
              ))}
            </div>}
          </div>
        </div>

        {/* Segmented CVD History */}
        <div style={C.card} className="analyse-card-hover"><div style={C.top}/>
          <div style={{padding:C.p}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
              <span className="analyse-section-label" style={{background:'linear-gradient(90deg,rgba(0,229,255,0.08),transparent)',padding:'3px 10px 3px 0',borderLeft:'2px solid rgba(0,229,255,0.4)'}}>
                <span style={{paddingLeft:8}}>📊 CVD par Taille d'Ordre</span>
              </span>
              <span style={{fontSize:10,color:'var(--tm-text-muted)',background:'var(--tm-bg-tertiary)',padding:'1px 7px',borderRadius:4}}>Récent · Futures</span>
              {segHistLoad&&<div style={{width:12,height:12,border:'2px solid #2A2F3E',borderTopColor:'var(--tm-accent)',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>}
            </div>
            <SegmentedCVDHistoryChart pts={segHistPts}/>
          </div>
        </div>
      </div>}

      {/* ── DÉRIVÉS ── */}
      {isCrypto&&mode==='derivees'&&<div style={{display:'flex',flexDirection:'column',gap:12,position:'relative',zIndex:1}}>
        {/* Confluence Card en premier */}
        <DerivativesConfluenceCard symbol={symbol}/>

        {derivLoad&&<div style={{textAlign:'center',padding:24,color:'var(--tm-text-muted)',fontSize:12}}>
          <div style={{width:20,height:20,border:'2px solid #2A2F3E',borderTopColor:'#F59714',borderRadius:'50%',animation:'spin 0.8s linear infinite',margin:'0 auto 8px'}}/>Chargement...
        </div>}

        {oi&&<div style={{...C.card,borderColor:'rgba(245,151,20,0.25)',boxShadow:'0 4px 24px rgba(0,0,0,0.4),0 0 20px rgba(245,151,20,0.05)'}} className="analyse-card-hover">
          <div style={{...C.top,background:'linear-gradient(90deg,transparent,rgba(245,151,20,0.3),transparent)'}}/>
          <div style={{padding:C.p}}>
            <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:12}}>
              <span className="analyse-section-label" style={{background:'linear-gradient(90deg,rgba(245,151,20,0.1),transparent)',padding:'3px 10px 3px 0',borderLeft:'2px solid rgba(245,151,20,0.6)'}}>
                <span style={{paddingLeft:8}}>📊 Open Interest</span>
              </span>
              <span style={{marginLeft:'auto',fontSize:9,fontWeight:700,color:oi.bullish===true?'var(--tm-profit)':oi.bullish===false?'var(--tm-loss)':'var(--tm-text-secondary)',background:`${oi.bullish===true?'var(--tm-profit)':oi.bullish===false?'var(--tm-loss)':'var(--tm-text-secondary)'}`,padding:'1px 7px',borderRadius:4}}>{oi.signal}</span>
            </div>
            <div style={{fontSize:28,fontWeight:700,color:'white',fontFamily:'JetBrains Mono,monospace',letterSpacing:'-0.02em',marginBottom:4}}>{fmtU(oi.usd)}</div>
            <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginBottom:10}}>{oi.btc.toFixed(1)} BTC</div>
            {oi.history.length>4&&<OISparkline vals={oi.history}/>}
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:4,marginTop:10}}>
              {[{l:'Δ1h',v:oi.h1},{l:'Δ4h',v:oi.h4},{l:'Δ24h',v:oi.h24}].map(({l,v})=>{const c=v>0.1?'var(--tm-profit)':v<-0.1?'var(--tm-loss)':'var(--tm-text-secondary)'
                return<div key={l} style={{background:'rgba(0,0,0,0.4)',borderRadius:8,padding:'8px',textAlign:'center'}}><div style={{fontSize:9,color:'var(--tm-text-muted)',marginBottom:2}}>{l}</div><div style={{fontSize:13,fontWeight:700,color:c,fontFamily:'monospace'}}>{v>0?'+':''}{v.toFixed(2)}%</div></div>
              })}
            </div>
          </div>
        </div>}

        {funding&&<div style={{...C.card,borderColor:'rgba(66,165,245,0.25)',boxShadow:'0 4px 24px rgba(0,0,0,0.4),0 0 20px rgba(66,165,245,0.05)'}} className="analyse-card-hover">
          <div style={{...C.top,background:'linear-gradient(90deg,transparent,rgba(66,165,245,0.25),transparent)'}}/>
          <div style={{padding:C.p}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
              <span className="analyse-section-label" style={{background:'linear-gradient(90deg,rgba(66,165,245,0.1),transparent)',padding:'3px 10px 3px 0',borderLeft:'2px solid rgba(66,165,245,0.6)'}}>
                <span style={{paddingLeft:8}}>💸 Funding Rate & Basis</span>
              </span>
              <span style={{fontSize:10,color:'#42A5F5',background:'rgba(66,165,245,0.1)',padding:'2px 8px',borderRadius:5}}>prochain {funding.nextIn}</span>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <div>
                <div style={{fontSize:26,fontWeight:700,fontFamily:'JetBrains Mono,monospace',color:funding.rate>0?'var(--tm-warning)':funding.rate<0?'var(--tm-profit)':'var(--tm-text-secondary)'}}>{funding.rate>0?'+':''}{funding.rate.toFixed(4)}%<span style={{fontSize:11,color:'var(--tm-text-muted)',marginLeft:4}}>/8h</span></div>
                <div style={{fontSize:11,color:'var(--tm-text-muted)'}}>Taux de financement</div>
              </div>
              <div style={{fontSize:12,fontWeight:700,color:funding.isWarning?'var(--tm-loss)':'var(--tm-text-secondary)',background:`${funding.isWarning?'var(--tm-loss)':'var(--tm-text-secondary)'}`,padding:'5px 12px',borderRadius:8,border:`1px solid ${funding.isWarning?'rgba(var(--tm-loss-rgb,255,59,48),0.3)':'var(--tm-border)'}`}}>{funding.bias}</div>
            </div>
            <div style={{height:8,background:'linear-gradient(to right,#22C759,#2A2F3E 40%,#2A2F3E 60%,#FF9500)',borderRadius:4,position:'relative',marginBottom:6}}>
              <div style={{position:'absolute',left:`${Math.min(Math.max((funding.rate+0.1)/0.2*100,0),100)}%`,top:'50%',transform:'translate(-50%,-50%)',width:14,height:14,borderRadius:'50%',background:funding.rate>0.05?'var(--tm-loss)':funding.rate>0.01?'var(--tm-warning)':funding.rate<-0.01?'var(--tm-profit)':'var(--tm-text-secondary)',border:'2px solid #0D1117'}}/>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:9,color:'var(--tm-text-muted)',marginBottom:12}}><span>Short Payés</span><span>Neutre</span><span>Long Payés</span></div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
              {[{l:'Mark Price',v:`$${funding.mark.toFixed(1)}`,c:'var(--tm-text-primary)'},{l:'Index Price',v:`$${funding.index.toFixed(1)}`,c:'var(--tm-text-primary)'},{l:'Basis',v:`${funding.basisPct>0?'+':''}${funding.basisPct.toFixed(3)}%`,c:funding.basisPct>0?'var(--tm-warning)':'var(--tm-profit)'}].map(({l,v,c})=>(
                <div key={l} style={{background:'var(--tm-bg-tertiary)',borderRadius:8,padding:'8px',textAlign:'center'}}><div style={{fontSize:9,color:'var(--tm-text-muted)',marginBottom:2}}>{l}</div><div style={{fontSize:12,fontWeight:600,color:c,fontFamily:'monospace'}}>{v}</div></div>
              ))}
            </div>
          </div>
        </div>}

        {/* L/S Ratio History */}
        {mode === 'derivees' && lsHistory.length > 0 && <div style={{...C.card, borderColor:'rgba(0,229,255,0.15)'}} className="analyse-card-hover">
          <div style={C.top}/>
          <div style={{padding:C.p}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
              <span className="analyse-section-label" style={{background:'linear-gradient(90deg,rgba(0,229,255,0.08),transparent)',padding:'3px 10px 3px 0',borderLeft:'2px solid rgba(0,229,255,0.5)'}}>
                <span style={{paddingLeft:8}}>⚖️ Long / Short Ratio · 24h</span>
              </span>
            </div>
            <LSRatioChart pts={lsHistory}/>
          </div>
        </div>}
      </div>}

      {/* ── ORDER FLOW — footprint chart ── */}
      {isCrypto && mode === 'orderflow' && (
        <div style={{ position:'relative', zIndex:1, height:'calc(100vh - 340px)', minHeight:500, marginBottom:16 }}>
          <FootprintChart symbol={symbol} />
        </div>
      )}

      {/* ── CHARTS TAB ── */}
      {mode === 'charts' && <ChartsTab symbol={symbol} isCrypto={isCrypto}/>}

    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// CHARTS TAB — ChartInspect-style analytics
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// INDICATOR REGISTRY
// ════════════════════════════════════════════════════════════════════════════

type IndicatorCategory = 'performance' | 'risk' | 'onchain' | 'macro' | 'structure'

interface IndicatorDef {
  id: string
  name: string
  description: string
  category: IndicatorCategory
  assets: 'all' | 'crypto' | 'btc'
  component: (props: { symbol: string; isCrypto: boolean }) => React.ReactElement | null
}

const CATEGORY_META: Record<IndicatorCategory, { label: string; color: string; emoji: string }> = {
  performance: { label: 'Performance',  color: '#34C759', emoji: '📈' },
  risk:        { label: 'Risque',       color: '#FF9500', emoji: '⚠️' },
  onchain:     { label: 'On-Chain',     color: '#0A85FF', emoji: '⛓️' },
  macro:       { label: 'Macro',        color: '#BF5AF2', emoji: '🌍' },
  structure:   { label: 'Structure',    color: '#FF453A', emoji: '🏗️' },
}

const INDICATOR_REGISTRY: IndicatorDef[] = [
  {
    id: 'btc-hero',
    name: 'BTC Price + MA50/200',
    description: 'Prix Bitcoin avec moyennes mobiles et zones bull/bear',
    category: 'structure' as IndicatorCategory,
    assets: 'crypto' as const,
    component: ({ symbol, isCrypto }) => <BTCHeroChart symbol={symbol} isCrypto={isCrypto}/>,
  },
  {
    id: 'monthly-returns',
    name: 'Rendements Mensuels',
    description: 'Heatmap calendrier des performances mensuelles',
    category: 'performance',
    assets: 'all',
    component: ({ symbol, isCrypto }) => <MonthlyReturnsHeatmap symbol={symbol} isCrypto={isCrypto}/>,
  },
  {
    id: 'roi-periods',
    name: 'ROI Multi-Périodes',
    description: 'Retour sur investissement sur 7j / 30j / 90j / 1a / YTD',
    category: 'performance',
    assets: 'all',
    component: ({ symbol, isCrypto }) => <ROIPeriodsChart symbol={symbol} isCrypto={isCrypto}/>,
  },
  {
    id: 'price-horizons',
    name: 'Prix vs Historique',
    description: 'Prix actuel vs prix il y a 30 / 90 / 180 / 365 jours',
    category: 'performance',
    assets: 'all',
    component: ({ symbol, isCrypto }) => <PriceHorizonsChart symbol={symbol} isCrypto={isCrypto}/>,
  },
  {
    id: 'death-golden-cross',
    name: 'Death / Golden Cross',
    description: 'Croisements SMA50 / SMA200 avec signaux historiques',
    category: 'structure',
    assets: 'all',
    component: ({ symbol, isCrypto }) => <DeathGoldenCrossChart symbol={symbol} isCrypto={isCrypto}/>,
  },
  {
    id: 'drawdown',
    name: 'Drawdown depuis ATH',
    description: 'Distance au plus haut historique dans le temps',
    category: 'risk',
    assets: 'all',
    component: ({ symbol, isCrypto }) => <DrawdownChart symbol={symbol} isCrypto={isCrypto}/>,
  },
  {
    id: 'sharpe',
    name: 'Sharpe Ratio Glissant',
    description: 'Rendement ajusté au risque sur 365 jours glissants',
    category: 'risk',
    assets: 'all',
    component: ({ symbol, isCrypto }) => <SharpeRatioChart symbol={symbol} isCrypto={isCrypto}/>,
  },
  {
    id: 'mvrv',
    name: 'MVRV Z-Score — BTC',
    description: 'Market Value vs Realized Value · CoinMetrics Community',
    category: 'onchain',
    assets: 'btc',
    component: () => <MVRVZScoreChart/>,
  },
  {
    id: 'txcount',
    name: 'Transactions On-Chain — BTC',
    description: 'Nombre de transactions quotidiennes · CoinMetrics',
    category: 'onchain',
    assets: 'btc',
    component: () => <TxCountChart/>,
  },
  {
    id: 'altseason',
    name: 'Altcoin Season Index',
    description: '% des top altcoins surperformant BTC sur 90 jours',
    category: 'macro',
    assets: 'crypto',
    component: ({ symbol }) => <AltcoinSeasonGauge symbol={symbol}/>,
  },
  {
    id: 'market-breadth',
    name: 'Market Breadth',
    description: '% des top 20 cryptos au-dessus de leur MA200',
    category: 'macro',
    assets: 'crypto',
    component: () => <MarketBreadthChart/>,
  },
  {
    id: 'power-law',
    name: 'Power Law Corridor — BTC',
    description: 'Couloir de valorisation logarithmique depuis 2009',
    category: 'structure',
    assets: 'btc',
    component: () => <PowerLawChart/>,
  },
  {
    id: 'composite-risk',
    name: 'Score de Risque Composite',
    description: 'MVRV + Funding + L/S + Fear & Greed — jauge globale',
    category: 'risk',
    assets: 'btc',
    component: () => <CompositeRiskScore/>,
  },
  {
    id: 'market-intelligence',
    name: 'Market Intelligence',
    description: 'Score marché · Régime · Confluence des signaux',
    category: 'macro' as IndicatorCategory,
    assets: 'crypto' as const,
    component: ({ symbol, isCrypto }) => <MarketIntelligencePanel symbol={symbol} isCrypto={isCrypto}/>,
  },
  {
    id: 'nupl',
    name: 'NUPL — Net Unrealized P&L',
    description: 'Profit/perte non réalisé du réseau Bitcoin',
    category: 'onchain' as IndicatorCategory,
    assets: 'btc' as const,
    component: () => <NUPLChart/>,
  },
  {
    id: 'momentum-composite',
    name: 'Momentum Composite',
    description: 'RSI + Rate of Change + Pente MA — score 0–100',
    category: 'structure' as IndicatorCategory,
    assets: 'all' as const,
    component: ({ symbol, isCrypto }) => <MomentumCompositeChart symbol={symbol} isCrypto={isCrypto}/>,
  },
]

function ChartsTab({ symbol, isCrypto }: { symbol: string; isCrypto: boolean }) {
  const [activeCategory, setActiveCategory] = React.useState<IndicatorCategory | 'all'>('all')

  const isBtc = symbol === 'BTCUSDT' || symbol === 'BTC-USD' || symbol.toUpperCase().startsWith('BTC')

  const visible = INDICATOR_REGISTRY.filter(ind => {
    if (ind.id === 'btc-hero' || ind.id === 'market-intelligence') return false // shown in hero area
    if (ind.assets === 'crypto' && !isCrypto) return false
    if (ind.assets === 'btc'    && !isBtc)   return false
    if (activeCategory !== 'all' && ind.category !== activeCategory) return false
    return true
  })

  const categories: Array<IndicatorCategory | 'all'> = ['all', 'performance', 'risk', 'structure', 'onchain', 'macro']

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20, position:'relative', zIndex:1 }}>
      {/* Hero + Market Intelligence always on top for crypto */}
      {isCrypto && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:16 }}>
          <BTCHeroChart symbol={symbol} isCrypto={isCrypto}/>
          <MarketIntelligencePanel symbol={symbol} isCrypto={isCrypto}/>
        </div>
      )}

      {/* Category filter */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', padding:'4px 0' }}>
        {categories.map(cat => {
          const meta = cat === 'all' ? { label:'Tous', color:'#8E8E93', emoji:'🔭' } : CATEGORY_META[cat]
          const active = activeCategory === cat
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              style={{
                padding:'6px 14px', borderRadius:20, fontSize:11, fontWeight:700,
                fontFamily:'Syne,sans-serif', cursor:'pointer', border:'none',
                background: active ? meta.color : 'rgba(255,255,255,0.06)',
                color: active ? '#fff' : 'rgba(255,255,255,0.5)',
                transition:'all 0.2s',
                letterSpacing:'0.04em',
              }}
            >
              {meta.emoji} {meta.label}
            </button>
          )
        })}
        <div style={{ marginLeft:'auto', fontSize:11, color:'rgba(255,255,255,0.3)', alignSelf:'center' }}>
          {visible.length} indicateur{visible.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Grid */}
      <div style={{
        display:'grid',
        gridTemplateColumns:'repeat(auto-fill, minmax(360px, 1fr))',
        gap:16,
      }}>
        {visible.map(ind => (
          <div key={ind.id}>
            {ind.component({ symbol, isCrypto })}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 1. Monthly Returns Heatmap ────────────────────────────────────────────────
function MonthlyReturnsHeatmap({ symbol, isCrypto }: { symbol: string; isCrypto: boolean }) {
  const [rows, setRows]       = useState<{ year: number; months: (number|null)[] }[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    setLoading(true); setError(false)
    async function load() {
      try {
        let closes: { date: Date; close: number }[] = []

        if (isCrypto) {
          const r   = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1M&limit=60`)
          const raw = await r.json() as [number,string,string,string,string][]
          closes    = raw.map(k => ({ date: new Date(k[0]), close: parseFloat(k[4]) }))
        } else {
          // Yahoo Finance v8 chart — free, works from browser
          const r = await fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1mo&range=5y`,
            { headers: { 'Accept': 'application/json' } }
          )
          const d = await r.json() as {
            chart: { result?: [{ timestamp: number[]; indicators: { quote: [{ close: (number|null)[] }] } }] }
          }
          const res = d.chart.result?.[0]
          if (!res) throw new Error('no result')
          closes = res.timestamp.map((t, i) => ({
            date:  new Date(t * 1000),
            close: res.indicators.quote[0].close[i] ?? 0,
          })).filter(x => x.close > 0)
        }

        // Monthly returns: (close[i] - close[i-1]) / close[i-1] * 100
        const rets: Record<string, number> = {}
        for (let i = 1; i < closes.length; i++) {
          const prev = closes[i-1].close, cur = closes[i].close
          if (!prev || !cur) continue
          const d   = closes[i].date
          rets[`${d.getFullYear()}-${d.getMonth()}`] = ((cur - prev) / prev) * 100
        }

        // Group by year (newest first)
        const years = [...new Set(Object.keys(rets).map(k => +k.split('-')[0]))].sort((a,b) => b-a)
        setRows(years.map(y => ({
          year: y,
          months: Array.from({length:12}, (_, m) => rets[`${y}-${m}`] ?? null),
        })))
        setLoading(false)
      } catch { setError(true); setLoading(false) }
    }
    load()
  }, [symbol, isCrypto])

  const MO = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc']

  function cell(v: number|null): string {
    if (v===null) return 'rgba(255,255,255,0.03)'
    if (v >= 25) return '#006633'; if (v >= 15) return '#008844'
    if (v >= 8)  return '#00AA55'; if (v >= 3)  return '#34C759'
    if (v >= 0)  return '#5AD97F'; if (v >= -3) return '#FF6B6B'
    if (v >= -8) return '#FF453A'; if (v >= -15) return '#CC2200'
    return '#990000'
  }
  function ytd(months: (number|null)[]): number|null {
    const vs = months.filter(v => v!==null) as number[]
    if (!vs.length) return null
    return vs.reduce((a,v) => a*(1+v/100), 1)*100 - 100
  }

  const cardStyle: React.CSSProperties = {
    background:'rgba(13,17,35,0.7)', border:'1px solid rgba(255,255,255,0.08)',
    borderRadius:16, padding:20, backdropFilter:'blur(12px)',
  }

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
        <div style={{width:3,height:20,borderRadius:2,background:'#34C759'}}/>
        <div>
          <div style={{fontSize:14,fontWeight:800,color:'var(--tm-text-primary)',fontFamily:'Syne,sans-serif'}}>
            Rendements Mensuels
          </div>
          <div style={{fontSize:10,color:'var(--tm-text-muted)',marginTop:1}}>
            Performance mensuelle — {symbol}
          </div>
        </div>
        <div style={{marginLeft:'auto',display:'flex',gap:6,flexWrap:'wrap'}}>
          {[['#006633','+25%'],['#34C759','+5%'],['rgba(255,255,255,0.1)','0%'],['#FF453A','-5%'],['#990000','-15%']].map(([bg,l])=>(
            <div key={l} style={{display:'flex',alignItems:'center',gap:4}}>
              <div style={{width:10,height:10,borderRadius:2,background:bg}}/>
              <span style={{fontSize:9,color:'var(--tm-text-muted)'}}>{l}</span>
            </div>
          ))}
        </div>
      </div>

      {loading && (
        <div style={{display:'flex',justifyContent:'center',padding:40}}>
          <div style={{width:24,height:24,borderRadius:'50%',border:'2px solid rgba(0,229,255,0.15)',borderTopColor:'var(--tm-accent)',animation:'spin 0.8s linear infinite'}}/>
        </div>
      )}
      {error && <div style={{textAlign:'center',padding:32,color:'var(--tm-text-muted)',fontSize:13}}>Données indisponibles pour ce symbole</div>}

      {!loading && !error && (
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'separate',borderSpacing:'2px 3px',fontSize:11}}>
            <thead>
              <tr>
                <th style={{textAlign:'left',padding:'2px 10px',color:'rgba(255,255,255,0.4)',fontWeight:600,fontSize:10}}>Année</th>
                {MO.map(m=>(
                  <th key={m} style={{textAlign:'center',padding:'2px 4px',color:'rgba(255,255,255,0.4)',fontWeight:600,fontSize:10,minWidth:46}}>{m}</th>
                ))}
                <th style={{textAlign:'center',padding:'2px 10px',color:'rgba(255,255,255,0.4)',fontWeight:600,fontSize:10}}>YTD</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const total = ytd(row.months)
                return (
                  <tr key={row.year}>
                    <td style={{padding:'3px 10px',fontWeight:700,color:'rgba(255,255,255,0.6)',fontFamily:'Syne,sans-serif',fontSize:12,whiteSpace:'nowrap'}}>{row.year}</td>
                    {row.months.map((v,i)=>(
                      <td key={i} style={{
                        padding:'7px 2px',borderRadius:5,textAlign:'center',
                        background:cell(v),
                        color: v===null?'transparent': Math.abs(v)>3?'rgba(255,255,255,0.95)':'rgba(255,255,255,0.7)',
                        fontWeight:700, fontSize:10,
                        transition:'opacity 0.2s',cursor:'default',
                      }} title={v!==null?`${v>=0?'+':''}${v.toFixed(2)}%`:undefined}>
                        {v!==null?`${v>=0?'+':''}${v.toFixed(1)}%`:''}
                      </td>
                    ))}
                    <td style={{
                      padding:'7px 10px',borderRadius:5,textAlign:'center',
                      background:cell(total),fontWeight:800,
                      color:'rgba(255,255,255,0.95)',fontSize:11,
                    }}>
                      {total!==null?`${total>=0?'+':''}${total.toFixed(1)}%`:'—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── 2. MVRV Z-Score Line Chart (crypto only) ─────────────────────────────────
function MVRVZScoreChart() {
  const [data,    setData]    = useState<{ date: string; mvrv: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  useEffect(() => {
    const start = new Date(Date.now() - 180*86_400_000).toISOString().slice(0,10)
    fetch(`https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMVRVCur&frequency=1d&start_time=${start}`)
      .then(r => r.json())
      .then((d: { data?: { time: string; CapMVRVCur: string }[] }) => {
        const pts = (d.data??[]).map(x => ({ date: x.time.slice(0,10), mvrv: parseFloat(x.CapMVRVCur) })).filter(x=>!isNaN(x.mvrv))
        setData(pts); setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const W = 800, H = 140, PAD = { t:12, b:28, l:50, r:16 }
  const cW = W - PAD.l - PAD.r
  const cH = H - PAD.t - PAD.b

  // Y axis: 0 to max(mvrv, 5)
  const maxMVRV = Math.max(5, ...data.map(d=>d.mvrv)) * 1.05
  const minMVRV = 0

  // Zones: <1 green, 1-2 neutral, 2-3.5 orange, >3.5 red
  const zones: [number,number,string,string][] = [
    [0,   1,   'rgba(52,199,89,0.12)',  '🟢 Sous-évalué'],
    [1,   2,   'rgba(255,255,255,0.04)','⚪ Zone juste'],
    [2,   3.5, 'rgba(255,149,0,0.12)',  '🟠 Haussier'],
    [3.5, maxMVRV,'rgba(255,59,48,0.15)','🔴 Surchauffe'],
  ]

  function yPx(v: number) { return PAD.t + cH - ((v - minMVRV)/(maxMVRV - minMVRV))*cH }
  function xPx(i: number) { return PAD.l + (i/(data.length-1||1))*cW }

  const pts = data.map((d,i) => `${xPx(i).toFixed(1)},${yPx(d.mvrv).toFixed(1)}`).join(' ')
  const cur  = data[data.length-1]?.mvrv
  const prev = data[data.length-2]?.mvrv
  const delta = cur&&prev ? cur-prev : null
  const zone  = cur ? (cur<1?'Sous-évalué':cur<2?'Zone juste':cur<3.5?'Haussier':'Surchauffe') : ''
  const zColor= cur ? (cur<1?'#34C759':cur<2?'#8E8E93':cur<3.5?'#FF9500':'#FF3B30') : '#8E8E93'

  const cardStyle: React.CSSProperties = {
    background:'rgba(13,17,35,0.7)', border:'1px solid rgba(255,255,255,0.08)',
    borderRadius:16, padding:20, backdropFilter:'blur(12px)',
  }
  const yLabels = [0,1,2,3.5,Math.round(maxMVRV*10)/10]

  return (
    <div style={cardStyle}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
        <div style={{width:3,height:20,borderRadius:2,background:zColor}}/>
        <div>
          <div style={{fontSize:14,fontWeight:800,color:'var(--tm-text-primary)',fontFamily:'Syne,sans-serif'}}>MVRV Ratio — BTC</div>
          <div style={{fontSize:10,color:'var(--tm-text-muted)',marginTop:1}}>Market Value / Realized Value · CoinMetrics Community</div>
        </div>
        {cur && (
          <div style={{marginLeft:'auto',textAlign:'right'}}>
            <div style={{fontSize:22,fontWeight:900,color:zColor,fontFamily:'Syne,sans-serif',lineHeight:1}}>{cur.toFixed(3)}</div>
            <div style={{fontSize:11,color:zColor,marginTop:2}}>{zone}</div>
            {delta!==null && <div style={{fontSize:10,color:delta>0?'#34C759':'#FF3B30'}}>{delta>0?'▲':'▼'} {Math.abs(delta).toFixed(3)} 24h</div>}
          </div>
        )}
      </div>

      {/* Zone legend */}
      <div style={{display:'flex',gap:12,marginBottom:10,flexWrap:'wrap'}}>
        {zones.map(([lo,hi,bg,label])=>(
          <div key={label} style={{display:'flex',alignItems:'center',gap:4}}>
            <div style={{width:12,height:8,borderRadius:2,background:bg,border:'1px solid rgba(255,255,255,0.15)'}}/>
            <span style={{fontSize:9,color:'var(--tm-text-muted)'}}>{label} ({lo}–{hi===maxMVRV?'∞':hi})</span>
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{display:'flex',justifyContent:'center',height:H}}>
          <div style={{width:20,height:20,margin:'auto',borderRadius:'50%',border:'2px solid rgba(0,229,255,0.15)',borderTopColor:'var(--tm-accent)',animation:'spin 0.8s linear infinite'}}/>
        </div>
      ) : data.length < 2 ? (
        <div style={{textAlign:'center',height:H,lineHeight:`${H}px`,color:'var(--tm-text-muted)',fontSize:13}}>Données insuffisantes</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'auto',display:'block',cursor:'crosshair'}}
          onMouseMove={(e: React.MouseEvent<SVGSVGElement>) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const idx = Math.round(((e.clientX - rect.left) / rect.width * W - PAD.l) / cW * (data.length - 1))
            setHoverIdx(Math.max(0, Math.min(data.length - 1, idx)))
          }}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {/* Zone backgrounds */}
          {zones.map(([lo,hi,bg])=>{
            const y1=yPx(Math.min(hi,maxMVRV)), y2=yPx(lo)
            return <rect key={lo} x={PAD.l} y={y1} width={cW} height={y2-y1} fill={bg} rx={2}/>
          })}
          {/* Horizontal zone lines */}
          {[1,2,3.5].map(v=>(
            <line key={v} x1={PAD.l} y1={yPx(v)} x2={PAD.l+cW} y2={yPx(v)}
              stroke="rgba(255,255,255,0.12)" strokeWidth={1} strokeDasharray="4 4"/>
          ))}
          {/* Y axis labels */}
          {yLabels.map(v=>(
            <text key={v} x={PAD.l-6} y={yPx(v)+4} textAnchor="end" fill="rgba(255,255,255,0.4)" fontSize={9} fontFamily="JetBrains Mono,monospace">{v}</text>
          ))}
          {/* X axis dates (6 evenly spaced) */}
          {[0,0.2,0.4,0.6,0.8,1].map(f=>{
            const idx = Math.min(data.length-1, Math.round(f*(data.length-1)))
            return <text key={f} x={xPx(idx)} y={H-6} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize={8} fontFamily="JetBrains Mono,monospace">{data[idx]?.date.slice(5)}</text>
          })}
          {/* Gradient fill */}
          <defs>
            <linearGradient id="mvrv-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={zColor} stopOpacity="0.25"/>
              <stop offset="100%" stopColor={zColor} stopOpacity="0"/>
            </linearGradient>
          </defs>
          <polygon points={`${PAD.l},${yPx(0)} ${pts} ${PAD.l+cW},${yPx(0)}`} fill="url(#mvrv-grad)"/>
          {/* Main line */}
          <polyline points={pts} fill="none" stroke={zColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
          {/* Last point dot */}
          {data.length>0&&<circle cx={xPx(data.length-1)} cy={yPx(cur!)} r={4} fill={zColor} stroke="rgba(13,17,35,0.8)" strokeWidth={2}/>}
          {/* Crosshair */}
          {hoverIdx !== null && data[hoverIdx] && (() => {
            const d = data[hoverIdx]
            const cx = xPx(hoverIdx)
            return (
              <g>
                <line x1={cx} y1={PAD.t} x2={cx} y2={PAD.t+cH} stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="3 3"/>
                <circle cx={cx} cy={yPx(d.mvrv)} r={4} fill={zColor} stroke="rgba(8,12,22,0.8)" strokeWidth={2}/>
              </g>
            )
          })()}
        </svg>
      )}
    </div>
  )
}

// ── 3. Altcoin Season Index ───────────────────────────────────────────────────
function AltcoinSeasonGauge({ symbol }: { symbol: string }) {
  const [asi,     setAsi]     = useState<number|null>(null)
  const [loading, setLoading] = useState(true)
  const [beats,   setBeats]   = useState<{ sym:string; ret:number; beatsBtc:boolean }[]>([])

  useEffect(() => {
    const ALTS = ['ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','AVAXUSDT','LINKUSDT','DOTUSDT','MATICUSDT']
    const ALL  = ['BTCUSDT', ...ALTS]

    async function load() {
      try {
        // Fetch 90-day klines for all assets in parallel
        const results = await Promise.all(
          ALL.map(sym =>
            fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1d&limit=91`)
              .then(r => r.json())
              .then((raw: [number,string,string,string,string][]) => ({
                sym,
                ret: raw.length > 1
                  ? ((parseFloat(raw[raw.length-1][4]) - parseFloat(raw[0][4])) / parseFloat(raw[0][4])) * 100
                  : null,
              }))
              .catch(() => ({ sym, ret: null }))
          )
        )

        const btcRet = results[0].ret ?? 0
        const altRets = results.slice(1).filter(r => r.ret !== null) as { sym:string; ret:number }[]
        const beatingBtc = altRets.map(a => ({ sym:a.sym.replace('USDT',''), ret:a.ret, beatsBtc: a.ret > btcRet }))
        const score = altRets.length > 0 ? (beatingBtc.filter(a=>a.beatsBtc).length / altRets.length) * 100 : 50

        setBeats(beatingBtc.sort((a,b) => b.ret-a.ret))
        setAsi(score)
        setLoading(false)
      } catch { setLoading(false) }
    }
    load()
  }, [symbol])

  const label = asi===null?'':asi>=75?'🌙 Alt Season':(asi>=55?'🔵 Tendance Alt':asi>=45?'⚪ Neutre':asi>=25?'🟠 Tendance BTC':'₿ Bitcoin Season')
  const color = asi===null?'#8E8E93':(asi>=55?'#BF5AF2':asi>=45?'#8E8E93':asi>=25?'#FF9500':'#F7931A')

  // Semicircle gauge via SVG arc
  const R=80, CX=120, CY=100
  function arc(pct:number, color:string) {
    const angle = (pct/100)*180 - 180
    const rad   = angle * Math.PI/180
    const x = CX + R*Math.cos(rad), y = CY + R*Math.sin(rad)
    return `M ${CX-R} ${CY} A ${R} ${R} 0 ${pct>50?1:0} 1 ${x.toFixed(1)} ${y.toFixed(1)}`
  }

  const cardStyle: React.CSSProperties = {
    background:'rgba(13,17,35,0.7)', border:'1px solid rgba(255,255,255,0.08)',
    borderRadius:16, padding:20, backdropFilter:'blur(12px)',
  }

  return (
    <div style={cardStyle}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
        <div style={{width:3,height:20,borderRadius:2,background:color}}/>
        <div>
          <div style={{fontSize:14,fontWeight:800,color:'var(--tm-text-primary)',fontFamily:'Syne,sans-serif'}}>Altcoin Season Index</div>
          <div style={{fontSize:10,color:'var(--tm-text-muted)',marginTop:1}}>% des top altcoins surperformant BTC sur 90 jours</div>
        </div>
      </div>

      {loading ? (
        <div style={{display:'flex',justifyContent:'center',height:120}}>
          <div style={{width:20,height:20,margin:'auto',borderRadius:'50%',border:'2px solid rgba(0,229,255,0.15)',borderTopColor:'var(--tm-accent)',animation:'spin 0.8s linear infinite'}}/>
        </div>
      ) : (
        <div style={{display:'flex',gap:24,alignItems:'flex-start',flexWrap:'wrap'}}>
          {/* Gauge */}
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',minWidth:180}}>
            <svg viewBox="0 0 240 120" style={{width:220,height:110}}>
              {/* Background arc (track) */}
              <path d={`M ${CX-R} ${CY} A ${R} ${R} 0 0 1 ${CX+R} ${CY}`}
                fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={14} strokeLinecap="round"/>
              {/* Zone colors */}
              {([[0,25,'#F7931A'],[25,45,'#FF9500'],[45,55,'#8E8E93'],[55,75,'#0A85FF'],[75,100,'#BF5AF2']] as [number,number,string][]).map(([from,to,c])=>(
                <path key={from} d={`M ${CX-R} ${CY} A ${R} ${R} 0 ${to>50?1:0} 1 ${(CX+R*Math.cos(((from/100)*180-180)*Math.PI/180)).toFixed(1)} ${(CY+R*Math.sin(((from/100)*180-180)*Math.PI/180)).toFixed(1)}`}
                  fill="none" stroke={c} strokeWidth={5} opacity={0.25} strokeLinecap="butt"/>
              ))}
              {/* Progress arc */}
              {asi!==null&&<path d={arc(asi,color)} fill="none" stroke={color} strokeWidth={14} strokeLinecap="round"/>}
              {/* Needle dot */}
              {asi!==null&&<circle cx={CX+R*Math.cos(((asi/100)*180-180)*Math.PI/180)} cy={CY+R*Math.sin(((asi/100)*180-180)*Math.PI/180)} r={6} fill={color} stroke="rgba(13,17,35,0.8)" strokeWidth={2}/>}
              {/* Center text */}
              <text x={CX} y={CY-6} textAnchor="middle" fill={color} fontSize={26} fontWeight="900" fontFamily="Syne,sans-serif">{asi!==null?Math.round(asi):'–'}</text>
              <text x={CX} y={CY+10} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize={9}>/ 100</text>
              {/* Labels */}
              <text x={CX-R-4} y={CY+14} textAnchor="middle" fill="#F7931A" fontSize={8}>BTC</text>
              <text x={CX+R+4} y={CY+14} textAnchor="middle" fill="#BF5AF2" fontSize={8}>ALT</text>
            </svg>
            <div style={{fontSize:13,fontWeight:700,color,marginTop:-8}}>{label}</div>
          </div>

          {/* Altcoin performance table */}
          <div style={{flex:1,minWidth:200}}>
            <div style={{fontSize:10,fontWeight:700,color:'rgba(255,255,255,0.4)',marginBottom:8,letterSpacing:'0.08em'}}>PERFORMANCE 90J vs BTC</div>
            <div style={{display:'flex',flexDirection:'column',gap:3}}>
              {['BTCUSDT',...beats.map(b=>b.sym+'USDT')].slice(0,10).map((sym,i)=>{
                const isBtc = i===0
                const b     = isBtc ? null : beats[i-1]
                const ret   = isBtc ? (beats.length?null:null) : b?.ret
                const btcRet_= beats.length>0?(beats.reduce((a,b)=>a,0)):null
                return (
                  <div key={sym} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 8px',borderRadius:8,background:isBtc?'rgba(247,147,26,0.08)':b?.beatsBtc?'rgba(52,199,89,0.06)':'rgba(255,59,48,0.06)'}}>
                    <div style={{fontSize:10,fontWeight:700,color:isBtc?'#F7931A':b?.beatsBtc?'#34C759':'#FF3B30',width:40,fontFamily:'JetBrains Mono,monospace'}}>
                      {isBtc?'₿ BTC':b?.sym}
                    </div>
                    {!isBtc&&b&&(
                      <>
                        <div style={{flex:1,height:4,borderRadius:2,background:'rgba(255,255,255,0.06)',overflow:'hidden'}}>
                          <div style={{height:'100%',borderRadius:2,width:`${Math.min(100,Math.abs(b.ret)/50*100)}%`,background:b.beatsBtc?'#34C759':'#FF3B30'}}/>
                        </div>
                        <div style={{fontSize:10,fontWeight:700,color:b.beatsBtc?'#34C759':'#FF3B30',width:52,textAlign:'right',fontFamily:'JetBrains Mono,monospace'}}>
                          {b.ret>=0?'+':''}{b.ret.toFixed(1)}%
                        </div>
                        <div style={{fontSize:11}}>{b.beatsBtc?'✓':'✗'}</div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// NEW INDICATOR COMPONENTS
// ════════════════════════════════════════════════════════════════════════════

// Shared helpers
const CARD_STYLE: React.CSSProperties = {
  background:'rgba(13,17,35,0.7)', border:'1px solid rgba(255,255,255,0.08)',
  borderRadius:16, padding:20, backdropFilter:'blur(12px)',
}
function CardHeader({ color, title, sub, value, valueSub }: { color:string; title:string; sub:string; value?:string; valueSub?:string }) {
  return (
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
      <div style={{width:3,height:20,borderRadius:2,background:color}}/>
      <div>
        <div style={{fontSize:14,fontWeight:800,color:'var(--tm-text-primary)',fontFamily:'Syne,sans-serif'}}>{title}</div>
        <div style={{fontSize:10,color:'var(--tm-text-muted)',marginTop:1}}>{sub}</div>
      </div>
      {value && (
        <div style={{marginLeft:'auto',textAlign:'right'}}>
          <div style={{fontSize:20,fontWeight:900,color,fontFamily:'Syne,sans-serif',lineHeight:1}}>{value}</div>
          {valueSub && <div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginTop:2}}>{valueSub}</div>}
        </div>
      )}
    </div>
  )
}
function Spinner() {
  return (
    <div style={{display:'flex',justifyContent:'center',padding:40}}>
      <div style={{width:22,height:22,borderRadius:'50%',border:'2px solid rgba(0,229,255,0.12)',borderTopColor:'var(--tm-accent)',animation:'spin 0.8s linear infinite'}}/>
    </div>
  )
}
async function fetchCloses(symbol: string, isCrypto: boolean, days: number): Promise<number[]> {
  if (isCrypto) {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=${days + 1}`)
    const raw = await r.json() as [number,string,string,string,string][]
    return raw.map(k => parseFloat(k[4]))
  } else {
    const range = days <= 100 ? '6mo' : days <= 400 ? '2y' : '5y'
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${range}`)
    const d = await r.json() as { chart: { result?: [{ indicators: { quote: [{ close: (number|null)[] }] } }] } }
    const closes = d.chart.result?.[0]?.indicators.quote[0].close ?? []
    return (closes.filter(v => v !== null) as number[]).slice(-days - 1)
  }
}

// ── ROI Multi-Périodes ────────────────────────────────────────────────────────
function ROIPeriodsChart({ symbol, isCrypto }: { symbol: string; isCrypto: boolean }) {
  type Period = { label: string; days: number; roi: number | null }
  const [periods, setPeriods] = useState<Period[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const PERIODS = [
      { label:'7j',  days:7   },
      { label:'30j', days:30  },
      { label:'90j', days:90  },
      { label:'180j',days:180 },
      { label:'1a',  days:365 },
    ]
    fetchCloses(symbol, isCrypto, 400)
      .then(closes => {
        const cur = closes[closes.length - 1]
        const filled = PERIODS.map(p => ({
          ...p,
          roi: closes.length > p.days
            ? ((cur - closes[closes.length - 1 - p.days]) / closes[closes.length - 1 - p.days]) * 100
            : null,
        }))
        setPeriods(filled)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [symbol, isCrypto])

  const maxAbs = Math.max(1, ...periods.filter(p => p.roi !== null).map(p => Math.abs(p.roi!)))

  return (
    <div style={CARD_STYLE}>
      <CardHeader color="#34C759" title="ROI Multi-Périodes" sub={`Retour sur investissement — ${symbol}`}/>
      {loading ? <Spinner/> : (
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {periods.map(p => {
            const roi = p.roi
            if (roi === null) return null
            const pct = (Math.abs(roi) / maxAbs) * 100
            const positive = roi >= 0
            const color = positive ? '#34C759' : '#FF3B30'
            return (
              <div key={p.label} style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:36,fontSize:11,fontWeight:700,color:'rgba(255,255,255,0.5)',fontFamily:'JetBrains Mono,monospace',flexShrink:0}}>{p.label}</div>
                <div style={{flex:1,height:22,borderRadius:6,background:'rgba(255,255,255,0.04)',overflow:'hidden',position:'relative'}}>
                  <div style={{
                    position:'absolute',
                    [positive?'left':'right']:0,
                    width:`${pct/2}%`, height:'100%',
                    background:`${color}33`, borderRadius:6,
                    transition:'width 0.6s ease',
                  }}/>
                  <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',paddingLeft:8}}>
                    <span style={{fontSize:12,fontWeight:800,color,fontFamily:'JetBrains Mono,monospace'}}>
                      {positive?'+':''}{roi.toFixed(2)}%
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Prix vs Historique ────────────────────────────────────────────────────────
function PriceHorizonsChart({ symbol, isCrypto }: { symbol: string; isCrypto: boolean }) {
  type Horizon = { label: string; days: number; price: number | null; chg: number | null }
  const [horizons, setHorizons] = useState<Horizon[]>([])
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchCloses(symbol, isCrypto, 400)
      .then(closes => {
        const cur = closes[closes.length - 1]
        setCurrentPrice(cur)
        const HORIZONS = [
          { label:'Il y a 30j',  days:30  },
          { label:'Il y a 90j',  days:90  },
          { label:'Il y a 180j', days:180 },
          { label:'Il y a 1 an', days:365 },
        ]
        setHorizons(HORIZONS.map(h => {
          const past = closes.length > h.days ? closes[closes.length - 1 - h.days] : null
          return { ...h, price: past, chg: past ? ((cur - past) / past) * 100 : null }
        }))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [symbol, isCrypto])

  function fmt(n: number): string {
    if (n >= 1e9) return `$${(n/1e9).toFixed(2)}B`
    if (n >= 1e6) return `$${(n/1e6).toFixed(2)}M`
    if (n >= 1000) return `$${n.toLocaleString('en', {maximumFractionDigits:2})}`
    return `$${n.toFixed(4)}`
  }

  return (
    <div style={CARD_STYLE}>
      <CardHeader
        color="#0A85FF"
        title="Prix vs Historique"
        sub={`Prix actuel vs périodes passées — ${symbol}`}
        value={currentPrice ? fmt(currentPrice) : undefined}
        valueSub="Prix actuel"
      />
      {loading ? <Spinner/> : (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {horizons.map(h => {
            if (!h.price || !h.chg) return null
            const positive = h.chg >= 0
            const color = positive ? '#34C759' : '#FF3B30'
            return (
              <div key={h.label} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 12px',borderRadius:10,background:'rgba(255,255,255,0.03)'}}>
                <div style={{fontSize:12,color:'rgba(255,255,255,0.5)',fontWeight:600}}>{h.label}</div>
                <div style={{display:'flex',gap:12,alignItems:'center'}}>
                  <div style={{fontSize:12,color:'rgba(255,255,255,0.4)',fontFamily:'JetBrains Mono,monospace'}}>{fmt(h.price)}</div>
                  <div style={{fontSize:13,fontWeight:800,color,fontFamily:'JetBrains Mono,monospace',minWidth:64,textAlign:'right'}}>
                    {positive?'+':''}{h.chg.toFixed(2)}%
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Drawdown depuis ATH ───────────────────────────────────────────────────────
function DrawdownChart({ symbol, isCrypto }: { symbol: string; isCrypto: boolean }) {
  const [data, setData]       = useState<{ i:number; dd:number }[]>([])
  const [currentDd, setCurrentDd] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  useEffect(() => {
    setLoading(true)
    fetchCloses(symbol, isCrypto, 730)
      .then(closes => {
        let ath = -Infinity
        const dd: { i:number; dd:number }[] = []
        for (let i = 0; i < closes.length; i++) {
          if (closes[i] > ath) ath = closes[i]
          dd.push({ i, dd: ath > 0 ? ((closes[i] - ath) / ath) * 100 : 0 })
        }
        setData(dd)
        setCurrentDd(dd[dd.length - 1]?.dd ?? null)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [symbol, isCrypto])

  const W = 720, H = 120, PAD = { t:10, b:24, l:44, r:12 }
  const cW = W - PAD.l - PAD.r
  const cH = H - PAD.t - PAD.b
  const minDd = Math.min(-5, ...data.map(d => d.dd)) * 1.05
  function yPx(v: number) { return PAD.t + cH - ((v - minDd) / (0 - minDd)) * cH }
  function xPx(i: number) { return PAD.l + (i / (data.length - 1 || 1)) * cW }
  const pts = data.map(d => `${xPx(d.i).toFixed(1)},${yPx(d.dd).toFixed(1)}`).join(' ')
  const ddColor = currentDd !== null ? (currentDd > -10 ? '#34C759' : currentDd > -25 ? '#FF9500' : currentDd > -50 ? '#FF453A' : '#FF3B30') : '#8E8E93'

  return (
    <div style={CARD_STYLE}>
      <CardHeader
        color={ddColor}
        title="Drawdown depuis ATH"
        sub={`Distance au plus haut historique — ${symbol}`}
        value={currentDd !== null ? `${currentDd.toFixed(1)}%` : undefined}
        valueSub="Drawdown actuel"
      />
      {loading ? <Spinner/> : data.length < 2 ? (
        <div style={{textAlign:'center',padding:32,color:'var(--tm-text-muted)',fontSize:13}}>Données insuffisantes</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'auto',display:'block',cursor:'crosshair'}}
          onMouseMove={(e: React.MouseEvent<SVGSVGElement>) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const idx = Math.round(((e.clientX - rect.left) / rect.width * W - PAD.l) / cW * (data.length - 1))
            setHoverIdx(Math.max(0, Math.min(data.length - 1, idx)))
          }}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id={`dd-grad-${symbol}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ddColor} stopOpacity="0.3"/>
              <stop offset="100%" stopColor={ddColor} stopOpacity="0.02"/>
            </linearGradient>
          </defs>
          {/* Zero line */}
          <line x1={PAD.l} y1={yPx(0)} x2={PAD.l+cW} y2={yPx(0)} stroke="rgba(255,255,255,0.12)" strokeWidth={1} strokeDasharray="4 3"/>
          {/* -25% and -50% guides */}
          {[-25,-50].map(v => v >= minDd && (
            <g key={v}>
              <line x1={PAD.l} y1={yPx(v)} x2={PAD.l+cW} y2={yPx(v)} stroke="rgba(255,255,255,0.07)" strokeWidth={1} strokeDasharray="3 4"/>
              <text x={PAD.l-4} y={yPx(v)+4} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize={8} fontFamily="JetBrains Mono,monospace">{v}%</text>
            </g>
          ))}
          {/* Y labels */}
          {[0, Math.round(minDd/2), Math.round(minDd)].map(v => (
            <text key={v} x={PAD.l-4} y={yPx(v)+4} textAnchor="end" fill="rgba(255,255,255,0.25)" fontSize={8} fontFamily="JetBrains Mono,monospace">{v}%</text>
          ))}
          {/* Fill */}
          <polygon points={`${PAD.l},${yPx(0)} ${pts} ${xPx(data.length-1)},${yPx(0)}`} fill={`url(#dd-grad-${symbol})`}/>
          {/* Line */}
          <polyline points={pts} fill="none" stroke={ddColor} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
          {/* Dot */}
          <circle cx={xPx(data.length-1)} cy={yPx(data[data.length-1].dd)} r={4} fill={ddColor} stroke="rgba(13,17,35,0.8)" strokeWidth={2}/>
          {/* Crosshair */}
          {hoverIdx !== null && data[hoverIdx] && (() => {
            const d = data[hoverIdx]
            const cx = xPx(hoverIdx)
            return (
              <g>
                <line x1={cx} y1={PAD.t} x2={cx} y2={PAD.t+cH} stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="3 3"/>
                <circle cx={cx} cy={yPx(d.dd)} r={4} fill={ddColor} stroke="rgba(8,12,22,0.8)" strokeWidth={2}/>
              </g>
            )
          })()}
        </svg>
      )}
    </div>
  )
}

// ── Sharpe Ratio Glissant ─────────────────────────────────────────────────────
function SharpeRatioChart({ symbol, isCrypto }: { symbol: string; isCrypto: boolean }) {
  const [data, setData]     = useState<{ i:number; sharpe:number }[]>([])
  const [current, setCurrent] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  useEffect(() => {
    setLoading(true)
    fetchCloses(symbol, isCrypto, 400)
      .then(closes => {
        const WINDOW = 365
        const pts: { i:number; sharpe:number }[] = []
        for (let i = WINDOW; i < closes.length; i++) {
          const slice = closes.slice(i - WINDOW, i)
          const returns = slice.slice(1).map((v, j) => (v - slice[j]) / slice[j])
          const mean = returns.reduce((a, b) => a + b, 0) / returns.length
          const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length
          const std = Math.sqrt(variance)
          const sharpe = std > 0 ? (mean / std) * Math.sqrt(365) : 0
          pts.push({ i: i - WINDOW, sharpe })
        }
        setData(pts)
        setCurrent(pts[pts.length - 1]?.sharpe ?? null)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [symbol, isCrypto])

  const W = 720, H = 120, PAD = { t:10, b:24, l:44, r:12 }
  const cW = W - PAD.l - PAD.r
  const cH = H - PAD.t - PAD.b
  const minV = Math.min(-1, ...data.map(d => d.sharpe)) * 1.1
  const maxV = Math.max(3, ...data.map(d => d.sharpe)) * 1.05
  function yPx(v: number) { return PAD.t + cH - ((v - minV) / (maxV - minV)) * cH }
  function xPx(i: number) { return PAD.l + (i / (data.length - 1 || 1)) * cW }
  const pts = data.map((d, i) => `${xPx(i).toFixed(1)},${yPx(d.sharpe).toFixed(1)}`).join(' ')
  const sColor = current !== null ? (current > 2 ? '#34C759' : current > 0.5 ? '#0A85FF' : current > 0 ? '#FF9500' : '#FF3B30') : '#8E8E93'
  const sLabel = current !== null ? (current > 2 ? 'Excellent' : current > 0.5 ? 'Bon' : current > 0 ? 'Faible' : 'Négatif') : ''

  return (
    <div style={CARD_STYLE}>
      <CardHeader
        color={sColor}
        title="Sharpe Ratio Glissant (365j)"
        sub={`Rendement ajusté au risque annualisé — ${symbol}`}
        value={current !== null ? current.toFixed(2) : undefined}
        valueSub={sLabel}
      />
      {loading ? <Spinner/> : data.length < 2 ? (
        <div style={{textAlign:'center',padding:32,color:'var(--tm-text-muted)',fontSize:13}}>Données insuffisantes (minimum 1 an)</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'auto',display:'block',cursor:'crosshair'}}
          onMouseMove={(e: React.MouseEvent<SVGSVGElement>) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const idx = Math.round(((e.clientX - rect.left) / rect.width * W - PAD.l) / cW * (data.length - 1))
            setHoverIdx(Math.max(0, Math.min(data.length - 1, idx)))
          }}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id={`sh-grad-${symbol}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={sColor} stopOpacity="0.25"/>
              <stop offset="100%" stopColor={sColor} stopOpacity="0.02"/>
            </linearGradient>
          </defs>
          {/* Zero line */}
          <line x1={PAD.l} y1={yPx(0)} x2={PAD.l+cW} y2={yPx(0)} stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="4 3"/>
          {/* 1.0 guide */}
          {maxV > 1 && <line x1={PAD.l} y1={yPx(1)} x2={PAD.l+cW} y2={yPx(1)} stroke="rgba(52,199,89,0.2)" strokeWidth={1} strokeDasharray="3 4"/>}
          {/* Y labels */}
          {[Math.round(minV), 0, 1, Math.round(maxV)].filter((v,i,a)=>a.indexOf(v)===i).map(v => (
            <text key={v} x={PAD.l-4} y={yPx(v)+4} textAnchor="end" fill="rgba(255,255,255,0.25)" fontSize={8} fontFamily="JetBrains Mono,monospace">{v}</text>
          ))}
          {/* Fill above zero */}
          <polygon points={`${PAD.l},${yPx(0)} ${pts} ${xPx(data.length-1)},${yPx(0)}`} fill={`url(#sh-grad-${symbol})`}/>
          <polyline points={pts} fill="none" stroke={sColor} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx={xPx(data.length-1)} cy={yPx(data[data.length-1].sharpe)} r={4} fill={sColor} stroke="rgba(13,17,35,0.8)" strokeWidth={2}/>
          {/* Crosshair */}
          {hoverIdx !== null && data[hoverIdx] && (() => {
            const d = data[hoverIdx]
            const cx = xPx(hoverIdx)
            return (
              <g>
                <line x1={cx} y1={PAD.t} x2={cx} y2={PAD.t+cH} stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="3 3"/>
                <circle cx={cx} cy={yPx(d.sharpe)} r={4} fill={sColor} stroke="rgba(8,12,22,0.8)" strokeWidth={2}/>
              </g>
            )
          })()}
        </svg>
      )}
    </div>
  )
}

// ── Death / Golden Cross ──────────────────────────────────────────────────────
function DeathGoldenCrossChart({ symbol, isCrypto }: { symbol: string; isCrypto: boolean }) {
  type Pt = { i:number; price:number; sma50:number|null; sma200:number|null }
  const [data, setData]       = useState<Pt[]>([])
  const [crosses, setCrosses] = useState<{ i:number; type:'golden'|'death' }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchCloses(symbol, isCrypto, 400)
      .then(closes => {
        function sma(arr: number[], i: number, n: number): number | null {
          if (i < n - 1) return null
          return arr.slice(i - n + 1, i + 1).reduce((a,b) => a + b, 0) / n
        }
        const pts: Pt[] = closes.map((price, i) => ({
          i, price,
          sma50:  sma(closes, i, 50),
          sma200: sma(closes, i, 200),
        }))
        // Detect crosses
        const cx: { i:number; type:'golden'|'death' }[] = []
        for (let i = 1; i < pts.length; i++) {
          const prev = pts[i-1], cur = pts[i]
          if (!prev.sma50 || !prev.sma200 || !cur.sma50 || !cur.sma200) continue
          if (prev.sma50 <= prev.sma200 && cur.sma50 > cur.sma200) cx.push({ i, type:'golden' })
          if (prev.sma50 >= prev.sma200 && cur.sma50 < cur.sma200) cx.push({ i, type:'death' })
        }
        setData(pts)
        setCrosses(cx)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [symbol, isCrypto])

  const W = 720, H = 140, PAD = { t:12, b:24, l:52, r:12 }
  const cW = W - PAD.l - PAD.r
  const cH = H - PAD.t - PAD.b
  const prices = data.map(d => d.price)
  const minP = Math.min(...prices) * 0.97
  const maxP = Math.max(...prices) * 1.03
  function yPx(v: number) { return PAD.t + cH - ((v - minP) / (maxP - minP)) * cH }
  function xPx(i: number) { return PAD.l + (i / (data.length - 1 || 1)) * cW }
  const pricePts = data.map(d => `${xPx(d.i).toFixed(1)},${yPx(d.price).toFixed(1)}`).join(' ')
  const sma50Pts = data.filter(d => d.sma50 !== null).map(d => `${xPx(d.i).toFixed(1)},${yPx(d.sma50!).toFixed(1)}`).join(' ')
  const sma200Pts = data.filter(d => d.sma200 !== null).map(d => `${xPx(d.i).toFixed(1)},${yPx(d.sma200!).toFixed(1)}`).join(' ')
  const lastCross = crosses[crosses.length - 1]
  const crossColor = lastCross?.type === 'golden' ? '#FFD60A' : lastCross?.type === 'death' ? '#FF3B30' : '#8E8E93'

  return (
    <div style={CARD_STYLE}>
      <CardHeader
        color={crossColor}
        title="Death / Golden Cross"
        sub={`SMA 50 / SMA 200 — ${symbol}`}
        value={lastCross ? (lastCross.type === 'golden' ? '✨ Golden' : '💀 Death') : '—'}
        valueSub="Dernier signal"
      />
      {/* Legend */}
      <div style={{display:'flex',gap:14,marginBottom:10}}>
        {[['rgba(255,255,255,0.4)','Prix'],['#FFD60A','SMA 50'],['#BF5AF2','SMA 200'],['#FFD60A','⚡ Golden Cross'],['#FF3B30','💀 Death Cross']].map(([c,l])=>(
          <div key={l} style={{display:'flex',alignItems:'center',gap:4}}>
            <div style={{width:16,height:2,background:c,borderRadius:1}}/>
            <span style={{fontSize:9,color:'rgba(255,255,255,0.4)'}}>{l}</span>
          </div>
        ))}
      </div>
      {loading ? <Spinner/> : data.length < 200 ? (
        <div style={{textAlign:'center',padding:32,color:'var(--tm-text-muted)',fontSize:13}}>Données insuffisantes (minimum 200 jours)</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'auto',display:'block'}}>
          {/* Cross markers */}
          {crosses.map(cx => (
            <line key={cx.i} x1={xPx(cx.i)} y1={PAD.t} x2={xPx(cx.i)} y2={PAD.t+cH}
              stroke={cx.type==='golden'?'rgba(255,214,10,0.3)':'rgba(255,59,48,0.3)'} strokeWidth={1.5} strokeDasharray="3 3"/>
          ))}
          {/* Price line */}
          <polyline points={pricePts} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1.5}/>
          {/* SMA lines */}
          {sma50Pts  && <polyline points={sma50Pts}  fill="none" stroke="#FFD60A" strokeWidth={1.5} opacity={0.85}/>}
          {sma200Pts && <polyline points={sma200Pts} fill="none" stroke="#BF5AF2" strokeWidth={1.5} opacity={0.85}/>}
          {/* Cross symbols */}
          {crosses.slice(-3).map(cx => (
            <text key={cx.i} x={xPx(cx.i)} y={PAD.t+10} textAnchor="middle" fontSize={12}>
              {cx.type === 'golden' ? '⚡' : '💀'}
            </text>
          ))}
        </svg>
      )}
    </div>
  )
}

// ── Transactions On-Chain BTC ─────────────────────────────────────────────────
function TxCountChart() {
  const [data, setData]       = useState<{ date:string; count:number }[]>([])
  const [loading, setLoading] = useState(true)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  useEffect(() => {
    const start = new Date(Date.now() - 180*86_400_000).toISOString().slice(0,10)
    fetch(`https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=TxCnt&frequency=1d&start_time=${start}`)
      .then(r => r.json())
      .then((d: { data?: { time:string; TxCnt:string }[] }) => {
        const pts = (d.data ?? []).map(x => ({ date: x.time.slice(0,10), count: parseInt(x.TxCnt) })).filter(x => !isNaN(x.count))
        setData(pts)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const W = 720, H = 120, PAD = { t:10, b:24, l:52, r:12 }
  const cW = W - PAD.l - PAD.r
  const cH = H - PAD.t - PAD.b
  const counts = data.map(d => d.count)
  const minC = Math.min(...counts) * 0.95 || 0
  const maxC = Math.max(...counts) * 1.05 || 1
  function yPx(v: number) { return PAD.t + cH - ((v - minC) / (maxC - minC)) * cH }
  function xPx(i: number) { return PAD.l + (i / (data.length - 1 || 1)) * cW }
  const pts = data.map((d, i) => `${xPx(i).toFixed(1)},${yPx(d.count).toFixed(1)}`).join(' ')
  const cur = data[data.length - 1]?.count
  const avg = data.length ? Math.round(data.reduce((a,d) => a+d.count, 0)/data.length) : 0

  return (
    <div style={CARD_STYLE}>
      <CardHeader
        color="#0A85FF"
        title="Transactions On-Chain — BTC"
        sub="Nombre de transactions quotidiennes · CoinMetrics Community"
        value={cur ? `${(cur/1000).toFixed(0)}K` : undefined}
        valueSub={`Moy 180j: ${(avg/1000).toFixed(0)}K`}
      />
      {loading ? <Spinner/> : data.length < 2 ? (
        <div style={{textAlign:'center',padding:32,color:'var(--tm-text-muted)',fontSize:13}}>Données indisponibles</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'auto',display:'block',cursor:'crosshair'}}
          onMouseMove={(e: React.MouseEvent<SVGSVGElement>) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const idx = Math.round(((e.clientX - rect.left) / rect.width * W - PAD.l) / cW * (data.length - 1))
            setHoverIdx(Math.max(0, Math.min(data.length - 1, idx)))
          }}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id="txc-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0A85FF" stopOpacity="0.3"/>
              <stop offset="100%" stopColor="#0A85FF" stopOpacity="0.02"/>
            </linearGradient>
          </defs>
          {/* Average line */}
          {avg > 0 && <line x1={PAD.l} y1={yPx(avg)} x2={PAD.l+cW} y2={yPx(avg)} stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="4 3"/>}
          {/* Y labels */}
          {[minC, avg, maxC].filter(v=>v>0).map(v => (
            <text key={v} x={PAD.l-4} y={yPx(v)+4} textAnchor="end" fill="rgba(255,255,255,0.25)" fontSize={8} fontFamily="JetBrains Mono,monospace">{`${(v/1000).toFixed(0)}K`}</text>
          ))}
          {/* X dates */}
          {[0, 0.25, 0.5, 0.75, 1].map(f => {
            const idx = Math.min(data.length-1, Math.round(f*(data.length-1)))
            return <text key={f} x={xPx(idx)} y={H-6} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize={8} fontFamily="JetBrains Mono,monospace">{data[idx]?.date.slice(5)}</text>
          })}
          <polygon points={`${PAD.l},${yPx(minC)} ${pts} ${xPx(data.length-1)},${yPx(minC)}`} fill="url(#txc-grad)"/>
          <polyline points={pts} fill="none" stroke="#0A85FF" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx={xPx(data.length-1)} cy={yPx(cur!)} r={4} fill="#0A85FF" stroke="rgba(13,17,35,0.8)" strokeWidth={2}/>
          {/* Crosshair */}
          {hoverIdx !== null && data[hoverIdx] && (() => {
            const d = data[hoverIdx]
            const cx = xPx(hoverIdx)
            return (
              <g>
                <line x1={cx} y1={PAD.t} x2={cx} y2={PAD.t+cH} stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="3 3"/>
                <circle cx={cx} cy={yPx(d.count)} r={4} fill="#0A85FF" stroke="rgba(8,12,22,0.8)" strokeWidth={2}/>
              </g>
            )
          })()}
        </svg>
      )}
    </div>
  )
}

// ── Market Breadth (crypto) ───────────────────────────────────────────────────
function MarketBreadthChart() {
  const [pct, setPct]         = useState<number | null>(null)
  const [items, setItems]     = useState<{ sym:string; price:number; ma200:number; above:boolean }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const TOP20 = ['BTCUSDT','ETHUSDT','BNBUSDT','XRPUSDT','SOLUSDT','ADAUSDT','DOGEUSDT','TRXUSDT','AVAXUSDT','LINKUSDT',
                   'TONUSDT','DOTUSDT','MATICUSDT','NEARUSDT','LTCUSDT','UNIUSDT','APTUSDT','ICPUSDT','XLMUSDT','ETCUSDT']
    Promise.all(
      TOP20.map(sym =>
        fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1d&limit=201`)
          .then(r => r.json())
          .then((raw: [number,string,string,string,string][]) => {
            const closes = raw.map(k => parseFloat(k[4]))
            const price  = closes[closes.length - 1]
            const ma200  = closes.length >= 200 ? closes.slice(-200).reduce((a,b)=>a+b,0)/200 : null
            return { sym: sym.replace('USDT',''), price, ma200, above: ma200 !== null && price > ma200 }
          })
          .catch(() => ({ sym: sym.replace('USDT',''), price: 0, ma200: null, above: false }))
      )
    ).then(results => {
      const valid = results.filter(r => r.ma200 !== null) as { sym:string; price:number; ma200:number; above:boolean }[]
      const aboveCount = valid.filter(r => r.above).length
      setPct(valid.length > 0 ? (aboveCount / valid.length) * 100 : null)
      setItems(valid.sort((a,b) => (b.above?1:0)-(a.above?1:0)))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const bColor = pct !== null ? (pct >= 70 ? '#34C759' : pct >= 50 ? '#0A85FF' : pct >= 30 ? '#FF9500' : '#FF3B30') : '#8E8E93'
  const bLabel = pct !== null ? (pct >= 70 ? 'Marché haussier' : pct >= 50 ? 'Neutre / haussier' : pct >= 30 ? 'Neutre / baissier' : 'Marché baissier') : ''

  return (
    <div style={CARD_STYLE}>
      <CardHeader
        color={bColor}
        title="Market Breadth"
        sub="% des top 20 cryptos au-dessus de leur MA200"
        value={pct !== null ? `${Math.round(pct)}%` : undefined}
        valueSub={bLabel}
      />
      {loading ? <Spinner/> : (
        <>
          {/* Progress bar */}
          <div style={{height:8,borderRadius:4,background:'rgba(255,255,255,0.07)',overflow:'hidden',marginBottom:14}}>
            <div style={{height:'100%',borderRadius:4,width:`${pct??0}%`,background:bColor,transition:'width 0.8s ease'}}/>
          </div>
          {/* Grid */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(72px,1fr))',gap:6}}>
            {items.map(item => (
              <div key={item.sym} style={{
                padding:'6px 8px',borderRadius:8,textAlign:'center',
                background: item.above ? 'rgba(52,199,89,0.1)' : 'rgba(255,59,48,0.08)',
                border: `1px solid ${item.above ? 'rgba(52,199,89,0.2)' : 'rgba(255,59,48,0.15)'}`,
              }}>
                <div style={{fontSize:11,fontWeight:700,color:item.above?'#34C759':'#FF3B30',fontFamily:'JetBrains Mono,monospace'}}>{item.sym}</div>
                <div style={{fontSize:9,color:'rgba(255,255,255,0.4)',marginTop:2}}>{item.above?'▲ MA200':'▼ MA200'}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Power Law Corridor BTC ────────────────────────────────────────────────────
function PowerLawChart() {
  const GENESIS = new Date('2009-01-03').getTime()
  const [data, setData]       = useState<{ date:string; price:number; fair:number; upper:number; lower:number }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1M&limit=72')
      .then(r => r.json())
      .then((raw: [number,string,string,string,string][]) => {
        const pts = raw.map(k => {
          const ts = k[0]
          const days = (ts - GENESIS) / 86_400_000
          const fair  = Math.pow(10, -17.351) * Math.pow(days, 5.82)
          const upper = fair * 10
          const lower = fair / 8
          return { date: new Date(ts).toISOString().slice(0,7), price: parseFloat(k[4]), fair, upper, lower }
        })
        setData(pts)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const W = 720, H = 160, PAD = { t:12, b:28, l:56, r:12 }
  const cW = W - PAD.l - PAD.r
  const cH = H - PAD.t - PAD.b

  // Log scale
  const allVals = data.flatMap(d => [d.price, d.upper]).filter(v => v > 0)
  const logMin = allVals.length ? Math.log10(Math.min(...allVals)) * 0.98 : 1
  const logMax = allVals.length ? Math.log10(Math.max(...allVals)) * 1.02 : 6
  function yPx(v: number) { return v > 0 ? PAD.t + cH - ((Math.log10(v) - logMin) / (logMax - logMin)) * cH : PAD.t + cH }
  function xPx(i: number) { return PAD.l + (i / (data.length - 1 || 1)) * cW }

  function makePts(arr: number[]) { return arr.map((v, i) => `${xPx(i).toFixed(1)},${yPx(v).toFixed(1)}`).join(' ') }

  const cur = data[data.length - 1]
  const ratio = cur ? cur.price / cur.fair : null
  const rColor = ratio ? (ratio > 5 ? '#FF3B30' : ratio > 2 ? '#FF9500' : ratio > 0.7 ? '#34C759' : '#0A85FF') : '#8E8E93'
  const rLabel = ratio ? (ratio > 5 ? 'Surévalué' : ratio > 2 ? 'Haussier' : ratio > 0.7 ? 'Juste valeur' : 'Sous-évalué') : ''

  return (
    <div style={CARD_STYLE}>
      <CardHeader
        color={rColor}
        title="Power Law Corridor — BTC"
        sub="Couloir log P = 10^(−17.351) × jours^5.82 depuis 2009"
        value={cur ? `×${(cur.price/cur.fair).toFixed(2)} fair` : undefined}
        valueSub={rLabel}
      />
      <div style={{display:'flex',gap:14,marginBottom:10}}>
        {[['#FFD60A','Prix'],['#34C759','Valeur juste'],['rgba(255,255,255,0.2)','Couloir ×10 / ÷8']].map(([c,l])=>(
          <div key={l} style={{display:'flex',alignItems:'center',gap:4}}>
            <div style={{width:16,height:2,background:c,borderRadius:1}}/>
            <span style={{fontSize:9,color:'rgba(255,255,255,0.4)'}}>{l}</span>
          </div>
        ))}
      </div>
      {loading ? <Spinner/> : data.length < 2 ? (
        <div style={{textAlign:'center',padding:32,color:'var(--tm-text-muted)',fontSize:13}}>Données indisponibles</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'auto',display:'block'}}>
          {/* Corridor fill */}
          <polygon
            points={[...data.map((_,i) => `${xPx(i).toFixed(1)},${yPx(data[i].upper).toFixed(1)}`),
                     ...[...data].reverse().map((_,ri) => `${xPx(data.length-1-ri).toFixed(1)},${yPx(data[data.length-1-ri].lower).toFixed(1)}`)]
              .join(' ')}
            fill="rgba(255,255,255,0.04)" stroke="none"
          />
          {/* Upper / Lower bounds */}
          <polyline points={makePts(data.map(d=>d.upper))} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="4 3"/>
          <polyline points={makePts(data.map(d=>d.lower))} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="4 3"/>
          {/* Fair value */}
          <polyline points={makePts(data.map(d=>d.fair))} fill="none" stroke="#34C759" strokeWidth={1.5} strokeDasharray="5 3"/>
          {/* Price */}
          <polyline points={makePts(data.map(d=>d.price))} fill="none" stroke="#FFD60A" strokeWidth={2} strokeLinecap="round"/>
          {/* Y log labels */}
          {[10,100,1000,10000,100000,1000000].filter(v => Math.log10(v) >= logMin && Math.log10(v) <= logMax).map(v => (
            <text key={v} x={PAD.l-4} y={yPx(v)+4} textAnchor="end" fill="rgba(255,255,255,0.25)" fontSize={8} fontFamily="JetBrains Mono,monospace">
              {v>=1e6?`${v/1e6}M`:v>=1e3?`${v/1e3}K`:v}
            </text>
          ))}
          {/* Dot */}
          <circle cx={xPx(data.length-1)} cy={yPx(cur!.price)} r={4} fill="#FFD60A" stroke="rgba(13,17,35,0.8)" strokeWidth={2}/>
        </svg>
      )}
    </div>
  )
}

// ── Score de Risque Composite ─────────────────────────────────────────────────
function CompositeRiskScore() {
  type Factor = { label:string; value:number|null; score:number; weight:number; color:string; detail:string }
  const [factors, setFactors] = useState<Factor[]>([])
  const [composite, setComposite] = useState<number | null>(null)
  const [loading, setLoading]  = useState(true)

  useEffect(() => {
    async function load() {
      const results: Factor[] = []

      // 1. MVRV
      try {
        const start = new Date(Date.now()-7*86_400_000).toISOString().slice(0,10)
        const r = await fetch(`https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMVRVCur&frequency=1d&start_time=${start}`)
        const d = await r.json() as { data?: { CapMVRVCur:string }[] }
        const mvrv = parseFloat(d.data?.[d.data.length-1]?.CapMVRVCur ?? '')
        if (!isNaN(mvrv)) {
          const score = mvrv < 1 ? 10 : mvrv < 2 ? 30 : mvrv < 3 ? 55 : mvrv < 4 ? 75 : 90
          results.push({ label:'MVRV Ratio', value:mvrv, score, weight:0.3, color:'#0A85FF', detail:`${mvrv.toFixed(2)}` })
        }
      } catch { /* ignore */ }

      // 2. Funding Rate
      try {
        const r = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT')
        const d = await r.json() as { fundingRate:string }
        const fr = parseFloat(d.fundingRate) * 100
        if (!isNaN(fr)) {
          const score = fr < -0.02 ? 15 : fr < -0.01 ? 25 : fr < 0.01 ? 50 : fr < 0.02 ? 65 : fr < 0.05 ? 80 : 95
          results.push({ label:'Funding Rate', value:fr, score, weight:0.25, color:'#FF9500', detail:`${fr.toFixed(4)}%/8h` })
        }
      } catch { /* ignore */ }

      // 3. L/S Ratio
      try {
        const r = await fetch('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1')
        const d = await r.json() as [{ longShortRatio:string }]
        const ls = parseFloat(d[0]?.longShortRatio)
        if (!isNaN(ls)) {
          const score = ls < 0.8 ? 20 : ls < 0.95 ? 40 : ls < 1.05 ? 50 : ls < 1.2 ? 65 : ls < 1.5 ? 80 : 90
          results.push({ label:'L/S Ratio', value:ls, score, weight:0.2, color:'#BF5AF2', detail:`${ls.toFixed(3)}` })
        }
      } catch { /* ignore */ }

      // 4. Fear & Greed
      try {
        const r = await fetch('https://api.alternative.me/fng/?limit=1')
        const d = await r.json() as { data:[{ value:string }] }
        const fg = parseInt(d.data[0]?.value)
        if (!isNaN(fg)) {
          const score = fg < 20 ? 10 : fg < 40 ? 30 : fg < 60 ? 50 : fg < 80 ? 70 : 90
          results.push({ label:'Fear & Greed', value:fg, score, weight:0.25, color:'#FF453A', detail:`${fg}/100` })
        }
      } catch { /* ignore */ }

      setFactors(results)
      if (results.length > 0) {
        const totalW = results.reduce((a, f) => a + f.weight, 0)
        const weighted = results.reduce((a, f) => a + f.score * f.weight, 0) / totalW
        setComposite(Math.round(weighted))
      }
      setLoading(false)
    }
    load()
  }, [])

  const cColor = composite !== null ? (composite < 30 ? '#34C759' : composite < 50 ? '#0A85FF' : composite < 70 ? '#FF9500' : '#FF3B30') : '#8E8E93'
  const cLabel = composite !== null ? (composite < 30 ? 'Zone d\'achat' : composite < 50 ? 'Faible risque' : composite < 70 ? 'Risque modéré' : 'Zone de vente') : ''

  // Gauge arc
  const R=70, CX=100, CY=90
  function arc(pct: number) {
    const angle = (pct/100)*180 - 180
    const rad = angle * Math.PI/180
    return `M ${CX-R} ${CY} A ${R} ${R} 0 ${pct>50?1:0} 1 ${(CX+R*Math.cos(rad)).toFixed(1)} ${(CY+R*Math.sin(rad)).toFixed(1)}`
  }

  return (
    <div style={CARD_STYLE}>
      <CardHeader color={cColor} title="Score de Risque Composite" sub="MVRV + Funding + L/S + Fear & Greed — 0=Bas 100=Extrême"/>
      {loading ? <Spinner/> : (
        <div style={{display:'flex',gap:20,alignItems:'flex-start',flexWrap:'wrap'}}>
          {/* Gauge */}
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',minWidth:160}}>
            <svg viewBox="0 0 200 110" style={{width:180,height:100}}>
              <path d={`M ${CX-R} ${CY} A ${R} ${R} 0 0 1 ${CX+R} ${CY}`} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={12}/>
              {composite!==null&&<path d={arc(composite)} fill="none" stroke={cColor} strokeWidth={12} strokeLinecap="round"/>}
              <text x={CX} y={CY-8} textAnchor="middle" fill={cColor} fontSize={28} fontWeight="900" fontFamily="Syne,sans-serif">{composite??'–'}</text>
              <text x={CX} y={CY+8} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize={9}>/ 100</text>
              <text x={CX-R-2} y={CY+12} textAnchor="middle" fill="#34C759" fontSize={7}>BAS</text>
              <text x={CX+R+2} y={CY+12} textAnchor="middle" fill="#FF3B30" fontSize={7}>HAUT</text>
            </svg>
            <div style={{fontSize:12,fontWeight:700,color:cColor,marginTop:-8}}>{cLabel}</div>
          </div>
          {/* Factor breakdown */}
          <div style={{flex:1,minWidth:180,display:'flex',flexDirection:'column',gap:8}}>
            {factors.map(f => (
              <div key={f.label} style={{display:'flex',alignItems:'center',gap:8}}>
                <div style={{width:90,fontSize:10,color:'rgba(255,255,255,0.5)',flexShrink:0}}>{f.label}</div>
                <div style={{flex:1,height:16,borderRadius:4,background:'rgba(255,255,255,0.05)',overflow:'hidden',position:'relative'}}>
                  <div style={{position:'absolute',left:0,top:0,height:'100%',width:`${f.score}%`,background:`${f.color}44`,borderRadius:4,transition:'width 0.6s'}}/>
                  <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',paddingLeft:6}}>
                    <span style={{fontSize:9,fontWeight:700,color:f.color,fontFamily:'JetBrains Mono,monospace'}}>{f.detail}</span>
                  </div>
                </div>
                <div style={{fontSize:10,fontWeight:700,color:f.color,width:28,textAlign:'right',fontFamily:'JetBrains Mono,monospace'}}>{f.score}</div>
              </div>
            ))}
            {factors.length === 0 && <div style={{fontSize:12,color:'var(--tm-text-muted)',padding:8}}>Données indisponibles</div>}
          </div>
        </div>
      )}
    </div>
  )
}

// ── BTC Hero Chart (price + MA50/MA200 + bull/bear zones + cross markers) ────
function BTCHeroChart({ symbol = 'BTCUSDT', isCrypto = true }: { symbol?: string; isCrypto?: boolean }) {
  type Candle = { ts: number; close: number; ma50: number | null; ma200: number | null }
  const [data, setData]       = useState<Candle[]>([])
  const [loading, setLoading] = useState(true)
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)
  const [priceChange, setPriceChange]   = useState<number | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [timeframe, setTimeframe] = useState<90 | 180 | 365 | 730>(365)

  useEffect(() => {
    setLoading(true)
    setData([])
    const sym = isCrypto ? symbol : null
    const url = sym
      ? `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1d&limit=400`
      : `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2y`

    fetch(url)
      .then(r => r.json())
      .then((raw: any) => {
        let closes: number[] = []
        let timestamps: number[] = []

        if (isCrypto) {
          const arr = raw as [number,string,string,string,string][]
          closes = arr.map(k => parseFloat(k[4]))
          timestamps = arr.map(k => k[0])
        } else {
          const res = raw?.chart?.result?.[0]
          if (!res) throw new Error('no data')
          const rawCloses = (res.indicators.quote[0].close as (number|null)[])
          const rawTs = res.timestamp as number[]
          rawTs.forEach((t: number, i: number) => {
            const c = rawCloses[i]
            if (c != null && c > 0) { closes.push(c); timestamps.push(t * 1000) }
          })
        }

        const candles: Candle[] = closes.map((close, i) => {
          const ma50  = i >= 49  ? closes.slice(i-49,  i+1).reduce((a,b)=>a+b,0)/50  : null
          const ma200 = i >= 199 ? closes.slice(i-199, i+1).reduce((a,b)=>a+b,0)/200 : null
          return { ts: timestamps[i] ?? Date.now(), close, ma50, ma200 }
        })
        setData(candles)
        const last = closes[closes.length-1]
        const prev = closes[closes.length-2]
        setCurrentPrice(last)
        setPriceChange(prev ? ((last-prev)/prev)*100 : null)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [symbol, isCrypto])

  // Slice data to selected timeframe
  const displayData = data.slice(-timeframe)

  // Detect crosses from displayData
  const crosses: { i: number; type: 'golden' | 'death' }[] = []
  for (let i = 1; i < displayData.length; i++) {
    const prev = displayData[i-1], cur = displayData[i]
    if (!prev.ma50 || !prev.ma200 || !cur.ma50 || !cur.ma200) continue
    if (prev.ma50 <= prev.ma200 && cur.ma50 > cur.ma200) crosses.push({ i, type: 'golden' })
    if (prev.ma50 >= prev.ma200 && cur.ma50 < cur.ma200) crosses.push({ i, type: 'death' })
  }

  const W = 900, H = 200, PAD = { t:16, b:28, l:60, r:16 }
  const cW = W - PAD.l - PAD.r
  const cH = H - PAD.t - PAD.b
  const prices = displayData.map(d => d.close)
  const minP = (prices.length ? Math.min(...prices) * 0.97 : 1) || 1
  const maxP = (prices.length ? Math.max(...prices) * 1.03 : 2) || 2
  function yPx(v: number) { return PAD.t + cH - ((v - minP) / (maxP - minP)) * cH }
  function xPx(i: number) { return PAD.l + (i / (displayData.length - 1 || 1)) * cW }

  const pricePts = displayData.map((d,i) => `${xPx(i).toFixed(1)},${yPx(d.close).toFixed(1)}`).join(' ')
  const ma50Pts  = displayData.filter(d=>d.ma50!==null).map((d, _, arr) => {
    const i = displayData.indexOf(d)
    return `${xPx(i).toFixed(1)},${yPx(d.ma50!).toFixed(1)}`
  }).join(' ')
  const ma200Pts = displayData.filter(d=>d.ma200!==null).map((d) => {
    const i = displayData.indexOf(d)
    return `${xPx(i).toFixed(1)},${yPx(d.ma200!).toFixed(1)}`
  }).join(' ')

  const lastMa200 = displayData[displayData.length-1]?.ma200 ?? null
  const isBull = lastMa200 !== null && currentPrice !== null && currentPrice > lastMa200
  const accentColor = isBull ? '#34C759' : '#FF3B30'
  const regimeLabel = isBull ? '🐂 Bull Market' : '🐻 Bear Market'

  // Y-axis labels (5 evenly spaced)
  const ySteps = 5
  const yLabels = Array.from({length:ySteps}, (_, i) => minP + (maxP-minP) * (i/(ySteps-1)))

  function fmtPrice(p: number) {
    if (p >= 1000) return `$${(p/1000).toFixed(0)}K`
    return `$${p.toFixed(0)}`
  }

  const curCandle = displayData[displayData.length-1]
  const allPrices = data.map(d => d.close)
  const ath = allPrices.length ? Math.max(...allPrices) : 0
  const ddPct = ath > 0 && curCandle ? ((curCandle.close - ath) / ath) * 100 : 0
  const symLabel = symbol.replace('USDT','').replace('-USD','')

  return (
    <div style={{ background:'rgba(8,12,22,0.9)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:20, padding:24, backdropFilter:'blur(12px)', boxShadow:'0 0 60px rgba(0,0,0,0.4)', position:'relative', overflow:'hidden' }}>
      {/* Top border gradient */}
      <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:`linear-gradient(90deg, transparent, ${accentColor}, transparent)` }}/>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:16 }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:24 }}>{symLabel.slice(0,4)}</span>
            <div>
              <div style={{ fontSize:16, fontWeight:900, color:'#F0F2F5', fontFamily:'Syne,sans-serif' }}>{symbol} Price Chart</div>
              <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginTop:2 }}>MA50 · MA200 · Bull/Bear Zones · Signaux de croisement</div>
            </div>
          </div>
        </div>
        <div style={{ textAlign:'right' }}>
          {currentPrice && (
            <>
              <div style={{ fontSize:28, fontWeight:900, color:accentColor, fontFamily:'JetBrains Mono,monospace', lineHeight:1 }}>
                ${currentPrice.toLocaleString('en', { maximumFractionDigits:0 })}
              </div>
              <div style={{ fontSize:12, color: priceChange && priceChange>=0 ? '#34C759':'#FF3B30', marginTop:4, fontFamily:'JetBrains Mono,monospace' }}>
                {priceChange !== null ? `${priceChange>=0?'+':''}${priceChange.toFixed(2)}% 24h` : ''}
              </div>
              <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginTop:4 }}>{regimeLabel} · DD: {ddPct.toFixed(1)}%</div>
            </>
          )}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display:'flex', gap:16, marginBottom:12, flexWrap:'wrap' }}>
        {[
          { color:'rgba(255,255,255,0.7)', label:`Prix ${symLabel}` },
          { color:'#FF9500', label:'MA50' },
          { color:'#BF5AF2', label:'MA200' },
          { color:'rgba(52,199,89,0.25)', label:'Zone Bull (> MA200)' },
          { color:'rgba(255,59,48,0.2)', label:'Zone Bear (< MA200)' },
          { color:'#FFD60A', label:'⚡ Golden Cross' },
          { color:'#FF3B30', label:'💀 Death Cross' },
        ].map(({ color, label }) => (
          <div key={label} style={{ display:'flex', alignItems:'center', gap:5 }}>
            <div style={{ width:14, height:3, borderRadius:2, background:color }}/>
            <span style={{ fontSize:9, color:'rgba(255,255,255,0.4)', fontFamily:'JetBrains Mono,monospace' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Timeframe selector */}
      <div style={{ display:'flex', gap:6, marginBottom:12 }}>
        {([90, 180, 365, 730] as const).map(tf => (
          <button key={tf} onClick={() => setTimeframe(tf)} style={{
            padding:'4px 12px', borderRadius:20, fontSize:10, fontWeight:700, cursor:'pointer', border:'none',
            background: timeframe === tf ? 'rgba(0,229,255,0.2)' : 'rgba(255,255,255,0.06)',
            color: timeframe === tf ? '#00E5FF' : 'rgba(255,255,255,0.4)',
            transition:'all 0.2s',
          }}>
            {tf === 90 ? '3M' : tf === 180 ? '6M' : tf === 365 ? '1A' : '2A'}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', height:H }}>
          <div style={{ width:24, height:24, margin:'auto', borderRadius:'50%', border:'2px solid rgba(0,229,255,0.15)', borderTopColor:'#00E5FF', animation:'spin 0.8s linear infinite' }}/>
        </div>
      ) : displayData.length < 2 ? (
        <div style={{ textAlign:'center', padding:40, color:'rgba(255,255,255,0.3)', fontSize:13 }}>Données indisponibles</div>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width:'100%', height:'auto', display:'block', cursor:'crosshair' }}
          onMouseMove={(e: React.MouseEvent<SVGSVGElement>) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const svgX = ((e.clientX - rect.left) / rect.width) * W
            const dataX = svgX - PAD.l
            const idx = Math.round((dataX / cW) * (displayData.length - 1))
            setHoverIdx(Math.max(0, Math.min(displayData.length - 1, idx)))
          }}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id="btc-hero-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={accentColor} stopOpacity="0.2"/>
              <stop offset="100%" stopColor={accentColor} stopOpacity="0.01"/>
            </linearGradient>
            <clipPath id="chart-clip">
              <rect x={PAD.l} y={PAD.t} width={cW} height={cH}/>
            </clipPath>
          </defs>

          {/* Bull/Bear background zones */}
          {(() => {
            const zones: { x1:number; x2:number; bull:boolean }[] = []
            let zoneStart = -1, zoneBull = false
            for (let i = 0; i < displayData.length; i++) {
              const d = displayData[i]
              if (!d.ma200) continue
              const bull = d.close > d.ma200
              if (zoneStart === -1) { zoneStart = i; zoneBull = bull }
              else if (bull !== zoneBull) {
                zones.push({ x1:xPx(zoneStart), x2:xPx(i), bull:zoneBull })
                zoneStart = i; zoneBull = bull
              }
            }
            if (zoneStart >= 0) zones.push({ x1:xPx(zoneStart), x2:xPx(displayData.length-1), bull:zoneBull })
            return zones.map((z,idx) => (
              <rect key={idx} x={z.x1} y={PAD.t} width={z.x2-z.x1} height={cH}
                fill={z.bull ? 'rgba(52,199,89,0.06)' : 'rgba(255,59,48,0.06)'} clipPath="url(#chart-clip)"/>
            ))
          })()}

          {/* Cross markers */}
          {crosses.slice(-5).map(cx => (
            <g key={cx.i}>
              <line x1={xPx(cx.i)} y1={PAD.t} x2={xPx(cx.i)} y2={PAD.t+cH}
                stroke={cx.type==='golden' ? 'rgba(255,214,10,0.4)' : 'rgba(255,59,48,0.4)'}
                strokeWidth={1.5} strokeDasharray="4 3"/>
              <text x={xPx(cx.i)} y={PAD.t+12} textAnchor="middle" fontSize={14}>
                {cx.type === 'golden' ? '⚡' : '💀'}
              </text>
            </g>
          ))}

          {/* Y-axis labels */}
          {yLabels.map(v => (
            <text key={v} x={PAD.l-6} y={yPx(v)+4} textAnchor="end" fill="rgba(255,255,255,0.25)"
              fontSize={8} fontFamily="JetBrains Mono,monospace">{fmtPrice(v)}</text>
          ))}

          {/* Area fill */}
          <polygon points={`${PAD.l},${yPx(minP)} ${pricePts} ${PAD.l+cW},${yPx(minP)}`}
            fill="url(#btc-hero-grad)" clipPath="url(#chart-clip)"/>

          {/* MA200 */}
          {ma200Pts && <polyline points={ma200Pts} fill="none" stroke="#BF5AF2" strokeWidth={2}
            strokeLinecap="round" strokeLinejoin="round" clipPath="url(#chart-clip)"/>}
          {/* MA50 */}
          {ma50Pts && <polyline points={ma50Pts} fill="none" stroke="#FF9500" strokeWidth={1.5}
            strokeDasharray="6 3" strokeLinecap="round" clipPath="url(#chart-clip)"/>}
          {/* Price */}
          <polyline points={pricePts} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth={1.5}
            strokeLinecap="round" strokeLinejoin="round" clipPath="url(#chart-clip)"/>
          {/* Last dot */}
          {curCandle && (
            <circle cx={xPx(displayData.length-1)} cy={yPx(curCandle.close)} r={5}
              fill={accentColor} stroke="rgba(8,12,22,0.9)" strokeWidth={2}
              style={{ filter:`drop-shadow(0 0 6px ${accentColor})` }}/>
          )}

          {/* X-axis dates */}
          {[0, 0.25, 0.5, 0.75, 1].map(f => {
            const idx = Math.min(displayData.length-1, Math.round(f*(displayData.length-1)))
            return (
              <text key={f} x={xPx(idx)} y={H-4} textAnchor="middle" fill="rgba(255,255,255,0.2)"
                fontSize={8} fontFamily="JetBrains Mono,monospace">
                {new Date(displayData[idx]?.ts ?? 0).toLocaleDateString('fr-FR', { month:'short', year:'2-digit' })}
              </text>
            )
          })}

          {/* Crosshair + tooltip */}
          {hoverIdx !== null && (() => {
            const d = displayData[hoverIdx]
            if (!d) return null
            const cx = xPx(hoverIdx)
            const cy = yPx(d.close)
            const date = new Date(d.ts).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'2-digit' })
            const tooltipX = cx > W * 0.7 ? cx - 145 : cx + 10
            const tooltipY = PAD.t + 10
            const tooltipH = d.ma50 && d.ma200 ? 64 : d.ma50 || d.ma200 ? 52 : 40
            return (
              <g>
                <line x1={cx} y1={PAD.t} x2={cx} y2={PAD.t+cH} stroke="rgba(255,255,255,0.25)" strokeWidth={1} strokeDasharray="3 3"/>
                <line x1={PAD.l} y1={cy} x2={PAD.l+cW} y2={cy} stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="3 3"/>
                <rect x={0} y={cy - 8} width={PAD.l - 2} height={16} fill="rgba(0,0,0,0.7)" rx={3}/>
                <text x={PAD.l - 4} y={cy + 4} textAnchor="end" fill="rgba(255,255,255,0.9)" fontSize={8} fontFamily="JetBrains Mono,monospace">{fmtPrice(d.close)}</text>
                <rect x={tooltipX} y={tooltipY} width={140} height={tooltipH} fill="rgba(8,12,22,0.95)" stroke="rgba(0,229,255,0.3)" strokeWidth={1} rx={6}/>
                <text x={tooltipX + 8} y={tooltipY + 14} fill="rgba(255,255,255,0.6)" fontSize={8} fontFamily="JetBrains Mono,monospace">{date}</text>
                <text x={tooltipX + 8} y={tooltipY + 27} fill="rgba(255,255,255,0.9)" fontSize={9} fontWeight="bold" fontFamily="JetBrains Mono,monospace">Prix: {fmtPrice(d.close)}</text>
                {d.ma50 && <text x={tooltipX + 8} y={tooltipY + 40} fill="#FF9500" fontSize={8} fontFamily="JetBrains Mono,monospace">MA50: {fmtPrice(d.ma50)}</text>}
                {d.ma200 && <text x={tooltipX + 8} y={tooltipY + (d.ma50 ? 53 : 40)} fill="#BF5AF2" fontSize={8} fontFamily="JetBrains Mono,monospace">MA200: {fmtPrice(d.ma200)}</text>}
                <circle cx={cx} cy={cy} r={5} fill="rgba(255,255,255,0.9)" stroke="rgba(8,12,22,0.8)" strokeWidth={2}/>
              </g>
            )
          })()}
        </svg>
      )}
    </div>
  )
}

// ── Market Intelligence Panel (Score + Régime + Signal Confluence) ─────────
function MarketIntelligencePanel({ symbol = 'BTCUSDT', isCrypto = true }: { symbol?: string; isCrypto?: boolean }) {
  type RegimeName = 'Capitulation' | 'Recovery' | 'Expansion' | 'Distribution' | 'Compression' | 'Chargement…'
  const [score, setScore]   = useState<number | null>(null)
  const [fg, setFg]         = useState<number | null>(null)
  const [btcChange, setBtcChange] = useState<number | null>(null)
  const [mvrv, setMvrv]     = useState<number | null>(null)
  const [funding, setFunding] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const tickerSym = isCrypto ? symbol : 'BTCUSDT'
        const [fgRes, btcRes, mvrvRes, frRes] = await Promise.allSettled([
          fetch('https://api.alternative.me/fng/?limit=1').then(r=>r.json()),
          fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${tickerSym}`).then(r=>r.json()),
          fetch(`https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMVRVCur&frequency=1d&start_time=${new Date(Date.now()-5*86_400_000).toISOString().slice(0,10)}`).then(r=>r.json()),
          fetch('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT').then(r=>r.json()),
        ])

        let fgVal: number|null = null
        let btcChg: number|null = null
        let mvrvVal: number|null = null
        let frVal: number|null = null

        if (fgRes.status === 'fulfilled') {
          const v = parseInt((fgRes.value as any)?.data?.[0]?.value ?? '')
          fgVal = isNaN(v) ? null : v
        }
        if (btcRes.status === 'fulfilled') {
          const v = parseFloat((btcRes.value as any)?.priceChangePercent)
          btcChg = isNaN(v) ? null : v
        }
        if (mvrvRes.status === 'fulfilled') {
          const d = (mvrvRes.value as any)?.data
          if (d?.length) {
            const v = parseFloat(d[d.length-1].CapMVRVCur)
            mvrvVal = isNaN(v) ? null : v
          }
        }
        if (frRes.status === 'fulfilled') {
          const v = parseFloat((frRes.value as any)?.fundingRate)
          frVal = isNaN(v) ? null : v * 100
        }

        setFg(fgVal)
        setBtcChange(btcChg)
        setMvrv(mvrvVal)
        setFunding(frVal)

        // Compute composite score (0-100)
        let s = 50
        if (fgVal !== null && !isNaN(fgVal))     s += (fgVal - 50) * 0.35
        if (btcChg !== null && !isNaN(btcChg))   s += Math.max(-15, Math.min(15, btcChg)) * 0.5
        if (mvrvVal !== null && !isNaN(mvrvVal))  s += Math.max(-20, Math.min(20, (mvrvVal - 2) * 10))
        if (frVal !== null && !isNaN(frVal))      s += Math.max(-10, Math.min(10, frVal * 50))
        const finalScore = isNaN(s) ? null : Math.max(0, Math.min(100, Math.round(s)))
        setScore(finalScore)
        setLoading(false)
      } catch { setLoading(false) }
    }
    load()
  }, [symbol, isCrypto])

  const regime: RegimeName = score === null ? 'Chargement…'
    : score < 20 ? 'Capitulation'
    : score < 35 ? 'Recovery'
    : score < 55 ? 'Compression'
    : score < 75 ? 'Expansion'
    : 'Distribution'

  const regimeColor: Record<RegimeName, string> = {
    'Capitulation': '#FF3B30',
    'Recovery':     '#FF9500',
    'Compression':  '#8E8E93',
    'Expansion':    '#34C759',
    'Distribution': '#BF5AF2',
    'Chargement…':  '#8E8E93',
  }

  const regimeDesc: Record<RegimeName, string> = {
    'Capitulation': 'Panique généralisée · Zone d\'accumulation historique',
    'Recovery':     'Reprise timide · Sentiment fragile en amélioration',
    'Compression':  'Marché indécis · Attente d\'un catalyseur directionnel',
    'Expansion':    'Momentum haussier · Sentiment favorable croissant',
    'Distribution': 'Euphorie potentielle · Prudence recommandée',
    'Chargement…':  '',
  }

  const scoreColor = score === null ? '#8E8E93'
    : score < 20 ? '#FF3B30'
    : score < 40 ? '#FF9500'
    : score < 60 ? '#8E8E93'
    : score < 80 ? '#34C759'
    : '#BF5AF2'

  const scoreLabel = score === null ? '—'
    : score < 20 ? 'Extreme Fear'
    : score < 40 ? 'Bearish'
    : score < 60 ? 'Neutral'
    : score < 80 ? 'Bullish'
    : 'Euphoria'

  const priceLabel = isCrypto ? symbol.replace('USDT','') : 'BTC'

  // Signal Confluence
  const signals: { label: string; signal: 'bullish'|'bearish'|'neutral' }[] = []
  if (fg !== null) signals.push({ label:'Fear & Greed', signal: fg>60?'bullish':fg<40?'bearish':'neutral' })
  if (btcChange !== null) signals.push({ label:`${priceLabel} 24h`, signal: btcChange>2?'bullish':btcChange<-2?'bearish':'neutral' })
  if (mvrv !== null) signals.push({ label:'MVRV', signal: mvrv<1.5?'bullish':mvrv>3?'bearish':'neutral' })
  if (funding !== null) signals.push({ label:'Funding', signal: funding<-0.01?'bullish':funding>0.03?'bearish':'neutral' })
  const bullCount = signals.filter(s=>s.signal==='bullish').length
  const bearCount = signals.filter(s=>s.signal==='bearish').length
  const neutCount = signals.filter(s=>s.signal==='neutral').length

  // Gauge arc
  const R=55, CX=80, CY=70
  function gArc(pct: number) {
    const angle = (pct/100)*180 - 180
    const rad   = angle * Math.PI/180
    return `M ${CX-R} ${CY} A ${R} ${R} 0 ${pct>50?1:0} 1 ${(CX+R*Math.cos(rad)).toFixed(1)} ${(CY+R*Math.sin(rad)).toFixed(1)}`
  }

  const CARD: React.CSSProperties = {
    background:'rgba(8,12,22,0.9)', border:'1px solid rgba(255,255,255,0.08)',
    borderRadius:16, padding:20, backdropFilter:'blur(12px)',
  }

  if (loading) return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
      {[1,2,3].map(i=><div key={i} style={{...CARD,height:160,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div style={{width:20,height:20,borderRadius:'50%',border:'2px solid rgba(0,229,255,0.15)',borderTopColor:'#00E5FF',animation:'spin 0.8s linear infinite'}}/>
      </div>)}
    </div>
  )

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
      {/* Card 1: Market Score */}
      <div style={{ ...CARD, position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:`linear-gradient(90deg,transparent,${scoreColor},transparent)` }}/>
        <div style={{ fontSize:10, fontWeight:800, color:'rgba(255,255,255,0.4)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>MARKET SCORE</div>
        <div style={{ display:'flex', alignItems:'flex-end', gap:12 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:44, fontWeight:900, color:scoreColor, fontFamily:'Syne,sans-serif', lineHeight:1 }}>{score ?? '—'}</div>
            <div style={{ fontSize:11, color:scoreColor, marginTop:4, fontWeight:700 }}>{scoreLabel}</div>
            {/* Progress bar */}
            <div style={{ height:4, borderRadius:2, background:'rgba(255,255,255,0.07)', marginTop:10, overflow:'hidden' }}>
              <div style={{ height:'100%', borderRadius:2, width:`${score ?? 0}%`, background:`linear-gradient(90deg,#FF3B30,#FF9500,#8E8E93,#34C759,#BF5AF2)`, transition:'width 1s ease' }}/>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', marginTop:4 }}>
              <span style={{ fontSize:8, color:'#FF3B30', fontFamily:'JetBrains Mono,monospace' }}>0 Panique</span>
              <span style={{ fontSize:8, color:'#BF5AF2', fontFamily:'JetBrains Mono,monospace' }}>100 Euphorie</span>
            </div>
          </div>
          {/* Gauge */}
          <svg viewBox="0 0 160 90" style={{ width:130, flexShrink:0 }}>
            <path d={`M ${CX-R} ${CY} A ${R} ${R} 0 0 1 ${CX+R} ${CY}`} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={10}/>
            {score!==null&&<path d={gArc(score)} fill="none" stroke={scoreColor} strokeWidth={10} strokeLinecap="round"/>}
          </svg>
        </div>
      </div>

      {/* Card 2: Market Regime */}
      <div style={{ ...CARD, position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:`linear-gradient(90deg,transparent,${regimeColor[regime]},transparent)` }}/>
        <div style={{ fontSize:10, fontWeight:800, color:'rgba(255,255,255,0.4)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>MARKET REGIME</div>
        <div style={{ fontSize:32, fontWeight:900, color:regimeColor[regime], fontFamily:'Syne,sans-serif', lineHeight:1, marginBottom:8 }}>
          {regime === 'Capitulation' ? '💔' : regime === 'Recovery' ? '🌱' : regime === 'Compression' ? '⚡' : regime === 'Expansion' ? '🚀' : regime === 'Distribution' ? '🎯' : '⏳'} {regime}
        </div>
        <div style={{ fontSize:11, color:'rgba(255,255,255,0.45)', lineHeight:1.5, marginBottom:12 }}>{regimeDesc[regime]}</div>
        {/* Regime indicators */}
        {[
          { label:'FG Index', value: fg !== null ? `${fg}/100` : '—', positive: fg !== null && fg > 50 },
          { label:`${priceLabel} 24h`, value: btcChange !== null ? `${btcChange>=0?'+':''}${btcChange.toFixed(2)}%` : '—', positive: btcChange !== null && btcChange >= 0 },
          { label:'MVRV', value: mvrv !== null ? mvrv.toFixed(2) : '—', positive: mvrv !== null && mvrv < 2 },
        ].map(item => (
          <div key={item.label} style={{ display:'flex', justifyContent:'space-between', padding:'3px 0', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
            <span style={{ fontSize:10, color:'rgba(255,255,255,0.35)' }}>{item.label}</span>
            <span style={{ fontSize:10, fontWeight:700, color: item.positive ? '#34C759' : '#FF9500', fontFamily:'JetBrains Mono,monospace' }}>{item.value}</span>
          </div>
        ))}
      </div>

      {/* Card 3: Signal Confluence */}
      <div style={{ ...CARD, position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:'linear-gradient(90deg,transparent,rgba(0,229,255,0.6),transparent)' }}/>
        <div style={{ fontSize:10, fontWeight:800, color:'rgba(255,255,255,0.4)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>SIGNAL CONFLUENCE</div>
        {/* Count badges */}
        <div style={{ display:'flex', gap:8, marginBottom:14 }}>
          {[
            { count: bullCount, label:'Haussier', color:'#34C759', bg:'rgba(52,199,89,0.12)' },
            { count: bearCount, label:'Baissier', color:'#FF3B30', bg:'rgba(255,59,48,0.12)' },
            { count: neutCount, label:'Neutre', color:'#8E8E93', bg:'rgba(142,142,147,0.1)' },
          ].map(b => (
            <div key={b.label} style={{ flex:1, textAlign:'center', background:b.bg, border:`1px solid ${b.color}33`, borderRadius:10, padding:'8px 4px' }}>
              <div style={{ fontSize:24, fontWeight:900, color:b.color, fontFamily:'Syne,sans-serif', lineHeight:1 }}>{b.count}</div>
              <div style={{ fontSize:9, color:'rgba(255,255,255,0.4)', marginTop:3, fontWeight:600 }}>{b.label}</div>
            </div>
          ))}
        </div>
        {/* Individual signals */}
        <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
          {signals.map(s => (
            <div key={s.label} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'4px 8px', borderRadius:7, background:'rgba(255,255,255,0.02)' }}>
              <span style={{ fontSize:10, color:'rgba(255,255,255,0.4)' }}>{s.label}</span>
              <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:5,
                background: s.signal==='bullish' ? 'rgba(52,199,89,0.15)' : s.signal==='bearish' ? 'rgba(255,59,48,0.15)' : 'rgba(142,142,147,0.1)',
                color: s.signal==='bullish' ? '#34C759' : s.signal==='bearish' ? '#FF3B30' : '#8E8E93',
              }}>
                {s.signal === 'bullish' ? '▲ BULL' : s.signal === 'bearish' ? '▼ BEAR' : '● NEUT'}
              </span>
            </div>
          ))}
        </div>
        {/* Overall bias */}
        {signals.length > 0 && (
          <div style={{ marginTop:12, padding:'8px 12px', borderRadius:10,
            background: bullCount > bearCount ? 'rgba(52,199,89,0.08)' : bearCount > bullCount ? 'rgba(255,59,48,0.08)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${bullCount>bearCount?'rgba(52,199,89,0.2)':bearCount>bullCount?'rgba(255,59,48,0.2)':'rgba(255,255,255,0.08)'}`,
          }}>
            <span style={{ fontSize:11, fontWeight:700, color: bullCount>bearCount?'#34C759':bearCount>bullCount?'#FF3B30':'#8E8E93' }}>
              {bullCount > bearCount ? '✅ Biais Haussier' : bearCount > bullCount ? '⚠️ Biais Baissier' : '⚖️ Marché Neutre'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── NUPL Chart (approx: 1 - 1/MVRV from CoinMetrics) ──────────────────────
function NUPLChart() {
  const [data, setData]     = useState<{ date:string; nupl:number }[]>([])
  const [loading, setLoading] = useState(true)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  useEffect(() => {
    const start = new Date(Date.now() - 365*86_400_000).toISOString().slice(0,10)
    fetch(`https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMVRVCur&frequency=1d&start_time=${start}`)
      .then(r => r.json())
      .then((d: { data?: { time:string; CapMVRVCur:string }[] }) => {
        const pts = (d.data ?? []).map(x => {
          const mvrv = parseFloat(x.CapMVRVCur)
          return { date: x.time.slice(0,10), nupl: !isNaN(mvrv) && mvrv > 0 ? 1 - 1/mvrv : 0 }
        }).filter(x => !isNaN(x.nupl))
        setData(pts); setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const W = 720, H = 130, PAD = { t:12, b:24, l:44, r:12 }
  const cW = W - PAD.l - PAD.r
  const cH = H - PAD.t - PAD.b
  const minN = -0.5, maxN = 1.0
  function yPx(v: number) { return PAD.t + cH - ((v-minN)/(maxN-minN))*cH }
  function xPx(i: number) { return PAD.l + (i/(data.length-1||1))*cW }
  const pts = data.map((d,i) => `${xPx(i).toFixed(1)},${yPx(d.nupl).toFixed(1)}`).join(' ')
  const curNupl = data[data.length-1]?.nupl ?? null
  const nColor = curNupl===null ? '#8E8E93' : curNupl < 0 ? '#FF3B30' : curNupl < 0.25 ? '#FF9500' : curNupl < 0.5 ? '#34C759' : curNupl < 0.75 ? '#0A85FF' : '#BF5AF2'
  const nLabel = curNupl===null ? '' : curNupl < 0 ? 'Capitulation' : curNupl < 0.25 ? 'Hope/Fear' : curNupl < 0.5 ? 'Optimism' : curNupl < 0.75 ? 'Belief/Denial' : 'Euphoria'

  const zones: [number,number,string,string][] = [
    [-0.5, 0,    'rgba(255,59,48,0.12)',   'Capitulation'],
    [0,    0.25, 'rgba(255,149,0,0.08)',   'Hope'],
    [0.25, 0.5,  'rgba(52,199,89,0.08)',   'Optimism'],
    [0.5,  0.75, 'rgba(10,133,255,0.08)',  'Belief'],
    [0.75, 1.0,  'rgba(191,90,242,0.12)',  'Euphoria'],
  ]

  return (
    <div style={CARD_STYLE}>
      <CardHeader
        color={nColor}
        title="NUPL — Net Unrealized Profit/Loss"
        sub="Profit/perte non réalisé du réseau Bitcoin · Calculé via MVRV (CoinMetrics)"
        value={curNupl !== null ? curNupl.toFixed(3) : undefined}
        valueSub={nLabel}
      />
      <div style={{ display:'flex', gap:12, marginBottom:10, flexWrap:'wrap' }}>
        {zones.map(([,, bg, label]) => (
          <div key={label} style={{ display:'flex', alignItems:'center', gap:4 }}>
            <div style={{ width:10, height:8, borderRadius:2, background:bg, border:'1px solid rgba(255,255,255,0.1)' }}/>
            <span style={{ fontSize:9, color:'rgba(255,255,255,0.4)' }}>{label}</span>
          </div>
        ))}
      </div>
      {loading ? <Spinner/> : data.length < 2 ? (
        <div style={{ textAlign:'center', padding:32, color:'rgba(255,255,255,0.3)', fontSize:13 }}>Données indisponibles</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height:'auto', display:'block', cursor:'crosshair' }}
          onMouseMove={(e: React.MouseEvent<SVGSVGElement>) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const idx = Math.round(((e.clientX - rect.left) / rect.width * W - PAD.l) / cW * (data.length - 1))
            setHoverIdx(Math.max(0, Math.min(data.length - 1, idx)))
          }}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id="nupl-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={nColor} stopOpacity="0.3"/>
              <stop offset="100%" stopColor={nColor} stopOpacity="0.02"/>
            </linearGradient>
          </defs>
          {zones.map(([lo, hi, bg]) => (
            <rect key={lo} x={PAD.l} y={yPx(hi)} width={cW} height={yPx(lo)-yPx(hi)} fill={bg}/>
          ))}
          {[0, 0.25, 0.5, 0.75].map(v => (
            <line key={v} x1={PAD.l} y1={yPx(v)} x2={PAD.l+cW} y2={yPx(v)} stroke="rgba(255,255,255,0.08)" strokeWidth={1} strokeDasharray="4 3"/>
          ))}
          {[-0.5, 0, 0.5, 1.0].map(v => (
            <text key={v} x={PAD.l-4} y={yPx(v)+4} textAnchor="end" fill="rgba(255,255,255,0.25)" fontSize={8} fontFamily="JetBrains Mono,monospace">{v}</text>
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map(f => {
            const idx = Math.min(data.length-1, Math.round(f*(data.length-1)))
            return <text key={f} x={xPx(idx)} y={H-4} textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize={8} fontFamily="JetBrains Mono,monospace">{data[idx]?.date.slice(5)}</text>
          })}
          <polygon points={`${PAD.l},${yPx(0)} ${pts} ${xPx(data.length-1)},${yPx(0)}`} fill="url(#nupl-grad)"/>
          <polyline points={pts} fill="none" stroke={nColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
          {curNupl !== null && (
            <circle cx={xPx(data.length-1)} cy={yPx(curNupl)} r={4} fill={nColor} stroke="rgba(8,12,22,0.8)" strokeWidth={2}/>
          )}
          {/* Crosshair */}
          {hoverIdx !== null && data[hoverIdx] && (() => {
            const d = data[hoverIdx]
            const cx = xPx(hoverIdx)
            return (
              <g>
                <line x1={cx} y1={PAD.t} x2={cx} y2={PAD.t+cH} stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="3 3"/>
                <circle cx={cx} cy={yPx(d.nupl)} r={4} fill={nColor} stroke="rgba(8,12,22,0.8)" strokeWidth={2}/>
              </g>
            )
          })()}
        </svg>
      )}
    </div>
  )
}

// ── Momentum Composite (RSI + Rate of Change + MA Slope) ──────────────────
function MomentumCompositeChart({ symbol, isCrypto }: { symbol: string; isCrypto: boolean }) {
  type Pt = { date: string; rsi: number; roc: number; maSlope: number; score: number }
  const [data, setData]     = useState<Pt[]>([])
  const [loading, setLoading] = useState(true)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  useEffect(() => {
    setLoading(true)
    fetchCloses(symbol, isCrypto, 200)
      .then(closes => {
        const pts: Pt[] = []
        for (let i = 30; i < closes.length; i++) {
          // RSI(14) normalized 0-1
          const slice14 = closes.slice(i-14, i+1)
          const gains: number[] = [], losses: number[] = []
          for (let j = 1; j < slice14.length; j++) {
            const d = slice14[j] - slice14[j-1]
            if (d > 0) gains.push(d); else losses.push(Math.abs(d))
          }
          const avgGain = gains.length ? gains.reduce((a,b)=>a+b,0)/14 : 0
          const avgLoss = losses.length ? losses.reduce((a,b)=>a+b,0)/14 : 0.001
          const rs = avgGain/avgLoss
          const rsiRaw = 100 - (100/(1+rs))
          const rsiNorm = rsiRaw / 100

          // Rate of Change (20) normalized 0-1
          const roc20 = closes[i-20] ? ((closes[i] - closes[i-20]) / closes[i-20]) : 0
          const rocNorm = Math.max(0, Math.min(1, (roc20 + 0.5) / 1))

          // MA Slope: 20-day MA slope normalized
          const ma20 = closes.slice(i-19, i+1).reduce((a,b)=>a+b,0)/20
          const ma20Prev = closes.slice(i-20, i).reduce((a,b)=>a+b,0)/20
          const slope = ma20Prev > 0 ? (ma20 - ma20Prev) / ma20Prev : 0
          const slopeNorm = Math.max(0, Math.min(1, (slope + 0.02) / 0.04))

          // Composite score (0-100)
          const score = Math.round((rsiNorm * 0.4 + rocNorm * 0.35 + slopeNorm * 0.25) * 100)
          pts.push({ date: `D${i}`, rsi:rsiRaw, roc:roc20*100, maSlope:slope*100, score })
        }
        setData(pts); setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [symbol, isCrypto])

  const W = 720, H = 120, PAD = { t:10, b:24, l:44, r:12 }
  const cW = W - PAD.l - PAD.r
  const cH = H - PAD.t - PAD.b
  function yPx(v: number) { return PAD.t + cH - (v/100)*cH }
  function xPx(i: number) { return PAD.l + (i/(data.length-1||1))*cW }
  const pts = data.map((d,i) => `${xPx(i).toFixed(1)},${yPx(d.score).toFixed(1)}`).join(' ')
  const curPt = data[data.length-1]
  const mColor = curPt ? (curPt.score > 70 ? '#34C759' : curPt.score > 50 ? '#0A85FF' : curPt.score > 30 ? '#FF9500' : '#FF3B30') : '#8E8E93'
  const mLabel = curPt ? (curPt.score > 70 ? 'Fort momentum' : curPt.score > 50 ? 'Momentum positif' : curPt.score > 30 ? 'Momentum faible' : 'Momentum négatif') : ''

  return (
    <div style={CARD_STYLE}>
      <CardHeader
        color={mColor}
        title="Momentum Composite"
        sub={`RSI (40%) + Rate of Change (35%) + Pente MA (25%) — ${symbol}`}
        value={curPt ? `${curPt.score}/100` : undefined}
        valueSub={mLabel}
      />
      {loading ? <Spinner/> : data.length < 2 ? (
        <div style={{ textAlign:'center', padding:32, color:'rgba(255,255,255,0.3)', fontSize:13 }}>Données insuffisantes</div>
      ) : (
        <>
          {/* Component breakdown */}
          {curPt && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:12 }}>
              {[
                { label:'RSI', value:`${curPt.rsi.toFixed(0)}`, color:curPt.rsi>60?'#34C759':curPt.rsi<40?'#FF3B30':'#FF9500' },
                { label:'ROC 20j', value:`${curPt.roc>=0?'+':''}${curPt.roc.toFixed(1)}%`, color:curPt.roc>=0?'#34C759':'#FF3B30' },
                { label:'MA Slope', value:`${curPt.maSlope>=0?'+':''}${curPt.maSlope.toFixed(3)}%`, color:curPt.maSlope>=0?'#34C759':'#FF3B30' },
              ].map(c => (
                <div key={c.label} style={{ background:'rgba(255,255,255,0.03)', borderRadius:8, padding:'8px 10px', textAlign:'center' }}>
                  <div style={{ fontSize:9, color:'rgba(255,255,255,0.3)', marginBottom:3, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.08em' }}>{c.label}</div>
                  <div style={{ fontSize:14, fontWeight:800, color:c.color, fontFamily:'JetBrains Mono,monospace' }}>{c.value}</div>
                </div>
              ))}
            </div>
          )}
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height:'auto', display:'block', cursor:'crosshair' }}
            onMouseMove={(e: React.MouseEvent<SVGSVGElement>) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const idx = Math.round(((e.clientX - rect.left) / rect.width * W - PAD.l) / cW * (data.length - 1))
              setHoverIdx(Math.max(0, Math.min(data.length - 1, idx)))
            }}
            onMouseLeave={() => setHoverIdx(null)}
          >
            <defs>
              <linearGradient id={`mom-grad-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={mColor} stopOpacity="0.3"/>
                <stop offset="100%" stopColor={mColor} stopOpacity="0.02"/>
              </linearGradient>
            </defs>
            {/* 50 midline */}
            <line x1={PAD.l} y1={yPx(50)} x2={PAD.l+cW} y2={yPx(50)} stroke="rgba(255,255,255,0.12)" strokeWidth={1} strokeDasharray="4 3"/>
            {[0,25,50,75,100].map(v => (
              <text key={v} x={PAD.l-4} y={yPx(v)+4} textAnchor="end" fill="rgba(255,255,255,0.2)" fontSize={8} fontFamily="JetBrains Mono,monospace">{v}</text>
            ))}
            <polygon points={`${PAD.l},${yPx(0)} ${pts} ${xPx(data.length-1)},${yPx(0)}`} fill={`url(#mom-grad-${symbol})`}/>
            <polyline points={pts} fill="none" stroke={mColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
            {curPt && (
              <circle cx={xPx(data.length-1)} cy={yPx(curPt.score)} r={4} fill={mColor} stroke="rgba(8,12,22,0.8)" strokeWidth={2}/>
            )}
            {/* Crosshair */}
            {hoverIdx !== null && data[hoverIdx] && (() => {
              const d = data[hoverIdx]
              const cx = xPx(hoverIdx)
              return (
                <g>
                  <line x1={cx} y1={PAD.t} x2={cx} y2={PAD.t+cH} stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="3 3"/>
                  <circle cx={cx} cy={yPx(d.score)} r={4} fill={mColor} stroke="rgba(8,12,22,0.8)" strokeWidth={2}/>
                </g>
              )
            })()}
          </svg>
        </>
      )}
    </div>
  )
}
