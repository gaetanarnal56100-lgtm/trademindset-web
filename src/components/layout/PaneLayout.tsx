/**
 * PaneLayout — TradingView-style resizable multi-pane layout
 * Uses react-resizable-panels v4 for drag-to-resize handles.
 * Layout + pane types persisted in localStorage.
 */

import React, { useState, useCallback } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import LightweightChart from '@/pages/analyse/LightweightChart'
import type { LightweightChartHandle } from '@/pages/analyse/LightweightChart'
import { WaveTrendChart, VMCOscillatorChart, RSIChart, RSIBollingerChart } from '@/pages/analyse/OscillatorCharts'
import OUChannelIndicator from '@/pages/analyse/OUChannelIndicator'

// ── Types ──────────────────────────────────────────────────────────────────────

export type PaneType =
  | 'chart' | 'wavetrend' | 'vmc' | 'rsi' | 'rsibollinger' | 'ou' | 'empty'

export type LayoutKey = '1' | '2v' | '3v' | '4v' | '2h' | '22'

type SyncRange = { from: number; to: number; areaRatio?: number; fromMs?: number; toMs?: number }

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

// ── Constants ─────────────────────────────────────────────────────────────────

const PANE_LABELS: Record<PaneType, string> = {
  chart:        '📊 Chart',
  wavetrend:    '🌊 WaveTrend',
  vmc:          '🔮 VMC',
  rsi:          '📈 RSI',
  rsibollinger: '📊 RSI Bollinger',
  ou:           '〜 Canal OU',
  empty:        '⬜ Vide',
}

const PANE_OPTIONS = Object.entries(PANE_LABELS) as [PaneType, string][]

const DEFAULT_PANES: Record<LayoutKey, PaneType[]> = {
  '1':  ['chart'],
  '2v': ['chart', 'wavetrend'],
  '3v': ['chart', 'wavetrend', 'vmc'],
  '4v': ['chart', 'wavetrend', 'vmc', 'rsi'],
  '2h': ['chart', 'chart'],
  '22': ['chart', 'wavetrend', 'vmc', 'rsi'],
}

interface LayoutDef { key: LayoutKey; label: string; count: number }
const LAYOUTS: LayoutDef[] = [
  { key: '1',  label: '▣',   count: 1 },
  { key: '2v', label: '⬛\n⬛',  count: 2 },
  { key: '3v', label: '⬛×3', count: 3 },
  { key: '4v', label: '⬛×4', count: 4 },
  { key: '2h', label: '◨◧',  count: 2 },
  { key: '22', label: '⊞',   count: 4 },
]

const LS_LAYOUT = 'tm_pane_layout'
const LS_PANES  = 'tm_pane_types'

// ── Resize handles ─────────────────────────────────────────────────────────────

function RV() {
  return (
    <PanelResizeHandle style={{
      height: 6, background: 'transparent', cursor: 'row-resize',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      <div style={{ width: 36, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.13)' }} />
    </PanelResizeHandle>
  )
}

function RH() {
  return (
    <PanelResizeHandle style={{
      width: 6, background: 'transparent', cursor: 'col-resize',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      <div style={{ width: 3, height: 36, borderRadius: 2, background: 'rgba(255,255,255,0.13)' }} />
    </PanelResizeHandle>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function PaneLayout({
  symbol, isCrypto, syncInterval, onIntervalChange,
  syncRange, onRangeChange, crosshairFrac, onCrosshairChange,
}: PaneLayoutProps) {

  const [layout, setLayout] = useState<LayoutKey>(() =>
    (localStorage.getItem(LS_LAYOUT) as LayoutKey) || '2v'
  )

  const [panes, setPanes] = useState<PaneType[]>(() => {
    try {
      const saved = localStorage.getItem(LS_PANES)
      if (saved) return JSON.parse(saved)
    } catch {}
    return DEFAULT_PANES['2v']
  })

  const changeLayout = useCallback((key: LayoutKey) => {
    const def = DEFAULT_PANES[key]
    setLayout(key)
    localStorage.setItem(LS_LAYOUT, key)
    setPanes(prev => {
      const next = def.map((d, i) => prev[i] ?? d)
      localStorage.setItem(LS_PANES, JSON.stringify(next))
      return next
    })
  }, [])

  const changePane = useCallback((idx: number, type: PaneType) => {
    setPanes(prev => {
      const next = [...prev]; next[idx] = type
      localStorage.setItem(LS_PANES, JSON.stringify(next))
      return next
    })
  }, [])

  // Shared props passed to every pane
  const shared = { symbol, isCrypto, syncInterval, onIntervalChange, syncRange, onRangeChange, crosshairFrac, onCrosshairChange }

  const pane = (idx: number) => (
    <PaneShell
      key={idx}
      idx={idx}
      type={panes[idx] ?? 'empty'}
      onTypeChange={t => changePane(idx, t)}
      {...shared}
    />
  )

  const totalH = 'calc(100vh - 220px)'

  let grid: React.ReactNode
  switch (layout) {
    case '1':
      grid = <div style={{ height: totalH }}>{pane(0)}</div>
      break
    case '2v':
      grid = (
        <PanelGroup direction="vertical" style={{ height: totalH }}>
          <Panel defaultSize={62} minSize={12}>{pane(0)}</Panel>
          <RV />
          <Panel defaultSize={38} minSize={10}>{pane(1)}</Panel>
        </PanelGroup>
      )
      break
    case '3v':
      grid = (
        <PanelGroup direction="vertical" style={{ height: totalH }}>
          <Panel defaultSize={50} minSize={12}>{pane(0)}</Panel>
          <RV />
          <Panel defaultSize={25} minSize={8}>{pane(1)}</Panel>
          <RV />
          <Panel defaultSize={25} minSize={8}>{pane(2)}</Panel>
        </PanelGroup>
      )
      break
    case '4v':
      grid = (
        <PanelGroup direction="vertical" style={{ height: totalH }}>
          <Panel defaultSize={44} minSize={12}>{pane(0)}</Panel>
          <RV />
          <Panel defaultSize={20} minSize={8}>{pane(1)}</Panel>
          <RV />
          <Panel defaultSize={18} minSize={8}>{pane(2)}</Panel>
          <RV />
          <Panel defaultSize={18} minSize={8}>{pane(3)}</Panel>
        </PanelGroup>
      )
      break
    case '2h':
      grid = (
        <PanelGroup direction="horizontal" style={{ height: totalH }}>
          <Panel defaultSize={50} minSize={20}>{pane(0)}</Panel>
          <RH />
          <Panel defaultSize={50} minSize={20}>{pane(1)}</Panel>
        </PanelGroup>
      )
      break
    case '22':
      grid = (
        <PanelGroup direction="vertical" style={{ height: totalH }}>
          <Panel defaultSize={50} minSize={15}>
            <PanelGroup direction="horizontal" style={{ height: '100%' }}>
              <Panel defaultSize={50} minSize={20}>{pane(0)}</Panel>
              <RH />
              <Panel defaultSize={50} minSize={20}>{pane(1)}</Panel>
            </PanelGroup>
          </Panel>
          <RV />
          <Panel defaultSize={50} minSize={15}>
            <PanelGroup direction="horizontal" style={{ height: '100%' }}>
              <Panel defaultSize={50} minSize={20}>{pane(2)}</Panel>
              <RH />
              <Panel defaultSize={50} minSize={20}>{pane(3)}</Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      )
      break
    default:
      grid = <div style={{ height: totalH }}>{pane(0)}</div>
  }

  return (
    <div style={{ position: 'relative', zIndex: 1 }}>

      {/* Layout selector toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '5px 10px', marginBottom: 8,
        background: 'rgba(13,17,35,0.8)',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 10,
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.3)', marginRight: 6 }}>LAYOUT</span>
        {LAYOUTS.map(l => (
          <button
            key={l.key}
            onClick={() => changeLayout(l.key)}
            title={`${l.count} panneau${l.count > 1 ? 'x' : ''}`}
            style={{
              padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
              fontSize: 11, fontWeight: 600,
              color: layout === l.key ? 'var(--tm-accent)' : 'rgba(255,255,255,0.4)',
              background: layout === l.key ? 'rgba(0,229,255,0.12)' : 'transparent',
              border: `1px solid ${layout === l.key ? 'rgba(0,229,255,0.4)' : 'transparent'}`,
              transition: 'all 0.15s',
            }}
          >
            {l.label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'rgba(0,229,255,0.4)' }}>
          ⚡ Synchronisé
        </span>
      </div>

      {grid}
    </div>
  )
}

// ── Pane shell (header + content) ─────────────────────────────────────────────

interface PaneShellProps {
  idx: number
  type: PaneType
  onTypeChange: (t: PaneType) => void
  symbol: string
  isCrypto: boolean
  syncInterval: string
  onIntervalChange: (i: string) => void
  syncRange: SyncRange | null
  onRangeChange: (r: SyncRange) => void
  crosshairFrac: number | null
  onCrosshairChange: (f: number | null) => void
}

function PaneShell({ idx, type, onTypeChange, symbol, isCrypto, syncInterval, onIntervalChange, syncRange, onRangeChange, crosshairFrac, onCrosshairChange }: PaneShellProps) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#080C14' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '2px 8px', flexShrink: 0,
        background: 'rgba(8,12,20,0.95)',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}>
        <select
          value={type}
          onChange={e => onTypeChange(e.target.value as PaneType)}
          style={{
            background: 'transparent', border: 'none', outline: 'none',
            color: 'rgba(255,255,255,0.55)', fontSize: 10,
            fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer',
          }}
        >
          {PANE_OPTIONS.map(([v, l]) => (
            <option key={v} value={v} style={{ background: '#0D1117' }}>{l}</option>
          ))}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'rgba(255,255,255,0.15)', fontFamily: 'monospace' }}>
          #{idx + 1}
        </span>
      </div>
      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <PaneBody
          idx={idx}
          type={type}
          symbol={symbol}
          isCrypto={isCrypto}
          syncInterval={syncInterval}
          onIntervalChange={onIntervalChange}
          syncRange={syncRange}
          onRangeChange={onRangeChange}
          crosshairFrac={crosshairFrac}
          onCrosshairChange={onCrosshairChange}
        />
      </div>
    </div>
  )
}

// ── Pane body (content renderer) ──────────────────────────────────────────────

interface PaneBodyProps {
  idx: number
  type: PaneType
  symbol: string
  isCrypto: boolean
  syncInterval: string
  onIntervalChange: (i: string) => void
  syncRange: SyncRange | null
  onRangeChange: (r: SyncRange) => void
  crosshairFrac: number | null
  onCrosshairChange: (f: number | null) => void
}

const chartRefs = new Map<number, React.RefObject<LightweightChartHandle>>()
function getChartRef(idx: number) {
  if (!chartRefs.has(idx)) chartRefs.set(idx, React.createRef<LightweightChartHandle>())
  return chartRefs.get(idx)!
}

function PaneBody({ idx, type, symbol, isCrypto, syncInterval, onIntervalChange, syncRange, onRangeChange, crosshairFrac, onCrosshairChange }: PaneBodyProps) {
  if (!symbol) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 11 }}>
        Sélectionnez un symbole
      </div>
    )
  }

  switch (type) {
    case 'chart':
      return (
        <div style={{ height: '100%' }}>
          <LightweightChart
            ref={getChartRef(idx)}
            symbol={symbol}
            isCrypto={isCrypto}
            onTimeframeChange={onIntervalChange}
            onVisibleRangeChange={(from, to, areaRatio, fromMs, toMs) =>
              onRangeChange({ from, to, areaRatio, fromMs, toMs })
            }
            onCrosshairChange={d => onCrosshairChange(d ? d.frac : null)}
            externalCrosshairFrac={crosshairFrac}
            syncRangeIn={syncRange}
          />
        </div>
      )

    case 'wavetrend':
      return (
        <WaveTrendChart
          symbol={symbol}
          syncInterval={syncInterval}
          visibleRange={syncRange}
          crosshairFrac={crosshairFrac}
          onCrosshairChange={onCrosshairChange}
        />
      )

    case 'vmc':
      return (
        <VMCOscillatorChart
          symbol={symbol}
          syncInterval={syncInterval}
          visibleRange={syncRange}
          crosshairFrac={crosshairFrac}
          onCrosshairChange={onCrosshairChange}
        />
      )

    case 'rsi':
      return (
        <RSIChart
          symbol={symbol}
          syncInterval={syncInterval}
          visibleRange={syncRange}
          crosshairFrac={crosshairFrac}
          onCrosshairChange={onCrosshairChange}
        />
      )

    case 'rsibollinger':
      return (
        <RSIBollingerChart
          symbol={symbol}
          syncInterval={syncInterval}
          visibleRange={syncRange}
          crosshairFrac={crosshairFrac}
          onCrosshairChange={onCrosshairChange}
        />
      )

    case 'ou':
      return (
        <OUChannelIndicator
          symbol={symbol}
          syncInterval={syncInterval}
          visibleRange={syncRange}
          crosshairFrac={crosshairFrac}
          onCrosshairChange={onCrosshairChange}
        />
      )

    case 'empty':
    default:
      return (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.1)', fontSize: 12, letterSpacing: 2 }}>
          VIDE
        </div>
      )
  }
}
