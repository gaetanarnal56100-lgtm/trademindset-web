// src/pages/marches/MarchesPage.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Page Marchés — RSI + VMC Heatmap for Crypto & Stocks
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'
import RsiHeatmap from '@/pages/analyse/RsiHeatmap'
import type { TokenRSI } from '@/pages/analyse/RsiHeatmap'

const fbFunctions = getFunctions(app, 'europe-west1')

// ── Types ────────────────────────────────────────────────────────────────────

interface YahooCandle { t: number; o: number; h: number; l: number; c: number; v: number }

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

// ── WaveTrend WT1 helper ─────────────────────────────────────────────────────
// Standard WaveTrend oscillator (same as VMC Cipher B) using OHLC candles.
// n1=10 (channel period), n2=21 (average period)

function calcWT1(candles: { o: number; h: number; l: number; c: number }[], n1 = 10, n2 = 21): number {
  try {
    if (candles.length < n1 + n2 + 5) return 0

    // EMA helper
    function ema(src: number[], period: number): number[] {
      if (src.length === 0) return []
      const k = 2 / (period + 1)
      const out: number[] = [src[0] ?? 0]
      for (let i = 1; i < src.length; i++) {
        out.push((src[i] ?? 0) * k + out[i - 1] * (1 - k))
      }
      return out
    }

    const hlc3 = candles.map(c => ((c.h ?? 0) + (c.l ?? 0) + (c.c ?? 0)) / 3)
    const esa = ema(hlc3, n1)
    const d = ema(hlc3.map((v, i) => Math.abs(v - (esa[i] ?? 0))), n1)
    const ci = hlc3.map((v, i) => {
      const di = d[i] ?? 0
      return di === 0 ? 0 : (v - (esa[i] ?? 0)) / (0.015 * di)
    })
    const tci = ema(ci, n2)
    if (!tci.length) return 0
    const last = tci[tci.length - 1]
    if (typeof last !== 'number' || isNaN(last)) return 0
    return +last.toFixed(2)
  } catch {
    return 0
  }
}

// ── Crypto symbols (~60) ──────────────────────────────────────────────────────

const CRYPTO_SYMBOLS = [
  // Majors
  'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','AVAXUSDT',
  // Mid-cap DeFi / L1-L2
  'DOTUSDT','LINKUSDT','UNIUSDT','ATOMUSDT','APTUSDT','ARBUSDT','OPUSDT','SUIUSDT',
  'INJUSDT','NEARUSDT','AAVEUSDT','MKRUSDT','CRVUSDT','LDOUSDT','RUNEUSDT',
  // Memes
  'SHIBUSDT','PEPEUSDT','WIFUSDT','BONKUSDT','FLOKIUSDT','TRUMPUSDT',
  // AI / Infra
  'TAOUSDT','RENDERUSDT','FETUSDT','WLDUSDT','ARKMUSDT',
  // Gaming / Metaverse
  'AXSUSDT','SANDUSDT','MANAUSDT','ENJUSDT',
  // Other top alts
  'LTCUSDT','BCHUSDT','ETCUSDT','FILUSDT','ICPUSDT','HBARUSDT',
  'ALGOUSDT','VETUSDT','XLMUSDT','TRXUSDT','TONUSDT',
  'STXUSDT','TIAUSDT','SEIUSDT','JUPUSDT','PYTHUSDT',
  'EIGENUSDT','MOODENGUSDT',
]

// ── Stock groups ─────────────────────────────────────────────────────────────

const STOCK_GROUPS: { label: string; symbols: string[] }[] = [
  {
    label: 'US Tech',
    symbols: ['AAPL','MSFT','GOOGL','AMZN','META','NVDA','AMD','TSLA','NFLX','ORCL',
              'CRM','ADBE','INTC','QCOM','UBER','PYPL','SHOP','SNOW','PLTR','MSTR'],
  },
  {
    label: 'US Finance',
    symbols: ['JPM','GS','MS','BAC','V','MA','COIN','WFC','BLK','C','AXP','SCHW'],
  },
  {
    label: 'US Healthcare',
    symbols: ['JNJ','UNH','PFE','LLY','ABBV','MRK','AMGN','GILD','BMY','CVS'],
  },
  {
    label: 'US Industrie & Énergie',
    symbols: ['XOM','CVX','BA','CAT','GE','HON','RTX','LMT','DE','MMM'],
  },
  {
    label: 'CAC 40',
    symbols: ['TTE.PA','BNP.PA','SAN.PA','AIR.PA','MC.PA','AXA.PA','ORA.PA',
              'SGO.PA','DG.PA','AI.PA','CAP.PA','KER.PA','RMS.PA','HO.PA'],
  },
  {
    label: 'DAX',
    symbols: ['SAP.DE','SIE.DE','ALV.DE','BMW.DE','MBG.DE','BAS.DE','BAYN.DE',
              'DTE.DE','VOW3.DE','ADS.DE','DBK.DE','MUV2.DE'],
  },
  {
    label: 'UK (FTSE)',
    symbols: ['HSBA.L','BP.L','SHEL.L','AZN.L','ULVR.L','LLOY.L','GSK.L','RIO.L','BT-A.L'],
  },
  {
    label: 'Commodités & ETF',
    symbols: ['GLD','SLV','USO','UNG','GDX','IAU','PDBC','DBO'],
  },
]

// ── Crypto fetcher ────────────────────────────────────────────────────────────

async function fetchCryptoRSI(symbols: string[]): Promise<TokenRSI[]> {
  const results = await Promise.allSettled(
    symbols.map(async sym => {
      const url = `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1d&limit=60`
      const r = await fetch(url)
      const rows: unknown[][] = await r.json()
      if (!Array.isArray(rows) || rows.length < 2) return null
      const candles = rows.map(k => ({
        o: parseFloat(k[1] as string) || 0,
        h: parseFloat(k[2] as string) || 0,
        l: parseFloat(k[3] as string) || 0,
        c: parseFloat(k[4] as string) || 0,
      }))
      const closes = candles.map(c => c.c).filter(v => v > 0)
      const volumes = rows.map(k => parseFloat(k[7] as string) || 0) // quote volume
      if (closes.length < 2) return null
      const last = closes[closes.length - 1]
      const prev = closes[closes.length - 2]
      const change = prev !== 0 ? +((last - prev) / prev * 100).toFixed(2) : 0
      return {
        symbol: sym.replace('USDT', ''),
        rsi: calcRSI(closes),
        wt1: calcWT1(candles),
        change24h: isNaN(change) ? 0 : change,
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
    const closes = candles.map(c => c.c).filter((v): v is number => typeof v === 'number' && !isNaN(v))
    if (closes.length < 2) return null
    const last = candles[candles.length - 1]
    const prev = candles[candles.length - 2]
    if (!last || !prev || last.c == null || prev.c == null) return null
    const displaySym = symbol.replace(/\.(PA|DE|L|MI)$/, '')
    const change = prev.c !== 0 ? +((last.c - prev.c) / prev.c * 100).toFixed(2) : 0
    return {
      symbol: displaySym,
      rsi: calcRSI(closes),
      wt1: calcWT1(candles),
      change24h: isNaN(change) ? 0 : change,
      volume: last.v ?? 0,
      price: last.c,
    }
  } catch {
    return null
  }
}

// Fetch one group sequentially to avoid rate limits
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

      {STOCK_GROUPS.filter(g => !loadedGroups.has(g.label)).map(g => (
        <LoadingGroup key={g.label} label={g.label} count={g.symbols.length} />
      ))}

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
          Vue globale RSI & VMC — identifiez les zones de surachat et survente en un coup d'œil
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
