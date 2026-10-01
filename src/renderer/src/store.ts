import { create } from 'zustand'
import type { AppInfo } from '../../shared/api'
import { removeCategory } from '../../shared/categories'
import type { CollectionName, KontorData, Transaction } from '../../shared/schemas'

type Status =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; file: string; message: string }

interface AppState {
  status: Status
  info: AppInfo | null
  data: KontorData
  /** Der gewählte Bereich. Ungültige oder fehlende Werte fängt useArea ab. */
  areaId: string | null
  setArea(id: string): void
  /** Lädt alles neu von der Platte, auch nach dem Zurückspielen eines Backups. */
  reload(): Promise<void>
  saveCollection<K extends CollectionName>(collection: K, value: KontorData[K]): Promise<void>
  /** Legt Buchungen an oder ersetzt die mit derselben id. */
  putTransactions(txs: Transaction[]): Promise<void>
  removeTransaction(id: string): Promise<void>
  /** Löscht eine Kategorie und hängt ihre Buchungen an `replacementId` (null = ohne Kategorie). */
  deleteCategory(id: string, replacementId: string | null): Promise<void>
}

const AREA_KEY = 'kontor.area'

// Welcher Bereich zuletzt offen war, ist reine Bequemlichkeit und gehört nicht in die Finanzdaten.
function storedArea(): string | null {
  try {
    return localStorage.getItem(AREA_KEY)
  } catch {
    return null
  }
}

const emptyData: KontorData = {
  areas: [],
  accounts: [],
  categories: [],
  recurring: [],
  budgets: [],
  dismissedPatterns: [],
  transactions: []
}

const yearOf = (tx: Transaction): number => Number(tx.date.slice(0, 4))

export const useApp = create<AppState>((set, get) => {
  // Erst schreiben, dann den Zustand übernehmen: schlägt das Speichern fehl, zeigt die App nichts Falsches.
  const writeTransactions = async (next: Transaction[], years: Set<number>): Promise<void> => {
    for (const year of years) {
      await window.kontor.saveTransactions(
        year,
        next.filter((tx) => yearOf(tx) === year)
      )
    }
    set((s) => ({ data: { ...s.data, transactions: next } }))
  }

  return {
    status: { kind: 'loading' },
    info: null,
    data: emptyData,
    areaId: storedArea(),

    setArea(id) {
      try {
        localStorage.setItem(AREA_KEY, id)
      } catch {
        // Ohne Speicher gilt die Wahl eben nur bis zum Neustart.
      }
      set({ areaId: id })
    },

    async reload() {
      const [info, result] = await Promise.all([window.kontor.info(), window.kontor.load()])
      if (result.ok) {
        set({ info, data: result.data, status: { kind: 'ready' } })
      } else {
        set({ info, data: emptyData, status: { kind: 'error', ...result.error } })
      }
    },

    async saveCollection(collection, value) {
      await window.kontor.save(collection, value)
      set((s) => ({ data: { ...s.data, [collection]: value } }))
    },

    async putTransactions(txs) {
      const current = get().data.transactions
      const incoming = new Map(txs.map((tx) => [tx.id, tx]))
      // Wechselt eine Buchung das Jahr, müssen beide Jahresdateien neu geschrieben werden.
      const years = new Set(txs.map(yearOf))
      const next = current.map((tx) => {
        const replacement = incoming.get(tx.id)
        if (!replacement) return tx
        years.add(yearOf(tx))
        incoming.delete(tx.id)
        return replacement
      })
      await writeTransactions([...next, ...incoming.values()], years)
    },

    async removeTransaction(id) {
      const current = get().data.transactions
      const previous = current.find((t) => t.id === id)
      if (!previous) return
      await writeTransactions(
        current.filter((t) => t.id !== id),
        new Set([yearOf(previous)])
      )
    },

    async deleteCategory(id, replacementId) {
      const { data } = get()
      const next = removeCategory(data, id, replacementId)
      const years = new Set(data.transactions.filter((t) => t.categoryId === id).map(yearOf))
      // Die Kategorie selbst zuletzt entfernen, damit bei einem Abbruch nichts auf eine fehlende zeigt.
      await writeTransactions(next.transactions, years)
      await get().saveCollection('recurring', next.recurring)
      await get().saveCollection('budgets', next.budgets)
      await get().saveCollection('categories', next.categories)
    }
  }
})
