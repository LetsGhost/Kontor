import { ArrowLeftRight, FileUp, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { FALLBACK_ICON } from '../../../shared/defaultCategories'
import { CategoryIcon } from '../icons'
import { todayIso } from '../../../shared/balance'
import { viewOf } from '../../../shared/scope'
import { useArea } from '../area'
import { formatDate } from '../../../shared/draft'
import { formatCents } from '../../../shared/money'
import type { Transaction } from '../../../shared/schemas'
import { TransactionForm } from '../TransactionForm'
import { CsvImport } from './CsvImport'
import { useApp } from '../store'
import { Button, ConfirmRow, inputClass } from '../ui'

const PAGE_SIZE = 300

export function Transactions({ onGoToAccounts }: { onGoToAccounts: () => void }) {
  const { accounts, categories, transactions } = useApp((s) => s.data)
  const removeTransaction = useApp((s) => s.removeTransaction)
  const area = useArea()
  const [chosenAccount, setAccountFilter] = useState('')
  // Nach einem Bereichswechsel kann das gemerkte Konto zu einem anderen Bereich gehören.
  const accountFilter = area.ids.has(chosenAccount) ? chosenAccount : ''
  // Die Konten, aus deren Sicht Beträge und Summen gezeigt werden: das gefilterte oder der ganze Bereich.
  const viewIds = useMemo(() => (accountFilter ? new Set([accountFilter]) : area.ids), [accountFilter, area.ids])
  const [month, setMonth] = useState('')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [form, setForm] = useState<Transaction | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const activeAccounts = area.active
  const canBook = activeAccounts.length > 0
  const today = todayIso()

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key.toLowerCase() === 'n' && canBook) {
        e.preventDefault()
        setForm('new')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canBook])

  const accountName = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts])
  const iconOf = useMemo(() => {
    const icons = new Map(categories.map((c) => [c.id, c.icon]))
    return (id: string | null): string => (id && icons.get(id)) || FALLBACK_ICON
  }, [categories])
  const categoryLabel = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]))
    return (id: string | null): string => {
      const category = id ? byId.get(id) : undefined
      if (!category) return ''
      const parent = category.parentId ? byId.get(category.parentId) : undefined
      return parent ? `${parent.name} › ${category.name}` : category.name
    }
  }, [categories])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return transactions
      .filter(
        (t) =>
          viewOf(t, viewIds) !== 'outside' &&
          (!month || t.date.startsWith(month)) &&
          (!needle ||
            t.payee.toLowerCase().includes(needle) ||
            t.note.toLowerCase().includes(needle) ||
            categoryLabel(t.categoryId).toLowerCase().includes(needle))
      )
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  }, [transactions, viewIds, month, search, categoryLabel])

  const income = filtered.reduce((sum, t) => sum + (viewOf(t, viewIds) === 'income' ? t.amountCents : 0), 0)
  const expenses = filtered.reduce((sum, t) => sum + (viewOf(t, viewIds) === 'expense' ? t.amountCents : 0), 0)

  /** Betrag mit Vorzeichen. Umbuchungen zwischen zwei Konten im Blick sind weder positiv noch negativ. */
  const signed = (t: Transaction): number => {
    const view = viewOf(t, viewIds)
    return view === 'income' ? t.amountCents : view === 'expense' ? -t.amountCents : 0
  }

  const title = (t: Transaction): string =>
    t.type === 'transfer'
      ? `${accountName.get(t.accountId) ?? '?'} → ${accountName.get(t.transferAccountId ?? '') ?? '?'}`
      : t.payee || (t.type === 'income' ? 'Einnahme' : 'Ausgabe')

  if (importing) return <CsvImport onClose={() => setImporting(false)} />

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold">Buchungen</h1>
        <div className="flex gap-2">
          <Button disabled={!canBook} onClick={() => setImporting(true)}>
            <FileUp size={15} /> CSV importieren
          </Button>
          <Button variant="primary" disabled={!canBook} onClick={() => setForm('new')} title="Strg+N">
            <Plus size={15} /> Neue Buchung
          </Button>
        </div>
      </div>

      {!canBook ? (
        <p className="text-sm text-muted">
          Für Buchungen brauchst du zuerst ein Konto.{' '}
          <button className="text-text underline underline-offset-2" onClick={onGoToAccounts}>
            Konto anlegen
          </button>
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <input
              className={`${inputClass} max-w-xs`}
              placeholder="Suchen (Empfänger, Notiz, Kategorie)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className={`${inputClass} max-w-64`}
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
            >
              <option value="">{area.several ? `Alle Konten in „${area.area.name}“` : 'Alle Konten'}</option>
              {area.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.archived ? ' (archiviert)' : ''}
                </option>
              ))}
            </select>
            <input
              type="month"
              className={`${inputClass} max-w-44`}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
            {(search || accountFilter || month) && (
              <Button
                small
                variant="ghost"
                onClick={() => {
                  setSearch('')
                  setAccountFilter('')
                  setMonth('')
                }}
              >
                Filter zurücksetzen
              </Button>
            )}
            <div className="num ml-auto flex gap-5 text-sm">
              <span className="text-plus">+{formatCents(income)}</span>
              <span>−{formatCents(expenses)}</span>
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-muted">
              {!search && !accountFilter && !month
                ? 'Noch keine Buchungen. Mit Strg+N legst du die erste an.'
                : 'Keine Buchungen für diese Filter.'}
            </p>
          ) : (
            <ul className="ledger">
              {filtered.slice(0, limit).map((t) => {
                const amount = signed(t)
                return (
                  <li key={t.id} className="group flex items-center gap-4 py-2.5 text-sm">
                    <span className="num w-24 shrink-0 text-muted">{formatDate(t.date)}</span>
                    {t.type === 'transfer' ? (
                      <ArrowLeftRight size={16} strokeWidth={1.75} className="shrink-0 text-muted" />
                    ) : (
                      <CategoryIcon name={iconOf(t.categoryId)} className="shrink-0 text-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate">
                        {title(t)}
                        {t.date > today && (
                          <span className="ml-2 border border-line px-1.5 py-0.5 text-[10px] text-muted">
                            geplant
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted">
                        {[
                          t.type === 'transfer'
                            ? ['Umbuchung', categoryLabel(t.categoryId)].filter(Boolean).join(' · ')
                            : categoryLabel(t.categoryId) || 'Ohne Kategorie',
                          t.type === 'transfer' ? '' : accountName.get(t.accountId),
                          t.note
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    {confirmDelete === t.id ? (
                      <ConfirmRow
                        question="Buchung löschen?"
                        confirmLabel="Löschen"
                        onConfirm={() => removeTransaction(t.id).then(() => setConfirmDelete(null))}
                        onCancel={() => setConfirmDelete(null)}
                      />
                    ) : (
                      <div className="flex gap-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                        <Button small variant="ghost" onClick={() => setForm(t)}>
                          Bearbeiten
                        </Button>
                        <Button small variant="ghost" onClick={() => setConfirmDelete(t.id)}>
                          Löschen
                        </Button>
                      </div>
                    )}
                    <span
                      className={`num w-28 shrink-0 text-right ${
                        amount > 0 ? 'text-plus' : amount < 0 ? 'text-text' : 'text-muted'
                      }`}
                    >
                      {amount > 0 ? '+' : ''}
                      {formatCents(amount === 0 ? t.amountCents : amount)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}

          {filtered.length > limit && (
            <Button onClick={() => setLimit((n) => n + PAGE_SIZE)}>
              Weitere anzeigen ({filtered.length - limit} übrig)
            </Button>
          )}
        </>
      )}

      {form && (
        <TransactionForm
          editing={form === 'new' ? null : form}
          defaultAccountId={
            activeAccounts.some((a) => a.id === accountFilter) ? accountFilter : (activeAccounts[0]?.id ?? '')
          }
          onClose={() => setForm(null)}
        />
      )}
    </div>
  )
}
