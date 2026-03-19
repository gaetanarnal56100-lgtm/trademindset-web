// LightweightChart.tsx — Graphique Lightweight Charts (TradingView OSS)
// Bougies live + dessins sauvegardés dans Firestore
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createChart, IChartApi, ISeriesApi, CrosshairMode, LineStyle, CandlestickData, Time } from 'lightweight-charts'
import { getAuth } from 'firebase/auth'
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, Timestamp } from 'firebase/firestore'
import app from '@/services/firebase/config'

const db = getFirestore(app)

// ── Types ─────────────────────────────────────────────────────────────────
interface Props { symbol: string; isCrypto: boolean }

interface Drawing {
  id?: string
  type: 'line' | 'hline' | 'fibo' | 'rect' | 'note'
  symbol: string
  timeframe: string
  data: any
  label?: string
  color: string
  createdAt: Date
}

interface SavedDrawing extends Drawing { id: string }

const TIMEFRAMES = [
  { label:'1m', minutes:1 }, { label:'5m', minutes:5 }, { label:'15m', minutes:15 },
  { label:'30m', minutes:30 }, { label:'1h', minutes:60 }, { label:'4h', minutes:240 },
  { label:'1j', minutes:1440 }, { label:'1S', minutes:10080 },
]

const DRAW_TOOLS = [
  { id:'none',  icon:'↖', label:'Curseur'   },
  { id:'hline', icon:'─', label:'H. ligne'  },
  { id:'line',  icon:'↗', label:'Tendance'  },
  { id:'fibo',  icon:'◎', label:'Fibonacci' },
  { id:'note',  icon:'✎', label:'Note'      },
]

const COLORS = ['#FF3B30','#FF9500','#FFD60A','#22C759','#00E5FF','#0A85FF','#BF5AF2','#F0F3FF']
const FIBO_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]

function fmtBinanceTF(minutes: number): string {
  if (minutes < 60)   return `${minutes}m`
  if (minutes < 1440) return `${minutes/60}h`
  if (minutes < 10080) return '1d'
  return '1w'
}

async function fetchCandles(symbol: string, isCrypto: boolean, minutes: number): Promise<CandlestickData[]> {
  if (isCrypto) {
    const tf = fmtBinanceTF(minutes)
    const sym = symbol.replace(/USDT$/i,'') + 'USDT'
    // Try futures first, then spot
    for (const base of ['https://fapi.binance.com/fapi/v1', 'https://api.binance.com/api/v3']) {
      try {
        const r = await fetch(`${base}/klines?symbol=${sym}&interval=${tf}&limit=300`)
        if (!r.ok) continue
        const d = await r.json()
        if (!Array.isArray(d) || !d.length) continue
        return d.map((k: any[]) => ({
          time: Math.floor(k[0] / 1000) as Time,
          open: parseFloat(k[1]), high: parseFloat(k[2]),
          low:  parseFloat(k[3]), close: parseFloat(k[4]),
        }))
      } catch {}
    }
  }
  return []
}

// ── Firestore helpers ────────────────────────────────────────────────────
async function saveDrawing(drawing: Drawing): Promise<string> {
  const uid = getAuth().currentUser?.uid
  if (!uid) throw new Error('Non connecté')
  const ref = collection(db, 'users', uid, 'chartDrawings')
  const docRef = await addDoc(ref, { ...drawing, createdAt: Timestamp.now() })
  return docRef.id
}

async function loadDrawings(symbol: string, timeframe: string): Promise<SavedDrawing[]> {
  const uid = getAuth().currentUser?.uid
  if (!uid) return []
  const ref = collection(db, 'users', uid, 'chartDrawings')
  const q = query(ref, orderBy('createdAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() as Drawing, createdAt: (d.data().createdAt as Timestamp).toDate() }))
    .filter(d => d.symbol === symbol && d.timeframe === timeframe)
}

async function deleteDrawing(id: string): Promise<void> {
  const uid = getAuth().currentUser?.uid
  if (!uid) return
  await deleteDoc(doc(db, 'users', uid, 'chartDrawings', id))
}

// ── Main Component ────────────────────────────────────────────────────────
export default function LightweightChart({ symbol, isCrypto }: Props) {
  const chartRef     = useRef<HTMLDivElement>(null)
  const chartApi     = useRef<IChartApi | null>(null)
  const candleSeries = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const wsRef        = useRef<WebSocket | null>(null)
  const drawLayerRef = useRef<HTMLCanvasElement>(null)
  const isDrawing    = useRef(false)
  const drawStart    = useRef<{x:number,y:number,price:number,time:number}|null>(null)

  const [tf,          setTf]          = useState(TIMEFRAMES[2])
  const [tool,        setTool]        = useState('none')
  const [color,       setColor]       = useState('#00E5FF')
  const [drawings,    setDrawings]    = useState<SavedDrawing[]>([])
  const [loading,     setLoading]     = useState(true)
  const [price,       setPrice]       = useState<number|null>(null)
  const [priceChange, setPriceChange] = useState<number>(0)
  const [savePanel,   setSavePanel]   = useState<{type:string,data:any}|null>(null)
  const [noteText,    setNoteText]    = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [toast,       setToast]       = useState<string|null>(null)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  // ── Init chart ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = chartRef.current
    if (!el) return

    chartApi.current = createChart(el, {
      width:  el.clientWidth,
      height: 380,
      layout: { background: { color: '#0D1117' }, textColor: '#555C70' },
      grid:   { vertLines: { color: '#1E233050' }, horzLines: { color: '#1E233050' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#1E2330' },
      timeScale: { borderColor: '#1E2330', timeVisible: true, secondsVisible: false },
    })

    candleSeries.current = chartApi.current.addCandlestickSeries({
      upColor:      '#22C759', downColor:     '#FF3B30',
      borderUpColor:'#22C759', borderDownColor:'#FF3B30',
      wickUpColor:  '#22C759', wickDownColor:  '#FF3B30',
    })

    // Subscribe to crosshair for price display
    chartApi.current.subscribeCrosshairMove(p => {
      if (p.seriesData.size > 0) {
        const d = p.seriesData.values().next().value as any
        if (d?.close) setPrice(d.close)
      }
    })

    const ro = new ResizeObserver(() => {
      chartApi.current?.applyOptions({ width: el.clientWidth })
    })
    ro.observe(el)

    return () => { ro.disconnect(); chartApi.current?.remove(); chartApi.current = null }
  }, [])

  // ── Load candles + WebSocket ──────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!candleSeries.current) return
    setLoading(true)
    wsRef.current?.close()

    const candles = await fetchCandles(symbol, isCrypto, tf.minutes)
    if (candles.length) {
      candleSeries.current.setData(candles)
      const last = candles[candles.length - 1]
      const first = candles[0]
      setPrice(last.close as number)
      setPriceChange(((last.close as number) - (first.open as number)) / (first.open as number) * 100)
      chartApi.current?.timeScale().fitContent()
    }
    setLoading(false)

    // WebSocket live update (crypto only)
    if (isCrypto) {
      const sym = symbol.toLowerCase().replace(/usdt$/,'') + 'usdt'
      const tfStr = fmtBinanceTF(tf.minutes)
      try {
        // Try futures first
        let wsUrl = `wss://fstream.binance.com/ws/${sym}@kline_${tfStr}`
        const ws = new WebSocket(wsUrl)
        ws.onerror = () => {
          ws.close()
          // Fallback to spot
          const ws2 = new WebSocket(`wss://stream.binance.com:9443/ws/${sym}@kline_${tfStr}`)
          ws2.onmessage = handleWsMessage
          wsRef.current = ws2
        }
        ws.onmessage = handleWsMessage
        wsRef.current = ws
      } catch {}
    }
  }, [symbol, isCrypto, tf])

  function handleWsMessage(e: MessageEvent) {
    try {
      const d = JSON.parse(e.data)
      const k = d.k
      if (!k || !candleSeries.current) return
      const candle: CandlestickData = {
        time:  Math.floor(k.t / 1000) as Time,
        open:  parseFloat(k.o), high: parseFloat(k.h),
        low:   parseFloat(k.l), close: parseFloat(k.c),
      }
      candleSeries.current.update(candle)
      setPrice(parseFloat(k.c))
    } catch {}
  }

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => () => { wsRef.current?.close() }, [])

  // ── Load saved drawings ───────────────────────────────────────────────
  const loadSavedDrawings = useCallback(async () => {
    const d = await loadDrawings(symbol, tf.label)
    setDrawings(d)
  }, [symbol, tf.label])

  useEffect(() => { loadSavedDrawings() }, [loadSavedDrawings])

  // ── Render saved drawings on canvas ──────────────────────────────────
  useEffect(() => {
    const canvas = drawLayerRef.current
    const chart  = chartApi.current
    if (!canvas || !chart) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    drawings.forEach(d => {
      ctx.strokeStyle = d.color
      ctx.fillStyle   = d.color
      ctx.lineWidth   = 1.5
      ctx.font        = '11px JetBrains Mono, monospace'

      if (d.type === 'hline' && d.data?.price != null) {
        const y = chart.priceScale('right').priceToCoordinate(d.data.price)
        if (y == null) return
        ctx.setLineDash([5, 4])
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 0.85
        ctx.fillText(`${d.label || ''} $${d.data.price.toFixed(2)}`, 6, y - 4)
        ctx.globalAlpha = 1
      }

      if (d.type === 'fibo' && d.data?.p1 && d.data?.p2) {
        const { p1, p2 } = d.data
        const high = Math.max(p1.price, p2.price)
        const low  = Math.min(p1.price, p2.price)
        const range = high - low
        FIBO_LEVELS.forEach(lvl => {
          const price = high - range * lvl
          const y = chart.priceScale('right').priceToCoordinate(price)
          if (y == null) return
          ctx.globalAlpha = 0.5
          ctx.setLineDash([3, 4])
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke()
          ctx.setLineDash([])
          ctx.globalAlpha = 0.9
          ctx.fillText(`${(lvl * 100).toFixed(1)}%  $${price.toFixed(2)}`, 6, y - 3)
          ctx.globalAlpha = 1
        })
      }

      if (d.type === 'note' && d.data?.price != null) {
        const y = chart.priceScale('right').priceToCoordinate(d.data.price)
        if (y == null) return
        ctx.globalAlpha = 0.9
        ctx.fillStyle = d.color + '22'
        ctx.strokeStyle = d.color
        ctx.beginPath()
        ctx.roundRect?.(8, y - 14, Math.min((d.label?.length || 10) * 7 + 16, 280), 20, 4)
        ctx.fill(); ctx.stroke()
        ctx.fillStyle = d.color
        ctx.fillText(d.label || '', 16, y + 1)
        ctx.globalAlpha = 1
      }
    })
  }, [drawings])

  // ── Save drawing ──────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!savePanel) return
    setSaving(true)
    try {
      const drawing: Drawing = {
        type:      savePanel.type as Drawing['type'],
        symbol,
        timeframe: tf.label,
        data:      savePanel.data,
        label:     noteText || undefined,
        color,
        createdAt: new Date(),
      }
      const id = await saveDrawing(drawing)
      setDrawings(prev => [{ ...drawing, id }, ...prev])
      setSavePanel(null); setNoteText('')
      showToast('✓ Sauvegardé dans Firestore')
    } catch { showToast('Erreur — es-tu connecté ?') }
    setSaving(false)
  }

  const handleDeleteDrawing = async (id: string) => {
    await deleteDrawing(id)
    setDrawings(prev => prev.filter(d => d.id !== id))
    showToast('Supprimé')
  }

  // ── Click on chart to place drawing ──────────────────────────────────
  const handleChartClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (tool === 'none' || !chartApi.current) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const priceVal = chartApi.current.priceScale('right').coordinateToPrice(y)
    if (priceVal == null) return

    if (tool === 'hline') {
      setSavePanel({ type: 'hline', data: { price: priceVal } })
    } else if (tool === 'fibo') {
      if (!isDrawing.current) {
        isDrawing.current = true
        drawStart.current = { x, y, price: priceVal, time: Date.now() }
        showToast('Cliquez sur le 2ème point pour placer le Fibo')
      } else {
        isDrawing.current = false
        const p1 = drawStart.current!
        setSavePanel({ type: 'fibo', data: { p1: { price: p1.price }, p2: { price: priceVal } } })
        drawStart.current = null
      }
    } else if (tool === 'note') {
      setSavePanel({ type: 'note', data: { price: priceVal } })
    }
  }, [tool])

  const fmtPrice = (p: number) => p > 1000 ? `$${p.toLocaleString('fr-FR', {maximumFractionDigits:1})}` : `$${p.toFixed(4)}`

  return (
    <div style={{ background:'#161B22', border:'1px solid #1E2330', borderRadius:16, overflow:'hidden', marginBottom:16 }}>

      {/* Header */}
      <div style={{ padding:'10px 14px', borderBottom:'1px solid #1E2330', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
          <div style={{ width:26, height:26, borderRadius:7, background:'linear-gradient(135deg,#22C759,#00E5FF)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13 }}>⚡</div>
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:'#F0F3FF' }}>Lightweight Charts</div>
            <div style={{ fontSize:9, color:'#555C70' }}>Sauvegarde Firestore · {symbol}</div>
          </div>
        </div>

        {/* Prix live */}
        {price && (
          <div style={{ display:'flex', alignItems:'baseline', gap:6, marginLeft:4 }}>
            <span style={{ fontSize:14, fontWeight:700, color:'#F0F3FF', fontFamily:'JetBrains Mono, monospace' }}>{fmtPrice(price)}</span>
            <span style={{ fontSize:10, fontWeight:600, color: priceChange >= 0 ? '#22C759' : '#FF3B30', fontFamily:'JetBrains Mono, monospace' }}>
              {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
            </span>
            <span style={{ fontSize:8, color:'#22C75990', animation:'pulse 1.5s infinite' }}>● LIVE</span>
          </div>
        )}

        {/* UT */}
        <div style={{ display:'flex', gap:3, marginLeft:4 }}>
          {TIMEFRAMES.map(t => (
            <button key={t.label} onClick={() => setTf(t)} style={{
              padding:'3px 7px', borderRadius:6, fontSize:10, fontWeight:600, cursor:'pointer',
              border:`1px solid ${tf.label===t.label?'#00E5FF':'#2A2F3E'}`,
              background: tf.label===t.label?'rgba(0,229,255,0.12)':'transparent',
              color: tf.label===t.label?'#00E5FF':'#555C70',
            }}>{t.label}</button>
          ))}
        </div>

        {/* Historique */}
        <button onClick={() => setShowHistory(x=>!x)} style={{
          marginLeft:'auto', padding:'3px 10px', borderRadius:6, fontSize:10, fontWeight:600,
          cursor:'pointer', border:`1px solid ${showHistory?'#22C759':'#2A2F3E'}`,
          background: showHistory?'rgba(34,199,89,0.1)':'transparent',
          color: showHistory?'#22C759':'#555C70',
        }}>
          💾 {drawings.length > 0 ? `${drawings.length} sauvegarde${drawings.length>1?'s':''}` : 'Sauvegardes'}
        </button>
      </div>

      {/* Toolbar dessins */}
      <div style={{ padding:'6px 14px', borderBottom:'1px solid #1E2330', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
        <span style={{ fontSize:9, color:'#3D4254', flexShrink:0 }}>Outil :</span>
        {DRAW_TOOLS.map(t => (
          <button key={t.id} onClick={() => setTool(t.id)} title={t.label} style={{
            padding:'3px 9px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer',
            border:`1px solid ${tool===t.id?'#FF9500':'#2A2F3E'}`,
            background: tool===t.id?'rgba(255,149,0,0.12)':'transparent',
            color: tool===t.id?'#FF9500':'#555C70',
          }}>{t.icon} {t.label}</button>
        ))}

        <div style={{ width:1, height:14, background:'#2A2F3E', margin:'0 2px' }}/>
        <span style={{ fontSize:9, color:'#3D4254' }}>Couleur :</span>
        {COLORS.map(c => (
          <div key={c} onClick={() => setColor(c)} style={{
            width:14, height:14, borderRadius:'50%', background:c, cursor:'pointer',
            border: color===c ? '2px solid #F0F3FF' : '2px solid transparent', flexShrink:0,
          }}/>
        ))}

        {tool !== 'none' && (
          <span style={{ marginLeft:4, fontSize:10, color:'#FF9500', fontWeight:600 }}>
            ← Cliquez sur le graphique
          </span>
        )}
      </div>

      {/* Chart + overlay canvas */}
      <div style={{ position:'relative', background:'#0D1117' }}>
        {loading && (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'#0D1117', zIndex:3 }}>
            <div style={{ width:24, height:24, border:'2px solid #1E2330', borderTopColor:'#22C759', borderRadius:'50%', animation:'spin 0.8s linear infinite' }}/>
          </div>
        )}
        <div ref={chartRef} onClick={handleChartClick}
          style={{ width:'100%', height:380, cursor: tool !== 'none' ? 'crosshair' : 'default' }}/>
        <canvas ref={drawLayerRef} width={800} height={380}
          style={{ position:'absolute', top:0, left:0, width:'100%', height:'100%', pointerEvents:'none', zIndex:2 }}/>
      </div>

      {/* Panneau sauvegarde rapide */}
      {savePanel && (
        <div style={{ padding:'12px 14px', background:'rgba(255,149,0,0.05)', borderTop:'1px solid rgba(255,149,0,0.2)', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          <span style={{ fontSize:11, color:'#FF9500', fontWeight:700 }}>
            {savePanel.type === 'hline' ? `📏 Ligne H. @ $${savePanel.data.price.toFixed(2)}` :
             savePanel.type === 'fibo'  ? `◎ Fibo ${savePanel.data.p1.price.toFixed(0)} → ${savePanel.data.p2.price.toFixed(0)}` :
             '✎ Note'}
          </span>
          <input value={noteText} onChange={e => setNoteText(e.target.value)}
            placeholder={savePanel.type === 'note' ? 'Texte de la note…' : 'Label (optionnel)…'}
            style={{ flex:1, background:'#1C2130', border:'1px solid #2A2F3E', borderRadius:8,
              padding:'5px 10px', color:'#F0F3FF', fontSize:11, minWidth:120 }}/>
          <button onClick={handleSave} disabled={saving} style={{
            padding:'5px 14px', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer',
            background:'rgba(34,199,89,0.15)', border:'1px solid #22C759', color:'#22C759',
          }}>{saving ? '…' : '💾 Sauvegarder'}</button>
          <button onClick={() => { setSavePanel(null); setNoteText(''); isDrawing.current = false }} style={{
            padding:'5px 10px', borderRadius:8, fontSize:11, cursor:'pointer',
            background:'transparent', border:'1px solid #2A2F3E', color:'#555C70',
          }}>✕</button>
        </div>
      )}

      {/* Historique des sauvegardes */}
      {showHistory && (
        <div style={{ borderTop:'1px solid #1E2330', maxHeight:200, overflowY:'auto' }}>
          {drawings.length === 0 ? (
            <div style={{ padding:'16px', textAlign:'center', color:'#3D4254', fontSize:12 }}>
              Aucune sauvegarde pour {symbol} · {tf.label}
            </div>
          ) : drawings.map(d => (
            <div key={d.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 14px',
              borderBottom:'1px solid rgba(255,255,255,0.03)' }}>
              <div style={{ width:3, height:28, borderRadius:2, background:d.color, flexShrink:0 }}/>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:11, fontWeight:600, color:'#F0F3FF' }}>
                  {d.type === 'hline' ? `Ligne H. @ $${d.data?.price?.toFixed(2)}` :
                   d.type === 'fibo'  ? `Fibo ${d.data?.p1?.price?.toFixed(0)} → ${d.data?.p2?.price?.toFixed(0)}` :
                   d.type === 'note'  ? `Note : "${d.label}"` : d.type}
                </div>
                <div style={{ fontSize:9, color:'#3D4254' }}>
                  {d.createdAt.toLocaleDateString('fr-FR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
                </div>
              </div>
              <button onClick={() => handleDeleteDrawing(d.id)} style={{
                background:'rgba(255,59,48,0.1)', border:'1px solid rgba(255,59,48,0.2)',
                borderRadius:6, color:'#FF3B30', cursor:'pointer', fontSize:10, padding:'3px 8px',
              }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position:'absolute', bottom:16, left:'50%', transform:'translateX(-50%)',
          background:'#1C2130', border:'1px solid #2A2F3E', borderRadius:10, padding:'8px 16px',
          fontSize:12, color:'#F0F3FF', zIndex:10, whiteSpace:'nowrap',
          boxShadow:'0 4px 16px rgba(0,0,0,0.4)' }}>{toast}</div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>
    </div>
  )
}
