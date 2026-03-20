// OscillatorCharts.tsx — v2
// WaveTrend + VMC Oscillator
// Fix: smart fetch (Futures → Spot fallback) + preset recalc sans refetch + symbol reactivity

import { useState, useEffect, useRef, useCallback } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'
import { signalService } from '@/services/notifications/SignalNotificationService'

const fbFn = getFunctions(app, 'europe-west1')

// ── Live refresh interval per timeframe (ms) ──────────────────────────────
const TF_REFRESH_MS: Record<string, number> = {
  '5m':300000,'15m':900000,'30m':1800000,'1h':3600000,
  '2h':7200000,'4h':14400000,'12h':43200000,'1d':86400000,'1w':604800000,
}

// ── Types ──────────────────────────────────────────────────────────────────
interface Candle { o: number; h: number; l: number; c: number; v: number; t: number }

const TF_OPTIONS = [
  { label:'5m',  interval:'5m',  limit:200 },
  { label:'15m', interval:'15m', limit:200 },
  { label:'30m', interval:'30m', limit:200 },
  { label:'1H',  interval:'1h',  limit:200 },
  { label:'2H',  interval:'2h',  limit:200 },
  { label:'4H',  interval:'4h',  limit:200 },
  { label:'12H', interval:'12h', limit:200 },
  { label:'1J',  interval:'1d',  limit:200 },
  { label:'1S',  interval:'1w',  limit:200 },
]

// ── Smart fetch — Futures → Spot → Cloud Functions (TwelveData/Finnhub) ──
function isCryptoSymbol(symbol: string) {
  return /USDT$|BUSD$|BTC$|ETH$|BNB$/i.test(symbol)
}

async function fetchCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  const sym = symbol.toUpperCase()

  // ── 1. Crypto → Binance Futures puis Spot ─────────────────────────────
  if (isCryptoSymbol(sym)) {
    const binanceSymbols = [sym, sym.replace(/USDT$/i,'')+'USDT']
    for (const bSym of binanceSymbols) {
      for (const base of ['https://fapi.binance.com/fapi/v1', 'https://api.binance.com/api/v3']) {
        try {
          const r = await fetch(`${base}/klines?symbol=${bSym}&interval=${interval}&limit=${limit}`)
          if (r.ok) {
            const data = await r.json() as unknown[][]
            if (Array.isArray(data) && data.length > 10) {
              return data.map(a => ({
                t: Number(a[0]), o: parseFloat(a[1] as string), h: parseFloat(a[2] as string),
                l: parseFloat(a[3] as string), c: parseFloat(a[4] as string), v: parseFloat(a[5] as string),
              }))
            }
          }
        } catch {/**/}
      }
    }
    throw new Error(`Crypto ${sym} introuvable sur Binance`)
  }

  // ── 2. Non-crypto → fetchYahooCandles (Cloud Function, gratuit, sans limite) ─
  const TF_TO_YH_INTERVAL: Record<string,string> = {
    '5m':'5m','15m':'15m','30m':'30m','1h':'1h','2h':'1h','4h':'1h','12h':'1d','1d':'1d','1w':'1wk'
  }
  const TF_TO_YH_RANGE: Record<string,string> = {
    '5m':'5d','15m':'5d','30m':'1mo','1h':'1mo','2h':'3mo','4h':'3mo','12h':'1y','1d':'1y','1w':'2y'
  }
  const yhInterval = TF_TO_YH_INTERVAL[interval] || '1d'
  const yhRange    = TF_TO_YH_RANGE[interval]    || '1y'

  // Yahoo Finance via Cloud Function — essaie le symbole direct + variantes européennes
  const fn = httpsCallable<Record<string,unknown>, {s:string; candles:{t:number;o:number;h:number;l:number;c:number;v:number}[]}>(fbFn, 'fetchYahooCandles')
  const res = await fn({ symbol: sym, interval: yhInterval, range: yhRange })
  if (res.data.s === 'ok' && res.data.candles && res.data.candles.length > 5) {
    return res.data.candles.map(c => ({
      t: c.t * 1000, // Yahoo renvoie des secondes, OscillatorCharts utilise des ms
      o: c.o, h: c.h, l: c.l, c: c.c, v: c.v,
    }))
  }

  throw new Error(`${sym} introuvable. Essayez: AAPL \u00b7 TSLA \u00b7 EURUSD=X \u00b7 GC=F (Or) \u00b7 ^FCHI (CAC40) \u00b7 MC.PA`)
}

// ── Math helpers ───────────────────────────────────────────────────────────
function emaArr(vals: number[], length: number): number[] {
  if (!vals.length || length <= 0) return vals.map(() => 0)
  const k = 2 / (length + 1)
  const out = [vals[0]]
  for (let i = 1; i < vals.length; i++) out.push(vals[i] * k + out[i-1] * (1-k))
  return out
}
function rollingSum(arr: number[], length: number): number[] {
  const out = new Array(arr.length).fill(0); let s = 0
  for (let i = 0; i < arr.length; i++) { s += arr[i]; if (i >= length) s -= arr[i-length]; out[i] = s }
  return out
}

// ── WaveTrend (exact WTCalculator.swift) ──────────────────────────────────
interface WTResult { wt1: number[]; wt2: number[]; signals: (null|'bull'|'bear'|'smartBull'|'smartBear')[] }

function calcWaveTrend(candles: Candle[], n1=10, n2=21, obLevel=53, osLevel=-53): WTResult {
  if (candles.length < n1+n2) return { wt1:[], wt2:[], signals:[] }
  const ap = candles.map(c => (c.h+c.l+c.c)/3)
  const esa:number[]=[], d:number[]=[], ci:number[]=[], tci:number[]=[]
  const a1=2/(n1+1), a2=2/(n2+1)
  for (let i=0; i<ap.length; i++) {
    esa.push(i===0 ? ap[i] : a1*ap[i]+(1-a1)*esa[i-1])
    const absD=Math.abs(ap[i]-esa[i])
    d.push(i===0 ? absD : a1*absD+(1-a1)*d[i-1])
    ci.push(d[i]!==0 ? (ap[i]-esa[i])/(0.015*d[i]) : 0)
    tci.push(i===0 ? ci[i] : a2*ci[i]+(1-a2)*tci[i-1])
  }
  const wt1=[...tci]
  const wt2=wt1.map((_,i)=>i<3?wt1[i]:(wt1[i]+wt1[i-1]+wt1[i-2]+wt1[i-3])/4)
  const signals:WTResult['signals']=new Array(wt1.length).fill(null)
  for (let i=1; i<wt1.length; i++) {
    const crossUp=wt1[i-1]<=wt2[i-1]&&wt1[i]>wt2[i]
    const crossDn=wt1[i-1]>=wt2[i-1]&&wt1[i]<wt2[i]
    if (crossUp&&wt1[i]<=osLevel) signals[i]='smartBull'
    else if (crossUp) signals[i]='bull'
    else if (crossDn&&wt1[i]>=obLevel) signals[i]='smartBear'
    else if (crossDn) signals[i]='bear'
  }
  return { wt1, wt2, signals }
}

// ── VMC Oscillator (exact VMCIndicator.swift) ──────────────────────────────
interface VMCResult {
  sig:number[]; sigSignal:number[]; momentum:number[]
  bullConfirm:boolean; bearConfirm:boolean
  ribbonBull:boolean; ribbonBear:boolean; compression:boolean; status:string
}

function calcVMCOscillator(candles: Candle[], preset:'scalping'|'swing'|'position'='swing'): VMCResult {
  const EMPTY:VMCResult={sig:[],sigSignal:[],momentum:[],bullConfirm:false,bearConfirm:false,ribbonBull:false,ribbonBear:false,compression:false,status:'NEUTRAL'}
  if (candles.length<60) return EMPTY
  const close=candles.map(c=>c.c), high=candles.map(c=>c.h), low=candles.map(c=>c.l), vol=candles.map(c=>c.v)
  const thresholds=preset==='scalping'?[40,-30]:preset==='swing'?[35,-25]:[30,-20]
  const hlc3=candles.map(c=>(c.h+c.l+c.c)/3)
  const rsiLen=14
  const gains=hlc3.map((v,i)=>i===0?0:Math.max(v-hlc3[i-1],0))
  const losses=hlc3.map((v,i)=>i===0?0:Math.max(hlc3[i-1]-v,0))
  const agArr=emaArr(gains,rsiLen),alArr=emaArr(losses,rsiLen)
  const rsi=agArr.map((g,i)=>alArr[i]===0?100:100-100/(1+g/alArr[i]))
  const n=candles.length
  const tp=candles.map(c=>(c.h+c.l+c.c)/3)
  const pmf=new Array(n).fill(0),nmf=new Array(n).fill(0)
  for(let i=1;i<n;i++){const raw=tp[i]*vol[i];if(tp[i]>tp[i-1])pmf[i]=raw;else if(tp[i]<tp[i-1])nmf[i]=raw}
  const sPMF=rollingSum(pmf,7),sNMF=rollingSum(nmf,7)
  const mfi=sPMF.map((p,i)=>{const d=p+sNMF[i];return d===0?50:p/d*100})
  const computeStoch=(src:number[],len:number)=>{
    const out=src.map((v,i)=>{const win=src.slice(Math.max(0,i-len+1),i+1);const mn=Math.min(...win),mx=Math.max(...win);return mx-mn===0?50:(v-mn)/(mx-mn)*100})
    return emaArr(out,2)
  }
  const stoch=computeStoch(rsi,rsiLen)
  const mfiW=0.40,stochW=0.40,denom=1+mfiW+stochW
  const core=rsi.map((r,i)=>(r+mfiW*mfi[i]+stochW*stoch[i])/denom)
  const emaFast=emaArr(core,2),emaSlow=emaArr(core,Math.round(2*1.75))
  const transform=(arr:number[])=>arr.map(v=>{const tmp=(v/100-0.5)*2;return 100*(tmp>=0?1:-1)*Math.pow(Math.abs(tmp),0.75)})
  const sig=transform(emaFast),sigSignal=transform(emaSlow)
  const momentum=sig.map((s,i)=>s-sigSignal[i])
  const periods=[20,25,30,35,40,45,50,55]
  const emas=periods.map(p=>emaArr(close,p))
  const last=close.length-1
  const ribbonBull=periods.slice(0,-1).every((_,i)=>emas[i][last]>emas[i+1][last])
  const ribbonBear=periods.slice(0,-1).every((_,i)=>emas[i][last]<emas[i+1][last])
  const crossUp=last>=1&&sig[last-1]<=sigSignal[last-1]&&sig[last]>sigSignal[last]
  const crossDn=last>=1&&sig[last-1]>=sigSignal[last-1]&&sig[last]<sigSignal[last]
  const bullConfirm=crossUp&&sig[last]<thresholds[1]
  const bearConfirm=crossDn&&sig[last]>thresholds[0]
  const spread=Math.abs(emas[0][last]-emas[7][last])/Math.max(close[last],1e-9)*100
  const spreadPrev=last>=1?Math.abs(emas[0][last-1]-emas[7][last-1])/Math.max(close[last-1],1e-9)*100:spread+1
  const compression=spread<=0.30&&spread<spreadPrev&&sig[last]<=thresholds[1]
  let status='NEUTRAL'
  if(bullConfirm&&(ribbonBull||compression)&&momentum[last]>=0)status='BUY'
  else if(bearConfirm&&(ribbonBear||compression)&&momentum[last]<=0)status='SELL'
  else if(sig[last]>thresholds[0])status='OVERBOUGHT'
  else if(sig[last]<thresholds[1])status='OVERSOLD'
  return{sig,sigSignal,momentum,bullConfirm,bearConfirm,ribbonBull,ribbonBear,compression,status}
}

// ── Canvas helpers ─────────────────────────────────────────────────────────
function useCanvas(draw:(ctx:CanvasRenderingContext2D,W:number,H:number)=>void, deps:unknown[]) {
  const ref=useRef<HTMLCanvasElement>(null)
  useEffect(()=>{
    const c=ref.current;if(!c)return
    const dpr=window.devicePixelRatio||1
    const cssW=c.offsetWidth||800,cssH=c.offsetHeight||180
    c.width=cssW*dpr;c.height=cssH*dpr
    c.style.width=cssW+'px';c.style.height=cssH+'px'
    const ctx=c.getContext('2d')!
    ctx.scale(dpr,dpr)
    ctx.clearRect(0,0,cssW,cssH)
    draw(ctx,cssW,cssH)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },deps)
  return ref
}

function drawOscillator(ctx:CanvasRenderingContext2D,W:number,H:number,main:number[],signal:number[],histogram:number[],obLevel:number,osLevel:number,mainColor:string,signalColor:string,histBullColor:string,histBearColor:string,dots?:{i:number;type:string}[]) {
  ctx.fillStyle='#080C14';ctx.fillRect(0,0,W,H)
  const tail=Math.min(main.length,150)
  const m=main.slice(-tail),s=signal.slice(-tail),h=histogram.slice(-tail)
  if(m.length<2)return
  const allVals=[...m,...s,...h,obLevel,osLevel,0]
  const minV=Math.min(...allVals)*1.1,maxV=Math.max(...allVals)*1.1,range=maxV-minV||1
  const yp=(v:number)=>H-((v-minV)/range)*H
  const xp=(i:number)=>(i/(m.length-1))*W
  ctx.fillStyle='rgba(255,59,48,0.06)';ctx.fillRect(0,yp(maxV),W,yp(obLevel)-yp(maxV))
  ctx.fillStyle='rgba(34,199,89,0.06)';ctx.fillRect(0,yp(osLevel),W,yp(minV)-yp(osLevel))
  ctx.setLineDash([3,3]);ctx.strokeStyle='#2A2F3E';ctx.lineWidth=0.8
  ;[0,obLevel,osLevel].forEach(l=>{ctx.beginPath();ctx.moveTo(0,yp(l));ctx.lineTo(W,yp(l));ctx.stroke()})
  ctx.setLineDash([])
  const barW=W/m.length
  h.forEach((v,i)=>{const x=xp(i),y=v>=0?yp(v):yp(0),bH=Math.abs(yp(v)-yp(0));ctx.fillStyle=v>=0?histBullColor:histBearColor;ctx.fillRect(x-barW/2+0.5,y,barW-1,bH||1)})
  ctx.beginPath();ctx.strokeStyle=signalColor;ctx.lineWidth=1.2;s.forEach((v,i)=>i===0?ctx.moveTo(xp(i),yp(v)):ctx.lineTo(xp(i),yp(v)));ctx.stroke()
  ctx.beginPath();ctx.strokeStyle=mainColor;ctx.lineWidth=2;m.forEach((v,i)=>i===0?ctx.moveTo(xp(i),yp(v)):ctx.lineTo(xp(i),yp(v)));ctx.stroke()
  if(dots){const offset=main.length-tail;dots.filter(d=>d.i>=offset).forEach(d=>{const i=d.i-offset;const cx=xp(i),cy=yp(m[i]);const color=d.type.includes('bull')||d.type==='smartBull'?'#00E5FF':'#FF3B30';const isSmart=d.type.includes('smart');ctx.beginPath();ctx.arc(cx,cy,isSmart?5:3,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();if(isSmart){ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.stroke()}})}
}

// ── WaveTrend Chart ────────────────────────────────────────────────────────
export function WaveTrendChart({ symbol }: { symbol: string }) {
  const [tf, setTf]               = useState(TF_OPTIONS[3])
  const [candles, setCandles]     = useState<Candle[]>([])
  const [result, setResult]       = useState<WTResult|null>(null)
  const [status,   setStatus]     = useState<'idle'|'loading'|'error'>('idle')
  const [errorMsg, setErrorMsg]   = useState('')
  const [nextRefresh, setNextRefresh] = useState(0)
  const obLevel=53, osLevel=-53

  // Fetch candles — réagit à symbol ET tf
  const loadCandles = useCallback(async () => {
    setStatus('loading'); setErrorMsg('')
    try {
      const c = await fetchCandles(symbol, tf.interval, tf.limit)
      setCandles(c)
      setStatus('idle')
    } catch(e) { setErrorMsg((e as Error).message); setStatus('error') }
  }, [symbol, tf])

  useEffect(() => { loadCandles() }, [loadCandles])

  // Countdown to next refresh
  useEffect(() => {
    const ms = TF_REFRESH_MS[tf.interval] || 3600000
    setNextRefresh(ms / 1000)
    const t = setInterval(() => setNextRefresh(x => x <= 1 ? ms / 1000 : x - 1), 1000)
    return () => clearInterval(t)
  }, [tf])

  // Live refresh — interval = durée d'une bougie
  useEffect(() => {
    const ms = TF_REFRESH_MS[tf.interval] || 3600000
    const t = setInterval(() => loadCandles(), ms)
    return () => clearInterval(t)
  }, [tf, loadCandles])

  // Compute + signal detection
  useEffect(() => {
    if (candles.length < 20) return
    const r = calcWaveTrend(candles, 10, 21, obLevel, osLevel)
    setResult(r)
    // Check signals after each refresh
    if (r.wt1.length > 1) signalService.checkWaveTrend(symbol, tf.label, r.wt1, r.wt2, obLevel, osLevel)
  }, [candles, symbol, tf.label])

  const dots = result ? result.signals.flatMap((s,i)=>s?[{i,type:s}]:[]) : []
  const canvasRef = useCanvas((ctx,W,H)=>{
    if(!result||result.wt1.length<2)return
    drawOscillator(ctx,W,H,result.wt1,result.wt2,result.wt1.map((v,i)=>v-result.wt2[i]),obLevel,osLevel,'#37D7FF','#FF9500','rgba(34,199,89,0.5)','rgba(255,59,48,0.5)',dots)
  },[result])

  const wt1Last = result?.wt1[result.wt1.length-1]??0
  const wt2Last = result?.wt2[result.wt2.length-1]??0
  const badge = !result?null:wt1Last>obLevel?{label:'Overbought',color:'#FF3B30'}:wt1Last<osLevel?{label:'Oversold',color:'#22C759'}:result.signals[result.signals.length-1]==='smartBull'?{label:'Smart Bullish',color:'#00E5FF'}:result.signals[result.signals.length-1]==='bull'?{label:'Bullish Reversal',color:'#22C759'}:result.signals[result.signals.length-1]==='smartBear'?{label:'Smart Bearish',color:'#FF3B30'}:result.signals[result.signals.length-1]==='bear'?{label:'Bearish Reversal',color:'#FF3B30'}:{label:'Neutral',color:'#8F94A3'}

  return (
    <div style={{background:'#161B22',border:'1px solid #1E2330',borderRadius:16,overflow:'hidden'}}>
      <div style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <div style={{width:32,height:32,borderRadius:9,background:'linear-gradient(135deg,#FF9500,#FF9500aa)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>〜</div>
        <div>
          <div style={{fontSize:13,fontWeight:700,color:'#F0F3FF'}}>WaveTrend Oscillator</div>
          <div style={{fontSize:10,color:'#F59714aa'}}>{symbol}</div>
        </div>
        {/* Live badge */}
        <div style={{display:'flex',alignItems:'center',gap:5,padding:'2px 8px',background:'rgba(34,199,89,0.1)',border:'1px solid rgba(34,199,89,0.25)',borderRadius:6}}>
          <div style={{width:5,height:5,borderRadius:'50%',background:'#22C759',animation:'pulse 1.5s ease-in-out infinite'}}/>
          <span style={{fontSize:9,fontWeight:700,color:'#22C759',fontFamily:'monospace'}}>LIVE</span>
          <span style={{fontSize:9,color:'#555C70',fontFamily:'monospace'}}>{Math.floor(nextRefresh/60)}:{String(nextRefresh%60).padStart(2,'0')}</span>
        </div>
        {badge&&<div style={{fontSize:10,fontWeight:700,color:badge.color,background:`${badge.color}20`,padding:'2px 10px',borderRadius:20,border:`1px solid ${badge.color}50`}}>{badge.label}</div>}
        <div style={{marginLeft:'auto',display:'flex',gap:10,alignItems:'center'}}>
          {result&&<div style={{display:'flex',gap:10,fontSize:11,fontFamily:'monospace'}}><span style={{color:'#37D7FF'}}>WT1: {wt1Last.toFixed(1)}</span><span style={{color:'#FF9500'}}>WT2: {wt2Last.toFixed(1)}</span></div>}
          <button onClick={loadCandles} style={{background:'#1C2130',border:'1px solid #2A2F3E',borderRadius:7,padding:'4px 9px',cursor:'pointer',fontSize:11,color:'#8F94A3'}}>↻</button>
        </div>
      </div>
      <div style={{display:'flex',gap:4,padding:'0 16px 10px',overflowX:'auto',scrollbarWidth:'none'}}>
        {TF_OPTIONS.map(t=><button key={t.label} onClick={()=>setTf(t)} style={{padding:'3px 10px',borderRadius:20,fontSize:10,fontWeight:500,cursor:'pointer',border:`1px solid ${t.label===tf.label?'#FF9500':'#2A2F3E'}`,background:t.label===tf.label?'rgba(255,149,0,0.15)':'#1C2130',color:t.label===tf.label?'#FF9500':'#555C70',whiteSpace:'nowrap'}}>{t.label}</button>)}
      </div>
      <div style={{padding:'0 16px 16px',position:'relative'}}>
        {status==='loading'&&<div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(8,12,20,0.85)',borderRadius:8,zIndex:2,gap:8,flexDirection:'column'}}>
          <div style={{width:18,height:18,border:'2px solid #2A2F3E',borderTopColor:'#FF9500',borderRadius:'50%',animation:'spin 0.7s linear infinite'}}/>
          <span style={{fontSize:11,color:'#555C70'}}>Chargement {symbol}...</span>
        </div>}
        {status==='error'&&<div style={{padding:'20px 16px',display:'flex',flexDirection:'column',alignItems:'center',gap:8,textAlign:'center'}}>
          <span style={{fontSize:22}}>📡</span>
          <span style={{fontSize:11,fontWeight:600,color:'#FF3B30'}}>{errorMsg}</span>
          <span style={{fontSize:10,color:'#555C70',maxWidth:320}}>
            {isCryptoSymbol(symbol)
              ? "Ce symbole n'est pas disponible sur Binance Futures ni Spot."
              : 'Essayez: AAPL · TSLA · EURUSD=X · GC=F (Or) · ^FCHI (CAC40) · MC.PA (LVMH)'}
          </span>
        </div>}
        <canvas ref={canvasRef} width={800} height={180} style={{width:'100%',height:180,display:'block',borderRadius:8}}/>
        <div style={{display:'flex',gap:12,marginTop:8,flexWrap:'wrap'}}>
          {[{color:'#37D7FF',label:'WT1'},{color:'#FF9500',label:'WT2'},{color:'#22C759',label:'Momentum +'},{color:'#FF3B30',label:'Momentum −'},{color:'#00E5FF',label:'● Smart'}].map(({color,label})=>(
            <div key={label} style={{display:'flex',alignItems:'center',gap:4}}><div style={{width:8,height:8,borderRadius:2,background:color}}/><span style={{fontSize:9,color:'#555C70'}}>{label}</span></div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── VMC Oscillator Chart ───────────────────────────────────────────────────
export function VMCOscillatorChart({ symbol }: { symbol: string }) {
  const [tf, setTf]             = useState(TF_OPTIONS[3])
  const [preset, setPreset]     = useState<'scalping'|'swing'|'position'>('swing')
  const [candles, setCandles]   = useState<Candle[]>([])
  const [result, setResult]     = useState<VMCResult|null>(null)
  const [status, setStatus]     = useState<'idle'|'loading'|'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const obLevel=35, osLevel=-25

  // Fetch — réagit uniquement à symbol et tf (PAS preset)
  const loadCandles = useCallback(async () => {
    setStatus('loading'); setErrorMsg('')
    try {
      const c = await fetchCandles(symbol, tf.interval, tf.limit)
      setCandles(c)
      setStatus('idle')
    } catch(e) { setErrorMsg((e as Error).message); setStatus('error') }
  }, [symbol, tf])  // ← preset absent intentionnellement ici

  useEffect(() => { loadCandles() }, [loadCandles])

  // Live refresh
  useEffect(() => {
    const ms = TF_REFRESH_MS[tf.interval] || 3600000
    const t = setInterval(() => loadCandles(), ms)
    return () => clearInterval(t)
  }, [tf, loadCandles])

  // VMC countdown
  const [nextRefreshVMC, setNextRefreshVMC] = useState(0)
  useEffect(() => {
    const ms = TF_REFRESH_MS[tf.interval] || 3600000
    setNextRefreshVMC(ms/1000)
    const t = setInterval(() => setNextRefreshVMC(x => x<=1?ms/1000:x-1), 1000)
    return () => clearInterval(t)
  }, [tf])

  // Recalcul — réagit aux candles ET au preset (sans refetch)
  useEffect(() => {
    if (candles.length < 60) return
    const r = calcVMCOscillator(candles, preset)
    setResult(r)
    const sig = r.sig[r.sig.length-1]??0
    const mom = r.momentum[r.momentum.length-1]??0
    signalService.checkVMC(symbol, tf.label, r.status, sig, mom, r.compression)
  }, [candles, preset, symbol, tf.label])  // ← preset ici = recalcul immédiat sans API call

  const lastSig=result?.sig[result.sig.length-1]??0
  const lastMom=result?.momentum[result.momentum.length-1]??0
  const statusColor=result?.status==='BUY'?'#22C759':result?.status==='SELL'?'#FF3B30':result?.status==='OVERBOUGHT'?'#FF3B30':result?.status==='OVERSOLD'?'#22C759':'#8F94A3'

  const canvasRef = useCanvas((ctx,W,H)=>{
    if(!result||result.sig.length<2)return
    drawOscillator(ctx,W,H,result.sig,result.sigSignal,result.momentum,obLevel,osLevel,'#37D7FF','#FF9500','rgba(34,199,89,0.55)','rgba(255,59,48,0.55)')
  },[result])

  return (
    <div style={{background:'#161B22',border:'1px solid #1E2330',borderRadius:16,overflow:'hidden'}}>
      <div style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <div style={{width:32,height:32,borderRadius:9,background:'linear-gradient(135deg,#FF9500,#FF9500aa)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,color:'white'}}>V</div>
        <div>
          <div style={{fontSize:13,fontWeight:700,color:'#F0F3FF'}}>VMC Oscillator</div>
          <div style={{fontSize:10,color:'#F59714aa'}}>{symbol}</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:5,padding:'2px 8px',background:'rgba(34,199,89,0.1)',border:'1px solid rgba(34,199,89,0.25)',borderRadius:6}}>
          <div style={{width:5,height:5,borderRadius:'50%',background:'#22C759',animation:'pulse 1.5s ease-in-out infinite'}}/>
          <span style={{fontSize:9,fontWeight:700,color:'#22C759',fontFamily:'monospace'}}>LIVE</span>
          <span style={{fontSize:9,color:'#555C70',fontFamily:'monospace'}}>{Math.floor(nextRefreshVMC/60)}:{String(nextRefreshVMC%60).padStart(2,'0')}</span>
        </div>
        {result&&<div style={{fontSize:10,fontWeight:700,color:statusColor,background:`${statusColor}20`,padding:'2px 10px',borderRadius:20,border:`1px solid ${statusColor}50`}}>{result.status}</div>}
        {result?.ribbonBull&&<div style={{fontSize:9,fontWeight:700,color:'#22C759',background:'rgba(34,199,89,0.12)',padding:'1px 7px',borderRadius:10,border:'1px solid rgba(34,199,89,0.3)'}}>BULL</div>}
        {result?.ribbonBear&&<div style={{fontSize:9,fontWeight:700,color:'#FF3B30',background:'rgba(255,59,48,0.12)',padding:'1px 7px',borderRadius:10,border:'1px solid rgba(255,59,48,0.3)'}}>BEAR</div>}
        {result?.compression&&<div style={{fontSize:9,fontWeight:700,color:'#FF9500',background:'rgba(255,149,0,0.12)',padding:'1px 7px',borderRadius:10,border:'1px solid rgba(255,149,0,0.3)'}}>⟳ COMP</div>}
        <div style={{marginLeft:'auto',display:'flex',gap:10,alignItems:'center'}}>
          {result&&<div style={{display:'flex',gap:10,fontSize:11,fontFamily:'monospace'}}><span style={{color:'#37D7FF'}}>sig: {lastSig.toFixed(1)}</span><span style={{color:lastMom>=0?'#22C759':'#FF3B30'}}>mom: {lastMom>=0?'+':''}{lastMom.toFixed(1)}</span></div>}
          <button onClick={loadCandles} style={{background:'#1C2130',border:'1px solid #2A2F3E',borderRadius:7,padding:'4px 9px',cursor:'pointer',fontSize:11,color:'#8F94A3'}}>↻</button>
        </div>
      </div>
      {/* Preset + TF */}
      <div style={{display:'flex',gap:8,padding:'0 16px 8px',flexWrap:'wrap',alignItems:'center'}}>
        <div style={{display:'flex',background:'#1C2130',borderRadius:8,padding:2,gap:1}}>
          {(['scalping','swing','position'] as const).map(p=>(
            <button key={p} onClick={()=>setPreset(p)} style={{padding:'3px 10px',borderRadius:6,fontSize:10,fontWeight:500,cursor:'pointer',border:'none',background:preset===p?'#FF9500':'transparent',color:preset===p?'#0D1117':'#555C70',transition:'all 0.15s'}}>
              {p}
            </button>
          ))}
        </div>
        <div style={{display:'flex',gap:3,overflowX:'auto',scrollbarWidth:'none'}}>
          {TF_OPTIONS.map(t=><button key={t.label} onClick={()=>setTf(t)} style={{padding:'3px 9px',borderRadius:20,fontSize:10,fontWeight:500,cursor:'pointer',border:`1px solid ${t.label===tf.label?'#FF9500':'#2A2F3E'}`,background:t.label===tf.label?'rgba(255,149,0,0.15)':'#1C2130',color:t.label===tf.label?'#FF9500':'#555C70',whiteSpace:'nowrap'}}>{t.label}</button>)}
        </div>
      </div>
      <div style={{padding:'0 16px 16px',position:'relative'}}>
        {status==='loading'&&<div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'rgba(8,12,20,0.85)',borderRadius:8,zIndex:2,gap:8}}>
          <div style={{width:18,height:18,border:'2px solid #2A2F3E',borderTopColor:'#FF9500',borderRadius:'50%',animation:'spin 0.7s linear infinite'}}/>
          <span style={{fontSize:11,color:'#555C70'}}>Chargement {symbol}...</span>
        </div>}
        {status==='error'&&<div style={{padding:'20px 16px',display:'flex',flexDirection:'column',alignItems:'center',gap:8,textAlign:'center'}}>
          <span style={{fontSize:22}}>📡</span>
          <span style={{fontSize:11,fontWeight:600,color:'#FF3B30'}}>{errorMsg}</span>
          <span style={{fontSize:10,color:'#555C70',maxWidth:320}}>
            {isCryptoSymbol(symbol)
              ? "Ce symbole n'est pas disponible sur Binance Futures ni Spot."
              : 'Essayez: AAPL · TSLA · EURUSD=X · GC=F (Or) · ^FCHI (CAC40) · MC.PA (LVMH)'}
          </span>
        </div>}
        <canvas ref={canvasRef} width={800} height={180} style={{width:'100%',height:180,display:'block',borderRadius:8}}/>
        <div style={{display:'flex',gap:12,marginTop:8,flexWrap:'wrap'}}>
          {[{color:'#37D7FF',label:'VMC Sig'},{color:'#FF9500',label:'Signal'},{color:'#22C759',label:'Mom +'},{color:'#FF3B30',label:'Mom −'},{color:'#FF9500',label:`OB:${obLevel}`},{color:'#22C759',label:`OS:${osLevel}`}].map(({color,label})=>(
            <div key={label} style={{display:'flex',alignItems:'center',gap:4}}><div style={{width:8,height:8,borderRadius:2,background:color}}/><span style={{fontSize:9,color:'#555C70'}}>{label}</span></div>
          ))}
        </div>
      </div>
    </div>
  )
}
