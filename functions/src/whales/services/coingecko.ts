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

// ── Binance top volume → Ethereum contracts ───────────────────────────────────

/**
 * Fetches the top N tokens by 24h USDT volume on Binance,
 * then resolves their Ethereum contract addresses via CoinGecko.
 * Returns up to `take` tokens with valid ERC-20 contracts.
 */
export async function getTopBinanceEthTokens(take = 10): Promise<CoinGeckoToken[]> {
  // Step 1: top 20 USDT pairs by volume on Binance
  const binanceRes = await fetch(
    "https://api.binance.com/api/v3/ticker/24hr",
    {signal: AbortSignal.timeout(10000), headers: {Accept: "application/json"}}
  );
  if (!binanceRes.ok) throw new Error(`Binance ticker HTTP ${binanceRes.status}`);

  const tickers = await binanceRes.json() as {symbol: string; quoteVolume: string}[];

  // Extract base symbols (BTCUSDT → btc), sorted by USD volume desc
  const topSymbols: string[] = tickers
    .filter((t) => t.symbol.endsWith("USDT"))
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, 30)
    .map((t) => t.symbol.replace("USDT", "").toLowerCase());

  console.log(`[CoinGecko] Binance top symbols: ${topSymbols.slice(0, 15).join(", ")}`);

  // Step 2: top 200 coins by market cap from CoinGecko
  const marketsUrl = `${BASE}/coins/markets` +
    "?vs_currency=usd" +
    "&order=market_cap_desc" +
    "&per_page=200" +
    "&page=1" +
    "&sparkline=false";

  const mRes = await fetch(marketsUrl, {
    signal: AbortSignal.timeout(10000),
    headers: {Accept: "application/json"},
  });
  if (!mRes.ok) throw new Error(`CoinGecko markets HTTP ${mRes.status}`);

  const markets = await mRes.json() as {
    id: string;
    symbol: string;
    name: string;
    market_cap_rank: number;
  }[];

  // Step 3: keep only coins matching Binance top symbols, preserve Binance volume order
  const symbolSet = new Set(topSymbols);
  const matched = topSymbols
    .map((sym) => markets.find((m) => m.symbol.toLowerCase() === sym))
    .filter((m): m is typeof markets[0] => m !== undefined);

  console.log(`[CoinGecko] Matched ${matched.length} coins on CoinGecko`);

  // Step 4: fetch ETH contract + decimals in parallel (up to 25)
  const details = await Promise.allSettled(
    matched.slice(0, 25).map((coin) => fetchCoinDetail(coin.id))
  );

  const tokens: CoinGeckoToken[] = [];

  for (let i = 0; i < details.length && tokens.length < take; i++) {
    const result = details[i];
    if (result.status !== "fulfilled" || !result.value) continue;

    const {contract, decimals} = result.value;
    if (!contract) continue; // no ETH contract (BTC native, SOL, XRP, etc.)

    const coin = matched[i];
    tokens.push({
      symbol: coin.symbol.toUpperCase(),
      name: coin.name,
      contract: contract.toLowerCase(),
      decimals,
      coingeckoId: coin.id,
      rank: coin.market_cap_rank,
      isStablecoin: STABLECOINS.has(coin.symbol.toLowerCase()),
    });
  }

  // Ensure WBTC is included if BTC was in top symbols but resolved to WBTC
  const hasWbtc = tokens.some((t) => t.symbol === "WBTC");
  const hasBtc = symbolSet.has("btc");
  if (hasBtc && !hasWbtc && tokens.length < take) {
    tokens.unshift({
      symbol: "WBTC",
      name: "Wrapped Bitcoin",
      contract: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
      decimals: 8,
      coingeckoId: "wrapped-bitcoin",
      rank: 0,
      isStablecoin: false,
    });
  }

  return tokens.slice(0, take);
}

// ── Legacy: CoinGecko ethereum-ecosystem top 10 ───────────────────────────────

/**
 * Fetches top N coins from CoinGecko ethereum-ecosystem category.
 * Used as fallback if Binance fetch fails.
 */
export async function getTop10EthTokens(take = 10): Promise<CoinGeckoToken[]> {
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

  const details = await Promise.allSettled(
    markets.slice(0, 20).map((coin) => fetchCoinDetail(coin.id))
  );

  const tokens: CoinGeckoToken[] = [];

  for (let i = 0; i < details.length && tokens.length < take; i++) {
    const result = details[i];
    if (result.status !== "fulfilled" || !result.value) continue;

    const {contract, decimals} = result.value;
    if (!contract) continue;

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

// ── Shared helpers ────────────────────────────────────────────────────────────

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

  const detail = data.detail_platforms?.ethereum;
  const contract = detail?.contract_address || data.platforms?.ethereum || null;
  const decimals = detail?.decimal_place ?? 18;

  return {
    contract: contract && contract.length > 0 ? contract : null,
    decimals,
  };
}
