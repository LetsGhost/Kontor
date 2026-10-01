import { TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { todayIso } from '../../../shared/balance'
import { formatDate } from '../../../shared/draft'
import { BASIS_MONTHS, forecast } from '../../../shared/forecast'
import { formatCents } from '../../../shared/money'
import { idsOf } from '../../../shared/scope'
import { useArea } from '../area'
import {
  AXIS_TEXT,
  BACKGROUND,
  DANGER,
  EXPENSE_COLOR,
  GRID_COLOR,
  INK,
  axisEuro,
  axisProps,
  chartMargin,
  longMonth,
  monthDate,
  renderTooltip,
  shortMonth,
  type TooltipProps
} from '../charts'
import { CategoryIcon } from '../icons'
import { useApp } from '../store'
import { Button, Section, inputClass } from '../ui'

const HORIZONS = [3, 6, 12]

const signed = (cents: number): string => `${cents > 0 ? '+' : ''}${formatCents(cents)}`

export function Forecast() {
  const data = useApp((s) => s.data)
  const [accountId, setAccountId] = useState('')
  const [horizon, setHorizon] = useState(6)
  const [asTable, setAsTable] = useState(false)
  const today = todayIso()
  const { area, active, several } = useArea()
  // Nach einem Bereichswechsel kann das gemerkte Konto zu einem anderen Bereich gehören.
  const selected = active.some((a) => a.id === accountId) ? accountId : ''

  const result = useMemo(
    () => forecast(data, today, horizon, selected ? new Set([selected]) : idsOf(active)),
    [data, today, horizon, selected, active]
  )

  // Vergangenheit und Prognose teilen sich den Punkt „Heute“, damit die Linie durchläuft.
  const chartData = useMemo(
    () => [
      ...result.history.map((h) => ({
        label: shortMonth.format(monthDate(h.month)),
        actual: h.balanceCents as number | null,
        projected: null as number | null
      })),
      { label: 'Heute', actual: result.startCents, projected: result.startCents },
      ...result.points.map((p) => ({
        label: shortMonth.format(monthDate(p.month)),
        actual: null,
        projected: p.balanceCents
      }))
    ],
    [result]
  )

  if (active.length === 0) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">Prognose</h1>
        <p className="text-sm text-muted">
          Für eine Prognose brauchst du zuerst ein Konto{several ? ` im Bereich „${area.name}“` : ''}.
        </p>
      </div>
    )
  }

  const end = result.points[result.points.length - 1]
  const change = end.balanceCents - result.startCents
  const maxCategory = result.variableByCategory[0]?.cents ?? 0
  const fixedPerMonth = result.points.at(-1)!.fixedCents
  const noBasis = result.basisMonths === 0 && data.recurring.every((r) => !r.active)

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 className="text-2xl font-semibold">Prognose</h1>
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Konto"
            className={`${inputClass} w-48`}
            value={selected}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">{several ? `Alle Konten in „${area.name}“` : 'Alle Konten'}</option>
            {active.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <div className="flex gap-1 rounded-md border border-line p-1" role="group" aria-label="Zeitraum">
            {HORIZONS.map((months) => (
              <button
                key={months}
                aria-pressed={horizon === months}
                onClick={() => setHorizon(months)}
                className={`rounded-sm px-2.5 py-1 text-sm whitespace-nowrap ${
                  horizon === months ? 'bg-raised text-text' : 'text-muted hover:text-text'
                }`}
              >
                {months} Monate
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5 border-b border-line pb-6">
        <div>
          <div className="text-xs text-muted">Erwarteter Kontostand Ende {longMonth.format(monthDate(end.month))}</div>
          <div className="num mt-1 text-4xl font-medium xl:text-5xl">{formatCents(end.balanceCents)}</div>
        </div>
        <dl className="flex divide-x divide-line text-right">
          <Figure label="Heute" value={formatCents(result.startCents)} />
          <Figure label="Veränderung" value={signed(change)} />
          <Figure
            label={`Tiefpunkt (${shortMonth.format(monthDate(result.lowest.month))})`}
            value={formatCents(result.lowest.balanceCents)}
          />
        </dl>
      </div>

      {result.firstNegativeMonth && (
        <p className="flex items-center gap-2 text-sm">
          <TriangleAlert size={16} className="shrink-0 text-danger" />
          Nach dieser Rechnung rutscht der Kontostand im {longMonth.format(monthDate(result.firstNegativeMonth))} ins
          Minus.
        </p>
      )}
      {noBasis && (
        <p className="text-sm text-muted">
          Noch gibt es weder wiederkehrende Posten noch einen abgeschlossenen Monat mit Buchungen. Die Prognose bleibt
          deshalb beim heutigen Stand.
        </p>
      )}

      <Section
        title="Verlauf des Kontostands"
        aside={
          <div className="flex items-center gap-5">
            {!asTable && (
              <span className="flex gap-4 text-xs text-muted">
                <LineKey label="Bisher" />
                <LineKey label="Prognose" dashed />
              </span>
            )}
            <Button small onClick={() => setAsTable((v) => !v)}>
              {asTable ? 'Als Diagramm anzeigen' : 'Als Tabelle anzeigen'}
            </Button>
          </div>
        }
      >
        {asTable ? (
          <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap [&_td+td]:pl-4 [&_th+th]:pl-4">
            <thead className="text-left text-xs text-muted">
              <tr className="border-y border-line">
                <th className="py-2 font-normal">Monat</th>
                <th className="py-2 text-right font-normal">Wiederkehrend</th>
                <th className="py-2 text-right font-normal">Variabel (geschätzt)</th>
                <th className="py-2 text-right font-normal">Schon erfasst</th>
                <th className="py-2 text-right font-normal">Kontostand am Monatsende</th>
              </tr>
            </thead>
            <tbody className="num divide-y divide-line border-b border-line">
              {result.points.map((p, i) => (
                <tr key={p.month}>
                  <td className="py-2 font-sans">
                    {longMonth.format(monthDate(p.month))}
                    {i === 0 && <span className="text-muted"> (Rest)</span>}
                  </td>
                  <td className="py-2 text-right">{signed(p.fixedCents)}</td>
                  <td className="py-2 text-right">{signed(p.variableCents)}</td>
                  <td className="py-2 text-right">{signed(p.plannedCents)}</td>
                  <td className={`py-2 text-right ${p.balanceCents < 0 ? 'text-danger' : ''}`}>
                    {formatCents(p.balanceCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        ) : (
          <div className="h-80 border-t border-line pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={chartMargin}>
                <CartesianGrid vertical={false} stroke={GRID_COLOR} />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis tickFormatter={axisEuro} width={64} {...axisProps} />
                <Tooltip cursor={{ stroke: AXIS_TEXT, strokeWidth: 1 }} content={firstValueTooltip} />
                {result.lowest.balanceCents < 0 && <ReferenceLine y={0} stroke={DANGER} strokeWidth={1} />}
                <Area dataKey="actual" name="Kontostand" stroke={INK} fill={INK} fillOpacity={0.08} {...areaProps} />
                <Area
                  dataKey="projected"
                  name="Prognose"
                  stroke={INK}
                  strokeDasharray="5 4"
                  fill={INK}
                  fillOpacity={0.03}
                  {...areaProps}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-10 xl:grid-cols-2 xl:gap-12">
        <Section title="So ist gerechnet">
          <dl className="ledger text-sm">
            <Row label="Wiederkehrende Posten pro Monat" value={signed(fixedPerMonth)} />
            <Row label="Variable Einnahmen pro Monat" value={signed(result.variableIncomeCents)} />
            <Row label="Variable Ausgaben pro Monat" value={signed(-result.variableExpenseCents)} />
          </dl>
          <p className="text-xs text-muted">
            {result.basisMonths === 0
              ? 'Für die variablen Posten fehlt noch ein abgeschlossener Monat.'
              : `Variable Posten sind der Durchschnitt ${
                  result.basisMonths === 1
                    ? 'des letzten abgeschlossenen Monats'
                    : `der letzten ${result.basisMonths} abgeschlossenen Monate`
                }${result.basisMonths < BASIS_MONTHS ? ` (angestrebt sind ${BASIS_MONTHS})` : ''}.`}{' '}
            Buchungen, die zu einer wiederkehrenden Regel gehören, und Umbuchungen zwischen den betrachteten Konten
            zählen dabei nicht mit; Umbuchungen auf andere Konten gelten als Ausgabe. Im
            laufenden Monat wird nur noch erwartet, was vom Durchschnitt nicht schon gebucht ist. Die
            wiederkehrenden Posten zeigen den letzten Monat des Zeitraums.
          </p>

          {result.variableByCategory.length > 0 && (
            <div className="pt-4 text-xs text-muted">Variable Ausgaben pro Monat nach Kategorie</div>
          )}
          {result.variableByCategory.length > 0 && (
            <ul className="space-y-2.5">
              {result.variableByCategory.map((c) => (
                <li key={c.categoryId ?? 'none'} className="grid grid-cols-[10rem_1fr_6.5rem] items-center gap-3 text-sm">
                  <span className="flex items-center gap-2 truncate">
                    <CategoryIcon name={c.icon} className="shrink-0 text-muted" />
                    <span className="truncate">{c.name}</span>
                  </span>
                  <span
                    className="h-2.5 rounded-r-sm"
                    style={{ width: `${Math.max(1, (c.cents / maxCategory) * 100)}%`, background: EXPENSE_COLOR }}
                  />
                  <span className="num text-right">{formatCents(c.cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Nächste wiederkehrende Termine">
          {result.upcoming.length === 0 ? (
            <p className="text-sm text-muted">
              Keine Termine im Zeitraum. Regeln legst du unter „Wiederkehrend“ an.
            </p>
          ) : (
            <ul className="ledger">
              {result.upcoming.map((item, i) => (
                <li key={i} className="flex items-center gap-4 py-2.5 text-sm">
                  <span className="num w-24 shrink-0 text-muted">{formatDate(item.date)}</span>
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <span className={`num ${item.cents > 0 ? 'text-plus' : ''}`}>{signed(item.cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  )
}

const areaProps = {
  type: 'monotone' as const,
  strokeWidth: 2,
  dot: false,
  activeDot: { r: 5, stroke: BACKGROUND, strokeWidth: 2 },
  isAnimationActive: false
}

/** Am Punkt „Heute“ liegen beide Reihen übereinander; dort reicht ein Wert. */
const firstValueTooltip = (props: TooltipProps) =>
  renderTooltip({ ...props, payload: props.payload?.filter((row) => row.value != null).slice(0, 1) })

function LineKey({ label, dashed = false }: { label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-5 border-t-2 border-text ${dashed ? 'border-dashed' : ''}`} />
      {label}
    </span>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 first:pl-0 last:pr-0 xl:px-6">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num mt-1 text-xl">{value}</dd>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  )
}
