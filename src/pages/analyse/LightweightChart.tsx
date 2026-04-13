// LightweightChart.tsx v5 — Canvas drawings + Magnet + Indicator settings
// Compatible lightweight-charts 4.1.x
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { createChart, IChartApi, ISeriesApi, CrosshairMode, Time, LineStyle } from 'lightweight-charts'
import { getAuth } from 'firebase/auth'
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, Timestamp } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'

const db = getFirestore(app)
const fbFn = getFunctions(app, 'europe-west1')

// ── Types ─────────────────────────────────────────────────────────────────
interface Props {
  symbol: string
  isCrypto: boolean
  onTimeframeChange?: (interval: string) => void
  onVisibleRangeChange?: (from: number, to: number) => void
  syncRangeIn?: {from: number; to: number} | null
  onCrosshairChange?: (data: { frac: number; areaRatio: number } | null) => void
  chartHeight?: number  // override default 430px (used in fullscreen)
  autoHeight?: boolean  // fill flex parent instead of fixed height
}
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
const COLORS = ['var(--tm-loss)','var(--tm-warning)','#FFD60A','var(--tm-profit)','var(--tm-accent)','var(--tm-blue)','var(--tm-purple)','var(--tm-text-primary)']
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

  // ── 2. Non-crypto → fetchYahooCandles (Cloud Function, gratuit, sans limite) ─
  const TF_TO_YH_INTERVAL: Record<number,string> = {
    1:'1m',5:'5m',15:'15m',30:'30m',60:'1h',120:'1h',240:'1h',1440:'1d',10080:'1wk'
  }
  const TF_TO_YH_RANGE: Record<number,string> = {
    1:'1d',5:'5d',15:'5d',30:'1mo',60:'1mo',120:'3mo',240:'3mo',1440:'1y',10080:'2y'
  }
  const yhInterval = TF_TO_YH_INTERVAL[min] || '1d'
  const yhRange    = TF_TO_YH_RANGE[min]    || '1y'

  // Yahoo Finance via Cloud Function — essaie le symbole direct + variantes européennes
  const fn = httpsCallable<Record<string,unknown>, {s:string; candles:{t:number;o:number;h:number;l:number;c:number;v:number}[]}>(fbFn, 'fetchYahooCandles')
  const res = await fn({ symbol: s, interval: yhInterval, range: yhRange })
  if (res.data.s === 'ok' && res.data.candles && res.data.candles.length > 5) {
    return res.data.candles.map(c => ({
      time:   c.t,
      open:   c.o,
      high:   c.h,
      low:    c.l,
      close:  c.c,
      volume: c.v,
    }))
  }

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
function calcVMC(candles:Candle[],smoothLen=10,signalMult=1.75,upT=35,loT=-35,rsiLen=14,stochSmooth=2,mfiWeight=0.4):VMCResult{
  const cl=candles.map(c=>c.close),hlc3=candles.map(c=>(c.high+c.low+c.close)/3)
  const rv=rsiCalc(cl,rsiLen),rH=highest(rv,rsiLen),rL=lowest(rv,rsiLen)
  const stoch=sma(rv.map((r,i)=>rH[i]===rL[i]?0:(r-rL[i])/(rH[i]-rL[i])*100),Math.max(1,stochSmooth))
  const mfi=hlc3.map((_,i)=>i===0?50:hlc3[i]>hlc3[i-1]?60:hlc3[i]<hlc3[i-1]?40:50)
  const w=Math.max(0.1,Math.min(0.9,mfiWeight))
  const core=hlc3.map((_,i)=>(rv[i]+w*mfi[i]+w*stoch[i])/(1+2*w))
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

// ── RSI Divergences ───────────────────────────────────────────────────────
interface RSIDivPair{type:'bull'|'bear';leftIdx:number;rightIdx:number;leftPrice:number;rightPrice:number}
interface RSIDivResult{bullDivs:RSIDivPair[];bearDivs:RSIDivPair[];rsi:number[]}
function calcRSI(closes:number[],period=14):number[]{
  const rsi=new Array(closes.length).fill(50)
  if(closes.length<=period)return rsi
  let gains=0,losses=0
  for(let i=1;i<=period;i++){const d=closes[i]-closes[i-1];if(d>0)gains+=d;else losses-=d}
  let ag=gains/period,al=losses/period
  rsi[period]=al===0?100:100-100/(1+ag/al)
  for(let i=period+1;i<closes.length;i++){
    const d=closes[i]-closes[i-1];const g=d>0?d:0;const l=d<0?-d:0
    ag=(ag*(period-1)+g)/period;al=(al*(period-1)+l)/period
    rsi[i]=al===0?100:100-100/(1+ag/al)
  }
  return rsi
}
function calcRSIDiv(candles:Candle[],rsiPeriod=14,pivotLen=5,lookback=60):RSIDivResult{
  const n=candles.length
  const closes=candles.map(c=>c.close)
  const lows=candles.map(c=>c.low)
  const highs=candles.map(c=>c.high)
  const rsi=calcRSI(closes,rsiPeriod)
  const pLows:number[]=[],pHighs:number[]=[]
  for(let i=pivotLen;i<n-pivotLen;i++){
    let isL=true,isH=true
    for(let j=1;j<=pivotLen;j++){
      if(rsi[i]>=rsi[i-j]||rsi[i]>=rsi[i+j])isL=false
      if(rsi[i]<=rsi[i-j]||rsi[i]<=rsi[i+j])isH=false
    }
    if(isL)pLows.push(i);if(isH)pHighs.push(i)
  }
  const bullDivs:RSIDivPair[]=[],bearDivs:RSIDivPair[]=[]
  for(let k=1;k<pLows.length;k++){
    const ri=pLows[k],li=pLows[k-1]
    if(ri-li>lookback)continue
    // Regular Bull: price lower low + RSI higher low
    if(rsi[ri]>rsi[li]&&lows[ri]<lows[li])
      bullDivs.push({type:'bull',leftIdx:li,rightIdx:ri,leftPrice:lows[li],rightPrice:lows[ri]})
  }
  for(let k=1;k<pHighs.length;k++){
    const ri=pHighs[k],li=pHighs[k-1]
    if(ri-li>lookback)continue
    // Regular Bear: price higher high + RSI lower high
    if(rsi[ri]<rsi[li]&&highs[ri]>highs[li])
      bearDivs.push({type:'bear',leftIdx:li,rightIdx:ri,leftPrice:highs[li],rightPrice:highs[ri]})
  }
  // Keep only the most recent 8 of each
  return{bullDivs:bullDivs.slice(-8),bearDivs:bearDivs.slice(-8),rsi}
}

// ── Indicator settings types ──────────────────────────────────────────────
interface VMCSettings{smoothLen:number;signalMult:number;upThreshold:number;loThreshold:number;ribbonMin:number;rsiLen:number;stochSmooth:number;mfiWeight:number}
interface SMCSettings{swingLen:number;showOBBull:boolean;showOBBear:boolean;showFVGBull:boolean;showFVGBear:boolean;obCount:number;fvgCount:number;mitigatedOB:boolean}
interface MSDSettings{swingLen:number;showBOS:boolean;showSwings:boolean}
interface MPSettings{bins:number;showProfile:boolean}
interface BollingerSettings{len:number;mult:number;showMiddle:boolean}
interface VolumeSettings{opacity:number}
interface VegasTunnel{enabled:boolean;color:string;fillOpacity:number}
interface VegasSettings{tunnels:VegasTunnel[]}
const VEGAS_TFS = [
  {label:'5m',  min:5,    binance:'5m',  yh:'5m',  yhRange:'5d'   },
  {label:'15m', min:15,   binance:'15m', yh:'15m', yhRange:'5d'   },
  {label:'1H',  min:60,   binance:'1h',  yh:'1h',  yhRange:'1mo'  },
  {label:'4H',  min:240,  binance:'4h',  yh:'4h',  yhRange:'3mo'  },
  {label:'1J',  min:1440, binance:'1d',  yh:'1d',  yhRange:'1y'   },
  {label:'3J',  min:4320, binance:'3d',  yh:'1wk', yhRange:'2y'   },
]
const VEGAS_DEFAULTS:VegasTunnel[]=[
  {enabled:true, color:'#40e0d0', fillOpacity:0.08},
  {enabled:true, color:'#ffffff', fillOpacity:0.06},
  {enabled:true, color:'#e65100', fillOpacity:0.08},
  {enabled:true, color:'#b71c1c', fillOpacity:0.08},
  {enabled:true, color:'#ffeb3b', fillOpacity:0.06},
  {enabled:true, color:'#00ced1', fillOpacity:0.06},
]

// ── New indicator calculations ────────────────────────────────────────────
interface BBPoint{upper:number;middle:number;lower:number}
function calcBBAligned(candles:Candle[],len=20,mult=2):{upper:number;middle:number;lower:number}[]{
  const cl=candles.map(c=>c.close),n=cl.length
  return cl.map((_,i)=>{
    if(i<len-1)return{upper:cl[i],middle:cl[i],lower:cl[i]}
    const sl=cl.slice(i-len+1,i+1)
    const m=sl.reduce((a,b)=>a+b,0)/len
    const sd=Math.sqrt(sl.reduce((a,b)=>a+(b-m)**2,0)/len)
    return{upper:m+mult*sd,middle:m,lower:m-mult*sd}
  })
}
function calcCVD(candles:Candle[]):number[]{
  const delta=candles.map(c=>{
    const vol=c.volume||0
    if(c.close>c.open)return vol
    if(c.close<c.open)return-vol
    const body=Math.abs(c.close-c.open),range=c.high-c.low||1
    return vol*(c.close>=(c.high+c.low)/2?1:-1)*(1-body/range*0.5)
  })
  const cvd:number[]=[]
  let sum=0
  for(const d of delta){sum+=d;cvd.push(sum)}
  return cvd
}

// ── VMC Panel ─────────────────────────────────────────────────────────────
function VMCPanel({vmcResult,settings}:{vmcResult:VMCResult;settings:VMCSettings}) {
  const ref=useRef<HTMLCanvasElement>(null)
  useEffect(()=>{
    const canvas=ref.current;if(!canvas||!vmcResult)return
    const draw=()=>{
      const dpr=window.devicePixelRatio||1,cw=canvas.offsetWidth,ch=canvas.offsetHeight
      canvas.width=cw*dpr;canvas.height=ch*dpr;canvas.style.width=cw+'px';canvas.style.height=ch+'px'
      const ctx=canvas.getContext('2d')!;ctx.scale(dpr,dpr);ctx.clearRect(0,0,cw,ch);ctx.fillStyle=resolveCSSColor('--tm-bg','#0D1117');ctx.fillRect(0,0,cw,ch)
      const n=vmcResult.sig.length,vis=Math.min(n,Math.floor(cw/2))
      const sig=vmcResult.sig.slice(-vis),ss=vmcResult.sigSignal.slice(-vis),mom=vmcResult.mom.slice(-vis),len=sig.length
      if(!len)return
      const minV=Math.min(...sig,...ss,-70),maxV=Math.max(...sig,...ss,70),rng=maxV-minV||1
      const toY=(v:number)=>ch*0.88-((v-minV)/rng)*(ch*0.78),toX=(i:number)=>(i/(len-1||1))*cw
      ctx.strokeStyle=resolveCSSColor('--tm-border','#2A2F3E');ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(0,toY(0));ctx.lineTo(cw,toY(0));ctx.stroke();ctx.setLineDash([])
      const uT=settings.upThreshold,lT=settings.loThreshold
      for(const t of[uT,lT]){
        ctx.strokeStyle=t>0?`rgba(${resolveCSSColor('var(--tm-loss-rgb','255,59,48')},0.3)`:`rgba(${resolveCSSColor('var(--tm-profit-rgb','34,199,89')},0.3)`;ctx.lineWidth=1;ctx.setLineDash([3,5])
        ctx.beginPath();ctx.moveTo(0,toY(t));ctx.lineTo(cw,toY(t));ctx.stroke();ctx.setLineDash([])
        ctx.font='bold 9px JetBrains Mono, monospace';ctx.fillStyle=t>0?'#FF3B3090':'#22C75990'
        ctx.fillText(t>0?`+${uT}`:String(lT),3,toY(t)-3)
      }
      const bw=Math.max(1,cw/len-0.5)
      for(let i=0;i<len;i++){const m=mom[i],x=toX(i)-bw/2,y0=toY(0),ym=toY(m);ctx.fillStyle=m>=0?`rgba(${resolveCSSColor('var(--tm-profit-rgb','34,199,89')},0.45)`:`rgba(${resolveCSSColor('var(--tm-loss-rgb','255,59,48')},0.45)`;ctx.fillRect(x,Math.min(ym,y0),bw,Math.abs(ym-y0))}
      ctx.beginPath();for(let i=0;i<len;i++)i===0?ctx.moveTo(toX(i),toY(sig[i])):ctx.lineTo(toX(i),toY(sig[i]));for(let i=len-1;i>=0;i--)ctx.lineTo(toX(i),toY(ss[i]));ctx.closePath()
      const bull=vmcResult.isBull[vmcResult.isBull.length-1];ctx.fillStyle=bull?`rgba(${resolveCSSColor('var(--tm-profit-rgb','34,199,89')},0.12)`:`rgba(${resolveCSSColor('var(--tm-loss-rgb','255,59,48')},0.12)`;ctx.fill()
      ctx.strokeStyle=resolveCSSColor('--tm-accent','#00E5FF');ctx.lineWidth=2;ctx.beginPath();for(let i=0;i<len;i++)i===0?ctx.moveTo(toX(i),toY(sig[i])):ctx.lineTo(toX(i),toY(sig[i]));ctx.stroke()
      ctx.strokeStyle=resolveCSSColor('--tm-warning','#FF9500');ctx.lineWidth=1.5;ctx.beginPath();for(let i=0;i<len;i++)i===0?ctx.moveTo(toX(i),toY(ss[i])):ctx.lineTo(toX(i),toY(ss[i]));ctx.stroke()
      const off=n-len
      for(const idx of vmcResult.buySignals){const ri=idx-off;if(ri<0||ri>=len)continue;const x=toX(ri);ctx.fillStyle=resolveCSSColor('--tm-profit','#22C759');ctx.beginPath();ctx.moveTo(x,ch-2);ctx.lineTo(x-5,ch-12);ctx.lineTo(x+5,ch-12);ctx.closePath();ctx.fill()}
      for(const idx of vmcResult.sellSignals){const ri=idx-off;if(ri<0||ri>=len)continue;const x=toX(ri);ctx.fillStyle=resolveCSSColor('--tm-loss','#FF3B30');ctx.beginPath();ctx.moveTo(x,2);ctx.lineTo(x-5,12);ctx.lineTo(x+5,12);ctx.closePath();ctx.fill()}
      const last=sig[len-1];ctx.font='bold 9px JetBrains Mono, monospace';ctx.fillStyle=resolveCSSColor('--tm-accent','#00E5FF');ctx.fillText(`VMC ${last>=0?'+':''}${last.toFixed(1)}`,6,12);ctx.fillStyle=bull?'var(--tm-profit)':'var(--tm-loss)';ctx.fillText(bull?'▲ BULL':'▼ BEAR',75,12)
    }
    draw();const ro=new ResizeObserver(draw);ro.observe(canvas);return()=>ro.disconnect()
  },[vmcResult,settings])
  return(<div style={{borderTop:'1px solid #1E2330'}}><div style={{padding:'3px 14px',background:`rgba(${resolveCSSColor('var(--tm-purple-rgb','191,90,242')},0.06)`,display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:9,fontWeight:700,color:'var(--tm-purple)'}}>〜 VMC</span><span style={{fontSize:8,color:'var(--tm-text-muted)'}}>cyan=VMC · orange=Signal · ▲▼=signaux</span></div><canvas ref={ref} style={{width:'100%',height:90,display:'block'}}/></div>)
}

// ── Settings Panel ────────────────────────────────────────────────────────
interface SettingsPanelProps {
  activeId: string
  vmcSettings: VMCSettings; setVmcSettings: (s:VMCSettings)=>void
  smcSettings: SMCSettings; setSmcSettings: (s:SMCSettings)=>void
  msdSettings: MSDSettings; setMsdSettings: (s:MSDSettings)=>void
  mpSettings:  MPSettings;  setMpSettings:  (s:MPSettings)=>void
  bbSettings:  BollingerSettings; setBbSettings: (s:BollingerSettings)=>void
  vegasSettings: VegasSettings; setVegasSettings: (s:VegasSettings)=>void
  volSettings: VolumeSettings; setVolSettings: (s:VolumeSettings)=>void
  onClose: ()=>void
}
function SettingsPanel({activeId,vmcSettings,setVmcSettings,smcSettings,setSmcSettings,msdSettings,setMsdSettings,mpSettings,setMpSettings,bbSettings,setBbSettings,vegasSettings,setVegasSettings,volSettings,setVolSettings,onClose}:SettingsPanelProps) {
  const { t } = useTranslation()
  const Slider = ({label,value,min,max,step=1,onChange}:{label:string;value:number;min:number;max:number;step?:number;onChange:(v:number)=>void}) => (
    <div style={{marginBottom:10}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
        <span style={{fontSize:10,color:'var(--tm-text-secondary)'}}>{label}</span>
        <span style={{fontSize:10,fontWeight:700,color:'var(--tm-text-primary)',fontFamily:'JetBrains Mono'}}>{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(+e.target.value)} style={{width:'100%',accentColor:'var(--tm-blue)',height:3}}/>
    </div>
  )
  const Toggle = ({label,value,onChange}:{label:string;value:boolean;onChange:(v:boolean)=>void}) => (
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
      <span style={{fontSize:10,color:'var(--tm-text-secondary)'}}>{label}</span>
      <div onClick={()=>onChange(!value)} style={{width:32,height:17,borderRadius:9,background:value?'var(--tm-blue)':'var(--tm-border)',cursor:'pointer',position:'relative',transition:'background 0.2s'}}>
        <div style={{position:'absolute',top:2,left:value?16:2,width:13,height:13,borderRadius:'50%',background:'var(--tm-text-primary)',transition:'left 0.2s'}}/>
      </div>
    </div>
  )
  const ColorRow = ({label,value,onChange}:{label:string;value:string;onChange:(v:string)=>void}) => (
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
      <span style={{fontSize:10,color:'var(--tm-text-secondary)'}}>{label}</span>
      <input type="color" value={value} onChange={e=>onChange(e.target.value)} style={{width:28,height:20,border:'none',background:'transparent',cursor:'pointer',padding:0}}/>
    </div>
  )
  const Section = ({title}:{title:string}) => (
    <div style={{fontSize:9,fontWeight:700,color:'var(--tm-text-muted)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:8,marginTop:4,paddingBottom:4,borderBottom:'1px solid #1E2330'}}>{title}</div>
  )
  const titleMap: Record<string,string> = {
    vmc:'〜 VMC', smc:'🏦 SMC', msd:'📊 Structure', mp:'📈 Mkt Profile',
    bb:'〰 Bollinger', vol:'📊 Volume', cvd:'⚡ CVD', vegas:'🌐 MTF Vegas',
  }
  return(
    <div style={{position:'absolute',top:0,right:0,bottom:0,width:260,background:'var(--tm-bg-secondary)',borderLeft:'1px solid #1E2330',zIndex:20,display:'flex',flexDirection:'column',boxShadow:'-4px 0 20px rgba(0,0,0,0.5)'}}>
      <div style={{padding:'12px 14px',borderBottom:'1px solid #1E2330',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
        <span style={{fontSize:12,fontWeight:700,color:'var(--tm-text-primary)'}}>{titleMap[activeId]??activeId}</span>
        <button onClick={onClose} style={{background:'transparent',border:'none',color:'var(--tm-text-muted)',cursor:'pointer',fontSize:16,padding:'0 4px'}}>✕</button>
      </div>
      <div style={{flex:1,overflowY:'auto',padding:'12px 14px'}}>

        {activeId==='vmc'&&(<>
          <Section title="Signal"/>
          <Slider label="Lissage VMC" value={vmcSettings.smoothLen} min={3} max={40} onChange={v=>setVmcSettings({...vmcSettings,smoothLen:v})}/>
          <Slider label="Multiplicateur signal" value={vmcSettings.signalMult} min={1.1} max={4} step={0.05} onChange={v=>setVmcSettings({...vmcSettings,signalMult:v})}/>
          <Section title="Calcul RSI"/>
          <Slider label="Période RSI" value={vmcSettings.rsiLen} min={5} max={30} onChange={v=>setVmcSettings({...vmcSettings,rsiLen:v})}/>
          <Slider label="Lissage Stoch" value={vmcSettings.stochSmooth} min={1} max={8} onChange={v=>setVmcSettings({...vmcSettings,stochSmooth:v})}/>
          <Slider label="Poids MFI" value={vmcSettings.mfiWeight} min={0.1} max={0.8} step={0.05} onChange={v=>setVmcSettings({...vmcSettings,mfiWeight:v})}/>
          <Section title="Niveaux"/>
          <Slider label="Seuil haut (OB)" value={vmcSettings.upThreshold} min={10} max={80} onChange={v=>setVmcSettings({...vmcSettings,upThreshold:v})}/>
          <Slider label="Seuil bas (OS)" value={vmcSettings.loThreshold} min={-80} max={-10} onChange={v=>setVmcSettings({...vmcSettings,loThreshold:v})}/>
          <Section title="Ribbon"/>
          <Slider label="Consensus EMAs min" value={vmcSettings.ribbonMin} min={3} max={7} onChange={v=>setVmcSettings({...vmcSettings,ribbonMin:v})}/>
        </>)}

        {activeId==='smc'&&(<>
          <Section title="Order Blocks"/>
          <Slider label="Swing length" value={smcSettings.swingLen} min={3} max={30} onChange={v=>setSmcSettings({...smcSettings,swingLen:v})}/>
          <Slider label="Nb OB affichés" value={smcSettings.obCount} min={1} max={10} onChange={v=>setSmcSettings({...smcSettings,obCount:v})}/>
          <Toggle label="OB Bullish" value={smcSettings.showOBBull} onChange={v=>setSmcSettings({...smcSettings,showOBBull:v})}/>
          <Toggle label="OB Bearish" value={smcSettings.showOBBear} onChange={v=>setSmcSettings({...smcSettings,showOBBear:v})}/>
          <Toggle label="OB mitigés" value={smcSettings.mitigatedOB} onChange={v=>setSmcSettings({...smcSettings,mitigatedOB:v})}/>
          <Section title="Fair Value Gaps"/>
          <Slider label="Nb FVG affichés" value={smcSettings.fvgCount} min={1} max={12} onChange={v=>setSmcSettings({...smcSettings,fvgCount:v})}/>
          <Toggle label="FVG+ (Bullish)" value={smcSettings.showFVGBull} onChange={v=>setSmcSettings({...smcSettings,showFVGBull:v})}/>
          <Toggle label="FVG- (Bearish)" value={smcSettings.showFVGBear} onChange={v=>setSmcSettings({...smcSettings,showFVGBear:v})}/>
        </>)}

        {activeId==='msd'&&(<>
          <Slider label={t('analyse.swingLen')} value={msdSettings.swingLen} min={3} max={20} onChange={v=>setMsdSettings({...msdSettings,swingLen:v})}/>
          <Toggle label={t('analyse.showBOS')} value={msdSettings.showBOS} onChange={v=>setMsdSettings({...msdSettings,showBOS:v})}/>
          <Toggle label={t('analyse.showSwings')} value={msdSettings.showSwings} onChange={v=>setMsdSettings({...msdSettings,showSwings:v})}/>
        </>)}

        {activeId==='mp'&&(<>
          <Slider label={t('analyse.mpBins')} value={mpSettings.bins} min={10} max={80} onChange={v=>setMpSettings({...mpSettings,bins:v})}/>
          <Toggle label="Afficher histogramme" value={mpSettings.showProfile} onChange={v=>setMpSettings({...mpSettings,showProfile:v})}/>
        </>)}

        {activeId==='bb'&&(<>
          <Slider label="Période" value={bbSettings.len} min={5} max={100} onChange={v=>setBbSettings({...bbSettings,len:v})}/>
          <Slider label="Multiplicateur σ" value={bbSettings.mult} min={0.5} max={4} step={0.1} onChange={v=>setBbSettings({...bbSettings,mult:v})}/>
          <Toggle label="Afficher SMA centrale" value={bbSettings.showMiddle} onChange={v=>setBbSettings({...bbSettings,showMiddle:v})}/>
        </>)}

        {activeId==='vol'&&(<>
          <Slider label="Opacité" value={volSettings.opacity} min={10} max={80} onChange={v=>setVolSettings({...volSettings,opacity:v})}/>
          <div style={{fontSize:9,color:'var(--tm-text-muted)',marginTop:8,lineHeight:1.5}}>Volume visible dans la partie basse du graphique. Vert = haussier · Rouge = baissier</div>
        </>)}

        {activeId==='cvd'&&(<>
          <div style={{fontSize:9,color:'var(--tm-text-muted)',lineHeight:1.6}}>
            <b style={{color:'var(--tm-text-secondary)'}}>Cumulative Volume Delta</b><br/>
            Différence cumulée entre volume acheteur et vendeur.<br/>
            ↑ CVD + prix ↑ = confirmation haussière<br/>
            ↑ Prix + ↓ CVD = divergence baissière (attention)<br/>
            <span style={{color:'#FF9500'}}>Crypto uniquement</span>
          </div>
        </>)}

        {activeId==='vegas'&&(<>
          <Section title="Tunnels actifs"/>
          {VEGAS_TFS.map((tf,i)=>(
            <div key={tf.label} style={{marginBottom:12,padding:'8px',background:'rgba(255,255,255,0.03)',borderRadius:6,border:`1px solid ${vegasSettings.tunnels[i]?.enabled?vegasSettings.tunnels[i].color+'40':'#1E2330'}`}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                <span style={{fontSize:10,fontWeight:700,color:vegasSettings.tunnels[i]?.enabled?vegasSettings.tunnels[i].color:'var(--tm-text-muted)'}}>{tf.label}</span>
                <div onClick={()=>{const t=[...vegasSettings.tunnels];t[i]={...t[i],enabled:!t[i].enabled};setVegasSettings({...vegasSettings,tunnels:t})}}
                  style={{width:32,height:17,borderRadius:9,background:vegasSettings.tunnels[i]?.enabled?'var(--tm-blue)':'var(--tm-border)',cursor:'pointer',position:'relative',transition:'background 0.2s'}}>
                  <div style={{position:'absolute',top:2,left:vegasSettings.tunnels[i]?.enabled?16:2,width:13,height:13,borderRadius:'50%',background:'var(--tm-text-primary)',transition:'left 0.2s'}}/>
                </div>
              </div>
              {vegasSettings.tunnels[i]?.enabled&&(
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:9,color:'var(--tm-text-muted)'}}>Couleur</span>
                  <input type="color" value={vegasSettings.tunnels[i].color} onChange={e=>{const t=[...vegasSettings.tunnels];t[i]={...t[i],color:e.target.value};setVegasSettings({...vegasSettings,tunnels:t})}} style={{width:24,height:18,border:'none',background:'transparent',cursor:'pointer',padding:0}}/>
                  <span style={{fontSize:9,color:'var(--tm-text-muted)'}}>Opacité fill</span>
                  <input type="range" min={0.01} max={0.3} step={0.01} value={vegasSettings.tunnels[i].fillOpacity} onChange={e=>{const t=[...vegasSettings.tunnels];t[i]={...t[i],fillOpacity:+e.target.value};setVegasSettings({...vegasSettings,tunnels:t})}} style={{flex:1,accentColor:'var(--tm-blue)',height:3}}/>
                </div>
              )}
            </div>
          ))}
          <div style={{fontSize:9,color:'var(--tm-text-muted)',marginTop:8,lineHeight:1.5}}>EMA 144 / 169 / 233 sur chaque unité de temps. Les tunnels supérieurs au TF actuel n'ont pas de signaux.</div>
        </>)}

      </div>
      <div style={{padding:'10px 14px',borderTop:'1px solid #1E2330',flexShrink:0}}>
        <div style={{fontSize:9,color:'var(--tm-text-muted)',textAlign:'center'}}>Modifications en temps réel</div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// ── MAIN COMPONENT ────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════
function resolveCSSColor(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback
}

// Map LW minutes → oscillator interval strings
const LW_MIN_TO_OSC: Record<number, string> = {
  1:'5m', 5:'5m', 15:'15m', 30:'30m', 60:'1h', 240:'4h', 1440:'1d', 10080:'1w',
}

export default function LightweightChart({symbol,isCrypto,onTimeframeChange,onVisibleRangeChange,syncRangeIn,onCrosshairChange,chartHeight=430,autoHeight=false}:Props) {
  const { t } = useTranslation()
  const chartEl  = useRef<HTMLDivElement>(null)
  const overlayEl = useRef<HTMLCanvasElement>(null)
  const chartApi = useRef<IChartApi|null>(null)
  const seriesR  = useRef<ISeriesApi<'Candlestick'>|null>(null)
  const wsRef    = useRef<WebSocket|null>(null)
  const candlesRef      = useRef<Candle[]>([])
  const mpLinesRef      = useRef<any[]>([])
  const onRangeRef         = useRef(onVisibleRangeChange)
  const onCrosshairRef     = useRef(onCrosshairChange)
  useEffect(() => { onCrosshairRef.current = onCrosshairChange }, [onCrosshairChange])
  const autoHeightRef      = useRef(autoHeight)
  useEffect(() => { autoHeightRef.current = autoHeight }, [autoHeight])
  // Anti-loop: store the logical range we last set programmatically.
  // When LW echoes back that exact range, we swallow it (it's not a user action).
  // Any range that differs by more than eps = real user interaction → forward to oscillators.
  const lastSetLogical  = useRef<{from:number;to:number}|null>(null)
  useEffect(() => { onRangeRef.current = onVisibleRangeChange }, [onVisibleRangeChange])

  // Oscillateurs → LW : appliquer la plage envoyée par un oscillateur
  useEffect(() => {
    if (!syncRangeIn || !chartApi.current || !candlesRef.current.length) return
    const total = candlesRef.current.length
    const target = { from: syncRangeIn.from * total, to: syncRangeIn.to * total }
    lastSetLogical.current = target
    chartApi.current.timeScale().setVisibleLogicalRange(target)
  }, [syncRangeIn])

  const [tf,       setTf]       = useState(TIMEFRAMES[2])
  const [tool,     setTool]     = useState<ToolId>('cursor')
  const [magnet,   setMagnet]   = useState(false)
  const [color,    setColor]    = useState('var(--tm-warning)')
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
  const [sharing,  setSharing]  = useState(false)
  const [shareOk,  setShareOk]  = useState(false)
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const [confirm,  setConfirm]  = useState<{type:ToolId;p1:DrawingPoint;p2?:DrawingPoint}|null>(null)
  const [labelInput, setLabelInput] = useState('')
  const [settingsOpen, setSettingsOpen] = useState<string|null>(null)

  // Indicator toggles
  const [indOn, setIndOn] = useState<Record<string,boolean>>({smc:false,msd:false,vmc:false,mp:false,rsiDiv:false,bb:false,vol:false,cvd:false,vegas:false})

  // Indicator settings
  const [vmcS, setVmcS] = useState<VMCSettings>({smoothLen:10,signalMult:1.75,upThreshold:35,loThreshold:-35,ribbonMin:5,rsiLen:14,stochSmooth:2,mfiWeight:0.4})
  const [smcS, setSmcS] = useState<SMCSettings>({swingLen:10,showOBBull:true,showOBBear:true,showFVGBull:true,showFVGBear:true,obCount:4,fvgCount:5,mitigatedOB:false})
  const [msdS, setMsdS] = useState<MSDSettings>({swingLen:5,showBOS:true,showSwings:true})
  const [mpS,  setMpS]  = useState<MPSettings>({bins:30,showProfile:true})
  const [bbS,  setBbS]  = useState<BollingerSettings>({len:20,mult:2,showMiddle:true})
  const [volS, setVolS] = useState<VolumeSettings>({opacity:35})
  const [vegasS, setVegasS] = useState<VegasSettings>({tunnels:[...VEGAS_DEFAULTS.map(t=>({...t}))]})

  // Computed results
  const [smcResult,    setSmcResult]    = useState<SMCResult|null>(null)
  const [msdResult,    setMsdResult]    = useState<MSDResult|null>(null)
  const [vmcResult,    setVmcResult]    = useState<VMCResult|null>(null)
  const [mpResult,     setMpResult]     = useState<MPResult|null>(null)
  const [rsiDivResult, setRsiDivResult] = useState<RSIDivResult|null>(null)
  const [bbResult,     setBbResult]     = useState<BBPoint[]|null>(null)
  const [cvdResult,    setCvdResult]    = useState<number[]|null>(null)
  const [vegasData,    setVegasData]    = useState<{time:number;e1:number;e2:number;e3:number}[][]>([])

  // Refs for price-axis width (to avoid SMC/VP zones overlapping it)
  const priceAxisWRef = useRef(60)
  // Volume series ref
  const volSeriesRef  = useRef<ISeriesApi<'Histogram'>|null>(null)

  // Recalculate when settings change
  useEffect(()=>{const c=candlesRef.current;if(c.length)setSmcResult(calcSMC(c,smcS.swingLen))},[smcS.swingLen])
  useEffect(()=>{const c=candlesRef.current;if(c.length)setMsdResult(calcMSD(c,msdS.swingLen))},[msdS.swingLen])
  useEffect(()=>{const c=candlesRef.current;if(c.length)setVmcResult(calcVMC(c,vmcS.smoothLen,vmcS.signalMult,vmcS.upThreshold,vmcS.loThreshold,vmcS.rsiLen,vmcS.stochSmooth,vmcS.mfiWeight))},[vmcS])
  useEffect(()=>{const c=candlesRef.current;if(c.length)setMpResult(calcMP(c,mpS.bins))},[mpS.bins])
  useEffect(()=>{const c=candlesRef.current;if(c.length)setBbResult(calcBBAligned(c,bbS.len,bbS.mult))},[bbS])

  // Toggle volume series visibility + update opacity when settings change
  useEffect(()=>{
    if(!volSeriesRef.current)return
    volSeriesRef.current.applyOptions({visible:indOn.vol})
    // Refresh bar colors to reflect new opacity
    if(indOn.vol&&candlesRef.current.length){
      const alpha=Math.round((volS.opacity/100)*255).toString(16).padStart(2,'0')
      volSeriesRef.current.setData(candlesRef.current.map(c=>({
        time:c.time as Time,
        value:c.volume||0,
        color:c.close>=c.open?`#22C759${alpha}`:`#FF3B30${alpha}`
      })))
    }
  },[indOn.vol,volS.opacity])

  // Fetch MTF Vegas data when enabled or symbol/isCrypto changes
  useEffect(()=>{
    if(!indOn.vegas){setVegasData([]);return}
    let cancelled=false
    const fetchAll=async()=>{
      const results:{time:number;e1:number;e2:number;e3:number}[][]=[]
      for(let ti=0;ti<VEGAS_TFS.length;ti++){
        const vtf=VEGAS_TFS[ti]
        if(!vegasS.tunnels[ti]?.enabled){results.push([]);continue}
        try{
          let raw:{time:number;close:number}[]=[]
          if(isCrypto){
            const s=symbol.toUpperCase()
            for(const base of['https://fapi.binance.com/fapi/v1','https://api.binance.com/api/v3']){
              try{
                const r=await fetch(`${base}/klines?symbol=${s}&interval=${vtf.binance}&limit=500`)
                if(r.ok){const d=await r.json();if(Array.isArray(d)&&d.length>10){raw=d.map((k:unknown[])=>({time:Math.floor(Number(k[0])/1000),close:+String(k[4])}));break}}
              }catch{}
              if(raw.length)break
            }
          } else {
            const fn=httpsCallable<Record<string,unknown>,{s:string;candles:{t:number;c:number}[]}>(fbFn,'fetchYahooCandles')
            try{
              const res=await fn({symbol:symbol.toUpperCase(),interval:vtf.yh,range:vtf.yhRange})
              if(res.data.s==='ok')raw=res.data.candles.map(c=>({time:c.t,close:c.c}))
            }catch{}
          }
          if(cancelled)return
          if(raw.length>=144){
            const cl=raw.map(r=>r.close)
            const e1a=ema(cl,144),e2a=ema(cl,169),e3a=ema(cl,233)
            // Only keep last 300 points to avoid overcrowding
            const pts=raw.slice(-300).map((r,i)=>{const base=raw.length-300;return{time:r.time,e1:e1a[base+i],e2:e2a[base+i],e3:e3a[base+i]}})
            results.push(pts)
          } else results.push([])
        }catch{results.push([])}
      }
      if(!cancelled)setVegasData(results)
    }
    fetchAll()
    return()=>{cancelled=true}
  },[indOn.vegas, symbol, isCrypto, vegasS.tunnels])

  // Drawing state
  const phase   = useRef<'idle'|'first'>('idle')
  const firstPt = useRef<DrawingPoint|null>(null)

  const toast$ = useCallback((m:string)=>{setToast(m);setTimeout(()=>setToast(null),2500)},[])
  const toggleInd = (id:string) => setIndOn(p=>({...p,[id]:!p[id]}))

  // ── Init Chart ───────────────────────────────────────────────────────
  useEffect(()=>{
    const el=chartEl.current;if(!el)return
    const bg   = resolveCSSColor('--tm-bg',          '#0D1117')
    const bord = resolveCSSColor('--tm-border',      '#2A2F3E')
    const bsub = resolveCSSColor('--tm-border-sub',  '#1E2330')
    const c=createChart(el,{
      width:el.clientWidth,height:chartHeight,
      layout:{background:{color:bg},textColor:'#6B7280',fontSize:11,fontFamily:'JetBrains Mono, monospace'},
      grid:{vertLines:{color:'#1E233028'},horzLines:{color:'#1E233028'}},
      crosshair:{mode:CrosshairMode.Normal,vertLine:{color:'#555C7060',style:LineStyle.Solid,width:1,labelBackgroundColor:bord},horzLine:{color:'#555C7060',style:LineStyle.Solid,width:1,labelBackgroundColor:bord}},
      rightPriceScale:{borderColor:bsub,scaleMargins:{top:0.05,bottom:0.05}},
      timeScale:{borderColor:bsub,timeVisible:true,secondsVisible:false},
    })
    chartApi.current=c
    // LW → oscillateurs : émet des fractions (from peut être légèrement <0, to légèrement >1 — marge LW)
    // Si l'événement correspond exactement à ce qu'on vient de définir programmatiquement,
    // on l'ignore (écho) — sinon c'est une vraie interaction utilisateur.
    c.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range || !candlesRef.current.length) return
      if (lastSetLogical.current) {
        const eps = 0.5
        const eq = Math.abs(range.from - lastSetLogical.current.from) < eps &&
                   Math.abs(range.to   - lastSetLogical.current.to  ) < eps
        lastSetLogical.current = null
        if (eq) return
      }
      const total = candlesRef.current.length
      // Pas de clamp sur `to` : on passe la marge droite LW aux oscillateurs pour un alignement parfait
      onRangeRef.current?.(Math.max(0, range.from / total), range.to / total)
    })

    // Helper : calcule tsW, psW et émet areaRatio + frac crosshair
    // tsW = largeur de la zone chart (sans price axis), psW = largeur price axis
    // areaRatio = tsW / (tsW + psW) = fraction du container consacrée aux barres
    // → oscillateurs doivent dessiner leurs barres sur drawW = W * areaRatio pour s'aligner avec LW
    const getAreaRatio = () => {
      const tsW = c.timeScale().width()
      const psW = c.priceScale('right').width()
      return { tsW, psW, totalW: tsW + psW, areaRatio: tsW > 0 ? tsW / (tsW + psW) : 1 }
    }

    let lastCrosshairMs = 0
    c.subscribeCrosshairMove((param) => {
      const now = performance.now()
      if (now - lastCrosshairMs < 16) return  // ~60fps
      lastCrosshairMs = now
      if (param.point != null && param.logical != null) {
        const { tsW, psW, areaRatio } = getAreaRatio()
        priceAxisWRef.current = psW
        if (tsW > 0) {
          // frac = position 0-1 dans la zone chart uniquement (hors price axis)
          // → slot s sur totalSlots : frac = s/totalSlots (sans facteur areaRatio)
          const frac = param.point.x / tsW
          onCrosshairRef.current?.({ frac: Math.max(0, Math.min(1, frac)), areaRatio })
        }
      } else {
        onCrosshairRef.current?.(null)
      }
    })

    const profit = resolveCSSColor('--tm-profit','#22C759')
    const loss   = resolveCSSColor('--tm-loss',  '#FF3B30')
    seriesR.current=c.addCandlestickSeries({
      upColor:profit,downColor:loss,
      borderUpColor:profit,borderDownColor:loss,
      wickUpColor:profit+'90',wickDownColor:loss+'90',
      priceLineVisible:false,
    })
    // Volume histogram — bottom 14% of chart, initially hidden
    const vs=c.addHistogramSeries({
      color:'#26a69a',
      priceFormat:{type:'volume'},
      priceScaleId:'vol_scale',
    })
    vs.applyOptions({visible:false})
    c.priceScale('vol_scale').applyOptions({scaleMargins:{top:0.86,bottom:0},borderVisible:false,visible:false})
    volSeriesRef.current=vs
    const ro=new ResizeObserver(()=>{
      const opts: {width:number; height?:number} = {width:el.clientWidth}
      if (autoHeightRef.current && el.clientHeight > 0) opts.height = el.clientHeight
      c.applyOptions(opts)
      // Capture price axis width for clipping indicator zones
      const { psW, areaRatio } = getAreaRatio()
      priceAxisWRef.current = psW
      onCrosshairRef.current?.({ frac: -1, areaRatio })  // frac -1 = resize event (pas de crosshair)
    })
    ro.observe(el)
    return()=>{ro.disconnect();c.remove();chartApi.current=null;seriesR.current=null}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])

  // Sync chart height when prop changes (non-autoHeight mode)
  useEffect(()=>{
    if(chartApi.current && !autoHeight) chartApi.current.applyOptions({height:chartHeight})
  },[chartHeight,autoHeight])

  // When switching to autoHeight, immediately sync dimensions from DOM
  useEffect(()=>{
    if(!autoHeight||!chartApi.current||!chartEl.current)return
    const el=chartEl.current
    if(el.clientHeight>0) chartApi.current.applyOptions({width:el.clientWidth,height:el.clientHeight})
  },[autoHeight])

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
      setVmcResult(calcVMC(candles,vmcS.smoothLen,vmcS.signalMult,vmcS.upThreshold,vmcS.loThreshold,vmcS.rsiLen,vmcS.stochSmooth,vmcS.mfiWeight))
      setMpResult(calcMP(candles,mpS.bins))
      setRsiDivResult(calcRSIDiv(candles))
      setBbResult(calcBBAligned(candles,bbS.len,bbS.mult))
      setCvdResult(calcCVD(candles))
      // Populate volume histogram series
      if(volSeriesRef.current){
        volSeriesRef.current.setData(candles.map(c=>({
          time:c.time as Time,
          value:c.volume||0,
          color:c.close>=c.open?`rgba(34,199,89,0.${Math.round((volS.opacity/100)*99).toString().padStart(2,'0')})`:
                                `rgba(255,59,48,0.${Math.round((volS.opacity/100)*99).toString().padStart(2,'0')})`
        })))
        volSeriesRef.current.applyOptions({visible:indOn.vol})
      }
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
      [[mpResult.poc,'var(--tm-warning)','POC',LineStyle.Solid,2],[mpResult.vah,'var(--tm-profit)','VAH',LineStyle.Dashed,1],[mpResult.val,'var(--tm-profit)','VAL',LineStyle.Dashed,1]].forEach(([price,color,title,lineStyle,lineWidth])=>{
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
        if(isSelected){ctx.fillStyle=resolveCSSColor('--tm-text-primary','#F0F3FF');ctx.beginPath();ctx.arc(cw/2,y,4,0,Math.PI*2);ctx.fill()}
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
        if(isSelected){for(const [hx,hy] of[[rx,ry],[rx+rw,ry],[rx,ry+rh],[rx+rw,ry+rh]]){ctx.fillStyle=resolveCSSColor('--tm-text-primary','#F0F3FF');ctx.beginPath();ctx.arc(hx,hy,4,0,Math.PI*2);ctx.fill()}}
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
          ctx.fillStyle=resolveCSSColor('--tm-loss','#FF3B30');ctx.beginPath();ctx.arc(delX,delY-18,9,0,Math.PI*2);ctx.fill()
          ctx.strokeStyle=resolveCSSColor('--tm-text-primary','#F0F3FF');ctx.lineWidth=1.5
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

    // chartAreaW = canvas width minus price axis (to avoid zone overlap with price axis)
    const chartAreaW = cw - priceAxisWRef.current - 4

    // ── MTF Vegas ─────────────────────────────────────────────────────
    if(indOn.vegas&&vegasData.length){
      ctx.save()
      for(let ti=0;ti<VEGAS_TFS.length;ti++){
        const tun=vegasS.tunnels[ti]
        if(!tun?.enabled)continue
        const pts=vegasData[ti]
        if(!pts?.length)continue
        const col=tun.color
        // Build coordinate arrays
        const coordE1:{x:number;y:number}[]=[],coordE3:{x:number;y:number}[]=[]
        for(const p of pts){
          const x=toX(p.time),y1=toY(p.e1),y3=toY(p.e3)
          if(x==null||x<0||x>chartAreaW)continue
          if(y1!=null)coordE1.push({x,y:y1})
          if(y3!=null)coordE3.push({x,y:y3})
        }
        if(coordE1.length<2)continue
        // Fill between e1 and e3
        ctx.beginPath()
        coordE1.forEach((pt,i)=>i===0?ctx.moveTo(pt.x,pt.y):ctx.lineTo(pt.x,pt.y))
        ;[...coordE3].reverse().forEach(pt=>ctx.lineTo(pt.x,pt.y))
        ctx.closePath()
        ctx.fillStyle=col+(Math.round(tun.fillOpacity*255).toString(16).padStart(2,'0'))
        ctx.fill()
        // Draw e1, e2, e3 lines
        for(let li=0;li<3;li++){
          const key:('e1'|'e2'|'e3')=['e1','e2','e3'][li] as 'e1'|'e2'|'e3'
          ctx.beginPath()
          let first=true
          for(const p of pts){
            const x=toX(p.time),y=toY(p[key])
            if(x==null||y==null||x<0||x>chartAreaW)continue
            if(first){ctx.moveTo(x,y);first=false}else ctx.lineTo(x,y)
          }
          ctx.strokeStyle=col
          ctx.lineWidth=li===1?1.2:1.5
          ctx.globalAlpha=li===1?0.55:0.9
          ctx.stroke()
          ctx.globalAlpha=1
        }
      }
      ctx.restore()
    }

    // ── Bollinger Bands ───────────────────────────────────────────────
    if(indOn.bb&&bbResult&&bbResult.length){
      ctx.save()
      // Fill area
      const upper:number[]=[],lower:number[]=[],xs:number[]=[]
      candles.forEach((c,i)=>{
        const bb=bbResult[i];if(!bb)return
        const x=toX(c.time),yu=toY(bb.upper),yl=toY(bb.lower)
        if(x==null||yu==null||yl==null)return
        xs.push(x);upper.push(yu);lower.push(yl)
      })
      if(xs.length>1){
        ctx.beginPath()
        xs.forEach((x,i)=>i===0?ctx.moveTo(x,upper[i]):ctx.lineTo(x,upper[i]))
        ;[...xs].reverse().forEach((x,i)=>ctx.lineTo(x,[...lower].reverse()[i]))
        ctx.closePath()
        ctx.fillStyle='rgba(0,229,255,0.04)';ctx.fill()
        // Upper band
        ctx.beginPath()
        xs.forEach((x,i)=>i===0?ctx.moveTo(x,upper[i]):ctx.lineTo(x,upper[i]))
        ctx.strokeStyle='#00E5FF80';ctx.lineWidth=1.2;ctx.setLineDash([]);ctx.stroke()
        // Lower band
        ctx.beginPath()
        xs.forEach((x,i)=>i===0?ctx.moveTo(x,lower[i]):ctx.lineTo(x,lower[i]))
        ctx.strokeStyle='#00E5FF80';ctx.lineWidth=1.2;ctx.stroke()
        // Middle SMA
        if(bbS.showMiddle){
          ctx.beginPath()
          candles.forEach((c,i)=>{
            const bb=bbResult[i];if(!bb)return
            const x=toX(c.time),y=toY(bb.middle)
            if(x==null||y==null)return
            ctx.lineTo(x,y)
          })
          ctx.strokeStyle='#00E5FF40';ctx.lineWidth=0.8;ctx.setLineDash([4,4]);ctx.stroke();ctx.setLineDash([])
        }
      }
      ctx.restore()
    }

    // ── CVD (Cumulative Volume Delta) ─────────────────────────────────
    if(indOn.cvd&&cvdResult&&cvdResult.length&&isCrypto){
      ctx.save()
      const cvdH=ch*0.14  // 14% of canvas height for CVD strip
      const cvdTop=ch-cvdH-2
      // background
      ctx.fillStyle='rgba(13,17,23,0.72)';ctx.fillRect(0,cvdTop,chartAreaW,cvdH)
      // CVD line aligned to visible candles
      const visCandles=candles.map((c,i)=>({c,cvd:cvdResult[i]??0})).filter(({c})=>{
        const x=toX(c.time);return x!=null&&x>=0&&x<=chartAreaW
      })
      if(visCandles.length>1){
        const minCvd=Math.min(...visCandles.map(v=>v.cvd))
        const maxCvd=Math.max(...visCandles.map(v=>v.cvd))
        const rng=maxCvd-minCvd||1
        const toCvdY=(v:number)=>cvdTop+cvdH*0.9-((v-minCvd)/rng)*(cvdH*0.8)
        // Zero line
        const zeroY=toCvdY(0)
        ctx.strokeStyle='#2A2F3E';ctx.lineWidth=0.5;ctx.setLineDash([3,3])
        ctx.beginPath();ctx.moveTo(0,zeroY);ctx.lineTo(chartAreaW,zeroY);ctx.stroke();ctx.setLineDash([])
        // Fill and line
        const last=visCandles[visCandles.length-1]
        const bullCvd=last.cvd>=visCandles[0].cvd
        ctx.beginPath()
        visCandles.forEach(({c,cvd},i)=>{
          const x=toX(c.time)!,y=toCvdY(cvd)
          i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)
        })
        ctx.strokeStyle=bullCvd?'#22C75990':'#FF3B3090';ctx.lineWidth=1.5;ctx.stroke()
        // Label
        ctx.font='bold 8px JetBrains Mono, monospace'
        ctx.fillStyle=bullCvd?'#22C759':'#FF3B30'
        ctx.fillText(`CVD ${bullCvd?'▲':'▼'}`,4,cvdTop+10)
      }
      ctx.restore()
    }

    // ── SMC ───────────────────────────────────────────────────────────
    if(indOn.smc&&smcResult){
      const drawZone=(top:number,btm:number,idx:number,fill:string,border:string,lbl:string)=>{
        const t=candles[idx]?.time;const x=t?toX(t)??0:0;const y1=toY(top),y2=toY(btm);if(y1==null||y2==null)return
        const zoneW=Math.max(0,chartAreaW-x)  // stop before price axis
        ctx.fillStyle=fill;ctx.strokeStyle=border;ctx.lineWidth=1
        ctx.fillRect(x,Math.min(y1,y2),zoneW,Math.abs(y2-y1))
        ctx.strokeRect(x,Math.min(y1,y2),zoneW,Math.abs(y2-y1))
        ctx.font='bold 9px JetBrains Mono, monospace';ctx.fillStyle=border;ctx.fillText(lbl,x+4,Math.min(y1,y2)+12)
      }
      if(smcS.showOBBull)
        smcResult.bullOBs.slice(0,smcS.obCount).forEach(ob=>drawZone(ob.top,ob.btm,ob.idx,`rgba(${resolveCSSColor('var(--tm-blue-rgb','10,133,255')},0.10)`,`rgba(${resolveCSSColor('var(--tm-blue-rgb','10,133,255')},0.75)`,'Bull OB'))
      if(smcS.showOBBear)
        smcResult.bearOBs.slice(0,smcS.obCount).forEach(ob=>drawZone(ob.top,ob.btm,ob.idx,`rgba(${resolveCSSColor('var(--tm-loss-rgb','255,59,48')},0.10)`,`rgba(${resolveCSSColor('var(--tm-loss-rgb','255,59,48')},0.75)`,'Bear OB'))
      if(smcS.showFVGBull)
        smcResult.bullFVGs.slice(0,smcS.fvgCount).forEach(fvg=>{
          const t=candles[fvg.idx]?.time;const x=t?toX(t)??0:0;const y1=toY(fvg.top),y2=toY(fvg.btm);if(y1==null||y2==null)return
          const zoneW=Math.max(0,chartAreaW-x)
          ctx.fillStyle=`rgba(${resolveCSSColor('var(--tm-profit-rgb','34,199,89')},0.07)`;ctx.strokeStyle=`rgba(${resolveCSSColor('var(--tm-profit-rgb','34,199,89')},0.5)`;ctx.setLineDash([4,3])
          ctx.fillRect(x,Math.min(y1,y2),zoneW,Math.abs(y2-y1));ctx.strokeRect(x,Math.min(y1,y2),zoneW,Math.abs(y2-y1));ctx.setLineDash([])
          ctx.font='bold 9px JetBrains Mono, monospace';ctx.fillStyle=resolveCSSColor('--tm-profit','#22C759');ctx.fillText('FVG ↑',x+4,Math.min(y1,y2)+12)
        })
      if(smcS.showFVGBear)
        smcResult.bearFVGs.slice(0,smcS.fvgCount).forEach(fvg=>{
          const t=candles[fvg.idx]?.time;const x=t?toX(t)??0:0;const y1=toY(fvg.top),y2=toY(fvg.btm);if(y1==null||y2==null)return
          const zoneW=Math.max(0,chartAreaW-x)
          ctx.fillStyle=`rgba(${resolveCSSColor('var(--tm-warning-rgb','255,149,0')},0.07)`;ctx.strokeStyle=`rgba(${resolveCSSColor('var(--tm-warning-rgb','255,149,0')},0.5)`;ctx.setLineDash([4,3])
          ctx.fillRect(x,Math.min(y1,y2),zoneW,Math.abs(y2-y1));ctx.strokeRect(x,Math.min(y1,y2),zoneW,Math.abs(y2-y1));ctx.setLineDash([])
          ctx.font='bold 9px JetBrains Mono, monospace';ctx.fillStyle=resolveCSSColor('--tm-warning','#FF9500');ctx.fillText('FVG ↓',x+4,Math.min(y1,y2)+12)
        })
    }

    // ── MSD ───────────────────────────────────────────────────────────
    if(indOn.msd&&msdResult){
      ctx.font='bold 10px JetBrains Mono, monospace'
      if(msdS.showSwings){
        msdResult.swingHighs.forEach(sh=>{const t=candles[sh.idx]?.time;const x=t?toX(t):null;const y=toY(sh.price);if(x==null||y==null)return;ctx.fillStyle=sh.type==='HH'?'var(--tm-loss)':'var(--tm-warning)';ctx.fillText(sh.type,x-10,y-8)})
        msdResult.swingLows.forEach(sl=>{const t=candles[sl.idx]?.time;const x=t?toX(t):null;const y=toY(sl.price);if(x==null||y==null)return;ctx.fillStyle=sl.type==='LL'?'var(--tm-profit)':'var(--tm-accent)';ctx.fillText(sl.type,x-10,y+16)})
      }
      if(msdS.showBOS){
        msdResult.bosLines.forEach(bos=>{
          const t1=candles[bos.from]?.time,t2=candles[bos.to]?.time;const x1=t1?toX(t1):null,x2=t2?toX(t2):null;const y=toY(bos.price);if(x1==null||x2==null||y==null)return
          ctx.strokeStyle=bos.type==='BOS'?(bos.dir==='bull'?'var(--tm-profit)':'var(--tm-loss)'):'#FFD60A';ctx.lineWidth=1;ctx.setLineDash([5,3])
          ctx.beginPath();ctx.moveTo(x1,y);ctx.lineTo(x2,y);ctx.stroke();ctx.setLineDash([])
          ctx.font='bold 9px JetBrains Mono, monospace';ctx.fillStyle=bos.type==='BOS'?(bos.dir==='bull'?'var(--tm-profit)':'var(--tm-loss)'):'#FFD60A';ctx.fillText(bos.type,(x1+x2)/2-10,y-4)
        })
      }
    }

    // ── VMC ribbon indicator ──────────────────────────────────────────
    if(indOn.vmc&&vmcResult){
      const bull=vmcResult.isBull[vmcResult.isBull.length-1],bear=vmcResult.isBear[vmcResult.isBear.length-1]
      ctx.fillStyle=bull?`rgba(${resolveCSSColor('var(--tm-profit-rgb','34,199,89')},0.10)`:bear?`rgba(${resolveCSSColor('var(--tm-loss-rgb','255,59,48')},0.10)`:'rgba(255,255,255,0.03)';ctx.fillRect(0,ch-10,cw,10)
      ctx.font='bold 8px JetBrains Mono, monospace';ctx.fillStyle=bull?'var(--tm-profit)':bear?'var(--tm-loss)':'var(--tm-text-muted)';ctx.fillText(bull?'▲ BULL RIBBON':bear?'▼ BEAR RIBBON':'— NEUTRE',6,ch-2)
      const off=candles.length-vmcResult.sig.length
      vmcResult.buySignals.forEach(idx=>{const c=candles[idx+off];if(!c)return;const x=toX(c.time),y=toY(c.low);if(x==null||y==null)return;ctx.fillStyle=resolveCSSColor('--tm-profit','#22C759');ctx.beginPath();ctx.moveTo(x,y+24);ctx.lineTo(x-6,y+14);ctx.lineTo(x+6,y+14);ctx.closePath();ctx.fill()})
      vmcResult.sellSignals.forEach(idx=>{const c=candles[idx+off];if(!c)return;const x=toX(c.time),y=toY(c.high);if(x==null||y==null)return;ctx.fillStyle=resolveCSSColor('--tm-loss','#FF3B30');ctx.beginPath();ctx.moveTo(x,y-24);ctx.lineTo(x-6,y-14);ctx.lineTo(x+6,y-14);ctx.closePath();ctx.fill()})
    }

    // ── Market Profile histogram (clipped to chart area) ──────────────
    if(indOn.mp&&mpResult&&mpS.showProfile){
      const maxV=Math.max(...mpResult.profile.map(b=>b.vol))
      const barMaxW=Math.min(50,chartAreaW*0.08)  // max 8% of chart area
      mpResult.profile.forEach(b=>{
        const y=toY(b.price);if(y==null)return
        const bw=(b.vol/maxV)*barMaxW
        const isMid=Math.abs(b.price-mpResult!.poc)<(mpResult!.vah-mpResult!.val)*0.08
        ctx.fillStyle=isMid?`rgba(${resolveCSSColor('var(--tm-warning-rgb','255,149,0')},0.4)`:`rgba(${b.price>mpResult!.poc?'34,199,89':'100,120,200'},0.25)`
        ctx.fillRect(chartAreaW-bw,y-2,bw,4)  // anchored to chart area right edge
      })
    }

    // ── RSI Divergences ───────────────────────────────────────────────
    if(indOn.rsiDiv&&rsiDivResult){
      const drawDiv=(pair:RSIDivPair,isBull:boolean)=>{
        const lc=candles[pair.leftIdx],rc=candles[pair.rightIdx]
        if(!lc||!rc)return
        const x1=toX(lc.time),y1=toY(pair.leftPrice)
        const x2=toX(rc.time),y2=toY(pair.rightPrice)
        if(x1==null||x2==null||y1==null||y2==null)return
        const col=isBull?'#22C759':'#FF3B30'
        ctx.save()
        ctx.strokeStyle=col;ctx.lineWidth=1.5;ctx.setLineDash([4,3]);ctx.globalAlpha=0.8
        ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.setLineDash([])
        ctx.fillStyle=col;ctx.globalAlpha=0.9
        ctx.beginPath();ctx.arc(x1,y1,4,0,Math.PI*2);ctx.fill()
        ctx.beginPath();ctx.arc(x2,y2,4,0,Math.PI*2);ctx.fill()
        ctx.font='bold 9px JetBrains Mono, monospace';ctx.globalAlpha=1
        const lbl=isBull?'REG BULL':'REG BEAR'
        const tw=ctx.measureText(lbl).width+8
        ctx.fillStyle=col+'28';ctx.beginPath();ctx.roundRect?.(x2-tw/2,isBull?y2+6:y2-18,tw,13,3);ctx.fill()
        ctx.fillStyle=col;ctx.fillText(lbl,x2-tw/2+4,isBull?y2+16:y2-8)
        ctx.restore()
      }
      rsiDivResult.bullDivs.forEach(p=>drawDiv(p,true))
      rsiDivResult.bearDivs.forEach(p=>drawDiv(p,false))
    }
  },[drawings,selectedId,hoverPoint,color,tool,magnet,indOn,smcResult,msdResult,vmcResult,mpResult,rsiDivResult,smcS,msdS,mpS,snapPrice,bbResult,bbS,cvdResult,vegasData,vegasS,isCrypto])

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
          dbDelete(selectedId).then(()=>{setDrawings(p=>p.filter(dd=>dd.id!==selectedId));setSelectedId(null);toast$(t('analyse.deleted'))})
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
        dbDelete(selectedId).then(()=>{setDrawings(p=>p.filter(d=>d.id!==selectedId));setSelectedId(null);toast$(t('analyse.deleted'))})
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
      setDrawings(prev=>[{...d,id},...prev]);setConfirm(null);setLabelInput('');toast$(t('common.saved'))
    }catch{toast$('Erreur')}
    setSaving(false)
  }

  // ── Share chart ─────────────────────────────────────────────────────────
  const handleShareChart = async () => {
    const el = chartContainerRef.current
    if (!el || sharing) return
    setSharing(true)
    try {
      let blob: Blob | null = null
      // Try the largest canvas first (LW chart canvas)
      const canvases = Array.from(el.querySelectorAll('canvas')) as HTMLCanvasElement[]
      const cv = canvases.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0]
      if (cv && cv.width > 0) {
        blob = await new Promise<Blob | null>(res => cv.toBlob(res, 'image/png'))
      } else {
        const { toPng } = await import('html-to-image')
        const dataUrl = await toPng(el, {
          quality: 1, pixelRatio: 2,
          backgroundColor: '#0D1117',
          filter: (node) => !(node instanceof HTMLButtonElement && node.dataset.shareBtn),
        })
        blob = await (await fetch(dataUrl)).blob()
      }
      if (!blob) return
      const filename = `trademindset-${symbol}-${tf.label}.png`
      // 1. Clipboard
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        setShareOk(true); setTimeout(() => setShareOk(false), 2500)
        return
      } catch { /* fallback */ }
      // 2. Web Share (mobile)
      if (navigator.share && navigator.canShare) {
        const file = new File([blob], filename, { type: 'image/png' })
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ title: `TradeMindset — ${symbol}`, files: [file] })
          setShareOk(true); setTimeout(() => setShareOk(false), 2500)
          return
        }
      }
      // 3. Download fallback
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
      setShareOk(true); setTimeout(() => setShareOk(false), 2500)
    } catch (err) { console.warn('share chart failed', err) }
    finally { setSharing(false) }
  }

  const INDS=[
    {id:'vegas',  icon:'🌐', label:'MTF Vegas',   color:'#40e0d0',          noSettings:false},
    {id:'bb',     icon:'〰', label:'Bollinger',   color:'#00E5FF',          noSettings:false},
    {id:'vol',    icon:'📊', label:'Volume',      color:'var(--tm-profit)', noSettings:false},
    ...(isCrypto?[{id:'cvd', icon:'⚡', label:'CVD', color:'#FF9F0A', noSettings:false}]:[]),
    {id:'smc',    icon:'🏦', label:'SMC',         color:'var(--tm-blue)',    noSettings:false},
    {id:'msd',    icon:'📊', label:'Structure',   color:'var(--tm-profit)', noSettings:false},
    {id:'vmc',    icon:'〜', label:'VMC',         color:'var(--tm-purple)', noSettings:false},
    {id:'mp',     icon:'📈', label:'Vol Profile', color:'var(--tm-warning)',noSettings:false},
    {id:'rsiDiv', icon:'◇',  label:'RSI Div',     color:'#FF9F0A',          noSettings:true},
  ]
  const TOOLS=[
    {id:'cursor',icon:'↖',label:t('analyse.toolSelect')},
    {id:'hline',icon:'─',label:t('analyse.toolHline')},
    {id:'trendline',icon:'╱',label:t('analyse.toolLine')},
    {id:'fibo',icon:'◎',label:t('analyse.toolFibo')},
    {id:'rect',icon:'▭',label:'Zone'},
    {id:'note',icon:'✎',label:'Note'},
  ]

  return(
    <div ref={chartContainerRef} style={{background:'var(--tm-bg-secondary)',border:'1px solid #1E2330',borderRadius:16,overflow:'hidden',marginBottom:0,position:'relative',...(autoHeight&&{height:'100%',display:'flex',flexDirection:'column'})}}>

      {/* Header */}
      <div style={{padding:'10px 14px',borderBottom:'1px solid #1E2330',display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',...(autoHeight&&{flexShrink:0})}}>
        <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
          <div style={{width:26,height:26,borderRadius:7,background:'linear-gradient(135deg,#22C759,#00E5FF)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13}}>⚡</div>
          <div><div style={{fontSize:11,fontWeight:700,color:'var(--tm-text-primary)'}}>Lightweight Charts</div><div style={{fontSize:9,color:'var(--tm-text-muted)'}}>{`${t('analyse.firestoreSave')} · ${symbol}`}</div></div>
        </div>
        {liveP&&<div style={{display:'flex',alignItems:'baseline',gap:5,marginLeft:4}}>
          <span style={{fontSize:15,fontWeight:700,color:'var(--tm-text-primary)',fontFamily:'JetBrains Mono, monospace'}}>{fmtP(liveP)}</span>
          <span style={{fontSize:10,fontWeight:700,color:change>=0?'var(--tm-profit)':'var(--tm-loss)'}}>{change>=0?'+':''}{change.toFixed(2)}%</span>
          <span style={{fontSize:8,color:'#22C75990'}}>● LIVE</span>
        </div>}
        <div style={{display:'flex',gap:3,marginLeft:4,flexWrap:'wrap'}}>
          {TIMEFRAMES.map(t=><button key={t.label} onClick={()=>{setTf(t);onTimeframeChange?.(LW_MIN_TO_OSC[t.min]??'1h')}} style={{padding:'3px 8px',borderRadius:6,fontSize:10,fontWeight:600,cursor:'pointer',border:`1px solid ${tf.label===t.label?'var(--tm-accent)':'var(--tm-border)'}`,background:tf.label===t.label?`rgba(${resolveCSSColor('var(--tm-accent-rgb','0,229,255')},0.12)`:'transparent',color:tf.label===t.label?'var(--tm-accent)':'var(--tm-text-muted)'}}>{t.label}</button>)}
        </div>
        <button onClick={()=>setShowHist(x=>!x)} style={{marginLeft:'auto',padding:'3px 10px',borderRadius:6,fontSize:10,fontWeight:600,cursor:'pointer',border:`1px solid ${showHist?'var(--tm-profit)':'var(--tm-border)'}`,background:showHist?`rgba(${resolveCSSColor('var(--tm-profit-rgb','34,199,89')},0.1)`:'transparent',color:showHist?'var(--tm-profit)':'var(--tm-text-muted)',flexShrink:0}}>
          💾 {drawings.length>0?t('analyse.drawingCount', {count: drawings.length}):' Dessins'}
        </button>
        {/* Share chart */}
        <button
          data-share-btn="1"
          onClick={handleShareChart}
          disabled={sharing}
          title={t('analyse.shareChart')}
          style={{
            padding:'3px 10px',borderRadius:6,fontSize:10,fontWeight:600,cursor:sharing?'wait':'pointer',
            border:`1px solid ${shareOk?'var(--tm-profit)':'var(--tm-border)'}`,
            background:shareOk?`rgba(${resolveCSSColor('var(--tm-profit-rgb','34,199,89')},0.1)`:'transparent',
            color:shareOk?'var(--tm-profit)':'var(--tm-text-muted)',flexShrink:0,
            transition:'all 0.2s',
          }}>
          {shareOk?'✓ Copié':'📤'}
        </button>
      </div>

      {/* Indicateurs + settings */}
      <div style={{padding:'6px 14px',borderBottom:'1px solid #1E2330',display:'flex',alignItems:'center',gap:5,flexWrap:'wrap',...(autoHeight&&{flexShrink:0})}}>
        <span style={{fontSize:9,color:'var(--tm-text-muted)',fontWeight:700,flexShrink:0}}>{t('analyse.indicators')} :</span>
        {INDS.map(ind=>(
          <div key={ind.id} style={{display:'flex',alignItems:'center',gap:0}}>
            <button onClick={()=>toggleInd(ind.id)} style={{display:'flex',alignItems:'center',gap:4,padding:'3px 8px',
              borderRadius:ind.noSettings?'6px':'6px 0 0 6px',fontSize:10,fontWeight:600,cursor:'pointer',
              border:`1px solid ${indOn[ind.id]?ind.color:'var(--tm-border)'}`,
              borderRight:ind.noSettings?undefined:'none',
              background:indOn[ind.id]?`${ind.color}18`:'transparent',
              color:indOn[ind.id]?ind.color:'var(--tm-text-muted)'}}>
              {ind.icon} {ind.label}
              {indOn[ind.id]&&<span style={{width:5,height:5,borderRadius:'50%',background:ind.color,display:'inline-block'}}/>}
            </button>
            {!ind.noSettings&&<button onClick={()=>setSettingsOpen(settingsOpen===ind.id?null:ind.id)} style={{padding:'3px 6px',borderRadius:'0 6px 6px 0',fontSize:10,cursor:'pointer',
              border:`1px solid ${indOn[ind.id]?ind.color:'var(--tm-border)'}`,
              background:settingsOpen===ind.id?`${ind.color}28`:'transparent',
              color:settingsOpen===ind.id?ind.color:'var(--tm-text-muted)'}}>⚙</button>}
          </div>
        ))}
      </div>

      {/* Outils dessin */}
      <div style={{padding:'5px 14px',borderBottom:'1px solid #1E2330',display:'flex',alignItems:'center',gap:4,flexWrap:'wrap',...(autoHeight&&{flexShrink:0})}}>
        {TOOLS.map(t=><button key={t.id} onClick={()=>{setTool(t.id as ToolId);phase.current='idle';firstPt.current=null;setSelectedId(null)}} style={{padding:'3px 9px',borderRadius:6,fontSize:10,fontWeight:600,cursor:'pointer',border:`1px solid ${tool===t.id?'var(--tm-warning)':'var(--tm-border)'}`,background:tool===t.id?`rgba(${resolveCSSColor('var(--tm-warning-rgb','255,149,0')},0.12)`:'transparent',color:tool===t.id?'var(--tm-warning)':'var(--tm-text-muted)'}}>{t.icon} {t.label}</button>)}
        <div style={{width:1,height:14,background:'var(--tm-border)',margin:'0 4px'}}/>
        {/* Magnet */}
        <button onClick={()=>setMagnet(m=>!m)} title="Aimant — colle aux OHLC" style={{padding:'3px 9px',borderRadius:6,fontSize:12,cursor:'pointer',border:`1px solid ${magnet?'#FFD60A':'var(--tm-border)'}`,background:magnet?'rgba(255,214,10,0.12)':'transparent',color:magnet?'#FFD60A':'var(--tm-text-muted)'}}>🧲</button>
        <div style={{width:1,height:14,background:'var(--tm-border)',margin:'0 4px'}}/>
        {COLORS.map(c=><div key={c} onClick={()=>setColor(c)} style={{width:14,height:14,borderRadius:'50%',background:c,cursor:'pointer',flexShrink:0,outline:color===c?'2px solid #F0F3FF':'none',outlineOffset:1}}/>)}
        {selectedId&&<span style={{marginLeft:8,fontSize:9,color:'var(--tm-loss)'}}>← Clic sur ✕ pour supprimer · Suppr. pour effacer</span>}
        {!selectedId&&tool!=='cursor'&&phase.current==='first'&&<span style={{fontSize:10,color:'var(--tm-warning)',fontWeight:700,marginLeft:4}}>← 2ème point</span>}
      </div>

      {/* Chart */}
      <div style={{position:'relative',background:'var(--tm-bg)',...(autoHeight&&{flex:1,overflow:'hidden',minHeight:0})}} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} onClick={handleClick}>
        {loading&&<div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'#0D111790',zIndex:4}}><div style={{width:24,height:24,border:'2px solid #1E2330',borderTopColor:'var(--tm-profit)',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/></div>}
        {!loading&&fetchError&&<div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'var(--tm-bg)',zIndex:4,gap:10}}>
          <span style={{fontSize:28}}>📊</span>
          <span style={{fontSize:12,color:'var(--tm-loss)',fontWeight:600,textAlign:'center',maxWidth:280,padding:'0 20px'}}>{fetchError}</span>
          <span style={{fontSize:11,color:'var(--tm-text-muted)',textAlign:'center',maxWidth:280,padding:'0 20px'}}>Essayez: AAPL · TSLA · MSFT · EURUSD=X · GC=F (Gold) · ^FCHI (CAC40) · BTC-USD</span>
          <button onClick={()=>load()} style={{padding:'6px 16px',borderRadius:8,background:`rgba(${resolveCSSColor('var(--tm-accent-rgb','0,229,255')},0.1)`,border:'1px solid #00E5FF',color:'var(--tm-accent)',cursor:'pointer',fontSize:11}}>Réessayer</button>
        </div>}
        <div ref={chartEl} style={{width:'100%',height:autoHeight?'100%':chartHeight}}/>
        <canvas ref={overlayEl} style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',zIndex:2,pointerEvents:'none'}}/>
        {/* Settings panel */}
        {settingsOpen&&<SettingsPanel activeId={settingsOpen} vmcSettings={vmcS} setVmcSettings={setVmcS} smcSettings={smcS} setSmcSettings={setSmcS} msdSettings={msdS} setMsdSettings={setMsdS} mpSettings={mpS} setMpSettings={setMpS} bbSettings={bbS} setBbSettings={setBbS} vegasSettings={vegasS} setVegasSettings={setVegasS} volSettings={volS} setVolSettings={setVolS} onClose={()=>setSettingsOpen(null)}/>}
      </div>

      {/* VMC Panel */}
      {indOn.vmc&&vmcResult&&<VMCPanel vmcResult={vmcResult} settings={vmcS}/>}

      {/* Confirm */}
      {confirm&&<div style={{padding:'10px 14px',background:`rgba(${resolveCSSColor('var(--tm-warning-rgb','255,149,0')},0.06)`,borderTop:'1px solid rgba(var(--tm-warning-rgb,255,149,0),0.2)',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <span style={{fontSize:11,fontWeight:700,color:'var(--tm-warning)',flexShrink:0}}>
          {confirm.type==='hline'?`─ @ ${fmtP(confirm.p1.price)}`:confirm.type==='trendline'?t('analyse.confirmTrend'):confirm.type==='fibo'?t('analyse.confirmFibo'):confirm.type==='rect'?t('analyse.confirmRect'):'✎ Note'}
        </span>
        <input autoFocus value={labelInput} onChange={e=>setLabelInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')handleSave()}} placeholder={confirm.type==='note'?'Texte…':'Label optionnel…'} style={{flex:1,background:'var(--tm-bg-tertiary)',border:'1px solid #2A2F3E',borderRadius:8,padding:'5px 10px',color:'var(--tm-text-primary)',fontSize:11,minWidth:120}}/>
        <button onClick={handleSave} disabled={saving} style={{padding:'5px 14px',borderRadius:8,fontSize:11,fontWeight:700,cursor:'pointer',background:`rgba(${resolveCSSColor('var(--tm-profit-rgb','34,199,89')},0.15)`,border:'1px solid #22C759',color:'var(--tm-profit)'}}>{saving?'…':'💾 Sauvegarder'}</button>
        <button onClick={()=>{setConfirm(null);phase.current='idle'}} style={{padding:'5px 10px',borderRadius:8,fontSize:11,cursor:'pointer',background:'transparent',border:'1px solid #2A2F3E',color:'var(--tm-text-muted)'}}>✕</button>
      </div>}

      {/* History */}
      {showHist&&<div style={{borderTop:'1px solid #1E2330',maxHeight:200,overflowY:'auto'}}>
        {drawings.length===0?<div style={{padding:'14px',textAlign:'center',color:'var(--tm-text-muted)',fontSize:12}}>{t('analyse.noDrawings', {symbol, tf: tf.label})}</div>
        :drawings.map(d=><div key={d.id} onClick={()=>setSelectedId(d.id===selectedId?null:d.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'7px 14px',borderBottom:'1px solid rgba(255,255,255,0.03)',cursor:'pointer',background:d.id===selectedId?`rgba(${resolveCSSColor('var(--tm-warning-rgb','255,149,0')},0.05)`:'transparent'}}>
          <div style={{width:3,height:26,borderRadius:2,background:d.color,flexShrink:0}}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:11,fontWeight:600,color:'var(--tm-text-primary)'}}>
              {d.type==='hline'?`─ @ ${fmtP(d.p1.price)}`:d.type==='trendline'?t('analyse.confirmTrend'):d.type==='fibo'?t('analyse.confirmFibo'):d.type==='rect'?t('analyse.confirmRect'):`✎ ${d.label||'Note'}`}
            </div>
            <div style={{fontSize:9,color:'var(--tm-text-muted)'}}>{new Date(d.ts).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
          </div>
          <button onClick={async(e)=>{e.stopPropagation();await dbDelete(d.id);setDrawings(p=>p.filter(x=>x.id!==d.id));if(selectedId===d.id)setSelectedId(null);toast$(t('analyse.deleted'))}}
            style={{background:`rgba(${resolveCSSColor('var(--tm-loss-rgb','255,59,48')},0.1)`,border:'1px solid rgba(var(--tm-loss-rgb,255,59,48),0.2)',borderRadius:6,color:'var(--tm-loss)',cursor:'pointer',fontSize:10,padding:'3px 8px'}}>✕</button>
        </div>)}
      </div>}

      {toast&&<div style={{position:'absolute',bottom:16,left:'50%',transform:'translateX(-50%)',background:'var(--tm-bg-tertiary)',border:'1px solid #2A2F3E',borderRadius:10,padding:'8px 16px',fontSize:12,color:'var(--tm-text-primary)',zIndex:10,whiteSpace:'nowrap',pointerEvents:'none',boxShadow:'0 4px 20px rgba(0,0,0,0.6)'}}>{toast}</div>}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
