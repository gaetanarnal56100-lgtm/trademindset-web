// ─── ReferralPage ─────────────────────────────────────────────────────────────
// Page parrainage complète — code, lien, stats, liste des filleuls

import { useState, useEffect } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'
import { useIsAuthenticated } from '@/hooks/useAuth'
import toast from 'react-hot-toast'

const fbFn = getFunctions(app, 'europe-west1')

interface ReferralStats {
  total: number
  pending: number
  validated: number
  rewarded: number
}

interface Referral {
  id: string
  status: 'pending' | 'validated' | 'rewarded'
  createdAt: string | null
  validatedAt: string | null
  referred: { displayName: string; email: string }
}

interface ReferralData {
  referralCode: string
  referralLink: string
  stats: ReferralStats
  referrals: Referral[]
}

export default function ReferralPage() {
  const [data, setData]       = useState<ReferralData | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied]   = useState<'code' | 'link' | null>(null)
  const { isAuthenticated, isAuthLoading } = useIsAuthenticated()

  // Attendre que l'authentification soit chargée
  useEffect(() => {
    if (!isAuthLoading && isAuthenticated) {
      loadStats()
    } else if (!isAuthLoading && !isAuthenticated) {
      setLoading(false)
      toast.error('Tu dois être connecté')
    }
  }, [isAuthLoading, isAuthenticated])

  async function loadStats() {
    setLoading(true)
    try {
      console.log("Calling generateUserReferralCode...")
      // Ensure user has a referral code first
      const genFn = httpsCallable<void, { code: string }>(fbFn, 'generateUserReferralCode')
      await genFn()
      console.log("Code generated, now getting stats...")
      
      // Then get full stats
      const statsFn = httpsCallable<void, ReferralData>(fbFn, 'getReferralStats')
      const res = await statsFn()
      console.log("Stats loaded:", res.data)
      setData(res.data)
    } catch (err) {
      console.error("Error:", err)
      toast.error('Erreur lors du chargement')
    } finally {
      setLoading(false)
    }
  }

  async function copyToClipboard(text: string, type: 'code' | 'link') {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(type)
      setTimeout(() => setCopied(null), 2000)
      toast.success(type === 'code' ? 'Code copié !' : 'Lien copié !')
    } catch {
      toast.error('Impossible de copier')
    }
  }

  function shareLink() {
    if (!data) return
    if (navigator.share) {
      navigator.share({
        title: 'TradeMindset',
        text: '🚀 Rejoins TradeMindset — le journal de trading intelligent. Utilise mon lien :',
        url: data.referralLink,
      }).catch(() => {})
    } else {
      copyToClipboard(data.referralLink, 'link')
    }
  }

  const card = (extra?: React.CSSProperties): React.CSSProperties => ({
    background: 'var(--tm-bg-card)',
    border: '1px solid var(--tm-border)',
    borderRadius: 16,
    padding: '18px 20px',
    position: 'relative',
    overflow: 'hidden',
    ...extra,
  })

  const hl = (): React.CSSProperties => ({
    position: 'absolute', top: 0, left: 0, right: 0, height: 1,
    background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.05),transparent)',
  })

  const statusConfig = {
    pending:   { label: 'En attente', color: 'var(--tm-warning)',  bg: 'rgba(255,149,0,0.1)',   dot: 'var(--tm-warning)' },
    validated: { label: 'Validé',    color: 'var(--tm-profit)',   bg: 'rgba(34,199,89,0.1)',   dot: 'var(--tm-profit)' },
    rewarded:  { label: 'Récompensé',color: 'var(--tm-accent)',   bg: 'rgba(0,229,255,0.1)',   dot: 'var(--tm-accent)' },
  }

  function fmtDate(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  if (loading || isAuthLoading) {
    return (
      <div style={{ padding: '28px', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1,2,3].map(i => (
            <div key={i} style={{ height: 80, background: 'var(--tm-bg-secondary)', borderRadius: 16, animation: 'pulse 1.5s infinite' }} />
          ))}
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div style={{ padding: '28px', maxWidth: 900, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 16 }}>🔐</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--tm-text-primary)', marginBottom: 8 }}>
          Connecte-toi pour accéder au parrainage
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--tm-text-primary)', margin: 0, fontFamily: 'Syne, sans-serif', letterSpacing: '-0.02em' }}>
          🎁 Parrainage
        </h1>
        <p style={{ fontSize: 13, color: 'var(--tm-text-secondary)', margin: '4px 0 0' }}>
          Invite tes amis sur TradeMindset et suis tes parrainages
        </p>
      </div>

      {/* Hero — code + lien */}
      <div style={{ ...card(), marginBottom: 16, background: 'linear-gradient(135deg, var(--tm-bg-secondary) 0%, var(--tm-bg-card) 100%)', border: '1px solid rgba(0,229,255,0.2)' }}>
        <div style={hl()} />
        {/* Top line accent */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg,var(--tm-accent),var(--tm-blue))', opacity: 0.7 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>🎁</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--tm-text-primary)' }}>Ton code de parrainage</div>
            <div style={{ fontSize: 12, color: 'var(--tm-text-secondary)', marginTop: 2 }}>
              Partage ce code ou ce lien — chaque filleul est validé à son premier trade
            </div>
          </div>
        </div>

        {/* Code */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 200, background: 'var(--tm-bg)', border: '1px solid var(--tm-border)', borderRadius: 10, padding: '10px 16px' }}>
            <span style={{ fontSize: 20, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', color: 'var(--tm-accent)', letterSpacing: '0.05em', flex: 1 }}>
              {data?.referralCode || '…'}
            </span>
            <button
              onClick={() => data && copyToClipboard(data.referralCode, 'code')}
              style={{ padding: '5px 14px', borderRadius: 8, border: '1px solid var(--tm-border)', background: copied === 'code' ? 'var(--tm-profit)' : 'var(--tm-bg-secondary)', color: copied === 'code' ? '#fff' : 'var(--tm-text-secondary)', cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'all 0.15s', whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {copied === 'code' ? '✓ Copié' : '📋 Copier'}
            </button>
          </div>
        </div>

        {/* Link */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, background: 'var(--tm-bg)', border: '1px solid var(--tm-border)', borderRadius: 10, padding: '8px 14px', overflow: 'hidden' }}>
            <span style={{ fontSize: 11, color: 'var(--tm-text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
              {data?.referralLink}
            </span>
          </div>
          <button
            onClick={() => data && copyToClipboard(data.referralLink, 'link')}
            style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid var(--tm-border)', background: copied === 'link' ? 'var(--tm-profit)' : 'var(--tm-bg-secondary)', color: copied === 'link' ? '#fff' : 'var(--tm-text-secondary)', cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'all 0.15s', whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            {copied === 'link' ? '✓ Copié' : '🔗 Copier le lien'}
          </button>
          <button
            onClick={shareLink}
            style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(0,229,255,0.3)', background: 'rgba(0,229,255,0.08)', color: 'var(--tm-accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'all 0.15s', whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            ↗ Partager
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Total filleuls',  value: data?.stats.total ?? 0,     color: 'var(--tm-text-primary)', icon: '👥' },
          { label: 'En attente',      value: data?.stats.pending ?? 0,   color: 'var(--tm-warning)',       icon: '⏳' },
          { label: 'Validés',         value: data?.stats.validated ?? 0, color: 'var(--tm-profit)',        icon: '✅' },
          { label: 'Récompensés',     value: data?.stats.rewarded ?? 0,  color: 'var(--tm-accent)',        icon: '🎉' },
        ].map(({ label, value, color, icon }) => (
          <div key={label} style={card()}>
            <div style={hl()} />
            <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
            <div style={{ fontSize: 11, color: 'var(--tm-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Comment ça marche */}
      <div style={{ ...card(), marginBottom: 16 }}>
        <div style={hl()} />
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--tm-text-primary)', marginBottom: 16 }}>Comment ça marche ?</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
          {[
            { step: '1', icon: '🔗', title: 'Partage ton lien', desc: 'Envoie ton lien unique à tes amis traders' },
            { step: '2', icon: '📝', title: 'Ils s\'inscrivent', desc: 'Ils créent leur compte via ton lien de parrainage' },
            { step: '3', icon: '🏆', title: 'Premier trade', desc: 'Le parrainage est validé à leur premier trade enregistré' },
          ].map(({ step, icon, title, desc }) => (
            <div key={step} style={{ background: 'var(--tm-bg-secondary)', borderRadius: 12, padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{icon}</div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--tm-accent)', fontWeight: 700, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Étape {step}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tm-text-primary)', marginBottom: 3 }}>{title}</div>
                <div style={{ fontSize: 11, color: 'var(--tm-text-secondary)', lineHeight: 1.4 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Liste des filleuls */}
      <div style={card()}>
        <div style={hl()} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--tm-text-primary)' }}>Mes filleuls</div>
          <span style={{ fontSize: 11, color: 'var(--tm-text-muted)', fontFamily: 'monospace' }}>{data?.referrals.length ?? 0} au total</span>
        </div>

        {!data?.referrals.length ? (
          <div style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--tm-text-muted)' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🤝</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--tm-text-secondary)', marginBottom: 6 }}>Pas encore de filleuls</div>
            <div style={{ fontSize: 12 }}>Partage ton lien pour commencer à parrainer</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, padding: '6px 12px', fontSize: 10, fontWeight: 600, color: 'var(--tm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              <span>Filleul</span>
              <span style={{ textAlign: 'center', minWidth: 80 }}>Inscrit le</span>
              <span style={{ textAlign: 'right', minWidth: 90 }}>Statut</span>
            </div>
            {data.referrals.map((r) => {
              const cfg = statusConfig[r.status]
              return (
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'center', padding: '10px 12px', background: 'var(--tm-bg-secondary)', borderRadius: 10, border: '1px solid var(--tm-border)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tm-text-primary)' }}>{r.referred.displayName}</div>
                    <div style={{ fontSize: 11, color: 'var(--tm-text-muted)', fontFamily: 'monospace' }}>{r.referred.email}</div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--tm-text-secondary)', textAlign: 'center', minWidth: 80, fontFamily: 'monospace' }}>
                    {fmtDate(r.createdAt)}
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 90 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: cfg.color, background: cfg.bg, padding: '3px 8px', borderRadius: 6 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot, display: 'inline-block', flexShrink: 0 }} />
                      {cfg.label}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
