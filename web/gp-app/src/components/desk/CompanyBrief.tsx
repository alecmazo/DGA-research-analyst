import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { fmtPct, pctClass } from '@/lib/format'
import {
  chatAnswer,
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

const SYSTEM = `You are DGA Capital's desk analyst. This is the right-hand brief, not a full note.
Use only the figures and headlines in the user message. Do not invent prices, dates, ratings, targets, or news.
Write in short sentences.

First line: company and ticker.
Then the heading Latest and at most five bullets. Each bullet uses one headline from the packet and names the publisher when it is printed. If the packet has no headlines, one bullet: No headlines in the packet.
Then the heading Setup and two sentences on the price, the day's move, and any fair value in the packet. If fair value is absent, do not guess one.
Then the heading Ask next and three short questions a portfolio manager would ask about this name.
Stop.`

const FOLLOW = `You are DGA Capital's desk analyst answering one follow-up in the right-hand brief.
Use only the packet and the brief already written. If the packet does not contain the answer, say what is missing in one sentence. Do not invent a figure. Four sentences at most.`

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
  const [brief, setBrief] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [phase, setPhase] = useState<'idle' | 'loading' | 'writing' | 'ready'>('idle')
  const [err, setErr] = useState('')
  const [run, setRun] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)
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
      setBrief('')
      setTurns([])
      setPrice(null)
      setDay(null)
      setPhase('idle')
      setErr('')
      return
    }
    const id = ++gen.current
    setBrief('')
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
      const headlines = (news?.headlines || []).filter((h) => h.title).slice(0, 6)
      const user = packet(tk, shown, Number.isNaN(Number(px)) ? null : px, Number.isNaN(Number(pct)) ? null : pct, facts, headlines)
      setPhase('writing')
      const ask = () =>
        ollamaChat({
          system: SYSTEM,
          user,
          model,
          maxTokens: 700,
          think: false,
          numCtx: 8192,
          onDelta: (chunk) => {
            if (gen.current !== id) return
            setBrief((prev) => prev + chunk)
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
        setBrief('')
        chat = await ask()
      }
      if (gen.current !== id) return
      setBrief(chatAnswer(chat) || 'The model returned an empty brief.')
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
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [brief, turns, phase])

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
    const history = [`Packet brief:\n${brief}`, ...next.filter((t) => t.text).map((t) => `${t.role}: ${t.text}`)].join('\n\n')
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
          setTurns((cur) => {
            const copy = [...cur]
            const last = copy[copy.length - 1]
            if (last?.role === 'assistant') copy[copy.length - 1] = { role: 'assistant', text: streamed }
            return copy
          })
        },
      })
      if (gen.current !== id) return
      const answer = chatAnswer(chat) || streamed || 'No answer.'
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
        `What would make ${tk} a pass?`,
        'Which number in the packet matters most?',
        'What is missing that I should pull from the filing?',
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
      <div className={styles.body} ref={bodyRef}>
        {!tk && <p className={styles.empty}>Select a company. The brief runs on this Mac, with GPT-oss unless you pick another installed model.</p>}
        {tk && phase === 'loading' && <p className={styles.meta}>Pulling the quote and headlines…</p>}
        {tk && phase === 'writing' && !brief && <p className={styles.meta}>Writing with {shortModelLabel(model)}…</p>}
        {brief && <pre className={styles.prose}>{brief}</pre>}
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
