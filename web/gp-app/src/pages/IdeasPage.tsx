import { useCallback, useEffect, useMemo, useState } from 'react'
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

const TYPES = [
  { id: '', label: 'All' },
  { id: 'sector', label: 'Sector' },
  { id: 'weekly', label: 'Weekly drop' },
  { id: 'insider', label: 'Insider' },
  { id: 'trend', label: 'Trend' },
]
const STATUSES = [
  { id: '', label: 'Any status' },
  { id: 'new', label: 'New' },
  { id: 'watching', label: 'Watching' },
  { id: 'dug_in', label: 'Dug in' },
  { id: 'passed', label: 'Passed' },
]
const CHIPS = [
  'already known',
  'too small',
  'structural',
  'cyclical',
  'bad balance sheet',
  'not my universe',
  'weak catalyst',
]

function statusLabel(status?: string) {
  if (status === 'dug_in') return 'dug-in'
  return status || 'new'
}

function Spark({ chart }: { chart?: Chart }) {
  const series = chart?.series || []
  const width = 320
  const height = 88
  const nums = series.flatMap((row) => (row.values || []).filter((value): value is number => typeof value === 'number'))
  if (!nums.length) return null
  const lo = Math.min(...nums)
  const hi = Math.max(...nums)
  const span = hi - lo || 1
  const colors = ['var(--brand-600)', 'var(--text-secondary)', 'var(--text-primary)']
  return (
    <svg className={styles.spark} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Card chart">
      {series.map((row, index) => {
        const values = row.values || []
        const step = values.length > 1 ? width / (values.length - 1) : width
        const points = values
          .map((value, i) => {
            if (typeof value !== 'number') return null
            const y = height - 8 - ((value - lo) / span) * (height - 16)
            return `${(i * step).toFixed(1)},${y.toFixed(1)}`
          })
          .filter(Boolean)
          .join(' ')
        return <polyline key={row.name || index} fill="none" stroke={colors[index % colors.length]} strokeWidth="2" points={points} />
      })}
    </svg>
  )
}

export function IdeasPage() {
  const [view, setView] = useState<'cards' | 'watch' | 'settings'>('cards')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState('score')
  const [cards, setCards] = useState<Card[] | null>(null)
  const [watch, setWatch] = useState<Card[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [desk, setDesk] = useState<Status | null>(null)
  const [open, setOpen] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [passFor, setPassFor] = useState('')
  const [chip, setChip] = useState(CHIPS[0])
  const [note, setNote] = useState('')

  const loadCards = useCallback(async () => {
    const params = new URLSearchParams()
    if (type) params.set('type', type)
    if (status) params.set('status', status)
    params.set('sort', sort)
    const data = await api<{ cards: Card[] }>(`/api/ideas/cards?${params.toString()}`)
    setCards(data.cards || [])
  }, [type, status, sort])

  const loadRest = useCallback(async () => {
    const [statusRow, settingsRow, watchRow] = await Promise.all([
      api<Status>('/api/ideas/status'),
      api<{ settings: Settings }>('/api/ideas/settings'),
      api<{ cards: Card[] }>('/api/ideas/watchlist'),
    ])
    setDesk(statusRow)
    setSettings(settingsRow.settings)
    setWatch(watchRow.cards || [])
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

  const shown = view === 'watch' ? watch : cards
  const chips = desk?.pass_chips?.length ? desk.pass_chips : CHIPS

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

  const act = async (card: Card, kind: 'dig' | 'watch' | 'pass', body?: object) => {
    setBusy(card.id + kind)
    setError('')
    try {
      await api(`/api/ideas/cards/${encodeURIComponent(card.id)}/${kind}`, {
        method: 'POST',
        body: JSON.stringify(body || {}),
      })
      setPassFor('')
      await loadCards()
      await loadRest()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the card')
    } finally {
      setBusy('')
    }
  }

  const weightRows = useMemo(() => settings?.weights || {}, [settings])

  return (
    <div className={page.page}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Desk</p>
          <h1 className={page.h1}>Ideas</h1>
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => void runScan()} disabled={busy === 'run' || desk?.running}>
            {busy === 'run' || desk?.running ? 'Scanning…' : 'Run scan'}
          </Button>
        </div>
      </header>
      <p className={styles.lede}>
        {desk?.auto === false ? 'Manual. The 6:00 AM Pacific run stays off until you switch it back.' : 'Automatic. Weekday screens run at 6:00 AM Pacific. Trends run Sunday.'}
        {desk ? ` This month $${Number(desk.month_spend_usd || 0).toFixed(2)} of $${Number(desk.grok_cap_usd || 0).toFixed(0)} Grok.` : ''}
        {desk?.plan?.reason === 'manual' ? ' Waiting for Run scan.' : ''}
      </p>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.tabs}>
        {(['cards', 'watch', 'settings'] as const).map((id) => (
          <button key={id} type="button" className={view === id ? styles.tabOn : styles.tab} onClick={() => setView(id)}>
            {id === 'cards' ? 'Cards' : id === 'watch' ? `Watchlist (${watch.length})` : 'Settings'}
          </button>
        ))}
      </div>
      {view === 'settings' && settings && (
        <form
          className={styles.settings}
          onSubmit={(event) => {
            event.preventDefault()
            void saveSettings(settings)
          }}
        >
          <label>
            Daily run
            <select
              value={settings.auto === false ? 'manual' : 'automatic'}
              onChange={(event) => setSettings({ ...settings, auto: event.target.value === 'automatic' })}
            >
              <option value="automatic">Automatic</option>
              <option value="manual">Manual</option>
            </select>
          </label>
          <label>
            Start (Pacific)
            <input value={settings.start_local || '06:00'} onChange={(event) => setSettings({ ...settings, start_local: event.target.value })} />
          </label>
          <label>
            Sector drawdown
            <input type="number" step="0.01" value={settings.drawdown_min ?? 0.15} onChange={(event) => setSettings({ ...settings, drawdown_min: Number(event.target.value) })} />
          </label>
          <label>
            Weekly drop
            <input type="number" step="0.01" value={settings.drop_min ?? 0.15} onChange={(event) => setSettings({ ...settings, drop_min: Number(event.target.value) })} />
          </label>
          <label>
            Min market cap
            <input type="number" step="1000000" value={settings.min_market_cap ?? 1000000000} onChange={(event) => setSettings({ ...settings, min_market_cap: Number(event.target.value) })} />
          </label>
          <label>
            Grok cap ($ / month)
            <input type="number" step="1" value={settings.grok_cap_usd ?? 10} onChange={(event) => setSettings({ ...settings, grok_cap_usd: Number(event.target.value) })} />
          </label>
          <label>
            Watch move
            <input type="number" step="0.01" value={settings.watch_move_pct ?? 0.08} onChange={(event) => setSettings({ ...settings, watch_move_pct: Number(event.target.value) })} />
          </label>
          <label className={styles.wide}>
            Themes
            <textarea
              rows={4}
              value={(settings.themes || []).join('\n')}
              onChange={(event) => setSettings({ ...settings, themes: event.target.value.split('\n').map((row) => row.trim()).filter(Boolean) })}
            />
          </label>
          <label className={styles.wide}>
            Discovered themes
            <textarea
              rows={3}
              value={(settings.discovered_themes || []).join('\n')}
              onChange={(event) => setSettings({ ...settings, discovered_themes: event.target.value.split('\n').map((row) => row.trim()).filter(Boolean) })}
            />
          </label>
          <label className={styles.wide}>
            Funds (name | CIK)
            <textarea
              rows={5}
              value={(settings.funds || []).map((fund) => `${fund.name} | ${fund.cik}`).join('\n')}
              onChange={(event) => setSettings({
                ...settings,
                funds: event.target.value.split('\n').map((row) => {
                  const [name, cik] = row.split('|')
                  return { name: (name || '').trim(), cik: (cik || '').trim() }
                }).filter((fund) => fund.name),
              })}
            />
          </label>
          <label className={styles.wide}>
            Extra tickers
            <input
              value={(settings.extra_tickers || []).join(', ')}
              onChange={(event) => setSettings({ ...settings, extra_tickers: event.target.value.split(/[,\s]+/).filter(Boolean) })}
            />
          </label>
          <p className={styles.hint}>
            Weekly names are holdings, the watchlist, saved reports, and the extra tickers. The desk does not ship an S&P 1500 list. Valuation vs the 5-year average stays n/a until that history is on the name.
          </p>
          <div className={styles.weights}>
            {Object.entries(weightRows).map(([kind, weights]) => (
              <div key={kind}>
                <h2>{kind}</h2>
                <ul>
                  {Object.entries(weights).map(([key, value]) => (
                    <li key={key}>{key.replace('_', ' ')} {Number(value).toFixed(1)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <Button type="submit" variant="primary" disabled={busy === 'settings'}>Save settings</Button>
        </form>
      )}
      {view !== 'settings' && (
        <>
          {view === 'cards' && (
            <div className={styles.filters}>
              <select aria-label="Card type" value={type} onChange={(event) => setType(event.target.value)}>
                {TYPES.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
              </select>
              <select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
                {STATUSES.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
              </select>
              <select aria-label="Sort" value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="score">Score</option>
                <option value="date">Date</option>
              </select>
            </div>
          )}
          {shown === null && <Spinner label="Loading ideas…" />}
          {shown && shown.length === 0 && (
            <Empty title="No ideas yet" sub="Run a scan, or wait for the 6:00 AM Pacific pass." />
          )}
          <div className={styles.grid}>
            {(shown || []).map((card) => {
              const expanded = open === card.id
              return (
                <article key={card.id} className={expanded ? styles.cardOpen : styles.card}>
                  <button type="button" className={styles.cardHit} onClick={() => setOpen(expanded ? '' : card.id)}>
                    <div className={styles.cardTop}>
                      <span className={styles.badge}>{card.type}</span>
                      <span className={styles.badge}>{statusLabel(card.status)}</span>
                      <strong className={styles.score}>{Math.round(card.score)}</strong>
                    </div>
                    <h2>{card.title}</h2>
                    <p>{card.thesis}</p>
                    {card.tuned_note && <p className={styles.tuned}>{card.tuned_note}</p>}
                    {(card.alerts || []).length > 0 && (
                      <ul className={styles.alerts}>
                        {card.alerts!.map((alert) => <li key={alert.text}>{alert.text}</li>)}
                      </ul>
                    )}
                  </button>
                  {expanded && (
                    <div className={styles.detail}>
                      <Spark chart={card.chart} />
                      <p className={styles.question}>{card.question}</p>
                      <p><strong>Bull. </strong>{card.bull}</p>
                      <p><strong>Bear. </strong>{card.bear}</p>
                      <p><strong>What would make this wrong. </strong>{card.falsify}</p>
                      <ul className={styles.numbers}>
                        {(card.key_numbers || []).map((row) => (
                          <li key={row.label}><span>{row.label}</span><span>{row.value}</span></li>
                        ))}
                      </ul>
                      {(card.score_breakdown || []).length > 0 && (
                        <ul className={styles.numbers}>
                          {card.score_breakdown!.map((row) => (
                            <li key={row.key}><span>{row.label}</span><span>{row.score} · w {row.weight}</span></li>
                          ))}
                        </ul>
                      )}
                      {(card.names || []).length > 0 && (
                        <p className={styles.names}>
                          {(card.names || []).map((row) => row.ticker).filter(Boolean).join(', ')}
                        </p>
                      )}
                      <ul className={styles.sources}>
                        {(card.sources || []).map((source) => (
                          <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.label}</a></li>
                        ))}
                      </ul>
                      <p className={styles.asOf}>{card.as_of}</p>
                      {card.report && <pre className={styles.report}>{card.report}</pre>}
                      <div className={styles.row}>
                        <Button size="sm" variant="primary" disabled={busy.startsWith(card.id)} onClick={() => void act(card, 'dig')}>Dig in</Button>
                        <Button size="sm" disabled={busy.startsWith(card.id)} onClick={() => void act(card, 'watch')}>Watch</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setPassFor(card.id); setChip(chips[0]); setNote('') }}>Pass</Button>
                      </div>
                      {passFor === card.id && (
                        <div className={styles.pass}>
                          <div className={styles.chips}>
                            {chips.map((item) => (
                              <button key={item} type="button" className={chip === item ? styles.tabOn : styles.tab} onClick={() => setChip(item)}>{item}</button>
                            ))}
                          </div>
                          <textarea rows={2} value={note} placeholder="Optional note" onChange={(event) => setNote(event.target.value)} />
                          <Button size="sm" variant="danger" disabled={busy.startsWith(card.id)} onClick={() => void act(card, 'pass', { reason: chip, note })}>Pass this idea</Button>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
