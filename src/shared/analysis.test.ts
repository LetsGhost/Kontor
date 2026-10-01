import { describe, expect, it } from 'vitest'
import { categoryNameTaken, categoryUsage, removeCategory } from './categories'
import { defaultCategories } from './defaultCategories'
import type { Account, Transaction } from './schemas'
import { viewOf } from './scope'
import { addMonths, budgetStatus, lastDayOfMonth, monthTotals, monthlySeries, spendingByCategory } from './stats'
import { normalizePayee, payeeCompletions, similarity, suggestCategory } from './suggest'

const categories = defaultCategories()
const SUPERMARKT = 'cat-lebensmittel-supermarkt'
const RESTAURANT = 'cat-lebensmittel-restaurant-lieferdienst'
const MIETE = 'cat-wohnen-miete'

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

describe('Empfänger vergleichen', () => {
  it('ignoriert Großschreibung, Ziffern, Umlaute und Sonderzeichen', () => {
    expect(normalizePayee('REWE Markt 4711 / Köln')).toBe('rewe markt koln')
    expect(normalizePayee('Straßen-Café')).toBe('strassen cafe')
  })

  it('bewertet gleiche, enthaltene und ähnliche Namen höher als fremde', () => {
    expect(similarity('rewe', 'rewe')).toBe(1)
    expect(similarity('rewe', 'rewe markt koln')).toBe(0.85)
    expect(similarity('netflix', 'netflx')).toBeGreaterThan(0.6)
    expect(similarity('rewe', 'aldi')).toBeLessThan(0.3)
  })
})

describe('suggestCategory', () => {
  const history = [
    tx({ payee: 'REWE Markt 4711', categoryId: SUPERMARKT }),
    tx({ payee: 'Rewe City', categoryId: SUPERMARKT }),
    tx({ payee: 'Vermieter Müller', categoryId: MIETE })
  ]
  const suggest = (payee: string, list = history, type: Transaction['type'] = 'expense') =>
    suggestCategory(payee, type, list, categories, '2026-07-01')

  it('schlägt die Kategorie ähnlicher früherer Buchungen vor', () => {
    expect(suggest('rewe')).toBe(SUPERMARKT)
    expect(suggest('Vermieter Mueller')).toBe(MIETE)
  })

  it('schlägt nichts vor, wenn nichts Ähnliches bekannt ist oder die Eingabe zu kurz ist', () => {
    expect(suggest('Zahnarzt')).toBeNull()
    expect(suggest('r')).toBeNull()
  })

  it('gewichtet neuere Buchungen stärker als viele alte', () => {
    const list = [
      tx({ payee: 'Luigi', categoryId: SUPERMARKT, date: '2022-01-01' }),
      tx({ payee: 'Luigi', categoryId: SUPERMARKT, date: '2022-02-01' }),
      tx({ payee: 'Luigi', categoryId: RESTAURANT, date: '2026-06-01' })
    ]
    expect(suggest('Luigi', list)).toBe(RESTAURANT)
  })

  it('trennt Einnahmen von Ausgaben und ignoriert gelöschte Kategorien', () => {
    expect(suggest('rewe', history, 'income')).toBeNull()
    expect(suggest('rewe', [tx({ payee: 'REWE', categoryId: 'gibt-es-nicht' })])).toBeNull()
  })
})

describe('payeeCompletions', () => {
  const history = [
    tx({ payee: 'Rewe', amountCents: 2000, date: '2026-01-01' }),
    tx({ payee: 'REWE', amountCents: 3500, date: '2026-05-01' }),
    tx({ payee: 'Restaurant Luigi', amountCents: 4000 }),
    tx({ payee: 'Getränke Rehm', amountCents: 1500 }),
    tx({ payee: 'Arbeitgeber', type: 'income' })
  ]

  it('fasst Schreibweisen zusammen und liefert die neueste mit dem letzten Betrag', () => {
    expect(payeeCompletions('rew', 'expense', history)).toEqual([{ payee: 'REWE', amountCents: 3500 }])
  })

  it('sortiert Treffer am Anfang vor Treffer mitten im Namen, häufige zuerst', () => {
    expect(payeeCompletions('re', 'expense', history).map((c) => c.payee)).toEqual([
      'REWE',
      'Restaurant Luigi',
      'Getränke Rehm'
    ])
  })

  it('liefert nichts für leere Eingaben und trennt nach Buchungsart', () => {
    expect(payeeCompletions('', 'expense', history)).toEqual([])
    expect(payeeCompletions('arb', 'expense', history)).toEqual([])
  })
})

describe('removeCategory', () => {
  const data = {
    categories,
    transactions: [tx({ categoryId: SUPERMARKT }), tx({ categoryId: MIETE })],
    recurring: [],
    budgets: [
      { areaId: 'privat', categoryId: SUPERMARKT, limitCents: 30000 },
      { areaId: 'privat', categoryId: MIETE, limitCents: 80000 }
    ]
  }

  it('verschiebt Buchungen in die Ersatzkategorie und entfernt das Budget', () => {
    expect(categoryUsage(data, SUPERMARKT)).toBe(1)
    const next = removeCategory(data, SUPERMARKT, RESTAURANT)
    expect(next.categories.some((c) => c.id === SUPERMARKT)).toBe(false)
    expect(next.transactions.map((t) => t.categoryId)).toEqual([RESTAURANT, MIETE])
    expect(next.budgets).toEqual([{ areaId: 'privat', categoryId: MIETE, limitCents: 80000 }])
  })

  it('kann Buchungen auch ohne Kategorie zurücklassen', () => {
    expect(removeCategory(data, MIETE, null).transactions[1].categoryId).toBeNull()
  })

  it('weigert sich bei Hauptkategorien mit Unterkategorien', () => {
    expect(() => removeCategory(data, 'cat-wohnen', null)).toThrow(/Unterkategorien/)
  })
})

describe('categoryNameTaken', () => {
  const miete = categories.find((c) => c.id === MIETE)!
  const at = { kind: miete.kind, parentId: miete.parentId }

  it('erkennt denselben Namen an derselben Stelle, unabhängig von Schreibweise und Leerraum', () => {
    expect(categoryNameTaken(categories, { ...at, name: ` ${miete.name.toUpperCase()} ` })).toBe(true)
  })

  it('lässt den Namen an anderer Stelle und für die bearbeitete Kategorie selbst zu', () => {
    expect(categoryNameTaken(categories, { ...at, parentId: null, name: miete.name })).toBe(false)
    expect(categoryNameTaken(categories, { ...at, name: miete.name }, MIETE)).toBe(false)
  })
})

describe('Auswertung', () => {
  const transactions = [
    tx({ type: 'income', amountCents: 250000, date: '2026-06-01' }),
    tx({ amountCents: 80000, categoryId: MIETE, date: '2026-06-01' }),
    tx({ amountCents: 5000, categoryId: SUPERMARKT, date: '2026-06-10' }),
    tx({ amountCents: 3000, categoryId: RESTAURANT, date: '2026-06-20' }),
    tx({ amountCents: 1200, date: '2026-06-21' }),
    tx({ type: 'transfer', amountCents: 50000, transferAccountId: 'spar', date: '2026-06-02' }),
    tx({ amountCents: 9900, categoryId: SUPERMARKT, date: '2026-05-31' })
  ]

  it('rechnet mit Monaten über Jahresgrenzen und Schaltjahre', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2025-11', 3)).toBe('2026-02')
    expect(lastDayOfMonth('2024-02')).toBe('2024-02-29')
    expect(lastDayOfMonth('2026-02')).toBe('2026-02-28')
  })

  const PRIVAT = new Set(['giro', 'spar'])

  it('zählt Umbuchungen innerhalb der Kontengruppe weder als Einnahme noch als Ausgabe', () => {
    expect(monthTotals(transactions, '2026-06', PRIVAT)).toEqual({ incomeCents: 250000, expenseCents: 89200 })
  })

  it('zählt Umbuchungen über die Gruppengrenze als Ausgabe auf der einen und Einnahme auf der anderen Seite', () => {
    const beitrag = tx({
      type: 'transfer',
      amountCents: 40000,
      transferAccountId: 'haushalt',
      categoryId: 'cat-wohnen',
      date: '2026-06-03'
    })
    const all = [...transactions, beitrag]

    expect(viewOf(beitrag, PRIVAT)).toBe('expense')
    expect(monthTotals(all, '2026-06', PRIVAT).expenseCents).toBe(89200 + 40000)
    expect(spendingByCategory(all, categories, '2026-06', PRIVAT)[0]).toMatchObject({ name: 'Wohnen', cents: 120000 })

    const haushalt = new Set(['haushalt'])
    expect(monthTotals(all, '2026-06', haushalt)).toEqual({ incomeCents: 40000, expenseCents: 0 })
    expect(spendingByCategory(all, categories, '2026-06', haushalt)).toEqual([])
  })

  it('fasst Ausgaben je Hauptkategorie zusammen, größte zuerst', () => {
    expect(spendingByCategory(transactions, categories, '2026-06', PRIVAT).map((s) => [s.name, s.cents])).toEqual([
      ['Wohnen', 80000],
      ['Lebensmittel', 8000],
      ['Ohne Kategorie', 1200]
    ])
  })

  it('rechnet Unterkategorien in das Budget der Hauptkategorie ein', () => {
    const budgets = [
      { areaId: 'privat', categoryId: 'cat-lebensmittel', limitCents: 30000 },
      { areaId: 'privat', categoryId: RESTAURANT, limitCents: 2000 }
    ]
    expect(budgetStatus(budgets, categories, transactions, '2026-06', PRIVAT).map((b) => b.spentCents)).toEqual([
      8000, 3000
    ])
  })

  it('liefert den Verlauf mit Kontostand am Monatsende', () => {
    const account = (id: string, openingBalanceCents: number, openingDate: string): Account => ({
      id,
      areaId: 'privat',
      name: id,
      type: 'giro',
      openingBalanceCents,
      openingDate,
      archived: false
    })
    const accounts = [account('giro', 100000, '2026-05-01'), account('spar', 0, '2026-06-01')]
    const series = monthlySeries(accounts, transactions, '2026-06', 3, '2026-06-25')

    expect(series.map((p) => p.month)).toEqual(['2026-04', '2026-05', '2026-06'])
    // April: noch kein Konto geführt. Mai: 1.000 € Start minus 99 € Einkauf.
    expect(series.map((p) => p.balanceCents)).toEqual([0, 90100, 250900])
    expect(series[2].expenseCents).toBe(89200)
  })
})
