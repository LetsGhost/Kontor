import { describeDeadline, upcomingDeadlines } from './contracts'
import { formatCents } from './money'
import { dueDates } from './recurring'
import type { KontorData } from './schemas'
import { areaAccounts, idsOf } from './scope'
import { budgetStatus, monthOf } from './stats'

export interface Reminder {
  kind: 'due' | 'budget' | 'contract'
  title: string
  body: string
}

const MAX_LINES = 3

/** Zählt die ersten Einträge auf und fasst den Rest zusammen. */
const listing = (lines: string[]): string =>
  lines.length <= MAX_LINES
    ? lines.join('\n')
    : [...lines.slice(0, MAX_LINES), `und ${lines.length - MAX_LINES} weitere`].join('\n')

/** Woran Kontor beim Start erinnert: fällige Posten, überschrittene Budgets, ablaufende Kündigungsfristen. */
export function reminders(data: KontorData, today: string): Reminder[] {
  const result: Reminder[] = []
  const several = data.areas.length > 1

  const due = data.recurring.filter((rule) => dueDates(rule, today).length > 0)
  if (due.length > 0) {
    result.push({
      kind: 'due',
      title: due.length === 1 ? 'Ein wiederkehrender Posten ist fällig' : `${due.length} wiederkehrende Posten sind fällig`,
      body: listing(due.map((r) => r.payee || 'Umbuchung'))
    })
  }

  const month = monthOf(today)
  const over = data.areas.flatMap((area) =>
    budgetStatus(
      data.budgets.filter((b) => b.areaId === area.id),
      data.categories,
      data.transactions,
      month,
      idsOf(areaAccounts(data.accounts, area.id))
    )
      .filter((b) => b.spentCents > b.limitCents)
      .map((b) => `${b.name}${several ? ` (${area.name})` : ''}: ${formatCents(b.spentCents - b.limitCents)} drüber`)
  )
  if (over.length > 0) {
    result.push({
      kind: 'budget',
      title: over.length === 1 ? 'Ein Budget ist überschritten' : `${over.length} Budgets sind überschritten`,
      body: listing(over)
    })
  }

  const deadlines = upcomingDeadlines(data.recurring, today)
  if (deadlines.length > 0) {
    result.push({
      kind: 'contract',
      title:
        deadlines.length === 1
          ? `Kündigungsfrist: ${deadlines[0].rule.payee}`
          : `${deadlines.length} Kündigungsfristen laufen bald ab`,
      body: listing(deadlines.map((d) => (deadlines.length === 1 ? describeDeadline(d) : `${d.rule.payee}: ${describeDeadline(d)}`)))
    })
  }

  return result
}
