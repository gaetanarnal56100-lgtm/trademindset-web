// src/services/predictions/resolutionService.ts
// Récupération des prix + résolution des prédictions expirées + attribution XP

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'
import { callAwardXP } from '@/services/gamification/prestigeEngine'
import {
  getPendingExpiredPredictions, resolvePrediction, updateUserPredictionStats,
  type Prediction, type UserPredictionStats,
} from '@/services/firestore/predictions'
import { doc, getDoc, Timestamp } from 'firebase/firestore'
import { db } from '@/services/firebase/config'

const fbFn = getFunctions(app, 'europe-west1')

export const TF_MS: Record<string, number> = {
  '1h':  3_600_000,
  '4h':  14_400_000,
  '24h': 86_400_000,
  '3d':  259_200_000,
  '7d':  604_800_000,
}

export interface ResolvedSummary {
  prediction: Prediction
  actualPrice: number
  isCorrect: boolean
  accuracy: number
  xpEarned: number
}

// ── Prix Binance ───────────────────────────────────────────────
export async function fetchCryptoPrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`,
    )
    if (!res.ok) return null
    const data = await res.json()
    return parseFloat(data.price)
  } catch {
    return null
  }
}

// ── Prix Yahoo Finance (via CF) ────────────────────────────────
export async function fetchStockPrice(symbol: string): Promise<number | null> {
  try {
    const fn = httpsCallable<
      { symbol: string; interval: string; range: string },
      { candles: { t: number; o: number; h: number; l: number; c: number; v: number }[] }
    >(fbFn, 'fetchYahooCandles')
    const res = await fn({ symbol, interval: '1d', range: '5d' })
    const candles = res.data?.candles
    if (!candles?.length) return null
    return candles[candles.length - 1].c
  } catch {
    return null
  }
}

// ── Logique XP ─────────────────────────────────────────────────
export function computeXP(isCorrect: boolean, accuracy: number): number {
  if (!isCorrect) return 0
  let xp = 5
  if (accuracy <= 1)   xp += 8
  if (accuracy <= 0.5) xp += 15
  if (accuracy <= 0.1) xp += 30
  return xp
}

// ── Mise à jour du daily streak ────────────────────────────────
function updateDailyStreak(
  stats: UserPredictionStats,
  today: string,
): UserPredictionStats {
  const last = stats.predictionLastDate
  let dailyStreak = stats.predictionDailyStreak

  if (!last) {
    dailyStreak = 1
  } else {
    const lastDate = new Date(last)
    const todayDate = new Date(today)
    const diffDays = Math.round(
      (todayDate.getTime() - lastDate.getTime()) / 86_400_000,
    )
    if (diffDays === 0) {
      // Déjà prédit aujourd'hui — streak inchangé
    } else if (diffDays === 1) {
      dailyStreak = dailyStreak + 1
    } else {
      dailyStreak = 1 // rupture
    }
  }
  return { ...stats, predictionDailyStreak: dailyStreak, predictionLastDate: today }
}

// ── Résolution principale ──────────────────────────────────────

/**
 * Charge et résout toutes les prédictions expirées de l'utilisateur.
 * Appelle callAwardXP pour chaque palier atteint.
 * Retourne un tableau de résumés pour afficher les toasts.
 */
export async function resolveExpiredPredictions(uid: string): Promise<ResolvedSummary[]> {
  const expired = await getPendingExpiredPredictions(uid)
  if (expired.length === 0) return []

  // Récupérer les stats actuelles de l'utilisateur
  const userSnap = await getDoc(doc(db, 'users', uid))
  const userData = userSnap.exists() ? userSnap.data() : {}
  let stats: UserPredictionStats = {
    predictionsTotal:       userData.predictionsTotal       ?? 0,
    predictionsCorrect:     userData.predictionsCorrect     ?? 0,
    predictionStreak:       userData.predictionStreak       ?? 0,
    predictionBestAccuracy: userData.predictionBestAccuracy ?? 100,
    predictionDailyStreak:  userData.predictionDailyStreak  ?? 0,
    predictionLastDate:     userData.predictionLastDate     ?? '',
  }

  const summaries: ResolvedSummary[] = []

  for (const pred of expired) {
    // 1. Récupérer le prix actuel
    const actualPrice = pred.assetType === 'crypto'
      ? await fetchCryptoPrice(pred.symbol)
      : await fetchStockPrice(pred.symbol)

    if (actualPrice === null) {
      // Impossible de résoudre → marquer expired
      await resolvePrediction(pred.id, { status: 'expired' })
      continue
    }

    // 2. Calculer résultat
    const isCorrect =
      (pred.direction === 'up' && actualPrice > pred.currentPrice) ||
      (pred.direction === 'down' && actualPrice < pred.currentPrice)
    const accuracy =
      Math.abs(actualPrice - pred.predictedPrice) / actualPrice * 100
    const xpEarned = computeXP(isCorrect, accuracy)

    // 3. Résoudre (transaction anti-doublon)
    const resolved = await resolvePrediction(pred.id, {
      status: 'resolved',
      actualPrice,
      isCorrect,
      accuracy,
      xpEarned,
    })
    if (!resolved) continue // déjà résolu par un autre onglet

    // 4. Award XP
    if (isCorrect) {
      await callAwardXP(5,  'prediction_correct',      pred.id)
      if (accuracy <= 1)   await callAwardXP(8,  'prediction_accurate_1',   pred.id)
      if (accuracy <= 0.5) await callAwardXP(15, 'prediction_accurate_0_5', pred.id)
      if (accuracy <= 0.1) await callAwardXP(30, 'prediction_oracle',       pred.id)
    }

    // 5. Mettre à jour les stats
    stats = {
      ...stats,
      predictionsCorrect:     stats.predictionsCorrect + (isCorrect ? 1 : 0),
      predictionStreak:       isCorrect ? stats.predictionStreak + 1 : 0,
      predictionBestAccuracy: isCorrect
        ? Math.min(stats.predictionBestAccuracy, accuracy)
        : stats.predictionBestAccuracy,
    }

    summaries.push({ prediction: pred, actualPrice, isCorrect, accuracy, xpEarned })
  }

  // 6. Persister les stats (une seule écriture)
  if (summaries.length > 0) {
    await updateUserPredictionStats(uid, stats)
  }

  return summaries
}

/**
 * Met à jour les stats après une soumission de prédiction.
 * À appeler depuis PredictPage après createPrediction().
 */
export async function recordSubmitStats(uid: string): Promise<void> {
  const userSnap = await getDoc(doc(db, 'users', uid))
  const d = userSnap.exists() ? userSnap.data() : {}
  const today = new Date().toISOString().slice(0, 10)
  const current: UserPredictionStats = {
    predictionsTotal:       d.predictionsTotal       ?? 0,
    predictionsCorrect:     d.predictionsCorrect     ?? 0,
    predictionStreak:       d.predictionStreak       ?? 0,
    predictionBestAccuracy: d.predictionBestAccuracy ?? 100,
    predictionDailyStreak:  d.predictionDailyStreak  ?? 0,
    predictionLastDate:     d.predictionLastDate     ?? '',
  }
  const updated = updateDailyStreak(
    { ...current, predictionsTotal: current.predictionsTotal + 1 },
    today,
  )
  await updateUserPredictionStats(uid, updated)
}
