const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })

export function formatCents(cents: number): string {
  return eur.format(cents / 100)
}

/** Betrag für ein Eingabefeld, ohne Währungszeichen und Tausenderpunkte ("1234,50"). */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}

/**
 * Liest eine Betragseingabe in Cent. Deutsche Schreibweise ("1.234,56") hat Vorrang,
 * "12.50" wird als Dezimalpunkt akzeptiert. Gibt null bei ungültiger Eingabe zurück.
 */
export function parseAmount(input: string): number | null {
  let s = input.replace(/[\s€]/g, '')
  if (s === '') return null

  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (!/^-?\d+\.\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, '')
  }
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null

  const negative = s.startsWith('-')
  const [euros, fraction = ''] = s.replace('-', '').split('.')
  const value = Number(euros) * 100 + Number(fraction.padEnd(2, '0'))
  return negative ? -value : value
}
