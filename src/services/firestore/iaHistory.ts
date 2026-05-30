import { getFirestore, collection, addDoc, getDocs, query, orderBy, limit, doc, updateDoc } from 'firebase/firestore'
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
  timestamp: number
  bias: string
  score: number
  conviction: number
  horizon: string
  entryPrice: number
  targets: { tp1: string; tp2: string; sl: string }
  trades: IaTrade[]
  outcome?: 'tp1_hit' | 'tp2_hit' | 'sl_hit' | 'open' | 'expired'
  outcomeR?: number
  outcomeCheckedAt?: number
}

// ── Per-user history ─────────────────────────────────────────────────────────

export async function saveIaAnalysis(record: Omit<IaAnalysisRecord, 'id'>): Promise<string> {
  // Save to user's private collection
  const ref = await addDoc(
    collection(db, 'users', record.uid, 'iaHistory'),
    { ...record, outcome: 'open' }
  )
  // Save anonymized copy to global collection (no uid)
  const { uid, ...anon } = record
  void addDoc(collection(db, 'iaHistory'), { ...anon, outcome: 'open' })
  return ref.id
}

export async function getIaHistory(uid: string, symbol?: string, limitN = 100): Promise<IaAnalysisRecord[]> {
  const q = query(collection(db, 'users', uid, 'iaHistory'), orderBy('timestamp', 'desc'), limit(limitN))
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

// ── Global history (all users, anonymized) ───────────────────────────────────

export interface IaGlobalRecord extends Omit<IaAnalysisRecord, 'uid'> {}

export async function getGlobalIaHistory(symbol?: string, limitN = 500): Promise<IaGlobalRecord[]> {
  const q = query(collection(db, 'iaHistory'), orderBy('timestamp', 'desc'), limit(limitN))
  const snap = await getDocs(q)
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as IaGlobalRecord))
  return symbol ? all.filter(r => r.symbol === symbol) : all
}

export async function updateGlobalIaOutcome(
  id: string,
  outcome: IaAnalysisRecord['outcome'], outcomeR: number
): Promise<void> {
  await updateDoc(doc(db, 'iaHistory', id), {
    outcome, outcomeR, outcomeCheckedAt: Date.now()
  })
}
