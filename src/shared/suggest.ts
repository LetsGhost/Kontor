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

// Für „zuletzt oft benutzt“ zählt vor allem das letzte Vierteljahr.
const FREQUENT_HALF_LIFE_DAYS = 90

const daysBetween = (from: string, to: string): number =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000

const decay = (date: string, today: string, halfLife: number): number =>
  0.5 ** (Math.max(0, daysBetween(date, today)) / halfLife)

/** Wählbare Kategorien einer Buchungsart, absteigend nach der Summe der Gewichte ihrer Buchungen. */
function rankCategories(
  type: TransactionType,
  transactions: Transaction[],
  categories: Category[],
  weightOf: (tx: Transaction) => number
): string[] {
  if (type === 'transfer') return []
  const valid = new Set(categories.filter((c) => c.kind === type && !c.archived).map((c) => c.id))
  const scores = new Map<string, number>()

  for (const tx of transactions) {
    if (tx.type !== type || !tx.categoryId || !valid.has(tx.categoryId)) continue
    const weight = weightOf(tx)
    if (weight > 0) scores.set(tx.categoryId, (scores.get(tx.categoryId) ?? 0) + weight)
  }

  return [...scores.entries()].sort(([, a], [, b]) => b - a).map(([id]) => id)
}

/**
 * Kategorien, die ähnliche frühere Buchungen an diesen Empfänger hatten, die wahrscheinlichste zuerst.
 * Neuere Buchungen zählen stärker, damit sich geänderte Gewohnheiten durchsetzen.
 */
export function suggestCategories(
  payee: string,
  type: TransactionType,
  transactions: Transaction[],
  categories: Category[],
  today: string,
  limit = 3
): string[] {
  const target = normalizePayee(payee)
  if (target.length < 2) return []

  return rankCategories(type, transactions, categories, (tx) => {
    const sim = similarity(target, normalizePayee(tx.payee))
    return sim < MIN_SIMILARITY ? 0 : sim * sim * decay(tx.date, today, HALF_LIFE_DAYS)
  }).slice(0, limit)
}

/** Der beste Vorschlag für einen Empfänger, oder null, wenn nichts Ähnliches bekannt ist. */
export function suggestCategory(
  payee: string,
  type: TransactionType,
  transactions: Transaction[],
  categories: Category[],
  today: string
): string | null {
  return suggestCategories(payee, type, transactions, categories, today, 1)[0] ?? null
}

/** Die in letzter Zeit am häufigsten benutzten Kategorien, unabhängig vom Empfänger. */
export function frequentCategories(
  type: TransactionType,
  transactions: Transaction[],
  categories: Category[],
  today: string,
  limit = 3
): string[] {
  return rankCategories(type, transactions, categories, (tx) =>
    decay(tx.date, today, FREQUENT_HALF_LIFE_DAYS)
  ).slice(0, limit)
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
