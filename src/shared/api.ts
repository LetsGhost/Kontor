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
}
