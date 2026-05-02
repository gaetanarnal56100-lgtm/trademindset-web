// ─── Decision Engine — synthétise tous les signaux en une décision claire ────
// Logique pure, zéro dépendance React

export interface DecisionInputs {
  mtfScore:        number   // −100..+100 (MTFSnapshot.globalScore)
  mtfConfluence:   number   // 0..100 % (MTFSnapshot.confluence)
  mtfSignal:       string   // 'BUY'|'BULLISH'|'NEUTRAL'|'BEARISH'|'SELL'
  ouExcess:        string   // 'none'|'overbought'|'oversold'|'extreme_ob'|'extreme_os'
  ouRegime:        string   // 'ranging'|'trending'|'breakout'
  ouZ:             number   // z-score du processus OU
  vmcStatus:       string   // 'BUY'|'SELL'|'NEUTRAL'|'OVERBOUGHT'|'OVERSOLD'
  confluenceSignal:string   // 'long'|'short'|'absorption'|'trap'|'setup_long'|'setup_short'|'neutral'
  whalePressure:   number   // −1..+1 (0 si pas crypto)
  liqBias:         number   // liqLong1h − liqShort1h (USD)
  isCrypto:        boolean
  recentSignals:   string[] // derniers types de signaux depuis SignalNotificationService
}

export interface DecisionOutput {
  score:          number   // 0..100
  bias:           'BULLISH' | 'BEARISH' | 'NEUTRAL'
  biasColor:      string
  readiness:      'OPTIMAL' | 'VALID' | 'NEUTRE' | 'NO TRADE'
  readinessColor: string
  readinessEmoji: string
  reasons:        string[] // 2–4 bullets (les plus significatifs)
  risks:          string[] // 0–2 alerts
  summary:        string[] // 2-3 tokens courts pour l'affichage compact
}

export function computeDecision(inputs: DecisionInputs): DecisionOutput {
  const {
    mtfScore, mtfConfluence, mtfSignal,
    ouExcess, ouRegime, ouZ,
    vmcStatus, confluenceSignal,
    whalePressure, liqBias,
    isCrypto,
  } = inputs

  // ── 1. Normaliser chaque signal en 0..100 ────────────────────────────────

  // MTF : −100..+100 → 0..100
  const mtfNorm = Math.max(0, Math.min(100, (mtfScore + 100) / 2))

  // OU excess : positions discrètes + légère correction z-score quand neutre
  const ouBase: Record<string, number> = {
    extreme_os: 90, oversold: 75, none: 50, overbought: 25, extreme_ob: 10,
  }
  const ouScore = Math.max(0, Math.min(100,
    (ouBase[ouExcess] ?? 50) + (ouExcess === 'none' ? Math.max(-15, Math.min(15, -ouZ * 5)) : 0)
  ))

  // VMC
  const vmcMap: Record<string, number> = {
    OVERSOLD: 85, BUY: 78, NEUTRAL: 50, SELL: 22, OVERBOUGHT: 15,
  }
  const vmcScore = vmcMap[vmcStatus] ?? 50

  // Confluence OU+VMC+CVD
  const confMap: Record<string, number> = {
    long: 85, setup_long: 70, absorption: 55,
    neutral: 50, trap: 45,
    setup_short: 30, short: 15,
  }
  const confScore = confMap[confluenceSignal] ?? 50

  // Whale pressure (crypto seulement) : −1..+1 → 0..100
  const whaleScore = isCrypto ? Math.max(0, Math.min(100, (whalePressure + 1) / 2 * 100)) : 50

  // Liquidations bias (crypto) : + longs liq → pression baissière → score < 50
  // + shorts liq → pression haussière → score > 50
  const liqScore = isCrypto && Math.abs(liqBias) > 1000
    ? (liqBias < 0 ? 65 : 35)  // liqBias < 0 = plus de longs liquidés = signal bearish pour liqBias > 0 shorts liq = haussier
    : 50

  // ── 2. Moyenne pondérée ──────────────────────────────────────────────────
  let score: number
  if (isCrypto) {
    score = mtfNorm * 0.30 + ouScore * 0.20 + vmcScore * 0.15 + confScore * 0.15 + whaleScore * 0.12 + liqScore * 0.08
  } else {
    // Redistribuer le poids crypto vers MTF + OU
    score = mtfNorm * 0.425 + ouScore * 0.275 + vmcScore * 0.15 + confScore * 0.15
  }
  score = Math.max(0, Math.min(100, Math.round(score)))

  // ── 3. Biais ────────────────────────────────────────────────────────────
  const bias: DecisionOutput['bias'] = score >= 60 ? 'BULLISH' : score <= 40 ? 'BEARISH' : 'NEUTRAL'
  const biasColor = bias === 'BULLISH' ? '#34C759' : bias === 'BEARISH' ? '#FF3B30' : '#8E8E93'

  // ── 4. Readiness — avec pénalité si signal ambiguë ──────────────────────
  const isConflicting =
    (bias === 'BULLISH' && (ouExcess === 'extreme_ob' || ouExcess === 'overbought')) ||
    (bias === 'BEARISH' && (ouExcess === 'extreme_os' || ouExcess === 'oversold'))
  const effective = isConflicting ? score - 10 : score

  const readiness: DecisionOutput['readiness'] =
    effective >= 75 ? 'OPTIMAL'
    : effective >= 58 ? 'VALID'
    : effective >= 42 ? 'NEUTRE'
    : 'NO TRADE'

  const readinessColor =
    readiness === 'OPTIMAL'  ? '#34C759'
    : readiness === 'VALID'  ? '#FF9500'
    : readiness === 'NEUTRE' ? '#8E8E93'
    : '#FF3B30'

  const readinessEmoji =
    readiness === 'OPTIMAL'  ? '✅'
    : readiness === 'VALID'  ? '🟡'
    : readiness === 'NEUTRE' ? '⚪'
    : '🔴'

  // ── 5. Raisons (triées par poids décroissant) ───────────────────────────
  const cands: { w: number; text: string }[] = []

  // MTF
  const mtfAbs = Math.abs(mtfScore)
  if (mtfAbs > 55) {
    const dir = mtfSignal === 'BUY' || mtfSignal === 'BULLISH' ? 'haussier' : 'baissier'
    cands.push({ w: 3, text: `MTF aligné ${dir} ${mtfConfluence.toFixed(0)}%` })
  } else if (mtfAbs > 25) {
    cands.push({ w: 2, text: `MTF partiellement ${mtfScore > 0 ? 'haussier' : 'baissier'} ${mtfConfluence.toFixed(0)}%` })
  }

  // OU excess
  const ouText: Partial<Record<string, string>> = {
    extreme_os: 'OU survente extrême 🚀',
    oversold:   `OU survente (${ouZ.toFixed(1)}σ)`,
    extreme_ob: 'OU surachat extrême ⚠️',
    overbought: `OU surachat (${ouZ.toFixed(1)}σ)`,
  }
  if (ouText[ouExcess]) {
    cands.push({ w: ouExcess.includes('extreme') ? 3 : 2, text: ouText[ouExcess]! })
  } else if (ouRegime !== 'ranging') {
    cands.push({ w: 1, text: `OU régime ${ouRegime === 'trending' ? 'tendance' : 'breakout'}` })
  }

  // VMC
  const vmcText: Partial<Record<string, { w: number; t: string }>> = {
    BUY:        { w: 2, t: 'VMC signal achat' },
    SELL:       { w: 2, t: 'VMC signal vente' },
    OVERSOLD:   { w: 3, t: 'VMC en survente' },
    OVERBOUGHT: { w: 3, t: 'VMC en surachat' },
  }
  if (vmcText[vmcStatus]) cands.push({ w: vmcText[vmcStatus]!.w, text: vmcText[vmcStatus]!.t })

  // Confluence
  const confText: Partial<Record<string, string>> = {
    long:        'Confluence LONG confirmée',
    short:       'Confluence SHORT confirmée',
    setup_long:  'Setup LONG en formation',
    setup_short: 'Setup SHORT en formation',
    absorption:  'Absorption smart money',
    trap:        'Piège détecté',
  }
  if (confText[confluenceSignal]) {
    cands.push({ w: confluenceSignal === 'long' || confluenceSignal === 'short' ? 3 : 2, text: confText[confluenceSignal]! })
  }

  // Whale (crypto)
  if (isCrypto && Math.abs(whalePressure) > 0.25) {
    cands.push({ w: 2, text: `Whale ${whalePressure > 0 ? 'accumulation ↑' : 'distribution ↓'}` })
  }

  cands.sort((a, b) => b.w - a.w)
  const reasons = cands.slice(0, 4).map(r => r.text).filter(Boolean)

  // ── 6. Risques ──────────────────────────────────────────────────────────
  const risks: string[] = []
  if (ouRegime === 'trending' && bias !== 'NEUTRAL') risks.push('Régime tendance — contre-trend risqué')
  if (mtfAbs < 15) risks.push('MTF faible conviction')
  if (isCrypto && Math.abs(whalePressure) < 0.05 && mtfAbs > 30) risks.push('Activité whale nulle')
  if (confluenceSignal === 'absorption' || confluenceSignal === 'trap') risks.push('Signal ambigu (absorption/piège possible)')

  // ── 7. Résumé compact (3 tokens max) ────────────────────────────────────
  const summary = [
    `MTF ${mtfConfluence.toFixed(0)}%`,
    ouExcess !== 'none'
      ? `OU ${ouZ >= 0 ? '+' : ''}${ouZ.toFixed(1)}σ`
      : `OU ${ouRegime}`,
    isCrypto && Math.abs(whalePressure) > 0.1
      ? `Whale ${whalePressure > 0 ? '↑' : '↓'}`
      : vmcStatus !== 'NEUTRAL' ? `VMC ${vmcStatus}` : '',
  ].filter(Boolean)

  return { score, bias, biasColor, readiness, readinessColor, readinessEmoji, reasons, risks, summary }
}
