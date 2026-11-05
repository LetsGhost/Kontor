import { describe, expect, it } from 'vitest'
import {
  buildCandidates,
  decodeCsv,
  finishImport,
  guessMapping,
  markCandidates,
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
    const none = { creditor: -1, mandate: -1 }
    expect(mapping).toEqual({ date: 0, amount: 5, payee: 3, payer: -1, note: 4, bookingText: 2, ...none })
    expect(
      guessMapping(['Buchungsdatum', 'Status', 'Zahlungspflichtige*r', 'Zahlungsempfänger*in', 'Verwendungszweck', 'Betrag (€)'])
    ).toEqual({ date: 0, amount: 5, payee: 3, payer: 2, note: 4, bookingText: -1, ...none })
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

  it('erkennt von Hand erfasste Umbuchungen in beide Richtungen als mögliche Dublette', () => {
    const transfer = (over: Partial<Transaction>): Transaction => ({
      id: 'u',
      date: '2026-06-03',
      accountId: 'giro',
      type: 'transfer',
      amountCents: 4567,
      payee: '',
      note: '',
      categoryId: null,
      transferAccountId: 'spar',
      recurringId: null,
      importHash: null,
      splits: [],
      attachments: [],
      createdAt: '',
      ...over
    })
    const out = buildCandidates(table, mapping, options([transfer({})]))
    expect(out[1]).toMatchObject({ status: 'similar', reason: 'Gleicher Betrag wie „Umbuchung“ vom 03.06.2026' })
    // Umbuchung vom Sparkonto aufs Giro: Die Gehaltszeile (Einnahme) passt, die Ausgaben nicht.
    const inbound = transfer({ id: 'v', date: '2026-06-01', accountId: 'spar', transferAccountId: 'giro', amountCents: 265000 })
    expect(buildCandidates(table, mapping, options([inbound])).map((c) => c.status)).toEqual([
      'similar',
      'new',
      'new',
      'new',
      'invalid'
    ])
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

// Aufbau wie Sparkasse CSV-CAMT: vorgemerkte und gebuchte Umsätze, PayPal, Lastschrift mit Mandat.
const SPARKASSE = [
  'Buchungstag;Valutadatum;Buchungstext;Verwendungszweck;Glaeubiger ID;Mandatsreferenz;Beguenstigter/Zahlungspflichtiger;Betrag;Info',
  '01.11.26;02.11.26;FOLGELASTSCHRIFT;1054142308798/. Bolt Operations OU, Ihr Einkauf bei Bolt Operations OU ;LU96ZZZ0000000000000000058;5APJ2257RNBGU;PayPal Europe S.a.r.l. et Cie S.C.A;-3,43;Umsatz vorgemerkt',
  '01.11.26;02.11.26;FOLGELASTSCHRIFT;1054154744437/PP.2546.PP/. , Ihr Einkauf bei ;LU96ZZZ0000000000000000058;5APJ2257RNBGU;PayPal Europe S.a.r.l. et Cie S.C.A;-25,00;Umsatz vorgemerkt',
  '01.11.26;02.11.26;FOLGELASTSCHRIFT;Abo 076110605 zum 01.11.2026 ;DE39DBV00000002177;100028337188;DB Vertrieb GmbH;-63,00;Umsatz vorgemerkt',
  '01.11.26;01.11.26;GUTSCHR. UEBERW. DAUERAUFTR;Taschengeld ;;;John Dova;75,00;Umsatz gebucht',
  '01.11.26;31.10.26;ABSCHLUSS;Entgeltabrechnung siehe Anlage ;;;;0,00;Umsatz gebucht'
].join('\n')
const spk = toTable(parseCsv(SPARKASSE))!
const spkMapping = guessMapping(spk.headers)
const novOptions = (transactions: Transaction[] = []): ImportOptions => options(transactions, { today: '2026-11-02' })

const booked = (over: Partial<Transaction>): Transaction => ({
  id: 'x',
  date: '2026-11-01',
  accountId: 'giro',
  type: 'expense',
  amountCents: 343,
  payee: 'Bolt',
  note: '',
  categoryId: null,
  transferAccountId: null,
  recurringId: null,
  importHash: null,
  splits: [],
  attachments: [],
  createdAt: '',
  ...over
})

describe('Sparkasse-Export', () => {
  it('nimmt den PayPal-Händler als Empfänger und überspringt 0-€-Zeilen', () => {
    const c = buildCandidates(spk, spkMapping, novOptions())
    expect(c.map((x) => x.payee)).toEqual([
      'Bolt Operations OU',
      'PayPal Europe S.a.r.l. et Cie S.C.A',
      'DB Vertrieb GmbH',
      'John Dova',
      ''
    ])
    expect(c[4]).toMatchObject({ status: 'invalid', reason: 'Betrag 0 €' })
  })

  it('liest Mandat und Bank-Signal, aber nicht bei PayPal', () => {
    const c = buildCandidates(spk, spkMapping, novOptions())
    expect(c.map((x) => [x.mandate, x.signal])).toEqual([
      [null, false],
      [null, false],
      ['DE39DBV00000002177/100028337188', true],
      [null, true],
      [null, false]
    ])
  })

  it('erkennt eine vorgemerkte Buchung wieder, wenn sie gebucht ein anderes Datum hat', () => {
    const first = buildCandidates(spk, spkMapping, novOptions()).filter((c) => c.status === 'new')
    const { transactions } = finishImport(first, 'giro', [], makeId, '')
    // Gebucht zwei Tage später und mit anderem Text: kein Hash-Treffer, aber gleicher Betrag im Fenster.
    const later = toTable(parseCsv(SPARKASSE.replaceAll('01.11.26;02.11.26', '03.11.26;03.11.26').replaceAll('vorgemerkt', 'gebucht')))!
    const second = buildCandidates(later, spkMapping, novOptions(transactions))
    expect(second.map((c) => c.status)).toEqual(['similar', 'similar', 'similar', 'imported', 'invalid'])
    expect(second[2].reason).toBe('Gleicher Betrag wie „DB Vertrieb GmbH“ vom 01.11.2026')
  })

  it('verbraucht jede Buchung nur einmal und hält das Fenster von zwei Tagen ein', () => {
    const hand = booked({ id: 'hand', date: '2026-10-30', amountCents: 6300 })
    const tooEarly = booked({ id: 'alt', date: '2026-10-29', amountCents: 343 })
    const c = buildCandidates(spk, spkMapping, novOptions([hand, tooEarly]))
    expect(c[2].status).toBe('similar')
    expect(c[0].status).toBe('new')

    const twice = toTable(parseCsv([SPARKASSE.split('\n')[0], SPARKASSE.split('\n')[3], SPARKASSE.split('\n')[3]].join('\n')))!
    expect(buildCandidates(twice, spkMapping, novOptions([hand])).map((x) => x.status)).toEqual(['similar', 'new'])
  })

  it('markiert Bank-Signal, Mandat und Regel und lässt abgelehnte Empfänger weg', () => {
    const c = buildCandidates(spk, spkMapping, novOptions())
    const marks = markCandidates(c, 'giro', [], [], [], '2026-11-02')
    expect([...marks.keys()]).toEqual([2, 3])

    const rule: Recurring = {
      id: 'tg',
      accountId: 'giro',
      type: 'income',
      amountCents: 7500,
      payee: 'John Dova',
      note: '',
      categoryId: null,
      transferAccountId: null,
      interval: 'monthly',
      startDate: '2026-12-01',
      endDate: null,
      nextDueDate: '2026-12-01',
      active: true,
      contract: null
    }
    const withRule = markCandidates(c, 'giro', [], [rule], ['expense:db vertrieb gmbh'], '2026-11-02')
    expect([...withRule.entries()]).toEqual([[3, { kind: 'rule', interval: null }]])
    // Vergangene Zahlung an eine Regel: verknüpft, Termin bleibt.
    const result = finishImport([c[3]], 'giro', [rule], makeId, '')
    expect(result.transactions[0].recurringId).toBe('tg')
    expect(result.linked).toBe(0)
  })

  it('erkennt Mandate früherer Buchungen ohne Bank-Signal', () => {
    const plain = toTable(parseCsv(SPARKASSE.replaceAll('FOLGELASTSCHRIFT', 'LASTSCHRIFT')))!
    const c = buildCandidates(plain, spkMapping, novOptions())
    const earlier = booked({ id: 'db-okt', date: '2026-10-01', amountCents: 6300, payee: 'DB', mandate: c[2].mandate })
    expect(markCandidates(c, 'giro', [], [], [], '2026-11-02').has(2)).toBe(false)
    expect(markCandidates(c, 'giro', [earlier], [], [], '2026-11-02').get(2)?.kind).toBe('likely')
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

  it('nimmt bei zwei Regeln desselben Empfängers die mit dem passenden Betrag', () => {
    const hausrat = { ...rule, id: 'hausrat', type: 'expense' as const, payee: 'Allianz', amountCents: 1200, startDate: '2026-06-03', nextDueDate: '2026-06-03' }
    const kfz = { ...hausrat, id: 'kfz', amountCents: 4567 }
    const [rewe] = buildCandidates(table, mapping, options()).filter((c) => c.amountCents === 4567)
    const result = finishImport([{ ...rewe, payee: 'Allianz' }], 'giro', [hausrat, kfz], makeId, '')
    expect(result.transactions[0].recurringId).toBe('kfz')
    expect(result.recurring.map((r) => r.nextDueDate)).toEqual(['2026-06-03', '2026-07-03'])
  })

  it('verknüpft nichts, wenn der Termin der Regel weit entfernt liegt', () => {
    const candidates = buildCandidates(table, mapping, options()).filter((c) => c.status === 'new')
    const far = { ...rule, startDate: '2026-08-01', nextDueDate: '2026-08-01' }
    expect(finishImport(candidates, 'giro', [far], makeId, '').linked).toBe(0)
  })
})
