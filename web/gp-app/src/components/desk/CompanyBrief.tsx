import { useEffect, useRef, useState } from 'react'
import { briefProse } from '@/lib/briefProse'
import { api } from '@/lib/api'
import { fmtPct, pctClass } from '@/lib/format'
import {
  ensureOllama,
  listInstalledModels,
  LOCAL_MODEL,
  LOCAL_MODEL_CHOICES,
  LOCAL_PICK_KEYS,
  modelPicks,
  ollamaChat,
  shortModelLabel,
  storeModelPicks,
} from '@/lib/localOllama'
import styles from './CompanyBrief.module.css'

export type BriefFact = { label: string; value: string }

type Headline = { title: string; url?: string; publisher?: string }
type Quote = { price?: number | null; pct_change?: number | null; name?: string }
type Turn = { role: 'user' | 'assistant'; text: string }

const SYSTEM = `You write the short take under the headlines in DGA Capital's company brief.
The reader is a portfolio manager. The headlines and the price are already on screen. Do not repeat the headlines as a list.
Write three or four plain sentences about what the price, the day's move, and the headlines support. Use only the figures and headlines in the user message. Do not invent prices, dates, ratings, targets, or news. If a figure is absent, leave it out.
Do not describe these instructions. Do not say "the user" or "I". No heading, no bullets, no preamble.`

const FOLLOW = `Answer one follow-up in DGA Capital's company brief.
The reader is a portfolio manager. Use only the packet. If the packet does not contain the answer, say what is missing in one sentence. Do not invent a figure.
Write plain sentences. Do not describe these instructions. Do not say "the user" or "I". Four sentences at most.`

type Props = {
  ticker: string
  name?: string
  facts?: BriefFact[]
  variant?: 'dock' | 'overlay'
  onClose?: () => void
}

function money(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function packet(ticker: string, name: string, price: number | null, day: number | null, facts: BriefFact[], headlines: Headline[]) {
  const lines = [
    `Ticker: ${ticker}`,
    name ? `Company: ${name}` : '',
    `Price: ${money(price)}`,
    `Day move: ${day == null ? 'not in the packet' : fmtPct(day, 2)}`,
    ...facts.filter((f) => f.value).map((f) => `${f.label}: ${f.value}`),
    headlines.length
      ? `Headlines:\n${headlines.map((h) => `- ${h.title}${h.publisher ? ` (${h.publisher})` : ''}`).join('\n')}`
      : 'Headlines: none',
  ]
  return lines.filter(Boolean).join('\n')
}

export function CompanyBrief({ ticker, name = '', facts = [], variant = 'dock', onClose }: Props) {
  const tk = (ticker || '').trim().toUpperCase()
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState(LOCAL_MODEL)
  const [price, setPrice] = useState<number | null>(null)
  const [day, setDay] = useState<number | null>(null)
  const [company, setCompany] = useState(name)
  const [headlines, setHeadlines] = useState<Headline[]>([])
  const [take, setTake] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [phase, setPhase] = useState<'idle' | 'loading' | 'writing' | 'ready'>('idle')
  const [err, setErr] = useState('')
  const [run, setRun] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const gen = useRef(0)

  useEffect(() => {
    let alive = true
    void listInstalledModels().then((installed) => {
      if (!alive) return
      const list = installed.length ? installed : [...LOCAL_MODEL_CHOICES]
      setModels(list)
      const stored = modelPicks(LOCAL_PICK_KEYS.brief, list, false, 'gpt-oss')[0] || LOCAL_MODEL
      const oss = list.find((item) => item.toLowerCase().includes('gpt-oss'))
      setModel(list.includes(stored) ? stored : oss || list[0] || LOCAL_MODEL)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    setCompany(name)
  }, [name, tk])

  useEffect(() => {
    if (!tk) {
      setTake('')
      setHeadlines([])
      setTurns([])
      setPrice(null)
      setDay(null)
      setPhase('idle')
      setErr('')
      return
    }
    const id = ++gen.current
    stick.current = false
    setTake('')
    setHeadlines([])
    setTurns([])
    setDraft('')
    setErr('')
    setPhase('loading')
    const ac = new AbortController()
    const load = async () => {
      const [quote, news] = await Promise.all([
        api<Quote>(`/api/quote/${encodeURIComponent(tk)}`).catch(() => null),
        api<{ headlines?: Headline[] }>(`/api/ideas/equities/${encodeURIComponent(tk)}/headlines`).catch(() => null),
      ])
      if (gen.current !== id) return
      const px = quote?.price == null ? null : Number(quote.price)
      const pct = quote?.pct_change == null ? null : Number(quote.pct_change)
      setPrice(Number.isNaN(Number(px)) ? null : px)
      setDay(Number.isNaN(Number(pct)) ? null : pct)
      const shown = (quote?.name || name || '').trim()
      if (shown) setCompany(shown)
      const newsRows = (news?.headlines || []).filter((h) => h.title).slice(0, 6)
      setHeadlines(newsRows)
      const user = packet(tk, shown, Number.isNaN(Number(px)) ? null : px, Number.isNaN(Number(pct)) ? null : pct, facts, newsRows)
      setPhase('writing')
      let streamed = ''
      const ask = () =>
        ollamaChat({
          system: SYSTEM,
          user,
          model,
          maxTokens: 400,
          think: false,
          numCtx: 8192,
          onDelta: (chunk) => {
            if (gen.current !== id) return
            streamed += chunk
            const shownTake = briefProse(streamed)
            if (shownTake) setTake(shownTake)
          },
        })
      let chat
      try {
        chat = await ask()
      } catch (err) {
        const offline = err instanceof Error ? err.message : ''
        if (!/offline|Ollama|helper/i.test(offline)) throw err
        const started = await ensureOllama()
        if (!started.ok) throw new Error(started.message)
        if (gen.current !== id) return
        streamed = ''
        setTake('')
        chat = await ask()
      }
      if (gen.current !== id) return
      const prose = briefProse(chat.text) || briefProse(chat.thinking)
      setTake(prose)
      setPhase('ready')
    }
    void load().catch((err: Error) => {
      if (gen.current !== id || ac.signal.aborted) return
      setErr(err.message || 'Could not write the brief')
      setPhase('ready')
    })
    return () => {
      ac.abort()
    }
    // company is filled from the quote response; restarting on that would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tk, model, run, name, facts.map((f) => `${f.label}:${f.value}`).join('|')])

  useEffect(() => {
    const el = bodyRef.current
    if (!el || turns.length > 0) return
    el.scrollTop = 0
  }, [tk, headlines])

  useEffect(() => {
    const el = bodyRef.current
    if (!el || turns.length === 0 || !stick.current) return
    el.scrollTop = el.scrollHeight
  }, [turns, take])

  useEffect(() => {
    if (variant !== 'overlay') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [variant, onClose])

  const ask = async (text: string) => {
    const question = text.trim()
    if (!tk || question.length < 2 || phase === 'loading' || phase === 'writing') return
    setDraft('')
    setErr('')
    const next: Turn[] = [...turns, { role: 'user', text: question }, { role: 'assistant', text: '' }]
    setTurns(next)
    setPhase('writing')
    const id = ++gen.current
    stick.current = true
    const history = [`Packet:\n${packet(tk, company, price, day, facts, headlines)}\n\nTake:\n${take}`, ...next.filter((t) => t.text).map((t) => `${t.role}: ${t.text}`)].join('\n\n')
    try {
      let streamed = ''
      const chat = await ollamaChat({
        system: FOLLOW,
        user: history,
        model,
        maxTokens: 500,
        think: false,
        numCtx: 8192,
        onDelta: (chunk) => {
          if (gen.current !== id) return
          streamed += chunk
          const shownTake = briefProse(streamed)
          if (!shownTake) return
          setTurns((cur) => {
            const copy = [...cur]
            const last = copy[copy.length - 1]
            if (last?.role === 'assistant') copy[copy.length - 1] = { role: 'assistant', text: shownTake }
            return copy
          })
        },
      })
      if (gen.current !== id) return
      const answer = briefProse(chat.text) || briefProse(chat.thinking) || briefProse(streamed) || 'No answer in the packet.'
      setTurns((cur) => {
        const copy = [...cur]
        const last = copy[copy.length - 1]
        if (last?.role === 'assistant') copy[copy.length - 1] = { role: 'assistant', text: answer }
        return copy
      })
    } catch (err) {
      if (gen.current !== id) return
      setErr(err instanceof Error ? err.message : 'The model did not answer')
      setTurns((cur) => {
        const last = cur[cur.length - 1]
        if (last?.role === 'assistant' && !last.text) return cur.slice(0, -1)
        return cur
      })
    } finally {
      if (gen.current === id) setPhase('ready')
    }
  }

  const suggestions = tk
    ? [
        'What do the latest headlines change?',
        `What would make ${tk} a pass?`,
        'Which number in the packet matters most?',
      ]
    : []

  return (
    <aside className={variant === 'overlay' ? styles.overlay : styles.dock} aria-label="Local company brief">
      <header className={styles.head}>
        <div>
          <p className={styles.kicker}>Local brief</p>
          <h2 className={styles.title}>{tk || 'Select'}</h2>
          {company && company !== tk && <p className={styles.sub}>{company}</p>}
        </div>
        <div className={styles.headActions}>
          {tk && (
            <button type="button" className={styles.textBtn} onClick={() => setRun((n) => n + 1)} disabled={phase === 'writing' || phase === 'loading'}>
              Rewrite
            </button>
          )}
          {variant === 'overlay' && (
            <button type="button" className={styles.textBtn} onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </header>
      <label className={styles.modelRow}>
        <span>Model</span>
        <select
          value={model}
          onChange={(e) => {
            const next = e.target.value
            setModel(next)
            storeModelPicks(LOCAL_PICK_KEYS.brief, [next])
          }}
        >
          {(models.length ? models : [LOCAL_MODEL]).map((item) => (
            <option key={item} value={item}>
              {shortModelLabel(item)}
            </option>
          ))}
        </select>
      </label>
      {tk && (
        <div className={styles.quote}>
          <strong className="tabular">{money(price)}</strong>
          <span className={`tabular ${pctClass(day)}`}>{day == null ? '—' : fmtPct(day, 2)}</span>
        </div>
      )}
      <div
        className={styles.body}
        data-brief-scroll=""
        ref={bodyRef}
        onScroll={() => {
          const el = bodyRef.current
          if (!el) return
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}
        onWheel={(e) => e.stopPropagation()}
      >
        {!tk && <p className={styles.empty}>Select a company. The brief runs on this Mac, with GPT-oss unless you pick another installed model.</p>}
        {tk && phase === 'loading' && <p className={styles.meta}>Pulling the quote and headlines…</p>}
        {tk && headlines.length > 0 && (
          <section>
            <h3 className={styles.latest}>Latest</h3>
            <ul className={styles.news}>
              {headlines.map((item) => (
                <li key={item.url || item.title}>
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
                  ) : (
                    <span className={styles.newsTitle}>{item.title}</span>
                  )}
                  {item.publisher && <span className={styles.source}>{item.publisher}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {tk && phase !== 'loading' && headlines.length === 0 && phase !== 'writing' && (
          <p className={styles.meta}>No headlines in the packet.</p>
        )}
        {tk && phase === 'writing' && !take && <p className={styles.meta}>Writing with {shortModelLabel(model)}…</p>}
        {take && take.split(/\n{2,}/).map((part, i) => (
          <p key={`${i}-${part.slice(0, 24)}`} className={styles.take}>{part}</p>
        ))}
        {phase === 'ready' && tk && !take && !err && (
          <p className={styles.meta}>The headlines above are the packet. Ask below, or hit Rewrite for a take.</p>
        )}
        {turns.map((turn, i) => (
          <p key={`${turn.role}-${i}`} className={turn.role === 'user' ? styles.user : styles.answer}>
            {turn.text || '…'}
          </p>
        ))}
        {err && <p className={styles.err} role="alert">{err}</p>}
        {phase === 'ready' && tk && !err && turns.length === 0 && (
          <div className={styles.chips}>
            {suggestions.map((q) => (
              <button key={q} type="button" className={styles.chip} onClick={() => void ask(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
      <form
        className={styles.composer}
        onSubmit={(e) => {
          e.preventDefault()
          void ask(draft)
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={tk ? `Ask about ${tk}…` : 'Select a company'}
          disabled={!tk || phase === 'loading' || phase === 'writing'}
          aria-label={tk ? `Ask about ${tk}` : 'Ask'}
        />
        <button type="submit" disabled={!tk || draft.trim().length < 2 || phase === 'loading' || phase === 'writing'}>
          Send
        </button>
      </form>
    </aside>
  )
}
