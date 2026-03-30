// ─── ThemeContext ─────────────────────────────────────────────────────────────
// Système de thèmes avec :
//  • Application instantanée via data-theme sur <html>
//  • Cache localStorage (pas de flicker)
//  • Persistance Firestore dans users/{uid}/profile
//  • Verrouillage premium pour neon et midnight

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { getAuth } from 'firebase/auth'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/services/firebase/config'

// ─── Types ────────────────────────────────────────────────────────────────────
export type ThemeName = 'terminal' | 'neon' | 'midnight'

export interface ThemeConfig {
  id: ThemeName
  label: string
  description: string
  isPremium: boolean
  preview: {
    bg: string
    card: string
    accent: string
    profit: string
    loss: string
    text: string
  }
}

export const THEMES: ThemeConfig[] = [
  {
    id: 'terminal',
    label: 'Terminal',
    description: 'Thème sombre classique, focus maximum',
    isPremium: false,
    preview: { bg:'#0D1117', card:'#1C2133', accent:'#00E5FF', profit:'#22C759', loss:'#FF3B30', text:'#F0F3FF' },
  },
  {
    id: 'neon',
    label: 'Neon',
    description: 'Violet intense, accents électrisants',
    isPremium: true,
    preview: { bg:'#05010a', card:'#160b22', accent:'#c77dff', profit:'#39ff90', loss:'#ff2d6b', text:'#f1e8ff' },
  },
  {
    id: 'midnight',
    label: 'Midnight',
    description: 'Bleu profond, élégance nocturne',
    isPremium: true,
    preview: { bg:'#080c14', card:'#172035', accent:'#60a5fa', profit:'#34d399', loss:'#f87171', text:'#e8f0fe' },
  },
]

const STORAGE_KEY = 'trademindset:theme'
const DEFAULT_THEME: ThemeName = 'terminal'

// ─── Context ──────────────────────────────────────────────────────────────────
interface ThemeContextType {
  theme: ThemeName
  setTheme: (name: ThemeName) => void
  isPremium: boolean
}

const ThemeContext = createContext<ThemeContextType>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
  isPremium: false,
})

export function useTheme() {
  return useContext(ThemeContext)
}

// ─── Apply theme immediately to DOM ──────────────────────────────────────────
function applyThemeToDom(theme: ThemeName) {
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem(STORAGE_KEY, theme)
}

// ─── Read from localStorage synchronously (called before render) ──────────────
export function getStoredTheme(): ThemeName {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'terminal' || stored === 'neon' || stored === 'midnight') return stored
  return DEFAULT_THEME
}

// ─── Provider ─────────────────────────────────────────────────────────────────
interface ThemeProviderProps {
  children: ReactNode
  isPremium?: boolean
}

export function ThemeProvider({ children, isPremium = false }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeName>(getStoredTheme)

  // Apply on mount (handles SSR-style flicker prevention)
  useEffect(() => {
    applyThemeToDom(theme)
  }, []) // eslint-disable-line

  // If user logs out and was on premium theme → downgrade to terminal
  useEffect(() => {
    if (!isPremium) {
      const cfg = THEMES.find(t => t.id === theme)
      if (cfg?.isPremium) {
        applyThemeToDom('terminal')
        setThemeState('terminal')
      }
    }
  }, [isPremium]) // eslint-disable-line

  const setTheme = useCallback((name: ThemeName) => {
    const cfg = THEMES.find(t => t.id === name)
    if (!cfg) return

    // Premium guard
    if (cfg.isPremium && !isPremium) return

    applyThemeToDom(name)
    setThemeState(name)

    // Persist to Firestore
    const uid = getAuth().currentUser?.uid
    if (uid) {
      updateDoc(doc(db, 'users', uid, 'profile', 'main'), { theme: name })
        .catch(() => {
          // Fallback: try top-level user doc
          updateDoc(doc(db, 'users', uid), { theme: name }).catch(() => {})
        })
    }
  }, [isPremium])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, isPremium }}>
      {children}
    </ThemeContext.Provider>
  )
}
