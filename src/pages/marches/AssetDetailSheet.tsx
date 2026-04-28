// AssetDetailSheet.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Fiche complète d'un actif (action ou crypto) :
//  Stocks : fondamentaux Yahoo Finance, dividendes, prochain earnings, news ticker
//  Crypto : market cap CoinGecko, ATH, performance, news filtrée
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'
import { AssetPriceChart, KlineBar, fmtU } from '@/pages/trades/TradesPage'

const _fbFns = getFunctions(app, 'europe-west1')
type _YFn = { s: string; candles: { t:number; o:number; h:number; l:number; c:number; v:number }[] }

const TF_YAHOO_SHEET: Record<string, { interval: string; range: string }> = {
  '1j': { interval: '15m', range: '5d'  },
  '7j': { interval: '1h',  range: '1mo' },
  '1m': { interval: '1d',  range: '3mo' },
}

// ── Types ──────────────────────────────────────────────────────────────────

interface StockFundamentals {
  companyName:    string
  price:          number
  change24h:      number
  changePct:      number
  marketCap:      number | null
  peRatio:        number | null
  eps:            number | null
  beta:           number | null
  dividendYield:  number | null
  dividendAnnual: number | null
  exDividendDate: string | null
  payDate:        string | null
  week52High:     number | null
  week52Low:      number | null
  earningsDate:   string | null
  epsEstimate:    number | null
  volume:         number | null
}

interface CryptoFundamentals {
  name:          string
  price:         number
  change24h:     number
  change7d:      number
  change30d:     number
  change1y:      number | null
  marketCap:     number | null
  marketCapRank: number | null
  volume24h:     number | null
  supply:        number | null
  ath:           number | null
  athChange:     number | null
}

interface NewsItem {
  title: string
  url:   string
  date:  string
}

export interface AssetDetailSheetProps {
  symbol:       string    // ex: 'AAPL', 'BTC' (sans USDT)
  isCrypto:     boolean
  rsi?:         number
  divergence?:  string
  onClose:      () => void
  onOpenAnalysis: () => void
}

// ── CoinGecko symbol → id map ──────────────────────────────────────────────

const CG_ID: Record<string, string> = {
  BTC:'bitcoin', ETH:'ethereum', BNB:'binancecoin', SOL:'solana',
  XRP:'ripple', ADA:'cardano', DOGE:'dogecoin', AVAX:'avalanche-2',
  DOT:'polkadot', LINK:'chainlink', MATIC:'matic-network', UNI:'uniswap',
  ATOM:'cosmos', LTC:'litecoin', ETC:'ethereum-classic', BCH:'bitcoin-cash',
  FIL:'filecoin', ALGO:'algorand', XLM:'stellar', VET:'vechain',
  HBAR:'hedera-hashgraph', ICP:'internet-computer', APT:'aptos',
  ARB:'arbitrum', OP:'optimism', INJ:'injective-protocol', SUI:'sui',
  SEI:'sei-network', TIA:'celestia', WLD:'worldcoin-wld', PEPE:'pepe',
  SHIB:'shiba-inu', FTM:'fantom', NEAR:'near', SAND:'the-sandbox',
  MANA:'decentraland', AXS:'axie-infinity', AAVE:'aave', CRV:'curve-dao-token',
  MKR:'maker', COMP:'compound-governance-token', SNX:'synthetix-network-token',
  RUNE:'thorchain', KAVA:'kava', FLOW:'flow',
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' })
}

function fmtDateStr(s: string | null): string {
  if (!s) return '—'
  try { return new Date(s).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' }) } catch { return s }
}

function daysUntil(ts: number | null): number | null {
  if (!ts) return null
  const d = Math.ceil((ts * 1000 - Date.now()) / 86_400_000)
  return d
}

const fmtBig = (v: number | null) => {
  if (v == null) return '—'
  if (v >= 1e12) return `$${(v/1e12).toFixed(2)}T`
  if (v >= 1e9)  return `$${(v/1e9).toFixed(1)}B`
  if (v >= 1e6)  return `$${(v/1e6).toFixed(0)}M`
  return `$${v.toFixed(0)}`
}

const fmtPct = (v: number | null, digits = 2) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`

// ── CORS proxy (même pattern que NewsTickerBanner) ─────────────────────────

async function proxiedFetch(url: string): Promise<string> {
  const proxies = [
    (u: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  ]
  for (const proxy of proxies) {
    try {
      const r = await fetch(proxy(url), { signal: AbortSignal.timeout(8000) })
      if (!r.ok) continue
      const json = await r.json()
      // allorigins → json.contents, corsproxy → raw text dans .contents ou directement
      return typeof json?.contents === 'string' ? json.contents : JSON.stringify(json)
    } catch { continue }
  }
  throw new Error('Proxy unavailable')
}

// ── Fetch Stocks fundamentals (Yahoo Finance v8/chart — no crumb needed) ───

interface ChartMeta {
  longName?: string; shortName?: string
  regularMarketPrice?: number; regularMarketChangePercent?: number
  regularMarketVolume?: number; fiftyTwoWeekHigh?: number; fiftyTwoWeekLow?: number
  marketCap?: number; trailingPE?: number
  trailingAnnualDividendRate?: number; trailingAnnualDividendYield?: number
}

async function fetchStockFundamentals(symbol: string): Promise<StockFundamentals> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d&events=div&includePrePost=false`
  const raw = await proxiedFetch(url)

  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(raw) } catch { throw new Error('Parse error') }

  const chartArr = (parsed?.chart as Record<string, unknown[]>)?.result
  const result = chartArr?.[0] as Record<string, unknown> | undefined
  if (!result) throw new Error('No chart data')

  const meta = (result.meta ?? {}) as ChartMeta
  if (!meta.regularMarketPrice) throw new Error('No price data')

  // Dividends from events
  type DivEvent = { amount: number; date: number }
  const divEvents = (result.events as Record<string, Record<string, DivEvent>> | undefined)?.dividends
  const oneYearAgo = Date.now() / 1000 - 365 * 86400
  let dividendAnnual: number | null = null
  let exDividendDate: string | null = null

  if (divEvents) {
    const recent = Object.values(divEvents).filter(d => d.date > oneYearAgo)
    if (recent.length > 0) {
      dividendAnnual = recent.reduce((s, d) => s + d.amount, 0)
      const latest = recent.sort((a, b) => b.date - a.date)[0]
      exDividendDate = new Date(latest.date * 1000).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' })
    }
  }

  const price = meta.regularMarketPrice ?? 0
  const divYield = dividendAnnual != null && price > 0
    ? (dividendAnnual / price) * 100
    : meta.trailingAnnualDividendYield != null ? meta.trailingAnnualDividendYield * 100 : null

  return {
    companyName:    meta.longName ?? meta.shortName ?? symbol,
    price,
    change24h:      price * ((meta.regularMarketChangePercent ?? 0) / 100),
    changePct:      meta.regularMarketChangePercent ?? 0,
    marketCap:      meta.marketCap ?? null,
    peRatio:        meta.trailingPE ?? null,
    eps:            null,
    beta:           null,
    dividendYield:  divYield,
    dividendAnnual,
    exDividendDate,
    payDate:        null,
    week52High:     meta.fiftyTwoWeekHigh ?? null,
    week52Low:      meta.fiftyTwoWeekLow  ?? null,
    earningsDate:   null,
    epsEstimate:    null,
    volume:         meta.regularMarketVolume ?? null,
  }
}

// ── Fetch Crypto fundamentals (CoinGecko, CORS OK) ─────────────────────────

async function fetchCryptoFundamentals(symbol: string): Promise<CryptoFundamentals> {
  const id = CG_ID[symbol.toUpperCase()]
  if (!id) throw new Error(`Coin ${symbol} non mappé`)

  const r = await fetch(
    `https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`,
    { signal: AbortSignal.timeout(8000) }
  )
  if (!r.ok) throw new Error(`CoinGecko ${r.status}`)
  const d = await r.json() as {
    name: string
    market_data: {
      current_price: { usd: number }
      price_change_percentage_24h: number
      price_change_percentage_7d:  number
      price_change_percentage_30d: number
      price_change_percentage_1y:  number | null
      market_cap: { usd: number }
      market_cap_rank: number
      total_volume: { usd: number }
      circulating_supply: number
      ath: { usd: number }
      ath_change_percentage: { usd: number }
    }
  }

  const md = d.market_data
  return {
    name:          d.name,
    price:         md.current_price.usd,
    change24h:     md.price_change_percentage_24h,
    change7d:      md.price_change_percentage_7d,
    change30d:     md.price_change_percentage_30d,
    change1y:      md.price_change_percentage_1y,
    marketCap:     md.market_cap.usd,
    marketCapRank: md.market_cap_rank,
    volume24h:     md.total_volume.usd,
    supply:        md.circulating_supply,
    ath:           md.ath.usd,
    athChange:     md.ath_change_percentage.usd,
  }
}

// ── Fetch news (Yahoo Finance RSS by ticker via proxy) ─────────────────────

async function fetchTickerNews(symbol: string, isCrypto: boolean): Promise<NewsItem[]> {
  const url = isCrypto
    ? `https://finance.yahoo.com/rss/headline?s=${symbol}-USD`
    : `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${symbol}&region=US&lang=en-US`

  const raw = await proxiedFetch(url)
  const items: NewsItem[] = []
  const blocks = raw.match(/<item>([\s\S]*?)<\/item>/g) ?? []

  for (const block of blocks.slice(0, 5)) {
    const titleM = block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ?? block.match(/<title>(.*?)<\/title>/)
    const linkM  = block.match(/<link>(.*?)<\/link>/) ?? block.match(/<guid>(https?:\/\/[^<]+)<\/guid>/)
    const dateM  = block.match(/<pubDate>(.*?)<\/pubDate>/)

    const title = titleM?.[1]?.trim()
    const url   = linkM?.[1]?.trim()
    const date  = dateM?.[1]?.trim()

    if (title && url) {
      try {
        const d = date ? new Date(date).toLocaleDateString('fr-FR', { day:'2-digit', month:'short' }) : ''
        items.push({ title, url, date: d })
      } catch { items.push({ title, url, date: '' }) }
    }
  }
  return items
}

// ── Fetch klines (Binance pour crypto, Firebase CF pour stocks) ────────────

async function fetchBarsForSheet(symbol: string, isCrypto: boolean, tf: string): Promise<KlineBar[]> {
  if (isCrypto) {
    const tfMap: Record<string, { interval: string; limit: number }> = {
      '1j': { interval: '15m', limit: 96  },
      '7j': { interval: '1h',  limit: 168 },
      '1m': { interval: '4h',  limit: 180 },
    }
    const { interval, limit } = tfMap[tf] ?? tfMap['7j']
    const sym = symbol.toUpperCase() + 'USDT'
    for (const base of ['https://fapi.binance.com/fapi/v1', 'https://api.binance.com/api/v3']) {
      try {
        const r = await fetch(`${base}/klines?symbol=${sym}&interval=${interval}&limit=${limit}`)
        if (!r.ok) continue
        const raw: unknown[][] = await r.json()
        if (Array.isArray(raw) && raw.length > 5)
          return raw.map(a => ({ t: Number(a[0]), o: parseFloat(a[1] as string), h: parseFloat(a[2] as string), l: parseFloat(a[3] as string), c: parseFloat(a[4] as string) }))
      } catch { continue }
    }
    return []
  }

  // Stocks : Firebase Cloud Function fetchYahooCandles
  try {
    const { interval, range } = TF_YAHOO_SHEET[tf] ?? TF_YAHOO_SHEET['7j']
    const fn = httpsCallable<Record<string, unknown>, _YFn>(_fbFns, 'fetchYahooCandles')
    const res = await fn({ symbol, interval, range })
    if (res.data.s !== 'ok' || !res.data.candles?.length) return []
    return res.data.candles.map(c => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c }))
  } catch { return [] }
}

// ── Sub-components ─────────────────────────────────────────────────────────

function MetricCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:3, padding:'10px 12px', background:'rgba(255,255,255,0.03)', borderRadius:8, border:'1px solid rgba(255,255,255,0.06)' }}>
      <span style={{ fontSize:9, color:'var(--tm-text-muted)', textTransform:'uppercase', letterSpacing:0.5 }}>{label}</span>
      <span style={{ fontSize:13, fontWeight:700, fontFamily:'JetBrains Mono, monospace', color: color ?? 'var(--tm-text-primary)' }}>{value}</span>
    </div>
  )
}

function Week52Bar({ low, high, current }: { low: number; high: number; current: number }) {
  const pct = high > low ? ((current - low) / (high - low)) * 100 : 50
  return (
    <div style={{ padding:'12px 16px', background:'rgba(255,255,255,0.02)', borderRadius:8, border:'1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:'var(--tm-text-muted)', marginBottom:6, textTransform:'uppercase', letterSpacing:0.5 }}>
        <span>52 semaines</span>
        <span style={{ color:'var(--tm-text-secondary)' }}>{pct.toFixed(0)}% du range</span>
      </div>
      <div style={{ position:'relative', height:6, background:'rgba(255,255,255,0.08)', borderRadius:3 }}>
        <div style={{ position:'absolute', left:0, width:`${pct}%`, height:'100%', background:'linear-gradient(90deg,rgba(255,59,48,0.8),rgba(255,195,0,0.8),rgba(34,199,89,0.8))', borderRadius:3 }} />
        <div style={{ position:'absolute', left:`calc(${pct}% - 3px)`, top:-2, width:10, height:10, background:'white', borderRadius:'50%', boxShadow:'0 0 6px rgba(255,255,255,0.6)' }} />
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:'var(--tm-text-muted)', marginTop:5 }}>
        <span>Low: <b style={{ color:'#FF3B30' }}>${low >= 100 ? low.toFixed(0) : low.toFixed(2)}</b></span>
        <span>High: <b style={{ color:'#22C759' }}>${high >= 100 ? high.toFixed(0) : high.toFixed(2)}</b></span>
      </div>
    </div>
  )
}

function NewsSection({ items, loading }: { items: NewsItem[]; loading: boolean }) {
  const { t } = useTranslation()
  if (loading) return (
    <div style={{ padding:'12px 0', display:'flex', gap:6, alignItems:'center', color:'var(--tm-text-muted)', fontSize:11 }}>
      <div style={{ width:12, height:12, border:'1.5px solid rgba(255,255,255,0.15)', borderTopColor:'var(--tm-accent)', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
      {t('assetSheet.loadingNews')}
    </div>
  )
  if (!items.length) return <div style={{ fontSize:11, color:'var(--tm-text-muted)', padding:'8px 0' }}>{t('assetSheet.noNews')}</div>
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      {items.map((n, i) => (
        <a key={i} href={n.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration:'none', display:'flex', gap:10, alignItems:'flex-start', padding:'10px 12px', background:'rgba(255,255,255,0.02)', borderRadius:8, border:'1px solid rgba(255,255,255,0.05)', transition:'background 0.12s', cursor:'pointer' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
        >
          <span style={{ fontSize:14 }}>📰</span>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:11, fontWeight:600, color:'var(--tm-text-primary)', lineHeight:1.4 }}>{n.title}</div>
            {n.date && <div style={{ fontSize:9, color:'var(--tm-text-muted)', marginTop:3 }}>{n.date}</div>}
          </div>
          <span style={{ fontSize:10, color:'var(--tm-accent)' }}>↗</span>
        </a>
      ))}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize:10, fontWeight:700, color:'var(--tm-text-muted)', textTransform:'uppercase', letterSpacing:1, marginBottom:10, marginTop:4, display:'flex', alignItems:'center', gap:6 }}>
      <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.06)' }} />
      {children}
      <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.06)' }} />
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function AssetDetailSheet({ symbol, isCrypto, rsi, divergence, onClose, onOpenAnalysis }: AssetDetailSheetProps) {
  const { t } = useTranslation()
  const [tf, setTf] = useState('7j')
  const [bars, setBars] = useState<KlineBar[]>([])
  const [stockData, setStockData] = useState<StockFundamentals | null>(null)
  const [cryptoData, setCryptoData] = useState<CryptoFundamentals | null>(null)
  const [news, setNews] = useState<NewsItem[]>([])
  const [fundLoad, setFundLoad] = useState(true)
  const [newsLoad, setNewsLoad] = useState(true)
  const [barsLoad, setBarsLoad] = useState(true)
  const [fundErr, setFundErr] = useState<string | null>(null)

  // Fetch klines
  useEffect(() => {
    setBarsLoad(true)
    fetchBarsForSheet(symbol, isCrypto, tf)
      .then(b => setBars(b))
      .catch(() => setBars([]))
      .finally(() => setBarsLoad(false))
  }, [symbol, isCrypto, tf])

  // Fetch fundamentals
  useEffect(() => {
    setFundLoad(true); setFundErr(null)
    const p = isCrypto
      ? fetchCryptoFundamentals(symbol).then(d => { setCryptoData(d); setStockData(null) })
      : fetchStockFundamentals(symbol).then(d => { setStockData(d); setCryptoData(null) })
    p.catch(e => setFundErr((e as Error).message)).finally(() => setFundLoad(false))
  }, [symbol, isCrypto])

  // Fetch news
  useEffect(() => {
    setNewsLoad(true)
    fetchTickerNews(symbol, isCrypto)
      .then(setNews)
      .catch(() => setNews([]))
      .finally(() => setNewsLoad(false))
  }, [symbol, isCrypto])

  const price = isCrypto ? cryptoData?.price : stockData?.price
  const changePct = isCrypto ? cryptoData?.change24h : stockData?.changePct
  const name = isCrypto ? (cryptoData?.name ?? symbol) : (stockData?.companyName ?? symbol)
  const isUp = (changePct ?? 0) >= 0

  return (
    <>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>

      {/* Overlay */}
      <div
        onClick={onClose}
        style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, backdropFilter:'blur(3px)' }}
      />

      {/* Sheet */}
      <div style={{
        position:'fixed', top:0, right:0, bottom:0, width:'min(480px, 100vw)',
        background:'var(--tm-bg, #080C14)', borderLeft:'1px solid var(--tm-border)',
        zIndex:1001, overflowY:'auto', animation:'slideIn 0.22s ease-out',
        display:'flex', flexDirection:'column',
      }}>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div style={{ padding:'16px 20px 12px', borderBottom:'1px solid var(--tm-border)', position:'sticky', top:0, background:'var(--tm-bg, #080C14)', zIndex:2 }}>
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12 }}>
            <div style={{ flex:1 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                <span style={{ fontSize:18, fontWeight:800, fontFamily:'JetBrains Mono, monospace', color:'var(--tm-text-primary)' }}>{symbol}</span>
                {isCrypto && <span style={{ fontSize:9, fontWeight:700, background:'rgba(91,94,244,0.2)', color:'#8B8EF4', border:'1px solid rgba(91,94,244,0.3)', borderRadius:4, padding:'2px 6px' }}>{t('assetSheet.crypto')}</span>}
                {!isCrypto && <span style={{ fontSize:9, fontWeight:700, background:'rgba(255,195,0,0.15)', color:'#FFD700', border:'1px solid rgba(255,195,0,0.25)', borderRadius:4, padding:'2px 6px' }}>{t('assetSheet.stock')}</span>}
              </div>
              <div style={{ fontSize:11, color:'var(--tm-text-muted)', marginBottom:8 }}>{name}</div>
              <div style={{ display:'flex', alignItems:'baseline', gap:10 }}>
                {fundLoad
                  ? <div style={{ width:80, height:20, background:'rgba(255,255,255,0.06)', borderRadius:4, animation:'pulse 1.5s ease infinite' }} />
                  : <>
                    <span style={{ fontSize:22, fontWeight:800, fontFamily:'JetBrains Mono, monospace', color:'var(--tm-text-primary)' }}>
                      {price != null ? `$${price >= 1000 ? price.toFixed(0) : price >= 1 ? price.toFixed(2) : price.toFixed(4)}` : '—'}
                    </span>
                    {changePct != null && (
                      <span style={{ fontSize:12, fontWeight:700, color: isUp ? 'var(--tm-profit)' : 'var(--tm-loss)', background: isUp ? 'rgba(34,199,89,0.12)' : 'rgba(255,59,48,0.12)', padding:'3px 8px', borderRadius:6 }}>
                        {isUp ? '▲' : '▼'} {Math.abs(changePct).toFixed(2)}%
                      </span>
                    )}
                  </>
                }
              </div>
            </div>
            <button
              onClick={onClose}
              style={{ width:32, height:32, borderRadius:'50%', border:'1px solid var(--tm-border-sub)', background:'var(--tm-bg-secondary)', color:'var(--tm-text-muted)', fontSize:16, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}
            >×</button>
          </div>

          {/* RSI badge si dispo */}
          {rsi != null && (
            <div style={{ display:'flex', gap:6, marginTop:8 }}>
              <span style={{ fontSize:10, fontWeight:700, padding:'3px 8px', borderRadius:6, background:'rgba(255,255,255,0.06)', color:'var(--tm-text-muted)' }}>RSI {rsi}</span>
              {divergence === 'bull' && <span style={{ fontSize:10, fontWeight:700, padding:'3px 8px', borderRadius:6, background:'rgba(34,199,89,0.12)', color:'var(--tm-profit)' }}>{t('assetSheet.rsiBull')}</span>}
              {divergence === 'bear' && <span style={{ fontSize:10, fontWeight:700, padding:'3px 8px', borderRadius:6, background:'rgba(255,59,48,0.12)', color:'var(--tm-loss)' }}>{t('assetSheet.rsiBear')}</span>}
            </div>
          )}
        </div>

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div style={{ flex:1, padding:'16px 20px 24px', display:'flex', flexDirection:'column', gap:16 }}>

          {/* Graphique prix */}
          <div>
            <div style={{ display:'flex', gap:4, marginBottom:8 }}>
              {(['1j','7j','1m'] as const).map(tf_ => (
                <button key={tf_} onClick={() => setTf(tf_)} style={{
                  padding:'3px 10px', borderRadius:6, fontSize:10, fontWeight:600, cursor:'pointer', border:'none',
                  background: tf === tf_ ? 'var(--tm-accent, #5B5EF4)22' : 'transparent',
                  color: tf === tf_ ? 'var(--tm-accent, #5B5EF4)' : 'var(--tm-text-muted)',
                  outline: tf === tf_ ? '1px solid var(--tm-accent, #5B5EF4)' : '1px solid transparent',
                }}>{tf_}</button>
              ))}
              {barsLoad && <div style={{ marginLeft:8, width:14, height:14, border:'1.5px solid rgba(255,255,255,0.1)', borderTopColor:'var(--tm-accent)', borderRadius:'50%', animation:'spin 0.8s linear infinite', alignSelf:'center' }} />}
            </div>
            {bars.length > 0
              ? <AssetPriceChart bars={bars} />
              : !barsLoad && (
                <div style={{ height:160, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(255,255,255,0.02)', borderRadius:8, border:'1px solid rgba(255,255,255,0.05)', fontSize:11, color:'var(--tm-text-muted)', flexDirection:'column', gap:6 }}>
                  <span style={{ fontSize:18 }}>📊</span>
                  <span>{t('assetSheet.graphUnavailable')}</span>
                </div>
              )
            }
          </div>

          {/* ── Fondamentaux ──────────────────────────────────────────────── */}
          {fundLoad ? (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8 }}>
              {Array.from({length:4}).map((_,i) => (
                <div key={i} style={{ height:58, borderRadius:8, background:'rgba(255,255,255,0.04)', animation:'pulse 1.5s ease infinite' }} />
              ))}
            </div>
          ) : fundErr ? (
            <div style={{ padding:'10px 14px', borderRadius:8, background:'rgba(255,59,48,0.06)', border:'1px solid rgba(255,59,48,0.15)', fontSize:11, color:'var(--tm-text-muted)' }}>
              {t('assetSheet.fundamentals')} — {fundErr}
            </div>
          ) : isCrypto && cryptoData ? (
            <>
              <SectionTitle>{t('assetSheet.fundamentals')}</SectionTitle>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8 }}>
                <MetricCell label={t('assetSheet.marketCap')} value={fmtBig(cryptoData.marketCap)} />
                <MetricCell label={t('assetSheet.rank')} value={cryptoData.marketCapRank ? `#${cryptoData.marketCapRank}` : '—'} />
                <MetricCell label={t('assetSheet.volume24h')} value={fmtBig(cryptoData.volume24h)} />
                <MetricCell label={t('assetSheet.circulatingSupply')} value={cryptoData.supply ? fmtU(cryptoData.supply) : '—'} />
              </div>

              <SectionTitle>{t('assetSheet.performance')}</SectionTitle>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8 }}>
                {([['24h', cryptoData.change24h],['7j', cryptoData.change7d],['30j', cryptoData.change30d],['1an', cryptoData.change1y]] as [string, number | null][]).map(([l, v]) => (
                  <MetricCell key={l} label={l} value={fmtPct(v)} color={v == null ? undefined : v >= 0 ? 'var(--tm-profit)' : 'var(--tm-loss)'} />
                ))}
              </div>

              {cryptoData.ath != null && (
                <>
                  <SectionTitle>{t('assetSheet.allTimeHigh')}</SectionTitle>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8 }}>
                    <MetricCell label="ATH" value={`$${cryptoData.ath >= 1000 ? cryptoData.ath.toFixed(0) : cryptoData.ath.toFixed(2)}`} />
                    <MetricCell label={t('assetSheet.athDistance')} value={fmtPct(cryptoData.athChange)} color="var(--tm-loss)" />
                  </div>
                </>
              )}
            </>
          ) : stockData ? (
            <>
              <SectionTitle>{t('assetSheet.fundamentals')}</SectionTitle>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8 }}>
                <MetricCell label={t('assetSheet.marketCap')} value={fmtBig(stockData.marketCap)} />
                <MetricCell label={t('assetSheet.peRatio')} value={stockData.peRatio != null ? stockData.peRatio.toFixed(1) : '—'} />
                <MetricCell label={t('assetSheet.eps')} value={stockData.eps != null ? `$${stockData.eps.toFixed(2)}` : '—'} />
                <MetricCell label={t('assetSheet.beta')} value={stockData.beta != null ? stockData.beta.toFixed(2) : '—'} />
              </div>

              {stockData.week52High != null && stockData.week52Low != null && (
                <>
                  <SectionTitle>{t('assetSheet.range52w')}</SectionTitle>
                  <Week52Bar low={stockData.week52Low} high={stockData.week52High} current={stockData.price} />
                </>
              )}

              {(stockData.dividendYield != null || stockData.dividendAnnual != null) && (
                <>
                  <SectionTitle>{t('assetSheet.dividends')}</SectionTitle>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8 }}>
                    <MetricCell label={t('assetSheet.yield')} value={stockData.dividendYield != null ? `${stockData.dividendYield.toFixed(2)}%` : '—'} color="#FFD700" />
                    <MetricCell label={t('assetSheet.annualDividend')} value={stockData.dividendAnnual != null ? `$${stockData.dividendAnnual.toFixed(2)}` : '—'} />
                    <MetricCell label={t('assetSheet.exDividend')} value={fmtDateStr(stockData.exDividendDate)} />
                    <MetricCell label={t('assetSheet.volume')} value={stockData.volume != null ? fmtU(stockData.volume) : '—'} />
                  </div>
                </>
              )}

              {stockData.earningsDate && (
                <>
                  <SectionTitle>{t('assetSheet.nextEarnings')}</SectionTitle>
                  <div style={{ padding:'12px 16px', background:'rgba(255,195,0,0.06)', borderRadius:8, border:'1px solid rgba(255,195,0,0.2)', display:'flex', gap:12, alignItems:'center' }}>
                    <span style={{ fontSize:22 }}>📅</span>
                    <div>
                      <div style={{ fontSize:13, fontWeight:700, color:'#FFD700' }}>{stockData.earningsDate}</div>
                      <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginTop:2 }}>
                        {t('assetSheet.epsEstimate')} {stockData.epsEstimate != null ? `$${stockData.epsEstimate.toFixed(2)}` : '—'}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </>
          ) : null}

          {/* ── News ──────────────────────────────────────────────────────── */}
          <SectionTitle>{t('assetSheet.recentNews')}</SectionTitle>
          <NewsSection items={news} loading={newsLoad} />

        </div>

        {/* ── Footer CTA ──────────────────────────────────────────────────── */}
        <div style={{ padding:'14px 20px', borderTop:'1px solid var(--tm-border)', position:'sticky', bottom:0, background:'var(--tm-bg, #080C14)' }}>
          <button
            onClick={onOpenAnalysis}
            style={{
              width:'100%', padding:'12px', borderRadius:10, border:'none', cursor:'pointer',
              background:'linear-gradient(135deg, var(--tm-accent, #5B5EF4), #8B5CF6)',
              color:'white', fontSize:13, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', gap:8,
              boxShadow:'0 4px 16px rgba(91,94,244,0.3)',
            }}
          >
            {t('assetSheet.viewFullAnalysis')}
          </button>
        </div>
      </div>
    </>
  )
}
