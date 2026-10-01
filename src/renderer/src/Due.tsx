import { useState } from 'react'
import { todayIso } from '../../shared/balance'
import { formatDate } from '../../shared/draft'
import { centsToInput, parseAmount } from '../../shared/money'
import { advance, bookOccurrence, dueDates } from '../../shared/recurring'
import type { Recurring } from '../../shared/schemas'
import { viewOf, type Ids } from '../../shared/scope'
import { useApp } from './store'
import { Button } from './ui'

interface DueItem {
  rule: Recurring
  /** Der älteste offene Termin. Spätere kommen erst an die Reihe, wenn dieser erledigt ist. */
  date: string
  further: number
}

/** @param ids nur Regeln, die eines dieser Konten betreffen; ohne Angabe alle */
export function useDue(ids?: Ids): DueItem[] {
  const recurring = useApp((s) => s.data.recurring)
  const today = todayIso()
  return recurring
    .filter((rule) => !ids || viewOf(rule, ids) !== 'outside')
    .flatMap((rule) => {
      const dates = dueDates(rule, today)
      return dates.length > 0 ? [{ rule, date: dates[0], further: dates.length - 1 }] : []
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Fällige wiederkehrende Posten. Gebucht wird erst nach Bestätigung, der Betrag ist vorher änderbar. */
export function DueList({ items }: { items: DueItem[] }) {
  return (
    <ul className="ledger">
      {items.map((item) => (
        <DueRow key={`${item.rule.id}:${item.date}`} {...item} />
      ))}
    </ul>
  )
}

function DueRow({ rule, date, further }: DueItem) {
  const { accounts, recurring } = useApp((s) => s.data)
  const putTransactions = useApp((s) => s.putTransactions)
  const saveCollection = useApp((s) => s.saveCollection)
  const [amount, setAmount] = useState(centsToInput(rule.amountCents))
  const [invalid, setInvalid] = useState(false)

  const name = (id: string | null): string => accounts.find((a) => a.id === id)?.name ?? '?'
  const title = rule.type === 'transfer' ? `${name(rule.accountId)} → ${name(rule.transferAccountId)}` : rule.payee

  const moveOn = (): Promise<void> =>
    saveCollection(
      'recurring',
      recurring.map((r) => (r.id === rule.id ? advance(r, date) : r))
    )

  const book = async (): Promise<void> => {
    const amountCents = parseAmount(amount)
    if (amountCents === null || amountCents <= 0) {
      setInvalid(true)
      return
    }
    await putTransactions([bookOccurrence(rule, date, amountCents, crypto.randomUUID(), new Date().toISOString())])
    await moveOn()
  }

  return (
    <li className="flex items-center gap-4 py-2.5 text-sm">
      <span className="num w-24 shrink-0 text-muted">{formatDate(date)}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate">{title}</div>
        {further > 0 && (
          <div className="text-xs text-muted">
            danach {further === 1 ? 'ein weiterer Termin' : `${further} weitere Termine`} offen
          </div>
        )}
      </div>
      <input
        aria-label={`Betrag für ${title}`}
        className={`num w-28 rounded-md border bg-bg px-2 py-1 text-right text-sm outline-none focus:border-muted ${
          invalid ? 'border-danger' : 'border-line'
        }`}
        value={amount}
        onChange={(e) => {
          setAmount(e.target.value)
          setInvalid(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void book()
        }}
      />
      <span className="text-muted">€</span>
      <Button small variant="primary" onClick={book}>
        Buchen
      </Button>
      <Button small variant="ghost" onClick={moveOn}>
        Überspringen
      </Button>
    </li>
  )
}
