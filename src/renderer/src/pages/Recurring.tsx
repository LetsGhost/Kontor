import { Pause, Plus } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { todayIso } from '../../../shared/balance'
import { FALLBACK_ICON } from '../../../shared/defaultCategories'
import { checkDraft, formatDate, isRealDate, type DraftErrors, type TransactionDraft } from '../../../shared/draft'
import { centsToInput, formatCents } from '../../../shared/money'
import { detectPatterns, intervalLabel, monthlyCents, type DetectedPattern } from '../../../shared/recurring'
import type { Recurring as Rule, TransactionType } from '../../../shared/schemas'
import { viewOf } from '../../../shared/scope'
import { CategorySelect, TransferCategoryField } from '../CategorySelect'
import { DueList, useDue } from '../Due'
import { AccountOptions, useArea } from '../area'
import { CategoryIcon } from '../icons'
import { useApp } from '../store'
import { Button, ConfirmRow, Field, Modal, Section, inputClass } from '../ui'

const typeLabels: [TransactionType, string][] = [
  ['expense', 'Ausgabe'],
  ['income', 'Einnahme'],
  ['transfer', 'Umbuchung']
]

export function Recurring() {
  const { accounts, categories, recurring, transactions, dismissedPatterns } = useApp((s) => s.data)
  const saveCollection = useApp((s) => s.saveCollection)
  const putTransactions = useApp((s) => s.putTransactions)
  const [form, setForm] = useState<Rule | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  // Gezeigt wird nur, was den gewählten Bereich betrifft; gespeichert wird immer die ganze Liste.
  const area = useArea()
  const due = useDue(area.ids)
  const today = todayIso()
  const rules = recurring.filter((r) => viewOf(r, area.ids) !== 'outside')

  const patterns = useMemo(
    () =>
      detectPatterns(
        transactions.filter((t) => area.ids.has(t.accountId)),
        recurring,
        dismissedPatterns,
        today
      ),
    [transactions, area.ids, recurring, dismissedPatterns, today]
  )

  const canCreate = area.active.length > 0
  const accountName = (id: string | null): string => accounts.find((a) => a.id === id)?.name ?? '?'
  const iconOf = (categoryId: string | null): string =>
    categories.find((c) => c.id === categoryId)?.icon ?? FALLBACK_ICON

  // Eine Umbuchung in einen anderen Bereich zählt hier wie eine Ausgabe, eine von dort wie eine Einnahme.
  const monthlySum = (view: 'expense' | 'income'): number =>
    rules.filter((r) => r.active && viewOf(r, area.ids) === view).reduce((sum, r) => sum + monthlyCents(r), 0)
  // Was von den festen Einnahmen nach Abzug der festen Ausgaben übrig bleibt.
  const available = monthlySum('income') - monthlySum('expense')

  const accept = async (pattern: DetectedPattern): Promise<void> => {
    const rule: Rule = {
      id: crypto.randomUUID(),
      accountId: pattern.accountId,
      type: pattern.type,
      amountCents: pattern.amountCents,
      payee: pattern.payee,
      note: '',
      categoryId: pattern.categoryId,
      transferAccountId: null,
      interval: pattern.interval,
      startDate: pattern.nextDueDate,
      endDate: null,
      nextDueDate: pattern.nextDueDate,
      active: true
    }
    await saveCollection('recurring', (current) => [...current, rule])
    // Die bisherigen Buchungen gehören zur Regel, damit die Prognose sie nicht doppelt zählt.
    const ids = new Set(pattern.transactionIds)
    await putTransactions(transactions.filter((t) => ids.has(t.id)).map((t) => ({ ...t, recurringId: rule.id })))
  }

  const remove = async (id: string): Promise<void> => {
    await saveCollection('recurring', (current) => current.filter((r) => r.id !== id))
    await putTransactions(transactions.filter((t) => t.recurringId === id).map((t) => ({ ...t, recurringId: null })))
    setConfirmDelete(null)
  }

  const setActive = (rule: Rule, active: boolean): Promise<void> =>
    saveCollection('recurring', (current) => current.map((r) => (r.id === rule.id ? { ...r, active } : r)))

  return (
    <div className="max-w-4xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold">Wiederkehrend</h1>
        <Button variant="primary" disabled={!canCreate} onClick={() => setForm('new')}>
          <Plus size={15} /> Regel anlegen
        </Button>
      </div>

      {rules.length > 0 && (
        <dl className="flex flex-wrap gap-x-10 gap-y-3 text-sm">
          <div>
            <dt className="text-xs text-muted">Feste Ausgaben pro Monat</dt>
            <dd className="num mt-0.5 text-xl">{formatCents(monthlySum('expense'))}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Feste Einnahmen pro Monat</dt>
            <dd className="num mt-0.5 text-xl">{formatCents(monthlySum('income'))}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Verfügbar pro Monat</dt>
            <dd className={`num mt-0.5 text-xl ${available < 0 ? 'text-danger' : ''}`}>{formatCents(available)}</dd>
          </div>
        </dl>
      )}

      {due.length > 0 && (
        <Section title="Fällig">
          <DueList items={due} />
        </Section>
      )}

      {patterns.length > 0 && (
        <Section title="Erkannte Muster in deinen Buchungen">
          <ul className="ledger">
            {patterns.map((p) => (
              <li key={p.key} className="flex items-center gap-4 py-2.5 text-sm">
                <CategoryIcon name={iconOf(p.categoryId)} className="shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{p.payee}</div>
                  <div className="text-xs text-muted">
                    {intervalLabel[p.interval]} · {p.transactionIds.length} Buchungen · nächster Termin{' '}
                    {formatDate(p.nextDueDate)}
                  </div>
                </div>
                <span className="num">{formatCents(p.amountCents)}</span>
                <Button small onClick={() => accept(p)}>
                  Als wiederkehrend anlegen
                </Button>
                <Button
                  small
                  variant="ghost"
                  onClick={() => saveCollection('dismissedPatterns', (current) => [...current, p.key])}
                >
                  Ignorieren
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Regeln">
        {rules.length === 0 ? (
          <p className="text-sm text-muted">
            {canCreate
              ? 'Noch keine Regeln. Lege Miete, Gehalt oder Abos an, dann erinnert dich Kontor an fällige Buchungen.'
              : 'Für wiederkehrende Posten brauchst du zuerst ein Konto.'}
          </p>
        ) : (
          <ul className="ledger">
            {rules.map((rule) => (
              <li key={rule.id} className={`group flex items-center gap-4 py-2.5 text-sm ${rule.active ? '' : 'text-muted'}`}>
                {rule.active ? (
                  <CategoryIcon name={iconOf(rule.categoryId)} className="shrink-0 text-muted" />
                ) : (
                  <Pause size={16} className="shrink-0" aria-label="Pausiert" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate">
                    {rule.type === 'transfer'
                      ? `${accountName(rule.accountId)} → ${accountName(rule.transferAccountId)}`
                      : rule.payee}
                  </div>
                  <div className="truncate text-xs text-muted">
                    {[
                      intervalLabel[rule.interval],
                      rule.type === 'transfer' ? 'Umbuchung' : accountName(rule.accountId),
                      rule.active
                        ? `nächster Termin ${formatDate(rule.nextDueDate)}`
                        : rule.endDate && rule.nextDueDate > rule.endDate
                          ? 'beendet'
                          : 'pausiert',
                      rule.endDate ? `bis ${formatDate(rule.endDate)}` : ''
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                {confirmDelete === rule.id ? (
                  <ConfirmRow
                    question="Regel löschen? Gebuchte Posten bleiben erhalten."
                    confirmLabel="Löschen"
                    onConfirm={() => remove(rule.id)}
                    onCancel={() => setConfirmDelete(null)}
                  />
                ) : (
                  <div className="flex gap-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                    <Button small variant="ghost" onClick={() => setForm(rule)}>
                      Bearbeiten
                    </Button>
                    <Button small variant="ghost" onClick={() => setActive(rule, !rule.active)}>
                      {rule.active ? 'Pausieren' : 'Fortsetzen'}
                    </Button>
                    <Button small variant="ghost" onClick={() => setConfirmDelete(rule.id)}>
                      Löschen
                    </Button>
                  </div>
                )}
                <span
                  className={`num w-28 shrink-0 text-right ${
                    viewOf(rule, area.ids) === 'income' && rule.active ? 'text-plus' : ''
                  }`}
                >
                  {{ income: '+', expense: '−', internal: '', outside: '' }[viewOf(rule, area.ids)]}
                  {formatCents(rule.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {form && <RuleForm editing={form === 'new' ? null : form} onClose={() => setForm(null)} />}
    </div>
  )
}

function RuleForm({ editing, onClose }: { editing: Rule | null; onClose: () => void }) {
  const { accounts, recurring } = useApp((s) => s.data)
  const saveCollection = useApp((s) => s.saveCollection)
  const area = useArea()
  const selectable = accounts.filter(
    (a) => !a.archived || a.id === editing?.accountId || a.id === editing?.transferAccountId
  )
  const [draft, setDraft] = useState<TransactionDraft>({
    type: editing?.type ?? 'expense',
    date: editing?.nextDueDate ?? todayIso(),
    accountId: editing?.accountId ?? area.active[0]?.id ?? '',
    transferAccountId: editing?.transferAccountId ?? '',
    amount: editing ? centsToInput(editing.amountCents) : '',
    payee: editing?.payee ?? '',
    note: editing?.note ?? '',
    categoryId: editing?.categoryId ?? ''
  })
  const [interval, setRhythm] = useState<Rule['interval']>(editing?.interval ?? 'monthly')
  const [endDate, setEndDate] = useState(editing?.endDate ?? '')
  const [errors, setErrors] = useState<DraftErrors & { payee?: string; endDate?: string }>({})

  const update = (patch: Partial<TransactionDraft>): void => setDraft((d) => ({ ...d, ...patch }))
  const isTransfer = draft.type === 'transfer'

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const result = checkDraft(draft, accounts)
    const next: typeof errors = result.ok ? {} : { ...result.errors }
    if (!isTransfer && !draft.payee.trim()) next.payee = 'Bitte einen Namen eingeben'
    if (endDate && (!isRealDate(endDate) || endDate < draft.date)) {
      next.endDate = 'Das Ende muss am oder nach dem nächsten Termin liegen'
    }
    setErrors(next)
    if (!result.ok || Object.keys(next).length > 0) return

    const { date, ...booking } = result.values
    const rule: Rule = {
      ...booking,
      id: editing?.id ?? crypto.randomUUID(),
      interval,
      // Der gewählte Termin ist zugleich der Anker, von dem aus alle weiteren gerechnet werden.
      startDate: date,
      nextDueDate: date,
      endDate: endDate || null,
      active: editing?.active ?? true
    }
    await saveCollection(
      'recurring',
      editing ? recurring.map((r) => (r.id === rule.id ? rule : r)) : [...recurring, rule]
    )
    onClose()
  }

  return (
    <Modal title={editing ? 'Regel bearbeiten' : 'Wiederkehrenden Posten anlegen'} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid grid-cols-3 gap-1 rounded-md border border-line p-1">
          {typeLabels.map(([type, label]) => (
            <button
              key={type}
              type="button"
              onClick={() => update({ type, categoryId: '' })}
              className={`rounded-sm px-3 py-1.5 text-sm ${
                draft.type === type ? 'bg-raised text-text' : 'text-muted hover:text-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {!isTransfer && (
          <Field label={draft.type === 'income' ? 'Von wem' : 'Empfänger'} error={errors.payee}>
            <input autoFocus className={inputClass} value={draft.payee} onChange={(e) => update({ payee: e.target.value })} />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Betrag in €" error={errors.amount}>
            <input
              className={`${inputClass} num`}
              inputMode="decimal"
              placeholder="0,00"
              value={draft.amount}
              onChange={(e) => update({ amount: e.target.value })}
            />
          </Field>
          <Field label="Rhythmus">
            <select className={inputClass} value={interval} onChange={(e) => setRhythm(e.target.value as Rule['interval'])}>
              {Object.entries(intervalLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Nächster Termin" error={errors.date}>
            <input type="date" className={inputClass} value={draft.date} onChange={(e) => update({ date: e.target.value })} />
          </Field>
          <Field label="Endet am (optional)" error={errors.endDate}>
            <input type="date" className={inputClass} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>

        {!isTransfer && (
          <Field label="Kategorie">
            <CategorySelect
              kind={draft.type === 'income' ? 'income' : 'expense'}
              value={draft.categoryId}
              onChange={(categoryId) => update({ categoryId })}
            />
          </Field>
        )}

        <div className={isTransfer ? 'grid grid-cols-2 gap-4' : ''}>
          <Field label={isTransfer ? 'Von Konto' : 'Konto'} error={errors.accountId}>
            <select className={inputClass} value={draft.accountId} onChange={(e) => update({ accountId: e.target.value })}>
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

        <p className="text-xs text-muted">
          Am Termin erscheint der Posten als Vorschlag. Gebucht wird erst, wenn du ihn bestätigst; den Betrag kannst
          du dabei anpassen.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button variant="primary" type="submit">
            Speichern
          </Button>
        </div>
      </form>
    </Modal>
  )
}
