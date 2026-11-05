import { effectOnAccount } from './balance'
import { suggestPerson, type PersonDebts } from './debts'
import { formatDate, isRealDate } from './draft'
import { parseAmount } from './money'
import { advance, patternKey, recurringMarks, type RecurringMark } from './recurring'
import type { Account, Category, Recurring, Transaction } from './schemas'
import { daysBetween } from './stats'
import { normalizePayee, similarity, suggestCategory } from './suggest'

/** Bank-Exporte sind oft noch Windows-1252 statt UTF-8. Erst streng UTF-8 versuchen, sonst zurückfallen. */
export function decodeCsv(bytes: Uint8Array): string {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes)
  }
  return text.replace(/^﻿/, '')
}

function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/, 20).join('\n')
  let best = ';'
  let bestCount = -1
  for (const delimiter of [';', ',', '\t']) {
    const count = sample.split(delimiter).length
    if (count > bestCount) [best, bestCount] = [delimiter, count]
  }
  return best
}

/** Zerlegt CSV-Text in Zeilen und Zellen. Versteht Anführungszeichen, doppelte Anführungszeichen und Zeilenumbrüche in Zellen. */
export function parseCsv(text: string): string[][] {
  const delimiter = detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
    } else if (char === '"' && cell === '') {
      quoted = true
    } else if (char === delimiter) {
      row.push(cell.trim())
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(cell.trim())
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell.trim())
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c !== ''))
}

export interface CsvTable {
  headers: string[]
  rows: string[][]
}

/**
 * Trennt Kopfzeile und Daten. Viele Banken schreiben vor die eigentliche Tabelle ein paar Zeilen mit
 * Kontonummer und Zeitraum; die Tabelle ist der Teil mit der häufigsten Spaltenzahl.
 */
export function toTable(cells: string[][]): CsvTable | null {
  const counts = new Map<number, number>()
  for (const row of cells) counts.set(row.length, (counts.get(row.length) ?? 0) + 1)
  const width = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0
  if (width < 2) return null

  const headerIndex = cells.findIndex((row) => row.length === width)
  const rows = cells.slice(headerIndex + 1).filter((row) => row.length === width)
  return rows.length > 0 ? { headers: cells[headerIndex], rows } : null
}

/** Spaltennummern je Feld, -1 = nicht zugeordnet. */
export interface CsvMapping {
  date: number
  amount: number
  payee: number
  /** Absender bei Einnahmen, falls die Bank dafür eine eigene Spalte hat */
  payer: number
  note: number
  /** Art der Buchung laut Bank, z. B. DAUERAUFTRAG oder FOLGELASTSCHRIFT */
  bookingText: number
  creditor: number
  mandate: number
}

const find = (headers: string[], ...patterns: RegExp[]): number => {
  for (const pattern of patterns) {
    const index = headers.findIndex((h) => pattern.test(h.toLowerCase()))
    if (index >= 0) return index
  }
  return -1
}

export function guessMapping(headers: string[]): CsvMapping {
  const payee = find(headers, /zahlungsempf/, /empf[äa]nger/, /beg[üu]nstigter|beguenstigter/, /auftraggeber/, /name/)
  const payer = find(headers, /zahlungspflichtig/)
  return {
    date: find(headers, /buchungstag|buchungsdatum/, /^datum/, /valuta|wertstellung/, /datum/),
    amount: find(headers, /^betrag/, /betrag|umsatz/),
    payee,
    payer: payer === payee ? -1 : payer,
    note: find(headers, /verwendungszweck/, /buchungstext|beschreibung|text/),
    bookingText: find(headers, /buchungstext/),
    creditor: find(headers, /gl(ä|ae|a)ubiger/),
    mandate: find(headers, /mandat/)
  }
}

export function parseCsvDate(value: string): string | null {
  const s = value.trim()
  let match = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/.exec(s)
  let iso: string
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3]
    iso = `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
  } else {
    match = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
    if (!match) return null
    iso = `${match[1]}-${match[2]}-${match[3]}`
  }
  return isRealDate(iso) ? iso : null
}

/** Wie parseAmount, versteht aber auch "+12,00" und das nachgestellte Minus mancher Banken ("12,00-"). */
export function parseSignedAmount(value: string): number | null {
  let s = value.replace(/[\s€]|EUR/g, '').replace(/^\+/, '')
  if (s.endsWith('-')) s = `-${s.slice(0, -1)}`
  return parseAmount(s)
}

// cyrb53: kurzer, stabiler Hash ohne Abhängigkeit. Kollisionen sind bei Kontoumsätzen praktisch ausgeschlossen.
function hash(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

export type ImportStatus =
  | 'new'
  /** Diese Zeile wurde schon einmal importiert */
  | 'imported'
  /** Es gibt eine Buchung mit gleichem Betrag in den Tagen davor oder danach (von Hand oder als vorgemerkter Umsatz) */
  | 'similar'
  | 'invalid'

export interface ImportCandidate {
  /** Position in der Datei, für stabile Schlüssel in der Vorschau */
  line: number
  status: ImportStatus
  reason: string
  date: string
  type: 'expense' | 'income'
  amountCents: number
  payee: string
  note: string
  categoryId: string | null
  importHash: string
  /** Gläubiger-ID/Mandatsreferenz, wenn die Zeile eine Lastschrift mit eigenem Mandat ist */
  mandate: string | null
  /** Die Bank nennt die Buchung selbst wiederkehrend (Dauerauftrag, Folgelastschrift) */
  signal: boolean
  /** Vorgeschlagene Person, bei der die Zeile eine Schuld begleicht. Dann ohne Kategorie. */
  personId: string | null
}

export interface ImportOptions {
  account: Account
  /** Für Exporte, die Ausgaben als positive Zahlen führen (manche Kreditkarten) */
  invert: boolean
  transactions: Transaction[]
  categories: Category[]
  today: string
  /** Offene Schulden je Person, für den Vorschlag „Rückzahlung von …“ */
  debts?: PersonDebts[]
}

// Kassenzettel-Datum vs. Buchungstag, vorgemerkt vs. gebucht.
const DUPLICATE_WINDOW_DAYS = 2
const PAYPAL_MERCHANT = /Ihr Einkauf bei\s+(.+?)\s*$/i
const BANK_SIGNAL = /dauerauftr|folgelastschrift/i

const daysApart = (a: string, b: string): number => Math.abs(daysBetween(a, b))

/** Macht aus den CSV-Zeilen Buchungsvorschläge und markiert Dubletten und unlesbare Zeilen. */
export function buildCandidates(table: CsvTable, mapping: CsvMapping, options: ImportOptions): ImportCandidate[] {
  const { account, transactions } = options
  const byHash = new Map(transactions.filter((t) => t.importHash).map((t) => [t.importHash!, t]))
  // Jede gespeicherte Buchung kann nur eine Zeile als Dublette abdecken.
  const used = new Set<string>()
  const seen = new Map<string, number>()
  const cell = (row: string[], index: number): string => (index >= 0 ? (row[index] ?? '') : '').replace(/\s+/g, ' ')

  const candidates = table.rows.map((row, line): ImportCandidate => {
    const date = parseCsvDate(cell(row, mapping.date))
    const raw = parseSignedAmount(cell(row, mapping.amount))
    const signed = raw === null ? null : options.invert ? -raw : raw
    const type = signed !== null && signed > 0 ? 'income' : 'expense'
    const payeeColumn = type === 'income' && mapping.payer >= 0 ? mapping.payer : mapping.payee
    const rawPayee = cell(row, payeeColumn)
    const note = cell(row, mapping.note)
    // PayPal zieht alles über ein Mandat ein; der eigentliche Händler steht im Verwendungszweck.
    const paypal = /paypal/i.test(rawPayee)
    const payee = (paypal && PAYPAL_MERCHANT.exec(note)?.[1]) || rawPayee
    const creditor = cell(row, mapping.creditor)
    const mandateRef = cell(row, mapping.mandate)
    const mandate = !paypal && creditor && mandateRef ? `${creditor}/${mandateRef}` : null
    const signal = !paypal && BANK_SIGNAL.test(cell(row, mapping.bookingText))

    const base = { line, type, payee, note, categoryId: null, importHash: '', mandate, signal, personId: null } as const
    if (date === null) {
      return { ...base, status: 'invalid', reason: 'Datum nicht lesbar', date: '', amountCents: 0 }
    }
    if (signed === null) {
      return { ...base, status: 'invalid', reason: 'Betrag nicht lesbar', date, amountCents: 0 }
    }
    if (signed === 0) {
      return { ...base, status: 'invalid', reason: 'Betrag 0 €', date, amountCents: 0 }
    }
    const amountCents = Math.abs(signed)
    if (date < account.openingDate) {
      return { ...base, status: 'invalid', reason: 'Liegt vor dem Startdatum des Kontos', date, amountCents }
    }

    // Zwei gleiche Zeilen in einer Datei (zweimal Kaffee am selben Tag) bekommen eine laufende Nummer,
    // damit die zweite nicht als Dublette der ersten gilt. Der Empfänger aus der Datei (nicht der
    // PayPal-Händler) hält den Hash gleich zu früheren Importen.
    const key = `${account.id}|${date}|${signed}|${normalizePayee(rawPayee)}|${normalizePayee(note)}`
    const occurrence = seen.get(key) ?? 0
    seen.set(key, occurrence + 1)
    const importHash = hash(`${key}#${occurrence}`)
    const known = byHash.get(importHash)
    if (known) used.add(known.id)

    const personId = suggestPerson(payee, type, options.debts ?? [])
    return {
      ...base,
      status: known ? 'imported' : 'new',
      reason: known ? 'Schon importiert' : '',
      date,
      amountCents,
      importHash,
      personId,
      categoryId: personId
        ? null
        : suggestCategory(payee, type, transactions, options.categories, options.today, amountCents)
    }
  })

  // Zweiter Durchgang, damit exakte Treffer Vorrang haben: gleiche Wirkung aufs Konto, höchstens zwei Tage Abstand.
  // Umbuchungen zählen mit: Die Bank führt eine von Hand erfasste Umbuchung als gewöhnliche Zeile.
  const own = transactions.filter((t) => effectOnAccount(t, account.id) !== 0)
  for (const c of candidates) {
    if (c.status !== 'new') continue
    const payee = normalizePayee(c.payee)
    const effect = c.type === 'income' ? c.amountCents : -c.amountCents
    const match = own
      .filter(
        (t) =>
          effectOnAccount(t, account.id) === effect &&
          !used.has(t.id) &&
          daysApart(t.date, c.date) <= DUPLICATE_WINDOW_DAYS
      )
      .sort(
        (a, b) =>
          daysApart(a.date, c.date) - daysApart(b.date, c.date) ||
          similarity(payee, normalizePayee(b.payee)) - similarity(payee, normalizePayee(a.payee))
      )[0]
    if (!match) continue
    used.add(match.id)
    c.status = 'similar'
    c.reason = `Gleicher Betrag wie „${match.payee || (match.type === 'transfer' ? 'Umbuchung' : 'ohne Empfänger')}“ vom ${formatDate(match.date)}`
  }
  return candidates
}

const RULE_WINDOW_DAYS = 7
const RULE_SIMILARITY = 0.6

const fitsRule = (r: Recurring, accountId: string, type: string, payee: string): boolean =>
  r.active &&
  r.accountId === accountId &&
  r.type === type &&
  similarity(payee, normalizePayee(r.payee)) >= RULE_SIMILARITY

/** Die Regel mit dem nächstliegenden Betrag. Ein Versicherer hat oft mehrere Verträge mit demselben Empfänger. */
const closestRule = (rules: Recurring[], amountCents: number): Recurring | undefined =>
  rules.reduce<Recurring | undefined>(
    (best, r) => (!best || Math.abs(r.amountCents - amountCents) < Math.abs(best.amountCents - amountCents) ? r : best),
    undefined
  )

function toTransaction(
  c: ImportCandidate,
  accountId: string,
  id: string,
  recurringId: string | null,
  createdAt: string
): Transaction {
  return {
    id,
    date: c.date,
    accountId,
    type: c.type,
    amountCents: c.amountCents,
    payee: c.payee,
    note: c.note,
    categoryId: c.categoryId,
    transferAccountId: null,
    recurringId,
    importHash: c.importHash,
    mandate: c.mandate,
    personId: c.personId,
    createdAt,
    splits: [],
    attachments: []
  }
}

/**
 * Welche neuen Zeilen wiederkehrend sind: passt zu einer Regel, gehört zu einem Muster aus alten Buchungen
 * und Datei, gleiches Mandat wie eine andere Buchung, oder die Bank nennt sie Dauerauftrag/Folgelastschrift.
 */
export function markCandidates(
  candidates: ImportCandidate[],
  accountId: string,
  transactions: Transaction[],
  recurring: Recurring[],
  dismissed: string[],
  today: string
): Map<number, RecurringMark> {
  // Dubletten bleiben draußen, sonst stünde dieselbe Zahlung zweimal im Muster.
  const fresh = candidates.filter((c) => c.status === 'new')
  const pseudo = fresh.map((c) => {
    const payee = normalizePayee(c.payee)
    const rule = closestRule(
      recurring.filter((r) => fitsRule(r, accountId, c.type, payee)),
      c.amountCents
    )
    return toTransaction(c, accountId, `csv:${c.line}`, rule?.id ?? null, '')
  })
  const marks = recurringMarks([...transactions, ...pseudo], recurring, dismissed, today)
  const skip = new Set(dismissed)
  const result = new Map<number, RecurringMark>()
  for (const c of fresh) {
    const mark =
      marks.get(`csv:${c.line}`) ??
      (c.signal && !skip.has(patternKey(c.type, c.payee)) ? { kind: 'likely' as const, interval: null } : undefined)
    if (mark) result.set(c.line, mark)
  }
  return result
}

/**
 * Erzeugt die Buchungen und verknüpft sie mit wiederkehrenden Regeln: Kommt die Miete per Import,
 * gilt der anstehende Termin als erledigt und erscheint nicht zusätzlich als fällig. Frühere Zahlungen
 * an eine Regel werden nur verknüpft, ihr Termin bleibt.
 */
export function finishImport(
  candidates: ImportCandidate[],
  accountId: string,
  recurring: Recurring[],
  makeId: () => string,
  createdAt: string
): { transactions: Transaction[]; recurring: Recurring[]; linked: number } {
  let rules = recurring
  let linked = 0

  const transactions = [...candidates]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((c): Transaction => {
      const payee = normalizePayee(c.payee)
      const fitting = rules.filter((r) => fitsRule(r, accountId, c.type, payee))
      const due = closestRule(
        fitting.filter((r) => daysApart(r.nextDueDate, c.date) <= RULE_WINDOW_DAYS),
        c.amountCents
      )
      if (due) {
        rules = rules.map((r) => (r.id === due.id ? advance(r, r.nextDueDate) : r))
        linked++
      }
      const earlier = due
        ? undefined
        : closestRule(
            fitting.filter((r) => c.date < r.nextDueDate),
            c.amountCents
          )
      return toTransaction(c, accountId, makeId(), (due ?? earlier)?.id ?? null, createdAt)
    })

  return { transactions, recurring: rules, linked }
}
