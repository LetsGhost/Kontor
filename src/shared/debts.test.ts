import { describe, expect, it } from 'vitest'
import { debtTotals, debtsByPerson, overdueDebts, suggestPerson } from './debts'
import { reminders } from './reminders'
import type { Debt, KontorData, Person, Transaction } from './schemas'
import { viewOf } from './scope'
import { monthTotals } from './stats'

const max: Person = { id: 'max', name: 'Max', aliases: ['Max Mustermann'], dueDate: null, archived: false }

const tx = (id: string, date: string, type: 'expense' | 'income', amountCents: number, extra: Partial<Transaction> = {}): Transaction => ({
  id,
  date,
  accountId: 'giro',
  type,
  amountCents,
  payee: 'Max Mustermann',
  note: '',
  categoryId: null,
  transferAccountId: null,
  recurringId: null,
  importHash: null,
  personId: 'max',
  createdAt: '',
  splits: [],
  attachments: [],
  ...extra
})

const entry = (id: string, date: string, direction: Debt['direction'], amountCents: number): Debt => ({
  id,
  personId: 'max',
  date,
  direction,
  amountCents,
  note: ''
})

describe('debtsByPerson', () => {
  it('begleicht die ältesten offenen Schulden zuerst', () => {
    const [row] = debtsByPerson(
      [max],
      [entry('bar', '2026-01-01', 'owedToMe', 2000)],
      [tx('geliehen', '2026-02-01', 'expense', 3000), tx('zurück', '2026-03-01', 'income', 2500)]
    )
    expect(row.balanceCents).toBe(2500)
    const open = Object.fromEntries(row.events.map((e) => [e.id, e.openCents]))
    expect(open).toEqual({ bar: 0, geliehen: 2500, zurück: 0 })
  })

  it('kehrt den Saldo bei Überzahlung um', () => {
    const [row] = debtsByPerson([max], [], [tx('a', '2026-01-01', 'expense', 2000), tx('b', '2026-01-05', 'income', 3500)])
    expect(row.balanceCents).toBe(-1500)
    expect(row.events.find((e) => e.id === 'b')?.openCents).toBe(-1500)
    expect(debtTotals([row])).toEqual({ owedToMeCents: 0, iOweCents: 1500 })
  })

  it('ignoriert Buchungen anderer Personen und ohne Person', () => {
    const [row] = debtsByPerson([max], [], [tx('x', '2026-01-01', 'expense', 999, { personId: null })])
    expect(row.balanceCents).toBe(0)
  })
})

describe('Schuld-Buchungen in der Auswertung', () => {
  it('zählen weder als Ausgabe noch als Einnahme', () => {
    const ids = new Set(['giro'])
    expect(viewOf(tx('a', '2026-01-01', 'expense', 2000), ids)).toBe('debt')
    expect(monthTotals([tx('a', '2026-01-01', 'expense', 2000)], '2026-01', ids)).toEqual({
      incomeCents: 0,
      expenseCents: 0
    })
  })
})

describe('suggestPerson', () => {
  const rows = debtsByPerson([max], [entry('e', '2026-01-01', 'owedToMe', 2000)], [])

  it('schlägt eine Rückzahlung nur in passender Richtung vor', () => {
    expect(suggestPerson('MAX MUSTERMANN', 'income', rows)).toBe('max')
    expect(suggestPerson('Max Mustermann', 'expense', rows)).toBeNull()
  })

  it('braucht ganze Wörter und eine offene Schuld', () => {
    expect(suggestPerson('Maximilian GmbH', 'income', rows)).toBeNull()
    expect(suggestPerson('Max', 'income', debtsByPerson([max], [], []))).toBeNull()
  })
})

describe('Erinnerung', () => {
  it('meldet fällige offene Schulden', () => {
    const due = { ...max, dueDate: '2026-02-01' }
    const data: KontorData = {
      areas: [],
      accounts: [],
      categories: [],
      recurring: [],
      budgets: [],
      dismissedPatterns: [],
      persons: [due],
      debts: [entry('e', '2026-01-01', 'iOwe', 1000)],
      transactions: []
    }
    expect(overdueDebts(debtsByPerson([due], data.debts, []), '2026-01-31')).toHaveLength(0)
    const [reminder] = reminders(data, '2026-02-01')
    expect(reminder.kind).toBe('debt')
    expect(reminder.body).toMatch(/^Du schuldest Max 10,00\s€$/)
  })
})
