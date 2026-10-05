import { Check, ChevronDown, Plus } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { categoryNameTaken } from '../../shared/categories'
import { FALLBACK_ICON } from '../../shared/defaultCategories'
import { crossesAreas } from '../../shared/draft'
import type { Category } from '../../shared/schemas'
import { CategoryIcon } from './icons'
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

/** Eine Zeile der Auswahlliste: „ohne Kategorie“ (id leer), eine Kategorie oder „neu anlegen“ (id CREATE). */
interface Row {
  id: string
  category?: Category
  parent?: Category
}

/**
 * Auswahl einer Kategorie mit Suche: Tippen filtert, Pfeiltasten und Enter wählen.
 * Der leere Wert steht für „ohne Kategorie“. `suggestions` erscheinen als Schnellwahl unter dem Feld.
 * Mit `creatable` lässt sich eine fehlende Kategorie direkt an Ort und Stelle anlegen.
 */
export function CategorySelect({
  kind,
  value,
  onChange,
  creatable = false,
  suggestions = []
}: {
  kind: Category['kind']
  value: string
  onChange: (categoryId: string) => void
  creatable?: boolean
  suggestions?: string[]
}) {
  const categories = useApp((s) => s.data.categories)
  // Der Name, mit dem das Anlegen startet; null, solange nichts angelegt wird.
  const [creating, setCreating] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  // Nach dem Anlegen oder Abbrechen soll die Tastatur wieder auf der Auswahl stehen.
  const refocus = useRef(false)
  const listId = useId()

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    if (refocus.current) {
      refocus.current = false
      el.focus()
    }
    // Der Name der gewählten Kategorie ist markiert, damit Weitertippen ihn ersetzt statt verlängert.
    if (!open && document.activeElement === el) el.select()
  }, [open, value, creating])

  const parents = categories.filter((c) => c.parentId === null && c.kind === kind && !c.archived)
  const selected = categories.find((c) => c.id === value)

  if (creating !== null) {
    return (
      <NewCategory
        key={kind}
        kind={kind}
        parents={parents}
        initialName={creating}
        defaultParentId={selected ? (selected.parentId ?? selected.id) : ''}
        onCreated={(id) => {
          onChange(id)
          refocus.current = true
          setCreating(null)
        }}
        onCancel={() => {
          refocus.current = true
          setCreating(null)
        }}
      />
    )
  }

  const needle = query.trim().toLowerCase()
  const matches = (c: Category): boolean => c.name.toLowerCase().includes(needle)
  const rows: Row[] = needle ? [] : [{ id: '' }]
  for (const parent of parents) {
    // Trifft die Suche die Hauptkategorie, bleibt die ganze Gruppe stehen.
    const whole = matches(parent)
    if (whole) rows.push({ id: parent.id, category: parent })
    for (const c of categories) {
      if (c.parentId === parent.id && !c.archived && (whole || matches(c))) {
        rows.push({ id: c.id, category: c, parent })
      }
    }
  }
  if (creatable && !rows.some((r) => r.category?.name.toLowerCase() === needle)) rows.push({ id: CREATE })

  const active = Math.min(highlight, rows.length - 1)
  const optionId = (i: number): string => `${listId}-${i}`

  const show = (): void => {
    setQuery('')
    // Geschlossen ist die Suche leer, `rows` also die ganze Liste.
    setHighlight(Math.max(0, rows.findIndex((r) => r.id === value)))
    setOpen(true)
  }

  const close = (): void => {
    setOpen(false)
    setQuery('')
  }

  const pick = (row: Row): void => {
    close()
    if (row.id === CREATE) setCreating(query.trim())
    else onChange(row.id)
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return show()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setHighlight((active + step + rows.length) % rows.length)
    } else if (!open) {
      return
    } else if (e.key === 'Enter') {
      // Enter wählt nur aus; das Formular drumherum wird erst beim nächsten Enter abgeschickt.
      e.preventDefault()
      if (rows[active]) pick(rows[active])
    } else if (e.key === 'Tab') {
      // Wer tippt und weiterspringt, meint den obersten Treffer.
      if (needle && rows[active]?.category) pick(rows[active])
    } else if (e.key === 'Escape') {
      // Escape schließt zuerst nur die Liste, nicht das ganze Formular.
      e.nativeEvent.stopPropagation()
      close()
    }
  }

  const chips = suggestions
    .map((id) => categories.find((c) => c.id === id))
    .filter((c): c is Category => c !== undefined)

  return (
    <div>
      <div className="relative">
        <span
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted"
          style={selected ? { color: selected.color } : undefined}
        >
          <CategoryIcon name={selected?.icon ?? FALLBACK_ICON} />
        </span>
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && rows.length > 0 ? optionId(active) : undefined}
          autoComplete="off"
          className={`${inputClass} px-9`}
          placeholder={selected?.name ?? 'Ohne Kategorie'}
          value={open ? query : (selected?.name ?? '')}
          onChange={(e) => {
            setQuery(e.target.value)
            setHighlight(0)
            setOpen(true)
          }}
          onClick={() => {
            if (!open) show()
          }}
          onKeyDown={onKey}
          onBlur={close}
        />
        <ChevronDown
          size={16}
          strokeWidth={1.75}
          className="pointer-events-none absolute inset-y-0 right-3 my-auto text-muted"
          aria-hidden
        />
        {open && (
          <ul
            id={listId}
            role="listbox"
            // Die Liste sitzt meist in einem <label>: Ohne das würde der Klick ans Eingabefeld weitergereicht.
            onClick={(e) => e.preventDefault()}
            className="absolute z-10 mt-1 max-h-64 w-max max-w-80 min-w-full overflow-y-auto rounded-md border border-line bg-raised py-1"
          >
            {rows.map((row, i) => (
              <li
                key={row.id}
                id={optionId(i)}
                role="option"
                aria-selected={row.id === value}
                ref={i === active ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                // mousedown statt click, damit das Feld den Fokus nicht vorher verliert
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(row)
                }}
                onMouseMove={() => setHighlight(i)}
                className={`flex cursor-pointer items-center gap-2 py-1.5 pr-3 text-sm ${
                  row.parent && !needle ? 'pl-8' : 'pl-3'
                } ${i === active ? 'bg-line' : ''} ${row.id === CREATE ? 'text-accent' : ''} ${
                  row.id === '' ? 'text-muted' : ''
                }`}
              >
                {row.category ? (
                  <>
                    <span className="shrink-0" style={{ color: row.category.color }}>
                      <CategoryIcon name={row.category.icon} />
                    </span>
                    <span className="truncate">{row.category.name}</span>
                    {row.parent && needle && (
                      <span className="ml-auto shrink-0 pl-4 text-xs text-muted">{row.parent.name}</span>
                    )}
                  </>
                ) : row.id === CREATE ? (
                  <>
                    <Plus size={16} strokeWidth={1.75} className="shrink-0" aria-hidden />
                    <span className="truncate">{needle ? `„${query.trim()}“ anlegen` : 'Neue Kategorie …'}</span>
                  </>
                ) : (
                  <span className="pl-6">Ohne Kategorie</span>
                )}
                {row.id === value && <Check size={14} className="ml-auto shrink-0 text-muted" aria-hidden />}
              </li>
            ))}
            {rows.length === 0 && <li className="px-3 py-1.5 text-sm text-muted">Keine Kategorie gefunden</li>}
          </ul>
        )}
      </div>
      {chips.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5" onClick={(e) => e.preventDefault()}>
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              // Schnellwahl für die Maus; mit der Tastatur geht es über die Suche im Feld.
              tabIndex={-1}
              aria-pressed={c.id === value}
              onClick={() => onChange(c.id)}
              className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${
                c.id === value ? 'border-muted text-text' : 'border-line text-muted hover:bg-raised hover:text-text'
              }`}
            >
              <span className="shrink-0" style={{ color: c.color }}>
                <CategoryIcon name={c.icon} size={13} />
              </span>
              <span className="truncate">{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Schnelles Anlegen aus einem Formular heraus. Symbol und Budget lassen sich später unter „Kategorien“ setzen. */
function NewCategory({
  kind,
  parents,
  initialName,
  defaultParentId,
  onCreated,
  onCancel
}: {
  kind: Category['kind']
  parents: Category[]
  initialName: string
  defaultParentId: string
  onCreated: (categoryId: string) => void
  onCancel: () => void
}) {
  const categories = useApp((s) => s.data.categories)
  const saveCollection = useApp((s) => s.saveCollection)
  const [name, setName] = useState(initialName)
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
