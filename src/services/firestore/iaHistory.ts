import { getFirestore, collection, addDoc, getDocs, query, orderBy, limit, where, doc, updateDoc } from 'firebase/firestore'
import app from '@/services/firebase/config'

const db = getFirestore(app)

export interface IaTrade {
  label: string; direction: 'LONG' | 'SHORT'
  entry: string; tp1: string; tp2: string; sl: string
  rr: string; probability: number; horizon: string; rationale: string
}

export interface IaAnalysisRecord {
  id?: string
  uid: string
  symbol: string
  timestamp: number       // ms — when analysis was run
  bias: string
  score: number
  conviction: number
  horizon: string
  entryPrice: number      // current price at time of analysis
  targets: { tp1: string; tp2: string; sl: string }
  trades: IaTrade[]
  // backtest outcome (filled later)
  outcome?: 'tp1_hit' | 'tp2_hit' | 'sl_hit' | 'open' | 'expired'
  outcomeR?: number       // R multiple achieved
  outcomeCheckedAt?: number
}

export async function saveIaAnalysis(record: Omit<IaAnalysisRecord, 'id'>): Promise<string> {
  const ref = await addDoc(
    collection(db, 'users', record.uid, 'iaHistory'),
    { ...record, outcome: 'open' }
  )
  return ref.id
}

export async function getIaHistory(uid: string, symbol?: string, limitN = 100): Promise<IaAnalysisRecord[]> {
  const col = collection(db, 'users', uid, 'iaHistory')
  // No composite index needed — fetch all, filter client-side
  const q = query(col, orderBy('timestamp', 'desc'), limit(limitN))
  const snap = await getDocs(q)
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as IaAnalysisRecord))
  return symbol ? all.filter(r => r.symbol === symbol) : all
}

export async function updateIaOutcome(
  uid: string, id: string,
  outcome: IaAnalysisRecord['outcome'], outcomeR: number
): Promise<void> {
  await updateDoc(doc(db, 'users', uid, 'iaHistory', id), {
    outcome, outcomeR, outcomeCheckedAt: Date.now()
  })
}
