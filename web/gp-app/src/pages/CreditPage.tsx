import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import styles from './CreditPage.module.css'

type IssuerRow = { cik: string; legal_name?: string; ticker?: string; status?: string }

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

type Quote = Instrument & {
  ytm?: string | null
  g_spread_bp?: string | null
  treasury?: string | null
  verdict?: string
  verdict_reason?: string
  ytw_note?: string
  note?: string
  market_pd?: Record<string, string>
  buy_spread_bp?: string | null
  assumption?: string
}

type MetricBase = { id: string; label: string; ebitda?: string | null; gross?: string | null; net?: string | null; reason?: string }

type View = {
  identity?: { name?: string; cik?: string; ticker?: string; ticker_next?: string; name_change?: string; close?: string }
  badge?: string
  badge_reason?: string
  totals?: Record<string, string>
  instruments?: Instrument[]
  maturity_wall?: { year: string; priority: string; amount: string }[]
  metrics?: { debt?: string | null; cash?: string | null; interest?: string | null; interest_coverage?: string | null; bases?: MetricBase[] }
  covenants?: { key: string; label: string; status: string; summary: string; source?: { url?: string; name?: string } }[]
  quotes?: Quote[]
  oas?: Record<string, string>
  oas_note?: string
  waterfall?: { ev?: string; distributable?: string; rows?: { id?: string; name?: string; claim?: string; paid?: string; recovery?: string | null; assumption?: string }[] }
  pd?: { rating?: string; fundamental?: string; market?: string }
  scenarios?: { id: string; name: string; rationale: string; default_year?: number | null; warning_indicators?: string[]; projection?: { year: number; leverage?: string; fcf?: string; default?: string }[] }[]
  flags?: { flag_type?: string; details?: string }[]
  finra_url?: string
  xbrl_maturities?: unknown
}

const GROUPS = [
  ['new_1l', 'New first-lien notes'],
  ['tlb', 'Term loans'],
  ['new_2l', 'New second-lien notes'],
  ['exchange', 'WBD notes delivered for exchange'],
] as const

function money(value?: string | null, currency = 'USD') {
  if (value == null || value === '') return '—'
  const prefix = currency === 'EUR' ? '€' : '$'
  return `${prefix}${value}m`
}

export function CreditPage() {
  const { issuer } = useParams()
  const [issuers, setIssuers] = useState<IssuerRow[]>([])
  const [view, setView] = useState<View | null>(null)
  const [err, setErr] = useState('')
  const [priceId, setPriceId] = useState('psky_1l_2031')
  const [price, setPrice] = useState('')
  const [multiple, setMultiple] = useState('6')
  const [busy, setBusy] = useState(false)

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
    setErr('')
    api<View>(`/api/credit/issuers/${issuer}`)
      .then(setView)
      .catch((error) => setErr(error instanceof Error ? error.message : 'Could not load this issuer'))
  }, [issuer])

  const fixedNotes = useMemo(
    () => (view?.quotes || []).filter((row) => row.coupon_type === 'fixed' && row.currency === 'USD'),
    [view],
  )

  const compute = async () => {
    if (!issuer) return
    setBusy(true)
    setErr('')
    try {
      const body: { prices?: Record<string, { clean_price: string }>; ev_multiple?: string } = {
        ev_multiple: multiple,
      }
      if (price.trim()) body.prices = { [priceId]: { clean_price: price.trim() } }
      const next = await api<View>(`/api/credit/issuers/${issuer}/compute`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      setView(next)
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Could not recompute')
    } finally {
      setBusy(false)
    }
  }

  if (!issuer) {
    return (
      <Panel title="Credit">
        <p className={styles.lead}>
          Bond credit, downside first. Issuers are keyed by SEC CIK, not by ticker.
        </p>
        {err && <p className={styles.err}>{err}</p>}
        <ul className={styles.list}>
          {issuers.map((row) => (
            <li key={row.cik}>
              <Link to={`/credit/${row.cik}`}>{row.legal_name || row.cik}</Link>
              <span className={styles.meta}>{row.ticker || 'ticker not set'} · CIK {row.cik}</span>
            </li>
          ))}
          {!issuers.length && !err && <li>No issuers yet.</li>}
        </ul>
      </Panel>
    )
  }

  const id = view?.identity
  const wall = view?.maturity_wall || []
  const maxBar = wall.reduce((max, row) => Math.max(max, Number(row.amount) || 0), 0) || 1
  const years = [...new Set(wall.map((row) => row.year))]

  return (
    <>
      <p className={styles.back}><Link to="/credit">All issuers</Link></p>
      <Panel title={id?.name || 'Credit'}>
        <p className={styles.lead}>
          CIK {id?.cik || issuer}. Ticker {id?.ticker || '—'}, then {id?.ticker_next || '—'} ({id?.name_change || 'name change not found'}).
          Expected close {id?.close || 'not found'}.
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
                    <td>{row.maturity || 'not public'}</td>
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
          FY2025 pro forma interest {money(view?.metrics?.interest)}. Coverage on the no-synergy EBITDA {view?.metrics?.interest_coverage || '—'}.
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
          There is no free per-bond price. Look the bond up on <a href={view?.finra_url} target="_blank" rel="noreferrer">FINRA</a> and enter the clean price.
          {view?.oas_note}
        </p>
        <p className={styles.meta}>
          OAS buckets, 2026-10-01: IG {view?.oas?.ig || '—'} · BBB {view?.oas?.bbb || '—'} · BB {view?.oas?.bb || '—'} · B {view?.oas?.b || '—'} · HY {view?.oas?.hy || '—'} · CCC {view?.oas?.ccc || '—'}.
        </p>
        <div className={styles.toolbar}>
          <label>
            Bond
            <select aria-label="Bond to price" value={priceId} onChange={(event) => setPriceId(event.target.value)}>
              {fixedNotes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          <label>
            Clean price
            <input aria-label="Clean price" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="100" />
          </label>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void compute()}>
            {busy ? 'Computing…' : 'Recompute'}
          </Button>
        </div>
        <table className={styles.table}>
          <thead>
            <tr><th>Bond</th><th>YTM</th><th>G-spread</th><th>Treasury</th><th>Call</th><th>Verdict</th></tr>
          </thead>
          <tbody>
            {fixedNotes.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.ytm ? `${row.ytm}%` : 'not found'}</td>
                <td>{row.g_spread_bp ? `${row.g_spread_bp} bp` : '—'}</td>
                <td>{row.treasury ? `${row.treasury}%` : '—'}</td>
                <td>{row.ytw_note || 'not public'}</td>
                <td>{row.verdict || '—'}{row.verdict_reason ? ` — ${row.verdict_reason}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
          <Button size="sm" disabled={busy} onClick={() => void compute()}>Update waterfall</Button>
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
          {fixedNotes.filter((row) => row.verdict).map((row) => (
            <li key={row.id}>
              <strong>{row.name}: {row.verdict}</strong>
              <span className={styles.meta}>
                {row.verdict_reason}
                {row.buy_spread_bp ? ` Buy needs about ${row.buy_spread_bp} bp.` : ''}
                {row.market_pd?.['1'] ? ` One-year market PD ${row.market_pd['1']}.` : ''}
              </span>
            </li>
          ))}
          {!fixedNotes.some((row) => row.verdict) && <li>Enter a clean price to see a verdict.</li>}
        </ul>
      </Panel>
    </>
  )
}
