// ─── Modular Dashboard Types ────────────────────────────────────────────────
// Central type definitions for the drag-and-drop widget system

export type WidgetId =
  | 'pnl_curve'
  | 'mtf_dashboard'
  | 'rsi_block'
  | 'macd_block'
  | 'divergence_block'
  | 'sr_block'
  | 'volume_cvd'
  | 'trade_stats'
  | 'news_ticker'
  | 'trade_plan'

export type WidgetSize = 'sm' | 'md' | 'lg' | 'xl' | 'full'

export interface WidgetConfig {
  id: WidgetId
  label: string
  icon: string
  description: string
  defaultSize: WidgetSize
  minSize: WidgetSize
  maxSize: WidgetSize
  category: 'analysis' | 'chart' | 'info' | 'journal'
  accentColor: string
}

export interface LayoutItem {
  id: string           // unique instance id (widgetId + optional suffix)
  widgetId: WidgetId
  size: WidgetSize
  visible: boolean
  order: number
}

export type PresetName = 'scalping' | 'swing' | 'custom'

export interface DashboardPreset {
  name: PresetName
  label: string
  description: string
  layout: Omit<LayoutItem, 'order'>[]
}

// ─── Size → Tailwind col spans ───────────────────────────────────────────────
export const SIZE_COLS: Record<WidgetSize, string> = {
  sm:   'col-span-1',
  md:   'col-span-2',
  lg:   'col-span-3',
  xl:   'col-span-4',
  full: 'col-span-full',
}

export const SIZE_LABELS: Record<WidgetSize, string> = {
  sm: 'S', md: 'M', lg: 'L', xl: 'XL', full: '—'
}

// ─── Widget registry ─────────────────────────────────────────────────────────
export const WIDGET_REGISTRY: Record<WidgetId, WidgetConfig> = {
  pnl_curve: {
    id: 'pnl_curve', label: 'P&L Curve', icon: '📈',
    description: 'Courbe de performance cumulée',
    defaultSize: 'lg', minSize: 'md', maxSize: 'full',
    category: 'chart', accentColor: '#22C759',
  },
  mtf_dashboard: {
    id: 'mtf_dashboard', label: 'MTF Dashboard', icon: '⏱',
    description: 'Signaux multi-timeframes (M5→M3)',
    defaultSize: 'xl', minSize: 'lg', maxSize: 'full',
    category: 'analysis', accentColor: '#00E5FF',
  },
  rsi_block: {
    id: 'rsi_block', label: 'RSI', icon: '〰',
    description: 'RSI multi-TF avec divergences',
    defaultSize: 'sm', minSize: 'sm', maxSize: 'lg',
    category: 'analysis', accentColor: '#0A85FF',
  },
  macd_block: {
    id: 'macd_block', label: 'MACD', icon: '⚡',
    description: 'MACD croisements et histogramme',
    defaultSize: 'sm', minSize: 'sm', maxSize: 'lg',
    category: 'analysis', accentColor: '#BF5AF2',
  },
  divergence_block: {
    id: 'divergence_block', label: 'Divergences', icon: '↕',
    description: 'Détection divergences haussières/baissières',
    defaultSize: 'md', minSize: 'sm', maxSize: 'lg',
    category: 'analysis', accentColor: '#FF9500',
  },
  sr_block: {
    id: 'sr_block', label: 'Support / Résistance', icon: '⬌',
    description: 'Niveaux clés dynamiques',
    defaultSize: 'md', minSize: 'sm', maxSize: 'lg',
    category: 'analysis', accentColor: '#FF9500',
  },
  volume_cvd: {
    id: 'volume_cvd', label: 'Volume / CVD', icon: '📊',
    description: 'Delta cumulé et volume delta',
    defaultSize: 'md', minSize: 'sm', maxSize: 'xl',
    category: 'chart', accentColor: '#00E5FF',
  },
  trade_stats: {
    id: 'trade_stats', label: 'Statistiques', icon: '🎯',
    description: 'Win rate, R:R, expectancy',
    defaultSize: 'md', minSize: 'sm', maxSize: 'lg',
    category: 'journal', accentColor: '#22C759',
  },
  news_ticker: {
    id: 'news_ticker', label: 'Actualités', icon: '📰',
    description: 'News marché en temps réel',
    defaultSize: 'full', minSize: 'full', maxSize: 'full',
    category: 'info', accentColor: '#8F94A3',
  },
  trade_plan: {
    id: 'trade_plan', label: 'Trade Plan', icon: '🗒',
    description: 'Scénarios Bull / Bear IA',
    defaultSize: 'lg', minSize: 'md', maxSize: 'xl',
    category: 'analysis', accentColor: '#BF5AF2',
  },
}

// ─── Presets ─────────────────────────────────────────────────────────────────
export const DASHBOARD_PRESETS: Record<PresetName, DashboardPreset> = {
  scalping: {
    name: 'scalping', label: 'Scalping', description: 'Focus signaux court terme',
    layout: [
      { id: 'mtf_dashboard', widgetId: 'mtf_dashboard', size: 'full', visible: true },
      { id: 'rsi_block',     widgetId: 'rsi_block',     size: 'sm',   visible: true },
      { id: 'macd_block',    widgetId: 'macd_block',    size: 'sm',   visible: true },
      { id: 'volume_cvd',    widgetId: 'volume_cvd',    size: 'md',   visible: true },
      { id: 'trade_stats',   widgetId: 'trade_stats',   size: 'md',   visible: true },
    ],
  },
  swing: {
    name: 'swing', label: 'Swing', description: 'Vue macro + journal',
    layout: [
      { id: 'pnl_curve',        widgetId: 'pnl_curve',        size: 'xl',  visible: true },
      { id: 'mtf_dashboard',    widgetId: 'mtf_dashboard',    size: 'lg',  visible: true },
      { id: 'divergence_block', widgetId: 'divergence_block', size: 'md',  visible: true },
      { id: 'sr_block',         widgetId: 'sr_block',         size: 'md',  visible: true },
      { id: 'trade_plan',       widgetId: 'trade_plan',       size: 'lg',  visible: true },
      { id: 'trade_stats',      widgetId: 'trade_stats',      size: 'md',  visible: true },
    ],
  },
  custom: {
    name: 'custom', label: 'Custom', description: 'Configuration personnalisée',
    layout: [
      { id: 'pnl_curve',     widgetId: 'pnl_curve',     size: 'full', visible: true },
      { id: 'mtf_dashboard', widgetId: 'mtf_dashboard', size: 'full', visible: true },
      { id: 'trade_stats',   widgetId: 'trade_stats',   size: 'md',   visible: true },
      { id: 'trade_plan',    widgetId: 'trade_plan',    size: 'lg',   visible: true },
    ],
  },
}
