import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import styles from './CreditPage.module.css'

type IssuerRow = {
  cik: string
  legal_name?: string
  ticker?: string
  sector?: string
  status?: string
  coupon_high?: string
  floor_pct?: string
  book?: string
}

type Draft = {
  id: string
  name: string
  coupon: string
  maturity: string
  amount: string
  clean_price: string
}

type Desk = Record<string, { bonds: Draft[]; quotes: Quote[] }>

type Instrument = {
  id: string
  name?: string
  group?: string
  currency?: string
  amount?: string
  coupon?: string
  coupon_type?: string
  index?: string
  maturity?: string
  lien?: string
  lien_notes?: string
  source_url?: string
  source_name?: string
  in_math?: boolean
  maturity_notes?: string
}

type FilingLine = {
  id: string
  name?: string
  amount?: string
  currency?: string
  coupon_note?: string
  maturity_note?: string
  as_of?: string
  source_url?: string
  source_name?: string
  note?: string
  in_total?: boolean
}

type ScheduleRow = { label: string; amount?: string; currency?: string; end?: string }

type InterestRow = { label: string; amount?: string; currency?: string; as_of?: string }

type Quote = Instrument & {
  ytm?: string | null
  g_spread_bp?: string | null
  treasury?: string | null
  verdict?: string
  verdict_reason?: string
  ytw_note?: string
  note?: string
  on_book?: boolean
  off_book?: boolean
  clean_price?: string | null
  amount?: string
  market_pd?: Record<string, string>
  buy_spread_bp?: string | null
  assumption?: string
}

type MetricBase = { id: string; label: string; ebitda?: string | null; gross?: string | null; net?: string | null; reason?: string }

type View = {
  mode?: string
  floor_pct?: string
  sec_url?: string
  curve_note?: string
  recovery_note?: string
  identity?: { name?: string; cik?: string; ticker?: string; ticker_next?: string; name_change?: string; close?: string; sector?: string }
  badge?: string
  badge_reason?: string
  totals?: Record<string, string>
  instruments?: Instrument[]
  maturity_wall?: { year: string; priority: string; amount: string }[]
  metrics?: {
    debt?: string | null
    debt_note?: string
    cash?: string | null
    cash_label?: string
    interest?: string | InterestRow[] | null
    interest_coverage?: string | null
    bases?: MetricBase[]
  }
  lines?: FilingLine[]
  schedule?: ScheduleRow[]
  schedule_complete?: boolean
  filing_note?: string
  source?: { url?: string; name?: string; form?: string; filed?: string; as_of?: string }
  as_of?: string
  waterfall?: { ev?: string; distributable?: string; reason?: string; rows?: { id?: string; name?: string; claim?: string; paid?: string; recovery?: string | null; assumption?: string }[] }
  covenants?: { key: string; label: string; status: string; summary: string; source?: { url?: string; name?: string } }[]
  quotes?: Quote[]
  oas?: Record<string, string>
  oas_note?: string

  pd?: { rating?: string; fundamental?: string; market?: string }
  scenarios?: { id: string; name: string; rationale: string; default_year?: number | null; warning_indicators?: string[]; projection?: { year: number; leverage?: string; fcf?: string; default?: string }[] }[]
  flags?: { flag_type?: string; details?: string }[]
  finra_url?: string
  xbrl_maturities?: unknown
  settlement?: string
  curve_as_of?: string
  oas_as_of?: string
}

const GROUPS = [
  ['new_1l', 'New first-lien notes'],
  ['tlb', 'Term loans'],
  ['new_2l', 'New second-lien notes'],
  ['exchange', 'WBD notes delivered for exchange'],
] as const

const DESK_KEY = 'dga.credit.hy.v1'
const STRUCTURE_KEY = 'dga.credit.structure.v1'

type StructureBook = Record<string, { prices: Record<string, string>; quotes: Quote[] }>

function money(value?: string | null, currency = 'USD') {
  if (value == null || value === '') return '—'
  const negative = value.trim().startsWith('-')
  const abs = negative ? value.trim().slice(1) : value.trim()
  const prefix = currency === 'EUR' ? '€' : '$'
  return `${negative ? '−' : ''}${prefix}${abs}m`
}

function loadDesk(): Desk {
  try {
    const raw = localStorage.getItem(DESK_KEY)
    const parsed = raw ? JSON.parse(raw) as Desk : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveDesk(desk: Desk) {
  try {
    localStorage.setItem(DESK_KEY, JSON.stringify(desk))
  } catch {
    /* the book still works for this page view */
  }
}

function loadStructure(): StructureBook {
  try {
    const raw = localStorage.getItem(STRUCTURE_KEY)
    const parsed = raw ? JSON.parse(raw) as StructureBook : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStructure(cik: string, prices: Record<string, string>, quotes: Quote[]) {
  try {
    const book = loadStructure()
    book[cik] = { prices, quotes }
    localStorage.setItem(STRUCTURE_KEY, JSON.stringify(book))
  } catch {
    /* the typed price still shows for this visit */
  }
}

function maturityLabel(row: Instrument) {
  const value = row.maturity || ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  if (/^\d{4}$/.test(value)) return `${value} (month and day not in the filing)`
  return value || 'not found'
}

function BlotterTable({ drafts, quotes, onDrafts }: {
  drafts: Draft[]
  quotes: Quote[]
  onDrafts: (next: Draft[]) => void
}) {
  const edit = (index: number, field: keyof Draft, value: string) => {
    onDrafts(drafts.map((item, i) => i === index ? { ...item, [field]: value } : item))
  }
  return (
    <div className={styles.scroll}>
      <table className={styles.book}>
        <thead>
          <tr>
            <th>Bond</th>
            <th>Coupon</th>
            <th>Maturity</th>
            <th>Amount $m</th>
            <th>Clean</th>
            <th>YTM</th>
            <th>G-spread</th>
            <th>Call</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {drafts.map((bond, index) => {
            const quote = quotes.find((row) => (
              row.id === bond.id
              && sameNumber(row.coupon, bond.coupon)
              && sameNumber(row.clean_price, bond.clean_price)
              && (row.maturity || '') === bond.maturity
            ))
            return (
              <tr key={bond.id} className={quote?.off_book ? styles.off : undefined}>
                <td><input aria-label="Bond name" value={bond.name} placeholder="Senior notes" onChange={(event) => edit(index, 'name', event.target.value)} /></td>
                <td><input aria-label="Coupon" value={bond.coupon} placeholder="8.00" onChange={(event) => edit(index, 'coupon', event.target.value)} /></td>
                <td><input aria-label="Maturity" value={bond.maturity} placeholder="2031-10-15" onChange={(event) => edit(index, 'maturity', event.target.value)} /></td>
                <td><input aria-label="Amount" value={bond.amount} onChange={(event) => edit(index, 'amount', event.target.value)} /></td>
                <td><input aria-label="Clean price" value={bond.clean_price} placeholder="100" onChange={(event) => edit(index, 'clean_price', event.target.value)} /></td>
                <td className={styles.num}>{quote?.ytm ? `${quote.ytm}%` : '—'}</td>
                <td className={styles.num}>{quote?.g_spread_bp ? `${quote.g_spread_bp} bp` : '—'}</td>
                <td>{quote?.verdict || '—'}{quote?.note ? <span className={styles.meta}> {quote.note}</span> : null}</td>
                <td><button type="button" className={styles.drop} onClick={() => onDrafts(drafts.filter((item) => item.id !== bond.id))}>Remove</button></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function blankBond(): Draft {
  return {
    id: `b-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    coupon: '',
    maturity: '',
    amount: '',
    clean_price: '',
  }
}

function bestNumber(values: Array<string | null | undefined>) {
  let best: number | null = null
  for (const value of values) {
    if (value == null || value === '') continue
    const number = Number(value)
    if (!Number.isFinite(number)) continue
    if (best == null || number > best) best = number
  }
  return best
}

function sameNumber(left?: string | null, right?: string | null) {
  if (!left && !right) return true
  const a = Number(left)
  const b = Number(right)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return (left || '') === (right || '')
  return Math.abs(a - b) < 0.0001
}

function staysOnBook(row: IssuerRow, desk: Desk, floor: number) {
  const saved = desk[row.cik]
  const ytm = bestNumber((saved?.quotes || []).map((quote) => quote.ytm))
  const coupon = bestNumber([
    row.coupon_high,
    ...(saved?.bonds || []).map((bond) => bond.coupon),
    ...(saved?.quotes || []).map((quote) => quote.coupon),
  ])
  if (ytm != null) return ytm >= floor
  if (coupon != null) return coupon >= floor
  return true
}

export function CreditPage() {
  const { issuer } = useParams()
  const [issuers, setIssuers] = useState<IssuerRow[]>([])
  const [view, setView] = useState<View | null>(null)
  const [err, setErr] = useState('')
  const [typed, setTyped] = useState<Record<string, string>>({})
  const [localQuotes, setLocalQuotes] = useState<Record<string, Quote>>({})
  const edited = useRef(false)
  const hasLocal = useRef(false)
  const localQuotesRef = useRef<Record<string, Quote>>({})
  const [multiple, setMultiple] = useState('6')
  const [busy, setBusy] = useState(false)
  const [desk, setDesk] = useState<Desk>({})
  const [query, setQuery] = useState('')
  const [sector, setSector] = useState('All')
  const [floor, setFloor] = useState('6')
  const [pricedOnly, setPricedOnly] = useState(false)
  const [drafts, setDrafts] = useState<Draft[]>([blankBond()])

  useEffect(() => {
    setDesk(loadDesk())
  }, [])

  useEffect(() => {
    api<{ issuers: IssuerRow[] }>('/api/credit/issuers')
      .then((data) => setIssuers(data.issuers || []))
      .catch((error) => setErr(error instanceof Error ? error.message : 'Could not load issuers'))
  }, [])

  useEffect(() => {
    if (!issuer) {
      setView(null)
      return
    }
    const saved = loadDesk()[issuer]
    setDrafts(saved?.bonds?.length ? saved.bonds : [blankBond()])
    const structure = loadStructure()[issuer]
    hasLocal.current = !!structure
    edited.current = false
    setTyped(structure?.prices || {})
    const remembered: Record<string, Quote> = {}
    for (const row of structure?.quotes || []) {
      if (row?.id) remembered[row.id] = row
    }
    localQuotesRef.current = remembered
    setLocalQuotes(remembered)
    setErr('')
    setView(null)
    let cancelled = false
    api<View>(`/api/credit/issuers/${issuer}`)
      .then((next) => {
        if (cancelled) return
        if (next.mode !== 'screen' && !edited.current) {
          const seeded: Record<string, string> = { ...(hasLocal.current ? (loadStructure()[issuer]?.prices || {}) : {}) }
          let filled = false
          for (const row of next.quotes || []) {
            if (row.id && row.clean_price && !(row.id in seeded)) {
              seeded[row.id] = String(row.clean_price)
              filled = true
            }
          }
          if (filled) {
            hasLocal.current = true
            setTyped(seeded)
            writeStructure(issuer, seeded, next.quotes || [])
          }
        }
        setView(next)
      })
      .catch((error) => {
        if (!cancelled) setErr(error instanceof Error ? error.message : 'Could not load this issuer')
      })
    return () => {
      cancelled = true
    }
  }, [issuer])

  const fixedNotes = useMemo(
    () => (view?.quotes || []).filter((row) => row.coupon_type === 'fixed' && row.currency === 'USD'),
    [view],
  )

  const setClean = (id: string, value: string) => {
    edited.current = true
    hasLocal.current = true
    setTyped((prev) => {
      const next = { ...prev, [id]: value }
      if (issuer) writeStructure(issuer, next, Object.values(localQuotesRef.current))
      return next
    })
  }

  const shownQuote = (row: Quote) => {
    const clean = (typed[row.id] || '').trim()
    if (!clean) return undefined
    if (sameNumber(row.clean_price, clean)) return row
    const local = localQuotes[row.id]
    if (local && sameNumber(local.clean_price, clean)) return local
    return undefined
  }

  const compute = async (includePrices: boolean) => {
    if (!issuer) return
    setBusy(true)
    setErr('')
    try {
      const body: { prices?: Record<string, { clean_price: string }>; ev_multiple?: string } = {
        ev_multiple: multiple,
      }
      if (includePrices) {
        const prices: Record<string, { clean_price: string }> = {}
        for (const row of fixedNotes) {
          if (Object.prototype.hasOwnProperty.call(typed, row.id)) {
            prices[row.id] = { clean_price: (typed[row.id] || '').trim() }
          }
        }
        body.prices = prices
      }
      const next = await api<View>(`/api/credit/issuers/${issuer}/compute`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      setView(next)
      if (includePrices && next.mode !== 'screen') {
        const quotes = next.quotes || []
        const remembered: Record<string, Quote> = {}
        for (const row of quotes) {
          if (row.id) remembered[row.id] = row
        }
        localQuotesRef.current = remembered
        setLocalQuotes(remembered)
        hasLocal.current = true
        writeStructure(issuer, typed, quotes)
      }
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Could not recompute')
    } finally {
      setBusy(false)
    }
  }

  const floorNumber = Number(floor) || 6
  const sectors = [...new Set(issuers.map((row) => row.sector).filter(Boolean))].sort() as string[]
  const shown = issuers.filter((row) => {
    const hay = `${row.legal_name || ''} ${row.ticker || ''} ${row.cik}`.toLowerCase()
    if (query.trim() && !hay.includes(query.trim().toLowerCase())) return false
    if (sector !== 'All' && row.sector !== sector) return false
    if (!staysOnBook(row, desk, floorNumber)) return false
    if (pricedOnly && bestNumber((desk[row.cik]?.quotes || []).map((quote) => quote.ytm)) == null) return false
    return true
  })

  if (!issuer) {
    return (
      <div className={styles.desk}>
        <header className={styles.mast}>
          <p className={styles.kicker}>DGA Capital · Credit</p>
          <h1>High yield book</h1>
          <p className={styles.mastCopy}>
            {issuers.length} issuers to underwrite. Open a name for the annual-report balances and maturity schedule.
            Paramount opens the named notes. The screen drops a bond once its yield is under {floorNumber}%.
            A 3–4% coupon is not this desk. Prices are what you type. Nothing here is a live TRACE print.
          </p>
        </header>
        {err && <p className={styles.err}>{err}</p>}
        <div className={styles.filters}>
          <input aria-label="Search issuers" placeholder="Issuer, ticker, or CIK" value={query} onChange={(event) => setQuery(event.target.value)} />
          <label>
            Sector
            <select aria-label="Sector" value={sector} onChange={(event) => setSector(event.target.value)}>
              <option>All</option>
              {sectors.map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <label>
            Min yield
            <input aria-label="Minimum yield" value={floor} onChange={(event) => setFloor(event.target.value)} />
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={pricedOnly} onChange={(event) => setPricedOnly(event.target.checked)} />
            Priced only
          </label>
          <span className={styles.meta}>{shown.length} on the screen</span>
        </div>
        <div className={styles.scroll}>
          <table className={styles.book}>
            <thead>
              <tr>
                <th>Issuer</th>
                <th>Ticker</th>
                <th>Sector</th>
                <th>Coupon</th>
                <th>YTM</th>
                <th>Call</th>
                <th>Work</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const saved = desk[row.cik]
                const ytm = bestNumber((saved?.quotes || []).map((quote) => quote.ytm))
                const coupon = bestNumber([row.coupon_high, ...(saved?.quotes || []).map((quote) => quote.coupon)])
                const call = (saved?.quotes || []).find((quote) => quote.verdict)?.verdict
                return (
                  <tr key={row.cik}>
                    <td><Link to={`/credit/${row.cik}`}>{row.legal_name || row.cik}</Link></td>
                    <td className={styles.num}>{row.ticker || '—'}</td>
                    <td>{row.sector || '—'}</td>
                    <td className={styles.num}>{coupon == null ? '—' : `${coupon.toFixed(2)}%`}</td>
                    <td className={styles.num}>{ytm == null ? '—' : `${ytm.toFixed(2)}%`}</td>
                    <td>{call || '—'}</td>
                    <td>{row.status === 'structure' ? 'Structure' : row.status === 'filing' ? 'Filing' : 'Screen'}</td>
                  </tr>
                )
              })}
              {!shown.length && (
                <tr><td colSpan={7}>{issuers.length ? 'Nothing clears this screen.' : 'No issuers yet.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  if (!view) {
    return (
      <div className={styles.desk}>
        <p className={styles.back}><Link to="/credit">High yield book</Link></p>
        {err ? <p className={styles.err}>{err}</p> : <p className={styles.meta}>Opening the issuer.</p>}
      </div>
    )
  }

  const priceBlotter = async () => {
    if (!issuer) return
    setBusy(true)
    setErr('')
    try {
      const next = await api<View>(`/api/credit/issuers/${issuer}/compute`, {
        method: 'POST',
        body: JSON.stringify({
          bonds: drafts.map((bond) => ({
            id: bond.id,
            name: bond.name,
            coupon: bond.coupon,
            maturity: bond.maturity,
            amount: bond.amount,
            clean_price: bond.clean_price,
          })),
        }),
      })
      setView(next)
      const stored = { ...loadDesk(), [issuer]: { bonds: drafts, quotes: next.quotes || [] } }
      saveDesk(stored)
      setDesk(stored)
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Could not price the blotter')
    } finally {
      setBusy(false)
    }
  }

  if (view.mode === 'filing' || view.mode === 'screen') {
    const idn = view.identity
    const lines = view.lines || []
    const schedule = view.schedule || []
    const interestRows = Array.isArray(view.metrics?.interest) ? view.metrics.interest : []
    const blotter = (
      <>
        <div className={styles.toolbar}>
          <Button size="sm" onClick={() => setDrafts((rows) => [...rows, blankBond()])}>Add bond</Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void priceBlotter()}>
            {busy ? 'Pricing…' : 'Price'}
          </Button>
        </div>
        <BlotterTable drafts={drafts} quotes={view.quotes || []} onDrafts={setDrafts} />
      </>
    )
    if (view.mode === 'screen') {
      return (
        <div className={styles.desk}>
          <p className={styles.back}><Link to="/credit">High yield book</Link></p>
          <header className={styles.mast}>
            <p className={styles.kicker}>DGA Capital · High yield credit · {idn?.sector || 'Sector not set'}</p>
            <h1>{idn?.name || 'Issuer'}</h1>
            <p className={styles.mastCopy}>
              {idn?.ticker || '—'} · CIK {idn?.cik || issuer}. {view.badge}. {view.badge_reason}
            </p>
          </header>
          {err && <p className={styles.err}>{err}</p>}
          <section className={styles.sheet}>
            <div className={styles.sheetHead}><h2>Bond blotter</h2></div>
            <p className={styles.meta}>
              Look the bond up on <a href={view.finra_url} target="_blank" rel="noreferrer">FINRA</a> and type the clean price.
              Settlement {view.settlement || 'the next business day'}.
              Filings are on <a href={view.sec_url} target="_blank" rel="noreferrer">EDGAR</a>.
              {view.curve_note} {view.recovery_note}
            </p>
            {blotter}
          </section>
        </div>
      )
    }
    const priced = (view.quotes || []).filter((row) => row.verdict)
    return (
      <>
        <p className={styles.back}><Link to="/credit">High yield book</Link></p>
        <Panel title={idn?.name || 'Credit'}>
          <p className={styles.lead}>
            Filing details are loaded. CIK {idn?.cik || issuer}. Ticker {idn?.ticker || '—'}.
            {view.as_of ? ` Balance sheet ${view.as_of}.` : ''}
            {view.source?.name ? ` Source ${view.source.name}.` : ''}
            A named coupon, a rating, and a TRACE price are not in this file.
          </p>
          <p className={styles.meta}>{view.badge}. {view.badge_reason}</p>
          {view.filing_note && <p className={styles.meta}>{view.filing_note}</p>}
          {view.source?.url && <p className={styles.meta}><a href={view.source.url} target="_blank" rel="noreferrer">{view.source.name || 'Annual report'}</a></p>}
          {err && <p className={styles.err}>{err}</p>}
          {(view.flags || []).map((flag) => (
            <p key={flag.details} className={styles.warn}>{flag.details}</p>
          ))}
        </Panel>

        <Panel title="Capital structure">
          <p className={styles.meta}>
            Amounts are millions. Borrowings {money(view.metrics?.debt)}.
            {view.metrics?.debt_note ? ` ${view.metrics.debt_note}` : ''}
            A line with no coupon says not found. Leases are not added to borrowings.
          </p>
          <table className={styles.table}>
            <thead>
              <tr><th>Instrument</th><th>Amount</th><th>Coupon</th><th>Maturity</th><th>As of</th><th>Source</th></tr>
            </thead>
            <tbody>
              {lines.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}{row.note ? <span className={styles.meta}> {row.note}</span> : null}</td>
                  <td>{money(row.amount, row.currency)}</td>
                  <td>{row.coupon_note || 'not found'}</td>
                  <td>{row.maturity_note || 'not found'}</td>
                  <td>{row.as_of || '—'}</td>
                  <td>{row.source_url ? <a href={row.source_url} target="_blank" rel="noreferrer">{row.source_name || 'Source'}</a> : 'not found'}</td>
                </tr>
              ))}
              {!lines.length && <tr><td colSpan={6}>No debt balance was tagged on the annual report.</td></tr>}
            </tbody>
          </table>
          <h3 className={styles.sub}>Contractual maturity schedule</h3>
          <p className={styles.meta}>
            Principal repayments from the annual report. A bucket is not a named bond and it has no coupon.
            {!view.schedule_complete && schedule.length ? ' A missing bucket is left out. It is not zero.' : ''}
          </p>
          <table className={styles.table}>
            <thead><tr><th>Bucket</th><th>Principal</th></tr></thead>
            <tbody>
              {schedule.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{money(row.amount, row.currency)}</td>
                </tr>
              ))}
              {!schedule.length && <tr><td colSpan={2}>The annual report did not tag a contractual maturity schedule.</td></tr>}
            </tbody>
          </table>
        </Panel>

        <Panel title="Credit metrics">
          <p className={styles.meta}>
            Borrowings {money(view.metrics?.debt)}. {view.metrics?.cash_label || 'Cash'} {money(view.metrics?.cash)}.
            Interest coverage is not found. The companyfacts file does not give one EBITDA figure.
          </p>
          <ul className={styles.list}>
            {interestRows.map((row) => (
              <li key={row.label}>
                <strong>{row.label}</strong>
                <span>{money(row.amount, row.currency)}</span>
                <span className={styles.meta}>{row.as_of || view.as_of}</span>
              </li>
            ))}
            {!interestRows.length && <li>Interest expense was not tagged for this balance-sheet date.</li>}
          </ul>
        </Panel>

        <Panel title="Pricing versus the market">
          <p className={styles.meta}>
            Companyfacts does not name each note. Look a bond up on <a href={view.finra_url} target="_blank" rel="noreferrer">FINRA</a> and type the coupon, the maturity day, and the clean price.
            Settlement {view.settlement || 'the next business day'}. {view.curve_note} {view.recovery_note}
          </p>
          <p className={styles.meta}>
            OAS buckets{view.oas_as_of ? `, ${view.oas_as_of}` : ''}: IG {view.oas?.ig || '—'} · BBB {view.oas?.bbb || '—'} · BB {view.oas?.bb || '—'} · B {view.oas?.b || '—'} · HY {view.oas?.hy || '—'} · CCC {view.oas?.ccc || '—'}.
          </p>
          {blotter}
        </Panel>

        <Panel title="Documents and covenants">
          <ul className={styles.list}>
            {(view.covenants || []).map((row) => (
              <li key={row.key}>
                <strong>{row.label}</strong>
                <span className={row.status === 'found' ? styles.ok : styles.warn}>{row.status.replace('_', ' ')}</span>
                <span className={styles.meta}>{row.summary}</span>
                {row.source?.url && <a href={row.source.url} target="_blank" rel="noreferrer">{row.source.name || 'Source'}</a>}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Recovery waterfall">
          <p className={styles.meta}>{view.waterfall?.reason || 'No recovery is calculated.'}</p>
        </Panel>

        <Panel title="Probability of default, three ways">
          <ul className={styles.list}>
            <li><strong>Rating-implied</strong><span className={styles.meta}>{view.pd?.rating}</span></li>
            <li><strong>Market-implied</strong><span className={styles.meta}>{view.pd?.market}</span></li>
            <li><strong>Fundamental</strong><span className={styles.meta}>{view.pd?.fundamental}</span></li>
          </ul>
        </Panel>

        <Panel title="How this defaults">
          {(view.scenarios || []).length
            ? (view.scenarios || []).map((row) => (
              <div key={row.id} className={styles.scenario}>
                <strong>{row.name}</strong>
                <span className={styles.meta}>{row.rationale}</span>
              </div>
            ))
            : <p className={styles.meta}>Default paths are not loaded. The Paramount paths belong to that deal.</p>}
        </Panel>

        <Panel title="Per-bond verdict">
          <ul className={styles.list}>
            {priced.map((row) => (
              <li key={row.id}>
                <strong>{row.name}: {row.verdict}</strong>
                <span className={styles.meta}>{row.verdict_reason}</span>
              </li>
            ))}
            {!priced.length && <li>Type a coupon, a maturity day, and a clean price to see a verdict.</li>}
          </ul>
        </Panel>
      </>
    )
  }

  const id = view?.identity
  const wall = view?.maturity_wall || []
  const maxBar = wall.reduce((max, row) => Math.max(max, Number(row.amount) || 0), 0) || 1
  const years = [...new Set(wall.map((row) => row.year))]

  return (
    <>
      <p className={styles.back}><Link to="/credit">High yield book</Link></p>
      <Panel title={id?.name || 'Credit'}>
        <p className={styles.lead}>
          Structure is loaded. CIK {id?.cik || issuer}. Ticker {id?.ticker || '—'}, then {id?.ticker_next || '—'} ({id?.name_change || 'name change not found'}).
          Expected close {id?.close || 'not found'}. Coupons under 6% stay off the book screen.
        </p>
        <p className={styles.meta}>{view?.badge}. {view?.badge_reason}</p>
        {err && <p className={styles.err}>{err}</p>}
        {(view?.flags || []).map((flag) => (
          <p key={flag.flag_type} className={styles.warn}>{flag.details}</p>
        ))}
      </Panel>

      <Panel title="Capital structure">
        <p className={styles.meta}>
          New 1L notes {money(view?.totals?.new_1l_usd)}. New 2L notes {money(view?.totals?.new_2l_usd)} plus €{view?.totals?.new_2l_eur || '—'}m.
          Term loan B {money(view?.totals?.tlb_usd)} plus €{view?.totals?.tlb_eur || '—'}m.
          Amounts are millions. Low and unconfirmed figures are left out.
        </p>
        {GROUPS.map(([group, label]) => (
          <div key={group}>
            <h3 className={styles.sub}>{label}</h3>
            <table className={styles.table}>
              <thead>
                <tr><th>Instrument</th><th>Amount</th><th>Coupon</th><th>Maturity</th><th>Lien</th><th>Source</th></tr>
              </thead>
              <tbody>
                {(view?.instruments || []).filter((row) => row.group === group).map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{money(row.amount, row.currency)}</td>
                    <td>{row.coupon_type === 'floating' ? `${row.index || 'index'} + ${row.coupon}%` : `${row.coupon}%`}</td>
                    <td>{maturityLabel(row)}</td>
                    <td>{row.lien === 'assumption' ? 'assumed 1L' : row.lien}{row.lien_notes ? ` — ${row.lien_notes}` : ''}</td>
                    <td>{row.source_url ? <a href={row.source_url} target="_blank" rel="noreferrer">{row.source_name || 'Source'}</a> : 'not found'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        <h3 className={styles.sub}>Maturity wall</h3>
        <p className={styles.meta}>Stacked by priority. The standalone 10-K schedule is a pre-deal snapshot and is not this wall. {typeof view?.xbrl_maturities === 'object' ? '10-K years are on the fixture.' : ''}</p>
        <div className={styles.wall}>
          {years.map((year) => {
            const slices = wall.filter((row) => row.year === year)
            return (
              <div key={year} className={styles.year}>
                <div className={styles.bar}>
                  {slices.map((slice) => (
                    <div
                      key={`${year}-${slice.priority}`}
                      className={slice.priority === '1' ? styles.senior : styles.junior}
                      style={{ height: `${Math.max(4, (Number(slice.amount) / maxBar) * 120)}px` }}
                      title={`${year} priority ${slice.priority}: ${slice.amount}`}
                    />
                  ))}
                </div>
                <span>{year}</span>
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel title="Credit metrics">
        <p className={styles.meta}>
          Pro forma debt {money(view?.metrics?.debt)}. Cash {money(view?.metrics?.cash)}.
          FY2025 pro forma interest {money(typeof view?.metrics?.interest === 'string' ? view.metrics.interest : null)}. Coverage on the no-synergy EBITDA {view?.metrics?.interest_coverage || '—'}.
        </p>
        <div className={styles.bases}>
          {(view?.metrics?.bases || []).map((base) => (
            <div key={base.id}>
              <strong>{base.label}</strong>
              <span>EBITDA {base.ebitda ? money(base.ebitda) : '—'}</span>
              <span>Gross {base.gross ?? '—'}x</span>
              <span>Net {base.net ?? '—'}x</span>
              <span className={styles.meta}>{base.reason}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Pricing versus the market">
        <p className={styles.meta}>
          There is no free per-bond price. Look the bond up on <a href={view?.finra_url} target="_blank" rel="noreferrer">FINRA</a> and type the clean price. It stays on this card.
          Settlement for the yield is {view?.settlement || 'the next business day'}, the next business day.
          {view?.curve_note || view?.oas_note}
        </p>
        <p className={styles.meta}>
          OAS buckets{view?.oas_as_of ? `, ${view.oas_as_of}` : ''}: IG {view?.oas?.ig || '—'} · BBB {view?.oas?.bbb || '—'} · BB {view?.oas?.bb || '—'} · B {view?.oas?.b || '—'} · HY {view?.oas?.hy || '—'} · CCC {view?.oas?.ccc || '—'}.
        </p>
        <div className={styles.toolbar}>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void compute(true)}>
            {busy ? 'Computing…' : 'Recompute'}
          </Button>
        </div>
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr><th>Bond</th><th>Clean</th><th>YTM</th><th>G-spread</th><th>Treasury</th><th>Call</th><th>Verdict</th></tr>
            </thead>
            <tbody>
              {fixedNotes.map((row) => {
                const shown = shownQuote(row)
                return (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>
                      <input
                        aria-label={`Clean price ${row.name || row.id}`}
                        className={styles.price}
                        value={typed[row.id] || ''}
                        placeholder="100"
                        onChange={(event) => setClean(row.id, event.target.value)}
                      />
                    </td>
                    <td>{shown?.ytm ? `${shown.ytm}%` : (shown?.note || 'not found')}</td>
                    <td>{shown?.g_spread_bp ? `${shown.g_spread_bp} bp` : '—'}</td>
                    <td>{shown?.treasury ? `${shown.treasury}%` : '—'}</td>
                    <td>{shown?.ytw_note || row.ytw_note || 'not public'}</td>
                    <td>{shown?.verdict || '—'}{shown?.verdict_reason ? ` — ${shown.verdict_reason}` : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Documents and covenants">
        <ul className={styles.list}>
          {(view?.covenants || []).map((row) => (
            <li key={row.key}>
              <strong>{row.label}</strong>
              <span className={row.status === 'found' ? styles.ok : styles.warn}>{row.status.replace('_', ' ')}</span>
              <span className={styles.meta}>{row.summary}</span>
              {row.source?.url && <a href={row.source.url} target="_blank" rel="noreferrer">{row.source.name || 'Source'}</a>}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Recovery waterfall">
        <div className={styles.toolbar}>
          <label>
            EV multiple
            <input aria-label="EV multiple" value={multiple} onChange={(event) => setMultiple(event.target.value)} />
          </label>
          <Button size="sm" disabled={busy} onClick={() => void compute(false)}>Update waterfall</Button>
        </div>
        <p className={styles.meta}>
          Stressed EBITDA starts at the 2026 target without synergies. Admin claims default to 5%. The term loan lien is an assumption.
          Enterprise value {view?.waterfall?.ev || '—'}.
        </p>
        <table className={styles.table}>
          <thead><tr><th>Class</th><th>Claim</th><th>Paid</th><th>Recovery</th></tr></thead>
          <tbody>
            {(view?.waterfall?.rows || []).map((row) => (
              <tr key={row.id}>
                <td>{row.name}{row.assumption ? ` — ${row.assumption}` : ''}</td>
                <td>{money(row.claim)}</td>
                <td>{money(row.paid)}</td>
                <td>{row.recovery == null ? '—' : `${(Number(row.recovery) * 100).toFixed(1)}¢`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Probability of default, three ways">
        <ul className={styles.list}>
          <li><strong>Rating-implied</strong><span className={styles.meta}>{view?.pd?.rating}</span></li>
          <li><strong>Market-implied</strong><span className={styles.meta}>{view?.pd?.market}</span></li>
          <li><strong>Fundamental</strong><span className={styles.meta}>{view?.pd?.fundamental}</span></li>
        </ul>
        <p className={styles.meta}>These are not blended. Agency default tables and the Damodaran coverage table are not loaded.</p>
      </Panel>

      <Panel title="How this defaults">
        {(view?.scenarios || []).map((row) => (
          <div key={row.id} className={styles.scenario}>
            <strong>{row.name}</strong>
            <span className={styles.meta}>{row.rationale}</span>
            <span>{row.default_year ? `This path stops in ${row.default_year}.` : 'This path does not stop inside 2026–2035.'}</span>
            <span className={styles.meta}>Watch: {(row.warning_indicators || []).join('; ')}</span>
          </div>
        ))}
      </Panel>

      <Panel title="Per-bond verdict">
        <p className={styles.meta}>
          The call is Buy, Watch, or Avoid from the code. A model is not allowed to set it.
          With only the market method, expected loss is about the spread itself, so the extra cushion is usually not met.
          Deep dive stays off until the model call is attested. It will not pick Grok or Claude for you.
        </p>
        <ul className={styles.list}>
          {fixedNotes.filter((row) => shownQuote(row)?.verdict).map((row) => {
            const shown = shownQuote(row)
            return (
              <li key={row.id}>
                <strong>{row.name}: {shown?.verdict}</strong>
                <span className={styles.meta}>
                  {shown?.verdict_reason}
                  {shown?.buy_spread_bp ? ` Buy needs about ${shown.buy_spread_bp} bp.` : ''}
                  {shown?.market_pd?.['1'] ? ` One-year market PD ${shown.market_pd['1']}.` : ''}
                </span>
              </li>
            )
          })}
          {!fixedNotes.some((row) => shownQuote(row)?.verdict) && <li>Enter a clean price to see a verdict.</li>}
        </ul>
      </Panel>
    </>
  )
}
