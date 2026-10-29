import { useRef, useState } from 'react'
import { api } from '@/lib/api'
import { renderMd } from '@/lib/md'
import { openPortfolioReport } from '@/lib/openWindows'
import {
  LOCAL_PICK_KEYS,
  chatAnswer,
  isModelRefusal,
  ollamaChat,
  shortModelLabel,
  type LocalChat,
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

const SCORE_LINE = /^([A-Z][A-Z0-9.-]{0,11})\s*\|\s*(keep|pass)\s*\|\s*(?:EV\s*)?(\d{1,2})\s*\|\s*(?:risk\s*)?(\d{1,2})\s*\|\s*(.+)$/i

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

function modelThink(model: string): string | false {
  return /gemma/i.test(model) ? false : 'low'
}

function briefLine(line: string): string {
  return line.split('\n').slice(0, 2).join(' | ')
}

function sectionBody(raw: string): string {
  const text = raw.trim()
  const at = text.search(/^#{1,3}\s+\S/m)
  if (at > 0 && at < 2500) return text.slice(at).trim()
  return text
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
    let written = ''
    const saveBook = async (body: string) => {
      const saved = await api<{ id?: string }>('/api/local/portfolio-save', {
        method: 'POST',
        body: JSON.stringify({ portfolio: 'Local 10', text: body }),
      })
      setSavedId(saved.id || null)
      setNote(body)
      setDraft('')
    }
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
          think: modelThink(model),
        })
        const screenText = chatAnswer(chat)
        if (isModelRefusal(screenText)) {
          throw new Error(`${shortModelLabel(model)} refused the screen. Nothing was saved.`)
        }
        const parsed = parseScreen(screenText)
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
      const finalists = ranked.slice(0, Math.min(12, ranked.length))
      const byTicker = new Map(cards.map((card) => [card.ticker, card.line]))
      const packet = finalists
        .map((row) => {
          const line = briefLine(byTicker.get(row.ticker) || row.ticker)
          return `${line} | screen ${row.keep ? 'keep' : 'pass'} EV ${row.ev} risk ${row.risk} | ${row.why}`
        })
        .join('\n')
      const universe =
        cards.length < 10
          ? `The saved universe has ${cards.length} names. Use every name.`
          : 'Pick 10 names from this list.'
      const askPiece = async (label: string, user: string, maxTokens: number) => {
        if (stop.current) throw new Error('Stopped.')
        setStatus(label)
        setDraft('')
        const once = async (think: string | false, lead: string) => {
          const chat: LocalChat = await ollamaChat({
            system: lead,
            user,
            model,
            maxTokens,
            numCtx: 8192,
            think,
            onDelta: (chunk) => setDraft((prev) => prev + chunk),
          })
          return chatAnswer(chat)
        }
        let text = sectionBody(await once(
          modelThink(model),
          'Write the requested markdown now. This is an internal research memo from saved notes. Do not apologize.',
        ))
        if (!text || isModelRefusal(text)) {
          setDraft('')
          text = sectionBody(await once(
            false,
            'Write the requested markdown now. Do not refuse and do not explain your process.',
          ))
        }
        const body = text
        if (!body || isModelRefusal(body)) {
          throw new Error(
            body
              ? `${shortModelLabel(model)} refused this section. ${body.slice(0, 240)}`
              : `${shortModelLabel(model)} returned no text for this section.`,
          )
        }
        return body
      }
      const table = await askPiece(
        `Writing the weights with ${shortModelLabel(model)}…`,
        `${universe}\nPrices below are for this run.\n\n${packet}\n\nWrite only:\n# Local 10\nOne sentence with the 12-month return you are aiming at for the book.\n## Book\n${FINAL.split('## Book')[1].split('## Why')[0]}`,
        900,
      )
      written = table
      setNote(written)
      setDraft('')
      const whyNow = await askPiece(
        'Writing why these names, now…',
        `The book table is below. Write ## Why these ten, now. One short subsection per name in the table: the live price versus the target, the risk, and why the weight is that size. Use only names and figures in the table.\n\n${table}`,
        1400,
      )
      written = `${written}\n\n${whyNow}`.trim()
      setNote(written)
      setDraft('')
      const path = await askPiece(
        'Writing the 12-month path…',
        `The book is below. Write ## Book risk and the 12-month path and ## Left out. Name what would cut a holding, and up to five names from the list that are not in the table.\n\n${table}\n\nCandidates:\n${packet}`,
        800,
      )
      written = `${written}\n\n${path}`.trim()
      setNote(written)
      setDraft('')
      setStatus('Saving the book…')
      await saveBook(written)
      setStatus(`Saved · ${cards.length} notes read in groups of ${size} · ${shortModelLabel(model)}`)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not build the book'
      const partial = written.trim()
      if (partial.length >= 20) {
        try {
          setStatus('Saving the sections that were written…')
          await saveBook(partial)
          setErr(`${message} The sections already written were saved.`)
          setStatus(`Saved the sections that were written · ${shortModelLabel(model)}`)
        } catch {
          setErr(message)
          setStatus('')
        }
      } else {
        setErr(message)
        setStatus('')
      }
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
        Each run reads the saved local notes six at a time, refreshes the prices, and writes the
        book in three short passes: the weights, why those names now, then the 12-month path.
        The note is saved with the portfolio recommendations.
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
      {(note || draft) && (
        <article
          className={styles.noteBody}
          dangerouslySetInnerHTML={{ __html: renderMd([note, draft].filter(Boolean).join('\n\n')) }}
        />
      )}
    </section>
  )
}
