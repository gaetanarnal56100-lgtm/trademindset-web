import {getFirestore, FieldValue} from "firebase-admin/firestore";
import type {WhaleAlert, UserProfile, ScannerState} from "../types";
import {MAX_BATCH_SIZE} from "../config/constants";

const db = () => getFirestore();

// ── Références ─────────────────────────────────────────────────────────────────

export const alertsCol = () => db().collection("alerts");
export const usersCol = () => db().collection("users");
export const stateRef = (id: string) => db().collection("scanner_state").doc(id);

// ── Scanner state ──────────────────────────────────────────────────────────────

export async function getScannerState(id: string): Promise<ScannerState> {
  const snap = await stateRef(id).get();
  if (!snap.exists) return {lastBlockByContract: {}, lastScanAt: null};
  return snap.data() as ScannerState;
}

export async function updateScannerState(
  id: string,
  blockUpdates: Record<string, number>
): Promise<void> {
  await stateRef(id).set(
    {lastBlockByContract: blockUpdates, lastScanAt: FieldValue.serverTimestamp()},
    {merge: true}
  );
}

// ── Déduplication ──────────────────────────────────────────────────────────────
//
// db.getAll() = 1 opération par document (pas N round-trips réseau).
// Coût Firestore : 1 read × nb de candidats — très économique.

export async function filterNewAlerts(alerts: WhaleAlert[]): Promise<WhaleAlert[]> {
  if (alerts.length === 0) return [];

  const refs = alerts.map((a) => alertsCol().doc(a.txHash));
  const snapshots = await db().getAll(...refs);

  const existing = new Set(snapshots.filter((s) => s.exists).map((s) => s.id));
  return alerts.filter((a) => !existing.has(a.txHash));
}

// ── Batch write ────────────────────────────────────────────────────────────────
//
// Chunked en tranches de MAX_BATCH_SIZE pour respecter la limite Firestore (500 ops).
// Chaque write déclenche le trigger onDocumentCreated → notifications.

export async function batchWriteAlerts(alerts: WhaleAlert[]): Promise<number> {
  if (alerts.length === 0) return 0;

  let written = 0;

  for (let i = 0; i < alerts.length; i += MAX_BATCH_SIZE) {
    const chunk = alerts.slice(i, i + MAX_BATCH_SIZE);
    const batch = db().batch();

    for (const alert of chunk) {
      batch.set(alertsCol().doc(alert.txHash), {
        ...alert,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
    written += chunk.length;
  }

  return written;
}

// ── Users ──────────────────────────────────────────────────────────────────────

export async function getActiveUsers(): Promise<UserProfile[]> {
  const snap = await usersCol()
    .where("alertsEnabled", "==", true)
    .get();

  return snap.docs.map((d) => ({uid: d.id, ...d.data()} as UserProfile));
}

export function filterUsersForAlert(
  users: UserProfile[],
  alert: WhaleAlert
): UserProfile[] {
  return users.filter((u) => {
    if (!u.telegramId) return false;
    if (alert.usdValue < (u.threshold ?? 500_000)) return false;
    if (u.tokens?.length > 0 && !u.tokens.includes(alert.tokenSymbol)) return false;
    return true;
  });
}
