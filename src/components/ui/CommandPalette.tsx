// CommandPalette.tsx — Cmd+K global navigation overlay
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

interface CommandItem {
  id: string
  icon: string
  label: string
  description: string
  action: () => void
  keywords: string[]
}

interface Props {
  open: boolean
  onClose: () => void
}

export default function CommandPalette({ open, onClose }: Props) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const PAGES: CommandItem[] = [
    { id: 'dashboard',   icon: '🏠', label: 'Dashboard',      description: 'Tableau de bord performance',            action: () => navigate('/app'),             keywords: ['home', 'accueil', 'dashboard'] },
    { id: 'analyse',     icon: '📊', label: 'Analyse',         description: 'Analyse technique multi-timeframe',      action: () => navigate('/app/analyse'),     keywords: ['chart', 'graphique', 'analyse', 'technique'] },
    { id: 'marches',     icon: '📈', label: 'Marchés',         description: 'Crypto · Actions · Forex · Screener',    action: () => navigate('/app/marches'),     keywords: ['crypto', 'stocks', 'forex', 'screener', 'marche'] },
    { id: 'alertes',     icon: '⚡', label: 'Alertes',         description: 'Alertes personnalisées + Discord',        action: () => navigate('/app/alertes'),     keywords: ['alert', 'notification', 'discord', 'webhook'] },
    { id: 'journal',     icon: '📝', label: 'Journal',         description: 'Journal de trading',                     action: () => navigate('/app/journal'),     keywords: ['journal', 'trade', 'historique'] },
    { id: 'trades',      icon: '💹', label: 'Trades',          description: 'Positions et performances',              action: () => navigate('/app/trades'),      keywords: ['position', 'pnl', 'performance', 'bilan'] },
    { id: 'whales',      icon: '🐋', label: 'Whale Alerts',    description: 'Mouvements on-chain et baleines',        action: () => navigate('/app/whales'),      keywords: ['whale', 'baleine', 'on-chain', 'onchain'] },
    { id: 'calendrier',  icon: '📅', label: 'Calendrier',      description: 'Earnings · Macro · Géopolitique',        action: () => navigate('/app/calendrier'), keywords: ['calendrier', 'earnings', 'macro', 'economique'] },
    { id: 'profil',      icon: '👤', label: 'Profil',          description: 'Mon profil trader',                      action: () => navigate('/app/profil'),      keywords: ['profil', 'profile', 'account', 'compte'] },
    { id: 'settings',    icon: '⚙️', label: 'Paramètres',      description: 'Thème · Langue · Notifications',         action: () => navigate('/app/settings'),    keywords: ['settings', 'parametres', 'theme', 'langue'] },
  ]

  const filtered: CommandItem[] = (() => {
    const q = query.toLowerCase().trim()
    if (!q) return PAGES

    // Symbol shortcut: 2-8 letters → "Analyser BTCUSDT"
    const symbolItem: CommandItem | null = /^[a-zA-Z]{2,8}$/.test(query) ? {
      id: `sym_${q}`,
      icon: '🔍',
      label: `Analyser ${query.toUpperCase()}`,
      description: 'Ouvrir dans la page Analyse',
      action: () => navigate(`/app/analyse?symbol=${query.toUpperCase()}`),
      keywords: [],
    } : null

    const matchedPages = PAGES.filter(p =>
      p.label.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.keywords.some(k => k.includes(q))
    )

    return symbolItem ? [symbolItem, ...matchedPages] : matchedPages
  })()

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      setTimeout(() => inputRef.current?.focus(), 40)
    }
  }, [open])

  // Reset selection on query change
  useEffect(() => { setSelected(0) }, [query])

  // Keyboard navigation
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelected(s => Math.min(s + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelected(s => Math.max(s - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        filtered[selected]?.action()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, selected, filtered, onClose])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '14vh',
        background: 'rgba(0,0,0,0.72)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 560, margin: '0 16px',
          background: 'var(--tm-bg-secondary)',
          border: '1px solid rgba(var(--tm-accent-rgb,0,229,255),0.22)',
          borderRadius: 16,
          boxShadow: '0 32px 80px rgba(0,0,0,0.9), 0 0 0 1px rgba(var(--tm-accent-rgb,0,229,255),0.04)',
          overflow: 'hidden',
          animation: 'cmdFadeIn 0.15s ease-out',
        }}
      >
        <style>{`@keyframes cmdFadeIn{from{opacity:0;transform:translateY(-8px) scale(0.98)}to{opacity:1;transform:none}}`}</style>

        {/* Search bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--tm-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Rechercher ou naviguer..."
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              fontSize: 15, color: 'var(--tm-text-primary)',
              fontFamily: 'DM Sans, sans-serif',
            }}
          />
          <kbd style={{
            padding: '2px 7px', borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.1)',
            fontSize: 11, color: 'var(--tm-text-muted)',
            fontFamily: 'JetBrains Mono, monospace', flexShrink: 0,
          }}>ESC</kbd>
        </div>

        {/* Results list */}
        <div style={{ maxHeight: 380, overflowY: 'auto', padding: '6px 8px' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--tm-text-muted)', fontSize: 13 }}>
              Aucun résultat pour « {query} »
            </div>
          ) : (
            filtered.map((item, idx) => (
              <button
                key={item.id}
                onClick={() => { item.action(); onClose() }}
                onMouseEnter={() => setSelected(idx)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px', borderRadius: 10,
                  border: 'none', cursor: 'pointer', textAlign: 'left',
                  background: idx === selected ? 'rgba(var(--tm-accent-rgb,0,229,255),0.09)' : 'transparent',
                  transition: 'background 0.1s',
                }}
              >
                <span style={{ fontSize: 20, width: 28, textAlign: 'center', flexShrink: 0 }}>{item.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 14, fontWeight: 500,
                    color: idx === selected ? 'var(--tm-accent)' : 'var(--tm-text-primary)',
                  }}>{item.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--tm-text-muted)', marginTop: 1 }}>{item.description}</div>
                </div>
                {idx === selected && (
                  <kbd style={{
                    padding: '2px 7px', borderRadius: 6,
                    border: '1px solid rgba(var(--tm-accent-rgb,0,229,255),0.3)',
                    fontSize: 11, color: 'var(--tm-accent)',
                    fontFamily: 'JetBrains Mono, monospace', flexShrink: 0,
                  }}>↵</kbd>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer hints */}
        <div style={{
          padding: '8px 16px',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          display: 'flex', gap: 16,
          fontSize: 11, color: 'var(--tm-text-muted)',
          fontFamily: 'JetBrains Mono, monospace',
        }}>
          <span>↑↓ naviguer</span>
          <span>↵ ouvrir</span>
          <span>ESC fermer</span>
          <span style={{ marginLeft: 'auto' }}>Cmd+K</span>
        </div>
      </div>
    </div>
  )
}
