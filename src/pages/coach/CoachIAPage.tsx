// src/pages/coach/CoachIAPage.tsx
// Coach IA TradeMindset — UI complète, API non couplée (coming soon)

import { useState, useRef, useEffect } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

type BiasType = 'fomo' | 'revenge' | 'overconfidence' | 'loss_aversion' | 'discipline'

const BIAS_CONFIG: Record<BiasType, { label: string; color: string; icon: string }> = {
  fomo:           { label: 'FOMO',           color: '#FF6B35', icon: '🔥' },
  revenge:        { label: 'Revenge Trade',  color: '#FF3B5C', icon: '⚡' },
  overconfidence: { label: 'Surconfiance',   color: '#FF9500', icon: '🎯' },
  loss_aversion:  { label: 'Aversion Perte', color: '#BF5AF2', icon: '😰' },
  discipline:     { label: 'Discipline',     color: '#22C759', icon: '✅' },
}

const QUICK_PROMPTS = [
  { label: '🔍 Analyse mes biais',       prompt: 'Analyse mes derniers trades et identifie mes biais comportementaux récurrents.' },
  { label: '📊 Mon Win Rate',            prompt: 'Donne-moi une analyse de mon win rate et comment l\'améliorer.' },
  { label: '🎯 Discipline ce mois',      prompt: 'Comment évalues-tu ma discipline de trading ce mois-ci ?' },
  { label: '💡 Conseil du jour',         prompt: 'Donne-moi un conseil personnalisé basé sur mon historique.' },
  { label: '⚡ Revenge trading ?',       prompt: 'Est-ce que je fais du revenge trading ?' },
  { label: '🛡️ Gestion du risque',      prompt: 'Analyse ma gestion du risque et dis-moi ce que je dois améliorer.' },
]

const FEATURES = [
  { icon: '🧠', title: 'Mémoire persistante', desc: 'Le coach se souvient de toi entre chaque session — profil, biais, objectifs.' },
  { icon: '📈', title: 'Analyse comportementale', desc: 'Détection automatique de FOMO, revenge trading, surconfiance et aversion à la perte.' },
  { icon: '🎯', title: 'Conseils personnalisés', desc: 'Basés sur tes 30 derniers trades réels, pas des conseils génériques.' },
  { icon: '⚡', title: 'Réponses ultra-rapides', desc: 'Propulsé par un modèle IA de pointe, optimisé pour le trading.' },
]

// ── Component ────────────────────────────────────────────────────────────────

export default function CoachIAPage() {
  const [input, setInput] = useState('')
  const [hovered, setHovered] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--tm-bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 24px',
      position: 'relative',
      overflow: 'hidden',
    }}>

      {/* Background glow */}
      <div style={{
        position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)',
        width: 600, height: 600, borderRadius: '50%',
        background: 'radial-gradient(circle, #BF5AF215 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: '10%', right: '10%',
        width: 300, height: 300, borderRadius: '50%',
        background: 'radial-gradient(circle, #0A85FF10 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 700 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 20, margin: '0 auto 20px',
            background: 'linear-gradient(135deg, #BF5AF222, #0A85FF22)',
            border: '1px solid #BF5AF244',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 32,
            boxShadow: '0 0 40px #BF5AF230',
          }}>
            🧠
          </div>

          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '5px 14px', borderRadius: 99, marginBottom: 16,
            background: 'linear-gradient(135deg, #BF5AF218, #0A85FF18)',
            border: '1px solid #BF5AF244',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#BF5AF2', display: 'inline-block', animation: 'pulse-dot 2s infinite' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#BF5AF2', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Coming Soon
            </span>
          </div>

          <h1 style={{
            fontSize: 36, fontWeight: 800, margin: '0 0 12px',
            fontFamily: 'Syne, sans-serif', letterSpacing: '-0.02em',
            background: 'linear-gradient(135deg, #fff 30%, #BF5AF2)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            Coach IA
          </h1>
          <p style={{ fontSize: 16, color: 'var(--tm-text-secondary)', lineHeight: 1.6, maxWidth: 480, margin: '0 auto' }}>
            Ton coach personnel en psychologie du trading.<br />
            Il analyse tes <strong style={{ color: 'var(--tm-text-primary)' }}>biais comportementaux</strong>, se souvient de toi et t'aide à progresser.
          </p>
        </div>

        {/* Chat preview (disabled) */}
        <div style={{
          background: '#0D1117',
          border: '1px solid var(--tm-border)',
          borderRadius: 20,
          overflow: 'hidden',
          marginBottom: 32,
          opacity: 0.85,
        }}>

          {/* Chat header */}
          <div style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--tm-border)',
            display: 'flex', alignItems: 'center', gap: 12,
            background: '#161B22',
          }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #BF5AF222, #0A85FF22)', border: '1px solid #BF5AF244', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
              🧠
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-primary)' }}>Coach IA</div>
              <div style={{ fontSize: 11, color: '#BF5AF2' }}>Bientôt disponible</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#FF3B5C30' }} />
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#FF950030' }} />
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22C75930' }} />
            </div>
          </div>

          {/* Fake messages */}
          <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Assistant message */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #BF5AF222, #0A85FF22)', border: '1px solid #BF5AF433', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
                🧠
              </div>
              <div style={{ maxWidth: '75%' }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  {(['fomo', 'revenge'] as BiasType[]).map(b => (
                    <span key={b} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: `${BIAS_CONFIG[b].color}22`, border: `1px solid ${BIAS_CONFIG[b].color}44`, color: BIAS_CONFIG[b].color, fontWeight: 600 }}>
                      {BIAS_CONFIG[b].icon} {BIAS_CONFIG[b].label}
                    </span>
                  ))}
                </div>
                <div style={{ padding: '12px 16px', borderRadius: '4px 16px 16px 16px', background: '#161B22', border: '1px solid var(--tm-border)', fontSize: 13, color: 'var(--tm-text-primary)', lineHeight: 1.6 }}>
                  J'ai analysé tes <strong>23 derniers trades</strong>. Je détecte un pattern de <strong style={{ color: '#FF6B35' }}>FOMO</strong> récurrent — tu entres en position après une forte bougie haussière 67% du temps. Ta discipline s'améliore sur les stops, mais le sizing après une perte est problématique.
                </div>
                <div style={{ fontSize: 10, color: 'var(--tm-text-muted)', marginTop: 4 }}>14:32</div>
              </div>
            </div>

            {/* User message */}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ maxWidth: '65%' }}>
                <div style={{ padding: '12px 16px', borderRadius: '16px 16px 4px 16px', background: 'linear-gradient(135deg, #0A85FF, #0066CC)', fontSize: 13, color: '#fff', lineHeight: 1.6 }}>
                  Comment je peux corriger ça ?
                </div>
                <div style={{ fontSize: 10, color: 'var(--tm-text-muted)', marginTop: 4, textAlign: 'right' }}>14:33</div>
              </div>
            </div>

            {/* Blurred assistant reply */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', filter: 'blur(4px)', userSelect: 'none' }}>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #BF5AF222, #0A85FF22)', border: '1px solid #BF5AF433', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>🧠</div>
              <div style={{ padding: '12px 16px', borderRadius: '4px 16px 16px 16px', background: '#161B22', border: '1px solid var(--tm-border)', fontSize: 13, color: 'var(--tm-text-primary)', lineHeight: 1.6, maxWidth: '75%' }}>
                Règle 1 : ne jamais entrer sur une bougie qui vient de faire +3%...
              </div>
            </div>
          </div>

          {/* Quick prompts */}
          <div style={{ padding: '0 20px 16px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {QUICK_PROMPTS.slice(0, 3).map(qp => (
              <div key={qp.label} style={{ padding: '6px 12px', borderRadius: 20, border: '1px solid var(--tm-border)', background: 'transparent', color: 'var(--tm-text-muted)', fontSize: 11, opacity: 0.5 }}>
                {qp.label}
              </div>
            ))}
          </div>

          {/* Input (disabled) */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--tm-border)', display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ flex: 1, background: '#161B22', border: '1px solid var(--tm-border)', borderRadius: 12, padding: '10px 14px', fontSize: 13, color: 'var(--tm-text-muted)' }}>
              Pose une question à ton Coach IA...
            </div>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: '#1E2330', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: 'var(--tm-text-muted)' }}>
              ↑
            </div>
          </div>
        </div>

        {/* Features grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 32 }}>
          {FEATURES.map(f => (
            <div
              key={f.title}
              style={{
                background: hovered === f.title ? '#161B22' : '#0D1117',
                border: `1px solid ${hovered === f.title ? '#BF5AF244' : 'var(--tm-border)'}`,
                borderRadius: 14, padding: '16px',
                transition: 'all 0.2s',
                cursor: 'default',
              }}
              onMouseEnter={() => setHovered(f.title)}
              onMouseLeave={() => setHovered(null)}
            >
              <div style={{ fontSize: 22, marginBottom: 8 }}>{f.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tm-text-primary)', marginBottom: 4 }}>{f.title}</div>
              <div style={{ fontSize: 12, color: 'var(--tm-text-secondary)', lineHeight: 1.5 }}>{f.desc}</div>
            </div>
          ))}
        </div>

        {/* Notify CTA */}
        <div style={{
          background: 'linear-gradient(135deg, #BF5AF210, #0A85FF10)',
          border: '1px solid #BF5AF230',
          borderRadius: 16, padding: '24px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--tm-text-primary)', marginBottom: 6 }}>
            🚀 Bientôt disponible pour tous les utilisateurs
          </div>
          <div style={{ fontSize: 13, color: 'var(--tm-text-secondary)', marginBottom: 16 }}>
            Le Coach IA sera disponible en priorité pour les membres Pro.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            {(['FOMO', 'Revenge', 'Discipline', 'Risk', 'Mindset'].map(tag => (
              <span key={tag} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 99, background: '#BF5AF215', border: '1px solid #BF5AF230', color: '#BF5AF2', fontWeight: 600 }}>
                {tag}
              </span>
            )))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.8); }
        }
      `}</style>
    </div>
  )
}
