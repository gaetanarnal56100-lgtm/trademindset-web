// src/i18n/config.ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import fr from './fr.json'
import en from './en.json'

const storedLang = localStorage.getItem('tm_lang') ?? 'fr'

i18n
  .use(initReactI18next)
  .init({
    lng: storedLang,
    fallbackLng: 'fr',
    resources: {
      fr: { translation: fr },
      en: { translation: en },
    },
    interpolation: { escapeValue: false },
  })

export type Lang = 'fr' | 'en'

export function isValidLang(l: string): l is Lang {
  return l === 'fr' || l === 'en'
}

export default i18n
