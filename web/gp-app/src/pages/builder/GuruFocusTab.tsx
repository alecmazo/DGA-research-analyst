import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { fmtPct, fmtPx, pctClass } from '@/lib/format'
import { Empty, Spinner } from '@/components/ui/Empty'
import styles from './GuruFocusTab.module.css'

type GfList = {
  id: string
  name?: string
  created_on?: string | null
  stock_count?: number
  is_overview?: boolean
}

type GfStock = {
  symbol: string
  company?: string
  price?: number | null
  day_pct?: number | null
  date_first_added?: string | null
  cost_per_share?: number | null
  pct_since_first?: number | null
  rel_spy?: number | null
  div_earned?: number | null
  ann_gain?: number | null
  fair_value?: number | null
  note?: string | null
  list_name?: string | null
}

type Props = {
  onPeek: (tk: string) => void
  onLeave: () => void
  onOpen: (tk: string) => void
}

export function GuruFocusTab({ onPeek, onLeave, onOpen }: Props) {
  const [lists, setLists] = useState<GfList[]>([])
  const [active, setActive] = useState('overview')
  const [stocks, setStocks] = useState<GfStock[]>([])
  const [meta, setMeta] = useState<{ name?: string; synced_at?: string; n?: number }>({})
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const loadLists = useCallback(async () => {
    const d = await api<{ lists?: GfList[]; synced_at?: string; stock_count?: number }>(
      '/api/v2/builder/gurufocus',
    )
    setLists(d.lists || [])
    setMeta((m) => ({ ...m, synced_at: d.synced_at, n: d.stock_count }))
  }, [])

  const loadList = useCallback(async (id: string) => {
    setBusy(true)
    try {
      const d = await api<{
        synced_at?: string
        list?: { name?: string; stocks?: GfStock[]; stock_count?: number }
      }>(`/api/v2/builder/gurufocus/${encodeURIComponent(id)}`)
      setStocks(d.list?.stocks || [])
      setMeta((m) => ({
        ...m,
        name: d.list?.name,
        synced_at: d.synced_at || m.synced_at,
        n: d.list?.stock_count,
      }))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        await loadLists()
        if (!alive) return
        await loadList('overview')
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : 'GuruFocus lists failed')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [loadLists, loadList])

  const filtered = useMemo(() => {
    const s = q.trim().toUpperCase()
    if (!s) return stocks
    return stocks.filter(
      (r) =>
        r.symbol.includes(s) ||
        (r.company || '').toUpperCase().includes(s) ||
        (r.list_name || '').toUpperCase().includes(s),
    )
  }, [stocks, q])

  const pick = async (id: string) => {
    setActive(id)
    setQ('')
    await loadList(id)
  }

  if (loading) return <Spinner label="Loading GuruFocus watchlists…" />
  if (err) return <Empty title="Could not load GuruFocus" sub={err} />
  if (!lists.length) {
    return (
      <Empty
        title="No GuruFocus watchlists"
        sub="This workspace does not include the live GuruFocus book."
      />
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div>
          <h2 className={styles.h2}>My Portfolios</h2>
          <p className={styles.sub}>
            {lists.filter((l) => !l.is_overview).length} watchlists · {meta.n ?? 0}{' '}
            stocks
            {meta.synced_at ? ` · synced ${meta.synced_at.slice(0, 10)}` : ''}
          </p>
        </div>
      </div>

      <div className={styles.cards}>
        {lists.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`${styles.card} ${active === l.id ? styles.cardOn : ''}`}
            onClick={() => void pick(l.id)}
          >
            <div className={styles.cardName}>{l.name}</div>
            <div className={styles.cardMeta}>
              {l.stock_count ?? 0} stock{(l.stock_count || 0) === 1 ? '' : 's'}
            </div>
            {l.created_on ? (
              <div className={styles.cardDate}>Created On: {l.created_on}</div>
            ) : l.is_overview ? (
              <div className={styles.cardDate}>All watchlists</div>
            ) : null}
          </button>
        ))}
      </div>

      <div className={styles.tableCard}>
        <div className={styles.tableHead}>
          <h3 className={styles.tableTitle}>{meta.name || 'Overview'}</h3>
          <input
            className={styles.search}
            placeholder="Search stock"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {busy ? (
          <Spinner label="Loading list…" />
        ) : !filtered.length ? (
          <Empty title="No names" sub="Try another watchlist or search." />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {active === 'overview' && <th>Watchlist</th>}
                  <th>Ticker</th>
                  <th>Company</th>
                  <th className="tabular">Current Price</th>
                  <th className="tabular">Day&apos;s Change %</th>
                  <th>Date First Added</th>
                  <th className="tabular">Cost per Share</th>
                  <th className="tabular">Price % Change since First Transaction</th>
                  <th className="tabular">Rel. to S&amp;P 500</th>
                  <th className="tabular">Dividend Earned Since Purchase</th>
                  <th className="tabular">Annualized Gain</th>
                  <th className="tabular">Fair Value</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr
                    key={`${r.list_name || ''}-${r.symbol}-${i}`}
                    onMouseEnter={() => onPeek(r.symbol)}
                    onMouseLeave={onLeave}
                    onClick={() => onOpen(r.symbol)}
                  >
                    {active === 'overview' && (
                      <td className={styles.listName}>{r.list_name || '—'}</td>
                    )}
                    <td className={styles.tk}>{r.symbol}</td>
                    <td className={styles.co}>{r.company || '—'}</td>
                    <td className="tabular">{fmtPx(r.price)}</td>
                    <td className={`tabular ${pctClass(r.day_pct)}`}>{fmtPct(r.day_pct)}</td>
                    <td className={styles.date}>{r.date_first_added || '—'}</td>
                    <td className="tabular">{fmtPx(r.cost_per_share)}</td>
                    <td className={`tabular ${pctClass(r.pct_since_first)}`}>
                      {fmtPct(r.pct_since_first)}
                    </td>
                    <td className={`tabular ${pctClass(r.rel_spy)}`}>{fmtPct(r.rel_spy)}</td>
                    <td className="tabular">
                      {r.div_earned != null ? `${r.div_earned.toFixed(2)}%` : '—'}
                    </td>
                    <td className={`tabular ${pctClass(r.ann_gain)}`}>{fmtPct(r.ann_gain)}</td>
                    <td className="tabular">{fmtPx(r.fair_value)}</td>
                    <td className={styles.note} title={r.note || ''}>
                      {r.note || ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
