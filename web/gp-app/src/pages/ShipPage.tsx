import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { fmtPct, fmtUsd } from '@/lib/format'
import { ShipScene, type ShipSector } from './ship/ShipScene'
import styles from './ShipPage.module.css'

type ShipBook = {
  ok?: boolean
  as_of?: string | null
  book_as_of?: string | null
  show_dollars?: boolean
  total_value?: number | null
  spx?: {
    label?: string
    change_pct?: number | null
    known?: boolean
  }
  weather?: { t?: number }
  sectors?: ShipSector[]
}

function weightText(n: number): string {
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`
}

export function ShipPage() {
  const [book, setBook] = useState<ShipBook | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api<ShipBook>('/api/v2/gp/portfolio-ship')
      .then((data) => {
        if (alive) setBook(data)
      })
      .catch((error: unknown) => {
        if (alive) setErr(error instanceof Error ? error.message : 'Could not load the book')
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActive(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const sectors = book?.sectors || []
  const selected = useMemo(
    () => sectors.find((sector) => sector.part === active) || null,
    [sectors, active],
  )
  const t = typeof book?.weather?.t === 'number' ? book.weather.t : 0.6
  const known = book?.spx?.known === true && book.spx.change_pct != null
  const caption = !book
    ? err
      ? 'S&P 500 unavailable'
      : 'Reading the book'
    : known
      ? `S&P 500 ${fmtPct(book?.spx?.change_pct)}`
      : 'S&P 500 unavailable'

  return (
    <div className={styles.page} data-ship>
      <div className={styles.stage}>
        <ShipScene
          t={t}
          sectors={sectors}
          active={active}
          hover={hover}
          onSelect={setActive}
          onHover={setHover}
        />
        <div className={styles.caption}>
          <strong>{caption}</strong>
          <span>
            {known
              ? 'Sea state follows this print'
              : 'Flat-day sea until the print arrives'}
          </span>
        </div>
      </div>
      <aside className={styles.aside}>
        <div>
          <p className={styles.kicker}>Lab</p>
          <h1>Portfolio Ship</h1>
        </div>
        <p className={styles.note}>
          Calm and bright from an S&P gain of 2% up. The heaviest water is a drop of 3% or more.
          {book?.as_of ? ` Book as of ${book.as_of}.` : ''}
        </p>
        {err && <p className={styles.err}>{err}</p>}
        {!book && !err && <p className={styles.hint}>Loading the book…</p>}
        {book && sectors.length === 0 && !err && (
          <p className={styles.hint}>No open positions in this book. The ship is still in the water.</p>
        )}
        <ul className={styles.legend} aria-label="Sectors on the ship">
          {sectors.map((sector) => (
            <li key={sector.part}>
              <button
                type="button"
                className={active === sector.part ? styles.on : undefined}
                aria-label={`Show ${sector.name}`}
                onClick={() => setActive(sector.part)}
                onMouseEnter={() => setHover(sector.part)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(sector.part)}
                onBlur={() => setHover(null)}
              >
                <span className={styles.dot} style={{ background: sector.color }} />
                <span className={styles.name}>{sector.name}</span>
                <span className={styles.w}>{weightText(sector.weight_pct)}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className={selected ? `${styles.panel} open` : styles.panel}>
          {!selected && <p className={styles.hint}>Select a part of the ship to see that sleeve.</p>}
          {selected && (
            <>
              <p className={styles.part}>Ship part: {selected.part}</p>
              <h2>
                <span className={styles.dot} style={{ background: selected.color }} />
                {selected.name}
                <button type="button" className={styles.close} aria-label="Close panel" onClick={() => setActive(null)}>
                  ×
                </button>
              </h2>
              <div className={styles.weight}>{weightText(selected.weight_pct)}</div>
              <div className={styles.bar} aria-hidden="true">
                <span style={{ width: `${Math.min(selected.weight_pct, 100)}%`, background: selected.color }} />
              </div>
              {book?.show_dollars && selected.market_value != null && (
                <p className={styles.dollars}>{fmtUsd(selected.market_value)}</p>
              )}
              <div className={styles.chips}>
                {selected.holdings.map((holding) => (
                  <span key={holding.symbol} className={styles.chip}>
                    {holding.symbol} {weightText(holding.weight_pct)}
                    {book?.show_dollars && holding.market_value != null
                      ? ` · ${fmtUsd(holding.market_value)}`
                      : ''}
                  </span>
                ))}
              </div>
              <p className={styles.note}>{selected.rationale}</p>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
