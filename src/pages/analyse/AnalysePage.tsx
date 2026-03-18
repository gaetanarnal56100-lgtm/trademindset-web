// src/pages/analyse/AnalysePage.tsx
// Miroir de LiquidityCVDStackView + LiquidityHeatmapView + SymbolSearchBar + AIAnalysisEngine
import { useState, useEffect, useRef, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────

interface Candle {
  openTime: number; open: number; high: number; low: number
  close: number; volume: number; closeTime: number
}

interface LiqLevel { price: number; volume: number; side: 'long' | 'short' }

interface CVDPoint { time: number; small: number; medium: number; large: number; institutional: number; whales: number; all: number }

type Tab = 'heatmap' | 'cvd' | 'photo'
type Period = '4h' | '12h' | '1d' | '3d' | '1w'
type CVDSeg = 'small' | 'medium' | 'large' | 'institutional' | 'whales' | 'all'

const PERIODS: { v: Period; l: string; interval: string; limit: number }[] = [
  { v: '4h', l: '4H', interval: '5m', limit: 48 },
  { v: '12h', l: '12H', interval: '15m', limit: 48 },
  { v: '1d', l: '1J', interval: '30m', limit: 48 },
  { v: '3d', l: '3J', interval: '2h', limit: 36 },
  { v: '1w', l: '1S', interval: '4h', limit: 42 },
]

const CVD_SEGS: { v: CVDSeg; l: string; color: string; range: string }[] = [
  { v: 'small', l: 'Small', color: '#607D8B', range: '$100–1k' },
  { v: 'medium', l: 'Medium', color: '#42A5F5', range: '$1k–10k' },
  { v: 'large', l: 'Large', color: '#66BB6A', range: '$10k–100k' },
  { v: 'institutional', l: 'Institutional', color: '#FFA726', range: '$100k–1M' },
  { v: 'whales', l: 'Whales', color: '#EF5350', range: '>$1M' },
  { v: 'all', l: 'All Orders', color: '#B0BEC5', range: 'Tous' },
]

const TIMEFRAMES = [
  { v: '1m', l: '1 Min' }, { v: '5m', l: '5 Min' }, { v: '15m', l: '15 Min' },
  { v: '30m', l: '30 Min' }, { v: '1h', l: '1H' }, { v: '4h', l: '4H' },
  { v: '1d', l: '1J' }, { v: '1w', l: '1S' },
]

const POPULAR = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'AVAXUSDT', 'DOGEUSDT', 'ADAUSDT']

function fmt(n: number) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}
function fmtPrice(n: number) {
  return n > 1000 ? n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) :
    n > 1 ? n.toFixed(4) : n.toFixed(6)
}

// ── Binance API ────────────────────────────────────────────────────────────

async function fetchKlines(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  const r = await fetch(url)
  if (!r.ok) throw new Error('Binance API error')
  const raw: unknown[][] = await r.json()
  return raw.map(a => ({
    openTime: Number(a[0]) / 1000,
    open: parseFloat(a[1] as string),
    high: parseFloat(a[2] as string),
    low: parseFloat(a[3] as string),
    close: parseFloat(a[4] as string),
    volume: parseFloat(a[5] as string),
    closeTime: Number(a[6]) / 1000,
  }))
}

async function searchSymbols(q: string): Promise<string[]> {
  const r = await fetch('https://api.binance.com/api/v3/exchangeInfo')
  const data = await r.json()
  const symbols: string[] = data.symbols?.map((s: { symbol: string }) => s.symbol) ?? []
  return symbols.filter(s => s.includes(q.toUpperCase()) && (s.endsWith('USDT') || s.endsWith('BTC'))).slice(0, 12)
}

// ── Build Liquidation Heatmap ──────────────────────────────────────────────

function buildHeatmap(candles: Candle[]): { levels: LiqLevel[]; minPrice: number; maxPrice: number } {
  if (!candles.length) return { levels: [], minPrice: 0, maxPrice: 0 }
  const prices = candles.flatMap(c => [c.high, c.low])
  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const range = maxPrice - minPrice
  const buckets = 80
  const step = range / buckets
  const longVols = new Array(buckets).fill(0)
  const shortVols = new Array(buckets).fill(0)
  const leverages = [5, 10, 25, 50, 100]
  const weights: Record<number, number> = { 5: 0.5, 10: 1.0, 25: 2.5, 50: 2.0, 100: 0.8 }

  candles.forEach(c => {
    const vol = c.volume * c.close
    leverages.forEach(lev => {
      const w = weights[lev]
      // Long liquidation = price drops lev% below entry
      const longLiqPrice = c.close * (1 - 1 / lev)
      // Short liquidation = price rises lev% above entry
      const shortLiqPrice = c.close * (1 + 1 / lev)
      const li = Math.floor((longLiqPrice - minPrice) / step)
      const si = Math.floor((shortLiqPrice - minPrice) / step)
      if (li >= 0 && li < buckets) longVols[li] += vol * w * 0.01
      if (si >= 0 && si < buckets) shortVols[si] += vol * w * 0.01
    })
  })

  const levels: LiqLevel[] = []
  for (let i = 0; i < buckets; i++) {
    const price = minPrice + i * step + step / 2
    if (longVols[i] > 0) levels.push({ price, volume: longVols[i], side: 'long' })
    if (shortVols[i] > 0) levels.push({ price, volume: shortVols[i], side: 'short' })
  }
  return { levels, minPrice, maxPrice }
}

// ── Build CVD ──────────────────────────────────────────────────────────────

function buildCVD(candles: Candle[]): CVDPoint[] {
  let all = 0, small = 0, medium = 0, large = 0, institutional = 0, whales = 0
  return candles.map(c => {
    const vol = c.volume * c.close
    const delta = c.close > c.open ? vol : -vol
    const absDelta = Math.abs(delta)
    all += delta
    if (absDelta < 1000) small += delta
    else if (absDelta < 10000) medium += delta
    else if (absDelta < 100000) large += delta
    else if (absDelta < 1000000) institutional += delta
    else whales += delta
    return { time: c.openTime, all, small, medium, large, institutional, whales }
  })
}

// ── Symbol Search ──────────────────────────────────────────────────────────

function SymbolSearch({ symbol, onSelect }: { symbol: string; onSelect: (s: string) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!q) { setResults([]); return }
    setLoading(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try { setResults(await searchSymbols(q)) }
      catch { setResults(POPULAR.filter(s => s.includes(q.toUpperCase()))) }
      finally { setLoading(false) }
    }, 400)
  }, [q])

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#161B22', border: '1px solid #2A2F3E', borderRadius: 10, padding: '8px 12px' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#555C70" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input
          value={q} onChange={e => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={symbol}
          style={{ background: 'none', border: 'none', outline: 'none', color: '#F0F3FF', fontSize: 14, fontWeight: 600, width: 120 }}
        />
        {loading && <div style={{ width: 12, height: 12, border: '2px solid #2A2F3E', borderTopColor: '#00E5FF', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />}
        <div style={{ fontSize: 10, color: '#00E5FF', background: 'rgba(0,229,255,0.1)', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>LIVE</div>
      </div>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#161B22', border: '1px solid #2A2F3E', borderRadius: 10, zIndex: 50, marginTop: 4, maxHeight: 240, overflowY: 'auto' }}>
          {!q && (
            <div style={{ padding: '8px 12px' }}>
              <div style={{ fontSize: 10, color: '#555C70', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Populaires</div>
              {POPULAR.map(s => (
                <button key={s} onClick={() => { onSelect(s); setQ(''); setOpen(false) }} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 6, color: '#F0F3FF', fontSize: 13 }}>
                  <span>{s}</span>
                  {s === symbol && <span style={{ fontSize: 10, color: '#00E5FF' }}>●</span>}
                </button>
              ))}
            </div>
          )}
          {q && results.map(s => (
            <button key={s} onClick={() => { onSelect(s); setQ(''); setOpen(false) }} style={{ width: '100%', textAlign: 'left', padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer', color: '#F0F3FF', fontSize: 13, borderBottom: '1px solid #1C2130' }}>
              {s}
            </button>
          ))}
          {q && results.length === 0 && !loading && <div style={{ padding: '10px 14px', fontSize: 12, color: '#555C70' }}>Aucun résultat pour "{q}"</div>}
        </div>
      )}
    </div>
  )
}

// ── Heatmap Canvas ─────────────────────────────────────────────────────────

function HeatmapCanvas({ candles, currentPrice }: { candles: Candle[]; currentPrice: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !candles.length) return
    const ctx = canvas.getContext('2d')!
    const W = canvas.width, H = canvas.height

    // Background
    ctx.fillStyle = '#0D0818'
    ctx.fillRect(0, 0, W, H)

    const { levels, minPrice, maxPrice } = buildHeatmap(candles)
    if (!levels.length) return

    const priceRange = maxPrice - minPrice
    const maxVol = Math.max(...levels.map(l => l.volume))

    // Draw levels
    levels.forEach(({ price, volume, side }) => {
      const y = H - ((price - minPrice) / priceRange) * H
      const intensity = Math.pow(volume / maxVol, 0.4)
      const h = Math.max(2, (H / 80))

      if (side === 'long') {
        const r = Math.round(intensity * 50)
        const g = Math.round(100 + intensity * 155)
        const b = Math.round(150 + intensity * 105)
        ctx.fillStyle = `rgba(${r},${g},${b},${0.15 + intensity * 0.7})`
      } else {
        const r = Math.round(150 + intensity * 105)
        const g = Math.round(intensity * 80)
        const b = Math.round(200 + intensity * 55)
        ctx.fillStyle = `rgba(${r},${g},${b},${0.15 + intensity * 0.6})`
      }
      ctx.fillRect(0, y - h / 2, W - 60, h)
    })

    // Draw candles
    const cW = (W - 60) / candles.length
    candles.forEach((c, i) => {
      const x = i * cW
      const oY = H - ((c.open - minPrice) / priceRange) * H
      const cY = H - ((c.close - minPrice) / priceRange) * H
      const hY = H - ((c.high - minPrice) / priceRange) * H
      const lY = H - ((c.low - minPrice) / priceRange) * H
      const bull = c.close >= c.open
      ctx.strokeStyle = bull ? '#22C75980' : '#FF3B3080'
      ctx.lineWidth = 0.8
      ctx.beginPath(); ctx.moveTo(x + cW / 2, hY); ctx.lineTo(x + cW / 2, lY); ctx.stroke()
      ctx.fillStyle = bull ? '#22C75960' : '#FF3B3060'
      const top = Math.min(oY, cY), bH = Math.max(1, Math.abs(oY - cY))
      ctx.fillRect(x + 1, top, Math.max(1, cW - 2), bH)
    })

    // Price line
    if (currentPrice > 0 && currentPrice >= minPrice && currentPrice <= maxPrice) {
      const py = H - ((currentPrice - minPrice) / priceRange) * H
      ctx.setLineDash([4, 3])
      ctx.strokeStyle = '#00E5FF'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W - 60, py); ctx.stroke()
      ctx.setLineDash([])
      // Price label
      ctx.fillStyle = '#00E5FF'
      ctx.fillRect(W - 58, py - 9, 58, 18)
      ctx.fillStyle = '#0D1117'
      ctx.font = 'bold 9px monospace'
      ctx.textAlign = 'right'
      ctx.fillText(`$${fmtPrice(currentPrice)}`, W - 2, py + 3)
    }

    // Price axis (right)
    ctx.font = '9px monospace'
    ctx.fillStyle = '#555C70'
    ctx.textAlign = 'right'
    for (let i = 0; i <= 5; i++) {
      const p = minPrice + (priceRange * i) / 5
      const y = H - (i / 5) * H
      ctx.fillText(`$${fmtPrice(p)}`, W - 2, y + 3)
    }
  }, [candles, currentPrice])

  return (
    <canvas
      ref={canvasRef} width={700} height={280}
      style={{ width: '100%', height: 280, borderRadius: 8, display: 'block' }}
    />
  )
}

// ── CVD Chart ──────────────────────────────────────────────────────────────

function CVDChart({ points, activeSeg }: { points: CVDPoint[]; activeSeg: CVDSeg }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !points.length) return
    const ctx = canvas.getContext('2d')!
    const W = canvas.width, H = canvas.height

    ctx.fillStyle = '#0D1117'
    ctx.fillRect(0, 0, W, H)

    const vals = points.map(p => p[activeSeg])
    const minV = Math.min(...vals), maxV = Math.max(...vals)
    const range = maxV - minV || 1

    // Zero line
    const zeroY = H - ((-minV) / range) * H
    ctx.strokeStyle = '#2A2F3E'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])
    ctx.beginPath(); ctx.moveTo(0, zeroY); ctx.lineTo(W, zeroY); ctx.stroke()
    ctx.setLineDash([])

    const cfg = CVD_SEGS.find(s => s.v === activeSeg)!
    const color = cfg.color

    // Area fill
    ctx.beginPath()
    points.forEach((p, i) => {
      const x = (i / (points.length - 1)) * W
      const y = H - ((p[activeSeg] - minV) / range) * H
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.lineTo(W, zeroY); ctx.lineTo(0, zeroY); ctx.closePath()
    const last = vals[vals.length - 1]
    const grad = ctx.createLinearGradient(0, 0, 0, H)
    if (last >= 0) {
      grad.addColorStop(0, color + '60'); grad.addColorStop(1, color + '05')
    } else {
      grad.addColorStop(0, color + '05'); grad.addColorStop(1, color + '60')
    }
    ctx.fillStyle = grad; ctx.fill()

    // Line
    ctx.beginPath()
    ctx.strokeStyle = color; ctx.lineWidth = 1.5
    points.forEach((p, i) => {
      const x = (i / (points.length - 1)) * W
      const y = H - ((p[activeSeg] - minV) / range) * H
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.stroke()

    // Segments under-filled by size
    const barW = W / points.length
    points.forEach((p, i) => {
      const x = i * barW
      const v = p[activeSeg]
      const barH = Math.abs((v / range) * H * 0.15)
      const y = v >= 0 ? zeroY - barH : zeroY
      ctx.fillStyle = v >= 0 ? '#22C75930' : '#FF3B3030'
      ctx.fillRect(x, y, barW - 1, barH)
    })

    // Y axis labels
    ctx.font = '9px monospace'; ctx.fillStyle = '#555C70'; ctx.textAlign = 'right'
    for (let i = 0; i <= 3; i++) {
      const v = minV + (range * i) / 3
      const y = H - (i / 3) * H
      ctx.fillText(fmt(v), W - 2, y + 3)
    }
  }, [points, activeSeg])

  return (
    <canvas ref={canvasRef} width={700} height={160}
      style={{ width: '100%', height: 160, borderRadius: 8, display: 'block' }} />
  )
}

// ── AI Analysis ────────────────────────────────────────────────────────────

async function runAIAnalysis(symbol: string, candles: Candle[], cvdPoints: CVDPoint[]): Promise<string> {
  const last = candles[candles.length - 1]
  const first = candles[0]
  const pctChange = ((last.close - first.open) / first.open * 100).toFixed(2)
  const lastCVD = cvdPoints[cvdPoints.length - 1]
  const prevCVD = cvdPoints[Math.floor(cvdPoints.length / 2)]

  const ctx = `
Actif: ${symbol}
Prix actuel: $${fmtPrice(last.close)}
Variation période: ${pctChange}%
Plus haut: $${fmtPrice(Math.max(...candles.map(c => c.high)))}
Plus bas: $${fmtPrice(Math.min(...candles.map(c => c.low)))}
Volume moyen: ${fmt(candles.reduce((s, c) => s + c.volume * c.close, 0) / candles.length)}

CVD actuel:
- All Orders: ${fmt(lastCVD.all)} (${lastCVD.all > prevCVD.all ? '↑ accumulation' : '↓ distribution'})
- Whales (>$1M): ${fmt(lastCVD.whales)} 
- Institutional ($100k-1M): ${fmt(lastCVD.institutional)}
- Large ($10k-100k): ${fmt(lastCVD.large)}
- Tendance CVD globale: ${lastCVD.all > 0 ? 'POSITIVE (acheteurs dominants)' : 'NÉGATIVE (vendeurs dominants)'}

Dernières bougies (5 dernières):
${candles.slice(-5).map(c => `${c.close > c.open ? '🟢' : '🔴'} O:${fmtPrice(c.open)} H:${fmtPrice(c.high)} L:${fmtPrice(c.low)} C:${fmtPrice(c.close)} Vol:${fmt(c.volume * c.close)}`).join('\n')}
`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: `Tu es un expert en trading crypto spécialisé dans l'analyse on-chain et order flow. Tu analyses les données de marché incluant le CVD (Cumulative Volume Delta) segmenté par taille d'ordre et la heatmap de liquidation pour donner une analyse synthétique précise et actionnable. Réponds en français, de façon concise et structurée.`,
      messages: [{
        role: 'user',
        content: `Analyse ces données de marché pour ${symbol} et donne:\n1. BIAIS DIRECTIONNEL (haussier/baissier/neutre) avec score de conviction /10\n2. LECTURE DU CVD (qui achète? qui vend? y a-t-il de l'accumulation whale?)\n3. ZONES DE LIQUIDATION CLÉS (support/résistance issues de la heatmap)\n4. SIGNAL D'ACTION (entrée potentielle, invalidation, cible)\n5. RISQUES PRINCIPAUX\n\nDonnées:\n${ctx}`,
      }],
    }),
  })

  const data = await response.json()
  return data.content?.find((b: { type: string }) => b.type === 'text')?.text ?? 'Analyse indisponible'
}

// ── Photo Analysis ─────────────────────────────────────────────────────────

function PhotoUpload({ onAnalysis }: { onAnalysis: (r: string) => void }) {
  const [images, setImages] = useState<{ tf: string; file: File; preview: string }[]>([])
  const [tf, setTf] = useState('1h')
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  const add = (file: File) => {
    const preview = URL.createObjectURL(file)
    setImages(p => [...p.filter(i => i.tf !== tf), { tf, file, preview }])
  }

  const analyze = async () => {
    if (!images.length) return
    setLoading(true)
    try {
      const payloads = await Promise.all(images.map(img => new Promise<{ tf: string; b64: string }>((res, rej) => {
        const r = new FileReader()
        r.onload = e => res({ tf: img.tf, b64: (e.target?.result as string).split(',')[1] })
        r.onerror = rej; r.readAsDataURL(img.file)
      })))

      const isMulti = payloads.length > 1
      const content: unknown[] = [
        { type: 'text', text: isMulti
          ? `Analyse ces ${payloads.length} graphiques (${payloads.map(p => p.tf).join(', ')}) et retourne un JSON avec: resume, structure, zones, momentum, patterns, plan{biais,entree,stop,objectifs,rr}, psychologie, confluences, risques, symbol`
          : 'Analyse ce graphique trading. Retourne JSON: resume, structure, zones, momentum, patterns, plan{biais,entree,stop,objectifs}, psychologie, symbol' },
        ...payloads.map(p => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.b64 } })),
      ]

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, system: 'Expert trading. JSON strict uniquement, sans markdown.', messages: [{ role: 'user', content }] }),
      })
      const data = await resp.json()
      const text = data.content?.find((b: { type: string }) => b.type === 'text')?.text ?? ''
      onAnalysis(text)
    } catch (e) { onAnalysis('Erreur: ' + (e as Error).message) }
    finally { setLoading(false) }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
        {TIMEFRAMES.map(t => (
          <button key={t.v} onClick={() => setTf(t.v)} style={{ padding: '3px 9px', borderRadius: 5, fontSize: 11, cursor: 'pointer', border: '1px solid', borderColor: tf === t.v ? '#00E5FF' : '#2A2F3E', background: tf === t.v ? 'rgba(0,229,255,0.1)' : '#161B22', color: tf === t.v ? '#00E5FF' : '#8F94A3', fontWeight: 500 }}>
            {t.l}{images.find(i => i.tf === t.v) && <span style={{ color: '#22C759', marginLeft: 3 }}>●</span>}
          </button>
        ))}
      </div>
      <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) add(f) }} onClick={() => ref.current?.click()} style={{ border: '1.5px dashed #2A2F3E', borderRadius: 10, padding: 18, textAlign: 'center', cursor: 'pointer', background: '#0D1117', marginBottom: 10 }}>
        <div style={{ fontSize: 22, marginBottom: 4 }}>📊</div>
        <div style={{ fontSize: 12, color: '#8F94A3' }}>Drop chart <strong style={{ color: '#00E5FF' }}>{tf}</strong> ici ou clique</div>
        <input ref={ref} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && add(e.target.files[0])} />
      </div>
      {images.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(90px,1fr))', gap: 6, marginBottom: 10 }}>
          {images.map(img => (
            <div key={img.tf} style={{ position: 'relative' }}>
              <img src={img.preview} alt={img.tf} style={{ width: '100%', height: 65, objectFit: 'cover', borderRadius: 6, border: '1px solid #2A2F3E' }} />
              <div style={{ position: 'absolute', top: 2, left: 2, background: 'rgba(0,229,255,0.15)', color: '#00E5FF', fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3 }}>{img.tf}</div>
              <button onClick={() => setImages(p => p.filter(i => i.tf !== img.tf))} style={{ position: 'absolute', top: 2, right: 2, width: 14, height: 14, borderRadius: '50%', background: '#FF3B30', border: 'none', color: 'white', fontSize: 8, cursor: 'pointer' }}>✕</button>
            </div>
          ))}
        </div>
      )}
      <button onClick={analyze} disabled={!images.length || loading} style={{ width: '100%', padding: '9px 0', borderRadius: 9, border: 'none', background: !images.length ? '#1C2130' : '#00E5FF', color: !images.length ? '#555C70' : '#0D1117', fontSize: 13, fontWeight: 600, cursor: !images.length ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        {loading ? <><div style={{ width: 13, height: 13, border: '2px solid #0D111730', borderTopColor: '#0D1117', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Analyse...</> : `Analyser ${images.length > 1 ? `${images.length} charts` : 'le chart'}`}
      </button>
    </div>
  )
}

function PhotoResult({ text }: { text: string }) {
  let data: Record<string, unknown> | null = null
  try {
    const m = text.match(/\{[\s\S]*\}/)
    if (m) data = JSON.parse(m[0])
  } catch { /* raw text fallback */ }

  if (!data) return <div style={{ fontSize: 13, color: '#C5C8D6', lineHeight: 1.7, whiteSpace: 'pre-wrap', padding: 14, background: '#161B22', borderRadius: 10, border: '1px solid #2A2F3E' }}>{text}</div>

  const plan = data.plan as Record<string, string> | null
  return (
    <div>
      {data.symbol && <div style={{ fontSize: 13, fontWeight: 700, color: '#00E5FF', marginBottom: 8 }}>📊 {String(data.symbol)}</div>}
      {data.resume && <div style={{ fontSize: 13, color: '#C5C8D6', lineHeight: 1.7, marginBottom: 12, padding: 12, background: '#161B22', borderRadius: 8, border: '1px solid #2A2F3E' }}>{String(data.resume)}</div>}
      {plan && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
          {['biais', 'entree', 'stop', 'objectifs', 'rr', 'confirmation'].filter(k => plan[k]).map(k => (
            <div key={k} style={{ background: '#161B22', border: '1px solid #2A2F3E', borderRadius: 7, padding: 8 }}>
              <div style={{ fontSize: 9, color: '#555C70', marginBottom: 3, textTransform: 'uppercase' }}>{k}</div>
              <div style={{ fontSize: 11, color: '#F0F3FF' }}>{plan[k]}</div>
            </div>
          ))}
        </div>
      )}
      {['structure', 'zones', 'momentum', 'confluences', 'risques', 'psychologie'].filter(k => data![k]).map(k => (
        <details key={k} style={{ marginBottom: 6, background: '#161B22', border: '1px solid #2A2F3E', borderRadius: 8, overflow: 'hidden' }}>
          <summary style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 500, color: '#F0F3FF', listStyle: 'none' }}>▶ {k.charAt(0).toUpperCase() + k.slice(1)}</summary>
          <div style={{ padding: '8px 12px', fontSize: 12, color: '#C5C8D6', lineHeight: 1.6, borderTop: '1px solid #2A2F3E' }}>{String(data![k])}</div>
        </details>
      ))}
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function AnalysePage() {
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [tab, setTab] = useState<Tab>('heatmap')
  const [period, setPeriod] = useState<Period>('1d')
  const [activeSeg, setActiveSeg] = useState<CVDSeg>('all')
  const [candles, setCandles] = useState<Candle[]>([])
  const [cvd, setCvd] = useState<CVDPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [aiResult, setAiResult] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [photoResult, setPhotoResult] = useState<string | null>(null)

  const load = useCallback(async (sym: string, per: Period) => {
    setLoading(true); setAiResult(null)
    try {
      const p = PERIODS.find(x => x.v === per)!
      const data = await fetchKlines(sym, p.interval, p.limit)
      setCandles(data)
      setCvd(buildCVD(data))
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load(symbol, period) }, [symbol, period, load])

  const handleAI = async () => {
    if (!candles.length || !cvd.length) return
    setAiLoading(true)
    try { setAiResult(await runAIAnalysis(symbol, candles, cvd)) }
    catch (e) { setAiResult('Erreur: ' + (e as Error).message) }
    finally { setAiLoading(false) }
  }

  const currentPrice = candles[candles.length - 1]?.close ?? 0
  const priceChange = candles.length > 1 ? ((currentPrice - candles[0].open) / candles[0].open * 100) : 0
  const lastCVD = cvd[cvd.length - 1]

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#F0F3FF', margin: 0 }}>Analyse</h1>
          <p style={{ fontSize: 13, color: '#8F94A3', margin: '3px 0 0' }}>Heatmap · CVD · Photo Analysis · IA</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SymbolSearch symbol={symbol} onSelect={s => setSymbol(s)} />
          {currentPrice > 0 && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#F0F3FF', fontFamily: 'monospace' }}>${fmtPrice(currentPrice)}</div>
              <div style={{ fontSize: 11, color: priceChange >= 0 ? '#22C759' : '#FF3B30', fontFamily: 'monospace' }}>
                {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: '#161B22', padding: 4, borderRadius: 10, width: 'fit-content' }}>
        {([
          { id: 'heatmap' as Tab, l: '🔥 Liquidation Map' },
          { id: 'cvd' as Tab, l: '📊 CVD' },
          { id: 'photo' as Tab, l: '📸 Photo Analysis' },
        ]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, background: tab === t.id ? '#00E5FF' : 'transparent', color: tab === t.id ? '#0D1117' : '#8F94A3', transition: 'all 0.15s' }}>{t.l}</button>
        ))}
      </div>

      {/* Period selector (heatmap + cvd) */}
      {(tab === 'heatmap' || tab === 'cvd') && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {PERIODS.map(p => (
            <button key={p.v} onClick={() => setPeriod(p.v)} style={{ padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: '1px solid', borderColor: period === p.v ? '#00E5FF' : '#2A2F3E', background: period === p.v ? 'rgba(0,229,255,0.1)' : '#161B22', color: period === p.v ? '#00E5FF' : '#8F94A3' }}>{p.l}</button>
          ))}
          {loading && <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#555C70' }}><div style={{ width: 12, height: 12, border: '2px solid #2A2F3E', borderTopColor: '#00E5FF', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Chargement...</div>}
        </div>
      )}

      {/* Heatmap Tab */}
      {tab === 'heatmap' && (
        <div style={{ display: 'grid', gridTemplateColumns: aiResult ? '1fr 360px' : '1fr', gap: 16 }}>
          <div>
            <div style={{ background: '#0D0818', border: '1px solid rgba(128,0,200,0.3)', borderRadius: 12, padding: 14, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14 }}>🔥</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'white' }}>Liquidation Heatmap</span>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{symbol}</span>
                </div>
                <button onClick={handleAI} disabled={aiLoading || !candles.length} style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid rgba(0,229,255,0.3)', background: 'rgba(0,229,255,0.1)', color: '#00E5FF', fontSize: 11, fontWeight: 600, cursor: aiLoading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                  {aiLoading ? <><div style={{ width: 10, height: 10, border: '1.5px solid #00E5FF30', borderTopColor: '#00E5FF', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Analyse IA...</> : '✨ Analyser avec IA'}
                </button>
              </div>
              {candles.length > 0 ? <HeatmapCanvas candles={candles} currentPrice={currentPrice} /> : <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555C70', fontSize: 13 }}>Sélectionne un actif</div>}
            </div>

            {/* Legend */}
            <div style={{ display: 'flex', gap: 16, fontSize: 10, color: '#555C70', padding: '0 4px', flexWrap: 'wrap' }}>
              <span>🟢 Liquidations Long (stop loss shorts)</span>
              <span>🟣 Liquidations Short (stop loss longs)</span>
              <span style={{ color: '#00E5FF' }}>─── Prix actuel</span>
            </div>
          </div>

          {aiResult && (
            <div style={{ background: '#161B22', border: '1px solid #2A2F3E', borderRadius: 12, padding: 16, maxHeight: 420, overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#F0F3FF' }}>✨ Analyse IA</div>
                <button onClick={() => setAiResult(null)} style={{ background: 'none', border: 'none', color: '#555C70', cursor: 'pointer', fontSize: 14 }}>✕</button>
              </div>
              <div style={{ fontSize: 12, color: '#C5C8D6', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{aiResult}</div>
            </div>
          )}
        </div>
      )}

      {/* CVD Tab */}
      {tab === 'cvd' && (
        <div>
          {/* CVD segments selector */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {CVD_SEGS.map(s => (
              <button key={s.v} onClick={() => setActiveSeg(s.v)} style={{ padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: 500, cursor: 'pointer', border: '1px solid', borderColor: activeSeg === s.v ? s.color : '#2A2F3E', background: activeSeg === s.v ? `${s.color}20` : '#161B22', color: activeSeg === s.v ? s.color : '#8F94A3', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
                {s.l}
                <span style={{ fontSize: 9, color: activeSeg === s.v ? s.color : '#555C70' }}>{s.range}</span>
              </button>
            ))}
          </div>

          {/* CVD Chart */}
          <div style={{ background: '#161B22', border: '1px solid #2A2F3E', borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#F0F3FF' }}>
                CVD — {CVD_SEGS.find(s => s.v === activeSeg)?.l}
                <span style={{ fontSize: 10, color: '#555C70', marginLeft: 8 }}>{CVD_SEGS.find(s => s.v === activeSeg)?.range}</span>
              </div>
              {lastCVD && (
                <div style={{ fontSize: 12, fontFamily: 'monospace', color: lastCVD[activeSeg] >= 0 ? '#22C759' : '#FF3B30', fontWeight: 600 }}>
                  {lastCVD[activeSeg] >= 0 ? '+' : ''}{fmt(lastCVD[activeSeg])}
                </div>
              )}
            </div>
            {cvd.length > 0 ? <CVDChart points={cvd} activeSeg={activeSeg} /> : <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555C70', fontSize: 13 }}>Chargement...</div>}
          </div>

          {/* All segments summary */}
          {lastCVD && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
              {CVD_SEGS.filter(s => s.v !== 'all').map(s => {
                const v = lastCVD[s.v]
                return (
                  <div key={s.v} onClick={() => setActiveSeg(s.v)} style={{ background: '#161B22', border: `1px solid ${activeSeg === s.v ? s.color : '#2A2F3E'}`, borderRadius: 9, padding: '10px 12px', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
                      <span style={{ fontSize: 10, color: '#8F94A3', fontWeight: 500 }}>{s.l}</span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace', color: v >= 0 ? '#22C759' : '#FF3B30' }}>
                      {v >= 0 ? '+' : ''}{fmt(v)}
                    </div>
                    <div style={{ fontSize: 9, color: '#555C70' }}>{s.range}</div>
                  </div>
                )
              })}
            </div>
          )}

          {/* AI Button */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button onClick={handleAI} disabled={aiLoading || !candles.length} style={{ flex: 1, padding: '10px 0', borderRadius: 9, border: '1px solid rgba(0,229,255,0.3)', background: 'rgba(0,229,255,0.08)', color: '#00E5FF', fontSize: 13, fontWeight: 600, cursor: aiLoading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
              {aiLoading ? <><div style={{ width: 13, height: 13, border: '2px solid #00E5FF30', borderTopColor: '#00E5FF', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Analyse IA en cours...</> : '✨ Analyser CVD avec IA'}
            </button>
          </div>

          {aiResult && (
            <div style={{ marginTop: 14, background: '#161B22', border: '1px solid rgba(0,229,255,0.2)', borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#00E5FF' }}>✨ Analyse IA — {symbol}</div>
                <button onClick={() => setAiResult(null)} style={{ background: 'none', border: 'none', color: '#555C70', cursor: 'pointer' }}>✕</button>
              </div>
              <div style={{ fontSize: 13, color: '#C5C8D6', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{aiResult}</div>
            </div>
          )}
        </div>
      )}

      {/* Photo Analysis Tab */}
      {tab === 'photo' && (
        <div style={{ display: 'grid', gridTemplateColumns: photoResult ? '1fr 1fr' : '600px', gap: 20 }}>
          <div style={{ background: '#161B22', border: '1px solid #2A2F3E', borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#F0F3FF', marginBottom: 12 }}>📸 Analyse de graphiques</div>
            <PhotoUpload onAnalysis={r => setPhotoResult(r)} />
          </div>
          {photoResult && (
            <div style={{ background: '#161B22', border: '1px solid #2A2F3E', borderRadius: 12, padding: 16, overflowY: 'auto', maxHeight: '80vh' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#F0F3FF' }}>Résultat</div>
                <button onClick={() => setPhotoResult(null)} style={{ background: 'none', border: 'none', color: '#555C70', cursor: 'pointer' }}>✕</button>
              </div>
              <PhotoResult text={photoResult} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
