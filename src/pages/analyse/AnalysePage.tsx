// src/pages/analyse/AnalysePage.tsx — v2
// Miroir exact de LiquidityCVDStackView.swift + MarketContextService.swift
// 3 modes : Micro / Structure / Dérivés + Derivatives Confluence Card + vraie recherche

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import LiquidationHeatmap from './LiquidationHeatmap'
import MTFDashboard from './MTFDashboard'
import { WaveTrendChart, VMCOscillatorChart } from './OscillatorCharts'
import { backgroundMonitor } from '@/services/notifications/BackgroundSignalMonitor'
import RsiEliteChart from './RsiEliteChart'
import TradePlanCard from './TradePlanCard'
import LiveChart from './LiveChart'
import LightweightChart from './LightweightChart'
import KeyLevelsCard from './KeyLevelsCard'
import ChartScreenshotAnalysis from './ChartScreenshotAnalysis'
// Détecte si le symbole est une crypto Binance
function isCryptoSymbol(symbol: string) {
  return /USDT$|BUSD$|BTC$|ETH$|BNB$/i.test(symbol)
}

// Normalise un symbole forex saisi librement → format Yahoo Finance
// "EUR/CAD" → "EURCAD=X" | "eurusd" → "EURUSD=X" | "GC=F" → "GC=F" (inchangé)
function normalizeForexSymbol(raw: string): string {
  const s = raw.trim().toUpperCase()
  // Déjà format Yahoo (=X, =F, ^, lettre.PA…) → inchangé
  if (s.includes('=') || s.startsWith('^') || s.includes('.')) return s
  // Déjà crypto → inchangé
  if (isCryptoSymbol(s)) return s
  // Pair forex avec séparateur "EUR/CAD", "EUR-CAD", "EUR CAD" → "EURCAD=X"
  const clean = s.replace(/[\s/\-_]+/g, '')
  if (/^[A-Z]{6}$/.test(clean)) return clean + '=X'
  return s
}

// ── Share / Screenshot wrapper ──────────────────────────────────────────
function ShareWrapper({ children, label }: { children: React.ReactNode; label: string }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const [hover, setHover] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleShare = async () => {
    const el = ref.current
    if (!el || loading) return
    setLoading(true)
    try {
      let blob: Blob | null = null

      // 1. Try canvas capture first (for chart components with canvas)
      const canvases = Array.from(el.querySelectorAll('canvas')) as HTMLCanvasElement[]
      const cv = canvases.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0]

      if (cv && cv.width > 0 && cv.height > 0) {
        // Canvas-based component (charts)
        const dataUrl = cv.toDataURL('image/png')
        blob = await (await fetch(dataUrl)).blob()
      } else {
        // HTML-based component (KeyLevelsCard, TradePlanCard, MTFDashboard…)
        // Use html-to-image for full DOM capture
        const { toPng } = await import('html-to-image')
        const dataUrl = await toPng(el, {
          quality: 1,
          pixelRatio: 2,
          backgroundColor: getComputedStyle(document.documentElement)
            .getPropertyValue('--tm-bg').trim() || '#0D1117',
          filter: (node) => {
            // Exclude the share button itself from the screenshot
            if (node instanceof HTMLButtonElement && node.title?.startsWith('Partager')) return false
            return true
          },
        })
        blob = await (await fetch(dataUrl)).blob()
      }

      if (!blob) { setLoading(false); return }

      const filename = `trademindset-${label.toLowerCase().replace(/\s+/g, '-')}.png`

      // 2. Try Clipboard API (copy as image — paste anywhere)
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ])
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
        setLoading(false)
        return
      } catch { /* clipboard write failed, fallback below */ }

      // 3. Fallback: Web Share API (mobile)
      if (navigator.share && navigator.canShare) {
        const file = new File([blob], filename, { type: 'image/png' })
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ title: `TradeMindset — ${label}`, files: [file] })
          setCopied(true)
          setTimeout(() => setCopied(false), 2500)
          setLoading(false)
          return
        }
      }

      // 4. Last fallback: download file
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch (err) {
      console.warn('Share failed:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div ref={ref} style={{ position:'relative', marginBottom:16 }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {children}
      {(hover || copied || loading) && (
        <button onClick={handleShare} title={`Partager ${label}`}
          disabled={loading}
          style={{
            position:'absolute', bottom:12, right:12, zIndex:10,
            padding:'4px 10px', borderRadius:8, display:'flex', alignItems:'center', gap:5,
            background: copied
              ? 'rgba(34,199,89,0.85)'
              : loading
              ? 'rgba(13,17,23,0.92)'
              : 'rgba(13,17,23,0.85)',
            border: copied ? '1px solid #22C759' : '1px solid #2A2F3E',
            cursor: loading ? 'wait' : 'pointer', fontSize:10, fontWeight:600,
            color: '#fff',
            backdropFilter:'blur(8px)', transition:'all 0.15s',
            opacity: loading ? 0.8 : 1,
          }}>
          {copied ? t('common.copied') : loading ? t('common.capturing') : t('common.share')}
        </button>
      )}
    </div>
  )
}

// ── Types ──────────────────────────────────────────────────────────────────
type Mode = 'micro' | 'structure' | 'derivees'
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
// aliases = mots-clés en FR/EN pour la recherche floue
interface KnownAsset extends SearchResult { aliases: string[] }
const YAHOO_KNOWN: KnownAsset[] = [
  {symbol:'EURUSD=X', name:'EUR/USD',          type:'forex', exchange:'Forex',      icon:'💱', aliases:['euro','dollar','eur','usd','eurusd']},
  {symbol:'GBPUSD=X', name:'GBP/USD',          type:'forex', exchange:'Forex',      icon:'💱', aliases:['pound','sterling','gbp','cable']},
  {symbol:'USDJPY=X', name:'USD/JPY',          type:'forex', exchange:'Forex',      icon:'💱', aliases:['yen','japan','jpy']},
  {symbol:'USDCHF=X', name:'USD/CHF',          type:'forex', exchange:'Forex',      icon:'💱', aliases:['franc','swiss','chf']},
  {symbol:'AUDUSD=X', name:'AUD/USD',          type:'forex', exchange:'Forex',      icon:'💱', aliases:['aussie','aud','australia']},
  {symbol:'GC=F',     name:'Or / Gold',        type:'forex', exchange:'COMEX',      icon:'🥇', aliases:['gold','or','xau','gld','metal']},
  {symbol:'SI=F',     name:'Argent / Silver',  type:'forex', exchange:'COMEX',      icon:'🥈', aliases:['silver','argent','xag']},
  {symbol:'CL=F',     name:'Pétrole WTI',      type:'forex', exchange:'NYMEX',      icon:'🛢️', aliases:['oil','petrol','petroleum','crude','brent','wti','petrole']},
  {symbol:'PL=F',     name:'Platine / Platinum',type:'forex',exchange:'NYMEX',      icon:'⬜', aliases:['platinum','platine','xpt']},
  {symbol:'^FCHI',    name:'CAC 40',           type:'stock', exchange:'Paris',      icon:'🇫🇷', aliases:['cac','france','paris','fchi']},
  {symbol:'^GDAXI',   name:'DAX 40',           type:'stock', exchange:'Frankfurt',  icon:'🇩🇪', aliases:['dax','germany','allemagne','frankfurt']},
  {symbol:'^FTSE',    name:'FTSE 100',         type:'stock', exchange:'London',     icon:'🇬🇧', aliases:['ftse','uk','london','england']},
  {symbol:'^GSPC',    name:'S&P 500',          type:'stock', exchange:'NYSE',       icon:'🇺🇸', aliases:['sp500','sp','s&p','spx','snp','usa']},
  {symbol:'^IXIC',    name:'Nasdaq',           type:'stock', exchange:'NASDAQ',     icon:'💻', aliases:['nasdaq','tech','ixic','ndx','qqq']},
  {symbol:'^DJI',     name:'Dow Jones',        type:'stock', exchange:'NYSE',       icon:'📊', aliases:['dow','djia','jones']},
  {symbol:'^N225',    name:'Nikkei 225',       type:'stock', exchange:'Tokyo',      icon:'🇯🇵', aliases:['nikkei','japan','japon','tokyo']},
  {symbol:'^HSI',     name:'Hang Seng',        type:'stock', exchange:'HKEx',       icon:'🇭🇰', aliases:['hangseng','hongkong','hong kong','hsi']},
]
function searchYahooKnown(q: string): SearchResult[] {
  const uq = q.toLowerCase().trim()
  if (!uq) return []
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return YAHOO_KNOWN.filter(({ aliases, ...s }) =>
    s.symbol.toLowerCase().includes(uq) ||
    s.name.toLowerCase().includes(uq) ||
    aliases.some(a => a.includes(uq))
  ).map(({ aliases: _a, ...s }) => s)
}

// Assets non-crypto affichés par défaut dans la liste populaire
const POPULAR_NONCRPYTO: SearchResult[] = [
  {symbol:'GC=F',  name:'Or / Gold',   type:'forex', exchange:'COMEX', icon:'🥇'},
  {symbol:'CL=F',  name:'Pétrole WTI', type:'forex', exchange:'NYMEX', icon:'🛢️'},
  {symbol:'^GSPC', name:'S&P 500',     type:'stock', exchange:'NYSE',  icon:'🇺🇸'},
  {symbol:'^FCHI', name:'CAC 40',      type:'stock', exchange:'Paris', icon:'🇫🇷'},
  {symbol:'^IXIC', name:'Nasdaq',      type:'stock', exchange:'NASDAQ',icon:'💻'},
]

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

// Default popular list: top cryptos + Gold/Oil/S&P/CAC/Nasdaq
const DEFAULT_POPULAR: SearchResult[] = [...POPULAR_NONCRPYTO, ...CRYPTO_POPULAR]

function useSymbolSearch(q: string) {
  const [results, setResults] = useState<SearchResult[]>(DEFAULT_POPULAR)
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>|null>(null)

  useEffect(() => {
    if (!q.trim()) { setResults(DEFAULT_POPULAR); return }
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
  const { t } = useTranslation()
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
          {symbol || t('analyse.searchPlaceholder')}
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
                <span style={{fontSize:9,fontWeight:700,color:'var(--tm-text-muted)',textTransform:'uppercase',letterSpacing:'0.08em'}}>{t('analyse.history')}</span>
                <button onClick={()=>{setHistory([]);saveHistory([])}} style={{fontSize:9,color:'var(--tm-text-muted)',background:'none',border:'none',cursor:'pointer',padding:0}}>{t('analyse.clearAll')}</button>
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
                        {entry.symbol===symbol && <span style={{fontSize:8,color:'var(--tm-accent)'}}>{t('analyse.activeIndicator')}</span>}
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
              {!showHistory && <div style={{padding:'6px 14px 4px',fontSize:9,fontWeight:700,color:'var(--tm-text-muted)',textTransform:'uppercase',letterSpacing:'0.08em'}}>{t('analyse.results')}</div>}
              <div style={{maxHeight:300,overflowY:'auto'}}>
                {results.length === 0 ? (
                  <div style={{padding:'20px',textAlign:'center',color:'var(--tm-text-muted)',fontSize:12}}>{t('analyse.noResults', {query: q})}</div>
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
              <div style={{padding:'6px 14px 4px',fontSize:9,fontWeight:700,color:'var(--tm-text-muted)',textTransform:'uppercase',letterSpacing:'0.08em'}}>{t('analyse.popular')}</div>
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

// ── Axes helper — réutilisé par CVDChart et WhaleTrendChart ──────────────────
function drawAxes(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  PAD_L: number, PAD_R: number, PAD_T: number, PAD_B: number,
  minV: number, maxV: number, timestamps: number[]
) {
  const cW = W - PAD_L - PAD_R, cH = H - PAD_T - PAD_B
  const toY = (v: number) => PAD_T + (1 - (v - minV) / ((maxV - minV) || 1)) * cH
  // Bandes latérales
  ctx.fillStyle = '#060A10'
  ctx.fillRect(0, 0, PAD_L, H)
  ctx.fillRect(0, PAD_T + cH, W, PAD_B)
  // Y grid + labels
  ctx.font = 'bold 9px monospace'; ctx.textAlign = 'right'
  for (let i = 0; i <= 4; i++) {
    const v = minV + ((maxV - minV) / 4) * i
    const y = Math.round(toY(v)) + 0.5
    ctx.setLineDash([2, 4]); ctx.strokeStyle = '#1E2A3A'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(PAD_L + 1, y); ctx.lineTo(W - PAD_R, y); ctx.stroke()
    ctx.setLineDash([])
    ctx.strokeStyle = '#3A4A5C'
    ctx.beginPath(); ctx.moveTo(PAD_L - 4, y); ctx.lineTo(PAD_L, y); ctx.stroke()
    ctx.fillStyle = '#8899BB'; ctx.fillText(fmtU(v), PAD_L - 7, y + 3)
  }
  // Ligne zéro
  const zY = Math.round(toY(0)) + 0.5
  if (zY > PAD_T && zY < PAD_T + cH) {
    const zc = maxV >= 0 ? '#22C75960' : '#FF3B3060'
    ctx.setLineDash([5, 4]); ctx.strokeStyle = zc; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(PAD_L, zY); ctx.lineTo(W - PAD_R, zY); ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = maxV >= 0 ? '#22C759' : '#FF3B30'
    ctx.font = 'bold 9px monospace'; ctx.textAlign = 'right'
    ctx.fillText('0', PAD_L - 7, zY + 3)
  }
  // Axe Y vertical
  ctx.strokeStyle = '#2A3548'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(PAD_L + 0.5, PAD_T); ctx.lineTo(PAD_L + 0.5, PAD_T + cH + 4); ctx.stroke()
  // X axis labels
  if (timestamps.length >= 2) {
    const span = timestamps[timestamps.length - 1] - timestamps[0]
    const multiDay = span > 86_400_000
    const xN = Math.min(7, timestamps.length - 1)
    ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'
    for (let i = 0; i <= xN; i++) {
      const idx = Math.round((i / xN) * (timestamps.length - 1))
      const x = Math.round(PAD_L + (idx / (timestamps.length - 1)) * cW) + 0.5
      const d = new Date(timestamps[idx])
      const hh = d.getHours().toString().padStart(2, '0')
      const mm = d.getMinutes().toString().padStart(2, '0')
      ctx.setLineDash([2, 4]); ctx.strokeStyle = '#1E2A3A'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(x, PAD_T); ctx.lineTo(x, PAD_T + cH); ctx.stroke()
      ctx.setLineDash([])
      ctx.strokeStyle = '#3A4A5C'
      ctx.beginPath(); ctx.moveTo(x, PAD_T + cH); ctx.lineTo(x, PAD_T + cH + 4); ctx.stroke()
      ctx.fillStyle = '#8899BB'
      if (multiDay) {
        ctx.fillText(`${d.getDate()}/${d.getMonth()+1}`, x, PAD_T + cH + 13)
        ctx.fillText(`${hh}:${mm}`, x, PAD_T + cH + 24)
      } else {
        ctx.fillText(`${hh}:${mm}`, x, PAD_T + cH + 14)
      }
    }
  }
  // Axe X horizontal
  ctx.strokeStyle = '#2A3548'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(PAD_L, PAD_T + cH + 0.5); ctx.lineTo(W - PAD_R, PAD_T + cH + 0.5); ctx.stroke()
}

// ── Charts ─────────────────────────────────────────────────────────────────
function CVDChart({ pts, segs }: { pts: CVDPt[]; segs: Seg[] }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLCanvasElement>(null)
  const PAD_L = 62, PAD_R = 10, PAD_T = 10, PAD_B = 28, H_C = 210
  useEffect(() => {
    const c = ref.current; if (!c || pts.length < 2) return
    const dpr = window.devicePixelRatio || 1, W = c.offsetWidth || 700, H = H_C
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr)
    const ctx = c.getContext('2d')!; ctx.scale(dpr, dpr)
    ctx.fillStyle = '#080C14'; ctx.fillRect(0, 0, W, H)
    const cW = W - PAD_L - PAD_R, cH = H - PAD_T - PAD_B
    // Value range
    let minV = 0, maxV = 0
    for (const s of segs) for (const p of pts) { if (p[s] < minV) minV = p[s]; if (p[s] > maxV) maxV = p[s] }
    const vPad = (maxV - minV) * 0.08; minV -= vPad; maxV += vPad
    const range = maxV - minV || 1
    const toX = (i: number) => PAD_L + (i / (pts.length - 1)) * cW
    const toY = (v: number) => PAD_T + (1 - (v - minV) / range) * cH
    const zY = toY(0)
    // Draw axes first (behind fills)
    drawAxes(ctx, W, H, PAD_L, PAD_R, PAD_T, PAD_B, minV, maxV, pts.map(p => p.t))
    // Clip chart area
    ctx.save(); ctx.beginPath(); ctx.rect(PAD_L + 1, PAD_T, cW - 1, cH); ctx.clip()
    // Area fills + lines
    for (const seg of segs) {
      const cfg = SEG_CFG[seg]
      const last = pts[pts.length - 1][seg]
      ctx.beginPath()
      pts.forEach((p, i) => { const x = toX(i), y = toY(p[seg]); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
      ctx.lineTo(toX(pts.length - 1), zY); ctx.lineTo(toX(0), zY); ctx.closePath()
      const grad = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + cH)
      grad.addColorStop(0, cfg.color + (last >= 0 ? '40' : '08')); grad.addColorStop(1, cfg.color + '02')
      ctx.fillStyle = grad; ctx.fill()
      ctx.beginPath()
      pts.forEach((p, i) => { const x = toX(i), y = toY(p[seg]); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
      ctx.strokeStyle = seg === 'whales' ? cfg.color : cfg.color + 'CC'
      ctx.lineWidth = seg === 'whales' ? 2 : 1.5; ctx.stroke()
    }
    ctx.restore()
  }, [pts, segs])
  if (pts.length < 2) return <div style={{ height: H_C, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tm-text-muted)', fontSize: 12, background: '#080C14', borderRadius: 8 }}>{t('analyse.awaitingData')}...</div>
  return <canvas ref={ref} style={{ width: '100%', height: H_C, borderRadius: 8, display: 'block' }} />
}

function WhaleTrendChart({ pts }: { pts: WhaleTrendPt[] }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLCanvasElement>(null)
  const PAD_L = 62, PAD_R = 10, PAD_T = 10, PAD_B = 28, H_C = 220
  useEffect(() => {
    const c = ref.current; if (!c || pts.length < 2) return
    const dpr = window.devicePixelRatio || 1, W = c.offsetWidth || 700, H = H_C
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr)
    const ctx = c.getContext('2d')!; ctx.scale(dpr, dpr)
    ctx.fillStyle = '#080C14'; ctx.fillRect(0, 0, W, H)
    const cW = W - PAD_L - PAD_R, cH = H - PAD_T - PAD_B
    const cvd = pts.map(p => p.cum), ema = pts.map(p => p.ema)
    let minV = Math.min(...cvd, ...ema), maxV = Math.max(...cvd, ...ema)
    const vPad = (maxV - minV) * 0.1; minV -= vPad; maxV += vPad
    const range = maxV - minV || 1
    const toX = (i: number) => PAD_L + (i / (pts.length - 1)) * cW
    const toY = (v: number) => PAD_T + (1 - (v - minV) / range) * cH
    const zY = toY(0)
    // Draw axes
    drawAxes(ctx, W, H, PAD_L, PAD_R, PAD_T, PAD_B, minV, maxV, pts.map(p => p.t))
    // Clip chart area
    ctx.save(); ctx.beginPath(); ctx.rect(PAD_L + 1, PAD_T, cW - 1, cH); ctx.clip()
    // CVD area fill
    const last = cvd[cvd.length - 1]
    const color = last >= 0 ? '#22C759' : '#FF3B30'
    ctx.beginPath()
    pts.forEach((p, i) => { const x = toX(i), y = toY(p.cum); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
    ctx.lineTo(toX(pts.length - 1), zY); ctx.lineTo(toX(0), zY); ctx.closePath()
    const grad = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + cH)
    grad.addColorStop(0, color + '30'); grad.addColorStop(1, color + '03')
    ctx.fillStyle = grad; ctx.fill()
    // CVD line
    ctx.beginPath(); ctx.strokeStyle = 'rgba(200,200,255,0.9)'; ctx.lineWidth = 1.8
    pts.forEach((p, i) => { const x = toX(i), y = toY(p.cum); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
    ctx.stroke()
    // EMA line
    ctx.beginPath(); ctx.strokeStyle = '#FFA726'; ctx.lineWidth = 1.2
    pts.forEach((p, i) => { const x = toX(i), y = toY(p.ema); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
    ctx.stroke()
    ctx.restore()
  }, [pts])
  if (pts.length < 2) return <div style={{ height: H_C, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tm-text-muted)', fontSize: 12, background: '#080C14', borderRadius: 8 }}>{t('analyse.awaitingData')}…</div>
  return <canvas ref={ref} style={{ width: '100%', height: H_C, borderRadius: 8, display: 'block' }} />
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

// Segmented CVD History — multi-line par bucket de volume (proxy klines)
interface SegHistPt { t: number; small: number; medium: number; large: number; institutional: number; whales: number }
// SEG_LINES_CFG dérive de SEG_CFG pour garantir des couleurs identiques
const SEG_LINES_CFG: { key: keyof SegHistPt; color: string; label: string; range: string; lw: number }[] = [
  { key: 'whales',        color: SEG_CFG.whales.color,        label: SEG_CFG.whales.label,        range: '≥3× vol moy', lw: 2.0 },
  { key: 'institutional', color: SEG_CFG.institutional.color, label: SEG_CFG.institutional.label, range: '2-3× vol',    lw: 1.6 },
  { key: 'large',         color: SEG_CFG.large.color,         label: SEG_CFG.large.label,         range: '1.5-2× vol',  lw: 1.4 },
  { key: 'medium',        color: SEG_CFG.medium.color,        label: SEG_CFG.medium.label,        range: '0.7-1.5×',    lw: 1.2 },
  { key: 'small',         color: SEG_CFG.small.color,         label: SEG_CFG.small.label,         range: '<0.7× vol',   lw: 1.0 },
]
function SegmentedCVDHistoryChart({ pts }: { pts: SegHistPt[] }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLCanvasElement>(null)
  const PAD_L = 62, PAD_B = 32, PAD_T = 10, PAD_R = 10
  const H_CANVAS = 260

  useEffect(() => {
    const c = ref.current; if (!c || pts.length < 2) return
    const dpr = window.devicePixelRatio || 1
    const W = c.offsetWidth || 700, H = H_CANVAS
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr)
    const ctx = c.getContext('2d')!; ctx.scale(dpr, dpr)

    const cW = W - PAD_L - PAD_R
    const cH = H - PAD_T - PAD_B

    // ── Background ──
    ctx.fillStyle = '#080C14'; ctx.fillRect(0, 0, W, H)
    // Bande Y-axis
    ctx.fillStyle = '#060A10'; ctx.fillRect(0, 0, PAD_L, H)
    // Bande X-axis
    ctx.fillStyle = '#060A10'; ctx.fillRect(0, PAD_T + cH, W, PAD_B)

    // ── Value range ──
    let minV = 0, maxV = 0
    for (const ln of SEG_LINES_CFG) for (const p of pts) {
      const v = p[ln.key] as number
      if (v < minV) minV = v; if (v > maxV) maxV = v
    }
    const rangePad = (maxV - minV) * 0.1
    minV -= rangePad; maxV += rangePad
    const range = maxV - minV || 1

    const toX = (i: number) => PAD_L + (i / (pts.length - 1)) * cW
    const toY = (v: number) => PAD_T + (1 - (v - minV) / range) * cH

    // ── Y Axis graduations ──
    const yTicks = 5
    ctx.font = 'bold 9px monospace'; ctx.textAlign = 'right'
    for (let i = 0; i <= yTicks; i++) {
      const v = minV + (range / yTicks) * i
      const y = Math.round(toY(v)) + 0.5
      // Grid line en pointillés légers
      ctx.setLineDash([2, 4]); ctx.strokeStyle = '#1E2A3A'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(PAD_L + 1, y); ctx.lineTo(W - PAD_R, y); ctx.stroke()
      ctx.setLineDash([])
      // Tick
      ctx.strokeStyle = '#3A4A5C'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(PAD_L - 4, y); ctx.lineTo(PAD_L, y); ctx.stroke()
      // Label
      ctx.fillStyle = '#8899BB'; ctx.fillText(fmtU(v), PAD_L - 7, y + 3)
    }

    // Ligne zéro plus visible
    const lastCumWhales = pts[pts.length - 1].whales
    const isPositive = lastCumWhales >= 0
    const zeroColor = isPositive ? '#22C759' : '#FF3B30'
    const zY = Math.round(toY(0)) + 0.5
    if (zY > PAD_T && zY < PAD_T + cH) {
      ctx.setLineDash([5, 4]); ctx.strokeStyle = zeroColor + '60'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(PAD_L, zY); ctx.lineTo(W - PAD_R, zY); ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = zeroColor; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'right'
      ctx.fillText('0', PAD_L - 7, zY + 3)
    }

    // Axe Y vertical
    ctx.strokeStyle = '#2A3548'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(PAD_L + 0.5, PAD_T); ctx.lineTo(PAD_L + 0.5, PAD_T + cH + 4); ctx.stroke()

    // ── X Axis labels ──
    const span = pts[pts.length - 1].t - pts[0].t
    const multiDay = span > 86_400_000
    const xTickCount = Math.min(8, pts.length - 1)
    ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#8899BB'
    for (let i = 0; i <= xTickCount; i++) {
      const idx = Math.round((i / xTickCount) * (pts.length - 1))
      const x = Math.round(toX(idx)) + 0.5
      const d = new Date(pts[idx].t)
      const hh = d.getHours().toString().padStart(2, '0')
      const mm = d.getMinutes().toString().padStart(2, '0')
      // Tick
      ctx.strokeStyle = '#3A4A5C'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(x, PAD_T + cH); ctx.lineTo(x, PAD_T + cH + 4); ctx.stroke()
      // Vertical grid
      ctx.setLineDash([2, 4]); ctx.strokeStyle = '#1E2A3A'
      ctx.beginPath(); ctx.moveTo(x, PAD_T); ctx.lineTo(x, PAD_T + cH); ctx.stroke()
      ctx.setLineDash([])
      // Label
      ctx.fillStyle = '#8899BB'
      if (multiDay) {
        const dd = d.getDate(), mo = d.getMonth() + 1
        ctx.fillText(`${dd}/${mo}`, x, PAD_T + cH + 13)
        ctx.fillText(`${hh}:${mm}`, x, PAD_T + cH + 24)
      } else {
        ctx.fillText(`${hh}:${mm}`, x, PAD_T + cH + 15)
      }
    }

    // Axe X horizontal
    ctx.strokeStyle = '#2A3548'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(PAD_L, PAD_T + cH + 0.5); ctx.lineTo(W - PAD_R, PAD_T + cH + 0.5); ctx.stroke()

    // ── Tracé des lignes (clippé à la zone graphique) ──
    ctx.save()
    ctx.beginPath(); ctx.rect(PAD_L + 1, PAD_T, cW - 1, cH); ctx.clip()

    for (const ln of SEG_LINES_CFG) {
      ctx.beginPath()
      pts.forEach((p, i) => {
        const x = toX(i), y = toY(p[ln.key] as number)
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      })
      ctx.strokeStyle = ln.color; ctx.lineWidth = ln.lw; ctx.globalAlpha = 0.9
      ctx.stroke(); ctx.globalAlpha = 1
    }
    ctx.restore()

  }, [pts])

  if (pts.length < 2) return (
    <div style={{ height: H_CANVAS, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tm-text-muted)', fontSize: 12, background: '#080C14', borderRadius: 8 }}>
      {t('analyse.awaitingData')}…
    </div>
  )
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        {SEG_LINES_CFG.map(ln => (
          <div key={ln.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 16, height: 2, background: ln.color, borderRadius: 1 }} />
            <span style={{ fontSize: 9, color: ln.color, fontFamily: 'JetBrains Mono,monospace' }}>{ln.label}</span>
            <span style={{ fontSize: 9, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono,monospace' }}>({ln.range})</span>
          </div>
        ))}
      </div>
      <canvas ref={ref} style={{ width: '100%', height: H_CANVAS, borderRadius: 8, display: 'block' }} />
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

// ── ChartAndOscillators — layout TradingView-like avec mode plein écran ────
function ChartAndOscillators({
  symbol, isCrypto, syncEnabled, setSyncEnabled, syncInterval, setSyncInterval,
  syncRange, setSyncRange, syncRangeFromOsc, handleOscViewport, handleCrosshairChange,
  crosshairFrac, chartAreaRatio, fullscreen, setFullscreen,
  panelHeights, setPanelHeights, showWT, setShowWT, showVMC, setShowVMC, showRSI, setShowRSI, t
}: {
  symbol: string; isCrypto: boolean
  syncEnabled: boolean; setSyncEnabled: React.Dispatch<React.SetStateAction<boolean>>
  syncInterval: string; setSyncInterval: React.Dispatch<React.SetStateAction<string>>
  syncRange: {from:number;to:number}|null; setSyncRange: React.Dispatch<React.SetStateAction<{from:number;to:number}|null>>
  syncRangeFromOsc: {from:number;to:number}|null
  handleOscViewport: (f:number,t:number) => void
  handleCrosshairChange: (d:{frac:number;areaRatio:number}|null) => void
  crosshairFrac: number|null; chartAreaRatio: number
  fullscreen: boolean; setFullscreen: React.Dispatch<React.SetStateAction<boolean>>
  panelHeights: {main:number;wt:number;vmc:number;rsi:number}
  setPanelHeights: React.Dispatch<React.SetStateAction<{main:number;wt:number;vmc:number;rsi:number}>>
  showWT: boolean; setShowWT: React.Dispatch<React.SetStateAction<boolean>>
  showVMC: boolean; setShowVMC: React.Dispatch<React.SetStateAction<boolean>>
  showRSI: boolean; setShowRSI: React.Dispatch<React.SetStateAction<boolean>>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any
}) {
  // Drag-to-resize handle
  const startDrag = (panelA: keyof typeof panelHeights, panelB: keyof typeof panelHeights, e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const hA0 = panelHeights[panelA]
    const hB0 = panelHeights[panelB]
    // total available px (fullscreen viewport - controlbar ~36px)
    const totalPx = window.innerHeight - 36
    const onMove = (ev: MouseEvent) => {
      const deltaPx = ev.clientY - startY
      const deltaPct = (deltaPx / totalPx) * 100
      const newA = Math.max(10, Math.min(85, hA0 + deltaPct))
      const newB = Math.max(5,  Math.min(85, hB0 - deltaPct))
      setPanelHeights(prev => ({ ...prev, [panelA]: newA, [panelB]: newB }))
    }
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const DIVIDER = <div
    style={{height:5,background:'#1E2330',cursor:'row-resize',flexShrink:0,position:'relative'}}
    onMouseEnter={e=>(e.currentTarget.style.background='var(--tm-accent)')}
    onMouseLeave={e=>(e.currentTarget.style.background='#1E2330')}
  />

  const controlBar = (
    <div style={{display:'flex',alignItems:'center',gap:8,padding:'5px 10px',background:'var(--tm-bg-secondary)',borderBottom:'1px solid var(--tm-border)',flexWrap:'wrap',flexShrink:0}}>
      <span style={{fontSize:10,color:'var(--tm-text-muted)',fontFamily:'JetBrains Mono, monospace',flexShrink:0}}>🔗 Sync</span>
      <button onClick={() => setSyncEnabled((p: boolean) => !p)} style={{padding:'2px 10px',borderRadius:20,fontSize:10,fontWeight:600,cursor:'pointer',border:`1px solid ${syncEnabled?'var(--tm-accent)':'var(--tm-border)'}`,background:syncEnabled?'rgba(0,229,255,0.12)':'transparent',color:syncEnabled?'var(--tm-accent)':'var(--tm-text-muted)',transition:'all 0.15s'}}>
        {syncEnabled ? t('analyse.syncEnabled') : t('analyse.syncDisabled')}
      </button>
      {syncEnabled && <span style={{fontSize:9,color:'var(--tm-text-muted)',fontFamily:'JetBrains Mono, monospace'}}>{`UT: ${syncInterval} · ${t('analyse.zoomPanShared')}`}</span>}
      <div style={{marginLeft:'auto',display:'flex',gap:4,alignItems:'center'}}>
        {([['WT',showWT,setShowWT],['VMC',showVMC,setShowVMC],['RSI',showRSI,setShowRSI]] as [string,boolean,React.Dispatch<React.SetStateAction<boolean>>][]).map(([label,on,setter])=>(
          <button key={label} onClick={()=>setter((p:boolean)=>!p)} style={{padding:'2px 8px',borderRadius:5,fontSize:9,fontWeight:700,cursor:'pointer',border:`1px solid ${on?'var(--tm-accent)':'var(--tm-border)'}`,background:on?'rgba(0,229,255,0.1)':'transparent',color:on?'var(--tm-accent)':'var(--tm-text-muted)',transition:'all 0.15s'}}>{label}</button>
        ))}
        <div style={{width:1,height:12,background:'var(--tm-border)',margin:'0 2px'}}/>
        <button onClick={() => setFullscreen((f:boolean) => !f)} title={fullscreen?'Quitter plein écran':'Plein écran'} style={{padding:'2px 8px',borderRadius:5,fontSize:13,cursor:'pointer',border:`1px solid ${fullscreen?'var(--tm-profit)':'var(--tm-border)'}`,background:fullscreen?'rgba(34,199,89,0.1)':'transparent',color:fullscreen?'var(--tm-profit)':'var(--tm-text-muted)',transition:'all 0.15s'}}>
          {fullscreen ? '⊡' : '⛶'}
        </button>
      </div>
    </div>
  )

  // Normal (non-fullscreen) panels — fixed heights, no autoHeight
  const normalPanels = (
    <>
      <ChartLayout
        symbol={symbol} isCrypto={isCrypto}
        onTimeframeChange={setSyncInterval}
        onVisibleRangeChange={syncEnabled ? (f,to) => setSyncRange({from:f,to}) : undefined}
        syncRangeIn={syncEnabled ? syncRangeFromOsc : null}
        onCrosshairChange={handleCrosshairChange}
        chartHeight={430}
      />
      {showWT && <WaveTrendChart symbol={symbol} syncInterval={syncEnabled?syncInterval:undefined} visibleRange={syncEnabled?syncRange:null} onViewportChange={syncEnabled?handleOscViewport:undefined} crosshairFrac={crosshairFrac} chartAreaRatio={chartAreaRatio} chartHeight={180} />}
      {showVMC && <VMCOscillatorChart symbol={symbol} syncInterval={syncEnabled?syncInterval:undefined} visibleRange={syncEnabled?syncRange:null} onViewportChange={syncEnabled?handleOscViewport:undefined} crosshairFrac={crosshairFrac} chartAreaRatio={chartAreaRatio} chartHeight={230} />}
      {showRSI && <RsiEliteChart symbol={symbol} syncInterval={syncEnabled?syncInterval:undefined} visibleRange={syncEnabled?syncRange:null} onViewportChange={syncEnabled?handleOscViewport:undefined} crosshairFrac={crosshairFrac} chartAreaRatio={chartAreaRatio} chartHeight={240} />}
    </>
  )

  if (fullscreen) {
    // Determine the "previous visible panel" for each divider's drag source
    const prevOf = (panel: 'wt'|'vmc'|'rsi'): keyof typeof panelHeights => {
      if (panel === 'wt')  return 'main'
      if (panel === 'vmc') return showWT ? 'wt' : 'main'
      return showVMC ? 'vmc' : showWT ? 'wt' : 'main'
    }
    return (
      <div style={{position:'fixed',inset:0,zIndex:9999,background:'var(--tm-bg)',display:'flex',flexDirection:'column'}}>
        {controlBar}
        <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
          {/* Main chart panel */}
          <div style={{flex:panelHeights.main,overflow:'hidden',minHeight:60,display:'flex',flexDirection:'column'}}>
            <ChartLayout
              symbol={symbol} isCrypto={isCrypto}
              onTimeframeChange={setSyncInterval}
              onVisibleRangeChange={syncEnabled ? (f,to) => setSyncRange({from:f,to}) : undefined}
              syncRangeIn={syncEnabled ? syncRangeFromOsc : null}
              onCrosshairChange={handleCrosshairChange}
              autoHeight
            />
          </div>
          {showWT && <>
            {React.cloneElement(DIVIDER, {onMouseDown:(e:React.MouseEvent)=>startDrag('main','wt',e)})}
            <div style={{flex:panelHeights.wt,overflow:'hidden',minHeight:50,display:'flex',flexDirection:'column'}}>
              <WaveTrendChart symbol={symbol} syncInterval={syncEnabled?syncInterval:undefined} visibleRange={syncEnabled?syncRange:null} onViewportChange={syncEnabled?handleOscViewport:undefined} crosshairFrac={crosshairFrac} chartAreaRatio={chartAreaRatio} autoHeight />
            </div>
          </>}
          {showVMC && <>
            {React.cloneElement(DIVIDER, {onMouseDown:(e:React.MouseEvent)=>startDrag(prevOf('vmc'),'vmc',e)})}
            <div style={{flex:panelHeights.vmc,overflow:'hidden',minHeight:50,display:'flex',flexDirection:'column'}}>
              <VMCOscillatorChart symbol={symbol} syncInterval={syncEnabled?syncInterval:undefined} visibleRange={syncEnabled?syncRange:null} onViewportChange={syncEnabled?handleOscViewport:undefined} crosshairFrac={crosshairFrac} chartAreaRatio={chartAreaRatio} autoHeight />
            </div>
          </>}
          {showRSI && <>
            {React.cloneElement(DIVIDER, {onMouseDown:(e:React.MouseEvent)=>startDrag(prevOf('rsi'),'rsi',e)})}
            <div style={{flex:panelHeights.rsi,overflow:'hidden',minHeight:40,display:'flex',flexDirection:'column'}}>
              <RsiEliteChart symbol={symbol} syncInterval={syncEnabled?syncInterval:undefined} visibleRange={syncEnabled?syncRange:null} onViewportChange={syncEnabled?handleOscViewport:undefined} crosshairFrac={crosshairFrac} chartAreaRatio={chartAreaRatio} autoHeight />
            </div>
          </>}
        </div>
      </div>
    )
  }

  return (
    <div style={{marginBottom:16}}>
      <div style={{border:'1px solid var(--tm-border)',borderRadius:10,overflow:'hidden'}}>
        {controlBar}
        {normalPanels}
      </div>
    </div>
  )
}

// ── ChartLayout — LightweightChart uniquement (zoom/pan sync bidirectionnel) ──
function ChartLayout({ symbol, isCrypto, onTimeframeChange, onVisibleRangeChange, syncRangeIn, onCrosshairChange, chartHeight, autoHeight }: {
  symbol: string; isCrypto: boolean
  onTimeframeChange?: (interval: string) => void
  onVisibleRangeChange?: (from: number, to: number) => void
  syncRangeIn?: {from: number; to: number} | null
  onCrosshairChange?: (data: { frac: number; areaRatio: number } | null) => void
  chartHeight?: number
  autoHeight?: boolean
}) {
  return (
    <LightweightChart
      symbol={symbol}
      isCrypto={isCrypto}
      onTimeframeChange={onTimeframeChange}
      onVisibleRangeChange={onVisibleRangeChange}
      syncRangeIn={syncRangeIn}
      onCrosshairChange={onCrosshairChange}
      chartHeight={chartHeight}
      autoHeight={autoHeight}
    />
  )
}

export default function AnalysePage() {
  const { t } = useTranslation()
  const [symbol, setSymbol] = useState(() => {
    // Read symbol passed from Marchés page via localStorage
    const stored = localStorage.getItem('tm_analyse_symbol')
    if (stored) { localStorage.removeItem('tm_analyse_symbol'); return stored }
    return ''
  })
  const [mode,   setMode]   = useState<Mode>('micro')
  const [syncInterval,     setSyncInterval]     = useState<string>('1h')
  const [syncRange,        setSyncRange]        = useState<{from:number;to:number}|null>(null)
  const [syncRangeFromOsc, setSyncRangeFromOsc] = useState<{from:number;to:number}|null>(null)
  // Toggle synchronisation UT + viewport entre LightweightChart et oscillateurs
  const [syncEnabled, setSyncEnabled] = useState(true)
  // Fullscreen TradingView-like mode
  const [fullscreen, setFullscreen] = useState(false)
  // Panels visibles en fullscreen (hauteurs relatives en %)
  const [panelHeights, setPanelHeights] = useState({ main: 55, wt: 18, vmc: 18, rsi: 9 })
  const [showWT,  setShowWT]  = useState(true)
  const [showVMC, setShowVMC] = useState(true)
  const [showRSI, setShowRSI] = useState(true)
  const dragRef = useRef<{panel: string; startY: number; startH: number; nextH: number} | null>(null)
  const [crosshairFrac,    setCrosshairFrac]    = useState<number|null>(null)
  const [chartAreaRatio,   setChartAreaRatio]   = useState<number>(0.93) // 0.93 = approximation initiale

  // ── Monitor en arrière-plan : poll TOUS les TFs peu importe lequel est affiché ──
  useEffect(() => {
    if (!symbol) return
    backgroundMonitor.start(symbol)
    return () => backgroundMonitor.stop()
  }, [symbol])

  const handleCrosshairChange = useCallback((d: {frac:number; areaRatio:number}|null) => {
    if (d == null) { setCrosshairFrac(null); return }
    if (d.frac >= 0) setCrosshairFrac(d.frac)  // frac=-1 = resize event, ne pas effacer le crosshair
    if (d.areaRatio > 0 && d.areaRatio < 1) setChartAreaRatio(d.areaRatio)
  }, [])
  const handleOscViewport = useCallback((from:number, to:number) => {
    setSyncRangeFromOsc({ from, to })
  }, [])

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
  const [segHistTf,   setSegHistTf]   = useState('24h')

  // Dérivés state
  const [oi,        setOI]        = useState<OIData|null>(null)
  const [funding,   setFunding]   = useState<Funding|null>(null)
  const [derivLoad, setDerivLoad] = useState(false)

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
          tpsCnt.current++;priceRef.current=p;setPrice(p)
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
        const div=ps<-0.1&&cs>0?'trendBullish':ps>0.1&&cs<0?'trendBearish':'trendNone'
        setWtSummary({trend,trendColor:tc,netCVD:last.cum,momentum:ms,divergence:div})
      }).catch(()=>{})
  },[symbol,mode,wtTf])

  // ── Segmented CVD History — klines avec takerBuyVolume (historique conséquent) ──
  useEffect(() => {
    if (!symbol || !/USDT$|BUSD$|BTC$|ETH$|BNB$/i.test(symbol)) return
    setSegHistPts([])
    setSegHistLoad(true)

    // Paramètres selon timeframe choisi
    const TF_KLINES: Record<string, { interval: string; limit: number }> = {
      '4h':  { interval: '1m',  limit: 240 },
      '24h': { interval: '5m',  limit: 288 },
      '3j':  { interval: '15m', limit: 288 },
      '7j':  { interval: '30m', limit: 336 },
    }
    const { interval, limit } = TF_KLINES[segHistTf] ?? TF_KLINES['24h']

    // Calcul CVD segmenté à partir des klines (takerBuyBaseAssetVolume exact)
    const processKlines = (klines: unknown[][]) => {
      if (!Array.isArray(klines) || klines.length === 0) return
      // Volume moyen pour classer la bougie
      const vols = klines.map(k => parseFloat(k[5] as string))
      const avgVol = vols.reduce((a, b) => a + b, 0) / (vols.length || 1)

      const cum: SegHistPt = { t: 0, small: 0, medium: 0, large: 0, institutional: 0, whales: 0 }
      const pts: SegHistPt[] = klines.map(k => {
        const t       = Number(k[0])
        const close   = parseFloat(k[4] as string)
        const vol     = parseFloat(k[5] as string)                    // base asset vol
        const buyBase = parseFloat(k[9] as string)                    // taker buy base vol (exact)
        const buyVol  = buyBase * close
        const sellVol = (vol - buyBase) * close
        const delta   = buyVol - sellVol
        const ratio   = avgVol > 0 ? vol / avgVol : 1

        // Segmentation par intensité relative de volume
        if      (ratio >= 3)   cum.whales        += delta
        else if (ratio >= 2)   cum.institutional += delta
        else if (ratio >= 1.5) cum.large         += delta
        else if (ratio >= 0.7) cum.medium        += delta
        else                   cum.small         += delta

        return { t, small: cum.small, medium: cum.medium, large: cum.large, institutional: cum.institutional, whales: cum.whales }
      })
      setSegHistPts(pts)
    }

    const doFetch = async () => {
      try {
        // Futures d'abord (volume + précis, takerBuy disponible)
        const r1 = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`)
        const d1 = await r1.json() as unknown
        if (Array.isArray(d1) && d1.length > 0) { processKlines(d1 as unknown[][]); return }
        // Fallback spot
        const r2 = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`)
        const d2 = await r2.json() as unknown
        if (Array.isArray(d2)) processKlines(d2 as unknown[][])
      } catch { /* réseau indisponible */ } finally { setSegHistLoad(false) }
    }
    void doFetch()
  }, [symbol, segHistTf])

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
      const bias=rate>0.05?'cvdBullOverheat':rate>0.01?'cvdBullBias':rate<-0.05?'cvdBearOverheat':rate<-0.01?'cvdBearBias':'cvdNeutral'
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
  const biasLabel=bullConf>bearConf?t('analyse.trendBullish'):bearConf>bullConf?t('analyse.trendBearish'):t('analyse.neutral')
  const biasColor=bullConf>bearConf?'var(--tm-profit)':bearConf>bullConf?'var(--tm-loss)':'var(--tm-text-secondary)'

  const isCrypto = isCryptoSymbol(symbol)

  const C = {
    card: {background:'var(--tm-bg-secondary)',border:'1px solid #1E2330',borderRadius:14,overflow:'hidden' as const,position:'relative' as const},
    top: {position:'absolute' as const,top:0,left:0,right:0,height:1,background:'linear-gradient(90deg,transparent,rgba(255,255,255,0.05),transparent)'},
    p: '10px 14px',
  }

  return (
    <div style={{padding:'28px 28px 40px',maxWidth:1600,margin:'0 auto'}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>

      {/* Header */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20,flexWrap:'wrap',gap:14}}>
        <div>
          <h1 style={{fontSize:24,fontWeight:700,color:'var(--tm-text-primary)',margin:0,fontFamily:'Syne,sans-serif',letterSpacing:'-0.02em'}}>Analyse</h1>
          <p style={{fontSize:13,color:'var(--tm-text-muted)',margin:'4px 0 0'}}>
            {!symbol ? t('analyse.searchToBegin') : isCrypto ? t('analyse.cryptoSubtitle') : t('analyse.nonCryptoSubtitle')}
          </p>
        </div>
        <SymbolSearch symbol={symbol} onSelect={s=>{const ns=normalizeForexSymbol(s);setSymbol(ns);setCvdPts([]);Object.keys(cvdAcc.current).forEach(k=>(cvdAcc.current as Record<string,number>)[k]=0)}} />
      </div>

      {/* État vide — deux colonnes : recherche | analyse photo */}
      {!symbol && (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,alignItems:'start'}}>

          {/* ── Colonne gauche : recherche par symbole ── */}
          <div>
            {/* Hero */}
            <div style={{textAlign:'center',padding:'32px 20px 24px'}}>
              <div style={{width:56,height:56,borderRadius:18,background:'linear-gradient(135deg,rgba(var(--tm-accent-rgb,0,229,255),0.15),rgba(var(--tm-purple-rgb,191,90,242),0.15))',display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,margin:'0 auto 14px',border:'1px solid rgba(var(--tm-accent-rgb,0,229,255),0.2)'}}>📊</div>
              <div style={{fontSize:18,fontWeight:700,color:'var(--tm-text-primary)',marginBottom:6,fontFamily:'Syne,sans-serif'}}>{t('analyse.heroSearchTitle')}</div>
              <div style={{fontSize:12,color:'var(--tm-text-muted)',maxWidth:340,margin:'0 auto'}}>{t('analyse.heroSearchSub')}</div>
            </div>

            {/* Accès rapide */}
            <div style={{display:'grid',gridTemplateColumns:'1fr',gap:8,marginBottom:16}}>
              {[
                {title:'🪙 Crypto',items:[{s:'BTCUSDT',n:'Bitcoin'},{s:'ETHUSDT',n:'Ethereum'},{s:'SOLUSDT',n:'Solana'},{s:'BNBUSDT',n:'BNB'}]},
                {title:t('analyse.categoryStocks'),items:[{s:'AAPL',n:'Apple'},{s:'TSLA',n:'Tesla'},{s:'MSFT',n:'Microsoft'},{s:'NVDA',n:'Nvidia'}]},
                {title:t('analyse.categoryForex'),items:[{s:'EURUSD=X',n:'EUR/USD',d:'EURUSD'},{s:'GC=F',n:'Or (Gold)',d:'Gold'},{s:'^FCHI',n:'CAC 40',d:'^FCHI'},{s:'MC.PA',n:'LVMH',d:'MC.PA'}]},
              ].map(cat=>(
                <div key={cat.title} style={{background:'var(--tm-bg-secondary)',border:'1px solid #1E2330',borderRadius:14,overflow:'hidden'}}>
                  <div style={{padding:'8px 14px',borderBottom:'1px solid #1E2330'}}>
                    <span style={{fontSize:11,fontWeight:700,color:'var(--tm-text-primary)'}}>{cat.title}</span>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',padding:'4px 0'}}>
                    {cat.items.map(item=>(
                      <button key={item.s} onClick={()=>{setSymbol(item.s);setCvdPts([]);Object.keys(cvdAcc.current).forEach(k=>(cvdAcc.current as Record<string,number>)[k]=0)}}
                        style={{display:'flex',alignItems:'center',gap:8,padding:'7px 14px',background:'transparent',border:'none',cursor:'pointer',textAlign:'left'}}
                        onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='rgba(255,255,255,0.03)'}
                        onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='transparent'}>
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
                {label:t('common.search'),keys:t('analyse.clickBar')},
                {label:t('analyse.cryptoQuick'),keys:'BTC, ETH, SOL...'},
                {label:t('analyse.actionsQuick'),keys:'AAPL, TSLA, NVDA...'},
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
              <div style={{fontSize:18,fontWeight:700,color:'var(--tm-text-primary)',marginBottom:6,fontFamily:'Syne,sans-serif'}}>{t('analyse.screenshotTitle')}</div>
              <div style={{fontSize:12,color:'var(--tm-text-muted)',maxWidth:340,margin:'0 auto'}}>{t('analyse.screenshotHeroSub')}</div>
            </div>
            <ChartScreenshotAnalysis />
          </div>

        </div>
      )}

      {/* ══ CHART + OSCILLATEURS ══ */}
      {symbol && <ChartAndOscillators
        symbol={symbol}
        isCrypto={isCryptoSymbol(symbol)}
        syncEnabled={syncEnabled} setSyncEnabled={setSyncEnabled}
        syncInterval={syncInterval} setSyncInterval={setSyncInterval}
        syncRange={syncRange} setSyncRange={setSyncRange}
        syncRangeFromOsc={syncRangeFromOsc}
        handleOscViewport={handleOscViewport}
        handleCrosshairChange={handleCrosshairChange}
        crosshairFrac={crosshairFrac} chartAreaRatio={chartAreaRatio}
        fullscreen={fullscreen} setFullscreen={setFullscreen}
        panelHeights={panelHeights} setPanelHeights={setPanelHeights}
        showWT={showWT} setShowWT={setShowWT}
        showVMC={showVMC} setShowVMC={setShowVMC}
        showRSI={showRSI} setShowRSI={setShowRSI}
        t={t}
      />}

      {/* Plan de Trade IA — tous les actifs */}
      {symbol && <ShareWrapper label="Trade Plan">
        <TradePlanCard
          symbol={symbol}
          price={0}
          mtfScore={0}
          mtfSignal="NEUTRAL"
          wtStatus="Neutral"
          vmcStatus="NEUTRAL"
        />
      </ShareWrapper>}

      {/* MTF Dashboard — tous les actifs */}
      {symbol && <ShareWrapper label="MTF Dashboard">
        <MTFDashboard symbol={symbol} />
      </ShareWrapper>}

      {/* ══ NIVEAUX CLÉS AUTO + SCREENSHOT IA — tous les actifs ══ */}
      {symbol && <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
        <ShareWrapper label={t('analyse.keyLevels')}><KeyLevelsCard symbol={symbol} /></ShareWrapper>
        <ChartScreenshotAnalysis symbol={symbol} />
      </div>}

      {/* ══ CRYPTO ONLY ══ Heatmap + CVD/Structure/Dérivés */}
      {isCrypto && <>
        {/* Heatmap */}
        <ShareWrapper label="Liquidation Heatmap"><LiquidationHeatmap symbol={symbol} /></ShareWrapper>

        {/* Mode tabs */}
        <div style={{display:'flex',background:'var(--tm-bg)',borderRadius:12,padding:3,marginBottom:16,border:'1px solid #1E2330',width:'fit-content'}}>
          {([
            {id:'micro',    icon:'📊',label:t('analyse.microLabel'),    sub:t('analyse.microSub')},
            {id:'structure',icon:'🐋',label:'Structure', sub:'Tendance baleine'},
            {id:'derivees', icon:'📈',label:t('analyse.deriveesLabel'),   sub:t('analyse.deriveesSub')},
          ] as {id:Mode;icon:string;label:string;sub:string}[]).map(m=>(
            <button key={m.id} onClick={()=>setMode(m.id)} style={{display:'flex',alignItems:'center',gap:8,padding:'9px 20px',borderRadius:10,border:'none',cursor:'pointer',background:mode===m.id?'var(--tm-accent)':'transparent',transition:'all 0.15s'}}>
              <span style={{fontSize:14}}>{m.icon}</span>
              <div style={{textAlign:'left'}}>
                <div style={{fontSize:12,fontWeight:600,color:mode===m.id?'var(--tm-bg)':'var(--tm-text-secondary)'}}>{m.label}</div>
                <div style={{fontSize:9,color:mode===m.id?'rgba(0,0,0,0.6)':'var(--tm-text-muted)'}}>{m.sub}</div>
              </div>
            </button>
          ))}
        </div>
      </>}

      {/* ── MICRO — crypto only ── */}
      {isCrypto&&mode==='micro'&&<div style={{display:'flex',flexDirection:'column',gap:12}}>
        {/* Summary Banner */}
        <div style={{...C.card,padding:C.p}}>
          <div style={C.top}/>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
            <div><div style={{fontSize:14,fontWeight:700,color:biasColor}}>{biasLabel}</div><div style={{fontSize:10,color:'var(--tm-text-muted)'}}>{bullConf+bearConf>0?t('analyse.confirmations', {count: Math.max(bullConf,bearConf)}):t('analyse.awaitingDataShort')}</div></div>
            <div style={{display:'flex',gap:6}}>
              {pressure&&Math.abs(pressure.score)>0.1&&<span style={{fontSize:10,fontWeight:700,color:pressure.score>0?'var(--tm-profit)':'var(--tm-loss)',background:`${pressure.score>0?'var(--tm-profit)':'var(--tm-loss)'}`,padding:'2px 8px',borderRadius:5}}>CVD {pressure.score>0?'↑':'↓'}</span>}
              {pressure&&Math.abs(pressure.score)>0.1&&<span style={{fontSize:10,fontWeight:700,color:'var(--tm-accent)',background:'rgba(var(--tm-accent-rgb,0,229,255),0.1)',padding:'2px 8px',borderRadius:5}}>Whales</span>}
              {traps.filter(t=>t.conf>=0.55).length>0&&<span style={{fontSize:10,fontWeight:700,color:'var(--tm-warning)',background:'rgba(var(--tm-warning-rgb,255,149,0),0.1)',padding:'2px 8px',borderRadius:5}}>Trap ×{traps.filter(t=>t.conf>=0.55).length}</span>}
            </div>
          </div>
        </div>

        {/* CVD Panel */}
        <ShareWrapper label={`CVD ${symbol}`}>
        <div style={C.card}><div style={C.top}/>
          <div style={{padding:C.p}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,flexWrap:'wrap',gap:8}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:12,fontWeight:600,color:'var(--tm-text-primary)'}}>CVD Segmenté</span>
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
                return<button key={seg} onClick={()=>setSegs(prev=>on?prev.filter(s=>s!==seg):[...prev,seg])} style={{display:'flex',flexDirection:'column',alignItems:'center',padding:'5px 10px',borderRadius:8,fontSize:10,fontWeight:600,cursor:'pointer',border:`1px solid ${on?cfg.color:'var(--tm-border)'}`,background:on?cfg.color+'20':'var(--tm-bg-tertiary)',color:on?cfg.color:'var(--tm-text-muted)',transition:'all 0.15s',minWidth:60}}>
                  <span style={{marginBottom:2}}>{cfg.label}</span>
                  <span style={{fontSize:9,fontFamily:'JetBrains Mono,monospace',fontWeight:700,color:val>=0?'var(--tm-profit)':'var(--tm-loss)'}}>{val>=0?'+':''}{fmtU(val)}</span>
                </button>
              })}
            </div>
            <CVDChart pts={cvdPts} segs={segs}/>
            {/* Historique CVD par taille d'ordre — toujours visible */}
            <div style={{marginTop:14,paddingTop:12,borderTop:'1px solid #1E2330'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8,flexWrap:'wrap',gap:6}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:11,fontWeight:600,color:'var(--tm-text-secondary)'}}>📊 CVD Historique par taille</span>
                  {segHistLoad&&<div style={{width:10,height:10,border:'2px solid #2A2F3E',borderTopColor:'var(--tm-accent)',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>}
                </div>
                <div style={{display:'flex',gap:4}}>
                  {(['4h','24h','3j','7j'] as const).map(tf=>(
                    <button key={tf} onClick={()=>setSegHistTf(tf)} style={{padding:'2px 9px',borderRadius:5,fontSize:9,fontWeight:600,cursor:'pointer',border:`1px solid ${segHistTf===tf?'var(--tm-accent)':'var(--tm-border)'}`,background:segHistTf===tf?'rgba(0,229,255,0.1)':'var(--tm-bg-tertiary)',color:segHistTf===tf?'var(--tm-accent)':'var(--tm-text-muted)',transition:'all 0.15s'}}>{tf}</button>
                  ))}
                </div>
              </div>
              <SegmentedCVDHistoryChart pts={segHistPts}/>
            </div>
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
        </ShareWrapper>

        {/* Order Flow */}
        <div style={C.card}><div style={C.top}/>
          <div style={{padding:C.p}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
              <div style={{display:'flex',alignItems:'center',gap:6}}><span>⚡</span><span style={{fontSize:12,fontWeight:600,color:'var(--tm-text-primary)'}}>Order-Flow Intelligence</span></div>
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
        <div style={C.card}><div style={C.top}/>
          <div style={{padding:C.p}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
              <span style={{fontSize:12,fontWeight:600,color:'var(--tm-text-primary)'}}>🔍 Absorption</span>
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
        <div style={C.card}><div style={C.top}/>
          <div style={{padding:C.p}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
              <span style={{fontSize:12,fontWeight:600,color:'var(--tm-text-primary)'}}>⚠️ Liquidity Traps</span>
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
      {isCrypto&&mode==='structure'&&<div style={{display:'flex',flexDirection:'column',gap:12}}>
        <div style={C.card}><div style={C.top}/>
          <div style={{padding:C.p}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span>🐋</span><span style={{fontSize:13,fontWeight:600,color:'var(--tm-text-primary)'}}>Whale CVD Structurel</span>
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
              {[{l:'CVD Net',v:`${wtSummary.netCVD>=0?'+':''}${fmtU(wtSummary.netCVD)}`,c:wtSummary.netCVD>=0?'var(--tm-profit)':'var(--tm-loss)'},{l:'Divergence',v:t(`analyse.${wtSummary.divergence}`),c:wtSummary.divergence==='trendBullish'?'var(--tm-profit)':wtSummary.divergence==='trendBearish'?'var(--tm-loss)':'var(--tm-text-secondary)'},{l:'Momentum',v:`${(wtSummary.momentum*100).toFixed(0)}%`,c:wtSummary.momentum>=0?'var(--tm-profit)':'var(--tm-loss)'},{l:'Dominance',v:'30%',c:'#FFA726'}].map(({l,v,c})=>(
                <div key={l} style={{background:'var(--tm-bg-tertiary)',borderRadius:8,padding:'8px',textAlign:'center'}}><div style={{fontSize:9,color:'var(--tm-text-muted)',marginBottom:2}}>{l}</div><div style={{fontSize:12,fontWeight:600,color:c}}>{v}</div></div>
              ))}
            </div>}
          </div>
        </div>

      </div>}

      {/* ── DÉRIVÉS ── */}
      {isCrypto&&mode==='derivees'&&<div style={{display:'flex',flexDirection:'column',gap:12}}>
        {/* Confluence Card en premier */}
        <DerivativesConfluenceCard symbol={symbol}/>

        {derivLoad&&<div style={{textAlign:'center',padding:24,color:'var(--tm-text-muted)',fontSize:12}}>
          <div style={{width:20,height:20,border:'2px solid #2A2F3E',borderTopColor:'#F59714',borderRadius:'50%',animation:'spin 0.8s linear infinite',margin:'0 auto 8px'}}/>{t('common.loading')}
        </div>}

        {oi&&<div style={{...C.card,background:'rgba(245,151,20,0.04)',borderColor:'rgba(245,151,20,0.2)'}}>
          <div style={{...C.top,background:'linear-gradient(90deg,transparent,rgba(245,151,20,0.2),transparent)'}}/>
          <div style={{padding:C.p}}>
            <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:12}}>
              <span>📊</span><span style={{fontSize:13,fontWeight:600,color:'var(--tm-text-primary)'}}>Open Interest</span>
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

        {funding&&<div style={{...C.card,background:'rgba(66,165,245,0.04)',borderColor:'rgba(66,165,245,0.18)'}}>
          <div style={{...C.top,background:'linear-gradient(90deg,transparent,rgba(66,165,245,0.15),transparent)'}}/>
          <div style={{padding:C.p}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
              <div style={{display:'flex',alignItems:'center',gap:6}}><span>💸</span><span style={{fontSize:13,fontWeight:600,color:'var(--tm-text-primary)'}}>Funding Rate & Basis</span></div>
              <span style={{fontSize:10,color:'#42A5F5',background:'rgba(66,165,245,0.1)',padding:'2px 8px',borderRadius:5}}>prochain {funding.nextIn}</span>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <div>
                <div style={{fontSize:26,fontWeight:700,fontFamily:'JetBrains Mono,monospace',color:funding.rate>0?'var(--tm-warning)':funding.rate<0?'var(--tm-profit)':'var(--tm-text-secondary)'}}>{funding.rate>0?'+':''}{funding.rate.toFixed(4)}%<span style={{fontSize:11,color:'var(--tm-text-muted)',marginLeft:4}}>/8h</span></div>
                <div style={{fontSize:11,color:'var(--tm-text-muted)'}}>Taux de financement</div>
              </div>
              <div style={{fontSize:12,fontWeight:700,color:funding.isWarning?'var(--tm-loss)':'var(--tm-text-secondary)',background:`${funding.isWarning?'var(--tm-loss)':'var(--tm-text-secondary)'}`,padding:'5px 12px',borderRadius:8,border:`1px solid ${funding.isWarning?'rgba(var(--tm-loss-rgb,255,59,48),0.3)':'var(--tm-border)'}`}}>{t(`analyse.${funding.bias}`)}</div>
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
      </div>}

    </div>
  )
}
