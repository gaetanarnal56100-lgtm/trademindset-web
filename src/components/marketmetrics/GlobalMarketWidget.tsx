// GlobalMarketWidget.tsx — CMC global crypto market metrics
import { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/services/firebase/config'

interface CMCGlobal {
  btcDominance:    number
  ethDominance:    number
  totalMarketCap:  number
  totalVolume24h:  number
  marketCapChange: number
  volumeChange:    number
  defiMarketCap:   number
  stablecoinCap:   number
}

const fmtCap = (n: number): string => {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(0)}M`
  return `$${n.toFixed(0)}`
}

const fmtPct = (p: number): string => `${p > 0 ? '+' : ''}${p.toFixed(2)}%`

export default function GlobalMarketWidget() {
  const [data,    setData]    = useState<CMCGlobal | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    const fetchMetrics = () => {
      const fn = httpsCallable<void, CMCGlobal>(functions, 'fetchCMCGlobalMetrics')
      fn().then(r => { setData(r.data); setLoading(false) })
        .catch(() => { setError(true); setLoading(false) })
    }
    fetchMetrics()
    const id = setInterval(fetchMetrics, 5 * 60 * 1000) // every 5 min
    return () => clearInterval(id)
  }, [])

  if (loading || error || !data) return null

  const capCol = data.marketCapChange >= 0 ? '#34C759' : '#FF3B30'
  const volCol = data.volumeChange    >= 0 ? '#34C759' : '#FF3B30'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '8px 14px',
      background: 'rgba(13,17,35,0.7)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      border: '1px solid rgba(0,229,255,0.20)',
      borderRadius: 14,
      boxShadow: '0 0 16px rgba(0,229,255,0.08)',
      fontFamily: 'JetBrains Mono, monospace',
    }}>
      {/* Logo */}
      <div style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>🌐</div>

      {/* Total cap */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 8, color: 'rgba(143,148,163,0.5)', fontWeight: 700, letterSpacing: '0.08em' }}>MARKET CAP</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,0.92)' }}>{fmtCap(data.totalMarketCap)}</span>
        <span style={{ fontSize: 9, fontWeight: 700, color: capCol }}>{fmtPct(data.marketCapChange)}</span>
      </div>

      {/* Volume */}
      <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.06)' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 8, color: 'rgba(143,148,163,0.5)', fontWeight: 700, letterSpacing: '0.08em' }}>VOL 24H</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,0.92)' }}>{fmtCap(data.totalVolume24h)}</span>
        <span style={{ fontSize: 9, fontWeight: 700, color: volCol }}>{fmtPct(data.volumeChange)}</span>
      </div>

      {/* Dominance */}
      <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.06)' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 8, color: 'rgba(143,148,163,0.5)', fontWeight: 700, letterSpacing: '0.08em' }}>DOMINANCE</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#F7931A' }}>BTC {data.btcDominance.toFixed(1)}%</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#627EEA' }}>ETH {data.ethDominance.toFixed(1)}%</span>
        </div>
        <span style={{ fontSize: 9, fontWeight: 600, color: 'rgba(143,148,163,0.6)' }}>
          ALT {(100 - data.btcDominance - data.ethDominance).toFixed(1)}%
        </span>
      </div>

      {/* Stablecoins */}
      <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.06)' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 8, color: 'rgba(143,148,163,0.5)', fontWeight: 700, letterSpacing: '0.08em' }}>STABLES</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#26A17B' }}>{fmtCap(data.stablecoinCap)}</span>
        <span style={{ fontSize: 9, fontWeight: 600, color: 'rgba(143,148,163,0.6)' }}>
          {((data.stablecoinCap / data.totalMarketCap) * 100).toFixed(1)}% MC
        </span>
      </div>
    </div>
  )
}
