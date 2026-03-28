// SettingsPage.tsx — Paramètres complets avec export/import Firestore
import { useState, useRef, useEffect } from 'react'
import { getAuth, signOut } from 'firebase/auth'
import { collection, getDocs, doc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore'
import { db } from '@/services/firebase/config'

// ── Helpers ──────────────────────────────────────────────────────────────
function getUid(): string | null {
  return getAuth().currentUser?.uid ?? null
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / 1048576).toFixed(2)} Mo`
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
}

// ── Export all Firestore data ────────────────────────────────────────────
async function exportAllData(): Promise<{ data: Record<string, unknown[]>; stats: Record<string, number> }> {
  const uid = getUid()
  if (!uid) throw new Error('Non authentifié')

  const collections = ['trades', 'systems', 'moods', 'exchanges']
  const data: Record<string, unknown[]> = {}
  const stats: Record<string, number> = {}

  for (const col of collections) {
    try {
      const snap = await getDocs(collection(db, 'users', uid, col))
      data[col] = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
      stats[col] = snap.docs.length
    } catch {
      data[col] = []
      stats[col] = 0
    }
  }

  return { data, stats }
}

// ── Import data into Firestore ──────────────────────────────────────────
async function importData(
  data: Record<string, unknown[]>,
  mode: 'merge' | 'replace',
  onProgress: (msg: string) => void
): Promise<{ imported: Record<string, number> }> {
  const uid = getUid()
  if (!uid) throw new Error('Non authentifié')

  const imported: Record<string, number> = {}
  const validCollections = ['trades', 'systems', 'moods', 'exchanges']

  for (const col of validCollections) {
    const items = data[col]
    if (!Array.isArray(items) || items.length === 0) continue

    onProgress(`Import ${col}...`)

    // If replace mode, delete existing first
    if (mode === 'replace') {
      onProgress(`Suppression ${col} existants...`)
      const existing = await getDocs(collection(db, 'users', uid, col))
      const batch = writeBatch(db)
      existing.docs.forEach(d => batch.delete(d.ref))
      await batch.commit()
    }

    // Write items in batches of 100
    let count = 0
    for (let i = 0; i < items.length; i += 100) {
      const batch = writeBatch(db)
      const chunk = items.slice(i, i + 100)
      for (const item of chunk) {
        const raw = item as Record<string, unknown>
        const id = (raw._id as string) || (raw.id as string) || crypto.randomUUID()
        const { _id, ...rest } = raw
        batch.set(doc(db, 'users', uid, col, id), rest, { merge: mode === 'merge' })
        count++
      }
      await batch.commit()
      onProgress(`${col}: ${count}/${items.length}`)
    }
    imported[col] = count
  }

  return { imported }
}

// ── Section component ────────────────────────────────────────────────────
function Section({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon: string; children: React.ReactNode }) {
  return (
    <div style={{ background:'#161B22', border:'1px solid #1E2330', borderRadius:16, overflow:'hidden', marginBottom:16 }}>
      <div style={{ padding:'16px 20px', borderBottom:'1px solid #1E2330', display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ width:36, height:36, borderRadius:10, background:'rgba(0,229,255,0.08)', border:'1px solid rgba(0,229,255,0.15)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>{icon}</div>
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:'#F0F3FF' }}>{title}</div>
          {subtitle && <div style={{ fontSize:11, color:'#555C70' }}>{subtitle}</div>}
        </div>
      </div>
      <div style={{ padding:'16px 20px' }}>{children}</div>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────
export default function SettingsPage() {
  const auth = getAuth()
  const user = auth.currentUser
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Export state
  const [exporting, setExporting] = useState(false)
  const [exportDone, setExportDone] = useState(false)
  const [exportStats, setExportStats] = useState<Record<string, number> | null>(null)

  // Import state
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState('')
  const [importDone, setImportDone] = useState(false)
  const [importStats, setImportStats] = useState<Record<string, number> | null>(null)
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')
  const [importError, setImportError] = useState('')
  const [previewData, setPreviewData] = useState<Record<string, unknown[]> | null>(null)
  const [previewName, setPreviewName] = useState('')

  // Data stats
  const [dataStats, setDataStats] = useState<Record<string, number> | null>(null)
  const [loadingStats, setLoadingStats] = useState(true)

  // Danger zone
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Load stats on mount
  useEffect(() => {
    (async () => {
      try {
        const { stats } = await exportAllData()
        setDataStats(stats)
      } catch { /* */ }
      setLoadingStats(false)
    })()
  }, [])

  // ── Export handler ──────────────────────────────────────────────────
  const handleExport = async () => {
    setExporting(true); setExportDone(false)
    try {
      const { data, stats } = await exportAllData()
      const blob = new Blob([JSON.stringify({
        _meta: {
          app: 'TradeMindset',
          version: '1.0',
          exportedAt: new Date().toISOString(),
          uid: user?.uid,
          email: user?.email,
        },
        ...data,
      }, null, 2)], { type: 'application/json' })

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `trademindset-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)

      setExportStats(stats)
      setExportDone(true)
    } catch (e) {
      alert('Erreur export: ' + (e as Error).message)
    }
    setExporting(false)
  }

  // ── Import handler ─────────────────────────────────────────────────
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportError(''); setImportDone(false); setImportStats(null)

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string)
        // Validate structure
        const validKeys = ['trades', 'systems', 'moods', 'exchanges']
        const found = validKeys.filter(k => Array.isArray(parsed[k]) && parsed[k].length > 0)
        if (found.length === 0) {
          setImportError('Fichier invalide : aucune collection trouvée (trades, systems, moods, exchanges)')
          return
        }
        setPreviewData(parsed)
        setPreviewName(file.name)
      } catch {
        setImportError('Fichier JSON invalide')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleImport = async () => {
    if (!previewData) return
    setImporting(true); setImportProgress('Démarrage...'); setImportError('')
    try {
      const { imported } = await importData(previewData, importMode, setImportProgress)
      setImportStats(imported)
      setImportDone(true)
      setPreviewData(null)
      // Refresh stats
      const { stats } = await exportAllData()
      setDataStats(stats)
    } catch (e) {
      setImportError('Erreur: ' + (e as Error).message)
    }
    setImporting(false); setImportProgress('')
  }

  // ── Delete all data ────────────────────────────────────────────────
  const handleDeleteAll = async () => {
    const uid = getUid()
    if (!uid) return
    setDeleting(true)
    try {
      for (const col of ['trades', 'systems', 'moods', 'exchanges']) {
        const snap = await getDocs(collection(db, 'users', uid, col))
        const batch = writeBatch(db)
        snap.docs.forEach(d => batch.delete(d.ref))
        await batch.commit()
      }
      setDataStats({ trades:0, systems:0, moods:0, exchanges:0 })
      setConfirmDelete(false)
    } catch (e) {
      alert('Erreur: ' + (e as Error).message)
    }
    setDeleting(false)
  }

  const totalItems = dataStats ? Object.values(dataStats).reduce((a, b) => a + b, 0) : 0

  return (
    <div style={{ minHeight:'100vh', background:'#0D1117', padding:'32px 24px', maxWidth:800, margin:'0 auto' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}`}</style>

      {/* Header */}
      <div style={{ marginBottom:28 }}>
        <h1 style={{ fontSize:24, fontWeight:700, color:'#F0F3FF', margin:0, fontFamily:'Syne,sans-serif' }}>Paramètres</h1>
        <p style={{ fontSize:13, color:'#555C70', margin:'4px 0 0' }}>Compte · Données · Export · Import</p>
      </div>

      {/* ── Account ──────────────────────────────────────────────────── */}
      <Section title="Compte" subtitle="Informations de connexion" icon="👤">
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <div style={{ width:52, height:52, borderRadius:'50%', background:'linear-gradient(135deg,#00E5FF,#0A85FF)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, fontWeight:700, color:'#0D1117' }}>
            {user?.displayName?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'}
          </div>
          <div style={{ flex:1 }}>
            {user?.displayName && <div style={{ fontSize:16, fontWeight:700, color:'#F0F3FF', marginBottom:2 }}>{user.displayName}</div>}
            <div style={{ fontSize:13, color:'#8F94A3' }}>{user?.email}</div>
            <div style={{ fontSize:11, color:'#555C70', marginTop:2 }}>UID: <span style={{ fontFamily:'JetBrains Mono,monospace', color:'#3D4254' }}>{user?.uid?.slice(0, 16)}...</span></div>
          </div>
          <button onClick={() => signOut(auth)} style={{ padding:'8px 18px', borderRadius:10, border:'1px solid rgba(255,59,48,0.3)', background:'rgba(255,59,48,0.08)', color:'#FF3B30', fontSize:12, fontWeight:600, cursor:'pointer' }}>
            Déconnexion
          </button>
        </div>
      </Section>

      {/* ── Data Overview ────────────────────────────────────────────── */}
      <Section title="Données" subtitle={`${totalItems} éléments au total dans Firestore`} icon="📦">
        {loadingStats ? (
          <div style={{ display:'flex', alignItems:'center', gap:10, color:'#555C70', fontSize:12 }}>
            <div style={{ width:16, height:16, border:'2px solid #2A2F3E', borderTopColor:'#00E5FF', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} />
            Chargement des statistiques...
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
            {[
              { key:'trades', icon:'📊', label:'Trades', color:'#22C759' },
              { key:'systems', icon:'⚙️', label:'Systèmes', color:'#0A85FF' },
              { key:'moods', icon:'💜', label:'Moods', color:'#BF5AF2' },
              { key:'exchanges', icon:'🏛️', label:'Exchanges', color:'#FF9500' },
            ].map(({ key, icon, label, color }) => (
              <div key={key} style={{ background:`${color}08`, border:`1px solid ${color}20`, borderRadius:12, padding:'14px', textAlign:'center' }}>
                <div style={{ fontSize:20, marginBottom:6 }}>{icon}</div>
                <div style={{ fontSize:22, fontWeight:800, color, fontFamily:'JetBrains Mono,monospace' }}>{dataStats?.[key] ?? 0}</div>
                <div style={{ fontSize:11, color:'#555C70', marginTop:2 }}>{label}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Export ────────────────────────────────────────────────────── */}
      <Section title="Exporter les données" subtitle="Télécharger toutes vos données en JSON" icon="📤">
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
          <div style={{ fontSize:12, color:'#8F94A3', lineHeight:1.6 }}>
            Exporte toutes vos données (trades, systèmes, moods, exchanges) dans un fichier JSON que vous pourrez réimporter plus tard.
          </div>
          <button onClick={handleExport} disabled={exporting} style={{
            padding:'10px 24px', borderRadius:12, border:'1px solid rgba(34,199,89,0.3)',
            background: exporting ? '#1C2130' : 'rgba(34,199,89,0.1)',
            color: exporting ? '#555C70' : '#22C759', fontSize:13, fontWeight:700,
            cursor: exporting ? 'not-allowed' : 'pointer', display:'flex', alignItems:'center', gap:8, flexShrink:0,
          }}>
            {exporting ? (
              <><div style={{ width:14, height:14, border:'2px solid #3D4254', borderTopColor:'#22C759', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} /> Export...</>
            ) : '📥 Exporter tout'}
          </button>
        </div>
        {exportDone && exportStats && (
          <div style={{ marginTop:12, padding:'12px 16px', background:'rgba(34,199,89,0.06)', border:'1px solid rgba(34,199,89,0.2)', borderRadius:10, animation:'fadeIn 0.3s ease-out' }}>
            <div style={{ fontSize:12, fontWeight:700, color:'#22C759', marginBottom:6 }}>✓ Export réussi</div>
            <div style={{ fontSize:11, color:'#8F94A3' }}>
              {Object.entries(exportStats).map(([k, v]) => `${v} ${k}`).join(' · ')}
            </div>
          </div>
        )}
      </Section>

      {/* ── Import ────────────────────────────────────────────────────── */}
      <Section title="Importer des données" subtitle="Restaurer depuis un fichier de sauvegarde" icon="📥">
        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:11, color:'#555C70', marginBottom:8 }}>MODE D'IMPORT</div>
          <div style={{ display:'flex', gap:8 }}>
            {([
              { id:'merge' as const, label:'Fusionner', desc:'Ajoute les données sans supprimer les existantes', icon:'🔄' },
              { id:'replace' as const, label:'Remplacer', desc:'Supprime tout puis importe le fichier', icon:'⚡' },
            ]).map(m => (
              <button key={m.id} onClick={() => setImportMode(m.id)} style={{
                flex:1, padding:'12px 14px', borderRadius:10, cursor:'pointer', textAlign:'left',
                border:`1px solid ${importMode === m.id ? '#0A85FF' : '#2A2F3E'}`,
                background: importMode === m.id ? 'rgba(10,133,255,0.08)' : 'transparent',
              }}>
                <div style={{ fontSize:13, fontWeight:600, color: importMode === m.id ? '#0A85FF' : '#8F94A3', marginBottom:2 }}>{m.icon} {m.label}</div>
                <div style={{ fontSize:10, color:'#555C70' }}>{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* File select */}
        {!previewData ? (
          <div onClick={() => fileInputRef.current?.click()} style={{
            border:'2px dashed #2A2F3E', borderRadius:12, padding:'28px 20px', textAlign:'center',
            cursor:'pointer', transition:'all 0.2s',
          }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#0A85FF' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#2A2F3E' }}>
            <div style={{ fontSize:32, marginBottom:8 }}>📂</div>
            <div style={{ fontSize:13, fontWeight:600, color:'#F0F3FF', marginBottom:4 }}>Sélectionner un fichier de sauvegarde</div>
            <div style={{ fontSize:11, color:'#555C70' }}>Format JSON · Exporté depuis TradeMindset</div>
            <input ref={fileInputRef} type="file" accept=".json" style={{ display:'none' }} onChange={handleFileSelect} />
          </div>
        ) : (
          <div style={{ animation:'fadeIn 0.3s ease-out' }}>
            {/* Preview */}
            <div style={{ padding:'14px 16px', background:'rgba(10,133,255,0.06)', border:'1px solid rgba(10,133,255,0.2)', borderRadius:10, marginBottom:12 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'#0A85FF' }}>📄 {previewName}</div>
                <button onClick={() => setPreviewData(null)} style={{ background:'none', border:'none', color:'#555C70', cursor:'pointer', fontSize:14 }}>✕</button>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8 }}>
                {['trades', 'systems', 'moods', 'exchanges'].map(col => {
                  const count = Array.isArray(previewData[col]) ? previewData[col].length : 0
                  return (
                    <div key={col} style={{ textAlign:'center', padding:'6px 8px', background:'rgba(0,0,0,0.2)', borderRadius:6 }}>
                      <div style={{ fontSize:16, fontWeight:800, color: count > 0 ? '#F0F3FF' : '#3D4254', fontFamily:'JetBrains Mono,monospace' }}>{count}</div>
                      <div style={{ fontSize:9, color:'#555C70' }}>{col}</div>
                    </div>
                  )
                })}
              </div>
              {(previewData as any)._meta && (
                <div style={{ fontSize:10, color:'#3D4254', marginTop:8 }}>
                  Exporté le {(previewData as any)._meta.exportedAt?.slice(0, 10)} · {(previewData as any)._meta.email}
                </div>
              )}
            </div>

            {importMode === 'replace' && (
              <div style={{ padding:'10px 14px', background:'rgba(255,59,48,0.06)', border:'1px solid rgba(255,59,48,0.2)', borderRadius:8, marginBottom:12, fontSize:11, color:'#FF3B30' }}>
                ⚠️ Le mode Remplacer supprimera toutes vos données existantes avant d'importer. Assurez-vous d'avoir une sauvegarde.
              </div>
            )}

            <div style={{ display:'flex', gap:8 }}>
              <button onClick={handleImport} disabled={importing} style={{
                flex:1, padding:'11px', borderRadius:10,
                background: importing ? '#1C2130' : 'rgba(10,133,255,0.15)',
                border:'1px solid rgba(10,133,255,0.4)', color: importing ? '#555C70' : '#0A85FF',
                fontSize:13, fontWeight:700, cursor: importing ? 'not-allowed' : 'pointer',
                display:'flex', alignItems:'center', justifyContent:'center', gap:8,
              }}>
                {importing ? (
                  <><div style={{ width:14, height:14, border:'2px solid #3D4254', borderTopColor:'#0A85FF', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} /> {importProgress}</>
                ) : `📥 Importer (${importMode === 'merge' ? 'fusion' : 'remplacement'})`}
              </button>
              <button onClick={() => setPreviewData(null)} style={{ padding:'11px 16px', borderRadius:10, background:'transparent', border:'1px solid #2A2F3E', color:'#555C70', fontSize:12, cursor:'pointer' }}>Annuler</button>
            </div>
          </div>
        )}

        {importError && (
          <div style={{ marginTop:12, padding:'10px 14px', background:'rgba(255,59,48,0.06)', border:'1px solid rgba(255,59,48,0.2)', borderRadius:8, fontSize:12, color:'#FF3B30' }}>
            ⚠️ {importError}
          </div>
        )}

        {importDone && importStats && (
          <div style={{ marginTop:12, padding:'12px 16px', background:'rgba(34,199,89,0.06)', border:'1px solid rgba(34,199,89,0.2)', borderRadius:10, animation:'fadeIn 0.3s ease-out' }}>
            <div style={{ fontSize:12, fontWeight:700, color:'#22C759', marginBottom:6 }}>✓ Import réussi</div>
            <div style={{ fontSize:11, color:'#8F94A3' }}>
              {Object.entries(importStats).map(([k, v]) => `${v} ${k}`).join(' · ')}
            </div>
          </div>
        )}
      </Section>

      {/* ── App Info ──────────────────────────────────────────────────── */}
      <Section title="Application" subtitle="TradeMindset v1.1" icon="📱">
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          {[
            { label:'Version', value:'1.1.0' },
            { label:'Plateforme', value:'React + Vite' },
            { label:'Backend', value:'Firebase / Firestore' },
            { label:'Déployé sur', value:'Vercel' },
            { label:'Cloud Functions', value:'europe-west1' },
            { label:'IA', value:'GPT-4o / GPT-4o-mini' },
          ].map(({ label, value }) => (
            <div key={label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px solid #1E2330' }}>
              <span style={{ fontSize:12, color:'#555C70' }}>{label}</span>
              <span style={{ fontSize:12, fontWeight:600, color:'#8F94A3', fontFamily:'JetBrains Mono,monospace' }}>{value}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Danger Zone ───────────────────────────────────────────────── */}
      <Section title="Zone dangereuse" subtitle="Actions irréversibles" icon="⚠️">
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)} style={{
            width:'100%', padding:'12px', borderRadius:10,
            border:'1px solid rgba(255,59,48,0.3)', background:'rgba(255,59,48,0.06)',
            color:'#FF3B30', fontSize:13, fontWeight:600, cursor:'pointer',
          }}>
            🗑 Supprimer toutes les données
          </button>
        ) : (
          <div style={{ padding:'16px', background:'rgba(255,59,48,0.06)', border:'1px solid rgba(255,59,48,0.3)', borderRadius:12 }}>
            <div style={{ fontSize:14, fontWeight:700, color:'#FF3B30', marginBottom:8 }}>⚠️ Confirmer la suppression</div>
            <div style={{ fontSize:12, color:'#8F94A3', marginBottom:14, lineHeight:1.6 }}>
              Cette action supprimera définitivement tous vos trades, systèmes, moods et exchanges. Cette action est irréversible. Exportez vos données avant de continuer.
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={handleDeleteAll} disabled={deleting} style={{
                flex:1, padding:'10px', borderRadius:8,
                background: deleting ? '#1C2130' : 'rgba(255,59,48,0.15)',
                border:'1px solid rgba(255,59,48,0.5)', color: deleting ? '#555C70' : '#FF3B30',
                fontSize:12, fontWeight:700, cursor: deleting ? 'not-allowed' : 'pointer',
              }}>
                {deleting ? 'Suppression...' : 'Confirmer la suppression'}
              </button>
              <button onClick={() => setConfirmDelete(false)} style={{
                padding:'10px 20px', borderRadius:8, background:'transparent',
                border:'1px solid #2A2F3E', color:'#555C70', fontSize:12, cursor:'pointer',
              }}>Annuler</button>
            </div>
          </div>
        )}
      </Section>

      {/* Footer */}
      <div style={{ textAlign:'center', padding:'20px 0 40px', fontSize:11, color:'#3D4254' }}>
        TradeMindset · trademindsetapp@gmail.com · {new Date().getFullYear()}
      </div>
    </div>
  )
}
