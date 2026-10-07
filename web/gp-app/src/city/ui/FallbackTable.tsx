import { fmtCap, fmtPct, fmtUsd } from '@/lib/format'
import type { CityCompany } from '../schema'
import styles from './cityui.module.css'

export function FallbackTable({ companies }: { companies: CityCompany[] }) {
  return (
    <div className={styles.fallback}>
      <svg className={styles.sky} viewBox="0 0 640 180" role="img" aria-label="Night city illustration">
        <rect width="640" height="180" fill="#070814" />
        <rect x="40" y="70" width="36" height="90" fill="#143044" />
        <rect x="90" y="40" width="28" height="120" fill="#1a3358" />
        <rect x="130" y="90" width="50" height="70" fill="#102033" />
        <rect x="200" y="30" width="22" height="130" fill="#00e5ff" opacity="0.35" />
        <rect x="240" y="60" width="40" height="100" fill="#24143a" />
        <rect x="300" y="100" width="80" height="60" fill="#1c1f26" />
        <rect x="400" y="50" width="18" height="110" fill="#b6ff00" opacity="0.35" />
        <rect x="440" y="80" width="46" height="80" fill="#1b1410" />
        <rect x="510" y="96" width="70" height="64" fill="#0c1a14" />
      </svg>
      <p>This browser has no WebGL view. The table is the same book.</p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Sector</th>
            <th>Weight</th>
            <th>Position</th>
            <th>Market cap</th>
            <th>Book equity</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((company) => (
            <tr key={company.id}>
              <td>{company.ticker}</td>
              <td>{company.sector}</td>
              <td>{fmtPct(company.weight * 100)}</td>
              <td>{company.position_value == null ? '—' : fmtUsd(company.position_value)}</td>
              <td>{fmtCap(company.market_cap)}</td>
              <td>{fmtCap(company.book_equity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
