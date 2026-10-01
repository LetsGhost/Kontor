import { Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { accountBalance, todayIso } from '../../../shared/balance'
import { formatDate, isRealDate } from '../../../shared/draft'
import { centsToInput, formatCents, parseAmount } from '../../../shared/money'
import type { Account, Area } from '../../../shared/schemas'
import { useArea } from '../area'
import { useApp } from '../store'
import { Button, ConfirmRow, Field, Modal, Section, inputClass } from '../ui'

export const accountTypeLabel: Record<Account['type'], string> = {
  giro: 'Girokonto',
  savings: 'Sparkonto'
}

export function Accounts() {
  const { areas, accounts, transactions, recurring, budgets } = useApp((s) => s.data)
  const saveCollection = useApp((s) => s.saveCollection)
  const [editing, setEditing] = useState<Account | 'new' | null>(null)
  const [areaForm, setAreaForm] = useState<Area | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const today = todayIso()

  const inUse = (id: string): boolean =>
    transactions.some((t) => t.accountId === id || t.transferAccountId === id) ||
    recurring.some((r) => r.accountId === id || r.transferAccountId === id)

  const setArchived = (account: Account, archived: boolean): Promise<void> =>
    saveCollection(
      'accounts',
      accounts.map((a) => (a.id === account.id ? { ...a, archived } : a))
    )

  const remove = async (id: string): Promise<void> => {
    await saveCollection(
      'accounts',
      accounts.filter((a) => a.id !== id)
    )
    setConfirmDelete(null)
  }

  const row = (account: Account) => (
    <li key={account.id} className="group flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="truncate">{account.name}</div>
        <div className="text-xs text-muted">
          {accountTypeLabel[account.type]} · Start {formatDate(account.openingDate)} mit{' '}
          {formatCents(account.openingBalanceCents)}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="num order-last w-36 text-right text-lg">
          {formatCents(accountBalance(account, transactions, today))}
        </span>
        {confirmDelete === account.id ? (
          <ConfirmRow
            question="Konto endgültig löschen?"
            confirmLabel="Löschen"
            onConfirm={() => remove(account.id)}
            onCancel={() => setConfirmDelete(null)}
          />
        ) : (
          <>
            <Button small variant="ghost" onClick={() => setEditing(account)}>
              Bearbeiten
            </Button>
            {account.archived ? (
              <Button small variant="ghost" onClick={() => setArchived(account, false)}>
                Reaktivieren
              </Button>
            ) : inUse(account.id) ? (
              <Button small variant="ghost" onClick={() => setArchived(account, true)}>
                Archivieren
              </Button>
            ) : (
              <Button small variant="ghost" onClick={() => setConfirmDelete(account.id)}>
                Löschen
              </Button>
            )}
          </>
        )}
      </div>
    </li>
  )

  const archived = accounts.filter((a) => a.archived)

  const removeArea = async (id: string): Promise<void> => {
    await saveCollection(
      'budgets',
      budgets.filter((b) => b.areaId !== id)
    )
    await saveCollection(
      'areas',
      areas.filter((a) => a.id !== id)
    )
    setConfirmDelete(null)
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold">Konten</h1>
        <div className="flex gap-2">
          <Button onClick={() => setAreaForm('new')}>
            <Plus size={15} /> Bereich
          </Button>
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus size={15} /> Konto anlegen
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted">
        Ein Bereich fasst Konten zusammen, die gemeinsam ausgewertet werden. Konten verschiedener Bereiche werden nie
        zusammengerechnet; eine Umbuchung zwischen Bereichen zählt beim einen als Ausgabe, beim anderen als Einnahme.
      </p>

      {areas.map((area) => {
        const inArea = accounts.filter((a) => a.areaId === area.id && !a.archived)
        const hasAccounts = accounts.some((a) => a.areaId === area.id)
        const total = inArea.reduce((sum, a) => sum + accountBalance(a, transactions, today), 0)
        return (
          <Section
            key={area.id}
            title={area.name}
            aside={
              confirmDelete === area.id ? (
                <ConfirmRow
                  question="Bereich löschen? Seine Budgets gehen verloren."
                  confirmLabel="Löschen"
                  onConfirm={() => removeArea(area.id)}
                  onCancel={() => setConfirmDelete(null)}
                />
              ) : (
                <div className="flex items-center gap-1">
                  <Button small variant="ghost" onClick={() => setAreaForm(area)}>
                    Umbenennen
                  </Button>
                  <Button
                    small
                    variant="ghost"
                    disabled={hasAccounts || areas.length < 2}
                    title={
                      hasAccounts
                        ? 'Zuerst die Konten verschieben oder löschen'
                        : areas.length < 2
                          ? 'Mindestens ein Bereich muss bleiben'
                          : undefined
                    }
                    onClick={() => setConfirmDelete(area.id)}
                  >
                    Löschen
                  </Button>
                  {inArea.length > 1 && <span className="num ml-3 w-36 text-right text-sm">{formatCents(total)}</span>}
                </div>
              )
            }
          >
            {inArea.length === 0 ? (
              <p className="border-y border-line py-3 text-sm text-muted">
                Noch kein Konto in diesem Bereich. Lege eines mit dem aktuellen Kontostand als Startsaldo an.
              </p>
            ) : (
              <ul className="ledger">{inArea.map(row)}</ul>
            )}
          </Section>
        )
      })}

      {archived.length > 0 && (
        <Section title="Archiviert">
          <ul className="ledger opacity-60">{archived.map(row)}</ul>
        </Section>
      )}

      {editing && <AccountForm editing={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {areaForm && <AreaForm editing={areaForm === 'new' ? null : areaForm} onClose={() => setAreaForm(null)} />}
    </div>
  )
}

function AreaForm({ editing, onClose }: { editing: Area | null; onClose: () => void }) {
  const areas = useApp((s) => s.data.areas)
  const saveCollection = useApp((s) => s.saveCollection)
  const setArea = useApp((s) => s.setArea)
  const [name, setName] = useState(editing?.name ?? '')
  const [error, setError] = useState<string | undefined>()

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setError('Bitte einen Namen eingeben')
    if (areas.some((a) => a.id !== editing?.id && a.name.toLowerCase() === trimmed.toLowerCase())) {
      return setError('Einen Bereich mit diesem Namen gibt es schon')
    }
    const area: Area = { id: editing?.id ?? crypto.randomUUID(), name: trimmed }
    await saveCollection('areas', editing ? areas.map((a) => (a.id === area.id ? area : a)) : [...areas, area])
    // Ein neuer Bereich ist leer; direkt dorthin wechseln, damit das erste Konto dort landet.
    if (!editing) setArea(area.id)
    onClose()
  }

  return (
    <Modal title={editing ? 'Bereich umbenennen' : 'Bereich anlegen'} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Name, z. B. Haushalt" error={error}>
          <input autoFocus className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
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

function AccountForm({ editing, onClose }: { editing: Account | null; onClose: () => void }) {
  const { areas, accounts, transactions } = useApp((s) => s.data)
  const saveCollection = useApp((s) => s.saveCollection)
  const current = useArea()
  const [areaId, setAreaId] = useState(editing?.areaId ?? current.area.id)
  const [name, setName] = useState(editing?.name ?? '')
  const [type, setType] = useState<Account['type']>(editing?.type ?? 'giro')
  const [balance, setBalance] = useState(editing ? centsToInput(editing.openingBalanceCents) : '')
  const [openingDate, setOpeningDate] = useState(editing?.openingDate ?? todayIso())
  const [errors, setErrors] = useState<{ name?: string; balance?: string; openingDate?: string }>({})

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const next: typeof errors = {}
    const trimmed = name.trim()
    const openingBalanceCents = parseAmount(balance)

    if (!trimmed) next.name = 'Bitte einen Namen eingeben'
    else if (accounts.some((a) => a.id !== editing?.id && a.name.toLowerCase() === trimmed.toLowerCase())) {
      next.name = 'Ein Konto mit diesem Namen gibt es schon'
    }
    if (openingBalanceCents === null) next.balance = 'Bitte einen Betrag eingeben, z. B. 1.234,56'
    if (!isRealDate(openingDate)) next.openingDate = 'Bitte ein gültiges Datum eingeben'
    else if (
      editing &&
      transactions.some(
        (t) => (t.accountId === editing.id || t.transferAccountId === editing.id) && t.date < openingDate
      )
    ) {
      next.openingDate = 'Es gibt bereits Buchungen vor diesem Datum'
    }

    setErrors(next)
    if (Object.keys(next).length > 0) return

    const account: Account = {
      id: editing?.id ?? crypto.randomUUID(),
      areaId,
      name: trimmed,
      type,
      openingBalanceCents: openingBalanceCents!,
      openingDate,
      archived: editing?.archived ?? false
    }
    await saveCollection(
      'accounts',
      editing ? accounts.map((a) => (a.id === account.id ? account : a)) : [...accounts, account]
    )
    onClose()
  }

  return (
    <Modal title={editing ? 'Konto bearbeiten' : 'Konto anlegen'} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Name" error={errors.name}>
          <input autoFocus className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Art">
            <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as Account['type'])}>
              <option value="giro">{accountTypeLabel.giro}</option>
              <option value="savings">{accountTypeLabel.savings}</option>
            </select>
          </Field>
          <Field label="Bereich">
            <select className={inputClass} value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Startsaldo in €" error={errors.balance}>
            <input
              className={`${inputClass} num`}
              inputMode="decimal"
              placeholder="0,00"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
            />
          </Field>
          <Field label="Startdatum" error={errors.openingDate}>
            <input
              type="date"
              className={inputClass}
              value={openingDate}
              onChange={(e) => setOpeningDate(e.target.value)}
            />
          </Field>
        </div>
        <p className="text-xs text-muted">
          Der Startsaldo ist der Kontostand am Startdatum. Buchungen können erst ab diesem Tag erfasst werden.
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
