// src/pages/dashboard/DashboardPage.tsx — Données réelles depuis Firestore

import { useState, useEffect, useRef } from 'react'
import { subscribeTrades, subscribeSystems, tradePnL, type Trade, type TradingSystem } from '@/services/firestore'

function fmtPnL(n: number) { return `${n>=0?'+':''}$${Math.abs(n).toFixed(2)}` }
function fmtPrice(p?: number) { if(!p)return'—'; return p>=1000?`$${p.toLocaleString('fr-FR',{maximumFractionDigits:1})}`:`$${p.toFixed(4)}` }
function fmtDate(d: Date) { return d.toLocaleDateString('fr-FR', {day:'2-digit', month:'short'}) }

function PnLChart({ trades }: { trades: Trade[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const W = canvas.width, H = canvas.height
    ctx.fillStyle = '#0D1117'; ctx.fillRect(0,0,W,H)
    const closed = [...trades].filter(t => t.status === 'closed').sort((a,b) => a.date.getTime()-b.date.getTime())
    if (closed.length < 2) {
      ctx.fillStyle = '#555C70'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('Pas assez de données', W/2, H/2); return
    }
    let cum = 0
    const points = closed.map(t => { cum += tradePnL(t); return cum })
    const minV = Math.min(...points, 0), maxV = Math.max(...points, 0)
    const range = maxV - minV || 1
    const zeroY = H - ((-minV)/range)*H
    // Zero line
    ctx.setLineDash([3,3]); ctx.strokeStyle='#2A2F3E'; ctx.lineWidth=1
    ctx.beginPath(); ctx.moveTo(0,zeroY); ctx.lineTo(W,zeroY); ctx.stroke(); ctx.setLineDash([])
    // Area
    const last = points[points.length-1]
    ctx.beginPath()
    points.forEach((v,i) => {
      const x = (i/(points.length-1))*W, y = H-((v-minV)/range)*H
      i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y)
    })
    ctx.lineTo(W,zeroY); ctx.lineTo(0,zeroY); ctx.closePath()
    const grad = ctx.createLinearGradient(0,0,0,H)
    const c = last>=0?'#22C759':'#FF3B30'
    grad.addColorStop(0, c+'40'); grad.addColorStop(1, c+'05')
    ctx.fillStyle=grad; ctx.fill()
    // Line
    ctx.beginPath(); ctx.strokeStyle=c; ctx.lineWidth=1.5
    points.forEach((v,i) => {
      const x=(i/(points.length-1))*W, y=H-((v-minV)/range)*H
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)
    }); ctx.stroke()
  }, [trades])
  return <canvas ref={canvasRef} width={700} height={120} style={{width:'100%',height:120,borderRadius:8,display:'block'}} />
}

export default function DashboardPage() {
  const [trades,  setTrades]  = useState<Trade[]>([])
  const [systems, setSystems] = useState<TradingSystem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubT = subscribeTrades(t => { setTrades(t); setLoading(false) })
    const unsubS = subscribeSystems(setSystems)
    return () => { unsubT(); unsubS() }
  }, [])

  const closed = trades.filter(t => t.status === 'closed')
  const open   = trades.filter(t => t.status === 'open')
  const pnls   = closed.map(tradePnL)
  const total  = pnls.reduce((a,b) => a+b, 0)
  const wins   = pnls.filter(p => p > 0).length
  const losses = pnls.filter(p => p <= 0).length
  const wr     = closed.length > 0 ? (wins/closed.length*100).toFixed(1) : '—'
  const avgWin = wins > 0 ? pnls.filter(p=>p>0).reduce((a,b)=>a+b,0)/wins : 0
  const avgLoss= losses > 0 ? Math.abs(pnls.filter(p=>p<=0).reduce((a,b)=>a+b,0)/losses) : 0
  const rr     = avgLoss > 0 ? (avgWin/avgLoss).toFixed(2) : '—'

  const systemName = (id:string) => systems.find(s=>s.id===id)?.name ?? '—'
  const systemColor = (id:string) => systems.find(s=>s.id===id)?.color ?? '#00E5FF'
  const recent = [...trades].sort((a,b)=>b.date.getTime()-a.date.getTime()).slice(0,5)

  return (
    <div style={{padding:24,maxWidth:1100,margin:'0 auto'}}>
      <div style={{marginBottom:20}}>
        <h1 style={{fontSize:22,fontWeight:700,color:'#F0F3FF',margin:0}}>Dashboard</h1>
        <p style={{fontSize:13,color:'#8F94A3',margin:'3px 0 0'}}>
          {loading ? 'Connexion à Firestore...' : `${trades.length} trade${trades.length>1?'s':''} · ${open.length} ouvert${open.length>1?'s':''}`}
        </p>
      </div>

      {/* KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:16}}>
        {[
          { l:'P&L Total', v:fmtPnL(total), c:total>=0?'#22C759':'#FF3B30' },
          { l:'Win Rate', v:`${wr}%`, c:'#F0F3FF' },
          { l:'Ratio R/R', v:rr, c:'#00E5FF' },
          { l:'Trades Ouverts', v:open.length, c:open.length>0?'#FF9500':'#8F94A3' },
        ].map(({l,v,c}) => (
          <div key={l} style={{background:'#161B22',border:'1px solid #2A2F3E',borderRadius:10,padding:'12px 14px'}}>
            <div style={{fontSize:10,color:'#555C70',marginBottom:4}}>{l}</div>
            <div style={{fontSize:20,fontWeight:700,color:c,fontFamily:'monospace'}}>{v}</div>
          </div>
        ))}
      </div>

      {/* P&L Chart */}
      <div style={{background:'#161B22',border:'1px solid #2A2F3E',borderRadius:12,padding:'14px',marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:600,color:'#F0F3FF',marginBottom:10}}>Courbe P&L cumulée</div>
        {loading ? <div style={{height:120,display:'flex',alignItems:'center',justifyContent:'center',color:'#555C70',fontSize:12}}>Chargement...</div>
          : <PnLChart trades={trades} />}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        {/* Recent trades */}
        <div style={{background:'#161B22',border:'1px solid #2A2F3E',borderRadius:12,padding:'14px'}}>
          <div style={{fontSize:13,fontWeight:600,color:'#F0F3FF',marginBottom:12}}>Trades récents</div>
          {loading ? <div style={{color:'#555C70',fontSize:12}}>Chargement...</div>
          : recent.length === 0 ? <div style={{color:'#555C70',fontSize:12}}>Aucun trade</div>
          : <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {recent.map(t => {
              const pnl = tradePnL(t)
              return (
                <div key={t.id} style={{display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontSize:14}}>{t.type==='Long'?'📈':'📉'}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,color:'#F0F3FF'}}>{t.symbol}</div>
                    <div style={{fontSize:10,color:'#555C70'}}>{fmtDate(t.date)} · <span style={{color:systemColor(t.systemId)}}>{systemName(t.systemId)}</span></div>
                  </div>
                  {t.status==='open'
                    ? <span style={{fontSize:10,color:'#00E5FF',background:'rgba(0,229,255,0.1)',padding:'2px 6px',borderRadius:4}}>OUVERT</span>
                    : <span style={{fontSize:12,fontWeight:700,color:pnl>=0?'#22C759':'#FF3B30',fontFamily:'monospace'}}>{fmtPnL(pnl)}</span>}
                </div>
              )
            })}
          </div>}
        </div>

        {/* Stats */}
        <div style={{background:'#161B22',border:'1px solid #2A2F3E',borderRadius:12,padding:'14px'}}>
          <div style={{fontSize:13,fontWeight:600,color:'#F0F3FF',marginBottom:12}}>Statistiques</div>
          {loading ? <div style={{color:'#555C70',fontSize:12}}>Chargement...</div>
          : <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {[
              { l:'Trades fermés', v:closed.length },
              { l:'Gains',  v:wins,   c:'#22C759' },
              { l:'Pertes', v:losses, c:'#FF3B30' },
              { l:'Gain moyen', v:fmtPnL(avgWin), c:'#22C759' },
              { l:'Perte moyenne', v:`-$${avgLoss.toFixed(2)}`, c:'#FF3B30' },
            ].map(({l,v,c}) => (
              <div key={l} style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:12,color:'#8F94A3'}}>{l}</span>
                <span style={{fontSize:13,fontWeight:600,color:c??'#F0F3FF',fontFamily:'monospace'}}>{v}</span>
              </div>
            ))}
          </div>}
        </div>
      </div>
    </div>
  )
}
