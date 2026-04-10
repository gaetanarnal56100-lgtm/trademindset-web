// BackgroundSignalMonitor.ts
// ─────────────────────────────────────────────────────────────────────────────
// Poll TOUS les timeframes en arrière-plan pour un symbole donné.
// Les alertes WaveTrend + VMC se déclenchent indépendamment du TF affiché à l'écran.
// ─────────────────────────────────────────────────────────────────────────────

import { fetchCandles, calcWaveTrend, calcVMCOscillator } from '@/pages/analyse/OscillatorCharts'
import { signalService } from './SignalNotificationService'

// Timeframes à monitorer + intervalle de polling
const MONITOR_TFS = [
  { label: '5m',  interval: '5m',  limit: 120, refreshMs:  5 * 60 * 1000 },
  { label: '15m', interval: '15m', limit: 120, refreshMs: 15 * 60 * 1000 },
  { label: '30m', interval: '30m', limit: 120, refreshMs: 30 * 60 * 1000 },
  { label: '1H',  interval: '1h',  limit: 120, refreshMs: 60 * 60 * 1000 },
  { label: '4H',  interval: '4h',  limit: 120, refreshMs:  4 * 60 * 60 * 1000 },
  { label: '1J',  interval: '1d',  limit: 120, refreshMs: 24 * 60 * 60 * 1000 },
]

// Pour les actions (Yahoo via Firebase), limiter aux TFs > 1h pour éviter les appels excessifs
const STOCK_TF_WHITELIST = new Set(['1h', '4h', '1d'])

const WT_OB =  53
const WT_OS = -53

function isCrypto(symbol: string): boolean {
  return /USDT$|BUSD$|BTC$|ETH$|BNB$/i.test(symbol.toUpperCase())
}

class BackgroundSignalMonitor {
  private symbol = ''
  private timers: ReturnType<typeof setInterval>[] = []
  private active = false

  /** Démarre le monitoring pour un symbole. Remplace l'ancien symbole si différent. */
  start(symbol: string) {
    if (this.active && this.symbol === symbol) return
    this.stop()

    if (!symbol) return
    this.symbol = symbol
    this.active = true

    const crypto = isCrypto(symbol)

    for (const tf of MONITOR_TFS) {
      if (!crypto && !STOCK_TF_WHITELIST.has(tf.interval)) continue

      // Premier check immédiat (après un léger délai pour ne pas saturer au démarrage)
      const jitter = Math.random() * 3000
      const initialTimer = setTimeout(() => this.poll(symbol, tf), jitter)

      // Polling périodique
      const t = setInterval(() => this.poll(symbol, tf), tf.refreshMs)
      this.timers.push(t)

      // Enregistrer le timeout initial pour pouvoir l'annuler si stop() est appelé tôt
      ;(this.timers as unknown as ReturnType<typeof setTimeout>[]).push(initialTimer)
    }
  }

  /** Arrête tout le polling en cours. */
  stop() {
    this.timers.forEach(clearInterval)
    this.timers = []
    this.active = false
    this.symbol = ''
  }

  private async poll(symbol: string, tf: typeof MONITOR_TFS[number]) {
    // Vérifier que le monitor est toujours actif pour ce symbole
    if (!this.active || this.symbol !== symbol) return
    try {
      const candles = await fetchCandles(symbol, tf.interval, tf.limit)
      if (!this.active || this.symbol !== symbol) return  // re-check après l'await

      // ── WaveTrend ────────────────────────────────────────────────────────
      if (candles.length >= 20) {
        const r = calcWaveTrend(candles, 10, 21, WT_OB, WT_OS)
        if (r.wt1.length > 1) {
          signalService.checkWaveTrend(symbol, tf.label, r.wt1, r.wt2, WT_OB, WT_OS)
        }
      }

      // ── VMC Oscillator ───────────────────────────────────────────────────
      if (candles.length >= 60) {
        const r = calcVMCOscillator(candles, 'swing')
        const sig = r.sig[r.sig.length - 1] ?? 0
        const mom = r.momentum[r.momentum.length - 1] ?? 0
        signalService.checkVMC(symbol, tf.label, r.status, sig, mom, r.compression)
      }
    } catch {
      // Silencieux — le monitor tourne en arrière-plan, pas d'affichage d'erreur
    }
  }
}

export const backgroundMonitor = new BackgroundSignalMonitor()
