import type { Account, Transaction } from './schemas'

export type Ids = ReadonlySet<string>

/** Die Konten eines Bereichs, auch archivierte: ihre alten Buchungen gehören weiter zur Auswertung. */
export function areaAccounts(accounts: Account[], areaId: string): Account[] {
  return accounts.filter((a) => a.areaId === areaId)
}

export const idsOf = (accounts: Account[]): Set<string> => new Set(accounts.map((a) => a.id))

export type View =
  | 'income'
  | 'expense'
  /** Umbuchung zwischen zwei Konten im Blick: weder Einnahme noch Ausgabe */
  | 'internal'
  /** Geld an oder von einer Person, bei der Schulden geführt werden: weder Einnahme noch Ausgabe */
  | 'debt'
  /** Betrifft keines der Konten im Blick */
  | 'outside'

/**
 * Wie eine Buchung aus Sicht einer Gruppe von Konten zählt. Eine Umbuchung, die die Gruppe verlässt
 * (Giro → Haushaltskonto), ist für die Gruppe eine Ausgabe, auf der anderen Seite eine Einnahme.
 */
export function viewOf(
  tx: Pick<Transaction, 'type' | 'accountId' | 'transferAccountId'> & { personId?: string | null },
  ids: Ids
): View {
  const from = ids.has(tx.accountId)
  if (tx.type !== 'transfer') return from ? (tx.personId ? 'debt' : tx.type) : 'outside'

  const to = tx.transferAccountId !== null && ids.has(tx.transferAccountId)
  if (from && to) return 'internal'
  if (from) return 'expense'
  return to ? 'income' : 'outside'
}
