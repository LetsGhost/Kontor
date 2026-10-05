import { describe, expect, it } from 'vitest'
import {
  buildCandidates,
  decodeCsv,
  finishImport,
  guessMapping,
  parseCsv,
  parseCsvDate,
  parseSignedAmount,
  toTable,
  type ImportOptions
} from './csv'
import { defaultCategories } from './defaultCategories'
import type { Account, Recurring, Transaction } from './schemas'
import { transactionSchema } from './schemas'

// Aufbau wie ein typischer Giro-Export: Vorspann, dann die Tabelle mit Semikolon und Anführungszeichen.
const EXPORT = [
  '"Kontonummer:";"DE00 1234 5678"',
  '"Zeitraum:";"01.06.2026 - 30.06.2026"',
  '',
  '"Buchungstag";"Wertstellung";"Buchungstext";"Auftraggeber / Begünstigter";"Verwendungszweck";"Betrag (EUR)"',
  '"01.06.2026";"01.06.2026";"Gutschrift";"Arbeitgeber GmbH";"Gehalt Juni";"2.650,00"',
  '"03.06.2026";"03.06.2026";"Lastschrift";"REWE Markt 4711";"Kartenzahlung; Danke ""Kunde""";"-45,67"',
  '"05.06.2026";"05.06.2026";"Lastschrift";"Baeckerei";"Kaffee";"-3,20"',
  '"05.06.2026";"05.06.2026";"Lastschrift";"Baeckerei";"Kaffee";"-3,20"',
  '"kaputt";"";"";"Niemand";"";"-1,00"'
].join('\r\n')

const account: Account = {
  id: 'giro',
  areaId: 'privat',
  name: 'Girokonto',
  type: 'giro',
  openingBalanceCents: 0,
  openingDate: '2026-01-01',
  archived: false
}

const options = (transactions: Transaction[] = [], over: Partial<ImportOptions> = {}): ImportOptions => ({
  account,
  invert: false,
  transactions,
  categories: defaultCategories(),
  today: '2026-07-01',
  ...over
})

const table = toTable(parseCsv(EXPORT))!
const mapping = guessMapping(table.headers)
let n = 0
const makeId = (): string => `neu-${n++}`

describe('CSV lesen', () => {
  it('überspringt den Vorspann und versteht Anführungszeichen, Trennzeichen in Zellen und CRLF', () => {
    expect(table.headers).toHaveLength(6)
    expect(table.rows).toHaveLength(5)
    expect(table.rows[1][4]).toBe('Kartenzahlung; Danke "Kunde"')
  })

  it('liest auch kommagetrennte Dateien', () => {
    const cells = parseCsv('date,amount,name\n2026-06-01,-12.50,"Shop, Inc."\n2026-06-02,3.00,Other')
    expect(cells[1]).toEqual(['2026-06-01', '-12.50', 'Shop, Inc.'])
  })

  it('erkennt Windows-1252 und UTF-8 mit BOM', () => {
    expect(decodeCsv(new Uint8Array([0x42, 0xe4, 0x63, 0x6b, 0x65, 0x72]))).toBe('Bäcker')
    expect(decodeCsv(new Uint8Array([0xef, 0xbb, 0xbf, 0x42, 0xc3, 0xa4]))).toBe('Bä')
  })

  it('ordnet die üblichen Spaltennamen zu', () => {
    expect(mapping).toEqual({ date: 0, amount: 5, payee: 3, payer: -1, note: 4 })
    expect(
      guessMapping(['Buchungsdatum', 'Status', 'Zahlungspflichtige*r', 'Zahlungsempfänger*in', 'Verwendungszweck', 'Betrag (€)'])
    ).toEqual({ date: 0, amount: 5, payee: 3, payer: 2, note: 4 })
  })

  it('liest Datums- und Betragsschreibweisen der Banken', () => {
    expect(parseCsvDate('3.6.26')).toBe('2026-06-03')
    expect(parseCsvDate('2026-06-03T00:00')).toBe('2026-06-03')
    expect(parseCsvDate('31.02.2026')).toBeNull()
    expect(parseSignedAmount('1.234,56-')).toBe(-123456)
    expect(parseSignedAmount('+12,00 EUR')).toBe(1200)
    expect(parseSignedAmount('-12.50')).toBe(-1250)
  })
})

describe('buildCandidates', () => {
  it('macht aus Zeilen Einnahmen und Ausgaben und meldet unlesbare Zeilen', () => {
    const candidates = buildCandidates(table, mapping, options())
    expect(candidates.map((c) => [c.status, c.type, c.amountCents])).toEqual([
      ['new', 'income', 265000],
      ['new', 'expense', 4567],
      ['new', 'expense', 320],
      ['new', 'expense', 320],
      ['invalid', 'expense', 0]
    ])
    expect(candidates[4].reason).toBe('Datum nicht lesbar')
  })

  it('gibt zwei gleichen Zeilen einer Datei verschiedene Kennungen', () => {
    const candidates = buildCandidates(table, mapping, options())
    expect(candidates[2].importHash).not.toBe(candidates[3].importHash)
  })

  it('erkennt beim zweiten Import derselben Datei alles als schon importiert', () => {
    const first = buildCandidates(table, mapping, options()).filter((c) => c.status === 'new')
    const { transactions } = finishImport(first, 'giro', [], makeId, '')
    expect(transactions.every((t) => transactionSchema.safeParse(t).success)).toBe(true)

    const second = buildCandidates(table, mapping, options(transactions))
    expect(second.map((c) => c.status)).toEqual(['imported', 'imported', 'imported', 'imported', 'invalid'])
  })

  it('markiert von Hand erfasste Buchungen mit gleichem Tag und Betrag als mögliche Dublette', () => {
    const manual: Transaction = {
      id: 'hand',
      date: '2026-06-03',
      accountId: 'giro',
      type: 'expense',
      amountCents: 4567,
      payee: 'Rewe',
      note: '',
      categoryId: 'cat-lebensmittel-supermarkt',
      transferAccountId: null,
      recurringId: null,
      importHash: null,
      splits: [],
      attachments: [],
      createdAt: ''
    }
    const candidates = buildCandidates(table, mapping, options([manual]))
    expect(candidates[1].status).toBe('similar')
    expect(candidates[0].status).toBe('new')
  })

  it('schlägt Kategorien aus früheren Buchungen vor', () => {
    const earlier: Transaction = {
      id: 'alt',
      date: '2026-05-03',
      accountId: 'giro',
      type: 'expense',
      amountCents: 3000,
      payee: 'Rewe',
      note: '',
      categoryId: 'cat-lebensmittel-supermarkt',
      transferAccountId: null,
      recurringId: null,
      importHash: null,
      splits: [],
      attachments: [],
      createdAt: ''
    }
    expect(buildCandidates(table, mapping, options([earlier]))[1].categoryId).toBe('cat-lebensmittel-supermarkt')
  })

  it('kann das Vorzeichen umkehren und lehnt Zeilen vor dem Startdatum ab', () => {
    expect(buildCandidates(table, mapping, options([], { invert: true }))[0].type).toBe('expense')
    const late = { ...account, openingDate: '2026-06-04' }
    const candidates = buildCandidates(table, mapping, options([], { account: late }))
    expect(candidates.map((c) => c.status)).toEqual(['invalid', 'invalid', 'new', 'new', 'invalid'])
  })
})

describe('finishImport', () => {
  const rule: Recurring = {
    id: 'gehalt',
    accountId: 'giro',
    type: 'income',
    amountCents: 265000,
    payee: 'Arbeitgeber',
    note: '',
    categoryId: 'cat-gehalt',
    transferAccountId: null,
    interval: 'monthly',
    startDate: '2026-05-30',
    endDate: null,
    nextDueDate: '2026-05-30',
    active: true,
    contract: null
  }

  it('verknüpft passende Buchungen mit der Regel und rückt deren Termin weiter', () => {
    const candidates = buildCandidates(table, mapping, options()).filter((c) => c.status === 'new')
    const result = finishImport(candidates, 'giro', [rule], makeId, '')

    expect(result.linked).toBe(1)
    expect(result.transactions.find((t) => t.type === 'income')!.recurringId).toBe('gehalt')
    expect(result.recurring[0].nextDueDate).toBe('2026-06-30')
    expect(result.transactions.filter((t) => t.recurringId === null)).toHaveLength(3)
  })

  it('verknüpft nichts, wenn der Termin der Regel weit entfernt liegt', () => {
    const candidates = buildCandidates(table, mapping, options()).filter((c) => c.status === 'new')
    const far = { ...rule, startDate: '2026-08-01', nextDueDate: '2026-08-01' }
    expect(finishImport(candidates, 'giro', [far], makeId, '').linked).toBe(0)
  })
})
