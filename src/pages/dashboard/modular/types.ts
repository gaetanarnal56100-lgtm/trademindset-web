// ─── Modular Dashboard Types v2 ──────────────────────────────────────────────
// Passe d'un système de tailles fixes (sm/md/lg) à un système de grille
// libre : chaque widget a un span de colonnes (w) et de lignes (h).
// La grille est en 12 colonnes, chaque rangée fait ROW_HEIGHT px.

export const GRID_COLS = 12
export const ROW_HEIGHT = 80   // px par unité de hauteur
export const COL_MIN   = 2    // colonnes minimum par widget
export const ROW_MIN   = 2    // rangées minimum par widget

export type WidgetId =
  | 'kpi_bar'
  | 'pnl_curve'
  | 'long_short'
  | 'main_metrics'
  | 'advanced_metrics'
  | 'heatmap'
  | 'advanced_analytics'
  | 'emotions'
  | 'recent_trades'
  | 'stats_summary'
  | 'mtf_dashboard'
  | 'rsi_block'
  | 'macd_block'
  | 'divergence_block'
  | 'sr_block'
  | 'volume_cvd'
  | 'trade_plan'
  | 'news_ticker'

export interface WidgetConfig {
  id: WidgetId
  label: string
  icon: string
  description: string
  defaultW: number   // colonnes par défaut (sur 12)
  defaultH: number   // rangées par défaut
  minW: number
  minH: number
  maxW: number
  maxH: number
  category: 'journal' | 'analysis' | 'chart' | 'info'
  accentColor: string
}

export interface LayoutItem {
  id: string
  widgetId: WidgetId
  x: number      // colonne de départ (0-based)
  y: number      // rangée de départ (0-based)
  w: number      // largeur en colonnes
  h: number      // hauteur en rangées
  visible: boolean
  order: number  // pour le tri en mode liste
}

export type PresetName = 'journal' | 'analyse' | 'custom'

export interface DashboardPreset {
  name: PresetName
  label: string
  description: string
  layout: Omit<LayoutItem, 'order'>[]
}

// ─── Widget registry ──────────────────────────────────────────────────────────
export const WIDGET_REGISTRY: Record<WidgetId, WidgetConfig> = {
  kpi_bar:            { id:'kpi_bar',            label:'KPIs',               icon:'📊', description:'P&L, Win Rate, R/R, Positions ouvertes', defaultW:12, defaultH:2, minW:6,  minH:2,  maxW:12, maxH:3,  category:'journal',  accentColor:'var(--tm-accent)' },
  pnl_curve:          { id:'pnl_curve',           label:'Courbe P&L',         icon:'📈', description:'Courbe de performance cumulée',           defaultW:12, defaultH:5, minW:4,  minH:3,  maxW:12, maxH:10, category:'chart',    accentColor:'var(--tm-profit)' },
  long_short:         { id:'long_short',          label:'Long / Short',       icon:'⇅',  description:'Win rate & P&L par direction',            defaultW:12, defaultH:3, minW:4,  minH:3,  maxW:12, maxH:6,  category:'journal',  accentColor:'var(--tm-profit)' },
  main_metrics:       { id:'main_metrics',        label:'Main Metrics',       icon:'💲', description:'Win rate, P&L, Payoff, Fees',             defaultW:6,  defaultH:4, minW:3,  minH:3,  maxW:12, maxH:8,  category:'journal',  accentColor:'var(--tm-accent)' },
  advanced_metrics:   { id:'advanced_metrics',    label:'Advanced Metrics',   icon:'📉', description:'Drawdown, Sharpe, Expectancy, Streaks',   defaultW:6,  defaultH:4, minW:3,  minH:3,  maxW:12, maxH:8,  category:'journal',  accentColor:'var(--tm-loss)' },
  heatmap:            { id:'heatmap',             label:'Heatmap',            icon:'🗓', description:'Calendrier de performance P&L',           defaultW:12, defaultH:4, minW:4,  minH:3,  maxW:12, maxH:8,  category:'chart',    accentColor:'var(--tm-blue)' },
  advanced_analytics: { id:'advanced_analytics',  label:'Advanced Analytics', icon:'🔬', description:'Analytics par mois, session, heure, jour',defaultW:12, defaultH:6, minW:6,  minH:4,  maxW:12, maxH:12, category:'journal',  accentColor:'var(--tm-purple)' },
  emotions:           { id:'emotions',            label:'Emotional Summary',  icon:'💜', description:'État émotionnel & IA advice',             defaultW:12, defaultH:3, minW:4,  minH:3,  maxW:12, maxH:6,  category:'journal',  accentColor:'var(--tm-purple)' },
  recent_trades:      { id:'recent_trades',       label:'Trades récents',     icon:'📋', description:'Derniers trades passés',                  defaultW:6,  defaultH:4, minW:3,  minH:3,  maxW:12, maxH:10, category:'journal',  accentColor:'var(--tm-text-secondary)' },
  stats_summary:      { id:'stats_summary',       label:'Statistiques',       icon:'🎯', description:'Résumé des stats clés',                   defaultW:6,  defaultH:4, minW:3,  minH:3,  maxW:12, maxH:10, category:'journal',  accentColor:'var(--tm-profit)' },
  mtf_dashboard:      { id:'mtf_dashboard',       label:'MTF Dashboard',      icon:'⏱',  description:'Signaux multi-timeframes',                defaultW:12, defaultH:6, minW:6,  minH:4,  maxW:12, maxH:12, category:'analysis', accentColor:'var(--tm-accent)' },
  rsi_block:          { id:'rsi_block',           label:'RSI',                icon:'〰', description:'RSI multi-TF',                            defaultW:3,  defaultH:4, minW:2,  minH:3,  maxW:6,  maxH:8,  category:'analysis', accentColor:'var(--tm-blue)' },
  macd_block:         { id:'macd_block',          label:'MACD',               icon:'⚡', description:'MACD croisements',                        defaultW:3,  defaultH:4, minW:2,  minH:3,  maxW:6,  maxH:8,  category:'analysis', accentColor:'var(--tm-purple)' },
  divergence_block:   { id:'divergence_block',    label:'Divergences',        icon:'↕',  description:'Divergences haussières/baissières',       defaultW:4,  defaultH:4, minW:2,  minH:3,  maxW:8,  maxH:8,  category:'analysis', accentColor:'var(--tm-warning)' },
  sr_block:           { id:'sr_block',            label:'Support/Résistance', icon:'⬌', description:'Niveaux clés dynamiques',                 defaultW:4,  defaultH:4, minW:2,  minH:3,  maxW:8,  maxH:8,  category:'analysis', accentColor:'var(--tm-warning)' },
  volume_cvd:         { id:'volume_cvd',          label:'Volume / CVD',       icon:'📊', description:'Delta cumulé et volume',                  defaultW:6,  defaultH:4, minW:3,  minH:3,  maxW:12, maxH:8,  category:'chart',    accentColor:'var(--tm-accent)' },
  trade_plan:         { id:'trade_plan',          label:'Trade Plan',         icon:'🗒',  description:'Scénarios Bull/Bear IA',                  defaultW:6,  defaultH:5, minW:4,  minH:4,  maxW:12, maxH:10, category:'analysis', accentColor:'var(--tm-purple)' },
  news_ticker:        { id:'news_ticker',         label:'Actualités',         icon:'📰', description:'News marché en temps réel',               defaultW:12, defaultH:1, minW:6,  minH:1,  maxW:12, maxH:2,  category:'info',     accentColor:'var(--tm-text-secondary)' },
}

// ─── Presets ──────────────────────────────────────────────────────────────────
export const DASHBOARD_PRESETS: Record<PresetName, DashboardPreset> = {
  journal: {
    name:'journal', label:'Journal', description:'Tous les widgets de suivi de trading',
    layout: [
      { id:'kpi_bar',          widgetId:'kpi_bar',          x:0,  y:0,  w:12, h:2,  visible:true },
      { id:'pnl_curve',        widgetId:'pnl_curve',        x:0,  y:2,  w:12, h:5,  visible:true },
      { id:'long_short',       widgetId:'long_short',       x:0,  y:7,  w:12, h:3,  visible:true },
      { id:'main_metrics',     widgetId:'main_metrics',     x:0,  y:10, w:6,  h:4,  visible:true },
      { id:'advanced_metrics', widgetId:'advanced_metrics', x:6,  y:10, w:6,  h:4,  visible:true },
      { id:'heatmap',          widgetId:'heatmap',          x:0,  y:14, w:12, h:4,  visible:true },
      { id:'advanced_analytics',widgetId:'advanced_analytics',x:0, y:18, w:12, h:6, visible:true },
      { id:'emotions',         widgetId:'emotions',         x:0,  y:24, w:12, h:3,  visible:true },
      { id:'recent_trades',    widgetId:'recent_trades',    x:0,  y:27, w:6,  h:4,  visible:true },
      { id:'stats_summary',    widgetId:'stats_summary',    x:6,  y:27, w:6,  h:4,  visible:true },
    ],
  },
  analyse: {
    name:'analyse', label:'Analyse', description:'Dashboard signaux de marché',
    layout: [
      { id:'mtf_dashboard',  widgetId:'mtf_dashboard',  x:0, y:0, w:12, h:6, visible:true },
      { id:'rsi_block',      widgetId:'rsi_block',      x:0, y:6, w:3,  h:4, visible:true },
      { id:'macd_block',     widgetId:'macd_block',     x:3, y:6, w:3,  h:4, visible:true },
      { id:'volume_cvd',     widgetId:'volume_cvd',     x:6, y:6, w:6,  h:4, visible:true },
      { id:'sr_block',       widgetId:'sr_block',       x:0, y:10, w:4, h:4, visible:true },
      { id:'divergence_block',widgetId:'divergence_block',x:4,y:10,w:4, h:4, visible:true },
      { id:'trade_plan',     widgetId:'trade_plan',     x:8, y:10, w:4, h:5, visible:true },
    ],
  },
  custom: {
    name:'custom', label:'Custom', description:'Configuration personnalisée',
    layout: [
      { id:'kpi_bar',     widgetId:'kpi_bar',     x:0, y:0,  w:12, h:2, visible:true },
      { id:'pnl_curve',   widgetId:'pnl_curve',   x:0, y:2,  w:8,  h:5, visible:true },
      { id:'rsi_block',   widgetId:'rsi_block',   x:8, y:2,  w:4,  h:5, visible:true },
      { id:'heatmap',     widgetId:'heatmap',     x:0, y:7,  w:12, h:4, visible:true },
    ],
  },
}
