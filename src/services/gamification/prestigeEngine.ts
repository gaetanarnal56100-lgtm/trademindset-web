// src/services/gamification/prestigeEngine.ts
// ═══════════════════════════════════════════════════════════════
// PrestigeEngine — XP, niveaux, prestige, multiplicateurs
// ═══════════════════════════════════════════════════════════════

import { doc, getDoc, setDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '@/services/firebase/config'
import app from '@/services/firebase/config'

const fbFn = getFunctions(app, 'europe-west1')

// ── Courbe de niveaux ─────────────────────────────────────────
// Niveau N nécessite XP_FOR_LEVEL(N) XP cumulés
// Formule : 100 * N^1.5 (arrondi)
export const MAX_LEVEL = 50

export function xpForLevel(level: number): number {
  if (level <= 0) return 0
  return Math.round(100 * Math.pow(level, 1.5))
}

export function xpForNextLevel(level: number): number {
  return xpForLevel(level + 1) - xpForLevel(level)
}

export function levelFromXP(totalXP: number): number {
  let level = 0
  while (level < MAX_LEVEL && totalXP >= xpForLevel(level + 1)) {
    level++
  }
  return level
}

export function levelProgress(totalXP: number): { level: number; currentXP: number; nextLevelXP: number; progress: number } {
  const level = levelFromXP(totalXP)
  if (level >= MAX_LEVEL) {
    return { level, currentXP: totalXP, nextLevelXP: 0, progress: 1 }
  }
  const currentLevelXP = xpForLevel(level)
  const nextLevelXP = xpForLevel(level + 1)
  const xpInLevel = totalXP - currentLevelXP
  const xpNeeded = nextLevelXP - currentLevelXP
  return {
    level,
    currentXP: xpInLevel,
    nextLevelXP: xpNeeded,
    progress: xpNeeded > 0 ? xpInLevel / xpNeeded : 1,
  }
}

// ── Types ─────────────────────────────────────────────────────
export interface GamificationProfile {
  totalXP: number
  level: number
  prestigeLevel: number
  prestigeXP: number
  activeMultiplier: number
  activeFrame: string | null
  activeTheme: string | null
  activeTitle: string | null
  pinnedBadges: string[]
  badgeCount: number
  currentStreak: number
  bestStreak: number
  lastActivityDate: string | null
}

const DEFAULT_PROFILE: GamificationProfile = {
  totalXP: 0, level: 0, prestigeLevel: 0, prestigeXP: 0,
  activeMultiplier: 1.0, activeFrame: null, activeTheme: null,
  activeTitle: null, pinnedBadges: [], badgeCount: 0,
  currentStreak: 0, bestStreak: 0, lastActivityDate: null,
}

// ── Firestore reads ───────────────────────────────────────────
export async function getGamificationProfile(uid: string): Promise<GamificationProfile> {
  const snap = await getDoc(doc(db, 'users', uid))
  if (!snap.exists()) return DEFAULT_PROFILE
  const d = snap.data()
  return {
    totalXP: d.totalXP || 0,
    level: d.level || levelFromXP(d.totalXP || 0),
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
  }
}

export async function getEarnedBadgeIds(uid: string): Promise<Set<string>> {
  // On stocke les badge IDs dans un array sur le user doc pour simplifier
  const snap = await getDoc(doc(db, 'users', uid))
  if (!snap.exists()) return new Set()
  const badges: string[] = snap.data().earnedBadgeIds || []
  return new Set(badges)
}

// ── Cloud Function calls ──────────────────────────────────────
export async function callAwardXP(amount: number, source: string, detail?: string) {
  const fn = httpsCallable<{ amount: number; source: string; detail?: string }, { newXP: number; newLevel: number; leveledUp: boolean; newBadges: string[] }>(fbFn, 'awardXP')
  return fn({ amount, source, detail })
}

export async function callPrestige() {
  const fn = httpsCallable<void, { newPrestigeLevel: number; xpReset: number }>(fbFn, 'doPrestige')
  return fn()
}

export async function callCheckBadges() {
  const fn = httpsCallable<void, { newBadges: string[]; totalBadges: number }>(fbFn, 'checkBadges')
  return fn()
}

// ── Cosmetics update ──────────────────────────────────────────
export async function updateCosmetics(uid: string, updates: {
  activeFrame?: string | null
  activeTheme?: string | null
  activeTitle?: string | null
  pinnedBadges?: string[]
}) {
  await setDoc(doc(db, 'users', uid), updates, { merge: true })
}
