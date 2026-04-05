// src/pages/predict/PredictPage.tsx — Predict & Earn

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useUser } from '@/hooks/useAuth'
import { callAwardXP } from '@/services/gamification/prestigeEngine'
import {
  createPrediction, getUserPredictions, getCommunityPredictions, getAllRecentPredictions,
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
const TF_LABEL: Record<PredictionTimeframe, string> = {
  '1h': '1 heure', '4h': '4 heures', '24h': '24 heures', '3d': '3 jours', '7d': '7 jours',
}

// Top crypto symbols (subset pour facilité de sélection)
const CRYPTO_SYMBOLS = [
  'BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOT','MATIC','LINK',
  'UNI','ATOM','LTC','BCH','NEAR','ARB','OP','INJ','TIA','APT',
  'SUI','SEI','JTO','PYTH','WIF','DOGE','SHIB','PEPE','WLD','FET',
]

// Stocks (subset représentatif)
const STOCK_SYMBOLS = [
  'AAPL','MSFT','NVDA','GOOGL','META','AMZN','TSLA','AMD','COIN','NFLX',
  'JPM','GS','V','MA','SPY','QQQ','BNP.PA','TTE.PA','MC.PA','AIR.PA',
  'SAP.DE','ASML.AS','NESN.SW','NOVO-B.CO','TSM','BABA','TM','NVO','SHOP','RY',
]

type Tab = 'predict' | 'mine' | 'community'
type AssetType = 'crypto' | 'stock'

// ── Helpers ────────────────────────────────────────────────────
function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (n >= 1)    return n.toLocaleString('fr-FR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 6, maximumFractionDigits: 8 })
}

function fmtCountdown(resolveAt: Timestamp): string {
  const diff = resolveAt.toMillis() - Date.now()
  if (diff <= 0) return 'En cours de résolution…'
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  if (h > 24) return `${Math.floor(h / 24)}j ${h % 24}h`
  if (h > 0)  return `${h}h ${m}m`
  return `${m}m`
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
  if (preds.length < 2) return (
    <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--tm-text-muted)', fontSize: 12 }}>
      Pas encore assez de prédictions pour afficher la distribution
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
        {preds.length} prédiction{preds.length > 1 ? 's' : ''} · moy. {fmtPrice(prices.reduce((a, b) => a + b, 0) / prices.length)}
      </div>
    </div>
  )
}

// ── Toast simple ───────────────────────────────────────────────
function Toast({ msg, onClose }: { msg: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500)
    return () => clearTimeout(t)
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
function PredictTab({ uid, displayName, onToast, onPredictionCreated }: {
  uid: string
  displayName?: string
  onToast: (msg: string) => void
  onPredictionCreated: () => void
}) {
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

  const symbols = assetType === 'crypto' ? CRYPTO_SYMBOLS : STOCK_SYMBOLS
  const filtered = search
    ? symbols.filter(s => s.toLowerCase().includes(search.toLowerCase()))
    : symbols

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
  const canSubmit = !priceLoading && currentPrice !== null && !isNaN(numPredicted) && numPredicted > 0

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      // Re-fetch le prix pour le lock
      const lockedPrice = assetType === 'crypto'
        ? await fetchCryptoPrice(symbol)
        : await fetchStockPrice(symbol)
      if (!lockedPrice) throw new Error('Impossible de récupérer le prix')

      const resolveAt = Timestamp.fromMillis(Date.now() + TF_MS[timeframe])
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
      })

      // +5 XP pour la soumission
      await callAwardXP(5, 'prediction_submit')

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
      if (newBadges.length > 0) {
        onToast(`🏆 Badge${newBadges.length > 1 ? 's' : ''} débloqué${newBadges.length > 1 ? 's' : ''} : ${newBadges.map(b => b.icon + ' ' + b.name).join(', ')}`)
      } else {
        onToast(`✅ Prédiction soumise · +5 XP · Résolution dans ${TF_LABEL[timeframe]}`)
      }
      onPredictionCreated()
    } catch (e) {
      onToast(`❌ Erreur : ${(e as Error).message}`)
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
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tm-text-muted)', marginBottom: 10 }}>TYPE D'ACTIF</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['crypto', 'stock'] as AssetType[]).map(t => (
              <button key={t} onClick={() => { setAssetType(t); setSymbol(t === 'crypto' ? 'BTC' : 'AAPL'); setSearch('') }} style={{
                flex: 1, padding: '8px 0', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                border: `1px solid ${assetType === t ? 'var(--tm-accent)' : 'var(--tm-border)'}`,
                background: assetType === t ? 'rgba(var(--tm-accent-rgb,0,229,255),0.12)' : 'var(--tm-bg-tertiary)',
                color: assetType === t ? 'var(--tm-accent)' : 'var(--tm-text-secondary)',
              }}>
                {t === 'crypto' ? '₿ Crypto' : '📈 Actions'}
              </button>
            ))}
          </div>
        </div>

        {/* Asset selector */}
        <div style={{ background: 'var(--tm-bg-secondary)', border: '1px solid var(--tm-border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tm-text-muted)', marginBottom: 10 }}>ACTIF</div>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher…"
            style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--tm-border)', background: 'var(--tm-bg-tertiary)', color: 'var(--tm-text-primary)', fontSize: 13, outline: 'none', marginBottom: 10, boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 120, overflowY: 'auto' }}>
            {filtered.map(s => (
              <button key={s} onClick={() => { setSymbol(s); setSearch('') }} style={{
                padding: '4px 10px', borderRadius: 20, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                border: `1px solid ${symbol === s ? 'var(--tm-accent)' : 'var(--tm-border)'}`,
                background: symbol === s ? 'rgba(var(--tm-accent-rgb,0,229,255),0.12)' : 'var(--tm-bg-tertiary)',
                color: symbol === s ? 'var(--tm-accent)' : 'var(--tm-text-secondary)',
              }}>{s}</button>
            ))}
          </div>
        </div>

        {/* Timeframe */}
        <div style={{ background: 'var(--tm-bg-secondary)', border: '1px solid var(--tm-border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tm-text-muted)', marginBottom: 10 }}>HORIZON DE PRÉDICTION</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {TIMEFRAMES.map(tf => (
              <button key={tf} onClick={() => setTimeframe(tf)} style={{
                flex: 1, minWidth: 60, padding: '7px 4px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                border: `1px solid ${timeframe === tf ? 'var(--tm-accent)' : 'var(--tm-border)'}`,
                background: timeframe === tf ? 'rgba(var(--tm-accent-rgb,0,229,255),0.12)' : 'var(--tm-bg-tertiary)',
                color: timeframe === tf ? 'var(--tm-accent)' : 'var(--tm-text-secondary)',
              }}>{tf}</button>
            ))}
          </div>
        </div>

        {/* Prix actuel + saisie */}
        <div style={{ background: 'var(--tm-bg-secondary)', border: '1px solid var(--tm-border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tm-text-muted)' }}>PRIX ACTUEL — {symbol}</div>
            {priceLoading
              ? <div style={{ fontSize: 12, color: 'var(--tm-text-muted)' }}>Chargement…</div>
              : currentPrice !== null
              ? <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--tm-text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>{fmtPrice(currentPrice)}</div>
              : <div style={{ fontSize: 12, color: 'var(--tm-loss)' }}>Indisponible</div>
            }
          </div>

          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tm-text-muted)', marginBottom: 8 }}>MA PRÉDICTION DANS {TF_LABEL[timeframe].toUpperCase()}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="number"
              value={predictedPrice}
              onChange={e => setPredictedPrice(e.target.value)}
              placeholder="Prix prédit…"
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
            <span>🌍</span> Communauté — {symbol} · {timeframe}
          </div>
          {commLoading ? (
            <div style={{ fontSize: 12, color: 'var(--tm-text-muted)', textAlign: 'center', padding: '10px 0' }}>Chargement…</div>
          ) : (
            <PredictionHistogram preds={communityPreds} currentPrice={currentPrice} />
          )}
        </div>

        {/* XP preview card */}
        <div style={{ background: 'linear-gradient(135deg, rgba(var(--tm-accent-rgb,0,229,255),0.06), rgba(191,90,242,0.06))', border: '1px solid rgba(var(--tm-accent-rgb,0,229,255),0.15)', borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--tm-accent)', marginBottom: 8 }}>⚡ XP potentiel</div>
          {[
            { label: 'Soumission', xp: '+5 XP', color: 'var(--tm-text-secondary)' },
            { label: 'Direction correcte', xp: '+20 XP', color: 'var(--tm-profit)' },
            { label: 'Précision ≤5%', xp: '+50 XP', color: 'var(--tm-profit)' },
            { label: 'Précision ≤2%', xp: '+100 XP', color: '#FFD700' },
            { label: 'Précision ≤1%', xp: '+200 XP', color: 'var(--tm-purple)' },
          ].map(({ label, xp, color }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--tm-text-muted)' }}>{label}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color, fontFamily: 'JetBrains Mono, monospace' }}>{xp}</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 8, paddingTop: 8, display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-text-primary)' }}>Max possible</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-purple)', fontFamily: 'JetBrains Mono, monospace' }}>+375 XP</span>
          </div>
        </div>

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          style={{
            padding: '14px 0', borderRadius: 12, border: 'none', cursor: canSubmit && !submitting ? 'pointer' : 'not-allowed',
            background: canSubmit ? 'var(--tm-accent)' : 'var(--tm-border)',
            color: canSubmit ? 'var(--tm-bg)' : 'var(--tm-text-muted)',
            fontSize: 14, fontWeight: 700,
            opacity: submitting ? 0.7 : 1,
            transition: 'all 0.15s',
          }}
        >
          {submitting ? 'Envoi…' : canSubmit ? `🎯 Soumettre ma prédiction · +5 XP` : 'Sélectionne un actif et un prix'}
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// ONGLET 2 — Mes prédictions
// ═══════════════════════════════════════════════════════════════
function MyPredictionsTab({ uid, onToast, refreshKey }: {
  uid: string
  onToast: (msg: string) => void
  refreshKey: number
}) {
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

        for (const s of summaries) {
          const xpMsg = s.xpEarned > 0 ? ` · +${s.xpEarned + 5} XP` : ''
          onToast(
            `${resultEmoji(s.isCorrect, s.accuracy)} ${s.prediction.symbol} résolu — ` +
            `${s.isCorrect ? 'Correct ✓' : 'Incorrect ✗'} · Précision ${s.accuracy.toFixed(2)}%${xpMsg}`,
          )
        }
        if (newBadges.length > 0) {
          onToast(`🏆 Nouveau badge : ${newBadges.map(b => b.icon + ' ' + b.name).join(', ')}`)
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

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 48, color: 'var(--tm-text-muted)' }}>
      <div style={{ width: 24, height: 24, border: '2px solid var(--tm-border)', borderTopColor: 'var(--tm-accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      Chargement…
    </div>
  )

  return (
    <div>
      {resolving && (
        <div style={{ background: 'rgba(var(--tm-accent-rgb,0,229,255),0.05)', border: '1px solid rgba(var(--tm-accent-rgb,0,229,255),0.2)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--tm-accent)' }}>
          ⏳ Résolution des prédictions expirées en cours…
        </div>
      )}

      {/* Actives */}
      {pending.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-text-primary)', marginBottom: 12 }}>⏳ Prédictions actives ({pending.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pending.map(p => (
              <PredCard key={p.id} pred={p} />
            ))}
          </div>
        </div>
      )}

      {/* Résolues */}
      {resolved.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-text-primary)', marginBottom: 12 }}>
            ✅ Historique ({resolved.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {resolved.map(p => (
              <PredCard key={p.id} pred={p} />
            ))}
          </div>
        </div>
      )}

      {preds.length === 0 && (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--tm-text-muted)', fontSize: 14 }}>
          Aucune prédiction pour l'instant.<br />
          <span style={{ fontSize: 12 }}>Rendez-vous dans l'onglet 🎯 Prédire !</span>
        </div>
      )}
    </div>
  )
}

function PredCard({ pred }: { pred: Prediction }) {
  const isPending  = pred.status === 'pending'
  const isResolved = pred.status === 'resolved'
  const isExpired  = pred.status === 'expired'

  const dirColor  = pred.direction === 'up' ? 'var(--tm-profit)' : 'var(--tm-loss)'
  const resColor  = isResolved ? (pred.isCorrect ? 'var(--tm-profit)' : 'var(--tm-loss)') : 'var(--tm-text-muted)'

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
              <span style={{ fontSize: 10, color: 'var(--tm-accent)', background: 'rgba(var(--tm-accent-rgb,0,229,255),0.08)', padding: '1px 6px', borderRadius: 4 }}>
                ⏳ {fmtCountdown(pred.resolveAt)}
              </span>
            )}
            {isExpired && (
              <span style={{ fontSize: 10, color: 'var(--tm-text-muted)', background: 'var(--tm-bg-tertiary)', padding: '1px 6px', borderRadius: 4 }}>Expiré</span>
            )}
            {isResolved && pred.xpEarned != null && pred.xpEarned > 0 && (
              <span style={{ fontSize: 10, color: 'var(--tm-profit)', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>+{pred.xpEarned + 5} XP</span>
            )}
          </div>

          {/* Prix */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
            <span>Base: {fmtPrice(pred.currentPrice)}</span>
            <span style={{ color: dirColor }}>→ {fmtPrice(pred.predictedPrice)}</span>
            {isResolved && pred.actualPrice != null && (
              <span style={{ color: resColor }}>Réel: {fmtPrice(pred.actualPrice)}</span>
            )}
          </div>

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
                    Précision: {pred.accuracy.toFixed(2)}% d'écart · {pred.isCorrect ? 'Bonne direction ✓' : 'Mauvaise direction ✗'}
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
      .map(([symbol, { cnt, bull }]) => ({ symbol, cnt, bullPct: Math.round(bull / cnt * 100) }))
  }, [recent])

  // Sentiment global
  const globalBull = recent.length
    ? Math.round(recent.filter(p => p.direction === 'up').length / recent.length * 100)
    : 50

  // Top prévisionnistes (sur prédictions résolues uniquement)
  const topPredictors = useMemo(() => {
    const resolved = preds.filter(p => p.status === 'resolved' && p.accuracy != null)
    const byUid: Record<string, { cnt: number; correct: number; totalAcc: number; name: string }> = {}
    resolved.forEach(p => {
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
      Chargement…
    </div>
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      {/* Sentiment global */}
      <div style={{ gridColumn: '1 / -1', background: 'var(--tm-bg-secondary)', border: '1px solid var(--tm-border)', borderRadius: 12, padding: '16px 20px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-primary)', marginBottom: 12 }}>🌡️ Sentiment communautaire (24h)</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-profit)', minWidth: 50 }}>▲ {globalBull}%</span>
          <div style={{ flex: 1, height: 14, background: 'var(--tm-border)', borderRadius: 7, overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', inset: 0, width: `${globalBull}%`, background: 'linear-gradient(90deg, #4CAF50, #00E5FF)', borderRadius: 7, transition: 'width 0.6s' }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-loss)', minWidth: 50, textAlign: 'right' }}>{100 - globalBull}% ▼</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--tm-text-muted)', marginTop: 8 }}>{recent.length} prédiction{recent.length > 1 ? 's' : ''} dans les dernières 24h</div>
      </div>

      {/* Top actifs */}
      <div style={{ background: 'var(--tm-bg-secondary)', border: '1px solid var(--tm-border)', borderRadius: 12, padding: '16px 20px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-primary)', marginBottom: 12 }}>🔥 Actifs les plus prédits (24h)</div>
        {topAssets.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--tm-text-muted)' }}>Aucune prédiction récente</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {topAssets.map(({ symbol, cnt, bullPct }, idx) => (
              <div key={symbol} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: 'var(--tm-text-muted)', width: 16, textAlign: 'right' }}>#{idx + 1}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-text-primary)', width: 64, fontFamily: 'JetBrains Mono, monospace' }}>{symbol}</span>
                <div style={{ flex: 1, height: 6, background: 'var(--tm-border)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${bullPct}%`, height: '100%', background: bullPct >= 50 ? 'var(--tm-profit)' : 'var(--tm-loss)', borderRadius: 3, transition: 'width 0.4s' }} />
                </div>
                <span style={{ fontSize: 10, color: 'var(--tm-text-muted)', width: 50, textAlign: 'right' }}>{cnt} pred.</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Classement prévisionnistes */}
      <div style={{ background: 'var(--tm-bg-secondary)', border: '1px solid var(--tm-border)', borderRadius: 12, padding: '16px 20px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-primary)', marginBottom: 12 }}>🏆 Meilleurs prévisionnistes</div>
        {topPredictors.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--tm-text-muted)' }}>Pas encore assez de données</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {topPredictors.map(({ uid: puid, name, cnt, winRate, avgAcc }, idx) => (
              <div key={puid} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 14 }}>{idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: puid === uid ? 'var(--tm-accent)' : 'var(--tm-text-primary)', flex: 1 }}>
                  {name}{puid === uid ? ' (moi)' : ''}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: winRate >= 60 ? 'var(--tm-profit)' : 'var(--tm-text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>
                  {winRate}%
                </span>
                <span style={{ fontSize: 9, color: 'var(--tm-text-muted)' }}>{cnt} pred.</span>
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
  }, [user?.uid, refreshKey])

  if (!user) return null

  const tabs: { id: Tab; label: string }[] = [
    { id: 'predict',   label: '🎯 Prédire' },
    { id: 'mine',      label: '📋 Mes prédictions' },
    { id: 'community', label: '🌍 Communauté' },
  ]

  return (
    <div style={{ padding: '24px 28px 60px', maxWidth: 1300, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--tm-text-primary)', margin: 0, fontFamily: 'Syne, sans-serif' }}>
            Predict & Earn
          </h1>
          <p style={{ fontSize: 13, color: 'var(--tm-text-secondary)', margin: '3px 0 0' }}>
            Prédis les prix · Gagne de l'XP · Compare-toi à la communauté
          </p>
        </div>
        {/* Stats rapides */}
        <div style={{ display: 'flex', gap: 12 }}>
          {[
            { label: 'Prédictions', value: userStats.predictionsTotal, icon: '🎯' },
            { label: 'Streak correct', value: userStats.predictionStreak, icon: '🔥' },
            { label: 'Meilleure précision', value: userStats.predictionBestAccuracy < 100 ? `${userStats.predictionBestAccuracy.toFixed(1)}%` : '—', icon: '💎' },
          ].map(({ label, value, icon }) => (
            <div key={label} style={{ background: 'var(--tm-bg-secondary)', border: '1px solid var(--tm-border)', borderRadius: 10, padding: '8px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 18 }}>{icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--tm-text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>{value}</div>
              <div style={{ fontSize: 9, color: 'var(--tm-text-muted)' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Onglets */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--tm-bg-secondary)', padding: 4, borderRadius: 12, border: '1px solid var(--tm-border)', width: 'fit-content' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            background: tab === t.id ? 'var(--tm-accent)' : 'transparent',
            color: tab === t.id ? 'var(--tm-bg)' : 'var(--tm-text-secondary)',
            transition: 'all 0.15s',
          }}>
            {t.label}
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
        />
      )}
      {tab === 'mine' && (
        <MyPredictionsTab
          uid={user.uid}
          onToast={msg => setToast(msg)}
          refreshKey={refreshKey}
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
