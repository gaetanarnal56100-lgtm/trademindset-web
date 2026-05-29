/**
 * PaneLayout — TradingView Desktop clone
 * Full-height layout, flat chart pane, oscillators below with drag resize.
 * "Add indicator" button injected directly into LightweightChart's top bar.
 *
 * Layout management: imperative via groupRef.setLayout() to prevent size
 * resets when adding/removing panes. Current sizes tracked in layoutRef.
 */

import React, { useState, useCallback, useRef } from 'react'
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels'
import LightweightChart from '@/pages/analyse/LightweightChart'
import { WaveTrendChart, VMCOscillatorChart, RSIChart, RSIBollingerChart } from '@/pages/analyse/OscillatorCharts'
import OUChannelIndicator from '@/pages/analyse/OUChannelIndicator'

// ── Types ──────────────────────────────────────────────────────────────────────

export type OscType = 'wavetrend' | 'vmc' | 'rsi' | 'rsibollinger' | 'ou'
type OscPane = { id: string; type: OscType }
type SyncRange = { from: number; to: number; areaRatio?: number; fromMs?: number; toMs?: number }
type Layout = { [id: string]: number }
interface GroupImperativeHandle { getLayout: () => Layout; setLayout: (l: Layout) => Layout }

interface PaneLayoutProps {
  symbol: string
  isCrypto: boolean
  syncInterval: string
  onIntervalChange: (i: string) => void
  syncRange: SyncRange | null
  onRangeChange: (r: SyncRange) => void
  crosshairFrac: number | null
  onCrosshairChange: (f: number | null) => void
}

// ── Oscillator definitions ────────────────────────────────────────────────────

const OSC_DEFS: Record<OscType, { icon: string; label: string; color: string }> = {
  wavetrend:    { icon: '〰', label: 'WaveTrend',       color: '#BF5AF2' },
  vmc:          { icon: '〜', label: 'VMC Oscillateur',  color: '#00E5FF' },
  rsi:          { icon: '📈', label: 'RSI',             color: '#34C759' },
  rsibollinger: { icon: '◈',  label: 'RSI Bollinger',   color: '#FF9F0A' },
  ou:           { icon: '≋',  label: 'Canal OU',        color: '#0A85FF' },
}

const OSC_ORDER: OscType[] = ['wavetrend', 'vmc', 'rsi', 'rsibollinger', 'ou']
const LS_PANES  = 'tm_tv_panes_v2'
const CHART_ID  = 'chart'
const NEW_OSC_SIZE = 15   // % given to a freshly added oscillator pane
const MIN_CHART   = 25   // % floor for the chart pane

// ── Drag handle ───────────────────────────────────────────────────────────────

function DragHandle() {
  return (
    <PanelResizeHandle style={{
      height: 4, background: '#0D1117', cursor: 'row-resize',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, position: 'relative', zIndex: 5,
    }}>
      <div style={{ width: 40, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.10)' }} />
    </PanelResizeHandle>
  )
}

// ── Oscillator pane ───────────────────────────────────────────────────────────

interface OscShellProps {
  pane: OscPane
  symbol: string
  syncInterval: string
  syncRange: SyncRange | null
  crosshairFrac: number | null
  onCrosshairChange: (f: number | null) => void
  onRangeChange: (r: SyncRange) => void
  onRemove: (id: string) => void
}

function OscShell({ pane, symbol, syncInterval, syncRange, crosshairFrac, onCrosshairChange, onRangeChange, onRemove }: OscShellProps) {
  const def = OSC_DEFS[pane.type]
  const shared = { symbol, syncInterval, visibleRange: syncRange, crosshairFrac, onCrosshairChange, onRangeChange }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0D1117' }}>
      {/* Pane header — TradingView style */}
      <div style={{
        height: 26, flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '0 10px 0 48px',
        background: 'rgba(13,17,35,0.98)',
        borderBottom: '1px solid #1A1F2E',
      }}>
        <span style={{ fontSize: 11, color: def.color, fontWeight: 700, fontFamily: 'JetBrains Mono,monospace', letterSpacing: 0.3 }}>
          {def.icon} {def.label}
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => onRemove(pane.id)}
          title="Fermer"
          style={{
            width: 18, height: 18, borderRadius: 4, fontSize: 10, cursor: 'pointer',
            border: 'none', background: 'transparent',
            color: 'rgba(255,255,255,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#FF3B30')}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.2)')}
        >✕</button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {pane.type === 'wavetrend'    && <WaveTrendChart {...shared} />}
        {pane.type === 'vmc'          && <VMCOscillatorChart {...shared} />}
        {pane.type === 'rsi'          && <RSIChart {...shared} />}
        {pane.type === 'rsibollinger' && <RSIBollingerChart {...shared} />}
        {pane.type === 'ou'           && <OUChannelIndicator {...shared} />}
      </div>
    </div>
  )
}

// ── Add Indicator button (injected into LW top bar) ───────────────────────────

interface AddIndicatorBtnProps {
  oscPanes: OscPane[]
  onAdd: (type: OscType) => void
  onRemove: (id: string) => void
}

function AddIndicatorBtn({ oscPanes, onAdd, onRemove }: AddIndicatorBtnProps) {
  const [open, setOpen] = useState(false)
  const addedTypes = new Set(oscPanes.map(p => p.type))
  const available  = OSC_ORDER.filter(t => !addedTypes.has(t))

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '2px 9px', borderRadius: 5, cursor: 'pointer', fontSize: 10, fontWeight: 600,
          border: `1px solid ${open ? 'var(--tm-accent)' : 'rgba(255,255,255,0.12)'}`,
          background: open ? 'rgba(0,229,255,0.1)' : 'transparent',
          color: open ? 'var(--tm-accent)' : 'rgba(255,255,255,0.5)',
        }}
      >
        + Indicateur
      </button>

      {/* Active pane chips */}
      {oscPanes.map(p => (
        <span key={p.id} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          marginLeft: 4, padding: '2px 7px 2px 6px', borderRadius: 4,
          background: `${OSC_DEFS[p.type].color}18`,
          border: `1px solid ${OSC_DEFS[p.type].color}35`,
          fontSize: 9, fontWeight: 700, color: OSC_DEFS[p.type].color,
        }}>
          {OSC_DEFS[p.type].label}
          <button
            onClick={() => onRemove(p.id)}
            style={{ fontSize: 8, cursor: 'pointer', background: 'none', border: 'none', color: 'inherit', padding: 0, opacity: 0.6, lineHeight: 1 }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
          >✕</button>
        </span>
      ))}

      {/* Dropdown */}
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 48 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50,
            background: 'rgba(8,12,20,0.99)', border: '1px solid #2A2F3E', borderRadius: 10,
            padding: '6px', minWidth: 190, boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
            backdropFilter: 'blur(16px)',
          }}>
            {available.length === 0
              ? <div style={{ padding: '8px 10px', fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Tous ajoutés</div>
              : available.map(type => {
                const d = OSC_DEFS[type]
                return (
                  <button key={type} onClick={() => { onAdd(type); setOpen(false) }} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '7px 10px', borderRadius: 7,
                    fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    border: 'none', background: 'transparent', color: d.color, textAlign: 'left',
                  }}
                    onMouseEnter={e => (e.currentTarget.style.background = `${d.color}18`)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ fontSize: 14, width: 18 }}>{d.icon}</span>
                    {d.label}
                  </button>
                )
              })}
          </div>
        </>
      )}
    </div>
  )
}

// ── UID ───────────────────────────────────────────────────────────────────────

let _uid = 0
function uid() { return `p${++_uid}` }

// ── Main component ─────────────────────────────────────────────────────────────

export default function PaneLayout({
  symbol, isCrypto, syncInterval, onIntervalChange,
  syncRange, onRangeChange, crosshairFrac, onCrosshairChange,
}: PaneLayoutProps) {

  const [oscPanes, setOscPanes] = useState<OscPane[]>(() => {
    try {
      const saved = localStorage.getItem(LS_PANES)
      if (saved) return JSON.parse(saved)
    } catch {}
    return [
      { id: uid(), type: 'wavetrend' as OscType },
      { id: uid(), type: 'vmc'       as OscType },
      { id: uid(), type: 'rsi'       as OscType },
    ]
  })

  // ── Imperative layout management ──────────────────────────────────────────
  const groupRef   = useRef<GroupImperativeHandle | null>(null)
  const layoutRef  = useRef<Layout>({})  // last known layout from onLayoutChanged

  const handleLayoutChanged = useCallback((layout: Layout) => {
    layoutRef.current = layout
  }, [])

  // Redistribute sizes: scale existing panels by `scale`, add new entry for `newId`
  const applyLayoutAfterAdd = useCallback((newId: string) => {
    requestAnimationFrame(() => {
      const gr = groupRef.current
      if (!gr) return
      const cur = layoutRef.current
      const ids = Object.keys(cur)
      if (ids.length === 0) return

      const total     = Object.values(cur).reduce((a, b) => a + b, 0)
      const scale     = (total - NEW_OSC_SIZE) / total
      const newLayout: Layout = {}
      ids.forEach(id => {
        // Ensure chart pane never shrinks below MIN_CHART
        const scaled = (cur[id] ?? 0) * scale
        newLayout[id] = id === CHART_ID ? Math.max(MIN_CHART, scaled) : scaled
      })
      newLayout[newId] = NEW_OSC_SIZE
      gr.setLayout(newLayout)
    })
  }, [])

  const applyLayoutAfterRemove = useCallback((removedId: string) => {
    requestAnimationFrame(() => {
      const gr = groupRef.current
      if (!gr) return
      const cur = layoutRef.current
      const removedSize = cur[removedId] ?? 0
      const remaining: Layout = {}
      let remainingTotal = 0
      Object.entries(cur).forEach(([k, v]) => {
        if (k !== removedId) { remaining[k] = v; remainingTotal += v }
      })
      if (remainingTotal === 0) return
      // Distribute removed space proportionally to remaining panels
      const newLayout: Layout = {}
      Object.entries(remaining).forEach(([k, v]) => {
        newLayout[k] = v + (v / remainingTotal) * removedSize
      })
      gr.setLayout(newLayout)
    })
  }, [])

  const save = useCallback((next: OscPane[]) => {
    localStorage.setItem(LS_PANES, JSON.stringify(next))
  }, [])

  const addPane = useCallback((type: OscType) => {
    const newId = uid()
    setOscPanes(prev => {
      const next = [...prev, { id: newId, type }]
      save(next)
      return next
    })
    applyLayoutAfterAdd(newId)
  }, [save, applyLayoutAfterAdd])

  const removePane = useCallback((id: string) => {
    applyLayoutAfterRemove(id)
    setOscPanes(prev => {
      const next = prev.filter(p => p.id !== id)
      save(next)
      return next
    })
  }, [save, applyLayoutAfterRemove])

  // ── Default sizes (used only on first mount) ──────────────────────────────
  const n           = oscPanes.length
  const chartSize   = n === 0 ? 100 : Math.max(45, Math.round(100 - n * 16))
  const oscSize     = n === 0 ? 0   : Math.round((100 - chartSize) / n)

  const TOTAL_H = 'calc(100vh - 160px)'

  const topBarExtra = (
    <AddIndicatorBtn oscPanes={oscPanes} onAdd={addPane} onRemove={removePane} />
  )

  return (
    <div style={{ margin: '0 -28px', background: '#0D1117' }}>
      {n === 0 ? (
        <div style={{ height: TOTAL_H }}>
          <LightweightChart
            symbol={symbol} isCrypto={isCrypto}
            onTimeframeChange={onIntervalChange}
            onVisibleRangeChange={(from, to, areaRatio, fromMs, toMs) => onRangeChange({ from, to, areaRatio, fromMs, toMs })}
            onCrosshairChange={d => onCrosshairChange(d ? d.frac : null)}
            externalCrosshairFrac={crosshairFrac}
            syncRangeIn={syncRange}
            autoHeight flat
            topBarExtra={topBarExtra}
          />
        </div>
      ) : (
        <PanelGroup
          orientation="vertical"
          style={{ height: TOTAL_H }}
          groupRef={groupRef}
          onLayoutChanged={handleLayoutChanged}
        >
          {/* ── Chart pane ── */}
          <Panel id={CHART_ID} defaultSize={chartSize} minSize={20}>
            <LightweightChart
              symbol={symbol} isCrypto={isCrypto}
              onTimeframeChange={onIntervalChange}
              onVisibleRangeChange={(from, to, areaRatio, fromMs, toMs) => onRangeChange({ from, to, areaRatio, fromMs, toMs })}
              onCrosshairChange={d => onCrosshairChange(d ? d.frac : null)}
              externalCrosshairFrac={crosshairFrac}
              syncRangeIn={syncRange}
              autoHeight flat
              topBarExtra={topBarExtra}
            />
          </Panel>

          {/* ── Oscillator panes ── */}
          {oscPanes.map(pane => (
            <React.Fragment key={pane.id}>
              <DragHandle />
              <Panel id={pane.id} defaultSize={oscSize} minSize={7}>
                <OscShell
                  pane={pane}
                  symbol={symbol}
                  syncInterval={syncInterval}
                  syncRange={syncRange}
                  crosshairFrac={crosshairFrac}
                  onCrosshairChange={onCrosshairChange}
                  onRangeChange={onRangeChange}
                  onRemove={removePane}
                />
              </Panel>
            </React.Fragment>
          ))}
        </PanelGroup>
      )}
    </div>
  )
}
