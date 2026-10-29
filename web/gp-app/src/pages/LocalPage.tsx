import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type SavedReport } from '@/lib/api'
import { openPortfolioReport, openReportWindow } from '@/lib/openWindows'
import {
  ensureOllama,
  isModelRefusal,
  LOCAL_MODEL,
  LOCAL_PICK_KEYS,
  mungerSectionReady,
  ollamaChat,
  refusalDiagnosis,
  ollamaStatus,
  parseToolCall,
  shortModelLabel,
} from '@/lib/localOllama'
import { LocalBook } from '@/components/local/LocalBook'
import { LocalCompare } from '@/components/local/LocalCompare'
import { LocalDcf } from '@/components/local/LocalDcf'
import { LocalModelPick, useLocalModelChoice } from '@/components/local/LocalModelPick'
import {
  clearDeskMemory,
  DEFAULT_RESUME_HOURS,
  deskTickers,
  pendingQueue,
  readDeskMemory,
  readResumeHours,
  rememberDeskSave,
  RESUME_HOUR_CHOICES,
  resumeWindowLabel,
  resumeWindowMs,
  writeResumeHours,
} from '@/lib/deskResume'
import { relativeTime } from '@/lib/format'
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

type PortfolioReview = {
  id: string
  portfolio?: string
  created_at?: string
}

export function LocalPage() {
  const [status, setStatus] = useState<Status | null>(null)
  const [ticker, setTicker] = useState('AAPL')
  const [running, setRunning] = useState(false)
  const [batching, setBatching] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [resumeHours, setResumeHours] = useState(DEFAULT_RESUME_HOURS)
  const [runOpen, setRunOpen] = useState(false)
  const stopDesk = useRef(false)
  const [progress, setProgress] = useState('')
  const [runErr, setRunErr] = useState<string | null>(null)
  const [doneTicker, setDoneTicker] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [ask, setAsk] = useState<Answer | null>(null)
  const [asked, setAsked] = useState('')
  const [draft, setDraft] = useState('')
  const [askStatus, setAskStatus] = useState('')
  const [books, setBooks] = useState<Portfolio[]>([])
  const [book, setBook] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [reviewErr, setReviewErr] = useState<string | null>(null)
  const [reviewNote, setReviewNote] = useState('')
  const [reviews, setReviews] = useState<PortfolioReview[]>([])
  const [reviewsErr, setReviewsErr] = useState<string | null>(null)
  const [reportsKey, setReportsKey] = useState(0)
  const [launching, setLaunching] = useState(false)
  const [deskMsg, setDeskMsg] = useState<string | null>(null)
  const [libraryCount, setLibraryCount] = useState<string | null>(null)
  const researchModels = useLocalModelChoice(LOCAL_PICK_KEYS.research, true)
  const askModel = useLocalModelChoice(LOCAL_PICK_KEYS.ask)
  const bookModel = useLocalModelChoice(LOCAL_PICK_KEYS.portfolio)
  const navigate = useNavigate()

  useEffect(() => {
    setResumeHours(readResumeHours(window.localStorage))
  }, [])

  const chooseResumeHours = (hours: number) => {
    setResumeHours(hours)
    writeResumeHours(hours, window.localStorage)
  }

  const loadStatus = useCallback(() => {
    void Promise.all([
      ollamaStatus(),
      api<Status>('/api/local/status').catch(() => ({}) as Status),
    ]).then(([ollama, meta]) => {
      setStatus({
        ...meta,
        ok: ollama.ok,
        message: ollama.ok ? meta.message : ollama.message,
        model: meta.model,
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

  const loadReviews = useCallback(() => {
    void api<{ reports?: PortfolioReview[] }>('/api/local/portfolio-reports')
      .then((d) => {
        setReviews(d.reports || [])
        setReviewsErr(null)
      })
      .catch((e) => {
        setReviews([])
        setReviewsErr(e instanceof Error ? e.message : 'Could not load saved recommendations')
      })
  }, [])

  useEffect(() => {
    loadReviews()
  }, [loadReviews])

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

  const researchModelList = () =>
    researchModels.picked.length ? researchModels.picked : [LOCAL_MODEL]

  const writeLocalNote = async (tk: string, model: string, where: string) => {
    const name = shortModelLabel(model)
    const place = where ? `${where} · ${name}` : name
    const health = await ollamaStatus(model)
    if (!health.ok) throw new Error(health.message)
    setProgress(`${place} · gathering the filing and Yahoo news…`)
    const prep = await api<{
      ok?: boolean
      system?: string
      user?: string
      munger_system?: string
      detail?: string
    }>(
      '/api/local/research-prompt',
      { method: 'POST', body: JSON.stringify({ ticker: tk, model }) },
    )
    if (!prep.system || !prep.user || !prep.munger_system) {
      throw new Error(prep.detail || 'Could not build the prompt')
    }
    setProgress(`${place} · writing the note on this Mac…`)
    let chat = await ollamaChat({
      system: prep.system,
      user: prep.user,
      model,
    })
    if (isModelRefusal(chat.text)) {
      setProgress(`${place} · writing the note again…`)
      chat = await ollamaChat({
        system: prep.system,
        user: prep.user,
        model,
      })
    }
    if (!chat.text || isModelRefusal(chat.text)) {
      throw new Error(
        `${name} refused this run. Earlier notes were kept. ${refusalDiagnosis(chat)}`,
      )
    }
    setProgress(`${place} · writing the Munger section…`)
    const mungerUser =
      `The equity note is below. Write only Section 8.5 from it. Do not repeat the note.\n\n${chat.text}`
    let munger = await ollamaChat({
      system: prep.munger_system,
      user: mungerUser,
      model,
    })
    if (!mungerSectionReady(munger.text)) {
      setProgress(`${place} · writing the Munger section again…`)
      munger = await ollamaChat({
        system: prep.munger_system,
        user: mungerUser,
        model,
      })
    }
    if (!mungerSectionReady(munger.text)) {
      throw new Error(
        `${name} wrote the note, but not the Munger section, so that model was not saved. ${refusalDiagnosis(munger)}`,
      )
    }
    const full = `${chat.text.trim()}\n\n${munger.text.trim()}\n`
    setProgress(`${place} · saving…`)
    const latency = chat.latencyMs + munger.latencyMs
    const speedSrc = munger.tokensPerSec ?? chat.tokensPerSec
    await api('/api/local/save', {
      method: 'POST',
      body: JSON.stringify({
        ticker: tk,
        text: full,
        model,
        tokens_per_sec: speedSrc,
        latency_ms: latency,
      }),
    })
    setReportsKey((n) => n + 1)
    const speed = speedSrc != null ? ` · ${speedSrc.toFixed(1)} tok/s` : ''
    setProgress(`${place} saved · ${Math.round(latency / 1000)}s${speed} · cost: $0`)
  }

  const runResearch = async () => {
    const tk = ticker.trim().toUpperCase()
    if (!tk || running) return
    const models = researchModelList()
    setRunning(true)
    setRunErr(null)
    setDoneTicker(null)
    let saved = 0
    let lastSaved = models[0]
    try {
      for (const model of models) {
        await writeLocalNote(tk, model, '')
        saved += 1
        lastSaved = model
      }
      setDoneTicker(tk)
      openReportWindow(tk, 'local', lastSaved)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not start'
      setRunErr(saved ? `${msg} ${saved} model${saved === 1 ? '' : 's'} already saved.` : msg)
      if (saved) openReportWindow(tk, 'local', lastSaved)
    } finally {
      setRunning(false)
    }
  }

  const requestStop = () => {
    stopDesk.current = true
    setStopping(true)
  }

  const runTickerQueue = async (queue: { tk: string; models: string[] }[]) => {
    let saved = 0
    const failed: string[] = []
    for (let i = 0; i < queue.length; i++) {
      if (stopDesk.current) break
      const step = queue[i]
      const where = `${i + 1} of ${queue.length} · ${step.tk}`
      for (const model of step.models) {
        try {
          await writeLocalNote(step.tk, model, where)
          rememberDeskSave(step.tk, model, Date.now(), window.localStorage)
          saved += 1
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'This company stopped'
          failed.push(`${step.tk} · ${shortModelLabel(model)}: ${msg}`)
        }
      }
    }
    const notes = `${saved} note${saved === 1 ? '' : 's'} saved`
    setProgress(stopDesk.current ? `Stopped. ${notes}.` : `Finished ${queue.length} companies. ${notes}.`)
    if (failed.length) {
      setRunErr(`${failed.length} did not save. ${failed.slice(0, 3).join(' ')}`)
    }
  }

  const runDeskReports = async () => {
    if (running) return
    const models = researchModelList()
    setRunning(true)
    setBatching(false)
    setStopping(false)
    stopDesk.current = false
    setRunErr(null)
    setDoneTicker(null)
    setProgress('Loading the desk saved reports…')
    try {
      const list = await api<SavedReport[]>('/api/reports')
      const tickers = deskTickers(list)
      if (!tickers.length) {
        setRunErr('The desk has no saved reports.')
        setProgress('')
        return
      }
      const modelNames = models.map((model) => shortModelLabel(model)).join(', ')
      const go = window.confirm(
        `Run ${modelNames} on ${tickers.length} desk companies, one company at a time? Each company finishes before the next starts.`,
      )
      if (!go) {
        setProgress('')
        return
      }
      clearDeskMemory(window.localStorage)
      setBatching(true)
      await runTickerQueue(tickers.map((tk) => ({ tk, models })))
    } catch (e) {
      setRunErr(e instanceof Error ? e.message : 'Could not load the desk reports')
    } finally {
      setRunning(false)
      setBatching(false)
      setStopping(false)
      stopDesk.current = false
    }
  }

  const resumeDeskReports = async () => {
    if (running) return
    const models = researchModelList()
    setRunning(true)
    setBatching(false)
    setStopping(false)
    stopDesk.current = false
    setRunErr(null)
    setDoneTicker(null)
    setProgress('Checking which desk companies already have a local note…')
    try {
      const [desk, local] = await Promise.all([
        api<SavedReport[]>('/api/reports'),
        api<SavedReport[]>('/api/local/reports'),
      ])
      const tickers = deskTickers(desk)
      if (!tickers.length) {
        setRunErr('The desk has no saved reports.')
        setProgress('')
        return
      }
      const now = Date.now()
      const windowLabel = resumeWindowLabel(resumeHours)
      const { queue, skipped } = pendingQueue(
        tickers,
        models,
        Array.isArray(local) ? local : [],
        readDeskMemory(now, window.localStorage),
        now,
        resumeWindowMs(resumeHours),
      )
      if (!queue.length) {
        setProgress(`Every desk company already has a local note from the last ${windowLabel}.`)
        return
      }
      const modelNames = models.map((model) => shortModelLabel(model)).join(', ')
      const noteWord = skipped === 1 ? 'note' : 'notes'
      const go = window.confirm(
        `Resume ${modelNames} on ${queue.length} desk companies. ${skipped} local ${noteWord} from the last ${windowLabel} will be skipped. Each remaining company finishes before the next starts.`,
      )
      if (!go) {
        setProgress('')
        return
      }
      setBatching(true)
      await runTickerQueue(queue)
    } catch (e) {
      setRunErr(e instanceof Error ? e.message : 'Could not load the desk reports')
    } finally {
      setRunning(false)
      setBatching(false)
      setStopping(false)
      stopDesk.current = false
    }
  }

  const askQuestion = async () => {
    const q = question.trim()
    if (!q) return
    const model = askModel.picked[0] || LOCAL_MODEL
    setAsking(true)
    setAsk(null)
    setAsked(q)
    setDraft('')
    setAskStatus(`Loading ${shortModelLabel(model)}. The first words can take a minute.`)
    const system = status?.agent_system || 'You are the local finance analyst. Do not invent figures.'
    let transcript = q
    const steps: { tool?: string; ticker?: string }[] = []
    const stream = {
      onDelta: (chunk: string) => setDraft((prev) => prev + chunk),
      onProgress: (state: { textChars: number; thinkingChars: number }) => {
        if (state.textChars) {
          setAskStatus(`Writing… ${state.textChars.toLocaleString()} characters`)
          return
        }
        if (state.thinkingChars) {
          setAskStatus(`Reasoning… ${state.thinkingChars.toLocaleString()} characters`)
        }
      },
    }
    try {
      let answer = ''
      let lastThink = ''
      for (let i = 0; i < 4; i++) {
        setDraft('')
        const chat = await ollamaChat({ system, user: transcript, maxTokens: 3500, model, ...stream })
        lastThink = chat.thinking || lastThink
        const call = parseToolCall(chat.text)
        if (!call) {
          answer = chat.text
          break
        }
        setDraft('')
        setAskStatus(`Looking up ${call.tool}${call.ticker ? ` ${call.ticker}` : ''}…`)
        const tool = await api<{ result?: string }>('/api/local/tool', {
          method: 'POST',
          body: JSON.stringify(call),
        })
        steps.push({ tool: call.tool, ticker: call.ticker || call.portfolio })
        transcript += `\n\nTOOL ${call.tool} RESULT:\n${tool.result || ''}\n\nUse this. Ask for another tool as JSON, or write the markdown answer.`
      }
      if (!answer) {
        setDraft('')
        setAskStatus('Writing the answer…')
        const chat = await ollamaChat({
          system,
          user: `${transcript}\n\nWrite the markdown answer now. Do not call a tool.`,
          maxTokens: 3500,
          model,
          ...stream,
        })
        answer = chat.text
        lastThink = chat.thinking || lastThink
      }
      if (!answer.trim() && lastThink.trim()) {
        answer = lastThink
      }
      if (!answer.trim()) {
        throw new Error(`${shortModelLabel(model)} returned no answer. Ollama is up. Ask again.`)
      }
      setDraft('')
      setAskStatus('')
      setAsk({ ok: true, answer, steps })
    } catch (e) {
      setAskStatus('')
      setAsk({ ok: false, error: e instanceof Error ? e.message : 'Ask failed', steps })
    } finally {
      setAsking(false)
    }
  }

  const reviewBook = async () => {
    if (!book) return
    const model = bookModel.picked[0] || LOCAL_MODEL
    setReviewing(true)
    setReviewErr(null)
    setReviewNote('Writing the recommendation…')
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
        model,
      })
      if (!chat.text || isModelRefusal(chat.text)) {
        throw new Error(
          `The local model refused this review. Nothing was saved. ${refusalDiagnosis(chat)}`,
        )
      }
      setReviewNote('Saving…')
      const saved = await api<{ id?: string }>('/api/local/portfolio-save', {
        method: 'POST',
        body: JSON.stringify({ portfolio: book, text: chat.text }),
      })
      if (!saved.id) throw new Error('Could not save the recommendation')
      setReviewNote('Saved. Opened in a new window.')
      loadReviews()
      openPortfolioReport(saved.id)
    } catch (e) {
      setReviewNote('')
      setReviewErr(e instanceof Error ? e.message : 'Review failed')
    } finally {
      setReviewing(false)
    }
  }

  return (
    <div className={page.page}>
      <header className={styles.head}>
        <div>
          <p className={page.kicker}>This Mac only</p>
          <h1 className={page.h1}>Local model</h1>
        </div>
        {online ? (
          <div className={styles.status} title={status?.message || ''}>
            <span className={`${styles.dot} ${styles.up}`} />
            <div>
              <strong>Ollama running</strong>
              <span>{status?.branch ? status.branch : 'Ready on this Mac'}</span>
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
      <section className={`${styles.card} ${styles.tight}`}>
        <div className={styles.row}>
          <h2>Podcast Intel</h2>
          {libraryCount && <span className={styles.meta}>{libraryCount}</span>}
          <Button size="sm" variant="primary" onClick={() => navigate('/transcripts')}>
            Library
          </Button>
        </div>
      </section>

      <section className={`${styles.card} ${styles.tight}`}>
        <h2>Research</h2>
        <div className={styles.row}>
          <LocalModelPick
            label="Models"
            multiple
            choices={researchModels.choices}
            picked={researchModels.picked}
            disabled={running}
            onToggle={researchModels.toggle}
          />
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            aria-label="Ticker"
            disabled={running}
          />
          <label className={styles.cutoff}>
            <span>Cutoff</span>
            <select
              aria-label="Resume cutoff"
              value={resumeHours}
              disabled={running || stopping}
              onChange={(e) => chooseResumeHours(Number(e.target.value))}
            >
              {RESUME_HOUR_CHOICES.map((hours) => (
                <option key={hours} value={hours}>
                  {resumeWindowLabel(hours)}
                </option>
              ))}
            </select>
          </label>
          {batching ? (
            <Button size="sm" disabled={stopping} onClick={() => requestStop()}>
              {stopping ? 'Stopping…' : 'Stop after this company'}
            </Button>
          ) : (
            <details
              className={styles.runMenu}
              open={runOpen}
              onToggle={(e) => setRunOpen((e.currentTarget as HTMLDetailsElement).open)}
            >
              <summary>Run</summary>
              <div className={styles.runList} role="menu" aria-label="Research runs">
                <button
                  type="button"
                  role="menuitem"
                  disabled={running || !online}
                  onClick={() => {
                    setRunOpen(false)
                    void runResearch()
                  }}
                >
                  {running ? 'Running…' : 'Run local analysis'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!online || running || stopping}
                  onClick={() => {
                    setRunOpen(false)
                    void runDeskReports()
                  }}
                >
                  Run desk reports
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!online || running || stopping}
                  onClick={() => {
                    setRunOpen(false)
                    void resumeDeskReports()
                  }}
                >
                  Resume desk reports
                </button>
              </div>
            </details>
          )}
        </div>
        <p className={styles.meta}>
          Run desk reports uses the companies on the desk saved-reports list, one company at a time.
          Resume desk reports skips a local note newer than the cutoff and continues with the rest.
        </p>
        {progress && <p className={styles.meta}>{progress}</p>}
        {runErr && <p className={styles.warn}>{runErr}</p>}
        {doneTicker && (
          <p className={styles.meta}>
            {doneTicker} saved · cost: $0
          </p>
        )}
      </section>

      <section className={`${styles.card} ${styles.tight}`}>
        <h2>Ask</h2>
        <LocalModelPick
          compact
          choices={askModel.choices}
          picked={askModel.picked}
          disabled={asking}
          onToggle={askModel.toggle}
        />
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={2}
          placeholder="What changed recently at AAPL, and do the stored financials support it?"
          disabled={asking}
        />
        <div className={styles.row}>
          <Button size="sm" variant="primary" disabled={asking || !online || !question.trim()} onClick={() => void askQuestion()}>
            {asking ? 'Thinking…' : 'Ask'}
          </Button>
        </div>
      </section>
      {(asking || ask || draft) && (
        <section className={styles.note} aria-live="polite">
          {asked && <div className={styles.noteQ}>{asked}</div>}
          {askStatus && <p className={styles.meta}>{askStatus}</p>}
          {ask?.error && <p className={styles.warn}>{ask.error}</p>}
          {ask?.steps && ask.steps.length > 0 && (
            <p className={styles.meta}>
              Looked up {ask.steps.map((s) => s.tool).filter(Boolean).join(', ')}
            </p>
          )}
          {(draft || ask?.answer) && (
            <article
              className={styles.noteBody}
              dangerouslySetInnerHTML={{ __html: renderMd(draft || ask?.answer || '') }}
            />
          )}
        </section>
      )}
      <LocalCompare
        ticker={ticker}
        online={online}
        model={askModel.picked[0] || LOCAL_MODEL}
      />
      <LocalBook online={online} />
      </div>
      <div className={`${styles.pair} ${styles.saved}`}>
        <Panel title="Desk saved reports" badge="frontier" flush collapsible className={styles.saved}>
          <SavedReports
            embed
            refreshKey={reportsKey}
            onAnalyze={(tk) => setTicker(tk)}
          />
        </Panel>
        <Panel title="Saved Local Reports" badge="local" flush collapsible className={styles.saved}>
          <SavedReports
            provider="local"
            embed
            refreshKey={reportsKey}
            onAnalyze={(tk) => setTicker(tk)}
          />
        </Panel>
      </div>
      </div>

      <section className={styles.card}>
        <h2>DCF</h2>
        <p>
          Two-stage free cash flow to the firm. Load a ticker to fill the base year
          from the financials store, then change any input. The value updates here.
        </p>
        <LocalDcf />
      </section>

      <div className={styles.pair}>
        <section className={styles.card}>
          <h2>Portfolio</h2>
          <p>
            Recommendations from the account’s holdings, the financial store, and Yahoo updates.
            A finished review opens in its own window.
          </p>
          <LocalModelPick
            choices={bookModel.choices}
            picked={bookModel.picked}
            disabled={reviewing}
            onToggle={bookModel.toggle}
          />
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
          {reviewNote && <p className={styles.meta}>{reviewNote}</p>}
          {reviewErr && <p className={styles.warn}>{reviewErr}</p>}
        </section>

        <section className={styles.card}>
          <h2>Portfolio recommendations</h2>
          <p>Saved reviews for this sign-in. Open one to read it. The table stays out of this card.</p>
          {reviewsErr && <p className={styles.warn}>{reviewsErr}</p>}
          {!reviewsErr && reviews.length === 0 && (
            <p className={styles.meta}>No saved recommendations yet.</p>
          )}
          {reviews.length > 0 && (
            <ul className={styles.reviews}>
              {reviews.map((row) => (
                <li key={row.id}>
                  <div>
                    <strong>{row.portfolio || 'Portfolio'}</strong>
                    <span>{relativeTime(row.created_at) || 'Saved'}</span>
                  </div>
                  <button type="button" className={styles.openBtn} onClick={() => openPortfolioReport(row.id)}>
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
