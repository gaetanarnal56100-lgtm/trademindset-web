// src/services/firebase/trades.ts
// Miroir de Services/Storage/Firestore/FirestoreTradeStore.swift

import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  getDocs, getDoc, query, where, orderBy,
  onSnapshot, serverTimestamp, Timestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from './config'
import type { Trade } from '@/types'

function col(uid: string) {
  return collection(db, 'users', uid, 'trades')
}

function toFirestore(t: Omit<Trade, 'id' | 'createdAt' | 'updatedAt'>) {
  return {
    ...t,
    entryDate: Timestamp.fromDate(t.entryDate),
    exitDate:  t.exitDate ? Timestamp.fromDate(t.exitDate) : null,
    updatedAt: serverTimestamp(),
  }
}

function fromFirestore(id: string, d: Record<string, unknown>): Trade {
  return {
    ...(d as Omit<Trade, 'id' | 'entryDate' | 'exitDate' | 'createdAt' | 'updatedAt'>),
    id,
    entryDate:  (d.entryDate as Timestamp)?.toDate() ?? new Date(),
    exitDate:   (d.exitDate as Timestamp)?.toDate(),
    createdAt:  (d.createdAt as Timestamp)?.toDate() ?? new Date(),
    updatedAt:  (d.updatedAt as Timestamp)?.toDate() ?? new Date(),
  }
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function createTrade(uid: string, trade: Omit<Trade, 'id' | 'userId' | 'createdAt' | 'updatedAt'>) {
  const ref = await addDoc(col(uid), {
    ...toFirestore(trade),
    userId:    uid,
    createdAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateTrade(uid: string, trade: Trade) {
  await updateDoc(doc(col(uid), trade.id), toFirestore(trade))
}

export async function deleteTrade(uid: string, tradeId: string) {
  await deleteDoc(doc(col(uid), tradeId))
}

export async function fetchTrades(uid: string): Promise<Trade[]> {
  const snap = await getDocs(query(col(uid), orderBy('entryDate', 'desc')))
  return snap.docs.map(d => fromFirestore(d.id, d.data()))
}

export async function fetchTrade(uid: string, tradeId: string): Promise<Trade | null> {
  const snap = await getDoc(doc(col(uid), tradeId))
  return snap.exists() ? fromFirestore(snap.id, snap.data()) : null
}

// ── Real-time listener ─────────────────────────────────────────────────────

export function subscribeToTrades(
  uid: string,
  onUpdate: (trades: Trade[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    query(col(uid), orderBy('entryDate', 'desc')),
    snap => onUpdate(snap.docs.map(d => fromFirestore(d.id, d.data()))),
    err  => onError?.(err)
  )
}

// ── Queries ────────────────────────────────────────────────────────────────

export async function fetchTradesBySymbol(uid: string, symbol: string): Promise<Trade[]> {
  const snap = await getDocs(
    query(col(uid), where('symbol', '==', symbol), orderBy('entryDate', 'desc'))
  )
  return snap.docs.map(d => fromFirestore(d.id, d.data()))
}

export async function fetchTradesBySystem(uid: string, systemId: string): Promise<Trade[]> {
  const snap = await getDocs(
    query(col(uid), where('systemId', '==', systemId), orderBy('entryDate', 'desc'))
  )
  return snap.docs.map(d => fromFirestore(d.id, d.data()))
}
