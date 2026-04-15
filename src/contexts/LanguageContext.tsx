// src/contexts/LanguageContext.tsx
// Même pattern que ThemeContext : localStorage + Firestore sync
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { getAuth } from 'firebase/auth'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/services/firebase/config'
import i18n, { type Lang, isValidLang } from '@/i18n/config'

const STORAGE_KEY = 'tm_lang'

interface LanguageContextType {
  lang: Lang
  setLang: (l: Lang) => void
}

const LanguageContext = createContext<LanguageContextType>({
  lang: 'fr',
  setLang: () => {},
})

export function useLanguage() {
  return useContext(LanguageContext)
}

export function getStoredLang(): Lang {
  const s = localStorage.getItem(STORAGE_KEY)
  return isValidLang(s ?? '') ? (s as Lang) : 'fr'
}

/** Appelée lors du login pour charger la langue depuis Firestore */
export async function loadUserLanguage(lang: string | undefined) {
  if (!lang || !isValidLang(lang)) return
  localStorage.setItem(STORAGE_KEY, lang)
  await i18n.changeLanguage(lang)
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getStoredLang)

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem(STORAGE_KEY, l)
    setLangState(l)
    i18n.changeLanguage(l)

    const uid = getAuth().currentUser?.uid
    if (uid) {
      updateDoc(doc(db, 'users', uid), { language: l }).catch(() => {})
    }
  }, [])

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  )
}
