import { describe, expect, it } from 'vitest'
import {
  advance,
  bookOccurrence,
  detectPatterns,
  dueDates,
  monthlyCents,
  occurrence,
  occurrenceAfter,
  patternKey
} from './recurring'
import { transactionSchema, type Recurring, type Transaction } from './schemas'

const rule = (over: Partial<Recurring> = {}): Recurring => ({
  id: 'miete',
  accountId: 'giro',
  type: 'expense',
  amountCents: 82000,
  payee: 'Vermieter Müller',
  note: '',
  categoryId: 'cat-wohnen-miete',
  transferAccountId: null,
  interval: 'monthly',
  startDate: '2026-01-01',
  endDate: null,
  nextDueDate: '2026-01-01',
  active: true,
  ...over
})

let nextId = 0
const tx = (date: string, over: Partial<Transaction> = {}): Transaction => ({
  id: `t${nextId++}`,
  date,
  accountId: 'giro',
  type: 'expense',
  amountCents: 1399,
  payee: 'Netflix',
  note: '',
  categoryId: 'cat-freizeit-abos-streaming',
  transferAccountId: null,
  recurringId: null,
  importHash: null,
  createdAt: '',
  ...over
})

describe('Termine', () => {
  it('kürzt den 31. auf das Monatsende und kehrt danach zum 31. zurück', () => {
    const dates = [0, 1, 2, 3].map((k) => occurrence('2026-01-31', 'monthly', k))
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  })

  it('rechnet wöchentlich, vierteljährlich und jährlich', () => {
    expect(occurrence('2026-12-28', 'weekly', 1)).toBe('2027-01-04')
    expect(occurrence('2026-11-15', 'quarterly', 1)).toBe('2027-02-15')
    expect(occurrence('2024-02-29', 'yearly', 1)).toBe('2025-02-28')
  })

  it('findet den nächsten Termin nach einem Datum', () => {
    expect(occurrenceAfter(rule(), '2026-01-01')).toBe('2026-02-01')
    expect(occurrenceAfter(rule(), '2026-03-15')).toBe('2026-04-01')
  })
})

describe('Fälligkeiten', () => {
  it('listet verpasste Termine einzeln auf', () => {
    expect(dueDates(rule({ nextDueDate: '2026-02-01' }), '2026-04-10')).toEqual([
      '2026-02-01',
      '2026-03-01',
      '2026-04-01'
    ])
  })

  it('liefert nichts vor dem nächsten Termin, für pausierte Regeln und nach dem Enddatum', () => {
    expect(dueDates(rule({ nextDueDate: '2026-05-01' }), '2026-04-30')).toEqual([])
    expect(dueDates(rule({ active: false }), '2026-04-10')).toEqual([])
    expect(dueDates(rule({ endDate: '2026-02-15' }), '2026-04-10')).toEqual(['2026-01-01', '2026-02-01'])
  })

  it('rückt nach einer Buchung weiter und beendet die Regel am Enddatum', () => {
    expect(advance(rule(), '2026-01-01')).toMatchObject({ nextDueDate: '2026-02-01', active: true })
    expect(advance(rule({ endDate: '2026-01-15' }), '2026-01-01').active).toBe(false)
  })

  it('erzeugt eine gültige Buchung mit abweichendem Betrag und Verweis auf die Regel', () => {
    const booked = bookOccurrence(rule(), '2026-02-01', 83500, 'neu', '2026-02-01T08:00:00.000Z')
    expect(transactionSchema.safeParse(booked).success).toBe(true)
    expect(booked).toMatchObject({ date: '2026-02-01', amountCents: 83500, recurringId: 'miete' })
  })

  it('rechnet Beträge auf den Monat um', () => {
    expect(monthlyCents({ amountCents: 12000, interval: 'yearly' })).toBe(1000)
    expect(monthlyCents({ amountCents: 9000, interval: 'quarterly' })).toBe(3000)
    expect(monthlyCents({ amountCents: 1200, interval: 'weekly' })).toBe(5200)
  })
})

describe('detectPatterns', () => {
  const netflix = [tx('2026-03-05'), tx('2026-04-07'), tx('2026-05-05')]
  const detect = (list: Transaction[], rules: Recurring[] = [], dismissed: string[] = []) =>
    detectPatterns(list, rules, dismissed, '2026-05-20')

  it('erkennt monatliche Abbuchungen trotz leicht verschobener Tage', () => {
    const [pattern] = detect(netflix)
    expect(pattern).toMatchObject({
      payee: 'Netflix',
      interval: 'monthly',
      amountCents: 1399,
      nextDueDate: '2026-06-05',
      categoryId: 'cat-freizeit-abos-streaming'
    })
    expect(pattern.transactionIds).toHaveLength(3)
  })

  it('braucht mindestens drei Buchungen', () => {
    expect(detect(netflix.slice(1))).toEqual([])
  })

  it('ignoriert unregelmäßige Abstände und stark schwankende Beträge', () => {
    expect(detect([tx('2026-03-05'), tx('2026-03-20'), tx('2026-05-05')])).toEqual([])
    expect(detect([tx('2026-03-05'), tx('2026-04-05', { amountCents: 4000 }), tx('2026-05-05')])).toEqual([])
  })

  it('akzeptiert Beträge, die bis zu zehn Prozent schwanken', () => {
    const strom = [7000, 7400, 6800].map((amountCents, i) =>
      tx(`2026-0${i + 3}-03`, { payee: 'Stadtwerke', amountCents })
    )
    expect(detect(strom)).toHaveLength(1)
  })

  it('ignoriert Muster, die schon lange nicht mehr aufgetreten sind', () => {
    expect(detect([tx('2025-10-05'), tx('2025-11-05'), tx('2025-12-05')])).toEqual([])
  })

  it('überspringt vorhandene Regeln, abgelehnte Muster und bereits zugeordnete Buchungen', () => {
    expect(detect(netflix, [rule({ payee: 'NETFLIX' })])).toEqual([])
    expect(detect(netflix, [], [patternKey('expense', 'Netflix')])).toEqual([])
    expect(detect(netflix.map((t) => ({ ...t, recurringId: 'abo' })))).toEqual([])
  })
})
