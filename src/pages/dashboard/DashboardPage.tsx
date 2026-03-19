// DashboardPage.tsx — Dashboard enrichi miroir iOS
import { useState, useEffect, useRef, useMemo } from 'react'
import { subscribeTrades, subscribeSystems, subscribeMoods, tradePnL, type Trade, type TradingSystem, type MoodEntry } from '@/services/firestore'

function fmt(n: number, d = 2) { return Math.abs(n).toFixed(d) }
function fmtK(n: number) {
  const abs = Math.abs(n), s = n < 0 ? '-' : '+'
  if (abs >= 1_000_000) return `${s}$${(abs/1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `${s}$${(abs/1_000).toFixed(1)}K`
  return `${s}$${abs.toFixed(2)}`
}
function fmtDate(d: Date) { return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) }
function card(extra?: object) {
  return { background:'#161B22', border:'1px solid #1E2330', borderRadius:16, padding:'18px 20px', position:'relative' as const, overflow:'hidden', ...extra }
}
function hl() {
  return { position:'absolute' as const, top:0, left:0, right:0, height:1, background:'linear-gradient(90deg,transparent,rgba(255,255,255,0.05),transparent)' }
}
function Skel({ h=20, w='100%' }: { h?: number; w?: string|number }) {
  return <div style={{height:h,width:w,background:'rgba(255,255,255,0.04)',borderRadius:6}}/>
}

function calcStats(trades: Trade[]) {
  const closed = trades.filter(t=>t.status==='closed').sort((a,b)=>a.date.getTime()-b.date.getTime())
  const pnls = closed.map(tradePnL)
  const wins = pnls.filter(p=>p>0), losses = pnls.filter(p=>p<=0)
  const totalPnL = pnls.reduce((a,b)=>a+b,0)
  const winRate = closed.length>0?wins.length/closed.length*100:0
  const avgWin  = wins.length>0?wins.reduce((a,b)=>a+b,0)/wins.length:0
  const avgLoss = losses.length>0?Math.abs(losses.reduce((a,b)=>a+b,0)/losses.length):0
  const payoffRatio = avgLoss>0?avgWin/avgLoss:0
  const expectancy  = (winRate/100)*avgWin-(1-winRate/100)*avgLoss
  const fees = closed.reduce((a,t)=>a+(t.quantity||0)*(t.entryPrice||0)*0.001,0)
  let cum=0,peak=0,maxDD=0
  for(const p of pnls){cum+=p;if(cum>peak)peak=cum;const dd=peak-cum;if(dd>maxDD)maxDD=dd}
  const returns=pnls.map(p=>p/1000*100),avgRet=returns.length?returns.reduce((a,b)=>a+b,0)/returns.length:0
  const variance=returns.length?returns.reduce((a,b)=>a+Math.pow(b-avgRet,2),0)/returns.length:0
  const sharpe=Math.sqrt(variance)>0?avgRet/Math.sqrt(variance):0
  let bestStreak=0,worstStreak=0,cur=0
  for(const p of pnls){if(p>0){cur=cur>0?cur+1:1}else{cur=cur<0?cur-1:-1};if(cur>bestStreak)bestStreak=cur;if(cur<worstStreak)worstStreak=cur}
  let currentStreak=0
  for(let i=pnls.length-1;i>=0;i--){if(i===pnls.length-1){currentStreak=pnls[i]>0?1:-1;continue}if((pnls[i]>0)===(currentStreak>0))currentStreak+=currentStreak>0?1:-1;else break}
  const longs=closed.filter(t=>t.type==='Long'),shorts=closed.filter(t=>t.type==='Short')
  const lp=longs.map(tradePnL),sp=shorts.map(tradePnL)
  const longWR =longs.length ?longs.filter((_,i)=>lp[i]>0).length/longs.length*100:0
  const shortWR=shorts.length?shorts.filter((_,i)=>sp[i]>0).length/shorts.length*100:0
  return{totalPnL,winRate,avgWin,avgLoss,payoffRatio,expectancy,fees,maxDD,sharpe,bestStreak,
    worstStreak:Math.abs(worstStreak),currentStreak,wins:wins.length,losses:losses.length,
    total:closed.length,longs:longs.length,shorts:shorts.length,longWR,shortWR,
    longPnL:lp.reduce((a,b)=>a+b,0),shortPnL:sp.reduce((a,b)=>a+b,0)}
}

function emotionScore(state: string): number {
  const m: Record<string,number>={'Confiant':4,'Serein':4,'Focused':4,'Disciplined':4,'Neutre':3,'Neutral':3,'Stressé':2,'Anxieux':2,'Fatigué':2,'Stressed':2,'FOMO':1,'Impulsif':1,'Frustré':1}
  return m[state]??3
}
function calcEmotions(moods: MoodEntry[], trades: Trade[]) {
  if(!moods.length)return null
  const avg=moods.reduce((a,m)=>a+emotionScore(m.state),0)/moods.length
  const dm: Record<string,number>={}
  for(const m of moods)dm[m.state]=(dm[m.state]||0)+1
  const dominant=Object.entries(dm).sort((a,b)=>b[1]-a[1])[0]?.[0]??'Neutre'
  const avgState=avg>=3.5?'Confiant':avg>=2.5?'Neutre':avg>=1.5?'Stressé':'Impulsif'
  const sorted=[...trades].filter(t=>t.status==='closed').sort((a,b)=>b.date.getTime()-a.date.getTime())
  let consec=0
  for(const t of sorted){if(tradePnL(t)<0)consec++;else break}
  const risk=consec>=3?'Élevé':consec>=2?'Prudence':'Faible'
  const impact=avg>=3.5?'Positif':avg>=2.5?'Neutre':'Négatif'
  const advice=consec>=3?'Pause recommandée':avg>=3.5?'Continuer':'Réduire la taille'
  return{dominant,avgState,risk,impact,advice,consec,entries:moods.length}
}

function PnLCurve({trades}:{trades:Trade[]}) {
  const ref=useRef<HTMLCanvasElement>(null)
  useEffect(()=>{
    const canvas=ref.current;if(!canvas)return
    const ctx=canvas.getContext('2d')!,W=canvas.width,H=canvas.height
    ctx.clearRect(0,0,W,H)
    const cl=[...trades].filter(t=>t.status==='closed').sort((a,b)=>a.date.getTime()-b.date.getTime())
    if(cl.length<2){ctx.font='12px DM Sans';ctx.fillStyle='#3D4254';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('Pas assez de données',W/2,H/2);return}
    let cum=0;const pts=cl.map(t=>{cum+=tradePnL(t);return cum})
    const minV=Math.min(...pts,0),maxV=Math.max(...pts,0),range=maxV-minV||1,zY=H-((-minV)/range)*H
    ctx.setLineDash([3,3]);ctx.strokeStyle='rgba(255,255,255,0.06)';ctx.lineWidth=1
    ctx.beginPath();ctx.moveTo(0,zY);ctx.lineTo(W,zY);ctx.stroke();ctx.setLineDash([])
    const last=pts[pts.length-1],c=last>=0?'#22C759':'#FF3B30'
    ctx.beginPath();pts.forEach((v,i)=>{const x=(i/(pts.length-1))*W,y=H-((v-minV)/range)*H;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)})
    ctx.lineTo(W,zY);ctx.lineTo(0,zY);ctx.closePath()
    const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,c+'30');g.addColorStop(1,c+'02')
    ctx.fillStyle=g;ctx.fill()
    ctx.beginPath();ctx.strokeStyle=c;ctx.lineWidth=1.5
    pts.forEach((v,i)=>{const x=(i/(pts.length-1))*W,y=H-((v-minV)/range)*H;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)})
    ctx.stroke()
  },[trades])
  return <canvas ref={ref} width={600} height={100} style={{width:'100%',height:100,display:'block'}}/>
}

function MonthlyChart({trades}:{trades:Trade[]}) {
  const months=useMemo(()=>{
    const map: Record<string,number>={}
    for(const t of trades.filter(t=>t.status==='closed')){
      const k=t.date.toLocaleDateString('fr-FR',{month:'short'});map[k]=(map[k]||0)+tradePnL(t)
    }
    const order=['jan.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.']
    return order.filter(m=>map[m]!=null).map(m=>({label:m[0].toUpperCase(),value:map[m]!}))
  },[trades])
  if(!months.length)return <div style={{textAlign:'center',color:'#3D4254',fontSize:12,padding:'20px 0'}}>Pas de données</div>
  const maxAbs=Math.max(...months.map(m=>Math.abs(m.value)),1)
  const best=months.reduce((a,b)=>b.value>a.value?b:a,months[0])
  const worst=months.reduce((a,b)=>b.value<a.value?b:a,months[0])
  const avg=months.reduce((a,b)=>a+b.value,0)/months.length
  return(
    <div>
      <div style={{display:'flex',alignItems:'flex-end',gap:4,height:80,marginBottom:8}}>
        {months.map((m,i)=>{
          const h=Math.max((Math.abs(m.value)/maxAbs)*72,3),c=m.value>=0?'#22C759':'#FF3B30'
          return(<div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
            <div style={{width:'100%',height:h,background:c,borderRadius:'3px 3px 0 0',opacity:0.85}}/>
            <div style={{fontSize:8,color:'#3D4254'}}>{m.label}</div>
          </div>)
        })}
      </div>
      <div style={{display:'flex',gap:8,marginTop:4}}>
        {[{l:'Meilleur',v:fmtK(best.value),c:'#22C759'},{l:'Pire',v:fmtK(worst.value),c:'#FF3B30'},{l:'Moyenne',v:fmtK(avg),c:'#8F94A3'}].map(({l,v,c})=>(
          <div key={l} style={{flex:1,background:'rgba(255,255,255,0.02)',borderRadius:8,padding:'6px 8px',textAlign:'center'}}>
            <div style={{fontSize:9,color:'#555C70',marginBottom:2}}>{l}</div>
            <div style={{fontSize:11,fontWeight:700,color:c,fontFamily:'JetBrains Mono, monospace'}}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CalendarHeatmap({trades,period}:{trades:Trade[],period:string}) {
  const days=period==='7j'?7:period==='1M'?30:period==='3M'?90:period==='6M'?180:365
  const since=new Date(Date.now()-days*86400000)
  const byDay=useMemo(()=>{
    const map: Record<string,number>={}
    for(const t of trades.filter(t=>t.status==='closed'&&t.date>=since)){
      const k=t.date.toISOString().slice(0,10);map[k]=(map[k]||0)+tradePnL(t)
    }
    return map
  },[trades,days])
  const maxAbs=Math.max(...Object.values(byDay).map(Math.abs),1)
  const today=new Date();today.setHours(0,0,0,0)
  const startDay=new Date(today);startDay.setDate(today.getDate()-days+1)
  const gridStart=new Date(startDay);gridStart.setDate(gridStart.getDate()-gridStart.getDay())
  const cells: {date:Date,key:string,inRange:boolean}[]=[]
  const d=new Date(gridStart)
  while(d<=today||cells.length%7!==0){
    const key=d.toISOString().slice(0,10)
    cells.push({date:new Date(d),key,inRange:d>=startDay&&d<=today})
    d.setDate(d.getDate()+1)
  }
  return(
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3,marginBottom:4}}>
        {['D','L','M','M','J','V','S'].map((l,i)=><div key={i} style={{fontSize:10,color:'#3D4254',textAlign:'center',fontWeight:600}}>{l}</div>)}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3}}>
        {cells.map(({date,key,inRange})=>{
          const pnl=byDay[key];const intensity=pnl!=null?Math.min(Math.abs(pnl)/maxAbs,1):0
          const isToday=date.toDateString()===today.toDateString()
          let bg='#1C2130'
          if(inRange&&pnl!=null)bg=pnl>0?`rgba(34,199,89,${0.1+intensity*0.7})`:`rgba(255,59,48,${0.1+intensity*0.7})`
          else if(!inRange)bg='transparent'
          return(<div key={key} title={inRange&&pnl!=null?`${key}: ${fmtK(pnl)}`:key}
            style={{aspectRatio:'1',borderRadius:5,background:bg,border:isToday?'1px solid rgba(255,255,255,0.2)':'1px solid transparent'}}/>)
        })}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const [trades,  setTrades]  = useState<Trade[]>([])
  const [systems, setSystems] = useState<TradingSystem[]>([])
  const [moods,   setMoods]   = useState<MoodEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [period,  setPeriod]  = useState('1M')

  useEffect(()=>{
    const u1=subscribeTrades(t=>{setTrades(t);setLoading(false)})
    const u2=subscribeSystems(setSystems)
    const u3=subscribeMoods(setMoods)
    return()=>{u1();u2();u3()}
  },[])

  const s   = useMemo(()=>calcStats(trades),[trades])
  const emo = useMemo(()=>calcEmotions(moods,trades),[moods,trades])
  const closed=trades.filter(t=>t.status==='closed')
  const open  =trades.filter(t=>t.status==='open')
  const recent=[...trades].sort((a,b)=>b.date.getTime()-a.date.getTime()).slice(0,6)
  const systemName =(id:string)=>systems.find(s=>s.id===id)?.name??'—'
  const systemColor=(id:string)=>systems.find(s=>s.id===id)?.color??'#00E5FF'

  return(
    <div style={{padding:'28px 28px 60px',maxWidth:1200,margin:'0 auto'}}>
      {/* Header */}
      <div style={{marginBottom:28}}>
        <h1 style={{fontSize:24,fontWeight:700,color:'#F0F3FF',margin:0,fontFamily:'Syne, sans-serif',letterSpacing:'-0.02em'}}>Dashboard</h1>
        <p style={{fontSize:13,color:'#555C70',margin:'4px 0 0'}}>{loading?'…':`${trades.length} trades · ${open.length} ouvert${open.length!==1?'s':''}`}</p>
      </div>

      {/* KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:16}}>
        {[
          {label:'P&L Total', value:loading?null:fmtK(s.totalPnL), color:s.totalPnL>=0?'#22C759':'#FF3B30', sub:`${closed.length} trades fermés`},
          {label:'Win Rate',  value:loading?null:`${s.winRate.toFixed(1)}%`, color:'#F0F3FF', sub:`${s.wins}W / ${s.losses}L`},
          {label:'Ratio R/R', value:loading?null:s.payoffRatio.toFixed(2), color:'#00E5FF', sub:'Rendement/Risque'},
          {label:'Ouverts',   value:loading?null:String(open.length), color:open.length>0?'#FF9500':'#8F94A3', sub:'Positions actives'},
        ].map(({label,value,color,sub})=>(
          <div key={label} style={card()}>
            <div style={hl()}/>
            <div style={{fontSize:11,color:'#555C70',marginBottom:8,textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:500}}>{label}</div>
            {value===null?<Skel h={28}/>:<div style={{fontSize:22,fontWeight:700,color,fontFamily:'JetBrains Mono, monospace',letterSpacing:'-0.02em',marginBottom:4}}>{value}</div>}
            <div style={{fontSize:11,color:'#3D4254'}}>{sub}</div>
          </div>
        ))}
      </div>

      {/* P&L Curve */}
      <div style={{...card(),marginBottom:16}}>
        <div style={hl()}/>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:600,color:'#F0F3FF'}}>Courbe P&L cumulée</div>
          {!loading&&<div style={{fontSize:13,fontWeight:700,color:s.totalPnL>=0?'#22C759':'#FF3B30',fontFamily:'JetBrains Mono, monospace'}}>{fmtK(s.totalPnL)}</div>}
        </div>
        <PnLCurve trades={trades}/>
      </div>

      {/* Long / Short */}
      <div style={{...card(),marginBottom:16}}>
        <div style={hl()}/>
        <div style={{fontSize:14,fontWeight:700,color:'#F0F3FF',marginBottom:4}}>Long / Short Performance</div>
        <div style={{fontSize:11,color:'#555C70',marginBottom:16}}>Win rate & P&L par direction</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          {[
            {label:'LONG', icon:'↑', wr:s.longWR,  pnl:s.longPnL,  count:s.longs,  c:'#22C759', bdr:'rgba(34,199,89,0.2)'},
            {label:'SHORT',icon:'↓', wr:s.shortWR, pnl:s.shortPnL, count:s.shorts, c:'#FF3B30', bdr:'rgba(255,59,48,0.2)'},
          ].map(({label,icon,wr,pnl,count,c,bdr})=>(
            <div key={label} style={{background:'rgba(255,255,255,0.02)',border:`1px solid ${bdr}`,borderRadius:12,padding:'14px 16px'}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
                <div style={{width:28,height:28,borderRadius:'50%',background:`${c}20`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,color:c}}>{icon}</div>
                <div style={{fontSize:12,fontWeight:700,color:'#F0F3FF'}}>{label} Performance</div>
              </div>
              <div style={{borderTop:`1px solid ${bdr}`,marginBottom:12}}/>
              {loading?<Skel h={40}/>:<>
                <div style={{fontSize:36,fontWeight:800,color:c,fontFamily:'JetBrains Mono, monospace',lineHeight:1}}>{wr.toFixed(1)}<span style={{fontSize:14}}>%</span></div>
                <div style={{fontSize:10,color:'#555C70',marginBottom:8}}>Win Rate · {count} trades</div>
                <div style={{display:'inline-flex',alignItems:'center',gap:6}}>
                  <span style={{fontSize:10,color:'#3D4254',background:'rgba(255,255,255,0.04)',padding:'2px 7px',borderRadius:5}}>P&L</span>
                  <span style={{fontSize:12,fontWeight:700,color:pnl>=0?'#22C759':'#FF3B30',fontFamily:'JetBrains Mono, monospace'}}>{fmtK(pnl)}</span>
                </div>
              </>}
            </div>
          ))}
        </div>
      </div>

      {/* Main + Advanced Metrics */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
        <div style={card()}>
          <div style={hl()}/>
          <div style={{fontSize:14,fontWeight:700,color:'#F0F3FF',marginBottom:16}}>Main Metrics</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            {loading?[1,2,3,4].map(i=><Skel key={i} h={80}/>):[
              {icon:'📈',value:`${s.winRate.toFixed(1)}%`,label:'Win Rate',sub:`${s.wins}W / ${s.losses}L`,c:'#22C759',bg:'rgba(34,199,89,0.08)'},
              {icon:'💲',value:fmtK(s.totalPnL),label:'Total P&L',sub:`${closed.length} trades`,c:'#00E5FF',bg:'rgba(0,229,255,0.08)'},
              {icon:'⇄',value:s.payoffRatio.toFixed(2),label:'Payoff Ratio',sub:'Gain/Perte',c:'#0A85FF',bg:'rgba(10,133,255,0.08)'},
              {icon:'💳',value:fmtK(-s.fees),label:'Fees',sub:'Total',c:'#BF5AF2',bg:'rgba(191,90,242,0.08)'},
            ].map(({icon,value,label,sub,c,bg})=>(
              <div key={label} style={{background:bg,borderRadius:10,padding:'12px 14px'}}>
                <div style={{fontSize:18,marginBottom:6}}>{icon}</div>
                <div style={{fontSize:18,fontWeight:800,color:'#F0F3FF',fontFamily:'JetBrains Mono, monospace'}}>{value}</div>
                <div style={{fontSize:11,color:'#8F94A3',marginTop:2}}>{label}</div>
                <div style={{fontSize:10,color:c,marginTop:2}}>{sub}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={card()}>
          <div style={hl()}/>
          <div style={{fontSize:14,fontWeight:700,color:'#F0F3FF',marginBottom:4}}>Advanced Metrics</div>
          <div style={{fontSize:11,color:'#555C70',marginBottom:16}}>Drawdown, Sharpe, expectancy, streaks</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            {loading?[1,2,3,4].map(i=><Skel key={i} h={80}/>):[
              {icon:'📉',value:fmtK(-s.maxDD),label:'Max Drawdown',sub:'Max loss',c:'#FF3B30',bg:'rgba(255,59,48,0.08)'},
              {icon:'📊',value:s.sharpe.toFixed(2),label:'Sharpe Ratio',sub:'Return/Risk',c:'#0A85FF',bg:'rgba(10,133,255,0.08)'},
              {icon:'🎯',value:fmtK(s.expectancy),label:'Expectancy',sub:'Avg gain/trade',c:'#00E5FF',bg:'rgba(0,229,255,0.08)'},
              {icon:'🔥',value:String(s.bestStreak),label:'Best Streak',sub:`${s.worstStreak} max losses`,c:'#FF9500',bg:'rgba(255,149,0,0.08)'},
            ].map(({icon,value,label,sub,c,bg})=>(
              <div key={label} style={{background:bg,borderRadius:10,padding:'12px 14px'}}>
                <div style={{fontSize:18,marginBottom:6}}>{icon}</div>
                <div style={{fontSize:18,fontWeight:800,color:'#F0F3FF',fontFamily:'JetBrains Mono, monospace'}}>{value}</div>
                <div style={{fontSize:11,color:'#8F94A3',marginTop:2}}>{label}</div>
                <div style={{fontSize:10,color:c,marginTop:2}}>{sub}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Heatmap Calendrier */}
      <div style={{...card(),marginBottom:16}}>
        <div style={hl()}/>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
          <div>
            <div style={{fontSize:14,fontWeight:700,color:'#F0F3FF'}}>Heatmap</div>
            <div style={{fontSize:11,color:'#555C70'}}>Résultat (P&L)</div>
          </div>
          <div style={{display:'flex',gap:6}}>
            {['7j','1M','3M','6M','1A'].map(p=>(
              <button key={p} onClick={()=>setPeriod(p)} style={{padding:'4px 12px',borderRadius:20,fontSize:11,fontWeight:600,cursor:'pointer',
                border:`1px solid ${period===p?'#0A85FF':'#2A2F3E'}`,
                background:period===p?'rgba(10,133,255,0.15)':'transparent',
                color:period===p?'#0A85FF':'#555C70'}}>{p}</button>
            ))}
          </div>
        </div>
        {loading?<Skel h={120}/>:<CalendarHeatmap trades={trades} period={period}/>}
        {!loading&&<div style={{display:'flex',gap:8,marginTop:12,alignItems:'center',justifyContent:'flex-end'}}>
          <div style={{width:8,height:8,borderRadius:2,background:'#22C759'}}/><span style={{fontSize:10,color:'#555C70'}}>Gains</span>
          <div style={{width:8,height:8,borderRadius:2,background:'#FF3B30',marginLeft:8}}/><span style={{fontSize:10,color:'#555C70'}}>Pertes</span>
        </div>}
      </div>

      {/* Advanced Analytics */}
      <div style={{...card(),marginBottom:16}}>
        <div style={hl()}/>
        <div style={{fontSize:14,fontWeight:700,color:'#F0F3FF',marginBottom:4}}>Advanced Analytics</div>
        <div style={{fontSize:11,color:'#555C70',marginBottom:16}}>Performance par mois</div>
        {loading?<Skel h={100}/>:<MonthlyChart trades={trades}/>}
      </div>

      {/* Emotions */}
      {(emo||loading)&&(
        <div style={{...card(),marginBottom:16}}>
          <div style={hl()}/>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
            <div style={{width:32,height:32,borderRadius:'50%',background:'rgba(191,90,242,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>💜</div>
            <div style={{fontSize:14,fontWeight:700,color:'#F0F3FF'}}>Emotional Summary</div>
          </div>
          {loading?<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>{[1,2,3,4].map(i=><Skel key={i} h={80}/>)}</div>:emo&&(
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              {[
                {tag:'AVERAGE STATE',  icon:'✅',value:emo.avgState,sub:`${emo.entries} entries`,     c:'#22C759',bg:'rgba(34,199,89,0.06)',  bdr:'rgba(34,199,89,0.15)'},
                {tag:'EMOTION IMPACT', icon:'⊜', value:emo.impact,  sub:'Correlation P&L',            c:'#8F94A3',bg:'rgba(255,255,255,0.02)',bdr:'#1E2330'},
                {tag:'EMOTIONAL RISK', icon:'⚠️',value:emo.risk,    sub:emo.consec>0?`${emo.consec} pertes consécutives`:'Aucune série',c:'#FF9500',bg:'rgba(255,149,0,0.06)',bdr:'rgba(255,149,0,0.15)'},
                {tag:'AI ADVICE',      icon:'▶', value:emo.advice,  sub:'Recommandation',             c:'#22C759',bg:'rgba(34,199,89,0.06)',  bdr:'rgba(34,199,89,0.15)'},
              ].map(({tag,icon,value,sub,c,bg,bdr})=>(
                <div key={tag} style={{background:bg,border:`1px solid ${bdr}`,borderRadius:12,padding:'12px 14px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8}}>
                    <span style={{fontSize:12}}>{icon}</span>
                    <span style={{fontSize:9,fontWeight:700,color:'#555C70',letterSpacing:'0.08em'}}>{tag}</span>
                  </div>
                  <div style={{fontSize:16,fontWeight:700,color:'#F0F3FF',marginBottom:4}}>{value}</div>
                  <div style={{fontSize:10,color:c}}>{sub}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Récents + Stats */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        <div style={card()}>
          <div style={hl()}/>
          <div style={{fontSize:13,fontWeight:600,color:'#F0F3FF',marginBottom:14}}>Trades récents</div>
          {loading?<div style={{display:'flex',flexDirection:'column',gap:8}}>{[1,2,3].map(i=><Skel key={i} h={44}/>)}</div>:recent.length===0?(
            <div style={{textAlign:'center',padding:'24px 0',color:'#3D4254',fontSize:13}}>Aucun trade</div>
          ):(
            <div style={{display:'flex',flexDirection:'column',gap:4}}>
              {recent.map(t=>{
                const pnl=tradePnL(t)
                return(<div key={t.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',borderRadius:10,background:'rgba(255,255,255,0.02)'}}>
                  <div style={{width:28,height:28,borderRadius:8,background:t.type==='Long'?'rgba(34,199,89,0.1)':'rgba(255,59,48,0.1)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,flexShrink:0}}>{t.type==='Long'?'↑':'↓'}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,color:'#F0F3FF',fontFamily:'JetBrains Mono, monospace'}}>{t.symbol}</div>
                    <div style={{fontSize:10,color:'#555C70'}}>{fmtDate(t.date)} · <span style={{color:systemColor(t.systemId)}}>{systemName(t.systemId)}</span></div>
                  </div>
                  {t.status==='open'?(<div style={{fontSize:10,fontWeight:600,color:'#FF9500',background:'rgba(255,149,0,0.1)',padding:'2px 7px',borderRadius:5}}>OUVERT</div>):(<div style={{fontSize:12,fontWeight:700,color:pnl>=0?'#22C759':'#FF3B30',fontFamily:'JetBrains Mono, monospace'}}>{fmtK(pnl)}</div>)}
                </div>)
              })}
            </div>
          )}
        </div>
        <div style={card()}>
          <div style={hl()}/>
          <div style={{fontSize:13,fontWeight:600,color:'#F0F3FF',marginBottom:14}}>Statistiques</div>
          {loading?<div style={{display:'flex',flexDirection:'column',gap:10}}>{[1,2,3,4,5].map(i=><Skel key={i}/>)}</div>:(
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {[
                {label:'Trades fermés',  value:closed.length,              c:'#F0F3FF'},
                {label:'Gain moyen',     value:`+$${fmt(s.avgWin)}`,       c:'#22C759'},
                {label:'Perte moyenne',  value:`-$${fmt(s.avgLoss)}`,      c:'#FF3B30'},
                {label:'Série gagnante', value:`${s.bestStreak} trades`,   c:'#FF9500'},
                {label:'Série perdante', value:`${s.worstStreak} trades`,  c:'#FF3B30'},
                {label:'Streak actuel',  value:s.currentStreak>0?`+${s.currentStreak} wins`:`${Math.abs(s.currentStreak)} losses`, c:s.currentStreak>0?'#22C759':'#FF3B30'},
              ].map(({label,value,c})=>(
                <div key={label} style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{fontSize:12,color:'#8F94A3'}}>{label}</span>
                  <span style={{fontSize:13,fontWeight:600,color:c,fontFamily:'JetBrains Mono, monospace'}}>{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
