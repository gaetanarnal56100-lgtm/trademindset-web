import React, { useState, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const { i18n } = useTranslation()
  const [expanded, setExpanded]           = useState(false)
  const [recentSignals, setRecentSignals] = useState<string[]>([])
  const [panelPos, setPanelPos]           = useState({ top: 0, left: 0 })
  const cardRef = useRef<HTMLDivElement>(null)

  // ── Abonnement au signalService ──────────────────────────────────────────
  useEffect(() => {
    const unsub = signalService.subscribe(sig => {
      if (sig?.type) setRecentSignals(prev => [sig.type, ...prev].slice(0, 5))
    })
    setRecentSignals(signalService.getHistory().slice(0, 5).map(s => s.type))
    return unsub
  }, [])

  // ── Position du panel au moment de l'ouverture ───────────────────────────
  const handleToggle = () => {
    if (!expanded && cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect()
      setPanelPos({ top: rect.bottom + window.scrollY + 6, left: rect.left + window.scrollX })
    }
    setExpanded(e => !e)
  }

  // ── Fermeture au clic extérieur ──────────────────────────────────────────
  useEffect(() => {
    if (!expanded) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      // fermer si clic hors de la carte ET hors du panel portal
      const panelEl = document.getElementById('decision-assistant-panel')
      const inCard  = cardRef.current?.contains(target)
      const inPanel = panelEl?.contains(target)
      if (!inCard && !inPanel) setExpanded(false)
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
    ouExcess, ouRegime, ouZ, vmcStatus, confluenceSignal,
    whalePressure:   pressure?.score ?? 0,
    liqBias:         liqLong1h - liqShort1h,
    isCrypto, recentSignals,
    lang:            i18n.language,
  }
  const out = computeDecision(inputs)
  const clr = out.biasColor

  // ── Panel (rendu via portal pour éviter les problèmes de z-index) ────────
  const panel = expanded ? ReactDOM.createPortal(
    <div
      id="decision-assistant-panel"
      style={{
        position: 'absolute',
        top: panelPos.top,
        left: panelPos.left,
        zIndex: 9999,
        minWidth: 310,
        background: 'rgba(8,12,20,0.98)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: `1px solid ${clr}30`,
        borderRadius: 14,
        padding: '14px 16px',
        boxShadow: `0 12px 40px rgba(0,0,0,0.7), 0 0 24px ${clr}15`,
      }}
    >
      {/* Header */}
      <div style={{
        fontSize: 9, fontWeight: 800, color: 'rgba(143,148,163,0.4)',
        letterSpacing: '0.1em', textTransform: 'uppercase',
        fontFamily: 'JetBrains Mono, monospace', marginBottom: 12,
      }}>
        {t('analyse.decision.title')}
      </div>

      {/* Grille raisons / risques */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* Pourquoi */}
        <div>
          <div style={{
            fontSize: 9, color: 'rgba(143,148,163,0.5)', fontFamily: 'JetBrains Mono, monospace',
            marginBottom: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>{t('analyse.decision.why')}</div>
          {out.reasons.length > 0
            ? out.reasons.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 5 }}>
                  <span style={{ color: '#34C759', fontSize: 10, lineHeight: 1.5, flexShrink: 0 }}>✔</span>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.78)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.5 }}>{r}</span>
                </div>
              ))
            : <span style={{ fontSize: 10, color: 'rgba(143,148,163,0.4)', fontFamily: 'JetBrains Mono, monospace' }}>{t('analyse.decision.noData')}</span>
          }
        </div>

        {/* Risques */}
        <div>
          <div style={{
            fontSize: 9, color: 'rgba(143,148,163,0.5)', fontFamily: 'JetBrains Mono, monospace',
            marginBottom: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>{t('analyse.decision.risks')}</div>
          {out.risks.length > 0
            ? out.risks.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 5 }}>
                  <span style={{ color: '#FF9500', fontSize: 10, lineHeight: 1.5, flexShrink: 0 }}>⚠</span>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.78)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.5 }}>{r}</span>
                </div>
              ))
            : <span style={{ fontSize: 10, color: '#34C759', fontFamily: 'JetBrains Mono, monospace' }}>✔ {t('analyse.decision.noAlert')}</span>
          }
        </div>
      </div>

      {/* Barre de score */}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <span style={{ fontSize: 9, color: '#FF3B3090', fontFamily: 'JetBrains Mono, monospace' }}>BEARISH</span>
          <span style={{ fontSize: 9, color: 'rgba(143,148,163,0.4)', fontFamily: 'JetBrains Mono, monospace' }}>{out.score}/100</span>
          <span style={{ fontSize: 9, color: '#34C75990', fontFamily: 'JetBrains Mono, monospace' }}>BULLISH</span>
        </div>
        <div style={{ height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 2, position: 'relative', overflow: 'visible' }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, height: '100%', width: `${out.score}%`,
            background: 'linear-gradient(90deg, #FF3B30 0%, #FF9500 50%, #34C759 100%)',
            borderRadius: 2, transition: 'width 0.5s cubic-bezier(0.4,0,0.2,1)',
          }} />
          <div style={{
            position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)',
            left: `${out.score}%`, width: 8, height: 8, borderRadius: '50%',
            background: clr, border: '2px solid #080C14',
            transition: 'left 0.5s cubic-bezier(0.4,0,0.2,1)',
            boxShadow: `0 0 6px ${clr}80`,
          }} />
        </div>
      </div>
    </div>,
    document.body
  ) : null

  // ── Tradeable styles (matched to TradePlanCard thresholds) ─────────────
  // Strength = how far from neutral 50; works for both bull and bear bias
  // Position is loose (small directional lean ok), Scalp needs strong alignment
  const strength = Math.abs(out.score - 50) * 2  // 0..100
  const styleDefs = [
    { id: 'pos',   emoji: '🏔️', label: 'Position', threshold:  8, color: '#FF9500' },
    { id: 'swing', emoji: '📈', label: 'Swing',    threshold: 18, color: '#34C759' },
    { id: 'day',   emoji: '🌅', label: 'Day',      threshold: 32, color: '#0A85FF' },
    { id: 'scalp', emoji: '⚡', label: 'Scalp',    threshold: 50, color: '#BF5AF2' },
  ] as const
  const tradeableStyles = styleDefs.map(s => ({ ...s, active: strength >= s.threshold }))

  // ── Circular 270° gauge with gap at bottom ───────────────────────────────
  const w = 88, h = 88
  const cx = w / 2, cy = h / 2
  const r = 36          // outer radius (zone arcs)
  const rIn = 22        // inner radius — needle starts here so it doesn't cross score
  const toRad = (deg: number) => (deg * Math.PI) / 180
  // y-flipped: 90° = TOP, 0° = RIGHT, 180° = LEFT, 270° = BOTTOM
  const pt = (deg: number, rad = r) => ({
    x: cx + rad * Math.cos(toRad(deg)),
    y: cy - rad * Math.sin(toRad(deg)),
  })
  const arcSeg = (a1: number, a2: number) => {
    const s = pt(a1), e = pt(a2)
    return `M ${s.x} ${s.y} A ${r} ${r} 0 0 1 ${e.x} ${e.y}`
  }
  // Gauge spans 270°: 225° (bottom-left) → 90° (top) → -45° (bottom-right)
  const score01 = Math.max(0, Math.min(100, out.score)) / 100
  const needleAngle = 225 - 270 * score01
  const np  = pt(needleAngle)            // needle outer tip
  const npI = pt(needleAngle, rIn)       // needle inner start
  const z1 = arcSeg(225, 117)   // red
  const z2 = arcSeg(117,  63)   // orange
  const z3 = arcSeg( 63, -45)   // green

  return (
    <>
      {/* ── Carte compacte ────────────────────────────────────────────────── */}
      <div
        ref={cardRef}
        onClick={handleToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 12px 8px 10px',
          background: 'rgba(13,17,35,0.7)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: `1px solid ${clr}35`,
          borderRadius: 14,
          boxShadow: `0 0 16px ${clr}12`,
          cursor: 'pointer',
          userSelect: 'none',
          minWidth: 220,
          transition: 'border-color 0.3s, box-shadow 0.3s',
        }}
      >
        {/* ── 270° circular gauge ── */}
        <div style={{ position: 'relative', width: w, height: h, flexShrink: 0 }}>
          <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
            {/* 3 colored zones */}
            <path d={z1} fill="none" stroke="#FF3B3080" strokeWidth={6} strokeLinecap="round" />
            <path d={z2} fill="none" stroke="#FF950080" strokeWidth={6} strokeLinecap="round" />
            <path d={z3} fill="none" stroke="#34C75980" strokeWidth={6} strokeLinecap="round" />
            {/* Needle line — from inner radius (no overlap with score) to outer tip */}
            <line x1={npI.x} y1={npI.y} x2={np.x} y2={np.y} stroke={clr} strokeWidth={2.5} strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 4px ${clr}90)` }} />
            {/* Needle tip */}
            <circle cx={np.x} cy={np.y} r={3.5} fill={clr} style={{ filter: `drop-shadow(0 0 5px ${clr})` }} />
            {/* Score centered (no overlap now) */}
            <text x={cx} y={cy + 2} textAnchor="middle" fontFamily="JetBrains Mono, monospace"
              fontSize="22" fontWeight="900" fill={clr}
              style={{ filter: `drop-shadow(0 0 6px ${clr}70)` }}>{out.score}</text>
            <text x={cx} y={cy + 14} textAnchor="middle" fontFamily="JetBrains Mono, monospace"
              fontSize="8" fontWeight="600" fill="rgba(143,148,163,0.55)">/100</text>
          </svg>
        </div>

        {/* ── Infos droite ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Biais + readiness */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: clr, fontFamily: 'Syne, sans-serif', letterSpacing: '0.02em' }}>
              ● {out.bias}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, color: out.readinessColor, fontFamily: 'JetBrains Mono, monospace', marginLeft: 'auto', flexShrink: 0 }}>
              {out.readinessEmoji} {out.readiness}
            </span>
          </div>
          {/* Résumé compact */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 5 }}>
            {out.summary.map((s, i) => (
              <span key={i} style={{ fontSize: 9, color: 'rgba(143,148,163,0.55)', fontFamily: 'JetBrains Mono, monospace' }}>
                {i > 0 ? '· ' : ''}{s}
              </span>
            ))}
          </div>
          {/* Modes tradables */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {tradeableStyles.map(s => (
              <span key={s.id} style={{
                fontSize: 9, fontWeight: 700,
                fontFamily: 'JetBrains Mono, monospace',
                padding: '2px 6px', borderRadius: 6,
                background: s.active ? `${s.color}20` : 'rgba(255,255,255,0.03)',
                border: `1px solid ${s.active ? `${s.color}50` : 'rgba(255,255,255,0.06)'}`,
                color: s.active ? s.color : 'rgba(143,148,163,0.3)',
                opacity: s.active ? 1 : 0.55,
                lineHeight: 1.2, letterSpacing: '0.02em',
              }}>
                <span style={{ fontSize: 8 }}>{s.emoji}</span> {s.label}
              </span>
            ))}
          </div>
        </div>

        {/* Flèche toggle */}
        <div style={{
          fontSize: 9, color: 'rgba(143,148,163,0.45)',
          transform: expanded ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.2s', flexShrink: 0, marginLeft: 4,
        }}>▼</div>
      </div>

      {/* Panel rendu via portal → toujours au-dessus de tout */}
      {panel}
    </>
  )
}
