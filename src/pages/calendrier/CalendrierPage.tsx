// CalendrierPage.tsx — Calendrier Économique (page dédiée)
// Fix : détection weekend, vraies dates, analyse IA sur demande
import { useState, useEffect } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'

const fbFn = getFunctions(app, 'europe-west1')

interface CalendarEvent {
  id: string; name: string; countryCode: string; currencyCode?: string
  dateUtc: string; volatility: 'HIGH'|'MEDIUM'|'LOW'|'NONE'
  actual?: string; consensus?: string; previous?: string
}
type ImpactFilter = 'ALL'|'HIGH'|'MEDIUM'|'LOW'
type PeriodFilter = 'today'|'tomorrow'|'week'|'nextweek'

const FLAGS: Record<string,string> = {
  US:'🇺🇸',EU:'🇪🇺',GB:'🇬🇧',JP:'🇯🇵',CN:'🇨🇳',CA:'🇨🇦',
  AU:'🇦🇺',NZ:'🇳🇿',CH:'🇨🇭',DE:'🇩🇪',FR:'🇫🇷',IT:'🇮🇹',ES:'🇪🇸',KR:'🇰🇷',IN:'🇮🇳',
}

function isWeekend(d: Date) { return d.getDay()===0||d.getDay()===6 }
function nextBD(d: Date) { const r=new Date(d); do{r.setDate(r.getDate()+1)}while(isWeekend(r)); return r }

function getTargetDates(period: PeriodFilter) {
  const now = new Date()
  const today = new Date(now.getFullYear(),now.getMonth(),now.getDate())
  const weekendNow = isWeekend(today)
  if (period==='today') {
    const target = weekendNow ? nextBD(today) : today
    return { dates:[target.toISOString().split('T')[0]], isWeekend:weekendNow, nextBD:target.toISOString().split('T')[0], label: weekendNow ? `Prochain jour ouvré — ${target.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})}` : `Aujourd'hui — ${today.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})}` }
  }
  if (period==='tomorrow') {
    const tom=new Date(today); tom.setDate(tom.getDate()+1)
    const target=isWeekend(tom)?nextBD(tom):tom
    return { dates:[target.toISOString().split('T')[0]], isWeekend:false, nextBD:'', label:target.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'}) }
  }
  if (period==='nextweek') {
    const dates: string[]=[]
    const cur=new Date(today)
    // Avancer au lundi prochain
    const daysUntilMonday = (8 - cur.getDay()) % 7 || 7
    cur.setDate(cur.getDate()+daysUntilMonday)
    while(dates.length<5){if(!isWeekend(cur))dates.push(cur.toISOString().split('T')[0]);cur.setDate(cur.getDate()+1)}
    return { dates, isWeekend:false, nextBD:'', label:`Semaine prochaine — ${dates[0]} au ${dates[4]}` }
  }
  const dates: string[]=[]
  const cur=new Date(today)
  while(isWeekend(cur))cur.setDate(cur.getDate()+1)
  while(dates.length<5){if(!isWeekend(cur))dates.push(cur.toISOString().split('T')[0]);cur.setDate(cur.getDate()+1)}
  return { dates, isWeekend:false, nextBD:'', label:`Semaine — ${dates[0]} au ${dates[4]}` }
}

async function fetchCalendarEvents(period: PeriodFilter): Promise<CalendarEvent[]> {
  const { dates } = getTargetDates(period)
  try {
    const fn = httpsCallable<Record<string,unknown>,{choices?:{message:{content:string}}[]}>(fbFn,'openaiChat')
    const datesDesc = dates.length===1 ? `le ${dates[0]}` : `les jours suivants : ${dates.join(', ')}`
    const res = await fn({
      messages:[
        {role:'system',content:'Tu es un assistant spécialisé en calendrier économique. RÈGLE ABSOLUE : les marchés sont FERMÉS samedi et dimanche. Ne génère JAMAIS d\'événements pour un weekend. Retourne [] si toutes les dates sont un weekend.'},
        {role:'user',content:`Génère les événements économiques réels pour ${datesDesc}. Vérifie que ces dates sont des jours ouvrés (lundi-vendredi). Inclure : Fed/BCE/BoJ, NFP, CPI, PIB, PMI, emploi, inflation. Réponds UNIQUEMENT en JSON valide sans markdown. Format: [{"id":"1","name":"CPI","countryCode":"US","currencyCode":"USD","dateUtc":"${dates[0]}T13:30:00Z","volatility":"HIGH","actual":null,"consensus":"3.1%","previous":"3.2%"}] Max 10 événements triés par heure.`}
      ],
      model:'gpt-4o-mini', max_tokens:1200,
    })
    const raw = res.data.choices?.[0]?.message?.content||'[]'
    const parsed = JSON.parse(raw.replace(/```json\n?|```\n?/g,'').trim()) as CalendarEvent[]
    return Array.isArray(parsed)?parsed:[]
  } catch { return [] }
}

async function generateAIAnalysis(events: CalendarEvent[]): Promise<string> {
  const fn = httpsCallable<Record<string,unknown>,{choices?:{message:{content:string}}[]}>(fbFn,'openaiChat')
  const high = events.filter(e=>e.volatility==='HIGH').map(e=>e.name)
  const med  = events.filter(e=>e.volatility==='MEDIUM').map(e=>e.name)
  const res = await fn({
    messages:[{role:'user',content:`Analyste macro senior. Événements à venir :\nHIGH: ${high.join(', ')||'aucun'}\nMEDIUM: ${med.join(', ')||'aucun'}\n\nAnalyse en 4-5 phrases :\n1. Risque global de la session\n2. Événements prioritaires et pourquoi\n3. Impact potentiel sur BTC, SPX/NQ, EUR/USD\n4. Recommandation (quand éviter de trader, quand entrer)\nStyle institutionnel, direct, sans disclaimer.`}],
    model:'gpt-4o-mini', max_tokens:400,
  })
  return res.data.choices?.[0]?.message?.content||''
}

function fmtTime(d:string){try{return new Date(d).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'})}catch{return'—'}}
function fmtDate(d:string){try{return new Date(d).toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'})}catch{return'—'}}
function isPast(d:string){return new Date(d)<new Date()}

function ImpactDots({v}:{v:string}){
  const cfg={HIGH:{c:'#FF3B30',dots:'●●●'},MEDIUM:{c:'#FF9500',dots:'●●○'},LOW:{c:'#22C759',dots:'●○○'},NONE:{c:'#555C70',dots:'○○○'}}[v]||{c:'#555C70',dots:'○○○'}
  return <span style={{fontSize:11,color:cfg.c,letterSpacing:1,flexShrink:0}}>{cfg.dots}</span>
}

function EventCard({event}:{event:CalendarEvent}){
  const past=isPast(event.dateUtc)
  const hasActual=event.actual&&event.actual!=='null'
  const actualNum=parseFloat(event.actual||''),cNum=parseFloat(event.consensus||'')
  const aC=!isNaN(actualNum)&&!isNaN(cNum)?(actualNum>cNum?'#22C759':actualNum<cNum?'#FF3B30':'#F0F3FF'):'#F0F3FF'
  const bg={HIGH:'rgba(255,59,48,0.06)',MEDIUM:'rgba(255,149,0,0.04)',LOW:'rgba(34,199,89,0.04)',NONE:'transparent'}[event.volatility]||'transparent'
  const br={HIGH:'rgba(255,59,48,0.2)',MEDIUM:'rgba(255,149,0,0.15)',LOW:'rgba(34,199,89,0.12)',NONE:'rgba(255,255,255,0.04)'}[event.volatility]||'rgba(255,255,255,0.04)'
  return(
    <div style={{display:'flex',alignItems:'flex-start',gap:14,padding:'14px 20px',background:bg,border:`1px solid ${br}`,borderRadius:12,opacity:past?0.5:1}}>
      <div style={{width:48,flexShrink:0,textAlign:'center'}}>
        <div style={{fontSize:13,fontWeight:700,color:past?'#555C70':'#F0F3FF',fontFamily:'monospace'}}>{fmtTime(event.dateUtc)}</div>
        <div style={{fontSize:10,color:'#3D4254',marginTop:2}}>{event.currencyCode||event.countryCode}</div>
        {past&&<div style={{fontSize:9,color:'#3D4254',marginTop:2}}>✓</div>}
      </div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
          <span style={{fontSize:18,lineHeight:1}}>{FLAGS[event.countryCode]||'🌍'}</span>
          <span style={{fontSize:13,fontWeight:600,color:past?'#8F94A3':'#F0F3FF'}}>{event.name}</span>
        </div>
        <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
          {event.previous&&<span style={{fontSize:11,color:'#555C70'}}>Préc. <span style={{color:'#8F94A3'}}>{event.previous}</span></span>}
          {event.consensus&&<span style={{fontSize:11,color:'#555C70'}}>Prévu <span style={{color:'#FF9500',fontWeight:600}}>{event.consensus}</span></span>}
          {hasActual&&<span style={{fontSize:11,color:'#555C70'}}>Réel <span style={{color:aC,fontWeight:700}}>{event.actual}</span></span>}
        </div>
      </div>
      <ImpactDots v={event.volatility}/>
    </div>
  )
}

function RiskBanner({events}:{events:CalendarEvent[]}){
  const up=events.filter(e=>!isPast(e.dateUtc))
  const h=up.filter(e=>e.volatility==='HIGH').length
  const m=up.filter(e=>e.volatility==='MEDIUM').length
  const next=up.find(e=>e.volatility==='HIGH')
  if(!h&&!m)return null
  const c=h>=3?'#FF3B30':h>=1?'#FF9500':'#22C759'
  const l=h>=3?'RISQUE ÉLEVÉ':h>=1?'RISQUE MODÉRÉ':'RISQUE FAIBLE'
  return(
    <div style={{padding:'14px 20px',background:`${c}08`,border:`1px solid ${c}25`,borderRadius:14,marginBottom:16}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:next?8:0}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:18}}>⚠️</span><span style={{fontSize:14,fontWeight:700,color:c}}>{l}</span></div>
        <div style={{display:'flex',gap:8}}>
          {h>0&&<span style={{fontSize:11,color:'#FF3B30',background:'rgba(255,59,48,0.12)',padding:'3px 10px',borderRadius:20}}>●●● ×{h}</span>}
          {m>0&&<span style={{fontSize:11,color:'#FF9500',background:'rgba(255,149,0,0.12)',padding:'3px 10px',borderRadius:20}}>●●○ ×{m}</span>}
        </div>
      </div>
      {next&&<div style={{fontSize:12,color:'#8F94A3'}}>Prochain HIGH : <span style={{color:'#FF3B30',fontWeight:600}}>{next.name}</span> à <span style={{color:'#F0F3FF'}}>{fmtTime(next.dateUtc)}</span></div>}
    </div>
  )
}

function AISection({events}:{events:CalendarEvent[]}){
  const [text,setText]=useState('')
  const [loading,setLoading]=useState(false)
  const [done,setDone]=useState(false)
  const run=async()=>{
    if(loading)return; setLoading(true)
    try{const t=await generateAIAnalysis(events);setText(t);setDone(true)}catch{setText('Erreur.')}
    setLoading(false)
  }
  return(
    <div style={{background:'rgba(191,90,242,0.05)',border:'1px solid rgba(191,90,242,0.2)',borderRadius:14,padding:'16px 20px',marginBottom:20}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:done?12:0}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:16}}>✨</span>
          <span style={{fontSize:13,fontWeight:700,color:'#BF5AF2'}}>Analyse IA de la session</span>
          <span style={{fontSize:10,color:'#555C70',background:'rgba(191,90,242,0.1)',padding:'2px 8px',borderRadius:10}}>GPT-4o</span>
        </div>
        {!done?(
          <button onClick={run} disabled={loading} style={{display:'flex',alignItems:'center',gap:6,padding:'7px 16px',borderRadius:20,background:loading?'#1C2130':'rgba(191,90,242,0.15)',border:'1px solid rgba(191,90,242,0.35)',color:loading?'#555C70':'#BF5AF2',fontSize:11,fontWeight:600,cursor:loading?'not-allowed':'pointer'}}>
            {loading?<><div style={{width:12,height:12,border:'2px solid #3D4254',borderTopColor:'#BF5AF2',borderRadius:'50%',animation:'spin 0.7s linear infinite'}}/>Analyse...</>:'✨ Analyser la session'}
          </button>
        ):(
          <button onClick={run} disabled={loading} style={{fontSize:11,color:'#555C70',background:'none',border:'none',cursor:'pointer'}}>{loading?'...':'↺'}</button>
        )}
      </div>
      {done&&text&&<div style={{fontSize:12,color:'#C5C8D6',lineHeight:1.8,whiteSpace:'pre-wrap'}}>{text}</div>}
      {!done&&<div style={{fontSize:11,color:'#3D4254',marginTop:8}}>Risque global · Événements prioritaires · Impact BTC / SPX / EUR/USD · Recommandations</div>}
    </div>
  )
}

export default function CalendrierPage(){
  const [events,setEvents]=useState<CalendarEvent[]>([])
  const [status,setStatus]=useState<'idle'|'loading'|'done'|'error'>('idle')
  const [period,setPeriod]=useState<PeriodFilter>('today')
  const [filter,setFilter]=useState<ImpactFilter>('ALL')
  const [pInfo,setPInfo]=useState<ReturnType<typeof getTargetDates>|null>(null)

  const load=(p:PeriodFilter)=>{
    const info=getTargetDates(p); setPInfo(info)
    setStatus('loading'); setEvents([])
    fetchCalendarEvents(p).then(e=>{setEvents(e);setStatus('done')}).catch(()=>setStatus('error'))
  }
  useEffect(()=>{load(period)},[period])

  const filtered=events.filter(e=>filter==='ALL'||e.volatility===filter)
  const isWE=isWeekend(new Date())&&period==='today'
  const byDate=period==='week'?filtered.reduce((acc,e)=>{const d=fmtDate(e.dateUtc);if(!acc[d])acc[d]=[];acc[d].push(e);return acc},{}  as Record<string,CalendarEvent[]>):null

  return(
    <div style={{minHeight:'100vh',background:'#0D1117',padding:'32px 24px',maxWidth:900,margin:'0 auto'}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:0.4}50%{opacity:0.8}}`}</style>

      {/* Header */}
      <div style={{marginBottom:28}}>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:6}}>
          <div style={{width:40,height:40,borderRadius:12,background:'linear-gradient(135deg,rgba(10,133,255,0.2),rgba(0,229,255,0.2))',border:'1px solid rgba(0,229,255,0.3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20}}>📅</div>
          <div>
            <h1 style={{fontSize:22,fontWeight:700,color:'#F0F3FF',margin:0,fontFamily:'Syne,sans-serif'}}>Calendrier Économique</h1>
            <p style={{fontSize:12,color:'#555C70',margin:0}}>{pInfo?.label||'Événements macro · Heure Paris'}</p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div style={{display:'flex',gap:12,marginBottom:20,flexWrap:'wrap',alignItems:'center'}}>
        <div style={{display:'flex',background:'#161B22',border:'1px solid #1E2330',borderRadius:12,padding:4,gap:2}}>
          {([{k:'today',l:"Aujourd'hui"},{k:'tomorrow',l:'Demain'},{k:'week',l:'Semaine'},{k:'nextweek',l:'Sem. suivante'}] as {k:PeriodFilter,l:string}[]).map(p=>(
            <button key={p.k} onClick={()=>setPeriod(p.k)} style={{padding:'7px 18px',borderRadius:9,fontSize:12,fontWeight:500,cursor:'pointer',border:'none',background:period===p.k?'rgba(0,229,255,0.15)':'transparent',color:period===p.k?'#00E5FF':'#555C70',transition:'all 0.15s'}}>{p.l}</button>
          ))}
        </div>
        <div style={{display:'flex',gap:6}}>
          {(['ALL','HIGH','MEDIUM','LOW'] as ImpactFilter[]).map(f=>{
            const colors:Record<ImpactFilter,string>={ALL:'#8F94A3',HIGH:'#FF3B30',MEDIUM:'#FF9500',LOW:'#22C759'}; const c=colors[f]
            return <button key={f} onClick={()=>setFilter(f)} style={{padding:'7px 14px',borderRadius:20,fontSize:11,fontWeight:600,cursor:'pointer',border:`1px solid ${filter===f?c:'#2A2F3E'}`,background:filter===f?`${c}15`:'transparent',color:filter===f?c:'#555C70',transition:'all 0.15s'}}>{f==='ALL'?'Tous':f}</button>
          })}
        </div>
        <button onClick={()=>load(period)} style={{marginLeft:'auto',padding:'7px 14px',borderRadius:20,fontSize:11,background:'transparent',border:'1px solid #2A2F3E',color:'#555C70',cursor:'pointer'}}>↺ Actualiser</button>
      </div>

      {/* Weekend banner */}
      {status==='done'&&isWE&&(
        <div style={{padding:'20px',background:'rgba(255,149,0,0.06)',border:'1px solid rgba(255,149,0,0.2)',borderRadius:14,marginBottom:16,textAlign:'center'}}>
          <div style={{fontSize:28,marginBottom:8}}>🏖️</div>
          <div style={{fontSize:14,fontWeight:700,color:'#FF9500',marginBottom:4}}>Marchés fermés ce weekend</div>
          <div style={{fontSize:12,color:'#8F94A3',marginTop:4}}>Prochain jour ouvré : <span style={{color:'#F0F3FF',fontWeight:600}}>{pInfo?.nextBD ? new Date(pInfo.nextBD).toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'}) : '—'}</span></div>
        </div>
      )}

      {/* AI + Risk */}
      {status==='done'&&events.length>0&&<AISection events={events}/>}
      {status==='done'&&events.length>0&&<RiskBanner events={events}/>}

      {/* Loading */}
      {status==='loading'&&<div style={{display:'flex',flexDirection:'column',gap:10}}>{[1,2,3,4,5].map(i=><div key={i} style={{height:72,borderRadius:12,background:'#161B22',animation:`pulse 1.5s ease-in-out ${i*0.08}s infinite`}}/>)}</div>}

      {/* Error */}
      {status==='error'&&<div style={{textAlign:'center',padding:'60px 20px',color:'#555C70'}}><div style={{fontSize:40,marginBottom:12}}>📡</div><div style={{fontSize:14,marginBottom:8}}>Impossible de charger</div><button onClick={()=>load(period)} style={{padding:'8px 20px',borderRadius:10,background:'rgba(0,229,255,0.1)',border:'1px solid rgba(0,229,255,0.2)',color:'#00E5FF',fontSize:12,cursor:'pointer'}}>Réessayer</button></div>}

      {/* Empty */}
      {status==='done'&&filtered.length===0&&!isWE&&<div style={{textAlign:'center',padding:'60px 20px',color:'#555C70'}}><div style={{fontSize:40,marginBottom:12}}>🗓️</div><div style={{fontSize:14}}>Aucun événement {filter!=='ALL'?filter:''} pour cette période</div></div>}

      {/* Events */}
      {status==='done'&&filtered.length>0&&(byDate?Object.entries(byDate).map(([date,evts])=>(
        <div key={date} style={{marginBottom:24}}>
          <div style={{fontSize:12,fontWeight:700,color:'#555C70',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:10,paddingBottom:6,borderBottom:'1px solid #1E2330'}}>{date}</div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>{evts.map(e=><EventCard key={e.id} event={e}/>)}</div>
        </div>
      )):<div style={{display:'flex',flexDirection:'column',gap:8}}>{filtered.map(e=><EventCard key={e.id} event={e}/>)}</div>)}

      {/* Legend */}
      {status==='done'&&<div style={{display:'flex',gap:16,marginTop:24,padding:'14px 20px',background:'#161B22',border:'1px solid #1E2330',borderRadius:12,flexWrap:'wrap'}}>
        {[{d:'●●●',c:'#FF3B30',l:'Impact fort — éviter de trader'},{d:'●●○',c:'#FF9500',l:'Impact modéré — prudence'},{d:'●○○',c:'#22C759',l:'Impact faible'}].map(({d,c,l})=>(
          <div key={l} style={{display:'flex',alignItems:'center',gap:6}}><span style={{fontSize:11,color:c,letterSpacing:1}}>{d}</span><span style={{fontSize:11,color:'#555C70'}}>{l}</span></div>
        ))}
      </div>}
    </div>
  )
}
