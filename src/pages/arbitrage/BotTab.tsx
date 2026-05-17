// src/pages/arbitrage/BotTab.tsx — Polymarket Bot tab
import { useState, useEffect, useRef } from 'react'
import { useUser } from '@/hooks/useAuth'
import {
  getBotSettings, saveBotSettings, listenBotTrades, computeStats,
  PolyBotSettings, BotTrade,
} from '@/services/firestore/polyBot'
import { httpsCallable } from 'firebase/functions'
import { functions as fbFn } from '@/services/firebase/config'

// ── Design tokens (copper dark — same as ArbitragePage) ───────────────────
const C = {
  bg:      '#0C0A08',
  card:    '#141210',
  card2:   '#1A1714',
  copper:  '#C4896A',
  copperD: '#9B6A4E',
  copperL: '#E8A87C',
  text:    '#E8DDD5',
  muted:   '#7A6A60',
  dim:     '#3D3028',
  green:   '#5DBD7A',
  red:     '#C45A5A',
  amber:   '#D4A84B',
  border:  'rgba(196,137,106,0.12)',
  border2: 'rgba(255,255,255,0.06)',
}
const mono = { fontFamily: 'JetBrains Mono, "Courier New", monospace' }
const syne = { fontFamily: 'Syne, system-ui, sans-serif' }

// ── Sub-components ─────────────────────────────────────────────────────────

function StatCard({ value, label, color = C.copper }: { value: string; label: string; color?: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 24px', flex: '1 1 140px' }}>
      <div style={{ fontSize: 28, fontWeight: 800, color, ...syne, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.15em', textTransform: 'uppercase', ...mono, marginTop: 6 }}>{label}</div>
    </div>
  )
}

function SectionLabel({ text, badge }: { text: string; badge?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <span style={{ fontSize: 9, color: C.muted, letterSpacing: '0.15em', textTransform: 'uppercase', ...mono }}>{text}</span>
      {badge && (
        <span style={{ fontSize: 8, fontWeight: 700, color: C.copper, background: `${C.copper}18`, border: `1px solid ${C.copper}35`, borderRadius: 20, padding: '2px 8px', ...mono, letterSpacing: '0.1em' }}>
          {badge}
        </span>
      )}
      <div style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  )
}

function TradeRow({ t }: { t: BotTrade }) {
  const statusClr = t.status === 'won' ? C.green : t.status === 'lost' ? C.red : C.amber
  const statusIcon = t.status === 'won' ? '✅' : t.status === 'lost' ? '❌' : '⏳'
  const pnlStr = t.pnl != null
    ? (t.pnl >= 0 ? `+$${t.pnl.toFixed(2)}` : `-$${Math.abs(t.pnl).toFixed(2)}`)
    : `$${t.sizeUsd.toFixed(2)} open`
  const pnlClr = t.pnl == null ? C.amber : t.pnl >= 0 ? C.green : C.red
  const dt = new Date(t.openedAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <div style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.border2}`, background: C.card2, marginBottom: 6, display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.text, lineHeight: 1.4, marginBottom: 4 }}>
          {t.question.length > 70 ? t.question.slice(0, 70) + '…' : t.question}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9, color: C.muted, ...mono }}>
            {t.symbol.toUpperCase()} <strong style={{ color: t.side === 'YES' ? C.green : C.red }}>{t.side}</strong>
          </span>
          <span style={{ fontSize: 9, color: C.muted, ...mono }}>@ <strong style={{ color: C.text }}>{(t.price * 100).toFixed(1)}¢</strong></span>
          <span style={{ fontSize: 9, color: C.muted, ...mono }}>edge <strong style={{ color: C.copper }}>{(t.edge * 100).toFixed(1)}%</strong></span>
          <span style={{ fontSize: 9, color: C.muted, ...mono }}>{dt}</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: pnlClr, ...mono }}>{pnlStr}</span>
        <span style={{ fontSize: 14 }}>{statusIcon}</span>
      </div>
    </div>
  )
}

function InputField({ label, value, onChange, type = 'text', placeholder = '' }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', ...mono, marginBottom: 5 }}>{label}</div>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', boxSizing: 'border-box',
          background: C.card2, border: `1px solid ${C.dim}`, borderRadius: 6,
          color: C.text, fontSize: 11, padding: '7px 10px', ...mono,
          outline: 'none',
        }}
      />
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function BotTab() {
  const user = useUser()
  const uid  = user?.uid

  const [settings, setSettings]   = useState<PolyBotSettings>({ enabled: false, mode: 'paper', capital: 1000 })
  const [trades,   setTrades]     = useState<BotTrade[]>([])
  const [saving,   setSaving]     = useState(false)
  const [saveMsg,  setSaveMsg]    = useState('')
  const [toggling, setToggling]   = useState(false)
  const [showKeys, setShowKeys]   = useState(false)
  const unsubRef = useRef<(() => void) | null>(null)

  // Load settings + subscribe to trades
  useEffect(() => {
    if (!uid) return
    getBotSettings(uid).then(s => setSettings(s)).catch(() => {})
    unsubRef.current = listenBotTrades(uid, setTrades)
    return () => { unsubRef.current?.() }
  }, [uid])

  const stats = computeStats(trades, settings)
  const openTrades  = trades.filter(t => t.status === 'open')
  const closedTrades = trades.filter(t => t.status !== 'open')
  const winRate = stats.trades > 0 ? Math.round(stats.wins / stats.trades * 100) : 0
  const pnlColor = stats.totalPnl >= 0 ? C.green : C.red

  // Toggle bot on/off
  const toggleBot = async () => {
    if (!uid) return
    setToggling(true)
    const next = !settings.enabled
    await saveBotSettings(uid, { enabled: next }).catch(() => {})
    setSettings(s => ({ ...s, enabled: next }))
    setToggling(false)
  }

  // Switch paper/live mode
  const setMode = async (mode: 'paper' | 'live') => {
    if (!uid) return
    await saveBotSettings(uid, { mode }).catch(() => {})
    setSettings(s => ({ ...s, mode }))
  }

  // Save API keys
  const saveKeys = async () => {
    if (!uid) return
    setSaving(true)
    await saveBotSettings(uid, {
      apiKey: settings.apiKey,
      apiSecret: settings.apiSecret,
      apiPassphrase: settings.apiPassphrase,
      privateKey: settings.privateKey,
      depositWallet: settings.depositWallet,
    }).catch(() => {})
    setSaveMsg('Clés sauvegardées ✓')
    setTimeout(() => setSaveMsg(''), 3000)
    setSaving(false)
  }

  // Trigger manual scan cycle (paper only via CF)
  const runScan = async () => {
    if (!uid) return
    try {
      const fn = httpsCallable(fbFn, 'runPolyBotCycle')
      await fn({ uid })
    } catch { /* CF pas encore déployée */ }
  }

  const btnBase: React.CSSProperties = {
    fontSize: 9, padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
    letterSpacing: '0.1em', ...mono, border: 'none',
  }

  return (
    <div>
      {/* ── Header controls ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: C.text, letterSpacing: '0.12em', textTransform: 'uppercase', ...mono }}>
            Polymarket Bot
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 10, color: C.muted, ...mono }}>
            Latency arb · Binance → Polymarket · Kelly sizing
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Mode toggle */}
          <div style={{ display: 'flex', gap: 0, background: C.card2, borderRadius: 6, border: `1px solid ${C.dim}`, overflow: 'hidden' }}>
            {(['paper', 'live'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                ...btnBase, borderRadius: 0,
                background: settings.mode === m ? `${C.copper}22` : 'transparent',
                color: settings.mode === m ? C.copperL : C.muted,
                border: 'none',
              }}>
                {m === 'paper' ? '📄 PAPER' : '🔴 LIVE'}
              </button>
            ))}
          </div>
          {/* ON/OFF */}
          <button
            onClick={toggleBot}
            disabled={toggling}
            style={{
              ...btnBase,
              background: settings.enabled ? `${C.green}20` : `${C.red}15`,
              color: settings.enabled ? C.green : C.red,
              border: `1px solid ${settings.enabled ? C.green : C.red}40`,
            }}
          >
            {toggling ? '…' : settings.enabled ? '⏹ ARRÊTER' : '▶ DÉMARRER'}
          </button>
          {/* Manual scan */}
          <button onClick={runScan} style={{ ...btnBase, background: C.card, color: C.muted, border: `1px solid ${C.dim}` }}>
            ↻ SCAN
          </button>
        </div>
      </div>

      {/* ── Status banner ── */}
      {settings.enabled && (
        <div style={{ background: `${C.green}12`, border: `1px solid ${C.green}30`, borderRadius: 8, padding: '8px 14px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.green, display: 'inline-block', animation: 'blink 1.4s ease-in-out infinite' }} />
          <span style={{ fontSize: 10, color: C.green, ...mono, letterSpacing: '0.08em' }}>
            BOT ACTIF — mode {settings.mode.toUpperCase()} — scan toutes les 2 min (Cloud Function)
          </span>
        </div>
      )}

      {/* ── KPI stats ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <StatCard value={`$${stats.capital.toFixed(0)}`} label="Capital" />
        <StatCard
          value={stats.totalPnl >= 0 ? `+$${stats.totalPnl.toFixed(2)}` : `-$${Math.abs(stats.totalPnl).toFixed(2)}`}
          label="P&L total"
          color={pnlColor}
        />
        <StatCard value={`${stats.trades}`} label="Trades fermés" />
        <StatCard value={`${winRate}%`} label="Win rate" color={winRate >= 50 ? C.green : C.red} />
        <StatCard value={`${openTrades.length}`} label="Positions ouvertes" color={C.amber} />
      </div>

      {/* ── 2-col layout ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>

        {/* Left — Trades actifs */}
        <div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 20px', marginBottom: 16 }}>
            <SectionLabel text={`Positions ouvertes (${openTrades.length})`} badge={openTrades.length > 0 ? 'LIVE' : undefined} />
            {openTrades.length === 0 ? (
              <div style={{ color: C.muted, fontSize: 11, ...mono, textAlign: 'center', padding: '16px 0' }}>
                Aucune position ouverte
              </div>
            ) : openTrades.map(t => <TradeRow key={t.id} t={t} />)}
          </div>

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 20px' }}>
            <SectionLabel text={`Historique (${closedTrades.length})`} />
            {closedTrades.length === 0 ? (
              <div style={{ color: C.muted, fontSize: 11, ...mono, textAlign: 'center', padding: '16px 0' }}>
                Aucun trade fermé
              </div>
            ) : closedTrades.slice(0, 15).map(t => <TradeRow key={t.id} t={t} />)}
          </div>
        </div>

        {/* Right — Config */}
        <div>
          {/* Capital config */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 20px', marginBottom: 16 }}>
            <SectionLabel text="Capital (paper trading)" />
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <InputField
                  label="Capital initial ($)"
                  value={String(settings.capital)}
                  onChange={v => setSettings(s => ({ ...s, capital: parseFloat(v) || 1000 }))}
                  placeholder="1000"
                />
              </div>
              <button
                onClick={() => uid && saveBotSettings(uid, { capital: settings.capital })}
                style={{ ...btnBase, background: `${C.copper}18`, color: C.copperL, border: `1px solid ${C.copper}35`, marginBottom: 12, height: 31 }}
              >
                SAVE
              </button>
            </div>
            <div style={{ fontSize: 9, color: C.muted, ...mono, lineHeight: 1.6 }}>
              Paper trading : aucun argent réel. Résultats simulés pour valider la stratégie.
            </div>
          </div>

          {/* Live config */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 9, color: C.muted, letterSpacing: '0.15em', textTransform: 'uppercase', ...mono }}>
                  Clés Polymarket (mode live)
                </span>
              </div>
              <button
                onClick={() => setShowKeys(v => !v)}
                style={{ ...btnBase, background: 'transparent', color: C.muted, border: `1px solid ${C.dim}` }}
              >
                {showKeys ? '🙈 MASQUER' : '🔑 CONFIGURER'}
              </button>
            </div>
            <div style={{ flex: 1, height: 1, background: C.border, marginBottom: 14 }} />

            {!showKeys ? (
              <div style={{ fontSize: 10, color: C.muted, ...mono, lineHeight: 1.7 }}>
                Configure tes clés API Polymarket pour activer le mode live.<br />
                Les clés sont stockées dans Firestore et uniquement utilisées par le bot.
              </div>
            ) : (
              <>
                <div style={{ background: `${C.amber}10`, border: `1px solid ${C.amber}30`, borderRadius: 6, padding: '8px 12px', marginBottom: 16 }}>
                  <span style={{ fontSize: 9, color: C.amber, ...mono, lineHeight: 1.6 }}>
                    ⚠️ Tes clés privées sont stockées dans Firestore. N'utilise qu'un wallet dédié avec des fonds limités. Jamais ton wallet principal.
                  </span>
                </div>
                <InputField label="API Key" value={settings.apiKey ?? ''} onChange={v => setSettings(s => ({ ...s, apiKey: v }))} placeholder="poly_api_key_..." />
                <InputField label="API Secret" value={settings.apiSecret ?? ''} onChange={v => setSettings(s => ({ ...s, apiSecret: v }))} type="password" placeholder="••••••••" />
                <InputField label="API Passphrase" value={settings.apiPassphrase ?? ''} onChange={v => setSettings(s => ({ ...s, apiPassphrase: v }))} type="password" placeholder="••••••••" />
                <InputField label="Private Key (0x...)" value={settings.privateKey ?? ''} onChange={v => setSettings(s => ({ ...s, privateKey: v }))} type="password" placeholder="0x..." />
                <InputField label="Deposit Wallet Address" value={settings.depositWallet ?? ''} onChange={v => setSettings(s => ({ ...s, depositWallet: v }))} placeholder="0x..." />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                  <button
                    onClick={saveKeys}
                    disabled={saving}
                    style={{ ...btnBase, background: `${C.copper}18`, color: C.copperL, border: `1px solid ${C.copper}35` }}
                  >
                    {saving ? '…' : '💾 SAUVEGARDER'}
                  </button>
                  {saveMsg && <span style={{ fontSize: 9, color: C.green, ...mono }}>{saveMsg}</span>}
                </div>
              </>
            )}
          </div>

          {/* Strategy info */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 20px', marginTop: 16 }}>
            <SectionLabel text="Stratégie" badge="LATENCY ARB" />
            <div style={{ background: '#080604', borderRadius: 8, padding: '12px 14px', fontSize: 9, ...mono, lineHeight: 1.8, color: C.muted }}>
              <div style={{ color: C.copper }}>1. Binance REST → prix BTC/ETH/SOL/XRP</div>
              <div>2. Fetch marchés 5m actifs (restricted=true)</div>
              <div>3. Calcul edge = |implied_prob - poly_price|</div>
              <div>4. Kelly fractionnel (25%) avec frais 2%</div>
              <div style={{ color: C.copper }}>5. Trade si edge {'>'} 12%</div>
              <div style={{ marginTop: 6, color: C.dim }}>Scan toutes les 2 min via Cloud Function</div>
              <div style={{ color: C.dim }}>MIN_LIQUIDITY = $100 · MIN_EDGE = 12%</div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes blink { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
      `}</style>
    </div>
  )
}
