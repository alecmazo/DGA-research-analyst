import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { renderMd } from '@/lib/md'
import { openReportWindow } from '@/pages/ReportPage'
import styles from './GrokBot.module.css'

type Role = 'user' | 'assistant'
type ChatMsg = { role: Role; content: string; actions?: SiteAction[] }
type SiteAction = {
  type: string
  path?: string
  ticker?: string
  autoRun?: boolean
  note?: string
}

const STORE_KEY = 'dga.grokbot.chat'
const STARTERS = [
  'What’s on this page?',
  'Analyze the biggest watchlist mover',
  'Open Financials for HHH',
  'Run Daily Pulse',
]

function loadChat(): ChatMsg[] {
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    const parsed = raw ? (JSON.parse(raw) as ChatMsg[]) : []
    return Array.isArray(parsed) ? parsed.slice(-24) : []
  } catch {
    return []
  }
}

function saveChat(msgs: ChatMsg[]) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(msgs.slice(-24)))
  } catch {
    /* ignore */
  }
}

export function GrokBot() {
  const loc = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<ChatMsg[]>(loadChat)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    saveChat(msgs)
  }, [msgs])

  useEffect(() => {
    if (!open) return
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
    inputRef.current?.focus()
  }, [open, msgs, busy])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const runActions = (actions: SiteAction[]) => {
    for (const a of actions) {
      if (a.type === 'navigate' && a.path) {
        navigate(a.path)
      } else if (a.type === 'analyze' && a.ticker) {
        if (loc.pathname !== '/') navigate('/')
        window.setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent('dga-focus-analyze', {
              detail: { ticker: a.ticker, autoRun: a.autoRun !== false },
            }),
          )
        }, loc.pathname === '/' ? 40 : 220)
      } else if (a.type === 'open_financials' && a.ticker) {
        if (!loc.pathname.startsWith('/financials')) navigate('/financials')
        window.setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent('dga-open-financials', { detail: { ticker: a.ticker } }),
          )
        }, loc.pathname.startsWith('/financials') ? 40 : 220)
      } else if (a.type === 'add_watchlist' && a.ticker) {
        void api('/api/watchlist', {
          method: 'POST',
          body: JSON.stringify({ ticker: a.ticker }),
        }).catch(() => {})
      } else if (a.type === 'open_report' && a.ticker) {
        openReportWindow(a.ticker, 'grok')
      } else if (a.type === 'run_daily_pulse') {
        if (loc.pathname !== '/') navigate('/')
        window.setTimeout(() => {
          window.dispatchEvent(new Event('dga-run-daily-pulse'))
        }, loc.pathname === '/' ? 40 : 220)
      } else if (a.type === 'run_market_pulse') {
        if (loc.pathname !== '/') navigate('/')
        window.setTimeout(() => {
          window.dispatchEvent(new Event('dga-run-market-pulse'))
        }, loc.pathname === '/' ? 40 : 220)
      } else if (a.type === 'open_support') {
        window.dispatchEvent(new Event('dga-open-support'))
      }
    }
  }

  const send = async (text?: string) => {
    const message = (text ?? draft).trim()
    if (message.length < 2 || busy) return
    setDraft('')
    setErr(null)
    const nextMsgs: ChatMsg[] = [...msgs, { role: 'user', content: message }]
    setMsgs(nextMsgs)
    setBusy(true)
    try {
      const res = await api<{
        ok?: boolean
        reply?: string
        actions?: SiteAction[]
        error?: string
        detail?: string
      }>('/api/grok-bot/chat', {
        method: 'POST',
        body: JSON.stringify({
          message,
          history: nextMsgs.slice(-12).map((m) => ({
            role: m.role,
            content: m.content,
          })),
          page_path: loc.pathname + loc.search,
          page_title: document.title,
        }),
      })
      if (!res.ok && (res.error || res.detail)) {
        throw new Error(res.error || res.detail || 'Grok failed')
      }
      const actions = Array.isArray(res.actions) ? res.actions : []
      setMsgs((cur) => [
        ...cur,
        { role: 'assistant', content: res.reply || 'Done.', actions },
      ])
      if (actions.length) runActions(actions)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Grok unavailable')
    } finally {
      setBusy(false)
    }
  }

  const actionLabel = (a: SiteAction) => {
    if (a.type === 'navigate') return `Open ${a.path || 'page'}`
    if (a.type === 'analyze') return `Analyze ${a.ticker}`
    if (a.type === 'open_financials') return `Financials ${a.ticker}`
    if (a.type === 'add_watchlist') return `Watch ${a.ticker}`
    if (a.type === 'open_report') return `Report ${a.ticker}`
    if (a.type === 'run_daily_pulse') return 'Daily Pulse'
    if (a.type === 'run_market_pulse') return 'Market Pulse'
    if (a.type === 'open_support') return 'Support'
    return a.type
  }

  return (
    <>
      <button
        type="button"
        className={`${styles.fab} ${open ? styles.fabOpen : ''}`}
        title="Ask Grok to do something on this page"
        aria-label="Open Grok desk bot"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.fabIco} aria-hidden>
          ✶
        </span>
        <span className={styles.fabLabel}>Grok</span>
      </button>

      {open && (
        <div className={styles.panel} role="dialog" aria-label="Grok desk bot">
          <div className={styles.head}>
            <div>
              <div className={styles.headTitle}>Grok</div>
              <span className={styles.headSub}>Desk bot · this page</span>
            </div>
            <div className={styles.headBtns}>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => {
                  setMsgs([])
                  saveChat([])
                }}
              >
                New
              </button>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
          </div>

          <div className={styles.msgs} ref={listRef}>
            {!msgs.length && (
              <div className={styles.hint}>
                Give Grok a task on this site — analyze a name, jump to
                Financials, run Pulse, add to the watchlist, or ask what’s on
                this page.
                <div className={styles.chips}>
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={styles.chip}
                      onClick={() => void send(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div
                key={`${m.role}-${i}`}
                className={`${styles.bubble} ${m.role === 'user' ? styles.user : styles.bot}`}
              >
                {m.role === 'assistant' ? (
                  <div
                    dangerouslySetInnerHTML={{ __html: renderMd(m.content) }}
                  />
                ) : (
                  m.content
                )}
                {!!m.actions?.length && (
                  <div className={styles.actions}>
                    {m.actions.map((a, j) => (
                      <span key={`${a.type}-${j}`} className={styles.act}>
                        {actionLabel(a)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className={`${styles.bubble} ${styles.bot}`}>Thinking…</div>
            )}
          </div>

          {err && <div className={styles.err}>{err}</div>}

          <form
            className={styles.foot}
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
          >
            <textarea
              ref={inputRef}
              className={styles.input}
              rows={1}
              placeholder="Task for Grok…"
              value={draft}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
            />
            <button type="submit" className={styles.send} disabled={busy || draft.trim().length < 2}>
              Send
            </button>
          </form>
        </div>
      )}
    </>
  )
}
