import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { fmtCap, fmtUsd } from '@/lib/format'
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

type MoneyBlock = Record<string, number | null | undefined>

type CompanyCard = {
  symbol?: string
  statement_symbol?: string | null
  name?: string | null
  period_end?: string | null
  balance_sheet?: MoneyBlock | null
  income?: MoneyBlock | null
  cash_flow?: MoneyBlock | null
}

function knownMoney(value: number | null | undefined): boolean {
  return value != null && Number.isFinite(Number(value))
}

function moneyLine(label: string, value: number | null | undefined) {
  if (!knownMoney(value)) return null
  return (
    <div className={styles.line}>
      <span>{label}</span>
      <span>{fmtCap(value)}</span>
    </div>
  )
}

function Structure({ sheet }: { sheet: MoneyBlock }) {
  const equity = sheet.equity
  const debt = sheet.debt
  const assets = sheet.total_assets
  if (!knownMoney(equity) || !knownMoney(debt) || !knownMoney(assets)) return null
  if (!(equity! > 0 && debt! > 0 && assets! > 0)) return null
  if (equity! + debt! > assets! * 1.05) return null
  return (
    <div className={styles.stack} aria-label="Balance sheet structure">
      <i style={{ width: `${(equity! / assets!) * 100}%`, background: '#2ec4a6' }} />
      <i style={{ width: `${(debt! / assets!) * 100}%`, background: '#c98b4a' }} />
    </div>
  )
}

export function ShipPage() {
  const [book, setBook] = useState<ShipBook | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [symbol, setSymbol] = useState<string | null>(null)
  const [card, setCard] = useState<CompanyCard | null>(null)
  const [cardErr, setCardErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let ticket = 0
    const load = () => {
      const mine = ++ticket
      api<ShipBook>('/api/v2/gp/portfolio-ship')
        .then((data) => {
          if (!alive || mine !== ticket) return
          setBook(data)
          setErr(null)
        })
        .catch((error: unknown) => {
          if (alive && mine === ticket) setErr(error instanceof Error ? error.message : 'Could not load the book')
        })
    }
    load()
    const onVis = () => {
      if (document.visibilityState === 'visible') load()
    }
    window.addEventListener('focus', load)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      alive = false
      window.removeEventListener('focus', load)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  useEffect(() => {
    if (!symbol) {
      setCard(null)
      setCardErr(null)
      return
    }
    let alive = true
    setCard(null)
    setCardErr(null)
    api<CompanyCard>(`/api/v2/gp/portfolio-ship/company/${encodeURIComponent(symbol)}`)
      .then((data) => {
        if (alive) setCard(data)
      })
      .catch(() => {
        if (alive) setCardErr('Statements could not be read.')
      })
    return () => {
      alive = false
    }
  }, [symbol])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setActive(null)
      setSymbol(null)
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
  const picked = useMemo(() => {
    if (!symbol) return null
    for (const sector of sectors) {
      const holding = sector.holdings.find((row) => row.symbol === symbol)
      if (holding) return { sector, holding }
    }
    return null
  }, [sectors, symbol])
  const clear = () => {
    setActive(null)
    setSymbol(null)
  }
  const statementsReady = Boolean(card) || Boolean(cardErr)
  const statementMissing = Boolean(
    card && !card.balance_sheet && !card.income && !card.cash_flow,
  )

  return (
    <div className={styles.page} data-ship>
      <div className={styles.stage}>
        {(book || preview) ? (
          <Suspense fallback={<div className={styles.opening}>Opening the city…</div>}>
            <ShipCampus
              sectors={sectors}
              active={active}
              hover={hover}
              onSelect={(part, next) => {
                setActive(part)
                setSymbol(next)
              }}
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
          <h1>Portfolio City</h1>
        </div>
        <p className={styles.note}>
          Each building is one company. Each district is one sector. Height and footprint follow
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
                onClick={() => {
                  setActive(sector.part)
                  setSymbol(null)
                }}
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
        <div className={selected || symbol ? `${styles.panel} open` : styles.panel}>
          {!selected && !symbol && (
            <p className={styles.hint}>Select a district, or click a building to read that company.</p>
          )}
          {symbol && (
            <>
              <p className={styles.part}>Company</p>
              <h2>
                <span className={styles.dot} style={{ background: picked?.sector.color || '#9fb4c8' }} />
                {picked?.holding.name || card?.name || symbol}
                <button type="button" className={styles.close} aria-label="Close panel" onClick={clear}>
                  ×
                </button>
              </h2>
              <p className={styles.head}>{symbol}</p>
              <p className={styles.dollars}>
                {knownMoney(picked?.holding.market_cap) && Number(picked?.holding.market_cap) > 0
                  ? `Market cap ${fmtCap(picked?.holding.market_cap)}`
                  : 'Market cap not published'}
              </p>
              {book?.show_dollars && picked?.holding.market_value != null && (
                <p className={styles.dollars}>{fmtUsd(picked.holding.market_value)}</p>
              )}
              {!statementsReady && <p className={styles.hint}>Reading statements…</p>}
              {cardErr && <p className={styles.note}>{cardErr}</p>}
              {card?.statement_symbol && card.statement_symbol !== symbol && (
                <p className={styles.note}>Statements are for {card.statement_symbol}.</p>
              )}
              {statementMissing && <p className={styles.note}>Statements are not on file.</p>}
              {card?.balance_sheet && (
                <>
                  <p className={styles.part}>Balance sheet</p>
                  <Structure sheet={card.balance_sheet} />
                  <div className={styles.lines}>
                    {moneyLine('Cash', card.balance_sheet.cash)}
                    {moneyLine('Assets', card.balance_sheet.total_assets)}
                    {moneyLine('Liabilities', card.balance_sheet.total_liabilities)}
                    {moneyLine('Equity', card.balance_sheet.equity)}
                    {moneyLine('Debt', card.balance_sheet.debt)}
                  </div>
                </>
              )}
              {card?.income && (
                <>
                  <p className={styles.part}>Profit and loss</p>
                  <div className={styles.lines}>
                    {moneyLine('Revenue', card.income.revenue)}
                    {moneyLine('Operating income', card.income.operating_income)}
                    {moneyLine('Net income', card.income.net_income)}
                  </div>
                </>
              )}
              {card?.cash_flow && (
                <>
                  <p className={styles.part}>Cash flow</p>
                  <div className={styles.lines}>
                    {moneyLine('Operating cash flow', card.cash_flow.operating)}
                    {moneyLine('Capex', card.cash_flow.capex)}
                    {moneyLine('Free cash flow', card.cash_flow.free_cash_flow)}
                  </div>
                </>
              )}
              {card?.period_end && (
                <p className={styles.hint}>Annual period ending {card.period_end}.</p>
              )}
            </>
          )}
          {selected && !symbol && (
            <>
              <p className={styles.part}>District</p>
              <h2>
                <span className={styles.dot} style={{ background: selected.color }} />
                {selected.name}
                <button type="button" className={styles.close} aria-label="Close panel" onClick={clear}>
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
                  <button
                    key={holding.symbol}
                    type="button"
                    className={styles.chipBtn}
                    onClick={() => setSymbol(holding.symbol)}
                  >
                    {holding.symbol} {weightText(holding.weight_pct)}
                    {book?.show_dollars && holding.market_value != null
                      ? ` · ${fmtUsd(holding.market_value)}`
                      : ''}
                  </button>
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
