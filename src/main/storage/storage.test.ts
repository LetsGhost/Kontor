import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_AREA, SCHEMA_VERSION, type Account, type Transaction } from '../../shared/schemas'
import { ATTACHMENTS_DIR, attachmentPath, pruneAttachments, saveAttachment } from './attachments'
import { MAX_BACKUPS, createBackup, ensureDailyBackup, listBackups, restoreBackup } from './backup'
import { StorageError, renameWithRetry } from './files'
import { Store } from './store'

let dir: string
let store: Store

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kontor-test-'))
  store = new Store(dir)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const giro: Account = {
  id: 'giro',
  areaId: DEFAULT_AREA.id,
  name: 'Girokonto',
  type: 'giro',
  openingBalanceCents: 10000,
  openingDate: '2026-01-01',
  archived: false
}

const tx = (id: string, date: string): Transaction => ({
  id,
  date,
  accountId: 'giro',
  type: 'expense',
  amountCents: 1999,
  payee: 'REWE',
  note: '',
  categoryId: null,
  transferAccountId: null,
  recurringId: null,
  importHash: null,
  splits: [],
  attachments: [],
  createdAt: '2026-01-01T00:00:00.000Z'
})

describe('Store', () => {
  it('legt beim ersten Start Meta-Datei und Standardkategorien an', () => {
    store.init()
    const data = store.load()
    expect(data.categories.length).toBeGreaterThan(0)
    expect(data.accounts).toEqual([])
    expect(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')).schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('migriert Emoji-Icons aus Schema 1 auf Icon-Namen und sichert vorher den alten Stand', () => {
    store.init()
    const custom = { id: 'eigene', name: 'Eigene', parentId: null, kind: 'expense', color: '#fff', icon: '🎯', archived: false }
    const wohnen = { ...custom, id: 'cat-wohnen', name: 'Wohnen', icon: '🏠' }
    writeFileSync(join(dir, 'categories.json'), JSON.stringify([wohnen, custom]))
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ schemaVersion: 1, createdAt: '' }))

    store.init()

    expect(store.load().categories.map((c) => c.icon)).toEqual(['home', 'tag'])
    expect(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')).schemaVersion).toBe(SCHEMA_VERSION)
    expect(listBackups(dir)[0].name).toMatch(/vor-migration-v1$/)
  })

  it('migriert Schema 2 auf Bereiche: Konten und Budgets landen in „Privat“', () => {
    store.init()
    const { areaId: _, ...oldAccount } = giro
    writeFileSync(join(dir, 'accounts.json'), JSON.stringify([oldAccount]))
    writeFileSync(join(dir, 'budgets.json'), JSON.stringify([{ categoryId: 'cat-wohnen', limitCents: 5000 }]))
    rmSync(join(dir, 'areas.json'))
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ schemaVersion: 2, createdAt: '' }))

    store.init()

    const data = store.load()
    expect(data.areas).toEqual([DEFAULT_AREA])
    expect(data.accounts).toEqual([giro])
    expect(data.budgets).toEqual([{ areaId: DEFAULT_AREA.id, categoryId: 'cat-wohnen', limitCents: 5000 }])
  })

  it('migriert Schema 3: Buchungen ohne Aufteilung und Belege, Regeln ohne Vertrag', () => {
    store.init()
    const { splits: _s, attachments: _a, ...old } = tx('a', '2026-02-01')
    writeFileSync(join(dir, 'transactions', '2026.json'), JSON.stringify([old]))
    writeFileSync(
      join(dir, 'recurring.json'),
      JSON.stringify([
        {
          id: 'r',
          accountId: 'giro',
          type: 'expense',
          amountCents: 999,
          payee: 'Abo',
          note: '',
          categoryId: null,
          transferAccountId: null,
          interval: 'monthly',
          startDate: '2026-01-01',
          endDate: null,
          nextDueDate: '2026-03-01',
          active: true
        }
      ])
    )
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ schemaVersion: 3, createdAt: '' }))

    store.init()
    const data = store.load()
    expect(data.transactions[0]).toMatchObject({ splits: [], attachments: [] })
    expect(data.recurring[0].contract).toBeNull()
    expect(listBackups(dir).some((b) => b.name.endsWith('vor-migration-v3'))).toBe(true)
  })

  it('überschreibt beim zweiten Start keine vorhandenen Daten', () => {
    store.init()
    store.save('categories', [])
    store.init()
    expect(store.load().categories).toEqual([])
  })

  it('speichert und lädt Konten und Buchungen, getrennt nach Jahr', () => {
    store.init()
    store.save('accounts', [giro])
    store.saveTransactions(2025, [tx('a', '2025-12-31')])
    store.saveTransactions(2026, [tx('b', '2026-01-01')])

    const data = store.load()
    expect(data.accounts).toEqual([giro])
    expect(data.transactions.map((t) => t.id)).toEqual(['a', 'b'])
    expect(readdirSync(join(dir, 'transactions')).sort()).toEqual(['2025.json', '2026.json'])
  })

  it('hinterlässt keine temp-Dateien', () => {
    store.init()
    store.save('accounts', [giro])
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('lehnt ungültige Daten ab, ohne die Datei anzufassen', () => {
    store.init()
    store.save('accounts', [giro])
    expect(() => store.save('accounts', [{ ...giro, openingBalanceCents: 1.5 }])).toThrow()
    expect(() => store.saveTransactions(2026, [tx('a', '2025-12-31')])).toThrow(/gehört nicht/)
    expect(store.load().accounts).toEqual([giro])
  })

  it('meldet eine kaputte Datei mit Namen, statt sie zu überschreiben', () => {
    store.init()
    writeFileSync(join(dir, 'accounts.json'), '{ kaputt')
    expect(() => store.load()).toThrow(StorageError)
    try {
      store.load()
    } catch (err) {
      expect((err as StorageError).file).toBe('accounts.json')
    }
    expect(readFileSync(join(dir, 'accounts.json'), 'utf8')).toBe('{ kaputt')
  })

  it('meldet Dateien, die nicht zum Schema passen', () => {
    store.init()
    writeFileSync(join(dir, 'accounts.json'), JSON.stringify([{ id: 'x' }]))
    expect(() => store.load()).toThrow(StorageError)
  })

  it('verweigert Daten aus einer neueren Schema-Version', () => {
    store.init()
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ schemaVersion: 99, createdAt: '' }))
    expect(() => store.init()).toThrow(/neueren Kontor-Version/)
  })
})

describe('Backups', () => {
  const at = (day: number, second = 0): Date => new Date(2026, 0, day, 12, 0, second)

  it('sichert nichts, solange es keine Daten gibt', () => {
    expect(createBackup(dir)).toBeNull()
  })

  it('kopiert alle Daten inklusive Buchungen', () => {
    store.init()
    store.saveTransactions(2026, [tx('a', '2026-01-01')])
    const name = createBackup(dir, { now: at(1) })!
    expect(existsSync(join(dir, 'backups', name, 'transactions', '2026.json'))).toBe(true)
    expect(existsSync(join(dir, 'backups', name, 'backups'))).toBe(false)
  })

  it('legt automatisch höchstens ein Backup pro Tag an', () => {
    store.init()
    ensureDailyBackup(dir, at(1))
    ensureDailyBackup(dir, at(1, 30))
    ensureDailyBackup(dir, at(2))
    expect(listBackups(dir)).toHaveLength(2)
  })

  it(`behält nur die letzten ${MAX_BACKUPS} Stände`, () => {
    store.init()
    for (let day = 1; day <= MAX_BACKUPS + 3; day++) createBackup(dir, { now: at(day) })
    const names = listBackups(dir).map((b) => b.name)
    expect(names).toHaveLength(MAX_BACKUPS)
    expect(names[0]).toMatch(/^2026-01-13/)
    expect(names.at(-1)).toMatch(/^2026-01-04/)
  })

  it('stellt einen Stand wieder her und sichert vorher den aktuellen', () => {
    store.init()
    store.save('accounts', [giro])
    const name = createBackup(dir, { now: at(1) })!

    store.save('accounts', [])
    store.saveTransactions(2026, [tx('neu', '2026-01-02')])
    restoreBackup(dir, name, at(2))

    const data = store.load()
    expect(data.accounts).toEqual([giro])
    expect(data.transactions).toEqual([])
    expect(listBackups(dir)[0].name).toMatch(/vor-wiederherstellung$/)
  })

  it('verliert das gewählte Backup nicht, wenn es das älteste von zehn ist', () => {
    store.init()
    store.save('accounts', [giro])
    const oldest = createBackup(dir, { now: at(1) })!
    store.save('accounts', [])
    for (let day = 2; day <= MAX_BACKUPS; day++) createBackup(dir, { now: at(day) })

    restoreBackup(dir, oldest, at(20))
    expect(store.load().accounts).toEqual([giro])
  })

  it('lehnt unbekannte Namen und Pfade ab', () => {
    store.init()
    createBackup(dir, { now: at(1) })
    expect(() => restoreBackup(dir, '..')).toThrow(/nicht gefunden/)
  })
})

describe('renameWithRetry', () => {
  const failing = (codes: string[]) => {
    const calls: string[] = []
    const rename = (): void => {
      const code = codes[calls.length]
      calls.push(code ?? 'ok')
      if (code) throw Object.assign(new Error(code), { code })
    }
    return { calls, rename }
  }

  it('versucht es erneut, solange Windows die Datei kurz sperrt', () => {
    const { calls, rename } = failing(['EPERM', 'EBUSY'])
    renameWithRetry('a', 'b', rename, () => {})
    expect(calls).toEqual(['EPERM', 'EBUSY', 'ok'])
  })

  it('gibt bei anderen Fehlern und nach dem letzten Versuch auf', () => {
    expect(() => renameWithRetry('a', 'b', failing(['ENOENT']).rename, () => {})).toThrow('ENOENT')
    const stuck = failing(Array(10).fill('EPERM'))
    expect(() => renameWithRetry('a', 'b', stuck.rename, () => {})).toThrow('EPERM')
    expect(stuck.calls).toHaveLength(6)
  })
})

describe('Belege', () => {
  const bytes = new TextEncoder().encode('%PDF-1.4 Beleg')
  const old = (name: string): void => {
    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    utimesSync(join(dir, ATTACHMENTS_DIR, name), past, past)
  }

  it('legt gleichen Inhalt nur einmal ab und prüft Typ und Namen', () => {
    store.init()
    const name = saveAttachment(dir, bytes, 'pdf')
    expect(name).toMatch(/^[a-f0-9]{32}\.pdf$/)
    expect(saveAttachment(dir, bytes, 'pdf')).toBe(name)
    expect(readFileSync(attachmentPath(dir, name), 'utf8')).toBe('%PDF-1.4 Beleg')
    expect(() => saveAttachment(dir, bytes, 'exe')).toThrow(/nicht erlaubt/)
    expect(() => attachmentPath(dir, '../meta.json')).toThrow(/Ungültiger/)
  })

  it('sichert Belege nicht mit, löscht sie aber erst, wenn auch kein Backup sie mehr kennt', () => {
    store.init()
    const name = saveAttachment(dir, bytes, 'pdf')
    store.saveTransactions(2026, [{ ...tx('a', '2026-02-01'), attachments: [name] }])
    const backup = createBackup(dir)!
    expect(existsSync(join(dir, 'backups', backup, ATTACHMENTS_DIR))).toBe(false)

    // Buchung gelöscht, aber das Backup zeigt noch auf den Beleg.
    store.saveTransactions(2026, [])
    old(name)
    expect(pruneAttachments(dir)).toBe(0)

    rmSync(join(dir, 'backups'), { recursive: true })
    expect(pruneAttachments(dir)).toBe(1)
    expect(existsSync(join(dir, ATTACHMENTS_DIR, name))).toBe(false)
  })

  it('verschont frisch hinzugefügte Belege und übersteht das Zurückspielen eines Backups', () => {
    store.init()
    const name = saveAttachment(dir, bytes, 'pdf')
    expect(pruneAttachments(dir)).toBe(0)

    store.saveTransactions(2026, [{ ...tx('a', '2026-02-01'), attachments: [name] }])
    const backup = createBackup(dir)!
    store.saveTransactions(2026, [])
    restoreBackup(dir, backup)
    expect(store.load().transactions[0].attachments).toEqual([name])
    expect(existsSync(join(dir, ATTACHMENTS_DIR, name))).toBe(true)
  })
})
