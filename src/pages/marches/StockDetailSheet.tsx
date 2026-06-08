// StockDetailSheet.tsx — rich fundamental detail modal for a stock
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { getStockDetail, type StockDetail } from '@/services/screener/fundamentalScreener'

const fmt = (v: number, suffix = '', dec = 1): string => {
  if (v == null || !isFinite(v) || v === 0) return '—'
  if (suffix === '$' && Math.abs(v) >= 1e9) return `${(v/1e9).toFixed(1)} B$`
  if (suffix === '$' && Math.abs(v) >= 1e6) return `${(v/1e6).toFixed(0)} M$`
  return `${v.toFixed(dec)}${suffix}`
}
const col = (v: number, good: 'high' | 'low', t1: number, t2: number) => {
  const ok = good === 'high' ? v >= t1 : v <= t1
  const mid = good === 'high' ? v >= t2 : v <= t2
  return ok ? '#22C759' : mid ? '#FF9500' : '#FF3B30'
}
const noteQColor = (q: number) => q >= 16 ? '#22C759' : q >= 12 ? '#9ACD32' : q >= 8 ? '#FF9500' : '#FF3B30'

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
      <span style={{ color: 'var(--tm-text-muted)' }}>{label}</span>
      <span style={{ color: color ?? 'var(--tm-text-secondary)', fontWeight: 600 }}>{value}</span>
    </div>
  )
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--tm-text-muted)', marginBottom: 8, fontFamily: 'JetBrains Mono, monospace' }}>{title}</div>
      {children}
    </div>
  )
}

export default function StockDetailSheet({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const [data, setData] = useState<StockDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true); setError(null)
    getStockDetail(symbol)
      .then(setData)
      .catch(() => setError('Action introuvable ou données indisponibles.'))
      .finally(() => setLoading(false))
  }, [symbol])

  return createPortal(
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 820, background: 'var(--tm-bg)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 18, padding: 20, position: 'relative',
      }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 8, color: 'var(--tm-text-muted)', cursor: 'pointer', fontSize: 16, width: 30, height: 30 }}>✕</button>

        {loading && <div style={{ textAlign: 'center', padding: '60px 0', color: 'rgba(10,133,255,0.7)' }}>
          <span style={{ display: 'inline-block', width: 30, height: 30, border: '3px solid #0A85FF', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>}
        {error && <div style={{ padding: '40px 0', textAlign: 'center', color: '#FF453A', fontSize: 13 }}>{error}</div>}

        {data && (
          <>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
              {data.profile.image && <img src={data.profile.image} alt="" style={{ width: 48, height: 48, borderRadius: 10, background: '#fff' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--tm-text-primary)' }}>{data.profile.companyName}</div>
                <div style={{ fontSize: 11, color: 'var(--tm-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                  {data.profile.exchange}:{data.profile.symbol} · {data.profile.sector} · {data.profile.country}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--tm-text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>
                  {fmt(data.profile.price, '', 2)} {data.profile.currency}
                </div>
                <div style={{ fontSize: 12, color: data.profile.change >= 0 ? '#22C759' : '#FF3B30', fontFamily: 'JetBrains Mono, monospace' }}>
                  {data.profile.change >= 0 ? '▲' : '▼'} {Math.abs(data.profile.change).toFixed(2)}%
                </div>
              </div>
              <div style={{ background: `${noteQColor(data.noteQ)}22`, border: `1px solid ${noteQColor(data.noteQ)}`, borderRadius: 10, padding: '8px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: noteQColor(data.noteQ) }}>{data.noteQ.toFixed(1)}</div>
                <div style={{ fontSize: 8, color: 'var(--tm-text-muted)' }}>Note Q /20</div>
              </div>
            </div>

            {/* Grid of sections */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
              <Section title="Valorisation">
                <Row label="P/E" value={fmt(data.valuation.pe, '', 1)} color={col(data.valuation.pe, 'low', 25, 40)} />
                <Row label="Forward P/E" value={fmt(data.valuation.forwardPe)} />
                <Row label="P/B" value={fmt(data.valuation.pb)} />
                <Row label="P/S" value={fmt(data.valuation.ps)} />
                <Row label="P/FCF" value={fmt(data.valuation.pfcf)} />
                <Row label="Prix juste (DCF)" value={fmt(data.valuation.dcfFairValue, '', 2)} color={data.valuation.dcfDiff > 0 ? '#22C759' : '#FF3B30'} />
                {data.valuation.dcfDiff !== 0 && <Row label="Potentiel DCF" value={`${data.valuation.dcfDiff > 0 ? '+' : ''}${data.valuation.dcfDiff.toFixed(1)}%`} color={data.valuation.dcfDiff > 0 ? '#22C759' : '#FF3B30'} />}
              </Section>

              <Section title="Marges">
                <Row label="Marge brute" value={fmt(data.margins.gross, '%')} color={col(data.margins.gross, 'high', 40, 20)} />
                <Row label="Marge opé." value={fmt(data.margins.operating, '%')} color={col(data.margins.operating, 'high', 20, 10)} />
                <Row label="Marge nette" value={fmt(data.margins.net, '%')} color={col(data.margins.net, 'high', 15, 5)} />
                <Row label="Marge FCF" value={fmt(data.margins.fcf, '%')} color={col(data.margins.fcf, 'high', 15, 5)} />
              </Section>

              <Section title="Rentabilité">
                <Row label="ROE" value={fmt(data.profitability.roe, '%')} color={col(data.profitability.roe, 'high', 15, 8)} />
                <Row label="ROA" value={fmt(data.profitability.roa, '%')} color={col(data.profitability.roa, 'high', 8, 3)} />
                <Row label="ROIC" value={fmt(data.profitability.roic, '%')} color={col(data.profitability.roic, 'high', 12, 6)} />
                <Row label="ROCE" value={fmt(data.profitability.roce, '%')} color={col(data.profitability.roce, 'high', 12, 6)} />
              </Section>

              <Section title="Santé financière">
                <Row label="Dette/EBITDA" value={fmt(data.health.debtToEbitda, 'x')} color={col(data.health.debtToEbitda, 'low', 2, 4)} />
                <Row label="Current Ratio" value={fmt(data.health.currentRatio)} color={col(data.health.currentRatio, 'high', 1.5, 1)} />
                <Row label="Couverture intérêts" value={fmt(data.health.interestCoverage)} />
                <Row label="Altman Z" value={fmt(data.health.altmanZ)} color={col(data.health.altmanZ, 'high', 3, 1.8)} />
                <Row label="Piotroski" value={`${data.health.piotroski.toFixed(0)}/9`} color={col(data.health.piotroski, 'high', 7, 4)} />
              </Section>

              <Section title="Croissance">
                <Row label="Croissance CA" value={fmt(data.growth.revenue, '%')} color={col(data.growth.revenue, 'high', 10, 0)} />
                <Row label="Croissance EPS" value={fmt(data.growth.eps, '%')} color={col(data.growth.eps, 'high', 10, 0)} />
                <Row label="Croissance RN" value={fmt(data.growth.netIncome, '%')} />
                <Row label="Croissance FCF" value={fmt(data.growth.fcf, '%')} />
              </Section>

              <Section title="Dividende">
                <Row label="Rendement" value={fmt(data.dividend.yield, '%', 2)} />
                <Row label="Payout" value={fmt(data.dividend.payout, '%')} color={col(data.dividend.payout, 'low', 60, 90)} />
                <Row label="Div/action" value={fmt(data.dividend.perShare, '', 2)} />
              </Section>
            </div>

            {/* Income statement mini-table */}
            {data.incomeStatement.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <Section title="Comptes de résultat (5 ans)">
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', fontSize: 10, fontFamily: 'JetBrains Mono, monospace', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ color: 'var(--tm-text-muted)' }}>
                          <th style={{ textAlign: 'left', padding: '4px 6px' }}>Année</th>
                          <th style={{ textAlign: 'right', padding: '4px 6px' }}>CA</th>
                          <th style={{ textAlign: 'right', padding: '4px 6px' }}>Marge brute</th>
                          <th style={{ textAlign: 'right', padding: '4px 6px' }}>Rés. opé.</th>
                          <th style={{ textAlign: 'right', padding: '4px 6px' }}>Rés. net</th>
                          <th style={{ textAlign: 'right', padding: '4px 6px' }}>EPS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.incomeStatement.map((r, i) => (
                          <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)', color: 'var(--tm-text-secondary)' }}>
                            <td style={{ padding: '4px 6px' }}>{r.year}</td>
                            <td style={{ textAlign: 'right', padding: '4px 6px' }}>{fmt(r.revenue, '$', 0)}</td>
                            <td style={{ textAlign: 'right', padding: '4px 6px' }}>{fmt(r.grossProfit, '$', 0)}</td>
                            <td style={{ textAlign: 'right', padding: '4px 6px' }}>{fmt(r.operatingIncome, '$', 0)}</td>
                            <td style={{ textAlign: 'right', padding: '4px 6px' }}>{fmt(r.netIncome, '$', 0)}</td>
                            <td style={{ textAlign: 'right', padding: '4px 6px' }}>{fmt(r.eps, '', 2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              </div>
            )}

            {/* Description */}
            {data.profile.description && (
              <div style={{ marginTop: 14, fontSize: 11, lineHeight: 1.6, color: 'var(--tm-text-secondary)', maxHeight: 120, overflowY: 'auto' }}>
                {data.profile.description}
              </div>
            )}
          </>
        )}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>,
    document.body,
  )
}
