import { fmtPct } from '@/lib/format'
import type { CityCompany } from '../schema'
import styles from './cityui.module.css'

export function BuildingList({
  companies,
  selectedId,
  onSelect,
}: {
  companies: CityCompany[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <ul className={styles.list}>
      {companies.map((company) => {
        const ratio = company.equity_to_market_cap
        return (
          <li key={company.id}>
            <button
              type="button"
              className={company.id === selectedId ? styles.listOn : styles.listBtn}
              aria-pressed={company.id === selectedId}
              onClick={() => onSelect(company.id)}
            >
              <span>{company.ticker}</span>
              <span>{company.sector}</span>
              <span>{fmtPct(company.weight * 100)}</span>
              <span>{ratio == null ? 'n/a' : fmtPct(ratio * 100)}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
