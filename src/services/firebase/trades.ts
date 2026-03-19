// src/services/firebase/trades.ts
// Compatible avec appStore (uid passé en paramètre) ET firestore/index.ts (uid depuis auth)

import { db } from './config'
import {
  collection, doc, setDoc, deleteDoc,
  query, orderBy, onSnapshot, Timestamp,
  type Unsubscribe,
} from 'firebase/firestore'

// ── subscribeToTrades (utilisé par appStore) ───────────────────────────────
export const subscribeToTrades = (
  uid: string,
  callback: (trades: any[]) => void,
  onError?: (err: Error) => void
): Unsubscribe | undefined => {
  if (!uid) return undefined

  const ref = collection(db, 'users', uid, 'trades')

  function safeDate(val: unknown): Date {
    if (!val) return new Date(0)
    if (val instanceof Date) return isNaN(val.getTime()) ? new Date(0) : val
    if (typeof (val as any).toDate === 'function') { try { return (val as any).toDate() } catch {} }
    if (typeof (val as any).seconds === 'number') return new Date((val as any).seconds * 1000)
    if (typeof (val as any)._seconds === 'number') return new Date((val as any)._seconds * 1000)
    return new Date(0)
  }

  return onSnapshot(query(ref), (snapshot) => {
    const trades = snapshot.docs.map(doc => {
      const data = doc.data()
      return {
        id:         doc.id,
        date:       safeDate(data.date ?? data.entryDate ?? data.closedAt ?? data.timestamp ?? data.createdAt),
        closedAt:   data.closedAt ? safeDate(data.closedAt) : undefined,
        symbol:     data.symbol,
        type:       data.type,
        entryPrice: data.entryPrice,
        exitPrice:  data.exitPrice,
        quantity:   data.quantity,
        leverage:   data.leverage ?? 1,
        exchangeId: data.exchangeId,
        orderRole:  data.orderRole,
        systemId:   data.systemId,
        session:    data.session,
        status:     data.status ?? 'closed',
        flashPnLNet:data.flashPnLNet,
        notes:      data.notes,
        tags:       data.tags ?? [],
        pnl: data.flashPnLNet ??
          (data.exitPrice && data.entryPrice && data.quantity
            ? (data.type === 'Long' ? 1 : -1) * (data.exitPrice - data.entryPrice) * data.quantity * (data.leverage ?? 1)
            : 0),
      }
    })
    trades.sort((a, b) => {
      const at = a.date instanceof Date && !isNaN(a.date.getTime()) ? a.date.getTime() : 0
      const bt = b.date instanceof Date && !isNaN(b.date.getTime()) ? b.date.getTime() : 0
      return bt - at
    })
    console.log('🔥 Trades Firestore:', trades.length)
    callback(trades)
  }, (err) => {
    console.error('🔥 subscribeToTrades error:', err)
    onError?.(err)
  })
}

// ── CRUD avec uid (utilisé par appStore) ───────────────────────────────────

function encodeTrade(trade: any): Record<string, unknown> {
  const d: Record<string, unknown> = {
    id:         trade.id,
    date:       trade.date instanceof Date ? Timestamp.fromDate(trade.date) : trade.date,
    symbol:     trade.symbol,
    type:       trade.type,
    leverage:   trade.leverage ?? 1,
    exchangeId: trade.exchangeId ?? '',
    orderRole:  trade.orderRole ?? 'Taker',
    systemId:   trade.systemId ?? '',
    session:    trade.session ?? 'US',
    status:     trade.status ?? 'closed',
    tags:       trade.tags ?? [],
  }
  if (trade.entryPrice  != null) d.entryPrice   = trade.entryPrice
  if (trade.exitPrice   != null) d.exitPrice    = trade.exitPrice
  if (trade.quantity    != null) d.quantity     = trade.quantity
  if (trade.flashPnLNet != null) d.flashPnLNet  = trade.flashPnLNet
  if (trade.notes       != null) d.notes        = trade.notes
  if (trade.closedAt    != null) d.closedAt     = trade.closedAt instanceof Date ? Timestamp.fromDate(trade.closedAt) : trade.closedAt
  return d
}

export const createTrade = async (uid: string, trade: any): Promise<void> => {
  const id = trade.id || crypto.randomUUID()
  await setDoc(doc(db, 'users', uid, 'trades', id), encodeTrade({ ...trade, id }))
}

export const updateTrade = async (uid: string, trade: any): Promise<void> => {
  await setDoc(doc(db, 'users', uid, 'trades', trade.id), encodeTrade(trade), { merge: true })
}

export const deleteTrade = async (uid: string, tradeId: string): Promise<void> => {
  await deleteDoc(doc(db, 'users', uid, 'trades', tradeId))
}
