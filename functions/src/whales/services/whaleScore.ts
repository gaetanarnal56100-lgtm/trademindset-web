import type {ScoreBreakdown, ScoreCategory} from "../types";
import {SCORE_THRESHOLDS} from "../config/constants";

export interface WhaleTxInput {
  usdValue: number;
  volume24h: number; // volume 24h de la pair (Dexscreener)
  walletTxCount?: number; // nb de gros txns du même wallet dans ce scan
}

export interface ScoreResult extends ScoreBreakdown {
  total: number;
  category: ScoreCategory;
}

/**
 * Smart Whale Score (0–100)
 *
 * Amount Score      (0–40) : magnitude absolue USD — log pour éviter la saturation
 * Rel. Volume Score (0–40) : % de la liquidité 24h de la pair impactée
 * Velocity Bonus    (0–20) : même wallet, plusieurs gros txns = signal fort
 *                             d'accumulation (achat) ou distribution (vente)
 */
export function computeWhaleScore(input: WhaleTxInput): ScoreResult {
  const amountScore = scoreAmount(input.usdValue);
  const relativeVolumeScore = scoreRelativeVolume(input.usdValue, input.volume24h);
  const velocityBonus = scoreVelocity(input.walletTxCount ?? 1);

  const total = Math.min(100, Math.round(amountScore + relativeVolumeScore + velocityBonus));
  const category = resolveCategory(total);

  return {amountScore, relativeVolumeScore, velocityBonus, total, category};
}

// ── Composants du score ────────────────────────────────────────────────────────

function scoreAmount(usd: number): number {
  // $500K → 0  |  $1M → 15  |  $5M → 30  |  $20M+ → 40
  if (usd < 500_000) return 0;
  if (usd < 1_000_000) return ((usd - 500_000) / 500_000) * 15;
  if (usd < 5_000_000) return 15 + (Math.log10(usd / 1e6) / Math.log10(5)) * 15;
  if (usd < 20_000_000) return 30 + (Math.log10(usd / 5e6) / Math.log10(4)) * 10;
  return 40;
}

function scoreRelativeVolume(usd: number, volume24h: number): number {
  // Volume inconnu → score neutre (ne pénalise pas les small-cap illiquides)
  if (!volume24h || volume24h <= 0) return 10;

  const pct = (usd / volume24h) * 100;

  if (pct >= 50) return 40;
  if (pct >= 25) return 35;
  if (pct >= 10) return 28;
  if (pct >= 5) return 20;
  if (pct >= 2) return 14;
  if (pct >= 1) return 10;
  if (pct >= 0.5) return 6;
  return 3;
}

function scoreVelocity(txCount: number): number {
  if (txCount >= 4) return 20;
  if (txCount === 3) return 15;
  if (txCount === 2) return 10;
  return 0;
}

function resolveCategory(score: number): ScoreCategory {
  if (score >= SCORE_THRESHOLDS.MEGA_WHALE) return "MEGA_WHALE";
  if (score >= SCORE_THRESHOLDS.WHALE) return "WHALE";
  if (score >= SCORE_THRESHOLDS.BIG_FISH) return "BIG_FISH";
  return "SHARK";
}
