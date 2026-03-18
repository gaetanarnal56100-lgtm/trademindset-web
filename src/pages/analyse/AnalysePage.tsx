// src/pages/analyse/AnalysePage.tsx
import { useState } from 'react'
import LiquidationHeatmap from './LiquidationHeatmap'

const POPULAR = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','AVAXUSDT','DOGEUSDT','ADAUSDT']

function SymbolSearch({ symbol, onSelect }: { symbol: string; onSelect: (s: string) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const results = q ? POPULAR.filter(s => s.includes(q.toUpperCase())) : POPULAR
  return (
    <div style={{ position:'relative' }}>
      <div onClick={() => setOpen(x => !x)} style={{ display:'flex', alignItems:'center', gap:8, background:'#161B22', border:'1px solid #2A2F3E', borderRadius:10, padding:'7px 12px', cursor:'pointer', minWidth:160 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#555C70" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <span style={{ fontSize:14, fontWeight:700, color:'#F0F3FF', flex:1 }}>{symbol}</span>
        <span style={{ fontSize:10, color:'#555C70' }}>▼</span>
      </div>
      {open && (
        <div style={{ position:'absolute', top:'100%', left:0, background:'#161B22', border:'1px solid #2A2F3E', borderRadius:10, zIndex:50, marginTop:4, minWidth:200, boxShadow:'0 8px 24px rgba(0,0,0,0.5)' }}>
          <div style={{ padding:'8px 10px', borderBottom:'1px solid #2A2F3E' }}>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher..."
              style={{ background:'#1C2130', border:'1px solid #2A2F3E', borderRadius:6, padding:'4px 8px', color:'#F0F3FF', fontSize:12, width:'100%', outline:'none' }} />
          </div>
          {results.map(s => (
            <button key={s} onClick={() => { onSelect(s); setOpen(false); setQ('') }}
              style={{ width:'100%', textAlign:'left', padding:'8px 14px', background: s===symbol?'rgba(0,229,255,0.07)':'none', border:'none', cursor:'pointer', color: s===symbol?'#00E5FF':'#F0F3FF', fontSize:13, borderBottom:'1px solid #1C2130', display:'flex', justifyContent:'space-between' }}>
              {s}{s===symbol && <span style={{ fontSize:10, color:'#00E5FF' }}>●</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AnalysePage() {
  const [symbol, setSymbol] = useState('BTCUSDT')

  return (
    <div style={{ padding:24, maxWidth:1100, margin:'0 auto' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:'#F0F3FF', margin:0 }}>Analyse</h1>
          <p style={{ fontSize:13, color:'#8F94A3', margin:'3px 0 0' }}>Liquidation Heatmap · CVD · Photo Analysis</p>
        </div>
        <SymbolSearch symbol={symbol} onSelect={setSymbol} />
      </div>
      <LiquidationHeatmap symbol={symbol} />
    </div>
  )
}
