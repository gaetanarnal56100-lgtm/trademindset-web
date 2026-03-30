// PnLModal.tsx — Courbe P&L trader : plein écran, zoom, stats, table
// Fix: un seul canvas/ref, modal via createPortal, W recalculé à l'ouverture

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { tradePnL, type Trade } from '@/services/firestore'

// ── Helpers ────────────────────────────────────────────────────────────────
function safeTime(d: any): number {
  if (!d) return 0
  if (typeof d?.getTime === 'function') { const t = d.getTime(); return isNaN(t) ? 0 : t }
  if (typeof d?.seconds === 'number') return d.seconds * 1000
  if (typeof d === 'number') return d
  return 0
}
function fmtK(n: number, dec = 2): string {
  const a = Math.abs(n), s = n < 0 ? '-' : '+'
  if (a >= 1_000_000) return `${s}$${(a/1_000_000).toFixed(dec)}M`
  if (a >= 1_000)     return `${s}$${(a/1_000).toFixed(1)}k`
  return `${s}$${a.toFixed(dec)}`
}
function fmtD(d: Date, s = false) {
  return d.toLocaleDateString('fr-FR', s
    ? { day:'2-digit', month:'2-digit' }
    : { day:'2-digit', month:'short', year:'2-digit' })
}

// Canvas cannot use CSS vars — resolve at draw time
function getCSSColor(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback
}



// ── Periods & Timeframes ───────────────────────────────────────────────────
type Period = '1J'|'2J'|'3J'|'5J'|'1S'|'2S'|'3S'|'1M'|'2M'|'3M'|'6M'|'YTD'|'1A'|'2A'|'ALL'
type TF     = 'TRADE'|'DAY'|'WEEK'|'MONTH'

const GROUPS: { lbl: string; ps: Period[] }[] = [
  { lbl:'J', ps:['1J','2J','3J','5J'] },
  { lbl:'S', ps:['1S','2S','3S'] },
  { lbl:'M', ps:['1M','2M','3M','6M'] },
  { lbl:'A', ps:['YTD','1A','2A'] },
  { lbl:'',  ps:['ALL'] },
]
const P_DAYS: Record<Period,number> = {
  '1J':1,'2J':2,'3J':3,'5J':5,'1S':7,'2S':14,'3S':21,
  '1M':30,'2M':60,'3M':90,'6M':180,'YTD':0,'1A':365,'2A':730,'ALL':0,
}
const P_LBL: Record<Period,string> = {
  '1J':'1J','2J':'2J','3J':'3J','5J':'5J','1S':'1S','2S':'2S','3S':'3S',
  '1M':'1M','2M':'2M','3M':'3M','6M':'6M','YTD':'YTD','1A':'1A','2A':'2A','ALL':'Tout',
}
const TF_LBL: Record<TF,string> = { TRADE:'Par trade', DAY:'Jour', WEEK:'Semaine', MONTH:'Mois' }

// ── Data ───────────────────────────────────────────────────────────────────
interface Pt { date:Date; cum:number; pnl:number; dd:number; peak:number; sym:string; dir:string; n:number }

function buildData(trades: Trade[], period: Period, tf: TF): Pt[] {
  const days = P_DAYS[period]
  const cutoff = period === 'YTD'
    ? new Date(new Date().getFullYear(), 0, 1).getTime()
    : days > 0 ? Date.now() - days*864e5 : 0

  const cl = [...trades]
    .filter(t => t.status === 'closed' && safeTime(t.date) >= cutoff)
    .sort((a,b) => safeTime(a.date) - safeTime(b.date))
  if (!cl.length) return []

  const key = (d: Date) => {
    if (tf === 'TRADE') return d.toISOString()
    if (tf === 'DAY')   return d.toISOString().slice(0,10)
    if (tf === 'WEEK')  { const c=new Date(d); c.setHours(0,0,0,0); c.setDate(c.getDate()-(c.getDay()||7)+1); return c.toISOString().slice(0,10) }
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
  }

  const bkts = new Map<string,{date:Date;pnl:number;n:number;sym:string;dir:string}>()
  for (const t of cl) {
    const d = new Date(safeTime(t.date)), k = key(d)
    if (!bkts.has(k)) bkts.set(k, {date:d, pnl:0, n:0, sym:t.symbol, dir:t.type})
    const b = bkts.get(k)!; b.pnl += tradePnL(t); b.n++; b.sym = t.symbol; b.dir = t.type
  }

  let cum=0, peak=0
  return [...bkts.values()].map(b => {
    cum += b.pnl; if (cum > peak) peak = cum
    const dd = peak > 0 ? (peak-cum)/Math.abs(peak)*100 : 0
    return { date:b.date, cum:Math.round(cum*100)/100, pnl:Math.round(b.pnl*100)/100,
      dd:Math.round(dd*10)/10, peak:Math.round(peak*100)/100, sym:b.sym, dir:b.dir, n:b.n }
  })
}

function computeStats(pts: Pt[]) {
  if (!pts.length) return null
  const pnls=pts.map(p=>p.pnl), wins=pnls.filter(p=>p>0), losses=pnls.filter(p=>p<=0)
  const gp=wins.reduce((a,b)=>a+b,0), gl=Math.abs(losses.reduce((a,b)=>a+b,0))
  const best=Math.max(...pnls), worst=Math.min(...pnls)
  const wr=wins.length/pnls.length
  const avgW=wins.length?gp/wins.length:0, avgL=losses.length?gl/losses.length:0
  const maxDD=Math.max(...pts.map(p=>p.dd),0)
  let cur=0,bStrk=0,wStrk=0,tmp=0
  pnls.forEach(p=>{tmp=p>0?Math.max(tmp+1,1):Math.min(tmp-1,-1);bStrk=Math.max(bStrk,tmp);wStrk=Math.min(wStrk,tmp)});cur=tmp
  const days=pts.length>1?(pts[pts.length-1].date.getTime()-pts[0].date.getTime())/864e5:1
  return { total:pts[pts.length-1].cum, wr, avgW, avgL, gp, gl,
    pf:gl>0?gp/gl:gp>0?Infinity:0, payoff:avgL?avgW/avgL:0,
    exp:pnls.reduce((a,b)=>a+b,0)/pnls.length, maxDD,
    maxDDPt:pts.find(p=>p.dd===maxDD), best, worst,
    bestPt:pts.find(p=>p.pnl===best), worstPt:pts.find(p=>p.pnl===worst),
    bStrk, wStrk, cur, count:pnls.length, wins:wins.length, losses:losses.length,
    days:Math.round(days), rf:maxDD>0?pts[pts.length-1].cum/(maxDD/100*(pts[pts.length-1].peak||1)):0 }
}

// ── Emotion score helper ──────────────────────────────────────────────────
function emotionToScore(state: string): number {
  const map: Record<string,number>={confident:5,calm:4.5,focused:5,excited:3.5,stressed:2,impatient:2,fearful:1,greedy:2.5,frustrated:1.5,distracted:2.5}
  return map[state]??3
}

// ── Canvas renderer ────────────────────────────────────────────────────────
function renderChart(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  pts: Pt[], hIdx: number|null, showDD: boolean, showDots: boolean, isModal: boolean,
  emotionData?: { date: Date; score: number; label: string; color: string }[]
) {
  const DPR = window.devicePixelRatio||1
  const PAD = { t:isModal?24:18, r:16, b:isModal?40:32, l:isModal?80:70 }
  const cW = W-PAD.l-PAD.r, cH = H-PAD.t-PAD.b
  ctx.clearRect(0,0,W,H)
  if (pts.length<2) return

  const vals=pts.map(p=>p.cum)
  const minV=Math.min(...vals,0), maxV=Math.max(...vals,0)
  const rng=maxV-minV||1, pad=rng*0.12
  const toX=(i:number)=>PAD.l+(i/(pts.length-1))*cW
  const toY=(v:number)=>PAD.t+cH-((v-minV+pad)/(rng+pad*2))*cH
  const z0=toY(0)

  // Grid
  const steps=isModal?6:5
  for(let i=0;i<=steps;i++){
    const v=minV+rng*i/steps, y=toY(v)
    ctx.strokeStyle='rgba(255,255,255,0.04)'; ctx.lineWidth=1; ctx.setLineDash([])
    ctx.beginPath(); ctx.moveTo(PAD.l,y); ctx.lineTo(W-PAD.r,y); ctx.stroke()
    ctx.fillStyle='var(--tm-text-muted)'; ctx.font=`${isModal?11:10}px JetBrains Mono,monospace`; ctx.textAlign='right'
    ctx.fillText(fmtK(v,0), PAD.l-6, y+4)
  }

  // Zero
  if(z0>=PAD.t&&z0<=PAD.t+cH){
    ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=1; ctx.setLineDash([5,4])
    ctx.beginPath(); ctx.moveTo(PAD.l,z0); ctx.lineTo(W-PAD.r,z0); ctx.stroke()
    ctx.setLineDash([])
  }

  // Drawdown zone
  if(showDD){
    ctx.fillStyle='rgba(var(--tm-loss-rgb,255,59,48),0.1)'
    ctx.beginPath()
    pts.forEach((p,i)=>i===0?ctx.moveTo(toX(i),toY(p.peak)):ctx.lineTo(toX(i),toY(p.peak)))
    for(let i=pts.length-1;i>=0;i--)ctx.lineTo(toX(i),toY(pts[i].cum))
    ctx.closePath(); ctx.fill()
  }

  const isPos=(pts[pts.length-1]?.cum??0)>=0
  const lc=isPos?getCSSColor('--tm-profit','#22C759'):getCSSColor('--tm-loss','#FF3B30')

  // Fill
  const g=ctx.createLinearGradient(0,PAD.t,0,PAD.t+cH)
  g.addColorStop(0,lc+'2E'); g.addColorStop(0.6,lc+'06'); g.addColorStop(1,lc+'00')
  ctx.beginPath()
  pts.forEach((p,i)=>i===0?ctx.moveTo(toX(i),toY(p.cum)):ctx.lineTo(toX(i),toY(p.cum)))
  ctx.lineTo(toX(pts.length-1),Math.max(z0,PAD.t+cH))
  ctx.lineTo(toX(0),Math.max(z0,PAD.t+cH))
  ctx.closePath(); ctx.fillStyle=g; ctx.fill()

  // Line
  ctx.beginPath(); ctx.strokeStyle=lc; ctx.lineWidth=isModal?2.5:2
  ctx.lineJoin='round'; ctx.lineCap='round'
  pts.forEach((p,i)=>i===0?ctx.moveTo(toX(i),toY(p.cum)):ctx.lineTo(toX(i),toY(p.cum)))
  ctx.stroke()

  // Dots
  if(showDots){
    pts.forEach((p,i)=>{
      const x=toX(i),y=toY(p.cum),c=p.pnl>=0?'var(--tm-profit)':'var(--tm-loss)',hov=i===hIdx
      ctx.beginPath(); ctx.arc(x,y,hov?7:2.5,0,Math.PI*2)
      ctx.fillStyle=hov?c:c+'88'; ctx.fill()
      if(hov){ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke()}
    })
  }

  // X labels
  const maxL=Math.min(isModal?12:8,pts.length), step=Math.max(1,Math.ceil(pts.length/maxL))
  ctx.fillStyle='var(--tm-text-muted)'; ctx.font=`${isModal?11:10}px JetBrains Mono,monospace`; ctx.textAlign='center'
  pts.forEach((p,i)=>{
    if(i%step===0||i===pts.length-1)
      ctx.fillText(fmtD(p.date,true),toX(i),H-(isModal?12:8))
  })

  // Crosshair
  if(hIdx!==null&&hIdx>=0&&hIdx<pts.length){
    const x=toX(hIdx),y=toY(pts[hIdx].cum)
    ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=1; ctx.setLineDash([4,4])
    ctx.beginPath(); ctx.moveTo(x,PAD.t); ctx.lineTo(x,PAD.t+cH); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(PAD.l,y); ctx.lineTo(W-PAD.r,y); ctx.stroke()
    ctx.setLineDash([])
  }

  // ── Emotion overlay ─────────────────────────────────────────────
  if (emotionData && emotionData.length >= 2 && pts.length >= 2) {
    // Map emotion entries to nearest trade point index
    const emotionPts: { idx: number; score: number; color: string }[] = []
    for (const e of emotionData) {
      const et = e.date.getTime()
      let bestIdx = 0, bestDist = Infinity
      pts.forEach((p, i) => {
        const d = Math.abs(p.date.getTime() - et)
        if (d < bestDist) { bestDist = d; bestIdx = i }
      })
      emotionPts.push({ idx: bestIdx, score: e.score, color: e.color })
    }
    // Deduplicate by idx (keep latest)
    const byIdx = new Map<number, typeof emotionPts[0]>()
    emotionPts.forEach(p => byIdx.set(p.idx, p))
    const sortedEmo = [...byIdx.values()].sort((a, b) => a.idx - b.idx)
    if (sortedEmo.length >= 2) {
      const emoToY = (score: number) => PAD.t + cH - ((score - 0.5) / 5) * cH
      // Emotion line
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(var(--tm-purple-rgb,191,90,242),0.7)'
      ctx.lineWidth = 1.5; ctx.setLineDash([4, 3])
      sortedEmo.forEach((p, i) => {
        const x = toX(p.idx), y = emoToY(p.score)
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      })
      ctx.stroke(); ctx.setLineDash([])
      // Emotion dots
      sortedEmo.forEach(p => {
        const x = toX(p.idx), y = emoToY(p.score)
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2)
        ctx.fillStyle = p.color + 'CC'; ctx.fill()
      })
      // Right axis label for emotion
      ctx.fillStyle = 'var(--tm-purple)'; ctx.font = '9px JetBrains Mono,monospace'; ctx.textAlign = 'left'
      ctx.fillText('😎5', W - PAD.r + 3, emoToY(5) + 3)
      ctx.fillText('😰1', W - PAD.r + 3, emoToY(1) + 3)
    }
  }
}

// ── Tooltip ────────────────────────────────────────────────────────────────
function Tooltip({ pt, x, W, isModal }: { pt:Pt; x:number; W:number; isModal:boolean }) {
  const tW=210, left=Math.min(x+16, W-tW-8), top=isModal?24:8
  return (
    <div style={{position:'absolute',left,top,width:tW,background:'var(--tm-bg-secondary)',border:'1px solid #2A2F3E',
      borderRadius:12,padding:'12px 14px',pointerEvents:'none',boxShadow:'0 12px 32px rgba(0,0,0,0.7)',zIndex:20}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:10,fontSize:10,color:'var(--tm-text-muted)'}}>
        <span>{fmtD(pt.date)}</span>
        <span style={{color:pt.pnl>=0?'var(--tm-profit)':'var(--tm-loss)',fontWeight:700}}>
          {pt.n>1?`${pt.n} trades`:`${pt.dir==='Long'?'▲':'▼'} ${pt.sym}`}
        </span>
      </div>
      {[
        {l:'P&L', v:fmtK(pt.pnl), c:pt.pnl>=0?'var(--tm-profit)':'var(--tm-loss)', sz:16},
        {l:'Cumulé', v:fmtK(pt.cum), c:'var(--tm-text-primary)', sz:13},
        ...(pt.dd>0?[{l:'Drawdown', v:`-${pt.dd.toFixed(1)}%`, c:'var(--tm-warning)', sz:12}]:[]),
        ...(pt.n>1?[{l:'Trades', v:String(pt.n), c:'var(--tm-text-secondary)', sz:11}]:[]),
      ].map(({l,v,c,sz},i,a)=>(
        <div key={l} style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',
          marginBottom:i<a.length-1?6:0, paddingBottom:i<a.length-1?6:0,
          borderBottom:i<a.length-1?'1px solid #1E2330':'none'}}>
          <span style={{fontSize:10,color:'var(--tm-text-muted)'}}>{l}</span>
          <span style={{fontSize:sz,fontWeight:700,color:c,fontFamily:'JetBrains Mono,monospace'}}>{v}</span>
        </div>
      ))}
    </div>
  )
}

// ── Period + TF controls ───────────────────────────────────────────────────
function PeriodBar({ period, setPeriod, tf, setTf, showDD, setShowDD, showDots, setShowDots,
  zoom, resetZoom, isZoomed, showEmotion, setShowEmotion, hasMoods }: any) {
  return (
    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
      {/* Grouped period */}
      <div style={{display:'flex',alignItems:'center',gap:3,background:'var(--tm-bg)',
        borderRadius:8,padding:'3px 6px',border:'1px solid #1E2330'}}>
        {GROUPS.map((g,gi)=>(
          <div key={gi} style={{display:'flex',alignItems:'center',gap:1}}>
            {gi>0&&<div style={{width:1,height:14,background:'var(--tm-border)',margin:'0 4px'}}/>}
            {g.lbl&&<span style={{fontSize:9,color:'var(--tm-text-muted)',fontFamily:'monospace',marginRight:2,userSelect:'none'}}>{g.lbl}</span>}
            {g.ps.map(p=>(
              <button key={p} onClick={()=>setPeriod(p)} style={{padding:'3px 8px',borderRadius:5,fontSize:10,
                fontWeight:600,cursor:'pointer',border:'none',fontFamily:'JetBrains Mono,monospace',
                background:period===p?'var(--tm-bg-tertiary)':'transparent',
                color:period===p?'var(--tm-text-primary)':'var(--tm-text-muted)',
                outline:period===p?'1px solid #2A2F3E':'none',transition:'all 0.1s'}}>
                {P_LBL[p]}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div style={{width:1,height:16,background:'var(--tm-border)'}}/>

      {/* Timeframe */}
      <div style={{display:'flex',background:'var(--tm-bg)',borderRadius:7,padding:2,gap:1,border:'1px solid #1E2330'}}>
        {(Object.keys(TF_LBL) as TF[]).map(t=>(
          <button key={t} onClick={()=>setTf(t)} style={{padding:'3px 9px',borderRadius:5,fontSize:10,
            fontWeight:600,cursor:'pointer',border:'none',
            background:tf===t?'rgba(var(--tm-accent-rgb,0,229,255),0.12)':'transparent',
            color:tf===t?'var(--tm-accent)':'var(--tm-text-muted)',
            outline:tf===t?'1px solid rgba(var(--tm-accent-rgb,0,229,255),0.3)':'none'}}>
            {TF_LBL[t]}
          </button>
        ))}
      </div>

      <div style={{width:1,height:16,background:'var(--tm-border)'}}/>

      {/* Toggles */}
      {[
        {lbl:'Drawdown',on:showDD,set:setShowDD,c:'var(--tm-loss)'},
        {lbl:'Points',on:showDots,set:setShowDots,c:'#F59714'},
      ].map(({lbl,on,set,c})=>(
        <button key={lbl} onClick={()=>set((x:boolean)=>!x)} style={{display:'flex',alignItems:'center',gap:5,
          padding:'3px 9px',borderRadius:6,fontSize:10,fontWeight:500,cursor:'pointer',
          border:`1px solid ${on?c+'50':'var(--tm-border)'}`,background:on?c+'10':'transparent',color:on?c:'var(--tm-text-muted)'}}>
          <div style={{width:7,height:7,borderRadius:1,background:on?c:'var(--tm-text-muted)'}}/>{lbl}
        </button>
      ))}

      {hasMoods && setShowEmotion && (
        <button onClick={()=>setShowEmotion((x:boolean)=>!x)} style={{display:'flex',alignItems:'center',gap:5,
          padding:'3px 9px',borderRadius:6,fontSize:10,fontWeight:500,cursor:'pointer',
          border:`1px solid ${showEmotion?'#BF5AF250':'var(--tm-border)'}`,background:showEmotion?'rgba(var(--tm-purple-rgb,191,90,242),0.1)':'transparent',color:showEmotion?'var(--tm-purple)':'var(--tm-text-muted)'}}>
          <div style={{width:7,height:7,borderRadius:1,background:showEmotion?'var(--tm-purple)':'var(--tm-text-muted)'}}/>Émotion
        </button>
      )}

      {isZoomed&&(
        <button onClick={resetZoom} style={{display:'flex',alignItems:'center',gap:5,padding:'3px 9px',
          borderRadius:6,fontSize:10,fontWeight:600,cursor:'pointer',
          border:'1px solid rgba(var(--tm-accent-rgb,0,229,255),0.4)',background:'rgba(var(--tm-accent-rgb,0,229,255),0.08)',color:'var(--tm-accent)'}}>
          ↺ Dézoom
        </button>
      )}
    </div>
  )
}

// ── StatBox ────────────────────────────────────────────────────────────────
function SB({label,value,sub,color='var(--tm-text-primary)'}:{label:string;value:string;sub?:string;color?:string}) {
  return (
    <div style={{padding:'12px 16px',background:'var(--tm-bg)',border:'1px solid #1E2330',borderRadius:10}}>
      <div style={{fontSize:9,color:'var(--tm-text-muted)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:4}}>{label}</div>
      <div style={{fontSize:17,fontWeight:700,color,fontFamily:'JetBrains Mono,monospace',lineHeight:1}}>{value}</div>
      {sub&&<div style={{fontSize:10,color:'var(--tm-text-muted)',marginTop:4}}>{sub}</div>}
    </div>
  )
}

// ── Main canvas hook ───────────────────────────────────────────────────────
function useChart(pts: Pt[], showDD: boolean, showDots: boolean, isModal: boolean, emotionData?: { date: Date; score: number; label: string; color: string }[]) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef   = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(800)
  const H = isModal ? 420 : 300
  const [hIdx, setHIdx] = useState<number|null>(null)
  const [zoom, setZoom] = useState({s:0, e:0})
  const [drag, setDrag] = useState<number|null>(null)
  const [sel,  setSel]  = useState<{s:number;e:number}|null>(null)

  useEffect(()=>{
    setZoom({s:0,e:Math.max(0,pts.length-1)}); setSel(null)
  },[pts])

  // Responsive
  useEffect(()=>{
    const el=wrapRef.current; if(!el) return
    const ro=new ResizeObserver(()=>{ if(el.clientWidth>0) setW(el.clientWidth) })
    ro.observe(el)
    if(el.clientWidth>0) setW(el.clientWidth)
    return()=>ro.disconnect()
  },[isModal])

  // Draw
  useEffect(()=>{
    const cv=canvasRef.current; if(!cv||pts.length<2) return
    const DPR=window.devicePixelRatio||1
    cv.width=Math.round(W*DPR); cv.height=Math.round(H*DPR)
    cv.style.width=`${W}px`; cv.style.height=`${H}px`
    const ctx=cv.getContext('2d')!; ctx.scale(DPR,DPR)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    const ez=sel?{s:Math.min(sel.s,sel.e),e:Math.max(sel.s,sel.e)}:zoom
    const slice=pts.slice(ez.s,ez.e+1)
    const localH=hIdx!==null?hIdx-ez.s:null
    renderChart(ctx,W,H,slice,localH,showDD,showDots,isModal,emotionData)
  },[pts,W,H,hIdx,zoom,sel,showDD,showDots,isModal])

  const PAD_L=isModal?80:70, PAD_R=16
  const ez=sel?{s:Math.min(sel.s,sel.e),e:Math.max(sel.s,sel.e)}:zoom

  const toIdx=useCallback((cx:number,rect:DOMRect)=>{
    const pct=Math.max(0,Math.min(1,(cx-rect.left-PAD_L)/(W-PAD_L-PAD_R)))
    const span=ez.e-ez.s
    return Math.round(ez.s+pct*span)
  },[W,ez,PAD_L])

  const onMove=useCallback((e:React.MouseEvent<HTMLCanvasElement>)=>{
    if(pts.length<2) return
    const rect=canvasRef.current!.getBoundingClientRect()
    const i=Math.min(Math.max(toIdx(e.clientX,rect),0),pts.length-1)
    setHIdx(i)
    if(drag!==null) setSel({s:drag,e:toIdx(e.clientX,rect)})
  },[pts,toIdx,drag])

  const onDown=useCallback((e:React.MouseEvent<HTMLCanvasElement>)=>{
    const rect=canvasRef.current!.getBoundingClientRect()
    setDrag(toIdx(e.clientX,rect)); setSel(null)
  },[toIdx])

  const onUp=useCallback(()=>{
    if(sel&&Math.abs(sel.e-sel.s)>2) setZoom({s:Math.min(sel.s,sel.e),e:Math.max(sel.s,sel.e)})
    setSel(null); setDrag(null)
  },[sel])

  const resetZoom=()=>setZoom({s:0,e:Math.max(0,pts.length-1)})
  const isZoomed=zoom.s>0||zoom.e<pts.length-1

  // Tooltip position
  const tDotX = hIdx!==null ? (() => {
    const span=ez.e-ez.s; const local=hIdx-ez.s
    return PAD_L+(span>0?local/span:0)*(W-PAD_L-PAD_R)
  })() : null

  return { canvasRef,wrapRef,W,H,hIdx,zoom,isZoomed,resetZoom,tDotX,
    onMove,onDown,onUp,onLeave:()=>setHIdx(null),
    cursor:drag!==null?'col-resize':'crosshair' }
}

// ── The Chart Widget ───────────────────────────────────────────────────────
function ChartWidget({ pts, showDD, showDots, isModal, controls, onFullscreen, emotionData }: {
  pts:Pt[]; showDD:boolean; showDots:boolean; isModal:boolean;
  controls:React.ReactNode; onFullscreen?:()=>void;
  emotionData?: { date: Date; score: number; label: string; color: string }[]
}) {
  const { canvasRef,wrapRef,W,H,hIdx,zoom,isZoomed,resetZoom,tDotX,
    onMove,onDown,onUp,onLeave,cursor } = useChart(pts,showDD,showDots,isModal,emotionData)
  const hovered = hIdx!==null?pts[hIdx]:null

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12,gap:8,flexWrap:'wrap'}}>
        {controls}
        {!isModal&&onFullscreen&&(
          <button onClick={onFullscreen}
            style={{display:'flex',alignItems:'center',gap:6,padding:'4px 12px',borderRadius:7,
              fontSize:11,fontWeight:600,cursor:'pointer',border:'1px solid #2A2F3E',
              background:'var(--tm-bg-tertiary)',color:'var(--tm-text-secondary)',transition:'all 0.15s',whiteSpace:'nowrap'}}
            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.cssText+=';border-color:#00E5FF;color:#00E5FF'}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.cssText+=';border-color:#2A2F3E;color:#8F94A3'}}>
            ⛶ Plein écran
          </button>
        )}
      </div>

      {pts.length<2?(
        <div style={{height:H,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--tm-text-muted)',fontSize:13}}>
          Pas encore assez de trades fermés
        </div>
      ):(
        <div ref={wrapRef} style={{position:'relative',userSelect:'none',flex:isModal?1:undefined}}>
          <canvas ref={canvasRef} width={W} height={H}
            onMouseMove={onMove} onMouseLeave={onLeave}
            onMouseDown={onDown} onMouseUp={onUp}
            style={{display:'block',width:'100%',height:H,cursor}}/>
          {!isModal&&pts.length>1&&(
            <div style={{position:'absolute',bottom:38,right:8,fontSize:9,color:'var(--tm-text-muted)'}}>
              {isZoomed?`${zoom.e-zoom.s+1} pts · `:''}glisser pour zoomer
            </div>
          )}
          {hovered&&tDotX!==null&&<Tooltip pt={hovered} x={tDotX} W={W} isModal={isModal}/>}
        </div>
      )}
    </div>
  )
}

// ── Stats grid ─────────────────────────────────────────────────────────────
function StatsGrid({ pts }: { pts:Pt[] }) {
  const s=computeStats(pts)
  if(!s) return <div style={{color:'var(--tm-text-muted)',textAlign:'center',padding:40}}>Pas de données</div>
  return (
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(155px,1fr))',gap:8}}>
      <SB label="P&L Total"       value={fmtK(s.total)}                   color={s.total>=0?'var(--tm-profit)':'var(--tm-loss)'} sub={`${s.count} trades`}/>
      <SB label="Win Rate"         value={`${(s.wr*100).toFixed(1)}%`}     color={s.wr>=0.5?'var(--tm-profit)':'var(--tm-warning)'} sub={`${s.wins}W / ${s.losses}L`}/>
      <SB label="Profit Factor"    value={isFinite(s.pf)?s.pf.toFixed(2):'∞'} color={s.pf>=1.5?'var(--tm-profit)':s.pf>=1?'var(--tm-warning)':'var(--tm-loss)'} sub={`G:${fmtK(s.gp,0)} P:${fmtK(-s.gl,0)}`}/>
      <SB label="Payoff Ratio"     value={s.payoff.toFixed(2)}             color={s.payoff>=1.5?'var(--tm-profit)':s.payoff>=1?'var(--tm-warning)':'var(--tm-loss)'} sub="moy win/loss"/>
      <SB label="Expectancy"       value={fmtK(s.exp)}                     color={s.exp>=0?'var(--tm-profit)':'var(--tm-loss)'} sub="par trade"/>
      <SB label="Max Drawdown"     value={`${s.maxDD.toFixed(1)}%`}        color={s.maxDD>20?'var(--tm-loss)':s.maxDD>10?'var(--tm-warning)':'var(--tm-profit)'} sub={s.maxDDPt?fmtD(s.maxDDPt.date):undefined}/>
      <SB label="Meilleur trade"   value={fmtK(s.best)}                    color="var(--tm-profit)" sub={s.bestPt?`${s.bestPt.sym} · ${fmtD(s.bestPt.date)}`:undefined}/>
      <SB label="Pire trade"       value={fmtK(s.worst)}                   color="var(--tm-loss)" sub={s.worstPt?`${s.worstPt.sym} · ${fmtD(s.worstPt.date)}`:undefined}/>
      <SB label="Série gagnante"   value={`+${s.bStrk}`}                   color="var(--tm-profit)" sub="consécutifs"/>
      <SB label="Série perdante"   value={`${s.wStrk}`}                    color="var(--tm-loss)" sub="consécutifs"/>
      <SB label="Série actuelle"   value={s.cur>=0?`+${s.cur}`:`${s.cur}`} color={s.cur>=0?'var(--tm-profit)':'var(--tm-loss)'}/>
      <SB label="Moy. gain"        value={fmtK(s.avgW)}                    color="var(--tm-profit)"/>
      <SB label="Moy. perte"       value={fmtK(s.avgL)}                    color="var(--tm-loss)"/>
      <SB label="Recovery Factor"  value={s.rf.toFixed(2)}                 color={s.rf>=2?'var(--tm-profit)':s.rf>=1?'var(--tm-warning)':'var(--tm-loss)'}/>
      <SB label="Durée analysée"   value={`${s.days}j`}                    color="var(--tm-text-secondary)"/>
    </div>
  )
}

// ── Trades table ───────────────────────────────────────────────────────────
function TradesTable({ pts }: { pts:Pt[] }) {
  return (
    <div style={{overflowX:'auto'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
        <thead>
          <tr style={{borderBottom:'1px solid #2A2F3E'}}>
            {['#','Date','Symbole','Direction','P&L','Cumulé','Drawdown','Trades'].map(h=>(
              <th key={h} style={{padding:'8px 12px',textAlign:'left',fontSize:9,color:'var(--tm-text-muted)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:600}}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pts.map((p,i)=>(
            <tr key={i} style={{borderBottom:'1px solid rgba(255,255,255,0.04)'}}
              onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='rgba(255,255,255,0.025)'}
              onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='transparent'}>
              <td style={{padding:'7px 12px',color:'var(--tm-text-muted)',fontFamily:'monospace'}}>{i+1}</td>
              <td style={{padding:'7px 12px',color:'var(--tm-text-secondary)',fontFamily:'monospace'}}>{fmtD(p.date)}</td>
              <td style={{padding:'7px 12px',fontWeight:600,color:'var(--tm-text-primary)'}}>{p.sym}</td>
              <td style={{padding:'7px 12px'}}>
                <span style={{fontSize:10,fontWeight:700,color:p.dir==='Long'?'var(--tm-profit)':'var(--tm-loss)',
                  background:p.dir==='Long'?'rgba(var(--tm-profit-rgb,34,199,89),0.1)':'rgba(var(--tm-loss-rgb,255,59,48),0.1)',
                  padding:'1px 8px',borderRadius:4}}>
                  {p.dir==='Long'?'▲ Long':'▼ Short'}
                </span>
              </td>
              <td style={{padding:'7px 12px',fontFamily:'monospace',fontWeight:600,color:p.pnl>=0?'var(--tm-profit)':'var(--tm-loss)'}}>{fmtK(p.pnl)}</td>
              <td style={{padding:'7px 12px',fontFamily:'monospace',color:'var(--tm-text-primary)'}}>{fmtK(p.cum)}</td>
              <td style={{padding:'7px 12px',fontFamily:'monospace',color:p.dd>10?'var(--tm-loss)':p.dd>5?'var(--tm-warning)':'var(--tm-text-muted)'}}>
                {p.dd>0?`-${p.dd.toFixed(1)}%`:'—'}
              </td>
              <td style={{padding:'7px 12px',color:'var(--tm-text-muted)',fontFamily:'monospace'}}>{p.n>1?p.n:'—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Modal portal ───────────────────────────────────────────────────────────
function Modal({ trades, moods = [], onClose }: { trades:Trade[]; moods?:MoodLike[]; onClose:()=>void }) {
  const [period, setPeriod] = useState<Period>('ALL')
  const [tf,     setTf]     = useState<TF>('TRADE')
  const [showDD, setShowDD] = useState(true)
  const [showDots, setShowDots] = useState(true)
  const [showEmotion, setShowEmotion] = useState(false)
  const [tab, setTab]       = useState<'chart'|'stats'|'trades'>('chart')

  const pts   = useMemo(()=>buildData(trades,period,tf),[trades,period,tf])
  const stats = useMemo(()=>computeStats(pts),[pts])
  const isPos = (pts[pts.length-1]?.cum??0)>=0

  const emotionData = useMemo(() => {
    if (!showEmotion || !moods.length) return undefined
    return moods
      .filter(m => m.timestamp instanceof Date && !isNaN(m.timestamp.getTime()))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .map(m => ({
        date: m.timestamp,
        score: emotionToScore(m.emotionalState),
        label: m.emotionalState,
        color: EMOTION_COLORS[m.emotionalState] || 'var(--tm-text-secondary)',
      }))
  }, [moods, showEmotion])

  // Close on Escape
  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{ if(e.key==='Escape') onClose() }
    window.addEventListener('keydown',h); return()=>window.removeEventListener('keydown',h)
  },[onClose])

  const controls = (
    <PeriodBar period={period} setPeriod={setPeriod} tf={tf} setTf={setTf}
      showDD={showDD} setShowDD={setShowDD} showDots={showDots} setShowDots={setShowDots}
      zoom={null} resetZoom={()=>{}} isZoomed={false}
      showEmotion={showEmotion} setShowEmotion={setShowEmotion} hasMoods={moods.length > 0}/>
  )

  return createPortal(
    <div style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(0,0,0,0.92)',
      display:'flex',flexDirection:'column'}}>
      <div style={{flex:1,background:'var(--tm-bg)',display:'flex',flexDirection:'column',overflow:'hidden'}}>

        {/* Header */}
        <div style={{padding:'18px 28px',borderBottom:'1px solid #1E2330',display:'flex',
          alignItems:'center',gap:20,flexShrink:0}}>
          <div>
            <div style={{fontSize:11,color:'var(--tm-text-muted)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:3}}>Courbe P&L</div>
            <div style={{fontSize:30,fontWeight:800,color:isPos?'var(--tm-profit)':'var(--tm-loss)',
              fontFamily:'JetBrains Mono,monospace',lineHeight:1}}>
              {stats?fmtK(stats.total):'—'}
            </div>
          </div>
          {stats&&(
            <div style={{display:'flex',gap:28}}>
              {[
                {l:'Win Rate',v:`${(stats.wr*100).toFixed(0)}%`,c:stats.wr>=0.5?'var(--tm-profit)':'var(--tm-warning)'},
                {l:'Profit Factor',v:isFinite(stats.pf)?stats.pf.toFixed(2):'∞',c:stats.pf>=1.5?'var(--tm-profit)':'var(--tm-warning)'},
                {l:'Max DD',v:`${stats.maxDD.toFixed(1)}%`,c:stats.maxDD>20?'var(--tm-loss)':stats.maxDD>10?'var(--tm-warning)':'var(--tm-profit)'},
                {l:'Expectancy',v:fmtK(stats.exp),c:stats.exp>=0?'var(--tm-profit)':'var(--tm-loss)'},
                {l:'Trades',v:String(stats.count),c:'var(--tm-text-secondary)'},
              ].map(({l,v,c})=>(
                <div key={l}>
                  <div style={{fontSize:9,color:'var(--tm-text-muted)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:2}}>{l}</div>
                  <div style={{fontSize:16,fontWeight:700,color:c,fontFamily:'JetBrains Mono,monospace'}}>{v}</div>
                </div>
              ))}
            </div>
          )}
          <button onClick={onClose} style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:8,
            padding:'8px 16px',borderRadius:8,cursor:'pointer',border:'1px solid #2A2F3E',
            background:'var(--tm-bg-tertiary)',color:'var(--tm-text-secondary)',fontSize:12,fontWeight:600}}>
            Esc ✕ Fermer
          </button>
        </div>

        {/* Tabs */}
        <div style={{padding:'0 28px',borderBottom:'1px solid #1E2330',display:'flex',flexShrink:0}}>
          {([['chart','📈 Graphique'],['stats','📊 Statistiques'],['trades','📋 Trades']] as [typeof tab,string][]).map(([t,l])=>(
            <button key={t} onClick={()=>setTab(t)} style={{padding:'14px 20px',background:'none',border:'none',
              borderBottom:`2px solid ${tab===t?'var(--tm-accent)':'transparent'}`,cursor:'pointer',
              color:tab===t?'var(--tm-accent)':'var(--tm-text-muted)',fontSize:13,fontWeight:tab===t?600:400,transition:'all 0.15s'}}>
              {l}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{flex:1,overflow:'auto',padding:28,display:'flex',flexDirection:'column'}}>
          {tab==='chart'&&<ChartWidget pts={pts} showDD={showDD} showDots={showDots} isModal controls={controls} emotionData={emotionData}/>}
          {tab==='stats'&&<><div style={{marginBottom:16}}>{controls}</div><StatsGrid pts={pts}/></>}
          {tab==='trades'&&<><div style={{marginBottom:16,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            {controls}<span style={{fontSize:11,color:'var(--tm-text-muted)'}}>{pts.length} points</span>
          </div><TradesTable pts={pts}/></>}
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Emotion data types ────────────────────────────────────────────────────
interface MoodLike { emotionalState: string; timestamp: Date }

const EMOTION_COLORS: Record<string,string> = {
  confident:'#4CAF50', calm:'#2196F3', focused:'#00BCD4', excited:'#E91E63',
  stressed:'#F44336', impatient:'#FF9800', fearful:'#9C27B0', greedy:'#FFC107',
  frustrated:'#795548', distracted:'#607D8B',
}

// ── Dashboard inline component ─────────────────────────────────────────────
export default function PnLCurve({ trades, moods = [] }: { trades: Trade[]; moods?: MoodLike[] }) {
  const [period, setPeriod] = useState<Period>('ALL')
  const [tf,     setTf]     = useState<TF>('TRADE')
  const [showDD, setShowDD] = useState(true)
  const [showDots, setShowDots] = useState(true)
  const [showEmotion, setShowEmotion] = useState(false)
  const [modal,  setModal]  = useState(false)

  const pts = useMemo(()=>buildData(trades,period,tf),[trades,period,tf])

  const emotionData = useMemo(() => {
    if (!showEmotion || !moods.length) return undefined
    return moods
      .filter(m => m.timestamp instanceof Date && !isNaN(m.timestamp.getTime()))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .map(m => ({
        date: m.timestamp,
        score: emotionToScore(m.emotionalState),
        label: m.emotionalState,
        color: EMOTION_COLORS[m.emotionalState] || 'var(--tm-text-secondary)',
      }))
  }, [moods, showEmotion])

  const controls = (
    <PeriodBar period={period} setPeriod={setPeriod} tf={tf} setTf={setTf}
      showDD={showDD} setShowDD={setShowDD} showDots={showDots} setShowDots={setShowDots}
      zoom={null} resetZoom={()=>{}} isZoomed={false}
      showEmotion={showEmotion} setShowEmotion={setShowEmotion} hasMoods={moods.length > 0}/>
  )

  return (
    <>
      <ChartWidget pts={pts} showDD={showDD} showDots={showDots} isModal={false}
        controls={controls} onFullscreen={()=>setModal(true)} emotionData={emotionData}/>
      {modal&&<Modal trades={trades} moods={moods} onClose={()=>setModal(false)}/>}
    </>
  )
}
