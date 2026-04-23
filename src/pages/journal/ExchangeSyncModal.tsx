// src/pages/journal/ExchangeSyncModal.tsx
// Import automatique de trades depuis Binance / Bybit via Cloud Functions HMAC

import { useState, useEffect } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/services/firebase/config'

type Exchange = 'binance' | 'bybit'

interface KeyStatus {
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

const EXCHANGES: { id: Exchange; name: string; logo: string; color: string; docs: string }[] = [
  {
    id: 'binance',
    name: 'Binance',
    logo: '🟡',
    color: '#F0B90B',
    docs: 'https://www.binance.com/en/my/settings/api-management',
  },
  {
    id: 'bybit',
    name: 'Bybit',
    logo: '🟠',
    color: '#F7931A',
    docs: 'https://www.bybit.com/app/user/api-management',
  },
]

function fmtTime(ms: number) {
  const d = new Date(ms)
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// ── Cloud Function callables ──────────────────────────────────────────────────
const cfSaveKey    = httpsCallable<{ exchange: Exchange; apiKey: string; apiSecret: string }, { success: boolean; message: string }>(functions, 'saveExchangeAPIKey')
const cfGetStatus  = httpsCallable<{ exchange: Exchange }, KeyStatus>(functions, 'getExchangeKeyStatus')
const cfDeleteKey  = httpsCallable<{ exchange: Exchange }, { success: boolean }>(functions, 'deleteExchangeAPIKey')
const cfSync       = httpsCallable<{ exchange: Exchange; startTime?: number }, SyncResult>(functions, 'syncExchangeTrades')

// ── Exchange Card ─────────────────────────────────────────────────────────────
function ExchangeCard({
  ex,
  status,
  onRefreshStatus,
}: {
  ex: typeof EXCHANGES[0]
  status: KeyStatus | null
  onRefreshStatus: () => void
}) {
  const [expanded, setExpanded]   = useState(false)
  const [apiKey,   setApiKey]     = useState('')
  const [secret,   setSecret]     = useState('')
  const [showSec,  setShowSec]    = useState(false)
  const [saving,   setSaving]     = useState(false)
  const [syncing,  setSyncing]    = useState(false)
  const [deleting, setDeleting]   = useState(false)
  const [msg,      setMsg]        = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const connected = status?.connected ?? false

  const handleSave = async () => {
    if (!apiKey.trim() || !secret.trim()) return
    setSaving(true); setMsg(null)
    try {
      const r = await cfSaveKey({ exchange: ex.id, apiKey: apiKey.trim(), apiSecret: secret.trim() })
      setMsg({ type: 'ok', text: r.data.message })
      setApiKey(''); setSecret(''); setExpanded(false)
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
      border: `1px solid ${connected ? `${ex.color}33` : 'rgba(255,255,255,0.07)'}`,
      borderRadius: 14,
      background: connected ? `${ex.color}08` : 'rgba(255,255,255,0.02)',
      padding: '16px 18px',
      transition: 'all 0.2s',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: msg || expanded || connected ? 12 : 0 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 22,
          background: `${ex.color}15`, border: `1px solid ${ex.color}30`,
        }}>
          {ex.logo}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#F0F2F5', marginBottom: 2 }}>{ex.name}</div>
          {connected && status ? (
            <div style={{ fontSize: 11, color: '#6B7280', fontFamily: 'JetBrains Mono, monospace' }}>
              {status.apiKeyMasked}
              {status.importedCount ? ` · ${status.importedCount} trades` : ''}
              {status.lastSync ? ` · sync ${fmtTime(status.lastSync)}` : ''}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: '#6B7280' }}>Non connecté</div>
          )}
        </div>
        {/* Badges & actions */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {connected ? (
            <>
              <span style={{
                padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                background: 'rgba(34,199,89,0.12)', color: '#22C759', border: '1px solid rgba(34,199,89,0.25)',
              }}>✓ Connecté</span>
              <button
                onClick={handleSync} disabled={syncing}
                style={{
                  padding: '5px 12px', borderRadius: 8, border: '1px solid rgba(0,229,255,0.25)',
                  background: 'rgba(0,229,255,0.08)', color: '#00E5FF', fontSize: 11, fontWeight: 600,
                  cursor: syncing ? 'wait' : 'pointer', transition: 'all 0.15s',
                }}
              >
                {syncing ? '⏳ Sync…' : '↻ Sync'}
              </button>
              <button
                onClick={handleDelete} disabled={deleting}
                style={{
                  padding: '5px 10px', borderRadius: 8, border: '1px solid rgba(255,59,48,0.2)',
                  background: 'rgba(255,59,48,0.06)', color: '#FF3B30', fontSize: 11,
                  cursor: deleting ? 'wait' : 'pointer',
                }}
              >
                {deleting ? '…' : '✕'}
              </button>
            </>
          ) : (
            <button
              onClick={() => setExpanded(e => !e)}
              style={{
                padding: '6px 14px', borderRadius: 8,
                border: `1px solid ${ex.color}40`,
                background: `${ex.color}10`,
                color: ex.color, fontSize: 12, fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {expanded ? '↑ Fermer' : '+ Connecter'}
            </button>
          )}
        </div>
      </div>

      {/* Message */}
      {msg && (
        <div style={{
          padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 12,
          background: msg.type === 'ok' ? 'rgba(34,199,89,0.1)' : 'rgba(255,59,48,0.1)',
          border: `1px solid ${msg.type === 'ok' ? 'rgba(34,199,89,0.25)' : 'rgba(255,59,48,0.25)'}`,
          color: msg.type === 'ok' ? '#22C759' : '#FF6B6B',
        }}>
          {msg.type === 'ok' ? '✓ ' : '⚠ '}{msg.text}
        </div>
      )}

      {/* Form */}
      {expanded && !connected && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Security note */}
          <div style={{
            padding: '8px 12px', borderRadius: 8, fontSize: 11,
            background: 'rgba(0,229,255,0.06)', border: '1px solid rgba(0,229,255,0.15)',
            color: '#8E8E93', lineHeight: 1.5,
          }}>
            🔒 Vos clés sont stockées côté serveur (Firebase) et ne transitent jamais en clair dans le frontend.
            Créez une clé <strong>lecture seule</strong> (Read Only) sur {' '}
            <a href={ex.docs} target="_blank" rel="noopener noreferrer" style={{ color: '#00E5FF' }}>
              {ex.name}
            </a>.
          </div>

          {/* API Key */}
          <div>
            <label style={{ fontSize: 10, color: '#6B7280', display: 'block', marginBottom: 4 }}>
              API KEY
            </label>
            <input
              type="text"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={`Clé API ${ex.name}…`}
              style={{
                width: '100%', padding: '9px 12px', borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.04)', color: '#F0F2F5',
                fontSize: 13, outline: 'none', boxSizing: 'border-box',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            />
          </div>

          {/* Secret */}
          <div>
            <label style={{ fontSize: 10, color: '#6B7280', display: 'block', marginBottom: 4 }}>
              API SECRET
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showSec ? 'text' : 'password'}
                value={secret}
                onChange={e => setSecret(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSave()}
                placeholder="Secret…"
                style={{
                  width: '100%', padding: '9px 40px 9px 12px', borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: 'rgba(255,255,255,0.04)', color: '#F0F2F5',
                  fontSize: 13, outline: 'none', boxSizing: 'border-box',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              />
              <button
                onClick={() => setShowSec(s => !s)}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: '#6B7280',
                  cursor: 'pointer', fontSize: 14, padding: 0,
                }}
              >
                {showSec ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving || !apiKey.trim() || !secret.trim()}
            style={{
              padding: '10px', borderRadius: 10, border: 'none',
              background: saving || !apiKey.trim() || !secret.trim()
                ? 'rgba(255,255,255,0.05)'
                : `${ex.color}CC`,
              color: saving || !apiKey.trim() || !secret.trim() ? '#3A3F4B' : '#0D1117',
              fontSize: 13, fontWeight: 700,
              cursor: saving || !apiKey.trim() || !secret.trim() ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {saving ? '⏳ Validation de la clé…' : `🔗 Connecter ${ex.name}`}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main Modal ────────────────────────────────────────────────────────────────
export default function ExchangeSyncModal({ onClose }: { onClose: () => void }) {
  const [statuses, setStatuses] = useState<Record<Exchange, KeyStatus | null>>({
    binance: null,
    bybit: null,
  })
  const [loadingStatus, setLoadingStatus] = useState(true)

  const refreshStatuses = async () => {
    try {
      const [b, by] = await Promise.all([
        cfGetStatus({ exchange: 'binance' }),
        cfGetStatus({ exchange: 'bybit' }),
      ])
      setStatuses({ binance: b.data, bybit: by.data })
    } catch {
      // ignore — user might not be authenticated yet
    } finally {
      setLoadingStatus(false)
    }
  }

  useEffect(() => { refreshStatuses() }, [])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10001,
        background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#0D1117',
          border: '1px solid rgba(0,229,255,0.12)',
          borderRadius: 20,
          padding: '28px 28px 24px',
          width: 480, maxWidth: '100%',
          display: 'flex', flexDirection: 'column', gap: 20,
          boxShadow: '0 0 60px rgba(0,229,255,0.06)',
          maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#F0F2F5', fontFamily: 'Syne, sans-serif', marginBottom: 4 }}>
              📥 Import de trades
            </div>
            <div style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.5 }}>
              Connectez vos exchanges pour importer automatiquement vos trades fermés.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#6B7280', cursor: 'pointer', fontSize: 18, padding: 0 }}
          >
            ✕
          </button>
        </div>

        {/* Exchanges */}
        {loadingStatus ? (
          <div style={{ textAlign: 'center', color: '#6B7280', fontSize: 13, padding: '20px 0' }}>
            ⏳ Chargement…
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {EXCHANGES.map(ex => (
              <ExchangeCard
                key={ex.id}
                ex={ex}
                status={statuses[ex.id]}
                onRefreshStatus={refreshStatuses}
              />
            ))}
          </div>
        )}

        {/* Info footer */}
        <div style={{
          padding: '10px 14px', borderRadius: 10,
          background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
          fontSize: 11, color: '#4B5563', lineHeight: 1.6,
        }}>
          ℹ️ Les trades importés sont dédupliqués automatiquement.
          Le sync incrémental ne recharge que les nouveaux trades depuis le dernier import.
          Seules les positions fermées avec PnL réalisé sont importées.
        </div>
      </div>
    </div>
  )
}
