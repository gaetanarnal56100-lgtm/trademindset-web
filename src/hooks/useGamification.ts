// src/hooks/useGamification.ts
// ═══════════════════════════════════════════════════════════════
// Hook temps réel pour XP, niveau, badges, streak
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/services/firebase/config'
import { useUser } from '@/hooks/useAuth'
import { levelProgress, levelFromXP, type GamificationProfile } from '@/services/gamification/prestigeEngine'

export function useGamification() {
  const user = useUser()
  const [profile, setProfile] = useState<GamificationProfile | null>(null)
  const [earnedBadgeIds, setEarnedBadgeIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.uid) { setLoading(false); return }

    const unsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      if (!snap.exists()) { setLoading(false); return }
      const d = snap.data()
      const totalXP = d.totalXP || 0
      setProfile({
        totalXP,
        level: d.level || levelFromXP(totalXP),
        prestigeLevel: d.prestigeLevel || 0,
        prestigeXP: d.prestigeXP || 0,
        activeMultiplier: d.activeMultiplier || 1.0,
        activeFrame: d.activeFrame || null,
        activeTheme: d.activeTheme || null,
        activeTitle: d.activeTitle || null,
        pinnedBadges: d.pinnedBadges || [],
        badgeCount: d.badgeCount || 0,
        currentStreak: d.currentStreak || 0,
        bestStreak: d.bestStreak || 0,
        lastActivityDate: d.lastActivityDate || null,
      })
      setEarnedBadgeIds(new Set(d.earnedBadgeIds || []))
      setLoading(false)
    })

    return () => unsub()
  }, [user?.uid])

  const lp = profile ? levelProgress(profile.totalXP) : null

  return {
    profile,
    earnedBadgeIds,
    loading,
    level: lp?.level ?? 0,
    currentXP: lp?.currentXP ?? 0,
    nextLevelXP: lp?.nextLevelXP ?? 0,
    progress: lp?.progress ?? 0,
  }
}
