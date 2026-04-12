// src/pages/auth/SignUpPage.tsx
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { signUpWithEmail, signInWithGoogle } from '@/services/firebase/auth'
import { IconEye, IconEyeOff, IconGoogle } from '@/components/ui/Icons'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '@/services/firebase/config'
import { useLanguage } from '@/contexts/LanguageContext'
import type { Lang } from '@/i18n/config'

const fbFn = getFunctions(app, 'europe-west1')

// ── Sélecteur de langue ───────────────────────────────────────────────────

function LangToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  const btnStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px',
    borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700,
    background: active ? 'rgba(0,229,255,0.12)' : 'transparent',
    color: active ? '#00E5FF' : 'var(--tm-text-muted)',
    outline: active ? '1px solid rgba(0,229,255,0.35)' : '1px solid transparent',
    transition: 'all 0.15s',
  })
  return (
    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginBottom: 12 }}>
      <button type="button" onClick={() => setLang('fr')} style={btnStyle(lang === 'fr')}>
        🇫🇷 FR
      </button>
      <button type="button" onClick={() => setLang('en')} style={btnStyle(lang === 'en')}>
        🇬🇧 EN
      </button>
    </div>
  )
}

export default function SignUpPage() {
  const { t } = useTranslation()
  const { lang, setLang } = useLanguage()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const refCode = searchParams.get('ref') || ''
  const [name,    setName]    = useState('')
  const [email,   setEmail]   = useState('')
  const [password,setPassword]= useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) { toast.error(t('auth.passwordTooShort')); return }
    setLoading(true)
    try {
      await signUpWithEmail(email, password, name, lang)
      if (refCode) {
        try {
          const fn = httpsCallable(fbFn, 'processReferral')
          await fn({ code: refCode })
        } catch { /* referral errors don't block signup */ }
      }
      try {
        const genFn = httpsCallable(fbFn, 'generateUserReferralCode')
        await genFn()
      } catch { /* non-blocking */ }
      toast.success(t('auth.accountCreated'))
      navigate('/app')
    } catch (err: unknown) {
      toast.error((err as Error).message ?? t('auth.signupError'))
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogle() {
    setLoading(true)
    try {
      await signInWithGoogle()
      if (refCode) {
        try {
          const fn = httpsCallable(fbFn, 'processReferral')
          await fn({ code: refCode })
        } catch { /* non-blocking */ }
      }
      try {
        const genFn = httpsCallable(fbFn, 'generateUserReferralCode')
        await genFn()
      } catch { /* non-blocking */ }
      navigate('/app')
    } catch (err: unknown) {
      toast.error((err as Error).message ?? t('auth.googleError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card animate-slide-up space-y-5">
      <LangToggle lang={lang} setLang={setLang} />

      <div>
        <h1 className="text-xl font-bold text-text-primary font-display">{t('auth.createAccount')}</h1>
        <p className="text-sm text-text-secondary mt-1">{t('auth.startTracking')}</p>
        {refCode && (
          <div style={{ marginTop: 8, padding: '6px 12px', background: 'rgba(0,229,255,0.08)', border: '1px solid rgba(0,229,255,0.25)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14 }}>🎁</span>
            <span style={{ fontSize: 12, color: '#00E5FF', fontWeight: 600 }}>{t('auth.referralActive')} <span style={{ fontFamily: 'monospace' }}>{refCode}</span></span>
          </div>
        )}
      </div>

      <button
        onClick={handleGoogle} disabled={loading}
        className="w-full flex items-center justify-center gap-3 bg-bg-tertiary border border-border text-text-primary text-sm font-medium py-2.5 rounded-lg hover:bg-bg-secondary transition-colors disabled:opacity-50"
      >
        <IconGoogle size={18} />
        {t('auth.continueWithGoogle')}
      </button>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-text-tertiary">{t('auth.or')}</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="input-label">{t('auth.firstName')}</label>
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            className="input" placeholder={t('auth.yourName')} required
          />
        </div>
        <div>
          <label className="input-label">{t('auth.email')}</label>
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            className="input" placeholder="trader@email.com" required
          />
        </div>
        <div>
          <label className="input-label">{t('auth.password')}</label>
          <div className="relative">
            <input
              type={showPwd ? 'text' : 'password'}
              value={password} onChange={e => setPassword(e.target.value)}
              className="input pr-10" placeholder={t('auth.passwordMin')} required minLength={8}
            />
            <button
              type="button" onClick={() => setShowPwd(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
            >
              {showPwd ? <IconEyeOff size={16} /> : <IconEye size={16} />}
            </button>
          </div>
        </div>

        <button
          type="submit" disabled={loading}
          className="btn-primary w-full py-2.5 justify-center flex items-center gap-2"
        >
          {loading && (
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          )}
          {loading ? t('auth.creating') : t('auth.createButton')}
        </button>
      </form>

      <p className="text-center text-sm text-text-secondary">
        {t('auth.alreadyAccount')}{' '}
        <Link to="/login" className="text-brand-cyan hover:underline font-medium">
          {t('auth.loginLink')}
        </Link>
      </p>
    </div>
  )
}
