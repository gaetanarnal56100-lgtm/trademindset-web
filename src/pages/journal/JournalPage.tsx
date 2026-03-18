// src/pages/journal/JournalPage.tsx — Connecté à Firestore users/{uid}/moods

import { useState, useEffect } from 'react'
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
          <h1 style={{ fontSize:22, fontWeight:700, color:'#F0F3FF', margin:0 }}>Journal Émotionnel</h1>
          <p style={{ fontSize:13, color:'#8F94A3', margin:'3px 0 0' }}>
            {loading ? 'Chargement...' : `${moods.length} entrée${moods.length > 1 ? 's' : ''} · Intensité moy. ${avgIntensity}/10`}
          </p>
        </div>
        <button onClick={() => setShowAdd(true)} style={{ padding:'8px 16px', borderRadius:10, border:'none', background:'#00E5FF', color:'#0D1117', fontSize:13, fontWeight:600, cursor:'pointer' }}>
          + Ajouter entrée
        </button>
      </div>

      {/* Emotion breakdown */}
      {!loading && moods.length > 0 && (
        <div style={{ background:'#161B22', border:'1px solid #2A2F3E', borderRadius:12, padding:'14px 16px', marginBottom:16 }}>
          <div style={{ fontSize:12, fontWeight:600, color:'#F0F3FF', marginBottom:12 }}>Distribution émotionnelle</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
            {emotionCounts.filter(e => e.count > 0).map(e => (
              <button key={e.v} onClick={() => setFilter(filter === e.v ? 'all' : e.v)}
                style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 10px', borderRadius:20, border:`1px solid ${filter === e.v ? e.color : '#2A2F3E'}`, background: filter === e.v ? `${e.color}20` : '#1C2130', cursor:'pointer' }}>
                <span>{e.emoji}</span>
                <span style={{ fontSize:11, color: filter === e.v ? e.color : '#8F94A3' }}>{e.label}</span>
                <span style={{ fontSize:10, fontWeight:700, color: filter === e.v ? e.color : '#555C70', background:'#2A2F3E', padding:'1px 5px', borderRadius:10 }}>{e.count}</span>
              </button>
            ))}
            {filter !== 'all' && (
              <button onClick={() => setFilter('all')} style={{ padding:'5px 10px', borderRadius:20, border:'1px solid #2A2F3E', background:'none', cursor:'pointer', fontSize:11, color:'#555C70' }}>× Tout voir</button>
            )}
          </div>
        </div>
      )}

      {/* Entries */}
      {loading ? (
        <div style={{ textAlign:'center', padding:48, color:'#555C70' }}>
          <div style={{ width:24, height:24, border:'2px solid #2A2F3E', borderTopColor:'#00E5FF', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto 12px' }} />
          Chargement depuis Firestore...
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:48, color:'#555C70', fontSize:14 }}>
          {moods.length === 0 ? 'Aucune entrée dans le journal' : 'Aucune entrée pour ce filtre'}
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {filtered.map(mood => {
            const em = emotionInfo(mood.emotionalState)
            const ctx = CONTEXTS.find(c => c.v === mood.context)
            const linkedTrade = tradeName(mood.tradeId)
            return (
              <div key={mood.id} style={{ background:'#161B22', border:`1px solid ${em.color}30`, borderRadius:12, padding:'12px 14px' }}>
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
                        <div style={{ width:60, height:5, background:'#2A2F3E', borderRadius:3, overflow:'hidden' }}>
                          <div style={{ width:`${mood.intensity * 10}%`, height:'100%', background:em.color, borderRadius:3 }} />
                        </div>
                        <span style={{ fontSize:10, color:'#555C70' }}>{mood.intensity}/10</span>
                      </div>
                      <span style={{ fontSize:10, color:'#555C70', background:'#1C2130', padding:'1px 7px', borderRadius:4 }}>{ctx?.label}</span>
                      {mood.isExceptional && <span style={{ fontSize:9, color:'#FFD700', background:'rgba(255,215,0,0.1)', padding:'1px 6px', borderRadius:4 }}>⭐ Exceptionnel</span>}
                    </div>
                    <div style={{ fontSize:11, color:'#555C70', marginBottom: mood.notes ? 6 : 0 }}>
                      {fmtDate(mood.timestamp)}
                      {linkedTrade && <span style={{ marginLeft:8, color:'#00E5FF' }}>→ {linkedTrade}</span>}
                    </div>
                    {mood.notes && <div style={{ fontSize:12, color:'#C5C8D6', lineHeight:1.6, marginBottom:4 }}>{mood.notes}</div>}
                    {mood.aiSummary && (
                      <div style={{ fontSize:11, color:'#8F94A3', background:'rgba(0,229,255,0.05)', border:'1px solid rgba(0,229,255,0.1)', borderRadius:6, padding:'5px 8px', marginTop:4 }}>
                        ✨ {mood.aiSummary}
                      </div>
                    )}
                    {mood.tags.length > 0 && (
                      <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginTop:5 }}>
                        {mood.tags.map(tag => (
                          <span key={tag} style={{ fontSize:10, color:'#555C70', background:'#1C2130', padding:'1px 6px', borderRadius:4 }}>#{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={() => { if(confirm('Supprimer ?')) deleteMood(mood.id) }} style={{ background:'none', border:'none', color:'#555C70', cursor:'pointer', fontSize:12, flexShrink:0 }}>✕</button>
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
      <div style={{ background:'#161B22', border:'1px solid #2A2F3E', borderRadius:16, padding:24, width:460, maxWidth:'95vw', maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:18 }}>
          <span style={{ fontSize:16, fontWeight:700, color:'#F0F3FF' }}>Nouvelle entrée</span>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#555C70', cursor:'pointer', fontSize:18 }}>✕</button>
        </div>

        {/* Emotion grid */}
        <div style={{ fontSize:10, color:'#555C70', marginBottom:8 }}>ÉTAT ÉMOTIONNEL</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:6, marginBottom:14 }}>
          {EMOTIONS.map(e => (
            <button key={e.v} onClick={() => setState(e.v)} style={{ padding:'8px 4px', borderRadius:8, border:`1px solid ${state===e.v?e.color:'#2A2F3E'}`, background: state===e.v?`${e.color}20`:'#1C2130', cursor:'pointer', textAlign:'center' }}>
              <div style={{ fontSize:18 }}>{e.emoji}</div>
              <div style={{ fontSize:9, color: state===e.v?e.color:'#555C70', marginTop:2 }}>{e.label}</div>
            </button>
          ))}
        </div>

        {/* Intensity */}
        <div style={{ fontSize:10, color:'#555C70', marginBottom:6 }}>INTENSITÉ : {intensity}/10</div>
        <input type="range" min={1} max={10} value={intensity} onChange={e => setIntensity(Number(e.target.value))}
          style={{ width:'100%', marginBottom:14, accentColor:em.color }} />

        {/* Context */}
        <div style={{ fontSize:10, color:'#555C70', marginBottom:6 }}>CONTEXTE</div>
        <div style={{ display:'flex', gap:6, marginBottom:14, flexWrap:'wrap' }}>
          {CONTEXTS.map(c => (
            <button key={c.v} onClick={() => setContext(c.v)} style={{ padding:'5px 10px', borderRadius:6, border:`1px solid ${context===c.v?'#00E5FF':'#2A2F3E'}`, background: context===c.v?'rgba(0,229,255,0.1)':'#1C2130', cursor:'pointer', fontSize:11, color: context===c.v?'#00E5FF':'#8F94A3' }}>
              {c.label}
            </button>
          ))}
        </div>

        {/* Linked trade */}
        {trades.length > 0 && (
          <>
            <div style={{ fontSize:10, color:'#555C70', marginBottom:6 }}>TRADE LIÉ (optionnel)</div>
            <select value={tradeId} onChange={e => setTradeId(e.target.value)}
              style={{ width:'100%', padding:'8px 10px', borderRadius:8, border:'1px solid #2A2F3E', background:'#1C2130', color:'#F0F3FF', fontSize:13, outline:'none', marginBottom:14, cursor:'pointer' }}>
              <option value="">— Aucun trade —</option>
              {trades.slice(0,20).map(t => (
                <option key={t.id} value={t.id}>{t.symbol} {t.type} {t.date.toLocaleDateString('fr-FR')}</option>
              ))}
            </select>
          </>
        )}

        {/* Notes */}
        <div style={{ fontSize:10, color:'#555C70', marginBottom:6 }}>NOTES</div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Comment tu te sens ? Qu'est-ce qui influence ton état ?" rows={3}
          style={{ width:'100%', padding:'8px 10px', borderRadius:8, border:'1px solid #2A2F3E', background:'#1C2130', color:'#F0F3FF', fontSize:13, outline:'none', resize:'vertical', marginBottom:16, boxSizing:'border-box' }} />

        <button onClick={save} disabled={saving} style={{ width:'100%', padding:10, borderRadius:10, border:'none', background:'#00E5FF', color:'#0D1117', fontSize:14, fontWeight:600, cursor:'pointer' }}>
          {saving ? 'Enregistrement...' : `Enregistrer — ${em.emoji} ${em.label} ${intensity}/10`}
        </button>
      </div>
    </div>
  )
}
