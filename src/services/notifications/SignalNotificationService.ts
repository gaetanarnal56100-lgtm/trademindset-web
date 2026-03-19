// SignalNotificationService.ts
// Notifications web pour signaux de trading
// Cooldown 5min par signal type+symbol+tf pour éviter le spam

export type SignalType =
  | 'WT_SMART_BULL' | 'WT_SMART_BEAR' | 'WT_BULL' | 'WT_BEAR'
  | 'VMC_BUY' | 'VMC_SELL' | 'VMC_COMPRESSION'
  | 'MTF_BUY' | 'MTF_SELL' | 'MTF_CONFLUENCE'

export interface TradingSignal {
  id: string
  type: SignalType
  symbol: string
  timeframe: string
  message: string
  detail?: string
  timestamp: Date
  urgency: 'low' | 'medium' | 'high' | 'premium'
}

type Listener = (signal: TradingSignal) => void

class SignalNotificationService {
  private listeners: Listener[] = []
  private history: TradingSignal[] = []
  private cooldowns = new Set<string>()
  permission: NotificationPermission = 'default'

  constructor() {
    if ('Notification' in window) this.permission = Notification.permission
  }

  async requestPermission() {
    if (!('Notification' in window)) return false
    const r = await Notification.requestPermission()
    this.permission = r
    return r === 'granted'
  }

  get isGranted() { return this.permission === 'granted' }

  subscribe(fn: Listener) {
    this.listeners.push(fn)
    return () => { this.listeners = this.listeners.filter(l => l !== fn) }
  }

  getHistory() { return [...this.history] }
  clearHistory() { this.history = []; this.notify() }
  private notify() { this.listeners.forEach(l => l({} as TradingSignal)) }

  emit(signal: TradingSignal) {
    const key = `${signal.type}-${signal.symbol}-${signal.timeframe}`
    if (this.cooldowns.has(key)) return
    this.cooldowns.add(key)
    setTimeout(() => this.cooldowns.delete(key), 5 * 60 * 1000)

    this.history = [signal, ...this.history].slice(0, 50)
    this.listeners.forEach(l => l(signal))

    if (this.permission === 'granted' && signal.urgency !== 'low') {
      const icon = { premium: '⭐', high: '🔥', medium: '📊', low: '📈' }[signal.urgency]
      const n = new Notification(`${icon} TradeMindset — ${signal.symbol} ${signal.timeframe}`, {
        body: signal.message + (signal.detail ? `\n${signal.detail}` : ''),
        icon: '/favicon.svg',
        tag: key,
        requireInteraction: signal.urgency === 'premium',
      })
      n.onclick = () => { window.focus(); n.close() }
    }
  }

  checkWaveTrend(symbol: string, tf: string, wt1: number[], wt2: number[], obLevel: number, osLevel: number) {
    if (wt1.length < 2) return
    const i = wt1.length - 1
    const crossUp = wt1[i-1] <= wt2[i-1] && wt1[i] > wt2[i]
    const crossDn = wt1[i-1] >= wt2[i-1] && wt1[i] < wt2[i]
    const w = wt1[i]
    if (crossUp && w <= osLevel)
      this.emit({ id: crypto.randomUUID(), type:'WT_SMART_BULL', symbol, timeframe:tf, message:`⭐ Smart Bullish Reversal ${tf}`, detail:`WT1: ${w.toFixed(1)} — zone de survente extrême`, timestamp:new Date(), urgency:'premium' })
    else if (crossDn && w >= obLevel)
      this.emit({ id: crypto.randomUUID(), type:'WT_SMART_BEAR', symbol, timeframe:tf, message:`⭐ Smart Bearish Reversal ${tf}`, detail:`WT1: ${w.toFixed(1)} — zone de surachat extrême`, timestamp:new Date(), urgency:'premium' })
    else if (crossUp)
      this.emit({ id: crypto.randomUUID(), type:'WT_BULL', symbol, timeframe:tf, message:`Bullish Reversal WaveTrend ${tf}`, detail:`Crossover WT1/WT2`, timestamp:new Date(), urgency:'medium' })
    else if (crossDn)
      this.emit({ id: crypto.randomUUID(), type:'WT_BEAR', symbol, timeframe:tf, message:`Bearish Reversal WaveTrend ${tf}`, detail:`Crossunder WT1/WT2`, timestamp:new Date(), urgency:'medium' })
  }

  checkVMC(symbol: string, tf: string, status: string, sig: number, mom: number, compression: boolean) {
    if (status === 'BUY')
      this.emit({ id: crypto.randomUUID(), type:'VMC_BUY', symbol, timeframe:tf, message:`Signal BUY VMC ${tf}${compression?' 🔄':''}`, detail:`sig:${sig.toFixed(1)} mom:${mom>=0?'+':''}${mom.toFixed(1)}${compression?' COMPRESSION':''}`, timestamp:new Date(), urgency:compression?'premium':'high' })
    else if (status === 'SELL')
      this.emit({ id: crypto.randomUUID(), type:'VMC_SELL', symbol, timeframe:tf, message:`Signal SELL VMC ${tf}${compression?' 🔄':''}`, detail:`sig:${sig.toFixed(1)} mom:${mom>=0?'+':''}${mom.toFixed(1)}${compression?' COMPRESSION':''}`, timestamp:new Date(), urgency:compression?'premium':'high' })
    else if (compression)
      this.emit({ id: crypto.randomUUID(), type:'VMC_COMPRESSION', symbol, timeframe:tf, message:`Compression VMC ${tf}`, detail:'Setup breakout potentiel', timestamp:new Date(), urgency:'medium' })
  }

  checkMTF(symbol: string, signal: string, confluence: number, score: number) {
    if (signal === 'BUY' && confluence >= 70)
      this.emit({ id: crypto.randomUUID(), type:'MTF_BUY', symbol, timeframe:'MTF', message:`Signal BUY MTF — ${confluence}% confluence`, detail:`Score combiné: ${score.toFixed(1)}`, timestamp:new Date(), urgency:confluence>=85?'premium':'high' })
    else if (signal === 'SELL' && confluence >= 70)
      this.emit({ id: crypto.randomUUID(), type:'MTF_SELL', symbol, timeframe:'MTF', message:`Signal SELL MTF — ${confluence}% confluence`, detail:`Score combiné: ${score.toFixed(1)}`, timestamp:new Date(), urgency:confluence>=85?'premium':'high' })
  }
}

export const signalService = new SignalNotificationService()
