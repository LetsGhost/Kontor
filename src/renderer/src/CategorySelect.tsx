import { useRef, useState, type KeyboardEvent } from 'react'
import { categoryNameTaken } from '../../shared/categories'
import { FALLBACK_ICON } from '../../shared/defaultCategories'
import { crossesAreas } from '../../shared/draft'
import type { Category } from '../../shared/schemas'
import { useApp } from './store'
import { Button, Field, inputClass } from './ui'

// Kein gültiger Kategorie-Schlüssel: Kategorien bekommen UUIDs.
const CREATE = '__new__'

/**
 * Kategorie für eine Umbuchung in einen anderen Bereich. Für den Quellbereich ist sie eine Ausgabe
 * (z. B. der Beitrag zum Haushaltskonto); innerhalb eines Bereichs bleibt das Feld weg.
 */
export function TransferCategoryField({
  accountId,
  transferAccountId,
  value,
  onChange,
  creatable
}: {
  accountId: string
  transferAccountId: string
  value: string
  onChange: (categoryId: string) => void
  creatable?: boolean
}) {
  const { accounts, areas } = useApp((s) => s.data)
  if (!crossesAreas(accounts, accountId, transferAccountId)) return null
  const source = areas.find((a) => a.id === accounts.find((acc) => acc.id === accountId)?.areaId)

  return (
    <Field label={`Kategorie (zählt in „${source?.name ?? ''}“ als Ausgabe)`}>
      <CategorySelect kind="expense" value={value} onChange={onChange} creatable={creatable} />
    </Field>
  )
}

/**
 * Auswahl einer Kategorie, gruppiert nach Hauptkategorie. Der leere Wert steht für „ohne Kategorie“.
 * Mit `creatable` lässt sich eine fehlende Kategorie direkt an Ort und Stelle anlegen.
 */
export function CategorySelect({
  kind,
  value,
  onChange,
  creatable = false
}: {
  kind: Category['kind']
  value: string
  onChange: (categoryId: string) => void
  creatable?: boolean
}) {
  const categories = useApp((s) => s.data.categories)
  const [creating, setCreating] = useState(false)
  // Nach dem Anlegen oder Abbrechen soll die Tastatur wieder auf der Auswahl stehen.
  const refocus = useRef(false)
  const parents = categories.filter((c) => c.parentId === null && c.kind === kind && !c.archived)

  if (creating) {
    const current = categories.find((c) => c.id === value)
    return (
      <NewCategory
        key={kind}
        kind={kind}
        parents={parents}
        defaultParentId={current ? (current.parentId ?? current.id) : ''}
        onCreated={(id) => {
          onChange(id)
          refocus.current = true
          setCreating(false)
        }}
        onCancel={() => {
          refocus.current = true
          setCreating(false)
        }}
      />
    )
  }

  return (
    <select
      ref={(el) => {
        if (el && refocus.current) {
          refocus.current = false
          el.focus()
        }
      }}
      className={inputClass}
      value={value}
      onChange={(e) => (e.target.value === CREATE ? setCreating(true) : onChange(e.target.value))}
    >
      <option value="">Ohne Kategorie</option>
      {parents.map((parent) => (
        <optgroup key={parent.id} label={parent.name}>
          <option value={parent.id}>{parent.name} (allgemein)</option>
          {categories
            .filter((c) => c.parentId === parent.id && !c.archived)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </optgroup>
      ))}
      {creatable && <option value={CREATE}>+ Neue Kategorie …</option>}
    </select>
  )
}

/** Schnelles Anlegen aus einem Formular heraus. Symbol und Budget lassen sich später unter „Kategorien“ setzen. */
function NewCategory({
  kind,
  parents,
  defaultParentId,
  onCreated,
  onCancel
}: {
  kind: Category['kind']
  parents: Category[]
  defaultParentId: string
  onCreated: (categoryId: string) => void
  onCancel: () => void
}) {
  const categories = useApp((s) => s.data.categories)
  const saveCollection = useApp((s) => s.saveCollection)
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState(defaultParentId)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const create = async (): Promise<void> => {
    const trimmed = name.trim()
    const parent = parents.find((p) => p.id === parentId) ?? null
    if (!trimmed) {
      setError('Bitte einen Namen eingeben')
      return
    }
    if (categoryNameTaken(categories, { kind, parentId: parent?.id ?? null, name: trimmed })) {
      setError('Diese Kategorie gibt es hier schon')
      return
    }

    const category: Category = {
      id: crypto.randomUUID(),
      name: trimmed,
      parentId: parent?.id ?? null,
      kind,
      color: parent?.color ?? '#94a3b8',
      icon: parent?.icon ?? FALLBACK_ICON,
      archived: false
    }
    setSaving(true)
    try {
      await saveCollection('categories', [...categories, category])
    } catch (err) {
      setError(`Speichern fehlgeschlagen: ${(err as Error).message}`)
      setSaving(false)
      return
    }
    onCreated(category.id)
  }

  // Das Feld sitzt in einem fremden Formular: Enter legt nur die Kategorie an, Escape schließt nur dieses Feld.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void create()
    } else if (e.key === 'Escape') {
      e.nativeEvent.stopPropagation()
      onCancel()
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-line p-3" onKeyDown={onKey}>
      <input
        autoFocus
        className={inputClass}
        placeholder={kind === 'income' ? 'Name der neuen Einnahmen-Kategorie' : 'Name der neuen Ausgaben-Kategorie'}
        aria-label="Name der neuen Kategorie"
        value={name}
        onChange={(e) => {
          setName(e.target.value)
          setError(null)
        }}
      />
      <select
        className={inputClass}
        aria-label="Einordnung"
        value={parentId}
        onChange={(e) => {
          setParentId(e.target.value)
          setError(null)
        }}
      >
        <option value="">Als Hauptkategorie</option>
        {parents.map((p) => (
          <option key={p.id} value={p.id}>
            Unter „{p.name}“
          </option>
        ))}
      </select>
      {error && <span className="block text-xs text-danger">{error}</span>}
      <div className="flex justify-end gap-2">
        <Button small variant="ghost" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button small disabled={saving} onClick={() => void create()}>
          Anlegen
        </Button>
      </div>
    </div>
  )
}
