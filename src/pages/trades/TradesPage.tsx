// src/pages/trades/TradesPage.tsx

import { useState, useEffect } from 'react'
import { useAppStore } from '@/store/appStore'
import {
  subscribeTrades, subscribeSystems, createTrade, deleteTrade,
  tradePnL, type Trade, type TradingSystem
} from '@/services/firestore'

function fmtDate(d: Date) {
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })
}
function fmtPrice(p?: number) {
  if (p == null) return '—'
  return p >= 1000 ? `$${p.toLocaleString('fr-FR', {maximumFractionDigits:1})}` : `$${p.toFixed(4)}`
}
function fmtPnL(n: number) {
  return `${n >= 0 ? '+' : ''}$${Math.abs(n).toFixed(2)}`
}

export default function TradesPage() {
  const user = useAppStore(s => s.user)
  const [trades,  setTrades]  = useState<Trade[]>([])
  const [systems, setSystems] = useState<TradingSystem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState<'all'|'open'|'closed'>('all')
  const [search,  setSearch]  = useState('')
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => {
    if (!user) return
    const unsubT = subscribeTrades(t => { setTrades(t); setLoading(false) })
    const unsubS = subscribeSystems(setSystems)
    return () => { unsubT(); unsubS() }
  }, [user])

  const filtered = trades
    .filter(t => filter === 'all' || t.status === filter)
    .filter(t => !search || t.symbol.toLowerCase().includes(search.toLowerCase()))

  const closed = filtered.filter(t => t.status === 'closed')
  const totalPnL = closed.reduce((s, t) => s + tradePnL(t), 0)
  const pnls = closed.map(tradePnL)
  const wins     = pnls.filter(p => p > 0).length
  const losses   = pnls.filter(p => p <= 0).length
  const wr       = wins + losses > 0 ? (wins / (wins + losses) * 100).toFixed(1) : '—'
  const avgWin   = wins > 0 ? pnls.filter(p => p > 0).reduce((a, b) => a + b, 0) / wins : 0
  const avgLoss  = losses > 0 ? Math.abs(pnls.filter(p => p <= 0).reduce((a, b) => a + b, 0)) / losses : 0
  const payoff   = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : '—'
  const bestTrade = pnls.length ? Math.max(...pnls) : 0
  const worstTrade = pnls.length ? Math.min(...pnls) : 0
  const expectancy = pnls.length ? (pnls.reduce((a,b)=>a+b,0) / pnls.length) : 0
  // Profit factor
  const grossProfit = pnls.filter(p=>p>0).reduce((a,b)=>a+b,0)
  const grossLoss = Math.abs(pnls.filter(p=>p<=0).reduce((a,b)=>a+b,0))
  const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? '∞' : '—'
  // Streaks
  let curStreak=0, bestStreak=0, worstStreak=0
  for(const p of pnls){if(p>0){curStreak=curStreak>0?curStreak+1:1}else{curStreak=curStreak<0?curStreak-1:-1};if(curStreak>bestStreak)bestStreak=curStreak;if(curStreak<worstStreak)worstStreak=curStreak}
  // By symbol
  const bySymbol = new Map<string,{count:number;pnl:number;wins:number}>()
  for(const t of closed){const s=t.symbol;const p=tradePnL(t);const e=bySymbol.get(s)||{count:0,pnl:0,wins:0};e.count++;e.pnl+=p;if(p>0)e.wins++;bySymbol.set(s,e)}
  const topSymbols = [...bySymbol.entries()].sort((a,b)=>b[1].pnl-a[1].pnl).slice(0,5)

  const [showStats, setShowStats] = useState(false)

  const systemName  = (id: string) => systems.find(s => s.id === id)?.name  ?? '—'
  const systemColor = (id: string) => systems.find(s => s.id === id)?.color ?? '#00E5FF'

  return (
    <div style={{ padding:24, maxWidth:1100, margin:'0 auto' }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:'#F0F3FF', margin:0 }}>Trades</h1>
          <p style={{ fontSize:13, color:'#8F94A3', margin:'3px 0 0' }}>
            {loading ? 'Connexion à Firestore...' : `${filtered.length} trade${filtered.length > 1?'s':''}`}
          </p>
        </div>
        <button onClick={() => setShowAdd(true)} style={{ padding:'8px 16px', borderRadius:10, border:'none', background:'#00E5FF', color:'#0D1117', fontSize:13, fontWeight:600, cursor:'pointer' }}>
          + Nouveau trade
        </button>
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:12 }}>
        {[
          { l:'P&L Total',  v:fmtPnL(totalPnL), c: totalPnL >= 0 ? '#22C759' : '#FF3B30' },
          { l:'Win Rate',   v:`${wr}%`,          c:'#F0F3FF' },
          { l:'Gains',      v:wins,              c:'#22C759' },
          { l:'Pertes',     v:losses,            c:'#FF3B30' },
        ].map(({ l, v, c }) => (
          <div key={l} style={{ background:'#161B22', border:'1px solid #2A2F3E', borderRadius:10, padding:'12px 14px' }}>
            <div style={{ fontSize:10, color:'#555C70', marginBottom:4 }}>{l}</div>
            <div style={{ fontSize:18, fontWeight:700, color:c, fontFamily:'monospace' }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Toggle advanced stats */}
      <button onClick={() => setShowStats(x => !x)} style={{ width:'100%', padding:'8px', marginBottom:14, borderRadius:10, border:'1px solid #2A2F3E', background:showStats?'rgba(10,133,255,0.06)':'#161B22', color:showStats?'#0A85FF':'#555C70', fontSize:12, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
        {showStats ? '▲ Masquer les statistiques avancées' : '▼ Statistiques avancées'}
      </button>

      {showStats && (
        <div style={{ marginBottom:16, animation:'fadeIn 0.2s ease-out' }}>
          <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}`}</style>
          {/* Row 2: Advanced metrics */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:10 }}>
            {[
              { l:'Payoff Ratio',   v:payoff,                    c:'#00E5FF' },
              { l:'Profit Factor',  v:profitFactor,              c: Number(profitFactor) >= 1.5 ? '#22C759' : '#FF9500' },
              { l:'Expectancy',     v:fmtPnL(expectancy),        c: expectancy >= 0 ? '#22C759' : '#FF3B30' },
              { l:'Trades fermés',  v:closed.length,             c:'#8F94A3' },
            ].map(({ l, v, c }) => (
              <div key={l} style={{ background:'#161B22', border:'1px solid #2A2F3E', borderRadius:10, padding:'12px 14px' }}>
                <div style={{ fontSize:10, color:'#555C70', marginBottom:4 }}>{l}</div>
                <div style={{ fontSize:16, fontWeight:700, color:c, fontFamily:'monospace' }}>{v}</div>
              </div>
            ))}
          </div>
          {/* Row 3: Gains/losses details */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:10 }}>
            {[
              { l:'Moy. gain',       v:fmtPnL(avgWin),            c:'#22C759' },
              { l:'Moy. perte',      v:fmtPnL(-avgLoss),          c:'#FF3B30' },
              { l:'Meilleur trade',  v:fmtPnL(bestTrade),         c:'#22C759' },
              { l:'Pire trade',      v:fmtPnL(worstTrade),        c:'#FF3B30' },
            ].map(({ l, v, c }) => (
              <div key={l} style={{ background:'#161B22', border:'1px solid #2A2F3E', borderRadius:10, padding:'12px 14px' }}>
                <div style={{ fontSize:10, color:'#555C70', marginBottom:4 }}>{l}</div>
                <div style={{ fontSize:16, fontWeight:700, color:c, fontFamily:'monospace' }}>{v}</div>
              </div>
            ))}
          </div>
          {/* Row 4: Streaks + top symbols */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            {/* Streaks */}
            <div style={{ background:'#161B22', border:'1px solid #2A2F3E', borderRadius:10, padding:'14px 16px' }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#F0F3FF', marginBottom:10 }}>Séries</div>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {[
                  { l:'Meilleure série', v:`${bestStreak} wins`, c:'#22C759' },
                  { l:'Pire série',      v:`${Math.abs(worstStreak)} losses`, c:'#FF3B30' },
                  { l:'Profit brut',     v:fmtPnL(grossProfit), c:'#22C759' },
                  { l:'Perte brute',     v:fmtPnL(-grossLoss), c:'#FF3B30' },
                ].map(({ l, v, c }) => (
                  <div key={l} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:11, color:'#8F94A3' }}>{l}</span>
                    <span style={{ fontSize:12, fontWeight:700, color:c, fontFamily:'monospace' }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Top symbols */}
            <div style={{ background:'#161B22', border:'1px solid #2A2F3E', borderRadius:10, padding:'14px 16px' }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#F0F3FF', marginBottom:10 }}>Top Symboles</div>
              {topSymbols.length === 0 ? (
                <div style={{ fontSize:11, color:'#3D4254' }}>Pas de données</div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {topSymbols.map(([sym, data]) => (
                    <div key={sym} style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontSize:12, fontWeight:700, color:'#F0F3FF', minWidth:80, fontFamily:'monospace' }}>{sym}</span>
                      <div style={{ flex:1, height:6, background:'#1C2130', borderRadius:3, overflow:'hidden' }}>
                        <div style={{ width:`${Math.min(100, data.wins/Math.max(data.count,1)*100)}%`, height:'100%', background:'#22C759', borderRadius:3 }} />
                      </div>
                      <span style={{ fontSize:11, fontWeight:600, color:data.pnl>=0?'#22C759':'#FF3B30', fontFamily:'monospace', minWidth:70, textAlign:'right' }}>{fmtPnL(data.pnl)}</span>
                      <span style={{ fontSize:9, color:'#555C70' }}>{data.count}t</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
        <div style={{ display:'flex', background:'#161B22', borderRadius:8, padding:3, gap:2 }}>
          {(['all','open','closed'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ padding:'5px 12px', borderRadius:6, border:'none', cursor:'pointer', fontSize:12, fontWeight:500, background: filter===f?'#00E5FF':'transparent', color: filter===f?'#0D1117':'#8F94A3' }}>
              {f==='all'?'Tous':f==='open'?'Ouverts':'Fermés'}
            </button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Symbole..." style={{ flex:1, minWidth:180, padding:'6px 12px', borderRadius:8, border:'1px solid #2A2F3E', background:'#161B22', color:'#F0F3FF', fontSize:13, outline:'none' }} />
      </div>

      {/* List */}
      {loading ? (
        <div style={{ textAlign:'center', padding:48, color:'#555C70' }}>
          <div style={{ width:24, height:24, border:'2px solid #2A2F3E', borderTopColor:'#00E5FF', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto 12px' }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          Chargement depuis Firestore...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:48, color:'#555C70', fontSize:14 }}>
          Aucun trade{filter !== 'all' ? ` ${filter==='open'?'ouvert':'fermé'}` : ''}
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {filtered.map(trade => {
            const pnl = tradePnL(trade)
            const pnlColor = pnl >= 0 ? '#22C759' : '#FF3B30'
            const isOpen = trade.status === 'open'
            return (
              <div key={trade.id} style={{ background:'#161B22', border:'1px solid #2A2F3E', borderRadius:12, padding:'12px 14px', display:'grid', gridTemplateColumns:'auto 1fr auto auto auto', alignItems:'center', gap:14 }}>
                <div style={{ width:36, height:36, borderRadius:8, background: trade.type==='Long'?'rgba(34,199,89,0.15)':'rgba(255,59,48,0.15)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, flexShrink:0 }}>
                  {trade.type==='Long'?'📈':'📉'}
                </div>
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3, flexWrap:'wrap' }}>
                    <span style={{ fontSize:14, fontWeight:700, color:'#F0F3FF' }}>{trade.symbol}</span>
                    <span style={{ fontSize:10, fontWeight:600, color: trade.type==='Long'?'#22C759':'#FF3B30', background: trade.type==='Long'?'rgba(34,199,89,0.1)':'rgba(255,59,48,0.1)', padding:'1px 6px', borderRadius:4 }}>{trade.type}</span>
                    {isOpen && <span style={{ fontSize:9, fontWeight:700, color:'#00E5FF', background:'rgba(0,229,255,0.1)', padding:'1px 6px', borderRadius:4 }}>● OUVERT</span>}
                    <span style={{ fontSize:10, color:systemColor(trade.systemId), background:`${systemColor(trade.systemId)}18`, padding:'1px 6px', borderRadius:4 }}>{systemName(trade.systemId)}</span>
                  </div>
                  <div style={{ fontSize:11, color:'#555C70' }}>
                    {fmtDate(trade.date)} · {trade.leverage}x · {trade.orderRole} · {trade.session}
                    {trade.entryPrice && ` · E: ${fmtPrice(trade.entryPrice)}`}
                    {trade.exitPrice  && ` → S: ${fmtPrice(trade.exitPrice)}`}
                  </div>
                </div>
                {trade.quantity && (
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:10, color:'#555C70' }}>Qté</div>
                    <div style={{ fontSize:12, color:'#8F94A3', fontFamily:'monospace' }}>{trade.quantity.toFixed(4)}</div>
                  </div>
                )}
                <div style={{ textAlign:'right', minWidth:80 }}>
                  <div style={{ fontSize:10, color:'#555C70' }}>{isOpen?'Non réalisé':'P&L'}</div>
                  <div style={{ fontSize:14, fontWeight:700, color:pnlColor, fontFamily:'monospace' }}>{fmtPnL(pnl)}</div>
                </div>
                <button onClick={() => { if(confirm('Supprimer ?')) deleteTrade(trade.id) }} style={{ width:28, height:28, borderRadius:6, border:'1px solid #2A2F3E', background:'none', cursor:'pointer', color:'#555C70', fontSize:12 }}>✕</button>
              </div>
            )
          })}
        </div>
      )}

      {showAdd && <AddTradeModal systems={systems} onClose={() => setShowAdd(false)} />}
    </div>
  )
}

function AddTradeModal({ systems, onClose }: { systems: TradingSystem[]; onClose: () => void }) {
  const [form, setForm] = useState({
    symbol:'', type:'Long' as 'Long'|'Short', entryPrice:'', exitPrice:'',
    quantity:'', leverage:'1', session:'US' as 'US'|'Asia'|'Europe',
    orderRole:'Taker' as 'Maker'|'Taker', systemId: systems[0]?.id ?? '',
    status:'closed' as 'open'|'closed', notes:'', flashPnLNet:'',
  })
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!form.symbol || !form.systemId) return
    setSaving(true)
    try {
      await createTrade({
        id: crypto.randomUUID(), date: new Date(),
        symbol: form.symbol.toUpperCase(), type: form.type,
        entryPrice:  form.entryPrice  ? parseFloat(form.entryPrice)  : undefined,
        exitPrice:   form.exitPrice   ? parseFloat(form.exitPrice)   : undefined,
        quantity:    form.quantity    ? parseFloat(form.quantity)    : undefined,
        leverage:    parseFloat(form.leverage) || 1,
        exchangeId:  crypto.randomUUID(), orderRole: form.orderRole,
        systemId: form.systemId, session: form.session,
        flashPnLNet: form.flashPnLNet ? parseFloat(form.flashPnLNet) : undefined,
        notes: form.notes || undefined, tags: [], status: form.status,
      })
      onClose()
    } catch(e) { alert((e as Error).message) }
    finally { setSaving(false) }
  }

  const inp = { background:'#1C2130', border:'1px solid #2A2F3E', borderRadius:8, padding:'8px 10px', color:'#F0F3FF', fontSize:13, outline:'none', width:'100%', boxSizing:'border-box' as const }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
      <div style={{ background:'#161B22', border:'1px solid #2A2F3E', borderRadius:16, padding:24, width:480, maxWidth:'95vw', maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:18 }}>
          <span style={{ fontSize:16, fontWeight:700, color:'#F0F3FF' }}>Nouveau Trade</span>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#555C70', cursor:'pointer', fontSize:18 }}>✕</button>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          {[
            { label:'Symbole', key:'symbol', placeholder:'BTCUSDT' },
            { label:'Prix entrée', key:'entryPrice', placeholder:'71000' },
            { label:'Prix sortie', key:'exitPrice', placeholder:'72000' },
            { label:'Quantité', key:'quantity', placeholder:'0.01' },
            { label:'Levier', key:'leverage', placeholder:'1' },
            { label:'P&L net (optionnel)', key:'flashPnLNet', placeholder:'150.00' },
          ].map(({ label, key, placeholder }) => (
            <div key={key}>
              <div style={{ fontSize:10, color:'#555C70', marginBottom:4 }}>{label}</div>
              <input value={(form as Record<string,string>)[key]} onChange={e => setForm(p => ({...p,[key]:e.target.value}))} placeholder={placeholder} style={inp} />
            </div>
          ))}
          {[
            { label:'Direction', key:'type', options:['Long','Short'] },
            { label:'Statut', key:'status', options:['closed','open'] },
            { label:'Session', key:'session', options:['US','Asia','Europe'] },
            { label:'Rôle', key:'orderRole', options:['Taker','Maker'] },
          ].map(({ label, key, options }) => (
            <div key={key}>
              <div style={{ fontSize:10, color:'#555C70', marginBottom:4 }}>{label}</div>
              <select value={(form as Record<string,string>)[key]} onChange={e => setForm(p => ({...p,[key]:e.target.value}))} style={{...inp,cursor:'pointer'}}>
                {options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          ))}
          {systems.length > 0 && (
            <div style={{ gridColumn:'span 2' }}>
              <div style={{ fontSize:10, color:'#555C70', marginBottom:4 }}>Système</div>
              <select value={form.systemId} onChange={e => setForm(p => ({...p,systemId:e.target.value}))} style={{...inp,cursor:'pointer'}}>
                {systems.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div style={{ gridColumn:'span 2' }}>
            <div style={{ fontSize:10, color:'#555C70', marginBottom:4 }}>Notes</div>
            <textarea value={form.notes} onChange={e => setForm(p => ({...p,notes:e.target.value}))} placeholder="Notes..." rows={2} style={{...inp,resize:'vertical'}} />
          </div>
        </div>
        <button onClick={save} disabled={saving || !form.symbol} style={{ width:'100%', marginTop:16, padding:10, borderRadius:10, border:'none', background:form.symbol?'#00E5FF':'#1C2130', color:form.symbol?'#0D1117':'#555C70', fontSize:14, fontWeight:600, cursor:form.symbol?'pointer':'not-allowed' }}>
          {saving ? 'Enregistrement...' : 'Créer le trade'}
        </button>
      </div>
    </div>
  )
}
