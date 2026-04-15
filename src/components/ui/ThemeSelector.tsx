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
          background: 'var(--tm-bg-card)',
          border: '1px solid rgba(var(--tm-purple-rgb,191,90,242),0.4)',
          borderRadius: 12,
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          <span style={{ fontSize: 18 }}>🔒</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tm-text-primary)' }}>Fonctionnalité Pro</div>
            <div style={{ fontSize: 11, color: 'var(--tm-text-secondary)', marginTop: 2 }}>Passe à Pro pour débloquer ce thème</div>
          </div>
        </div>
      ), { duration: 3000 })
      return
    }
    setTheme(name)
    toast.success(`Thème ${name} appliqué`, { duration: 1500 })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* Single-row theme strip */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${THEMES.length}, 1fr)`, gap: 8 }}>
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
                borderRadius: 10,
                overflow: 'hidden',
                cursor: isLocked ? 'not-allowed' : 'pointer',
                background: 'transparent',
                transition: 'all 0.2s',
                boxShadow: isActive ? `0 0 12px ${t.preview.accent}35` : 'none',
                opacity: isLocked && !isHoveringUpgrade ? 0.6 : 1,
              }}
            >
              {/* Compact preview */}
              <div style={{ background: t.preview.bg, padding: '6px 7px 4px' }}>
                {/* Mini P&L bars */}
                <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 14, marginBottom: 4 }}>
                  {[60, 80, 45, 90, 55, 70, 40].map((h, i) => (
                    <div key={i} style={{
                      flex: 1, borderRadius: 1,
                      height: `${h}%`,
                      background: i % 3 === 2 ? t.preview.loss : t.preview.profit,
                      opacity: 0.85,
                    }} />
                  ))}
                </div>
                {/* Accent line */}
                <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                  <div style={{ width: 4, height: 4, borderRadius: '50%', background: t.preview.accent, flexShrink: 0 }} />
                  <div style={{ flex: 1, height: 1, borderRadius: 1, background: `${t.preview.accent}50` }} />
                  <div style={{ fontSize: 8, color: t.preview.profit, fontFamily: 'monospace', fontWeight: 700 }}>+2.4%</div>
                </div>
              </div>

              {/* Label row */}
              <div style={{
                padding: '4px 7px 5px',
                background: t.preview.card,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 4,
              }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: isActive ? t.preview.accent : t.preview.text, whiteSpace: 'nowrap' }}>
                  {t.id === 'default' ? '✦ Default' : t.label}
                </span>
                {isLocked && (
                  <span style={{
                    fontSize: 8, fontWeight: 700,
                    background: 'rgba(var(--tm-purple-rgb,191,90,242),0.15)',
                    color: 'var(--tm-purple)',
                    border: '1px solid rgba(var(--tm-purple-rgb,191,90,242),0.3)',
                    padding: '1px 4px',
                    borderRadius: 3,
                  }}>
                    PRO
                  </span>
                )}
                {isActive && !isLocked && (
                  <span style={{
                    fontSize: 8, fontWeight: 700,
                    background: `${t.preview.accent}20`,
                    color: t.preview.accent,
                    border: `1px solid ${t.preview.accent}40`,
                    padding: '1px 4px',
                    borderRadius: 3,
                  }}>
                    ✓
                  </span>
                )}
              </div>

              {/* Upgrade overlay on hover (locked themes) */}
              {isLocked && isHoveringUpgrade && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(0,0,0,0.72)',
                  backdropFilter: 'blur(2px)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  borderRadius: 8,
                }}>
                  <span style={{ fontSize: 14 }}>🔒</span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--tm-purple)' }}>Pro requis</span>
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Active theme description — compact */}
      {THEMES.map(t => t.id === theme && (
        <div key={t.id} style={{
          fontSize: 11, color: 'var(--tm-text-secondary)',
          padding: '6px 10px',
          background: 'var(--tm-bg-secondary)',
          borderRadius: 7,
          border: '1px solid var(--tm-border)',
        }}>
          <span style={{ color: 'var(--tm-accent)', fontWeight: 600 }}>{t.label}</span> — {t.description}
        </div>
      ))}
    </div>
  )
}
