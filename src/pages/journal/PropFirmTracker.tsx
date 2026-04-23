// src/pages/journal/PropFirmTracker.tsx

import { useState, useMemo } from 'react'
import { tradePnL, type Trade } from '@/services/firestore'

interface PropFirmConfig {
  id: string
  name: string
  accountSize: number
  maxDailyLossPercent: number
  maxTotalDrawdownPercent: number
  profitTargetPercent: number
  startDate: string
}

interface PropFirmStatus {
  dailyPnL: number
  totalPnL: number
  dailyDDUsed: number
  totalDDUsed: number
  progressToTarget: number
  isBreached: boolean
  isAtRisk: boolean
  capitalRemaining: number
}

const STORAGE_KEY = 'tm_propfirm_configs'

function loadConfigs(): PropFirmConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveConfigs(configs: PropFirmConfig[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs))
}

function computeStatus(config: PropFirmConfig, trades: Trade[]): PropFirmStatus {
  const cutoff = new Date(config.startDate).getTime()
  const relevant = trades.filter(t => t.status === 'closed' && t.date.getTime() >= cutoff)

  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const todayTrades = relevant.filter(t => t.date.getTime() >= todayStart.getTime())

  const dailyPnL = todayTrades.reduce((s, t) => s + tradePnL(t), 0)
  const totalPnL = relevant.reduce((s, t) => s + tradePnL(t), 0)

  const maxDailyLoss = -config.accountSize * config.maxDailyLossPercent / 100
  const maxTotalDD = -config.accountSize * config.maxTotalDrawdownPercent / 100
  const profitTarget = config.accountSize * config.profitTargetPercent / 100

  const dailyDDUsed = dailyPnL < 0 ? Math.abs(dailyPnL) / Math.abs(maxDailyLoss) : 0
  const totalDDUsed = totalPnL < 0 ? Math.abs(totalPnL) / Math.abs(maxTotalDD) : 0
  const progressToTarget = totalPnL > 0 ? totalPnL / profitTarget : 0

  const isBreached = dailyPnL <= maxDailyLoss || totalPnL <= maxTotalDD
  const isAtRisk = dailyDDUsed > 0.8 || totalDDUsed > 0.8

  return {
    dailyPnL,
    totalPnL,
    dailyDDUsed,
    totalDDUsed,
    progressToTarget,
    isBreached,
    isAtRisk,
    capitalRemaining: config.accountSize + totalPnL,
  }
}

function barColor(pct: number): string {
  if (pct > 0.8) return '#FF3B30'
  if (pct > 0.6) return '#F59714'
  return '#22C759'
}

function ProgressBar({ value, max = 1, label }: { value: number; max?: number; label?: string }) {
  const pct = Math.min(1, value / max)
  const color = barColor(pct)
  return (
    <div>
      {label && <div style={{ fontSize: 9, color: 'var(--tm-text-muted)', marginBottom: 3 }}>{label}</div>}
      <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct * 100}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.4s' }} />
      </div>
    </div>
  )
}

function fmtMoney(v: number): string {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : v > 0 ? '+' : ''
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}k`
  return `${sign}${abs.toFixed(0)}`
}

const EMPTY_CONFIG: Omit<PropFirmConfig, 'id'> = {
  name: '',
  accountSize: 100000,
  maxDailyLossPercent: 5,
  maxTotalDrawdownPercent: 10,
  profitTargetPercent: 10,
  startDate: new Date().toISOString().slice(0, 10),
}

export default function PropFirmTracker({ trades }: { trades: Trade[] }) {
  const [configs, setConfigs] = useState<PropFirmConfig[]>(loadConfigs)
  const [activeId, setActiveId] = useState<string | null>(() => {
    const c = loadConfigs()
    return c[0]?.id ?? null
  })
  const [showConfig, setShowConfig] = useState(false)
  const [formData, setFormData] = useState<Omit<PropFirmConfig, 'id'>>(EMPTY_CONFIG)
  const [editingId, setEditingId] = useState<string | null>(null)

  const activeConfig = configs.find(c => c.id === activeId) ?? null
  const status = useMemo(
    () => (activeConfig ? computeStatus(activeConfig, trades) : null),
    [activeConfig, trades]
  )

  const persist = (next: PropFirmConfig[]) => {
    setConfigs(next)
    saveConfigs(next)
  }

  const openNew = () => {
    setEditingId(null)
    setFormData(EMPTY_CONFIG)
    setShowConfig(true)
  }

  const openEdit = (cfg: PropFirmConfig) => {
    setEditingId(cfg.id)
    setFormData({
      name: cfg.name,
      accountSize: cfg.accountSize,
      maxDailyLossPercent: cfg.maxDailyLossPercent,
      maxTotalDrawdownPercent: cfg.maxTotalDrawdownPercent,
      profitTargetPercent: cfg.profitTargetPercent,
      startDate: cfg.startDate,
    })
    setShowConfig(true)
  }

  const handleSave = () => {
    if (!formData.name.trim()) return
    if (editingId) {
      const next = configs.map(c => c.id === editingId ? { ...formData, id: editingId } : c)
      persist(next)
    } else {
      const newCfg: PropFirmConfig = { ...formData, id: crypto.randomUUID() }
      const next = [...configs, newCfg]
      persist(next)
      setActiveId(newCfg.id)
    }
    setShowConfig(false)
  }

  const handleDelete = (id: string) => {
    const next = configs.filter(c => c.id !== id)
    persist(next)
    if (activeId === id) setActiveId(next[0]?.id ?? null)
    setShowConfig(false)
  }

  return (
    <div style={{ background: 'var(--tm-bg-secondary)', border: '1px solid #2A2F3E', borderRadius: 12, padding: 16, marginBottom: 16 }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(255,204,0,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🏆</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-primary)' }}>Prop Firm Tracker</div>
            {activeConfig && <div style={{ fontSize: 10, color: 'var(--tm-text-muted)' }}>{activeConfig.name}</div>}
          </div>
        </div>
        <button
          onClick={activeConfig ? () => openEdit(activeConfig) : openNew}
          style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'var(--tm-text-secondary)', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
          ⚙️ Configurer
        </button>
      </div>

      {/* Multi-account tabs */}
      {configs.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {configs.map(cfg => (
            <button key={cfg.id} onClick={() => setActiveId(cfg.id)} style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${activeId === cfg.id ? '#FFCC00' : 'var(--tm-border)'}`,
              background: activeId === cfg.id ? 'rgba(255,204,0,0.1)' : 'transparent',
              color: activeId === cfg.id ? '#FFCC00' : 'var(--tm-text-muted)',
            }}>{cfg.name}</button>
          ))}
          <button onClick={openNew} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px dashed rgba(255,255,255,0.15)', background: 'transparent', color: 'var(--tm-text-muted)' }}>+ Nouveau</button>
        </div>
      )}

      {/* Empty state */}
      {configs.length === 0 && !showConfig && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 12, color: 'var(--tm-text-muted)', marginBottom: 10 }}>Aucun compte prop firm configuré</div>
          <button onClick={openNew} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--tm-accent)', color: 'var(--tm-bg)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            + Ajouter un compte
          </button>
        </div>
      )}

      {/* Status dashboard */}
      {status && activeConfig && !showConfig && (
        <>
          {/* Alert banner */}
          {(status.isBreached || status.isAtRisk) && (
            <div style={{
              background: status.isBreached ? 'rgba(255,59,48,0.1)' : 'rgba(245,151,20,0.1)',
              border: `1px solid ${status.isBreached ? 'rgba(255,59,48,0.3)' : 'rgba(245,151,20,0.3)'}`,
              borderRadius: 8, padding: '8px 12px', marginBottom: 12,
              color: status.isBreached ? '#FF3B30' : '#F59714',
              fontSize: 11, fontWeight: 600,
            }}>
              {status.isBreached
                ? '🚨 Règle violée — compte en danger'
                : `⚠️ Risque élevé — Marge daily restante: ${fmtMoney(activeConfig.accountSize * activeConfig.maxDailyLossPercent / 100 - Math.abs(status.dailyPnL))}`}
            </div>
          )}

          {/* Stats grid 2×2 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            {/* Capital remaining */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #1E2330', borderRadius: 8, padding: '10px 12px', gridColumn: '1 / -1' }}>
              <div style={{ fontSize: 9, color: 'var(--tm-text-muted)', marginBottom: 4 }}>Capital restant</div>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'JetBrains Mono,monospace', color: status.capitalRemaining >= activeConfig.accountSize ? '#22C759' : '#FF3B30' }}>
                {status.capitalRemaining.toLocaleString('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
              </div>
              <div style={{ fontSize: 10, color: 'var(--tm-text-muted)', marginTop: 2 }}>
                {status.totalPnL >= 0 ? '+' : ''}{status.totalPnL.toFixed(0)} $ depuis le {activeConfig.startDate}
              </div>
            </div>

            {/* Daily P&L */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #1E2330', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 9, color: 'var(--tm-text-muted)', marginBottom: 4 }}>P&L du jour</div>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'JetBrains Mono,monospace', color: status.dailyPnL >= 0 ? '#22C759' : '#FF3B30', marginBottom: 6 }}>
                {fmtMoney(status.dailyPnL)} $
              </div>
              <ProgressBar value={status.dailyDDUsed} label={`${(status.dailyDDUsed * 100).toFixed(0)}% limite daily`} />
            </div>

            {/* Total drawdown */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #1E2330', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 9, color: 'var(--tm-text-muted)', marginBottom: 4 }}>Drawdown total</div>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'JetBrains Mono,monospace', color: status.totalDDUsed > 0.8 ? '#FF3B30' : status.totalDDUsed > 0.5 ? '#F59714' : 'var(--tm-text-secondary)', marginBottom: 6 }}>
                {(status.totalDDUsed * 100).toFixed(1)}%
              </div>
              <ProgressBar value={status.totalDDUsed} label={`/${activeConfig.maxTotalDrawdownPercent}% max`} />
            </div>

            {/* Progress to target */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #1E2330', borderRadius: 8, padding: '10px 12px', gridColumn: '1 / -1' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontSize: 9, color: 'var(--tm-text-muted)' }}>Progression objectif</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#22C759' }}>{(status.progressToTarget * 100).toFixed(1)}%</div>
              </div>
              <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(1, status.progressToTarget) * 100}%`, height: '100%', background: 'linear-gradient(90deg,rgba(34,199,89,0.8),#22C759)', borderRadius: 3, transition: 'width 0.4s' }} />
              </div>
              <div style={{ fontSize: 9, color: 'var(--tm-text-muted)', marginTop: 4 }}>
                Objectif: +{activeConfig.profitTargetPercent}% = +{(activeConfig.accountSize * activeConfig.profitTargetPercent / 100).toFixed(0)} $
              </div>
            </div>
          </div>
        </>
      )}

      {/* Config form */}
      {showConfig && (
        <div style={{ borderTop: configs.length > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none', paddingTop: configs.length > 0 ? 12 : 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tm-text-primary)', marginBottom: 12 }}>
            {editingId ? 'Modifier le compte' : 'Nouveau compte'}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { label: 'Nom du compte (ex: FTMO 100K)', key: 'name', type: 'text', value: formData.name },
              { label: 'Taille du compte ($)', key: 'accountSize', type: 'number', value: formData.accountSize },
              { label: 'Perte max. quotidienne (%)', key: 'maxDailyLossPercent', type: 'number', value: formData.maxDailyLossPercent },
              { label: 'Drawdown max. total (%)', key: 'maxTotalDrawdownPercent', type: 'number', value: formData.maxTotalDrawdownPercent },
              { label: 'Objectif de profit (%)', key: 'profitTargetPercent', type: 'number', value: formData.profitTargetPercent },
              { label: 'Date de début', key: 'startDate', type: 'date', value: formData.startDate },
            ].map(({ label, key, type, value }) => (
              <div key={key}>
                <div style={{ fontSize: 10, color: 'var(--tm-text-muted)', marginBottom: 4 }}>{label}</div>
                <input
                  type={type}
                  value={value}
                  onChange={e => setFormData(prev => ({ ...prev, [key]: type === 'number' ? Number(e.target.value) : e.target.value }))}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid #2A2F3E', background: 'var(--tm-bg-tertiary)', color: 'var(--tm-text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={handleSave} style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: 'var(--tm-accent)', color: 'var(--tm-bg)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Enregistrer
            </button>
            <button onClick={() => setShowConfig(false)} style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'var(--tm-text-muted)', fontSize: 13, cursor: 'pointer' }}>
              Annuler
            </button>
            {editingId && (
              <button onClick={() => handleDelete(editingId)} style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid rgba(255,59,48,0.3)', background: 'rgba(255,59,48,0.08)', color: '#FF3B30', fontSize: 13, cursor: 'pointer' }}>
                Supprimer
              </button>
            )}
          </div>
        </div>
      )}

      {/* Add new account link when configs exist and form is hidden */}
      {configs.length > 0 && !showConfig && (
        <button onClick={openNew} style={{ marginTop: 8, width: '100%', padding: '6px 0', borderRadius: 6, border: '1px dashed rgba(255,255,255,0.1)', background: 'transparent', color: 'var(--tm-text-muted)', fontSize: 11, cursor: 'pointer' }}>
          + Ajouter un compte
        </button>
      )}
    </div>
  )
}
