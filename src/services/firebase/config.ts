import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth }      from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'
import { getStorage }   from 'firebase/storage'

const firebaseConfig = {
  apiKey:            "AIzaSyDaLspO9hP8EmoAp9YexORCYEhogQ9-sEg",
  authDomain:        "trademindset-27aaf.firebaseapp.com",
  projectId:         "trademindset-27aaf",
  storageBucket:     "trademindset-27aaf.firebasestorage.app",
  messagingSenderId: "565785345808",
  appId:             "1:565785345808:web:a76d28108c741d43426f95",
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp()

export const auth      = getAuth(app)
export const db        = getFirestore(app)
export const functions = getFunctions(app, 'europe-west1')
export const storage   = getStorage(app)

export default app
