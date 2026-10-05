import { isRealDate } from './draft'
import { parseAmount } from './money'
import { advance } from './recurring'
import type { Account, Category, Recurring, Transaction } from './schemas'
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
    note: find(headers, /verwendungszweck/, /buchungstext|beschreibung|text/)
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
  /** Es gibt eine von Hand erfasste Buchung mit gleichem Datum und Betrag */
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
}

export interface ImportOptions {
  account: Account
  /** Für Exporte, die Ausgaben als positive Zahlen führen (manche Kreditkarten) */
  invert: boolean
  transactions: Transaction[]
  categories: Category[]
  today: string
}

/** Macht aus den CSV-Zeilen Buchungsvorschläge und markiert Dubletten und unlesbare Zeilen. */
export function buildCandidates(table: CsvTable, mapping: CsvMapping, options: ImportOptions): ImportCandidate[] {
  const { account, transactions } = options
  const knownHashes = new Set(transactions.map((t) => t.importHash).filter(Boolean))
  const manual = new Set(
    transactions
      .filter((t) => t.importHash === null && t.accountId === account.id && t.type !== 'transfer')
      .map((t) => `${t.date}|${t.type}|${t.amountCents}`)
  )
  const seen = new Map<string, number>()
  const cell = (row: string[], index: number): string => (index >= 0 ? (row[index] ?? '') : '')

  return table.rows.map((row, line) => {
    const date = parseCsvDate(cell(row, mapping.date))
    const raw = parseSignedAmount(cell(row, mapping.amount))
    const signed = raw === null ? null : options.invert ? -raw : raw
    const type = signed !== null && signed > 0 ? 'income' : 'expense'
    const payeeColumn = type === 'income' && mapping.payer >= 0 ? mapping.payer : mapping.payee
    const payee = cell(row, payeeColumn).replace(/\s+/g, ' ')
    const note = cell(row, mapping.note).replace(/\s+/g, ' ')

    const base = { line, type, payee, note, categoryId: null, importHash: '' } as const
    if (date === null) {
      return { ...base, status: 'invalid', reason: 'Datum nicht lesbar', date: '', amountCents: 0 }
    }
    if (signed === null || signed === 0) {
      return { ...base, status: 'invalid', reason: 'Betrag nicht lesbar', date, amountCents: 0 }
    }
    const amountCents = Math.abs(signed)
    if (date < account.openingDate) {
      return { ...base, status: 'invalid', reason: 'Liegt vor dem Startdatum des Kontos', date, amountCents }
    }

    // Zwei gleiche Zeilen in einer Datei (zweimal Kaffee am selben Tag) bekommen eine laufende Nummer,
    // damit die zweite nicht als Dublette der ersten gilt.
    const key = `${account.id}|${date}|${signed}|${normalizePayee(payee)}|${normalizePayee(note)}`
    const occurrence = seen.get(key) ?? 0
    seen.set(key, occurrence + 1)
    const importHash = hash(`${key}#${occurrence}`)

    const status: ImportStatus = knownHashes.has(importHash)
      ? 'imported'
      : manual.has(`${date}|${type}|${amountCents}`)
        ? 'similar'
        : 'new'
    const reason = { new: '', imported: 'Schon importiert', similar: 'Vielleicht schon von Hand erfasst' }[status]

    return {
      ...base,
      status,
      reason,
      date,
      amountCents,
      importHash,
      categoryId: suggestCategory(payee, type, transactions, options.categories, options.today, amountCents)
    }
  })
}

const DAY_MS = 86_400_000
const RULE_WINDOW_DAYS = 7
const RULE_SIMILARITY = 0.6

/**
 * Erzeugt die Buchungen und verknüpft sie mit wiederkehrenden Regeln: Kommt die Miete per Import,
 * gilt der anstehende Termin als erledigt und erscheint nicht zusätzlich als fällig.
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
      const rule = rules.find(
        (r) =>
          r.active &&
          r.accountId === accountId &&
          r.type === c.type &&
          similarity(payee, normalizePayee(r.payee)) >= RULE_SIMILARITY &&
          Math.abs(Date.parse(r.nextDueDate) - Date.parse(c.date)) <= RULE_WINDOW_DAYS * DAY_MS
      )
      if (rule) {
        rules = rules.map((r) => (r.id === rule.id ? advance(r, r.nextDueDate) : r))
        linked++
      }
      return {
        id: makeId(),
        date: c.date,
        accountId,
        type: c.type,
        amountCents: c.amountCents,
        payee: c.payee,
        note: c.note,
        categoryId: c.categoryId,
        transferAccountId: null,
        recurringId: rule?.id ?? null,
        importHash: c.importHash,
        createdAt,
        splits: [],
        attachments: []
      }
    })

  return { transactions, recurring: rules, linked }
}
