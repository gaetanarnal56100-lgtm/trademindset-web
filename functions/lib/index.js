"use strict";
// functions/src/index.ts — TradeMindset Cloud Functions
// Région : europe-west1 (Frankfurt)
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteExchangeAPIKey = exports.getExchangeKeyStatus = exports.saveExchangeAPIKey = exports.syncExchangeTrades = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const crypto = __importStar(require("crypto"));
const node_fetch_1 = __importDefault(require("node-fetch"));
admin.initializeApp();
const db = admin.firestore();
// ─────────────────────────────────────────────────────────────────────────────
// BINANCE HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function binanceSign(queryString, secret) {
    return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}
async function fetchBinanceFuturesTrades(apiKey, secret, startTime) {
    const now = Date.now();
    const start = startTime ?? now - 90 * 24 * 60 * 60 * 1000; // 90 jours par défaut
    // 1. Fetch income (REALIZED_PNL) — source principale
    const qs1 = `incomeType=REALIZED_PNL&startTime=${start}&endTime=${now}&limit=1000&timestamp=${now}`;
    const sig1 = binanceSign(qs1, secret);
    const incomeUrl = `https://fapi.binance.com/fapi/v1/income?${qs1}&signature=${sig1}`;
    const incomeRes = await (0, node_fetch_1.default)(incomeUrl, {
        headers: { 'X-MBX-APIKEY': apiKey },
    });
    if (!incomeRes.ok) {
        const errText = await incomeRes.text();
        throw new Error(`Binance income fetch failed: ${incomeRes.status} ${errText}`);
    }
    const incomeData = await incomeRes.json();
    const trades = [];
    for (const item of incomeData) {
        if (item.incomeType !== 'REALIZED_PNL')
            continue;
        const pnl = parseFloat(item.income);
        const tradeType = item.info === 'LONG' ? 'Long' : 'Short';
        const ts = admin.firestore.Timestamp.fromMillis(item.time);
        // Déterminer la session (heure UTC)
        const hour = new Date(item.time).getUTCHours();
        let session = 'US';
        if (hour >= 0 && hour < 8)
            session = 'Asia';
        else if (hour >= 8 && hour < 14)
            session = 'Europe';
        trades.push({
            id: item.tranId,
            date: ts,
            symbol: item.symbol,
            type: tradeType,
            leverage: 1,
            exchangeId: 'Binance',
            orderRole: 'Taker',
            systemId: 'imported',
            session,
            flashPnLNet: pnl,
            notes: `Importé automatiquement depuis Binance Futures (tradeId: ${item.tradeId})`,
            tags: ['binance', 'auto-import'],
            status: 'closed',
            source: 'binance',
            externalId: item.tranId,
            closedAt: ts,
        });
    }
    // 2. Enrichir avec les prix d'entrée/sortie via userTrades (best effort)
    // On groupe par symbol et on fait un fetch par symbol unique
    const symbols = [...new Set(trades.map(t => t.symbol))].slice(0, 10); // max 10 symbols
    const priceMap = {};
    for (const sym of symbols) {
        try {
            const qs2 = `symbol=${sym}&startTime=${start}&limit=1000&timestamp=${Date.now()}`;
            const sig2 = binanceSign(qs2, secret);
            const tradesUrl = `https://fapi.binance.com/fapi/v1/userTrades?${qs2}&signature=${sig2}`;
            const tradesRes = await (0, node_fetch_1.default)(tradesUrl, { headers: { 'X-MBX-APIKEY': apiKey } });
            if (tradesRes.ok) {
                const data = await tradesRes.json();
                priceMap[sym] = data.map(d => ({
                    price: parseFloat(d.price),
                    qty: parseFloat(d.qty),
                    isMaker: d.maker,
                }));
            }
        }
        catch { /* skip enrichment for this symbol */ }
    }
    // Enrichir les trades avec le prix moyen d'exécution
    for (const trade of trades) {
        const fills = priceMap[trade.symbol];
        if (fills && fills.length > 0) {
            const total = fills.reduce((s, f) => s + f.qty, 0);
            trade.quantity = total;
            const wAvg = fills.reduce((s, f) => s + f.price * f.qty, 0) / total;
            trade.entryPrice = wAvg;
            if (fills.some(f => f.isMaker))
                trade.orderRole = 'Maker';
        }
    }
    return trades;
}
// ─────────────────────────────────────────────────────────────────────────────
// BYBIT HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function bybitSign(params, secret, ts, apiKey) {
    const payload = `${ts}${apiKey}5000${params}`;
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}
async function fetchBybitTrades(apiKey, secret, startTime) {
    const now = Date.now();
    const start = startTime ?? now - 90 * 24 * 60 * 60 * 1000;
    const params = `category=linear&limit=200&startTime=${start}`;
    const sig = bybitSign(params, secret, now, apiKey);
    const url = `https://api.bybit.com/v5/execution/list?${params}`;
    const res = await (0, node_fetch_1.default)(url, {
        headers: {
            'X-BAPI-API-KEY': apiKey,
            'X-BAPI-SIGN': sig,
            'X-BAPI-TIMESTAMP': String(now),
            'X-BAPI-RECV-WINDOW': '5000',
        },
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Bybit fetch failed: ${res.status} ${errText}`);
    }
    const data = await res.json();
    if (data.retCode !== 0 || !data.result?.list)
        return [];
    const trades = [];
    for (const item of data.result.list) {
        if (item.execType !== 'Trade')
            continue;
        const closedPnl = parseFloat(item.closedPnl);
        if (closedPnl === 0)
            continue; // skip opening fills
        const ts = parseInt(item.execTime);
        const ts_ = admin.firestore.Timestamp.fromMillis(ts);
        const hour = new Date(ts).getUTCHours();
        let session = 'US';
        if (hour >= 0 && hour < 8)
            session = 'Asia';
        else if (hour >= 8 && hour < 14)
            session = 'Europe';
        trades.push({
            id: item.orderId,
            date: ts_,
            symbol: item.symbol,
            type: item.side === 'Buy' ? 'Long' : 'Short',
            entryPrice: parseFloat(item.execPrice),
            quantity: parseFloat(item.execQty),
            leverage: 1,
            exchangeId: 'Bybit',
            orderRole: item.isMaker === 'true' ? 'Maker' : 'Taker',
            systemId: 'imported',
            session,
            flashPnLNet: closedPnl,
            notes: `Importé automatiquement depuis Bybit (orderId: ${item.orderId})`,
            tags: ['bybit', 'auto-import'],
            status: 'closed',
            source: 'bybit',
            externalId: item.orderId,
            closedAt: ts_,
        });
    }
    return trades;
}
// ─────────────────────────────────────────────────────────────────────────────
// CLOUD FUNCTION : syncExchangeTrades
// Appelée depuis le frontend via httpsCallable
// ─────────────────────────────────────────────────────────────────────────────
exports.syncExchangeTrades = functions
    .region('europe-west1')
    .https.onCall(async (data, context) => {
    // Auth check
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentification requise');
    }
    const uid = context.auth.uid;
    const exchange = data.exchange;
    if (!['binance', 'bybit'].includes(exchange)) {
        throw new functions.https.HttpsError('invalid-argument', 'Exchange non supporté');
    }
    // Lire les clés API depuis Firestore
    const keyRef = db.collection('users').doc(uid).collection('apiKeys').doc(exchange);
    const keySnap = await keyRef.get();
    if (!keySnap.exists) {
        throw new functions.https.HttpsError('not-found', `Aucune clé API configurée pour ${exchange}`);
    }
    const { apiKey, apiSecret } = keySnap.data();
    if (!apiKey || !apiSecret) {
        throw new functions.https.HttpsError('failed-precondition', 'Clés API incomplètes');
    }
    // Récupérer le startTime depuis le dernier sync (pour ne pas tout reimporter)
    const lastSync = keySnap.data()?.lastSync;
    const startTime = data.startTime ?? (lastSync ? lastSync.toMillis() : undefined);
    // Fetch les trades depuis l'exchange
    let importedTrades = [];
    try {
        if (exchange === 'binance') {
            importedTrades = await fetchBinanceFuturesTrades(apiKey, apiSecret, startTime);
        }
        else if (exchange === 'bybit') {
            importedTrades = await fetchBybitTrades(apiKey, apiSecret, startTime);
        }
    }
    catch (err) {
        throw new functions.https.HttpsError('internal', `Erreur exchange: ${err.message}`);
    }
    if (importedTrades.length === 0) {
        await keyRef.update({ lastSync: admin.firestore.FieldValue.serverTimestamp() });
        return { imported: 0, skipped: 0, message: 'Aucun nouveau trade à importer' };
    }
    // Dedup : vérifier les externalId déjà présents
    const tradesCol = db.collection('users').doc(uid).collection('trades');
    const existingSnap = await tradesCol
        .where('source', 'in', ['binance', 'bybit'])
        .where('externalId', 'in', importedTrades.map(t => t.externalId).slice(0, 30))
        .get();
    const existingIds = new Set(existingSnap.docs.map(d => d.data().externalId));
    const newTrades = importedTrades.filter(t => !existingIds.has(t.externalId));
    const skipped = importedTrades.length - newTrades.length;
    // Write par batches de 500 (limite Firestore)
    let written = 0;
    for (let i = 0; i < newTrades.length; i += 400) {
        const batch = db.batch();
        const chunk = newTrades.slice(i, i + 400);
        for (const trade of chunk) {
            const ref = tradesCol.doc();
            batch.set(ref, { ...trade, id: ref.id });
            written++;
        }
        await batch.commit();
    }
    // Mise à jour du lastSync et compteur
    const prevCount = keySnap.data()?.importedCount ?? 0;
    await keyRef.update({
        lastSync: admin.firestore.FieldValue.serverTimestamp(),
        importedCount: prevCount + written,
    });
    return {
        imported: written,
        skipped,
        message: `${written} trade(s) importé(s), ${skipped} déjà présent(s)`,
    };
});
// ─────────────────────────────────────────────────────────────────────────────
// CLOUD FUNCTION : saveExchangeAPIKey
// Sauvegarde sécurisée de la clé API (évite de transiter la secret via le frontend)
// ─────────────────────────────────────────────────────────────────────────────
exports.saveExchangeAPIKey = functions
    .region('europe-west1')
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentification requise');
    }
    const uid = context.auth.uid;
    const { exchange, apiKey, apiSecret } = data;
    if (!['binance', 'bybit'].includes(exchange) || !apiKey || !apiSecret) {
        throw new functions.https.HttpsError('invalid-argument', 'Paramètres invalides');
    }
    // Tester la clé avant de la sauvegarder (appel léger)
    let valid = false;
    let errorMsg = '';
    try {
        if (exchange === 'binance') {
            const qs = `timestamp=${Date.now()}`;
            const sig = crypto.createHmac('sha256', apiSecret).update(qs).digest('hex');
            const testRes = await (0, node_fetch_1.default)(`https://fapi.binance.com/fapi/v1/account?${qs}&signature=${sig}`, { headers: { 'X-MBX-APIKEY': apiKey } });
            valid = testRes.ok;
            if (!valid)
                errorMsg = `Binance: ${testRes.status} — vérifiez votre clé API`;
        }
        else if (exchange === 'bybit') {
            const ts = Date.now();
            const payload = `${ts}${apiKey}5000`;
            const sig = crypto.createHmac('sha256', apiSecret).update(payload).digest('hex');
            const testRes = await (0, node_fetch_1.default)('https://api.bybit.com/v5/account/wallet-balance?accountType=UNIFIED', {
                headers: {
                    'X-BAPI-API-KEY': apiKey,
                    'X-BAPI-SIGN': sig,
                    'X-BAPI-TIMESTAMP': String(ts),
                    'X-BAPI-RECV-WINDOW': '5000',
                },
            });
            valid = testRes.ok;
            if (!valid)
                errorMsg = `Bybit: ${testRes.status} — vérifiez votre clé API`;
        }
    }
    catch (err) {
        errorMsg = err.message;
    }
    if (!valid) {
        throw new functions.https.HttpsError('invalid-argument', errorMsg || 'Clé API invalide');
    }
    // Sauvegarde dans Firestore
    await db.collection('users').doc(uid).collection('apiKeys').doc(exchange).set({
        apiKey,
        apiSecret, // stocké côté serveur, jamais renvoyé au client
        exchange,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        importedCount: 0,
    }, { merge: true });
    return { success: true, message: `Clé ${exchange} validée et sauvegardée` };
});
// ─────────────────────────────────────────────────────────────────────────────
// CLOUD FUNCTION : getExchangeKeyStatus (ne renvoie PAS le secret)
// ─────────────────────────────────────────────────────────────────────────────
exports.getExchangeKeyStatus = functions
    .region('europe-west1')
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentification requise');
    }
    const uid = context.auth.uid;
    const snap = await db
        .collection('users').doc(uid)
        .collection('apiKeys').doc(data.exchange)
        .get();
    if (!snap.exists)
        return { connected: false };
    const d = snap.data();
    return {
        connected: true,
        exchange: data.exchange,
        apiKeyMasked: `${d.apiKey.slice(0, 6)}••••${d.apiKey.slice(-4)}`,
        lastSync: d.lastSync ? d.lastSync.toMillis() : null,
        importedCount: d.importedCount ?? 0,
    };
});
// ─────────────────────────────────────────────────────────────────────────────
// CLOUD FUNCTION : deleteExchangeAPIKey
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteExchangeAPIKey = functions
    .region('europe-west1')
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentification requise');
    }
    const uid = context.auth.uid;
    await db.collection('users').doc(uid).collection('apiKeys').doc(data.exchange).delete();
    return { success: true };
});
//# sourceMappingURL=index.js.map