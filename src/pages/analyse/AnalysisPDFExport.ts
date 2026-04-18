// AnalysisPDFExport.ts — v3 — Rapport 2 pages optimisé
// Page 1 : Résumé exécutif + Dashboard MTF + Niveaux Clés
// Page 2 : Plan de Trade + Gestion du Risque + Légende
// Note : Pas d'emojis Unicode (incompatibles helvetica jsPDF) — formes dessinées à la place

import { jsPDF } from 'jspdf'

// ── Types exportés ─────────────────────────────────────────────────────────────

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
  textMut: [70, 78, 100]      as RGB,
  profit:  [34, 199, 89]      as RGB,
  loss:    [255, 70, 60]      as RGB,
  accent:  [0, 215, 240]      as RGB,
  warning: [255, 155, 30]     as RGB,
  purple:  [185, 100, 240]    as RGB,
  gold:    [255, 215, 0]      as RGB,
  white:   [255, 255, 255]    as RGB,
}

// ── Page dimensions ───────────────────────────────────────────────────────────

const PW  = 210  // A4 width mm
const PH  = 297  // A4 height mm
const ML  = 13   // left margin
const MR  = 13   // right margin
const CW  = PW - ML - MR  // 184mm content width

// ── Low-level helpers ─────────────────────────────────────────────────────────

function fill(doc: jsPDF, rgb: RGB) { doc.setFillColor(rgb[0], rgb[1], rgb[2]) }
function stroke(doc: jsPDF, rgb: RGB) { doc.setDrawColor(rgb[0], rgb[1], rgb[2]) }
function color(doc: jsPDF, rgb: RGB) { doc.setTextColor(rgb[0], rgb[1], rgb[2]) }

function rect(doc: jsPDF, x: number, y: number, w: number, h: number, bg: RGB, radius = 0) {
  fill(doc, bg); stroke(doc, bg)
  if (radius > 0) doc.roundedRect(x, y, w, h, radius, radius, 'F')
  else doc.rect(x, y, w, h, 'F')
}

function rectBorder(doc: jsPDF, x: number, y: number, w: number, h: number, bg: RGB, borderRgb: RGB, radius = 0, lw = 0.3) {
  fill(doc, bg); stroke(doc, borderRgb)
  doc.setLineWidth(lw)
  if (radius > 0) doc.roundedRect(x, y, w, h, radius, radius, 'FD')
  else doc.rect(x, y, w, h, 'FD')
}

function txt(
  doc: jsPDF, text: string, x: number, y: number, size: number, rgb: RGB,
  align: 'left' | 'center' | 'right' = 'left', maxWidth?: number
) {
  doc.setFontSize(size)
  color(doc, rgb)
  const opts: { align?: string; maxWidth?: number } = { align }
  if (maxWidth) opts.maxWidth = maxWidth
  doc.text(text, x, y, opts as Parameters<typeof doc.text>[3])
}

function line(doc: jsPDF, x1: number, y1: number, x2: number, y2: number, rgb: RGB, lw = 0.3) {
  stroke(doc, rgb); doc.setLineWidth(lw); doc.line(x1, y1, x2, y2)
}

function fillPage(doc: jsPDF) { rect(doc, 0, 0, PW, PH, C.bg) }

function addNewPage(doc: jsPDF) { doc.addPage(); fillPage(doc) }

// Draw 3 strength dots using doc.circle() — avoids Unicode rendering issues
function drawStrengthDots(doc: jsPDF, x: number, midY: number, strength: string) {
  const c: RGB = strength === 'strong' ? C.profit : strength === 'medium' ? C.warning : C.textMut
  const filled = strength === 'strong' ? 3 : strength === 'medium' ? 2 : 1
  doc.setLineWidth(0.2)
  for (let i = 0; i < 3; i++) {
    if (i < filled) {
      fill(doc, c); stroke(doc, c)
      doc.circle(x + i * 4, midY, 1.3, 'F')
    } else {
      fill(doc, C.bg3); stroke(doc, C.border2)
      doc.circle(x + i * 4, midY, 1.3, 'FD')
    }
  }
}

// ── Price / percent formatters (no fr-FR locale — avoids thin-space glitch) ───

function fmtPrice(p: number): string {
  if (!p) return '--'
  const abs = Math.abs(p)
  if (abs >= 10000) return '$' + Math.round(p).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (abs >= 100)   return '$' + p.toFixed(2)
  if (abs >= 1)     return '$' + p.toFixed(4)
  return '$' + p.toFixed(6)
}

function fmtPct(pct: number): string {
  return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'
}

function pctDiff(price: number, current: number): string {
  if (!current) return '--'
  return fmtPct(((price - current) / current) * 100)
}

// ── Signal colors ─────────────────────────────────────────────────────────────

function signalColor(signal: string): RGB {
  const s = signal.toUpperCase()
  if (s === 'BUY' || s === 'STRONG BUY')   return C.profit
  if (s === 'BULLISH')                      return [100, 220, 120] as RGB
  if (s === 'BEARISH')                      return [255, 130, 100] as RGB
  if (s === 'SELL' || s === 'STRONG SELL') return C.loss
  return C.text2
}

// ── Level type helpers ────────────────────────────────────────────────────────

function levelTypeLabel(type: string): string {
  switch (type) {
    case 'resistance':     return 'Resistance'
    case 'support':        return 'Support'
    case 'pivot':          return 'Pivot'
    case 'orderblock_bull': return 'OB Haussier'
    case 'orderblock_bear': return 'OB Baissier'
    case 'high':           return 'Plus Haut'
    case 'low':            return 'Plus Bas'
    default: return type
  }
}

function levelTypeColor(type: string): RGB {
  switch (type) {
    case 'resistance':      return C.loss
    case 'support':         return C.profit
    case 'pivot':           return C.warning
    case 'orderblock_bull': return [80, 200, 100] as RGB
    case 'orderblock_bear': return [220, 80, 80]  as RGB
    case 'high':            return C.accent
    case 'low':             return C.purple
    default:                return C.text2
  }
}

// ── Layout helpers ────────────────────────────────────────────────────────────

function drawPageHeader(doc: jsPDF, title: string, pageNum: number, totalPages: number) {
  // Top cyan bar
  fill(doc, C.accent); doc.rect(0, 0, PW, 1.5, 'F')
  rect(doc, 0, 1.5, PW, 13, C.bg2)
  // Logo
  doc.setFont('helvetica', 'bold')
  txt(doc, 'TM', ML, 11, 9, C.accent)
  doc.setFont('helvetica', 'normal')
  txt(doc, 'TradeMindset', ML + 9, 11, 7, C.text2)
  // Title
  txt(doc, title.toUpperCase(), PW / 2, 11, 7.5, C.text1, 'center')
  // Page number
  txt(doc, `${pageNum} / ${totalPages}`, PW - MR, 11, 7, C.textMut, 'right')
  // Separator
  line(doc, 0, 14.5, PW, 14.5, C.border, 0.4)
}

function drawPageFooter(doc: jsPDF, symbol: string, timestamp: Date) {
  const yf = PH - 6.5
  line(doc, 0, yf - 2.5, PW, yf - 2.5, C.border, 0.3)
  txt(doc, symbol, ML, yf, 6, C.textMut)
  // Manual date format to avoid locale issues
  const d = timestamp
  const dateStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  txt(doc, dateStr, PW / 2, yf, 6, C.textMut, 'center')
  txt(doc, 'trademindset.app', PW - MR, yf, 6, C.textMut, 'right')
}

/** Returns new y after heading */
function sectionHeading(doc: jsPDF, label: string, y: number, accentColor?: RGB): number {
  rect(doc, ML, y, CW, 7.5, C.bg3, 2)
  txt(doc, label.toUpperCase(), ML + 5, y + 5.2, 6.5, accentColor ?? C.accent)
  return y + 10
}

// ────────────────────────────────────────────────────────────────────────────
// PAGE 1 — Résumé + Dashboard MTF + Niveaux Clés
// ────────────────────────────────────────────────────────────────────────────

function drawPage1(doc: jsPDF, data: AnalysisPDFData, totalPages: number) {
  fillPage(doc)
  drawPageHeader(doc, `${data.symbol}  —  Rapport d'Analyse`, 1, totalPages)
  drawPageFooter(doc, data.symbol, data.timestamp)

  let y = 17

  // ── HERO ──────────────────────────────────────────────────────────────────
  rectBorder(doc, ML, y, CW, 17, C.bg2, C.border, 3)

  // Symbol (bold)
  doc.setFont('helvetica', 'bold')
  txt(doc, data.symbol, ML + 5, y + 7, 15, C.white)
  doc.setFont('helvetica', 'normal')

  // Price
  const priceStr = fmtPrice(data.price)
  txt(doc, priceStr, ML + 5, y + 14, 10.5, C.profit)

  // 24h change
  if (data.change24h !== undefined) {
    const ch = data.change24h
    txt(doc, fmtPct(ch) + ' (24h)', ML + 5 + 38, y + 14, 8.5, ch >= 0 ? C.profit : C.loss)
  }

  // Timestamp (right side)
  const d = data.timestamp
  const tsStr = `${['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'][d.getDay() === 0 ? 6 : d.getDay() - 1]} ${String(d.getDate()).padStart(2,'0')} ${['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'][d.getMonth()]} ${d.getFullYear()} a ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  txt(doc, tsStr, PW - MR - 5, y + 7, 6.5, C.text2, 'right')

  // WT values (right, bottom)
  if (data.wtValues) {
    txt(doc, `WT1: ${data.wtValues.wt1.toFixed(1)}   WT2: ${data.wtValues.wt2.toFixed(1)}`, PW - MR - 5, y + 14, 7, C.accent, 'right')
  }

  y += 19

  // ── CHART IMAGE (ou fallback explicite) ───────────────────────────────────
  const chartH = 48  // hauteur réservée
  if (data.chartImageDataUrl) {
    try {
      doc.addImage(data.chartImageDataUrl, 'PNG', ML, y, CW, chartH, undefined, 'FAST')
      // fine border around the chart
      stroke(doc, C.border2)
      doc.setLineWidth(0.3)
      doc.roundedRect(ML, y, CW, chartH, 2, 2, 'S')
    } catch {
      // addImage failed (corrupt data url) — show placeholder
      rectBorder(doc, ML, y, CW, chartH, C.bg3, C.border, 2, 0.3)
      txt(doc, 'Graphique non disponible', PW / 2, y + chartH / 2 + 3, 8, C.textMut, 'center')
    }
  } else {
    // chartImageDataUrl is null — show explicit placeholder instead of blank space
    rectBorder(doc, ML, y, CW, chartH, C.bg3, C.border, 2, 0.3)
    // Dashed centre line
    stroke(doc, C.border2)
    doc.setLineWidth(0.25)
    doc.setLineDashPattern([2, 2], 0)
    doc.line(ML + 4, y + chartH / 2, ML + CW - 4, y + chartH / 2)
    doc.setLineDashPattern([], 0)
    txt(doc, 'Graphique non disponible', PW / 2, y + chartH / 2 - 3, 7.5, C.textMut, 'center')
    txt(doc, 'Le LightweightChart doit etre actif pour capturer le graphique', PW / 2, y + chartH / 2 + 5, 6, C.textMut, 'center')
  }
  y += chartH + 4

  // ── SIGNAL GLOBAL (3 KPI boxes) ───────────────────────────────────────────
  if (data.mtfSnap) {
    const snap = data.mtfSnap
    const bW = (CW - 8) / 3
    const bH = 19

    // Box 1 — Signal
    const sc = signalColor(snap.globalSignal)
    rectBorder(doc, ML, y, bW, bH, C.bg2, sc, 3, 0.6)
    txt(doc, 'SIGNAL GLOBAL', ML + bW / 2, y + 5.5, 5.5, C.text2, 'center')
    doc.setFont('helvetica', 'bold')
    txt(doc, snap.globalSignal, ML + bW / 2, y + 14, 11, sc, 'center')
    doc.setFont('helvetica', 'normal')

    // Box 2 — Score
    const scoreC: RGB = snap.globalScore > 30 ? C.loss : snap.globalScore < -30 ? C.profit : C.text1
    rectBorder(doc, ML + bW + 4, y, bW, bH, C.bg2, C.border2, 3, 0.3)
    txt(doc, 'SCORE COMBINE', ML + bW + 4 + bW / 2, y + 5.5, 5.5, C.text2, 'center')
    doc.setFont('helvetica', 'bold')
    txt(doc, (snap.globalScore >= 0 ? '+' : '') + snap.globalScore.toFixed(1), ML + bW + 4 + bW / 2, y + 14, 11, scoreC, 'center')
    doc.setFont('helvetica', 'normal')

    // Box 3 — Confluence
    const confC: RGB = snap.confluence >= 70 ? C.profit : snap.confluence >= 50 ? C.warning : C.text2
    rectBorder(doc, ML + (bW + 4) * 2, y, bW, bH, C.bg2, confC, 3, 0.6)
    txt(doc, 'CONFLUENCE MTF', ML + (bW + 4) * 2 + bW / 2, y + 5.5, 5.5, C.text2, 'center')
    doc.setFont('helvetica', 'bold')
    txt(doc, snap.confluence + '%', ML + (bW + 4) * 2 + bW / 2, y + 14, 11, confC, 'center')
    doc.setFont('helvetica', 'normal')

    y += bH + 3

    // ── Sub-metrics bar ────────────────────────────────────────────────────
    rectBorder(doc, ML, y, CW, 11, C.bg3, C.border, 2, 0.3)
    const barY = y + 7.5
    txt(doc, 'RSI Global:', ML + 4, barY, 7, C.text2)
    txt(doc, snap.globalRSI.toFixed(1), ML + 24, barY, 7.5, C.text1)
    txt(doc, 'VMC Global:', ML + 52, barY, 7, C.text2)
    txt(doc, snap.globalVMC.toFixed(1), ML + 72, barY, 7.5, snap.globalVMC < -30 ? C.profit : snap.globalVMC > 30 ? C.loss : C.text1)
    if (data.wtStatus) {
      txt(doc, 'WT: ' + data.wtStatus, ML + 100, barY, 7, C.warning)
    }
    if (data.vmcStatus) {
      const vCol = data.vmcStatus.toUpperCase().includes('BUY') || data.vmcStatus.toUpperCase().includes('BULL') ? C.profit
        : data.vmcStatus.toUpperCase().includes('SELL') || data.vmcStatus.toUpperCase().includes('BEAR') ? C.loss : C.text2
      txt(doc, 'VMC: ' + data.vmcStatus, ML + 134, barY, 7, vCol)
    }
    if (snap.isTurningUp) {
      txt(doc, '^ Retournement haussier', ML + 156, barY, 6.5, C.profit)
    } else if (snap.isTurningDown) {
      txt(doc, 'v Retournement baissier', ML + 156, barY, 6.5, C.loss)
    }

    y += 14

    // ── Context (if tradePlan available) ──────────────────────────────────
    if (data.tradePlan?.context) {
      rectBorder(doc, ML, y, CW, 9, C.bg3, C.border, 2, 0.3)
      const riskC: RGB = data.tradePlan.riskLevel === 'high' ? C.loss : data.tradePlan.riskLevel === 'medium' ? C.warning : C.profit
      const riskLabels: Record<string, string> = { low: 'RISQUE FAIBLE', medium: 'RISQUE MOYEN', high: 'RISQUE ELEVE' }
      txt(doc, riskLabels[data.tradePlan.riskLevel] ?? data.tradePlan.riskLevel.toUpperCase(), ML + 4, y + 6, 6.5, riskC)
      txt(doc, '|', ML + 42, y + 6, 6.5, C.border2)
      txt(doc, 'Bull: ' + Math.round(data.tradePlan.bullProb * 100) + '%  Bear: ' + Math.round((1 - data.tradePlan.bullProb) * 100) + '%', ML + 46, y + 6, 6.5, C.text2)
      txt(doc, '|', ML + 88, y + 6, 6.5, C.border2)
      txt(doc, data.tradePlan.context, ML + 92, y + 6, 6.5, C.text1, 'left', CW - 95)
      y += 12
    }

    // ── MTF TABLE ─────────────────────────────────────────────────────────
    if (snap.readings.length > 0) {
      y = sectionHeading(doc, 'Dashboard Multi-Timeframes', y)

      // Columns — total must be <= CW (184)
      const cols = [
        { label: 'TF',       w: 13 },
        { label: 'Signal',   w: 26 },
        { label: 'RSI',      w: 17 },
        { label: 'VMC',      w: 19 },
        { label: 'Score',    w: 20 },
        { label: 'RSI Norm', w: 22 },
        { label: 'Div.',     w: 14 },
        { label: 'Etat RSI', w: 28 },
        // total: 13+26+17+19+20+22+14+28 = 159 < 184
      ]

      const rH = 6.5, hH = 7

      // Header
      rect(doc, ML, y, CW, hH, C.bg3)
      let cx = ML + 3
      for (const col of cols) {
        txt(doc, col.label, cx, y + 5, 5.5, C.text2)
        cx += col.w
      }
      y += hH

      for (let i = 0; i < snap.readings.length; i++) {
        const r = snap.readings[i]
        const rowBg: RGB = i % 2 === 0 ? C.bg2 : C.bg
        rect(doc, ML, y, CW, rH, rowBg)
        line(doc, ML, y, ML + CW, y, C.border, 0.1)

        // Signal dot (drawn circle — no unicode)
        const sc2 = signalColor(r.signal)
        fill(doc, sc2)
        doc.circle(ML + 1.5, y + rH / 2, 1.2, 'F')

        cx = ML + 3
        const ry = y + 4.7

        txt(doc, r.tf, cx, ry, 6.5, C.text1)
        cx += cols[0].w

        txt(doc, r.signal, cx, ry, 6, sc2)
        cx += cols[1].w

        const rsiC: RGB = r.rsi > 70 ? C.loss : r.rsi < 30 ? C.profit : C.text1
        txt(doc, r.rsi.toFixed(1), cx, ry, 6.5, rsiC)
        cx += cols[2].w

        const vmcC: RGB = r.vmc > 40 ? C.loss : r.vmc < -40 ? C.profit : C.text1
        txt(doc, r.vmc.toFixed(1), cx, ry, 6.5, vmcC)
        cx += cols[3].w

        const scoreColR: RGB = r.score > 30 ? C.loss : r.score < -30 ? C.profit : C.text2
        txt(doc, (r.score >= 0 ? '+' : '') + r.score.toFixed(1), cx, ry, 6.5, scoreColR)
        cx += cols[4].w

        txt(doc, r.rsiNorm.toFixed(1), cx, ry, 6.5, C.text2)
        cx += cols[5].w

        // Divergence — draw lightning bolt substitute (small filled triangle)
        if (r.divergence) {
          fill(doc, C.warning)
          doc.triangle(cx + 1, y + rH - 1.5, cx + 4, y + 1.5, cx + 7, y + rH - 1.5, 'F')
          txt(doc, ' Oui', cx + 8, ry, 5.5, C.warning)
        } else {
          txt(doc, '--', cx + 2, ry, 6.5, C.textMut)
        }
        cx += cols[6].w

        const state = r.rsi > 70 ? 'Surachete' : r.rsi < 30 ? 'Survendu' : r.rsi > 60 ? 'Haussier' : r.rsi < 40 ? 'Baissier' : 'Neutre'
        const stateC: RGB = r.rsi > 70 ? C.loss : r.rsi < 30 ? C.profit : r.rsi > 60 ? [100, 220, 120] as RGB : r.rsi < 40 ? [255, 130, 100] as RGB : C.text2
        txt(doc, state, cx, ry, 6.5, stateC)

        y += rH
      }

      line(doc, ML, y, ML + CW, y, C.border, 0.3)
      y += 4
    }
  }

  // ── KEY LEVELS ─────────────────────────────────────────────────────────────
  if (data.keyLevels && data.keyLevels.length > 0) {
    y = sectionHeading(doc, 'Niveaux Cles', y)

    // Sort all levels by price desc — single flat table
    const allLevels = [...data.keyLevels].sort((a, b) => b.price - a.price)

    const lvCols = [
      { label: 'Label',   w: 22 },
      { label: 'Type',    w: 30 },
      { label: 'Prix',    w: 36 },
      { label: '%',       w: 22 },
      { label: 'Force',   w: 22 },
      { label: 'Touches', w: 18 },
      // total: 22+30+36+22+22+18 = 150 < 184
    ]

    const hH2 = 6.5, rH2 = 6.5

    rect(doc, ML, y, CW, hH2, C.bg3)
    let cx2 = ML + 3
    for (const col of lvCols) {
      txt(doc, col.label, cx2, y + 4.7, 5.5, C.text2)
      cx2 += col.w
    }
    y += hH2

    for (let i = 0; i < allLevels.length; i++) {
      if (y + rH2 > PH - 22) {
        txt(doc, `(+ ${allLevels.length - i} niveaux)`, ML + 3, y + 4, 6, C.textMut)
        y += 6
        break
      }
      const lv = allLevels[i]
      const lvC = levelTypeColor(lv.type)
      rect(doc, ML, y, CW, rH2, i % 2 === 0 ? C.bg2 : C.bg)
      line(doc, ML, y, ML + CW, y, C.border, 0.1)
      // Color bar on left
      rect(doc, ML, y, 2, rH2, lvC)

      cx2 = ML + 4
      const ry2 = y + 4.7

      txt(doc, lv.label, cx2, ry2, 6.5, C.text1)
      cx2 += lvCols[0].w

      txt(doc, levelTypeLabel(lv.type), cx2, ry2, 6, lvC)
      cx2 += lvCols[1].w

      txt(doc, fmtPrice(lv.price), cx2, ry2, 6.5, C.white)
      cx2 += lvCols[2].w

      const pctStr = pctDiff(lv.price, data.price)
      txt(doc, pctStr, cx2, ry2, 6.5, pctStr.startsWith('+') ? C.loss : C.profit)
      cx2 += lvCols[3].w

      drawStrengthDots(doc, cx2 + 2, y + rH2 / 2, lv.strength)
      cx2 += lvCols[4].w

      txt(doc, lv.touches !== undefined ? String(lv.touches) : '--', cx2, ry2, 6.5, C.text2)

      y += rH2
    }

    line(doc, ML, y, ML + CW, y, C.border, 0.3)
    y += 4

    // Inline strength legend
    if (y < PH - 22) {
      txt(doc, 'Force:', ML, y + 4, 6, C.textMut)
      drawStrengthDots(doc, ML + 16, y + 3, 'strong')
      txt(doc, 'Fort (3+)', ML + 30, y + 4, 6, C.profit)
      drawStrengthDots(doc, ML + 62, y + 3, 'medium')
      txt(doc, 'Moyen (2)', ML + 76, y + 4, 6, C.warning)
      drawStrengthDots(doc, ML + 108, y + 3, 'weak')
      txt(doc, 'Faible (1)', ML + 122, y + 4, 6, C.textMut)
      y += 8
    }

    // ── Mini visualisation prix — barre horizontale ────────────────────────
    if (y < PH - 28 && data.price > 0) {
      const prices = allLevels.map(l => l.price)
      const minP = Math.min(...prices, data.price)
      const maxP = Math.max(...prices, data.price)
      const rangeP = maxP - minP || 1

      const barX = ML
      const barW = CW
      const barY = y + 6
      const barH = 10

      // Background track
      rect(doc, barX, barY, barW, barH, C.bg3, 1)

      // Each level line
      for (const lv of allLevels) {
        const xPct = (lv.price - minP) / rangeP
        const lx = barX + xPct * barW
        const lc = levelTypeColor(lv.type)
        stroke(doc, lc)
        doc.setLineWidth(lv.strength === 'strong' ? 1.2 : lv.strength === 'medium' ? 0.7 : 0.4)
        doc.line(lx, barY, lx, barY + barH)
      }

      // Current price marker
      const cpPct = (data.price - minP) / rangeP
      const cpX = barX + cpPct * barW
      fill(doc, C.white); stroke(doc, C.white)
      doc.setLineWidth(1.5)
      doc.line(cpX, barY - 1, cpX, barY + barH + 1)
      // Triangle marker above bar
      doc.triangle(cpX - 2, barY - 1, cpX + 2, barY - 1, cpX, barY + 2, 'F')

      // Price labels at extremes
      txt(doc, fmtPrice(minP), barX, barY + barH + 5, 5.5, C.textMut)
      txt(doc, fmtPrice(maxP), barX + barW, barY + barH + 5, 5.5, C.textMut, 'right')
      txt(doc, fmtPrice(data.price), cpX, barY - 3, 5.5, C.white, 'center')

      y += barH + 12
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// PAGE 2 — Plan de Trade + Gestion du Risque + Légende
// ────────────────────────────────────────────────────────────────────────────

function drawScenarioCard(
  doc: jsPDF,
  scenario: TradeScenarioPDF,
  isBull: boolean,
  x: number, y: number,
  w: number, h: number
) {
  const cardC: RGB = isBull ? C.profit : C.loss
  const title = isBull ? 'SCENARIO HAUSSIER' : 'SCENARIO BAISSIER'
  const arrowLabel = isBull ? '^ ' : 'v '

  // Card border + bg
  rectBorder(doc, x, y, w, h, C.bg2, cardC, 4, 0.5)

  // Header bar
  fill(doc, cardC); doc.roundedRect(x, y, w, 12, 4, 4, 'F')
  doc.setFont('helvetica', 'bold')
  txt(doc, arrowLabel + title, x + w / 2, y + 8.5, 8.5, C.bg, 'center')
  doc.setFont('helvetica', 'normal')

  let sy = y + 14

  // Signal strength + entry type
  const strLabels: Record<string, string> = {
    premium: '* Signal Premium', strong: 'Signal Fort', moderate: 'Modere', none: 'Faible', weak: 'Faible'
  }
  const strColors: Record<string, RGB> = {
    premium: C.gold, strong: C.profit, moderate: C.warning, none: C.textMut, weak: C.textMut
  }
  const sk = scenario.signalStrength ?? 'none'
  txt(doc, strLabels[sk] ?? sk, x + w / 2, sy + 4.5, 7.5, strColors[sk] ?? C.text2, 'center')
  sy += 7
  if (scenario.entryType) {
    txt(doc, scenario.entryType, x + w / 2, sy + 3.5, 7, C.text2, 'center')
    sy += 6
  }

  line(doc, x + 4, sy + 2, x + w - 4, sy + 2, cardC, 0.3)
  sy += 5

  // Entry / Stop
  const lvRow = (label: string, val: number | undefined, lc: RGB) => {
    txt(doc, label, x + 6, sy + 4.5, 7, C.text2)
    doc.setFont('helvetica', 'bold')
    txt(doc, fmtPrice(val ?? 0), x + 28, sy + 4.5, 8, lc)
    doc.setFont('helvetica', 'normal')
    sy += 8
  }
  lvRow('Entree', scenario.entry, cardC)
  lvRow('Stop Loss', scenario.stop, C.loss)

  line(doc, x + 4, sy, x + w - 4, sy, C.border, 0.25)
  sy += 3

  txt(doc, 'Objectifs de profit', x + 6, sy + 4, 6.5, C.text2)
  sy += 7

  for (const [label, tp, rr] of [
    ['TP1', scenario.tp1, scenario.tp1RR],
    ['TP2', scenario.tp2, scenario.tp2RR],
    ['TP3', scenario.tp3, scenario.tp3RR],
  ] as [string, number | undefined, string | undefined][]) {
    if (!tp) continue
    txt(doc, label, x + 6, sy + 4, 7, C.textMut)
    doc.setFont('helvetica', 'bold')
    txt(doc, fmtPrice(tp), x + 18, sy + 4, 7.5, cardC)
    doc.setFont('helvetica', 'normal')
    if (rr) {
      rect(doc, x + w - 18, sy, 15, 7, [30, 42, 22] as RGB, 2)
      txt(doc, rr, x + w - 10.5, sy + 5, 7, C.gold, 'center')
    }
    sy += 8
  }
}

function drawPage2(doc: jsPDF, data: AnalysisPDFData, totalPages: number) {
  fillPage(doc)
  drawPageHeader(doc, `${data.symbol}  —  Plan de Trade`, 2, totalPages)
  drawPageFooter(doc, data.symbol, data.timestamp)

  let y = 17

  if (!data.tradePlan) {
    txt(doc, 'Plan de trade non disponible', PW / 2, PH / 2, 10, C.textMut, 'center')
    return
  }

  const plan = data.tradePlan
  const halfW = (CW - 6) / 2
  const cardH = 85

  y = sectionHeading(doc, 'Scenarios de Trading', y)

  // Draw both scenarios side by side
  drawScenarioCard(doc, plan.bull, true,  ML,              y, halfW, cardH)
  drawScenarioCard(doc, plan.bear, false, ML + halfW + 6,  y, halfW, cardH)

  y += cardH + 5

  // ── Contexte & Risk ────────────────────────────────────────────────────────
  y = sectionHeading(doc, 'Contexte & Gestion du Risque', y)

  const riskColors2: Record<string, RGB> = { low: C.profit, medium: C.warning, high: C.loss }
  const riskLabels2: Record<string, string> = { low: 'RISQUE FAIBLE', medium: 'RISQUE MOYEN', high: 'RISQUE ELEVE' }
  const riskC2 = riskColors2[plan.riskLevel] ?? C.text2

  rectBorder(doc, ML, y, CW, 18, C.bg2, C.border2, 3, 0.3)
  doc.setFont('helvetica', 'bold')
  txt(doc, riskLabels2[plan.riskLevel] ?? plan.riskLevel.toUpperCase(), ML + 6, y + 7, 9, riskC2)
  doc.setFont('helvetica', 'normal')
  txt(doc, 'Bull: ' + Math.round(plan.bullProb * 100) + '%  /  Bear: ' + Math.round((1 - plan.bullProb) * 100) + '%', ML + 6, y + 14, 7.5, C.text2)
  txt(doc, plan.context, ML + 78, y + 10, 8, C.text1, 'left', CW - 82)
  y += 22

  // ── Risk rules ─────────────────────────────────────────────────────────────
  y = sectionHeading(doc, 'Regles de Gestion du Risque', y)

  const rules = [
    'Ne risquez jamais plus de 1-2% de votre capital par trade.',
    "Le Stop Loss est obligatoire -- placez-le AVANT d'entrer en position.",
    'Visez un ratio Risque/Recompense minimum de 1.5R avant d\'entrer.',
    "TP1 est votre securite -- prenez 1/3 a 1/2 de la position a ce niveau.",
    'Ne retournez pas la position sans confirmation claire sur un TF superieur.',
    'La confluence MTF elevee (>70%) augmente significativement la probabilite.',
  ]

  for (const rule of rules) {
    // Draw accent dot instead of -> emoji
    fill(doc, C.accent)
    doc.circle(ML + 3, y + 3.5, 1.2, 'F')
    txt(doc, rule, ML + 8, y + 5, 7.5, C.text1, 'left', CW - 10)
    y += 8
  }

  y += 4

  // ── Signal legend ──────────────────────────────────────────────────────────
  if (y < PH - 50) {
    y = sectionHeading(doc, 'Legende des Signaux', y)

    const legends = [
      { label: 'BUY',     c: C.profit,              desc: "Fort signal d'achat -- RSI bas + VMC negatif convergents" },
      { label: 'BULLISH', c: [100, 220, 120] as RGB, desc: 'Tendance haussiere moderee' },
      { label: 'NEUTRAL', c: C.text2,               desc: 'Pas de biais clair -- attendre confirmation' },
      { label: 'BEARISH', c: [255, 130, 100] as RGB, desc: 'Tendance baissiere moderee' },
      { label: 'SELL',    c: C.loss,                desc: 'Fort signal de vente -- RSI haut + VMC positif convergents' },
    ]

    for (const lg of legends) {
      fill(doc, lg.c); doc.circle(ML + 2, y + 3.5, 2, 'F')
      doc.setFont('helvetica', 'bold')
      txt(doc, lg.label, ML + 7, y + 5, 7, lg.c)
      doc.setFont('helvetica', 'normal')
      txt(doc, lg.desc, ML + 34, y + 5, 6.5, C.text2, 'left', CW - 38)
      y += 8
    }
  }

  // ── Optional: GPT analysis note ────────────────────────────────────────────
  if (!data.gptSections || (
    data.gptSections.riskLines.length === 0 &&
    data.gptSections.technicalLines.length === 0
  )) {
    if (y < PH - 22) {
      y += 4
      rectBorder(doc, ML, y, CW, 10, C.bg3, C.border, 2, 0.2)
      txt(doc, 'Analyse IA non generee -- utilisez "Generer l\'analyse IA" dans TradePlanCard pour obtenir la page 3.', ML + 5, y + 6.5, 6.5, C.textMut, 'left', CW - 8)
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// PAGE 3 — Analyse IA (optionnelle)
// ────────────────────────────────────────────────────────────────────────────

function drawPage3GPT(doc: jsPDF, data: AnalysisPDFData, totalPages: number) {
  fillPage(doc)
  drawPageHeader(doc, `${data.symbol}  —  Analyse IA Approfondie`, 3, totalPages)
  drawPageFooter(doc, data.symbol, data.timestamp)

  let y = 17

  if (!data.gptSections) {
    txt(doc, 'Analyse IA non generee pour cette session', PW / 2, PH / 2, 10, C.textMut, 'center')
    return
  }

  const gpt = data.gptSections

  function drawGPTSection(title: string, markerC: RGB, linesArr: string[]) {
    if (linesArr.length === 0) return

    y = sectionHeading(doc, title, y, markerC)
    rectBorder(doc, ML, y, CW, 0, C.bg2, C.border, 2, 0.3)
    const cardStartY = y

    for (const rawLine of linesArr) {
      // Overflow: add a new page if near bottom
      if (y > PH - 28) {
        const cardH = y - cardStartY
        if (cardH > 0) rectBorder(doc, ML, cardStartY, CW, cardH, C.bg2, C.border, 2, 0.3)
        addNewPage(doc)
        drawPageHeader(doc, `${data.symbol}  —  Analyse IA (suite)`, totalPages + 1, totalPages + 1)
        drawPageFooter(doc, data.symbol, data.timestamp)
        y = 17
      }
      const cleanLine = rawLine.replace(/^[-•>]\s*/, '')
      const colonIdx = cleanLine.indexOf(':')
      if (colonIdx > 0 && colonIdx < 35) {
        const key = cleanLine.slice(0, colonIdx).trim()
        const val = cleanLine.slice(colonIdx + 1).trim()
        txt(doc, key + ':', ML + 5, y + 4.5, 7, markerC)
        const valLines = doc.splitTextToSize(val, CW - 50) as string[]
        txt(doc, valLines[0] ?? '', ML + 50, y + 4.5, 7.5, C.text1, 'left', CW - 55)
        y += Math.max(7, valLines.length * 6)
      } else {
        const wrLines = doc.splitTextToSize(cleanLine, CW - 12) as string[]
        for (const wl of wrLines) {
          if (y > PH - 28) {
            const cardH2 = y - cardStartY
            if (cardH2 > 0) rectBorder(doc, ML, cardStartY, CW, cardH2, C.bg2, C.border, 2, 0.3)
            addNewPage(doc)
            drawPageHeader(doc, `${data.symbol}  —  Analyse IA (suite)`, totalPages + 1, totalPages + 1)
            drawPageFooter(doc, data.symbol, data.timestamp)
            y = 17
          }
          txt(doc, wl, ML + 5, y + 4.5, 7.5, C.text1)
          y += 6
        }
      }
    }

    const cardH = y - cardStartY + 4
    if (cardH > 0) rectBorder(doc, ML, cardStartY, CW, cardH, C.bg2, C.border, 2, 0.3)
    y += 8
  }

  drawGPTSection('Gestion du Risque',    C.warning, gpt.riskLines)
  drawGPTSection('Timing & Contexte',    C.accent,  gpt.timingLines)
  drawGPTSection('Analyse Technique',    C.purple,  gpt.technicalLines)
  drawGPTSection('Informations Cles',    C.text1,   gpt.infoLines)
  drawGPTSection('Analyse Fondamentale', C.gold,    gpt.fundamentalLines)

  if (gpt.scoreExplanation && y < PH - 30) {
    y += 4
    y = sectionHeading(doc, 'Explication du Score IA', y, C.accent)
    const scoreLines = doc.splitTextToSize(gpt.scoreExplanation, CW - 12) as string[]
    const scoreH = scoreLines.length * 6.5 + 8
    rectBorder(doc, ML, y, CW, scoreH, C.bg2, C.accent, 3, 0.5)
    for (let i = 0; i < scoreLines.length; i++) {
      txt(doc, scoreLines[i], ML + 6, y + 6 + i * 6.5, 8, C.text1)
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ────────────────────────────────────────────────────────────────────────────

export function generateAnalysisPDF(data: AnalysisPDFData): void {
  const hasGPT = !!(data.gptSections && (
    data.gptSections.riskLines.length > 0 ||
    data.gptSections.technicalLines.length > 0
  ))

  const totalPages = hasGPT ? 3 : 2

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  doc.setFont('helvetica', 'normal')

  // Page 1: Résumé + MTF + Niveaux Clés
  drawPage1(doc, data, totalPages)

  // Page 2: Plan de Trade + Risk Management
  addNewPage(doc)
  drawPage2(doc, data, totalPages)

  // Page 3 (optional): IA Analysis
  if (hasGPT) {
    addNewPage(doc)
    drawPage3GPT(doc, data, totalPages)
  }

  // Filename
  const d = data.timestamp
  const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  doc.save(`TradeMindset_Analyse_${data.symbol}_${dateStr}.pdf`)
}
