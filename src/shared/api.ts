import type { CollectionName, KontorData, Transaction } from './schemas'

export interface AppInfo {
  isDev: boolean
  dataDir: string
  version: string
}

export interface BackupInfo {
  name: string
  createdAt: string
}

export type LoadResult =
  | { ok: true; data: KontorData }
  | { ok: false; error: { file: string; message: string } }

export interface KontorApi {
  info(): Promise<AppInfo>
  load(): Promise<LoadResult>
  save<K extends CollectionName>(collection: K, data: KontorData[K]): Promise<void>
  saveTransactions(year: number, data: Transaction[]): Promise<void>
  listBackups(): Promise<BackupInfo[]>
  createBackup(): Promise<void>
  restoreBackup(name: string): Promise<void>
  openDataFolder(): Promise<void>
  /** Speichert einen Beleg (jpg, png, webp oder pdf) und gibt seinen Dateinamen zurück. */
  addAttachment(bytes: Uint8Array, type: string): Promise<string>
  readAttachment(name: string): Promise<Uint8Array>
  /** Öffnet einen Beleg im Standardprogramm von Windows. */
  openAttachment(name: string): Promise<void>
  /** Fragt nach einem Speicherort und schreibt die Datei. Gibt den Pfad zurück, oder null bei Abbruch. */
  saveExport(defaultName: string, bytes: Uint8Array): Promise<string | null>
  /** Holt das Fenster nach vorn, etwa nach einem Klick auf eine Benachrichtigung. */
  focusWindow(): Promise<void>
}
