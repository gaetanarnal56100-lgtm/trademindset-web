// src/pages/charts/ChartsPage.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

type Category = 'all' | 'performance' | 'risk' | 'onchain' | 'macro' | 'structure'
type AssetFilter = 'all' | 'btc' | 'crypto' | 'stocks'

interface ChartMeta {
  id: string
  name: string
  description: string
  interpretation: string
  category: Exclude<Category, 'all'>
  assets: Exclude<AssetFilter, 'stocks'>
  emoji: string
  premium?: boolean
  new?: boolean
}

export const CHARTS_META: ChartMeta[] = [
  {
    id: 'btc-hero',
    name: 'BTC Price + MA50/200',
    description: 'Prix Bitcoin avec moyennes mobiles 50/200 jours et zones bull/bear',
    interpretation: 'Les croisements MA50/MA200 signalent des changements de tendance majeurs. Zone verte = bull market, rouge = bear market.',
    category: 'structure',
    assets: 'btc',
    emoji: '₿',
  },
  {
    id: 'monthly-returns',
    name: 'Rendements Mensuels',
    description: 'Heatmap calendrier des performances mensuelles historiques',
    interpretation: 'Les mois rouges répétés signalent une tendance baissière structurelle. Les mois verts consécutifs indiquent un momentum fort.',
    category: 'performance',
    assets: 'all',
    emoji: '📅',
  },
  {
    id: 'roi-periods',
    name: 'ROI Multi-Périodes',
    description: 'Retour sur investissement sur 7j / 30j / 90j / 1a',
    interpretation: 'Comparez la performance à différents horizons pour identifier le timing optimal.',
    category: 'performance',
    assets: 'all',
    emoji: '📈',
  },
  {
    id: 'price-horizons',
    name: 'Prix vs Historique',
    description: "Prix actuel comparé à il y a 30 / 90 / 180 / 365 jours",
    interpretation: "Visualiser combien un investissement à différentes périodes aurait rapporté aujourd'hui.",
    category: 'performance',
    assets: 'all',
    emoji: '🕰️',
  },
  {
    id: 'drawdown',
    name: 'Drawdown depuis ATH',
    description: 'Distance au plus haut historique dans le temps',
    interpretation: 'Un drawdown > 80% historiquement signale une zone de capitulation et de forte accumulation.',
    category: 'risk',
    assets: 'all',
    emoji: '📉',
  },
  {
    id: 'sharpe',
    name: 'Sharpe Ratio Glissant',
    description: 'Rendement ajusté au risque sur 365 jours glissants',
    interpretation: 'Sharpe > 1 = bon rendement/risque. < 0 = actif sous-performant le taux sans risque.',
    category: 'risk',
    assets: 'all',
    emoji: '⚖️',
  },
  {
    id: 'composite-risk',
    name: 'Score de Risque Composite',
    description: 'MVRV + Funding + L/S + Fear & Greed — jauge 0–100',
    interpretation: "Score > 70 = zone de distribution/vente. Score < 30 = zone d'accumulation/achat.",
    category: 'risk',
    assets: 'btc',
    emoji: '🛡️',
  },
  {
    id: 'death-golden-cross',
    name: 'Death / Golden Cross',
    description: 'Croisements SMA50 / SMA200 avec historique des signaux',
    interpretation: 'Golden Cross (SMA50 > SMA200) = signal haussier fort. Death Cross = signal baissier. Délai de confirmation recommandé.',
    category: 'structure',
    assets: 'all',
    emoji: '✂️',
  },
  {
    id: 'power-law',
    name: 'Power Law Corridor',
    description: 'Couloir de valorisation logarithmique BTC depuis 2009',
    interpretation: "BTC historiquement revient dans le couloir. Prix sous la médiane = zone d'achat attractive.",
    category: 'structure',
    assets: 'btc',
    emoji: '📐',
  },
  {
    id: 'mvrv',
    name: 'MVRV Z-Score',
    description: 'Market Value vs Realized Value — CoinMetrics Community',
    interpretation: 'MVRV > 3.5 = surchauffe historique (DCA/vente). < 1 = zone sous-évaluée rare.',
    category: 'onchain',
    assets: 'btc',
    emoji: '🔗',
  },
  {
    id: 'txcount',
    name: 'Transactions On-Chain',
    description: 'Nombre de transactions quotidiennes BTC — CoinMetrics',
    interpretation: "Augmentation du nombre de tx = adoption croissante. Baisse prolongée = activité faible.",
    category: 'onchain',
    assets: 'btc',
    emoji: '⛓️',
  },
  {
    id: 'altseason',
    name: 'Altcoin Season Index',
    description: '% des top altcoins surperformant BTC sur 90 jours',
    interpretation: 'Score > 75 = Alt Season actif. Score < 25 = Bitcoin Season. Zone 45–55 = marché neutre.',
    category: 'macro',
    assets: 'crypto',
    emoji: '🌙',
  },
  {
    id: 'market-breadth',
    name: 'Market Breadth',
    description: '% des top 20 cryptos au-dessus de leur MA200',
    interpretation: "Breadth > 70% = marché haussier généralisé. < 30% = capitulation large. Divergences avec BTC = signal d'alerte.",
    category: 'macro',
    assets: 'crypto',
    emoji: '🌡️',
  },
  {
    id: 'momentum-composite',
    name: 'Momentum Composite',
    description: 'RSI + Rate of Change + Pente MA — score 0–100',
    interpretation: 'Score > 70 = momentum fort haussier. < 30 = épuisement baissier. Divergences = retournement possible.',
    category: 'structure',
    assets: 'all',
    emoji: '⚡',
    new: true,
  },
]

const CATEGORY_COLORS: Record<Exclude<Category, 'all'> | 'all', string> = {
  all: '#8E8E93',
  performance: '#34C759',
  risk: '#FF9500',
  structure: '#FF453A',
  onchain: '#0A85FF',
  macro: '#BF5AF2',
}

const CATEGORY_LABELS: Record<Category, string> = {
  all: '🔭 Tous',
  performance: '📈 Perf',
  risk: '⚠️ Risque',
  structure: '🏗️ Structure',
  onchain: '⛓️ On-Chain',
  macro: '🌍 Macro',
}

const ASSET_LABELS: Record<AssetFilter, string> = {
  all: 'Tous',
  btc: '₿ BTC only',
  crypto: '🪙 Crypto',
  stocks: 'Stocks',
}

function getCategoryRgb(category: Exclude<Category, 'all'>): string {
  const map: Record<Exclude<Category, 'all'>, string> = {
    performance: '52,199,89',
    risk: '255,149,0',
    structure: '255,69,58',
    onchain: '10,133,255',
    macro: '191,90,242',
  }
  return map[category]
}

export default function ChartsPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<Category>('all')
  const [assetFilter, setAssetFilter] = useState<AssetFilter>('all')

  const visible = CHARTS_META.filter((c) => {
    const q = search.toLowerCase()
    if (q && !c.name.toLowerCase().includes(q) && !c.description.toLowerCase().includes(q)) return false
    if (category !== 'all' && c.category !== category) return false
    if (assetFilter !== 'all' && c.assets !== assetFilter) return false
    return true
  })

  const categories: Category[] = ['all', 'performance', 'risk', 'structure', 'onchain', 'macro']
  const assetFilters: AssetFilter[] = ['all', 'btc', 'crypto']

  return (
    <div style={{
      padding: '32px',
      maxWidth: '1400px',
      margin: '0 auto',
      minHeight: '100vh',
      background: `
        linear-gradient(135deg, rgba(8,12,22,1) 0%, rgba(10,16,28,1) 100%)
      `,
      backgroundImage: `
        linear-gradient(rgba(0,229,255,0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0,229,255,0.02) 1px, transparent 1px)
      `,
      backgroundSize: '40px 40px',
    }}>

      {/* HEADER */}
      <div>
        <h1 style={{
          fontSize: 28,
          fontFamily: 'Syne, sans-serif',
          fontWeight: 800,
          color: '#fff',
          margin: 0,
          letterSpacing: '-0.02em',
        }}>
          📊 Charts Analytics
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, margin: '6px 0 0' }}>
          Bibliothèque d'indicateurs analytiques crypto
        </p>
        <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, margin: '4px 0 0' }}>
          {CHARTS_META.length} indicateurs · 5 catégories · Données temps réel
        </p>
      </div>

      {/* CONTROLS */}
      <div style={{ marginTop: 24, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un indicateur…"
          style={{
            width: 260,
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10,
            padding: '8px 14px',
            color: 'white',
            fontSize: 12,
            outline: 'none',
          }}
        />

        {/* Category pills */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {categories.map((cat) => {
            const isActive = category === cat
            const color = CATEGORY_COLORS[cat]
            return (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: isActive ? `1px solid ${color}` : '1px solid rgba(255,255,255,0.08)',
                  background: isActive ? color : 'rgba(255,255,255,0.06)',
                  color: isActive ? '#fff' : 'rgba(255,255,255,0.5)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            )
          })}
        </div>

        {/* Asset filter pills */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {assetFilters.map((af) => {
            const isActive = assetFilter === af
            return (
              <button
                key={af}
                onClick={() => setAssetFilter(af)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: isActive ? '1px solid rgba(0,229,255,0.4)' : '1px solid rgba(255,255,255,0.08)',
                  background: isActive ? 'rgba(0,229,255,0.15)' : 'rgba(255,255,255,0.06)',
                  color: isActive ? '#00E5FF' : 'rgba(255,255,255,0.5)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {ASSET_LABELS[af]}
              </button>
            )
          })}
        </div>

        {/* Results count */}
        <div style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
          {visible.length} résultats
        </div>
      </div>

      {/* GRID */}
      {visible.length === 0 ? (
        <div style={{
          textAlign: 'center',
          color: 'rgba(255,255,255,0.3)',
          fontSize: 14,
          marginTop: 60,
          padding: '40px 0',
        }}>
          Aucun indicateur trouvé pour cette recherche.
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 16,
          marginTop: 16,
        }}>
          {visible.map((chart) => {
            const catColor = CATEGORY_COLORS[chart.category]
            const catRgb = getCategoryRgb(chart.category)
            return (
              <ChartCard
                key={chart.id}
                chart={chart}
                catColor={catColor}
                catRgb={catRgb}
                onClick={() => navigate(`/app/charts/${chart.id}`)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function ChartCard({
  chart,
  catColor,
  catRgb,
  onClick,
}: {
  chart: ChartMeta
  catColor: string
  catRgb: string
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)

  const assetLabel = chart.assets === 'btc' ? '₿ BTC' : chart.assets === 'crypto' ? '🪙 Crypto' : '🌐 Tous'
  const catLabel = chart.category.charAt(0).toUpperCase() + chart.category.slice(1)

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'rgba(8,12,22,0.85)',
        border: hovered
          ? `1px solid rgba(${catRgb},0.35)`
          : '1px solid rgba(255,255,255,0.07)',
        borderRadius: 16,
        padding: 20,
        cursor: 'pointer',
        transition: 'all 0.2s',
        transform: hovered ? 'translateY(-3px)' : 'translateY(0)',
        boxShadow: hovered
          ? `0 12px 40px rgba(${catRgb},0.12)`
          : '0 2px 8px rgba(0,0,0,0.2)',
      }}
    >
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 24 }}>{chart.emoji}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {chart.new && (
            <span style={{
              background: 'rgba(52,199,89,0.15)',
              border: '1px solid rgba(52,199,89,0.4)',
              color: '#34C759',
              fontSize: 9,
              fontWeight: 800,
              padding: '2px 6px',
              borderRadius: 4,
              letterSpacing: '0.05em',
            }}>NEW</span>
          )}
          {chart.premium && (
            <span style={{
              background: 'rgba(191,90,242,0.15)',
              border: '1px solid rgba(191,90,242,0.4)',
              color: '#BF5AF2',
              fontSize: 9,
              fontWeight: 800,
              padding: '2px 6px',
              borderRadius: 4,
              letterSpacing: '0.05em',
            }}>PRO</span>
          )}
          <span style={{
            background: `rgba(${catRgb},0.12)`,
            border: `1px solid rgba(${catRgb},0.25)`,
            color: catColor,
            fontSize: 10,
            fontWeight: 700,
            padding: '3px 8px',
            borderRadius: 6,
          }}>{catLabel}</span>
        </div>
      </div>

      {/* Title */}
      <div style={{
        fontSize: 15,
        fontWeight: 800,
        fontFamily: 'Syne, sans-serif',
        color: '#fff',
        marginTop: 10,
        lineHeight: 1.3,
      }}>
        {chart.name}
      </div>

      {/* Description */}
      <div style={{
        fontSize: 12,
        color: 'rgba(255,255,255,0.5)',
        lineHeight: 1.5,
        marginTop: 6,
      }}>
        {chart.description}
      </div>

      {/* Asset badge */}
      <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
        <span style={{
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.1)',
          color: 'rgba(255,255,255,0.5)',
          fontSize: 10,
          fontWeight: 600,
          padding: '3px 8px',
          borderRadius: 6,
        }}>
          {assetLabel}
        </span>
      </div>

      {/* CTA button */}
      <button
        style={{
          width: '100%',
          marginTop: 12,
          background: `rgba(${catRgb},0.1)`,
          border: `1px solid rgba(${catRgb},0.25)`,
          borderRadius: 8,
          padding: '7px 0',
          fontSize: 11,
          fontWeight: 700,
          color: catColor,
          cursor: 'pointer',
          transition: 'all 0.15s',
        }}
      >
        Analyser →
      </button>
    </div>
  )
}
