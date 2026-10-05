import { describe, expect, it } from 'vitest'
import { defaultCategories } from './defaultCategories'
import { latestReviewMonth, monthReview } from './review'
import type { Transaction } from './schemas'

const categories = defaultCategories()
const SUPERMARKT = 'cat-lebensmittel-supermarkt'
const RESTAURANT = 'cat-lebensmittel-restaurant-lieferdienst'
const MIETE = 'cat-wohnen-miete'
const ids = new Set(['giro'])

let nextId = 0
const tx = (over: Partial<Transaction>): Transaction => ({
  id: `t${nextId++}`,
  date: '2026-06-15',
  accountId: 'giro',
  type: 'expense',
  amountCents: 1000,
  payee: '',
  note: '',
  categoryId: null,
  transferAccountId: null,
  recurringId: null,
  importHash: null,
  createdAt: '',
  ...over
})

describe('latestReviewMonth', () => {
  it('zeigt am Monatsletzten schon den laufenden Monat', () => {
    expect(latestReviewMonth('2026-06-30')).toBe('2026-06')
    expect(latestReviewMonth('2026-02-28')).toBe('2026-02')
  })

  it('zeigt sonst den Vormonat, auch über den Jahreswechsel', () => {
    expect(latestReviewMonth('2026-06-29')).toBe('2026-05')
    expect(latestReviewMonth('2026-01-01')).toBe('2025-12')
  })
})

describe('monthReview', () => {
  const transactions = [
    tx({ type: 'income', amountCents: 300000, recurringId: 'gehalt' }),
    tx({ amountCents: 100000, categoryId: MIETE, recurringId: 'miete' }),
    tx({ amountCents: 40000, categoryId: SUPERMARKT }),
    tx({ amountCents: 15000, categoryId: RESTAURANT }),
    tx({ type: 'income', amountCents: 5000 }),
    // Vormonat
    tx({ date: '2026-05-10', amountCents: 100000, categoryId: MIETE, recurringId: 'miete' }),
    tx({ date: '2026-05-10', amountCents: 20000, categoryId: SUPERMARKT }),
    tx({ date: '2026-05-10', amountCents: 8000 }),
    // Andere Monate und fremde Konten zählen nicht
    tx({ date: '2026-07-01', amountCents: 99999 }),
    tx({ accountId: 'fremd', amountCents: 99999 })
  ]
  const review = monthReview(transactions, categories, [], '2026-06', ids)

  it('trennt feste und variable Posten', () => {
    expect(review.fixed).toEqual({ incomeCents: 300000, expenseCents: 100000 })
    expect(review.variable).toEqual({ incomeCents: 5000, expenseCents: 55000 })
    expect(review.planCents).toBe(200000)
    expect(review.netCents).toBe(150000)
    expect(review.savingsRate).toBeCloseTo(150000 / 305000)
  })

  it('vergleicht Hauptkategorien mit dem Vormonat, größte Veränderung zuerst', () => {
    expect(review.previous).toEqual({ incomeCents: 0, expenseCents: 128000 })
    expect(review.changes.map((c) => [c.categoryId, c.cents, c.previousCents])).toEqual([
      ['cat-lebensmittel', 55000, 20000],
      [null, 0, 8000]
    ])
  })

  it('listet die größten Ausgaben', () => {
    expect(review.topExpenses.map((t) => t.amountCents)).toEqual([100000, 40000, 15000])
  })

  it('zählt Umbuchungen nach außen als Ausgabe', () => {
    const out = tx({ type: 'transfer', amountCents: 2000, transferAccountId: 'spar' })
    expect(monthReview([out], categories, [], '2026-06', ids).variable.expenseCents).toBe(2000)
  })

  it('hat ohne Einnahmen keine Sparquote', () => {
    expect(monthReview([tx({})], categories, [], '2026-06', ids).savingsRate).toBeNull()
  })
})
