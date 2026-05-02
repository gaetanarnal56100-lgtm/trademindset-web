import React, { useState, useEffect, useRef } from 'react'
import type { MTFSnapshot } from '@/pages/analyse/MTFDashboard'
import { computeDecision, type DecisionInputs } from '@/services/decision/decisionEngine'
import { signalService } from '@/services/notifications/SignalNotificationService'

interface WhalePressure { score: number; label: string }

interface Props {
  mtfSnap:          MTFSnapshot | null
  pressure:         WhalePressure | null
  liqLong1h:        number
  liqShort1h:       number
  isCrypto:         boolean
  ouExcess:         string
  ouRegime:         string
  ouZ:              number
  vmcStatus:        string
  confluenceSignal: string
}

export default function DecisionAssistant({
  mtfSnap, pressure, liqLong1h, liqShort1h,
  isCrypto, ouExcess, ouRegime, ouZ, vmcStatus, confluenceSignal,
}: Props) {
  const [expanded, setExpanded]           = useState(false)
  const [recentSignals, setRecentSignals] = useState<string[]>([])
  const ref = useRef<HTMLDivElement>(null)

  // ── Abonnement au signalService ──────────────────────────────────────────
  useEffect(() => {
    const unsub = signalService.subscribe(sig => {
      if (sig?.type) setRecentSignals(prev => [sig.type, ...prev].slice(0, 5))
    })
    // Charger l'historique existant
    setRecentSignals(signalService.getHistory().slice(0, 5).map(s => s.type))
    return unsub
  }, [])

  // ── Fermeture au clic extérieur ──────────────────────────────────────────
  useEffect(() => {
    if (!expanded) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setExpanded(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [expanded])

  if (!mtfSnap) return null

  // ── Calcul ───────────────────────────────────────────────────────────────
  const inputs: DecisionInputs = {
    mtfScore:        mtfSnap.globalScore,
    mtfConfluence:   mtfSnap.confluence,
    mtfSignal:       mtfSnap.globalSignal,
    ouExcess,
    ouRegime,
    ouZ,
    vmcStatus,
    confluenceSignal,
    whalePressure:   pressure?.score ?? 0,
    liqBias:         liqLong1h - liqShort1h,
    isCrypto,
    recentSignals,
  }
  const out = computeDecision(inputs)
  const clr = out.biasColor

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* ── Carte compacte ────────────────────────────────────────────── */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 14px',
          background: 'rgba(13,17,35,0.7)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: `1px solid ${clr}30`,
          borderRadius: 14,
          boxShadow: `0 0 16px ${clr}12`,
          cursor: 'pointer',
          userSelect: 'none',
          minWidth: 210,
          transition: 'border-color 0.3s, box-shadow 0.3s',
        }}
      >
        {/* Icône */}
        <div style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>🧠</div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Ligne 1 : biais + readiness */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{
              fontSize: 11, fontWeight: 800, color: clr,
              fontFamily: 'Syne, sans-serif', letterSpacing: '0.02em',
            }}>
              ● {out.bias}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700, color: out.readinessColor,
              fontFamily: 'JetBrains Mono, monospace', marginLeft: 'auto', flexShrink: 0,
            }}>
              {out.readinessEmoji} {out.readiness}
            </span>
          </div>

          {/* Ligne 2 : score */}
          <div style={{ marginBottom: 3 }}>
            <span style={{ fontSize: 10, color: 'rgba(143,148,163,0.7)', fontFamily: 'JetBrains Mono, monospace' }}>
              Score{' '}
              <span style={{ color: clr, fontWeight: 700 }}>{out.score}</span>
              /100
            </span>
          </div>

          {/* Ligne 3 : résumé compact */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {out.summary.map((s, i) => (
              <span key={i} style={{
                fontSize: 9, color: 'rgba(143,148,163,0.6)',
                fontFamily: 'JetBrains Mono, monospace',
              }}>
                {i > 0 ? '· ' : ''}{s}
              </span>
            ))}
          </div>
        </div>

        {/* Flèche toggle */}
        <div style={{
          fontSize: 9, color: 'rgba(143,148,163,0.45)',
          transform: expanded ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.2s', flexShrink: 0,
        }}>▼</div>
      </div>

      {/* ── Panel détail (expanded) ─────────────────────────────────────── */}
      {expanded && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 60,
          minWidth: 310,
          background: 'rgba(8,12,20,0.97)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: `1px solid ${clr}25`,
          borderRadius: 14,
          padding: '14px 16px',
          boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 24px ${clr}12`,
        }}>
          {/* Header du panel */}
          <div style={{
            fontSize: 9, fontWeight: 800, color: 'rgba(143,148,163,0.4)',
            letterSpacing: '0.1em', textTransform: 'uppercase',
            fontFamily: 'JetBrains Mono, monospace', marginBottom: 12,
          }}>
            Analyse de décision
          </div>

          {/* Grille raisons / risques */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {/* Pourquoi */}
            <div>
              <div style={{
                fontSize: 9, color: 'rgba(143,148,163,0.5)',
                fontFamily: 'JetBrains Mono, monospace',
                marginBottom: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>
                Pourquoi
              </div>
              {out.reasons.length > 0
                ? out.reasons.map((r, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 5 }}>
                      <span style={{ color: '#34C759', fontSize: 10, lineHeight: 1.5, flexShrink: 0 }}>✔</span>
                      <span style={{
                        fontSize: 10, color: 'rgba(255,255,255,0.78)',
                        fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.5,
                      }}>{r}</span>
                    </div>
                  ))
                : <span style={{ fontSize: 10, color: 'rgba(143,148,163,0.4)', fontFamily: 'JetBrains Mono, monospace' }}>
                    Données insuffisantes
                  </span>
              }
            </div>

            {/* Risques */}
            <div>
              <div style={{
                fontSize: 9, color: 'rgba(143,148,163,0.5)',
                fontFamily: 'JetBrains Mono, monospace',
                marginBottom: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>
                Risques
              </div>
              {out.risks.length > 0
                ? out.risks.map((r, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 5 }}>
                      <span style={{ color: '#FF9500', fontSize: 10, lineHeight: 1.5, flexShrink: 0 }}>⚠</span>
                      <span style={{
                        fontSize: 10, color: 'rgba(255,255,255,0.78)',
                        fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.5,
                      }}>{r}</span>
                    </div>
                  ))
                : <span style={{ fontSize: 10, color: '#34C759', fontFamily: 'JetBrains Mono, monospace' }}>
                    ✔ Pas d'alerte
                  </span>
              }
            </div>
          </div>

          {/* Barre de score */}
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: 9, color: '#FF3B3099', fontFamily: 'JetBrains Mono, monospace' }}>BEARISH</span>
              <span style={{ fontSize: 9, color: 'rgba(143,148,163,0.4)', fontFamily: 'JetBrains Mono, monospace' }}>
                {out.score}/100
              </span>
              <span style={{ fontSize: 9, color: '#34C75999', fontFamily: 'JetBrains Mono, monospace' }}>BULLISH</span>
            </div>
            <div style={{ height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 2, position: 'relative', overflow: 'visible' }}>
              <div style={{
                position: 'absolute', top: 0, left: 0, height: '100%',
                width: `${out.score}%`,
                background: 'linear-gradient(90deg, #FF3B30 0%, #FF9500 50%, #34C759 100%)',
                borderRadius: 2,
                transition: 'width 0.5s cubic-bezier(0.4,0,0.2,1)',
              }} />
              <div style={{
                position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)',
                left: `${out.score}%`,
                width: 8, height: 8, borderRadius: '50%',
                background: clr, border: '2px solid #080C14',
                transition: 'left 0.5s cubic-bezier(0.4,0,0.2,1)',
                boxShadow: `0 0 6px ${clr}80`,
              }} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
