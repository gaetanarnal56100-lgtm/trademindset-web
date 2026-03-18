// src/pages/analyse/AnalysePage.tsx
import { useState, useRef, useCallback } from 'react'

type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w'
type SignalStatus = 'BUY' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'SELL'

interface TradePlan {
  biais: string; entree: string; stop: string; objectifs: string
  confirmation: string; invalidation: string; rr?: string
}
interface ChartAnalysis {
  resume: string; structure: string; zones: string; momentum: string
  patterns: string; indicateurs: string; mtf: string; plan: TradePlan
  psychologie: string; confluences?: string; risques?: string
  scenarioAlternatif?: string; symbol?: string
}
interface MTFReading {
  timeframe: Timeframe; rsiValue: number; rsiStatus: SignalStatus
  vmcValue: number; vmcStatus: SignalStatus; combinedScore: number
  combinedSignal: SignalStatus; hasDivergence: boolean
}
interface TimeframeImage { timeframe: Timeframe; file: File; preview: string }

const TIMEFRAMES = [
  { value: '1m' as Timeframe, label: '1 Min' }, { value: '5m' as Timeframe, label: '5 Min' },
  { value: '15m' as Timeframe, label: '15 Min' }, { value: '30m' as Timeframe, label: '30 Min' },
  { value: '1h' as Timeframe, label: '1H' }, { value: '4h' as Timeframe, label: '4H' },
  { value: '1d' as Timeframe, label: '1J' }, { value: '1w' as Timeframe, label: '1S' },
]
const SIG: Record<SignalStatus, { label: string; color: string; bg: string }> = {
  BUY:     { label: 'ACHETER',  color: '#22C759', bg: 'rgba(34,199,89,0.12)' },
  BULLISH: { label: 'HAUSSIER', color: '#FFD60A', bg: 'rgba(255,214,10,0.12)' },
  NEUTRAL: { label: 'NEUTRE',   color: '#8F94A3', bg: 'rgba(143,148,163,0.12)' },
  BEARISH: { label: 'BAISSIER', color: '#FF9500', bg: 'rgba(255,149,0,0.12)' },
  SELL:    { label: 'VENDRE',   color: '#FF3B30', bg: 'rgba(255,59,48,0.12)' },
}

function Sig({ s }: { s: SignalStatus }) {
  const c = SIG[s]
  return <span style={{ background: c.bg, color: c.color, border: `1px solid ${c.color}40`, padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700 }}>{c.label}</span>
}

function Bar({ v, label }: { v: number; label: string }) {
  const pct = (v + 100) / 2
  const color = v > 20 ? '#22C759' : v < -20 ? '#FF3B30' : '#8F94A3'
  return (
    <div style={{ marginBottom: 6 }}>
      {label && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: '#8F94A3' }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color, fontFamily: 'monospace' }}>{v > 0 ? '+' : ''}{Math.round(v)}</span>
      </div>}
      <div style={{ height: 4, background: '#2A2F3E', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 0.4s' }} />
      </div>
    </div>
  )
}

function Collapse({ title, icon, children, open: defaultOpen = false }: { title: string; icon: string; children: React.ReactNode; open?: boolean }) {
  const [o, setO] = useState(defaultOpen)
  return (
    <div style={{ border: '1px solid #2A2F3E', borderRadius: 10, overflow: 'hidden', marginBottom: 8 }}>
      <button onClick={() => setO(x => !x)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#161B22', border: 'none', cursor: 'pointer', color: '#F0F3FF' }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{icon} {title}</span>
        <span style={{ color: '#555C70', fontSize: 11, transform: o ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
      </button>
      {o && <div style={{ padding: '12px 14px', background: '#0D1117', borderTop: '1px solid #2A2F3E', fontSize: 13, color: '#C5C8D6', lineHeight: 1.7 }}>{children}</div>}
    </div>
  )
}

function MTFDash({ readings }: { readings: MTFReading[] }) {
  const avg = readings.reduce((s, r) => s + r.combinedScore, 0) / readings.length
  const gs: SignalStatus = avg > 40 ? 'BUY' : avg > 15 ? 'BULLISH' : avg < -40 ? 'SELL' : avg < -15 ? 'BEARISH' : 'NEUTRAL'
  const conf = Math.round(readings.filter(r => (r.rsiStatus === 'BUY' || r.rsiStatus === 'BULLISH') && (r.vmcStatus === 'BUY' || r.vmcStatus === 'BULLISH')).length / readings.length * 100)
  return (
    <div>
      <div style={{ background: '#161B22', border: '1px solid #2A2F3E', borderRadius: 12, padding: 14, marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <div><div style={{ fontSize: 10, color: '#555C70', marginBottom: 4 }}>SIGNAL GLOBAL</div><Sig s={gs} /></div>
          <div style={{ textAlign: 'right' }}><div style={{ fontSize: 10, color: '#555C70', marginBottom: 2 }}>CONFLUENCE</div><div style={{ fontSize: 20, fontWeight: 700, color: conf > 60 ? '#22C759' : conf > 40 ? '#FFD60A' : '#FF3B30', fontFamily: 'monospace' }}>{conf}%</div></div>
        </div>
        <Bar v={avg} label="Score global" />
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {readings.map(r => (
          <div key={r.timeframe} style={{ background: '#161B22', border: '1px solid #2A2F3E', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: 8, background: '#1C2130', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#00E5FF', flexShrink: 0 }}>
              {TIMEFRAMES.find(t => t.value === r.timeframe)?.label ?? r.timeframe}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 5, marginBottom: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#555C70' }}>RSI</span><Sig s={r.rsiStatus} />
                <span style={{ fontSize: 10, color: '#555C70', fontFamily: 'monospace' }}>{Math.round(r.rsiValue)}</span>
                <span style={{ fontSize: 10, color: '#555C70', marginLeft: 6 }}>VMC</span><Sig s={r.vmcStatus} />
                <span style={{ fontSize: 10, color: '#555C70', fontFamily: 'monospace' }}>{r.vmcValue > 0 ? '+' : ''}{Math.round(r.vmcValue)}</span>
              </div>
              <Bar v={r.combinedScore} label="" />
            </div>
            <div style={{ flexShrink: 0, textAlign: 'center' }}>
              <Sig s={r.combinedSignal} />
              {r.hasDivergence && <div style={{ fontSize: 9, color: '#FF9500', marginTop: 3 }}>⚡ DIV</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PlanCard({ plan }: { plan: TradePlan }) {
  const rows = [
    { l: 'Biais', v: plan.biais, i: '🎯' }, { l: 'Entrée', v: plan.entree, i: '📍' },
    { l: 'Stop', v: plan.stop, i: '🛑' }, { l: 'Objectifs', v: plan.objectifs, i: '✅' },
    { l: 'Confirmation', v: plan.confirmation, i: '✔️' }, { l: 'Invalidation', v: plan.invalidation, i: '❌' },
    ...(plan.rr ? [{ l: 'R/R', v: plan.rr, i: '⚖️' }] : []),
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {rows.map(({ l, v, i }) => (
        <div key={l} style={{ background: '#161B22', border: '1px solid #2A2F3E', borderRadius: 8, padding: 10 }}>
          <div style={{ fontSize: 10, color: '#555C70', marginBottom: 3 }}>{i} {l}</div>
          <div style={{ fontSize: 12, color: '#F0F3FF', lineHeight: 1.5 }}>{v || '—'}</div>
        </div>
      ))}
    </div>
  )
}

function PhotoSection({ onResult }: { onResult: (a: ChartAnalysis) => void }) {
  const [images, setImages] = useState<TimeframeImage[]>([])
  const [tf, setTf] = useState<Timeframe>('1h')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)

  const addFile = useCallback((file: File) => {
    const preview = URL.createObjectURL(file)
    setImages(prev => [...prev.filter(i => i.timeframe !== tf), { timeframe: tf, file, preview }]
      .sort((a, b) => TIMEFRAMES.findIndex(t => t.value === a.timeframe) - TIMEFRAMES.findIndex(t => t.value === b.timeframe)))
  }, [tf])

  const analyze = async () => {
    if (!images.length) return
    setLoading(true); setErr(null)
    try {
      const payloads = await Promise.all(images.map(img => new Promise<{ timeframe: string; base64: string }>((res, rej) => {
        const r = new FileReader()
        r.onload = e => res({ timeframe: img.timeframe, base64: (e.target?.result as string).split(',')[1] })
        r.onerror = rej; r.readAsDataURL(img.file)
      })))
      const isMulti = payloads.length > 1
      const content: unknown[] = [
        { type: 'text', text: isMulti
          ? `Analyse ces ${payloads.length} graphiques (${payloads.map(p => p.timeframe).join(', ')}) et retourne UNIQUEMENT du JSON valide avec ces clés exactes: resume, structure, zones, momentum, patterns, indicateurs, mtf, plan{biais,entree,stop,objectifs,confirmation,invalidation,rr}, psychologie, confluences, risques, scenario_alternatif, symbol.`
          : 'Analyse ce graphique de trading et retourne UNIQUEMENT du JSON valide avec: resume, structure, zones, momentum, patterns, indicateurs, mtf, plan{biais,entree,stop,objectifs,confirmation,invalidation}, psychologie, symbol.' },
        ...payloads.map(p => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.base64 } })),
      ]
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 1000,
          system: 'Tu es expert en analyse technique trading crypto/forex. Réponds UNIQUEMENT en JSON strict, sans markdown.',
          messages: [{ role: 'user', content }],
        }),
      })
      const data = await resp.json()
      const text = data.content?.find((b: { type: string }) => b.type === 'text')?.text ?? ''
      let a: ChartAnalysis
      try { a = JSON.parse(text) } catch { const m = text.match(/\{[\s\S]*\}/); a = m ? JSON.parse(m[0]) : { resume: text, structure: '', zones: '', momentum: '', patterns: '', indicateurs: '', mtf: '', plan: { biais: '', entree: '', stop: '', objectifs: '', confirmation: '', invalidation: '' }, psychologie: '' } }
      onResult(a)
    } catch { setErr('Erreur lors de l\'analyse. Vérifiez votre connexion.') }
    finally { setLoading(false) }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
        {TIMEFRAMES.map(t => (
          <button key={t.value} onClick={() => setTf(t.value)} style={{ padding: '3px 9px', borderRadius: 5, fontSize: 11, fontWeight: 500, cursor: 'pointer', border: '1px solid', borderColor: tf === t.value ? '#00E5FF' : '#2A2F3E', background: tf === t.value ? 'rgba(0,229,255,0.1)' : '#161B22', color: tf === t.value ? '#00E5FF' : '#8F94A3' }}>
            {t.label}{images.find(i => i.timeframe === t.value) && <span style={{ marginLeft: 3, color: '#22C759' }}>●</span>}
          </button>
        ))}
      </div>
      <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) addFile(f) }} onClick={() => ref.current?.click()} style={{ border: '1.5px dashed #2A2F3E', borderRadius: 10, padding: 20, textAlign: 'center', cursor: 'pointer', marginBottom: 10, background: '#0D1117' }}>
        <div style={{ fontSize: 24, marginBottom: 6 }}>📊</div>
        <div style={{ fontSize: 12, color: '#8F94A3' }}>Dépose le chart <strong style={{ color: '#00E5FF' }}>{TIMEFRAMES.find(t => t.value === tf)?.label}</strong> ici ou clique</div>
        <input ref={ref} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && addFile(e.target.files[0])} />
      </div>
      {images.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 6, marginBottom: 10 }}>
          {images.map(img => (
            <div key={img.timeframe} style={{ position: 'relative' }}>
              <img src={img.preview} alt={img.timeframe} style={{ width: '100%', height: 70, objectFit: 'cover', borderRadius: 7, border: '1px solid #2A2F3E' }} />
              <div style={{ position: 'absolute', top: 3, left: 3, background: 'rgba(0,229,255,0.15)', color: '#00E5FF', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3 }}>{TIMEFRAMES.find(t => t.value === img.timeframe)?.label}</div>
              <button onClick={() => setImages(p => p.filter(i => i.timeframe !== img.timeframe))} style={{ position: 'absolute', top: 3, right: 3, width: 16, height: 16, borderRadius: '50%', background: '#FF3B30', border: 'none', color: 'white', fontSize: 9, cursor: 'pointer' }}>✕</button>
            </div>
          ))}
        </div>
      )}
      {err && <div style={{ padding: 10, background: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.3)', borderRadius: 7, fontSize: 12, color: '#FF3B30', marginBottom: 10 }}>{err}</div>}
      <button onClick={analyze} disabled={!images.length || loading} style={{ width: '100%', padding: '9px 0', borderRadius: 9, border: 'none', background: !images.length ? '#1C2130' : '#00E5FF', color: !images.length ? '#555C70' : '#0D1117', fontSize: 13, fontWeight: 600, cursor: !images.length ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
        {loading ? <><span style={{ width: 13, height: 13, border: '2px solid #0D111740', borderTopColor: '#0D1117', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />Analyse en cours...</> : `Analyser ${images.length > 1 ? `${images.length} charts` : 'le chart'}`}
      </button>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function Results({ a }: { a: ChartAnalysis }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ background: '#161B22', border: '1px solid #2A2F3E', borderRadius: 12, padding: 14, marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#F0F3FF' }}>{a.symbol ? `📊 ${a.symbol}` : '📊 Résultat'}</div>
          <span style={{ background: 'rgba(0,229,255,0.1)', color: '#00E5FF', fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 600 }}>AI</span>
        </div>
        <p style={{ fontSize: 13, color: '#C5C8D6', lineHeight: 1.7, margin: 0 }}>{a.resume}</p>
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: '#555C70', marginBottom: 7, textTransform: 'uppercase', letterSpacing: 1 }}>Plan de Trade</div>
        <PlanCard plan={a.plan} />
      </div>
      <Collapse title="Structure de marché" icon="📈" open><p style={{ margin: 0 }}>{a.structure || '—'}</p></Collapse>
      <Collapse title="Zones clés" icon="🗺️"><p style={{ margin: 0 }}>{a.zones || '—'}</p></Collapse>
      <Collapse title="Momentum & Indicateurs" icon="⚡"><p style={{ margin: 0 }}>{a.momentum}{a.indicateurs ? `\n${a.indicateurs}` : ''}</p></Collapse>
      <Collapse title="Patterns" icon="🔍"><p style={{ margin: 0 }}>{a.patterns || '—'}</p></Collapse>
      {a.confluences && <Collapse title="Confluences" icon="✨"><p style={{ margin: 0 }}>{a.confluences}</p></Collapse>}
      {a.risques && <Collapse title="Risques" icon="⚠️"><p style={{ margin: 0 }}>{a.risques}</p></Collapse>}
      <Collapse title="Multi-Timeframe" icon="🕐"><p style={{ margin: 0 }}>{a.mtf || '—'}</p></Collapse>
      <Collapse title="Psychologie & Gestion" icon="🧠"><p style={{ margin: 0 }}>{a.psychologie || '—'}</p></Collapse>
      {a.scenarioAlternatif && <Collapse title="Scénario alternatif" icon="↔️"><p style={{ margin: 0 }}>{a.scenarioAlternatif}</p></Collapse>}
    </div>
  )
}

function genMTF(): MTFReading[] {
  const tfs: Timeframe[] = ['15m', '1h', '4h', '1d']
  return tfs.map(tf => {
    const rsi = 40 + Math.random() * 40, vmc = -30 + Math.random() * 80
    const cs = (rsi - 50) * 0.6 + vmc * 0.4
    const gs = (v: number): SignalStatus => v > 40 ? 'BUY' : v > 15 ? 'BULLISH' : v < -40 ? 'SELL' : v < -15 ? 'BEARISH' : 'NEUTRAL'
    return { timeframe: tf, rsiValue: rsi, rsiStatus: gs(rsi - 50), vmcValue: vmc, vmcStatus: gs(vmc), combinedScore: cs, combinedSignal: gs(cs), hasDivergence: Math.random() > 0.7 }
  })
}

type Tab = 'photo' | 'mtf'

export default function AnalysePage() {
  const [tab, setTab] = useState<Tab>('photo')
  const [analysis, setAnalysis] = useState<ChartAnalysis | null>(null)
  const [mtf] = useState(genMTF)

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#F0F3FF', margin: 0 }}>Analyse</h1>
        <p style={{ fontSize: 13, color: '#8F94A3', margin: '4px 0 0' }}>Analyse AI des graphiques · Dashboard MTF · RSI & VMC</p>
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 18, background: '#161B22', padding: 4, borderRadius: 10, width: 'fit-content' }}>
        {([{ id: 'photo' as Tab, l: '📊 Photo Analysis' }, { id: 'mtf' as Tab, l: '📡 Dashboard MTF' }]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, background: tab === t.id ? '#00E5FF' : 'transparent', color: tab === t.id ? '#0D1117' : '#8F94A3', transition: 'all 0.15s' }}>{t.l}</button>
        ))}
      </div>
      {tab === 'photo' && (
        <div style={{ display: 'grid', gridTemplateColumns: analysis ? '1fr 1fr' : '600px', gap: 20 }}>
          <div style={{ background: '#161B22', border: '1px solid #2A2F3E', borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#F0F3FF', marginBottom: 12 }}>Importer des graphiques</div>
            <PhotoSection onResult={a => setAnalysis(a)} />
          </div>
          {analysis && <div style={{ overflowY: 'auto', maxHeight: '80vh' }}><Results a={analysis} /></div>}
        </div>
      )}
      {tab === 'mtf' && (
        <div>
          <div style={{ background: '#161B22', border: '1px solid #2A2F3E', borderRadius: 12, padding: 16, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#F0F3FF' }}>BTCUSDT — Multi-Timeframe</div>
              <span style={{ fontSize: 10, color: '#555C70', background: '#1C2130', padding: '2px 7px', borderRadius: 4 }}>Démo</span>
            </div>
            <MTFDash readings={mtf} />
          </div>
          <div style={{ background: 'rgba(0,229,255,0.05)', border: '1px solid rgba(0,229,255,0.15)', borderRadius: 9, padding: 11, fontSize: 12, color: '#8F94A3' }}>
            💡 Les données MTF temps réel seront connectées via Binance WebSocket dans la prochaine version.
          </div>
        </div>
      )}
    </div>
  )
}
