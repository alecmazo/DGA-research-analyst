import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { api } from '@/lib/api'
import { fmtPct, fmtPx, pctClass } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Empty, Spinner } from '@/components/ui/Empty'
import styles from './GuruFocusTab.module.css'

type GfList = {
  id: string
  name?: string
  created_on?: string | null
  stock_count?: number
  is_overview?: boolean
  is_local?: boolean
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
  ann_gain?: number | null
  fair_value?: number | null
  note?: string | null
  list_id?: string | null
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
  const [addTk, setAddTk] = useState('')
  const [adding, setAdding] = useState(false)
  const [addMsg, setAddMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [confirmDel, setConfirmDel] = useState<GfList | null>(null)
  const [draftNote, setDraftNote] = useState<Record<string, string>>({})
  const [draftFv, setDraftFv] = useState<Record<string, string>>({})

  const applyLists = (d: { lists?: GfList[]; synced_at?: string; stock_count?: number }) => {
    setLists(d.lists || [])
    setMeta((m) => ({ ...m, synced_at: d.synced_at, n: d.stock_count }))
  }

  const applyList = (d: {
    synced_at?: string
    list?: { name?: string; stocks?: GfStock[]; stock_count?: number }
  }) => {
    setStocks(d.list?.stocks || [])
    setMeta((m) => ({
      ...m,
      name: d.list?.name,
      synced_at: d.synced_at || m.synced_at,
      n: d.list?.stock_count,
    }))
  }

  const loadLists = useCallback(async () => {
    const d = await api<{ lists?: GfList[]; synced_at?: string; stock_count?: number }>(
      '/api/v2/builder/gurufocus',
    )
    applyLists(d)
    return d
  }, [])

  const loadList = useCallback(async (id: string) => {
    setBusy(true)
    try {
      const d = await api<{
        synced_at?: string
        list?: { name?: string; stocks?: GfStock[]; stock_count?: number }
      }>(`/api/v2/builder/gurufocus/${encodeURIComponent(id)}`)
      applyList(d)
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
    setAddTk('')
    setAddMsg(null)
    setDraftNote({})
    setDraftFv({})
    try {
      await loadList(id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load watchlist')
    }
  }

  const addTickers = async () => {
    const raw = addTk.trim()
    if (!raw || active === 'overview' || adding) return
    setAdding(true)
    setAddMsg(null)
    try {
      const d = await api<{
        added?: string[]
        skipped?: string[]
        list?: { stocks?: GfStock[]; stock_count?: number; name?: string }
        synced_at?: string
      }>(`/api/v2/builder/gurufocus/${encodeURIComponent(active)}/tickers`, {
        method: 'POST',
        body: JSON.stringify({ tickers: raw }),
      })
      applyList(d)
      await loadLists()
      const added = d.added || []
      const skipped = d.skipped || []
      if (added.length) setAddTk('')
      const bits: string[] = []
      if (added.length) bits.push(`Added ${added.join(', ')}`)
      if (skipped.length) bits.push(`already on list: ${skipped.join(', ')}`)
      setAddMsg(bits.join(' · ') || 'Nothing to add')
    } catch (e) {
      setAddMsg(e instanceof Error ? e.message : 'Add failed')
    } finally {
      setAdding(false)
    }
  }

  const createList = async () => {
    const name = newName.trim()
    if (!name) return
    try {
      const d = await api<{ id?: string; lists?: GfList[]; synced_at?: string; stock_count?: number }>(
        '/api/v2/builder/gurufocus',
        { method: 'POST', body: JSON.stringify({ name }) },
      )
      applyLists(d)
      setCreating(false)
      setNewName('')
      if (d.id) await pick(d.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create watchlist')
    }
  }

  const deleteList = async (l: GfList) => {
    const d = await api<{ lists?: GfList[]; synced_at?: string; stock_count?: number }>(
      `/api/v2/builder/gurufocus/${encodeURIComponent(l.id)}`,
      { method: 'DELETE' },
    )
    setConfirmDel(null)
    applyLists(d)
    if (active === l.id) await pick('overview')
    else await loadList(active)
  }

  const removeStock = async (r: GfStock, e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const lid = active === 'overview' ? r.list_id : active
    if (!lid || lid === 'overview' || !r.symbol) return
    const d = await api<{
      list?: { stocks?: GfStock[]; stock_count?: number; name?: string }
      synced_at?: string
    }>(
      `/api/v2/builder/gurufocus/${encodeURIComponent(lid)}/tickers/${encodeURIComponent(r.symbol)}`,
      { method: 'DELETE' },
    )
    if (active === 'overview') await loadList('overview')
    else applyList(d)
    await loadLists()
    onLeave()
  }

  const saveEdit = async (r: GfStock, patch: { note?: string; fair_value?: number | null }) => {
    const lid = active === 'overview' ? r.list_id : active
    if (!lid || lid === 'overview' || !r.symbol) return
    const d = await api<{
      list?: { stocks?: GfStock[]; stock_count?: number; name?: string }
      synced_at?: string
    }>(
      `/api/v2/builder/gurufocus/${encodeURIComponent(lid)}/tickers/${encodeURIComponent(r.symbol)}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    )
    if (active === 'overview') await loadList('overview')
    else applyList(d)
  }

  const noteKey = (r: GfStock) => `${r.list_id || active}:${r.symbol}`

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
        <label className={styles.pickerWrap}>
          <span className={styles.pickerLabel}>Watchlist</span>
          <select
            className={styles.picker}
            value={active}
            onChange={(e) => void pick(e.target.value)}
            aria-label="Select watchlist"
          >
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.stock_count != null ? ` · ${l.stock_count}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.cards}>
        {lists.map((l) => (
          <div
            key={l.id}
            className={`${styles.card} ${active === l.id ? styles.cardOn : ''}`}
          >
            {!l.is_overview && (
              <button
                type="button"
                className={styles.cardX}
                title={`Delete ${l.name}`}
                aria-label={`Delete ${l.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setConfirmDel(l)
                }}
              >
                ×
              </button>
            )}
            <button type="button" className={styles.cardHit} onClick={() => void pick(l.id)}>
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
          </div>
        ))}
        {creating ? (
          <form
            className={`${styles.card} ${styles.plusCard}`}
            onSubmit={(e) => {
              e.preventDefault()
              void createList()
            }}
          >
            <input
              className={styles.plusInput}
              autoFocus
              placeholder="Watchlist name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setCreating(false)
                  setNewName('')
                }
              }}
            />
            <div className={styles.plusActions}>
              <Button size="sm" variant="primary" type="submit" disabled={!newName.trim()}>
                Create
              </Button>
              <Button
                size="sm"
                type="button"
                onClick={() => {
                  setCreating(false)
                  setNewName('')
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className={`${styles.card} ${styles.plusCard}`}
            onClick={() => setCreating(true)}
            title="New watchlist"
          >
            <div className={styles.plusMark}>+</div>
            <div className={styles.cardMeta}>New watchlist</div>
          </button>
        )}
      </div>

      {confirmDel && (
        <div className={styles.confirmBar} role="alertdialog" aria-label="Confirm delete">
          <span>
            Delete watchlist <strong>{confirmDel.name}</strong>? Names on this desk list will
            be removed.
          </span>
          <Button size="sm" onClick={() => setConfirmDel(null)}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" onClick={() => void deleteList(confirmDel)}>
            Delete
          </Button>
        </div>
      )}

      <div className={styles.tableCard}>
        <div className={styles.tableHead}>
          <div className={styles.titleRow}>
            <h3 className={styles.tableTitle}>{meta.name || 'Overview'}</h3>
            {active !== 'overview' && (
              <form
                className={styles.addForm}
                onSubmit={(e) => {
                  e.preventDefault()
                  void addTickers()
                }}
              >
                <input
                  className={styles.addInput}
                  placeholder="Add tickers: RKLB, LUNR"
                  value={addTk}
                  onChange={(e) => setAddTk(e.target.value.toUpperCase())}
                  disabled={adding}
                />
                <Button
                  size="sm"
                  variant="primary"
                  type="submit"
                  disabled={adding || !addTk.trim()}
                >
                  {adding ? 'Adding…' : 'Add'}
                </Button>
                {addMsg && <span className={styles.addMsg}>{addMsg}</span>}
              </form>
            )}
          </div>
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
          <Empty title="No names" sub="Add tickers next to the watchlist name, or pick another list." />
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
                  <th className="tabular">Annualized Gain</th>
                  <th className="tabular">Fair Value</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const nk = noteKey(r)
                  return (
                    <tr
                      key={`${r.list_id || ''}-${r.symbol}-${i}`}
                      onMouseEnter={() => onPeek(r.symbol)}
                      onMouseLeave={onLeave}
                      onClick={() => onOpen(r.symbol)}
                    >
                      {active === 'overview' && (
                        <td className={styles.listName}>{r.list_name || '—'}</td>
                      )}
                      <td className={styles.tkCell}>
                        {active !== 'overview' && (
                          <button
                            type="button"
                            className={styles.rowX}
                            title={`Remove ${r.symbol}`}
                            aria-label={`Remove ${r.symbol}`}
                            onClick={(e) => void removeStock(r, e)}
                          >
                            ×
                          </button>
                        )}
                        <span className={styles.tk}>{r.symbol}</span>
                      </td>
                      <td className={styles.co}>{r.company || '—'}</td>
                      <td className="tabular">{fmtPx(r.price)}</td>
                      <td className={`tabular ${pctClass(r.day_pct)}`}>{fmtPct(r.day_pct)}</td>
                      <td className={styles.date}>{r.date_first_added || '—'}</td>
                      <td className="tabular">{fmtPx(r.cost_per_share)}</td>
                      <td className={`tabular ${pctClass(r.pct_since_first)}`}>
                        {fmtPct(r.pct_since_first)}
                      </td>
                      <td className={`tabular ${pctClass(r.rel_spy)}`}>{fmtPct(r.rel_spy)}</td>
                      <td className={`tabular ${pctClass(r.ann_gain)}`}>{fmtPct(r.ann_gain)}</td>
                      <td
                        className="tabular"
                        onClick={(e) => e.stopPropagation()}
                        onMouseEnter={onLeave}
                      >
                        <input
                          className={styles.editFv}
                          inputMode="decimal"
                          placeholder="—"
                          value={
                            draftFv[nk] ??
                            (r.fair_value != null ? String(r.fair_value) : '')
                          }
                          onChange={(e) =>
                            setDraftFv((p) => ({ ...p, [nk]: e.target.value }))
                          }
                          onBlur={() => {
                            const raw = (draftFv[nk] ?? '').trim()
                            const next = raw === '' ? null : Number(raw)
                            if (raw !== '' && Number.isNaN(next)) return
                            const prev = r.fair_value ?? null
                            if (next === prev || (next == null && prev == null)) {
                              setDraftFv((p) => {
                                const n = { ...p }
                                delete n[nk]
                                return n
                              })
                              return
                            }
                            void saveEdit(r, { fair_value: next })
                          }}
                        />
                      </td>
                      <td onClick={(e) => e.stopPropagation()} onMouseEnter={onLeave}>
                        <textarea
                          className={styles.editNote}
                          rows={1}
                          placeholder="Add a note"
                          value={draftNote[nk] ?? r.note ?? ''}
                          onChange={(e) =>
                            setDraftNote((p) => ({ ...p, [nk]: e.target.value }))
                          }
                          onBlur={() => {
                            const next = (draftNote[nk] ?? r.note ?? '').trim()
                            const prev = (r.note || '').trim()
                            if (next === prev) return
                            void saveEdit(r, { note: next })
                          }}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
