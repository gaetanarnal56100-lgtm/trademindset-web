// src/services/firestore/polyBot.ts — Polymarket Bot settings + trades CRUD
import { doc, getDoc, setDoc, collection, getDocs, addDoc, query, orderBy, limit, onSnapshot, Unsubscribe } from 'firebase/firestore'
import { db } from '@/services/firebase/config'

// ── Types ──────────────────────────────────────────────────────────────────

export interface PolyBotSettings {
  enabled: boolean
  mode: 'paper' | 'live'
  capital: number
  // Live mode only — stored in Firestore (user accepts risk)
  apiKey?: string
  apiSecret?: string
  apiPassphrase?: string
  privateKey?: string
  depositWallet?: string
}

export interface BotTrade {
  id?: string
  marketId: string
  question: string
  symbol: string
  side: 'YES' | 'NO'
  price: number
  sizeUsd: number
  openedAt: number   // ms timestamp
  closedAt?: number
  exitPrice?: number
  pnl?: number
  status: 'open' | 'won' | 'lost'
  edge: number
  impliedProb: number
}

export interface BotStats {
  capital: number
  totalPnl: number
  trades: number
  wins: number
  losses: number
}

// ── Default settings ───────────────────────────────────────────────────────

const DEFAULT_SETTINGS: PolyBotSettings = {
  enabled: false,
  mode: 'paper',
  capital: 1000,
}

// ── Firestore CRUD ─────────────────────────────────────────────────────────

export async function getBotSettings(uid: string): Promise<PolyBotSettings> {
  try {
    const ref = doc(db, 'users', uid, 'settings', 'polyBot')
    const snap = await getDoc(ref)
    if (!snap.exists()) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...snap.data() } as PolyBotSettings
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveBotSettings(uid: string, settings: Partial<PolyBotSettings>): Promise<void> {
  const ref = doc(db, 'users', uid, 'settings', 'polyBot')
  await setDoc(ref, settings, { merge: true })
}

export async function getBotTrades(uid: string, maxItems = 20): Promise<BotTrade[]> {
  try {
    const ref = collection(db, 'users', uid, 'botTrades')
    const q = query(ref, orderBy('openedAt', 'desc'), limit(maxItems))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as BotTrade))
  } catch {
    return []
  }
}

export function listenBotTrades(uid: string, cb: (trades: BotTrade[]) => void, maxItems = 30): Unsubscribe {
  const ref = collection(db, 'users', uid, 'botTrades')
  const q = query(ref, orderBy('openedAt', 'desc'), limit(maxItems))
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as BotTrade)))
  }, () => cb([]))
}

export async function addBotTrade(uid: string, trade: Omit<BotTrade, 'id'>): Promise<string> {
  const ref = collection(db, 'users', uid, 'botTrades')
  const docRef = await addDoc(ref, trade)
  return docRef.id
}

export function computeStats(trades: BotTrade[], settings: PolyBotSettings): BotStats {
  const closed = trades.filter(t => t.status !== 'open')
  const wins   = closed.filter(t => t.status === 'won')
  const losses = closed.filter(t => t.status === 'lost')
  const totalPnl = closed.reduce((acc, t) => acc + (t.pnl ?? 0), 0)
  return {
    capital: settings.capital + totalPnl,
    totalPnl,
    trades: closed.length,
    wins: wins.length,
    losses: losses.length,
  }
}
