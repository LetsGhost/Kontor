import type { Category, Transaction, TransactionType } from './schemas'

/** Macht Empfänger vergleichbar: "REWE Markt 4711 GmbH" und "Rewe Markt" sollen sich finden. */
export function normalizePayee(payee: string): string {
  return payee
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]+/g, ' ')
    .trim()
}

function bigrams(s: string): Map<string, number> {
  const grams = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const gram = s.slice(i, i + 2)
    grams.set(gram, (grams.get(gram) ?? 0) + 1)
  }
  return grams
}

/** Ähnlichkeit zweier normalisierter Empfänger zwischen 0 und 1. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  if (shorter.length >= 3 && longer.includes(shorter)) return 0.85

  // Dice-Koeffizient über Buchstabenpaare, verzeiht Tippfehler und Wortdreher.
  const gramsA = bigrams(a)
  const gramsB = bigrams(b)
  let overlap = 0
  for (const [gram, count] of gramsA) overlap += Math.min(count, gramsB.get(gram) ?? 0)
  const total = a.length - 1 + (b.length - 1)
  return total > 0 ? (2 * overlap) / total : 0
}

const MIN_SIMILARITY = 0.6
const HALF_LIFE_DAYS = 365

const daysBetween = (from: string, to: string): number =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000

/**
 * Schlägt für einen Empfänger die Kategorie vor, die ähnliche frühere Buchungen am häufigsten hatten.
 * Neuere Buchungen zählen stärker, damit sich geänderte Gewohnheiten durchsetzen.
 */
export function suggestCategory(
  payee: string,
  type: TransactionType,
  transactions: Transaction[],
  categories: Category[],
  today: string
): string | null {
  const target = normalizePayee(payee)
  if (target.length < 2 || type === 'transfer') return null

  const kind = type === 'income' ? 'income' : 'expense'
  const valid = new Set(categories.filter((c) => c.kind === kind && !c.archived).map((c) => c.id))
  const scores = new Map<string, number>()

  for (const tx of transactions) {
    if (tx.type !== type || !tx.categoryId || !valid.has(tx.categoryId)) continue
    const sim = similarity(target, normalizePayee(tx.payee))
    if (sim < MIN_SIMILARITY) continue
    const age = Math.max(0, daysBetween(tx.date, today))
    const weight = sim * sim * 0.5 ** (age / HALF_LIFE_DAYS)
    scores.set(tx.categoryId, (scores.get(tx.categoryId) ?? 0) + weight)
  }

  let best: string | null = null
  let bestScore = 0
  for (const [id, score] of scores) {
    if (score > bestScore) [best, bestScore] = [id, score]
  }
  return best
}

export interface PayeeCompletion {
  payee: string
  /** Betrag der letzten Buchung an diesen Empfänger */
  amountCents: number
}

/** Bekannte Empfänger, die zur bisherigen Eingabe passen: Treffer am Wortanfang zuerst, dann nach Häufigkeit. */
export function payeeCompletions(
  input: string,
  type: TransactionType,
  transactions: Transaction[],
  limit = 5
): PayeeCompletion[] {
  const target = normalizePayee(input)
  if (!target) return []

  const known = new Map<string, { payee: string; amountCents: number; count: number; lastDate: string }>()
  for (const tx of transactions) {
    if (tx.type !== type || !tx.payee) continue
    const key = normalizePayee(tx.payee)
    if (!key.includes(target)) continue
    const entry = known.get(key)
    if (!entry) {
      known.set(key, { payee: tx.payee, amountCents: tx.amountCents, count: 1, lastDate: tx.date })
    } else {
      entry.count++
      if (tx.date >= entry.lastDate) {
        entry.payee = tx.payee
        entry.amountCents = tx.amountCents
        entry.lastDate = tx.date
      }
    }
  }

  return [...known.entries()]
    .sort(
      ([keyA, a], [keyB, b]) =>
        Number(keyB.startsWith(target)) - Number(keyA.startsWith(target)) ||
        b.count - a.count ||
        b.lastDate.localeCompare(a.lastDate)
    )
    .slice(0, limit)
    .map(([, { payee, amountCents }]) => ({ payee, amountCents }))
}
