import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { Empty, Spinner } from '@/components/ui/Empty'
import { StockPeek } from '@/components/layout/StockPeek'
import { api } from '@/lib/api'
import { fmtPct, fmtPx, pctClass } from '@/lib/format'
import page from './page.module.css'
import split from './split.module.css'
import styles from './BuilderPage.module.css'

/* ── types ─────────────────────────────────────────────────────── */

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
  dga_score?: number | null
}

type Board = {
  ok?: boolean
  rows?: BoardRow[]
  breadth?: { n_up?: number; n_down?: number; avg_pct?: number }
  list?: { name?: string; source?: string }
}

type Candidate = {
  ticker: string
  name?: string
  sector?: string
  rating?: string | null
  upside_pct?: number | null
  current_price?: number | null
  price_target?: number | null
}

type ConstructRow = {
  ticker: string
  name?: string
  sector?: string
  weight_pct?: number
  dollars?: number
  shares?: number | null
  actual_dollars?: number
  price?: number | null
  rating?: string | null
  upside_pct?: number | null
  upside_filled?: boolean
}

type ConstructResult = {
  rows?: ConstructRow[]
  summary?: {
    positions?: number
    basket_size?: number
    allocated?: number
    residual_cash?: number
    expected_upside_pct?: number | null
    method?: string
    sector_breakdown?: Record<string, number>
  }
  missing_from_pool?: string[]
}

type Scenario = {
  id: string
  name?: string
  created_at?: string
  request?: Record<string, unknown>
  result?: ConstructResult
  watchlist_synced?: boolean
}

type Method = 'equal' | 'ev_weighted' | 'rating_weighted'
type Tab = 'boards' | 'construct'

const METHOD_HELP: Record<Method, string> = {
  equal: '1/N across selected names.',
  ev_weighted:
    'Softmax on expected upside (price target) — highest risk/reward gets more weight.',
  rating_weighted: 'Buy-family 1.5× · Hold 1.0× · Sell-family 0.4× · unrated 1.0×.',
}

/* ── page ──────────────────────────────────────────────────────── */

export function BuilderPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('boards')

  /* boards */
  const [lists, setLists] = useState<BoardList[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [board, setBoard] = useState<Board | null>(null)
  const [addTk, setAddTk] = useState('')
  const [peekTk, setPeekTk] = useState<string | null>(null)
  const hoverTimer = useRef<number | null>(null)
  const skipPeek = useRef(false)

  const openPeek = (tk: string) => {
    const sym = (tk || '').trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, '')
    if (sym) setPeekTk(sym)
  }

  const onBoardEnter = (tk: string) => {
    skipPeek.current = false
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => {
      if (!skipPeek.current) openPeek(tk)
    }, 280)
  }

  const onBoardLeave = () => {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }

  const openFinancials = (tk: string) => {
    const sym = (tk || '').trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, '')
    if (!sym) return
    skipPeek.current = true
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
    setPeekTk(null)
    navigate(`/financials?ticker=${encodeURIComponent(sym)}`)
  }

  /* construct */
  const [cands, setCands] = useState<Candidate[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [nPos, setNPos] = useState(18)
  const [basket, setBasket] = useState(1_000_000)
  const [method, setMethod] = useState<Method>('ev_weighted')
  const [maxStock, setMaxStock] = useState(10)
  const [maxSector, setMaxSector] = useState(0)
  const [result, setResult] = useState<ConstructResult | null>(null)
  const [lastRequest, setLastRequest] = useState<Record<string, unknown> | null>(null)
  const [scenarioName, setScenarioName] = useState('')
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [status, setStatus] = useState('')

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const loadLists = useCallback(async () => {
    const d = await api<{ lists?: BoardList[] }>('/api/v2/builder/lists')
    const arr = d.lists || []
    setLists(arr)
    setActive((prev) => {
      if (prev) return prev
      const dga = arr.find(
        (l) => (l.name || '').toLowerCase() === 'dga scored',
      )
      return dga?.id || arr[0]?.id || null
    })
    return arr
  }, [])

  const loadBoard = useCallback(async (id: string) => {
    const d = await api<Board>(`/api/v2/builder/lists/${encodeURIComponent(id)}`)
    setBoard(d)
  }, [])

  useEffect(() => {
    return () => {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
    }
  }, [])

  const loadCandidates = useCallback(async (fresh = false) => {
    const d = await api<{ candidates?: Candidate[]; total?: number }>(
      `/api/v2/builder/candidates${fresh ? '?fresh=1' : ''}`,
    )
    const list = d.candidates || []
    setCands(list)
    return list
  }, [])

  const loadScenarios = useCallback(async () => {
    const d = await api<{ scenarios?: Scenario[] }>('/api/v2/builder/scenarios')
    setScenarios(d.scenarios || [])
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        await Promise.all([loadLists(), loadCandidates(false), loadScenarios()])
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : 'Failed to load builder')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [loadLists, loadCandidates, loadScenarios])

  useEffect(() => {
    if (!active || tab !== 'boards') return
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
  }, [active, tab, loadBoard])

  /* ranked by EV for presets */
  const rankedByEv = useMemo(() => {
    return [...cands]
      .filter((c) => c.upside_pct != null && Number(c.upside_pct) > 0)
      .sort((a, b) => (b.upside_pct ?? -999) - (a.upside_pct ?? -999))
  }, [cands])

  const filtered = useMemo(() => {
    const q = filter.trim().toUpperCase()
    const list = [...cands].sort(
      (a, b) => (b.upside_pct ?? -999) - (a.upside_pct ?? -999),
    )
    if (!q) return list
    return list.filter(
      (c) =>
        c.ticker.includes(q) ||
        (c.name || '').toUpperCase().includes(q) ||
        (c.sector || '').toUpperCase().includes(q),
    )
  }, [cands, filter])

  const selectTopEv = (n: number, buyOnly = false) => {
    let pool = rankedByEv
    if (buyOnly) {
      pool = pool.filter((c) => {
        const r = (c.rating || '').toUpperCase()
        return (
          r.includes('BUY') ||
          r.includes('OVERWEIGHT') ||
          r.includes('OUTPERFORM') ||
          r.includes('ACCUMULATE')
        )
      })
    }
    const top = pool.slice(0, n).map((c) => c.ticker)
    setSelected(new Set(top))
    setNPos(n)
    setMethod('ev_weighted')
    setStatus(
      `Selected top ${top.length} by expected upside${buyOnly ? ' (Buy-rated)' : ''}. Click Build basket.`,
    )
  }

  const toggle = (tk: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(tk)) next.delete(tk)
      else next.add(tk)
      return next
    })
  }

  const selectAllFiltered = () => {
    setSelected(new Set(filtered.map((c) => c.ticker)))
  }

  const clearSel = () => setSelected(new Set())

  const build = async () => {
    let picks = [...selected]
    if (!picks.length) {
      // Auto high-conviction if nothing selected
      picks = rankedByEv.slice(0, nPos).map((c) => c.ticker)
      if (!picks.length) {
        setErr('No saved-report candidates with upside. Run analyses first.')
        return
      }
      setSelected(new Set(picks))
    }
    // Cap to N positions, keeping highest EV if over-selected
    if (picks.length > nPos) {
      const rank = new Map(rankedByEv.map((c, i) => [c.ticker, i]))
      picks = [...picks]
        .sort((a, b) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999))
        .slice(0, nPos)
      setSelected(new Set(picks))
    }
    setBusy(true)
    setErr(null)
    setStatus('Building basket…')
    try {
      const body = {
        tickers: picks,
        basket_size: basket,
        method,
        max_per_stock_pct: maxStock,
        max_per_sector_pct: maxSector,
        softmax_temperature: 1.0,
      }
      const d = await api<ConstructResult>('/api/v2/builder/construct', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      setResult(d)
      setLastRequest(body)
      const s = d.summary
      setStatus(
        `Built ${s?.positions ?? 0} names · expected upside ${s?.expected_upside_pct != null ? s.expected_upside_pct.toFixed(1) + '%' : '—'} · ${method}`,
      )
      setScenarioName(
        `High conviction ${nPos} · ${new Date().toISOString().slice(0, 10)}`,
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Construct failed')
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  const saveScenario = async () => {
    if (!result || !lastRequest) return
    setBusy(true)
    try {
      await api('/api/v2/builder/scenarios', {
        method: 'POST',
        body: JSON.stringify({
          name: scenarioName.trim() || undefined,
          request: lastRequest,
          result,
        }),
      })
      setStatus('✓ Scenario saved — reopen anytime under Saved scenarios.')
      await loadScenarios()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const trackAsBoard = async () => {
    if (!result?.rows?.length) return
    setBusy(true)
    try {
      const name =
        scenarioName.trim() ||
        `High conviction ${result.rows.length} · ${new Date().toISOString().slice(0, 10)}`
      const tickers = result.rows.map((r) => r.ticker)
      const d = await api<{ ok?: boolean; id?: string; lists?: BoardList[] }>(
        '/api/v2/builder/lists',
        {
          method: 'POST',
          body: JSON.stringify({
            name,
            sector: 'High Conviction',
            tickers,
          }),
        },
      )
      setStatus(
        `✓ Tracking board created with ${tickers.length} names (since-add %). Open Boards tab.`,
      )
      if (d.lists) setLists(d.lists)
      else await loadLists()
      if (d.id) {
        setActive(d.id)
        setTab('boards')
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create board')
    } finally {
      setBusy(false)
    }
  }

  const toWatchlist = async (scenarioId: string) => {
    setBusy(true)
    try {
      const d = await api<{ ok?: boolean; added_count?: number; total_in_basket?: number }>(
        `/api/v2/builder/scenarios/${encodeURIComponent(scenarioId)}/to-watchlist`,
        { method: 'POST', body: '{}' },
      )
      setStatus(
        `✓ Added ${d.added_count ?? 0} new name(s) to Desk watchlist (${d.total_in_basket ?? 0} in basket).`,
      )
      await loadScenarios()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Watchlist sync failed')
    } finally {
      setBusy(false)
    }
  }

  const deleteScenario = async (id: string) => {
    if (!window.confirm('Delete this saved scenario?')) return
    try {
      await api(`/api/v2/builder/scenarios/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      await loadScenarios()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const openScenario = (sc: Scenario) => {
    if (sc.result) setResult(sc.result)
    if (sc.request) {
      setLastRequest(sc.request)
      const tks = (sc.request.tickers as string[]) || []
      if (tks.length) setSelected(new Set(tks))
      if (typeof sc.request.method === 'string')
        setMethod(sc.request.method as Method)
      if (typeof sc.request.basket_size === 'number')
        setBasket(sc.request.basket_size)
    }
    setScenarioName(sc.name || '')
    setStatus(`Loaded scenario “${sc.name || sc.id}”.`)
    setTab('construct')
  }

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

  const refreshDgaScored = async () => {
    setBusy(true)
    setErr(null)
    try {
      const d = await api<{
        id?: string
        n?: number
        lists?: BoardList[]
        board?: Board
      }>('/api/v2/builder/lists/dga-scored', { method: 'POST' })
      if (d.lists) setLists(d.lists)
      if (d.id) setActive(d.id)
      if (d.board) setBoard(d.board)
      else if (d.id) await loadBoard(d.id)
      setStatus(
        `DGA Scored · ${d.n ?? 0} names with score > 90, highest first.`,
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not refresh DGA Scored')
    } finally {
      setBusy(false)
    }
  }

  const addTicker = async () => {
    if (!active || !addTk.trim()) return
    setBusy(true)
    try {
      await api(`/api/v2/builder/lists/${encodeURIComponent(active)}/tickers`, {
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

  const scoredBoard = (board?.rows || []).some((r) => r.dga_score != null)
  const boardRows = [...(board?.rows || [])].sort((a, b) => {
    if (scoredBoard) {
      return (b.dga_score ?? -1) - (a.dga_score ?? -1)
    }
    return (b.since_entry_pct ?? -999) - (a.since_entry_pct ?? -999)
  })
  const boardTitle =
    board?.list?.name || lists.find((l) => l.id === active)?.name || 'Board'
  const activeList = lists.find((l) => l.id === active)
  const isDgaScored =
    (activeList?.name || '').toLowerCase() === 'dga scored' ||
    activeList?.source === 'dga_score' ||
    scoredBoard
  const constructRows = result?.rows || []
  const sum = result?.summary

  return (
    <div className={page.page}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Research · portfolio design</p>
          <h1 className={page.h1}>Builder</h1>
          <p className={page.sub}>
            Build high expected-value baskets from saved reports (15–20 names),
            save high-conviction scenarios, and track them as boards over time.
          </p>
        </div>
        <div className={page.heroActions}>
          <div className={styles.tabs}>
            <button
              type="button"
              className={`${styles.tab} ${tab === 'boards' ? styles.tabOn : ''}`}
              onClick={() => setTab('boards')}
            >
              Track boards
            </button>
            <button
              type="button"
              className={`${styles.tab} ${tab === 'construct' ? styles.tabOn : ''}`}
              onClick={() => setTab('construct')}
            >
              Construct basket
            </button>
          </div>
        </div>
      </header>

      {err && <div className={page.bannerErr}>{err}</div>}
      {status && !err && <div className={styles.okBanner}>{status}</div>}

      {loading ? (
        <Spinner label="Loading builder…" />
      ) : tab === 'construct' ? (
        <>
          <div className={styles.constructGrid}>
            {/* Pool */}
            <Panel
              title="Research pool"
              badge={`${selected.size} selected · ${cands.length} candidates`}
              flush
              action={
                <Button
                  size="sm"
                  onClick={() => void loadCandidates(true)}
                  disabled={busy}
                >
                  ↻ Refresh
                </Button>
              }
            >
              <div className={styles.poolHead}>
                <input
                  className={styles.poolSearch}
                  placeholder="Filter ticker / name / sector…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <Button size="sm" onClick={selectAllFiltered}>
                  All
                </Button>
                <Button size="sm" onClick={clearSel}>
                  None
                </Button>
              </div>
              <p className={styles.hint} style={{ paddingTop: 10 }}>
                Pool = saved reports with price targets. Sort is expected upside
                (risk/reward). Use presets for a 15–20 name high-conviction book.
              </p>
              <div className={styles.presets}>
                <button
                  type="button"
                  className={styles.preset}
                  onClick={() => selectTopEv(15)}
                >
                  Top 15 EV
                </button>
                <button
                  type="button"
                  className={styles.preset}
                  onClick={() => selectTopEv(18)}
                >
                  Top 18 EV
                </button>
                <button
                  type="button"
                  className={styles.preset}
                  onClick={() => selectTopEv(20)}
                >
                  Top 20 EV
                </button>
                <button
                  type="button"
                  className={styles.preset}
                  onClick={() => selectTopEv(15, true)}
                >
                  Top 15 Buy-rated
                </button>
              </div>
              {!filtered.length ? (
                <Empty
                  title="No candidates"
                  sub="Generate multi-engine reports on the Desk so targets & upside feed this pool."
                />
              ) : (
                <div className={styles.poolList}>
                  {filtered.map((c) => (
                    <label
                      key={c.ticker}
                      className={`${styles.poolRow} ${selected.has(c.ticker) ? styles.poolRowOn : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(c.ticker)}
                        onChange={() => toggle(c.ticker)}
                      />
                      <span className={styles.poolTk}>{c.ticker}</span>
                      <span className={styles.poolName}>
                        {c.name || c.sector || '—'}
                      </span>
                      <span className={`${styles.poolUp} ${pctClass(c.upside_pct)}`}>
                        {fmtPct(c.upside_pct)}
                      </span>
                      <span className={styles.poolRating}>{c.rating || '—'}</span>
                    </label>
                  ))}
                </div>
              )}
            </Panel>

            {/* Construction controls */}
            <Panel title="Construction" badge="highest risk / reward">
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label>Positions (N)</label>
                  <input
                    type="number"
                    min={5}
                    max={40}
                    value={nPos}
                    onChange={(e) =>
                      setNPos(Math.max(5, Math.min(40, parseInt(e.target.value, 10) || 18)))
                    }
                  />
                </div>
                <div className={styles.field}>
                  <label>Basket size ($)</label>
                  <input
                    type="number"
                    min={0}
                    step={10000}
                    value={basket}
                    onChange={(e) => setBasket(parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className={styles.field}>
                  <label>Max per stock (%)</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={maxStock}
                    onChange={(e) => setMaxStock(parseFloat(e.target.value) || 10)}
                  />
                </div>
                <div className={styles.field}>
                  <label>Max per sector % (0 = off)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    value={maxSector}
                    onChange={(e) => setMaxSector(parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>
              <div className={styles.formGrid} style={{ paddingTop: 0 }}>
                <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
                  <label>Weighting</label>
                  <div className={styles.methodSeg}>
                    {(
                      [
                        ['ev_weighted', 'Conviction (EV)'],
                        ['equal', 'Equal weight'],
                        ['rating_weighted', 'Rating-tiered'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className={`${styles.methodBtn} ${method === id ? styles.methodOn : ''}`}
                        onClick={() => setMethod(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className={styles.hint} style={{ padding: '6px 0 0' }}>
                    {METHOD_HELP[method]}
                  </p>
                </div>
              </div>
              <div className={styles.actions}>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void build()}
                >
                  {busy ? 'Building…' : 'Build high-conviction basket'}
                </Button>
                <span className={styles.hint} style={{ padding: 0 }}>
                  Default: top {nPos} by expected upside, EV-weighted.
                </span>
              </div>
            </Panel>
          </div>

          {/* Result */}
          {result && (
            <Panel
              title="Allocation result"
              badge={`${sum?.positions ?? 0} positions`}
              flush
            >
              <div className={styles.summary}>
                <span>
                  Expected upside{' '}
                  <strong className={pctClass(sum?.expected_upside_pct)}>
                    {fmtPct(sum?.expected_upside_pct)}
                  </strong>
                </span>
                <span>
                  Basket{' '}
                  <strong>
                    {sum?.basket_size != null
                      ? `$${Number(sum.basket_size).toLocaleString()}`
                      : '—'}
                  </strong>
                </span>
                <span>
                  Allocated{' '}
                  <strong>
                    {sum?.allocated != null
                      ? `$${Number(sum.allocated).toLocaleString()}`
                      : '—'}
                  </strong>
                </span>
                <span>
                  Cash residual{' '}
                  <strong>
                    {sum?.residual_cash != null
                      ? `$${Number(sum.residual_cash).toLocaleString()}`
                      : '—'}
                  </strong>
                </span>
                <span>
                  Method <strong>{sum?.method || method}</strong>
                </span>
              </div>
              {sum?.sector_breakdown && (
                <div className={styles.sectorBreak}>
                  {Object.entries(sum.sector_breakdown).map(([s, w]) => (
                    <span key={s} className={styles.secChip}>
                      {s} {Number(w).toFixed(1)}%
                    </span>
                  ))}
                </div>
              )}
              <div className={styles.saveRow}>
                <input
                  className={styles.saveInput}
                  placeholder="Name this high-conviction book"
                  value={scenarioName}
                  onChange={(e) => setScenarioName(e.target.value)}
                />
                <Button size="sm" disabled={busy} onClick={() => void saveScenario()}>
                  Save scenario
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy}
                  onClick={() => void trackAsBoard()}
                >
                  Track as board
                </Button>
              </div>
              <div className={split.tableWrap}>
                <table className={split.table}>
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Sector</th>
                      <th className="tabular">Weight</th>
                      <th className="tabular">$</th>
                      <th className="tabular">Shares</th>
                      <th className="tabular">Price</th>
                      <th className="tabular">Upside</th>
                      <th>Rating</th>
                    </tr>
                  </thead>
                  <tbody>
                    {constructRows.map((r) => (
                      <tr key={r.ticker}>
                        <td>
                          <span className={split.tk}>{r.ticker}</span>
                          {r.name && <div className={split.name}>{r.name}</div>}
                        </td>
                        <td className={split.meta}>{r.sector || '—'}</td>
                        <td className="tabular">
                          {r.weight_pct != null ? `${r.weight_pct.toFixed(1)}%` : '—'}
                        </td>
                        <td className="tabular">
                          {r.dollars != null
                            ? `$${Number(r.dollars).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                            : '—'}
                        </td>
                        <td className="tabular">{r.shares ?? '—'}</td>
                        <td className="tabular">{fmtPx(r.price)}</td>
                        <td className={`tabular ${pctClass(r.upside_pct)}`}>
                          {fmtPct(r.upside_pct)}
                          {r.upside_filled ? '*' : ''}
                        </td>
                        <td>{r.rating || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          {/* Saved scenarios */}
          <Panel title="Saved high-conviction scenarios" badge={scenarios.length} flush>
            {!scenarios.length ? (
              <Empty
                title="No saved scenarios yet"
                sub="Build a basket, name it, and Save — then track as a board or push to the Desk watchlist."
              />
            ) : (
              scenarios.map((sc) => {
                const n =
                  sc.result?.rows?.length ||
                  sc.result?.summary?.positions ||
                  ((sc.request?.tickers as string[]) || []).length ||
                  0
                const exp = sc.result?.summary?.expected_upside_pct
                return (
                  <div key={sc.id} className={styles.scenarioRow}>
                    <div className={styles.scenarioTitle}>
                      {sc.name || sc.id}
                      <div className={styles.scenarioMeta}>
                        {(sc.created_at || '').slice(0, 16).replace('T', ' ')} · {n}{' '}
                        names
                        {exp != null ? ` · EV ${fmtPct(exp)}` : ''}
                        {sc.watchlist_synced ? ' · on watchlist' : ''}
                      </div>
                    </div>
                    <Button size="sm" onClick={() => openScenario(sc)}>
                      Open
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busy}
                      onClick={() => void toWatchlist(sc.id)}
                    >
                      → Watchlist
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => void deleteScenario(sc.id)}
                    >
                      Delete
                    </Button>
                  </div>
                )
              })
            )}
          </Panel>
        </>
      ) : (
        /* ── Boards tab ── */
        <div className={split.split}>
          <aside className={split.side}>
            <Panel title="Boards" badge={lists.length} flush>
              <div style={{ padding: 10 }}>
                <Button size="sm" onClick={() => void seed()} disabled={busy}>
                  Seed sector boards
                </Button>
              </div>
              {lists.length === 0 && (
                <Empty
                  title="No boards"
                  sub="Track a high-conviction basket from Construct, or seed sector boards."
                />
              )}
              {lists.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={`${split.sideItem} ${active === l.id ? split.sideActive : ''}`}
                  onClick={() => setActive(l.id)}
                >
                  <div className={split.sideTitle}>{l.name}</div>
                  <div className={split.sideSub}>
                    {l.n_tickers ?? 0} names ·{' '}
                    {l.source === 'dga_score'
                      ? 'score > 90'
                      : l.sector || l.source || 'manual'}
                  </div>
                </button>
              ))}
            </Panel>
          </aside>
          <div className={split.main}>
            {!active ? (
              <Empty title="Select a board" />
            ) : (
              <>
                {board?.breadth && (
                  <div className={split.kpiRow}>
                    <div className={split.kpi}>
                      <div className={split.kpiLabel}>Up today</div>
                      <div className={`${split.kpiVal} pos`}>
                        {board.breadth.n_up ?? '—'}
                      </div>
                    </div>
                    <div className={split.kpi}>
                      <div className={split.kpiLabel}>Down today</div>
                      <div className={`${split.kpiVal} neg`}>
                        {board.breadth.n_down ?? '—'}
                      </div>
                    </div>
                    <div className={split.kpi}>
                      <div className={split.kpiLabel}>Avg day %</div>
                      <div
                        className={`${split.kpiVal} tabular ${pctClass(board.breadth.avg_pct)}`}
                      >
                        {fmtPct(board.breadth.avg_pct)}
                      </div>
                    </div>
                  </div>
                )}
                <Panel
                  title={boardTitle}
                  badge={`${boardRows.length} names`}
                  flush
                  action={
                    isDgaScored ? (
                      <Button
                        size="sm"
                        onClick={() => void refreshDgaScored()}
                        disabled={busy}
                      >
                        Refresh scores
                      </Button>
                    ) : null
                  }
                >
                  <div className={split.addBar}>
                    <input
                      className={split.addInput}
                      placeholder="Add tickers: NVDA, AMD"
                      value={addTk}
                      onChange={(e) => setAddTk(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === 'Enter' && void addTicker()}
                    />
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => void addTicker()}
                      disabled={busy}
                    >
                      Add
                    </Button>
                  </div>
                  {!boardRows.length ? (
                    <Empty
                      title="Empty board"
                      sub="Add tickers or create one from Construct → Track as board."
                    />
                  ) : (
                    <div className={split.tableWrap}>
                      <table className={split.table}>
                        <thead>
                          <tr>
                            <th>Ticker</th>
                            {isDgaScored && (
                              <th className="tabular" title="DGA Score (0–100)">
                                DGA
                              </th>
                            )}
                            <th className="tabular">Last</th>
                            <th className="tabular">Day %</th>
                            <th className="tabular">Cost basis</th>
                            <th className="tabular">Since add %</th>
                            <th>First added</th>
                          </tr>
                        </thead>
                        <tbody>
                          {boardRows.map((r) => (
                            <tr
                              key={r.ticker}
                              className={split.rowClick}
                              title={`${r.ticker} — hover for snapshot, click for Financials`}
                              onMouseEnter={() => onBoardEnter(r.ticker)}
                              onMouseLeave={onBoardLeave}
                              onClick={() => openFinancials(r.ticker)}
                            >
                              <td>
                                <span className={split.tk}>{r.ticker}</span>
                                {r.name && (
                                  <div className={split.name}>{r.name}</div>
                                )}
                              </td>
                              {isDgaScored && (
                                <td className="tabular">
                                  {r.dga_score != null ? r.dga_score : '—'}
                                </td>
                              )}
                              <td className="tabular">{fmtPx(r.price)}</td>
                              <td className={`tabular ${pctClass(r.pct)}`}>
                                {fmtPct(r.pct)}
                              </td>
                              <td className="tabular">{fmtPx(r.entry_price)}</td>
                              <td
                                className={`tabular ${pctClass(r.since_entry_pct)}`}
                              >
                                {fmtPct(r.since_entry_pct)}
                              </td>
                              <td className={split.meta}>{r.entry_date || '—'}</td>
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
      {peekTk && (
        <StockPeek
          key={peekTk}
          ticker={peekTk}
          onClose={() => setPeekTk(null)}
        />
      )}
    </div>
  )
}
