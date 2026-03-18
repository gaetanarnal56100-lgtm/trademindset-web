// LiquidationHeatmap.tsx — v6
// Fix: tooltip sur canvas overlay séparé + bougies visibles + interactivité robuste

import { useState, useEffect, useRef, useCallback } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────
interface Kline { openTime: Date; open: number; high: number; low: number; close: number; volume: number }
interface HeatmapData { pMin: number; pMax: number; step: number; N: number; cols: Float32Array[]; candles: Kline[] }
interface Tip { price: number; vol: number; ts: Date; x: number; y: number }

const BUCKETS  = 120
const AXIS_W   = 60
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

// ── Palette Coinglass ──────────────────────────────────────────────────────
function cgRGB(i: number): [number,number,number] {
  i = Math.max(0, Math.min(1,i))
  if(i<0.05) return [38,13,64]
  if(i<0.15){const t=(i-.05)/.10;return[Math.round((.15+t*.15)*255),Math.round((.05+t*.05)*255),Math.round((.25+t*.15)*255)]}
  if(i<0.30){const t=(i-.15)/.15;return[Math.round((.30-t*.20)*255),Math.round((.10+t*.35)*255),Math.round((.40+t*.20)*255)]}
  if(i<0.50){const t=(i-.30)/.20;return[Math.round((.10-t*.05)*255),Math.round((.45+t*.30)*255),Math.round((.60-t*.25)*255)]}
  if(i<0.70){const t=(i-.50)/.20;return[Math.round((.05+t*.55)*255),Math.round((.75+t*.15)*255),Math.round((.35-t*.25)*255)]}
  if(i<0.85){const t=(i-.70)/.15;return[Math.round((.60+t*.35)*255),Math.round((.90+t*.10)*255),Math.round((.10-t*.05)*255)]}
  const t=(i-.85)/.15;return[Math.round((.95+t*.05)*255),255,Math.round((.05+t*.45)*255)]
}

// ── Fetch ──────────────────────────────────────────────────────────────────
async function fetchKlines(sym: string, interval: string, limit: number): Promise<Kline[]> {
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

async function fetchDepth(sym: string, pMin: number, step: number): Promise<Float32Array> {
  const profile=new Float32Array(BUCKETS)
  for(const url of[`https://fapi.binance.com/fapi/v1/depth?symbol=${sym}&limit=1000`,`https://api.binance.com/api/v3/depth?symbol=${sym}&limit=1000`]){
    try{
      const r=await fetch(url); if(!r.ok)continue
      const d=await r.json() as {bids:[string,string][];asks:[string,string][]}
      for(const[ps,qs] of[...(d.bids||[]),...(d.asks||[])]){
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

// ── Algorithm ──────────────────────────────────────────────────────────────
function spreadGaussian(arr: Float32Array, center: number, vol: number, sigma: number) {
  const r=Math.floor(sigma*2.5)
  for(let o=-r;o<=r;o++){
    const idx=center+o
    if(idx<0||idx>=arr.length)continue
    arr[idx]+=vol*Math.exp(-0.5*(o/sigma)**2)
  }
}
function wasSwept(price: number, candles: Kline[], from: number, to: number): boolean {
  for(let i=Math.max(0,from);i<=Math.min(candles.length-1,to);i++)
    if(price>=candles[i].low&&price<=candles[i].high)return true
  return false
}

function buildHeatmap(candles: Kline[], depth: Float32Array): HeatmapData {
  const rawMin=Math.min(...candles.map(c=>c.low))
  const rawMax=Math.max(...candles.map(c=>c.high))
  const pad=(rawMax-rawMin)*0.20
  const pMin=rawMin-pad, pMax=rawMax+pad
  const step=(pMax-pMin)/BUCKETS
  const N=candles.length
  const leverages=[5,10,25,50,100]
  const levW:Record<number,number>={5:0.5,10:1.0,25:2.5,50:2.0,100:0.8}
  const matrix:Float32Array[]=Array.from({length:N},()=>new Float32Array(BUCKETS))

  // Phase 1 — Volume Profile (poids réduit pour ne pas noyer les bougies)
  for(let ci=0;ci<N;ci++){
    const c=candles[ci], vol=c.volume*c.close
    const lowB=Math.max(0,Math.floor((c.low-pMin)/step))
    const highB=Math.min(BUCKETS-1,Math.floor((c.high-pMin)/step))
    const closeB=Math.min(BUCKETS-1,Math.max(0,Math.floor((c.close-pMin)/step)))
    for(let b=lowB;b<=highB;b++){
      const dist=Math.abs(b-closeB)
      const rng=Math.max(highB-lowB,1)
      matrix[ci][b]+=vol*(1.0-(dist/(rng+1))*0.5)*0.15  // ← 0.3→0.15 : moins dominant
    }
  }

  // Phase 2 — Liquidations
  for(let si=0;si<N;si++){
    const src=candles[si]
    for(const lev of leverages){
      const w=levW[lev], vol=src.volume*w
      const ll=src.close*(1-1/lev), sl=src.close*(1+1/lev)
      for(let di=si;di<N;di++){
        const decay=Math.exp(-(di-si)*0.005)
        const lb=Math.floor((ll-pMin)/step)
        const sb=Math.floor((sl-pMin)/step)
        if(lb>=0&&lb<BUCKETS){
          const bp=pMin+lb*step+step/2
          if(!wasSwept(bp,candles,si+1,di))
            spreadGaussian(matrix[di],lb,vol*decay*1.8,1.4)
        }
        if(sb>=0&&sb<BUCKETS){
          const bp=pMin+sb*step+step/2
          if(!wasSwept(bp,candles,si+1,di))
            spreadGaussian(matrix[di],sb,vol*decay*1.8,1.4)
        }
      }
    }
  }

  // Phase 3 — Depth profile
  if(N>0){
    const lastVol=candles[N-1].volume
    const depStart=Math.max(0,N-Math.floor(N/4))
    for(let col=depStart;col<N;col++){
      const fade=(col-depStart)/Math.max(1,N-depStart)
      for(let b=0;b<BUCKETS;b++)matrix[col][b]+=depth[b]*lastVol*1.2*fade
    }
  }

  // Phase 4 — Normalisation globale
  let globalMax=0
  for(let col=0;col<N;col++){const m=Math.max(...matrix[col]);if(m>globalMax)globalMax=m}
  const cols:Float32Array[]=matrix.map(col=>
    globalMax>0?Float32Array.from(col,v=>Math.pow(v/globalMax,0.25)):col
  )
  return{pMin,pMax,step,N,cols,candles}
}

// ── Draw heatmap + candles (pas le tooltip) ────────────────────────────────
function drawBase(canvas: HTMLCanvasElement, data: HeatmapData, price: number) {
  const ctx=canvas.getContext('2d')!
  const W=canvas.width, H=canvas.height
  const chartW=W-AXIS_W
  const colW=chartW/data.N
  const rowH=H/BUCKETS
  const range=data.pMax-data.pMin

  ctx.fillStyle='#0C0516'; ctx.fillRect(0,0,W,H)

  // Heatmap
  for(let ci=0;ci<data.N;ci++){
    const x0=ci*colW, col=data.cols[ci]
    for(let b=0;b<BUCKETS;b++){
      const v=col[b]
      if(v<0.005)continue
      const[r,g,bb]=cgRGB(Math.pow(v,0.8))
      ctx.fillStyle=`rgb(${r},${g},${bb})`
      ctx.fillRect(x0+0.2,H-(b+1)*rowH+0.2,colW-0.2,rowH+0.2)
    }
  }

  // Candles — dessinées APRÈS la heatmap avec bonne visibilité
  for(let ci=0;ci<data.N;ci++){
    const c=data.candles[ci], cx=ci*colW+colW/2
    const bull=c.close>=c.open
    const hY=H*(1-(c.high-data.pMin)/range)
    const lY=H*(1-(c.low-data.pMin)/range)
    const oY=H*(1-(c.open-data.pMin)/range)
    const cY=H*(1-(c.close-data.pMin)/range)

    // Fond noir derrière le corps pour lisibilité
    const bW=Math.max(colW*.65,2)
    const bT=Math.min(oY,cY), bH=Math.max(Math.abs(cY-oY),1.5)
    ctx.fillStyle='rgba(0,0,0,0.55)'
    ctx.fillRect(cx-bW/2-1, bT-1, bW+2, bH+2)

    // Mèche
    const color=bull?'rgba(0,220,140,1)':'rgba(232,48,68,1)'
    ctx.strokeStyle=color; ctx.lineWidth=1
    ctx.beginPath(); ctx.moveTo(cx,hY); ctx.lineTo(cx,lY); ctx.stroke()

    // Corps
    ctx.fillStyle=color
    ctx.fillRect(cx-bW/2, bT, bW, bH)
  }

  // Prix courant
  if(price>0&&price>=data.pMin&&price<=data.pMax){
    const py=H*(1-(price-data.pMin)/range)
    ctx.save(); ctx.setLineDash([5,3])
    ctx.strokeStyle='rgba(255,255,255,0.7)'; ctx.lineWidth=1
    ctx.beginPath(); ctx.moveTo(0,py); ctx.lineTo(chartW,py); ctx.stroke()
    ctx.restore()
    const label=fmtP(price)
    const bw=Math.max(label.length*7+14,64)
    ctx.fillStyle='#00E5FF'
    rr(ctx,chartW+1,py-11,bw,22,4); ctx.fill()
    ctx.fillStyle='#071018'; ctx.font='bold 10px monospace'
    ctx.textAlign='center'; ctx.textBaseline='middle'
    ctx.fillText(label,chartW+1+bw/2,py)
  }

  // Axe prix
  ctx.font='9px monospace'; ctx.fillStyle='rgba(255,255,255,0.55)'
  ctx.textAlign='right'; ctx.textBaseline='middle'
  for(let i=0;i<=7;i++){
    const p=data.pMax-(range*i)/7
    ctx.fillText(fmtC(p),W-3,(i/7)*H)
  }
}

// ── Draw tooltip sur canvas overlay ───────────────────────────────────────
function drawTooltip(canvas: HTMLCanvasElement, tip: Tip | null, data: HeatmapData) {
  const ctx=canvas.getContext('2d')!
  const W=canvas.width, H=canvas.height
  const chartW=W-AXIS_W
  ctx.clearRect(0,0,W,H)
  if(!tip)return

  // Crosshair
  ctx.save(); ctx.setLineDash([3,3])
  ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.lineWidth=0.8
  ctx.beginPath(); ctx.moveTo(0,tip.y); ctx.lineTo(chartW,tip.y); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(tip.x,0); ctx.lineTo(tip.x,H); ctx.stroke()
  ctx.restore()

  // Point blanc avec halo
  ctx.shadowColor='white'; ctx.shadowBlur=6
  ctx.fillStyle='white'
  ctx.beginPath(); ctx.arc(tip.x,tip.y,4,0,Math.PI*2); ctx.fill()
  ctx.shadowBlur=0

  // Tooltip box
  const TW=188, TH=82
  const tx=tip.x>chartW*0.55 ? tip.x-TW-12 : tip.x+12
  const ty=tip.y>H*0.55 ? tip.y-TH-12 : tip.y+12

  // Shadow
  ctx.shadowColor='rgba(0,0,0,0.6)'; ctx.shadowBlur=12
  ctx.fillStyle='rgba(8,4,20,0.95)'
  rr(ctx,tx,ty,TW,TH,10); ctx.fill()
  ctx.shadowBlur=0

  // Border cyan
  ctx.strokeStyle='rgba(0,229,255,0.4)'; ctx.lineWidth=1
  rr(ctx,tx,ty,TW,TH,10); ctx.stroke()

  // Date
  ctx.font='bold 10px monospace'; ctx.fillStyle='rgba(255,255,255,0.9)'
  ctx.textAlign='left'; ctx.textBaseline='top'
  ctx.fillText(fmtTS(tip.ts), tx+10, ty+10)

  // Lignes Prix + Liq
  const rows: [string, string][] = [
    ['Prix', fmtP(tip.price)],
    ['Liq. Leverage', fmtV(tip.vol)],
  ]
  rows.forEach(([label, value], idx) => {
    const ly = ty + 30 + idx * 22
    // Dot
    ctx.fillStyle='#FFD700'
    ctx.beginPath(); ctx.arc(tx+14,ly+5,4,0,Math.PI*2); ctx.fill()
    // Label
    ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font='9px monospace'
    ctx.textAlign='left'
    ctx.fillText(label, tx+24, ly+1)
    // Value
    ctx.fillStyle='white'; ctx.font='bold 11px monospace'
    ctx.textAlign='right'
    ctx.fillText(value, tx+TW-10, ly+1)
  })
}

// ── Helpers ────────────────────────────────────────────────────────────────
function rr(ctx: CanvasRenderingContext2D, x:number, y:number, w:number, h:number, r:number) {
  ctx.beginPath()
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r)
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h)
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r)
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y)
  ctx.closePath()
}
const fmtP=(p:number)=>p>=10000?`$${p.toFixed(0)}`:p>=1000?`$${p.toFixed(1)}`:`$${p.toFixed(3)}`
const fmtC=(p:number)=>p>=10000?`$${(p/1000).toFixed(1)}k`:p>=1000?`$${p.toFixed(0)}`:`$${p.toFixed(2)}`
const fmtV=(v:number)=>{const a=Math.abs(v);return a>=1e9?`${(v/1e9).toFixed(2)}B`:a>=1e6?`${(v/1e6).toFixed(2)}M`:a>=1e3?`${(v/1e3).toFixed(1)}K`:v>0?v.toFixed(0):'—'}
const fmtTS=(d:Date)=>d.toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})

// ── Component ──────────────────────────────────────────────────────────────
export default function LiquidationHeatmap({symbol='BTCUSDT'}:{symbol?:string}) {
  const [period,   setPeriod]   = useState(PERIODS[4])
  const [data,     setData]     = useState<HeatmapData|null>(null)
  const [price,    setPrice]    = useState(0)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string|null>(null)
  const [tip,      setTip]      = useState<Tip|null>(null)

  // Deux canvas : base (heatmap+bougies) + overlay (tooltip)
  const baseRef    = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const tipTimer   = useRef<ReturnType<typeof setTimeout>|null>(null)
  const dataRef    = useRef<HeatmapData|null>(null)

  const load = useCallback(async(sym:string, per:typeof PERIODS[0]) => {
    setLoading(true); setError(null); setTip(null); setData(null)
    try{
      const klines=await fetchKlines(sym,per.interval,per.limit)
      setPrice(klines[klines.length-1].close)
      const rawMin=Math.min(...klines.map(c=>c.low))
      const rawMax=Math.max(...klines.map(c=>c.high))
      const pad=(rawMax-rawMin)*0.20
      const pMin=rawMin-pad
      const step=(rawMax+pad-pMin)/BUCKETS
      const depth=await fetchDepth(sym,pMin,step)
      const hm=buildHeatmap(klines,depth)
      dataRef.current=hm
      setData(hm)
    }catch(e){setError((e as Error).message)}
    finally{setLoading(false)}
  },[])

  useEffect(()=>{load(symbol,period)},[symbol,period,load])

  // Draw base layer when data/price changes
  useEffect(()=>{
    if(!baseRef.current||!data)return
    drawBase(baseRef.current,data,price)
  },[data,price])

  // Draw tooltip overlay separately (no heatmap redraw)
  useEffect(()=>{
    if(!overlayRef.current||!data)return
    drawTooltip(overlayRef.current,tip,data)
  },[tip,data])

  // Pointer handler — uses dataRef to avoid stale closure
  const handlePointer = useCallback((e:React.MouseEvent|React.TouchEvent) => {
    const d=dataRef.current
    if(!d||!overlayRef.current)return

    const canvas=overlayRef.current
    const rect=canvas.getBoundingClientRect()
    const scaleX=canvas.width/rect.width
    const scaleY=canvas.height/rect.height
    const chartW=canvas.width-AXIS_W

    let cx:number, cy:number
    if('touches' in e){ cx=e.touches[0].clientX; cy=e.touches[0].clientY }
    else{ cx=(e as React.MouseEvent).clientX; cy=(e as React.MouseEvent).clientY }

    const x=(cx-rect.left)*scaleX
    const y=(cy-rect.top)*scaleY
    if(x<0||x>chartW||y<0||y>canvas.height)return

    const H=canvas.height
    const tipPrice=d.pMin+(1-y/H)*(d.pMax-d.pMin)
    const ci=Math.min(Math.max(Math.floor(x/chartW*d.N),0),d.N-1)
    const snap=d.candles[ci]
    const bi=Math.min(Math.max(Math.floor((tipPrice-d.pMin)/d.step),0),BUCKETS-1)
    const estVol=d.cols[ci][bi]*snap.volume*snap.close*800

    setTip({price:tipPrice,vol:estVol,ts:snap.openTime,x,y})
    if(tipTimer.current)clearTimeout(tipTimer.current)
    tipTimer.current=setTimeout(()=>setTip(null),3500)
  },[])

  const stops=Array.from({length:20},(_,i)=>{const[r,g,b]=cgRGB(i/19);return`rgb(${r},${g},${b})`}).join(',')

  return(
    <div style={{background:'#0C0516',borderRadius:16,border:'1px solid rgba(120,0,200,0.3)',overflow:'hidden',userSelect:'none'}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
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

      {/* Period selector */}
      <div style={{display:'flex',gap:3,padding:'0 14px 8px',overflowX:'auto'}}>
        {PERIODS.map(p=>(
          <button key={p.v} onClick={()=>setPeriod(p)} style={{
            padding:'3px 9px',borderRadius:5,fontSize:10,cursor:'pointer',border:'none',flexShrink:0,
            fontWeight:period.v===p.v?700:400,
            background:period.v===p.v?'rgba(128,0,255,0.5)':'rgba(255,255,255,0.05)',
            color:period.v===p.v?'white':'rgba(255,255,255,0.38)',
            transition:'all 0.15s',
          }}>{p.label}</button>
        ))}
      </div>

      {/* Canvas container — deux canvas superposés */}
      {error?(
        <div style={{height:CANVAS_H,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:10}}>
          <span style={{fontSize:28,opacity:0.3}}>📊</span>
          <span style={{color:'rgba(255,255,255,0.3)',fontSize:12}}>{error}</span>
          <button onClick={()=>load(symbol,period)} style={{color:'#00E5FF',background:'none',border:'1px solid #00E5FF40',borderRadius:6,padding:'4px 12px',cursor:'pointer',fontSize:11}}>Réessayer</button>
        </div>
      ):(
        <div style={{position:'relative',height:CANVAS_H}}>
          {/* Base layer — heatmap + bougies */}
          <canvas ref={baseRef} width={900} height={CANVAS_H}
            style={{position:'absolute',top:0,left:0,width:'100%',height:CANVAS_H,display:'block'}}
          />
          {/* Overlay layer — crosshair + tooltip — capte les events */}
          <canvas ref={overlayRef} width={900} height={CANVAS_H}
            style={{position:'absolute',top:0,left:0,width:'100%',height:CANVAS_H,display:'block',cursor:'crosshair'}}
            onMouseMove={handlePointer}
            onMouseDown={handlePointer}
            onMouseLeave={()=>{
              if(tipTimer.current)clearTimeout(tipTimer.current)
              setTip(null)
            }}
            onTouchStart={handlePointer}
            onTouchMove={handlePointer}
            onTouchEnd={()=>{
              if(tipTimer.current)clearTimeout(tipTimer.current)
              tipTimer.current=setTimeout(()=>setTip(null),2500)
            }}
          />
        </div>
      )}

      {/* Legend */}
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 14px'}}>
        <div style={{width:130,height:8,borderRadius:2,background:`linear-gradient(to right,${stops})`,flexShrink:0}}/>
        <span style={{fontSize:8,color:'rgba(255,255,255,0.22)'}}>Liquidation Leverage</span>
        <div style={{marginLeft:'auto',display:'flex',gap:10}}>
          {[['#00DC8C','Bull'],['#E83044','Bear']].map(([c,l])=>(
            <span key={l} style={{display:'flex',alignItems:'center',gap:3,fontSize:8,color:'rgba(255,255,255,0.22)'}}>
              <span style={{width:8,height:8,borderRadius:1,background:c,display:'inline-block'}}/> {l}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
