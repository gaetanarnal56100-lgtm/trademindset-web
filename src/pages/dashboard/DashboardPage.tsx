// DashboardPage.tsx — Dashboard enrichi v2 (heatmap compact + interactif + analytics tabs)
import { useState, useEffect, useRef, useMemo } from 'react'
import { subscribeTrades, subscribeSystems, subscribeMoods, tradePnL, type Trade, type TradingSystem, type MoodEntry } from '@/services/firestore'
import PnLCurve from './PnLModal'

// ── Helpers ──────────────────────────────────────────────────────────────
function safeTime(d: any): number {
  if (!d) return 0
  if (typeof d?.getTime === 'function') { const t = d.getTime(); return isNaN(t) ? 0 : t }
  if (typeof d?.seconds === 'number') return d.seconds * 1000
  if (typeof d === 'number') return d
  return 0
}

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

// ── Statistics ────────────────────────────────────────────────────────────
function calcStats(trades: Trade[]) {
  const closed = trades.filter(t=>t.status==='closed').sort((a,b)=>safeTime(a.date)-safeTime(b.date))
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
  return{totalPnL,winRate,avgWin,avgLoss,payoffRatio,expectancy,fees,maxDD,sharpe,
    bestStreak,worstStreak:Math.abs(worstStreak),currentStreak,
    wins:wins.length,losses:losses.length,total:closed.length,
    longs:longs.length,shorts:shorts.length,longWR,shortWR,
    longPnL:lp.reduce((a,b)=>a+b,0),shortPnL:sp.reduce((a,b)=>a+b,0)}
}

// ── Emotion helpers ───────────────────────────────────────────────────────
function emotionScore(state: string): number {
  const m: Record<string,number>={'Confiant':4,'Serein':4,'Focused':4,'Disciplined':4,'Neutre':3,'Neutral':3,'Stressé':2,'Anxieux':2,'Fatigué':2,'Stressed':2,'FOMO':1,'Impulsif':1,'Frustré':1}
  return m[state]??3
}
function calcEmotions(moods: MoodEntry[], trades: Trade[]) {
  if(!moods.length)return null
  const avg=moods.reduce((a,m)=>a+emotionScore(m.state),0)/moods.length
  const avgState=avg>=3.5?'Confiant':avg>=2.5?'Neutre':avg>=1.5?'Stressé':'Impulsif'
  const sorted=[...trades].filter(t=>t.status==='closed').sort((a,b)=>safeTime(b.date)-safeTime(a.date))
  let consec=0;for(const t of sorted){if(tradePnL(t)<0)consec++;else break}
  const risk=consec>=3?'Élevé':consec>=2?'Prudence':'Faible'
  const impact=avg>=3.5?'Positif':avg>=2.5?'Neutre':'Négatif'
  const advice=consec>=3?'Pause recommandée':avg>=3.5?'Continuer':'Réduire la taille'
  return{avgState,risk,impact,advice,consec,entries:moods.length}
}

// ── Adaptive Calendar Heatmap with tooltip ────────────────────────────────
function CalendarHeatmap({trades,period}:{trades:Trade[],period:string}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [cellSize, setCellSize] = useState(16)
  const [tooltip,setTooltip]=useState<{key:string,pnl:number,date:Date,count:number,symbols:string[],left:number,top:number}|null>(null)

  const days=period==='7j'?7:period==='1M'?30:period==='3M'?90:period==='6M'?180:365
  const since=new Date(Date.now()-days*86400000)

  // Compute cell size from container width
  useEffect(()=>{
    const el=containerRef.current;if(!el)return
    const gap=3
    const obs=new ResizeObserver(entries=>{
      const w=entries[0].contentRect.width
      const sz=Math.floor((w-(6*gap))/7)
      setCellSize(Math.max(10,Math.min(sz,28)))
    })
    obs.observe(el)
    const w=el.getBoundingClientRect().width
    const sz=Math.floor((w-18)/7)
    setCellSize(Math.max(10,Math.min(sz,28)))
    return()=>obs.disconnect()
  },[])

  const byDay=useMemo(()=>{
    const map: Record<string,{pnl:number,count:number,symbols:string[]}>={}
    for(const t of trades.filter(t=>t.status==='closed'&&t.date>=since)){
      const k=t.date.toISOString().slice(0,10)
      if(!map[k])map[k]={pnl:0,count:0,symbols:[]}
      map[k].pnl+=tradePnL(t);map[k].count++;
      if(!map[k].symbols.includes(t.symbol))map[k].symbols.push(t.symbol)
    }
    return map
  },[trades,days])

  const maxAbs=Math.max(...Object.values(byDay).map(d=>Math.abs(d.pnl)),1)
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

  const allValues=Object.entries(byDay)
  const bestKey=allValues.length?allValues.reduce((a,b)=>b[1].pnl>a[1].pnl?b:a)[0]:null
  const worstKey=allValues.length?allValues.reduce((a,b)=>b[1].pnl<a[1].pnl?b:a)[0]:null
  const gap=3
  const fs=Math.max(8,Math.min(cellSize-4,11))

  return(
    <div ref={containerRef} style={{position:'relative',width:'100%'}}>
      {/* Day labels */}
      <div style={{display:'grid',gridTemplateColumns:`repeat(7,${cellSize}px)`,gap:gap,marginBottom:4}}>
        {['D','L','M','M','J','V','S'].map((l,i)=>(
          <div key={i} style={{fontSize:fs-1,color:'#555C70',textAlign:'center',fontWeight:600,lineHeight:`${cellSize}px`}}>{l}</div>
        ))}
      </div>
      {/* Grid */}
      <div style={{display:'grid',gridTemplateColumns:`repeat(7,${cellSize}px)`,gap:gap}}>
        {cells.map(({date,key,inRange})=>{
          const data=byDay[key];const pnl=data?.pnl
          const intensity=pnl!=null?Math.min(Math.abs(pnl)/maxAbs,1):0
          const isToday=date.toDateString()===today.toDateString()
          const isBest=key===bestKey,isWorst=key===worstKey
          let bg='rgba(255,255,255,0.03)'
          if(inRange&&pnl!=null)bg=pnl>0?`rgba(34,199,89,${0.12+intensity*0.68})`:`rgba(255,59,48,${0.12+intensity*0.68})`
          else if(!inRange)bg='transparent'
          return(
            <div
              key={key}
              onClick={e=>{
                if(!inRange||!data)return
                const rect=(e.currentTarget as HTMLElement).getBoundingClientRect()
                setTooltip(t=>t?.key===key?null:{
                  key,pnl:data.pnl,date,count:data.count,symbols:data.symbols,
                  left:rect.left+rect.width/2,top:rect.top
                })
              }}
              style={{
                width:cellSize,height:cellSize,borderRadius:Math.max(2,cellSize/5),
                background:bg,cursor:inRange&&data?'pointer':'default',
                border:isToday?'1.5px solid rgba(255,255,255,0.3)':isBest?'1.5px solid rgba(34,199,89,0.7)':isWorst?'1.5px solid rgba(255,59,48,0.5)':'1px solid transparent',
                transition:'transform 0.1s',boxSizing:'border-box' as const,
              }}
              title={inRange&&data?`${key}: ${fmtK(pnl!)}`:undefined}
            />
          )
        })}
      </div>
      {/* Tooltip — portal-like fixed position */}
      {tooltip&&(
        <>
          <div style={{position:'fixed',inset:0,zIndex:49}} onClick={()=>setTooltip(null)}/>
          <div style={{
            position:'fixed',
            left:Math.min(tooltip.left-90,window.innerWidth-200),
            top:tooltip.top-120,
            background:'#1C2130',border:'1px solid #2A2F3E',borderRadius:12,padding:'12px 16px',
            minWidth:180,zIndex:50,boxShadow:'0 8px 32px rgba(0,0,0,0.6)',
            pointerEvents:'none',
          }}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
              <div style={{fontSize:11,color:'#8F94A3',fontWeight:600}}>
                {tooltip.date.toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'})}
              </div>
              {tooltip.key===bestKey&&<div style={{fontSize:9,fontWeight:700,color:'#22C759',background:'rgba(34,199,89,0.15)',padding:'2px 7px',borderRadius:10}}>Best</div>}
              {tooltip.key===worstKey&&<div style={{fontSize:9,fontWeight:700,color:'#FF3B30',background:'rgba(255,59,48,0.15)',padding:'2px 7px',borderRadius:10}}>Worst</div>}
            </div>
            <div style={{fontSize:22,fontWeight:800,color:tooltip.pnl>=0?'#22C759':'#FF3B30',fontFamily:'JetBrains Mono, monospace',marginBottom:4}}>{fmtK(tooltip.pnl)}</div>
            <div style={{fontSize:11,color:'#555C70'}}>{tooltip.count} trade{tooltip.count!==1?'s':''}{tooltip.symbols.length>0?' · '+tooltip.symbols.slice(0,3).join(', '):''}</div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Time Range type ───────────────────────────────────────────────────────
interface TimeRange { id: string; name: string; startHour: number; endHour: number }

// ── Advanced Analytics Panel ──────────────────────────────────────────────
function AdvancedAnalytics({trades}:{trades:Trade[]}) {
  const [tab,setTab]=useState<'analytics'|'metrics'|'calendar'>('analytics')
  const [metricsTab,setMetricsTab]=useState<'month'|'session'|'hour'|'day'>('month')
  const [sessionRanges,setSessionRanges]=useState<TimeRange[]>([
    {id:'a',name:'Asie',     startHour:0,  endHour:8},
    {id:'l',name:'Londres',  startHour:8,  endHour:16},
    {id:'n',name:'New York', startHour:13, endHour:21},
  ])
  const [hourRanges,setHourRanges]=useState<TimeRange[]>([
    {id:'h1',name:'Matin',      startHour:6,  endHour:9},
    {id:'h2',name:'Milieu',     startHour:9,  endHour:12},
    {id:'h3',name:'Après-midi', startHour:12, endHour:15},
    {id:'h4',name:'Fin journée',startHour:15, endHour:18},
  ])
  const [editing,setEditing]=useState<'session'|'hour'|null>(null)
  const [editDraft,setEditDraft]=useState<TimeRange[]>([])

  const closed=useMemo(()=>trades.filter(t=>t.status==='closed'),[trades])

  // Monthly
  const months=useMemo(()=>{
    const map: Record<string,number>={}
    for(const t of closed){const k=t.date.toLocaleDateString('fr-FR',{month:'short'});map[k]=(map[k]||0)+tradePnL(t)}
    const order=['jan.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.']
    return order.filter(m=>map[m]!=null).map(m=>({label:m[0].toUpperCase(),full:m,value:map[m]!}))
  },[closed])
  const maxAbsM=Math.max(...months.map(m=>Math.abs(m.value)),1)
  const bestM=months.length?months.reduce((a,b)=>b.value>a.value?b:a,months[0]).value:0
  const worstM=months.length?months.reduce((a,b)=>b.value<a.value?b:a,months[0]).value:0
  const avgM=months.length?months.reduce((a,b)=>a+b.value,0)/months.length:0

  // By range (session/hour)
  function calcRange(ranges: TimeRange[]) {
    return ranges.map(r=>{
      const rt=closed.filter(t=>{const h=t.date.getHours();return h>=r.startHour&&h<r.endHour})
      return{...r,pnl:rt.reduce((a,t)=>a+tradePnL(t),0),count:rt.length}
    })
  }
  const sessionData=useMemo(()=>calcRange(sessionRanges),[closed,sessionRanges])
  const hourData=useMemo(()=>calcRange(hourRanges),[closed,hourRanges])

  // By day of week
  const dayData=useMemo(()=>{
    const days=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim']
    return days.map((name,i)=>{
      const dt=closed.filter(t=>{const d=t.date.getDay();return (d===0?6:d-1)===i})
      return{name,pnl:dt.reduce((a,t)=>a+tradePnL(t),0),count:dt.length}
    })
  },[closed])

  function TabBtn({id,label}:{id:typeof tab,label:string}) {
    const active=tab===id
    return<button onClick={()=>setTab(id)} style={{padding:'8px 16px',borderRadius:20,fontSize:12,fontWeight:600,cursor:'pointer',
      border:`1px solid ${active?'transparent':'#2A2F3E'}`,
      background:active?'linear-gradient(135deg,#6B3FE7,#BF5AF2)':'transparent',
      color:active?'#fff':'#555C70'}}>{label}</button>
  }

  function MetricsTabBtn({id,label}:{id:typeof metricsTab,label:string}) {
    const active=metricsTab===id
    return<button onClick={()=>setMetricsTab(id)} style={{padding:'5px 12px',borderRadius:20,fontSize:11,fontWeight:600,cursor:'pointer',
      border:`1px solid ${active?'#0A85FF':'#2A2F3E'}`,
      background:active?'rgba(10,133,255,0.15)':'transparent',
      color:active?'#0A85FF':'#555C70'}}>{label}</button>
  }

  function RangeCard({r}:{r:{name:string,pnl:number,count:number,startHour?:number,endHour?:number}}) {
    return(
      <div style={{background:'rgba(255,255,255,0.02)',border:`1px solid ${r.pnl>=0?'rgba(34,199,89,0.2)':'rgba(255,59,48,0.1)'}`,borderRadius:12,padding:'12px 14px'}}>
        <div style={{fontSize:11,color:'#8F94A3',marginBottom:4,fontWeight:600}}>{r.name}</div>
        {r.startHour!=null&&<div style={{fontSize:9,color:'#3D4254',marginBottom:8}}>{String(r.startHour).padStart(2,'0')}h–{String(r.endHour).padStart(2,'0')}h</div>}
        <div style={{fontSize:18,fontWeight:800,color:r.pnl>=0?'#22C759':'#FF3B30',fontFamily:'JetBrains Mono, monospace'}}>{fmtK(r.pnl)}</div>
        {r.count>0&&<div style={{fontSize:10,color:'#555C70',marginTop:4}}>{r.count} trade{r.count!==1?'s':''}</div>}
      </div>
    )
  }

  function EditModal({type}:{type:'session'|'hour'}) {
    return(
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:100,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setEditing(null)}>
        <div onClick={e=>e.stopPropagation()} style={{background:'#161B22',border:'1px solid #2A2F3E',borderRadius:16,padding:'20px',minWidth:320,maxWidth:400}}>
          <div style={{fontSize:14,fontWeight:700,color:'#F0F3FF',marginBottom:16}}>Modifier les plages</div>
          <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:16}}>
            {editDraft.map((r,i)=>(
              <div key={r.id} style={{display:'flex',gap:8,alignItems:'center'}}>
                <input value={r.name} onChange={e=>{const d=[...editDraft];d[i]={...d[i],name:e.target.value};setEditDraft(d)}}
                  style={{flex:1,background:'#1C2130',border:'1px solid #2A2F3E',borderRadius:8,padding:'6px 10px',color:'#F0F3FF',fontSize:12}}/>
                <input type="number" min="0" max="23" value={r.startHour} onChange={e=>{const d=[...editDraft];d[i]={...d[i],startHour:+e.target.value};setEditDraft(d)}}
                  style={{width:50,background:'#1C2130',border:'1px solid #2A2F3E',borderRadius:8,padding:'6px 8px',color:'#F0F3FF',fontSize:12,textAlign:'center'}}/>
                <span style={{color:'#555C70',fontSize:11}}>→</span>
                <input type="number" min="0" max="24" value={r.endHour} onChange={e=>{const d=[...editDraft];d[i]={...d[i],endHour:+e.target.value};setEditDraft(d)}}
                  style={{width:50,background:'#1C2130',border:'1px solid #2A2F3E',borderRadius:8,padding:'6px 8px',color:'#F0F3FF',fontSize:12,textAlign:'center'}}/>
                <button onClick={()=>setEditDraft(editDraft.filter((_,j)=>j!==i))}
                  style={{background:'rgba(255,59,48,0.1)',border:'none',borderRadius:6,color:'#FF3B30',cursor:'pointer',padding:'4px 8px',fontSize:12}}>✕</button>
              </div>
            ))}
          </div>
          <button onClick={()=>setEditDraft([...editDraft,{id:Date.now().toString(),name:'',startHour:0,endHour:4}])}
            style={{width:'100%',padding:'8px',background:'rgba(10,133,255,0.1)',border:'1px dashed #2A2F3E',borderRadius:8,color:'#0A85FF',cursor:'pointer',fontSize:12,marginBottom:12}}>+ Ajouter</button>
          <div style={{display:'flex',gap:8}}>
            <button onClick={()=>setEditing(null)} style={{flex:1,padding:'8px',background:'transparent',border:'1px solid #2A2F3E',borderRadius:8,color:'#555C70',cursor:'pointer',fontSize:12}}>Annuler</button>
            <button onClick={()=>{
              if(type==='session')setSessionRanges(editDraft)
              else setHourRanges(editDraft)
              setEditing(null)
            }} style={{flex:1,padding:'8px',background:'rgba(10,133,255,0.15)',border:'1px solid #0A85FF',borderRadius:8,color:'#0A85FF',cursor:'pointer',fontSize:12,fontWeight:600}}>Sauvegarder</button>
          </div>
        </div>
      </div>
    )
  }

  return(
    <div style={card()}>
      <div style={hl()}/>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
        <div>
          <div style={{fontSize:14,fontWeight:700,color:'#F0F3FF'}}>Advanced Analytics</div>
          <div style={{fontSize:11,color:'#555C70'}}>Analyse de performance en détail</div>
        </div>
      </div>
      {/* Main tabs */}
      <div style={{display:'flex',gap:8,marginBottom:16}}>
        <TabBtn id="analytics" label="📊 Analytics"/>
        <TabBtn id="metrics"   label="🕐 Metrics"/>
        <TabBtn id="calendar"  label="📅 Calendar"/>
      </div>

      {tab==='analytics'&&(
        <div>
          <div style={{fontSize:13,fontWeight:600,color:'#F0F3FF',marginBottom:12}}>Performance par Mois</div>
          {months.length===0?<div style={{textAlign:'center',color:'#3D4254',fontSize:12,padding:'20px 0'}}>Pas de données</div>:(
            <>
              <div style={{display:'flex',alignItems:'flex-end',gap:3,height:80,marginBottom:8}}>
                {months.map((m,i)=>{
                  const h=Math.max((Math.abs(m.value)/maxAbsM)*72,3),c=m.value>=0?'#22C759':'#FF3B30'
                  return(<div key={i} title={`${m.full}: ${fmtK(m.value)}`} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2,cursor:'pointer'}}>
                    <div style={{width:'100%',height:h,background:c,borderRadius:'3px 3px 0 0',opacity:0.85,transition:'opacity 0.15s'}}/>
                    <div style={{fontSize:8,color:'#3D4254'}}>{m.label}</div>
                  </div>)
                })}
              </div>
              <div style={{display:'flex',gap:8}}>
                {[{l:'Meilleur',v:fmtK(bestM),c:'#22C759'},{l:'Pire',v:fmtK(worstM),c:'#FF3B30'},{l:'Moyenne',v:fmtK(avgM),c:'#8F94A3'}].map(({l,v,c})=>(
                  <div key={l} style={{flex:1,background:'rgba(255,255,255,0.02)',borderRadius:8,padding:'6px 8px',textAlign:'center'}}>
                    <div style={{fontSize:9,color:'#555C70',marginBottom:2}}>{l}</div>
                    <div style={{fontSize:11,fontWeight:700,color:c,fontFamily:'JetBrains Mono, monospace'}}>{v}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab==='metrics'&&(
        <div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:16}}>
            <MetricsTabBtn id="month"   label="Par mois"/>
            <MetricsTabBtn id="session" label="Par session"/>
            <MetricsTabBtn id="hour"    label="Par heure"/>
            <MetricsTabBtn id="day"     label="Par jour"/>
          </div>

          {metricsTab==='month'&&(
            <div>
              {months.length===0?<div style={{textAlign:'center',color:'#3D4254',fontSize:12,padding:'20px 0'}}>Pas de données</div>:(
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {months.map((m,i)=>{
                    const pct=Math.abs(m.value)/maxAbsM*100
                    return(<div key={i} style={{display:'flex',alignItems:'center',gap:10}}>
                      <div style={{width:28,fontSize:11,color:'#8F94A3',textAlign:'right'}}>{m.full.slice(0,3)}</div>
                      <div style={{flex:1,height:8,background:'#1C2130',borderRadius:4,overflow:'hidden'}}>
                        <div style={{height:'100%',width:`${pct}%`,background:m.value>=0?'#22C759':'#FF3B30',borderRadius:4}}/>
                      </div>
                      <div style={{width:80,fontSize:11,fontWeight:700,color:m.value>=0?'#22C759':'#FF3B30',fontFamily:'JetBrains Mono, monospace',textAlign:'right'}}>{fmtK(m.value)}</div>
                    </div>)
                  })}
                </div>
              )}
            </div>
          )}

          {metricsTab==='session'&&(
            <div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:'#F0F3FF'}}>Performance par Session</div>
                  <div style={{fontSize:10,color:'#555C70'}}>Asie / Londres / New York • Personnalisable</div>
                </div>
                <button onClick={()=>{setEditDraft([...sessionRanges]);setEditing('session')}}
                  style={{display:'flex',alignItems:'center',gap:5,padding:'5px 12px',borderRadius:8,background:'rgba(10,133,255,0.1)',border:'1px solid rgba(10,133,255,0.3)',color:'#0A85FF',cursor:'pointer',fontSize:11,fontWeight:600}}>
                  ⚙ Modifier
                </button>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:10}}>
                {sessionData.map(r=><RangeCard key={r.id} r={r}/>)}
                <div onClick={()=>{setEditDraft([...sessionRanges,{id:Date.now().toString(),name:'',startHour:0,endHour:4}]);setEditing('session')}}
                  style={{background:'transparent',border:'1px dashed #2A2F3E',borderRadius:12,padding:'12px 14px',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6,minHeight:80}}>
                  <div style={{width:28,height:28,borderRadius:'50%',background:'rgba(10,133,255,0.15)',display:'flex',alignItems:'center',justifyContent:'center',color:'#0A85FF',fontSize:16}}>+</div>
                  <div style={{fontSize:11,color:'#555C70',fontWeight:600}}>Add Session</div>
                </div>
              </div>
            </div>
          )}

          {metricsTab==='hour'&&(
            <div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:'#F0F3FF'}}>Performance by Hour</div>
                  <div style={{fontSize:10,color:'#555C70'}}>Customizable ranges • Add your time slots</div>
                </div>
                <button onClick={()=>{setEditDraft([...hourRanges]);setEditing('hour')}}
                  style={{display:'flex',alignItems:'center',gap:5,padding:'5px 12px',borderRadius:8,background:'rgba(10,133,255,0.1)',border:'1px solid rgba(10,133,255,0.3)',color:'#0A85FF',cursor:'pointer',fontSize:11,fontWeight:600}}>
                  ⚙ Modify
                </button>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:10}}>
                {hourData.map(r=><RangeCard key={r.id} r={r}/>)}
                <div onClick={()=>{setEditDraft([...hourRanges,{id:Date.now().toString(),name:'',startHour:0,endHour:4}]);setEditing('hour')}}
                  style={{background:'transparent',border:'1px dashed #2A2F3E',borderRadius:12,padding:'12px 14px',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6,minHeight:80}}>
                  <div style={{width:28,height:28,borderRadius:'50%',background:'rgba(10,133,255,0.15)',display:'flex',alignItems:'center',justifyContent:'center',color:'#0A85FF',fontSize:16}}>+</div>
                  <div style={{fontSize:11,color:'#555C70',fontWeight:600}}>Add Hour range</div>
                </div>
              </div>
            </div>
          )}

          {metricsTab==='day'&&(
            <div>
              <div style={{fontSize:13,fontWeight:700,color:'#F0F3FF',marginBottom:4}}>Performance by Day</div>
              <div style={{fontSize:10,color:'#555C70',marginBottom:12}}>Lundi → Dimanche</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
                {dayData.map(r=><RangeCard key={r.name} r={r}/>)}
              </div>
            </div>
          )}
        </div>
      )}

      {tab==='calendar'&&(
        <div>
          <div style={{fontSize:13,fontWeight:600,color:'#F0F3FF',marginBottom:12}}>Calendrier de Performance</div>
          <CalendarHeatmap trades={trades} period="1M"/>
        </div>
      )}
      {editing&&<EditModal type={editing}/>}
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────
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
  const recent=[...trades].sort((a,b)=>safeTime(b.date)-safeTime(a.date)).slice(0,6)
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

      {/* Heatmap compact */}
      <div style={{...card(),marginBottom:16}}>
        <div style={hl()}/>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
          <div>
            <div style={{fontSize:14,fontWeight:700,color:'#F0F3FF'}}>Heatmap</div>
            <div style={{fontSize:11,color:'#555C70'}}>Résultat (P&L) · Cliquez sur un jour</div>
          </div>
          <div style={{display:'flex',gap:5}}>
            {['7j','1M','3M','6M','1A'].map(p=>(
              <button key={p} onClick={()=>setPeriod(p)} style={{padding:'4px 10px',borderRadius:20,fontSize:11,fontWeight:600,cursor:'pointer',
                border:`1px solid ${period===p?'#0A85FF':'#2A2F3E'}`,
                background:period===p?'rgba(10,133,255,0.15)':'transparent',
                color:period===p?'#0A85FF':'#555C70'}}>{p}</button>
            ))}
          </div>
        </div>
        <div data-heatmap style={{position:'relative'}}>
          {loading?<Skel h={80}/>:<CalendarHeatmap trades={trades} period={period}/>}
        </div>
        {!loading&&<div style={{display:'flex',gap:8,marginTop:10,alignItems:'center',justifyContent:'flex-end'}}>
          <div style={{width:8,height:8,borderRadius:2,background:'#22C759'}}/><span style={{fontSize:10,color:'#555C70'}}>Gains</span>
          <div style={{width:8,height:8,borderRadius:2,background:'#FF3B30',marginLeft:8}}/><span style={{fontSize:10,color:'#555C70'}}>Pertes</span>
        </div>}
      </div>

      {/* Advanced Analytics avec onglets */}
      <div style={{marginBottom:16}}>
        <AdvancedAnalytics trades={trades}/>
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
