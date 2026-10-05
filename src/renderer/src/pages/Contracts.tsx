import { BellRing } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { todayIso } from '../../../shared/balance'
import {
  cancelDeadline,
  describeDeadline,
  formatNotice,
  noticeUnitLabel,
  subscriptions,
  upcomingDeadlines,
  type Subscription
} from '../../../shared/contracts'
import { FALLBACK_ICON } from '../../../shared/defaultCategories'
import { formatDate, isRealDate } from '../../../shared/draft'
import { formatCents } from '../../../shared/money'
import { intervalLabel } from '../../../shared/recurring'
import type { Contract, Recurring } from '../../../shared/schemas'
import { viewOf } from '../../../shared/scope'
import { useArea } from '../area'
import { CategoryIcon } from '../icons'
import { useApp } from '../store'
import { Button, Field, Modal, Section, inputClass } from '../ui'

export function Contracts() {
  const { recurring, categories } = useApp((s) => s.data)
  const setPage = useApp((s) => s.setPage)
  const area = useArea()
  const today = todayIso()
  const [editing, setEditing] = useState<Recurring | null>(null)

  const rules = useMemo(() => recurring.filter((r) => viewOf(r, area.ids) !== 'outside'), [recurring, area.ids])
  const items = useMemo(() => subscriptions(rules, today), [rules, today])
  const deadlines = useMemo(() => upcomingDeadlines(rules, today), [rules, today])
  const iconOf = (id: string | null): string => categories.find((c) => c.id === id)?.icon ?? FALLBACK_ICON

  const yearly = items.reduce((sum, s) => sum + s.yearlyCents, 0)
  const maxYearly = items[0]?.yearlyCents ?? 0

  return (
    <div className="max-w-4xl space-y-8">
      <h1 className="text-2xl font-semibold">Verträge & Abos</h1>

      {items.length === 0 ? (
        <p className="text-sm text-muted">
          Hier erscheinen alle laufenden Ausgaben aus deinen{' '}
          <button className="text-text underline underline-offset-2" onClick={() => setPage('recurring')}>
            wiederkehrenden Posten
          </button>{' '}
          mit ihren Kosten pro Jahr. Zu jedem kannst du Laufzeit und Kündigungsfrist hinterlegen; Kontor erinnert dich
          dann rechtzeitig.
        </p>
      ) : (
        <>
          <dl className="flex flex-wrap gap-x-10 gap-y-3 border-b border-line pb-5">
            <div>
              <dt className="text-xs text-muted">Kosten pro Jahr</dt>
              <dd className="num mt-0.5 text-2xl">{formatCents(yearly)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Pro Monat</dt>
              <dd className="num mt-0.5 text-2xl">{formatCents(Math.round(yearly / 12))}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Laufende Posten</dt>
              <dd className="num mt-0.5 text-2xl">{items.length}</dd>
            </div>
          </dl>

          {deadlines.length > 0 && (
            <Section title="Kündigungsfristen in den nächsten 30 Tagen">
              <ul className="ledger">
                {deadlines.map((d) => (
                  <li key={d.rule.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <BellRing size={15} className={`shrink-0 ${d.daysLeft <= 7 ? 'text-danger' : 'text-warn'}`} />
                    <span className="min-w-0 flex-1 truncate">{d.rule.payee}</span>
                    <span className="text-xs text-muted">{describeDeadline(d)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Alle laufenden Ausgaben">
            <ul className="ledger">
              {items.map((item) => (
                <SubscriptionRow
                  key={item.rule.id}
                  item={item}
                  icon={iconOf(item.rule.categoryId)}
                  share={maxYearly > 0 ? item.yearlyCents / maxYearly : 0}
                  onEdit={() => setEditing(item.rule)}
                />
              ))}
            </ul>
          </Section>
        </>
      )}

      {editing && <ContractForm rule={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function SubscriptionRow({
  item,
  icon,
  share,
  onEdit
}: {
  item: Subscription
  icon: string
  share: number
  onEdit: () => void
}) {
  const { rule, status } = item
  const contract = rule.contract

  let detail = 'Keine Vertragsdaten'
  if (contract && status) {
    if (!status.termEnd) detail = `Vertrag ausgelaufen am ${formatDate(contract.endDate)}`
    else if (!status.renews) detail = `Endet am ${formatDate(status.termEnd)}`
    else
      detail = `Läuft bis ${formatDate(status.termEnd)}, Frist ${formatNotice(contract)} · kündigen bis ${formatDate(
        status.cancelBy!
      )}`
  }

  return (
    <li className="group flex items-center gap-4 py-2.5 text-sm">
      <CategoryIcon name={icon} className="shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="truncate">{rule.payee}</div>
        <div className="truncate text-xs text-muted">
          {intervalLabel[rule.interval]} {formatCents(rule.amountCents)} · {detail}
        </div>
      </div>
      <Button small variant="ghost" className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100" onClick={onEdit}>
        {contract ? 'Vertrag bearbeiten' : 'Vertrag hinterlegen'}
      </Button>
      <div className="hidden w-24 md:block" aria-hidden>
        <div className="h-1.5 bg-raised">
          <div className="h-full bg-muted" style={{ width: `${Math.max(2, share * 100)}%` }} />
        </div>
      </div>
      <span className="num w-28 shrink-0 text-right" title="Kosten pro Jahr">
        {formatCents(item.yearlyCents)}
        <span className="text-xs text-muted"> /J</span>
      </span>
    </li>
  )
}

function ContractForm({ rule, onClose }: { rule: Recurring; onClose: () => void }) {
  const saveCollection = useApp((s) => s.saveCollection)
  const current = rule.contract
  const [endDate, setEndDate] = useState(current?.endDate ?? '')
  const [renewal, setRenewal] = useState(String(current?.renewalMonths ?? 12))
  const [noticeAmount, setNoticeAmount] = useState(String(current?.noticeAmount ?? 1))
  const [noticeUnit, setNoticeUnit] = useState<Contract['noticeUnit']>(current?.noticeUnit ?? 'months')
  const [errors, setErrors] = useState<{ endDate?: string; renewal?: string; notice?: string }>({})

  const asCount = (value: string): number | null => (/^\d{1,3}$/.test(value.trim()) ? Number(value.trim()) : null)

  const draft: Contract | null =
    isRealDate(endDate) && asCount(renewal) !== null && asCount(noticeAmount) !== null
      ? { endDate, renewalMonths: asCount(renewal)!, noticeAmount: asCount(noticeAmount)!, noticeUnit }
      : null

  const save = (contract: Contract | null): Promise<void> =>
    saveCollection('recurring', (all) => all.map((r) => (r.id === rule.id ? { ...r, contract } : r))).then(onClose)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const next: typeof errors = {}
    if (!isRealDate(endDate)) next.endDate = 'Bitte das Ende der aktuellen Laufzeit angeben'
    if (asCount(renewal) === null) next.renewal = 'Bitte eine Zahl angeben, 0 wenn der Vertrag einfach endet'
    if (asCount(noticeAmount) === null) next.notice = 'Bitte eine Zahl angeben'
    setErrors(next)
    if (Object.keys(next).length > 0 || !draft) return
    await save(draft)
  }

  return (
    <Modal title={`Vertrag: ${rule.payee}`} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Aktuelle Laufzeit endet am" error={errors.endDate}>
          <input type="date" autoFocus className={inputClass} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Verlängert sich danach um (Monate)" error={errors.renewal}>
            <input
              className={`${inputClass} num`}
              inputMode="numeric"
              value={renewal}
              onChange={(e) => setRenewal(e.target.value)}
            />
          </Field>
          <Field label="Kündigungsfrist" error={errors.notice}>
            <div className="flex gap-2">
              <input
                className={`${inputClass} num w-20`}
                inputMode="numeric"
                value={noticeAmount}
                onChange={(e) => setNoticeAmount(e.target.value)}
              />
              <select
                className={inputClass}
                value={noticeUnit}
                onChange={(e) => setNoticeUnit(e.target.value as Contract['noticeUnit'])}
              >
                {Object.entries(noticeUnitLabel).map(([unit, [, many]]) => (
                  <option key={unit} value={unit}>
                    {many}
                  </option>
                ))}
              </select>
            </div>
          </Field>
        </div>

        <p className="text-xs text-muted">
          {draft
            ? draft.renewalMonths === 0
              ? `Der Vertrag endet am ${formatDate(draft.endDate)} ohne Verlängerung.`
              : `Um zum ${formatDate(draft.endDate)} zu kündigen, muss die Kündigung bis ${formatDate(
                  cancelDeadline(draft, draft.endDate)
                )} da sein. Danach verlängert er sich jeweils um ${draft.renewalMonths} ${
                  draft.renewalMonths === 1 ? 'Monat' : 'Monate'
                }. Seit 2022 sind viele Verbraucherverträge nach der Mindestlaufzeit monatlich kündbar: dann 1 Monat Verlängerung und 1 Monat Frist.`
            : 'Kontor erinnert dich beim Start, wenn eine Kündigungsfrist in den nächsten 30 Tagen abläuft.'}
        </p>

        <div className="flex items-center justify-between gap-2">
          <div>
            {current && (
              <Button variant="ghost" onClick={() => save(null)}>
                Vertragsdaten entfernen
              </Button>
            )}
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
