import type {DexPairData} from "../types";

const BASE = "https://api.dexscreener.com/latest/dex";

interface TokenPriceResult {
  price: number;
  volume24h: number;
  pairAddress: string;
}

/**
 * Prix du token depuis la pair la plus liquide sur Dexscreener.
 * Prioritaire : contextualisé chaque transaction avec prix + volume réel.
 */
export async function getTokenPrice(
  chainId: string,
  tokenAddress: string
): Promise<TokenPriceResult | null> {
  try {
    const res = await fetch(`${BASE}/tokens/${tokenAddress}`, {
      signal: AbortSignal.timeout(7000),
      headers: {Accept: "application/json"},
    });
    if (!res.ok) return null;

    const data = await res.json() as {
      pairs: (DexPairData & { chainId: string })[];
    };

    const pairs = (data.pairs ?? [])
      .filter((p) => p.chainId === chainId && parseFloat(p.priceUsd) > 0)
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));

    if (!pairs[0]) return null;

    return {
      price: parseFloat(pairs[0].priceUsd),
      volume24h: pairs[0].volume?.h24 ?? 0,
      pairAddress: pairs[0].pairAddress,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch en parallèle les prix de tous les tokens surveillés.
 * Un seul round de requêtes par scan → économie maximale de quota.
 */
export async function getTokenPrices(
  chainId: string,
  tokenAddresses: string[]
): Promise<Map<string, TokenPriceResult>> {
  const results = await Promise.allSettled(
    tokenAddresses.map((addr) => getTokenPrice(chainId, addr))
  );

  const map = new Map<string, TokenPriceResult>();
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) {
      map.set(tokenAddresses[i].toLowerCase(), r.value);
    }
  });
  return map;
}
