import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, downloadAuth, type ValuationApproach } from '@/lib/api'
import { fmtPct, fmtPx, pctClass } from '@/lib/format'
import { getCachedUser } from '@/lib/auth'
import { PrintLetterhead } from '@/components/brand/PrintLetterhead'
import { SupportFab } from '@/components/support/SupportFab'
import {
  TickerStatsLine,
  WindowExportMenu,
  type WindowExportKind,
} from '@/components/desk/WindowChrome'
import styles from './ValuationBridgePage.module.css'

type StyleRule = {
  id?: string
  label?: string
  pass?: boolean
  value?: number | null
  unit?: string
  fwd_rev_growth?: number | null
  fwd_eps_growth?: number | null
}

type StylePack = {
  style?: string | null
  label?: string | null
  note?: string | null
  dcf_value?: number | null
  dcf_gap?: number | null
  fwd_rev_growth?: number | null
  fwd_eps_growth?: number | null
  cuts?: { value_cut?: number; growth_cut?: number; fair_band?: number }
  rules?: StyleRule[]
}

type DcfUser = {
  id?: string
  name?: string
  multiple?: number | null
  fcf?: number | null
  net_debt?: number | null
  shares?: number | null
  ev?: number | null
  equity?: number | null
  value?: number | null
  note?: string
  verdict?: string | null
  tone?: string | null
  gap?: number | null
  last?: number | null
}

type Pack = {
  ticker?: string
  last?: number | null
  pt?: number | null
  rating?: string | null
  style?: StylePack
  approaches?: ValuationApproach[]
  dcf?: Record<string, number | null>
  wacc?: Record<string, number | null>
  dcf_user?: DcfUser | null
  assigned_multiple?: number | null
  fcf_multiples?: number[]
  derivation?: { title?: string; headers?: string[]; rows?: string[][] } | null
  comps?: { title?: string; headers?: string[]; rows?: string[][] } | null
  capital?: Record<string, number | null>
  cuts?: { value_cut?: number; growth_cut?: number; fair_band?: number }
}

function fmtX(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  return `${Number(v).toFixed(1)}x`
}

function fmtMm(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  return `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })}m`
}

function toneClass(tone?: string | null): string {
  const t = String(tone || '').toLowerCase()
  if (t === 'under' || t === 'undervalued') return styles.under
  if (t === 'over' || t === 'overvalued') return styles.over
  if (t === 'fair') return styles.fair
  return ''
}

export function ValuationBridgePage() {
  const [params] = useSearchParams()
  const ticker = (params.get('ticker') || '').toUpperCase()
  const focus = (params.get('focus') || '').toLowerCase()
  const [pack, setPack] = useState<Pack | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [mult, setMult] = useState<string>('')
  const [shareBusy, setShareBusy] = useState(false)

  const load = useCallback(async () => {
    if (!ticker) {
      setErr('Missing ticker')
      setLoading(false)
      return
    }
    setErr(null)
    try {
      const d = await api<Pack>(`/api/reports/${encodeURIComponent(ticker)}/valuation`)
      setPack(d)
      const m = d.assigned_multiple ?? d.dcf_user?.multiple
      setMult(m != null ? String(m) : '')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load valuation')
    } finally {
      setLoading(false)
    }
  }, [ticker])

  useEffect(() => {
    document.title = ticker ? `${ticker} · valuation bridge · DGA` : 'Valuation bridge · DGA'
  }, [ticker])

  useEffect(() => {
    void load()
  }, [load])

  const saveMultiple = async (raw: string) => {
    setMult(raw)
    setSaving(true)
    try {
      const body = raw === '' ? { multiple: null } : { multiple: Number(raw) }
      await api(`/api/reports/${encodeURIComponent(ticker)}/dcf-user`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save DCF User')
    } finally {
      setSaving(false)
    }
  }

  const multiples = pack?.fcf_multiples?.length ? pack.fcf_multiples : [8, 10, 12, 15, 18, 20, 22, 25, 30]
  const style = pack?.style
  const cuts = pack?.cuts || style?.cuts
  const user = pack?.dcf_user
  const dcf = pack?.dcf || {}
  const capital = pack?.capital || {}
  const approaches = pack?.approaches || []

  const focused = useMemo(() => {
    if (!focus) return null
    return approaches.find((a) => String(a.id || '').toLowerCase() === focus)
  }, [approaches, focus])

  const onExport = async (kind: WindowExportKind) => {
    if (!ticker) return
    if (kind === 'pdf') {
      window.print()
      return
    }
    if (kind === 'excel') {
      setShareBusy(true)
      try {
        await downloadAuth(
          `/api/reports/${encodeURIComponent(ticker)}/valuation.xlsx`,
          `${ticker}_valuation.xlsx`,
        )
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return
        setErr(e instanceof Error ? e.message : 'Excel download failed')
      } finally {
        setShareBusy(false)
      }
      return
    }
    const def = getCachedUser()?.email || ''
    const to = window.prompt('Email this valuation window as a PDF to:', def)
    if (!to) return
    setShareBusy(true)
    try {
      const root = document.getElementById('dga-window-export')
      const d = await api<{ ok?: boolean; detail?: string }>(
        '/api/desk/window-email',
        {
          method: 'POST',
          body: JSON.stringify({
            to,
            ticker,
            kind: 'valuation',
            title: `${ticker} valuation bridge`,
            html: root?.innerHTML || '',
          }),
        },
      )
      if (!d.ok) throw new Error(d.detail || 'Send failed')
      window.alert('Sent to ' + to)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Email failed')
    } finally {
      setShareBusy(false)
    }
  }

  return (
    <div className={styles.page} id="dga-window-export">
      <PrintLetterhead
        doc={`${ticker || '—'} valuation bridge`}
        meta={[style?.label || '', pack?.rating || ''].filter(Boolean)}
      />
      <header className={styles.head}>
        <div className={styles.headTop}>
          <div>
            <div className={styles.kicker}>Valuation bridge · not a blended score</div>
            <h1 className={styles.h1}>
              {ticker || '—'}
              {style?.label ? <span className={styles.styleTag}>{style.label}</span> : null}
            </h1>
          </div>
          <div className={`${styles.headActions} ${styles.noPrint}`}>
            <WindowExportMenu busy={shareBusy} onPick={(k) => void onExport(k)} />
            <button
              type="button"
              className={styles.closeBtn}
              onClick={() => window.close()}
            >
              Close
            </button>
          </div>
        </div>
        <TickerStatsLine
          ticker={ticker}
          evEbitda={capital.ev_ebitda}
          pt={pack?.pt}
          rating={pack?.rating}
        />
      </header>

      {loading && <div className={styles.empty}>Loading valuation…</div>}
      {err && <div className={styles.err}>{err}</div>}

      {!loading && pack && (
        <>
          <section className={styles.card}>
            <h2>How the {style?.label || 'style'} label is assigned</h2>
            <p className={styles.note}>{style?.note || 'Not enough DCF / growth to classify.'}</p>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Threshold</th>
                  <th className="tabular">This name</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {(style?.rules || []).filter((r) => r.id !== 'tree').map((r) => (
                  <tr key={r.id || r.label}>
                    <td>{r.label}</td>
                    <td className="tabular">
                      {r.id === 'dcf_cheap' || r.id === 'dcf_rich'
                        ? `±${((cuts?.value_cut || 0.05) * 100).toFixed(0)}% DCF vs last`
                        : r.id === 'growth'
                          ? `≥${((cuts?.growth_cut || 0.15) * 100).toFixed(0)}% fwd rev or EPS`
                          : '—'}
                    </td>
                    <td className="tabular">
                      {r.value == null ? '—' : `${r.value >= 0 ? '+' : ''}${Number(r.value).toFixed(1)}%`}
                    </td>
                    <td>
                      <span className={r.pass ? styles.pass : styles.fail}>
                        {r.pass ? 'YES' : 'no'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={styles.muted}>
              Decision tree: cheap + growth = <strong>GARP</strong> · cheap only ={' '}
              <strong>VALUE</strong> · growth only = <strong>GROWTH</strong> · DCF rich ={' '}
              <strong>RICH</strong> · otherwise <strong>CORE</strong>. Fair band on each
              approach vs last is ±{((cuts?.fair_band || 0.05) * 100).toFixed(0)}%.
            </p>
          </section>

          <section className={styles.card} id="approaches">
            <h2>Each approach vs last (not blended)</h2>
            <p className={styles.muted}>
              Same layout as the Excel Valuation sheet. The 12m PT is the only weighted
              blend. Click a Market Pulse chip to land on that row.
            </p>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Approach</th>
                  <th className="tabular">$ / share</th>
                  <th className="tabular">vs last $</th>
                  <th className="tabular">Gap %</th>
                  <th>Verdict</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {approaches.map((a) => {
                  const on = focus && String(a.id || '').toLowerCase() === focus
                  const gap = a.gap == null ? null : Number(a.gap) * 100
                  const vs =
                    a.value != null && a.last
                      ? Number(a.value) - Number(a.last)
                      : null
                  return (
                    <tr
                      key={String(a.id || a.name)}
                      className={`${toneClass(a.tone)} ${on ? styles.focusRow : ''}`}
                    >
                      <td>
                        <strong>{a.name || a.id}</strong>
                      </td>
                      <td className="tabular">{fmtPx(a.value)}</td>
                      <td className={`tabular ${pctClass(vs)}`}>
                        {vs == null ? '—' : `${vs >= 0 ? '+' : ''}${fmtPx(Math.abs(vs)).replace('$', '')}`}
                      </td>
                      <td className={`tabular ${pctClass(gap)}`}>{fmtPct(gap)}</td>
                      <td>{a.verdict || '—'}</td>
                      <td className={styles.muted}>{a.note || '—'}</td>
                    </tr>
                  )
                })}
                {!approaches.length && (
                  <tr>
                    <td colSpan={6} className={styles.muted}>
                      No DCF / comps / street / scenario targets parsed from the report.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {focused && (
              <p className={styles.note}>
                Focused chip: <strong>{focused.name}</strong> · {focused.verdict} ·{' '}
                {fmtPx(focused.value)} vs last {fmtPx(focused.last)}. {focused.note}
              </p>
            )}
          </section>

          <section className={styles.split}>
            <div className={styles.card}>
              <h2>Gordon / model DCF</h2>
              <table className={styles.kv}>
                <tbody>
                  {[
                    ['DCF value / share', fmtPx(style?.dcf_value ?? dcf.implied_price)],
                    ['WACC', dcf.wacc != null ? fmtPct(Number(dcf.wacc) * 100) : '—'],
                    ['Terminal g', dcf.terminal_growth != null ? fmtPct(Number(dcf.terminal_growth) * 100) : '—'],
                    ['Beta', dcf.beta != null ? Number(dcf.beta).toFixed(2) : '—'],
                    ['Net debt ($m)', fmtMm(dcf.net_debt)],
                    ['Diluted shares (m)', dcf.shares != null ? Number(dcf.shares).toFixed(1) : '—'],
                    ['Year-0 FCF ($m)', fmtMm(dcf.year0_fcf)],
                    ['Enterprise value ($m)', fmtMm(dcf.enterprise_value)],
                    ['Equity value ($m)', fmtMm(dcf.equity_value)],
                    ['DCF vs last', fmtPct(style?.dcf_gap != null ? style.dcf_gap * 100 : null)],
                    ['Fwd rev growth', fmtPct(style?.fwd_rev_growth != null ? style.fwd_rev_growth * 100 : null)],
                    ['Fwd EPS growth', fmtPct(style?.fwd_eps_growth != null ? style.fwd_eps_growth * 100 : null)],
                  ].map(([k, v]) => (
                    <tr key={k}>
                      <th>{k}</th>
                      <td className="tabular">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.card}>
              <h2>DCF User · FCF multiple</h2>
              <p className={styles.muted}>
                Normalized last-year FCF × your multiple, minus net debt, ÷ shares.
                Assigning a multiple replaces the DCF chip on Market Pulse. Clear it
                to fall back to Gordon DCF.
              </p>
              <label className={styles.multRow}>
                <span>FCF multiple</span>
                <select
                  value={mult}
                  disabled={saving}
                  onChange={(e) => void saveMultiple(e.target.value)}
                >
                  <option value="">Not assigned (use Gordon DCF)</option>
                  {multiples.map((m) => (
                    <option key={m} value={String(m)}>
                      {m}x
                    </option>
                  ))}
                </select>
              </label>
              <table className={styles.kv}>
                <tbody>
                  {[
                    ['Normalized FCF', fmtMm(user?.fcf ?? dcf.year0_fcf)],
                    ['Multiple', user?.multiple != null ? fmtX(user.multiple) : '—'],
                    ['Implied EV', fmtMm(user?.ev)],
                    ['Net debt', fmtMm(user?.net_debt ?? dcf.net_debt)],
                    ['Equity value', fmtMm(user?.equity)],
                    ['Shares (m)', user?.shares != null ? Number(user.shares).toFixed(1) : dcf.shares != null ? Number(dcf.shares).toFixed(1) : '—'],
                    ['DCF User $/share', fmtPx(user?.value)],
                    ['Verdict vs last', user?.verdict || '—'],
                    ['Gap vs last', fmtPct(user?.gap != null ? user.gap * 100 : null)],
                  ].map(([k, v]) => (
                    <tr key={k}>
                      <th>{k}</th>
                      <td className="tabular">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.card}>
            <h2>Trading multiples (last reported FY / TTM)</h2>
            <table className={styles.kv}>
              <tbody>
                {[
                  ['P / E', capital.pe != null ? Number(capital.pe).toFixed(1) : '—'],
                  ['EV / EBITDA', capital.ev_ebitda != null ? Number(capital.ev_ebitda).toFixed(1) : '—'],
                  ['EV / Sales', capital.ev_sales != null ? Number(capital.ev_sales).toFixed(1) : '—'],
                  ['P / B', capital.pb != null ? Number(capital.pb).toFixed(1) : '—'],
                  ['FCF yield', capital.fcf_yield != null ? fmtPct(Number(capital.fcf_yield) * 100) : '—'],
                  ['Market cap ($m)', fmtMm(capital.market_cap)],
                  ['Enterprise value ($m)', fmtMm(capital.enterprise_value)],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <th>{k}</th>
                    <td className="tabular">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {pack.derivation?.rows?.length ? (
            <section className={styles.card}>
              <h2>{pack.derivation.title || 'Price target derivation'}</h2>
              <MdMiniTable headers={pack.derivation.headers} rows={pack.derivation.rows} />
            </section>
          ) : null}

          {pack.comps?.rows?.length ? (
            <section className={styles.card}>
              <h2>{pack.comps.title || 'Comps'}</h2>
              <MdMiniTable headers={pack.comps.headers} rows={pack.comps.rows} />
            </section>
          ) : null}
        </>
      )}
      <div className={styles.noPrint}>
        <SupportFab />
      </div>
    </div>
  )
}

function MdMiniTable({
  headers,
  rows,
}: {
  headers?: string[]
  rows?: string[][]
}) {
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        {!!headers?.length && (
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {(rows || []).map((row, i) => (
            <tr key={i}>
              {row.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function openValuationWindow(ticker: string, focus?: string) {
  const tk = ticker.trim().toUpperCase()
  if (!tk) return
  const q = new URLSearchParams({ ticker: tk })
  if (focus) q.set('focus', focus)
  const url = `/gp/valuation?${q.toString()}`
  const name = `dga-val-${tk}-${focus || 'style'}`
  const win = window.open(
    url,
    name,
    'width=1100,height=920,menubar=no,toolbar=no,location=no,status=no',
  )
  if (!win) window.location.href = url
}
