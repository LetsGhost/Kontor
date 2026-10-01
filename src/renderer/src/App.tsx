import {
  ChartColumn,
  FolderOpen,
  Landmark,
  Repeat,
  ScrollText,
  Settings as SettingsIcon,
  Tags,
  TrendingUp,
  type LucideIcon
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Backups } from './Backups'
import { useDue } from './Due'
import { useArea } from './area'
import { Accounts } from './pages/Accounts'
import { Categories } from './pages/Categories'
import { Forecast } from './pages/Forecast'
import { Overview } from './pages/Overview'
import { Recurring } from './pages/Recurring'
import { Transactions } from './pages/Transactions'
import { useApp } from './store'
import { Button, Section } from './ui'

type Page = 'overview' | 'forecast' |'transactions' | 'recurring' | 'accounts' | 'categories' | 'settings'

const pages: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Übersicht', icon: ChartColumn },
  { id: 'forecast', label: 'Prognose', icon: TrendingUp },
  { id: 'transactions', label: 'Buchungen', icon: ScrollText },
  { id: 'recurring', label: 'Wiederkehrend', icon: Repeat },
  { id: 'accounts', label: 'Konten', icon: Landmark },
  { id: 'categories', label: 'Kategorien', icon: Tags },
  { id: 'settings', label: 'Einstellungen', icon: SettingsIcon }
]

export function App() {
  const status = useApp((s) => s.status)
  const info = useApp((s) => s.info)
  const reload = useApp((s) => s.reload)
  const areas = useApp((s) => s.data.areas)
  const setArea = useApp((s) => s.setArea)
  const { area, ids } = useArea()
  const dueCount = useDue(ids).length
  const [page, setPage] = useState<Page>('overview')

  useEffect(() => {
    void reload()
  }, [reload])

  if (status.kind === 'loading') return null
  if (status.kind === 'error') return <LoadError file={status.file} message={status.message} />

  return (
    <div className="flex h-full">
      {/* Unterhalb von lg schrumpft die Navigation auf eine Symbolleiste. */}
      <nav className="flex w-14 shrink-0 flex-col border-r border-line py-5 lg:w-52">
        <div className="mb-5 flex items-baseline justify-center gap-2 lg:justify-start lg:px-5">
          <span className="text-lg font-semibold">
            K<span className="hidden lg:inline">ontor</span>
          </span>
          {info?.isDev && <span className="num hidden text-[11px] text-warn lg:inline">dev</span>}
        </div>
        {areas.length > 1 && (
          <label className="relative mb-5 block px-2 lg:px-4" title={area.name}>
            <span className="sr-only">Bereich</span>
            {/* In der schmalen Leiste liegt die Auswahl unsichtbar über dem Anfangsbuchstaben. */}
            <span
              aria-hidden
              className="block rounded-md border border-line py-1.5 text-center text-sm font-medium lg:hidden"
            >
              {area.name.slice(0, 1).toUpperCase()}
            </span>
            <select
              className="absolute inset-0 h-full w-full cursor-pointer rounded-md border border-line bg-bg px-2 py-1.5 text-sm opacity-0 outline-none focus:border-muted lg:static lg:h-auto lg:opacity-100"
              value={area.id}
              onChange={(e) => setArea(e.target.value)}
            >
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {pages.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setPage(id)}
            aria-current={page === id ? 'page' : undefined}
            aria-label={label}
            title={label}
            className={`relative flex items-center justify-center gap-2.5 border-l-2 py-2 text-left text-sm lg:justify-start lg:px-[18px] ${
              page === id ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'
            }`}
          >
            <Icon size={16} strokeWidth={1.75} className="shrink-0" />
            <span className="hidden flex-1 lg:inline">{label}</span>
            {id === 'recurring' && dueCount > 0 && (
              <span className="num absolute top-0.5 right-1.5 text-[10px] text-accent lg:static lg:text-xs">
                {dueCount}
              </span>
            )}
          </button>
        ))}
        <div className="num mt-auto hidden px-5 text-[11px] text-muted lg:block">{info?.version}</div>
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto px-5 py-6 [scrollbar-gutter:stable] md:px-8 xl:px-10 xl:py-8">
        {/* Auf sehr breiten Fenstern bleibt der Inhalt eine mittige Spalte; die Seiten füllen sie von links. */}
        <div className="mx-auto max-w-7xl">
          {page === 'overview' && <Overview />}
          {page === 'forecast' && <Forecast />}
          {page === 'transactions' && <Transactions onGoToAccounts={() => setPage('accounts')} />}
          {page === 'recurring' && <Recurring />}
          {page === 'accounts' && <Accounts />}
          {page === 'categories' && <Categories />}
          {page === 'settings' && <Settings />}
        </div>
      </main>
    </div>
  )
}

function Settings() {
  const info = useApp((s) => s.info)

  return (
    <div className="max-w-3xl space-y-10">
      <h1 className="text-2xl font-semibold">Einstellungen</h1>
      <Section title="Datenordner">
        <DataFolder path={info?.dataDir ?? ''} />
      </Section>
      <Section title="Backups">
        <Backups allowCreate />
      </Section>
    </div>
  )
}

function DataFolder({ path }: { path: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-y border-line py-2.5">
      <code className="num truncate text-xs">{path}</code>
      <Button className="shrink-0" onClick={() => window.kontor.openDataFolder()}>
        <FolderOpen size={15} /> Ordner öffnen
      </Button>
    </div>
  )
}

function LoadError({ file, message }: { file: string; message: string }) {
  const info = useApp((s) => s.info)
  const reload = useApp((s) => s.reload)

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-5 md:p-10">
      <h1 className="text-2xl font-semibold text-danger">Daten konnten nicht geladen werden</h1>
      <p className="text-sm">
        Die Datei <code className="num bg-raised px-1">{file}</code> ist beschädigt. Kontor hat nichts verändert. Du
        kannst die Datei von Hand reparieren oder ein Backup zurückspielen.
      </p>
      <pre className="num overflow-x-auto border border-line bg-surface p-3 text-xs whitespace-pre-wrap">{message}</pre>
      <DataFolder path={info?.dataDir ?? ''} />
      <Button onClick={() => reload()}>Erneut laden</Button>
      <Section title="Backup zurückspielen">
        <Backups allowCreate={false} />
      </Section>
    </div>
  )
}
