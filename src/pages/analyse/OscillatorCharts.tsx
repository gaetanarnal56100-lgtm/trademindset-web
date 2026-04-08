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

async function fetchCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
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
    const crossUp=wt1[i-1]<=wt2[i-1]&&wt1[i]>wt2[i], crossDn=wt1[i-1]>=wt2[i-1]&&wt1[i]<wt2[i]
    if (crossUp&&wt1[i]<=osLevel) signals[i]='smartBull'
    else if (crossUp) signals[i]='bull'
    else if (crossDn&&wt1[i]>=obLevel) signals[i]='smartBear'
    else if (crossDn) signals[i]='bear'
  }
  return { wt1, wt2, signals }
}

// ── VMC Oscillator ─────────────────────────────────────────────────────────
interface VMCResult { sig:number[]; sigSignal:number[]; momentum:number[]; bullConfirm:boolean; bearConfirm:boolean; ribbonBull:boolean; ribbonBear:boolean; compression:boolean; status:string; emas:number[][] }
function calcVMCOscillator(candles: Candle[], preset:'scalping'|'swing'|'position'='swing'): VMCResult {
  const EMPTY:VMCResult={sig:[],sigSignal:[],momentum:[],bullConfirm:false,bearConfirm:false,ribbonBull:false,ribbonBear:false,compression:false,status:'NEUTRAL',emas:[]}
  if (candles.length<60) return EMPTY
  const close=candles.map(c=>c.c), high=candles.map(c=>c.h), low=candles.map(c=>c.l), vol=candles.map(c=>c.v)
  const thresholds=preset==='scalping'?[40,-30]:preset==='swing'?[35,-25]:[30,-20]
  const hlc3=candles.map(c=>(c.h+c.l+c.c)/3)
  const rsiLen=14
  const gains=hlc3.map((v,i)=>i===0?0:Math.max(v-hlc3[i-1],0))
  const losses=hlc3.map((v,i)=>i===0?0:Math.max(hlc3[i-1]-v,0))
  const agArr=emaArr(gains,rsiLen),alArr=emaArr(losses,rsiLen)
  const rsi=agArr.map((g,i)=>alArr[i]===0?100:100-100/(1+g/alArr[i]))
  const n=candles.length, tp=candles.map(c=>(c.h+c.l+c.c)/3)
  const pmf=new Array(n).fill(0),nmf=new Array(n).fill(0)
  for(let i=1;i<n;i++){const raw=tp[i]*vol[i];if(tp[i]>tp[i-1])pmf[i]=raw;else if(tp[i]<tp[i-1])nmf[i]=raw}
  const sPMF=rollingSum(pmf,7),sNMF=rollingSum(nmf,7)
  const mfi=sPMF.map((p,i)=>{const d=p+sNMF[i];return d===0?50:p/d*100})
  const computeStoch=(src:number[],len:number)=>{const out=src.map((v,i)=>{const win=src.slice(Math.max(0,i-len+1),i+1);const mn=Math.min(...win),mx=Math.max(...win);return mx-mn===0?50:(v-mn)/(mx-mn)*100});return emaArr(out,2)}
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
  return{sig,sigSignal,momentum,bullConfirm,bearConfirm,ribbonBull,ribbonBear,compression,status,emas}
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
function drawOscillator(ctx:CanvasRenderingContext2D,W:number,H:number,main:number[],signal:number[],histogram:number[],obLevel:number,osLevel:number,mainColor:string,signalColor:string,histBullColor:string,histBearColor:string,dots?:{i:number;type:string}[],emas?:number[][],hoverIdx?:number|null,viewStart?:number,viewEnd?:number) {
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

  // Signal & Main lines
  ctx.beginPath();ctx.strokeStyle=resolvedSignal;ctx.lineWidth=1.2;s.forEach((v,i)=>i===0?ctx.moveTo(xp(i),yp(v)):ctx.lineTo(xp(i),yp(v)));ctx.stroke()
  ctx.beginPath();ctx.strokeStyle=mainColor;ctx.lineWidth=2;m.forEach((v,i)=>i===0?ctx.moveTo(xp(i),yp(v)):ctx.lineTo(xp(i),yp(v)));ctx.stroke()

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
  viewport: Viewport, setViewport: (vp:Viewport) => void
) {
  const ref    = useRef<HTMLCanvasElement>(null)
  const [hoverIdx, setHoverIdx] = useState<number|null>(null)
  const [canvasW,  setCanvasW]  = useState(800)
  const dragRef = useRef<{x:number; vp:Viewport}|null>(null)
  const vpRef   = useRef<Viewport>(viewport)
  vpRef.current = viewport

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
    setViewport({ from: newFrom, to: newFrom + newSpan })
  }, [setViewport])

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
      setViewport({ from: newFrom, to: newFrom + span })
    } else {
      const c = ref.current; if (!c || viewSize < 2) return
      const rect = c.getBoundingClientRect()
      const x = e.clientX - rect.left
      const idx = Math.round((x / rect.width) * (viewSize - 1))
      setHoverIdx(Math.max(0, Math.min(viewSize - 1, idx)))
    }
  }, [setViewport, viewSize])

  const onMouseUp  = useCallback(() => { dragRef.current = null }, [])
  const onLeave    = useCallback(() => { dragRef.current = null; setHoverIdx(null) }, [])
  return { ref, hoverIdx, canvasW, onWheel, onMouseDown, onMouseMove, onMouseUp, onLeave }
}

// ── WaveTrend Chart ────────────────────────────────────────────────────────
function resolveCSSColor(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback
}

export function WaveTrendChart({ symbol, syncInterval, visibleRange }: { symbol: string; syncInterval?: string; visibleRange?: {from:number;to:number}|null }) {
  const [localTf, setLocalTf] = useState(TF_OPTIONS[3])
  const tf = syncInterval ? (TF_OPTIONS.find(t => t.interval === syncInterval) ?? localTf) : localTf
  const [candles, setCandles] = useState<Candle[]>([])
  const [result, setResult] = useState<WTResult|null>(null)
  const [status, setStatus] = useState<'idle'|'loading'|'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [nextRefresh, setNextRefresh] = useState(0)
  const [viewport, setViewport] = useState<Viewport>({from:0, to:1})
  const obLevel=53, osLevel=-53

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
      setViewport({ from: visibleRange.from, to: visibleRange.to })
    }
  }, [visibleRange, candles.length])

  const total     = candles.length
  const viewStart = total > 0 ? Math.max(0, Math.floor(viewport.from * total)) : 0
  const viewEnd   = total > 0 ? Math.min(total, Math.ceil(viewport.to   * total)) : 0
  const viewSize  = Math.max(viewEnd - viewStart, 2)

  const dots = result ? result.signals.flatMap((s,i)=>s?[{i,type:s}]:[]) : []
  const histogram = result ? result.wt1.map((v,i)=>v-result.wt2[i]) : []

  const { ref: canvasRef, hoverIdx, canvasW, onWheel, onMouseDown, onMouseMove, onMouseUp, onLeave } = useInteractiveCanvas(
    (ctx, W, H, hi) => {
      if(!result||result.wt1.length<2) return
      drawOscillator(ctx,W,H,result.wt1,result.wt2,histogram,obLevel,osLevel,'#37D7FF','#F59714',`rgba(34,199,89,0.5)`,`rgba(255,59,48,0.5)`,dots,undefined,hi,viewStart,viewEnd)
    }, [result, viewStart, viewEnd], viewSize, viewport, setViewport
  )

  const wt1Last = result?.wt1[result.wt1.length-1]??0, wt2Last = result?.wt2[result.wt2.length-1]??0
  const badge = !result?null:wt1Last>obLevel?{label:'Overbought',color:'var(--tm-loss)'}:wt1Last<osLevel?{label:'Oversold',color:'var(--tm-profit)'}:result.signals[result.signals.length-1]==='smartBull'?{label:'Smart Bullish',color:'var(--tm-accent)'}:result.signals[result.signals.length-1]==='bull'?{label:'Bullish Reversal',color:'var(--tm-profit)'}:result.signals[result.signals.length-1]==='smartBear'?{label:'Smart Bearish',color:'var(--tm-loss)'}:result.signals[result.signals.length-1]==='bear'?{label:'Bearish Reversal',color:'var(--tm-loss)'}:{label:'Neutral',color:'var(--tm-text-secondary)'}

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
export function VMCOscillatorChart({ symbol, syncInterval, visibleRange }: { symbol: string; syncInterval?: string; visibleRange?: {from:number;to:number}|null }) {
  const [localTf, setLocalTf] = useState(TF_OPTIONS[3])
  const tf = syncInterval ? (TF_OPTIONS.find(t => t.interval === syncInterval) ?? localTf) : localTf
  const [candles, setCandles] = useState<Candle[]>([])
  const [result, setResult] = useState<VMCResult|null>(null)
  const [status, setStatus] = useState<'idle'|'loading'|'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [viewport, setViewport] = useState<Viewport>({from:0, to:1})
  const obLevel=35, osLevel=-25

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
    const r = calcVMCOscillator(candles, 'swing'); setResult(r)
    const sig = r.sig[r.sig.length-1]??0, mom = r.momentum[r.momentum.length-1]??0
    signalService.checkVMC(symbol, tf.label, r.status, sig, mom, r.compression)
  }, [candles, symbol, tf.label])

  // Sync viewport from LW chart range fractions
  useEffect(() => {
    if (!visibleRange) {
      const n = candles.length || 1
      setViewport({ from: Math.max(0, 1 - 150/n), to: 1 })
    } else {
      setViewport({ from: visibleRange.from, to: visibleRange.to })
    }
  }, [visibleRange, candles.length])

  const vmcTotal     = candles.length
  const vmcViewStart = vmcTotal > 0 ? Math.max(0, Math.floor(viewport.from * vmcTotal)) : 0
  const vmcViewEnd   = vmcTotal > 0 ? Math.min(vmcTotal, Math.ceil(viewport.to   * vmcTotal)) : 0
  const vmcViewSize  = Math.max(vmcViewEnd - vmcViewStart, 2)

  const lastSig=result?.sig[result.sig.length-1]??0, lastMom=result?.momentum[result.momentum.length-1]??0
  const statusColor=result?.status==='BUY'?'var(--tm-profit)':result?.status==='SELL'?'var(--tm-loss)':result?.status==='OVERBOUGHT'?'var(--tm-loss)':result?.status==='OVERSOLD'?'var(--tm-profit)':'var(--tm-text-secondary)'

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

  const { ref: canvasRef, hoverIdx, canvasW, onWheel, onMouseDown, onMouseMove, onMouseUp, onLeave } = useInteractiveCanvas(
    (ctx, W, H, hi) => {
      if(!result||result.sig.length<2) return
      drawOscillator(ctx,W,H,result.sig,result.sigSignal,result.momentum,obLevel,osLevel,'#37D7FF','#F59714',`rgba(34,199,89,0.55)`,`rgba(255,59,48,0.55)`,vmcDots,result.emas,hi,vmcViewStart,vmcViewEnd)
    }, [result, vmcDots, vmcViewStart, vmcViewEnd], vmcViewSize, viewport, setViewport
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
        <div style={{marginLeft:'auto',display:'flex',gap:10,alignItems:'center'}}>
          {result&&<div style={{display:'flex',gap:10,fontSize:11,fontFamily:'monospace'}}><span style={{color:'#37D7FF'}}>sig: {lastSig.toFixed(1)}</span><span style={{color:lastMom>=0?'var(--tm-profit)':'var(--tm-loss)'}}>mom: {lastMom>=0?'+':''}{lastMom.toFixed(1)}</span></div>}
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
          {[{color:'#37D7FF',label:'VMC Sig'},{color:'var(--tm-warning)',label:'Signal'},{color:'var(--tm-profit)',label:'Mom +'},{color:'var(--tm-loss)',label:'Mom −'},{color:'var(--tm-warning)',label:`OB:${obLevel}`},{color:'var(--tm-profit)',label:`OS:${osLevel}`}].map(({color,label})=>(
            <div key={label} style={{display:'flex',alignItems:'center',gap:4}}><div style={{width:8,height:8,borderRadius:2,background:color}}/><span style={{fontSize:9,color:'var(--tm-text-muted)'}}>{label}</span></div>
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
export function RSIChart({ symbol, syncInterval, visibleRange }: { symbol: string; syncInterval?: string; visibleRange?: {from:number;to:number}|null }) {
  const [localTf, setLocalTf] = useState(TF_OPTIONS[3])
  const tf = syncInterval ? (TF_OPTIONS.find(t => t.interval === syncInterval) ?? localTf) : localTf
  const [candles, setCandles] = useState<Candle[]>([])
  const [rsiData, setRsiData] = useState<number[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [viewport, setViewport] = useState<Viewport>({from:0, to:1})
  const [nextRefresh, setNextRefresh] = useState(0)
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

  // Sync viewport from LW chart range fractions
  useEffect(() => {
    if (!visibleRange) {
      const n = candles.length || 1
      setViewport({ from: Math.max(0, 1 - 150/n), to: 1 })
    } else {
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

  const { ref: canvasRef, hoverIdx, canvasW, onWheel, onMouseDown, onMouseMove, onMouseUp, onLeave } = useInteractiveCanvas(
    (ctx, W, H, hi) => { drawRSI(ctx, W, H, rsiData, obLevel, osLevel, hi, rsiViewStart, rsiViewEnd) },
    [rsiData, rsiViewStart, rsiViewEnd], rsiViewSize, viewport, setViewport
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
