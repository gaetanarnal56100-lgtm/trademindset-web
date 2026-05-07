// customAlerts.ts — Firestore CRUD for custom alert configs + Discord webhook settings
import {
  collection, doc, getDocs, setDoc, deleteDoc, getDoc, addDoc,
  query, orderBy, limit as fsLimit,
} from 'firebase/firestore'
import { db } from '@/services/firebase/config'

// ── Types ──────────────────────────────────────────────────────────────────

export type ConditionType = 'rsi_lt' | 'rsi_gt' | 'price_lt' | 'price_gt'
export type AlertTF = '1m' | '5m' | '15m' | '1h' | '4h' | '1d'

export interface AlertCondition {
  type: ConditionType
  timeframe: AlertTF
  value: number
}

export interface CustomAlert {
  id: string
  name: string
  symbol: string
  enabled: boolean
  conditions: AlertCondition[]
  cooldownMinutes: number
  lastTriggered?: number
  createdAt: number
}

export interface AlertHistoryEntry {
  id?: string
  alertId: string
  alertName: string
  symbol: string
  triggeredAt: number
  conditionMet: string
}

export interface NotifSettings {
  discordWebhook?: string
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function getCustomAlerts(uid: string): Promise<CustomAlert[]> {
  const snap = await getDocs(collection(db, 'users', uid, 'customAlerts'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as CustomAlert))
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function saveCustomAlert(uid: string, alert: CustomAlert): Promise<void> {
  await setDoc(doc(db, 'users', uid, 'customAlerts', alert.id), alert)
}

export async function deleteCustomAlert(uid: string, alertId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'customAlerts', alertId))
}

export async function getAlertHistory(uid: string, lim = 20): Promise<AlertHistoryEntry[]> {
  const q = query(
    collection(db, 'users', uid, 'alertHistory'),
    orderBy('triggeredAt', 'desc'),
    fsLimit(lim),
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as AlertHistoryEntry))
}

export async function addAlertHistory(uid: string, entry: Omit<AlertHistoryEntry, 'id'>): Promise<void> {
  await addDoc(collection(db, 'users', uid, 'alertHistory'), entry)
}

export async function getNotifSettings(uid: string): Promise<NotifSettings> {
  const snap = await getDoc(doc(db, 'users', uid, 'settings', 'notifications'))
  return snap.exists() ? (snap.data() as NotifSettings) : {}
}

export async function saveNotifSettings(uid: string, settings: NotifSettings): Promise<void> {
  await setDoc(doc(db, 'users', uid, 'settings', 'notifications'), settings, { merge: true })
}
