// src/pages/systemes/SystemesPage.tsx — Connecté à Firestore users/{uid}/systems

import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { subscribeSystems, subscribeTrades, createSystem, updateSystem, deleteSystem, tradePnL, type TradingSystem, type Trade } from '@/services/firestore'

function fmtPnL(n: number) { return `${n>=0?'+':''}$${Math.abs(n).toFixed(2)}` }

// ── Mini courbe P&L canvas par système ────────────────────────────────────────
function SystemPnLChart({ trades, color, systemId }: { trades: Trade[]; color: string; systemId: string }) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hovered, setHovered] = useState<{x:number;y:number;val:number;date:string}|null>(null)

  const draw = useCallback((tipIdx: number | null) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const W = canvas.offsetWidth
    const H = canvas.offsetHeight
    canvas.width  = W * dpr
    canvas.height = H * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, W, H)

    const closed = trades
      .filter(t => t.systemId === systemId && t.status === 'closed')
      .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0))

    if (closed.length === 0) {
      ctx.fillStyle = resolveCSSColor('--tm-text-muted','#555C70')
      ctx.font = '10px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(t('dashboard.noTrades'), W / 2, H / 2)
      return
    }

    // Cumulative PnL points
    let cum = 0
    const pts = closed.map(t => { cum += tradePnL(t); return cum })
    const dates = closed.map(t => t.date ? t.date.toLocaleDateString('fr-FR', {day:'2-digit',month:'2-digit'}) : '')

    const pad = { t: 8, b: 20, l: 8, r: 8 }
    const cW = W - pad.l - pad.r
    const cH = H - pad.t - pad.b

    const minV = Math.min(0, ...pts)
    const maxV = Math.max(0, ...pts)
    const range = maxV - minV || 1

    const toX = (i: number) => pad.l + (i / (pts.length - 1 || 1)) * cW
    const toY = (v: number) => pad.t + (1 - (v - minV) / range) * cH

    // Zero line
    const zeroY = toY(0)
    ctx.strokeStyle = resolveCSSColor('--tm-border','#2A2F3E')
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(pad.l, zeroY)
    ctx.lineTo(pad.l + cW, zeroY)
    ctx.stroke()
    ctx.setLineDash([])

    // Fill gradient
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + cH)
    const finalPnL = pts[pts.length - 1]
    // Resolve CSS variable strings (e.g. 'var(--tm-profit)') to actual hex colors before using in Canvas
    const resolvedColor = color.startsWith('var(') || color.startsWith('--')
      ? resolveCSSColor(color, '#0A85FF')
      : color
    const fillColor = finalPnL >= 0 ? resolvedColor : resolveCSSColor('--tm-loss','#FF3B30')
    grad.addColorStop(0, fillColor + '40')
    grad.addColorStop(1, fillColor + '05')

    ctx.beginPath()
    ctx.moveTo(toX(0), toY(pts[0]))
    for (let i = 1; i < pts.length; i++) {
      const x0 = toX(i-1), y0 = toY(pts[i-1])
      const x1 = toX(i),   y1 = toY(pts[i])
      const cx = (x0 + x1) / 2
      ctx.bezierCurveTo(cx, y0, cx, y1, x1, y1)
    }
    ctx.lineTo(toX(pts.length - 1), pad.t + cH)
    ctx.lineTo(toX(0), pad.t + cH)
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()

    // Line
    ctx.beginPath()
    ctx.strokeStyle = fillColor
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.moveTo(toX(0), toY(pts[0]))
    for (let i = 1; i < pts.length; i++) {
      const x0 = toX(i-1), y0 = toY(pts[i-1])
      const x1 = toX(i),   y1 = toY(pts[i])
      const cx = (x0 + x1) / 2
      ctx.bezierCurveTo(cx, y0, cx, y1, x1, y1)
    }
    ctx.stroke()

    // Dots on hover
    if (tipIdx !== null && tipIdx >= 0 && tipIdx < pts.length) {
      const x = toX(tipIdx), y = toY(pts[tipIdx])
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fillStyle = fillColor
      ctx.fill()
      ctx.strokeStyle = resolveCSSColor('--tm-bg','#0D1117')
      ctx.lineWidth = 2
      ctx.stroke()
    }

    // X-axis labels (first + last)
    ctx.fillStyle = resolveCSSColor('--tm-text-muted','#555C70')
    ctx.font = '9px JetBrains Mono, monospace'
    ctx.textAlign = 'left'
    ctx.fillText(dates[0] ?? '', pad.l, H - 4)
    ctx.textAlign = 'right'
    ctx.fillText(dates[dates.length - 1] ?? '', pad.l + cW, H - 4)
  }, [trades, color, systemId])

  useEffect(() => { draw(null) }, [draw])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left

    const closed = trades
      .filter(t => t.systemId === systemId && t.status === 'closed')
      .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0))
    if (closed.length < 2) return

    const pad = { l: 8, r: 8 }
    const cW = canvas.offsetWidth - pad.l - pad.r
    const idx = Math.round(((mx - pad.l) / cW) * (closed.length - 1))
    const clampedIdx = Math.max(0, Math.min(closed.length - 1, idx))

    let cum = 0
    const pts = closed.map(t => { cum += tradePnL(t); return cum })
    const date = closed[clampedIdx]?.date?.toLocaleDateString('fr-FR', {day:'2-digit',month:'2-digit',year:'2-digit'}) ?? ''

    draw(clampedIdx)
    setHovered({ x: mx, y: 0, val: pts[clampedIdx], date })
  }, [trades, systemId, draw])

  const handleMouseLeave = useCallback(() => {
    draw(null)
    setHovered(null)
  }, [draw])

  return (
    <div style={{ position: 'relative' }}>
      {hovered && (
        <div style={{
          position: 'absolute', top: 4,
          left: Math.min(hovered.x, 200),
          background: 'var(--tm-bg-tertiary)', border: '1px solid #2A2F3E',
          borderRadius: 6, padding: '3px 8px', pointerEvents: 'none',
          fontSize: 11, color: hovered.val >= 0 ? 'var(--tm-profit)' : 'var(--tm-loss)',
          fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap', zIndex: 10
        }}>
          {fmtPnL(hovered.val)} · {hovered.date}
        </div>
      )}
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ width: '100%', height: 80, display: 'block', cursor: 'crosshair' }}
      />
    </div>
  )
}

// ── Graphique comparatif toutes systèmes ──────────────────────────────────────
function SystemsComparisonChart({ systemStats, trades }: {
  systemStats: (TradingSystem & { totalTrades: number; totalPnL: number; winRate: string })[]
  trades: Trade[]
}) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hovered, setHovered] = useState<{sysName:string;pnl:number;x:number}|null>(null)

  const buildCurves = useCallback(() => {
    return systemStats.map(s => {
      const closed = trades
        .filter(t => t.systemId === s.id && t.status === 'closed')
        .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0))
      let cum = 0
      return {
        id: s.id, name: s.name, color: s.color,
        pts: closed.map(t => { cum += tradePnL(t); return cum })
      }
    }).filter(c => c.pts.length > 0)
  }, [systemStats, trades])

  const draw = useCallback((hoveredId: string | null) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const W = canvas.offsetWidth
    const H = canvas.offsetHeight
    canvas.width  = W * dpr
    canvas.height = H * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, W, H)

    const curves = buildCurves()
    if (curves.length === 0) return

    const allPts = curves.flatMap(c => c.pts)
    const minV = Math.min(0, ...allPts)
    const maxV = Math.max(0, ...allPts)
    const range = maxV - minV || 1
    const maxLen = Math.max(...curves.map(c => c.pts.length))

    const pad = { t: 12, b: 8, l: 8, r: 8 }
    const cW = W - pad.l - pad.r
    const cH = H - pad.t - pad.b

    const toX = (i: number, len: number) => pad.l + (i / (len - 1 || 1)) * cW
    const toY = (v: number) => pad.t + (1 - (v - minV) / range) * cH

    // Zero line
    ctx.strokeStyle = resolveCSSColor('--tm-border','#2A2F3E')
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(pad.l, toY(0))
    ctx.lineTo(pad.l + cW, toY(0))
    ctx.stroke()
    ctx.setLineDash([])

    // Draw curves
    curves.forEach(c => {
      if (c.pts.length < 2) return
      const isHov = hoveredId === c.id
      // Resolve CSS variable strings to actual hex colors for canvas
      const paintColor = (c.color.startsWith('var(') || c.color.startsWith('--'))
        ? resolveCSSColor(c.color, '#0A85FF')
        : c.color
      ctx.globalAlpha = hoveredId && !isHov ? 0.25 : 1
      ctx.beginPath()
      ctx.strokeStyle = paintColor
      ctx.lineWidth = isHov ? 2.5 : 1.5
      ctx.lineJoin = 'round'
      ctx.moveTo(toX(0, c.pts.length), toY(c.pts[0]))
      for (let i = 1; i < c.pts.length; i++) {
        const x0 = toX(i-1, c.pts.length), y0 = toY(c.pts[i-1])
        const x1 = toX(i, c.pts.length),   y1 = toY(c.pts[i])
        const cx = (x0 + x1) / 2
        ctx.bezierCurveTo(cx, y0, cx, y1, x1, y1)
      }
      ctx.stroke()

      // End dot
      const lastX = toX(c.pts.length - 1, c.pts.length)
      const lastY = toY(c.pts[c.pts.length - 1])
      ctx.beginPath()
      ctx.arc(lastX, lastY, isHov ? 5 : 3, 0, Math.PI * 2)
      ctx.fillStyle = paintColor
      ctx.fill()
      ctx.globalAlpha = 1
    })
  }, [buildCurves])

  useEffect(() => { draw(null) }, [draw])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    const curves = buildCurves()
    if (curves.length === 0) return

    const allPts = curves.flatMap(c => c.pts)
    const minV = Math.min(0, ...allPts)
    const maxV = Math.max(0, ...allPts)
    const range = maxV - minV || 1
    const pad = { t: 12, b: 8, l: 8, r: 8 }
    const cW = canvas.offsetWidth - pad.l - pad.r
    const cH = canvas.offsetHeight - pad.t - pad.b
    const toX = (i: number, len: number) => pad.l + (i / (len - 1 || 1)) * cW
    const toY = (v: number) => pad.t + (1 - (v - minV) / range) * cH

    let closest: {sysName:string;pnl:number;x:number;dist:number} | null = null
    curves.forEach(c => {
      const idx = Math.round(((mx - pad.l) / cW) * (c.pts.length - 1))
      const clampedIdx = Math.max(0, Math.min(c.pts.length - 1, idx))
      const cx = toX(clampedIdx, c.pts.length)
      const cy = toY(c.pts[clampedIdx])
      const dist = Math.sqrt((cx - mx) ** 2 + (cy - my) ** 2)
      if (!closest || dist < closest.dist) {
        closest = { sysName: c.name, pnl: c.pts[clampedIdx], x: cx, dist }
      }
    })

    if (closest && (closest as any).dist < 30) {
      draw((closest as any).sysName ? curves.find(c => c.name === (closest as any).sysName)?.id ?? null : null)
      setHovered({ sysName: (closest as any).sysName, pnl: (closest as any).pnl, x: mx })
    } else {
      draw(null)
      setHovered(null)
    }
  }, [buildCurves, draw])

  const handleMouseLeave = useCallback(() => { draw(null); setHovered(null) }, [draw])

  const curves = buildCurves()
  if (curves.length === 0) return null

  return (
    <div style={{ background:'var(--tm-bg-secondary)', border:'1px solid #1E2330', borderRadius:14, padding:'16px', marginTop:20 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:'var(--tm-text-primary)', fontFamily:'Syne,sans-serif' }}>{t('systemes.comparison')}</div>
          <div style={{ fontSize:11, color:'var(--tm-text-muted)' }}>{t('systemes.comparisonSubtitle')}</div>
        </div>
        {/* Légende */}
        <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
          {curves.map(c => (
            <div key={c.id} style={{ display:'flex', alignItems:'center', gap:5 }}>
              <div style={{ width:20, height:2, background:c.color, borderRadius:1 }} />
              <span style={{ fontSize:10, color:'var(--tm-text-secondary)', fontFamily:'JetBrains Mono,monospace' }}>{c.name}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ position:'relative' }}>
        {hovered && (
          <div style={{
            position:'absolute', top:4,
            left: Math.min(hovered.x, 240),
            background:'var(--tm-bg-tertiary)', border:'1px solid #2A2F3E',
            borderRadius:6, padding:'4px 10px', pointerEvents:'none',
            fontSize:11, zIndex:10, whiteSpace:'nowrap'
          }}>
            <span style={{ color:'var(--tm-text-secondary)' }}>{hovered.sysName} · </span>
            <span style={{ color: hovered.pnl >= 0 ? 'var(--tm-profit)' : 'var(--tm-loss)', fontFamily:'JetBrains Mono,monospace' }}>
              {fmtPnL(hovered.pnl)}
            </span>
          </div>
        )}
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ width:'100%', height:160, display:'block', cursor:'crosshair' }}
        />
      </div>

      {/* Classement final */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:8, marginTop:12, paddingTop:12, borderTop:'1px solid #1E2330' }}>
        {[...curves].sort((a,b) => (b.pts[b.pts.length-1]??0) - (a.pts[a.pts.length-1]??0)).map((c, i) => (
          <div key={c.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', background:'var(--tm-bg-tertiary)', borderRadius:8, border:`1px solid ${c.color}25` }}>
            <span style={{ fontSize:10, color:'var(--tm-text-muted)', fontWeight:700, minWidth:14 }}>#{i+1}</span>
            <div style={{ width:8, height:8, borderRadius:'50%', background:c.color, flexShrink:0 }} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:11, color:'var(--tm-text-primary)', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.name}</div>
              <div style={{ fontSize:10, color: (c.pts[c.pts.length-1]??0) >= 0 ? 'var(--tm-profit)' : 'var(--tm-loss)', fontFamily:'JetBrains Mono,monospace' }}>
                {fmtPnL(c.pts[c.pts.length-1] ?? 0)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Page principale ────────────────────────────────────────────────────────────

// Known CSS-variable → absolute color fallbacks (used when var() can't be resolved by Canvas)
const VAR_FALLBACKS: Record<string, string> = {
  '--tm-accent':  '#0A85FF',
  '--tm-profit':  '#22C759',
  '--tm-warning': '#FF9500',
  '--tm-loss':    '#FF3B30',
  '--tm-text-muted':    '#555C70',
  '--tm-border':        '#2A2F3E',
  '--tm-bg':            '#0D1117',
}

/**
 * Resolves a CSS variable name (--tm-xxx) or var(--tm-xxx) string
 * to an absolute color that Canvas can parse.
 */
function resolveCSSColor(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  // Strip var() wrapper if present
  const name = varName.startsWith('var(') ? varName.slice(4, -1).trim() : varName
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  // If getPropertyValue returned another var() reference or empty string, use known fallback or provided fallback
  if (!resolved || resolved.startsWith('var(')) return VAR_FALLBACKS[name] ?? fallback
  return resolved
}

export default function SystemesPage() {
  const { t } = useTranslation()
  const [systems, setSystems] = useState<TradingSystem[]>([])
  const [trades,  setTrades]  = useState<Trade[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<TradingSystem | null>(null)

  useEffect(() => {
    const unsubS = subscribeSystems(s => { setSystems(s); setLoading(false) })
    const unsubT = subscribeTrades(setTrades)
    return () => { unsubS(); unsubT() }
  }, [])

  const systemStats = systems.map(s => {
    const st = trades.filter(t => t.systemId === s.id && t.status === 'closed')
    const pnls = st.map(tradePnL)
    const total = pnls.reduce((a, b) => a + b, 0)
    const wins = pnls.filter(p => p > 0).length
    const wr = st.length > 0 ? (wins / st.length * 100).toFixed(0) : '—'
    const avgGain = wins > 0 ? pnls.filter(p=>p>0).reduce((a,b)=>a+b,0)/wins : 0
    const losses = pnls.filter(p => p < 0)
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a,b)=>a+b,0)/losses.length) : 0
    const payoff = avgLoss > 0 ? (avgGain / avgLoss).toFixed(2) : '—'
    return { ...s, totalTrades: st.length, totalPnL: total, winRate: wr, payoff }
  })

  return (
    <div style={{ padding:24, maxWidth:900, margin:'0 auto' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:'var(--tm-text-primary)', margin:0, fontFamily:'Syne,sans-serif' }}>{t('systemes.title')}</h1>
          <p style={{ fontSize:13, color:'var(--tm-text-secondary)', margin:'3px 0 0' }}>{t('systemes.subtitle', { count: systems.length })}</p>
        </div>
        <button onClick={() => setShowAdd(true)} style={{ padding:'8px 16px', borderRadius:10, border:'none', background:'var(--tm-accent)', color:'var(--tm-bg)', fontSize:13, fontWeight:600, cursor:'pointer' }}>
          {t('systemes.newSystem')}
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:48, color:'var(--tm-text-muted)' }}>
          <div style={{ width:24, height:24, border:'2px solid #2A2F3E', borderTopColor:'var(--tm-accent)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto 12px' }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          {t('common.loading')}
        </div>
      ) : systems.length === 0 ? (
        <div style={{ textAlign:'center', padding:48, color:'var(--tm-text-muted)', fontSize:14 }}>
          {t('systemes.empty')}
        </div>
      ) : (
        <>
          {/* Cards systèmes */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))', gap:12 }}>
            {systemStats.map(s => (
              <div key={s.id} style={{ background:'var(--tm-bg-secondary)', border:`1px solid ${s.color}40`, borderRadius:14, padding:'16px', position:'relative', overflow:'hidden' }}>
                <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:s.color, borderRadius:'14px 14px 0 0' }} />
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <div style={{ width:36, height:36, borderRadius:10, background:`${s.color}20`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16 }}>📊</div>
                    <div>
                      <div style={{ fontSize:15, fontWeight:700, color:'var(--tm-text-primary)' }}>{s.name}</div>
                      <div style={{ fontSize:10, color:'var(--tm-text-muted)' }}>{s.totalTrades} trade{s.totalTrades > 1 ? 's' : ''}</div>
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:6 }}>
                    <button onClick={() => setEditing(s)} style={{ background:'none', border:'1px solid #2A2F3E', borderRadius:6, padding:'3px 8px', color:'var(--tm-text-secondary)', cursor:'pointer', fontSize:11 }}>✏️</button>
                    <button onClick={() => { if(confirm(`${t('common.delete')} "${s.name}" ?`)) deleteSystem(s.id) }} style={{ background:'none', border:'1px solid #2A2F3E', borderRadius:6, padding:'3px 8px', color:'var(--tm-text-muted)', cursor:'pointer', fontSize:11 }}>✕</button>
                  </div>
                </div>

                {/* KPIs */}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6, marginBottom:10 }}>
                  {[
                    { l:'P&L', v:fmtPnL(s.totalPnL), c: s.totalPnL>=0?'var(--tm-profit)':'var(--tm-loss)' },
                    { l:'Win Rate', v:`${s.winRate}%`, c:'var(--tm-text-primary)' },
                    { l:'Payoff', v:s.payoff, c:'var(--tm-accent)' },
                    { l:'Trades', v:s.totalTrades, c:'var(--tm-text-secondary)' },
                  ].map(({ l, v, c }) => (
                    <div key={l} style={{ background:'var(--tm-bg-tertiary)', borderRadius:8, padding:'6px 4px', textAlign:'center' }}>
                      <div style={{ fontSize:8, color:'var(--tm-text-muted)', marginBottom:2 }}>{l}</div>
                      <div style={{ fontSize:12, fontWeight:700, color:c, fontFamily:'monospace' }}>{v}</div>
                    </div>
                  ))}
                </div>

                {/* Mini courbe P&L */}
                {s.totalTrades > 0 && (
                  <SystemPnLChart trades={trades} color={s.color} systemId={s.id} />
                )}
              </div>
            ))}
          </div>

          {/* Graphique comparatif multi-systèmes */}
          {systemStats.filter(s => s.totalTrades > 0).length > 1 && (
            <SystemsComparisonChart systemStats={systemStats} trades={trades} />
          )}
        </>
      )}

      {(showAdd || editing) && (
        <SystemModal
          system={editing}
          onSave={async (name, color) => {
            if (editing) { await updateSystem({ ...editing, name, color }); setEditing(null) }
            else { await createSystem({ id: crypto.randomUUID(), name, color }); setShowAdd(false) }
          }}
          onClose={() => { setShowAdd(false); setEditing(null) }}
        />
      )}
    </div>
  )
}

function SystemModal({ system, onSave, onClose }: { system: TradingSystem | null; onSave: (n: string, c: string) => Promise<void>; onClose: () => void }) {
  const { t } = useTranslation()
  const [name, setName]   = useState(system?.name ?? '')
  const [color, setColor] = useState(system?.color ?? 'var(--tm-accent)')
  const [saving, setSaving] = useState(false)
  const COLORS = ['var(--tm-accent)','var(--tm-profit)','var(--tm-warning)','var(--tm-loss)','#9B59B6','#E91E63','#4CAF50','#2196F3','#FF6B35','#FFD700']

  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    try { await onSave(name.trim(), color) } catch(e) { alert((e as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
      <div style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:16, padding:24, width:380, maxWidth:'95vw' }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:18 }}>
          <span style={{ fontSize:16, fontWeight:700, color:'var(--tm-text-primary)' }}>{system ? t('common.edit') : t('systemes.new')} système</span>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--tm-text-muted)', cursor:'pointer', fontSize:18 }}>✕</button>
        </div>
        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:6 }}>{t('systemes.nameLabel')}</div>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Breakout BTC" autoFocus
            style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:'1px solid #2A2F3E', background:'var(--tm-bg-tertiary)', color:'var(--tm-text-primary)', fontSize:14, outline:'none', boxSizing:'border-box' }} />
        </div>
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:8 }}>{t('systemes.colorLabel')}</div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)} style={{ width:30, height:30, borderRadius:8, background:c, border: color===c?`3px solid white`:'3px solid transparent', cursor:'pointer' }} />
            ))}
          </div>
        </div>
        <button onClick={save} disabled={!name.trim() || saving}
          style={{ width:'100%', padding:10, borderRadius:10, border:'none', background: name.trim()?color:'var(--tm-bg-tertiary)', color: name.trim()?'var(--tm-bg)':'var(--tm-text-muted)', fontSize:14, fontWeight:600, cursor: name.trim()?'pointer':'not-allowed' }}>
          {saving ? t('common.saving') : system ? t('systemes.update') : t('systemes.create')}
        </button>
      </div>
    </div>
  )
}
