import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { openReportWindow } from '@/pages/ReportPage'
import {
  ensureOllama,
  isModelRefusal,
  LOCAL_RETRY_SYSTEM,
  ollamaChat,
  refusalDiagnosis,
  ollamaStatus,
  parseToolCall,
} from '@/lib/localOllama'
import { renderMd } from '@/lib/md'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { SavedReports } from '@/components/desk/SavedReports'
import page from './page.module.css'
import styles from './LocalPage.module.css'

type Status = {
  ok?: boolean
  message?: string
  model?: string
  host?: string
  worktree?: string
  branch?: string
  agent_system?: string
  portfolio_system?: string
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
  const [reportsKey, setReportsKey] = useState(0)
  const [launching, setLaunching] = useState(false)
  const [deskMsg, setDeskMsg] = useState<string | null>(null)
  const [libraryCount, setLibraryCount] = useState<string | null>(null)
  const navigate = useNavigate()

  const loadStatus = useCallback(() => {
    void Promise.all([
      ollamaStatus(),
      api<Status>('/api/local/status').catch(() => ({}) as Status),
    ]).then(([ollama, meta]) => {
      setStatus({
        ...meta,
        ok: ollama.ok,
        message: ollama.ok ? meta.message : ollama.message,
        model: ollama.model || meta.model,
      })
    })
  }, [])

  useEffect(() => {
    loadStatus()
    const id = window.setInterval(loadStatus, 20000)
    return () => window.clearInterval(id)
  }, [loadStatus])

  useEffect(() => {
    void api<{
      interviews?: { count?: number }[]
      calls?: { count?: number }[]
    }>('/api/transcripts/library')
      .then((data) => {
        const interviews = (data.interviews || []).reduce((n, f) => n + (f.count || 0), 0)
        const calls = (data.calls || []).reduce((n, f) => n + (f.count || 0), 0)
        setLibraryCount(`${interviews} interviews · ${calls} earnings calls`)
      })
      .catch(() => setLibraryCount(null))
  }, [])

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

  const startOllama = async () => {
    setLaunching(true)
    setDeskMsg(null)
    try {
      const result = await ensureOllama()
      setDeskMsg(result.message)
      loadStatus()
      window.setTimeout(loadStatus, 1500)
    } finally {
      setLaunching(false)
    }
  }

  const runResearch = async () => {
    const tk = ticker.trim().toUpperCase()
    if (!tk) return
    setRunning(true)
    setRunErr(null)
    setDoneTicker(null)
    setProgress('Gathering the filing and Yahoo news…')
    try {
      const prep = await api<{ ok?: boolean; system?: string; user?: string; detail?: string }>(
        '/api/local/research-prompt',
        { method: 'POST', body: JSON.stringify({ ticker: tk }) },
      )
      if (!prep.system || !prep.user) throw new Error(prep.detail || 'Could not build the prompt')
      setProgress('Writing on this Mac…')
      let chat = await ollamaChat({
        system: prep.system,
        user: prep.user,
      })
      if (isModelRefusal(chat.text)) {
        setProgress('Writing the note again…')
        chat = await ollamaChat({
          system: LOCAL_RETRY_SYSTEM,
          user: prep.user,
        })
      }
      if (!chat.text || isModelRefusal(chat.text)) {
        throw new Error(
          `The local model refused this run. The previous note was kept. ${refusalDiagnosis(chat)}`,
        )
      }
      setProgress('Saving…')
      await api('/api/local/save', {
        method: 'POST',
        body: JSON.stringify({
          ticker: tk,
          text: chat.text,
          tokens_per_sec: chat.tokensPerSec,
          latency_ms: chat.latencyMs,
        }),
      })
      const speed = chat.tokensPerSec != null ? ` · ${chat.tokensPerSec.toFixed(1)} tok/s` : ''
      setDoneTicker(tk)
      setReportsKey((n) => n + 1)
      setProgress(`Saved · ${Math.round(chat.latencyMs / 1000)}s${speed} · cost: $0`)
      openReportWindow(tk, 'local')
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
    const system = status?.agent_system || 'You are the local finance analyst. Do not invent figures.'
    let transcript = q
    const steps: { tool?: string; ticker?: string }[] = []
    try {
      let answer = ''
      for (let i = 0; i < 4; i++) {
        const chat = await ollamaChat({ system, user: transcript, maxTokens: 3500 })
        const call = parseToolCall(chat.text)
        if (!call) {
          answer = chat.text
          break
        }
        const tool = await api<{ result?: string }>('/api/local/tool', {
          method: 'POST',
          body: JSON.stringify(call),
        })
        steps.push({ tool: call.tool, ticker: call.ticker || call.portfolio })
        transcript += `\n\nTOOL ${call.tool} RESULT:\n${tool.result || ''}\n\nUse this. Ask for another tool as JSON, or write the markdown answer.`
      }
      if (!answer) {
        const chat = await ollamaChat({
          system,
          user: `${transcript}\n\nWrite the markdown answer now. Do not call a tool.`,
          maxTokens: 3500,
        })
        answer = chat.text
      }
      setAsk({ ok: true, answer, steps })
    } catch (e) {
      setAsk({ ok: false, error: e instanceof Error ? e.message : 'Ask failed', steps })
    } finally {
      setAsking(false)
    }
  }

  const reviewBook = async () => {
    if (!book) return
    setReviewing(true)
    setReview(null)
    try {
      const prep = await api<{ ok?: boolean; system?: string; user?: string; error?: string }>(
        '/api/local/portfolio-prompt',
        { method: 'POST', body: JSON.stringify({ portfolio: book }) },
      )
      if (!prep.ok || !prep.user) throw new Error(prep.error || 'Could not load the portfolio')
      const chat = await ollamaChat({
        system: prep.system || status?.portfolio_system || 'You are the local portfolio analyst.',
        user: prep.user,
        maxTokens: 4000,
      })
      setReview({ ok: true, answer: chat.text })
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
        {online ? (
          <div className={styles.status} title={status?.message || ''}>
            <span className={`${styles.dot} ${styles.up}`} />
            <div>
              <strong>Ollama running</strong>
              <span>
                {status?.model || 'gpt-oss-20b-finance'}
                {status?.branch ? ` · ${status.branch}` : ''}
              </span>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={`${styles.status} ${styles.statusBtn}`}
            title="Start Ollama on this Mac, or restart it if it is stuck"
            disabled={launching}
            onClick={() => void startOllama()}
          >
            <span className={`${styles.dot} ${styles.down}`} />
            <div>
              <strong>{launching ? 'Starting Ollama…' : 'Ollama offline'}</strong>
              <span>{launching ? 'Launching on this Mac' : 'Click to start or restart'}</span>
            </div>
          </button>
        )}
      </header>
      <p className={styles.lead}>
        Research runs on this Mac and opens in the same report window as the desk.
        Filings come from the financial store. Recent developments come from Yahoo Finance.
        The Word file is saved to Dropbox under Apps / DGA Research / Local_Reports.
      </p>
      {!online && (deskMsg || status?.message) && (
        <p className={styles.warn}>{deskMsg || status?.message}</p>
      )}

      <div className={styles.grid}>
      <div className={styles.stack}>
      <section className={styles.card}>
        <h2>Podcast Intel</h2>
        <p>
          Interviews and earnings calls already in the research library, in one
          folder tree. Shows are labeled by channel. Calls are labeled by ticker,
          quarter, and source.
        </p>
        {libraryCount && <p className={styles.meta}>{libraryCount}</p>}
        <div className={styles.row}>
          <Button variant="primary" onClick={() => navigate('/transcripts')}>
            Open transcript library
          </Button>
        </div>
      </section>

      <section className={styles.card}>
        <h2>Research</h2>
        <p>Same investment-case note as Analyze. It opens in a new window when it is saved.</p>
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
            {doneTicker} saved · cost: $0
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
      <Panel title="Saved Local Reports" badge="local" flush className={styles.saved}>
        <SavedReports
          provider="local"
          embed
          refreshKey={reportsKey}
          onAnalyze={(tk) => setTicker(tk)}
        />
      </Panel>
      </div>
    </div>
  )
}
