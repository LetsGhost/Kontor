import type { Recurring, Transaction, TransactionType } from './schemas'
import { addMonths, lastDayOfMonth } from './stats'
import { normalizePayee } from './suggest'

type Interval = Recurring['interval']

export const intervalLabel: Record<Interval, string> = {
  weekly: 'Wöchentlich',
  monthly: 'Monatlich',
  quarterly: 'Vierteljährlich',
  yearly: 'Jährlich'
}

const MONTHS_PER_STEP = { monthly: 1, quarterly: 3, yearly: 12 }
const DAY_MS = 86_400_000

const toMs = (date: string): number => Date.parse(`${date}T00:00:00Z`)
const daysBetween = (from: string, to: string): number => Math.round((toMs(to) - toMs(from)) / DAY_MS)
const addDays = (date: string, days: number): string =>
  new Date(toMs(date) + days * DAY_MS).toISOString().slice(0, 10)

/**
 * Der k-te Termin einer Regel, immer vom Startdatum aus gerechnet. So bleibt der 31. als Wunschtag
 * erhalten, auch wenn er zwischendurch auf den 28. oder 30. gekürzt werden musste.
 */
export function occurrence(startDate: string, interval: Interval, k: number): string {
  if (interval === 'weekly') return addDays(startDate, 7 * k)
  const month = addMonths(startDate.slice(0, 7), k * MONTHS_PER_STEP[interval])
  const wanted = `${month}-${startDate.slice(8)}`
  const last = lastDayOfMonth(month)
  return wanted > last ? last : wanted
}

/** Der erste Termin, der nach `date` liegt. */
export function occurrenceAfter(rule: Pick<Recurring, 'startDate' | 'interval'>, date: string): string {
  for (let k = 0; ; k++) {
    const candidate = occurrence(rule.startDate, rule.interval, k)
    if (candidate > date) return candidate
  }
}

const MAX_DUE = 120

/** Alle noch offenen Termine bis einschließlich heute, älteste zuerst. */
export function dueDates(rule: Recurring, today: string): string[] {
  if (!rule.active) return []
  const dates: string[] = []
  let date = rule.nextDueDate
  while (date <= today && (rule.endDate === null || date <= rule.endDate) && dates.length < MAX_DUE) {
    dates.push(date)
    date = occurrenceAfter(rule, date)
  }
  return dates
}

/** Setzt die Regel auf den Termin nach `date` weiter. Ist das Enddatum überschritten, wird sie inaktiv. */
export function advance(rule: Recurring, date: string): Recurring {
  const nextDueDate = occurrenceAfter(rule, date)
  const ended = rule.endDate !== null && nextDueDate > rule.endDate
  return { ...rule, nextDueDate, active: ended ? false : rule.active }
}

/** Die echte Buchung zu einem bestätigten Termin. Der Betrag darf von der Regel abweichen. */
export function bookOccurrence(
  rule: Recurring,
  date: string,
  amountCents: number,
  id: string,
  createdAt: string
): Transaction {
  return {
    id,
    date,
    accountId: rule.accountId,
    type: rule.type,
    amountCents,
    payee: rule.payee,
    note: rule.note,
    categoryId: rule.categoryId,
    transferAccountId: rule.transferAccountId,
    recurringId: rule.id,
    importHash: null,
    createdAt
  }
}

/** Betrag einer Regel auf einen Monat umgerechnet, für die Summe der Fixkosten. */
export function monthlyCents(rule: Pick<Recurring, 'amountCents' | 'interval'>): number {
  const factor = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }[rule.interval]
  return Math.round(rule.amountCents * factor)
}

export const patternKey = (type: TransactionType, payee: string): string => `${type}:${normalizePayee(payee)}`

export interface DetectedPattern {
  key: string
  payee: string
  type: TransactionType
  accountId: string
  categoryId: string | null
  amountCents: number
  interval: Interval
  nextDueDate: string
  /** Die Buchungen, aus denen das Muster erkannt wurde */
  transactionIds: string[]
}

// Erlaubter Abstand in Tagen je Rhythmus. Wochenenden und Feiertage verschieben Abbuchungen um ein paar Tage.
const GAP_RANGES: [Interval, number, number][] = [
  ['weekly', 6, 8],
  ['monthly', 26, 35],
  ['quarterly', 84, 98],
  ['yearly', 350, 380]
]
const MIN_OCCURRENCES = 3
const AMOUNT_TOLERANCE = 0.1
// So viele Termine dürfen zwischen zwei Buchungen fehlen, etwa bei einem pausierten Abo.
const MAX_SKIPPED = 2

/** Bei gerader Anzahl der untere der beiden mittleren Werte. */
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

/** Passt der Abstand zum Rhythmus, auch wenn bis zu MAX_SKIPPED Termine dazwischen ausgefallen sind? */
const fitsRhythm = (gap: number, min: number, max: number): boolean => {
  for (let steps = 1; steps <= MAX_SKIPPED + 1; steps++) {
    if (gap >= min * steps && gap <= max * steps) return true
  }
  return false
}

/**
 * Findet Buchungen, die wie ein Dauerauftrag aussehen: gleicher Empfänger, ähnlicher Betrag,
 * regelmäßiger Abstand. Bereits angelegte Regeln und abgelehnte Muster werden übersprungen.
 */
export function detectPatterns(
  transactions: Transaction[],
  recurring: Recurring[],
  dismissed: string[],
  today: string
): DetectedPattern[] {
  const skip = new Set([...dismissed, ...recurring.map((r) => patternKey(r.type, r.payee))])
  const groups = new Map<string, Transaction[]>()

  for (const tx of transactions) {
    if (tx.type === 'transfer' || tx.recurringId !== null || tx.date > today) continue
    if (!normalizePayee(tx.payee)) continue
    const key = patternKey(tx.type, tx.payee)
    if (skip.has(key)) continue
    const group = groups.get(key)
    if (group) group.push(tx)
    else groups.set(key, [tx])
  }

  const patterns: DetectedPattern[] = []
  for (const [key, group] of groups) {
    if (group.length < MIN_OCCURRENCES) continue
    group.sort((a, b) => a.date.localeCompare(b.date))

    // Der typische Abstand bestimmt den Rhythmus, die übrigen dürfen ein Vielfaches davon sein.
    const gaps = group.slice(1).map((tx, i) => daysBetween(group[i].date, tx.date))
    const typicalGap = median(gaps)
    const range = GAP_RANGES.find(([, min, max]) => typicalGap >= min && typicalGap <= max)
    if (!range) continue
    const [interval, minGap, maxGap] = range
    if (!gaps.every((gap) => fitsRhythm(gap, minGap, maxGap))) continue

    const typical = median(group.map((tx) => tx.amountCents))
    if (group.some((tx) => Math.abs(tx.amountCents - typical) > typical * AMOUNT_TOLERANCE)) continue

    // Ist der letzte Termin lange her, wurde der Vertrag vermutlich gekündigt.
    const last = group[group.length - 1]
    if (daysBetween(last.date, today) > maxGap * 1.5) continue

    patterns.push({
      key,
      payee: last.payee,
      type: last.type,
      accountId: last.accountId,
      categoryId: last.categoryId,
      amountCents: last.amountCents,
      interval,
      nextDueDate: occurrence(last.date, interval, 1),
      transactionIds: group.map((tx) => tx.id)
    })
  }

  return patterns.sort((a, b) => b.amountCents - a.amountCents)
}
