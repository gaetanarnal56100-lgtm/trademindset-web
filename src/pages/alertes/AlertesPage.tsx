// AlertesPage.tsx — Alertes WaveTrend / VMC / MTF + Custom Alertes (Discord webhook)
import { useState, useEffect, useCallback, useRef } from 'react'
import { signalService, type TradingSignal, type SignalType } from '@/services/notifications/SignalNotificationService'
import { useUser } from '@/hooks/useAuth'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/services/firebase/config'
import {
  getCustomAlerts, saveCustomAlert, deleteCustomAlert,
  getAlertHistory, getNotifSettings, saveNotifSettings,
  type CustomAlert, type AlertCondition, type AlertHistoryEntry, type AlertTF, type ConditionType,
} from '@/services/firestore/customAlerts'

// ── Signal metadata ────────────────────────────────────────────────────────
const SIGNAL_META: Record<SignalType, { icon: string; label: string; color: string; bg: string; desc: string }> = {
  WT_SMART_BULL:   { icon:'⭐', label:'WT Smart Bull',    color:'var(--tm-accent)',   bg:'rgba(var(--tm-accent-rgb,0,229,255),0.12)',  desc:'Croisement WT1/WT2 en zone de survente extrême — signal premium de retournement haussier.' },
  WT_SMART_BEAR:   { icon:'⭐', label:'WT Smart Bear',    color:'var(--tm-loss)',     bg:'rgba(var(--tm-loss-rgb,255,59,48),0.12)',    desc:'Croisement WT1/WT2 en zone de surachat extrême — signal premium de retournement baissier.' },
  WT_BULL:         { icon:'📈', label:'WT Bullish',       color:'var(--tm-profit)',   bg:'rgba(var(--tm-profit-rgb,34,199,89),0.10)', desc:'Croisement haussier WaveTrend (WT1 passe au-dessus de WT2).' },
  WT_BEAR:         { icon:'📉', label:'WT Bearish',       color:'var(--tm-loss)',     bg:'rgba(var(--tm-loss-rgb,255,59,48),0.10)',   desc:'Croisement baissier WaveTrend (WT1 passe en dessous de WT2).' },
  VMC_BUY:         { icon:'🟢', label:'VMC BUY',          color:'var(--tm-profit)',   bg:'rgba(var(--tm-profit-rgb,34,199,89),0.12)', desc:"Le VMC Oscillator confirme un signal d'achat." },
  VMC_SELL:        { icon:'🔴', label:'VMC SELL',         color:'var(--tm-loss)',     bg:'rgba(var(--tm-loss-rgb,255,59,48),0.12)',   desc:'Le VMC Oscillator confirme un signal de vente.' },
  VMC_COMPRESSION: { icon:'🔄', label:'VMC Compression',  color:'var(--tm-warning)',  bg:'rgba(var(--tm-warning-rgb,255,149,0),0.12)', desc:'Les EMAs du ribbon se compriment — breakout potentiel imminent.' },
  MTF_BUY:         { icon:'🎯', label:'MTF BUY',          color:'var(--tm-profit)',   bg:'rgba(var(--tm-profit-rgb,34,199,89),0.12)', desc:"Signal d'achat multi-timeframe avec forte confluence (>70%)." },
  MTF_SELL:        { icon:'🎯', label:'MTF SELL',         color:'var(--tm-loss)',     bg:'rgba(var(--tm-loss-rgb,255,59,48),0.12)',   desc:'Signal de vente multi-timeframe avec forte confluence (>70%).' },
  MTF_CONFLUENCE:  { icon:'🔗', label:'MTF Confluence',   color:'var(--tm-purple)',   bg:'rgba(var(--tm-purple-rgb,191,90,242),0.12)', desc:'Confluence élevée sur le dashboard MTF.' },
}

const URGENCY_BADGE: Record<string, { label: string; color: string }> = {
  premium: { label: 'PREMIUM', color: '#FFD700' },
  high:    { label: 'HIGH',    color: 'var(--tm-loss)' },
  medium:  { label: 'MEDIUM',  color: 'var(--tm-warning)' },
  low:     { label: 'LOW',     color: 'var(--tm-text-secondary)' },
}

// Condition icons & labels
const COND_META: Record<ConditionType, { icon: string; label: string }> = {
  rsi_lt:        { icon: '📈', label: 'RSI <' },
  rsi_gt:        { icon: '📈', label: 'RSI >' },
  price_lt:      { icon: '💰', label: 'Prix <' },
  price_gt:      { icon: '💰', label: 'Prix >' },
  change_pct_gt: { icon: '⚡', label: 'Variation 24h > %' },
  change_pct_lt: { icon: '⚡', label: 'Baisse 24h < %' },
  volume_gt:     { icon: '📊', label: 'Volume 24h > $' },
  volume_lt:     { icon: '📊', label: 'Volume 24h < $' },
  funding_gt:    { icon: '💸', label: 'Funding Rate >' },
  funding_lt:    { icon: '💸', label: 'Funding Rate <' },
}

const NEEDS_TF = new Set<ConditionType>(['rsi_lt', 'rsi_gt'])

const VALUE_PLACEHOLDER: Partial<Record<ConditionType, string>> = {
  rsi_lt: '30', rsi_gt: '70',
  price_lt: '60000', price_gt: '60000',
  change_pct_gt: '5', change_pct_lt: '-5',
  volume_gt: '1000000000', volume_lt: '1000000000',
  funding_gt: '0.0003', funding_lt: '-0.0001',
}

const TF_OPTIONS: AlertTF[] = ['1m','5m','15m','1h','4h','1d']

type FilterType = 'all' | 'wt' | 'vmc' | 'mtf'

function timeAgo(d: Date): string {
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return "à l'instant"
  if (diff < 3600_000) return `il y a ${Math.floor(diff/60_000)}m`
  if (diff < 86400_000) return `il y a ${Math.floor(diff/3600_000)}h`
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
}

function fmtTs(ts: number): string {
  return new Date(ts).toLocaleString('fr-FR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
}

function conditionSummary(c: AlertCondition): string {
  const m = COND_META[c.type]
  if (NEEDS_TF.has(c.type)) return `${m.label} ${c.value} (${c.timeframe})`
  return `${m.label} ${c.value}`
}

// ── SignalCard ─────────────────────────────────────────────────────────────
function SignalCard({ signal, expanded, onToggle }: { signal: TradingSignal; expanded: boolean; onToggle: () => void }) {
  const meta = SIGNAL_META[signal.type]
  const urg  = URGENCY_BADGE[signal.urgency]
  if (!meta) return null
  return (
    <div onClick={onToggle} style={{
      background: expanded ? meta.bg : 'var(--tm-bg-secondary)',
      border: `1px solid ${expanded ? meta.color + '40' : 'var(--tm-border-sub)'}`,
      borderRadius: 14, padding: '14px 18px', cursor: 'pointer', transition: 'all 0.2s',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ width:40, height:40, borderRadius:12, background:meta.bg, border:`1px solid ${meta.color}30`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, flexShrink:0 }}>
          {meta.icon}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3, flexWrap:'wrap' }}>
            <span style={{ fontSize:13, fontWeight:700, color:meta.color }}>{meta.label}</span>
            <span style={{ fontSize:10, fontWeight:700, color:urg.color, background:`${urg.color}18`, padding:'1px 8px', borderRadius:10, border:`1px solid ${urg.color}40` }}>{urg.label}</span>
            <span style={{ fontSize:10, color:'var(--tm-text-muted)', marginLeft:'auto', fontFamily:'JetBrains Mono,monospace' }}>{timeAgo(signal.timestamp)}</span>
          </div>
          <div style={{ fontSize:12, color:'#C5C8D6', marginBottom:2 }}>{signal.message}</div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <span style={{ fontSize:11, fontWeight:600, color:'#F59714', fontFamily:'JetBrains Mono,monospace' }}>{signal.symbol}</span>
            <span style={{ fontSize:10, color:'var(--tm-text-muted)' }}>·</span>
            <span style={{ fontSize:10, color:'var(--tm-text-secondary)' }}>{signal.timeframe}</span>
            {signal.detail && <span style={{ fontSize:10, color:'var(--tm-text-muted)' }}>· {signal.detail}</span>}
          </div>
        </div>
        <div style={{ fontSize:14, color:'var(--tm-text-muted)', transform:expanded ? 'rotate(180deg)' : 'none', transition:'transform 0.2s', flexShrink:0 }}>▼</div>
      </div>
      {expanded && (
        <div style={{ marginTop:12, paddingTop:12, borderTop:`1px solid ${meta.color}20` }}>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--tm-text-muted)', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.08em' }}>Explication du signal</div>
          <div style={{ fontSize:12, color:'#C5C8D6', lineHeight:1.7 }}>{meta.desc}</div>
          {signal.detail && (
            <div style={{ marginTop:8, padding:'8px 12px', background:'rgba(0,0,0,0.25)', borderRadius:8, fontFamily:'JetBrains Mono,monospace', fontSize:11, color:'var(--tm-text-secondary)' }}>
              {signal.detail}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Toggle Switch ──────────────────────────────────────────────────────────
function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={on ? 'Désactiver' : 'Activer'}
      style={{
        width: 38, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
        background: on ? 'var(--tm-warning)' : 'rgba(255,255,255,0.12)',
        position: 'relative', flexShrink: 0, transition: 'background 0.2s',
      }}
    >
      <span style={{
        position: 'absolute', top: 3, width: 16, height: 16, borderRadius: '50%',
        background: 'white', transition: 'left 0.2s',
        left: on ? 19 : 3,
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }} />
    </button>
  )
}

// ── Custom Alerts Section (redesigned 2-column layout) ─────────────────────
function CustomAlertsSection({ uid }: { uid: string }) {
  const [alerts,       setAlerts]       = useState<CustomAlert[]>([])
  const [history,      setHistory]      = useState<AlertHistoryEntry[]>([])
  const [webhook,      setWebhook]      = useState('')
  const [webhookInput, setWebhookInput] = useState('')
  const [testStatus,   setTestStatus]   = useState<'idle'|'testing'|'ok'|'error'>('idle')
  const [saving,       setSaving]       = useState(false)
  const [loading,      setLoading]      = useState(true)

  // Builder state
  const [newName,     setNewName]     = useState('')
  const [newSymbol,   setNewSymbol]   = useState('BTCUSDT')
  const [newConds,    setNewConds]    = useState<AlertCondition[]>([{ type:'rsi_lt', timeframe:'1h', value:30 }])
  const [newCooldown, setNewCooldown] = useState(30)
  const [building,    setBuilding]    = useState(false)
  const [createError, setCreateError] = useState<string|null>(null)
  const [createOk,    setCreateOk]    = useState(false)

  const nameRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!uid) return
    setLoading(true)
    try {
      const [alts, hist, settings] = await Promise.all([
        getCustomAlerts(uid),
        getAlertHistory(uid).catch(() => [] as AlertHistoryEntry[]),
        getNotifSettings(uid),
      ])
      setAlerts(alts)
      setHistory(hist)
      setWebhook(settings.discordWebhook ?? '')
      setWebhookInput(settings.discordWebhook ?? '')
    } catch (e) {
      console.error('load alerts failed', e)
    } finally {
      setLoading(false)
    }
  }, [uid])

  useEffect(() => { load() }, [load])

  const handleSaveWebhook = async () => {
    setSaving(true)
    await saveNotifSettings(uid, { discordWebhook: webhookInput.trim() })
    setWebhook(webhookInput.trim())
    setSaving(false)
  }

  const handleTestWebhook = async () => {
    setTestStatus('testing')
    try {
      const fn = httpsCallable<{ webhookUrl: string }, { ok: boolean }>(functions, 'testDiscordWebhook')
      const res = await fn({ webhookUrl: webhookInput.trim() })
      setTestStatus(res.data.ok ? 'ok' : 'error')
    } catch {
      setTestStatus('error')
    }
    setTimeout(() => setTestStatus('idle'), 3000)
  }

  const handleToggle = async (alert: CustomAlert) => {
    const updated = { ...alert, enabled: !alert.enabled }
    await saveCustomAlert(uid, updated)
    setAlerts(prev => prev.map(a => a.id === alert.id ? updated : a))
  }

  const handleDelete = async (alertId: string) => {
    await deleteCustomAlert(uid, alertId)
    setAlerts(prev => prev.filter(a => a.id !== alertId))
  }

  const handleAddCondition = () => {
    if (newConds.length >= 6) return
    setNewConds(prev => [...prev, { type:'rsi_lt', timeframe:'1h', value:30 }])
  }

  const handleCondChange = (i: number, field: keyof AlertCondition, val: string | number) => {
    setNewConds(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: val } : c))
  }

  const handleCreateAlert = async () => {
    if (!uid) { setCreateError('Non connecté — rechargez la page'); return }
    if (!newName.trim()) { setCreateError('Le nom est requis'); nameRef.current?.focus(); return }
    if (!newSymbol.trim()) { setCreateError('Le symbole est requis'); return }
    setBuilding(true)
    setCreateError(null)
    try {
      const alert: CustomAlert = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
        name: newName.trim(),
        symbol: newSymbol.trim().toUpperCase(),
        enabled: true,
        conditions: newConds,
        cooldownMinutes: newCooldown,
        createdAt: Date.now(),
      }
      await saveCustomAlert(uid, alert)
      setAlerts(prev => [alert, ...prev])
      setNewName('')
      setNewSymbol('BTCUSDT')
      setNewConds([{ type:'rsi_lt', timeframe:'1h', value:30 }])
      setNewCooldown(30)
      setCreateOk(true)
      setTimeout(() => setCreateOk(false), 3000)
      nameRef.current?.focus()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde')
    } finally {
      setBuilding(false)
    }
  }

  // Enter to submit (if not in textarea or other inputs that have their own enter)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !(e.target as HTMLElement).tagName.match(/^(TEXTAREA|SELECT)$/)) {
      e.preventDefault()
      handleCreateAlert()
    }
  }

  const inputS: React.CSSProperties = {
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, padding: '8px 12px',
    color: 'var(--tm-text-primary)', fontSize: 12,
    fontFamily: 'JetBrains Mono,monospace', outline: 'none', width: '100%',
    transition: 'border-color 0.15s',
  }

  const selectS: React.CSSProperties = { ...inputS, cursor: 'pointer', width: 'auto' }

  if (loading) return (
    <div style={{ textAlign:'center', padding:'60px 20px', color:'var(--tm-text-muted)' }}>
      <div style={{ fontSize:28, marginBottom:12, display:'inline-block', animation:'spin 1s linear infinite' }}>⟳</div>
      <div style={{ fontSize:12 }}>Chargement...</div>
    </div>
  )

  return (
    <div
      style={{ display:'flex', gap:20, alignItems:'flex-start', flexWrap:'wrap' }}
      onKeyDown={handleKeyDown}
    >
      {/* ════ LEFT COLUMN — Notifications + Builder ════ */}
      <div style={{ flex:'0 0 min(420px, 100%)', display:'flex', flexDirection:'column', gap:16 }}>

        {/* Webhook card */}
        <div style={{ background:'rgba(88,86,214,0.06)', border:'1px solid rgba(88,86,214,0.25)', borderRadius:14, padding:'16px 18px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
            <svg width="18" height="18" viewBox="0 0 71 55" fill="none" style={{ flexShrink:0 }}>
              <path d="M60.1 4.9A58.5 58.5 0 0 0 45.5.7a.2.2 0 0 0-.2.1c-.7 1.2-1.4 2.7-1.9 3.9a54.1 54.1 0 0 0-16.3 0 39 39 0 0 0-1.9-3.9.2.2 0 0 0-.2-.1A58.4 58.4 0 0 0 10.8 4.9a.2.2 0 0 0-.1.1C1.6 18.4-.9 31.5.3 44.5a.2.2 0 0 0 .1.1 58.8 58.8 0 0 0 17.7 9 .2.2 0 0 0 .2-.1 42 42 0 0 0 3.6-5.9.2.2 0 0 0-.1-.3 38.7 38.7 0 0 1-5.5-2.6.2.2 0 0 1 0-.4c.4-.3.7-.6 1.1-.8a.2.2 0 0 1 .2 0c11.5 5.3 24 5.3 35.4 0a.2.2 0 0 1 .2 0c.4.3.7.6 1.1.8a.2.2 0 0 1 0 .4 36 36 0 0 1-5.5 2.6.2.2 0 0 0-.1.3 47 47 0 0 0 3.6 5.9.2.2 0 0 0 .2.1 58.6 58.6 0 0 0 17.7-9 .2.2 0 0 0 .1-.1c1.5-15.1-2.5-28.1-10.4-39.7a.2.2 0 0 0-.1 0z" fill="#5856D6"/>
            </svg>
            <span style={{ fontSize:13, fontWeight:700, color:'#7B79F7' }}>Discord Webhook</span>
            {webhook && <span style={{ marginLeft:'auto', fontSize:10, color:'#34C759', fontWeight:600 }}>✓ Configuré</span>}
          </div>

          <input
            style={{ ...inputS, marginBottom:10, fontFamily:'JetBrains Mono,monospace', fontSize:11 }}
            placeholder="https://discord.com/api/webhooks/..."
            value={webhookInput}
            onChange={e => setWebhookInput(e.target.value)}
          />

          <div style={{ display:'flex', gap:8 }}>
            <button
              onClick={handleTestWebhook}
              disabled={testStatus==='testing' || !webhookInput.includes('discord.com')}
              style={{
                flex:1, padding:'8px', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer',
                border: `1px solid ${testStatus==='ok' ? '#34C759' : testStatus==='error' ? '#FF3B30' : 'rgba(123,121,247,0.4)'}50`,
                background: testStatus==='ok' ? 'rgba(52,199,89,0.12)' : testStatus==='error' ? 'rgba(255,59,48,0.12)' : 'rgba(88,86,214,0.12)',
                color: testStatus==='ok' ? '#34C759' : testStatus==='error' ? '#FF3B30' : '#7B79F7',
                opacity: !webhookInput.includes('discord.com') ? 0.4 : 1,
                transition: 'all 0.15s',
              }}
            >
              {testStatus==='testing' ? '⟳ Test...' : testStatus==='ok' ? '✓ OK !' : testStatus==='error' ? '✗ Erreur' : 'Tester'}
            </button>
            <button
              onClick={handleSaveWebhook}
              disabled={saving || webhookInput === webhook}
              style={{
                flex:1, padding:'8px', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer',
                border: '1px solid rgba(88,86,214,0.4)',
                background: 'rgba(88,86,214,0.15)',
                color: '#7B79F7',
                opacity: (saving || webhookInput === webhook) ? 0.4 : 1,
                transition: 'all 0.15s',
              }}
            >
              {saving ? 'Sauvegarde...' : 'Sauvegarder'}
            </button>
          </div>

          {!webhook && (
            <div style={{ marginTop:10, fontSize:11, color:'var(--tm-text-muted)', lineHeight:1.5 }}>
              Dans Discord : Paramètres du serveur → Intégrations → Webhooks → Créer → Copier l'URL
            </div>
          )}
        </div>

        {/* Alert builder card */}
        <div style={{ background:'rgba(255,149,0,0.04)', border:'1px solid rgba(255,149,0,0.2)', borderRadius:14, padding:'16px 18px' }}>
          <div style={{ fontSize:13, fontWeight:700, color:'var(--tm-warning)', marginBottom:16, display:'flex', alignItems:'center', gap:8 }}>
            <span>➕</span> Nouvelle alerte
          </div>

          {/* Name + Symbol + Cooldown */}
          <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:14 }}>
            <div>
              <label style={{ fontSize:10, fontWeight:600, color:'var(--tm-text-muted)', display:'block', marginBottom:4 }}>Nom de l'alerte</label>
              <input
                ref={nameRef}
                style={inputS}
                placeholder="BTC RSI oversold"
                autoComplete="off"
                value={newName}
                onChange={e => setNewName(e.target.value)}
              />
            </div>
            <div style={{ display:'flex', gap:10 }}>
              <div style={{ flex:1 }}>
                <label style={{ fontSize:10, fontWeight:600, color:'var(--tm-text-muted)', display:'block', marginBottom:4 }}>Symbole</label>
                <input
                  style={inputS}
                  placeholder="BTCUSDT"
                  value={newSymbol}
                  onChange={e => setNewSymbol(e.target.value.toUpperCase())}
                />
              </div>
              <div style={{ width:110 }}>
                <label style={{ fontSize:10, fontWeight:600, color:'var(--tm-text-muted)', display:'block', marginBottom:4 }}>Cooldown (min)</label>
                <input
                  type="number" min={5} max={1440}
                  style={inputS}
                  value={newCooldown}
                  onChange={e => setNewCooldown(Math.max(5, parseInt(e.target.value)||30))}
                />
              </div>
            </div>
          </div>

          {/* Conditions */}
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:10, fontWeight:600, color:'var(--tm-text-muted)', display:'block', marginBottom:8, textTransform:'uppercase', letterSpacing:'0.06em' }}>
              Conditions ({newConds.length}/6)
            </label>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {newConds.map((c, i) => (
                <div key={i} style={{
                  display:'flex', gap:6, alignItems:'center',
                  padding:'10px 12px', borderRadius:10,
                  background:'rgba(255,255,255,0.03)',
                  border:'1px solid rgba(255,255,255,0.07)',
                }}>
                  {/* SI / ET label + icon */}
                  <div style={{
                    fontSize:9, fontWeight:700, color:'var(--tm-text-muted)',
                    width:24, textAlign:'center', flexShrink:0,
                    fontFamily:'JetBrains Mono,monospace',
                  }}>
                    {i === 0 ? 'SI' : 'ET'}
                  </div>

                  {/* Type icon */}
                  <span style={{ fontSize:14, flexShrink:0 }}>{COND_META[c.type].icon}</span>

                  {/* Type select */}
                  <select
                    style={{ ...selectS, flex:1, minWidth:0 }}
                    value={c.type}
                    onChange={e => handleCondChange(i, 'type', e.target.value as ConditionType)}
                  >
                    <optgroup label="RSI">
                      <option value="rsi_lt">RSI &lt; (sous-vendu)</option>
                      <option value="rsi_gt">RSI &gt; (sur-acheté)</option>
                    </optgroup>
                    <optgroup label="Prix">
                      <option value="price_lt">Prix &lt;</option>
                      <option value="price_gt">Prix &gt;</option>
                    </optgroup>
                    <optgroup label="Variation 24h">
                      <option value="change_pct_gt">Hausse 24h &gt; %</option>
                      <option value="change_pct_lt">Baisse 24h &lt; %</option>
                    </optgroup>
                    <optgroup label="Volume">
                      <option value="volume_gt">Volume 24h &gt; $</option>
                      <option value="volume_lt">Volume 24h &lt; $</option>
                    </optgroup>
                    <optgroup label="Funding Rate (Futures)">
                      <option value="funding_gt">Funding Rate &gt;</option>
                      <option value="funding_lt">Funding Rate &lt;</option>
                    </optgroup>
                  </select>

                  {/* Timeframe (RSI only) */}
                  {NEEDS_TF.has(c.type) && (
                    <select
                      style={{ ...selectS, width:56 }}
                      value={c.timeframe}
                      onChange={e => handleCondChange(i, 'timeframe', e.target.value as AlertTF)}
                    >
                      {TF_OPTIONS.map(tf => <option key={tf} value={tf}>{tf}</option>)}
                    </select>
                  )}

                  {/* Value */}
                  <input
                    type="number"
                    style={{ ...inputS, width:80, flexShrink:0 }}
                    placeholder={VALUE_PLACEHOLDER[c.type] ?? '0'}
                    value={c.value}
                    onChange={e => handleCondChange(i, 'value', parseFloat(e.target.value)||0)}
                  />

                  {/* Remove */}
                  {newConds.length > 1 && (
                    <button
                      onClick={() => setNewConds(prev => prev.filter((_, idx) => idx !== i))}
                      title="Supprimer"
                      style={{
                        width:24, height:24, borderRadius:6, border:'1px solid rgba(255,59,48,0.3)',
                        background:'rgba(255,59,48,0.08)', color:'#FF3B30',
                        cursor:'pointer', flexShrink:0, fontSize:12,
                        display:'flex', alignItems:'center', justifyContent:'center',
                      }}
                    >×</button>
                  )}
                </div>
              ))}
            </div>
            {newConds.length < 6 && (
              <button
                onClick={handleAddCondition}
                style={{
                  marginTop:8, width:'100%', padding:'8px', borderRadius:8,
                  border:'1px dashed rgba(255,255,255,0.12)',
                  background:'transparent', color:'var(--tm-text-muted)',
                  cursor:'pointer', fontSize:12, transition:'all 0.15s',
                }}
                className="hover:bg-white/[0.03] hover:border-white/20"
              >
                + Ajouter une condition
              </button>
            )}
          </div>

          {/* Feedback messages */}
          {createError && (
            <div style={{ marginBottom:10, padding:'9px 12px', background:'rgba(255,59,48,0.08)', border:'1px solid rgba(255,59,48,0.3)', borderRadius:8, fontSize:12, color:'#FF3B30', display:'flex', alignItems:'center', gap:8 }}>
              <span>✗</span> {createError}
            </div>
          )}
          {createOk && (
            <div style={{ marginBottom:10, padding:'9px 12px', background:'rgba(52,199,89,0.1)', border:'1px solid rgba(52,199,89,0.3)', borderRadius:8, fontSize:12, color:'#34C759', display:'flex', alignItems:'center', gap:8, animation:'fadeIn 0.2s ease-out' }}>
              <span>✓</span> Alerte créée avec succès !
            </div>
          )}

          {/* Submit */}
          <button
            type="button"
            onClick={handleCreateAlert}
            disabled={building}
            style={{
              width:'100%', padding:'11px', borderRadius:10,
              border:'1px solid rgba(255,149,0,0.4)',
              background: building ? 'rgba(255,149,0,0.08)' : 'rgba(255,149,0,0.15)',
              color: 'var(--tm-warning)',
              fontSize:13, fontWeight:700, cursor: building ? 'not-allowed' : 'pointer',
              opacity: building ? 0.7 : 1,
              transition:'all 0.15s',
            }}
          >
            {building ? '⟳ Création...' : '✓ Créer l\'alerte'}
          </button>
          <div style={{ marginTop:6, fontSize:10, color:'var(--tm-text-muted)', textAlign:'center' }}>
            Appuie sur Entrée pour créer rapidement
          </div>
        </div>
      </div>

      {/* ════ RIGHT COLUMN — Active alerts + History ════ */}
      <div style={{ flex:1, minWidth:280, display:'flex', flexDirection:'column', gap:16 }}>

        {/* Active alerts */}
        <div style={{ background:'var(--tm-bg-secondary)', border:'1px solid var(--tm-border-sub)', borderRadius:14, padding:'16px 18px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
            <span style={{ fontSize:14 }}>⚡</span>
            <span style={{ fontSize:13, fontWeight:700, color:'var(--tm-text-primary)' }}>
              Alertes actives
            </span>
            <span style={{ marginLeft:'auto', fontSize:11, fontFamily:'JetBrains Mono,monospace', color:'var(--tm-text-muted)' }}>
              {alerts.filter(a => a.enabled).length}/{alerts.length}
            </span>
          </div>

          {alerts.length === 0 ? (
            <div style={{ padding:'32px 16px', textAlign:'center' }}>
              <div style={{ fontSize:36, marginBottom:10 }}>🔕</div>
              <div style={{ fontSize:13, fontWeight:600, color:'var(--tm-text-secondary)', marginBottom:6 }}>Aucune alerte</div>
              <div style={{ fontSize:12, color:'var(--tm-text-muted)', lineHeight:1.5 }}>
                Crée ta première alerte dans le formulaire à gauche
              </div>
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {alerts.map(alert => (
                <div key={alert.id} style={{
                  padding:'12px 14px', borderRadius:10,
                  background: alert.enabled ? 'rgba(255,149,0,0.04)' : 'rgba(255,255,255,0.02)',
                  border:`1px solid ${alert.enabled ? 'rgba(255,149,0,0.2)' : 'rgba(255,255,255,0.06)'}`,
                  display:'flex', alignItems:'center', gap:10,
                  transition:'all 0.2s',
                }}>
                  <Toggle on={alert.enabled} onClick={() => handleToggle(alert)} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:600, color: alert.enabled ? 'var(--tm-text-primary)' : 'var(--tm-text-muted)', marginBottom:2 }}>
                      {alert.name}
                    </div>
                    <div style={{ fontSize:10, color:'var(--tm-text-muted)', fontFamily:'JetBrains Mono,monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      <span style={{ color:'#F59714', marginRight:6 }}>{alert.symbol}</span>
                      {alert.conditions.map((c, i) => (
                        <span key={i}>{i > 0 ? ' ET ' : ''}{conditionSummary(c)}</span>
                      ))}
                    </div>
                    {alert.lastTriggered && (
                      <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginTop:2 }}>
                        Dernier : {fmtTs(alert.lastTriggered)}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(alert.id)}
                    title="Supprimer"
                    style={{
                      width:28, height:28, borderRadius:7, border:'1px solid rgba(255,59,48,0.25)',
                      background:'rgba(255,59,48,0.06)', color:'#FF3B30',
                      cursor:'pointer', fontSize:13, flexShrink:0,
                      display:'flex', alignItems:'center', justifyContent:'center',
                    }}
                  >🗑</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* History */}
        <div style={{ background:'var(--tm-bg-secondary)', border:'1px solid var(--tm-border-sub)', borderRadius:14, padding:'16px 18px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
            <span style={{ fontSize:14 }}>🕐</span>
            <span style={{ fontSize:13, fontWeight:700, color:'var(--tm-text-primary)' }}>Historique</span>
            <span style={{ marginLeft:'auto', fontSize:11, color:'var(--tm-text-muted)', fontFamily:'JetBrains Mono,monospace' }}>{history.length}</span>
          </div>

          {history.length === 0 ? (
            <div style={{ padding:'20px', textAlign:'center', color:'var(--tm-text-muted)', fontSize:12 }}>
              Aucun déclenchement enregistré
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {history.map(h => (
                <div key={h.id} style={{
                  padding:'9px 12px', borderRadius:8,
                  background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.06)',
                  display:'flex', alignItems:'center', gap:10,
                }}>
                  <span style={{ fontSize:13, flexShrink:0 }}>🔔</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <span style={{ fontSize:11, fontWeight:600, color:'var(--tm-text-primary)', marginRight:6 }}>{h.alertName}</span>
                    <span style={{ fontSize:10, color:'var(--tm-text-muted)', fontFamily:'JetBrains Mono,monospace' }}>{h.conditionMet}</span>
                  </div>
                  <span style={{ fontSize:10, color:'var(--tm-text-muted)', fontFamily:'JetBrains Mono,monospace', flexShrink:0 }}>
                    {fmtTs(h.triggeredAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────
type PageTab = 'signaux' | 'custom'

export default function AlertesPage() {
  const [signals, setSignals] = useState<TradingSignal[]>(signalService.getHistory())
  const [filter, setFilter] = useState<FilterType>('all')
  const [expandedId, setExpandedId] = useState<string|null>(null)
  const [pageTab, setPageTab] = useState<PageTab>('signaux')

  const authUser = useUser()
  const uid = authUser?.uid ?? ''

  useEffect(() => {
    const unsub = signalService.subscribe(() => setSignals([...signalService.getHistory()]))
    return unsub
  }, [])

  useEffect(() => {
    if (!signalService.isGranted) signalService.requestPermission()
  }, [])

  const filtered = signals.filter(s => {
    if (filter === 'wt')  return s.type.startsWith('WT_')
    if (filter === 'vmc') return s.type.startsWith('VMC_')
    if (filter === 'mtf') return s.type.startsWith('MTF_')
    return true
  })

  const wtCount      = signals.filter(s => s.type.startsWith('WT_')).length
  const vmcCount     = signals.filter(s => s.type.startsWith('VMC_')).length
  const mtfCount     = signals.filter(s => s.type.startsWith('MTF_')).length
  const premiumCount = signals.filter(s => s.urgency === 'premium').length

  return (
    <div style={{ minHeight:'100vh', background:'var(--tm-bg)', padding:'28px 24px 40px', maxWidth:1100, margin:'0 auto' }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
      `}</style>

      {/* ── Header ── */}
      <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:24 }}>
        <div style={{
          width:44, height:44, borderRadius:14, flexShrink:0,
          background:'linear-gradient(135deg,rgba(255,149,0,0.2),rgba(255,59,48,0.15))',
          border:'1px solid rgba(255,149,0,0.3)',
          display:'flex', alignItems:'center', justifyContent:'center', fontSize:22,
        }}>🔔</div>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:'var(--tm-text-primary)', margin:0, fontFamily:'Syne,sans-serif' }}>
            Alertes & Signaux
          </h1>
          <p style={{ fontSize:12, color:'var(--tm-text-muted)', margin:0 }}>
            WaveTrend · VMC · MTF · Custom Discord
          </p>
        </div>
        {premiumCount > 0 && (
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6, padding:'5px 14px', background:'rgba(255,215,0,0.1)', border:'1px solid rgba(255,215,0,0.3)', borderRadius:20 }}>
            <span style={{ fontSize:13 }}>⭐</span>
            <span style={{ fontSize:11, fontWeight:700, color:'#FFD700' }}>{premiumCount} premium</span>
          </div>
        )}
      </div>

      {/* ── Page tabs ── */}
      <div style={{ display:'flex', gap:8, marginBottom:24 }}>
        {([
          { id:'signaux' as PageTab, icon:'🔔', label:'Signaux auto',   sub:`${signals.length} signaux` },
          { id:'custom'  as PageTab, icon:'⚡', label:'Custom Alertes', sub:'Discord webhook · 24/7' },
        ]).map(t => {
          const active = pageTab === t.id
          return (
            <button key={t.id} onClick={() => setPageTab(t.id)} style={{
              display:'flex', flexDirection:'column', padding:'12px 20px', borderRadius:12,
              cursor:'pointer', textAlign:'left', transition:'all 0.2s', border:'none',
              background: active ? 'rgba(255,149,0,0.1)' : 'var(--tm-bg-secondary)',
              outline: `1px solid ${active ? 'rgba(255,149,0,0.4)' : 'var(--tm-border-sub)'}`,
            }}>
              <span style={{ fontSize:13, fontWeight:700, color: active ? 'var(--tm-warning)' : 'var(--tm-text-secondary)', fontFamily:'Syne,sans-serif' }}>
                {t.icon} {t.label}
              </span>
              <span style={{ fontSize:10, color: active ? 'rgba(255,149,0,0.7)' : 'var(--tm-text-muted)', fontFamily:'JetBrains Mono,monospace', marginTop:2 }}>
                {t.sub}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Tab: Signaux ── */}
      {pageTab === 'signaux' && (
        <>
          {/* Stats */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:20 }}>
            {[
              { label:'Total',      value:signals.length, color:'var(--tm-text-primary)', bg:'rgba(255,255,255,0.03)' },
              { label:'WaveTrend',  value:wtCount,        color:'#37D7FF',                bg:'rgba(55,215,255,0.06)'  },
              { label:'VMC',        value:vmcCount,       color:'var(--tm-warning)',       bg:'rgba(255,149,0,0.06)'  },
              { label:'MTF',        value:mtfCount,       color:'var(--tm-purple)',        bg:'rgba(191,90,242,0.06)' },
            ].map(({ label, value, color, bg }) => (
              <div key={label} style={{ background:bg, border:'1px solid #1E2330', borderRadius:12, padding:'12px 14px', textAlign:'center' }}>
                <div style={{ fontSize:22, fontWeight:800, color, fontFamily:'JetBrains Mono,monospace' }}>{value}</div>
                <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginTop:2 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Notification permission banner */}
          {!signalService.isGranted && (
            <div style={{ padding:'14px 20px', background:'rgba(0,229,255,0.06)', border:'1px solid rgba(0,229,255,0.2)', borderRadius:12, marginBottom:16, display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
              <div>
                <div style={{ fontSize:12, fontWeight:600, color:'var(--tm-accent)' }}>Activer les notifications</div>
                <div style={{ fontSize:11, color:'var(--tm-text-muted)' }}>Recevez les alertes même quand l'onglet est en arrière-plan</div>
              </div>
              <button onClick={() => signalService.requestPermission()} style={{ padding:'7px 16px', borderRadius:8, border:'1px solid rgba(0,229,255,0.3)', background:'rgba(0,229,255,0.15)', color:'var(--tm-accent)', fontSize:11, fontWeight:600, cursor:'pointer', flexShrink:0 }}>
                Activer
              </button>
            </div>
          )}

          {/* Filters */}
          <div style={{ display:'flex', gap:8, marginBottom:20, flexWrap:'wrap', alignItems:'center' }}>
            {([
              { id:'all' as FilterType, label:'Toutes',    count:signals.length },
              { id:'wt'  as FilterType, label:'WaveTrend', count:wtCount },
              { id:'vmc' as FilterType, label:'VMC',       count:vmcCount },
              { id:'mtf' as FilterType, label:'MTF',       count:mtfCount },
            ]).map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)} style={{
                display:'flex', alignItems:'center', gap:6, padding:'7px 16px', borderRadius:20,
                fontSize:12, fontWeight:600, cursor:'pointer', border:'none',
                outline:`1px solid ${filter===f.id ? 'var(--tm-warning)' : 'var(--tm-border)'}`,
                background: filter===f.id ? 'rgba(255,149,0,0.15)' : 'transparent',
                color: filter===f.id ? 'var(--tm-warning)' : 'var(--tm-text-muted)',
              }}>
                {f.label}
                <span style={{ fontSize:10, fontWeight:700, background:'var(--tm-border)', padding:'1px 6px', borderRadius:10, color: filter===f.id ? 'var(--tm-warning)' : 'var(--tm-text-muted)' }}>{f.count}</span>
              </button>
            ))}
            {signals.length > 0 && (
              <button
                onClick={() => { signalService.clearHistory(); setSignals([]) }}
                style={{ marginLeft:'auto', padding:'7px 14px', borderRadius:20, fontSize:11, background:'rgba(255,59,48,0.08)', border:'1px solid rgba(255,59,48,0.2)', color:'var(--tm-loss)', cursor:'pointer' }}
              >
                🗑 Vider
              </button>
            )}
          </div>

          {/* Signal list */}
          {filtered.length === 0 ? (
            <div style={{ textAlign:'center', padding:'60px 20px', color:'var(--tm-text-muted)' }}>
              <div style={{ fontSize:48, marginBottom:16 }}>🔕</div>
              <div style={{ fontSize:16, fontWeight:600, color:'var(--tm-text-secondary)', marginBottom:8 }}>Aucune alerte</div>
              <div style={{ fontSize:13, maxWidth:400, margin:'0 auto', lineHeight:1.6 }}>
                Les alertes apparaissent automatiquement quand WaveTrend et VMC détectent des signaux sur la page Analyse.
              </div>
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {filtered.map(s => (
                <div key={s.id} style={{ animation:'fadeIn 0.2s ease-out' }}>
                  <SignalCard signal={s} expanded={expandedId === s.id} onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)} />
                </div>
              ))}
            </div>
          )}

          {/* Legend */}
          <div style={{ marginTop:24, padding:'16px 20px', background:'var(--tm-bg-secondary)', border:'1px solid #1E2330', borderRadius:12 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--tm-text-muted)', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.08em' }}>Types de signaux</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px,1fr))', gap:8 }}>
              {[
                { icon:'⭐', label:'Smart Reversal', desc:'Zone extrême + croisement', color:'#FFD700' },
                { icon:'📈', label:'WT Crossover',   desc:'Croisement WT1/WT2',        color:'var(--tm-profit)' },
                { icon:'🟢', label:'VMC Buy/Sell',   desc:'Confirmation multi-indicateur', color:'var(--tm-profit)' },
                { icon:'🔄', label:'Compression',    desc:'EMAs serrées → breakout',  color:'var(--tm-warning)' },
                { icon:'🎯', label:'MTF Signal',     desc:'Confluence multi-timeframe',color:'var(--tm-purple)' },
                { icon:'🔗', label:'Confluence',     desc:'>70% TFs alignés',          color:'var(--tm-accent)' },
              ].map(({ icon, label, desc, color }) => (
                <div key={label} style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ fontSize:14 }}>{icon}</span>
                  <div>
                    <div style={{ fontSize:11, fontWeight:600, color }}>{label}</div>
                    <div style={{ fontSize:10, color:'var(--tm-text-muted)' }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Tab: Custom Alertes ── */}
      {pageTab === 'custom' && uid && <CustomAlertsSection uid={uid} />}
      {pageTab === 'custom' && !uid && (
        <div style={{ padding:'60px 20px', textAlign:'center' }}>
          <div style={{ fontSize:40, marginBottom:12 }}>🔐</div>
          <div style={{ fontSize:14, fontWeight:600, color:'var(--tm-text-secondary)', marginBottom:6 }}>Connexion requise</div>
          <div style={{ fontSize:13, color:'var(--tm-text-muted)' }}>Connectez-vous pour gérer vos alertes custom.</div>
        </div>
      )}
    </div>
  )
}
