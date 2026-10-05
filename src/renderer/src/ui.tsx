import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'

export const inputClass =
  'w-full rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-muted'

const variants = {
  default: 'border border-line hover:bg-raised',
  primary: 'bg-text font-medium text-bg hover:bg-white',
  danger: 'bg-danger font-medium text-bg hover:brightness-110',
  ghost: 'text-muted hover:bg-raised hover:text-text'
}

export function Button({
  variant = 'default',
  small = false,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; small?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center gap-1.5 rounded-md whitespace-nowrap disabled:opacity-40 ${
        small ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'
      } ${variants[variant]} ${className}`}
    />
  )
}

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted">{label}</span>
      {children}
      {error && <span className="block text-xs text-danger">{error}</span>}
    </label>
  )
}

/** Abschnitt ohne Kasten: Überschrift, optional etwas rechts daneben, darunter der Inhalt. */
export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function Modal({
  title,
  onClose,
  children,
  wide = false
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-10 flex items-start justify-center overflow-y-auto bg-black/70 p-4 md:p-10"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full rounded-lg border border-line bg-surface p-6 ${wide ? 'max-w-2xl' : 'max-w-lg'}`}
      >
        <h2 className="mb-5 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  )
}

/** Löschen und ähnliche Aktionen erst nach einem zweiten Klick ausführen. */
export function ConfirmRow({
  question,
  confirmLabel,
  onConfirm,
  onCancel
}: {
  question: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-warn">{question}</span>
      <Button small variant="danger" onClick={onConfirm}>
        {confirmLabel}
      </Button>
      <Button small variant="ghost" onClick={onCancel}>
        Abbrechen
      </Button>
    </div>
  )
}
