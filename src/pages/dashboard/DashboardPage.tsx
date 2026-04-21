// DashboardPage.tsx — Dashboard enrichi v2 (heatmap compact + interactif + analytics tabs)
import { motion } from 'framer-motion'
import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { subscribeTrades, subscribeSystems, subscribeMoods, tradePnL, type Trade, type TradingSystem, type MoodEntry } from '@/services/firestore'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/services/firebase/config'
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
  return { background:'rgba(8,12,22,0.85)', border:'1px solid rgba(0,229,255,0.12)', borderRadius:16, padding:'18px 20px', position:'relative' as const, overflow:'hidden', backdropFilter:'blur(12px)', boxShadow:'0 0 30px rgba(0,229,255,0.04), inset 0 1px 0 rgba(0,229,255,0.08)', ...extra }
}
function hl() {
  return { position:'absolute' as const, top:0, left:0, right:0, height:1, background:'linear-gradient(90deg,transparent,rgba(0,229,255,0.4),transparent)' }
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
  const m: Record<string,number>={'confident':4,'calm':4,'focused':4,'excited':3,'stressed':2,'impatient':2,'fearful':1,'greedy':2,'frustrated':1,'distracted':2}
  return m[state]??3
}
function calcEmotions(moods: MoodEntry[], trades: Trade[]) {
  if(!moods.length)return null
  const avg=moods.reduce((a,m)=>a+emotionScore(m.emotionalState),0)/moods.length
  const avgState=avg>=3.5?'dashboard.confident':avg>=2.5?'dashboard.neutral':avg>=1.5?'dashboard.stressed':'dashboard.impulsive'
  const sorted=[...trades].filter(t=>t.status==='closed').sort((a,b)=>safeTime(b.date)-safeTime(a.date))
  let consec=0;for(const t of sorted){if(tradePnL(t)<0)consec++;else break}
  const risk=consec>=3?'dashboard.riskHigh':consec>=2?'dashboard.riskCaution':'dashboard.riskLow'
  const impact=avg>=3.5?'dashboard.positive':avg>=2.5?'dashboard.neutral':'dashboard.negative'
  const advice=consec>=3?'dashboard.pauseRecommended':avg>=3.5?'dashboard.continue':'dashboard.reduceSize'
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
      {/* Multi-month layout for 3M+ */}
      {days >= 90 ? (
        <MonthGrid byDay={byDay} since={since} today={today} maxAbs={maxAbs} bestKey={bestKey} worstKey={worstKey} setTooltip={setTooltip} tooltip={tooltip} days={days} />
      ) : (
        <>
          {/* Day labels */}
          <div style={{display:'grid',gridTemplateColumns:`repeat(7,${cellSize}px)`,gap:gap,marginBottom:4}}>
            {['D','L','M','M','J','V','S'].map((l,i)=>(
              <div key={i} style={{fontSize:fs-1,color:'var(--tm-text-muted)',textAlign:'center',fontWeight:600,lineHeight:`${cellSize}px`}}>{l}</div>
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
                    setTooltip(t=>t?.key===key?null:{key,pnl:data.pnl,date,count:data.count,symbols:data.symbols,left:rect.left+rect.width/2,top:rect.top})
                  }}
                  style={{width:cellSize,height:cellSize,borderRadius:Math.max(2,cellSize/5),background:bg,cursor:inRange&&data?'pointer':'default',
                    border:isToday?'1.5px solid rgba(255,255,255,0.3)':isBest?'1.5px solid rgba(var(--tm-profit-rgb,34,199,89),0.7)':isWorst?'1.5px solid rgba(var(--tm-loss-rgb,255,59,48),0.5)':'1px solid transparent',
                    transition:'transform 0.1s',boxSizing:'border-box' as const}}
                  title={inRange&&data?`${key}: ${fmtK(pnl!)}`:undefined}
                />
              )
            })}
          </div>
        </>
      )}
      {/* Tooltip — portal-like fixed position */}
      {tooltip&&(
        <>
          <div style={{position:'fixed',inset:0,zIndex:49}} onClick={()=>setTooltip(null)}/>
          <div style={{
            position:'fixed',
            left:Math.min(tooltip.left-90,window.innerWidth-200),
            top:tooltip.top-120,
            background:'var(--tm-bg-tertiary)',border:'1px solid #2A2F3E',borderRadius:12,padding:'12px 16px',
            minWidth:180,zIndex:50,boxShadow:'0 8px 32px rgba(0,0,0,0.6)',pointerEvents:'none',
          }}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
              <div style={{fontSize:11,color:'var(--tm-text-secondary)',fontWeight:600}}>
                {tooltip.date.toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'})}
              </div>
              {tooltip.key===bestKey&&<div style={{fontSize:9,fontWeight:700,color:'var(--tm-profit)',background:'rgba(var(--tm-profit-rgb,34,199,89),0.15)',padding:'2px 7px',borderRadius:10}}>Best</div>}
              {tooltip.key===worstKey&&<div style={{fontSize:9,fontWeight:700,color:'var(--tm-loss)',background:'rgba(var(--tm-loss-rgb,255,59,48),0.15)',padding:'2px 7px',borderRadius:10}}>Worst</div>}
            </div>
            <div style={{fontSize:22,fontWeight:800,color:tooltip.pnl>=0?'var(--tm-profit)':'var(--tm-loss)',fontFamily:'JetBrains Mono, monospace',marginBottom:4}}>{fmtK(tooltip.pnl)}</div>
            <div style={{fontSize:11,color:'var(--tm-text-muted)'}}>{tooltip.count} trade{tooltip.count!==1?'s':''}{tooltip.symbols.length>0?' · '+tooltip.symbols.slice(0,3).join(', '):''}</div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Month Grid for 3M+ periods ────────────────────────────────────────────
function MonthGrid({ byDay, since, today, maxAbs, bestKey, worstKey, setTooltip, tooltip, days }:
  { byDay: Record<string,{pnl:number,count:number,symbols:string[]}>; since:Date; today:Date; maxAbs:number; bestKey:string|null; worstKey:string|null; setTooltip:any; tooltip:any; days:number }) {
  
  // Build months array
  const months: { label: string; year: number; month: number; days: { date:Date; key:string; data?:{pnl:number;count:number;symbols:string[]} }[] }[] = []
  const cur = new Date(since)
  cur.setDate(1)
  while (cur <= today || months.length === 0) {
    const m = cur.getMonth(), y = cur.getFullYear()
    const label = cur.toLocaleDateString('fr-FR', { month:'short' })
    const monthDays: typeof months[0]['days'] = []
    const d = new Date(y, m, 1)
    while (d.getMonth() === m) {
      const key = d.toISOString().slice(0, 10)
      if (d >= since && d <= today) {
        monthDays.push({ date: new Date(d), key, data: byDay[key] })
      }
      d.setDate(d.getDate() + 1)
    }
    if (monthDays.length > 0) months.push({ label, year: y, month: m, days: monthDays })
    cur.setMonth(cur.getMonth() + 1)
    cur.setDate(1)
  }

  const cellSz = days > 180 ? 11 : 14
  const gap = 2

  return (
    <div style={{ display:'flex', gap:16, overflowX:'auto', scrollbarWidth:'none', paddingBottom:4 }}>
      {months.map((month, mi) => {
        // Build a 7-column grid with proper day-of-week offset
        const firstDow = new Date(month.year, month.month, 1).getDay()
        const daysInMonth = new Date(month.year, month.month + 1, 0).getDate()
        const cells: (typeof month.days[0] | null)[] = []
        for (let i = 0; i < firstDow; i++) cells.push(null)
        for (let d = 1; d <= daysInMonth; d++) {
          const dayData = month.days.find(dd => dd.date.getDate() === d)
          if (dayData) cells.push(dayData)
          else cells.push(null)
        }
        while (cells.length % 7 !== 0) cells.push(null)

        return (
          <div key={mi} style={{ flexShrink:0 }}>
            <div style={{ fontSize:10, fontWeight:700, color:'var(--tm-text-secondary)', textAlign:'center', marginBottom:6, textTransform:'capitalize' }}>
              {month.label} {months.length > 6 ? '' : month.year}
            </div>
            {mi === 0 && (
              <div style={{ display:'grid', gridTemplateColumns:`repeat(7,${cellSz}px)`, gap, marginBottom:2 }}>
                {['D','L','M','M','J','V','S'].map((l,i)=>(
                  <div key={i} style={{ fontSize:7, color:'var(--tm-text-muted)', textAlign:'center' }}>{l}</div>
                ))}
              </div>
            )}
            <div style={{ display:'grid', gridTemplateColumns:`repeat(7,${cellSz}px)`, gap }}>
              {cells.map((cell, ci) => {
                if (!cell) return <div key={ci} style={{ width:cellSz, height:cellSz }} />
                const pnl = cell.data?.pnl
                const intensity = pnl != null ? Math.min(Math.abs(pnl) / maxAbs, 1) : 0
                const isToday = cell.date.toDateString() === today.toDateString()
                const isBest = cell.key === bestKey, isWorst = cell.key === worstKey
                let bg = 'rgba(255,255,255,0.03)'
                if (pnl != null) bg = pnl > 0 ? `rgba(34,199,89,${0.15+intensity*0.65})` : `rgba(255,59,48,${0.15+intensity*0.65})`
                return (
                  <div key={ci} onClick={e => {
                    if (!cell.data) return
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    setTooltip((t:any) => t?.key===cell.key ? null : {
                      key:cell.key, pnl:cell.data!.pnl, date:cell.date, count:cell.data!.count,
                      symbols:cell.data!.symbols, left:rect.left+rect.width/2, top:rect.top
                    })
                  }} style={{
                    width:cellSz, height:cellSz, borderRadius:2, background:bg,
                    cursor: cell.data ? 'pointer' : 'default',
                    border: isToday ? '1px solid rgba(255,255,255,0.4)' : isBest ? '1px solid rgba(var(--tm-profit-rgb,34,199,89),0.7)' : isWorst ? '1px solid rgba(var(--tm-loss-rgb,255,59,48),0.6)' : '1px solid transparent',
                  }} title={cell.data ? `${cell.key}: ${fmtK(pnl!)}` : undefined} />
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Time Range type ───────────────────────────────────────────────────────
interface TimeRange { id: string; name: string; startHour: number; endHour: number }

// ── Advanced Analytics Panel ──────────────────────────────────────────────
function AdvancedAnalytics({trades}:{trades:Trade[]}) {
  const { t } = useTranslation()
  const [tab,setTab]=useState<'analytics'|'metrics'|'calendar'>('analytics')
  const [metricsTab,setMetricsTab]=useState<'month'|'session'|'hour'|'day'>('month')
  const [sessionRanges,setSessionRanges]=useState<TimeRange[]>([
    {id:'a',name:'Asie',     startHour:0,  endHour:8},
    {id:'l',name:'Londres',  startHour:8,  endHour:16},
    {id:'n',name:'New York', startHour:13, endHour:21},
  ])
  const [hourRanges,setHourRanges]=useState<TimeRange[]>([
    {id:'h1',name:t('dashboard.morning'),        startHour:6,  endHour:9},
    {id:'h2',name:t('dashboard.midday'),         startHour:9,  endHour:12},
    {id:'h3',name:t('dashboard.afternoon'),      startHour:12, endHour:15},
    {id:'h4',name:t('dashboard.evening'),        startHour:15, endHour:18},
  ])
  const [editing,setEditing]=useState<'session'|'hour'|null>(null)
  const [editDraft,setEditDraft]=useState<TimeRange[]>([])

  const closed=useMemo(()=>trades.filter(t=>t.status==='closed'),[trades])

  // Monthly
  const months=useMemo(()=>{
    const monthNames = t('common.months', { returnObjects: true }) as string[]
    const map: Record<number,number>={}
    for(const tr of closed){const k=tr.date.getMonth();map[k]=(map[k]||0)+tradePnL(tr)}
    return Array.from({length:12},(_,i)=>i).filter(i=>map[i]!=null).map(i=>({label:monthNames[i][0].toUpperCase(),full:monthNames[i],value:map[i]!}))
  },[closed,t])
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
    const days=(t('common.daysShort',{returnObjects:true}) as string[])
    return days.map((name,i)=>{
      const dt=closed.filter(t=>{const d=t.date.getDay();return (d===0?6:d-1)===i})
      return{name,pnl:dt.reduce((a,t)=>a+tradePnL(t),0),count:dt.length}
    })
  },[closed])

  function TabBtn({id,label}:{id:typeof tab,label:string}) {
    const active=tab===id
    return<button onClick={()=>setTab(id)} style={{padding:'8px 16px',borderRadius:20,fontSize:12,fontWeight:600,cursor:'pointer',
      border:`1px solid ${active?'transparent':'var(--tm-border)'}`,
      background:active?'linear-gradient(135deg,#6B3FE7,#BF5AF2)':'transparent',
      color:active?'#fff':'var(--tm-text-muted)'}}>{label}</button>
  }

  function MetricsTabBtn({id,label}:{id:typeof metricsTab,label:string}) {
    const active=metricsTab===id
    return<button onClick={()=>setMetricsTab(id)} style={{padding:'5px 12px',borderRadius:20,fontSize:11,fontWeight:600,cursor:'pointer',
      border:`1px solid ${active?'var(--tm-blue)':'var(--tm-border)'}`,
      background:active?'rgba(var(--tm-blue-rgb,10,133,255),0.15)':'transparent',
      color:active?'var(--tm-blue)':'var(--tm-text-muted)'}}>{label}</button>
  }

  function RangeCard({r}:{r:{name:string,pnl:number,count:number,startHour?:number,endHour?:number}}) {
    return(
      <div style={{background:'rgba(255,255,255,0.02)',border:`1px solid ${r.pnl>=0?'rgba(var(--tm-profit-rgb,34,199,89),0.2)':'rgba(var(--tm-loss-rgb,255,59,48),0.1)'}`,borderRadius:12,padding:'12px 14px'}}>
        <div style={{fontSize:11,color:'var(--tm-text-secondary)',marginBottom:4,fontWeight:600}}>{r.name}</div>
        {r.startHour!=null&&<div style={{fontSize:9,color:'var(--tm-text-muted)',marginBottom:8}}>{String(r.startHour).padStart(2,'0')}h–{String(r.endHour).padStart(2,'0')}h</div>}
        <div style={{fontSize:18,fontWeight:800,color:r.pnl>=0?'var(--tm-profit)':'var(--tm-loss)',fontFamily:'JetBrains Mono, monospace'}}>{fmtK(r.pnl)}</div>
        {r.count>0&&<div style={{fontSize:10,color:'var(--tm-text-muted)',marginTop:4}}>{r.count} trade{r.count!==1?'s':''}</div>}
      </div>
    )
  }

  function EditModal({type}:{type:'session'|'hour'}) {
    return(
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:100,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setEditing(null)}>
        <div onClick={e=>e.stopPropagation()} style={{background:'var(--tm-bg-secondary)',border:'1px solid #2A2F3E',borderRadius:16,padding:'20px',minWidth:320,maxWidth:400}}>
          <div style={{fontSize:14,fontWeight:700,color:'var(--tm-text-primary)',marginBottom:16}}>{t('dashboard.editRanges')}</div>
          <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:16}}>
            {editDraft.map((r,i)=>(
              <div key={r.id} style={{display:'flex',gap:8,alignItems:'center'}}>
                <input value={r.name} onChange={e=>{const d=[...editDraft];d[i]={...d[i],name:e.target.value};setEditDraft(d)}}
                  style={{flex:1,background:'var(--tm-bg-tertiary)',border:'1px solid #2A2F3E',borderRadius:8,padding:'6px 10px',color:'var(--tm-text-primary)',fontSize:12}}/>
                <input type="number" min="0" max="23" value={r.startHour} onChange={e=>{const d=[...editDraft];d[i]={...d[i],startHour:+e.target.value};setEditDraft(d)}}
                  style={{width:50,background:'var(--tm-bg-tertiary)',border:'1px solid #2A2F3E',borderRadius:8,padding:'6px 8px',color:'var(--tm-text-primary)',fontSize:12,textAlign:'center'}}/>
                <span style={{color:'var(--tm-text-muted)',fontSize:11}}>→</span>
                <input type="number" min="0" max="24" value={r.endHour} onChange={e=>{const d=[...editDraft];d[i]={...d[i],endHour:+e.target.value};setEditDraft(d)}}
                  style={{width:50,background:'var(--tm-bg-tertiary)',border:'1px solid #2A2F3E',borderRadius:8,padding:'6px 8px',color:'var(--tm-text-primary)',fontSize:12,textAlign:'center'}}/>
                <button onClick={()=>setEditDraft(editDraft.filter((_,j)=>j!==i))}
                  style={{background:'rgba(var(--tm-loss-rgb,255,59,48),0.1)',border:'none',borderRadius:6,color:'var(--tm-loss)',cursor:'pointer',padding:'4px 8px',fontSize:12}}>✕</button>
              </div>
            ))}
          </div>
          <button onClick={()=>setEditDraft([...editDraft,{id:Date.now().toString(),name:'',startHour:0,endHour:4}])}
            style={{width:'100%',padding:'8px',background:'rgba(var(--tm-blue-rgb,10,133,255),0.1)',border:'1px dashed #2A2F3E',borderRadius:8,color:'var(--tm-blue)',cursor:'pointer',fontSize:12,marginBottom:12}}>+ {t('common.add')}</button>
          <div style={{display:'flex',gap:8}}>
            <button onClick={()=>setEditing(null)} style={{flex:1,padding:'8px',background:'transparent',border:'1px solid #2A2F3E',borderRadius:8,color:'var(--tm-text-muted)',cursor:'pointer',fontSize:12}}>{t('common.cancel')}</button>
            <button onClick={()=>{
              if(type==='session')setSessionRanges(editDraft)
              else setHourRanges(editDraft)
              setEditing(null)
            }} style={{flex:1,padding:'8px',background:'rgba(var(--tm-blue-rgb,10,133,255),0.15)',border:'1px solid #0A85FF',borderRadius:8,color:'var(--tm-blue)',cursor:'pointer',fontSize:12,fontWeight:600}}>{t('common.save')}</button>
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
          <div style={{fontSize:14,fontWeight:700,color:'var(--tm-text-primary)'}}>Advanced Analytics</div>
          <div style={{fontSize:11,color:'var(--tm-text-muted)'}}>{t('dashboard.advancedAnalyticsSubtitle')}</div>
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
          <div style={{fontSize:13,fontWeight:600,color:'var(--tm-text-primary)',marginBottom:12}}>{t('dashboard.tradingMonthPerf')}</div>
          {months.length===0?<div style={{textAlign:'center',color:'var(--tm-text-muted)',fontSize:12,padding:'20px 0'}}>{t('common.noData')}</div>:(
            <>
              <div style={{display:'flex',alignItems:'flex-end',gap:4,height:120,marginBottom:10,padding:'0 4px'}}>
                {months.map((m,i)=>{
                  const h=Math.max((Math.abs(m.value)/maxAbsM)*100,4),c=m.value>=0?'var(--tm-profit)':'var(--tm-loss)'
                  return(<div key={i} title={`${m.full}: ${fmtK(m.value)}`} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:3,cursor:'pointer',position:'relative'}}
                    onMouseEnter={e=>{const el=e.currentTarget.querySelector('[data-val]') as HTMLElement;if(el)el.style.opacity='1'}}
                    onMouseLeave={e=>{const el=e.currentTarget.querySelector('[data-val]') as HTMLElement;if(el)el.style.opacity='0'}}>
                    <div data-val="" style={{fontSize:10,fontWeight:700,color:c,fontFamily:'JetBrains Mono,monospace',opacity:0,transition:'opacity 0.15s',whiteSpace:'nowrap'}}>{fmtK(m.value)}</div>
                    <div style={{width:'100%',maxWidth:36,height:h,background:c,borderRadius:m.value>=0?'4px 4px 0 0':'0 0 4px 4px',transition:'height 0.3s'}}/>
                    <div style={{fontSize:9,color:'var(--tm-text-secondary)',fontWeight:600,textTransform:'capitalize'}}>{m.full.slice(0,3)}</div>
                  </div>)
                })}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                {[{l:t('dashboard.bestMonth'),v:fmtK(bestM),c:'var(--tm-profit)',bg:'rgba(var(--tm-profit-rgb,34,199,89),0.06)',bdr:'rgba(var(--tm-profit-rgb,34,199,89),0.15)'},
                  {l:t('dashboard.worstMonth'),v:fmtK(worstM),c:'var(--tm-loss)',bg:'rgba(var(--tm-loss-rgb,255,59,48),0.06)',bdr:'rgba(var(--tm-loss-rgb,255,59,48),0.15)'},
                  {l:t('dashboard.avgMonth'),v:fmtK(avgM),c:'var(--tm-text-secondary)',bg:'rgba(255,255,255,0.02)',bdr:'var(--tm-border-sub)'}].map(({l,v,c,bg,bdr})=>(
                  <div key={l} style={{background:bg,border:`1px solid ${bdr}`,borderRadius:10,padding:'10px 12px',textAlign:'center'}}>
                    <div style={{fontSize:9,color:'var(--tm-text-muted)',marginBottom:3,textTransform:'uppercase',letterSpacing:'0.06em'}}>{l}</div>
                    <div style={{fontSize:14,fontWeight:700,color:c,fontFamily:'JetBrains Mono, monospace'}}>{v}</div>
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
            <MetricsTabBtn id="month"   label={t('dashboard.perMonth')}/>
            <MetricsTabBtn id="session" label={t('dashboard.perSession')}/>
            <MetricsTabBtn id="hour"    label={t('dashboard.perHour')}/>
            <MetricsTabBtn id="day"     label={t('dashboard.perDay')}/>
          </div>

          {metricsTab==='month'&&(
            <div>
              {months.length===0?<div style={{textAlign:'center',color:'var(--tm-text-muted)',fontSize:12,padding:'20px 0'}}>{t('common.noData')}</div>:(
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {months.map((m,i)=>{
                    const pct=Math.abs(m.value)/maxAbsM*100
                    return(<div key={i} style={{display:'flex',alignItems:'center',gap:10}}>
                      <div style={{width:28,fontSize:11,color:'var(--tm-text-secondary)',textAlign:'right'}}>{m.full.slice(0,3)}</div>
                      <div style={{flex:1,height:8,background:'var(--tm-bg-tertiary)',borderRadius:4,overflow:'hidden'}}>
                        <div style={{height:'100%',width:`${pct}%`,background:m.value>=0?'var(--tm-profit)':'var(--tm-loss)',borderRadius:4}}/>
                      </div>
                      <div style={{width:80,fontSize:11,fontWeight:700,color:m.value>=0?'var(--tm-profit)':'var(--tm-loss)',fontFamily:'JetBrains Mono, monospace',textAlign:'right'}}>{fmtK(m.value)}</div>
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
                  <div style={{fontSize:13,fontWeight:700,color:'var(--tm-text-primary)'}}>{t('dashboard.perfBySession')}</div>
                  <div style={{fontSize:10,color:'var(--tm-text-muted)'}}>Asia / London / New York • {t('dashboard.customizable')}</div>
                </div>
                <button onClick={()=>{setEditDraft([...sessionRanges]);setEditing('session')}}
                  style={{display:'flex',alignItems:'center',gap:5,padding:'5px 12px',borderRadius:8,background:'rgba(var(--tm-blue-rgb,10,133,255),0.1)',border:'1px solid rgba(var(--tm-blue-rgb,10,133,255),0.3)',color:'var(--tm-blue)',cursor:'pointer',fontSize:11,fontWeight:600}}>
                  ⚙ {t('common.edit')}
                </button>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:10}}>
                {sessionData.map(r=><RangeCard key={r.id} r={r}/>)}
                <div onClick={()=>{setEditDraft([...sessionRanges,{id:Date.now().toString(),name:'',startHour:0,endHour:4}]);setEditing('session')}}
                  style={{background:'transparent',border:'1px dashed #2A2F3E',borderRadius:12,padding:'12px 14px',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6,minHeight:80}}>
                  <div style={{width:28,height:28,borderRadius:'50%',background:'rgba(var(--tm-blue-rgb,10,133,255),0.15)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--tm-blue)',fontSize:16}}>+</div>
                  <div style={{fontSize:11,color:'var(--tm-text-muted)',fontWeight:600}}>{t('dashboard.addSession')}</div>
                </div>
              </div>
            </div>
          )}

          {metricsTab==='hour'&&(
            <div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:'var(--tm-text-primary)'}}>{t('dashboard.perfByHour')}</div>
                  <div style={{fontSize:10,color:'var(--tm-text-muted)'}}>{t('dashboard.customizable')} • {t('dashboard.addTimeSlots')}</div>
                </div>
                <button onClick={()=>{setEditDraft([...hourRanges]);setEditing('hour')}}
                  style={{display:'flex',alignItems:'center',gap:5,padding:'5px 12px',borderRadius:8,background:'rgba(var(--tm-blue-rgb,10,133,255),0.1)',border:'1px solid rgba(var(--tm-blue-rgb,10,133,255),0.3)',color:'var(--tm-blue)',cursor:'pointer',fontSize:11,fontWeight:600}}>
                  ⚙ {t('common.edit')}
                </button>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:10}}>
                {hourData.map(r=><RangeCard key={r.id} r={r}/>)}
                <div onClick={()=>{setEditDraft([...hourRanges,{id:Date.now().toString(),name:'',startHour:0,endHour:4}]);setEditing('hour')}}
                  style={{background:'transparent',border:'1px dashed #2A2F3E',borderRadius:12,padding:'12px 14px',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6,minHeight:80}}>
                  <div style={{width:28,height:28,borderRadius:'50%',background:'rgba(var(--tm-blue-rgb,10,133,255),0.15)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--tm-blue)',fontSize:16}}>+</div>
                  <div style={{fontSize:11,color:'var(--tm-text-muted)',fontWeight:600}}>{t('dashboard.addHourRange')}</div>
                </div>
              </div>
            </div>
          )}

          {metricsTab==='day'&&(
            <div>
              <div style={{fontSize:13,fontWeight:700,color:'var(--tm-text-primary)',marginBottom:4}}>{t('dashboard.perfByDay')}</div>
              <div style={{fontSize:10,color:'var(--tm-text-muted)',marginBottom:12}}>{t('dashboard.mondayToDimanche')}</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
                {dayData.map(r=><RangeCard key={r.name} r={r}/>)}
              </div>
            </div>
          )}
        </div>
      )}

      {tab==='calendar'&&(
        <div>
          <div style={{fontSize:13,fontWeight:600,color:'var(--tm-text-primary)',marginBottom:12}}>{t('dashboard.perfCalendar')}</div>
          <CalendarHeatmap trades={trades} period="1M"/>
        </div>
      )}
      {editing&&<EditModal type={editing}/>}
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────
import ModularDashboard from './modular/ModularDashboard'

export default function DashboardPage() {
  const { t } = useTranslation()
  const [trades,  setTrades]  = useState<Trade[]>([])
  const [systems, setSystems] = useState<TradingSystem[]>([])
  const [moods,   setMoods]   = useState<MoodEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [period,  setPeriod]  = useState('1M')
  const [userCount, setUserCount] = useState<number|null>(null)
  const [activeTab, setActiveTab] = useState<'journal' | 'modular'>('journal')

  useEffect(()=>{
    const u1=subscribeTrades(t=>{setTrades(t);setLoading(false)})
    const u2=subscribeSystems(setSystems)
    const u3=subscribeMoods(setMoods)
    // Fetch total user count via Cloud Function
    const countUsers = httpsCallable<void, { count: number }>(functions, 'countUsers')
    countUsers().then(res => setUserCount(res.data.count)).catch(()=>{})
    return()=>{u1();u2();u3()}
  },[])

  const s   = useMemo(()=>calcStats(trades),[trades])
  const emo = useMemo(()=>calcEmotions(moods,trades),[moods,trades])
  const closed=trades.filter(t=>t.status==='closed')
  const open  =trades.filter(t=>t.status==='open')
  const recent=[...trades].sort((a,b)=>safeTime(b.date)-safeTime(a.date)).slice(0,6)
  const systemName =(id:string)=>systems.find(s=>s.id===id)?.name??'—'
  const systemColor=(id:string)=>systems.find(s=>s.id===id)?.color??'var(--tm-accent)'

  return(
    <div style={{padding:'28px 28px 60px',maxWidth:1600,margin:'0 auto'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:16,gap:16,flexWrap:'wrap'}}>
        <div>
          <div>
            <h1 style={{fontSize:24,fontWeight:700,color:'var(--tm-text-primary)',margin:0,fontFamily:'Syne, sans-serif',letterSpacing:'-0.02em'}}>Dashboard</h1>
            <p style={{fontSize:13,color:'var(--tm-text-muted)',margin:'4px 0 0'}}>{loading?'…':`${trades.length} trades · ${t('dashboard.openTrades', {count: open.length})}`}</p>
          </div>

        </div>
        {/* Info banner */}
        <div style={{display:'flex',gap:8,alignItems:'center',padding:'8px 14px',background:'var(--tm-bg-secondary)',border:'1px solid #1E2330',borderRadius:12,flexWrap:'wrap'}}>
          <button onClick={()=>setActiveTab(activeTab==='modular'?'journal':'modular')} style={{
            display:'flex',alignItems:'center',gap:6,padding:'4px 12px',
            background:activeTab==='modular'?'rgba(var(--tm-accent-rgb,0,229,255),0.12)':'rgba(var(--tm-accent-rgb,0,229,255),0.04)',
            border:`1px solid ${activeTab==='modular'?'rgba(var(--tm-accent-rgb,0,229,255),0.4)':'rgba(var(--tm-accent-rgb,0,229,255),0.15)'}`,
            borderRadius:8,cursor:'pointer',fontSize:10,fontWeight:700,
            color:activeTab==='modular'?'var(--tm-accent)':'var(--tm-text-muted)',
            transition:'all 0.2s',letterSpacing:'0.04em',
          }}>
            <span style={{fontSize:12}}>⚡</span>
            {activeTab==='modular'?'← Journal':'Widgets'}
          </button>
          <div style={{width:1,height:16,background:'var(--tm-border)'}}/>
          <a href="https://discord.gg/SqfMCVtEhV" target="_blank" rel="noopener noreferrer" style={{display:'flex',alignItems:'center',gap:5,padding:'4px 10px',background:'rgba(88,101,242,0.1)',border:'1px solid rgba(88,101,242,0.25)',borderRadius:8,textDecoration:'none',fontSize:10,fontWeight:600,color:'#5865F2'}}>
            Discord
          </a>
          <a href="https://trademindsetapp.com" target="_blank" rel="noopener noreferrer" style={{display:'flex',alignItems:'center',gap:5,padding:'4px 10px',background:'rgba(var(--tm-accent-rgb,0,229,255),0.06)',border:'1px solid rgba(var(--tm-accent-rgb,0,229,255),0.2)',borderRadius:8,textDecoration:'none',fontSize:10,fontWeight:600,color:'var(--tm-accent)'}}>
            Site web
          </a>
          <a href="mailto:trademindsetapp@gmail.com" style={{display:'flex',alignItems:'center',gap:5,padding:'4px 10px',background:'rgba(var(--tm-profit-rgb,34,199,89),0.06)',border:'1px solid rgba(var(--tm-profit-rgb,34,199,89),0.2)',borderRadius:8,textDecoration:'none',fontSize:10,fontWeight:600,color:'var(--tm-profit)'}}>
            Contact
          </a>
          <div style={{width:1,height:16,background:'var(--tm-border)'}}/>
          <div style={{display:'flex',alignItems:'center',gap:5,padding:'4px 10px',background:'rgba(var(--tm-warning-rgb,255,149,0),0.06)',border:'1px solid rgba(var(--tm-warning-rgb,255,149,0),0.2)',borderRadius:8,fontSize:10,fontWeight:600,color:'var(--tm-warning)'}}>
            <span style={{width:6,height:6,borderRadius:'50%',background:'var(--tm-warning)',display:'inline-block',boxShadow:'0 0 6px rgba(var(--tm-warning-rgb,255,149,0),0.4)'}}/>
            {userCount !== null ? `${userCount} utilisateur${userCount !== 1 ? 's' : ''}` : '…'}
          </div>
          <div style={{width:1,height:16,background:'var(--tm-border)'}}/>
          <div style={{fontSize:10,color:'var(--tm-text-muted)',fontFamily:'JetBrains Mono,monospace'}}>TradeMindset v1.1</div>
        </div>
      </div>

      {activeTab === 'journal' && <>
      {/* KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:16}}>
        {[
          {label:t('dashboard.pnlTotal'), value:loading?null:fmtK(s.totalPnL), color:s.totalPnL>=0?'#22C764':'#FF3B30', glow:s.totalPnL>=0?'34,199,100':'255,59,48', sub:`${closed.length} ${t('dashboard.closedTrades').toLowerCase()}`},
          {label:'Win Rate',  value:loading?null:`${s.winRate.toFixed(1)}%`, color:'#e2e8f0', glow:'226,232,240', sub:`${s.wins}W / ${s.losses}L`},
          {label:'Ratio R/R', value:loading?null:s.payoffRatio.toFixed(2), color:'#00E5FF', glow:'0,229,255', sub:'Rendement/Risque'},
          {label:t('common.open'), value:loading?null:String(open.length), color:open.length>0?'#FF9500':'#64748b', glow:open.length>0?'255,149,0':'100,116,139', sub:'Positions actives'},
        ].map(({label,value,color,glow,sub})=>(
          <div key={label} style={{
            background:'rgba(8,12,22,0.9)',
            border:`1px solid rgba(${glow},0.2)`,
            borderRadius:16,
            padding:'18px 20px',
            position:'relative',
            overflow:'hidden',
            backdropFilter:'blur(16px)',
            boxShadow:`0 0 25px rgba(${glow},0.08), inset 0 1px 0 rgba(${glow},0.12)`,
          }}>
            {/* Scan line top */}
            <div style={{position:'absolute',top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,transparent,rgba(${glow},0.7),transparent)`}}/>
            {/* Corner accents */}
            <div style={{position:'absolute',top:0,left:0,width:12,height:12,borderTop:`1px solid rgba(${glow},0.6)`,borderLeft:`1px solid rgba(${glow},0.6)`,borderTopLeftRadius:16}}/>
            <div style={{position:'absolute',top:0,right:0,width:12,height:12,borderTop:`1px solid rgba(${glow},0.6)`,borderRight:`1px solid rgba(${glow},0.6)`,borderTopRightRadius:16}}/>
            <div style={{position:'absolute',bottom:0,left:0,width:12,height:12,borderBottom:`1px solid rgba(${glow},0.3)`,borderLeft:`1px solid rgba(${glow},0.3)`,borderBottomLeftRadius:16}}/>
            <div style={{position:'absolute',bottom:0,right:0,width:12,height:12,borderBottom:`1px solid rgba(${glow},0.3)`,borderRight:`1px solid rgba(${glow},0.3)`,borderBottomRightRadius:16}}/>
            {/* Ambient glow orb */}
            <motion.div style={{position:'absolute',width:60,height:60,borderRadius:'50%',background:`rgba(${glow},0.12)`,filter:'blur(20px)',pointerEvents:'none'}}
              animate={{top:['5%','5%','65%','65%','5%'],left:['5%','70%','70%','5%','5%']}}
              transition={{duration:10,repeat:Infinity,ease:'linear'}}/>
            <div style={{fontSize:10,color:`rgba(${glow},0.7)`,marginBottom:10,textTransform:'uppercase',letterSpacing:'0.12em',fontWeight:700,position:'relative'}}>{label}</div>
            {value===null?<Skel h={28}/>:<motion.div
              animate={{textShadow:[`0 0 10px rgba(${glow},0.3)`,`0 0 22px rgba(${glow},0.6)`,`0 0 10px rgba(${glow},0.3)`]}}
              transition={{duration:2.5,repeat:Infinity}}
              style={{fontSize:26,fontWeight:800,color,fontFamily:'JetBrains Mono, monospace',letterSpacing:'-0.02em',marginBottom:6,position:'relative'}}>
              {value}
            </motion.div>}
            <div style={{fontSize:10,color:'rgba(148,163,184,0.7)',position:'relative'}}>{sub}</div>
            {/* Bottom scanning light */}
            <motion.div style={{position:'absolute',bottom:0,left:0,height:2,width:'40%',background:`linear-gradient(90deg,transparent,rgba(${glow},0.8),transparent)`,pointerEvents:'none'}}
              animate={{left:['-40%','140%']}}
              transition={{duration:2.5,repeat:Infinity,ease:'linear',repeatDelay:1.5}}/>
          </div>
        ))}
      </div>

      {/* P&L Curve */}
      <div style={{...card(),marginBottom:16}}>
        <div style={hl()}/>
        <PnLCurve trades={trades} moods={moods}/>
      </div>

      {/* Long / Short */}
      <div style={{...card(),marginBottom:16}}>
        <div style={hl()}/>
        <div style={{fontSize:13,fontWeight:700,color:'rgba(226,232,240,0.9)',marginBottom:2,letterSpacing:'0.05em',textTransform:'uppercase'}}>Long / Short Performance</div>
        <div style={{fontSize:11,color:'rgba(148,163,184,0.6)',marginBottom:16}}>Win rate & P&L par direction</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          {[
            {label:'LONG', icon:'↑', wr:s.longWR,  pnl:s.longPnL,  count:s.longs,  c:'#22C764', glow:'34,199,100'},
            {label:'SHORT',icon:'↓', wr:s.shortWR, pnl:s.shortPnL, count:s.shorts, c:'#FF3B30', glow:'255,59,48'},
          ].map(({label,icon,wr,pnl,count,c,glow})=>(
            <div key={label} style={{background:`rgba(${glow},0.04)`,border:`1px solid rgba(${glow},0.25)`,borderRadius:12,padding:'14px 16px',position:'relative',overflow:'hidden',backdropFilter:'blur(8px)',boxShadow:`0 0 20px rgba(${glow},0.06)`}}>
              <div style={{position:'absolute',top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,transparent,rgba(${glow},0.6),transparent)`}}/>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
                <div style={{width:30,height:30,borderRadius:'50%',background:`rgba(${glow},0.15)`,border:`1px solid rgba(${glow},0.4)`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,color:c,boxShadow:`0 0 10px rgba(${glow},0.3)`}}>{icon}</div>
                <div style={{fontSize:12,fontWeight:700,color:'rgba(226,232,240,0.9)',letterSpacing:'0.05em'}}>{label}</div>
              </div>
              <div style={{borderTop:`1px solid rgba(${glow},0.15)`,marginBottom:12}}/>
              {loading?<Skel h={40}/>:<>
                <motion.div
                  animate={{textShadow:[`0 0 12px rgba(${glow},0.4)`,`0 0 24px rgba(${glow},0.7)`,`0 0 12px rgba(${glow},0.4)`]}}
                  transition={{duration:2.5,repeat:Infinity}}
                  style={{fontSize:38,fontWeight:900,color:c,fontFamily:'JetBrains Mono, monospace',lineHeight:1}}>
                  {wr.toFixed(1)}<span style={{fontSize:14,fontWeight:600}}>%</span>
                </motion.div>
                <div style={{fontSize:10,color:'rgba(148,163,184,0.6)',marginBottom:8,marginTop:4}}>Win Rate · {count} trades</div>
                <div style={{display:'inline-flex',alignItems:'center',gap:6,background:`rgba(${glow},0.08)`,padding:'4px 10px',borderRadius:8,border:`1px solid rgba(${glow},0.2)`}}>
                  <span style={{fontSize:10,color:`rgba(${glow},0.8)`,fontWeight:700,letterSpacing:'0.08em'}}>P&L</span>
                  <span style={{fontSize:12,fontWeight:800,color:pnl>=0?'#22C764':'#FF3B30',fontFamily:'JetBrains Mono, monospace'}}>{fmtK(pnl)}</span>
                </div>
              </>}
            </div>
          ))}
        </div>
      </div>

      {/* Main + Advanced Metrics */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
        {/* Main Metrics */}
        <div style={card()}>
          <div style={hl()}/>
          <div style={{fontSize:12,fontWeight:700,color:'rgba(226,232,240,0.9)',marginBottom:16,textTransform:'uppercase',letterSpacing:'0.1em'}}>Main Metrics</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            {loading?[1,2,3,4].map(i=><Skel key={i} h={80}/>):[
              {value:`${s.winRate.toFixed(1)}%`,label:'Win Rate',sub:`${s.wins}W / ${s.losses}L`,c:'#22C764',glow:'34,199,100'},
              {value:fmtK(s.totalPnL),label:'Total P&L',sub:`${closed.length} trades`,c:'#00E5FF',glow:'0,229,255'},
              {value:s.payoffRatio.toFixed(2),label:'Payoff Ratio',sub:'Gain/Perte',c:'#0A85FF',glow:'10,133,255'},
              {value:fmtK(-s.fees),label:'Fees',sub:'Total',c:'#BF5AF2',glow:'191,90,242'},
            ].map(({value,label,sub,c,glow})=>(
              <div key={label} style={{background:`rgba(${glow},0.06)`,border:`1px solid rgba(${glow},0.2)`,borderRadius:10,padding:'12px 14px',position:'relative',overflow:'hidden',boxShadow:`0 0 15px rgba(${glow},0.05)`}}>
                <div style={{position:'absolute',top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,transparent,rgba(${glow},0.5),transparent)`}}/>
                <motion.div
                  animate={{textShadow:[`0 0 8px rgba(${glow},0.3)`,`0 0 18px rgba(${glow},0.6)`,`0 0 8px rgba(${glow},0.3)`]}}
                  transition={{duration:3,repeat:Infinity,delay:Math.random()*2}}
                  style={{fontSize:20,fontWeight:800,color:c,fontFamily:'JetBrains Mono, monospace',marginBottom:4}}>
                  {value}
                </motion.div>
                <div style={{fontSize:11,color:'rgba(226,232,240,0.8)',fontWeight:600}}>{label}</div>
                <div style={{fontSize:10,color:`rgba(${glow},0.7)`,marginTop:2}}>{sub}</div>
              </div>
            ))}
          </div>
        </div>
        {/* Advanced Metrics */}
        <div style={card()}>
          <div style={hl()}/>
          <div style={{fontSize:12,fontWeight:700,color:'rgba(226,232,240,0.9)',marginBottom:2,textTransform:'uppercase',letterSpacing:'0.1em'}}>Advanced Metrics</div>
          <div style={{fontSize:10,color:'rgba(148,163,184,0.5)',marginBottom:16}}>Drawdown · Sharpe · Expectancy · Streaks</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            {loading?[1,2,3,4].map(i=><Skel key={i} h={80}/>):[
              {value:fmtK(-s.maxDD),label:'Max Drawdown',sub:'Max loss',c:'#FF3B30',glow:'255,59,48'},
              {value:s.sharpe.toFixed(2),label:'Sharpe Ratio',sub:'Return/Risk',c:'#0A85FF',glow:'10,133,255'},
              {value:fmtK(s.expectancy),label:'Expectancy',sub:'Avg/trade',c:'#00E5FF',glow:'0,229,255'},
              {value:String(s.bestStreak),label:'Best Streak',sub:`${s.worstStreak} max losses`,c:'#FF9500',glow:'255,149,0'},
            ].map(({value,label,sub,c,glow})=>(
              <div key={label} style={{background:`rgba(${glow},0.06)`,border:`1px solid rgba(${glow},0.2)`,borderRadius:10,padding:'12px 14px',position:'relative',overflow:'hidden',boxShadow:`0 0 15px rgba(${glow},0.05)`}}>
                <div style={{position:'absolute',top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,transparent,rgba(${glow},0.5),transparent)`}}/>
                <motion.div
                  animate={{textShadow:[`0 0 8px rgba(${glow},0.3)`,`0 0 18px rgba(${glow},0.6)`,`0 0 8px rgba(${glow},0.3)`]}}
                  transition={{duration:3,repeat:Infinity,delay:Math.random()*2}}
                  style={{fontSize:20,fontWeight:800,color:c,fontFamily:'JetBrains Mono, monospace',marginBottom:4}}>
                  {value}
                </motion.div>
                <div style={{fontSize:11,color:'rgba(226,232,240,0.8)',fontWeight:600}}>{label}</div>
                <div style={{fontSize:10,color:`rgba(${glow},0.7)`,marginTop:2}}>{sub}</div>
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
            <div style={{fontSize:14,fontWeight:700,color:'var(--tm-text-primary)'}}>Heatmap</div>
            <div style={{fontSize:11,color:'var(--tm-text-muted)'}}>{t('dashboard.heatmapSubtitle')}</div>
          </div>
          <div style={{display:'flex',gap:5}}>
            {['7j','1M','3M','6M','1A'].map(p=>(
              <button key={p} onClick={()=>setPeriod(p)} style={{padding:'4px 10px',borderRadius:20,fontSize:11,fontWeight:600,cursor:'pointer',
                border:`1px solid ${period===p?'var(--tm-blue)':'var(--tm-border)'}`,
                background:period===p?'rgba(var(--tm-blue-rgb,10,133,255),0.15)':'transparent',
                color:period===p?'var(--tm-blue)':'var(--tm-text-muted)'}}>{p}</button>
            ))}
          </div>
        </div>
        <div data-heatmap style={{position:'relative'}}>
          {loading?<Skel h={80}/>:<CalendarHeatmap trades={trades} period={period}/>}
        </div>
        {!loading&&<div style={{display:'flex',gap:8,marginTop:10,alignItems:'center',justifyContent:'flex-end'}}>
          <div style={{width:8,height:8,borderRadius:2,background:'var(--tm-profit)'}}/><span style={{fontSize:10,color:'var(--tm-text-muted)'}}>Gains</span>
          <div style={{width:8,height:8,borderRadius:2,background:'var(--tm-loss)',marginLeft:8}}/><span style={{fontSize:10,color:'var(--tm-text-muted)'}}>Pertes</span>
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
            <div style={{width:32,height:32,borderRadius:'50%',background:'rgba(var(--tm-purple-rgb,191,90,242),0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>💜</div>
            <div style={{fontSize:14,fontWeight:700,color:'var(--tm-text-primary)'}}>Emotional Summary</div>
          </div>
          {loading?<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>{[1,2,3,4].map(i=><Skel key={i} h={80}/>)}</div>:emo&&(
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              {[
                {tag:t('dashboard.avgState'),      icon:'✅',value:t(emo.avgState),sub:`${emo.entries} entries`,     c:'var(--tm-profit)',bg:'rgba(var(--tm-profit-rgb,34,199,89),0.06)',  bdr:'rgba(var(--tm-profit-rgb,34,199,89),0.15)'},
                {tag:t('dashboard.emotionImpact'),icon:'⊜', value:t(emo.impact),  sub:t('dashboard.pnlCorrelation'),c:'var(--tm-text-secondary)',bg:'rgba(255,255,255,0.02)',bdr:'var(--tm-border-sub)'},
                {tag:t('dashboard.emotionalRisk'),icon:'⚠️',value:t(emo.risk),    sub:emo.consec>0?`${emo.consec} ${t('dashboard.consecutiveLosses')}`:t('dashboard.noStreak'),c:'var(--tm-warning)',bg:'rgba(var(--tm-warning-rgb,255,149,0),0.06)',bdr:'rgba(var(--tm-warning-rgb,255,149,0),0.15)'},
                {tag:'AI ADVICE',                 icon:'▶', value:t(emo.advice),  sub:t('dashboard.recommendation'),c:'var(--tm-profit)',bg:'rgba(var(--tm-profit-rgb,34,199,89),0.06)',  bdr:'rgba(var(--tm-profit-rgb,34,199,89),0.15)'},
              ].map(({tag,icon,value,sub,c,bg,bdr})=>(
                <div key={tag} style={{background:bg,border:`1px solid ${bdr}`,borderRadius:12,padding:'12px 14px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8}}>
                    <span style={{fontSize:12}}>{icon}</span>
                    <span style={{fontSize:9,fontWeight:700,color:'var(--tm-text-muted)',letterSpacing:'0.08em'}}>{tag}</span>
                  </div>
                  <div style={{fontSize:16,fontWeight:700,color:'var(--tm-text-primary)',marginBottom:4}}>{value}</div>
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
          <div style={{fontSize:13,fontWeight:600,color:'var(--tm-text-primary)',marginBottom:14}}>{t('dashboard.recentTrades')}</div>
          {loading?<div style={{display:'flex',flexDirection:'column',gap:8}}>{[1,2,3].map(i=><Skel key={i} h={44}/>)}</div>:recent.length===0?(
            <div style={{textAlign:'center',padding:'24px 0',color:'var(--tm-text-muted)',fontSize:13}}>{t('dashboard.noTrades')}</div>
          ):(
            <div style={{display:'flex',flexDirection:'column',gap:4}}>
              {recent.map(t=>{
                const pnl=tradePnL(t)
                return(<div key={t.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',borderRadius:10,background:'rgba(255,255,255,0.02)'}}>
                  <div style={{width:28,height:28,borderRadius:8,background:t.type==='Long'?'rgba(var(--tm-profit-rgb,34,199,89),0.1)':'rgba(var(--tm-loss-rgb,255,59,48),0.1)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,flexShrink:0}}>{t.type==='Long'?'↑':'↓'}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,color:'var(--tm-text-primary)',fontFamily:'JetBrains Mono, monospace'}}>{t.symbol}</div>
                    <div style={{fontSize:10,color:'var(--tm-text-muted)'}}>{fmtDate(t.date)} · <span style={{color:systemColor(t.systemId)}}>{systemName(t.systemId)}</span></div>
                  </div>
                  {t.status==='open'?(<div style={{fontSize:10,fontWeight:600,color:'var(--tm-warning)',background:'rgba(var(--tm-warning-rgb,255,149,0),0.1)',padding:'2px 7px',borderRadius:5}}>OUVERT</div>):(<div style={{fontSize:12,fontWeight:700,color:pnl>=0?'var(--tm-profit)':'var(--tm-loss)',fontFamily:'JetBrains Mono, monospace'}}>{fmtK(pnl)}</div>)}
                </div>)
              })}
            </div>
          )}
        </div>
        <div style={card()}>
          <div style={hl()}/>
          <div style={{fontSize:13,fontWeight:600,color:'var(--tm-text-primary)',marginBottom:14}}>{t('dashboard.statistics')}</div>
          {loading?<div style={{display:'flex',flexDirection:'column',gap:10}}>{[1,2,3,4,5].map(i=><Skel key={i}/>)}</div>:(
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {[
                {label:t('dashboard.closedTrades'),  value:closed.length,              c:'var(--tm-text-primary)'},
                {label:t('dashboard.avgGain'),        value:`+$${fmt(s.avgWin)}`,       c:'var(--tm-profit)'},
                {label:t('dashboard.avgLoss'),        value:`-$${fmt(s.avgLoss)}`,      c:'var(--tm-loss)'},
                {label:t('dashboard.winningStreak'),  value:`${s.bestStreak} trades`,   c:'var(--tm-warning)'},
                {label:t('dashboard.losingStreak'),   value:`${s.worstStreak} trades`,  c:'var(--tm-loss)'},
                {label:t('dashboard.currentStreak'),  value:s.currentStreak>0?`+${s.currentStreak} wins`:`${Math.abs(s.currentStreak)} losses`, c:s.currentStreak>0?'var(--tm-profit)':'var(--tm-loss)'},
              ].map(({label,value,c})=>(
                <div key={label} style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{fontSize:12,color:'var(--tm-text-secondary)'}}>{label}</span>
                  <span style={{fontSize:13,fontWeight:600,color:c,fontFamily:'JetBrains Mono, monospace'}}>{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </>
      }

      {/* Modular widget dashboard tab */}
      {activeTab === 'modular' && (
        <div style={{marginTop:8}}>
          <ModularDashboard />
        </div>
      )}
    </div>
  )
}
