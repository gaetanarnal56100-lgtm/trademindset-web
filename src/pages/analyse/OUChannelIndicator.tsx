// OUChannelIndicator.tsx — v3 (UX overhaul)
// Canal Adaptatif Ornstein-Uhlenbeck + Détecteur d'Excès Statistiques
// VMC enrichi avec Efficiency Ratio de Kaufman (ER)
// Inspiré des indicateurs OU Trend Channel Pro et MRE-VWAP

import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchCandles } from './OscillatorCharts'
import type { } from './OscillatorCharts'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Candle { o: number; h: number; l: number; c: number; v: number; t: number; bv?: number }

interface OUResult {
  mean:        number[]
  upper1:      number[]
  upper2:      number[]
  lower1:      number[]
  lower2:      number[]
  zscore:      number[]
  kappa:       number[]
  sigma:       number[]
  excess:      ('none' | 'overbought' | 'oversold' | 'extreme_ob' | 'extreme_os')[]
  regime:      ('trending' | 'ranging' | 'breakout')[]
}

interface KaufmanERResult {
  er:          number[]
  fastAlpha:   number
  erSmoothed:  number[]
}

interface VMCEnhancedResult {
  sig:         number[]
  sigSignal:   number[]
  momentum:    number[]
  er:          number[]
  erSmoothed:  number[]
  status:      string
  statusColor: string
  excessLevel: number
  erQuality:   'strong' | 'moderate' | 'weak'
  erColor:     string
  confluence:  number
  trendBias:   'bullish' | 'bearish' | 'neutral'
}

interface SignalEntry {
  time: string
  label: string
  color: string
  excess: string
}

interface HoverData {
  x: number
  idx: number
  z: number
  excess: string
  price: number
}

// ─── Confluence Brain ─────────────────────────────────────────────────────────
interface ConfluenceState {
  ouBias:        'bull' | 'bear' | 'neutral'
  ouStrength:    'strong' | 'moderate' | 'weak'
  vmcBias:       'bull' | 'bear' | 'neutral'
  vmcStrength:   'strong' | 'moderate' | 'weak'
  cvdBias:       'bull' | 'bear' | 'neutral' | null  // null if non-crypto
  cvdDivergence: boolean
  cvdArr:        number[]  // normalized sparkline
  signal:        'long' | 'short' | 'absorption' | 'trap' | 'setup_long' | 'setup_short' | 'neutral'
  confidence:    number   // aligned signals count
  total:         number   // max possible score
  reason:        string
}

function computeCVD(candles: Candle[], lookback = 30): { bias: 'bull'|'bear'|'neutral'; divergence: boolean; arr: number[] } {
  if (candles.length < 5) return { bias: 'neutral', divergence: false, arr: [] }
  const slice = candles.slice(-lookback)
  let cum = 0
  const arr: number[] = []
  for (const c of slice) {
    const range = c.h - c.l
    const buyFrac = range > 0 ? (c.c - c.l) / range : 0.5
    const buyVol = c.bv != null ? c.bv : c.v * buyFrac
    cum += buyVol - (c.v - buyVol)
    arr.push(cum)
  }
  // normalize for sparkline
  const mn = Math.min(...arr), mx = Math.max(...arr), rng = mx - mn || 1
  const norm = arr.map(v => (v - mn) / rng)
  // trend: last 6 avg vs prev 6 avg
  const half = Math.max(3, Math.floor(arr.length / 4))
  const late = arr.slice(-half).reduce((a, b) => a + b, 0) / half
  const prev = arr.slice(-half * 2, -half).reduce((a, b) => a + b, 0) / half
  const bias: 'bull'|'bear'|'neutral' = late > prev * 1.01 ? 'bull' : late < prev * 0.99 ? 'bear' : 'neutral'
  // divergence: price direction vs CVD direction
  const priceTrend = slice[slice.length - 1].c > slice[0].c
  const cvdTrend   = arr[arr.length - 1] > arr[0]
  const divergence = priceTrend !== cvdTrend
  return { bias, divergence, arr: norm }
}

function computeConfluence(
  ou: OUResult, vmc: VMCEnhancedResult, candles: Candle[], isCrypto: boolean
): ConfluenceState {
  const n = candles.length
  if (n < 20) return {
    ouBias:'neutral', ouStrength:'weak', vmcBias:'neutral', vmcStrength:'weak',
    cvdBias:null, cvdDivergence:false, cvdArr:[], signal:'neutral', confidence:0, total:2, reason:'Données insuffisantes'
  }

  // ── OU bias ────────────────────────────────────────────────────────────────
  const exLast = ou.excess[ou.excess.length - 1] ?? 'none'
  const zLast  = ou.zscore[ou.zscore.length - 1] ?? 0
  const ouBias: 'bull'|'bear'|'neutral' =
    (exLast === 'oversold' || exLast === 'extreme_os') ? 'bull'
    : (exLast === 'overbought' || exLast === 'extreme_ob') ? 'bear'
    : zLast < -0.7 ? 'bull' : zLast > 0.7 ? 'bear' : 'neutral'
  const ouStrength: 'strong'|'moderate'|'weak' =
    exLast.includes('extreme') ? 'strong' : exLast !== 'none' ? 'moderate' : 'weak'

  // ── VMC bias ───────────────────────────────────────────────────────────────
  const sigLast = vmc.sig[vmc.sig.length - 1] ?? 0
  const sslLast = vmc.sigSignal[vmc.sigSignal.length - 1] ?? 0
  const momLast = vmc.momentum[vmc.momentum.length - 1] ?? 0
  const vmcBias: 'bull'|'bear'|'neutral' =
    (vmc.trendBias === 'bullish' && (momLast > 0 || sigLast > sslLast)) ? 'bull'
    : (vmc.trendBias === 'bearish' && (momLast < 0 || sigLast < sslLast)) ? 'bear'
    : sigLast > sslLast && momLast > 0 ? 'bull'
    : sigLast < sslLast && momLast < 0 ? 'bear' : 'neutral'
  const vmcStrength: 'strong'|'moderate'|'weak' = vmc.erQuality

  // ── CVD (crypto only) ──────────────────────────────────────────────────────
  let cvdBias: 'bull'|'bear'|'neutral'|null = null
  let cvdDivergence = false
  let cvdArr: number[] = []
  if (isCrypto) {
    const cvd = computeCVD(candles, 40)
    cvdBias = cvd.bias; cvdDivergence = cvd.divergence; cvdArr = cvd.arr
  }

  // ── Score & signal ─────────────────────────────────────────────────────────
  const all = [ouBias, vmcBias, ...(cvdBias ? [cvdBias] : [])]
  const bulls = all.filter(s => s === 'bull').length
  const bears = all.filter(s => s === 'bear').length
  const total = all.length

  let signal: ConfluenceState['signal'] = 'neutral'
  let confidence = 0
  let reason = ''

  if (bulls === total)      { signal = 'long';        confidence = total;  reason = `${total}/${total} signaux alignés — setup propre` }
  else if (bears === total) { signal = 'short';       confidence = total;  reason = `${total}/${total} signaux alignés — setup propre` }
  else if (bulls >= 2 && cvdBias === 'bear' && cvdDivergence)
    { signal = 'absorption'; confidence = 2; reason = 'Structure bullish MAIS CVD diverge — smart money possible' }
  else if (bears >= 2 && cvdBias === 'bull' && cvdDivergence)
    { signal = 'trap';       confidence = 2; reason = 'Structure bearish MAIS CVD diverge — piège possible' }
  else if (bulls >= 2)      { signal = 'setup_long';  confidence = bulls;  reason = `${bulls}/${total} signaux bull — en attente de confirmation` }
  else if (bears >= 2)      { signal = 'setup_short'; confidence = bears;  reason = `${bears}/${total} signaux bear — en attente de confirmation` }
  else                       { signal = 'neutral';     confidence = 0;      reason = 'Signaux mixtes ou neutres — attendre' }

  return { ouBias, ouStrength, vmcBias, vmcStrength, cvdBias, cvdDivergence, cvdArr, signal, confidence, total, reason }
}

const CONF_CONFIG: Record<ConfluenceState['signal'], { emoji: string; label: string; color: string; glow: string }> = {
  long:        { emoji: '🟢', label: 'LONG CONFIRMÉ',       color: '#34C759', glow: '52,199,89'  },
  short:       { emoji: '🔴', label: 'SHORT CONFIRMÉ',      color: '#FF3B30', glow: '255,59,48'  },
  absorption:  { emoji: '⚠️', label: 'ABSORPTION / PIÈGE',  color: '#FF9500', glow: '255,149,0'  },
  trap:        { emoji: '⚠️', label: 'PIÈGE BAISSIER',      color: '#FF9500', glow: '255,149,0'  },
  setup_long:  { emoji: '🟡', label: 'SETUP LONG',          color: '#FFD60A', glow: '255,214,10' },
  setup_short: { emoji: '🟡', label: 'SETUP SHORT',         color: '#FFD60A', glow: '255,214,10' },
  neutral:     { emoji: '⚫', label: 'NEUTRE',              color: '#8E8E93', glow: '142,142,147' },
}

function CVDSparkline({ arr, color }: { arr: number[]; color: string }) {
  if (arr.length < 2) return null
  const W = 100, H = 28
  const pts = arr.map((v, i) => `${(i / (arr.length - 1)) * W},${H - v * H}`).join(' ')
  const last = arr[arr.length - 1]
  const fillPts = `0,${H} ${pts} ${W},${H}`
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="cvdgrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={fillPts} fill="url(#cvdgrad)" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={(arr.length - 1) / (arr.length - 1) * W} cy={H - last * H} r={2.5} fill={color} />
    </svg>
  )
}

function ConfluenceView({ ou, vmc, candles, isCrypto }: { ou: OUResult; vmc: VMCEnhancedResult; candles: Candle[]; isCrypto: boolean }) {
  const state = computeConfluence(ou, vmc, candles, isCrypto)
  const cfg = CONF_CONFIG[state.signal]

  const biasColor = (b: 'bull'|'bear'|'neutral'|null) =>
    b === 'bull' ? '#34C759' : b === 'bear' ? '#FF3B30' : '#8E8E93'
  const biasEmoji = (b: 'bull'|'bear'|'neutral'|null) =>
    b === 'bull' ? '↑' : b === 'bear' ? '↓' : '—'
  const biasLabel = (b: 'bull'|'bear'|'neutral'|null) =>
    b === 'bull' ? 'Haussier' : b === 'bear' ? 'Baissier' : 'Neutre'

  const pillStyle = (active: boolean, color: string): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3px 8px', borderRadius: 8, fontSize: 10, fontWeight: 600,
    background: active ? `rgba(${color},0.18)` : 'rgba(255,255,255,0.04)',
    border: `1px solid rgba(${color},${active ? 0.5 : 0.12})`,
    color: active ? `rgb(${color})` : 'var(--tm-text-muted)',
  })

  const zLast    = ou.zscore[ou.zscore.length - 1] ?? 0
  const erLast   = vmc.erSmoothed[vmc.erSmoothed.length - 1] ?? 0
  const momLast  = vmc.momentum[vmc.momentum.length - 1] ?? 0
  const exLast   = ou.excess[ou.excess.length - 1] ?? 'none'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0' }}>

      {/* ── Main signal ─────────────────────────────────────────────────── */}
      <div style={{
        padding: '18px 20px', borderRadius: 14, textAlign: 'center' as const,
        background: `linear-gradient(135deg, rgba(${cfg.glow},0.08), rgba(${cfg.glow},0.03))`,
        border: `1px solid rgba(${cfg.glow},0.3)`,
        boxShadow: `0 0 32px rgba(${cfg.glow},0.12)`,
      }}>
        <div style={{ fontSize: 32, marginBottom: 6 }}>{cfg.emoji}</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: cfg.color, fontFamily: 'Syne, sans-serif', letterSpacing: '0.04em' }}>
          {cfg.label}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}>
          {state.reason}
        </div>
        {/* Confidence dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 10 }}>
          {Array.from({ length: state.total }, (_, i) => (
            <div key={i} style={{
              width: 10, height: 10, borderRadius: '50%',
              background: i < state.confidence ? cfg.color : 'rgba(255,255,255,0.1)',
              boxShadow: i < state.confidence ? `0 0 6px ${cfg.color}80` : 'none',
              transition: 'all 0.3s',
            }} />
          ))}
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'JetBrains Mono', marginLeft: 4, alignSelf: 'center' }}>
            {state.confidence}/{state.total}
          </span>
        </div>
      </div>

      {/* ── 3-column breakdown ──────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: isCrypto ? '1fr 1fr 1fr' : '1fr 1fr', gap: 8 }}>

        {/* Canal OU */}
        <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(0,229,255,0.04)', border: `1px solid rgba(0,229,255,0.12)` }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(0,229,255,0.6)', fontFamily: 'JetBrains Mono', textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 6 }}>
            〜 Canal OU
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: biasColor(state.ouBias) }}>{biasEmoji(state.ouBias)}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: biasColor(state.ouBias) }}>{biasLabel(state.ouBias)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={pillStyle(state.ouStrength !== 'weak', '0,229,255')}>
              Z {zLast >= 0 ? '+' : ''}{zLast.toFixed(2)}σ
            </div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', fontFamily: 'JetBrains Mono', marginTop: 2 }}>
              {exLast === 'none' ? 'Zone neutre' : exLast.replace(/_/g,' ').replace('ob','surachat').replace('os','survente').replace('extreme','extrême')}
            </div>
          </div>
        </div>

        {/* CVD (crypto only) */}
        {isCrypto && (
          <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(255,214,10,0.03)', border: `1px solid rgba(255,214,10,0.12)` }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,214,10,0.6)', fontFamily: 'JetBrains Mono', textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 6 }}>
              📊 CVD
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: biasColor(state.cvdBias) }}>{biasEmoji(state.cvdBias)}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: biasColor(state.cvdBias) }}>{biasLabel(state.cvdBias)}</span>
            </div>
            {state.cvdArr.length > 0 && <CVDSparkline arr={state.cvdArr} color={biasColor(state.cvdBias)} />}
            {state.cvdDivergence && (
              <div style={{ marginTop: 4, fontSize: 9, color: '#FF9500', fontFamily: 'JetBrains Mono', fontWeight: 600 }}>
                ⚡ Divergence détectée
              </div>
            )}
          </div>
        )}

        {/* VMC + ER */}
        <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(191,90,242,0.04)', border: `1px solid rgba(191,90,242,0.12)` }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(191,90,242,0.6)', fontFamily: 'JetBrains Mono', textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 6 }}>
            ≋ VMC + ER
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: biasColor(state.vmcBias) }}>{biasEmoji(state.vmcBias)}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: biasColor(state.vmcBias) }}>{biasLabel(state.vmcBias)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={pillStyle(erLast > 0.4, '191,90,242')}>
              ER {(erLast * 100).toFixed(0)}% — {vmc.erQuality === 'strong' ? 'Fort' : vmc.erQuality === 'moderate' ? 'Modéré' : 'Faible'}
            </div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', fontFamily: 'JetBrains Mono', marginTop: 2 }}>
              Mom {momLast >= 0 ? '+' : ''}{momLast.toFixed(1)}
            </div>
          </div>
        </div>
      </div>

      {/* ── Context legend ──────────────────────────────────────────────── */}
      <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', fontSize: 10, color: 'rgba(255,255,255,0.35)', lineHeight: 1.7, fontFamily: 'JetBrains Mono' }}>
        <span style={{ color: '#34C759' }}>🟢 Long</span>{' : '}Z &lt; −1σ · VMC bull · CVD ↑
        {' · '}
        <span style={{ color: '#FF3B30' }}>🔴 Short</span>{' : '}Z &gt; +1σ · VMC bear · CVD ↓
        {' · '}
        <span style={{ color: '#FF9500' }}>⚠️ Absorption</span>{' : '}Structure ≠ CVD (order flow diverge)
      </div>
    </div>
  )
}

// ─── Natural language helpers ─────────────────────────────────────────────────
function naturalZ(z: number): string {
  if (z > 2.5)  return 'Surévaluation extrême'
  if (z > 1.5)  return 'Surévaluation modérée'
  if (z > 0.5)  return 'Légèrement surévalué'
  if (z > -0.5) return 'Zone d\'équilibre'
  if (z > -1.5) return 'Légèrement sous-évalué'
  if (z > -2.5) return 'Sous-évaluation modérée'
  return 'Sous-évaluation extrême'
}

function naturalER(er: number): string {
  if (er > 0.65) return 'Mouvement directionnel fort'
  if (er > 0.40) return 'Signal modéré à confirmer'
  return 'Marché bruité (range/consolidation)'
}

function naturalKappa(k: number): string {
  if (k > 1.2) return 'Retour très rapide (range fort)'
  if (k > 0.5) return 'Retour modéré à la moyenne'
  if (k > 0.25) return 'Retour lent (tendance modérée)'
  return 'Très lent (tendance forte)'
}

function reboundProb(z: number): string {
  if (z < -2.5) return '~82% de probabilité de rebond'
  if (z < -1.5) return '~67% de probabilité de rebond'
  if (z < -0.5) return '~52% — zone neutre basse'
  if (z > 2.5)  return '~82% de probabilité de correction'
  if (z > 1.5)  return '~67% de probabilité de correction'
  return '~50% — pas de signal clair'
}

function zoneAdvice(excess: string, regime: string): { emoji: string; title: string; bullets: string[]; warning?: string } {
  if (excess === 'extreme_os' || excess === 'oversold') {
    return {
      emoji: '🟢',
      title: 'Zone Achat',
      bullets: [
        'Marché statistiquement sous-évalué',
        'Probabilité de retour à la moyenne élevée',
        regime === 'ranging' ? 'Régime Range → signal fiable' : 'Régime Tendance → signal plus risqué',
      ],
      warning: regime === 'trending' ? '⚠️ Éviter en forte tendance baissière' : undefined,
    }
  }
  if (excess === 'extreme_ob' || excess === 'overbought') {
    return {
      emoji: '🔴',
      title: 'Zone Vente / Sortie',
      bullets: [
        'Marché statistiquement surévalué',
        'Probabilité de correction ou retour à la moyenne',
        regime === 'ranging' ? 'Régime Range → signal fiable' : 'Régime Tendance → possible continuation',
      ],
      warning: regime === 'trending' ? '⚠️ En tendance haussière, attendre confirmation' : undefined,
    }
  }
  return {
    emoji: '🔵',
    title: 'Zone Neutre',
    bullets: [
      'Prix proches de la valeur d\'équilibre statistique',
      'Pas de signal d\'excès — attendre un bord de canal',
      'Surveiller la direction du Z-Score',
    ],
  }
}

// ─── Math helpers ─────────────────────────────────────────────────────────────
function emaArr(vals: number[], length: number): number[] {
  if (!vals.length || length <= 0) return vals.map(() => 0)
  const k = 2 / (length + 1)
  const out = [vals[0]]
  for (let i = 1; i < vals.length; i++) out.push(vals[i] * k + out[i-1] * (1-k))
  return out
}

function rollingStd(arr: number[], len: number): number[] {
  const out = new Array(arr.length).fill(0)
  for (let i = len - 1; i < arr.length; i++) {
    const slice = arr.slice(i - len + 1, i + 1)
    const mean = slice.reduce((a, b) => a + b, 0) / len
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / len
    out[i] = Math.sqrt(variance)
  }
  return out
}

// ─── Ornstein-Uhlenbeck Channel ───────────────────────────────────────────────
export function calcOUChannel(candles: Candle[], lookback = 50, sigmaWindow = 30): OUResult {
  const n = candles.length
  const empty: OUResult = {
    mean: [], upper1: [], upper2: [], lower1: [], lower2: [],
    zscore: [], kappa: [], sigma: [], excess: [], regime: [],
  }
  if (n < lookback + 10) return empty

  const close = candles.map(c => c.c)
  const mean = emaArr(close, lookback)
  const residuals = close.map((c, i) => c - mean[i])
  const sigmaArr = rollingStd(residuals, sigmaWindow)

  const kappaArr = new Array(n).fill(0.3)
  const kappaWin = Math.max(sigmaWindow, 20)
  for (let i = kappaWin; i < n; i++) {
    const res = residuals.slice(i - kappaWin, i)
    const mu_res = res.reduce((a, b) => a + b, 0) / kappaWin
    const centered = res.map(v => v - mu_res)
    let num = 0, den = 0
    for (let j = 1; j < centered.length; j++) {
      num += centered[j-1] * centered[j]
      den += centered[j-1] ** 2
    }
    const rho = den > 0 ? Math.max(0.001, Math.min(0.999, num / den)) : 0.5
    kappaArr[i] = -Math.log(rho)
  }

  const upper1: number[] = [], upper2: number[] = []
  const lower1: number[] = [], lower2: number[] = []
  const zscore: number[] = []
  const excess: OUResult['excess'] = []
  const regime: OUResult['regime'] = []

  for (let i = 0; i < n; i++) {
    const mu = mean[i]
    const price = close[i]
    const kappa = kappaArr[i]
    const rawSigma = sigmaArr[i] > 0 ? sigmaArr[i] : mu * 0.003
    const sigma = Math.max(rawSigma, mu * 0.003)
    const kappaFactor = kappa > 0 ? Math.min(1.5, Math.max(0.7, 1 / Math.sqrt(kappa))) : 1.0
    const adaptedSigma = sigma * kappaFactor

    upper1.push(mu + 1.0 * adaptedSigma)
    upper2.push(mu + 2.0 * adaptedSigma)
    lower1.push(mu - 1.0 * adaptedSigma)
    lower2.push(mu - 2.0 * adaptedSigma)

    const z = adaptedSigma > 0 ? (price - mu) / adaptedSigma : 0
    zscore.push(z)

    if (z > 2.5)       excess.push('extreme_ob')
    else if (z > 1.5)  excess.push('overbought')
    else if (z < -2.5) excess.push('extreme_os')
    else if (z < -1.5) excess.push('oversold')
    else               excess.push('none')

    if (kappa > 1.0)             regime.push('ranging')
    else if (kappa < 0.25)       regime.push('trending')
    else if (Math.abs(z) > 1.8)  regime.push('breakout')
    else                          regime.push('ranging')
  }

  return { mean, upper1, upper2, lower1, lower2, zscore, kappa: kappaArr, sigma: sigmaArr, excess, regime }
}

// ─── Kaufman Efficiency Ratio ─────────────────────────────────────────────────
export function calcKaufmanER(candles: Candle[], period = 14, erSmoothing = 10): KaufmanERResult {
  const close = candles.map(c => c.c)
  const n = close.length
  const er = new Array(n).fill(0)

  for (let i = period; i < n; i++) {
    const direction = Math.abs(close[i] - close[i - period])
    let volatility = 0
    for (let j = i - period + 1; j <= i; j++) {
      volatility += Math.abs(close[j] - close[j-1])
    }
    er[i] = volatility > 0 ? direction / volatility : 0
  }

  const erSmoothed = emaArr(er, erSmoothing)
  const fastAlpha = erSmoothed[n-1] ?? 0.5
  return { er, erSmoothed, fastAlpha }
}

// ─── Enhanced VMC with Kaufman ER ────────────────────────────────────────────
function rollingSum(arr: number[], length: number): number[] {
  const out = new Array(arr.length).fill(0)
  let s = 0
  for (let i = 0; i < arr.length; i++) {
    s += arr[i]
    if (i >= length) s -= arr[i-length]
    out[i] = s
  }
  return out
}

export function calcVMCEnhanced(candles: Candle[], erPeriod = 14): VMCEnhancedResult {
  const EMPTY: VMCEnhancedResult = {
    sig: [], sigSignal: [], momentum: [], er: [], erSmoothed: [],
    status: 'NEUTRAL', statusColor: '#8E8E93', excessLevel: 0,
    erQuality: 'weak', erColor: '#8E8E93', confluence: 0, trendBias: 'neutral',
  }
  if (candles.length < 60) return EMPTY

  const close = candles.map(c => c.c)
  const vol   = candles.map(c => c.v)
  const hlc3  = candles.map(c => (c.h + c.l + c.c) / 3)
  const n     = candles.length

  const rsiLen = 14
  const gains  = hlc3.map((v, i) => i === 0 ? 0 : Math.max(v - hlc3[i-1], 0))
  const losses = hlc3.map((v, i) => i === 0 ? 0 : Math.max(hlc3[i-1] - v, 0))
  const agArr  = emaArr(gains, rsiLen)
  const alArr  = emaArr(losses, rsiLen)
  const rsi    = agArr.map((g, i) => alArr[i] === 0 ? 100 : 100 - 100 / (1 + g / alArr[i]))

  const tp = hlc3
  const pmf = new Array(n).fill(0), nmf = new Array(n).fill(0)
  for (let i = 1; i < n; i++) {
    const raw = tp[i] * vol[i]
    if (tp[i] > tp[i-1]) pmf[i] = raw
    else if (tp[i] < tp[i-1]) nmf[i] = raw
  }
  const sPMF = rollingSum(pmf, 7), sNMF = rollingSum(nmf, 7)
  const mfi  = sPMF.map((p, i) => {
    const d = p + sNMF[i]
    return d === 0 ? 50 : (p / d) * 100
  })

  const computeStoch = (src: number[], len: number) => {
    const out = src.map((v, i) => {
      const win = src.slice(Math.max(0, i - len + 1), i + 1)
      const mn = Math.min(...win), mx = Math.max(...win)
      return mx - mn === 0 ? 50 : ((v - mn) / (mx - mn)) * 100
    })
    return emaArr(out, 2)
  }
  const stoch = computeStoch(rsi, rsiLen)

  const mfiW = 0.40, stochW = 0.40, denom = 1 + mfiW + stochW
  const core = rsi.map((r, i) => (r + mfiW * mfi[i] + stochW * stoch[i]) / denom)
  const transform = (arr: number[]) => arr.map(v => {
    const tmp = (v / 100 - 0.5) * 2
    return 100 * (tmp >= 0 ? 1 : -1) * Math.pow(Math.abs(tmp), 0.75)
  })
  const sig       = transform(emaArr(core, 10))
  const sigSignal = transform(emaArr(core, 18))
  const momentum  = sig.map((s, i) => s - sigSignal[i])

  const { er, erSmoothed } = calcKaufmanER(candles, erPeriod, 10)

  const last      = n - 1
  const sigLast   = sig[last] ?? 0
  const momLast   = momentum[last] ?? 0
  const erLast    = erSmoothed[last] ?? 0.5

  let erQuality: VMCEnhancedResult['erQuality']
  let erColor: string
  if (erLast > 0.65) { erQuality = 'strong';   erColor = '#34C759' }
  else if (erLast > 0.40) { erQuality = 'moderate'; erColor = '#FF9500' }
  else { erQuality = 'weak'; erColor = '#FF453A' }

  const erWeight = erLast
  const biasScore = sigLast * erWeight + momLast * 0.5

  let trendBias: VMCEnhancedResult['trendBias']
  if (biasScore > 5) trendBias = 'bullish'
  else if (biasScore < -5) trendBias = 'bearish'
  else trendBias = 'neutral'

  let status = 'NEUTRAL'
  let statusColor = '#8E8E93'

  if (erQuality === 'weak') {
    if (sigLast < -40) { status = 'ZONE ACHAT (Consolidation)'; statusColor = '#42A5F5' }
    else if (sigLast > 40) { status = 'ZONE VENTE (Consolidation)'; statusColor = '#FF9500' }
    else { status = 'RANGE · ER Faible'; statusColor = '#8E8E93' }
  } else if (erQuality === 'strong') {
    if (trendBias === 'bullish') { status = 'TENDANCE HAUSSIÈRE ✓'; statusColor = '#34C759' }
    else if (trendBias === 'bearish') { status = 'TENDANCE BAISSIÈRE ✓'; statusColor = '#FF3B30' }
    else { status = 'TENDANCE NEUTRE'; statusColor = '#FF9500' }
  } else {
    if (sigLast < -40) { status = 'SURVENTE'; statusColor = '#34C759' }
    else if (sigLast > 40) { status = 'SURACHAT'; statusColor = '#FF3B30' }
    else if (trendBias === 'bullish') { status = 'BIAIS HAUSSIER'; statusColor = '#66BB6A' }
    else if (trendBias === 'bearish') { status = 'BIAIS BAISSIER'; statusColor = '#EF5350' }
    else { status = 'NEUTRE'; statusColor = '#8E8E93' }
  }

  const confluence = Math.max(-1, Math.min(1, biasScore / 50))
  const excessLevel = Math.abs(sigLast)

  return { sig, sigSignal, momentum, er, erSmoothed, status, statusColor, excessLevel, erQuality, erColor, confluence, trendBias }
}

// ─── Canvas helpers ───────────────────────────────────────────────────────────
function resolveCSSColor(v: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || fallback
}

// ─── OU Channel Chart ─────────────────────────────────────────────────────────
// ── Shared crosshair drawing helper ──────────────────────────────────────────
function drawCrosshair(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  x: number, timeLabel: string, accentColor = 'rgba(0,229,255,0.5)'
) {
  // Vertical line
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.lineWidth = 1
  ctx.setLineDash([3, 3])
  ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - 14); ctx.stroke()
  ctx.setLineDash([])

  // Time label background + text at bottom
  const tw = ctx.measureText(timeLabel).width + 10
  const lx = Math.min(Math.max(x, tw / 2 + 2), W - tw / 2 - 2)
  ctx.fillStyle = accentColor
  const bx = lx - tw / 2, by = H - 14, bh = 13
  ctx.beginPath()
  ctx.roundRect(bx, by, tw, bh, 3)
  ctx.fill()
  ctx.fillStyle = '#080C14'
  ctx.font = 'bold 8px JetBrains Mono,monospace'
  ctx.textAlign = 'center'
  ctx.fillText(timeLabel, lx, by + 9)
  ctx.restore()
}

function fmtCandleTime(ts: number): string {
  const d = new Date(ts)
  const dd = String(d.getDate()).padStart(2, '0')
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mo} ${hh}:${mm}`
}

function fmtAxisLabel(ts: number, interval: string): string {
  const d = new Date(ts)
  const dd = String(d.getDate()).padStart(2, '0')
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (interval === '1w' || interval === '1d') return `${dd}/${mo}`
  if (interval === '12h' || interval === '4h') return `${dd} ${hh}:${mm}`
  return `${hh}:${mm}` // 15m / 1h
}

/** Draws static time labels in the 14px bottom strip already reserved by each chart */
function drawOUTimeAxis(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  candles: Candle[], interval: string
) {
  if (candles.length < 2) return
  const STRIP = 14
  // Dark background strip
  ctx.fillStyle = 'rgba(8,12,20,0.95)'
  ctx.fillRect(0, H - STRIP, W, STRIP)
  // Separator line
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.setLineDash([])
  ctx.beginPath(); ctx.moveTo(0, H - STRIP); ctx.lineTo(W, H - STRIP); ctx.stroke()

  const maxLabels = Math.max(2, Math.floor(W / 72))
  const step = Math.max(1, Math.floor(candles.length / maxLabels))
  ctx.font = '8px JetBrains Mono, monospace'

  for (let i = 0; i < candles.length; i += step) {
    const x = (i / (candles.length - 1)) * W
    const label = fmtAxisLabel(candles[i].t, interval)
    // Tick mark
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x, H - STRIP); ctx.lineTo(x, H - STRIP + 3); ctx.stroke()
    // Label text
    ctx.fillStyle = 'rgba(143,148,163,0.65)'; ctx.textAlign = 'center'
    ctx.fillText(label, Math.min(Math.max(x, 20), W - 20), H - 3)
  }
  ctx.restore()
}

interface OUChannelChartProps { candles: Candle[]; ou: OUResult; height?: number; hoverIdx?: number | null; onHover?: (d: HoverData | null) => void; interval?: string }
function OUChannelChart({ candles, ou, height = 200, hoverIdx, onHover, interval = '1h' }: OUChannelChartProps) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || candles.length < 20 || ou.mean.length < 20) return
    const dpr = window.devicePixelRatio || 1
    const W   = canvas.offsetWidth || 800
    const H   = height
    canvas.width  = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    const profit = resolveCSSColor('--tm-profit', '#22C759')
    const loss   = resolveCSSColor('--tm-loss',   '#FF3B30')

    const prices = candles.map(c => c.c)
    const allBands = [...ou.upper2.filter(Boolean), ...ou.lower2.filter(Boolean)]
    const yMin = Math.min(...prices, ...allBands) * 0.997
    const yMax = Math.max(...prices, ...allBands) * 1.003
    const yRange = yMax - yMin || 1
    // Reserve 14px bottom for time label
    const drawH = H - 14
    const toY = (v: number) => drawH - ((v - yMin) / yRange) * drawH
    const toX = (i: number) => (i / (candles.length - 1)) * W

    ctx.fillStyle = '#080C14'
    ctx.fillRect(0, 0, W, H)

    // Upper excess zone
    ctx.beginPath()
    ou.upper1.forEach((v, i) => { const x = toX(i), y = toY(v); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
    for (let i = ou.upper2.length - 1; i >= 0; i--) ctx.lineTo(toX(i), toY(ou.upper2[i]))
    ctx.closePath(); ctx.fillStyle = 'rgba(255,59,48,0.10)'; ctx.fill()

    // Lower excess zone
    ctx.beginPath()
    ou.lower1.forEach((v, i) => { const x = toX(i), y = toY(v); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
    for (let i = ou.lower2.length - 1; i >= 0; i--) ctx.lineTo(toX(i), toY(ou.lower2[i]))
    ctx.closePath(); ctx.fillStyle = 'rgba(52,199,89,0.10)'; ctx.fill()

    // Normal zone fill
    ctx.beginPath()
    ou.upper1.forEach((v, i) => { const x = toX(i), y = toY(v); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
    for (let i = ou.lower1.length - 1; i >= 0; i--) ctx.lineTo(toX(i), toY(ou.lower1[i]))
    ctx.closePath(); ctx.fillStyle = 'rgba(0,229,255,0.04)'; ctx.fill()

    const drawLine = (pts: number[], color: string, lw = 1, dash?: number[]) => {
      ctx.beginPath(); if (dash) ctx.setLineDash(dash); else ctx.setLineDash([])
      pts.forEach((v, i) => { if (!v) return; const x = toX(i), y = toY(v); i === 0 || !pts[i-1] ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke(); ctx.setLineDash([])
    }

    drawLine(ou.upper2, 'rgba(255,59,48,0.6)',  1, [4, 3])
    drawLine(ou.upper1, 'rgba(255,149,0,0.5)',  1, [3, 3])
    drawLine(ou.mean,   'rgba(0,229,255,0.7)',  1.5)
    drawLine(ou.lower1, 'rgba(52,199,89,0.5)',  1, [3, 3])
    drawLine(ou.lower2, 'rgba(0,200,100,0.6)',  1, [4, 3])

    // Price line
    for (let i = 1; i < candles.length; i++) {
      const excess = ou.excess[i]
      let color = 'rgba(255,255,255,0.7)'
      if (excess === 'extreme_ob' || excess === 'overbought') color = loss
      else if (excess === 'extreme_os' || excess === 'oversold') color = profit
      ctx.beginPath(); ctx.moveTo(toX(i-1), toY(candles[i-1].c)); ctx.lineTo(toX(i), toY(candles[i].c))
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke()
    }

    // Regime dots
    const regimeY = H - 6
    ou.regime.forEach((r, i) => {
      if (i % 5 !== 0) return
      ctx.beginPath(); ctx.arc(toX(i), regimeY, 2, 0, Math.PI * 2)
      if (r === 'trending') ctx.fillStyle = 'rgba(255,149,0,0.6)'
      else if (r === 'ranging') ctx.fillStyle = 'rgba(0,229,255,0.4)'
      else ctx.fillStyle = 'rgba(191,90,242,0.7)'
      ctx.fill()
    })

    // Excess markers
    ou.excess.forEach((e, i) => {
      if (e === 'none') return
      ctx.beginPath(); ctx.arc(toX(i), toY(candles[i].c), e.includes('extreme') ? 4 : 3, 0, Math.PI * 2)
      ctx.fillStyle = e.includes('ob') ? loss : profit
      ctx.fill(); ctx.strokeStyle = '#080C14'; ctx.lineWidth = 1; ctx.stroke()
    })

    // Time axis (static labels)
    drawOUTimeAxis(ctx, W, H, candles, interval)

    // Crosshair
    if (hoverIdx != null && candles[hoverIdx]) {
      const cx = toX(hoverIdx)
      const cy = toY(candles[hoverIdx].c)
      const excess = ou.excess[hoverIdx]
      const dotColor = excess === 'extreme_ob' ? loss : excess === 'overbought' ? '#FF9500'
        : excess === 'extreme_os' ? profit : excess === 'oversold' ? '#42A5F5' : '#00E5FF'
      drawCrosshair(ctx, W, H, cx, fmtCandleTime(candles[hoverIdx].t), 'rgba(0,229,255,0.5)')
      ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2)
      ctx.fillStyle = dotColor; ctx.fill()
      ctx.strokeStyle = '#080C14'; ctx.lineWidth = 1.5; ctx.stroke()
      // Price label on Y axis (right side)
      const price = candles[hoverIdx].c
      const pl = price.toFixed(price < 10 ? 4 : price < 1000 ? 2 : 0)
      ctx.fillStyle = 'rgba(0,229,255,0.5)'
      const pw = ctx.measureText(pl).width + 8
      ctx.beginPath(); ctx.roundRect(W - pw - 2, cy - 7, pw + 2, 14, 2); ctx.fill()
      ctx.fillStyle = '#080C14'; ctx.font = 'bold 8px JetBrains Mono,monospace'
      ctx.textAlign = 'right'; ctx.fillText(pl, W - 4, cy + 4)
    }

  }, [candles, ou, height, hoverIdx, interval])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onHover || candles.length < 2) return
    const rect = e.currentTarget.getBoundingClientRect()
    const xRatio = (e.clientX - rect.left) / rect.width
    const idx = Math.min(candles.length - 1, Math.max(0, Math.round(xRatio * (candles.length - 1))))
    onHover({ x: e.clientX - rect.left, idx, z: ou.zscore[idx] ?? 0, excess: ou.excess[idx] ?? 'none', price: candles[idx]?.c ?? 0 })
  }, [candles, ou, onHover])

  if (candles.length < 20) return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tm-text-muted)', fontSize: 12, background: '#080C14', borderRadius: 8 }}>
      Données insuffisantes…
    </div>
  )

  return (
    <canvas ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => onHover?.(null)}
      style={{ width: '100%', height, borderRadius: 8, display: 'block', cursor: 'crosshair' }}
    />
  )
}

// ─── Z-Score Oscillator Chart ─────────────────────────────────────────────────
function ZScoreChart({ zscore, excess, height = 100, candles, hoverIdx, onHover, interval = '1h' }: { zscore: number[]; excess: OUResult['excess']; height?: number; candles?: Candle[]; hoverIdx?: number | null; onHover?: (d: HoverData | null) => void; interval?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || zscore.length < 10) return
    const dpr = window.devicePixelRatio || 1
    const W   = canvas.offsetWidth || 800
    const H   = height
    canvas.width  = W * dpr; canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!; ctx.scale(dpr, dpr)

    ctx.fillStyle = '#080C14'; ctx.fillRect(0, 0, W, H)

    const yMin = -4, yMax = 4, yRange = yMax - yMin
    const drawH = H - 14 // reserve 14px for time label
    const toY = (v: number) => drawH - ((v - yMin) / yRange) * drawH
    const toX = (i: number) => (i / (zscore.length - 1)) * W

    const lines: [number, string, string][] = [
      [2.5, 'rgba(255,59,48,0.4)',  '>+2.5σ Extrême'],
      [1.5, 'rgba(255,149,0,0.3)',  '+1.5σ Surachat'],
      [0,   'rgba(255,255,255,0.15)', '0'],
      [-1.5, 'rgba(52,199,89,0.3)', '-1.5σ Survente'],
      [-2.5, 'rgba(52,199,89,0.5)', '<-2.5σ Extrême'],
    ]
    lines.forEach(([v, color]) => {
      ctx.beginPath(); ctx.moveTo(0, toY(v as number)); ctx.lineTo(W, toY(v as number))
      ctx.strokeStyle = color as string; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke()
    })
    ctx.setLineDash([])

    // Zone labels on right
    ctx.font = '8px JetBrains Mono, monospace'
    ctx.fillStyle = 'rgba(255,59,48,0.6)'; ctx.textAlign = 'right'; ctx.fillText('Extrême OB', W - 3, toY(2.8))
    ctx.fillStyle = 'rgba(255,149,0,0.6)'; ctx.fillText('Surachat', W - 3, toY(2.0))
    ctx.fillStyle = 'rgba(0,229,255,0.4)'; ctx.fillText('Neutre', W - 3, toY(0.3))
    ctx.fillStyle = 'rgba(52,199,89,0.6)'; ctx.fillText('Survente', W - 3, toY(-1.7))
    ctx.fillStyle = 'rgba(52,199,89,0.8)'; ctx.fillText('Extrême OS', W - 3, toY(-2.8))
    ctx.textAlign = 'left'

    ctx.beginPath(); ctx.rect(0, toY(1.5), W, toY(-1.5) - toY(1.5))
    ctx.fillStyle = 'rgba(0,229,255,0.03)'; ctx.fill()

    for (let i = 1; i < zscore.length; i++) {
      const z = zscore[i], x = toX(i), zY = toY(z), midY = toY(0), exc = excess[i]
      let color = 'rgba(0,229,255,0.6)'
      if (exc === 'extreme_ob') color = 'rgba(255,59,48,0.85)'
      else if (exc === 'overbought') color = 'rgba(255,149,0,0.7)'
      else if (exc === 'extreme_os') color = 'rgba(52,199,89,0.85)'
      else if (exc === 'oversold')   color = 'rgba(42,160,80,0.7)'
      ctx.fillStyle = color
      ctx.fillRect(x - 1, Math.min(zY, midY), 2, Math.abs(zY - midY))
    }

    ctx.beginPath()
    zscore.forEach((v, i) => { const x = toX(i), y = toY(v); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
    ctx.strokeStyle = 'rgba(0,229,255,0.5)'; ctx.lineWidth = 1; ctx.stroke()

    // Time axis (static labels)
    if (candles && candles.length > 1) drawOUTimeAxis(ctx, W, H, candles, interval)

    // Crosshair
    if (hoverIdx != null && zscore[hoverIdx] != null) {
      const cx = toX(hoverIdx), cy = toY(zscore[hoverIdx])
      const exc = excess[hoverIdx]
      const dotColor = exc === 'extreme_ob' ? '#FF3B30' : exc === 'overbought' ? '#FF9500'
        : exc === 'extreme_os' ? '#34C759' : exc === 'oversold' ? '#42A5F5' : '#00E5FF'
      const label = candles?.[hoverIdx] ? fmtCandleTime(candles[hoverIdx].t) : `i:${hoverIdx}`
      drawCrosshair(ctx, W, H, cx, label, 'rgba(0,229,255,0.5)')
      // Horizontal line at Z value
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.setLineDash([3,3])
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke()
      ctx.setLineDash([]); ctx.restore()
      // Dot on line
      ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2)
      ctx.fillStyle = dotColor; ctx.fill(); ctx.strokeStyle = '#080C14'; ctx.lineWidth = 1.5; ctx.stroke()
      // Z value badge right side
      const zv = zscore[hoverIdx].toFixed(2)
      ctx.fillStyle = 'rgba(0,229,255,0.4)'
      const zw = ctx.measureText(zv).width + 8
      ctx.beginPath(); ctx.roundRect(W - zw - 2, cy - 7, zw + 2, 14, 2); ctx.fill()
      ctx.fillStyle = '#080C14'; ctx.font = 'bold 8px JetBrains Mono,monospace'
      ctx.textAlign = 'right'; ctx.fillText(zv, W - 4, cy + 4)
    }

  }, [zscore, excess, height, hoverIdx, candles, interval])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onHover || zscore.length < 2) return
    const rect = e.currentTarget.getBoundingClientRect()
    const xRatio = (e.clientX - rect.left) / rect.width
    const idx = Math.min(zscore.length - 1, Math.max(0, Math.round(xRatio * (zscore.length - 1))))
    onHover({ x: e.clientX - rect.left, idx, z: zscore[idx] ?? 0, excess: excess[idx] ?? 'none', price: 0 })
  }, [zscore, excess, onHover])

  return (
    <canvas ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => onHover?.(null)}
      style={{ width: '100%', height, borderRadius: 8, display: 'block', cursor: 'crosshair' }}
    />
  )
}

// ─── VMC+ER Chart ─────────────────────────────────────────────────────────────
function VMCEnhancedChart({ vmc, height = 130, candles, hoverIdx, onHover, interval = '1h' }: { vmc: VMCEnhancedResult; height?: number; candles?: Candle[]; hoverIdx?: number | null; onHover?: (d: HoverData | null) => void; interval?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || vmc.sig.length < 10) return
    const dpr = window.devicePixelRatio || 1
    const W = canvas.offsetWidth || 800, H = height
    canvas.width = W * dpr; canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!; ctx.scale(dpr, dpr)

    ctx.fillStyle = '#080C14'; ctx.fillRect(0, 0, W, H)

    const n = vmc.sig.length
    const yMin = -80, yMax = 80, yRange = yMax - yMin
    const drawH = H - 14 // reserve 14px for time label
    const erPanelTop = drawH * 0.88, erPanelH = drawH * 0.10
    const toY  = (v: number) => erPanelTop * (1 - (v - yMin) / yRange)
    const toX  = (i: number) => (i / (n - 1)) * W
    const toYER = (v: number) => erPanelTop + erPanelH - v * erPanelH

    ctx.setLineDash([3, 3])
    ;[40, 0, -40].forEach(v => {
      ctx.beginPath(); ctx.moveTo(0, toY(v)); ctx.lineTo(W, toY(v))
      ctx.strokeStyle = v === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)'
      ctx.lineWidth = 1; ctx.stroke()
    })
    ctx.setLineDash([])

    // Zone labels
    ctx.font = '8px JetBrains Mono, monospace'; ctx.textAlign = 'right'
    ctx.fillStyle = 'rgba(255,59,48,0.5)'; ctx.fillText('Surachat', W - 3, toY(45))
    ctx.fillStyle = 'rgba(52,199,89,0.5)'; ctx.fillText('Survente', W - 3, toY(-35))
    ctx.textAlign = 'left'

    ctx.fillStyle = 'rgba(255,59,48,0.06)'; ctx.fillRect(0, 0, W, toY(40))
    ctx.fillStyle = 'rgba(52,199,89,0.06)'; ctx.fillRect(0, toY(-40), W, erPanelTop - toY(-40))

    for (let i = 1; i < n; i++) {
      const mom = vmc.momentum[i], er = vmc.erSmoothed[i] ?? 0.5
      const x = toX(i), zeroY = toY(0), momY = toY(mom)
      const alpha = 0.3 + er * 0.5
      ctx.fillStyle = mom >= 0 ? `rgba(52,199,89,${alpha.toFixed(2)})` : `rgba(255,59,48,${alpha.toFixed(2)})`
      ctx.fillRect(x - 1.5, Math.min(momY, zeroY), 3, Math.abs(momY - zeroY))
    }

    ctx.beginPath()
    vmc.sigSignal.forEach((v, i) => { const x = toX(i), y = toY(v); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
    ctx.strokeStyle = 'rgba(255,149,0,0.7)'; ctx.lineWidth = 1.2; ctx.stroke()

    ctx.beginPath()
    vmc.sig.forEach((v, i) => { const x = toX(i), y = toY(v); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
    ctx.strokeStyle = vmc.erQuality === 'strong' ? '#34C759' : vmc.erQuality === 'moderate' ? '#FF9500' : '#8E8E93'
    ctx.lineWidth = 1.8; ctx.stroke()

    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(0, erPanelTop, W, erPanelH)
    for (let i = 1; i < n; i++) {
      const er = vmc.erSmoothed[i] ?? 0, x = toX(i)
      ctx.fillStyle = er > 0.65 ? 'rgba(52,199,89,0.7)' : er > 0.4 ? 'rgba(255,149,0,0.6)' : 'rgba(255,59,48,0.5)'
      ctx.fillRect(x - 1.5, toYER(er), 3, toYER(0) - toYER(er))
    }
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '8px JetBrains Mono, monospace'
    ctx.fillText('ER', 4, erPanelTop + 10)

    // Time axis (static labels)
    if (candles && candles.length > 1) drawOUTimeAxis(ctx, W, H, candles, interval)

    // Crosshair
    if (hoverIdx != null && vmc.sig[hoverIdx] != null) {
      const cx = toX(hoverIdx), cy = toY(vmc.sig[hoverIdx])
      const er = vmc.erSmoothed[hoverIdx] ?? 0
      const dotColor = er > 0.65 ? '#34C759' : er > 0.4 ? '#FF9500' : '#FF3B30'
      const label = candles?.[hoverIdx] ? fmtCandleTime(candles[hoverIdx].t) : `i:${hoverIdx}`
      drawCrosshair(ctx, W, H, cx, label, 'rgba(191,90,242,0.5)')
      // Horizontal line at VMC value
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.setLineDash([3,3])
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke()
      ctx.setLineDash([]); ctx.restore()
      // Dot on VMC line
      ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2)
      ctx.fillStyle = dotColor; ctx.fill(); ctx.strokeStyle = '#080C14'; ctx.lineWidth = 1.5; ctx.stroke()
      // VMC value badge right side
      const vmcv = vmc.sig[hoverIdx].toFixed(1)
      ctx.fillStyle = 'rgba(191,90,242,0.4)'
      const vw = ctx.measureText(vmcv).width + 8
      ctx.beginPath(); ctx.roundRect(W - vw - 2, cy - 7, vw + 2, 14, 2); ctx.fill()
      ctx.fillStyle = '#080C14'; ctx.font = 'bold 8px JetBrains Mono,monospace'
      ctx.textAlign = 'right'; ctx.fillText(vmcv, W - 4, cy + 4)
    }

  }, [vmc, height, hoverIdx, candles, interval])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onHover || vmc.sig.length < 2) return
    const rect = e.currentTarget.getBoundingClientRect()
    const xRatio = (e.clientX - rect.left) / rect.width
    const idx = Math.min(vmc.sig.length - 1, Math.max(0, Math.round(xRatio * (vmc.sig.length - 1))))
    onHover({ x: e.clientX - rect.left, idx, z: 0, excess: 'none', price: candles?.[idx]?.c ?? 0 })
  }, [vmc, candles, onHover])

  if (vmc.sig.length < 10) return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tm-text-muted)', fontSize: 12, background: '#080C14', borderRadius: 8 }}>
      Chargement VMC…
    </div>
  )
  return (
    <canvas ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => onHover?.(null)}
      style={{ width: '100%', height, borderRadius: 8, display: 'block', cursor: 'crosshair' }}
    />
  )
}

// ─── Tooltip component ────────────────────────────────────────────────────────
function HoverTooltip({ hover, candles, ou }: { hover: HoverData; candles: Candle[]; ou: OUResult }) {
  const z = hover.z
  const excess = hover.excess
  const price = hover.price || candles[hover.idx]?.c || 0
  const mean = ou.mean[hover.idx] || 0
  const zColor = excess === 'extreme_ob' ? '#FF3B30' : excess === 'overbought' ? '#FF9500'
    : excess === 'extreme_os' ? '#22C759' : excess === 'oversold' ? '#42A5F5' : '#8E8E93'

  return (
    <div style={{
      position: 'absolute', top: 8, left: Math.min(hover.x + 8, 220),
      background: 'rgba(8,12,20,0.97)', border: `1px solid ${zColor}40`,
      borderRadius: 10, padding: '10px 14px', pointerEvents: 'none', zIndex: 50,
      minWidth: 200, backdropFilter: 'blur(12px)',
      boxShadow: `0 0 20px ${zColor}20`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: zColor, marginBottom: 6 }}>
        {naturalZ(z)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ fontSize: 10, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono' }}>
          Z-Score : <span style={{ color: zColor, fontWeight: 700 }}>{z >= 0 ? '+' : ''}{z.toFixed(2)}σ</span>
        </div>
        {price > 0 && <div style={{ fontSize: 10, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono' }}>
          Prix : <span style={{ color: 'var(--tm-text-primary)' }}>{price >= 1 ? `$${price.toFixed(2)}` : `$${price.toFixed(5)}`}</span>
        </div>}
        {mean > 0 && <div style={{ fontSize: 10, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono' }}>
          μ OU : <span style={{ color: '#00E5FF' }}>{mean >= 1 ? `$${mean.toFixed(2)}` : `$${mean.toFixed(5)}`}</span>
        </div>}
        <div style={{ fontSize: 10, color: '#BF5AF2', marginTop: 4, fontStyle: 'italic' }}>
          {reboundProb(z)}
        </div>
      </div>
    </div>
  )
}

// ─── Tooltip badge (hover) ────────────────────────────────────────────────────
function TooltipBadge({ children, tip }: { children: React.ReactNode; tip: string }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(8,12,20,0.97)', border: '1px solid rgba(0,229,255,0.2)',
          borderRadius: 8, padding: '8px 12px', zIndex: 100,
          fontSize: 11, color: 'var(--tm-text-primary)', whiteSpace: 'normal' as any,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)', pointerEvents: 'none',
          maxWidth: 220, minWidth: 160,
          lineHeight: 1.5,
        }}>
          {tip}
        </div>
      )}
    </div>
  )
}

// ─── Timeframe selector ───────────────────────────────────────────────────────
const TF_OPTIONS = [
  { label: '15m', interval: '15m', limit: 300 },
  { label: '1H',  interval: '1h',  limit: 300 },
  { label: '4H',  interval: '4h',  limit: 300 },
  { label: '12H', interval: '12h', limit: 200 },
  { label: '1J',  interval: '1d',  limit: 200 },
  { label: '1S',  interval: '1w',  limit: 150 },
]

interface MTFRow { tf: string; zscore: number; excess: string; erScore: number; vmcBias: string; regime: string }

interface OUChannelIndicatorProps {
  symbol: string
  syncInterval?: string
  visibleRange?: { from: number; to: number } | null
  crosshairFrac?: number | null
  onDecisionData?: (d: { excess: string; regime: string; z: number; confluenceSignal: string; vmcStatus: string }) => void
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function OUChannelIndicator({ symbol, syncInterval, visibleRange, crosshairFrac, onDecisionData }: OUChannelIndicatorProps) {
  const [tf, setTf]               = useState('1h')
  const [candles, setCandles]     = useState<Candle[]>([])
  const [ou, setOu]               = useState<OUResult | null>(null)
  const [vmc, setVmc]             = useState<VMCEnhancedResult | null>(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [mtfRows, setMtfRows]     = useState<MTFRow[]>([])
  const [mtfLoading, setMtfLoading] = useState(false)
  const [activeView, setActiveView] = useState<'channel' | 'zscore' | 'vmc' | 'confluence'>('channel')
  const [showStats, setShowStats] = useState(true)
  const isCrypto = /USDT$|BUSD$|BTC$|ETH$|BNB$/i.test(symbol)
  const [proMode, setProMode]     = useState(false)
  const [showDecision, setShowDecision] = useState(false)
  const [hoverData, setHoverData] = useState<HoverData | null>(null)
  const isDirectHover = useRef(false)  // true when mouse is directly on one of our canvases
  const [signalHistory, setSignalHistory] = useState<SignalEntry[]>([])
  const loadRef = useRef(0)

  // ── Viewport — mirrors WaveTrend so Canal OU shows the same time window ──
  const [viewport, setViewport] = useState({ from: 0, to: 1 })

  useEffect(() => {
    if (!visibleRange) {
      const n = candles.length || 1
      setViewport({ from: Math.max(0, 1 - 150 / n), to: 1 })
    } else {
      setViewport({ from: visibleRange.from, to: Math.min(visibleRange.to, 1) })
    }
  }, [visibleRange, candles.length])

  const total     = candles.length
  const viewStart = total > 0 ? Math.max(0, Math.floor(viewport.from * total)) : 0
  const viewEnd   = total > 0 ? Math.min(total, Math.ceil(Math.min(viewport.to, 1) * total)) : 0
  const viewSize  = Math.max(viewEnd - viewStart, 2)

  const viewCandles = candles.slice(viewStart, viewEnd)
  const viewOu: OUResult | null = ou ? {
    mean:   ou.mean.slice(viewStart, viewEnd),
    upper1: ou.upper1.slice(viewStart, viewEnd),
    upper2: ou.upper2.slice(viewStart, viewEnd),
    lower1: ou.lower1.slice(viewStart, viewEnd),
    lower2: ou.lower2.slice(viewStart, viewEnd),
    zscore: ou.zscore.slice(viewStart, viewEnd),
    kappa:  ou.kappa.slice(viewStart, viewEnd),
    sigma:  ou.sigma.slice(viewStart, viewEnd),
    excess: ou.excess.slice(viewStart, viewEnd),
    regime: ou.regime.slice(viewStart, viewEnd),
  } : null
  const viewVmc: VMCEnhancedResult | null = vmc ? {
    ...vmc,
    sig:        vmc.sig.slice(viewStart, viewEnd),
    sigSignal:  vmc.sigSignal.slice(viewStart, viewEnd),
    momentum:   vmc.momentum.slice(viewStart, viewEnd),
    er:         vmc.er.slice(viewStart, viewEnd),
    erSmoothed: vmc.erSmoothed.slice(viewStart, viewEnd),
  } : null

  // Sync crosshair from main LW chart when not directly hovering
  useEffect(() => {
    if (isDirectHover.current) return  // local hover takes priority
    if (crosshairFrac == null || !viewCandles.length) { setHoverData(null); return }
    const idx = Math.max(0, Math.min(viewSize - 1, Math.round(crosshairFrac * (viewSize - 1))))
    const c = viewCandles[idx]
    if (!c) return
    setHoverData({ x: 0, idx, z: viewOu?.zscore[idx] ?? 0, excess: viewOu?.excess[idx] ?? 'none', price: c.c })
  }, [crosshairFrac, viewCandles, viewOu, viewSize])

  useEffect(() => {
    if (syncInterval) {
      const match = TF_OPTIONS.find(t => t.interval === syncInterval)
      if (match) setTf(match.interval)
    }
  }, [syncInterval])

  const loadData = useCallback(async (interval: string) => {
    if (!symbol) return
    const id = ++loadRef.current
    setLoading(true); setError('')
    try {
      const opt = TF_OPTIONS.find(t => t.interval === interval) ?? TF_OPTIONS[1]
      const data = await fetchCandles(symbol, opt.interval, opt.limit)
      if (id !== loadRef.current) return

      setCandles(data)
      const ouResult = calcOUChannel(data, 50, 20)
      setOu(ouResult)
      const vmcResult = calcVMCEnhanced(data, 14)
      setVmc(vmcResult)

      // Record signal history
      const n = data.length - 1
      const excess = ouResult.excess[n]
      if (excess !== 'none') {
        const label = excess === 'extreme_ob' ? '⚠️ Surachat Extrême'
          : excess === 'overbought' ? '🔴 Surachat OU'
          : excess === 'extreme_os' ? '🚀 Survente Extrême'
          : '🟢 Survente OU'
        const color = excess.includes('ob') ? '#FF3B30' : '#34C759'
        const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        setSignalHistory(prev => [{ time: now, label, color, excess }, ...prev].slice(0, 6))
      }
    } catch (e: unknown) {
      if (id === loadRef.current) setError(e instanceof Error ? e.message : 'Erreur de chargement')
    } finally {
      if (id === loadRef.current) setLoading(false)
    }
  }, [symbol])

  useEffect(() => { loadData(tf) }, [tf, loadData])

  const loadMTF = useCallback(async () => {
    if (!symbol) return
    setMtfLoading(true)
    const tfs = ['15m', '1h', '4h', '1d']
    const rows: MTFRow[] = []
    await Promise.all(tfs.map(async (interval) => {
      try {
        const data = await fetchCandles(symbol, interval, 150)
        const ouR = calcOUChannel(data, 50, 20)
        const vmcR = calcVMCEnhanced(data, 14)
        const n = data.length - 1
        rows.push({ tf: interval, zscore: ouR.zscore[n] ?? 0, excess: ouR.excess[n] ?? 'none', erScore: vmcR.erSmoothed[n] ?? 0, vmcBias: vmcR.trendBias, regime: ouR.regime[n] ?? 'ranging' })
      } catch { /* ignore */ }
    }))
    rows.sort((a, b) => ({ '15m': 0, '1h': 1, '4h': 2, '1d': 3 } as Record<string, number>)[a.tf] - ({ '15m': 0, '1h': 1, '4h': 2, '1d': 3 } as Record<string, number>)[b.tf])
    setMtfRows(rows)
    setMtfLoading(false)
  }, [symbol])

  useEffect(() => { loadMTF() }, [loadMTF])

  // ── Current stats ──
  const n         = candles.length - 1
  const curZ      = ou?.zscore[n] ?? 0
  const curExcess = ou?.excess[n] ?? 'none'
  const curRegime = ou?.regime[n] ?? 'ranging'
  const curKappa  = ou?.kappa[n] ?? 0
  const curMean   = ou?.mean[n] ?? 0
  const curPrice  = candles[n]?.c ?? 0
  const curUpper1 = ou?.upper1[n] ?? 0
  const curLower2 = ou?.lower2[n] ?? 0

  // ── Notify parent (DecisionAssistant) when signals change ────────────────
  useEffect(() => {
    if (!ou || !vmc || !candles.length) return
    const confSignal = computeConfluence(ou, vmc, candles, isCrypto).signal
    onDecisionData?.({ excess: curExcess, regime: curRegime, z: curZ, confluenceSignal: confSignal, vmcStatus: vmc.status })
  }, [curExcess, curRegime, curZ, vmc?.status, onDecisionData]) // eslint-disable-line react-hooks/exhaustive-deps

  const zColor = curExcess === 'extreme_ob' ? '#FF3B30' : curExcess === 'overbought' ? '#FF9500'
    : curExcess === 'extreme_os' ? '#22C759' : curExcess === 'oversold' ? '#42A5F5' : '#8E8E93'
  const regimeColor = curRegime === 'trending' ? '#FF9500' : curRegime === 'breakout' ? '#BF5AF2' : '#00E5FF'

  const excessLabel = {
    extreme_ob: '⚠️ Surachat Extrême', overbought: '🔴 Surachat OU',
    extreme_os: '🚀 Survente Extrême', oversold: '🟢 Survente OU', none: '🔵 Zone Neutre',
  }[curExcess] ?? '—'

  function fmtP(p: number) {
    if (p >= 10000) return `$${p.toLocaleString('en', { maximumFractionDigits: 0 })}`
    if (p >= 1) return `$${p.toFixed(2)}`
    return `$${p.toFixed(5)}`
  }

  // ── MTF Confluence Score (0–100%) ──
  const confluenceScore = mtfRows.length > 0 ? (() => {
    let bullScore = 0, bearScore = 0, total = mtfRows.length
    mtfRows.forEach(r => {
      const w = r.erScore > 0.6 ? 1.5 : r.erScore > 0.4 ? 1.0 : 0.5
      if (r.vmcBias === 'bullish') bullScore += w
      else if (r.vmcBias === 'bearish') bearScore += w
      if (r.excess.includes('os')) bullScore += 0.5
      if (r.excess.includes('ob')) bearScore += 0.5
    })
    const maxScore = total * 2
    const dominant = bullScore >= bearScore ? bullScore : bearScore
    return Math.min(100, Math.round((dominant / maxScore) * 100))
  })() : 0

  const confluenceDir = mtfRows.length > 0 ? (() => {
    const bulls = mtfRows.filter(r => r.vmcBias === 'bullish').length
    const bears = mtfRows.filter(r => r.vmcBias === 'bearish').length
    if (bulls > bears) return 'bullish'
    if (bears > bulls) return 'bearish'
    return 'neutral'
  })() : 'neutral'

  const confluenceLabel = confluenceScore < 30 ? { text: 'Contre-trend', color: '#FF453A' }
    : confluenceScore < 60 ? { text: 'Signal incertain', color: '#FF9500' }
    : { text: 'Aligné', color: '#34C759' }

  const conflIcon = confluenceScore < 30 ? '⚠️' : confluenceScore < 60 ? '◑' : '✅'

  // ── Zone advice ──
  const zoneInfo = zoneAdvice(curExcess, curRegime)

  // ── Decision plan ──
  const decisionPlan = (() => {
    if (curExcess === 'none') return null
    const isBuy = curExcess.includes('os')
    return {
      action: isBuy ? '📈 Opportunité Achat' : '📉 Opportunité Vente/Sortie',
      color: isBuy ? '#34C759' : '#FF3B30',
      entry: isBuy ? `Zone actuelle (${fmtP(curPrice)})` : `Zone actuelle (${fmtP(curPrice)})`,
      tp: isBuy ? `Retour à μ OU (${fmtP(curMean)}) → +${curMean > 0 && curPrice > 0 ? ((curMean/curPrice - 1)*100).toFixed(1) : '?'}%` : `Retour à μ OU (${fmtP(curMean)})`,
      sl: isBuy ? `Cassure bande -2σ (${fmtP(curLower2)})` : `Cassure bande +1σ (${fmtP(curUpper1)})`,
      rationale: `Z-Score ${curZ.toFixed(2)}σ · ${naturalZ(curZ)} · ${curRegime === 'ranging' ? 'Régime Range → signal fiable' : 'Régime Tendance → confirmer direction'}`,
    }
  })()

  const C = {
    card: { background: 'rgba(13,17,35,0.7)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, overflow: 'hidden' as const, position: 'relative' as const, backdropFilter: 'blur(12px)' },
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'relative', zIndex: 1 }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes ouPulse { 0%,100%{opacity:0.6;transform:scale(1)}50%{opacity:1;transform:scale(1.05)} }
        @keyframes signalPulse { 0%,100%{box-shadow:0 0 8px ${zColor}40}50%{box-shadow:0 0 20px ${zColor}80} }
      `}</style>

      {/* ── Verdict Global (signal principal — GRAND) ── */}
      <div style={{
        ...C.card, padding: '16px 20px',
        borderColor: `${zColor}50`,
        background: `linear-gradient(135deg, rgba(13,17,35,0.9), ${zColor}08)`,
        animation: curExcess !== 'none' ? 'signalPulse 2.5s ease-in-out infinite' : undefined,
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,transparent,${zColor}80,transparent)` }} />

        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg,${zColor}20,${zColor}08)`, border: `1px solid ${zColor}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>〜</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--tm-text-primary)', fontFamily: 'Syne,sans-serif' }}>Canal OU · Excès Statistiques</div>
              <div style={{ fontSize: 10, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono' }}>Ornstein-Uhlenbeck · VMC + Kaufman ER</div>
            </div>
          </div>

          {/* Mode toggle + collapse + reload */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {/* Compact signal pill when collapsed */}
            {!showStats && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 8,
                background: `${zColor}12`, border: `1px solid ${zColor}30`,
              }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: zColor, fontFamily: 'JetBrains Mono' }}>
                  {curZ >= 0 ? '+' : ''}{curZ.toFixed(2)}σ
                </span>
                <span style={{ fontSize: 9, color: zColor, fontWeight: 600 }}>{excessLabel}</span>
              </div>
            )}
            <button onClick={() => setProMode(p => !p)} style={{
              padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              background: proMode ? 'rgba(191,90,242,0.15)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${proMode ? 'rgba(191,90,242,0.4)' : 'rgba(255,255,255,0.1)'}`,
              color: proMode ? '#BF5AF2' : 'var(--tm-text-muted)', transition: 'all 0.2s',
            }}>
              {proMode ? '⚙️ Pro' : '🎓 Débutant'}
            </button>
            <button onClick={() => loadData(tf)} disabled={loading} style={{ width: 32, height: 32, borderRadius: 8, background: 'none', border: '1px solid rgba(255,255,255,0.1)', cursor: loading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tm-text-muted)', fontSize: 14 }}>
              {loading ? <div style={{ width: 12, height: 12, border: '2px solid #2A2F3E', borderTopColor: '#00E5FF', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> : '↻'}
            </button>
            <button onClick={() => setShowStats(s => !s)} style={{
              width: 32, height: 32, borderRadius: 8, background: 'none',
              border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--tm-text-muted)', fontSize: 12, transition: 'all 0.2s',
            }} title={showStats ? 'Réduire les stats' : 'Afficher les stats'}>
              {showStats ? '▲' : '▼'}
            </button>
          </div>
        </div>

        {/* ── SIGNAL PRINCIPAL ── */}
        {showStats && (<>
        <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', flexWrap: 'wrap' }}>
          {/* Z-score + label GROS */}
          <div style={{ flex: '0 0 auto', padding: '12px 20px', borderRadius: 12, background: `${zColor}12`, border: `1px solid ${zColor}35`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 120 }}>
            <span style={{ fontSize: 9, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono', letterSpacing: '0.08em' }}>Z-SCORE OU</span>
            <span style={{ fontSize: 28, fontWeight: 900, color: zColor, fontFamily: 'JetBrains Mono', lineHeight: 1 }}>
              {curZ >= 0 ? '+' : ''}{curZ.toFixed(2)}σ
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: zColor, textAlign: 'center' }}>{excessLabel}</span>
          </div>

          {/* Interprétation naturelle */}
          <div style={{ flex: 1, minWidth: 200, padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: zColor, fontFamily: 'Syne,sans-serif' }}>
              {zoneInfo.emoji} {zoneInfo.title}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {zoneInfo.bullets.map((b, i) => (
                <div key={i} style={{ fontSize: 11, color: i === 0 ? 'var(--tm-text-primary)' : 'var(--tm-text-muted)', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <span style={{ color: zColor, marginTop: 1 }}>→</span> {b}
                </div>
              ))}
              {zoneInfo.warning && (
                <div style={{ fontSize: 10, color: '#FF9500', marginTop: 2, fontStyle: 'italic' }}>{zoneInfo.warning}</div>
              )}
            </div>
          </div>

          {/* Plan décision */}
          {decisionPlan && (
            <div style={{ flex: '0 0 auto' }}>
              <button onClick={() => setShowDecision(d => !d)} style={{
                height: '100%', padding: '10px 14px', borderRadius: 12, cursor: 'pointer',
                background: showDecision ? `${decisionPlan.color}15` : 'rgba(255,255,255,0.04)',
                border: `1px solid ${showDecision ? decisionPlan.color + '40' : 'rgba(255,255,255,0.1)'}`,
                color: showDecision ? decisionPlan.color : 'var(--tm-text-muted)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                fontSize: 11, fontWeight: 700, transition: 'all 0.2s',
              }}>
                <span style={{ fontSize: 18 }}>🎯</span>
                Que faire ?
              </button>
            </div>
          )}
        </div>

        {/* ── Plan "Que faire ?" ── */}
        {showDecision && decisionPlan && (
          <div style={{ marginTop: 12, padding: '14px 16px', borderRadius: 12, background: `${decisionPlan.color}08`, border: `1px solid ${decisionPlan.color}30` }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: decisionPlan.color, marginBottom: 10, fontFamily: 'Syne,sans-serif' }}>
              📌 {decisionPlan.action}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {[
                { label: '🎯 Entrée', value: decisionPlan.entry, color: '#00E5FF' },
                { label: '✅ TP cible', value: decisionPlan.tp, color: '#34C759' },
                { label: '🛑 SL', value: decisionPlan.sl, color: '#FF3B30' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ fontSize: 9, color: 'var(--tm-text-muted)', marginBottom: 3, fontWeight: 700 }}>{label}</div>
                  <div style={{ fontSize: 10, color, fontWeight: 600, fontFamily: 'JetBrains Mono', lineHeight: 1.4 }}>{value}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 10, color: 'var(--tm-text-muted)', fontStyle: 'italic' }}>{decisionPlan.rationale}</div>
            <div style={{ marginTop: 6, fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>⚠️ Ce plan est indicatif — toujours confirmer avec votre analyse de risque.</div>
          </div>
        )}

        {/* ── VMC Status ── */}
        {vmc && (
          <div style={{ marginTop: 10, padding: '8px 14px', borderRadius: 8, background: `${vmc.statusColor}10`, border: `1px solid ${vmc.statusColor}25`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: vmc.statusColor, boxShadow: `0 0 6px ${vmc.statusColor}` }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: vmc.statusColor, fontFamily: 'Syne,sans-serif' }}>{vmc.status}</span>
            </div>
            {/* Probabilité de rebond */}
            <span style={{ fontSize: 10, color: 'var(--tm-text-muted)', fontStyle: 'italic' }}>{reboundProb(curZ)}</span>
          </div>
        )}
        </>)}
      </div>

      {/* ── Stats badges (mode Pro uniquement) ── */}
      {showStats && proMode && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <TooltipBadge tip={`${naturalKappa(curKappa)}\n\nκ élevé = range (bandes plus étroites)\nκ faible = tendance (bandes élargies)`}>
            <div style={{ padding: '5px 10px', borderRadius: 8, background: 'rgba(191,90,242,0.08)', border: '1px solid rgba(191,90,242,0.2)', display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'help' }}>
              <span style={{ fontSize: 9, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono' }}>κ REVERSION</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#BF5AF2', fontFamily: 'JetBrains Mono' }}>{curKappa.toFixed(2)}</span>
              <span style={{ fontSize: 8, color: 'rgba(191,90,242,0.6)' }}>{naturalKappa(curKappa).split(' (')[0]}</span>
            </div>
          </TooltipBadge>

          {vmc && (
            <TooltipBadge tip={`${naturalER(vmc.erSmoothed[n] ?? 0)}\n\nER > 0.65 → signal VMC fiable\nER < 0.40 → marché en range, signal bruité\n\nER = |variation nette| / Σ|variations|`}>
              <div style={{ padding: '5px 10px', borderRadius: 8, background: `${vmc.erColor}0D`, border: `1px solid ${vmc.erColor}25`, display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'help' }}>
                <span style={{ fontSize: 9, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono' }}>ER KAUFMAN</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: vmc.erColor, fontFamily: 'JetBrains Mono' }}>
                  {vmc.erQuality === 'strong' ? '⚡ Fort' : vmc.erQuality === 'moderate' ? '◐ Modéré' : '○ Faible'}
                </span>
                <span style={{ fontSize: 8, color: vmc.erColor, opacity: 0.7 }}>{naturalER(vmc.erSmoothed[n] ?? 0).split(' (')[0]}</span>
              </div>
            </TooltipBadge>
          )}

          <TooltipBadge tip={`Régime actuel : ${curRegime}\n\n🔄 Range → signaux de retour à la moyenne fiables\n📈 Tendance → éviter les contre-trades\n💥 Breakout → fort mouvement imminent`}>
            <div style={{ padding: '5px 10px', borderRadius: 8, background: `${regimeColor}0D`, border: `1px solid ${regimeColor}25`, display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'help' }}>
              <span style={{ fontSize: 9, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono' }}>RÉGIME</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: regimeColor }}>
                {curRegime === 'trending' ? '📈 Tendance' : curRegime === 'breakout' ? '💥 Breakout' : '🔄 Range'}
              </span>
            </div>
          </TooltipBadge>

          {curMean > 0 && (
            <div style={{ padding: '5px 10px', borderRadius: 8, background: 'rgba(0,229,255,0.05)', border: '1px solid rgba(0,229,255,0.15)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono' }}>μ OU</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#00E5FF', fontFamily: 'JetBrains Mono' }}>{fmtP(curMean)}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Confluence Score ── */}
      {showStats && <div style={{ ...C.card, padding: '12px 16px' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg,transparent,rgba(0,229,255,0.15),transparent)' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-text-primary)', fontFamily: 'Syne,sans-serif' }}>
            📊 Confluence Multi-Timeframes
          </span>
          {mtfLoading && <div style={{ width: 12, height: 12, border: '2px solid #2A2F3E', borderTopColor: '#00E5FF', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />}
        </div>

        {/* Score visuel agrégé */}
        {mtfRows.length > 0 && (
          <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 10, background: `${confluenceLabel.color}0D`, border: `1px solid ${confluenceLabel.color}30` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>{conflIcon}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: confluenceLabel.color, fontFamily: 'Syne,sans-serif' }}>
                    Confluence : {confluenceScore}% {confluenceDir !== 'neutral' ? (confluenceDir === 'bullish' ? '▲' : '▼') : ''}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--tm-text-muted)' }}>{confluenceLabel.text}</div>
                </div>
              </div>
            </div>
            {/* Barre interprétée */}
            <div style={{ position: 'relative', height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, width: `${confluenceScore}%`, height: '100%', background: `linear-gradient(90deg, #FF453A, #FF9500 30%, ${confluenceLabel.color})`, borderRadius: 4, transition: 'width 0.6s ease' }} />
              <div style={{ position: 'absolute', left: '30%', top: 0, width: 1, height: '100%', background: 'rgba(255,255,255,0.2)' }} />
              <div style={{ position: 'absolute', left: '60%', top: 0, width: 1, height: '100%', background: 'rgba(255,255,255,0.2)' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
              <span style={{ fontSize: 8, color: '#FF453A', fontFamily: 'JetBrains Mono' }}>Contre-trend</span>
              <span style={{ fontSize: 8, color: '#FF9500', fontFamily: 'JetBrains Mono' }}>Incertain</span>
              <span style={{ fontSize: 8, color: '#34C759', fontFamily: 'JetBrains Mono' }}>Aligné</span>
            </div>
          </div>
        )}

        {/* Table MTF (mode Pro uniquement) */}
        {proMode && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '60px 90px 100px 80px 100px 80px', gap: 4, marginBottom: 6 }}>
              {['TF', 'Z-Score', 'Signal', 'ER', 'VMC Biais', 'Régime'].map(h => (
                <div key={h} style={{ fontSize: 9, fontWeight: 700, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</div>
              ))}
            </div>
            {mtfRows.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--tm-text-muted)', fontSize: 12 }}>Calcul MTF en cours…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {mtfRows.map(row => {
                  const zc = Math.abs(row.zscore) > 2.5 ? '#FF3B30' : Math.abs(row.zscore) > 1.5 ? '#FF9500' : '#8E8E93'
                  const ec = row.excess.includes('ob') ? '#FF3B30' : row.excess.includes('os') ? '#34C759' : '#8E8E93'
                  const erc = row.erScore > 0.65 ? '#34C759' : row.erScore > 0.4 ? '#FF9500' : '#FF453A'
                  const bc = row.vmcBias === 'bullish' ? '#34C759' : row.vmcBias === 'bearish' ? '#FF3B30' : '#8E8E93'
                  const rc = row.regime === 'trending' ? '#FF9500' : row.regime === 'breakout' ? '#BF5AF2' : '#00E5FF'
                  const isActive = row.tf === tf
                  return (
                    <div key={row.tf} onClick={() => setTf(row.tf)} style={{ display: 'grid', gridTemplateColumns: '60px 90px 100px 80px 100px 80px', gap: 4, padding: '6px 8px', borderRadius: 8, cursor: 'pointer', background: isActive ? 'rgba(0,229,255,0.06)' : 'rgba(255,255,255,0.02)', border: `1px solid ${isActive ? 'rgba(0,229,255,0.2)' : 'transparent'}`, transition: 'all 0.15s' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: isActive ? '#00E5FF' : 'var(--tm-text-primary)', fontFamily: 'JetBrains Mono' }}>{row.tf}</span>
                      <TooltipBadge tip={`${naturalZ(row.zscore)}\n${reboundProb(row.zscore)}`}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: zc, fontFamily: 'JetBrains Mono', cursor: 'help' }}>{row.zscore >= 0 ? '+' : ''}{row.zscore.toFixed(2)}σ</span>
                      </TooltipBadge>
                      <span style={{ fontSize: 10, fontWeight: 600, color: ec }}>
                        {row.excess === 'extreme_ob' ? '⚠️ Extrême OB' : row.excess === 'overbought' ? '🔴 Surachat' : row.excess === 'extreme_os' ? '🚀 Extrême OS' : row.excess === 'oversold' ? '🟢 Survente' : '● Neutre'}
                      </span>
                      <TooltipBadge tip={naturalER(row.erScore)}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: erc, fontFamily: 'JetBrains Mono', cursor: 'help' }}>{row.erScore.toFixed(2)} {row.erScore > 0.65 ? '⚡' : row.erScore > 0.4 ? '◐' : '○'}</span>
                      </TooltipBadge>
                      <span style={{ fontSize: 10, fontWeight: 700, color: bc }}>{row.vmcBias === 'bullish' ? '▲ Haussier' : row.vmcBias === 'bearish' ? '▼ Baissier' : '● Neutre'}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: rc }}>{row.regime === 'trending' ? '📈 Trend' : row.regime === 'breakout' ? '💥 Break' : '🔄 Range'}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* Signal historique */}
        {signalHistory.length > 0 && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: 10, color: 'var(--tm-text-muted)', marginBottom: 6, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'JetBrains Mono' }}>Historique signaux</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {signalHistory.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 1 - i * 0.15 }}>
                  <span style={{ fontSize: 9, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono', minWidth: 36 }}>{s.time}</span>
                  <span style={{ fontSize: 10, color: s.color, fontWeight: 600 }}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>}

      {/* ── View selector + TF ── */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {([
          { id: 'channel',    label: '〜 Canal OU',    activeColor: '#00E5FF',  activeBg: 'rgba(0,229,255,0.12)',   activeBorder: 'rgba(0,229,255,0.4)'   },
          { id: 'zscore',     label: '± Z-Score',      activeColor: '#00E5FF',  activeBg: 'rgba(0,229,255,0.12)',   activeBorder: 'rgba(0,229,255,0.4)'   },
          { id: 'vmc',        label: '≋ VMC + ER',     activeColor: '#BF5AF2',  activeBg: 'rgba(191,90,242,0.12)',  activeBorder: 'rgba(191,90,242,0.4)'  },
          { id: 'confluence', label: '🧠 Confluence',  activeColor: '#34C759',  activeBg: 'rgba(52,199,89,0.12)',   activeBorder: 'rgba(52,199,89,0.4)'   },
        ] as const).map(tab => (
          <button key={tab.id} onClick={() => setActiveView(tab.id)} style={{
            padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
            background: activeView === tab.id ? tab.activeBg : 'rgba(255,255,255,0.04)',
            border: `1px solid ${activeView === tab.id ? tab.activeBorder : 'rgba(255,255,255,0.08)'}`,
            color: activeView === tab.id ? tab.activeColor : 'var(--tm-text-muted)', transition: 'all 0.15s',
          }}>{tab.label}</button>
        ))}

        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />

        {TF_OPTIONS.map(opt => (
          <button key={opt.label} onClick={() => setTf(opt.interval)} style={{
            padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer',
            background: tf === opt.interval ? 'rgba(191,90,242,0.15)' : 'transparent',
            border: `1px solid ${tf === opt.interval ? 'rgba(191,90,242,0.5)' : 'rgba(255,255,255,0.07)'}`,
            color: tf === opt.interval ? '#BF5AF2' : 'var(--tm-text-muted)', transition: 'all 0.15s',
          }}>{opt.label}</button>
        ))}
      </div>

      {error && (
        <div style={{ padding: '10px 16px', borderRadius: 10, background: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.3)', color: '#FF3B30', fontSize: 12 }}>⚠️ {error}</div>
      )}

      {/* ── Charts with hover tooltip ── */}
      {loading && !candles.length ? (
        <div style={{ ...C.card, padding: 40, textAlign: 'center' as const, color: 'var(--tm-text-muted)', fontSize: 12 }}>
          <div style={{ width: 20, height: 20, border: '2px solid #2A2F3E', borderTopColor: '#00E5FF', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 8px' }} />
          Calcul du processus OU…
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Legend */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: '6px 12px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px 8px 0 0', border: '1px solid rgba(255,255,255,0.06)' }}>
            {activeView === 'channel' && [
              ['rgba(0,229,255,0.7)', 'μ — Équilibre OU'],
              ['rgba(255,149,0,0.5)', '±1σ — Zone normale'],
              ['rgba(255,59,48,0.6)', '±2σ — Zone d\'excès'],
              ['#22C759', 'Prix sous-évalué'],
              ['#FF3B30', 'Prix surévalué'],
            ].map(([c, l]) => (
              <div key={l as string} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 14, height: 2, background: c as string, borderRadius: 1 }} />
                <span style={{ fontSize: 9, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono' }}>{l as string}</span>
              </div>
            ))}
            {activeView === 'zscore' && [
              ['rgba(255,59,48,0.8)', '> +2.5σ Extrême OB'],
              ['rgba(255,149,0,0.7)', '+1.5 à +2.5σ Surachat'],
              ['rgba(0,229,255,0.6)', 'Zone neutre'],
              ['rgba(42,160,80,0.7)', '-2.5 à -1.5σ Survente'],
              ['rgba(52,199,89,0.8)', '< -2.5σ Extrême OS'],
            ].map(([c, l]) => (
              <div key={l as string} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 10, height: 10, background: c as string, borderRadius: 2 }} />
                <span style={{ fontSize: 9, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono' }}>{l as string}</span>
              </div>
            ))}
            {activeView === 'vmc' && [
              ['#34C759', 'VMC (ER Fort = signal fiable)'],
              ['#FF9500', 'Signal VMC'],
              ['rgba(52,199,89,0.6)', 'Momentum +'],
              ['rgba(255,59,48,0.6)', 'Momentum -'],
            ].map(([c, l]) => (
              <div key={l as string} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 14, height: 2, background: c as string, borderRadius: 1 }} />
                <span style={{ fontSize: 9, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono' }}>{l as string}</span>
              </div>
            ))}
            {activeView === 'confluence' && (
              <span style={{ fontSize: 9, color: 'rgba(52,199,89,0.7)', fontFamily: 'JetBrains Mono' }}>
                🧠 Analyse combinée — Canal OU · VMC+ER{isCrypto ? ' · CVD' : ''}
              </span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {[['#FF9500', '● Tendance'], ['#00E5FF', '● Range'], ['#BF5AF2', '● Breakout']].map(([c, l]) => (
                <span key={l as string} style={{ fontSize: 9, color: c as string, fontFamily: 'JetBrains Mono' }}>{l as string}</span>
              ))}
            </div>
          </div>

          {/* Chart area with hover tooltip */}
          <div style={{ background: '#080C14', borderRadius: '0 0 8px 8px', border: '1px solid rgba(255,255,255,0.06)', borderTop: 'none', overflow: 'hidden', position: 'relative' }}>
            {activeView === 'channel' && viewOu && (
              <>
                <OUChannelChart candles={viewCandles} ou={viewOu} height={220} interval={tf}
                  onHover={d => { isDirectHover.current = d !== null; setHoverData(d) }}
                  hoverIdx={hoverData?.idx ?? null} />
                {hoverData && <HoverTooltip hover={hoverData} candles={viewCandles} ou={viewOu} />}
              </>
            )}
            {activeView === 'zscore' && viewOu && (
              <>
                <ZScoreChart zscore={viewOu.zscore} excess={viewOu.excess} height={130} interval={tf}
                  onHover={d => { isDirectHover.current = d !== null; setHoverData(d) }}
                  candles={viewCandles} hoverIdx={hoverData?.idx ?? null} />
                {hoverData && viewOu && (
                  <div style={{ position: 'absolute', top: 8, left: Math.min(hoverData.x + 8, 240), background: 'rgba(8,12,20,0.97)', border: `1px solid rgba(0,229,255,0.2)`, borderRadius: 10, padding: '10px 14px', pointerEvents: 'none', zIndex: 50, minWidth: 200, backdropFilter: 'blur(12px)' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: hoverData.z > 1.5 ? '#FF3B30' : hoverData.z < -1.5 ? '#34C759' : '#8E8E93', marginBottom: 4 }}>{naturalZ(hoverData.z)}</div>
                    <div style={{ fontSize: 10, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono' }}>Z-Score : <span style={{ color: 'var(--tm-text-primary)', fontWeight: 700 }}>{hoverData.z >= 0 ? '+' : ''}{hoverData.z.toFixed(2)}σ</span></div>
                    <div style={{ fontSize: 10, color: '#BF5AF2', marginTop: 4, fontStyle: 'italic' }}>{reboundProb(hoverData.z)}</div>
                  </div>
                )}
              </>
            )}
            {activeView === 'vmc' && viewVmc && (
              <VMCEnhancedChart vmc={viewVmc} height={150} interval={tf} candles={viewCandles} hoverIdx={hoverData?.idx ?? null}
                onHover={d => { isDirectHover.current = d !== null; setHoverData(d) }} />
            )}
            {activeView === 'confluence' && viewOu && viewVmc && (
              <div style={{ padding: '14px 16px', overflowY: 'auto', maxHeight: 420 }}>
                <ConfluenceView ou={viewOu} vmc={viewVmc} candles={viewCandles} isCrypto={isCrypto} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Theory (mode Pro uniquement) ── */}
      {proMode && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(0,229,255,0.03)', border: '1px solid rgba(0,229,255,0.08)', fontSize: 10, color: 'rgba(255,255,255,0.35)', lineHeight: 1.7, fontFamily: 'JetBrains Mono' }}>
          <span style={{ color: '#00E5FF' }}>OU</span>: dX = κ(μ−X)dt + σdW · Bandes ±1σ/±2σ adaptatives
          &nbsp;|&nbsp;
          <span style={{ color: '#BF5AF2' }}>κ</span>: vitesse de retour à la moyenne (élevée = range)
          &nbsp;|&nbsp;
          <span style={{ color: '#FF9500' }}>ER Kaufman</span>: |Δprix| / Σ|Δ| — 1=tendance pure, 0=bruit
          &nbsp;|&nbsp;
          <span style={{ color: '#34C759' }}>VMC+ER</span>: signal amplifié par la qualité du mouvement
        </div>
      )}
    </div>
  )
}
