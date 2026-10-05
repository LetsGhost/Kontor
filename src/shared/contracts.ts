import { formatDate } from './draft'
import { occurrence } from './recurring'
import type { Contract, Recurring } from './schemas'

const DAY_MS = 86_400_000
const toMs = (date: string): number => Date.parse(`${date}T00:00:00Z`)
export const daysUntil = (from: string, to: string): number => Math.round((toMs(to) - toMs(from)) / DAY_MS)
const addDays = (date: string, days: number): string => new Date(toMs(date) + days * DAY_MS).toISOString().slice(0, 10)

/** Monate auf ein Datum, der Tag wird bei kürzeren Monaten auf den Monatsletzten gekürzt. */
const addMonthsToDate = (date: string, months: number): string => occurrence(date, 'monthly', months)

export const noticeUnitLabel: Record<Contract['noticeUnit'], [string, string]> = {
  days: ['Tag', 'Tage'],
  weeks: ['Woche', 'Wochen'],
  months: ['Monat', 'Monate']
}

export const formatNotice = (contract: Pick<Contract, 'noticeAmount' | 'noticeUnit'>): string => {
  const [one, many] = noticeUnitLabel[contract.noticeUnit]
  return `${contract.noticeAmount} ${contract.noticeAmount === 1 ? one : many}`
}

/** Der letzte Tag, an dem zu `termEnd` noch gekündigt werden kann. */
export function cancelDeadline(contract: Pick<Contract, 'noticeAmount' | 'noticeUnit'>, termEnd: string): string {
  const { noticeAmount: n, noticeUnit: unit } = contract
  if (unit === 'months') return addMonthsToDate(termEnd, -n)
  return addDays(termEnd, -(unit === 'weeks' ? 7 * n : n))
}

export interface ContractStatus {
  /** Ende der Laufzeit, zu der als Nächstes gekündigt werden kann; null, wenn der Vertrag schon ausgelaufen ist */
  termEnd: string | null
  /** Spätester Kündigungstag für diese Laufzeit */
  cancelBy: string | null
  /** Ob sich der Vertrag nach termEnd von selbst verlängert */
  renews: boolean
}

/**
 * Wann der Vertrag als Nächstes endet und bis wann dafür gekündigt werden muss. Ist die Frist für die
 * aktuelle Laufzeit schon vorbei, zählt die nächste Verlängerung.
 */
export function contractStatus(contract: Contract, today: string): ContractStatus {
  const renews = contract.renewalMonths > 0
  let termEnd = contract.endDate
  if (renews) {
    for (let n = 1; cancelDeadline(contract, termEnd) < today; n++) {
      termEnd = addMonthsToDate(contract.endDate, n * contract.renewalMonths)
    }
  } else if (termEnd < today) {
    return { termEnd: null, cancelBy: null, renews }
  }
  return { termEnd, cancelBy: cancelDeadline(contract, termEnd), renews }
}

const PER_YEAR = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1 }

export const yearlyCents = (rule: Pick<Recurring, 'amountCents' | 'interval'>): number =>
  rule.amountCents * PER_YEAR[rule.interval]

export interface Subscription {
  rule: Recurring
  yearlyCents: number
  status: ContractStatus | null
}

/** Laufende Ausgaben aus wiederkehrenden Posten, teuerste zuerst. */
export function subscriptions(rules: Recurring[], today: string): Subscription[] {
  return rules
    .filter((r) => r.active && r.type === 'expense')
    .map((rule) => ({
      rule,
      yearlyCents: yearlyCents(rule),
      status: rule.contract ? contractStatus(rule.contract, today) : null
    }))
    .sort((a, b) => b.yearlyCents - a.yearlyCents)
}

export interface Deadline {
  rule: Recurring
  cancelBy: string
  termEnd: string
  daysLeft: number
}

/** Verträge, deren Kündigungsfrist in den nächsten `withinDays` Tagen abläuft. */
export function upcomingDeadlines(rules: Recurring[], today: string, withinDays = 30): Deadline[] {
  return rules
    .flatMap((rule) => {
      if (!rule.active || !rule.contract || rule.contract.renewalMonths === 0) return []
      const { termEnd, cancelBy } = contractStatus(rule.contract, today)
      if (!termEnd || !cancelBy) return []
      const daysLeft = daysUntil(today, cancelBy)
      return daysLeft <= withinDays ? [{ rule, cancelBy, termEnd, daysLeft }] : []
    })
    .sort((a, b) => a.cancelBy.localeCompare(b.cancelBy))
}

export const describeDeadline = (d: Deadline): string =>
  d.daysLeft === 0
    ? `Heute letzter Tag zum Kündigen (verlängert sich zum ${formatDate(d.termEnd)})`
    : `Kündigen bis ${formatDate(d.cancelBy)}, noch ${d.daysLeft} ${d.daysLeft === 1 ? 'Tag' : 'Tage'}`
