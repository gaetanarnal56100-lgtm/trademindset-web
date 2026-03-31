// ─── ThemeContext ─────────────────────────────────────────────────────────────
// 4 thèmes :
//  • default   → couleurs originales du projet (aucune variable CSS, 100% safe)
//  • terminal  → même palette que default via CSS vars
//  • neon      → violet électrique
//  • midnight  → bleu profond

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { getAuth } from 'firebase/auth'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/services/firebase/config'

export type ThemeName = 'default' | 'terminal' | 'neon' | 'midnight'

export interface ThemeConfig {
  id: ThemeName
  label: string
  description: string
  isPremium: boolean
  preview: { bg: string; card: string; accent: string; profit: string; loss: string; text: string }
}

export const THEMES: ThemeConfig[] = [
  {
    id: 'default',
    label: 'Default',
    description: 'Couleurs originales du projet, aucune variable CSS',
    isPremium: false,
    preview: { bg:'#0D1117', card:'#1C2133', accent:'#00E5FF', profit:'#22C759', loss:'#FF3B30', text:'#F0F3FF' },
  },
  {
    id: 'terminal',
    label: 'Terminal',
    description: 'Même palette via variables CSS (theming actif)',
    isPremium: false,
    preview: { bg:'#0D1117', card:'#1C2133', accent:'#00E5FF', profit:'#22C759', loss:'#FF3B30', text:'#F0F3FF' },
  },
  {
    id: 'neon',
    label: 'Neon',
    description: 'Violet intense, accents électrisants',
    isPremium: false,
    preview: { bg:'#05010a', card:'#160b22', accent:'#c77dff', profit:'#39ff90', loss:'#ff2d6b', text:'#f1e8ff' },
  },
  {
    id: 'midnight',
    label: 'Midnight',
    description: 'Bleu profond, élégance nocturne',
    isPremium: false,
    preview: { bg:'#080c14', card:'#172035', accent:'#60a5fa', profit:'#34d399', loss:'#f87171', text:'#e8f0fe' },
  },
]

const STORAGE_KEY = 'trademindset:theme'
const DEFAULT_THEME: ThemeName = 'default'

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

function applyThemeToDom(theme: ThemeName) {
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem(STORAGE_KEY, theme)
}

export function getStoredTheme(): ThemeName {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'default' || stored === 'terminal' || stored === 'neon' || stored === 'midnight') {
    return stored
  }
  return DEFAULT_THEME
}

interface ThemeProviderProps {
  children: ReactNode
  isPremium?: boolean
}

export function ThemeProvider({ children, isPremium = false }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeName>(getStoredTheme)

  useEffect(() => {
    applyThemeToDom(theme)
  }, []) // eslint-disable-line

  const setTheme = useCallback((name: ThemeName) => {
    if (!THEMES.find(t => t.id === name)) return
    applyThemeToDom(name)
    setThemeState(name)

    const uid = getAuth().currentUser?.uid
    if (uid) {
      updateDoc(doc(db, 'users', uid, 'profile', 'main'), { theme: name })
        .catch(() => updateDoc(doc(db, 'users', uid), { theme: name }).catch(() => {}))
    }
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, isPremium }}>
      {children}
    </ThemeContext.Provider>
  )
}
