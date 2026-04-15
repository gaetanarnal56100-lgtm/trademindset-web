// src/pages/badges/BadgesPage.tsx
// ═══════════════════════════════════════════════════════════════
// Page Badges — grille de 150 badges, filtrée par catégorie/rareté
// ═══════════════════════════════════════════════════════════════

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useGamification } from '@/hooks/useGamification'
import {
  ALL_BADGES, BADGES_BY_ID, RARITY_CONFIG, CATEGORY_CONFIG,
  type BadgeDefinition, type BadgeCategory, type BadgeRarity,
} from '@/services/gamification/badgeDefinitions'
import { levelProgress } from '@/services/gamification/prestigeEngine'

type FilterCategory = 'all' | BadgeCategory
type FilterRarity = 'all' | BadgeRarity

export default function BadgesPage() {
  const { t } = useTranslation()
  const { profile, earnedBadgeIds, loading, level, currentXP, nextLevelXP, progress } = useGamification()
  const [filterCat, setFilterCat] = useState<FilterCategory>('all')
  const [filterRarity, setFilterRarity] = useState<FilterRarity>('all')
  const [selectedBadge, setSelectedBadge] = useState<BadgeDefinition | null>(null)

  const filtered = ALL_BADGES.filter(b => {
    if (filterCat !== 'all' && b.category !== filterCat) return false
    if (filterRarity !== 'all' && b.rarity !== filterRarity) return false
    return true
  })

  const earned = earnedBadgeIds.size
  const total = ALL_BADGES.filter(b => !b.hidden).length

  const card = (extra?: React.CSSProperties): React.CSSProperties => ({
    background: 'var(--tm-card, #161B22)', border: '1px solid var(--tm-border, #1E2330)',
    borderRadius: 16, padding: '18px 20px', position: 'relative', overflow: 'hidden', ...extra,
  })

  if (loading) {
    return (
      <div style={{ padding: 28, maxWidth: 1100, margin: '0 auto' }}>
        {[1,2,3].map(i => <div key={i} style={{ height: 80, background: '#1C2130', borderRadius: 16, marginBottom: 12, animation: 'pulse 1.5s infinite' }} />)}
        <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
      </div>
    )
  }

  return (
    <div style={{ padding: '28px 28px 60px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--tm-text-primary, #F0F3FF)', margin: 0, fontFamily: 'Syne, sans-serif' }}>
          {t('badges.title')}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--tm-text-muted, #555C70)', margin: '4px 0 0' }}>
          {t('badges.subtitle', { earned, total })}
        </p>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: t('badges.statLevel'), value: `${level}`, icon: '⚡', color: 'var(--tm-accent, #00E5FF)' },
          { label: t('badges.statXp'), value: profile?.totalXP?.toLocaleString() ?? '0', icon: '💎', color: '#FFD700' },
          { label: t('badges.statBadges'), value: `${earned}/${total}`, icon: '🏅', color: '#22C759' },
          { label: t('badges.statStreak'), value: `${profile?.currentStreak ?? 0}${t('badges.daysSuffix')}`, icon: '🔥', color: '#FF9500' },
          { label: t('badges.statMultiplier'), value: `×${(profile?.activeMultiplier ?? 1).toFixed(2)}`, icon: '✨', color: '#BF5AF2' },
        ].map(({ label, value, icon, color }) => (
          <div key={label} style={card()}>
            <div style={{ fontSize: 18, marginBottom: 4 }}>{icon}</div>
            <div style={{ fontSize: 10, color: 'var(--tm-text-muted, #555C70)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500, marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* XP Progress bar */}
      <div style={{ ...card({ marginBottom: 20 }) }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--tm-text-primary, #F0F3FF)' }}>{t('badges.levelProgress', { from: level, to: level + 1 })}</span>
          <span style={{ fontSize: 11, color: 'var(--tm-text-muted, #555C70)', fontFamily: 'JetBrains Mono, monospace' }}>{currentXP} / {nextLevelXP} XP</span>
        </div>
        <div style={{ height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(progress * 100, 100)}%`, background: 'linear-gradient(90deg, var(--tm-accent, #00E5FF), #0A85FF)', borderRadius: 4, transition: 'width 0.5s' }} />
        </div>
        {profile && profile.prestigeLevel > 0 && (
          <div style={{ marginTop: 8, fontSize: 11, color: '#BF5AF2', fontWeight: 600 }}>
            {'⭐'.repeat(profile.prestigeLevel)} {t('badges.prestige')} {profile.prestigeLevel}
          </div>
        )}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {/* Category filter */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}>
          <FilterChip label={t('common.all')} active={filterCat === 'all'} onClick={() => setFilterCat('all')} />
          {(Object.entries(CATEGORY_CONFIG) as [BadgeCategory, { label: string; icon: string }][]).map(([key, { icon }]) => (
            <FilterChip key={key} label={`${icon} ${t('badges.cat.' + key)}`} active={filterCat === key} onClick={() => setFilterCat(key)} />
          ))}
        </div>
      </div>

      {/* Rarity filter */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, flexWrap: 'wrap' }}>
        <FilterChip label={t('badges.allRarities')} active={filterRarity === 'all'} onClick={() => setFilterRarity('all')} />
        {(Object.entries(RARITY_CONFIG) as [BadgeRarity, { label: string; color: string }][]).map(([key, { color }]) => (
          <FilterChip key={key} label={t('badges.rarity.' + key)} active={filterRarity === key} onClick={() => setFilterRarity(key)} color={color} />
        ))}
      </div>

      {/* Badge Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
        {filtered.map(badge => {
          const isEarned = earnedBadgeIds.has(badge.id)
          const isSecret = badge.hidden && !isEarned
          const rarity = RARITY_CONFIG[badge.rarity]

          return (
            <div
              key={badge.id}
              onClick={() => !isSecret && setSelectedBadge(badge)}
              style={{
                ...card({ padding: '14px 12px', cursor: isSecret ? 'default' : 'pointer' }),
                opacity: isEarned ? 1 : isSecret ? 0.3 : 0.5,
                borderColor: isEarned ? rarity.color + '40' : 'var(--tm-border, #1E2330)',
                transition: 'all 0.2s',
              }}
            >
              {/* Rarity indicator */}
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: isEarned ? rarity.color : 'transparent' }} />

              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 28, marginBottom: 6, filter: isEarned ? 'none' : 'grayscale(1)' }}>
                  {isSecret ? '❓' : badge.icon}
                </div>
                <div style={{
                  fontSize: 11, fontWeight: 700,
                  color: isEarned ? 'var(--tm-text-primary, #F0F3FF)' : 'var(--tm-text-muted, #555C70)',
                  marginBottom: 4, lineHeight: 1.3,
                  minHeight: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isSecret ? '???' : t('badges.names.' + badge.id, { defaultValue: badge.name })}
                </div>
                <div style={{
                  fontSize: 9, fontWeight: 700, color: rarity.color,
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                }}>
                  {isSecret ? '???' : t('badges.rarity.' + badge.rarity)}
                </div>
                {isEarned && (
                  <div style={{ marginTop: 4, fontSize: 9, color: '#22C759', fontWeight: 600 }}>{t('badges.earned')}</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Badge Detail Modal */}
      {selectedBadge && (
        <BadgeModal
          badge={selectedBadge}
          isEarned={earnedBadgeIds.has(selectedBadge.id)}
          onClose={() => setSelectedBadge(null)}
        />
      )}
    </div>
  )
}

// ── Filter Chip ───────────────────────────────────────────────
function FilterChip({ label, active, onClick, color }: { label: string; active: boolean; onClick: () => void; color?: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
        fontSize: 11, fontWeight: 600, transition: 'all 0.15s',
        background: active
          ? color ? `${color}20` : 'rgba(var(--tm-accent-rgb,0,229,255),0.15)'
          : 'rgba(255,255,255,0.04)',
        color: active
          ? color || 'var(--tm-accent, #00E5FF)'
          : 'var(--tm-text-muted, #555C70)',
      }}
    >
      {label}
    </button>
  )
}

// ── Badge Detail Modal ────────────────────────────────────────
function BadgeModal({ badge, isEarned, onClose }: { badge: BadgeDefinition; isEarned: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const rarity = RARITY_CONFIG[badge.rarity]
  const rewards = badge.reward

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--tm-card, #161B22)', border: `1px solid ${rarity.color}40`,
          borderRadius: 20, padding: 28, maxWidth: 400, width: '100%',
          position: 'relative',
        }}
      >
        {/* Rarity bar */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: rarity.color, borderRadius: '20px 20px 0 0' }} />

        {/* Close */}
        <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', color: 'var(--tm-text-muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>

        {/* Icon */}
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 56, filter: isEarned ? 'none' : 'grayscale(1)', marginBottom: 8 }}>{badge.icon}</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--tm-text-primary, #F0F3FF)', marginBottom: 4 }}>{t('badges.names.' + badge.id, { defaultValue: badge.name })}</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: rarity.color, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('badges.rarity.' + badge.rarity)}</div>
        </div>

        {/* Description */}
        <div style={{ fontSize: 13, color: 'var(--tm-text-secondary, #8F94A3)', textAlign: 'center', marginBottom: 20, lineHeight: 1.5 }}>
          {t('badges.desc.' + badge.id, { defaultValue: badge.description })}
        </div>

        {/* Status */}
        <div style={{
          textAlign: 'center', padding: '8px 16px', borderRadius: 10, marginBottom: 16,
          background: isEarned ? 'rgba(34,199,89,0.1)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${isEarned ? 'rgba(34,199,89,0.3)' : 'rgba(255,255,255,0.08)'}`,
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: isEarned ? '#22C759' : 'var(--tm-text-muted, #555C70)' }}>
            {isEarned ? t('badges.obtained') : t('badges.locked')}
          </span>
        </div>

        {/* Rewards */}
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-text-primary, #F0F3FF)', marginBottom: 10 }}>{t('badges.rewards')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <RewardRow icon="⚡" label={`+${rewards.xp} XP`} />
          {rewards.proDays && <RewardRow icon="👑" label={t('badges.proDays', { count: rewards.proDays })} />}
          {rewards.xpMultiplier && <RewardRow icon="✨" label={t('badges.xpMultiplier', { n: rewards.xpMultiplier })} />}
          {rewards.frame && <RewardRow icon="🖼️" label={`${t('badges.profileFrame')}: ${rewards.frame}`} />}
          {rewards.theme && <RewardRow icon="🎨" label={`${t('badges.theme')}: ${rewards.theme}`} />}
          {rewards.title && <RewardRow icon="📛" label={`${t('badges.badgeTitle')}: ${rewards.title}`} />}
          {rewards.feature && <RewardRow icon="🔓" label={`${t('badges.feature')}: ${rewards.feature}`} />}
        </div>

        {/* Seasonal tag */}
        {badge.seasonal && (
          <div style={{ marginTop: 12, textAlign: 'center' }}>
            <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: 'rgba(255,149,0,0.1)', border: '1px solid rgba(255,149,0,0.2)', color: '#FF9500', fontWeight: 600 }}>
              {t('badges.seasonal')}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function RewardRow({ icon, label }: { icon: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.03)' }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ fontSize: 12, color: 'var(--tm-text-secondary, #8F94A3)' }}>{label}</span>
    </div>
  )
}
