import { Undo2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { todayIso } from '../../shared/balance'
import { reminders, type Reminder } from '../../shared/reminders'
import { PAGES, useApp, type Page } from './store'
import { Button } from './ui'

const NOTICE_MS = 8000

/** Der Hinweis unten im Fenster, etwa „Buchung gelöscht · Rückgängig“. Verschwindet nach ein paar Sekunden. */
export function Notices() {
  const notice = useApp((s) => s.notice)
  const dismiss = useApp((s) => s.dismissNotice)
  const [undoing, setUndoing] = useState(false)

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(dismiss, NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [notice, dismiss])

  if (!notice) return null

  const undo = async (): Promise<void> => {
    if (!notice.undo || undoing) return
    setUndoing(true)
    try {
      await notice.undo()
      dismiss()
    } finally {
      setUndoing(false)
    }
  }

  return (
    <div
      role="status"
      key={notice.id}
      className="fixed bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-md border border-line bg-raised py-2 pr-2 pl-4 text-sm shadow-lg shadow-black/40"
    >
      <span>{notice.message}</span>
      {notice.undo && (
        <Button small disabled={undoing} onClick={undo}>
          <Undo2 size={13} /> Rückgängig
        </Button>
      )}
      <Button small variant="ghost" aria-label="Hinweis schließen" onClick={dismiss}>
        <X size={13} />
      </Button>
    </div>
  )
}

/** Strg+1 … Strg+9 wechseln die Seite, Strg+F springt in die Suche der Buchungen. */
export function useKeyboardShortcuts(enabled: boolean): void {
  const setPage = useApp((s) => s.setPage)
  const requestSearch = useApp((s) => s.requestSearch)

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return
      // Ein offenes Formular würde beim Seitenwechsel samt Eingaben verschwinden.
      if (document.querySelector('[role="dialog"]')) return
      const digit = Number(e.key)
      if (Number.isInteger(digit) && digit >= 1 && digit <= PAGES.length) {
        e.preventDefault()
        setPage(PAGES[digit - 1])
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault()
        requestSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, setPage, requestSearch])
}

const REMINDERS_KEY = 'kontor.reminders'
const REMINDED_ON_KEY = 'kontor.remindedOn'

function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Dann gilt die Einstellung nur bis zum Neustart.
  }
}

const remindersEnabled = (): boolean => readSetting(REMINDERS_KEY) !== 'off'

const targetPage: Record<Reminder['kind'], Page> = {
  due: 'overview',
  budget: 'overview',
  contract: 'contracts'
}

function notify(items: Reminder[], setPage: (page: Page) => void): void {
  for (const item of items) {
    const notification = new Notification(item.title, { body: item.body, tag: `kontor-${item.kind}` })
    notification.onclick = () => {
      void window.kontor.focusWindow()
      setPage(targetPage[item.kind])
    }
  }
}

/** Zeigt beim Start Windows-Benachrichtigungen, höchstens einmal am Tag. */
export function useStartupReminders(ready: boolean): void {
  const setPage = useApp((s) => s.setPage)

  useEffect(() => {
    if (!ready || !remindersEnabled()) return
    const today = todayIso()
    if (readSetting(REMINDED_ON_KEY) === today) return
    const items = reminders(useApp.getState().data, today)
    writeSetting(REMINDED_ON_KEY, today)
    notify(items, setPage)
    // Nur einmal nach dem Laden, nicht nach jeder Änderung der Daten.
  }, [ready, setPage])
}

export function ReminderSettings() {
  const data = useApp((s) => s.data)
  const setPage = useApp((s) => s.setPage)
  const [enabled, setEnabled] = useState(remindersEnabled)
  const [result, setResult] = useState<string | null>(null)

  const toggle = (on: boolean): void => {
    writeSetting(REMINDERS_KEY, on ? 'on' : 'off')
    setEnabled(on)
  }

  const showNow = (): void => {
    const items = reminders(data, todayIso())
    notify(items, setPage)
    setResult(items.length === 0 ? 'Gerade gibt es nichts, woran Kontor erinnern müsste.' : null)
  }

  return (
    <div className="space-y-3 text-sm">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 accent-[var(--color-accent)]"
          checked={enabled}
          onChange={(e) => toggle(e.target.checked)}
        />
        <span>
          Beim Start an Wichtiges erinnern
          <span className="block text-xs text-muted">
            Einmal am Tag eine Windows-Benachrichtigung zu fälligen wiederkehrenden Posten, überschrittenen Budgets und
            Kündigungsfristen, die in den nächsten 30 Tagen ablaufen.
          </span>
        </span>
      </label>
      <div className="flex items-center gap-3">
        <Button small onClick={showNow}>
          Jetzt anzeigen
        </Button>
        {result && <span className="text-xs text-muted">{result}</span>}
      </div>
    </div>
  )
}
