// src/pages/marches/MarchesPage.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Page Marchés — RSI Heatmap Crypto + Actions
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'
import RsiHeatmap from '@/pages/analyse/RsiHeatmap'

const fbFunctions = getFunctions(app, 'europe-west1')

// ── Types ────────────────────────────────────────────────────────────────────

interface TokenRSI {
  symbol: string
  rsi: number
  change24h: number
  volume: number
  price: number
}

interface YahooCandle { t: number; o: number; h: number; l: number; c: number; v: number }

// ── RSI helper ───────────────────────────────────────────────────────────────

function calcRSI(closes: number[], period = 14): number {
  if (closes.length <= period) return 50
  let gains = 0, losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) gains += d; else losses -= d
  }
  const avgG = gains / period, avgL = losses / period
  if (avgL === 0) return 100
  return +(100 - 100 / (1 + avgG / avgL)).toFixed(2)
}

// ── Crypto symbols (top 30) ──────────────────────────────────────────────────

const CRYPTO_SYMBOLS = [
  'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','AVAXUSDT',
  'DOTUSDT','LINKUSDT','UNIUSDT','ATOMUSDT','APTUSDT','ARBUSDT','OPUSDT','SUIUSDT',
  'INJUSDT','NEARUSDT','AAVEUSDT','MKRUSDT','CRVUSDT','LDOUSDT','RUNEUSDT','SHIBUSDT',
  'PEPEUSDT','WIFUSDT','BONKUSDT','TAOUSDT','RENDERUSDT','FETUSDT',
]

// ── Stock groups ─────────────────────────────────────────────────────────────

const STOCK_GROUPS: { label: string; symbols: string[] }[] = [
  { label: 'US Tech',       symbols: ['AAPL','MSFT','GOOGL','AMZN','META','NVDA','AMD','TSLA','NFLX','ORCL','CRM','ADBE','INTC','QCOM','UBER','PYPL'] },
  { label: 'US Finance',    symbols: ['JPM','GS','MS','BAC','V','MA','COIN','WFC'] },
  { label: 'US Healthcare', symbols: ['JNJ','UNH','PFE','LLY','ABBV','MRK'] },
  { label: 'US Industrie',  symbols: ['XOM','CVX','BA','CAT','GE','HON'] },
  { label: 'CAC 40',        symbols: ['TTE.PA','BNP.PA','SAN.PA','AIR.PA','MC.PA','AXA.PA','ORA.PA','SGO.PA','DG.PA','AI.PA'] },
  { label: 'DAX',           symbols: ['SAP.DE','SIE.DE','ALV.DE','BMW.DE','MBG.DE','BAS.DE','BAYN.DE','DTE.DE','VOW3.DE'] },
]

// ── Crypto fetcher ────────────────────────────────────────────────────────────

async function fetchCryptoRSI(symbols: string[]): Promise<TokenRSI[]> {
  const results = await Promise.allSettled(
    symbols.map(async sym => {
      const url = `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1d&limit=16`
      const r = await fetch(url)
      const rows: unknown[][] = await r.json()
      if (!Array.isArray(rows) || rows.length < 2) return null
      const closes = rows.map(k => parseFloat(k[4] as string))
      const volumes = rows.map(k => parseFloat(k[7] as string)) // quote volume
      const last = closes[closes.length - 1]
      const prev = closes[closes.length - 2]
      return {
        symbol: sym.replace('USDT', ''),
        rsi: calcRSI(closes),
        change24h: +((last - prev) / prev * 100).toFixed(2),
        volume: volumes[volumes.length - 1],
        price: last,
      } satisfies TokenRSI
    })
  )
  return results.flatMap(r => (r.status === 'fulfilled' && r.value ? [r.value] : []))
}

// ── Stock fetcher (via Yahoo Finance cloud function) ──────────────────────────

type YahooFn = { s: string; candles: YahooCandle[] }

async function fetchStockRSI(symbol: string): Promise<TokenRSI | null> {
  try {
    const fn = httpsCallable<Record<string, unknown>, YahooFn>(fbFunctions, 'fetchYahooCandles')
    const res = await fn({ symbol, interval: '1d', range: '1mo' })
    if (res.data.s !== 'ok' || !res.data.candles || res.data.candles.length < 3) return null
    const candles = res.data.candles
    const closes = candles.map(c => c.c)
    const last = candles[candles.length - 1]
    const prev = candles[candles.length - 2]
    const displaySym = symbol.replace(/\.(PA|DE|L|MI)$/, '')
    return {
      symbol: displaySym,
      rsi: calcRSI(closes),
      change24h: +((last.c - prev.c) / prev.c * 100).toFixed(2),
      volume: last.v,
      price: last.c,
    }
  } catch {
    return null
  }
}

// Fetch one group of stocks sequentially (to avoid rate limits)
async function fetchGroupRSI(symbols: string[]): Promise<TokenRSI[]> {
  const results: TokenRSI[] = []
  for (const sym of symbols) {
    const t = await fetchStockRSI(sym)
    if (t) results.push(t)
  }
  return results
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingGroup({ label, count }: { label: string; count: number }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tm-text-muted)', marginBottom: 6, padding: '0 2px' }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} style={{
            width: 76, height: 58, borderRadius: 7,
            background: 'var(--tm-bg-secondary)',
            border: '1px solid var(--tm-border-sub)',
            animation: 'pulse 1.5s ease-in-out infinite',
          }} />
        ))}
      </div>
    </div>
  )
}

// ── Stock tab content ─────────────────────────────────────────────────────────

function StocksTab({ onTokenClick }: { onTokenClick: (sym: string) => void }) {
  const [groupData, setGroupData] = useState<Record<string, TokenRSI[]>>({})
  const [loadedGroups, setLoadedGroups] = useState<Set<string>>(new Set())
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    // Fetch groups one by one, updating state progressively
    ;(async () => {
      for (const group of STOCK_GROUPS) {
        const tokens = await fetchGroupRSI(group.symbols)
        setGroupData(prev => ({ ...prev, [group.label]: tokens }))
        setLoadedGroups(prev => new Set([...prev, group.label]))
      }
    })()
  }, [])

  const allTokens = Object.values(groupData).flat()
  const allLoaded = loadedGroups.size === STOCK_GROUPS.length

  return (
    <div>
      {!allLoaded && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
          fontSize: 11, color: 'var(--tm-text-muted)',
          padding: '8px 12px', background: 'var(--tm-bg-secondary)',
          borderRadius: 8, border: '1px solid var(--tm-border-sub)',
        }}>
          <div style={{ width: 14, height: 14, border: '2px solid #2A2F3E', borderTopColor: 'var(--tm-accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
          Chargement des données boursières… ({loadedGroups.size}/{STOCK_GROUPS.length} groupes)
        </div>
      )}

      {/* Show loading skeletons for groups not yet loaded */}
      {STOCK_GROUPS.filter(g => !loadedGroups.has(g.label)).map(g => (
        <LoadingGroup key={g.label} label={g.label} count={g.symbols.length} />
      ))}

      {/* Use RsiHeatmap for all loaded tokens */}
      {allTokens.length > 0 && (
        <RsiHeatmap tokens={allTokens} defaultTimeframe="1d" onTokenClick={onTokenClick} />
      )}
    </div>
  )
}

// ── Crypto tab content ────────────────────────────────────────────────────────

function CryptoTab({ onTokenClick }: { onTokenClick: (sym: string) => void }) {
  const [tokens, setTokens] = useState<TokenRSI[]>([])
  const [loading, setLoading] = useState(true)
  const [tf, setTf] = useState<'5m'|'15m'|'1h'|'4h'|'1d'>('4h')

  useEffect(() => {
    setLoading(true)
    fetchCryptoRSI(CRYPTO_SYMBOLS).then(data => {
      setTokens(data)
      setLoading(false)
    })
  }, [tf])

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--tm-text-muted)' }}>
        <div style={{ width: 16, height: 16, border: '2px solid #2A2F3E', borderTopColor: 'var(--tm-accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        Chargement données Binance…
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {CRYPTO_SYMBOLS.map(s => (
          <div key={s} style={{ width: 76, height: 58, borderRadius: 7, background: 'var(--tm-bg-secondary)', border: '1px solid var(--tm-border-sub)', animation: 'pulse 1.5s ease-in-out infinite' }} />
        ))}
      </div>
    </div>
  )

  return <RsiHeatmap tokens={tokens} defaultTimeframe={tf} onTimeframeChange={setTf as (tf: string) => void} onTokenClick={onTokenClick} />
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════════

type Tab = 'crypto' | 'actions'

export default function MarchesPage() {
  const [tab, setTab] = useState<Tab>('crypto')
  const navigate = useNavigate()

  const handleTokenClick = (symbol: string) => {
    // For crypto: symbol is e.g. "BTC" → navigate to Analyse with "BTCUSDT"
    // For stocks: symbol is e.g. "AAPL" → navigate to Analyse with "AAPL"
    const isCrypto = tab === 'crypto'
    const analyseSymbol = isCrypto ? symbol + 'USDT' : symbol
    localStorage.setItem('tm_analyse_symbol', analyseSymbol)
    navigate('/analyse')
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
    fontSize: 13, fontWeight: active ? 600 : 400,
    background: active ? 'rgba(var(--tm-accent-rgb,0,229,255),0.1)' : 'transparent',
    color: active ? 'var(--tm-accent)' : 'var(--tm-text-muted)',
    borderBottom: active ? '2px solid var(--tm-accent)' : '2px solid transparent',
    transition: 'all 0.15s',
  })

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 20 }}>🌡️</span>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--tm-text-primary)', margin: 0, fontFamily: 'Syne, sans-serif' }}>
            Marchés
          </h1>
        </div>
        <p style={{ fontSize: 13, color: 'var(--tm-text-muted)', margin: 0 }}>
          Vue globale RSI — identifiez les zones de surachat et survente en un coup d'œil
        </p>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 20,
        borderBottom: '1px solid var(--tm-border-sub)',
      }}>
        <button onClick={() => setTab('crypto')} style={tabStyle(tab === 'crypto')}>
          🪙 Crypto
        </button>
        <button onClick={() => setTab('actions')} style={tabStyle(tab === 'actions')}>
          📈 Actions
        </button>
      </div>

      {/* Content */}
      <div style={{
        background: 'var(--tm-bg-card)',
        border: '1px solid var(--tm-border-sub)',
        borderRadius: 14, padding: 20,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg,transparent,var(--tm-accent),transparent)', opacity: 0.3 }} />
        {tab === 'crypto' && <CryptoTab onTokenClick={handleTokenClick} />}
        {tab === 'actions' && <StocksTab onTokenClick={handleTokenClick} />}
      </div>
    </div>
  )
}
