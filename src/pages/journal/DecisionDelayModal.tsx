// src/pages/journal/DecisionDelayModal.tsx
// Decision Delay System — timer obligatoire + checklist avant un trade
// Casse les impulsions et force la discipline

import { useState, useEffect, useRef } from 'react'

const DELAY_SECONDS = 15

const CHECKLIST = [
  { id: 'setup',   label: 'Mon setup est clairement identifié (entry, SL, TP)' },
  { id: 'size',    label: 'Ma taille de position respecte mon % de risque max' },
  { id: 'norevenge', label: "Je ne suis PAS en mode revanche après une perte" },
  { id: 'context', label: 'Le contexte marché est favorable à mon type de trade' },
  { id: 'session', label: 'Je trade pendant ma session optimale' },
]

interface DecisionDelayModalProps {
  onConfirm: () => void
  onCancel: () => void
}

export default function DecisionDelayModal({ onConfirm, onCancel }: DecisionDelayModalProps) {
  const [secondsLeft, setSecondsLeft] = useState(DELAY_SECONDS)
  const [timerDone, setTimerDone] = useState(false)
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const allChecked = CHECKLIST.every(c => checked[c.id])
  const canProceed = timerDone && allChecked

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) {
          clearInterval(intervalRef.current!)
          setTimerDone(true)
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  const toggle = (id: string) => setChecked(c => ({ ...c, [id]: !c[id] }))
  const checkedCount = Object.values(checked).filter(Boolean).length
  const progress = (checkedCount / CHECKLIST.length) * 100

  // Circle progress
  const radius = 26
  const circumference = 2 * Math.PI * radius
  const timerProgress = timerDone ? circumference : ((DELAY_SECONDS - secondsLeft) / DELAY_SECONDS) * circumference

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(12px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={onCancel}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#0D1117',
          border: '1px solid rgba(0,229,255,0.15)',
          borderRadius: 20,
          padding: '28px 28px 24px',
          width: 460, maxWidth: '100%',
          display: 'flex', flexDirection: 'column', gap: 20,
          boxShadow: '0 0 60px rgba(0,229,255,0.08)',
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⚡</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#F0F2F5', fontFamily: 'Syne, sans-serif', marginBottom: 4 }}>
            Decision Delay System
          </div>
          <div style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.5 }}>
            Prends le temps de réfléchir avant d'agir.<br/>
            Les trades impulsifs coûtent cher.
          </div>
        </div>

        {/* Timer circulaire */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div style={{ position: 'relative', width: 72, height: 72 }}>
            <svg width="72" height="72" style={{ transform: 'rotate(-90deg)' }}>
              {/* Background */}
              <circle cx="36" cy="36" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
              {/* Progress */}
              <circle
                cx="36" cy="36" r={radius} fill="none"
                stroke={timerDone ? '#22C759' : '#00E5FF'}
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference - timerProgress}
                style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s' }}
              />
            </svg>
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: timerDone ? 18 : 20, fontWeight: 800,
              color: timerDone ? '#22C759' : '#00E5FF',
              fontFamily: 'JetBrains Mono, monospace',
            }}>
              {timerDone ? '✓' : secondsLeft}
            </div>
          </div>
          <div style={{ fontSize: 11, color: '#6B7280' }}>
            {timerDone ? 'Réflexion terminée' : `Attends ${secondsLeft}s avant de continuer`}
          </div>
        </div>

        {/* Checklist */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Checklist pré-trade
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: progress === 100 ? '#22C759' : '#FF9500', fontFamily: 'JetBrains Mono' }}>
              {checkedCount}/{CHECKLIST.length}
            </span>
          </div>

          {/* Progress bar */}
          <div style={{ height: 3, borderRadius: 99, background: 'rgba(255,255,255,0.06)', marginBottom: 10, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 99,
              background: progress === 100 ? '#22C759' : '#00E5FF',
              width: `${progress}%`,
              transition: 'width 0.2s, background 0.2s',
            }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {CHECKLIST.map(item => (
              <button
                key={item.id}
                onClick={() => toggle(item.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                  background: checked[item.id] ? 'rgba(34,199,89,0.08)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${checked[item.id] ? 'rgba(34,199,89,0.25)' : 'rgba(255,255,255,0.06)'}`,
                  transition: 'all 0.15s', textAlign: 'left',
                }}
              >
                <div style={{
                  width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                  background: checked[item.id] ? '#22C759' : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${checked[item.id] ? '#22C759' : 'rgba(255,255,255,0.1)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, color: '#0D1117', fontWeight: 700,
                  transition: 'all 0.15s',
                }}>
                  {checked[item.id] ? '✓' : ''}
                </div>
                <span style={{ fontSize: 12, color: checked[item.id] ? '#C5C8D6' : '#8E8E93', lineHeight: 1.4 }}>
                  {item.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Boutons */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: '10px', borderRadius: 10, cursor: 'pointer',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              color: '#6B7280', fontSize: 13, fontWeight: 600,
            }}
          >
            ✗ Annuler le trade
          </button>
          <button
            onClick={canProceed ? onConfirm : undefined}
            disabled={!canProceed}
            style={{
              flex: 2, padding: '10px', borderRadius: 10,
              cursor: canProceed ? 'pointer' : 'not-allowed',
              background: canProceed ? 'rgba(34,199,89,0.15)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${canProceed ? 'rgba(34,199,89,0.4)' : 'rgba(255,255,255,0.06)'}`,
              color: canProceed ? '#22C759' : '#3A3F4B',
              fontSize: 13, fontWeight: 700,
              transition: 'all 0.2s',
            }}
          >
            {!timerDone
              ? `⏳ Attends ${secondsLeft}s…`
              : !allChecked
                ? `☑ Coche toutes les cases (${checkedCount}/${CHECKLIST.length})`
                : '✓ Je suis prêt — Continuer'
            }
          </button>
        </div>
      </div>
    </div>
  )
}
