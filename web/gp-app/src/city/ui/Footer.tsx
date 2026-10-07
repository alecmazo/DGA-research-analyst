import { isStale } from '../metrics'
import type { CityPayload } from '../schema'
import styles from './cityui.module.css'

export function Footer({ portfolio, now = new Date() }: { portfolio: CityPayload['portfolio']; now?: Date }) {
  const stale = isStale(portfolio.as_of, now)
  const missing = portfolio.market_cap_missing || 0
  return (
    <footer className={stale ? styles.footerStale : styles.footer}>
      <span>As of {portfolio.as_of || 'n/a'}{stale ? ' · stale' : ''}</span>
      <span>{portfolio.source}</span>
      {missing > 0 && <span>{missing} market cap n/a</span>}
      {portfolio.total_value == null && <span className={styles.badge}>Weights only</span>}
    </footer>
  )
}
