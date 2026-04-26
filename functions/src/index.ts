// Firebase Cloud Functions — Proxy sécurisé pour les clés API + Système de parrainage
//
// Déploiement : firebase deploy --only functions

import * as admin from "firebase-admin";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {getFirestore} from "firebase-admin/firestore";
import {initializeApp, getApps} from "firebase-admin/app";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue } from "firebase-admin/firestore";
// Initialize Firebase Admin if not already initialized
if (getApps().length === 0) {
  initializeApp();
}

// ── Secrets (stockés via `firebase functions:secrets:set`) ──────────
const twelveDataKey  = defineSecret("TWELVEDATA_API_KEY");
const finnhubKey     = defineSecret("FINNHUB_API_KEY");
const openaiKey      = defineSecret("OPENAI_API_KEY");
const glassnodeKey   = defineSecret("GLASSNODE_API_KEY");

// ══════════════════════════════════════════════════════════════════════
// 1. TwelveData — Recherche de symboles
// ══════════════════════════════════════════════════════════════════════
export const searchSymbols = onCall(
  {secrets: [twelveDataKey], region: "europe-west1"},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentification requise.");
    }

    const query = request.data.query;
    if (!query || typeof query !== "string") {
      throw new HttpsError("invalid-argument", "Paramètre 'query' requis.");
    }

    const url = `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(query)}&apikey=${twelveDataKey.value()}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new HttpsError("internal", `TwelveData error: ${response.status}`);
    }

    return await response.json();
  }
);

// ══════════════════════════════════════════════════════════════════════
// 2. TwelveData — Time Series (bougies OHLCV)
// ══════════════════════════════════════════════════════════════════════
export const fetchTimeSeries = onCall(
  {secrets: [twelveDataKey], region: "europe-west1"},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentification requise.");
    }

    const {symbol, interval, outputSize} = request.data;
    if (!symbol || !interval) {
      throw new HttpsError("invalid-argument", "Paramètres 'symbol' et 'interval' requis.");
    }

    const size = outputSize || 200;
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${size}&apikey=${twelveDataKey.value()}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new HttpsError("internal", `TwelveData error: ${response.status}`);
    }

    return await response.json();
  }
);

// ══════════════════════════════════════════════════════════════════════
// 3. Finnhub — Stock Candles
// ══════════════════════════════════════════════════════════════════════
export const fetchStockCandles = onCall(
  {secrets: [finnhubKey], region: "europe-west1"},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentification requise.");
    }

    const {symbol, resolution, from, to} = request.data;
    if (!symbol || !resolution || !from || !to) {
      throw new HttpsError("invalid-argument", "Paramètres manquants.");
    }

    const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${from}&to=${to}&token=${finnhubKey.value()}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new HttpsError("internal", `Finnhub error: ${response.status}`);
    }

    return await response.json();
  }
);

// ══════════════════════════════════════════════════════════════════════
// 4. Finnhub — Recherche de symboles
// ══════════════════════════════════════════════════════════════════════
export const searchFinnhubSymbols = onCall(
  {secrets: [finnhubKey], region: "europe-west1"},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentification requise.");
    }

    const query = request.data.query;
    if (!query || typeof query !== "string") {
      throw new HttpsError("invalid-argument", "Paramètre 'query' requis.");
    }

    const url = `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${finnhubKey.value()}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new HttpsError("internal", `Finnhub error: ${response.status}`);
    }

    return await response.json();
  }
);

// ══════════════════════════════════════════════════════════════════════
// 5. OpenAI — Chat Completion (analyse trading, coaching IA)
// ══════════════════════════════════════════════════════════════════════
export const openaiChat = onCall(
  {
    secrets: [openaiKey],
    region: "europe-west1",
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentification requise.");
    }

    const {messages, model, temperature, responseFormat} = request.data;
    if (!messages || !Array.isArray(messages)) {
      throw new HttpsError("invalid-argument", "Paramètre 'messages' requis.");
    }

    const body: Record<string, unknown> = {
      model: model || "gpt-4o",
      messages,
      temperature: temperature ?? 0.2,
    };

    if (responseFormat === "json") {
      body.response_format = {type: "json_object"};
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey.value()}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new HttpsError("internal", `OpenAI error ${response.status}: ${errorBody}`);
    }

    return await response.json();
  }
);

// ══════════════════════════════════════════════════════════════════════
// 6. OpenAI — Analyse d'image (Vision API pour charts trading)
// ══════════════════════════════════════════════════════════════════════
export const openaiAnalyzeImage = onCall(
  {
    secrets: [openaiKey],
    region: "europe-west1",
    timeoutSeconds: 300,
    memory: "1GiB",
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentification requise.");
    }

    const {imageBase64, prompt} = request.data;
    if (!imageBase64 || !prompt) {
      throw new HttpsError("invalid-argument", "Paramètres 'imageBase64' et 'prompt' requis.");
    }

    const body = {
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {type: "text", text: prompt},
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
                detail: "high",
              },
            },
          ],
        },
      ],
      max_tokens: 4000,
      temperature: 0.2,
      response_format: {type: "json_object"},
    };

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey.value()}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("OpenAI error:", response.status, errorBody);
      throw new HttpsError("internal", `OpenAI Vision error ${response.status}: ${errorBody}`);
    }

    const result = await response.json();
    console.log("OpenAI success, finish_reason:", result?.choices?.[0]?.finish_reason);
    return result;
  }
);

// ══════════════════════════════════════════════════════════════════════
// 7. Yahoo Finance — Stock/Forex/Index Candles (gratuit, pas de clé API)
// ══════════════════════════════════════════════════════════════════════
export const fetchYahooCandles = onCall(
  {region: "europe-west1", timeoutSeconds: 30},
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Auth requise.");
    const {symbol, interval, range} = request.data;
    if (!symbol) throw new HttpsError("invalid-argument", "symbol requis.");
    const trySymbol = async (sym: string) => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval || "1d"}&range=${range || "1y"}&includePrePost=false`;
      const r = await fetch(url, {headers: {"User-Agent": "Mozilla/5.0"}});
      if (!r.ok) return null;
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      if (!res?.timestamp?.length) return null;
      const q = res.indicators.quote[0];
      const candles = res.timestamp.map((t: number, i: number) => ({t, o: q.open?.[i] ?? 0, h: q.high?.[i] ?? 0, l: q.low?.[i] ?? 0, c: q.close?.[i] ?? 0, v: q.volume?.[i] ?? 0})).filter((c: {o: number; c: number}) => c.o > 0 && c.c > 0);
      return candles.length > 1 ? {s: "ok", symbol: res.meta?.symbol || sym, candles} : null;
    };
    for (const v of [symbol, `${symbol}.PA`, `${symbol}.L`, `${symbol}.DE`]) {
      try {
        const r = await trySymbol(v); if (r) return r;
      } catch {}
    }
    throw new HttpsError("not-found", `${symbol} introuvable.`);
  }
);

// ══════════════════════════════════════════════════════════════════════
// 8. countUsers — Nombre total d'utilisateurs
// ══════════════════════════════════════════════════════════════════════
export const countUsers = onCall({region: "europe-west1"}, async () => {
  const snap = await getFirestore().collection("users").count().get();
  return {count: snap.data().count};
});

// ══════════════════════════════════════════════════════════════════════
// 9. SYSTÈME DE PARRAINAGE — Helpers & Cloud Functions
// ══════════════════════════════════════════════════════════════════════

// ── Referral helpers ────────────────────────────────────────────────────────
function generateReferralCode(uid: string): string {
  const words = ["TRADE", "ALPHA", "BULL", "MOON", "EDGE", "PRO", "ACE", "TITAN", "APEX"];
  const word = words[Math.floor(Math.random() * words.length)];
  const hash = uid.slice(-4).toUpperCase().replace(/[^A-Z0-9]/g, "X");
  return `${word}-${hash}`;
}

async function ensureUniqueCode(base: string): Promise<string> {
  const db = admin.firestore();
  let code = base; let tries = 0;
  while (tries < 10) {
    const existing = await db.collection("referralCodes").doc(code).get();
    if (!existing.exists) return code;
    code = base.split("-")[0] + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
    tries++;
  }
  throw new Error("Could not generate unique referral code");
}

// ── generateUserReferralCode ─────────────────────────────────────────────────
export const generateUserReferralCode = onCall(
  {region: "europe-west1", maxInstances: 10},
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Non authentifié");
    const db = admin.firestore();
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (userSnap.data()?.referralCode) return {code: userSnap.data()!.referralCode};
    const displayName = userSnap.data()?.displayName || "";
    const base = displayName ?
      displayName.toUpperCase().slice(0, 5).replace(/[^A-Z0-9]/g, "") + "-" + Math.random().toString(36).slice(2, 6).toUpperCase() :
      generateReferralCode(uid);
    const code = await ensureUniqueCode(base);
    const batch = db.batch();
    batch.update(userRef, {referralCode: code});
    batch.set(db.collection("referralCodes").doc(code), {uid, createdAt: admin.firestore.FieldValue.serverTimestamp()});
    await batch.commit();
    return {code};
  }
);

// ── processReferral ──────────────────────────────────────────────────────────
export const processReferral = onCall(
  {region: "europe-west1", maxInstances: 10},
  async (request) => {
    const referredUid = request.auth?.uid;
    if (!referredUid) throw new HttpsError("unauthenticated", "Non authentifié");
    const {code} = request.data as { code: string };
    if (!code || typeof code !== "string") throw new HttpsError("invalid-argument", "Code manquant");
    const db = admin.firestore();
    return db.runTransaction(async (tx) => {
      const codeSnap = await tx.get(db.collection("referralCodes").doc(code.toUpperCase().trim()));
      if (!codeSnap.exists) throw new HttpsError("not-found", "Code invalide");
      const referrerUid: string = codeSnap.data()!.uid;
      if (referrerUid === referredUid) throw new HttpsError("failed-precondition", "Auto-parrainage interdit");
      const existing = await db.collection("referrals").where("referredUid", "==", referredUid).limit(1).get();
      if (!existing.empty) throw new HttpsError("already-exists", "Déjà parrainé");
      const referrerSnap = await tx.get(db.collection("users").doc(referrerUid));
      if (!referrerSnap.exists) throw new HttpsError("not-found", "Parrain introuvable");
      const countSnap = await db.collection("referrals").where("referrerUid", "==", referrerUid).get();
      if (countSnap.size >= 50) throw new HttpsError("resource-exhausted", "Limite atteinte");
      const referralRef = db.collection("referrals").doc();
      tx.set(referralRef, {referrerUid, referredUid, code: code.toUpperCase().trim(), status: "pending", createdAt: admin.firestore.FieldValue.serverTimestamp(), validatedAt: null, rewardedAt: null});
      tx.update(db.collection("users").doc(referredUid), {referredBy: referrerUid, referredAt: admin.firestore.FieldValue.serverTimestamp()});
      tx.update(db.collection("users").doc(referrerUid), {"referralStats.pending": admin.firestore.FieldValue.increment(1), "referralStats.totalReferred": admin.firestore.FieldValue.increment(1)});
      return {success: true, referralId: referralRef.id};
    });
  }
);

// ── getReferralStats ─────────────────────────────────────────────────────────
export const getReferralStats = onCall(
  {region: "europe-west1", maxInstances: 10},
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Non authentifié");
    const db = admin.firestore();
    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.data() || {};
    const referralCode: string = userData?.referralCode || "";
    const referralsSnap = await db.collection("referrals").where("referrerUid", "==", uid).get();
    const referrals = await Promise.all(referralsSnap.docs.map(async (doc) => {
      const data = doc.data();
      const referredSnap = await db.collection("users").doc(data.referredUid).get();
      const rd = referredSnap.data();
      return {id: doc.id, status: data.status, createdAt: data.createdAt?.toDate?.()?.toISOString()||null, validatedAt: data.validatedAt?.toDate?.()?.toISOString()||null, referred: {displayName: rd?.displayName||"Utilisateur", email: rd?.email?.replace(/(.{2}).*@/, "$1***@")||""}};
    }));
    return {
      referralCode,
      referralLink: `https://trademindset.app/signup?ref=${referralCode}`,
      stats: {
        total: referrals.length,
        pending: referrals.filter((r)=>r.status==="pending").length,
        validated: referrals.filter((r)=>r.status==="validated").length,
        rewarded: referrals.filter((r)=>r.status==="rewarded").length,
      },
      referrals,
      // ── FIX : exposer l'XP total pour la webapp ──
      totalXP: userData.totalXP || 0,
      rewards: userData.rewards || { badges: [], unlockedFeatures: [], bonusXP: 0, proDaysEarned: 0, passiveXPToday: 0 },
    };
  }
);

// ══════════════════════════════════════════════════════════════════════
// 9b. validateReferralOnTrade — Trigger auto quand un filleul crée son 1er trade
// ══════════════════════════════════════════════════════════════════════

// Paliers de récompenses parrain
const REFERRAL_TIERS = [
  { count: 1,  features: ["exportPdf"],          proDays: 0,  badge: null,          xpBonus: 50  },
  { count: 3,  features: ["advancedFilters"],     proDays: 5,  badge: null,          xpBonus: 75  },
  { count: 5,  features: [],                      proDays: 0,  badge: null,          xpBonus: 100 },
  { count: 10, features: ["dashboardWidgets"],    proDays: 10, badge: null,          xpBonus: 150 },
  { count: 15, features: [],                      proDays: 0,  badge: null,          xpBonus: 200 },
  { count: 20, features: [],                      proDays: 30, badge: "topParrain",  xpBonus: 300, requireProReferrals: 1 },
  { count: 25, features: [],                      proDays: 0,  badge: null,          xpBonus: 400 },
  { count: 30, features: [],                      proDays: 60, badge: "ambassadeur", xpBonus: 500, requireProReferrals: 2 },
  { count: 40, features: [],                      proDays: 0,  badge: null,          xpBonus: 750 },
  { count: 50, features: [],                      proDays: 90, badge: "legende",     xpBonus: 1000 },
];

export const validateReferralOnTrade = onDocumentCreated(
  { document: "users/{userId}/trades/{tradeId}" },
  async (event) => {
    const db = getFirestore();
    const filleulUid = event.params.userId;
    const tradeData = event.data?.data();
    if (!tradeData) return;

    // Vérifier que le trade a un P&L (anti-abus : pas de trade vide)
    const pnl = tradeData.flashPnLNet ?? tradeData.pnl ?? null;
    if (pnl === null && !tradeData.entryPrice) return;

    // Chercher un referral pending pour ce filleul
    const refSnap = await db.collection("referrals")
      .where("referredUid", "==", filleulUid)
      .where("status", "==", "pending")
      .limit(1)
      .get();

    if (refSnap.empty) return;
    const refDoc = refSnap.docs[0];
    const refData = refDoc.data();

    // Anti-abus : vérifier que le signup date d'au moins 5 min
    const createdAt = refData.createdAt?.toDate?.() || new Date(0);
    const now = new Date();
    const diffMs = now.getTime() - createdAt.getTime();
    if (diffMs < 300000) {
      console.log(`Referral ${refDoc.id} trop récent (${Math.round(diffMs/60000)}min), skip`);
      return;
    }

    const referrerUid = refData.referrerUid;

    // Transaction pour éviter les race conditions
    await db.runTransaction(async (tx) => {
      // Re-vérifier le statut dans la transaction
      const freshRef = await tx.get(refDoc.ref);
      if (freshRef.data()?.status !== "pending") return;

      // 1. Valider le referral
      tx.update(refDoc.ref, {
        status: "validated",
        validatedAt: FieldValue.serverTimestamp(),
      });

      // 2. Mettre à jour les stats du parrain
      const referrerRef = db.doc(`users/${referrerUid}`);
      const referrerSnap = await tx.get(referrerRef);
      const referrerData = referrerSnap.data() || {};
      const currentStats = referrerData.referralStats || { totalReferred: 0, pending: 0, validated: 0, rewarded: 0 };
      const currentRewards = referrerData.rewards || { badges: [], unlockedFeatures: [], bonusXP: 0, proDaysEarned: 0 };
      const isReferrerPro = referrerData.isPro === true || referrerData.subscriptionStatus === "active";

      const newValidated = (currentStats.validated || 0) + 1;
      const newPending = Math.max(0, (currentStats.pending || 0) - 1);

      // XP de base par filleul validé
      let xpGained = 25;

      // Vérifier les paliers
      const newFeatures = [...(currentRewards.unlockedFeatures || [])];
      const newBadges = [...(currentRewards.badges || [])];
      let newProDays = currentRewards.proDaysEarned || 0;

      for (const tier of REFERRAL_TIERS) {
        if (newValidated === tier.count) {
          // Vérifier la condition de filleuls Pro si nécessaire
          if ((tier as any).requireProReferrals) {
            const proRefsSnap = await db.collection("referrals")
              .where("referrerUid", "==", referrerUid)
              .where("referredIsPro", "==", true)
              .get();
            if (proRefsSnap.size < (tier as any).requireProReferrals) {
              // Condition non remplie, on donne quand même l'XP mais pas la récompense
              xpGained += tier.xpBonus;
              continue;
            }
          }
          // Ajouter les features
          for (const f of tier.features) {
            if (!newFeatures.includes(f)) newFeatures.push(f);
          }
          // Ajouter le badge
          if (tier.badge && !newBadges.includes(tier.badge)) newBadges.push(tier.badge);
          // Ajouter les jours Pro
          newProDays += tier.proDays;
          // Ajouter l'XP bonus palier
          xpGained += tier.xpBonus;
        }
      }

      // Multiplicateur Pro (×2 si le parrain est Pro)
      if (isReferrerPro) xpGained *= 2;

      tx.update(referrerRef, {
        "referralStats.validated": newValidated,
        "referralStats.pending": newPending,
        "rewards.unlockedFeatures": newFeatures,
        "rewards.badges": newBadges,
        "rewards.bonusXP": FieldValue.increment(xpGained),
        "rewards.proDaysEarned": newProDays,
        "totalXP": FieldValue.increment(xpGained),
      });

      // 3. Récompense filleul : +50 XP + badge "filleul" + 3 jours Pro
      const filleulRef = db.doc(`users/${filleulUid}`);
      const filleulSnap = await tx.get(filleulRef);
      const filleulData = filleulSnap.data() || {};
      const filleulBadges = filleulData.rewards?.badges || [];
      if (!filleulBadges.includes("filleul")) filleulBadges.push("filleul");

      tx.set(filleulRef, {
        rewards: {
          badges: filleulBadges,
          unlockedFeatures: filleulData.rewards?.unlockedFeatures || [],
          bonusXP: (filleulData.rewards?.bonusXP || 0) + 50,
          proDaysEarned: (filleulData.rewards?.proDaysEarned || 0) + 3,
        },
        totalXP: FieldValue.increment(50),
      }, { merge: true });

      // 4. Créer une notification pour le parrain
      const filleulName = filleulData.displayName || filleulData.email || "Un utilisateur";
      tx.create(db.collection(`users/${referrerUid}/notifications`).doc(), {
        type: "referral_validated",
        title: "Parrainage validé !",
        message: `🎉 ${filleulName} vient de faire son premier trade — parrainage validé !`,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
        data: { referralId: refDoc.id, filleulUid, xpGained },
      });
    });

    console.log(`✅ Referral ${refDoc.id} validated: ${referrerUid} ← ${filleulUid}`);
  }
);

// ══════════════════════════════════════════════════════════════════════
// 10. distributePassiveXP — Batch quotidien pour l'XP passif parrain
// ══════════════════════════════════════════════════════════════════════

export const distributePassiveXP = onSchedule(
  { schedule: "every day 00:30", region: "europe-west1", timeZone: "Europe/Paris" },
  async () => {
    const db = getFirestore();

    // Trouver tous les referrals validés ou récompensés
    const validatedRefs = await db.collection("referrals")
      .where("status", "in", ["validated", "rewarded"])
      .get();

    // Grouper par parrain
    const parrainMap = new Map<string, string[]>();
    for (const doc of validatedRefs.docs) {
      const d = doc.data();
      const referrerUid = d.referrerUid;
      if (!parrainMap.has(referrerUid)) parrainMap.set(referrerUid, []);
      parrainMap.get(referrerUid)!.push(d.referredUid);
    }

    let totalDistributed = 0;

    for (const [referrerUid, filleulUids] of parrainMap) {
      let parrainXPToday = 0;
      const CAP_PER_DAY = 100;

      // Vérifier si le parrain est Pro
      const referrerSnap = await db.doc(`users/${referrerUid}`).get();
      const referrerData = referrerSnap.data() || {};
      const isReferrerPro = referrerData.isPro === true || referrerData.subscriptionStatus === "active";
      const multiplier = isReferrerPro ? 2 : 1;

      for (const filleulUid of filleulUids) {
        if (parrainXPToday >= CAP_PER_DAY) break;

        // Récupérer l'XP gagné par le filleul hier
        const filleulSnap = await db.doc(`users/${filleulUid}`).get();
        const filleulData = filleulSnap.data() || {};
        const filleulDailyXP = filleulData.dailyXP || 0;
        const isFilleulPro = filleulData.isPro === true || filleulData.subscriptionStatus === "active";

        if (filleulDailyXP <= 0) continue;

        // 5% gratuit, 10% si filleul Pro
        const rate = isFilleulPro ? 0.10 : 0.05;
        let xpPassif = Math.floor(filleulDailyXP * rate);

        // Plafonner à 50 par filleul par jour
        xpPassif = Math.min(xpPassif, 50);

        // Plafonner au cap global
        xpPassif = Math.min(xpPassif, CAP_PER_DAY - parrainXPToday);

        // Appliquer multiplicateur Pro parrain
        xpPassif *= multiplier;

        if (xpPassif > 0) {
          parrainXPToday += xpPassif;
          totalDistributed += xpPassif;
        }
      }

      if (parrainXPToday > 0) {
        await db.doc(`users/${referrerUid}`).update({
          "totalXP": FieldValue.increment(parrainXPToday),
          "rewards.bonusXP": FieldValue.increment(parrainXPToday),
          "rewards.passiveXPToday": parrainXPToday,
          "rewards.passiveXPLastUpdate": FieldValue.serverTimestamp(),
        });
      }
    }

    console.log(`✅ Passive XP distributed: ${totalDistributed} XP to ${parrainMap.size} parrains`);
  }
);

// ══════════════════════════════════════════════════════════════════════
// 11. getReferralRewards — Retourne les récompenses et progression du parrain
// ══════════════════════════════════════════════════════════════════════
export const getReferralRewards = onCall({ region: "europe-west1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Auth requise.");
  const uid = request.auth.uid;
  const db = getFirestore();

  const userSnap = await db.doc(`users/${uid}`).get();
  const userData = userSnap.data() || {};
  const stats = userData.referralStats || { totalReferred: 0, pending: 0, validated: 0, rewarded: 0 };
  const rewards = userData.rewards || { badges: [], unlockedFeatures: [], bonusXP: 0, proDaysEarned: 0, passiveXPToday: 0 };

  // Compter les vrais docs referral validés (source de vérité)
  const realValidatedSnap = await db.collection("referrals")
    .where("referrerUid", "==", uid)
    .where("status", "in", ["validated", "rewarded"])
    .get();
  const validated = realValidatedSnap.size;

  // Calculer le prochain palier
  let nextTier = null;
  for (const tier of REFERRAL_TIERS) {
    if (validated < tier.count) {
      nextTier = {
        count: tier.count,
        current: validated,
        features: tier.features,
        proDays: tier.proDays,
        badge: tier.badge,
        xpBonus: tier.xpBonus,
        progress: validated / tier.count,
      };
      break;
    }
  }

  // Compter les filleuls Pro
  const proRefsSnap = await db.collection("referrals")
    .where("referrerUid", "==", uid)
    .where("referredIsPro", "==", true)
    .get();

  // Paliers déjà atteints
  const reachedTiers = REFERRAL_TIERS.filter(t => validated >= t.count);

  return {
    stats,
    rewards,
    nextTier,
    reachedTiers: reachedTiers.map(t => ({
      count: t.count,
      features: t.features,
      proDays: t.proDays,
      badge: t.badge,
      xpBonus: t.xpBonus,
    })),
    proReferralsCount: proRefsSnap.size,
    totalXP: userData.totalXP || 0,
    passiveXPToday: rewards.passiveXPToday || 0,
  };
});

// ══════════════════════════════════════════════════════════════════════
// 12. notifyReferrerOnProUpgrade — Notifie le parrain quand un filleul passe Pro
// ══════════════════════════════════════════════════════════════════════
export const notifyReferrerOnProUpgrade = onDocumentCreated(
  { document: "users/{userId}/subscriptions/{subId}" },
  async (event) => {
    const db = getFirestore();
    const filleulUid = event.params.userId;

    // Chercher le referral de ce filleul
    const refSnap = await db.collection("referrals")
      .where("referredUid", "==", filleulUid)
      .where("status", "in", ["validated", "rewarded"])
      .limit(1)
      .get();

    if (refSnap.empty) return;
    const refData = refSnap.docs[0].data();

    // Marquer le filleul comme Pro dans le referral
    await refSnap.docs[0].ref.update({ referredIsPro: true });

    // Notifier le parrain
    const filleulSnap = await db.doc(`users/${filleulUid}`).get();
    const filleulName = filleulSnap.data()?.displayName || "Un filleul";

    await db.collection(`users/${refData.referrerUid}/notifications`).add({
      type: "referral_pro_upgrade",
      title: "Filleul Pro !",
      message: `⭐ ${filleulName} est passé Pro — tu gagnes maintenant 10% de son XP !`,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
      data: { filleulUid, referralId: refSnap.docs[0].id },
    });

    // Re-vérifier les paliers avec condition Pro
    const referrerUid = refData.referrerUid;
    const proRefsSnap = await db.collection("referrals")
      .where("referrerUid", "==", referrerUid)
      .where("referredIsPro", "==", true)
      .get();
    const proCount = proRefsSnap.size;

    const referrerSnap = await db.doc(`users/${referrerUid}`).get();
    const referrerData = referrerSnap.data() || {};
    const validated = referrerData.referralStats?.validated || 0;
    const currentBadges = referrerData.rewards?.badges || [];
    const currentProDays = referrerData.rewards?.proDaysEarned || 0;
    const updates: Record<string, any> = {};

    // Palier 20 : 1 filleul Pro requis
    if (validated >= 20 && proCount >= 1 && !currentBadges.includes("topParrain")) {
      updates["rewards.badges"] = [...currentBadges, "topParrain"];
      updates["rewards.proDaysEarned"] = currentProDays + 30;
      updates["totalXP"] = FieldValue.increment(300);
    }
    // Palier 30 : 2 filleuls Pro requis
    if (validated >= 30 && proCount >= 2 && !currentBadges.includes("ambassadeur")) {
      const badges = updates["rewards.badges"] || currentBadges;
      if (!badges.includes("ambassadeur")) badges.push("ambassadeur");
      updates["rewards.badges"] = badges;
      updates["rewards.proDaysEarned"] = (updates["rewards.proDaysEarned"] || currentProDays) + 60;
      updates["totalXP"] = FieldValue.increment(500);
    }

    if (Object.keys(updates).length > 0) {
      await db.doc(`users/${referrerUid}`).update(updates);
    }

    console.log(`✅ Filleul ${filleulUid} passed Pro, referrer ${referrerUid} notified`);
  }
);

// ══════════════════════════════════════════════════════════════════════
// 13. coachIA — Coach IA avec mémoire persistante et analyse comportementale
//     Propulsé par GPT-4o (OpenAI)
// ══════════════════════════════════════════════════════════════════════

// ── Types pour coachIA ─────────────────────────────────────────────
interface TradeCtx {
  symbol:   string
  type:     string
  pnl:      number
  emotion?: string
  notes?:   string
  date:     string
}

interface CoachIARequest {
  userMessage:         string
  conversationHistory: { role: string; content: string }[]
  memoryContext:       string
  tradeContext: {
    totalTrades:  number
    winRate:      number
    totalPnL:     number
    recentTrades: TradeCtx[]
  }
}

export const coachIA = onCall(
  {
    secrets:        [openaiKey],
    region:         "europe-west1",
    timeoutSeconds: 120,
    memory:         "512MiB",
  },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Auth requise.");
    const uid = request.auth.uid;
    const { userMessage, conversationHistory, memoryContext, tradeContext } =
      request.data as CoachIARequest;

    if (!userMessage) throw new HttpsError("invalid-argument", "Message requis.");

    // ── System prompt ──────────────────────────────────────────────────
    const systemPrompt = `Tu es le Coach IA de TradeMindset — un coach expert en psychologie du trading, analytique et bienveillant.
Tu parles UNIQUEMENT en français, de manière directe et personnalisée.

<trader_context>
- Trades fermés : ${tradeContext.totalTrades}
- Win Rate : ${tradeContext.winRate}%
- P&L total : ${tradeContext.totalPnL}$
- 10 derniers trades : ${JSON.stringify(tradeContext.recentTrades.slice(0, 10))}
</trader_context>

<memories>
${memoryContext}
</memories>

<role>
1. Analyser les patterns comportementaux : FOMO, revenge trading, surconfiance, aversion à la perte, manque de discipline
2. Donner des conseils personnalisés basés sur l'historique RÉEL des trades
3. Mémoriser les informations importantes sur le trader pour les conversations futures
4. Être direct, honnête, mais encourageant — jamais condescendant
</role>

<response_format>
Réponds UNIQUEMENT avec du JSON valide, sans markdown autour :
{
  "message": "Ta réponse (markdown autorisé à l'intérieur : **gras**, listes)",
  "biases": ["fomo"|"revenge"|"overconfidence"|"loss_aversion"|"discipline"|"none"],
  "memoriesToSave": [
    {
      "type": "user"|"feedback"|"project"|"reference",
      "name": "Nom court",
      "description": "Une ligne résumant pourquoi c'est important",
      "content": "Contenu détaillé"
    }
  ],
  "suggestions": ["Action concrète 1", "Action concrète 2"]
}

Règles :
- "biases" : biais détectés dans la conversation. ["none"] si aucun.
- "memoriesToSave" : seulement si tu apprends quelque chose de NOUVEAU et IMPORTANT. Sinon [].
- "suggestions" : 1 à 3 actions concrètes actionnables maintenant.
- "message" : 3 à 8 phrases, percutant et actionnable.

Types de mémoires :
- "user" : profil du trader (style, niveau, préférences, forces/faiblesses)
- "feedback" : corrections ou confirmations d'approches importantes
- "project" : objectifs, défis en cours, contexte trading actuel
- "reference" : stratégies favorites, exchanges, actifs préférés
</response_format>`;

    // ── Build messages pour OpenAI (system + alternance user/assistant) ──
    const openaiMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
    ];

    const conversationMsgs = conversationHistory
      .slice(-8)
      .filter((m: { role: string; content: string }) => m.role === "user" || m.role === "assistant")
      .map((m: { role: string; content: string }) => ({ role: m.role as "user" | "assistant", content: m.content }));

    // Assurer l'alternance stricte user/assistant
    for (const msg of conversationMsgs) {
      const last = openaiMessages[openaiMessages.length - 1];
      if (last && last.role === msg.role) {
        last.content += "\n\n" + msg.content;
      } else {
        openaiMessages.push({ role: msg.role, content: msg.content });
      }
    }

    // Ajouter le message actuel
    const lastMsg = openaiMessages[openaiMessages.length - 1];
    if (lastMsg && lastMsg.role === "user") {
      lastMsg.content += "\n\n" + userMessage;
    } else {
      openaiMessages.push({ role: "user", content: userMessage });
    }

    // ── Appel API OpenAI ───────────────────────────────────────────────
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${openaiKey.value()}`,
      },
      body: JSON.stringify({
        model:           "gpt-4o",
        messages:        openaiMessages,
        max_tokens:      1024,
        temperature:     0.3,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new HttpsError("internal", `OpenAI error ${response.status}: ${err}`);
    }

    const result  = await response.json();
    const rawText = result.choices?.[0]?.message?.content || "{}";

    // ── Parse réponse JSON ─────────────────────────────────────────────
    let parsed: {
      message:         string
      biases:          string[]
      memoriesToSave?: { type: string; name: string; description: string; content: string }[]
      suggestions:     string[]
    };
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = { message: rawText, biases: ["none"], memoriesToSave: [], suggestions: [] };
    }

    console.log(`✅ CoachIA GPT-4o [${uid}]: biases=${JSON.stringify(parsed.biases)}, memories=${parsed.memoriesToSave?.length || 0}, tokens=${result.usage?.completion_tokens || 0}`);

    return {
      message:        parsed.message        || "Je n'ai pas pu générer de réponse.",
      biases:         parsed.biases         || ["none"],
      memoriesToSave: parsed.memoriesToSave || [],
      suggestions:    parsed.suggestions    || [],
    };
  }
);

// ══════════════════════════════════════════════════════════════════════
// 14. fixMissingReferralXP — Rattrapage one-shot pour les referrals validés sans XP
//     Appelle cette function une fois depuis la console ou via un appel HTTP
//     puis supprime-la après usage.
// ══════════════════════════════════════════════════════════════════════
export const fixMissingReferralXP = onCall(
  { region: "europe-west1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Auth requise.");
    const uid = request.auth.uid;
    const db = getFirestore();

    // Récupérer les referrals validés de cet utilisateur
    const validatedSnap = await db.collection("referrals")
      .where("referrerUid", "==", uid)
      .where("status", "==", "validated")
      .get();

    if (validatedSnap.empty) {
      return { fixed: 0, message: "Aucun referral validé trouvé." };
    }

    const validatedCount = validatedSnap.size;

    // Calculer l'XP qui aurait dû être attribué
    let totalXP = 0;
    const earnedFeatures: string[] = [];
    const earnedBadges: string[] = [];
    let earnedProDays = 0;

    for (let i = 1; i <= validatedCount; i++) {
      // XP de base par filleul
      totalXP += 25;

      // Vérifier les paliers
      for (const tier of REFERRAL_TIERS) {
        if (i === tier.count) {
          totalXP += tier.xpBonus;
          for (const f of tier.features) {
            if (!earnedFeatures.includes(f)) earnedFeatures.push(f);
          }
          if (tier.badge && !earnedBadges.includes(tier.badge)) {
            // Ignorer les paliers nécessitant des filleuls Pro pour le fix
            if (!(tier as any).requireProReferrals) {
              earnedBadges.push(tier.badge);
              earnedProDays += tier.proDays;
            }
          } else if (!tier.badge) {
            earnedProDays += tier.proDays;
          }
        }
      }
    }

    // Lire l'état actuel
    const userSnap = await db.doc(`users/${uid}`).get();
    const userData = userSnap.data() || {};
    const currentXP = userData.totalXP || 0;
    const currentBonusXP = userData.rewards?.bonusXP || 0;

    // Si l'XP est déjà correct, ne rien faire
    if (currentBonusXP >= totalXP) {
      return { fixed: 0, message: `XP déjà à jour (${currentBonusXP} bonusXP).` };
    }

    // Rattraper l'XP manquant
    const xpToAdd = totalXP - currentBonusXP;
    const currentFeatures = userData.rewards?.unlockedFeatures || [];
    const currentBadges = userData.rewards?.badges || [];

    const mergedFeatures = [...new Set([...currentFeatures, ...earnedFeatures])];
    const mergedBadges = [...new Set([...currentBadges, ...earnedBadges])];

    await db.doc(`users/${uid}`).set({
      totalXP: FieldValue.increment(xpToAdd),
      rewards: {
        bonusXP: totalXP,
        unlockedFeatures: mergedFeatures,
        badges: mergedBadges,
        proDaysEarned: Math.max(userData.rewards?.proDaysEarned || 0, earnedProDays),
        passiveXPToday: userData.rewards?.passiveXPToday || 0,
      },
      // Sync referralStats.validated avec le vrai compte des docs referral
      "referralStats.validated": validatedCount,
    }, { merge: true });

    console.log(`✅ fixMissingReferralXP [${uid}]: +${xpToAdd} XP (total: ${currentXP + xpToAdd}), ${validatedCount} referrals`);

    return {
      fixed: validatedCount,
      xpAdded: xpToAdd,
      newTotalXP: currentXP + xpToAdd,
      features: mergedFeatures,
      badges: mergedBadges,
      message: `Rattrapé ${xpToAdd} XP pour ${validatedCount} filleul(s) validé(s).`,
    };
  }
);
// ══════════════════════════════════════════════════════════════════════
// GAMIFICATION — Cloud Functions à ajouter dans index.ts
// Colle ce code à la fin de ton fichier index.ts existant
// ══════════════════════════════════════════════════════════════════════

// ── Imports déjà présents dans ton index.ts (ne pas dupliquer) ──
// import { FieldValue } from "firebase-admin/firestore";
// import { getFirestore } from "firebase-admin/firestore";
// import { onCall, HttpsError } from "firebase-functions/v2/https";
// import { onSchedule } from "firebase-functions/v2/scheduler";

// ══════════════════════════════════════════════════════════════════════
// GAMIFICATION HELPERS
// ══════════════════════════════════════════════════════════════════════

const MAX_LEVEL = 50;

function xpForLevel(level: number): number {
  if (level <= 0) return 0;
  return Math.round(100 * Math.pow(level, 1.5));
}

function levelFromXP(totalXP: number): number {
  let level = 0;
  while (level < MAX_LEVEL && totalXP >= xpForLevel(level + 1)) {
    level++;
  }
  return level;
}

// ══════════════════════════════════════════════════════════════════════
// 15. awardXP — Point unique d'attribution d'XP
// ══════════════════════════════════════════════════════════════════════
export const awardXP = onCall(
  { region: "europe-west1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Auth requise.");
    const uid = request.auth.uid;
    const { amount, source, detail } = request.data as { amount: number; source: string; detail?: string };

    if (!amount || amount <= 0) throw new HttpsError("invalid-argument", "Montant XP invalide.");

    const db = getFirestore();
    const userRef = db.doc(`users/${uid}`);

    const result = await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      const userData = userSnap.data() || {};
      const currentXP = userData.totalXP || 0;
      const multiplier = userData.activeMultiplier || 1.0;
      const oldLevel = levelFromXP(currentXP);

      // Appliquer le multiplicateur
      const finalAmount = Math.round(amount * multiplier);
      const newXP = currentXP + finalAmount;
      const newLevel = levelFromXP(newXP);
      const leveledUp = newLevel > oldLevel;

      // Update user doc
      tx.update(userRef, {
        totalXP: FieldValue.increment(finalAmount),
        level: newLevel,
      });

      // Log XP history
      tx.create(db.collection(`users/${uid}/xpHistory`).doc(), {
        amount: finalAmount,
        baseAmount: amount,
        multiplier,
        source,
        detail: detail || null,
        createdAt: FieldValue.serverTimestamp(),
      });

      // Notification si level up
      if (leveledUp) {
        tx.create(db.collection(`users/${uid}/notifications`).doc(), {
          type: "level_up",
          title: `Niveau ${newLevel} atteint !`,
          message: `🎉 Tu viens de passer au niveau ${newLevel} — continue comme ça !`,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
          data: { oldLevel, newLevel },
        });
      }

      return { newXP, newLevel, leveledUp, finalAmount };
    });

    // Vérifier les badges après attribution d'XP
    // (on le fait hors transaction pour ne pas bloquer)
    try {
      const badgeResult = await checkBadgesInternal(uid);
      return { ...result, newBadges: badgeResult.newBadges };
    } catch {
      return { ...result, newBadges: [] };
    }
  }
);

// ══════════════════════════════════════════════════════════════════════
// 16. checkBadges — Vérifie et attribue les badges mérités
// ══════════════════════════════════════════════════════════════════════

async function checkBadgesInternal(uid: string): Promise<{ newBadges: string[]; totalBadges: number }> {
  const db = getFirestore();
  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  const userData = userSnap.data() || {};

  const earnedIds: string[] = userData.earnedBadgeIds || [];
  const earnedSet = new Set(earnedIds);

  // Charger les stats nécessaires
  const tradesSnap = await db.collection(`users/${uid}/trades`).get();
  const trades = tradesSnap.docs.map(d => d.data());
  const closedTrades = trades.filter(t => t.status === "closed");

  const totalTrades = closedTrades.length;
  const winningTrades = closedTrades.filter(t => (t.pnl ?? 0) > 0);
  const losingTrades = closedTrades.filter(t => (t.pnl ?? 0) < 0);
  const winRate = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;
  const totalPnL = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const uniqueSymbols = new Set(closedTrades.map(t => t.symbol)).size;

  const totalXP = userData.totalXP || 0;
  const level = userData.level || levelFromXP(totalXP);
  const prestigeLevel = userData.prestigeLevel || 0;
  const badgeCount = earnedIds.length;

  // Stats parrainage
  const referralStats = userData.referralStats || {};
  const referralsValidated = referralStats.validated || 0;

  // Stats journal — compter les notes
  const journalCount = closedTrades.filter(t => t.notes && t.notes.length > 0).length;
  const journalWithEmotion = closedTrades.filter(t => t.emotion).length;
  const journalDetailed = closedTrades.filter(t => t.notes && t.notes.length > 50).length;

  // Stats par marché
  const assetTypes: Record<string, number> = {};
  closedTrades.forEach(t => {
    const at = t.assetType || "other";
    assetTypes[at] = (assetTypes[at] || 0) + 1;
  });
  const marketsWithMinTrades = (min: number) => Object.values(assetTypes).filter(c => c >= min).length;

  // Win streak max
  let maxWinStreak = 0, currentWinStreak = 0;
  const sortedTrades = closedTrades.sort((a, b) => {
    const da = a.exitDate?.toDate?.() || a.exitDate || new Date(0);
    const db2 = b.exitDate?.toDate?.() || b.exitDate || new Date(0);
    return new Date(da).getTime() - new Date(db2).getTime();
  });
  for (const t of sortedTrades) {
    if ((t.pnl ?? 0) > 0) { currentWinStreak++; maxWinStreak = Math.max(maxWinStreak, currentWinStreak); }
    else currentWinStreak = 0;
  }

  // Coach stats
  const coachMessages = userData.coachStats?.messageCount || 0;
  const coachMemories = userData.coachStats?.memoryCount || 0;
  const biasesDetected = userData.coachStats?.biasesDetected || {};

  // Activity streak
  const currentStreak = userData.currentStreak || 0;

  // Challenges
  const challengesCompleted = userData.challengeStats?.completed || 0;

  // ── Évaluation des conditions ───────────────────────────────────
  const newBadges: string[] = [];

  // Badge condition types et leur évaluation
  const evaluators: Record<string, (condition: any) => boolean> = {
    tradesCount: (c) => totalTrades >= c.value,
    firstWin: () => winningTrades.length >= 1,
    winRate: (c) => totalTrades >= (c.extra?.minTrades || 0) && winRate >= c.value,
    winStreak: (c) => maxWinStreak >= c.value,
    activityStreak: (c) => currentStreak >= c.value,
    journalCount: (c) => journalCount >= c.value,
    journalWithEmotion: (c) => journalWithEmotion >= c.value,
    journalDetailed: (c) => journalDetailed >= c.value,
    uniqueSymbols: (c) => uniqueSymbols >= c.value,
    assetTypeTrades: (c) => (assetTypes[c.extra?.assetType] || 0) >= c.value,
    multiMarket: (c) => marketsWithMinTrades(c.extra?.minPerMarket || 10) >= c.value,
    totalPnL: (c) => totalPnL >= c.value,
    firstProfit: () => winningTrades.length >= 1,
    firstLoss: () => losingTrades.length >= 1,
    singleTradePnL: (c) => closedTrades.some(t => (t.pnl ?? 0) >= c.value),
    referralsValidated: (c) => referralsValidated >= c.value,
    level: (c) => level >= c.value,
    prestige: (c) => prestigeLevel >= c.value,
    lifetimeXP: (c) => totalXP >= c.value,
    coachMessages: (c) => coachMessages >= c.value,
    coachMemories: (c) => coachMemories >= c.value,
    firstBiasDetected: () => Object.keys(biasesDetected).length >= 1,
    allBiasesDetected: () => Object.keys(biasesDetected).length >= 5,
    challengesCompleted: (c) => challengesCompleted >= c.value,
    badgeCount: (c) => badgeCount >= c.value,
    lossStreak: (c) => {
      let maxLoss = 0, curr = 0;
      for (const t of sortedTrades) {
        if ((t.pnl ?? 0) < 0) { curr++; maxLoss = Math.max(maxLoss, curr); }
        else curr = 0;
      }
      return maxLoss >= c.value;
    },
    totalLosses: (c) => losingTrades.length >= c.value,
    biasCount: (c) => (biasesDetected[c.extra?.bias] || 0) >= c.value,
  };

  // Import badge definitions (inline IDs to avoid importing client code)
  // We use a simple approach: the badge IDs and conditions are defined in the client
  // and we just evaluate them server-side based on the condition type

  // Populate from a hardcoded mapping (simplified — in production you'd store these in Firestore)
  // For now, we evaluate based on what the client sends or what's stored
  // The real evaluation happens based on the user's stats vs badge conditions

  // Simplified: check all known badge IDs from user's perspective
  // In production, store badge definitions in Firestore and read them here

  // For the MVP, we'll use the approach where the client calls checkBadges
  // with the badge definitions it knows about, and the server validates

  // ── Approach: iterate condition types we can evaluate ──
  const badgeChecks: { id: string; condType: string; value: number; extra?: any }[] = [
    // Volume
    { id: 'vol_1', condType: 'tradesCount', value: 1 },
    { id: 'vol_5', condType: 'tradesCount', value: 5 },
    { id: 'vol_10', condType: 'tradesCount', value: 10 },
    { id: 'vol_25', condType: 'tradesCount', value: 25 },
    { id: 'vol_50', condType: 'tradesCount', value: 50 },
    { id: 'vol_100', condType: 'tradesCount', value: 100 },
    { id: 'vol_200', condType: 'tradesCount', value: 200 },
    { id: 'vol_350', condType: 'tradesCount', value: 350 },
    { id: 'vol_500', condType: 'tradesCount', value: 500 },
    { id: 'vol_750', condType: 'tradesCount', value: 750 },
    { id: 'vol_1000', condType: 'tradesCount', value: 1000 },
    { id: 'vol_1500', condType: 'tradesCount', value: 1500 },
    { id: 'vol_2000', condType: 'tradesCount', value: 2000 },
    { id: 'vol_3000', condType: 'tradesCount', value: 3000 },
    { id: 'vol_5000', condType: 'tradesCount', value: 5000 },
    // Win rate
    { id: 'wr_first', condType: 'firstWin', value: 1 },
    { id: 'wr_50_20', condType: 'winRate', value: 50, extra: { minTrades: 20 } },
    { id: 'wr_55_30', condType: 'winRate', value: 55, extra: { minTrades: 30 } },
    { id: 'wr_58_50', condType: 'winRate', value: 58, extra: { minTrades: 50 } },
    { id: 'wr_60_75', condType: 'winRate', value: 60, extra: { minTrades: 75 } },
    { id: 'wr_63_100', condType: 'winRate', value: 63, extra: { minTrades: 100 } },
    { id: 'wr_65_100', condType: 'winRate', value: 65, extra: { minTrades: 100 } },
    { id: 'wr_68_150', condType: 'winRate', value: 68, extra: { minTrades: 150 } },
    { id: 'wr_70_200', condType: 'winRate', value: 70, extra: { minTrades: 200 } },
    { id: 'wr_streak5', condType: 'winStreak', value: 5 },
    { id: 'wr_streak10', condType: 'winStreak', value: 10 },
    { id: 'wr_streak15', condType: 'winStreak', value: 15 },
    // Streak
    { id: 'str_1', condType: 'activityStreak', value: 1 },
    { id: 'str_3', condType: 'activityStreak', value: 3 },
    { id: 'str_7', condType: 'activityStreak', value: 7 },
    { id: 'str_14', condType: 'activityStreak', value: 14 },
    { id: 'str_30', condType: 'activityStreak', value: 30 },
    { id: 'str_60', condType: 'activityStreak', value: 60 },
    { id: 'str_100', condType: 'activityStreak', value: 100 },
    { id: 'str_200', condType: 'activityStreak', value: 200 },
    // Journal
    { id: 'jrn_1', condType: 'journalCount', value: 1 },
    { id: 'jrn_10', condType: 'journalCount', value: 10 },
    { id: 'jrn_25', condType: 'journalCount', value: 25 },
    { id: 'jrn_50_emo', condType: 'journalWithEmotion', value: 50 },
    { id: 'jrn_100_emo', condType: 'journalWithEmotion', value: 100 },
    { id: 'jrn_200_det', condType: 'journalDetailed', value: 200 },
    // Market
    { id: 'mkt_3', condType: 'uniqueSymbols', value: 3 },
    { id: 'mkt_10', condType: 'uniqueSymbols', value: 10 },
    { id: 'mkt_25', condType: 'uniqueSymbols', value: 25 },
    { id: 'mkt_50', condType: 'uniqueSymbols', value: 50 },
    { id: 'mkt_100', condType: 'uniqueSymbols', value: 100 },
    { id: 'mkt_crypto', condType: 'assetTypeTrades', value: 20, extra: { assetType: 'crypto' } },
    { id: 'mkt_forex', condType: 'assetTypeTrades', value: 20, extra: { assetType: 'forex' } },
    { id: 'mkt_stocks', condType: 'assetTypeTrades', value: 20, extra: { assetType: 'stocks' } },
    { id: 'mkt_futures', condType: 'assetTypeTrades', value: 20, extra: { assetType: 'futures' } },
    { id: 'mkt_multi2', condType: 'multiMarket', value: 2, extra: { minPerMarket: 10 } },
    { id: 'mkt_multi3', condType: 'multiMarket', value: 3, extra: { minPerMarket: 10 } },
    { id: 'mkt_multi4', condType: 'multiMarket', value: 4, extra: { minPerMarket: 20 } },
    // P&L
    { id: 'pnl_first', condType: 'firstProfit', value: 1 },
    { id: 'pnl_green', condType: 'totalPnL', value: 0.01 },
    { id: 'pnl_100', condType: 'totalPnL', value: 100 },
    { id: 'pnl_500', condType: 'totalPnL', value: 500 },
    { id: 'pnl_1000', condType: 'totalPnL', value: 1000 },
    { id: 'pnl_5000', condType: 'totalPnL', value: 5000 },
    { id: 'pnl_10000', condType: 'totalPnL', value: 10000 },
    { id: 'pnl_50000', condType: 'totalPnL', value: 50000 },
    { id: 'pnl_100000', condType: 'totalPnL', value: 100000 },
    { id: 'pnl_bigtrade', condType: 'singleTradePnL', value: 500 },
    // Social
    { id: 'soc_1', condType: 'referralsValidated', value: 1 },
    { id: 'soc_3', condType: 'referralsValidated', value: 3 },
    { id: 'soc_5', condType: 'referralsValidated', value: 5 },
    { id: 'soc_10', condType: 'referralsValidated', value: 10 },
    { id: 'soc_20', condType: 'referralsValidated', value: 20 },
    { id: 'soc_30', condType: 'referralsValidated', value: 30 },
    { id: 'soc_50', condType: 'referralsValidated', value: 50 },
    // Prestige
    { id: 'lvl_5', condType: 'level', value: 5 },
    { id: 'lvl_10', condType: 'level', value: 10 },
    { id: 'lvl_25', condType: 'level', value: 25 },
    { id: 'lvl_50', condType: 'level', value: 50 },
    { id: 'pres_1', condType: 'prestige', value: 1 },
    { id: 'pres_2', condType: 'prestige', value: 2 },
    { id: 'pres_3', condType: 'prestige', value: 3 },
    { id: 'xp_million', condType: 'lifetimeXP', value: 1000000 },
    // Coach
    { id: 'ai_1', condType: 'coachMessages', value: 1 },
    { id: 'ai_10', condType: 'coachMessages', value: 10 },
    { id: 'ai_50', condType: 'coachMessages', value: 50 },
    { id: 'ai_200', condType: 'coachMessages', value: 200 },
    { id: 'ai_bias1', condType: 'firstBiasDetected', value: 1 },
    { id: 'ai_allbias', condType: 'allBiasesDetected', value: 5 },
    { id: 'ai_memory', condType: 'coachMemories', value: 20 },
    // Challenges
    { id: 'ch_1', condType: 'challengesCompleted', value: 1 },
    { id: 'ch_10', condType: 'challengesCompleted', value: 10 },
    { id: 'ch_25', condType: 'challengesCompleted', value: 25 },
    { id: 'ch_50', condType: 'challengesCompleted', value: 50 },
    { id: 'ch_100', condType: 'challengesCompleted', value: 100 },
    { id: 'ch_200', condType: 'challengesCompleted', value: 200 },
    // Humor
    { id: 'hum_first_loss', condType: 'firstLoss', value: 1 },
    { id: 'hum_streak5', condType: 'lossStreak', value: 5 },
    { id: 'hum_100losses', condType: 'totalLosses', value: 100 },
    { id: 'hum_revenge', condType: 'biasCount', value: 3, extra: { bias: 'revenge' } },
    { id: 'hum_fomo', condType: 'biasCount', value: 5, extra: { bias: 'fomo' } },
    { id: 'hum_overconf', condType: 'biasCount', value: 5, extra: { bias: 'overconfidence' } },
    // Secret badge count
    { id: 'sec_50badges', condType: 'badgeCount', value: 50 },
    { id: 'sec_100badges', condType: 'badgeCount', value: 100 },
    { id: 'sec_ultimate', condType: 'badgeCount', value: 140 },
  ];

  // Badge XP rewards
  // Common=25, Rare=75, Epic=200, Legendary=500, Mythic=1000, Secret=150
  const rarityMap: Record<string, string> = {
    vol_1: 'common', vol_5: 'common', vol_10: 'common', vol_25: 'common',
    vol_50: 'rare', vol_100: 'rare', vol_200: 'rare',
    vol_350: 'epic', vol_500: 'epic', vol_750: 'epic',
    vol_1000: 'legendary', vol_1500: 'legendary', vol_2000: 'legendary',
    vol_3000: 'mythic', vol_5000: 'mythic',
    wr_first: 'common', wr_50_20: 'common', wr_55_30: 'common',
    wr_58_50: 'rare', wr_60_75: 'rare', wr_63_100: 'epic', wr_65_100: 'epic',
    wr_68_150: 'legendary', wr_70_200: 'legendary',
    wr_streak5: 'rare', wr_streak10: 'epic', wr_streak15: 'legendary',
    pnl_first: 'common', pnl_green: 'common', pnl_100: 'common',
    pnl_500: 'rare', pnl_1000: 'rare', pnl_5000: 'epic', pnl_10000: 'epic',
    pnl_50000: 'legendary', pnl_100000: 'mythic', pnl_bigtrade: 'rare',
    soc_1: 'common', soc_3: 'common', soc_5: 'rare', soc_10: 'rare',
    soc_20: 'epic', soc_30: 'legendary', soc_50: 'legendary',
    hum_first_loss: 'common', hum_streak5: 'common', hum_100losses: 'rare',
    hum_revenge: 'rare', hum_fomo: 'rare', hum_overconf: 'rare',
    sec_50badges: 'secret', sec_100badges: 'secret', sec_ultimate: 'secret',
  };
  const xpByRarity: Record<string, number> = {
    common: 25, rare: 75, epic: 200, legendary: 500, mythic: 1000, secret: 150,
  };

  for (const check of badgeChecks) {
    if (earnedSet.has(check.id)) continue;

    const evaluator = evaluators[check.condType];
    if (!evaluator) continue;

    const condition = { type: check.condType, value: check.value, extra: check.extra };
    if (evaluator(condition)) {
      newBadges.push(check.id);
      earnedSet.add(check.id);
    }
  }

  // Écrire les nouveaux badges
  if (newBadges.length > 0) {
    const allEarned = Array.from(earnedSet);
    let totalBonusXP = 0;

    for (const badgeId of newBadges) {
      const rarity = rarityMap[badgeId] || 'common';
      totalBonusXP += xpByRarity[rarity] || 25;
    }

    await userRef.set({
      earnedBadgeIds: allEarned,
      badgeCount: allEarned.length,
      totalXP: FieldValue.increment(totalBonusXP),
    }, { merge: true });

    // Notification pour chaque nouveau badge
    const batch = db.batch();
    for (const badgeId of newBadges) {
      const notifRef = db.collection(`users/${uid}/notifications`).doc();
      batch.set(notifRef, {
        type: "badge_earned",
        title: "Nouveau badge !",
        message: `🏅 Tu as débloqué le badge "${badgeId}" !`,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
        data: { badgeId },
      });
    }
    await batch.commit();

    console.log(`✅ checkBadges [${uid}]: +${newBadges.length} badges (${newBadges.join(', ')}), +${totalBonusXP} XP`);
  }

  return { newBadges, totalBadges: earnedSet.size };
}

export const checkBadges = onCall(
  { region: "europe-west1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Auth requise.");
    return checkBadgesInternal(request.auth.uid);
  }
);

// ══════════════════════════════════════════════════════════════════════
// 17. doPrestige — Reset volontaire au niveau 50
// ══════════════════════════════════════════════════════════════════════
export const doPrestige = onCall(
  { region: "europe-west1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Auth requise.");
    const uid = request.auth.uid;
    const db = getFirestore();
    const userRef = db.doc(`users/${uid}`);

    return db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      const userData = userSnap.data() || {};
      const currentXP = userData.totalXP || 0;
      const currentLevel = levelFromXP(currentXP);

      if (currentLevel < MAX_LEVEL) {
        throw new HttpsError("failed-precondition", `Niveau ${MAX_LEVEL} requis pour le prestige (actuellement ${currentLevel}).`);
      }

      const currentPrestige = userData.prestigeLevel || 0;
      const newPrestige = currentPrestige + 1;
      const currentMultiplier = userData.activeMultiplier || 1.0;
      // +10% par prestige
      const newMultiplier = Math.round((currentMultiplier + 0.10) * 100) / 100;

      tx.update(userRef, {
        prestigeLevel: newPrestige,
        prestigeXP: FieldValue.increment(currentXP),
        totalXP: 0,
        level: 0,
        activeMultiplier: newMultiplier,
      });

      // Notification
      tx.create(db.collection(`users/${uid}/notifications`).doc(), {
        type: "prestige",
        title: `Prestige ${newPrestige} !`,
        message: `🌟 Tu viens d'atteindre le Prestige ${newPrestige} — multiplicateur XP ×${newMultiplier} !`,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
        data: { prestigeLevel: newPrestige, multiplier: newMultiplier },
      });

      return { newPrestigeLevel: newPrestige, xpReset: currentXP, newMultiplier };
    });
  }
);

// ══════════════════════════════════════════════════════════════════════
// 18. updateDailyStreak — Appelé par un scheduler quotidien
// ══════════════════════════════════════════════════════════════════════
export const updateDailyStreak = onSchedule(
  { schedule: "every day 01:00", region: "europe-west1", timeZone: "Europe/Paris" },
  async () => {
    const db = getFirestore();
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    // Trouver tous les users actifs
    const usersSnap = await db.collection("users")
      .where("lastActivityDate", ">=", yesterday)
      .get();

    let updated = 0;
    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data();
      const lastActivity = data.lastActivityDate;

      if (lastActivity === today || lastActivity === yesterday) {
        // Streak continue — déjà à jour
      } else {
        // Streak cassé
        await userDoc.ref.update({
          currentStreak: 0,
        });
        updated++;
      }
    }

    console.log(`✅ updateDailyStreak: ${updated} streaks reset`);
  }
);

// ══════════════════════════════════════════════════════════════════════
// EXCHANGE IMPORT — Binance & Bybit HMAC-signed server-side
// Firestore : users/{uid}/apiKeys/{exchange}
//             users/{uid}/trades/{id}
// ══════════════════════════════════════════════════════════════════════

import * as nodeCrypto from "crypto";

type Exchange = "binance" | "bybit" | "okx" | "kucoinfutures" | "bitget" | "gateio" | "mexc" | "htx" | "kraken" | "phemex" | "deribit" | "ig" | "capitalcom" | "tastytrade" | "trading212" | "oanda" | "alpaca";

interface APIKeyDoc {
  apiKey: string;
  apiSecret: string;
  lastSync?: FirebaseFirestore.Timestamp;
  importedCount?: number;
}

interface ImportedTrade {
  id: string;
  date: FirebaseFirestore.Timestamp;
  symbol: string;
  type: "Long" | "Short";
  entryPrice?: number;
  exitPrice?: number;
  quantity?: number;
  leverage: number;
  exchangeId: string;
  orderRole: "Maker" | "Taker";
  systemId: string;
  session: "US" | "Asia" | "Europe";
  flashPnLNet: number;
  notes: string;
  tags: string[];
  status: "closed";
  source: Exchange;
  externalId: string;
  closedAt: FirebaseFirestore.Timestamp;
}

function hmac(secret: string, payload: string): string {
  return nodeCrypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function getSession(ts: number): "US" | "Asia" | "Europe" {
  const h = new Date(ts).getUTCHours();
  if (h >= 0 && h < 8) return "Asia";
  if (h >= 8 && h < 14) return "Europe";
  return "US";
}

async function fetchBinanceTrades(
  apiKey: string, secret: string, startTime?: number
): Promise<ImportedTrade[]> {
  const db2 = getFirestore();
  void db2; // suppress unused warning
  const now = Date.now();
  const start = startTime ?? now - 90 * 24 * 60 * 60 * 1000;

  const qs1 = `incomeType=REALIZED_PNL&startTime=${start}&endTime=${now}&limit=1000&timestamp=${now}`;
  const sig1 = hmac(secret, qs1);
  const res1 = await fetch(`https://fapi.binance.com/fapi/v1/income?${qs1}&signature=${sig1}`, {
    headers: {"X-MBX-APIKEY": apiKey},
  });
  if (!res1.ok) throw new Error(`Binance income: ${res1.status} ${await res1.text()}`);

  const income = await res1.json() as {
    symbol: string; incomeType: string; income: string;
    info: string; time: number; tradeId: string; tranId: string;
  }[];

  const trades: ImportedTrade[] = income
    .filter(i => i.incomeType === "REALIZED_PNL")
    .map(i => {
      const ts = admin.firestore.Timestamp.fromMillis(i.time);
      return {
        id: i.tranId,
        date: ts,
        symbol: i.symbol,
        type: (i.info === "LONG" ? "Long" : "Short") as "Long" | "Short",
        leverage: 1,
        exchangeId: "Binance",
        orderRole: "Taker" as const,
        systemId: "imported",
        session: getSession(i.time),
        flashPnLNet: parseFloat(i.income),
        notes: `Auto-importé Binance Futures (tradeId: ${i.tradeId})`,
        tags: ["binance", "auto-import"],
        status: "closed" as const,
        source: "binance" as const,
        externalId: i.tranId,
        closedAt: ts,
      };
    });

  // Enrichissement prix via userTrades (best effort)
  const symbols = [...new Set(trades.map(t => t.symbol))].slice(0, 10);
  for (const sym of symbols) {
    try {
      const qs2 = `symbol=${sym}&startTime=${start}&limit=1000&timestamp=${Date.now()}`;
      const sig2 = hmac(secret, qs2);
      const res2 = await fetch(`https://fapi.binance.com/fapi/v1/userTrades?${qs2}&signature=${sig2}`, {
        headers: {"X-MBX-APIKEY": apiKey},
      });
      if (!res2.ok) continue;
      const fills = await res2.json() as {price: string; qty: string; maker: boolean}[];
      const total = fills.reduce((s, f) => s + parseFloat(f.qty), 0);
      if (total === 0) continue;
      const wAvg = fills.reduce((s, f) => s + parseFloat(f.price) * parseFloat(f.qty), 0) / total;
      trades.filter(t => t.symbol === sym).forEach(t => {
        t.quantity = total;
        t.entryPrice = wAvg;
        if (fills.some(f => f.maker)) t.orderRole = "Maker";
      });
    } catch { /* skip */ }
  }
  return trades;
}

async function fetchBybitTrades(
  apiKey: string, secret: string, startTime?: number
): Promise<ImportedTrade[]> {
  const now = Date.now();
  const start = startTime ?? now - 90 * 24 * 60 * 60 * 1000;
  const params = `category=linear&limit=200&startTime=${start}`;
  const payload = `${now}${apiKey}5000${params}`;
  const sig = hmac(secret, payload);

  const res = await fetch(`https://api.bybit.com/v5/execution/list?${params}`, {
    headers: {
      "X-BAPI-API-KEY": apiKey,
      "X-BAPI-SIGN": sig,
      "X-BAPI-TIMESTAMP": String(now),
      "X-BAPI-RECV-WINDOW": "5000",
    },
  });
  if (!res.ok) throw new Error(`Bybit: ${res.status} ${await res.text()}`);

  const data = await res.json() as {
    retCode: number;
    result?: {
      list?: {
        symbol: string; orderId: string; side: string; execTime: string;
        execPrice: string; execQty: string; closedPnl: string;
        execType: string; isMaker: string;
      }[];
    };
  };

  if (data.retCode !== 0 || !data.result?.list) return [];

  return data.result.list
    .filter(i => i.execType === "Trade" && parseFloat(i.closedPnl) !== 0)
    .map(i => {
      const ts = parseInt(i.execTime);
      const tsF = admin.firestore.Timestamp.fromMillis(ts);
      return {
        id: i.orderId,
        date: tsF,
        symbol: i.symbol,
        type: (i.side === "Buy" ? "Long" : "Short") as "Long" | "Short",
        entryPrice: parseFloat(i.execPrice),
        quantity: parseFloat(i.execQty),
        leverage: 1,
        exchangeId: "Bybit",
        orderRole: (i.isMaker === "true" ? "Maker" : "Taker") as "Maker" | "Taker",
        systemId: "imported",
        session: getSession(ts),
        flashPnLNet: parseFloat(i.closedPnl),
        notes: `Auto-importé Bybit (orderId: ${i.orderId})`,
        tags: ["bybit", "auto-import"],
        status: "closed" as const,
        source: "bybit" as const,
        externalId: i.orderId,
        closedAt: tsF,
      };
    });
}

// ── OKX ──────────────────────────────────────────────────────────────
async function fetchOKXTrades(
  apiKey: string, secret: string, passphrase: string, startTime?: number
): Promise<ImportedTrade[]> {
  const now = Date.now();
  const start = startTime ?? now - 90 * 24 * 60 * 60 * 1000;
  const path = "/api/v5/trade/fills-history?instType=SWAP";
  const ts = new Date().toISOString();
  const preSign = `${ts}GET${path}`;
  const sig = nodeCrypto.createHmac("sha256", secret).update(preSign).digest("base64");

  const r = await fetch(`https://www.okx.com${path}&after=${start}`, {
    headers: {
      "OK-ACCESS-KEY": apiKey,
      "OK-ACCESS-SIGN": sig,
      "OK-ACCESS-TIMESTAMP": ts,
      "OK-ACCESS-PASSPHRASE": passphrase,
      "x-simulated-trading": "0",
    },
  });
  if (!r.ok) throw new Error(`OKX: ${r.status} ${await r.text()}`);
  const data = await r.json() as { code: string; data?: { instId: string; ordId: string; side: string; fillPx: string; fillSz: string; pnl: string; fillTime: string; execType: string }[] };
  if (data.code !== "0" || !data.data) return [];

  return data.data
    .filter(i => parseFloat(i.pnl) !== 0)
    .map(i => {
      const ts2 = parseInt(i.fillTime);
      const tsF = admin.firestore.Timestamp.fromMillis(ts2);
      return {
        id: i.ordId, date: tsF, symbol: i.instId,
        type: (i.side === "buy" ? "Long" : "Short") as "Long" | "Short",
        entryPrice: parseFloat(i.fillPx), quantity: parseFloat(i.fillSz),
        leverage: 1, exchangeId: "OKX",
        orderRole: (i.execType === "M" ? "Maker" : "Taker") as "Maker" | "Taker",
        systemId: "imported", session: getSession(ts2),
        flashPnLNet: parseFloat(i.pnl),
        notes: `Auto-importé OKX (orderId: ${i.ordId})`,
        tags: ["okx", "auto-import"], status: "closed" as const,
        source: "okx" as const, externalId: i.ordId, closedAt: tsF,
      };
    });
}

// ── KuCoin Futures ────────────────────────────────────────────────────
async function fetchKuCoinTrades(
  apiKey: string, secret: string, passphrase: string, startTime?: number
): Promise<ImportedTrade[]> {
  const now = Date.now();
  const start = startTime ?? now - 90 * 24 * 60 * 60 * 1000;
  const endpoint = "/api/v1/fills";
  const params = `?startAt=${start}&endAt=${now}&pageSize=200`;
  const str = `${now}GET${endpoint}${params}`;
  const sig = nodeCrypto.createHmac("sha256", secret).update(str).digest("base64");
  const pp  = nodeCrypto.createHmac("sha256", secret).update(passphrase).digest("base64");

  const r = await fetch(`https://api-futures.kucoin.com${endpoint}${params}`, {
    headers: {
      "KC-API-KEY": apiKey, "KC-API-SIGN": sig,
      "KC-API-TIMESTAMP": String(now), "KC-API-PASSPHRASE": pp,
      "KC-API-KEY-VERSION": "2",
    },
  });
  if (!r.ok) throw new Error(`KuCoin: ${r.status} ${await r.text()}`);
  const data = await r.json() as { code: string; data?: { items?: { symbol: string; orderId: string; side: string; price: string; size: string; closedPnl: string; createdAt: number; liquidity: string }[] } };
  if (data.code !== "200000" || !data.data?.items) return [];

  return data.data.items
    .filter(i => parseFloat(i.closedPnl) !== 0)
    .map(i => {
      const tsF = admin.firestore.Timestamp.fromMillis(i.createdAt);
      return {
        id: i.orderId, date: tsF, symbol: i.symbol,
        type: (i.side === "buy" ? "Long" : "Short") as "Long" | "Short",
        entryPrice: parseFloat(i.price), quantity: parseFloat(i.size),
        leverage: 1, exchangeId: "KuCoin Futures",
        orderRole: (i.liquidity === "maker" ? "Maker" : "Taker") as "Maker" | "Taker",
        systemId: "imported", session: getSession(i.createdAt),
        flashPnLNet: parseFloat(i.closedPnl),
        notes: `Auto-importé KuCoin Futures (orderId: ${i.orderId})`,
        tags: ["kucoinfutures", "auto-import"], status: "closed" as const,
        source: "kucoinfutures" as const, externalId: i.orderId, closedAt: tsF,
      };
    });
}

// ── Bitget ────────────────────────────────────────────────────────────
async function fetchBitgetTrades(
  apiKey: string, secret: string, passphrase: string, startTime?: number
): Promise<ImportedTrade[]> {
  const now = Date.now();
  const start = startTime ?? now - 90 * 24 * 60 * 60 * 1000;
  const path = "/api/v2/mix/order/fills";
  const params = `?productType=USDT-FUTURES&startTime=${start}&endTime=${now}&pageSize=100`;
  const str = `${now}GET${path}${params}`;
  const sig = nodeCrypto.createHmac("sha256", secret).update(str).digest("base64");

  const r = await fetch(`https://api.bitget.com${path}${params}`, {
    headers: {
      "ACCESS-KEY": apiKey, "ACCESS-SIGN": sig,
      "ACCESS-TIMESTAMP": String(now), "ACCESS-PASSPHRASE": passphrase,
      "Content-Type": "application/json",
    },
  });
  if (!r.ok) throw new Error(`Bitget: ${r.status} ${await r.text()}`);
  const data = await r.json() as { code: string; data?: { fillList?: { symbol: string; orderId: string; side: string; fillPrice: string; baseVolume: string; profit: string; cTime: string; feeDetail?: { feeCoin: string } }[] } };
  if (data.code !== "00000" || !data.data?.fillList) return [];

  return data.data.fillList
    .filter(i => parseFloat(i.profit) !== 0)
    .map(i => {
      const ts2 = parseInt(i.cTime);
      const tsF = admin.firestore.Timestamp.fromMillis(ts2);
      return {
        id: i.orderId, date: tsF, symbol: i.symbol,
        type: (i.side.toLowerCase().includes("buy") ? "Long" : "Short") as "Long" | "Short",
        entryPrice: parseFloat(i.fillPrice), quantity: parseFloat(i.baseVolume),
        leverage: 1, exchangeId: "Bitget",
        orderRole: "Taker" as const,
        systemId: "imported", session: getSession(ts2),
        flashPnLNet: parseFloat(i.profit),
        notes: `Auto-importé Bitget (orderId: ${i.orderId})`,
        tags: ["bitget", "auto-import"], status: "closed" as const,
        source: "bitget" as const, externalId: i.orderId, closedAt: tsF,
      };
    });
}

// ── OANDA (Forex) ─────────────────────────────────────────────────────
// apiKey = Bearer token, apiSecret = accountID
async function fetchOANDATrades(
  bearerToken: string, accountId: string, startTime?: number
): Promise<ImportedTrade[]> {
  const fromDate = startTime
    ? new Date(startTime).toISOString()
    : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const r = await fetch(
    `https://api-fxtrade.oanda.com/v3/accounts/${accountId}/trades?state=CLOSED&count=500&before=${encodeURIComponent(fromDate)}`,
    { headers: { "Authorization": `Bearer ${bearerToken}`, "Content-Type": "application/json" } }
  );
  if (!r.ok) throw new Error(`OANDA: ${r.status} ${await r.text()}`);
  const data = await r.json() as { trades?: { id: string; instrument: string; currentUnits: string; initialUnits: string; price: string; closingTransactionIDs: string[]; unrealizedPL: string; realizedPL: string; closeTime: string; openTime: string }[] };
  if (!data.trades) return [];

  return data.trades
    .filter(t => parseFloat(t.realizedPL) !== 0)
    .map(t => {
      const closeTs = new Date(t.closeTime).getTime();
      const tsF = admin.firestore.Timestamp.fromMillis(closeTs);
      const units = parseFloat(t.initialUnits);
      return {
        id: t.id, date: tsF, symbol: t.instrument,
        type: (units > 0 ? "Long" : "Short") as "Long" | "Short",
        entryPrice: parseFloat(t.price), quantity: Math.abs(units),
        leverage: 1, exchangeId: "OANDA",
        orderRole: "Taker" as const,
        systemId: "imported", session: getSession(closeTs),
        flashPnLNet: parseFloat(t.realizedPL),
        notes: `Auto-importé OANDA (tradeId: ${t.id})`,
        tags: ["oanda", "forex", "auto-import"], status: "closed" as const,
        source: "oanda" as const, externalId: t.id, closedAt: tsF,
      };
    });
}

// ── Alpaca (Stocks) ───────────────────────────────────────────────────
async function fetchAlpacaTrades(
  apiKey: string, apiSecret: string, startTime?: number
): Promise<ImportedTrade[]> {
  const after = startTime
    ? new Date(startTime).toISOString()
    : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const r = await fetch(
    `https://api.alpaca.markets/v2/orders?status=closed&limit=500&after=${encodeURIComponent(after)}&direction=asc`,
    { headers: { "APCA-API-KEY-ID": apiKey, "APCA-API-SECRET-KEY": apiSecret } }
  );
  if (!r.ok) throw new Error(`Alpaca: ${r.status} ${await r.text()}`);
  const orders = await r.json() as { id: string; symbol: string; side: string; filled_at: string; filled_avg_price: string; filled_qty: string; status: string }[];

  return orders
    .filter(o => o.status === "filled" && o.filled_at && o.filled_avg_price)
    .map(o => {
      const closeTs = new Date(o.filled_at).getTime();
      const tsF = admin.firestore.Timestamp.fromMillis(closeTs);
      return {
        id: o.id, date: tsF, symbol: o.symbol,
        type: (o.side === "buy" ? "Long" : "Short") as "Long" | "Short",
        entryPrice: parseFloat(o.filled_avg_price), quantity: parseFloat(o.filled_qty),
        leverage: 1, exchangeId: "Alpaca",
        orderRole: "Taker" as const,
        systemId: "imported", session: getSession(closeTs),
        flashPnLNet: 0, // Alpaca ne donne pas le PnL réalisé dans /orders
        notes: `Auto-importé Alpaca (orderId: ${o.id})`,
        tags: ["alpaca", "stocks", "auto-import"], status: "closed" as const,
        source: "alpaca" as const, externalId: o.id, closedAt: tsF,
      };
    });
}

// ── Gate.io Futures ───────────────────────────────────────────────────
async function fetchGateioTrades(apiKey: string, secret: string, startTime?: number): Promise<ImportedTrade[]> {
  const now = Math.floor(Date.now() / 1000);
  const start = startTime ? Math.floor(startTime / 1000) : now - 90 * 24 * 3600;
  const path = "/api/v4/futures/usdt/my_trades";
  const queryString = `settle=usdt&limit=1000&from=${start}&to=${now}`;
  const bodyHash = nodeCrypto.createHash("sha512").update("").digest("hex");
  const signStr = `GET\n${path}\n${queryString}\n${bodyHash}\n${now}`;
  const sig = nodeCrypto.createHmac("sha512", secret).update(signStr).digest("hex");

  const r = await fetch(`https://api.gateio.ws${path}?${queryString}`, {
    headers: { "KEY": apiKey, "SIGN": sig, "Timestamp": String(now) },
  });
  if (!r.ok) throw new Error(`Gate.io: ${r.status} ${await r.text()}`);
  const data = await r.json() as { id: number; contract: string; size: number; price: string; role: string; close_size: number; pnl: string; create_time: number }[];
  return data
    .filter(i => parseFloat(i.pnl) !== 0)
    .map(i => {
      const tsF = admin.firestore.Timestamp.fromMillis(i.create_time * 1000);
      return {
        id: String(i.id), date: tsF, symbol: i.contract,
        type: (i.size > 0 ? "Long" : "Short") as "Long" | "Short",
        entryPrice: parseFloat(i.price), quantity: Math.abs(i.size),
        leverage: 1, exchangeId: "Gate.io",
        orderRole: (i.role === "maker" ? "Maker" : "Taker") as "Maker" | "Taker",
        systemId: "imported", session: getSession(i.create_time * 1000),
        flashPnLNet: parseFloat(i.pnl),
        notes: `Auto-importé Gate.io (id: ${i.id})`,
        tags: ["gateio", "auto-import"], status: "closed" as const,
        source: "gateio" as const, externalId: String(i.id), closedAt: tsF,
      };
    });
}

// ── MEXC Global Futures ───────────────────────────────────────────────
async function fetchMEXCTrades(apiKey: string, secret: string, startTime?: number): Promise<ImportedTrade[]> {
  const now = Date.now();
  const start = startTime ?? now - 90 * 24 * 60 * 60 * 1000;

  // Use same auth pattern as the working status check:
  // timestamp + signature in query string, ApiKey in header
  const results: ImportedTrade[] = [];

  // ── 1. Closed positions (with realised PnL) ────────────────────────
  try {
    const qs1 = `end_time=${now}&page_num=1&page_size=100&start_time=${start}&timestamp=${now}`;
    const sig1 = hmac(secret, qs1);
    const r1 = await fetch(`https://contract.mexc.com/api/v1/private/position/list/history_positions?${qs1}&signature=${sig1}`, {
      headers: { "ApiKey": apiKey },
    });
    if (r1.ok) {
      interface MEXCPosition {
        positionId: string; symbol: string; positionType: number;
        openAvgPrice: number; closeAvgPrice: number; realised: number;
        vol: number; openTimestamp: number; closeTimestamp: number; leverage: number;
      }
      const d1 = await r1.json() as { code: number; success?: boolean; data?: { resultList?: MEXCPosition[] } };
      const list1 = d1.data?.resultList ?? [];
      for (const i of list1) {
        const closeTs = i.closeTimestamp || i.openTimestamp;
        const tsF = admin.firestore.Timestamp.fromMillis(closeTs);
        results.push({
          id: i.positionId, date: tsF, symbol: i.symbol,
          type: (i.positionType === 1 ? "Long" : "Short") as "Long" | "Short",
          entryPrice: i.openAvgPrice, quantity: i.vol,
          leverage: i.leverage || 1, exchangeId: "MEXC",
          orderRole: "Taker" as const, systemId: "imported",
          session: getSession(closeTs), flashPnLNet: i.realised,
          notes: `Auto-importé MEXC Futures position (id: ${i.positionId})`,
          tags: ["mexc", "auto-import"], status: "closed" as const,
          source: "mexc" as const, externalId: `pos_${i.positionId}`, closedAt: tsF,
        });
      }
    }
  } catch { /* ignore, try order history fallback */ }

  // ── 2. Order history fallback (catches trades missed above) ───────
  try {
    const qs2 = `end_time=${now}&page_size=100&start_time=${start}&timestamp=${now}`;
    const sig2 = hmac(secret, qs2);
    const r2 = await fetch(`https://contract.mexc.com/api/v1/private/order/list/history_orders?${qs2}&signature=${sig2}`, {
      headers: { "ApiKey": apiKey },
    });
    if (r2.ok) {
      interface MEXCOrder {
        id: string; symbol: string; side: number;
        dealAvgPrice: number; dealVolume: number;
        closeProfitLoss: number; createTime: number; orderType: number;
      }
      const d2 = await r2.json() as { code: number; data?: { resultList?: MEXCOrder[] } };
      const list2 = (d2.data?.resultList ?? [])
        .filter(i => [2, 4].includes(i.side)); // side 2=close short, 4=close long
      const existingIds = new Set(results.map(r => r.externalId));
      for (const i of list2) {
        const extId = `ord_${i.id}`;
        if (existingIds.has(extId)) continue;
        const tsF = admin.firestore.Timestamp.fromMillis(i.createTime);
        results.push({
          id: i.id, date: tsF, symbol: i.symbol,
          type: (i.side === 4 ? "Long" : "Short") as "Long" | "Short",
          entryPrice: i.dealAvgPrice, quantity: i.dealVolume,
          leverage: 1, exchangeId: "MEXC",
          orderRole: (i.orderType === 5 ? "Maker" : "Taker") as "Maker" | "Taker",
          systemId: "imported", session: getSession(i.createTime),
          flashPnLNet: i.closeProfitLoss,
          notes: `Auto-importé MEXC Futures order (id: ${i.id})`,
          tags: ["mexc", "auto-import"], status: "closed" as const,
          source: "mexc" as const, externalId: extId, closedAt: tsF,
        });
      }
    }
  } catch { /* ignore */ }

  if (results.length === 0) throw new Error("MEXC: aucune position/ordre trouvé. Vérifiez que la clé API a les permissions Futures.");
  return results;
}

// ── HTX (Huobi) Futures ───────────────────────────────────────────────
async function fetchHTXTrades(apiKey: string, secret: string, startTime?: number): Promise<ImportedTrade[]> {
  const ts = new Date().toISOString().replace(/\.\d+Z$/, "");
  const method = "GET";
  const host = "api.hbdm.com";
  const path = "/linear-swap-api/v1/swap_matchresults";
  const qs = `AccessKeyId=${apiKey}&SignatureMethod=HmacSHA256&SignatureVersion=2&Timestamp=${encodeURIComponent(ts)}`;
  const signStr = `${method}\n${host}\n${path}\n${qs}`;
  const sig = encodeURIComponent(nodeCrypto.createHmac("sha256", secret).update(signStr).digest("base64"));
  const r = await fetch(`https://${host}${path}?${qs}&Signature=${sig}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contract_code: "BTC-USDT", trade_type: 0, start_date: startTime ? new Date(startTime).toISOString().split("T")[0] : undefined }),
  });
  if (!r.ok) throw new Error(`HTX: ${r.status} ${await r.text()}`);
  const data = await r.json() as { status: string; data?: { trades?: { match_id: string; contract_code: string; direction: string; trade_price: number; trade_volume: number; profit: number; create_date: number; role: string }[] } };
  if (data.status !== "ok" || !data.data?.trades) return [];
  return data.data.trades
    .filter(i => i.profit !== 0)
    .map(i => {
      const tsF = admin.firestore.Timestamp.fromMillis(i.create_date);
      return {
        id: String(i.match_id), date: tsF, symbol: i.contract_code,
        type: (i.direction === "buy" ? "Long" : "Short") as "Long" | "Short",
        entryPrice: i.trade_price, quantity: i.trade_volume,
        leverage: 1, exchangeId: "HTX",
        orderRole: (i.role === "maker" ? "Maker" : "Taker") as "Maker" | "Taker",
        systemId: "imported", session: getSession(i.create_date),
        flashPnLNet: i.profit,
        notes: `Auto-importé HTX (matchId: ${i.match_id})`,
        tags: ["htx", "auto-import"], status: "closed" as const,
        source: "htx" as const, externalId: String(i.match_id), closedAt: tsF,
      };
    });
}

// ── Kraken (HMAC-SHA512) ──────────────────────────────────────────────
async function fetchKrakenTrades(apiKey: string, secret: string, startTime?: number): Promise<ImportedTrade[]> {
  const nonce = Date.now() * 1000;
  const start = startTime ? Math.floor(startTime / 1000) : Math.floor((Date.now() - 90 * 24 * 60 * 60 * 1000) / 1000);
  const bodyStr = `nonce=${nonce}&trades=true&start=${start}`;
  const path = "/0/private/TradesHistory";

  const sha256Hash = nodeCrypto.createHash("sha256").update(String(nonce) + bodyStr).digest();
  const pathBytes = Buffer.from(path);
  const secretDecoded = Buffer.from(secret, "base64");
  const message = Buffer.concat([pathBytes, sha256Hash]);
  const sig = nodeCrypto.createHmac("sha512", secretDecoded).update(message).digest("base64");

  const r = await fetch("https://api.kraken.com" + path, {
    method: "POST",
    headers: {
      "API-Key": apiKey,
      "API-Sign": sig,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: bodyStr,
  });
  if (!r.ok) throw new Error(`Kraken: ${r.status} ${await r.text()}`);
  const data = await r.json() as { error: string[]; result?: { trades: Record<string, { pair: string; time: number; type: string; price: string; vol: string; cost: string; fee: string; net?: string; posstatus?: string }> } };
  if (data.error?.length) throw new Error(`Kraken: ${data.error.join(", ")}`);
  if (!data.result?.trades) return [];

  return Object.entries(data.result.trades)
    .filter(([, t]) => t.posstatus === "closed" && t.net !== undefined)
    .map(([txid, t]) => {
      const ts = Math.floor(t.time * 1000);
      const tsF = admin.firestore.Timestamp.fromMillis(ts);
      return {
        id: txid, date: tsF, symbol: t.pair,
        type: (t.type === "buy" ? "Long" : "Short") as "Long" | "Short",
        entryPrice: parseFloat(t.price), quantity: parseFloat(t.vol),
        leverage: 1, exchangeId: "Kraken",
        orderRole: "Taker" as const,
        systemId: "imported", session: getSession(ts),
        flashPnLNet: parseFloat(t.net ?? "0"),
        notes: `Auto-importé Kraken (txid: ${txid})`,
        tags: ["kraken", "auto-import"], status: "closed" as const,
        source: "kraken" as const, externalId: txid, closedAt: tsF,
      };
    });
}

// ── Phemex (HMAC-SHA256) ──────────────────────────────────────────────
async function fetchPhemexTrades(apiKey: string, secret: string, startTime?: number): Promise<ImportedTrade[]> {
  void startTime; // Phemex returns last 200 filled orders, pagination handled by offset
  const expiry = Math.floor(Date.now() / 1000) + 60;
  const path = "/exchange/order/v2/tradingList";
  const query = "currency=USD&limit=200&offset=0";
  const signStr = `${path}${query}${expiry}`;
  const sig = nodeCrypto.createHmac("sha256", secret).update(signStr).digest("hex");

  const r = await fetch(`https://api.phemex.com${path}?${query}`, {
    headers: {
      "x-phemex-access-token": apiKey,
      "x-phemex-request-expiry": String(expiry),
      "x-phemex-request-signature": sig,
    },
  });
  if (!r.ok) throw new Error(`Phemex: ${r.status} ${await r.text()}`);
  const data = await r.json() as { code: number; msg?: string; data?: { rows?: { symbol: string; side: string; execStatus: string; avgPriceEp: number; execQty: number; closedPnlEv: number; transactTimeNs: number }[] } };
  if (data.code !== 0) throw new Error(`Phemex: ${data.msg}`);
  if (!data.data?.rows) return [];

  const EP_SCALE = 1e8; // Phemex uses scaled integers
  const EV_SCALE = 1e8;

  return data.data.rows
    .filter(i => i.execStatus === "FullyFilled" && i.closedPnlEv !== 0)
    .map(i => {
      const ts = Math.floor(i.transactTimeNs / 1_000_000);
      const tsF = admin.firestore.Timestamp.fromMillis(ts);
      return {
        id: `${i.symbol}-${i.transactTimeNs}`, date: tsF, symbol: i.symbol,
        type: (i.side === "Buy" ? "Long" : "Short") as "Long" | "Short",
        entryPrice: i.avgPriceEp / EP_SCALE, quantity: i.execQty,
        leverage: 1, exchangeId: "Phemex",
        orderRole: "Taker" as const,
        systemId: "imported", session: getSession(ts),
        flashPnLNet: i.closedPnlEv / EV_SCALE,
        notes: `Auto-importé Phemex (symbol: ${i.symbol})`,
        tags: ["phemex", "auto-import"], status: "closed" as const,
        source: "phemex" as const, externalId: `${i.symbol}-${i.transactTimeNs}`, closedAt: tsF,
      };
    });
}

// ── Deribit (OAuth + trades) ──────────────────────────────────────────
async function fetchDeribitTrades(clientId: string, clientSecret: string, startTime?: number): Promise<ImportedTrade[]> {
  // Step 1: authenticate
  const authR = await fetch(`https://www.deribit.com/api/v2/public/auth?grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`);
  if (!authR.ok) throw new Error(`Deribit auth: ${authR.status} ${await authR.text()}`);
  const authData = await authR.json() as { result?: { access_token: string } };
  const token = authData.result?.access_token;
  if (!token) throw new Error("Deribit: no access_token in response");

  const since = startTime ?? (Date.now() - 90 * 24 * 60 * 60 * 1000);
  const currencies = ["BTC", "ETH", "SOL"];
  const allTrades: ImportedTrade[] = [];

  for (const currency of currencies) {
    const r = await fetch(
      `https://www.deribit.com/api/v2/private/get_user_trades_by_currency?currency=${currency}&kind=future&count=100&include_old=true`,
      { headers: { "Authorization": `Bearer ${token}` } }
    );
    if (!r.ok) continue;
    const data = await r.json() as { result?: { trades?: { instrument_name: string; direction: string; price: number; amount: number; profit_loss: number; timestamp: number; trade_id: string }[] } };
    if (!data.result?.trades) continue;

    for (const t of data.result.trades) {
      if (t.timestamp < since) continue;
      const tsF = admin.firestore.Timestamp.fromMillis(t.timestamp);
      allTrades.push({
        id: t.trade_id, date: tsF, symbol: t.instrument_name,
        type: (t.direction === "buy" ? "Long" : "Short") as "Long" | "Short",
        entryPrice: t.price, quantity: t.amount,
        leverage: 1, exchangeId: "Deribit",
        orderRole: "Taker" as const,
        systemId: "imported", session: getSession(t.timestamp),
        flashPnLNet: t.profit_loss,
        notes: `Auto-importé Deribit (tradeId: ${t.trade_id})`,
        tags: ["deribit", "auto-import"], status: "closed" as const,
        source: "deribit" as const, externalId: t.trade_id, closedAt: tsF,
      });
    }
  }
  return allTrades;
}

// ── IG Group (session-based) ──────────────────────────────────────────
async function fetchIGTrades(apiKey: string, password: string, username: string, startTime?: number): Promise<ImportedTrade[]> {
  // Step 1: create session
  const sessionR = await fetch("https://api.ig.com/gateway/deal/session", {
    method: "POST",
    headers: { "X-IG-API-KEY": apiKey, "Content-Type": "application/json", "Version": "2" },
    body: JSON.stringify({ identifier: username, password }),
  });
  if (!sessionR.ok) throw new Error(`IG session: ${sessionR.status} ${await sessionR.text()}`);
  const cst = sessionR.headers.get("CST");
  const secToken = sessionR.headers.get("X-SECURITY-TOKEN");
  if (!cst || !secToken) throw new Error("IG: missing session tokens");

  // Step 2: fetch transactions
  const from = startTime
    ? new Date(startTime).toISOString()
    : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date().toISOString();

  const r = await fetch(
    `https://api.ig.com/gateway/deal/history/transactions?type=TRADE&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&pageSize=500&maxSpanSeconds=31536000`,
    { headers: { "X-IG-API-KEY": apiKey, "CST": cst, "X-SECURITY-TOKEN": secToken, "Version": "2" } }
  );
  if (!r.ok) throw new Error(`IG trades: ${r.status} ${await r.text()}`);
  const data = await r.json() as { transactions?: { instrumentName: string; date: string; openLevel: string; closeLevel: string; size: string; profitAndLoss: string; transactionType: string }[] };
  if (!data.transactions) return [];

  return data.transactions
    .filter(t => t.transactionType === "TRADE")
    .map(t => {
      const ts = new Date(t.date).getTime();
      const tsF = admin.firestore.Timestamp.fromMillis(ts);
      const pnl = parseFloat(t.profitAndLoss.replace(/[^-0-9.]/g, ""));
      const entry = parseFloat(t.openLevel);
      const exit = parseFloat(t.closeLevel);
      const size = parseFloat(t.size.replace(/[^-0-9.]/g, ""));
      return {
        id: `ig-${t.instrumentName}-${ts}`, date: tsF, symbol: t.instrumentName,
        type: (size >= 0 ? "Long" : "Short") as "Long" | "Short",
        entryPrice: entry, exitPrice: exit, quantity: Math.abs(size),
        leverage: 1, exchangeId: "IG Group",
        orderRole: "Taker" as const,
        systemId: "imported", session: getSession(ts),
        flashPnLNet: pnl,
        notes: `Auto-importé IG Group (${t.instrumentName})`,
        tags: ["ig", "forex", "auto-import"], status: "closed" as const,
        source: "ig" as const, externalId: `ig-${t.instrumentName}-${ts}`, closedAt: tsF,
      };
    });
}

// ── Capital.com (session-based) ────────────────────────────────────────
async function fetchCapitalTrades(apiKey: string, password: string, email: string, startTime?: number): Promise<ImportedTrade[]> {
  // Step 1: create session
  const sessionR = await fetch("https://api-capital.backend.gbg.com/api/v1/session", {
    method: "POST",
    headers: { "X-CAP-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: email, encryptedPassword: false, password }),
  });
  if (!sessionR.ok) throw new Error(`Capital.com session: ${sessionR.status} ${await sessionR.text()}`);
  const cst = sessionR.headers.get("CST");
  const secToken = sessionR.headers.get("X-SECURITY-TOKEN");
  if (!cst || !secToken) throw new Error("Capital.com: missing session tokens");

  // Step 2: fetch transactions
  const from = startTime
    ? new Date(startTime).toISOString()
    : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date().toISOString();

  const r = await fetch(
    `https://api-capital.backend.gbg.com/api/v1/history/transactions?type=TRADE&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&lastPeriod=86400`,
    { headers: { "X-CAP-API-KEY": apiKey, "CST": cst, "X-SECURITY-TOKEN": secToken } }
  );
  if (!r.ok) throw new Error(`Capital.com trades: ${r.status} ${await r.text()}`);
  const data = await r.json() as { transactions?: { instrumentName: string; date: string; openLevel: string; closeLevel: string; size: string; profitAndLoss: string }[] };
  if (!data.transactions) return [];

  return data.transactions.map(t => {
    const ts = new Date(t.date).getTime();
    const tsF = admin.firestore.Timestamp.fromMillis(ts);
    const pnl = parseFloat(String(t.profitAndLoss).replace(/[^-0-9.]/g, ""));
    const size = parseFloat(String(t.size).replace(/[^-0-9.]/g, ""));
    return {
      id: `capitalcom-${t.instrumentName}-${ts}`, date: tsF, symbol: t.instrumentName,
      type: (size >= 0 ? "Long" : "Short") as "Long" | "Short",
      entryPrice: parseFloat(t.openLevel), exitPrice: parseFloat(t.closeLevel), quantity: Math.abs(size),
      leverage: 1, exchangeId: "Capital.com",
      orderRole: "Taker" as const,
      systemId: "imported", session: getSession(ts),
      flashPnLNet: pnl,
      notes: `Auto-importé Capital.com (${t.instrumentName})`,
      tags: ["capitalcom", "forex", "auto-import"], status: "closed" as const,
      source: "capitalcom" as const, externalId: `capitalcom-${t.instrumentName}-${ts}`, closedAt: tsF,
    };
  });
}

// ── Tastytrade (session-based) ─────────────────────────────────────────
async function fetchTastytradeTrades(login: string, password: string, startTime?: number): Promise<ImportedTrade[]> {
  // Step 1: authenticate
  const sessionR = await fetch("https://api.tastytrade.com/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, password, "remember-me": true }),
  });
  if (!sessionR.ok) throw new Error(`Tastytrade auth: ${sessionR.status} ${await sessionR.text()}`);
  const sessionData = await sessionR.json() as { data?: { "session-token": string; accounts: { "account-number": string }[] } };
  const token = sessionData.data?.["session-token"];
  const accounts = sessionData.data?.accounts ?? [];
  if (!token) throw new Error("Tastytrade: no session-token");

  const since = startTime ? new Date(startTime).toISOString() : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const allTrades: ImportedTrade[] = [];

  for (const acc of accounts) {
    const acctNum = acc["account-number"];
    const r = await fetch(
      `https://api.tastytrade.com/accounts/${acctNum}/transactions?type=Trade&per-page=250`,
      { headers: { "Authorization": token } }
    );
    if (!r.ok) continue;
    const data = await r.json() as { data?: { items?: { id: string; symbol: string; "transaction-type": string; action: string; quantity: string; price: string; "net-value": string; "executed-at": string }[] } };
    if (!data.data?.items) continue;

    for (const t of data.data.items) {
      if (t["executed-at"] < since) continue;
      const ts = new Date(t["executed-at"]).getTime();
      const tsF = admin.firestore.Timestamp.fromMillis(ts);
      allTrades.push({
        id: String(t.id), date: tsF, symbol: t.symbol,
        type: (t.action.toLowerCase().includes("buy") ? "Long" : "Short") as "Long" | "Short",
        entryPrice: parseFloat(t.price), quantity: parseFloat(t.quantity),
        leverage: 1, exchangeId: "Tastytrade",
        orderRole: "Taker" as const,
        systemId: "imported", session: getSession(ts),
        flashPnLNet: parseFloat(t["net-value"]),
        notes: `Auto-importé Tastytrade (id: ${t.id}, compte: ${acctNum})`,
        tags: ["tastytrade", "stocks", "auto-import"], status: "closed" as const,
        source: "tastytrade" as const, externalId: String(t.id), closedAt: tsF,
      });
    }
  }
  return allTrades;
}

// ── Trading 212 (API key simple) ──────────────────────────────────────
async function fetchTrading212Trades(apiKey: string, startTime?: number): Promise<ImportedTrade[]> {
  void startTime;
  const r = await fetch("https://live.trading212.com/api/v0/equity/history/orders?limit=50", {
    headers: { "Authorization": apiKey },
  });
  if (!r.ok) throw new Error(`Trading 212: ${r.status} ${await r.text()}`);
  const orders = await r.json() as { id: string; ticker: string; type: string; filledQuantity: number; fillPrice: number; filledValue: number; dateExecuted: string }[];
  if (!Array.isArray(orders)) return [];

  return orders
    .filter(o => o.filledQuantity > 0 && o.dateExecuted)
    .map(o => {
      const ts = new Date(o.dateExecuted).getTime();
      const tsF = admin.firestore.Timestamp.fromMillis(ts);
      return {
        id: String(o.id), date: tsF, symbol: o.ticker,
        type: (o.type === "BUY" ? "Long" : "Short") as "Long" | "Short",
        entryPrice: o.fillPrice, quantity: o.filledQuantity,
        leverage: 1, exchangeId: "Trading 212",
        orderRole: "Taker" as const,
        systemId: "imported", session: getSession(ts),
        flashPnLNet: 0, // Trading 212 doesn't expose realized PnL directly
        notes: `Auto-importé Trading 212 (id: ${o.id})`,
        tags: ["trading212", "stocks", "auto-import"], status: "closed" as const,
        source: "trading212" as const, externalId: String(o.id), closedAt: tsF,
      };
    });
}

// ── saveExchangeAPIKey ────────────────────────────────────────────────
export const saveExchangeAPIKey = onCall(
  {region: "europe-west1"},
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Auth requise");
    const {exchange, apiKey, apiSecret, passphrase} = request.data as {
      exchange: Exchange; apiKey: string; apiSecret: string; passphrase?: string
    };
    const validExchanges: Exchange[] = ["binance", "bybit", "okx", "kucoinfutures", "bitget", "gateio", "mexc", "htx", "kraken", "phemex", "deribit", "ig", "capitalcom", "tastytrade", "trading212", "oanda", "alpaca"];
    if (!validExchanges.includes(exchange) || !apiKey) {
      throw new HttpsError("invalid-argument", "Paramètres invalides");
    }
    // trading212 doesn't need a real secret
    if (exchange !== "trading212" && !apiSecret) {
      throw new HttpsError("invalid-argument", "Paramètres invalides");
    }

    // Validation live de la clé
    let valid = false;
    let errorMsg = "";
    try {
      if (exchange === "binance") {
        const qs = `timestamp=${Date.now()}`;
        const sig = hmac(apiSecret, qs);
        const r = await fetch(`https://fapi.binance.com/fapi/v1/account?${qs}&signature=${sig}`, {
          headers: {"X-MBX-APIKEY": apiKey},
        });
        valid = r.ok;
        if (!valid) errorMsg = `Binance: ${r.status}`;
      } else if (exchange === "bybit") {
        const ts = Date.now();
        const sig = hmac(apiSecret, `${ts}${apiKey}5000`);
        const r = await fetch("https://api.bybit.com/v5/account/wallet-balance?accountType=UNIFIED", {
          headers: { "X-BAPI-API-KEY": apiKey, "X-BAPI-SIGN": sig, "X-BAPI-TIMESTAMP": String(ts), "X-BAPI-RECV-WINDOW": "5000" },
        });
        valid = r.ok;
        if (!valid) errorMsg = `Bybit: ${r.status}`;
      } else if (exchange === "okx") {
        const ts = new Date().toISOString();
        const sig = nodeCrypto.createHmac("sha256", apiSecret).update(`${ts}GET/api/v5/account/balance`).digest("base64");
        const r = await fetch("https://www.okx.com/api/v5/account/balance", {
          headers: { "OK-ACCESS-KEY": apiKey, "OK-ACCESS-SIGN": sig, "OK-ACCESS-TIMESTAMP": ts, "OK-ACCESS-PASSPHRASE": passphrase ?? "" },
        });
        valid = r.ok;
        if (!valid) errorMsg = `OKX: ${r.status}`;
      } else if (exchange === "kucoinfutures") {
        const ts = Date.now();
        const str = `${ts}GET/api/v1/account-overview?currency=USDT`;
        const sig = nodeCrypto.createHmac("sha256", apiSecret).update(str).digest("base64");
        const pp  = nodeCrypto.createHmac("sha256", apiSecret).update(passphrase ?? "").digest("base64");
        const r = await fetch("https://api-futures.kucoin.com/api/v1/account-overview?currency=USDT", {
          headers: { "KC-API-KEY": apiKey, "KC-API-SIGN": sig, "KC-API-TIMESTAMP": String(ts), "KC-API-PASSPHRASE": pp, "KC-API-KEY-VERSION": "2" },
        });
        valid = r.ok;
        if (!valid) errorMsg = `KuCoin: ${r.status}`;
      } else if (exchange === "bitget") {
        const ts = Date.now();
        const sig = nodeCrypto.createHmac("sha256", apiSecret).update(`${ts}GET/api/v2/account/info`).digest("base64");
        const r = await fetch("https://api.bitget.com/api/v2/account/info", {
          headers: { "ACCESS-KEY": apiKey, "ACCESS-SIGN": sig, "ACCESS-TIMESTAMP": String(ts), "ACCESS-PASSPHRASE": passphrase ?? "" },
        });
        valid = r.ok;
        if (!valid) errorMsg = `Bitget: ${r.status}`;
      } else if (exchange === "gateio") {
        const ts2 = Math.floor(Date.now() / 1000);
        const bh = nodeCrypto.createHash("sha512").update("").digest("hex");
        const signStr = `GET\n/api/v4/futures/usdt/accounts\n\n${bh}\n${ts2}`;
        const sig2 = nodeCrypto.createHmac("sha512", apiSecret).update(signStr).digest("hex");
        const r = await fetch("https://api.gateio.ws/api/v4/futures/usdt/accounts", {
          headers: { "KEY": apiKey, "SIGN": sig2, "Timestamp": String(ts2) },
        });
        valid = r.ok;
        if (!valid) errorMsg = `Gate.io: ${r.status}`;
      } else if (exchange === "mexc") {
        const ts2 = Date.now();
        const qs2 = `timestamp=${ts2}`;
        const sig2 = hmac(apiSecret, qs2);
        const r = await fetch(`https://contract.mexc.com/api/v1/private/account/assets?${qs2}&signature=${sig2}`, {
          headers: { "ApiKey": apiKey },
        });
        valid = r.ok;
        if (!valid) errorMsg = `MEXC: ${r.status}`;
      } else if (exchange === "htx") {
        const ts2 = new Date().toISOString().replace(/\.\d+Z$/, "");
        const qs2 = `AccessKeyId=${apiKey}&SignatureMethod=HmacSHA256&SignatureVersion=2&Timestamp=${encodeURIComponent(ts2)}`;
        const signStr2 = `GET\napi.hbdm.com\n/linear-swap-api/v1/swap_account_info\n${qs2}`;
        const sig2 = encodeURIComponent(nodeCrypto.createHmac("sha256", apiSecret).update(signStr2).digest("base64"));
        const r = await fetch(`https://api.hbdm.com/linear-swap-api/v1/swap_account_info?${qs2}&Signature=${sig2}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
        });
        valid = r.ok;
        if (!valid) errorMsg = `HTX: ${r.status}`;
      } else if (exchange === "oanda") {
        const r = await fetch(`https://api-fxtrade.oanda.com/v3/accounts/${apiSecret}`, {
          headers: { "Authorization": `Bearer ${apiKey}` },
        });
        valid = r.ok;
        if (!valid) errorMsg = `OANDA: ${r.status}`;
      } else if (exchange === "alpaca") {
        const r = await fetch("https://api.alpaca.markets/v2/account", {
          headers: { "APCA-API-KEY-ID": apiKey, "APCA-API-SECRET-KEY": apiSecret },
        });
        valid = r.ok;
        if (!valid) errorMsg = `Alpaca: ${r.status}`;
      } else if (exchange === "kraken") {
        // Test: fetch balance using HMAC-SHA512
        const nonce2 = Date.now() * 1000;
        const bodyStr2 = `nonce=${nonce2}`;
        const pathK = "/0/private/Balance";
        const sha256K = nodeCrypto.createHash("sha256").update(String(nonce2) + bodyStr2).digest();
        const secretDecK = Buffer.from(apiSecret, "base64");
        const msgK = Buffer.concat([Buffer.from(pathK), sha256K]);
        const sigK = nodeCrypto.createHmac("sha512", secretDecK).update(msgK).digest("base64");
        const rK = await fetch("https://api.kraken.com" + pathK, {
          method: "POST",
          headers: { "API-Key": apiKey, "API-Sign": sigK, "Content-Type": "application/x-www-form-urlencoded" },
          body: bodyStr2,
        });
        const dK = await rK.json() as { error?: string[] };
        valid = rK.ok && (!dK.error || dK.error.length === 0);
        if (!valid) errorMsg = `Kraken: ${dK.error?.join(", ") || rK.status}`;
      } else if (exchange === "phemex") {
        const expiryP = Math.floor(Date.now() / 1000) + 60;
        const pathP = "/accounts/accountPositions";
        const queryP = "currency=USD";
        const signStrP = `${pathP}${queryP}${expiryP}`;
        const sigP = nodeCrypto.createHmac("sha256", apiSecret).update(signStrP).digest("hex");
        const rP = await fetch(`https://api.phemex.com${pathP}?${queryP}`, {
          headers: { "x-phemex-access-token": apiKey, "x-phemex-request-expiry": String(expiryP), "x-phemex-request-signature": sigP },
        });
        const dP = await rP.json() as { code?: number };
        valid = rP.ok && dP.code === 0;
        if (!valid) errorMsg = `Phemex: ${dP.code || rP.status}`;
      } else if (exchange === "deribit") {
        const authRD = await fetch(`https://www.deribit.com/api/v2/public/auth?grant_type=client_credentials&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(apiSecret)}`);
        const dD = await authRD.json() as { result?: { access_token: string }; error?: { message: string } };
        valid = authRD.ok && !!dD.result?.access_token;
        if (!valid) errorMsg = `Deribit: ${dD.error?.message || authRD.status}`;
      } else if (exchange === "ig") {
        const sessionRI = await fetch("https://api.ig.com/gateway/deal/session", {
          method: "POST",
          headers: { "X-IG-API-KEY": apiKey, "Content-Type": "application/json", "Version": "2" },
          body: JSON.stringify({ identifier: passphrase ?? "", password: apiSecret }),
        });
        valid = sessionRI.ok;
        if (!valid) errorMsg = `IG Group: ${sessionRI.status}`;
      } else if (exchange === "capitalcom") {
        const sessionRC = await fetch("https://api-capital.backend.gbg.com/api/v1/session", {
          method: "POST",
          headers: { "X-CAP-API-KEY": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ identifier: passphrase ?? "", encryptedPassword: false, password: apiSecret }),
        });
        valid = sessionRC.ok;
        if (!valid) errorMsg = `Capital.com: ${sessionRC.status}`;
      } else if (exchange === "tastytrade") {
        const sessionRT = await fetch("https://api.tastytrade.com/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ login: apiKey, password: apiSecret, "remember-me": false }),
        });
        const dT = await sessionRT.json() as { data?: { "session-token": string } };
        valid = sessionRT.ok && !!dT.data?.["session-token"];
        if (!valid) errorMsg = `Tastytrade: ${sessionRT.status}`;
      } else if (exchange === "trading212") {
        const rT2 = await fetch("https://live.trading212.com/api/v0/equity/portfolio", {
          headers: { "Authorization": apiKey },
        });
        valid = rT2.ok;
        if (!valid) errorMsg = `Trading 212: ${rT2.status}`;
      }
    } catch (e: unknown) { errorMsg = (e as Error).message; }

    if (!valid) throw new HttpsError("invalid-argument", errorMsg || "Clé API invalide");

    const db2 = getFirestore();
    await db2.collection("users").doc(request.auth.uid)
      .collection("apiKeys").doc(exchange)
      .set({
        apiKey, apiSecret, exchange,
        ...(passphrase ? {passphrase} : {}),
        createdAt: FieldValue.serverTimestamp(), importedCount: 0,
      }, {merge: true});

    return {success: true, message: `Clé ${exchange} validée et sauvegardée`};
  }
);

// ── getExchangeKeyStatus ──────────────────────────────────────────────
export const getExchangeKeyStatus = onCall(
  {region: "europe-west1"},
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Auth requise");
    const {exchange} = request.data as {exchange: Exchange};
    const db2 = getFirestore();
    const snap = await db2.collection("users").doc(request.auth.uid)
      .collection("apiKeys").doc(exchange).get();
    if (!snap.exists) return {connected: false};
    const d = snap.data()!;
    return {
      connected: true,
      exchange,
      apiKeyMasked: `${(d.apiKey as string).slice(0, 6)}••••${(d.apiKey as string).slice(-4)}`,
      lastSync: d.lastSync ? (d.lastSync as FirebaseFirestore.Timestamp).toMillis() : null,
      importedCount: d.importedCount ?? 0,
    };
  }
);

// ── deleteExchangeAPIKey ──────────────────────────────────────────────
export const deleteExchangeAPIKey = onCall(
  {region: "europe-west1"},
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Auth requise");
    const {exchange} = request.data as {exchange: Exchange};
    const db2 = getFirestore();
    await db2.collection("users").doc(request.auth.uid)
      .collection("apiKeys").doc(exchange).delete();
    return {success: true};
  }
);

// ── syncExchangeTrades ────────────────────────────────────────────────
export const syncExchangeTrades = onCall(
  {region: "europe-west1", timeoutSeconds: 120},
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Auth requise");
    const uid = request.auth.uid;
    const {exchange, startTime: reqStart} = request.data as {exchange: Exchange; startTime?: number};

    const validExchanges: Exchange[] = ["binance", "bybit", "okx", "kucoinfutures", "bitget", "gateio", "mexc", "htx", "kraken", "phemex", "deribit", "ig", "capitalcom", "tastytrade", "trading212", "oanda", "alpaca"];
    if (!validExchanges.includes(exchange)) {
      throw new HttpsError("invalid-argument", "Exchange non supporté");
    }

    const db2 = getFirestore();
    const keyRef = db2.collection("users").doc(uid).collection("apiKeys").doc(exchange);
    const keySnap = await keyRef.get();
    if (!keySnap.exists) throw new HttpsError("not-found", `Aucune clé pour ${exchange}`);

    const keyData = keySnap.data() as APIKeyDoc & { passphrase?: string };
    const {apiKey, apiSecret, lastSync} = keyData;
    const passphrase = keyData.passphrase ?? "";
    if (!apiKey || !apiSecret) throw new HttpsError("failed-precondition", "Clés incomplètes");

    // Safety overlap: go back 2h before lastSync to catch trades that closed
    // just before the previous sync window ended (avoids timing edge cases).
    // forceFull=true resets to 90 days regardless of lastSync.
    const {forceFull} = request.data as {exchange: Exchange; startTime?: number; forceFull?: boolean};
    const startTime = reqStart ?? (
      (!forceFull && lastSync)
        ? Math.max(0, lastSync.toMillis() - 2 * 3600_000)  // lastSync - 2h
        : undefined  // → defaults to now-90d in fetch functions
    );

    let importedTrades: ImportedTrade[] = [];
    try {
      if (exchange === "binance") importedTrades = await fetchBinanceTrades(apiKey, apiSecret, startTime);
      else if (exchange === "bybit") importedTrades = await fetchBybitTrades(apiKey, apiSecret, startTime);
      else if (exchange === "okx") importedTrades = await fetchOKXTrades(apiKey, apiSecret, passphrase, startTime);
      else if (exchange === "kucoinfutures") importedTrades = await fetchKuCoinTrades(apiKey, apiSecret, passphrase, startTime);
      else if (exchange === "bitget") importedTrades = await fetchBitgetTrades(apiKey, apiSecret, passphrase, startTime);
      else if (exchange === "gateio") importedTrades = await fetchGateioTrades(apiKey, apiSecret, startTime);
      else if (exchange === "mexc") importedTrades = await fetchMEXCTrades(apiKey, apiSecret, startTime);
      else if (exchange === "htx") importedTrades = await fetchHTXTrades(apiKey, apiSecret, startTime);
      else if (exchange === "oanda") importedTrades = await fetchOANDATrades(apiKey, apiSecret, startTime);
      else if (exchange === "alpaca") importedTrades = await fetchAlpacaTrades(apiKey, apiSecret, startTime);
      else if (exchange === "kraken") importedTrades = await fetchKrakenTrades(apiKey, apiSecret, startTime);
      else if (exchange === "phemex") importedTrades = await fetchPhemexTrades(apiKey, apiSecret, startTime);
      else if (exchange === "deribit") importedTrades = await fetchDeribitTrades(apiKey, apiSecret, startTime);
      else if (exchange === "ig") importedTrades = await fetchIGTrades(apiKey, apiSecret, passphrase, startTime);
      else if (exchange === "capitalcom") importedTrades = await fetchCapitalTrades(apiKey, apiSecret, passphrase, startTime);
      else if (exchange === "tastytrade") importedTrades = await fetchTastytradeTrades(apiKey, apiSecret, startTime);
      else if (exchange === "trading212") importedTrades = await fetchTrading212Trades(apiKey, startTime);
    } catch (e: unknown) {
      throw new HttpsError("internal", `Erreur exchange: ${(e as Error).message}`);
    }

    if (importedTrades.length === 0) {
      await keyRef.update({lastSync: FieldValue.serverTimestamp()});
      return {imported: 0, skipped: 0, message: "Aucun nouveau trade à importer"};
    }

    // Déduplication — batch les IDs par chunks de 30 (limite Firestore "in")
    const tradesCol = db2.collection("users").doc(uid).collection("trades");
    const allIds = importedTrades.map(t => t.externalId);
    const existingIds = new Set<string>();
    for (let i = 0; i < allIds.length; i += 30) {
      const chunk = allIds.slice(i, i + 30);
      const snap = await tradesCol
        .where("externalId", "in", chunk)
        .get();
      snap.docs.forEach(d => existingIds.add(d.data().externalId as string));
    }

    const newTrades = importedTrades.filter(t => !existingIds.has(t.externalId));
    let written = 0;
    for (let i = 0; i < newTrades.length; i += 400) {
      const batch = db2.batch();
      for (const trade of newTrades.slice(i, i + 400)) {
        const ref = tradesCol.doc();
        batch.set(ref, {...trade, id: ref.id});
        written++;
      }
      await batch.commit();
    }

    const prevCount = (keySnap.data()?.importedCount ?? 0) as number;
    await keyRef.update({lastSync: FieldValue.serverTimestamp(), importedCount: prevCount + written});

    return {
      imported: written,
      skipped: importedTrades.length - written,
      message: `${written} trade(s) importé(s), ${importedTrades.length - written} déjà présent(s)`,
    };
  }
);

// ══════════════════════════════════════════════════════════════════════
// fetchYahooFinanceData — News + Fondamentaux + Dividendes côté serveur
// (Evite les limitations CORS côté client)
// ══════════════════════════════════════════════════════════════════════
export const fetchYahooFinanceData = onCall(
  { secrets: [finnhubKey], region: "europe-west1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Auth requise.");

    const { symbol, isCrypto } = request.data as { symbol: string; isCrypto: boolean };
    if (!symbol || typeof symbol !== "string") throw new HttpsError("invalid-argument", "symbol requis");

    const sym = symbol.toUpperCase();

    // ── News via Finnhub (stocks) ou Yahoo RSS (crypto) ─────────────────
    interface NewsItem { title: string; url: string; date: string; source?: string; image?: string }
    let news: NewsItem[] = [];
    try {
      if (!isCrypto) {
        // Finnhub company news
        const today = new Date();
        const from = new Date(today.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
        const to = today.toISOString().slice(0, 10);
        const nhRes = await fetch(
          `https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${from}&to=${to}&token=${finnhubKey.value()}`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (nhRes.ok) {
          const nhData = await nhRes.json() as { headline: string; url: string; datetime: number; source: string; image: string }[];
          news = nhData.slice(0, 8).map(n => ({
            title: n.headline,
            url: n.url,
            date: new Date(n.datetime * 1000).toLocaleDateString("fr-FR", { day:"2-digit", month:"short" }),
            source: n.source,
            image: n.image || undefined,
          }));
        }
      } else {
        // Yahoo Finance RSS pour crypto
        const rssUrl = `https://finance.yahoo.com/rss/headline?s=${sym}-USD`;
        const rssRes = await fetch(rssUrl, { signal: AbortSignal.timeout(8000) });
        if (rssRes.ok) {
          const raw = await rssRes.text();
          const blocks = raw.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
          for (const block of blocks.slice(0, 6)) {
            const titleM = block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ?? block.match(/<title>(.*?)<\/title>/);
            const linkM  = block.match(/<link>(.*?)<\/link>/) ?? block.match(/<guid>(https?:\/\/[^<]+)<\/guid>/);
            const dateM  = block.match(/<pubDate>(.*?)<\/pubDate>/);
            const title = titleM?.[1]?.trim();
            const url   = linkM?.[1]?.trim();
            const date  = dateM?.[1]?.trim();
            if (title && url) {
              const d = date ? new Date(date).toLocaleDateString("fr-FR", { day:"2-digit", month:"short" }) : "";
              news.push({ title, url, date: d });
            }
          }
        }
      }
    } catch { /* news vide */ }

    // ── Fondamentaux + Dividendes via Yahoo Finance v8+v10 ──────────────
    interface DivEntry { date: string; amount: number }
    interface Fundamentals {
      companyName: string; marketCap: number | null; peRatio: number | null;
      eps: number | null; beta: number | null; volume: number | null;
      week52High: number | null; week52Low: number | null;
      dividendYield: number | null; dividendAnnual: number | null;
      exDividendDate: string | null; payDate: string | null;
      earningsDate: string | null; epsEstimate: number | null;
      dividendHistory: DivEntry[];
    }
    let fundamentals: Fundamentals | null = null;

    if (!isCrypto) {
      try {
        // v8 chart → dividends history + 52w high/low
        const chartRes = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=2y&interval=1d&events=div%2CearningsDate&includePrePost=false`,
          { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10000) }
        );
        const chartJson = chartRes.ok ? await chartRes.json() as Record<string, unknown> : null;
        const result = (chartJson?.chart as { result?: Record<string, unknown>[] })?.result?.[0];
        const meta = (result?.meta ?? {}) as {
          longName?: string; shortName?: string; regularMarketVolume?: number;
          fiftyTwoWeekHigh?: number; fiftyTwoWeekLow?: number; marketCap?: number;
          trailingPE?: number; trailingAnnualDividendRate?: number;
          trailingAnnualDividendYield?: number;
        };

        // Parse dividends
        type DivEvent = { amount: number; date: number };
        const divEvents = (result?.events as Record<string, Record<string, DivEvent>> | undefined)?.dividends;
        const oneYearAgo = Date.now() / 1000 - 365 * 86400;
        const twoYearsAgo = Date.now() / 1000 - 730 * 86400;
        let dividendAnnual: number | null = null;
        let exDividendDate: string | null = null;
        const dividendHistory: DivEntry[] = [];

        if (divEvents) {
          const allDivs = Object.values(divEvents).sort((a, b) => b.date - a.date);
          // Last 2 years history
          allDivs.filter(d => d.date > twoYearsAgo).forEach(d => {
            dividendHistory.push({
              date: new Date(d.date * 1000).toLocaleDateString("fr-FR", { day:"2-digit", month:"short", year:"2-digit" }),
              amount: d.amount,
            });
          });
          // Annual sum from last 12 months
          const recent = allDivs.filter(d => d.date > oneYearAgo);
          if (recent.length > 0) {
            dividendAnnual = recent.reduce((s, d) => s + d.amount, 0);
            exDividendDate = new Date(recent[0].date * 1000).toLocaleDateString("fr-FR", { day:"2-digit", month:"short", year:"numeric" });
          }
        }

        // v10 quoteSummary → EPS, beta, earnings, payDate
        let eps: number | null = null, beta: number | null = null;
        let earningsDate: string | null = null, epsEstimate: number | null = null;
        let payDate: string | null = null;

        try {
          const qsRes = await fetch(
            `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${sym}?modules=defaultKeyStatistics%2CcalendarEvents%2CsummaryDetail`,
            { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) }
          );
          if (qsRes.ok) {
            const qsJson = await qsRes.json() as Record<string, unknown>;
            const qs = (qsJson?.quoteSummary as { result?: Record<string, unknown>[] })?.result?.[0];
            const ks = qs?.defaultKeyStatistics as Record<string, { raw?: number }> | undefined;
            const ce = qs?.calendarEvents as { earnings?: { earningsDate?: {raw:number}[]; epsAverage?: {raw?:number} }; exDividendDate?: {raw?:number}; dividendDate?: {raw?:number} } | undefined;

            eps = ks?.trailingEps?.raw ?? null;
            beta = ks?.beta?.raw ?? null;

            if (ce?.earnings?.earningsDate?.[0]?.raw) {
              earningsDate = new Date(ce.earnings.earningsDate[0].raw * 1000).toLocaleDateString("fr-FR", { day:"2-digit", month:"short", year:"numeric" });
              epsEstimate = ce.earnings.epsAverage?.raw ?? null;
            }
            if (ce?.dividendDate?.raw) {
              payDate = new Date(ce.dividendDate.raw * 1000).toLocaleDateString("fr-FR", { day:"2-digit", month:"short", year:"numeric" });
            }
          }
        } catch { /* ignore v10 errors */ }

        const price = (meta as { regularMarketPrice?: number }).regularMarketPrice ?? 1;
        const divYield = dividendAnnual != null && price > 0
          ? (dividendAnnual / price) * 100
          : meta.trailingAnnualDividendYield != null ? meta.trailingAnnualDividendYield * 100 : null;

        fundamentals = {
          companyName: meta.longName ?? meta.shortName ?? sym,
          marketCap: meta.marketCap ?? null,
          peRatio: meta.trailingPE ?? null,
          eps, beta,
          volume: meta.regularMarketVolume ?? null,
          week52High: meta.fiftyTwoWeekHigh ?? null,
          week52Low: meta.fiftyTwoWeekLow ?? null,
          dividendYield: divYield,
          dividendAnnual,
          exDividendDate,
          payDate,
          earningsDate,
          epsEstimate,
          dividendHistory,
        };
      } catch { /* fundamentals null */ }
    }

    return { news, fundamentals };
  }
);

// ══════════════════════════════════════════════════════════════════════
// fetchMarketCalendar — Earnings + Macro + Géopolitique
// ══════════════════════════════════════════════════════════════════════
export const fetchMarketCalendar = onCall(
  { secrets: [finnhubKey], region: "europe-west1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Auth requise.");

    const key = finnhubKey.value();
    const today = new Date();
    const from = today.toISOString().slice(0, 10);
    const to = new Date(today.getTime() + 14 * 86_400_000).toISOString().slice(0, 10);

    // ── Earnings (14 prochains jours) ──────────────────────────────────
    interface EarningsRaw {
      symbol: string; date: string; hour: string;
      epsEstimate?: number | null; revenueEstimate?: number | null;
    }
    let earnings: EarningsRaw[] = [];
    try {
      const r = await fetch(
        `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${key}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (r.ok) {
        const d = await r.json() as { earningsCalendar?: EarningsRaw[] };
        earnings = (d.earningsCalendar ?? []).slice(0, 80).map(e => ({
          symbol: e.symbol,
          date: e.date,
          hour: e.hour ?? "amc",
          epsEstimate: e.epsEstimate ?? null,
          revenueEstimate: e.revenueEstimate ?? null,
        }));
      }
    } catch { /* ignore */ }

    // ── Economic calendar ──────────────────────────────────────────────
    interface EconRaw {
      event: string; country: string; time: string;
      impact?: string; estimate?: string | number; prev?: string | number; unit?: string;
    }
    let economic: EconRaw[] = [];
    try {
      const r = await fetch(
        `https://finnhub.io/api/v1/calendar/economic?token=${key}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (r.ok) {
        const d = await r.json() as { economicCalendar?: EconRaw[] };
        economic = (d.economicCalendar ?? []).slice(0, 50).map(e => ({
          event: e.event,
          country: e.country,
          time: e.time,
          impact: (e.impact ?? "low").toLowerCase(),
          estimate: e.estimate != null ? String(e.estimate) : undefined,
          prev: e.prev != null ? String(e.prev) : undefined,
          unit: e.unit,
        }));
      }
    } catch { /* ignore */ }

    // ── Géopolitique — Finnhub general news filtré par mots-clés ───────
    const GEO_KEYWORDS = [
      'election','war','summit','trade','sanctions','tariff','nato','opec',
      'g7','g20','ceasefire','treaty','conflict','diplomacy','missile','nuclear',
      'invasion','coup','protest','strike','embargo','referendum',
    ];
    interface GeoRaw { title: string; url: string; datetime: number; source: string }
    let geoNews: { title: string; url: string; date: string; source: string; category: string }[] = [];
    try {
      const r = await fetch(
        `https://finnhub.io/api/v1/news?category=general&token=${key}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (r.ok) {
        const all = await r.json() as GeoRaw[];
        geoNews = all
          .filter(n => GEO_KEYWORDS.some(kw => n.title.toLowerCase().includes(kw)))
          .slice(0, 25)
          .map(n => ({
            title: n.title,
            url: n.url,
            date: new Date(n.datetime * 1000).toLocaleDateString("fr-FR", { day:"2-digit", month:"short" }),
            source: n.source,
            category: GEO_KEYWORDS.find(kw => n.title.toLowerCase().includes(kw)) ?? "other",
          }));
      }
    } catch { /* ignore */ }

    return { earnings, economic, geoNews };
  }
);

// ══════════════════════════════════════════════════════════════════════
// fetchInsiderTrades — SEC Form 4 insider transactions (Feature A)
// Source : SEC EDGAR submissions API + Form 4 XML parsing
// ══════════════════════════════════════════════════════════════════════
export const fetchInsiderTrades = onCall(
  { region: "europe-west1", timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Auth requise.");

    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

    // CIK map for major US stocks (zero-padded to 10 digits)
    const CIK_MAP: Record<string, string> = {
      "AAPL":  "0000320193",
      "MSFT":  "0000789019",
      "NVDA":  "0001045810",
      "TSLA":  "0001318605",
      "AMZN":  "0001018724",
      "META":  "0001326801",
      "GOOGL": "0001652044",
      "JPM":   "0000019617",
      "V":     "0001403161",
      "WMT":   "0000104169",
      "LLY":   "0000059478",
      "AVGO":  "0001730168",
    };

    const SEC_HEADERS = {
      "User-Agent": "TradeMindSet contact@trademindset.app",
      "Accept": "application/json",
    };

    interface InsiderResult {
      symbol: string; name: string; transactionDate: string;
      transactionCode: string; shares: number; pricePerShare: number; totalValue: number;
    }

    // Helper: extract value from Form 4 XML tag
    function xmlVal(xml: string, tag: string): string | null {
      const m = xml.match(new RegExp(`<${tag}[^>]*>\\s*<value>([^<]*)<\\/value>`, "i"));
      if (m) return m[1].trim();
      const m2 = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, "i"));
      return m2 ? m2[1].trim() : null;
    }

    const results: InsiderResult[] = [];

    for (const [sym, cik] of Object.entries(CIK_MAP)) {
      try {
        // 1. Get recent Form 4 filings from EDGAR submissions
        const subUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
        const subRes = await fetch(subUrl, { headers: SEC_HEADERS, signal: AbortSignal.timeout(10000) });
        console.log(`[InsiderTrades] ${sym} submissions → HTTP ${subRes.status}`);
        if (!subRes.ok) { await delay(400); continue; }

        const subJson = await subRes.json() as {
          filings?: {
            recent?: {
              form: string[];
              accessionNumber: string[];
              filingDate: string[];
            };
          };
        };

        const recent = subJson.filings?.recent;
        if (!recent) { await delay(200); continue; }

        // Find last 3 Form 4 filings (recent arrays are in parallel)
        const form4Indices: number[] = [];
        for (let i = 0; i < recent.form.length && form4Indices.length < 3; i++) {
          if (recent.form[i] === "4") form4Indices.push(i);
        }

        const cikNum = cik.replace(/^0+/, ""); // strip leading zeros for URL

        for (const idx of form4Indices) {
          try {
            const accNo  = recent.accessionNumber[idx].replace(/-/g, "");
            // primaryDocument may point to xslF345X06/form4.xml (XSLT HTML) —
            // the actual raw XML is always at the root of the filing directory
            const xmlUrl  = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNo}/form4.xml`;
            const xmlRes  = await fetch(xmlUrl, { headers: { "User-Agent": SEC_HEADERS["User-Agent"] }, signal: AbortSignal.timeout(8000) });
            if (!xmlRes.ok) continue;
            const xml = await xmlRes.text();

            // Extract reporter name (first occurrence)
            const ownerName = xmlVal(xml, "rptOwnerName") ?? "Unknown";

            // Extract all non-derivative transactions (may be multiple)
            const txBlocks = xml.match(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/gi) ?? [];

            for (const block of txBlocks) {
              const dateStr  = xmlVal(block, "transactionDate") ?? recent.filingDate[idx];
              const sharesRaw = parseFloat(xmlVal(block, "transactionShares") ?? "0");
              const priceRaw  = parseFloat(xmlVal(block, "transactionPricePerShare") ?? "0");
              const adCode    = xmlVal(block, "transactionAcquiredDisposedCode") ?? "";
              const code      = adCode === "A" ? "P" : "S"; // A=Acquired(Buy), D=Disposed(Sell)

              if (sharesRaw === 0 || priceRaw === 0) continue;
              const totalValue = sharesRaw * priceRaw;
              if (totalValue < 50_000) continue; // only notable transactions

              results.push({
                symbol: sym,
                name: ownerName,
                transactionDate: dateStr.slice(0, 10),
                transactionCode: code,
                shares: Math.round(Math.abs(sharesRaw)),
                pricePerShare: priceRaw,
                totalValue: Math.round(Math.abs(totalValue)),
              });
            }
            await delay(150); // be gentle with SEC servers
          } catch (e) {
            console.error(`[InsiderTrades] ${sym} XML parse:`, (e as Error).message);
          }
        }
        console.log(`[InsiderTrades] ${sym} → ${results.filter(r => r.symbol === sym).length} txs`);
      } catch (e) {
        console.error(`[InsiderTrades] ${sym}:`, (e as Error).message);
      }
      await delay(300);
    }

    results.sort((a, b) => b.totalValue - a.totalValue);
    console.log(`[InsiderTrades] total: ${results.length}`);
    return { data: results.slice(0, 40) };
  }
);

// ══════════════════════════════════════════════════════════════════════
// fetchAnalystRatings — Analyst recommendations + price targets (Feature C)
// Source : Twelve Data /recommendations + /price_target
// ══════════════════════════════════════════════════════════════════════
export const fetchAnalystRatings = onCall(
  { secrets: [twelveDataKey], region: "europe-west1", timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Auth requise.");

    const { symbols } = request.data as { symbols: string[] };
    if (!Array.isArray(symbols) || symbols.length === 0) {
      throw new HttpsError("invalid-argument", "symbols[] requis");
    }

    const tickers = symbols.slice(0, 10).map(s => s.toUpperCase());
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
    const key = twelveDataKey.value();

    interface TDRecommendations {
      trends?: {
        current_month?: { strong_buy: number; buy: number; hold: number; sell: number; strong_sell: number };
        previous_month?: { strong_buy: number; buy: number; hold: number; sell: number; strong_sell: number };
      };
      rating?: number;
      status?: string;
      message?: string;
    }
    interface TDPriceTarget {
      price_target?: { high: number; median: number; low: number; average: number; current: number };
      status?: string;
      message?: string;
    }
    interface RatingResult {
      symbol: string;
      buy: number; hold: number; sell: number;
      strongBuy: number; strongSell: number;
      consensus: "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell" | "N/A";
      targetMean: number | null; targetHigh: number | null; targetLow: number | null;
    }

    const results: RatingResult[] = [];

    for (const sym of tickers) {
      let buy = 0, hold = 0, sell = 0, strongBuy = 0, strongSell = 0;
      let targetMean: number | null = null, targetHigh: number | null = null, targetLow: number | null = null;

      try {
        // ── Analyst counts ───────────────────────────────────────────
        const recUrl = `https://api.twelvedata.com/recommendations?symbol=${sym}&apikey=${key}`;
        const recRes = await fetch(recUrl, { signal: AbortSignal.timeout(8000) });
        console.log(`[AnalystRatings] ${sym} recommendations → HTTP ${recRes.status}`);
        if (recRes.ok) {
          const recJson = await recRes.json() as TDRecommendations;
          if (recJson.status !== "error") {
            const month = recJson.trends?.current_month;
            if (month) {
              strongBuy  = month.strong_buy  ?? 0;
              buy        = month.buy         ?? 0;
              hold       = month.hold        ?? 0;
              sell       = month.sell        ?? 0;
              strongSell = month.strong_sell ?? 0;
            }
          } else {
            console.warn(`[AnalystRatings] ${sym} recommendations: ${recJson.message}`);
          }
        }
        await delay(300);

        // ── Price targets ─────────────────────────────────────────────
        const ptUrl = `https://api.twelvedata.com/price_target?symbol=${sym}&apikey=${key}`;
        const ptRes = await fetch(ptUrl, { signal: AbortSignal.timeout(8000) });
        console.log(`[AnalystRatings] ${sym} price_target → HTTP ${ptRes.status}`);
        if (ptRes.ok) {
          const ptJson = await ptRes.json() as TDPriceTarget;
          if (ptJson.status !== "error" && ptJson.price_target) {
            targetMean = ptJson.price_target.average ?? ptJson.price_target.median ?? null;
            targetHigh = ptJson.price_target.high ?? null;
            targetLow  = ptJson.price_target.low  ?? null;
          } else {
            console.warn(`[AnalystRatings] ${sym} price_target: ${ptJson.message}`);
          }
        }
      } catch (e) {
        console.error(`[AnalystRatings] ${sym}:`, (e as Error).message);
      }

      const total = strongBuy + buy + hold + sell + strongSell;
      let consensus: RatingResult["consensus"] = "N/A";
      if (total > 0) {
        const score = (strongBuy*1 + buy*0.5 + hold*0 + sell*-0.5 + strongSell*-1) / total;
        consensus = score > 0.6 ? "Strong Buy" : score > 0.2 ? "Buy" : score > -0.2 ? "Hold" : score > -0.6 ? "Sell" : "Strong Sell";
      }
      results.push({ symbol: sym, buy, hold, sell, strongBuy, strongSell, consensus, targetMean, targetHigh, targetLow });
      await delay(400);
    }

    console.log(`[AnalystRatings] done: ${results.length}`);
    return { data: results };
  }
);

// ══════════════════════════════════════════════════════════════════════
// fetchStockEarnings — Earnings surprises + prochains résultats (Feature B)
// Source : Twelve Data /earnings
// ══════════════════════════════════════════════════════════════════════
export const fetchStockEarnings = onCall(
  { secrets: [twelveDataKey], region: "europe-west1", timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Auth requise.");

    const { symbols } = request.data as { symbols: string[] };
    if (!Array.isArray(symbols) || symbols.length === 0) {
      throw new HttpsError("invalid-argument", "symbols[] requis");
    }
    const tickers = symbols.slice(0, 10).map(s => s.toUpperCase());
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
    const key = twelveDataKey.value();

    interface TDEarningsEntry {
      date: string;                    // "2026-04-28" or "2026-01-29"
      time?: string;                   // "before_open" | "after_close"
      eps_estimate?: number | null;
      eps_actual?: number | null;
      difference?: number | null;
      surprise_prc?: number | null;
      revenue_estimate?: number | null;
      revenue_actual?: number | null;
    }
    interface TDEarnings {
      earnings?: TDEarningsEntry[];
      status?: string;
      message?: string;
    }
    interface EarningsResult {
      symbol: string;
      history: { period: string; actual: number | null; estimate: number | null; surprisePct: number | null; beat: boolean | null }[];
      nextDate: string | null; nextHour: string | null;
      nextEpsEstimate: number | null; nextRevenueEstimate: number | null;
      beatRate: number | null;
    }

    const today = new Date().toISOString().slice(0, 10);
    const results: EarningsResult[] = [];

    for (const sym of tickers) {
      let history: EarningsResult["history"] = [];
      let nextDate: string | null = null, nextHour: string | null = null;
      let nextEpsEstimate: number | null = null, nextRevenueEstimate: number | null = null;
      try {
        // Twelve Data returns up to 5 entries (past + future) sorted by date desc
        const url = `https://api.twelvedata.com/earnings?symbol=${sym}&apikey=${key}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
        console.log(`[StockEarnings] ${sym} → HTTP ${r.status}`);
        if (r.ok) {
          const json = await r.json() as TDEarnings;
          if (json.status === "error") {
            console.warn(`[StockEarnings] ${sym}: ${json.message}`);
          } else {
            const entries = json.earnings ?? [];
            console.log(`[StockEarnings] ${sym} → ${entries.length} entries`);

            // Split past vs upcoming
            const past   = entries.filter(e => e.date <= today && e.eps_actual != null);
            const future = entries.filter(e => e.date > today);

            // Historical EPS (4 most recent past, oldest→newest)
            history = past.slice(-4).map(e => {
              const actual   = e.eps_actual   ?? null;
              const estimate = e.eps_estimate ?? null;
              const surprisePct = e.surprise_prc != null
                ? parseFloat(e.surprise_prc.toFixed(1))
                : (actual != null && estimate != null && estimate !== 0
                  ? parseFloat((((actual - estimate) / Math.abs(estimate)) * 100).toFixed(1))
                  : null);
              return {
                period: e.date.slice(0, 7), // "YYYY-MM"
                actual, estimate, surprisePct,
                beat: actual != null && estimate != null ? actual >= estimate : null,
              };
            });

            // Next earnings date (first upcoming entry)
            if (future.length > 0) {
              const next = future[0];
              nextDate          = next.date;
              nextHour          = (next.time ?? "").includes("before") ? "bmo" : "amc";
              nextEpsEstimate     = next.eps_estimate     ?? null;
              nextRevenueEstimate = next.revenue_estimate ?? null;
            }
          }
        }
      } catch (e) {
        console.error(`[StockEarnings] ${sym}:`, (e as Error).message);
      }

      const beats   = history.filter(h => h.beat === true).length;
      const hasData = history.filter(h => h.beat !== null).length;
      results.push({
        symbol: sym, history, nextDate, nextHour, nextEpsEstimate, nextRevenueEstimate,
        beatRate: hasData > 0 ? Math.round((beats / hasData) * 100) : null,
      });
      await delay(400);
    }

    console.log(`[StockEarnings] done: ${results.length} tickers`);
    return { data: results };
  }
);

// ══════════════════════════════════════════════════════════════════════
// fetchTokenNews — Actualités financières par symboles (Feature D)
// Source : Finnhub /company-news + /news (general) + Yahoo RSS
// ══════════════════════════════════════════════════════════════════════
export const fetchTokenNews = onCall(
  { secrets: [finnhubKey], region: "europe-west1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Auth requise.");

    const { symbols, mode } = request.data as { symbols?: string[]; mode?: "general" | "stocks" };
    const key = finnhubKey.value();

    interface NewsItem {
      title: string; url: string; date: string; source: string;
      image?: string; tickers?: string[]; sentiment?: string;
    }

    // ── General market news (crypto whales context) ───────────────────
    if (!symbols || symbols.length === 0 || mode === "general") {
      let items: NewsItem[] = [];
      try {
        const r = await fetch(
          `https://finnhub.io/api/v1/news?category=general&token=${key}`,
          { signal: AbortSignal.timeout(8000) }
        );
        console.log(`[TokenNews] general → HTTP ${r.status}`);
        if (r.ok) {
          const raw = await r.json() as { headline: string; url: string; datetime: number; source: string; image: string; related: string }[];
          console.log(`[TokenNews] general → ${Array.isArray(raw) ? raw.length : 'not array'} articles`);
          if (Array.isArray(raw)) {
            items = raw.slice(0, 20).map(n => ({
              title:   n.headline,
              url:     n.url,
              date:    new Date(n.datetime * 1000).toLocaleDateString("fr-FR", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" }),
              source:  n.source,
              image:   n.image || undefined,
              tickers: n.related ? n.related.split(",").map((s: string) => s.trim()).filter(Boolean) : [],
            }));
          }
        }
      } catch (e) {
        console.error(`[TokenNews] general error:`, (e as Error).message);
      }
      return { data: items };
    }

    // ── Per-ticker company news ───────────────────────────────────────
    const tickers = symbols.slice(0, 5).map(s => s.toUpperCase());
    const today   = new Date();
    const from    = new Date(today.getTime() - 3 * 86_400_000).toISOString().slice(0, 10);
    const to      = today.toISOString().slice(0, 10);

    const allItems: NewsItem[] = [];
    await Promise.allSettled(
      tickers.map(async (sym) => {
        try {
          const r = await fetch(
            `https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${from}&to=${to}&token=${key}`,
            { signal: AbortSignal.timeout(6000) }
          );
          if (!r.ok) return;
          const raw = await r.json() as { headline: string; url: string; datetime: number; source: string; image: string }[];
          for (const n of raw.slice(0, 4)) {
            allItems.push({
              title:   n.headline,
              url:     n.url,
              date:    new Date(n.datetime * 1000).toLocaleDateString("fr-FR", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" }),
              source:  n.source,
              image:   n.image || undefined,
              tickers: [sym],
            });
          }
        } catch { /* skip */ }
      })
    );

    // Deduplicate by URL, sort by date
    const seen = new Set<string>();
    const deduped = allItems.filter(n => { if (seen.has(n.url)) return false; seen.add(n.url); return true; });
    return { data: deduped.slice(0, 25) };
  }
);

// ══════════════════════════════════════════════════════════════════════
// fetchGlassnodeMetrics — On-chain indicators (Feature: macro banner)
// Source : Glassnode API v1
//   • cdd90_age_adjusted      — Coin Days Destroyed 90d (normalised 0–1)
//   • accumulation_trend_score — Whale accumulation score (0–1)
// Prérequis : firebase functions:secrets:set GLASSNODE_API_KEY
// ══════════════════════════════════════════════════════════════════════
export const fetchGlassnodeMetrics = onCall(
  { secrets: [glassnodeKey], region: "europe-west1", timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Auth requise.");

    const key = glassnodeKey.value();
    const BASE = "https://api.glassnode.com/v1/metrics";
    const params = `a=BTC&i=24h&limit=30&api_key=${key}`;

    interface GNPoint { t: number; v: number }

    async function fetchMetric(path: string): Promise<GNPoint[]> {
      const r = await fetch(`${BASE}/${path}?${params}`, { signal: AbortSignal.timeout(8000) });
      console.log(`[Glassnode] ${path} → HTTP ${r.status}`);
      if (!r.ok) return [];
      const raw = await r.json() as GNPoint[];
      return Array.isArray(raw) ? raw : [];
    }

    const [cdd90Raw, accumRaw] = await Promise.all([
      fetchMetric("indicators/cdd90_age_adjusted"),
      fetchMetric("indicators/accumulation_trend_score"),
    ]);

    // Normalize each series 0–1 for sparkline
    function normalise(pts: GNPoint[]) {
      if (pts.length === 0) return { points: [], current: null, prev: null };
      const vals = pts.map(p => p.v);
      const mn = Math.min(...vals), mx = Math.max(...vals);
      return {
        points: vals.map(v => (v - mn) / (mx - mn || 1)),
        current: vals[vals.length - 1],
        prev: vals[vals.length - 2] ?? null,
        timestamps: pts.map(p => p.t),
      };
    }

    const cdd90  = normalise(cdd90Raw);
    const accum  = normalise(accumRaw);

    console.log(`[Glassnode] cdd90=${cdd90.current?.toFixed(4)} accum=${accum.current?.toFixed(4)}`);
    return { cdd90, accum };
  }
);

// ══════════════════════════════════════════════════════════════════════
// Whale Alerts — détection de grosses transactions on-chain
// Sources : Etherscan (transactions) + Dexscreener (prix + volume)
// ══════════════════════════════════════════════════════════════════════
export { whaleScanner }        from "./whales/scheduler/whaleScanner";
export { btcScanner }          from "./whales/scheduler/btcScanner";
export { refreshWatchlist }    from "./whales/scheduler/refreshWatchlist";
export { onWhaleAlertCreated } from "./whales/triggers/onAlertCreated";
