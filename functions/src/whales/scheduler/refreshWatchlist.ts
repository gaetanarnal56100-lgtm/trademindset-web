import {onSchedule} from "firebase-functions/v2/scheduler";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import {getTopBinanceEthTokens, getTop10EthTokens} from "../services/coingecko";

const WATCHLIST_DOC = "scanner_state/watchlist";

export const refreshWatchlist = onSchedule(
  {
    schedule: "every 6 hours",
    region: "europe-west1",
    timeoutSeconds: 120,
    memory: "256MiB",
  },
  async () => {
    console.log("[refreshWatchlist] Fetching top Binance tokens with ETH contracts…");
    const db = getFirestore();

    let tokens: Awaited<ReturnType<typeof getTopBinanceEthTokens>> = [];

    // Primary: Binance top volume → ETH contracts
    try {
      tokens = await getTopBinanceEthTokens(10);
      console.log(`[refreshWatchlist] Binance source: ${tokens.length} tokens`);
    } catch (err) {
      console.warn("[refreshWatchlist] Binance fetch failed, trying CoinGecko fallback:", err);
    }

    // Fallback: CoinGecko ethereum-ecosystem top 10
    if (tokens.length < 5) {
      try {
        tokens = await getTop10EthTokens(10);
        console.log(`[refreshWatchlist] CoinGecko fallback: ${tokens.length} tokens`);
      } catch (err) {
        console.error("[refreshWatchlist] CoinGecko fallback also failed:", err);
      }
    }

    if (tokens.length === 0) {
      console.warn("[refreshWatchlist] No tokens resolved, aborting.");
      return;
    }

    await db.doc(WATCHLIST_DOC).set({
      tokens,
      source: tokens[0]?.coingeckoId ? "binance+coingecko" : "coingecko",
      updatedAt: FieldValue.serverTimestamp(),
    });

    const list = tokens.map((t) => `${t.symbol}`).join(", ");
    console.log(`[refreshWatchlist] Saved ${tokens.length} tokens: ${list}`);
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
