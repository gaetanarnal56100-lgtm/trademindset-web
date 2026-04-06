// NotificationBell.tsx — Système de notifications complet avec réglages granulaires + historique alertes intégré
import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { signalService, TradingSignal, type SignalType } from '@/services/notifications/SignalNotificationService'

// ── Signal metadata (repris d'AlertesPage) ────────────────────────────────
const SIGNAL_META: Record<SignalType, { icon: string; label: string; color: string; bg: string; desc: string }> = {
  WT_SMART_BULL:  { icon:'⭐', label:'WT Smart Bull',   color:'var(--tm-accent)',   bg:'rgba(0,229,255,0.12)',       desc:'Croisement WT1/WT2 en zone de survente extrême — signal premium de retournement haussier.' },
  WT_SMART_BEAR:  { icon:'⭐', label:'WT Smart Bear',   color:'var(--tm-loss)',     bg:'rgba(255,59,48,0.12)',       desc:'Croisement WT1/WT2 en zone de surachat extrême — signal premium de retournement baissier.' },
  WT_BULL:        { icon:'📈', label:'WT Bullish',       color:'var(--tm-profit)',   bg:'rgba(34,199,89,0.10)',       desc:'Croisement haussier WaveTrend (WT1 passe au-dessus de WT2).' },
  WT_BEAR:        { icon:'📉', label:'WT Bearish',       color:'var(--tm-loss)',     bg:'rgba(255,59,48,0.10)',       desc:'Croisement baissier WaveTrend (WT1 passe en dessous de WT2).' },
  VMC_BUY:        { icon:'🟢', label:'VMC BUY',          color:'var(--tm-profit)',   bg:'rgba(34,199,89,0.12)',       desc:"Le VMC Oscillator confirme un signal d'achat — croisement haussier confirmé par le ribbon et le momentum." },
  VMC_SELL:       { icon:'🔴', label:'VMC SELL',          color:'var(--tm-loss)',     bg:'rgba(255,59,48,0.12)',       desc:'Le VMC Oscillator confirme un signal de vente — croisement baissier confirmé par le ribbon et le momentum.' },
  VMC_COMPRESSION:{ icon:'🔄', label:'VMC Compression',  color:'var(--tm-warning)',  bg:'rgba(255,149,0,0.12)',       desc:'Les EMAs du ribbon se compriment — breakout potentiel imminent.' },
  MTF_BUY:        { icon:'🎯', label:'MTF BUY',          color:'var(--tm-profit)',   bg:'rgba(34,199,89,0.12)',       desc:"Signal d'achat multi-timeframe avec forte confluence (>70%). RSI + VMC alignés sur plusieurs TFs." },
  MTF_SELL:       { icon:'🎯', label:'MTF SELL',          color:'var(--tm-loss)',     bg:'rgba(255,59,48,0.12)',       desc:"Signal de vente multi-timeframe avec forte confluence (>70%). RSI + VMC alignés sur plusieurs TFs." },
  MTF_CONFLUENCE: { icon:'🔗', label:'MTF Confluence',    color:'var(--tm-purple)',   bg:'rgba(191,90,242,0.12)',      desc:'Confluence élevée sur le dashboard MTF — la majorité des timeframes pointent dans la même direction.' },
}

const URGENCY_BADGE: Record<string, { label: string; color: string }> = {
  premium: { label: 'PREMIUM', color: '#FFD700' },
  high:    { label: 'HIGH',    color: 'var(--tm-loss)' },
  medium:  { label: 'MEDIUM',  color: 'var(--tm-warning)' },
  low:     { label: 'LOW',     color: 'var(--tm-text-secondary)' },
}

type AlertFilter = 'all' | 'wt' | 'vmc' | 'mtf'

function timeAgoLong(d: Date): string {
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'à l\'instant'
  if (diff < 3600_000) return `il y a ${Math.floor(diff/60_000)}m`
  if (diff < 86400_000) return `il y a ${Math.floor(diff/3600_000)}h`
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
}

function AlertSignalCard({ signal, expanded, onToggle }: { signal: TradingSignal; expanded: boolean; onToggle: () => void }) {
  const meta = SIGNAL_META[signal.type as SignalType]
  const urgencyKey = signal.urgency ?? (signal.type.includes('SMART') ? 'premium' : signal.type.includes('BUY')||signal.type.includes('SELL')||signal.type.includes('CONFLUENCE') ? 'high' : 'medium')
  const urg = URGENCY_BADGE[urgencyKey]
  if (!meta) return null
  return (
    <div onClick={onToggle} style={{
      background: expanded ? meta.bg : 'transparent',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
      padding: '10px 16px', cursor: 'pointer', transition: 'background 0.15s',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <div style={{ width:34, height:34, borderRadius:10, background: meta.bg, border:`1px solid ${meta.color}30`,
          display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>
          {meta.icon}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:2, flexWrap:'wrap' }}>
            <span style={{ fontSize:11, fontWeight:700, color:meta.color }}>{meta.label}</span>
            {urg && <span style={{ fontSize:9, fontWeight:700, color:urg.color, background:`${urg.color}18`, padding:'1px 6px', borderRadius:8, border:`1px solid ${urg.color}30` }}>{urg.label}</span>}
            <span style={{ fontSize:9, color:'var(--tm-text-muted)', marginLeft:'auto', fontFamily:'JetBrains Mono,monospace' }}>{timeAgoLong(signal.timestamp)}</span>
          </div>
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            <span style={{ fontSize:11, fontWeight:600, color:'#F59714', fontFamily:'JetBrains Mono,monospace' }}>{signal.symbol}</span>
            <span style={{ fontSize:10, color:'var(--tm-text-muted)' }}>·</span>
            <span style={{ fontSize:10, color:'var(--tm-text-secondary)' }}>{signal.timeframe}</span>
          </div>
          <div style={{ fontSize:11, color:'#C5C8D6', marginTop:2 }}>{signal.message}</div>
        </div>
        <div style={{ fontSize:10, color:'var(--tm-text-muted)', transform:expanded?'rotate(180deg)':'none', transition:'transform 0.2s', flexShrink:0 }}>▼</div>
      </div>
      {expanded && (
        <div style={{ marginTop:10, paddingTop:10, borderTop:`1px solid ${meta.color}20` }}>
          <div style={{ fontSize:10, fontWeight:700, color:'var(--tm-text-secondary)', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.08em' }}>Explication</div>
          <div style={{ fontSize:11, color:'#C5C8D6', lineHeight:1.6 }}>{meta.desc}</div>
          {signal.detail && (
            <div style={{ marginTop:6, padding:'6px 10px', background:'rgba(0,0,0,0.25)', borderRadius:6, fontFamily:'JetBrains Mono,monospace', fontSize:10, color:'var(--tm-text-secondary)' }}>
              {signal.detail}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────
interface NotifPrefs {
  masterEnabled: boolean
  browserEnabled: boolean
  toastEnabled: boolean
  soundEnabled: boolean
  soundVolume: number // 0-100
  cooldownMinutes: number
  minScore: number // 0-100
  signals: {
    WT_SMART_BULL: { enabled: boolean; sound: boolean; browser: boolean }
    WT_SMART_BEAR: { enabled: boolean; sound: boolean; browser: boolean }
    WT_BULL:       { enabled: boolean; sound: boolean; browser: boolean }
    WT_BEAR:       { enabled: boolean; sound: boolean; browser: boolean }
    VMC_BUY:       { enabled: boolean; sound: boolean; browser: boolean }
    VMC_SELL:      { enabled: boolean; sound: boolean; browser: boolean }
    VMC_COMPRESSION:{ enabled: boolean; sound: boolean; browser: boolean }
    MTF_BUY:       { enabled: boolean; sound: boolean; browser: boolean }
    MTF_SELL:      { enabled: boolean; sound: boolean; browser: boolean }
    MTF_CONFLUENCE:{ enabled: boolean; sound: boolean; browser: boolean }
  }
}

const DEFAULT_PREFS: NotifPrefs = {
  masterEnabled: true,
  browserEnabled: false,
  toastEnabled: true,
  soundEnabled: true,
  soundVolume: 60,
  cooldownMinutes: 5,
  minScore: 70,
  signals: {
    WT_SMART_BULL:    { enabled: true,  sound: true,  browser: true  },
    WT_SMART_BEAR:    { enabled: true,  sound: true,  browser: true  },
    WT_BULL:          { enabled: true,  sound: false, browser: false },
    WT_BEAR:          { enabled: true,  sound: false, browser: false },
    VMC_BUY:          { enabled: true,  sound: true,  browser: true  },
    VMC_SELL:         { enabled: true,  sound: true,  browser: true  },
    VMC_COMPRESSION:  { enabled: false, sound: false, browser: false },
    MTF_BUY:          { enabled: true,  sound: true,  browser: true  },
    MTF_SELL:         { enabled: true,  sound: true,  browser: true  },
    MTF_CONFLUENCE:   { enabled: true,  sound: true,  browser: true  },
  }
}

const SIGNAL_GROUPS = [
  {
    group: 'WaveTrend',
    color: 'var(--tm-warning)',
    items: [
      { key: 'WT_SMART_BULL', label: '⭐ Smart Bullish Reversal', urgency: 'premium' },
      { key: 'WT_SMART_BEAR', label: '⭐ Smart Bearish Reversal', urgency: 'premium' },
      { key: 'WT_BULL',       label: '↑ Bullish Crossover',       urgency: 'medium'  },
      { key: 'WT_BEAR',       label: '↓ Bearish Crossover',       urgency: 'medium'  },
    ]
  },
  {
    group: 'VMC Oscillator',
    color: 'var(--tm-accent)',
    items: [
      { key: 'VMC_BUY',         label: '▲ Signal BUY',       urgency: 'high'   },
      { key: 'VMC_SELL',        label: '▼ Signal SELL',      urgency: 'high'   },
      { key: 'VMC_COMPRESSION', label: '⟳ Compression',     urgency: 'low'    },
    ]
  },
  {
    group: 'MTF Dashboard',
    color: 'var(--tm-purple)',
    items: [
      { key: 'MTF_BUY',        label: '▲ Confluence Bull ≥70%', urgency: 'high'   },
      { key: 'MTF_SELL',       label: '▼ Confluence Bear ≥70%', urgency: 'high'   },
      { key: 'MTF_CONFLUENCE', label: '◆ Forte confluence',      urgency: 'medium' },
    ]
  },
]

const URGENCY_COLOR: Record<string,string> = { premium:'#FFD700', high:'var(--tm-loss)', medium:'var(--tm-warning)', low:'var(--tm-text-secondary)' }

function timeAgo(d: Date) {
  const s = Math.floor((Date.now() - (d instanceof Date && !isNaN(d.getTime()) ? d.getTime() : Date.now())) / 1000)
  if (s < 60) return `${s}s`; if (s < 3600) return `${Math.floor(s/60)}m`; return `${Math.floor(s/3600)}h`
}

// ── Sound synthesis (Web Audio API) ─────────────────────────────────────
function playSound(type: 'ping' | 'chime' | 'premium', volume: number) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(volume / 100 * 0.4, ctx.currentTime)
    gain.connect(ctx.destination)

    if (type === 'ping') {
      const osc = ctx.createOscillator()
      osc.connect(gain); osc.type = 'sine'; osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25)
      osc.start(); osc.stop(ctx.currentTime + 0.25)
    } else if (type === 'chime') {
      [523, 659, 784].forEach((freq, i) => {
        const osc = ctx.createOscillator()
        osc.connect(gain); osc.type = 'sine'; osc.frequency.value = freq
        gain.gain.setValueAtTime(volume / 100 * 0.3, ctx.currentTime + i * 0.1)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.1 + 0.35)
        osc.start(ctx.currentTime + i * 0.1); osc.stop(ctx.currentTime + i * 0.1 + 0.4)
      })
    } else { // premium
      [784, 988, 1175].forEach((freq, i) => {
        const osc = ctx.createOscillator()
        osc.connect(gain); osc.type = 'triangle'; osc.frequency.value = freq
        gain.gain.setValueAtTime(volume / 100 * 0.35, ctx.currentTime + i * 0.08)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.08 + 0.5)
        osc.start(ctx.currentTime + i * 0.08); osc.stop(ctx.currentTime + i * 0.08 + 0.5)
      })
    }
  } catch {}
}

// ── Toast component ───────────────────────────────────────────────────────
interface Toast { id: string; signal: TradingSignal; urgency: string }
let toastListeners: ((t: Toast[]) => void)[] = []
let activeToasts: Toast[] = []
function addToast(t: Toast) {
  activeToasts = [t, ...activeToasts].slice(0, 5)
  toastListeners.forEach(fn => fn([...activeToasts]))
  setTimeout(() => { activeToasts = activeToasts.filter(x => x.id !== t.id); toastListeners.forEach(fn => fn([...activeToasts])) }, 6000)
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [hovered, setHovered] = useState<string | null>(null)
  useEffect(() => { toastListeners.push(setToasts); return () => { toastListeners = toastListeners.filter(fn => fn !== setToasts) } }, [])
  if (!toasts.length) return null
  return (
    <div style={{ position:'fixed', top:20, right:20, zIndex:9999, display:'flex', flexDirection:'column', gap:10, pointerEvents:'none' }}>
      {toasts.map(t => {
        const c = URGENCY_COLOR[t.urgency] || 'var(--tm-text-secondary)'
        const isPremium = t.urgency === 'premium'
        return (
          <div key={t.id} onMouseEnter={()=>setHovered(t.id)} onMouseLeave={()=>setHovered(null)}
            style={{ pointerEvents:'all', background:'var(--tm-bg-secondary)', border:`1px solid ${c}40`,
              borderLeft:`3px solid ${c}`, borderRadius:12, padding:'12px 16px', minWidth:260, maxWidth:320,
              boxShadow:`0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)`,
              animation:'slideIn 0.25s ease', cursor:'default',
              opacity: hovered && hovered !== t.id ? 0.7 : 1, transition:'opacity 0.2s'
            }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
              <span style={{ fontSize:10, fontWeight:700, color:c, textTransform:'uppercase', letterSpacing:'0.08em' }}>
                {isPremium ? '⭐ ' : ''}{t.signal.type.replace(/_/g,' ')}
              </span>
              <span style={{ fontSize:9, color:'var(--tm-text-muted)' }}>{timeAgo(t.signal.timestamp)}</span>
            </div>
            <div style={{ fontSize:14, fontWeight:700, color:'var(--tm-text-primary)', marginBottom:3 }}>{t.signal.symbol} · {t.signal.timeframe}</div>
            <div style={{ fontSize:11, color:'var(--tm-text-secondary)' }}>{t.signal.message}</div>
            {t.signal.score != null && (
              <div style={{ marginTop:8, display:'flex', alignItems:'center', gap:6 }}>
                <div style={{ flex:1, height:3, background:'var(--tm-bg-tertiary)', borderRadius:2 }}>
                  <div style={{ height:'100%', width:`${t.signal.score}%`, background:c, borderRadius:2 }}/>
                </div>
                <span style={{ fontSize:9, color:c, fontFamily:'JetBrains Mono, monospace', fontWeight:700 }}>{t.signal.score}%</span>
              </div>
            )}
          </div>
        )
      })}
      <style>{`@keyframes slideIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}`}</style>
    </div>
  )
}

// ── Toggle component ───────────────────────────────────────────────────────
function Toggle({ value, onChange, size = 'md' }: { value: boolean; onChange: (v: boolean) => void; size?: 'sm' | 'md' }) {
  const w = size === 'sm' ? 28 : 36, h = size === 'sm' ? 16 : 20, r = size === 'sm' ? 5 : 7
  return (
    <div onClick={() => onChange(!value)} style={{ width:w, height:h, borderRadius:h/2, background:value?'var(--tm-profit)':'var(--tm-border)',
      cursor:'pointer', position:'relative', transition:'background 0.2s', flexShrink:0 }}>
      <div style={{ position:'absolute', top:2, left: value ? w-h+2 : 2, width:h-4, height:h-4, borderRadius:'50%',
        background:'#fff', transition:'left 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,0.3)' }}/>
    </div>
  )
}

// ── Main NotificationBell ─────────────────────────────────────────────────
export default function NotificationBell() {
  const [signals,      setSignals]      = useState<TradingSignal[]>([])
  const [open,         setOpen]         = useState(false)
  const [tab,          setTab]          = useState<'alertes' | 'settings'>('alertes')
  const [alertFilter,  setAlertFilter]  = useState<AlertFilter>('all')
  const [expandedId,   setExpandedId]   = useState<string | null>(null)
  const [hasNew,       setHasNew]       = useState(false)
  const [granted,      setGranted]      = useState(false)
  const [prefs,        setPrefs]        = useState<NotifPrefs>(() => {
    try { const s = localStorage.getItem('notif_prefs'); return s ? { ...DEFAULT_PREFS, ...JSON.parse(s) } : DEFAULT_PREFS } catch { return DEFAULT_PREFS }
  })
  const panelRef = useRef<HTMLDivElement>(null)

  // Save prefs
  useEffect(() => { try { localStorage.setItem('notif_prefs', JSON.stringify(prefs)) } catch {} }, [prefs])

  // Close handled by overlay click only (portal-based modal)

  // Signal subscription
  useEffect(() => {
    setSignals(signalService.getHistory())
    return signalService.subscribe(sig => {
      if (!sig?.id) { setSignals(signalService.getHistory()); return }
      const sigPrefs = prefs.signals[sig.type as keyof typeof prefs.signals]
      if (!prefs.masterEnabled || !sigPrefs?.enabled) return
      setSignals(signalService.getHistory())
      setHasNew(true)
      // Toast
      if (prefs.toastEnabled) {
        const urgency = sig.type.includes('SMART') ? 'premium' : sig.type.includes('BUY') || sig.type.includes('SELL') || sig.type.includes('CONFLUENCE') ? 'high' : 'medium'
        addToast({ id: sig.id, signal: sig, urgency })
      }
      // Sound
      if (prefs.soundEnabled && sigPrefs?.sound) {
        const soundType = sig.type.includes('SMART') ? 'premium' : sig.type.includes('BUY') || sig.type.includes('BULL') ? 'chime' : 'ping'
        playSound(soundType, prefs.soundVolume)
      }
      // Browser notif
      if (prefs.browserEnabled && granted && sigPrefs?.browser) {
        try {
          new Notification(`TradeMindset · ${sig.symbol}`, { body: sig.message, icon: '/favicon.svg' })
        } catch {}
      }
    })
  }, [prefs, granted])

  const requestPerm = useCallback(async () => {
    const r = await Notification.requestPermission()
    setGranted(r === 'granted')
    if (r === 'granted') updatePref('browserEnabled', true)
  }, [])

  const recent = signals.filter(s => (s.timestamp instanceof Date ? Date.now()-s.timestamp.getTime() : Infinity) < 30*60*1000).length

  const filteredSignals = signals.filter(s => {
    if (alertFilter === 'wt')  return s.type.startsWith('WT_')
    if (alertFilter === 'vmc') return s.type.startsWith('VMC_')
    if (alertFilter === 'mtf') return s.type.startsWith('MTF_')
    return true
  })
  const wtCount  = signals.filter(s => s.type.startsWith('WT_')).length
  const vmcCount = signals.filter(s => s.type.startsWith('VMC_')).length
  const mtfCount = signals.filter(s => s.type.startsWith('MTF_')).length

  function updatePref<K extends keyof NotifPrefs>(key: K, value: NotifPrefs[K]) {
    setPrefs(p => ({ ...p, [key]: value }))
  }
  function updateSignalPref(sigKey: string, field: 'enabled' | 'sound' | 'browser', value: boolean) {
    setPrefs(p => ({ ...p, signals: { ...p.signals, [sigKey]: { ...p.signals[sigKey as keyof typeof p.signals], [field]: value } } }))
  }

  const Row = ({ label, sub, right }: { label: string; sub?: string; right: React.ReactNode }) => (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
      <div>
        <div style={{ fontSize:12, fontWeight:600, color:'var(--tm-text-primary)' }}>{label}</div>
        {sub && <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginTop:2 }}>{sub}</div>}
      </div>
      {right}
    </div>
  )

  return (
    <div ref={panelRef} style={{ position:'relative' }}>
      {/* Bell button */}
      <button onClick={() => { setOpen(x => !x); setHasNew(false) }}
        style={{ position:'relative', background:'none', border:'none', cursor:'pointer', padding:'6px', borderRadius:8,
          color: open ? 'var(--tm-text-primary)' : 'var(--tm-text-secondary)', fontSize:18, transition:'color 0.2s' }}>
        🔔
        {hasNew && recent > 0 && (
          <div style={{ position:'absolute', top:2, right:2, width:16, height:16, borderRadius:'50%', background:'var(--tm-loss)',
            fontSize:9, fontWeight:700, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center' }}>
            {recent > 9 ? '9+' : recent}
          </div>
        )}
        {/* Master off indicator */}
        {!prefs.masterEnabled && (
          <div style={{ position:'absolute', bottom:2, right:2, width:8, height:8, borderRadius:'50%', background:'var(--tm-text-muted)', border:'1px solid #161B22' }}/>
        )}
      </button>

      {/* Modal overlay — portal into body so it's always on top */}
      {open && createPortal(
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.65)', zIndex:99999,
          display:'flex', alignItems:'center', justifyContent:'center' }}
          onMouseDown={()=>setOpen(false)}>
        <div style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:20, width:400, maxHeight:'85vh',
          boxShadow:'0 32px 80px rgba(0,0,0,0.8)', zIndex:100000, display:'flex', flexDirection:'column', overflow:'hidden' }}
          onMouseDown={e=>e.stopPropagation()}>

          {/* Header */}
          <div style={{ padding:'14px 16px 0', borderBottom:'1px solid #1E2330' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
              <div style={{ fontSize:13, fontWeight:700, color:'var(--tm-text-primary)' }}>Notifications</div>
              <Toggle value={prefs.masterEnabled} onChange={v => updatePref('masterEnabled', v)}/>
            </div>
            {/* Tabs */}
            <div style={{ display:'flex', gap:4 }}>
              {(['alertes','settings'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} style={{ flex:1, padding:'7px 0', borderRadius:'8px 8px 0 0',
                  background: tab===t ? 'var(--tm-bg)' : 'transparent',
                  border:'none', cursor:'pointer', fontSize:11, fontWeight:600,
                  color: tab===t ? 'var(--tm-text-primary)' : 'var(--tm-text-muted)', borderBottom: tab===t ? 'none' : undefined }}>
                  {t === 'alertes' ? `🔔 Alertes${signals.length > 0 ? ` (${signals.length})` : ''}` : '⚙ Réglages'}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div style={{ overflowY:'auto', flex:1 }}>

            {/* ── ALERTES TAB ── */}
            {tab === 'alertes' && (
              <div>
                {/* Stats + filter row */}
                {signals.length > 0 && (
                  <div style={{ padding:'8px 12px', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                    {/* Mini stats */}
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6, marginBottom:8 }}>
                      {[
                        { label:'Total',   value:signals.length, color:'var(--tm-text-primary)' },
                        { label:'WT',      value:wtCount,        color:'#37D7FF' },
                        { label:'VMC',     value:vmcCount,       color:'var(--tm-warning)' },
                        { label:'MTF',     value:mtfCount,       color:'var(--tm-purple)' },
                      ].map(({ label, value, color }) => (
                        <div key={label} style={{ textAlign:'center', padding:'5px 0', background:'rgba(255,255,255,0.02)', borderRadius:8, border:'1px solid #1E2330' }}>
                          <div style={{ fontSize:15, fontWeight:800, color, fontFamily:'JetBrains Mono,monospace' }}>{value}</div>
                          <div style={{ fontSize:9, color:'var(--tm-text-muted)', marginTop:1 }}>{label}</div>
                        </div>
                      ))}
                    </div>
                    {/* Filter pills */}
                    <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                      {([
                        { id:'all' as AlertFilter, label:'Toutes',   count:signals.length },
                        { id:'wt'  as AlertFilter, label:'WT',       count:wtCount },
                        { id:'vmc' as AlertFilter, label:'VMC',      count:vmcCount },
                        { id:'mtf' as AlertFilter, label:'MTF',      count:mtfCount },
                      ]).map(f => (
                        <button key={f.id} onClick={() => setAlertFilter(f.id)} style={{
                          padding:'3px 10px', borderRadius:16, fontSize:10, fontWeight:600, cursor:'pointer',
                          border:`1px solid ${alertFilter===f.id ? 'var(--tm-warning)' : 'var(--tm-border)'}`,
                          background: alertFilter===f.id ? 'rgba(255,149,0,0.15)' : 'transparent',
                          color: alertFilter===f.id ? 'var(--tm-warning)' : 'var(--tm-text-muted)',
                        }}>
                          {f.label} {f.count > 0 && <span style={{ fontSize:9 }}>({f.count})</span>}
                        </button>
                      ))}
                      <button onClick={() => { signalService.clearHistory(); setSignals([]) }} style={{
                        marginLeft:'auto', padding:'3px 10px', borderRadius:16, fontSize:10,
                        background:'rgba(255,59,48,0.08)', border:'1px solid rgba(255,59,48,0.2)', color:'var(--tm-loss)', cursor:'pointer',
                      }}>
                        🗑
                      </button>
                    </div>
                  </div>
                )}
                {/* Signal cards */}
                {filteredSignals.length === 0 ? (
                  <div style={{ padding:'32px 16px', textAlign:'center', color:'var(--tm-text-muted)', fontSize:12 }}>
                    <div style={{ fontSize:28, marginBottom:8 }}>🔕</div>
                    <div style={{ fontWeight:600, color:'var(--tm-text-secondary)', marginBottom:4 }}>Aucune alerte</div>
                    <div style={{ fontSize:11, maxWidth:280, margin:'0 auto', lineHeight:1.5 }}>
                      Les alertes apparaissent automatiquement quand les oscillateurs WaveTrend et VMC détectent des signaux sur la page Analyse.
                    </div>
                  </div>
                ) : filteredSignals.map(sig => (
                  <AlertSignalCard key={sig.id} signal={sig} expanded={expandedId === sig.id}
                    onToggle={() => setExpandedId(expandedId === sig.id ? null : sig.id)} />
                ))}
              </div>
            )}

            {/* ── SETTINGS TAB ── */}
            {tab === 'settings' && (
              <div style={{ padding:'0 16px 16px' }}>

                {/* Global */}
                <div style={{ marginTop:16, marginBottom:4 }}>
                  <div style={{ fontSize:10, fontWeight:700, color:'var(--tm-text-muted)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>Global</div>
                  <Row label="Toasts visuels" sub="Popup en haut à droite" right={<Toggle value={prefs.toastEnabled} onChange={v=>updatePref('toastEnabled',v)}/>}/>
                  <Row label="Notifications browser" sub={granted ? 'Autorisé ✓' : 'Cliquer pour autoriser'}
                    right={granted
                      ? <Toggle value={prefs.browserEnabled} onChange={v=>updatePref('browserEnabled',v)}/>
                      : <button onClick={requestPerm} style={{fontSize:10,padding:'4px 10px',borderRadius:8,background:'rgba(var(--tm-blue-rgb,10,133,255),0.15)',border:'1px solid #0A85FF',color:'var(--tm-blue)',cursor:'pointer',fontWeight:600}}>Autoriser</button>
                    }/>
                  <Row label="Son activé" sub="Synthèse audio" right={<Toggle value={prefs.soundEnabled} onChange={v=>updatePref('soundEnabled',v)}/>}/>
                </div>

                {/* Son + volume */}
                {prefs.soundEnabled && (
                  <div style={{ padding:'10px 12px', background:'rgba(255,255,255,0.02)', borderRadius:10, marginBottom:12, border:'1px solid #1E2330' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                      <span style={{ fontSize:11, color:'var(--tm-text-secondary)' }}>Volume</span>
                      <span style={{ fontSize:11, fontWeight:700, color:'var(--tm-text-primary)', fontFamily:'JetBrains Mono, monospace' }}>{prefs.soundVolume}%</span>
                    </div>
                    <input type="range" min={0} max={100} value={prefs.soundVolume}
                      onChange={e=>updatePref('soundVolume',+e.target.value)}
                      style={{width:'100%',accentColor:'var(--tm-profit)',marginBottom:10}}/>
                    <div style={{ display:'flex', gap:6 }}>
                      {(['ping','chime','premium'] as const).map(t => (
                        <button key={t} onClick={()=>playSound(t,prefs.soundVolume)}
                          style={{flex:1,padding:'5px 0',borderRadius:8,background:'rgba(255,255,255,0.04)',border:'1px solid #2A2F3E',color:'var(--tm-text-secondary)',cursor:'pointer',fontSize:10}}>
                          ▶ {t}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Seuils */}
                <div style={{ padding:'10px 12px', background:'rgba(255,255,255,0.02)', borderRadius:10, marginBottom:12, border:'1px solid #1E2330' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                    <span style={{ fontSize:11, color:'var(--tm-text-secondary)' }}>Score minimum</span>
                    <span style={{ fontSize:11, fontWeight:700, color:'var(--tm-text-primary)', fontFamily:'JetBrains Mono, monospace' }}>{prefs.minScore}%</span>
                  </div>
                  <input type="range" min={0} max={100} value={prefs.minScore}
                    onChange={e=>updatePref('minScore',+e.target.value)}
                    style={{width:'100%',accentColor:'var(--tm-blue)',marginBottom:10}}/>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:11, color:'var(--tm-text-secondary)' }}>Cooldown anti-spam</span>
                    <div style={{ display:'flex', gap:4 }}>
                      {[2,5,10,15].map(m=>(
                        <button key={m} onClick={()=>updatePref('cooldownMinutes',m)}
                          style={{padding:'3px 8px',borderRadius:6,fontSize:10,cursor:'pointer',fontWeight:600,
                            background:prefs.cooldownMinutes===m?'rgba(var(--tm-blue-rgb,10,133,255),0.2)':'rgba(255,255,255,0.04)',
                            border:`1px solid ${prefs.cooldownMinutes===m?'var(--tm-blue)':'var(--tm-border)'}`,
                            color:prefs.cooldownMinutes===m?'var(--tm-blue)':'var(--tm-text-muted)'}}>
                          {m}m
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Par signal */}
                <div style={{ fontSize:10, fontWeight:700, color:'var(--tm-text-muted)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>Par signal</div>
                {/* Headers */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 32px 32px 32px', gap:4, marginBottom:6, paddingRight:2 }}>
                  <span/>
                  <span style={{fontSize:8,color:'var(--tm-text-muted)',textAlign:'center',fontWeight:700}}>ON</span>
                  <span style={{fontSize:8,color:'var(--tm-text-muted)',textAlign:'center',fontWeight:700}}>🔔</span>
                  <span style={{fontSize:8,color:'var(--tm-text-muted)',textAlign:'center',fontWeight:700}}>🔊</span>
                </div>

                {SIGNAL_GROUPS.map(g => (
                  <div key={g.group} style={{ marginBottom:12 }}>
                    <div style={{ fontSize:10, fontWeight:700, color:g.color, marginBottom:6, display:'flex', alignItems:'center', gap:6 }}>
                      <div style={{ width:8, height:8, borderRadius:2, background:g.color }}/>
                      {g.group}
                    </div>
                    {g.items.map(item => {
                      const sp = prefs.signals[item.key as keyof typeof prefs.signals]
                      return (
                        <div key={item.key} style={{ display:'grid', gridTemplateColumns:'1fr 32px 32px 32px', gap:4, alignItems:'center',
                          padding:'6px 0', borderBottom:'1px solid rgba(255,255,255,0.03)' }}>
                          <div>
                            <div style={{ fontSize:11, color: sp.enabled ? 'var(--tm-text-primary)' : 'var(--tm-text-muted)', transition:'color 0.2s' }}>{item.label}</div>
                          </div>
                          {/* Enabled */}
                          <div style={{ display:'flex', justifyContent:'center' }}>
                            <Toggle size="sm" value={sp.enabled} onChange={v=>updateSignalPref(item.key,'enabled',v)}/>
                          </div>
                          {/* Browser notif */}
                          <div style={{ display:'flex', justifyContent:'center' }}>
                            <Toggle size="sm" value={sp.browser && sp.enabled} onChange={v=>updateSignalPref(item.key,'browser',v)}/>
                          </div>
                          {/* Sound */}
                          <div style={{ display:'flex', justifyContent:'center' }}>
                            <Toggle size="sm" value={sp.sound && sp.enabled} onChange={v=>updateSignalPref(item.key,'sound',v)}/>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}

                {/* Reset */}
                <button onClick={()=>setPrefs(DEFAULT_PREFS)}
                  style={{width:'100%',marginTop:8,padding:'8px',borderRadius:8,background:'transparent',
                    border:'1px solid #2A2F3E',color:'var(--tm-text-muted)',cursor:'pointer',fontSize:11}}>
                  Réinitialiser les réglages
                </button>
              </div>
            )}
          </div>
        </div>
        </div>,
        document.body
      )}
    </div>
  )
}
