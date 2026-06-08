// FundamentalScreener.tsx — AI natural-language fundamental stock screener
import { useState, useCallback, useEffect, useRef } from 'react'
import {
  runScreener, parseNlQuery, searchSymbol, PRESETS,
  type ScreenerFilters, type EnrichedStock, type ParseResult, type NumericField, type SymbolSearchResult,
} from '@/services/screener/fundamentalScreener'
import StockDetailSheet from './StockDetailSheet'

const EXAMPLES = [
  'Actions françaises de qualité avec dividende croissant',
  'Entreprises européennes avec croissance EPS > 15%',
  'Des small caps PEA avec Note Q > 17',
  'Value avec ROE élevé et peu de dette',
  'Similaire à Nvidia mais moins cher',
]

// Columns from Finnhub free fundamentals (real data)
const COLS: { field: NumericField; w: number; label: string; unit: string }[] = [
  { field: 'qualityScore',  w: 60, label: 'Note Q', unit: '/20' },
  { field: 'pe',            w: 55, label: 'P/E',    unit: '' },
  { field: 'roe',           w: 60, label: 'ROE',    unit: '%' },
  { field: 'netMargin',     w: 70, label: 'Marge nette', unit: '%' },
  { field: 'revenueGrowth', w: 70, label: 'Croiss. CA', unit: '%' },
  { field: 'dividendYield', w: 60, label: 'Div.',   unit: '%' },
  { field: 'marketCap',     w: 75, label: 'Capi.',  unit: '$' },
]

const fmtNum = (v: number, unit: string): string => {
  if (!isFinite(v)) return '—'
  if (unit === '$' && Math.abs(v) >= 1e9) return `${(v/1e9).toFixed(1)}B`
  if (unit === '$' && Math.abs(v) >= 1e6) return `${(v/1e6).toFixed(0)}M`
  if (unit === '/20' || unit === '/9') return v.toFixed(1)
  if (unit === '%') return `${v.toFixed(1)}%`
  if (unit === 'x') return `${v.toFixed(1)}x`
  return v.toFixed(1)
}

const noteQColor = (q: number) => q >= 16 ? '#22C759' : q >= 12 ? '#9ACD32' : q >= 8 ? '#FF9500' : '#FF3B30'

export default function FundamentalScreener() {
  const [query, setQuery] = useState('')
  const [parsing, setParsing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [filters, setFilters] = useState<ScreenerFilters>({})
  const [stocks, setStocks] = useState<EnrichedStock[]>([])
  const [error, setError] = useState<string | null>(null)
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null)
  // Symbol search (access full FMP universe)
  const [symQuery, setSymQuery] = useState('')
  const [symResults, setSymResults] = useState<SymbolSearchResult[]>([])
  const symTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (symTimer.current) clearTimeout(symTimer.current)
    if (symQuery.trim().length < 2) { setSymResults([]); return }
    symTimer.current = setTimeout(() => {
      searchSymbol(symQuery).then(setSymResults).catch(() => setSymResults([]))
    }, 350)
  }, [symQuery])

  const execute = useCallback(async (f: ScreenerFilters) => {
    setLoading(true); setError(null)
    try {
      const { stocks, debug } = await runScreener(f)
      setStocks(stocks)
      if (stocks.length === 0) setError(`Aucune action ne correspond.${debug ? ' [debug: ' + debug + ']' : ''}`)
    } catch (e: any) {
      setError(e?.message?.includes('FMP_API_KEY') ? 'Clé FMP non configurée côté serveur.' : 'Erreur lors de la recherche.')
    }
    setLoading(false)
  }, [])

  const onSearch = useCallback(async () => {
    if (!query.trim()) return
    setParsing(true); setError(null)
    try {
      const pr = await parseNlQuery(query)
      setParseResult(pr)
      setFilters(pr.filters)
      await execute(pr.filters)
    } catch {
      setError('Impossible d\'interpréter la requête.')
    }
    setParsing(false)
  }, [query, execute])

  const applyPreset = useCallback((key: keyof typeof PRESETS) => {
    const f = PRESETS[key].filters
    setParseResult(null); setQuery(''); setFilters(f)
    execute(f)
  }, [execute])

  const removeChip = useCallback((field: string) => {
    setFilters(prev => {
      const next: ScreenerFilters = { ...prev, numeric: { ...prev.numeric } }
      if (field in (next.numeric ?? {})) delete next.numeric![field as NumericField]
      else if (field === 'country') delete next.country
      else if (field === 'sector') delete next.sector
      else if (field === 'preset') delete next.preset
      else if (field === 'similarTo') delete next.similarTo
      execute(next)
      return next
    })
  }, [execute])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── AI search bar ── */}
      <div style={{ background: 'var(--tm-bg-secondary)', border: '1px solid rgba(10,133,255,0.25)', borderRadius: 14, padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>🔍✨</span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onSearch()}
            placeholder="Décris ce que tu cherches… ex: small caps PEA avec Note Q > 17"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--tm-text-primary)', fontSize: 14,
            }}
          />
          <button onClick={onSearch} disabled={parsing || !query.trim()} style={{
            padding: '7px 16px', borderRadius: 9, border: 'none', cursor: parsing ? 'wait' : 'pointer',
            background: 'rgba(10,133,255,0.2)', color: '#0A85FF', fontWeight: 700, fontSize: 12,
          }}>{parsing ? '…' : 'Rechercher'}</button>
        </div>

        {/* Examples */}
        {!parseResult && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {EXAMPLES.map(ex => (
              <button key={ex} onClick={() => { setQuery(ex) }} style={{
                fontSize: 10, padding: '4px 9px', borderRadius: 7, cursor: 'pointer',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                color: 'var(--tm-text-muted)',
              }}>{ex}</button>
            ))}
          </div>
        )}

        {/* Parsed result: explanation + chips + confidence */}
        {parseResult && (
          <div style={{ marginTop: 12 }}>
            {parseResult.explanation && (
              <div style={{ fontSize: 11, color: 'var(--tm-text-secondary)', marginBottom: 8 }}>
                {parseResult.explanation}
                <span style={{ marginLeft: 8, color: parseResult.confidence >= 0.7 ? '#22C759' : '#FF9500' }}>
                  ✓ {Math.round(parseResult.confidence * 100)}%
                </span>
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {parseResult.appliedChips.map(c => (
                <span key={c.field} style={{
                  fontSize: 10, padding: '3px 8px 3px 10px', borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: 'rgba(10,133,255,0.12)', border: '1px solid rgba(10,133,255,0.3)', color: '#4DA6FF',
                  fontFamily: 'JetBrains Mono, monospace',
                }}>
                  {c.label}
                  <button onClick={() => removeChip(c.field)} style={{ background: 'none', border: 'none', color: '#4DA6FF', cursor: 'pointer', fontSize: 11, padding: 0 }}>✕</button>
                </span>
              ))}
            </div>
            {parseResult.warnings?.map((w, i) => (
              <div key={i} style={{ fontSize: 9.5, color: '#FF9500', marginTop: 5 }}>⚠ {w}</div>
            ))}
          </div>
        )}
      </div>

      {/* ── Search any stock (full FMP universe) ── */}
      <div style={{ position: 'relative' }}>
        <input
          value={symQuery}
          onChange={e => setSymQuery(e.target.value)}
          placeholder="🔎 Rechercher n'importe quelle action (10 000+ disponibles)…"
          style={{
            width: '100%', boxSizing: 'border-box', background: 'var(--tm-bg-secondary)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '9px 14px',
            color: 'var(--tm-text-primary)', fontSize: 13, outline: 'none',
          }}
        />
        {symResults.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 20,
            background: 'var(--tm-bg)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, overflow: 'hidden', maxHeight: 280, overflowY: 'auto' }}>
            {symResults.map(r => (
              <button key={r.symbol} onClick={() => { setDetailSymbol(r.symbol); setSymQuery(''); setSymResults([]) }} style={{
                width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.05)',
                padding: '8px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span><b style={{ color: 'var(--tm-text-primary)', fontSize: 12 }}>{r.symbol}</b> <span style={{ color: 'var(--tm-text-muted)', fontSize: 11 }}>{r.name}</span></span>
                <span style={{ color: 'var(--tm-text-muted)', fontSize: 9 }}>{r.exchange}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Presets ── */}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map(k => (
          <button key={k} onClick={() => applyPreset(k)} style={{
            fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 9, cursor: 'pointer',
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--tm-text-secondary)',
          }}>{PRESETS[k].emoji} {PRESETS[k].label}</button>
        ))}
      </div>

      {/* ── Results ── */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(10,133,255,0.7)' }}>
          <span style={{ display: 'inline-block', width: 28, height: 28, border: '3px solid #0A85FF', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <div style={{ fontSize: 12, marginTop: 10 }}>Analyse fondamentale…</div>
        </div>
      )}
      {error && !loading && (
        <div style={{ padding: '12px 16px', background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.25)', borderRadius: 10, fontSize: 12, color: '#FF453A' }}>{error}</div>
      )}

      {!loading && stocks.length > 0 && (
        <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                <th style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--tm-text-muted)', fontWeight: 600 }}>Action</th>
                {COLS.map(c => (
                  <th key={c.field} style={{ textAlign: 'right', padding: '8px 6px', color: 'var(--tm-text-muted)', fontWeight: 600, minWidth: c.w }}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stocks.map(s => (
                <tr key={s.symbol} onClick={() => setDetailSymbol(s.symbol)} style={{ borderTop: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <td style={{ padding: '7px 10px' }}>
                    <div style={{ fontWeight: 700, color: 'var(--tm-text-primary)' }}>{s.symbol}</div>
                    <div style={{ fontSize: 9, color: 'var(--tm-text-muted)' }}>
                      {s.companyName.slice(0, 28)} · {s.country}
                    </div>
                  </td>
                  {COLS.map(c => {
                    const v = s[c.field] as number
                    const isQ = c.field === 'qualityScore'
                    return (
                      <td key={c.field} style={{ textAlign: 'right', padding: '7px 6px', color: isQ ? noteQColor(v) : 'var(--tm-text-secondary)', fontWeight: isQ ? 700 : 400 }}>
                        {fmtNum(v, c.unit)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detailSymbol && <StockDetailSheet symbol={detailSymbol} onClose={() => setDetailSymbol(null)} />}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
