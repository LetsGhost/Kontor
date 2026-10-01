import { useEffect, useState } from 'react'
import type { BackupInfo } from '../../shared/api'
import { useApp } from './store'
import { Button, ConfirmRow } from './ui'

const dateTime = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' })

/** Liste der Backups mit Wiederherstellung. Wird in den Einstellungen und im Fehlerbildschirm benutzt. */
export function Backups({ allowCreate }: { allowCreate: boolean }) {
  const reload = useApp((s) => s.reload)
  const [backups, setBackups] = useState<BackupInfo[] | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = (): Promise<void> => window.kontor.listBackups().then(setBackups)

  useEffect(() => {
    void refresh()
  }, [])

  const run = async (action: () => Promise<void>): Promise<void> => {
    setError(null)
    try {
      await action()
    } catch (err) {
      setError((err as Error).message)
    }
    setConfirming(null)
    await refresh()
  }

  const restore = (name: string): Promise<void> =>
    run(async () => {
      await window.kontor.restoreBackup(name)
      await reload()
    })

  if (backups === null) return null

  return (
    <div className="space-y-3">
      {allowCreate && <Button onClick={() => run(() => window.kontor.createBackup())}>Backup jetzt anlegen</Button>}
      {error && <p className="text-sm text-danger">{error}</p>}
      {backups.length === 0 ? (
        <p className="text-sm text-muted">Noch keine Backups vorhanden.</p>
      ) : (
        <ul className="ledger">
          {backups.map((b) => (
            <li key={b.name} className="flex items-center justify-between gap-4 py-2.5 text-sm">
              <div>
                <div>{dateTime.format(new Date(b.createdAt))}</div>
                <div className="num text-xs text-muted">{b.name}</div>
              </div>
              {confirming === b.name ? (
                <ConfirmRow
                  question="Aktuellen Stand ersetzen?"
                  confirmLabel="Ja, wiederherstellen"
                  onConfirm={() => restore(b.name)}
                  onCancel={() => setConfirming(null)}
                />
              ) : (
                <Button small variant="ghost" onClick={() => setConfirming(b.name)}>
                  Wiederherstellen
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
