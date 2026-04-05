// src/pages/landing/LandingPage.tsx
import { Link } from 'react-router-dom'

const FEATURES = [
  {
    icon: '📓',
    title: 'Journal de Trading IA',
    desc: 'Enregistrez chaque trade avec vos émotions. Notre IA analyse vos patterns comportementaux et identifie les biais qui plombent vos performances.',
    accent: '#00E5FF',
  },
  {
    icon: '🧠',
    title: 'Coach Comportemental',
    desc: "Recevez des insights personnalisés sur votre psychologie de trading. Détectez la discipline, la peur et l'euphorie avant qu'elles ne coûtent cher.",
    accent: '#BF5AF2',
  },
  {
    icon: '🏆',
    title: 'Gamification & XP',
    desc: 'Progressez, débloquez des badges, enchaînez les streaks. Chaque bonne prédiction, chaque journal complété vous rapproche du rang Légende.',
    accent: '#FFD60A',
  },
  {
    icon: '🎯',
    title: 'Predict & Earn',
    desc: 'Prédisez les prix des cryptos, comparez avec la communauté et gagnez de l\'XP pour chaque prédiction correcte. Oracle en herbe ?',
    accent: '#30D158',
  },
  {
    icon: '📊',
    title: 'Analyse Avancée',
    desc: 'Win rate, expectancy, profit factor, drawdown max — tous vos KPIs en temps réel, visualisés avec des graphiques interactifs.',
    accent: '#FF9F0A',
  },
  {
    icon: '🌍',
    title: 'Marchés & Alertes',
    desc: 'Suivez crypto et actions en temps réel, configurez des alertes de prix et ne manquez plus aucune opportunité de marché.',
    accent: '#FF6B6B',
  },
]

const SOCIAL_PROOF = [
  { stat: '2 000+', label: 'Traders actifs' },
  { stat: '150 000+', label: 'Trades journalisés' },
  { stat: '4.9/5', label: 'Note moyenne' },
  { stat: '37%', label: "d'amélioration moyenne du win rate" },
]

export default function LandingPage() {
  return (
    <div style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* ── HERO ── */}
      <section style={{
        position: 'relative', overflow: 'hidden',
        minHeight: '90vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center',
        padding: '80px 24px',
      }}>
        {/* Background glows */}
        <div style={{ position: 'absolute', top: '10%', left: '50%', transform: 'translateX(-50%)', width: 700, height: 400, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(0,229,255,0.06) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: '5%', left: '20%', width: 400, height: 300, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(191,90,242,0.05) 0%, transparent 70%)', pointerEvents: 'none' }} />

        {/* Grid pattern */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.03,
          backgroundImage: 'linear-gradient(var(--tm-border) 1px, transparent 1px), linear-gradient(90deg, var(--tm-border) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }} />

        <div style={{ position: 'relative', maxWidth: 760, margin: '0 auto' }}>
          {/* Badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '5px 14px', borderRadius: 99,
            background: 'rgba(0,229,255,0.08)',
            border: '1px solid rgba(0,229,255,0.2)',
            marginBottom: 28,
            fontSize: 12, fontWeight: 600, color: 'var(--tm-accent)',
            letterSpacing: '0.04em',
          }}>
            <span>✦</span>
            <span>Journal de trading professionnel</span>
          </div>

          <h1 style={{
            fontSize: 'clamp(38px, 6vw, 68px)',
            fontWeight: 800,
            lineHeight: 1.08,
            letterSpacing: '-0.03em',
            fontFamily: 'Syne, sans-serif',
            color: 'var(--tm-text-primary)',
            marginBottom: 24,
          }}>
            Journalisez.{' '}
            <span style={{
              background: 'linear-gradient(135deg, #00E5FF, #0A85FF)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>Analysez.</span>
            {' '}Progressez.
          </h1>

          <p style={{
            fontSize: 18, lineHeight: 1.7,
            color: 'var(--tm-text-secondary)',
            maxWidth: 560, margin: '0 auto 40px',
          }}>
            TradeMindset combine le journal de trading, l'analyse comportementale par IA et la gamification pour transformer vos habitudes et booster vos performances.
          </p>

          {/* CTA buttons */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/signup" style={{
              textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '14px 32px',
              borderRadius: 10,
              fontSize: 15, fontWeight: 700,
              color: '#0a0e17',
              background: 'linear-gradient(135deg, #00E5FF, #0A85FF)',
              boxShadow: '0 0 30px rgba(0,229,255,0.25)',
              transition: 'all 0.2s',
            }}>
              Commencer gratuitement
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </Link>
            <Link to="/login" style={{
              textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '14px 28px',
              borderRadius: 10,
              fontSize: 15, fontWeight: 500,
              color: 'var(--tm-text-primary)',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid var(--tm-border)',
            }}>
              Se connecter
            </Link>
          </div>

          <p style={{ marginTop: 20, fontSize: 12, color: 'var(--tm-text-muted)' }}>
            Gratuit · Aucune carte bancaire requise · Données sécurisées
          </p>
        </div>
      </section>

      {/* ── SOCIAL PROOF BANDEAU ── */}
      <section style={{
        borderTop: '1px solid var(--tm-border)',
        borderBottom: '1px solid var(--tm-border)',
        padding: '32px 24px',
        background: 'rgba(255,255,255,0.015)',
      }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: 24 }}>
          {SOCIAL_PROOF.map(({ stat, label }) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--tm-accent)', fontFamily: 'Syne, sans-serif', letterSpacing: '-0.02em' }}>{stat}</div>
              <div style={{ fontSize: 12, color: 'var(--tm-text-muted)', marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section style={{ padding: '100px 24px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tm-accent)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Fonctionnalités</div>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, fontFamily: 'Syne, sans-serif', letterSpacing: '-0.02em', color: 'var(--tm-text-primary)', lineHeight: 1.15 }}>
            Tout ce dont un trader sérieux a besoin
          </h2>
          <p style={{ fontSize: 16, color: 'var(--tm-text-secondary)', marginTop: 16, maxWidth: 520, margin: '16px auto 0' }}>
            De la prise de trade à l'analyse comportementale, TradeMindset couvre l'intégralité de votre workflow.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
          {FEATURES.map(({ icon, title, desc, accent }) => (
            <div key={title} style={{
              padding: '28px 24px',
              borderRadius: 14,
              background: 'rgba(255,255,255,0.025)',
              border: '1px solid var(--tm-border)',
              transition: 'border-color 0.2s, transform 0.2s',
              cursor: 'default',
            }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = `${accent}44`; el.style.transform = 'translateY(-2px)' }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'var(--tm-border)'; el.style.transform = 'translateY(0)' }}
            >
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: `${accent}15`,
                border: `1px solid ${accent}30`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22, marginBottom: 16,
              }}>{icon}</div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--tm-text-primary)', marginBottom: 8, fontFamily: 'Syne, sans-serif' }}>{title}</h3>
              <p style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--tm-text-secondary)' }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section style={{
        padding: '80px 24px',
        background: 'rgba(255,255,255,0.015)',
        borderTop: '1px solid var(--tm-border)',
        borderBottom: '1px solid var(--tm-border)',
      }}>
        <div style={{ maxWidth: 900, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tm-accent)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Comment ça marche</div>
          <h2 style={{ fontSize: 'clamp(26px, 3.5vw, 38px)', fontWeight: 800, fontFamily: 'Syne, sans-serif', letterSpacing: '-0.02em', color: 'var(--tm-text-primary)', marginBottom: 56 }}>
            De la prise de trade à la progression, en 3 étapes
          </h2>
          <div style={{ display: 'flex', gap: 0, justifyContent: 'center', flexWrap: 'wrap' }}>
            {[
              { num: '01', title: 'Journalisez vos trades', desc: "Saisissez chaque trade avec votre état émotionnel, votre setup et vos notes. L'IA analyse immédiatement." },
              { num: '02', title: "Recevez des insights IA", desc: 'Biais détectés, patterns récurrents, corrélation émotion–performance : comprenez pourquoi vous perdez (ou gagnez).' },
              { num: '03', title: 'Progressez & Gagnez de l\'XP', desc: 'Chaque action récompensée : badges, niveaux, streaks. La progression visible motive à tenir la discipline.' },
            ].map(({ num, title, desc }, i) => (
              <div key={num} style={{ flex: '1 1 240px', padding: '0 24px', position: 'relative', marginBottom: 32 }}>
                {i < 2 && (
                  <div style={{ position: 'absolute', top: 16, right: 0, width: '40%', height: 1, background: 'linear-gradient(90deg, var(--tm-border), transparent)', display: 'none' }} />
                )}
                <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(0,229,255,0.08)', border: '1px solid rgba(0,229,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 16, fontWeight: 800, color: 'var(--tm-accent)', fontFamily: 'Syne, sans-serif' }}>{num}</div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--tm-text-primary)', marginBottom: 8 }}>{title}</h3>
                <p style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--tm-text-secondary)' }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section style={{ padding: '100px 24px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 600, height: 300, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(0,229,255,0.07) 0%, transparent 70%)', pointerEvents: 'none' }} />

        <div style={{ position: 'relative', maxWidth: 600, margin: '0 auto' }}>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 46px)', fontWeight: 800, fontFamily: 'Syne, sans-serif', letterSpacing: '-0.025em', lineHeight: 1.12, color: 'var(--tm-text-primary)', marginBottom: 20 }}>
            Prêt à trader{' '}
            <span style={{ background: 'linear-gradient(135deg, #00E5FF, #BF5AF2)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              avec discipline ?
            </span>
          </h2>
          <p style={{ fontSize: 16, color: 'var(--tm-text-secondary)', lineHeight: 1.7, marginBottom: 36 }}>
            Rejoignez 2 000+ traders qui utilisent TradeMindset pour comprendre leurs patterns, corriger leurs biais et progresser chaque semaine.
          </p>
          <Link to="/signup" style={{
            textDecoration: 'none',
            display: 'inline-flex', alignItems: 'center', gap: 10,
            padding: '16px 40px',
            borderRadius: 12,
            fontSize: 16, fontWeight: 700,
            color: '#0a0e17',
            background: 'linear-gradient(135deg, #00E5FF, #0A85FF)',
            boxShadow: '0 0 40px rgba(0,229,255,0.3)',
          }}>
            Créer mon compte gratuit
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </Link>
          <p style={{ marginTop: 16, fontSize: 12, color: 'var(--tm-text-muted)' }}>Gratuit · Sans engagement · Données 100% privées</p>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{
        borderTop: '1px solid var(--tm-border)',
        padding: '28px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--tm-accent)" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
            <polyline points="16 7 22 7 22 13" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-primary)', fontFamily: 'Syne, sans-serif' }}>TradeMindset</span>
          <span style={{ fontSize: 11, color: 'var(--tm-text-muted)' }}>© {new Date().getFullYear()}</span>
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          <Link to="/login" style={{ fontSize: 12, color: 'var(--tm-text-muted)', textDecoration: 'none' }}>Se connecter</Link>
          <Link to="/signup" style={{ fontSize: 12, color: 'var(--tm-accent)', textDecoration: 'none', fontWeight: 500 }}>Commencer</Link>
        </div>
      </footer>

    </div>
  )
}
