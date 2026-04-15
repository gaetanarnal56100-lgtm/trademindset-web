// ─── ReferralPage ─────────────────────────────────────────────────────────────
// Page parrainage complète — code, lien, stats, progression, paliers, XP passif

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'
import { useIsAuthenticated } from '@/hooks/useAuth'
import toast from 'react-hot-toast'

const fbFn = getFunctions(app, 'europe-west1')

interface ReferralStats { total: number; pending: number; validated: number; rewarded: number }
interface Referral {
  id: string; status: 'pending' | 'validated' | 'rewarded'
  createdAt: string | null; validatedAt: string | null
  referred: { displayName: string; email: string }
}
interface TierInfo { count: number; current: number; features: string[]; proDays: number; badge: string | null; xpBonus: number; progress: number }
interface ReachedTier { count: number; features: string[]; proDays: number; badge: string | null; xpBonus: number }
interface ReferralData { referralCode: string; referralLink: string; stats: ReferralStats; referrals: Referral[] }
interface RewardsData { stats: ReferralStats; rewards: { badges: string[]; unlockedFeatures: string[]; bonusXP: number; proDaysEarned: number; passiveXPToday: number }; nextTier: TierInfo | null; reachedTiers: ReachedTier[]; proReferralsCount: number; totalXP: number; passiveXPToday: number }

const TIER_LABELS_ICONS: Record<number, string> = {
  1:  '📄',
  3:  '🔍',
  5:  '⚡',
  10: '📊',
  15: '⚡',
  20: '🏆',
  25: '⚡',
  30: '🎖️',
  40: '⚡',
  50: '👑',
}

const BADGE_CONFIG: Record<string, { icon: string; color: string }> = {
  filleul:      { icon: '🤝', color: '#00E5FF' },
  topParrain:   { icon: '🏆', color: '#FF9500' },
  ambassadeur:  { icon: '🎖️', color: '#BF5AF2' },
  legende:      { icon: '👑', color: '#FFD700' },
}

const FEATURE_LABELS: Record<string, string> = {
  exportPdf: 'Export PDF',
  advancedFilters: 'Filtres avancés',
  dashboardWidgets: 'Widgets dashboard',
}

export default function ReferralPage() {
  const { t } = useTranslation()
  const [data, setData] = useState<ReferralData | null>(null)
  const [rewards, setRewards] = useState<RewardsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)
  const { isAuthenticated, isAuthLoading } = useIsAuthenticated()

  useEffect(() => {
    if (!isAuthLoading && isAuthenticated) loadAll()
    else if (!isAuthLoading && !isAuthenticated) { setLoading(false); toast.error(t('referral.mustBeLoggedIn')) }
  }, [isAuthLoading, isAuthenticated])

  async function loadAll() {
    setLoading(true)
    try {
      const genFn = httpsCallable<void, { code: string }>(fbFn, 'generateUserReferralCode')
      await genFn()
      const [statsRes, rewardsRes] = await Promise.all([
        httpsCallable<void, ReferralData>(fbFn, 'getReferralStats')(),
        httpsCallable<void, RewardsData>(fbFn, 'getReferralRewards')(),
      ])

      // ── Auto-fix : rattraper l'XP manquant si filleuls validés mais 0 XP ──
      // On utilise statsRes.data.stats.validated (compte réel des docs referral)
      // car rewardsRes.data.stats.validated lit le champ user doc qui peut être désync
      const realValidated = statsRes.data.stats.validated
      const currentXP = rewardsRes.data.totalXP ?? 0
      const currentBonusXP = rewardsRes.data.rewards?.bonusXP ?? 0

      if (realValidated > 0 && currentXP === 0 && currentBonusXP === 0) {
        try {
          const fixFn = httpsCallable<void, { fixed: number; xpAdded: number; newTotalXP: number }>(fbFn, 'fixMissingReferralXP')
          const fixRes = await fixFn()
          if (fixRes.data.xpAdded > 0) {
            toast.success(`+${fixRes.data.xpAdded} XP rattrapés !`)
            // Recharger les rewards après le fix
            const freshRewards = await httpsCallable<void, RewardsData>(fbFn, 'getReferralRewards')()
            setData(statsRes.data)
            setRewards(freshRewards.data)
            return
          }
        } catch (e) { console.warn('fixMissingReferralXP skipped:', e) }
      }

      setData(statsRes.data)
      setRewards(rewardsRes.data)
    } catch { toast.error('Erreur lors du chargement') }
    finally { setLoading(false) }
  }

  async function copyToClipboard(text: string, type: 'code' | 'link') {
    try { await navigator.clipboard.writeText(text); setCopied(type); setTimeout(() => setCopied(null), 2000); toast.success(type === 'code' ? t('referral.codeCopied') : t('referral.linkCopied')) }
    catch { toast.error('Impossible de copier') }
  }

  function shareLink() {
    if (!data) return
    if (navigator.share) { navigator.share({ title: 'TradeMindset', text: '🚀 Rejoins TradeMindset — le journal de trading intelligent. Utilise mon lien :', url: data.referralLink }).catch(() => {}) }
    else copyToClipboard(data.referralLink, 'link')
  }

  const card = (extra?: React.CSSProperties): React.CSSProperties => ({ background: '#161B22', border: '1px solid #1E2330', borderRadius: 16, padding: '18px 20px', position: 'relative', overflow: 'hidden', ...extra })
  const hl = (): React.CSSProperties => ({ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.05),transparent)' })

  const statusConfig = {
    pending:   { label: t('referral.pending'), color: '#FF9500', bg: 'rgba(255,149,0,0.1)', dot: '#FF9500' },
    validated: { label: t('referral.validated'), color: '#22C759', bg: 'rgba(34,199,89,0.1)', dot: '#22C759' },
    rewarded:  { label: t('referral.rewarded'), color: '#00E5FF', bg: 'rgba(0,229,255,0.1)', dot: '#00E5FF' },
  }

  function fmtDate(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  // Build tier labels using translations
  const tierLabels: Record<number, { label: string; icon: string }> = {
    1:  { label: 'Export PDF', icon: '📄' },
    3:  { label: t('referral.filters'), icon: '🔍' },
    5:  { label: '+100 XP', icon: '⚡' },
    10: { label: 'Widgets dashboard + 10j Pro', icon: '📊' },
    15: { label: '+200 XP', icon: '⚡' },
    20: { label: '1 mois Pro + Badge Top Parrain', icon: '🏆' },
    25: { label: '+400 XP', icon: '⚡' },
    30: { label: '2 mois Pro + Badge Ambassadeur', icon: '🎖️' },
    40: { label: '+750 XP', icon: '⚡' },
    50: { label: t('referral.threeMonthsPro'), icon: '👑' },
  }

  if (loading || isAuthLoading) {
    return (
      <div style={{ padding: '28px', maxWidth: 960, margin: '0 auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1,2,3].map(i => <div key={i} style={{ height: 80, background: '#1C2130', borderRadius: 16, animation: 'pulse 1.5s infinite' }} />)}
        </div>
        <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div style={{ padding: '28px', maxWidth: 960, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 16 }}>🔐</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#F0F3FF', marginBottom: 8 }}>Connecte-toi pour accéder au parrainage</div>
      </div>
    )
  }

  const validated = rewards?.stats.validated ?? 0
  const nt = rewards?.nextTier
  const passiveXP = rewards?.passiveXPToday ?? 0

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 960, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#F0F3FF', margin: 0, fontFamily: 'Syne, sans-serif' }}>{t('referral.title')}</h1>
        <p style={{ fontSize: 13, color: '#555C70', margin: '4px 0 0' }}>{t('referral.subtitle')}</p>
      </div>

      {/* XP passif du jour */}
      {passiveXP > 0 && (
        <div style={{ ...card({ marginBottom: 16, background: 'linear-gradient(135deg, rgba(255,149,0,0.06), rgba(255,149,0,0.02))', border: '1px solid rgba(255,149,0,0.2)' }) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,149,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🔥</div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#FF9500', fontFamily: 'JetBrains Mono, monospace' }}>+{passiveXP} XP</div>
              <div style={{ fontSize: 12, color: '#8F94A3' }}>{t('referral.earnedToday')}</div>
            </div>
            <div style={{ marginLeft: 'auto', fontSize: 11, color: '#555C70', background: '#1C2130', padding: '4px 10px', borderRadius: 6 }}>
              {t('referral.dailyCap')}
            </div>
          </div>
        </div>
      )}

      {/* Progression vers prochain palier */}
      {nt && (
        <div style={{ ...card({ marginBottom: 16 }) }}>
          <div style={hl()} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#F0F3FF' }}>{t('referral.progression')}</div>
            <div style={{ fontSize: 12, color: '#00E5FF', fontWeight: 600 }}>
              {tierLabels[nt.count]?.icon} Prochain : {tierLabels[nt.count]?.label}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div style={{ flex: 1, height: 10, background: '#1C2130', borderRadius: 5, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(nt.progress * 100, 100)}%`, background: 'linear-gradient(90deg, #00E5FF, #0A85FF)', borderRadius: 5, transition: 'width 0.5s' }} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#F0F3FF', fontFamily: 'JetBrains Mono, monospace', minWidth: 60, textAlign: 'right' }}>
              {nt.current} / {nt.count}
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#555C70' }}>
            {t('referral.remaining', { count: nt.count - nt.current })}
          </div>
        </div>
      )}

      {/* Hero — code + lien */}
      <div style={{ ...card({ marginBottom: 16, background: 'linear-gradient(135deg, #1C2130, #161B22)', border: '1px solid rgba(0,229,255,0.2)' }) }}>
        <div style={hl()} />
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg,#00E5FF,#0A85FF)', opacity: 0.7 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>🎁</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#F0F3FF' }}>{t('referral.codeTitle')}</div>
            <div style={{ fontSize: 12, color: '#555C70', marginTop: 2 }}>{t('referral.codeDesc')}</div>
          </div>
        </div>
        {/* Code */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 200, background: '#0D1117', border: '1px solid #1E2330', borderRadius: 10, padding: '10px 16px' }}>
            <span style={{ fontSize: 20, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', color: '#00E5FF', letterSpacing: '0.05em', flex: 1 }}>{data?.referralCode || '…'}</span>
            <button onClick={() => data && copyToClipboard(data.referralCode, 'code')} style={{ padding: '5px 14px', borderRadius: 8, border: '1px solid #2A2F3E', background: copied === 'code' ? '#22C759' : '#1C2130', color: copied === 'code' ? '#fff' : '#8F94A3', cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'all 0.15s' }}>
              {copied === 'code' ? t('common.copied') : t('referral.copyCode')}
            </button>
          </div>
        </div>
        {/* Link */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, background: '#0D1117', border: '1px solid #1E2330', borderRadius: 10, padding: '8px 14px', overflow: 'hidden' }}>
            <span style={{ fontSize: 11, color: '#3D4254', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{data?.referralLink}</span>
          </div>
          <button onClick={() => data && copyToClipboard(data.referralLink, 'link')} style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid #2A2F3E', background: copied === 'link' ? '#22C759' : '#1C2130', color: copied === 'link' ? '#fff' : '#8F94A3', cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'all 0.15s' }}>
            {copied === 'link' ? t('common.copied') : t('referral.copyLink')}
          </button>
          <button onClick={shareLink} style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(0,229,255,0.3)', background: 'rgba(0,229,255,0.08)', color: '#00E5FF', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>{t('common.share')}</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { label: t('referral.statsTotal'), value: data?.stats.total ?? 0, color: '#F0F3FF', icon: '👥' },
          { label: t('referral.statsPending'), value: data?.stats.pending ?? 0, color: '#FF9500', icon: '⏳' },
          { label: t('referral.validatedCount'), value: data?.stats.validated ?? 0, color: '#22C759', icon: '✅' },
          { label: t('referral.statsXp'), value: rewards?.totalXP ?? rewards?.rewards.bonusXP ?? 0, color: '#00E5FF', icon: '⚡' },
        ].map(({ label, value, color, icon }) => (
          <div key={label} style={card()}>
            <div style={hl()} />
            <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
            <div style={{ fontSize: 11, color: '#555C70', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Paliers de récompenses */}
      <div style={{ ...card({ marginBottom: 16 }) }}>
        <div style={hl()} />
        <div style={{ fontSize: 14, fontWeight: 700, color: '#F0F3FF', marginBottom: 16 }}>{t('referral.tiersTitle')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.entries(tierLabels).map(([countStr, { label, icon }]) => {
            const count = parseInt(countStr)
            const reached = validated >= count
            return (
              <div key={count} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, background: reached ? 'rgba(34,199,89,0.06)' : '#1C2130', border: `1px solid ${reached ? 'rgba(34,199,89,0.2)' : '#1E2330'}`, transition: 'all 0.2s' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: reached ? 'rgba(34,199,89,0.15)' : 'rgba(255,255,255,0.03)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                  {reached ? '✅' : icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: reached ? '#22C759' : '#F0F3FF' }}>{label}</div>
                  <div style={{ fontSize: 10, color: '#555C70' }}>{count} filleul{count > 1 ? 's' : ''}</div>
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: reached ? '#22C759' : '#3D4254' }}>
                  {reached ? t('referral.unlocked') : `${count - validated} restant${count - validated > 1 ? 's' : ''}`}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Badges */}
      {rewards && rewards.rewards.badges.length > 0 && (
        <div style={{ ...card({ marginBottom: 16 }) }}>
          <div style={hl()} />
          <div style={{ fontSize: 14, fontWeight: 700, color: '#F0F3FF', marginBottom: 16 }}>{t('referral.myBadges')}</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {rewards.rewards.badges.map(badgeId => {
              const cfg = BADGE_CONFIG[badgeId]
              if (!cfg) return null
              const badgeLabel = badgeId === 'legende' ? t('referral.legend') : badgeId
              return (
                <div key={badgeId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 10, background: `${cfg.color}12`, border: `1px solid ${cfg.color}30` }}>
                  <span style={{ fontSize: 18 }}>{cfg.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: cfg.color }}>{badgeLabel}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Features débloquées */}
      {rewards && rewards.rewards.unlockedFeatures.length > 0 && (
        <div style={{ ...card({ marginBottom: 16 }) }}>
          <div style={hl()} />
          <div style={{ fontSize: 14, fontWeight: 700, color: '#F0F3FF', marginBottom: 16 }}>{t('referral.unlockedFeatures')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {rewards.rewards.unlockedFeatures.map(f => (
              <div key={f} style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(0,229,255,0.06)', border: '1px solid rgba(0,229,255,0.2)', fontSize: 12, fontWeight: 600, color: '#00E5FF' }}>
                ✓ {f === 'advancedFilters' ? t('referral.advancedFilters') : FEATURE_LABELS[f] || f}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Comment ça marche */}
      <div style={{ ...card({ marginBottom: 16 }) }}>
        <div style={hl()} />
        <div style={{ fontSize: 14, fontWeight: 700, color: '#F0F3FF', marginBottom: 16 }}>Comment ça marche ?</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
          {[
            { step: '1', icon: '🔗', title: t('referral.step1Title'), desc: t('referral.step1Desc') },
            { step: '2', icon: '📝', title: t('referral.step2Title'), desc: t('referral.step2Desc') },
            { step: '3', icon: '🏆', title: t('referral.step3Title'), desc: t('referral.step3Desc') },
          ].map(({ step, icon, title, desc }) => (
            <div key={step} style={{ background: '#1C2130', borderRadius: 12, padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{icon}</div>
              <div>
                <div style={{ fontSize: 11, color: '#00E5FF', fontWeight: 700, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Étape {step}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#F0F3FF', marginBottom: 3 }}>{title}</div>
                <div style={{ fontSize: 11, color: '#555C70', lineHeight: 1.4 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* XP passif expliqué */}
      <div style={{ ...card({ marginBottom: 16, background: 'linear-gradient(135deg, rgba(191,90,242,0.04), #161B22)', border: '1px solid rgba(191,90,242,0.15)' }) }}>
        <div style={hl()} />
        <div style={{ fontSize: 14, fontWeight: 700, color: '#F0F3FF', marginBottom: 12 }}>⚡ XP Passif</div>
        <div style={{ fontSize: 12, color: '#8F94A3', lineHeight: 1.6, marginBottom: 12 }}>
          Quand tes filleuls gagnent de l'XP (trades, défis…), tu touches un pourcentage automatiquement chaque jour.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ background: '#1C2130', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: '#555C70', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Filleul gratuit</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#BF5AF2', fontFamily: 'JetBrains Mono, monospace' }}>5%</div>
            <div style={{ fontSize: 10, color: '#555C70', marginTop: 2 }}>de son XP quotidien</div>
          </div>
          <div style={{ background: '#1C2130', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: '#555C70', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Filleul Pro</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#FF9500', fontFamily: 'JetBrains Mono, monospace' }}>10%</div>
            <div style={{ fontSize: 10, color: '#555C70', marginTop: 2 }}>de son XP quotidien</div>
          </div>
        </div>
        <div style={{ marginTop: 10, fontSize: 10, color: '#3D4254', display: 'flex', gap: 12 }}>
          <span>Max 50 XP/filleul/jour</span>
          <span>·</span>
          <span>Max 100 XP/jour total</span>
          <span>·</span>
          <span>×2 si tu es Pro</span>
        </div>
      </div>

      {/* Liste des filleuls */}
      <div style={card()}>
        <div style={hl()} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#F0F3FF' }}>Mes filleuls</div>
          <span style={{ fontSize: 11, color: '#3D4254', fontFamily: 'monospace' }}>{data?.referrals.length ?? 0} au total</span>
        </div>
        {!data?.referrals.length ? (
          <div style={{ textAlign: 'center', padding: '32px 20px', color: '#3D4254' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🤝</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#555C70', marginBottom: 6 }}>Pas encore de filleuls</div>
            <div style={{ fontSize: 12 }}>Partage ton lien pour commencer à parrainer</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, padding: '6px 12px', fontSize: 10, fontWeight: 600, color: '#3D4254', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              <span>Filleul</span>
              <span style={{ textAlign: 'center', minWidth: 80 }}>Inscrit le</span>
              <span style={{ textAlign: 'right', minWidth: 90 }}>Statut</span>
            </div>
            {data.referrals.map((r) => {
              const cfg = statusConfig[r.status]
              return (
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'center', padding: '10px 12px', background: '#1C2130', borderRadius: 10, border: '1px solid #1E2330' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#F0F3FF' }}>{r.referred.displayName}</div>
                    <div style={{ fontSize: 11, color: '#3D4254', fontFamily: 'monospace' }}>{r.referred.email}</div>
                  </div>
                  <div style={{ fontSize: 11, color: '#555C70', textAlign: 'center', minWidth: 80, fontFamily: 'monospace' }}>{fmtDate(r.createdAt)}</div>
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
