import type { Category, KontorData } from './schemas'

/** Anzahl der Buchungen und wiederkehrenden Regeln, die an einer Kategorie hängen. */
export function categoryUsage(data: Pick<KontorData, 'transactions' | 'recurring'>, id: string): number {
  return (
    data.transactions.filter((t) => t.categoryId === id).length +
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

type CategoryData =Pick<KontorData, 'categories' | 'transactions' | 'recurring' | 'budgets'>

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

  return {
    categories: data.categories.filter((c) => c.id !== id),
    transactions: data.transactions.map(move),
    recurring: data.recurring.map(move),
    budgets: data.budgets.filter((b) => b.categoryId !== id)
  }
}
