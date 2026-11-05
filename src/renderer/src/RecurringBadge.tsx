import type { RecurringMark } from '../../shared/recurring'

/** Kräftig: gehört zu einer Regel. Gestrichelt: sieht wiederkehrend aus, es gibt aber noch keine Regel. */
export function RecurringBadge({ mark }: { mark: RecurringMark | undefined }) {
  if (!mark) return null
  return mark.kind === 'rule' ? (
    <span className="shrink-0 border border-accent px-1.5 py-0.5 text-[10px] text-accent">wiederkehrend</span>
  ) : (
    <span
      className="shrink-0 border border-dashed border-accent/50 px-1.5 py-0.5 text-[10px] text-accent/70"
      title="Sieht wiederkehrend aus, es gibt aber noch keine Regel"
    >
      wiederkehrend?
    </span>
  )
}
