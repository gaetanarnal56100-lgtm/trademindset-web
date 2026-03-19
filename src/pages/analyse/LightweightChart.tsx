// LightweightChart.tsx — Graphique avec indicateurs Pine portés en TypeScript
// Indicateurs activables : SMC (OB+FVG), VMC, Market Structure Dashboard, Market Profile
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createChart, IChartApi, ISeriesApi, CrosshairMode, Time, CandlestickData, LineStyle } from 'lightweight-charts'
import { getAuth } from 'firebase/auth'
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, Timestamp } from 'firebase/firestore'
import app from '@/services/firebase/config'

const db = getFirestore(app)

// ── Types ─────────────────────────────────────────────────────────────────
interface Props { symbol: string; isCrypto: boolean }
interface Candle { time: number; open: number; high: number; low: number; close: number; volume?: number }
type ToolId = 'cursor'|'hline'|'fibo'|'trend'|'rect'|'note'
interface Drawing { id?:string; type:ToolId; symbol:string; tf:string; data:any; label?:string; color:string; ts:number }
interface Pt { x:number; y:number; price:number }
interface Indicator { id:string; label:string; icon:string; color:string; enabled:boolean; description:string }

const TIMEFRAMES = [
  {label:'1m',min:1},{label:'5m',min:5},{label:'15m',min:15},{label:'30m',min:30},
  {label:'1h',min:60},{label:'4h',min:240},{label:'1j',min:1440},{label:'1S',min:10080},
]
const COLORS = ['#FF3B30','#FF9500','#FFD60A','#22C759','#00E5FF','#0A85FF','#BF5AF2','#F0F3FF']
const FIBO_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]

function tfStr(min:number) {
  if(min<60)return`${min}m`;if(min<1440)return`${min/60}h`;if(min<10080)return'1d';return'1w'
}
function fmtP(p:number){return p>1000?`$${p.toLocaleString('fr-FR',{maximumFractionDigits:1})}`:p>1?`$${p.toFixed(2)}`:`$${p.toFixed(5)}`}
function ema(data:number[], len:number):number[] {
  const k=2/(len+1),r=new Array(data.length).fill(0)
  r[0]=data[0]
  for(let i=1;i<data.length;i++)r[i]=data[i]*k+r[i-1]*(1-k)
  return r
}
function sma(data:number[], len:number):number[] {
  return data.map((_,i)=>{
    if(i<len-1)return data[i]
    return data.slice(i-len+1,i+1).reduce((a,b)=>a+b,0)/len
  })
}
function rsi(closes:number[], len:number):number[] {
  const r=new Array(closes.length).fill(50)
  for(let i=len;i<closes.length;i++){
    let gains=0,losses=0
    for(let j=i-len+1;j<=i;j++){
      const d=closes[j]-closes[j-1]
      if(d>0)gains+=d; else losses-=d
    }
    const ag=gains/len,al=losses/len
    r[i]=al===0?100:100-100/(1+ag/al)
  }
  return r
}
function stdev(data:number[], len:number):number[] {
  const avg=sma(data,len)
  return data.map((_,i)=>{
    if(i<len-1)return 0
    const m=avg[i]
    return Math.sqrt(data.slice(i-len+1,i+1).reduce((a,v)=>a+Math.pow(v-m,2),0)/len)
  })
}
function highest(data:number[], len:number):number[] {
  return data.map((_,i)=>i<len-1?data[i]:Math.max(...data.slice(i-len+1,i+1)))
}
function lowest(data:number[], len:number):number[] {
  return data.map((_,i)=>i<len-1?data[i]:Math.min(...data.slice(i-len+1,i+1)))
}
function atr(candles:Candle[], len:number):number[] {
  const tr=candles.map((c,i)=>i===0?c.high-c.low:Math.max(c.high-c.low,Math.abs(c.high-candles[i-1].close),Math.abs(c.low-candles[i-1].close)))
  return sma(tr,len)
}

// ── Firestore ──────────────────────────────────────────────────────────────
function uid(){return getAuth().currentUser?.uid}
async function dbSave(d:Drawing):Promise<string>{
  const u=uid();if(!u)throw new Error('Non connecté')
  const ref=await addDoc(collection(db,'users',u,'chartDrawings'),{...d,ts:Timestamp.now()})
  return ref.id
}
async function dbLoad(sym:string,tf:string):Promise<(Drawing&{id:string})[]>{
  const u=uid();if(!u)return[]
  const snap=await getDocs(query(collection(db,'users',u,'chartDrawings'),orderBy('ts','desc')))
  return snap.docs.map(d=>({id:d.id,...d.data() as Drawing,ts:(d.data().ts as Timestamp).toMillis()}))
    .filter(d=>d.symbol===sym&&d.tf===tf)
}
async function dbDelete(id:string){
  const u=uid();if(!u)return
  await deleteDoc(doc(db,'users',u,'chartDrawings',id))
}

// ── Fetch candles ─────────────────────────────────────────────────────────
async function fetchCandles(sym:string,isCrypto:boolean,min:number):Promise<Candle[]> {
  if(!isCrypto)return[]
  const s=sym.replace(/USDT$/i,'')+'USDT'
  for(const base of['https://fapi.binance.com/fapi/v1','https://api.binance.com/api/v3']){
    try{
      const r=await fetch(`${base}/klines?symbol=${s}&interval=${tfStr(min)}&limit=500`)
      if(!r.ok)continue
      const d=await r.json()
      if(!Array.isArray(d)||!d.length)continue
      return d.map((k:any[])=>({time:Math.floor(k[0]/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5]}))
    }catch{}
  }
  return[]
}

// ══════════════════════════════════════════════════════════════════════════
// ── INDICATEURS PORTÉS DEPUIS PINE ───────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════

// ── SMC : Order Blocks + FVG (Script 1 simplifié) ─────────────────────────
interface OBResult { bullOBs:{top:number;btm:number;idx:number}[]; bearOBs:{top:number;btm:number;idx:number}[]; bullFVGs:{top:number;btm:number;idx:number}[]; bearFVGs:{top:number;btm:number;idx:number}[] }
function calcSMC(candles:Candle[], swingLen=10):OBResult {
  const n=candles.length
  const bullOBs:OBResult['bullOBs']=[], bearOBs:OBResult['bearOBs']=[]
  const bullFVGs:OBResult['bullFVGs']=[], bearFVGs:OBResult['bearFVGs']=[]
  if(n<swingLen*2+5)return{bullOBs,bearOBs,bullFVGs,bearFVGs}

  // FVGs — gap entre low[i] et high[i-2] (bullish) ou high[i] et low[i-2] (bearish)
  for(let i=2;i<n;i++){
    const c=candles[i],c1=candles[i-1],c2=candles[i-2]
    // Bullish FVG : low[i] > high[i-2]
    if(c.low>c2.high && c1.close>c1.open){
      bullFVGs.push({top:c.low,btm:c2.high,idx:i-2})
    }
    // Bearish FVG : high[i] < low[i-2]
    if(c.high<c2.low && c1.close<c1.open){
      bearFVGs.push({top:c2.low,btm:c.high,idx:i-2})
    }
  }

  // Order Blocks — dernière bougie d'une direction avant un BOS
  const pivHighs:number[]=new Array(n).fill(0), pivLows:number[]=new Array(n).fill(0)
  for(let i=swingLen;i<n-swingLen;i++){
    let isPH=true,isPL=true
    for(let j=i-swingLen;j<=i+swingLen;j++){
      if(j===i)continue
      if(candles[j].high>=candles[i].high)isPH=false
      if(candles[j].low<=candles[i].low)isPL=false
    }
    if(isPH)pivHighs[i]=candles[i].high
    if(isPL)pivLows[i]=candles[i].low
  }

  // Trouver les OBs : bougie bearish juste avant une hausse cassant le pivot haut précédent
  let lastPivHigh=0, lastPivLow=999999
  for(let i=swingLen;i<n;i++){
    if(pivHighs[i]>0)lastPivHigh=pivHighs[i]
    if(pivLows[i]>0)lastPivLow=pivLows[i]
    // Bullish OB : close casse le pivot haut → la dernière bougie bearish avant est l'OB
    if(candles[i].close>lastPivHigh && lastPivHigh>0){
      for(let j=i-1;j>=Math.max(0,i-swingLen*2);j--){
        if(candles[j].close<candles[j].open){
          bullOBs.push({top:Math.max(candles[j].open,candles[j].close),btm:Math.min(candles[j].open,candles[j].close),idx:j})
          lastPivHigh=0; break
        }
      }
    }
    // Bearish OB : close casse le pivot bas → la dernière bougie bullish avant est l'OB
    if(candles[i].close<lastPivLow && lastPivLow<999999){
      for(let j=i-1;j>=Math.max(0,i-swingLen*2);j--){
        if(candles[j].close>candles[j].open){
          bearOBs.push({top:Math.max(candles[j].open,candles[j].close),btm:Math.min(candles[j].open,candles[j].close),idx:j})
          lastPivLow=999999; break
        }
      }
    }
  }

  // Garder seulement les 3 plus récents non cassés
  const currentPrice=candles[n-1].close
  return{
    bullOBs:bullOBs.filter(ob=>ob.top>currentPrice*0.95).slice(-3),
    bearOBs:bearOBs.filter(ob=>ob.btm<currentPrice*1.05).slice(-3),
    bullFVGs:bullFVGs.filter(fvg=>fvg.top>currentPrice*0.92).slice(-3),
    bearFVGs:bearFVGs.filter(fvg=>fvg.btm<currentPrice*1.08).slice(-3),
  }
}

// ── VMC Oscillator (Script 3 — noyau) ─────────────────────────────────────
interface VMCResult { sig:number[]; sigSignal:number[]; mom:number[]; isBull:boolean[]; isBear:boolean[]; buySignals:number[]; sellSignals:number[] }
function calcVMC(candles:Candle[], smoothLen=10):VMCResult {
  const n=candles.length
  const hlc3=candles.map(c=>(c.high+c.low+c.close)/3)
  const closes=candles.map(c=>c.close)
  // RSI
  const rsiVals=rsi(closes,14)
  // Stoch RSI
  const rsiHighs=highest(rsiVals,14),rsiLows=lowest(rsiVals,14)
  const stochRsi=rsiVals.map((r,i)=>rsiHighs[i]===rsiLows[i]?0:(r-rsiLows[i])/(rsiHighs[i]-rsiLows[i])*100)
  const stoch=sma(stochRsi,2)
  // MFI simplifié
  const mfi=hlc3.map((h,i)=>{
    if(i===0)return 50
    return h>hlc3[i-1]?60:h<hlc3[i-1]?40:50
  })
  // Core
  const core=hlc3.map((_,i)=>(rsiVals[i]+0.4*mfi[i]+0.4*stoch[i])/1.8)
  // Transform
  const transform=(v:number,mult:number)=>{
    const t=(v/100-0.5)*2;return mult*100*Math.sign(t)*Math.pow(Math.abs(t),0.75)
  }
  const coreEma=ema(core,smoothLen)
  const sigVals=coreEma.map(v=>transform(v,1))
  const sigSignalVals=ema(core,Math.round(smoothLen*1.75)).map(v=>transform(v,1))
  const momVals=sigVals.map((s,i)=>s-sigSignalVals[i])

  // EMA Ribbon (8 EMAs 20-55)
  const lens=[20,25,30,35,40,45,50,55]
  const emas=lens.map(l=>ema(closes,l))
  const isBull=closes.map((_,i)=>{
    let up=0;for(let j=0;j<7;j++)if(emas[j][i]>emas[j+1][i])up++;return up>=5
  })
  const isBear=closes.map((_,i)=>{
    let dn=0;for(let j=0;j<7;j++)if(emas[j][i]<emas[j+1][i])dn++;return dn>=5
  })

  // Signaux
  const buySignals:number[]=[],sellSignals:number[]=[]
  for(let i=1;i<n;i++){
    const bullCross=sigVals[i]>sigSignalVals[i]&&sigVals[i-1]<=sigSignalVals[i-1]
    const bearCross=sigVals[i]<sigSignalVals[i]&&sigVals[i-1]>=sigSignalVals[i-1]
    if(bullCross&&sigVals[i]<-30&&isBull[i])buySignals.push(i)
    if(bearCross&&sigVals[i]>30&&isBear[i])sellSignals.push(i)
  }

  return{sig:sigVals,sigSignal:sigSignalVals,mom:momVals,isBull,isBear,buySignals,sellSignals}
}

// ── Market Structure Dashboard (Script 2 — simplifié) ─────────────────────
interface MSDResult { swingHighs:{idx:number;price:number;type:'HH'|'LH'}[]; swingLows:{idx:number;price:number;type:'HL'|'LL'}[]; bosLines:{from:number;to:number;price:number;type:'BOS'|'CHoCH';dir:'bull'|'bear'}[] }
function calcMSD(candles:Candle[], swingLen=5):MSDResult {
  const n=candles.length
  const swingHighs:MSDResult['swingHighs']=[], swingLows:MSDResult['swingLows']=[], bosLines:MSDResult['bosLines']=[]
  if(n<swingLen*2+2)return{swingHighs,swingLows,bosLines}

  let prevPH=0,prevPL=999999,trend=1
  for(let i=swingLen;i<n-swingLen;i++){
    let isPH=true,isPL=true
    for(let j=i-swingLen;j<=i+swingLen;j++){
      if(j===i)continue
      if(candles[j].high>=candles[i].high)isPH=false
      if(candles[j].low<=candles[i].low)isPL=false
    }
    if(isPH){
      const type=candles[i].high>prevPH?'HH':'LH'
      swingHighs.push({idx:i,price:candles[i].high,type})
      // BOS/CHoCH
      if(prevPH>0){
        for(let k=i+1;k<Math.min(n,i+swingLen*3);k++){
          if(candles[k].close>prevPH){
            bosLines.push({from:i-swingLen,to:k,price:prevPH,type:trend===1?'BOS':'CHoCH',dir:'bull'})
            if(trend!==1)trend=1; break
          }
        }
      }
      prevPH=candles[i].high
    }
    if(isPL){
      const type=candles[i].low<prevPL?'LL':'HL'
      swingLows.push({idx:i,price:candles[i].low,type})
      if(prevPL<999999){
        for(let k=i+1;k<Math.min(n,i+swingLen*3);k++){
          if(candles[k].close<prevPL){
            bosLines.push({from:i-swingLen,to:k,price:prevPL,type:trend===-1?'BOS':'CHoCH',dir:'bear'})
            if(trend!==-1)trend=-1; break
          }
        }
      }
      prevPL=candles[i].low
    }
  }
  return{swingHighs:swingHighs.slice(-8),swingLows:swingLows.slice(-8),bosLines:bosLines.slice(-5)}
}

// ── Market Profile (Script 4 — POC/VAH/VAL) ───────────────────────────────
interface MPResult { poc:number; vah:number; val:number; profile:{price:number;vol:number}[] }
function calcMarketProfile(candles:Candle[], bins=30):MPResult|null {
  if(!candles.length)return null
  const hi=Math.max(...candles.map(c=>c.high))
  const lo=Math.min(...candles.map(c=>c.low))
  if(hi<=lo)return null
  const step=(hi-lo)/bins
  const buckets=Array.from({length:bins},(_,i)=>({price:lo+step*(i+0.5),vol:0}))
  for(const c of candles){
    const vol=(c.volume||1)/bins
    for(let i=0;i<bins;i++){
      const bLo=lo+step*i,bHi=lo+step*(i+1)
      if(c.low<=bHi&&c.high>=bLo)buckets[i].vol+=vol
    }
  }
  const maxVol=Math.max(...buckets.map(b=>b.vol))
  const pocIdx=buckets.findIndex(b=>b.vol===maxVol)
  const poc=buckets[pocIdx].price
  // Value Area 70%
  const total=buckets.reduce((a,b)=>a+b.vol,0)
  let sum=buckets[pocIdx].vol,lo_=pocIdx,hi_=pocIdx
  while(sum<total*0.7&&(lo_>0||hi_<bins-1)){
    if(hi_<bins-1)hi_++,sum+=buckets[hi_].vol
    if(lo_>0)lo_--,sum+=buckets[lo_].vol
  }
  return{poc,vah:buckets[hi_].price+step/2,val:buckets[lo_].price-step/2,profile:buckets}
}

// ══════════════════════════════════════════════════════════════════════════
// ── COMPOSANT PRINCIPAL ───────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════
// ── VMC Panel dédié ───────────────────────────────────────────────────────
function VMCPanel({vmcResult, candles}: {vmcResult: VMCResult; candles: Candle[]}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !vmcResult || !candles.length) return
    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const cssW2 = canvas.offsetWidth, cssH2 = canvas.offsetHeight
      canvas.width = cssW2 * dpr; canvas.height = cssH2 * dpr
      canvas.style.width = cssW2 + 'px'; canvas.style.height = cssH2 + 'px'
      const ctx = canvas.getContext('2d')!
      ctx.scale(dpr, dpr)
      const w = cssW2, h = cssH2
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#0D1117'; ctx.fillRect(0, 0, w, h)
      const n = vmcResult.sig.length
      const vis = Math.min(n, Math.floor(w / 2.5))
      const sig = vmcResult.sig.slice(-vis)
      const ss = vmcResult.sigSignal.slice(-vis)
      const mom = vmcResult.mom.slice(-vis)
      const len = sig.length; if (!len) return
      const allV = [...sig, ...ss]
      const minV = Math.min(...allV, -60), maxV = Math.max(...allV, 60)
      const range = maxV - minV || 1
      const toY = (v: number) => h * 0.9 - ((v - minV) / range) * (h * 0.8)
      const toX = (i: number) => (i / (len - 1)) * w
      // Zero line
      ctx.strokeStyle = '#2A2F3E'; ctx.lineWidth = 1; ctx.setLineDash([4,4])
      ctx.beginPath(); ctx.moveTo(0, toY(0)); ctx.lineTo(w, toY(0)); ctx.stroke()
      ctx.setLineDash([])
      // Thresholds
      for (const t of [40, -40]) {
        ctx.strokeStyle = t > 0 ? 'rgba(255,59,48,0.25)' : 'rgba(34,199,89,0.25)'
        ctx.lineWidth = 1; ctx.setLineDash([3,5])
        ctx.beginPath(); ctx.moveTo(0, toY(t)); ctx.lineTo(w, toY(t)); ctx.stroke()
        ctx.setLineDash([])
        ctx.font = '8px monospace'; ctx.fillStyle = t > 0 ? '#FF3B3060' : '#22C75960'
        ctx.fillText(t > 0 ? '+40' : '-40', 2, toY(t) - 2)
      }
      // Momentum bars
      const bw = Math.max(1, w / len - 0.5)
      for (let i = 0; i < len; i++) {
        const m = mom[i], x = toX(i) - bw/2, y0 = toY(0), ym = toY(m)
        ctx.fillStyle = m >= 0 ? 'rgba(34,199,89,0.4)' : 'rgba(255,59,48,0.4)'
        ctx.fillRect(x, Math.min(ym, y0), bw, Math.abs(ym - y0))
      }
      // Cloud
      ctx.beginPath()
      for (let i = 0; i < len; i++) i === 0 ? ctx.moveTo(toX(i), toY(sig[i])) : ctx.lineTo(toX(i), toY(sig[i]))
      for (let i = len-1; i >= 0; i--) ctx.lineTo(toX(i), toY(ss[i]))
      ctx.closePath()
      const bull = vmcResult.isBull[vmcResult.isBull.length - 1]
      ctx.fillStyle = bull ? 'rgba(34,199,89,0.1)' : 'rgba(255,59,48,0.1)'; ctx.fill()
      // VMC line
      ctx.strokeStyle = '#00E5FF'; ctx.lineWidth = 2; ctx.beginPath()
      for (let i = 0; i < len; i++) i === 0 ? ctx.moveTo(toX(i), toY(sig[i])) : ctx.lineTo(toX(i), toY(sig[i]))
      ctx.stroke()
      // Signal line
      ctx.strokeStyle = '#FF9500'; ctx.lineWidth = 1.5; ctx.beginPath()
      for (let i = 0; i < len; i++) i === 0 ? ctx.moveTo(toX(i), toY(ss[i])) : ctx.lineTo(toX(i), toY(ss[i]))
      ctx.stroke()
      // BUY/SELL signals
      const off = n - len
      for (const idx of vmcResult.buySignals) {
        const ri = idx - off; if (ri < 0 || ri >= len) continue
        const x = toX(ri)
        ctx.fillStyle = '#22C759'; ctx.beginPath()
        ctx.moveTo(x, h-2); ctx.lineTo(x-5, h-10); ctx.lineTo(x+5, h-10); ctx.closePath(); ctx.fill()
      }
      for (const idx of vmcResult.sellSignals) {
        const ri = idx - off; if (ri < 0 || ri >= len) continue
        const x = toX(ri)
        ctx.fillStyle = '#FF3B30'; ctx.beginPath()
        ctx.moveTo(x, 2); ctx.lineTo(x-5, 10); ctx.lineTo(x+5, 10); ctx.closePath(); ctx.fill()
      }
      // Label
      const last = sig[len-1]
      ctx.font = 'bold 9px JetBrains Mono, monospace'
      ctx.fillStyle = '#00E5FF'; ctx.fillText(`VMC ${last>=0?'+':''}${last.toFixed(1)}`, 6, 12)
      ctx.fillStyle = bull ? '#22C759' : '#FF3B30'; ctx.fillText(bull ? '▲ BULL' : '▼ BEAR', 60, 12)
    }
    draw()
    const ro = new ResizeObserver(draw); ro.observe(canvas)
    return () => ro.disconnect()
  }, [vmcResult, candles])

  return (
    <div style={{borderTop:'1px solid #1E2330'}}>
      <div style={{padding:'3px 14px',background:'rgba(191,90,242,0.06)',display:'flex',alignItems:'center',gap:8}}>
        <span style={{fontSize:9,fontWeight:700,color:'#BF5AF2'}}>〜 VMC</span>
        <span style={{fontSize:8,color:'#555C70'}}>cyan=VMC · orange=Signal · barres=momentum · ▲▼=signaux</span>
      </div>
      <canvas ref={canvasRef} style={{width:'100%',height:90,display:'block'}}/>
    </div>
  )
}


export default function LightweightChart({symbol,isCrypto}:Props) {
  const chartEl   = useRef<HTMLDivElement>(null)
  const overlayEl = useRef<HTMLCanvasElement>(null)
  const indLayerEl = useRef<HTMLCanvasElement>(null)
  const chartApi  = useRef<IChartApi|null>(null)
  const series    = useRef<ISeriesApi<'Candlestick'>|null>(null)
  const wsRef     = useRef<WebSocket|null>(null)
  const candlesRef = useRef<Candle[]>([])

  const [tf,       setTf]       = useState(TIMEFRAMES[2])
  const [tool,     setTool]     = useState<ToolId>('cursor')
  const [color,    setColor]    = useState('#FF9500')
  const [drawings, setDrawings] = useState<(Drawing&{id:string})[]>([])
  const [liveP,    setLiveP]    = useState<number|null>(null)
  const [change,   setChange]   = useState(0)
  const [loading,  setLoading]  = useState(true)
  const [showHist, setShowHist] = useState(false)
  const [toast,    setToast]    = useState<string|null>(null)
  const [saving,   setSaving]   = useState(false)
  const [confirmPanel, setConfirmPanel] = useState<{type:ToolId;data:any;label:string}|null>(null)
  const phase    = useRef<'idle'|'first'>('idle')
  const firstPt  = useRef<Pt|null>(null)
  const pending  = useRef<{type:ToolId;data:any}|null>(null)

  // Indicateurs
  const [indicators, setIndicators] = useState<Indicator[]>([
    {id:'smc',     label:'SMC',              icon:'🏦', color:'#0A85FF', enabled:false, description:'Order Blocks + Fair Value Gaps (SMC Pro)'},
    {id:'msd',     label:'Market Structure', icon:'📊', color:'#22C759', enabled:false, description:'Swing H/L, BOS/CHoCH (Dashboard MTF)'},
    {id:'vmc',     label:'VMC Oscillator',   icon:'〜', color:'#BF5AF2', enabled:false, description:'VMC + EMA Ribbon + Signaux BUY/SELL'},
    {id:'mp',      label:'Market Profile',   icon:'📈', color:'#FF9500', enabled:false, description:'POC / VAH / VAL (Profil de marché)'},
  ])

  // Résultats calculés
  const [smcResult,  setSmcResult]  = useState<OBResult|null>(null)
  const [msdResult,  setMsdResult]  = useState<MSDResult|null>(null)
  const [vmcResult,  setVmcResult]  = useState<VMCResult|null>(null)
  const [mpResult,   setMpResult]   = useState<MPResult|null>(null)

  const toast$ = useCallback((msg:string)=>{setToast(msg);setTimeout(()=>setToast(null),2500)},[])
  const isEnabled = (id:string)=>indicators.find(i=>i.id===id)?.enabled??false
  const toggleIndicator = (id:string)=>setIndicators(prev=>prev.map(i=>i.id===id?{...i,enabled:!i.enabled}:i))

  // ── Init Chart ─────────────────────────────────────────────────────────
  useEffect(()=>{
    const el=chartEl.current;if(!el)return
    const c=createChart(el,{
      width:el.clientWidth,height:420,
      layout:{background:{color:'#0D1117'},textColor:'#555C70'},
      grid:{vertLines:{color:'#1E233040'},horzLines:{color:'#1E233040'}},
      crosshair:{mode:CrosshairMode.Normal},
      rightPriceScale:{borderColor:'#1E2330'},
      timeScale:{borderColor:'#1E2330',timeVisible:true,secondsVisible:false},
    })
    chartApi.current=c
    series.current=c.addCandlestickSeries({
      upColor:'#22C759',downColor:'#FF3B30',
      borderUpColor:'#22C759',borderDownColor:'#FF3B30',
      wickUpColor:'#22C759',wickDownColor:'#FF3B30',
    })
    const ro=new ResizeObserver(()=>c.applyOptions({width:el.clientWidth}))
    ro.observe(el)
    return()=>{ro.disconnect();c.remove();chartApi.current=null}
  },[])

  // ── Load + WS ──────────────────────────────────────────────────────────
  const load=useCallback(async()=>{
    if(!series.current)return
    setLoading(true);wsRef.current?.close()
    const candles=await fetchCandles(symbol,isCrypto,tf.min)
    if(candles.length){
      series.current.setData(candles.map(c=>({time:c.time as Time,open:c.open,high:c.high,low:c.low,close:c.close})))
      candlesRef.current=candles
      const last=candles[candles.length-1],first=candles[0]
      setLiveP(last.close);setChange(((last.close-first.open)/first.open)*100)
      chartApi.current?.timeScale().fitContent()
      // Calculer indicateurs
      setSmcResult(calcSMC(candles))
      setMsdResult(calcMSD(candles))
      setVmcResult(calcVMC(candles))
      setMpResult(calcMarketProfile(candles))
    }
    setLoading(false)
    if(isCrypto){
      const s=symbol.toLowerCase().replace(/usdt$/,'')+'usdt'
      const ws=new WebSocket(`wss://fstream.binance.com/ws/${s}@kline_${tfStr(tf.min)}`)
      ws.onerror=()=>{
        const ws2=new WebSocket(`wss://stream.binance.com:9443/ws/${s}@kline_${tfStr(tf.min)}`)
        ws2.onmessage=onWS;wsRef.current=ws2
      }
      ws.onmessage=onWS;wsRef.current=ws
    }
  },[symbol,isCrypto,tf])

  function onWS(e:MessageEvent){
    try{
      const k=JSON.parse(e.data).k;if(!k||!series.current||!chartApi.current)return
      series.current.update({time:Math.floor(k.t/1000) as Time,open:+k.o,high:+k.h,low:+k.l,close:+k.c})
      setLiveP(+k.c)
    }catch{}
  }
  useEffect(()=>{load()},[load])
  useEffect(()=>()=>{wsRef.current?.close()},[])
  useEffect(()=>{dbLoad(symbol,tf.label).then(setDrawings)},[symbol,tf.label])

  // ── Render indicator overlays ─────────────────────────────────────────
  const renderIndicators=useCallback(()=>{
    const canvas=indLayerEl.current;const chart=chartApi.current
    if(!canvas||!chart)return
    try { chart.timeScale() } catch { return } // chart disposed guard
    const dpr = window.devicePixelRatio || 1
    canvas.width = canvas.offsetWidth * dpr
    canvas.height = canvas.offsetHeight * dpr
    canvas.style.width = canvas.offsetWidth + 'px'
    canvas.style.height = canvas.offsetHeight + 'px'
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)
    let tScale: any, pScale: any
    try{tScale=chart.timeScale();pScale=chart.priceScale('right')}catch{return}
    if(!tScale||!pScale)return
    const candles=candlesRef.current;if(!candles.length)return

    const cssW = canvas.offsetWidth, cssH = canvas.offsetHeight
    function xForIdx(idx:number, clampLeft=false):number|null{
      const t=candles[idx]?.time;if(!t)return null
      const x=tScale.timeToCoordinate(t as Time)
      if(x===null) return clampLeft ? 0 : null
      return x
    }
    function yForPrice(p:number):number|null{
      try{return pScale?.priceToCoordinate?.(p)??null}catch{return null}
    }

    // ── SMC ───────────────────────────────────────────────────────────
    if(isEnabled('smc')&&smcResult){
      // Bullish OBs
      for(const ob of smcResult.bullOBs){
        const x=xForIdx(ob.idx,true);const y1=yForPrice(ob.top);const y2=yForPrice(ob.btm)
        if(x!=null&&y1!=null&&y2!=null){
          ctx.fillStyle='rgba(10,133,255,0.12)';ctx.strokeStyle='rgba(10,133,255,0.6)';ctx.lineWidth=1
          ctx.fillRect(x,Math.min(y1,y2),cssW-x,Math.abs(y2-y1))
          ctx.strokeRect(x,Math.min(y1,y2),cssW-x,Math.abs(y2-y1))
          ctx.font='9px JetBrains Mono, monospace';ctx.fillStyle='#0A85FF'
          ctx.fillText('OB Bull',x+4,Math.min(y1,y2)+11)
        }
      }
      // Bearish OBs
      for(const ob of smcResult.bearOBs){
        const x=xForIdx(ob.idx,true);const y1=yForPrice(ob.top);const y2=yForPrice(ob.btm)
        if(x!=null&&y1!=null&&y2!=null){
          ctx.fillStyle='rgba(255,59,48,0.12)';ctx.strokeStyle='rgba(255,59,48,0.6)';ctx.lineWidth=1
          ctx.fillRect(x,Math.min(y1,y2),cssW-x,Math.abs(y2-y1))
          ctx.strokeRect(x,Math.min(y1,y2),cssW-x,Math.abs(y2-y1))
          ctx.font='9px JetBrains Mono, monospace';ctx.fillStyle='#FF3B30'
          ctx.fillText('OB Bear',x+4,Math.min(y1,y2)+11)
        }
      }
      // Bullish FVGs
      for(const fvg of smcResult.bullFVGs){
        const x=xForIdx(fvg.idx,true);const y1=yForPrice(fvg.top);const y2=yForPrice(fvg.btm)
        if(x!=null&&y1!=null&&y2!=null){
          ctx.fillStyle='rgba(34,199,89,0.08)';ctx.strokeStyle='rgba(34,199,89,0.5)';ctx.lineWidth=1;ctx.setLineDash([4,3])
          ctx.fillRect(x,Math.min(y1,y2),cssW-x,Math.abs(y2-y1))
          ctx.strokeRect(x,Math.min(y1,y2),cssW-x,Math.abs(y2-y1))
          ctx.setLineDash([]);ctx.font='9px JetBrains Mono, monospace';ctx.fillStyle='#22C759'
          ctx.fillText('FVG ↑',x+4,Math.min(y1,y2)+11)
        }
      }
      // Bearish FVGs
      for(const fvg of smcResult.bearFVGs){
        const x=xForIdx(fvg.idx,true);const y1=yForPrice(fvg.top);const y2=yForPrice(fvg.btm)
        if(x!=null&&y1!=null&&y2!=null){
          ctx.fillStyle='rgba(255,149,0,0.08)';ctx.strokeStyle='rgba(255,149,0,0.5)';ctx.lineWidth=1;ctx.setLineDash([4,3])
          ctx.fillRect(x,Math.min(y1,y2),cssW-x,Math.abs(y2-y1))
          ctx.strokeRect(x,Math.min(y1,y2),cssW-x,Math.abs(y2-y1))
          ctx.setLineDash([]);ctx.font='9px JetBrains Mono, monospace';ctx.fillStyle='#FF9500'
          ctx.fillText('FVG ↓',x+4,Math.min(y1,y2)+11)
        }
      }
    }

    // ── Market Structure ──────────────────────────────────────────────
    if(isEnabled('msd')&&msdResult){
      // Swing labels
      for(const sh of msdResult.swingHighs){
        const x=xForIdx(sh.idx,false);const y=yForPrice(sh.price)
        if(x!=null&&y!=null){
          ctx.font='bold 10px JetBrains Mono, monospace';ctx.fillStyle=sh.type==='HH'?'#FF3B30':'#FF9500'
          ctx.fillText(sh.type,x-10,y-6)
        }
      }
      for(const sl of msdResult.swingLows){
        const x=xForIdx(sl.idx);const y=yForPrice(sl.price)
        if(x!=null&&y!=null){
          ctx.font='bold 10px JetBrains Mono, monospace';ctx.fillStyle=sl.type==='LL'?'#22C759':'#00E5FF'
          ctx.fillText(sl.type,x-10,y+14)
        }
      }
      // BOS/CHoCH lines
      for(const bos of msdResult.bosLines){
        const x1=xForIdx(bos.from);const x2=xForIdx(bos.to);const y=yForPrice(bos.price)
        if(x1!=null&&x2!=null&&y!=null){
          ctx.strokeStyle=bos.type==='BOS'?(bos.dir==='bull'?'#22C759':'#FF3B30'):'#FFD60A'
          ctx.lineWidth=1;ctx.setLineDash([5,3])
          ctx.beginPath();ctx.moveTo(x1,y);ctx.lineTo(x2,y);ctx.stroke()
          ctx.setLineDash([]);ctx.font='bold 9px JetBrains Mono, monospace'
          ctx.fillStyle=bos.type==='BOS'?(bos.dir==='bull'?'#22C759':'#FF3B30'):'#FFD60A'
          ctx.fillText(bos.type,Math.min(x1,x2)+(Math.abs(x2-x1))/2-10,y-4)
        }
      }
    }

    // ── VMC Signaux ───────────────────────────────────────────────────
    if(isEnabled('vmc')&&vmcResult){
      for(const idx of vmcResult.buySignals){
        const x=xForIdx(idx);const y=yForPrice(candles[idx].low)
        if(x!=null&&y!=null){
          ctx.fillStyle='#22C759';ctx.font='16px sans-serif'
          ctx.fillText('▲',x-6,y+20)
          ctx.font='bold 9px JetBrains Mono, monospace';ctx.fillStyle='#22C759'
          ctx.fillText('VMC BUY',x-15,y+32)
        }
      }
      for(const idx of vmcResult.sellSignals){
        const x=xForIdx(idx);const y=yForPrice(candles[idx].high)
        if(x!=null&&y!=null){
          ctx.fillStyle='#FF3B30';ctx.font='16px sans-serif'
          ctx.fillText('▼',x-6,y-12)
          ctx.font='bold 9px JetBrains Mono, monospace';ctx.fillStyle='#FF3B30'
          ctx.fillText('VMC SELL',x-15,y-22)
        }
      }
      // EMA Ribbon indicator (thin line at bottom)
      const lastBull=vmcResult.isBull[vmcResult.isBull.length-1]
      const lastBear=vmcResult.isBear[vmcResult.isBear.length-1]
      ctx.fillStyle=lastBull?'rgba(34,199,89,0.15)':lastBear?'rgba(255,59,48,0.15)':'rgba(255,255,255,0.04)'
      ctx.fillRect(0,cssH-8,cssW,8)
      ctx.font='9px sans-serif';ctx.fillStyle=lastBull?'#22C759':lastBear?'#FF3B30':'#555C70'
      ctx.fillText(lastBull?'▲ BULL RIBBON':lastBear?'▼ BEAR RIBBON':'— NEUTRAL',6,cssH-1)
    }

    // ── Market Profile ────────────────────────────────────────────────
    if(isEnabled('mp')&&mpResult){
      const {poc,vah,val}=mpResult
      for(const [price,label,color] of [[poc,'POC','#FF9500'],[vah,'VAH','#22C759'],[val,'VAL','#22C759']] as [number,string,string][]){
        const y=yForPrice(price);if(y==null)continue
        ctx.strokeStyle=color;ctx.lineWidth=price===poc?2:1
        ctx.setLineDash(price===poc?[]:[5,4])
        ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(cssW,y);ctx.stroke()
        ctx.setLineDash([])
        ctx.font='bold 10px JetBrains Mono, monospace';ctx.fillStyle=color
        ctx.fillStyle=color+'33';ctx.fillRect(cssW-60,y-10,58,14)
        ctx.fillStyle=color;ctx.fillText(`${label} ${fmtP(price)}`,cssW-58,y)
      }
    }
  },[smcResult,msdResult,vmcResult,mpResult,indicators])

  useEffect(()=>{
    renderIndicators()
    const c=chartApi.current;if(!c)return
    let u: (()=>void)|null = null
    try { u=c.timeScale().subscribeVisibleLogicalRangeChange(()=>renderIndicators()) } catch{}
    return()=>{ try{u?.()}catch{} }
  },[renderIndicators])

  // ── Render drawings ───────────────────────────────────────────────────
  const renderDrawings=useCallback(()=>{
    const canvas=overlayEl.current;const chart=chartApi.current
    if(!canvas||!chart)return
    let _ps: any; try{chart.timeScale();_ps=chart.priceScale('right')}catch{return}
    if(!_ps)return
    try { chart.timeScale() } catch { return } // chart disposed guard
    canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight
    const ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,canvas.width,canvas.height)
    drawings.forEach(d=>{
      ctx.strokeStyle=d.color;ctx.fillStyle=d.color;ctx.lineWidth=1.5;ctx.font='11px JetBrains Mono, monospace'
      if(d.type==='hline'&&d.data?.price!=null){
        const y=_ps?.priceToCoordinate?.(d.data.price);if(y==null)return
        ctx.setLineDash([6,4]);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke();ctx.setLineDash([])
        const tag=`${d.label?d.label+' ':''}${fmtP(d.data.price)}`;const tw=ctx.measureText(tag).width+12
        ctx.fillStyle=d.color+'33';ctx.beginPath();ctx.roundRect?.(6,y-14,tw,17,3);ctx.fill()
        ctx.fillStyle=d.color;ctx.fillText(tag,12,y-2)
      }
      if(d.type==='fibo'&&d.data?.p1&&d.data?.p2){
        const high=Math.max(d.data.p1.price,d.data.p2.price),low=Math.min(d.data.p1.price,d.data.p2.price),range=high-low
        FIBO_LEVELS.forEach(lvl=>{
          const p=high-range*lvl;const y=_ps?.priceToCoordinate?.(p);if(y==null)return
          ctx.globalAlpha=lvl===0||lvl===1?0.9:0.5;ctx.setLineDash(lvl===0||lvl===1?[]:[4,4])
          ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke();ctx.setLineDash([])
          ctx.globalAlpha=0.85;ctx.fillText(`${(lvl*100).toFixed(1)}%  ${fmtP(p)}`,8,y-3)
        });ctx.globalAlpha=1
      }
      if(d.type==='trend'&&d.data?.p1&&d.data?.p2){
        const y1=_ps?.priceToCoordinate?.(d.data.p1.price)
        const y2=_ps?.priceToCoordinate?.(d.data.p2.price)
        if(y1==null||y2==null)return
        const slope=(y2-y1)/(canvas.width*0.7)
        ctx.beginPath();ctx.moveTo(0,y1-slope*canvas.width*0.15);ctx.lineTo(canvas.width,y1+slope*canvas.width*0.85);ctx.stroke()
      }
      if(d.type==='rect'&&d.data?.p1&&d.data?.p2){
        const y1=_ps?.priceToCoordinate?.(d.data.p1.price)
        const y2=_ps?.priceToCoordinate?.(d.data.p2.price)
        if(y1==null||y2==null)return
        ctx.fillStyle=d.color+'18';ctx.fillRect(canvas.width*0.05,Math.min(y1,y2),canvas.width*0.9,Math.abs(y2-y1))
        ctx.strokeRect(canvas.width*0.05,Math.min(y1,y2),canvas.width*0.9,Math.abs(y2-y1))
      }
      if(d.type==='note'&&d.data?.price!=null){
        const y=_ps?.priceToCoordinate?.(d.data.price);if(y==null)return
        const tag=d.label||'Note';const tw=ctx.measureText(tag).width+20
        ctx.fillStyle=d.color+'22';ctx.strokeStyle=d.color
        ctx.beginPath();ctx.roundRect?.(8,y-16,tw,20,5);ctx.fill();ctx.stroke()
        ctx.fillStyle=d.color;ctx.fillText(tag,18,y-1)
        ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(8+tw,y);ctx.lineTo(canvas.width-50,y);ctx.stroke();ctx.setLineDash([])
      }
    })
  },[drawings])

  useEffect(()=>{
    renderDrawings()
    const ro=new ResizeObserver(()=>renderDrawings())
    if(overlayEl.current)ro.observe(overlayEl.current)
    return()=>ro.disconnect()
  },[drawings,renderDrawings])

  useEffect(()=>{
    const c=chartApi.current;if(!c)return
    let u: (()=>void)|null = null
    try { u=c.timeScale().subscribeVisibleLogicalRangeChange(()=>renderDrawings()) } catch{}
    return()=>{ try{u?.()}catch{} }
  },[drawings,renderDrawings])

  function yToPrice(y:number):number|null{return chartApi.current?.priceScale('right').coordinateToPrice(y)??null}

  const handleClick=useCallback((e:React.MouseEvent<HTMLCanvasElement>)=>{
    if(tool==='cursor')return
    const rect=e.currentTarget.getBoundingClientRect()
    const y=e.clientY-rect.top;const price=yToPrice(y);if(price==null)return
    const pt:Pt={x:e.clientX-rect.left,y,price}
    if(tool==='hline'||tool==='note'){pending.current={type:tool,data:{price}};setConfirmPanel({type:tool,data:{price},label:''})}
    else if(tool==='fibo'||tool==='trend'||tool==='rect'){
      if(phase.current==='idle'){phase.current='first';firstPt.current=pt;toast$(`1er point @ ${fmtP(price)} — cliquez le 2ème`)}
      else{
        phase.current='idle';const p1=firstPt.current!;firstPt.current=null
        pending.current={type:tool,data:{p1:{price:p1.price},p2:{price}}}
        setConfirmPanel({type:tool,data:{p1:{price:p1.price},p2:{price}},label:''})
      }
    }
  },[tool,toast$])

  const handleSave=async(label:string)=>{
    if(!pending.current)return;setSaving(true)
    try{
      const d:Drawing={...pending.current,symbol,tf:tf.label,color,label:label||undefined,ts:Date.now()}
      const id=await dbSave(d)
      setDrawings(prev=>[{...d,id},...prev]);setConfirmPanel(null);pending.current=null;toast$('✓ Sauvegardé')
    }catch{toast$('Erreur — connecte-toi d\'abord')}
    setSaving(false)
  }

  const TOOLS:{id:ToolId;icon:string;label:string}[]=[
    {id:'cursor',icon:'↖',label:'Curseur'},{id:'hline',icon:'─',label:'H. ligne'},
    {id:'trend',icon:'↗',label:'Tendance'},{id:'fibo',icon:'◎',label:'Fibonacci'},
    {id:'rect',icon:'▭',label:'Zone'},{id:'note',icon:'✎',label:'Note'},
  ]

  return(
    <div style={{background:'#161B22',border:'1px solid #1E2330',borderRadius:16,overflow:'hidden',marginBottom:16,position:'relative'}}>

      {/* Header */}
      <div style={{padding:'10px 14px',borderBottom:'1px solid #1E2330',display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
        <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
          <div style={{width:26,height:26,borderRadius:7,background:'linear-gradient(135deg,#22C759,#00E5FF)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13}}>⚡</div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:'#F0F3FF'}}>Lightweight Charts</div>
            <div style={{fontSize:9,color:'#555C70'}}>Sauvegarde Firestore · {symbol}</div>
          </div>
        </div>
        {liveP&&(
          <div style={{display:'flex',alignItems:'baseline',gap:5,marginLeft:4}}>
            <span style={{fontSize:14,fontWeight:700,color:'#F0F3FF',fontFamily:'JetBrains Mono, monospace'}}>{fmtP(liveP)}</span>
            <span style={{fontSize:10,fontWeight:600,color:change>=0?'#22C759':'#FF3B30',fontFamily:'JetBrains Mono, monospace'}}>{change>=0?'+':''}{change.toFixed(2)}%</span>
            <span style={{fontSize:8,color:'#22C75990'}}>● LIVE</span>
          </div>
        )}
        <div style={{display:'flex',gap:3,marginLeft:4,flexWrap:'wrap'}}>
          {TIMEFRAMES.map(t=>(
            <button key={t.label} onClick={()=>setTf(t)} style={{padding:'3px 7px',borderRadius:6,fontSize:10,fontWeight:600,cursor:'pointer',
              border:`1px solid ${tf.label===t.label?'#00E5FF':'#2A2F3E'}`,
              background:tf.label===t.label?'rgba(0,229,255,0.12)':'transparent',
              color:tf.label===t.label?'#00E5FF':'#555C70'}}>{t.label}</button>
          ))}
        </div>
        <button onClick={()=>setShowHist(x=>!x)} style={{marginLeft:'auto',padding:'3px 10px',borderRadius:6,fontSize:10,fontWeight:600,cursor:'pointer',
          border:`1px solid ${showHist?'#22C759':'#2A2F3E'}`,background:showHist?'rgba(34,199,89,0.1)':'transparent',
          color:showHist?'#22C759':'#555C70',flexShrink:0}}>
          💾 {drawings.length>0?`${drawings.length} sauvegarde${drawings.length>1?'s':''}`:' Sauvegardes'}
        </button>
      </div>

      {/* Indicateurs activables */}
      <div style={{padding:'7px 14px',borderBottom:'1px solid #1E2330',display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
        <span style={{fontSize:9,color:'#3D4254',flexShrink:0,fontWeight:700}}>INDICATEURS :</span>
        {indicators.map(ind=>(
          <button key={ind.id} onClick={()=>toggleIndicator(ind.id)}
            title={ind.description}
            style={{display:'flex',alignItems:'center',gap:4,padding:'3px 10px',borderRadius:20,fontSize:10,fontWeight:600,cursor:'pointer',
              border:`1px solid ${ind.enabled?ind.color:'#2A2F3E'}`,
              background:ind.enabled?`${ind.color}18`:'transparent',
              color:ind.enabled?ind.color:'#555C70',transition:'all 0.15s'}}>
            <span style={{fontSize:11}}>{ind.icon}</span>
            {ind.label}
            {ind.enabled&&<span style={{fontSize:8,opacity:0.7}}>●</span>}
          </button>
        ))}
      </div>

      {/* Outils dessin */}
      <div style={{padding:'6px 14px',borderBottom:'1px solid #1E2330',display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
        {TOOLS.map(t=>(
          <button key={t.id} onClick={()=>{setTool(t.id);phase.current='idle';firstPt.current=null}} style={{
            padding:'3px 9px',borderRadius:6,fontSize:10,fontWeight:600,cursor:'pointer',
            border:`1px solid ${tool===t.id?'#FF9500':'#2A2F3E'}`,
            background:tool===t.id?'rgba(255,149,0,0.12)':'transparent',
            color:tool===t.id?'#FF9500':'#555C70'}}>{t.icon} {t.label}</button>
        ))}
        <div style={{width:1,height:14,background:'#2A2F3E',margin:'0 4px'}}/>
        {COLORS.map(c=>(
          <div key={c} onClick={()=>setColor(c)} style={{width:14,height:14,borderRadius:'50%',background:c,cursor:'pointer',flexShrink:0,
            outline:color===c?`2px solid #F0F3FF`:'none',outlineOffset:1}}/>
        ))}
        {tool!=='cursor'&&<span style={{fontSize:10,color:'#FF9500',fontWeight:600,marginLeft:6}}>
          {phase.current==='first'?'Cliquez le 2ème point':'← Cliquez sur le graphique'}</span>}
      </div>

      {/* Chart */}
      <div style={{position:'relative',background:'#0D1117'}}>
        {loading&&(
          <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'#0D1117',zIndex:4}}>
            <div style={{width:24,height:24,border:'2px solid #1E2330',borderTopColor:'#22C759',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
          </div>
        )}
        <div ref={chartEl} style={{width:'100%',height:420}}/>
        {/* Couche indicateurs (dessous) */}
        <canvas ref={indLayerEl} style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',zIndex:2,pointerEvents:'none',background:'transparent'}}/>
        {/* Couche dessins (dessus) */}
        <canvas ref={overlayEl} onClick={handleClick}
          style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',zIndex:3,
            cursor:tool==='cursor'?'default':'crosshair',background:'transparent'}}/>
      </div>

      {/* VMC Panel */}
      {isEnabled('vmc')&&vmcResult&&<VMCPanel vmcResult={vmcResult} candles={candlesRef.current}/>}

      {/* Confirm panel */}
      {confirmPanel&&(
        <div style={{padding:'10px 14px',background:'rgba(255,149,0,0.06)',borderTop:'1px solid rgba(255,149,0,0.2)',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <span style={{fontSize:11,fontWeight:700,color:'#FF9500',flexShrink:0}}>
            {confirmPanel.type==='hline'?`─ Ligne H. @ ${fmtP(confirmPanel.data.price)}`:
             confirmPanel.type==='fibo' ?`◎ Fibo ${fmtP(confirmPanel.data.p1.price)} → ${fmtP(confirmPanel.data.p2.price)}`:
             confirmPanel.type==='trend'?`↗ Tendance`:confirmPanel.type==='rect'?`▭ Zone`:'✎ Note'}
          </span>
          <input autoFocus placeholder={confirmPanel.type==='note'?'Texte…':'Label optionnel…'} id="drawing-label-input"
            onKeyDown={e=>{if(e.key==='Enter')handleSave((e.target as HTMLInputElement).value)}}
            style={{flex:1,background:'#1C2130',border:'1px solid #2A2F3E',borderRadius:8,padding:'5px 10px',color:'#F0F3FF',fontSize:11,minWidth:120}}/>
          <button onClick={()=>handleSave((document.getElementById('drawing-label-input') as HTMLInputElement)?.value||'')}
            disabled={saving} style={{padding:'5px 14px',borderRadius:8,fontSize:11,fontWeight:700,cursor:'pointer',
              background:'rgba(34,199,89,0.15)',border:'1px solid #22C759',color:'#22C759'}}>
            {saving?'…':'💾 Sauvegarder'}</button>
          <button onClick={()=>{setConfirmPanel(null);pending.current=null;phase.current='idle'}} style={{
            padding:'5px 10px',borderRadius:8,fontSize:11,cursor:'pointer',
            background:'transparent',border:'1px solid #2A2F3E',color:'#555C70'}}>✕</button>
        </div>
      )}

      {/* History */}
      {showHist&&(
        <div style={{borderTop:'1px solid #1E2330',maxHeight:220,overflowY:'auto'}}>
          {drawings.length===0?(
            <div style={{padding:'16px',textAlign:'center',color:'#3D4254',fontSize:12}}>Aucune sauvegarde pour {symbol} · {tf.label}</div>
          ):drawings.map(d=>(
            <div key={d.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 14px',borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
              <div style={{width:3,height:28,borderRadius:2,background:d.color,flexShrink:0}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:11,fontWeight:600,color:'#F0F3FF'}}>
                  {d.type==='hline'?`Ligne H. @ ${fmtP(d.data?.price||0)}`:
                   d.type==='fibo' ?`Fibo ${fmtP(d.data?.p1?.price||0)} → ${fmtP(d.data?.p2?.price||0)}`:
                   d.type==='trend'?`Tendance`:d.type==='rect'?`Zone`:d.label?`Note: "${d.label}"`:d.type}
                </div>
                <div style={{fontSize:9,color:'#3D4254'}}>{new Date(d.ts).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
              </div>
              <button onClick={async()=>{await dbDelete(d.id);setDrawings(p=>p.filter(x=>x.id!==d.id));toast$('Supprimé')}}
                style={{background:'rgba(255,59,48,0.1)',border:'1px solid rgba(255,59,48,0.2)',borderRadius:6,color:'#FF3B30',cursor:'pointer',fontSize:10,padding:'3px 8px'}}>✕</button>
            </div>
          ))}
        </div>
      )}

      {toast&&(
        <div style={{position:'absolute',bottom:16,left:'50%',transform:'translateX(-50%)',
          background:'#1C2130',border:'1px solid #2A2F3E',borderRadius:10,padding:'8px 16px',
          fontSize:12,color:'#F0F3FF',zIndex:10,whiteSpace:'nowrap',pointerEvents:'none',
          boxShadow:'0 4px 16px rgba(0,0,0,0.5)'}}>
          {toast}
        </div>
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
