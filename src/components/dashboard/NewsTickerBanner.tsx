// NewsTickerBanner.tsx — Bandeau d'actualités
// Miroir exact de NewsTickerService.swift + NewsTickerBanner.swift
// RSS Bloomberg → GPT-4o-mini classification → ticker défilant → panel liste → analyse IA

import { useState, useEffect, useRef, useCallback } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'

const fbFn = getFunctions(app, 'europe-west1')

type Sentiment = 'bullish' | 'bearish' | 'neutral'
type Category  = 'MACRO' | 'CRYPTO' | 'MARKETS' | 'FOREX' | 'ENERGY' | 'EARNINGS' | 'GEO' | 'TECH'

interface NewsItem {
  id: string; title: string; source: string
  category: Category; sentiment: Sentiment; url?: string; fetchedAt: Date
}

const CAT_COLOR: Record<Category,string> = {
  MACRO:'#FF9500',CRYPTO:'#00E5FF',MARKETS:'#0A85FF',FOREX:'#BF5AF2',
  ENERGY:'#FFD60A',EARNINGS:'#22C759',GEO:'#FF3B30',TECH:'#64D2FF',
}
const SENT_COLOR: Record<Sentiment,string> = {bullish:'#22C759',bearish:'#FF3B30',neutral:'rgba(255,255,255,0.25)'}
const SENT_ICON:  Record<Sentiment,string> = {bullish:'▲',bearish:'▼',neutral:'◆'}
const CATS = Object.keys(CAT_COLOR) as Category[]

function classifyCategory(t: string): Category {
  const s=t.toLowerCase()
  if(['fed','ecb','inflation','rate','gdp','cpi','central bank','yield'].some(k=>s.includes(k)))return'MACRO'
  if(['bitcoin','btc','ethereum','crypto','solana','defi','token'].some(k=>s.includes(k)))return'CRYPTO'
  if(['dollar','euro','yen','pound','forex','currency','dxy'].some(k=>s.includes(k)))return'FOREX'
  if(['oil','gas','opec','energy','brent','wti'].some(k=>s.includes(k)))return'ENERGY'
  if(['earnings','revenue','profit','quarterly','eps'].some(k=>s.includes(k)))return'EARNINGS'
  if(['war','sanctions','nato','ukraine','russia','taiwan','geopolit'].some(k=>s.includes(k)))return'GEO'
  if(['apple','google','microsoft','nvidia','ai ','chip','openai'].some(k=>s.includes(k)))return'TECH'
  return'MARKETS'
}

async function fetchFeed(url:string,label:string):Promise<{title:string;source:string;url?:string}[]>{
  try{
    const r=await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,{signal:AbortSignal.timeout(10000)})
    if(!r.ok)return[]
    const{contents}=await r.json() as{contents:string}
    if(!contents?.includes('<item')&&!contents?.includes('<entry'))return[]
    const items:{title:string;source:string;url?:string}[]=[]
    const itemRx=/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi
    const titleRx=/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i
    const linkRx=/<link[^>]*>([^<]+)<\/link>|<link[^>]+href="([^"]+)"/i
    let m
    while((m=itemRx.exec(contents))!==null){
      const b=m[0]
      const tm=titleRx.exec(b);const lm=linkRx.exec(b)
      const title=tm?.[1]?.trim().replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"')
      if(title&&title.length>10)items.push({title,source:label,url:lm?.[1]?.trim()||lm?.[2]?.trim()})
      if(items.length>=10)break
    }
    return items
  }catch{return[]}
}

async function enrichWithGPT(raw:{title:string;source:string;url?:string}[]):Promise<NewsItem[]>{
  const sub=raw.slice(0,12)
  const list=sub.map((r,i)=>`${i+1}. ${r.title}`).join('\n')
  try{
    const fn=httpsCallable<Record<string,unknown>,{choices?:{message:{content:string}}[]}>(fbFn,'openaiChat')
    const res=await fn({
      messages:[{role:'user',content:`Financial news classifier. Return EXACTLY a JSON array of 8 objects, no markdown:\n[{"title":"max 8 words","category":"one of [${CATS.join(',')}]","sentiment":"bullish|bearish|neutral","index":1}]\nPick the 8 most market-moving. "index" = 1-based position.\n\nClassify:\n${list}`}],
      model:'gpt-4o-mini',max_tokens:400,
    })
    let json=(res.data.choices?.[0]?.message?.content||'').replace(/```json|```/g,'').trim()
    const s=json.indexOf('[');if(s>=0)json=json.slice(s)
    if(!json.endsWith(']')){const l=json.lastIndexOf('}');if(l>=0)json=json.slice(0,l+1)+']'}
    const parsed=JSON.parse(json) as{title:string;category:string;sentiment:string;index:number}[]
    return parsed.slice(0,8).map((item,i)=>{
      const r=sub[item.index?item.index-1:i]||sub[0]
      return{id:`${Date.now()}-${i}`,title:item.title,source:r?.source||'Bloomberg',
        category:(CATS.includes(item.category as Category)?item.category:classifyCategory(item.title))as Category,
        sentiment:(['bullish','bearish','neutral'].includes(item.sentiment)?item.sentiment:'neutral')as Sentiment,
        url:r?.url,fetchedAt:new Date()}
    })
  }catch{
    return sub.slice(0,8).map((r,i)=>({id:`${Date.now()}-${i}`,
      title:r.title.length>70?r.title.slice(0,67)+'...':r.title,
      source:r.source,category:classifyCategory(r.title),sentiment:'neutral'as Sentiment,url:r.url,fetchedAt:new Date()}))
  }
}

async function analyzeNews(items:NewsItem[]):Promise<string>{
  const headlines=items.map(n=>`[${n.sentiment.toUpperCase()}] ${n.title} (${n.category})`).join('\n')
  try{
    const fn=httpsCallable<Record<string,unknown>,{choices?:{message:{content:string}}[]}>(fbFn,'openaiChat')
    const res=await fn({
      messages:[{role:'user',content:`Analyste de marché: analyse ces ${items.length} headlines en 4-5 phrases concises. Thèmes dominants, sentiment global, implications pour les traders.\n\n${headlines}`}],
      model:'gpt-4o-mini',max_tokens:300,
    })
    return res.data.choices?.[0]?.message?.content||''
  }catch{return''}
}

export default function NewsTickerBanner(){
  const[items,setItems]=useState<NewsItem[]>([])
  const[loading,setLoading]=useState(false)
  const[paused,setPaused]=useState(false)
  const[showPanel,setShowPanel]=useState(false)
  const[aiText,setAiText]=useState('')
  const[aiLoading,setAiLoading]=useState(false)
  const[lastRefresh,setLastRefresh]=useState<Date|null>(null)
  const[dot,setDot]=useState(true)
  const[filter,setFilter]=useState<Category|'ALL'>('ALL')
  const tickerRef=useRef<HTMLDivElement>(null)
  const animRef=useRef<Animation|null>(null)

  const fetchNews=useCallback(async(force=false)=>{
    if(loading)return
    if(!force&&lastRefresh&&(Date.now()-lastRefresh.getTime())<600000)return
    setLoading(true)
    try{
      const allRaw:{title:string;source:string;url?:string}[]=[]
      const seen=new Set<string>()
      await Promise.allSettled([
        {url:'https://feeds.bloomberg.com/markets/news.rss',label:'Markets'},
        {url:'https://feeds.bloomberg.com/economics/news.rss',label:'Economics'},
        {url:'https://feeds.bloomberg.com/crypto/news.rss',label:'Crypto'},
      ].map(async f=>{
        const its=await fetchFeed(f.url,f.label)
        its.forEach(it=>{const k=it.title.slice(0,40).toLowerCase();if(!seen.has(k)){seen.add(k);allRaw.push(it)}})
      }))
      const enriched=await enrichWithGPT(allRaw)
      if(enriched.length>0)setItems(enriched)
      setLastRefresh(new Date())
    }catch{/*keep existing*/}
    setLoading(false)
  },[loading,lastRefresh])

  useEffect(()=>{fetchNews()},[])
  useEffect(()=>{const t=setInterval(()=>fetchNews(),600000);return()=>clearInterval(t)},[fetchNews])
  useEffect(()=>{const t=setInterval(()=>setDot(x=>!x),900);return()=>clearInterval(t)},[])

  useEffect(()=>{
    const el=tickerRef.current;if(!el||items.length===0)return
    const w=el.scrollWidth/2
    if(animRef.current)animRef.current.cancel()
    const anim=el.animate([{transform:'translateX(0)'},{transform:`translateX(-${w}px)`}],
      {duration:w*1000/44,iterations:Infinity,easing:'linear'})
    animRef.current=anim
    if(paused)anim.pause()
    return()=>anim.cancel()
  },[items])

  useEffect(()=>{if(!animRef.current)return;paused?animRef.current.pause():animRef.current.play()},[paused])

  const loadAI=useCallback(async()=>{
    if(aiLoading||items.length===0)return
    setAiLoading(true)
    const t=await analyzeNews(items)
    if(t)setAiText(t)
    setAiLoading(false)
  },[items,aiLoading])

  const filtered=filter==='ALL'?items:items.filter(n=>n.category===filter)
  const double=[...items,...items]

  return(
    <>
      <div style={{background:'#0D1117',borderBottom:'1px solid rgba(255,255,255,0.06)',height:52,display:'flex',alignItems:'stretch',overflow:'hidden',flexShrink:0}}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

        {/* LIVE */}
        <button onClick={()=>setPaused(x=>!x)} style={{width:68,flexShrink:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,background:'none',border:'none',borderRight:'1px solid rgba(255,255,255,0.06)',cursor:'pointer'}}>
          <div style={{width:7,height:7,borderRadius:'50%',background:paused?'rgba(255,255,255,0.15)':'#FF3B30',opacity:paused?1:dot?1:0.25,transition:'opacity 0.3s'}}/>
          <span style={{fontSize:8,fontWeight:700,letterSpacing:'0.1em',color:paused?'rgba(255,255,255,0.3)':'rgba(255,255,255,0.75)',fontFamily:'monospace'}}>{paused?'PAUSED':'LIVE'}</span>
        </button>

        {/* Ticker */}
        <div style={{flex:1,overflow:'hidden',position:'relative',display:'flex',alignItems:'center'}}>
          <div style={{position:'absolute',left:0,top:0,bottom:0,width:28,background:'linear-gradient(to right,#0D1117,transparent)',zIndex:2,pointerEvents:'none'}}/>
          <div style={{position:'absolute',right:0,top:0,bottom:0,width:28,background:'linear-gradient(to left,#0D1117,transparent)',zIndex:2,pointerEvents:'none'}}/>
          {loading&&items.length===0?(
            <div style={{display:'flex',alignItems:'center',gap:8,paddingLeft:20}}>
              <div style={{width:11,height:11,border:'2px solid #2A2F3E',borderTopColor:'#00E5FF',borderRadius:'50%',animation:'spin 0.7s linear infinite'}}/>
              <span style={{fontSize:12,color:'#555C70'}}>Chargement des actualités...</span>
            </div>
          ):items.length===0?(
            <span style={{fontSize:12,color:'#555C70',paddingLeft:20}}>Aucune actualité</span>
          ):(
            <div ref={tickerRef} style={{display:'flex',alignItems:'center',whiteSpace:'nowrap',willChange:'transform'}}>
              {double.map((item,i)=>(
                <div key={`${item.id}-${i}`} style={{display:'inline-flex',alignItems:'center',gap:7,padding:'0 20px',borderRight:'1px solid rgba(255,255,255,0.04)',cursor:item.url?'pointer':'default'}}
                  onClick={()=>item.url&&window.open(item.url,'_blank','noopener')}>
                  <span style={{fontSize:10,color:SENT_COLOR[item.sentiment]}}>{SENT_ICON[item.sentiment]}</span>
                  <span style={{fontSize:9,fontWeight:700,color:CAT_COLOR[item.category],background:`${CAT_COLOR[item.category]}18`,padding:'1px 5px',borderRadius:3}}>{item.category}</span>
                  <span style={{fontSize:12,color:'#C5C8D6'}}>{item.title}</span>
                  <span style={{fontSize:9,color:'#3D4254'}}>{item.source}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Burger */}
        <button onClick={()=>setShowPanel(true)} style={{width:48,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',background:'none',border:'none',borderLeft:'1px solid rgba(255,255,255,0.06)',cursor:'pointer',color:'rgba(255,255,255,0.45)',fontSize:20,lineHeight:1}}>
          ≡
        </button>
      </div>

      {/* Panel */}
      {showPanel&&(
        <div style={{position:'fixed',inset:0,zIndex:300,background:'rgba(0,0,0,0.5)'}} onClick={()=>setShowPanel(false)}>
          <div style={{position:'absolute',right:0,top:0,bottom:0,width:480,maxWidth:'100vw',background:'#161B22',borderLeft:'1px solid #2A2F3E',display:'flex',flexDirection:'column',boxShadow:'-8px 0 40px rgba(0,0,0,0.6)'}}
            onClick={e=>e.stopPropagation()}>

            {/* Header */}
            <div style={{padding:'16px 20px',borderBottom:'1px solid #2A2F3E',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
              <div>
                <div style={{fontSize:15,fontWeight:700,color:'#F0F3FF',fontFamily:'Syne,sans-serif'}}>Actualités Marchés</div>
                <div style={{fontSize:11,color:'#555C70',marginTop:2}}>{lastRefresh?`Mis à jour ${lastRefresh.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}`:'...'}</div>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>fetchNews(true)} disabled={loading} style={{fontSize:11,color:'#555C70',background:'#1C2130',border:'1px solid #2A2F3E',borderRadius:8,padding:'5px 10px',cursor:'pointer'}}>{loading?'...':'↻'}</button>
                <button onClick={()=>setShowPanel(false)} style={{fontSize:18,color:'#555C70',background:'none',border:'none',cursor:'pointer'}}>✕</button>
              </div>
            </div>

            {/* Filters */}
            <div style={{padding:'10px 16px',borderBottom:'1px solid #2A2F3E',display:'flex',gap:5,flexWrap:'wrap',flexShrink:0}}>
              {(['ALL',...CATS] as (Category|'ALL')[]).map(cat=>(
                <button key={cat} onClick={()=>setFilter(cat)} style={{padding:'3px 9px',borderRadius:5,fontSize:10,fontWeight:600,cursor:'pointer',border:'none',
                  background:filter===cat?(cat==='ALL'?'#2A2F3E':CAT_COLOR[cat as Category]):'#1C2130',
                  color:filter===cat?(cat==='ALL'?'#F0F3FF':'#0D1117'):'#555C70'}}>
                  {cat}
                </button>
              ))}
            </div>

            {/* AI */}
            <div style={{padding:'10px 16px',borderBottom:'1px solid #2A2F3E',flexShrink:0}}>
              {aiText?(
                <div>
                  <div style={{fontSize:10,color:'#BF5AF2',marginBottom:5,display:'flex',alignItems:'center',gap:4}}>✨ Analyse IA</div>
                  <div style={{fontSize:12,color:'#C5C8D6',lineHeight:1.7}}>{aiText}</div>
                  <button onClick={()=>setAiText('')} style={{marginTop:6,fontSize:10,color:'#555C70',background:'none',border:'none',cursor:'pointer'}}>↻ Relancer</button>
                </div>
              ):(
                <button onClick={loadAI} disabled={aiLoading||items.length===0} style={{width:'100%',padding:'9px',borderRadius:9,border:'1px solid rgba(191,90,242,0.25)',background:aiLoading?'#1C2130':'rgba(191,90,242,0.1)',color:aiLoading?'#555C70':'#BF5AF2',cursor:aiLoading?'not-allowed':'pointer',fontSize:12,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                  {aiLoading?<><div style={{width:12,height:12,border:'2px solid #2A2F3E',borderTopColor:'#BF5AF2',borderRadius:'50%',animation:'spin 0.7s linear infinite'}}/>Analyse...</>:'✨ Analyser les news avec l\'IA'}
                </button>
              )}
            </div>

            {/* List */}
            <div style={{flex:1,overflowY:'auto'}}>
              {filtered.map(item=>(
                <div key={item.id} onClick={()=>item.url&&window.open(item.url,'_blank','noopener')}
                  style={{padding:'12px 20px',borderBottom:'1px solid rgba(255,255,255,0.04)',cursor:item.url?'pointer':'default',transition:'background 0.1s'}}
                  onMouseEnter={e=>{if(item.url)(e.currentTarget as HTMLElement).style.background='rgba(255,255,255,0.03)'}}
                  onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='transparent'}}>
                  <div style={{display:'flex',alignItems:'flex-start',gap:10}}>
                    <div style={{width:7,height:7,borderRadius:'50%',background:SENT_COLOR[item.sentiment],flexShrink:0,marginTop:5}}/>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,color:'#F0F3FF',lineHeight:1.5,marginBottom:5}}>{item.title}</div>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <span style={{fontSize:9,fontWeight:700,color:CAT_COLOR[item.category],background:`${CAT_COLOR[item.category]}18`,padding:'1px 6px',borderRadius:4}}>{item.category}</span>
                        <span style={{fontSize:10,color:'#3D4254'}}>{item.source}</span>
                        {item.url&&<span style={{fontSize:9,color:'#3D4254',marginLeft:'auto'}}>↗ Ouvrir</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {filtered.length===0&&<div style={{textAlign:'center',padding:'40px',color:'#3D4254',fontSize:13}}>Aucune actualité</div>}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
