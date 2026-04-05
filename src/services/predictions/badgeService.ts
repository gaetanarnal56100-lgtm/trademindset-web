// src/services/predictions/badgeService.ts
// Attribution côté client des badges de prédiction

import { doc, getDoc, setDoc, increment } from 'firebase/firestore'
import { db } from '@/services/firebase/config'
import { callAwardXP } from '@/services/gamification/prestigeEngine'
import { ALL_BADGES, type BadgeDefinition } from '@/services/gamification/badgeDefinitions'
import type { UserPredictionStats } from '@/services/firestore/predictions'

const PREDICTION_BADGES = ALL_BADGES.filter(b => b.category === 'prediction')

function conditionMet(badge: BadgeDefinition, stats: UserPredictionStats): boolean {
  const { type, value } = badge.condition
  switch (type) {
    case 'predictionsTotal':       return stats.predictionsTotal       >= value
    case 'predictionsCorrect':     return stats.predictionsCorrect     >= value
    case 'predictionStreak':       return stats.predictionStreak       >= value
    case 'predictionBestAccuracy': return stats.predictionBestAccuracy <= value  // plus petit = meilleur
    case 'predictionDailyStreak':  return stats.predictionDailyStreak  >= value
    default:                       return false
  }
}

/**
 * Vérifie les 10 badges de prédiction contre les stats actuelles.
 * Pour les nouveaux badges :
 *   - ajoute à earnedBadgeIds
 *   - incrémente badgeCount
 *   - appelle callAwardXP
 * Retourne la liste des badges nouvellement obtenus.
 */
export async function checkAndAwardPredictionBadges(
  uid: string,
  stats: UserPredictionStats,
): Promise<BadgeDefinition[]> {
  const userSnap = await getDoc(doc(db, 'users', uid))
  if (!userSnap.exists()) return []

  const earnedIds: string[] = userSnap.data().earnedBadgeIds ?? []
  const earnedSet = new Set(earnedIds)

  const toAward = PREDICTION_BADGES.filter(
    badge => !earnedSet.has(badge.id) && conditionMet(badge, stats),
  )
  if (toAward.length === 0) return []

  // Mettre à jour Firestore : ajouter badge IDs + incrémenter badgeCount
  const newIds = [...earnedIds, ...toAward.map(b => b.id)]
  await setDoc(doc(db, 'users', uid), {
    earnedBadgeIds: newIds,
    badgeCount: increment(toAward.length),
  }, { merge: true })

  // Attribuer XP pour chaque badge
  for (const badge of toAward) {
    await callAwardXP(badge.reward.xp, 'badge_earned_prediction', badge.id)
    // Si le badge donne un titre, l'activer
    if (badge.reward.title) {
      await setDoc(doc(db, 'users', uid), { activeTitle: badge.reward.title }, { merge: true })
    }
  }

  return toAward
}
