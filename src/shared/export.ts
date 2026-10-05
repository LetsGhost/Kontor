import { categoryParts } from './categories'
import { formatDate } from './draft'
import type { Account, Category, Transaction } from './schemas'
import { viewOf, type Ids } from './scope'
import { buildXlsx, type XlsxCell, type XlsxColumn } from './xlsx'

/** Eine Zeile im Export. Eine aufgeteilte Buchung ergibt eine Zeile je Teil, damit Summen je Kategorie stimmen. */
export interface ExportRow {
  date: string
  account: string
  type: string
  payee: string
  mainCategory: string
  category: string
  /** Mit Vorzeichen aus Sicht der gewählten Konten; Umbuchungen innerhalb dieser Konten sind 0 */
  amountCents: number
  note: string
  /** Bei Aufteilungen der Gesamtbetrag der Buchung, sonst leer */
  splitOfCents: number | null
  attachments: number
}

const typeLabel = { expense: 'Ausgabe', income: 'Einnahme', transfer: 'Umbuchung' }

export function exportRows(
  transactions: Transaction[],
  accounts: Account[],
  categories: Category[],
  ids: Ids
): ExportRow[] {
  const accountName = new Map(accounts.map((a) => [a.id, a.name]))
  const byId = new Map(categories.map((c) => [c.id, c]))
  const names = (categoryId: string | null): { mainCategory: string; category: string } => {
    const category = categoryId ? byId.get(categoryId) : undefined
    if (!category) return { mainCategory: '', category: '' }
    const parent = category.parentId ? byId.get(category.parentId) : undefined
    return parent ? { mainCategory: parent.name, category: category.name } : { mainCategory: category.name, category: '' }
  }

  return [...transactions]
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
    .flatMap((tx) => {
      const view = viewOf(tx, ids)
      const sign = view === 'income' ? 1 : view === 'expense' ? -1 : 0
      const account =
        tx.type === 'transfer'
          ? `${accountName.get(tx.accountId) ?? '?'} → ${accountName.get(tx.transferAccountId ?? '') ?? '?'}`
          : (accountName.get(tx.accountId) ?? '')
      const split = tx.splits.length > 0
      return categoryParts(tx).map((part, i) => ({
        date: tx.date,
        account,
        type: typeLabel[tx.type],
        payee: tx.payee,
        ...names(part.categoryId),
        amountCents: sign * part.amountCents,
        note: [tx.note, split ? tx.splits[i].note : ''].filter(Boolean).join(' · '),
        splitOfCents: split ? sign * tx.amountCents : null,
        attachments: tx.attachments.length
      }))
    })
}

const columns: (XlsxColumn & { value: (row: ExportRow) => XlsxCell })[] = [
  { header: 'Datum', kind: 'date', width: 11, value: (r) => r.date },
  { header: 'Konto', kind: 'text', width: 22, value: (r) => r.account },
  { header: 'Art', kind: 'text', width: 11, value: (r) => r.type },
  { header: 'Empfänger', kind: 'text', width: 28, value: (r) => r.payee },
  { header: 'Hauptkategorie', kind: 'text', width: 18, value: (r) => r.mainCategory },
  { header: 'Kategorie', kind: 'text', width: 18, value: (r) => r.category },
  { header: 'Betrag', kind: 'money', width: 13, value: (r) => r.amountCents },
  { header: 'Notiz', kind: 'text', width: 32, value: (r) => r.note },
  { header: 'Teil von', kind: 'money', width: 13, value: (r) => r.splitOfCents },
  { header: 'Belege', kind: 'text', width: 8, value: (r) => (r.attachments > 0 ? String(r.attachments) : '') }
]

const csvCell = (value: string): string => (/[;"\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)
const csvMoney = (cents: number): string => (cents / 100).toFixed(2).replace('.', ',')

/** CSV, wie Excel sie in Deutschland erwartet: Semikolon, Dezimalkomma, BOM für die Umlaute. */
export function toCsv(rows: ExportRow[]): string {
  const lines = [columns.map((c) => c.header).join(';')]
  for (const row of rows) {
    lines.push(
      columns
        .map((c) => {
          const value = c.value(row)
          if (value === null) return ''
          if (c.kind === 'date') return formatDate(String(value))
          if (c.kind === 'money') return csvMoney(Number(value))
          return csvCell(String(value))
        })
        .join(';')
    )
  }
  return `﻿${lines.join('\r\n')}\r\n`
}

export function toXlsx(rows: ExportRow[]): Uint8Array {
  return buildXlsx(
    'Buchungen',
    columns,
    rows.map((row) => columns.map((c) => c.value(row)))
  )
}
