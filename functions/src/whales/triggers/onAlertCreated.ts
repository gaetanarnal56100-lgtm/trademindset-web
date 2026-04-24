import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {getFirestore, FieldValue} from "firebase-admin/firestore";

import {getActiveUsers, filterUsersForAlert} from "../utils/firestore";
import {createInAppNotifications} from "../utils/inapp";
import type {WhaleAlert} from "../types";

export const onWhaleAlertCreated = onDocumentCreated(
  {
    document: "alerts/{txHash}",
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "128MiB",
  },
  async (event) => {
    const alert = event.data?.data() as WhaleAlert | undefined;
    if (!alert) return;

    const txHash = event.params.txHash;
    const db = getFirestore();

    console.log(
      `[onAlertCreated] ${txHash}` +
      ` | ${alert.tokenSymbol}` +
      ` | $${alert.usdValue.toLocaleString("en-US")}` +
      ` | score=${alert.score} (${alert.scoreCategory})`
    );

    try {
      // 1. Charger les users actifs — 1 seule query Firestore
      const allUsers = await getActiveUsers();
      const eligibleUsers = filterUsersForAlert(allUsers, alert);
      console.log(`[onAlertCreated] eligible=${eligibleUsers.length}/${allUsers.length}`);

      // 2. Notifications in-app (subcollection users/{uid}/notifications)
      //    Le frontend écoute avec onSnapshot → affichage temps réel
      await createInAppNotifications(eligibleUsers, alert);

      // 3. Marquer l'alerte comme notifiée
      await db.collection("alerts").doc(txHash).update({
        notified: true,
        notifiedAt: FieldValue.serverTimestamp(),
      });

      console.log(`[onAlertCreated] done — notified ${eligibleUsers.length} users`);
    } catch (err) {
      console.error("[onAlertCreated] Error:", err);
    }
  }
);
