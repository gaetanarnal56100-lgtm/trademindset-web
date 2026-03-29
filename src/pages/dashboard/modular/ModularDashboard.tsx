// ─── ModularDashboard v2 ──────────────────────────────────────────────────────
// Grille libre 12 colonnes avec resize E/S/SE par poignées natives.
// Toutes les données journal sont injectées via WidgetDataContext → pas de
// re-fetch dans chaque widget.

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, closestCenter,
  defaultDropAnimationSideEffects,
} from '@dnd-kit/core'
import {
  SortableContext, rectSortingStrategy,
  sortableKeyboardCoordinates, arrayMove,
} from '@dnd-kit/sortable'
import { restrictToWindowEdges } from '@dnd-kit/modifiers'

import { useDashboardStore } from './store'
import { DraggableWidget } from './DraggableWidget'
import { RenderWidget } from './widgets/RenderWidget'
import { WidgetPicker } from './WidgetPicker'
import { WIDGET_REGISTRY, PresetName, GRID_COLS } from './types'

import { WidgetDataContext, type WidgetDataContextType, type DashboardStats, type DashboardEmotions } from './WidgetDataContext'
import { subscribeTrades, subscribeSystems, subscribeMoods, tradePnL, type Trade, type TradingSystem, type MoodEntry } from '@/services/firestore'

// ─── Stats computation (mirror of DashboardPage) ─────────────────────────────
function safeTime(d: any): number {
  if (!d) return 0
  if (typeof d?.getTime === 'function') { const t = d.getTime(); return isNaN(t) ? 0 : t }
  if (typeof d?.seconds === 'number') return d.seconds * 1000
  if (typeof d === 'number') return d
  return 0
}

function calcStats(trades: Trade[]): DashboardStats {
  const closed = trades.filter(t => t.status==='closed').sort((a,b) => safeTime(a.date)-safeTime(b.date))
  const pnls = closed.map(tradePnL)
  const wins = pnls.filter(p => p>0), losses = pnls.filter(p => p<=0)
  const totalPnL = pnls.reduce((a,b) => a+b, 0)
  const winRate = closed.length>0 ? wins.length/closed.length*100 : 0
  const avgWin  = wins.length>0   ? wins.reduce((a,b)=>a+b,0)/wins.length     : 0
  const avgLoss = losses.length>0 ? Math.abs(losses.reduce((a,b)=>a+b,0)/losses.length) : 0
  const payoffRatio = avgLoss>0 ? avgWin/avgLoss : 0
  const expectancy  = (winRate/100)*avgWin - (1-winRate/100)*avgLoss
  const fees = closed.reduce((a,t) => a+(t.quantity||0)*(t.entryPrice||0)*0.001, 0)
  let cum=0, peak=0, maxDD=0
  for (const p of pnls) { cum+=p; if(cum>peak)peak=cum; const dd=peak-cum; if(dd>maxDD)maxDD=dd }
  const returns=pnls.map(p=>p/1000*100), avgRet=returns.length?returns.reduce((a,b)=>a+b,0)/returns.length:0
  const variance=returns.length?returns.reduce((a,b)=>a+Math.pow(b-avgRet,2),0)/returns.length:0
  const sharpe=Math.sqrt(variance)>0?avgRet/Math.sqrt(variance):0
  let bestStreak=0, worstStreak=0, cur=0
  for (const p of pnls) { if(p>0){cur=cur>0?cur+1:1}else{cur=cur<0?cur-1:-1}; if(cur>bestStreak)bestStreak=cur; if(cur<worstStreak)worstStreak=cur }
  let currentStreak=0
  for (let i=pnls.length-1;i>=0;i--) { if(i===pnls.length-1){currentStreak=pnls[i]>0?1:-1;continue}; if((pnls[i]>0)===(currentStreak>0))currentStreak+=currentStreak>0?1:-1;else break }
  const longs=closed.filter(t=>t.type==='Long'), shorts=closed.filter(t=>t.type==='Short')
  const lp=longs.map(tradePnL), sp=shorts.map(tradePnL)
  const longWR =longs.length  ? longs.filter((_,i)=>lp[i]>0).length/longs.length*100  : 0
  const shortWR=shorts.length ? shorts.filter((_,i)=>sp[i]>0).length/shorts.length*100 : 0
  return { totalPnL,winRate,avgWin,avgLoss,payoffRatio,expectancy,fees,maxDD,sharpe,
    bestStreak,worstStreak:Math.abs(worstStreak),currentStreak,
    wins:wins.length,losses:losses.length,total:closed.length,
    longs:longs.length,shorts:shorts.length,longWR,shortWR,
    longPnL:lp.reduce((a,b)=>a+b,0), shortPnL:sp.reduce((a,b)=>a+b,0) }
}

function emotionScore(state: string): number {
  const m: Record<string,number> = { confident:4,calm:4,focused:4,excited:3,stressed:2,impatient:2,fearful:1,greedy:2,frustrated:1,distracted:2 }
  return m[state] ?? 3
}
function calcEmotions(moods: MoodEntry[], trades: Trade[]): DashboardEmotions | null {
  if (!moods.length) return null
  const avg = moods.reduce((a,m) => a+emotionScore(m.emotionalState), 0) / moods.length
  const avgState = avg>=3.5?'Confiant':avg>=2.5?'Neutre':avg>=1.5?'Stressé':'Impulsif'
  const sorted = [...trades].filter(t=>t.status==='closed').sort((a,b)=>safeTime(b.date)-safeTime(a.date))
  let consec=0; for(const t of sorted){if(tradePnL(t)<0)consec++;else break}
  const risk   = consec>=3?'Élevé':consec>=2?'Prudence':'Faible'
  const impact = avg>=3.5?'Positif':avg>=2.5?'Neutre':'Négatif'
  const advice = consec>=3?'Pause recommandée':avg>=3.5?'Continuer':'Réduire la taille'
  return { avgState, risk, impact, advice, consec, entries:moods.length }
}

// ─── Drop animation ────────────────────────────────────────────────────────────
const dropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity:'0.4' } } }),
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function ModularDashboard() {
  const {
    layout, setLayout, editMode, setEditMode,
    activePreset, loadPreset, symbol, setSymbol,
    firestoreReady, initFromFirestore,
  } = useDashboardStore()

  // ── Journal data ──────────────────────────────────────────────────────────
  const [trades,  setTrades]  = useState<Trade[]>([])
  const [systems, setSystems] = useState<TradingSystem[]>([])
  const [moods,   setMoods]   = useState<MoodEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [period,  setPeriod]  = useState('1M')

  useEffect(() => {
    const u1 = subscribeTrades(t => { setTrades(t); setLoading(false) })
    const u2 = subscribeSystems(setSystems)
    const u3 = subscribeMoods(setMoods)
    return () => { u1(); u2(); u3() }
  }, [])

  const s   = useMemo(() => calcStats(trades), [trades])
  const emo = useMemo(() => calcEmotions(moods, trades), [moods, trades])
  const closed = useMemo(() => trades.filter(t => t.status==='closed'), [trades])
  const open   = useMemo(() => trades.filter(t => t.status==='open'), [trades])
  const recent = useMemo(() => [...trades].sort((a,b) => safeTime(b.date)-safeTime(a.date)).slice(0,8), [trades])

  const widgetCtx = useMemo<WidgetDataContextType>(() => ({
    trades, systems, moods, loading, s, emo, closed, open, recent,
    period, setPeriod, tradePnLFn: tradePnL,
  }), [trades, systems, moods, loading, s, emo, closed, open, recent, period])

  // ── Firestore init ────────────────────────────────────────────────────────
  useEffect(() => { initFromFirestore() }, []) // eslint-disable-line

  // ── Container width for resize calc ──────────────────────────────────────
  const gridRef = useRef<HTMLDivElement>(null)
  const [containerW, setContainerW] = useState(0)
  useEffect(() => {
    if (!gridRef.current) return
    const obs = new ResizeObserver(e => setContainerW(e[0].contentRect.width))
    obs.observe(gridRef.current)
    setContainerW(gridRef.current.getBoundingClientRect().width)
    return () => obs.disconnect()
  }, [])

  // ── DnD ──────────────────────────────────────────────────────────────────
  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragStart = useCallback((e: DragStartEvent) => setActiveId(e.active.id as string), [])
  const handleDragEnd = useCallback((e: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oi = layout.findIndex(i => i.id === active.id)
    const ni = layout.findIndex(i => i.id === over.id)
    if (oi === -1 || ni === -1) return
    setLayout(arrayMove(layout, oi, ni).map((item, idx) => ({ ...item, order: idx })))
  }, [layout, setLayout])

  const activeItem = activeId ? layout.find(i => i.id === activeId) : null

  const [showPicker, setShowPicker] = useState(false)

  // ── Sync badge ────────────────────────────────────────────────────────────
  const [syncVisible, setSyncVisible] = useState(false)
  useEffect(() => {
    const handler = () => { setSyncVisible(true); setTimeout(() => setSyncVisible(false), 2500) }
    window.addEventListener('dashboard:synced', handler)
    return () => window.removeEventListener('dashboard:synced', handler)
  }, [])

  if (!firestoreReady) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-10 w-72 bg-bg-secondary rounded-xl animate-pulse" />
        <div className="grid grid-cols-12 gap-3">
          {[12,12,6,6,12].map((w,i) => (
            <div key={i} className={`col-span-${w} h-40 bg-bg-secondary rounded-2xl animate-pulse border border-border-subtle`} />
          ))}
        </div>
      </div>
    )
  }

  const presets: { name: PresetName; label: string; icon: string }[] = [
    { name:'journal', label:'Journal', icon:'📒' },
    { name:'analyse', label:'Analyse', icon:'🔬' },
    { name:'custom',  label:'Custom',  icon:'⚙'  },
  ]

  return (
    <WidgetDataContext.Provider value={widgetCtx}>
      <div className="flex flex-col gap-4">

        {/* ── Toolbar ── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Presets */}
          <div className="flex items-center gap-1 bg-bg-secondary border border-border rounded-xl p-1">
            {presets.map(p => (
              <button key={p.name} onClick={() => loadPreset(p.name)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                  ${activePreset===p.name ? 'bg-brand-cyan/15 text-brand-cyan' : 'text-text-muted hover:text-text-secondary hover:bg-bg-tertiary'}`}>
                <span>{p.icon}</span><span>{p.label}</span>
              </button>
            ))}
          </div>

          {/* Symbol */}
          <form onSubmit={e => { e.preventDefault(); const fd = new FormData(e.currentTarget); setSymbol((fd.get('sym') as string).toUpperCase()) }}
            className="flex items-center gap-2">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[11px] font-mono">$</span>
              <input name="sym" defaultValue={symbol}
                className="pl-6 pr-3 py-1.5 bg-bg-secondary border border-border rounded-lg text-xs font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-cyan/50 w-28"
                placeholder="BTCUSDT" />
            </div>
            <button type="submit" className="px-2.5 py-1.5 bg-brand-cyan/15 border border-brand-cyan/30 rounded-lg text-[11px] font-medium text-brand-cyan hover:bg-brand-cyan/20 transition-colors">OK</button>
          </form>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {editMode && (
              <button onClick={() => setShowPicker(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary border border-border rounded-xl text-xs text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-all">
                + Widget
              </button>
            )}
            <button onClick={() => setEditMode(!editMode)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all border
                ${editMode ? 'bg-brand-cyan text-bg-primary border-brand-cyan' : 'bg-bg-secondary border-border text-text-secondary hover:border-brand-cyan/40 hover:text-brand-cyan'}`}>
              {editMode
                ? <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg><span>Terminé</span></>
                : <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><span>Éditer</span></>
              }
            </button>
          </div>
        </div>

        {/* Edit mode hint */}
        {editMode && (
          <div className="flex items-center gap-2 px-3 py-2 bg-brand-cyan/5 border border-brand-cyan/15 rounded-xl text-[11px] text-brand-cyan/80">
            <span>⟡</span>
            <span>Glissez pour réorganiser · Poignées <strong>→ ↓ ↘</strong> pour redimensionner (largeur, hauteur, diagonal)</span>
          </div>
        )}

        {/* ── Grid ── */}
        <DndContext sensors={sensors} collisionDetection={closestCenter}
          onDragStart={handleDragStart} onDragEnd={handleDragEnd}
          modifiers={[restrictToWindowEdges]}>
          <SortableContext items={layout.map(i => i.id)} strategy={rectSortingStrategy}>
            <div ref={gridRef}
              className="grid gap-3"
              style={{ gridTemplateColumns:`repeat(${GRID_COLS},1fr)` }}>
              {layout.map(item => (
                <DraggableWidget key={item.id} item={item} containerWidth={containerW}>
                  <RenderWidget widgetId={item.widgetId} symbol={symbol} />
                </DraggableWidget>
              ))}

              {/* Add widget placeholder */}
              {editMode && (
                <div className="col-span-2"
                  style={{ gridColumn:'span 2', minHeight: 80 }}>
                  <button onClick={() => setShowPicker(true)}
                    className="w-full h-full min-h-[80px] flex flex-col items-center justify-center gap-1
                      border border-dashed border-border rounded-2xl text-text-muted
                      hover:border-brand-cyan/40 hover:text-brand-cyan hover:bg-brand-cyan/5 transition-all group">
                    <span className="text-xl group-hover:scale-110 transition-transform">+</span>
                    <span className="text-[10px] font-medium">Ajouter</span>
                  </button>
                </div>
              )}
            </div>
          </SortableContext>

          <DragOverlay dropAnimation={dropAnimation}>
            {activeItem ? (
              <div style={{ gridColumn:`span ${activeItem.w}` }} className="pointer-events-none">
                <div className="card opacity-80 shadow-2xl ring-1 ring-brand-cyan/30 rotate-1 scale-105"
                  style={{ height: activeItem.h * 80 }}>
                  <div className="px-4 py-3 flex items-center gap-2">
                    <span>{WIDGET_REGISTRY[activeItem.widgetId].icon}</span>
                    <span className="text-xs font-medium text-text-secondary">{WIDGET_REGISTRY[activeItem.widgetId].label}</span>
                  </div>
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {showPicker && <WidgetPicker onClose={() => setShowPicker(false)} />}

        {/* Sync badge */}
        {syncVisible && (
          <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-3 py-2
            bg-bg-secondary border border-profit/30 rounded-xl shadow-lg animate-fade-in">
            <span className="w-1.5 h-1.5 rounded-full bg-profit animate-pulse" />
            <span className="text-[11px] font-medium text-profit">Disposition sauvegardée</span>
          </div>
        )}
      </div>
    </WidgetDataContext.Provider>
  )
}
