// AlertesPage.tsx — Alertes WaveTrend / VMC / MTF connectées au SignalNotificationService
import { useState, useEffect } from 'react'
import { signalService, type TradingSignal, type SignalType } from '@/services/notifications/SignalNotificationService'

const SIGNAL_META: Record<SignalType, { icon: string; label: string; color: string; bg: string; desc: string }> = {
  WT_SMART_BULL:  { icon:'⭐', label:'WT Smart Bull',  color:'var(--tm-accent)', bg:'rgba(var(--tm-accent-rgb,0,229,255),0.12)',  desc:'Croisement WT1/WT2 en zone de survente extrême — signal premium de retournement haussier.' },
  WT_SMART_BEAR:  { icon:'⭐', label:'WT Smart Bear',  color:'var(--tm-loss)', bg:'rgba(var(--tm-loss-rgb,255,59,48),0.12)',  desc:'Croisement WT1/WT2 en zone de surachat extrême — signal premium de retournement baissier.' },
  WT_BULL:        { icon:'📈', label:'WT Bullish',      color:'var(--tm-profit)', bg:'rgba(var(--tm-profit-rgb,34,199,89),0.10)',  desc:'Croisement haussier WaveTrend (WT1 passe au-dessus de WT2).' },
  WT_BEAR:        { icon:'📉', label:'WT Bearish',      color:'var(--tm-loss)', bg:'rgba(var(--tm-loss-rgb,255,59,48),0.10)',  desc:'Croisement baissier WaveTrend (WT1 passe en dessous de WT2).' },
  VMC_BUY:        { icon:'🟢', label:'VMC BUY',         color:'var(--tm-profit)', bg:'rgba(var(--tm-profit-rgb,34,199,89),0.12)',  desc:'Le VMC Oscillator confirme un signal d\'achat — croisement haussier confirmé par le ribbon et le momentum.' },
  VMC_SELL:       { icon:'🔴', label:'VMC SELL',         color:'var(--tm-loss)', bg:'rgba(var(--tm-loss-rgb,255,59,48),0.12)',  desc:'Le VMC Oscillator confirme un signal de vente — croisement baissier confirmé par le ribbon et le momentum.' },
  VMC_COMPRESSION:{ icon:'🔄', label:'VMC Compression', color:'var(--tm-warning)', bg:'rgba(var(--tm-warning-rgb,255,149,0),0.12)',  desc:'Les EMAs du ribbon se compriment — breakout potentiel imminent. Surveiller la direction du prochain mouvement.' },
  MTF_BUY:        { icon:'🎯', label:'MTF BUY',         color:'var(--tm-profit)', bg:'rgba(var(--tm-profit-rgb,34,199,89),0.12)',  desc:'Signal d\'achat multi-timeframe avec forte confluence (>70%). RSI + VMC alignés sur plusieurs TFs.' },
  MTF_SELL:       { icon:'🎯', label:'MTF SELL',         color:'var(--tm-loss)', bg:'rgba(var(--tm-loss-rgb,255,59,48),0.12)',  desc:'Signal de vente multi-timeframe avec forte confluence (>70%). RSI + VMC alignés sur plusieurs TFs.' },
  MTF_CONFLUENCE: { icon:'🔗', label:'MTF Confluence',   color:'var(--tm-purple)', bg:'rgba(var(--tm-purple-rgb,191,90,242),0.12)', desc:'Confluence élevée sur le dashboard MTF — la majorité des timeframes pointent dans la même direction.' },
}

const URGENCY_BADGE: Record<string, { label: string; color: string }> = {
  premium: { label: 'PREMIUM', color: '#FFD700' },
  high:    { label: 'HIGH',    color: 'var(--tm-loss)' },
  medium:  { label: 'MEDIUM',  color: 'var(--tm-warning)' },
  low:     { label: 'LOW',     color: 'var(--tm-text-secondary)' },
}

type FilterType = 'all' | 'wt' | 'vmc' | 'mtf'

function timeAgo(d: Date): string {
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'à l\'instant'
  if (diff < 3600_000) return `il y a ${Math.floor(diff/60_000)}m`
  if (diff < 86400_000) return `il y a ${Math.floor(diff/3600_000)}h`
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
}

function SignalCard({ signal, expanded, onToggle }: { signal: TradingSignal; expanded: boolean; onToggle: () => void }) {
  const meta = SIGNAL_META[signal.type]
  const urg = URGENCY_BADGE[signal.urgency]
  if (!meta) return null
  return (
    <div onClick={onToggle} style={{
      background: expanded ? meta.bg : 'var(--tm-bg-secondary)',
      border: `1px solid ${expanded ? meta.color + '40' : 'var(--tm-border-sub)'}`,
      borderRadius: 14, padding: '14px 18px', cursor: 'pointer',
      transition: 'all 0.2s',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ width:40, height:40, borderRadius:12, background: meta.bg, border: `1px solid ${meta.color}30`,
          display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, flexShrink:0 }}>
          {meta.icon}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3, flexWrap:'wrap' }}>
            <span style={{ fontSize:13, fontWeight:700, color: meta.color }}>{meta.label}</span>
            <span style={{ fontSize:10, fontWeight:700, color: urg.color, background: `${urg.color}18`, padding:'1px 8px', borderRadius:10, border:`1px solid ${urg.color}40` }}>{urg.label}</span>
            <span style={{ fontSize:10, color:'var(--tm-text-muted)', marginLeft:'auto', fontFamily:'JetBrains Mono,monospace' }}>{timeAgo(signal.timestamp)}</span>
          </div>
          <div style={{ fontSize:12, color:'#C5C8D6', marginBottom:2 }}>{signal.message}</div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <span style={{ fontSize:11, fontWeight:600, color:'#F59714', fontFamily:'JetBrains Mono,monospace' }}>{signal.symbol}</span>
            <span style={{ fontSize:10, color:'var(--tm-text-muted)' }}>·</span>
            <span style={{ fontSize:10, color:'var(--tm-text-secondary)' }}>{signal.timeframe}</span>
            {signal.detail && <span style={{ fontSize:10, color:'var(--tm-text-muted)' }}>· {signal.detail}</span>}
          </div>
        </div>
        <div style={{ fontSize:14, color:'var(--tm-text-muted)', transform: expanded ? 'rotate(180deg)' : 'none', transition:'transform 0.2s' }}>▼</div>
      </div>
      {expanded && (
        <div style={{ marginTop:12, paddingTop:12, borderTop:`1px solid ${meta.color}20` }}>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--tm-text-secondary)', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.08em' }}>Explication du signal</div>
          <div style={{ fontSize:12, color:'#C5C8D6', lineHeight:1.7 }}>{meta.desc}</div>
          {signal.detail && (
            <div style={{ marginTop:8, padding:'8px 12px', background:'rgba(0,0,0,0.25)', borderRadius:8, fontFamily:'JetBrains Mono,monospace', fontSize:11, color:'var(--tm-text-secondary)' }}>
              {signal.detail}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function AlertesPage() {
  const [signals, setSignals] = useState<TradingSignal[]>(signalService.getHistory())
  const [filter, setFilter] = useState<FilterType>('all')
  const [expandedId, setExpandedId] = useState<string|null>(null)

  useEffect(() => {
    const unsub = signalService.subscribe(() => {
      setSignals([...signalService.getHistory()])
    })
    return unsub
  }, [])

  // Request notification permission
  useEffect(() => {
    if (!signalService.isGranted) signalService.requestPermission()
  }, [])

  const filtered = signals.filter(s => {
    if (filter === 'wt') return s.type.startsWith('WT_')
    if (filter === 'vmc') return s.type.startsWith('VMC_')
    if (filter === 'mtf') return s.type.startsWith('MTF_')
    return true
  })

  const wtCount  = signals.filter(s => s.type.startsWith('WT_')).length
  const vmcCount = signals.filter(s => s.type.startsWith('VMC_')).length
  const mtfCount = signals.filter(s => s.type.startsWith('MTF_')).length
  const premiumCount = signals.filter(s => s.urgency === 'premium').length

  return (
    <div style={{ minHeight:'100vh', background:'var(--tm-bg)', padding:'32px 24px', maxWidth:900, margin:'0 auto' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:0.4}50%{opacity:0.8}}@keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}`}</style>

      {/* Header */}
      <div style={{ marginBottom:24 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:6 }}>
          <div style={{ width:40, height:40, borderRadius:12, background:'linear-gradient(135deg,rgba(var(--tm-warning-rgb,255,149,0),0.2),rgba(var(--tm-loss-rgb,255,59,48),0.2))', border:'1px solid rgba(var(--tm-warning-rgb,255,149,0),0.3)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20 }}>🔔</div>
          <div>
            <h1 style={{ fontSize:22, fontWeight:700, color:'var(--tm-text-primary)', margin:0, fontFamily:'Syne,sans-serif' }}>Alertes & Signaux</h1>
            <p style={{ fontSize:12, color:'var(--tm-text-muted)', margin:0 }}>WaveTrend · VMC · MTF Dashboard · En temps réel</p>
          </div>
          {premiumCount > 0 && (
            <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6, padding:'4px 12px', background:'rgba(255,215,0,0.1)', border:'1px solid rgba(255,215,0,0.3)', borderRadius:20 }}>
              <span style={{ fontSize:12 }}>⭐</span>
              <span style={{ fontSize:11, fontWeight:700, color:'#FFD700' }}>{premiumCount} premium</span>
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:20 }}>
        {[
          { label:'Total', value:signals.length, color:'var(--tm-text-primary)', bg:'rgba(255,255,255,0.03)' },
          { label:'WaveTrend', value:wtCount, color:'#37D7FF', bg:'rgba(55,215,255,0.06)' },
          { label:'VMC', value:vmcCount, color:'var(--tm-warning)', bg:'rgba(var(--tm-warning-rgb,255,149,0),0.06)' },
          { label:'MTF', value:mtfCount, color:'var(--tm-purple)', bg:'rgba(var(--tm-purple-rgb,191,90,242),0.06)' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} style={{ background:bg, border:'1px solid #1E2330', borderRadius:12, padding:'12px 14px', textAlign:'center' }}>
            <div style={{ fontSize:22, fontWeight:800, color, fontFamily:'JetBrains Mono,monospace' }}>{value}</div>
            <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginTop:2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Notification permission */}
      {!signalService.isGranted && (
        <div style={{ padding:'14px 20px', background:'rgba(var(--tm-accent-rgb,0,229,255),0.06)', border:'1px solid rgba(var(--tm-accent-rgb,0,229,255),0.2)', borderRadius:12, marginBottom:16, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:12, fontWeight:600, color:'var(--tm-accent)' }}>Activer les notifications</div>
            <div style={{ fontSize:11, color:'var(--tm-text-muted)' }}>Recevez les alertes même quand l'onglet est en arrière-plan</div>
          </div>
          <button onClick={() => signalService.requestPermission()} style={{ padding:'7px 16px', borderRadius:8, border:'1px solid rgba(var(--tm-accent-rgb,0,229,255),0.3)', background:'rgba(var(--tm-accent-rgb,0,229,255),0.15)', color:'var(--tm-accent)', fontSize:11, fontWeight:600, cursor:'pointer' }}>
            Activer
          </button>
        </div>
      )}

      {/* Filters */}
      <div style={{ display:'flex', gap:8, marginBottom:20, flexWrap:'wrap', alignItems:'center' }}>
        {([
          { id:'all' as FilterType, label:'Toutes', count:signals.length },
          { id:'wt' as FilterType,  label:'WaveTrend', count:wtCount },
          { id:'vmc' as FilterType, label:'VMC', count:vmcCount },
          { id:'mtf' as FilterType, label:'MTF', count:mtfCount },
        ]).map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            display:'flex', alignItems:'center', gap:6, padding:'7px 16px', borderRadius:20,
            fontSize:12, fontWeight:600, cursor:'pointer',
            border:`1px solid ${filter===f.id ? 'var(--tm-warning)' : 'var(--tm-border)'}`,
            background: filter===f.id ? 'rgba(var(--tm-warning-rgb,255,149,0),0.15)' : 'transparent',
            color: filter===f.id ? 'var(--tm-warning)' : 'var(--tm-text-muted)',
          }}>
            {f.label}
            <span style={{ fontSize:10, fontWeight:700, background:'var(--tm-border)', padding:'1px 6px', borderRadius:10, color: filter===f.id ? 'var(--tm-warning)' : 'var(--tm-text-muted)' }}>{f.count}</span>
          </button>
        ))}
        {signals.length > 0 && (
          <button onClick={() => { signalService.clearHistory(); setSignals([]) }} style={{
            marginLeft:'auto', padding:'7px 14px', borderRadius:20, fontSize:11,
            background:'rgba(var(--tm-loss-rgb,255,59,48),0.08)', border:'1px solid rgba(var(--tm-loss-rgb,255,59,48),0.2)', color:'var(--tm-loss)', cursor:'pointer',
          }}>
            🗑 Vider
          </button>
        )}
      </div>

      {/* Signal list */}
      {filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px 20px', color:'var(--tm-text-muted)' }}>
          <div style={{ fontSize:48, marginBottom:16 }}>🔕</div>
          <div style={{ fontSize:16, fontWeight:600, color:'var(--tm-text-secondary)', marginBottom:8 }}>Aucune alerte</div>
          <div style={{ fontSize:13, maxWidth:400, margin:'0 auto', lineHeight:1.6 }}>
            Les alertes apparaissent automatiquement quand les oscillateurs WaveTrend et VMC détectent des signaux de trading sur la page Analyse.
          </div>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {filtered.map(s => (
            <div key={s.id} style={{ animation:'fadeIn 0.2s ease-out' }}>
              <SignalCard signal={s} expanded={expandedId === s.id} onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)} />
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      <div style={{ marginTop:24, padding:'16px 20px', background:'var(--tm-bg-secondary)', border:'1px solid #1E2330', borderRadius:12 }}>
        <div style={{ fontSize:11, fontWeight:700, color:'var(--tm-text-muted)', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.08em' }}>Types de signaux</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
          {[
            { icon:'⭐', label:'Smart Reversal', desc:'Zone extrême + croisement', color:'#FFD700' },
            { icon:'📈', label:'WT Crossover', desc:'Croisement WT1/WT2', color:'var(--tm-profit)' },
            { icon:'🟢', label:'VMC Buy/Sell', desc:'Confirmation multi-indicateur', color:'var(--tm-profit)' },
            { icon:'🔄', label:'Compression', desc:'EMAs serrées → breakout', color:'var(--tm-warning)' },
            { icon:'🎯', label:'MTF Signal', desc:'Confluence multi-timeframe', color:'var(--tm-purple)' },
            { icon:'🔗', label:'Confluence', desc:'>70% TFs alignés', color:'var(--tm-accent)' },
          ].map(({ icon, label, desc, color }) => (
            <div key={label} style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:14 }}>{icon}</span>
              <div>
                <div style={{ fontSize:11, fontWeight:600, color }}>{label}</div>
                <div style={{ fontSize:10, color:'var(--tm-text-muted)' }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
