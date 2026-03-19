// LightweightChart.tsx — Graphique pro avec outils de dessin natifs (Primitives API v4)
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  createChart, IChartApi, ISeriesApi, CrosshairMode,
  Time, CandlestickData, LineStyle,
  ISeriesPrimitive, SeriesAttachedParameter, ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView, BitmapCoordinatesRenderingScope,
} from 'lightweight-charts'
import { getAuth } from 'firebase/auth'
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, Timestamp } from 'firebase/firestore'
import app from '@/services/firebase/config'

const db = getFirestore(app)

// ── Types ─────────────────────────────────────────────────────────────────
interface Props { symbol: string; isCrypto: boolean }
interface Candle { time: number; open: number; high: number; low: number; close: number; volume?: number }

type DrawingType = 'hline' | 'trendline' | 'fibo' | 'rect' | 'note'
interface DrawingPoint { time: number; price: number }
interface Drawing {
  id?: string
  type: DrawingType
  symbol: string
  tf: string
  p1: DrawingPoint
  p2?: DrawingPoint
  label?: string
  color: string
  ts: number
}
interface SavedDrawing extends Drawing { id: string }

const TIMEFRAMES = [
  {label:'1m',min:1},{label:'5m',min:5},{label:'15m',min:15},{label:'30m',min:30},
  {label:'1h',min:60},{label:'4h',min:240},{label:'1j',min:1440},{label:'1S',min:10080},
]
const COLORS = ['#FF3B30','#FF9500','#FFD60A','#22C759','#00E5FF','#0A85FF','#BF5AF2','#F0F3FF']
const FIBO_LEVELS = [
  {ratio:0,    label:'0%'},
  {ratio:0.236,label:'23.6%'},
  {ratio:0.382,label:'38.2%'},
  {ratio:0.5,  label:'50%'},
  {ratio:0.618,label:'61.8%'},
  {ratio:0.786,label:'78.6%'},
  {ratio:1,    label:'100%'},
  {ratio:1.272,label:'127.2%'},
  {ratio:1.618,label:'161.8%'},
]

function tfStr(min:number) {
  if(min<60)return`${min}m`;if(min<1440)return`${min/60}h`;if(min<10080)return'1d';return'1w'
}
function fmtP(p:number){
  return p>1000?`$${p.toLocaleString('fr-FR',{maximumFractionDigits:1})}`:p>1?`$${p.toFixed(2)}`:`$${p.toFixed(5)}`
}

// ── Firestore ──────────────────────────────────────────────────────────────
function getUid(){return getAuth().currentUser?.uid}
async function dbSave(d:Drawing):Promise<string>{
  const u=getUid();if(!u)throw new Error('Non connecté')
  const ref=await addDoc(collection(db,'users',u,'chartDrawings'),{...d,ts:Timestamp.now()})
  return ref.id
}
async function dbLoad(sym:string,tf:string):Promise<SavedDrawing[]>{
  const u=getUid();if(!u)return[]
  const snap=await getDocs(query(collection(db,'users',u,'chartDrawings'),orderBy('ts','desc')))
  return snap.docs
    .map(d=>({id:d.id,...d.data() as Drawing,ts:(d.data().ts as Timestamp).toMillis()}))
    .filter(d=>d.symbol===sym&&d.tf===tf)
}
async function dbDelete(id:string){
  const u=getUid();if(!u)return
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
// ── DRAWING PRIMITIVES (natif lightweight-charts v4) ─────────────────────
// ══════════════════════════════════════════════════════════════════════════

// Helper: convertit un prix+temps en coordonnées pixel via les APIs v4
function toPixel(
  bitmapScope: BitmapCoordinatesRenderingScope,
  series: ISeriesApi<'Candlestick'>,
  time: number,
  price: number
): {x:number;y:number}|null {
  try {
    const x = bitmapScope.mediaSize ? 
      (series as any)._internal__chart?.timeScale()?.timeToCoordinate(time as Time) :
      null
    const y = series.priceToCoordinate(price)
    if(x==null||y==null)return null
    // Convert media coords to bitmap coords
    const ratio = bitmapScope.horizontalPixelRatio ?? 1
    const ratioV = bitmapScope.verticalPixelRatio ?? 1
    return {x: x*ratio, y: y*ratioV}
  }catch{return null}
}

// ── Primitive de base ──────────────────────────────────────────────────────
class DrawingPrimitive implements ISeriesPrimitive<CandlestickData> {
  protected _series: ISeriesApi<'Candlestick'> | null = null
  protected _chart: IChartApi | null = null
  protected _requestUpdate: (() => void) | null = null

  attached(params: SeriesAttachedParameter<CandlestickData>) {
    this._series = params.series as ISeriesApi<'Candlestick'>
    this._chart = params.chart
    this._requestUpdate = params.requestUpdate
  }
  detached() { this._series=null; this._chart=null; this._requestUpdate=null }

  protected toX(time: number): number | null {
    try { return this._chart?.timeScale().timeToCoordinate(time as Time) ?? null }
    catch { return null }
  }
  protected toY(price: number): number | null {
    try { return this._series?.priceToCoordinate(price) ?? null }
    catch { return null }
  }
  protected fromY(y: number): number | null {
    try { return this._series?.coordinateToPrice(y) ?? null }
    catch { return null }
  }
}

// ── Horizontal Line Primitive ──────────────────────────────────────────────
class HLinePrimitive extends DrawingPrimitive {
  private _price: number
  private _color: string
  private _label: string
  private _paneView: HLinePaneView

  constructor(price: number, color: string, label = '') {
    super()
    this._price = price
    this._color = color
    this._label = label
    this._paneView = new HLinePaneView(this)
  }
  get price() { return this._price }
  get color() { return this._color }
  get label() { return this._label }

  paneViews() { return [this._paneView] }
  priceAxisViews() { return [] }
  timeAxisViews() { return [] }
}

class HLinePaneView implements ISeriesPrimitivePaneView {
  private _prim: HLinePrimitive
  constructor(p: HLinePrimitive) { this._prim = p }

  renderer(): ISeriesPrimitivePaneRenderer {
    return {
      draw: (target) => {
        target.useBitmapCoordinateSpace(scope => {
          const ctx = scope.context
          const w = scope.bitmapSize.width
          const series = (this._prim as any)._series as ISeriesApi<'Candlestick'>
          if(!series) return
          const y = series.priceToCoordinate(this._prim.price)
          if(y == null) return
          const yBitmap = y * scope.verticalPixelRatio

          ctx.save()
          ctx.strokeStyle = this._prim.color
          ctx.lineWidth = 1.5
          ctx.setLineDash([8, 5])
          ctx.beginPath()
          ctx.moveTo(0, yBitmap)
          ctx.lineTo(w, yBitmap)
          ctx.stroke()
          ctx.setLineDash([])

          // Label pill
          const label = this._prim.label
            ? `${this._prim.label}  ${fmtP(this._prim.price)}`
            : fmtP(this._prim.price)
          ctx.font = `bold ${11 * scope.horizontalPixelRatio}px JetBrains Mono, monospace`
          const tw = ctx.measureText(label).width
          const pad = 8 * scope.horizontalPixelRatio
          const pillH = 18 * scope.verticalPixelRatio
          const pillW = tw + pad * 2
          const pillX = w - pillW - 4 * scope.horizontalPixelRatio
          const pillY = yBitmap - pillH / 2

          ctx.fillStyle = this._prim.color + '22'
          ctx.beginPath()
          ctx.roundRect(pillX, pillY, pillW, pillH, 4 * scope.horizontalPixelRatio)
          ctx.fill()
          ctx.strokeStyle = this._prim.color
          ctx.lineWidth = 1
          ctx.stroke()
          ctx.fillStyle = this._prim.color
          ctx.fillText(label, pillX + pad, yBitmap + 4 * scope.verticalPixelRatio)
          ctx.restore()
        })
      }
    }
  }
}

// ── Trend Line Primitive ───────────────────────────────────────────────────
class TrendLinePrimitive extends DrawingPrimitive {
  private _p1: DrawingPoint
  private _p2: DrawingPoint
  private _color: string
  private _paneView: TrendLinePaneView

  constructor(p1: DrawingPoint, p2: DrawingPoint, color: string) {
    super()
    this._p1 = p1; this._p2 = p2; this._color = color
    this._paneView = new TrendLinePaneView(this)
  }
  get p1() { return this._p1 }
  get p2() { return this._p2 }
  get color() { return this._color }
  paneViews() { return [this._paneView] }
  priceAxisViews() { return [] }
  timeAxisViews() { return [] }
}

class TrendLinePaneView implements ISeriesPrimitivePaneView {
  private _prim: TrendLinePrimitive
  constructor(p: TrendLinePrimitive) { this._prim = p }

  renderer(): ISeriesPrimitivePaneRenderer {
    return {
      draw: (target) => {
        target.useBitmapCoordinateSpace(scope => {
          const ctx = scope.context
          const w = scope.bitmapSize.width
          const h = scope.bitmapSize.height
          const chart = (this._prim as any)._chart as IChartApi
          const series = (this._prim as any)._series as ISeriesApi<'Candlestick'>
          if(!chart||!series) return

          const x1 = chart.timeScale().timeToCoordinate(this._prim.p1.time as Time)
          const x2 = chart.timeScale().timeToCoordinate(this._prim.p2.time as Time)
          const y1 = series.priceToCoordinate(this._prim.p1.price)
          const y2 = series.priceToCoordinate(this._prim.p2.price)
          if(x1==null||x2==null||y1==null||y2==null) return

          const bx1 = x1 * scope.horizontalPixelRatio
          const bx2 = x2 * scope.horizontalPixelRatio
          const by1 = y1 * scope.verticalPixelRatio
          const by2 = y2 * scope.verticalPixelRatio

          // Extend line across full chart
          const slope = (by2 - by1) / (bx2 - bx1 || 1)
          const extX1 = 0
          const extY1 = by1 - slope * bx1
          const extX2 = w
          const extY2 = by1 + slope * (w - bx1)

          ctx.save()
          ctx.strokeStyle = this._prim.color
          ctx.lineWidth = 1.5 * scope.horizontalPixelRatio
          ctx.beginPath()
          ctx.moveTo(extX1, extY1)
          ctx.lineTo(extX2, extY2)
          ctx.stroke()

          // Dots at anchor points
          ctx.fillStyle = this._prim.color
          for(const [bx,by] of [[bx1,by1],[bx2,by2]]){
            ctx.beginPath()
            ctx.arc(bx, by, 4*scope.horizontalPixelRatio, 0, Math.PI*2)
            ctx.fill()
          }
          ctx.restore()
        })
      }
    }
  }
}

// ── Fibonacci Primitive ────────────────────────────────────────────────────
class FiboPrimitive extends DrawingPrimitive {
  private _p1: DrawingPoint
  private _p2: DrawingPoint
  private _color: string
  private _paneView: FiboPaneView

  constructor(p1: DrawingPoint, p2: DrawingPoint, color: string) {
    super()
    this._p1 = p1; this._p2 = p2; this._color = color
    this._paneView = new FiboPaneView(this)
  }
  get p1() { return this._p1 }
  get p2() { return this._p2 }
  get color() { return this._color }
  paneViews() { return [this._paneView] }
  priceAxisViews() { return [] }
  timeAxisViews() { return [] }
}

class FiboPaneView implements ISeriesPrimitivePaneView {
  private _prim: FiboPrimitive
  constructor(p: FiboPrimitive) { this._prim = p }

  renderer(): ISeriesPrimitivePaneRenderer {
    return {
      draw: (target) => {
        target.useBitmapCoordinateSpace(scope => {
          const ctx = scope.context
          const w = scope.bitmapSize.width
          const series = (this._prim as any)._series as ISeriesApi<'Candlestick'>
          const chart = (this._prim as any)._chart as IChartApi
          if(!series||!chart) return

          const high = Math.max(this._prim.p1.price, this._prim.p2.price)
          const low  = Math.min(this._prim.p1.price, this._prim.p2.price)
          const range = high - low
          const x1 = chart.timeScale().timeToCoordinate(this._prim.p1.time as Time)
          const x2 = chart.timeScale().timeToCoordinate(this._prim.p2.time as Time)
          const startX = x1 != null ? x1 * scope.horizontalPixelRatio : 0
          const endX   = x2 != null ? x2 * scope.horizontalPixelRatio : w

          ctx.save()
          ctx.font = `${10 * scope.horizontalPixelRatio}px JetBrains Mono, monospace`

          for(let i = 0; i < FIBO_LEVELS.length; i++) {
            const lvl = FIBO_LEVELS[i]
            const price = high - range * lvl.ratio
            const y = series.priceToCoordinate(price)
            if(y == null) continue
            const by = y * scope.verticalPixelRatio

            // Fill zone between levels
            if(i < FIBO_LEVELS.length - 1) {
              const nextPrice = high - range * FIBO_LEVELS[i+1].ratio
              const nextY = series.priceToCoordinate(nextPrice)
              if(nextY != null) {
                const nextBy = nextY * scope.verticalPixelRatio
                const alpha = lvl.ratio === 0.618 ? '20' : '0c'
                ctx.fillStyle = this._prim.color + alpha
                ctx.fillRect(startX, Math.min(by, nextBy), endX - startX, Math.abs(nextBy - by))
              }
            }

            // Line
            const isKey = [0, 0.382, 0.5, 0.618, 1].includes(lvl.ratio)
            ctx.strokeStyle = this._prim.color
            ctx.lineWidth = isKey ? 1.5 : 0.8
            ctx.globalAlpha = isKey ? 0.9 : 0.5
            ctx.setLineDash(isKey ? [] : [4, 4])
            ctx.beginPath()
            ctx.moveTo(startX, by)
            ctx.lineTo(w, by)
            ctx.stroke()
            ctx.setLineDash([])
            ctx.globalAlpha = 1

            // Label
            const labelStr = `${lvl.label}  ${fmtP(price)}`
            const tw = ctx.measureText(labelStr).width
            ctx.fillStyle = this._prim.color
            ctx.globalAlpha = isKey ? 0.95 : 0.65
            ctx.fillText(labelStr, w - tw - 6 * scope.horizontalPixelRatio, by - 3 * scope.verticalPixelRatio)
            ctx.globalAlpha = 1
          }
          ctx.restore()
        })
      }
    }
  }
}

// ── Rectangle Primitive ────────────────────────────────────────────────────
class RectPrimitive extends DrawingPrimitive {
  private _p1: DrawingPoint
  private _p2: DrawingPoint
  private _color: string
  private _paneView: RectPaneView

  constructor(p1: DrawingPoint, p2: DrawingPoint, color: string) {
    super()
    this._p1 = p1; this._p2 = p2; this._color = color
    this._paneView = new RectPaneView(this)
  }
  get p1() { return this._p1 }
  get p2() { return this._p2 }
  get color() { return this._color }
  paneViews() { return [this._paneView] }
  priceAxisViews() { return [] }
  timeAxisViews() { return [] }
}

class RectPaneView implements ISeriesPrimitivePaneView {
  private _prim: RectPrimitive
  constructor(p: RectPrimitive) { this._prim = p }

  renderer(): ISeriesPrimitivePaneRenderer {
    return {
      draw: (target) => {
        target.useBitmapCoordinateSpace(scope => {
          const ctx = scope.context
          const chart = (this._prim as any)._chart as IChartApi
          const series = (this._prim as any)._series as ISeriesApi<'Candlestick'>
          if(!chart||!series) return
          const x1 = chart.timeScale().timeToCoordinate(this._prim.p1.time as Time)
          const x2 = chart.timeScale().timeToCoordinate(this._prim.p2.time as Time)
          const y1 = series.priceToCoordinate(this._prim.p1.price)
          const y2 = series.priceToCoordinate(this._prim.p2.price)
          if(x1==null||x2==null||y1==null||y2==null) return

          const bx1 = Math.min(x1,x2) * scope.horizontalPixelRatio
          const bx2 = Math.max(x1,x2) * scope.horizontalPixelRatio
          const by1 = Math.min(y1,y2) * scope.verticalPixelRatio
          const by2 = Math.max(y1,y2) * scope.verticalPixelRatio
          const rw = bx2 - bx1, rh = by2 - by1

          ctx.save()
          ctx.fillStyle = this._prim.color + '18'
          ctx.fillRect(bx1, by1, rw, rh)
          ctx.strokeStyle = this._prim.color
          ctx.lineWidth = 1.5
          ctx.strokeRect(bx1, by1, rw, rh)
          ctx.restore()
        })
      }
    }
  }
}

// ── Note Primitive ─────────────────────────────────────────────────────────
class NotePrimitive extends DrawingPrimitive {
  private _p1: DrawingPoint
  private _color: string
  private _text: string
  private _paneView: NotePaneView

  constructor(p1: DrawingPoint, color: string, text: string) {
    super()
    this._p1 = p1; this._color = color; this._text = text
    this._paneView = new NotePaneView(this)
  }
  get p1() { return this._p1 }
  get color() { return this._color }
  get text() { return this._text }
  paneViews() { return [this._paneView] }
  priceAxisViews() { return [] }
  timeAxisViews() { return [] }
}

class NotePaneView implements ISeriesPrimitivePaneView {
  private _prim: NotePrimitive
  constructor(p: NotePrimitive) { this._prim = p }

  renderer(): ISeriesPrimitivePaneRenderer {
    return {
      draw: (target) => {
        target.useBitmapCoordinateSpace(scope => {
          const ctx = scope.context
          const chart = (this._prim as any)._chart as IChartApi
          const series = (this._prim as any)._series as ISeriesApi<'Candlestick'>
          if(!chart||!series) return
          const x = chart.timeScale().timeToCoordinate(this._prim.p1.time as Time)
          const y = series.priceToCoordinate(this._prim.p1.price)
          if(x==null||y==null) return
          const bx = x * scope.horizontalPixelRatio
          const by = y * scope.verticalPixelRatio

          ctx.save()
          ctx.font = `${11 * scope.horizontalPixelRatio}px JetBrains Mono, monospace`
          const tw = ctx.measureText(this._prim.text).width
          const pad = 8 * scope.horizontalPixelRatio
          const pillH = 20 * scope.verticalPixelRatio
          const pillW = tw + pad * 2 + 20 * scope.horizontalPixelRatio
          ctx.fillStyle = this._prim.color + '28'
          ctx.strokeStyle = this._prim.color
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.roundRect(bx, by - pillH/2, pillW, pillH, 4*scope.horizontalPixelRatio)
          ctx.fill(); ctx.stroke()
          ctx.fillStyle = this._prim.color
          ctx.fillText('✎ ' + this._prim.text, bx + pad, by + 4*scope.verticalPixelRatio)
          ctx.restore()
        })
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ── INDICATEURS (calculs Pine portés en TS) ───────────────────────────────
// ══════════════════════════════════════════════════════════════════════════

function ema(data:number[], len:number):number[] {
  const k=2/(len+1),r=[...data]
  for(let i=1;i<data.length;i++)r[i]=data[i]*k+r[i-1]*(1-k)
  return r
}
function sma(data:number[], len:number):number[] {
  return data.map((_,i)=>{
    if(i<len-1)return data[i]
    return data.slice(i-len+1,i+1).reduce((a,b)=>a+b,0)/len
  })
}
function rsiCalc(closes:number[], len:number):number[] {
  const r=new Array(closes.length).fill(50)
  for(let i=len;i<closes.length;i++){
    let g=0,l=0
    for(let j=i-len+1;j<=i;j++){const d=closes[j]-closes[j-1];if(d>0)g+=d;else l-=d}
    const ag=g/len,al=l/len;r[i]=al===0?100:100-100/(1+ag/al)
  }
  return r
}
function highest(data:number[], len:number):number[] {
  return data.map((_,i)=>i<len-1?data[i]:Math.max(...data.slice(i-len+1,i+1)))
}
function lowest(data:number[], len:number):number[] {
  return data.map((_,i)=>i<len-1?data[i]:Math.min(...data.slice(i-len+1,i+1)))
}
function atrCalc(candles:Candle[], len:number):number[] {
  const tr=candles.map((c,i)=>i===0?c.high-c.low:Math.max(c.high-c.low,Math.abs(c.high-candles[i-1].close),Math.abs(c.low-candles[i-1].close)))
  return sma(tr,len)
}

interface VMCResult { sig:number[]; sigSignal:number[]; mom:number[]; isBull:boolean[]; isBear:boolean[]; buySignals:number[]; sellSignals:number[] }
function calcVMC(candles:Candle[]):VMCResult {
  const closes=candles.map(c=>c.close)
  const hlc3=candles.map(c=>(c.high+c.low+c.close)/3)
  const rsiVals=rsiCalc(closes,14)
  const rsiH=highest(rsiVals,14),rsiL=lowest(rsiVals,14)
  const stoch=sma(rsiVals.map((r,i)=>rsiH[i]===rsiL[i]?0:(r-rsiL[i])/(rsiH[i]-rsiL[i])*100),2)
  const mfi=hlc3.map((_,i)=>i===0?50:hlc3[i]>hlc3[i-1]?60:hlc3[i]<hlc3[i-1]?40:50)
  const core=hlc3.map((_,i)=>(rsiVals[i]+0.4*mfi[i]+0.4*stoch[i])/1.8)
  const tf=(v:number)=>{const t=(v/100-0.5)*2;return 100*Math.sign(t)*Math.pow(Math.abs(t),0.75)}
  const sig=ema(core,10).map(tf)
  const sigSignal=ema(core,18).map(tf)
  const mom=sig.map((s,i)=>s-sigSignal[i])
  const lens=[20,25,30,35,40,45,50,55]
  const emas=lens.map(l=>ema(closes,l))
  const isBull=closes.map((_,i)=>{let up=0;for(let j=0;j<7;j++)if(emas[j][i]>emas[j+1][i])up++;return up>=5})
  const isBear=closes.map((_,i)=>{let dn=0;for(let j=0;j<7;j++)if(emas[j][i]<emas[j+1][i])dn++;return dn>=5})
  const buySignals:number[]=[],sellSignals:number[]=[]
  for(let i=1;i<candles.length;i++){
    if(sig[i]>sigSignal[i]&&sig[i-1]<=sigSignal[i-1]&&sig[i]<-25&&isBull[i])buySignals.push(i)
    if(sig[i]<sigSignal[i]&&sig[i-1]>=sigSignal[i-1]&&sig[i]>25&&isBear[i])sellSignals.push(i)
  }
  return{sig,sigSignal,mom,isBull,isBear,buySignals,sellSignals}
}

interface SMCResult { bullOBs:{top:number;btm:number;idx:number}[]; bearOBs:{top:number;btm:number;idx:number}[]; bullFVGs:{top:number;btm:number;idx:number}[]; bearFVGs:{top:number;btm:number;idx:number}[] }
function calcSMC(candles:Candle[]):SMCResult {
  const n=candles.length,sw=10
  const bullOBs:SMCResult['bullOBs']=[],bearOBs:SMCResult['bearOBs']=[],bullFVGs:SMCResult['bullFVGs']=[],bearFVGs:SMCResult['bearFVGs']=[]
  if(n<sw*2+5)return{bullOBs,bearOBs,bullFVGs,bearFVGs}
  for(let i=2;i<n;i++){
    const c=candles[i],c1=candles[i-1],c2=candles[i-2]
    if(c.low>c2.high&&c1.close>c1.open)bullFVGs.push({top:c.low,btm:c2.high,idx:i-2})
    if(c.high<c2.low&&c1.close<c1.open)bearFVGs.push({top:c2.low,btm:c.high,idx:i-2})
  }
  const pivH=new Array(n).fill(0),pivL=new Array(n).fill(0)
  for(let i=sw;i<n-sw;i++){
    let isPH=true,isPL=true
    for(let j=i-sw;j<=i+sw;j++){
      if(j===i)continue
      if(candles[j].high>=candles[i].high)isPH=false
      if(candles[j].low<=candles[i].low)isPL=false
    }
    if(isPH)pivH[i]=candles[i].high
    if(isPL)pivL[i]=candles[i].low
  }
  let lastPH=0,lastPL=999999
  for(let i=sw;i<n;i++){
    if(pivH[i]>0)lastPH=pivH[i]
    if(pivL[i]>0)lastPL=pivL[i]
    if(candles[i].close>lastPH&&lastPH>0){
      for(let j=i-1;j>=Math.max(0,i-sw*2);j--){
        if(candles[j].close<candles[j].open){bullOBs.push({top:Math.max(candles[j].open,candles[j].close),btm:Math.min(candles[j].open,candles[j].close),idx:j});lastPH=0;break}
      }
    }
    if(candles[i].close<lastPL&&lastPL<999999){
      for(let j=i-1;j>=Math.max(0,i-sw*2);j--){
        if(candles[j].close>candles[j].open){bearOBs.push({top:Math.max(candles[j].open,candles[j].close),btm:Math.min(candles[j].open,candles[j].close),idx:j});lastPL=999999;break}
      }
    }
  }
  const cp=candles[n-1].close
  return{
    bullOBs:bullOBs.filter(o=>o.top>cp*0.93).slice(-4),
    bearOBs:bearOBs.filter(o=>o.btm<cp*1.07).slice(-4),
    bullFVGs:bullFVGs.filter(f=>f.top>cp*0.90).slice(-4),
    bearFVGs:bearFVGs.filter(f=>f.btm<cp*1.10).slice(-4),
  }
}

interface MSDResult { swingHighs:{idx:number;price:number;type:'HH'|'LH'}[]; swingLows:{idx:number;price:number;type:'HL'|'LL'}[]; bosLines:{from:number;to:number;price:number;type:'BOS'|'CHoCH';dir:'bull'|'bear'}[] }
function calcMSD(candles:Candle[]):MSDResult {
  const n=candles.length,sw=5
  const swingHighs:MSDResult['swingHighs']=[],swingLows:MSDResult['swingLows']=[],bosLines:MSDResult['bosLines']=[]
  if(n<sw*2+2)return{swingHighs,swingLows,bosLines}
  let prevPH=0,prevPL=999999,trend=1
  for(let i=sw;i<n-sw;i++){
    let isPH=true,isPL=true
    for(let j=i-sw;j<=i+sw;j++){
      if(j===i)continue
      if(candles[j].high>=candles[i].high)isPH=false
      if(candles[j].low<=candles[i].low)isPL=false
    }
    if(isPH){
      swingHighs.push({idx:i,price:candles[i].high,type:candles[i].high>prevPH?'HH':'LH'})
      if(prevPH>0){
        for(let k=i+1;k<Math.min(n,i+sw*3);k++){
          if(candles[k].close>prevPH){
            bosLines.push({from:i-sw,to:k,price:prevPH,type:trend===1?'BOS':'CHoCH',dir:'bull'})
            if(trend!==1)trend=1;break
          }
        }
      }
      prevPH=candles[i].high
    }
    if(isPL){
      swingLows.push({idx:i,price:candles[i].low,type:candles[i].low<prevPL?'LL':'HL'})
      if(prevPL<999999){
        for(let k=i+1;k<Math.min(n,i+sw*3);k++){
          if(candles[k].close<prevPL){
            bosLines.push({from:i-sw,to:k,price:prevPL,type:trend===-1?'BOS':'CHoCH',dir:'bear'})
            if(trend!==-1)trend=-1;break
          }
        }
      }
      prevPL=candles[i].low
    }
  }
  return{swingHighs:swingHighs.slice(-10),swingLows:swingLows.slice(-10),bosLines:bosLines.slice(-6)}
}

interface MPResult { poc:number; vah:number; val:number }
function calcMP(candles:Candle[]):MPResult|null {
  if(!candles.length)return null
  const hi=Math.max(...candles.map(c=>c.high))
  const lo=Math.min(...candles.map(c=>c.low))
  if(hi<=lo)return null
  const bins=30,step=(hi-lo)/bins
  const buckets=Array.from({length:bins},(_,i)=>({price:lo+step*(i+0.5),vol:0}))
  for(const c of candles){
    const v=(c.volume||1)/bins
    for(let i=0;i<bins;i++){
      if(c.low<=lo+step*(i+1)&&c.high>=lo+step*i)buckets[i].vol+=v
    }
  }
  const maxV=Math.max(...buckets.map(b=>b.vol))
  const pocIdx=buckets.findIndex(b=>b.vol===maxV)
  const total=buckets.reduce((a,b)=>a+b.vol,0)
  let sum=buckets[pocIdx].vol,lo_=pocIdx,hi_=pocIdx
  while(sum<total*0.7&&(lo_>0||hi_<bins-1)){
    if(hi_<bins-1){hi_++;sum+=buckets[hi_].vol}
    if(lo_>0){lo_--;sum+=buckets[lo_].vol}
  }
  return{poc:buckets[pocIdx].price,vah:buckets[hi_].price+step/2,val:buckets[lo_].price-step/2}
}

// ══════════════════════════════════════════════════════════════════════════
// ── VMC Panel ─────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════
function VMCPanel({vmcResult,candles}:{vmcResult:VMCResult;candles:Candle[]}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(()=>{
    const canvas=canvasRef.current
    if(!canvas||!vmcResult||!candles.length)return
    const draw=()=>{
      const dpr=window.devicePixelRatio||1
      const cw=canvas.offsetWidth,ch=canvas.offsetHeight
      canvas.width=cw*dpr;canvas.height=ch*dpr
      canvas.style.width=cw+'px';canvas.style.height=ch+'px'
      const ctx=canvas.getContext('2d')!;ctx.scale(dpr,dpr)
      ctx.clearRect(0,0,cw,ch);ctx.fillStyle='#0D1117';ctx.fillRect(0,0,cw,ch)
      const n=vmcResult.sig.length,vis=Math.min(n,Math.floor(cw/2))
      const sig=vmcResult.sig.slice(-vis),ss=vmcResult.sigSignal.slice(-vis),mom=vmcResult.mom.slice(-vis)
      const len=sig.length;if(!len)return
      const minV=Math.min(...sig,...ss,-65),maxV=Math.max(...sig,...ss,65)
      const rng=maxV-minV||1
      const toY=(v:number)=>ch*0.9-((v-minV)/rng)*(ch*0.8)
      const toX=(i:number)=>(i/(len-1))*cw
      // Zero
      ctx.strokeStyle='#2A2F3E';ctx.lineWidth=1;ctx.setLineDash([4,4])
      ctx.beginPath();ctx.moveTo(0,toY(0));ctx.lineTo(cw,toY(0));ctx.stroke();ctx.setLineDash([])
      // Thresholds
      for(const t of[40,-40]){
        ctx.strokeStyle=t>0?'rgba(255,59,48,0.3)':'rgba(34,199,89,0.3)';ctx.lineWidth=1;ctx.setLineDash([3,5])
        ctx.beginPath();ctx.moveTo(0,toY(t));ctx.lineTo(cw,toY(t));ctx.stroke();ctx.setLineDash([])
        ctx.font='bold 9px JetBrains Mono, monospace';ctx.fillStyle=t>0?'#FF3B3080':'#22C75980'
        ctx.fillText(t>0?'+40':'-40',3,toY(t)-3)
      }
      // Momentum bars
      const bw=Math.max(1,cw/len-0.5)
      for(let i=0;i<len;i++){
        const m=mom[i],x=toX(i)-bw/2,y0=toY(0),ym=toY(m)
        ctx.fillStyle=m>=0?'rgba(34,199,89,0.45)':'rgba(255,59,48,0.45)'
        ctx.fillRect(x,Math.min(ym,y0),bw,Math.abs(ym-y0))
      }
      // Cloud
      ctx.beginPath()
      for(let i=0;i<len;i++)i===0?ctx.moveTo(toX(i),toY(sig[i])):ctx.lineTo(toX(i),toY(sig[i]))
      for(let i=len-1;i>=0;i--)ctx.lineTo(toX(i),toY(ss[i]))
      ctx.closePath()
      const bull=vmcResult.isBull[vmcResult.isBull.length-1]
      ctx.fillStyle=bull?'rgba(34,199,89,0.12)':'rgba(255,59,48,0.12)';ctx.fill()
      // VMC line
      ctx.strokeStyle='#00E5FF';ctx.lineWidth=2;ctx.beginPath()
      for(let i=0;i<len;i++)i===0?ctx.moveTo(toX(i),toY(sig[i])):ctx.lineTo(toX(i),toY(sig[i]))
      ctx.stroke()
      // Signal line
      ctx.strokeStyle='#FF9500';ctx.lineWidth=1.5;ctx.beginPath()
      for(let i=0;i<len;i++)i===0?ctx.moveTo(toX(i),toY(ss[i])):ctx.lineTo(toX(i),toY(ss[i]))
      ctx.stroke()
      // BUY/SELL
      const off=n-len
      for(const idx of vmcResult.buySignals){
        const ri=idx-off;if(ri<0||ri>=len)continue;const x=toX(ri)
        ctx.fillStyle='#22C759';ctx.beginPath();ctx.moveTo(x,ch-2);ctx.lineTo(x-5,ch-12);ctx.lineTo(x+5,ch-12);ctx.closePath();ctx.fill()
      }
      for(const idx of vmcResult.sellSignals){
        const ri=idx-off;if(ri<0||ri>=len)continue;const x=toX(ri)
        ctx.fillStyle='#FF3B30';ctx.beginPath();ctx.moveTo(x,2);ctx.lineTo(x-5,12);ctx.lineTo(x+5,12);ctx.closePath();ctx.fill()
      }
      // Labels
      const last=sig[len-1]
      ctx.font='bold 9px JetBrains Mono, monospace'
      ctx.fillStyle='#00E5FF';ctx.fillText(`VMC ${last>=0?'+':''}${last.toFixed(1)}`,6,12)
      ctx.fillStyle=bull?'#22C759':'#FF3B30';ctx.fillText(bull?'▲ BULL':'▼ BEAR',75,12)
    }
    draw()
    const ro=new ResizeObserver(draw);ro.observe(canvas)
    return()=>ro.disconnect()
  },[vmcResult,candles])
  return(
    <div style={{borderTop:'1px solid #1E2330'}}>
      <div style={{padding:'3px 14px',background:'rgba(191,90,242,0.06)',display:'flex',alignItems:'center',gap:8}}>
        <span style={{fontSize:9,fontWeight:700,color:'#BF5AF2'}}>〜 VMC</span>
        <span style={{fontSize:8,color:'#555C70'}}>cyan=VMC · orange=Signal · barres=momentum · ▲▼=signaux</span>
      </div>
      <canvas ref={canvasRef} style={{width:'100%',height:90,display:'block'}}/>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// ── COMPOSANT PRINCIPAL ───────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════
type ToolId = 'cursor'|'hline'|'trendline'|'fibo'|'rect'|'note'
interface IndicatorDef { id:string; label:string; icon:string; color:string; enabled:boolean; desc:string }

export default function LightweightChart({symbol,isCrypto}:Props) {
  const chartEl  = useRef<HTMLDivElement>(null)
  const chartApi = useRef<IChartApi|null>(null)
  const seriesR  = useRef<ISeriesApi<'Candlestick'>|null>(null)
  const wsRef    = useRef<WebSocket|null>(null)
  const candlesRef = useRef<Candle[]>([])
  // Active primitives on series
  const primitives = useRef<{prim:DrawingPrimitive;id:string}[]>([])

  const [tf,       setTf]       = useState(TIMEFRAMES[2])
  const [tool,     setTool]     = useState<ToolId>('cursor')
  const [color,    setColor]    = useState('#FF9500')
  const [liveP,    setLiveP]    = useState<number|null>(null)
  const [change,   setChange]   = useState(0)
  const [loading,  setLoading]  = useState(true)
  const [drawings, setDrawings] = useState<SavedDrawing[]>([])
  const [showHist, setShowHist] = useState(false)
  const [toast,    setToast]    = useState<string|null>(null)
  const [saving,   setSaving]   = useState(false)
  const [confirmPanel, setConfirmPanel] = useState<{type:ToolId;p1:DrawingPoint;p2?:DrawingPoint}|null>(null)
  const [labelInput, setLabelInput]     = useState('')
  const [indicators, setIndicators]     = useState<IndicatorDef[]>([
    {id:'smc',label:'SMC',           icon:'🏦',color:'#0A85FF',enabled:false,desc:'Order Blocks + FVG'},
    {id:'msd',label:'Structure',     icon:'📊',color:'#22C759',enabled:false,desc:'Swing H/L + BOS/CHoCH'},
    {id:'vmc',label:'VMC Osc.',      icon:'〜',color:'#BF5AF2',enabled:false,desc:'VMC + EMA Ribbon'},
    {id:'mp', label:'Mkt Profile',   icon:'📈',color:'#FF9500',enabled:false,desc:'POC / VAH / VAL'},
  ])
  const [smcResult,setSmcResult] = useState<SMCResult|null>(null)
  const [msdResult,setMsdResult] = useState<MSDResult|null>(null)
  const [vmcResult,setVmcResult] = useState<VMCResult|null>(null)
  const [mpResult, setMpResult]  = useState<MPResult|null>(null)

  // Drawing state machine
  const phase  = useRef<'idle'|'first'>('idle')
  const firstPt = useRef<DrawingPoint|null>(null)

  const toast$ = useCallback((m:string)=>{setToast(m);setTimeout(()=>setToast(null),2500)},[])
  const isOn = (id:string) => indicators.find(i=>i.id===id)?.enabled??false
  const toggleInd = (id:string) => setIndicators(p=>p.map(i=>i.id===id?{...i,enabled:!i.enabled}:i))

  // ── Init Chart ─────────────────────────────────────────────────────────
  useEffect(()=>{
    const el=chartEl.current;if(!el)return
    const c=createChart(el,{
      width:el.clientWidth, height:430,
      layout:{background:{color:'#0D1117'},textColor:'#6B7280',fontSize:11,fontFamily:'JetBrains Mono, monospace'},
      grid:{vertLines:{color:'#1E233030'},horzLines:{color:'#1E233030'}},
      crosshair:{mode:CrosshairMode.Normal,vertLine:{color:'#555C70',style:LineStyle.Solid,width:1,labelBackgroundColor:'#2A2F3E'},horzLine:{color:'#555C70',style:LineStyle.Solid,width:1,labelBackgroundColor:'#2A2F3E'}},
      rightPriceScale:{borderColor:'#1E2330',scaleMargins:{top:0.05,bottom:0.05}},
      timeScale:{borderColor:'#1E2330',timeVisible:true,secondsVisible:false},
    })
    chartApi.current=c
    seriesR.current=c.addCandlestickSeries({
      upColor:'#22C759',downColor:'#FF3B30',
      borderUpColor:'#22C759',borderDownColor:'#FF3B30',
      wickUpColor:'#22C75980',wickDownColor:'#FF3B3080',
      priceLineVisible:false,lastValueVisible:true,
    })
    const ro=new ResizeObserver(()=>c.applyOptions({width:el.clientWidth}))
    ro.observe(el)
    return()=>{ro.disconnect();primitives.current.forEach(p=>seriesR.current?.detachPrimitive(p.prim as any));c.remove();chartApi.current=null;seriesR.current=null}
  },[])

  // ── Load candles ─────────────────────────────────────────────────────
  const load=useCallback(async()=>{
    if(!seriesR.current)return
    setLoading(true);wsRef.current?.close()
    const candles=await fetchCandles(symbol,isCrypto,tf.min)
    if(candles.length){
      seriesR.current.setData(candles.map(c=>({time:c.time as Time,open:c.open,high:c.high,low:c.low,close:c.close})))
      candlesRef.current=candles
      const last=candles[candles.length-1],first=candles[0]
      setLiveP(last.close);setChange(((last.close-first.open)/first.open)*100)
      chartApi.current?.timeScale().fitContent()
      setSmcResult(calcSMC(candles))
      setMsdResult(calcMSD(candles))
      setVmcResult(calcVMC(candles))
      setMpResult(calcMP(candles))
    }
    setLoading(false)
    if(isCrypto){
      const s=symbol.toLowerCase().replace(/usdt$/,'')+'usdt'
      const tryWS=(url:string)=>{
        const ws=new WebSocket(url)
        ws.onerror=()=>{if(url.includes('fstream'))tryWS(`wss://stream.binance.com:9443/ws/${s}@kline_${tfStr(tf.min)}`)}
        ws.onmessage=(e)=>{
          try{const k=JSON.parse(e.data).k;if(!k||!seriesR.current)return
            seriesR.current.update({time:Math.floor(k.t/1000) as Time,open:+k.o,high:+k.h,low:+k.l,close:+k.c})
            setLiveP(+k.c)
          }catch{}
        }
        wsRef.current=ws
      }
      tryWS(`wss://fstream.binance.com/ws/${s}@kline_${tfStr(tf.min)}`)
    }
  },[symbol,isCrypto,tf])

  useEffect(()=>{load()},[load])
  useEffect(()=>()=>{wsRef.current?.close()},[])

  // ── Load saved drawings ───────────────────────────────────────────────
  useEffect(()=>{
    dbLoad(symbol,tf.label).then(saved=>{
      setDrawings(saved)
      // Re-attach all saved primitives
      if(!seriesR.current)return
      primitives.current.forEach(p=>seriesR.current?.detachPrimitive(p.prim as any))
      primitives.current=[]
      saved.forEach(d=>attachDrawing(d))
    })
  },[symbol,tf.label])

  // ── Attach drawing as native primitive ───────────────────────────────
  function attachDrawing(d:Drawing) {
    if(!seriesR.current||!chartApi.current)return
    let prim:DrawingPrimitive|null=null
    if(d.type==='hline') prim=new HLinePrimitive(d.p1.price,d.color,d.label)
    else if(d.type==='trendline'&&d.p2) prim=new TrendLinePrimitive(d.p1,d.p2,d.color)
    else if(d.type==='fibo'&&d.p2) prim=new FiboPrimitive(d.p1,d.p2,d.color)
    else if(d.type==='rect'&&d.p2) prim=new RectPrimitive(d.p1,d.p2,d.color)
    else if(d.type==='note') prim=new NotePrimitive(d.p1,d.color,d.label||'Note')
    if(!prim)return
    try{
      seriesR.current.attachPrimitive(prim as any)
      primitives.current.push({prim,id:d.id||''})
    }catch(e){console.warn('attachPrimitive error:',e)}
  }

  function detachDrawing(id:string) {
    const idx=primitives.current.findIndex(p=>p.id===id)
    if(idx===-1)return
    try{seriesR.current?.detachPrimitive(primitives.current[idx].prim as any)}catch{}
    primitives.current.splice(idx,1)
  }

  // ── Click handler ─────────────────────────────────────────────────────
  const handleChartClick=useCallback((e:React.MouseEvent<HTMLDivElement>)=>{
    if(tool==='cursor')return
    const chart=chartApi.current;const ser=seriesR.current;if(!chart||!ser)return
    const rect=e.currentTarget.getBoundingClientRect()
    const x=e.clientX-rect.left,y=e.clientY-rect.top
    let time: number|null=null,price: number|null=null
    try{
      const logical=chart.timeScale().coordinateToLogical(x)
      if(logical===null)return
      // Get approximate time from logical index
      const candles=candlesRef.current
      const idx=Math.round(logical)
      const clampIdx=Math.max(0,Math.min(candles.length-1,idx))
      time=candles[clampIdx]?.time??null
      price=ser.coordinateToPrice(y)
    }catch{return}
    if(time===null||price===null)return
    const pt:DrawingPoint={time,price}

    if(tool==='hline'||tool==='note'){
      setConfirmPanel({type:tool,p1:pt});setLabelInput('')
      return
    }
    // Two-click tools
    if(phase.current==='idle'){
      phase.current='first'; firstPt.current=pt
      toast$(`1er point @ ${fmtP(price)} — cliquez le 2ème point`)
    } else {
      phase.current='idle'
      const p1=firstPt.current!;firstPt.current=null
      setConfirmPanel({type:tool,p1,p2:pt});setLabelInput('')
    }
  },[tool,toast$])

  // ── Save drawing ──────────────────────────────────────────────────────
  const handleSave=async()=>{
    if(!confirmPanel)return;setSaving(true)
    try{
      const d:Drawing={
        type:confirmPanel.type,symbol,tf:tf.label,
        p1:confirmPanel.p1,p2:confirmPanel.p2,
        label:labelInput||undefined,color,ts:Date.now()
      }
      const id=await dbSave(d)
      const saved:SavedDrawing={...d,id}
      setDrawings(prev=>[saved,...prev])
      attachDrawing(saved)
      setConfirmPanel(null);setLabelInput('')
      toast$('✓ Sauvegardé dans Firestore')
    }catch{toast$('Erreur — vérifier la connexion')}
    setSaving(false)
  }

  // ── Indicateurs — lignes natives sur le chart ─────────────────────────
  // On utilise des price lines pour les indicateurs simples (MP, etc.)
  const mpLinesRef = useRef<any[]>([])
  useEffect(()=>{
    const ser=seriesR.current;if(!ser)return
    // Remove old MP lines
    mpLinesRef.current.forEach(l=>{try{ser.removePriceLine(l)}catch{}})
    mpLinesRef.current=[]
    if(isOn('mp')&&mpResult){
      const lines=[
        {price:mpResult.poc,color:'#FF9500',label:'POC',lineStyle:LineStyle.Solid,lineWidth:2},
        {price:mpResult.vah,color:'#22C759',label:'VAH',lineStyle:LineStyle.Dashed,lineWidth:1},
        {price:mpResult.val,color:'#22C759',label:'VAL',lineStyle:LineStyle.Dashed,lineWidth:1},
      ]
      lines.forEach(l=>{
        try{
          const pl=ser.createPriceLine({price:l.price,color:l.color,lineWidth:l.lineWidth as any,lineStyle:l.lineStyle,axisLabelVisible:true,title:l.label})
          mpLinesRef.current.push(pl)
        }catch{}
      })
    }
  },[isOn('mp'),mpResult])

  // SMC overlay canvas (on top of chart)
  const overlayRef = useRef<HTMLCanvasElement>(null)

  const renderOverlay=useCallback(()=>{
    const canvas=overlayRef.current;const chart=chartApi.current;const ser=seriesR.current
    if(!canvas||!chart||!ser)return
    const dpr=window.devicePixelRatio||1
    const cw=canvas.offsetWidth,ch=canvas.offsetHeight
    canvas.width=cw*dpr;canvas.height=ch*dpr
    canvas.style.width=cw+'px';canvas.style.height=ch+'px'
    const ctx=canvas.getContext('2d')!;ctx.scale(dpr,dpr)
    ctx.clearRect(0,0,cw,ch)

    const toX=(time:number):number|null=>{try{return chart.timeScale().timeToCoordinate(time as Time)}catch{return null}}
    const toY=(price:number):number|null=>{try{return ser.priceToCoordinate(price)}catch{return null}}

    // SMC
    if(isOn('smc')&&smcResult){
      const drawZone=(top:number,btm:number,idx:number,fillColor:string,borderColor:string,label:string)=>{
        const candles=candlesRef.current
        const t=candles[idx]?.time
        const x=t?toX(t)??0:0
        const y1=toY(top),y2=toY(btm)
        if(y1==null||y2==null)return
        const H=Math.abs(y2-y1)
        ctx.fillStyle=fillColor;ctx.strokeStyle=borderColor;ctx.lineWidth=1
        ctx.fillRect(x,Math.min(y1,y2),cw-x,H)
        ctx.strokeRect(x,Math.min(y1,y2),cw-x,H)
        ctx.font='bold 9px JetBrains Mono, monospace';ctx.fillStyle=borderColor
        ctx.fillText(label,x+4,Math.min(y1,y2)+11)
      }
      for(const ob of smcResult.bullOBs)drawZone(ob.top,ob.btm,ob.idx,'rgba(10,133,255,0.1)','rgba(10,133,255,0.7)','Bull OB')
      for(const ob of smcResult.bearOBs)drawZone(ob.top,ob.btm,ob.idx,'rgba(255,59,48,0.1)','rgba(255,59,48,0.7)','Bear OB')
      for(const fvg of smcResult.bullFVGs){
        const candles=candlesRef.current;const t=candles[fvg.idx]?.time;const x=t?toX(t)??0:0
        const y1=toY(fvg.top),y2=toY(fvg.btm);if(y1==null||y2==null)continue
        ctx.fillStyle='rgba(34,199,89,0.07)';ctx.strokeStyle='rgba(34,199,89,0.5)';ctx.lineWidth=1;ctx.setLineDash([4,3])
        ctx.fillRect(x,Math.min(y1,y2),cw-x,Math.abs(y2-y1));ctx.strokeRect(x,Math.min(y1,y2),cw-x,Math.abs(y2-y1));ctx.setLineDash([])
        ctx.font='bold 9px JetBrains Mono, monospace';ctx.fillStyle='#22C759';ctx.fillText('FVG ↑',x+4,Math.min(y1,y2)+11)
      }
      for(const fvg of smcResult.bearFVGs){
        const candles=candlesRef.current;const t=candles[fvg.idx]?.time;const x=t?toX(t)??0:0
        const y1=toY(fvg.top),y2=toY(fvg.btm);if(y1==null||y2==null)continue
        ctx.fillStyle='rgba(255,149,0,0.07)';ctx.strokeStyle='rgba(255,149,0,0.5)';ctx.lineWidth=1;ctx.setLineDash([4,3])
        ctx.fillRect(x,Math.min(y1,y2),cw-x,Math.abs(y2-y1));ctx.strokeRect(x,Math.min(y1,y2),cw-x,Math.abs(y2-y1));ctx.setLineDash([])
        ctx.font='bold 9px JetBrains Mono, monospace';ctx.fillStyle='#FF9500';ctx.fillText('FVG ↓',x+4,Math.min(y1,y2)+11)
      }
    }

    // MSD — labels + BOS
    if(isOn('msd')&&msdResult){
      const candles=candlesRef.current
      ctx.font='bold 10px JetBrains Mono, monospace'
      for(const sh of msdResult.swingHighs){
        const t=candles[sh.idx]?.time;const x=t?toX(t):null;const y=toY(sh.price)
        if(x==null||y==null)continue
        ctx.fillStyle=sh.type==='HH'?'#FF3B30':'#FF9500';ctx.fillText(sh.type,x-10,y-8)
      }
      for(const sl of msdResult.swingLows){
        const t=candles[sl.idx]?.time;const x=t?toX(t):null;const y=toY(sl.price)
        if(x==null||y==null)continue
        ctx.fillStyle=sl.type==='LL'?'#22C759':'#00E5FF';ctx.fillText(sl.type,x-10,y+16)
      }
      for(const bos of msdResult.bosLines){
        const t1=candles[bos.from]?.time,t2=candles[bos.to]?.time
        const x1=t1?toX(t1):null,x2=t2?toX(t2):null;const y=toY(bos.price)
        if(x1==null||x2==null||y==null)continue
        ctx.strokeStyle=bos.type==='BOS'?(bos.dir==='bull'?'#22C759':'#FF3B30'):'#FFD60A'
        ctx.lineWidth=1;ctx.setLineDash([5,3])
        ctx.beginPath();ctx.moveTo(x1,y);ctx.lineTo(x2,y);ctx.stroke();ctx.setLineDash([])
        ctx.font='bold 9px JetBrains Mono, monospace'
        ctx.fillStyle=bos.type==='BOS'?(bos.dir==='bull'?'#22C759':'#FF3B30'):'#FFD60A'
        ctx.fillText(bos.type,(x1+x2)/2-10,y-4)
      }
    }

    // VMC signals on chart
    if(isOn('vmc')&&vmcResult){
      const candles=candlesRef.current;const off=candles.length-vmcResult.sig.length
      const bull=vmcResult.isBull[vmcResult.isBull.length-1]
      // Bottom ribbon
      ctx.fillStyle=bull?'rgba(34,199,89,0.12)':isOn('vmc')&&vmcResult.isBear[vmcResult.isBear.length-1]?'rgba(255,59,48,0.12)':'rgba(255,255,255,0.03)'
      ctx.fillRect(0,ch-10,cw,10)
      ctx.font='bold 8px JetBrains Mono, monospace';ctx.fillStyle=bull?'#22C759':'#FF3B30'
      ctx.fillText(bull?'▲ BULL RIBBON':'▼ BEAR RIBBON',6,ch-2)
      // Signals
      for(const idx of vmcResult.buySignals){
        const t=candles[idx+off]?.time;const x=t?toX(t):null;const y=toY(candles[idx+off]?.low)
        if(x==null||y==null)continue
        ctx.fillStyle='#22C759'
        ctx.beginPath();ctx.moveTo(x,y+24);ctx.lineTo(x-6,y+14);ctx.lineTo(x+6,y+14);ctx.closePath();ctx.fill()
        ctx.font='bold 8px JetBrains Mono, monospace';ctx.fillStyle='#22C759';ctx.fillText('B',x-3,y+36)
      }
      for(const idx of vmcResult.sellSignals){
        const t=candles[idx+off]?.time;const x=t?toX(t):null;const y=toY(candles[idx+off]?.high)
        if(x==null||y==null)continue
        ctx.fillStyle='#FF3B30'
        ctx.beginPath();ctx.moveTo(x,y-24);ctx.lineTo(x-6,y-14);ctx.lineTo(x+6,y-14);ctx.closePath();ctx.fill()
        ctx.font='bold 8px JetBrains Mono, monospace';ctx.fillStyle='#FF3B30';ctx.fillText('S',x-3,y-36)
      }
    }
  },[smcResult,msdResult,vmcResult,indicators])

  useEffect(()=>{
    renderOverlay()
    const c=chartApi.current;if(!c)return
    // Subscribe to ALL viewport changes: scroll, zoom, resize
    let u1:any,u2:any
    try{u1=c.timeScale().subscribeVisibleLogicalRangeChange(()=>renderOverlay())}catch{}
    try{u2=c.timeScale().subscribeVisibleTimeRangeChange(()=>renderOverlay())}catch{}
    // Also subscribe to crosshair moves — fires on every mouse move over chart
    // which catches zoom via wheel since the mouse is over the chart
    let u3:any
    try{u3=c.subscribeCrosshairMove(()=>renderOverlay())}catch{}
    return()=>{try{u1?.();u2?.();u3?.()}catch{}}
  },[renderOverlay])

  // RAF loop — catches price-scale zoom (vertical) which has no event in v4
  useEffect(()=>{
    let raf:number
    let lastKey = ''
    let lastY = 0
    const loop=()=>{
      const c=chartApi.current; const s=seriesR.current
      if(c&&s){
        try{
          const range=c.timeScale().getVisibleLogicalRange()
          // Also track price scale by sampling a reference price coordinate
          const yRef = s.priceToCoordinate(lastY||50000) ?? 0
          const key=JSON.stringify(range)+'|'+Math.round(yRef)
          if(key!==lastKey){lastKey=key;renderOverlay()}
          if(!lastY)lastY = candlesRef.current[candlesRef.current.length-1]?.close||50000
        }catch{}
      }
      raf=requestAnimationFrame(loop)
    }
    raf=requestAnimationFrame(loop)
    return()=>cancelAnimationFrame(raf)
  },[renderOverlay])

  useEffect(()=>{
    const ro=new ResizeObserver(()=>renderOverlay())
    if(overlayRef.current)ro.observe(overlayRef.current)
    return()=>ro.disconnect()
  },[renderOverlay])

  const TOOLS:{id:ToolId;icon:string;label:string}[]=[
    {id:'cursor',icon:'↖',label:'Curseur'},
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
          <div>
            <div style={{fontSize:11,fontWeight:700,color:'#F0F3FF'}}>Lightweight Charts</div>
            <div style={{fontSize:9,color:'#555C70'}}>Sauvegarde Firestore · {symbol}</div>
          </div>
        </div>
        {liveP&&(
          <div style={{display:'flex',alignItems:'baseline',gap:5,marginLeft:4}}>
            <span style={{fontSize:15,fontWeight:700,color:'#F0F3FF',fontFamily:'JetBrains Mono, monospace'}}>{fmtP(liveP)}</span>
            <span style={{fontSize:10,fontWeight:700,color:change>=0?'#22C759':'#FF3B30',fontFamily:'JetBrains Mono, monospace'}}>{change>=0?'+':''}{change.toFixed(2)}%</span>
            <span style={{fontSize:8,color:'#22C75990',animation:'pulse 1.5s infinite'}}>● LIVE</span>
          </div>
        )}
        <div style={{display:'flex',gap:3,marginLeft:4,flexWrap:'wrap'}}>
          {TIMEFRAMES.map(t=>(
            <button key={t.label} onClick={()=>setTf(t)} style={{padding:'3px 8px',borderRadius:6,fontSize:10,fontWeight:600,cursor:'pointer',
              border:`1px solid ${tf.label===t.label?'#00E5FF':'#2A2F3E'}`,
              background:tf.label===t.label?'rgba(0,229,255,0.12)':'transparent',
              color:tf.label===t.label?'#00E5FF':'#555C70'}}>{t.label}</button>
          ))}
        </div>
        <button onClick={()=>setShowHist(x=>!x)} style={{marginLeft:'auto',padding:'3px 10px',borderRadius:6,fontSize:10,fontWeight:600,cursor:'pointer',
          border:`1px solid ${showHist?'#22C759':'#2A2F3E'}`,background:showHist?'rgba(34,199,89,0.1)':'transparent',
          color:showHist?'#22C759':'#555C70',flexShrink:0}}>
          💾 {drawings.length>0?`${drawings.length} dessin${drawings.length>1?'s':''}`:' Dessins'}
        </button>
      </div>

      {/* Indicateurs */}
      <div style={{padding:'6px 14px',borderBottom:'1px solid #1E2330',display:'flex',alignItems:'center',gap:5,flexWrap:'wrap'}}>
        <span style={{fontSize:9,color:'#3D4254',fontWeight:700,flexShrink:0}}>INDICATEURS :</span>
        {indicators.map(ind=>(
          <button key={ind.id} onClick={()=>toggleInd(ind.id)} title={ind.desc}
            style={{display:'flex',alignItems:'center',gap:4,padding:'3px 10px',borderRadius:20,fontSize:10,fontWeight:600,cursor:'pointer',
              border:`1px solid ${ind.enabled?ind.color:'#2A2F3E'}`,
              background:ind.enabled?`${ind.color}18`:'transparent',
              color:ind.enabled?ind.color:'#555C70',transition:'all 0.15s'}}>
            <span>{ind.icon}</span>{ind.label}
            {ind.enabled&&<span style={{width:5,height:5,borderRadius:'50%',background:ind.color,display:'inline-block'}}/>}
          </button>
        ))}
      </div>

      {/* Outils */}
      <div style={{padding:'5px 14px',borderBottom:'1px solid #1E2330',display:'flex',alignItems:'center',gap:4,flexWrap:'wrap'}}>
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
            outline:color===c?'2px solid #F0F3FF':'none',outlineOffset:1}}/>
        ))}
        {tool!=='cursor'&&phase.current==='first'&&(
          <span style={{fontSize:10,color:'#FF9500',fontWeight:700,marginLeft:4}}>← 2ème point</span>
        )}
        {tool!=='cursor'&&phase.current==='idle'&&(
          <span style={{fontSize:9,color:'#555C70',marginLeft:4}}>Cliquez sur le graphique</span>
        )}
      </div>

      {/* Chart */}
      <div style={{position:'relative',background:'#0D1117'}} onClick={handleChartClick}>
        {loading&&(
          <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'#0D111790',zIndex:4}}>
            <div style={{width:24,height:24,border:'2px solid #1E2330',borderTopColor:'#22C759',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
          </div>
        )}
        <div ref={chartEl} style={{width:'100%',height:430}}/>
        <canvas ref={overlayRef} style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',zIndex:2,pointerEvents:'none'}}/>
      </div>

      {/* VMC Panel */}
      {isOn('vmc')&&vmcResult&&<VMCPanel vmcResult={vmcResult} candles={candlesRef.current}/>}

      {/* Confirm panel */}
      {confirmPanel&&(
        <div style={{padding:'10px 14px',background:'rgba(255,149,0,0.06)',borderTop:'1px solid rgba(255,149,0,0.2)',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <span style={{fontSize:11,fontWeight:700,color:'#FF9500',flexShrink:0}}>
            {confirmPanel.type==='hline'?`─ Ligne @ ${fmtP(confirmPanel.p1.price)}`:
             confirmPanel.type==='trendline'?`↗ Tendance ${fmtP(confirmPanel.p1.price)} → ${fmtP(confirmPanel.p2?.price??0)}`:
             confirmPanel.type==='fibo'?`◎ Fibo ${fmtP(Math.max(confirmPanel.p1.price,confirmPanel.p2?.price??0))} → ${fmtP(Math.min(confirmPanel.p1.price,confirmPanel.p2?.price??0))}`:
             confirmPanel.type==='rect'?`▭ Zone`:
             '✎ Note'}
          </span>
          <input autoFocus value={labelInput} onChange={e=>setLabelInput(e.target.value)}
            onKeyDown={e=>{if(e.key==='Enter')handleSave()}}
            placeholder={confirmPanel.type==='note'?'Texte de la note…':'Label optionnel…'}
            style={{flex:1,background:'#1C2130',border:'1px solid #2A2F3E',borderRadius:8,padding:'5px 10px',color:'#F0F3FF',fontSize:11,minWidth:120}}/>
          <button onClick={handleSave} disabled={saving} style={{padding:'5px 14px',borderRadius:8,fontSize:11,fontWeight:700,cursor:'pointer',
            background:'rgba(34,199,89,0.15)',border:'1px solid #22C759',color:'#22C759'}}>
            {saving?'…':'💾 Sauvegarder'}</button>
          <button onClick={()=>{setConfirmPanel(null);phase.current='idle'}} style={{
            padding:'5px 10px',borderRadius:8,fontSize:11,cursor:'pointer',
            background:'transparent',border:'1px solid #2A2F3E',color:'#555C70'}}>✕</button>
        </div>
      )}

      {/* History */}
      {showHist&&(
        <div style={{borderTop:'1px solid #1E2330',maxHeight:200,overflowY:'auto'}}>
          {drawings.length===0?(
            <div style={{padding:'14px',textAlign:'center',color:'#3D4254',fontSize:12}}>
              Aucun dessin pour {symbol} · {tf.label}
            </div>
          ):drawings.map(d=>(
            <div key={d.id} style={{display:'flex',alignItems:'center',gap:10,padding:'7px 14px',borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
              <div style={{width:3,height:26,borderRadius:2,background:d.color,flexShrink:0}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:11,fontWeight:600,color:'#F0F3FF'}}>
                  {d.type==='hline'?`─ Ligne @ ${fmtP(d.p1.price)}`:
                   d.type==='trendline'?`↗ Tendance`:
                   d.type==='fibo'?`◎ Fibo`:
                   d.type==='rect'?`▭ Zone`:
                   `✎ ${d.label||'Note'}`}
                </div>
                <div style={{fontSize:9,color:'#3D4254'}}>{new Date(d.ts).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
              </div>
              <button onClick={async()=>{await dbDelete(d.id);detachDrawing(d.id);setDrawings(p=>p.filter(x=>x.id!==d.id));toast$('Supprimé')}}
                style={{background:'rgba(255,59,48,0.1)',border:'1px solid rgba(255,59,48,0.2)',borderRadius:6,color:'#FF3B30',cursor:'pointer',fontSize:10,padding:'3px 8px'}}>✕</button>
            </div>
          ))}
        </div>
      )}

      {toast&&(
        <div style={{position:'absolute',bottom:16,left:'50%',transform:'translateX(-50%)',
          background:'#1C2130',border:'1px solid #2A2F3E',borderRadius:10,padding:'8px 16px',
          fontSize:12,color:'#F0F3FF',zIndex:10,whiteSpace:'nowrap',pointerEvents:'none',
          boxShadow:'0 4px 20px rgba(0,0,0,0.6)'}}>
          {toast}
        </div>
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
    </div>
  )
}
