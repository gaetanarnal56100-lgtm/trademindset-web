// src/pages/systemes/SystemesPage.tsx — Connecté à Firestore users/{uid}/systems

import { useState, useEffect } from 'react'
import { subscribeSystems, subscribeTrades, createSystem, updateSystem, deleteSystem, tradePnL, type TradingSystem, type Trade } from '@/services/firestore'

function fmtPnL(n: number) { return `${n>=0?'+':''}$${Math.abs(n).toFixed(2)}` }

export default function SystemesPage() {
  const [systems, setSystems] = useState<TradingSystem[]>([])
  const [trades,  setTrades]  = useState<Trade[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<TradingSystem | null>(null)

  useEffect(() => {
    const unsubS = subscribeSystems(s => { setSystems(s); setLoading(false) })
    const unsubT = subscribeTrades(setTrades)
    return () => { unsubS(); unsubT() }
  }, [])

  // Stats par système
  const systemStats = systems.map(s => {
    const st = trades.filter(t => t.systemId === s.id && t.status === 'closed')
    const pnls = st.map(tradePnL)
    const total = pnls.reduce((a, b) => a + b, 0)
    const wins = pnls.filter(p => p > 0).length
    const wr = st.length > 0 ? (wins / st.length * 100).toFixed(0) : '—'
    return { ...s, totalTrades: st.length, totalPnL: total, winRate: wr }
  })

  return (
    <div style={{ padding:24, maxWidth:800, margin:'0 auto' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:'#F0F3FF', margin:0 }}>Systèmes</h1>
          <p style={{ fontSize:13, color:'#8F94A3', margin:'3px 0 0' }}>{systems.length} système{systems.length > 1 ? 's' : ''} de trading</p>
        </div>
        <button onClick={() => setShowAdd(true)} style={{ padding:'8px 16px', borderRadius:10, border:'none', background:'#00E5FF', color:'#0D1117', fontSize:13, fontWeight:600, cursor:'pointer' }}>
          + Nouveau système
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:48, color:'#555C70' }}>
          <div style={{ width:24, height:24, border:'2px solid #2A2F3E', borderTopColor:'#00E5FF', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto 12px' }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          Chargement...
        </div>
      ) : systems.length === 0 ? (
        <div style={{ textAlign:'center', padding:48, color:'#555C70', fontSize:14 }}>
          Aucun système. Crée ton premier système de trading.
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))', gap:12 }}>
          {systemStats.map(s => (
            <div key={s.id} style={{ background:'#161B22', border:`1px solid ${s.color}40`, borderRadius:14, padding:'16px', position:'relative', overflow:'hidden' }}>
              <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:s.color, borderRadius:'14px 14px 0 0' }} />
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ width:36, height:36, borderRadius:10, background:`${s.color}20`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16 }}>📊</div>
                  <div>
                    <div style={{ fontSize:15, fontWeight:700, color:'#F0F3FF' }}>{s.name}</div>
                    <div style={{ fontSize:10, color:'#555C70' }}>{s.totalTrades} trades</div>
                  </div>
                </div>
                <div style={{ display:'flex', gap:6 }}>
                  <button onClick={() => setEditing(s)} style={{ background:'none', border:'1px solid #2A2F3E', borderRadius:6, padding:'3px 8px', color:'#8F94A3', cursor:'pointer', fontSize:11 }}>✏️</button>
                  <button onClick={() => { if(confirm(`Supprimer "${s.name}" ?`)) deleteSystem(s.id) }} style={{ background:'none', border:'1px solid #2A2F3E', borderRadius:6, padding:'3px 8px', color:'#555C70', cursor:'pointer', fontSize:11 }}>✕</button>
                </div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
                {[
                  { l:'P&L Total', v:fmtPnL(s.totalPnL), c: s.totalPnL>=0?'#22C759':'#FF3B30' },
                  { l:'Win Rate', v:`${s.winRate}%`, c:'#F0F3FF' },
                  { l:'Trades', v:s.totalTrades, c:'#8F94A3' },
                ].map(({ l, v, c }) => (
                  <div key={l} style={{ background:'#1C2130', borderRadius:8, padding:'8px', textAlign:'center' }}>
                    <div style={{ fontSize:9, color:'#555C70', marginBottom:2 }}>{l}</div>
                    <div style={{ fontSize:13, fontWeight:700, color:c, fontFamily:'monospace' }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {(showAdd || editing) && (
        <SystemModal
          system={editing}
          onSave={async (name, color) => {
            if (editing) {
              await updateSystem({ ...editing, name, color })
              setEditing(null)
            } else {
              await createSystem({ id: crypto.randomUUID(), name, color })
              setShowAdd(false)
            }
          }}
          onClose={() => { setShowAdd(false); setEditing(null) }}
        />
      )}
    </div>
  )
}

function SystemModal({ system, onSave, onClose }: { system: TradingSystem | null; onSave: (n: string, c: string) => Promise<void>; onClose: () => void }) {
  const [name, setName]   = useState(system?.name ?? '')
  const [color, setColor] = useState(system?.color ?? '#00E5FF')
  const [saving, setSaving] = useState(false)
  const COLORS = ['#00E5FF','#22C759','#FF9500','#FF3B30','#9B59B6','#E91E63','#4CAF50','#2196F3','#FF6B35','#FFD700']

  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    try { await onSave(name.trim(), color) } catch(e) { alert((e as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
      <div style={{ background:'#161B22', border:'1px solid #2A2F3E', borderRadius:16, padding:24, width:380, maxWidth:'95vw' }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:18 }}>
          <span style={{ fontSize:16, fontWeight:700, color:'#F0F3FF' }}>{system ? 'Modifier' : 'Nouveau'} système</span>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#555C70', cursor:'pointer', fontSize:18 }}>✕</button>
        </div>
        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:10, color:'#555C70', marginBottom:6 }}>NOM DU SYSTÈME</div>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Breakout BTC" autoFocus
            style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:'1px solid #2A2F3E', background:'#1C2130', color:'#F0F3FF', fontSize:14, outline:'none', boxSizing:'border-box' }} />
        </div>
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:10, color:'#555C70', marginBottom:8 }}>COULEUR</div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)} style={{ width:30, height:30, borderRadius:8, background:c, border: color===c?`3px solid white`:'3px solid transparent', cursor:'pointer' }} />
            ))}
          </div>
        </div>
        <button onClick={save} disabled={!name.trim() || saving}
          style={{ width:'100%', padding:10, borderRadius:10, border:'none', background: name.trim()?color:'#1C2130', color: name.trim()?'#0D1117':'#555C70', fontSize:14, fontWeight:600, cursor: name.trim()?'pointer':'not-allowed' }}>
          {saving ? 'Enregistrement...' : system ? 'Mettre à jour' : 'Créer le système'}
        </button>
      </div>
    </div>
  )
}
