import { describe, expect, it } from 'vitest'
import { checkDraft, isRealDate, type TransactionDraft } from './draft'
import type { Account } from './schemas'
import { transactionSchema } from './schemas'

const account = (id: string, openingDate = '2026-01-01', areaId = 'privat'): Account => ({
  id,
  areaId,
  name: id,
  type: 'giro',
  openingBalanceCents: 0,
  openingDate,
  archived: false
})

const accounts = [account('giro'), account('spar', '2026-03-01')]

const draft = (over: Partial<TransactionDraft> = {}): TransactionDraft => ({
  type: 'expense',
  date: '2026-04-10',
  accountId: 'giro',
  transferAccountId: '',
  amount: '19,99',
  payee: ' REWE ',
  note: '',
  categoryId: 'cat-lebensmittel',
  ...over
})

const errorsOf = (d: TransactionDraft) => {
  const result = checkDraft(d, accounts)
  return result.ok ? {} : result.errors
}

describe('checkDraft', () => {
  it('liefert Werte, die zum Buchungs-Schema passen', () => {
    const result = checkDraft(draft(), accounts)
    expect(result).toEqual({
      ok: true,
      values: {
        type: 'expense',
        date: '2026-04-10',
        accountId: 'giro',
        transferAccountId: null,
        amountCents: 1999,
        payee: 'REWE',
        note: '',
        categoryId: 'cat-lebensmittel'
      }
    })
    if (!result.ok) return
    const tx = { id: 'x', recurringId: null, importHash: null, createdAt: '', ...result.values }
    expect(transactionSchema.safeParse(tx).success).toBe(true)
  })

  it('entfernt bei Umbuchungen die Kategorie und setzt das Zielkonto', () => {
    const result = checkDraft(draft({ type: 'transfer', transferAccountId: 'spar' }), accounts)
    expect(result.ok && result.values.categoryId).toBeNull()
    expect(result.ok && result.values.transferAccountId).toBe('spar')
  })

  it('behält die Kategorie bei Umbuchungen in einen anderen Bereich', () => {
    const withHousehold = [...accounts, account('haushalt', '2026-01-01', 'haushalt')]
    const result = checkDraft(draft({ type: 'transfer', transferAccountId: 'haushalt' }), withHousehold)
    expect(result.ok && result.values.categoryId).toBe('cat-lebensmittel')
  })

  it('ignoriert ein übrig gebliebenes Zielkonto bei normalen Buchungen', () => {
    const result = checkDraft(draft({ transferAccountId: 'spar' }), accounts)
    expect(result.ok && result.values.transferAccountId).toBeNull()
  })

  it('meldet fehlende oder ungültige Beträge', () => {
    expect(errorsOf(draft({ amount: '' })).amount).toBeDefined()
    expect(errorsOf(draft({ amount: '0' })).amount).toBeDefined()
    expect(errorsOf(draft({ amount: '-5' })).amount).toBeDefined()
  })

  it('verlangt bei Umbuchungen ein anderes Zielkonto', () => {
    expect(errorsOf(draft({ type: 'transfer' })).transferAccountId).toBeDefined()
    expect(errorsOf(draft({ type: 'transfer', transferAccountId: 'giro' })).transferAccountId).toBeDefined()
  })

  it('lehnt Buchungen vor dem Startdatum eines beteiligten Kontos ab', () => {
    expect(errorsOf(draft({ date: '2025-12-31' })).date).toMatch(/giro/)
    expect(errorsOf(draft({ type: 'transfer', transferAccountId: 'spar', date: '2026-02-01' })).date).toMatch(
      /spar/
    )
  })
})

describe('isRealDate', () => {
  it('erkennt unmögliche Kalendertage', () => {
    expect(isRealDate('2026-02-28')).toBe(true)
    expect(isRealDate('2026-02-30')).toBe(false)
    expect(isRealDate('2026-13-01')).toBe(false)
    expect(isRealDate('26-01-01')).toBe(false)
  })
})
