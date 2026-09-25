import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import page from './page.module.css'
import styles from './MungerPage.module.css'

type Rule = { n: number; title: string; apply: string }
type Holding = { ticker: string; name: string }
type Cite = { ticker: string; rule: number; excerpt: string }
type Desk = {
  ok?: boolean
  day?: string
  morning?: {
    rule: number
    title: string
    ticker: string
    name: string
    excerpt: string
  }
  holdings?: Holding[]
  citations?: Cite[]
  rules?: Rule[]
}

export function MungerPage() {
  const [desk, setDesk] = useState<Desk | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [picked, setPicked] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    api<Desk>('/api/munger/desk')
      .then((d) => {
        if (!alive) return
        setDesk(d)
        setPicked(d.morning?.rule || 1)
      })
      .catch((e) => {
        if (alive) setErr(e instanceof Error ? e.message : 'Could not load')
      })
    return () => {
      alive = false
    }
  }, [])

  const rules = desk?.rules || []
  const rule = rules.find((r) => r.n === picked) || null
  const cited = useMemo(() => {
    if (!rule) return []
    return (desk?.citations || []).filter((c) => c.rule === rule.n)
  }, [desk, rule])
  const citedSet = useMemo(() => new Set(cited.map((c) => c.ticker)), [cited])
  const quiet = (desk?.holdings || []).filter((h) => !citedSet.has(h.ticker))
  const morning = desk?.morning

  return (
    <div className={page.page}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Research</p>
          <h1 className={page.h1}>Munger</h1>
        </div>
      </header>

      <section className={styles.morning}>
        <div className={styles.kicker}>This morning</div>
        {!desk && !err && <p className={styles.quiet}>Loading the book…</p>}
        {err && <p className={styles.err}>{err}</p>}
        {morning && (
          <>
            <h2>
              Rule {morning.rule} — {morning.title}
            </h2>
            <p className={styles.apply}>
              {rules.find((r) => r.n === morning.rule)?.apply}
            </p>
            {morning.ticker ? (
              <p className={styles.holding}>
                Today’s name:{' '}
                <Link to={`/report?ticker=${encodeURIComponent(morning.ticker)}&provider=grok`}>
                  {morning.ticker}
                </Link>
                {morning.name ? ` · ${morning.name}` : ''}
              </p>
            ) : (
              <p className={styles.quiet}>Add names to the watchlist to attach a holding.</p>
            )}
            {morning.excerpt ? (
              <p className={styles.excerpt}>{morning.excerpt}</p>
            ) : (
              morning.ticker && (
                <p className={styles.quiet}>
                  No saved report has cited this rule for {morning.ticker} yet.
                  The next Grok Analyze will name the rules that apply.
                </p>
              )
            )}
          </>
        )}
      </section>

      <section>
        <div className={styles.grid}>
          {rules.map((r) => (
            <button
              key={r.n}
              type="button"
              className={r.n === picked ? styles.ruleOn : styles.rule}
              onClick={() => setPicked(r.n)}
            >
              <span>{r.n}</span>
              {r.title}
            </button>
          ))}
        </div>
      </section>

      {rule && (
        <section className={styles.detail}>
          <h2>
            Rule {rule.n} — {rule.title}
          </h2>
          <p className={styles.apply}>{rule.apply}</p>
          <h3>Cited in a saved report</h3>
          {cited.length === 0 && (
            <p className={styles.quiet}>
              None of the saved Grok reports cite this rule yet.
            </p>
          )}
          <ul className={styles.cites}>
            {cited.map((c) => (
              <li key={c.ticker}>
                <Link to={`/report?ticker=${encodeURIComponent(c.ticker)}&provider=grok`}>
                  {c.ticker}
                </Link>
                <p>{c.excerpt}</p>
              </li>
            ))}
          </ul>
          <h3>In the book, not cited</h3>
          {quiet.length === 0 ? (
            <p className={styles.quiet}>Every watchlist name has a citation, or the book is empty.</p>
          ) : (
            <p className={styles.chips}>
              {quiet.map((h) => (
                <Link key={h.ticker} to={`/financials?ticker=${encodeURIComponent(h.ticker)}`}>
                  {h.ticker}
                </Link>
              ))}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
