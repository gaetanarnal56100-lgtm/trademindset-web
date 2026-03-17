// src/pages/auth/SignUpPage.tsx
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { signUpWithEmail, signInWithGoogle } from '@/services/firebase/auth'
import { IconEye, IconEyeOff, IconGoogle } from '@/components/ui/Icons'

export default function SignUpPage() {
  const navigate = useNavigate()
  const [name,    setName]    = useState('')
  const [email,   setEmail]   = useState('')
  const [password,setPassword]= useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) { toast.error('Mot de passe trop court (8 caractères min)'); return }
    setLoading(true)
    try {
      await signUpWithEmail(email, password, name)
      toast.success('Compte créé ! Vérifiez votre email.')
      navigate('/')
    } catch (err: unknown) {
      toast.error((err as Error).message ?? 'Erreur inscription')
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogle() {
    setLoading(true)
    try {
      await signInWithGoogle()
      navigate('/')
    } catch (err: unknown) {
      toast.error((err as Error).message ?? 'Erreur Google')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card animate-slide-up space-y-5">
      <div>
        <h1 className="text-xl font-bold text-text-primary font-display">Créer un compte</h1>
        <p className="text-sm text-text-secondary mt-1">Commencez à tracker vos trades</p>
      </div>

      <button
        onClick={handleGoogle} disabled={loading}
        className="w-full flex items-center justify-center gap-3 bg-bg-tertiary border border-border text-text-primary text-sm font-medium py-2.5 rounded-lg hover:bg-bg-secondary transition-colors disabled:opacity-50"
      >
        <IconGoogle size={18} />
        Continuer avec Google
      </button>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-text-tertiary">ou</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="input-label">Prénom / Pseudo</label>
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            className="input" placeholder="Votre nom" required
          />
        </div>
        <div>
          <label className="input-label">Email</label>
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            className="input" placeholder="trader@email.com" required
          />
        </div>
        <div>
          <label className="input-label">Mot de passe</label>
          <div className="relative">
            <input
              type={showPwd ? 'text' : 'password'}
              value={password} onChange={e => setPassword(e.target.value)}
              className="input pr-10" placeholder="8 caractères minimum" required minLength={8}
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
          {loading ? 'Création...' : 'Créer mon compte'}
        </button>
      </form>

      <p className="text-center text-sm text-text-secondary">
        Déjà un compte ?{' '}
        <Link to="/login" className="text-brand-cyan hover:underline font-medium">
          Se connecter
        </Link>
      </p>
    </div>
  )
}
