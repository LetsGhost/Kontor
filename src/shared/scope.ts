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
  /** Betrifft keines der Konten im Blick */
  | 'outside'

/**
 * Wie eine Buchung aus Sicht einer Gruppe von Konten zählt. Eine Umbuchung, die die Gruppe verlässt
 * (Giro → Haushaltskonto), ist für die Gruppe eine Ausgabe, auf der anderen Seite eine Einnahme.
 */
export function viewOf(tx: Pick<Transaction, 'type' | 'accountId' | 'transferAccountId'>, ids: Ids): View {
  const from = ids.has(tx.accountId)
  if (tx.type !== 'transfer') return from ? tx.type : 'outside'

  const to = tx.transferAccountId !== null && ids.has(tx.transferAccountId)
  if (from && to) return 'internal'
  if (from) return 'expense'
  return to ? 'income' : 'outside'
}
