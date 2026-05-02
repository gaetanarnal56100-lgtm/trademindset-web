// AnalysisPDFExport.ts — Rapport PDF 2 pages (Décision + Plan de Trade)
// ASCII-only text (pas d'emoji ni Unicode > Latin-1) pour compatibilité jsPDF Helvetica

import { jsPDF } from 'jspdf'

// ── Types exportés ────────────────────────────────────────────────────────────

export interface MTFReadingPDF {
  tf: string
  rsi: number
  rsiNorm: number
  vmc: number
  score: number
  signal: string
  divergence: boolean
}

export interface MTFSnapshotPDF {
  readings: MTFReadingPDF[]
  globalRSI: number
  globalVMC: number
  globalScore: number
  globalSignal: string
  confluence: number
  isTurningUp: boolean
  isTurningDown: boolean
}

export interface KeyLevelPDF {
  price: number
  type: 'resistance' | 'support' | 'pivot' | 'orderblock_bull' | 'orderblock_bear' | 'high' | 'low'
  label: string
  strength: 'strong' | 'medium' | 'weak'
  touches?: number
}

export interface TradeScenarioPDF {
  entry?: number
  stop?: number
  tp1?: number; tp2?: number; tp3?: number
  tp1RR?: string; tp2RR?: string; tp3RR?: string
  signalStrength?: string
  entryType?: string
}

export interface TradePlanPDF {
  bull: TradeScenarioPDF
  bear: TradeScenarioPDF
  globalScore: number
  bullProb: number
  riskLevel: string
  context: string
}

export interface GPTSectionsPDF {
  riskLines: string[]
  timingLines: string[]
  technicalLines: string[]
  infoLines: string[]
  fundamentalLines: string[]
  scoreExplanation: string
}

export interface AnalysisPDFData {
  symbol: string
  price: number
  change24h?: number
  timestamp: Date
  mtfSnap?: MTFSnapshotPDF
  keyLevels?: KeyLevelPDF[]
  tradePlan?: TradePlanPDF
  gptSections?: GPTSectionsPDF
  wtStatus?: string
  wtValues?: { wt1: number; wt2: number }
  vmcStatus?: string
  chartImageDataUrl?: string | null
  // Decision Assistant fields
  decisionScore?: number
  decisionBias?: string      // 'BULLISH'|'BEARISH'|'NEUTRAL'
  decisionReadiness?: string // 'OPTIMAL'|'VALID'|'NEUTRE'|'NO TRADE'
  decisionReasons?: string[]
  decisionRisks?: string[]
  ouExcess?: string
  ouZ?: number
}

// ── Color palette ─────────────────────────────────────────────────────────────

type RGB = [number, number, number]

const C = {
  bg:      [13, 17, 23]       as RGB,
  bg2:     [17, 21, 32]       as RGB,
  bg3:     [24, 30, 48]       as RGB,
  border:  [30, 35, 52]       as RGB,
  border2: [42, 47, 62]       as RGB,
  text1:   [230, 234, 240]    as RGB,
  text2:   [150, 158, 180]    as RGB,
  textMut: [80, 88, 110]      as RGB,
  profit:  [34, 199, 89]      as RGB,
  loss:    [255, 70, 60]      as RGB,
  accent:  [0, 215, 240]      as RGB,
  warning: [255, 155, 30]     as RGB,
  purple:  [185, 100, 240]    as RGB,
  gold:    [220, 180, 0]      as RGB,
  white:   [255, 255, 255]    as RGB,
}

// ── Dimensions ────────────────────────────────────────────────────────────────

const PW  = 210   // page width mm (A4)
const PH  = 297   // page height mm (A4)
const ML  = 14    // left margin
const MR  = 14    // right margin
const MT  = 20    // top margin (after header)
const CW  = PW - ML - MR  // content width (182mm)
const FOOTER_Y = PH - 11  // footer separator y

// ── Low-level helpers ─────────────────────────────────────────────────────────

function fill(doc: jsPDF, rgb: RGB) { doc.setFillColor(rgb[0], rgb[1], rgb[2]) }
function stroke(doc: jsPDF, rgb: RGB) { doc.setDrawColor(rgb[0], rgb[1], rgb[2]) }
function color(doc: jsPDF, rgb: RGB) { doc.setTextColor(rgb[0], rgb[1], rgb[2]) }

function rect(doc: jsPDF, x: number, y: number, w: number, h: number, bg: RGB, r = 0) {
  fill(doc, bg); stroke(doc, bg)
  if (r > 0) doc.roundedRect(x, y, w, h, r, r, 'F')
  else doc.rect(x, y, w, h, 'F')
}

function rectBorder(doc: jsPDF, x: number, y: number, w: number, h: number, bg: RGB, br: RGB, r = 0, lw = 0.3) {
  fill(doc, bg); stroke(doc, br)
  doc.setLineWidth(lw)
  if (r > 0) doc.roundedRect(x, y, w, h, r, r, 'FD')
  else doc.rect(x, y, w, h, 'FD')
}

function txt(doc: jsPDF, text: string, x: number, y: number, size: number, rgb: RGB, align: 'left'|'center'|'right' = 'left', maxWidth?: number) {
  doc.setFontSize(size)
  color(doc, rgb)
  const opts: { align?: string; maxWidth?: number } = { align }
  if (maxWidth) opts.maxWidth = maxWidth
  doc.text(text, x, y, opts as Parameters<typeof doc.text>[3])
}

function ln(doc: jsPDF, x1: number, y1: number, x2: number, y2: number, rgb: RGB, lw = 0.3) {
  stroke(doc, rgb); doc.setLineWidth(lw); doc.line(x1, y1, x2, y2)
}

function dot(doc: jsPDF, cx: number, cy: number, r: number, rgb: RGB) {
  fill(doc, rgb); stroke(doc, rgb)
  doc.circle(cx, cy, r, 'F')
}

function fillPage(doc: jsPDF) { rect(doc, 0, 0, PW, PH, C.bg) }

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtPrice(p: number): string {
  if (!p) return '--'
  if (p >= 10000) return '$' + p.toLocaleString('fr-FR', { maximumFractionDigits: 0 })
  if (p >= 100)   return '$' + p.toFixed(2)
  if (p >= 1)     return '$' + p.toFixed(4)
  return '$' + p.toFixed(6)
}

function fmtPct(pct: number): string {
  return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'
}

function pctDiff(price: number, current: number): string {
  if (!current) return '--'
  const pct = ((price - current) / current) * 100
  return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'
}

function signalColor(signal: string): RGB {
  const s = (signal ?? '').toUpperCase()
  if (s === 'BUY' || s === 'STRONG BUY') return C.profit
  if (s === 'BULLISH') return [80, 210, 100] as RGB
  if (s === 'BEARISH') return [255, 120, 80] as RGB
  if (s === 'SELL' || s === 'STRONG SELL') return C.loss
  return C.text2
}

function biasColor(bias: string): RGB {
  if (bias === 'BULLISH') return C.profit
  if (bias === 'BEARISH') return C.loss
  return C.text2
}

function readinessColor(r: string): RGB {
  if (r === 'OPTIMAL')  return C.profit
  if (r === 'VALID')    return C.warning
  if (r === 'NEUTRE')   return C.text2
  return C.loss
}

function levelTypeLabel(type: string): string {
  const m: Record<string, string> = {
    resistance: 'Resistance', support: 'Support', pivot: 'Pivot',
    orderblock_bull: 'OB Haussier', orderblock_bear: 'OB Baissier',
    high: 'Plus Haut', low: 'Plus Bas',
  }
  return m[type] ?? type
}

function levelTypeColor(type: string): RGB {
  const m: Record<string, RGB> = {
    resistance: C.loss, support: C.profit, pivot: C.warning,
    orderblock_bull: [80,200,100] as RGB, orderblock_bear: [220,80,80] as RGB,
    high: C.accent, low: C.purple,
  }
  return m[type] ?? C.text2
}

// Strength as drawn dots (3 circles)
function drawStrengthDots(doc: jsPDF, x: number, y: number, strength: string) {
  const full = strength === 'strong' ? 3 : strength === 'medium' ? 2 : 1
  const col: RGB = strength === 'strong' ? C.profit : strength === 'medium' ? C.warning : C.textMut
  for (let i = 0; i < 3; i++) {
    const dotCol: RGB = i < full ? col : C.border2
    dot(doc, x + i * 4, y, 1.2, dotCol)
  }
}

// ── Common page elements ──────────────────────────────────────────────────────

function drawHeader(doc: jsPDF, title: string, page: number, total: number) {
  // Accent bar
  fill(doc, C.accent); doc.rect(0, 0, PW, 1.5, 'F')
  // Header bg
  rect(doc, 0, 1.5, PW, 14, C.bg2)
  // Branding
  txt(doc, 'TM', ML, 10.5, 9, C.accent, 'left')
  txt(doc, 'TradeMindset', ML + 8, 10.5, 7, C.text2, 'left')
  // Title
  txt(doc, title.toUpperCase(), PW / 2, 10.5, 7.5, C.text1, 'center')
  // Page number
  txt(doc, `${page} / ${total}`, PW - MR, 10.5, 7, C.textMut, 'right')
  // Separator
  ln(doc, 0, 15.5, PW, 15.5, C.border, 0.5)
}

function drawFooter(doc: jsPDF, symbol: string, ts: Date) {
  ln(doc, 0, FOOTER_Y, PW, FOOTER_Y, C.border, 0.3)
  const dateStr = ts.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  txt(doc, symbol, ML, FOOTER_Y + 4.5, 6.5, C.textMut, 'left')
  txt(doc, dateStr, PW / 2, FOOTER_Y + 4.5, 6.5, C.textMut, 'center')
  txt(doc, 'trademindset.app', PW - MR, FOOTER_Y + 4.5, 6.5, C.textMut, 'right')
}

function sectionHead(doc: jsPDF, label: string, y: number): number {
  rect(doc, ML, y, CW, 6.5, C.bg3, 2)
  txt(doc, label.toUpperCase(), ML + 5, y + 4.5, 6.5, C.accent, 'left')
  return y + 9
}

// ────────────────────────────────────────────────────────────────────────────
// PAGE 1 — Décision & Analyse
// ────────────────────────────────────────────────────────────────────────────

function drawPage1(doc: jsPDF, data: AnalysisPDFData) {
  fillPage(doc)
  drawHeader(doc, 'Decision & Analyse', 1, 2)
  drawFooter(doc, data.symbol, data.timestamp)

  let y = MT

  // ── Hero : symbol + prix ──────────────────────────────────────────────────
  rectBorder(doc, ML, y, CW, 22, C.bg2, C.border, 3)

  txt(doc, data.symbol, ML + 8, y + 8.5, 18, C.white, 'left')
  txt(doc, fmtPrice(data.price), ML + 8, y + 17.5, 12, C.profit, 'left')

  if (data.change24h !== undefined) {
    const chCol: RGB = data.change24h >= 0 ? C.profit : C.loss
    txt(doc, fmtPct(data.change24h) + ' (24h)', ML + 58, y + 17.5, 9.5, chCol, 'left')
  }

  const ts = data.timestamp.toLocaleDateString('fr-FR', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
  txt(doc, ts, PW - MR - 6, y + 8.5, 7.5, C.text2, 'right')

  y += 26

  // ── Bloc Décision ─────────────────────────────────────────────────────────
  const bias      = data.decisionBias      ?? 'NEUTRAL'
  const readiness = data.decisionReadiness ?? '--'
  const score     = data.decisionScore     ?? 50
  const reasons   = data.decisionReasons   ?? []
  const risks     = data.decisionRisks     ?? []
  const bCol      = biasColor(bias)
  const rCol      = readinessColor(readiness)

  const decH = 68
  rectBorder(doc, ML, y, CW, decH, C.bg2, bCol, 3, 0.5)

  // ── Ligne 1 : Biais + Readiness + Score ────────────────────────────────
  const bW = 56, rW = 50, sW = CW - bW - rW - 12

  // Bias box
  rectBorder(doc, ML + 4, y + 4, bW, 16, C.bg3, bCol, 2, 0.5)
  txt(doc, 'BIAIS', ML + 4 + bW/2, y + 8.5, 5.5, C.text2, 'center')
  txt(doc, bias, ML + 4 + bW/2, y + 16.5, 11, bCol, 'center')

  // Readiness box
  const rX = ML + 4 + bW + 4
  rectBorder(doc, rX, y + 4, rW, 16, C.bg3, rCol, 2, 0.5)
  txt(doc, 'READINESS', rX + rW/2, y + 8.5, 5.5, C.text2, 'center')
  txt(doc, readiness, rX + rW/2, y + 16.5, 9, rCol, 'center')

  // Score box
  const sX = rX + rW + 4
  rectBorder(doc, sX, y + 4, sW, 16, C.bg3, C.border2, 2, 0.3)
  txt(doc, 'SCORE', sX + sW/2, y + 8.5, 5.5, C.text2, 'center')
  txt(doc, `${score}/100`, sX + sW/2, y + 16.5, 11, bCol, 'center')

  // ── Score bar ──────────────────────────────────────────────────────────
  const barY   = y + 23
  const barH   = 5
  const barX   = ML + 4
  const barW   = CW - 8

  // Background
  rect(doc, barX, barY, barW, barH, C.bg3, 2)

  // Gradient sections (3 colored rects)
  const third = barW / 3
  fill(doc, C.loss);    doc.rect(barX,             barY, third,  barH, 'F')
  fill(doc, C.warning); doc.rect(barX + third,     barY, third,  barH, 'F')
  fill(doc, C.profit);  doc.rect(barX + third * 2, barY, third,  barH, 'F')

  // Mask right of score (dark overlay)
  const fillW = (score / 100) * barW
  rect(doc, barX + fillW, barY, barW - fillW, barH, [13, 17, 23] as RGB)
  rect(doc, barX + fillW, barY, barW - fillW, barH, C.bg3)

  // Rounded corners reclip
  stroke(doc, C.bg3); doc.setLineWidth(0.3)
  doc.roundedRect(barX, barY, barW, barH, 2, 2, 'D')

  // Indicator dot
  dot(doc, barX + fillW, barY + barH / 2, 3, bCol)
  // Labels
  txt(doc, 'BEARISH', barX, barY + barH + 4.5, 5, C.loss, 'left')
  txt(doc, `${score}`, barX + barW / 2, barY + barH + 4.5, 5, C.text2, 'center')
  txt(doc, 'BULLISH', barX + barW, barY + barH + 4.5, 5, C.profit, 'right')

  // ── Raisons + Risques ──────────────────────────────────────────────────
  const colY   = barY + barH + 11
  const halfCW = (CW - 10) / 2

  // Raisons
  txt(doc, 'POURQUOI', ML + 4, colY, 5.5, C.text2, 'left')
  let ry = colY + 5
  if (reasons.length === 0) {
    txt(doc, 'Donnees insuffisantes', ML + 4, ry + 3, 6.5, C.textMut, 'left')
  } else {
    for (const r of reasons.slice(0, 4)) {
      dot(doc, ML + 6, ry + 1.5, 1.1, C.profit)
      txt(doc, r, ML + 10, ry + 3, 6.5, C.text1, 'left', halfCW - 10)
      ry += 7
    }
  }

  // Risques
  const riskX = ML + 4 + halfCW + 4
  txt(doc, 'RISQUES', riskX, colY, 5.5, C.text2, 'left')
  let rkY = colY + 5
  if (risks.length === 0) {
    dot(doc, riskX + 2, rkY + 1.5, 1.1, C.profit)
    txt(doc, 'Aucune alerte', riskX + 6, rkY + 3, 6.5, C.profit, 'left')
  } else {
    for (const rk of risks.slice(0, 3)) {
      // Draw warning triangle as simple square
      fill(doc, C.warning); stroke(doc, C.warning)
      doc.rect(riskX + 2 - 1.2, rkY + 0.3, 2.4, 2.4, 'F')
      txt(doc, rk, riskX + 6, rkY + 3, 6.5, C.text1, 'left', halfCW - 10)
      rkY += 7
    }
  }

  y += decH + 5

  // ── Strip de signaux ──────────────────────────────────────────────────────
  y = sectionHead(doc, 'Signaux Principaux', y)

  const snap   = data.mtfSnap
  const boxW4  = (CW - 9) / 4
  const boxH4  = 18

  const signals = [
    {
      label: 'MTF GLOBAL',
      value: snap?.globalSignal ?? '--',
      sub:   snap ? `Confluence ${snap.confluence}%` : '',
      col:   snap ? signalColor(snap.globalSignal) : C.textMut,
    },
    {
      label: 'WAVETREND',
      value: data.wtStatus ?? '--',
      sub:   data.wtValues ? `WT1 ${data.wtValues.wt1.toFixed(1)}  WT2 ${data.wtValues.wt2.toFixed(1)}` : '',
      col:   data.wtStatus?.includes('BULL') ? C.profit : data.wtStatus?.includes('BEAR') ? C.loss : C.text2,
    },
    {
      label: 'VMC',
      value: data.vmcStatus ?? '--',
      sub:   '',
      col:   (data.vmcStatus?.includes('BUY') || data.vmcStatus?.includes('OVERS')) ? C.profit
             : (data.vmcStatus?.includes('SELL') || data.vmcStatus?.includes('OVERB')) ? C.loss : C.text2,
    },
    {
      label: 'OU / Z-SCORE',
      value: data.ouExcess && data.ouExcess !== 'none'
               ? data.ouExcess.replace('extreme_', 'EXT ').replace('_', ' ').toUpperCase()
               : 'NEUTRE',
      sub:   data.ouZ !== undefined ? `z = ${data.ouZ >= 0 ? '+' : ''}${data.ouZ.toFixed(2)}` : '',
      col:   data.ouExcess?.includes('os') ? C.profit
             : data.ouExcess?.includes('ob') ? C.loss : C.text2,
    },
  ]

  let bx = ML
  for (const sig of signals) {
    rectBorder(doc, bx, y, boxW4, boxH4, C.bg2, sig.col, 2, 0.4)
    txt(doc, sig.label, bx + boxW4 / 2, y + 5,  5, C.text2, 'center')
    txt(doc, sig.value, bx + boxW4 / 2, y + 12, 8, sig.col, 'center')
    if (sig.sub) txt(doc, sig.sub, bx + boxW4 / 2, y + 17, 5.5, C.textMut, 'center')
    bx += boxW4 + 3
  }

  y += boxH4 + 6

  // ── Chart ─────────────────────────────────────────────────────────────────
  const chartMaxH = FOOTER_Y - 14 - y - 2
  const levelsH   = data.keyLevels && data.keyLevels.length > 0 ? 56 : 0
  const chartH    = Math.max(40, chartMaxH - levelsH)

  y = sectionHead(doc, 'Graphique — ' + data.symbol, y)

  if (data.chartImageDataUrl) {
    try {
      doc.addImage(data.chartImageDataUrl, 'PNG', ML, y, CW, chartH)
    } catch {
      rectBorder(doc, ML, y, CW, chartH, C.bg2, C.border, 3)
      txt(doc, 'Image graphique non disponible', PW / 2, y + chartH / 2, 9, C.textMut, 'center')
    }
    y += chartH + 4
  } else {
    rectBorder(doc, ML, y, CW, 30, C.bg2, C.border, 3)
    txt(doc, 'Graphique non capture (utiliser LightweightChart)', PW / 2, y + 17, 8, C.textMut, 'center')
    y += 34
  }

  // ── Niveaux clés compact ─────────────────────────────────────────────────
  if (data.keyLevels && data.keyLevels.length > 0) {
    y = sectionHead(doc, 'Niveaux Cles', y)

    const levels = [...data.keyLevels]
      .sort((a, b) => b.price - a.price)
      .slice(0, 7)

    const colWidths = [28, 36, 36, 26, 22, 28]
    const colLabels = ['Label', 'Type', 'Prix', '% du prix', 'Force', 'Touches']
    const rowH = 7.5
    const hdrH = 6.5

    // Header
    rect(doc, ML, y, CW, hdrH, C.bg3)
    let cx = ML + 3
    for (let i = 0; i < colLabels.length; i++) {
      txt(doc, colLabels[i], cx, y + 4.5, 5.5, C.text2, 'left')
      cx += colWidths[i]
    }
    y += hdrH

    for (let i = 0; i < levels.length; i++) {
      if (y + rowH > FOOTER_Y - 12) break
      const lv    = levels[i]
      const lvCol = levelTypeColor(lv.type)
      const rowBg: RGB = i % 2 === 0 ? C.bg2 : C.bg
      rect(doc, ML, y, CW, rowH, rowBg)
      ln(doc, ML, y, ML + CW, y, C.border, 0.12)
      rect(doc, ML, y, 2, rowH, lvCol)

      const ry = y + 5.2
      cx = ML + 5
      txt(doc, lv.label,                 cx,      ry, 6.5, C.text1, 'left'); cx += colWidths[0]
      txt(doc, levelTypeLabel(lv.type),  cx,      ry, 6.5, lvCol,   'left'); cx += colWidths[1]
      txt(doc, fmtPrice(lv.price),       cx,      ry, 6.5, C.white, 'left'); cx += colWidths[2]
      const pct    = pctDiff(lv.price, data.price)
      const pctCol: RGB = pct.startsWith('+') ? C.loss : C.profit
      txt(doc, pct,                      cx,      ry, 6.5, pctCol,  'left'); cx += colWidths[3]
      drawStrengthDots(doc, cx, ry - 1.5, lv.strength)                      ; cx += colWidths[4]
      txt(doc, lv.touches !== undefined ? String(lv.touches) : '--', cx, ry, 6.5, C.text2, 'left')
      y += rowH
    }
    ln(doc, ML, y, ML + CW, y, C.border, 0.3)
  }
}

// ────────────────────────────────────────────────────────────────────────────
// PAGE 2 — Plan de Trade
// ────────────────────────────────────────────────────────────────────────────

function drawPage2(doc: jsPDF, data: AnalysisPDFData) {
  fillPage(doc)
  drawHeader(doc, 'Plan de Trade', 2, 2)
  drawFooter(doc, data.symbol, data.timestamp)

  let y = MT

  // ── MTF compact table ─────────────────────────────────────────────────────
  const snap = data.mtfSnap
  if (snap && snap.readings.length > 0) {
    // Global summary row
    const sigCol = signalColor(snap.globalSignal)
    rectBorder(doc, ML, y, CW, 16, C.bg2, sigCol, 3, 0.5)
    txt(doc, snap.globalSignal, ML + 8, y + 10, 12, sigCol, 'left')
    txt(doc, `Score: ${snap.globalScore >= 0 ? '+' : ''}${snap.globalScore.toFixed(1)}`, ML + 65, y + 10, 9, C.text1, 'left')
    txt(doc, `Confluence: ${snap.confluence}%`, ML + 115, y + 10, 9, snap.confluence >= 70 ? C.profit : C.warning, 'left')
    const turn = snap.isTurningUp ? '^ Retournement haussier' : snap.isTurningDown ? 'v Retournement baissier' : ''
    if (turn) {
      const turnCol: RGB = snap.isTurningUp ? C.profit : C.loss
      txt(doc, turn, PW - MR - 4, y + 10, 7.5, turnCol, 'right')
    }
    y += 20

    y = sectionHead(doc, 'Multi-Timeframes', y)

    // Select up to 8 most relevant TFs
    const rows = snap.readings.slice(0, 8)
    const mtfCols = [
      { label: 'TF',        w: 18 },
      { label: 'Signal',    w: 36 },
      { label: 'RSI',       w: 22 },
      { label: 'VMC',       w: 22 },
      { label: 'Score',     w: 26 },
      { label: 'Etat RSI',  w: 32 },
      { label: 'Div.',      w: 20 },
    ]
    const rowH = 8.5
    const hdrH = 7

    rect(doc, ML, y, CW, hdrH, C.bg3)
    let cx = ML + 3
    for (const col of mtfCols) {
      txt(doc, col.label, cx, y + 5, 6, C.text2, 'left')
      cx += col.w
    }
    y += hdrH

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const rowBg: RGB = i % 2 === 0 ? C.bg2 : C.bg
      rect(doc, ML, y, CW, rowH, rowBg)
      ln(doc, ML, y, ML + CW, y, C.border, 0.12)

      const rSigCol = signalColor(r.signal)
      const rsiCol: RGB = r.rsi > 70 ? C.loss : r.rsi < 30 ? C.profit : C.text1
      const vmcCol: RGB = r.vmc > 40 ? C.loss : r.vmc < -40 ? C.profit : C.text1

      cx = ML + 3
      const ry = y + 5.8
      txt(doc, r.tf, cx, ry, 7.5, C.text1, 'left');                    cx += mtfCols[0].w
      txt(doc, r.signal, cx, ry, 7, rSigCol, 'left');                  cx += mtfCols[1].w
      txt(doc, r.rsi.toFixed(1), cx, ry, 7, rsiCol, 'left');           cx += mtfCols[2].w
      txt(doc, r.vmc.toFixed(1), cx, ry, 7, vmcCol, 'left');           cx += mtfCols[3].w
      const scoreStr = (r.score >= 0 ? '+' : '') + r.score.toFixed(1)
      const sCol: RGB = r.score > 30 ? C.loss : r.score < -30 ? C.profit : C.text2
      txt(doc, scoreStr, cx, ry, 7, sCol, 'left');                     cx += mtfCols[4].w
      const rsiState = r.rsi > 70 ? 'Surachete' : r.rsi < 30 ? 'Survendu' : r.rsi > 60 ? 'Haussier' : r.rsi < 40 ? 'Baissier' : 'Neutre'
      const rsiStateCol: RGB = r.rsi > 70 ? C.loss : r.rsi < 30 ? C.profit : C.text2
      txt(doc, rsiState, cx, ry, 7, rsiStateCol, 'left');              cx += mtfCols[5].w
      txt(doc, r.divergence ? '! Oui' : '--', cx, ry, 7, r.divergence ? C.warning : C.textMut, 'left')
      y += rowH
    }
    ln(doc, ML, y, ML + CW, y, C.border, 0.3)
    y += 6
  }

  // ── Trade plan ────────────────────────────────────────────────────────────
  if (data.tradePlan) {
    const plan = data.tradePlan
    y = sectionHead(doc, 'Scenarios de Trading', y)

    const halfW = (CW - 5) / 2
    const scenH = 84

    function drawScenario(sc: TradeScenarioPDF, isBull: boolean, xStart: number) {
      const sCol: RGB = isBull ? C.profit : C.loss
      const title = isBull ? 'SCENARIO HAUSSIER' : 'SCENARIO BAISSIER'
      const dir   = isBull ? '^' : 'v'

      rectBorder(doc, xStart, y, halfW, scenH, C.bg2, sCol, 3, 0.5)

      // Header band
      fill(doc, sCol); doc.rect(xStart, y, halfW, 11, 'F')
      doc.setFontSize(8); doc.setTextColor(13, 17, 23)
      doc.text(`${dir} ${title}`, xStart + halfW / 2, y + 7.5, { align: 'center' })

      let sy = y + 14

      // Signal strength
      const strMap: Record<string, string> = { premium: '** Premium', strong: '* Fort', moderate: 'Modere', none: 'Faible' }
      const strColMap: Record<string, RGB> = { premium: C.gold, strong: C.profit, moderate: C.warning, none: C.textMut }
      const strKey = sc.signalStrength ?? 'none'
      txt(doc, strMap[strKey] ?? strKey, xStart + halfW / 2, sy, 7, strColMap[strKey] ?? C.text2, 'center')
      sy += 5
      if (sc.entryType) {
        txt(doc, sc.entryType, xStart + halfW / 2, sy + 3, 6.5, C.text2, 'center')
        sy += 6
      }

      ln(doc, xStart + 4, sy, xStart + halfW - 4, sy, sCol, 0.3)
      sy += 4

      // Price rows
      function prRow(label: string, val: number|undefined, pCol: RGB) {
        txt(doc, label, xStart + 5, sy + 3.5, 7, C.text2, 'left')
        txt(doc, fmtPrice(val ?? 0), xStart + halfW - 5, sy + 3.5, 8, pCol, 'right')
        sy += 7
      }

      prRow('Entree :', sc.entry, sCol)
      prRow('Stop Loss :', sc.stop, C.loss)

      ln(doc, xStart + 4, sy, xStart + halfW - 4, sy, C.border, 0.2)
      sy += 3

      txt(doc, 'Objectifs :', xStart + 5, sy + 3.5, 6.5, C.text2, 'left')
      sy += 6

      for (const [lb, tp, rr] of [
        ['TP1', sc.tp1, sc.tp1RR],
        ['TP2', sc.tp2, sc.tp2RR],
        ['TP3', sc.tp3, sc.tp3RR],
      ] as [string, number|undefined, string|undefined][]) {
        if (!tp) continue
        txt(doc, lb, xStart + 5, sy + 3.5, 7, C.textMut, 'left')
        txt(doc, fmtPrice(tp), xStart + 24, sy + 3.5, 7.5, C.profit, 'left')
        if (rr) {
          rect(doc, xStart + halfW - 18, sy, 14, 6, [35, 45, 25] as RGB, 2)
          txt(doc, rr, xStart + halfW - 11, sy + 4.5, 7, C.gold, 'center')
        }
        sy += 7
      }
    }

    drawScenario(plan.bull, true, ML)
    drawScenario(plan.bear, false, ML + halfW + 5)

    y += scenH + 5

    // ── Context ─────────────────────────────────────────────────────────────
    const riskCols: Record<string, RGB> = { low: C.profit, medium: C.warning, high: C.loss }
    const riskLabels: Record<string, string> = { low: 'RISQUE FAIBLE', medium: 'RISQUE MOYEN', high: 'RISQUE ELEVE' }
    const rCol2 = riskCols[plan.riskLevel] ?? C.text2

    rectBorder(doc, ML, y, CW, 16, C.bg2, C.border2, 3, 0.3)
    txt(doc, riskLabels[plan.riskLevel] ?? plan.riskLevel.toUpperCase(), ML + 6, y + 7, 8.5, rCol2, 'left')
    txt(doc, `Bull ${Math.round(plan.bullProb * 100)}%  /  Bear ${Math.round((1 - plan.bullProb) * 100)}%`, ML + 65, y + 7, 8, C.text2, 'left')
    const ctxLines = doc.splitTextToSize(plan.context, CW - 90) as string[]
    txt(doc, ctxLines[0] ?? '', ML + 118, y + 7, 7.5, C.text1, 'left', CW - 122)
    y += 20
  }

  // ── Règles de gestion du risque ──────────────────────────────────────────
  const remaining = FOOTER_Y - 14 - y
  if (remaining > 25) {
    y = sectionHead(doc, 'Regles de Gestion du Risque', y)

    const rules = [
      'Ne risquez jamais plus de 1-2% de votre capital par trade.',
      'Le Stop Loss est obligatoire — placez-le AVANT d\'entrer en position.',
      'Visez un ratio Risque/Recompense minimum de 1.5R avant d\'entrer.',
      'TP1 = securite : prenez 1/3 a 1/2 de la position a ce niveau.',
      'La confluence MTF elevee (>70%) augmente significativement la probabilite.',
    ]

    for (const rule of rules) {
      if (y + 7 > FOOTER_Y - 12) break
      // Small bullet dot
      dot(doc, ML + 3, y + 2.5, 1, C.accent)
      const ruleLines = doc.splitTextToSize(rule, CW - 10) as string[]
      txt(doc, ruleLines.join(' '), ML + 7, y + 4, 7.5, C.text1, 'left', CW - 10)
      y += ruleLines.length > 1 ? 10 : 7
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// EXPORT PRINCIPAL
// ────────────────────────────────────────────────────────────────────────────

export function generateAnalysisPDF(data: AnalysisPDFData): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  doc.setFont('helvetica', 'normal')

  // Page 1 : Décision & Analyse
  drawPage1(doc, data)

  // Page 2 : Plan de Trade
  doc.addPage()
  fillPage(doc)
  drawPage2(doc, data)

  const dateStr  = data.timestamp.toISOString().slice(0, 10)
  const filename = `TradeMindset_Analyse_${data.symbol}_${dateStr}.pdf`
  doc.save(filename)
}
