import { ArrowLeft, FileUp } from 'lucide-react'
import { useMemo, useState, type ChangeEvent } from 'react'
import { todayIso } from '../../../shared/balance'
import {
  buildCandidates,
  decodeCsv,
  finishImport,
  guessMapping,
  parseCsv,
  toTable,
  type CsvMapping,
  type CsvTable,
  type ImportCandidate
} from '../../../shared/csv'
import { formatDate } from '../../../shared/draft'
import { formatCents } from '../../../shared/money'
import { CategorySelect } from '../CategorySelect'
import { useArea } from '../area'
import { useApp } from '../store'
import { Button, Field, Section, inputClass } from '../ui'

const mappingFields: [keyof CsvMapping, string, boolean][] = [
  ['date', 'Datum', true],
  ['amount', 'Betrag', true],
  ['payee', 'Empfänger', false],
  ['payer', 'Absender bei Einnahmen', false],
  ['note', 'Verwendungszweck', false]
]

export function CsvImport({ onClose }: { onClose: () => void }) {
  const { accounts, transactions, categories, recurring } = useApp((s) => s.data)
  const putTransactions = useApp((s) => s.putTransactions)
  const saveCollection = useApp((s) => s.saveCollection)
  const { active } = useArea()

  const [accountId, setAccountId] = useState(active[0]?.id ?? '')
  const [fileName, setFileName] = useState('')
  const [table, setTable] = useState<CsvTable | null>(null)
  const [mapping, setMapping] = useState<CsvMapping | null>(null)
  const [invert, setInvert] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Abweichungen von der Vorgabe je Zeile: Haken und Kategorie
  const [picked, setPicked] = useState<Record<number, boolean>>({})
  const [categoryOf, setCategoryOf] = useState<Record<number, string>>({})
  const [done, setDone] = useState<{ count: number; linked: number } | null>(null)

  const account = accounts.find((a) => a.id === accountId)

  const candidates = useMemo(
    () =>
      table && mapping && account
        ? buildCandidates(table, mapping, { account, invert, transactions, categories, today: todayIso() })
        : [],
    [table, mapping, account, invert, transactions, categories]
  )

  const isPicked = (c: ImportCandidate): boolean => picked[c.line] ?? c.status === 'new'
  const canPick = (c: ImportCandidate): boolean => c.status === 'new' || c.status === 'similar'
  const selected = candidates.filter((c) => canPick(c) && isPicked(c))
  const count = (status: ImportCandidate['status']): number => candidates.filter((c) => c.status === status).length
  const ready = mapping !== null && mapping.date >= 0 && mapping.amount >= 0

  const openFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setPicked({})
    setCategoryOf({})
    const parsed = toTable(parseCsv(decodeCsv(new Uint8Array(await file.arrayBuffer()))))
    if (!parsed) {
      setTable(null)
      setMapping(null)
      setError('In dieser Datei wurde keine Tabelle gefunden. Ist es ein CSV-Export deiner Bank?')
      return
    }
    setFileName(file.name)
    setTable(parsed)
    setMapping(guessMapping(parsed.headers))
  }

  const runImport = async (): Promise<void> => {
    const result = finishImport(
      selected.map((c) => ({ ...c, categoryId: c.line in categoryOf ? categoryOf[c.line] || null : c.categoryId })),
      accountId,
      recurring,
      () => crypto.randomUUID(),
      new Date().toISOString()
    )
    try {
      await putTransactions(result.transactions)
      if (result.linked > 0) await saveCollection('recurring', result.recurring)
    } catch (err) {
      setError(`Import fehlgeschlagen: ${(err as Error).message}`)
      return
    }
    setDone({ count: result.transactions.length, linked: result.linked })
  }

  const header = (
    <div className="flex items-center gap-3">
      <Button variant="ghost" aria-label="Zurück zu den Buchungen" onClick={onClose}>
        <ArrowLeft size={16} />
      </Button>
      <h1 className="text-2xl font-semibold">CSV-Import</h1>
    </div>
  )

  if (done) {
    return (
      <div className="max-w-3xl space-y-6">
        {header}
        <p className="text-sm">
          {done.count === 1 ? '1 Buchung wurde' : `${done.count} Buchungen wurden`} in „{account?.name}“ importiert.
          {done.linked > 0 &&
            (done.linked === 1
              ? ' Eine davon gehört zu einer wiederkehrenden Regel; deren Termin gilt als erledigt.'
              : ` ${done.linked} davon gehören zu wiederkehrenden Regeln; deren Termine gelten als erledigt.`)}
        </p>
        <Button variant="primary" onClick={onClose}>
          Zu den Buchungen
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {header}

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-56">
          <Field label="In welches Konto">
            <select className={inputClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {active.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line px-3 py-2 text-sm hover:bg-raised">
          <FileUp size={15} />
          {fileName || 'CSV-Datei wählen'}
          <input type="file" accept=".csv,.txt,text/csv" className="sr-only" onChange={openFile} />
        </label>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {!table && !error && (
        <p className="max-w-2xl text-sm text-muted">
          Lade im Online-Banking deine Umsätze als CSV herunter und wähle die Datei hier aus. Kontor erkennt die
          Spalten der gängigen Banken selbst; du siehst alle Buchungen vor dem Import und entscheidest, welche
          übernommen werden. Die Datei wird nur gelesen und bleibt auf deinem Rechner.
        </p>
      )}

      {table && mapping && (
        <>
          <Section title="Spalten zuordnen">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
              {mappingFields.map(([key, label, required]) => (
                <Field key={key} label={required ? label : `${label} (optional)`}>
                  <select
                    className={inputClass}
                    value={mapping[key]}
                    onChange={(e) => setMapping({ ...mapping, [key]: Number(e.target.value) })}
                  >
                    <option value={-1}>Nicht vorhanden</option>
                    {table.headers.map((name, index) => (
                      <option key={index} value={index}>
                        {name || `Spalte ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
            <label className="flex w-fit items-center gap-2 text-sm">
              <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
              Vorzeichen umkehren (wenn die Datei Ausgaben als positive Beträge führt)
            </label>
          </Section>

          {!ready ? (
            <p className="text-sm text-warn">Bitte mindestens die Spalten für Datum und Betrag zuordnen.</p>
          ) : (
            <Section
              title={`Vorschau: ${candidates.length} Zeilen`}
              aside={
                <span className="text-xs text-muted">
                  {[
                    `${count('new')} neu`,
                    count('imported') > 0 && `${count('imported')} schon importiert`,
                    count('similar') > 0 && `${count('similar')} vielleicht schon erfasst`,
                    count('invalid') > 0 && `${count('invalid')} nicht lesbar`
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              }
            >
              <ul className="ledger">
                {candidates.map((c) => (
                  <li
                    key={c.line}
                    className={`flex items-center gap-4 py-2 text-sm ${canPick(c) && isPicked(c) ? '' : 'text-muted'}`}
                  >
                    <input
                      type="checkbox"
                      aria-label="Importieren"
                      disabled={!canPick(c)}
                      checked={canPick(c) && isPicked(c)}
                      onChange={(e) => setPicked({ ...picked, [c.line]: e.target.checked })}
                    />
                    <span className="num w-24 shrink-0">{c.date ? formatDate(c.date) : '—'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{c.payee || (c.type === 'income' ? 'Einnahme' : 'Ausgabe')}</div>
                      <div className="truncate text-xs text-muted">{[c.reason, c.note].filter(Boolean).join(' · ')}</div>
                    </div>
                    <div className="w-40 shrink-0 xl:w-56">
                      {canPick(c) && (
                        <CategorySelect
                          kind={c.type}
                          value={c.line in categoryOf ? categoryOf[c.line] : (c.categoryId ?? '')}
                          onChange={(categoryId) => setCategoryOf({ ...categoryOf, [c.line]: categoryId })}
                        />
                      )}
                    </div>
                    <span className={`num w-28 shrink-0 text-right ${c.type === 'income' && canPick(c) ? 'text-plus' : ''}`}>
                      {c.status === 'invalid' && c.amountCents === 0
                        ? '—'
                        : `${c.type === 'income' ? '+' : '−'}${formatCents(c.amountCents)}`}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={onClose}>
                  Abbrechen
                </Button>
                <Button variant="primary" disabled={selected.length === 0} onClick={runImport}>
                  {selected.length === 1 ? '1 Buchung importieren' : `${selected.length} Buchungen importieren`}
                </Button>
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  )
}
