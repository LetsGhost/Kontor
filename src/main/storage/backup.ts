import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { BackupInfo } from '../../shared/api'

export const BACKUP_DIR = 'backups'
export const MAX_BACKUPS = 10

const pad = (n: number): string => String(n).padStart(2, '0')

const dateStamp = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const timeStamp = (d: Date): string =>
  `${dateStamp(d)}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`

// Belege ändern sich nie und werden deshalb nicht mitgesichert, siehe attachments.ts.
const ATTACHMENTS_DIR = 'attachments'

/** Alles im Datenordner außer den Backups selbst, den Belegen und Resten abgebrochener Schreibvorgänge. */
function dataEntries(dataDir: string): string[] {
  if (!existsSync(dataDir)) return []
  return readdirSync(dataDir).filter(
    (name) => name !== BACKUP_DIR && name !== ATTACHMENTS_DIR && !name.endsWith('.tmp')
  )
}

/** Neueste zuerst. Die Namen beginnen mit einem Zeitstempel und sortieren deshalb chronologisch. */
export function listBackups(dataDir: string): BackupInfo[] {
  const dir = join(dataDir, BACKUP_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort()
    .reverse()
    .map((name) => ({ name, createdAt: statSync(join(dir, name)).mtime.toISOString() }))
}

export function pruneBackups(dataDir: string): void {
  for (const { name } of listBackups(dataDir).slice(MAX_BACKUPS)) {
    rmSync(join(dataDir, BACKUP_DIR, name), { recursive: true, force: true })
  }
}

/** Legt eine Kopie aller Datendateien an. Gibt den Namen zurück, oder null, wenn es nichts zu sichern gibt. */
export function createBackup(
  dataDir: string,
  options: { label?: string; prune?: boolean; now?: Date } = {}
): string | null {
  const entries = dataEntries(dataDir)
  if (entries.length === 0) return null

  const base = timeStamp(options.now ?? new Date()) + (options.label ? `_${options.label}` : '')
  let name = base
  for (let n = 2; existsSync(join(dataDir, BACKUP_DIR, name)); n++) name = `${base}-${n}`

  const target = join(dataDir, BACKUP_DIR, name)
  mkdirSync(target, { recursive: true })
  for (const entry of entries) {
    cpSync(join(dataDir, entry), join(target, entry), { recursive: true })
  }

  if (options.prune ?? true) pruneBackups(dataDir)
  return name
}

/** Höchstens ein automatisches Backup pro Kalendertag, damit zehn Stände etwa zehn Nutzungstage abdecken. */
export function ensureDailyBackup(dataDir: string, now = new Date()): void {
  const today = dateStamp(now)
  if (listBackups(dataDir).some((b) => b.name.startsWith(today))) return
  createBackup(dataDir, { now })
}

/** Ersetzt die aktuellen Daten durch ein Backup. Der aktuelle Stand wird vorher selbst gesichert. */
export function restoreBackup(dataDir: string, name: string, now = new Date()): void {
  // Nur bekannte Namen zulassen, damit kein Pfad außerhalb des Backup-Ordners angesprochen wird.
  if (!listBackups(dataDir).some((b) => b.name === name)) {
    throw new Error(`Backup nicht gefunden: ${name}`)
  }

  // Erst nach dem Zurückspielen aufräumen, sonst könnte das gewählte Backup selbst wegrotieren.
  createBackup(dataDir, { label: 'vor-wiederherstellung', prune: false, now })

  for (const entry of dataEntries(dataDir)) {
    rmSync(join(dataDir, entry), { recursive: true, force: true })
  }
  const source = join(dataDir, BACKUP_DIR, name)
  for (const entry of readdirSync(source)) {
    cpSync(join(source, entry), join(dataDir, entry), { recursive: true })
  }

  pruneBackups(dataDir)
}
