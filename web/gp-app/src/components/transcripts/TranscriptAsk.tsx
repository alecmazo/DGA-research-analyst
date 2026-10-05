import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { ollamaChat, ollamaStatus, LOCAL_MODEL } from '@/lib/localOllama'
import { renderMd } from '@/lib/md'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import type { OpenTranscript } from './LibraryTree'
import styles from './TranscriptAsk.module.css'

type Scope = 'open' | 'chosen'

type AskSource = {
  kind: 'interview' | 'call'
  id?: string
  ticker?: string
  quarter?: string
  label: string
}

type LibraryItem = { id?: string; label?: string; ticker?: string; quarter?: string }
type LibraryFolder = { label: string; items: LibraryItem[] }
type Library = {
  interviews?: LibraryFolder[]
  watchlist_calls?: LibraryFolder[]
  other_calls?: LibraryFolder[]
  calls?: LibraryFolder[]
}

type EngineId = 'local' | 'grok' | 'claude' | 'deepseek'

const ENGINES: { id: EngineId; label: string; via: string }[] = [
  {
    id: 'local',
    label: `Local · ${LOCAL_MODEL}`,
    via: `This Mac · Ollama · ${LOCAL_MODEL} · not an API call`,
  },
  { id: 'grok', label: 'Grok · grok-4.7', via: 'xAI API · grok-4.7' },
  { id: 'claude', label: 'Claude', via: 'Anthropic API' },
  { id: 'deepseek', label: 'DeepSeek', via: 'DeepSeek API' },
]

function sourceKey(doc: OpenTranscript): string {
  return doc.kind === 'interview' ? `i:${doc.id}` : `c:${doc.ticker}:${doc.quarter}`
}

function sourceOf(doc: OpenTranscript): AskSource {
  if (doc.kind === 'interview') return { kind: 'interview', id: doc.id, label: doc.label }
  return { kind: 'call', ticker: doc.ticker, quarter: doc.quarter, label: doc.label }
}

function askBody(question: string, scope: Scope, openDoc: OpenTranscript | null | undefined, picks: OpenTranscript[]): AskSource[] | Record<string, unknown> {
  const body: Record<string, unknown> = { question, scope }
  if (scope === 'chosen') {
    body.sources = picks.slice(0, 8).map(sourceOf)
    return body
  }
  if (openDoc?.kind === 'call') {
    body.ticker = openDoc.ticker
    body.quarter = openDoc.quarter
    body.open_label = openDoc.label
  } else if (openDoc?.kind === 'interview') {
    body.interview_id = openDoc.id
    body.open_label = openDoc.label
  }
  return body
}

type AskPacket = { n?: number; of?: number; label?: string; text?: string }
type PacketPack = {
  mode?: string
  system?: string
  stitch_system?: string
  user?: string
  packets?: AskPacket[]
}

const NOTE_BUDGET = 12000

function sectionUser(question: string, packet: AskPacket): string {
  const n = packet.n || 1
  const total = packet.of || 1
  const label = packet.label ? ` (${packet.label})` : ''
  return `Question: ${question}\n\nSection ${n} of ${total}${label}:\n${packet.text || ''}`
}

function keepSectionNote(text: string): boolean {
  const note = text.trim()
  return Boolean(note) && !/^nothing in this section\b/i.test(note)
}

async function stitchSaved(
  question: string,
  system: string,
  notes: string[],
  onProgress: (text: string) => void,
): Promise<string> {
  const promptFor = (blocks: string[]) =>
    `Question: ${question}\n\nSaved section notes:\n\n${blocks.join('\n\n')}\n\nWrite one answer from these notes only. Keep every company and fact. Drop a note that says nothing was in that section. If a note says the section stopped, say that part did not finish. Do not invent.`
  const run = async (blocks: string[]) => {
    const chat = await ollamaChat({
      system: system || 'Combine saved transcript section notes into one answer. Do not invent.',
      user: promptFor(blocks),
      maxTokens: 1600,
      numCtx: 8192,
    })
    return (chat.text || '').trim()
  }
  let blocks = notes
    .map((note, i) => `Section ${i + 1}:\n${note.trim()}`)
    .filter((block) => block.trim().length > 10)
  if (!blocks.length) return ''
  let guard = 0
  while (blocks.join('\n\n').length > NOTE_BUDGET && blocks.length > 1 && guard < 6) {
    guard += 1
    const groups: string[][] = []
    let buf: string[] = []
    let size = 0
    for (const block of blocks) {
      if (buf.length && size + block.length > NOTE_BUDGET) {
        groups.push(buf)
        buf = []
        size = 0
      }
      buf.push(block)
      size += block.length + 2
    }
    if (buf.length) groups.push(buf)
    const next: string[] = []
    for (let g = 0; g < groups.length; g++) {
      onProgress(`Stitching saved sections, batch ${g + 1} of ${groups.length}…`)
      try {
        next.push((await run(groups[g])) || groups[g].join('\n\n'))
      } catch {
        next.push(groups[g].join('\n\n'))
      }
    }
    if (next.length >= blocks.length) break
    blocks = next.map((note, i) => `Batch ${i + 1}:\n${note}`)
  }
  onProgress('Stitching the saved sections into one answer…')
  try {
    return (await run(blocks)) || blocks.join('\n\n')
  } catch {
    return blocks.join('\n\n')
  }
}

function rowsFrom(folders: LibraryFolder[] | undefined, kind: 'interview' | 'call'): OpenTranscript[] {
  const out: OpenTranscript[] = []
  const seen = new Set<string>()
  for (const folder of folders || []) {
    for (const item of folder.items || []) {
      const doc: OpenTranscript | null =
        kind === 'interview' && item.id
          ? { kind: 'interview', id: item.id, label: item.label || item.id }
          : kind === 'call' && item.ticker && item.quarter
            ? {
                kind: 'call',
                ticker: item.ticker,
                quarter: item.quarter,
                label: `${item.ticker} · ${item.label || item.quarter}`,
              }
            : null
      if (!doc) continue
      const key = sourceKey(doc)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(doc)
    }
  }
  return out
}

export function TranscriptAsk({ openDoc }: { openDoc?: OpenTranscript | null }) {
  const [engine, setEngine] = useState<EngineId>('local')
  const [scope, setScope] = useState<Scope>('open')
  const [picks, setPicks] = useState<Record<string, OpenTranscript>>({})
  const [library, setLibrary] = useState<Library | null>(null)
  const [libErr, setLibErr] = useState('')
  const [filter, setFilter] = useState('')
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [used, setUsed] = useState('')

  const chosen = ENGINES.find((row) => row.id === engine) || ENGINES[0]
  const selected = Object.values(picks)
  const openKey = openDoc ? sourceKey(openDoc) : ''

  useEffect(() => {
    if (scope !== 'chosen' || library || libErr) return
    let cancel = false
    api<Library>('/api/transcripts/library')
      .then((data) => {
        if (!cancel) setLibrary(data)
      })
      .catch((e) => {
        if (!cancel) setLibErr(e instanceof Error ? e.message : 'Could not load the library')
      })
    return () => {
      cancel = true
    }
  }, [scope, library, libErr])

  const interviews = useMemo(() => rowsFrom(library?.interviews, 'interview'), [library])
  const watchCalls = useMemo(() => rowsFrom(library?.watchlist_calls, 'call'), [library])
  const otherCalls = useMemo(
    () => rowsFrom(library?.other_calls ?? library?.calls, 'call'),
    [library],
  )
  const needle = filter.trim().toLowerCase()
  const visible = (rows: OpenTranscript[]) =>
    needle ? rows.filter((row) => row.label.toLowerCase().includes(needle)) : rows

  const useChosen = () => {
    setScope('chosen')
    if (!openDoc) return
    const key = sourceKey(openDoc)
    setPicks((prev) => {
      if (prev[key] || Object.keys(prev).length >= 8) return prev
      return { ...prev, [key]: openDoc }
    })
  }

  const toggle = (doc: OpenTranscript) => {
    const key = sourceKey(doc)
    setPicks((prev) => {
      if (prev[key]) {
        const next = { ...prev }
        delete next[key]
        return next
      }
      if (Object.keys(prev).length >= 8) return prev
      return { ...prev, [key]: doc }
    })
  }

  const ask = async () => {
    const q = question.trim()
    if (q.length < 4) return
    if (scope === 'chosen' && selected.length === 0) return
    setBusy(true)
    setProgress('')
    setErr(null)
    setAnswer('')
    try {
      const body = askBody(q, scope, openDoc, selected)
      const context = scope === 'chosen'
        ? `${selected.length} chosen transcript${selected.length === 1 ? '' : 's'}`
        : openDoc
          ? 'the open transcript'
          : 'the library'
      if (engine === 'local') {
        const health = await ollamaStatus()
        if (!health.ok) throw new Error(health.message)
        const pack = await api<PacketPack>(
          '/api/transcripts/ask-context',
          { method: 'POST', body: JSON.stringify({ ...body, packets: true }) },
        )
        if (pack.mode === 'packets') {
          const packets = (pack.packets || []).filter((packet) => (packet.text || '').trim())
          if (!packets.length) throw new Error('No transcript text is stored for that selection')
          const saved: string[] = []
          for (let i = 0; i < packets.length; i++) {
            const packet = packets[i]
            setProgress(`Reading section ${packet.n || i + 1} of ${packet.of || packets.length}…`)
            try {
              const chat = await ollamaChat({
                system: pack.system || '',
                user: sectionUser(q, packet),
                maxTokens: 900,
                numCtx: 8192,
              })
              const note = (chat.text || '').trim()
              if (keepSectionNote(note)) saved.push(note)
              else if (!note) saved.push(`(Section ${packet.n || i + 1} stopped before it finished.)`)
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'the section stopped'
              saved.push(`(Section ${packet.n || i + 1} stopped before it finished: ${msg}.)`)
            }
          }
          const notes = saved.filter(keepSectionNote)
          const via = `${chosen.via} · ${context} · ${packets.length} section${packets.length === 1 ? '' : 's'}`
          if (!notes.length) {
            setAnswer('Nothing in this transcript answers that.')
            setUsed(via)
          } else if (notes.length === 1) {
            setAnswer(notes[0])
            setUsed(via)
          } else {
            setProgress(`Stitching ${notes.length} saved sections…`)
            const stitched = await stitchSaved(q, pack.stitch_system || '', notes, setProgress)
            setAnswer(stitched || notes.map((note, i) => `Section ${i + 1}\n${note}`).join('\n\n'))
            setUsed(`${via} stitched`)
          }
        } else {
          if (!pack.system || !pack.user) throw new Error('Could not load transcript excerpts')
          const chat = await ollamaChat({ system: pack.system, user: pack.user, maxTokens: 2500 })
          if (!chat.text) throw new Error('The local model returned an empty answer')
          setAnswer(chat.text)
          setUsed(`${chosen.via} · ${context}`)
        }
      } else {
        const data = await api<{ answer?: string; via?: string; model?: string; detail?: string }>(
          '/api/transcripts/ask',
          { method: 'POST', body: JSON.stringify({ ...body, provider: engine }) },
        )
        if (!data.answer) throw new Error(data.detail || 'No answer')
        setAnswer(data.answer)
        setUsed(`${data.model ? `${chosen.via} · ${data.model}` : chosen.via} · ${context}`)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not answer')
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  const about = scope === 'chosen'
    ? selected.length
      ? `Answering from ${selected.length} chosen transcript${selected.length === 1 ? '' : 's'}.`
      : 'Choose at least one transcript. The engine reads only those.'
    : openDoc
      ? `Answering from the open transcript: ${openDoc.label}.`
      : 'No transcript is open. This searches the library, or choose transcripts instead.'

  const groups = [
    ['Interviews', visible(interviews)],
    ['Earnings calls from watchlist', visible(watchCalls)],
    ['Earnings calls', visible(otherCalls)],
  ] as const

  return (
    <Panel title="Ask a question" badge={chosen.via}>
      <p className={styles.via}>Using {chosen.via}.</p>
      <p className={styles.about}>{about}</p>
      <div className={styles.scope} role="radiogroup" aria-label="Which transcripts to read">
        <label>
          <input
            type="radio"
            name="ask-scope"
            checked={scope === 'open'}
            disabled={busy}
            onChange={() => setScope('open')}
          />
          Open transcript
        </label>
        <label>
          <input
            type="radio"
            name="ask-scope"
            checked={scope === 'chosen'}
            disabled={busy}
            onChange={useChosen}
          />
          Choose transcripts
        </label>
      </div>
      {scope === 'chosen' && (
        <>
          <p className={styles.about}>Up to 8. The chosen engine answers from these only.</p>
          {openDoc && !picks[openKey] && (
            <button
              type="button"
              className={styles.addOpen}
              disabled={busy || selected.length >= 8}
              onClick={useChosen}
            >
              Add the open transcript
            </button>
          )}
          <input
            className={styles.filter}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter the transcripts to include"
            aria-label="Filter transcripts to include"
            disabled={busy}
          />
          <div className={styles.picker}>
            {libErr && <p className={styles.err}>{libErr}</p>}
            {!library && !libErr && <p className={styles.about}>Loading the library…</p>}
            {groups.map(([title, rows]) => (
              <div key={title}>
                <p className={styles.group}>{title}</p>
                {rows.length === 0 && <p className={styles.about}>None.</p>}
                {rows.map((doc) => {
                  const key = sourceKey(doc)
                  const on = Boolean(picks[key])
                  return (
                    <label key={key} className={styles.check}>
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={busy || (!on && selected.length >= 8)}
                        onChange={() => toggle(doc)}
                      />
                      <span>{doc.label}</span>
                    </label>
                  )
                })}
              </div>
            ))}
          </div>
        </>
      )}
      <div className={styles.row}>
        <label className={styles.lbl}>
          Engine
          <select
            value={engine}
            onChange={(e) => setEngine(e.target.value as EngineId)}
            disabled={busy}
            aria-label="Which engine answers"
          >
            {ENGINES.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={3}
        placeholder="What did BSX say about 2026 guidance?"
        disabled={busy}
        aria-label="Question"
      />
      <div className={styles.row}>
        <Button
          variant="primary"
          size="sm"
          disabled={busy || question.trim().length < 4 || (scope === 'chosen' && selected.length === 0)}
          onClick={() => void ask()}
        >
          {busy ? 'Answering…' : 'Ask'}
        </Button>
      </div>
      {busy && progress && <p className={styles.about} role="status">{progress}</p>}
      {err && <p className={styles.err}>{err}</p>}
      {used && answer && <p className={styles.used}>Answered with {used}.</p>}
      {answer && (
        <div className={styles.answer} dangerouslySetInnerHTML={{ __html: renderMd(answer) }} />
      )}
    </Panel>
  )
}
