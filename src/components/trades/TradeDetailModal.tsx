// ─── TradeDetailModal ─────────────────────────────────────────────────────────
// Vue détaillée d'un trade — miroir de TradeDetailView.swift
// Sections : Header P&L, Métriques, Détails, Avancé, Graphique prix, Actions

import { useState } from 'react'
import { updateTrade, deleteTrade, createTrade, tradePnL, type Trade, type TradingSystem, type Exchange } from '@/services/firestore'
import toast from 'react-hot-toast'

interface TradeDetailModalProps {
  trade: Trade
  systems: TradingSystem[]
  exchanges: Exchange[]
  onClose: () => void
  onDeleted?: () => void
}

function fmtPrice(p?: number) {
  if (p == null) return '—'
  return p >= 1000
    ? `$${p.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`
    : `$${p.toFixed(p < 1 ? 6 : 4)}`
}
function fmtDate(d: Date) {
  return d.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' })
}
function fmtPct(n: number) { return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` }

export function TradeDetailModal({ trade, systems, exchanges, onClose, onDeleted }: TradeDetailModalProps) {
  const pnl       = tradePnL(trade)
  const isProfit  = pnl >= 0
  const system    = systems.find(s => s.id === trade.systemId)
  const exchange  = exchanges.find(e => e.id === trade.exchangeId)

  const roi = (trade.entryPrice && trade.exitPrice)
    ? ((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100 * (trade.type === 'Long' ? 1 : -1)
    : null

  const priceChange = (trade.entryPrice && trade.exitPrice)
    ? trade.exitPrice - trade.entryPrice
    : null

  // Estimated fees from exchange
  const estimatedFees = (() => {
    if (!exchange || !trade.entryPrice || !trade.quantity) return null
    const feeRate = trade.orderRole === 'Maker' ? exchange.makerFeeRate : exchange.takerFeeRate
    const notional = trade.entryPrice * trade.quantity * trade.leverage
    return { amount: notional * feeRate, rate: feeRate * 100 }
  })()

  const [showEdit,   setShowEdit]   = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [deleting,   setDeleting]   = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteTrade(trade.id)
      toast.success('Trade supprimé')
      onDeleted?.()
      onClose()
    } catch {
      toast.error('Erreur lors de la suppression')
    } finally {
      setDeleting(false)
    }
  }

  async function handleDuplicate() {
    try {
      await createTrade({
        id: crypto.randomUUID(),
        date: new Date(), symbol: trade.symbol, type: trade.type,
        entryPrice: trade.entryPrice, quantity: trade.quantity,
        leverage: trade.leverage, exchangeId: trade.exchangeId,
        orderRole: trade.orderRole, systemId: trade.systemId,
        session: trade.session, tags: trade.tags ?? [],
        status: 'open' as const,
      })
      toast.success('Trade dupliqué')
    } catch {
      toast.error('Erreur lors de la duplication')
    }
  }

  const accentColor = isProfit ? 'var(--tm-profit)' : 'var(--tm-loss)'

  return (
    <>
      {/* Backdrop */}
      <div
        style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', backdropFilter:'blur(6px)', zIndex:200 }}
        onClick={onClose}
      />

      {/* Modal */}
      <div style={{
        position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
        zIndex:201, width:'100%', maxWidth:560, maxHeight:'90vh',
        background:'var(--tm-bg-secondary)', border:'1px solid var(--tm-border)',
        borderRadius:20, overflow:'hidden', display:'flex', flexDirection:'column',
        boxShadow:'0 32px 64px rgba(0,0,0,0.7)',
      }}>
        {/* Toolbar */}
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'14px 18px', borderBottom:'1px solid var(--tm-border)', flexShrink:0,
        }}>
          <div style={{ fontSize:14, fontWeight:700, color:'var(--tm-text-primary)' }}>Détail du trade</div>
          <div style={{ display:'flex', gap:6 }}>
            <button onClick={() => setShowEdit(true)} style={toolbarBtn}>✏️ Modifier</button>
            <button onClick={onClose} style={{ ...toolbarBtn, color:'var(--tm-text-muted)' }}>✕</button>
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ overflowY:'auto', flex:1, padding:18, display:'flex', flexDirection:'column', gap:14 }}>

          {/* ── HEADER: Symbol + P&L ── */}
          <div style={{
            background:'var(--tm-bg-card)', borderRadius:14,
            border:`1px solid ${accentColor}40`, padding:18,
            position:'relative', overflow:'hidden',
          }}>
            {/* Glow top border */}
            <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:accentColor, opacity:0.6 }} />

            <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12 }}>
              <div>
                <div style={{ fontSize:26, fontWeight:800, color:'var(--tm-text-primary)', fontFamily:'Syne, sans-serif', letterSpacing:'-0.02em', marginBottom:8 }}>
                  {trade.symbol}
                </div>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  {/* Type badge */}
                  <span style={{
                    padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:700,
                    background: trade.type === 'Long' ? 'rgba(34,199,89,0.15)' : 'rgba(255,59,48,0.15)',
                    color: trade.type === 'Long' ? 'var(--tm-profit)' : 'var(--tm-loss)',
                    border: `1px solid ${trade.type === 'Long' ? 'var(--tm-profit)' : 'var(--tm-loss)'}40`,
                  }}>
                    {trade.type === 'Long' ? '↑' : '↓'} {trade.type.toUpperCase()}
                  </span>
                  {/* System badge */}
                  {system && (
                    <span style={{
                      padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:500,
                      background:'var(--tm-bg-tertiary)', color:'var(--tm-text-secondary)',
                      border:'1px solid var(--tm-border)', display:'flex', alignItems:'center', gap:5,
                    }}>
                      <span style={{ width:7, height:7, borderRadius:'50%', background:system.color, display:'inline-block' }} />
                      {system.name}
                    </span>
                  )}
                  {/* Status badge */}
                  <span style={{
                    padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:600,
                    background: trade.status === 'open' ? 'rgba(255,149,0,0.15)' : 'rgba(255,255,255,0.06)',
                    color: trade.status === 'open' ? 'var(--tm-warning)' : 'var(--tm-text-muted)',
                    border: `1px solid ${trade.status === 'open' ? 'rgba(255,149,0,0.3)' : 'var(--tm-border)'}`,
                  }}>
                    {trade.status === 'open' ? '● OUVERT' : '✓ FERMÉ'}
                  </span>
                </div>
              </div>

              {/* P&L + ROI */}
              <div style={{ textAlign:'right', flexShrink:0 }}>
                <div style={{ fontSize:28, fontWeight:800, fontFamily:'JetBrains Mono, monospace', color:accentColor, letterSpacing:'-0.02em', lineHeight:1 }}>
                  {pnl >= 0 ? '+' : ''}${Math.abs(pnl).toFixed(2)}
                </div>
                {roi !== null && (
                  <div style={{ fontSize:13, color:'var(--tm-text-secondary)', marginTop:4, fontFamily:'monospace' }}>
                    {fmtPct(roi)} ROI
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── MAIN METRICS grid ── */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            {[
              { label:'P&L Net',        value: `${pnl >= 0?'+':''}$${Math.abs(pnl).toFixed(2)}`,  color:accentColor,            icon:'💰' },
              { label:'ROI',            value: roi !== null ? fmtPct(roi) : '—',                    color: roi && roi>=0 ? 'var(--tm-profit)' : 'var(--tm-loss)', icon:'📈' },
              { label:'Prix d\'entrée', value: fmtPrice(trade.entryPrice),                          color:'var(--tm-accent)',      icon:'↓' },
              { label:'Prix de sortie', value: fmtPrice(trade.exitPrice),                           color: isProfit ? 'var(--tm-profit)' : 'var(--tm-loss)', icon:'↑' },
            ].map(({ label, value, color, icon }) => (
              <div key={label} style={{ background:'var(--tm-bg-card)', borderRadius:12, padding:'12px 14px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:6 }}>
                  <span style={{ fontSize:12 }}>{icon}</span>
                  <span style={{ fontSize:10, color:'var(--tm-text-secondary)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em' }}>{label}</span>
                </div>
                <div style={{ fontSize:17, fontWeight:800, fontFamily:'JetBrains Mono, monospace', color }}>{value}</div>
              </div>
            ))}
          </div>

          {/* ── TRADE DETAILS ── */}
          <Section title="Informations">
            <Row label="Date"         value={fmtDate(trade.date)} />
            {trade.quantity  != null && <Row label="Quantité"    value={trade.quantity.toFixed(6)} />}
            {trade.leverage   > 1     && <Row label="Levier"     value={`${trade.leverage}×`} highlight />}
            {exchange &&               <Row label="Exchange"     value={exchange.name} />}
            <Row label="Rôle ordre"   value={trade.orderRole} />
            <Row label="Session"      value={trade.session} />
            {trade.notes &&           <Row label="Notes"         value={trade.notes} />}
          </Section>

          {/* ── ADVANCED METRICS ── */}
          <Section title="Métriques avancées">
            {priceChange !== null && trade.entryPrice && (
              <Row
                label="Variation de prix"
                value={`${priceChange >= 0 ? '+' : ''}${fmtPrice(priceChange)} (${fmtPct((priceChange / trade.entryPrice) * 100)})`}
                color={priceChange >= 0 ? 'var(--tm-profit)' : 'var(--tm-loss)'}
              />
            )}
            {trade.leverage > 1 && roi !== null && (
              <Row
                label="Rendement avec levier"
                value={fmtPct(roi * trade.leverage)}
                color={(roi * trade.leverage) >= 0 ? 'var(--tm-profit)' : 'var(--tm-loss)'}
              />
            )}
            {estimatedFees && (
              <Row label="Frais estimés" value={`$${estimatedFees.amount.toFixed(4)} (${estimatedFees.rate.toFixed(3)}%)`} />
            )}
            {exchange && (
              <>
                <Row label="Maker fee" value={`${(exchange.makerFeeRate * 100).toFixed(3)}%`} />
                <Row label="Taker fee" value={`${(exchange.takerFeeRate * 100).toFixed(3)}%`} />
              </>
            )}
          </Section>

          {/* ── PRICE VISUALIZATION ── */}
          {trade.entryPrice && trade.exitPrice && (
            <Section title="Mouvement de prix">
              <PriceVisualization
                entry={trade.entryPrice}
                exit={trade.exitPrice}
                type={trade.type}
              />
            </Section>
          )}

          {/* ── TAGS ── */}
          {trade.tags?.length > 0 && (
            <Section title="Tags">
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {trade.tags.map(tag => (
                  <span key={tag} style={{
                    padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:500,
                    background:'var(--tm-bg-tertiary)', color:'var(--tm-text-secondary)',
                    border:'1px solid var(--tm-border)',
                  }}>
                    #{tag}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* ── ACTIONS ── */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, paddingTop:4 }}>
            <ActionButton icon="📋" label="Dupliquer" onClick={handleDuplicate} variant="secondary" />
            <ActionButton icon="🗑" label="Supprimer" onClick={() => setShowDelete(true)} variant="danger" />
          </div>
        </div>
      </div>

      {/* Delete confirm dialog */}
      {showDelete && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{
            background:'var(--tm-bg-secondary)', border:'1px solid var(--tm-loss)40',
            borderRadius:16, padding:24, maxWidth:360, width:'100%', textAlign:'center',
          }}>
            <div style={{ fontSize:32, marginBottom:12 }}>⚠️</div>
            <div style={{ fontSize:15, fontWeight:700, color:'var(--tm-text-primary)', marginBottom:8 }}>Supprimer ce trade ?</div>
            <div style={{ fontSize:12, color:'var(--tm-text-secondary)', marginBottom:20 }}>
              {trade.symbol} — {pnl >= 0 ? '+' : ''}${Math.abs(pnl).toFixed(2)} · Cette action est irréversible.
            </div>
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => setShowDelete(false)} style={{ flex:1, padding:'10px', borderRadius:9, border:'1px solid var(--tm-border)', background:'transparent', color:'var(--tm-text-secondary)', cursor:'pointer', fontSize:13 }}>
                Annuler
              </button>
              <button onClick={handleDelete} disabled={deleting} style={{ flex:1, padding:'10px', borderRadius:9, border:'none', background:'var(--tm-loss)', color:'#fff', cursor:'pointer', fontSize:13, fontWeight:700, opacity:deleting?0.7:1 }}>
                {deleting ? '…' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {showEdit && (
        <EditTradeModal
          trade={trade}
          systems={systems}
          exchanges={exchanges}
          onClose={() => setShowEdit(false)}
        />
      )}
    </>
  )
}

// ─── Price Visualization ───────────────────────────────────────────────────────
function PriceVisualization({ entry, exit, type }: { entry: number; exit: number; type: string }) {
  const isProfit = type === 'Long' ? exit > entry : exit < entry
  const color = isProfit ? 'var(--tm-profit)' : 'var(--tm-loss)'
  const pct = ((exit - entry) / entry) * 100

  return (
    <div style={{ display:'flex', alignItems:'center', gap:12 }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:4 }}>Entrée</div>
        <div style={{ fontSize:14, fontWeight:700, fontFamily:'monospace', color:'var(--tm-accent)' }}>
          {entry >= 1000 ? `$${entry.toLocaleString('fr-FR', { maximumFractionDigits:1 })}` : `$${entry.toFixed(4)}`}
        </div>
      </div>

      <div style={{ flex:1, position:'relative', height:32, display:'flex', alignItems:'center' }}>
        {/* Track */}
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center' }}>
          <div style={{ height:2, flex:1, background:color, opacity:0.4, borderRadius:1 }} />
        </div>
        {/* Arrow */}
        <div style={{ position:'absolute', left:'50%', transform:'translateX(-50%)', display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
          <div style={{ fontSize:16, color }}>{type === 'Long' ? '→' : '←'}</div>
          <div style={{ fontSize:9, fontFamily:'monospace', color, fontWeight:700, whiteSpace:'nowrap' }}>
            {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
          </div>
        </div>
      </div>

      <div style={{ textAlign:'center' }}>
        <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:4 }}>Sortie</div>
        <div style={{ fontSize:14, fontWeight:700, fontFamily:'monospace', color }}>
          {exit >= 1000 ? `$${exit.toLocaleString('fr-FR', { maximumFractionDigits:1 })}` : `$${exit.toFixed(4)}`}
        </div>
      </div>
    </div>
  )
}

// ─── Edit Trade Modal ─────────────────────────────────────────────────────────
function EditTradeModal({ trade, systems, exchanges, onClose }: {
  trade: Trade; systems: TradingSystem[]; exchanges: Exchange[]; onClose: () => void
}) {
  const [exitPrice, setExitPrice] = useState(trade.exitPrice?.toString() ?? '')
  const [notes,     setNotes]     = useState(trade.notes ?? '')
  const [status,    setStatus]    = useState<'open'|'closed'>(trade.status)
  const [saving,    setSaving]    = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      const exitP = exitPrice ? parseFloat(exitPrice) : undefined
      const pnlNet = exitP && trade.entryPrice && trade.quantity
        ? (trade.type === 'Long'
            ? (exitP - trade.entryPrice) * trade.quantity * trade.leverage
            : (trade.entryPrice - exitP) * trade.quantity * trade.leverage)
        : trade.flashPnLNet

      await updateTrade({
        ...trade,
        exitPrice: exitP,
        status,
        notes,
        flashPnLNet: pnlNet,
      })
      toast.success('Trade mis à jour')
      onClose()
    } catch {
      toast.error('Erreur lors de la sauvegarde')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background:'var(--tm-bg-secondary)', border:'1px solid var(--tm-border)',
        borderRadius:18, width:'100%', maxWidth:420, overflow:'hidden',
        boxShadow:'0 24px 48px rgba(0,0,0,0.6)',
      }}>
        <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--tm-border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontSize:14, fontWeight:700, color:'var(--tm-text-primary)' }}>Modifier le trade</div>
          <button onClick={onClose} style={{ background:'transparent', border:'none', cursor:'pointer', fontSize:18, color:'var(--tm-text-muted)' }}>×</button>
        </div>

        <div style={{ padding:18, display:'flex', flexDirection:'column', gap:14 }}>
          {/* Symbol info */}
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background:'var(--tm-bg-tertiary)', borderRadius:10 }}>
            <span style={{ fontSize:16, fontWeight:700, color:'var(--tm-text-primary)', fontFamily:'monospace' }}>{trade.symbol}</span>
            <span style={{ fontSize:11, padding:'2px 8px', borderRadius:20, background: trade.type==='Long'?'rgba(34,199,89,0.15)':'rgba(255,59,48,0.15)', color: trade.type==='Long'?'var(--tm-profit)':'var(--tm-loss)' }}>
              {trade.type}
            </span>
          </div>

          {/* Status */}
          <div>
            <label style={labelStyle}>Statut</label>
            <div style={{ display:'flex', gap:8 }}>
              {(['open','closed'] as const).map(s => (
                <button key={s} onClick={() => setStatus(s)} style={{
                  flex:1, padding:'9px', borderRadius:9, cursor:'pointer', fontSize:12, fontWeight:600,
                  border: status===s ? 'none' : '1px solid var(--tm-border)',
                  background: status===s ? (s==='open'?'rgba(255,149,0,0.2)':'rgba(34,199,89,0.2)') : 'transparent',
                  color: status===s ? (s==='open'?'var(--tm-warning)':'var(--tm-profit)') : 'var(--tm-text-muted)',
                }}>
                  {s === 'open' ? '● Ouvert' : '✓ Fermé'}
                </button>
              ))}
            </div>
          </div>

          {/* Exit price */}
          <div>
            <label style={labelStyle}>Prix de sortie</label>
            <input
              type="number" value={exitPrice} onChange={e => setExitPrice(e.target.value)}
              placeholder={`Entrée: ${trade.entryPrice ?? '—'}`}
              style={inputStyle}
            />
          </div>

          {/* Notes */}
          <div>
            <label style={labelStyle}>Notes</label>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Analyse, raison du trade…"
              rows={3}
              style={{ ...inputStyle, resize:'vertical', fontFamily:'inherit' }}
            />
          </div>

          {/* Buttons */}
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={onClose} style={{ flex:1, padding:'10px', borderRadius:9, border:'1px solid var(--tm-border)', background:'transparent', color:'var(--tm-text-secondary)', cursor:'pointer', fontSize:13 }}>
              Annuler
            </button>
            <button onClick={handleSave} disabled={saving} style={{ flex:2, padding:'10px', borderRadius:9, border:'none', background:'var(--tm-accent)', color:'#0D1117', cursor:'pointer', fontSize:13, fontWeight:700, opacity:saving?0.7:1 }}>
              {saving ? '…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background:'var(--tm-bg-card)', borderRadius:14, padding:'14px 16px' }}>
      <div style={{ fontSize:12, fontWeight:700, color:'var(--tm-text-secondary)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:12 }}>
        {title}
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {children}
      </div>
    </div>
  )
}

function Row({ label, value, color, highlight }: { label: string; value: string; color?: string; highlight?: boolean }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:8 }}>
      <span style={{ fontSize:12, color:'var(--tm-text-secondary)', flexShrink:0 }}>{label}</span>
      <span style={{ fontSize:12, fontWeight:highlight ? 700 : 500, fontFamily:'JetBrains Mono, monospace', color: color ?? 'var(--tm-text-primary)', textAlign:'right' }}>
        {value}
      </span>
    </div>
  )
}

function ActionButton({ icon, label, onClick, variant }: { icon: string; label: string; onClick: () => void; variant: 'secondary'|'danger' }) {
  return (
    <button onClick={onClick} style={{
      display:'flex', alignItems:'center', justifyContent:'center', gap:8,
      padding:'11px', borderRadius:10, cursor:'pointer', fontSize:13, fontWeight:600,
      border: variant==='danger' ? '1px solid rgba(255,59,48,0.3)' : '1px solid var(--tm-border)',
      background: variant==='danger' ? 'rgba(255,59,48,0.08)' : 'var(--tm-bg-card)',
      color: variant==='danger' ? 'var(--tm-loss)' : 'var(--tm-text-secondary)',
      transition:'all 0.15s',
    }}>
      {icon} {label}
    </button>
  )
}

const toolbarBtn: React.CSSProperties = {
  padding:'5px 12px', borderRadius:7, border:'1px solid var(--tm-border)',
  background:'transparent', color:'var(--tm-text-secondary)', cursor:'pointer', fontSize:12, fontWeight:600,
}

const labelStyle: React.CSSProperties = {
  display:'block', fontSize:11, fontWeight:600, color:'var(--tm-text-secondary)',
  textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6,
}

const inputStyle: React.CSSProperties = {
  width:'100%', padding:'9px 12px', borderRadius:8,
  border:'1px solid var(--tm-border)',
  background:'var(--tm-bg-tertiary)',
  color:'var(--tm-text-primary)', fontSize:13, outline:'none', boxSizing:'border-box',
}
