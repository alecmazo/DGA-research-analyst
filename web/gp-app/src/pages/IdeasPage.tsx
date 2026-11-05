import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Empty, Spinner } from '@/components/ui/Empty'
import { api } from '@/lib/api'
import { fmtPct, fmtUsdSigned, pctClass } from '@/lib/format'
import page from './page.module.css'
import styles from './IdeasPage.module.css'

type Returns = Record<string, number | null>
type Row = {
  ticker: string
  name?: string
  price: number
  fair_value: number
  upside: number
  day_change?: number | null
  rating?: string
  fair_as_of?: string
  returns: Returns
  windows: string[]
  reason: string
}
type Headline = { title: string; url?: string; publisher?: string }

const WINDOWS = [
  { id: 'day', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'six_month', label: '6 mo' },
  { id: 'year', label: '12 mo' },
]

function moveText(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '—'
  const n = Number(value) * 100
  const arrow = n < 0 ? '▼ ' : n > 0 ? '▲ ' : ''
  return `${arrow}${fmtPct(n, 1)}`
}

function money(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function IdeasPage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState('')
  const [windowId, setWindowId] = useState('')
  const [open, setOpen] = useState('')
  const [news, setNews] = useState<Record<string, Headline[] | 'loading'>>({})

  const load = useCallback(async () => {
    const data = await api<{ rows: Row[] }>('/api/ideas/equities')
    setRows(data.rows || [])
  }, [])

  useEffect(() => {
    let alive = true
    setError('')
    void load().catch((err: Error) => {
      if (alive) setError(err.message || 'Could not load ideas')
    })
    return () => {
      alive = false
    }
  }, [load])

  const shown = useMemo(() => {
    const list = rows || []
    if (!windowId) return list
    return list.filter((row) => row.windows.includes(windowId))
  }, [rows, windowId])

  const toggle = (ticker: string) => {
    setOpen((current) => (current === ticker ? '' : ticker))
    if (news[ticker]) return
    setNews((current) => ({ ...current, [ticker]: 'loading' }))
    void api<{ headlines: Headline[] }>(`/api/ideas/equities/${encodeURIComponent(ticker)}/headlines`)
      .then((data) => {
        setNews((current) => ({ ...current, [ticker]: data.headlines || [] }))
      })
      .catch(() => {
        setNews((current) => ({ ...current, [ticker]: [] }))
      })
  }

  return (
    <div className={page.page}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Desk</p>
          <h1 className={page.h1}>Ideas</h1>
        </div>
      </header>
      <p className={styles.lede}>
        Below fair value, and down on at least one window. Open a name for the moves and the headlines.
      </p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.filters} role="group" aria-label="Drop window">
        <button type="button" className={windowId === '' ? styles.filterOn : styles.filter} onClick={() => setWindowId('')}>
          All {rows ? rows.length : ''}
        </button>
        {WINDOWS.map((item) => {
          const count = (rows || []).filter((row) => row.windows.includes(item.id)).length
          return (
            <button
              key={item.id}
              type="button"
              className={windowId === item.id ? styles.filterOn : styles.filter}
              onClick={() => setWindowId(item.id)}
            >
              {item.label} {rows ? count : ''}
            </button>
          )
        })}
      </div>
      {rows === null && <Spinner label="Loading ideas…" />}
      {rows && shown.length === 0 && (
        <Empty
          title="No names on this list"
          sub="A name shows up when a saved fair value is above the price and the drop is large enough on one of these windows."
        />
      )}
      {rows && shown.length > 0 && (
        <div className={styles.list}>
          {shown.map((row) => {
            const expanded = open === row.ticker
            const headlines = news[row.ticker]
            return (
              <article key={row.ticker} className={expanded ? styles.itemOpen : styles.item}>
                <button
                  type="button"
                  className={styles.row}
                  aria-expanded={expanded}
                  onClick={() => toggle(row.ticker)}
                >
                  <span className={styles.name}>
                    <span className={styles.titleLine}>
                      <span className={styles.ticker}>{row.ticker}</span>
                      {row.name && row.name !== row.ticker && <span className={styles.company}>{row.name}</span>}
                    </span>
                    <span className={styles.reason}>{row.reason}</span>
                  </span>
                  <span className={styles.quote}>
                    <span className={`tabular ${styles.move} ${pctClass(row.returns?.day == null ? null : row.returns.day * 100)}`}>
                      {moveText(row.returns?.day)}
                    </span>
                    <span className={`tabular ${styles.dollars} ${pctClass(row.day_change)}`}>
                      {fmtUsdSigned(row.day_change, 2)}
                    </span>
                    <span className={styles.px}>{money(row.price)}</span>
                  </span>
                </button>
                {expanded && (
                  <div className={styles.detail}>
                    <div className={styles.stats}>
                      {WINDOWS.map((item) => {
                        const hit = row.windows.includes(item.id)
                        return (
                          <span key={item.id} className={hit ? styles.hit : styles.miss}>
                            {item.label} {moveText(row.returns?.[item.id])}
                          </span>
                        )
                      })}
                    </div>
                    <p className={styles.meta}>
                      Fair value {money(row.fair_value)}
                      {row.rating ? ` · ${row.rating}` : ''}
                      {row.fair_as_of ? ` · ${row.fair_as_of}` : ''}
                      {' · '}
                      <Link to={`/financials?ticker=${encodeURIComponent(row.ticker)}`}>Financials</Link>
                    </p>
                    {headlines === 'loading' && <p className={styles.meta}>Loading headlines…</p>}
                    {Array.isArray(headlines) && headlines.length === 0 && (
                      <p className={styles.meta}>No recent headlines.</p>
                    )}
                    {Array.isArray(headlines) && headlines.length > 0 && (
                      <ul className={styles.news}>
                        {headlines.map((item) => (
                          <li key={item.url || item.title}>
                            {item.url ? (
                              <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
                            ) : (
                              item.title
                            )}
                            {item.publisher && <span>{item.publisher}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
