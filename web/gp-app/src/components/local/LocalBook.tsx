import { useRef, useState } from 'react'
import { api } from '@/lib/api'
import { renderMd } from '@/lib/md'
import { openPortfolioReport } from '@/lib/openWindows'
import {
  LOCAL_PICK_KEYS,
  isModelRefusal,
  ollamaChat,
  shortModelLabel,
} from '@/lib/localOllama'
import { LocalModelPick, useLocalModelChoice } from '@/components/local/LocalModelPick'
import { Button } from '@/components/ui/Button'
import styles from '@/pages/LocalPage.module.css'

type Card = {
  ticker: string
  line: string
}

type BookPack = {
  as_of?: string
  count?: number
  chunk?: number
  suggested_model?: string
  suggested_why?: string
  cards?: Card[]
}

type Score = {
  ticker: string
  keep: boolean
  ev: number
  risk: number
  why: string
}

const SCREEN = `You screen saved local equity notes for a 12-month book. The user message is the only source. Do not use memory and do not add a ticker.
For each ticker write exactly one line and no other text:
TICKER | keep or pass | EV n | risk n | one sentence
EV and risk are integers from 1 to 10. EV is expected value versus the live price in the card (target and upside). Risk is the chance the thesis breaks. keep means it can compete for a ten-name book. The sentence is under 25 words and cites the live price or the target.`

const FINAL = `You construct one 10-name portfolio for the next 12 months. The user message is the only source. Do not invent a ticker, a price, or a target.
Write markdown with these sections:

# Local 10
One sentence: the as-of line in the packet, and the 12-month return you are aiming at for the whole book. A range is allowed. It is a target, not a promise.

## Book
A table with ticker, weight %, live price, 12-month target, upside versus that live price, and role (core or satellite).
Use 10 names when the packet has at least 10. If it has fewer, use every name and say the saved universe is smaller than 10.
Weights are numbers that sum to 100. No name above 18.

## Why these ten, now
One short subsection per name. Why the live price versus the saved thesis makes this a hold for the next 12 months. Name the risk you are taking and why the weight is that size.

## Book risk and the 12-month path
What has to go right, what would make you cut a name, and how the weights add up to the targeted performance.

## Left out
Up to five names you passed, each with the one reason from the screen.`

const SCORE_LINE = /^([A-Z][A-Z0-9.-]{0,11})\s*\|\s*(keep|pass)\s*\|\s*EV\s*(\d{1,2})\s*\|\s*risk\s*(\d{1,2})\s*\|\s*(.+)$/i

function parseScreen(text: string): Score[] {
  const rows: Score[] = []
  for (const raw of text.split('\n')) {
    const match = raw.trim().match(SCORE_LINE)
    if (!match) continue
    rows.push({
      ticker: match[1].toUpperCase(),
      keep: match[2].toLowerCase() === 'keep',
      ev: Number(match[3]),
      risk: Number(match[4]),
      why: match[5].trim(),
    })
  }
  return rows
}

function rankScore(row: Score): number {
  return (row.keep ? 100 : 0) + row.ev * 2 - row.risk
}

export function LocalBook({ online }: { online: boolean }) {
  const bookModel = useLocalModelChoice(LOCAL_PICK_KEYS.book, false, 'gemma4:26b')
  const model = bookModel.picked[0] || 'gemma4:26b'
  const stop = useRef(false)
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState('')
  const [savedId, setSavedId] = useState<string | null>(null)
  const [why, setWhy] = useState('')

  const run = async () => {
    if (running) return
    stop.current = false
    setRunning(true)
    setErr(null)
    setDraft('')
    setNote('')
    setSavedId(null)
    setStatus('Loading saved local notes and live prices…')
    try {
      const pack = await api<BookPack>('/api/local/book')
      if (pack.suggested_why) setWhy(pack.suggested_why)
      const cards = pack.cards || []
      if (!cards.length) {
        throw new Error('No saved local reports yet. Run a local note first.')
      }
      const size = Math.max(1, pack.chunk || 6)
      const scored: Score[] = []
      for (let i = 0; i < cards.length; i += size) {
        if (stop.current) throw new Error('Stopped.')
        const slice = cards.slice(i, i + size)
        setStatus(
          `Screening ${i + 1}–${i + slice.length} of ${cards.length}` +
            (pack.as_of ? ` · prices as of ${pack.as_of}` : ''),
        )
        const chat = await ollamaChat({
          system: SCREEN,
          user: `Screen these saved local notes. Prices were refreshed for this run.\n\n${slice
            .map((card) => card.line)
            .join('\n\n')}`,
          model,
          maxTokens: 800,
          numCtx: 8192,
          think: 'low',
        })
        if (isModelRefusal(chat.text)) {
          throw new Error(`${shortModelLabel(model)} refused the screen. Nothing was saved.`)
        }
        const parsed = parseScreen(chat.text)
        if (parsed.length) scored.push(...parsed)
      }
      const seen = new Set(scored.map((row) => row.ticker))
      for (const card of cards) {
        if (seen.has(card.ticker)) continue
        scored.push({
          ticker: card.ticker,
          keep: false,
          ev: 5,
          risk: 5,
          why: 'The screen did not score this name.',
        })
      }
      const ranked = [...scored].sort((a, b) => rankScore(b) - rankScore(a))
      const finalists = ranked.slice(0, Math.min(14, ranked.length))
      const byTicker = new Map(cards.map((card) => [card.ticker, card.line]))
      const packet = finalists
        .map((row) => {
          const line = byTicker.get(row.ticker) || row.ticker
          return `${line}\nscreen: ${row.keep ? 'keep' : 'pass'} · EV ${row.ev} · risk ${row.risk} · ${row.why}`
        })
        .join('\n\n')
      const universe =
        cards.length < 10
          ? `The saved universe has ${cards.length} names. Use every name.`
          : `Pick 10 names from these ${finalists.length} finalists.`
      setStatus(`Writing the 10-name book with ${shortModelLabel(model)}…`)
      setDraft('')
      const book = await ollamaChat({
        system: FINAL,
        user: `${universe}\nPrices in the cards are the prices for this run.\n\n${packet}`,
        model,
        maxTokens: 2800,
        numCtx: 12288,
        think: 'low',
        onDelta: (chunk) => setDraft((prev) => prev + chunk),
      })
      if (stop.current) throw new Error('Stopped.')
      const text = book.text.trim()
      if (!text || isModelRefusal(text)) {
        throw new Error(`${shortModelLabel(model)} did not write the book. Nothing was saved.`)
      }
      setNote(text)
      setDraft('')
      setStatus('Saving the book…')
      const saved = await api<{ id?: string }>('/api/local/portfolio-save', {
        method: 'POST',
        body: JSON.stringify({ portfolio: 'Local 10', text }),
      })
      setSavedId(saved.id || null)
      setStatus(`Saved · ${cards.length} notes read in groups of ${size} · ${shortModelLabel(model)}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not build the book')
      setStatus('')
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className={`${styles.card} ${styles.tight}`}>
      <h2>Local 10</h2>
      <p>
        {why ||
          'Gemma 26B is the model for this card. It compares names, weights, and a 12-month path. GPT-oss writes a single equity note better. Gemma 12B is the faster screen when 26B is not installed.'}
      </p>
      <p>
        Each run reads the saved local notes six at a time, refreshes the prices, and writes a new
        ten-name book. The note is saved with the portfolio recommendations.
      </p>
      <LocalModelPick
        compact
        choices={bookModel.choices}
        picked={bookModel.picked}
        disabled={running}
        onToggle={bookModel.toggle}
      />
      <div className={styles.row}>
        <Button size="sm" variant="primary" disabled={!online || running} onClick={() => void run()}>
          {running ? 'Building…' : 'Build the book'}
        </Button>
        {running && (
          <Button
            size="sm"
            onClick={() => {
              stop.current = true
            }}
          >
            Stop
          </Button>
        )}
        {savedId && (
          <Button size="sm" onClick={() => openPortfolioReport(savedId)}>
            Open saved book
          </Button>
        )}
      </div>
      {status && <p className={styles.meta}>{status}</p>}
      {err && <p className={styles.warn}>{err}</p>}
      {(draft || note) && (
        <article
          className={styles.noteBody}
          dangerouslySetInnerHTML={{ __html: renderMd(draft || note) }}
        />
      )}
    </section>
  )
}
