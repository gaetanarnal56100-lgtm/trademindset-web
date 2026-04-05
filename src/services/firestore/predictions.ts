// src/services/firestore/predictions.ts
// Collection globale (shared entre tous les utilisateurs)

import {
  collection, doc, addDoc, getDocs, runTransaction,
  query, where, orderBy, limit, Timestamp, setDoc,
} from 'firebase/firestore'
import { db } from '@/services/firebase/config'

// ── Types ──────────────────────────────────────────────────────
export type PredictionTimeframe = '1h' | '4h' | '24h' | '3d' | '7d'
export type PredictionStatus    = 'pending' | 'resolved' | 'expired'

export interface Prediction {
  id: string
  uid: string
  symbol: string
  assetType: 'crypto' | 'stock'
  currentPrice: number
  predictedPrice: number
  direction: 'up' | 'down'
  deltaPct: number           // % signé = (predictedPrice - currentPrice) / currentPrice * 100
  timeframe: PredictionTimeframe
  resolveAt: Timestamp
  status: PredictionStatus
  actualPrice?: number
  isCorrect?: boolean
  accuracy?: number          // |actual - predicted| / actual * 100
  xpEarned?: number
  createdAt: Timestamp
  displayName?: string       // anonymisé, ex: "J***"
}

export interface UserPredictionStats {
  predictionsTotal: number
  predictionsCorrect: number
  predictionStreak: number
  predictionBestAccuracy: number
  predictionDailyStreak: number
  predictionLastDate: string  // ISO date 'YYYY-MM-DD'
}

const COL = 'predictions'

// ── CRUD ──────────────────────────────────────────────────────

/** Crée une nouvelle prédiction dans la collection globale */
export async function createPrediction(p: Omit<Prediction, 'id'>): Promise<string> {
  const ref = await addDoc(collection(db, COL), p)
  return ref.id
}

/** Récupère toutes les prédictions d'un utilisateur (triées par date desc) */
export async function getUserPredictions(uid: string): Promise<Prediction[]> {
  const q = query(
    collection(db, COL),
    where('uid', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(100),
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Prediction))
}

/** Récupère les prédictions pending dont resolveAt <= maintenant */
export async function getPendingExpiredPredictions(uid: string): Promise<Prediction[]> {
  const q = query(
    collection(db, COL),
    where('uid', '==', uid),
    where('status', '==', 'pending'),
    where('resolveAt', '<=', Timestamp.now()),
    orderBy('resolveAt', 'asc'),
    limit(20),
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Prediction))
}

/** Récupère les prédictions communautaires pour un actif/timeframe (pour l'histogramme) */
export async function getCommunityPredictions(
  symbol: string,
  timeframe: string,
  maxDocs = 200,
): Promise<Prediction[]> {
  const q = query(
    collection(db, COL),
    where('symbol', '==', symbol),
    where('timeframe', '==', timeframe),
    where('status', '==', 'pending'),
    limit(maxDocs),
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Prediction))
}

/** Récupère les prédictions récentes de TOUS les utilisateurs (pour onglet Communauté) */
export async function getAllRecentPredictions(maxDocs = 500): Promise<Prediction[]> {
  const q = query(
    collection(db, COL),
    orderBy('createdAt', 'desc'),
    limit(maxDocs),
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Prediction))
}

/**
 * Résout une prédiction avec protection anti-doublon via transaction.
 * Ne met à jour que si status === 'pending'.
 */
export async function resolvePrediction(
  id: string,
  updates: Partial<Omit<Prediction, 'id' | 'uid'>>,
): Promise<boolean> {
  const ref = doc(db, COL, id)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) return false
    if (snap.data().status !== 'pending') return false // déjà résolu
    tx.update(ref, updates)
    return true
  })
}

/** Met à jour les stats de prédiction dans le document utilisateur */
export async function updateUserPredictionStats(
  uid: string,
  stats: Partial<UserPredictionStats>,
): Promise<void> {
  await setDoc(doc(db, 'users', uid), stats, { merge: true })
}
