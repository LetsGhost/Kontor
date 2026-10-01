import { describe, expect, it } from 'vitest'
import { accountBalance } from './balance'
import { defaultCategories } from './defaultCategories'
import { parseAmount } from './money'
import { collectionSchemas, transactionSchema, type Account, type Transaction } from './schemas'

describe('parseAmount', () => {
  it.each([
    ['12', 1200],
    ['12,5', 1250],
    ['12,50', 1250],
    ['12.50', 1250],
    ['1.234,56', 123456],
    ['1.234', 123400],
    ['1.234.567', 123456700],
    ['0,07', 7],
    ['19,99 €', 1999],
    ['-5,00', -500]
  ])('%s → %i Cent', (input, cents) => {
    expect(parseAmount(input)).toBe(cents)
  })

  it.each(['', 'abc', '12,345', '1,2,3', '12,-5'])('lehnt "%s" ab', (input) => {
    expect(parseAmount(input)).toBeNull()
  })
})

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 't',
  date: '2026-01-15',
  accountId: 'giro',
  type: 'expense',
  amountCents: 1000,
  payee: '',
  note: '',
  categoryId: null,
  transferAccountId: null,
  recurringId: null,
  importHash: null,
  createdAt: '2026-01-15T00:00:00.000Z',
  ...over
})

const account = (id: string, openingBalanceCents: number): Account => ({
  id,
  areaId: 'privat',
  name: id,
  type: 'giro',
  openingBalanceCents,
  openingDate: '2026-01-01',
  archived: false
})

describe('accountBalance', () => {
  const transactions = [
    tx({ type: 'income', amountCents: 200000 }),
    tx({ type: 'expense', amountCents: 4999 }),
    tx({ type: 'transfer', amountCents: 50000, transferAccountId: 'spar' }),
    tx({ type: 'expense', amountCents: 70000, date: '2026-02-01' })
  ]

  it('rechnet Einnahmen, Ausgaben und Umbuchungen auf beiden Konten', () => {
    expect(accountBalance(account('giro', 10000), transactions, '2026-01-31')).toBe(155001)
    expect(accountBalance(account('spar', 0), transactions, '2026-01-31')).toBe(50000)
  })

  it('zählt Buchungen in der Zukunft noch nicht mit', () => {
    expect(accountBalance(account('giro', 10000), transactions, '2026-02-01')).toBe(85001)
  })
})

describe('Schemas', () => {
  it('akzeptiert den Standardsatz an Kategorien mit eindeutigen IDs', () => {
    const categories = collectionSchemas.categories.parse(defaultCategories())
    expect(new Set(categories.map((c) => c.id)).size).toBe(categories.length)
  })

  it('lehnt Kommabeträge und inkonsistente Umbuchungen ab', () => {
    expect(transactionSchema.safeParse(tx({ amountCents: 12.5 })).success).toBe(false)
    expect(transactionSchema.safeParse(tx({ type: 'transfer' })).success).toBe(false)
    expect(transactionSchema.safeParse(tx({ type: 'transfer', transferAccountId: 'giro' })).success).toBe(false)
    expect(transactionSchema.safeParse(tx({ transferAccountId: 'spar' })).success).toBe(false)
  })
})
