import { parseAmount } from './money'

/** Betragsbereich in Cent, beide Grenzen eingeschlossen. */
export interface AmountQuery {
  min: number
  max: number
  /** Ein einzelner Betrag wie „49,99“: kann auch Text sein (Hausnummer, Jahr), passt deshalb zusätzlich als Text. */
  exact: boolean
}

const euros = (input: string): number | null => {
  const cents = parseAmount(input)
  return cents !== null && cents >= 0 ? cents : null
}

/**
 * Liest eine Suche nach Beträgen: „49,99“, „>100“, „>=100“, „<20“, „<=20“ oder „10-20“.
 * Gibt null zurück, wenn die Eingabe kein Betrag ist.
 */
export function parseAmountQuery(input: string): AmountQuery | null {
  const s = input.trim().replace(/€/g, '').trim()
  if (s === '') return null

  const comparison = /^([<>]=?)\s*(.+)$/.exec(s)
  if (comparison) {
    const value = euros(comparison[2])
    if (value === null) return null
    switch (comparison[1]) {
      case '>':
        return { min: value + 1, max: Number.MAX_SAFE_INTEGER, exact: false }
      case '>=':
        return { min: value, max: Number.MAX_SAFE_INTEGER, exact: false }
      case '<':
        return { min: 0, max: value - 1, exact: false }
      default:
        return { min: 0, max: value, exact: false }
    }
  }

  const range = /^([\d.,]+)\s*(?:-|–|\.\.)\s*([\d.,]+)$/.exec(s)
  if (range) {
    const from = euros(range[1])
    const to = euros(range[2])
    if (from === null || to === null) return null
    return { min: Math.min(from, to), max: Math.max(from, to), exact: false }
  }

  if (!/^[\d.,]+$/.test(s)) return null
  const value = euros(s)
  return value === null ? null : { min: value, max: value, exact: true }
}

export const matchesAmount = (query: AmountQuery, cents: number): boolean =>
  cents >= query.min && cents <= query.max
