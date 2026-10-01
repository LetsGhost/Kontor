import { parseAmount } from './money'
import type { Account, Transaction, TransactionType } from './schemas'

/** Rohzustand des Buchungsformulars: alles Text, so wie es eingegeben wurde. */
export interface TransactionDraft {
  type: TransactionType
  date: string
  accountId: string
  transferAccountId: string
  amount: string
  payee: string
  note: string
  categoryId: string
}

export type DraftErrors = Partial<Record<'amount' | 'date' | 'accountId' | 'transferAccountId', string>>

export type BookingValues = Pick<
  Transaction,
  'type' | 'date' | 'accountId' | 'transferAccountId' | 'amountCents' | 'payee' | 'note' | 'categoryId'
>

export function isRealDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(`${date}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date)
}

export function formatDate(date: string): string {
  const [year, month, day] = date.split('-')
  return `${day}.${month}.${year}`
}

/** Prüft eine Formulareingabe und liefert entweder die fertigen Buchungswerte oder Fehler je Feld. */
export function checkDraft(
  draft: TransactionDraft,
  accounts: Account[]
): { ok: true; values: BookingValues } | { ok: false; errors: DraftErrors } {
  const errors: DraftErrors = {}

  const amountCents = parseAmount(draft.amount)
  if (amountCents === null || amountCents <= 0) {
    errors.amount = 'Bitte einen Betrag größer als 0 eingeben'
  }

  const account = accounts.find((a) => a.id === draft.accountId)
  if (!account) errors.accountId = 'Bitte ein Konto wählen'

  const isTransfer = draft.type === 'transfer'
  const target = isTransfer ? accounts.find((a) => a.id === draft.transferAccountId) : undefined
  if (isTransfer) {
    if (!target) errors.transferAccountId = 'Bitte ein Zielkonto wählen'
    else if (target.id === draft.accountId) errors.transferAccountId = 'Zielkonto muss ein anderes Konto sein'
  }

  if (!isRealDate(draft.date)) {
    errors.date = 'Bitte ein gültiges Datum eingeben'
  } else {
    const tooEarly = [account, target].find((a) => a && draft.date < a.openingDate)
    if (tooEarly) {
      errors.date = `Liegt vor dem Startdatum von „${tooEarly.name}“ (${formatDate(tooEarly.openingDate)})`
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return {
    ok: true,
    values: {
      type: draft.type,
      date: draft.date,
      accountId: draft.accountId,
      transferAccountId: isTransfer ? draft.transferAccountId : null,
      amountCents: amountCents!,
      payee: draft.payee.trim(),
      note: draft.note.trim(),
      // Umbuchungen tragen nur dann eine Kategorie, wenn sie den Bereich verlassen und dort als Ausgabe zählen.
      categoryId:
        draft.categoryId === '' || (isTransfer && !crossesAreas(accounts, draft.accountId, draft.transferAccountId))
          ? null
          : draft.categoryId
    }
  }
}

/** Ob eine Umbuchung zwischen zwei Bereichen läuft, etwa vom privaten Giro aufs Haushaltskonto. */
export function crossesAreas(accounts: Account[], fromId: string, toId: string | null): boolean {
  const from = accounts.find((a) => a.id === fromId)
  const to = accounts.find((a) => a.id === toId)
  return from !== undefined && to !== undefined && from.areaId !== to.areaId
}
