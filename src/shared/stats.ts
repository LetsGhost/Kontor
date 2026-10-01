import { accountBalance } from './balance'
import type { Account, Budget, Category, Transaction } from './schemas'
import { idsOf, viewOf, type Ids } from './scope'

/** Monate werden durchgehend als "JJJJ-MM" geführt. */
export const monthOf = (date: string): string => date.slice(0, 7)

export function addMonths(month: string, delta: number): string {
  const [year, m] = month.split('-').map(Number)
  const index = year * 12 + (m - 1) + delta
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

export function lastDayOfMonth(month: string): string {
  const [year, m] = month.split('-').map(Number)
  const day = new Date(Date.UTC(year, m, 0)).getUTCDate()
  return `${month}-${String(day).padStart(2, '0')}`
}

/**
 * Einnahmen und Ausgaben eines Monats aus Sicht der Konten in `ids`. Umbuchungen zwischen diesen Konten
 * zählen zu keinem von beiden, Umbuchungen nach außen sind Ausgaben, von außen Einnahmen.
 */
export function monthTotals(
  transactions: Transaction[],
  month: string,
  ids: Ids
): { incomeCents: number; expenseCents: number } {
  let incomeCents = 0
  let expenseCents = 0
  for (const tx of transactions) {
    if (monthOf(tx.date) !== month) continue
    const view = viewOf(tx, ids)
    if (view === 'income') incomeCents += tx.amountCents
    else if (view === 'expense') expenseCents += tx.amountCents
  }
  return { incomeCents, expenseCents }
}

export interface CategorySpending {
  /** id der Hauptkategorie, null für Buchungen ohne Kategorie */
  categoryId: string | null
  name: string
  icon: string
  cents: number
}

/** Summiert Ausgaben je Hauptkategorie (Unterkategorien eingerechnet), größte zuerst. */
export function groupByRootCategory(
  expenses: Pick<Transaction, 'categoryId' | 'amountCents'>[],
  categories: Category[]
): CategorySpending[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const sums = new Map<string | null, number>()

  for (const tx of expenses) {
    const category = tx.categoryId ? byId.get(tx.categoryId) : undefined
    const root = category ? (category.parentId ?? category.id) : null
    sums.set(root, (sums.get(root) ?? 0) + tx.amountCents)
  }

  return [...sums.entries()]
    .map(([categoryId, cents]) => {
      const category = categoryId ? byId.get(categoryId) : undefined
      return { categoryId, name: category?.name ?? 'Ohne Kategorie', icon: category?.icon ?? '', cents }
    })
    .sort((a, b) => b.cents - a.cents)
}

/** Ausgaben eines Monats je Hauptkategorie aus Sicht der Konten in `ids`. */
export function spendingByCategory(
  transactions: Transaction[],
  categories: Category[],
  month: string,
  ids: Ids
): CategorySpending[] {
  return groupByRootCategory(
    transactions.filter((tx) => monthOf(tx.date) === month && viewOf(tx, ids) === 'expense'),
    categories
  )
}

export interface MonthPoint {
  month: string
  incomeCents: number
  expenseCents: number
  /** Summe der aktiven Konten am Monatsende, im laufenden Monat der Stand von heute */
  balanceCents: number
}

/** Die letzten `count` Monate bis einschließlich `endMonth` für die übergebenen Konten. */
export function monthlySeries(
  accounts: Account[],
  transactions: Transaction[],
  endMonth: string,
  count: number,
  today: string
): MonthPoint[] {
  const ids = idsOf(accounts)
  const active = accounts.filter((a) => !a.archived)
  const points: MonthPoint[] = []

  for (let i = count - 1; i >= 0; i--) {
    const month = addMonths(endMonth, -i)
    const monthEnd = lastDayOfMonth(month)
    const onDate = monthEnd < today ? monthEnd : today
    const balanceCents = active
      // Vor seinem Startdatum wird ein Konto noch nicht geführt.
      .filter((a) => a.openingDate <= onDate)
      .reduce((sum, a) => sum + accountBalance(a, transactions, onDate), 0)
    points.push({ month, ...monthTotals(transactions, month, ids), balanceCents })
  }
  return points
}

export interface BudgetStatus {
  categoryId: string
  name: string
  icon: string
  limitCents: number
  spentCents: number
}

/**
 * Verbrauch je Budget im Monat aus Sicht der Konten in `ids`. Das Budget einer Hauptkategorie umfasst
 * ihre Unterkategorien.
 */
export function budgetStatus(
  budgets: Budget[],
  categories: Category[],
  transactions: Transaction[],
  month: string,
  ids: Ids
): BudgetStatus[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const expenses = transactions.filter((t) => monthOf(t.date) === month && viewOf(t, ids) === 'expense')

  return budgets.flatMap((budget) => {
    const category = byId.get(budget.categoryId)
    if (!category) return []
    const spentCents = expenses
      .filter(
        (t) => t.categoryId === category.id || (t.categoryId && byId.get(t.categoryId)?.parentId === category.id)
      )
      .reduce((sum, t) => sum + t.amountCents, 0)
    return [
      {
        categoryId: category.id,
        name: category.name,
        icon: category.icon,
        limitCents: budget.limitCents,
        spentCents
      }
    ]
  })
}
