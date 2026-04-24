const BASE = "https://api.coingecko.com/api/v3";

const STABLECOINS = new Set(["usdc", "usdt", "dai", "busd", "frax", "tusd", "usdp", "lusd"]);

export interface CoinGeckoToken {
  symbol: string;
  name: string;
  contract: string; // ETH contract address (lowercase)
  decimals: number;
  coingeckoId: string;
  rank: number;
  isStablecoin: boolean;
}

/**
 * Fetches top N coins from CoinGecko and resolves their Ethereum
 * contract addresses + decimals. Returns up to `take` tokens with
 * valid ERC-20 contracts. Uses ethereum-ecosystem category to
 * avoid BTC (no native ETH contract).
 */
export async function getTop10EthTokens(take = 10): Promise<CoinGeckoToken[]> {
  // Step 1: top 20 by market cap in ethereum ecosystem
  const marketsUrl = `${BASE}/coins/markets` +
    "?vs_currency=usd" +
    "&category=ethereum-ecosystem" +
    "&order=market_cap_desc" +
    "&per_page=20" +
    "&page=1" +
    "&sparkline=false";

  const mRes = await fetch(marketsUrl, {
    signal: AbortSignal.timeout(10000),
    headers: {"Accept": "application/json"},
  });
  if (!mRes.ok) throw new Error(`CoinGecko markets HTTP ${mRes.status}`);

  const markets = await mRes.json() as {
    id: string;
    symbol: string;
    name: string;
    market_cap_rank: number;
  }[];

  // Step 2: for each coin, fetch contract address + decimals in parallel
  const details = await Promise.allSettled(
    markets.slice(0, 20).map((coin) => fetchCoinDetail(coin.id))
  );

  const tokens: CoinGeckoToken[] = [];

  for (let i = 0; i < details.length && tokens.length < take; i++) {
    const result = details[i];
    if (result.status !== "fulfilled" || !result.value) continue;

    const {contract, decimals} = result.value;
    if (!contract) continue; // no ETH contract (e.g. BTC)

    const market = markets[i];
    tokens.push({
      symbol: market.symbol.toUpperCase(),
      name: market.name,
      contract: contract.toLowerCase(),
      decimals,
      coingeckoId: market.id,
      rank: market.market_cap_rank,
      isStablecoin: STABLECOINS.has(market.symbol.toLowerCase()),
    });
  }

  return tokens;
}

interface CoinDetail {
  contract: string | null;
  decimals: number;
}

async function fetchCoinDetail(id: string): Promise<CoinDetail> {
  const url = `${BASE}/coins/${id}` +
    "?localization=false&tickers=false&market_data=false" +
    "&community_data=false&developer_data=false";

  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: {"Accept": "application/json"},
  });
  if (!res.ok) return {contract: null, decimals: 18};

  const data = await res.json() as {
    detail_platforms?: {
      ethereum?: {contract_address?: string; decimal_place?: number};
    };
    platforms?: {ethereum?: string};
  };

  // Prefer detail_platforms (has decimals), fallback to platforms
  const detail = data.detail_platforms?.ethereum;
  const contract = detail?.contract_address || data.platforms?.ethereum || null;
  const decimals = detail?.decimal_place ?? 18;

  return {
    contract: contract && contract.length > 0 ? contract : null,
    decimals,
  };
}
