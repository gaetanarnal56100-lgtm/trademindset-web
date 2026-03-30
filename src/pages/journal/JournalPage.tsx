// src/pages/journal/JournalPage.tsx — Connecté à Firestore users/{uid}/moods

import { useState, useEffect, useRef, useCallback } from 'react'
import { subscribeMoods, subscribeTrades, createMood, deleteMood, type MoodEntry, type Trade, type EmotionalState, type MoodContext } from '@/services/firestore'

const EMOTIONS: { v: EmotionalState; emoji: string; label: string; color: string }[] = [
  { v:'confident',  emoji:'😎', label:'Confiant',    color:'#4CAF50' },
  { v:'calm',       emoji:'😌', label:'Calme',       color:'#2196F3' },
  { v:'focused',    emoji:'🎯', label:'Concentré',   color:'#00BCD4' },
  { v:'excited',    emoji:'🤩', label:'Excité',      color:'#E91E63' },
  { v:'stressed',   emoji:'😰', label:'Stressé',     color:'#F44336' },
  { v:'impatient',  emoji:'😤', label:'Impatient',   color:'#FF9800' },
  { v:'fearful',    emoji:'😨', label:'Peur',        color:'#9C27B0' },
  { v:'greedy',     emoji:'💰', label:'Avarice',     color:'#FFC107' },
  { v:'frustrated', emoji:'😡', label:'Frustré',     color:'#795548' },
  { v:'distracted', emoji:'🤔', label:'Distrait',    color:'#607D8B' },
]

const CONTEXTS: { v: MoodContext; label: string }[] = [
  { v:'beforeTrade', label:'Avant trade' },
  { v:'afterTrade',  label:'Après trade' },
  { v:'duringTrade', label:'Pendant trade' },
  { v:'general',     label:'Général' },
]

function fmtDate(d: Date) {
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
}

function emotionInfo(v: EmotionalState) {
  return EMOTIONS.find(e => e.v === v) ?? EMOTIONS[1]
}

function getCSSColor(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback
}
function getCSSPurpleColor(alpha: number): string {
  const rgb = getCSSColor('--tm-purple-rgb', '191,90,242')
  return `rgba(${rgb},${alpha})`
}

export default function JournalPage() {
  const [moods,   setMoods]   = useState<MoodEntry[]>([])
  const [trades,  setTrades]  = useState<Trade[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [filter,  setFilter]  = useState<EmotionalState | 'all'>('all')

  useEffect(() => {
    const unsubM = subscribeMoods(m => { setMoods(m); setLoading(false) })
    const unsubT = subscribeTrades(setTrades)
    return () => { unsubM(); unsubT() }
  }, [])

  const filtered = filter === 'all' ? moods : moods.filter(m => m.emotionalState === filter)

  // Emotion distribution
  const emotionCounts = EMOTIONS.map(e => ({
    ...e, count: moods.filter(m => m.emotionalState === e.v).length
  })).sort((a, b) => b.count - a.count)

  const avgIntensity = moods.length > 0
    ? (moods.reduce((s, m) => s + m.intensity, 0) / moods.length).toFixed(1)
    : '—'

  const tradeName = (id?: string) => {
    if (!id) return null
    const t = trades.find(t => t.id === id)
    return t ? `${t.symbol} ${t.type}` : null
  }

  return (
    <div style={{ padding:24, maxWidth:900, margin:'0 auto' }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:'var(--tm-text-primary)', margin:0 }}>Journal Émotionnel</h1>
          <p style={{ fontSize:13, color:'var(--tm-text-secondary)', margin:'3px 0 0' }}>
            {loading ? 'Chargement...' : `${moods.length} entrée${moods.length > 1 ? 's' : ''} · Intensité moy. ${avgIntensity}/10`}
          </p>
        </div>
        <button onClick={() => setShowAdd(true)} style={{ padding:'8px 16px', borderRadius:10, border:'none', background:'var(--tm-accent)', color:'var(--tm-bg)', fontSize:13, fontWeight:600, cursor:'pointer' }}>
          + Ajouter entrée
        </button>
      </div>

      {/* Emotion breakdown */}
      {!loading && moods.length > 0 && (
        <div style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:12, padding:'14px 16px', marginBottom:16 }}>
          <div style={{ fontSize:12, fontWeight:600, color:'var(--tm-text-primary)', marginBottom:12 }}>Distribution émotionnelle</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
            {emotionCounts.filter(e => e.count > 0).map(e => (
              <button key={e.v} onClick={() => setFilter(filter === e.v ? 'all' : e.v)}
                style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 10px', borderRadius:20, border:`1px solid ${filter === e.v ? e.color : 'var(--tm-border)'}`, background: filter === e.v ? `${e.color}20` : 'var(--tm-bg-tertiary)', cursor:'pointer' }}>
                <span>{e.emoji}</span>
                <span style={{ fontSize:11, color: filter === e.v ? e.color : 'var(--tm-text-secondary)' }}>{e.label}</span>
                <span style={{ fontSize:10, fontWeight:700, color: filter === e.v ? e.color : 'var(--tm-text-muted)', background:'var(--tm-border)', padding:'1px 5px', borderRadius:10 }}>{e.count}</span>
              </button>
            ))}
            {filter !== 'all' && (
              <button onClick={() => setFilter('all')} style={{ padding:'5px 10px', borderRadius:20, border:'1px solid #2A2F3E', background:'none', cursor:'pointer', fontSize:11, color:'var(--tm-text-muted)' }}>× Tout voir</button>
            )}
          </div>
        </div>
      )}

      {/* Emotion curve chart */}
      {!loading && moods.length >= 2 && <EmotionCurve moods={moods} />}

      {/* Entries */}
      {loading ? (
        <div style={{ textAlign:'center', padding:48, color:'var(--tm-text-muted)' }}>
          <div style={{ width:24, height:24, border:'2px solid #2A2F3E', borderTopColor:'var(--tm-accent)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto 12px' }} />
          Chargement depuis Firestore...
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:48, color:'var(--tm-text-muted)', fontSize:14 }}>
          {moods.length === 0 ? 'Aucune entrée dans le journal' : 'Aucune entrée pour ce filtre'}
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {filtered.map(mood => {
            const em = emotionInfo(mood.emotionalState)
            const ctx = CONTEXTS.find(c => c.v === mood.context)
            const linkedTrade = tradeName(mood.tradeId)
            return (
              <div key={mood.id} style={{ background:'var(--tm-bg-secondary)', border:`1px solid ${em.color}30`, borderRadius:12, padding:'12px 14px' }}>
                <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
                  {/* Emotion circle */}
                  <div style={{ width:42, height:42, borderRadius:12, background:`${em.color}20`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, flexShrink:0 }}>
                    {em.emoji}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4, flexWrap:'wrap' }}>
                      <span style={{ fontSize:13, fontWeight:700, color:em.color }}>{em.label}</span>
                      {/* Intensity bar */}
                      <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                        <div style={{ width:60, height:5, background:'var(--tm-border)', borderRadius:3, overflow:'hidden' }}>
                          <div style={{ width:`${mood.intensity * 10}%`, height:'100%', background:em.color, borderRadius:3 }} />
                        </div>
                        <span style={{ fontSize:10, color:'var(--tm-text-muted)' }}>{mood.intensity}/10</span>
                      </div>
                      <span style={{ fontSize:10, color:'var(--tm-text-muted)', background:'var(--tm-bg-tertiary)', padding:'1px 7px', borderRadius:4 }}>{ctx?.label}</span>
                      {mood.isExceptional && <span style={{ fontSize:9, color:'#FFD700', background:'rgba(255,215,0,0.1)', padding:'1px 6px', borderRadius:4 }}>⭐ Exceptionnel</span>}
                    </div>
                    <div style={{ fontSize:11, color:'var(--tm-text-muted)', marginBottom: mood.notes ? 6 : 0 }}>
                      {fmtDate(mood.timestamp)}
                      {linkedTrade && <span style={{ marginLeft:8, color:'var(--tm-accent)' }}>→ {linkedTrade}</span>}
                    </div>
                    {mood.notes && <div style={{ fontSize:12, color:'#C5C8D6', lineHeight:1.6, marginBottom:4 }}>{mood.notes}</div>}
                    {mood.aiSummary && (
                      <div style={{ fontSize:11, color:'var(--tm-text-secondary)', background:'rgba(var(--tm-accent-rgb,0,229,255),0.05)', border:'1px solid rgba(var(--tm-accent-rgb,0,229,255),0.1)', borderRadius:6, padding:'5px 8px', marginTop:4 }}>
                        ✨ {mood.aiSummary}
                      </div>
                    )}
                    {mood.tags.length > 0 && (
                      <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginTop:5 }}>
                        {mood.tags.map(tag => (
                          <span key={tag} style={{ fontSize:10, color:'var(--tm-text-muted)', background:'var(--tm-bg-tertiary)', padding:'1px 6px', borderRadius:4 }}>#{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={() => { if(confirm('Supprimer ?')) deleteMood(mood.id) }} style={{ background:'none', border:'none', color:'var(--tm-text-muted)', cursor:'pointer', fontSize:12, flexShrink:0 }}>✕</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showAdd && <AddMoodModal trades={trades} onClose={() => setShowAdd(false)} />}
    </div>
  )
}

// ── Emotion Curve Chart ────────────────────────────────────────────────────

function EmotionCurve({ moods }: { moods: MoodEntry[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hoverIdx, setHoverIdx] = useState<number|null>(null)
  const [period, setPeriod] = useState<'7j'|'1M'|'3M'|'all'>('all')

  const sorted = [...moods].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

  const periodDays = period === '7j' ? 7 : period === '1M' ? 30 : period === '3M' ? 90 : 99999
  const cutoff = Date.now() - periodDays * 86400000
  const filtered = sorted.filter(m => m.timestamp.getTime() >= cutoff)

  const emotionToScore = (e: EmotionalState): number => {
    const map: Record<EmotionalState, number> = {
      confident:5, calm:4.5, focused:5, excited:3.5,
      stressed:2, impatient:2, fearful:1, greedy:2.5,
      frustrated:1.5, distracted:2.5,
    }
    return map[e] ?? 3
  }

  const points = filtered.map(m => ({
    date: m.timestamp,
    score: emotionToScore(m.emotionalState),
    intensity: m.intensity,
    emotion: m.emotionalState,
    emoji: EMOTIONS.find(e => e.v === m.emotionalState)?.emoji ?? '😐',
    label: EMOTIONS.find(e => e.v === m.emotionalState)?.label ?? '—',
    color: EMOTIONS.find(e => e.v === m.emotionalState)?.color ?? 'var(--tm-text-secondary)',
    notes: m.notes,
  }))

  // Moving average (3 pts)
  const ma = points.map((p, i) => {
    if (i < 1) return p.score
    const win = points.slice(Math.max(0, i - 2), i + 1)
    return win.reduce((a, b) => a + b.score, 0) / win.length
  })

  // Stats
  const avgScore = points.length ? points.reduce((a, p) => a + p.score, 0) / points.length : 0
  const trend = points.length >= 3 ? (ma[ma.length - 1] - ma[Math.max(0, ma.length - 4)]) : 0
  const bestEmotion = points.length ? (() => {
    const counts: Record<string, number> = {}
    points.forEach(p => { counts[p.label] = (counts[p.label] || 0) + 1 })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
  })() : '—'

  useEffect(() => {
    const c = canvasRef.current; if (!c || points.length < 2) return
    const dpr = window.devicePixelRatio || 1
    const cssW = c.offsetWidth || 700, cssH = 180
    c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr)
    c.style.width = cssW + 'px'; c.style.height = cssH + 'px'
    const ctx = c.getContext('2d')!; ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, cssW, cssH)

    const PAD = { t:14, r:12, b:26, l:40 }
    const cW = cssW - PAD.l - PAD.r, cH = cssH - PAD.t - PAD.b
    const toX = (i: number) => PAD.l + (i / (points.length - 1)) * cW
    const toY = (v: number) => PAD.t + cH - ((v - 0.5) / 5) * cH

    // Colored zone backgrounds
    const zones = [
      { y1:5, y2:3.5, color:'rgba(var(--tm-profit-rgb,34,199,89),0.04)', label:'Zone optimale' },
      { y1:3.5, y2:2.5, color:'rgba(var(--tm-warning-rgb,255,149,0),0.03)', label:'Zone neutre' },
      { y1:2.5, y2:0.5, color:'rgba(var(--tm-loss-rgb,255,59,48),0.04)', label:'Zone à risque' },
    ]
    zones.forEach(z => {
      ctx.fillStyle = z.color
      ctx.fillRect(PAD.l, toY(z.y1), cW, toY(z.y2) - toY(z.y1))
    })

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1
    for (let v = 1; v <= 5; v++) {
      const y = toY(v)
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(cssW - PAD.r, y); ctx.stroke()
    }
    // Dashed middle line
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.setLineDash([4, 4])
    ctx.beginPath(); ctx.moveTo(PAD.l, toY(3)); ctx.lineTo(cssW - PAD.r, toY(3)); ctx.stroke()
    ctx.setLineDash([])

    // Y labels
    ctx.font = '9px JetBrains Mono,monospace'; ctx.textAlign = 'right'
    ctx.fillStyle = 'var(--tm-profit)'; ctx.fillText('😎 5', PAD.l - 4, toY(5) + 4)
    ctx.fillStyle = 'var(--tm-text-secondary)'; ctx.fillText('😐 3', PAD.l - 4, toY(3) + 4)
    ctx.fillStyle = 'var(--tm-loss)'; ctx.fillText('😰 1', PAD.l - 4, toY(1) + 4)

    // Moving average fill
    const maG = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + cH)
    maG.addColorStop(0, getCSSPurpleColor(0.15)); maG.addColorStop(1, getCSSPurpleColor(0))
    ctx.beginPath()
    ma.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)))
    ctx.lineTo(toX(points.length - 1), PAD.t + cH); ctx.lineTo(toX(0), PAD.t + cH)
    ctx.closePath(); ctx.fillStyle = maG; ctx.fill()

    // Moving average line
    ctx.beginPath(); ctx.strokeStyle = 'rgba(var(--tm-purple-rgb,191,90,242),0.5)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3])
    ma.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)))
    ctx.stroke(); ctx.setLineDash([])

    // Main line with gradient color
    for (let i = 1; i < points.length; i++) {
      const x1 = toX(i - 1), y1t = toY(points[i - 1].score)
      const x2 = toX(i), y2t = toY(points[i].score)
      ctx.beginPath(); ctx.moveTo(x1, y1t); ctx.lineTo(x2, y2t)
      ctx.strokeStyle = points[i].score >= 3.5 ? 'var(--tm-profit)' : points[i].score >= 2.5 ? 'var(--tm-warning)' : 'var(--tm-loss)'
      ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.stroke()
    }

    // Dots with emoji color
    points.forEach((p, i) => {
      const x = toX(i), y = toY(p.score)
      const isHov = i === hoverIdx
      ctx.beginPath(); ctx.arc(x, y, isHov ? 7 : 3.5, 0, Math.PI * 2)
      ctx.fillStyle = isHov ? p.color : p.color + '99'; ctx.fill()
      if (isHov) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke() }
    })

    // X labels
    const step = Math.max(1, Math.ceil(points.length / 8))
    ctx.fillStyle = 'var(--tm-text-muted)'; ctx.font = '9px JetBrains Mono,monospace'; ctx.textAlign = 'center'
    points.forEach((p, i) => {
      if (i % step === 0 || i === points.length - 1)
        ctx.fillText(p.date.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit' }), toX(i), cssH - 6)
    })

    // Crosshair
    if (hoverIdx !== null && hoverIdx >= 0 && hoverIdx < points.length) {
      const hx = toX(hoverIdx)
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3])
      ctx.beginPath(); ctx.moveTo(hx, PAD.t); ctx.lineTo(hx, PAD.t + cH); ctx.stroke()
      ctx.setLineDash([])
    }
  }, [points, hoverIdx, ma])

  const onMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current; if (!c || points.length < 2) return
    const rect = c.getBoundingClientRect()
    const PAD_L = 40, PAD_R = 12
    const x = e.clientX - rect.left
    const pct = Math.max(0, Math.min(1, (x - PAD_L) / (rect.width - PAD_L - PAD_R)))
    setHoverIdx(Math.round(pct * (points.length - 1)))
  }, [points.length])

  const hoveredPt = hoverIdx !== null ? points[hoverIdx] : null

  if (points.length < 2) return null

  return (
    <div ref={wrapRef} style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:12, padding:'14px 16px', marginBottom:16 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:28, height:28, borderRadius:8, background:'rgba(var(--tm-purple-rgb,191,90,242),0.15)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}>📈</div>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--tm-text-primary)' }}>Courbe émotionnelle</div>
            <div style={{ fontSize:10, color:'var(--tm-text-muted)' }}>{points.length} entrées · moy. {avgScore.toFixed(1)}/5</div>
          </div>
        </div>
        <div style={{ display:'flex', gap:4 }}>
          {(['7j','1M','3M','all'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              padding:'3px 10px', borderRadius:20, fontSize:10, fontWeight:600, cursor:'pointer',
              border:`1px solid ${period === p ? 'var(--tm-purple)' : 'var(--tm-border)'}`,
              background: period === p ? 'rgba(var(--tm-purple-rgb,191,90,242),0.15)' : 'transparent',
              color: period === p ? 'var(--tm-purple)' : 'var(--tm-text-muted)',
            }}>{p === 'all' ? 'Tout' : p}</button>
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, marginBottom:12 }}>
        {[
          { label:'Score moyen', value:avgScore.toFixed(1), color:avgScore>=3.5?'var(--tm-profit)':avgScore>=2.5?'var(--tm-warning)':'var(--tm-loss)', icon:'📊' },
          { label:'Tendance', value:trend>0.2?'↑ Amélioration':trend<-0.2?'↓ Dégradation':'→ Stable', color:trend>0.2?'var(--tm-profit)':trend<-0.2?'var(--tm-loss)':'var(--tm-text-secondary)', icon:trend>0.2?'📈':trend<-0.2?'📉':'➡️' },
          { label:'Émotion dominante', value:bestEmotion, color:'var(--tm-purple)', icon:'💜' },
          { label:'Dernière entrée', value:points[points.length-1]?.label, color:points[points.length-1]?.color ?? 'var(--tm-text-secondary)', icon:'🕐' },
        ].map(({ label, value, color, icon }) => (
          <div key={label} style={{ background:'rgba(255,255,255,0.02)', border:'1px solid #1E2330', borderRadius:8, padding:'8px 10px' }}>
            <div style={{ fontSize:9, color:'var(--tm-text-muted)', marginBottom:3 }}>{icon} {label}</div>
            <div style={{ fontSize:11, fontWeight:700, color, fontFamily:'JetBrains Mono,monospace' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Hover info */}
      {hoveredPt && (
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 10px', background:'rgba(var(--tm-purple-rgb,191,90,242),0.06)', border:'1px solid rgba(var(--tm-purple-rgb,191,90,242),0.15)', borderRadius:8, marginBottom:8 }}>
          <span style={{ fontSize:18 }}>{hoveredPt.emoji}</span>
          <div style={{ flex:1 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:12, fontWeight:700, color:hoveredPt.color }}>{hoveredPt.label}</span>
              <span style={{ fontSize:10, color:'var(--tm-text-muted)', fontFamily:'JetBrains Mono,monospace' }}>Score: {hoveredPt.score}/5</span>
              <span style={{ fontSize:10, color:'var(--tm-text-muted)' }}>·</span>
              <span style={{ fontSize:10, color:'var(--tm-text-secondary)' }}>Intensité: {hoveredPt.intensity}/10</span>
            </div>
            <div style={{ fontSize:10, color:'var(--tm-text-muted)', fontFamily:'JetBrains Mono,monospace' }}>
              {hoveredPt.date.toLocaleDateString('fr-FR', { weekday:'short', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
            </div>
          </div>
          {hoveredPt.notes && <div style={{ fontSize:10, color:'var(--tm-text-secondary)', maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>"{hoveredPt.notes}"</div>}
        </div>
      )}

      <canvas ref={canvasRef} width={700} height={180}
        onMouseMove={onMove} onMouseLeave={() => setHoverIdx(null)}
        style={{ width:'100%', height:180, display:'block', borderRadius:8, cursor:'crosshair' }} />

      {/* Legend */}
      <div style={{ display:'flex', gap:14, marginTop:8, justifyContent:'center' }}>
        {[
          { color:'var(--tm-profit)', label:'Zone optimale (3.5-5)' },
          { color:'var(--tm-warning)', label:'Zone neutre (2.5-3.5)' },
          { color:'var(--tm-loss)', label:'Zone à risque (1-2.5)' },
          { color:'rgba(var(--tm-purple-rgb,191,90,242),0.5)', label:'Moyenne mobile', dash:true },
        ].map(({ color, label, dash }) => (
          <div key={label} style={{ display:'flex', alignItems:'center', gap:4 }}>
            <div style={{ width:12, height:2, background:color, borderRadius:1, ...(dash ? { backgroundImage:`repeating-linear-gradient(90deg,${color} 0,${color} 4px,transparent 4px,transparent 7px)`, background:'none' } : {}) }} />
            <span style={{ fontSize:9, color:'var(--tm-text-muted)' }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Add Mood Modal ─────────────────────────────────────────────────────────

function AddMoodModal({ trades, onClose }: { trades: Trade[]; onClose: () => void }) {
  const [state,   setState]   = useState<EmotionalState>('calm')
  const [intensity, setIntensity] = useState(5)
  const [context, setContext] = useState<MoodContext>('general')
  const [notes,   setNotes]   = useState('')
  const [tradeId, setTradeId] = useState('')
  const [saving,  setSaving]  = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await createMood({
        id: crypto.randomUUID(),
        emotionalState: state,
        intensity,
        timestamp: new Date(),
        context,
        tags: [],
        isExceptional: intensity >= 9,
        tradeId: tradeId || undefined,
        notes: notes || undefined,
      })
      onClose()
    } catch(e) { alert((e as Error).message) }
    finally { setSaving(false) }
  }

  const em = emotionInfo(state)

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
      <div style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:16, padding:24, width:460, maxWidth:'95vw', maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:18 }}>
          <span style={{ fontSize:16, fontWeight:700, color:'var(--tm-text-primary)' }}>Nouvelle entrée</span>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--tm-text-muted)', cursor:'pointer', fontSize:18 }}>✕</button>
        </div>

        {/* Emotion grid */}
        <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:8 }}>ÉTAT ÉMOTIONNEL</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:6, marginBottom:14 }}>
          {EMOTIONS.map(e => (
            <button key={e.v} onClick={() => setState(e.v)} style={{ padding:'8px 4px', borderRadius:8, border:`1px solid ${state===e.v?e.color:'var(--tm-border)'}`, background: state===e.v?`${e.color}20`:'var(--tm-bg-tertiary)', cursor:'pointer', textAlign:'center' }}>
              <div style={{ fontSize:18 }}>{e.emoji}</div>
              <div style={{ fontSize:9, color: state===e.v?e.color:'var(--tm-text-muted)', marginTop:2 }}>{e.label}</div>
            </button>
          ))}
        </div>

        {/* Intensity */}
        <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:6 }}>INTENSITÉ : {intensity}/10</div>
        <input type="range" min={1} max={10} value={intensity} onChange={e => setIntensity(Number(e.target.value))}
          style={{ width:'100%', marginBottom:14, accentColor:em.color }} />

        {/* Context */}
        <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:6 }}>CONTEXTE</div>
        <div style={{ display:'flex', gap:6, marginBottom:14, flexWrap:'wrap' }}>
          {CONTEXTS.map(c => (
            <button key={c.v} onClick={() => setContext(c.v)} style={{ padding:'5px 10px', borderRadius:6, border:`1px solid ${context===c.v?'var(--tm-accent)':'var(--tm-border)'}`, background: context===c.v?'rgba(var(--tm-accent-rgb,0,229,255),0.1)':'var(--tm-bg-tertiary)', cursor:'pointer', fontSize:11, color: context===c.v?'var(--tm-accent)':'var(--tm-text-secondary)' }}>
              {c.label}
            </button>
          ))}
        </div>

        {/* Linked trade */}
        {trades.length > 0 && (
          <>
            <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:6 }}>TRADE LIÉ (optionnel)</div>
            <select value={tradeId} onChange={e => setTradeId(e.target.value)}
              style={{ width:'100%', padding:'8px 10px', borderRadius:8, border:'1px solid #2A2F3E', background:'var(--tm-bg-tertiary)', color:'var(--tm-text-primary)', fontSize:13, outline:'none', marginBottom:14, cursor:'pointer' }}>
              <option value="">— Aucun trade —</option>
              {trades.slice(0,20).map(t => (
                <option key={t.id} value={t.id}>{t.symbol} {t.type} {t.date.toLocaleDateString('fr-FR')}</option>
              ))}
            </select>
          </>
        )}

        {/* Notes */}
        <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:6 }}>NOTES</div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Comment tu te sens ? Qu'est-ce qui influence ton état ?" rows={3}
          style={{ width:'100%', padding:'8px 10px', borderRadius:8, border:'1px solid #2A2F3E', background:'var(--tm-bg-tertiary)', color:'var(--tm-text-primary)', fontSize:13, outline:'none', resize:'vertical', marginBottom:16, boxSizing:'border-box' }} />

        <button onClick={save} disabled={saving} style={{ width:'100%', padding:10, borderRadius:10, border:'none', background:'var(--tm-accent)', color:'var(--tm-bg)', fontSize:14, fontWeight:600, cursor:'pointer' }}>
          {saving ? 'Enregistrement...' : `Enregistrer — ${em.emoji} ${em.label} ${intensity}/10`}
        </button>
      </div>
    </div>
  )
}
