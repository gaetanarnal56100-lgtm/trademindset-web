// OscillatorCharts.tsx — v3
// WaveTrend + VMC Oscillator — Interactive crosshair + tooltip (TradingView-style)

import { useState, useEffect, useRef, useCallback } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'
import { signalService } from '@/services/notifications/SignalNotificationService'

const fbFn = getFunctions(app, 'europe-west1')

const TF_REFRESH_MS: Record<string, number> = {
  '5m':300000,'15m':900000,'30m':1800000,'1h':3600000,
  '2h':7200000,'4h':14400000,'12h':43200000,'1d':86400000,'1w':604800000,
}

interface Candle { o: number; h: number; l: number; c: number; v: number; t: number }

const TF_OPTIONS = [
  { label:'5m',  interval:'5m',  limit:500 },
  { label:'15m', interval:'15m', limit:500 },
  { label:'30m', interval:'30m', limit:500 },
  { label:'1H',  interval:'1h',  limit:500 },
  { label:'2H',  interval:'2h',  limit:500 },
  { label:'4H',  interval:'4h',  limit:500 },
  { label:'12H', interval:'12h', limit:500 },
  { label:'1J',  interval:'1d',  limit:500 },
  { label:'1S',  interval:'1w',  limit:500 },
]

function isCryptoSymbol(symbol: string) {
  return /USDT$|BUSD$|BTC$|ETH$|BNB$/i.test(symbol)
}

export async function fetchCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  const sym = symbol.toUpperCase()
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
  const TF_TO_YH_INTERVAL: Record<string,string> = {'5m':'5m','15m':'15m','30m':'30m','1h':'1h','2h':'1h','4h':'1h','12h':'1d','1d':'1d','1w':'1wk'}
  const TF_TO_YH_RANGE: Record<string,string> = {'5m':'5d','15m':'5d','30m':'1mo','1h':'1mo','2h':'3mo','4h':'3mo','12h':'1y','1d':'1y','1w':'2y'}
  const yhInterval = TF_TO_YH_INTERVAL[interval] || '1d'
  const yhRange    = TF_TO_YH_RANGE[interval]    || '1y'
  const fn = httpsCallable<Record<string,unknown>, {s:string; candles:{t:number;o:number;h:number;l:number;c:number;v:number}[]}>(fbFn, 'fetchYahooCandles')
  const res = await fn({ symbol: sym, interval: yhInterval, range: yhRange })
  if (res.data.s === 'ok' && res.data.candles && res.data.candles.length > 5) {
    return res.data.candles.map(c => ({ t: c.t * 1000, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }))
  }
  throw new Error(`${sym} introuvable. Essayez: AAPL · TSLA · EURUSD=X · GC=F (Or) · ^FCHI (CAC40) · MC.PA`)
}

// ── Math helpers ───────────────────────────────────────────────────────────
function emaArr(vals: number[], length: number): number[] {
  if (!vals.length || length <= 0) return vals.map(() => 0)
  const k = 2 / (length + 1); const out = [vals[0]]
  for (let i = 1; i < vals.length; i++) out.push(vals[i] * k + out[i-1] * (1-k))
  return out
}
function rollingSum(arr: number[], length: number): number[] {
  const out = new Array(arr.length).fill(0); let s = 0
  for (let i = 0; i < arr.length; i++) { s += arr[i]; if (i >= length) s -= arr[i-length]; out[i] = s }
  return out
}

// ── WaveTrend ──────────────────────────────────────────────────────────────
interface WTResult { wt1: number[]; wt2: number[]; signals: (null|'bull'|'bear'|'smartBull'|'smartBear')[] }
export function calcWaveTrend(candles: Candle[], n1=10, n2=21, obLevel=53, osLevel=-53): WTResult {
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
    const crossUp=wt1[i-1]<=wt2[i-1]&&wt1[i]>wt2[i], crossDn=wt1[i-1]>=wt2[i-1]&&wt1[i]<wt2[i]
    if (crossUp&&wt1[i]<=osLevel) signals[i]='smartBull'
    else if (crossUp) signals[i]='bull'
    else if (crossDn&&wt1[i]>=obLevel) signals[i]='smartBear'
    else if (crossDn) signals[i]='bear'
  }
  return { wt1, wt2, signals }
}

// ── VMC Oscillator ─────────────────────────────────────────────────────────
interface VMCResult {
  sig:number[]; sigSignal:number[]; momentum:number[]; bullConfirm:boolean; bearConfirm:boolean
  ribbonBull:boolean; ribbonBear:boolean; compression:boolean; status:string; emas:number[][]
  vpi:number[]; vpiStrongBull:boolean; vpiStrongBear:boolean; vpiBreakout:boolean
  smartCompressionArr:boolean[]; smartCompressionActive:boolean; breakoutCandidate:boolean
  obLevel:number; osLevel:number; rrScore:number
}
export function calcVMCOscillator(candles: Candle[], preset:'scalping'|'swing'|'position'|'custom'='custom'): VMCResult {
  const EMPTY:VMCResult={sig:[],sigSignal:[],momentum:[],bullConfirm:false,bearConfirm:false,ribbonBull:false,ribbonBear:false,compression:false,status:'NEUTRAL',emas:[],vpi:[],vpiStrongBull:false,vpiStrongBear:false,vpiBreakout:false,smartCompressionArr:[],smartCompressionActive:false,breakoutCandidate:false,obLevel:40,osLevel:-40,rrScore:0}
  if (candles.length<60) return EMPTY
  const close=candles.map(c=>c.c), vol=candles.map(c=>c.v)
  // Thresholds: PERSONNALISÉ upT=40, loT=-40 (default from Pine Script)
  const [upT, loT]=preset==='scalping'?[40,-30]:preset==='swing'?[35,-25]:preset==='position'?[30,-20]:[40,-40]
  const hlc3=candles.map(c=>(c.h+c.l+c.c)/3)
  const n=candles.length

  // RSI(14) on hlc3
  const rsiLen=14
  const gains=hlc3.map((v,i)=>i===0?0:Math.max(v-hlc3[i-1],0))
  const losses=hlc3.map((v,i)=>i===0?0:Math.max(hlc3[i-1]-v,0))
  const agArr=emaArr(gains,rsiLen),alArr=emaArr(losses,rsiLen)
  const rsi=agArr.map((g,i)=>alArr[i]===0?100:100-100/(1+g/alArr[i]))

  // MFI(7) on hlc3 — hardcoded 7 in Pine Script core
  const tp=hlc3
  const pmf=new Array(n).fill(0),nmf=new Array(n).fill(0)
  for(let i=1;i<n;i++){const raw=tp[i]*vol[i];if(tp[i]>tp[i-1])pmf[i]=raw;else if(tp[i]<tp[i-1])nmf[i]=raw}
  const sPMF=rollingSum(pmf,7),sNMF=rollingSum(nmf,7)
  const mfi=sPMF.map((p,i)=>{const d=p+sNMF[i];return d===0?50:p/d*100})

  // Stoch of RSI
  const computeStoch=(src:number[],len:number)=>{
    const out=src.map((v,i)=>{const win=src.slice(Math.max(0,i-len+1),i+1);const mn=Math.min(...win),mx=Math.max(...win);return mx-mn===0?50:(v-mn)/(mx-mn)*100})
    return emaArr(out,2)
  }
  const stoch=computeStoch(rsi,rsiLen)

  // Core: (rsi + 0.4*mfi + 0.4*stoch) / 1.8
  const mfiW=0.40,stochW=0.40,denom=1+mfiW+stochW
  const core=rsi.map((r,i)=>(r+mfiW*mfi[i]+stochW*stoch[i])/denom)

  // Transform: same as Pine Script
  const transform=(arr:number[])=>arr.map(v=>{const tmp=(v/100-0.5)*2;return 100*(tmp>=0?1:-1)*Math.pow(Math.abs(tmp),0.75)})

  // smoothLen=10, sigSignal=round(10*1.75)=18  — matches Pine Script defaults
  const smoothLen=10, sigSmoothLen=Math.round(smoothLen*1.75)  // 18
  const sig=transform(emaArr(core,smoothLen))
  const sigSignal=transform(emaArr(core,sigSmoothLen))
  const momentum=sig.map((s,i)=>s-sigSignal[i])

  // EMA ribbon [20,25,30,35,40,45,50,55]
  const periods=[20,25,30,35,40,45,50,55]
  const emas=periods.map(p=>emaArr(close,p))
  const last=close.length-1
  const ribbonBull=periods.slice(0,-1).every((_,i)=>emas[i][last]>emas[i+1][last])
  const ribbonBear=periods.slice(0,-1).every((_,i)=>emas[i][last]<emas[i+1][last])

  // Cross signals
  const crossUp=last>=1&&sig[last-1]<=sigSignal[last-1]&&sig[last]>sigSignal[last]
  const crossDn=last>=1&&sig[last-1]>=sigSignal[last-1]&&sig[last]<sigSignal[last]
  const bullConfirm=crossUp&&sig[last]<loT
  const bearConfirm=crossDn&&sig[last]>upT

  // Spread/compression
  const spread=Math.abs(emas[0][last]-emas[7][last])/Math.max(close[last],1e-9)*100
  const spreadPrev=last>=1?Math.abs(emas[0][last-1]-emas[7][last-1])/Math.max(close[last-1],1e-9)*100:spread+1
  const compression=spread<=0.30&&spread<spreadPrev&&sig[last]<=loT

  // ── VPI (Période=14, Lissage=3, Seuil=30) ─────────────────────────────
  const vpiLen=14,vpiSmLen=3,vpiThreshold=30
  const bullVol=candles.map(c=>c.c>c.o?c.v:c.c===c.o?c.v/2:0)
  const bearVol=candles.map(c=>c.c<c.o?c.v:c.c===c.o?c.v/2:0)
  // SMA via rollingSum/vpiLen — same as Pine ta.sma
  const avgBull=rollingSum(bullVol,vpiLen).map(s=>s/vpiLen)
  const avgBear=rollingSum(bearVol,vpiLen).map(s=>s/vpiLen)
  const rawVPI=avgBull.map((b,i)=>{const tot=b+avgBear[i];return tot>0?((b-avgBear[i])/tot)*100:0})
  const vpi=emaArr(rawVPI,vpiSmLen)
  const vpiLast=vpi[last]??0
  const vpiStrongBull=vpiLast>vpiThreshold, vpiStrongBear=vpiLast<-vpiThreshold

  // Volume spike (avg 20 bars)
  const avgVol20=rollingSum(vol,20).map(s=>s/20)
  const volumeSpike=vol.map((v,i)=>v>avgVol20[i]*1.5)
  const vpiBreakout=volumeSpike[last]&&Math.abs(vpiLast)>vpiThreshold*0.7

  // ── Smart Compression (ATR Wilder×0.5, ≥3 bars) ───────────────────────
  const atrLen=14
  const trArr=candles.map((c,i)=>{if(i===0)return c.h-c.l;const p=candles[i-1];return Math.max(c.h-c.l,Math.abs(c.h-p.c),Math.abs(c.l-p.c))})
  // Wilder's RMA
  const atr=[trArr[0]]
  for(let i=1;i<n;i++) atr.push((atr[i-1]*(atrLen-1)+trArr[i])/atrLen)
  const compressionATRmult=0.5, compressionBars=3
  const rangeArr=candles.map(c=>c.h-c.l)
  const isCompressedBar=rangeArr.map((r,i)=>r<atr[i]*compressionATRmult)
  const compressCount=new Array(n).fill(0)
  for(let i=0;i<n;i++) compressCount[i]=isCompressedBar[i]?(i>0?compressCount[i-1]+1:1):0
  // ribbonTight: spread < 0.6% (approx of thick < stripHeight*0.3 from Pine)
  const ribbonTight=spread<0.6
  const smartCompressionArr=compressCount.map((cc,i)=>cc>=compressionBars&&Math.abs(sig[i])>20&&ribbonTight)
  const smartCompressionActive=smartCompressionArr[last]
  const rangeExpanding=last>=1?rangeArr[last]>rangeArr[last-1]*1.3:false
  const breakoutCandidate=(last>=1?smartCompressionArr[last-1]:false)&&rangeExpanding&&volumeSpike[last]

  // rrScore = (sig > sigSignal ? 1 : 0) + (sig > 0 ? 1 : 0) + (vpi > 0 ? 1 : 0)
  const rrScore=(sig[last]>sigSignal[last]?1:0)+(sig[last]>0?1:0)+(vpiLast>0?1:0)

  // Status
  let status='NEUTRAL'
  if(bullConfirm&&(ribbonBull||compression)&&momentum[last]>=0) status='BUY'
  else if(bearConfirm&&(ribbonBear||compression)&&momentum[last]<=0) status='SELL'
  else if(sig[last]>upT) status='OVERBOUGHT'
  else if(sig[last]<loT) status='OVERSOLD'

  return{sig,sigSignal,momentum,bullConfirm,bearConfirm,ribbonBull,ribbonBear,compression,status,emas,vpi,vpiStrongBull,vpiStrongBear,vpiBreakout,smartCompressionArr,smartCompressionActive,breakoutCandidate,obLevel:upT,osLevel:loT,rrScore}
}

// ── Draw ribbon strip ─────────────────────────────────────────────────────
function drawRibbonStrip(ctx:CanvasRenderingContext2D, W:number, H:number, emas:number[][]) {
  if (!emas || emas.length < 8) return
  const tail = 150; const es = emas.map(e => e.slice(-tail)); const n = es[0].length; if (n < 2) return
  const zMid = H * 0.895, zH = H * 0.09
  const xp = (i: number) => (i / (n - 1)) * W
  const maxSpreadPct = 0.015
  const toY = (barIdx: number, emaIdx: number): number => {
    const mid = (es[0][barIdx] + es[7][barIdx]) / 2, price = mid || 1
    const spread = Math.abs(es[0][barIdx] - es[7][barIdx]), spreadPct = spread / price
    const raw = spreadPct > 0 ? Math.max(-0.5, Math.min(0.5, (es[emaIdx][barIdx] - mid) / spread)) : (emaIdx - 3.5) / 8
    const scale = Math.min(1, spreadPct / maxSpreadPct)
    return zMid + raw * zH * 2 * scale
  }
  const isBull = es[0][n-1] > es[7][n-1]
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1; ctx.setLineDash([2, 6])
  ctx.beginPath(); ctx.moveTo(0, zMid - zH); ctx.lineTo(W, zMid - zH); ctx.stroke(); ctx.setLineDash([])
  ctx.beginPath()
  for (let i = 0; i < n; i++) { i === 0 ? ctx.moveTo(xp(i), toY(i, 0)) : ctx.lineTo(xp(i), toY(i, 0)) }
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(xp(i), toY(i, 7))
  ctx.closePath(); ctx.fillStyle = isBull ? `rgba(${resolveCSSColor('var(--tm-profit-rgb','34,199,89')},0.10)` : `rgba(${resolveCSSColor('var(--tm-loss-rgb','255,59,48')},0.10)`; ctx.fill()
  const bullC = ['var(--tm-profit)','#36D174','#4ADC8F','#5EE7AA','#F59714','#FF6060','var(--tm-loss)','#FF1818']
  const bearC = ['#FF1818','var(--tm-loss)','#FF6060','#F59714','#5EE7AA','#4ADC8F','#36D174','var(--tm-profit)']
  const cols = isBull ? bullC : bearC
  for (let ei = 0; ei < 8; ei++) {
    ctx.beginPath(); ctx.strokeStyle = cols[ei]; ctx.lineWidth = 1; ctx.globalAlpha = 0.9
    for (let i = 0; i < n; i++) { i === 0 ? ctx.moveTo(xp(i), toY(i, ei)) : ctx.lineTo(xp(i), toY(i, ei)) }
    ctx.stroke()
  }
  ctx.globalAlpha = 1; ctx.restore()
}

// ── Draw oscillator ───────────────────────────────────────────────────────
function drawOscillator(ctx:CanvasRenderingContext2D,W:number,H:number,main:number[],signal:number[],histogram:number[],obLevel:number,osLevel:number,mainColor:string,signalColor:string,histBullColor:string,histBearColor:string,dots?:{i:number;type:string}[],emas?:number[][],hoverIdx?:number|null,viewStart?:number,viewEnd?:number,vpiData?:number[],compressionArr?:boolean[]) {
  // Resolve canvas-unsafe CSS vars to real colors
  const resolvedSignal = signalColor.startsWith('var(') ? resolveCSSColor(signalColor.replace(/^var\((.+)\)$/,'$1'),'#F59714') : signalColor
  const resolvedBg = resolveCSSColor('--tm-bg','#0D1117')
  const accent = resolveCSSColor('--tm-accent','#00E5FF')
  const lossC  = resolveCSSColor('--tm-loss','#FF3B30')

  ctx.fillStyle=resolvedBg;ctx.fillRect(0,0,W,H)
  const startIdx = viewStart !== undefined ? viewStart : Math.max(0, main.length - 150)
  const endIdx   = viewEnd   !== undefined ? Math.min(viewEnd, main.length) : main.length
  const m=main.slice(startIdx,endIdx),s=signal.slice(startIdx,endIdx),h=histogram.slice(startIdx,endIdx)
  if(m.length<2)return
  const oscH = emas && emas.length > 0 ? H * 0.76 : H
  const allVals=[...m,...s,...h,obLevel,osLevel,0]
  const minV=Math.min(...allVals)*1.1,maxV=Math.max(...allVals)*1.1,range=maxV-minV||1
  const yp=(v:number)=>oscH-((v-minV)/range)*oscH
  const xp=(i:number)=>m.length>1?(i/(m.length-1))*W:W/2

  // Background zones
  ctx.fillStyle=`rgba(255,59,48,0.06)`;ctx.fillRect(0,yp(maxV),W,yp(obLevel)-yp(maxV))
  ctx.fillStyle=`rgba(34,199,89,0.06)`;ctx.fillRect(0,yp(osLevel),W,yp(minV)-yp(osLevel))

  // Grid lines
  ctx.setLineDash([3,3]);ctx.strokeStyle=resolveCSSColor('--tm-border','#2A2F3E');ctx.lineWidth=0.8
  ;[0,obLevel,osLevel].forEach(l=>{ctx.beginPath();ctx.moveTo(0,yp(l));ctx.lineTo(W,yp(l));ctx.stroke()})
  ctx.setLineDash([])

  // Level labels on right
  ctx.font='9px JetBrains Mono,monospace';ctx.fillStyle=resolveCSSColor('--tm-text-muted','#555C70');ctx.textAlign='right'
  ctx.fillText(String(obLevel),W-4,yp(obLevel)-3)
  ctx.fillText(String(osLevel),W-4,yp(osLevel)+11)
  ctx.fillText('0',W-4,yp(0)-3)

  // Histogram
  const barW=W/m.length
  h.forEach((v,i)=>{const x=xp(i),y=v>=0?yp(v):yp(0),bH=Math.abs(yp(v)-yp(0));ctx.fillStyle=v>=0?histBullColor:histBearColor;ctx.fillRect(x-barW/2+0.5,y,barW-1,bH||1)})

  // VPI overlay (vpi*0.8, same scale as VMC — matches Pine: plot(vpi * 0.8))
  if(vpiData){
    const vSlice=vpiData.slice(startIdx,endIdx)
    const yZero=yp(0)
    ctx.save(); ctx.globalAlpha=0.22
    vSlice.forEach((v,i)=>{const sv=v*0.8;const x=xp(i),y=sv>=0?yp(sv):yZero,bH=Math.abs(yp(sv)-yZero);ctx.fillStyle=sv>=0?'rgba(34,199,89,1)':'rgba(255,59,48,1)';ctx.fillRect(x-barW/2+0.5,y,barW-1,bH||1)})
    ctx.globalAlpha=1; ctx.restore()
  }

  // Signal & Main lines
  ctx.beginPath();ctx.strokeStyle=resolvedSignal;ctx.lineWidth=1.2;s.forEach((v,i)=>i===0?ctx.moveTo(xp(i),yp(v)):ctx.lineTo(xp(i),yp(v)));ctx.stroke()
  ctx.beginPath();ctx.strokeStyle=mainColor;ctx.lineWidth=2;m.forEach((v,i)=>i===0?ctx.moveTo(xp(i),yp(v)):ctx.lineTo(xp(i),yp(v)));ctx.stroke()

  // Smart compression markers: orange circle at bottom of chart
  if(compressionArr){
    const compSlice=compressionArr.slice(startIdx,endIdx)
    const yBottom=oscH-6
    compSlice.forEach((active,i)=>{if(!active)return;ctx.beginPath();ctx.arc(xp(i),yBottom,4,0,Math.PI*2);ctx.fillStyle='rgba(255,149,0,0.85)';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=0.8;ctx.stroke()})
  }

  // Signal dots (remapped from absolute indices to view-relative)
  if(dots){dots.filter(d=>d.i>=startIdx&&d.i<endIdx).forEach(d=>{const i=d.i-startIdx;const cx=xp(i),cy=yp(m[i]);const color=d.type.includes('bull')||d.type==='smartBull'?accent:lossC;const isSmart=d.type.includes('smart');ctx.beginPath();ctx.arc(cx,cy,isSmart?5:3,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();if(isSmart){ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.stroke()}})}

  // ── Interactive crosshair ───────────────────────────────────────────
  if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < m.length) {
    const hx = xp(hoverIdx), hy = yp(m[hoverIdx])
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3])
    ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, oscH); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(W, hy); ctx.stroke()
    ctx.setLineDash([])
    ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI*2)
    ctx.fillStyle = mainColor; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke()
    const sy = yp(s[hoverIdx])
    ctx.beginPath(); ctx.arc(hx, sy, 3.5, 0, Math.PI*2)
    ctx.fillStyle = resolvedSignal; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke()
    ctx.fillStyle = mainColor
    ctx.fillRect(W-52, hy-9, 52, 18)
    ctx.fillStyle = resolvedBg; ctx.font = 'bold 9px JetBrains Mono,monospace'; ctx.textAlign = 'center'
    ctx.fillText(m[hoverIdx].toFixed(1), W-26, hy+3)
  }

  if (emas && emas.length > 0) drawRibbonStrip(ctx, W, H, emas)
}

// ── Crosshair tooltip component ───────────────────────────────────────────
function CrosshairTooltip({ candles, main, signal, histogram, hoverIdx, canvasW, type, viewStart, viewEnd }:
  { candles: Candle[]; main: number[]; signal: number[]; histogram: number[]; hoverIdx: number; canvasW: number; type: 'wt'|'vmc'; viewStart?: number; viewEnd?: number }) {
  const startIdx = viewStart !== undefined ? viewStart : Math.max(0, main.length - 150)
  const endIdx   = viewEnd   !== undefined ? Math.min(viewEnd, main.length) : main.length
  const tail = endIdx - startIdx
  const dataIdx = startIdx + hoverIdx
  const candle = candles[dataIdx]
  if (!candle) return null
  const time = new Date(candle.t)
  const timeStr = time.toLocaleDateString('fr-FR', { day:'2-digit', month:'short' }) + ' ' +
    time.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' })
  const mainVal = main[dataIdx], sigVal = signal[dataIdx], histVal = histogram[dataIdx]
  const xp = (hoverIdx / (tail - 1)) * canvasW
  const left = xp > canvasW / 2 ? 12 : canvasW - 200

  return (
    <div style={{ position:'absolute', top:4, left, background:`rgba(${resolveCSSColor('var(--tm-bg-secondary-rgb','22,27,34')},0.96)`, border:'1px solid #2A2F3E', borderRadius:10, padding:'10px 14px', minWidth:175, pointerEvents:'none', boxShadow:'0 8px 24px rgba(0,0,0,0.6)', zIndex:20, backdropFilter:'blur(8px)' }}>
      <div style={{fontSize:10,color:'var(--tm-text-secondary)',fontWeight:600,marginBottom:6,fontFamily:'JetBrains Mono,monospace'}}>{timeStr}</div>
      <div style={{display:'flex',flexDirection:'column',gap:4}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span style={{fontSize:10,color:'var(--tm-text-muted)'}}>{type==='wt'?'WT1':'Signal'}</span>
          <span style={{fontSize:12,fontWeight:700,color:'#37D7FF',fontFamily:'JetBrains Mono,monospace'}}>{mainVal?.toFixed(1)}</span>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span style={{fontSize:10,color:'var(--tm-text-muted)'}}>{type==='wt'?'WT2':'Sig. Signal'}</span>
          <span style={{fontSize:12,fontWeight:700,color:'var(--tm-warning)',fontFamily:'JetBrains Mono,monospace'}}>{sigVal?.toFixed(1)}</span>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span style={{fontSize:10,color:'var(--tm-text-muted)'}}>Momentum</span>
          <span style={{fontSize:12,fontWeight:700,color:histVal>=0?'var(--tm-profit)':'var(--tm-loss)',fontFamily:'JetBrains Mono,monospace'}}>{histVal>=0?'+':''}{histVal?.toFixed(1)}</span>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',borderTop:'1px solid #2A2F3E',paddingTop:4,marginTop:2}}>
          <span style={{fontSize:10,color:'var(--tm-text-muted)'}}>Close</span>
          <span style={{fontSize:11,fontWeight:600,color:'var(--tm-text-primary)',fontFamily:'JetBrains Mono,monospace'}}>{candle.c.toFixed(candle.c<10?4:2)}</span>
        </div>
      </div>
    </div>
  )
}

// ── Viewport type ─────────────────────────────────────────────────────────
interface Viewport { from: number; to: number }  // fractions 0-1

// ── Interactive canvas hook (viewport-aware, wheel+drag) ──────────────────
function useInteractiveCanvas(
  draw: (ctx:CanvasRenderingContext2D, W:number, H:number, hoverIdx:number|null) => void,
  deps: unknown[], viewSize: number,
  viewport: Viewport, setViewport: (vp:Viewport) => void,
  onViewportChange?: (from: number, to: number) => void
) {
  const ref    = useRef<HTMLCanvasElement>(null)
  const [hoverIdx, setHoverIdx] = useState<number|null>(null)
  const [canvasW,  setCanvasW]  = useState(800)
  const dragRef = useRef<{x:number; vp:Viewport}|null>(null)
  const vpRef   = useRef<Viewport>(viewport)
  vpRef.current = viewport
  // Keep onViewportChange stable in a ref to avoid stale closures
  const onVPChangeRef = useRef(onViewportChange)
  useEffect(() => { onVPChangeRef.current = onViewportChange }, [onViewportChange])

  useEffect(() => {
    const c = ref.current; if(!c) return
    const dpr = window.devicePixelRatio || 1
    const cssW = c.offsetWidth || 800, cssH = c.offsetHeight || 180
    setCanvasW(cssW)
    c.width = cssW * dpr; c.height = cssH * dpr
    c.style.width = cssW + 'px'; c.style.height = cssH + 'px'
    const ctx = c.getContext('2d')!
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, cssW, cssH)
    draw(ctx, cssW, cssH, hoverIdx)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, hoverIdx])

  const applyViewport = useCallback((vp: Viewport) => {
    setViewport(vp)
    onVPChangeRef.current?.(vp.from, vp.to)
  }, [setViewport])

  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const c = ref.current; if (!c) return
    const rect = c.getBoundingClientRect()
    const mouseX = (e.clientX - rect.left) / rect.width
    const vp = vpRef.current
    const span = vp.to - vp.from
    const factor = e.deltaY > 0 ? 1.15 : 0.87
    const newSpan = Math.min(1, Math.max(0.02, span * factor))
    const newFrom = Math.max(0, Math.min(1 - newSpan, vp.from + mouseX * (span - newSpan)))
    applyViewport({ from: newFrom, to: newFrom + newSpan })
  }, [applyViewport])

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    dragRef.current = { x: e.clientX, vp: vpRef.current }
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragRef.current) {
      const rect = ref.current!.getBoundingClientRect()
      const dx = (dragRef.current.x - e.clientX) / rect.width
      const { from, to } = dragRef.current.vp
      const span = to - from
      const newFrom = Math.max(0, Math.min(1 - span, from + dx))
      applyViewport({ from: newFrom, to: newFrom + span })
    } else {
      const c = ref.current; if (!c || viewSize < 2) return
      const rect = c.getBoundingClientRect()
      const x = e.clientX - rect.left
      const idx = Math.round((x / rect.width) * (viewSize - 1))
      setHoverIdx(Math.max(0, Math.min(viewSize - 1, idx)))
    }
  }, [applyViewport, viewSize])

  const onMouseUp  = useCallback(() => { dragRef.current = null }, [])
  const onLeave    = useCallback(() => { dragRef.current = null; setHoverIdx(null) }, [])
  return { ref, hoverIdx, canvasW, onWheel, onMouseDown, onMouseMove, onMouseUp, onLeave }
}

// ── WaveTrend Chart ────────────────────────────────────────────────────────
function resolveCSSColor(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback
}

export function WaveTrendChart({ symbol, syncInterval, visibleRange, onStatusReady, onViewportChange }: { symbol: string; syncInterval?: string; visibleRange?: {from:number;to:number}|null; onStatusReady?: (status: string, wt1: number, wt2: number) => void; onViewportChange?: (from: number, to: number) => void }) {
  const [localTf, setLocalTf] = useState(TF_OPTIONS[3])
  const tf = syncInterval ? (TF_OPTIONS.find(t => t.interval === syncInterval) ?? localTf) : localTf
  const [candles, setCandles] = useState<Candle[]>([])
  const [result, setResult] = useState<WTResult|null>(null)
  const [status, setStatus] = useState<'idle'|'loading'|'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [nextRefresh, setNextRefresh] = useState(0)
  const [viewport, setViewport] = useState<Viewport>({from:0, to:1})
  const obLevel=53, osLevel=-53
  // Anti-loop: track last emitted viewport so we don't re-apply our own emission
  const lastEmitted = useRef<{from:number;to:number}|null>(null)

  const loadCandles = useCallback(async () => {
    setStatus('loading'); setErrorMsg('')
    try { const c = await fetchCandles(symbol, tf.interval, tf.limit); setCandles(c); setStatus('idle') }
    catch(e) { setErrorMsg((e as Error).message); setStatus('error') }
  }, [symbol, tf])

  useEffect(() => { loadCandles() }, [loadCandles])
  useEffect(() => { const ms = TF_REFRESH_MS[tf.interval] || 3600000; setNextRefresh(ms / 1000); const t = setInterval(() => setNextRefresh(x => x <= 1 ? ms / 1000 : x - 1), 1000); return () => clearInterval(t) }, [tf])
  useEffect(() => { const ms = TF_REFRESH_MS[tf.interval] || 3600000; const t = setInterval(() => loadCandles(), ms); return () => clearInterval(t) }, [tf, loadCandles])

  useEffect(() => {
    if (candles.length < 20) return
    const r = calcWaveTrend(candles, 10, 21, obLevel, osLevel); setResult(r)
    if (r.wt1.length > 1) signalService.checkWaveTrend(symbol, tf.label, r.wt1, r.wt2, obLevel, osLevel)
  }, [candles, symbol, tf.label])

  // Sync viewport from LW chart range fractions
  useEffect(() => {
    if (!visibleRange) {
      const n = candles.length || 1
      setViewport({ from: Math.max(0, 1 - 150/n), to: 1 })
    } else {
      const eps = 0.001
      if (lastEmitted.current) {
        const eq = Math.abs(visibleRange.from - lastEmitted.current.from) < eps &&
                   Math.abs(visibleRange.to   - lastEmitted.current.to  ) < eps
        lastEmitted.current = null  // consume : always clear so subsequent LW pans pass through
        if (eq) return
      }
      setViewport({ from: visibleRange.from, to: visibleRange.to })
    }
  }, [visibleRange, candles.length])

  const total     = candles.length
  const viewStart = total > 0 ? Math.max(0, Math.floor(viewport.from * total)) : 0
  const viewEnd   = total > 0 ? Math.min(total, Math.ceil(viewport.to   * total)) : 0
  const viewSize  = Math.max(viewEnd - viewStart, 2)

  const dots = result ? result.signals.flatMap((s,i)=>s?[{i,type:s}]:[]) : []
  const histogram = result ? result.wt1.map((v,i)=>v-result.wt2[i]) : []

  // Wrap onViewportChange to track last emission (anti-loop)
  const handleVPChange = useCallback((from: number, to: number) => {
    lastEmitted.current = { from, to }
    onViewportChange?.(from, to)
  }, [onViewportChange])

  const { ref: canvasRef, hoverIdx, canvasW, onWheel, onMouseDown, onMouseMove, onMouseUp, onLeave } = useInteractiveCanvas(
    (ctx, W, H, hi) => {
      if(!result||result.wt1.length<2) return
      drawOscillator(ctx,W,H,result.wt1,result.wt2,histogram,obLevel,osLevel,'#37D7FF','#F59714',`rgba(34,199,89,0.5)`,`rgba(255,59,48,0.5)`,dots,undefined,hi,viewStart,viewEnd)
    }, [result, viewStart, viewEnd], viewSize, viewport, setViewport, handleVPChange
  )

  const wt1Last = result?.wt1[result.wt1.length-1]??0, wt2Last = result?.wt2[result.wt2.length-1]??0
  const badge = !result?null:wt1Last>obLevel?{label:'Overbought',color:'var(--tm-loss)'}:wt1Last<osLevel?{label:'Oversold',color:'var(--tm-profit)'}:result.signals[result.signals.length-1]==='smartBull'?{label:'Smart Bullish',color:'var(--tm-accent)'}:result.signals[result.signals.length-1]==='bull'?{label:'Bullish Reversal',color:'var(--tm-profit)'}:result.signals[result.signals.length-1]==='smartBear'?{label:'Smart Bearish',color:'var(--tm-loss)'}:result.signals[result.signals.length-1]==='bear'?{label:'Bearish Reversal',color:'var(--tm-loss)'}:{label:'Neutral',color:'var(--tm-text-secondary)'}

  // Expose status for PDF export
  useEffect(() => {
    if (badge && result) onStatusReady?.(badge.label, wt1Last, wt2Last)
  }, [badge?.label, wt1Last, wt2Last]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{background:'var(--tm-bg-secondary)',border:'1px solid #1E2330',borderRadius:16,overflow:'hidden'}}>
      <div style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <div style={{width:32,height:32,borderRadius:9,background:'linear-gradient(135deg,#FF9500,#FF9500aa)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>〜</div>
        <div><div style={{fontSize:13,fontWeight:700,color:'var(--tm-text-primary)'}}>WaveTrend Oscillator</div><div style={{fontSize:10,color:'#F59714aa'}}>{symbol}</div></div>
        <div style={{display:'flex',alignItems:'center',gap:5,padding:'2px 8px',background:`rgba(${resolveCSSColor('var(--tm-profit-rgb','34,199,89')},0.1)`,border:'1px solid rgba(var(--tm-profit-rgb,34,199,89),0.25)',borderRadius:6}}>
          <div style={{width:5,height:5,borderRadius:'50%',background:'var(--tm-profit)',animation:'pulse 1.5s ease-in-out infinite'}}/><span style={{fontSize:9,fontWeight:700,color:'var(--tm-profit)',fontFamily:'monospace'}}>LIVE</span>
          <span style={{fontSize:9,color:'var(--tm-text-muted)',fontFamily:'monospace'}}>{Math.floor(nextRefresh/60)}:{String(nextRefresh%60).padStart(2,'0')}</span>
        </div>
        {badge&&<div style={{fontSize:10,fontWeight:700,color:badge.color,background:`${badge.color}20`,padding:'2px 10px',borderRadius:20,border:`1px solid ${badge.color}50`}}>{badge.label}</div>}
        <div style={{marginLeft:'auto',display:'flex',gap:10,alignItems:'center'}}>
          {result&&<div style={{display:'flex',gap:10,fontSize:11,fontFamily:'monospace'}}><span style={{color:'#37D7FF'}}>WT1: {wt1Last.toFixed(1)}</span><span style={{color:'var(--tm-warning)'}}>WT2: {wt2Last.toFixed(1)}</span></div>}
          <button onClick={loadCandles} style={{background:'var(--tm-bg-tertiary)',border:'1px solid #2A2F3E',borderRadius:7,padding:'4px 9px',cursor:'pointer',fontSize:11,color:'var(--tm-text-secondary)'}}>↻</button>
        </div>
      </div>
      {!syncInterval && <div style={{display:'flex',gap:4,padding:'0 16px 10px',overflowX:'auto',scrollbarWidth:'none'}}>
        {TF_OPTIONS.map(t=><button key={t.label} onClick={()=>setLocalTf(t)} style={{padding:'3px 10px',borderRadius:20,fontSize:10,fontWeight:500,cursor:'pointer',border:`1px solid ${t.label===tf.label?'var(--tm-warning)':'var(--tm-border)'}`,background:t.label===tf.label?`rgba(${resolveCSSColor('var(--tm-warning-rgb','255,149,0')},0.15)`:'var(--tm-bg-tertiary)',color:t.label===tf.label?'var(--tm-warning)':'var(--tm-text-muted)',whiteSpace:'nowrap'}}>{t.label}</button>)}
      </div>}
      <div style={{padding:'0 16px 16px',position:'relative'}}>
        {status==='loading'&&<div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(8,12,20,0.85)',borderRadius:8,zIndex:30,gap:8,flexDirection:'column'}}>
          <div style={{width:18,height:18,border:'2px solid #2A2F3E',borderTopColor:'var(--tm-warning)',borderRadius:'50%',animation:'spin 0.7s linear infinite'}}/><span style={{fontSize:11,color:'var(--tm-text-muted)'}}>Chargement {symbol}...</span>
        </div>}
        {status==='error'&&<div style={{padding:'20px 16px',display:'flex',flexDirection:'column',alignItems:'center',gap:8,textAlign:'center'}}>
          <span style={{fontSize:22}}>📡</span><span style={{fontSize:11,fontWeight:600,color:'var(--tm-loss)'}}>{errorMsg}</span>
          <span style={{fontSize:10,color:'var(--tm-text-muted)',maxWidth:320}}>{isCryptoSymbol(symbol)?"Ce symbole n'est pas disponible sur Binance Futures ni Spot.":'Essayez: AAPL · TSLA · EURUSD=X · GC=F (Or) · ^FCHI (CAC40) · MC.PA (LVMH)'}</span>
        </div>}
        <canvas ref={canvasRef} width={800} height={180}
          onWheel={onWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove}
          onMouseUp={onMouseUp} onMouseLeave={onLeave}
          style={{width:'100%',height:180,display:'block',borderRadius:8,cursor:'crosshair',userSelect:'none'}}/>
        {hoverIdx !== null && result && result.wt1.length > 0 && (
          <CrosshairTooltip candles={candles} main={result.wt1} signal={result.wt2} histogram={histogram} hoverIdx={hoverIdx} canvasW={canvasW} type="wt" viewStart={viewStart} viewEnd={viewEnd}/>
        )}
        <div style={{display:'flex',gap:12,marginTop:8,flexWrap:'wrap'}}>
          {[{color:'#37D7FF',label:'WT1'},{color:'var(--tm-warning)',label:'WT2'},{color:'var(--tm-profit)',label:'Momentum +'},{color:'var(--tm-loss)',label:'Momentum −'},{color:'var(--tm-accent)',label:'● Smart'}].map(({color,label})=>(
            <div key={label} style={{display:'flex',alignItems:'center',gap:4}}><div style={{width:8,height:8,borderRadius:2,background:color}}/><span style={{fontSize:9,color:'var(--tm-text-muted)'}}>{label}</span></div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── VMC Oscillator Chart ───────────────────────────────────────────────────
export function VMCOscillatorChart({ symbol, syncInterval, visibleRange, onStatusReady, onViewportChange }: { symbol: string; syncInterval?: string; visibleRange?: {from:number;to:number}|null; onStatusReady?: (status: string, sig: number) => void; onViewportChange?: (from: number, to: number) => void }) {
  const [localTf, setLocalTf] = useState(TF_OPTIONS[3])
  const tf = syncInterval ? (TF_OPTIONS.find(t => t.interval === syncInterval) ?? localTf) : localTf
  const [candles, setCandles] = useState<Candle[]>([])
  const [result, setResult] = useState<VMCResult|null>(null)
  const [status, setStatus] = useState<'idle'|'loading'|'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [viewport, setViewport] = useState<Viewport>({from:0, to:1})
  const lastEmitted = useRef<{from:number;to:number}|null>(null)
  // obLevel/osLevel are dynamic from result (default PERSONNALISÉ: 40/-40)
  const obLevel=result?.obLevel??40, osLevel=result?.osLevel??-40

  const loadCandles = useCallback(async () => {
    setStatus('loading'); setErrorMsg('')
    try { const c = await fetchCandles(symbol, tf.interval, tf.limit); setCandles(c); setStatus('idle') }
    catch(e) { setErrorMsg((e as Error).message); setStatus('error') }
  }, [symbol, tf])

  useEffect(() => { loadCandles() }, [loadCandles])
  useEffect(() => { const ms = TF_REFRESH_MS[tf.interval] || 3600000; const t = setInterval(() => loadCandles(), ms); return () => clearInterval(t) }, [tf, loadCandles])
  const [nextRefreshVMC, setNextRefreshVMC] = useState(0)
  useEffect(() => { const ms = TF_REFRESH_MS[tf.interval] || 3600000; setNextRefreshVMC(ms/1000); const t = setInterval(() => setNextRefreshVMC(x => x<=1?ms/1000:x-1), 1000); return () => clearInterval(t) }, [tf])

  useEffect(() => {
    if (candles.length < 60) return
    const r = calcVMCOscillator(candles, 'custom'); setResult(r)
    const sig = r.sig[r.sig.length-1]??0, mom = r.momentum[r.momentum.length-1]??0
    signalService.checkVMC(symbol, tf.label, r.status, sig, mom, r.compression)
  }, [candles, symbol, tf.label])

  // Sync viewport from LW chart range fractions — ignore our own emissions
  useEffect(() => {
    if (!visibleRange) {
      const n = candles.length || 1
      setViewport({ from: Math.max(0, 1 - 150/n), to: 1 })
    } else {
      const eps = 0.001
      if (lastEmitted.current) {
        const eq = Math.abs(visibleRange.from - lastEmitted.current.from) < eps &&
                   Math.abs(visibleRange.to   - lastEmitted.current.to  ) < eps
        lastEmitted.current = null
        if (eq) return
      }
      setViewport({ from: visibleRange.from, to: visibleRange.to })
    }
  }, [visibleRange, candles.length])

  const vmcTotal     = candles.length
  const vmcViewStart = vmcTotal > 0 ? Math.max(0, Math.floor(viewport.from * vmcTotal)) : 0
  const vmcViewEnd   = vmcTotal > 0 ? Math.min(vmcTotal, Math.ceil(viewport.to   * vmcTotal)) : 0
  const vmcViewSize  = Math.max(vmcViewEnd - vmcViewStart, 2)

  const lastSig=result?.sig[result.sig.length-1]??0, lastMom=result?.momentum[result.momentum.length-1]??0
  const statusColor=result?.status==='BUY'?'var(--tm-profit)':result?.status==='SELL'?'var(--tm-loss)':result?.status==='OVERBOUGHT'?'var(--tm-loss)':result?.status==='OVERSOLD'?'var(--tm-profit)':'var(--tm-text-secondary)'

  // Expose status for PDF export
  useEffect(() => {
    if (result?.status) onStatusReady?.(result.status, lastSig)
  }, [result?.status, lastSig]) // eslint-disable-line react-hooks/exhaustive-deps

  // Compute VMC cross dots (bull/bear in extreme zones, like WaveTrend)
  const vmcDots: {i:number;type:string}[] = result ? result.sig.flatMap((v,i) => {
    if(i===0) return []
    const crossUp = result.sig[i-1]<=result.sigSignal[i-1] && result.sig[i]>result.sigSignal[i]
    const crossDn = result.sig[i-1]>=result.sigSignal[i-1] && result.sig[i]<result.sigSignal[i]
    if(crossUp && v<=osLevel) return [{i,type:'smartBull'}]
    if(crossUp) return [{i,type:'bull'}]
    if(crossDn && v>=obLevel) return [{i,type:'smartBear'}]
    if(crossDn) return [{i,type:'bear'}]
    return []
  }) : []

  const handleVPChange = useCallback((from: number, to: number) => {
    lastEmitted.current = { from, to }
    onViewportChange?.(from, to)
  }, [onViewportChange])

  const { ref: canvasRef, hoverIdx, canvasW, onWheel, onMouseDown, onMouseMove, onMouseUp, onLeave } = useInteractiveCanvas(
    (ctx, W, H, hi) => {
      if(!result||result.sig.length<2) return
      drawOscillator(ctx,W,H,result.sig,result.sigSignal,result.momentum,obLevel,osLevel,'#37D7FF','#F59714',`rgba(34,199,89,0.55)`,`rgba(255,59,48,0.55)`,vmcDots,result.emas,hi,vmcViewStart,vmcViewEnd,result.vpi,result.smartCompressionArr)
    }, [result, vmcDots, vmcViewStart, vmcViewEnd, obLevel, osLevel], vmcViewSize, viewport, setViewport, handleVPChange
  )

  return (
    <div style={{background:'var(--tm-bg-secondary)',border:'1px solid #1E2330',borderRadius:16,overflow:'hidden'}}>
      <div style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <div style={{width:32,height:32,borderRadius:9,background:'linear-gradient(135deg,#FF9500,#FF9500aa)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,color:'white'}}>V</div>
        <div><div style={{fontSize:13,fontWeight:700,color:'var(--tm-text-primary)'}}>VMC Oscillator</div><div style={{fontSize:10,color:'#F59714aa'}}>{symbol}</div></div>
        <div style={{display:'flex',alignItems:'center',gap:5,padding:'2px 8px',background:`rgba(${resolveCSSColor('var(--tm-profit-rgb','34,199,89')},0.1)`,border:'1px solid rgba(var(--tm-profit-rgb,34,199,89),0.25)',borderRadius:6}}>
          <div style={{width:5,height:5,borderRadius:'50%',background:'var(--tm-profit)',animation:'pulse 1.5s ease-in-out infinite'}}/><span style={{fontSize:9,fontWeight:700,color:'var(--tm-profit)',fontFamily:'monospace'}}>LIVE</span>
          <span style={{fontSize:9,color:'var(--tm-text-muted)',fontFamily:'monospace'}}>{Math.floor(nextRefreshVMC/60)}:{String(nextRefreshVMC%60).padStart(2,'0')}</span>
        </div>
        {result&&<div style={{fontSize:10,fontWeight:700,color:statusColor,background:`${statusColor}20`,padding:'2px 10px',borderRadius:20,border:`1px solid ${statusColor}50`}}>{result.status}</div>}
        {result?.ribbonBull&&<div style={{fontSize:9,fontWeight:700,color:'var(--tm-profit)',background:`rgba(${resolveCSSColor('var(--tm-profit-rgb','34,199,89')},0.12)`,padding:'1px 7px',borderRadius:10,border:'1px solid rgba(var(--tm-profit-rgb,34,199,89),0.3)'}}>BULL</div>}
        {result?.ribbonBear&&<div style={{fontSize:9,fontWeight:700,color:'var(--tm-loss)',background:`rgba(${resolveCSSColor('var(--tm-loss-rgb','255,59,48')},0.12)`,padding:'1px 7px',borderRadius:10,border:'1px solid rgba(var(--tm-loss-rgb,255,59,48),0.3)'}}>BEAR</div>}
        {result?.compression&&<div style={{fontSize:9,fontWeight:700,color:'var(--tm-warning)',background:`rgba(${resolveCSSColor('var(--tm-warning-rgb','255,149,0')},0.12)`,padding:'1px 7px',borderRadius:10,border:'1px solid rgba(var(--tm-warning-rgb,255,149,0),0.3)'}}>⟳ COMP</div>}
        {result?.vpiStrongBull&&<div style={{fontSize:9,fontWeight:700,color:'#00E5FF',background:'rgba(0,229,255,0.10)',padding:'1px 7px',borderRadius:10,border:'1px solid rgba(0,229,255,0.3)'}}>VPI ↑</div>}
        {result?.vpiStrongBear&&<div style={{fontSize:9,fontWeight:700,color:'#FF453A',background:'rgba(255,69,58,0.10)',padding:'1px 7px',borderRadius:10,border:'1px solid rgba(255,69,58,0.3)'}}>VPI ↓</div>}
        {result?.smartCompressionActive&&<div style={{fontSize:9,fontWeight:700,color:'#FF9500',background:'rgba(255,149,0,0.12)',padding:'1px 7px',borderRadius:10,border:'1px solid rgba(255,149,0,0.4)'}}>⚡ SQUEEZE</div>}
        {result?.breakoutCandidate&&<div style={{fontSize:9,fontWeight:700,color:'#FFD60A',background:'rgba(255,214,10,0.12)',padding:'1px 7px',borderRadius:10,border:'1px solid rgba(255,214,10,0.4)'}}>💥 BREAKOUT</div>}
        <div style={{marginLeft:'auto',display:'flex',gap:10,alignItems:'center'}}>
          {result&&<div style={{display:'flex',gap:8,fontSize:11,fontFamily:'monospace',flexWrap:'wrap'}}>
            <span style={{color:'#37D7FF'}}>sig: {lastSig.toFixed(1)}</span>
            <span style={{color:lastMom>=0?'var(--tm-profit)':'var(--tm-loss)'}}>mom: {lastMom>=0?'+':''}{lastMom.toFixed(1)}</span>
            <span style={{color:'rgba(34,199,89,0.9)'}}>VPI: {(result.vpi[result.vpi.length-1]??0).toFixed(1)}</span>
            <span style={{color:'var(--tm-text-muted)'}}>RR: {result.rrScore}/3</span>
          </div>}
          <button onClick={loadCandles} style={{background:'var(--tm-bg-tertiary)',border:'1px solid #2A2F3E',borderRadius:7,padding:'4px 9px',cursor:'pointer',fontSize:11,color:'var(--tm-text-secondary)'}}>↻</button>
        </div>
      </div>
      {!syncInterval && <div style={{display:'flex',gap:3,padding:'0 16px 8px',overflowX:'auto',scrollbarWidth:'none'}}>
          {TF_OPTIONS.map(t=><button key={t.label} onClick={()=>setLocalTf(t)} style={{padding:'3px 9px',borderRadius:20,fontSize:10,fontWeight:500,cursor:'pointer',border:`1px solid ${t.label===tf.label?'var(--tm-warning)':'var(--tm-border)'}`,background:t.label===tf.label?`rgba(${resolveCSSColor('var(--tm-warning-rgb','255,149,0')},0.15)`:'var(--tm-bg-tertiary)',color:t.label===tf.label?'var(--tm-warning)':'var(--tm-text-muted)',whiteSpace:'nowrap'}}>{t.label}</button>)}
      </div>}
      <div style={{padding:'0 16px 16px',position:'relative'}}>
        {status==='loading'&&<div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'rgba(8,12,20,0.85)',borderRadius:8,zIndex:30,gap:8}}>
          <div style={{width:18,height:18,border:'2px solid #2A2F3E',borderTopColor:'var(--tm-warning)',borderRadius:'50%',animation:'spin 0.7s linear infinite'}}/><span style={{fontSize:11,color:'var(--tm-text-muted)'}}>Chargement {symbol}...</span>
        </div>}
        {status==='error'&&<div style={{padding:'20px 16px',display:'flex',flexDirection:'column',alignItems:'center',gap:8,textAlign:'center'}}>
          <span style={{fontSize:22}}>📡</span><span style={{fontSize:11,fontWeight:600,color:'var(--tm-loss)'}}>{errorMsg}</span>
          <span style={{fontSize:10,color:'var(--tm-text-muted)',maxWidth:320}}>{isCryptoSymbol(symbol)?"Ce symbole n'est pas disponible sur Binance Futures ni Spot.":'Essayez: AAPL · TSLA · EURUSD=X · GC=F (Or) · ^FCHI (CAC40) · MC.PA (LVMH)'}</span>
        </div>}
        <canvas ref={canvasRef} width={800} height={230}
          onWheel={onWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove}
          onMouseUp={onMouseUp} onMouseLeave={onLeave}
          style={{width:'100%',height:230,display:'block',borderRadius:8,cursor:'crosshair',userSelect:'none'}}/>
        {hoverIdx !== null && result && result.sig.length > 0 && (
          <CrosshairTooltip candles={candles} main={result.sig} signal={result.sigSignal} histogram={result.momentum} hoverIdx={hoverIdx} canvasW={canvasW} type="vmc" viewStart={vmcViewStart} viewEnd={vmcViewEnd}/>
        )}
        <div style={{display:'flex',gap:12,marginTop:8,flexWrap:'wrap'}}>
          {[{color:'#37D7FF',label:'VMC Sig'},{color:'var(--tm-warning)',label:'Signal'},{color:'var(--tm-profit)',label:'Mom +'},{color:'var(--tm-loss)',label:'Mom −'},{color:'rgba(34,199,89,0.5)',label:'VPI'},{color:'#FF9500',label:'⚡Squeeze'},{color:'var(--tm-warning)',label:`OB:${obLevel}`},{color:'var(--tm-profit)',label:`OS:${osLevel}`}].map(({color,label})=>(
            <div key={label} style={{display:'flex',alignItems:'center',gap:4}}><div style={{width:8,height:8,borderRadius:2,background:color}}/><span style={{fontSize:9,color:'var(--tm-text-muted)'}}>{label}</span></div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── RSI Bollinger helpers ─────────────────────────────────────────────────
function rollingStdev(vals: number[], length: number): number[] {
  return vals.map((_, i) => {
    const win = vals.slice(Math.max(0, i - length + 1), i + 1)
    const mean = win.reduce((a, b) => a + b, 0) / win.length
    const variance = win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length
    return Math.sqrt(variance)
  })
}

function findPivotIdxs(data: number[], len: number, type: 'low' | 'high'): number[] {
  const idxs: number[] = []
  for (let i = len; i < data.length - len; i++) {
    let isPivot = true
    for (let j = i - len; j <= i + len; j++) {
      if (j === i) continue
      if (type === 'low' ? data[j] <= data[i] : data[j] >= data[i]) { isPivot = false; break }
    }
    if (isPivot) idxs.push(i)
  }
  return idxs
}

interface RSIBBTrendline {
  x1: number; y1: number   // first pivot bar idx + RSI value
  x2: number; y2: number   // second pivot bar idx + RSI value
  slope: number
  endIdx: number           // last bar this trendline is drawn to
  broken: boolean
  breakIdx: number
  type: 'low' | 'high'
}
interface RSIBBResult {
  rsi: number[]
  basis: number[]
  upper: number[]
  lower: number[]
  disp_up: number[]
  disp_down: number[]
  trendlines: RSIBBTrendline[]
  divBull: { barIdx: number; prevBarIdx: number }[]
  divBear: { barIdx: number; prevBarIdx: number }[]
  tpUpperBars: boolean[]
  tpLowerBars: boolean[]
}

function calcRSIBollinger(
  candles: Candle[], rsiLen: number, bbLen: number, bbStdev: number,
  sigma: number, pLen: number, rsiDiff: number,
  showTrendlines: boolean, showDivergence: boolean
): RSIBBResult {
  const EMPTY: RSIBBResult = { rsi:[],basis:[],upper:[],lower:[],disp_up:[],disp_down:[],trendlines:[],divBull:[],divBear:[],tpUpperBars:[],tpLowerBars:[] }
  const n = candles.length
  if (n < 30) return EMPTY

  const rsi = calcRSI(candles, rsiLen)
  const basis = emaArr(rsi, bbLen)
  const sd = rollingStdev(rsi, bbLen)
  const upper    = basis.map((b, i) => b + bbStdev * sd[i])
  const lower    = basis.map((b, i) => b - bbStdev * sd[i])
  const disp_up  = basis.map((b, i) => b + (upper[i] - lower[i]) * sigma)
  const disp_down= basis.map((b, i) => b - (upper[i] - lower[i]) * sigma)

  const trendlines: RSIBBTrendline[] = []

  if (showTrendlines && n > pLen * 2 + 5) {
    // Pivot LOWS → support lines (connect higher lows; breakout = rsi drops below line)
    const plIdxs = findPivotIdxs(rsi, pLen, 'low')
    for (let k = Math.max(0, plIdxs.length - 12); k < plIdxs.length - 1; k++) {
      const x1 = plIdxs[k], x2 = plIdxs[k + 1]
      const y1 = rsi[x1],   y2 = rsi[x2]
      if (y2 <= y1) continue   // only higher lows = rising support
      const slope = (y2 - y1) / (x2 - x1)
      let broken = false, breakIdx = n - 1
      for (let j = x2 + 1; j < n; j++) {
        if (rsi[j] < y2 + slope * (j - x2) - rsiDiff) { broken = true; breakIdx = j; break }
      }
      trendlines.push({ x1, y1, x2, y2, slope, endIdx: broken ? breakIdx : n - 1, broken, breakIdx, type: 'low' })
    }
    // Pivot HIGHS → resistance lines (connect lower highs; breakout = rsi rises above line)
    const phIdxs = findPivotIdxs(rsi, pLen, 'high')
    for (let k = Math.max(0, phIdxs.length - 12); k < phIdxs.length - 1; k++) {
      const x1 = phIdxs[k], x2 = phIdxs[k + 1]
      const y1 = rsi[x1],   y2 = rsi[x2]
      if (y2 >= y1) continue   // only lower highs = falling resistance
      const slope = (y2 - y1) / (x2 - x1)
      let broken = false, breakIdx = n - 1
      for (let j = x2 + 1; j < n; j++) {
        if (rsi[j] > y2 + slope * (j - x2) + rsiDiff) { broken = true; breakIdx = j; break }
      }
      trendlines.push({ x1, y1, x2, y2, slope, endIdx: broken ? breakIdx : n - 1, broken, breakIdx, type: 'high' })
    }
  }

  const divBull: { barIdx: number; prevBarIdx: number }[] = []
  const divBear: { barIdx: number; prevBarIdx: number }[] = []

  if (showDivergence && n > 30) {
    const dlb = 5, drb = 5, dMin = 5, dMax = 60
    const plD = findPivotIdxs(rsi, dlb, 'low').filter(i => i < n - drb)
    for (let k = 1; k < plD.length; k++) {
      const i1 = plD[k - 1], i2 = plD[k]
      if (i2 - i1 < dMin || i2 - i1 > dMax) continue
      if (candles[i2].l < candles[i1].l && rsi[i2] > rsi[i1]) divBull.push({ barIdx: i2, prevBarIdx: i1 })
    }
    const phD = findPivotIdxs(rsi, dlb, 'high').filter(i => i < n - drb)
    for (let k = 1; k < phD.length; k++) {
      const i1 = phD[k - 1], i2 = phD[k]
      if (i2 - i1 < dMin || i2 - i1 > dMax) continue
      if (candles[i2].h > candles[i1].h && rsi[i2] < rsi[i1]) divBear.push({ barIdx: i2, prevBarIdx: i1 })
    }
  }

  return {
    rsi, basis, upper, lower, disp_up, disp_down, trendlines, divBull, divBear,
    tpUpperBars: rsi.map((r, i) => r >= upper[i]),
    tpLowerBars: rsi.map((r, i) => r <= lower[i]),
  }
}

// ── RSI Bollinger draw ─────────────────────────────────────────────────────
function drawRSIBollinger(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  result: RSIBBResult, hoverIdx: number | null,
  viewStart: number, viewEnd: number,
  showTrendlines: boolean, showDivergence: boolean
) {
  ctx.fillStyle = resolveCSSColor('--tm-bg', '#0D1117'); ctx.fillRect(0, 0, W, H)
  const { rsi, basis, upper, lower, disp_up, disp_down, trendlines, divBull, divBear, tpUpperBars, tpLowerBars } = result
  const si = viewStart, ei = Math.min(viewEnd, rsi.length)
  const n = ei - si; if (n < 2) return

  const rsiS  = rsi.slice(si, ei)
  const basS  = basis.slice(si, ei)
  const uppS  = upper.slice(si, ei)
  const lowS  = lower.slice(si, ei)
  const duS   = disp_up.slice(si, ei)
  const ddS   = disp_down.slice(si, ei)

  const pad = { top: 8, bot: 8 }
  const oscH = H - pad.top - pad.bot
  const xp    = (i: number) => n > 1 ? (i / (n - 1)) * W : W / 2
  const yp    = (v: number) => pad.top + oscH * (1 - Math.max(0, Math.min(100, v)) / 100)
  const xpAbs = (abs: number) => xp(abs - si)

  // OB/OS zones
  ctx.fillStyle = 'rgba(255,59,48,0.06)';  ctx.fillRect(0, yp(100), W, yp(70) - yp(100))
  ctx.fillStyle = 'rgba(34,199,89,0.06)';  ctx.fillRect(0, yp(30),  W, yp(0)  - yp(30))

  // Grid & labels
  ctx.setLineDash([3, 3]); ctx.strokeStyle = resolveCSSColor('--tm-border', '#2A2F3E'); ctx.lineWidth = 0.8
  ;[70, 50, 30].forEach(l => { ctx.beginPath(); ctx.moveTo(0, yp(l)); ctx.lineTo(W, yp(l)); ctx.stroke() })
  ctx.setLineDash([])
  ctx.font = '9px JetBrains Mono,monospace'; ctx.fillStyle = resolveCSSColor('--tm-text-muted', '#555C70'); ctx.textAlign = 'right'
  ctx.fillText('70', W - 4, yp(70) + 11); ctx.fillText('50', W - 4, yp(50) + 11); ctx.fillText('30', W - 4, yp(30) - 3)

  // BB band fill
  ctx.beginPath()
  uppS.forEach((v, i) => i === 0 ? ctx.moveTo(xp(i), yp(v)) : ctx.lineTo(xp(i), yp(v)))
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(xp(i), yp(lowS[i]))
  ctx.closePath(); ctx.fillStyle = 'rgba(0,229,255,0.04)'; ctx.fill()

  // BB lines (upper/lower)
  for (const arr of [uppS, lowS]) {
    ctx.beginPath(); ctx.strokeStyle = '#00E5FF'; ctx.lineWidth = 1
    arr.forEach((v, i) => i === 0 ? ctx.moveTo(xp(i), yp(v)) : ctx.lineTo(xp(i), yp(v))); ctx.stroke()
  }

  // Basis line
  ctx.beginPath(); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5
  basS.forEach((v, i) => i === 0 ? ctx.moveTo(xp(i), yp(v)) : ctx.lineTo(xp(i), yp(v))); ctx.stroke()

  // Dispersion fill
  ctx.beginPath()
  duS.forEach((v, i) => i === 0 ? ctx.moveTo(xp(i), yp(v)) : ctx.lineTo(xp(i), yp(v)))
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(xp(i), yp(ddS[i]))
  ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill()

  // Dispersion lines (disp_up / disp_down)
  for (const arr of [duS, ddS]) {
    ctx.beginPath(); ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2
    arr.forEach((v, i) => i === 0 ? ctx.moveTo(xp(i), yp(v)) : ctx.lineTo(xp(i), yp(v))); ctx.stroke()
  }

  // RSI — 3 colors: green (≥disp_up), red (≤disp_down), yellow (between)
  for (let i = 1; i < n; i++) {
    const v = rsiS[i], col = v >= duS[i] ? '#22C759' : v <= ddS[i] ? '#FF3B30' : '#FFEA00'
    ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([])
    ctx.moveTo(xp(i - 1), yp(rsiS[i - 1])); ctx.lineTo(xp(i), yp(v)); ctx.stroke()
  }

  // Trendlines
  if (showTrendlines) {
    for (const tl of trendlines) {
      const drawEnd = Math.min(tl.endIdx, ei - 1)
      const drawStart = Math.max(tl.x1, si)
      if (drawEnd < si || drawStart >= ei) continue
      const col = tl.type === 'low' ? '#ffffff' : '#ff03e2'
      const ys = tl.y2 + tl.slope * (drawStart - tl.x2)
      const ye = tl.y2 + tl.slope * (drawEnd   - tl.x2)
      ctx.beginPath()
      ctx.strokeStyle = tl.broken ? col + '55' : col
      ctx.lineWidth = 2; ctx.setLineDash(tl.broken ? [4, 4] : [])
      ctx.moveTo(xpAbs(drawStart), yp(ys)); ctx.lineTo(xpAbs(drawEnd), yp(ye)); ctx.stroke()
      ctx.setLineDash([])
      // Breakout emoji
      if (tl.broken && tl.breakIdx >= si && tl.breakIdx < ei) {
        ctx.font = '11px sans-serif'; ctx.textAlign = 'center'
        ctx.fillText('🔥', xpAbs(tl.breakIdx), yp(rsi[tl.breakIdx]) + (tl.type === 'low' ? 14 : -6))
      }
    }
  }

  // Divergences
  if (showDivergence) {
    ctx.lineWidth = 2; ctx.setLineDash([])
    for (const d of divBull) {
      if (d.barIdx < si || d.barIdx >= ei || d.prevBarIdx < si) continue
      ctx.beginPath(); ctx.strokeStyle = '#22C759'
      ctx.moveTo(xpAbs(d.prevBarIdx), yp(rsi[d.prevBarIdx])); ctx.lineTo(xpAbs(d.barIdx), yp(rsi[d.barIdx])); ctx.stroke()
      ctx.font = 'bold 9px JetBrains Mono,monospace'; ctx.fillStyle = '#22C759'; ctx.textAlign = 'center'
      ctx.fillText('Bull', xpAbs(d.barIdx), yp(rsi[d.barIdx]) + 14)
    }
    for (const d of divBear) {
      if (d.barIdx < si || d.barIdx >= ei || d.prevBarIdx < si) continue
      ctx.beginPath(); ctx.strokeStyle = '#FF3B30'
      ctx.moveTo(xpAbs(d.prevBarIdx), yp(rsi[d.prevBarIdx])); ctx.lineTo(xpAbs(d.barIdx), yp(rsi[d.barIdx])); ctx.stroke()
      ctx.font = 'bold 9px JetBrains Mono,monospace'; ctx.fillStyle = '#FF3B30'; ctx.textAlign = 'center'
      ctx.fillText('Bear', xpAbs(d.barIdx), yp(rsi[d.barIdx]) - 6)
    }
  }

  // TP markers (✅ when RSI touches BB bands)
  ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.setLineDash([])
  for (let i = 0; i < n; i++) {
    const abs = i + si
    if (tpUpperBars[abs]) ctx.fillText('✅', xp(i), yp(rsiS[i]) - 8)
    else if (tpLowerBars[abs]) ctx.fillText('✅', xp(i), yp(rsiS[i]) + 14)
  }

  // Crosshair
  if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < n) {
    const hx = xp(hoverIdx), hy = yp(rsiS[hoverIdx])
    const hCol = rsiS[hoverIdx] >= duS[hoverIdx] ? '#22C759' : rsiS[hoverIdx] <= ddS[hoverIdx] ? '#FF3B30' : '#FFEA00'
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3])
    ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, H); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(W, hy); ctx.stroke()
    ctx.setLineDash([])
    ctx.beginPath(); ctx.arc(hx, hy, 4, 0, Math.PI * 2)
    ctx.fillStyle = hCol; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke()
    // Value badge
    ctx.fillStyle = hCol; ctx.fillRect(W - 44, hy - 9, 44, 18)
    ctx.fillStyle = '#0D1117'; ctx.font = 'bold 9px JetBrains Mono,monospace'; ctx.textAlign = 'center'
    ctx.fillText(rsiS[hoverIdx].toFixed(1), W - 22, hy + 3)
  }
}

// ── RSI Bollinger Chart Component ─────────────────────────────────────────
export function RSIBollingerChart({ symbol, syncInterval, visibleRange, onViewportChange }: { symbol: string; syncInterval?: string; visibleRange?: {from:number;to:number}|null; onViewportChange?: (from: number, to: number) => void }) {
  const [localTf, setLocalTf] = useState(TF_OPTIONS[3])
  const tf = syncInterval ? (TF_OPTIONS.find(t => t.interval === syncInterval) ?? localTf) : localTf
  const [candles, setCandles]         = useState<Candle[]>([])
  const [result,  setResult]          = useState<RSIBBResult | null>(null)
  const [status,  setStatus]          = useState<'idle'|'loading'|'error'>('idle')
  const [errorMsg, setErrorMsg]       = useState('')
  const [viewport, setViewport]       = useState<Viewport>({ from: 0, to: 1 })
  const [nextRefresh, setNextRefresh] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [showTrendlines, setShowTrendlines] = useState(true)
  const [showDivergence, setShowDivergence] = useState(false)
  const [bbStdev, setBbStdev] = useState(2)
  const [sigma,   setSigma]   = useState(0.1)
  const lastEmitted = useRef<{from:number;to:number}|null>(null)

  const loadCandles = useCallback(async () => {
    setStatus('loading'); setErrorMsg('')
    try { const c = await fetchCandles(symbol, tf.interval, tf.limit); setCandles(c); setStatus('idle') }
    catch (e) { setErrorMsg((e as Error).message); setStatus('error') }
  }, [symbol, tf])

  useEffect(() => { loadCandles() }, [loadCandles])
  useEffect(() => { const ms = TF_REFRESH_MS[tf.interval]||3600000; setNextRefresh(ms/1000); const t = setInterval(()=>setNextRefresh(x=>x<=1?ms/1000:x-1),1000); return()=>clearInterval(t) }, [tf])
  useEffect(() => { const ms = TF_REFRESH_MS[tf.interval]||3600000; const t = setInterval(()=>loadCandles(),ms); return()=>clearInterval(t) }, [tf, loadCandles])

  useEffect(() => {
    if (candles.length < 30) return
    setResult(calcRSIBollinger(candles, 14, 20, bbStdev, sigma, 4, 3, showTrendlines, showDivergence))
  }, [candles, bbStdev, sigma, showTrendlines, showDivergence])

  // Sync viewport from LW chart range fractions — ignore our own emissions
  useEffect(() => {
    if (!visibleRange) {
      const n = candles.length || 1
      setViewport({ from: Math.max(0, 1 - 150/n), to: 1 })
    } else {
      const eps = 0.001
      if (lastEmitted.current) {
        const eq = Math.abs(visibleRange.from - lastEmitted.current.from) < eps &&
                   Math.abs(visibleRange.to   - lastEmitted.current.to  ) < eps
        lastEmitted.current = null
        if (eq) return
      }
      setViewport({ from: visibleRange.from, to: visibleRange.to })
    }
  }, [visibleRange, candles.length])

  const total     = candles.length
  const viewStart = total > 0 ? Math.max(0, Math.floor(viewport.from * total)) : 0
  const viewEnd   = total > 0 ? Math.min(total, Math.ceil(viewport.to * total)) : 0
  const viewSize  = Math.max(viewEnd - viewStart, 2)

  const handleVPChange = useCallback((from: number, to: number) => {
    lastEmitted.current = { from, to }
    onViewportChange?.(from, to)
  }, [onViewportChange])

  const { ref: canvasRef, hoverIdx, canvasW, onWheel, onMouseDown, onMouseMove, onMouseUp, onLeave } = useInteractiveCanvas(
    (ctx, W, H, hi) => { if (result) drawRSIBollinger(ctx, W, H, result, hi, viewStart, viewEnd, showTrendlines, showDivergence) },
    [result, viewStart, viewEnd, showTrendlines, showDivergence], viewSize, viewport, setViewport, handleVPChange
  )

  const lastRsi = result?.rsi[result.rsi.length - 1] ?? 50
  const lastDu  = result?.disp_up[result.disp_up.length - 1] ?? 55
  const lastDd  = result?.disp_down[result.disp_down.length - 1] ?? 45
  const lastBBU = result?.upper[result.upper.length - 1] ?? 70
  const lastBBL = result?.lower[result.lower.length - 1] ?? 30
  const rsiCol  = lastRsi >= lastDu ? '#22C759' : lastRsi <= lastDd ? '#FF3B30' : '#FFEA00'
  const rsiLbl  = lastRsi >= lastDu ? '▲ Haussier' : lastRsi <= lastDd ? '▼ Baissier' : '◆ Neutre'
  const activeTLs = (result?.trendlines ?? []).filter(tl => !tl.broken).length

  return (
    <div style={{ background: 'var(--tm-bg-secondary)', border: '1px solid #1E2330', borderRadius: 16, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: 'linear-gradient(135deg,#00E5FF,#0099bb)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#0D1117', letterSpacing: '-0.5px' }}>BB</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-primary)' }}>RSI Bollinger</div>
          <div style={{ fontSize: 10, color: '#00E5FFaa' }}>{symbol}</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:5, padding:'2px 8px', background:'rgba(34,199,89,0.1)', border:'1px solid rgba(34,199,89,0.25)', borderRadius:6 }}>
          <div style={{ width:5, height:5, borderRadius:'50%', background:'var(--tm-profit)', animation:'pulse 1.5s ease-in-out infinite' }} />
          <span style={{ fontSize:9, fontWeight:700, color:'var(--tm-profit)', fontFamily:'monospace' }}>LIVE</span>
          <span style={{ fontSize:9, color:'var(--tm-text-muted)', fontFamily:'monospace' }}>{Math.floor(nextRefresh/60)}:{String(nextRefresh%60).padStart(2,'0')}</span>
        </div>
        <div style={{ fontSize:10, fontWeight:700, color:rsiCol, background:`${rsiCol}22`, padding:'2px 10px', borderRadius:20, border:`1px solid ${rsiCol}55` }}>{rsiLbl}</div>
        {showTrendlines && activeTLs > 0 && <div style={{ fontSize:9, fontWeight:600, color:'#ffffff90', background:'rgba(255,255,255,0.07)', padding:'1px 7px', borderRadius:10, border:'1px solid rgba(255,255,255,0.18)' }}>⟋ {activeTLs} TL{activeTLs>1?'s':''}</div>}
        {showDivergence && <div style={{ fontSize:9, fontWeight:600, color:'#22C75990', background:'rgba(34,199,89,0.07)', padding:'1px 7px', borderRadius:10, border:'1px solid rgba(34,199,89,0.18)' }}>↗↘ Div</div>}
        <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
          <span style={{ fontSize:12, fontWeight:700, color:rsiCol, fontFamily:'JetBrains Mono,monospace' }}>RSI: {lastRsi.toFixed(1)}</span>
          <span style={{ fontSize:10, color:'#00E5FF88', fontFamily:'JetBrains Mono,monospace' }}>{lastBBL.toFixed(1)}–{lastBBU.toFixed(1)}</span>
          <button onClick={() => setShowSettings(s => !s)} style={{ background:'var(--tm-bg-tertiary)', border:'1px solid #2A2F3E', borderRadius:7, padding:'4px 9px', cursor:'pointer', fontSize:11, color:showSettings?'#00E5FF':'var(--tm-text-secondary)' }}>⚙</button>
          <button onClick={loadCandles}  style={{ background:'var(--tm-bg-tertiary)', border:'1px solid #2A2F3E', borderRadius:7, padding:'4px 9px', cursor:'pointer', fontSize:11, color:'var(--tm-text-secondary)' }}>↻</button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div style={{ padding:'8px 16px 12px', background:'rgba(0,229,255,0.03)', borderTop:'1px solid #1E2330', display:'flex', gap:16, flexWrap:'wrap', alignItems:'center' }}>
          <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color:'var(--tm-text-secondary)' }}>
            Écart-type σ
            <select value={bbStdev} onChange={e => setBbStdev(+e.target.value)} style={{ background:'var(--tm-bg-tertiary)', border:'1px solid #2A2F3E', borderRadius:6, padding:'2px 6px', color:'var(--tm-text-primary)', fontSize:11 }}>
              {[1,2,3].map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color:'var(--tm-text-secondary)' }}>
            Dispersion
            <select value={sigma} onChange={e => setSigma(+e.target.value)} style={{ background:'var(--tm-bg-tertiary)', border:'1px solid #2A2F3E', borderRadius:6, padding:'2px 6px', color:'var(--tm-text-primary)', fontSize:11 }}>
              {[0.05,0.10,0.15,0.20,0.30].map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color:'var(--tm-text-secondary)', cursor:'pointer' }}>
            <input type="checkbox" checked={showTrendlines} onChange={e => setShowTrendlines(e.target.checked)} />
            Trendlines
          </label>
          <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color:'var(--tm-text-secondary)', cursor:'pointer' }}>
            <input type="checkbox" checked={showDivergence} onChange={e => setShowDivergence(e.target.checked)} />
            Divergences
          </label>
        </div>
      )}

      {/* TF pills (hidden when synced) */}
      {!syncInterval && (
        <div style={{ display:'flex', gap:4, padding:'0 16px 10px', overflowX:'auto', scrollbarWidth:'none' as const }}>
          {TF_OPTIONS.map(t => (
            <button key={t.label} onClick={() => setLocalTf(t)} style={{ padding:'3px 10px', borderRadius:20, fontSize:10, fontWeight:500, cursor:'pointer', border:`1px solid ${t.label===tf.label?'#00E5FF':'var(--tm-border)'}`, background:t.label===tf.label?'rgba(0,229,255,0.15)':'var(--tm-bg-tertiary)', color:t.label===tf.label?'#00E5FF':'var(--tm-text-muted)', whiteSpace:'nowrap' }}>{t.label}</button>
          ))}
        </div>
      )}

      {/* Canvas */}
      <div style={{ padding:'0 16px 16px', position:'relative' }}>
        {status === 'loading' && (
          <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'rgba(8,12,20,0.85)', borderRadius:8, zIndex:30, gap:8 }}>
            <div style={{ width:18, height:18, border:'2px solid #2A2F3E', borderTopColor:'#00E5FF', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} />
            <span style={{ fontSize:11, color:'var(--tm-text-muted)' }}>Chargement {symbol}…</span>
          </div>
        )}
        {status === 'error' && (
          <div style={{ padding:'20px 16px', display:'flex', flexDirection:'column', alignItems:'center', gap:8, textAlign:'center' }}>
            <span style={{ fontSize:22 }}>📡</span>
            <span style={{ fontSize:11, fontWeight:600, color:'var(--tm-loss)' }}>{errorMsg}</span>
          </div>
        )}
        <canvas ref={canvasRef} width={800} height={200}
          onWheel={onWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove}
          onMouseUp={onMouseUp} onMouseLeave={onLeave}
          style={{ width:'100%', height:200, display:'block', borderRadius:8, cursor:'crosshair', userSelect:'none' }} />

        {/* Hover tooltip */}
        {hoverIdx !== null && result && (() => {
          const di = viewStart + hoverIdx
          const candle = candles[di]
          if (!candle || result.rsi[di] == null) return null
          const time = new Date(candle.t)
          const timeStr = time.toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})+' '+time.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})
          const rv = result.rsi[di], bv = result.basis[di], uv = result.upper[di], lv = result.lower[di], duv = result.disp_up[di], ddv = result.disp_down[di]
          const col = rv >= duv ? '#22C759' : rv <= ddv ? '#FF3B30' : '#FFEA00'
          const tail = viewEnd - viewStart
          const xVal = tail > 1 ? (hoverIdx / (tail - 1)) * canvasW : canvasW / 2
          return (
            <div style={{ position:'absolute', top:4, left: xVal > canvasW/2 ? 12 : canvasW - 200, background:'rgba(22,27,34,0.96)', border:'1px solid #2A2F3E', borderRadius:10, padding:'10px 14px', minWidth:185, pointerEvents:'none', boxShadow:'0 8px 24px rgba(0,0,0,0.6)', zIndex:20, backdropFilter:'blur(8px)' }}>
              <div style={{ fontSize:10, color:'var(--tm-text-secondary)', fontWeight:600, marginBottom:6, fontFamily:'JetBrains Mono,monospace' }}>{timeStr}</div>
              {[['RSI',rv,col],['Basis',bv,'#00E5FF'],['BB+',uv,'#00E5FF'],['BB−',lv,'#00E5FF'],['Disp+',duv,'rgba(255,255,255,0.6)'],['Disp−',ddv,'rgba(255,255,255,0.6)']].map(([lbl,val,c])=>(
                <div key={String(lbl)} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:3 }}>
                  <span style={{ fontSize:10, color:'var(--tm-text-muted)' }}>{lbl}</span>
                  <span style={{ fontSize:11, fontWeight:700, color:String(c), fontFamily:'JetBrains Mono,monospace' }}>{(val as number)?.toFixed(1)}</span>
                </div>
              ))}
            </div>
          )
        })()}

        {/* Legend */}
        <div style={{ display:'flex', gap:12, marginTop:8, flexWrap:'wrap' }}>
          {([
            { color:'#22C759',             label:'RSI > Disp+' },
            { color:'#FFEA00',             label:'RSI neutre' },
            { color:'#FF3B30',             label:'RSI < Disp−' },
            { color:'#00E5FF',             label:'Bollinger' },
            { color:'rgba(255,255,255,0.55)', label:'Dispersion' },
            ...(showTrendlines ? [{ color:'#ffffff', label:'⟋ Support' }, { color:'#ff03e2', label:'⟋ Résistance' }] : []),
          ] as {color:string;label:string}[]).map(({ color, label }) => (
            <div key={label} style={{ display:'flex', alignItems:'center', gap:4 }}>
              <div style={{ width:8, height:8, borderRadius:2, background:color }} />
              <span style={{ fontSize:9, color:'var(--tm-text-muted)' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── RSI Calculation ──────────────────────────────────────────────────────────
function calcRSI(candles: Candle[], period = 14): number[] {
  if (candles.length < period + 1) return []
  const closes = candles.map(c => c.c)
  const rsi: number[] = new Array(closes.length).fill(50)
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) avgGain += d; else avgLoss += -d
  }
  avgGain /= period; avgLoss /= period
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return rsi
}

// ── RSI Canvas draw ──────────────────────────────────────────────────────────
function drawRSI(ctx: CanvasRenderingContext2D, W: number, H: number, rsiData: number[], obLevel: number, osLevel: number, hoverIdx: number | null, viewStart?: number, viewEnd?: number) {
  const pad = { top: 8, bottom: 8 }
  const oscH = H - pad.top - pad.bottom
  const startIdx = viewStart !== undefined ? viewStart : Math.max(0, rsiData.length - 150)
  const endIdx   = viewEnd   !== undefined ? Math.min(viewEnd, rsiData.length) : rsiData.length
  const data = rsiData.slice(startIdx, endIdx)
  const n = data.length
  const xp = (i: number) => n > 1 ? (i / (n - 1)) * W : W / 2
  const yp = (v: number) => pad.top + oscH * (1 - v / 100)

  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = resolveCSSColor('--tm-bg', '#0D1117'); ctx.fillRect(0, 0, W, H)

  // OB/OS zones
  ctx.fillStyle = 'rgba(255,59,48,0.06)'; ctx.fillRect(0, yp(100), W, yp(obLevel) - yp(100))
  ctx.fillStyle = 'rgba(34,199,89,0.06)'; ctx.fillRect(0, yp(osLevel), W, yp(0) - yp(osLevel))

  // Grid lines
  ctx.setLineDash([3, 3]); ctx.strokeStyle = resolveCSSColor('--tm-border', '#2A2F3E'); ctx.lineWidth = 0.8
  ;[obLevel, 50, osLevel].forEach(l => { ctx.beginPath(); ctx.moveTo(0, yp(l)); ctx.lineTo(W, yp(l)); ctx.stroke() })
  ctx.setLineDash([])

  // Level labels
  ctx.font = '9px JetBrains Mono,monospace'; ctx.fillStyle = resolveCSSColor('--tm-text-muted', '#555C70'); ctx.textAlign = 'right'
  ctx.fillText(String(obLevel), W - 4, yp(obLevel) + 11)
  ctx.fillText('50', W - 4, yp(50) + 11)
  ctx.fillText(String(osLevel), W - 4, yp(osLevel) - 3)

  if (data.length < 2) return

  // RSI base line (purple)
  ctx.beginPath(); ctx.strokeStyle = '#BF5AF2'; ctx.lineWidth = 2
  data.forEach((v, i) => i === 0 ? ctx.moveTo(xp(i), yp(v)) : ctx.lineTo(xp(i), yp(v)))
  ctx.stroke()

  // Colored segments for OB/OS — fix CSS var strings
  const lossC   = resolveCSSColor('--tm-loss',   '#FF3B30')
  const profitC = resolveCSSColor('--tm-profit', '#22C759')
  for (let i = 1; i < data.length; i++) {
    if (data[i] >= obLevel || data[i - 1] >= obLevel) {
      ctx.beginPath(); ctx.strokeStyle = lossC; ctx.lineWidth = 2.5
      ctx.moveTo(xp(i - 1), yp(data[i - 1])); ctx.lineTo(xp(i), yp(data[i])); ctx.stroke()
    } else if (data[i] <= osLevel || data[i - 1] <= osLevel) {
      ctx.beginPath(); ctx.strokeStyle = profitC; ctx.lineWidth = 2.5
      ctx.moveTo(xp(i - 1), yp(data[i - 1])); ctx.lineTo(xp(i), yp(data[i])); ctx.stroke()
    }
  }

  // Fill area under curve
  ctx.beginPath()
  ctx.moveTo(xp(0), yp(data[0]))
  data.forEach((v, i) => ctx.lineTo(xp(i), yp(v)))
  ctx.lineTo(xp(data.length - 1), H); ctx.lineTo(xp(0), H); ctx.closePath()
  ctx.fillStyle = 'rgba(191,90,242,0.06)'; ctx.fill()

  // Crosshair
  if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < data.length) {
    const hx = xp(hoverIdx), hy = yp(data[hoverIdx])
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3])
    ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, H); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(W, hy); ctx.stroke()
    ctx.setLineDash([])
    ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2)
    ctx.fillStyle = '#BF5AF2'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke()
    ctx.fillStyle = '#BF5AF2'
    ctx.fillRect(W - 52, hy - 9, 52, 18)
    ctx.fillStyle = '#fff'; ctx.font = 'bold 9px JetBrains Mono,monospace'; ctx.textAlign = 'center'
    ctx.fillText(data[hoverIdx].toFixed(1), W - 26, hy + 3)
  }
}

// ── RSI Chart Component ──────────────────────────────────────────────────────
export function RSIChart({ symbol, syncInterval, visibleRange, onViewportChange }: { symbol: string; syncInterval?: string; visibleRange?: {from:number;to:number}|null; onViewportChange?: (from: number, to: number) => void }) {
  const [localTf, setLocalTf] = useState(TF_OPTIONS[3])
  const tf = syncInterval ? (TF_OPTIONS.find(t => t.interval === syncInterval) ?? localTf) : localTf
  const [candles, setCandles] = useState<Candle[]>([])
  const [rsiData, setRsiData] = useState<number[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [viewport, setViewport] = useState<Viewport>({from:0, to:1})
  const [nextRefresh, setNextRefresh] = useState(0)
  const lastEmitted = useRef<{from:number;to:number}|null>(null)
  const obLevel = 70, osLevel = 30

  const loadCandles = useCallback(async () => {
    setStatus('loading'); setErrorMsg('')
    try { const c = await fetchCandles(symbol, tf.interval, tf.limit); setCandles(c); setStatus('idle') }
    catch (e) { setErrorMsg((e as Error).message); setStatus('error') }
  }, [symbol, tf])

  useEffect(() => { loadCandles() }, [loadCandles])
  useEffect(() => { const ms = TF_REFRESH_MS[tf.interval] || 3600000; setNextRefresh(ms / 1000); const t = setInterval(() => setNextRefresh(x => x <= 1 ? ms / 1000 : x - 1), 1000); return () => clearInterval(t) }, [tf])
  useEffect(() => { const ms = TF_REFRESH_MS[tf.interval] || 3600000; const t = setInterval(() => loadCandles(), ms); return () => clearInterval(t) }, [tf, loadCandles])

  useEffect(() => {
    if (candles.length < 20) return
    setRsiData(calcRSI(candles, 14))
  }, [candles])

  // Sync viewport from LW chart range fractions — ignore our own emissions
  useEffect(() => {
    if (!visibleRange) {
      const n = candles.length || 1
      setViewport({ from: Math.max(0, 1 - 150/n), to: 1 })
    } else {
      const eps = 0.001
      if (lastEmitted.current) {
        const eq = Math.abs(visibleRange.from - lastEmitted.current.from) < eps &&
                   Math.abs(visibleRange.to   - lastEmitted.current.to  ) < eps
        lastEmitted.current = null
        if (eq) return
      }
      setViewport({ from: visibleRange.from, to: visibleRange.to })
    }
  }, [visibleRange, candles.length])

  const rsiTotal     = candles.length
  const rsiViewStart = rsiTotal > 0 ? Math.max(0, Math.floor(viewport.from * rsiTotal)) : 0
  const rsiViewEnd   = rsiTotal > 0 ? Math.min(rsiTotal, Math.ceil(viewport.to   * rsiTotal)) : 0
  const rsiViewSize  = Math.max(rsiViewEnd - rsiViewStart, 2)

  const lastRsi = rsiData.length > 0 ? rsiData[rsiData.length - 1] : 50
  const badge = lastRsi >= obLevel ? { label: 'Suracheté', color: 'var(--tm-loss)' }
    : lastRsi <= osLevel ? { label: 'Survendu', color: 'var(--tm-profit)' }
    : lastRsi >= 60 ? { label: 'Fort', color: 'var(--tm-warning)' }
    : lastRsi <= 40 ? { label: 'Faible', color: 'var(--tm-text-secondary)' }
    : { label: 'Neutre', color: 'var(--tm-text-secondary)' }

  const handleVPChange = useCallback((from: number, to: number) => {
    lastEmitted.current = { from, to }
    onViewportChange?.(from, to)
  }, [onViewportChange])

  const { ref: canvasRef, hoverIdx, canvasW, onWheel, onMouseDown, onMouseMove, onMouseUp, onLeave } = useInteractiveCanvas(
    (ctx, W, H, hi) => { drawRSI(ctx, W, H, rsiData, obLevel, osLevel, hi, rsiViewStart, rsiViewEnd) },
    [rsiData, rsiViewStart, rsiViewEnd], rsiViewSize, viewport, setViewport, handleVPChange
  )

  return (
    <div style={{ background: 'var(--tm-bg-secondary)', border: '1px solid #1E2330', borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: 'linear-gradient(135deg,#BF5AF2,#BF5AF2aa)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: 'white' }}>R</div>
        <div><div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-primary)' }}>RSI (14)</div><div style={{ fontSize: 10, color: '#BF5AF2aa' }}>{symbol}</div></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 8px', background: `rgba(${resolveCSSColor('var(--tm-profit-rgb', '34,199,89')},0.1)`, border: '1px solid rgba(var(--tm-profit-rgb,34,199,89),0.25)', borderRadius: 6 }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--tm-profit)', animation: 'pulse 1.5s ease-in-out infinite' }} /><span style={{ fontSize: 9, fontWeight: 700, color: 'var(--tm-profit)', fontFamily: 'monospace' }}>LIVE</span>
          <span style={{ fontSize: 9, color: 'var(--tm-text-muted)', fontFamily: 'monospace' }}>{Math.floor(nextRefresh / 60)}:{String(nextRefresh % 60).padStart(2, '0')}</span>
        </div>
        {badge && <div style={{ fontSize: 10, fontWeight: 700, color: badge.color, background: `${badge.color}20`, padding: '2px 10px', borderRadius: 20, border: `1px solid ${badge.color}50` }}>{badge.label}</div>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#BF5AF2', fontFamily: 'JetBrains Mono,monospace' }}>RSI: {lastRsi.toFixed(1)}</span>
          <button onClick={loadCandles} style={{ background: 'var(--tm-bg-tertiary)', border: '1px solid #2A2F3E', borderRadius: 7, padding: '4px 9px', cursor: 'pointer', fontSize: 11, color: 'var(--tm-text-secondary)' }}>↻</button>
        </div>
      </div>
      {!syncInterval && <div style={{ display: 'flex', gap: 4, padding: '0 16px 10px', overflowX: 'auto', scrollbarWidth: 'none' as const }}>
        {TF_OPTIONS.map(t => <button key={t.label} onClick={() => setLocalTf(t)} style={{ padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 500, cursor: 'pointer', border: `1px solid ${t.label === tf.label ? '#BF5AF2' : 'var(--tm-border)'}`, background: t.label === tf.label ? 'rgba(191,90,242,0.15)' : 'var(--tm-bg-tertiary)', color: t.label === tf.label ? '#BF5AF2' : 'var(--tm-text-muted)', whiteSpace: 'nowrap' }}>{t.label}</button>)}
      </div>}
      <div style={{ padding: '0 16px 16px', position: 'relative' }}>
        {status === 'loading' && <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(8,12,20,0.85)', borderRadius: 8, zIndex: 30, gap: 8 }}>
          <div style={{ width: 18, height: 18, border: '2px solid #2A2F3E', borderTopColor: '#BF5AF2', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /><span style={{ fontSize: 11, color: 'var(--tm-text-muted)' }}>Chargement {symbol}...</span>
        </div>}
        {status === 'error' && <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
          <span style={{ fontSize: 22 }}>📡</span><span style={{ fontSize: 11, fontWeight: 600, color: 'var(--tm-loss)' }}>{errorMsg}</span>
        </div>}
        <canvas ref={canvasRef} width={800} height={180}
          onWheel={onWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove}
          onMouseUp={onMouseUp} onMouseLeave={onLeave}
          style={{ width: '100%', height: 180, display: 'block', borderRadius: 8, cursor: 'crosshair', userSelect: 'none' }} />
        {hoverIdx !== null && rsiData.length > 0 && (() => {
          const dataIdx = rsiViewStart + hoverIdx
          const candle = candles[dataIdx]
          if (!candle) return null
          const time = new Date(candle.t)
          const timeStr = time.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) + ' ' + time.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
          const val = rsiData[dataIdx]
          const tail = rsiViewEnd - rsiViewStart
          const xp = tail > 1 ? (hoverIdx / (tail - 1)) * canvasW : canvasW / 2
          const left = xp > canvasW / 2 ? 12 : canvasW - 180
          return (
            <div style={{ position: 'absolute', top: 4, left, background: 'rgba(22,27,34,0.96)', border: '1px solid #2A2F3E', borderRadius: 10, padding: '10px 14px', minWidth: 150, pointerEvents: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.6)', zIndex: 20, backdropFilter: 'blur(8px)' }}>
              <div style={{ fontSize: 10, color: 'var(--tm-text-secondary)', fontWeight: 600, marginBottom: 6, fontFamily: 'JetBrains Mono,monospace' }}>{timeStr}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--tm-text-muted)' }}>RSI</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: val >= obLevel ? 'var(--tm-loss)' : val <= osLevel ? 'var(--tm-profit)' : '#BF5AF2', fontFamily: 'JetBrains Mono,monospace' }}>{val?.toFixed(1)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #2A2F3E', paddingTop: 4, marginTop: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--tm-text-muted)' }}>Close</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--tm-text-primary)', fontFamily: 'JetBrains Mono,monospace' }}>{candle.c.toFixed(candle.c < 10 ? 4 : 2)}</span>
              </div>
            </div>
          )
        })()}
        <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          {[{ color: '#BF5AF2', label: 'RSI (14)' }, { color: 'var(--tm-loss)', label: `OB: ${obLevel}` }, { color: 'var(--tm-profit)', label: `OS: ${osLevel}` }].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 8, height: 8, borderRadius: 2, background: color }} /><span style={{ fontSize: 9, color: 'var(--tm-text-muted)' }}>{label}</span></div>
          ))}
        </div>
      </div>
    </div>
  )
}
