// src/services/gamification/badgeDefinitions.ts
// ═══════════════════════════════════════════════════════════════
// 150 badges TradeMindset — définitions complètes
// ═══════════════════════════════════════════════════════════════

export type BadgeRarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'secret'
export type BadgeCategory =
  | 'volume' | 'winrate' | 'streak' | 'journal' | 'risk'
  | 'market' | 'pnl' | 'social' | 'challenge' | 'prestige'
  | 'coachIA' | 'seasonal' | 'humor' | 'secret' | 'prediction'

export interface BadgeReward {
  xp: number
  proDays?: number
  xpMultiplier?: number
  frame?: string
  theme?: string
  title?: string
  feature?: string
}

export interface BadgeCondition {
  type: string
  value: number
  extra?: Record<string, any>
}

export interface BadgeDefinition {
  id: string
  name: string
  description: string
  icon: string
  category: BadgeCategory
  rarity: BadgeRarity
  condition: BadgeCondition
  reward: BadgeReward
  hidden: boolean
  seasonal?: { startMonth: number; startDay: number; endMonth: number; endDay: number }
  order: number
}

const RARITY_XP: Record<BadgeRarity, number> = {
  common: 25, rare: 75, epic: 200, legendary: 500, mythic: 1000, secret: 150,
}

function b(
  id: string, name: string, description: string, icon: string,
  category: BadgeCategory, rarity: BadgeRarity,
  condition: BadgeCondition, reward: Partial<BadgeReward> = {},
  opts: { hidden?: boolean; seasonal?: BadgeDefinition['seasonal'] } = {}
): BadgeDefinition {
  return {
    id, name, description, icon, category, rarity, condition,
    reward: { xp: RARITY_XP[rarity], ...reward },
    hidden: opts.hidden ?? false,
    seasonal: opts.seasonal,
    order: 0,
  }
}

// ═══════════════════════════════════════════════════════════════
// CATÉGORIE 1 — VOLUME DE TRADES (15)
// ═══════════════════════════════════════════════════════════════
const VOLUME: BadgeDefinition[] = [
  b('vol_1',    'Premier Pas',       'Enregistre ton premier trade',  '👣', 'volume', 'common',    { type: 'tradesCount', value: 1 }),
  b('vol_5',    'Débutant',          'Enregistre 5 trades',           '🌱', 'volume', 'common',    { type: 'tradesCount', value: 5 }),
  b('vol_10',   'Apprenti',          'Enregistre 10 trades',          '📘', 'volume', 'common',    { type: 'tradesCount', value: 10 }),
  b('vol_25',   'Régulier',          'Enregistre 25 trades',          '📋', 'volume', 'common',    { type: 'tradesCount', value: 25 }),
  b('vol_50',   'Trader Actif',      'Enregistre 50 trades',          '📊', 'volume', 'rare',      { type: 'tradesCount', value: 50 }),
  b('vol_100',  'Semi-Pro',          'Enregistre 100 trades',         '🥈', 'volume', 'rare',      { type: 'tradesCount', value: 100 }, { frame: 'argent' }),
  b('vol_200',  'Confirmé',          'Enregistre 200 trades',         '📈', 'volume', 'rare',      { type: 'tradesCount', value: 200 }),
  b('vol_350',  'Vétéran',           'Enregistre 350 trades',         '🎖️', 'volume', 'epic',      { type: 'tradesCount', value: 350 }, { proDays: 3 }),
  b('vol_500',  'Expert',            'Enregistre 500 trades',         '🏅', 'volume', 'epic',      { type: 'tradesCount', value: 500 }, { frame: 'platine' }),
  b('vol_750',  'Machine',           'Enregistre 750 trades',         '⚙️', 'volume', 'epic',      { type: 'tradesCount', value: 750 }, { proDays: 5 }),
  b('vol_1000', 'Titan',             'Enregistre 1 000 trades',       '🗿', 'volume', 'legendary', { type: 'tradesCount', value: 1000 }, { xpMultiplier: 1.05 }),
  b('vol_1500', 'Mastermind',        'Enregistre 1 500 trades',       '🧠', 'volume', 'legendary', { type: 'tradesCount', value: 1500 }, { proDays: 10 }),
  b('vol_2000', 'Légende du Carnet', 'Enregistre 2 000 trades',       '📖', 'volume', 'legendary', { type: 'tradesCount', value: 2000 }, { theme: 'titanium' }),
  b('vol_3000', 'Mythique',          'Enregistre 3 000 trades',       '🔱', 'volume', 'mythic',    { type: 'tradesCount', value: 3000 }, { xpMultiplier: 1.10, title: 'Légende Vivante' }),
  b('vol_5000', '∞ Infini',          'Enregistre 5 000 trades',       '♾️', 'volume', 'mythic',    { type: 'tradesCount', value: 5000 }, { frame: 'infinity_animated', proDays: 30 }),
]

// ═══════════════════════════════════════════════════════════════
// CATÉGORIE 2 — WIN RATE & PERFORMANCE (12)
// ═══════════════════════════════════════════════════════════════
const WINRATE: BadgeDefinition[] = [
  b('wr_first',  'Coup de Chance',    'Premier trade gagnant',                   '🍀', 'winrate', 'common',    { type: 'firstWin', value: 1 }),
  b('wr_50_20',  'Main Sûre',         'WR ≥ 50% sur 20+ trades',                '✋', 'winrate', 'common',    { type: 'winRate', value: 50, extra: { minTrades: 20 } }),
  b('wr_55_30',  'Au-dessus du Lot',  'WR ≥ 55% sur 30+ trades',                '📈', 'winrate', 'common',    { type: 'winRate', value: 55, extra: { minTrades: 30 } }),
  b('wr_58_50',  'Précision',         'WR ≥ 58% sur 50+ trades',                '🎯', 'winrate', 'rare',      { type: 'winRate', value: 58, extra: { minTrades: 50 } }),
  b('wr_60_75',  'Franc-Tireur',      'WR ≥ 60% sur 75+ trades',                '🔫', 'winrate', 'rare',      { type: 'winRate', value: 60, extra: { minTrades: 75 } }, { frame: 'cible' }),
  b('wr_63_100', 'Sniper',            'WR ≥ 63% sur 100+ trades',               '🎯', 'winrate', 'epic',      { type: 'winRate', value: 63, extra: { minTrades: 100 } }, { feature: 'sniperMode' }),
  b('wr_65_100', 'Chirurgien',        'WR ≥ 65% sur 100+ trades',               '🔬', 'winrate', 'epic',      { type: 'winRate', value: 65, extra: { minTrades: 100 } }, { proDays: 5 }),
  b('wr_68_150', "L'Algorithme",      'WR ≥ 68% sur 150+ trades',               '🤖', 'winrate', 'legendary', { type: 'winRate', value: 68, extra: { minTrades: 150 } }, { xpMultiplier: 1.05 }),
  b('wr_70_200', 'Perfection',        'WR ≥ 70% sur 200+ trades',               '💎', 'winrate', 'legendary', { type: 'winRate', value: 70, extra: { minTrades: 200 } }, { title: 'The Algorithm' }),
  b('wr_streak5','Série Gagnante ×5', '5 trades gagnants consécutifs',           '🔥', 'winrate', 'rare',      { type: 'winStreak', value: 5 }),
  b('wr_streak10','Série Gagnante ×10','10 trades gagnants consécutifs',          '🔥', 'winrate', 'epic',      { type: 'winStreak', value: 10 }, { proDays: 3 }),
  b('wr_streak15','Imbattable',       '15 trades gagnants consécutifs',           '👑', 'winrate', 'legendary', { type: 'winStreak', value: 15 }, { frame: 'couronne' }),
]

// ═══════════════════════════════════════════════════════════════
// CATÉGORIE 3 — STREAKS & CONSTANCE (13)
// ═══════════════════════════════════════════════════════════════
const STREAK: BadgeDefinition[] = [
  b('str_1',      'Jour 1',              '1er jour d\'activité',                     '☀️', 'streak', 'common',    { type: 'activityStreak', value: 1 }),
  b('str_3',      'Triptyque',           '3 jours consécutifs d\'activité',          '3️⃣', 'streak', 'common',    { type: 'activityStreak', value: 3 }),
  b('str_7',      'Semainier',           '7 jours consécutifs',                      '📅', 'streak', 'common',    { type: 'activityStreak', value: 7 }),
  b('str_14',     'Bimensuel',           '14 jours consécutifs',                     '🔥', 'streak', 'rare',      { type: 'activityStreak', value: 14 }, { frame: 'flamme' }),
  b('str_30',     'Mois Parfait',        '30 jours consécutifs',                     '🗓️', 'streak', 'epic',      { type: 'activityStreak', value: 30 }, { proDays: 7 }),
  b('str_60',     'Inarrêtable',         '60 jours consécutifs',                     '💪', 'streak', 'legendary', { type: 'activityStreak', value: 60 }, { theme: 'inferno' }),
  b('str_100',    'Centurion',           '100 jours consécutifs',                    '🏛️', 'streak', 'legendary', { type: 'activityStreak', value: 100 }, { xpMultiplier: 1.05, title: 'Centurion' }),
  b('str_200',    'Marathon',            '200 jours consécutifs',                    '🏃', 'streak', 'mythic',    { type: 'activityStreak', value: 200 }, { xpMultiplier: 1.10, frame: 'phoenix_animated' }),
  b('str_early',  'Lève-Tôt',           '10 trades passés avant 9h',                '🌅', 'streak', 'rare',      { type: 'earlyTrades', value: 10 }),
  b('str_night',  'Night Owl',           '10 trades passés après 22h',               '🦉', 'streak', 'rare',      { type: 'nightTrades', value: 10 }),
  b('str_monday', 'Guerrier du Lundi',   '10 trades un lundi',                       '💼', 'streak', 'common',    { type: 'mondayTrades', value: 10 }),
  b('str_weekend','Week-end Warrior',    'Trader un samedi et dimanche',             '🏖️', 'streak', 'common',    { type: 'weekendTrades', value: 1 }),
  b('str_alldays','Semaine Complète',    'Au moins 1 trade Lu→Ve sur une semaine',   '✅', 'streak', 'rare',      { type: 'fullWeek', value: 1 }),
]

// ═══════════════════════════════════════════════════════════════
// CATÉGORIE 4 — JOURNAL & PSYCHOLOGIE (14)
// ═══════════════════════════════════════════════════════════════
const JOURNAL: BadgeDefinition[] = [
  b('jrn_1',       'Première Réflexion',     '1 note de journal',                           '✏️', 'journal', 'common',    { type: 'journalCount', value: 1 }),
  b('jrn_10',      'Diariste',               '10 notes de journal',                         '📓', 'journal', 'common',    { type: 'journalCount', value: 10 }),
  b('jrn_25',      'Introspectif',           '25 notes de journal',                         '🔍', 'journal', 'common',    { type: 'journalCount', value: 25 }),
  b('jrn_50_emo',  'Analyste de Soi',        '50 notes avec émotion renseignée',            '🧠', 'journal', 'rare',      { type: 'journalWithEmotion', value: 50 }),
  b('jrn_100_emo', 'Psychologue',            '100 notes avec émotion renseignée',           '🎭', 'journal', 'rare',      { type: 'journalWithEmotion', value: 100 }, { frame: 'plume' }),
  b('jrn_200_det', 'Maître du Journal',      '200 notes détaillées (>50 caractères)',        '📖', 'journal', 'epic',      { type: 'journalDetailed', value: 200 }, { feature: 'emotionalHeatmapPro' }),
  b('jrn_500',     'Conscience Totale',       '500 notes avec émotion et >100 caractères',   '🌟', 'journal', 'legendary', { type: 'journalComplete', value: 500 }, { proDays: 10 }),
  b('jrn_zen',     'Zen Master',             '20 trades consécutifs avec émotion Calme/Confiant', '🧘', 'journal', 'epic', { type: 'zenStreak', value: 20 }, { theme: 'zenGarden' }),
  b('jrn_recover', 'Retour au Calme',        'Passer de Frustré à Calme entre 2 trades, 5 fois', '🌊', 'journal', 'rare', { type: 'emotionRecovery', value: 5 }),
  b('jrn_stable',  'Émotionnellement Stable', 'Aucune émotion négative sur 20 trades consécutifs', '⚖️', 'journal', 'epic', { type: 'emotionStable', value: 20 }, { proDays: 5 }),
  b('jrn_stoic',   'Le Stoïcien',            '50 trades (gagnants ET perdants) tous avec émotion Calme', '🏛️', 'journal', 'legendary', { type: 'stoicTrades', value: 50 }, { title: 'Stoïcien' }),
  b('jrn_photo',   'Photo Reporter',         '10 trades avec screenshot jointe',            '📸', 'journal', 'rare',      { type: 'tradesWithImage', value: 10 }),
  b('jrn_novel',   'Romancier',              '1 note de plus de 500 caractères',             '✍️', 'journal', 'common',    { type: 'longNote', value: 1, extra: { minChars: 500 } }),
  b('jrn_memoir',  "Mémoires d'un Trader",   '50 notes de plus de 200 caractères',          '📚', 'journal', 'epic',      { type: 'longNotes', value: 50, extra: { minChars: 200 } }, { frame: 'encrier' }),
]

// ═══════════════════════════════════════════════════════════════
// CATÉGORIE 5 — GESTION DU RISQUE (12)
// ═══════════════════════════════════════════════════════════════
const RISK: BadgeDefinition[] = [
  b('risk_sl5',     'Prudent',               '5 trades consécutifs avec stop-loss',           '🛡️', 'risk', 'common',    { type: 'consecutiveSL', value: 5 }),
  b('risk_sl20',    'Discipliné',            '20 trades consécutifs avec stop-loss',          '🔒', 'risk', 'common',    { type: 'consecutiveSL', value: 20 }),
  b('risk_sl50',    'Blindé',                '50 trades consécutifs avec stop-loss',          '🛡️', 'risk', 'rare',      { type: 'consecutiveSL', value: 50 }),
  b('risk_rr15',    'R/R Rookie',            'R:R moyen ≥ 1.5 sur 20+ trades',               '📐', 'risk', 'common',    { type: 'avgRiskReward', value: 1.5, extra: { minTrades: 20 } }),
  b('risk_rr20',    'Risk Master',           'R:R moyen ≥ 2.0 sur 50+ trades',               '⚖️', 'risk', 'rare',      { type: 'avgRiskReward', value: 2.0, extra: { minTrades: 50 } }, { frame: 'bouclier' }),
  b('risk_rr25',    'Asymétrie Parfaite',    'R:R moyen ≥ 2.5 sur 100+ trades',              '📊', 'risk', 'epic',      { type: 'avgRiskReward', value: 2.5, extra: { minTrades: 100 } }, { feature: 'riskDashboardPro' }),
  b('risk_dd5',     'Drawdown Contrôlé',     'Max drawdown ≤ 5% sur 1 mois (min 20 trades)', '📉', 'risk', 'rare',      { type: 'maxDrawdown', value: 5, extra: { months: 1, minTrades: 20 } }),
  b('risk_dd3',     'Drawdown Minimal',      'Max drawdown ≤ 3% sur 3 mois (min 50 trades)', '📉', 'risk', 'epic',      { type: 'maxDrawdown', value: 3, extra: { months: 3, minTrades: 50 } }, { proDays: 5 }),
  b('risk_dd2',     'Insubmersible',         'Max drawdown ≤ 2% sur 6 mois (min 100 trades)','🚢', 'risk', 'legendary', { type: 'maxDrawdown', value: 2, extra: { months: 6, minTrades: 100 } }, { xpMultiplier: 1.05 }),
  b('risk_fortress','Forteresse',            'Aucun trade > 2% de perte sur 100 trades consécutifs', '🏰', 'risk', 'legendary', { type: 'maxLossPerTrade', value: 2, extra: { consecutive: 100 } }, { theme: 'fortress' }),
  b('risk_small',   'Petit Joueur Malin',    '50 trades avec position ≤ 1% du capital',      '🐜', 'risk', 'epic',      { type: 'smallPosition', value: 50 }),
  b('risk_neversl', 'SL Jamais Touché',      '10 trades gagnants fermés avant le SL avec >2R','🎯', 'risk', 'rare',      { type: 'winBeforeSL', value: 10 }),
]

// ═══════════════════════════════════════════════════════════════
// CATÉGORIE 6 — DIVERSIFICATION & MARCHÉS (12)
// ═══════════════════════════════════════════════════════════════
const MARKET: BadgeDefinition[] = [
  b('mkt_3',      'Curieux',          '3 actifs différents tradés',                     '🔎', 'market', 'common',    { type: 'uniqueSymbols', value: 3 }),
  b('mkt_10',     'Explorateur',      '10 actifs différents tradés',                    '🧭', 'market', 'common',    { type: 'uniqueSymbols', value: 10 }),
  b('mkt_25',     'Diversifié',       '25 actifs différents tradés',                    '🌐', 'market', 'rare',      { type: 'uniqueSymbols', value: 25 }),
  b('mkt_50',     'Collectionneur',   '50 actifs différents tradés',                    '🗺️', 'market', 'epic',      { type: 'uniqueSymbols', value: 50 }, { frame: 'globe' }),
  b('mkt_100',    'Omniscient',       '100 actifs différents tradés',                   '🌍', 'market', 'legendary', { type: 'uniqueSymbols', value: 100 }, { proDays: 10 }),
  b('mkt_crypto', 'Crypto Native',    '20 trades crypto',                               '₿', 'market', 'common',    { type: 'assetTypeTrades', value: 20, extra: { assetType: 'crypto' } }),
  b('mkt_forex',  'Forex Trader',     '20 trades forex',                                '💱', 'market', 'common',    { type: 'assetTypeTrades', value: 20, extra: { assetType: 'forex' } }),
  b('mkt_stocks', 'Stock Picker',     '20 trades actions/ETF',                          '📈', 'market', 'common',    { type: 'assetTypeTrades', value: 20, extra: { assetType: 'stocks' } }),
  b('mkt_futures','Futures Pro',      '20 trades futures/indices',                       '📊', 'market', 'common',    { type: 'assetTypeTrades', value: 20, extra: { assetType: 'futures' } }),
  b('mkt_multi2', 'Multi-Marché',     'Au moins 10 trades sur 2 marchés différents',    '🔀', 'market', 'rare',      { type: 'multiMarket', value: 2, extra: { minPerMarket: 10 } }),
  b('mkt_multi3', 'Globe-Trotter',    'Au moins 10 trades sur 3 marchés différents',    '✈️', 'market', 'epic',      { type: 'multiMarket', value: 3, extra: { minPerMarket: 10 } }, { frame: 'atlas' }),
  b('mkt_multi4', 'Maître de Tous',   'Au moins 20 trades sur 4 marchés',               '🏆', 'market', 'legendary', { type: 'multiMarket', value: 4, extra: { minPerMarket: 20 } }, { title: 'Polyvalent' }),
]

// ═══════════════════════════════════════════════════════════════
// CATÉGORIE 7 — P&L & RENTABILITÉ (14)
// ═══════════════════════════════════════════════════════════════
const PNL: BadgeDefinition[] = [
  b('pnl_first',    'Premier Gain',       'Premier trade avec P&L positif',              '💵', 'pnl', 'common',    { type: 'firstProfit', value: 1 }),
  b('pnl_green',    'Dans le Vert',       'P&L cumulé > 0$',                             '🟢', 'pnl', 'common',    { type: 'totalPnL', value: 0.01 }),
  b('pnl_100',      'Bénéficiaire',       'P&L cumulé > 100$',                           '💰', 'pnl', 'common',    { type: 'totalPnL', value: 100 }),
  b('pnl_500',      'Rentable',           'P&L cumulé > 500$',                           '💰', 'pnl', 'rare',      { type: 'totalPnL', value: 500 }),
  b('pnl_1000',     'Quatre Chiffres',    'P&L cumulé > 1 000$',                         '💎', 'pnl', 'rare',      { type: 'totalPnL', value: 1000 }, { frame: 'dollar' }),
  b('pnl_5000',     'Cinq Chiffres',      'P&L cumulé > 5 000$',                         '🏦', 'pnl', 'epic',      { type: 'totalPnL', value: 5000 }, { proDays: 7 }),
  b('pnl_10000',    'Big Player',         'P&L cumulé > 10 000$',                        '🏛️', 'pnl', 'epic',      { type: 'totalPnL', value: 10000 }, { frame: 'lingot' }),
  b('pnl_50000',    'Whale',              'P&L cumulé > 50 000$',                        '🐋', 'pnl', 'legendary', { type: 'totalPnL', value: 50000 }, { theme: 'goldEdition', xpMultiplier: 1.05 }),
  b('pnl_100000',   'Mogul',              'P&L cumulé > 100 000$',                       '👑', 'pnl', 'mythic',    { type: 'totalPnL', value: 100000 }, { xpMultiplier: 1.15, title: 'Mogul', frame: 'rain_animated' }),
  b('pnl_comeback', 'Comeback Kid',       'Remonter un drawdown de -10%+ jusqu\'à ATH',  '🔄', 'pnl', 'epic',      { type: 'comebackFromDrawdown', value: 10 }, { proDays: 5 }),
  b('pnl_month',    'Mois Vert',          '1 mois calendaire entièrement positif (min 15 trades)', '📗', 'pnl', 'rare', { type: 'greenMonth', value: 1, extra: { minTrades: 15 } }),
  b('pnl_quarter',  'Trimestre Vert',     '3 mois consécutifs positifs',                 '📗', 'pnl', 'epic',      { type: 'greenMonths', value: 3, extra: { minTrades: 15 } }, { proDays: 10 }),
  b('pnl_year',     'Année Verte',        '12 mois consécutifs positifs',                '🌳', 'pnl', 'legendary', { type: 'greenMonths', value: 12 }, { theme: 'emerald', title: 'Consistant' }),
  b('pnl_bigtrade', 'Gros Coup',          '1 trade avec > 500$ de gain',                 '🎰', 'pnl', 'rare',      { type: 'singleTradePnL', value: 500 }),
]

// ═══════════════════════════════════════════════════════════════
// CATÉGORIE 8 — SOCIAL & PARRAINAGE (10)
// ═══════════════════════════════════════════════════════════════
const SOCIAL: BadgeDefinition[] = [
  b('soc_1',      'Connecté',       '1 filleul validé',                          '🤝', 'social', 'common',    { type: 'referralsValidated', value: 1 }),
  b('soc_3',      'Recruteur',      '3 filleuls validés',                        '📣', 'social', 'common',    { type: 'referralsValidated', value: 3 }),
  b('soc_5',      'Influenceur',    '5 filleuls validés',                        '📢', 'social', 'rare',      { type: 'referralsValidated', value: 5 }, { frame: 'reseau' }),
  b('soc_10',     'Leader',         '10 filleuls validés',                       '🎯', 'social', 'rare',      { type: 'referralsValidated', value: 10 }),
  b('soc_20',     'Top Parrain',    '20 filleuls validés',                       '🏆', 'social', 'epic',      { type: 'referralsValidated', value: 20 }, { proDays: 15 }),
  b('soc_30',     'Ambassadeur',    '30 filleuls validés',                       '🎖️', 'social', 'legendary', { type: 'referralsValidated', value: 30 }, { title: 'Ambassadeur' }),
  b('soc_50',     'Empire',         '50 filleuls validés',                       '👑', 'social', 'legendary', { type: 'referralsValidated', value: 50 }, { xpMultiplier: 1.05, frame: 'couronne' }),
  b('soc_50pro',  'Dynastie',       '50 filleuls dont 5 Pro',                    '🏰', 'social', 'mythic',    { type: 'referralsWithPro', value: 50, extra: { proCount: 5 } }, { xpMultiplier: 1.10, theme: 'royal' }),
  b('soc_mentor', 'Mentor',         '1 filleul atteint le niveau 10',            '🎓', 'social', 'epic',      { type: 'referralReachedLevel', value: 10 }),
  b('soc_passive','Parrain Passif', 'Gagner 1000 XP passif total via filleuls',  '💤', 'social', 'rare',      { type: 'passiveXPTotal', value: 1000 }),
]

// ═══════════════════════════════════════════════════════════════
// CATÉGORIE 9 — DÉFIS (12)
// ═══════════════════════════════════════════════════════════════
const CHALLENGE: BadgeDefinition[] = [
  b('ch_1',       'Challenger',           '1 défi complété',                          '⚔️', 'challenge', 'common',    { type: 'challengesCompleted', value: 1 }),
  b('ch_10',      'Habitué',              '10 défis complétés',                       '🎯', 'challenge', 'common',    { type: 'challengesCompleted', value: 10 }),
  b('ch_25',      'Défi Accepté',         '25 défis complétés',                       '✊', 'challenge', 'rare',      { type: 'challengesCompleted', value: 25 }),
  b('ch_50',      'Marathonien des Défis','50 défis complétés',                       '🏅', 'challenge', 'rare',      { type: 'challengesCompleted', value: 50 }, { frame: 'etoile' }),
  b('ch_week',    'Semaine Parfaite',     'Tous les défis d\'une semaine complétés',  '⭐', 'challenge', 'epic',      { type: 'perfectWeek', value: 1 }, { proDays: 3 }),
  b('ch_month30', 'Mois de Défis',        '30 défis en un mois',                      '🗓️', 'challenge', 'epic',      { type: 'challengesInMonth', value: 30 }, { proDays: 7 }),
  b('ch_100',     'Maître des Défis',     '100 défis complétés',                      '🏆', 'challenge', 'legendary', { type: 'challengesCompleted', value: 100 }, { feature: 'customChallenges' }),
  b('ch_200',     'Défis ×200',           '200 défis complétés',                      '💎', 'challenge', 'legendary', { type: 'challengesCompleted', value: 200 }, { xpMultiplier: 1.05 }),
  b('ch_3in1',    '3 Défis en 1 Jour',    'Compléter 3 défis le même jour',           '🎪', 'challenge', 'rare',      { type: 'challengesInDay', value: 3 }),
  b('ch_5weeks',  'Perfectionniste',      '5 semaines parfaites',                     '💯', 'challenge', 'epic',      { type: 'perfectWeeks', value: 5 }, { proDays: 5 }),
  b('ch_dstrk7',  'Streak de Défis ×7',   '7 jours consécutifs avec 1+ défi complété','🔥', 'challenge', 'rare',      { type: 'challengeStreak', value: 7 }),
  b('ch_dstrk30', 'Streak de Défis ×30',  '30 jours consécutifs avec 1+ défi complété','🏆', 'challenge', 'legendary', { type: 'challengeStreak', value: 30 }, { theme: 'champion' }),
]

// ═══════════════════════════════════════════════════════════════
// CATÉGORIE 10 — PRESTIGE & NIVEAUX (8)
// ═══════════════════════════════════════════════════════════════
const PRESTIGE: BadgeDefinition[] = [
  b('lvl_5',      'Niveau 5',        'Atteindre le niveau 5',        '5️⃣', 'prestige', 'common',    { type: 'level', value: 5 }),
  b('lvl_10',     'Niveau 10',       'Atteindre le niveau 10',       '🔟', 'prestige', 'common',    { type: 'level', value: 10 }),
  b('lvl_25',     'Niveau 25',       'Atteindre le niveau 25',       '⭐', 'prestige', 'rare',      { type: 'level', value: 25 }, { frame: 'bronzeEtoile' }),
  b('lvl_50',     'Niveau 50',       'Atteindre le niveau 50',       '🌟', 'prestige', 'epic',      { type: 'level', value: 50 }, { proDays: 10 }),
  b('pres_1',     'Prestige I',      'Premier prestige',             '♦️', 'prestige', 'legendary', { type: 'prestige', value: 1 }, { xpMultiplier: 1.10 }),
  b('pres_2',     'Prestige II',     'Deuxième prestige',            '♦️', 'prestige', 'legendary', { type: 'prestige', value: 2 }, { theme: 'obsidian' }),
  b('pres_3',     'Prestige III',    'Troisième prestige',           '♦️', 'prestige', 'mythic',    { type: 'prestige', value: 3 }, { xpMultiplier: 1.15, title: 'Transcendant', frame: 'prismatique_animated' }),
  b('xp_million', 'XP Millionnaire', 'Accumuler 1 000 000 XP total','💰', 'prestige', 'legendary', { type: 'lifetimeXP', value: 1000000 }, { frame: 'supernova_animated' }),
]

// ═══════════════════════════════════════════════════════════════
// CATÉGORIE 11 — COACH IA (10)
// ═══════════════════════════════════════════════════════════════
const COACH_IA: BadgeDefinition[] = [
  b('ai_1',       'Première Consultation', '1 message au Coach IA',                      '💬', 'coachIA', 'common',    { type: 'coachMessages', value: 1 }),
  b('ai_10',      'Conversation',          '10 messages au Coach IA',                     '🗣️', 'coachIA', 'common',    { type: 'coachMessages', value: 10 }),
  b('ai_50',      'Client Régulier',       '50 messages au Coach IA',                     '🤝', 'coachIA', 'rare',      { type: 'coachMessages', value: 50 }),
  b('ai_200',     'Patient Assidu',        '200 messages au Coach IA',                    '🧠', 'coachIA', 'epic',      { type: 'coachMessages', value: 200 }, { proDays: 5 }),
  b('ai_bias1',   'Biais Détecté',         'Le Coach détecte un biais pour la 1ère fois', '⚠️', 'coachIA', 'common',    { type: 'firstBiasDetected', value: 1 }),
  b('ai_biasfix', 'Biais Corrigé',         'Un biais récurrent n\'est plus détecté sur 10 trades', '✅', 'coachIA', 'epic', { type: 'biasFixed', value: 1 }, { frame: 'cerveau' }),
  b('ai_allbias', 'Tous les Biais',        'Le Coach a détecté les 5 biais au moins 1 fois', '🎲', 'coachIA', 'rare', { type: 'allBiasesDetected', value: 5 }),
  b('ai_memory',  'Mémoire Longue',        'Le Coach a sauvegardé 20+ mémoires sur toi', '🗃️', 'coachIA', 'rare',      { type: 'coachMemories', value: 20 }),
  b('ai_deep',    'Introspection IA',      '3 questions psychologie dans une conversation','🔮', 'coachIA', 'rare',     { type: 'deepConversation', value: 3 }),
  b('ai_improve', 'Self-Aware',            'Le Coach signale une amélioration sur 1 mois','🌱', 'coachIA', 'legendary', { type: 'biasImprovement', value: 1 }, { title: 'Self-Aware' }),
]

// ═══════════════════════════════════════════════════════════════
// CATÉGORIE 12 — SAISONNIERS (8)
// ═══════════════════════════════════════════════════════════════
const SEASONAL: BadgeDefinition[] = [
  b('sea_newyear',  'Résolution',               '5 trades dans la 1ère semaine de janvier',       '🎆', 'seasonal', 'rare', { type: 'tradesInPeriod', value: 5 }, { frame: 'nouvelAn' }, { seasonal: { startMonth: 1, startDay: 1, endMonth: 1, endDay: 7 } }),
  b('sea_summer',   'Summer Trader',            '20 trades en juillet ou août',                    '☀️', 'seasonal', 'rare', { type: 'tradesInPeriod', value: 20 }, { frame: 'soleil' }, { seasonal: { startMonth: 7, startDay: 1, endMonth: 8, endDay: 31 } }),
  b('sea_halloween','Trick or Trade',           'Trade avec P&L de exactement ±13$ (±0.50)',       '🎃', 'seasonal', 'epic', { type: 'exactPnL', value: 13 }, { frame: 'citrouille' }, { seasonal: { startMonth: 10, startDay: 25, endMonth: 10, endDay: 31 } }),
  b('sea_santa',    'Santa Rally',              '10 trades gagnants en décembre',                  '🎅', 'seasonal', 'rare', { type: 'winningTradesInPeriod', value: 10 }, { frame: 'sapin' }, { seasonal: { startMonth: 12, startDay: 1, endMonth: 12, endDay: 31 } }),
  b('sea_bf',       'Black Friday Survivor',    'Trader le Black Friday avec P&L positif',         '🛒', 'seasonal', 'epic', { type: 'blackFridayWin', value: 1 }, {}, { seasonal: { startMonth: 11, startDay: 22, endMonth: 11, endDay: 30 } }),
  b('sea_april',    'April Fool',               'Enregistrer un trade le 1er avril',               '🤡', 'seasonal', 'common', { type: 'tradeOnDate', value: 1 }, { frame: 'poisson' }, { seasonal: { startMonth: 4, startDay: 1, endMonth: 4, endDay: 1 } }),
  b('sea_appbday',  'Anniversaire TradeMindset','Trader le jour anniversaire de l\'app',           '🎂', 'seasonal', 'rare', { type: 'tradeOnDate', value: 1 }, { proDays: 3 }, { seasonal: { startMonth: 1, startDay: 15, endMonth: 1, endDay: 15 } }),
  b('sea_birthday', 'Ton Anniversaire',         'Trader le jour de ton anniversaire',              '🎁', 'seasonal', 'rare', { type: 'tradeOnBirthday', value: 1 }, { frame: 'gateau' }),
]

// ═══════════════════════════════════════════════════════════════
// CATÉGORIE 13 — BADGES NÉGATIFS / HUMOUR (10)
// ═══════════════════════════════════════════════════════════════
const HUMOR: BadgeDefinition[] = [
  b('hum_first_loss','Aïe',                    'Premier trade perdant',                          '🩹', 'humor', 'common',  { type: 'firstLoss', value: 1 }),
  b('hum_streak5',   'Série Noire',            '5 trades perdants consécutifs',                  '🌧️', 'humor', 'common',  { type: 'lossStreak', value: 5 }, { frame: 'nuageNoir' }),
  b('hum_revenge',   'Revenge Trader',         'Le Coach détecte du revenge trading 3 fois',     '😤', 'humor', 'rare',    { type: 'biasCount', value: 3, extra: { bias: 'revenge' } }),
  b('hum_fomo',      'FOMO King',              'Le Coach détecte du FOMO 5 fois',                '🚀', 'humor', 'rare',    { type: 'biasCount', value: 5, extra: { bias: 'fomo' } }, { frame: 'fusee' }),
  b('hum_overconf',  'Overconfident',          'Le Coach détecte de la surconfiance 5 fois',     '😎', 'humor', 'rare',    { type: 'biasCount', value: 5, extra: { bias: 'overconfidence' } }),
  b('hum_diamond',   'Diamond Hands... de Perte','Trade perdant gardé >48h avant fermeture',     '💎', 'humor', 'common',  { type: 'longLosingTrade', value: 48 }),
  b('hum_dd20',      'La Dégringolade',        'Drawdown > 20%',                                 '📉', 'humor', 'rare',    { type: 'drawdownOver', value: 20 }),
  b('hum_bhsl',      'Buy High Sell Low',      '3 trades consécutifs achetés au plus haut',       '🤡', 'humor', 'epic',    { type: 'buyHighSellLow', value: 3 }, { frame: 'clown' }),
  b('hum_comeback',  'Le Retour',              'Série Noire puis 5 trades gagnants consécutifs', '🔥', 'humor', 'epic',    { type: 'comebackAfterStreak', value: 5 }, { frame: 'phoenix' }),
  b('hum_100losses', 'Collectionneur de L',    '100 trades perdants au total',                    '🏴', 'humor', 'rare',    { type: 'totalLosses', value: 100 }, { title: 'Résilient' }),
]

// ═══════════════════════════════════════════════════════════════
// CATÉGORIE 14 — BADGES SECRETS (10)
// ═══════════════════════════════════════════════════════════════
const SECRET: BadgeDefinition[] = [
  b('sec_round',    'Le Chiffre Rond',   'Clôturer un trade avec exactement +100.00$',     '🎯', 'secret', 'secret', { type: 'exactPnL', value: 100 }, {}, { hidden: true }),
  b('sec_midnight', '00:00:00',          'Enregistrer un trade à exactement minuit',        '🕛', 'secret', 'secret', { type: 'tradeAtMidnight', value: 1 }, {}, { hidden: true }),
  b('sec_palindrome','Palindrome',       'P&L palindrome (ex: 12.21, 3.3)',                 '🪞', 'secret', 'secret', { type: 'palindromePnL', value: 1 }, { frame: 'miroir' }, { hidden: true }),
  b('sec_lucky7',   'Lucky 7',           '7 trades gagnants un 7 du mois ou P&L avec 777', '🎰', 'secret', 'secret', { type: 'lucky7', value: 1 }, {}, { hidden: true }),
  b('sec_minimal',  'Le Minimaliste',    'Trade avec exactement +0.01$ de gain',            '🔬', 'secret', 'secret', { type: 'exactPnL', value: 0.01 }, { frame: 'pixel' }, { hidden: true }),
  b('sec_fullmoon', 'Full Moon Trader',  'Trade gagnant un jour de pleine lune',            '🌕', 'secret', 'secret', { type: 'fullMoonWin', value: 1 }, { frame: 'lune' }, { hidden: true }),
  b('sec_speed',    'Le Speedrunner',    'Ouvrir et fermer un trade en <60s avec gain',     '⚡', 'secret', 'secret', { type: 'speedTrade', value: 60 }, {}, { hidden: true }),
  b('sec_50badges', 'Le Collectionneur', 'Obtenir 50 badges au total',                     '🏅', 'secret', 'secret', { type: 'badgeCount', value: 50 }, { proDays: 5 }, { hidden: true }),
  b('sec_100badges','Le Complétiste',    'Obtenir 100 badges au total',                     '💎', 'secret', 'secret', { type: 'badgeCount', value: 100 }, { proDays: 15, theme: 'rainbow' }, { hidden: true }),
  b('sec_ultimate', "L'Ultime",          'Obtenir les 140 badges non-secrets',              '🌈', 'secret', 'secret', { type: 'badgeCount', value: 140 }, { xpMultiplier: 1.20, title: "L'Ultime", frame: 'aura_animated' }, { hidden: true }),
]

// ═══════════════════════════════════════════════════════════════
// CATÉGORIE 15 — PRÉDICTIONS (10)
// ═══════════════════════════════════════════════════════════════
const PREDICTION: BadgeDefinition[] = [
  b('pred_first',      'Première Prédiction',     'Soumettre ta première prédiction de prix',         '🎯', 'prediction', 'common',    { type: 'predictionsTotal',       value: 1  }),
  b('pred_10',         'Apprenti Prévisionniste',  '10 prédictions soumises',                          '📊', 'prediction', 'rare',      { type: 'predictionsTotal',       value: 10 }),
  b('pred_50',         'Analyste Confirmé',        '50 prédictions soumises',                          '🔮', 'prediction', 'epic',      { type: 'predictionsTotal',       value: 50 }),
  b('pred_correct_1',  'Bonne Direction',          'Première prédiction de direction correcte',        '✅', 'prediction', 'common',    { type: 'predictionsCorrect',     value: 1  }),
  b('pred_correct_10', 'Lecteur de Marchés',       '10 directions correctes',                          '📈', 'prediction', 'rare',      { type: 'predictionsCorrect',     value: 10 }),
  b('pred_correct_50', 'Maître de Prédiction',     '50 directions correctes',                          '🏆', 'prediction', 'legendary', { type: 'predictionsCorrect',     value: 50 }),
  b('pred_streak_5',   'Série de 5',               "5 bonnes prédictions d'affilée",                  '🔥', 'prediction', 'epic',      { type: 'predictionStreak',       value: 5  }),
  b('pred_streak_10',  "L'Oracle",                 "10 bonnes prédictions d'affilée",                 '🌟', 'prediction', 'legendary', { type: 'predictionStreak',       value: 10 }, { title: "L'Oracle" }),
  b('pred_oracle',     'Dans le Mille',            "Prédiction à moins de 1% d'écart",               '💎', 'prediction', 'epic',      { type: 'predictionBestAccuracy', value: 1  }),
  b('pred_daily_7',    'Semaine du Prophète',      'Prédire 7 jours consécutifs',                     '📅', 'prediction', 'rare',      { type: 'predictionDailyStreak',  value: 7  }),
]

// ═══════════════════════════════════════════════════════════════
// EXPORT — Tous les badges avec ordre automatique
// ═══════════════════════════════════════════════════════════════
const ALL_CATEGORIES = [
  VOLUME, WINRATE, STREAK, JOURNAL, RISK, MARKET, PNL,
  SOCIAL, CHALLENGE, PRESTIGE, COACH_IA, SEASONAL, HUMOR, SECRET, PREDICTION,
]

let orderCounter = 0
export const ALL_BADGES: BadgeDefinition[] = ALL_CATEGORIES.flat().map(badge => ({
  ...badge,
  order: ++orderCounter,
}))

export const BADGES_BY_ID = new Map(ALL_BADGES.map(b => [b.id, b]))
export const BADGES_BY_CATEGORY = (cat: BadgeCategory) => ALL_BADGES.filter(b => b.category === cat)

export const RARITY_CONFIG: Record<BadgeRarity, { label: string; color: string; bgColor: string }> = {
  common:    { label: 'Common',    color: '#CD7F32', bgColor: 'rgba(205,127,50,0.1)' },
  rare:      { label: 'Rare',      color: '#C0C0C0', bgColor: 'rgba(192,192,192,0.1)' },
  epic:      { label: 'Épique',    color: '#FFD700', bgColor: 'rgba(255,215,0,0.1)' },
  legendary: { label: 'Légendaire',color: '#00E5FF', bgColor: 'rgba(0,229,255,0.1)' },
  mythic:    { label: 'Mythique',  color: '#BF5AF2', bgColor: 'rgba(191,90,242,0.1)' },
  secret:    { label: '???',       color: '#8B00FF', bgColor: 'rgba(139,0,255,0.1)' },
}

export const CATEGORY_CONFIG: Record<BadgeCategory, { label: string; icon: string }> = {
  volume:    { label: 'Volume',        icon: '🏷️' },
  winrate:   { label: 'Performance',   icon: '🎯' },
  streak:    { label: 'Constance',     icon: '🔥' },
  journal:   { label: 'Journal',       icon: '📝' },
  risk:      { label: 'Risque',        icon: '🛡️' },
  market:    { label: 'Marchés',       icon: '🌍' },
  pnl:       { label: 'Rentabilité',   icon: '💰' },
  social:    { label: 'Social',        icon: '🤝' },
  challenge: { label: 'Défis',         icon: '⚔️' },
  prestige:  { label: 'Prestige',      icon: '⭐' },
  coachIA:   { label: 'Coach IA',      icon: '🤖' },
  seasonal:  { label: 'Saisonniers',   icon: '🎄' },
  humor:      { label: 'Humour',        icon: '💀' },
  secret:     { label: 'Secrets',       icon: '🔮' },
  prediction: { label: 'Prédictions',   icon: '🎯' },
}
