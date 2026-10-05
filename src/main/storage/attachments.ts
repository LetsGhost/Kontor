import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ATTACHMENT_NAME } from '../../shared/schemas'
import { BACKUP_DIR } from './backup'
import { writeBytesAtomic } from './files'

/**
 * Belege liegen außerhalb der Backups: Sie ändern sich nie (der Name ist ein Hash des Inhalts), und zehn Kopien
 * aller Fotos würden den Datenordner aufblähen. Gelöscht wird eine Datei erst, wenn weder die aktuellen Daten
 * noch eines der Backups sie noch kennt. So bleibt auch nach dem Zurückspielen eines Backups jeder Beleg da.
 */
export const ATTACHMENTS_DIR = 'attachments' // gleicher Name in backup.ts
export const ATTACHMENT_TYPES = ['jpg', 'png', 'webp', 'pdf'] as const
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number]
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

/** Speichert einen Beleg und gibt seinen Namen zurück. Gleicher Inhalt ergibt denselben Namen. */
export function saveAttachment(dataDir: string, bytes: Uint8Array, type: string): string {
  if (!(ATTACHMENT_TYPES as readonly string[]).includes(type)) throw new Error(`Dateityp nicht erlaubt: ${type}`)
  if (bytes.length === 0) throw new Error('Die Datei ist leer')
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('Belege dürfen höchstens 20 MB groß sein')

  const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.${type}`
  const dir = join(dataDir, ATTACHMENTS_DIR)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  if (!existsSync(file)) writeBytesAtomic(file, bytes)
  return name
}

/** Pfad eines Belegs. Nur gültige Namen, damit kein Pfad außerhalb des Ordners angesprochen wird. */
export function attachmentPath(dataDir: string, name: string): string {
  if (!ATTACHMENT_NAME.test(name)) throw new Error(`Ungültiger Belegname: ${name}`)
  const file = join(dataDir, ATTACHMENTS_DIR, name)
  if (!existsSync(file)) throw new Error('Der Beleg ist nicht mehr vorhanden')
  return file
}

/** Alle Belegnamen, die in den Buchungsdateien unter `dir` vorkommen. Wirft bei einer unlesbaren Datei. */
function referencedIn(dir: string, into: Set<string>): void {
  const transactionsDir = join(dir, 'transactions')
  if (!existsSync(transactionsDir)) return
  for (const name of readdirSync(transactionsDir)) {
    if (!name.endsWith('.json')) continue
    const items = JSON.parse(readFileSync(join(transactionsDir, name), 'utf8')) as { attachments?: unknown }[]
    for (const item of items) {
      if (Array.isArray(item.attachments)) for (const a of item.attachments) into.add(String(a))
    }
  }
}

const GRACE_MS = 24 * 60 * 60 * 1000

/**
 * Entfernt Belege, auf die nichts mehr zeigt. Frisch hinzugefügte bleiben einen Tag verschont, falls die
 * Buchung dazu gerade erst gespeichert wird. Gibt die Anzahl gelöschter Dateien zurück.
 */
export function pruneAttachments(dataDir: string, now = Date.now()): number {
  const dir = join(dataDir, ATTACHMENTS_DIR)
  if (!existsSync(dir)) return 0

  const referenced = new Set<string>()
  try {
    referencedIn(dataDir, referenced)
    const backups = join(dataDir, BACKUP_DIR)
    for (const name of existsSync(backups) ? readdirSync(backups) : []) referencedIn(join(backups, name), referenced)
  } catch {
    // Eine unlesbare Datei darf nicht dazu führen, dass ihre Belege als verwaist gelten. Lieber nichts löschen.
    return 0
  }

  let removed = 0
  for (const name of readdirSync(dir)) {
    const file = join(dir, name)
    if (referenced.has(name) || now - statSync(file).mtimeMs < GRACE_MS) continue
    rmSync(file, { force: true })
    removed++
  }
  return removed
}
