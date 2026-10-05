import { Split, X } from 'lucide-react'
import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { todayIso } from '../../shared/balance'
import {
  checkDraft,
  checkSplits,
  splitRemainder,
  type DraftErrors,
  type SplitDraft,
  type TransactionDraft
} from '../../shared/draft'
import { centsToInput, formatCents, parseAmount } from '../../shared/money'
import type { Transaction, TransactionType } from '../../shared/schemas'
import {
  frequentCategories,
  payeeCompletions,
  suggestCategories,
  suggestCategory,
  type PayeeCompletion
} from '../../shared/suggest'
import { CategorySelect, TransferCategoryField } from './CategorySelect'
import { AccountOptions } from './area'
import { AttachmentField } from './attachments'
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
  // null = nicht aufgeteilt. Eine Aufteilung verteilt den Betrag auf mehrere Kategorien.
  const [splits, setSplits] = useState<SplitDraft[] | null>(() =>
    editing && editing.splits.length > 0
      ? editing.splits.map((s) => ({ categoryId: s.categoryId ?? '', amount: centsToInput(s.amountCents), note: s.note }))
      : null
  )
  const [splitError, setSplitError] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<string[]>(editing?.attachments ?? [])
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
  const amountCents = parseAmount(draft.amount)
  const knownAmount = amountCents !== null && amountCents > 0 ? amountCents : null

  const completions = useMemo(
    () => (listOpen ? payeeCompletions(draft.payee, draft.type, transactions) : []),
    [listOpen, draft.payee, draft.type, transactions]
  )

  // Schnellwahl unter dem Kategorie-Feld: erst was zum Empfänger passt, dann was zuletzt oft benutzt wurde.
  const suggestions = useMemo(() => {
    const today = todayIso()
    return [
      ...new Set([
        ...suggestCategories(draft.payee, draft.type, transactions, categories, today, 3, knownAmount),
        ...frequentCategories(draft.type, transactions, categories, today)
      ])
    ].slice(0, 3)
  }, [draft.payee, draft.type, transactions, categories, knownAmount])

  // Der Betrag fließt mit ein: Bei Amazon sind 7,99 € eher das Abo, 45 € eher der Haushalt.
  const suggestionFor = (payee: string, amount: number | null = knownAmount): string =>
    suggestCategory(payee, draft.type, transactions, categories, todayIso(), amount) ?? ''

  const setType = (type: TransactionType): void => {
    // Eine Ausgaben-Kategorie passt nicht zu einer Einnahme und umgekehrt.
    update({ type, categoryId: '' })
    setCategoryTouched(false)
    setSplits(null)
  }

  const changePayee = (payee: string): void => {
    update(categoryTouched ? { payee } : { payee, categoryId: suggestionFor(payee) })
    setListOpen(true)
    setHighlight(-1)
  }

  const changeAmount = (amount: string): void => {
    if (categoryTouched || splits) {
      update({ amount })
      return
    }
    const cents = parseAmount(amount)
    update({ amount, categoryId: suggestionFor(draft.payee, cents !== null && cents > 0 ? cents : null) })
  }

  const accept = (completion: PayeeCompletion): void => {
    update({
      payee: completion.payee,
      amount: draft.amount || centsToInput(completion.amountCents),
      ...(categoryTouched
        ? {}
        : { categoryId: suggestionFor(completion.payee, knownAmount ?? completion.amountCents) })
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

  const startSplit = (): void => {
    setSplits([
      { categoryId: draft.categoryId, amount: draft.amount, note: '' },
      { categoryId: '', amount: '', note: '' }
    ])
    setCategoryTouched(true)
  }

  const updateSplit = (index: number, patch: Partial<SplitDraft>): void => {
    setSplitError(null)
    setSplits((list) => list && list.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  const endSplit = (categoryId: string): void => {
    update({ categoryId })
    setSplits(null)
    setSplitError(null)
  }

  const removeSplit = (index: number): void => {
    if (!splits) return
    const rest = splits.filter((_, i) => i !== index)
    // Bleibt nur ein Teil übrig, ist die Buchung nicht mehr aufgeteilt; seine Kategorie gilt dann für alles.
    if (rest.length < 2) endSplit(rest[0]?.categoryId ?? '')
    else {
      setSplits(rest)
      setSplitError(null)
    }
  }

  const remainder = splits && knownAmount !== null ? splitRemainder(splits, knownAmount) : 0

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const result = checkDraft(draft, accounts)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    setSaveError(null)

    const split = splits && !isTransfer ? checkSplits(splits, result.values.amountCents) : null
    if (split && !split.ok) {
      setSplitError(split.error)
      return
    }
    setSplitError(null)

    try {
      await putTransactions([
        {
          ...(editing ?? {
            id: crypto.randomUUID(),
            recurringId: null,
            importHash: null,
            createdAt: new Date().toISOString()
          }),
          ...result.values,
          ...(split?.ok ? { categoryId: null, splits: split.splits } : { splits: [] }),
          attachments
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
    setSplits(null)
    setAttachments([])
    setSavedCount((n) => n + 1)
    ;(isTransfer ? amountRef : payeeRef).current?.focus()
  }

  return (
    <Modal title={editing ? 'Buchung bearbeiten' : 'Neue Buchung'} onClose={onClose} wide={splits !== null}>
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
              onChange={(e) => changeAmount(e.target.value)}
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

        {!isTransfer && !splits && (
          <div className="space-y-1">
            <Field label="Kategorie">
              <CategorySelect
                creatable
                kind={draft.type === 'income' ? 'income' : 'expense'}
                value={draft.categoryId}
                suggestions={suggestions}
                onChange={(categoryId) => {
                  update({ categoryId })
                  setCategoryTouched(true)
                }}
              />
            </Field>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-accent">
                {!categoryTouched && draft.categoryId !== '' && 'Vorschlag aus früheren Buchungen'}
              </span>
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted hover:text-text"
                onClick={startSplit}
              >
                <Split size={12} /> Auf mehrere Kategorien aufteilen
              </button>
            </div>
          </div>
        )}

        {!isTransfer && splits && (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between text-xs text-muted">
              <span>Aufteilung</span>
              {knownAmount !== null && (
                <span className={`num ${remainder === 0 ? '' : 'text-warn'}`}>
                  {remainder === 0
                    ? 'vollständig verteilt'
                    : remainder > 0
                      ? `noch ${formatCents(remainder)} zu verteilen`
                      : `${formatCents(-remainder)} zu viel`}
                </span>
              )}
            </div>
            <ul className="space-y-2">
              {splits.map((part, i) => (
                <li key={i} className="grid grid-cols-[minmax(0,1fr)_6.5rem_minmax(0,0.8fr)_auto] items-start gap-2">
                  <CategorySelect
                    creatable
                    kind={draft.type === 'income' ? 'income' : 'expense'}
                    value={part.categoryId}
                    onChange={(categoryId) => updateSplit(i, { categoryId })}
                  />
                  <input
                    aria-label={`Betrag Teil ${i + 1}`}
                    className={`${inputClass} num text-right`}
                    inputMode="decimal"
                    placeholder="0,00"
                    value={part.amount}
                    onChange={(e) => updateSplit(i, { amount: e.target.value })}
                    onFocus={() => {
                      // Ein leerer Teil bekommt beim Betreten den noch offenen Rest vorgeschlagen.
                      if (part.amount === '' && remainder > 0) updateSplit(i, { amount: centsToInput(remainder) })
                    }}
                  />
                  <input
                    aria-label={`Notiz Teil ${i + 1}`}
                    className={inputClass}
                    placeholder="Notiz"
                    value={part.note}
                    onChange={(e) => updateSplit(i, { note: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    aria-label={`Teil ${i + 1} entfernen`}
                    className="mt-0.5"
                    onClick={() => removeSplit(i)}
                  >
                    <X size={14} />
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button
                small
                onClick={() =>
                  setSplits([...splits, { categoryId: '', amount: remainder > 0 ? centsToInput(remainder) : '', note: '' }])
                }
              >
                Teil hinzufügen
              </Button>
              <Button small variant="ghost" onClick={() => endSplit(splits[0]?.categoryId ?? '')}>
                Aufteilung aufheben
              </Button>
            </div>
            {splitError && <p className="text-xs text-danger">{splitError}</p>}
          </div>
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
            creatable
            accountId={draft.accountId}
            transferAccountId={draft.transferAccountId}
            value={draft.categoryId}
            onChange={(categoryId) => update({ categoryId })}
          />
        )}

        <Field label="Notiz">
          <input className={inputClass} value={draft.note} onChange={(e) => update({ note: e.target.value })} />
        </Field>

        <div className="space-y-1">
          <span className="text-xs text-muted">Belege</span>
          <AttachmentField value={attachments} onChange={setAttachments} />
        </div>

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
