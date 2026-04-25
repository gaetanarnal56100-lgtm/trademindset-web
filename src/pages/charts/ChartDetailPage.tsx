// src/pages/charts/ChartDetailPage.tsx
import { useParams, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { CHARTS_META } from './ChartsPage'

const CATEGORY_COLORS: Record<string, string> = {
  performance: '#34C759',
  risk: '#FF9500',
  structure: '#FF453A',
  onchain: '#0A85FF',
  macro: '#BF5AF2',
}

function getCategoryRgb(category: string): string {
  const map: Record<string, string> = {
    performance: '52,199,89',
    risk: '255,149,0',
    structure: '255,69,58',
    onchain: '10,133,255',
    macro: '191,90,242',
  }
  return map[category] ?? '0,229,255'
}

export default function ChartDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const chart = CHARTS_META.find((c) => c.id === id)

  if (!chart) {
    return (
      <div style={{
        padding: 32,
        maxWidth: 1000,
        margin: '0 auto',
        color: 'rgba(255,255,255,0.5)',
        textAlign: 'center',
        paddingTop: 80,
      }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🔍</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>
          Indicateur introuvable
        </div>
        <div style={{ fontSize: 14, marginBottom: 24 }}>
          L'indicateur "{id}" n'existe pas dans la bibliothèque.
        </div>
        <button
          onClick={() => navigate('/app/charts')}
          style={{
            padding: '10px 20px',
            borderRadius: 10,
            background: 'rgba(0,229,255,0.1)',
            border: '1px solid rgba(0,229,255,0.3)',
            color: '#00E5FF',
            fontWeight: 700,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          ← Retour aux Charts
        </button>
      </div>
    )
  }

  const catColor = CATEGORY_COLORS[chart.category] ?? '#00E5FF'
  const catRgb = getCategoryRgb(chart.category)
  const catLabel = chart.category.charAt(0).toUpperCase() + chart.category.slice(1)
  const assetLabel = chart.assets === 'btc' ? '₿ BTC' : chart.assets === 'crypto' ? '🪙 Crypto' : '🌐 Tous'

  const similar = CHARTS_META.filter((c) => c.category === chart.category && c.id !== chart.id).slice(0, 3)

  return (
    <div style={{
      padding: '32px',
      maxWidth: 1000,
      margin: '0 auto',
      minHeight: '100vh',
      backgroundImage: `
        linear-gradient(rgba(0,229,255,0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0,229,255,0.02) 1px, transparent 1px)
      `,
      backgroundSize: '40px 40px',
    }}>

      {/* BACK BUTTON */}
      <button
        onClick={() => navigate('/app/charts')}
        style={{
          background: 'none',
          border: 'none',
          color: '#00E5FF',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        ← Tous les charts
      </button>

      {/* HERO CARD */}
      <div style={{
        marginTop: 16,
        background: 'rgba(8,12,22,0.9)',
        border: `1px solid rgba(${catRgb},0.2)`,
        borderRadius: 20,
        padding: '24px 28px',
      }}>
        {/* Badges row */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{
            background: `rgba(${catRgb},0.12)`,
            border: `1px solid rgba(${catRgb},0.3)`,
            color: catColor,
            fontSize: 11,
            fontWeight: 700,
            padding: '4px 10px',
            borderRadius: 6,
          }}>{catLabel}</span>
          <span style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'rgba(255,255,255,0.5)',
            fontSize: 11,
            fontWeight: 600,
            padding: '4px 10px',
            borderRadius: 6,
          }}>{assetLabel}</span>
          {chart.new && (
            <span style={{
              background: 'rgba(52,199,89,0.15)',
              border: '1px solid rgba(52,199,89,0.4)',
              color: '#34C759',
              fontSize: 10,
              fontWeight: 800,
              padding: '3px 8px',
              borderRadius: 5,
              letterSpacing: '0.05em',
            }}>NEW</span>
          )}
          {chart.premium && (
            <span style={{
              background: 'rgba(191,90,242,0.15)',
              border: '1px solid rgba(191,90,242,0.4)',
              color: '#BF5AF2',
              fontSize: 10,
              fontWeight: 800,
              padding: '3px 8px',
              borderRadius: 5,
              letterSpacing: '0.05em',
            }}>PRO</span>
          )}
        </div>

        {/* Emoji */}
        <div style={{ fontSize: 40, marginTop: 16, lineHeight: 1 }}>{chart.emoji}</div>

        {/* Title */}
        <h1 style={{
          fontSize: 24,
          fontWeight: 900,
          fontFamily: 'Syne, sans-serif',
          color: '#fff',
          margin: '12px 0 0',
          letterSpacing: '-0.02em',
        }}>
          {chart.name}
        </h1>

        {/* Description */}
        <p style={{
          fontSize: 14,
          color: 'rgba(255,255,255,0.6)',
          lineHeight: 1.6,
          marginTop: 8,
          marginBottom: 0,
        }}>
          {chart.description}
        </p>
      </div>

      {/* INTERPRETATION CALLOUT */}
      <div style={{
        marginTop: 16,
        background: 'rgba(0,229,255,0.05)',
        borderLeft: '3px solid #00E5FF',
        padding: '14px 18px',
        borderRadius: '0 10px 10px 0',
      }}>
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: '#00E5FF',
          marginBottom: 8,
        }}>
          💡 Interprétation
        </div>
        <p style={{
          fontSize: 13,
          color: 'rgba(255,255,255,0.7)',
          lineHeight: 1.6,
          margin: 0,
        }}>
          {chart.interpretation}
        </p>
      </div>

      {/* CHART AREA */}
      <div style={{
        marginTop: 16,
        background: 'rgba(8,12,22,0.9)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 20,
        padding: '28px 24px',
        textAlign: 'center',
      }}>
        <div style={{
          fontSize: 14,
          fontWeight: 800,
          fontFamily: 'Syne, sans-serif',
          color: '#fff',
          marginBottom: 8,
        }}>
          Visualisation Interactive
        </div>
        <div style={{
          fontSize: 13,
          color: 'rgba(255,255,255,0.4)',
          marginBottom: 24,
        }}>
          Ce chart est disponible dans la section Analyse → onglet Charts
        </div>

        {/* Chart placeholder */}
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px dashed rgba(255,255,255,0.1)',
          borderRadius: 12,
          height: 220,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 12,
          marginBottom: 24,
        }}>
          <span style={{ fontSize: 36 }}>{chart.emoji}</span>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)' }}>
            {chart.name}
          </span>
        </div>

        <button
          onClick={() => navigate('/app/analyse')}
          style={{
            padding: '12px 24px',
            borderRadius: 10,
            background: 'linear-gradient(135deg, #0A85FF, #BF5AF2)',
            color: '#fff',
            fontWeight: 700,
            cursor: 'pointer',
            border: 'none',
            fontSize: 14,
          }}
        >
          📊 Ouvrir dans Analyse
        </button>
      </div>

      {/* SIMILAR SECTION */}
      {similar.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{
            fontSize: 16,
            fontWeight: 800,
            fontFamily: 'Syne, sans-serif',
            color: '#fff',
            margin: '0 0 14px',
          }}>
            Indicateurs similaires
          </h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 12,
          }}>
            {similar.map((s) => (
              <SimilarCard
                key={s.id}
                chart={s}
                onClick={() => navigate(`/app/charts/${s.id}`)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

type ChartMeta = (typeof CHARTS_META)[number]

function SimilarCard({
  chart,
  onClick,
}: {
  chart: ChartMeta
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const catColor = CATEGORY_COLORS[chart.category] ?? '#00E5FF'
  const catRgb = getCategoryRgb(chart.category)

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'rgba(8,12,22,0.85)',
        border: hovered
          ? `1px solid rgba(${catRgb},0.3)`
          : '1px solid rgba(255,255,255,0.07)',
        borderRadius: 14,
        padding: 16,
        cursor: 'pointer',
        transition: 'all 0.2s',
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 20 }}>{chart.emoji}</span>
        <div style={{
          fontSize: 13,
          fontWeight: 700,
          fontFamily: 'Syne, sans-serif',
          color: '#fff',
          lineHeight: 1.3,
        }}>
          {chart.name}
        </div>
      </div>
      <p style={{
        fontSize: 11,
        color: 'rgba(255,255,255,0.45)',
        lineHeight: 1.5,
        margin: '0 0 10px',
      }}>
        {chart.description}
      </p>
      <button
        style={{
          background: `rgba(${catRgb},0.1)`,
          border: `1px solid rgba(${catRgb},0.25)`,
          borderRadius: 7,
          padding: '5px 12px',
          fontSize: 11,
          fontWeight: 700,
          color: catColor,
          cursor: 'pointer',
          width: '100%',
        }}
      >
        Voir →
      </button>
    </div>
  )
}
