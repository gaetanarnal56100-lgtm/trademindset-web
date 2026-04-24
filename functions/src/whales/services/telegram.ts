import type {WhaleAlert} from "../types";
import {CATEGORY_EMOJIS} from "../config/constants";

const TG_BASE = "https://api.telegram.org/bot";

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<boolean> {
  try {
    const res = await fetch(`${TG_BASE}${botToken}/sendMessage`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      console.error(`[Telegram] Failed chatId=${chatId}:`, err);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[Telegram] Network error chatId=${chatId}:`, e);
    return false;
  }
}

export function formatWhaleMessage(alert: WhaleAlert): string {
  const emoji = CATEGORY_EMOJIS[alert.scoreCategory] ?? "🐋";
  const category = alert.scoreCategory.replace("_", " ");
  const usd = fmtUSD(alert.usdValue);
  const vol = fmtUSD(alert.pairVolume24h);
  const from = shortAddr(alert.from);
  const to = shortAddr(alert.to);
  const time = new Date(alert.timestamp).toUTCString().slice(0, -4) + "UTC";
  const ethUrl = `https://etherscan.io/tx/${alert.txHash}`;
  const pct = alert.pairVolume24h > 0 ?
    ` (${((alert.usdValue / alert.pairVolume24h) * 100).toFixed(1)}% du vol 24h)` :
    "";

  const filled = Math.round(alert.score / 10);
  const bar = "█".repeat(filled) + "░".repeat(10 - filled);

  return [
    `${emoji} <b>WHALE ALERT — ${category}</b>`,
    "",
    `🪙 <b>Token :</b> ${alert.tokenSymbol} <i>(${alert.tokenName})</i>`,
    `💰 <b>Valeur :</b> ${usd}`,
    `⛓ <b>Chaîne :</b> ${alert.chain.toUpperCase()}`,
    "",
    `📊 <b>Score :</b> ${alert.score}/100  <code>${bar}</code>`,
    `   ↳ Montant : ${Math.round(alert.scoreBreakdown.amountScore)}pts`,
    `   ↳ Vol. relatif : ${Math.round(alert.scoreBreakdown.relativeVolumeScore)}pts`,
    `   ↳ Vélocité : +${Math.round(alert.scoreBreakdown.velocityBonus)}pts`,
    "",
    `👛 <b>De :</b> <code>${from}</code>`,
    `📩 <b>Vers :</b> <code>${to}</code>`,
    "",
    `📈 <b>Volume pair 24h :</b> ${vol}${pct}`,
    `💹 <b>Prix au moment :</b> $${fmtPrice(alert.priceAtTime)}`,
    `⏱ ${time}`,
    "",
    `🔗 <a href="${ethUrl}">Voir sur Etherscan</a>`,
  ].join("\n");
}

function fmtUSD(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(2)}`;
}

function fmtPrice(p: number): string {
  if (p >= 1) return p.toLocaleString("en-US", {maximumFractionDigits: 2});
  if (p >= 0.01) return p.toFixed(4);
  return p.toExponential(4);
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
