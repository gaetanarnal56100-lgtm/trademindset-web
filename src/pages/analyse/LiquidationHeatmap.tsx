// LiquidationHeatmap.tsx — v4 finale
// Algorithme : Volume Profile + Liquidations Swift + Depth Profile
// Variation inter-colonnes validée à 0.10 (vs 0.003 avant)

import { useState, useEffect, useRef, useCallback } from 'react'

interface Kline {
  openTime: Date; open: number; high: number
  low: number; close: number; volume: number
}
interface HeatmapData {
  pMin: number; pMax: number; step: number; N: number
  cols: Float32Array[]; candles: Kline[]
}
interface Tip { price: number; vol: number; ts: Date; x: number; y: number }

const BUCKETS  = 120
const AXIS_W   = 58
const CANVAS_H = 340

const PERIODS = [
  { v:'M15',  label:'M15',  interval:'1m',  limit:15  },
  { v:'H1',   label:'H1',   interval:'1m',  limit:60  },
  { v:'H4',   label:'H4',   interval:'5m',  limit:48  },
  { v:'12h',  label:'12h',  interval:'15m', limit:48  },
  { v:'24h',  label:'24h',  interval:'30m', limit:48  },
  { v:'3j',   label:'3j',   interval:'2h',  limit:36  },
  { v:'1sem', label:'1sem', interval:'4h',  limit:42  },
  { v:'2sem', label:'2sem', interval:'8h',  limit:42  },
  { v:'1m',   label:'1m',   interval:'1d',  limit:30  },
]

// ── Palette Coinglass exacte ───────────────────────────────────────────────

function cgRGB(i: number): [number,number,number] {
  i = Math.max(0, Math.min(1,i))
  if (i<0.05) return [38,13,64]
  if (i<0.15){const t=(i-.05)/.10;return[Math.round((.15+t*.15)*255),Math.round((.05+t*.05)*255),Math.round((.25+t*.15)*255)]}
  if (i<0.30){const t=(i-.15)/.15;return[Math.round((.30-t*.20)*255),Math.round((.10+t*.35)*255),Math.round((.40+t*.20)*255)]}
  if (i<0.50){const t=(i-.30)/.20;return[Math.round((.10-t*.05)*255),Math.round((.45+t*.30)*255),Math.round((.60-t*.25)*255)]}
  if (i<0.70){const t=(i-.50)/.20;return[Math.round((.05+t*.55)*255),Math.round((.75+t*.15)*255),Math.round((.35-t*.25)*255)]}
  if (i<0.85){const t=(i-.70)/.15;return[Math.round((.60+t*.35)*255),Math.round((.90+t*.10)*255),Math.round((.10-t*.05)*255)]}
  const t=(i-.85)/.15;return[Math.round((.95+t*.05)*255),255,Math.round((.05+t*.45)*255)]
}

// ── Fetch ──────────────────────────────────────────────────────────────────

async function fetchKlines(sym:string, interval:string, limit:number):Promise<Kline[]> {
  for(const base of['https://fapi.binance.com/fapi/v1','https://api.binance.com/api/v3']){
    try{
      const r=await fetch(`${base}/klines?symbol=${sym}&interval=${interval}&limit=${limit}`)
      if(!r.ok)continue
      const raw:unknown[][]=await r.json()
      const k=raw.map(a=>({openTime:new Date(Number(a[0])),open:parseFloat(a[1] as string),high:parseFloat(a[2] as string),low:parseFloat(a[3] as string),close:parseFloat(a[4] as string),volume:parseFloat(a[5] as string)}))
      if(k.length)return k
    }catch{continue}
  }
  throw new Error('Binance unavailable')
}

async function fetchDepth(sym:string, pMin:number, step:number):Promise<Float32Array> {
  const profile=new Float32Array(BUCKETS)
  for(const url of[`https://fapi.binance.com/fapi/v1/depth?symbol=${sym}&limit=1000`,`https://api.binance.com/api/v3/depth?symbol=${sym}&limit=1000`]){
    try{
      const r=await fetch(url)
      if(!r.ok)continue
      const d=await r.json() as {bids:[string,string][];asks:[string,string][]}
      for(const [ps,qs] of [...(d.bids||[]),...(d.asks||[])]){
        const p=parseFloat(ps),q=parseFloat(qs)
        const idx=Math.floor((p-pMin)/step)
        if(idx>=0&&idx<BUCKETS)profile[idx]+=q*p
      }
      const mx=Math.max(...profile)
      if(mx>0)for(let i=0;i<BUCKETS;i++)profile[i]/=mx
      return profile
    }catch{continue}
  }
  return profile
}

// ── Algorithm ─────────────────────────────────────────────────────────────
//
// Phase 1 : Volume Profile — distribue le volume de chaque bougie
//           sur ses buckets prix → remplit visuellement le chart
// Phase 2 : Liquidations (algo Swift original) — overlay des niveaux lev
// Phase 3 : Depth profile — order book réel sur la fin du chart
// Phase 4 : Normalisation GLOBALE + pow(0.45) — identique Swift

function spreadGaussian(arr:Float32Array, center:number, vol:number, sigma:number) {
  const r=Math.floor(sigma*2.5)
  for(let o=-r;o<=r;o++){
    const idx=center+o
    if(idx<0||idx>=arr.length)continue
    arr[idx]+=vol*Math.exp(-0.5*(o/sigma)**2)
  }
}

function wasSwept(price:number, candles:Kline[], from:number, to:number):boolean {
  for(let i=Math.max(0,from);i<=Math.min(candles.length-1,to);i++)
    if(price>=candles[i].low&&price<=candles[i].high)return true
  return false
}

function buildHeatmap(candles:Kline[], depth:Float32Array):HeatmapData {
  const rawMin=Math.min(...candles.map(c=>c.low))
  const rawMax=Math.max(...candles.map(c=>c.high))
  const pad=(rawMax-rawMin)*0.20    // 20% — identique Swift
  const pMin=rawMin-pad
  const pMax=rawMax+pad
  const step=(pMax-pMin)/BUCKETS
  const N=candles.length

  const leverages=[5,10,25,50,100]
  const levW:Record<number,number>={5:0.5,10:1.0,25:2.5,50:2.0,100:0.8}

  const matrix:Float32Array[]=Array.from({length:N},()=>new Float32Array(BUCKETS))

  // Phase 1 — Volume Profile
  for(let ci=0;ci<N;ci++){
    const c=candles[ci]
    const vol=c.volume*c.close
    const lowB =Math.max(0,Math.floor((c.low -pMin)/step))
    const highB=Math.min(BUCKETS-1,Math.floor((c.high-pMin)/step))
    const closeB=Math.min(BUCKETS-1,Math.max(0,Math.floor((c.close-pMin)/step)))
    for(let b=lowB;b<=highB;b++){
      const dist=Math.abs(b-closeB)
      const rng=Math.max(highB-lowB,1)
      const w=1.0-(dist/(rng+1))*0.5
      matrix[ci][b]+=vol*w*0.3
    }
  }

  // Phase 2 — Liquidations (Swift exact)
  for(let si=0;si<N;si++){
    const src=candles[si]
    for(const lev of leverages){
      const w=levW[lev]
      const vol=src.volume*w
      const ll=src.close*(1-1/lev)
      const sl=src.close*(1+1/lev)
      for(let di=si;di<N;di++){
        const decay=Math.exp(-(di-si)*0.005)
        const lb=Math.floor((ll-pMin)/step)
        const sb=Math.floor((sl-pMin)/step)
        if(lb>=0&&lb<BUCKETS){
          const bp=pMin+lb*step+step/2
          if(!wasSwept(bp,candles,si+1,di))
            spreadGaussian(matrix[di],lb,vol*decay,1.2)
        }
        if(sb>=0&&sb<BUCKETS){
          const bp=pMin+sb*step+step/2
          if(!wasSwept(bp,candles,si+1,di))
            spreadGaussian(matrix[di],sb,vol*decay,1.2)
        }
      }
    }
  }

  // Phase 3 — Depth profile (Swift exact)
  if(N>0){
    const lastVol=candles[N-1].volume
    const depStart=Math.max(0,N-Math.floor(N/4))
    for(let col=depStart;col<N;col++){
      const fade=(col-depStart)/Math.max(1,N-depStart)
      for(let b=0;b<BUCKETS;b++)
        matrix[col][b]+=depth[b]*lastVol*0.5*fade
    }
  }

  // Phase 4 — Normalisation GLOBALE (Swift exact)
  let globalMax=0
  for(let col=0;col<N;col++){
    const m=Math.max(...matrix[col])
    if(m>globalMax)globalMax=m
  }
  const cols:Float32Array[]=matrix.map(col=>
    globalMax>0?Float32Array.from(col,v=>Math.pow(v/globalMax,0.45)):col
  )

  return{pMin,pMax,step,N,cols,candles}
}

// ── Draw ───────────────────────────────────────────────────────────────────

function draw(canvas:HTMLCanvasElement,data:HeatmapData,price:number,tip:Tip|null){
  const ctx=canvas.getContext('2d')!
  const W=canvas.width,H=canvas.height
  if(!data.cols.length)return

  const chartW=W-AXIS_W
  const colW=chartW/data.N
  const rowH=H/BUCKETS
  const range=data.pMax-data.pMin

  ctx.fillStyle='#0C0516'
  ctx.fillRect(0,0,W,H)

  // Heatmap
  for(let ci=0;ci<data.N;ci++){
    const x0=ci*colW
    const col=data.cols[ci]
    for(let b=0;b<BUCKETS;b++){
      const v=col[b]
      if(v<0.02)continue
      const[r,g,bb]=cgRGB(v)
      ctx.fillStyle=`rgb(${r},${g},${bb})`
      ctx.fillRect(x0+0.2,H-(b+1)*rowH+0.2,colW-0.2,rowH+0.2)
    }
  }

  // Candles
  for(let ci=0;ci<data.N;ci++){
    const c=data.candles[ci]
    const cx=ci*colW+colW/2
    const bull=c.close>=c.open
    const hY=H*(1-(c.high-data.pMin)/range)
    const lY=H*(1-(c.low-data.pMin)/range)
    const oY=H*(1-(c.open-data.pMin)/range)
    const cY=H*(1-(c.close-data.pMin)/range)
    const color=bull?'rgba(0,215,130,0.9)':'rgba(232,48,68,0.9)'
    ctx.strokeStyle=color;ctx.lineWidth=0.8
    ctx.beginPath();ctx.moveTo(cx,hY);ctx.lineTo(cx,lY);ctx.stroke()
    ctx.fillStyle=color
    ctx.fillRect(cx-Math.max(colW*.6,1.5)/2,Math.min(oY,cY),Math.max(colW*.6,1.5),Math.max(Math.abs(cY-oY),1.2))
  }

  // Prix courant
  if(price>0&&price>=data.pMin&&price<=data.pMax){
    const py=H*(1-(price-data.pMin)/range)
    ctx.save();ctx.setLineDash([5,3])
    ctx.strokeStyle='rgba(255,255,255,0.55)';ctx.lineWidth=0.9
    ctx.beginPath();ctx.moveTo(0,py);ctx.lineTo(chartW,py);ctx.stroke()
    ctx.restore()
    const label=fmtP(price)
    const bw=Math.max(label.length*7+14,62)
    ctx.fillStyle='#00E5FF'
    rr(ctx,chartW+1,py-10,bw,20,4);ctx.fill()
    ctx.fillStyle='#071018';ctx.font='bold 10px monospace'
    ctx.textAlign='center';ctx.textBaseline='middle'
    ctx.fillText(label,chartW+1+bw/2,py)
  }

  // Axe prix
  ctx.font='9px monospace';ctx.fillStyle='rgba(255,255,255,0.5)'
  ctx.textAlign='right';ctx.textBaseline='middle'
  for(let i=0;i<=7;i++){
    const p=data.pMax-(range*i)/7
    ctx.fillText(fmtC(p),W-3,(i/7)*H)
  }

  // Crosshair + tooltip
  if(tip){
    ctx.save();ctx.setLineDash([3,3])
    ctx.strokeStyle='rgba(255,255,255,0.3)';ctx.lineWidth=0.5
    ctx.beginPath();ctx.moveTo(0,tip.y);ctx.lineTo(chartW,tip.y);ctx.stroke()
    ctx.beginPath();ctx.moveTo(tip.x,0);ctx.lineTo(tip.x,H);ctx.stroke()
    ctx.restore()
    ctx.fillStyle='white'
    ctx.beginPath();ctx.arc(tip.x,tip.y,3.5,0,Math.PI*2);ctx.fill()
    const TW=182,TH=80
    const tx=tip.x>chartW*.55?tip.x-TW-10:tip.x+10
    const ty=tip.y>H*.55?tip.y-TH-10:tip.y+10
    ctx.fillStyle='rgba(4,2,14,0.93)'
    rr(ctx,tx,ty,TW,TH,9);ctx.fill()
    ctx.strokeStyle='rgba(255,255,255,0.1)';ctx.lineWidth=0.5;ctx.stroke()
    ctx.font='10px monospace';ctx.fillStyle='white'
    ctx.textAlign='left';ctx.textBaseline='top'
    ctx.fillText(fmtTS(tip.ts),tx+10,ty+9)
    for(const[idx,label,value] of[[0,'Prix',fmtP(tip.price)],[1,'Liq. Leverage',fmtV(tip.vol)]] as [number,string,string][]){
      const ly=ty+28+idx*22
      ctx.fillStyle='#FFD700';ctx.beginPath();ctx.arc(tx+14,ly+4,3.5,0,Math.PI*2);ctx.fill()
      ctx.fillStyle='rgba(255,255,255,0.45)';ctx.font='9px monospace';ctx.textAlign='left'
      ctx.fillText(label,tx+22,ly)
      ctx.fillStyle='white';ctx.font='bold 10px monospace';ctx.textAlign='right'
      ctx.fillText(value,tx+TW-9,ly)
    }
  }
}

function rr(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){
  ctx.beginPath()
  ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r)
  ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h)
  ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r)
  ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y)
  ctx.closePath()
}

const fmtP=(p:number)=>p>=10000?`$${p.toFixed(0)}`:p>=1000?`$${p.toFixed(1)}`:`$${p.toFixed(3)}`
const fmtC=(p:number)=>p>=10000?`$${(p/1000).toFixed(1)}k`:p>=1000?`$${p.toFixed(0)}`:`$${p.toFixed(2)}`
const fmtV=(v:number)=>{const a=Math.abs(v);return a>=1e9?`${(v/1e9).toFixed(2)}B`:a>=1e6?`${(v/1e6).toFixed(2)}M`:a>=1e3?`${(v/1e3).toFixed(1)}K`:v>0?v.toFixed(0):'—'}
const fmtTS=(d:Date)=>d.toLocaleString('fr-FR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})

// ── Component ──────────────────────────────────────────────────────────────

export default function LiquidationHeatmap({symbol='BTCUSDT'}:{symbol?:string}){
  const[period,setPeriod]=useState(PERIODS[4])
  const[data,setData]=useState<HeatmapData|null>(null)
  const[price,setPrice]=useState(0)
  const[loading,setLoading]=useState(false)
  const[error,setError]=useState<string|null>(null)
  const[tip,setTip]=useState<Tip|null>(null)
  const canvasRef=useRef<HTMLCanvasElement>(null)
  const tipTimer=useRef<ReturnType<typeof setTimeout>|null>(null)

  const load=useCallback(async(sym:string,per:typeof PERIODS[0])=>{
    setLoading(true);setError(null);setTip(null);setData(null)
    try{
      const klines=await fetchKlines(sym,per.interval,per.limit)
      const last=klines[klines.length-1]
      setPrice(last.close)
      const rawMin=Math.min(...klines.map(c=>c.low))
      const rawMax=Math.max(...klines.map(c=>c.high))
      const pad=(rawMax-rawMin)*0.20
      const pMin=rawMin-pad
      const step=(rawMax+pad-pMin)/BUCKETS
      const depth=await fetchDepth(sym,pMin,step)
      setData(buildHeatmap(klines,depth))
    }catch(e){setError((e as Error).message)}
    finally{setLoading(false)}
  },[])

  useEffect(()=>{load(symbol,period)},[symbol,period,load])

  useEffect(()=>{
    if(!canvasRef.current||!data)return
    draw(canvasRef.current,data,price,tip)
  },[data,price,tip])

  const handlePointer=useCallback((e:React.MouseEvent|React.TouchEvent)=>{
    if(!data||!canvasRef.current)return
    const rect=canvasRef.current.getBoundingClientRect()
    const sx=canvasRef.current.width/rect.width
    const sy=canvasRef.current.height/rect.height
    const chartW=canvasRef.current.width-AXIS_W
    let cx:number,cy:number
    if('touches' in e){cx=e.touches[0].clientX;cy=e.touches[0].clientY}
    else{cx=(e as React.MouseEvent).clientX;cy=(e as React.MouseEvent).clientY}
    const x=(cx-rect.left)*sx,y=(cy-rect.top)*sy
    if(x>chartW||x<0)return
    const H=canvasRef.current.height
    const tipP=data.pMin+(1-y/H)*(data.pMax-data.pMin)
    const ci=Math.min(Math.max(Math.floor(x/chartW*data.N),0),data.N-1)
    const snap=data.candles[ci]
    const bi=Math.min(Math.max(Math.floor((tipP-data.pMin)/data.step),0),BUCKETS-1)
    const estVol=data.cols[ci][bi]*snap.volume*snap.close*800
    setTip({price:tipP,vol:estVol,ts:snap.openTime,x,y})
    if(tipTimer.current)clearTimeout(tipTimer.current)
    tipTimer.current=setTimeout(()=>setTip(null),3000)
  },[data])

  const stops=Array.from({length:20},(_,i)=>{const[r,g,b]=cgRGB(i/19);return`rgb(${r},${g},${b})`}).join(',')

  return(
    <div style={{background:'#0C0516',borderRadius:16,border:'1px solid rgba(120,0,200,0.3)',overflow:'hidden',userSelect:'none'}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'9px 14px'}}>
        <div style={{display:'flex',alignItems:'center',gap:7}}>
          <span>🔥</span>
          <span style={{fontSize:13,fontWeight:600,color:'white'}}>Liquidation Heatmap</span>
          <span style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>{symbol}</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          {loading&&<div style={{width:11,height:11,border:'1.5px solid rgba(120,0,255,0.25)',borderTopColor:'#9B59B6',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>}
          {price>0&&<span style={{fontSize:14,fontWeight:700,color:'#00E5FF',fontFamily:'monospace'}}>{fmtP(price)}</span>}
        </div>
      </div>
      <div style={{display:'flex',gap:3,padding:'0 14px 8px',overflowX:'auto'}}>
        {PERIODS.map(p=>(
          <button key={p.v} onClick={()=>setPeriod(p)} style={{padding:'3px 9px',borderRadius:5,fontSize:10,cursor:'pointer',border:'none',flexShrink:0,fontWeight:period.v===p.v?700:400,background:period.v===p.v?'rgba(128,0,255,0.5)':'rgba(255,255,255,0.05)',color:period.v===p.v?'white':'rgba(255,255,255,0.38)',transition:'all 0.15s'}}>{p.label}</button>
        ))}
      </div>
      {error?(
        <div style={{height:CANVAS_H,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:10}}>
          <span style={{fontSize:28,opacity:0.3}}>📊</span>
          <span style={{color:'rgba(255,255,255,0.3)',fontSize:12}}>{error}</span>
          <button onClick={()=>load(symbol,period)} style={{color:'#00E5FF',background:'none',border:'1px solid #00E5FF40',borderRadius:6,padding:'4px 12px',cursor:'pointer',fontSize:11}}>Réessayer</button>
        </div>
      ):(
        <canvas ref={canvasRef} width={900} height={CANVAS_H}
          style={{width:'100%',height:CANVAS_H,display:'block',cursor:data?'crosshair':'default'}}
          onMouseMove={handlePointer} onMouseDown={handlePointer}
          onMouseLeave={()=>{if(tipTimer.current)clearTimeout(tipTimer.current);tipTimer.current=setTimeout(()=>setTip(null),500)}}
          onTouchStart={handlePointer} onTouchMove={handlePointer}
        />
      )}
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 14px'}}>
        <div style={{width:130,height:8,borderRadius:2,background:`linear-gradient(to right,${stops})`,flexShrink:0}}/>
        <span style={{fontSize:8,color:'rgba(255,255,255,0.22)'}}>Liquidation Leverage</span>
        <div style={{marginLeft:'auto',display:'flex',gap:10}}>
          {[['#00D782','Bull'],['#E83044','Bear']].map(([c,l])=>(
            <span key={l} style={{display:'flex',alignItems:'center',gap:3,fontSize:8,color:'rgba(255,255,255,0.22)'}}>
              <span style={{width:8,height:8,borderRadius:1,background:c,display:'inline-block'}}/> {l}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
