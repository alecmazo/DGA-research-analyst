import { fmtCap, fmtPct, fmtUsd } from '@/lib/format'
import type { CityCompany } from '../schema'
import styles from './cityui.module.css'

export function InfoPanel({ company, onClose }: { company: CityCompany | null; onClose: () => void }) {
  if (!company) return null
  const ratio = company.equity_to_market_cap
  return (
    <section className={styles.panel} aria-labelledby="city-card-title">
      <header className={styles.panelHead}>
        <div>
          <div id="city-card-title" className={styles.panelTitle}>{company.name}</div>
          <div className={styles.meta}>
            {company.ship_dot && <i className={styles.dot} style={{ background: company.ship_dot }} />}
            {company.ticker} · {company.sector} · {company.archetype.replaceAll('_', ' ')}
          </div>
        </div>
        <button type="button" className={styles.close} onClick={onClose}>Close</button>
      </header>
      {company.archetype_override && company.industry_note && (
        <p className={styles.note}>{company.industry_note}</p>
      )}
      <dl className={styles.facts}>
        <div><dt>Weight</dt><dd>{fmtPct(company.weight * 100)}</dd></div>
        <div><dt>Position</dt><dd>{company.position_value == null ? '—' : fmtUsd(company.position_value)}</dd></div>
        <div><dt>Market cap</dt><dd>{fmtCap(company.market_cap)}</dd></div>
        <div><dt>Book equity</dt><dd>{fmtCap(company.book_equity)}</dd></div>
        <div><dt>Equity / cap</dt><dd>{ratio == null ? 'n/a' : fmtPct(ratio * 100)}</dd></div>
        <div><dt>Total assets</dt><dd>{fmtCap(company.total_assets)}</dd></div>
        <div><dt>Day</dt><dd>{company.daily_change_pct == null ? 'n/a' : fmtPct(company.daily_change_pct)}</dd></div>
      </dl>
      {company.market_cap_as_of && <p className={styles.asof}>Market cap as of {company.market_cap_as_of}</p>}
      {company.book_equity_as_of && <p className={styles.asof}>Book equity as of {company.book_equity_as_of}</p>}
      {company.total_assets_as_of && <p className={styles.asof}>Assets as of {company.total_assets_as_of}</p>}
      {!!company.holders?.length && (
        <ul className={styles.holders}>
          {company.holders.map((holder) => (
            <li key={`${holder.account_name}-${holder.source_type}-${holder.ticker || ''}`}>
              <span>{holder.account_name || (holder.source_type === 'lp_fund' ? 'LP fund' : 'Managed')}</span>
              <span>{holder.source_type === 'lp_fund' ? 'LP fund' : 'Managed'}</span>
              <span>{holder.position_value == null ? fmtPct(holder.weight * 100) : fmtUsd(holder.position_value)}</span>
              {holder.stake_pct != null && <span>{fmtPct(holder.stake_pct, 1)} stake</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
