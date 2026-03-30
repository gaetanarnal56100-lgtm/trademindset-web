// src/pages/trades/TradesPage.tsx

import { useState, useEffect } from 'react'
import { useAppStore } from '@/store/appStore'
import {
  subscribeTrades, subscribeSystems, subscribeExchanges, createTrade, deleteTrade, updateTrade,
  tradePnL, type Trade, type TradingSystem, type Exchange
} from '@/services/firestore'
import { TradeDetailModal } from '@/components/trades/TradeDetailModal'

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
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null)

  useEffect(() => {
    if (!user) return
    const unsubT = subscribeTrades(t => { setTrades(t); setLoading(false) })
    const unsubS = subscribeSystems(setSystems)
    const unsubE = subscribeExchanges(setExchanges)
    return () => { unsubT(); unsubS(); unsubE() }
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
  const systemColor = (id: string) => systems.find(s => s.id === id)?.color ?? 'var(--tm-accent)'

  const [showImport, setShowImport] = useState(false)

  return (
    <div style={{ padding:24, maxWidth:1600, margin:'0 auto' }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:'var(--tm-text-primary)', margin:0 }}>Trades</h1>
          <p style={{ fontSize:13, color:'var(--tm-text-secondary)', margin:'3px 0 0' }}>
            {loading ? 'Connexion à Firestore...' : `${filtered.length} trade${filtered.length > 1?'s':''}`}
          </p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={() => setShowImport(true)} style={{ padding:'8px 16px', borderRadius:10, border:'1px solid #2A2F3E', background:'var(--tm-bg-secondary)', color:'var(--tm-warning)', fontSize:13, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
            📄 Importer CSV
          </button>
          <button onClick={() => setShowAdd(true)} style={{ padding:'8px 16px', borderRadius:10, border:'none', background:'var(--tm-accent)', color:'var(--tm-bg)', fontSize:13, fontWeight:600, cursor:'pointer' }}>
            + Nouveau trade
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:12 }}>
        {[
          { l:'P&L Total',  v:fmtPnL(totalPnL), c: totalPnL >= 0 ? 'var(--tm-profit)' : 'var(--tm-loss)' },
          { l:'Win Rate',   v:`${wr}%`,          c:'var(--tm-text-primary)' },
          { l:'Gains',      v:wins,              c:'var(--tm-profit)' },
          { l:'Pertes',     v:losses,            c:'var(--tm-loss)' },
        ].map(({ l, v, c }) => (
          <div key={l} style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:10, padding:'12px 14px' }}>
            <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:4 }}>{l}</div>
            <div style={{ fontSize:18, fontWeight:700, color:c, fontFamily:'monospace' }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Toggle advanced stats */}
      <button onClick={() => setShowStats(x => !x)} style={{ width:'100%', padding:'8px', marginBottom:14, borderRadius:10, border:'1px solid #2A2F3E', background:showStats?'rgba(var(--tm-blue-rgb,10,133,255),0.06)':'var(--tm-bg-secondary)', color:showStats?'var(--tm-blue)':'var(--tm-text-muted)', fontSize:12, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
        {showStats ? '▲ Masquer les statistiques avancées' : '▼ Statistiques avancées'}
      </button>

      {showStats && (
        <div style={{ marginBottom:16, animation:'fadeIn 0.2s ease-out' }}>
          <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}`}</style>
          {/* Row 2: Advanced metrics */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:10 }}>
            {[
              { l:'Payoff Ratio',   v:payoff,                    c:'var(--tm-accent)' },
              { l:'Profit Factor',  v:profitFactor,              c: Number(profitFactor) >= 1.5 ? 'var(--tm-profit)' : 'var(--tm-warning)' },
              { l:'Expectancy',     v:fmtPnL(expectancy),        c: expectancy >= 0 ? 'var(--tm-profit)' : 'var(--tm-loss)' },
              { l:'Trades fermés',  v:closed.length,             c:'var(--tm-text-secondary)' },
            ].map(({ l, v, c }) => (
              <div key={l} style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:10, padding:'12px 14px' }}>
                <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:4 }}>{l}</div>
                <div style={{ fontSize:16, fontWeight:700, color:c, fontFamily:'monospace' }}>{v}</div>
              </div>
            ))}
          </div>
          {/* Row 3: Gains/losses details */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:10 }}>
            {[
              { l:'Moy. gain',       v:fmtPnL(avgWin),            c:'var(--tm-profit)' },
              { l:'Moy. perte',      v:fmtPnL(-avgLoss),          c:'var(--tm-loss)' },
              { l:'Meilleur trade',  v:fmtPnL(bestTrade),         c:'var(--tm-profit)' },
              { l:'Pire trade',      v:fmtPnL(worstTrade),        c:'var(--tm-loss)' },
            ].map(({ l, v, c }) => (
              <div key={l} style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:10, padding:'12px 14px' }}>
                <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:4 }}>{l}</div>
                <div style={{ fontSize:16, fontWeight:700, color:c, fontFamily:'monospace' }}>{v}</div>
              </div>
            ))}
          </div>
          {/* Row 4: Streaks + top symbols */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            {/* Streaks */}
            <div style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:10, padding:'14px 16px' }}>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--tm-text-primary)', marginBottom:10 }}>Séries</div>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {[
                  { l:'Meilleure série', v:`${bestStreak} wins`, c:'var(--tm-profit)' },
                  { l:'Pire série',      v:`${Math.abs(worstStreak)} losses`, c:'var(--tm-loss)' },
                  { l:'Profit brut',     v:fmtPnL(grossProfit), c:'var(--tm-profit)' },
                  { l:'Perte brute',     v:fmtPnL(-grossLoss), c:'var(--tm-loss)' },
                ].map(({ l, v, c }) => (
                  <div key={l} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:11, color:'var(--tm-text-secondary)' }}>{l}</span>
                    <span style={{ fontSize:12, fontWeight:700, color:c, fontFamily:'monospace' }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Top symbols */}
            <div style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:10, padding:'14px 16px' }}>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--tm-text-primary)', marginBottom:10 }}>Top Symboles</div>
              {topSymbols.length === 0 ? (
                <div style={{ fontSize:11, color:'var(--tm-text-muted)' }}>Pas de données</div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {topSymbols.map(([sym, data]) => (
                    <div key={sym} style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontSize:12, fontWeight:700, color:'var(--tm-text-primary)', minWidth:80, fontFamily:'monospace' }}>{sym}</span>
                      <div style={{ flex:1, height:6, background:'var(--tm-bg-tertiary)', borderRadius:3, overflow:'hidden' }}>
                        <div style={{ width:`${Math.min(100, data.wins/Math.max(data.count,1)*100)}%`, height:'100%', background:'var(--tm-profit)', borderRadius:3 }} />
                      </div>
                      <span style={{ fontSize:11, fontWeight:600, color:data.pnl>=0?'var(--tm-profit)':'var(--tm-loss)', fontFamily:'monospace', minWidth:70, textAlign:'right' }}>{fmtPnL(data.pnl)}</span>
                      <span style={{ fontSize:9, color:'var(--tm-text-muted)' }}>{data.count}t</span>
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
        <div style={{ display:'flex', background:'var(--tm-bg-secondary)', borderRadius:8, padding:3, gap:2 }}>
          {(['all','open','closed'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ padding:'5px 12px', borderRadius:6, border:'none', cursor:'pointer', fontSize:12, fontWeight:500, background: filter===f?'var(--tm-accent)':'transparent', color: filter===f?'var(--tm-bg)':'var(--tm-text-secondary)' }}>
              {f==='all'?'Tous':f==='open'?'Ouverts':'Fermés'}
            </button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Symbole..." style={{ flex:1, minWidth:180, padding:'6px 12px', borderRadius:8, border:'1px solid #2A2F3E', background:'var(--tm-bg-secondary)', color:'var(--tm-text-primary)', fontSize:13, outline:'none' }} />
      </div>

      {/* List */}
      {loading ? (
        <div style={{ textAlign:'center', padding:48, color:'var(--tm-text-muted)' }}>
          <div style={{ width:24, height:24, border:'2px solid #2A2F3E', borderTopColor:'var(--tm-accent)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto 12px' }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          Chargement depuis Firestore...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:48, color:'var(--tm-text-muted)', fontSize:14 }}>
          Aucun trade{filter !== 'all' ? ` ${filter==='open'?'ouvert':'fermé'}` : ''}
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {filtered.map(trade => {
            const pnl = tradePnL(trade)
            const pnlColor = pnl >= 0 ? 'var(--tm-profit)' : 'var(--tm-loss)'
            const isOpen = trade.status === 'open'
            return (
              <div key={trade.id} onClick={() => setSelectedTrade(trade)} style={{ background:'var(--tm-bg-card, #161B22)', border:'1px solid var(--tm-border, #2A2F3E)', borderRadius:12, padding:'12px 14px', display:'grid', gridTemplateColumns:'auto 1fr auto auto auto', alignItems:'center', gap:14, cursor:'pointer', transition:'border-color 0.15s' }} onMouseOver={e => (e.currentTarget.style.borderColor='var(--tm-accent,#00E5FF)')} onMouseOut={e => (e.currentTarget.style.borderColor='var(--tm-border,#2A2F3E)')}>
                <div style={{ width:36, height:36, borderRadius:8, background: trade.type==='Long'?'rgba(var(--tm-profit-rgb,34,199,89),0.15)':'rgba(var(--tm-loss-rgb,255,59,48),0.15)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, flexShrink:0 }}>
                  {trade.type==='Long'?'📈':'📉'}
                </div>
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3, flexWrap:'wrap' }}>
                    <span style={{ fontSize:14, fontWeight:700, color:'var(--tm-text-primary)' }}>{trade.symbol}</span>
                    <span style={{ fontSize:10, fontWeight:600, color: trade.type==='Long'?'var(--tm-profit)':'var(--tm-loss)', background: trade.type==='Long'?'rgba(var(--tm-profit-rgb,34,199,89),0.1)':'rgba(var(--tm-loss-rgb,255,59,48),0.1)', padding:'1px 6px', borderRadius:4 }}>{trade.type}</span>
                    {isOpen && <span style={{ fontSize:9, fontWeight:700, color:'var(--tm-accent)', background:'rgba(var(--tm-accent-rgb,0,229,255),0.1)', padding:'1px 6px', borderRadius:4 }}>● OUVERT</span>}
                    <span style={{ fontSize:10, color:systemColor(trade.systemId), background:`${systemColor(trade.systemId)}18`, padding:'1px 6px', borderRadius:4 }}>{systemName(trade.systemId)}</span>
                  </div>
                  <div style={{ fontSize:11, color:'var(--tm-text-muted)' }}>
                    {fmtDate(trade.date)} · {trade.leverage}x · {trade.orderRole} · {trade.session}
                    {trade.entryPrice && ` · E: ${fmtPrice(trade.entryPrice)}`}
                    {trade.exitPrice  && ` → S: ${fmtPrice(trade.exitPrice)}`}
                  </div>
                </div>
                {trade.quantity && (
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:10, color:'var(--tm-text-muted)' }}>Qté</div>
                    <div style={{ fontSize:12, color:'var(--tm-text-secondary)', fontFamily:'monospace' }}>{trade.quantity.toFixed(4)}</div>
                  </div>
                )}
                <div style={{ textAlign:'right', minWidth:80 }}>
                  <div style={{ fontSize:10, color:'var(--tm-text-muted)' }}>{isOpen?'Non réalisé':'P&L'}</div>
                  <div style={{ fontSize:14, fontWeight:700, color:pnlColor, fontFamily:'monospace' }}>{fmtPnL(pnl)}</div>
                </div>
                <button onClick={e => { e.stopPropagation(); setSelectedTrade(trade) }} style={{ width:28, height:28, borderRadius:6, border:'1px solid var(--tm-border,#2A2F3E)', background:'none', cursor:'pointer', color:'var(--tm-text-muted,#555C70)', fontSize:11, display:'flex', alignItems:'center', justifyContent:'center' }} title="Voir détails">→</button>
              </div>
            )
          })}
        </div>
      )}

      {showAdd && <AddTradeModal systems={systems} onClose={() => setShowAdd(false)} />}
      {showImport && <ImportCSVModal onClose={() => setShowImport(false)} />}
      {selectedTrade && (
        <TradeDetailModal
          trade={selectedTrade}
          systems={systems}
          exchanges={exchanges}
          onClose={() => setSelectedTrade(null)}
          onDeleted={() => setSelectedTrade(null)}
        />
      )}
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

  const inp = { background:'var(--tm-bg-tertiary)', border:'1px solid #2A2F3E', borderRadius:8, padding:'8px 10px', color:'var(--tm-text-primary)', fontSize:13, outline:'none', width:'100%', boxSizing:'border-box' as const }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
      <div style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:16, padding:24, width:480, maxWidth:'95vw', maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:18 }}>
          <span style={{ fontSize:16, fontWeight:700, color:'var(--tm-text-primary)' }}>Nouveau Trade</span>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--tm-text-muted)', cursor:'pointer', fontSize:18 }}>✕</button>
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
              <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:4 }}>{label}</div>
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
              <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:4 }}>{label}</div>
              <select value={(form as Record<string,string>)[key]} onChange={e => setForm(p => ({...p,[key]:e.target.value}))} style={{...inp,cursor:'pointer'}}>
                {options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          ))}
          {systems.length > 0 && (
            <div style={{ gridColumn:'span 2' }}>
              <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:4 }}>Système</div>
              <select value={form.systemId} onChange={e => setForm(p => ({...p,systemId:e.target.value}))} style={{...inp,cursor:'pointer'}}>
                {systems.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div style={{ gridColumn:'span 2' }}>
            <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:4 }}>Notes</div>
            <textarea value={form.notes} onChange={e => setForm(p => ({...p,notes:e.target.value}))} placeholder="Notes..." rows={2} style={{...inp,resize:'vertical'}} />
          </div>
        </div>
        <button onClick={save} disabled={saving || !form.symbol} style={{ width:'100%', marginTop:16, padding:10, borderRadius:10, border:'none', background:form.symbol?'var(--tm-accent)':'var(--tm-bg-tertiary)', color:form.symbol?'var(--tm-bg)':'var(--tm-text-muted)', fontSize:14, fontWeight:600, cursor:form.symbol?'pointer':'not-allowed' }}>
          {saving ? 'Enregistrement...' : 'Créer le trade'}
        </button>
      </div>
    </div>
  )
}

// ── CSV Import Modal ─────────────────────────────────────────────────────────

interface CSVTrade {
  symbol: string
  qty: number
  buyPrice: number
  sellPrice: number
  pnl: number
  boughtTimestamp: string
  soldTimestamp: string
  duration: string
  direction: 'Long' | 'Short'
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes }
    else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = '' }
    else { current += ch }
  }
  result.push(current.trim())
  return result
}

function parsePnL(raw: string): number {
  // "$125.00" → 125, "$(175.00)" → -175
  const cleaned = raw.replace(/[$,]/g, '')
  const match = cleaned.match(/\((.+)\)/)
  if (match) return -parseFloat(match[1])
  return parseFloat(cleaned) || 0
}

function parseCSVDate(raw: string): Date {
  // "03/16/2026 17:54:31" → Date
  const [datePart, timePart] = raw.split(' ')
  const [month, day, year] = datePart.split('/')
  return new Date(`${year}-${month}-${day}T${timePart}`)
}

function parseCSVTrades(text: string): CSVTrade[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim())
  const iSym   = headers.indexOf('symbol')
  const iQty   = headers.indexOf('qty')
  const iBuy   = headers.indexOf('buyprice')
  const iSell  = headers.indexOf('sellprice')
  const iPnl   = headers.indexOf('pnl')
  const iBTime = headers.indexOf('boughttimestamp')
  const iSTime = headers.indexOf('soldtimestamp')
  const iDur   = headers.indexOf('duration')

  return lines.slice(1).map(line => {
    const cols = parseCSVLine(line)
    const buyPrice  = parseFloat(cols[iBuy]  || '0')
    const sellPrice = parseFloat(cols[iSell] || '0')
    // Determine direction: if bought first (boughtTimestamp < soldTimestamp) → Long, else Short
    const boughtTime = cols[iBTime] || ''
    const soldTime   = cols[iSTime] || ''
    const boughtDate = parseCSVDate(boughtTime)
    const soldDate   = parseCSVDate(soldTime)
    const direction: 'Long' | 'Short' = boughtDate <= soldDate ? 'Long' : 'Short'

    return {
      symbol:          cols[iSym] || '',
      qty:             parseFloat(cols[iQty] || '1'),
      buyPrice,
      sellPrice,
      pnl:             parsePnL(cols[iPnl] || '$0'),
      boughtTimestamp:  boughtTime,
      soldTimestamp:    soldTime,
      duration:         cols[iDur] || '',
      direction,
    }
  }).filter(t => t.symbol)
}

function ImportCSVModal({ onClose }: { onClose: () => void }) {
  const [parsed, setParsed]     = useState<CSVTrade[]>([])
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [done, setDone]         = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError]       = useState('')

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setError('')
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string
        const trades = parseCSVTrades(text)
        if (trades.length === 0) { setError('Aucun trade détecté dans le fichier.'); return }
        setParsed(trades)
      } catch { setError('Erreur de lecture du fichier CSV.') }
    }
    reader.readAsText(file)
  }

  const doImport = async () => {
    if (parsed.length === 0) return
    setImporting(true)
    setProgress(0)
    try {
      for (let i = 0; i < parsed.length; i++) {
        const t = parsed[i]
        const boughtDate = parseCSVDate(t.boughtTimestamp)
        const soldDate   = parseCSVDate(t.soldTimestamp)
        const entryDate  = t.direction === 'Long' ? boughtDate : soldDate
        const exitDate   = t.direction === 'Long' ? soldDate   : boughtDate
        const entryPrice = t.direction === 'Long' ? t.buyPrice : t.sellPrice
        const exitPrice  = t.direction === 'Long' ? t.sellPrice : t.buyPrice

        await createTrade({
          id:          crypto.randomUUID(),
          date:        entryDate,
          symbol:      t.symbol,
          type:        t.direction,
          entryPrice,
          exitPrice,
          quantity:    t.qty,
          leverage:    1,
          exchangeId:  '',
          orderRole:   'Taker',
          systemId:    '',
          session:     'US',
          flashPnLNet: t.pnl,
          notes:       `Import CSV · Durée: ${t.duration}`,
          tags:        ['csv-import'],
          status:      'closed',
          closedAt:    exitDate,
        })
        setProgress(i + 1)
      }
      setDone(true)
    } catch (err) {
      setError(`Erreur lors de l'import: ${(err as Error).message}`)
    } finally {
      setImporting(false)
    }
  }

  const totalPnL = parsed.reduce((s, t) => s + t.pnl, 0)
  const wins     = parsed.filter(t => t.pnl > 0).length
  const losses   = parsed.filter(t => t.pnl < 0).length
  const be       = parsed.filter(t => t.pnl === 0).length

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
      <div style={{ background:'var(--tm-bg-secondary)', border:'1px solid #2A2F3E', borderRadius:16, padding:24, width:560, maxWidth:'95vw', maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:18 }}>
          <span style={{ fontSize:16, fontWeight:700, color:'var(--tm-text-primary)' }}>📄 Importer des trades (CSV Propfirm)</span>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--tm-text-muted)', cursor:'pointer', fontSize:18 }}>✕</button>
        </div>

        {/* File input */}
        {!done && (
          <label style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'20px', border:'2px dashed #2A2F3E', borderRadius:12, cursor:'pointer', marginBottom:16, transition:'border-color 0.2s' }}
            onMouseOver={e => (e.currentTarget.style.borderColor = 'var(--tm-warning)')}
            onMouseOut={e => (e.currentTarget.style.borderColor = 'var(--tm-border)')}>
            <input type="file" accept=".csv" onChange={handleFile} style={{ display:'none' }} />
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:28, marginBottom:6 }}>📁</div>
              <div style={{ fontSize:13, color:'var(--tm-text-secondary)', fontWeight:600 }}>{fileName || 'Cliquez pour sélectionner un fichier .csv'}</div>
              <div style={{ fontSize:11, color:'var(--tm-text-muted)', marginTop:4 }}>Format supporté : CSV de propfirm (Topstep, FTMO, etc.)</div>
            </div>
          </label>
        )}

        {error && (
          <div style={{ padding:'10px 14px', borderRadius:10, background:'rgba(var(--tm-loss-rgb,255,59,48),0.1)', border:'1px solid rgba(var(--tm-loss-rgb,255,59,48),0.3)', color:'var(--tm-loss)', fontSize:12, marginBottom:14 }}>
            {error}
          </div>
        )}

        {/* Preview */}
        {parsed.length > 0 && !done && (
          <>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, marginBottom:14 }}>
              {[
                { l: 'Trades détectés', v: parsed.length, c: 'var(--tm-accent)' },
                { l: 'Gains', v: wins, c: 'var(--tm-profit)' },
                { l: 'Pertes', v: losses, c: 'var(--tm-loss)' },
                { l: 'P&L Total', v: `${totalPnL >= 0 ? '+' : ''}$${Math.abs(totalPnL).toFixed(2)}`, c: totalPnL >= 0 ? 'var(--tm-profit)' : 'var(--tm-loss)' },
              ].map(({ l, v, c }) => (
                <div key={l} style={{ background:'var(--tm-bg-tertiary)', borderRadius:8, padding:'8px 10px', textAlign:'center' }}>
                  <div style={{ fontSize:9, color:'var(--tm-text-muted)', marginBottom:3 }}>{l}</div>
                  <div style={{ fontSize:15, fontWeight:700, color:c, fontFamily:'monospace' }}>{v}</div>
                </div>
              ))}
            </div>

            {/* Trade list preview */}
            <div style={{ maxHeight:220, overflowY:'auto', marginBottom:14, borderRadius:10, border:'1px solid #2A2F3E' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                <thead>
                  <tr style={{ background:'var(--tm-bg-tertiary)' }}>
                    {['Symbole','Dir','Qté','Entrée','Sortie','P&L','Date'].map(h => (
                      <th key={h} style={{ padding:'6px 8px', textAlign:'left', color:'var(--tm-text-muted)', fontWeight:600, fontSize:10, borderBottom:'1px solid #2A2F3E' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.map((t, i) => (
                    <tr key={i} style={{ borderBottom:'1px solid #1C2130' }}>
                      <td style={{ padding:'5px 8px', color:'var(--tm-text-primary)', fontWeight:600 }}>{t.symbol}</td>
                      <td style={{ padding:'5px 8px', color: t.direction === 'Long' ? 'var(--tm-profit)' : 'var(--tm-loss)', fontWeight:600 }}>{t.direction}</td>
                      <td style={{ padding:'5px 8px', color:'var(--tm-text-secondary)', fontFamily:'monospace' }}>{t.qty}</td>
                      <td style={{ padding:'5px 8px', color:'var(--tm-text-secondary)', fontFamily:'monospace' }}>${t.buyPrice.toFixed(2)}</td>
                      <td style={{ padding:'5px 8px', color:'var(--tm-text-secondary)', fontFamily:'monospace' }}>${t.sellPrice.toFixed(2)}</td>
                      <td style={{ padding:'5px 8px', color: t.pnl >= 0 ? 'var(--tm-profit)' : 'var(--tm-loss)', fontWeight:600, fontFamily:'monospace' }}>{t.pnl >= 0 ? '+' : ''}${Math.abs(t.pnl).toFixed(2)}</td>
                      <td style={{ padding:'5px 8px', color:'var(--tm-text-muted)' }}>{t.boughtTimestamp.split(' ')[0]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Import button */}
            <button onClick={doImport} disabled={importing} style={{ width:'100%', padding:12, borderRadius:10, border:'none', background: importing ? 'var(--tm-bg-tertiary)' : 'var(--tm-warning)', color: importing ? 'var(--tm-text-muted)' : 'var(--tm-bg)', fontSize:14, fontWeight:700, cursor: importing ? 'not-allowed' : 'pointer' }}>
              {importing ? `Import en cours... ${progress}/${parsed.length}` : `Importer ${parsed.length} trades dans Firebase`}
            </button>

            {importing && (
              <div style={{ marginTop:8, height:4, borderRadius:4, background:'var(--tm-bg-tertiary)', overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${(progress / parsed.length) * 100}%`, background:'var(--tm-warning)', borderRadius:4, transition:'width 0.3s' }} />
              </div>
            )}
          </>
        )}

        {/* Success */}
        {done && (
          <div style={{ textAlign:'center', padding:'20px 0' }}>
            <div style={{ fontSize:48, marginBottom:12 }}>✅</div>
            <div style={{ fontSize:16, fontWeight:700, color:'var(--tm-profit)', marginBottom:6 }}>{parsed.length} trades importés avec succès !</div>
            <div style={{ fontSize:12, color:'var(--tm-text-muted)', marginBottom:16 }}>P&L total : <span style={{ color: totalPnL >= 0 ? 'var(--tm-profit)' : 'var(--tm-loss)', fontWeight:700, fontFamily:'monospace' }}>{totalPnL >= 0 ? '+' : ''}${Math.abs(totalPnL).toFixed(2)}</span></div>
            <button onClick={onClose} style={{ padding:'10px 32px', borderRadius:10, border:'none', background:'var(--tm-accent)', color:'var(--tm-bg)', fontSize:14, fontWeight:600, cursor:'pointer' }}>
              Fermer
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
