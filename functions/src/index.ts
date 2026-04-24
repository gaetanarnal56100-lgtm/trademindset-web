// functions/src/index.ts — TradeMindset Cloud Functions
// Région : europe-west1 (Frankfurt)

import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'
import * as crypto from 'crypto'
import fetch from 'node-fetch'

admin.initializeApp()
const db = admin.firestore()

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type Exchange = 'binance' | 'bybit'

interface APIKey {
  apiKey: string
  apiSecret: string
  lastSync?: admin.firestore.Timestamp
  importedCount?: number
}

interface ImportedTrade {
  id: string
  date: admin.firestore.Timestamp
  symbol: string
  type: 'Long' | 'Short'
  entryPrice?: number
  exitPrice?: number
  quantity?: number
  leverage: number
  exchangeId: string
  orderRole: 'Maker' | 'Taker'
  systemId: string
  session: 'US' | 'Asia' | 'Europe'
  flashPnLNet: number
  notes: string
  tags: string[]
  status: 'closed'
  source: Exchange
  externalId: string
  closedAt: admin.firestore.Timestamp
}

// ─────────────────────────────────────────────────────────────────────────────
// BINANCE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function binanceSign(queryString: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex')
}

async function fetchBinanceFuturesTrades(
  apiKey: string,
  secret: string,
  startTime?: number,
): Promise<ImportedTrade[]> {
  const now = Date.now()
  const start = startTime ?? now - 90 * 24 * 60 * 60 * 1000 // 90 jours par défaut

  // 1. Fetch income (REALIZED_PNL) — source principale
  const qs1 = `incomeType=REALIZED_PNL&startTime=${start}&endTime=${now}&limit=1000&timestamp=${now}`
  const sig1 = binanceSign(qs1, secret)
  const incomeUrl = `https://fapi.binance.com/fapi/v1/income?${qs1}&signature=${sig1}`

  const incomeRes = await fetch(incomeUrl, {
    headers: { 'X-MBX-APIKEY': apiKey },
  })
  if (!incomeRes.ok) {
    const errText = await incomeRes.text()
    throw new Error(`Binance income fetch failed: ${incomeRes.status} ${errText}`)
  }
  const incomeData = await incomeRes.json() as {
    symbol: string; incomeType: string; income: string;
    asset: string; info: string; time: number; tradeId: string; tranId: string;
  }[]

  const trades: ImportedTrade[] = []

  for (const item of incomeData) {
    if (item.incomeType !== 'REALIZED_PNL') continue
    const pnl = parseFloat(item.income)
    const tradeType: 'Long' | 'Short' = item.info === 'LONG' ? 'Long' : 'Short'
    const ts = admin.firestore.Timestamp.fromMillis(item.time)

    // Déterminer la session (heure UTC)
    const hour = new Date(item.time).getUTCHours()
    let session: 'US' | 'Asia' | 'Europe' = 'US'
    if (hour >= 0 && hour < 8) session = 'Asia'
    else if (hour >= 8 && hour < 14) session = 'Europe'

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
    })
  }

  // 2. Enrichir avec les prix d'entrée/sortie via userTrades (best effort)
  // On groupe par symbol et on fait un fetch par symbol unique
  const symbols = [...new Set(trades.map(t => t.symbol))].slice(0, 10) // max 10 symbols
  const priceMap: Record<string, { price: number; qty: number; isMaker: boolean }[]> = {}

  for (const sym of symbols) {
    try {
      const qs2 = `symbol=${sym}&startTime=${start}&limit=1000&timestamp=${Date.now()}`
      const sig2 = binanceSign(qs2, secret)
      const tradesUrl = `https://fapi.binance.com/fapi/v1/userTrades?${qs2}&signature=${sig2}`
      const tradesRes = await fetch(tradesUrl, { headers: { 'X-MBX-APIKEY': apiKey } })
      if (tradesRes.ok) {
        const data = await tradesRes.json() as { price: string; qty: string; maker: boolean; time: number; realizedPnl: string }[]
        priceMap[sym] = data.map(d => ({
          price: parseFloat(d.price),
          qty: parseFloat(d.qty),
          isMaker: d.maker,
        }))
      }
    } catch { /* skip enrichment for this symbol */ }
  }

  // Enrichir les trades avec le prix moyen d'exécution
  for (const trade of trades) {
    const fills = priceMap[trade.symbol]
    if (fills && fills.length > 0) {
      const total = fills.reduce((s, f) => s + f.qty, 0)
      trade.quantity = total
      const wAvg = fills.reduce((s, f) => s + f.price * f.qty, 0) / total
      trade.entryPrice = wAvg
      if (fills.some(f => f.isMaker)) trade.orderRole = 'Maker'
    }
  }

  return trades
}

// ─────────────────────────────────────────────────────────────────────────────
// BYBIT HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function bybitSign(params: string, secret: string, ts: number, apiKey: string): string {
  const payload = `${ts}${apiKey}5000${params}`
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

async function fetchBybitTrades(
  apiKey: string,
  secret: string,
  startTime?: number,
): Promise<ImportedTrade[]> {
  const now = Date.now()
  const start = startTime ?? now - 90 * 24 * 60 * 60 * 1000

  const params = `category=linear&limit=200&startTime=${start}`
  const sig = bybitSign(params, secret, now, apiKey)

  const url = `https://api.bybit.com/v5/execution/list?${params}`
  const res = await fetch(url, {
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-SIGN': sig,
      'X-BAPI-TIMESTAMP': String(now),
      'X-BAPI-RECV-WINDOW': '5000',
    },
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Bybit fetch failed: ${res.status} ${errText}`)
  }

  const data = await res.json() as {
    retCode: number
    result?: {
      list?: {
        symbol: string; orderId: string; side: string; execTime: string;
        execPrice: string; execQty: string; closedPnl: string; execType: string;
        isMaker: string; leavesQty: string;
      }[]
    }
  }

  if (data.retCode !== 0 || !data.result?.list) return []

  const trades: ImportedTrade[] = []

  for (const item of data.result.list) {
    if (item.execType !== 'Trade') continue
    const closedPnl = parseFloat(item.closedPnl)
    if (closedPnl === 0) continue // skip opening fills

    const ts = parseInt(item.execTime)
    const ts_ = admin.firestore.Timestamp.fromMillis(ts)
    const hour = new Date(ts).getUTCHours()
    let session: 'US' | 'Asia' | 'Europe' = 'US'
    if (hour >= 0 && hour < 8) session = 'Asia'
    else if (hour >= 8 && hour < 14) session = 'Europe'

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
    })
  }

  return trades
}

// ─────────────────────────────────────────────────────────────────────────────
// CLOUD FUNCTION : syncExchangeTrades
// Appelée depuis le frontend via httpsCallable
// ─────────────────────────────────────────────────────────────────────────────

export const syncExchangeTrades = functions
  .region('europe-west1')
  .https.onCall(async (data: { exchange: Exchange; startTime?: number }, context) => {
    // Auth check
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentification requise')
    }
    const uid = context.auth.uid
    const exchange = data.exchange as Exchange
    if (!['binance', 'bybit'].includes(exchange)) {
      throw new functions.https.HttpsError('invalid-argument', 'Exchange non supporté')
    }

    // Lire les clés API depuis Firestore
    const keyRef = db.collection('users').doc(uid).collection('apiKeys').doc(exchange)
    const keySnap = await keyRef.get()
    if (!keySnap.exists) {
      throw new functions.https.HttpsError('not-found', `Aucune clé API configurée pour ${exchange}`)
    }
    const { apiKey, apiSecret } = keySnap.data() as APIKey
    if (!apiKey || !apiSecret) {
      throw new functions.https.HttpsError('failed-precondition', 'Clés API incomplètes')
    }

    // Récupérer le startTime depuis le dernier sync (pour ne pas tout reimporter)
    const lastSync = keySnap.data()?.lastSync as admin.firestore.Timestamp | undefined
    const startTime = data.startTime ?? (lastSync ? lastSync.toMillis() : undefined)

    // Fetch les trades depuis l'exchange
    let importedTrades: ImportedTrade[] = []
    try {
      if (exchange === 'binance') {
        importedTrades = await fetchBinanceFuturesTrades(apiKey, apiSecret, startTime)
      } else if (exchange === 'bybit') {
        importedTrades = await fetchBybitTrades(apiKey, apiSecret, startTime)
      }
    } catch (err: any) {
      throw new functions.https.HttpsError('internal', `Erreur exchange: ${err.message}`)
    }

    if (importedTrades.length === 0) {
      await keyRef.update({ lastSync: admin.firestore.FieldValue.serverTimestamp() })
      return { imported: 0, skipped: 0, message: 'Aucun nouveau trade à importer' }
    }

    // Dedup : vérifier les externalId déjà présents
    const tradesCol = db.collection('users').doc(uid).collection('trades')
    const existingSnap = await tradesCol
      .where('source', 'in', ['binance', 'bybit'])
      .where('externalId', 'in', importedTrades.map(t => t.externalId).slice(0, 30))
      .get()
    const existingIds = new Set(existingSnap.docs.map(d => d.data().externalId as string))

    const newTrades = importedTrades.filter(t => !existingIds.has(t.externalId))
    const skipped = importedTrades.length - newTrades.length

    // Write par batches de 500 (limite Firestore)
    let written = 0
    for (let i = 0; i < newTrades.length; i += 400) {
      const batch = db.batch()
      const chunk = newTrades.slice(i, i + 400)
      for (const trade of chunk) {
        const ref = tradesCol.doc()
        batch.set(ref, { ...trade, id: ref.id })
        written++
      }
      await batch.commit()
    }

    // Mise à jour du lastSync et compteur
    const prevCount = keySnap.data()?.importedCount ?? 0
    await keyRef.update({
      lastSync: admin.firestore.FieldValue.serverTimestamp(),
      importedCount: prevCount + written,
    })

    return {
      imported: written,
      skipped,
      message: `${written} trade(s) importé(s), ${skipped} déjà présent(s)`,
    }
  })

// ─────────────────────────────────────────────────────────────────────────────
// CLOUD FUNCTION : saveExchangeAPIKey
// Sauvegarde sécurisée de la clé API (évite de transiter la secret via le frontend)
// ─────────────────────────────────────────────────────────────────────────────

export const saveExchangeAPIKey = functions
  .region('europe-west1')
  .https.onCall(async (data: { exchange: Exchange; apiKey: string; apiSecret: string }, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentification requise')
    }
    const uid = context.auth.uid
    const { exchange, apiKey, apiSecret } = data

    if (!['binance', 'bybit'].includes(exchange) || !apiKey || !apiSecret) {
      throw new functions.https.HttpsError('invalid-argument', 'Paramètres invalides')
    }

    // Tester la clé avant de la sauvegarder (appel léger)
    let valid = false
    let errorMsg = ''
    try {
      if (exchange === 'binance') {
        const qs = `timestamp=${Date.now()}`
        const sig = crypto.createHmac('sha256', apiSecret).update(qs).digest('hex')
        const testRes = await fetch(
          `https://fapi.binance.com/fapi/v1/account?${qs}&signature=${sig}`,
          { headers: { 'X-MBX-APIKEY': apiKey } },
        )
        valid = testRes.ok
        if (!valid) errorMsg = `Binance: ${testRes.status} — vérifiez votre clé API`
      } else if (exchange === 'bybit') {
        const ts = Date.now()
        const payload = `${ts}${apiKey}5000`
        const sig = crypto.createHmac('sha256', apiSecret).update(payload).digest('hex')
        const testRes = await fetch('https://api.bybit.com/v5/account/wallet-balance?accountType=UNIFIED', {
          headers: {
            'X-BAPI-API-KEY': apiKey,
            'X-BAPI-SIGN': sig,
            'X-BAPI-TIMESTAMP': String(ts),
            'X-BAPI-RECV-WINDOW': '5000',
          },
        })
        valid = testRes.ok
        if (!valid) errorMsg = `Bybit: ${testRes.status} — vérifiez votre clé API`
      }
    } catch (err: any) {
      errorMsg = err.message
    }

    if (!valid) {
      throw new functions.https.HttpsError('invalid-argument', errorMsg || 'Clé API invalide')
    }

    // Sauvegarde dans Firestore
    await db.collection('users').doc(uid).collection('apiKeys').doc(exchange).set({
      apiKey,
      apiSecret, // stocké côté serveur, jamais renvoyé au client
      exchange,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      importedCount: 0,
    }, { merge: true })

    return { success: true, message: `Clé ${exchange} validée et sauvegardée` }
  })

// ─────────────────────────────────────────────────────────────────────────────
// CLOUD FUNCTION : getExchangeKeyStatus (ne renvoie PAS le secret)
// ─────────────────────────────────────────────────────────────────────────────

export const getExchangeKeyStatus = functions
  .region('europe-west1')
  .https.onCall(async (data: { exchange: Exchange }, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentification requise')
    }
    const uid = context.auth.uid
    const snap = await db
      .collection('users').doc(uid)
      .collection('apiKeys').doc(data.exchange)
      .get()

    if (!snap.exists) return { connected: false }
    const d = snap.data()!
    return {
      connected: true,
      exchange: data.exchange,
      apiKeyMasked: `${(d.apiKey as string).slice(0, 6)}••••${(d.apiKey as string).slice(-4)}`,
      lastSync: d.lastSync ? (d.lastSync as admin.firestore.Timestamp).toMillis() : null,
      importedCount: d.importedCount ?? 0,
    }
  })

// ─────────────────────────────────────────────────────────────────────────────
// CLOUD FUNCTION : deleteExchangeAPIKey
// ─────────────────────────────────────────────────────────────────────────────

export const deleteExchangeAPIKey = functions
  .region('europe-west1')
  .https.onCall(async (data: { exchange: Exchange }, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentification requise')
    }
    const uid = context.auth.uid
    await db.collection('users').doc(uid).collection('apiKeys').doc(data.exchange).delete()
    return { success: true }
  })

// ══════════════════════════════════════════════════════════════════════
// Whale Alerts — détection de grosses transactions on-chain
// Sources : Etherscan (transactions) + Dexscreener (prix + volume)
// ══════════════════════════════════════════════════════════════════════
export { whaleScanner }        from "./whales/scheduler/whaleScanner";
export { refreshWatchlist }    from "./whales/scheduler/refreshWatchlist";
export { onWhaleAlertCreated } from "./whales/triggers/onAlertCreated";
