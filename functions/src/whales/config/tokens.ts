export interface MonitoredToken {
  symbol: string;
  name: string;
  contract: string; // lowercase
  chain: "ethereum" | "bsc";
  chainId: string; // Dexscreener chain id
  dexPairAddress?: string;
  decimals: number;
  isStablecoin?: boolean;
}

export const MONITORED_TOKENS: MonitoredToken[] = [
  {
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    contract: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
    chain: "ethereum", chainId: "ethereum",
    dexPairAddress: "0xcbcdf9626bc03e24f779434178a73a0b4bad62ed",
    decimals: 8,
  },
  {
    symbol: "WETH",
    name: "Wrapped Ether",
    contract: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    chain: "ethereum", chainId: "ethereum",
    dexPairAddress: "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640",
    decimals: 18,
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    chain: "ethereum", chainId: "ethereum",
    decimals: 6, isStablecoin: true,
  },
  {
    symbol: "USDT",
    name: "Tether",
    contract: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    chain: "ethereum", chainId: "ethereum",
    decimals: 6, isStablecoin: true,
  },
  {
    symbol: "PEPE",
    name: "Pepe",
    contract: "0x6982508145454ce325ddbe47a25d4ec3d2311933",
    chain: "ethereum", chainId: "ethereum",
    dexPairAddress: "0xa43fe16908251ee70ef74718545e4fe6c5ccec9f",
    decimals: 18,
  },
  {
    symbol: "SHIB",
    name: "Shiba Inu",
    contract: "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce",
    chain: "ethereum", chainId: "ethereum",
    dexPairAddress: "0x811beed0119b4afce20d2583eb608c6f7af1954f",
    decimals: 18,
  },
  {
    symbol: "LINK",
    name: "Chainlink",
    contract: "0x514910771af9ca656af840dff83e8264ecf986ca",
    chain: "ethereum", chainId: "ethereum",
    dexPairAddress: "0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8",
    decimals: 18,
  },
  {
    symbol: "UNI",
    name: "Uniswap",
    contract: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
    chain: "ethereum", chainId: "ethereum",
    dexPairAddress: "0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801",
    decimals: 18,
  },
  {
    symbol: "AAVE",
    name: "Aave",
    contract: "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9",
    chain: "ethereum", chainId: "ethereum",
    dexPairAddress: "0x5ab53ee1d48a294189a7e49a50b60e2bf29ba5d3",
    decimals: 18,
  },
  {
    symbol: "MKR",
    name: "Maker",
    contract: "0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2",
    chain: "ethereum", chainId: "ethereum",
    dexPairAddress: "0x3afdcd43fef573aa8a411ce1824891a0f9041bef",
    decimals: 18,
  },
  {
    symbol: "ARB",
    name: "Arbitrum",
    contract: "0xb50721bcf8d664c30412cfbc6cf7a15145234ad1",
    chain: "ethereum", chainId: "ethereum",
    dexPairAddress: "0x755e5a186f0469583bd2e80d1216e02ab88ec6ca",
    decimals: 18,
  },
];
