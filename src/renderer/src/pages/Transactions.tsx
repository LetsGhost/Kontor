import { ArrowLeftRight, Download, FileUp, Paperclip, Plus, Split, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { effectOnAccount, todayIso } from '../../../shared/balance'
import { categoryParts } from '../../../shared/categories'
import { FALLBACK_ICON } from '../../../shared/defaultCategories'
import { formatDate } from '../../../shared/draft'
import { exportRows, toCsv, toXlsx } from '../../../shared/export'
import { formatCents } from '../../../shared/money'
import { matchesAmount, parseAmountQuery } from '../../../shared/query'
import type { Transaction, TransactionType } from '../../../shared/schemas'
import { viewOf } from '../../../shared/scope'
import { CategorySelect } from '../CategorySelect'
import { TransactionForm } from '../TransactionForm'
import { useArea } from '../area'
import { CategoryIcon } from '../icons'
import { useApp } from '../store'
import { Button, inputClass } from '../ui'
import { CsvImport } from './CsvImport'

const PAGE_SIZE = 300
// Kein gültiger Kategorie-Schlüssel: Kategorien bekommen UUIDs.
const WITHOUT_CATEGORY = '__none__'

const typeFilters: [TransactionType | '', string][] = [
  ['', 'Alle Arten'],
  ['expense', 'Ausgaben'],
  ['income', 'Einnahmen'],
  ['transfer', 'Umbuchungen']
]

export function Transactions({ onGoToAccounts }: { onGoToAccounts: () => void }) {
  const { accounts, categories, transactions } = useApp((s) => s.data)
  const removeTransactions = useApp((s) => s.removeTransactions)
  const putTransactions = useApp((s) => s.putTransactions)
  const showNotice = useApp((s) => s.showNotice)
  const searchRequest = useApp((s) => s.searchRequest)
  const area = useArea()
  const [chosenAccount, setAccountFilter] = useState('')
  // Nach einem Bereichswechsel kann das gemerkte Konto zu einem anderen Bereich gehören.
  const accountFilter = area.ids.has(chosenAccount) ? chosenAccount : ''
  // Die Konten, aus deren Sicht Beträge und Summen gezeigt werden: das gefilterte oder der ganze Bereich.
  const viewIds = useMemo(() => (accountFilter ? new Set([accountFilter]) : area.ids), [accountFilter, area.ids])
  const [month, setMonth] = useState('')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<TransactionType | ''>('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [form, setForm] = useState<Transaction | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [focusIndex, setFocusIndex] = useState(0)
  const [exportOpen, setExportOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const activeAccounts = area.active
  const canBook = activeAccounts.length > 0
  const today = todayIso()

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.ctrlKey && e.key.toLowerCase() === 'n' && canBook && !document.querySelector('[role="dialog"]')) {
        e.preventDefault()
        setForm('new')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canBook])

  // Strg+F von irgendwo in der App landet hier im Suchfeld.
  useEffect(() => {
    if (searchRequest === 0) return
    searchRef.current?.focus()
    searchRef.current?.select()
  }, [searchRequest])

  const accountName = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts])
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const iconOf = (id: string | null): string => (id && byId.get(id)?.icon) || FALLBACK_ICON
  const categoryLabel = useMemo(
    () =>
      (id: string | null): string => {
        const category = id ? byId.get(id) : undefined
        if (!category) return ''
        const parent = category.parentId ? byId.get(category.parentId) : undefined
        return parent ? `${parent.name} › ${category.name}` : category.name
      },
    [byId]
  )
  const partsLabel = (t: Transaction): string =>
    t.splits.length > 0
      ? `Aufgeteilt: ${t.splits.map((s) => byId.get(s.categoryId ?? '')?.name ?? 'Ohne Kategorie').join(', ')}`
      : categoryLabel(t.categoryId)

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const amountQuery = parseAmountQuery(search)
    const matchesText = (t: Transaction): boolean =>
      t.payee.toLowerCase().includes(needle) ||
      t.note.toLowerCase().includes(needle) ||
      categoryParts(t).some((p) => categoryLabel(p.categoryId).toLowerCase().includes(needle)) ||
      t.splits.some((s) => s.note.toLowerCase().includes(needle))
    const matchesSearch = (t: Transaction): boolean => {
      if (!needle) return true
      if (!amountQuery) return matchesText(t)
      const amountHit =
        matchesAmount(amountQuery, t.amountCents) || t.splits.some((s) => matchesAmount(amountQuery, s.amountCents))
      // „>100“ ist eindeutig ein Betrag, „2026“ oder „49,99“ könnte auch im Text stehen.
      return amountQuery.exact ? amountHit || matchesText(t) : amountHit
    }
    const matchesCategory = (t: Transaction): boolean => {
      if (!categoryFilter) return true
      return categoryParts(t).some((p) =>
        categoryFilter === WITHOUT_CATEGORY
          ? p.categoryId === null && t.type !== 'transfer'
          : p.categoryId === categoryFilter || (p.categoryId && byId.get(p.categoryId)?.parentId === categoryFilter)
      )
    }

    return transactions
      .filter(
        (t) =>
          viewOf(t, viewIds) !== 'outside' &&
          (!month || t.date.startsWith(month)) &&
          (!typeFilter || t.type === typeFilter) &&
          matchesCategory(t) &&
          matchesSearch(t)
      )
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  }, [transactions, viewIds, month, search, typeFilter, categoryFilter, categoryLabel, byId])

  // Kontostand nach jeder Buchung, sobald ein einzelnes Konto gefiltert ist. Gerechnet wird über alle
  // Buchungen des Kontos, damit Such- und Monatsfilter den Saldo nicht verfälschen.
  const runningBalance = useMemo(() => {
    const account = accounts.find((a) => a.id === accountFilter)
    if (!account) return null
    const balances = new Map<string, number>()
    let balance = account.openingBalanceCents
    const own = transactions
      .filter((t) => t.accountId === account.id || t.transferAccountId === account.id)
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
    for (const t of own) {
      balance += effectOnAccount(t, account.id)
      balances.set(t.id, balance)
    }
    return balances
  }, [accounts, accountFilter, transactions])

  const visible = filtered.slice(0, limit)
  const filtersActive = Boolean(search || accountFilter || month || typeFilter || categoryFilter)

  // Auswahl auf das beschränken, was noch existiert und zu sehen ist.
  const selection = useMemo(() => filtered.filter((t) => selected.has(t.id)), [filtered, selected])

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

  const toggle = (id: string): void =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const remove = async (ids: string[]): Promise<void> => {
    const removed = await removeTransactions(ids)
    setSelected(new Set())
    if (removed.length === 0) return
    showNotice(
      removed.length === 1 ? 'Buchung gelöscht' : `${removed.length} Buchungen gelöscht`,
      () => putTransactions(removed)
    )
  }

  const recategorize = async (categoryId: string): Promise<void> => {
    const targets = selection.filter((t) => t.type !== 'transfer')
    const previous = targets.map((t) => ({ ...t }))
    // Eine neue Kategorie für die ganze Buchung ersetzt eine bisherige Aufteilung.
    await putTransactions(targets.map((t) => ({ ...t, categoryId: categoryId || null, splits: [] })))
    setSelected(new Set())
    showNotice(
      `${targets.length === 1 ? 'Eine Buchung' : `${targets.length} Buchungen`} umkategorisiert`,
      () => putTransactions(previous)
    )
  }

  const runExport = async (format: 'xlsx' | 'csv'): Promise<void> => {
    setExportOpen(false)
    const rows = exportRows(selection.length > 0 ? selection : filtered, accounts, categories, viewIds)
    const name = `Kontor-Buchungen-${month || today}.${format}`
    const bytes = format === 'xlsx' ? toXlsx(rows) : new TextEncoder().encode(toCsv(rows))
    const path = await window.kontor.saveExport(name, bytes)
    if (path) showNotice(`${rows.length} Zeilen exportiert nach ${path}`)
  }

  const focusRow = (index: number): void => {
    const clamped = Math.max(0, Math.min(visible.length - 1, index))
    setFocusIndex(clamped)
    listRef.current?.querySelector<HTMLElement>(`[data-index="${clamped}"]`)?.focus()
  }

  // Pfeiltasten wandern durch die Liste, Enter bearbeitet, Leertaste wählt aus, Entf löscht.
  const onListKey = (e: KeyboardEvent<HTMLUListElement>): void => {
    const target = e.target as HTMLElement
    if (target.dataset.index === undefined) return
    const index = Number(target.dataset.index)
    const tx = visible[index]
    if (!tx) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      focusRow(index + (e.key === 'ArrowDown' ? 1 : -1))
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      focusRow(e.key === 'Home' ? 0 : visible.length - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      setForm(tx)
    } else if (e.key === ' ') {
      e.preventDefault()
      toggle(tx.id)
    } else if (e.key === 'Delete') {
      e.preventDefault()
      void remove(selection.length > 0 && selected.has(tx.id) ? selection.map((t) => t.id) : [tx.id])
      focusRow(index)
    } else if (e.key === 'Escape' && selected.size > 0) {
      setSelected(new Set())
    } else if (e.ctrlKey && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setSelected(new Set(filtered.map((t) => t.id)))
    }
  }

  if (importing) return <CsvImport onClose={() => setImporting(false)} />

  // Umkategorisieren geht nur, wenn alle gewählten Buchungen dieselbe Art haben und keine Umbuchung sind.
  const selectionKinds = new Set(selection.map((t) => t.type))
  const recategorizeKind =
    selectionKinds.size === 1 && !selectionKinds.has('transfer') ? (selection[0].type as 'expense' | 'income') : null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold">Buchungen</h1>
        <div className="flex gap-2">
          <div className="relative">
            <Button disabled={filtered.length === 0} onClick={() => setExportOpen((v) => !v)}>
              <Download size={15} /> Exportieren
            </Button>
            {exportOpen && (
              <div
                className="absolute right-0 z-10 mt-1 w-56 overflow-hidden rounded-md border border-line bg-raised text-sm"
                onMouseLeave={() => setExportOpen(false)}
              >
                <p className="px-3 pt-2 pb-1 text-xs text-muted">
                  {selection.length > 0
                    ? `${selection.length} ausgewählte Buchungen`
                    : `${filtered.length} Buchungen${filtersActive ? ' laut Filter' : ''}`}
                </p>
                <button className="block w-full px-3 py-1.5 text-left hover:bg-line" onClick={() => runExport('xlsx')}>
                  Als Excel-Datei (.xlsx)
                </button>
                <button className="block w-full px-3 py-1.5 text-left hover:bg-line" onClick={() => runExport('csv')}>
                  Als CSV (.csv)
                </button>
              </div>
            )}
          </div>
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
              ref={searchRef}
              className={`${inputClass} max-w-xs`}
              placeholder="Suchen: Text, 49,99, >100, 10-20"
              title="Strg+F. Beträge: genau (49,99), größer/kleiner (>100, <=20) oder Bereich (10-20)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' && visible.length > 0) {
                  e.preventDefault()
                  focusRow(0)
                }
              }}
            />
            <select
              className={`${inputClass} max-w-56`}
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
            <select
              className={`${inputClass} max-w-40`}
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as TransactionType | '')}
            >
              {typeFilters.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <CategoryFilter value={categoryFilter} onChange={setCategoryFilter} />
            <input
              type="month"
              className={`${inputClass} max-w-44`}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
            {filtersActive && (
              <Button
                small
                variant="ghost"
                onClick={() => {
                  setSearch('')
                  setAccountFilter('')
                  setMonth('')
                  setTypeFilter('')
                  setCategoryFilter('')
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

          {selection.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-y border-accent py-2 text-sm">
              <span className="font-medium">
                {selection.length === 1 ? 'Eine Buchung ausgewählt' : `${selection.length} Buchungen ausgewählt`}
              </span>
              {recategorizeKind ? (
                <div className="w-64">
                  <CategorySelect
                    kind={recategorizeKind}
                    value=""
                    placeholder="Kategorie setzen …"
                    onChange={(id) => void recategorize(id)}
                  />
                </div>
              ) : (
                <span className="text-xs text-muted">
                  Kategorie ändern geht nur bei lauter Ausgaben oder lauter Einnahmen
                </span>
              )}
              <Button small variant="danger" onClick={() => remove(selection.map((t) => t.id))}>
                <Trash2 size={13} /> Löschen
              </Button>
              <Button small variant="ghost" onClick={() => setSelected(new Set(filtered.map((t) => t.id)))}>
                Alle {filtered.length} auswählen
              </Button>
              <Button small variant="ghost" onClick={() => setSelected(new Set())}>
                Auswahl aufheben
              </Button>
            </div>
          )}

          {filtered.length === 0 ? (
            <p className="text-sm text-muted">
              {!filtersActive
                ? 'Noch keine Buchungen. Mit Strg+N legst du die erste an.'
                : 'Keine Buchungen für diese Filter.'}
            </p>
          ) : (
            <ul ref={listRef} className="ledger" onKeyDown={onListKey} aria-label="Buchungen" role="listbox" aria-multiselectable>
              {visible.map((t, index) => {
                const amount = signed(t)
                const isSelected = selected.has(t.id)
                return (
                  <li
                    key={t.id}
                    data-index={index}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={index === Math.min(focusIndex, visible.length - 1) ? 0 : -1}
                    onFocus={() => setFocusIndex(index)}
                    onDoubleClick={() => setForm(t)}
                    className={`group flex items-center gap-4 py-2.5 text-sm outline-none focus-visible:bg-raised ${
                      isSelected ? 'bg-raised/60' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      tabIndex={-1}
                      aria-label={`${title(t)} auswählen`}
                      checked={isSelected}
                      onChange={() => toggle(t.id)}
                      className={`shrink-0 accent-[var(--color-accent)] ${
                        selected.size > 0 ? '' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'
                      }`}
                    />
                    <span className="num w-24 shrink-0 text-muted">{formatDate(t.date)}</span>
                    {t.type === 'transfer' ? (
                      <ArrowLeftRight size={16} strokeWidth={1.75} className="shrink-0 text-muted" />
                    ) : t.splits.length > 0 ? (
                      <Split size={16} strokeWidth={1.75} className="shrink-0 text-muted" />
                    ) : (
                      <CategoryIcon name={iconOf(t.categoryId)} className="shrink-0 text-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 truncate">
                        <span className="truncate">{title(t)}</span>
                        {t.attachments.length > 0 && (
                          <Paperclip
                            size={12}
                            className="shrink-0 text-muted"
                            aria-label={`${t.attachments.length} Beleg(e)`}
                          />
                        )}
                        {t.date > today && (
                          <span className="border border-line px-1.5 py-0.5 text-[10px] text-muted">geplant</span>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted">
                        {[
                          t.type === 'transfer'
                            ? ['Umbuchung', categoryLabel(t.categoryId)].filter(Boolean).join(' · ')
                            : partsLabel(t) || 'Ohne Kategorie',
                          t.type === 'transfer' ? '' : accountName.get(t.accountId),
                          t.note
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                      <Button small variant="ghost" tabIndex={-1} onClick={() => setForm(t)}>
                        Bearbeiten
                      </Button>
                      <Button small variant="ghost" tabIndex={-1} onClick={() => remove([t.id])}>
                        Löschen
                      </Button>
                    </div>
                    <div className="w-28 shrink-0 text-right">
                      <div
                        className={`num ${amount > 0 ? 'text-plus' : amount < 0 ? 'text-text' : 'text-muted'}`}
                      >
                        {amount > 0 ? '+' : ''}
                        {formatCents(amount === 0 ? t.amountCents : amount)}
                      </div>
                      {runningBalance?.has(t.id) && (
                        <div className="num text-[11px] text-muted" title="Kontostand nach dieser Buchung">
                          {formatCents(runningBalance.get(t.id)!)}
                        </div>
                      )}
                    </div>
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
          onClose={() => {
            setForm(null)
            // Nach dem Bearbeiten mit der Tastatur dort weitermachen, wo man war.
            requestAnimationFrame(() => focusRow(focusIndex))
          }}
        />
      )}
    </div>
  )
}

/** Kategorie-Filter: Hauptkategorien umfassen ihre Unterkategorien. */
function CategoryFilter({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const categories = useApp((s) => s.data.categories)
  const roots = categories.filter((c) => c.parentId === null)

  return (
    <select className={`${inputClass} max-w-52`} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Alle Kategorien</option>
      <option value={WITHOUT_CATEGORY}>Ohne Kategorie</option>
      {(['expense', 'income'] as const).map((kind) => (
        <optgroup key={kind} label={kind === 'expense' ? 'Ausgaben' : 'Einnahmen'}>
          {roots
            .filter((r) => r.kind === kind)
            .flatMap((root) => [
              <option key={root.id} value={root.id}>
                {root.name}
                {root.archived ? ' (archiviert)' : ''}
              </option>,
              ...categories
                .filter((c) => c.parentId === root.id)
                .map((child) => (
                  <option key={child.id} value={child.id}>
                    {'   '}
                    {child.name}
                  </option>
                ))
            ])}
        </optgroup>
      ))}
    </select>
  )
}
