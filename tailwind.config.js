/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Design system calqué sur l'app iOS (DesignSystem.swift)
        bg: {
          primary:   '#0D1117',  // fond principal (plus sombre que iOS pour le web)
          secondary: '#161B22',  // cartes
          tertiary:  '#1C2130',  // éléments secondaires
          card:      '#1C2133',  // équivalent cardBackground iOS
        },
        brand: {
          cyan:    '#00E5FF',    // accent principal web (cyan)
          blue:    '#0A85FF',    // primary iOS
          green:   '#22C759',    // success / profit
          purple:  '#BF5AF2',    // accent iOS
        },
        profit:  '#22C759',
        loss:    '#FF3B30',
        warning: '#FF9500',
        border: {
          DEFAULT: '#2A2F3E',
          subtle:  '#1E2330',
        },
        text: {
          primary:   '#F0F3FF',
          secondary: '#8F94A3',
          tertiary:  '#555C70',
          muted:     '#3D4254',
        },
      },
      fontFamily: {
        sans:  ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono:  ['"JetBrains Mono"', 'monospace'],
        display: ['"Syne"', 'sans-serif'],
      },
      backgroundImage: {
        'noise': "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E\")",
      },
      animation: {
        'fade-in':    'fadeIn 0.3s ease-out',
        'slide-up':   'slideUp 0.3s ease-out',
        'slide-in':   'slideIn 0.25s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'ticker':     'ticker 30s linear infinite',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' },                    to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        slideIn: { from: { opacity: '0', transform: 'translateX(-8px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        ticker:  { from: { transform: 'translateX(0)' },      to: { transform: 'translateX(-50%)' } },
      },
      boxShadow: {
        'card':  '0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.5)',
        'glow-cyan':  '0 0 20px rgba(0,229,255,0.15)',
        'glow-green': '0 0 20px rgba(34,199,89,0.15)',
      },
      borderRadius: {
        'xl': '12px',
        '2xl': '16px',
      },
    },
  },
  plugins: [],
}
