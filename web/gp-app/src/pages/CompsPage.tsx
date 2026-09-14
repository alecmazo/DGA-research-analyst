import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { PrintLetterhead } from '@/components/brand/PrintLetterhead'
import styles from './ValuationBridgePage.module.css'

type CompRow = {
  ticker?: string
  name?: string
  is_subject?: boolean
  price?: number | null
  pe?: number | null
  pe_nm?: boolean
  ev_ebitda?: number | null
  ps?: number | null
  fcf_yield?: number | null
  rev_yoy_pct?: number | null
  ebitda_margin_pct?: number | null
  fy?: number | string | null
}

type Pack = {
  ok?: boolean
  ticker?: string
  sector?: string | null
  industry?: string | null
  note?: string | null
  source?: string
  peers?: CompRow[]
}

function naX(v: number | null | undefined, nm = false): string {
  if (v == null || !Number.isFinite(Number(v))) return nm ? 'n/m' : 'n/a'
  return `${Number(v).toFixed(1)}x`
}

function naPct(
  v: number | null | undefined,
  opts?: { asFraction?: boolean },
): string {
  if (v == null || !Number.isFinite(Number(v))) return 'n/a'
  const n = opts?.asFraction ? Number(v) * 100 : Number(v)
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}%`
}

function naPx(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return 'n/a'
  const n = Number(v)
  return n < 100 ? `$${n.toFixed(2)}` : `$${n.toFixed(0)}`
}

export function CompsPage() {
  const [params] = useSearchParams()
  const ticker = (params.get('ticker') || '').toUpperCase()
  const [pack, setPack] = useState<Pack | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!ticker) {
      setErr('Missing ticker')
      setLoading(false)
      return
    }
    setErr(null)
    try {
      const d = await api<Pack>(
        `/api/financials/${encodeURIComponent(ticker)}/comps`,
      )
      setPack(d)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load comps')
    } finally {
      setLoading(false)
    }
  }, [ticker])

  useEffect(() => {
    document.title = ticker
      ? `${ticker} · comps · DGA`
      : 'Comparable companies · DGA'
  }, [ticker])

  useEffect(() => {
    void load()
  }, [load])

  const peers = pack?.peers || []
  const meta = [pack?.industry, pack?.sector].filter(Boolean).join(' · ')

  return (
    <div className={styles.page}>
      <PrintLetterhead
        doc={`${ticker || '—'} comparable companies`}
        meta={[meta, 'last reported FY'].filter(Boolean)}
      />
      <header className={styles.head}>
        <div>
          <div className={styles.kicker}>
            Comparable companies · last reported FY · not NTM / not (E)
          </div>
          <h1 className={styles.h1}>{ticker || '—'}</h1>
          <p className={styles.sub}>
            {meta || 'Real competitors from company_financials'}
            {pack?.source ? ` · ${pack.source}` : ''}
          </p>
        </div>
      </header>

      {loading && <div className={styles.empty}>Loading comps…</div>}
      {err && <div className={styles.err}>{err}</div>}

      {!loading && pack && (
        <section className={styles.card}>
          <h2>Last reported fiscal year + live last</h2>
          <p className={styles.muted}>
            {pack.note ||
              'Figures are last reported fiscal year from company_financials and live last price — not NTM, not (E).'}
          </p>
          <div className={styles.scrollTall}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Name</th>
                  <th className="tabular">Price</th>
                  <th className="tabular">EV/EBITDA</th>
                  <th className="tabular">P/E</th>
                  <th className="tabular">P/S</th>
                  <th className="tabular">FCF yield</th>
                  <th className="tabular">Rev growth</th>
                  <th className="tabular">EBITDA margin</th>
                  <th>FY</th>
                </tr>
              </thead>
              <tbody>
                {peers.map((p) => {
                  const tk = p.ticker || '—'
                  return (
                    <tr
                      key={tk}
                      className={p.is_subject ? styles.subject : undefined}
                    >
                      <td>
                        <strong>{tk}</strong>
                      </td>
                      <td>{p.name || tk}</td>
                      <td className="tabular">{naPx(p.price)}</td>
                      <td className="tabular">{naX(p.ev_ebitda)}</td>
                      <td className="tabular">{naX(p.pe, Boolean(p.pe_nm))}</td>
                      <td className="tabular">{naX(p.ps)}</td>
                      <td className="tabular">
                        {naPct(p.fcf_yield, { asFraction: true })}
                      </td>
                      <td className="tabular">{naPct(p.rev_yoy_pct)}</td>
                      <td className="tabular">{naPct(p.ebitda_margin_pct)}</td>
                      <td>{p.fy != null && p.fy !== '' ? String(p.fy) : 'n/a'}</td>
                    </tr>
                  )
                })}
                {!peers.length && (
                  <tr>
                    <td colSpan={10} className={styles.muted}>
                      No last-FY filings in company_financials for {ticker} or
                      its peers. Missing figures show as n/a — they are not
                      filled with estimates.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className={styles.muted}>
            n/a = missing filing or live last, not an estimate. n/m = P/E not
            meaningful (loss). Do not fill blanks with NTM or (E).
          </p>
        </section>
      )}
    </div>
  )
}

export function openCompsWindow(ticker: string) {
  const tk = ticker.trim().toUpperCase()
  if (!tk) return
  const url = `/gp/comps?ticker=${encodeURIComponent(tk)}`
  const name = `dga-comps-${tk}`
  const win = window.open(
    url,
    name,
    'width=1200,height=820,menubar=no,toolbar=no,location=no,status=no',
  )
  if (!win) window.location.href = url
}
