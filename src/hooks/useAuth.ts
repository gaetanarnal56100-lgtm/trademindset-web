// src/hooks/useAuth.ts
import { useEffect } from 'react'
import { onAuthChange } from '@/services/firebase/auth'
import { useAppStore } from '@/store/appStore'

export function useAuthInit() {
  const setUser        = useAppStore(s => s.setUser)
  const setAuthLoading = useAppStore(s => s.setAuthLoading)

  useEffect(() => {
    const unsub = onAuthChange(async (firebaseUser) => {
      if (firebaseUser) {
        await setUser({
          uid:         firebaseUser.uid,
          email:       firebaseUser.email ?? '',
          displayName: firebaseUser.displayName ?? '',
          photoURL:    firebaseUser.photoURL ?? undefined,
          isPremium:   false,
          createdAt:   new Date(),
        })
      } else {
        await setUser(null)
      }
      setAuthLoading(false)
    })
    return unsub
  }, [setUser, setAuthLoading])
}

export function useUser() {
  return useAppStore(s => s.user)
}

export function useIsAuthenticated() {
  const user          = useAppStore(s => s.user)
  const isAuthLoading = useAppStore(s => s.isAuthLoading)
  return { isAuthenticated: !!user, isAuthLoading }
}
