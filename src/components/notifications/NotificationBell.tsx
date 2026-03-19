// NotificationBell.tsx — Système de notifications complet avec réglages granulaires
import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { signalService, TradingSignal } from '@/services/notifications/SignalNotificationService'

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
    color: '#FF9500',
    items: [
      { key: 'WT_SMART_BULL', label: '⭐ Smart Bullish Reversal', urgency: 'premium' },
      { key: 'WT_SMART_BEAR', label: '⭐ Smart Bearish Reversal', urgency: 'premium' },
      { key: 'WT_BULL',       label: '↑ Bullish Crossover',       urgency: 'medium'  },
      { key: 'WT_BEAR',       label: '↓ Bearish Crossover',       urgency: 'medium'  },
    ]
  },
  {
    group: 'VMC Oscillator',
    color: '#00E5FF',
    items: [
      { key: 'VMC_BUY',         label: '▲ Signal BUY',       urgency: 'high'   },
      { key: 'VMC_SELL',        label: '▼ Signal SELL',      urgency: 'high'   },
      { key: 'VMC_COMPRESSION', label: '⟳ Compression',     urgency: 'low'    },
    ]
  },
  {
    group: 'MTF Dashboard',
    color: '#BF5AF2',
    items: [
      { key: 'MTF_BUY',        label: '▲ Confluence Bull ≥70%', urgency: 'high'   },
      { key: 'MTF_SELL',       label: '▼ Confluence Bear ≥70%', urgency: 'high'   },
      { key: 'MTF_CONFLUENCE', label: '◆ Forte confluence',      urgency: 'medium' },
    ]
  },
]

const URGENCY_COLOR: Record<string,string> = { premium:'#FFD700', high:'#FF3B30', medium:'#FF9500', low:'#8F94A3' }

function timeAgo(d: Date) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000)
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
        const c = URGENCY_COLOR[t.urgency] || '#8F94A3'
        const isPremium = t.urgency === 'premium'
        return (
          <div key={t.id} onMouseEnter={()=>setHovered(t.id)} onMouseLeave={()=>setHovered(null)}
            style={{ pointerEvents:'all', background:'#161B22', border:`1px solid ${c}40`,
              borderLeft:`3px solid ${c}`, borderRadius:12, padding:'12px 16px', minWidth:260, maxWidth:320,
              boxShadow:`0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)`,
              animation:'slideIn 0.25s ease', cursor:'default',
              opacity: hovered && hovered !== t.id ? 0.7 : 1, transition:'opacity 0.2s'
            }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
              <span style={{ fontSize:10, fontWeight:700, color:c, textTransform:'uppercase', letterSpacing:'0.08em' }}>
                {isPremium ? '⭐ ' : ''}{t.signal.type.replace(/_/g,' ')}
              </span>
              <span style={{ fontSize:9, color:'#555C70' }}>{timeAgo(t.signal.timestamp)}</span>
            </div>
            <div style={{ fontSize:14, fontWeight:700, color:'#F0F3FF', marginBottom:3 }}>{t.signal.symbol} · {t.signal.timeframe}</div>
            <div style={{ fontSize:11, color:'#8F94A3' }}>{t.signal.message}</div>
            {t.signal.score != null && (
              <div style={{ marginTop:8, display:'flex', alignItems:'center', gap:6 }}>
                <div style={{ flex:1, height:3, background:'#1C2130', borderRadius:2 }}>
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
    <div onClick={() => onChange(!value)} style={{ width:w, height:h, borderRadius:h/2, background:value?'#22C759':'#2A2F3E',
      cursor:'pointer', position:'relative', transition:'background 0.2s', flexShrink:0 }}>
      <div style={{ position:'absolute', top:2, left: value ? w-h+2 : 2, width:h-4, height:h-4, borderRadius:'50%',
        background:'#fff', transition:'left 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,0.3)' }}/>
    </div>
  )
}

// ── Main NotificationBell ─────────────────────────────────────────────────
export default function NotificationBell() {
  const [signals,  setSignals]  = useState<TradingSignal[]>([])
  const [open,     setOpen]     = useState(false)
  const [tab,      setTab]      = useState<'history' | 'settings'>('history')
  const [hasNew,   setHasNew]   = useState(false)
  const [granted,  setGranted]  = useState(false)
  const [prefs,    setPrefs]    = useState<NotifPrefs>(() => {
    try { const s = localStorage.getItem('notif_prefs'); return s ? { ...DEFAULT_PREFS, ...JSON.parse(s) } : DEFAULT_PREFS } catch { return DEFAULT_PREFS }
  })
  const panelRef = useRef<HTMLDivElement>(null)

  // Save prefs
  useEffect(() => { try { localStorage.setItem('notif_prefs', JSON.stringify(prefs)) } catch {} }, [prefs])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const fn = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [open])

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

  const recent = signals.filter(s => (Date.now()-s.timestamp.getTime()) < 30*60*1000).length

  function updatePref<K extends keyof NotifPrefs>(key: K, value: NotifPrefs[K]) {
    setPrefs(p => ({ ...p, [key]: value }))
  }
  function updateSignalPref(sigKey: string, field: 'enabled' | 'sound' | 'browser', value: boolean) {
    setPrefs(p => ({ ...p, signals: { ...p.signals, [sigKey]: { ...p.signals[sigKey as keyof typeof p.signals], [field]: value } } }))
  }

  const Row = ({ label, sub, right }: { label: string; sub?: string; right: React.ReactNode }) => (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
      <div>
        <div style={{ fontSize:12, fontWeight:600, color:'#F0F3FF' }}>{label}</div>
        {sub && <div style={{ fontSize:10, color:'#555C70', marginTop:2 }}>{sub}</div>}
      </div>
      {right}
    </div>
  )

  return (
    <div ref={panelRef} style={{ position:'relative' }}>
      {/* Bell button */}
      <button onClick={() => { setOpen(x => !x); setHasNew(false) }}
        style={{ position:'relative', background:'none', border:'none', cursor:'pointer', padding:'6px', borderRadius:8,
          color: open ? '#F0F3FF' : '#8F94A3', fontSize:18, transition:'color 0.2s' }}>
        🔔
        {hasNew && recent > 0 && (
          <div style={{ position:'absolute', top:2, right:2, width:16, height:16, borderRadius:'50%', background:'#FF3B30',
            fontSize:9, fontWeight:700, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center' }}>
            {recent > 9 ? '9+' : recent}
          </div>
        )}
        {/* Master off indicator */}
        {!prefs.masterEnabled && (
          <div style={{ position:'absolute', bottom:2, right:2, width:8, height:8, borderRadius:'50%', background:'#555C70', border:'1px solid #161B22' }}/>
        )}
      </button>

      {/* Modal overlay — portal into body so it's always on top */}
      {open && createPortal(
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.65)', zIndex:99999,
          display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={()=>setOpen(false)}>
        <div style={{ background:'#161B22', border:'1px solid #2A2F3E', borderRadius:20, width:400, maxHeight:'85vh',
          boxShadow:'0 32px 80px rgba(0,0,0,0.8)', zIndex:100000, display:'flex', flexDirection:'column', overflow:'hidden' }}
          onClick={e=>e.stopPropagation()}>

          {/* Header */}
          <div style={{ padding:'14px 16px 0', borderBottom:'1px solid #1E2330' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
              <div style={{ fontSize:13, fontWeight:700, color:'#F0F3FF' }}>Notifications</div>
              <Toggle value={prefs.masterEnabled} onChange={v => updatePref('masterEnabled', v)}/>
            </div>
            {/* Tabs */}
            <div style={{ display:'flex', gap:4 }}>
              {(['history','settings'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} style={{ flex:1, padding:'7px 0', borderRadius:'8px 8px 0 0',
                  background: tab===t ? '#0D1117' : 'transparent',
                  border:'none', cursor:'pointer', fontSize:11, fontWeight:600,
                  color: tab===t ? '#F0F3FF' : '#555C70', borderBottom: tab===t ? 'none' : undefined }}>
                  {t === 'history' ? `🕐 Historique${recent > 0 ? ` (${recent})` : ''}` : '⚙ Réglages'}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div style={{ overflowY:'auto', flex:1 }}>

            {/* ── HISTORY TAB ── */}
            {tab === 'history' && (
              <div style={{ padding:'8px 0' }}>
                {signals.length === 0 ? (
                  <div style={{ padding:'32px 16px', textAlign:'center', color:'#3D4254', fontSize:12 }}>
                    <div style={{ fontSize:24, marginBottom:8 }}>🔕</div>
                    Aucun signal récent
                  </div>
                ) : signals.slice(0, 20).map(sig => {
                  const urgency = sig.type.includes('SMART') ? 'premium' : sig.type.includes('BUY') || sig.type.includes('SELL') ? 'high' : 'medium'
                  const c = URGENCY_COLOR[urgency]
                  const sigAge = (Date.now() - sig.timestamp.getTime()) < 30*60*1000
                  return (
                    <div key={sig.id} style={{ padding:'10px 16px', display:'flex', gap:10, alignItems:'flex-start',
                      background: sigAge ? 'rgba(255,255,255,0.02)' : 'transparent',
                      borderBottom:'1px solid rgba(255,255,255,0.03)' }}>
                      <div style={{ width:3, borderRadius:2, alignSelf:'stretch', background:c, flexShrink:0, minHeight:32 }}/>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
                          <span style={{ fontSize:11, fontWeight:700, color:c }}>{sig.symbol} · {sig.timeframe}</span>
                          <span style={{ fontSize:10, color:'#3D4254' }}>{timeAgo(sig.timestamp)}</span>
                        </div>
                        <div style={{ fontSize:11, color:'#8F94A3' }}>{sig.message}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* ── SETTINGS TAB ── */}
            {tab === 'settings' && (
              <div style={{ padding:'0 16px 16px' }}>

                {/* Global */}
                <div style={{ marginTop:16, marginBottom:4 }}>
                  <div style={{ fontSize:10, fontWeight:700, color:'#555C70', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>Global</div>
                  <Row label="Toasts visuels" sub="Popup en haut à droite" right={<Toggle value={prefs.toastEnabled} onChange={v=>updatePref('toastEnabled',v)}/>}/>
                  <Row label="Notifications browser" sub={granted ? 'Autorisé ✓' : 'Cliquer pour autoriser'}
                    right={granted
                      ? <Toggle value={prefs.browserEnabled} onChange={v=>updatePref('browserEnabled',v)}/>
                      : <button onClick={requestPerm} style={{fontSize:10,padding:'4px 10px',borderRadius:8,background:'rgba(10,133,255,0.15)',border:'1px solid #0A85FF',color:'#0A85FF',cursor:'pointer',fontWeight:600}}>Autoriser</button>
                    }/>
                  <Row label="Son activé" sub="Synthèse audio" right={<Toggle value={prefs.soundEnabled} onChange={v=>updatePref('soundEnabled',v)}/>}/>
                </div>

                {/* Son + volume */}
                {prefs.soundEnabled && (
                  <div style={{ padding:'10px 12px', background:'rgba(255,255,255,0.02)', borderRadius:10, marginBottom:12, border:'1px solid #1E2330' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                      <span style={{ fontSize:11, color:'#8F94A3' }}>Volume</span>
                      <span style={{ fontSize:11, fontWeight:700, color:'#F0F3FF', fontFamily:'JetBrains Mono, monospace' }}>{prefs.soundVolume}%</span>
                    </div>
                    <input type="range" min={0} max={100} value={prefs.soundVolume}
                      onChange={e=>updatePref('soundVolume',+e.target.value)}
                      style={{width:'100%',accentColor:'#22C759',marginBottom:10}}/>
                    <div style={{ display:'flex', gap:6 }}>
                      {(['ping','chime','premium'] as const).map(t => (
                        <button key={t} onClick={()=>playSound(t,prefs.soundVolume)}
                          style={{flex:1,padding:'5px 0',borderRadius:8,background:'rgba(255,255,255,0.04)',border:'1px solid #2A2F3E',color:'#8F94A3',cursor:'pointer',fontSize:10}}>
                          ▶ {t}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Seuils */}
                <div style={{ padding:'10px 12px', background:'rgba(255,255,255,0.02)', borderRadius:10, marginBottom:12, border:'1px solid #1E2330' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                    <span style={{ fontSize:11, color:'#8F94A3' }}>Score minimum</span>
                    <span style={{ fontSize:11, fontWeight:700, color:'#F0F3FF', fontFamily:'JetBrains Mono, monospace' }}>{prefs.minScore}%</span>
                  </div>
                  <input type="range" min={0} max={100} value={prefs.minScore}
                    onChange={e=>updatePref('minScore',+e.target.value)}
                    style={{width:'100%',accentColor:'#0A85FF',marginBottom:10}}/>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:11, color:'#8F94A3' }}>Cooldown anti-spam</span>
                    <div style={{ display:'flex', gap:4 }}>
                      {[2,5,10,15].map(m=>(
                        <button key={m} onClick={()=>updatePref('cooldownMinutes',m)}
                          style={{padding:'3px 8px',borderRadius:6,fontSize:10,cursor:'pointer',fontWeight:600,
                            background:prefs.cooldownMinutes===m?'rgba(10,133,255,0.2)':'rgba(255,255,255,0.04)',
                            border:`1px solid ${prefs.cooldownMinutes===m?'#0A85FF':'#2A2F3E'}`,
                            color:prefs.cooldownMinutes===m?'#0A85FF':'#555C70'}}>
                          {m}m
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Par signal */}
                <div style={{ fontSize:10, fontWeight:700, color:'#555C70', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>Par signal</div>
                {/* Headers */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 32px 32px 32px', gap:4, marginBottom:6, paddingRight:2 }}>
                  <span/>
                  <span style={{fontSize:8,color:'#3D4254',textAlign:'center',fontWeight:700}}>ON</span>
                  <span style={{fontSize:8,color:'#3D4254',textAlign:'center',fontWeight:700}}>🔔</span>
                  <span style={{fontSize:8,color:'#3D4254',textAlign:'center',fontWeight:700}}>🔊</span>
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
                            <div style={{ fontSize:11, color: sp.enabled ? '#F0F3FF' : '#3D4254', transition:'color 0.2s' }}>{item.label}</div>
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
                    border:'1px solid #2A2F3E',color:'#555C70',cursor:'pointer',fontSize:11}}>
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
