// mempool.space API — no auth required, generous rate limits
const BASE = "https://mempool.space/api";

export interface MempoolTx {
  txid: string;
  vin: {
    prevout?: {
      scriptpubkey_address?: string;
      value: number; // satoshis
    };
    is_coinbase?: boolean;
  }[];
  vout: {
    scriptpubkey_address?: string;
    value: number; // satoshis
  }[];
  status: {
    confirmed: boolean;
    block_height: number;
    block_time: number; // unix seconds
  };
  fee?: number;
}

export async function getLatestBtcBlockHeight(): Promise<number> {
  const res = await fetch(`${BASE}/blocks/tip/height`, {
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`mempool.space height HTTP ${res.status}`);
  const height = await res.json() as number;
  if (typeof height !== "number" || isNaN(height)) {
    throw new Error(`Invalid BTC block height: ${height}`);
  }
  return height;
}

export async function getBtcBlockHash(height: number): Promise<string> {
  const res = await fetch(`${BASE}/block-height/${height}`, {
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`mempool.space block-height HTTP ${res.status}`);
  return res.text();
}

// Returns up to 25 transactions per page (mempool.space paginates by 25)
export async function getBtcBlockTxs(hash: string, page = 0): Promise<MempoolTx[]> {
  const res = await fetch(`${BASE}/block/${hash}/txs/${page * 25}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`mempool.space txs HTTP ${res.status}`);
  return res.json() as Promise<MempoolTx[]>;
}

export async function getBtcPriceUsd(): Promise<number> {
  const res = await fetch(
    "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
    {signal: AbortSignal.timeout(5000)}
  );
  if (!res.ok) throw new Error(`Binance BTC price HTTP ${res.status}`);
  const data = await res.json() as {price: string};
  const price = parseFloat(data.price);
  if (isNaN(price) || price <= 0) throw new Error(`Invalid BTC price: ${data.price}`);
  return price;
}

// Total output value in satoshis (excluding change = largest single output heuristic)
export function getTxTotalOutputSats(tx: MempoolTx): number {
  return tx.vout.reduce((sum, o) => sum + (o.value ?? 0), 0);
}

// Main sender = first input with a previous output address
export function getTxFromAddress(tx: MempoolTx): string {
  if (tx.vin[0]?.is_coinbase) return "coinbase";
  return tx.vin[0]?.prevout?.scriptpubkey_address ?? "unknown";
}

// Main receiver = largest output (ignoring OP_RETURN)
export function getTxToAddress(tx: MempoolTx): string {
  const outputs = tx.vout.filter((o) => o.scriptpubkey_address);
  if (outputs.length === 0) return "unknown";
  return outputs.reduce((max, o) => (o.value > max.value ? o : max)).scriptpubkey_address!;
}
