import { Plus } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { todayIso } from '../../../shared/balance'
import { debtTotals, debtsByPerson, type PersonDebts } from '../../../shared/debts'
import { formatDate, isRealDate } from '../../../shared/draft'
import { formatCents, parseAmount } from '../../../shared/money'
import type { Debt, Person } from '../../../shared/schemas'
import { useApp } from '../store'
import { Button, ConfirmRow, Field, Modal, Section, inputClass } from '../ui'

const balanceText = (cents: number): string =>
  cents > 0 ? `schuldet dir ${formatCents(cents)}` : cents < 0 ? `du schuldest ${formatCents(-cents)}` : 'ausgeglichen'

export function Debts() {
  const { persons, debts, transactions } = useApp((s) => s.data)
  const saveCollection = useApp((s) => s.saveCollection)
  const showNotice = useApp((s) => s.showNotice)
  const today = todayIso()
  const [personForm, setPersonForm] = useState<Person | 'new' | null>(null)
  const [debtForm, setDebtForm] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const rows = useMemo(() => debtsByPerson(persons, debts, transactions), [persons, debts, transactions])
  const totals = debtTotals(rows)
  // Archivierte mit offenem Saldo bleiben sichtbar, sonst geriete die Schuld in Vergessenheit.
  const visible = rows
    .filter((r) => showArchived || !r.person.archived || r.balanceCents !== 0)
    .sort((a, b) => Math.abs(b.balanceCents) - Math.abs(a.balanceCents) || a.person.name.localeCompare(b.person.name))

  const removeEntry = async (entry: Debt): Promise<void> => {
    await saveCollection('debts', (current) => current.filter((d) => d.id !== entry.id))
    showNotice('Eintrag gelöscht', () => saveCollection('debts', (current) => [...current, entry]))
  }

  return (
    <div className="max-w-4xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Schulden</h1>
        <div className="flex gap-2">
          <Button onClick={() => setPersonForm('new')}>
            <Plus size={15} /> Person
          </Button>
          <Button variant="primary" disabled={persons.length === 0} onClick={() => setDebtForm('')}>
            <Plus size={15} /> Schuld eintragen
          </Button>
        </div>
      </div>

      {persons.length === 0 ? (
        <p className="max-w-2xl text-sm text-muted">
          Lege eine Person an, bei der du Schulden hast oder die dir etwas schuldet. Schulden entstehen auf zwei Wegen:
          als Eintrag hier (etwa wenn jemand bar für dich gezahlt hat) oder als Buchung mit „Schuld mit Person“. Geld,
          das du einer Person gibst, erhöht ihre Schuld bei dir; Geld von ihr senkt sie. Solche Buchungen zählen nicht
          als Ausgabe oder Einnahme. Beim CSV-Import schlägt Kontor Rückzahlungen anhand der Erkennungsnamen vor.
        </p>
      ) : (
        <>
          <dl className="flex flex-wrap gap-x-10 gap-y-3 border-b border-line pb-5">
            <div>
              <dt className="text-xs text-muted">Dir geschuldet</dt>
              <dd className="num mt-0.5 text-2xl">{formatCents(totals.owedToMeCents)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Du schuldest</dt>
              <dd className="num mt-0.5 text-2xl">{formatCents(totals.iOweCents)}</dd>
            </div>
          </dl>

          <Section
            title="Personen"
            aside={
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                Archivierte zeigen
              </label>
            }
          >
            <ul className="ledger">
              {visible.map((r) => (
                <PersonRow
                  key={r.person.id}
                  row={r}
                  today={today}
                  expanded={open === r.person.id}
                  onToggle={() => setOpen(open === r.person.id ? null : r.person.id)}
                  onEdit={() => setPersonForm(r.person)}
                  onAddDebt={() => setDebtForm(r.person.id)}
                  onRemoveEntry={(id) => {
                    const entry = debts.find((d) => d.id === id)
                    if (entry) void removeEntry(entry)
                  }}
                />
              ))}
            </ul>
          </Section>
        </>
      )}

      {personForm && (
        <PersonForm editing={personForm === 'new' ? null : personForm} onClose={() => setPersonForm(null)} />
      )}
      {debtForm !== null && <DebtForm personId={debtForm} onClose={() => setDebtForm(null)} />}
    </div>
  )
}

function PersonRow({
  row,
  today,
  expanded,
  onToggle,
  onEdit,
  onAddDebt,
  onRemoveEntry
}: {
  row: PersonDebts
  today: string
  expanded: boolean
  onToggle: () => void
  onEdit: () => void
  onAddDebt: () => void
  onRemoveEntry: (id: string) => void
}) {
  const { person, balanceCents, events } = row
  const overdue = balanceCents !== 0 && person.dueDate !== null && person.dueDate <= today

  return (
    <li className="py-2.5 text-sm">
      <div className="group flex items-center gap-4">
        <button className="min-w-0 flex-1 truncate text-left" aria-expanded={expanded} onClick={onToggle}>
          {person.name}
          {person.archived && <span className="ml-2 text-xs text-muted">archiviert</span>}
          {person.dueDate && balanceCents !== 0 && (
            <span className={`ml-2 text-xs ${overdue ? 'text-danger' : 'text-muted'}`}>
              fällig {formatDate(person.dueDate)}
            </span>
          )}
        </button>
        <div className="flex gap-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          <Button small variant="ghost" onClick={onAddDebt}>
            Schuld eintragen
          </Button>
          <Button small variant="ghost" onClick={onEdit}>
            Bearbeiten
          </Button>
        </div>
        <span
          className={`num w-44 shrink-0 text-right ${balanceCents > 0 ? 'text-plus' : balanceCents < 0 ? '' : 'text-muted'}`}
        >
          {balanceText(balanceCents)}
        </span>
      </div>

      {expanded && (
        <ul className="mt-2 space-y-1 border-l border-line pl-4">
          {events.length === 0 && <li className="text-xs text-muted">Noch keine Schulden oder Zahlungen.</li>}
          {events.map((e) => (
            <li key={e.id} className="group/entry flex items-center gap-4 text-xs">
              <span className="num w-20 shrink-0 text-muted">{formatDate(e.date)}</span>
              <span className="min-w-0 flex-1 truncate">
                {e.source === 'entry'
                  ? e.signedCents > 0
                    ? 'Schuldet dir'
                    : 'Du schuldest'
                  : e.signedCents > 0
                    ? 'Geld gegeben'
                    : 'Geld erhalten'}
                {e.label && <span className="text-muted"> · {e.label}</span>}
              </span>
              {e.source === 'entry' && (
                <Button
                  small
                  variant="ghost"
                  className="opacity-0 group-hover/entry:opacity-100 focus:opacity-100"
                  onClick={() => onRemoveEntry(e.id)}
                >
                  Löschen
                </Button>
              )}
              <span className="w-28 shrink-0 text-right text-muted">
                {e.openCents === 0 ? 'erledigt' : `offen ${formatCents(Math.abs(e.openCents))}`}
              </span>
              <span className="num w-24 shrink-0 text-right">
                {e.signedCents > 0 ? '+' : '−'}
                {formatCents(Math.abs(e.signedCents))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function PersonForm({ editing, onClose }: { editing: Person | null; onClose: () => void }) {
  const { persons, debts, transactions } = useApp((s) => s.data)
  const saveCollection = useApp((s) => s.saveCollection)
  const [name, setName] = useState(editing?.name ?? '')
  const [aliases, setAliases] = useState(editing?.aliases.join(', ') ?? '')
  const [dueDate, setDueDate] = useState(editing?.dueDate ?? '')
  const [archived, setArchived] = useState(editing?.archived ?? false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const linked =
    editing !== null &&
    (debts.some((d) => d.personId === editing.id) || transactions.some((t) => t.personId === editing.id))

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setError('Bitte einen Namen eingeben')
    if (persons.some((p) => p.id !== editing?.id && p.name.toLowerCase() === trimmed.toLowerCase())) {
      return setError('Diese Person gibt es schon')
    }
    if (dueDate && !isRealDate(dueDate)) return setError('Bitte ein gültiges Fälligkeitsdatum eingeben')
    const person: Person = {
      id: editing?.id ?? crypto.randomUUID(),
      name: trimmed,
      aliases: aliases
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean),
      dueDate: dueDate || null,
      archived
    }
    await saveCollection('persons', (current) =>
      editing ? current.map((p) => (p.id === person.id ? person : p)) : [...current, person]
    )
    onClose()
  }

  const remove = async (): Promise<void> => {
    if (!editing) return
    await saveCollection('persons', (current) => current.filter((p) => p.id !== editing.id))
    onClose()
  }

  return (
    <Modal title={editing ? 'Person bearbeiten' : 'Neue Person'} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Name">
          <input autoFocus className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Erkennungsnamen für den CSV-Import (mit Komma getrennt, optional)">
          <input
            className={inputClass}
            placeholder="z. B. Max Mustermann, M. Mustermann"
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
          />
        </Field>
        <Field label="Fällig bis (optional, Kontor erinnert danach)">
          <input type="date" className={inputClass} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        {editing && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            Archiviert (nicht mehr zur Auswahl in Buchungen und Import)
          </label>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          <div>
            {editing &&
              !linked &&
              (confirmDelete ? (
                <ConfirmRow
                  question="Person löschen?"
                  confirmLabel="Löschen"
                  onConfirm={() => void remove()}
                  onCancel={() => setConfirmDelete(false)}
                />
              ) : (
                <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                  Löschen
                </Button>
              ))}
            {editing && linked && <span className="text-xs text-muted">Mit Schulden verknüpft: nur archivierbar</span>}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Abbrechen
            </Button>
            <Button variant="primary" type="submit">
              Speichern
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

function DebtForm({ personId: initialPerson, onClose }: { personId: string; onClose: () => void }) {
  const persons = useApp((s) => s.data.persons)
  const saveCollection = useApp((s) => s.saveCollection)
  const choices = persons.filter((p) => !p.archived || p.id === initialPerson)
  const [personId, setPersonId] = useState(initialPerson || choices[0]?.id || '')
  const [direction, setDirection] = useState<Debt['direction']>('owedToMe')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayIso())
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const amountCents = parseAmount(amount)
    if (!personId) return setError('Bitte eine Person wählen')
    if (amountCents === null || amountCents <= 0) return setError('Bitte einen Betrag größer als 0 eingeben')
    if (!isRealDate(date)) return setError('Bitte ein gültiges Datum eingeben')
    const entry: Debt = { id: crypto.randomUUID(), personId, direction, amountCents, date, note: note.trim() }
    await saveCollection('debts', (current) => [...current, entry])
    onClose()
  }

  return (
    <Modal title="Schuld eintragen" onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <p className="text-xs text-muted">
          Für Schulden ohne Kontobewegung, etwa bar. Geld, das über dein Konto fließt, buchst du als Buchung mit „Schuld
          mit Person“.
        </p>
        <Field label="Person">
          <select className={inputClass} value={personId} onChange={(e) => setPersonId(e.target.value)}>
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-1 rounded-md border border-line p-1">
          {(
            [
              ['owedToMe', 'Schuldet mir'],
              ['iOwe', 'Ich schulde']
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setDirection(value)}
              className={`rounded-sm px-3 py-1.5 text-sm ${
                direction === value ? 'bg-raised text-text' : 'text-muted hover:text-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Betrag in €">
            <input
              autoFocus
              className={`${inputClass} num`}
              inputMode="decimal"
              placeholder="0,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Datum">
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Notiz">
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button variant="primary" type="submit">
            Eintragen
          </Button>
        </div>
      </form>
    </Modal>
  )
}
