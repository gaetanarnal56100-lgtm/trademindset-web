// fundamentalScreener.ts — FMP fundamental screener client + NL-search types
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/services/firebase/config'

// ── Filterable fields (single source of truth, must match CF whitelist) ──────
export type NumericField =
  | 'marketCap' | 'price' | 'beta'
  | 'pe' | 'forwardPe' | 'pb' | 'ps' | 'pfcf'
  | 'roe' | 'roic' | 'grossMargin' | 'netMargin' | 'fcfMargin'
  | 'debtToEbitda' | 'dividendYield' | 'payoutRatio'
  | 'revenueGrowth' | 'epsGrowth' | 'piotroski' | 'altmanZ' | 'qualityScore'

export interface RangeFilter { min?: number; max?: number }

export interface ScreenerFilters {
  numeric?: Partial<Record<NumericField, RangeFilter>>
  country?: string[]
  sector?: string[]
  exchange?: string[]
  preset?: 'quality' | 'growth' | 'value' | 'dividend' | 'small_cap' | 'pea'
  peaEligible?: boolean
  isEtf?: boolean
  similarTo?: string
  sortBy?: { field: NumericField; dir: 'asc' | 'desc' }
  limit?: number
}

export interface EnrichedStock {
  symbol: string; companyName: string; price: number; marketCap: number
  sector: string; industry: string; country: string; exchange: string
  beta: number; volume: number; change: number
  pe: number; forwardPe: number; pb: number; ps: number; pfcf: number
  roe: number; roic: number; grossMargin: number; netMargin: number; fcfMargin: number
  debtToEbitda: number; dividendYield: number; payoutRatio: number
  revenueGrowth: number; epsGrowth: number; piotroski: number; altmanZ: number
  qualityScore: number
}

export interface ParseResult {
  filters: ScreenerFilters
  explanation: string
  appliedChips: { label: string; field: string }[]
  confidence: number
  warnings?: string[]
}

// ── Field metadata for UI (label, unit, bounds) ──────────────────────────────
export const FIELD_META: Record<NumericField, { label: string; unit: string; min: number; max: number }> = {
  marketCap:     { label: 'Capitalisation', unit: '$',  min: 0, max: 1e13 },
  price:         { label: 'Prix',           unit: '$',  min: 0, max: 1e5 },
  beta:          { label: 'Bêta',           unit: '',   min: -2, max: 5 },
  pe:            { label: 'P/E',            unit: '',   min: 0, max: 200 },
  forwardPe:     { label: 'Forward P/E',    unit: '',   min: 0, max: 200 },
  pb:            { label: 'P/B',            unit: '',   min: 0, max: 50 },
  ps:            { label: 'P/S',            unit: '',   min: 0, max: 50 },
  pfcf:          { label: 'P/FCF',          unit: '',   min: 0, max: 100 },
  roe:           { label: 'ROE',            unit: '%',  min: -50, max: 200 },
  roic:          { label: 'ROIC',           unit: '%',  min: -50, max: 200 },
  grossMargin:   { label: 'Marge brute',    unit: '%',  min: 0, max: 100 },
  netMargin:     { label: 'Marge nette',    unit: '%',  min: -50, max: 100 },
  fcfMargin:     { label: 'Marge FCF',      unit: '%',  min: -50, max: 100 },
  debtToEbitda:  { label: 'Dette/EBITDA',   unit: 'x',  min: -2, max: 15 },
  dividendYield: { label: 'Rendement div.', unit: '%',  min: 0, max: 30 },
  payoutRatio:   { label: 'Payout',         unit: '%',  min: 0, max: 200 },
  revenueGrowth: { label: 'Croissance CA',  unit: '%',  min: -50, max: 200 },
  epsGrowth:     { label: 'Croissance EPS',  unit: '%', min: -50, max: 200 },
  piotroski:     { label: 'Piotroski',      unit: '/9', min: 0, max: 9 },
  altmanZ:       { label: 'Altman Z',       unit: '',   min: -10, max: 100 },
  qualityScore:  { label: 'Note Q',         unit: '/20', min: 0, max: 20 },
}

// ── Preset filter definitions ────────────────────────────────────────────────
export const PRESETS: Record<NonNullable<ScreenerFilters['preset']>, { label: string; emoji: string; filters: ScreenerFilters }> = {
  quality:   { label: 'Qualité',     emoji: '💎', filters: { numeric: { qualityScore: { min: 15 }, roe: { min: 15 }, debtToEbitda: { max: 3 } } } },
  growth:    { label: 'Croissance',  emoji: '🚀', filters: { numeric: { revenueGrowth: { min: 15 }, epsGrowth: { min: 15 } } } },
  value:     { label: 'Value',       emoji: '💰', filters: { numeric: { pe: { max: 18 }, pb: { max: 3 }, roe: { min: 10 } } } },
  dividend:  { label: 'Dividende',   emoji: '🏦', filters: { numeric: { dividendYield: { min: 2 }, payoutRatio: { max: 80 } } } },
  small_cap: { label: 'Small Caps',  emoji: '🔬', filters: { numeric: { marketCap: { max: 2e9 } } } },
  pea:       { label: 'PEA',         emoji: '🇪🇺', filters: { country: ['FR','DE','IT','ES','NL','BE','PT','IE','AT','FI'], peaEligible: true } },
}

// ── API calls ────────────────────────────────────────────────────────────────
export async function runScreener(filters: ScreenerFilters): Promise<{ stocks: EnrichedStock[]; total: number }> {
  const fn = httpsCallable<{ filters: ScreenerFilters }, { stocks: EnrichedStock[]; total: number }>(functions, 'fmpScreener')
  const res = await fn({ filters })
  return res.data
}

export async function parseNlQuery(query: string): Promise<ParseResult> {
  const fn = httpsCallable<{ query: string }, ParseResult>(functions, 'parseScreenerQuery')
  const res = await fn({ query })
  return res.data
}
