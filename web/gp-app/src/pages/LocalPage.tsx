import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type JobStatus } from '@/lib/api'
import { pollJob } from '@/lib/jobs'
import { renderMd } from '@/lib/md'
import { Button } from '@/components/ui/Button'
import page from './page.module.css'
import styles from './LocalPage.module.css'

type Status = {
  ok?: boolean
  message?: string
  model?: string
  host?: string
  worktree?: string
  branch?: string
}

type Portfolio = {
  name?: string
  short_name?: string
  holdings?: number
  market_value?: number
}

type Answer = {
  ok?: boolean
  answer?: string
  error?: string
  steps?: { tool?: string; ticker?: string }[]
}

export function LocalPage() {
  const [status, setStatus] = useState<Status | null>(null)
  const [ticker, setTicker] = useState('AAPL')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [runErr, setRunErr] = useState<string | null>(null)
  const [doneTicker, setDoneTicker] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [ask, setAsk] = useState<Answer | null>(null)
  const [books, setBooks] = useState<Portfolio[]>([])
  const [book, setBook] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [review, setReview] = useState<Answer | null>(null)

  const loadStatus = useCallback(() => {
    void api<Status>('/api/local/status')
      .then(setStatus)
      .catch(() => setStatus({ ok: false, message: 'Local model offline – start Ollama' }))
  }, [])

  useEffect(() => {
    loadStatus()
    const id = window.setInterval(loadStatus, 20000)
    return () => window.clearInterval(id)
  }, [loadStatus])

  useEffect(() => {
    void api<{ portfolios?: Portfolio[] }>('/api/local/portfolios')
      .then((d) => {
        const rows = d.portfolios || []
        setBooks(rows)
        setBook((cur) => cur || rows[0]?.short_name || rows[0]?.name || '')
      })
      .catch(() => setBooks([]))
  }, [])

  const online = Boolean(status?.ok)

  const runResearch = async () => {
    const tk = ticker.trim().toUpperCase()
    if (!tk) return
    setRunning(true)
    setRunErr(null)
    setDoneTicker(null)
    setProgress('Queued…')
    try {
      const job = await api<JobStatus>('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({
          ticker: tk,
          generate_gamma: false,
          llm_provider: 'local',
          llm_providers: ['local'],
        }),
      })
      if (!job.job_id) throw new Error('No job id')
      const final = await pollJob(job.job_id, {
        onProgress: (_pct, label) => setProgress(label || 'Running…'),
      })
      if (final.status === 'failed') {
        setRunErr(final.error || 'Local analysis failed')
      } else if (final.status === 'done') {
        setDoneTicker(tk)
        setProgress(final.progress?.label || 'Report ready · cost: $0')
      } else {
        setRunErr(final.error || final.status || 'Stopped')
      }
    } catch (e) {
      setRunErr(e instanceof Error ? e.message : 'Could not start')
    } finally {
      setRunning(false)
    }
  }

  const askQuestion = async () => {
    const q = question.trim()
    if (!q) return
    setAsking(true)
    setAsk(null)
    try {
      const d = await api<Answer>('/api/local/ask', {
        method: 'POST',
        body: JSON.stringify({ question: q }),
      })
      setAsk(d)
    } catch (e) {
      setAsk({ ok: false, error: e instanceof Error ? e.message : 'Ask failed' })
    } finally {
      setAsking(false)
    }
  }

  const reviewBook = async () => {
    if (!book) return
    setReviewing(true)
    setReview(null)
    try {
      const d = await api<Answer>('/api/local/portfolio', {
        method: 'POST',
        body: JSON.stringify({ portfolio: book }),
      })
      setReview(d)
    } catch (e) {
      setReview({ ok: false, error: e instanceof Error ? e.message : 'Review failed' })
    } finally {
      setReviewing(false)
    }
  }

  return (
    <div className={page.page}>
      <header className={styles.head}>
        <div>
          <p className={page.kicker}>This Mac only</p>
          <h1 className={page.h1}>Local</h1>
        </div>
        <div className={styles.status} title={status?.message || ''}>
          <span className={`${styles.dot} ${online ? styles.up : styles.down}`} />
          <div>
            <strong>{online ? 'Ollama running' : 'Ollama offline'}</strong>
            <span>
              {status?.model || 'gpt-oss-20b-finance'}
              {status?.branch ? ` · ${status.branch}` : ''}
            </span>
          </div>
        </div>
      </header>
      <p className={styles.lead}>
        Research, questions, and portfolio notes stay on the local finance model.
        Figures come from the financial store. Recent developments come from Yahoo Finance.
        This page does not call Grok, Claude, or DeepSeek.
      </p>
      {status?.worktree && (
        <p className={styles.tree}>
          Worktree <code>{status.worktree}</code>
          {status.host ? ` · ${status.host}` : ''}
        </p>
      )}
      {!online && status?.message && <p className={styles.warn}>{status.message}</p>}

      <section className={styles.card}>
        <h2>Research</h2>
        <p>Run the same investment-case analysis as the desk, on the local model only.</p>
        <div className={styles.row}>
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            aria-label="Ticker"
            disabled={running}
          />
          <Button variant="primary" disabled={running || !online} onClick={() => void runResearch()}>
            {running ? 'Running…' : 'Run local analysis'}
          </Button>
        </div>
        {progress && <p className={styles.meta}>{progress}</p>}
        {runErr && <p className={styles.warn}>{runErr}</p>}
        {doneTicker && (
          <p className={styles.meta}>
            Saved.{' '}
            <Link to={`/report?ticker=${encodeURIComponent(doneTicker)}&provider=local`}>
              Open the {doneTicker} local report
            </Link>
            {' · cost: $0'}
          </p>
        )}
      </section>

      <section className={styles.card}>
        <h2>Ask</h2>
        <p>A local agent. It can read the financial store, Yahoo headlines, quotes, and portfolios.</p>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={4}
          placeholder="What changed recently at AAPL, and do the stored financials support it?"
          disabled={asking}
        />
        <div className={styles.row}>
          <Button variant="primary" disabled={asking || !online || !question.trim()} onClick={() => void askQuestion()}>
            {asking ? 'Thinking…' : 'Ask'}
          </Button>
        </div>
        {ask?.error && <p className={styles.warn}>{ask.error}</p>}
        {ask?.steps && ask.steps.length > 0 && (
          <p className={styles.meta}>
            Looked up {ask.steps.map((s) => s.tool).filter(Boolean).join(', ')}
          </p>
        )}
        {ask?.answer && (
          <div className={styles.answer} dangerouslySetInnerHTML={{ __html: renderMd(ask.answer) }} />
        )}
      </section>

      <section className={styles.card}>
        <h2>Portfolio</h2>
        <p>Recommendations from the account’s holdings, the financial store, and Yahoo updates.</p>
        <div className={styles.row}>
          <select
            value={book}
            onChange={(e) => setBook(e.target.value)}
            aria-label="Portfolio"
            disabled={reviewing}
          >
            {books.length === 0 && <option value="">No portfolios loaded</option>}
            {books.map((b) => {
              const label = b.short_name || b.name || 'Account'
              return (
                <option key={label} value={label}>
                  {label}
                  {b.market_value != null ? ` · $${Math.round(b.market_value).toLocaleString()}` : ''}
                </option>
              )
            })}
          </select>
          <Button variant="primary" disabled={reviewing || !online || !book} onClick={() => void reviewBook()}>
            {reviewing ? 'Reviewing…' : 'Recommend'}
          </Button>
        </div>
        {review?.error && <p className={styles.warn}>{review.error}</p>}
        {review?.answer && (
          <div className={styles.answer} dangerouslySetInnerHTML={{ __html: renderMd(review.answer) }} />
        )}
      </section>
    </div>
  )
}
