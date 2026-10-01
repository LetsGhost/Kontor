import { crossesAreas } from '../../shared/draft'
import type { Category } from '../../shared/schemas'
import { useApp } from './store'
import { Field, inputClass } from './ui'

/**
 * Kategorie für eine Umbuchung in einen anderen Bereich. Für den Quellbereich ist sie eine Ausgabe
 * (z. B. der Beitrag zum Haushaltskonto); innerhalb eines Bereichs bleibt das Feld weg.
 */
export function TransferCategoryField({
  accountId,
  transferAccountId,
  value,
  onChange
}: {
  accountId: string
  transferAccountId: string
  value: string
  onChange: (categoryId: string) => void
}) {
  const { accounts, areas } = useApp((s) => s.data)
  if (!crossesAreas(accounts, accountId, transferAccountId)) return null
  const source = areas.find((a) => a.id === accounts.find((acc) => acc.id === accountId)?.areaId)

  return (
    <Field label={`Kategorie (zählt in „${source?.name ?? ''}“ als Ausgabe)`}>
      <CategorySelect kind="expense" value={value} onChange={onChange} />
    </Field>
  )
}

/** Auswahl einer Kategorie, gruppiert nach Hauptkategorie. Der leere Wert steht für „ohne Kategorie“. */
export function CategorySelect({
  kind,
  value,
  onChange
}: {
  kind: Category['kind']
  value: string
  onChange: (categoryId: string) => void
}) {
  const categories = useApp((s) => s.data.categories)
  const parents = categories.filter((c) => c.parentId === null && c.kind === kind && !c.archived)

  return (
    <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
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
    </select>
  )
}
