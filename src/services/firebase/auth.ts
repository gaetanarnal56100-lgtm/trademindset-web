// src/services/firebase/auth.ts
// Miroir de Services/Auth/AuthManager.swift

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  OAuthProvider,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  onAuthStateChanged,
  updateProfile,
  type User,
} from 'firebase/auth'
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from './config'
import type { UserProfile } from '@/types'

const googleProvider = new GoogleAuthProvider()
const appleProvider  = new OAuthProvider('apple.com')
appleProvider.addScope('email')
appleProvider.addScope('name')

// ── Sign in ────────────────────────────────────────────────────────────────

export async function signInWithEmail(email: string, password: string) {
  const cred = await signInWithEmailAndPassword(auth, email, password)
  return cred.user
}

export async function signInWithGoogle() {
  const cred = await signInWithPopup(auth, googleProvider)
  await ensureUserDoc(cred.user)
  return cred.user
}

export async function signInWithApple() {
  const cred = await signInWithPopup(auth, appleProvider)
  await ensureUserDoc(cred.user)
  return cred.user
}

// ── Sign up ────────────────────────────────────────────────────────────────

export async function signUpWithEmail(
  email: string,
  password: string,
  displayName: string
) {
  const cred = await createUserWithEmailAndPassword(auth, email, password)
  await updateProfile(cred.user, { displayName })
  await sendEmailVerification(cred.user)
  await ensureUserDoc(cred.user)
  return cred.user
}

// ── Reset password ─────────────────────────────────────────────────────────

export async function resetPassword(email: string) {
  await sendPasswordResetEmail(auth, email)
}

// ── Sign out ───────────────────────────────────────────────────────────────

export async function logout() {
  await signOut(auth)
}

// ── Auth state listener ────────────────────────────────────────────────────

export function onAuthChange(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback)
}

// ── User document ──────────────────────────────────────────────────────────

async function ensureUserDoc(user: User) {
  const ref  = doc(db, 'users', user.uid)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    await setDoc(ref, {
      uid:         user.uid,
      email:       user.email,
      displayName: user.displayName || '',
      photoURL:    user.photoURL || null,
      isPremium:   false,
      createdAt:   serverTimestamp(),
      updatedAt:   serverTimestamp(),
    })
  }
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, 'users', uid))
  if (!snap.exists()) return null
  const d = snap.data()
  return {
    uid:         d.uid,
    email:       d.email,
    displayName: d.displayName,
    photoURL:    d.photoURL,
    isPremium:   d.isPremium ?? false,
    createdAt:   d.createdAt?.toDate() ?? new Date(),
  }
}
