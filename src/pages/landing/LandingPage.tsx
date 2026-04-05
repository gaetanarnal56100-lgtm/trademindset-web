// src/pages/landing/LandingPage.tsx
import { Link } from 'react-router-dom'

// ── Mock dashboard card ───────────────────────────────────────
function MockDashboard() {
  const trades = [
    { sym: 'BTC/USDT', side: 'LONG', pnl: +248.50, pct: +3.12 },
    { sym: 'ETH/USDT', side: 'LONG', pnl: -82.00,  pct: -1.45 },
    { sym: 'NVDA',     side: 'LONG', pnl: +615.20, pct: +5.87 },
    { sym: 'SOL/USDT', side: 'SHORT',pnl: +183.00, pct: +2.40 },
    { sym: 'AAPL',     side: 'LONG', pnl: -34.80,  pct: -0.82 },
  ]
  return (
    <div style={{
      background: 'rgba(10,14,23,0.95)',
      border: '1px solid rgba(0,229,255,0.15)',
      borderRadius: 16,
      padding: '16px',
      boxShadow: '0 0 60px rgba(0,229,255,0.08), 0 40px 80px rgba(0,0,0,0.6)',
      width: '100%',
      maxWidth: 520,
      backdropFilter: 'blur(20px)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Glow top */}
      <div style={{ position: 'absolute', top: -40, left: '50%', transform: 'translateX(-50%)', width: 300, height: 100, background: 'radial-gradient(ellipse, rgba(0,229,255,0.12) 0%, transparent 70%)', pointerEvents: 'none' }} />

      {/* Header strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#FF5F57' }} />
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#FFBD2E' }} />
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#28CA41' }} />
        <span style={{ marginLeft: 8, fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: 'JetBrains Mono, monospace' }}>TradeMindset — Dashboard</span>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
        {[
          { label: 'P&L mois', value: '+4 218 $', color: '#4CAF50' },
          { label: 'Win rate', value: '68.4%', color: '#00E5FF' },
          { label: 'Trades', value: '47', color: 'rgba(255,255,255,0.7)' },
          { label: 'Streak', value: '🔥 7', color: '#FFD60A' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '8px 10px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color, fontFamily: 'JetBrains Mono, monospace' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Trade list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {trades.map((t, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'rgba(255,255,255,0.025)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: t.pnl > 0 ? 'rgba(76,175,80,0.12)' : 'rgba(244,67,54,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: t.pnl > 0 ? '#4CAF50' : '#F44336', flexShrink: 0 }}>
              {t.pnl > 0 ? '▲' : '▼'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.8)', fontFamily: 'JetBrains Mono, monospace' }}>{t.sym}</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>{t.side}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: t.pnl > 0 ? '#4CAF50' : '#F44336', fontFamily: 'JetBrains Mono, monospace' }}>
                {t.pnl > 0 ? '+' : ''}{t.pnl.toFixed(2)} $
              </div>
              <div style={{ fontSize: 9, color: t.pct > 0 ? 'rgba(76,175,80,0.7)' : 'rgba(244,67,54,0.7)' }}>
                {t.pct > 0 ? '+' : ''}{t.pct.toFixed(2)}%
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* XP bar mock */}
      <div style={{ marginTop: 12, padding: '8px 10px', background: 'rgba(0,229,255,0.05)', borderRadius: 10, border: '1px solid rgba(0,229,255,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <span style={{ fontSize: 10, color: 'rgba(0,229,255,0.7)', fontWeight: 600 }}>⚡ Niveau 14 — Expert</span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'JetBrains Mono, monospace' }}>2 840 / 3 500 XP</span>
        </div>
        <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: '81%', height: '100%', background: 'linear-gradient(90deg, #00E5FF, #0A85FF)', borderRadius: 3 }} />
        </div>
      </div>
    </div>
  )
}

const FEATURES = [
  {
    icon: '📓',
    title: 'Journal IA',
    desc: 'Enregistrez chaque trade avec vos émotions. L\'IA identifie vos patterns comportementaux et les biais qui coûtent de l\'argent.',
    color: '#00E5FF',
    grad: 'from-cyan',
  },
  {
    icon: '🧠',
    title: 'Analyse comportementale',
    desc: 'FOMO, revenge trading, overconfidence — détectez et corrigez vos biais avant qu\'ils ne frappent.',
    color: '#BF5AF2',
    grad: 'from-purple',
  },
  {
    icon: '📊',
    title: 'Statistiques avancées',
    desc: 'Win rate, expectancy, profit factor, max drawdown — tous vos KPIs sur un seul écran, en temps réel.',
    color: '#FF9F0A',
    grad: 'from-orange',
  },
  {
    icon: '🎯',
    title: 'Predict & Earn',
    desc: 'Prédisez les prix des cryptos, gagnez de l\'XP pour chaque bonne prédiction et montez dans le classement.',
    color: '#30D158',
    grad: 'from-green',
  },
  {
    icon: '🏆',
    title: 'Gamification XP',
    desc: 'Niveaux, badges, streaks, titres. Chaque bonne habitude est récompensée. La discipline devient addictive.',
    color: '#FFD60A',
    grad: 'from-yellow',
  },
  {
    icon: '🌍',
    title: 'Marchés & Alertes',
    desc: 'Suivez cryptos et actions en live, configurez des alertes de prix et ne manquez plus aucun mouvement.',
    color: '#FF6B6B',
    grad: 'from-red',
  },
]

const TESTIMONIALS = [
  {
    quote: "En 3 mois, j'ai augmenté mon win rate de 52% à 71%. L'analyse IA a identifié que je coupais mes winners trop tôt après une perte. Game changer.",
    author: 'Thomas M.',
    role: 'Trader Crypto — 4 ans d\'expérience',
    avatar: 'T',
    color: '#00E5FF',
  },
  {
    quote: "Le journal m'a montré que mes pires trades arrivent le lundi matin. Simple, mais je ne l'aurais jamais vu sans les données. J'évite maintenant de trader ce jour-là.",
    author: 'Sarah K.',
    role: 'Swing trader — Actions US',
    avatar: 'S',
    color: '#BF5AF2',
  },
  {
    quote: "La gamification, c'est exactement ce qu'il me fallait pour tenir la discipline. J'ai 47 jours de streak de journal. Avant, j'abandonnais après une semaine.",
    author: 'Alexis B.',
    role: 'Day trader — Forex & Indices',
    avatar: 'A',
    color: '#FFD60A',
  },
]

export default function LandingPage() {
  return (
    <div style={{ fontFamily: "'Inter', sans-serif", overflowX: 'hidden' }}>

      {/* ── HERO ─────────────────────────────────────────────── */}
      <section style={{
        position: 'relative',
        minHeight: 'calc(100vh - 64px)',
        display: 'flex',
        alignItems: 'center',
        padding: '60px 24px 80px',
        overflow: 'hidden',
      }}>
        {/* Animated background glows */}
        <div style={{ position: 'absolute', top: '5%', left: '-10%', width: 600, height: 500, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(0,229,255,0.07) 0%, transparent 65%)', pointerEvents: 'none', animation: 'pulse1 8s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', bottom: '10%', right: '-5%', width: 500, height: 400, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(191,90,242,0.06) 0%, transparent 65%)', pointerEvents: 'none', animation: 'pulse2 10s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', top: '40%', left: '40%', width: 400, height: 300, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(10,133,255,0.05) 0%, transparent 70%)', pointerEvents: 'none' }} />

        {/* Grid */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.025, backgroundImage: 'linear-gradient(rgba(0,229,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,229,255,1) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />

        <style>{`
          @keyframes pulse1 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(30px,-20px) scale(1.05)} }
          @keyframes pulse2 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-20px,25px) scale(1.08)} }
          @keyframes floatUp { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
        `}</style>

        <div style={{ maxWidth: 1200, margin: '0 auto', width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60, alignItems: 'center' }}>
          {/* Left: copy */}
          <div>
            {/* Badge */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '6px 16px', borderRadius: 99,
              background: 'rgba(0,229,255,0.07)',
              border: '1px solid rgba(0,229,255,0.2)',
              marginBottom: 28, cursor: 'default',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00E5FF', boxShadow: '0 0 6px #00E5FF', display: 'inline-block' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--tm-accent)', letterSpacing: '0.05em' }}>Journal de trading professionnel</span>
            </div>

            <h1 style={{
              fontSize: 'clamp(40px, 5.5vw, 72px)',
              fontWeight: 900,
              lineHeight: 1.05,
              letterSpacing: '-0.035em',
              fontFamily: 'Syne, sans-serif',
              color: 'var(--tm-text-primary)',
              marginBottom: 24,
            }}>
              Journalisez.{' '}
              <br />
              <span style={{
                background: 'linear-gradient(135deg, #00E5FF 0%, #0A85FF 50%, #BF5AF2 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>Analysez.</span>
              {' '}
              <br />
              Progressez.
            </h1>

            <p style={{
              fontSize: 17,
              lineHeight: 1.75,
              color: 'var(--tm-text-secondary)',
              marginBottom: 36,
              maxWidth: 480,
            }}>
              TradeMindset combine journal de trading, analyse comportementale par IA et gamification pour transformer vos habitudes et booster vos performances.
            </p>

            {/* CTA buttons */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
              <Link to="/signup" style={{
                textDecoration: 'none',
                display: 'inline-flex', alignItems: 'center', gap: 10,
                padding: '15px 32px',
                borderRadius: 12,
                fontSize: 15, fontWeight: 700,
                color: '#050810',
                background: 'linear-gradient(135deg, #00E5FF, #0A85FF)',
                boxShadow: '0 0 30px rgba(0,229,255,0.3), 0 8px 24px rgba(10,133,255,0.3)',
              }}>
                Commencer gratuitement
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              </Link>
              <Link to="/login" style={{
                textDecoration: 'none',
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '15px 28px',
                borderRadius: 12,
                fontSize: 15, fontWeight: 500,
                color: 'var(--tm-text-primary)',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
              }}>
                Se connecter
              </Link>
            </div>

            {/* Trust line */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              {['Gratuit', 'Sans carte bancaire', 'Données sécurisées'].map(t => (
                <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4CAF50" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                  <span style={{ fontSize: 12, color: 'var(--tm-text-muted)' }}>{t}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: mock dashboard */}
          <div style={{ display: 'flex', justifyContent: 'center', animation: 'floatUp 6s ease-in-out infinite' }}>
            <MockDashboard />
          </div>
        </div>
      </section>


      {/* ── HOW IT WORKS ─────────────────────────────────────── */}
      <section style={{ padding: '100px 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--tm-accent)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 14 }}>Comment ça marche</div>
            <h2 style={{ fontSize: 'clamp(28px, 4vw, 46px)', fontWeight: 900, fontFamily: 'Syne, sans-serif', letterSpacing: '-0.025em', color: 'var(--tm-text-primary)', lineHeight: 1.1, margin: 0 }}>
              De la prise de trade à la progression,<br />en 3 étapes
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, position: 'relative' }}>
            {/* Connector line */}
            <div style={{ position: 'absolute', top: 36, left: '16.5%', right: '16.5%', height: 1, background: 'linear-gradient(90deg, rgba(0,229,255,0.3), rgba(191,90,242,0.3))', pointerEvents: 'none' }} />

            {[
              { num: '01', title: 'Journalisez vos trades', desc: 'Saisissez chaque trade avec setup, émotion, screenshot. L\'IA analyse immédiatement pour détecter les patterns.', icon: '📝', color: '#00E5FF' },
              { num: '02', title: 'Recevez vos insights IA', desc: 'Biais identifiés, corrélations émotion–P&L, recommandations personnalisées pour votre style de trading.', icon: '🧠', color: '#BF5AF2' },
              { num: '03', title: 'Progressez & Gagnez de l\'XP', desc: 'Badges, niveaux, streaks. Chaque bonne habitude est récompensée. La discipline devient un jeu.', icon: '🏆', color: '#FFD60A' },
            ].map(({ num, title, desc, icon, color }) => (
              <div key={num} style={{ padding: '0 24px', textAlign: 'center', position: 'relative' }}>
                <div style={{
                  width: 72, height: 72, borderRadius: 20,
                  background: `${color}12`,
                  border: `1.5px solid ${color}30`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 20px', fontSize: 28,
                  position: 'relative',
                }}>
                  {icon}
                  <div style={{ position: 'absolute', top: -8, right: -8, width: 22, height: 22, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, color: '#050810', fontFamily: 'Syne, sans-serif' }}>{num.slice(-1)}</div>
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--tm-text-primary)', marginBottom: 10, fontFamily: 'Syne, sans-serif' }}>{title}</h3>
                <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--tm-text-secondary)' }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ─────────────────────────────────────────── */}
      <section style={{
        padding: '80px 24px 100px',
        background: 'rgba(255,255,255,0.012)',
        borderTop: '1px solid var(--tm-border)',
        borderBottom: '1px solid var(--tm-border)',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 60 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--tm-accent)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 14 }}>Fonctionnalités</div>
            <h2 style={{ fontSize: 'clamp(26px, 3.5vw, 42px)', fontWeight: 900, fontFamily: 'Syne, sans-serif', letterSpacing: '-0.025em', color: 'var(--tm-text-primary)', margin: 0 }}>
              Tout ce dont un trader sérieux a besoin
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 16 }}>
            {FEATURES.map(({ icon, title, desc, color }) => (
              <div key={title} style={{
                padding: '24px 22px',
                borderRadius: 16,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.07)',
                transition: 'all 0.2s',
                cursor: 'default',
                position: 'relative',
                overflow: 'hidden',
              }}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLDivElement
                  el.style.borderColor = `${color}35`
                  el.style.background = `${color}06`
                  el.style.transform = 'translateY(-3px)'
                  el.style.boxShadow = `0 12px 40px ${color}12`
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLDivElement
                  el.style.borderColor = 'rgba(255,255,255,0.07)'
                  el.style.background = 'rgba(255,255,255,0.03)'
                  el.style.transform = 'translateY(0)'
                  el.style.boxShadow = 'none'
                }}
              >
                {/* Corner glow */}
                <div style={{ position: 'absolute', top: 0, right: 0, width: 80, height: 80, borderRadius: '50%', background: `radial-gradient(ellipse at top right, ${color}10, transparent)`, pointerEvents: 'none' }} />

                <div style={{
                  width: 46, height: 46, borderRadius: 12,
                  background: `${color}14`,
                  border: `1px solid ${color}25`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 22, marginBottom: 14,
                }}>{icon}</div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--tm-text-primary)', marginBottom: 8, fontFamily: 'Syne, sans-serif' }}>{title}</h3>
                <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--tm-text-secondary)', margin: 0 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ─────────────────────────────────────── */}
      <section style={{ padding: '100px 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 60 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--tm-accent)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 14 }}>Témoignages</div>
            <h2 style={{ fontSize: 'clamp(26px, 3.5vw, 42px)', fontWeight: 900, fontFamily: 'Syne, sans-serif', letterSpacing: '-0.025em', color: 'var(--tm-text-primary)', margin: 0 }}>
              Ce que disent nos traders
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
            {TESTIMONIALS.map(({ quote, author, role, avatar, color }) => (
              <div key={author} style={{
                padding: '28px 24px',
                borderRadius: 16,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.07)',
                display: 'flex', flexDirection: 'column', gap: 20,
              }}>
                {/* Stars */}
                <div style={{ display: 'flex', gap: 3 }}>
                  {[1,2,3,4,5].map(i => <span key={i} style={{ fontSize: 14, color: '#FFD60A' }}>★</span>)}
                </div>
                {/* Quote */}
                <p style={{ fontSize: 14, lineHeight: 1.75, color: 'var(--tm-text-secondary)', margin: 0, flex: 1 }}>
                  «&nbsp;{quote}&nbsp;»
                </p>
                {/* Author */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: `${color}18`,
                    border: `1.5px solid ${color}40`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 15, fontWeight: 700, color, flexShrink: 0,
                    fontFamily: 'Syne, sans-serif',
                  }}>{avatar}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-primary)' }}>{author}</div>
                    <div style={{ fontSize: 11, color: 'var(--tm-text-muted)' }}>{role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ────────────────────────────────────────── */}
      <section style={{
        padding: '100px 24px',
        background: 'rgba(0,229,255,0.02)',
        borderTop: '1px solid rgba(0,229,255,0.08)',
        position: 'relative',
        overflow: 'hidden',
        textAlign: 'center',
      }}>
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 700, height: 350, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(0,229,255,0.06) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', maxWidth: 660, margin: '0 auto' }}>
          <h2 style={{
            fontSize: 'clamp(30px, 4.5vw, 52px)',
            fontWeight: 900,
            fontFamily: 'Syne, sans-serif',
            letterSpacing: '-0.03em',
            lineHeight: 1.1,
            color: 'var(--tm-text-primary)',
            marginBottom: 20,
          }}>
            Prêt à trader avec{' '}
            <span style={{ background: 'linear-gradient(135deg, #00E5FF, #BF5AF2)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              discipline
            </span>
            {' '}?
          </h2>
          <p style={{ fontSize: 17, lineHeight: 1.75, color: 'var(--tm-text-secondary)', marginBottom: 40 }}>
            Rejoignez 2 000+ traders qui améliorent leurs performances chaque semaine grâce à TradeMindset.
          </p>
          <Link to="/signup" style={{
            textDecoration: 'none',
            display: 'inline-flex', alignItems: 'center', gap: 10,
            padding: '18px 44px',
            borderRadius: 14,
            fontSize: 16, fontWeight: 700,
            color: '#050810',
            background: 'linear-gradient(135deg, #00E5FF, #0A85FF)',
            boxShadow: '0 0 50px rgba(0,229,255,0.35), 0 12px 32px rgba(10,133,255,0.3)',
          }}>
            Créer mon compte gratuit
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </Link>
          <p style={{ marginTop: 18, fontSize: 12, color: 'var(--tm-text-muted)' }}>
            Gratuit · Aucune carte bancaire · Données 100% privées
          </p>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────── */}
      <footer style={{
        borderTop: '1px solid var(--tm-border)',
        padding: '24px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--tm-accent)" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
            <polyline points="16 7 22 7 22 13" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-primary)', fontFamily: 'Syne, sans-serif' }}>TradeMindset</span>
          <span style={{ fontSize: 11, color: 'var(--tm-text-muted)' }}>© {new Date().getFullYear()}</span>
        </div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <Link to="/login" style={{ fontSize: 12, color: 'var(--tm-text-muted)', textDecoration: 'none' }}>Se connecter</Link>
          <Link to="/signup" style={{ fontSize: 12, color: 'var(--tm-accent)', textDecoration: 'none', fontWeight: 600 }}>Commencer</Link>
        </div>
      </footer>

      {/* Responsive */}
      <style>{`
        @media (max-width: 768px) {
          .hero-grid { grid-template-columns: 1fr !important; }
          .how-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  )
}
