import { accountBalance, effectOnAccount } from './balance'
import { bookOccurrence, occurrenceAfter } from './recurring'
import type { KontorData, Transaction } from './schemas'
import { viewOf, type Ids } from './scope'
import { addMonths, groupByRootCategory, lastDayOfMonth, monthOf, type CategorySpending } from './stats'

/** So viele abgeschlossene Monate fließen in den Durchschnitt der variablen Posten ein. */
export const BASIS_MONTHS = 3
const HISTORY_MONTHS = 6
const MAX_OCCURRENCES_PER_RULE = 600

export interface ForecastPoint {
  month: string
  /** Wiederkehrende Posten in diesem Monat, mit Vorzeichen */
  fixedCents: number
  /** Geschätzte variable Einnahmen minus Ausgaben; im laufenden Monat nur der noch nicht gebuchte Rest */
  variableCents: number
  /** Bereits erfasste Buchungen mit Datum in der Zukunft */
  plannedCents: number
  /** Erwarteter Kontostand am Monatsende */
  balanceCents: number
}

export interface UpcomingItem {
  date: string
  title: string
  cents: number
}

export interface Forecast {
  startCents: number
  /** Tatsächlicher Kontostand an den letzten Monatsenden, für den Anschluss im Diagramm */
  history: { month: string; balanceCents: number }[]
  points: ForecastPoint[]
  /** Durchschnitt je Monat aus den Basis-Monaten, ohne wiederkehrende Posten und interne Umbuchungen */
  variableIncomeCents: number
  variableExpenseCents: number
  variableByCategory: CategorySpending[]
  /** Anzahl der Monate, auf denen der Durchschnitt beruht (0 = noch keine Historie) */
  basisMonths: number
  lowest: ForecastPoint
  /** Erster Monat, in dem der Kontostand unter null fällt */
  firstNegativeMonth: string | null
  upcoming: UpcomingItem[]
}

type ForecastData = Pick<KontorData, 'accounts' | 'transactions' | 'recurring' | 'categories'>

/**
 * Rechnet den Kontostand hoch: heutiger Stand, plus wiederkehrende Posten an ihren Terminen, plus der
 * Durchschnitt der übrigen Einnahmen und Ausgaben. Buchungen, die zu einer Regel gehören, zählen nicht
 * in den Durchschnitt, sonst wären Fixkosten doppelt enthalten.
 *
 * @param ids die Konten, die gemeinsam betrachtet werden: ein einzelnes oder alle aktiven eines Bereichs.
 *   Umbuchungen aus dieser Gruppe heraus zählen wie Ausgaben, in sie hinein wie Einnahmen.
 */
export function forecast(data: ForecastData, today: string, horizonMonths: number, ids: Ids): Forecast {
  const scope = data.accounts.filter((a) => ids.has(a.id))
  const currentMonth = monthOf(today)
  const horizonEnd = lastDayOfMonth(addMonths(currentMonth, horizonMonths))

  // Umbuchungen zwischen zwei Konten im Blick heben sich auf, sonst wirken sie wie Zu- oder Abgang.
  const effect = (tx: Transaction): number =>
    scope.reduce((sum, account) => sum + effectOnAccount(tx, account.id), 0)
  const balanceOn = (date: string): number =>
    scope
      .filter((a) => a.openingDate <= date)
      .reduce((sum, a) => sum + accountBalance(a, data.transactions, date), 0)

  // --- Variable Posten: Durchschnitt der letzten abgeschlossenen Monate ---
  const firstMonth = scope.length > 0 ? monthOf(scope.map((a) => a.openingDate).sort()[0]) : currentMonth
  const basis = Array.from({ length: BASIS_MONTHS }, (_, i) => addMonths(currentMonth, -(i + 1))).filter(
    (month) => month >= firstMonth
  )
  const divisor = Math.max(1, basis.length)
  const variable = data.transactions.filter((tx) => tx.recurringId === null)
  const sum = (txs: Transaction[]): number => txs.reduce((total, tx) => total + tx.amountCents, 0)

  const basisTxs = variable.filter((tx) => basis.includes(monthOf(tx.date)))
  const basisExpenses = basisTxs.filter((tx) => viewOf(tx, ids) === 'expense')
  const variableIncomeCents = Math.round(sum(basisTxs.filter((tx) => viewOf(tx, ids) === 'income')) / divisor)
  const variableExpenseCents = Math.round(sum(basisExpenses) / divisor)
  const variableByCategory = groupByRootCategory(basisExpenses, data.categories).map((c) => ({
    ...c,
    cents: Math.round(c.cents / divisor)
  }))

  // --- Feste und geplante Posten als datierte Ereignisse ---
  const fixed: UpcomingItem[] = []
  for (const rule of data.recurring) {
    if (!rule.active) continue
    let date = rule.nextDueDate
    for (let n = 0; n < MAX_OCCURRENCES_PER_RULE && date <= horizonEnd; n++) {
      if (rule.endDate !== null && date > rule.endDate) break
      const cents = effect(bookOccurrence(rule, date, rule.amountCents, '', ''))
      if (cents !== 0) fixed.push({ date, title: rule.type === 'transfer' ? 'Umbuchung' : rule.payee, cents })
      date = occurrenceAfter(rule, date)
    }
  }
  const planned = data.transactions
    .filter((tx) => tx.date > today && tx.date <= horizonEnd)
    .map((tx) => ({ date: tx.date, cents: effect(tx) }))

  // Überfällige, noch nicht bestätigte Termine werden dem laufenden Monat zugerechnet.
  const monthOfEvent = (date: string): string => (date <= today ? currentMonth : monthOf(date))
  const sumIn = (events: { date: string; cents: number }[], month: string): number =>
    events.reduce((sum, e) => sum + (monthOfEvent(e.date) === month ? e.cents : 0), 0)

  // --- Monat für Monat hochrechnen ---
  const startCents = balanceOn(today)
  const variableNet = variableIncomeCents - variableExpenseCents

  // Im laufenden Monat bleibt nur übrig, was vom Durchschnitt noch nicht gebucht ist. Ein Gehalt vom
  // Monatsersten wird so nicht ein zweites Mal erwartet.
  const thisMonth = variable.filter((tx) => monthOf(tx.date) === currentMonth && tx.date <= today)
  const incomeSoFar = sum(thisMonth.filter((tx) => viewOf(tx, ids) === 'income'))
  const expenseSoFar = sum(thisMonth.filter((tx) => viewOf(tx, ids) === 'expense'))
  const restOfMonth =
    Math.max(0, variableIncomeCents - incomeSoFar) - Math.max(0, variableExpenseCents - expenseSoFar)

  const points: ForecastPoint[] = []
  let balanceCents = startCents
  for (let k = 0; k <= horizonMonths; k++) {
    const month = addMonths(currentMonth, k)
    const fixedCents = sumIn(fixed, month)
    const plannedCents = sumIn(planned, month)
    const variableCents = k === 0 ? restOfMonth : variableNet
    balanceCents += fixedCents + plannedCents + variableCents
    points.push({ month, fixedCents, variableCents, plannedCents, balanceCents })
  }

  const history = Array.from({ length: HISTORY_MONTHS }, (_, i) => addMonths(currentMonth, i - HISTORY_MONTHS))
    .filter((month) => month >= firstMonth)
    .map((month) => ({ month, balanceCents: balanceOn(lastDayOfMonth(month)) }))

  return {
    startCents,
    history,
    points,
    variableIncomeCents,
    variableExpenseCents,
    variableByCategory,
    basisMonths: basis.length,
    lowest: points.reduce((low, p) => (p.balanceCents < low.balanceCents ? p : low)),
    firstNegativeMonth: points.find((p) => p.balanceCents < 0)?.month ?? null,
    upcoming: fixed
      .filter((e) => e.date > today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 8)
  }
}
