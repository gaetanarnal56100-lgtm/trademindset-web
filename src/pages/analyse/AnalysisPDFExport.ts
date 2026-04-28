// AnalysisPDFExport.ts — Générateur de rapport PDF complet pour l'analyse d'actifs
// Utilise jsPDF (v4) pour créer un document multi-pages dark-themed

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
}

// ── Color palette ────────────────────────────────────────────────────────────

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
  gold:    [255, 215, 0]      as RGB,
  white:   [255, 255, 255]    as RGB,
}

// ── Dimensions ───────────────────────────────────────────────────────────────

const PW  = 210   // page width mm (A4)
const PH  = 297   // page height mm (A4)
const ML  = 14    // left margin
const MR  = 14    // right margin
const MT  = 14    // top margin
const CW  = PW - ML - MR  // content width (182mm)

// ── Low-level helpers ─────────────────────────────────────────────────────────

function fill(doc: jsPDF, rgb: RGB) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2])
}
function stroke(doc: jsPDF, rgb: RGB) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2])
}
function color(doc: jsPDF, rgb: RGB) {
  doc.setTextColor(rgb[0], rgb[1], rgb[2])
}

function rect(doc: jsPDF, x: number, y: number, w: number, h: number, bg: RGB, radius = 0) {
  fill(doc, bg)
  stroke(doc, bg)
  if (radius > 0) {
    doc.roundedRect(x, y, w, h, radius, radius, 'F')
  } else {
    doc.rect(x, y, w, h, 'F')
  }
}

function rectBorder(doc: jsPDF, x: number, y: number, w: number, h: number, bg: RGB, borderRgb: RGB, radius = 0, lineWidth = 0.3) {
  fill(doc, bg)
  stroke(doc, borderRgb)
  doc.setLineWidth(lineWidth)
  if (radius > 0) {
    doc.roundedRect(x, y, w, h, radius, radius, 'FD')
  } else {
    doc.rect(x, y, w, h, 'FD')
  }
}

function txt(doc: jsPDF, text: string, x: number, y: number, size: number, rgb: RGB, align: 'left'|'center'|'right' = 'left', maxWidth?: number) {
  doc.setFontSize(size)
  color(doc, rgb)
  const opts: { align?: string; maxWidth?: number } = { align }
  if (maxWidth) opts.maxWidth = maxWidth
  doc.text(text, x, y, opts as Parameters<typeof doc.text>[3])
}

function line(doc: jsPDF, x1: number, y1: number, x2: number, y2: number, rgb: RGB, lw = 0.3) {
  stroke(doc, rgb)
  doc.setLineWidth(lw)
  doc.line(x1, y1, x2, y2)
}

function fillPage(doc: jsPDF) {
  rect(doc, 0, 0, PW, PH, C.bg)
}

function addNewPage(doc: jsPDF) {
  doc.addPage()
  fillPage(doc)
}

// ── Signal colors ─────────────────────────────────────────────────────────────

function signalColor(signal: string): RGB {
  const s = signal.toUpperCase()
  if (s === 'BUY' || s === 'STRONG BUY') return C.profit
  if (s === 'BULLISH') return [100, 220, 120] as RGB
  if (s === 'BEARISH') return [255, 130, 100] as RGB
  if (s === 'SELL' || s === 'STRONG SELL') return C.loss
  return C.text2
}

function levelTypeLabel(type: string): string {
  switch (type) {
    case 'resistance': return 'Résistance'
    case 'support': return 'Support'
    case 'pivot': return 'Pivot'
    case 'orderblock_bull': return 'OB Haussier'
    case 'orderblock_bear': return 'OB Baissier'
    case 'high': return 'Plus Haut'
    case 'low': return 'Plus Bas'
    default: return type
  }
}

function levelTypeColor(type: string): RGB {
  switch (type) {
    case 'resistance': return C.loss
    case 'support': return C.profit
    case 'pivot': return C.warning
    case 'orderblock_bull': return [80, 200, 100] as RGB
    case 'orderblock_bear': return [220, 80, 80] as RGB
    case 'high': return C.accent
    case 'low': return C.purple
    default: return C.text2
  }
}

function strengthDots(s: string): string {
  if (s === 'strong') return '●●●'
  if (s === 'medium') return '●●○'
  return '●○○'
}

function fmtPrice(p: number): string {
  if (!p) return '—'
  if (p >= 10000) return '$' + p.toLocaleString('fr-FR', { maximumFractionDigits: 0 })
  if (p >= 100) return '$' + p.toFixed(2)
  if (p >= 1) return '$' + p.toFixed(4)
  return '$' + p.toFixed(6)
}

function fmtPct(pct: number): string {
  return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'
}

function pctDiff(price: number, current: number): string {
  if (!current) return '—'
  const pct = ((price - current) / current) * 100
  return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'
}

function wrapLines(doc: jsPDF, text: string, maxWidth: number, fontSize: number): string[] {
  doc.setFontSize(fontSize)
  return doc.splitTextToSize(text, maxWidth) as string[]
}

// ── Page header ───────────────────────────────────────────────────────────────

function drawPageHeader(doc: jsPDF, title: string, pageNum: number, totalPages: number) {
  // Top accent bar
  fill(doc, C.accent)
  doc.rect(0, 0, PW, 1.5, 'F')

  // Background for header area
  rect(doc, 0, 1.5, PW, 14, C.bg2)

  // TM Logo text
  txt(doc, 'TM', ML, 11, 9, C.accent, 'left')
  txt(doc, 'TradeMindset', ML + 8, 11, 7.5, C.text2, 'left')

  // Page title
  txt(doc, title.toUpperCase(), PW / 2, 11, 8, C.text1, 'center')

  // Page number
  txt(doc, `${pageNum} / ${totalPages}`, PW - MR, 11, 7, C.textMut, 'right')

  // Separator
  line(doc, 0, 15.5, PW, 15.5, C.border, 0.5)
}

// ── Page footer ───────────────────────────────────────────────────────────────

function drawPageFooter(doc: jsPDF, symbol: string, timestamp: Date) {
  const y = PH - 8
  line(doc, 0, y - 3, PW, y - 3, C.border, 0.3)
  txt(doc, symbol, ML, y, 7, C.textMut, 'left')
  const dateStr = timestamp.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  txt(doc, dateStr, PW / 2, y, 7, C.textMut, 'center')
  txt(doc, 'trademindset.app', PW - MR, y, 7, C.textMut, 'right')
}

// ── Section heading ───────────────────────────────────────────────────────────

function sectionHeading(doc: jsPDF, label: string, y: number): number {
  rect(doc, ML, y, CW, 7, C.bg3, 2)
  txt(doc, label.toUpperCase(), ML + 6, y + 4.8, 7.5, C.accent, 'left')
  return y + 10
}

// ────────────────────────────────────────────────────────────────────────────
// PAGE 1 — Résumé Exécutif
// ────────────────────────────────────────────────────────────────────────────

function drawPage1(doc: jsPDF, data: AnalysisPDFData, totalPages: number) {
  fillPage(doc)
  drawPageHeader(doc, 'Rapport d\'Analyse', 1, totalPages)
  drawPageFooter(doc, data.symbol, data.timestamp)

  let y = 20

  // ── Symbol + Price hero ──────────────────────────────────────────────────
  rectBorder(doc, ML, y, CW, 24, C.bg2, C.border, 3)

  // Symbol
  txt(doc, data.symbol, ML + 8, y + 9, 18, C.white, 'left')

  // Price
  const priceStr = fmtPrice(data.price)
  txt(doc, priceStr, ML + 8, y + 19, 13, C.profit, 'left')

  // 24h change
  if (data.change24h !== undefined) {
    const ch = data.change24h
    const chColor: RGB = ch >= 0 ? C.profit : C.loss
    const chStr = fmtPct(ch) + ' (24h)'
    txt(doc, chStr, ML + 8 + 42, y + 19, 10, chColor, 'left')
  }

  // Timestamp
  const ts = data.timestamp.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  txt(doc, ts, PW - MR - 8, y + 9, 8, C.text2, 'right')

  y += 28

  // ── MTF Global Signal ─────────────────────────────────────────────────────
  if (data.mtfSnap) {
    const snap = data.mtfSnap
    const sigCol = signalColor(snap.globalSignal)
    const scoreColor: RGB = snap.globalScore > 30 ? C.loss : snap.globalScore < -30 ? C.profit : C.text2

    // 3 metric boxes
    const boxW = (CW - 8) / 3
    const boxH = 20

    // Signal box
    rectBorder(doc, ML, y, boxW, boxH, C.bg2, sigCol, 3, 0.5)
    txt(doc, 'SIGNAL GLOBAL', ML + boxW / 2, y + 6, 6, C.text2, 'center')
    txt(doc, snap.globalSignal, ML + boxW / 2, y + 15, 11, sigCol, 'center')

    // Score box
    const x2 = ML + boxW + 4
    rectBorder(doc, x2, y, boxW, boxH, C.bg2, C.border, 3, 0.3)
    txt(doc, 'SCORE COMBINÉ', x2 + boxW / 2, y + 6, 6, C.text2, 'center')
    const scoreStr = (snap.globalScore >= 0 ? '+' : '') + snap.globalScore.toFixed(1)
    txt(doc, scoreStr, x2 + boxW / 2, y + 15, 11, scoreColor, 'center')

    // Confluence box
    const x3 = ML + (boxW + 4) * 2
    const confColor: RGB = snap.confluence >= 70 ? C.profit : snap.confluence >= 50 ? C.warning : C.text2
    rectBorder(doc, x3, y, boxW, boxH, C.bg2, confColor, 3, 0.5)
    txt(doc, 'CONFLUENCE', x3 + boxW / 2, y + 6, 6, C.text2, 'center')
    txt(doc, snap.confluence + '%', x3 + boxW / 2, y + 15, 11, confColor, 'center')

    y += boxH + 5

    // Sub-metrics: globalRSI, globalVMC
    rectBorder(doc, ML, y, CW, 12, C.bg3, C.border, 3, 0.3)
    const labelY = y + 8
    txt(doc, 'RSI Global:', ML + 6, labelY, 8, C.text2, 'left')
    txt(doc, snap.globalRSI.toFixed(1), ML + 30, labelY, 8, C.text1, 'left')
    txt(doc, 'VMC Global:', ML + 60, labelY, 8, C.text2, 'left')
    txt(doc, snap.globalVMC.toFixed(1), ML + 84, labelY, 8, C.text1, 'left')
    if (snap.isTurningUp) { txt(doc, '↑ Retournement haussier', ML + 114, labelY, 7, C.profit, 'left') }
    else if (snap.isTurningDown) { txt(doc, '↓ Retournement baissier', ML + 114, labelY, 7, C.loss, 'left') }

    y += 16
  }

  // ── Trade Plan summary ────────────────────────────────────────────────────
  if (data.tradePlan) {
    const plan = data.tradePlan
    const riskColors: Record<string, RGB> = { low: C.profit, medium: C.warning, high: C.loss }
    const riskLabels: Record<string, string> = { low: 'FAIBLE', medium: 'MOYEN', high: 'ÉLEVÉ' }
    const riskCol = riskColors[plan.riskLevel] ?? C.text2

    rectBorder(doc, ML, y, CW, 22, C.bg2, C.border, 3, 0.3)

    txt(doc, 'PROBABILITÉ HAUSSIÈRE', ML + 8, y + 7, 6.5, C.text2, 'left')
    const bullPct = Math.round(plan.bullProb * 100)
    txt(doc, bullPct + '%', ML + 8, y + 16, 12, bullPct > 55 ? C.profit : bullPct < 45 ? C.loss : C.text1, 'left')

    txt(doc, 'NIVEAU DE RISQUE', ML + 50, y + 7, 6.5, C.text2, 'left')
    txt(doc, riskLabels[plan.riskLevel] ?? plan.riskLevel.toUpperCase(), ML + 50, y + 16, 10, riskCol, 'left')

    // Wt/VMC status
    if (data.wtStatus) {
      txt(doc, 'WAVETREND', ML + 105, y + 7, 6.5, C.text2, 'left')
      txt(doc, data.wtStatus, ML + 105, y + 16, 9, C.warning, 'left')
    }
    if (data.vmcStatus) {
      txt(doc, 'VMC', ML + 155, y + 7, 6.5, C.text2, 'left')
      const vmcCol = data.vmcStatus.includes('BUY') || data.vmcStatus.includes('BULL') ? C.profit : data.vmcStatus.includes('SELL') || data.vmcStatus.includes('BEAR') ? C.loss : C.text2
      txt(doc, data.vmcStatus, ML + 155, y + 16, 9, vmcCol, 'left')
    }

    y += 26

    // Context box
    rectBorder(doc, ML, y, CW, 14, C.bg3, C.border2, 3, 0.3)
    txt(doc, 'Contexte: ' + plan.context, ML + 6, y + 9, 8.5, C.text1, 'left', CW - 12)
    y += 18
  }

  // ── WT / VMC values ───────────────────────────────────────────────────────
  if (data.wtValues) {
    rectBorder(doc, ML, y, CW / 2 - 4, 14, C.bg2, C.border, 3, 0.3)
    txt(doc, 'WT1: ' + data.wtValues.wt1.toFixed(1) + '   WT2: ' + data.wtValues.wt2.toFixed(1), ML + 6, y + 9, 8.5, C.accent, 'left')
    y += 0 // keep y for next box on same row
  }

  return y
}

// ────────────────────────────────────────────────────────────────────────────
// PAGE 2 — Dashboard Multi-Timeframes
// ────────────────────────────────────────────────────────────────────────────

function drawPage2(doc: jsPDF, data: AnalysisPDFData, totalPages: number) {
  fillPage(doc)
  drawPageHeader(doc, 'Dashboard Multi-Timeframes', 2, totalPages)
  drawPageFooter(doc, data.symbol, data.timestamp)

  let y = 20

  if (!data.mtfSnap || data.mtfSnap.readings.length === 0) {
    txt(doc, 'Données MTF non disponibles', PW / 2, PH / 2, 10, C.textMut, 'center')
    return
  }

  const snap = data.mtfSnap

  // ── Global summary ────────────────────────────────────────────────────────
  y = sectionHeading(doc, 'Résumé Global', y)

  const sigCol = signalColor(snap.globalSignal)
  rectBorder(doc, ML, y, CW, 18, C.bg2, sigCol, 3, 0.5)

  txt(doc, snap.globalSignal, ML + 8, y + 11, 14, sigCol, 'left')
  txt(doc, 'Score: ' + (snap.globalScore >= 0 ? '+' : '') + snap.globalScore.toFixed(1), ML + 60, y + 11, 10, C.text1, 'left')
  txt(doc, 'Confluence: ' + snap.confluence + '%', ML + 110, y + 11, 10, snap.confluence >= 70 ? C.profit : C.warning, 'left')

  y += 22

  // ── Table header ──────────────────────────────────────────────────────────
  y = sectionHeading(doc, 'Lectures par Timeframe', y)

  const cols = [
    { label: 'TF',         w: 18 },
    { label: 'Signal',     w: 34 },
    { label: 'RSI',        w: 22 },
    { label: 'VMC',        w: 22 },
    { label: 'Score',      w: 26 },
    { label: 'RSI Norm',   w: 26 },
    { label: 'Div.',       w: 18 },
    { label: 'État RSI',   w: 30 },
  ]

  const rowH = 9
  const headerH = 8

  // Header row
  rect(doc, ML, y, CW, headerH, C.bg3)
  let cx = ML + 3
  for (const col of cols) {
    txt(doc, col.label, cx, y + 5.5, 6.5, C.text2, 'left')
    cx += col.w
  }
  y += headerH

  // Data rows
  for (let i = 0; i < snap.readings.length; i++) {
    const r = snap.readings[i]
    const rowBg: RGB = i % 2 === 0 ? C.bg2 : C.bg
    rect(doc, ML, y, CW, rowH, rowBg)

    // Separator
    line(doc, ML, y, ML + CW, y, C.border, 0.15)

    const sigColRow = signalColor(r.signal)
    cx = ML + 3
    const rowY = y + 6

    // TF
    txt(doc, r.tf, cx, rowY, 7.5, C.text1, 'left')
    cx += cols[0].w

    // Signal
    txt(doc, r.signal, cx, rowY, 7, sigColRow, 'left')
    cx += cols[1].w

    // RSI
    const rsiCol: RGB = r.rsi > 70 ? C.loss : r.rsi < 30 ? C.profit : C.text1
    txt(doc, r.rsi.toFixed(1), cx, rowY, 7, rsiCol, 'left')
    cx += cols[2].w

    // VMC
    const vmcCol: RGB = r.vmc > 40 ? C.loss : r.vmc < -40 ? C.profit : C.text1
    txt(doc, r.vmc.toFixed(1), cx, rowY, 7, vmcCol, 'left')
    cx += cols[3].w

    // Score
    const scoreColRow: RGB = r.score > 30 ? C.loss : r.score < -30 ? C.profit : C.text2
    txt(doc, (r.score >= 0 ? '+' : '') + r.score.toFixed(1), cx, rowY, 7, scoreColRow, 'left')
    cx += cols[4].w

    // RSI Norm
    txt(doc, r.rsiNorm.toFixed(1), cx, rowY, 7, C.text2, 'left')
    cx += cols[5].w

    // Divergence
    txt(doc, r.divergence ? '⚡ Oui' : '—', cx, rowY, 7, r.divergence ? C.warning : C.textMut, 'left')
    cx += cols[6].w

    // RSI state
    const rsiState = r.rsi > 70 ? 'Suracheté' : r.rsi < 30 ? 'Survendu' : r.rsi > 60 ? 'Haussier' : r.rsi < 40 ? 'Baissier' : 'Neutre'
    const rsiStateCol: RGB = r.rsi > 70 ? C.loss : r.rsi < 30 ? C.profit : C.text2
    txt(doc, rsiState, cx, rowY, 7, rsiStateCol, 'left')

    y += rowH
  }

  // Bottom border
  line(doc, ML, y, ML + CW, y, C.border, 0.3)
  y += 6

  // ── Legend ────────────────────────────────────────────────────────────────
  y = sectionHeading(doc, 'Légende des Signaux', y)

  const legends = [
    { label: 'BUY',     color: C.profit,  desc: 'Fort signal d\'achat — RSI bas + VMC négatif convergents' },
    { label: 'BULLISH', color: [100, 220, 120] as RGB, desc: 'Tendance haussière modérée' },
    { label: 'NEUTRAL', color: C.text2,   desc: 'Pas de biais clair — attendre confirmation' },
    { label: 'BEARISH', color: [255, 130, 100] as RGB, desc: 'Tendance baissière modérée' },
    { label: 'SELL',    color: C.loss,    desc: 'Fort signal de vente — RSI haut + VMC positif convergents' },
  ]

  for (const lg of legends) {
    rect(doc, ML, y, 3, 4, lg.color, 1)
    txt(doc, lg.label, ML + 5, y + 3.5, 7.5, lg.color, 'left')
    txt(doc, lg.desc, ML + 30, y + 3.5, 7, C.text2, 'left', CW - 35)
    y += 6
  }
}

// ────────────────────────────────────────────────────────────────────────────
// PAGE 3 — Graphique
// ────────────────────────────────────────────────────────────────────────────

function drawPage3(doc: jsPDF, data: AnalysisPDFData, totalPages: number) {
  fillPage(doc)
  drawPageHeader(doc, 'Graphique des Prix', 3, totalPages)
  drawPageFooter(doc, data.symbol, data.timestamp)

  let y = 20

  y = sectionHeading(doc, `Graphique — ${data.symbol}`, y)

  if (data.chartImageDataUrl) {
    // Calculate dimensions to fit within content area
    const imgW = CW
    const maxH = PH - y - 20 // Leave space for footer
    // Standard chart aspect ratio ~2.5:1
    const imgH = Math.min(maxH, imgW / 2.5)

    try {
      doc.addImage(data.chartImageDataUrl, 'PNG', ML, y, imgW, imgH)
    } catch (e) {
      console.warn('Could not add chart image:', e)
      rectBorder(doc, ML, y, CW, 60, C.bg2, C.border, 3, 0.3)
      txt(doc, 'Image du graphique non disponible', PW / 2, y + 32, 10, C.textMut, 'center')
    }
    y += Math.min(maxH, imgW / 2.5) + 8
  } else {
    rectBorder(doc, ML, y, CW, 60, C.bg2, C.border, 3, 0.3)
    txt(doc, 'Graphique non capturé', PW / 2, y + 25, 10, C.textMut, 'center')
    txt(doc, 'Utilisez le graphique LightweightChart pour activer la capture', PW / 2, y + 35, 8, C.textMut, 'center')
    y += 68
  }

  // Indicator note
  y = sectionHeading(doc, 'Indicateurs Actifs', y)
  const indicators = [
    { name: 'VMC (Volume Market Confirmation)', desc: 'Oscillateur avancé — croisements de signaux Bullish/Bearish' },
    { name: 'SMC (Smart Money Concepts)',       desc: 'Order Blocks, Fair Value Gaps, BOS/CHoCH' },
    { name: 'MSD (Market Structure Dashboard)', desc: 'Détection automatique de la structure marché' },
    { name: 'Market Profile',                   desc: 'Distribution des volumes par niveaux de prix' },
    { name: 'RSI (14)',                         desc: 'Relative Strength Index — surachat/survente' },
  ]
  for (const ind of indicators) {
    txt(doc, '→', ML + 2, y, 7, C.accent, 'left')
    txt(doc, ind.name + ':', ML + 8, y, 7.5, C.text1, 'left')
    txt(doc, ind.desc, ML + 8, y + 5, 7, C.text2, 'left', CW - 10)
    y += 12
  }
}

// ────────────────────────────────────────────────────────────────────────────
// PAGE 4 — Niveaux Clés
// ────────────────────────────────────────────────────────────────────────────

function drawPage4(doc: jsPDF, data: AnalysisPDFData, totalPages: number) {
  fillPage(doc)
  drawPageHeader(doc, 'Niveaux Clés', 4, totalPages)
  drawPageFooter(doc, data.symbol, data.timestamp)

  let y = 20

  if (!data.keyLevels || data.keyLevels.length === 0) {
    txt(doc, 'Niveaux clés non disponibles', PW / 2, PH / 2, 10, C.textMut, 'center')
    return
  }

  // Group levels
  const resistances = data.keyLevels.filter(l => l.type === 'resistance').sort((a, b) => b.price - a.price)
  const supports    = data.keyLevels.filter(l => l.type === 'support').sort((a, b) => b.price - a.price)
  const pivots      = data.keyLevels.filter(l => l.type === 'pivot')
  const orderBlocks = data.keyLevels.filter(l => l.type.startsWith('orderblock'))
  const extremes    = data.keyLevels.filter(l => l.type === 'high' || l.type === 'low').sort((a, b) => b.price - a.price)

  function drawLevelTable(levels: KeyLevelPDF[], title: string) {
    if (levels.length === 0) return

    y = sectionHeading(doc, title, y)

    const cols2 = [
      { label: 'Label', w: 28 },
      { label: 'Type', w: 38 },
      { label: 'Prix', w: 40 },
      { label: '% du prix', w: 30 },
      { label: 'Force', w: 22 },
      { label: 'Touches', w: 24 },
    ]

    const headerH2 = 7
    rect(doc, ML, y, CW, headerH2, C.bg3)
    let cx2 = ML + 3
    for (const col of cols2) {
      txt(doc, col.label, cx2, y + 5, 6, C.text2, 'left')
      cx2 += col.w
    }
    y += headerH2

    for (let i = 0; i < levels.length; i++) {
      if (y > PH - 25) {
        // Would overflow page — add continuation note
        txt(doc, `(+ ${levels.length - i} niveaux supplémentaires)`, ML, y + 6, 7, C.textMut, 'left')
        break
      }

      const lv = levels[i]
      const rowBg2: RGB = i % 2 === 0 ? C.bg2 : C.bg
      const lvColor = levelTypeColor(lv.type)
      rect(doc, ML, y, CW, 8, rowBg2)
      line(doc, ML, y, ML + CW, y, C.border, 0.15)

      // Color indicator bar
      rect(doc, ML, y, 2, 8, lvColor)

      cx2 = ML + 5
      const ry = y + 5.5

      txt(doc, lv.label, cx2, ry, 7, C.text1, 'left')
      cx2 += cols2[0].w

      txt(doc, levelTypeLabel(lv.type), cx2, ry, 7, lvColor, 'left')
      cx2 += cols2[1].w

      txt(doc, fmtPrice(lv.price), cx2, ry, 7, C.white, 'left')
      cx2 += cols2[2].w

      const pctStr = pctDiff(lv.price, data.price)
      const pctCol: RGB = pctStr.startsWith('+') ? C.loss : C.profit
      txt(doc, pctStr, cx2, ry, 7, pctCol, 'left')
      cx2 += cols2[3].w

      const strCol: RGB = lv.strength === 'strong' ? C.profit : lv.strength === 'medium' ? C.warning : C.textMut
      txt(doc, strengthDots(lv.strength), cx2, ry, 7, strCol, 'left')
      cx2 += cols2[4].w

      txt(doc, lv.touches !== undefined ? String(lv.touches) : '—', cx2, ry, 7, C.text2, 'left')

      y += 8
    }

    line(doc, ML, y, ML + CW, y, C.border, 0.3)
    y += 5
  }

  drawLevelTable(resistances, 'Résistances')
  drawLevelTable(pivots, 'Niveaux Pivot')
  drawLevelTable(supports, 'Supports')
  drawLevelTable(orderBlocks, 'Order Blocks')
  drawLevelTable(extremes, 'Plus Hauts / Plus Bas Récents')

  // Legend
  if (y < PH - 40) {
    y = sectionHeading(doc, 'Force des Niveaux', y)
    txt(doc, '●●●  Fort     — 3 confirmations ou plus, niveau très respecté', ML + 6, y + 3, 7.5, C.profit, 'left')
    y += 7
    txt(doc, '●●○  Moyen  — 2 confirmations, niveau à surveiller', ML + 6, y + 3, 7.5, C.warning, 'left')
    y += 7
    txt(doc, '●○○  Faible  — 1 confirmation, niveau indicatif', ML + 6, y + 3, 7.5, C.textMut, 'left')
  }
}

// ────────────────────────────────────────────────────────────────────────────
// PAGE 5 — Plan de Trade
// ────────────────────────────────────────────────────────────────────────────

function drawPage5(doc: jsPDF, data: AnalysisPDFData, totalPages: number) {
  fillPage(doc)
  drawPageHeader(doc, 'Plan de Trade', 5, totalPages)
  drawPageFooter(doc, data.symbol, data.timestamp)

  let y = 20

  if (!data.tradePlan) {
    txt(doc, 'Plan de trade non disponible', PW / 2, PH / 2, 10, C.textMut, 'center')
    return
  }

  const plan = data.tradePlan
  const halfW = (CW - 6) / 2

  function drawScenario(scenario: TradeScenarioPDF, isBull: boolean, xStart: number) {
    const color2: RGB = isBull ? C.profit : C.loss
    const title  = isBull ? 'SCÉNARIO HAUSSIER' : 'SCÉNARIO BAISSIER'
    const emoji  = isBull ? '▲' : '▼'

    let sy = y

    // Card background
    rectBorder(doc, xStart, sy, halfW, 80, C.bg2, color2, 4, 0.5)

    // Header
    rect(doc, xStart, sy, halfW, 12, color2, 4)
    txt(doc, emoji + ' ' + title, xStart + halfW / 2, sy + 8, 8.5, C.bg, 'center')
    sy += 14

    // Signal strength
    const strColors: Record<string, RGB> = { premium: C.gold, strong: C.profit, moderate: C.warning, none: C.textMut }
    const strLabels: Record<string, string> = { premium: '⭐ Signal Premium', strong: '● Signal Fort', moderate: '◎ Modéré', none: '○ Faible' }
    const strKey = scenario.signalStrength ?? 'none'
    txt(doc, strLabels[strKey] ?? strKey, xStart + halfW / 2, sy + 4, 7.5, strColors[strKey] ?? C.text2, 'center')
    if (scenario.entryType) {
      txt(doc, scenario.entryType, xStart + halfW / 2, sy + 10, 7, C.text2, 'center')
      sy += 14
    } else {
      sy += 8
    }

    // Divider
    line(doc, xStart + 4, sy, xStart + halfW - 4, sy, color2, 0.3)
    sy += 4

    // Levels
    function lvRow(label: string, val: number | undefined, lvCol: RGB, sy2: number): number {
      txt(doc, label, xStart + 6, sy2, 7.5, C.text2, 'left')
      txt(doc, fmtPrice(val ?? 0), xStart + halfW / 2, sy2, 8, lvCol, 'left')
      return sy2 + 7
    }

    sy = lvRow('Entrée', scenario.entry, color2, sy)
    sy = lvRow('Stop Loss', scenario.stop, C.loss, sy)

    // Divider
    line(doc, xStart + 4, sy, xStart + halfW - 4, sy, C.border, 0.3)
    sy += 3

    txt(doc, 'Objectifs de profit', xStart + 6, sy + 3, 7, C.text2, 'left')
    sy += 6

    for (const [label, tp, rr] of [
      ['TP1', scenario.tp1, scenario.tp1RR],
      ['TP2', scenario.tp2, scenario.tp2RR],
      ['TP3', scenario.tp3, scenario.tp3RR],
    ] as [string, number|undefined, string|undefined][]) {
      if (!tp) continue
      txt(doc, label, xStart + 6, sy + 3, 7, C.textMut, 'left')
      txt(doc, fmtPrice(tp), xStart + 16, sy + 3, 7.5, C.profit, 'left')
      if (rr) {
        rect(doc, xStart + halfW - 18, sy - 1, 14, 6, [40, 50, 30] as RGB, 2)
        txt(doc, rr, xStart + halfW - 11, sy + 3.5, 7, C.gold, 'center')
      }
      sy += 7
    }
  }

  // Draw both scenarios side by side
  y = sectionHeading(doc, 'Scénarios de Trading', y)

  const yBefore = y
  drawScenario(plan.bull, true, ML)
  drawScenario(plan.bear, false, ML + halfW + 6)

  y = yBefore + 88

  // Risk / context box
  y = sectionHeading(doc, 'Contexte & Gestion du Risque', y)

  rectBorder(doc, ML, y, CW, 22, C.bg2, C.border2, 3, 0.3)

  const riskColors2: Record<string, RGB> = { low: C.profit, medium: C.warning, high: C.loss }
  const riskLabels2: Record<string, string> = { low: 'RISQUE FAIBLE', medium: 'RISQUE MOYEN', high: 'RISQUE ÉLEVÉ' }
  const riskCol2 = riskColors2[plan.riskLevel] ?? C.text2

  txt(doc, riskLabels2[plan.riskLevel] ?? plan.riskLevel, ML + 6, y + 8, 9, riskCol2, 'left')
  txt(doc, 'Bull: ' + Math.round(plan.bullProb * 100) + '%  /  Bear: ' + Math.round((1 - plan.bullProb) * 100) + '%', ML + 6, y + 17, 8, C.text2, 'left')

  const lines = wrapLines(doc, plan.context, CW - 80, 8)
  txt(doc, lines[0] ?? plan.context, ML + 80, y + 12, 8, C.text1, 'left', CW - 85)

  y += 26

  // ── Risk Management guide ─────────────────────────────────────────────────
  y = sectionHeading(doc, 'Règles de Gestion du Risque', y)

  const rules = [
    'Ne risquez jamais plus de 1-2% de votre capital par trade.',
    'Le Stop Loss est obligatoire — placez-le AVANT d\'entrer en position.',
    'Visez un ratio Risque/Récompense minimum de 1.5R avant d\'entrer.',
    'TP1 est votre sécurité — prenez 1/3 à 1/2 de la position à ce niveau.',
    'Ne retournez pas la position sans confirmation claire sur un TF supérieur.',
    'La confluence MTF élevée (>70%) augmente significativement la probabilité.',
  ]

  for (const rule of rules) {
    txt(doc, '→', ML + 2, y + 3.5, 8, C.accent, 'left')
    const ruleLines = wrapLines(doc, rule, CW - 12, 8)
    txt(doc, ruleLines.join(' '), ML + 8, y + 3.5, 8, C.text1, 'left', CW - 12)
    y += ruleLines.length > 1 ? 10 : 7
  }
}

// ────────────────────────────────────────────────────────────────────────────
// PAGE 6 — Analyse IA (optionnel)
// ────────────────────────────────────────────────────────────────────────────

function drawPage6(doc: jsPDF, data: AnalysisPDFData, totalPages: number) {
  fillPage(doc)
  drawPageHeader(doc, 'Analyse IA Approfondie', 6, totalPages)
  drawPageFooter(doc, data.symbol, data.timestamp)

  let y = 20

  if (!data.gptSections) {
    txt(doc, 'Analyse IA non générée pour cette session', PW / 2, PH / 2, 10, C.textMut, 'center')
    txt(doc, 'Cliquez sur "Générer l\'analyse IA" dans TradePlanCard', PW / 2, PH / 2 + 10, 8, C.textMut, 'center')
    return
  }

  const gpt = data.gptSections

  function drawGPTSection(title: string, icon: string, accentC: RGB, linesArr: string[]) {
    if (linesArr.length === 0) return
    if (y > PH - 35) return

    // Section header
    rect(doc, ML, y, CW, 8, C.bg3, 2)
    txt(doc, icon + '  ' + title, ML + 6, y + 5.5, 8, accentC, 'left')
    y += 11

    rectBorder(doc, ML, y, CW, 0, C.bg2, C.border, 2, 0.3)
    const cardStartY = y

    for (const rawLine of linesArr) {
      if (y > PH - 30) break
      const cleanLine = rawLine.replace(/^[-•→]\s*/, '')
      const colonIdx = cleanLine.indexOf(':')
      if (colonIdx > 0 && colonIdx < 35) {
        const key = cleanLine.slice(0, colonIdx).trim()
        const val = cleanLine.slice(colonIdx + 1).trim()
        txt(doc, key + ':', ML + 5, y + 4.5, 7, accentC, 'left')
        const valLines = wrapLines(doc, val, CW - 50, 7.5)
        txt(doc, valLines[0] ?? '', ML + 50, y + 4.5, 7.5, C.text1, 'left', CW - 55)
        y += Math.max(7, valLines.length * 6)
      } else {
        const wrLines = wrapLines(doc, cleanLine, CW - 12, 7.5)
        for (const wl of wrLines) {
          if (y > PH - 30) break
          txt(doc, wl, ML + 5, y + 4.5, 7.5, C.text1, 'left')
          y += 6
        }
      }
    }

    // Retroactively fill card
    const cardH = y - cardStartY + 4
    if (cardH > 0) {
      rectBorder(doc, ML, cardStartY, CW, cardH, C.bg2, C.border, 2, 0.3)
    }
    y += 8
  }

  drawGPTSection('Gestion du Risque', '⚠️', C.warning, gpt.riskLines)
  drawGPTSection('Timing & Contexte', '⏱️', C.accent, gpt.timingLines)
  drawGPTSection('Analyse Technique', '📊', C.purple, gpt.technicalLines)
  drawGPTSection('Informations Clés', 'ℹ️', C.text1, gpt.infoLines)
  drawGPTSection('Analyse Fondamentale', '🌐', C.gold, gpt.fundamentalLines)

  if (gpt.scoreExplanation) {
    y += 4
    y = sectionHeading(doc, 'Explication du Score IA', y)
    rectBorder(doc, ML, y, CW, 0, C.bg2, C.accent, 3, 0.5)
    const scoreLines = wrapLines(doc, gpt.scoreExplanation, CW - 12, 8)
    const scoreH = scoreLines.length * 6.5 + 8
    rectBorder(doc, ML, y, CW, scoreH, C.bg2, C.accent, 3, 0.5)
    for (let i = 0; i < scoreLines.length; i++) {
      txt(doc, scoreLines[i], ML + 6, y + 6 + i * 6.5, 8, C.text1, 'left')
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ────────────────────────────────────────────────────────────────────────────

export function generateAnalysisPDF(data: AnalysisPDFData): void {
  const hasChart   = !!data.chartImageDataUrl
  const hasMTF     = !!(data.mtfSnap && data.mtfSnap.readings.length > 0)
  const hasLevels  = !!(data.keyLevels && data.keyLevels.length > 0)
  const hasPlan    = !!data.tradePlan
  const hasGPT     = !!(data.gptSections && (
    data.gptSections.riskLines.length > 0 ||
    data.gptSections.technicalLines.length > 0
  ))

  const totalPages = 4 + (hasChart ? 1 : 0) + (hasGPT ? 1 : 0)

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  doc.setFont('helvetica', 'normal')

  // Page 1: Executive summary
  drawPage1(doc, data, totalPages)

  // Page 2: MTF Dashboard
  addNewPage(doc)
  drawPage2(doc, data, totalPages)

  // Page 3: Chart (if available)
  let nextPage = 3
  if (hasChart) {
    addNewPage(doc)
    drawPage3(doc, data, totalPages)
    nextPage++
  }

  // Page 4 (or 3): Key Levels
  addNewPage(doc)
  drawPage4(doc, { ...data, keyLevels: hasLevels ? data.keyLevels : [] }, totalPages)
  nextPage++

  // Page 5 (or 4): Trade Plan
  addNewPage(doc)
  drawPage5(doc, { ...data, tradePlan: hasPlan ? data.tradePlan : undefined }, totalPages)
  nextPage++

  // Optional: GPT analysis
  if (hasGPT) {
    addNewPage(doc)
    drawPage6(doc, data, totalPages)
  }

  // Generate filename
  const dateStr = data.timestamp.toISOString().slice(0, 10)
  const filename = `TradeMindset_Analyse_${data.symbol}_${dateStr}.pdf`
  doc.save(filename)
}
