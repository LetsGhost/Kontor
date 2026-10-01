import type { Category } from './schemas'

/** Icon für Kategorien ohne eigene Wahl. Die Namen stehen in src/renderer/src/icons.tsx. */
export const FALLBACK_ICON = 'tag'

type Seed = [name: string, icon: string, color: string, children?: [name: string, icon: string][]]

const expenses: Seed[] = [
  ['Wohnen', 'home', '#60a5fa', [['Miete', 'key'], ['Strom & Gas', 'zap'], ['Internet & Telefon', 'wifi']]],
  ['Lebensmittel', 'cart', '#34d399', [['Supermarkt', 'apple'], ['Restaurant & Lieferdienst', 'utensils']]],
  ['Mobilität', 'train', '#fbbf24', [['ÖPNV', 'bus'], ['Auto & Tanken', 'fuel']]],
  ['Freizeit', 'gamepad', '#f472b6', [['Abos & Streaming', 'tv'], ['Hobbys', 'palette'], ['Urlaub', 'plane']]],
  ['Shopping', 'bag', '#a78bfa', [['Kleidung', 'shirt'], ['Elektronik', 'laptop']]],
  ['Gesundheit', 'heart', '#f87171'],
  ['Versicherungen', 'shield', '#2dd4bf'],
  ['Sonstiges', 'package', '#94a3b8']
]

const income: Seed[] = [
  ['Gehalt', 'briefcase', '#4ade80'],
  ['Sonstige Einnahmen', 'banknote', '#a3e635']
]

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

function build(seeds: Seed[], kind: Category['kind']): Category[] {
  return seeds.flatMap(([name, icon, color, children = []]) => {
    const parentId = `cat-${slug(name)}`
    return [
      { id: parentId, name, parentId: null, kind, color, icon, archived: false },
      ...children.map(([childName, childIcon]) => ({
        id: `${parentId}-${slug(childName)}`,
        name: childName,
        parentId,
        kind,
        color,
        icon: childIcon,
        archived: false
      }))
    ]
  })
}

export function defaultCategories(): Category[] {
  return [...build(expenses, 'expense'), ...build(income, 'income')]
}
