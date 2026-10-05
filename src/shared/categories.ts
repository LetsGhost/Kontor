import type { Category, KontorData, Split, Transaction } from './schemas'

export interface CategoryPart {
  categoryId: string | null
  amountCents: number
}

/** Die Kategorien einer Buchung mit ihrem Anteil: die Teile einer Aufteilung, sonst die Buchung selbst. */
export function categoryParts(
  tx: Pick<Transaction, 'categoryId' | 'amountCents'> & { splits?: Split[] }
): CategoryPart[] {
  return tx.splits && tx.splits.length > 0
    ? tx.splits.map((s) => ({ categoryId: s.categoryId, amountCents: s.amountCents }))
    : [{ categoryId: tx.categoryId, amountCents: tx.amountCents }]
}

/** Ob eine Buchung, auch über einen ihrer Teile, an dieser Kategorie hängt. */
export const usesCategory = (tx: Pick<Transaction, 'categoryId' | 'splits'>, id: string): boolean =>
  tx.categoryId === id || tx.splits.some((s) => s.categoryId === id)

/** Anzahl der Buchungen und wiederkehrenden Regeln, die an einer Kategorie hängen. */
export function categoryUsage(data: Pick<KontorData, 'transactions' | 'recurring'>, id: string): number {
  return (
    data.transactions.filter((t) => usesCategory(t, id)).length +
    data.recurring.filter((r) => r.categoryId === id).length
  )
}

export function childrenOf(categories: Category[], id: string): Category[] {
  return categories.filter((c) => c.parentId === id)
}

/** Ob es an derselben Stelle (gleiche Art, gleiche Hauptkategorie) schon eine Kategorie dieses Namens gibt. */
export function categoryNameTaken(
  categories: Category[],
  candidate: Pick<Category, 'kind' | 'parentId' | 'name'>,
  exceptId?: string
): boolean {
  const name = candidate.name.trim().toLowerCase()
  return categories.some(
    (c) =>
      c.id !== exceptId &&
      c.kind === candidate.kind &&
      c.parentId === candidate.parentId &&
      c.name.toLowerCase() === name
  )
}

type CategoryData = Pick<KontorData, 'categories' | 'transactions' | 'recurring' | 'budgets'>

/**
 * Entfernt eine Kategorie und hängt alles, was auf sie zeigt, an `replacementId` (null = ohne Kategorie).
 * Ihr Budget entfällt. Hauptkategorien mit Unterkategorien müssen zuerst geleert werden.
 */
export function removeCategory(data: CategoryData, id: string, replacementId: string | null): CategoryData {
  if (childrenOf(data.categories, id).length > 0) {
    throw new Error('Kategorie hat noch Unterkategorien')
  }
  if (replacementId === id) throw new Error('Ersatz muss eine andere Kategorie sein')

  const move = <T extends { categoryId: string | null }>(item: T): T =>
    item.categoryId === id ? { ...item, categoryId: replacementId } : item

  const moveSplits = (tx: Transaction): Transaction =>
    tx.splits.some((s) => s.categoryId === id) ? { ...tx, splits: tx.splits.map(move) } : tx

  return {
    categories: data.categories.filter((c) => c.id !== id),
    transactions: data.transactions.map((tx) => moveSplits(move(tx))),
    recurring: data.recurring.map(move),
    budgets: data.budgets.filter((b) => b.categoryId !== id)
  }
}
