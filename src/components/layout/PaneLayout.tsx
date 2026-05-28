/**
 * PaneLayout — TradingView-style multi-pane layout
 * Chart always on top; oscillator panes dynamically added below.
 * react-resizable-panels v4 for drag-to-resize.
 */

import React, { useState, useCallback, useId } from 'react'
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels'
import LightweightChart from '@/pages/analyse/LightweightChart'
import { WaveTrendChart, VMCOscillatorChart, RSIChart, RSIBollingerChart } from '@/pages/analyse/OscillatorCharts'
import OUChannelIndicator from '@/pages/analyse/OUChannelIndicator'

// ── Types ──────────────────────────────────────────────────────────────────────

export type OscType = 'wavetrend' | 'vmc' | 'rsi' | 'rsibollinger' | 'ou'

type OscPane = { id: string; type: OscType }

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

const OSC_DEFS: Record<OscType, { icon: string; label: string; color: string }> = {
  wavetrend:    { icon: '〰', label: 'WaveTrend',      color: '#BF5AF2' },
  vmc:          { icon: '〜', label: 'VMC Oscillateur', color: '#00E5FF' },
  rsi:          { icon: '📈', label: 'RSI',            color: '#34C759' },
  rsibollinger: { icon: '◈', label: 'RSI Bollinger',  color: '#FF9F0A' },
  ou:           { icon: '〜', label: 'Canal OU',       color: '#0A85FF' },
}

const OSC_ORDER: OscType[] = ['wavetrend', 'vmc', 'rsi', 'rsibollinger', 'ou']

const LS_PANES = 'tm_tv_panes'

// ── Resize handles ─────────────────────────────────────────────────────────────

function ResizeHandleH() {
  return (
    <PanelResizeHandle style={{
      height: 5,
      background: 'transparent',
      cursor: 'row-resize',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      position: 'relative',
      zIndex: 5,
    }}>
      <div style={{ width: '100%', height: 1, background: '#1E2330' }} />
      <div style={{
        position: 'absolute',
        width: 32, height: 3,
        borderRadius: 2,
        background: 'rgba(255,255,255,0.12)',
      }} />
    </PanelResizeHandle>
  )
}

// ── Oscillator pane shell ─────────────────────────────────────────────────────

interface OscShellProps {
  pane: OscPane
  symbol: string
  syncInterval: string
  syncRange: SyncRange | null
  crosshairFrac: number | null
  onCrosshairChange: (f: number | null) => void
  onRemove: (id: string) => void
}

function OscShell({ pane, symbol, syncInterval, syncRange, crosshairFrac, onCrosshairChange, onRemove }: OscShellProps) {
  const def = OSC_DEFS[pane.type]
  const shared = { symbol, syncInterval, visibleRange: syncRange, crosshairFrac, onCrosshairChange }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Pane header — TradingView style */}
      <div style={{
        height: 24,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 10px',
        background: 'rgba(8,12,20,0.97)',
        borderBottom: '1px solid #1A1F2E',
      }}>
        <span style={{ fontSize: 10, color: def.color, fontWeight: 700, fontFamily: 'JetBrains Mono,monospace' }}>
          {def.icon} {def.label}
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => onRemove(pane.id)}
          title="Fermer"
          style={{
            width: 16, height: 16, borderRadius: 4, fontSize: 9, cursor: 'pointer',
            border: 'none', background: 'transparent',
            color: 'rgba(255,255,255,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.1s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#FF3B30')}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.25)')}
        >✕</button>
      </div>

      {/* Oscillator body */}
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

// ── Main component ─────────────────────────────────────────────────────────────

let uidCounter = 0
function uid() { return `p${++uidCounter}` }

export default function PaneLayout({
  symbol, isCrypto, syncInterval, onIntervalChange,
  syncRange, onRangeChange, crosshairFrac, onCrosshairChange,
}: PaneLayoutProps) {

  const [oscPanes, setOscPanes] = useState<OscPane[]>(() => {
    try {
      const saved = localStorage.getItem(LS_PANES)
      if (saved) return JSON.parse(saved)
    } catch {}
    return [{ id: uid(), type: 'wavetrend' as OscType }]
  })

  const [showAddMenu, setShowAddMenu] = useState(false)

  const save = useCallback((next: OscPane[]) => {
    localStorage.setItem(LS_PANES, JSON.stringify(next))
  }, [])

  const addPane = useCallback((type: OscType) => {
    setOscPanes(prev => {
      const next = [...prev, { id: uid(), type }]
      save(next)
      return next
    })
    setShowAddMenu(false)
  }, [save])

  const removePane = useCallback((id: string) => {
    setOscPanes(prev => {
      const next = prev.filter(p => p.id !== id)
      save(next)
      return next
    })
  }, [save])

  // Compute panel sizes: chart gets most space, each osc gets min share
  const n = oscPanes.length
  const chartSize = n === 0 ? 100 : Math.max(35, Math.round(100 - n * 22))
  const oscSize   = n === 0 ? 0   : Math.round((100 - chartSize) / n)

  // Already-added types (to avoid duplicates — optional)
  const addedTypes = new Set(oscPanes.map(p => p.type))
  const availableToAdd = OSC_ORDER.filter(t => !addedTypes.has(t))

  const totalH = 'calc(100vh - 220px)'

  const shared = { symbol, isCrypto, syncInterval, onIntervalChange, syncRange, onRangeChange, crosshairFrac, onCrosshairChange }

  return (
    <div style={{ position: 'relative' }}>

      {/* ── Top toolbar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '5px 10px', marginBottom: 6,
        background: 'rgba(8,12,20,0.97)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 10,
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.25)', letterSpacing: 1 }}>LAYOUT TV</span>
        <div style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.08)' }} />

        {/* Add indicator button */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowAddMenu(m => !m)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
              fontSize: 10, fontWeight: 600,
              border: `1px solid ${showAddMenu ? 'var(--tm-accent)' : 'rgba(255,255,255,0.1)'}`,
              background: showAddMenu ? 'rgba(0,229,255,0.1)' : 'transparent',
              color: showAddMenu ? 'var(--tm-accent)' : 'rgba(255,255,255,0.5)',
            }}
          >
            + Indicateur
          </button>

          {showAddMenu && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50,
              background: 'rgba(8,12,20,0.99)',
              border: '1px solid #2A2F3E',
              borderRadius: 10, padding: '6px',
              minWidth: 180,
              boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
              backdropFilter: 'blur(12px)',
            }}>
              {availableToAdd.length === 0
                ? <div style={{ padding: '8px 10px', fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Tous les indicateurs ajoutés</div>
                : availableToAdd.map(type => {
                  const d = OSC_DEFS[type]
                  return (
                    <button
                      key={type}
                      onClick={() => addPane(type)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        width: '100%', padding: '7px 10px', borderRadius: 7,
                        fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        border: 'none', background: 'transparent',
                        color: d.color, textAlign: 'left',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = `${d.color}15`)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <span style={{ fontSize: 14 }}>{d.icon}</span>
                      {d.label}
                    </button>
                  )
                })}
            </div>
          )}
        </div>

        {/* Active panes chips */}
        {oscPanes.map(p => (
          <div key={p.id} style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '2px 8px 2px 6px', borderRadius: 5,
            background: `${OSC_DEFS[p.type].color}15`,
            border: `1px solid ${OSC_DEFS[p.type].color}40`,
          }}>
            <span style={{ fontSize: 9, color: OSC_DEFS[p.type].color, fontWeight: 700 }}>
              {OSC_DEFS[p.type].label}
            </span>
            <button
              onClick={() => removePane(p.id)}
              style={{ fontSize: 8, cursor: 'pointer', background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', padding: 0, lineHeight: 1 }}
              onMouseEnter={e => (e.currentTarget.style.color = '#FF3B30')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.3)')}
            >✕</button>
          </div>
        ))}

        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'rgba(0,229,255,0.4)' }}>⚡ Synchronisé</span>
      </div>

      {/* ── Panes ── */}
      {n === 0 ? (
        // No oscillators — chart fills all space
        <div style={{ height: totalH }}>
          <LightweightChart
            symbol={symbol}
            isCrypto={isCrypto}
            onTimeframeChange={onIntervalChange}
            onVisibleRangeChange={(from, to, areaRatio, fromMs, toMs) => onRangeChange({ from, to, areaRatio, fromMs, toMs })}
            onCrosshairChange={d => onCrosshairChange(d ? d.frac : null)}
            externalCrosshairFrac={crosshairFrac}
            syncRangeIn={syncRange}
            autoHeight
          />
        </div>
      ) : (
        <PanelGroup direction="vertical" style={{ height: totalH }}>

          {/* Chart pane */}
          <Panel defaultSize={chartSize} minSize={25}>
            <LightweightChart
              symbol={symbol}
              isCrypto={isCrypto}
              onTimeframeChange={onIntervalChange}
              onVisibleRangeChange={(from, to, areaRatio, fromMs, toMs) => onRangeChange({ from, to, areaRatio, fromMs, toMs })}
              onCrosshairChange={d => onCrosshairChange(d ? d.frac : null)}
              externalCrosshairFrac={crosshairFrac}
              syncRangeIn={syncRange}
              autoHeight
            />
          </Panel>

          {/* Oscillator panes */}
          {oscPanes.map((pane, i) => (
            <React.Fragment key={pane.id}>
              <ResizeHandleH />
              <Panel defaultSize={oscSize} minSize={8}>
                <OscShell
                  pane={pane}
                  symbol={symbol}
                  syncInterval={syncInterval}
                  syncRange={syncRange}
                  crosshairFrac={crosshairFrac}
                  onCrosshairChange={onCrosshairChange}
                  onRemove={removePane}
                />
              </Panel>
            </React.Fragment>
          ))}
        </PanelGroup>
      )}

      {/* Click-away to close add menu */}
      {showAddMenu && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 49 }}
          onClick={() => setShowAddMenu(false)}
        />
      )}
    </div>
  )
}
