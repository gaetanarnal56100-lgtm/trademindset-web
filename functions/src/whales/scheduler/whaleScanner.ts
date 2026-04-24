import {onSchedule} from "firebase-functions/v2/scheduler";
import {defineSecret} from "firebase-functions/params";
import {getFirestore, FieldValue} from "firebase-admin/firestore";

import {MONITORED_TOKENS} from "../config/tokens";
import {
  WHALE_THRESHOLD_USD,
  SCORE_MIN_THRESHOLD,
  DEFAULT_LOOKBACK,
  ETHERSCAN_MAX_RESULTS,
} from "../config/constants";
import {getTokenTransfers, getLatestBlock} from "../services/etherscan";
import {getTokenPrices} from "../services/dexscreener";
import {computeWhaleScore} from "../services/whaleScore";
import {
  getScannerState,
  updateScannerState,
  filterNewAlerts,
  batchWriteAlerts,
} from "../utils/firestore";
import {parseTokenAmount} from "../utils/format";
import {labelAddress} from "../utils/labels";
import type {WhaleAlert} from "../types";
import type {CoinGeckoToken} from "../services/coingecko";
import type {MonitoredToken} from "../config/tokens";

const etherscanKey = defineSecret("ETHERSCAN_API_KEY");
const WATCHLIST_DOC = "scanner_state/watchlist";

// Charge la watchlist dynamique depuis Firestore.
// Si non encore peuplée (avant le premier refreshWatchlist),
// utilise la liste statique de secours.
async function loadTokens(): Promise<MonitoredToken[]> {
  try {
    const snap = await getFirestore().doc(WATCHLIST_DOC).get();
    if (!snap.exists) {
      console.log("[WhaleScanner] Watchlist not ready, using static fallback.");
      return MONITORED_TOKENS;
    }

    const data = snap.data() as {tokens: CoinGeckoToken[]};
    return data.tokens.map((t): MonitoredToken => ({
      symbol: t.symbol,
      name: t.name,
      contract: t.contract,
      chain: "ethereum",
      chainId: "ethereum",
      decimals: t.decimals,
      isStablecoin: t.isStablecoin,
    }));
  } catch {
    console.warn("[WhaleScanner] Could not read watchlist, using fallback.");
    return MONITORED_TOKENS;
  }
}

export const whaleScanner = onSchedule(
  {
    schedule: "every 1 minutes",
    region: "europe-west1",
    secrets: [etherscanKey],
    timeoutSeconds: 300,
    memory: "256MiB",
  },
  async () => {
    const t0 = Date.now();
    const apiKey = etherscanKey.value();

    console.log("[WhaleScanner] ── scan start ──────────────────────────");

    // 1. Bloc courant
    const currentBlock = await getLatestBlock(apiKey);
    console.log(`[WhaleScanner] currentBlock=${currentBlock}`);

    // 2. Watchlist dynamique (top 10 CoinGecko) ou fallback statique
    const tokens = await loadTokens();
    const symbols = tokens.map((t) => t.symbol).join(", ");
    console.log(`[WhaleScanner] watching ${tokens.length} tokens: ${symbols}`);

    // 3. État du scanner (dernier bloc scanné par contrat)
    const state = await getScannerState("ethereum");

    // 4. Prix via Dexscreener — fetch parallèle (prioritaire)
    const addresses = tokens.map((t) => t.contract);
    const priceMap = await getTokenPrices("ethereum", addresses);
    console.log(`[WhaleScanner] prices: ${priceMap.size}/${tokens.length}`);

    // 5. Scan séquentiel — 1 token à la fois avec 250ms entre chaque
    //    Etherscan free = 5 calls/sec, séquentiel évite tout rate limit
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const candidates: WhaleAlert[] = [];
    const newBlocks: Record<string, number> = {};

    for (let i = 0; i < tokens.length; i++) {
      const batch = [tokens[i]];
      if (i > 0) await delay(250);
      await Promise.allSettled(batch.map(async (token) => {
        try {
          const lastBlock = state.lastBlockByContract[token.contract] ??
            (currentBlock - DEFAULT_LOOKBACK);
          const startBlock = lastBlock + 1;

          if (startBlock > currentBlock) return;

          const transfers = await getTokenTransfers(
            token.contract,
            startBlock,
            apiKey,
            ETHERSCAN_MAX_RESULTS
          );

          newBlocks[token.contract] = currentBlock;
          if (transfers.length === 0) return;

          console.log(`[WhaleScanner] ${token.symbol}: ${transfers.length} txs`);

          const priceData = priceMap.get(token.contract);
          const priceUsd = priceData?.price ?? (token.isStablecoin ? 1 : null);
          if (!priceUsd) {
            console.warn(`[WhaleScanner] ${token.symbol}: no price, skip`);
            return;
          }
          const volume24h = priceData?.volume24h ?? 0;

          // Velocity bonus: compter les txns par wallet
          const walletCount: Record<string, number> = {};
          for (const tx of transfers) {
            walletCount[tx.from] = (walletCount[tx.from] ?? 0) + 1;
          }

          for (const tx of transfers) {
            const decimals = token.decimals ?? parseInt(tx.tokenDecimal, 10);
            const amount = parseTokenAmount(tx.value, decimals);
            const usdValue = amount * priceUsd;

            if (usdValue < WHALE_THRESHOLD_USD) continue;

            const score = computeWhaleScore({
              usdValue,
              volume24h,
              walletTxCount: walletCount[tx.from] ?? 1,
            });

            if (score.total < SCORE_MIN_THRESHOLD) continue;

            candidates.push({
              txHash: tx.hash,
              token: token.contract,
              tokenSymbol: token.symbol,
              tokenName: token.name,
              from: tx.from,
              fromLabel: labelAddress(tx.from, "ethereum"),
              to: tx.to,
              toLabel: labelAddress(tx.to, "ethereum"),
              rawValue: tx.value,
              usdValue: Math.round(usdValue),
              blockNumber: parseInt(tx.blockNumber, 10),
              timestamp: parseInt(tx.timeStamp, 10) * 1000,
              chain: token.chain,
              score: score.total,
              scoreCategory: score.category,
              scoreBreakdown: {
                amountScore: Math.round(score.amountScore),
                relativeVolumeScore: Math.round(score.relativeVolumeScore),
                velocityBonus: Math.round(score.velocityBonus),
              },
              pairVolume24h: volume24h,
              priceAtTime: priceUsd,
              createdAt: FieldValue.serverTimestamp(),
              notified: false,
            });
          }
        } catch (err) {
          console.error(`[WhaleScanner] ${token.symbol}:`, (err as Error).message);
        }
      }));
    }

    console.log(`[WhaleScanner] candidates=${candidates.length}`);

    // 6. Déduplication
    const newAlerts = await filterNewAlerts(candidates);
    console.log(`[WhaleScanner] new=${newAlerts.length} (after dedup)`);

    // 7. Batch write → déclenche onDocumentCreated
    const written = await batchWriteAlerts(newAlerts);

    // 8. Persist état
    if (Object.keys(newBlocks).length > 0) {
      await updateScannerState("ethereum", {
        ...state.lastBlockByContract,
        ...newBlocks,
      });
    }

    console.log(`[WhaleScanner] done — written=${written} in ${Date.now() - t0}ms`);
    console.log("[WhaleScanner] ──────────────────────────────────────────");
  }
);
