import type { Account, Transaction } from './schemas'

/** Wirkung einer Buchung auf ein bestimmtes Konto in Cent (0, wenn es nicht beteiligt ist). */
export function effectOnAccount(tx: Transaction, accountId: string): number {
  let effect = 0
  if (tx.accountId === accountId) {
    effect += tx.type === 'income' ? tx.amountCents : -tx.amountCents
  }
  if (tx.type === 'transfer' && tx.transferAccountId === accountId) {
    effect += tx.amountCents
  }
  return effect
}

/** Kontostand am Ende des Tages `onDate` (JJJJ-MM-TT). Spätere Buchungen zählen noch nicht. */
export function accountBalance(account: Account, transactions: Transaction[], onDate: string): number {
  let balance = account.openingBalanceCents
  for (const tx of transactions) {
    if (tx.date <= onDate) balance += effectOnAccount(tx, account.id)
  }
  return balance
}

/**
 * Summe der Kontostände am Ende jedes Tages in `dates`, wie `accountBalance` je Konto, wobei ein Konto erst ab
 * seinem Startdatum zählt. Die Buchungen werden nur einmal durchlaufen statt einmal je Stichtag.
 */
export function balancesOn(accounts: Account[], transactions: Transaction[], dates: string[]): number[] {
  const ids = new Set(accounts.map((a) => a.id))
  const relevant = transactions
    .filter((tx) => ids.has(tx.accountId) || (tx.transferAccountId !== null && ids.has(tx.transferAccountId)))
    .sort((a, b) => a.date.localeCompare(b.date))
  const running = new Map(accounts.map((a) => [a.id, a.openingBalanceCents]))
  const order = dates.map((date, index) => ({ date, index })).sort((a, b) => a.date.localeCompare(b.date))
  const result: number[] = new Array(dates.length)

  let next = 0
  for (const { date, index } of order) {
    for (; next < relevant.length && relevant[next].date <= date; next++) {
      const tx = relevant[next]
      for (const id of [tx.accountId, tx.transferAccountId]) {
        if (id !== null && running.has(id)) running.set(id, running.get(id)! + effectOnAccount(tx, id))
      }
    }
    result[index] = accounts.reduce((sum, a) => (a.openingDate <= date ? sum + running.get(a.id)! : sum), 0)
  }
  return result
}

export function todayIso(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
