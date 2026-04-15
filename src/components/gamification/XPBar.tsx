// src/components/gamification/XPBar.tsx
// ═══════════════════════════════════════════════════════════════
// Barre XP compacte pour la sidebar — niveau, progression, streak
// ═══════════════════════════════════════════════════════════════

import { useGamification } from '@/hooks/useGamification'
import { useNavigate } from 'react-router-dom'

export default function XPBar() {
  const { profile, level, currentXP, nextLevelXP, progress, loading } = useGamification()
  const navigate = useNavigate()

  if (loading || !profile) return null

  const prestigeStars = profile.prestigeLevel > 0
    ? '⭐'.repeat(Math.min(profile.prestigeLevel, 3))
    : ''

  return (
    <div
      onClick={() => navigate('/badges')}
      style={{
        padding: '10px 12px', margin: '0 8px 4px', borderRadius: 10, cursor: 'pointer',
        background: 'rgba(var(--tm-accent-rgb,0,229,255),0.04)',
        border: '1px solid rgba(var(--tm-accent-rgb,0,229,255),0.1)',
        transition: 'all 0.15s',
      }}
      title="Voir mes badges"
    >
      {/* Level + XP + Streak — single row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{
            fontSize: 10, fontWeight: 800, color: '#0D1117',
            background: 'var(--tm-accent)', borderRadius: 4,
            padding: '1px 5px', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0,
          }}>
            LV.{level}
          </span>
          <span style={{ fontSize: 9, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>
            {currentXP.toLocaleString()}/{nextLevelXP.toLocaleString()}
          </span>
          {prestigeStars && (
            <span style={{ fontSize: 10, letterSpacing: -2 }}>{prestigeStars}</span>
          )}
          {profile.activeTitle && (
            <span style={{ fontSize: 9, color: 'var(--tm-accent)', fontWeight: 600, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 60 }}>
              {profile.activeTitle}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <span style={{ fontSize: 9, color: 'var(--tm-text-muted)' }}>🏅{profile.badgeCount}</span>
          {profile.currentStreak > 0 && (
            <span style={{ fontSize: 10, color: '#FF9500', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>
              🔥{profile.currentStreak}
            </span>
          )}
        </div>
      </div>

      {/* XP Bar */}
      <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 2,
          width: `${Math.min(progress * 100, 100)}%`,
          background: 'linear-gradient(90deg, var(--tm-accent), #0A85FF)',
          transition: 'width 0.5s ease',
        }} />
      </div>
    </div>
  )
}
