import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { todayIso } from '../../shared/balance'
import { checkDraft, type DraftErrors, type TransactionDraft } from '../../shared/draft'
import { centsToInput, formatCents } from '../../shared/money'
import type { Transaction, TransactionType } from '../../shared/schemas'
import { payeeCompletions, suggestCategory, type PayeeCompletion } from '../../shared/suggest'
import { CategorySelect, TransferCategoryField } from './CategorySelect'
import { AccountOptions } from './area'
import { useApp } from './store'
import { Button, Field, Modal, inputClass } from './ui'

const typeLabels: [TransactionType, string][] = [
  ['expense', 'Ausgabe'],
  ['income', 'Einnahme'],
  ['transfer', 'Umbuchung']
]

export function TransactionForm({
  editing,
  defaultAccountId,
  onClose
}: {
  editing: Transaction | null
  defaultAccountId: string
  onClose: () => void
}) {
  const { accounts, categories, transactions } = useApp((s) => s.data)
  const putTransactions = useApp((s) => s.putTransactions)
  const amountRef = useRef<HTMLInputElement>(null)
  const payeeRef = useRef<HTMLInputElement>(null)
  const [errors, setErrors] = useState<DraftErrors>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedCount, setSavedCount] = useState(0)
  // Solange die Kategorie nicht von Hand gewählt wurde, folgt sie dem Vorschlag zum Empfänger.
  const [categoryTouched, setCategoryTouched] = useState(editing !== null)
  const [listOpen, setListOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [draft, setDraft] = useState<TransactionDraft>(() =>
    editing
      ? {
          type: editing.type,
          date: editing.date,
          accountId: editing.accountId,
          transferAccountId: editing.transferAccountId ?? '',
          amount: centsToInput(editing.amountCents),
          payee: editing.payee,
          note: editing.note,
          categoryId: editing.categoryId ?? ''
        }
      : {
          type: 'expense',
          date: todayIso(),
          accountId: defaultAccountId,
          transferAccountId: '',
          amount: '',
          payee: '',
          note: '',
          categoryId: ''
        }
  )

  const update = (patch: Partial<TransactionDraft>): void => setDraft((d) => ({ ...d, ...patch }))

  // Archivierte Konten nur anbieten, wenn die bearbeitete Buchung schon daran hängt.
  const selectable = accounts.filter(
    (a) => !a.archived || a.id === editing?.accountId || a.id === editing?.transferAccountId
  )
  const isTransfer = draft.type === 'transfer'

  const completions = useMemo(
    () => (listOpen ? payeeCompletions(draft.payee, draft.type, transactions) : []),
    [listOpen, draft.payee, draft.type, transactions]
  )

  const suggestionFor = (payee: string): string =>
    suggestCategory(payee, draft.type, transactions, categories, todayIso()) ?? ''

  const setType = (type: TransactionType): void => {
    // Eine Ausgaben-Kategorie passt nicht zu einer Einnahme und umgekehrt.
    update({ type, categoryId: '' })
    setCategoryTouched(false)
  }

  const changePayee = (payee: string): void => {
    update(categoryTouched ? { payee } : { payee, categoryId: suggestionFor(payee) })
    setListOpen(true)
    setHighlight(-1)
  }

  const accept = (completion: PayeeCompletion): void => {
    update({
      payee: completion.payee,
      amount: draft.amount || centsToInput(completion.amountCents),
      ...(categoryTouched ? {} : { categoryId: suggestionFor(completion.payee) })
    })
    setListOpen(false)
    amountRef.current?.focus()
    amountRef.current?.select()
  }

  const onPayeeKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (completions.length === 0) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setHighlight((h) => (h + step + completions.length) % completions.length)
    } else if (e.key === 'Enter' && highlight >= 0) {
      e.preventDefault()
      accept(completions[highlight])
    } else if (e.key === 'Escape') {
      // Escape schließt zuerst nur die Vorschlagsliste, nicht das ganze Formular.
      e.nativeEvent.stopPropagation()
      setListOpen(false)
    }
  }

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const result = checkDraft(draft, accounts)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    setSaveError(null)

    try {
      await putTransactions([
        {
          ...(editing ?? {
            id: crypto.randomUUID(),
            recurringId: null,
            importHash: null,
            createdAt: new Date().toISOString()
          }),
          ...result.values
        }
      ])
    } catch (err) {
      setSaveError((err as Error).message)
      return
    }

    if (editing) {
      onClose()
      return
    }
    // Schnellerfassung: Art, Konto und Datum bleiben für die nächste Buchung stehen.
    update({ amount: '', payee: '', note: '', categoryId: '' })
    setCategoryTouched(false)
    setSavedCount((n) => n + 1)
    ;(isTransfer ? amountRef : payeeRef).current?.focus()
  }

  return (
    <Modal title={editing ? 'Buchung bearbeiten' : 'Neue Buchung'} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid grid-cols-3 gap-1 rounded-md border border-line p-1">
          {typeLabels.map(([type, label]) => (
            <button
              key={type}
              type="button"
              onClick={() => setType(type)}
              className={`rounded-sm px-3 py-1.5 text-sm ${
                draft.type === type ? 'bg-raised text-text' : 'text-muted hover:text-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {!isTransfer && (
          <Field label={draft.type === 'income' ? 'Von wem' : 'Empfänger'}>
            <div className="relative">
              <input
                ref={payeeRef}
                autoFocus
                className={inputClass}
                value={draft.payee}
                onChange={(e) => changePayee(e.target.value)}
                onKeyDown={onPayeeKey}
                onBlur={() => setListOpen(false)}
              />
              {completions.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-line bg-raised">
                  {completions.map((c, i) => (
                    <li
                      key={c.payee}
                      // mousedown statt click, damit das Feld den Fokus nicht vorher verliert
                      onMouseDown={(e) => {
                        e.preventDefault()
                        accept(c)
                      }}
                      onMouseEnter={() => setHighlight(i)}
                      className={`flex cursor-pointer justify-between gap-4 px-3 py-1.5 text-sm ${
                        i === highlight ? 'bg-line' : ''
                      }`}
                    >
                      <span className="truncate">{c.payee}</span>
                      <span className="num shrink-0 text-muted">zuletzt {formatCents(c.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Betrag in €" error={errors.amount}>
            <input
              ref={amountRef}
              autoFocus={isTransfer}
              className={`${inputClass} num`}
              inputMode="decimal"
              placeholder="0,00"
              value={draft.amount}
              onChange={(e) => update({ amount: e.target.value })}
            />
          </Field>
          <Field label="Datum" error={errors.date}>
            <input
              type="date"
              className={inputClass}
              value={draft.date}
              onChange={(e) => update({ date: e.target.value })}
            />
          </Field>
        </div>

        {!isTransfer && (
          <Field label="Kategorie">
            <CategorySelect
              kind={draft.type === 'income' ? 'income' : 'expense'}
              value={draft.categoryId}
              onChange={(categoryId) => {
                update({ categoryId })
                setCategoryTouched(true)
              }}
            />
            {!categoryTouched && draft.categoryId !== '' && (
              <span className="block text-xs text-accent">Vorschlag aus früheren Buchungen</span>
            )}
          </Field>
        )}

        <div className={isTransfer ? 'grid grid-cols-2 gap-4' : ''}>
          <Field label={isTransfer ? 'Von Konto' : 'Konto'} error={errors.accountId}>
            <select
              className={inputClass}
              value={draft.accountId}
              onChange={(e) => update({ accountId: e.target.value })}
            >
              <AccountOptions accounts={selectable} />
            </select>
          </Field>
          {isTransfer && (
            <Field label="Auf Konto" error={errors.transferAccountId}>
              <select
                className={inputClass}
                value={draft.transferAccountId}
                onChange={(e) => update({ transferAccountId: e.target.value })}
              >
                <option value="">Bitte wählen</option>
                <AccountOptions accounts={selectable.filter((a) => a.id !== draft.accountId)} />
              </select>
            </Field>
          )}
        </div>

        {isTransfer && (
          <TransferCategoryField
            accountId={draft.accountId}
            transferAccountId={draft.transferAccountId}
            value={draft.categoryId}
            onChange={(categoryId) => update({ categoryId })}
          />
        )}

        <Field label="Notiz">
          <input className={inputClass} value={draft.note} onChange={(e) => update({ note: e.target.value })} />
        </Field>

        {saveError && <p className="text-sm text-danger">Speichern fehlgeschlagen: {saveError}</p>}

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">
            {savedCount > 0 && `${savedCount} ${savedCount === 1 ? 'Buchung' : 'Buchungen'} gespeichert`}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {savedCount > 0 ? 'Fertig' : 'Abbrechen'}
            </Button>
            <Button variant="primary" type="submit">
              {editing ? 'Speichern' : 'Buchen'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
