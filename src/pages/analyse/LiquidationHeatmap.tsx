// LiquidationHeatmap.tsx — v7 Coinglass-faithful
// Algorithme cumulatif avec accumulateur running persistant entre colonnes
// 200 buckets, bougies petites, bandes horizontales longues comme Coinglass

import { useState, useEffect, useRef, useCallback } from 'react'

interface Kline { openTime: Date; open: number; high: number; low: number; close: number; volume: number }
interface HeatmapData { pMin: number; pMax: number; step: number; N: number; cols: Float32Array[]; candles: Kline[]; buckets: number }
interface Tip { price: number; vol: number; ts: Date; x: number; y: number }

const BUCKETS  = 200   // Plus fin = bandes plus précises
const AXIS_W   = 64
const CANVAS_H = 360

const PERIODS = [
  { v:'M15',  label:'M15',   interval:'1m',  limit:15,  desc:'15 min'   },
  { v:'H1',   label:'H1',    interval:'1m',  limit:60,  desc:'1 heure'  },
  { v:'H4',   label:'H4',    interval:'3m',  limit:80,  desc:'4 heures' },
  { v:'12h',  label:'12h',   interval:'5m',  limit:144, desc:'12h'      },
  { v:'24h',  label:'24h',   interval:'5m',  limit:288, desc:'24h'      },
  { v:'3j',   label:'3 jours',interval:'15m',limit:288, desc:'3 jours'  },
  { v:'1sem', label:'1 sem', interval:'30m', limit:336, desc:'1 semaine'},
  { v:'2sem', label:'2 sem', interval:'1h',  limit:336, desc:'2 semaines'},
  { v:'1m',   label:'1 mois',interval:'2h',  limit:360, desc:'1 mois'   },
  { v:'3m',   label:'3 mois',interval:'6h',  limit:360, desc:'3 mois'   },
  { v:'6m',   label:'6 mois',interval:'12h', limit:360, desc:'6 mois'   },
  { v:'1an',  label:'1 an',  interval:'1d',  limit:365, desc:'1 an'     },
]

// Palette Coinglass exacte
function cgRGB(i: number): [number,number,number] {
  i = Math.max(0, Math.min(1,i))
  if(i<0.05) return [20,8,45]
  if(i<0.15){const t=(i-.05)/.10;return[Math.round((.08+t*.12)*255),Math.round((.03+t*.07)*255),Math.round((.18+t*.15)*255)]}
  if(i<0.30){const t=(i-.15)/.15;return[Math.round((.20-t*.10)*255),Math.round((.10+t*.35)*255),Math.round((.33+t*.25)*255)]}
  if(i<0.50){const t=(i-.30)/.20;return[Math.round((.10-t*.05)*255),Math.round((.45+t*.30)*255),Math.round((.58-t*.25)*255)]}
  if(i<0.70){const t=(i-.50)/.20;return[Math.round((.05+t*.55)*255),Math.round((.75+t*.15)*255),Math.round((.33-t*.25)*255)]}
  if(i<0.85){const t=(i-.70)/.15;return[Math.round((.60+t*.35)*255),Math.round((.90+t*.10)*255),Math.round((.08-t*.05)*255)]}
  const t=(i-.85)/.15;return[Math.round((.95+t*.05)*255),255,Math.round((.03+t*.30)*255)]
}

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

// ── Algorithme cumulatif (comme Coinglass) ─────────────────────────────────
// L'accumulateur running persiste d'une colonne à l'autre.
// Chaque bougie ajoute ses niveaux de liquidation.
// Le prix sweep (efface) les niveaux qu'il traverse.
// Résultat : bandes horizontales longues qui s'accumulent = look Coinglass

function buildHeatmap(candles: Kline[]): HeatmapData {
  const rawMin = Math.min(...candles.map(c=>c.low))
  const rawMax = Math.max(...candles.map(c=>c.high))
  const pad = (rawMax-rawMin)*0.12
  const pMin = rawMin-pad, pMax = rawMax+pad
  const step = (pMax-pMin)/BUCKETS
  const N = candles.length

  const leverages = [2,   3,   5,   10,  15,  20,  25,  33,  50,  75,  100, 125]
  const levW      = [0.10,0.18,0.35,0.70,0.90,1.10,1.40,1.25,1.70,1.15,1.45,0.95]

  const matrix: Float32Array[] = Array.from({length:N}, ()=>new Float32Array(BUCKETS))
  const running = new Float32Array(BUCKETS)  // accumulateur persistant

  for(let ci=0; ci<N; ci++){
    const c = candles[ci]
    const vol = c.volume * c.close

    // 1. Ajouter les nouveaux niveaux de liq de cette bougie
    for(let li=0; li<leverages.length; li++){
      const lev=leverages[li], w=levW[li]
      const ll=c.close*(1-1/lev)
      const sl=c.close*(1+1/lev)
      for(const liqP of [ll, sl]){
        const b=Math.round((liqP-pMin)/step)
        // Gaussian très étroit (sigma=0.7) → bandes fines et précises
        const sigma=0.7
        for(let o=-3;o<=3;o++){
          const idx=b+o
          if(idx<0||idx>=BUCKETS)continue
          running[idx]+=vol*w*Math.exp(-0.5*(o/sigma)**2)
        }
      }
    }

    // 2. Sweep : le prix traverse ces buckets → ils s'effacent (liquidations exécutées)
    const lowB  = Math.max(0, Math.floor((c.low  - pMin)/step))
    const highB = Math.min(BUCKETS-1, Math.ceil((c.high - pMin)/step))
    for(let b=lowB; b<=highB; b++){
      running[b] *= 0.08  // Quasi-effacement (garde 8% de trace visuelle)
    }

    // 3. Très légère décroissance globale (positions qui ferment naturellement)
    for(let b=0; b<BUCKETS; b++) running[b] *= 0.9985

    // 4. Snapshot pour cette colonne
    matrix[ci].set(running)
  }

  // Normalisation globale + tone mapping
  let gMax=0
  for(let col=0;col<N;col++){const m=Math.max(...matrix[col]);if(m>gMax)gMax=m}

  const cols: Float32Array[] = matrix.map(col=>
    gMax>0 ? Float32Array.from(col, v=>Math.pow(v/gMax, 0.32)) : col
  )

  return{pMin,pMax,step,N,cols,candles,buckets:BUCKETS}
}

// ── Draw ───────────────────────────────────────────────────────────────────

function drawBase(canvas: HTMLCanvasElement, data: HeatmapData, price: number) {
  const ctx=canvas.getContext('2d')!
  const W=canvas.width, H=canvas.height
  const chartW=W-AXIS_W
  const colW=chartW/data.N
  const rowH=H/data.buckets
  const range=data.pMax-data.pMin

  ctx.fillStyle='#050210'; ctx.fillRect(0,0,W,H)

  // Heatmap — chaque cellule
  for(let ci=0;ci<data.N;ci++){
    const x0=ci*colW
    const col=data.cols[ci]
    for(let b=0;b<data.buckets;b++){
      const v=col[b]
      if(v<0.003)continue
      const[r,g,bb]=cgRGB(v)
      ctx.fillStyle=`rgb(${r},${g},${bb})`
      // Légère marge entre colonnes pour voir la progression temporelle
      ctx.fillRect(x0+0.5, H-(b+1)*rowH+0.5, colW-0.5, rowH+0.5)
    }
  }

  // Bougies — petites, semi-transparentes, au dessus de la heatmap
  for(let ci=0;ci<data.N;ci++){
    const c=data.candles[ci], cx=ci*colW+colW/2
    const bull=c.close>=c.open
    const hY=H*(1-(c.high-data.pMin)/range)
    const lY=H*(1-(c.low-data.pMin)/range)
    const oY=H*(1-(c.open-data.pMin)/range)
    const cY=H*(1-(c.close-data.pMin)/range)
    const bW=Math.max(colW*0.5, 1.2)

    const color=bull?'rgba(0,220,140,0.85)':'rgba(220,40,60,0.85)'
    ctx.strokeStyle=color; ctx.lineWidth=0.7
    ctx.beginPath(); ctx.moveTo(cx,hY); ctx.lineTo(cx,lY); ctx.stroke()
    ctx.fillStyle=color
    ctx.fillRect(cx-bW/2, Math.min(oY,cY), bW, Math.max(Math.abs(cY-oY),1))
  }

  // Ligne prix courant
  if(price>0&&price>=data.pMin&&price<=data.pMax){
    const py=H*(1-(price-data.pMin)/range)
    ctx.save(); ctx.setLineDash([4,3])
    ctx.strokeStyle='rgba(255,255,255,0.6)'; ctx.lineWidth=0.8
    ctx.beginPath(); ctx.moveTo(0,py); ctx.lineTo(chartW,py); ctx.stroke()
    ctx.restore()
    const label=fmtP(price)
    const bw=Math.max(label.length*7+14,68)
    ctx.fillStyle='#00E5FF'
    rr(ctx,chartW+1,py-11,bw,22,4); ctx.fill()
    ctx.fillStyle='#071018'; ctx.font='bold 10px monospace'
    ctx.textAlign='center'; ctx.textBaseline='middle'
    ctx.fillText(label,chartW+1+bw/2,py)
  }

  // Axe prix
  ctx.font='9px monospace'; ctx.fillStyle='rgba(255,255,255,0.5)'
  ctx.textAlign='right'; ctx.textBaseline='middle'
  for(let i=0;i<=8;i++){
    const p=data.pMax-(range*i)/8
    ctx.fillText(fmtC(p),W-3,(i/8)*H)
  }
}

function drawOverlay(canvas: HTMLCanvasElement, tip: Tip|null, data: HeatmapData) {
  const ctx=canvas.getContext('2d')!
  const W=canvas.width, H=canvas.height
  const chartW=W-AXIS_W
  ctx.clearRect(0,0,W,H)
  if(!tip)return

  // Crosshair
  ctx.save(); ctx.setLineDash([3,3])
  ctx.strokeStyle='rgba(255,255,255,0.55)'; ctx.lineWidth=0.8
  ctx.beginPath(); ctx.moveTo(0,tip.y); ctx.lineTo(chartW,tip.y); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(tip.x,0); ctx.lineTo(tip.x,H); ctx.stroke()
  ctx.restore()

  // Dot
  ctx.shadowColor='rgba(255,255,255,0.8)'; ctx.shadowBlur=8
  ctx.fillStyle='white'
  ctx.beginPath(); ctx.arc(tip.x,tip.y,4,0,Math.PI*2); ctx.fill()
  ctx.shadowBlur=0

  // Tooltip
  const TW=192, TH=84
  const tx=tip.x>chartW*0.58 ? tip.x-TW-14 : tip.x+14
  const ty=tip.y>H*0.55 ? tip.y-TH-14 : tip.y+14
  ctx.shadowColor='rgba(0,0,0,0.7)'; ctx.shadowBlur=16
  ctx.fillStyle='rgba(6,3,18,0.96)'
  rr(ctx,tx,ty,TW,TH,10); ctx.fill()
  ctx.shadowBlur=0
  ctx.strokeStyle='rgba(0,229,255,0.5)'; ctx.lineWidth=1
  rr(ctx,tx,ty,TW,TH,10); ctx.stroke()

  ctx.font='bold 10px monospace'; ctx.fillStyle='rgba(255,255,255,0.85)'
  ctx.textAlign='left'; ctx.textBaseline='top'
  ctx.fillText(fmtTS(tip.ts), tx+10, ty+10)

  const rows:[string,string][] = [['Prix',fmtP(tip.price)],['Liq. Leverage',fmtV(tip.vol)]]
  rows.forEach(([label,value],idx)=>{
    const ly=ty+30+idx*23
    ctx.fillStyle='#FFD700'
    ctx.beginPath(); ctx.arc(tx+14,ly+5,3.5,0,Math.PI*2); ctx.fill()
    ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font='9px monospace'; ctx.textAlign='left'
    ctx.fillText(label,tx+24,ly+1)
    ctx.fillStyle='white'; ctx.font='bold 11px monospace'; ctx.textAlign='right'
    ctx.fillText(value,tx+TW-10,ly+1)
  })
}

function rr(ctx: CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){
  ctx.beginPath()
  ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r)
  ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h)
  ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r)
  ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y)
  ctx.closePath()
}

const fmtP=(p:number)=>p>=10000?`$${p.toFixed(0)}`:p>=1000?`$${p.toFixed(1)}`:`$${p.toFixed(3)}`
const fmtC=(p:number)=>p>=10000?`$${(p/1000).toFixed(1)}k`:p>=1000?`$${p.toFixed(0)}`:`$${p.toFixed(2)}`
const fmtV=(v:number)=>{const a=Math.abs(v);return a>=1e9?`${(v/1e9).toFixed(1)}B`:a>=1e6?`${(v/1e6).toFixed(1)}M`:a>=1e3?`${(v/1e3).toFixed(0)}K`:v>0?v.toFixed(0):'—'}
const fmtTS=(d:Date)=>d.toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})

// ── Component ──────────────────────────────────────────────────────────────

export default function LiquidationHeatmap({symbol='BTCUSDT'}:{symbol?:string}){
  const [period,  setPeriod]  = useState(PERIODS[4])   // 24h
  const [data,    setData]    = useState<HeatmapData|null>(null)
  const [price,   setPrice]   = useState(0)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string|null>(null)
  const [tip,     setTip]     = useState<Tip|null>(null)

  const baseRef    = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const dataRef    = useRef<HeatmapData|null>(null)
  const tipTimer   = useRef<ReturnType<typeof setTimeout>|null>(null)

  const load = useCallback(async(sym:string,per:typeof PERIODS[0])=>{
    setLoading(true); setError(null); setTip(null); setData(null)
    try{
      const klines=await fetchKlines(sym,per.interval,per.limit)
      setPrice(klines[klines.length-1].close)
      const hm=buildHeatmap(klines)
      dataRef.current=hm
      setData(hm)
    }catch(e){setError((e as Error).message)}
    finally{setLoading(false)}
  },[])

  useEffect(()=>{load(symbol,period)},[symbol,period,load])
  useEffect(()=>{if(baseRef.current&&data)drawBase(baseRef.current,data,price)},[data,price])
  useEffect(()=>{if(overlayRef.current&&data)drawOverlay(overlayRef.current,tip,data)},[tip,data])

  const handlePointer=useCallback((e:React.MouseEvent|React.TouchEvent)=>{
    const d=dataRef.current
    if(!d||!overlayRef.current)return
    const canvas=overlayRef.current
    const rect=canvas.getBoundingClientRect()
    const scaleX=canvas.width/rect.width
    const scaleY=canvas.height/rect.height
    const chartW=canvas.width-AXIS_W
    let cx:number,cy:number
    if('touches' in e){cx=e.touches[0].clientX;cy=e.touches[0].clientY}
    else{cx=(e as React.MouseEvent).clientX;cy=(e as React.MouseEvent).clientY}
    const x=(cx-rect.left)*scaleX, y=(cy-rect.top)*scaleY
    if(x<0||x>chartW||y<0||y>canvas.height)return
    const H=canvas.height
    const tipPrice=d.pMin+(1-y/H)*(d.pMax-d.pMin)
    const ci=Math.min(Math.max(Math.floor(x/chartW*d.N),0),d.N-1)
    const snap=d.candles[ci]
    const bi=Math.min(Math.max(Math.floor((tipPrice-d.pMin)/d.step),0),d.buckets-1)
    const estVol=d.cols[ci][bi]*snap.volume*snap.close*1200
    setTip({price:tipPrice,vol:estVol,ts:snap.openTime,x,y})
    if(tipTimer.current)clearTimeout(tipTimer.current)
    tipTimer.current=setTimeout(()=>setTip(null),3500)
  },[])

  // Legend gradient
  const stops=Array.from({length:24},(_,i)=>{const[r,g,b]=cgRGB(i/23);return`rgb(${r},${g},${b})`}).join(',')

  return(
    <div style={{background:'#050210',borderRadius:16,border:'1px solid rgba(80,0,180,0.35)',overflow:'hidden',userSelect:'none'}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px'}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span>🔥</span>
          <span style={{fontSize:13,fontWeight:600,color:'white'}}>Liquidation Heatmap</span>
          <span style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>{symbol}</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          {loading&&<div style={{display:'flex',alignItems:'center',gap:5,fontSize:10,color:'rgba(255,255,255,0.4)'}}>
            <div style={{width:10,height:10,border:'1.5px solid rgba(120,0,255,0.3)',borderTopColor:'#9B59B6',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
            Calcul...
          </div>}
          {price>0&&<span style={{fontSize:14,fontWeight:700,color:'#00E5FF',fontFamily:'monospace'}}>{fmtP(price)}</span>}
        </div>
      </div>

      {/* Period selector — toutes les périodes */}
      <div style={{display:'flex',gap:3,padding:'0 14px 8px',overflowX:'auto',scrollbarWidth:'none'}}>
        {PERIODS.map(p=>(
          <button key={p.v} onClick={()=>setPeriod(p)} style={{
            padding:'3px 9px',borderRadius:5,fontSize:10,cursor:'pointer',border:'none',flexShrink:0,
            fontWeight:period.v===p.v?700:400,
            background:period.v===p.v?'rgba(100,0,255,0.5)':'rgba(255,255,255,0.05)',
            color:period.v===p.v?'white':'rgba(255,255,255,0.4)',
            transition:'all 0.15s',
          }}>{p.label}</button>
        ))}
      </div>

      {/* Canvas */}
      {error?(
        <div style={{height:CANVAS_H,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:10}}>
          <span style={{fontSize:24,opacity:0.3}}>📊</span>
          <span style={{color:'rgba(255,255,255,0.3)',fontSize:12}}>{error}</span>
          <button onClick={()=>load(symbol,period)} style={{color:'#00E5FF',background:'none',border:'1px solid #00E5FF40',borderRadius:6,padding:'4px 12px',cursor:'pointer',fontSize:11}}>Réessayer</button>
        </div>
      ):(
        <div style={{position:'relative',height:CANVAS_H}}>
          <canvas ref={baseRef} width={1000} height={CANVAS_H}
            style={{position:'absolute',top:0,left:0,width:'100%',height:CANVAS_H,display:'block'}}/>
          <canvas ref={overlayRef} width={1000} height={CANVAS_H}
            style={{position:'absolute',top:0,left:0,width:'100%',height:CANVAS_H,display:'block',cursor:'crosshair'}}
            onMouseMove={handlePointer}
            onMouseDown={handlePointer}
            onMouseLeave={()=>{if(tipTimer.current)clearTimeout(tipTimer.current);setTip(null)}}
            onTouchStart={handlePointer}
            onTouchMove={handlePointer}
            onTouchEnd={()=>{if(tipTimer.current)clearTimeout(tipTimer.current);tipTimer.current=setTimeout(()=>setTip(null),2500)}}
          />
        </div>
      )}

      {/* Legend */}
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 14px'}}>
        <div style={{width:20,height:80,borderRadius:3,background:`linear-gradient(to bottom,${stops.split(',').reverse().join(',')})`,flexShrink:0}}/>
        <div style={{display:'flex',flexDirection:'column',justifyContent:'space-between',height:80,fontSize:8,color:'rgba(255,255,255,0.4)'}}>
          <span>Fort</span>
          <span style={{color:'rgba(255,255,255,0.2)'}}>Liq. Leverage</span>
          <span>Faible</span>
        </div>
        <div style={{marginLeft:'auto',display:'flex',gap:12,alignItems:'center'}}>
          {[['#00DC8C','Bull'],['#DC2840','Bear']].map(([c,l])=>(
            <span key={l} style={{display:'flex',alignItems:'center',gap:4,fontSize:9,color:'rgba(255,255,255,0.35)'}}>
              <span style={{width:10,height:10,borderRadius:2,background:c,display:'inline-block'}}/>{l}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
