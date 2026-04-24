// Known exchange & entity wallet addresses (ETH + BTC)
// Sources: Etherscan labels, Arkham, Nansen public data

const ETH_LABELS: Record<string, string> = {
  // ── Binance ──────────────────────────────────────────────────────────
  "0x28c6c06298d514db089934071355e5743bf21d60": "Binance",
  "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": "Binance",
  "0x56eddb7aa87536c09ccc2793473599fd21a8b17f": "Binance",
  "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance",
  "0xb38e8c17e38363af6ebdcb3dae12e0243582891d": "Binance",
  "0xf977814e90da44bfa03b6295a0616a897441acec": "Binance",
  "0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be": "Binance",
  // ── Coinbase ─────────────────────────────────────────────────────────
  "0x71660c4005ba85c37ccec55d0c4493e66fe775d3": "Coinbase",
  "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43": "Coinbase",
  "0x503828976d22510aad0201ac7ec88293211d23da": "Coinbase",
  "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740": "Coinbase",
  "0x3cd751e6b0078be393132286c442345e5dc49699": "Coinbase",
  // ── Kraken ───────────────────────────────────────────────────────────
  "0x2910543af39aba0cd09dbb2d50200b3e800a63d2": "Kraken",
  "0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0": "Kraken",
  "0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13": "Kraken",
  // ── OKX ──────────────────────────────────────────────────────────────
  "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": "OKX",
  "0x98ec059dc3adfbdd63429454aeb0c990fba4a128": "OKX",
  "0x8b99f3660622e21f2910ecca7fbe51d654a1517d": "OKX",
  // ── Bybit ────────────────────────────────────────────────────────────
  "0xf89d7b9c864f589bbf53a82105107622b35eaa40": "Bybit",
  "0x2b5634c42055806a59e9107ed44d43c426e58258": "Bybit",
  // ── Bitfinex ─────────────────────────────────────────────────────────
  "0x1151314c646ce4e0efd76d1af4760ae66a9fe30f": "Bitfinex",
  "0x742d35cc6634c0532925a3b844bc454e4438f44e": "Bitfinex",
  // ── Gemini ───────────────────────────────────────────────────────────
  "0xd24400ae8bfebb18ca49be86258a3c749cf46853": "Gemini",
  "0x6fc82a5fe25a5cdb58bc74600a40a69c065263f8": "Gemini",
  // ── Kucoin ───────────────────────────────────────────────────────────
  "0xd6216fc19db775df9774a6e33526131da7d19a2c": "KuCoin",
  // ── Wintermute (market maker) ─────────────────────────────────────────
  "0x4abb7b2a6c7ee68a70ee5d61cb6d66bc768f3b8e": "Wintermute",
  "0x00000000219ab540356cbb839cbe05303d7705fa": "ETH2 Deposit",
  // ── Tether Treasury ──────────────────────────────────────────────────
  "0x5754284f345afc66a98fbb0a0afe71e0f007b949": "Tether Treasury",
  // ── Uniswap ──────────────────────────────────────────────────────────
  "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984": "Uniswap",
  // ── Jump Trading ─────────────────────────────────────────────────────
  "0xf584f8728b874a6a5c7a8d4d387c9aae9172d621": "Jump Trading",
};

const BTC_LABELS: Record<string, string> = {
  // ── Binance ──────────────────────────────────────────────────────────
  "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo": "Binance",
  "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h": "Binance",
  "1NDyJtNTjmwk5xPNhjgAMu4HDHigtobu1s": "Binance",
  // ── Coinbase ─────────────────────────────────────────────────────────
  "1LdRcdxfbSnmCYYNdeYpUnztiYzVfBEQeC": "Coinbase",
  "3LYJfcfHPXYJreMsASk2jkn69LWEYKzexb": "Coinbase",
  "3FUpfnuGqJgkMm7ioXD5HYAYEKswGFqEhJ": "Coinbase",
  // ── Kraken ───────────────────────────────────────────────────────────
  "3H5JTt42K7RmZtromfTSefcMEFMMe18pMD": "Kraken",
  "3AfroFbqjnfpSJM2yHSHfB7NvyXGww9FDZ": "Kraken",
  // ── Bitfinex ─────────────────────────────────────────────────────────
  "3D2oetdNuZUqQHPJmcMDDHYoqkyNVsFk9r": "Bitfinex",
  "1KYiKJEfdJtap9QX2v9BXJMpz2SfU4pgZw": "Bitfinex",
  // ── OKX ──────────────────────────────────────────────────────────────
  "1KFHE7w8BhaENAswwryaoccDb6qcT6DbYY": "OKX",
};

export function labelAddress(addr: string, chain: "ethereum" | "bitcoin"): string {
  if (!addr || addr === "unknown" || addr === "coinbase") return addr;
  const lower = addr.toLowerCase();
  if (chain === "ethereum") return ETH_LABELS[lower] ?? addr;
  return BTC_LABELS[addr] ?? addr; // BTC addresses are case-sensitive
}

export function isExchange(addr: string, chain: "ethereum" | "bitcoin"): boolean {
  const label = labelAddress(addr, chain);
  return label !== addr;
}
