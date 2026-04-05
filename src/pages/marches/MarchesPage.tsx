// src/pages/marches/MarchesPage.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Page Marchés — RSI + VMC Heatmap · 200 crypto (dynamique) + ~200 actions
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
type YahooFn = { s: string; candles: YahooCandle[] }

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
    const esa = ema(hlc3, n1)
    const d = ema(hlc3.map((v, i) => Math.abs(v - (esa[i] ?? 0))), n1)
    const ci = hlc3.map((v, i) => { const di = d[i] ?? 0; return di === 0 ? 0 : (v - (esa[i] ?? 0)) / (0.015 * di) })
    const tci = ema(ci, n2)
    if (!tci.length) return 0
    const last = tci[tci.length - 1]
    if (typeof last !== 'number' || isNaN(last)) return 0
    return +last.toFixed(2)
  } catch { return 0 }
}

// ── Stock groups (~200 actions) ───────────────────────────────────────────────

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

// ── Share button ──────────────────────────────────────────────────────────────

function ShareButton({ targetRef, label }: { targetRef: React.RefObject<HTMLDivElement>; label: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle')

  const handleShare = async () => {
    const el = targetRef.current
    if (!el) return
    setState('loading')
    try {
      const { toPng } = await import('html-to-image')
      const dataUrl = await toPng(el, {
        quality: 1,
        pixelRatio: 2,
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
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ title: `TradeMindset — ${label}`, files: [file] })
          }
        } else {
          const url = URL.createObjectURL(blob)
          Object.assign(document.createElement('a'), { href: url, download: filename }).click()
          URL.revokeObjectURL(url)
        }
      }
      setState('done')
      setTimeout(() => setState('idle'), 2500)
    } catch (e) {
      console.warn('Share failed:', e)
      setState('idle')
    }
  }

  return (
    <button
      data-share-btn="true"
      onClick={handleShare}
      disabled={state === 'loading'}
      style={{
        padding: '5px 14px', borderRadius: 8, border: '1px solid var(--tm-border-sub)',
        background: state === 'done' ? 'rgba(34,199,89,0.15)' : 'var(--tm-bg-secondary)',
        color: state === 'done' ? '#22C759' : 'var(--tm-text-muted)',
        fontSize: 11, fontWeight: 600, cursor: state === 'loading' ? 'wait' : 'pointer',
        display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.15s',
      }}
    >
      {state === 'done' ? '✓ Copié' : state === 'loading' ? '⏳…' : '↗ Partager'}
    </button>
  )
}

// ── Crypto fetcher (top 200 dynamique via Binance ticker) ─────────────────────

interface BinanceTicker { symbol: string; quoteVolume: string }

async function fetchTopCryptoSymbols(n = 200): Promise<string[]> {
  const r = await fetch('https://api.binance.com/api/v3/ticker/24hr')
  const tickers: BinanceTicker[] = await r.json()
  return tickers
    .filter(t => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 500_000)
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, n)
    .map(t => t.symbol)
}

async function fetchCryptoRSI(symbols: string[]): Promise<TokenRSI[]> {
  // Batch par 50 pour éviter le rate-limit Binance
  const BATCH = 50
  const results: TokenRSI[] = []
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH)
    const settled = await Promise.allSettled(batch.map(async sym => {
      const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1d&limit=60`)
      const rows: unknown[][] = await r.json()
      if (!Array.isArray(rows) || rows.length < 2) return null
      const candles = rows.map(k => ({
        o: parseFloat(k[1] as string) || 0,
        h: parseFloat(k[2] as string) || 0,
        l: parseFloat(k[3] as string) || 0,
        c: parseFloat(k[4] as string) || 0,
      }))
      const closes = candles.map(c => c.c).filter(v => v > 0)
      const volumes = rows.map(k => parseFloat(k[7] as string) || 0)
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
    }))
    results.push(...settled.flatMap(r => r.status === 'fulfilled' && r.value ? [r.value] : []))
  }
  return results
}

// ── Stock fetcher ─────────────────────────────────────────────────────────────

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
    const displaySym = symbol.replace(/\.(PA|DE|L|AS|SW|CO|ST|MI)$/, '')
    const change = prev.c !== 0 ? +((last.c - prev.c) / prev.c * 100).toFixed(2) : 0
    return {
      symbol: displaySym,
      rsi: calcRSI(closes),
      wt1: calcWT1(candles),
      change24h: isNaN(change) ? 0 : change,
      volume: last.v ?? 0,
      price: last.c,
    }
  } catch { return null }
}

// Groupe en parallèle par lots de 10 pour ne pas saturer Firebase
async function fetchGroupParallel(
  symbols: string[],
  onProgress?: (done: number, total: number) => void
): Promise<TokenRSI[]> {
  const BATCH = 10
  const results: TokenRSI[] = []
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH)
    const settled = await Promise.allSettled(batch.map(s => fetchStockRSI(s)))
    results.push(...settled.flatMap(r => r.status === 'fulfilled' && r.value ? [r.value] : []))
    onProgress?.(Math.min(i + BATCH, symbols.length), symbols.length)
  }
  return results
}

// ── Skeleton tile ─────────────────────────────────────────────────────────────

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

// ── Stocks tab ────────────────────────────────────────────────────────────────

function StocksTab({ onTokenClick, shareRef }: { onTokenClick: (sym: string) => void; shareRef: React.RefObject<HTMLDivElement> }) {
  const [groupData, setGroupData] = useState<Record<string, TokenRSI[]>>({})
  const [groupProgress, setGroupProgress] = useState<Record<string, { done: number; total: number }>>({})
  const [loadedGroups, setLoadedGroups] = useState<Set<string>>(new Set())
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    ;(async () => {
      for (const group of STOCK_GROUPS) {
        const total = group.symbols.length
        setGroupProgress(prev => ({ ...prev, [group.label]: { done: 0, total } }))
        const tokens = await fetchGroupParallel(group.symbols, (done) => {
          setGroupProgress(prev => ({ ...prev, [group.label]: { done, total } }))
        })
        setGroupData(prev => ({ ...prev, [group.label]: tokens }))
        setLoadedGroups(prev => new Set([...prev, group.label]))
      }
    })()
  }, [])

  const allTokens = Object.values(groupData).flat()
  const allLoaded = loadedGroups.size === STOCK_GROUPS.length
  const totalLoaded = allTokens.length
  const totalSymbols = STOCK_GROUPS.reduce((s, g) => s + g.symbols.length, 0)

  return (
    <div>
      {!allLoaded && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
          fontSize: 11, color: 'var(--tm-text-muted)',
          padding: '8px 12px', background: 'var(--tm-bg-secondary)',
          borderRadius: 8, border: '1px solid var(--tm-border-sub)',
        }}>
          <div style={{ width: 14, height: 14, border: '2px solid var(--tm-border)', borderTopColor: 'var(--tm-accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
          <span>Chargement… {totalLoaded}/{totalSymbols} actions ({loadedGroups.size}/{STOCK_GROUPS.length} groupes)</span>
          <div style={{ flex: 1, height: 3, background: 'var(--tm-border-sub)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(loadedGroups.size / STOCK_GROUPS.length) * 100}%`, background: 'var(--tm-accent)', transition: 'width 0.4s ease', borderRadius: 2 }} />
          </div>
        </div>
      )}

      {/* Skeletons for pending groups */}
      {STOCK_GROUPS.filter(g => !loadedGroups.has(g.label)).map(g => {
        const prog = groupProgress[g.label]
        return <SkeletonGroup key={g.label} label={`${g.label} ${prog ? `(${prog.done}/${prog.total})` : ''}`} count={g.symbols.length} />
      })}

      {allTokens.length > 0 && (
        <div ref={shareRef}>
          <RsiHeatmap tokens={allTokens} defaultTimeframe="1d" onTokenClick={onTokenClick} />
        </div>
      )}
    </div>
  )
}

// ── Crypto tab ────────────────────────────────────────────────────────────────

function CryptoTab({ onTokenClick, shareRef }: { onTokenClick: (sym: string) => void; shareRef: React.RefObject<HTMLDivElement> }) {
  const [tokens, setTokens] = useState<TokenRSI[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('Récupération du top 200 Binance…')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        setStatus('Récupération du top 200 Binance par volume…')
        const symbols = await fetchTopCryptoSymbols(200)
        if (cancelled) return
        setStatus(`Calcul RSI + VMC pour ${symbols.length} crypto…`)
        const data = await fetchCryptoRSI(symbols)
        if (cancelled) return
        setTokens(data)
      } catch (e) {
        console.warn('Crypto fetch error:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (loading) return (
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
    <div ref={shareRef}>
      <RsiHeatmap tokens={tokens} defaultTimeframe="1d" onTokenClick={onTokenClick} />
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
    const analyseSymbol = tab === 'crypto' ? symbol + 'USDT' : symbol
    localStorage.setItem('tm_analyse_symbol', analyseSymbol)
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

  const activeRef = tab === 'crypto' ? cryptoShareRef : stocksShareRef
  const activeLabel = tab === 'crypto' ? 'marches-crypto' : 'marches-actions'

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1600, margin: '0 auto' }}>
      {/* Header */}
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
        <ShareButton targetRef={activeRef} label={activeLabel} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--tm-border-sub)', marginBottom: 0 }}>
        <button onClick={() => setTab('crypto')} style={tabStyle(tab === 'crypto')}>🪙 Crypto</button>
        <button onClick={() => setTab('actions')} style={tabStyle(tab === 'actions')}>📈 Actions</button>
      </div>

      {/* Card */}
      <div style={{
        background: 'var(--tm-bg-card)', border: '1px solid var(--tm-border-sub)',
        borderTop: 'none', borderRadius: '0 0 14px 14px', padding: 20,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg,transparent,var(--tm-accent),transparent)', opacity: 0.3 }} />
        {tab === 'crypto' && <CryptoTab onTokenClick={handleTokenClick} shareRef={cryptoShareRef} />}
        {tab === 'actions' && <StocksTab onTokenClick={handleTokenClick} shareRef={stocksShareRef} />}
      </div>
    </div>
  )
}
