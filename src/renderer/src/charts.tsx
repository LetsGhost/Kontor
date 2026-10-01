import type { ReactNode } from 'react'
import { formatCents } from '../../shared/money'

// Auf dem dunklen Hintergrund geprüftes Farbpaar (auch bei Farbfehlsichtigkeit unterscheidbar).
// Ausgaben sind in jedem Diagramm orange, Einnahmen grün, der Kontostand papierweiß.
export const INCOME_COLOR = '#199e70'
export const EXPENSE_COLOR = '#d95926'
export const INK = '#ece8df'
export const GRID_COLOR = '#33302a'
export const AXIS_TEXT = '#9c968a'
export const BACKGROUND = '#141311'
export const DANGER = '#e0695a'

export const longMonth = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' })
export const shortMonth = new Intl.DateTimeFormat('de-DE', { month: 'short', year: '2-digit' })
const compact = new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1 })

/** "JJJJ-MM" als Datum am Monatsersten, für die Monatsnamen. */
export const monthDate = (month: string): Date => {
  const [year, m] = month.split('-').map(Number)
  return new Date(year, m - 1, 1)
}

export const axisEuro = (cents: number): string => `${compact.format(cents / 100)} €`

export const axisProps = {
  tick: { fill: AXIS_TEXT, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: GRID_COLOR }
}

export const chartMargin = { top: 8, right: 8, bottom: 0, left: 0 }

export interface TooltipProps {
  active?: boolean
  label?: string | number
  payload?: readonly { name?: unknown; value?: unknown; color?: string }[]
}

export function renderTooltip(props: TooltipProps): ReactNode {
  if (!props.active || !props.payload?.length) return null
  return (
    <div className="rounded-md border border-line bg-raised px-3 py-2 text-xs">
      <div className="mb-1 text-muted">{props.label}</div>
      {props.payload.map((row) => (
        <div key={String(row.name)} className="flex items-center justify-between gap-4">
          <Key color={row.color ?? AXIS_TEXT} label={String(row.name)} />
          <span className="num">{formatCents(Number(row.value))}</span>
        </div>
      ))}
    </div>
  )
}

export function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2" style={{ background: color }} />
      {label}
    </span>
  )
}
