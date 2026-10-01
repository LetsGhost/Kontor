import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { FALLBACK_ICON, defaultCategories } from '../../shared/defaultCategories'
import {
  DEFAULT_AREA,
  SCHEMA_VERSION,
  collectionSchemas,
  metaSchema,
  transactionsSchema,
  type CollectionName,
  type KontorData,
  type Meta,
  type Transaction
} from '../../shared/schemas'
import { createBackup } from './backup'
import { StorageError, readJson, writeJsonAtomic } from './files'

const META_FILE = 'meta.json'
const TRANSACTIONS_DIR = 'transactions'
const YEAR_FILE = /^(\d{4})\.json$/

/** Migration n → n+1 steht an Index n-1 und arbeitet direkt auf den Dateien im Datenordner. */
const migrations: ((dataDir: string) => void)[] = [
  // v1 → v2: Emojis durch Icon-Namen ersetzen. Standardkategorien bekommen ihr neues Icon, eigene das neutrale.
  (dataDir) => {
    const file = join(dataDir, 'categories.json')
    if (!existsSync(file)) return
    const icons = new Map(defaultCategories().map((c) => [c.id, c.icon]))
    const categories = JSON.parse(readFileSync(file, 'utf8')) as { id: string; icon: string }[]
    writeJsonAtomic(
      file,
      categories.map((c) => ({ ...c, icon: icons.get(c.id) ?? FALLBACK_ICON }))
    )
  },
  // v2 → v3: Bereiche einführen. Alles Bisherige landet im Bereich „Privat“.
  (dataDir) => {
    writeJsonAtomic(join(dataDir, 'areas.json'), [DEFAULT_AREA])
    for (const name of ['accounts.json', 'budgets.json']) {
      const file = join(dataDir, name)
      if (!existsSync(file)) continue
      const items = JSON.parse(readFileSync(file, 'utf8')) as object[]
      writeJsonAtomic(
        file,
        items.map((item) => ({ areaId: DEFAULT_AREA.id, ...item }))
      )
    }
  }
]

export class Store {
  constructor(public readonly dataDir: string) {}

  private file(name: string): string {
    return join(this.dataDir, name)
  }

  /** Legt den Datenordner an, befüllt ihn beim ersten Start und migriert ältere Stände. */
  init(): void {
    mkdirSync(this.file(TRANSACTIONS_DIR), { recursive: true })

    const metaFile = this.file(META_FILE)
    if (!existsSync(metaFile)) {
      if (!existsSync(this.file('categories.json'))) {
        writeJsonAtomic(this.file('categories.json'), defaultCategories())
      }
      if (!existsSync(this.file('areas.json'))) {
        writeJsonAtomic(this.file('areas.json'), [DEFAULT_AREA])
      }
      this.writeMeta({ schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString() })
      return
    }

    const meta = readJson<Meta | null>(metaFile, metaSchema, null)!
    if (meta.schemaVersion > SCHEMA_VERSION) {
      throw new StorageError(
        META_FILE,
        `Die Daten stammen aus einer neueren Kontor-Version (Schema ${meta.schemaVersion}, diese Version kennt ${SCHEMA_VERSION}).`
      )
    }
    if (meta.schemaVersion < SCHEMA_VERSION) {
      createBackup(this.dataDir, { label: `vor-migration-v${meta.schemaVersion}` })
      for (let v = meta.schemaVersion; v < SCHEMA_VERSION; v++) {
        migrations[v - 1](this.dataDir)
        this.writeMeta({ ...meta, schemaVersion: v + 1 })
      }
    }
  }

  private writeMeta(meta: Meta): void {
    writeJsonAtomic(this.file(META_FILE), meta)
  }

  load(): KontorData {
    const transactions: Transaction[] = []
    for (const name of readdirSync(this.file(TRANSACTIONS_DIR)).sort()) {
      if (!YEAR_FILE.test(name)) continue
      transactions.push(...readJson(this.file(join(TRANSACTIONS_DIR, name)), transactionsSchema, []))
    }

    return {
      areas: readJson(this.file('areas.json'), collectionSchemas.areas, [DEFAULT_AREA]),
      accounts: readJson(this.file('accounts.json'), collectionSchemas.accounts, []),
      categories: readJson(this.file('categories.json'), collectionSchemas.categories, []),
      recurring: readJson(this.file('recurring.json'), collectionSchemas.recurring, []),
      budgets: readJson(this.file('budgets.json'), collectionSchemas.budgets, []),
      dismissedPatterns: readJson(this.file('dismissedPatterns.json'), collectionSchemas.dismissedPatterns, []),
      transactions
    }
  }

  /** Daten kommen aus dem Renderer und werden deshalb vor dem Schreiben erneut geprüft. */
  save(collection: CollectionName, data: unknown): void {
    const schema = collectionSchemas[collection]
    if (!schema) throw new Error(`Unbekannte Sammlung: ${String(collection)}`)
    writeJsonAtomic(this.file(`${collection}.json`), schema.parse(data))
  }

  saveTransactions(year: number, data: unknown): void {
    if (!Number.isInteger(year) || year < 1000 || year > 9999) {
      throw new Error(`Ungültiges Jahr: ${year}`)
    }
    const transactions = transactionsSchema.parse(data)
    const stray = transactions.find((tx) => !tx.date.startsWith(`${year}-`))
    if (stray) {
      throw new Error(`Buchung ${stray.id} vom ${stray.date} gehört nicht ins Jahr ${year}`)
    }
    writeJsonAtomic(this.file(join(TRANSACTIONS_DIR, `${year}.json`)), transactions)
  }
}
