// src/pages/predict/PredictPage.tsx — Predict & Earn

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useUser } from '@/hooks/useAuth'
import { callAwardXP } from '@/services/gamification/prestigeEngine'
import {
  createPrediction, getUserPredictions, getCommunityPredictions, getAllRecentPredictions,
  getVirtualBalance, updateVirtualBalance, claimDailyRefill,
  type Prediction, type PredictionTimeframe,
} from '@/services/firestore/predictions'
import { Timestamp } from 'firebase/firestore'
import {
  resolveExpiredPredictions, recordSubmitStats, fetchCryptoPrice, fetchStockPrice,
  TF_MS, type ResolvedSummary,
} from '@/services/predictions/resolutionService'
import { checkAndAwardPredictionBadges } from '@/services/predictions/badgeService'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/services/firebase/config'

// ── Constantes ─────────────────────────────────────────────────
const TIMEFRAMES: PredictionTimeframe[] = ['1h', '4h', '24h', '3d', '7d']

/** Fenêtre de fermeture : entre 10 min et 2h avant la résolution */
const LOCK_MIN_MS = 10 * 60 * 1000        // 10 minutes
const LOCK_MAX_MS = 2 * 60 * 60 * 1000   // 2 heures

/**
 * Calcule l'heure de fermeture des paris pour un round donné.
 * Déterministe (basé sur le timestamp de résolution) → identique pour tous
 * les utilisateurs du même round, mais non annoncé dans l'UI.
 * Résultat toujours dans [resolveAt - 2h, resolveAt - 10min].
 */
function computeLockAt(resolveDate: Date): Date {
  const seed   = resolveDate.getTime()
  const range  = LOCK_MAX_MS - LOCK_MIN_MS   // 110 min en ms
  const offset = LOCK_MIN_MS + (seed % range)
  return new Date(resolveDate.getTime() - offset)
}

/**
 * Calcule la prochaine heure de résolution FIXE pour un timeframe donné.
 * Tous les utilisateurs pariant sur le même timeframe ont exactement le même resolveAt.
 *
 * 1h  → prochaine heure pleine (ex: si 14h23 → 15h00)
 * 4h  → prochain multiple de 4h UTC: 00h, 04h, 08h, 12h, 16h, 20h
 * 24h → prochain minuit UTC
 * 3d  → dans 3 jours à minuit UTC
 * 7d  → dans 7 jours à minuit UTC
 */
function nextResolveAt(tf: PredictionTimeframe): Date {
  const now = new Date()
  switch (tf) {
    case '1h': {
      const d = new Date(now)
      d.setUTCMinutes(0, 0, 0)
      d.setUTCHours(d.getUTCHours() + 1)
      return d
    }
    case '4h': {
      const d = new Date(now)
      const h = d.getUTCHours()
      const nextH = Math.ceil((h + 1) / 4) * 4
      if (nextH >= 24) {
        d.setUTCDate(d.getUTCDate() + 1)
        d.setUTCHours(0, 0, 0, 0)
      } else {
        d.setUTCHours(nextH, 0, 0, 0)
      }
      return d
    }
    case '24h': {
      const d = new Date(now)
      d.setUTCDate(d.getUTCDate() + 1)
      d.setUTCHours(0, 0, 0, 0)
      return d
    }
    case '3d': {
      const d = new Date(now)
      d.setUTCDate(d.getUTCDate() + 3)
      d.setUTCHours(0, 0, 0, 0)
      return d
    }
    case '7d': {
      const d = new Date(now)
      d.setUTCDate(d.getUTCDate() + 7)
      d.setUTCHours(0, 0, 0, 0)
      return d
    }
  }
}

/** Formate un diff en ms en chaîne lisible (avec secondes) */
function fmtDiff(diff: number, resolvingLabel: string): string {
  if (diff <= 0) return resolvingLabel
  const d = Math.floor(diff / 86_400_000)
  const h = Math.floor((diff % 86_400_000) / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  const s = Math.floor((diff % 60_000) / 1000)
  if (d > 0) return `${d}j ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/** Formate une Date en heure locale lisible */
function fmtTime(d: Date): string {
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
}

// Top 10 crypto disponibles maintenant
const CRYPTO_SYMBOLS = ['BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOT','MATIC','LINK']

// Coming soon (affichage grisé, non cliquables)
const CRYPTO_COMING_SOON = [
  'UNI','ATOM','LTC','BCH','NEAR','ARB','OP','INJ','TIA','APT',
  'SUI','SEI','DOGE','SHIB','PEPE','WLD','FET',
]
const STOCK_SYMBOLS_COMING_SOON = [
  'AAPL','MSFT','NVDA','GOOGL','META','AMZN','TSLA','AMD','COIN','NFLX',
  'JPM','GS','V','MA','SPY','QQQ','BNP.PA','TTE.PA','MC.PA','AIR.PA',
]

type Tab = 'predict' | 'mine' | 'community'
type AssetType = 'crypto' | 'stock'

// ── Helpers ────────────────────────────────────────────────────
function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (n >= 1)    return n.toLocaleString('fr-FR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 6, maximumFractionDigits: 8 })
}

function fmtCountdown(resolveAt: Timestamp, resolvingLabel: string): string {
  return fmtDiff(resolveAt.toMillis() - Date.now(), resolvingLabel)
}

function anonymize(name?: string): string {
  if (!name) return '???'
  return name[0].toUpperCase() + '***'
}

function resultEmoji(isCorrect: boolean, accuracy: number): string {
  if (!isCorrect) return '💥'
  if (accuracy <= 1)  return '💎'
  if (accuracy <= 2)  return '🎯'
  if (accuracy <= 5)  return '📈'
  return '✅'
}

// ── Community histogram (SVG inline) ──────────────────────────
function PredictionHistogram({ preds, currentPrice }: { preds: Prediction[]; currentPrice: number | null }) {
  const { t } = useTranslation()

  if (preds.length < 2) return (
    <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--tm-text-muted)', fontSize: 12 }}>
      {t('predict.histogramEmpty')}
    </div>
  )

  const prices = preds.map(p => p.predictedPrice)
  const minP = Math.min(...prices)
  const maxP = Math.max(...prices)
  const range = maxP - minP || 1
  const BUCKETS = 10
  const bucketSize = range / BUCKETS

  const buckets = Array.from({ length: BUCKETS }, (_, i) => {
    const lo = minP + i * bucketSize
    const hi = lo + bucketSize
    const cnt = prices.filter(p => (i === BUCKETS - 1 ? p >= lo && p <= hi : p >= lo && p < hi)).length
    return { lo, hi, cnt }
  })

  const maxCnt = Math.max(...buckets.map(b => b.cnt), 1)
  const W = 280, H = 80, padL = 4, padB = 20

  const bullPct = Math.round(preds.filter(p => p.direction === 'up').length / preds.length * 100)

  return (
    <div>
      {/* Sentiment bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 10, color: 'var(--tm-profit)', fontWeight: 600 }}>▲ {bullPct}%</span>
        <div style={{ flex: 1, height: 6, background: 'var(--tm-border)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${bullPct}%`, height: '100%', background: 'linear-gradient(90deg, var(--tm-profit), #00BCD4)', borderRadius: 3, transition: 'width 0.4s' }} />
        </div>
        <span style={{ fontSize: 10, color: 'var(--tm-loss)', fontWeight: 600 }}>{100 - bullPct}% ▼</span>
      </div>

      {/* Histogram */}
      <svg width="100%" viewBox={`0 0 ${W + padL} ${H + padB}`} style={{ overflow: 'visible' }}>
        {buckets.map((b, i) => {
          const x = padL + (i / BUCKETS) * W
          const bw = W / BUCKETS - 1
          const bh = (b.cnt / maxCnt) * H
          const y = H - bh
          const isCurrent = currentPrice !== null && currentPrice >= b.lo && currentPrice < b.hi
          const avgPrice = (minP + maxP) / 2
          const isAvgBucket = (minP + i * bucketSize) <= avgPrice && avgPrice < (minP + (i + 1) * bucketSize)
          const color = isAvgBucket ? 'var(--tm-accent)' : isCurrent ? 'var(--tm-warning)' : 'rgba(var(--tm-accent-rgb,0,229,255),0.35)'
          return (
            <g key={i}>
              <rect x={x} y={y} width={bw} height={bh} rx={2} fill={color} />
              {b.cnt > 0 && (
                <text x={x + bw / 2} y={y - 3} textAnchor="middle" fontSize={7} fill="var(--tm-text-muted)">{b.cnt}</text>
              )}
            </g>
          )
        })}
        {/* X labels (min, avg, max) */}
        {[
          { label: fmtPrice(minP), x: padL },
          { label: fmtPrice((minP + maxP) / 2), x: padL + W / 2 },
          { label: fmtPrice(maxP), x: padL + W },
        ].map(({ label, x }) => (
          <text key={label} x={x} y={H + padB - 2} textAnchor="middle" fontSize={8} fill="var(--tm-text-muted)">{label}</text>
        ))}
      </svg>
      <div style={{ fontSize: 10, color: 'var(--tm-text-muted)', textAlign: 'center', marginTop: 2 }}>
        {t('predict.histogramFooter', { count: preds.length, avg: fmtPrice(prices.reduce((a, b) => a + b, 0) / prices.length) })}
      </div>
    </div>
  )
}

// ── Toast simple ───────────────────────────────────────────────
function Toast({ msg, onClose }: { msg: string; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3500)
    return () => clearTimeout(timer)
  }, [onClose])
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 999,
      background: 'var(--tm-bg-secondary)', border: '1px solid var(--tm-accent)',
      borderRadius: 12, padding: '12px 18px', fontSize: 13, color: 'var(--tm-text-primary)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)', maxWidth: 300, animation: 'fadeIn 0.2s',
    }}>
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`}</style>
      {msg}
      <button onClick={onClose} style={{ marginLeft: 10, background: 'none', border: 'none', color: 'var(--tm-text-muted)', cursor: 'pointer', fontSize: 14 }}>✕</button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// ONGLET 1 — Prédire
// ═══════════════════════════════════════════════════════════════
function PredictTab({ uid, displayName, onToast, onPredictionCreated, virtualUSDT, onBalanceChange }: {
  uid: string
  displayName?: string
  onToast: (msg: string) => void
  onPredictionCreated: () => void
  virtualUSDT: number | null
  onBalanceChange: (delta: number) => void
}) {
  const { t } = useTranslation()
  const [assetType, setAssetType] = useState<AssetType>('crypto')
  const [symbol, setSymbol]       = useState<string>('BTC')
  const [search, setSearch]       = useState('')
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)
  const [priceLoading, setPriceLoading] = useState(false)
  const [timeframe, setTimeframe]  = useState<PredictionTimeframe>('24h')
  const [predictedPrice, setPredictedPrice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [communityPreds, setCommunityPreds] = useState<Prediction[]>([])
  const [commLoading, setCommLoading] = useState(false)
  // ── USDT virtuel ─────────────────────────────────────────────
  const [stake, setStake]         = useState(0)
  const [stakeOpen, setStakeOpen] = useState(false)

  // ── Fixed resolve time + random lock ────────────────────────
  const [resolveDate, setResolveDate] = useState<Date>(() => nextResolveAt('24h'))
  const [lockAt, setLockAt]           = useState<Date>(() => computeLockAt(nextResolveAt('24h')))
  const [countdown, setCountdown]     = useState('')
  const [isLocked, setIsLocked]       = useState(false)

  const tfLabels: Record<PredictionTimeframe, string> = {
    '1h':  t('predict.tfLabel_1h'),
    '4h':  t('predict.tfLabel_4h'),
    '24h': t('predict.tfLabel_24h'),
    '3d':  t('predict.tfLabel_3d'),
    '7d':  t('predict.tfLabel_7d'),
  }

  // Recalcule résolution + heure de lock quand le timeframe change
  useEffect(() => {
    const rd = nextResolveAt(timeframe)
    setResolveDate(rd)
    setLockAt(computeLockAt(rd))
  }, [timeframe])

  // Ticker live (toutes les secondes)
  useEffect(() => {
    const tick = () => {
      const now  = Date.now()
      const diff = resolveDate.getTime() - now
      setIsLocked(now >= lockAt.getTime() && now < resolveDate.getTime())
      setCountdown(fmtDiff(diff, t('predict.resolvingCountdown')))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [resolveDate, lockAt, t])

  // Seul le crypto top 10 est disponible ; actions = coming soon
  const activeSymbols = assetType === 'crypto' ? CRYPTO_SYMBOLS : []
  const comingSoonSymbols = assetType === 'crypto' ? CRYPTO_COMING_SOON : STOCK_SYMBOLS_COMING_SOON
  const filtered = search
    ? activeSymbols.filter(s => s.toLowerCase().includes(search.toLowerCase()))
    : activeSymbols

  // Fetch prix au changement d'actif
  const fetchPrice = useCallback(async (sym: string, type: AssetType) => {
    setPriceLoading(true)
    setCurrentPrice(null)
    const price = type === 'crypto' ? await fetchCryptoPrice(sym) : await fetchStockPrice(sym)
    setCurrentPrice(price)
    if (price) setPredictedPrice(price.toPrecision(6))
    setPriceLoading(false)
  }, [])

  useEffect(() => { fetchPrice(symbol, assetType) }, [symbol, assetType, fetchPrice])

  // Fetch community preds au changement symbole/timeframe
  useEffect(() => {
    setCommLoading(true)
    getCommunityPredictions(symbol, timeframe).then(p => {
      setCommunityPreds(p.filter(pr => pr.uid !== uid))
      setCommLoading(false)
    })
  }, [symbol, timeframe, uid])

  const numPredicted = parseFloat(predictedPrice.replace(',', '.'))
  const deltaPct = currentPrice && numPredicted
    ? (numPredicted - currentPrice) / currentPrice * 100
    : 0
  const direction = deltaPct >= 0 ? 'up' : 'down'
  const canSubmit = !priceLoading && currentPrice !== null && !isNaN(numPredicted) && numPredicted > 0 && !isLocked

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      // Re-fetch le prix pour le lock
      const lockedPrice = assetType === 'crypto'
        ? await fetchCryptoPrice(symbol)
        : await fetchStockPrice(symbol)
      if (!lockedPrice) throw new Error(t('predict.errorPrice'))

      // Vérification côté client : si on est en période de lock, on refuse
      if (Date.now() >= lockAt.getTime()) {
        throw new Error(t('predict.errorBetsClosed'))
      }
      const resolveAt = Timestamp.fromDate(resolveDate)
      // Déduction USDT virtuel avant création (pour bloquer si solde insuffisant)
      if (stake > 0) {
        if ((virtualUSDT ?? 0) < stake) throw new Error(t('predict.errorInsufficientBalance', { balance: virtualUSDT ?? 0 }))
        await updateVirtualBalance(uid, -stake)
        onBalanceChange(-stake)
      }

      await createPrediction({
        uid,
        symbol,
        assetType,
        currentPrice: lockedPrice,
        predictedPrice: numPredicted,
        direction,
        deltaPct,
        timeframe,
        resolveAt,
        status: 'pending',
        createdAt: Timestamp.now(),
        displayName: anonymize(displayName),
        ...(stake > 0 ? { stake, odds: 1.9, potentialWin: +(stake * 1.9).toFixed(2) } : {}),
      })

      // +3 XP pour la soumission
      await callAwardXP(3, 'prediction_submit')

      // Stats + badges
      await recordSubmitStats(uid)
      const userSnap = await getDoc(doc(db, 'users', uid))
      const d = userSnap.exists() ? userSnap.data() : {}
      const stats = {
        predictionsTotal:       (d.predictionsTotal ?? 0),
        predictionsCorrect:     d.predictionsCorrect ?? 0,
        predictionStreak:       d.predictionStreak ?? 0,
        predictionBestAccuracy: d.predictionBestAccuracy ?? 100,
        predictionDailyStreak:  d.predictionDailyStreak ?? 0,
        predictionLastDate:     d.predictionLastDate ?? '',
      }
      const newBadges = await checkAndAwardPredictionBadges(uid, stats)
      const stakeMsg = stake > 0 ? t('predict.toastStake', { stake }) : ''
      if (newBadges.length > 0) {
        onToast(t('predict.toastBadge', { count: newBadges.length, badges: newBadges.map(b => b.icon + ' ' + b.name).join(', ') }))
      } else {
        onToast(t('predict.toastSubmitted', { stake: stakeMsg, time: fmtTime(resolveDate) }))
      }
      setStake(0)
      setStakeOpen(false)
      onPredictionCreated()
    } catch (e) {
      onToast(t('predict.errorGeneric', { message: (e as Error).message }))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
      {/* Colonne principale */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Asset type toggle */}
        <div style={{ background: 'var(--tm-bg-secondary)', border: '1px solid var(--tm-border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tm-text-muted)', marginBottom: 10 }}>{t('predict.sectionAssetType')}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {/* Crypto — disponible */}
            <button onClick={() => { setAssetType('crypto'); setSymbol('BTC'); setSearch('') }} style={{
              flex: 1, padding: '8px 0', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
              border: `1px solid ${assetType === 'crypto' ? 'var(--tm-accent)' : 'var(--tm-border)'}`,
              background: assetType === 'crypto' ? 'rgba(var(--tm-accent-rgb,0,229,255),0.12)' : 'var(--tm-bg-tertiary)',
              color: assetType === 'crypto' ? 'var(--tm-accent)' : 'var(--tm-text-secondary)',
            }}>
              {t('predict.crypto')}
            </button>
            {/* Actions — coming soon */}
            <div title={t('predict.comingSoonLabel')} style={{
              flex: 1, padding: '8px 0', borderRadius: 8, cursor: 'not-allowed', fontSize: 13, fontWeight: 600,
              border: '1px solid var(--tm-border)',
              background: 'var(--tm-bg-tertiary)',
              color: 'var(--tm-text-muted)',
              opacity: 0.6,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              {t('predict.stocks')}
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 99,
                background: 'linear-gradient(135deg,#BF5AF222,#0A85FF22)',
                border: '1px solid #BF5AF244', color: '#BF5AF2',
                letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>{t('predict.comingSoon')}</span>
            </div>
          </div>
        </div>

        {/* Asset selector */}
        <div style={{ background: 'var(--tm-bg-secondary)', border: '1px solid var(--tm-border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tm-text-muted)', marginBottom: 10 }}>{t('predict.sectionAsset')}</div>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('predict.searchPlaceholder')}
            style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--tm-border)', background: 'var(--tm-bg-tertiary)', color: 'var(--tm-text-primary)', fontSize: 13, outline: 'none', marginBottom: 10, boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
            {/* Actifs disponibles */}
            {filtered.map(sym => (
              <button key={sym} onClick={() => { setSymbol(sym); setSearch('') }} style={{
                padding: '4px 10px', borderRadius: 20, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                border: `1px solid ${symbol === sym ? 'var(--tm-accent)' : 'var(--tm-border)'}`,
                background: symbol === sym ? 'rgba(var(--tm-accent-rgb,0,229,255),0.12)' : 'var(--tm-bg-tertiary)',
                color: symbol === sym ? 'var(--tm-accent)' : 'var(--tm-text-secondary)',
              }}>{sym}</button>
            ))}
            {/* Séparateur + coming soon (si pas de recherche) */}
            {!search && comingSoonSymbols.length > 0 && (
              <>
                <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 2px' }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--tm-border)' }} />
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '1px 7px', borderRadius: 99,
                    background: 'linear-gradient(135deg,#BF5AF222,#0A85FF22)',
                    border: '1px solid #BF5AF244', color: '#BF5AF2',
                    letterSpacing: '0.07em', textTransform: 'uppercase',
                  }}>{t('predict.comingSoonLabel')}</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--tm-border)' }} />
                </div>
                {comingSoonSymbols.map(sym => (
                  <div key={sym} title={t('predict.comingSoonLabel')} style={{
                    padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                    border: '1px solid var(--tm-border)',
                    background: 'var(--tm-bg-tertiary)',
                    color: 'var(--tm-text-muted)',
                    opacity: 0.45, cursor: 'not-allowed',
                  }}>{sym}</div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* Timeframe */}
        <div style={{ background: 'var(--tm-bg-secondary)', border: '1px solid var(--tm-border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tm-text-muted)', marginBottom: 10 }}>{t('predict.sectionTimeframe')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {TIMEFRAMES.map(tf => {
              const rDate  = nextResolveAt(tf)
              const lAt    = computeLockAt(rDate)
              const now    = Date.now()
              const locked = now >= lAt.getTime() && now < rDate.getTime()
              return (
                <button key={tf} onClick={() => setTimeframe(tf)}
                  title={`${t('predict.resolutionTime')}${fmtTime(rDate)}`}
                  style={{
                    flex: 1, minWidth: 60, padding: '7px 4px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    border: `1px solid ${timeframe === tf ? (locked ? 'var(--tm-loss)' : 'var(--tm-accent)') : 'var(--tm-border)'}`,
                    background: timeframe === tf ? (locked ? 'rgba(244,67,54,0.1)' : 'rgba(var(--tm-accent-rgb,0,229,255),0.12)') : 'var(--tm-bg-tertiary)',
                    color: timeframe === tf ? (locked ? 'var(--tm-loss)' : 'var(--tm-accent)') : 'var(--tm-text-secondary)',
                    position: 'relative',
                  }}>
                  {tf}
                  {locked && <span style={{ position: 'absolute', top: -4, right: -4, fontSize: 8 }}>🔒</span>}
                </button>
              )
            })}
          </div>
          <div style={{ marginTop: 8, fontSize: 10, color: 'var(--tm-text-muted)' }}>
            {t('predict.resolutionTime')}<span style={{ color: isLocked ? 'var(--tm-loss)' : 'var(--tm-text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>{fmtTime(resolveDate)}</span>
            {isLocked && <span style={{ color: 'var(--tm-loss)', marginLeft: 8 }}>{t('predict.betsClosed')}</span>}
          </div>
        </div>

        {/* Prix actuel + saisie */}
        <div style={{ background: 'var(--tm-bg-secondary)', border: '1px solid var(--tm-border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tm-text-muted)' }}>{t('predict.sectionCurrentPrice', { symbol })}</div>
            {priceLoading
              ? <div style={{ fontSize: 12, color: 'var(--tm-text-muted)' }}>{t('predict.priceLoading')}</div>
              : currentPrice !== null
              ? <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--tm-text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>{fmtPrice(currentPrice)}</div>
              : <div style={{ fontSize: 12, color: 'var(--tm-loss)' }}>{t('predict.priceUnavailable')}</div>
            }
          </div>

          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tm-text-muted)', marginBottom: 8 }}>{t('predict.sectionMyPrediction', { timeframe: tfLabels[timeframe].toUpperCase() })}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="number"
              value={predictedPrice}
              onChange={e => setPredictedPrice(e.target.value)}
              placeholder={t('predict.pricePlaceholder')}
              style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: `1px solid ${direction === 'up' ? 'var(--tm-profit)' : 'var(--tm-loss)'}`, background: 'var(--tm-bg-tertiary)', color: 'var(--tm-text-primary)', fontSize: 16, outline: 'none', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}
            />
            {predictedPrice && currentPrice && (
              <div style={{
                padding: '8px 14px', borderRadius: 10, fontWeight: 700, fontSize: 14, fontFamily: 'JetBrains Mono, monospace',
                background: direction === 'up' ? 'rgba(76,175,80,0.12)' : 'rgba(244,67,54,0.12)',
                color: direction === 'up' ? 'var(--tm-profit)' : 'var(--tm-loss)',
                border: `1px solid ${direction === 'up' ? 'rgba(76,175,80,0.25)' : 'rgba(244,67,54,0.25)'}`,
              }}>
                {direction === 'up' ? '▲' : '▼'} {Math.abs(deltaPct).toFixed(2)}%
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Colonne droite — Community + Submit */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, position: 'sticky', top: 20 }}>
        {/* Community insights */}
        <div style={{ background: 'var(--tm-bg-secondary)', border: '1px solid var(--tm-border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{t('predict.communityTitle', { symbol, timeframe })}</span>
          </div>
          {commLoading ? (
            <div style={{ fontSize: 12, color: 'var(--tm-text-muted)', textAlign: 'center', padding: '10px 0' }}>{t('predict.loadingSpinner')}</div>
          ) : (
            <PredictionHistogram preds={communityPreds} currentPrice={currentPrice} />
          )}
        </div>

        {/* Panel mise USDT virtuel */}
        <div style={{ background: 'var(--tm-bg-secondary)', border: `1px solid ${stakeOpen ? 'rgba(255,159,10,0.35)' : 'var(--tm-border)'}`, borderRadius: 12, overflow: 'hidden' }}>
          <button
            onClick={() => setStakeOpen(o => !o)}
            style={{ width: '100%', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: stakeOpen ? '#FF9F0A' : 'var(--tm-text-secondary)' }}>
              {t('predict.stakeTitle')}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {virtualUSDT != null && (
                <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--tm-text-muted)' }}>
                  {t('predict.stakeBalance', { balance: virtualUSDT.toLocaleString('fr-FR') })}
                </span>
              )}
              <span style={{ fontSize: 11, color: 'var(--tm-text-muted)' }}>{stakeOpen ? '▲' : '▼'}</span>
            </span>
          </button>
          {stakeOpen && (
            <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Slider */}
              <input
                type="range"
                min={0}
                max={Math.min(500, virtualUSDT ?? 500)}
                step={10}
                value={stake}
                onChange={e => setStake(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#FF9F0A' }}
              />
              {/* Presets */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[10, 50, 100].map(v => (
                  <button key={v} onClick={() => setStake(Math.min(v, virtualUSDT ?? v))}
                    style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${stake === v ? '#FF9F0A' : 'var(--tm-border)'}`, background: stake === v ? 'rgba(255,159,10,0.15)' : 'var(--tm-bg-tertiary)', color: stake === v ? '#FF9F0A' : 'var(--tm-text-secondary)', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace' }}>
                    {v}
                  </button>
                ))}
                <button onClick={() => setStake(Math.min(500, virtualUSDT ?? 0))}
                  style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--tm-border)', background: 'var(--tm-bg-tertiary)', color: 'var(--tm-text-secondary)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  Max
                </button>
                {stake > 0 && (
                  <button onClick={() => setStake(0)}
                    style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--tm-border)', background: 'var(--tm-bg-tertiary)', color: 'var(--tm-text-muted)', fontSize: 11, cursor: 'pointer' }}>
                    {t('predict.stakeCancel')}
                  </button>
                )}
              </div>
              {/* Résumé */}
              {stake > 0 ? (
                <div style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--tm-text-primary)', background: 'rgba(255,159,10,0.08)', border: '1px solid rgba(255,159,10,0.2)', borderRadius: 8, padding: '8px 10px' }}>
                  <span style={{ color: 'var(--tm-text-secondary)' }}>{t('predict.stakeLabel')}</span>
                  <span style={{ color: '#FF9F0A', fontWeight: 700 }}>{stake} USDT</span>
                  <span style={{ color: 'var(--tm-text-secondary)' }}>{t('predict.stakePotential')}</span>
                  <span style={{ color: 'var(--tm-profit)', fontWeight: 700 }}>+{(stake * 0.9).toFixed(0)} USDT</span>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--tm-text-muted)' }}>{t('predict.stakeNone')}</div>
              )}
            </div>
          )}
        </div>

        {/* XP preview card */}
        <div style={{ background: 'linear-gradient(135deg, rgba(var(--tm-accent-rgb,0,229,255),0.06), rgba(191,90,242,0.06))', border: '1px solid rgba(var(--tm-accent-rgb,0,229,255),0.15)', borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--tm-accent)', marginBottom: 8 }}>{t('predict.xpPotential')}</div>
          {[
            { label: t('predict.xpSubmit'),     xp: '+3 XP',  color: 'var(--tm-text-secondary)' },
            { label: t('predict.xpCorrectDir'), xp: '+5 XP',  color: 'var(--tm-profit)' },
            { label: t('predict.xpAcc1'),       xp: '+8 XP',  color: 'var(--tm-profit)' },
            { label: t('predict.xpAcc05'),      xp: '+15 XP', color: '#FFD700' },
            { label: t('predict.xpAcc01'),      xp: '+30 XP', color: 'var(--tm-purple)' },
          ].map(({ label, xp, color }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--tm-text-muted)' }}>{label}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color, fontFamily: 'JetBrains Mono, monospace' }}>{xp}</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 8, paddingTop: 8, display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-text-primary)' }}>{t('predict.xpMax')}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-purple)', fontFamily: 'JetBrains Mono, monospace' }}>+61 XP</span>
          </div>
        </div>

        {/* Resolve time + countdown */}
        <div style={{
          background: isLocked
            ? 'rgba(244,67,54,0.07)'
            : 'rgba(var(--tm-accent-rgb,0,229,255),0.05)',
          border: `1px solid ${isLocked ? 'rgba(244,67,54,0.3)' : 'rgba(var(--tm-accent-rgb,0,229,255),0.15)'}`,
          borderRadius: 10, padding: '10px 14px',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: isLocked ? 'var(--tm-loss)' : 'var(--tm-accent)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            {isLocked ? t('predict.lockTimerTitle') : t('predict.resolveTimerTitle')}
          </div>
          <div style={{ fontSize: 11, color: 'var(--tm-text-secondary)', marginBottom: 6 }}>
            {fmtTime(resolveDate)}
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: isLocked ? 'var(--tm-loss)' : 'var(--tm-text-primary)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '-0.02em' }}>
            {countdown}
          </div>
          {isLocked && (
            <div style={{ fontSize: 11, color: 'var(--tm-text-muted)', marginTop: 6 }}>
              {t('predict.fairnessNote')}
            </div>
          )}
        </div>

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          style={{
            padding: '14px 0', borderRadius: 12, border: 'none',
            cursor: canSubmit && !submitting ? 'pointer' : 'not-allowed',
            background: isLocked
              ? 'rgba(244,67,54,0.15)'
              : canSubmit
              ? 'var(--tm-accent)'
              : 'var(--tm-border)',
            color: isLocked
              ? 'var(--tm-loss)'
              : canSubmit
              ? 'var(--tm-bg)'
              : 'var(--tm-text-muted)',
            fontSize: 14, fontWeight: 700,
            opacity: submitting ? 0.7 : 1,
            transition: 'all 0.15s',
          }}
        >
          {submitting
            ? t('predict.submitting')
            : isLocked
            ? t('predict.submitLocked')
            : canSubmit
            ? t('predict.submitReady')
            : t('predict.submitSelectAsset')}
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// ONGLET 2 — Mes prédictions
// ═══════════════════════════════════════════════════════════════
function MyPredictionsTab({ uid, onToast, refreshKey, virtualUSDT, onBalanceChange }: {
  uid: string
  onToast: (msg: string) => void
  refreshKey: number
  virtualUSDT: number | null
  onBalanceChange: (delta: number) => void
}) {
  const { t } = useTranslation()
  const [preds, setPreds]         = useState<Prediction[]>([])
  const [loading, setLoading]     = useState(true)
  const [resolving, setResolving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await getUserPredictions(uid)
    setPreds(data)
    setLoading(false)
  }, [uid])

  useEffect(() => { load() }, [load, refreshKey])

  // Auto-résolution au montage
  useEffect(() => {
    const run = async () => {
      setResolving(true)
      const summaries: ResolvedSummary[] = await resolveExpiredPredictions(uid)
      if (summaries.length > 0) {
        // Vérifier nouveaux badges
        const userSnap = await getDoc(doc(db, 'users', uid))
        const d = userSnap.exists() ? userSnap.data() : {}
        const stats = {
          predictionsTotal:       d.predictionsTotal ?? 0,
          predictionsCorrect:     d.predictionsCorrect ?? 0,
          predictionStreak:       d.predictionStreak ?? 0,
          predictionBestAccuracy: d.predictionBestAccuracy ?? 100,
          predictionDailyStreak:  d.predictionDailyStreak ?? 0,
          predictionLastDate:     d.predictionLastDate ?? '',
        }
        const newBadges = await checkAndAwardPredictionBadges(uid, stats)

        // Mettre à jour le solde UI avec la variation totale USDT
        const totalBalanceChange = summaries.reduce((acc, s) => acc + s.balanceChange, 0)
        if (totalBalanceChange !== 0) onBalanceChange(totalBalanceChange)

        for (const s of summaries) {
          const xpMsg = s.xpEarned > 0 ? t('predict.toastXp', { xp: s.xpEarned + 5 }) : ''
          const usdtMsg = s.balanceChange !== 0
            ? t('predict.toastUsdt', { sign: s.balanceChange > 0 ? '+' : '', amount: Math.abs(s.balanceChange).toFixed(0) })
            : ''
          onToast(
            t('predict.toastResolved', {
              emoji: resultEmoji(s.isCorrect, s.accuracy),
              symbol: s.prediction.symbol,
              verdict: s.isCorrect ? t('predict.toastCorrect') : t('predict.toastWrong'),
              accuracy: s.accuracy.toFixed(2),
              xp: xpMsg,
              usdt: usdtMsg,
            })
          )
        }
        if (newBadges.length > 0) {
          onToast(t('predict.toastNewBadge', { badges: newBadges.map(b => b.icon + ' ' + b.name).join(', ') }))
        }
        await load()
      }
      setResolving(false)
    }
    run()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  const pending  = preds.filter(p => p.status === 'pending')
  const resolved = preds.filter(p => p.status !== 'pending')

  // ⚠️ useState doit être avant tout return conditionnel (règle des hooks React)
  const [claiming, setClaiming] = useState(false)

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 48, color: 'var(--tm-text-muted)' }}>
      <div style={{ width: 24, height: 24, border: '2px solid var(--tm-border)', borderTopColor: 'var(--tm-accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      {t('predict.loadingSpinner')}
    </div>
  )

  const handleClaim = async () => {
    setClaiming(true)
    const ok = await claimDailyRefill(uid)
    if (ok) {
      onBalanceChange(200)
      onToast(t('predict.toastClaimed'))
    } else {
      onToast(t('predict.toastAlreadyClaimed'))
    }
    setClaiming(false)
  }

  return (
    <div>
      {/* Bannière recharge (solde bas) */}
      {virtualUSDT != null && virtualUSDT < 50 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,159,10,0.08)', border: '1px solid rgba(255,159,10,0.3)', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
          <span style={{ fontSize: 12, color: '#FF9F0A' }}>{t('predict.lowBalanceBanner', { balance: virtualUSDT })}</span>
          <button onClick={handleClaim} disabled={claiming}
            style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: '#FF9F0A', color: '#000', fontSize: 11, fontWeight: 700, cursor: claiming ? 'default' : 'pointer', opacity: claiming ? 0.7 : 1 }}>
            {claiming ? t('predict.claiming') : t('predict.claimButton')}
          </button>
        </div>
      )}
      {resolving && (
        <div style={{ background: 'rgba(var(--tm-accent-rgb,0,229,255),0.05)', border: '1px solid rgba(var(--tm-accent-rgb,0,229,255),0.2)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--tm-accent)' }}>
          {t('predict.resolvingBanner')}
        </div>
      )}

      {/* Actives */}
      {pending.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-text-primary)', marginBottom: 12 }}>{t('predict.activePredictions', { count: pending.length })}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pending.map(pred => (
              <PredCard key={pred.id} pred={pred} />
            ))}
          </div>
        </div>
      )}

      {/* Résolues */}
      {resolved.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-text-primary)', marginBottom: 12 }}>
            {t('predict.historyTitle', { count: resolved.length })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {resolved.map(pred => (
              <PredCard key={pred.id} pred={pred} />
            ))}
          </div>
        </div>
      )}

      {preds.length === 0 && (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--tm-text-muted)', fontSize: 14 }}>
          {t('predict.noPredictions')}<br />
          <span style={{ fontSize: 12 }}>{t('predict.noPredictionsHint')}</span>
        </div>
      )}
    </div>
  )
}

function PredCard({ pred }: { pred: Prediction }) {
  const { t } = useTranslation()
  const isPending  = pred.status === 'pending'
  const isResolved = pred.status === 'resolved'
  const isExpired  = pred.status === 'expired'

  const dirColor  = pred.direction === 'up' ? 'var(--tm-profit)' : 'var(--tm-loss)'
  const resColor  = isResolved ? (pred.isCorrect ? 'var(--tm-profit)' : 'var(--tm-loss)') : 'var(--tm-text-muted)'

  // Live countdown pour les prédictions actives
  const predLockAt = computeLockAt(pred.resolveAt.toDate())
  const [liveCountdown, setLiveCountdown] = useState(() => isPending ? fmtCountdown(pred.resolveAt, '…') : '')
  const [liveIsLocked, setLiveIsLocked]   = useState(() => isPending && Date.now() >= predLockAt.getTime())
  useEffect(() => {
    if (!isPending) return
    const tick = () => {
      const now  = Date.now()
      const diff = pred.resolveAt.toMillis() - now
      setLiveCountdown(fmtDiff(diff, '…'))
      setLiveIsLocked(now >= predLockAt.getTime() && now < pred.resolveAt.toMillis())
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [isPending, pred.resolveAt, predLockAt])

  return (
    <div style={{
      background: 'var(--tm-bg-secondary)', borderRadius: 12, padding: '12px 16px',
      border: `1px solid ${isResolved ? resColor + '30' : 'var(--tm-border)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Symbol */}
        <div style={{ width: 40, height: 40, borderRadius: 10, background: dirColor + '15', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: dirColor }}>{pred.direction === 'up' ? '▲' : '▼'}</span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--tm-text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>{pred.symbol}</span>
            <span style={{ fontSize: 10, color: dirColor, fontWeight: 600 }}>
              {pred.direction === 'up' ? '▲' : '▼'} {Math.abs(pred.deltaPct).toFixed(2)}%
            </span>
            <span style={{ fontSize: 10, color: 'var(--tm-text-muted)', background: 'var(--tm-bg-tertiary)', padding: '1px 6px', borderRadius: 4 }}>{pred.timeframe}</span>
            {isPending && (
              <span style={{
                fontSize: 10, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
                color: liveIsLocked ? 'var(--tm-loss)' : 'var(--tm-accent)',
                background: liveIsLocked ? 'rgba(244,67,54,0.1)' : 'rgba(var(--tm-accent-rgb,0,229,255),0.08)',
                padding: '1px 6px', borderRadius: 4,
              }}>
                {liveIsLocked ? '🔒' : '⏳'} {liveCountdown}
              </span>
            )}
            {isExpired && (
              <span style={{ fontSize: 10, color: 'var(--tm-text-muted)', background: 'var(--tm-bg-tertiary)', padding: '1px 6px', borderRadius: 4 }}>{t('predict.expired')}</span>
            )}
            {isResolved && pred.xpEarned != null && pred.xpEarned > 0 && (
              <span style={{ fontSize: 10, color: 'var(--tm-profit)', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>+{pred.xpEarned + 5} XP</span>
            )}
          </div>

          {/* Prix */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono, monospace', flexWrap: 'wrap' }}>
            <span>{t('predict.priceBase', { price: fmtPrice(pred.currentPrice) })}</span>
            <span style={{ color: dirColor }}>→ {fmtPrice(pred.predictedPrice)}</span>
            {isResolved && pred.actualPrice != null && (
              <span style={{ color: resColor }}>{t('predict.priceReal', { price: fmtPrice(pred.actualPrice) })}</span>
            )}
            {isPending && (
              <span style={{ color: 'var(--tm-text-muted)', opacity: 0.7 }}>
                {t('predict.resolution', { time: fmtTime(pred.resolveAt.toDate()) })}
              </span>
            )}
          </div>

          {/* Mise USDT (si applicable) */}
          {pred.stake != null && pred.stake > 0 && (
            <div style={{ marginTop: 5, fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
              {isPending && (
                <span style={{ color: '#FF9F0A' }}>
                  {t('predict.stakeLabel')}{pred.stake} USDT{t('predict.stakePotential')}+{(pred.stake * 0.9).toFixed(0)} USDT
                </span>
              )}
              {isResolved && pred.balanceChange != null && pred.balanceChange !== 0 && (
                <span style={{ color: pred.balanceChange > 0 ? 'var(--tm-profit)' : 'var(--tm-loss)', fontWeight: 700 }}>
                  {pred.balanceChange > 0 ? '+' : ''}{pred.balanceChange.toFixed(0)} USDT
                </span>
              )}
            </div>
          )}

          {/* Accuracy bar (si résolu) */}
          {isResolved && pred.accuracy != null && (
            <div style={{ marginTop: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>{resultEmoji(pred.isCorrect ?? false, pred.accuracy)}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ height: 4, background: 'var(--tm-border)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{
                      width: `${Math.min(100, 100 - pred.accuracy * 5)}%`,
                      height: '100%', background: resColor, borderRadius: 2,
                    }} />
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--tm-text-muted)', marginTop: 2 }}>
                    {t('predict.accuracyLabel', {
                      pct: pred.accuracy.toFixed(2),
                      dir: pred.isCorrect ? t('predict.dirCorrect') : t('predict.dirWrong'),
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// ONGLET 3 — Communauté
// ═══════════════════════════════════════════════════════════════
function CommunityTab({ uid }: { uid: string }) {
  const { t } = useTranslation()
  const [preds, setPreds]   = useState<Prediction[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getAllRecentPredictions(300).then(p => { setPreds(p); setLoading(false) })
  }, [])

  const recent = useMemo(() => {
    const cutoff = Date.now() - 86_400_000
    return preds.filter(p => p.createdAt.toMillis() > cutoff)
  }, [preds])

  // Top actifs (dernières 24h)
  const topAssets = useMemo(() => {
    const counts: Record<string, { cnt: number; bull: number }> = {}
    recent.forEach(p => {
      if (!counts[p.symbol]) counts[p.symbol] = { cnt: 0, bull: 0 }
      counts[p.symbol].cnt++
      if (p.direction === 'up') counts[p.symbol].bull++
    })
    return Object.entries(counts)
      .sort((a, b) => b[1].cnt - a[1].cnt)
      .slice(0, 10)
      .map(([sym, { cnt, bull }]) => ({ symbol: sym, cnt, bullPct: Math.round(bull / cnt * 100) }))
  }, [recent])

  // Sentiment global
  const globalBull = recent.length
    ? Math.round(recent.filter(p => p.direction === 'up').length / recent.length * 100)
    : 50

  // Top prévisionnistes (sur prédictions résolues uniquement)
  const topPredictors = useMemo(() => {
    const resolvedPreds = preds.filter(p => p.status === 'resolved' && p.accuracy != null)
    const byUid: Record<string, { cnt: number; correct: number; totalAcc: number; name: string }> = {}
    resolvedPreds.forEach(p => {
      if (!byUid[p.uid]) byUid[p.uid] = { cnt: 0, correct: 0, totalAcc: 0, name: p.displayName ?? '???' }
      byUid[p.uid].cnt++
      if (p.isCorrect) byUid[p.uid].correct++
      byUid[p.uid].totalAcc += p.accuracy ?? 0
    })
    return Object.entries(byUid)
      .filter(([, v]) => v.cnt >= 3)
      .map(([id, v]) => ({ uid: id, name: v.name, cnt: v.cnt, winRate: Math.round(v.correct / v.cnt * 100), avgAcc: v.totalAcc / v.cnt }))
      .sort((a, b) => b.winRate - a.winRate || a.avgAcc - b.avgAcc)
      .slice(0, 10)
  }, [preds])

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 48, color: 'var(--tm-text-muted)' }}>
      <div style={{ width: 24, height: 24, border: '2px solid var(--tm-border)', borderTopColor: 'var(--tm-accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
      {t('predict.loadingSpinner')}
    </div>
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      {/* Sentiment global */}
      <div style={{ gridColumn: '1 / -1', background: 'var(--tm-bg-secondary)', border: '1px solid var(--tm-border)', borderRadius: 12, padding: '16px 20px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-primary)', marginBottom: 12 }}>{t('predict.sentimentTitle')}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-profit)', minWidth: 50 }}>▲ {globalBull}%</span>
          <div style={{ flex: 1, height: 14, background: 'var(--tm-border)', borderRadius: 7, overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', inset: 0, width: `${globalBull}%`, background: 'linear-gradient(90deg, #4CAF50, #00E5FF)', borderRadius: 7, transition: 'width 0.6s' }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-loss)', minWidth: 50, textAlign: 'right' }}>{100 - globalBull}% ▼</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--tm-text-muted)', marginTop: 8 }}>{t('predict.sentimentCount', { count: recent.length })}</div>
      </div>

      {/* Top actifs */}
      <div style={{ background: 'var(--tm-bg-secondary)', border: '1px solid var(--tm-border)', borderRadius: 12, padding: '16px 20px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-primary)', marginBottom: 12 }}>{t('predict.topAssetsTitle')}</div>
        {topAssets.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--tm-text-muted)' }}>{t('predict.noRecentPreds')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {topAssets.map(({ symbol, cnt, bullPct }, idx) => (
              <div key={symbol} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: 'var(--tm-text-muted)', width: 16, textAlign: 'right' }}>#{idx + 1}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-text-primary)', width: 64, fontFamily: 'JetBrains Mono, monospace' }}>{symbol}</span>
                <div style={{ flex: 1, height: 6, background: 'var(--tm-border)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${bullPct}%`, height: '100%', background: bullPct >= 50 ? 'var(--tm-profit)' : 'var(--tm-loss)', borderRadius: 3, transition: 'width 0.4s' }} />
                </div>
                <span style={{ fontSize: 10, color: 'var(--tm-text-muted)', width: 50, textAlign: 'right' }}>{t('predict.predCount', { count: cnt })}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Classement prévisionnistes */}
      <div style={{ background: 'var(--tm-bg-secondary)', border: '1px solid var(--tm-border)', borderRadius: 12, padding: '16px 20px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-primary)', marginBottom: 12 }}>{t('predict.topPredictorsTitle')}</div>
        {topPredictors.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--tm-text-muted)' }}>{t('predict.noData')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {topPredictors.map(({ uid: puid, name, cnt, winRate, avgAcc }, idx) => (
              <div key={puid} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 14 }}>{idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: puid === uid ? 'var(--tm-accent)' : 'var(--tm-text-primary)', flex: 1 }}>
                  {name}{puid === uid ? t('predict.me') : ''}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: winRate >= 60 ? 'var(--tm-profit)' : 'var(--tm-text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>
                  {winRate}%
                </span>
                <span style={{ fontSize: 9, color: 'var(--tm-text-muted)' }}>{t('predict.predCount', { count: cnt })}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// PAGE PRINCIPALE
// ═══════════════════════════════════════════════════════════════
export default function PredictPage() {
  const { t } = useTranslation()
  const user = useUser()
  const [tab, setTab]           = useState<Tab>('predict')
  const [toast, setToast]       = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Stats utilisateur (pour l'en-tête)
  const [userStats, setUserStats] = useState({
    predictionsTotal: 0,
    predictionStreak: 0,
    predictionBestAccuracy: 100,
  })
  const [virtualUSDT, setVirtualUSDT] = useState<number | null>(null)

  useEffect(() => {
    if (!user?.uid) return
    getDoc(doc(db, 'users', user.uid)).then(snap => {
      if (snap.exists()) {
        const d = snap.data()
        setUserStats({
          predictionsTotal:       d.predictionsTotal       ?? 0,
          predictionStreak:       d.predictionStreak       ?? 0,
          predictionBestAccuracy: d.predictionBestAccuracy ?? 100,
        })
      }
    })
    getVirtualBalance(user.uid).then(setVirtualUSDT)
  }, [user?.uid, refreshKey])

  const handleBalanceChange = (delta: number) =>
    setVirtualUSDT(prev => prev != null ? +(prev + delta).toFixed(2) : null)

  if (!user) return null

  const tabs: { id: Tab; label: string }[] = [
    { id: 'predict',   label: t('predict.tabPredict') },
    { id: 'mine',      label: t('predict.tabMine') },
    { id: 'community', label: t('predict.tabCommunity') },
  ]

  return (
    <div style={{ padding: '24px 28px 60px', maxWidth: 1300, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--tm-text-primary)', margin: 0, fontFamily: 'Syne, sans-serif' }}>
            {t('predict.pageTitle')}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--tm-text-secondary)', margin: '3px 0 0' }}>
            {t('predict.pageSubtitle')}
          </p>
        </div>
        {/* Stats rapides */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {[
            { label: t('predict.statVirtualUSDT'), value: virtualUSDT != null ? `${virtualUSDT.toLocaleString('fr-FR')}` : '—', icon: '💰', highlight: virtualUSDT != null && virtualUSDT < 50 },
            { label: t('predict.statPredictions'), value: userStats.predictionsTotal, icon: '🎯', highlight: false },
            { label: t('predict.statStreak'), value: userStats.predictionStreak, icon: '🔥', highlight: false },
            { label: t('predict.statBestAccuracy'), value: userStats.predictionBestAccuracy < 100 ? `${userStats.predictionBestAccuracy.toFixed(1)}%` : '—', icon: '💎', highlight: false },
          ].map(({ label, value, icon, highlight }) => (
            <div key={label} style={{ background: 'var(--tm-bg-secondary)', border: `1px solid ${highlight ? 'rgba(255,159,10,0.4)' : 'var(--tm-border)'}`, borderRadius: 10, padding: '8px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 18 }}>{icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: highlight ? '#FF9F0A' : 'var(--tm-text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>{value ?? '—'}</div>
              <div style={{ fontSize: 9, color: 'var(--tm-text-muted)' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Onglets */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--tm-bg-secondary)', padding: 4, borderRadius: 12, border: '1px solid var(--tm-border)', width: 'fit-content' }}>
        {tabs.map(tabItem => (
          <button key={tabItem.id} onClick={() => setTab(tabItem.id)} style={{
            padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            background: tab === tabItem.id ? 'var(--tm-accent)' : 'transparent',
            color: tab === tabItem.id ? 'var(--tm-bg)' : 'var(--tm-text-secondary)',
            transition: 'all 0.15s',
          }}>
            {tabItem.label}
          </button>
        ))}
      </div>

      {/* Contenu */}
      {tab === 'predict' && (
        <PredictTab
          uid={user.uid}
          displayName={user.displayName ?? undefined}
          onToast={msg => { setToast(msg) }}
          onPredictionCreated={() => setRefreshKey(k => k + 1)}
          virtualUSDT={virtualUSDT}
          onBalanceChange={handleBalanceChange}
        />
      )}
      {tab === 'mine' && (
        <MyPredictionsTab
          uid={user.uid}
          onToast={msg => setToast(msg)}
          refreshKey={refreshKey}
          virtualUSDT={virtualUSDT}
          onBalanceChange={handleBalanceChange}
        />
      )}
      {tab === 'community' && (
        <CommunityTab uid={user.uid} />
      )}

      {/* Toast */}
      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}
    </div>
  )
}
