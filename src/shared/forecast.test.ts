import { describe, expect, it } from 'vitest'
import { defaultCategories } from './defaultCategories'
import { forecast } from './forecast'
import type { Account, Recurring, Transaction } from './schemas'

const TODAY = '2026-06-10'

const ALL = new Set(['giro', 'spar'])

const account = (id: string, openingBalanceCents: number, over: Partial<Account> = {}): Account => ({
  id,
  areaId: 'privat',
  name: id,
  type: 'giro',
  openingBalanceCents,
  openingDate: '2026-01-01',
  archived: false,
  ...over
})

let nextId = 0
const tx = (date: string, amountCents: number, over: Partial<Transaction> = {}): Transaction => ({
  id: `t${nextId++}`,
  date,
  accountId: 'giro',
  type: 'expense',
  amountCents,
  payee: 'Laden',
  note: '',
  categoryId: 'cat-lebensmittel-supermarkt',
  transferAccountId: null,
  recurringId: null,
  importHash: null,
  createdAt: '',
  ...over
})

const rule = (over: Partial<Recurring>): Recurring => ({
  id: 'r',
  accountId: 'giro',
  type: 'expense',
  amountCents: 80000,
  payee: 'Vermieter',
  note: '',
  categoryId: 'cat-wohnen-miete',
  transferAccountId: null,
  interval: 'monthly',
  startDate: '2026-07-01',
  endDate: null,
  nextDueDate: '2026-07-01',
  active: true,
  ...over
})

const data = (over: { accounts?: Account[]; transactions?: Transaction[]; recurring?: Recurring[] } = {}) => ({
  accounts: [account('giro', 100000)],
  transactions: [],
  recurring: [],
  categories: defaultCategories(),
  ...over
})

describe('forecast', () => {
  it('bleibt ohne Regeln und Historie beim heutigen Kontostand', () => {
    const result = forecast(data(), TODAY, 3, ALL)
    expect(result.startCents).toBe(100000)
    expect(result.points.map((p) => p.month)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09'])
    expect(result.points.every((p) => p.balanceCents === 100000)).toBe(true)
    expect(result.firstNegativeMonth).toBeNull()
  })

  it('bucht wiederkehrende Posten an ihren Terminen und beachtet das Enddatum', () => {
    const recurring = [
      rule({}),
      rule({ id: 'gehalt', type: 'income', amountCents: 200000, payee: 'Arbeitgeber', endDate: '2026-08-15' })
    ]
    const result = forecast(data({ recurring }), TODAY, 3, ALL)
    expect(result.points.map((p) => p.fixedCents)).toEqual([0, 120000, 120000, -80000])
    expect(result.points.at(-1)!.balanceCents).toBe(100000 + 120000 + 120000 - 80000)
    expect(result.upcoming[0]).toEqual({ date: '2026-07-01', title: 'Vermieter', cents: -80000 })
  })

  it('rechnet überfällige, unbestätigte Termine dem laufenden Monat zu', () => {
    const result = forecast(data({ recurring: [rule({ startDate: '2026-06-01', nextDueDate: '2026-06-01' })] }), TODAY, 1, ALL)
    expect(result.points.map((p) => p.fixedCents)).toEqual([-80000, -80000])
    expect(result.upcoming.map((u) => u.date)).toEqual(['2026-07-01'])
  })

  it('schätzt variable Posten aus dem Durchschnitt der letzten drei Monate, anteilig im laufenden Monat', () => {
    const transactions = [
      tx('2026-03-10', 30000),
      tx('2026-04-10', 30000),
      tx('2026-05-10', 30000),
      tx('2026-05-12', 60000, { type: 'income', categoryId: null }),
      // zählt nicht: gehört zu einer Regel, ist eine Umbuchung oder liegt außerhalb der Basis
      tx('2026-05-01', 80000, { recurringId: 'r' }),
      tx('2026-05-02', 50000, { type: 'transfer', transferAccountId: 'spar', categoryId: null }),
      tx('2026-02-10', 99900),
      tx('2026-06-05', 77700)
    ]
    const result = forecast(data({ transactions }), TODAY, 2, ALL)

    expect(result.basisMonths).toBe(3)
    expect(result.variableExpenseCents).toBe(30000)
    expect(result.variableIncomeCents).toBe(20000)
    expect(result.variableByCategory).toEqual([
      { categoryId: 'cat-lebensmittel', name: 'Lebensmittel', icon: 'cart', cents: 30000 }
    ])
    // Netto -100 € pro Monat. Im Juni sind die Ausgaben mit 777 € schon über dem Durchschnitt,
    // es stehen also nur noch die erwarteten 200 € Einnahmen aus.
    expect(result.points.map((p) => p.variableCents)).toEqual([20000, -10000, -10000])
  })

  it('erwartet im laufenden Monat nur den Rest, der vom Durchschnitt noch nicht gebucht ist', () => {
    const transactions = [
      tx('2026-05-01', 250000, { type: 'income', categoryId: null }),
      tx('2026-05-10', 90000),
      tx('2026-06-01', 250000, { type: 'income', categoryId: null }),
      tx('2026-06-05', 30000)
    ]
    const accounts = [account('giro', 0, { openingDate: '2026-05-01' })]
    const result = forecast(data({ accounts, transactions }), TODAY, 1, ALL)
    // Gehalt ist für Juni schon da, von 900 € Ausgaben fehlen noch 600 €.
    expect(result.points.map((p) => p.variableCents)).toEqual([-60000, 160000])
  })

  it('zählt geplante variable Buchungen nicht zusätzlich zum Durchschnitt', () => {
    const transactions = [
      tx('2026-03-10', 30000),
      tx('2026-04-10', 30000),
      tx('2026-05-10', 30000),
      // Schon erfasst: später im Juni und im Juli
      tx('2026-06-20', 10000),
      tx('2026-07-15', 50000)
    ]
    const result = forecast(data({ transactions }), TODAY, 2, ALL)
    expect(result.points.map((p) => p.plannedCents)).toEqual([-10000, -50000, 0])
    // Juni: von 300 € sind 100 € geplant, es fehlen 200 €. Juli: 500 € geplant, über dem Durchschnitt.
    // Start: 1.000 € minus 900 € aus März bis Mai.
    expect(result.points.map((p) => p.variableCents)).toEqual([-20000, 0, -30000])
    expect(result.points.map((p) => p.balanceCents)).toEqual([-20000, -70000, -100000])
  })

  it('teilt bei kurzer Historie nur durch die vorhandenen Monate', () => {
    const accounts = [account('giro', 0, { openingDate: '2026-05-01' })]
    const result = forecast(data({ accounts, transactions: [tx('2026-05-10', 30000)] }), TODAY, 1, ALL)
    expect(result.basisMonths).toBe(1)
    expect(result.variableExpenseCents).toBe(30000)
    expect(result.history.map((h) => h.month)).toEqual(['2026-05'])
  })

  it('zählt bereits erfasste Buchungen in der Zukunft mit', () => {
    const result = forecast(data({ transactions: [tx('2026-07-20', 45000)] }), TODAY, 1, ALL)
    expect(result.startCents).toBe(100000)
    expect(result.points.map((p) => p.plannedCents)).toEqual([0, -45000])
  })

  it('lässt Umbuchungen in der Gesamtsicht verschwinden, zeigt sie aber je Konto', () => {
    const accounts = [account('giro', 100000), account('spar', 0)]
    const recurring = [rule({ type: 'transfer', amountCents: 20000, payee: '', categoryId: null, transferAccountId: 'spar' })]
    const input = data({ accounts, recurring })

    expect(forecast(input, TODAY, 1, ALL).points[1].fixedCents).toBe(0)
    expect(forecast(input, TODAY, 1, new Set(['giro'])).points[1].fixedCents).toBe(-20000)
    expect(forecast(input, TODAY, 1, new Set(['spar'])).points[1].balanceCents).toBe(20000)
  })

  it('zählt Umbuchungen in einen anderen Bereich als variable Ausgabe bzw. Einnahme', () => {
    const accounts = [account('giro', 100000), account('haushalt', 0, { areaId: 'haushalt' })]
    const transactions = ['2026-03-01', '2026-04-01', '2026-05-01'].map((date) =>
      tx(date, 40000, { type: 'transfer', transferAccountId: 'haushalt', categoryId: 'cat-wohnen' })
    )
    const input = data({ accounts, transactions })

    const privat = forecast(input, TODAY, 1, new Set(['giro']))
    expect(privat.variableExpenseCents).toBe(40000)
    expect(privat.variableByCategory.map((c) => c.name)).toEqual(['Wohnen'])
    expect(forecast(input, TODAY, 1, new Set(['haushalt'])).variableIncomeCents).toBe(40000)
  })

  it('meldet den ersten Monat im Minus und den Tiefpunkt', () => {
    const result = forecast(data({ recurring: [rule({ amountCents: 60000 })] }), TODAY, 3, ALL)
    expect(result.points.map((p) => p.balanceCents)).toEqual([100000, 40000, -20000, -80000])
    expect(result.firstNegativeMonth).toBe('2026-08')
    expect(result.lowest.month).toBe('2026-09')
  })
})
