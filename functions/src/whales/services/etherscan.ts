import type {EtherscanTokenTx} from "../types";

// Etherscan API V2 (V1 déprécié depuis 2024)
// Doc : https://docs.etherscan.io/v2-migration
const BASE = "https://api.etherscan.io/v2/api";
const CHAIN_ID = "1"; // Ethereum mainnet

export async function getTokenTransfers(
  contractAddress: string,
  startBlock: number,
  apiKey: string,
  limit = 100
): Promise<EtherscanTokenTx[]> {
  const params = new URLSearchParams({
    chainid: CHAIN_ID,
    module: "account",
    action: "tokentx",
    contractaddress: contractAddress,
    startblock: String(startBlock),
    endblock: "99999999",
    sort: "asc",
    page: "1",
    offset: String(limit),
    apikey: apiKey,
  });

  const res = await fetch(`${BASE}?${params}`, {
    signal: AbortSignal.timeout(9000),
    headers: {Accept: "application/json"},
  });

  if (!res.ok) throw new Error(`Etherscan HTTP ${res.status}`);

  const data = await res.json() as {
    status: "0" | "1";
    message: string;
    result: EtherscanTokenTx[] | string;
  };

  if (data.status !== "1") {
    if (data.message === "No transactions found") return [];
    if (typeof data.result === "string" && data.result.includes("rate limit")) {
      throw new Error("RATE_LIMIT");
    }
    return [];
  }

  return Array.isArray(data.result) ? data.result : [];
}

export async function getLatestBlock(apiKey: string): Promise<number> {
  const params = new URLSearchParams({
    chainid: CHAIN_ID,
    module: "proxy",
    action: "eth_blockNumber",
    apikey: apiKey,
  });
  const res = await fetch(`${BASE}?${params}`, {signal: AbortSignal.timeout(5000)});
  const data = await res.json() as {result: string};
  const block = parseInt(data.result, 16);
  if (isNaN(block)) throw new Error(`Invalid block response: ${JSON.stringify(data)}`);
  return block;
}
