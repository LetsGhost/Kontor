import { ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { accountBalance, todayIso } from '../../../shared/balance'
import { formatCents } from '../../../shared/money'
import { addMonths, budgetStatus, monthOf, monthTotals, monthlySeries, spendingByCategory } from '../../../shared/stats'
import { DueList, useDue } from '../Due'
import { useArea } from '../area'
import {
  AXIS_TEXT,
  BACKGROUND,
  EXPENSE_COLOR,
  GRID_COLOR,
  INCOME_COLOR,
  INK,
  Key,
  axisEuro,
  axisProps,
  chartMargin,
  longMonth,
  monthDate as toDate,
  renderTooltip,
  shortMonth
} from '../charts'
import { CategoryIcon } from '../icons'
import { useApp } from '../store'
import { Button, Section } from '../ui'

const HISTORY_MONTHS = 12

export function Overview() {
  const { transactions, categories, budgets } = useApp((s) => s.data)
  // Alles auf dieser Seite gilt für den gewählten Bereich, nie für alle Konten zusammen.
  const { area, accounts, active, ids, several } = useArea()
  const due = useDue(ids)
  const today = todayIso()
  const currentMonth = monthOf(today)
  const [month, setMonth] = useState(currentMonth)
  const [asTable, setAsTable] = useState(false)

  const total = active.reduce((sum, a) => sum + accountBalance(a, transactions, today), 0)
  const { incomeCents, expenseCents } = monthTotals(transactions, month, ids)
  const spending = useMemo(
    () => spendingByCategory(transactions, categories, month, ids),
    [transactions, categories, month, ids]
  )
  const budgetRows = useMemo(
    () =>
      budgetStatus(
        budgets.filter((b) => b.areaId === area.id),
        categories,
        transactions,
        month,
        ids
      ),
    [budgets, area.id, categories, transactions, month, ids]
  )
  const series = useMemo(
    () =>
      monthlySeries(accounts, transactions, month, HISTORY_MONTHS, today).map((p) => ({
        ...p,
        label: shortMonth.format(toDate(p.month))
      })),
    [accounts, transactions, month, today]
  )

  if (accounts.length === 0) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">Übersicht</h1>
        <p className="text-sm text-muted">
          {several ? `Im Bereich „${area.name}“ gibt es noch keine Konten.` : 'Noch keine Konten angelegt.'} Lege unter
          „Konten“ eines an, dann erscheinen hier deine Zahlen.
        </p>
      </div>
    )
  }

  const maxSpending = spending[0]?.cents ?? 0
  const net = incomeCents - expenseCents

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold">Übersicht</h1>
        <div className="flex items-center gap-1">
          {month !== currentMonth && (
            <Button small variant="ghost" onClick={() => setMonth(currentMonth)}>
              Aktueller Monat
            </Button>
          )}
          <Button variant="ghost" aria-label="Vorheriger Monat" onClick={() => setMonth(addMonths(month, -1))}>
            <ChevronLeft size={16} />
          </Button>
          <span className="w-36 text-center text-sm font-medium">{longMonth.format(toDate(month))}</span>
          <Button
            variant="ghost"
            aria-label="Nächster Monat"
            disabled={month >= currentMonth}
            onClick={() => setMonth(addMonths(month, 1))}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5 border-b border-line pb-6">
        <div>
          <div className="text-xs text-muted">{several ? `Saldo „${area.name}“ heute` : 'Gesamtsaldo heute'}</div>
          <div className="num mt-1 text-4xl font-medium xl:text-5xl">{formatCents(total)}</div>
        </div>
        <dl className="flex divide-x divide-line text-right">
          <Figure label="Einnahmen" value={formatCents(incomeCents)} />
          <Figure label="Ausgaben" value={formatCents(expenseCents)} />
          <Figure label="Bilanz" value={`${net > 0 ? '+' : ''}${formatCents(net)}`} />
        </dl>
      </div>

      {due.length > 0 && (
        <Section title="Fällige wiederkehrende Posten">
          <DueList items={due} />
        </Section>
      )}

      <div className="grid grid-cols-1 gap-10 xl:grid-cols-2 xl:gap-12">
        <Section title="Ausgaben nach Kategorie">
          {spending.length === 0 ? (
            <Empty>Keine Ausgaben in diesem Monat.</Empty>
          ) : (
            <ul className="space-y-2.5">
              {spending.map((s) => (
                <li key={s.categoryId ?? 'none'} className="grid grid-cols-[10rem_1fr_6.5rem] items-center gap-3 text-sm">
                  <span className="flex items-center gap-2 truncate">
                    <CategoryIcon name={s.icon} className="shrink-0 text-muted" />
                    <span className="truncate">{s.name}</span>
                  </span>
                  <span
                    className="h-2.5 rounded-r-sm"
                    style={{ width: `${Math.max(1, (s.cents / maxSpending) * 100)}%`, background: EXPENSE_COLOR }}
                    title={`${Math.round((s.cents / expenseCents) * 100)} % der Ausgaben`}
                  />
                  <span className="num text-right">{formatCents(s.cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Budgets">
          {budgetRows.length === 0 ? (
            <Empty>Noch keine Budgets. Lege sie unter „Kategorien“ beim Bearbeiten einer Kategorie fest.</Empty>
          ) : (
            <ul className="space-y-3.5">
              {budgetRows.map((b) => {
                const ratio = b.spentCents / b.limitCents
                const state = ratio > 1 ? 'over' : ratio >= 0.8 ? 'near' : 'ok'
                const color = { over: 'var(--color-danger)', near: 'var(--color-warn)', ok: 'var(--color-muted)' }[state]
                return (
                  <li key={b.categoryId} className="space-y-1.5 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="flex items-center gap-2 truncate">
                        <CategoryIcon name={b.icon} className="shrink-0 text-muted" />
                        <span className="truncate">{b.name}</span>
                      </span>
                      <span className="num shrink-0 text-muted">
                        <span className="text-text">{formatCents(b.spentCents)}</span> / {formatCents(b.limitCents)}
                      </span>
                    </div>
                    <div className="h-1.5 bg-raised">
                      <div className="h-full" style={{ width: `${Math.min(100, ratio * 100)}%`, background: color }} />
                    </div>
                    {state !== 'ok' && (
                      <div className="flex items-center gap-1.5 text-xs text-muted">
                        {state === 'over' && <TriangleAlert size={13} className="text-danger" />}
                        {state === 'over'
                          ? `Um ${formatCents(b.spentCents - b.limitCents)} überschritten`
                          : `Fast aufgebraucht, noch ${formatCents(b.limitCents - b.spentCents)} übrig`}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
      </div>

      <Section
        title={`Verlauf der letzten ${HISTORY_MONTHS} Monate`}
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
                <th className="py-2 text-right font-normal">Kontostand am Monatsende</th>
              </tr>
            </thead>
            <tbody className="num divide-y divide-line border-b border-line">
              {series.map((p) => (
                <tr key={p.month}>
                  <td className="py-2 font-sans">{longMonth.format(toDate(p.month))}</td>
                  <td className="py-2 text-right">{formatCents(p.incomeCents)}</td>
                  <td className="py-2 text-right">{formatCents(p.expenseCents)}</td>
                  <td className="py-2 text-right">{formatCents(p.balanceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="grid grid-cols-1 gap-10 border-t border-line pt-4 xl:grid-cols-2 xl:gap-12">
            <div>
              <div className="mb-3 flex items-center justify-between text-xs text-muted">
                <span>Einnahmen und Ausgaben</span>
                <span className="flex gap-4">
                  <Key color={INCOME_COLOR} label="Einnahmen" />
                  <Key color={EXPENSE_COLOR} label="Ausgaben" />
                </span>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={series} barGap={2} margin={chartMargin}>
                    <CartesianGrid vertical={false} stroke={GRID_COLOR} />
                    <XAxis dataKey="label" {...axisProps} />
                    <YAxis tickFormatter={axisEuro} width={64} {...axisProps} />
                    <Tooltip cursor={{ fill: 'rgba(236,232,223,0.05)' }} content={renderTooltip} />
                    <Bar dataKey="incomeCents" name="Einnahmen" fill={INCOME_COLOR} {...barProps} />
                    <Bar dataKey="expenseCents" name="Ausgaben" fill={EXPENSE_COLOR} {...barProps} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div>
              <div className="mb-3 text-xs text-muted">Kontostand gesamt am Monatsende</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={chartMargin}>
                    <CartesianGrid vertical={false} stroke={GRID_COLOR} />
                    <XAxis dataKey="label" {...axisProps} />
                    <YAxis tickFormatter={axisEuro} width={64} {...axisProps} />
                    <Tooltip cursor={{ stroke: AXIS_TEXT, strokeWidth: 1 }} content={renderTooltip} />
                    <Area
                      dataKey="balanceCents"
                      name="Kontostand"
                      type="monotone"
                      stroke={INK}
                      strokeWidth={2}
                      fill={INK}
                      fillOpacity={0.08}
                      dot={false}
                      activeDot={{ r: 5, stroke: BACKGROUND, strokeWidth: 2 }}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </Section>

      <Section title="Konten">
        <ul className="ledger">
          {active.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2.5 text-sm">
              <span>{a.name}</span>
              <span className="num">{formatCents(accountBalance(a, transactions, today))}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

const barProps = {
  maxBarSize: 20,
  radius: [2, 2, 0, 0] as [number, number, number, number],
  isAnimationActive: false
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 first:pl-0 last:pr-0 xl:px-6">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num mt-1 text-xl">{value}</dd>
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>
}
