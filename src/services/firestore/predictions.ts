// src/services/firestore/predictions.ts
// Collection globale (shared entre tous les utilisateurs)

import {
  collection, doc, addDoc, getDocs, getDoc, runTransaction,
  query, where, orderBy, limit, Timestamp, setDoc, increment,
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
  // ── USDT virtuel ──────────────────────────────────────────────
  stake?: number             // montant misé (0 ou absent = pas de pari)
  odds?: number              // toujours 1.9 — stocké pour flexibilité future
  potentialWin?: number      // stake * 1.9 (pré-calculé)
  balanceChange?: number     // +stake*0.9 si correct, -stake si incorrect (rempli à la résolution)
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

// ── USDT Virtuel ───────────────────────────────────────────────

const VIRTUAL_USDT_INIT = 1000
const REFILL_AMOUNT      = 200
const REFILL_THRESHOLD   = 50  // solde < 50 → éligible à la recharge

/**
 * Récupère le solde USDT virtuel de l'utilisateur.
 * Initialise à 1000 USDT si le champ est absent (lazy init).
 */
export async function getVirtualBalance(uid: string): Promise<number> {
  const snap = await getDoc(doc(db, 'users', uid))
  if (!snap.exists()) return VIRTUAL_USDT_INIT
  const d = snap.data()
  if (d.virtualUSDT == null) {
    // Première fois — initialiser à 1000
    await setDoc(doc(db, 'users', uid), { virtualUSDT: VIRTUAL_USDT_INIT }, { merge: true })
    return VIRTUAL_USDT_INIT
  }
  return d.virtualUSDT as number
}

/**
 * Incrémente (ou décrémente) le solde USDT virtuel de façon atomique.
 * delta positif = crédit, négatif = débit.
 */
export async function updateVirtualBalance(uid: string, delta: number): Promise<void> {
  await setDoc(doc(db, 'users', uid), { virtualUSDT: increment(delta) }, { merge: true })
}

/**
 * Réclame la recharge quotidienne de 200 USDT si :
 * - solde < REFILL_THRESHOLD
 * - pas déjà réclamé aujourd'hui
 * Retourne true si la recharge a été accordée.
 */
export async function claimDailyRefill(uid: string): Promise<boolean> {
  const snap = await getDoc(doc(db, 'users', uid))
  const d = snap.exists() ? snap.data() : {}
  const balance: number = d.virtualUSDT ?? VIRTUAL_USDT_INIT
  if (balance >= REFILL_THRESHOLD) return false
  const today = new Date().toISOString().slice(0, 10)
  if (d.virtualUSDTLastRefill === today) return false
  await setDoc(doc(db, 'users', uid), {
    virtualUSDT: increment(REFILL_AMOUNT),
    virtualUSDTLastRefill: today,
  }, { merge: true })
  return true
}
