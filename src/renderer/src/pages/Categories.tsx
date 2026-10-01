import { Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { categoryUsage, childrenOf } from '../../../shared/categories'
import { FALLBACK_ICON } from '../../../shared/defaultCategories'
import { useArea } from '../area'
import { CategoryIcon, categoryIcons } from '../icons'
import { centsToInput, formatCents, parseAmount } from '../../../shared/money'
import type { Category } from '../../../shared/schemas'
import { useApp } from '../store'
import { Button, ConfirmRow, Field, Modal, inputClass } from '../ui'

type FormTarget = { editing: Category } | { parent: Category | null; kind: Category['kind'] }

export function Categories() {
  const data = useApp((s) => s.data)
  const deleteCategory = useApp((s) => s.deleteCategory)
  const [form, setForm] = useState<FormTarget | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [moving, setMoving] = useState<Category | null>(null)
  const { area } = useArea()
  const { categories } = data
  // Budgets gelten je Bereich; hier stehen die des gewählten.
  const budgets = data.budgets.filter((b) => b.areaId === area.id)

  const askDelete = (category: Category): void => {
    if (categoryUsage(data, category.id) > 0) setMoving(category)
    else setConfirmDelete(category.id)
  }

  const row = (category: Category, isChild: boolean) => {
    const hasChildren = childrenOf(categories, category.id).length > 0
    const budget = budgets.find((b) => b.categoryId === category.id)
    const usage = categoryUsage(data, category.id)

    return (
      <li key={category.id} className={`group flex items-center gap-3 py-2 text-sm ${isChild ? 'pl-7' : ''}`}>
        <CategoryIcon name={category.icon} className="shrink-0" />
        <span className={`min-w-0 flex-1 truncate ${isChild ? 'text-muted' : ''}`}>{category.name}</span>
        {budget && <span className="num text-xs text-muted">Budget {formatCents(budget.limitCents)}</span>}
        <span className="w-24 text-right text-xs text-muted">
          {usage === 0 ? '' : `${usage} ${usage === 1 ? 'Eintrag' : 'Einträge'}`}
        </span>
        {confirmDelete === category.id ? (
          <ConfirmRow
            question="Kategorie löschen?"
            confirmLabel="Löschen"
            onConfirm={() => deleteCategory(category.id, null).then(() => setConfirmDelete(null))}
            onCancel={() => setConfirmDelete(null)}
          />
        ) : (
          <div className="flex gap-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
            {!isChild && (
              <Button small variant="ghost" onClick={() => setForm({ parent: category, kind: category.kind })}>
                <Plus size={13} /> Unterkategorie
              </Button>
            )}
            <Button small variant="ghost" onClick={() => setForm({ editing: category })}>
              Bearbeiten
            </Button>
            <Button
              small
              variant="ghost"
              disabled={hasChildren}
              title={hasChildren ? 'Zuerst die Unterkategorien löschen' : undefined}
              onClick={() => askDelete(category)}
            >
              Löschen
            </Button>
          </div>
        )}
      </li>
    )
  }

  const section = (kind: Category['kind'], title: string) => (
    <section className="space-y-2">
      <div className="flex items-end justify-between">
        <h2 className="text-sm font-medium">{title}</h2>
        <Button small onClick={() => setForm({ parent: null, kind })}>
          <Plus size={13} /> Hauptkategorie
        </Button>
      </div>
      <ul className="ledger">
        {categories
          .filter((c) => c.kind === kind && c.parentId === null)
          .flatMap((parent) => [row(parent, false), ...childrenOf(categories, parent.id).map((c) => row(c, true))])}
      </ul>
    </section>
  )

  return (
    <div className="max-w-3xl space-y-8">
      <h1 className="text-2xl font-semibold">Kategorien</h1>
      {section('expense', 'Ausgaben')}
      {section('income', 'Einnahmen')}
      {form && <CategoryForm target={form} onClose={() => setForm(null)} />}
      {moving && <MoveAndDelete category={moving} onClose={() => setMoving(null)} />}
    </div>
  )
}

function CategoryForm({ target, onClose }: { target: FormTarget; onClose: () => void }) {
  const { categories, budgets } = useApp((s) => s.data)
  const saveCollection = useApp((s) => s.saveCollection)
  const editing = 'editing' in target ? target.editing : null
  const parent = editing
    ? (categories.find((c) => c.id === editing.parentId) ?? null)
    : 'parent' in target
      ? target.parent
      : null
  const kind = editing?.kind ?? ('kind' in target ? target.kind : 'expense')
  const { area, several } = useArea()
  const isHere = (b: { areaId: string; categoryId: string }): boolean =>
    b.areaId === area.id && b.categoryId === editing?.id
  const existingBudget = editing ? budgets.find(isHere) : undefined

  const [name, setName] = useState(editing?.name ?? '')
  const [icon, setIcon] = useState(editing?.icon ?? FALLBACK_ICON)
  const [budget, setBudget] = useState(existingBudget ? centsToInput(existingBudget.limitCents) : '')
  const [errors, setErrors] = useState<{ name?: string; budget?: string }>({})

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const next: typeof errors = {}
    const trimmed = name.trim()
    const parentId = parent?.id ?? null

    if (!trimmed) next.name = 'Bitte einen Namen eingeben'
    else if (
      categories.some(
        (c) =>
          c.id !== editing?.id &&
          c.kind === kind &&
          c.parentId === parentId &&
          c.name.toLowerCase() === trimmed.toLowerCase()
      )
    ) {
      next.name = 'Diese Kategorie gibt es hier schon'
    }

    const limitCents = budget.trim() === '' ? null : parseAmount(budget)
    if (budget.trim() !== '' && (limitCents === null || limitCents <= 0)) {
      next.budget = 'Bitte einen Betrag größer als 0 eingeben oder das Feld leer lassen'
    }

    setErrors(next)
    if (Object.keys(next).length > 0) return

    const category: Category = {
      id: editing?.id ?? crypto.randomUUID(),
      name: trimmed,
      parentId,
      kind,
      color: editing?.color ?? parent?.color ?? '#94a3b8',
      icon,
      archived: false
    }
    const nextCategories = editing
      ? categories.map((c) => (c.id === category.id ? category : c))
      : [...categories, category]
    await saveCollection('categories', nextCategories)

    const otherBudgets = budgets.filter((b) => !isHere(b))
    await saveCollection(
      'budgets',
      limitCents ? [...otherBudgets, { areaId: area.id, categoryId: category.id, limitCents }] : otherBudgets
    )
    onClose()
  }

  const title = editing ? 'Kategorie bearbeiten' : parent ? `Unterkategorie von „${parent.name}“` : 'Hauptkategorie anlegen'

  return (
    <Modal title={title} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Name" error={errors.name}>
          <input autoFocus className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="space-y-1">
          <span className="text-xs text-muted">Symbol</span>
          <div className="grid grid-cols-12 gap-1" role="radiogroup" aria-label="Symbol">
            {Object.keys(categoryIcons).map((name) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={icon === name}
                aria-label={name}
                onClick={() => setIcon(name)}
                className={`flex aspect-square items-center justify-center rounded-md border ${
                  icon === name ? 'border-text text-text' : 'border-transparent text-muted hover:bg-raised hover:text-text'
                }`}
              >
                <CategoryIcon name={name} size={17} />
              </button>
            ))}
          </div>
        </div>
        {kind === 'expense' && (
          <Field
            label={`Monatsbudget ${several ? `für „${area.name}“ ` : ''}in € (leer = kein Budget)`}
            error={errors.budget}
          >
            <input
              className={inputClass}
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </Field>
        )}
        {kind === 'expense' && !parent && (
          <p className="text-xs text-muted">Das Budget einer Hauptkategorie gilt für alle ihre Unterkategorien zusammen.</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button variant="primary" type="submit">
            Speichern
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** Eine benutzte Kategorie wird erst gelöscht, wenn klar ist, wohin ihre Buchungen wandern. */
function MoveAndDelete({ category, onClose }: { category: Category; onClose: () => void }) {
  const data = useApp((s) => s.data)
  const deleteCategory = useApp((s) => s.deleteCategory)
  const [replacement, setReplacement] = useState('')
  const usage = categoryUsage(data, category.id)
  const byId = new Map(data.categories.map((c) => [c.id, c]))
  const options = data.categories.filter((c) => c.kind === category.kind && c.id !== category.id)

  const label = (c: Category): string => {
    const parent = c.parentId ? byId.get(c.parentId) : undefined
    return parent ? `${parent.name} › ${c.name}` : c.name
  }

  return (
    <Modal title={`„${category.name}“ löschen`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm">
          An dieser Kategorie {usage === 1 ? 'hängt 1 Eintrag' : `hängen ${usage} Einträge`}. Wohin sollen sie
          verschoben werden?
        </p>
        <Field label="Verschieben nach">
          <select autoFocus className={inputClass} value={replacement} onChange={(e) => setReplacement(e.target.value)}>
            <option value="">Ohne Kategorie</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {label(c)}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button variant="danger" onClick={() => deleteCategory(category.id, replacement || null).then(onClose)}>
            Verschieben und löschen
          </Button>
        </div>
      </div>
    </Modal>
  )
}
