import {onSchedule} from "firebase-functions/v2/scheduler";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import {getTop10EthTokens} from "../services/coingecko";

const WATCHLIST_DOC = "scanner_state/watchlist";

export const refreshWatchlist = onSchedule(
  {
    schedule: "every 6 hours",
    region: "europe-west1",
    timeoutSeconds: 120,
    memory: "256MiB",
  },
  async () => {
    console.log("[refreshWatchlist] Fetching top 10 ETH tokens from CoinGecko…");
    const db = getFirestore();

    try {
      const tokens = await getTop10EthTokens(10);

      if (tokens.length === 0) {
        console.warn("[refreshWatchlist] CoinGecko returned 0 tokens, aborting.");
        return;
      }

      await db.doc(WATCHLIST_DOC).set({
        tokens,
        updatedAt: FieldValue.serverTimestamp(),
      });

      const list = tokens.map((t) => `${t.rank}. ${t.symbol}`).join(", ");
      console.log(`[refreshWatchlist] Saved ${tokens.length} tokens: ${list}`);
    } catch (err) {
      console.error("[refreshWatchlist] Error:", err);
    }
  }
);

/**
 * Reads the watchlist from Firestore.
 * Returns null if not yet populated (first run).
 */
export async function getWatchlist() {
  const db = getFirestore();
  const snap = await db.doc(WATCHLIST_DOC).get();
  if (!snap.exists) return null;
  return (snap.data() as {tokens: ReturnType<typeof Array.prototype.map>}).tokens;
}
