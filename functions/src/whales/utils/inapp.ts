import {getFirestore, FieldValue} from "firebase-admin/firestore";
import type {UserProfile, WhaleAlert} from "../types";
import {MAX_BATCH_SIZE} from "../config/constants";

const db = () => getFirestore();

/**
 * Crée une notification in-app pour chaque user éligible.
 * Stockée dans users/{uid}/notifications/{autoId}.
 * Le frontend écoute avec onSnapshot pour un affichage temps réel.
 */
export async function createInAppNotifications(
  users: UserProfile[],
  alert: WhaleAlert
): Promise<void> {
  if (users.length === 0) return;

  const payload = {
    type: "whale_alert" as const,
    txHash: alert.txHash,
    tokenSymbol: alert.tokenSymbol,
    usdValue: alert.usdValue,
    score: alert.score,
    scoreCategory: alert.scoreCategory,
    chain: alert.chain,
    read: false,
  };

  // Chunked batch pour respecter la limite Firestore
  for (let i = 0; i < users.length; i += MAX_BATCH_SIZE) {
    const batch = db().batch();

    for (const user of users.slice(i, i + MAX_BATCH_SIZE)) {
      const ref = db()
        .collection("users")
        .doc(user.uid)
        .collection("notifications")
        .doc(); // auto-id

      batch.set(ref, {...payload, createdAt: FieldValue.serverTimestamp()});
    }

    await batch.commit();
  }
}
