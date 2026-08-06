import { useEffect, useState } from 'react'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { Empty, Spinner } from '@/components/ui/Empty'
import { api } from '@/lib/api'
import { fmtPct, fmtPx, pctClass } from '@/lib/format'
import page from './page.module.css'
import styles from './split.module.css'

type BoardList = {
  id: string
  name?: string
  sector?: string
  n_tickers?: number
  source?: string
}

type BoardRow = {
  ticker: string
  name?: string
  price?: number | null
  pct?: number | null
  entry_price?: number | null
  entry_date?: string | null
  since_entry_pct?: number | null
  note?: string
}

type Board = {
  ok?: boolean
  rows?: BoardRow[]
  breadth?: { n_up?: number; n_down?: number; avg_pct?: number }
  list?: { name?: string }
}

export function BuilderPage() {
  const [lists, setLists] = useState<BoardList[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [board, setBoard] = useState<Board | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [addTk, setAddTk] = useState('')

  const loadLists = async () => {
    const d = await api<{ lists?: BoardList[] }>('/api/v2/builder/lists')
    const arr = d.lists || []
    setLists(arr)
    if (!active && arr[0]) setActive(arr[0].id)
    return arr
  }

  const loadBoard = async (id: string) => {
    const d = await api<Board>(`/api/v2/builder/lists/${id}`)
    setBoard(d)
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        await loadLists()
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : 'Failed to load boards')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!active) return
    let alive = true
    ;(async () => {
      try {
        await loadBoard(active)
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : 'Board failed')
      }
    })()
    return () => {
      alive = false
    }
  }, [active])

  const seed = async () => {
    setBusy(true)
    try {
      await api('/api/v2/builder/lists/seed', { method: 'POST', body: '{}' })
      await loadLists()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Seed failed')
    } finally {
      setBusy(false)
    }
  }

  const addTicker = async () => {
    if (!active || !addTk.trim()) return
    setBusy(true)
    try {
      await api(`/api/v2/builder/lists/${active}/tickers`, {
        method: 'POST',
        body: JSON.stringify({ tickers: addTk.trim().toUpperCase() }),
      })
      setAddTk('')
      await loadBoard(active)
      await loadLists()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Add failed')
    } finally {
      setBusy(false)
    }
  }

  const rows = [...(board?.rows || [])].sort(
    (a, b) => (b.since_entry_pct ?? -999) - (a.since_entry_pct ?? -999),
  )
  const title = board?.list?.name || lists.find((l) => l.id === active)?.name || 'Board'

  return (
    <div className={page.page}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Sectors · track over time</p>
          <h1 className={page.h1}>Builder</h1>
          <p className={page.sub}>
            Named sector boards with cost basis from first add and since-add tracking.
          </p>
        </div>
        <div className={page.heroActions}>
          <Button size="sm" onClick={() => void seed()} disabled={busy}>
            Seed sector boards
          </Button>
        </div>
      </header>
      {err && <div className={page.bannerErr}>{err}</div>}
      {loading ? (
        <Spinner />
      ) : (
        <div className={styles.split}>
          <aside className={styles.side}>
            <Panel title="Boards" badge={lists.length} flush>
              {lists.length === 0 && (
                <Empty title="No boards" sub="Click Seed sector boards to create defaults." />
              )}
              {lists.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={`${styles.sideItem} ${active === l.id ? styles.sideActive : ''}`}
                  onClick={() => setActive(l.id)}
                >
                  <div className={styles.sideTitle}>{l.name}</div>
                  <div className={styles.sideSub}>
                    {l.n_tickers ?? 0} names · {l.source || 'manual'}
                  </div>
                </button>
              ))}
            </Panel>
          </aside>
          <div className={styles.main}>
            {!active ? (
              <Empty title="Select a board" />
            ) : (
              <>
                {board?.breadth && (
                  <div className={styles.kpiRow}>
                    <div className={styles.kpi}>
                      <div className={styles.kpiLabel}>Up today</div>
                      <div className={`${styles.kpiVal} pos`}>{board.breadth.n_up ?? '—'}</div>
                    </div>
                    <div className={styles.kpi}>
                      <div className={styles.kpiLabel}>Down today</div>
                      <div className={`${styles.kpiVal} neg`}>{board.breadth.n_down ?? '—'}</div>
                    </div>
                    <div className={styles.kpi}>
                      <div className={styles.kpiLabel}>Avg day %</div>
                      <div className={`${styles.kpiVal} tabular ${pctClass(board.breadth.avg_pct)}`}>
                        {fmtPct(board.breadth.avg_pct)}
                      </div>
                    </div>
                  </div>
                )}
                <Panel title={title} badge={`${rows.length} names`} flush>
                  <div className={styles.addBar}>
                    <input
                      className={styles.addInput}
                      placeholder="Add tickers: NVDA, AMD"
                      value={addTk}
                      onChange={(e) => setAddTk(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === 'Enter' && void addTicker()}
                    />
                    <Button size="sm" variant="primary" onClick={() => void addTicker()} disabled={busy}>
                      Add
                    </Button>
                  </div>
                  {!rows.length ? (
                    <Empty title="Empty board" sub="Add tickers to start tracking since-add %." />
                  ) : (
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>Ticker</th>
                            <th className="tabular">Last</th>
                            <th className="tabular">Day %</th>
                            <th className="tabular">Cost basis</th>
                            <th className="tabular">Since add %</th>
                            <th>First added</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.ticker}>
                              <td>
                                <span className={styles.tk}>{r.ticker}</span>
                                {r.name && <div className={styles.name}>{r.name}</div>}
                              </td>
                              <td className="tabular">{fmtPx(r.price)}</td>
                              <td className={`tabular ${pctClass(r.pct)}`}>{fmtPct(r.pct)}</td>
                              <td className="tabular">{fmtPx(r.entry_price)}</td>
                              <td className={`tabular ${pctClass(r.since_entry_pct)}`}>
                                {fmtPct(r.since_entry_pct)}
                              </td>
                              <td className={styles.meta}>{r.entry_date || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
