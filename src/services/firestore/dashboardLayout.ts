// ─── Dashboard Layout — Firestore Service ────────────────────────────────────
// Persists the modular dashboard layout under:
//   users/{uid}/settings/dashboardLayout
// Single document, merged on every write → no conflicts, cheap reads.

import {
  doc, getDoc, setDoc, onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { db } from '@/services/firebase/config'
import type { LayoutItem, PresetName } from '@/pages/dashboard/modular/types'

// ── Document shape stored in Firestore ───────────────────────────────────────
export interface DashboardLayoutDoc {
  layout: LayoutItem[]
  activePreset: PresetName
  symbol: string
  updatedAt: number // epoch ms — used to detect stale localStorage cache
}

function getUserSettingsRef(uid: string) {
  return doc(db, 'users', uid, 'settings', 'dashboardLayout')
}

function getUid(): string | null {
  return getAuth().currentUser?.uid ?? null
}

// ── Save layout to Firestore (debounced at call-site) ────────────────────────
export async function saveDashboardLayout(data: DashboardLayoutDoc): Promise<void> {
  const uid = getUid()
  if (!uid) return
  try {
    await setDoc(getUserSettingsRef(uid), { ...data, updatedAt: Date.now() }, { merge: true })
    // Notify UI components that a sync completed
    window.dispatchEvent(new Event('dashboard:synced'))
  } catch (err) {
    console.warn('[DashboardLayout] Firestore write failed:', err)
  }
}

// ── Load layout once (used on first mount) ───────────────────────────────────
export async function loadDashboardLayout(): Promise<DashboardLayoutDoc | null> {
  const uid = getUid()
  if (!uid) return null
  try {
    const snap = await getDoc(getUserSettingsRef(uid))
    if (snap.exists()) return snap.data() as DashboardLayoutDoc
  } catch (err) {
    console.warn('[DashboardLayout] Firestore read failed:', err)
  }
  return null
}

// ── Real-time listener (optional — for multi-device sync) ────────────────────
export function subscribeDashboardLayout(
  callback: (data: DashboardLayoutDoc) => void
): Unsubscribe {
  const uid = getUid()
  if (!uid) return () => {}
  return onSnapshot(
    getUserSettingsRef(uid),
    (snap) => { if (snap.exists()) callback(snap.data() as DashboardLayoutDoc) },
    (err) => console.warn('[DashboardLayout] Firestore listener error:', err)
  )
}
