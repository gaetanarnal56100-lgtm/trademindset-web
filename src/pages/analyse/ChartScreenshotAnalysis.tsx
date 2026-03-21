// ChartScreenshotAnalysis.tsx — Analyse de screenshot par IA
// Upload image graphique → base64 → openaiAnalyzeImage Cloud Function → analyse structurée
// Miroir de PhotoAnalysisView.swift + ChartPhotoAnalysisView.swift

import { useState, useRef, useCallback } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'

const fbFn = getFunctions(app, 'europe-west1')

// ── Types ──────────────────────────────────────────────────────────────────

interface AnalysisSection {
  resume: string
  structure: string
  zones: string
  momentum: string
  patterns: string
  indicateurs: string
  plan: {
    biais: string
    entree: string
    stop: string
    objectifs: string
    confirmation: string
    invalidation: string
  }
  psychologie: string
}

interface Props {
  symbol?: string
}

// ── Image to base64 ────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1]) // strip "data:image/jpeg;base64,"
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ── AI Analysis via openaiAnalyzeImage ────────────────────────────────────

async function analyzeScreenshot(base64: string, mediaType: string, symbol?: string): Promise<string> {
  const fn = httpsCallable<Record<string, unknown>, { choices?: { message: { content: string } }[] }>(
    fbFn, 'openaiAnalyzeImage'
  )

  const systemPrompt = `Tu es un expert en analyse technique de graphiques de trading.
Analyse cette capture d'écran de graphique de manière structurée et professionnelle.
${symbol ? `Le symbole analysé est : ${symbol}` : ''}

Réponds EXACTEMENT dans ce format JSON (sans markdown, sans backticks) :
{
  "resume": "Résumé en 1-2 phrases du contexte global",
  "structure": "Structure de marché : tendance, BOS/MSS, HH/LL",
  "zones": "Zones clés visibles : supports, résistances, order blocks, FVG",
  "momentum": "État des indicateurs visibles : RSI, MACD, WT, VMC si présents",
  "patterns": "Patterns chartistes identifiés : flags, wedges, double tops, etc.",
  "indicateurs": "Analyse détaillée des indicateurs techniques visibles",
  "plan": {
    "biais": "HAUSSIER / BAISSIER / NEUTRE",
    "entree": "Zone d'entrée optimale",
    "stop": "Niveau de stop loss logique",
    "objectifs": "TP1 / TP2 / TP3",
    "confirmation": "Signal de confirmation requis avant entrée",
    "invalidation": "Condition qui invalide le scénario"
  },
  "psychologie": "Points de vigilance psychologique pour ce setup"
}`

  const res = await fn({
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:${mediaType};base64,${base64}`,
              detail: 'high'
            }
          },
          {
            type: 'text',
            text: `Analyse ce graphique de trading${symbol ? ` (${symbol})` : ''} et génère l'analyse structurée en JSON.`
          }
        ]
      }
    ],
    model: 'gpt-4o',
    max_tokens: 1500,
  })

  return res.data.choices?.[0]?.message?.content || ''
}

// ── Section Card ──────────────────────────────────────────────────────────

function AnalysisBlock({ icon, label, content, color }: { icon: string; label: string; content: string; color: string }) {
  if (!content || content.trim() === '') return null
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color }}>{label}</span>
      </div>
      <div style={{ fontSize: 12, color: '#C5C8D6', lineHeight: 1.6, padding: '8px 12px', background: `${color}08`, borderRadius: 8, borderLeft: `2px solid ${color}40` }}>
        {content}
      </div>
    </div>
  )
}

function PlanTable({ plan }: { plan: AnalysisSection['plan'] }) {
  const biaisColor = plan.biais.toUpperCase().includes('HAUSS') ? '#22C759'
    : plan.biais.toUpperCase().includes('BAISS') ? '#FF3B30' : '#FF9500'

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 14 }}>📋</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#00E5FF' }}>Plan de Trade</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: biaisColor, background: `${biaisColor}15`, padding: '1px 8px', borderRadius: 10, marginLeft: 4 }}>{plan.biais}</span>
      </div>
      <div style={{ background: 'rgba(0,229,255,0.04)', border: '1px solid rgba(0,229,255,0.15)', borderRadius: 10, overflow: 'hidden' }}>
        {[
          { label: 'Entrée', value: plan.entree, color: '#00E5FF' },
          { label: 'Stop Loss', value: plan.stop, color: '#FF3B30' },
          { label: 'Objectifs', value: plan.objectifs, color: '#22C759' },
          { label: 'Confirmation', value: plan.confirmation, color: '#FF9500' },
          { label: 'Invalidation', value: plan.invalidation, color: '#FF3B30' },
        ].filter(r => r.value?.trim()).map((row, i) => (
          <div key={row.label} style={{ display: 'flex', gap: 12, padding: '8px 12px', borderTop: i > 0 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: row.color, width: 90, flexShrink: 0 }}>{row.label}</span>
            <span style={{ fontSize: 11, color: '#C5C8D6', lineHeight: 1.5 }}>{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function ChartScreenshotAnalysis({ symbol }: Props) {
  const [imagePreview,  setImagePreview]  = useState<string | null>(null)
  const [imageBase64,   setImageBase64]   = useState('')
  const [mediaType,     setMediaType]     = useState('image/jpeg')
  const [analysis,      setAnalysis]      = useState<AnalysisSection | null>(null)
  const [rawText,       setRawText]       = useState('')
  const [status,        setStatus]        = useState<'idle' | 'analyzing' | 'done' | 'error'>('idle')
  const [errorMsg,      setErrorMsg]      = useState('')
  const [expanded,      setExpanded]      = useState(true)
  const [isDragging,    setIsDragging]    = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return
    const preview = URL.createObjectURL(file)
    setImagePreview(preview)
    setMediaType(file.type || 'image/jpeg')
    const b64 = await fileToBase64(file)
    setImageBase64(b64)
    setAnalysis(null)
    setRawText('')
    setStatus('idle')
  }, [])

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const analyze = async () => {
    if (!imageBase64 || status === 'analyzing') return
    setStatus('analyzing')
    setErrorMsg('')
    try {
      const raw = await analyzeScreenshot(imageBase64, mediaType, symbol)
      setRawText(raw)
      // Parse JSON
      try {
        const clean = raw.replace(/```json\n?|```\n?/g, '').trim()
        const parsed = JSON.parse(clean) as AnalysisSection
        setAnalysis(parsed)
        setStatus('done')
      } catch {
        // Si pas JSON valide, afficher brut
        setAnalysis(null)
        setStatus('done')
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur lors de l\'analyse')
      setStatus('error')
    }
  }

  const reset = () => {
    setImagePreview(null)
    setImageBase64('')
    setAnalysis(null)
    setRawText('')
    setStatus('idle')
    setErrorMsg('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div style={{ background: '#161B22', border: '1px solid #1E2330', borderRadius: 16, overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
        onClick={() => setExpanded(x => !x)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: 'linear-gradient(135deg,#BF5AF2,#FF2D55)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>📸</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F3FF' }}>Analyse Screenshot IA</div>
            <div style={{ fontSize: 10, color: '#555C70' }}>Upload graphique → GPT-4o Vision → Analyse complète</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {status === 'done' && <span style={{ fontSize: 10, color: '#22C759', background: 'rgba(34,199,89,0.1)', padding: '2px 8px', borderRadius: 6 }}>✓ Analysé</span>}
          {status === 'analyzing' && <div style={{ width: 14, height: 14, border: '2px solid #2A2F3E', borderTopColor: '#BF5AF2', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />}
          <span style={{ fontSize: 10, color: '#555C70' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: '0 16px 16px' }}>
          {/* Zone upload */}
          {!imagePreview ? (
            <div
              onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${isDragging ? '#BF5AF2' : '#2A2F3E'}`,
                borderRadius: 12,
                padding: '32px 20px',
                textAlign: 'center',
                cursor: 'pointer',
                background: isDragging ? 'rgba(191,90,242,0.05)' : 'transparent',
                transition: 'all 0.2s'
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 10 }}>🖼️</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#F0F3FF', marginBottom: 4 }}>
                Glisser une capture de graphique
              </div>
              <div style={{ fontSize: 11, color: '#555C70' }}>
                ou cliquer pour sélectionner · PNG, JPG, WebP
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={onFileChange}
                style={{ display: 'none' }}
              />
            </div>
          ) : (
            <div>
              {/* Preview + actions */}
              <div style={{ position: 'relative', marginBottom: 12 }}>
                <img
                  src={imagePreview}
                  alt="Preview"
                  style={{ width: '100%', borderRadius: 10, display: 'block', maxHeight: 240, objectFit: 'cover' }}
                />
                <button
                  onClick={reset}
                  style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', color: '#F0F3FF', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  ✕
                </button>
              </div>

              {/* Bouton analyse */}
              {status === 'idle' && (
                <button
                  onClick={analyze}
                  style={{ width: '100%', padding: '11px', borderRadius: 10, background: 'linear-gradient(135deg,rgba(191,90,242,0.2),rgba(255,45,85,0.2))', border: '1px solid rgba(191,90,242,0.4)', color: '#BF5AF2', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  ✨ Analyser avec GPT-4o Vision
                </button>
              )}

              {/* Analyzing */}
              {status === 'analyzing' && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '20px' }}>
                  <div style={{ width: 32, height: 32, border: '3px solid #2A2F3E', borderTopColor: '#BF5AF2', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                  <div style={{ fontSize: 12, color: '#555C70' }}>Analyse en cours avec GPT-4o Vision...</div>
                  <div style={{ fontSize: 11, color: '#3D4254' }}>Identification des niveaux · patterns · indicateurs</div>
                </div>
              )}

              {/* Error */}
              {status === 'error' && (
                <div style={{ padding: '12px', background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.2)', borderRadius: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: '#FF3B30' }}>⚠️ {errorMsg || 'Erreur lors de l\'analyse'}</div>
                  <button onClick={analyze} style={{ marginTop: 8, fontSize: 11, color: '#BF5AF2', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Réessayer</button>
                </div>
              )}

              {/* Results */}
              {status === 'done' && (
                <div style={{ marginTop: 12 }}>
                  {analysis ? (
                    <div>
                      {/* Résumé en bannière */}
                      {analysis.resume && (
                        <div style={{ padding: '10px 14px', background: 'rgba(191,90,242,0.08)', border: '1px solid rgba(191,90,242,0.2)', borderRadius: 10, marginBottom: 16 }}>
                          <div style={{ fontSize: 10, color: '#BF5AF2', fontWeight: 700, marginBottom: 4 }}>✨ RÉSUMÉ IA</div>
                          <div style={{ fontSize: 12, color: '#F0F3FF', lineHeight: 1.6 }}>{analysis.resume}</div>
                        </div>
                      )}

                      {/* Plan de trade en priorité */}
                      {analysis.plan && <PlanTable plan={analysis.plan} />}

                      {/* Sections techniques */}
                      <AnalysisBlock icon="🏗️" label="Structure de marché" content={analysis.structure} color="#0A85FF" />
                      <AnalysisBlock icon="🎯" label="Zones clés" content={analysis.zones} color="#FF9500" />
                      <AnalysisBlock icon="📊" label="Momentum & Indicateurs" content={analysis.momentum || analysis.indicateurs} color="#22C759" />
                      <AnalysisBlock icon="🔷" label="Patterns chartistes" content={analysis.patterns} color="#BF5AF2" />
                      <AnalysisBlock icon="🧠" label="Psychologie & Vigilance" content={analysis.psychologie} color="#FF9500" />
                    </div>
                  ) : (
                    // Fallback si JSON non parseable — affichage brut
                    <div style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', border: '1px solid #2A2F3E', borderRadius: 10 }}>
                      <div style={{ fontSize: 10, color: '#555C70', marginBottom: 8 }}>✨ Analyse IA</div>
                      <div style={{ fontSize: 12, color: '#C5C8D6', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{rawText}</div>
                    </div>
                  )}

                  {/* Bouton re-analyser */}
                  <button
                    onClick={analyze}
                    style={{ marginTop: 12, width: '100%', padding: '8px', borderRadius: 8, background: 'transparent', border: '1px solid #2A2F3E', color: '#555C70', fontSize: 11, cursor: 'pointer' }}
                  >
                    ↺ Relancer l'analyse
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
