/**
 * Parse une valeur brute (string big integer depuis Etherscan)
 * en nombre décimal avec les decimals du token.
 */
export function parseTokenAmount(rawValue: string, decimals: number): number {
  try {
    const safe = Math.min(decimals, 18); // évite overflow BigInt
    const big = BigInt(rawValue);
    const divisor = BigInt(10 ** safe);
    const whole = Number(big / divisor);
    const frac = Number(big % divisor) / 10 ** safe;
    return whole + frac;
  } catch {
    return 0;
  }
}
