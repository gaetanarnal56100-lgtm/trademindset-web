// src/pages/trades/TradesPage.tsx

import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store/appStore'
import {
  subscribeTrades, subscribeSystems, subscribeExchanges, createTrade, deleteTrade, updateTrade,
  tradePnL, type Trade, type TradingSystem, type Exchange
} from '@/services/firestore'
import { TradeDetailModal } from '@/components/trades/TradeDetailModal'
import ExchangeSyncModal from '@/pages/journal/ExchangeSyncModal'

// ── Asset Panel ────────────────────────────────────────────────────────────
export interface AssetTicker {
  symbol: string; lastPrice: string; priceChangePercent: string
  highPrice: string; lowPrice: string; quoteVolume: string; priceChange: string
}
export interface KlineBar { t: number; o: number; h: number; l: number; c: number }

export function fmtU(v: number) {
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v/1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(v/1e6).toFixed(1)}M`
  if (a >= 1e3) return `${(v/1e3).toFixed(0)}K`
  return v.toFixed(2)
}

export function AssetPriceChart({ bars }: { bars: KlineBar[] }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLCanvasElement>(null)
  const PAD_L = 62, PAD_R = 10, PAD_T = 10, PAD_B = 28, H_C = 200

  useEffect(() => {
    const c = ref.current; if (!c || bars.length < 2) return
    const dpr = window.devicePixelRatio || 1
    const W = c.offsetWidth || 700, H = H_C
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr)
    const ctx = c.getContext('2d')!; ctx.scale(dpr, dpr)
    const cW = W - PAD_L - PAD_R, cH = H - PAD_T - PAD_B

    const prices = bars.map(b => b.c)
    const minV = Math.min(...prices), maxV = Math.max(...prices)
    const vPad = (maxV - minV) * 0.06
    const lo = minV - vPad, hi = maxV + vPad, range = hi - lo || 1

    const toX = (i: number) => PAD_L + (i / (bars.length - 1)) * cW
    const toY = (v: number) => PAD_T + (1 - (v - lo) / range) * cH

    // Background
    ctx.fillStyle = '#080C14'; ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = '#060A10'
    ctx.fillRect(0, 0, PAD_L, H)
    ctx.fillRect(0, PAD_T + cH, W, PAD_B)

    // Y grid + labels
    ctx.font = 'bold 9px monospace'; ctx.textAlign = 'right'
    for (let i = 0; i <= 4; i++) {
      const v = lo + (range / 4) * i
      const y = Math.round(toY(v)) + 0.5
      ctx.setLineDash([2, 4]); ctx.strokeStyle = '#1E2A3A'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(PAD_L + 1, y); ctx.lineTo(W - PAD_R, y); ctx.stroke()
      ctx.setLineDash([])
      ctx.strokeStyle = '#3A4A5C'
      ctx.beginPath(); ctx.moveTo(PAD_L - 4, y); ctx.lineTo(PAD_L, y); ctx.stroke()
      const label = v >= 1000 ? `$${(v/1000).toFixed(1)}k` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`
      ctx.fillStyle = '#8899BB'; ctx.fillText(label, PAD_L - 7, y + 3)
    }
    ctx.strokeStyle = '#2A3548'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(PAD_L + 0.5, PAD_T); ctx.lineTo(PAD_L + 0.5, PAD_T + cH + 4); ctx.stroke()

    // X labels
    const span = bars[bars.length - 1].t - bars[0].t
    const multiDay = span > 86_400_000
    const xN = Math.min(7, bars.length - 1)
    ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'
    for (let i = 0; i <= xN; i++) {
      const idx = Math.round((i / xN) * (bars.length - 1))
      const x = Math.round(toX(idx)) + 0.5
      const d = new Date(bars[idx].t)
      const hh = d.getHours().toString().padStart(2,'0'), mm = d.getMinutes().toString().padStart(2,'0')
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
    ctx.strokeStyle = '#2A3548'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(PAD_L, PAD_T + cH + 0.5); ctx.lineTo(W - PAD_R, PAD_T + cH + 0.5); ctx.stroke()

    // Area fill + line
    ctx.save(); ctx.beginPath(); ctx.rect(PAD_L + 1, PAD_T, cW - 1, cH); ctx.clip()
    const isUp = bars[bars.length - 1].c >= bars[0].c
    const lineColor = isUp ? '#22C759' : '#FF3B30'
    ctx.beginPath()
    bars.forEach((b, i) => { const x = toX(i), y = toY(b.c); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
    ctx.lineTo(toX(bars.length - 1), PAD_T + cH); ctx.lineTo(toX(0), PAD_T + cH); ctx.closePath()
    const grad = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + cH)
    grad.addColorStop(0, lineColor + '35'); grad.addColorStop(1, lineColor + '03')
    ctx.fillStyle = grad; ctx.fill()
    ctx.beginPath()
    bars.forEach((b, i) => { const x = toX(i), y = toY(b.c); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
    ctx.strokeStyle = lineColor; ctx.lineWidth = 1.8; ctx.stroke()
    ctx.restore()
  }, [bars])

  if (bars.length < 2) return (
    <div style={{ height: H_C, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--tm-text-muted)', fontSize:12, background:'#080C14', borderRadius:8 }}>
      {t('trades.awaitingData')}
    </div>
  )
  return <canvas ref={ref} style={{ width:'100%', height: H_C, borderRadius:8, display:'block' }} />
}

function AssetPanel({
  symbol, ticker, bars, assetLoad, assetTf, onTfChange, tradePnLFn,
  symTrades,
}: {
  symbol: string
  ticker: AssetTicker | null
  bars: KlineBar[]
  assetLoad: boolean
  assetTf: string
  onTfChange: (tf: string) => void
  tradePnLFn: (t: Trade) => number
  symTrades: Trade[]
}) {
  const { t } = useTranslation()
  const price  = ticker ? parseFloat(ticker.lastPrice) : null
  const pct    = ticker ? parseFloat(ticker.priceChangePercent) : null
  const isUp   = pct != null && pct >= 0

  // Stats from user trades on this symbol
  const closedSymTrades = symTrades.filter(t => t.status === 'closed')
  const symPnls = closedSymTrades.map(tradePnLFn)
  const symWins = symPnls.filter(p => p > 0).length
  const symTotal = symPnls.reduce((a,b) => a+b, 0)
  const symWr = symPnls.length > 0 ? (symWins / symPnls.length * 100).toFixed(0) : null

  return (
    <div style={{ background:'var(--tm-bg-secondary)', border:'1px solid #1E2A3A', borderRadius:14, overflow:'hidden', marginBottom:16 }}>
      {/* Header */}
      <div style={{ padding:'14px 16px 10px', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10, borderBottom:'1px solid #1A2030' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ fontSize:20, fontWeight:800, color:'var(--tm-text-primary)', fontFamily:'Syne,sans-serif', letterSpacing:'-0.01em' }}>{symbol}</span>
          {price != null && (
            <span style={{ fontSize:22, fontWeight:700, color:'var(--tm-text-primary)', fontFamily:'JetBrains Mono,monospace' }}>
              {price >= 1000 ? `$${price.toLocaleString('en-US',{maximumFractionDigits:2})}` : price >= 1 ? `$${price.toFixed(4)}` : `$${price.toFixed(6)}`}
            </span>
          )}
          {pct != null && (
            <span style={{ fontSize:13, fontWeight:700, color: isUp?'var(--tm-profit)':'var(--tm-loss)', background: isUp?'rgba(34,199,89,0.12)':'rgba(255,59,48,0.12)', padding:'3px 10px', borderRadius:6 }}>
              {isUp?'+':''}{pct.toFixed(2)}%
            </span>
          )}
          {assetLoad && <div style={{ width:12, height:12, border:'2px solid #2A2F3E', borderTopColor:'var(--tm-accent)', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />}
        </div>
        <div style={{ display:'flex', gap:4 }}>
          {(['1j','7j','30j'] as const).map(tf => (
            <button key={tf} onClick={() => onTfChange(tf)} style={{ padding:'3px 10px', borderRadius:6, fontSize:10, fontWeight:600, cursor:'pointer', border:`1px solid ${assetTf===tf?'var(--tm-accent)':'var(--tm-border)'}`, background:assetTf===tf?'rgba(0,229,255,0.1)':'var(--tm-bg-tertiary)', color:assetTf===tf?'var(--tm-accent)':'var(--tm-text-muted)', transition:'all 0.15s' }}>{tf}</button>
          ))}
        </div>
      </div>

      {/* 24h Stats grid */}
      {ticker && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:1, background:'#1A2030', margin:'0 0 0 0', borderBottom:'1px solid #1A2030' }}>
          {[
            { l:t('trades.change24h'), v: `${isUp?'+':''}$${Math.abs(parseFloat(ticker.priceChange)).toFixed(2)}`, c: isUp?'var(--tm-profit)':'var(--tm-loss)' },
            { l:t('trades.volume24h'), v: `$${fmtU(parseFloat(ticker.quoteVolume))}`, c:'var(--tm-text-primary)' },
            { l:t('trades.high24h'),   v: parseFloat(ticker.highPrice) >= 1000 ? `$${parseFloat(ticker.highPrice).toLocaleString('en-US',{maximumFractionDigits:2})}` : `$${parseFloat(ticker.highPrice).toFixed(4)}`, c:'var(--tm-profit)' },
            { l:t('trades.low24h'),    v: parseFloat(ticker.lowPrice)  >= 1000 ? `$${parseFloat(ticker.lowPrice).toLocaleString('en-US',{maximumFractionDigits:2})}` : `$${parseFloat(ticker.lowPrice).toFixed(4)}`,  c:'var(--tm-loss)' },
          ].map(({ l, v, c }) => (
            <div key={l} style={{ background:'var(--tm-bg-secondary)', padding:'10px 14px' }}>
              <div style={{ fontSize:9, color:'var(--tm-text-muted)', marginBottom:3 }}>{l}</div>
              <div style={{ fontSize:13, fontWeight:700, color:c, fontFamily:'JetBrains Mono,monospace' }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Price chart */}
      <div style={{ padding:'12px 14px 8px' }}>
        <AssetPriceChart bars={bars} />
      </div>

      {/* Mes trades sur ce symbole */}
      {symTrades.length > 0 && (
        <div style={{ padding:'10px 14px 14px', borderTop:'1px solid #1A2030' }}>
          <div style={{ fontSize:11, fontWeight:600, color:'var(--tm-text-secondary)', marginBottom:10 }}>
            {t('trades.myTradesOn', { symbol })} <span style={{ color:'var(--tm-text-muted)', fontWeight:400 }}>({symTrades.length} {t('trades.total')})</span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8 }}>
            {[
              { l:t('trades.totalPnl'),        v: symTotal !== 0 ? `${symTotal>=0?'+':''}$${Math.abs(symTotal).toFixed(2)}` : '—', c: symTotal>=0?'var(--tm-profit)':'var(--tm-loss)' },
              { l:t('trades.winRate'),          v: symWr != null ? `${symWr}%` : '—',                                              c:'var(--tm-text-primary)' },
              { l:t('common.closed'),           v: `${closedSymTrades.length} / ${symTrades.length}`,                              c:'var(--tm-text-secondary)' },
              { l:t('common.open'),             v: `${symTrades.filter(tr=>tr.status==='open').length}`,                           c: symTrades.filter(tr=>tr.status==='open').length > 0 ? 'var(--tm-accent)' : 'var(--tm-text-muted)' },
            ].map(({ l, v, c }) => (
              <div key={l} style={{ background:'var(--tm-bg-tertiary)', border:'1px solid #1E2A3A', borderRadius:8, padding:'8px 10px' }}>
                <div style={{ fontSize:9, color:'var(--tm-text-muted)', marginBottom:3 }}>{l}</div>
                <div style={{ fontSize:13, fontWeight:700, color:c, fontFamily:'JetBrains Mono,monospace' }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })
}
function fmtPrice(p?: number) {
  if (p == null) return '—'
  return p >= 1000 ? `$${p.toLocaleString('fr-FR', {maximumFractionDigits:1})}` : `$${p.toFixed(4)}`
}
function fmtPnL(n: number) {
  return `${n >= 0 ? '+' : ''}$${Math.abs(n).toFixed(2)}`
}

export default function TradesPage() {
  const { t } = useTranslation()
  const user = useAppStore(s => s.user)
  const [trades,  setTrades]  = useState<Trade[]>([])
  const [systems, setSystems] = useState<TradingSystem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState<'all'|'open'|'closed'>('all')
  const [search,  setSearch]  = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showExchangeSync, setShowExchangeSync] = useState(false)
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null)

  useEffect(() => {
    if (!user) return
    const unsubT = subscribeTrades(t => { setTrades(t); setLoading(false) })
    const unsubS = subscribeSystems(setSystems)
    const unsubE = subscribeExchanges(setExchanges)
    return () => { unsubT(); unsubS(); unsubE() }
  }, [user])

  const filtered = trades
    .filter(t => filter === 'all' || t.status === filter)
    .filter(t => !search || t.symbol.toLowerCase().includes(search.toLowerCase()))

  const closed = filtered.filter(t => t.status === 'closed')
  const totalPnL = closed.reduce((s, t) => s + tradePnL(t), 0)
  const pnls = closed.map(tradePnL)
  const wins     = pnls.filter(p => p > 0).length
  const losses   = pnls.filter(p => p <= 0).length
  const wr       = wins + losses > 0 ? (wins / (wins + losses) * 100).toFixed(1) : '—'
  const avgWin   = wins > 0 ? pnls.filter(p => p > 0).reduce((a, b) => a + b, 0) / wins : 0
  const avgLoss  = losses > 0 ? Math.abs(pnls.filter(p => p <= 0).reduce((a, b) => a + b, 0)) / losses : 0
  const payoff   = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : '—'
  const bestTrade = pnls.length ? Math.max(...pnls) : 0
  const worstTrade = pnls.length ? Math.min(...pnls) : 0
  const expectancy = pnls.length ? (pnls.reduce((a,b)=>a+b,0) / pnls.length) : 0
  // Profit factor
  const grossProfit = pnls.filter(p=>p>0).reduce((a,b)=>a+b,0)
  const grossLoss = Math.abs(pnls.filter(p=>p<=0).reduce((a,b)=>a+b,0))
  const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? '∞' : '—'
  // Streaks
  let curStreak=0, bestStreak=0, worstStreak=0
  for(const p of pnls){if(p>0){curStreak=curStreak>0?curStreak+1:1}else{curStreak=curStreak<0?curStreak-1:-1};if(curStreak>bestStreak)bestStreak=curStreak;if(curStreak<worstStreak)worstStreak=curStreak}
  // By symbol
  const bySymbol = new Map<string,{count:number;pnl:number;wins:number}>()
  for(const t of closed){const s=t.symbol;const p=tradePnL(t);const e=bySymbol.get(s)||{count:0,pnl:0,wins:0};e.count++;e.pnl+=p;if(p>0)e.wins++;bySymbol.set(s,e)}
  const topSymbols = [...bySymbol.entries()].sort((a,b)=>b[1].pnl-a[1].pnl).slice(0,5)

  const [showStats, setShowStats] = useState(false)

  const systemName  = (id: string) => systems.find(s => s.id === id)?.name  ?? '—'
  const systemColor = (id: string) => systems.find(s => s.id === id)?.color ?? 'var(--tm-accent)'

  const [showImport, setShowImport] = useState(false)

  // ── Fiche actif ──
  const [assetTicker, setAssetTicker] = useState<AssetTicker | null>(null)
  const [assetBars,   setAssetBars]   = useState<KlineBar[]>([])
  const [assetLoad,   setAssetLoad]   = useState(false)
  const [assetTf,     setAssetTf]     = useState('7j')
  const assetAbort = useRef<AbortController | null>(null)

  const loadAsset = useCallback((sym: string, tf: string) => {
    if (assetAbort.current) assetAbort.current.abort()
    const ctrl = new AbortController(); assetAbort.current = ctrl
    const TF_MAP: Record<string,{interval:string;limit:number}> = {
      '1j':  { interval:'15m', limit:96  },
      '7j':  { interval:'1h',  limit:168 },
      '30j': { interval:'4h',  limit:180 },
    }
    const { interval, limit } = TF_MAP[tf] ?? TF_MAP['7j']
    setAssetLoad(true); setAssetTicker(null); setAssetBars([])
    Promise.all([
      fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}`, { signal: ctrl.signal }).then(r => r.json()),
      fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${limit}`, { signal: ctrl.signal }).then(r => r.json()),
    ]).then(([ticker, klines]) => {
      if ((ticker as {symbol?:string}).symbol) setAssetTicker(ticker as AssetTicker)
      if (Array.isArray(klines)) setAssetBars((klines as unknown[][]).map(k => ({ t:Number(k[0]), o:parseFloat(k[1] as string), h:parseFloat(k[2] as string), l:parseFloat(k[3] as string), c:parseFloat(k[4] as string) })))
      setAssetLoad(false)
    }).catch(e => { if (e.name !== 'AbortError') setAssetLoad(false) })
  }, [])

  // Déclenche la fiche dès que la recherche ressemble à un symbole crypto
  useEffect(() => {
    const sym = search.trim().toUpperCase()
    if (!sym || !/USDT$|BUSD$|BTC$|ETH$|BNB$/i.test(sym)) {
      setAssetTicker(null); setAssetBars([]); return
    }
    loadAsset(sym, assetTf)
  }, [search, assetTf, loadAsset])

  const symTrades = trades.filter(t => t.symbol.toUpperCase() === search.trim().toUpperCase())

  return (
    <div style={{ padding:24, maxWidth:1600, margin:'0 auto' }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:'var(--tm-text-primary)', margin:0 }}>{t('trades.title')}</h1>
          <p style={{ fontSize:13, color:'var(--tm-text-secondary)', margin:'3px 0 0' }}>
            {loading ? t('trades.loadingFirestore') : `${filtered.length} trade${filtered.length > 1?'s':''}`}
          </p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={() => setShowExchangeSync(true)} style={{ padding:'8px 16px', borderRadius:10, border:'1px solid rgba(255,149,0,0.3)', background:'rgba(255,149,0,0.06)', color:'#FF9500', fontSize:13, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
            📥 Importer
          </button>
          <button onClick={() => setShowImport(true)} style={{ padding:'8px 16px', borderRadius:10, border:'1px solid #2A2F3E', background:'var(--tm-bg-secondary)', color:'var(--tm-warning)', fontSize:13, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
            {t('trades.importCSV')}
          </button>
          <button onClick={() => setShowAdd(true)} style={{ padding:'8px 16px', borderRadius:10, border:'none', background:'var(--tm-accent)', color:'var(--tm-bg)', fontSize:13, fontWeight:600, cursor:'pointer' }}>
            {t('trades.newTrade')}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:12 }}>
        {[
          { l:t('trades.totalPnl'), v:fmtPnL(totalPnL), c: totalPnL >= 0 ? 'var(--tm-profit)' : 'var(--tm-loss)' },
          { l:t('trades.winRate'),  v:`${wr}%`,          c:'var(--tm-text-primary)' },
          { l:t('trades.gains'),    v:wins,              c:'var(--tm-profit)' },
          { l:t('trades.losses'),   v:losses,            c:'var(--tm-loss)' },
        ].map(({ l, v, c }) => (
          <div key={l} style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:10, padding:'12px 14px' }}>
            <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:4 }}>{l}</div>
            <div style={{ fontSize:18, fontWeight:700, color:c, fontFamily:'monospace' }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Toggle advanced stats */}
      <button onClick={() => setShowStats(x => !x)} style={{ width:'100%', padding:'8px', marginBottom:14, borderRadius:10, border:'1px solid #2A2F3E', background:showStats?'rgba(var(--tm-blue-rgb,10,133,255),0.06)':'var(--tm-bg-secondary)', color:showStats?'var(--tm-blue)':'var(--tm-text-muted)', fontSize:12, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
        {showStats ? t('trades.hideAdvanced') : t('trades.showAdvanced')}
      </button>

      {showStats && (
        <div style={{ marginBottom:16, animation:'fadeIn 0.2s ease-out' }}>
          <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}`}</style>
          {/* Row 2: Advanced metrics */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:10 }}>
            {[
              { l:t('trades.payoffRatio'),   v:payoff,                    c:'var(--tm-accent)' },
              { l:t('trades.profitFactor'),  v:profitFactor,              c: Number(profitFactor) >= 1.5 ? 'var(--tm-profit)' : 'var(--tm-warning)' },
              { l:t('trades.expectancy'),    v:fmtPnL(expectancy),        c: expectancy >= 0 ? 'var(--tm-profit)' : 'var(--tm-loss)' },
              { l:t('trades.closedTrades'),  v:closed.length,             c:'var(--tm-text-secondary)' },
            ].map(({ l, v, c }) => (
              <div key={l} style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:10, padding:'12px 14px' }}>
                <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:4 }}>{l}</div>
                <div style={{ fontSize:16, fontWeight:700, color:c, fontFamily:'monospace' }}>{v}</div>
              </div>
            ))}
          </div>
          {/* Row 3: Gains/losses details */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:10 }}>
            {[
              { l:t('trades.avgWin'),      v:fmtPnL(avgWin),            c:'var(--tm-profit)' },
              { l:t('trades.avgLoss'),     v:fmtPnL(-avgLoss),          c:'var(--tm-loss)' },
              { l:t('trades.bestTrade'),   v:fmtPnL(bestTrade),         c:'var(--tm-profit)' },
              { l:t('trades.worstTrade'),  v:fmtPnL(worstTrade),        c:'var(--tm-loss)' },
            ].map(({ l, v, c }) => (
              <div key={l} style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:10, padding:'12px 14px' }}>
                <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:4 }}>{l}</div>
                <div style={{ fontSize:16, fontWeight:700, color:c, fontFamily:'monospace' }}>{v}</div>
              </div>
            ))}
          </div>
          {/* Row 4: Streaks + top symbols */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            {/* Streaks */}
            <div style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:10, padding:'14px 16px' }}>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--tm-text-primary)', marginBottom:10 }}>{t('trades.streaks')}</div>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {[
                  { l:t('trades.bestStreak'),  v:`${bestStreak} wins`, c:'var(--tm-profit)' },
                  { l:t('trades.worstStreak'), v:`${Math.abs(worstStreak)} losses`, c:'var(--tm-loss)' },
                  { l:t('trades.grossProfit'), v:fmtPnL(grossProfit), c:'var(--tm-profit)' },
                  { l:t('trades.grossLoss'),   v:fmtPnL(-grossLoss), c:'var(--tm-loss)' },
                ].map(({ l, v, c }) => (
                  <div key={l} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:11, color:'var(--tm-text-secondary)' }}>{l}</span>
                    <span style={{ fontSize:12, fontWeight:700, color:c, fontFamily:'monospace' }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Top symbols */}
            <div style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:10, padding:'14px 16px' }}>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--tm-text-primary)', marginBottom:10 }}>{t('trades.topSymbols')}</div>
              {topSymbols.length === 0 ? (
                <div style={{ fontSize:11, color:'var(--tm-text-muted)' }}>{t('common.noData')}</div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {topSymbols.map(([sym, data]) => (
                    <div key={sym} style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontSize:12, fontWeight:700, color:'var(--tm-text-primary)', minWidth:80, fontFamily:'monospace' }}>{sym}</span>
                      <div style={{ flex:1, height:6, background:'var(--tm-bg-tertiary)', borderRadius:3, overflow:'hidden' }}>
                        <div style={{ width:`${Math.min(100, data.wins/Math.max(data.count,1)*100)}%`, height:'100%', background:'var(--tm-profit)', borderRadius:3 }} />
                      </div>
                      <span style={{ fontSize:11, fontWeight:600, color:data.pnl>=0?'var(--tm-profit)':'var(--tm-loss)', fontFamily:'monospace', minWidth:70, textAlign:'right' }}>{fmtPnL(data.pnl)}</span>
                      <span style={{ fontSize:9, color:'var(--tm-text-muted)' }}>{data.count}t</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
        <div style={{ display:'flex', background:'var(--tm-bg-secondary)', borderRadius:8, padding:3, gap:2 }}>
          {(['all','open','closed'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ padding:'5px 12px', borderRadius:6, border:'none', cursor:'pointer', fontSize:12, fontWeight:500, background: filter===f?'var(--tm-accent)':'transparent', color: filter===f?'var(--tm-bg)':'var(--tm-text-secondary)' }}>
              {f==='all'?t('trades.filterAll'):f==='open'?t('trades.filterOpen'):t('trades.filterClosed')}
            </button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('trades.searchPlaceholder')} style={{ flex:1, minWidth:180, padding:'6px 12px', borderRadius:8, border:'1px solid #2A2F3E', background:'var(--tm-bg-secondary)', color:'var(--tm-text-primary)', fontSize:13, outline:'none' }} />
      </div>

      {/* Fiche actif */}
      {(assetTicker || assetLoad || assetBars.length > 0) && search.trim().length >= 3 && (
        <AssetPanel
          symbol={search.trim().toUpperCase()}
          ticker={assetTicker}
          bars={assetBars}
          assetLoad={assetLoad}
          assetTf={assetTf}
          onTfChange={tf => setAssetTf(tf)}
          tradePnLFn={tradePnL}
          symTrades={symTrades}
        />
      )}

      {/* List */}
      {loading ? (
        <div style={{ textAlign:'center', padding:48, color:'var(--tm-text-muted)' }}>
          <div style={{ width:24, height:24, border:'2px solid #2A2F3E', borderTopColor:'var(--tm-accent)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto 12px' }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          {t('trades.loadingTrades')}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:48, color:'var(--tm-text-muted)', fontSize:14 }}>
          {filter === 'all' ? t('trades.noTrades') : filter === 'open' ? t('trades.noTradesOpen') : t('trades.noTradesClosed')}
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {filtered.map(trade => {
            const pnl = tradePnL(trade)
            const pnlColor = pnl >= 0 ? 'var(--tm-profit)' : 'var(--tm-loss)'
            const isOpen = trade.status === 'open'
            return (
              <div key={trade.id} onClick={() => setSelectedTrade(trade)} style={{ background:'var(--tm-bg-card, #161B22)', border:'1px solid var(--tm-border, #2A2F3E)', borderRadius:12, padding:'12px 14px', display:'grid', gridTemplateColumns:'auto 1fr auto auto auto', alignItems:'center', gap:14, cursor:'pointer', transition:'border-color 0.15s' }} onMouseOver={e => (e.currentTarget.style.borderColor='var(--tm-accent,#00E5FF)')} onMouseOut={e => (e.currentTarget.style.borderColor='var(--tm-border,#2A2F3E)')}>
                <div style={{ width:36, height:36, borderRadius:8, background: trade.type==='Long'?'rgba(var(--tm-profit-rgb,34,199,89),0.15)':'rgba(var(--tm-loss-rgb,255,59,48),0.15)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, flexShrink:0 }}>
                  {trade.type==='Long'?'📈':'📉'}
                </div>
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3, flexWrap:'wrap' }}>
                    <span style={{ fontSize:14, fontWeight:700, color:'var(--tm-text-primary)' }}>{trade.symbol}</span>
                    <span style={{ fontSize:10, fontWeight:600, color: trade.type==='Long'?'var(--tm-profit)':'var(--tm-loss)', background: trade.type==='Long'?'rgba(var(--tm-profit-rgb,34,199,89),0.1)':'rgba(var(--tm-loss-rgb,255,59,48),0.1)', padding:'1px 6px', borderRadius:4 }}>{trade.type}</span>
                    {isOpen && <span style={{ fontSize:9, fontWeight:700, color:'var(--tm-accent)', background:'rgba(var(--tm-accent-rgb,0,229,255),0.1)', padding:'1px 6px', borderRadius:4 }}>● OUVERT</span>}
                    <span style={{ fontSize:10, color:systemColor(trade.systemId), background:`${systemColor(trade.systemId)}18`, padding:'1px 6px', borderRadius:4 }}>{systemName(trade.systemId)}</span>
                  </div>
                  <div style={{ fontSize:11, color:'var(--tm-text-muted)' }}>
                    {fmtDate(trade.date)} · {trade.leverage}x · {trade.orderRole} · {trade.session}
                    {trade.entryPrice && ` · E: ${fmtPrice(trade.entryPrice)}`}
                    {trade.exitPrice  && ` → S: ${fmtPrice(trade.exitPrice)}`}
                  </div>
                </div>
                {trade.quantity && (
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:10, color:'var(--tm-text-muted)' }}>{t('trades.quantity')}</div>
                    <div style={{ fontSize:12, color:'var(--tm-text-secondary)', fontFamily:'monospace' }}>{trade.quantity.toFixed(4)}</div>
                  </div>
                )}
                <div style={{ textAlign:'right', minWidth:80 }}>
                  <div style={{ fontSize:10, color:'var(--tm-text-muted)' }}>{isOpen?t('trades.unrealized'):t('trades.pnl')}</div>
                  <div style={{ fontSize:14, fontWeight:700, color:pnlColor, fontFamily:'monospace' }}>{fmtPnL(pnl)}</div>
                </div>
                <button onClick={e => { e.stopPropagation(); setSelectedTrade(trade) }} style={{ width:28, height:28, borderRadius:6, border:'1px solid var(--tm-border,#2A2F3E)', background:'none', cursor:'pointer', color:'var(--tm-text-muted,#555C70)', fontSize:11, display:'flex', alignItems:'center', justifyContent:'center' }} title={t('trades.viewDetails')}>→</button>
              </div>
            )
          })}
        </div>
      )}

      {showAdd && <AddTradeModal systems={systems} onClose={() => setShowAdd(false)} />}
      {showImport && <ImportCSVModal onClose={() => setShowImport(false)} />}
      {showExchangeSync && <ExchangeSyncModal onClose={() => setShowExchangeSync(false)} />}
      {selectedTrade && (
        <TradeDetailModal
          trade={selectedTrade}
          systems={systems}
          exchanges={exchanges}
          onClose={() => setSelectedTrade(null)}
          onDeleted={() => setSelectedTrade(null)}
        />
      )}
    </div>
  )
}

function AddTradeModal({ systems, onClose }: { systems: TradingSystem[]; onClose: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    symbol:'', type:'Long' as 'Long'|'Short', entryPrice:'', exitPrice:'',
    quantity:'', leverage:'1', session:'US' as 'US'|'Asia'|'Europe',
    orderRole:'Taker' as 'Maker'|'Taker', systemId: systems[0]?.id ?? '',
    status:'closed' as 'open'|'closed', notes:'', flashPnLNet:'',
  })
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!form.symbol || !form.systemId) return
    setSaving(true)
    try {
      await createTrade({
        id: crypto.randomUUID(), date: new Date(),
        symbol: form.symbol.toUpperCase(), type: form.type,
        entryPrice:  form.entryPrice  ? parseFloat(form.entryPrice)  : undefined,
        exitPrice:   form.exitPrice   ? parseFloat(form.exitPrice)   : undefined,
        quantity:    form.quantity    ? parseFloat(form.quantity)    : undefined,
        leverage:    parseFloat(form.leverage) || 1,
        exchangeId:  crypto.randomUUID(), orderRole: form.orderRole,
        systemId: form.systemId, session: form.session,
        flashPnLNet: form.flashPnLNet ? parseFloat(form.flashPnLNet) : undefined,
        notes: form.notes || undefined, tags: [], status: form.status,
      })
      onClose()
    } catch(e) { alert((e as Error).message) }
    finally { setSaving(false) }
  }

  const inp = { background:'var(--tm-bg-tertiary)', border:'1px solid #2A2F3E', borderRadius:8, padding:'8px 10px', color:'var(--tm-text-primary)', fontSize:13, outline:'none', width:'100%', boxSizing:'border-box' as const }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
      <div style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:16, padding:24, width:480, maxWidth:'95vw', maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:18 }}>
          <span style={{ fontSize:16, fontWeight:700, color:'var(--tm-text-primary)' }}>{t('trades.newTradeModal')}</span>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--tm-text-muted)', cursor:'pointer', fontSize:18 }}>✕</button>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          {[
            { label:t('trades.symbolLabel'),  key:'symbol',       placeholder:'BTCUSDT' },
            { label:t('trades.entryPrice'),   key:'entryPrice',   placeholder:'71000' },
            { label:t('trades.exitPrice'),    key:'exitPrice',    placeholder:'72000' },
            { label:t('trades.quantity'),     key:'quantity',     placeholder:'0.01' },
            { label:t('trades.leverage'),     key:'leverage',     placeholder:'1' },
            { label:t('trades.netPnl'),       key:'flashPnLNet',  placeholder:'150.00' },
          ].map(({ label, key, placeholder }) => (
            <div key={key}>
              <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:4 }}>{label}</div>
              <input value={(form as Record<string,string>)[key]} onChange={e => setForm(p => ({...p,[key]:e.target.value}))} placeholder={placeholder} style={inp} />
            </div>
          ))}
          {[
            { label:t('trades.direction'), key:'type',      options:['Long','Short'] },
            { label:t('trades.status'),    key:'status',    options:['closed','open'] },
            { label:t('trades.session'),   key:'session',   options:['US','Asia','Europe'] },
            { label:t('trades.role'),      key:'orderRole', options:['Taker','Maker'] },
          ].map(({ label, key, options }) => (
            <div key={key}>
              <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:4 }}>{label}</div>
              <select value={(form as Record<string,string>)[key]} onChange={e => setForm(p => ({...p,[key]:e.target.value}))} style={{...inp,cursor:'pointer'}}>
                {options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          ))}
          {systems.length > 0 && (
            <div style={{ gridColumn:'span 2' }}>
              <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:4 }}>{t('trades.system')}</div>
              <select value={form.systemId} onChange={e => setForm(p => ({...p,systemId:e.target.value}))} style={{...inp,cursor:'pointer'}}>
                {systems.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div style={{ gridColumn:'span 2' }}>
            <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:4 }}>{t('trades.notes')}</div>
            <textarea value={form.notes} onChange={e => setForm(p => ({...p,notes:e.target.value}))} placeholder={t('trades.notes') + '...'} rows={2} style={{...inp,resize:'vertical'}} />
          </div>
        </div>
        <button onClick={save} disabled={saving || !form.symbol} style={{ width:'100%', marginTop:16, padding:10, borderRadius:10, border:'none', background:form.symbol?'var(--tm-accent)':'var(--tm-bg-tertiary)', color:form.symbol?'var(--tm-bg)':'var(--tm-text-muted)', fontSize:14, fontWeight:600, cursor:form.symbol?'pointer':'not-allowed' }}>
          {saving ? t('trades.savingTrade') : t('trades.createTrade')}
        </button>
      </div>
    </div>
  )
}

// ── CSV Import Modal ─────────────────────────────────────────────────────────

interface CSVTrade {
  symbol: string
  qty: number
  buyPrice: number
  sellPrice: number
  pnl: number
  boughtTimestamp: string
  soldTimestamp: string
  duration: string
  direction: 'Long' | 'Short'
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes }
    else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = '' }
    else { current += ch }
  }
  result.push(current.trim())
  return result
}

function parsePnL(raw: string): number {
  // "$125.00" → 125, "$(175.00)" → -175
  const cleaned = raw.replace(/[$,]/g, '')
  const match = cleaned.match(/\((.+)\)/)
  if (match) return -parseFloat(match[1])
  return parseFloat(cleaned) || 0
}

function parseCSVDate(raw: string): Date {
  // "03/16/2026 17:54:31" → Date
  const [datePart, timePart] = raw.split(' ')
  const [month, day, year] = datePart.split('/')
  return new Date(`${year}-${month}-${day}T${timePart}`)
}

function parseCSVTrades(text: string): CSVTrade[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim())
  const iSym   = headers.indexOf('symbol')
  const iQty   = headers.indexOf('qty')
  const iBuy   = headers.indexOf('buyprice')
  const iSell  = headers.indexOf('sellprice')
  const iPnl   = headers.indexOf('pnl')
  const iBTime = headers.indexOf('boughttimestamp')
  const iSTime = headers.indexOf('soldtimestamp')
  const iDur   = headers.indexOf('duration')

  return lines.slice(1).map(line => {
    const cols = parseCSVLine(line)
    const buyPrice  = parseFloat(cols[iBuy]  || '0')
    const sellPrice = parseFloat(cols[iSell] || '0')
    // Determine direction: if bought first (boughtTimestamp < soldTimestamp) → Long, else Short
    const boughtTime = cols[iBTime] || ''
    const soldTime   = cols[iSTime] || ''
    const boughtDate = parseCSVDate(boughtTime)
    const soldDate   = parseCSVDate(soldTime)
    const direction: 'Long' | 'Short' = boughtDate <= soldDate ? 'Long' : 'Short'

    return {
      symbol:          cols[iSym] || '',
      qty:             parseFloat(cols[iQty] || '1'),
      buyPrice,
      sellPrice,
      pnl:             parsePnL(cols[iPnl] || '$0'),
      boughtTimestamp:  boughtTime,
      soldTimestamp:    soldTime,
      duration:         cols[iDur] || '',
      direction,
    }
  }).filter(t => t.symbol)
}

function ImportCSVModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [parsed, setParsed]     = useState<CSVTrade[]>([])
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [done, setDone]         = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError]       = useState('')

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setError('')
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string
        const trades = parseCSVTrades(text)
        if (trades.length === 0) { setError(t('trades.noTradesDetected')); return }
        setParsed(trades)
      } catch { setError(t('trades.csvReadError')) }
    }
    reader.readAsText(file)
  }

  const doImport = async () => {
    if (parsed.length === 0) return
    setImporting(true)
    setProgress(0)
    try {
      for (let i = 0; i < parsed.length; i++) {
        const t = parsed[i]
        const boughtDate = parseCSVDate(t.boughtTimestamp)
        const soldDate   = parseCSVDate(t.soldTimestamp)
        const entryDate  = t.direction === 'Long' ? boughtDate : soldDate
        const exitDate   = t.direction === 'Long' ? soldDate   : boughtDate
        const entryPrice = t.direction === 'Long' ? t.buyPrice : t.sellPrice
        const exitPrice  = t.direction === 'Long' ? t.sellPrice : t.buyPrice

        await createTrade({
          id:          crypto.randomUUID(),
          date:        entryDate,
          symbol:      t.symbol,
          type:        t.direction,
          entryPrice,
          exitPrice,
          quantity:    t.qty,
          leverage:    1,
          exchangeId:  '',
          orderRole:   'Taker',
          systemId:    '',
          session:     'US',
          flashPnLNet: t.pnl,
          notes:       `Import CSV · Durée: ${t.duration}`,
          tags:        ['csv-import'],
          status:      'closed',
          closedAt:    exitDate,
        })
        setProgress(i + 1)
      }
      setDone(true)
    } catch (err) {
      setError(t('trades.importError', { message: (err as Error).message }))
    } finally {
      setImporting(false)
    }
  }

  const totalPnL = parsed.reduce((s, t) => s + t.pnl, 0)
  const wins     = parsed.filter(t => t.pnl > 0).length
  const losses   = parsed.filter(t => t.pnl < 0).length
  const be       = parsed.filter(t => t.pnl === 0).length

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
      <div style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:16, padding:24, width:560, maxWidth:'95vw', maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:18 }}>
          <span style={{ fontSize:16, fontWeight:700, color:'var(--tm-text-primary)' }}>{t('trades.importCSV')}</span>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--tm-text-muted)', cursor:'pointer', fontSize:18 }}>✕</button>
        </div>

        {/* File input */}
        {!done && (
          <label style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'20px', border:'2px dashed #2A2F3E', borderRadius:12, cursor:'pointer', marginBottom:16, transition:'border-color 0.2s' }}
            onMouseOver={e => (e.currentTarget.style.borderColor = 'var(--tm-warning)')}
            onMouseOut={e => (e.currentTarget.style.borderColor = 'var(--tm-border)')}>
            <input type="file" accept=".csv" onChange={handleFile} style={{ display:'none' }} />
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:28, marginBottom:6 }}>📁</div>
              <div style={{ fontSize:13, color:'var(--tm-text-secondary)', fontWeight:600 }}>{fileName || t('trades.selectFile')}</div>
              <div style={{ fontSize:11, color:'var(--tm-text-muted)', marginTop:4 }}>Format supporté : CSV de propfirm (Topstep, FTMO, etc.)</div>
            </div>
          </label>
        )}

        {error && (
          <div style={{ padding:'10px 14px', borderRadius:10, background:'rgba(var(--tm-loss-rgb,255,59,48),0.1)', border:'1px solid rgba(var(--tm-loss-rgb,255,59,48),0.3)', color:'var(--tm-loss)', fontSize:12, marginBottom:14 }}>
            {error}
          </div>
        )}

        {/* Preview */}
        {parsed.length > 0 && !done && (
          <>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, marginBottom:14 }}>
              {[
                { l: t('trades.tradesDetected'), v: parsed.length, c: 'var(--tm-accent)' },
                { l: t('trades.gains'),           v: wins,          c: 'var(--tm-profit)' },
                { l: t('trades.losses'),          v: losses,        c: 'var(--tm-loss)' },
                { l: t('trades.totalPnl'),        v: `${totalPnL >= 0 ? '+' : ''}$${Math.abs(totalPnL).toFixed(2)}`, c: totalPnL >= 0 ? 'var(--tm-profit)' : 'var(--tm-loss)' },
              ].map(({ l, v, c }) => (
                <div key={l} style={{ background:'var(--tm-bg-tertiary)', borderRadius:8, padding:'8px 10px', textAlign:'center' }}>
                  <div style={{ fontSize:9, color:'var(--tm-text-muted)', marginBottom:3 }}>{l}</div>
                  <div style={{ fontSize:15, fontWeight:700, color:c, fontFamily:'monospace' }}>{v}</div>
                </div>
              ))}
            </div>

            {/* Trade list preview */}
            <div style={{ maxHeight:220, overflowY:'auto', marginBottom:14, borderRadius:10, border:'1px solid #2A2F3E' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                <thead>
                  <tr style={{ background:'var(--tm-bg-tertiary)' }}>
                    {[t('dashboard.tableSymbol'),t('dashboard.tableDir'),t('dashboard.tableQty'),t('dashboard.tableEntry'),t('dashboard.tableExit'),t('dashboard.tablePnl'),t('dashboard.tableDate')].map(h => (
                      <th key={h} style={{ padding:'6px 8px', textAlign:'left', color:'var(--tm-text-muted)', fontWeight:600, fontSize:10, borderBottom:'1px solid #2A2F3E' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.map((t, i) => (
                    <tr key={i} style={{ borderBottom:'1px solid #1C2130' }}>
                      <td style={{ padding:'5px 8px', color:'var(--tm-text-primary)', fontWeight:600 }}>{t.symbol}</td>
                      <td style={{ padding:'5px 8px', color: t.direction === 'Long' ? 'var(--tm-profit)' : 'var(--tm-loss)', fontWeight:600 }}>{t.direction}</td>
                      <td style={{ padding:'5px 8px', color:'var(--tm-text-secondary)', fontFamily:'monospace' }}>{t.qty}</td>
                      <td style={{ padding:'5px 8px', color:'var(--tm-text-secondary)', fontFamily:'monospace' }}>${t.buyPrice.toFixed(2)}</td>
                      <td style={{ padding:'5px 8px', color:'var(--tm-text-secondary)', fontFamily:'monospace' }}>${t.sellPrice.toFixed(2)}</td>
                      <td style={{ padding:'5px 8px', color: t.pnl >= 0 ? 'var(--tm-profit)' : 'var(--tm-loss)', fontWeight:600, fontFamily:'monospace' }}>{t.pnl >= 0 ? '+' : ''}${Math.abs(t.pnl).toFixed(2)}</td>
                      <td style={{ padding:'5px 8px', color:'var(--tm-text-muted)' }}>{t.boughtTimestamp.split(' ')[0]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Import button */}
            <button onClick={doImport} disabled={importing} style={{ width:'100%', padding:12, borderRadius:10, border:'none', background: importing ? 'var(--tm-bg-tertiary)' : 'var(--tm-warning)', color: importing ? 'var(--tm-text-muted)' : 'var(--tm-bg)', fontSize:14, fontWeight:700, cursor: importing ? 'not-allowed' : 'pointer' }}>
              {importing ? t('trades.importingProgress', { progress, total: parsed.length }) : t('trades.importButton', { count: parsed.length })}
            </button>

            {importing && (
              <div style={{ marginTop:8, height:4, borderRadius:4, background:'var(--tm-bg-tertiary)', overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${(progress / parsed.length) * 100}%`, background:'var(--tm-warning)', borderRadius:4, transition:'width 0.3s' }} />
              </div>
            )}
          </>
        )}

        {/* Success */}
        {done && (
          <div style={{ textAlign:'center', padding:'20px 0' }}>
            <div style={{ fontSize:48, marginBottom:12 }}>✅</div>
            <div style={{ fontSize:16, fontWeight:700, color:'var(--tm-profit)', marginBottom:6 }}>{t('trades.importSuccess', { count: parsed.length })}</div>
            <div style={{ fontSize:12, color:'var(--tm-text-muted)', marginBottom:16 }}>{t('trades.totalPnl')} : <span style={{ color: totalPnL >= 0 ? 'var(--tm-profit)' : 'var(--tm-loss)', fontWeight:700, fontFamily:'monospace' }}>{totalPnL >= 0 ? '+' : ''}${Math.abs(totalPnL).toFixed(2)}</span></div>
            <button onClick={onClose} style={{ padding:'10px 32px', borderRadius:10, border:'none', background:'var(--tm-accent)', color:'var(--tm-bg)', fontSize:14, fontWeight:600, cursor:'pointer' }}>
              {t('common.close')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
