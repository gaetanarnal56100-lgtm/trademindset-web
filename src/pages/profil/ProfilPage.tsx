// ProfilPage.tsx — Profil complet : photo, identité, email, mdp, préférences trading, objectifs
import { useState, useEffect, useRef } from 'react'
import { getAuth, updateProfile, updateEmail, updatePassword, sendEmailVerification, reauthenticateWithCredential, EmailAuthProvider, type User } from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/services/firebase/config'

// ── Types ────────────────────────────────────────────────────────────────
interface TradingPrefs {
  startingCapital: number
  currency: string
  defaultMarket: string
  defaultSession: string
  timezone: string
  riskPerTrade: number       // % du capital
  maxDailyLoss: number       // % du capital
  targetWinRate: number      // %
  targetMonthlyPnL: number   // en devise
  tradingDays: string[]      // ['lun','mar',...]
  bio: string
}

const DEFAULT_PREFS: TradingPrefs = {
  startingCapital: 1000,
  currency: 'USD',
  defaultMarket: 'Crypto',
  defaultSession: 'London',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  riskPerTrade: 1,
  maxDailyLoss: 3,
  targetWinRate: 55,
  targetMonthlyPnL: 500,
  tradingDays: ['lun','mar','mer','jeu','ven'],
  bio: '',
}

const MARKETS = ['Crypto','Forex','Actions','Indices','Matières premières','Futures']
const SESSIONS = ['Asie','London','New York','Toutes']
const CURRENCIES = ['USD','EUR','GBP','CHF','JPY','CAD','AUD']
const DAYS = [
  { id:'lun', label:'L' }, { id:'mar', label:'M' }, { id:'mer', label:'M' },
  { id:'jeu', label:'J' }, { id:'ven', label:'V' }, { id:'sam', label:'S' }, { id:'dim', label:'D' },
]

// ── Section ──────────────────────────────────────────────────────────────
function Section({ title, subtitle, icon, children, badge }: { title:string; subtitle?:string; icon:string; children:React.ReactNode; badge?:React.ReactNode }) {
  return (
    <div style={{ background:'var(--tm-bg-secondary)', border:'1px solid #1E2330', borderRadius:16, overflow:'hidden', marginBottom:16 }}>
      <div style={{ padding:'16px 20px', borderBottom:'1px solid #1E2330', display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ width:36, height:36, borderRadius:10, background:'rgba(var(--tm-accent-rgb,0,229,255),0.08)', border:'1px solid rgba(var(--tm-accent-rgb,0,229,255),0.15)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>{icon}</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14, fontWeight:700, color:'var(--tm-text-primary)' }}>{title}</div>
          {subtitle && <div style={{ fontSize:11, color:'var(--tm-text-muted)' }}>{subtitle}</div>}
        </div>
        {badge}
      </div>
      <div style={{ padding:'16px 20px' }}>{children}</div>
    </div>
  )
}

// ── Field row ────────────────────────────────────────────────────────────
function Field({ label, children }: { label:string; children:React.ReactNode }) {
  return (
    <div style={{ marginBottom:14 }}>
      <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'0.08em', fontWeight:600 }}>{label}</div>
      {children}
    </div>
  )
}

function Input({ value, onChange, placeholder, type='text', disabled=false }: { value:string|number; onChange:(v:string)=>void; placeholder?:string; type?:string; disabled?:boolean }) {
  return (
    <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} disabled={disabled}
      style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:'1px solid #2A2F3E', background:disabled?'var(--tm-bg)':'var(--tm-bg-tertiary)', color:disabled?'var(--tm-text-muted)':'var(--tm-text-primary)', fontSize:13, outline:'none', boxSizing:'border-box' as const, fontFamily:'inherit' }} />
  )
}

function SaveBtn({ onClick, saving, saved, label='Enregistrer' }: { onClick:()=>void; saving:boolean; saved:boolean; label?:string }) {
  return (
    <button onClick={onClick} disabled={saving} style={{
      padding:'8px 20px', borderRadius:10, fontSize:12, fontWeight:700, cursor:saving?'not-allowed':'pointer',
      border: saved ? '1px solid rgba(var(--tm-profit-rgb,34,199,89),0.4)' : '1px solid rgba(var(--tm-accent-rgb,0,229,255),0.3)',
      background: saved ? 'rgba(var(--tm-profit-rgb,34,199,89),0.1)' : saving ? 'var(--tm-bg-tertiary)' : 'rgba(var(--tm-accent-rgb,0,229,255),0.1)',
      color: saved ? 'var(--tm-profit)' : saving ? 'var(--tm-text-muted)' : 'var(--tm-accent)',
      display:'flex', alignItems:'center', gap:6,
    }}>
      {saving ? <div style={{ width:12, height:12, border:'2px solid #3D4254', borderTopColor:'var(--tm-accent)', borderRadius:'50%', animation:'spin 0.7s linear infinite' }}/> : null}
      {saved ? '✓ Sauvegardé' : saving ? 'Enregistrement...' : label}
    </button>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────
export default function ProfilPage() {
  const auth = getAuth()
  const user = auth.currentUser
  const fileRef = useRef<HTMLInputElement>(null)

  // Profile fields
  const [displayName, setDisplayName] = useState(user?.displayName || '')
  const [photoURL, setPhotoURL] = useState(user?.photoURL || '')
  const [photoPreview, setPhotoPreview] = useState(user?.photoURL || '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [savedProfile, setSavedProfile] = useState(false)

  // Email change
  const [newEmail, setNewEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [emailStatus, setEmailStatus] = useState<'idle'|'saving'|'done'|'error'>('idle')
  const [emailError, setEmailError] = useState('')

  // Password change
  const [currentPwd, setCurrentPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [pwdStatus, setPwdStatus] = useState<'idle'|'saving'|'done'|'error'>('idle')
  const [pwdError, setPwdError] = useState('')

  // Trading preferences
  const [prefs, setPrefs] = useState<TradingPrefs>(DEFAULT_PREFS)
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [savedPrefs, setSavedPrefs] = useState(false)
  const [loadingPrefs, setLoadingPrefs] = useState(true)

  // Member since
  const [memberSince, setMemberSince] = useState<Date|null>(null)

  // Load prefs from Firestore
  useEffect(() => {
    if (!user) return
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid))
        if (snap.exists()) {
          const d = snap.data()
          if (d.tradingPrefs) setPrefs({ ...DEFAULT_PREFS, ...d.tradingPrefs })
          if (d.photoBase64) { setPhotoURL(d.photoBase64); setPhotoPreview(d.photoBase64) }
          if (d.createdAt?.toDate) setMemberSince(d.createdAt.toDate())
        }
      } catch {/**/}
      setLoadingPrefs(false)
    })()
  }, [user])

  // ── Save profile (name + photo) ────────────────────────────────────
  const saveProfile = async () => {
    if (!user) return
    setSavingProfile(true); setSavedProfile(false)
    try {
      await updateProfile(user, { displayName, photoURL: photoURL.startsWith('data:') ? undefined : photoURL })
      await setDoc(doc(db, 'users', user.uid), {
        displayName,
        photoBase64: photoURL.startsWith('data:') ? photoURL : null,
        photoURL: photoURL.startsWith('data:') ? null : photoURL,
        updatedAt: serverTimestamp(),
      }, { merge:true })
      setSavedProfile(true)
      setTimeout(() => setSavedProfile(false), 3000)
    } catch (e) { alert((e as Error).message) }
    setSavingProfile(false)
  }

  // ── Photo upload ───────────────────────────────────────────────────
  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 500_000) { alert('Image trop lourde (max 500 Ko)'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const b64 = reader.result as string
      setPhotoURL(b64)
      setPhotoPreview(b64)
    }
    reader.readAsDataURL(file)
  }

  // ── Change email ───────────────────────────────────────────────────
  const handleEmailChange = async () => {
    if (!user || !newEmail) return
    setEmailStatus('saving'); setEmailError('')
    try {
      if (user.email) {
        const cred = EmailAuthProvider.credential(user.email, emailPassword)
        await reauthenticateWithCredential(user, cred)
      }
      await updateEmail(user, newEmail)
      await sendEmailVerification(user)
      await setDoc(doc(db, 'users', user.uid), { email:newEmail, updatedAt:serverTimestamp() }, { merge:true })
      setEmailStatus('done'); setNewEmail(''); setEmailPassword('')
    } catch (e) {
      const code = (e as any)?.code
      setEmailError(
        code === 'auth/wrong-password' ? 'Mot de passe incorrect' :
        code === 'auth/email-already-in-use' ? 'Cet email est déjà utilisé' :
        code === 'auth/invalid-email' ? 'Email invalide' :
        code === 'auth/requires-recent-login' ? 'Reconnectez-vous puis réessayez' :
        (e as Error).message
      )
      setEmailStatus('error')
    }
  }

  // ── Change password ────────────────────────────────────────────────
  const handlePasswordChange = async () => {
    if (!user) return
    if (newPwd !== confirmPwd) { setPwdError('Les mots de passe ne correspondent pas'); setPwdStatus('error'); return }
    if (newPwd.length < 6) { setPwdError('Minimum 6 caractères'); setPwdStatus('error'); return }
    setPwdStatus('saving'); setPwdError('')
    try {
      if (user.email) {
        const cred = EmailAuthProvider.credential(user.email, currentPwd)
        await reauthenticateWithCredential(user, cred)
      }
      await updatePassword(user, newPwd)
      setPwdStatus('done'); setCurrentPwd(''); setNewPwd(''); setConfirmPwd('')
    } catch (e) {
      const code = (e as any)?.code
      setPwdError(code === 'auth/wrong-password' ? 'Mot de passe actuel incorrect' : (e as Error).message)
      setPwdStatus('error')
    }
  }

  // ── Save trading prefs ─────────────────────────────────────────────
  const savePrefs = async () => {
    if (!user) return
    setSavingPrefs(true); setSavedPrefs(false)
    try {
      await setDoc(doc(db, 'users', user.uid), { tradingPrefs:prefs, updatedAt:serverTimestamp() }, { merge:true })
      setSavedPrefs(true)
      setTimeout(() => setSavedPrefs(false), 3000)
    } catch (e) { alert((e as Error).message) }
    setSavingPrefs(false)
  }

  const updatePref = <K extends keyof TradingPrefs>(key:K, val:TradingPrefs[K]) => {
    setPrefs(p => ({ ...p, [key]:val }))
  }

  const isEmailUser = user?.providerData.some(p => p.providerId === 'password')

  return (
    <div style={{ minHeight:'100vh', background:'var(--tm-bg)', padding:'32px 24px', maxWidth:800, margin:'0 auto' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}`}</style>

      <div style={{ marginBottom:28 }}>
        <h1 style={{ fontSize:24, fontWeight:700, color:'var(--tm-text-primary)', margin:0, fontFamily:'Syne,sans-serif' }}>Profil</h1>
        <p style={{ fontSize:13, color:'var(--tm-text-muted)', margin:'4px 0 0' }}>Identité · Préférences · Objectifs</p>
      </div>

      {/* ── Photo + Identité ─────────────────────────────────────────── */}
      <Section title="Identité" subtitle="Photo, nom d'affichage" icon="👤"
        badge={<SaveBtn onClick={saveProfile} saving={savingProfile} saved={savedProfile} />}>
        <div style={{ display:'flex', gap:20, alignItems:'flex-start', flexWrap:'wrap' }}>
          {/* Photo */}
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
            <div onClick={() => fileRef.current?.click()} style={{
              width:80, height:80, borderRadius:'50%', cursor:'pointer', overflow:'hidden',
              background:'linear-gradient(135deg,#00E5FF,#0A85FF)', display:'flex', alignItems:'center', justifyContent:'center',
              border:'3px solid #2A2F3E', position:'relative',
            }}>
              {photoPreview ? (
                <img src={photoPreview} alt="avatar" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
              ) : (
                <span style={{ fontSize:32, fontWeight:700, color:'var(--tm-bg)' }}>
                  {displayName?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'}
                </span>
              )}
              <div style={{ position:'absolute', bottom:0, right:0, width:24, height:24, borderRadius:'50%', background:'var(--tm-bg-secondary)', border:'2px solid #2A2F3E', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11 }}>📷</div>
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display:'none' }} onChange={handlePhoto} />
            <div style={{ fontSize:9, color:'var(--tm-text-muted)' }}>Max 500 Ko</div>
            {photoPreview && (
              <button onClick={() => { setPhotoURL(''); setPhotoPreview('') }} style={{ fontSize:10, color:'var(--tm-loss)', background:'none', border:'none', cursor:'pointer' }}>Supprimer</button>
            )}
          </div>

          {/* Name + info */}
          <div style={{ flex:1, minWidth:200 }}>
            <Field label="Nom d'affichage">
              <Input value={displayName} onChange={setDisplayName} placeholder="Votre nom" />
            </Field>
            <Field label="Email">
              <Input value={user?.email || ''} onChange={() => {}} disabled />
            </Field>
            {memberSince && (
              <div style={{ fontSize:11, color:'var(--tm-text-muted)', display:'flex', alignItems:'center', gap:6 }}>
                <span>📅</span> Membre depuis {memberSince.toLocaleDateString('fr-FR', { month:'long', year:'numeric' })}
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* ── Bio ──────────────────────────────────────────────────────── */}
      <Section title="Bio" subtitle="Décrivez-vous en tant que trader" icon="✍️">
        <textarea value={prefs.bio} onChange={e => updatePref('bio', e.target.value)}
          placeholder="Ex: Trader crypto day-trading, spécialisé en BTC/ETH. J'utilise le Price Action et le Volume Profile..."
          rows={3} style={{
            width:'100%', padding:'10px 12px', borderRadius:8, border:'1px solid #2A2F3E',
            background:'var(--tm-bg-tertiary)', color:'var(--tm-text-primary)', fontSize:13, outline:'none', resize:'vertical',
            boxSizing:'border-box', fontFamily:'inherit', lineHeight:1.6,
          }} />
      </Section>

      {/* ── Changer Email ────────────────────────────────────────────── */}
      {isEmailUser && (
        <Section title="Changer l'email" subtitle="Un email de vérification sera envoyé" icon="📧">
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
            <Field label="Nouvel email">
              <Input value={newEmail} onChange={setNewEmail} placeholder="nouveau@email.com" type="email" />
            </Field>
            <Field label="Mot de passe actuel">
              <Input value={emailPassword} onChange={setEmailPassword} placeholder="••••••••" type="password" />
            </Field>
          </div>
          {emailError && <div style={{ fontSize:11, color:'var(--tm-loss)', marginBottom:8, padding:'6px 10px', background:'rgba(var(--tm-loss-rgb,255,59,48),0.06)', borderRadius:6 }}>{emailError}</div>}
          {emailStatus === 'done' && <div style={{ fontSize:11, color:'var(--tm-profit)', marginBottom:8, padding:'6px 10px', background:'rgba(var(--tm-profit-rgb,34,199,89),0.06)', borderRadius:6 }}>✓ Email modifié — vérifiez votre boîte mail</div>}
          <button onClick={handleEmailChange} disabled={emailStatus === 'saving' || !newEmail || !emailPassword} style={{
            padding:'8px 20px', borderRadius:10, fontSize:12, fontWeight:600, cursor:(!newEmail||!emailPassword)?'not-allowed':'pointer',
            border:'1px solid rgba(var(--tm-accent-rgb,0,229,255),0.3)', background:'rgba(var(--tm-accent-rgb,0,229,255),0.1)', color:(!newEmail||!emailPassword)?'var(--tm-text-muted)':'var(--tm-accent)',
          }}>
            {emailStatus === 'saving' ? 'Modification...' : 'Modifier l\'email'}
          </button>
        </Section>
      )}

      {/* ── Changer Mot de passe ──────────────────────────────────────── */}
      {isEmailUser && (
        <Section title="Changer le mot de passe" icon="🔒">
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:12 }}>
            <Field label="Mot de passe actuel">
              <Input value={currentPwd} onChange={setCurrentPwd} placeholder="••••••••" type="password" />
            </Field>
            <Field label="Nouveau mot de passe">
              <Input value={newPwd} onChange={setNewPwd} placeholder="Min. 6 caractères" type="password" />
            </Field>
            <Field label="Confirmer">
              <Input value={confirmPwd} onChange={setConfirmPwd} placeholder="••••••••" type="password" />
            </Field>
          </div>
          {pwdError && <div style={{ fontSize:11, color:'var(--tm-loss)', marginBottom:8, padding:'6px 10px', background:'rgba(var(--tm-loss-rgb,255,59,48),0.06)', borderRadius:6 }}>{pwdError}</div>}
          {pwdStatus === 'done' && <div style={{ fontSize:11, color:'var(--tm-profit)', marginBottom:8, padding:'6px 10px', background:'rgba(var(--tm-profit-rgb,34,199,89),0.06)', borderRadius:6 }}>✓ Mot de passe modifié</div>}
          <button onClick={handlePasswordChange} disabled={pwdStatus === 'saving' || !currentPwd || !newPwd || !confirmPwd} style={{
            padding:'8px 20px', borderRadius:10, fontSize:12, fontWeight:600, cursor:(!currentPwd||!newPwd)?'not-allowed':'pointer',
            border:'1px solid rgba(var(--tm-accent-rgb,0,229,255),0.3)', background:'rgba(var(--tm-accent-rgb,0,229,255),0.1)', color:(!currentPwd||!newPwd)?'var(--tm-text-muted)':'var(--tm-accent)',
          }}>
            {pwdStatus === 'saving' ? 'Modification...' : 'Modifier le mot de passe'}
          </button>
        </Section>
      )}

      {/* ── Préférences de Trading ────────────────────────────────────── */}
      <Section title="Préférences de Trading" subtitle="Capital, marché, session" icon="📊"
        badge={<SaveBtn onClick={savePrefs} saving={savingPrefs} saved={savedPrefs} />}>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
          <Field label="Capital de départ">
            <div style={{ display:'flex', gap:8 }}>
              <Input value={prefs.startingCapital} onChange={v => updatePref('startingCapital', Number(v) || 0)} type="number" />
              <select value={prefs.currency} onChange={e => updatePref('currency', e.target.value)}
                style={{ width:80, padding:'9px 8px', borderRadius:8, border:'1px solid #2A2F3E', background:'var(--tm-bg-tertiary)', color:'var(--tm-text-primary)', fontSize:13, cursor:'pointer' }}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </Field>

          <Field label="Marché principal">
            <select value={prefs.defaultMarket} onChange={e => updatePref('defaultMarket', e.target.value)}
              style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:'1px solid #2A2F3E', background:'var(--tm-bg-tertiary)', color:'var(--tm-text-primary)', fontSize:13, cursor:'pointer' }}>
              {MARKETS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>

          <Field label="Session par défaut">
            <select value={prefs.defaultSession} onChange={e => updatePref('defaultSession', e.target.value)}
              style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:'1px solid #2A2F3E', background:'var(--tm-bg-tertiary)', color:'var(--tm-text-primary)', fontSize:13, cursor:'pointer' }}>
              {SESSIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>

          <Field label="Fuseau horaire">
            <Input value={prefs.timezone} onChange={v => updatePref('timezone', v)} placeholder="Europe/Paris" />
          </Field>
        </div>

        {/* Trading days */}
        <Field label="Jours de trading">
          <div style={{ display:'flex', gap:6 }}>
            {DAYS.map(d => {
              const active = prefs.tradingDays.includes(d.id)
              return (
                <button key={d.id} onClick={() => updatePref('tradingDays', active ? prefs.tradingDays.filter(x=>x!==d.id) : [...prefs.tradingDays, d.id])}
                  style={{
                    width:36, height:36, borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer',
                    border:`1px solid ${active ? 'var(--tm-accent)' : 'var(--tm-border)'}`,
                    background: active ? 'rgba(var(--tm-accent-rgb,0,229,255),0.12)' : 'transparent',
                    color: active ? 'var(--tm-accent)' : 'var(--tm-text-muted)',
                  }}>{d.label}</button>
              )
            })}
          </div>
        </Field>
      </Section>

      {/* ── Risk Management ───────────────────────────────────────────── */}
      <Section title="Gestion du Risque" subtitle="Limites et règles de protection" icon="🛡️"
        badge={<SaveBtn onClick={savePrefs} saving={savingPrefs} saved={savedPrefs} />}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
          <Field label="Risque par trade (% du capital)">
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <input type="range" min={0.1} max={5} step={0.1} value={prefs.riskPerTrade}
                onChange={e => updatePref('riskPerTrade', Number(e.target.value))}
                style={{ flex:1, accentColor:'var(--tm-warning)' }} />
              <span style={{ fontSize:14, fontWeight:700, color:'var(--tm-warning)', fontFamily:'JetBrains Mono,monospace', minWidth:40, textAlign:'right' }}>{prefs.riskPerTrade}%</span>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:'var(--tm-text-muted)', marginTop:2 }}>
              <span>Conservateur</span><span>Agressif</span>
            </div>
          </Field>

          <Field label="Perte max journalière (% du capital)">
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <input type="range" min={1} max={10} step={0.5} value={prefs.maxDailyLoss}
                onChange={e => updatePref('maxDailyLoss', Number(e.target.value))}
                style={{ flex:1, accentColor:'var(--tm-loss)' }} />
              <span style={{ fontSize:14, fontWeight:700, color:'var(--tm-loss)', fontFamily:'JetBrains Mono,monospace', minWidth:40, textAlign:'right' }}>{prefs.maxDailyLoss}%</span>
            </div>
          </Field>
        </div>
      </Section>

      {/* ── Objectifs ─────────────────────────────────────────────────── */}
      <Section title="Objectifs" subtitle="Fixez vos targets mensuels" icon="🎯"
        badge={<SaveBtn onClick={savePrefs} saving={savingPrefs} saved={savedPrefs} />}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
          <Field label="Win Rate cible (%)">
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <input type="range" min={30} max={80} step={1} value={prefs.targetWinRate}
                onChange={e => updatePref('targetWinRate', Number(e.target.value))}
                style={{ flex:1, accentColor:'var(--tm-profit)' }} />
              <span style={{ fontSize:14, fontWeight:700, color:'var(--tm-profit)', fontFamily:'JetBrains Mono,monospace', minWidth:40, textAlign:'right' }}>{prefs.targetWinRate}%</span>
            </div>
          </Field>

          <Field label={`P&L mensuel cible (${prefs.currency})`}>
            <Input value={prefs.targetMonthlyPnL} onChange={v => updatePref('targetMonthlyPnL', Number(v) || 0)} type="number" />
          </Field>
        </div>

        {/* Visual target recap */}
        <div style={{ marginTop:14, padding:'14px 16px', background:'rgba(var(--tm-profit-rgb,34,199,89),0.04)', border:'1px solid rgba(var(--tm-profit-rgb,34,199,89),0.15)', borderRadius:12 }}>
          <div style={{ fontSize:10, color:'var(--tm-text-muted)', marginBottom:8, textTransform:'uppercase', letterSpacing:'0.08em' }}>Récapitulatif objectifs</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
            {[
              { label:'Capital', value:`${prefs.startingCapital.toLocaleString()} ${prefs.currency}`, color:'var(--tm-text-primary)' },
              { label:'Risque/trade', value:`${prefs.riskPerTrade}%`, color:'var(--tm-warning)' },
              { label:'Win Rate cible', value:`${prefs.targetWinRate}%`, color:'var(--tm-profit)' },
              { label:'P&L/mois', value:`${prefs.targetMonthlyPnL >= 0 ? '+' : ''}${prefs.targetMonthlyPnL} ${prefs.currency}`, color:'var(--tm-accent)' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ textAlign:'center' }}>
                <div style={{ fontSize:16, fontWeight:800, color, fontFamily:'JetBrains Mono,monospace' }}>{value}</div>
                <div style={{ fontSize:9, color:'var(--tm-text-muted)', marginTop:2 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Footer */}
      <div style={{ textAlign:'center', padding:'20px 0 40px', fontSize:11, color:'var(--tm-text-muted)' }}>
        TradeMindset v1.1 · trademindsetapp@gmail.com
      </div>
    </div>
  )
}
