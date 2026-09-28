import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '@/lib/api'
import { Empty, Spinner } from '@/components/ui/Empty'
import styles from './LibraryTree.module.css'

type InterviewItem = {
  id?: string
  label?: string
  person?: string
  words?: number | null
  url?: string
}

type CallItem = {
  ticker?: string
  quarter?: string
  label?: string
  call_date?: string
  source?: string
  chunks?: number
}

type Folder<T> = {
  label: string
  count: number
  items: T[]
}

type Library = {
  ok?: boolean
  enabled?: boolean
  interviews?: Folder<InterviewItem>[]
  calls?: Folder<CallItem>[]
  error?: string
}

type Selection =
  | { kind: 'interview'; id: string; label: string }
  | { kind: 'call'; ticker: string; quarter: string; label: string }

type Detail = {
  title?: string
  summary?: string
  text?: string
  url?: string
  entities?: { company?: string; ticker?: string; sentiment?: string; quote?: string }[]
}

function countItems<T>(folders: Folder<T>[] | undefined): number {
  return (folders || []).reduce((n, folder) => n + (folder.count || folder.items.length), 0)
}

function matches(hay: string, q: string): boolean {
  return hay.toLowerCase().includes(q)
}

export function LibraryTree() {
  const [lib, setLib] = useState<Library | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({
    interviews: true,
    calls: true,
  })
  const [sel, setSel] = useState<Selection | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [reading, setReading] = useState(false)

  useEffect(() => {
    let cancel = false
    api<Library>('/api/transcripts/library')
      .then((data) => {
        if (!cancel) setLib(data)
      })
      .catch((e) => {
        if (!cancel) setErr(e instanceof Error ? e.message : 'Could not load the library')
      })
      .finally(() => {
        if (!cancel) setLoading(false)
      })
    return () => {
      cancel = true
    }
  }, [])

  const q = query.trim().toLowerCase()
  const interviews = useMemo(() => filterFolders(lib?.interviews || [], q), [lib, q])
  const calls = useMemo(() => filterFolders(lib?.calls || [], q), [lib, q])

  const openItem = (next: Selection) => {
    setSel(next)
    setDetail(null)
    setReading(true)
    const path =
      next.kind === 'interview'
        ? `/api/transcripts/${encodeURIComponent(next.id)}`
        : `/api/transcripts/calls/read?ticker=${encodeURIComponent(next.ticker)}&quarter=${encodeURIComponent(next.quarter)}`
    api<Record<string, unknown>>(path)
      .then((data) => {
        if (next.kind === 'interview') {
          const t = (data.transcript || {}) as Record<string, unknown>
          setDetail({
            title: String(t.title || next.label),
            summary: String(t.summary || ''),
            text: String(t.full_text || ''),
            url: String(t.video_url || ''),
            entities: Array.isArray(data.entities) ? data.entities as Detail['entities'] : [],
          })
        } else {
          setDetail({
            title: next.label,
            text: String(data.text || ''),
            summary: String(data.note || ''),
          })
        }
      })
      .catch((e) => {
        setErr(e instanceof Error ? e.message : 'Could not open that transcript')
      })
      .finally(() => setReading(false))
  }

  const toggle = (key: string) => {
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className={styles.library} id="library">
      <div className={styles.tree}>
        <input
          className={styles.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by show, ticker, or title"
          aria-label="Filter transcripts"
        />
        {loading && <Spinner label="Loading the library…" />}
        {!loading && err && !lib && <p className={styles.err}>{err}</p>}
        {!loading && lib?.enabled === false && (
          <Empty title="Transcript library is off" sub="PODCAST_INTEL_ENABLED is false." />
        )}
        {!loading && lib && lib.enabled !== false && (
          <>
            <Section
              title="Interviews"
              count={countItems(lib.interviews)}
              open={open.interviews !== false}
              onToggle={() => toggle('interviews')}
            >
              {interviews.length === 0 && (
                <p className={styles.empty}>No interviews in the library yet.</p>
              )}
              {interviews.map((folder) => (
                <FolderBlock
                  key={`i-${folder.label}`}
                  folderKey={`i:${folder.label}`}
                  label={folder.label}
                  count={folder.items.length}
                  open={!!open[`i:${folder.label}`]}
                  onToggle={() => toggle(`i:${folder.label}`)}
                >
                  {folder.items.map((item) => {
                    const id = item.id || ''
                    const on = sel?.kind === 'interview' && sel.id === id
                    return (
                      <button
                        key={id || item.label}
                        type="button"
                        className={styles.item}
                        data-on={on ? '1' : '0'}
                        onClick={() => id && openItem({ kind: 'interview', id, label: item.label || id })}
                      >
                        {item.label}
                      </button>
                    )
                  })}
                </FolderBlock>
              ))}
            </Section>
            <Section
              title="Earnings calls"
              count={countItems(lib.calls)}
              open={open.calls !== false}
              onToggle={() => toggle('calls')}
            >
              {calls.length === 0 && (
                <p className={styles.empty}>No earnings calls indexed yet.</p>
              )}
              {calls.map((folder) => (
                <FolderBlock
                  key={`c-${folder.label}`}
                  folderKey={`c:${folder.label}`}
                  label={folder.label}
                  count={folder.items.length}
                  open={!!open[`c:${folder.label}`]}
                  onToggle={() => toggle(`c:${folder.label}`)}
                >
                  {folder.items.map((item) => {
                    const on =
                      sel?.kind === 'call' &&
                      sel.ticker === item.ticker &&
                      sel.quarter === item.quarter
                    return (
                      <button
                        key={`${item.ticker}-${item.quarter}`}
                        type="button"
                        className={styles.item}
                        data-on={on ? '1' : '0'}
                        onClick={() =>
                          item.ticker &&
                          item.quarter &&
                          openItem({
                            kind: 'call',
                            ticker: item.ticker,
                            quarter: item.quarter,
                            label: `${item.ticker} · ${item.label || item.quarter}`,
                          })
                        }
                      >
                        {item.label}
                      </button>
                    )
                  })}
                </FolderBlock>
              ))}
            </Section>
          </>
        )}
      </div>
      <div className={styles.reader}>
        {!sel && (
          <Empty
            title="Pick a transcript"
            sub="Interviews are grouped by show. Earnings calls are grouped by ticker."
          />
        )}
        {sel && reading && <Spinner label="Opening…" />}
        {sel && !reading && detail && (
          <>
            <h3>{detail.title || sel.label}</h3>
            {detail.url && (
              <a href={detail.url} target="_blank" rel="noreferrer">
                Open source
              </a>
            )}
            {detail.summary && <p className={styles.summary}>{detail.summary}</p>}
            {detail.entities && detail.entities.length > 0 && (
              <ul className={styles.ents}>
                {detail.entities.slice(0, 24).map((ent, i) => (
                  <li key={`${ent.ticker}-${i}`}>
                    <strong>{ent.ticker || ent.company || '—'}</strong>
                    {ent.sentiment ? ` · ${ent.sentiment}` : ''}
                  </li>
                ))}
              </ul>
            )}
            <pre className={styles.text}>{detail.text || 'No text stored for this item.'}</pre>
          </>
        )}
      </div>
    </div>
  )
}

function filterFolders<T extends { label?: string }>(folders: Folder<T>[], q: string): Folder<T>[] {
  if (!q) return folders
  return folders
    .map((folder) => {
      if (matches(folder.label, q)) return folder
      const items = folder.items.filter((item) => matches(item.label || '', q))
      return { ...folder, items, count: items.length }
    })
    .filter((folder) => folder.items.length > 0)
}

function Section({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string
  count: number
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section>
      <button type="button" className={styles.root} onClick={onToggle} aria-expanded={open}>
        <span>{open ? '▾' : '▸'}</span>
        <strong>{title}</strong>
        <em>{count}</em>
      </button>
      {open && <div className={styles.nest}>{children}</div>}
    </section>
  )
}

function FolderBlock({
  label,
  count,
  open,
  onToggle,
  children,
}: {
  folderKey: string
  label: string
  count: number
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div>
      <button type="button" className={styles.folder} onClick={onToggle} aria-expanded={open}>
        <span>{open ? '▾' : '▸'}</span>
        {label}
        <em>{count}</em>
      </button>
      {open && <div className={styles.items}>{children}</div>}
    </div>
  )
}
