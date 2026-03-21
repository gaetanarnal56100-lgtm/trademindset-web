// CalendrierPage.tsx — Calendrier Économique (page dédiée)
import { useState, useEffect } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'

const fbFn = getFunctions(app, 'europe-west1')

interface CalendarEvent {
  id: string
  name: string
  countryCode: string
  currencyCode?: string
  dateUtc: string
  volatility: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'
  actual?: string
  consensus?: string
  previous?: string
}

type ImpactFilter = 'ALL' | 'HIGH' | 'MEDIUM' | 'LOW'
type PeriodFilter = 'today' | 'tomorrow' | 'week'

const FLAGS: Record<string, string> = {
  US:'🇺🇸',EU:'🇪🇺',GB:'🇬🇧',JP:'🇯🇵',CN:'🇨🇳',CA:'🇨🇦',
  AU:'🇦🇺',NZ:'🇳🇿',CH:'🇨🇭',DE:'🇩🇪',FR:'🇫🇷',IT:'🇮🇹',
  ES:'🇪🇸',KR:'🇰🇷',IN:'🇮🇳',
}

async function fetchCalendarEvents(period: PeriodFilter): Promise<CalendarEvent[]> {
  try {
    const fn = httpsCallable<Record<string,unknown>,{choices?:{message:{content:string}}[]}>(fbFn,'openaiChat')
    const now = new Date()
    const dateStr = now.toISOString().split('T')[0]
    const tom = new Date(now); tom.setDate(tom.getDate()+1)
    const tomStr = tom.toISOString().split('T')[0]
    const periodDesc = period==='today' ? `aujourd'hui (${dateStr})` : period==='tomorrow' ? `demain (${tomStr})` : `cette semaine (du ${dateStr})`
    const res = await fn({
      messages:[{role:'user',content:`Génère les 12 principaux événements économiques du calendrier macro pour ${periodDesc}.
Réponds UNIQUEMENT avec un tableau JSON valide, sans markdown ni backticks.
Format exact :
[{"id":"1","name":"Non-Farm Payrolls","countryCode":"US","currencyCode":"USD","dateUtc":"${dateStr}T13:30:00Z","volatility":"HIGH","actual":null,"consensus":"185K","previous":"187K"}]
volatility = HIGH | MEDIUM | LOW. Inclure : Fed/BCE/BoJ decisions, NFP, CPI, PIB, PMI, emploi, ventes détail, inflation, balance commerciale. Pays prioritaires : US, EU, GB, JP, CN, CA, AU, CH. 12 événements maximum, triés par heure. Aujourd'hui nous sommes le ${dateStr}.`}],
      model:'gpt-4o-mini', max_tokens:1200,
    })
    const raw = res.data.choices?.[0]?.message?.content || '[]'
    const parsed = JSON.parse(raw.replace(/```json\n?|```\n?/g,'').trim()) as CalendarEvent[]
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function fmtTime(d:string){try{return new Date(d).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'})}catch{return'—'}}
function fmtDate(d:string){try{return new Date(d).toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'})}catch{return'—'}}
function isPast(d:string){return new Date(d)<new Date()}

function ImpactDots({v}:{v:string}){
  const cfg={HIGH:{c:'#FF3B30',dots:'●●●'},MEDIUM:{c:'#FF9500',dots:'●●○'},LOW:{c:'#22C759',dots:'●○○'},NONE:{c:'#555C70',dots:'○○○'}}[v]||{c:'#555C70',dots:'○○○'}
  return <span style={{fontSize:11,color:cfg.c,letterSpacing:1,flexShrink:0}}>{cfg.dots}</span>
}

function EventCard({event}:{event:CalendarEvent}){
  const past = isPast(event.dateUtc)
  const flag = FLAGS[event.countryCode]||'🌍'
  const hasActual = event.actual && event.actual!=='null'
  const actualNum = parseFloat(event.actual||''), consensusNum = parseFloat(event.consensus||'')
  const actualColor = !isNaN(actualNum)&&!isNaN(consensusNum) ? actualNum>consensusNum?'#22C759':actualNum<consensusNum?'#FF3B30':'#F0F3FF' : '#F0F3FF'
  const impactBg = {HIGH:'rgba(255,59,48,0.06)',MEDIUM:'rgba(255,149,0,0.04)',LOW:'rgba(34,199,89,0.04)',NONE:'transparent'}[event.volatility]||'transparent'
  const impactBorder = {HIGH:'rgba(255,59,48,0.2)',MEDIUM:'rgba(255,149,0,0.15)',LOW:'rgba(34,199,89,0.12)',NONE:'rgba(255,255,255,0.04)'}[event.volatility]||'rgba(255,255,255,0.04)'

  return (
    <div style={{display:'flex',alignItems:'flex-start',gap:14,padding:'14px 20px',background:impactBg,border:`1px solid ${impactBorder}`,borderRadius:12,opacity:past?0.55:1,transition:'opacity 0.2s'}}>
      {/* Time col */}
      <div style={{width:48,flexShrink:0,textAlign:'center'}}>
        <div style={{fontSize:13,fontWeight:700,color:past?'#555C70':'#F0F3FF',fontFamily:'monospace'}}>{fmtTime(event.dateUtc)}</div>
        <div style={{fontSize:10,color:'#3D4254',marginTop:2}}>{event.currencyCode||event.countryCode}</div>
        {past&&<div style={{fontSize:9,color:'#3D4254',marginTop:2}}>✓</div>}
      </div>

      {/* Content */}
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
          <span style={{fontSize:18,lineHeight:1}}>{flag}</span>
          <span style={{fontSize:13,fontWeight:600,color:past?'#8F94A3':'#F0F3FF'}}>{event.name}</span>
        </div>
        <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
          {event.previous&&<span style={{fontSize:11,color:'#555C70'}}>Préc. <span style={{color:'#8F94A3'}}>{event.previous}</span></span>}
          {event.consensus&&<span style={{fontSize:11,color:'#555C70'}}>Prévu <span style={{color:'#FF9500',fontWeight:600}}>{event.consensus}</span></span>}
          {hasActual&&<span style={{fontSize:11,color:'#555C70'}}>Réel <span style={{color:actualColor,fontWeight:700}}>{event.actual}</span></span>}
        </div>
      </div>

      <ImpactDots v={event.volatility}/>
    </div>
  )
}

function RiskBanner({events}:{events:CalendarEvent[]}){
  const high=events.filter(e=>e.volatility==='HIGH'&&!isPast(e.dateUtc)).length
  const medium=events.filter(e=>e.volatility==='MEDIUM'&&!isPast(e.dateUtc)).length
  const next=events.find(e=>e.volatility==='HIGH'&&!isPast(e.dateUtc))
  if(!high&&!medium)return null
  const riskColor=high>=3?'#FF3B30':high>=1?'#FF9500':'#22C759'
  const riskLabel=high>=3?'RISQUE ÉLEVÉ':high>=1?'RISQUE MODÉRÉ':'RISQUE FAIBLE'
  return(
    <div style={{padding:'14px 20px',background:`${riskColor}08`,border:`1px solid ${riskColor}25`,borderRadius:14,marginBottom:20}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:next?8:0}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:18}}>⚠️</span>
          <span style={{fontSize:14,fontWeight:700,color:riskColor}}>{riskLabel}</span>
        </div>
        <div style={{display:'flex',gap:10}}>
          {high>0&&<span style={{fontSize:11,color:'#FF3B30',background:'rgba(255,59,48,0.12)',padding:'3px 10px',borderRadius:20}}>●●● ×{high} HIGH</span>}
          {medium>0&&<span style={{fontSize:11,color:'#FF9500',background:'rgba(255,149,0,0.12)',padding:'3px 10px',borderRadius:20}}>●●○ ×{medium} MEDIUM</span>}
        </div>
      </div>
      {next&&<div style={{fontSize:12,color:'#8F94A3'}}>Prochain événement fort : <span style={{color:'#FF3B30',fontWeight:600}}>{next.name}</span> à <span style={{color:'#F0F3FF'}}>{fmtTime(next.dateUtc)}</span></div>}
    </div>
  )
}

export default function CalendrierPage() {
  const [events,  setEvents]  = useState<CalendarEvent[]>([])
  const [status,  setStatus]  = useState<'idle'|'loading'|'done'|'error'>('idle')
  const [period,  setPeriod]  = useState<PeriodFilter>('today')
  const [filter,  setFilter]  = useState<ImpactFilter>('ALL')

  const load = (p:PeriodFilter) => {
    setStatus('loading'); setEvents([])
    fetchCalendarEvents(p).then(e=>{setEvents(e);setStatus('done')}).catch(()=>setStatus('error'))
  }

  useEffect(()=>{load(period)},[period])

  const filtered = events.filter(e=>filter==='ALL'||e.volatility===filter)

  const byDate = period==='week'
    ? filtered.reduce((acc,e)=>{const d=fmtDate(e.dateUtc);if(!acc[d])acc[d]=[];acc[d].push(e);return acc},{} as Record<string,CalendarEvent[]>)
    : null

  return(
    <div style={{minHeight:'100vh',background:'#0D1117',padding:'32px 24px',maxWidth:900,margin:'0 auto'}}>
      {/* Header */}
      <div style={{marginBottom:28}}>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:6}}>
          <div style={{width:40,height:40,borderRadius:12,background:'linear-gradient(135deg,rgba(10,133,255,0.2),rgba(0,229,255,0.2))',border:'1px solid rgba(0,229,255,0.3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20}}>📅</div>
          <div>
            <h1 style={{fontSize:22,fontWeight:700,color:'#F0F3FF',margin:0,fontFamily:'Syne,sans-serif'}}>Calendrier Économique</h1>
            <p style={{fontSize:12,color:'#555C70',margin:0}}>Événements macro · Impact sur les marchés · Heure Paris</p>
          </div>
        </div>
      </div>

      {/* Period + Filter controls */}
      <div style={{display:'flex',gap:12,marginBottom:24,flexWrap:'wrap',alignItems:'center'}}>
        {/* Period */}
        <div style={{display:'flex',background:'#161B22',border:'1px solid #1E2330',borderRadius:12,padding:4,gap:2}}>
          {([{k:'today',l:"Aujourd'hui"},{k:'tomorrow',l:'Demain'},{k:'week',l:'Semaine'}] as {k:PeriodFilter,l:string}[]).map(p=>(
            <button key={p.k} onClick={()=>setPeriod(p.k)} style={{padding:'7px 18px',borderRadius:9,fontSize:12,fontWeight:500,cursor:'pointer',border:'none',background:period===p.k?'rgba(0,229,255,0.15)':'transparent',color:period===p.k?'#00E5FF':'#555C70',transition:'all 0.15s'}}>{p.l}</button>
          ))}
        </div>

        {/* Impact filter */}
        <div style={{display:'flex',gap:6}}>
          {(['ALL','HIGH','MEDIUM','LOW'] as ImpactFilter[]).map(f=>{
            const colors:Record<ImpactFilter,string>={ALL:'#8F94A3',HIGH:'#FF3B30',MEDIUM:'#FF9500',LOW:'#22C759'}
            const c=colors[f]
            return(
              <button key={f} onClick={()=>setFilter(f)} style={{padding:'7px 14px',borderRadius:20,fontSize:11,fontWeight:600,cursor:'pointer',border:`1px solid ${filter===f?c:'#2A2F3E'}`,background:filter===f?`${c}15`:'transparent',color:filter===f?c:'#555C70',transition:'all 0.15s'}}>
                {f==='ALL'?'Tous':f}
              </button>
            )
          })}
        </div>

        {/* Refresh */}
        <button onClick={()=>load(period)} style={{marginLeft:'auto',padding:'7px 14px',borderRadius:20,fontSize:11,background:'transparent',border:'1px solid #2A2F3E',color:'#555C70',cursor:'pointer'}}>↺ Actualiser</button>
      </div>

      {/* Risk banner */}
      {status==='done'&&<RiskBanner events={events}/>}

      {/* Loading */}
      {status==='loading'&&(
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {[1,2,3,4,5,6].map(i=>(
            <div key={i} style={{height:72,borderRadius:12,background:'#161B22',animation:'pulse 1.5s ease-in-out infinite',animationDelay:`${i*0.08}s`}}/>
          ))}
          <style>{`@keyframes pulse{0%,100%{opacity:0.4}50%{opacity:0.8}}`}</style>
        </div>
      )}

      {/* Error */}
      {status==='error'&&(
        <div style={{textAlign:'center',padding:'60px 20px',color:'#555C70'}}>
          <div style={{fontSize:40,marginBottom:12}}>📡</div>
          <div style={{fontSize:14,fontWeight:600,marginBottom:8}}>Impossible de charger le calendrier</div>
          <button onClick={()=>load(period)} style={{padding:'8px 20px',borderRadius:10,background:'rgba(0,229,255,0.1)',border:'1px solid rgba(0,229,255,0.2)',color:'#00E5FF',fontSize:12,cursor:'pointer'}}>Réessayer</button>
        </div>
      )}

      {/* Empty */}
      {status==='done'&&filtered.length===0&&(
        <div style={{textAlign:'center',padding:'60px 20px',color:'#555C70'}}>
          <div style={{fontSize:40,marginBottom:12}}>🗓️</div>
          <div style={{fontSize:14}}>Aucun événement {filter!=='ALL'?filter:''} pour cette période</div>
        </div>
      )}

      {/* Events */}
      {status==='done'&&filtered.length>0&&(
        byDate ? (
          Object.entries(byDate).map(([date,evts])=>(
            <div key={date} style={{marginBottom:24}}>
              <div style={{fontSize:12,fontWeight:700,color:'#555C70',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:10,paddingBottom:6,borderBottom:'1px solid #1E2330'}}>{date}</div>
              <div style={{display:'flex',flexDirection:'column',gap:8}}>{evts.map(e=><EventCard key={e.id} event={e}/>)}</div>
            </div>
          ))
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:8}}>{filtered.map(e=><EventCard key={e.id} event={e}/>)}</div>
        )
      )}

      {/* Legend */}
      {status==='done'&&(
        <div style={{display:'flex',gap:16,marginTop:24,padding:'14px 20px',background:'#161B22',border:'1px solid #1E2330',borderRadius:12,flexWrap:'wrap'}}>
          {[{d:'●●●',c:'#FF3B30',l:'Impact fort — éviter de trader'},{d:'●●○',c:'#FF9500',l:'Impact modéré — prudence'},{d:'●○○',c:'#22C759',l:'Impact faible'}].map(({d,c,l})=>(
            <div key={l} style={{display:'flex',alignItems:'center',gap:6}}>
              <span style={{fontSize:11,color:c,letterSpacing:1}}>{d}</span>
              <span style={{fontSize:11,color:'#555C70'}}>{l}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
