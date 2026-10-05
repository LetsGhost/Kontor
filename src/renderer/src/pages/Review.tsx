import { ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { todayIso } from '../../../shared/balance'
import { FALLBACK_ICON } from '../../../shared/defaultCategories'
import { formatDate } from '../../../shared/draft'
import { formatCents } from '../../../shared/money'
import { latestReviewMonth, monthReview } from '../../../shared/review'
import { YearView } from './YearReview'
import { addMonths, monthOf } from '../../../shared/stats'
import { useArea } from '../area'
import { longMonth, monthDate as toDate } from '../charts'
import { CategoryIcon } from '../icons'
import { useApp } from '../store'
import { Button, Section } from '../ui'

const signed = (cents: number): string => `${cents > 0 ? '+' : ''}${formatCents(cents)}`
const percent = new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 0 })

export function Review() {
  const { transactions, categories, budgets } = useApp((s) => s.data)
  const { area, ids } = useArea()
  const latest = latestReviewMonth(todayIso())
  const [month, setMonth] = useState(latest)
  const [mode, setMode] = useState<'month' | 'year'>('month')

  // Weiter zurück als bis zur ersten Buchung des Bereichs gibt es nichts zu sehen.
  const firstMonth = useMemo(() => {
    const dates = transactions.filter((t) => ids.has(t.accountId)).map((t) => t.date)
    return dates.length > 0 ? monthOf(dates.reduce((a, b) => (a < b ? a : b))) : null
  }, [transactions, ids])

  const review = useMemo(
    () =>
      monthReview(
        transactions,
        categories,
        budgets.filter((b) => b.areaId === area.id),
        month,
        ids
      ),
    [transactions, categories, budgets, area.id, month, ids]
  )

  const modeSwitch = (
    <div className="grid grid-cols-2 gap-1 rounded-md border border-line p-0.5 text-sm">
      {(['month', 'year'] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => setMode(m)}
          className={`rounded-sm px-3 py-1 ${mode === m ? 'bg-raised text-text' : 'text-muted hover:text-text'}`}
        >
          {m === 'month' ? 'Monat' : 'Jahr'}
        </button>
      ))}
    </div>
  )

  if (mode === 'year' && firstMonth !== null) {
    return <YearView firstYear={Number(firstMonth.slice(0, 4))} modeSwitch={modeSwitch} />
  }

  if (firstMonth === null || firstMonth > latest) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">Rückblick</h1>
        <p className="text-sm text-muted">
          Sobald ein Monat mit Buchungen vorbei ist, findest du hier eine kurze Zusammenfassung.
        </p>
      </div>
    )
  }

  const deviation = review.netCents - review.planCents
  const over = review.budgets.filter((b) => b.spentCents > b.limitCents)
  const nameOf = (categoryId: string | null): string =>
    categories.find((c) => c.id === categoryId)?.name ?? 'Ohne Kategorie'
  const iconOf = (categoryId: string | null): string =>
    categories.find((c) => c.id === categoryId)?.icon ?? FALLBACK_ICON

  return (
    <div className="max-w-4xl space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-semibold">Rückblick</h1>
          {modeSwitch}
        </div>
        <div className="flex items-center gap-1">
          {month !== latest && (
            <Button small variant="ghost" onClick={() => setMonth(latest)}>
              Letzter Monat
            </Button>
          )}
          <Button
            variant="ghost"
            aria-label="Vorheriger Monat"
            disabled={month <= firstMonth}
            onClick={() => setMonth(addMonths(month, -1))}
          >
            <ChevronLeft size={16} />
          </Button>
          <span className="w-36 text-center text-sm font-medium">{longMonth.format(toDate(month))}</span>
          <Button
            variant="ghost"
            aria-label="Nächster Monat"
            disabled={month >= latest}
            onClick={() => setMonth(addMonths(month, 1))}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      <dl className="flex flex-wrap gap-x-10 gap-y-4 border-b border-line pb-6">
        <Figure label="Geplant verfügbar" hint="Feste Einnahmen − feste Ausgaben">
          {formatCents(review.planCents)}
        </Figure>
        <Figure label="Tatsächlich übrig" hint={`${signed(deviation)} gegenüber Plan`}>
          <span className={review.netCents < 0 ? 'text-danger' : ''}>{formatCents(review.netCents)}</span>
        </Figure>
        <Figure label="Sparquote" hint="Anteil der Einnahmen, der übrig blieb">
          {review.savingsRate === null ? '–' : percent.format(review.savingsRate)}
        </Figure>
      </dl>

      <div className="grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-12">
        <Section title="Fix und variabel">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-y border-line">
                <th className="py-2 font-normal" />
                <th className="py-2 text-right font-normal">Einnahmen</th>
                <th className="py-2 text-right font-normal">Ausgaben</th>
              </tr>
            </thead>
            <tbody className="num divide-y divide-line border-b border-line">
              <Row label="Fest" income={review.fixed.incomeCents} expense={review.fixed.expenseCents} />
              <Row label="Variabel" income={review.variable.incomeCents} expense={review.variable.expenseCents} />
              <Row label="Gesamt" income={review.incomeCents} expense={review.expenseCents} />
              <Row
                label="Vormonat"
                income={review.previous.incomeCents}
                expense={review.previous.expenseCents}
                muted
              />
            </tbody>
          </table>
          {review.expenseCents > 0 && (
            <p className="mt-3 text-xs text-muted">
              {percent.format(review.variable.expenseCents / review.expenseCents)} deiner Ausgaben waren nicht fest
              eingeplant.
            </p>
          )}
        </Section>

        <Section title="Veränderung zum Vormonat">
          {review.changes.length === 0 ? (
            <Empty>Die Ausgaben je Kategorie sind gleich geblieben.</Empty>
          ) : (
            <ul className="ledger">
              {review.changes.map((c) => (
                <li key={c.categoryId ?? 'none'} className="flex items-center gap-3 py-2 text-sm">
                  <CategoryIcon name={c.icon || FALLBACK_ICON} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="num text-xs text-muted">{formatCents(c.previousCents)} →</span>
                  <span className="num w-24 text-right">{formatCents(c.cents)}</span>
                  <span className={`num w-24 text-right ${c.cents < c.previousCents ? 'text-plus' : ''}`}>
                    {signed(c.cents - c.previousCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Größte Ausgaben">
          {review.topExpenses.length === 0 ? (
            <Empty>Keine Ausgaben in diesem Monat.</Empty>
          ) : (
            <ul className="ledger">
              {review.topExpenses.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
                  <CategoryIcon name={iconOf(t.categoryId)} className="shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{t.payee || (t.splits.length > 0 ? 'Aufgeteilt' : nameOf(t.categoryId))}</div>
                    <div className="text-xs text-muted">
                      {formatDate(t.date)}
                      {t.recurringId !== null && ' · fest'}
                    </div>
                  </div>
                  <span className="num">{formatCents(t.amountCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Budgets">
          {review.budgets.length === 0 ? (
            <Empty>Keine Budgets festgelegt.</Empty>
          ) : (
            <div className="space-y-2 text-sm">
              <p>
                {over.length === 0
                  ? `Alle ${review.budgets.length} Budgets eingehalten.`
                  : `${review.budgets.length - over.length} von ${review.budgets.length} Budgets eingehalten.`}
              </p>
              {over.length > 0 && (
                <ul className="space-y-1.5">
                  {over.map((b) => (
                    <li key={b.categoryId} className="flex items-center gap-2">
                      <TriangleAlert size={13} className="shrink-0 text-danger" />
                      <span className="flex-1 truncate">{b.name}</span>
                      <span className="num text-muted">
                        um {formatCents(b.spentCents - b.limitCents)} überschritten
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}

function Figure({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num mt-1 text-2xl">{children}</dd>
      <dd className="mt-0.5 text-xs text-muted">{hint}</dd>
    </div>
  )
}

function Row({ label, income, expense, muted }: { label: string; income: number; expense: number; muted?: boolean }) {
  return (
    <tr className={muted ? 'text-muted' : ''}>
      <td className="py-2 font-sans">{label}</td>
      <td className="py-2 text-right">{formatCents(income)}</td>
      <td className="py-2 text-right">{formatCents(expense)}</td>
    </tr>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>
}
