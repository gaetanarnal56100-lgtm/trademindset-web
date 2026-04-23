// src/pages/journal/ExchangeSyncModal.tsx
// Import automatique de trades — exchanges crypto + brokers forex/stocks/actions

import { useState, useEffect, useRef } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/services/firebase/config'

export type Exchange =
  | 'binance' | 'bybit' | 'okx' | 'kucoinfutures' | 'bitget'
  | 'gateio' | 'mexc' | 'htx' | 'kraken' | 'coinbase' | 'phemex' | 'deribit'
  | 'oanda' | 'fxcm' | 'ig' | 'capitalcom' | 'interactivebrokers' | 'saxo' | 'xtb' | 'etoro' | 'pepperstone' | 'cmc'
  | 'alpaca' | 'tastytrade' | 'schwab' | 'webull' | 'moomoo' | 'degiro' | 'trading212' | 'etrade' | 'tradestation'

export interface KeyStatus {
  connected: boolean
  exchange?: Exchange
  apiKeyMasked?: string
  lastSync?: number | null
  importedCount?: number
}

interface SyncResult { imported: number; skipped: number; message: string }

interface ExchangeDef {
  id: Exchange
  name: string
  domain: string          // for Clearbit logo
  color: string           // brand color (fallback bg)
  initials: string        // fallback text
  category: 'crypto' | 'forex' | 'stocks'
  docs: string
  comingSoon?: boolean
  fields: { keyLabel: string; secretLabel: string; passphraseLabel?: string }
}

const EXCHANGES: ExchangeDef[] = [
  // ══ CRYPTO ════════════════════════════════════════════════════════════════
  { id:'binance',       name:'Binance',          domain:'binance.com',            color:'#F0B90B', initials:'B',   category:'crypto', docs:'https://www.binance.com/en/my/settings/api-management',    fields:{keyLabel:'API Key', secretLabel:'API Secret'} },
  { id:'bybit',         name:'Bybit',            domain:'bybit.com',              color:'#F7A12C', initials:'BY',  category:'crypto', docs:'https://www.bybit.com/app/user/api-management',            fields:{keyLabel:'API Key', secretLabel:'API Secret'} },
  { id:'okx',           name:'OKX',              domain:'okx.com',                color:'#E6E6E6', initials:'OKX', category:'crypto', docs:'https://www.okx.com/account/my-api',                       fields:{keyLabel:'API Key', secretLabel:'Secret Key', passphraseLabel:'Passphrase'} },
  { id:'kucoinfutures', name:'KuCoin Futures',   domain:'kucoin.com',             color:'#00C076', initials:'KC',  category:'crypto', docs:'https://www.kucoin.com/account/api',                       fields:{keyLabel:'API Key', secretLabel:'API Secret', passphraseLabel:'Passphrase'} },
  { id:'bitget',        name:'Bitget',           domain:'bitget.com',             color:'#00C0F0', initials:'BG',  category:'crypto', docs:'https://www.bitget.com/en/account/newapi',                 fields:{keyLabel:'API Key', secretLabel:'Secret Key', passphraseLabel:'Passphrase'} },
  { id:'gateio',        name:'Gate.io',          domain:'gate.io',                color:'#2354E6', initials:'GT',  category:'crypto', docs:'https://www.gate.io/myaccount/api_key_manage',             fields:{keyLabel:'API Key', secretLabel:'API Secret'} },
  { id:'mexc',          name:'MEXC Global',      domain:'mexc.com',               color:'#0ECBA1', initials:'MX',  category:'crypto', docs:'https://www.mexc.com/user/openapi',                        fields:{keyLabel:'API Key', secretLabel:'API Secret'} },
  { id:'htx',           name:'HTX (Huobi)',      domain:'htx.com',                color:'#167AFF', initials:'HT',  category:'crypto', docs:'https://www.htx.com/en-us/user/apikey',                   fields:{keyLabel:'API Key', secretLabel:'Secret Key'} },
  { id:'kraken',        name:'Kraken',           domain:'kraken.com',             color:'#5741D9', initials:'KR',  category:'crypto', docs:'https://www.kraken.com/u/security/api',                    fields:{keyLabel:'API Key', secretLabel:'API Secret'}, comingSoon:true },
  { id:'coinbase',      name:'Coinbase Advanced',domain:'coinbase.com',           color:'#0052FF', initials:'CB',  category:'crypto', docs:'https://www.coinbase.com/settings/api',                    fields:{keyLabel:'API Key', secretLabel:'API Secret'}, comingSoon:true },
  { id:'phemex',        name:'Phemex',           domain:'phemex.com',             color:'#4D6AFF', initials:'PH',  category:'crypto', docs:'https://phemex.com/user-settings/api-management',         fields:{keyLabel:'API Key', secretLabel:'API Secret'}, comingSoon:true },
  { id:'deribit',       name:'Deribit',          domain:'deribit.com',            color:'#1B8B43', initials:'DR',  category:'crypto', docs:'https://www.deribit.com/main#/account/api',                fields:{keyLabel:'Client ID', secretLabel:'Client Secret'}, comingSoon:true },

  // ══ FOREX / CFD ═══════════════════════════════════════════════════════════
  { id:'oanda',         name:'OANDA',            domain:'oanda.com',              color:'#00A99D', initials:'OA',  category:'forex',  docs:'https://www.oanda.com/account/#/user/security',            fields:{keyLabel:'API Token (Bearer)', secretLabel:'Account ID'} },
  { id:'fxcm',          name:'FXCM',             domain:'fxcm.com',               color:'#E31E24', initials:'FX',  category:'forex',  docs:'https://www.fxcm.com/uk/algorithmic-trading/api-trading/', fields:{keyLabel:'Bearer Token', secretLabel:'Account ID'}, comingSoon:true },
  { id:'ig',            name:'IG Group',         domain:'ig.com',                 color:'#1F87E8', initials:'IG',  category:'forex',  docs:'https://labs.ig.com/apioverviewv2',                        fields:{keyLabel:'API Key', secretLabel:'Password'}, comingSoon:true },
  { id:'capitalcom',    name:'Capital.com',      domain:'capital.com',            color:'#00D09C', initials:'CC',  category:'forex',  docs:'https://open-api.capital.com/',                            fields:{keyLabel:'API Key', secretLabel:'Password'}, comingSoon:true },
  { id:'saxo',          name:'Saxo Bank',        domain:'home.saxo',              color:'#0033A0', initials:'SX',  category:'forex',  docs:'https://www.developer.saxo/openapi',                       fields:{keyLabel:'App Key', secretLabel:'App Secret'}, comingSoon:true },
  { id:'etoro',         name:'eToro',            domain:'etoro.com',              color:'#00C896', initials:'ET',  category:'forex',  docs:'https://www.etoro.com/',                                   fields:{keyLabel:'API Key', secretLabel:'API Secret'}, comingSoon:true },
  { id:'xtb',           name:'XTB',              domain:'xtb.com',                color:'#E60000', initials:'XTB', category:'forex',  docs:'https://developers.xtb.com/',                              fields:{keyLabel:'API Key', secretLabel:'API Secret'}, comingSoon:true },
  { id:'pepperstone',   name:'Pepperstone',      domain:'pepperstone.com',        color:'#00B140', initials:'PP',  category:'forex',  docs:'https://pepperstone.com/',                                 fields:{keyLabel:'API Key', secretLabel:'API Secret'}, comingSoon:true },
  { id:'cmc',           name:'CMC Markets',      domain:'cmcmarkets.com',         color:'#003882', initials:'CMC', category:'forex',  docs:'https://www.cmcmarkets.com/',                              fields:{keyLabel:'API Key', secretLabel:'API Secret'}, comingSoon:true },
  { id:'interactivebrokers', name:'Interactive Brokers', domain:'interactivebrokers.com', color:'#E3001B', initials:'IB', category:'forex', docs:'https://ibkr.info/article/2746', fields:{keyLabel:'API Key', secretLabel:'API Secret'}, comingSoon:true },

  // ══ STOCKS / ACTIONS ══════════════════════════════════════════════════════
  { id:'alpaca',        name:'Alpaca',           domain:'alpaca.markets',         color:'#FBDF02', initials:'AL',  category:'stocks', docs:'https://app.alpaca.markets/paper-accounts',                fields:{keyLabel:'API Key ID', secretLabel:'API Secret Key'} },
  { id:'tastytrade',    name:'Tastytrade',       domain:'tastytrade.com',         color:'#FF6720', initials:'TT',  category:'stocks', docs:'https://tastytrade.com/',                                  fields:{keyLabel:'Username', secretLabel:'Password'}, comingSoon:true },
  { id:'schwab',        name:'Charles Schwab',   domain:'schwab.com',             color:'#00A0DF', initials:'CS',  category:'stocks', docs:'https://developer.schwab.com/',                            fields:{keyLabel:'App Key', secretLabel:'App Secret'}, comingSoon:true },
  { id:'etrade',        name:'E*TRADE',          domain:'etrade.com',             color:'#7B2D8B', initials:'ET',  category:'stocks', docs:'https://developer.etrade.com/',                            fields:{keyLabel:'Consumer Key', secretLabel:'Consumer Secret'}, comingSoon:true },
  { id:'tradestation',  name:'TradeStation',     domain:'tradestation.com',       color:'#FF6600', initials:'TS',  category:'stocks', docs:'https://developer.tradestation.com/',                      fields:{keyLabel:'API Key', secretLabel:'API Secret'}, comingSoon:true },
  { id:'webull',        name:'Webull',           domain:'webull.com',             color:'#0FB7E4', initials:'WB',  category:'stocks', docs:'https://www.webull.com/',                                  fields:{keyLabel:'API Key', secretLabel:'API Secret'}, comingSoon:true },
  { id:'moomoo',        name:'moomoo',           domain:'moomoo.com',             color:'#FF5C2E', initials:'MM',  category:'stocks', docs:'https://www.moomoo.com/',                                  fields:{keyLabel:'API Key', secretLabel:'API Secret'}, comingSoon:true },
  { id:'degiro',        name:'DEGIRO',           domain:'degiro.eu',              color:'#FF5F00', initials:'DG',  category:'stocks', docs:'https://www.degiro.eu/',                                   fields:{keyLabel:'Username', secretLabel:'Password'}, comingSoon:true },
  { id:'trading212',    name:'Trading 212',      domain:'trading212.com',         color:'#22D672', initials:'T2',  category:'stocks', docs:'https://www.trading212.com/',                              fields:{keyLabel:'API Key', secretLabel:'API Secret'}, comingSoon:true },
]

const CATEGORIES = [
  { id: 'crypto' as const,  label: 'Crypto' },
  { id: 'forex'  as const,  label: 'Forex / CFD' },
  { id: 'stocks' as const,  label: 'Stocks / Actions' },
]

const ACTIVE_EXCHANGES = EXCHANGES.filter(e => !e.comingSoon).map(e => e.id)

// ── Cloud Function callables ──────────────────────────────────────────────────
const cfSaveKey   = httpsCallable<{ exchange: Exchange; apiKey: string; apiSecret: string; passphrase?: string }, { success: boolean; message: string }>(functions, 'saveExchangeAPIKey')
const cfGetStatus = httpsCallable<{ exchange: Exchange }, KeyStatus>(functions, 'getExchangeKeyStatus')
const cfDeleteKey = httpsCallable<{ exchange: Exchange }, { success: boolean }>(functions, 'deleteExchangeAPIKey')
export const cfSync = httpsCallable<{ exchange: Exchange; startTime?: number }, SyncResult>(functions, 'syncExchangeTrades')

function fmtTime(ms: number) {
  return new Date(ms).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })
}

// ── Logo avec fallback ────────────────────────────────────────────────────────
function ExchangeLogo({ domain, name, color, initials, size = 36 }: {
  domain: string; name: string; color: string; initials: string; size?: number
}) {
  const [err, setErr] = useState(false)
  const borderRadius = Math.round(size * 0.25)
  const fontSize = size <= 36 ? (initials.length > 2 ? 9 : 12) : 14

  if (err) {
    return (
      <div style={{
        width: size, height: size, borderRadius, flexShrink: 0,
        background: `${color}22`, border: `1px solid ${color}44`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize, fontWeight: 800, color, fontFamily: 'JetBrains Mono, monospace',
        letterSpacing: '-0.03em',
      }}>
        {initials}
      </div>
    )
  }

  return (
    <img
      src={`https://logo.clearbit.com/${domain}`}
      alt={name}
      onError={() => setErr(true)}
      style={{
        width: size, height: size, borderRadius, flexShrink: 0,
        objectFit: 'contain', background: '#fff',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    />
  )
}

// ── Exchange Card ─────────────────────────────────────────────────────────────
function ExchangeCard({ ex, status, onRefreshStatus }: {
  ex: ExchangeDef; status: KeyStatus | null; onRefreshStatus: () => void
}) {
  const [expanded,   setExpanded]   = useState(false)
  const [apiKey,     setApiKey]     = useState('')
  const [secret,     setSecret]     = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [showSec,    setShowSec]    = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [syncing,    setSyncing]    = useState(false)
  const [deleting,   setDeleting]   = useState(false)
  const [msg,        setMsg]        = useState<{ type:'ok'|'err'; text:string } | null>(null)

  const connected = status?.connected ?? false
  const needsPassphrase = !!ex.fields.passphraseLabel

  const handleSave = async () => {
    if (!apiKey.trim() || !secret.trim()) return
    if (needsPassphrase && !passphrase.trim()) return
    setSaving(true); setMsg(null)
    try {
      const r = await cfSaveKey({ exchange: ex.id, apiKey: apiKey.trim(), apiSecret: secret.trim(), ...(needsPassphrase ? { passphrase: passphrase.trim() } : {}) })
      setMsg({ type:'ok', text: r.data.message })
      setApiKey(''); setSecret(''); setPassphrase(''); setExpanded(false)
      onRefreshStatus()
    } catch (e: any) { setMsg({ type:'err', text: e?.message ?? 'Erreur inconnue' }) }
    finally { setSaving(false) }
  }

  const handleSync = async () => {
    setSyncing(true); setMsg(null)
    try {
      const r = await cfSync({ exchange: ex.id })
      setMsg({ type:'ok', text: r.data.message })
      onRefreshStatus()
    } catch (e: any) { setMsg({ type:'err', text: e?.message ?? 'Erreur sync' }) }
    finally { setSyncing(false) }
  }

  const handleDelete = async () => {
    if (!confirm(`Supprimer la clé API ${ex.name} ?`)) return
    setDeleting(true); setMsg(null)
    try {
      await cfDeleteKey({ exchange: ex.id })
      setMsg({ type:'ok', text: 'Clé supprimée' })
      onRefreshStatus()
    } catch (e: any) { setMsg({ type:'err', text: e?.message ?? 'Erreur suppression' }) }
    finally { setDeleting(false) }
  }

  if (ex.comingSoon) {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:10, border:'1px solid rgba(255,255,255,0.04)', background:'rgba(255,255,255,0.01)', opacity:0.5 }}>
        <ExchangeLogo domain={ex.domain} name={ex.name} color={ex.color} initials={ex.initials} size={32} />
        <div style={{ flex:1 }}>
          <div style={{ fontSize:12, fontWeight:600, color:'#9CA3AF' }}>{ex.name}</div>
        </div>
        <span style={{ fontSize:9, padding:'2px 7px', borderRadius:20, background:'rgba(255,255,255,0.06)', color:'#6B7280', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em' }}>
          Bientôt
        </span>
      </div>
    )
  }

  return (
    <div style={{
      border:`1px solid ${connected ? `${ex.color}33` : 'rgba(255,255,255,0.07)'}`,
      borderRadius:10, background: connected ? `${ex.color}08` : 'rgba(255,255,255,0.02)',
      padding:'11px 13px', transition:'all 0.2s',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <ExchangeLogo domain={ex.domain} name={ex.name} color={ex.color} initials={ex.initials} size={34} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:700, color:'#F0F2F5' }}>{ex.name}</div>
          {connected && status ? (
            <div style={{ fontSize:10, color:'#6B7280', fontFamily:'JetBrains Mono, monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {status.apiKeyMasked}{status.importedCount ? ` · ${status.importedCount} trades` : ''}{status.lastSync ? ` · ${fmtTime(status.lastSync)}` : ''}
            </div>
          ) : (
            <div style={{ fontSize:10, color:'#4B5563' }}>Non connecté</div>
          )}
        </div>
        <div style={{ display:'flex', gap:5, alignItems:'center', flexShrink:0 }}>
          {connected ? (
            <>
              <span style={{ padding:'2px 7px', borderRadius:20, fontSize:9, fontWeight:700, background:'rgba(34,199,89,0.12)', color:'#22C759', border:'1px solid rgba(34,199,89,0.2)' }}>✓</span>
              <button onClick={handleSync} disabled={syncing} style={{ padding:'4px 10px', borderRadius:7, border:'1px solid rgba(0,229,255,0.2)', background:'rgba(0,229,255,0.07)', color:'#00E5FF', fontSize:11, fontWeight:600, cursor:syncing?'wait':'pointer' }}>
                {syncing ? '⏳' : '↻ Sync'}
              </button>
              <button onClick={handleDelete} disabled={deleting} style={{ padding:'4px 8px', borderRadius:7, border:'1px solid rgba(255,59,48,0.18)', background:'rgba(255,59,48,0.05)', color:'#FF3B30', fontSize:11, cursor:deleting?'wait':'pointer' }}>✕</button>
            </>
          ) : (
            <button onClick={() => setExpanded(e => !e)} style={{ padding:'5px 11px', borderRadius:7, border:`1px solid ${ex.color}35`, background:`${ex.color}0D`, color:ex.color, fontSize:11, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>
              {expanded ? '↑' : '+ Connecter'}
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div style={{ padding:'7px 10px', borderRadius:7, marginTop:8, fontSize:11, background:msg.type==='ok'?'rgba(34,199,89,0.1)':'rgba(255,59,48,0.1)', border:`1px solid ${msg.type==='ok'?'rgba(34,199,89,0.2)':'rgba(255,59,48,0.2)'}`, color:msg.type==='ok'?'#22C759':'#FF6B6B' }}>
          {msg.type==='ok'?'✓ ':'⚠ '}{msg.text}
        </div>
      )}

      {expanded && !connected && (
        <div style={{ display:'flex', flexDirection:'column', gap:7, marginTop:10 }}>
          <div style={{ padding:'7px 10px', borderRadius:7, fontSize:10, background:'rgba(0,229,255,0.05)', border:'1px solid rgba(0,229,255,0.12)', color:'#6B7280', lineHeight:1.5 }}>
            🔒 Clés stockées côté serveur. Créez une clé <strong>Read-Only</strong>.{' '}
            <a href={ex.docs} target="_blank" rel="noopener noreferrer" style={{ color:'#00E5FF' }}>Gérer les clés {ex.name} ↗</a>
          </div>
          {[
            { label: ex.fields.keyLabel,         value: apiKey,     set: setApiKey,     type: 'text' as const,              toggle: false },
            { label: ex.fields.secretLabel,      value: secret,     set: setSecret,     type: (showSec?'text':'password') as const, toggle: true  },
            ...(needsPassphrase ? [{ label: ex.fields.passphraseLabel!, value: passphrase, set: setPassphrase, type: 'text' as const, toggle: false }] : []),
          ].map(f => (
            <div key={f.label}>
              <label style={{ fontSize:9, color:'#6B7280', display:'block', marginBottom:3, textTransform:'uppercase', letterSpacing:'0.05em' }}>{f.label}</label>
              <div style={{ position:'relative' }}>
                <input type={f.type} value={f.value} onChange={e => f.set(e.target.value)} onKeyDown={e => e.key==='Enter' && handleSave()}
                  style={{ width:'100%', padding:f.toggle?'8px 34px 8px 10px':'8px 10px', borderRadius:7, border:'1px solid rgba(255,255,255,0.07)', background:'rgba(255,255,255,0.04)', color:'#F0F2F5', fontSize:12, outline:'none', boxSizing:'border-box', fontFamily:'JetBrains Mono, monospace' }} />
                {f.toggle && (
                  <button onClick={() => setShowSec(s => !s)} style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', color:'#6B7280', cursor:'pointer', fontSize:13, padding:0 }}>
                    {showSec ? '🙈' : '👁'}
                  </button>
                )}
              </div>
            </div>
          ))}
          <button onClick={handleSave} disabled={saving || !apiKey.trim() || !secret.trim() || (needsPassphrase && !passphrase.trim())}
            style={{ padding:'9px', borderRadius:8, border:'none', background: saving?'rgba(255,255,255,0.05)':`${ex.color}CC`, color:'#0D1117', fontSize:12, fontWeight:700, cursor:saving?'wait':'pointer', transition:'all 0.2s' }}>
            {saving ? '⏳ Validation…' : `🔗 Connecter ${ex.name}`}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main Modal ────────────────────────────────────────────────────────────────
export default function ExchangeSyncModal({ onClose }: { onClose: () => void }) {
  const initStatuses = Object.fromEntries(EXCHANGES.map(e => [e.id, null])) as Record<Exchange, KeyStatus | null>
  const [statuses, setStatuses] = useState<Record<Exchange, KeyStatus | null>>(initStatuses)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refreshStatuses = async () => {
    try {
      const active = EXCHANGES.filter(e => !e.comingSoon)
      const results = await Promise.all(active.map(ex => cfGetStatus({ exchange: ex.id }).catch(() => ({ data: { connected: false } as KeyStatus }))))
      setStatuses(prev => {
        const next = { ...prev }
        active.forEach((ex, i) => { next[ex.id] = results[i].data })
        return next
      })
    } catch { /* ignore */ }
    finally { setLoadingStatus(false) }
  }

  const runAutoSync = async () => {
    const connected = ACTIVE_EXCHANGES.filter(id => statuses[id]?.connected)
    if (connected.length === 0) return
    await Promise.allSettled(connected.map(ex => cfSync({ exchange: ex })))
    await refreshStatuses()
  }

  useEffect(() => { refreshStatuses() }, [])

  useEffect(() => {
    if (loadingStatus) return
    intervalRef.current = setInterval(runAutoSync, 30_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [loadingStatus, statuses])

  const connectedCount = Object.values(statuses).filter(s => s?.connected).length

  return (
    <div style={{ position:'fixed', inset:0, zIndex:10001, background:'rgba(0,0,0,0.88)', backdropFilter:'blur(14px)', display:'flex', alignItems:'center', justifyContent:'center', padding:20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background:'#0D1117', border:'1px solid rgba(0,229,255,0.1)', borderRadius:20,
        padding:'22px 22px 18px', width:520, maxWidth:'100%',
        display:'flex', flexDirection:'column', gap:16,
        boxShadow:'0 0 80px rgba(0,229,255,0.05)',
        maxHeight:'90vh', overflowY:'auto',
      }}>
        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div>
            <div style={{ fontSize:16, fontWeight:800, color:'#F0F2F5', fontFamily:'Syne, sans-serif', marginBottom:3 }}>📥 Importer via API</div>
            <div style={{ fontSize:11, color:'#6B7280', lineHeight:1.5 }}>
              Connectez vos plateformes pour importer vos trades fermés automatiquement.
              {connectedCount > 0 && <span style={{ color:'#22C759' }}> · {connectedCount} connecté{connectedCount>1?'s':''} · ↻ 30s</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#6B7280', cursor:'pointer', fontSize:18, padding:0, flexShrink:0 }}>✕</button>
        </div>

        {loadingStatus ? (
          <div style={{ textAlign:'center', color:'#6B7280', fontSize:13, padding:'20px 0' }}>⏳ Chargement…</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
            {CATEGORIES.map(cat => {
              const exList = EXCHANGES.filter(e => e.category === cat.id)
              const activeCount = exList.filter(e => !e.comingSoon).length
              const comingSoonCount = exList.filter(e => e.comingSoon).length
              return (
                <div key={cat.id}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                    <div style={{ fontSize:10, fontWeight:800, color:'#6B7280', textTransform:'uppercase', letterSpacing:'0.08em' }}>{cat.label}</div>
                    <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.05)' }} />
                    <div style={{ fontSize:9, color:'#4B5563' }}>{activeCount} dispo · {comingSoonCount} bientôt</div>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                    {exList.map(ex => (
                      <ExchangeCard key={ex.id} ex={ex} status={statuses[ex.id]} onRefreshStatus={refreshStatuses} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div style={{ padding:'8px 12px', borderRadius:9, background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.04)', fontSize:10, color:'#4B5563', lineHeight:1.6 }}>
          ℹ️ Dédupliqués automatiquement · Sync incrémental · Positions fermées uniquement · Clés Read-Only recommandées
        </div>
      </div>
    </div>
  )
}
