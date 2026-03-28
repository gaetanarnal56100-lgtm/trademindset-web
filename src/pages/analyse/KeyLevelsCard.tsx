// KeyLevelsCard.tsx — Niveaux clés automatiques
// Calcul local depuis les bougies OHLC : pivots, order blocks, plus haut/bas récents
// Pas d'API externe — utilise fetchYahooCandles pour non-crypto, Binance pour crypto

import { useState, useEffect } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'

const fbFn = getFunctions(app, 'europe-west1')

// ── Types ──────────────────────────────────────────────────────────────────

interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

interface KeyLevel {
  price: number
  type: 'resistance' | 'support' | 'pivot' | 'orderblock_bull' | 'orderblock_bear' | 'high' | 'low'
  label: string
  strength: 'strong' | 'medium' | 'weak'
  touches?: number
}

interface Props {
  symbol: string
  currentPrice?: number
}

// ── Candle Fetcher ────────────────────────────────────────────────────────

async function fetchCandles(symbol: string): Promise<Candle[]> {
  const s = symbol.toUpperCase()
  const isCrypto = /USDT$|BUSD$|BTC$|ETH$|BNB$/i.test(s)

  if (isCrypto) {
    try {
      const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${s}&interval=4h&limit=200`)
      if (!r.ok) throw new Error()
      const d = await r.json()
      return d.map((k: number[]) => ({
        t: Math.floor(k[0] / 1000), o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5]
      }))
    } catch { return [] }
  } else {
    try {
      const fn = httpsCallable<Record<string, unknown>, { s: string; candles: Candle[] }>(fbFn, 'fetchYahooCandles')
      const res = await fn({ symbol: s, interval: '1d', range: '6mo' })
      if (res.data.s === 'ok') return res.data.candles
    } catch {}
    return []
  }
}

// ── Key Levels Calculator ─────────────────────────────────────────────────

function calcKeyLevels(candles: Candle[], currentPrice: number): KeyLevel[] {
  if (candles.length < 20) return []
  const levels: KeyLevel[] = []
  const n = candles.length

  // 1. Pivot Points (dernières 3 bougies confirmées)
  const pivotCandle = candles[n - 2]
  const pp = (pivotCandle.h + pivotCandle.l + pivotCandle.c) / 3
  const r1 = 2 * pp - pivotCandle.l
  const r2 = pp + (pivotCandle.h - pivotCandle.l)
  const s1 = 2 * pp - pivotCandle.h
  const s2 = pp - (pivotCandle.h - pivotCandle.l)

  levels.push({ price: pp, type: 'pivot', label: 'Pivot', strength: 'medium' })
  levels.push({ price: r1, type: 'resistance', label: 'R1', strength: 'strong' })
  levels.push({ price: r2, type: 'resistance', label: 'R2', strength: 'medium' })
  levels.push({ price: s1, type: 'support', label: 'S1', strength: 'strong' })
  levels.push({ price: s2, type: 'support', label: 'S2', strength: 'medium' })

  // 2. Plus haut / Plus bas sur 20 et 50 bougies
  const last20 = candles.slice(-20)
  const last50 = candles.slice(-50)
  const high20 = Math.max(...last20.map(c => c.h))
  const low20  = Math.min(...last20.map(c => c.l))
  const high50 = Math.max(...last50.map(c => c.h))
  const low50  = Math.min(...last50.map(c => c.l))

  levels.push({ price: high20, type: 'high', label: 'High 20', strength: 'strong' })
  levels.push({ price: low20,  type: 'low',  label: 'Low 20',  strength: 'strong' })
  if (Math.abs(high50 - high20) / high20 > 0.005)
    levels.push({ price: high50, type: 'high', label: 'High 50', strength: 'medium' })
  if (Math.abs(low50 - low20) / low20 > 0.005)
    levels.push({ price: low50, type: 'low', label: 'Low 50', strength: 'medium' })

  // 3. Order Blocks — recherche de bougies fortes avant un mouvement impulsif
  for (let i = n - 30; i < n - 3; i++) {
    const c = candles[i]
    const bodySize = Math.abs(c.c - c.o)
    const totalRange = c.h - c.l
    if (totalRange === 0) continue
    const bodyRatio = bodySize / totalRange

    // Bougie bearish forte suivie d'une continuation bullish = order block bull
    if (c.c < c.o && bodyRatio > 0.6) {
      const nextThree = candles.slice(i + 1, i + 4)
      const avgNextClose = nextThree.reduce((a, b) => a + b.c, 0) / nextThree.length
      if (avgNextClose > c.h) {
        levels.push({
          price: (c.o + c.c) / 2,
          type: 'orderblock_bull',
          label: `OB Bull`,
          strength: bodyRatio > 0.75 ? 'strong' : 'medium'
        })
      }
    }

    // Bougie bullish forte suivie d'une continuation bearish = order block bear
    if (c.c > c.o && bodyRatio > 0.6) {
      const nextThree = candles.slice(i + 1, i + 4)
      const avgNextClose = nextThree.reduce((a, b) => a + b.c, 0) / nextThree.length
      if (avgNextClose < c.l) {
        levels.push({
          price: (c.o + c.c) / 2,
          type: 'orderblock_bear',
          label: `OB Bear`,
          strength: bodyRatio > 0.75 ? 'strong' : 'medium'
        })
      }
    }
  }

  // 4. Zones de confluences — nombre de touches
  const tolerance = currentPrice * 0.003 // 0.3% de tolérance
  levels.forEach(level => {
    level.touches = candles.filter(c =>
      Math.abs(c.h - level.price) < tolerance ||
      Math.abs(c.l - level.price) < tolerance ||
      Math.abs(c.c - level.price) < tolerance
    ).length
    if ((level.touches ?? 0) >= 3) level.strength = 'strong'
  })

  // 5. Dédupliquer les niveaux proches (moins de 0.5% d'écart)
  const deduped: KeyLevel[] = []
  const sorted = [...levels].sort((a, b) => a.price - b.price)
  for (const lvl of sorted) {
    const existing = deduped.find(d => Math.abs(d.price - lvl.price) / lvl.price < 0.005)
    if (!existing) deduped.push(lvl)
    else if (lvl.strength === 'strong') existing.strength = 'strong'
  }

  // 6. Trier par proximité au prix courant et limiter à 12
  return deduped
    .sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice))
    .slice(0, 12)
}

// ── Formatters ────────────────────────────────────────────────────────────

function fmtP(p: number): string {
  return p >= 10000 ? p.toFixed(0) : p >= 100 ? p.toFixed(2) : p >= 1 ? p.toFixed(4) : p.toFixed(6)
}

function pctFromPrice(price: number, current: number): string {
  const pct = ((price - current) / current) * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
}

// ── Level Row Component ────────────────────────────────────────────────────

function LevelRow({ level, currentPrice }: { level: KeyLevel; currentPrice: number }) {
  const isAbove = level.price > currentPrice
  const typeConfig: Record<KeyLevel['type'], { color: string; bg: string; icon: string }> = {
    resistance:     { color: '#FF3B30', bg: 'rgba(255,59,48,0.08)',   icon: '⟰' },
    support:        { color: '#22C759', bg: 'rgba(34,199,89,0.08)',   icon: '⟱' },
    pivot:          { color: '#FF9500', bg: 'rgba(255,149,0,0.08)',   icon: '◈' },
    orderblock_bull:{ color: '#22C759', bg: 'rgba(34,199,89,0.06)',   icon: '▣' },
    orderblock_bear:{ color: '#FF3B30', bg: 'rgba(255,59,48,0.06)',   icon: '▣' },
    high:           { color: '#0A85FF', bg: 'rgba(10,133,255,0.06)',  icon: '▲' },
    low:            { color: '#BF5AF2', bg: 'rgba(191,90,242,0.06)',  icon: '▼' },
  }
  const cfg = typeConfig[level.type]
  const strengthDots = level.strength === 'strong' ? '●●●' : level.strength === 'medium' ? '●●○' : '●○○'
  const pct = pctFromPrice(level.price, currentPrice)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '7px 12px', background: cfg.bg,
      borderRadius: 8, border: `1px solid ${cfg.color}20`
    }}>
      <span style={{ fontSize: 14, color: cfg.color, width: 18, textAlign: 'center' }}>{cfg.icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#F0F3FF', fontFamily: 'monospace' }}>{fmtP(level.price)}</span>
          <span style={{ fontSize: 10, color: isAbove ? '#FF9500' : '#22C759', fontFamily: 'monospace' }}>{pct}</span>
        </div>
        <div style={{ fontSize: 10, color: '#555C70', marginTop: 1 }}>{level.label}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <span style={{ fontSize: 9, color: cfg.color, letterSpacing: 1 }}>{strengthDots}</span>
        {level.touches !== undefined && level.touches > 0 && (
          <span style={{ fontSize: 9, color: '#3D4254' }}>{level.touches}x</span>
        )}
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function KeyLevelsCard({ symbol, currentPrice: priceProp = 0 }: Props) {
  const [levels,       setLevels]       = useState<KeyLevel[]>([])
  const [currentPrice, setCurrentPrice] = useState(0)
  const [status,       setStatus]       = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [filter,       setFilter]       = useState<'all' | 'above' | 'below'>('all')
  const [expanded,     setExpanded]     = useState(true)
  const [showInfo,     setShowInfo]     = useState(false)

  useEffect(() => {
    if (priceProp > 0) setCurrentPrice(priceProp)
  }, [priceProp])

  useEffect(() => {
    const sym = symbol.toUpperCase()
    setStatus('loading')
    setLevels([])

    const run = async () => {
      // Fetch prix si pas fourni
      let price = priceProp
      if (price <= 0) {
        const isCrypto = /USDT$|BUSD$|BTC$|ETH$|BNB$/i.test(sym)
        if (isCrypto) {
          try {
            const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`)
            const d = await r.json()
            price = parseFloat(d.price) || 0
          } catch {}
        }
      }

      const candles = await fetchCandles(sym)
      if (candles.length < 20) { setStatus('error'); return }

      // Prix depuis la dernière bougie si toujours 0
      if (price <= 0) price = candles[candles.length - 1].c
      setCurrentPrice(price)

      const computed = calcKeyLevels(candles, price)
      setLevels(computed)
      setStatus('done')
    }

    run()
  }, [symbol])

  const filtered = levels.filter(l => {
    if (filter === 'above') return l.price > currentPrice
    if (filter === 'below') return l.price < currentPrice
    return true
  }).sort((a, b) => b.price - a.price)  // Plus hauts en premier

  const resistances = levels.filter(l => l.price > currentPrice).length
  const supports    = levels.filter(l => l.price < currentPrice).length

  return (
    <div style={{ background: '#161B22', border: '1px solid #1E2330', borderRadius: 16, overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
        onClick={() => setExpanded(x => !x)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: 'linear-gradient(135deg,#FF9500,#FF3B30)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🎯</div>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#F0F3FF' }}>Niveaux Clés</span>
              <div onClick={e => { e.stopPropagation(); setShowInfo(x => !x) }} style={{ width:16, height:16, borderRadius:'50%', background:'rgba(0,229,255,0.1)', border:'1px solid rgba(0,229,255,0.25)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', fontSize:9, color:'#00E5FF', fontWeight:700, lineHeight:1 }}>i</div>
            </div>
            <div style={{ fontSize: 10, color: '#555C70' }}>{symbol} · Pivots · OB · Swing</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {status === 'done' && (
            <>
              <span style={{ fontSize: 10, color: '#FF3B30', background: 'rgba(255,59,48,0.1)', padding: '2px 7px', borderRadius: 6 }}>↑ {resistances}</span>
              <span style={{ fontSize: 10, color: '#22C759', background: 'rgba(34,199,89,0.1)', padding: '2px 7px', borderRadius: 6 }}>↓ {supports}</span>
            </>
          )}
          {status === 'loading' && (
            <div style={{ width: 14, height: 14, border: '2px solid #2A2F3E', borderTopColor: '#FF9500', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          )}
          <span style={{ fontSize: 10, color: '#555C70' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {showInfo && (
        <div style={{ padding:'12px 16px', background:'rgba(0,229,255,0.04)', borderBottom:'1px solid rgba(0,229,255,0.15)' }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#00E5FF', marginBottom:6 }}>Comment sont déterminés les niveaux ?</div>
          <div style={{ fontSize:11, color:'#8F94A3', lineHeight:1.7 }}>
            <b style={{color:'#FF9500'}}>Pivots</b> — Calculés à partir du High, Low et Close de la dernière bougie confirmée (formule standard : PP, R1, R2, S1, S2).
            <br/><b style={{color:'#0A85FF'}}>Swing High/Low</b> — Plus hauts et plus bas sur les 20 et 50 dernières bougies (4H pour crypto, 1D pour actions).
            <br/><b style={{color:'#22C759'}}>Order Blocks</b> — Bougies à fort body ratio (&gt;60%) suivies d'un mouvement impulsif dans la direction opposée (3 bougies de confirmation).
            <br/><b style={{color:'#BF5AF2'}}>Force</b> — Nombre de touches du niveau (≥3 touches = fort). Les niveaux proches (&lt;0.5%) sont fusionnés.
          </div>
        </div>
      )}

      {expanded && (
        <div style={{ padding: '0 16px 16px' }}>
          {/* Prix courant */}
          {currentPrice > 0 && (
            <div style={{ margin: '0 0 12px', padding: '8px 12px', background: 'rgba(10,133,255,0.06)', border: '1px solid rgba(10,133,255,0.2)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: '#8F94A3' }}>Prix actuel</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#00E5FF', fontFamily: 'monospace' }}>{fmtP(currentPrice)}</span>
            </div>
          )}

          {/* Filtres */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {(['all', 'above', 'below'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 500, cursor: 'pointer',
                border: `1px solid ${filter === f ? '#FF9500' : '#2A2F3E'}`,
                background: filter === f ? 'rgba(255,149,0,0.15)' : 'transparent',
                color: filter === f ? '#FF9500' : '#555C70'
              }}>
                {{ all: 'Tous', above: '↑ Résistances', below: '↓ Supports' }[f]}
              </button>
            ))}
          </div>

          {/* Error */}
          {status === 'error' && (
            <div style={{ textAlign: 'center', padding: '20px', color: '#555C70', fontSize: 12 }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>📡</div>
              Données insuffisantes pour calculer les niveaux
            </div>
          )}

          {/* Loading */}
          {status === 'loading' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1, 2, 3, 4].map(i => (
                <div key={i} style={{ height: 44, borderRadius: 8, background: '#1C2130', animation: 'pulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
              ))}
            </div>
          )}

          {/* Levels */}
          {status === 'done' && (
            <>
              {/* Ligne prix courant */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filtered.map((level, i) => {
                  const prevLevel = filtered[i - 1]
                  const showPriceBar = prevLevel && prevLevel.price > currentPrice && level.price <= currentPrice
                  return (
                    <div key={`${level.label}-${level.price}`}>
                      {showPriceBar && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0' }}>
                          <div style={{ flex: 1, height: 1, background: 'rgba(0,229,255,0.3)', borderTop: '1px dashed rgba(0,229,255,0.5)' }} />
                          <span style={{ fontSize: 10, color: '#00E5FF', fontFamily: 'monospace', flexShrink: 0 }}>▶ {fmtP(currentPrice)}</span>
                          <div style={{ flex: 1, height: 1, background: 'rgba(0,229,255,0.3)', borderTop: '1px dashed rgba(0,229,255,0.5)' }} />
                        </div>
                      )}
                      <LevelRow level={level} currentPrice={currentPrice} />
                    </div>
                  )
                })}
              </div>

              {/* Légende */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid #1E2330' }}>
                {[
                  { icon: '⟰', color: '#FF3B30', label: 'Résistance' },
                  { icon: '⟱', color: '#22C759', label: 'Support' },
                  { icon: '◈', color: '#FF9500', label: 'Pivot' },
                  { icon: '▣', color: '#0A85FF', label: 'Order Block' },
                  { icon: '▲▼', color: '#BF5AF2', label: 'Swing H/L' },
                ].map(({ icon, color, label }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 10, color }}>{icon}</span>
                    <span style={{ fontSize: 10, color: '#3D4254' }}>{label}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
