// src/pages/journal/ExchangeSyncModal.tsx
// Import automatique de trades depuis exchanges crypto + brokers forex/stocks

import { useState, useEffect, useRef } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/services/firebase/config'

export type Exchange = 'binance' | 'bybit' | 'okx' | 'kucoinfutures' | 'bitget' | 'oanda' | 'alpaca'

export interface KeyStatus {
  connected: boolean
  exchange?: Exchange
  apiKeyMasked?: string
  lastSync?: number | null
  importedCount?: number
}

interface SyncResult {
  imported: number
  skipped: number
  message: string
}

interface ExchangeDef {
  id: Exchange
  name: string
  logo: string
  color: string
  category: 'crypto' | 'forex' | 'stocks'
  categoryLabel: string
  docs: string
  fields: {
    keyLabel: string
    secretLabel: string
    passphraseLabel?: string   // OKX, KuCoin
    accountIdLabel?: string    // OANDA
  }
}

const EXCHANGES: ExchangeDef[] = [
  // ── Crypto ────────────────────────────────────────────────────────────────
  {
    id: 'binance', name: 'Binance', logo: '🟡', color: '#F0B90B',
    category: 'crypto', categoryLabel: 'Crypto',
    docs: 'https://www.binance.com/en/my/settings/api-management',
    fields: { keyLabel: 'API Key', secretLabel: 'API Secret' },
  },
  {
    id: 'bybit', name: 'Bybit', logo: '🟠', color: '#F7931A',
    category: 'crypto', categoryLabel: 'Crypto',
    docs: 'https://www.bybit.com/app/user/api-management',
    fields: { keyLabel: 'API Key', secretLabel: 'API Secret' },
  },
  {
    id: 'okx', name: 'OKX', logo: '⚫', color: '#E6E6E6',
    category: 'crypto', categoryLabel: 'Crypto',
    docs: 'https://www.okx.com/account/my-api',
    fields: { keyLabel: 'API Key', secretLabel: 'Secret Key', passphraseLabel: 'Passphrase' },
  },
  {
    id: 'kucoinfutures', name: 'KuCoin Futures', logo: '🟢', color: '#00C076',
    category: 'crypto', categoryLabel: 'Crypto',
    docs: 'https://www.kucoin.com/account/api',
    fields: { keyLabel: 'API Key', secretLabel: 'API Secret', passphraseLabel: 'Passphrase' },
  },
  {
    id: 'bitget', name: 'Bitget', logo: '🔵', color: '#00C0F0',
    category: 'crypto', categoryLabel: 'Crypto',
    docs: 'https://www.bitget.com/en/account/newapi',
    fields: { keyLabel: 'API Key', secretLabel: 'Secret Key', passphraseLabel: 'Passphrase' },
  },
  // ── Forex / CFD ────────────────────────────────────────────────────────────
  {
    id: 'oanda', name: 'OANDA', logo: '💱', color: '#00A99D',
    category: 'forex', categoryLabel: 'Forex / CFD',
    docs: 'https://www.oanda.com/account/#/user/security',
    fields: { keyLabel: 'API Token (Bearer)', secretLabel: 'Account ID', accountIdLabel: 'Account ID' },
  },
  // ── Stocks ─────────────────────────────────────────────────────────────────
  {
    id: 'alpaca', name: 'Alpaca', logo: '🦙', color: '#FBDF02',
    category: 'stocks', categoryLabel: 'Stocks / US',
    docs: 'https://app.alpaca.markets/paper-accounts',
    fields: { keyLabel: 'API Key ID', secretLabel: 'API Secret Key' },
  },
]

const CATEGORY_ORDER = ['crypto', 'forex', 'stocks']

// ── Cloud Function callables ──────────────────────────────────────────────────
const cfSaveKey   = httpsCallable<{ exchange: Exchange; apiKey: string; apiSecret: string; passphrase?: string }, { success: boolean; message: string }>(functions, 'saveExchangeAPIKey')
const cfGetStatus = httpsCallable<{ exchange: Exchange }, KeyStatus>(functions, 'getExchangeKeyStatus')
const cfDeleteKey = httpsCallable<{ exchange: Exchange }, { success: boolean }>(functions, 'deleteExchangeAPIKey')
export const cfSync = httpsCallable<{ exchange: Exchange; startTime?: number }, SyncResult>(functions, 'syncExchangeTrades')

function fmtTime(ms: number) {
  return new Date(ms).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// ── Exchange Card ─────────────────────────────────────────────────────────────
function ExchangeCard({ ex, status, onRefreshStatus }: {
  ex: ExchangeDef
  status: KeyStatus | null
  onRefreshStatus: () => void
}) {
  const [expanded,   setExpanded]   = useState(false)
  const [apiKey,     setApiKey]     = useState('')
  const [secret,     setSecret]     = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [showSec,    setShowSec]    = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [syncing,    setSyncing]    = useState(false)
  const [deleting,   setDeleting]   = useState(false)
  const [msg,        setMsg]        = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const connected = status?.connected ?? false
  const needsPassphrase = !!(ex.fields.passphraseLabel)

  const handleSave = async () => {
    if (!apiKey.trim() || !secret.trim()) return
    if (needsPassphrase && !passphrase.trim()) return
    setSaving(true); setMsg(null)
    try {
      const r = await cfSaveKey({
        exchange: ex.id,
        apiKey: apiKey.trim(),
        apiSecret: secret.trim(),
        ...(needsPassphrase ? { passphrase: passphrase.trim() } : {}),
      })
      setMsg({ type: 'ok', text: r.data.message })
      setApiKey(''); setSecret(''); setPassphrase(''); setExpanded(false)
      onRefreshStatus()
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.message ?? 'Erreur inconnue' })
    } finally { setSaving(false) }
  }

  const handleSync = async () => {
    setSyncing(true); setMsg(null)
    try {
      const r = await cfSync({ exchange: ex.id })
      setMsg({ type: 'ok', text: r.data.message })
      onRefreshStatus()
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.message ?? 'Erreur sync' })
    } finally { setSyncing(false) }
  }

  const handleDelete = async () => {
    if (!confirm(`Supprimer la clé API ${ex.name} ?`)) return
    setDeleting(true); setMsg(null)
    try {
      await cfDeleteKey({ exchange: ex.id })
      setMsg({ type: 'ok', text: 'Clé supprimée' })
      onRefreshStatus()
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.message ?? 'Erreur suppression' })
    } finally { setDeleting(false) }
  }

  return (
    <div style={{
      border: `1px solid ${connected ? `${ex.color}33` : 'rgba(255,255,255,0.06)'}`,
      borderRadius: 12,
      background: connected ? `${ex.color}08` : 'rgba(255,255,255,0.02)',
      padding: '13px 15px',
      transition: 'all 0.2s',
    }}>
      {/* Row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 8, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 18,
          background: `${ex.color}15`, border: `1px solid ${ex.color}25`, flexShrink: 0,
        }}>
          {ex.logo}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#F0F2F5' }}>{ex.name}</div>
          {connected && status ? (
            <div style={{ fontSize: 10, color: '#6B7280', fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {status.apiKeyMasked}
              {status.importedCount ? ` · ${status.importedCount} trades` : ''}
              {status.lastSync ? ` · ${fmtTime(status.lastSync)}` : ''}
            </div>
          ) : (
            <div style={{ fontSize: 10, color: '#4B5563' }}>Non connecté</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
          {connected ? (
            <>
              <span style={{ padding: '2px 7px', borderRadius: 20, fontSize: 9, fontWeight: 700, background: 'rgba(34,199,89,0.12)', color: '#22C759', border: '1px solid rgba(34,199,89,0.2)' }}>
                ✓
              </span>
              <button onClick={handleSync} disabled={syncing} style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid rgba(0,229,255,0.2)', background: 'rgba(0,229,255,0.07)', color: '#00E5FF', fontSize: 11, fontWeight: 600, cursor: syncing ? 'wait' : 'pointer' }}>
                {syncing ? '⏳' : '↻ Sync'}
              </button>
              <button onClick={handleDelete} disabled={deleting} style={{ padding: '4px 8px', borderRadius: 7, border: '1px solid rgba(255,59,48,0.18)', background: 'rgba(255,59,48,0.05)', color: '#FF3B30', fontSize: 11, cursor: deleting ? 'wait' : 'pointer' }}>
                ✕
              </button>
            </>
          ) : (
            <button onClick={() => setExpanded(e => !e)} style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${ex.color}35`, background: `${ex.color}0D`, color: ex.color, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
              {expanded ? '↑' : '+ Connecter'}
            </button>
          )}
        </div>
      </div>

      {/* Message */}
      {msg && (
        <div style={{ padding: '7px 10px', borderRadius: 7, marginTop: 10, fontSize: 11, background: msg.type === 'ok' ? 'rgba(34,199,89,0.1)' : 'rgba(255,59,48,0.1)', border: `1px solid ${msg.type === 'ok' ? 'rgba(34,199,89,0.2)' : 'rgba(255,59,48,0.2)'}`, color: msg.type === 'ok' ? '#22C759' : '#FF6B6B' }}>
          {msg.type === 'ok' ? '✓ ' : '⚠ '}{msg.text}
        </div>
      )}

      {/* Form */}
      {expanded && !connected && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          <div style={{ padding: '7px 10px', borderRadius: 7, fontSize: 10, background: 'rgba(0,229,255,0.05)', border: '1px solid rgba(0,229,255,0.12)', color: '#6B7280', lineHeight: 1.5 }}>
            🔒 Clés stockées côté serveur, jamais exposées au client. Utilisez une clé <strong>Read-Only</strong>.{' '}
            <a href={ex.docs} target="_blank" rel="noopener noreferrer" style={{ color: '#00E5FF' }}>Gérer les clés {ex.name} ↗</a>
          </div>

          {[
            { label: ex.fields.keyLabel, value: apiKey, set: setApiKey, type: 'text' },
            { label: ex.fields.secretLabel, value: secret, set: setSecret, type: showSec ? 'text' : 'password', toggle: true },
            ...(needsPassphrase ? [{ label: ex.fields.passphraseLabel!, value: passphrase, set: setPassphrase, type: 'text' }] : []),
          ].map(f => (
            <div key={f.label}>
              <label style={{ fontSize: 9, color: '#6B7280', display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{f.label}</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={f.type}
                  value={f.value}
                  onChange={e => f.set(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSave()}
                  style={{ width: '100%', padding: f.toggle ? '8px 36px 8px 10px' : '8px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.04)', color: '#F0F2F5', fontSize: 12, outline: 'none', boxSizing: 'border-box', fontFamily: 'JetBrains Mono, monospace' }}
                />
                {f.toggle && (
                  <button onClick={() => setShowSec(s => !s)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#6B7280', cursor: 'pointer', fontSize: 13, padding: 0 }}>
                    {showSec ? '🙈' : '👁'}
                  </button>
                )}
              </div>
            </div>
          ))}

          <button
            onClick={handleSave}
            disabled={saving || !apiKey.trim() || !secret.trim() || (needsPassphrase && !passphrase.trim())}
            style={{ padding: '9px', borderRadius: 8, border: 'none', background: saving ? 'rgba(255,255,255,0.05)' : `${ex.color}CC`, color: '#0D1117', fontSize: 12, fontWeight: 700, cursor: saving ? 'wait' : 'pointer', transition: 'all 0.2s' }}
          >
            {saving ? '⏳ Validation…' : `🔗 Connecter ${ex.name}`}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main Modal ────────────────────────────────────────────────────────────────
export default function ExchangeSyncModal({ onClose }: { onClose: () => void }) {
  const [statuses, setStatuses] = useState<Record<Exchange, KeyStatus | null>>({
    binance: null, bybit: null, okx: null, kucoinfutures: null, bitget: null, oanda: null, alpaca: null,
  })
  const [loadingStatus, setLoadingStatus] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refreshStatuses = async () => {
    try {
      const results = await Promise.all(EXCHANGES.map(ex => cfGetStatus({ exchange: ex.id })))
      const next = { ...statuses }
      EXCHANGES.forEach((ex, i) => { next[ex.id] = results[i].data })
      setStatuses(next)
    } catch { /* ignore */ }
    finally { setLoadingStatus(false) }
  }

  // Auto-sync toutes les 30s pour les exchanges connectés
  const runAutoSync = async (currentStatuses: Record<Exchange, KeyStatus | null>) => {
    const connected = EXCHANGES.filter(ex => currentStatuses[ex.id]?.connected)
    await Promise.allSettled(connected.map(ex => cfSync({ exchange: ex.id })))
    if (connected.length > 0) await refreshStatuses()
  }

  useEffect(() => {
    refreshStatuses()
  }, [])

  useEffect(() => {
    if (loadingStatus) return
    intervalRef.current = setInterval(() => runAutoSync(statuses), 30_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [loadingStatus, statuses])

  // Grouper par catégorie
  const categories = CATEGORY_ORDER.map(cat => ({
    cat,
    label: EXCHANGES.find(e => e.category === cat)?.categoryLabel ?? cat,
    exchanges: EXCHANGES.filter(e => e.category === cat),
  }))

  const connectedCount = Object.values(statuses).filter(s => s?.connected).length

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10001, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#0D1117', border: '1px solid rgba(0,229,255,0.12)', borderRadius: 20, padding: '24px 24px 20px', width: 500, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 18, boxShadow: '0 0 60px rgba(0,229,255,0.06)', maxHeight: '90vh', overflowY: 'auto' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#F0F2F5', fontFamily: 'Syne, sans-serif', marginBottom: 3 }}>
              📥 Importer via API
            </div>
            <div style={{ fontSize: 11, color: '#6B7280', lineHeight: 1.5 }}>
              Connectez vos exchanges ou brokers pour importer automatiquement vos trades fermés.
              {connectedCount > 0 && <span style={{ color: '#22C759' }}> · {connectedCount} connecté{connectedCount > 1 ? 's' : ''} · sync auto ↻ 30s</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6B7280', cursor: 'pointer', fontSize: 18, padding: 0, flexShrink: 0 }}>✕</button>
        </div>

        {loadingStatus ? (
          <div style={{ textAlign: 'center', color: '#6B7280', fontSize: 13, padding: '20px 0' }}>⏳ Chargement…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {categories.map(({ cat, label, exchanges }) => (
              <div key={cat}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
                  {label}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {exchanges.map(ex => (
                    <ExchangeCard key={ex.id} ex={ex} status={statuses[ex.id]} onRefreshStatus={refreshStatuses} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '9px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', fontSize: 10, color: '#4B5563', lineHeight: 1.6 }}>
          ℹ️ Dédupliqués automatiquement · Sync incrémental depuis le dernier import · Positions fermées uniquement
        </div>
      </div>
    </div>
  )
}
