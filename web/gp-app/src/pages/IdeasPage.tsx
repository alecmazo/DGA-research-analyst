import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Empty, Spinner } from '@/components/ui/Empty'
import { api } from '@/lib/api'
import page from './page.module.css'
import styles from './IdeasPage.module.css'

type Breakdown = { key: string; label: string; score: number; weight: number }
type Source = { label: string; url: string }
type NumberRow = { label: string; value: string }
type NameRow = { ticker?: string; name?: string; revenue_pct?: number | null; debt_to_equity?: number | null }
type Chart = { labels?: string[]; series?: { name: string; values: Array<number | null> }[] }
type Alert = { kind: string; text: string }
type Card = {
  id: string
  type: string
  subtype?: string
  title: string
  score: number
  score_breakdown?: Breakdown[]
  thesis?: string
  bull?: string
  bear?: string
  falsify?: string
  question?: string
  key_numbers?: NumberRow[]
  sources?: Source[]
  as_of?: string
  status?: string
  chart?: Chart
  names?: NameRow[]
  ticker?: string
  tuned?: boolean
  tuned_note?: string
  weights?: Record<string, number>
  report?: string
  alerts?: Alert[]
  pass_reason?: string
}
type Settings = {
  auto?: boolean
  start_local?: string
  drawdown_min?: number
  drop_min?: number
  min_market_cap?: number
  insider_window_days?: number
  insider_cluster?: number
  ceo_cfo_min_usd?: number
  add_pct?: number
  grok_cap_usd?: number
  grok_model?: string
  watch_move_pct?: number
  themes?: string[]
  discovered_themes?: string[]
  funds?: { name: string; cik: string }[]
  extra_tickers?: string[]
  weights?: Record<string, Record<string, number>>
}
type Status = {
  auto?: boolean
  month_spend_usd?: number
  grok_cap_usd?: number
  running?: boolean
  plan?: { reason?: string; stage?: string }
  runs?: { stage: string; status: string; error?: string; attempts?: number }[]
  pass_chips?: string[]
}

const LANES = [
  { id: 'new', label: 'To decide', hint: 'Start here. Highest score first. Dig in, watch, or pass.' },
  { id: 'watching', label: 'Watching', hint: 'Names you kept. A price move or a headline shows on the idea.' },
  { id: 'dug_in', label: 'Dug in', hint: 'Ideas that already have a deep note. The note stays on the idea.' },
  { id: 'passed', label: 'Passed', hint: 'Set aside, with the reason. That reason nudges the next score.' },
] as const

const KINDS = [
  { id: '', label: 'All' },
  { id: 'sector', label: 'Sectors' },
  { id: 'weekly', label: 'Drops' },
  { id: 'insider', label: 'Insiders' },
  { id: 'trend', label: 'Trends' },
]

const KIND_LABEL: Record<string, string> = {
  sector: 'Sector',
  weekly: 'Drop',
  insider: 'Insider',
  trend: 'Trend',
}

const WEIGHT_LABEL: Record<string, string> = {
  drawdown: 'Drawdown',
  relative: 'Versus the market',
  valuation: 'Valuation',
  balance_sheet: 'Balance sheet',
  drop: 'Size of the drop',
  overreaction: 'Overreaction',
  idiosyncratic: 'Its own news',
  size: 'Company size',
  cluster: 'Cluster of buys',
  dollars: 'Dollars bought',
  role: 'CEO or CFO',
  filings: 'Filing mentions',
  patents: 'Patents',
  fda: 'FDA',
  search: 'Search momentum',
}

const CHIPS = [
  'already known',
  'too small',
  'structural',
  'cyclical',
  'bad balance sheet',
  'not my universe',
  'weak catalyst',
]

type LaneId = (typeof LANES)[number]['id']

function laneOf(value: string | null): LaneId {
  return LANES.some((lane) => lane.id === value) ? (value as LaneId) : 'new'
}

function kindOf(value: string | null): string {
  return KINDS.some((kind) => kind.id === value) ? value || '' : ''
}

function haystack(card: Card): string {
  return [
    card.title,
    card.thesis,
    card.question,
    card.ticker,
    card.type,
    card.pass_reason,
    ...(card.names || []).map((row) => `${row.ticker || ''} ${row.name || ''}`),
  ]
    .join(' ')
    .toLowerCase()
}

function money(value: number | undefined): string {
  return `$${Number(value || 0).toFixed(2)}`
}

function clock(value: string | undefined): string {
  const raw = (value || '06:00').trim()
  const [hourText, minuteText] = raw.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)
  if (!Number.isFinite(hour)) return raw
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const shown = hour % 12 || 12
  const minutes = Number.isFinite(minute) ? `:${String(minute).padStart(2, '0')}` : ''
  return `${shown}${minutes} ${suffix}`
}

function Spark({ chart }: { chart?: Chart }) {
  const series = chart?.series || []
  const width = 560
  const height = 120
  const nums = series.flatMap((row) => (row.values || []).filter((value): value is number => typeof value === 'number'))
  if (!nums.length) return null
  const lo = Math.min(...nums)
  const hi = Math.max(...nums)
  const span = hi - lo || 1
  const colors = ['var(--brand-600)', 'var(--text-secondary)', 'var(--text-primary)']
  return (
    <svg className={styles.spark} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Price path">
      {series.map((row, index) => {
        const values = row.values || []
        const step = values.length > 1 ? width / (values.length - 1) : width
        const points = values
          .map((value, i) => {
            if (typeof value !== 'number') return null
            const y = height - 10 - ((value - lo) / span) * (height - 20)
            return `${(i * step).toFixed(1)},${y.toFixed(1)}`
          })
          .filter(Boolean)
          .join(' ')
        return (
          <polyline
            key={row.name || index}
            fill="none"
            stroke={colors[index % colors.length]}
            strokeWidth="2.5"
            points={points}
          />
        )
      })}
    </svg>
  )
}

export function IdeasPage() {
  const [params, setParams] = useSearchParams()
  const lane = laneOf(params.get('lane'))
  const kind = kindOf(params.get('kind'))
  const sort = params.get('sort') === 'date' ? 'date' : 'score'
  const selected = params.get('id') || ''
  const settingsOpen = params.get('panel') === 'settings'

  const [cards, setCards] = useState<Card[] | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [desk, setDesk] = useState<Status | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [passFor, setPassFor] = useState('')
  const [chip, setChip] = useState(CHIPS[0])
  const [note, setNote] = useState('')
  const [narrow, setNarrow] = useState(false)

  const setNav = useCallback((patch: Record<string, string | null>) => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      let changed = false
      for (const [key, value] of Object.entries(patch)) {
        const now = next.get(key) || ''
        const want = value || ''
        if (now === want) continue
        changed = true
        if (!value) next.delete(key)
        else next.set(key, value)
      }
      return changed ? next : current
    }, { replace: true })
  }, [setParams])

  const loadCards = useCallback(async () => {
    const data = await api<{ cards: Card[] }>('/api/ideas/cards?sort=score')
    setCards(data.cards || [])
    return data.cards || []
  }, [])

  const loadRest = useCallback(async () => {
    const [statusRow, settingsRow] = await Promise.all([
      api<Status>('/api/ideas/status'),
      api<{ settings: Settings }>('/api/ideas/settings'),
    ])
    setDesk(statusRow)
    setSettings(settingsRow.settings)
  }, [])

  useEffect(() => {
    let alive = true
    setError('')
    void loadCards().catch((err: Error) => {
      if (alive) setError(err.message || 'Could not load ideas')
    })
    void loadRest().catch(() => {})
    return () => {
      alive = false
    }
  }, [loadCards, loadRest])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 860px)')
    const apply = () => setNarrow(media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])

  const needle = query.trim().toLowerCase()
  const inLane = useMemo(
    () => (cards || []).filter((card) => (card.status || 'new') === lane),
    [cards, lane],
  )
  const counts = useMemo(() => {
    const byLane: Record<string, number> = { new: 0, watching: 0, dug_in: 0, passed: 0 }
    const byKind: Record<string, number> = { '': 0, sector: 0, weekly: 0, insider: 0, trend: 0 }
    for (const card of cards || []) {
      const status = card.status || 'new'
      if (status in byLane) byLane[status] += 1
      if (status === lane) {
        byKind[''] += 1
        if (card.type in byKind) byKind[card.type] += 1
      }
    }
    return { byLane, byKind }
  }, [cards, lane])

  const filtered = useMemo(() => {
    const rows = inLane.filter((card) => {
      if (kind && card.type !== kind) return false
      if (needle && !haystack(card).includes(needle)) return false
      return true
    })
    rows.sort((a, b) => {
      if (sort === 'date') return (b.as_of || '').localeCompare(a.as_of || '') || b.score - a.score
      return b.score - a.score || (b.as_of || '').localeCompare(a.as_of || '')
    })
    return rows
  }, [inLane, kind, needle, sort])

  useEffect(() => {
    if (cards === null || settingsOpen) return
    const stillThere = Boolean(selected && filtered.some((card) => card.id === selected))
    if (stillThere) return
    if (narrow) {
      if (selected) setNav({ id: null })
      return
    }
    const first = filtered[0]?.id || null
    if ((selected || '') !== (first || '')) setNav({ id: first })
  }, [cards, filtered, narrow, selected, setNav, settingsOpen])

  useEffect(() => {
    if (!selected) return
    document.getElementById(`idea-${selected}`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return
      if (settingsOpen) return
      if (event.key === 'Escape') {
        if (passFor) setPassFor('')
        else if (narrow && selected) setNav({ id: null })
        return
      }
      const down = event.key === 'ArrowDown' || event.key === 'j'
      const up = event.key === 'ArrowUp' || event.key === 'k'
      if (!down && !up) return
      if ((event.key === 'j' || event.key === 'k') && (event.metaKey || event.ctrlKey || event.altKey)) return
      event.preventDefault()
      const index = filtered.findIndex((card) => card.id === selected)
      const start = index < 0 ? 0 : index
      const next = filtered[Math.min(filtered.length - 1, Math.max(0, start + (down ? 1 : -1)))]
      if (next) setNav({ id: next.id })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [filtered, narrow, passFor, selected, setNav, settingsOpen])

  const openCard = filtered.find((card) => card.id === selected) || null
  const openIndex = openCard ? filtered.findIndex((card) => card.id === openCard.id) : -1
  const laneMeta = LANES.find((row) => row.id === lane) || LANES[0]
  const chips = desk?.pass_chips?.length ? desk.pass_chips : CHIPS
  const alertCount = (cards || []).filter((card) => card.status === 'watching' && (card.alerts || []).length > 0).length
  const reading = narrow && Boolean(openCard)

  const saveSettings = async (next: Settings) => {
    setBusy('settings')
    setError('')
    try {
      const saved = await api<{ settings: Settings }>('/api/ideas/settings', {
        method: 'POST',
        body: JSON.stringify(next),
      })
      setSettings(saved.settings)
      await loadRest()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save settings')
    } finally {
      setBusy('')
    }
  }

  const runScan = async () => {
    setBusy('run')
    setError('')
    try {
      await api('/api/ideas/run', { method: 'POST' })
      window.setTimeout(() => {
        void loadRest()
        void loadCards()
        setBusy('')
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the scan')
      setBusy('')
    }
  }

  const act = async (card: Card, action: 'dig' | 'watch' | 'pass', body?: object) => {
    const nextStatus = action === 'dig' ? 'dug_in' : action === 'watch' ? 'watching' : 'passed'
    const index = filtered.findIndex((row) => row.id === card.id)
    const neighbor = filtered[index + 1]?.id || filtered[index - 1]?.id || ''
    setBusy(card.id + action)
    setError('')
    try {
      await api(`/api/ideas/cards/${encodeURIComponent(card.id)}/${action}`, {
        method: 'POST',
        body: JSON.stringify(body || {}),
      })
      setPassFor('')
      await loadCards()
      await loadRest()
      if (nextStatus !== lane) setNav({ id: neighbor || null })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the card')
    } finally {
      setBusy('')
    }
  }

  const emptyCopy = () => {
    if (!cards?.length) return { title: 'No ideas yet', sub: 'Run a scan, or wait for the 6:00 AM Pacific screen.' }
    if (needle || kind) return { title: 'Nothing in this filter', sub: 'Clear the search or choose All.' }
    if (lane === 'watching') return { title: 'Nothing on watch', sub: 'From To decide, open an idea and press Watch.' }
    if (lane === 'dug_in') return { title: 'No deep notes yet', sub: 'Dig in writes a note onto the idea and files it here.' }
    if (lane === 'passed') return { title: 'Nothing passed', sub: 'A pass asks why. That reason tunes the next score.' }
    return { title: 'Nothing waiting', sub: 'The next automatic screen is 6:00 AM Pacific on weekdays.' }
  }

  return (
    <div className={page.page}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Desk</p>
          <h1 className={page.h1}>Ideas</h1>
        </div>
        <div className={styles.actions}>
          <Button
            variant="ghost"
            onClick={() => setNav({ panel: settingsOpen ? null : 'settings' })}
          >
            {settingsOpen ? 'Back to ideas' : 'How it runs'}
          </Button>
          <Button variant="secondary" onClick={() => void runScan()} disabled={busy === 'run' || desk?.running}>
            {busy === 'run' || desk?.running ? 'Scanning…' : 'Run scan'}
          </Button>
        </div>
      </header>
      <p className={styles.lede}>
        {desk?.auto === false
          ? 'Manual. Nothing runs until you press Run scan.'
          : `Automatic. Weekday screens at ${clock(settings?.start_local)} Pacific. Trends on Sunday.`}
        {desk ? ` Grok ${money(desk.month_spend_usd)} of $${Number(desk.grok_cap_usd || 0).toFixed(0)} this month.` : ''}
      </p>
      {error && <p className={styles.error} role="alert">{error}</p>}

      {settingsOpen && settings && (
        <SettingsForm
          settings={settings}
          busy={busy === 'settings'}
          onChange={setSettings}
          onSave={() => void saveSettings(settings)}
        />
      )}

      {!settingsOpen && (
        <>
          <div className={styles.lanes} role="tablist" aria-label="Idea queues">
            {LANES.map((row) => {
              const count = counts.byLane[row.id] || 0
              const on = lane === row.id
              return (
                <button
                  key={row.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  className={on ? styles.laneOn : styles.lane}
                  onClick={() => setNav({ lane: row.id === 'new' ? null : row.id, id: null })}
                >
                  <span>{row.label}</span>
                  <strong>{count}</strong>
                  {row.id === 'watching' && alertCount > 0 && <em className={styles.alertDot}>{alertCount} alert{alertCount === 1 ? '' : 's'}</em>}
                </button>
              )
            })}
          </div>
          <p className={styles.hint}>{laneMeta.hint}</p>
          <div className={styles.toolbar}>
            <div className={styles.kinds} role="group" aria-label="Idea type">
              {KINDS.map((row) => {
                const on = kind === row.id
                const count = counts.byKind[row.id] || 0
                return (
                  <button
                    key={row.id || 'all'}
                    type="button"
                    className={on ? styles.kindOn : styles.kind}
                    aria-pressed={on}
                    onClick={() => setNav({ kind: row.id || null, id: null })}
                  >
                    {row.label}
                    <span>{count}</span>
                  </button>
                )
              })}
            </div>
            <label className={styles.search}>
              <span className={styles.sr}>Search ideas</span>
              <input
                value={query}
                placeholder="Search a name or a theme"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label className={styles.sort}>
              <span className={styles.sr}>Sort</span>
              <select
                aria-label="Sort"
                value={sort}
                onChange={(event) => setNav({ sort: event.target.value === 'date' ? 'date' : null })}
              >
                <option value="score">Highest score</option>
                <option value="date">Newest</option>
              </select>
            </label>
          </div>

          {cards === null && <Spinner label="Loading ideas…" />}
          {cards && filtered.length === 0 && <Empty {...emptyCopy()} />}
          {cards && filtered.length > 0 && (
            <div className={reading && narrow ? styles.shellReading : styles.shell}>
              <div className={styles.list} role="listbox" aria-label={laneMeta.label}>
                {filtered.map((card) => {
                  const on = card.id === selected
                  return (
                    <button
                      key={card.id}
                      id={`idea-${card.id}`}
                      type="button"
                      role="option"
                      aria-selected={on}
                      className={on ? styles.rowOn : styles.row}
                      onClick={() => setNav({ id: card.id })}
                    >
                      <span className={styles.kindMark}>{KIND_LABEL[card.type] || card.type}</span>
                      <strong className={styles.rowScore}>{Math.round(card.score)}</strong>
                      <span className={styles.rowTitle}>{card.title}</span>
                      {card.thesis && <span className={styles.rowThesis}>{card.thesis}</span>}
                      <span className={styles.rowMeta}>
                        {[card.ticker, card.as_of, (card.alerts || []).length ? `${card.alerts!.length} alert${card.alerts!.length === 1 ? '' : 's'}` : '']
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </button>
                  )
                })}
              </div>
              {openCard && (
                <article className={styles.read} aria-labelledby="idea-title">
                  {narrow && (
                    <button type="button" className={styles.back} onClick={() => setNav({ id: null })}>
                      Back to {laneMeta.label.toLowerCase()}
                    </button>
                  )}
                  <div className={styles.readTop}>
                    <span className={styles.kindMark}>{KIND_LABEL[openCard.type] || openCard.type}</span>
                    <strong className={styles.score}>{Math.round(openCard.score)}</strong>
                  </div>
                  <h2 id="idea-title">{openCard.title}</h2>
                  {openCard.question && <p className={styles.prompt}>{openCard.question}</p>}
                  {openCard.thesis && <p className={styles.thesis}>{openCard.thesis}</p>}
                  <div className={styles.decide}>
                    <Button size="sm" variant="primary" disabled={busy.startsWith(openCard.id)} onClick={() => void act(openCard, 'dig')}>
                      Dig in
                    </Button>
                    <Button size="sm" disabled={busy.startsWith(openCard.id)} onClick={() => void act(openCard, 'watch')}>
                      Watch
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setPassFor(openCard.id)
                        setChip(chips[0] || CHIPS[0])
                        setNote('')
                      }}
                    >
                      Pass
                    </Button>
                    <div className={styles.pager}>
                      <button
                        type="button"
                        disabled={openIndex <= 0}
                        onClick={() => {
                          const prev = filtered[openIndex - 1]
                          if (prev) setNav({ id: prev.id })
                        }}
                      >
                        Previous
                      </button>
                      <span>{openIndex + 1} of {filtered.length}</span>
                      <button
                        type="button"
                        disabled={openIndex < 0 || openIndex >= filtered.length - 1}
                        onClick={() => {
                          const next = filtered[openIndex + 1]
                          if (next) setNav({ id: next.id })
                        }}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                  {passFor === openCard.id && (
                    <div className={styles.pass}>
                      <p>Why pass? The reason tunes this kind of score.</p>
                      <div className={styles.chips}>
                        {chips.map((item) => (
                          <button key={item} type="button" className={chip === item ? styles.kindOn : styles.kind} onClick={() => setChip(item)}>
                            {item}
                          </button>
                        ))}
                      </div>
                      <textarea rows={2} value={note} placeholder="Optional note" onChange={(event) => setNote(event.target.value)} />
                      <Button size="sm" variant="danger" disabled={busy.startsWith(openCard.id)} onClick={() => void act(openCard, 'pass', { reason: chip, note })}>
                        Pass this idea
                      </Button>
                    </div>
                  )}
                  {(openCard.alerts || []).length > 0 && (
                    <ul className={styles.alerts}>
                      {openCard.alerts!.map((alert) => <li key={alert.text}>{alert.text}</li>)}
                    </ul>
                  )}
                  {openCard.pass_reason && <p className={styles.reason}>Passed: {openCard.pass_reason}</p>}
                  <div className={styles.cases}>
                    <div>
                      <span>Bull</span>
                      <p>{openCard.bull || '—'}</p>
                    </div>
                    <div>
                      <span>Bear</span>
                      <p>{openCard.bear || '—'}</p>
                    </div>
                    <div>
                      <span>What would make this wrong</span>
                      <p>{openCard.falsify || '—'}</p>
                    </div>
                  </div>
                  <Spark chart={openCard.chart} />
                  {(openCard.key_numbers || []).length > 0 && (
                    <dl className={styles.numbers}>
                      {openCard.key_numbers!.map((row) => (
                        <div key={row.label}>
                          <dt>{row.label}</dt>
                          <dd>{row.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {(openCard.names || []).length > 0 && (
                    <div className={styles.names}>
                      {(openCard.names || []).filter((row) => row.ticker).map((row) => (
                        <Link key={row.ticker} to={`/financials?ticker=${encodeURIComponent(row.ticker || '')}`}>
                          {row.ticker}
                          {row.revenue_pct != null ? ` ${row.revenue_pct}%` : ''}
                        </Link>
                      ))}
                    </div>
                  )}
                  {(openCard.score_breakdown || []).length > 0 && (
                    <div className={styles.breakdown}>
                      <h3>Score</h3>
                      {openCard.tuned_note && <p className={styles.tuned}>{openCard.tuned_note}</p>}
                      <ul>
                        {openCard.score_breakdown!.map((row) => {
                          const width = row.weight > 0 ? Math.max(0, Math.min(100, (row.score / row.weight) * 100)) : 0
                          return (
                            <li key={row.key}>
                              <span>{row.label}</span>
                              <span className={styles.track}><span style={{ width: `${width}%` }} /></span>
                              <span>{row.score}</span>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}
                  {(openCard.sources || []).length > 0 && (
                    <ul className={styles.sources}>
                      {openCard.sources!.map((source) => (
                        <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.label}</a></li>
                      ))}
                    </ul>
                  )}
                  {openCard.report && (
                    <details className={styles.report} open={openCard.status === 'dug_in'}>
                      <summary>Deep note</summary>
                      <pre>{openCard.report}</pre>
                    </details>
                  )}
                  <p className={styles.asOf}>{openCard.as_of}</p>
                </article>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SettingsForm({
  settings,
  busy,
  onChange,
  onSave,
}: {
  settings: Settings
  busy: boolean
  onChange: (next: Settings) => void
  onSave: () => void
}) {
  const percent = (value: number | undefined) => Math.round((value ?? 0) * 1000) / 10
  const weights = settings.weights || {}
  return (
    <form
      className={styles.settings}
      onSubmit={(event) => {
        event.preventDefault()
        onSave()
      }}
    >
      <section>
        <h2>When it runs</h2>
        <p>Same choice as the podcast page. Automatic keeps the morning screen. Manual waits for Run scan.</p>
        <div className={styles.fields}>
          <label>
            Daily run
            <select
              value={settings.auto === false ? 'manual' : 'automatic'}
              onChange={(event) => onChange({ ...settings, auto: event.target.value === 'automatic' })}
            >
              <option value="automatic">Automatic</option>
              <option value="manual">Manual</option>
            </select>
          </label>
          <label>
            Start (Pacific, 24-hour)
            <input value={settings.start_local || '06:00'} onChange={(event) => onChange({ ...settings, start_local: event.target.value })} />
          </label>
          <label>
            Grok cap, $ per month
            <input type="number" step="1" value={settings.grok_cap_usd ?? 10} onChange={(event) => onChange({ ...settings, grok_cap_usd: Number(event.target.value) })} />
          </label>
        </div>
      </section>
      <section>
        <h2>What qualifies</h2>
        <p>A sector card needs the drawdown and a lag versus the S&P. A drop card needs the five-day move and the size.</p>
        <div className={styles.fields}>
          <label>
            Sector drawdown, at least %
            <input type="number" step="1" value={percent(settings.drawdown_min ?? 0.15)} onChange={(event) => onChange({ ...settings, drawdown_min: Number(event.target.value) / 100 })} />
          </label>
          <label>
            Five-day drop, at least %
            <input type="number" step="1" value={percent(settings.drop_min ?? 0.15)} onChange={(event) => onChange({ ...settings, drop_min: Number(event.target.value) / 100 })} />
          </label>
          <label>
            Minimum market cap, $ billions
            <input type="number" step="0.1" value={((settings.min_market_cap ?? 1_000_000_000) / 1_000_000_000)} onChange={(event) => onChange({ ...settings, min_market_cap: Number(event.target.value) * 1_000_000_000 })} />
          </label>
          <label>
            Alert when a watched name moves %
            <input type="number" step="1" value={percent(settings.watch_move_pct ?? 0.08)} onChange={(event) => onChange({ ...settings, watch_move_pct: Number(event.target.value) / 100 })} />
          </label>
          <label>
            Insider window, days
            <input type="number" step="1" value={settings.insider_window_days ?? 30} onChange={(event) => onChange({ ...settings, insider_window_days: Number(event.target.value) })} />
          </label>
          <label>
            Insiders buying together
            <input type="number" step="1" value={settings.insider_cluster ?? 2} onChange={(event) => onChange({ ...settings, insider_cluster: Number(event.target.value) })} />
          </label>
          <label>
            CEO or CFO buy, at least $ thousands
            <input type="number" step="1" value={Math.round((settings.ceo_cfo_min_usd ?? 250000) / 1000)} onChange={(event) => onChange({ ...settings, ceo_cfo_min_usd: Number(event.target.value) * 1000 })} />
          </label>
          <label>
            13F add, at least %
            <input type="number" step="1" value={percent(settings.add_pct ?? 0.5)} onChange={(event) => onChange({ ...settings, add_pct: Number(event.target.value) / 100 })} />
          </label>
        </div>
      </section>
      <section>
        <h2>Universe</h2>
        <p>Weekly names are holdings, the watchlist, saved reports, and the extra tickers. One theme or fund per line.</p>
        <label className={styles.block}>
          Themes
          <textarea
            rows={4}
            value={(settings.themes || []).join('\n')}
            onChange={(event) => onChange({ ...settings, themes: event.target.value.split('\n').map((row) => row.trim()).filter(Boolean) })}
          />
        </label>
        <label className={styles.block}>
          Discovered themes
          <textarea
            rows={3}
            value={(settings.discovered_themes || []).join('\n')}
            onChange={(event) => onChange({ ...settings, discovered_themes: event.target.value.split('\n').map((row) => row.trim()).filter(Boolean) })}
          />
        </label>
        <label className={styles.block}>
          Funds (name | CIK)
          <textarea
            rows={5}
            value={(settings.funds || []).map((fund) => `${fund.name} | ${fund.cik}`).join('\n')}
            onChange={(event) => onChange({
              ...settings,
              funds: event.target.value.split('\n').map((row) => {
                const [name, cik] = row.split('|')
                return { name: (name || '').trim(), cik: (cik || '').trim() }
              }).filter((fund) => fund.name),
            })}
          />
        </label>
        <label className={styles.block}>
          Extra tickers
          <input
            value={(settings.extra_tickers || []).join(', ')}
            onChange={(event) => onChange({ ...settings, extra_tickers: event.target.value.split(/[,\s]+/).filter(Boolean) })}
          />
        </label>
      </section>
      <section>
        <h2>Score weights</h2>
        <p>A pass moves the weight for that reason, between 5 and 60, and the row still sums to 100. Dig in and Watch do not move them.</p>
        <div className={styles.weights}>
          {Object.entries(weights).map(([group, rows]) => (
            <div key={group}>
              <h3>{KIND_LABEL[group] || group}</h3>
              <ul>
                {Object.entries(rows).map(([key, value]) => (
                  <li key={key}><span>{WEIGHT_LABEL[key] || key}</span><span>{Number(value).toFixed(1)}</span></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
      <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</Button>
    </form>
  )
}
