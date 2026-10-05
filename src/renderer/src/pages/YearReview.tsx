import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { todayIso } from '../../../shared/balance'
import { FALLBACK_ICON } from '../../../shared/defaultCategories'
import { formatDate } from '../../../shared/draft'
import { formatCents } from '../../../shared/money'
import { yearReview } from '../../../shared/review'
import { useArea } from '../area'
import {
  ACCENT,
  AXIS_TEXT,
  EXPENSE_COLOR,
  GRID_COLOR,
  INCOME_COLOR,
  Key,
  axisEuro,
  axisProps,
  chartMargin,
  longMonth,
  monthDate,
  type TooltipProps
} from '../charts'
import { CategoryIcon } from '../icons'
import { useApp } from '../store'
import { Button, Section } from '../ui'

const percent = new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 0 })
const monthLetter = new Intl.DateTimeFormat('de-DE', { month: 'short' })
const signed = (cents: number): string => `${cents > 0 ? '+' : ''}${formatCents(cents)}`

/** Veränderung zum Vorjahr in Prozent, oder null, wenn es im Vorjahr nichts gab. */
const change = (now: number, before: number): number | null => (before > 0 ? (now - before) / before : null)

export function YearView({ firstYear, modeSwitch }: { firstYear: number; modeSwitch: ReactNode }) {
  const { transactions, categories } = useApp((s) => s.data)
  const { ids } = useArea()
  const today = todayIso()
  const currentYear = Number(today.slice(0, 4))
  const [year, setYear] = useState(currentYear)
  const [asTable, setAsTable] = useState(false)

  const review = useMemo(
    () => yearReview(transactions, categories, year, ids, today),
    [transactions, categories, year, ids, today]
  )
  const nameOf = (id: string | null): string => categories.find((c) => c.id === id)?.name ?? 'Ohne Kategorie'
  const iconOf = (id: string | null): string => categories.find((c) => c.id === id)?.icon ?? FALLBACK_ICON

  const running = year === currentYear
  // Im laufenden Jahr nur die Monate bis heute zeigen, sonst sähen die übrigen wie Nullmonate aus.
  const months = running ? review.months.filter((m) => m.month <= today.slice(0, 7)) : review.months
  const chartData = months.map((m) => ({
    ...m,
    label: monthLetter.format(monthDate(m.month)),
    savingsPercent: m.savingsRate === null ? null : Math.round(m.savingsRate * 100)
  }))
  const versus = review.until ? `zum Vorjahr bis ${formatDate(review.until).slice(0, 6)}` : 'zum Vorjahr'
  const expenseChange = change(review.expenseCents, review.previous.expenseCents)
  const incomeChange = change(review.incomeCents, review.previous.incomeCents)
  const best = months.filter((m) => m.incomeCents > 0).sort((a, b) => b.netCents - a.netCents)[0]
  const maxCategory = review.categories[0]?.cents ?? 0

  return (
    <div className="max-w-5xl space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-semibold">Rückblick</h1>
          {modeSwitch}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" aria-label="Vorheriges Jahr" disabled={year <= firstYear} onClick={() => setYear(year - 1)}>
            <ChevronLeft size={16} />
          </Button>
          <span className="w-28 text-center text-sm font-medium">
            {year}
            {running && <span className="text-muted"> bisher</span>}
          </span>
          <Button variant="ghost" aria-label="Nächstes Jahr" disabled={year >= currentYear} onClick={() => setYear(year + 1)}>
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      <dl className="flex flex-wrap gap-x-10 gap-y-4 border-b border-line pb-6">
        <Figure label="Einnahmen" hint={incomeChange === null ? 'Kein Vorjahr' : `${signedPercent(incomeChange)} ${versus}`}>
          {formatCents(review.incomeCents)}
        </Figure>
        <Figure
          label="Ausgaben"
          hint={expenseChange === null ? 'Kein Vorjahr' : `${signedPercent(expenseChange)} ${versus}`}
        >
          {formatCents(review.expenseCents)}
        </Figure>
        <Figure label="Übrig" hint={best ? `Bester Monat: ${longMonth.format(monthDate(best.month))}` : ' '}>
          <span className={review.netCents < 0 ? 'text-danger' : ''}>{formatCents(review.netCents)}</span>
        </Figure>
        <Figure label="Sparquote" hint="Anteil der Einnahmen, der übrig blieb">
          {review.savingsRate === null ? '–' : percent.format(review.savingsRate)}
        </Figure>
      </dl>

      <Section
        title="Monat für Monat"
        aside={
          <Button small onClick={() => setAsTable((v) => !v)}>
            {asTable ? 'Als Diagramm anzeigen' : 'Als Tabelle anzeigen'}
          </Button>
        }
      >
        {asTable ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-y border-line">
                <th className="py-2 font-normal">Monat</th>
                <th className="py-2 text-right font-normal">Einnahmen</th>
                <th className="py-2 text-right font-normal">Ausgaben</th>
                <th className="py-2 text-right font-normal">Übrig</th>
                <th className="py-2 text-right font-normal">Sparquote</th>
              </tr>
            </thead>
            <tbody className="num divide-y divide-line border-b border-line">
              {months.map((m) => (
                <tr key={m.month}>
                  <td className="py-2 font-sans">{longMonth.format(monthDate(m.month))}</td>
                  <td className="py-2 text-right">{formatCents(m.incomeCents)}</td>
                  <td className="py-2 text-right">{formatCents(m.expenseCents)}</td>
                  <td className={`py-2 text-right ${m.netCents < 0 ? 'text-danger' : ''}`}>{formatCents(m.netCents)}</td>
                  <td className="py-2 text-right">{m.savingsRate === null ? '–' : percent.format(m.savingsRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="border-t border-line pt-4">
            <div className="mb-3 flex justify-end gap-4 text-xs text-muted">
              <Key color={INCOME_COLOR} label="Einnahmen" />
              <Key color={EXPENSE_COLOR} label="Ausgaben" />
              <Key color={ACCENT} label="Sparquote (rechte Achse)" />
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} barGap={2} margin={chartMargin}>
                  <CartesianGrid vertical={false} stroke={GRID_COLOR} />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis yAxisId="euro" tickFormatter={axisEuro} width={64} {...axisProps} />
                  <YAxis
                    yAxisId="rate"
                    orientation="right"
                    tickFormatter={(v: number) => `${v} %`}
                    width={48}
                    {...axisProps}
                  />
                  <Tooltip cursor={{ fill: 'rgba(236,232,223,0.05)' }} content={renderYearTooltip} />
                  <Bar yAxisId="euro" dataKey="incomeCents" name="Einnahmen" fill={INCOME_COLOR} {...barProps} />
                  <Bar yAxisId="euro" dataKey="expenseCents" name="Ausgaben" fill={EXPENSE_COLOR} {...barProps} />
                  <Line
                    yAxisId="rate"
                    dataKey="savingsPercent"
                    name="Sparquote"
                    stroke={ACCENT}
                    strokeWidth={2}
                    dot={{ r: 3, fill: ACCENT, strokeWidth: 0 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
        {review.expenseCents > 0 && (
          <p className="mt-3 text-xs text-muted">
            {percent.format(review.fixedExpenseCents / review.expenseCents)} der Ausgaben stammen aus wiederkehrenden
            Posten.
          </p>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[3fr_2fr] lg:gap-12">
        <Section
          title={`Ausgaben nach Kategorie, verglichen mit ${year - 1}${
            review.until ? ` bis ${formatDate(review.until).slice(0, 6)}` : ''
          }`}
        >
          {review.categories.length === 0 ? (
            <p className="text-sm text-muted">Keine Ausgaben in diesem Jahr.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-y border-line">
                  <th className="py-2 font-normal">Kategorie</th>
                  <th className="hidden py-2 font-normal sm:table-cell" />
                  <th className="py-2 text-right font-normal">{year}</th>
                  <th className="py-2 text-right font-normal">{year - 1}</th>
                  <th className="py-2 text-right font-normal">Veränderung</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line border-b border-line">
                {review.categories.map((c) => {
                  const diff = c.cents - c.previousCents
                  return (
                    <tr key={c.categoryId ?? 'none'}>
                      <td className="py-2">
                        <span className="flex items-center gap-2 truncate">
                          <CategoryIcon name={c.icon || FALLBACK_ICON} className="shrink-0 text-muted" />
                          <span className="truncate">{c.name}</span>
                        </span>
                      </td>
                      <td className="hidden w-24 py-2 sm:table-cell" title={`${percent.format(c.share)} der Ausgaben`}>
                        <div
                          className="h-2 rounded-r-sm"
                          style={{
                            width: `${maxCategory > 0 ? Math.max(1, (c.cents / maxCategory) * 100) : 0}%`,
                            background: EXPENSE_COLOR
                          }}
                        />
                      </td>
                      <td className="num py-2 text-right">{formatCents(c.cents)}</td>
                      <td className="num py-2 text-right text-muted">{formatCents(c.previousCents)}</td>
                      <td className={`num py-2 text-right ${diff < 0 ? 'text-plus' : ''}`}>
                        {c.previousCents === 0 ? '–' : signed(diff)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Größte Ausgaben">
          {review.topExpenses.length === 0 ? (
            <p className="text-sm text-muted">Keine Ausgaben in diesem Jahr.</p>
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
      </div>
    </div>
  )
}

const signedPercent = (value: number): string => `${value > 0 ? '+' : ''}${percent.format(value)}`

const barProps = {
  maxBarSize: 18,
  radius: [2, 2, 0, 0] as [number, number, number, number],
  isAnimationActive: false
}

/** Wie renderTooltip, aber die Sparquote ist ein Prozentwert und kein Betrag. */
function renderYearTooltip(props: TooltipProps): ReactNode {
  if (!props.active || !props.payload?.length) return null
  return (
    <div className="rounded-md border border-line bg-raised px-3 py-2 text-xs">
      <div className="mb-1 text-muted">{props.label}</div>
      {props.payload.map((row) => (
        <div key={String(row.name)} className="flex items-center justify-between gap-4">
          <Key color={row.color ?? AXIS_TEXT} label={String(row.name)} />
          <span className="num">
            {row.name === 'Sparquote'
              ? row.value === null || row.value === undefined
                ? '–'
                : `${String(row.value)} %`
              : formatCents(Number(row.value))}
          </span>
        </div>
      ))}
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
