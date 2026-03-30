// ─── ThemeSelector ────────────────────────────────────────────────────────────
// Composant de sélection de thème avec aperçu visuel et verrouillage premium.

import { useState } from 'react'
import { useTheme, THEMES, type ThemeName } from '@/contexts/ThemeContext'
import toast from 'react-hot-toast'

export function ThemeSelector() {
  const { theme, setTheme, isPremium } = useTheme()
  const [hoveredUpgrade, setHoveredUpgrade] = useState<ThemeName | null>(null)

  function handleClick(name: ThemeName, isPremiumTheme: boolean) {
    if (isPremiumTheme && !isPremium) {
      toast.custom((t) => (
        <div style={{
          background: '#1C2133',
          border: '1px solid rgba(191,90,242,0.4)',
          borderRadius: 12,
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          <span style={{ fontSize: 18 }}>🔒</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#F0F3FF' }}>Fonctionnalité Pro</div>
            <div style={{ fontSize: 11, color: '#8F94A3', marginTop: 2 }}>Passe à Pro pour débloquer ce thème</div>
          </div>
        </div>
      ), { duration: 3000 })
      return
    }
    setTheme(name)
    toast.success(`Thème ${name} appliqué`, { duration: 1500 })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--tm-text-primary)' }}>Thème d'interface</span>
        <span style={{ fontSize: 11, color: 'var(--tm-text-secondary)', marginLeft: 'auto' }}>
          Appliqué instantanément
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {THEMES.map((t) => {
          const isActive = theme === t.id
          const isLocked = t.isPremium && !isPremium
          const isHoveringUpgrade = hoveredUpgrade === t.id

          return (
            <button
              key={t.id}
              onClick={() => handleClick(t.id, t.isPremium)}
              onMouseEnter={() => isLocked && setHoveredUpgrade(t.id)}
              onMouseLeave={() => setHoveredUpgrade(null)}
              style={{
                position: 'relative',
                padding: 0,
                border: `2px solid ${isActive ? t.preview.accent : 'var(--tm-border)'}`,
                borderRadius: 14,
                overflow: 'hidden',
                cursor: isLocked ? 'not-allowed' : 'pointer',
                background: 'transparent',
                transition: 'all 0.2s',
                transform: isActive ? 'scale(1.02)' : 'scale(1)',
                boxShadow: isActive ? `0 0 20px ${t.preview.accent}40` : 'none',
                opacity: isLocked && !isHoveringUpgrade ? 0.65 : 1,
              }}
            >
              {/* Theme preview miniature */}
              <div style={{ background: t.preview.bg, padding: 10 }}>
                {/* Mini card */}
                <div style={{
                  background: t.preview.card,
                  borderRadius: 8,
                  padding: '8px 10px',
                  marginBottom: 6,
                  border: `1px solid ${t.preview.accent}30`,
                }}>
                  <div style={{ fontSize: 10, color: t.preview.text, fontWeight: 700, fontFamily: 'monospace', marginBottom: 4 }}>
                    {t.label.toUpperCase()}
                  </div>
                  {/* Mini P&L bars */}
                  <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 20 }}>
                    {[60, 80, 45, 90, 55, 70, 40].map((h, i) => (
                      <div key={i} style={{
                        flex: 1, borderRadius: 2,
                        height: `${h}%`,
                        background: i % 3 === 2 ? t.preview.loss : t.preview.profit,
                        opacity: 0.8,
                      }} />
                    ))}
                  </div>
                </div>
                {/* Accent line */}
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: t.preview.accent }} />
                  <div style={{ flex: 1, height: 2, borderRadius: 1, background: `${t.preview.accent}40` }} />
                  <div style={{ fontSize: 9, color: t.preview.profit, fontFamily: 'monospace', fontWeight: 700 }}>+2.4%</div>
                </div>
              </div>

              {/* Label */}
              <div style={{
                padding: '6px 10px 8px',
                background: t.preview.card,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: isActive ? t.preview.accent : t.preview.text }}>
                  {t.label}
                </span>
                {isLocked && (
                  <span style={{
                    fontSize: 9, fontWeight: 700,
                    background: 'rgba(191,90,242,0.15)',
                    color: '#BF5AF2',
                    border: '1px solid rgba(191,90,242,0.3)',
                    padding: '1px 5px',
                    borderRadius: 4,
                    letterSpacing: '0.05em',
                  }}>
                    PRO
                  </span>
                )}
                {isActive && !isLocked && (
                  <span style={{
                    fontSize: 9, fontWeight: 700,
                    background: `${t.preview.accent}20`,
                    color: t.preview.accent,
                    border: `1px solid ${t.preview.accent}40`,
                    padding: '1px 5px',
                    borderRadius: 4,
                  }}>
                    ✓ ACTIF
                  </span>
                )}
              </div>

              {/* Upgrade overlay on hover (locked themes) */}
              {isLocked && isHoveringUpgrade && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(0,0,0,0.7)',
                  backdropFilter: 'blur(2px)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  borderRadius: 12,
                }}>
                  <span style={{ fontSize: 20 }}>🔒</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#BF5AF2' }}>Pro requis</span>
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Description */}
      {THEMES.map(t => t.id === theme && (
        <div key={t.id} style={{
          fontSize: 11, color: 'var(--tm-text-secondary)',
          padding: '8px 12px',
          background: 'var(--tm-bg-secondary)',
          borderRadius: 8,
          border: '1px solid var(--tm-border)',
        }}>
          <span style={{ color: 'var(--tm-accent)', fontWeight: 600 }}>{t.label}</span> — {t.description}
        </div>
      ))}
    </div>
  )
}
