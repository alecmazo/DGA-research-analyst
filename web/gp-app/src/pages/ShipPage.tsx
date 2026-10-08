import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { fmtUsd } from '@/lib/format'
import type { ShipHolding, ShipSector } from './ship/ShipScene'
import type { ShipPart } from './ship/pins'
import styles from './ShipPage.module.css'

const ShipCampus = lazy(() => import('./ship/ShipCampus').then((mod) => ({ default: mod.ShipCampus })))

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

function sleeve(
  part: ShipPart,
  name: string,
  color: string,
  rows: [string, number, number | null][],
): ShipSector {
  const holdings: ShipHolding[] = rows.map(([symbol, weight_pct, market_cap]) => ({
    symbol,
    name: symbol,
    weight_pct,
    market_value: null,
    market_cap,
  }))
  const weight_pct = holdings.reduce((sum, row) => sum + row.weight_pct, 0)
  return {
    id: part,
    part,
    name,
    color,
    weight_pct,
    market_value: null,
    rationale: 'WASH_PREVIEW_FIXTURE',
    holdings,
  }
}

/** Dev-only layout check. Production builds drop this branch. Not the live book. */
function washPreview(): { sectors: ShipSector[]; t: number } | null {
  if (!import.meta.env.DEV) return null
  const params = new URLSearchParams(window.location.search)
  if (params.get('wash') !== '1') return null
  const t = Number(params.get('t') ?? '0.6')
  return {
    t: Number.isFinite(t) ? t : 0.6,
    sectors: [
      sleeve('bridge', 'Technology (core)', '#5b8cff', [['NVDA', 14, 3.2e12], ['MSFT', 8, 3.1e12], ['AAPL', 4, 3.4e12], ['AMZN', 2.2, 2.1e12], ['META', 1.1, 1.4e12]]),
      sleeve('mast', 'Communication Services', '#38b6ff', [['NFLX', 3.2, 3.5e11], ['DIS', 1.4, 1.8e11]]),
      sleeve('cabins', 'Real Estate', '#c4a882', [['EQIX', 2.1, 8e10], ['DLR', 1.2, 5e10]]),
      sleeve('deck', 'Industrials', '#f2c14e', [['CAT', 4.4, 1.8e11], ['DE', 2.1, 1.2e11]]),
      sleeve('aero', 'Aerospace', '#d6c4ff', [['SPCX', 1.6, null]]),
      sleeve('cargo', 'Consumer Discretionary', '#7fc97f', [['UBER', 2.4, 1.6e11]]),
      sleeve('midship', 'Materials', '#c98b4a', [['LIN', 1.1, 2e11]]),
      sleeve('staples', 'Consumer Staples', '#1f8a4c', [['NKE', 1.8, 1.1e11]]),
      sleeve('hull', 'Healthcare', '#ef5d7a', [['LLY', 3.1, 7e11], ['UNH', 1.4, 4.5e11]]),
      sleeve('keel', 'Utilities / Power', '#8a6cff', [['NEE', 2.2, 1.5e11], ['CEG', 1.3, 7e10]]),
      sleeve('engine', 'Energy', '#4a4f63', [['XOM', 1.5, 4.5e11]]),
      sleeve('stern', 'Asymmetric bets', '#ff7a3d', [['FNMA', 6, null], ['FMCC', 4, null], ['IBRX', 1, 2e9]]),
      sleeve('bow', 'Financials', '#2ec4a6', [['JPM', 3.4, 7e11], ['GS', 1.6, 1.6e11]]),
      sleeve('market', 'Index funds', '#dfe8f2', [['SPY', 5, 6e11], ['QQQM', 2, 3e11]]),
      sleeve('anchor', 'Cash / Money market', '#9aa7b4', [['SPAXX', 4, null]]),
    ],
  }
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

  const preview = useMemo(() => washPreview(), [])
  const sectors = preview?.sectors || book?.sectors || []
  const selected = useMemo(
    () => sectors.find((sector) => sector.part === active) || null,
    [sectors, active],
  )

  return (
    <div className={styles.page} data-ship>
      <div className={styles.stage}>
        {(book || preview) ? (
          <Suspense fallback={<div className={styles.opening}>Opening the campus…</div>}>
            <ShipCampus
              sectors={sectors}
              active={active}
              hover={hover}
              onSelect={setActive}
              onHover={setHover}
            />
          </Suspense>
        ) : (
          <div className={styles.opening}>{err ? 'The book did not load' : 'Reading the book'}</div>
        )}
        <div className={styles.caption}>
          <strong>Drag to look around. Scroll to zoom in.</strong>
          <span>Double-click a building. Size follows market cap.</span>
        </div>
      </div>
      <aside className={styles.aside}>
        <div>
          <p className={styles.kicker}>Lab</p>
          <h1>Portfolio Campus</h1>
        </div>
        <p className={styles.note}>
          Each building is one company. Each neighborhood is one sector. Height and footprint follow
          public market cap. A company without a published market cap stays modest.
          {book?.as_of ? ` Book as of ${book.as_of}.` : ''}
        </p>
        {err && <p className={styles.err}>{err}</p>}
        {!book && !err && <p className={styles.hint}>Loading the book…</p>}
        {book && sectors.length === 0 && !err && (
          <p className={styles.hint}>No open positions in this book.</p>
        )}
        <ul className={styles.legend} aria-label="Sectors">
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
          {!selected && <p className={styles.hint}>Select a neighborhood to see the companies in that sector.</p>}
          {selected && (
            <>
              <p className={styles.part}>Neighborhood</p>
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
