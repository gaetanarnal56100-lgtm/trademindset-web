// ─── ExchangesPage ────────────────────────────────────────────────────────────
// Miroir exact de ExchangesView.swift + AddExchangeView + EditExchangeView
// Firestore: users/{uid}/exchanges/{id}

import { useState, useEffect } from 'react'
import {
  subscribeExchanges, createExchange, updateExchange,
  deleteExchange, setDefaultExchange,
  type Exchange,
} from '@/services/firestore'
import toast from 'react-hot-toast'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtFee(rate: number) { return `${(rate * 100).toFixed(3)}%` }

function initial(name: string) { return name.charAt(0).toUpperCase() }

const PRESET_EXCHANGES = [
  { name: 'Binance',  maker: 0.001,  taker: 0.001  },
  { name: 'Bybit',    maker: 0.0001, taker: 0.0006 },
  { name: 'OKX',      maker: 0.0008, taker: 0.001  },
  { name: 'Bitget',   maker: 0.0002, taker: 0.0006 },
  { name: 'MEXC',     maker: 0.0,    taker: 0.0005 },
  { name: 'Gate.io',  maker: 0.002,  taker: 0.002  },
  { name: 'Kraken',   maker: 0.002,  taker: 0.005  },
]

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function ExchangesPage() {
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [showAdd, setShowAdd]     = useState(false)
  const [editTarget, setEditTarget] = useState<Exchange | null>(null)

  useEffect(() => {
    const unsub = subscribeExchanges(list => { setExchanges(list); setLoading(false) })
    return unsub
  }, [])

  const filtered = exchanges
    .filter(e => !search || e.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  async function handleDelete(ex: Exchange) {
    try {
      await deleteExchange(ex.id)
      toast.success(`${ex.name} supprimé`)
    } catch {
      toast.error('Erreur lors de la suppression')
    }
  }

  async function handleSetDefault(ex: Exchange) {
    try {
      await setDefaultExchange(ex.id, exchanges)
      toast.success(`${ex.name} défini par défaut`)
    } catch {
      toast.error('Erreur')
    }
  }

  const s: React.CSSProperties = {
    padding: '28px 28px 60px',
    maxWidth: 1200,
    margin: '0 auto',
  }

  return (
    <div style={s}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:24, flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:'var(--tm-text-primary)', margin:0, fontFamily:'Syne, sans-serif', letterSpacing:'-0.02em' }}>
            Exchanges
          </h1>
          <p style={{ fontSize:13, color:'var(--tm-text-secondary)', margin:'4px 0 0' }}>
            {loading ? '…' : `${exchanges.length} exchange${exchanges.length !== 1 ? 's' : ''} configuré${exchanges.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          style={{
            display:'flex', alignItems:'center', gap:8,
            padding:'9px 18px', borderRadius:10, border:'none', cursor:'pointer',
            background:'var(--tm-accent-dim)',
            color:'var(--tm-accent)',
            fontSize:13, fontWeight:600,
            transition:'all 0.15s',
          }}
        >
          + Ajouter un exchange
        </button>
      </div>

      {/* Search */}
      <div style={{
        display:'flex', alignItems:'center', gap:8,
        padding:'8px 14px', background:'var(--tm-bg-secondary)',
        border:'1px solid var(--tm-border)', borderRadius:10, marginBottom:20,
      }}>
        <span style={{ fontSize:14, color:'var(--tm-text-muted)' }}>🔍</span>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher un exchange…"
          style={{
            flex:1, background:'transparent', border:'none', outline:'none',
            color:'var(--tm-text-primary)', fontSize:13,
          }}
        />
        {search && (
          <button onClick={() => setSearch('')} style={{ background:'transparent', border:'none', cursor:'pointer', color:'var(--tm-text-muted)', fontSize:16 }}>×</button>
        )}
      </div>

      {/* Empty state */}
      {loading ? (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))', gap:16 }}>
          {[1,2,3].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState onAdd={() => setShowAdd(true)} search={search} />
      ) : (
        <>
          {/* Default exchange highlight */}
          {exchanges.some(e => e.isDefault) && (
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:11, fontWeight:600, color:'var(--tm-text-muted)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>
                Par défaut
              </div>
              {filtered.filter(e => e.isDefault).map(ex => (
                <ExchangeCard key={ex.id} exchange={ex}
                  onDelete={() => handleDelete(ex)}
                  onEdit={() => setEditTarget(ex)}
                  onSetDefault={() => handleSetDefault(ex)} />
              ))}
            </div>
          )}

          {filtered.filter(e => !e.isDefault).length > 0 && (
            <div>
              {exchanges.some(e => e.isDefault) && (
                <div style={{ fontSize:11, fontWeight:600, color:'var(--tm-text-muted)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>
                  Autres exchanges
                </div>
              )}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))', gap:14 }}>
                {filtered.filter(e => !e.isDefault).map(ex => (
                  <ExchangeCard key={ex.id} exchange={ex}
                    onDelete={() => handleDelete(ex)}
                    onEdit={() => setEditTarget(ex)}
                    onSetDefault={() => handleSetDefault(ex)} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Preset quick-add */}
      {!loading && (
        <PresetSection exchanges={exchanges} />
      )}

      {/* Modals */}
      {showAdd    && <ExchangeModal onClose={() => setShowAdd(false)} />}
      {editTarget && <ExchangeModal exchange={editTarget} onClose={() => setEditTarget(null)} />}
    </div>
  )
}

// ─── Exchange Card ─────────────────────────────────────────────────────────────
function ExchangeCard({ exchange, onDelete, onEdit, onSetDefault }: {
  exchange: Exchange
  onDelete: () => void
  onEdit: () => void
  onSetDefault: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const card: React.CSSProperties = {
    background: 'var(--tm-bg-card)',
    border: `1px solid ${exchange.isDefault ? 'var(--tm-profit)' : 'var(--tm-border)'}`,
    borderRadius: 14,
    padding: 18,
    position: 'relative',
    overflow: 'hidden',
    transition: 'all 0.2s',
  }

  return (
    <div style={card}>
      {/* Top line accent for default */}
      {exchange.isDefault && (
        <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:'var(--tm-profit)', opacity:0.6 }} />
      )}

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16 }}>
        {/* Avatar */}
        <div style={{
          width:42, height:42, borderRadius:'50%', flexShrink:0,
          background:'rgba(var(--tm-accent-rgb,0,229,255),0.1)',
          border:'1px solid var(--tm-accent)',
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:16, fontWeight:800, color:'var(--tm-accent)', fontFamily:'Syne',
        }}>
          {initial(exchange.name)}
        </div>

        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:700, color:'var(--tm-text-primary)', marginBottom:2 }}>
            {exchange.name}
          </div>
          {exchange.isDefault && (
            <div style={{ fontSize:10, fontWeight:600, color:'var(--tm-profit)', display:'flex', alignItems:'center', gap:4 }}>
              <span style={{ width:6, height:6, borderRadius:'50%', background:'var(--tm-profit)', display:'inline-block' }} />
              Exchange par défaut
            </div>
          )}
        </div>

        {/* Menu */}
        <div style={{ position:'relative' }}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            style={{ background:'rgba(255,255,255,0.04)', border:'1px solid var(--tm-border)', borderRadius:'50%', width:32, height:32, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--tm-text-secondary)', fontSize:16 }}
          >
            ⋯
          </button>
          {menuOpen && (
            <>
              <div style={{ position:'fixed', inset:0, zIndex:10 }} onClick={() => setMenuOpen(false)} />
              <div style={{
                position:'absolute', top:'100%', right:0, zIndex:20, marginTop:4,
                background:'var(--tm-bg-secondary)', border:'1px solid var(--tm-border)',
                borderRadius:10, padding:4, minWidth:150,
                boxShadow:'0 8px 24px rgba(0,0,0,0.5)',
              }}>
                <MenuItem label="Modifier" icon="✏️" onClick={() => { onEdit(); setMenuOpen(false) }} />
                {!exchange.isDefault && <MenuItem label="Définir par défaut" icon="⭐" onClick={() => { onSetDefault(); setMenuOpen(false) }} />}
                <div style={{ height:1, background:'var(--tm-border)', margin:'4px 0' }} />
                <MenuItem label="Supprimer" icon="🗑" onClick={() => { setConfirmDelete(true); setMenuOpen(false) }} danger />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Fees */}
      <div style={{ background:'var(--tm-bg-secondary)', borderRadius:10, padding:'12px 14px' }}>
        <div style={{ fontSize:11, fontWeight:600, color:'var(--tm-text-secondary)', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.06em' }}>
          Frais de trading
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr auto 1fr', gap:8, alignItems:'center' }}>
          <div>
            <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:3 }}>Maker</div>
            <div style={{ fontSize:18, fontWeight:800, fontFamily:'JetBrains Mono, monospace', color:'var(--tm-text-primary)' }}>
              {fmtFee(exchange.makerFeeRate)}
            </div>
          </div>
          <div style={{ width:1, height:30, background:'var(--tm-border)' }} />
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:3 }}>Taker</div>
            <div style={{ fontSize:18, fontWeight:800, fontFamily:'JetBrains Mono, monospace', color:'var(--tm-text-primary)' }}>
              {fmtFee(exchange.takerFeeRate)}
            </div>
          </div>
        </div>
      </div>

      {/* Set default button */}
      {!exchange.isDefault && (
        <button
          onClick={onSetDefault}
          style={{
            width:'100%', marginTop:10, padding:'8px',
            background:'transparent', border:'1px solid var(--tm-border)',
            borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:600,
            color:'var(--tm-text-secondary)', transition:'all 0.15s',
          }}
          onMouseOver={e => (e.currentTarget.style.borderColor = 'var(--tm-accent)')}
          onMouseOut={e => (e.currentTarget.style.borderColor = 'var(--tm-border)')}
        >
          Définir par défaut
        </button>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <ConfirmDeleteOverlay
          name={exchange.name}
          onConfirm={() => { onDelete(); setConfirmDelete(false) }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}

function MenuItem({ label, icon, onClick, danger }: { label: string; icon: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        width:'100%', display:'flex', alignItems:'center', gap:8,
        padding:'7px 10px', borderRadius:6, border:'none', cursor:'pointer',
        background:'transparent', fontSize:12, fontWeight:500,
        color: danger ? 'var(--tm-loss)' : 'var(--tm-text-primary)',
        textAlign:'left', transition:'background 0.1s',
      }}
      onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
      onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
    >
      <span>{icon}</span>{label}
    </button>
  )
}

function ConfirmDeleteOverlay({ name, onConfirm, onCancel }: { name: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div style={{
      position:'absolute', inset:0, background:'rgba(0,0,0,0.8)', backdropFilter:'blur(4px)',
      borderRadius:14, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, padding:20, zIndex:5,
    }}>
      <div style={{ fontSize:14, fontWeight:700, color:'var(--tm-text-primary)', textAlign:'center' }}>Supprimer {name} ?</div>
      <div style={{ fontSize:12, color:'var(--tm-text-secondary)', textAlign:'center' }}>Cette action est irréversible</div>
      <div style={{ display:'flex', gap:8 }}>
        <button onClick={onCancel} style={{ padding:'7px 16px', borderRadius:8, border:'1px solid var(--tm-border)', background:'transparent', color:'var(--tm-text-secondary)', cursor:'pointer', fontSize:12 }}>Annuler</button>
        <button onClick={onConfirm} style={{ padding:'7px 16px', borderRadius:8, border:'none', background:'var(--tm-loss)', color:'#fff', cursor:'pointer', fontSize:12, fontWeight:600 }}>Supprimer</button>
      </div>
    </div>
  )
}

// ─── Exchange Modal (Add + Edit) ───────────────────────────────────────────────
function ExchangeModal({ exchange, onClose }: { exchange?: Exchange; onClose: () => void }) {
  const isEdit = !!exchange
  const [name, setName]               = useState(exchange?.name ?? '')
  const [makerFee, setMakerFee]       = useState(exchange ? exchange.makerFeeRate * 100 : 0.1)
  const [takerFee, setTakerFee]       = useState(exchange ? exchange.takerFeeRate * 100 : 0.1)
  const [isDefault, setIsDefault]     = useState(exchange?.isDefault ?? false)
  const [saving, setSaving]           = useState(false)

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    try {
      const data = {
        name: name.trim(),
        makerFeeRate: makerFee / 100,
        takerFeeRate: takerFee / 100,
        isDefault,
      }
      if (isEdit && exchange) {
        await updateExchange({ ...exchange, ...data })
        toast.success('Exchange mis à jour')
      } else {
        await createExchange(data)
        toast.success('Exchange ajouté')
      }
      onClose()
    } catch {
      toast.error('Erreur lors de la sauvegarde')
    } finally {
      setSaving(false)
    }
  }

  function applyPreset(p: typeof PRESET_EXCHANGES[0]) {
    setName(p.name)
    setMakerFee(p.maker * 100)
    setTakerFee(p.taker * 100)
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', backdropFilter:'blur(6px)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background:'var(--tm-bg-secondary)', border:'1px solid var(--tm-border)',
        borderRadius:18, width:'100%', maxWidth:460, overflow:'hidden',
        boxShadow:'0 24px 48px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{ padding:'18px 20px 14px', borderBottom:'1px solid var(--tm-border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'var(--tm-text-primary)' }}>
              {isEdit ? 'Modifier l\'exchange' : 'Ajouter un exchange'}
            </div>
            <div style={{ fontSize:11, color:'var(--tm-text-secondary)', marginTop:2 }}>
              {isEdit ? 'Modifiez les informations' : 'Configurez un nouvel exchange'}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'transparent', border:'none', cursor:'pointer', fontSize:18, color:'var(--tm-text-muted)', width:28, height:28, borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
        </div>

        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:16 }}>
          {/* Presets (only for new) */}
          {!isEdit && (
            <div>
              <div style={{ fontSize:11, fontWeight:600, color:'var(--tm-text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>Presets rapides</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {PRESET_EXCHANGES.map(p => (
                  <button key={p.name} onClick={() => applyPreset(p)} style={{
                    padding:'4px 10px', borderRadius:6, border:'1px solid var(--tm-border)',
                    background:'transparent', color:'var(--tm-text-secondary)', cursor:'pointer', fontSize:11, fontWeight:600,
                    transition:'all 0.15s',
                  }}
                  onMouseOver={e => { e.currentTarget.style.borderColor = 'var(--tm-accent)'; e.currentTarget.style.color = 'var(--tm-accent)' }}
                  onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--tm-border)'; e.currentTarget.style.color = 'var(--tm-text-secondary)' }}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Name */}
          <FormField label="Nom de l'exchange">
            <input
              value={name} onChange={e => setName(e.target.value)}
              placeholder="Ex: Binance, Bybit…"
              style={inputStyle}
            />
          </FormField>

          {/* Fees */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <FormField label="Frais Maker (%)" hint="Ordre limite">
              <div style={{ position:'relative' }}>
                <input
                  type="number" value={makerFee} step="0.001" min="0" max="1"
                  onChange={e => setMakerFee(parseFloat(e.target.value) || 0)}
                  style={{ ...inputStyle, paddingRight: 30 }}
                />
                <span style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', fontSize:12, color:'var(--tm-text-muted)' }}>%</span>
              </div>
            </FormField>
            <FormField label="Frais Taker (%)" hint="Ordre marché">
              <div style={{ position:'relative' }}>
                <input
                  type="number" value={takerFee} step="0.001" min="0" max="1"
                  onChange={e => setTakerFee(parseFloat(e.target.value) || 0)}
                  style={{ ...inputStyle, paddingRight: 30 }}
                />
                <span style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', fontSize:12, color:'var(--tm-text-muted)' }}>%</span>
              </div>
            </FormField>
          </div>

          {/* Default toggle */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', background:'var(--tm-bg-tertiary)', borderRadius:10, border:'1px solid var(--tm-border)' }}>
            <div>
              <div style={{ fontSize:13, fontWeight:600, color:'var(--tm-text-primary)' }}>Exchange par défaut</div>
              <div style={{ fontSize:11, color:'var(--tm-text-secondary)' }}>Pré-sélectionné lors de la création de trades</div>
            </div>
            <Toggle checked={isDefault} onChange={setIsDefault} />
          </div>

          {/* Buttons */}
          <div style={{ display:'flex', gap:10, marginTop:4 }}>
            <button onClick={onClose} style={{ flex:1, padding:'10px', borderRadius:9, border:'1px solid var(--tm-border)', background:'transparent', color:'var(--tm-text-secondary)', cursor:'pointer', fontSize:13 }}>
              Annuler
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || saving}
              style={{ flex:2, padding:'10px', borderRadius:9, border:'none', cursor: !name.trim() ? 'not-allowed' : 'pointer', fontSize:13, fontWeight:700,
                background: !name.trim() ? 'var(--tm-bg-tertiary)' : 'var(--tm-accent)',
                color: !name.trim() ? 'var(--tm-text-muted)' : 'var(--tm-bg)',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? '…' : isEdit ? 'Enregistrer' : 'Ajouter'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Preset Section ────────────────────────────────────────────────────────────
function PresetSection({ exchanges }: { exchanges: Exchange[] }) {
  const existingNames = new Set(exchanges.map(e => e.name.toLowerCase()))
  const missing = PRESET_EXCHANGES.filter(p => !existingNames.has(p.name.toLowerCase()))
  if (!missing.length) return null

  return (
    <div style={{ marginTop:32 }}>
      <div style={{ fontSize:13, fontWeight:600, color:'var(--tm-text-secondary)', marginBottom:12 }}>
        Ajouter rapidement
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
        {missing.map(p => (
          <QuickAddButton key={p.name} preset={p} />
        ))}
      </div>
    </div>
  )
}

function QuickAddButton({ preset }: { preset: typeof PRESET_EXCHANGES[0] }) {
  const [adding, setAdding] = useState(false)
  async function handleAdd() {
    setAdding(true)
    try {
      await createExchange({
        name: preset.name,
        makerFeeRate: preset.maker,
        takerFeeRate: preset.taker,
        isDefault: false,
      })
      toast.success(`${preset.name} ajouté`)
    } catch {
      toast.error('Erreur')
    } finally {
      setAdding(false)
    }
  }
  return (
    <button onClick={handleAdd} disabled={adding} style={{
      display:'flex', alignItems:'center', gap:6,
      padding:'6px 14px', borderRadius:8,
      border:'1px dashed var(--tm-border)',
      background:'transparent', cursor:'pointer',
      fontSize:12, fontWeight:600, color:'var(--tm-text-secondary)',
      transition:'all 0.15s',
    }}
    onMouseOver={e => { e.currentTarget.style.borderColor = 'var(--tm-accent)'; e.currentTarget.style.color = 'var(--tm-accent)' }}
    onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--tm-border)'; e.currentTarget.style.color = 'var(--tm-text-secondary)' }}>
      <span>+</span> {preset.name}
      <span style={{ fontSize:10, color:'inherit', opacity:0.6 }}>{(preset.maker*100).toFixed(3)}% / {(preset.taker*100).toFixed(3)}%</span>
    </button>
  )
}

// ─── Shared subcomponents ──────────────────────────────────────────────────────
function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display:'flex', alignItems:'baseline', gap:6, marginBottom:6 }}>
        <label style={{ fontSize:12, fontWeight:600, color:'var(--tm-text-secondary)' }}>{label}</label>
        {hint && <span style={{ fontSize:10, color:'var(--tm-text-muted)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width:'100%', padding:'9px 12px', borderRadius:8,
  border:'1px solid var(--tm-border)',
  background:'var(--tm-bg-tertiary)',
  color:'var(--tm-text-primary)', fontSize:13, outline:'none',
  boxSizing: 'border-box',
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div onClick={() => onChange(!checked)} style={{
      width:42, height:24, borderRadius:12, cursor:'pointer',
      background: checked ? 'var(--tm-profit)' : 'var(--tm-border)',
      position:'relative', transition:'background 0.2s', flexShrink:0,
    }}>
      <div style={{
        position:'absolute', top:3, left: checked ? 21 : 3,
        width:18, height:18, borderRadius:'50%', background:'#fff',
        transition:'left 0.2s', boxShadow:'0 1px 4px rgba(0,0,0,0.3)',
      }} />
    </div>
  )
}

function EmptyState({ onAdd, search }: { onAdd: () => void; search: string }) {
  return (
    <div style={{ textAlign:'center', padding:'60px 20px', color:'var(--tm-text-secondary)' }}>
      <div style={{ fontSize:48, marginBottom:16 }}>🏦</div>
      <div style={{ fontSize:16, fontWeight:600, marginBottom:8, color:'var(--tm-text-primary)' }}>
        {search ? 'Aucun résultat' : 'Aucun exchange configuré'}
      </div>
      <div style={{ fontSize:13, color:'var(--tm-text-secondary)', marginBottom:20 }}>
        {search ? 'Essayez une autre recherche' : 'Ajoutez vos exchanges pour calculer automatiquement les frais dans vos trades'}
      </div>
      {!search && (
        <button onClick={onAdd} style={{
          padding:'10px 24px', borderRadius:10, border:'none',
          background:'var(--tm-accent)', color:'var(--tm-bg)', cursor:'pointer', fontSize:13, fontWeight:700,
        }}>
          Ajouter un exchange
        </button>
      )}
    </div>
  )
}

function SkeletonCard() {
  return (
    <div style={{ background:'var(--tm-bg-card)', border:'1px solid var(--tm-border)', borderRadius:14, padding:18 }}>
      <div style={{ display:'flex', gap:12, marginBottom:16, alignItems:'center' }}>
        <div style={{ width:42, height:42, borderRadius:'50%', background:'rgba(255,255,255,0.04)' }} />
        <div style={{ flex:1 }}>
          <div style={{ height:14, background:'rgba(255,255,255,0.04)', borderRadius:4, marginBottom:6, width:'60%' }} />
          <div style={{ height:10, background:'rgba(255,255,255,0.04)', borderRadius:4, width:'40%' }} />
        </div>
      </div>
      <div style={{ height:64, background:'rgba(255,255,255,0.04)', borderRadius:10 }} />
    </div>
  )
}
