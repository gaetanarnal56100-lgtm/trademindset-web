import type {FieldValue, Timestamp} from "firebase-admin/firestore";

export type ScoreCategory = "MEGA_WHALE" | "WHALE" | "BIG_FISH" | "SHARK";
export type Chain = "ethereum" | "bsc";

export interface ScoreBreakdown {
  amountScore: number; // 0–40 : magnitude USD
  relativeVolumeScore: number; // 0–40 : impact sur le volume 24h de la pair
  velocityBonus: number; // 0–20 : même wallet répété dans la fenêtre
}

export interface WhaleAlert {
  txHash: string; // = ID du document Firestore
  token: string; // contract address (lowercase)
  tokenSymbol: string;
  tokenName: string;
  from: string;
  to: string;
  rawValue: string; // valeur brute avant division decimals
  usdValue: number;
  blockNumber: number;
  timestamp: number; // unix ms
  chain: Chain;
  score: number; // 0–100
  scoreCategory: ScoreCategory;
  scoreBreakdown: ScoreBreakdown;
  pairVolume24h: number;
  priceAtTime: number;
  createdAt: FieldValue | Timestamp;
  notified: boolean;
  notifiedAt?: FieldValue | Timestamp;
}

export interface UserProfile {
  uid: string;
  telegramId?: string;
  threshold: number; // USD minimum
  alertsEnabled: boolean;
  tokens: string[]; // vide = tous les tokens
}

export interface EtherscanTokenTx {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  contractAddress: string;
  value: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: string;
}

export interface DexPairData {
  chainId: string;
  pairAddress: string;
  baseToken: { address: string; symbol: string; name: string };
  priceUsd: string;
  volume: { h24: number; h6: number; h1: number; m5: number };
  liquidity: { usd: number };
  txns: {
    h24: { buys: number; sells: number };
    h1: { buys: number; sells: number };
  };
}

export interface ScannerState {
  lastBlockByContract: Record<string, number>;
  lastScanAt: Timestamp | null;
}

export interface InAppNotification {
  type: "whale_alert";
  txHash: string;
  tokenSymbol: string;
  usdValue: number;
  score: number;
  scoreCategory: ScoreCategory;
  chain: Chain;
  read: boolean;
  createdAt: FieldValue | Timestamp;
}
