// src/pages/journal/AddMoodModal.tsx

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createMood, type Trade, type EmotionalState, type MoodContext } from '@/services/firestore'

const EMOTIONS: { v: EmotionalState; emoji: string; labelKey: string; fallback: string; color: string }[] = [
  { v:'confident',  emoji:'😎', labelKey:'journal.emotions.confident',  fallback:'Confident',   color:'#4CAF50' },
  { v:'calm',       emoji:'😌', labelKey:'journal.emotions.calm',        fallback:'Calm',        color:'#2196F3' },
  { v:'focused',    emoji:'🎯', labelKey:'journal.emotions.focused',     fallback:'Focused',     color:'#00BCD4' },
  { v:'excited',    emoji:'🤩', labelKey:'journal.emotions.excited',     fallback:'Excited',     color:'#E91E63' },
  { v:'stressed',   emoji:'😰', labelKey:'journal.emotions.stressed',    fallback:'Stressed',    color:'#F44336' },
  { v:'impatient',  emoji:'😤', labelKey:'journal.emotions.impatient',   fallback:'Impatient',   color:'#FF9800' },
  { v:'fearful',    emoji:'😨', labelKey:'journal.emotions.fearful',     fallback:'Fearful',     color:'#9C27B0' },
  { v:'greedy',     emoji:'💰', labelKey:'journal.emotions.greedy',      fallback:'Greedy',      color:'#FFC107' },
  { v:'frustrated', emoji:'😡', labelKey:'journal.emotions.frustrated',  fallback:'Frustrated',  color:'#795548' },
  { v:'distracted', emoji:'🤔', labelKey:'journal.emotions.distracted',  fallback:'Distracted',  color:'#607D8B' },
]

const CONTEXTS: { v: MoodContext; labelKey: string; fallback: string }[] = [
  { v:'beforeTrade', labelKey:'journal.beforeTrade', fallback:'Before trade' },
  { v:'afterTrade',  labelKey:'journal.afterTrade',  fallback:'After trade'  },
  { v:'duringTrade', labelKey:'journal.duringTrade', fallback:'During trade' },
  { v:'general',     labelKey:'journal.general',     fallback:'General'      },
]

// Canvas cannot use CSS vars — resolve at draw time
function resolveCSSColor(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback
}

function getCSSPurpleColor(alpha: number): string {
  const rgb = resolveCSSColor('--tm-purple-rgb', '191,90,242')
  return `rgba(${rgb},${alpha})`
}

// Exported for potential reuse
export { resolveCSSColor, getCSSPurpleColor, EMOTIONS, CONTEXTS }

function emotionInfo(v: EmotionalState, t?: (key: string) => string): { v: EmotionalState; emoji: string; label: string; labelKey: string; fallback: string; color: string } {
  const em = EMOTIONS.find(e => e.v === v) ?? EMOTIONS[1]
  return { ...em, label: t ? t(em.labelKey) : em.fallback }
}

export default function AddMoodModal({ trades, onClose }: { trades: Trade[]; onClose: () => void }) {
  const { t } = useTranslation()
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
          <span style={{ fontSize:16, fontWeight:700, color:'var(--tm-text-primary)' }}>{t('journal.newEntry')}</span>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--tm-text-muted)', cursor:'pointer', fontSize:18 }}>✕</button>
        </div>

        {/* Emotion grid */}
        <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:8 }}>{t('journal.emotionalState')}</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:6, marginBottom:14 }}>
          {EMOTIONS.map(e => (
            <button key={e.v} onClick={() => setState(e.v)} style={{ padding:'8px 4px', borderRadius:8, border:`1px solid ${state===e.v?e.color:'var(--tm-border)'}`, background: state===e.v?`${e.color}`:'var(--tm-bg-tertiary)', cursor:'pointer', textAlign:'center' }}>
              <div style={{ fontSize:18 }}>{e.emoji}</div>
              <div style={{ fontSize:9, color: state===e.v?e.color:'var(--tm-text-muted)', marginTop:2 }}>{t(e.labelKey)}</div>
            </button>
          ))}
        </div>

        {/* Intensity */}
        <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:6 }}>{t('journal.intensityLabel', { value: intensity })}</div>
        <input type="range" min={1} max={10} value={intensity} onChange={e => setIntensity(Number(e.target.value))}
          style={{ width:'100%', marginBottom:14, accentColor:em.color }} />

        {/* Context */}
        <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:6 }}>{t('journal.context')}</div>
        <div style={{ display:'flex', gap:6, marginBottom:14, flexWrap:'wrap' }}>
          {CONTEXTS.map(c => (
            <button key={c.v} onClick={() => setContext(c.v)} style={{ padding:'5px 10px', borderRadius:6, border:`1px solid ${context===c.v?'var(--tm-accent)':'var(--tm-border)'}`, background: context===c.v?`rgba(${resolveCSSColor('--tm-accent-rgb','0,229,255')},0.1)`:'var(--tm-bg-tertiary)', cursor:'pointer', fontSize:11, color: context===c.v?'var(--tm-accent)':'var(--tm-text-secondary)' }}>
              {t(c.labelKey)}
            </button>
          ))}
        </div>

        {/* Linked trade */}
        {trades.length > 0 && (
          <>
            <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:6 }}>{t('journal.linkedTrade')}</div>
            <select value={tradeId} onChange={e => setTradeId(e.target.value)}
              style={{ width:'100%', padding:'8px 10px', borderRadius:8, border:'1px solid #2A2F3E', background:'var(--tm-bg-tertiary)', color:'var(--tm-text-primary)', fontSize:13, outline:'none', marginBottom:14, cursor:'pointer' }}>
              <option value="">{t('journal.noTrade')}</option>
              {trades.slice(0,20).map(tr => (
                <option key={tr.id} value={tr.id}>{tr.symbol} {tr.type} {tr.date.toLocaleDateString('fr-FR')}</option>
              ))}
            </select>
          </>
        )}

        {/* Notes */}
        <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:6 }}>{t('journal.notes')}</div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('journal.notesPlaceholder')} rows={3}
          style={{ width:'100%', padding:'8px 10px', borderRadius:8, border:'1px solid #2A2F3E', background:'var(--tm-bg-tertiary)', color:'var(--tm-text-primary)', fontSize:13, outline:'none', resize:'vertical', marginBottom:16, boxSizing:'border-box' }} />

        <button onClick={save} disabled={saving} style={{ width:'100%', padding:10, borderRadius:10, border:'none', background:'var(--tm-accent)', color:'var(--tm-bg)', fontSize:14, fontWeight:600, cursor:'pointer' }}>
          {saving ? t('common.saving') : `${t('common.save')} — ${em.emoji} ${t(em.labelKey)} ${intensity}/10`}
        </button>
      </div>
    </div>
  )
}
