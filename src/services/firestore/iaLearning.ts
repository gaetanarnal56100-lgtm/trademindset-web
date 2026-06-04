// iaLearning.ts — Persistent knowledge base for IA self-improvement
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore'
import app from '@/services/firebase/config'

const db = getFirestore(app)

export interface TradingKnowledge {
  version: number
  lastUpdated: number
  // General rules learned from post-mortems
  rules: string[]
  // Per-symbol specific insights
  symbolNotes: Record<string, string[]>
  // High-level meta-learning (calibration, biases)
  metaLearning: string
  // Summary of last N post-mortems (rolling window)
  recentLessons: Array<{
    timestamp: number
    symbol: string
    direction: string
    outcome: string
    lesson: string
  }>
}

const DEFAULT_KNOWLEDGE: TradingKnowledge = {
  version: 0,
  lastUpdated: 0,
  rules: [],
  symbolNotes: {},
  metaLearning: '',
  recentLessons: [],
}

export async function getKnowledge(uid: string): Promise<TradingKnowledge> {
  try {
    const ref = doc(db, 'users', uid, 'iaLearning', 'knowledge')
    const snap = await getDoc(ref)
    if (!snap.exists()) return { ...DEFAULT_KNOWLEDGE }
    return { ...DEFAULT_KNOWLEDGE, ...snap.data() } as TradingKnowledge
  } catch {
    return { ...DEFAULT_KNOWLEDGE }
  }
}

export async function saveKnowledge(uid: string, knowledge: TradingKnowledge): Promise<void> {
  const ref = doc(db, 'users', uid, 'iaLearning', 'knowledge')
  await setDoc(ref, knowledge)
}

export function formatKnowledgeForPrompt(k: TradingKnowledge, symbol: string): string {
  if (k.version === 0 && k.rules.length === 0) return ''

  const lines: string[] = [
    `=== LEARNED RULES (v${k.version} — ${k.rules.length} rules accumulated from ${k.recentLessons.length} post-mortems) ===`,
  ]

  if (k.metaLearning) {
    lines.push(`Meta: ${k.metaLearning}`)
  }

  if (k.rules.length > 0) {
    lines.push('General rules:')
    k.rules.slice(-15).forEach((r, i) => lines.push(`  ${i + 1}. ${r}`))
  }

  const symNotes = k.symbolNotes[symbol]
  if (symNotes && symNotes.length > 0) {
    lines.push(`${symbol} specific:`)
    symNotes.slice(-5).forEach(n => lines.push(`  • ${n}`))
  }

  const recent = k.recentLessons.slice(-3)
  if (recent.length > 0) {
    lines.push('Recent lessons:')
    recent.forEach(l => {
      const dt = new Date(l.timestamp).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
      lines.push(`  [${dt}] ${l.symbol} ${l.direction} → ${l.outcome}: ${l.lesson}`)
    })
  }

  lines.push('→ These rules are derived from real past trades on this system. STRICTLY follow them. Do not repeat mistakes listed above.')
  return lines.join('\n')
}
