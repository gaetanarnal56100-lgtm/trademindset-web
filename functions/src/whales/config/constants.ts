export const WHALE_THRESHOLD_USD = 500_000; // pré-filtre avant calcul score
export const SCORE_MIN_THRESHOLD = 25; // score minimum pour créer l'alerte
export const DEFAULT_LOOKBACK = 300; // blocs (~1h) si premier scan
export const ETHERSCAN_MAX_RESULTS = 100; // max txns par appel Etherscan
export const MAX_BATCH_SIZE = 400; // limite sécurisée (Firestore max=500)
export const TELEGRAM_CONCURRENCY = 5; // envois parallèles Telegram

export const SCORE_THRESHOLDS = {
  MEGA_WHALE: 80,
  WHALE: 60,
  BIG_FISH: 40,
  SHARK: 25,
} as const;

export const CATEGORY_EMOJIS: Record<string, string> = {
  MEGA_WHALE: "🔱",
  WHALE: "🐋",
  BIG_FISH: "🐠",
  SHARK: "🦈",
};
