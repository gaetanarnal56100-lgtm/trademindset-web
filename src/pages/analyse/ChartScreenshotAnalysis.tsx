// ChartScreenshotAnalysis.tsx — Analyse screenshot IA
// Miroir EXACT de OpenAIChartAnalyzer.swift + PhotoAnalysisView.swift
// Fix: appel CF correct { imageBase64, prompt } + prompt professionnel + multi-timeframe

import { useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'

const fbFn = getFunctions(app, 'europe-west1')

// ── Types ──────────────────────────────────────────────────────────────────

const TIMEFRAMES = ['M1','M5','M15','M30','H1','H2','H4','H12','D1','W1'] as const
type TF = typeof TIMEFRAMES[number]

interface TimeframeImage { tf: TF; base64: string; preview: string; mediaType: string }

interface TradePlan {
  biais: string; entree: string; stop: string; objectifs: string
  confirmation: string; invalidation: string; rr?: string; zones_retournement?: string
}

interface ChartAnalysis {
  symbol?: string | null
  resume: string; structure: string; zones: string; momentum: string
  patterns: string; indicateurs: string; mtf: string
  plan: TradePlan; psychologie: string
  confluences?: string | null; risques?: string | null; scenario_alternatif?: string | null
}

// ── Prompt builder (miroir exact OpenAIChartAnalyzer.swift) ───────────────

function buildPrompt(tfs: string[], isMulti: boolean): string {
  const tfList = tfs.join(', ')
  const count = tfs.length

  const multiBlock = isMulti ? `
⚠️ IMPORTANT — ANALYSE MULTI-TIMEFRAME :
L'utilisateur fournit ${count} graphiques sur les UT suivantes : ${tfList}.
Tu dois CROISER les informations de chaque UT pour fournir une analyse enrichie.

Pour chaque section, précise ce que tu vois sur chaque UT et les convergences/divergences.

CHAMPS SUPPLÉMENTAIRES OBLIGATOIRES :
- "confluences" : Détaille les confluences entre UT (zones de prix, niveaux clés, patterns qui se retrouvent sur plusieurs UT)
- "risques" : Risques spécifiques identifiés par le croisement des UT (divergences, incohérences)
- "scenario_alternatif" : Scénario alternatif si le plan principal échoue, basé sur les UT supérieures
- "rr" dans plan : Ratio risque/récompense estimé
- "zones_retournement" dans plan : Zones de retournement éventuel identifiées par croisement des UT`
  : `
Note : L'utilisateur fournit une seule image. Les champs "confluences", "risques", "scenario_alternatif", "rr" et "zones_retournement" doivent être null dans ta réponse.`

  const planExtra = isMulti
    ? `,\n    "rr": "",\n    "zones_retournement": ""`
    : `,\n    "rr": null,\n    "zones_retournement": null`

  const extraFields = isMulti
    ? `,\n  "confluences": "",\n  "risques": "",\n  "scenario_alternatif": ""`
    : `,\n  "confluences": null,\n  "risques": null,\n  "scenario_alternatif": null`

  return `Tu es un trader professionnel expert en price action, structure de marché et analyse technique multi-timeframe.

L'utilisateur envoie ${isMulti ? 'plusieurs captures d\'écran de graphiques sur différentes unités de temps' : 'une capture d\'écran d\'un graphique'} (crypto, actions ou forex).
${multiBlock}

Ta mission n'est PAS de décrire l'image.
Ta mission est de produire une ANALYSE DE TRADING CLAIRE, PROFESSIONNELLE et IMMÉDIATEMENT ACTIONNABLE.

Tu dois penser comme un trader, mais t'exprimer comme un pédagogue.

RÈGLES :
- Pas de description visuelle
- Pas de phrases génériques
- Phrases courtes, claires, actionnables
- Réponds UNIQUEMENT en français${isMulti ? '\n- CROISE systématiquement les informations entre les différentes UT' : ''}

DÉTECTION DU SYMBOLE :
Si tu identifies clairement l'actif (ex: BTC/USDT, ETH/USDT, SOL/USDT...), retourne son symbole Binance sans slash (ex: "BTCUSDT").
Si c'est une action, forex, ou si tu ne peux pas identifier l'actif avec certitude, retourne null.

Réponds STRICTEMENT au format JSON suivant, sans aucun texte autour :

{
  "symbol": "BTCUSDT",
  "resume": "",
  "structure": "",
  "zones": "",
  "momentum": "",
  "patterns": "",
  "indicateurs": "",
  "mtf": "",
  "plan": {
    "biais": "",
    "entree": "",
    "stop": "",
    "objectifs": "",
    "confirmation": "",
    "invalidation": ""${planExtra}
  },
  "psychologie": ""${extraFields}
}`
}

function buildSystemPrompt(isMulti: boolean): string {
  return `Tu es un trader professionnel expert. Réponds UNIQUEMENT en français et en JSON valide, sans aucun texte avant ou après. Le JSON doit être valide et commencer par '{' et finir par '}'.${isMulti ? ' Tu reçois plusieurs images de différentes unités de temps — croise les analyses pour un résultat enrichi.' : ''}`
}

// ── Image helpers ──────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function resizeImage(base64: string, mediaType: string, maxDim = 1024, quality = 0.8): Promise<string> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = img.width * scale; canvas.height = img.height * scale
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL(mediaType, quality).split(',')[1])
    }
    img.src = `data:${mediaType};base64,${base64}`
  })
}

// ── Cloud Function calls (miroir exact CloudFunctionService.swift) ─────────

type CFResult = { content?: string; text?: string }

async function callCF(imageBase64: string, prompt: string): Promise<string> {
  const fn = httpsCallable<Record<string, unknown>, CFResult>(fbFn, 'openaiAnalyzeImage')
  const res = await fn({ imageBase64, prompt })
  // extractContent: essaie content, text, ou JSON stringifié
  const d = res.data as any
  if (typeof d === 'string') return d
  if (d?.content) return d.content
  if (d?.text) return d.text
  if (d?.choices?.[0]?.message?.content) return d.choices[0].message.content
  return JSON.stringify(d)
}

async function analyzeSingle(base64: string, tfs: string[]): Promise<string> {
  const fullPrompt = buildSystemPrompt(false) + '\n\n' + buildPrompt(tfs, false)
  return callCF(base64, fullPrompt)
}

async function analyzeMulti(
  images: { base64: string; tf: string }[],
  onProgress: (msg: string) => void,
  synthMsg: string
): Promise<string> {
  const tfs = images.map(i => i.tf)
  const fullPrompt = buildSystemPrompt(true) + '\n\n' + buildPrompt(tfs, true)
  const partials: string[] = []

  // Appels séquentiels (miroir openAIAnalyzeImages)
  for (let i = 0; i < images.length; i++) {
    const n = i + 1, total = images.length
    onProgress(`Analyse ${n}/${total} — ${images[i].tf}...`)

    const isLast = i === images.length - 1
    const imagePrompt = `Image ${n}/${total} — ${images[i].tf}\n\n${fullPrompt}\n\n` +
      (isLast && partials.length > 0
        ? `IMPORTANT: Synthétise TOUTES les analyses précédentes (${partials.length} image(s) analysée(s)) avec celle-ci et retourne le JSON complet final.\n\nAnalyses précédentes :\n${partials.join('\n\n')}`
        : `IMPORTANT: Pour cette image ${n}/${total}, fournis une analyse partielle de ce que tu vois.`)

    try {
      const res = await callCF(images[i].base64, imagePrompt)
      partials.push(`=== Analyse image ${n} (${images[i].tf}) ===\n${res}`)
    } catch (e) {
      console.warn(`Image ${n} failed:`, e)
    }
  }

  if (!partials.length) throw new Error('allFailed')

  // Si une seule image analysée, retourner directement
  if (partials.length === 1) return partials[0]

  // Synthèse finale
  onProgress(synthMsg)
  const synthesisPrompt = `${buildSystemPrompt(true)}\n\nTu as analysé ${partials.length} graphiques de trading sur différentes unités de temps.\nVoici les analyses individuelles :\n\n${partials.join('\n\n')}\n\nMaintenant, produis une SYNTHÈSE GLOBALE en JSON valide avec TOUS les champs obligatoires, en croisant les informations de chaque UT.`
  return callCF(images[0].base64, synthesisPrompt)
}

// ── JSON Parser (miroir parseChartAnalysis) ────────────────────────────────

function parseAnalysis(raw: string): ChartAnalysis | null {
  try {
    let text = raw
      .replace(/```json\n?|```\n?/g, '')
      .trim()
    const s = text.indexOf('{'), e = text.lastIndexOf('}')
    if (s >= 0 && e > s) text = text.slice(s, e + 1)
    return JSON.parse(text) as ChartAnalysis
  } catch { return null }
}

// ── UI Components ──────────────────────────────────────────────────────────

function Section({ icon, label, content, color }: { icon: string; label: string; content?: string | null; color: string }) {
  if (!content?.trim()) return null
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color }}>{label}</span>
      </div>
      <div style={{ fontSize: 12, color: '#C5C8D6', lineHeight: 1.65, padding: '10px 14px',
        background: `${color}08`, borderRadius: 9, borderLeft: `2px solid ${color}35` }}>
        {content}
      </div>
    </div>
  )
}

function PlanCard({ plan, isMulti }: { plan: TradePlan; isMulti: boolean }) {
  const { t } = useTranslation()
  const biaisColor = /hauss/i.test(plan.biais) ? 'var(--tm-profit)' : /baiss/i.test(plan.biais) ? 'var(--tm-loss)' : 'var(--tm-warning)'
  const rows = [
    { label: 'Biais', value: plan.biais, color: biaisColor, bold: true },
    { label: t('analyse.entry'), value: plan.entree, color: 'var(--tm-accent)' },
    { label: 'Stop Loss', value: plan.stop, color: 'var(--tm-loss)' },
    { label: t('analyse.objectives'), value: plan.objectifs, color: 'var(--tm-profit)' },
    { label: 'Confirmation', value: plan.confirmation, color: 'var(--tm-warning)' },
    { label: 'Invalidation', value: plan.invalidation, color: 'var(--tm-loss)' },
    ...(isMulti && plan.rr ? [{ label: 'R:R', value: plan.rr, color: '#FFD700' }] : []),
    ...(isMulti && plan.zones_retournement ? [{ label: 'Zones retournement', value: plan.zones_retournement, color: 'var(--tm-purple)' }] : []),
  ].filter(r => r.value?.trim())

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span>🎯</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-accent)' }}>{t('analyse.tradePlan')}</span>
        {plan.biais && <span style={{ fontSize: 11, fontWeight: 700, color: biaisColor,
          background: `${biaisColor}15`, padding: '1px 9px', borderRadius: 10 }}>{plan.biais}</span>}
        {isMulti && plan.rr && <span style={{ fontSize: 10, color: '#FFD700',
          background: 'rgba(255,215,0,0.1)', padding: '1px 7px', borderRadius: 8 }}>R:R {plan.rr}</span>}
      </div>
      <div style={{ background: 'rgba(var(--tm-accent-rgb,0,229,255),0.04)', border: '1px solid rgba(var(--tm-accent-rgb,0,229,255),0.15)', borderRadius: 10, overflow: 'hidden' }}>
        {rows.map((row, i) => (
          <div key={row.label} style={{ display: 'flex', gap: 12, padding: '8px 14px',
            borderTop: i > 0 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: row.color, width: 120, flexShrink: 0 }}>{row.label}</span>
            <span style={{ fontSize: 11, color: '#C5C8D6', lineHeight: 1.5 }}>{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function AnalysisResults({ analysis, isMulti }: { analysis: ChartAnalysis; isMulti: boolean }) {
  const { t } = useTranslation()
  return (
    <div>
      {/* Symbol badge */}
      {analysis.symbol && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--tm-text-muted)' }}>Symbole détecté :</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-accent)', background: 'rgba(var(--tm-accent-rgb,0,229,255),0.1)',
            padding: '2px 10px', borderRadius: 8, fontFamily: 'monospace' }}>{analysis.symbol}</span>
        </div>
      )}

      {/* Résumé */}
      {analysis.resume && (
        <div style={{ padding: '12px 14px', background: 'rgba(var(--tm-purple-rgb,191,90,242),0.08)',
          border: '1px solid rgba(var(--tm-purple-rgb,191,90,242),0.2)', borderRadius: 10, marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: 'var(--tm-purple)', fontWeight: 700, marginBottom: 4 }}>✨ RÉSUMÉ IA</div>
          <div style={{ fontSize: 13, color: 'var(--tm-text-primary)', lineHeight: 1.65 }}>{analysis.resume}</div>
        </div>
      )}

      {/* Plan de trade */}
      {analysis.plan && <PlanCard plan={analysis.plan} isMulti={isMulti} />}

      {/* Multi-TF enriched sections */}
      {isMulti && <Section icon="🔗" label="Confluences inter-UT" content={analysis.confluences} color="var(--tm-accent)" />}
      {isMulti && <Section icon="⚠️" label={t('analyse.risks')} content={analysis.risques} color="var(--tm-warning)" />}
      {isMulti && <Section icon="🔄" label={t('analyse.alternativeScenario')} content={analysis.scenario_alternatif} color="var(--tm-purple)" />}

      {/* Technical sections */}
      <Section icon="🧱" label={t('analyse.marketStructure')} content={analysis.structure} color="var(--tm-blue)" />
      <Section icon="📍" label={t('analyse.keyZones')} content={analysis.zones} color="var(--tm-warning)" />
      <Section icon="📈" label="Tendance & Momentum" content={analysis.momentum} color="var(--tm-profit)" />
      <Section icon="🕯️" label="Patterns & Chandeliers" content={analysis.patterns} color="var(--tm-purple)" />
      <Section icon="📊" label="Indicateurs" content={analysis.indicateurs} color="#64D2FF" />
      <Section icon="🧭" label="Lecture Multi-Timeframe" content={analysis.mtf} color="var(--tm-warning)" />
      <Section icon="🧠" label={t('analyse.marketPsychology')} content={analysis.psychologie} color="var(--tm-warning)" />
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function ChartScreenshotAnalysis({ symbol }: { symbol?: string }) {
  const { t } = useTranslation()
  const [images, setImages]       = useState<TimeframeImage[]>([])
  const [pendingTF, setPendingTF] = useState<TF>('H1')
  const [analysis, setAnalysis]   = useState<ChartAnalysis | null>(null)
  const [rawText, setRawText]     = useState('')
  const [status, setStatus]       = useState<'idle'|'analyzing'|'done'|'error'>('idle')
  const [progress, setProgress]   = useState('')
  const [errorMsg, setErrorMsg]   = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const addFileInputRef = useRef<HTMLInputElement>(null)

  const isMulti = images.length > 1

  const addImage = useCallback(async (file: File, tf: TF) => {
    if (!file.type.startsWith('image/')) return
    const raw = await fileToBase64(file)
    const compression = images.length === 0 ? 0.8 : images.length === 1 ? 0.6 : 0.45
    const b64 = await resizeImage(raw, file.type, 1024, compression)
    const preview = URL.createObjectURL(file)
    setImages(prev => {
      // Replace if same TF already added
      const filtered = prev.filter(i => i.tf !== tf)
      return [...filtered, { tf, base64: b64, preview, mediaType: file.type }]
    })
    setAnalysis(null); setRawText(''); setStatus('idle')
  }, [images.length])

  const removeImage = (tf: TF) => {
    setImages(prev => prev.filter(i => i.tf !== tf))
    setAnalysis(null); setStatus('idle')
  }

  const analyze = async () => {
    if (!images.length || status === 'analyzing') return
    setStatus('analyzing'); setErrorMsg(''); setAnalysis(null)

    try {
      let raw: string
      if (images.length === 1) {
        setProgress('Analyse en cours...')
        raw = await analyzeSingle(images[0].base64, [images[0].tf])
      } else {
        raw = await analyzeMulti(
          images.map(i => ({ base64: i.base64, tf: i.tf })),
          setProgress,
          t('analyse.synthesisMTF')
        )
      }
      setRawText(raw)
      const parsed = parseAnalysis(raw)
      setAnalysis(parsed)
      setStatus('done')
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setErrorMsg(msg === 'allFailed' ? t('analyse.allFailed') : msg || t('common.error'))
      setStatus('error')
    }
    setProgress('')
  }

  const reset = () => {
    setImages([]); setAnalysis(null); setRawText('')
    setStatus('idle'); setErrorMsg('')
  }

  return (
    <div style={{ background: 'var(--tm-bg-secondary)', border: '1px solid #1E2330', borderRadius: 16, overflow: 'hidden' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #1E2330', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg,#BF5AF2,#FF2D55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>📸</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-primary)' }}>{t('analyse.screenshotTitle')}</div>
            <div style={{ fontSize: 10, color: 'var(--tm-text-muted)' }}>
              {isMulti ? t('analyse.mtfCharts', { count: images.length }) : t('analyse.screenshotCardSub')}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {status === 'done' && <span style={{ fontSize: 10, color: 'var(--tm-profit)', background: 'rgba(var(--tm-profit-rgb,34,199,89),0.1)', padding: '2px 8px', borderRadius: 6 }}>{t('analyse.analyzed')}</span>}
          {isMulti && <span style={{ fontSize: 10, color: 'var(--tm-accent)', background: 'rgba(var(--tm-accent-rgb,0,229,255),0.1)', padding: '2px 8px', borderRadius: 6 }}>Multi-TF</span>}
        </div>
      </div>

      <div style={{ padding: '16px' }}>
        {/* Image slots */}
        {images.length === 0 ? (
          // Drop zone vide
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) addImage(f, pendingTF) }}
            onClick={() => fileInputRef.current?.click()}
            style={{ border: `2px dashed ${isDragging ? 'var(--tm-purple)' : 'var(--tm-border)'}`, borderRadius: 12,
              padding: '36px 20px', textAlign: 'center', cursor: 'pointer',
              background: isDragging ? 'rgba(var(--tm-purple-rgb,191,90,242),0.05)' : 'transparent', transition: 'all 0.2s' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>🖼️</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tm-text-primary)', marginBottom: 4 }}>{t('analyse.dragChart')}</div>
            <div style={{ fontSize: 11, color: 'var(--tm-text-muted)' }}>{t('analyse.orClickToSelect')}</div>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) addImage(f, pendingTF) }} />
          </div>
        ) : (
          <div>
            {/* Grid images */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 12 }}>
              {images.map(img => (
                <div key={img.tf} style={{ position: 'relative', borderRadius: 10, overflow: 'hidden',
                  border: '1px solid #2A2F3E' }}>
                  <img src={img.preview} alt={img.tf} style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }} />
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '4px 8px',
                    background: 'linear-gradient(transparent,rgba(0,0,0,0.8))', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--tm-accent)', fontFamily: 'monospace' }}>{img.tf}</span>
                    <button onClick={() => removeImage(img.tf)} style={{ background: 'rgba(var(--tm-loss-rgb,255,59,48),0.3)', border: 'none',
                      borderRadius: 4, color: 'white', cursor: 'pointer', fontSize: 11, padding: '1px 5px' }}>✕</button>
                  </div>
                </div>
              ))}

              {/* Add another TF */}
              {images.length < 4 && (
                <div>
                  <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                    <select value={pendingTF} onChange={e => setPendingTF(e.target.value as TF)}
                      style={{ flex: 1, background: 'var(--tm-bg)', border: '1px solid #2A2F3E', borderRadius: 6,
                        color: 'var(--tm-text-secondary)', fontSize: 10, padding: '3px 6px', cursor: 'pointer' }}>
                      {TIMEFRAMES.filter(tf => !images.find(i => i.tf === tf)).map(tf => (
                        <option key={tf} value={tf}>{tf}</option>
                      ))}
                    </select>
                  </div>
                  <div onClick={() => addFileInputRef.current?.click()}
                    style={{ height: 66, border: '2px dashed #2A2F3E', borderRadius: 10, display: 'flex',
                      flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                      gap: 4, color: 'var(--tm-text-muted)', transition: 'all 0.15s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--tm-purple)'; (e.currentTarget as HTMLElement).style.color = 'var(--tm-purple)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--tm-border)'; (e.currentTarget as HTMLElement).style.color = 'var(--tm-text-muted)' }}>
                    <span style={{ fontSize: 18 }}>+</span>
                    <span style={{ fontSize: 9 }}>Ajouter {pendingTF}</span>
                    <input ref={addFileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                      onChange={e => { const f = e.target.files?.[0]; if (f) { addImage(f, pendingTF); e.target.value = '' } }} />
                  </div>
                </div>
              )}
            </div>

            {/* Action buttons */}
            {status === 'idle' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={analyze} style={{ flex: 1, padding: '11px', borderRadius: 10,
                  background: 'linear-gradient(135deg,rgba(var(--tm-purple-rgb,191,90,242),0.2),rgba(255,45,85,0.2))',
                  border: '1px solid rgba(var(--tm-purple-rgb,191,90,242),0.4)', color: 'var(--tm-purple)', fontSize: 13, fontWeight: 700,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  ✨ {isMulti ? t('analyse.analyzeBtnMulti', {count: images.length}) : t('analyse.analyzeBtn')}
                </button>
                <button onClick={reset} style={{ padding: '11px 14px', borderRadius: 10, background: 'transparent',
                  border: '1px solid #2A2F3E', color: 'var(--tm-text-muted)', fontSize: 12, cursor: 'pointer' }}>↺</button>
              </div>
            )}

            {/* Analyzing */}
            {status === 'analyzing' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '24px' }}>
                <div style={{ width: 32, height: 32, border: '3px solid #2A2F3E', borderTopColor: 'var(--tm-purple)',
                  borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                <div style={{ fontSize: 13, color: '#C5C8D6', fontWeight: 600 }}>{progress || 'Analyse en cours...'}</div>
                {isMulti && <div style={{ fontSize: 11, color: 'var(--tm-text-muted)' }}>Analyse séquentielle des timeframes puis synthèse multi-TF</div>}
              </div>
            )}

            {/* Error */}
            {status === 'error' && (
              <div style={{ padding: '12px 14px', background: 'rgba(var(--tm-loss-rgb,255,59,48),0.08)',
                border: '1px solid rgba(var(--tm-loss-rgb,255,59,48),0.2)', borderRadius: 10, marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--tm-loss)', marginBottom: 6 }}>⚠️ {errorMsg}</div>
                <button onClick={analyze} style={{ fontSize: 11, color: 'var(--tm-purple)', background: 'none',
                  border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Réessayer</button>
              </div>
            )}

            {/* Results */}
            {status === 'done' && (
              <div style={{ marginTop: 16 }}>
                {analysis
                  ? <AnalysisResults analysis={analysis} isMulti={isMulti} />
                  : (
                    <div style={{ padding: '12px', background: 'rgba(255,255,255,0.03)',
                      border: '1px solid #2A2F3E', borderRadius: 10, marginBottom: 12 }}>
                      <div style={{ fontSize: 10, color: 'var(--tm-text-muted)', marginBottom: 8 }}>✨ Analyse IA</div>
                      <div style={{ fontSize: 12, color: '#C5C8D6', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{rawText}</div>
                    </div>
                  )
                }
                <button onClick={analyze} style={{ marginTop: 12, width: '100%', padding: '8px',
                  borderRadius: 8, background: 'transparent', border: '1px solid #2A2F3E',
                  color: 'var(--tm-text-muted)', fontSize: 11, cursor: 'pointer' }}>↺ Relancer l'analyse</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
