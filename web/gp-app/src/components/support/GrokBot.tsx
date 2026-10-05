import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { getCachedUser } from '@/lib/auth'
import { ensureOllama, ollamaChat } from '@/lib/localOllama'
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
const ALLOWED_PATHS = new Set([
  '/',
  '/financials',
  '/options',
  '/builder',
  '/local',
  '/munger',
  '/gurus',
  '/podcasts',
  '/transcripts',
  '/merger-arb',
  '/credit',
  '/positions',
  '/fund',
  '/memos',
  '/settings',
])
const TICKER_ACTIONS = new Set(['analyze', 'open_financials', 'add_watchlist', 'open_report'])
const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,11}$/
const DESK_SYSTEM = `You are GPT-oss, the on-desk assistant inside DGA Capital's GP terminal (portfolio.dgacapital.com/gp).
Alec or Edyta is talking to you from this Mac. Help them get work done on this page.

You can answer questions AND propose site actions. Do not invent prices, NAVs, or filings — if you need live numbers, say so or use an action (analyze / financials).

Allowed actions (only these types):
- navigate { "type":"navigate", "path":"/financials" }  paths: / /financials /local /munger /gurus /options /builder /podcasts /transcripts /merger-arb /credit /positions /fund /memos /settings
  /builder is Watchlists. Work is Desk, Financials, Local, Watchlists, Gurus, Podcasts. Lab is Credit, Transcripts, Munger, Merger Arb.
- analyze { "type":"analyze", "ticker":"AAPL", "autoRun":true }  opens Desk Analyze and runs research
- open_financials { "type":"open_financials", "ticker":"HHH" }
- add_watchlist { "type":"add_watchlist", "ticker":"NVDA" }
- open_report { "type":"open_report", "ticker":"AAPL" }
- run_daily_pulse { "type":"run_daily_pulse" }
- run_market_pulse { "type":"run_market_pulse" }
- open_support { "type":"open_support", "note":"optional" }  files a bug via the Support button

Return ONLY a JSON object (no preamble):
{"reply":"markdown for the user","actions":[ ... ]}
If no action is needed, use "actions":[]. Keep reply concise (under 180 words) unless they ask for depth.
`

function cleanTicker(raw: unknown): string | null {
  const s = String(raw ?? '').trim().toUpperCase()
  if (!s || !TICKER_RE.test(s)) return null
  return s
}

function sanitizeActions(raw: unknown): SiteAction[] {
  if (!Array.isArray(raw)) return []
  const out: SiteAction[] = []
  for (const item of raw.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue
    const row = item as { type?: string; path?: string; ticker?: string; autoRun?: boolean; note?: string }
    const kind = String(row.type || '').trim().toLowerCase()
    if (
      kind !== 'navigate' &&
      kind !== 'analyze' &&
      kind !== 'open_financials' &&
      kind !== 'add_watchlist' &&
      kind !== 'open_support' &&
      kind !== 'run_daily_pulse' &&
      kind !== 'run_market_pulse' &&
      kind !== 'open_report'
    ) {
      continue
    }
    const action: SiteAction = { type: kind }
    if (kind === 'navigate') {
      let path = String(row.path || '').trim() || '/'
      if (!path.startsWith('/')) path = `/${path}`
      path = path.split('?')[0].replace(/\/+$/, '') || '/'
      if (!ALLOWED_PATHS.has(path)) continue
      action.path = path
    } else if (TICKER_ACTIONS.has(kind)) {
      const ticker = cleanTicker(row.ticker)
      if (!ticker) continue
      action.ticker = ticker
      if (kind === 'analyze') action.autoRun = row.autoRun !== false
    } else if (kind === 'open_support') {
      const note = String(row.note || '').trim().slice(0, 400)
      if (note) action.note = note
    }
    out.push(action)
  }
  return out
}

function parseDeskReply(text: string): { reply: string; actions: SiteAction[] } {
  const raw = (text || '').trim()
  if (!raw) return { reply: '', actions: [] }
  const fence = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
  let blob = fence?.[1]
  if (!blob) {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start >= 0 && end > start) blob = raw.slice(start, end + 1)
  }
  if (blob) {
    try {
      const data = JSON.parse(blob) as { reply?: unknown; actions?: unknown }
      if (data && typeof data === 'object' && ('reply' in data || 'actions' in data)) {
        const reply = String(data.reply || '').trim()
        return { reply: reply || raw, actions: sanitizeActions(data.actions) }
      }
    } catch {
      /* the model wrote plain text */
    }
  }
  return { reply: raw, actions: [] }
}

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
    if (getCachedUser()?.demo_mode) {
      setErr('Demo cannot use the desk bot.')
      return
    }
    setDraft('')
    setErr(null)
    const nextMsgs: ChatMsg[] = [...msgs, { role: 'user', content: message }]
    setMsgs(nextMsgs)
    setBusy(true)
    try {
      const who = getCachedUser()
      const hist = nextMsgs
        .slice(-12)
        .map((m) => `${m.role}: ${m.content.slice(0, 1500)}`)
        .join('\n')
      const userBlock = [
        `Current page: ${document.title || 'GP'} · ${loc.pathname}${loc.search}`,
        `User: ${who?.name || ''} <${who?.email || ''}>`,
        hist ? `Recent chat:\n${hist}` : '',
        `New task:\n${message}`,
      ]
        .filter(Boolean)
        .join('\n')
      const ask = () =>
        ollamaChat({
          system: DESK_SYSTEM,
          user: userBlock,
          maxTokens: 800,
          think: 'low',
          numCtx: 8192,
        })
      let chat
      try {
        chat = await ask()
      } catch (err) {
        const offline = err instanceof Error ? err.message : ''
        if (!/offline|Ollama/i.test(offline)) throw err
        const started = await ensureOllama()
        if (!started.ok) throw new Error(started.message)
        chat = await ask()
      }
      const parsed = parseDeskReply(chat.text)
      const reply = parsed.reply || 'I heard you — try again in a moment.'
      setMsgs((cur) => [...cur, { role: 'assistant', content: reply, actions: parsed.actions }])
      if (parsed.actions.length) runActions(parsed.actions)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'GPT-oss unavailable')
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
        title="Ask GPT-oss to do something on this page"
        aria-label="Open GPT-oss"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.fabIco} aria-hidden>
          ✶
        </span>
        <span className={styles.fabLabel}>GPT-oss</span>
      </button>

      {open && (
        <div className={styles.panel} role="dialog" aria-label="GPT-oss">
          <div className={styles.head}>
            <div>
              <div className={styles.headTitle}>GPT-oss</div>
              <span className={styles.headSub}>On this Mac · this page</span>
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
                Give GPT-oss a task on this site — analyze a name, jump to
                Financials, run Pulse, add to the watchlist, or ask what’s on
                this page. It runs on this Mac and does not call a paid API.
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
              placeholder="Task for GPT-oss…"
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
