import {onSchedule} from "firebase-functions/v2/scheduler";
import {FieldValue} from "firebase-admin/firestore";

import {WHALE_THRESHOLD_USD, SCORE_MIN_THRESHOLD} from "../config/constants";
import {
  getLatestBtcBlockHeight,
  getBtcBlockHash,
  getBtcBlockTxs,
  getBtcPriceUsd,
  getTxTotalOutputSats,
  getTxFromAddress,
  getTxToAddress,
} from "../services/bitcoin";
import {computeWhaleScore} from "../services/whaleScore";
import {getScannerState, updateScannerState, filterNewAlerts, batchWriteAlerts} from "../utils/firestore";
import {labelAddress} from "../utils/labels";
import type {WhaleAlert} from "../types";

const BTC_STATE_KEY = "__btc_native__";
const MAX_BLOCKS_PER_RUN = 3; // max blocks to catch up per execution

export const btcScanner = onSchedule(
  {
    schedule: "every 1 minutes",
    region: "europe-west1",
    timeoutSeconds: 120,
    memory: "256MiB",
  },
  async () => {
    const t0 = Date.now();
    console.log("[BtcScanner] ── scan start ──────────────────────────────");

    // 1. Current block height + BTC price
    const [currentHeight, btcPrice] = await Promise.all([
      getLatestBtcBlockHeight(),
      getBtcPriceUsd(),
    ]);
    console.log(`[BtcScanner] height=${currentHeight} price=$${btcPrice.toFixed(0)}`);

    // 2. Last scanned block
    const state = await getScannerState("bitcoin");
    const lastHeight = state.lastBlockByContract[BTC_STATE_KEY] ?? (currentHeight - 2);

    if (lastHeight >= currentHeight) {
      console.log("[BtcScanner] already up to date");
      return;
    }

    const fromBlock = lastHeight + 1;
    const toBlock = Math.min(currentHeight, lastHeight + MAX_BLOCKS_PER_RUN);
    console.log(`[BtcScanner] scanning blocks ${fromBlock}→${toBlock}`);

    // 3. Scan each block
    const candidates: WhaleAlert[] = [];

    for (let h = fromBlock; h <= toBlock; h++) {
      try {
        const hash = await getBtcBlockHash(h);
        const txs = await getBtcBlockTxs(hash, 0); // first 25 txs per block

        for (const tx of txs) {
          if (tx.vin[0]?.is_coinbase) continue; // skip coinbase

          const totalSats = getTxTotalOutputSats(tx);
          const btcValue = totalSats / 1e8;
          const usdValue = btcValue * btcPrice;

          if (usdValue < WHALE_THRESHOLD_USD) continue;

          const fromAddr = getTxFromAddress(tx);
          const toAddr = getTxToAddress(tx);

          const score = computeWhaleScore({usdValue, volume24h: 0, walletTxCount: 1});
          if (score.total < SCORE_MIN_THRESHOLD) continue;

          candidates.push({
            txHash: tx.txid,
            token: "native",
            tokenSymbol: "BTC",
            tokenName: "Bitcoin",
            from: fromAddr,
            fromLabel: labelAddress(fromAddr, "bitcoin"),
            to: toAddr,
            toLabel: labelAddress(toAddr, "bitcoin"),
            rawValue: String(totalSats),
            usdValue: Math.round(usdValue),
            blockNumber: h,
            timestamp: (tx.status.block_time ?? Math.floor(Date.now() / 1000)) * 1000,
            chain: "bitcoin",
            score: score.total,
            scoreCategory: score.category,
            scoreBreakdown: {
              amountScore: Math.round(score.amountScore),
              relativeVolumeScore: Math.round(score.relativeVolumeScore),
              velocityBonus: Math.round(score.velocityBonus),
            },
            pairVolume24h: 0,
            priceAtTime: btcPrice,
            createdAt: FieldValue.serverTimestamp(),
            notified: false,
          });
        }
      } catch (err) {
        console.error(`[BtcScanner] block ${h}:`, (err as Error).message);
      }
    }

    console.log(`[BtcScanner] candidates=${candidates.length}`);

    // 4. Dedup + write
    const newAlerts = await filterNewAlerts(candidates);
    console.log(`[BtcScanner] new=${newAlerts.length} (after dedup)`);
    const written = await batchWriteAlerts(newAlerts);

    // 5. Persist state
    await updateScannerState("bitcoin", {[BTC_STATE_KEY]: toBlock});

    console.log(`[BtcScanner] done — written=${written} in ${Date.now() - t0}ms`);
    console.log("[BtcScanner] ──────────────────────────────────────────────");
  }
);
