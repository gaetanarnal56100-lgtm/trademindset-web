// src/services/firestore/index.ts
// Point d'entrée unique pour toutes les collections Firestore
// users/{uid}/trades | users/{uid}/systems | users/{uid}/moods

import {
  collection, doc, setDoc, getDocs, deleteDoc,
  query, orderBy, onSnapshot, Timestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { db } from '@/services/firebase/config'

// ── uid helper ─────────────────────────────────────────────────────────────
function getUid(): string {
  const u = getAuth().currentUser
  if (!u) throw new Error('Non authentifié')
  return u.uid
}

// ── Types ──────────────────────────────────────────────────────────────────

export type TradeType   = 'Long' | 'Short'
export type OrderRole   = 'Maker' | 'Taker'
export type Session     = 'US' | 'Asia' | 'Europe'
export type TradeStatus = 'open' | 'closed'
export type EmotionalState =
  'confident'|'stressed'|'impatient'|'fearful'|'greedy'|
  'calm'|'excited'|'frustrated'|'focused'|'distracted'
export type MoodContext = 'beforeTrade'|'afterTrade'|'duringTrade'|'general'

export interface Trade {
  id: string; date: Date; symbol: string; type: TradeType
  entryPrice?: number; exitPrice?: number; quantity?: number
  leverage: number; exchangeId: string; orderRole: OrderRole
  systemId: string; session: Session; flashPnLNet?: number
  notes?: string; tags: string[]; status: TradeStatus
  currentPrice?: number; lastPriceUpdate?: Date; closedAt?: Date
}

export interface TradingSystem { id: string; name: string; color: string }

export interface MoodEntry {
  id: string; emotionalState: EmotionalState; intensity: number
  timestamp: Date; context: MoodContext; tags: string[]
  isExceptional: boolean; tradeId?: string; notes?: string; aiSummary?: string
}

// ── PnL helper ─────────────────────────────────────────────────────────────
export function tradePnL(t: Trade): number {
  if (t.flashPnLNet != null) return t.flashPnLNet
  if (t.status === 'closed' && t.entryPrice && t.exitPrice && t.quantity) {
    const dir = t.type === 'Long' ? 1 : -1
    return dir * (t.exitPrice - t.entryPrice) * t.quantity * t.leverage
  }
  if (t.status === 'open' && t.entryPrice && t.currentPrice && t.quantity) {
    const dir = t.type === 'Long' ? 1 : -1
    return dir * (t.currentPrice - t.entryPrice) * t.quantity * t.leverage
  }
  return 0
}

// ── Decode helpers ─────────────────────────────────────────────────────────

function toDate(val: unknown): Date {
  if (!val) return new Date()
  if (val instanceof Date) return val
  if (typeof (val as any).toDate === 'function') return (val as any).toDate()
  if (typeof (val as any).seconds === 'number') return new Date((val as any).seconds * 1000)
  if (typeof val === 'number') return new Date(val)
  if (typeof val === 'string') { const d = new Date(val); return isNaN(d.getTime()) ? new Date() : d }
  return new Date()
}

function decodeTrade(data: Record<string, unknown>, id: string): Trade | null {
  try {
    return {
      id,
      date:            toDate(data.date ?? data.entryDate ?? data.closedAt),
      symbol:          (data.symbol as string) ?? '',
      type:            ((data.type as TradeType) ?? 'Long'),
      entryPrice:      data.entryPrice  as number | undefined,
      exitPrice:       data.exitPrice   as number | undefined,
      quantity:        data.quantity    as number | undefined,
      leverage:        (data.leverage   as number) ?? 1,
      exchangeId:      (data.exchangeId as string) ?? '',
      orderRole:       ((data.orderRole as OrderRole) ?? 'Taker'),
      systemId:        (data.systemId   as string) ?? '',
      session:         ((data.session   as Session) ?? 'US'),
      flashPnLNet:     data.flashPnLNet as number | undefined,
      notes:           data.notes       as string | undefined,
      tags:            (data.tags       as string[]) ?? [],
      status:          ((data.status    as TradeStatus) ?? 'closed'),
      currentPrice:    data.currentPrice as number | undefined,
      lastPriceUpdate: (data.lastPriceUpdate as Timestamp)?.toDate(),
      closedAt:        (data.closedAt   as Timestamp)?.toDate(),
    }
  } catch { return null }
}

function encodeTrade(t: Trade): Record<string, unknown> {
  const d: Record<string, unknown> = {
    id: t.id, date: Timestamp.fromDate(t.date),
    symbol: t.symbol, type: t.type, leverage: t.leverage,
    exchangeId: t.exchangeId, orderRole: t.orderRole,
    systemId: t.systemId, session: t.session,
    status: t.status, tags: t.tags,
  }
  if (t.entryPrice      != null) d.entryPrice      = t.entryPrice
  if (t.exitPrice       != null) d.exitPrice       = t.exitPrice
  if (t.quantity        != null) d.quantity        = t.quantity
  if (t.flashPnLNet     != null) d.flashPnLNet     = t.flashPnLNet
  if (t.notes           != null) d.notes           = t.notes
  if (t.currentPrice    != null) d.currentPrice    = t.currentPrice
  if (t.lastPriceUpdate != null) d.lastPriceUpdate = Timestamp.fromDate(t.lastPriceUpdate)
  if (t.closedAt        != null) d.closedAt        = Timestamp.fromDate(t.closedAt)
  return d
}

// ── Trades ─────────────────────────────────────────────────────────────────

export function subscribeTrades(cb: (trades: Trade[]) => void): Unsubscribe {
  const uid = getUid()
  const col = collection(db, 'users', uid, 'trades')
  return onSnapshot(query(col, orderBy('date', 'desc')), snap => {
    cb(snap.docs.flatMap(d => {
      const t = decodeTrade(d.data() as Record<string, unknown>, d.id)
      return t ? [t] : []
    }))
  }, err => console.error('🔥 subscribeTrades error:', err))
}

export async function createTrade(t: Trade): Promise<void> {
  const uid = getUid()
  await setDoc(doc(db, 'users', uid, 'trades', t.id), encodeTrade(t))
}

export async function updateTrade(t: Trade): Promise<void> {
  const uid = getUid()
  await setDoc(doc(db, 'users', uid, 'trades', t.id), encodeTrade(t), { merge: true })
}

export async function deleteTrade(id: string): Promise<void> {
  const uid = getUid()
  await deleteDoc(doc(db, 'users', uid, 'trades', id))
}

// ── Systems ────────────────────────────────────────────────────────────────

export function subscribeSystems(cb: (s: TradingSystem[]) => void): Unsubscribe {
  const uid = getUid()
  const col = collection(db, 'users', uid, 'systems')
  return onSnapshot(col, snap => {
    cb(snap.docs.flatMap(d => {
      const data = d.data()
      if (!data.name) return []
      return [{ id: d.id, name: data.name as string, color: (data.color as string) ?? '#00D9FF' }]
    }))
  }, err => console.error('🔥 subscribeSystems error:', err))
}

export async function createSystem(s: TradingSystem): Promise<void> {
  const uid = getUid()
  await setDoc(doc(db, 'users', uid, 'systems', s.id), { id: s.id, name: s.name, color: s.color })
}

export async function updateSystem(s: TradingSystem): Promise<void> {
  const uid = getUid()
  await setDoc(doc(db, 'users', uid, 'systems', s.id), { id: s.id, name: s.name, color: s.color }, { merge: true })
}

export async function deleteSystem(id: string): Promise<void> {
  const uid = getUid()
  await deleteDoc(doc(db, 'users', uid, 'systems', id))
}

// ── Moods ──────────────────────────────────────────────────────────────────

function encodeMood(m: MoodEntry): Record<string, unknown> {
  const d: Record<string, unknown> = {
    id: m.id, emotionalState: m.emotionalState,
    intensity: m.intensity, timestamp: Timestamp.fromDate(m.timestamp),
    context: m.context, tags: m.tags, isExceptional: m.isExceptional,
  }
  if (m.tradeId   != null) d.tradeId   = m.tradeId
  if (m.notes     != null) d.notes     = m.notes
  if (m.aiSummary != null) d.aiSummary = m.aiSummary
  return d
}

function decodeMood(data: Record<string, unknown>, id: string): MoodEntry | null {
  try {
    const ts = data.timestamp as Timestamp
    return {
      id,
      emotionalState: (data.emotionalState as EmotionalState) ?? 'calm',
      intensity:      (data.intensity      as number) ?? 5,
      timestamp:      ts?.toDate() ?? new Date(),
      context:        (data.context        as MoodContext) ?? 'general',
      tags:           (data.tags           as string[]) ?? [],
      isExceptional:  (data.isExceptional  as boolean) ?? false,
      tradeId:        data.tradeId         as string | undefined,
      notes:          data.notes           as string | undefined,
      aiSummary:      data.aiSummary       as string | undefined,
    }
  } catch { return null }
}

export function subscribeMoods(cb: (m: MoodEntry[]) => void): Unsubscribe {
  const uid = getUid()
  const col = collection(db, 'users', uid, 'moods')
  return onSnapshot(query(col, orderBy('timestamp', 'desc')), snap => {
    cb(snap.docs.flatMap(d => {
      const m = decodeMood(d.data() as Record<string, unknown>, d.id)
      return m ? [m] : []
    }))
  }, err => console.error('🔥 subscribeMoods error:', err))
}

export async function createMood(m: MoodEntry): Promise<void> {
  const uid = getUid()
  await setDoc(doc(db, 'users', uid, 'moods', m.id), encodeMood(m))
}

export async function deleteMood(id: string): Promise<void> {
  const uid = getUid()
  await deleteDoc(doc(db, 'users', uid, 'moods', id))
}

// ── Exchanges (lecture seule) ──────────────────────────────────────────────
// Pour afficher le nom de l'exchange dans les trades

export interface Exchange { id: string; name: string; isDefault: boolean; makerFeeRate: number; takerFeeRate: number }

export function subscribeExchanges(cb: (e: Exchange[]) => void): Unsubscribe {
  const uid = getUid()
  const col = collection(db, 'users', uid, 'exchanges')
  return onSnapshot(col, snap => {
    cb(snap.docs.flatMap(d => {
      const data = d.data()
      if (!data.name) return []
      return [{
        id: d.id,
        name: data.name as string,
        isDefault: (data.isDefault as boolean) ?? false,
        makerFeeRate: (data.makerFeeRate as number) ?? 0,
        takerFeeRate: (data.takerFeeRate as number) ?? 0,
      }]
    }))
  })
}
