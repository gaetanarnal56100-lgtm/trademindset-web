// src/services/firebase/config.ts
// ⚠️  Remplace les valeurs ci-dessous par ton firebaseConfig depuis la console Firebase
// Firebase Console → Project settings → Your apps → Web app → SDK setup

import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth }      from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'
import { getStorage }   from 'firebase/storage'

// 🔧 À CONFIGURER : colle ici ton firebaseConfig depuis Firebase Console
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

// Évite la double-initialisation en dev (HMR)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp()

export const auth      = getAuth(app)
export const db        = getFirestore(app)
export const functions = getFunctions(app, 'europe-west1') // ajuste ta région
export const storage   = getStorage(app)

export default app
