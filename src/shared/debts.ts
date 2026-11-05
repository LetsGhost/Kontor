import type { Debt, Person, Transaction } from './schemas'
import { normalizePayee } from './suggest'

/**
 * Ein Vorgang mit einer Person. Positiv: Die Person schuldet dir dadurch mehr (du hast ihr Geld gegeben),
 * negativ: du schuldest ihr mehr bzw. sie hat zurückgezahlt.
 */
export interface DebtEvent {
  /** id der Buchung oder des freien Eintrags */
  id: string
  source: 'transaction' | 'entry'
  date: string
  label: string
  signedCents: number
  /** Was von diesem Vorgang noch offen ist, mit Vorzeichen. Älteste Vorgänge werden zuerst beglichen. */
  openCents: number
}

export interface PersonDebts {
  person: Person
  /** Positiv: Die Person schuldet dir, negativ: du schuldest ihr */
  balanceCents: number
  /** Neueste zuerst */
  events: DebtEvent[]
}

/** Geld an die Person (Ausgabe) erhöht ihre Schuld bei dir, Geld von ihr (Einnahme) senkt sie. */
export const debtEffect = (tx: Pick<Transaction, 'type' | 'amountCents'>): number =>
  tx.type === 'income' ? -tx.amountCents : tx.type === 'expense' ? tx.amountCents : 0

/** Saldo und Vorgänge je Person. Zahlungen gleichen die ältesten offenen Vorgänge der Gegenrichtung aus. */
export function debtsByPerson(persons: Person[], debts: Debt[], transactions: Transaction[]): PersonDebts[] {
  return persons.map((person) => {
    const events: DebtEvent[] = [
      ...debts
        .filter((d) => d.personId === person.id)
        .map((d) => {
          const signedCents = d.direction === 'owedToMe' ? d.amountCents : -d.amountCents
          return {
            id: d.id,
            source: 'entry' as const,
            date: d.date,
            label: d.note,
            signedCents,
            openCents: signedCents
          }
        }),
      ...transactions
        .filter((t) => t.personId === person.id && t.type !== 'transfer')
        .map((t) => {
          const signedCents = debtEffect(t)
          return {
            id: t.id,
            source: 'transaction' as const,
            date: t.date,
            label: [t.payee, t.note].filter(Boolean).join(' · '),
            signedCents,
            openCents: signedCents
          }
        })
    ].sort((a, b) => a.date.localeCompare(b.date))

    // Offene Vorgänge haben immer alle dasselbe Vorzeichen; ein neuer der Gegenrichtung zehrt sie von vorn auf.
    const open: DebtEvent[] = []
    for (const event of events) {
      while (event.openCents !== 0 && open.length > 0 && Math.sign(open[0].openCents) !== Math.sign(event.openCents)) {
        const head = open[0]
        const settled = Math.min(Math.abs(head.openCents), Math.abs(event.openCents))
        head.openCents -= Math.sign(head.openCents) * settled
        event.openCents -= Math.sign(event.openCents) * settled
        if (head.openCents === 0) open.shift()
      }
      if (event.openCents !== 0) open.push(event)
    }

    const balanceCents = open.reduce((sum, e) => sum + e.openCents, 0)
    return { person, balanceCents, events: events.reverse() }
  })
}

/** Gesamtsummen: was dir alle schulden und was du allen schuldest. */
export function debtTotals(rows: PersonDebts[]): { owedToMeCents: number; iOweCents: number } {
  let owedToMeCents = 0
  let iOweCents = 0
  for (const r of rows) {
    if (r.balanceCents > 0) owedToMeCents += r.balanceCents
    else iOweCents -= r.balanceCents
  }
  return { owedToMeCents, iOweCents }
}

/** Personen mit offenem Saldo, deren Fälligkeit erreicht ist. */
export const overdueDebts = (rows: PersonDebts[], today: string): PersonDebts[] =>
  rows.filter((r) => r.balanceCents !== 0 && r.person.dueDate !== null && r.person.dueDate <= today)

const MIN_ALIAS_LENGTH = 3

/**
 * Zu welcher Person eine importierte Zeile gehören könnte: Empfänger enthält ihren Namen oder einen
 * Erkennungsnamen, und es ist eine Schuld in passender Richtung offen (Geld kommt nur von jemandem zurück,
 * der dir schuldet). Ohne offene Schuld kein Vorschlag, sonst würde etwa ein Geschenk zur Schuld.
 */
export function suggestPerson(payee: string, type: 'expense' | 'income', rows: PersonDebts[]): string | null {
  const text = ` ${normalizePayee(payee)} `
  const hit = rows.find(
    (r) =>
      !r.person.archived &&
      (type === 'income' ? r.balanceCents > 0 : r.balanceCents < 0) &&
      [r.person.name, ...r.person.aliases]
        .map(normalizePayee)
        .some((name) => name.length >= MIN_ALIAS_LENGTH && text.includes(` ${name} `))
  )
  return hit?.person.id ?? null
}
