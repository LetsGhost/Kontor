import { describe, expect, it } from 'vitest'
import { balancesOn, accountBalance } from './balance'
import { categoryParts, removeCategory } from './categories'
import {
  cancelDeadline,
  contractStatus,
  explainContract,
  noticeLongerThanAMonth,
  subscriptions,
  upcomingDeadlines,
  yearlyCents
} from './contracts'
import { defaultCategories } from './defaultCategories'
import { exportRows, toCsv, toXlsx } from './export'
import { parseAmountQuery } from './query'
import { reminders } from './reminders'
import { yearReview } from './review'
import { transactionSchema, type Account, type Contract, type Recurring, type Transaction } from './schemas'
import { budgetStatus, groupByRootCategory } from './stats'
import { amountCloseness, suggestCategory } from './suggest'
import { crc32 } from './xlsx'

const categories = defaultCategories()
const ALL = new Set(['giro', 'spar'])

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
  splits: [],
  attachments: [],
  ...over
})

const account = (id: string, openingBalanceCents: number, openingDate = '2026-01-01'): Account => ({
  id,
  areaId: 'area-privat',
  name: id,
  type: 'giro',
  openingBalanceCents,
  openingDate,
  archived: false
})

const rule = (over: Partial<Recurring> = {}): Recurring => ({
  id: 'r',
  accountId: 'giro',
  type: 'expense',
  amountCents: 1299,
  payee: 'Streaming',
  note: '',
  categoryId: null,
  transferAccountId: null,
  interval: 'monthly',
  startDate: '2026-01-15',
  endDate: null,
  nextDueDate: '2026-11-15',
  active: true,
  contract: null,
  ...over
})

const supermarket = tx('2026-05-03', 5000, {
  categoryId: null,
  splits: [
    { categoryId: 'cat-lebensmittel-supermarkt', amountCents: 3500, note: '' },
    { categoryId: 'cat-shopping-elektronik', amountCents: 1500, note: 'Kabel' }
  ]
})

describe('Aufteilung', () => {
  it('prüft, dass die Teile den Betrag ergeben und keine Kategorie an der Buchung hängt', () => {
    expect(transactionSchema.safeParse(supermarket).success).toBe(true)
    expect(transactionSchema.safeParse({ ...supermarket, amountCents: 4999 }).success).toBe(false)
    expect(transactionSchema.safeParse({ ...supermarket, categoryId: 'cat-lebensmittel' }).success).toBe(false)
    expect(transactionSchema.safeParse({ ...supermarket, splits: supermarket.splits.slice(0, 1) }).success).toBe(false)
  })

  it('zählt jeden Teil in seiner Kategorie und seinem Budget', () => {
    expect(categoryParts(supermarket).map((p) => p.amountCents)).toEqual([3500, 1500])
    const groups = groupByRootCategory([supermarket], categories)
    expect(groups.map((g) => [g.categoryId, g.cents])).toEqual([
      ['cat-lebensmittel', 3500],
      ['cat-shopping', 1500]
    ])
    const [status] = budgetStatus(
      [{ areaId: 'a', categoryId: 'cat-shopping', limitCents: 1000 }],
      categories,
      [supermarket],
      '2026-05',
      ALL
    )
    expect(status.spentCents).toBe(1500)
  })

  it('hängt Teile beim Löschen einer Kategorie um', () => {
    const next = removeCategory(
      { categories, transactions: [supermarket], recurring: [], budgets: [] },
      'cat-shopping-elektronik',
      null
    )
    expect(next.transactions[0].splits.map((s) => s.categoryId)).toEqual(['cat-lebensmittel-supermarkt', null])
  })
})

describe('Kategorie-Vorschläge mit Betrag', () => {
  const ABO = 'cat-freizeit-abos-streaming'
  const history = [
    tx('2026-05-01', 799, { payee: 'Amazon', categoryId: ABO }),
    tx('2026-05-20', 4500, { payee: 'Amazon', categoryId: 'cat-shopping' }),
    tx('2026-06-01', 799, { payee: 'Amazon', categoryId: ABO }),
    tx('2026-06-03', 5200, { payee: 'Amazon', categoryId: 'cat-shopping' })
  ]
  const suggest = (amount: number | null) => suggestCategory('Amazon', 'expense', history, categories, '2026-06-10', amount)

  it('bevorzugt die Kategorie früherer Buchungen mit ähnlichem Betrag', () => {
    expect(suggest(799)).toBe(ABO)
    expect(suggest(4800)).toBe('cat-shopping')
  })

  it('bewertet gleiche Beträge mit 1 und fällt nie unter die Untergrenze', () => {
    expect(amountCloseness(799, 799)).toBe(1)
    expect(amountCloseness(1, 1_000_000)).toBeGreaterThanOrEqual(0.25)
  })
})

describe('parseAmountQuery', () => {
  it('versteht einzelne Beträge, Vergleiche und Bereiche', () => {
    expect(parseAmountQuery('49,99')).toEqual({ min: 4999, max: 4999, exact: true })
    expect(parseAmountQuery('>100')).toEqual({ min: 10001, max: Number.MAX_SAFE_INTEGER, exact: false })
    expect(parseAmountQuery('>= 100 €')).toEqual({ min: 10000, max: Number.MAX_SAFE_INTEGER, exact: false })
    expect(parseAmountQuery('<20')).toEqual({ min: 0, max: 1999, exact: false })
    expect(parseAmountQuery('20-10')).toEqual({ min: 1000, max: 2000, exact: false })
    expect(parseAmountQuery('1.000,50')).toMatchObject({ min: 100050 })
  })

  it('lässt Text in Ruhe', () => {
    expect(parseAmountQuery('rewe')).toBeNull()
    expect(parseAmountQuery('>abc')).toBeNull()
    expect(parseAmountQuery('')).toBeNull()
  })
})

describe('balancesOn', () => {
  it('liefert dasselbe wie accountBalance je Stichtag, auch unsortiert und vor dem Startdatum', () => {
    const accounts = [account('giro', 10000), account('spar', 5000, '2026-03-01')]
    const transactions = [
      tx('2026-02-10', 2000),
      tx('2026-03-05', 1500, { type: 'transfer', transferAccountId: 'spar', categoryId: null }),
      tx('2026-04-01', 30000, { type: 'income', categoryId: null }),
      tx('2026-04-01', 700, { accountId: 'fremd' })
    ]
    const dates = ['2026-04-30', '2026-01-31', '2026-03-05', '2026-02-28']
    const expected = dates.map((date) =>
      accounts.filter((a) => a.openingDate <= date).reduce((sum, a) => sum + accountBalance(a, transactions, date), 0)
    )
    expect(balancesOn(accounts, transactions, dates)).toEqual(expected)
  })
})

describe('Export', () => {
  const accounts = [account('giro', 0)]

  it('schreibt eine Zeile je Teil mit Vorzeichen und deutschem Format', () => {
    const rows = exportRows(
      [supermarket, tx('2026-05-01', 250000, { type: 'income', categoryId: null, payee: 'Arbeitgeber; GmbH' })],
      accounts,
      categories,
      ALL
    )
    expect(rows.map((r) => [r.date, r.amountCents, r.category])).toEqual([
      ['2026-05-01', 250000, ''],
      ['2026-05-03', -3500, 'Supermarkt'],
      ['2026-05-03', -1500, 'Elektronik']
    ])
    const csv = toCsv(rows)
    expect(csv.startsWith('﻿Datum;Konto;Art;')).toBe(true)
    expect(csv).toContain('01.05.2026;giro;Einnahme;"Arbeitgeber; GmbH";;;2500,00;')
    expect(csv).toContain('03.05.2026;giro;Ausgabe;Laden;Shopping;Elektronik;-15,00;Kabel;-50,00;')
  })

  it('erzeugt ein gültiges ZIP mit den XLSX-Bestandteilen', () => {
    const bytes = toXlsx(exportRows([supermarket], accounts, categories, ALL))
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain('xl/worksheets/sheet1.xml')
    expect(text).toContain('<t xml:space="preserve">Kabel</t>')
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
})

describe('Verträge', () => {
  const contract = (over: Partial<Contract> = {}): Contract => ({
    endDate: '2026-12-31',
    renewalMonths: 12,
    noticeAmount: 3,
    noticeUnit: 'months',
    ...over
  })

  it('rechnet die Kündigungsfrist in Tagen, Wochen und Monaten', () => {
    expect(cancelDeadline(contract(), '2026-12-31')).toBe('2026-09-30')
    expect(cancelDeadline(contract({ noticeAmount: 2, noticeUnit: 'weeks' }), '2026-12-31')).toBe('2026-12-17')
    expect(cancelDeadline(contract({ noticeAmount: 30, noticeUnit: 'days' }), '2026-03-01')).toBe('2026-01-30')
  })

  it('springt zur nächsten Verlängerung, wenn die Frist verpasst ist', () => {
    expect(contractStatus(contract(), '2026-09-01')).toEqual({ termEnd: '2026-12-31', cancelBy: '2026-09-30', renews: true })
    expect(contractStatus(contract(), '2026-10-01')).toMatchObject({ termEnd: '2027-12-31', cancelBy: '2027-09-30' })
    expect(contractStatus(contract({ renewalMonths: 0 }), '2027-01-01')).toEqual({
      termEnd: null,
      cancelBy: null,
      renews: false
    })
  })

  it('erklärt eine verpasste Frist mit dem nächsten möglichen Termin', () => {
    // Laufzeit bis 04.11.2026, 1 Monat Verlängerung, 4 Monate Frist, heute 05.10.2026
    const prime = contract({ endDate: '2026-11-04', renewalMonths: 1, noticeAmount: 4 })
    expect(explainContract(prime, '2026-10-05')).toBe(
      'Die Frist für den 04.11.2026 ist am 04.07.2026 abgelaufen. Nächster möglicher Termin ist der 04.03.2027, ' +
        'die Kündigung muss bis 04.11.2026 da sein (noch 30 Tage). Ohne Kündigung verlängert er sich jeweils um 1 Monat.'
    )
    expect(explainContract(prime, '2026-06-01')).toMatch(/^Um zum 04\.11\.2026 zu kündigen, muss die Kündigung bis 04\.07\.2026 da sein \(noch 33 Tage\)/)
    expect(explainContract(contract({ renewalMonths: 0 }), '2027-01-02')).toBe('Der Vertrag ist am 31.12.2026 ausgelaufen.')
    expect(noticeLongerThanAMonth(prime)).toBe(true)
    expect(noticeLongerThanAMonth(contract({ noticeAmount: 4, noticeUnit: 'weeks' }))).toBe(false)
  })

  it('meldet Fristen der nächsten 30 Tage und rechnet Jahreskosten', () => {
    const rules = [
      rule({ id: 'a', contract: contract() }),
      rule({ id: 'b', contract: contract({ endDate: '2027-06-30' }) }),
      rule({ id: 'c', contract: contract(), active: false })
    ]
    expect(upcomingDeadlines(rules, '2026-09-10').map((d) => [d.rule.id, d.daysLeft])).toEqual([['a', 20]])
    expect(yearlyCents(rule({ interval: 'quarterly', amountCents: 3000 }))).toBe(12000)
    expect(subscriptions(rules, '2026-09-10').map((s) => s.rule.id)).toEqual(['a', 'b'])
  })
})

describe('reminders', () => {
  it('sammelt fällige Posten, überschrittene Budgets und Kündigungsfristen', () => {
    const result = reminders(
      {
        areas: [{ id: 'area-privat', name: 'Privat' }],
        accounts: [account('giro', 0)],
        categories,
        recurring: [
          rule({ nextDueDate: '2026-09-01' }),
          rule({
            id: 'vertrag',
            payee: 'Fitnessstudio',
            nextDueDate: '2026-10-01',
            contract: { endDate: '2026-12-31', renewalMonths: 12, noticeAmount: 3, noticeUnit: 'months' }
          })
        ],
        budgets: [{ areaId: 'area-privat', categoryId: 'cat-lebensmittel', limitCents: 1000 }],
        dismissedPatterns: [],
        transactions: [tx('2026-09-02', 2500)]
      },
      '2026-09-10'
    )
    expect(result.map((r) => r.kind)).toEqual(['due', 'budget', 'contract'])
    // Intl trennt Betrag und Währung mit einem geschützten Leerzeichen.
    expect(result[1].body).toMatch(/^Lebensmittel: 15,00\s€ drüber$/)
    expect(result[2].title).toBe('Kündigungsfrist: Fitnessstudio')
  })
})

describe('yearReview', () => {
  it('fasst Monate, Kategorien im Vorjahresvergleich und die Sparquote zusammen', () => {
    const transactions = [
      tx('2025-03-01', 10000, { categoryId: 'cat-shopping' }),
      tx('2026-01-01', 300000, { type: 'income', categoryId: null }),
      tx('2026-01-05', 100000, { categoryId: 'cat-wohnen-miete', recurringId: 'miete' }),
      tx('2026-02-10', 20000),
      supermarket
    ]
    const review = yearReview(transactions, categories, 2026, ALL)
    expect(review.months).toHaveLength(12)
    expect(review.months[0]).toMatchObject({ incomeCents: 300000, expenseCents: 100000, netCents: 200000 })
    expect(review.months[0].savingsRate).toBeCloseTo(2 / 3)
    expect(review.months[2].savingsRate).toBeNull()
    expect(review.expenseCents).toBe(125000)
    expect(review.fixedExpenseCents).toBe(100000)
    expect(review.previous.expenseCents).toBe(10000)
    expect(review.categories.map((c) => [c.categoryId, c.cents, c.previousCents])).toEqual([
      ['cat-wohnen', 100000, 0],
      ['cat-lebensmittel', 23500, 0],
      ['cat-shopping', 1500, 10000]
    ])
  })

  it('vergleicht ein laufendes Jahr nur mit demselben Zeitraum des Vorjahres', () => {
    const transactions = [
      tx('2025-03-01', 10000),
      tx('2025-11-01', 50000),
      tx('2026-03-01', 20000),
      // geplant, liegt nach dem Stichtag
      tx('2026-11-01', 70000)
    ]
    const review = yearReview(transactions, categories, 2026, ALL, '2026-10-05')
    expect(review.until).toBe('2026-10-05')
    expect(review.expenseCents).toBe(20000)
    expect(review.previous.expenseCents).toBe(10000)
    expect(yearReview(transactions, categories, 2025, ALL, '2026-10-05').until).toBeNull()
  })
})
