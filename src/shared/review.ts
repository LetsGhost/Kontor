import type { Budget, Category, Transaction } from './schemas'
import { viewOf, type Ids } from './scope'
import { addMonths, budgetStatus, groupByRootCategory, lastDayOfMonth, monthOf, type BudgetStatus } from './stats'

const TOP_COUNT = 5

/** Der jüngste Monat mit Rückblick: am Monatsletzten schon der laufende, sonst der vorige. */
export function latestReviewMonth(today: string): string {
  const month = monthOf(today)
  return today === lastDayOfMonth(month) ? month : addMonths(month, -1)
}

interface Split {
  incomeCents: number
  expenseCents: number
}

export interface CategoryChange {
  categoryId: string | null
  name: string
  icon: string
  cents: number
  previousCents: number
}

export interface MonthReview {
  month: string
  incomeCents: number
  expenseCents: number
  /** Aus wiederkehrenden Regeln gebucht */
  fixed: Split
  /** Alles andere */
  variable: Split
  /** Was nach den festen Posten übrig bleiben sollte */
  planCents: number
  /** Was tatsächlich übrig blieb */
  netCents: number
  /** Anteil der Einnahmen, der übrig blieb; null ohne Einnahmen */
  savingsRate: number | null
  previous: { incomeCents: number; expenseCents: number }
  /** Hauptkategorien mit der größten Veränderung zum Vormonat */
  changes: CategoryChange[]
  /** Die größten einzelnen Ausgaben */
  topExpenses: Transaction[]
  budgets: BudgetStatus[]
}

/**
 * Zusammenfassung eines Monats aus Sicht der Konten in `ids`. Als fest gilt, was über eine Regel gebucht
 * wurde. So bleibt der Plan alter Monate stabil, auch wenn sich die Regeln seitdem geändert haben.
 */
export function monthReview(
  transactions: Transaction[],
  categories: Category[],
  budgets: Budget[],
  month: string,
  ids: Ids
): MonthReview {
  const previousMonth = addMonths(month, -1)
  const fixed: Split = { incomeCents: 0, expenseCents: 0 }
  const variable: Split = { incomeCents: 0, expenseCents: 0 }
  const previous = { incomeCents: 0, expenseCents: 0 }
  const expenses: Transaction[] = []
  const previousExpenses: Transaction[] = []

  for (const tx of transactions) {
    const txMonth = monthOf(tx.date)
    if (txMonth !== month && txMonth !== previousMonth) continue
    const view = viewOf(tx, ids)
    if (view !== 'income' && view !== 'expense') continue
    const key = view === 'income' ? 'incomeCents' : 'expenseCents'

    if (txMonth === previousMonth) {
      previous[key] += tx.amountCents
      if (view === 'expense') previousExpenses.push(tx)
      continue
    }
    ;(tx.recurringId !== null ? fixed : variable)[key] += tx.amountCents
    if (view === 'expense') expenses.push(tx)
  }

  const incomeCents = fixed.incomeCents + variable.incomeCents
  const expenseCents = fixed.expenseCents + variable.expenseCents
  const netCents = incomeCents - expenseCents

  const before = new Map(groupByRootCategory(previousExpenses, categories).map((c) => [c.categoryId, c]))
  const changes: CategoryChange[] = groupByRootCategory(expenses, categories).map((c) => ({
    ...c,
    previousCents: before.get(c.categoryId)?.cents ?? 0
  }))
  // Kategorien, für die diesen Monat nichts mehr anfiel, sind auch eine Veränderung.
  const seen = new Set(changes.map((c) => c.categoryId))
  for (const c of before.values()) {
    if (!seen.has(c.categoryId)) changes.push({ ...c, cents: 0, previousCents: c.cents })
  }

  return {
    month,
    incomeCents,
    expenseCents,
    fixed,
    variable,
    planCents: fixed.incomeCents - fixed.expenseCents,
    netCents,
    savingsRate: incomeCents > 0 ? netCents / incomeCents : null,
    previous,
    changes: changes
      .filter((c) => c.cents !== c.previousCents)
      .sort((a, b) => Math.abs(b.cents - b.previousCents) - Math.abs(a.cents - a.previousCents))
      .slice(0, TOP_COUNT),
    topExpenses: [...expenses].sort((a, b) => b.amountCents - a.amountCents).slice(0, TOP_COUNT),
    budgets: budgetStatus(budgets, categories, transactions, month, ids)
  }
}

export interface YearMonth {
  month: string
  incomeCents: number
  expenseCents: number
  netCents: number
  savingsRate: number | null
}

export interface YearCategory extends CategoryChange {
  /** Anteil an allen Ausgaben des Jahres */
  share: number
}

export interface YearReview {
  year: number
  months: YearMonth[]
  incomeCents: number
  expenseCents: number
  netCents: number
  savingsRate: number | null
  /** Aus wiederkehrenden Regeln gebuchte Ausgaben */
  fixedExpenseCents: number
  /** Vorjahr, im laufenden Jahr nur bis zum selben Kalendertag, damit der Vergleich fair bleibt */
  previous: { incomeCents: number; expenseCents: number }
  /** Stichtag des laufenden Jahres (JJJJ-MM-TT), oder null für ein abgeschlossenes Jahr */
  until: string | null
  /** Alle Hauptkategorien mit Ausgaben in diesem oder im Vorjahr, größte zuerst */
  categories: YearCategory[]
  topExpenses: Transaction[]
}

const YEAR_TOP_COUNT = 10

/**
 * Zusammenfassung eines Kalenderjahres aus Sicht der Konten in `ids`, mit Vergleich zum Vorjahr.
 * Mit `today` im selben Jahr zählt nur, was bis heute gebucht ist, und das Vorjahr nur bis zum selben Tag.
 */
export function yearReview(
  transactions: Transaction[],
  categories: Category[],
  year: number,
  ids: Ids,
  today?: string
): YearReview {
  const prefix = String(year)
  const previousPrefix = String(year - 1)
  const until = today && today.startsWith(`${prefix}-`) ? today : null
  const inPeriod = (date: string): boolean =>
    until === null || date.slice(5) <= until.slice(5)
  const months: YearMonth[] = Array.from({ length: 12 }, (_, i) => ({
    month: `${prefix}-${String(i + 1).padStart(2, '0')}`,
    incomeCents: 0,
    expenseCents: 0,
    netCents: 0,
    savingsRate: null
  }))
  const previous = { incomeCents: 0, expenseCents: 0 }
  const expenses: Transaction[] = []
  const previousExpenses: Transaction[] = []
  let fixedExpenseCents = 0

  for (const tx of transactions) {
    const txYear = tx.date.slice(0, 4)
    if ((txYear !== prefix && txYear !== previousPrefix) || !inPeriod(tx.date)) continue
    const view = viewOf(tx, ids)
    if (view !== 'income' && view !== 'expense') continue
    const key = view === 'income' ? 'incomeCents' : 'expenseCents'

    if (txYear === previousPrefix) {
      previous[key] += tx.amountCents
      if (view === 'expense') previousExpenses.push(tx)
      continue
    }
    months[Number(tx.date.slice(5, 7)) - 1][key] += tx.amountCents
    if (view === 'expense') {
      expenses.push(tx)
      if (tx.recurringId !== null) fixedExpenseCents += tx.amountCents
    }
  }

  for (const m of months) {
    m.netCents = m.incomeCents - m.expenseCents
    m.savingsRate = m.incomeCents > 0 ? m.netCents / m.incomeCents : null
  }
  const incomeCents = months.reduce((sum, m) => sum + m.incomeCents, 0)
  const expenseCents = months.reduce((sum, m) => sum + m.expenseCents, 0)
  const netCents = incomeCents - expenseCents

  const before = new Map(groupByRootCategory(previousExpenses, categories).map((c) => [c.categoryId, c]))
  const rows: YearCategory[] = groupByRootCategory(expenses, categories).map((c) => ({
    ...c,
    previousCents: before.get(c.categoryId)?.cents ?? 0,
    share: expenseCents > 0 ? c.cents / expenseCents : 0
  }))
  const seen = new Set(rows.map((c) => c.categoryId))
  for (const c of before.values()) {
    if (!seen.has(c.categoryId)) rows.push({ ...c, cents: 0, previousCents: c.cents, share: 0 })
  }

  return {
    year,
    months,
    incomeCents,
    expenseCents,
    netCents,
    savingsRate: incomeCents > 0 ? netCents / incomeCents : null,
    fixedExpenseCents,
    previous,
    until,
    categories: rows.sort((a, b) => b.cents - a.cents || b.previousCents - a.previousCents),
    topExpenses: [...expenses].sort((a, b) => b.amountCents - a.amountCents).slice(0, YEAR_TOP_COUNT)
  }
}
