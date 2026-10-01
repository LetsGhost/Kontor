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

export function todayIso(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
