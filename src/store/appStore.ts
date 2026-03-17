// src/store/appStore.ts
// Miroir de AppState.swift — état global de l'application

import { create } from 'zustand'
import type { Trade, MoodEntry, Exchange, TradingSystem, Alert, UserProfile, TradeStats } from '@/types'
import { computeStats } from '@/utils/statistics'
import {
  subscribeToTrades,
  createTrade, updateTrade, deleteTrade,
} from '@/services/firebase/trades'
import { getUserProfile } from '@/services/firebase/auth'
import type { Unsubscribe } from 'firebase/firestore'

interface AppState {
  // Auth
  user:          UserProfile | null
  isAuthLoading: boolean

  // Data
  trades:        Trade[]
  moodEntries:   MoodEntry[]
  exchanges:     Exchange[]
  systems:       TradingSystem[]
  alerts:        Alert[]

  // Computed
  stats:         TradeStats | null

  // UI
  isLoading:     boolean
  error:         string | null

  // Subscriptions
  _tradeUnsub:   Unsubscribe | null

  // Actions — Auth
  setUser:       (user: UserProfile | null) => void
  setAuthLoading:(v: boolean) => void

  // Actions — Trades
  loadTrades:    (uid: string) => void
  addTrade:      (uid: string, trade: Omit<Trade, 'id' | 'userId' | 'createdAt' | 'updatedAt'>) => Promise<void>
  editTrade:     (uid: string, trade: Trade) => Promise<void>
  removeTrade:   (uid: string, tradeId: string) => Promise<void>

  // Actions — Mood
  setMoodEntries:(entries: MoodEntry[]) => void

  // Actions — Misc
  setError:      (err: string | null) => void
  cleanup:       () => void
}

export const useAppStore = create<AppState>((set, get) => ({
  user:          null,
  isAuthLoading: true,
  trades:        [],
  moodEntries:   [],
  exchanges:     [],
  systems:       [],
  alerts:        [],
  stats:         null,
  isLoading:     false,
  error:         null,
  _tradeUnsub:   null,

  // ── Auth ──────────────────────────────────────────────────────────────

  setUser: async (user) => {
    if (user) {
      // Charge le profil complet depuis Firestore
      const profile = await getUserProfile(user.uid)
      set({ user: profile ?? user })
      // Lance le listener temps réel des trades
      get().loadTrades(user.uid)
    } else {
      // Nettoyage
      get().cleanup()
      set({ user: null, trades: [], stats: null })
    }
  },

  setAuthLoading: (v) => set({ isAuthLoading: v }),

  // ── Trades ────────────────────────────────────────────────────────────

  loadTrades: (uid) => {
    // Annule l'ancien listener s'il existe
    get()._tradeUnsub?.()

    const unsub = subscribeToTrades(
      uid,
      (trades) => {
        set({ trades, stats: computeStats(trades) })
      },
      (err) => set({ error: err.message })
    )
    set({ _tradeUnsub: unsub })
  },

  addTrade: async (uid, trade) => {
    set({ isLoading: true, error: null })
    try {
      await createTrade(uid, trade)
      // Le listener temps réel met à jour automatiquement
    } catch (e) {
      set({ error: (e as Error).message })
    } finally {
      set({ isLoading: false })
    }
  },

  editTrade: async (uid, trade) => {
    set({ isLoading: true, error: null })
    try {
      await updateTrade(uid, trade)
    } catch (e) {
      set({ error: (e as Error).message })
    } finally {
      set({ isLoading: false })
    }
  },

  removeTrade: async (uid, tradeId) => {
    set({ isLoading: true, error: null })
    try {
      await deleteTrade(uid, tradeId)
    } catch (e) {
      set({ error: (e as Error).message })
    } finally {
      set({ isLoading: false })
    }
  },

  // ── Mood ──────────────────────────────────────────────────────────────

  setMoodEntries: (entries) => set({ moodEntries: entries }),

  // ── Misc ──────────────────────────────────────────────────────────────

  setError: (err) => set({ error: err }),

  cleanup: () => {
    get()._tradeUnsub?.()
    set({ _tradeUnsub: null })
  },
}))
