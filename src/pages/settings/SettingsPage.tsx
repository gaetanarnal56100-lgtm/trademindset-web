// SettingsPage.tsx — Paramètres v2 : export/import, suppression données, suppression compte
import { useState, useRef, useEffect } from 'react'
import { ThemeSelector } from '@/components/ui/ThemeSelector'
import { ExchangeManager } from '@/pages/exchanges/ExchangesPage'
import { getAuth, signOut, deleteUser, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth'
import { collection, getDocs, doc, deleteDoc, writeBatch, Timestamp, onSnapshot } from 'firebase/firestore'
import { db } from '@/services/firebase/config'

// ── Helpers ──────────────────────────────────────────────────────────────
function getUid(): string | null {
  return getAuth().currentUser?.uid ?? null
}

// ── Serialize Firestore data for export (Timestamps → ISO strings) ────────
function serializeForExport(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj
  // Firestore Timestamp
  if (typeof (obj as any).toDate === 'function') {
    try { return (obj as any).toDate().toISOString() } catch { return null }
  }
  if ((obj as any).seconds !== undefined && (obj as any).nanoseconds !== undefined) {
    return new Date((obj as any).seconds * 1000).toISOString()
  }
  if (obj instanceof Date) return obj.toISOString()
  if (Array.isArray(obj)) return obj.map(serializeForExport)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = serializeForExport(v)
  }
  return out
}

// ── Deserialize imported data (ISO strings → Firestore Timestamps) ───────
function deserializeForImport(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(obj)) {
    const d = new Date(obj)
    if (!isNaN(d.getTime())) return Timestamp.fromDate(d)
  }
  if (typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(deserializeForImport)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = deserializeForImport(v)
  }
  return out
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
      data[col] = snap.docs.map(d => serializeForExport({ _id: d.id, ...d.data() }) as Record<string, unknown>)
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
    if (mode === 'replace') {
      onProgress(`Suppression ${col} existants...`)
      const existing = await getDocs(collection(db, 'users', uid, col))
      const batch = writeBatch(db)
      existing.docs.forEach(d => batch.delete(d.ref))
      await batch.commit()
    }
    let count = 0
    for (let i = 0; i < items.length; i += 100) {
      const batch = writeBatch(db)
      const chunk = items.slice(i, i + 100)
      for (const item of chunk) {
        const raw = item as Record<string, unknown>
        const id = (raw._id as string) || (raw.id as string) || crypto.randomUUID()
        const { _id, ...rest } = raw
        const deserialized = deserializeForImport(rest) as Record<string, unknown>
        batch.set(doc(db, 'users', uid, col, id), deserialized, { merge: mode === 'merge' })
        count++
      }
      await batch.commit()
      onProgress(`${col}: ${count}/${items.length}`)
    }
    imported[col] = count
  }
  return { imported }
}

// ── Delete all user data (keep account) ─────────────────────────────────
async function deleteAllUserData(onProgress: (msg: string) => void): Promise<void> {
  const uid = getUid()
  if (!uid) throw new Error('Non authentifié')
  const collections = ['trades', 'systems', 'moods', 'exchanges']
  for (const col of collections) {
    onProgress(`Suppression ${col}...`)
    const snap = await getDocs(collection(db, 'users', uid, col))
    if (snap.docs.length === 0) continue
    const batch = writeBatch(db)
    snap.docs.forEach(d => batch.delete(d.ref))
    await batch.commit()
  }
  // Delete user root doc if exists
  try { await deleteDoc(doc(db, 'users', uid)) } catch {/**/}
}

// ── Delete account (Firebase Auth + data) ───────────────────────────────
async function deleteAccountAndData(password: string, onProgress: (msg: string) => void): Promise<void> {
  const auth = getAuth()
  const user = auth.currentUser
  if (!user) throw new Error('Non authentifié')

  // Re-authenticate if email/password provider
  const emailProvider = user.providerData.find(p => p.providerId === 'password')
  if (emailProvider && user.email) {
    onProgress('Ré-authentification...')
    const cred = EmailAuthProvider.credential(user.email, password)
    await reauthenticateWithCredential(user, cred)
  }

  // Delete all Firestore data
  onProgress('Suppression des données...')
  await deleteAllUserData(onProgress)

  // Delete the Firebase Auth account
  onProgress('Suppression du compte...')
  await deleteUser(user)
}

// ── Section component ────────────────────────────────────────────────────
function Section({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon: string; children: React.ReactNode }) {
  return (
    <div style={{ background:'var(--tm-bg-secondary)', border:'1px solid #1E2330', borderRadius:16, overflow:'hidden', marginBottom:16 }}>
      <div style={{ padding:'16px 20px', borderBottom:'1px solid #1E2330', display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ width:36, height:36, borderRadius:10, background:'rgba(var(--tm-accent-rgb,0,229,255),0.08)', border:'1px solid rgba(var(--tm-accent-rgb,0,229,255),0.15)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>{icon}</div>
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:'var(--tm-text-primary)' }}>{title}</div>
          {subtitle && <div style={{ fontSize:11, color:'var(--tm-text-muted)' }}>{subtitle}</div>}
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

  // Delete data state
  const [confirmDeleteData, setConfirmDeleteData] = useState(false)
  const [deletingData, setDeletingData] = useState(false)
  const [deleteDataProgress, setDeleteDataProgress] = useState('')

  // Delete account state
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [deleteAccountPassword, setDeleteAccountPassword] = useState('')
  const [deleteAccountError, setDeleteAccountError] = useState('')
  const [deleteAccountProgress, setDeleteAccountProgress] = useState('')

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
          version: '1.1',
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
      const { stats } = await exportAllData()
      setDataStats(stats)
    } catch (e) {
      setImportError('Erreur: ' + (e as Error).message)
    }
    setImporting(false); setImportProgress('')
  }

  // ── Delete data handler ────────────────────────────────────────────
  const handleDeleteData = async () => {
    setDeletingData(true)
    try {
      await deleteAllUserData(setDeleteDataProgress)
      setDataStats({ trades:0, systems:0, moods:0, exchanges:0 })
      setConfirmDeleteData(false)
      setDeleteDataProgress('')
    } catch (e) {
      alert('Erreur: ' + (e as Error).message)
    }
    setDeletingData(false)
  }

  // ── Delete account handler ─────────────────────────────────────────
  const handleDeleteAccount = async () => {
    setDeletingAccount(true); setDeleteAccountError('')
    try {
      await deleteAccountAndData(deleteAccountPassword, setDeleteAccountProgress)
      // Account deleted — user is automatically signed out
      window.location.href = '/login'
    } catch (e) {
      const msg = (e as any)?.code === 'auth/wrong-password'
        ? 'Mot de passe incorrect'
        : (e as any)?.code === 'auth/requires-recent-login'
        ? 'Veuillez vous reconnecter puis réessayer'
        : (e as Error).message
      setDeleteAccountError(msg)
    }
    setDeletingAccount(false); setDeleteAccountProgress('')
  }

  const totalItems = dataStats ? Object.values(dataStats).reduce((a, b) => a + b, 0) : 0
  const isEmailUser = user?.providerData.some(p => p.providerId === 'password')

  // Load profile photo from Firestore
  const [profilePhoto, setProfilePhoto] = useState<string|null>(null)
  const [profileName, setProfileName] = useState<string|null>(null)
  useEffect(() => {
    if (!user) return
    const unsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      if (snap.exists()) {
        const d = snap.data()
        setProfilePhoto(d.photoBase64 || d.photoURL || null)
        if (d.displayName) setProfileName(d.displayName)
      }
    })
    return unsub
  }, [user])

  return (
    <div style={{ minHeight:'100vh', background:'var(--tm-bg)', padding:'32px 24px', maxWidth:800, margin:'0 auto' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}`}</style>

      {/* Header */}
      <div style={{ marginBottom:28 }}>
        <h1 style={{ fontSize:24, fontWeight:700, color:'var(--tm-text-primary)', margin:0, fontFamily:'Syne,sans-serif' }}>Paramètres</h1>
        <p style={{ fontSize:13, color:'var(--tm-text-muted)', margin:'4px 0 0' }}>Compte · Données · Export · Import</p>
      </div>

      {/* ── Account ──────────────────────────────────────────────────── */}
      <Section title="Thème" subtitle="Apparence de l'interface" icon="🎨">
        <ThemeSelector />
      </Section>

      <Section title="Compte" subtitle="Informations de connexion" icon="👤">
        <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:16 }}>
          <div style={{ width:52, height:52, borderRadius:'50%', background:'linear-gradient(135deg,#00E5FF,#0A85FF)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, fontWeight:700, color:'var(--tm-bg)', flexShrink:0, overflow:'hidden' }}>
            {profilePhoto ? (
              <img src={profilePhoto} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
            ) : (
              (profileName || user?.displayName)?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'
            )}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:16, fontWeight:700, color:'var(--tm-text-primary)', marginBottom:2 }}>{profileName || user?.displayName || 'Trader'}</div>
            <div style={{ fontSize:13, color:'var(--tm-text-secondary)' }}>{user?.email}</div>
          </div>
          <button onClick={() => signOut(auth)} style={{ padding:'8px 18px', borderRadius:10, border:'1px solid rgba(var(--tm-loss-rgb,255,59,48),0.3)', background:'rgba(var(--tm-loss-rgb,255,59,48),0.08)', color:'var(--tm-loss)', fontSize:12, fontWeight:600, cursor:'pointer', flexShrink:0 }}>
            Déconnexion
          </button>
        </div>
        {/* UID */}
        <div style={{ padding:'10px 14px', background:'rgba(255,255,255,0.02)', border:'1px solid #1E2330', borderRadius:10 }}>
          <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.08em' }}>Identifiant unique (UID)</div>
          <div style={{ fontSize:12, color:'var(--tm-text-secondary)', fontFamily:'JetBrains Mono,monospace', wordBreak:'break-all', userSelect:'all' }}>{user?.uid}</div>
        </div>
      </Section>

      {/* ── Data Overview ────────────────────────────────────────────── */}
      <Section title="Vos données" subtitle={`${totalItems} éléments au total`} icon="📦">
        {loadingStats ? (
          <div style={{ display:'flex', alignItems:'center', gap:10, color:'var(--tm-text-muted)', fontSize:12 }}>
            <div style={{ width:16, height:16, border:'2px solid #2A2F3E', borderTopColor:'var(--tm-accent)', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} />
            Chargement...
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
            {[
              { key:'trades', icon:'📊', label:'Trades', color:'var(--tm-profit)' },
              { key:'systems', icon:'⚙️', label:'Systèmes', color:'var(--tm-blue)' },
              { key:'moods', icon:'💜', label:'Moods', color:'var(--tm-purple)' },
              { key:'exchanges', icon:'🏛️', label:'Exchanges', color:'var(--tm-warning)' },
            ].map(({ key, icon, label, color }) => (
              <div key={key} style={{ background:`${color}08`, border:`1px solid ${color}20`, borderRadius:12, padding:'14px', textAlign:'center' }}>
                <div style={{ fontSize:20, marginBottom:6 }}>{icon}</div>
                <div style={{ fontSize:22, fontWeight:800, color, fontFamily:'JetBrains Mono,monospace' }}>{dataStats?.[key] ?? 0}</div>
                <div style={{ fontSize:11, color:'var(--tm-text-muted)', marginTop:2 }}>{label}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Exchanges ─────────────────────────────────────────────────── */}
      <Section title="Exchanges" subtitle="Gérer vos exchanges de trading" icon="🔗">
        <ExchangeManager />
      </Section>

      {/* ── Export ────────────────────────────────────────────────────── */}
      <Section title="Exporter les données" subtitle="Télécharger toutes vos données en JSON" icon="📤">
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
          <div style={{ fontSize:12, color:'var(--tm-text-secondary)', lineHeight:1.6, flex:1 }}>
            Exporte tous vos trades, systèmes, moods et exchanges dans un fichier JSON réimportable.
          </div>
          <button onClick={handleExport} disabled={exporting} style={{
            padding:'10px 24px', borderRadius:12, border:'1px solid rgba(var(--tm-profit-rgb,34,199,89),0.3)',
            background: exporting ? 'var(--tm-bg-tertiary)' : 'rgba(var(--tm-profit-rgb,34,199,89),0.1)',
            color: exporting ? 'var(--tm-text-muted)' : 'var(--tm-profit)', fontSize:13, fontWeight:700,
            cursor: exporting ? 'not-allowed' : 'pointer', display:'flex', alignItems:'center', gap:8, flexShrink:0,
          }}>
            {exporting ? (
              <><div style={{ width:14, height:14, border:'2px solid #3D4254', borderTopColor:'var(--tm-profit)', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} /> Export...</>
            ) : '📥 Exporter tout'}
          </button>
        </div>
        {exportDone && exportStats && (
          <div style={{ marginTop:12, padding:'12px 16px', background:'rgba(var(--tm-profit-rgb,34,199,89),0.06)', border:'1px solid rgba(var(--tm-profit-rgb,34,199,89),0.2)', borderRadius:10, animation:'fadeIn 0.3s ease-out' }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--tm-profit)', marginBottom:4 }}>✓ Export réussi</div>
            <div style={{ fontSize:11, color:'var(--tm-text-secondary)' }}>
              {Object.entries(exportStats).map(([k, v]) => `${v} ${k}`).join(' · ')}
            </div>
          </div>
        )}
      </Section>

      {/* ── Import ────────────────────────────────────────────────────── */}
      <Section title="Importer des données" subtitle="Restaurer depuis un fichier de sauvegarde" icon="📥">
        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:11, color:'var(--tm-text-muted)', marginBottom:8 }}>MODE D'IMPORT</div>
          <div style={{ display:'flex', gap:8 }}>
            {([
              { id:'merge' as const, label:'Fusionner', desc:'Ajoute sans supprimer les existantes', icon:'🔄' },
              { id:'replace' as const, label:'Remplacer', desc:'Supprime tout puis importe', icon:'⚡' },
            ]).map(m => (
              <button key={m.id} onClick={() => setImportMode(m.id)} style={{
                flex:1, padding:'12px 14px', borderRadius:10, cursor:'pointer', textAlign:'left',
                border:`1px solid ${importMode === m.id ? 'var(--tm-blue)' : 'var(--tm-border)'}`,
                background: importMode === m.id ? 'rgba(var(--tm-blue-rgb,10,133,255),0.08)' : 'transparent',
              }}>
                <div style={{ fontSize:13, fontWeight:600, color: importMode === m.id ? 'var(--tm-blue)' : 'var(--tm-text-secondary)', marginBottom:2 }}>{m.icon} {m.label}</div>
                <div style={{ fontSize:10, color:'var(--tm-text-muted)' }}>{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {!previewData ? (
          <div onClick={() => fileInputRef.current?.click()} style={{
            border:'2px dashed #2A2F3E', borderRadius:12, padding:'28px 20px', textAlign:'center', cursor:'pointer', transition:'all 0.2s',
          }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--tm-blue)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--tm-border)' }}>
            <div style={{ fontSize:32, marginBottom:8 }}>📂</div>
            <div style={{ fontSize:13, fontWeight:600, color:'var(--tm-text-primary)', marginBottom:4 }}>Sélectionner un fichier de sauvegarde</div>
            <div style={{ fontSize:11, color:'var(--tm-text-muted)' }}>Format JSON · Exporté depuis TradeMindset</div>
            <input ref={fileInputRef} type="file" accept=".json" style={{ display:'none' }} onChange={handleFileSelect} />
          </div>
        ) : (
          <div style={{ animation:'fadeIn 0.3s ease-out' }}>
            <div style={{ padding:'14px 16px', background:'rgba(var(--tm-blue-rgb,10,133,255),0.06)', border:'1px solid rgba(var(--tm-blue-rgb,10,133,255),0.2)', borderRadius:10, marginBottom:12 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'var(--tm-blue)' }}>📄 {previewName}</div>
                <button onClick={() => setPreviewData(null)} style={{ background:'none', border:'none', color:'var(--tm-text-muted)', cursor:'pointer', fontSize:14 }}>✕</button>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8 }}>
                {['trades', 'systems', 'moods', 'exchanges'].map(col => {
                  const count = Array.isArray(previewData[col]) ? previewData[col].length : 0
                  return (
                    <div key={col} style={{ textAlign:'center', padding:'6px 8px', background:'rgba(0,0,0,0.2)', borderRadius:6 }}>
                      <div style={{ fontSize:16, fontWeight:800, color: count > 0 ? 'var(--tm-text-primary)' : 'var(--tm-text-muted)', fontFamily:'JetBrains Mono,monospace' }}>{count}</div>
                      <div style={{ fontSize:9, color:'var(--tm-text-muted)' }}>{col}</div>
                    </div>
                  )
                })}
              </div>
              {(previewData as any)._meta && (
                <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginTop:8 }}>
                  Exporté le {(previewData as any)._meta.exportedAt?.slice(0, 10)} · {(previewData as any)._meta.email}
                </div>
              )}
            </div>
            {importMode === 'replace' && (
              <div style={{ padding:'10px 14px', background:'rgba(var(--tm-loss-rgb,255,59,48),0.06)', border:'1px solid rgba(var(--tm-loss-rgb,255,59,48),0.2)', borderRadius:8, marginBottom:12, fontSize:11, color:'var(--tm-loss)' }}>
                ⚠️ Le mode Remplacer supprimera toutes vos données existantes avant d'importer.
              </div>
            )}
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={handleImport} disabled={importing} style={{
                flex:1, padding:'11px', borderRadius:10,
                background: importing ? 'var(--tm-bg-tertiary)' : 'rgba(var(--tm-blue-rgb,10,133,255),0.15)',
                border:'1px solid rgba(var(--tm-blue-rgb,10,133,255),0.4)', color: importing ? 'var(--tm-text-muted)' : 'var(--tm-blue)',
                fontSize:13, fontWeight:700, cursor: importing ? 'not-allowed' : 'pointer',
                display:'flex', alignItems:'center', justifyContent:'center', gap:8,
              }}>
                {importing ? (
                  <><div style={{ width:14, height:14, border:'2px solid #3D4254', borderTopColor:'var(--tm-blue)', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} /> {importProgress}</>
                ) : `📥 Importer (${importMode === 'merge' ? 'fusion' : 'remplacement'})`}
              </button>
              <button onClick={() => setPreviewData(null)} style={{ padding:'11px 16px', borderRadius:10, background:'transparent', border:'1px solid #2A2F3E', color:'var(--tm-text-muted)', fontSize:12, cursor:'pointer' }}>Annuler</button>
            </div>
          </div>
        )}

        {importError && (
          <div style={{ marginTop:12, padding:'10px 14px', background:'rgba(var(--tm-loss-rgb,255,59,48),0.06)', border:'1px solid rgba(var(--tm-loss-rgb,255,59,48),0.2)', borderRadius:8, fontSize:12, color:'var(--tm-loss)' }}>⚠️ {importError}</div>
        )}
        {importDone && importStats && (
          <div style={{ marginTop:12, padding:'12px 16px', background:'rgba(var(--tm-profit-rgb,34,199,89),0.06)', border:'1px solid rgba(var(--tm-profit-rgb,34,199,89),0.2)', borderRadius:10, animation:'fadeIn 0.3s ease-out' }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--tm-profit)', marginBottom:4 }}>✓ Import réussi</div>
            <div style={{ fontSize:11, color:'var(--tm-text-secondary)' }}>{Object.entries(importStats).map(([k, v]) => `${v} ${k}`).join(' · ')}</div>
          </div>
        )}
      </Section>

      {/* ── Contact ─────────────────────────────────────────────────── */}
      <Section title="Contact & Communauté" icon="💬">
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {[
            { icon:'💬', label:'Discord', value:'Rejoindre la communauté', href:'https://discord.gg/SqfMCVtEhV', color:'#5865F2' },
            { icon:'🌐', label:'Site internet', value:'trademindsetapp.com', href:'https://trademindsetapp.com', color:'var(--tm-accent)' },
            { icon:'📧', label:'Email', value:'trademindsetapp@gmail.com', href:'mailto:trademindsetapp@gmail.com', color:'var(--tm-profit)' },
          ].map(({ icon, label, value, href, color }) => (
            <a key={label} href={href} target="_blank" rel="noopener noreferrer"
              style={{ display:'flex', alignItems:'center', gap:14, padding:'12px 16px', background:'rgba(255,255,255,0.02)', border:'1px solid #1E2330', borderRadius:12, textDecoration:'none', transition:'all 0.15s', cursor:'pointer' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = color + '60'; (e.currentTarget as HTMLElement).style.background = color + '08' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--tm-border-sub)'; (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)' }}>
              <div style={{ width:36, height:36, borderRadius:10, background:`${color}15`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, flexShrink:0 }}>{icon}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--tm-text-primary)' }}>{label}</div>
                <div style={{ fontSize:11, color:'var(--tm-text-secondary)' }}>{value}</div>
              </div>
              <div style={{ fontSize:14, color:'var(--tm-text-muted)' }}>→</div>
            </a>
          ))}
        </div>
      </Section>

      {/* ── App Info (simplifié) ──────────────────────────────────────── */}
      <Section title="Application" icon="📱">
        <div style={{ display:'flex', gap:20 }}>
          {[
            { label:'Version', value:'1.1.0' },
            { label:'IA', value:'GPT-4o / GPT-4o-mini' },
          ].map(({ label, value }) => (
            <div key={label} style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:12, color:'var(--tm-text-muted)' }}>{label}</span>
              <span style={{ fontSize:12, fontWeight:600, color:'var(--tm-text-secondary)', fontFamily:'JetBrains Mono,monospace' }}>{value}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Zone dangereuse ───────────────────────────────────────────── */}
      <Section title="Zone dangereuse" subtitle="Actions irréversibles" icon="⚠️">
        {/* ── Supprimer les données ── */}
        <div style={{ marginBottom:16 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
            <div>
              <div style={{ fontSize:13, fontWeight:600, color:'var(--tm-text-primary)' }}>Supprimer les données</div>
              <div style={{ fontSize:11, color:'var(--tm-text-muted)' }}>Supprime tous vos trades, systèmes, moods et exchanges. Votre compte reste actif.</div>
            </div>
          </div>
          {!confirmDeleteData ? (
            <button onClick={() => setConfirmDeleteData(true)} style={{
              width:'100%', padding:'10px', borderRadius:10,
              border:'1px solid rgba(var(--tm-warning-rgb,255,149,0),0.3)', background:'rgba(var(--tm-warning-rgb,255,149,0),0.06)',
              color:'var(--tm-warning)', fontSize:12, fontWeight:600, cursor:'pointer',
            }}>
              🗑 Supprimer toutes les données
            </button>
          ) : (
            <div style={{ padding:'14px', background:'rgba(var(--tm-warning-rgb,255,149,0),0.06)', border:'1px solid rgba(var(--tm-warning-rgb,255,149,0),0.3)', borderRadius:12, animation:'fadeIn 0.2s ease-out' }}>
              <div style={{ fontSize:12, color:'var(--tm-warning)', fontWeight:700, marginBottom:8 }}>⚠️ Confirmer la suppression des données</div>
              <div style={{ fontSize:11, color:'var(--tm-text-secondary)', marginBottom:12, lineHeight:1.6 }}>
                Tous vos trades, systèmes, moods et exchanges seront définitivement supprimés. Votre compte restera actif. Exportez vos données avant si nécessaire.
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={handleDeleteData} disabled={deletingData} style={{
                  flex:1, padding:'9px', borderRadius:8,
                  background: deletingData ? 'var(--tm-bg-tertiary)' : 'rgba(var(--tm-warning-rgb,255,149,0),0.15)',
                  border:'1px solid rgba(var(--tm-warning-rgb,255,149,0),0.5)', color: deletingData ? 'var(--tm-text-muted)' : 'var(--tm-warning)',
                  fontSize:12, fontWeight:700, cursor: deletingData ? 'not-allowed' : 'pointer',
                }}>
                  {deletingData ? deleteDataProgress || 'Suppression...' : 'Confirmer la suppression'}
                </button>
                <button onClick={() => setConfirmDeleteData(false)} style={{ padding:'9px 16px', borderRadius:8, background:'transparent', border:'1px solid #2A2F3E', color:'var(--tm-text-muted)', fontSize:12, cursor:'pointer' }}>Annuler</button>
              </div>
            </div>
          )}
        </div>

        {/* ── Supprimer le compte ── */}
        <div>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
            <div>
              <div style={{ fontSize:13, fontWeight:600, color:'var(--tm-text-primary)' }}>Supprimer le compte</div>
              <div style={{ fontSize:11, color:'var(--tm-text-muted)' }}>Supprime définitivement votre compte Firebase et toutes vos données associées.</div>
            </div>
          </div>
          {!confirmDeleteAccount ? (
            <button onClick={() => setConfirmDeleteAccount(true)} style={{
              width:'100%', padding:'10px', borderRadius:10,
              border:'1px solid rgba(var(--tm-loss-rgb,255,59,48),0.3)', background:'rgba(var(--tm-loss-rgb,255,59,48),0.06)',
              color:'var(--tm-loss)', fontSize:12, fontWeight:600, cursor:'pointer',
            }}>
              ☠️ Supprimer mon compte définitivement
            </button>
          ) : (
            <div style={{ padding:'14px', background:'rgba(var(--tm-loss-rgb,255,59,48),0.06)', border:'1px solid rgba(var(--tm-loss-rgb,255,59,48),0.3)', borderRadius:12, animation:'fadeIn 0.2s ease-out' }}>
              <div style={{ fontSize:12, color:'var(--tm-loss)', fontWeight:700, marginBottom:8 }}>☠️ Suppression définitive du compte</div>
              <div style={{ fontSize:11, color:'var(--tm-text-secondary)', marginBottom:12, lineHeight:1.6 }}>
                Cette action est irréversible. Votre compte Firebase sera supprimé ainsi que toutes vos données (trades, systèmes, moods, exchanges). Vous serez automatiquement déconnecté.
              </div>
              {isEmailUser && (
                <div style={{ marginBottom:12 }}>
                  <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:4 }}>MOT DE PASSE (confirmation)</div>
                  <input type="password" value={deleteAccountPassword} onChange={e => setDeleteAccountPassword(e.target.value)}
                    placeholder="Votre mot de passe" style={{
                      width:'100%', padding:'8px 12px', borderRadius:8, border:'1px solid #2A2F3E',
                      background:'var(--tm-bg-tertiary)', color:'var(--tm-text-primary)', fontSize:13, outline:'none', boxSizing:'border-box',
                    }} />
                </div>
              )}
              {deleteAccountError && (
                <div style={{ padding:'8px 12px', background:'rgba(var(--tm-loss-rgb,255,59,48),0.1)', border:'1px solid rgba(var(--tm-loss-rgb,255,59,48),0.3)', borderRadius:8, marginBottom:12, fontSize:11, color:'var(--tm-loss)' }}>
                  {deleteAccountError}
                </div>
              )}
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={handleDeleteAccount} disabled={deletingAccount || (isEmailUser && !deleteAccountPassword)} style={{
                  flex:1, padding:'9px', borderRadius:8,
                  background: deletingAccount ? 'var(--tm-bg-tertiary)' : 'rgba(var(--tm-loss-rgb,255,59,48),0.15)',
                  border:'1px solid rgba(var(--tm-loss-rgb,255,59,48),0.5)', color: deletingAccount ? 'var(--tm-text-muted)' : 'var(--tm-loss)',
                  fontSize:12, fontWeight:700, cursor: (deletingAccount || (isEmailUser && !deleteAccountPassword)) ? 'not-allowed' : 'pointer',
                }}>
                  {deletingAccount ? deleteAccountProgress || 'Suppression...' : 'Supprimer mon compte'}
                </button>
                <button onClick={() => { setConfirmDeleteAccount(false); setDeleteAccountError(''); setDeleteAccountPassword('') }} style={{ padding:'9px 16px', borderRadius:8, background:'transparent', border:'1px solid #2A2F3E', color:'var(--tm-text-muted)', fontSize:12, cursor:'pointer' }}>Annuler</button>
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* Footer */}
      <div style={{ textAlign:'center', padding:'20px 0 40px', fontSize:11, color:'var(--tm-text-muted)' }}>
        TradeMindset · trademindsetapp@gmail.com · {new Date().getFullYear()}
      </div>
    </div>
  )
}
