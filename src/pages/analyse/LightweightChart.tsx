// LightweightChart.tsx v5 — Canvas drawings + Magnet + Indicator settings
// Compatible lightweight-charts 4.1.x
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createChart, IChartApi, ISeriesApi, CrosshairMode, Time, LineStyle } from 'lightweight-charts'
import { getAuth } from 'firebase/auth'
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, Timestamp } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'

const db = getFirestore(app)
const fbFn = getFunctions(app, 'europe-west1')

// ── Types ─────────────────────────────────────────────────────────────────
interface Props { symbol: string; isCrypto: boolean }
interface Candle { time: number; open: number; high: number; low: number; close: number; volume?: number }
type ToolId = 'cursor'|'hline'|'trendline'|'fibo'|'rect'|'note'
interface DrawingPoint { time: number; price: number }
interface Drawing {
  id?: string; type: ToolId; symbol: string; tf: string
  p1: DrawingPoint; p2?: DrawingPoint
  label?: string; color: string; ts: number
}
interface SavedDrawing extends Drawing { id: string }

const TIMEFRAMES = [
  {label:'1m',min:1},{label:'5m',min:5},{label:'15m',min:15},{label:'30m',min:30},
  {label:'1h',min:60},{label:'4h',min:240},{label:'1j',min:1440},{label:'1S',min:10080},
]
const COLORS = ['#FF3B30','#FF9500','#FFD60A','#22C759','#00E5FF','#0A85FF','#BF5AF2','#F0F3FF']
const FIBO_LEVELS = [
  {r:0,l:'0%'},{r:0.236,l:'23.6%'},{r:0.382,l:'38.2%'},{r:0.5,l:'50%'},
  {r:0.618,l:'61.8%'},{r:0.786,l:'78.6%'},{r:1,l:'100%'},
  {r:1.272,l:'127.2%'},{r:1.618,l:'161.8%'},
]

function tfStr(m:number){if(m<60)return`${m}m`;if(m<1440)return`${m/60}h`;if(m<10080)return'1d';return'1w'}
function fmtP(p:number){return p>1000?`$${p.toLocaleString('fr-FR',{maximumFractionDigits:1})}`:p>1?`$${p.toFixed(2)}`:`$${p.toFixed(5)}`}

// Firestore
function uid(){return getAuth().currentUser?.uid}
async function dbSave(d:Drawing):Promise<string>{
  const u=uid();if(!u)throw new Error('Non connecté')
  const r=await addDoc(collection(db,'users',u,'chartDrawings'),{...d,ts:Timestamp.now()})
  return r.id
}
async function dbLoad(sym:string,tf:string):Promise<SavedDrawing[]>{
  const u=uid();if(!u)return[]
  const snap=await getDocs(query(collection(db,'users',u,'chartDrawings'),orderBy('ts','desc')))
  return snap.docs.map(d=>({id:d.id,...d.data() as Drawing,ts:(d.data().ts as Timestamp).toMillis()})).filter(d=>d.symbol===sym&&d.tf===tf)
}
async function dbDelete(id:string){const u=uid();if(!u)return;await deleteDoc(doc(db,'users',u,'chartDrawings',id))}

// Fetch candles — crypto (Binance) → Cloud Functions pour tout le reste
async function fetchCandles(sym:string,isCrypto:boolean,min:number):Promise<Candle[]> {
  const s = sym.toUpperCase()

  // ── 1. Crypto → Binance Futures puis Spot ─────────────────────────────
  if (isCrypto) {
    const binanceSyms = [s.replace(/USDT$/i,'')+'USDT', s]
    for(const bSym of binanceSyms){
      for(const base of['https://fapi.binance.com/fapi/v1','https://api.binance.com/api/v3']){
        try{
          const r=await fetch(`${base}/klines?symbol=${bSym}&interval=${tfStr(min)}&limit=500`)
          if(!r.ok)continue
          const d=await r.json()
          if(!Array.isArray(d)||d.length < 5)continue
          return d.map((k:any[])=>({time:Math.floor(k[0]/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5]}))
        }catch{}
      }
    }
    throw new Error(`Crypto ${s} introuvable sur Binance`)
  }

  // ── 2. Non-crypto → Cloud Functions (copie exacte de MTFDashboard.tsx) ─
  const TF_TO_TD: Record<number,string> = {
    1:'1min',5:'5min',15:'15min',30:'30min',60:'1h',120:'2h',240:'4h',1440:'1day',10080:'1week'
  }
  const tdInterval = TF_TO_TD[min] || '1h'

  // TwelveData via fetchTimeSeries — essaie variantes exchange
  for (const variant of [s, `${s}:NYSE`, `${s}:NASDAQ`, `${s}:BATS`]) {
    try {
      const fn = httpsCallable<Record<string,unknown>, {values?:{open:string;high:string;low:string;close:string;volume?:string;datetime?:string}[]}>(fbFn, 'fetchTimeSeries')
      const res = await fn({ symbol: variant, interval: tdInterval, outputSize: 500 })
      const values = res.data.values || []
      if (values.length > 5) {
        return values.reverse().map(v => ({
          time: v.datetime ? Math.floor(new Date(v.datetime).getTime() / 1000) : 0,
          open: parseFloat(v.open) || 0, high: parseFloat(v.high) || 0,
          low: parseFloat(v.low) || 0, close: parseFloat(v.close) || 0,
          volume: parseFloat(v.volume || '0') || 0,
        })).filter((c: Candle) => c.open > 0 && c.close > 0)
      }
    } catch {/*try next*/}
  }

  // Finnhub fallback via fetchStockCandles
  try {
    const now = Math.floor(Date.now()/1000)
    const secsMap: Record<string,number> = {'1min':60,'5min':300,'15min':900,'30min':1800,'1h':3600,'2h':7200,'4h':14400,'1day':86400,'1week':604800}
    const resMap: Record<string,string> = {'1min':'1','5min':'5','15min':'15','30min':'30','1h':'60','2h':'120','4h':'D','1day':'D','1week':'W'}
    const from = now - (secsMap[tdInterval]||3600)*500
    const fn2 = httpsCallable<Record<string,unknown>, {c?:number[];h?:number[];l?:number[];o?:number[];s?:string}>(fbFn, 'fetchStockCandles')
    const res2 = await fn2({ symbol: s, resolution: resMap[tdInterval]||'60', from, to: now })
    if (res2.data.s === 'ok' && res2.data.c && res2.data.c.length > 5)
      return res2.data.c.map((_, i) => ({
        time: 0, open: res2.data.o![i], high: res2.data.h![i], low: res2.data.l![i], close: res2.data.c![i], volume: 0,
      }))
  } catch {/**/}

  throw new Error(`${s} introuvable. Essayez: AAPL \u00b7 TSLA \u00b7 MSFT \u00b7 EURUSD=X \u00b7 GC=F \u00b7 ^FCHI \u00b7 MC.PA`)
}

// ── Math helpers ──────────────────────────────────────────────────────────
function ema(d:number[],l:number):number[]{const k=2/(l+1),r=[...d];for(let i=1;i<d.length;i++)r[i]=d[i]*k+r[i-1]*(1-k);return r}
function sma(d:number[],l:number):number[]{return d.map((_,i)=>{if(i<l-1)return d[i];return d.slice(i-l+1,i+1).reduce((a,b)=>a+b,0)/l})}
function rsiCalc(c:number[],l:number):number[]{
  const r=new Array(c.length).fill(50)
  for(let i=l;i<c.length;i++){let g=0,lo=0;for(let j=i-l+1;j<=i;j++){const d=c[j]-c[j-1];if(d>0)g+=d;else lo-=d}
  const ag=g/l,al=lo/l;r[i]=al===0?100:100-100/(1+ag/al)}
  return r
}
function highest(d:number[],l:number):number[]{return d.map((_,i)=>i<l-1?d[i]:Math.max(...d.slice(i-l+1,i+1)))}
function lowest(d:number[],l:number):number[]{return d.map((_,i)=>i<l-1?d[i]:Math.min(...d.slice(i-l+1,i+1)))}

// ── Indicator calculations ────────────────────────────────────────────────
interface VMCResult{sig:number[];sigSignal:number[];mom:number[];isBull:boolean[];isBear:boolean[];buySignals:number[];sellSignals:number[]}
function calcVMC(candles:Candle[],smoothLen=10,signalMult=1.75,upT=35,loT=-35):VMCResult{
  const cl=candles.map(c=>c.close),hlc3=candles.map(c=>(c.high+c.low+c.close)/3)
  const rv=rsiCalc(cl,14),rH=highest(rv,14),rL=lowest(rv,14)
  const stoch=sma(rv.map((r,i)=>rH[i]===rL[i]?0:(r-rL[i])/(rH[i]-rL[i])*100),2)
  const mfi=hlc3.map((_,i)=>i===0?50:hlc3[i]>hlc3[i-1]?60:hlc3[i]<hlc3[i-1]?40:50)
  const core=hlc3.map((_,i)=>(rv[i]+0.4*mfi[i]+0.4*stoch[i])/1.8)
  const tf=(v:number)=>{const t=(v/100-0.5)*2;return 100*Math.sign(t)*Math.pow(Math.abs(t),0.75)}
  const sig=ema(core,smoothLen).map(tf),ss=ema(core,Math.round(smoothLen*signalMult)).map(tf),mom=sig.map((s,i)=>s-ss[i])
  const lens=[20,25,30,35,40,45,50,55];const emas=lens.map(l=>ema(cl,l))
  const isBull=cl.map((_,i)=>{let u=0;for(let j=0;j<7;j++)if(emas[j][i]>emas[j+1][i])u++;return u>=5})
  const isBear=cl.map((_,i)=>{let d=0;for(let j=0;j<7;j++)if(emas[j][i]<emas[j+1][i])d++;return d>=5})
  const buy:number[]=[],sell:number[]=[]
  for(let i=1;i<candles.length;i++){
    if(sig[i]>ss[i]&&sig[i-1]<=ss[i-1]&&sig[i]<loT&&isBull[i])buy.push(i)
    if(sig[i]<ss[i]&&sig[i-1]>=ss[i-1]&&sig[i]>upT&&isBear[i])sell.push(i)
  }
  return{sig,sigSignal:ss,mom,isBull,isBear,buySignals:buy,sellSignals:sell}
}

interface SMCResult{bullOBs:{top:number;btm:number;idx:number}[];bearOBs:{top:number;btm:number;idx:number}[];bullFVGs:{top:number;btm:number;idx:number}[];bearFVGs:{top:number;btm:number;idx:number}[]}
function calcSMC(candles:Candle[],sw=10):SMCResult{
  const n=candles.length,bullOBs:SMCResult['bullOBs']=[],bearOBs:SMCResult['bearOBs']=[],bullFVGs:SMCResult['bullFVGs']=[],bearFVGs:SMCResult['bearFVGs']=[]
  if(n<sw*2+5)return{bullOBs,bearOBs,bullFVGs,bearFVGs}
  for(let i=2;i<n;i++){const c=candles[i],c1=candles[i-1],c2=candles[i-2];if(c.low>c2.high&&c1.close>c1.open)bullFVGs.push({top:c.low,btm:c2.high,idx:i-2});if(c.high<c2.low&&c1.close<c1.open)bearFVGs.push({top:c2.low,btm:c.high,idx:i-2})}
  const pH=new Array(n).fill(0),pL=new Array(n).fill(0)
  for(let i=sw;i<n-sw;i++){let iPH=true,iPL=true;for(let j=i-sw;j<=i+sw;j++){if(j===i)continue;if(candles[j].high>=candles[i].high)iPH=false;if(candles[j].low<=candles[i].low)iPL=false};if(iPH)pH[i]=candles[i].high;if(iPL)pL[i]=candles[i].low}
  let lPH=0,lPL=999999
  for(let i=sw;i<n;i++){
    if(pH[i]>0)lPH=pH[i];if(pL[i]>0)lPL=pL[i]
    if(candles[i].close>lPH&&lPH>0){for(let j=i-1;j>=Math.max(0,i-sw*2);j--){if(candles[j].close<candles[j].open){bullOBs.push({top:Math.max(candles[j].open,candles[j].close),btm:Math.min(candles[j].open,candles[j].close),idx:j});lPH=0;break}}}
    if(candles[i].close<lPL&&lPL<999999){for(let j=i-1;j>=Math.max(0,i-sw*2);j--){if(candles[j].close>candles[j].open){bearOBs.push({top:Math.max(candles[j].open,candles[j].close),btm:Math.min(candles[j].open,candles[j].close),idx:j});lPL=999999;break}}}
  }
  const cp=candles[n-1].close
  return{bullOBs:bullOBs.filter(o=>o.top>cp*0.93).slice(-4),bearOBs:bearOBs.filter(o=>o.btm<cp*1.07).slice(-4),bullFVGs:bullFVGs.filter(f=>f.top>cp*0.90).slice(-4),bearFVGs:bearFVGs.filter(f=>f.btm<cp*1.10).slice(-4)}
}

interface MSDResult{swingHighs:{idx:number;price:number;type:'HH'|'LH'}[];swingLows:{idx:number;price:number;type:'HL'|'LL'}[];bosLines:{from:number;to:number;price:number;type:'BOS'|'CHoCH';dir:'bull'|'bear'}[]}
function calcMSD(candles:Candle[],sw=5):MSDResult{
  const n=candles.length,sH:MSDResult['swingHighs']=[],sL:MSDResult['swingLows']=[],bos:MSDResult['bosLines']=[]
  if(n<sw*2+2)return{swingHighs:sH,swingLows:sL,bosLines:bos}
  let pPH=0,pPL=999999,trend=1
  for(let i=sw;i<n-sw;i++){
    let isPH=true,isPL=true;for(let j=i-sw;j<=i+sw;j++){if(j===i)continue;if(candles[j].high>=candles[i].high)isPH=false;if(candles[j].low<=candles[i].low)isPL=false}
    if(isPH){sH.push({idx:i,price:candles[i].high,type:candles[i].high>pPH?'HH':'LH'});if(pPH>0){for(let k=i+1;k<Math.min(n,i+sw*3);k++){if(candles[k].close>pPH){bos.push({from:i-sw,to:k,price:pPH,type:trend===1?'BOS':'CHoCH',dir:'bull'});if(trend!==1)trend=1;break}}};pPH=candles[i].high}
    if(isPL){sL.push({idx:i,price:candles[i].low,type:candles[i].low<pPL?'LL':'HL'});if(pPL<999999){for(let k=i+1;k<Math.min(n,i+sw*3);k++){if(candles[k].close<pPL){bos.push({from:i-sw,to:k,price:pPL,type:trend===-1?'BOS':'CHoCH',dir:'bear'});if(trend!==-1)trend=-1;break}}};pPL=candles[i].low}
  }
  return{swingHighs:sH.slice(-10),swingLows:sL.slice(-10),bosLines:bos.slice(-6)}
}

interface MPResult{poc:number;vah:number;val:number;profile:{price:number;vol:number}[]}
function calcMP(candles:Candle[],bins=30):MPResult|null{
  if(!candles.length)return null
  const hi=Math.max(...candles.map(c=>c.high)),lo=Math.min(...candles.map(c=>c.low))
  if(hi<=lo)return null
  const step=(hi-lo)/bins,buckets=Array.from({length:bins},(_,i)=>({price:lo+step*(i+0.5),vol:0}))
  for(const c of candles){const v=(c.volume||1)/bins;for(let i=0;i<bins;i++)if(c.low<=lo+step*(i+1)&&c.high>=lo+step*i)buckets[i].vol+=v}
  const maxV=Math.max(...buckets.map(b=>b.vol)),pocIdx=buckets.findIndex(b=>b.vol===maxV)
  const total=buckets.reduce((a,b)=>a+b.vol,0);let sum=buckets[pocIdx].vol,lo_=pocIdx,hi_=pocIdx
  while(sum<total*0.7&&(lo_>0||hi_<bins-1)){if(hi_<bins-1){hi_++;sum+=buckets[hi_].vol};if(lo_>0){lo_--;sum+=buckets[lo_].vol}}
  return{poc:buckets[pocIdx].price,vah:buckets[hi_].price+step/2,val:buckets[lo_].price-step/2,profile:buckets}
}

// ── Indicator settings types ──────────────────────────────────────────────
interface VMCSettings{smoothLen:number;signalMult:number;upThreshold:number;loThreshold:number;ribbonMin:number}
interface SMCSettings{swingLen:number;showOB:boolean;showFVG:boolean;obCount:number}
interface MSDSettings{swingLen:number;showBOS:boolean;showSwings:boolean}
interface MPSettings{bins:number;showProfile:boolean}

// ── VMC Panel ─────────────────────────────────────────────────────────────
function VMCPanel({vmcResult,settings}:{vmcResult:VMCResult;settings:VMCSettings}) {
  const ref=useRef<HTMLCanvasElement>(null)
  useEffect(()=>{
    const canvas=ref.current;if(!canvas||!vmcResult)return
    const draw=()=>{
      const dpr=window.devicePixelRatio||1,cw=canvas.offsetWidth,ch=canvas.offsetHeight
      canvas.width=cw*dpr;canvas.height=ch*dpr;canvas.style.width=cw+'px';canvas.style.height=ch+'px'
      const ctx=canvas.getContext('2d')!;ctx.scale(dpr,dpr);ctx.clearRect(0,0,cw,ch);ctx.fillStyle='#0D1117';ctx.fillRect(0,0,cw,ch)
      const n=vmcResult.sig.length,vis=Math.min(n,Math.floor(cw/2))
      const sig=vmcResult.sig.slice(-vis),ss=vmcResult.sigSignal.slice(-vis),mom=vmcResult.mom.slice(-vis),len=sig.length
      if(!len)return
      const minV=Math.min(...sig,...ss,-70),maxV=Math.max(...sig,...ss,70),rng=maxV-minV||1
      const toY=(v:number)=>ch*0.88-((v-minV)/rng)*(ch*0.78),toX=(i:number)=>(i/(len-1||1))*cw
      ctx.strokeStyle='#2A2F3E';ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(0,toY(0));ctx.lineTo(cw,toY(0));ctx.stroke();ctx.setLineDash([])
      const uT=settings.upThreshold,lT=settings.loThreshold
      for(const t of[uT,lT]){
        ctx.strokeStyle=t>0?'rgba(255,59,48,0.3)':'rgba(34,199,89,0.3)';ctx.lineWidth=1;ctx.setLineDash([3,5])
        ctx.beginPath();ctx.moveTo(0,toY(t));ctx.lineTo(cw,toY(t));ctx.stroke();ctx.setLineDash([])
        ctx.font='bold 9px JetBrains Mono, monospace';ctx.fillStyle=t>0?'#FF3B3090':'#22C75990'
        ctx.fillText(t>0?`+${uT}`:String(lT),3,toY(t)-3)
      }
      const bw=Math.max(1,cw/len-0.5)
      for(let i=0;i<len;i++){const m=mom[i],x=toX(i)-bw/2,y0=toY(0),ym=toY(m);ctx.fillStyle=m>=0?'rgba(34,199,89,0.45)':'rgba(255,59,48,0.45)';ctx.fillRect(x,Math.min(ym,y0),bw,Math.abs(ym-y0))}
      ctx.beginPath();for(let i=0;i<len;i++)i===0?ctx.moveTo(toX(i),toY(sig[i])):ctx.lineTo(toX(i),toY(sig[i]));for(let i=len-1;i>=0;i--)ctx.lineTo(toX(i),toY(ss[i]));ctx.closePath()
      const bull=vmcResult.isBull[vmcResult.isBull.length-1];ctx.fillStyle=bull?'rgba(34,199,89,0.12)':'rgba(255,59,48,0.12)';ctx.fill()
      ctx.strokeStyle='#00E5FF';ctx.lineWidth=2;ctx.beginPath();for(let i=0;i<len;i++)i===0?ctx.moveTo(toX(i),toY(sig[i])):ctx.lineTo(toX(i),toY(sig[i]));ctx.stroke()
      ctx.strokeStyle='#FF9500';ctx.lineWidth=1.5;ctx.beginPath();for(let i=0;i<len;i++)i===0?ctx.moveTo(toX(i),toY(ss[i])):ctx.lineTo(toX(i),toY(ss[i]));ctx.stroke()
      const off=n-len
      for(const idx of vmcResult.buySignals){const ri=idx-off;if(ri<0||ri>=len)continue;const x=toX(ri);ctx.fillStyle='#22C759';ctx.beginPath();ctx.moveTo(x,ch-2);ctx.lineTo(x-5,ch-12);ctx.lineTo(x+5,ch-12);ctx.closePath();ctx.fill()}
      for(const idx of vmcResult.sellSignals){const ri=idx-off;if(ri<0||ri>=len)continue;const x=toX(ri);ctx.fillStyle='#FF3B30';ctx.beginPath();ctx.moveTo(x,2);ctx.lineTo(x-5,12);ctx.lineTo(x+5,12);ctx.closePath();ctx.fill()}
      const last=sig[len-1];ctx.font='bold 9px JetBrains Mono, monospace';ctx.fillStyle='#00E5FF';ctx.fillText(`VMC ${last>=0?'+':''}${last.toFixed(1)}`,6,12);ctx.fillStyle=bull?'#22C759':'#FF3B30';ctx.fillText(bull?'▲ BULL':'▼ BEAR',75,12)
    }
    draw();const ro=new ResizeObserver(draw);ro.observe(canvas);return()=>ro.disconnect()
  },[vmcResult,settings])
  return(<div style={{borderTop:'1px solid #1E2330'}}><div style={{padding:'3px 14px',background:'rgba(191,90,242,0.06)',display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:9,fontWeight:700,color:'#BF5AF2'}}>〜 VMC</span><span style={{fontSize:8,color:'#555C70'}}>cyan=VMC · orange=Signal · ▲▼=signaux</span></div><canvas ref={ref} style={{width:'100%',height:90,display:'block'}}/></div>)
}

// ── Settings Panel ────────────────────────────────────────────────────────
interface SettingsPanelProps {
  activeId: string
  vmcSettings: VMCSettings; setVmcSettings: (s:VMCSettings)=>void
  smcSettings: SMCSettings; setSmcSettings: (s:SMCSettings)=>void
  msdSettings: MSDSettings; setMsdSettings: (s:MSDSettings)=>void
  mpSettings:  MPSettings;  setMpSettings:  (s:MPSettings)=>void
  onClose: ()=>void
}
function SettingsPanel({activeId,vmcSettings,setVmcSettings,smcSettings,setSmcSettings,msdSettings,setMsdSettings,mpSettings,setMpSettings,onClose}:SettingsPanelProps) {
  const Slider = ({label,value,min,max,step=1,onChange}:{label:string;value:number;min:number;max:number;step?:number;onChange:(v:number)=>void}) => (
    <div style={{marginBottom:10}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
        <span style={{fontSize:10,color:'#8F94A3'}}>{label}</span>
        <span style={{fontSize:10,fontWeight:700,color:'#F0F3FF',fontFamily:'JetBrains Mono'}}>{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(+e.target.value)}
        style={{width:'100%',accentColor:'#0A85FF',height:3}}/>
    </div>
  )
  const Toggle = ({label,value,onChange}:{label:string;value:boolean;onChange:(v:boolean)=>void}) => (
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
      <span style={{fontSize:10,color:'#8F94A3'}}>{label}</span>
      <div onClick={()=>onChange(!value)} style={{width:32,height:17,borderRadius:9,background:value?'#0A85FF':'#2A2F3E',cursor:'pointer',position:'relative',transition:'background 0.2s'}}>
        <div style={{position:'absolute',top:2,left:value?16:2,width:13,height:13,borderRadius:'50%',background:'#F0F3FF',transition:'left 0.2s'}}/>
      </div>
    </div>
  )
  return(
    <div style={{position:'absolute',top:0,right:0,bottom:0,width:240,background:'#161B22',borderLeft:'1px solid #1E2330',zIndex:20,display:'flex',flexDirection:'column'}}>
      <div style={{padding:'12px 14px',borderBottom:'1px solid #1E2330',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <span style={{fontSize:12,fontWeight:700,color:'#F0F3FF'}}>
          {activeId==='vmc'?'〜 VMC':activeId==='smc'?'🏦 SMC':activeId==='msd'?'📊 Structure':'📈 Mkt Profile'}
        </span>
        <button onClick={onClose} style={{background:'transparent',border:'none',color:'#555C70',cursor:'pointer',fontSize:16,padding:'0 4px'}}>✕</button>
      </div>
      <div style={{flex:1,overflowY:'auto',padding:'12px 14px'}}>
        {activeId==='vmc'&&(<>
          <Slider label="Lissage VMC" value={vmcSettings.smoothLen} min={3} max={30} onChange={v=>setVmcSettings({...vmcSettings,smoothLen:v})}/>
          <Slider label="Multiplicateur signal" value={vmcSettings.signalMult} min={1.1} max={3} step={0.05} onChange={v=>setVmcSettings({...vmcSettings,signalMult:v})}/>
          <Slider label="Seuil haut" value={vmcSettings.upThreshold} min={10} max={80} onChange={v=>setVmcSettings({...vmcSettings,upThreshold:v})}/>
          <Slider label="Seuil bas" value={vmcSettings.loThreshold} min={-80} max={-10} onChange={v=>setVmcSettings({...vmcSettings,loThreshold:v})}/>
          <Slider label="Paires EMA ribbon min" value={vmcSettings.ribbonMin} min={3} max={7} onChange={v=>setVmcSettings({...vmcSettings,ribbonMin:v})}/>
        </>)}
        {activeId==='smc'&&(<>
          <Slider label="Longueur swing" value={smcSettings.swingLen} min={3} max={30} onChange={v=>setSmcSettings({...smcSettings,swingLen:v})}/>
          <Slider label="Nb max OB affichés" value={smcSettings.obCount} min={1} max={8} onChange={v=>setSmcSettings({...smcSettings,obCount:v})}/>
          <Toggle label="Afficher Order Blocks" value={smcSettings.showOB} onChange={v=>setSmcSettings({...smcSettings,showOB:v})}/>
          <Toggle label="Afficher FVGs" value={smcSettings.showFVG} onChange={v=>setSmcSettings({...smcSettings,showFVG:v})}/>
        </>)}
        {activeId==='msd'&&(<>
          <Slider label="Longueur swing" value={msdSettings.swingLen} min={3} max={20} onChange={v=>setMsdSettings({...msdSettings,swingLen:v})}/>
          <Toggle label="Afficher BOS/CHoCH" value={msdSettings.showBOS} onChange={v=>setMsdSettings({...msdSettings,showBOS:v})}/>
          <Toggle label="Afficher labels HH/LL…" value={msdSettings.showSwings} onChange={v=>setMsdSettings({...msdSettings,showSwings:v})}/>
        </>)}
        {activeId==='mp'&&(<>
          <Slider label="Résolution (bins)" value={mpSettings.bins} min={10} max={60} onChange={v=>setMpSettings({...mpSettings,bins:v})}/>
          <Toggle label="Afficher histogramme" value={mpSettings.showProfile} onChange={v=>setMpSettings({...mpSettings,showProfile:v})}/>
        </>)}
      </div>
      <div style={{padding:'10px 14px',borderTop:'1px solid #1E2330'}}>
        <div style={{fontSize:9,color:'#3D4254',textAlign:'center'}}>Les modifications s'appliquent en temps réel</div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// ── MAIN COMPONENT ────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════
export default function LightweightChart({symbol,isCrypto}:Props) {
  const chartEl  = useRef<HTMLDivElement>(null)
  const overlayEl = useRef<HTMLCanvasElement>(null)
  const chartApi = useRef<IChartApi|null>(null)
  const seriesR  = useRef<ISeriesApi<'Candlestick'>|null>(null)
  const wsRef    = useRef<WebSocket|null>(null)
  const candlesRef = useRef<Candle[]>([])
  const mpLinesRef = useRef<any[]>([])

  const [tf,       setTf]       = useState(TIMEFRAMES[2])
  const [tool,     setTool]     = useState<ToolId>('cursor')
  const [magnet,   setMagnet]   = useState(false)
  const [color,    setColor]    = useState('#FF9500')
  const [liveP,    setLiveP]    = useState<number|null>(null)
  const [change,   setChange]   = useState(0)
  const [loading,  setLoading]  = useState(true)
  const [fetchError, setFetchError] = useState<string|null>(null)
  const [drawings, setDrawings] = useState<SavedDrawing[]>([])
  const [showHist, setShowHist] = useState(false)
  const [selectedId, setSelectedId] = useState<string|null>(null)
  const [hoverPoint, setHoverPoint] = useState<{x:number;y:number;price:number;time:number}|null>(null)
  const [toast,    setToast]    = useState<string|null>(null)
  const [saving,   setSaving]   = useState(false)
  const [confirm,  setConfirm]  = useState<{type:ToolId;p1:DrawingPoint;p2?:DrawingPoint}|null>(null)
  const [labelInput, setLabelInput] = useState('')
  const [settingsOpen, setSettingsOpen] = useState<string|null>(null)

  // Indicator toggles
  const [indOn, setIndOn] = useState<Record<string,boolean>>({smc:false,msd:false,vmc:false,mp:false})

  // Indicator settings
  const [vmcS, setVmcS] = useState<VMCSettings>({smoothLen:10,signalMult:1.75,upThreshold:35,loThreshold:-35,ribbonMin:5})
  const [smcS, setSmcS] = useState<SMCSettings>({swingLen:10,showOB:true,showFVG:true,obCount:4})
  const [msdS, setMsdS] = useState<MSDSettings>({swingLen:5,showBOS:true,showSwings:true})
  const [mpS,  setMpS]  = useState<MPSettings>({bins:30,showProfile:true})

  // Computed results
  const [smcResult, setSmcResult] = useState<SMCResult|null>(null)
  const [msdResult, setMsdResult] = useState<MSDResult|null>(null)
  const [vmcResult, setVmcResult] = useState<VMCResult|null>(null)
  const [mpResult,  setMpResult]  = useState<MPResult|null>(null)

  // Recalculate when settings change
  useEffect(()=>{const c=candlesRef.current;if(c.length)setSmcResult(calcSMC(c,smcS.swingLen))},[smcS.swingLen])
  useEffect(()=>{const c=candlesRef.current;if(c.length)setMsdResult(calcMSD(c,msdS.swingLen))},[msdS.swingLen])
  useEffect(()=>{const c=candlesRef.current;if(c.length)setVmcResult(calcVMC(c,vmcS.smoothLen,vmcS.signalMult,vmcS.upThreshold,vmcS.loThreshold))},[vmcS])
  useEffect(()=>{const c=candlesRef.current;if(c.length)setMpResult(calcMP(c,mpS.bins))},[mpS.bins])

  // Drawing state
  const phase   = useRef<'idle'|'first'>('idle')
  const firstPt = useRef<DrawingPoint|null>(null)

  const toast$ = useCallback((m:string)=>{setToast(m);setTimeout(()=>setToast(null),2500)},[])
  const toggleInd = (id:string) => setIndOn(p=>({...p,[id]:!p[id]}))

  // ── Init Chart ───────────────────────────────────────────────────────
  useEffect(()=>{
    const el=chartEl.current;if(!el)return
    const c=createChart(el,{
      width:el.clientWidth,height:430,
      layout:{background:{color:'#0D1117'},textColor:'#6B7280',fontSize:11,fontFamily:'JetBrains Mono, monospace'},
      grid:{vertLines:{color:'#1E233028'},horzLines:{color:'#1E233028'}},
      crosshair:{mode:CrosshairMode.Normal,vertLine:{color:'#555C7060',style:LineStyle.Solid,width:1,labelBackgroundColor:'#2A2F3E'},horzLine:{color:'#555C7060',style:LineStyle.Solid,width:1,labelBackgroundColor:'#2A2F3E'}},
      rightPriceScale:{borderColor:'#1E2330',scaleMargins:{top:0.05,bottom:0.05}},
      timeScale:{borderColor:'#1E2330',timeVisible:true,secondsVisible:false},
    })
    chartApi.current=c
    seriesR.current=c.addCandlestickSeries({
      upColor:'#22C759',downColor:'#FF3B30',
      borderUpColor:'#22C759',borderDownColor:'#FF3B30',
      wickUpColor:'#22C75990',wickDownColor:'#FF3B3090',
      priceLineVisible:false,
    })
    const ro=new ResizeObserver(()=>c.applyOptions({width:el.clientWidth}))
    ro.observe(el)
    return()=>{ro.disconnect();c.remove();chartApi.current=null;seriesR.current=null}
  },[])

  // ── Load candles ─────────────────────────────────────────────────────
  const load=useCallback(async()=>{
    if(!seriesR.current)return
    setLoading(true);wsRef.current?.close();setFetchError(null)
    let candles: Candle[] = []
    try {
      candles = await fetchCandles(symbol, isCrypto, tf.min)
    } catch(e: any) {
      setFetchError(e?.message || 'Erreur de chargement')
      setLoading(false)
      return
    }
    if(candles.length){
      seriesR.current.setData(candles.map(c=>({time:c.time as Time,open:c.open,high:c.high,low:c.low,close:c.close})))
      candlesRef.current=candles
      const last=candles[candles.length-1],first=candles[0]
      setLiveP(last.close);setChange(((last.close-first.open)/first.open)*100)
      chartApi.current?.timeScale().fitContent()
      setSmcResult(calcSMC(candles,smcS.swingLen))
      setMsdResult(calcMSD(candles,msdS.swingLen))
      setVmcResult(calcVMC(candles,vmcS.smoothLen,vmcS.signalMult,vmcS.upThreshold,vmcS.loThreshold))
      setMpResult(calcMP(candles,mpS.bins))
      setFetchError(null)
    }
    setLoading(false)
    if(isCrypto){
      const s=symbol.toLowerCase().replace(/usdt$/,'')+'usdt'
      const tryWS=(url:string)=>{
        const ws=new WebSocket(url)
        ws.onerror=()=>{if(url.includes('fstream'))tryWS(`wss://stream.binance.com:9443/ws/${s}@kline_${tfStr(tf.min)}`)}
        ws.onmessage=(e)=>{try{const k=JSON.parse(e.data).k;if(!k||!seriesR.current)return;seriesR.current.update({time:Math.floor(k.t/1000) as Time,open:+k.o,high:+k.h,low:+k.l,close:+k.c});setLiveP(+k.c)}catch{}}
        wsRef.current=ws
      }
      tryWS(`wss://fstream.binance.com/ws/${s}@kline_${tfStr(tf.min)}`)
    }
  },[symbol,isCrypto,tf])

  useEffect(()=>{load()},[load])
  useEffect(()=>()=>{wsRef.current?.close()},[])
  useEffect(()=>{dbLoad(symbol,tf.label).then(setDrawings)},[symbol,tf.label])

  // ── MP price lines ────────────────────────────────────────────────────
  useEffect(()=>{
    const ser=seriesR.current;if(!ser)return
    mpLinesRef.current.forEach(l=>{try{ser.removePriceLine(l)}catch{}});mpLinesRef.current=[]
    if(indOn.mp&&mpResult){
      [[mpResult.poc,'#FF9500','POC',LineStyle.Solid,2],[mpResult.vah,'#22C759','VAH',LineStyle.Dashed,1],[mpResult.val,'#22C759','VAL',LineStyle.Dashed,1]].forEach(([price,color,title,lineStyle,lineWidth])=>{
        try{const pl=ser.createPriceLine({price:price as number,color:color as string,lineWidth:lineWidth as any,lineStyle:lineStyle as any,axisLabelVisible:true,title:title as string});mpLinesRef.current.push(pl)}catch{}
      })
    }
  },[indOn.mp,mpResult])

  // ── Magnet: snap to nearest OHLC ─────────────────────────────────────
  const snapPrice=useCallback((price:number,time:number):number=>{
    if(!magnet)return price
    const candles=candlesRef.current
    const c=candles.find(c=>c.time===time)||candles.reduce((a,b)=>Math.abs(b.time-time)<Math.abs(a.time-time)?b:a,candles[0])
    if(!c)return price
    const levels=[c.open,c.high,c.low,c.close]
    return levels.reduce((a,b)=>Math.abs(b-price)<Math.abs(a-price)?b:a)
  },[magnet])

  // ── Canvas overlay render ─────────────────────────────────────────────
  const render=useCallback(()=>{
    const canvas=overlayEl.current;const chart=chartApi.current;const ser=seriesR.current
    if(!canvas||!chart||!ser)return
    const dpr=window.devicePixelRatio||1,cw=canvas.offsetWidth,ch=canvas.offsetHeight
    canvas.width=cw*dpr;canvas.height=ch*dpr;canvas.style.width=cw+'px';canvas.style.height=ch+'px'
    const ctx=canvas.getContext('2d')!;ctx.scale(dpr,dpr);ctx.clearRect(0,0,cw,ch)

    const toX=(time:number):number|null=>{try{return chart.timeScale().timeToCoordinate(time as Time)}catch{return null}}
    const toY=(price:number):number|null=>{try{return ser.priceToCoordinate(price)}catch{return null}}
    const candles=candlesRef.current

    // ── Draw saved drawings ──────────────────────────────────────────
    for(const d of drawings){
      const isSelected=d.id===selectedId
      ctx.save()
      ctx.strokeStyle=d.color;ctx.fillStyle=d.color;ctx.lineWidth=isSelected?2.5:1.5

      if(d.type==='hline'){
        const y=toY(d.p1.price);if(y==null){ctx.restore();continue}
        if(isSelected){ctx.shadowColor=d.color;ctx.shadowBlur=8}
        ctx.setLineDash([8,5]);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(cw,y);ctx.stroke();ctx.setLineDash([])
        const lbl=d.label?`${d.label}  ${fmtP(d.p1.price)}`:fmtP(d.p1.price)
        ctx.font='bold 10px JetBrains Mono, monospace';const tw=ctx.measureText(lbl).width+16
        ctx.fillStyle=d.color+'28';ctx.beginPath();ctx.roundRect?.(cw-tw-4,y-11,tw,18,4);ctx.fill()
        ctx.fillStyle=d.color;ctx.fillText(lbl,cw-tw+4,y+4)
        if(isSelected){ctx.fillStyle='#F0F3FF';ctx.beginPath();ctx.arc(cw/2,y,4,0,Math.PI*2);ctx.fill()}
      }

      else if(d.type==='trendline'&&d.p2){
        const x1=toX(d.p1.time)??0,y1=toY(d.p1.price),x2=toX(d.p2.time)??cw,y2=toY(d.p2.price)
        if(y1==null||y2==null){ctx.restore();continue}
        if(isSelected){ctx.shadowColor=d.color;ctx.shadowBlur=8}
        const slope=(y2-y1)/(x2-x1||1)
        const extY1=y1-slope*x1,extY2=y1+slope*(cw-x1)
        ctx.beginPath();ctx.moveTo(0,extY1);ctx.lineTo(cw,extY2);ctx.stroke()
        // Anchors
        for(const [ax,ay] of[[x1,y1],[x2,y2]]){ctx.beginPath();ctx.arc(ax,ay,isSelected?5:3,0,Math.PI*2);ctx.fill()}
      }

      else if(d.type==='fibo'&&d.p2){
        const hi=Math.max(d.p1.price,d.p2.price),lo=Math.min(d.p1.price,d.p2.price),rng=hi-lo
        const x1=toX(d.p1.time)??0,x2=toX(d.p2.time)??cw
        const startX=Math.min(x1,x2),endX=Math.max(x1,x2)
        if(isSelected){ctx.shadowColor=d.color;ctx.shadowBlur=6}
        ctx.font='bold 9px JetBrains Mono, monospace'
        for(let i=0;i<FIBO_LEVELS.length;i++){
          const lvl=FIBO_LEVELS[i],price=hi-rng*lvl.r,y=toY(price);if(y==null)continue
          if(i<FIBO_LEVELS.length-1){
            const ny=toY(hi-rng*FIBO_LEVELS[i+1].r);if(ny!=null){ctx.fillStyle=d.color+(lvl.r===0.618?'20':'0a');ctx.fillRect(startX,Math.min(y,ny),endX-startX,Math.abs(ny-y))}
          }
          const isKey=[0,0.382,0.5,0.618,1].includes(lvl.r)
          ctx.globalAlpha=isKey?0.9:0.5;ctx.lineWidth=isKey?1.5:0.8;ctx.setLineDash(isKey?[]:[4,4])
          ctx.beginPath();ctx.moveTo(startX,y);ctx.lineTo(cw,y);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1
          const lbl=`${lvl.l}  ${fmtP(price)}`;const tw=ctx.measureText(lbl).width
          ctx.fillStyle=d.color;ctx.globalAlpha=isKey?0.95:0.6;ctx.fillText(lbl,cw-tw-4,y-3);ctx.globalAlpha=1
        }
      }

      else if(d.type==='rect'&&d.p2){
        const x1=toX(d.p1.time),x2=toX(d.p2.time),y1=toY(d.p1.price),y2=toY(d.p2.price)
        if(x1==null||x2==null||y1==null||y2==null){ctx.restore();continue}
        if(isSelected){ctx.shadowColor=d.color;ctx.shadowBlur=8}
        const rx=Math.min(x1,x2),ry=Math.min(y1,y2),rw=Math.abs(x2-x1),rh=Math.abs(y2-y1)
        ctx.fillStyle=d.color+'18';ctx.fillRect(rx,ry,rw,rh)
        ctx.strokeRect(rx,ry,rw,rh)
        // Corner handles when selected
        if(isSelected){for(const [hx,hy] of[[rx,ry],[rx+rw,ry],[rx,ry+rh],[rx+rw,ry+rh]]){ctx.fillStyle='#F0F3FF';ctx.beginPath();ctx.arc(hx,hy,4,0,Math.PI*2);ctx.fill()}}
      }

      else if(d.type==='note'){
        const x=toX(d.p1.time),y=toY(d.p1.price);if(x==null||y==null){ctx.restore();continue}
        if(isSelected){ctx.shadowColor=d.color;ctx.shadowBlur=8}
        const txt='✎ '+(d.label||'Note');ctx.font='bold 10px JetBrains Mono, monospace'
        const tw=ctx.measureText(txt).width+20
        ctx.fillStyle=d.color+'25';ctx.strokeStyle=d.color;ctx.lineWidth=1
        ctx.beginPath();ctx.roundRect?.(x,y-12,tw,22,5);ctx.fill();ctx.stroke()
        ctx.fillStyle=d.color;ctx.fillText(txt,x+8,y+4)
      }

      // Delete X button when selected
      if(isSelected){
        const delX=d.type==='hline'?cw-16:toX(d.p2?.time??d.p1.time)??cw/2
        const delY=toY(d.p1.price)
        if(delY!=null){
          ctx.shadowBlur=0
          ctx.fillStyle='#FF3B30';ctx.beginPath();ctx.arc(delX,delY-18,9,0,Math.PI*2);ctx.fill()
          ctx.strokeStyle='#F0F3FF';ctx.lineWidth=1.5
          ctx.beginPath();ctx.moveTo(delX-4,delY-22);ctx.lineTo(delX+4,delY-14);ctx.stroke()
          ctx.beginPath();ctx.moveTo(delX+4,delY-22);ctx.lineTo(delX-4,delY-14);ctx.stroke()
        }
      }
      ctx.restore()
    }

    // ── Preview while drawing ─────────────────────────────────────────
    if(hoverPoint&&phase.current==='first'&&firstPt.current){
      ctx.save();ctx.globalAlpha=0.6;ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.setLineDash([6,4])
      const x1=toX(firstPt.current.time)??0,y1=toY(firstPt.current.price),x2=hoverPoint.x,y2=hoverPoint.y
      if(y1!=null){
        if(tool==='trendline'){ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke()}
        else if(tool==='fibo'){const hi=Math.max(firstPt.current.price,hoverPoint.price),lo=Math.min(firstPt.current.price,hoverPoint.price),rng=hi-lo;FIBO_LEVELS.forEach(lvl=>{const y=toY(hi-rng*lvl.r);if(y!=null){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(cw,y);ctx.stroke()}})}
        else if(tool==='rect'){const rx=Math.min(x1,x2),ry=Math.min(y1,y2),rw=Math.abs(x2-x1),rh=Math.abs(y2-y1);ctx.fillStyle=color+'15';ctx.fillRect(rx,ry,rw,rh);ctx.strokeRect(rx,ry,rw,rh)}
      }
      ctx.setLineDash([]);ctx.restore()
    }

    // ── Magnet indicator ──────────────────────────────────────────────
    if(magnet&&hoverPoint){
      const snapped=snapPrice(hoverPoint.price,hoverPoint.time)
      const y=toY(snapped);if(y!=null){
        ctx.save();ctx.strokeStyle='#FFD60A';ctx.lineWidth=1;ctx.setLineDash([3,3])
        ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(cw,y);ctx.stroke();ctx.setLineDash([])
        ctx.fillStyle='#FFD60A';ctx.beginPath();ctx.arc(hoverPoint.x,y,5,0,Math.PI*2);ctx.fill()
        ctx.restore()
      }
    }

    // ── SMC ───────────────────────────────────────────────────────────
    if(indOn.smc&&smcResult){
      const drawZone=(top:number,btm:number,idx:number,fill:string,border:string,lbl:string)=>{
        const t=candles[idx]?.time;const x=t?toX(t)??0:0;const y1=toY(top),y2=toY(btm);if(y1==null||y2==null)return
        ctx.fillStyle=fill;ctx.strokeStyle=border;ctx.lineWidth=1
        ctx.fillRect(x,Math.min(y1,y2),cw-x,Math.abs(y2-y1));ctx.strokeRect(x,Math.min(y1,y2),cw-x,Math.abs(y2-y1))
        ctx.font='bold 9px JetBrains Mono, monospace';ctx.fillStyle=border;ctx.fillText(lbl,x+4,Math.min(y1,y2)+12)
      }
      if(smcS.showOB){
        smcResult.bullOBs.slice(0,smcS.obCount).forEach(ob=>drawZone(ob.top,ob.btm,ob.idx,'rgba(10,133,255,0.10)','rgba(10,133,255,0.75)','Bull OB'))
        smcResult.bearOBs.slice(0,smcS.obCount).forEach(ob=>drawZone(ob.top,ob.btm,ob.idx,'rgba(255,59,48,0.10)','rgba(255,59,48,0.75)','Bear OB'))
      }
      if(smcS.showFVG){
        smcResult.bullFVGs.forEach(fvg=>{const t=candles[fvg.idx]?.time;const x=t?toX(t)??0:0;const y1=toY(fvg.top),y2=toY(fvg.btm);if(y1==null||y2==null)return;ctx.fillStyle='rgba(34,199,89,0.07)';ctx.strokeStyle='rgba(34,199,89,0.5)';ctx.setLineDash([4,3]);ctx.fillRect(x,Math.min(y1,y2),cw-x,Math.abs(y2-y1));ctx.strokeRect(x,Math.min(y1,y2),cw-x,Math.abs(y2-y1));ctx.setLineDash([]);ctx.font='bold 9px JetBrains Mono, monospace';ctx.fillStyle='#22C759';ctx.fillText('FVG ↑',x+4,Math.min(y1,y2)+12)})
        smcResult.bearFVGs.forEach(fvg=>{const t=candles[fvg.idx]?.time;const x=t?toX(t)??0:0;const y1=toY(fvg.top),y2=toY(fvg.btm);if(y1==null||y2==null)return;ctx.fillStyle='rgba(255,149,0,0.07)';ctx.strokeStyle='rgba(255,149,0,0.5)';ctx.setLineDash([4,3]);ctx.fillRect(x,Math.min(y1,y2),cw-x,Math.abs(y2-y1));ctx.strokeRect(x,Math.min(y1,y2),cw-x,Math.abs(y2-y1));ctx.setLineDash([]);ctx.font='bold 9px JetBrains Mono, monospace';ctx.fillStyle='#FF9500';ctx.fillText('FVG ↓',x+4,Math.min(y1,y2)+12)})
      }
    }

    // ── MSD ───────────────────────────────────────────────────────────
    if(indOn.msd&&msdResult){
      ctx.font='bold 10px JetBrains Mono, monospace'
      if(msdS.showSwings){
        msdResult.swingHighs.forEach(sh=>{const t=candles[sh.idx]?.time;const x=t?toX(t):null;const y=toY(sh.price);if(x==null||y==null)return;ctx.fillStyle=sh.type==='HH'?'#FF3B30':'#FF9500';ctx.fillText(sh.type,x-10,y-8)})
        msdResult.swingLows.forEach(sl=>{const t=candles[sl.idx]?.time;const x=t?toX(t):null;const y=toY(sl.price);if(x==null||y==null)return;ctx.fillStyle=sl.type==='LL'?'#22C759':'#00E5FF';ctx.fillText(sl.type,x-10,y+16)})
      }
      if(msdS.showBOS){
        msdResult.bosLines.forEach(bos=>{
          const t1=candles[bos.from]?.time,t2=candles[bos.to]?.time;const x1=t1?toX(t1):null,x2=t2?toX(t2):null;const y=toY(bos.price);if(x1==null||x2==null||y==null)return
          ctx.strokeStyle=bos.type==='BOS'?(bos.dir==='bull'?'#22C759':'#FF3B30'):'#FFD60A';ctx.lineWidth=1;ctx.setLineDash([5,3])
          ctx.beginPath();ctx.moveTo(x1,y);ctx.lineTo(x2,y);ctx.stroke();ctx.setLineDash([])
          ctx.font='bold 9px JetBrains Mono, monospace';ctx.fillStyle=bos.type==='BOS'?(bos.dir==='bull'?'#22C759':'#FF3B30'):'#FFD60A';ctx.fillText(bos.type,(x1+x2)/2-10,y-4)
        })
      }
    }

    // ── VMC ribbon indicator ──────────────────────────────────────────
    if(indOn.vmc&&vmcResult){
      const bull=vmcResult.isBull[vmcResult.isBull.length-1],bear=vmcResult.isBear[vmcResult.isBear.length-1]
      ctx.fillStyle=bull?'rgba(34,199,89,0.10)':bear?'rgba(255,59,48,0.10)':'rgba(255,255,255,0.03)';ctx.fillRect(0,ch-10,cw,10)
      ctx.font='bold 8px JetBrains Mono, monospace';ctx.fillStyle=bull?'#22C759':bear?'#FF3B30':'#555C70';ctx.fillText(bull?'▲ BULL RIBBON':bear?'▼ BEAR RIBBON':'— NEUTRE',6,ch-2)
      const off=candles.length-vmcResult.sig.length
      vmcResult.buySignals.forEach(idx=>{const c=candles[idx+off];if(!c)return;const x=toX(c.time),y=toY(c.low);if(x==null||y==null)return;ctx.fillStyle='#22C759';ctx.beginPath();ctx.moveTo(x,y+24);ctx.lineTo(x-6,y+14);ctx.lineTo(x+6,y+14);ctx.closePath();ctx.fill()})
      vmcResult.sellSignals.forEach(idx=>{const c=candles[idx+off];if(!c)return;const x=toX(c.time),y=toY(c.high);if(x==null||y==null)return;ctx.fillStyle='#FF3B30';ctx.beginPath();ctx.moveTo(x,y-24);ctx.lineTo(x-6,y-14);ctx.lineTo(x+6,y-14);ctx.closePath();ctx.fill()})
    }

    // ── Market Profile histogram ──────────────────────────────────────
    if(indOn.mp&&mpResult&&mpS.showProfile){
      const maxV=Math.max(...mpResult.profile.map(b=>b.vol))
      const barMaxW=60
      mpResult.profile.forEach(b=>{
        const y=toY(b.price);if(y==null)return
        const bw=(b.vol/maxV)*barMaxW
        const isMid=Math.abs(b.price-mpResult!.poc)<(mpResult!.vah-mpResult!.val)*0.08
        ctx.fillStyle=isMid?'rgba(255,149,0,0.4)':`rgba(${b.price>mpResult!.poc?'34,199,89':'100,120,200'},0.25)`
        ctx.fillRect(cw-bw-2,y-2,bw,4)
      })
    }
  },[drawings,selectedId,hoverPoint,color,tool,magnet,indOn,smcResult,msdResult,vmcResult,mpResult,smcS,msdS,mpS,snapPrice])

  // RAF loop for smooth redraw on any viewport change
  useEffect(()=>{
    let raf:number;let lastKey=''
    const loop=()=>{
      const c=chartApi.current;const s=seriesR.current
      if(c&&s){try{const r=c.timeScale().getVisibleLogicalRange();const y=s.priceToCoordinate(candlesRef.current[candlesRef.current.length-1]?.close||0)??0;const k=JSON.stringify(r)+'|'+Math.round(y);if(k!==lastKey){lastKey=k;render()}}catch{}}
      raf=requestAnimationFrame(loop)
    }
    raf=requestAnimationFrame(loop);return()=>cancelAnimationFrame(raf)
  },[render])

  useEffect(()=>{const ro=new ResizeObserver(()=>render());if(overlayEl.current)ro.observe(overlayEl.current);return()=>ro.disconnect()},[render])

  // ── Mouse handlers on canvas ──────────────────────────────────────────
  const handleMouseMove=useCallback((e:React.MouseEvent<HTMLDivElement>)=>{
    const chart=chartApi.current;const ser=seriesR.current;if(!chart||!ser)return
    const rect=e.currentTarget.getBoundingClientRect()
    const x=e.clientX-rect.left,y=e.clientY-rect.top
    try{
      const logical=chart.timeScale().coordinateToLogical(x);if(logical===null)return
      const idx=Math.max(0,Math.min(candlesRef.current.length-1,Math.round(logical)))
      const time=candlesRef.current[idx]?.time
      const price=ser.coordinateToPrice(y)
      if(time&&price!=null)setHoverPoint({x,y,price:magnet?snapPrice(price,time):price,time})
    }catch{}
  },[magnet,snapPrice])

  const handleMouseLeave=useCallback(()=>setHoverPoint(null),[])

  // ── Click: place tool or select/delete drawing ────────────────────────
  const handleClick=useCallback((e:React.MouseEvent<HTMLDivElement>)=>{
    const chart=chartApi.current;const ser=seriesR.current;if(!chart||!ser)return
    const rect=e.currentTarget.getBoundingClientRect()
    const x=e.clientX-rect.left,y=e.clientY-rect.top

    // Check click on delete X button of selected drawing
    if(selectedId){
      const d=drawings.find(d=>d.id===selectedId)
      if(d){
        const delY=ser.priceToCoordinate(d.p1.price)
        const delX=d.type==='hline'?overlayEl.current!.offsetWidth-16:chart.timeScale().timeToCoordinate((d.p2?.time??d.p1.time) as Time)??overlayEl.current!.offsetWidth/2
        if(delY!=null&&Math.hypot(x-delX,y-(delY-18))<12){
          dbDelete(selectedId).then(()=>{setDrawings(p=>p.filter(dd=>dd.id!==selectedId));setSelectedId(null);toast$('Supprimé')})
          return
        }
      }
      // Click away deselects
      setSelectedId(null)
    }

    if(tool==='cursor'){
      // Try to select a drawing
      for(const d of drawings){
        const y1=ser.priceToCoordinate(d.p1.price);if(y1==null)continue
        let hit=false
        if(d.type==='hline'&&Math.abs(y-y1)<8)hit=true
        else if(d.type==='trendline'&&d.p2){
          const x1=chart.timeScale().timeToCoordinate(d.p1.time as Time)??0
          const x2=chart.timeScale().timeToCoordinate(d.p2.time as Time)??overlayEl.current!.offsetWidth
          const y2=ser.priceToCoordinate(d.p2.price);if(y2==null)continue
          const slope=(y2-y1)/(x2-x1||1);const projY=y1+slope*(x-x1);if(Math.abs(y-projY)<10)hit=true
        }
        else if((d.type==='fibo'||d.type==='rect')&&d.p2){
          const y2=ser.priceToCoordinate(d.p2.price);if(y2==null)continue
          if(y>Math.min(y1,y2)-8&&y<Math.max(y1,y2)+8)hit=true
        }
        else if(d.type==='note'&&Math.abs(y-y1)<14)hit=true
        if(hit){setSelectedId(d.id);return}
      }
      return
    }

    // Place drawing
    try{
      const logical=chart.timeScale().coordinateToLogical(x);if(logical===null)return
      const idx=Math.max(0,Math.min(candlesRef.current.length-1,Math.round(logical)))
      const time=candlesRef.current[idx]?.time;if(!time)return
      const rawPrice=ser.coordinateToPrice(y);if(rawPrice==null)return
      const price=magnet?snapPrice(rawPrice,time):rawPrice
      const pt:DrawingPoint={time,price}

      if(tool==='hline'||tool==='note'){setConfirm({type:tool,p1:pt});setLabelInput('');return}
      if(phase.current==='idle'){phase.current='first';firstPt.current=pt;toast$(`1er point @ ${fmtP(price)}`)}
      else{phase.current='idle';const p1=firstPt.current!;firstPt.current=null;setConfirm({type:tool,p1,p2:pt});setLabelInput('')}
    }catch{}
  },[tool,drawings,selectedId,magnet,snapPrice,toast$])

  // ── Keyboard: Delete key removes selected drawing ─────────────────────
  useEffect(()=>{
    const handler=(e:KeyboardEvent)=>{
      if((e.key==='Delete'||e.key==='Backspace')&&selectedId&&document.activeElement?.tagName!=='INPUT'){
        dbDelete(selectedId).then(()=>{setDrawings(p=>p.filter(d=>d.id!==selectedId));setSelectedId(null);toast$('Supprimé')})
      }
      if(e.key==='Escape'){setSelectedId(null);phase.current='idle';firstPt.current=null;setConfirm(null)}
    }
    window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)
  },[selectedId,toast$])

  // ── Save drawing ──────────────────────────────────────────────────────
  const handleSave=async()=>{
    if(!confirm)return;setSaving(true)
    try{
      const d:Drawing={type:confirm.type,symbol,tf:tf.label,p1:confirm.p1,p2:confirm.p2,label:labelInput||undefined,color,ts:Date.now()}
      const id=await dbSave(d)
      setDrawings(prev=>[{...d,id},...prev]);setConfirm(null);setLabelInput('');toast$('✓ Sauvegardé')
    }catch{toast$('Erreur')}
    setSaving(false)
  }

  const INDS=[
    {id:'smc',icon:'🏦',label:'SMC',color:'#0A85FF'},
    {id:'msd',icon:'📊',label:'Structure',color:'#22C759'},
    {id:'vmc',icon:'〜',label:'VMC',color:'#BF5AF2'},
    {id:'mp', icon:'📈',label:'Mkt Profile',color:'#FF9500'},
  ]
  const TOOLS=[
    {id:'cursor',icon:'↖',label:'Sélection'},
    {id:'hline',icon:'─',label:'H. ligne'},
    {id:'trendline',icon:'↗',label:'Tendance'},
    {id:'fibo',icon:'◎',label:'Fibonacci'},
    {id:'rect',icon:'▭',label:'Zone'},
    {id:'note',icon:'✎',label:'Note'},
  ]

  return(
    <div style={{background:'#161B22',border:'1px solid #1E2330',borderRadius:16,overflow:'hidden',marginBottom:16,position:'relative'}}>

      {/* Header */}
      <div style={{padding:'10px 14px',borderBottom:'1px solid #1E2330',display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
        <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
          <div style={{width:26,height:26,borderRadius:7,background:'linear-gradient(135deg,#22C759,#00E5FF)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13}}>⚡</div>
          <div><div style={{fontSize:11,fontWeight:700,color:'#F0F3FF'}}>Lightweight Charts</div><div style={{fontSize:9,color:'#555C70'}}>Sauvegarde Firestore · {symbol}</div></div>
        </div>
        {liveP&&<div style={{display:'flex',alignItems:'baseline',gap:5,marginLeft:4}}>
          <span style={{fontSize:15,fontWeight:700,color:'#F0F3FF',fontFamily:'JetBrains Mono, monospace'}}>{fmtP(liveP)}</span>
          <span style={{fontSize:10,fontWeight:700,color:change>=0?'#22C759':'#FF3B30'}}>{change>=0?'+':''}{change.toFixed(2)}%</span>
          <span style={{fontSize:8,color:'#22C75990'}}>● LIVE</span>
        </div>}
        <div style={{display:'flex',gap:3,marginLeft:4,flexWrap:'wrap'}}>
          {TIMEFRAMES.map(t=><button key={t.label} onClick={()=>setTf(t)} style={{padding:'3px 8px',borderRadius:6,fontSize:10,fontWeight:600,cursor:'pointer',border:`1px solid ${tf.label===t.label?'#00E5FF':'#2A2F3E'}`,background:tf.label===t.label?'rgba(0,229,255,0.12)':'transparent',color:tf.label===t.label?'#00E5FF':'#555C70'}}>{t.label}</button>)}
        </div>
        <button onClick={()=>setShowHist(x=>!x)} style={{marginLeft:'auto',padding:'3px 10px',borderRadius:6,fontSize:10,fontWeight:600,cursor:'pointer',border:`1px solid ${showHist?'#22C759':'#2A2F3E'}`,background:showHist?'rgba(34,199,89,0.1)':'transparent',color:showHist?'#22C759':'#555C70',flexShrink:0}}>
          💾 {drawings.length>0?`${drawings.length} dessin${drawings.length>1?'s':''}`:' Dessins'}
        </button>
      </div>

      {/* Indicateurs + settings */}
      <div style={{padding:'6px 14px',borderBottom:'1px solid #1E2330',display:'flex',alignItems:'center',gap:5,flexWrap:'wrap'}}>
        <span style={{fontSize:9,color:'#3D4254',fontWeight:700,flexShrink:0}}>INDICATEURS :</span>
        {INDS.map(ind=>(
          <div key={ind.id} style={{display:'flex',alignItems:'center',gap:0}}>
            <button onClick={()=>toggleInd(ind.id)} style={{display:'flex',alignItems:'center',gap:4,padding:'3px 8px',borderRadius:'6px 0 0 6px',fontSize:10,fontWeight:600,cursor:'pointer',
              border:`1px solid ${indOn[ind.id]?ind.color:'#2A2F3E'}`,borderRight:'none',
              background:indOn[ind.id]?`${ind.color}18`:'transparent',
              color:indOn[ind.id]?ind.color:'#555C70'}}>
              {ind.icon} {ind.label}
              {indOn[ind.id]&&<span style={{width:5,height:5,borderRadius:'50%',background:ind.color,display:'inline-block'}}/>}
            </button>
            <button onClick={()=>setSettingsOpen(settingsOpen===ind.id?null:ind.id)} style={{padding:'3px 6px',borderRadius:'0 6px 6px 0',fontSize:10,cursor:'pointer',
              border:`1px solid ${indOn[ind.id]?ind.color:'#2A2F3E'}`,
              background:settingsOpen===ind.id?`${ind.color}28`:'transparent',
              color:settingsOpen===ind.id?ind.color:'#555C70'}}>⚙</button>
          </div>
        ))}
      </div>

      {/* Outils dessin */}
      <div style={{padding:'5px 14px',borderBottom:'1px solid #1E2330',display:'flex',alignItems:'center',gap:4,flexWrap:'wrap'}}>
        {TOOLS.map(t=><button key={t.id} onClick={()=>{setTool(t.id as ToolId);phase.current='idle';firstPt.current=null;setSelectedId(null)}} style={{padding:'3px 9px',borderRadius:6,fontSize:10,fontWeight:600,cursor:'pointer',border:`1px solid ${tool===t.id?'#FF9500':'#2A2F3E'}`,background:tool===t.id?'rgba(255,149,0,0.12)':'transparent',color:tool===t.id?'#FF9500':'#555C70'}}>{t.icon} {t.label}</button>)}
        <div style={{width:1,height:14,background:'#2A2F3E',margin:'0 4px'}}/>
        {/* Magnet */}
        <button onClick={()=>setMagnet(m=>!m)} title="Aimant — colle aux OHLC" style={{padding:'3px 9px',borderRadius:6,fontSize:12,cursor:'pointer',border:`1px solid ${magnet?'#FFD60A':'#2A2F3E'}`,background:magnet?'rgba(255,214,10,0.12)':'transparent',color:magnet?'#FFD60A':'#555C70'}}>🧲</button>
        <div style={{width:1,height:14,background:'#2A2F3E',margin:'0 4px'}}/>
        {COLORS.map(c=><div key={c} onClick={()=>setColor(c)} style={{width:14,height:14,borderRadius:'50%',background:c,cursor:'pointer',flexShrink:0,outline:color===c?'2px solid #F0F3FF':'none',outlineOffset:1}}/>)}
        {selectedId&&<span style={{marginLeft:8,fontSize:9,color:'#FF3B30'}}>← Clic sur ✕ pour supprimer · Suppr. pour effacer</span>}
        {!selectedId&&tool!=='cursor'&&phase.current==='first'&&<span style={{fontSize:10,color:'#FF9500',fontWeight:700,marginLeft:4}}>← 2ème point</span>}
      </div>

      {/* Chart */}
      <div style={{position:'relative',background:'#0D1117'}} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} onClick={handleClick}>
        {loading&&<div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'#0D111790',zIndex:4}}><div style={{width:24,height:24,border:'2px solid #1E2330',borderTopColor:'#22C759',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/></div>}
        {!loading&&fetchError&&<div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'#0D1117',zIndex:4,gap:10}}>
          <span style={{fontSize:28}}>📊</span>
          <span style={{fontSize:12,color:'#FF3B30',fontWeight:600,textAlign:'center',maxWidth:280,padding:'0 20px'}}>{fetchError}</span>
          <span style={{fontSize:11,color:'#555C70',textAlign:'center',maxWidth:280,padding:'0 20px'}}>Essayez: AAPL · TSLA · MSFT · EURUSD=X · GC=F (Gold) · ^FCHI (CAC40) · BTC-USD</span>
          <button onClick={()=>load()} style={{padding:'6px 16px',borderRadius:8,background:'rgba(0,229,255,0.1)',border:'1px solid #00E5FF',color:'#00E5FF',cursor:'pointer',fontSize:11}}>Réessayer</button>
        </div>}
        <div ref={chartEl} style={{width:'100%',height:430}}/>
        <canvas ref={overlayEl} style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',zIndex:2,pointerEvents:'none'}}/>
        {/* Settings panel */}
        {settingsOpen&&<SettingsPanel activeId={settingsOpen} vmcSettings={vmcS} setVmcSettings={setVmcS} smcSettings={smcS} setSmcSettings={setSmcS} msdSettings={msdS} setMsdSettings={setMsdS} mpSettings={mpS} setMpSettings={setMpS} onClose={()=>setSettingsOpen(null)}/>}
      </div>

      {/* VMC Panel */}
      {indOn.vmc&&vmcResult&&<VMCPanel vmcResult={vmcResult} settings={vmcS}/>}

      {/* Confirm */}
      {confirm&&<div style={{padding:'10px 14px',background:'rgba(255,149,0,0.06)',borderTop:'1px solid rgba(255,149,0,0.2)',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <span style={{fontSize:11,fontWeight:700,color:'#FF9500',flexShrink:0}}>
          {confirm.type==='hline'?`─ @ ${fmtP(confirm.p1.price)}`:confirm.type==='trendline'?'↗ Tendance':confirm.type==='fibo'?'◎ Fibo':confirm.type==='rect'?'▭ Zone':'✎ Note'}
        </span>
        <input autoFocus value={labelInput} onChange={e=>setLabelInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')handleSave()}} placeholder={confirm.type==='note'?'Texte…':'Label optionnel…'} style={{flex:1,background:'#1C2130',border:'1px solid #2A2F3E',borderRadius:8,padding:'5px 10px',color:'#F0F3FF',fontSize:11,minWidth:120}}/>
        <button onClick={handleSave} disabled={saving} style={{padding:'5px 14px',borderRadius:8,fontSize:11,fontWeight:700,cursor:'pointer',background:'rgba(34,199,89,0.15)',border:'1px solid #22C759',color:'#22C759'}}>{saving?'…':'💾 Sauvegarder'}</button>
        <button onClick={()=>{setConfirm(null);phase.current='idle'}} style={{padding:'5px 10px',borderRadius:8,fontSize:11,cursor:'pointer',background:'transparent',border:'1px solid #2A2F3E',color:'#555C70'}}>✕</button>
      </div>}

      {/* History */}
      {showHist&&<div style={{borderTop:'1px solid #1E2330',maxHeight:200,overflowY:'auto'}}>
        {drawings.length===0?<div style={{padding:'14px',textAlign:'center',color:'#3D4254',fontSize:12}}>Aucun dessin pour {symbol} · {tf.label}</div>
        :drawings.map(d=><div key={d.id} onClick={()=>setSelectedId(d.id===selectedId?null:d.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'7px 14px',borderBottom:'1px solid rgba(255,255,255,0.03)',cursor:'pointer',background:d.id===selectedId?'rgba(255,149,0,0.05)':'transparent'}}>
          <div style={{width:3,height:26,borderRadius:2,background:d.color,flexShrink:0}}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:11,fontWeight:600,color:'#F0F3FF'}}>
              {d.type==='hline'?`─ @ ${fmtP(d.p1.price)}`:d.type==='trendline'?'↗ Tendance':d.type==='fibo'?'◎ Fibo':d.type==='rect'?'▭ Zone':`✎ ${d.label||'Note'}`}
            </div>
            <div style={{fontSize:9,color:'#3D4254'}}>{new Date(d.ts).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
          </div>
          <button onClick={async(e)=>{e.stopPropagation();await dbDelete(d.id);setDrawings(p=>p.filter(x=>x.id!==d.id));if(selectedId===d.id)setSelectedId(null);toast$('Supprimé')}}
            style={{background:'rgba(255,59,48,0.1)',border:'1px solid rgba(255,59,48,0.2)',borderRadius:6,color:'#FF3B30',cursor:'pointer',fontSize:10,padding:'3px 8px'}}>✕</button>
        </div>)}
      </div>}

      {toast&&<div style={{position:'absolute',bottom:16,left:'50%',transform:'translateX(-50%)',background:'#1C2130',border:'1px solid #2A2F3E',borderRadius:10,padding:'8px 16px',fontSize:12,color:'#F0F3FF',zIndex:10,whiteSpace:'nowrap',pointerEvents:'none',boxShadow:'0 4px 20px rgba(0,0,0,0.6)'}}>{toast}</div>}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
