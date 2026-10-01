import { useMemo } from 'react'
import { DEFAULT_AREA, type Account, type Area } from '../../shared/schemas'
import { areaAccounts, idsOf } from '../../shared/scope'
import { useApp } from './store'

export interface CurrentArea {
  area: Area
  /** Alle Konten des Bereichs, auch archivierte */
  accounts: Account[]
  active: Account[]
  /** ids aller Konten des Bereichs, für die Auswertung */
  ids: Set<string>
  /** Ob es mehr als einen Bereich gibt und der Name deshalb genannt werden sollte */
  several: boolean
}

/** Der gewählte Bereich mit seinen Konten. Alle Auswertungen beziehen sich darauf. */
export function useArea(): CurrentArea {
  const areas = useApp((s) => s.data.areas)
  const accounts = useApp((s) => s.data.accounts)
  const areaId = useApp((s) => s.areaId)

  return useMemo(() => {
    const area = areas.find((a) => a.id === areaId) ?? areas[0] ?? DEFAULT_AREA
    const inArea = areaAccounts(accounts, area.id)
    return {
      area,
      accounts: inArea,
      active: inArea.filter((a) => !a.archived),
      ids: idsOf(inArea),
      several: areas.length > 1
    }
  }, [areas, accounts, areaId])
}

/** Konten als Auswahl, bei mehreren Bereichen nach Bereich gruppiert. */
export function AccountOptions({ accounts }: { accounts: Account[] }) {
  const areas = useApp((s) => s.data.areas)
  const option = (a: Account) => (
    <option key={a.id} value={a.id}>
      {a.name}
    </option>
  )
  if (areas.length < 2) return <>{accounts.map(option)}</>
  return (
    <>
      {areas.map((area) => {
        const inArea = accounts.filter((a) => a.areaId === area.id)
        return inArea.length === 0 ? null : (
          <optgroup key={area.id} label={area.name}>
            {inArea.map(option)}
          </optgroup>
        )
      })}
    </>
  )
}
