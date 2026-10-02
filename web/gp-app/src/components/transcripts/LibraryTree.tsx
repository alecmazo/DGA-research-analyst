import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  watchlist_calls?: Folder<CallItem>[]
  other_calls?: Folder<CallItem>[]
  error?: string
}

export type OpenTranscript =
  | { kind: 'interview'; id: string; label: string }
  | { kind: 'call'; ticker: string; quarter: string; label: string }

type Selection = OpenTranscript

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

function readFailure(error: unknown): string {
  const msg = error instanceof Error ? error.message : 'Could not open that transcript'
  if (msg.toLowerCase().includes('connection already closed')) {
    return 'The transcript is stored, but the reader lost the connection. Open it again.'
  }
  return msg
}

function interviewPresent(data: Library | null, id: string): boolean {
  return (data?.interviews || []).some((folder) =>
    (folder.items || []).some((item) => item.id === id),
  )
}

export function LibraryTree({
  onOpen,
  focusId,
  focusNonce = 0,
  reloadKey = 0,
}: {
  onOpen?: (next: OpenTranscript) => void
  focusId?: string | null
  focusNonce?: number
  reloadKey?: number
}) {
  const [lib, setLib] = useState<Library | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({
    interviews: true,
    watchCalls: true,
    calls: true,
  })
  const [sel, setSel] = useState<Selection | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [reading, setReading] = useState(false)
  const [readErr, setReadErr] = useState<string | null>(null)
  const readGen = useRef(0)
  const selRef = useRef<Selection | null>(null)
  selRef.current = sel
  const [busyTk, setBusyTk] = useState<string | null>(null)
  const [refreshTk, setRefreshTk] = useState<string | null>(null)
  const [refreshNote, setRefreshNote] = useState('')

  const load = useCallback(async () => {
    const data = await api<Library>('/api/transcripts/library')
    setLib(data)
    return data
  }, [])

  useEffect(() => {
    let cancel = false
    load()
      .catch((e) => {
        if (!cancel) setErr(e instanceof Error ? e.message : 'Could not load the library')
      })
      .finally(() => {
        if (!cancel) setLoading(false)
      })
    return () => {
      cancel = true
    }
  }, [load])

  useEffect(() => {
    if (!reloadKey) return
    let cancel = false
    load()
      .then((data) => {
        if (cancel) return
        const cur = selRef.current
        if (cur?.kind === 'interview' && !interviewPresent(data, cur.id)) {
          setSel(null)
          setDetail(null)
          setReadErr(null)
        }
      })
      .catch((e) => {
        if (!cancel) setErr(e instanceof Error ? e.message : 'Could not load the library')
      })
    return () => {
      cancel = true
    }
  }, [reloadKey, load])

  const refreshCalls = async (ticker: string) => {
    setBusyTk(ticker)
    setRefreshTk(ticker)
    setErr(null)
    setRefreshNote(`Refreshing ${ticker}…`)
    let finalNote = ''
    let settled = false
    try {
      const job = await api<{ job_id?: string; error?: string }>('/api/transcripts/calls/sync', {
        method: 'POST',
        body: JSON.stringify({
          tickers: [ticker],
          max_quarters: 6,
          max_names: 1,
          missing_only: false,
          allow_grok: 0,
          prefer_stale: false,
          include_current: true,
        }),
      })
      if (!job.job_id) throw new Error(job.error || 'Could not start the refresh')
      for (let i = 0; i < 150; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        const st = await api<{ status?: string; label?: string; error?: string }>(
          `/api/transcripts/calls/sync/${encodeURIComponent(job.job_id)}`,
        )
        setRefreshNote(st.label || `Refreshing ${ticker}…`)
        const status = st.status || ''
        if (status === 'done' || status === 'failed' || status === 'error' || status === 'canceled') {
          settled = true
          if (status !== 'done') setErr(st.error || st.label || `${ticker} refresh failed`)
          finalNote = st.label || `${ticker} refresh finished`
          break
        }
      }
      if (!settled) {
        finalNote = `${ticker} refresh is still running. New quarters show up here when it finishes.`
      }
      await load()
      setRefreshNote(finalNote)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Refresh failed')
      setRefreshNote('')
    } finally {
      setBusyTk(null)
    }
  }

  const q = query.trim().toLowerCase()
  const interviews = useMemo(() => filterFolders(lib?.interviews || [], q), [lib, q])
  const watchCalls = useMemo(
    () => filterFolders(lib?.watchlist_calls || [], q),
    [lib, q],
  )
  const otherCalls = useMemo(
    () => filterFolders(lib?.other_calls || (lib?.watchlist_calls ? [] : lib?.calls || []), q),
    [lib, q],
  )

  const openItem = (next: Selection) => {
    const gen = ++readGen.current
    setSel(next)
    onOpen?.(next)
    setDetail(null)
    setReadErr(null)
    setReading(true)
    const path =
      next.kind === 'interview'
        ? `/api/transcripts/${encodeURIComponent(next.id)}`
        : `/api/transcripts/calls/read?ticker=${encodeURIComponent(next.ticker)}&quarter=${encodeURIComponent(next.quarter)}`
    api<Record<string, unknown>>(path)
      .then((data) => {
        if (readGen.current !== gen) return
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
        if (readGen.current !== gen) return
        setReadErr(readFailure(e))
      })
      .finally(() => {
        if (readGen.current === gen) setReading(false)
      })
  }
  const openRef = useRef(openItem)
  openRef.current = openItem

  useEffect(() => {
    if (!focusNonce || !focusId) return
    let cancel = false
    load()
      .then((data) => {
        if (cancel) return
        let label = focusId
        let folder = ''
        for (const group of data?.interviews || []) {
          const hit = (group.items || []).find((item) => item.id === focusId)
          if (hit) {
            label = hit.label || focusId
            folder = group.label
            break
          }
        }
        if (folder) {
          setOpen((prev) => ({ ...prev, interviews: true, [`i:${folder}`]: true }))
        }
        openRef.current({ kind: 'interview', id: focusId, label })
      })
      .catch(() => {})
    return () => {
      cancel = true
    }
  }, [focusNonce, focusId, load])

  const toggle = (key: string) => {
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const callFolders = (folders: Folder<CallItem>[], prefix: string) =>
    folders.map((folder) => (
      <FolderBlock
        key={`${prefix}-${folder.label}`}
        folderKey={`${prefix}:${folder.label}`}
        label={folder.label}
        count={folder.items.length}
        open={!!open[`${prefix}:${folder.label}`]}
        onToggle={() => toggle(`${prefix}:${folder.label}`)}
        onRefresh={() => void refreshCalls(folder.label)}
        refreshing={busyTk === folder.label}
        note={refreshTk === folder.label ? refreshNote : ''}
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
    ))

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
              title="Earnings calls from watchlist"
              count={countItems(lib.watchlist_calls)}
              open={open.watchCalls !== false}
              onToggle={() => toggle('watchCalls')}
            >
              {watchCalls.length === 0 && (
                <p className={styles.empty}>
                  {q ? 'No match in the watchlist.' : 'No earnings calls indexed for the watchlist yet.'}
                </p>
              )}
              {callFolders(watchCalls, 'w')}
            </Section>
            <Section
              title="Earnings calls"
              count={countItems(lib.other_calls ?? lib.calls)}
              open={open.calls !== false}
              onToggle={() => toggle('calls')}
            >
              {otherCalls.length === 0 && (
                <p className={styles.empty}>
                  {q ? 'No match in the other calls.' : 'No other earnings calls indexed yet.'}
                </p>
              )}
              {callFolders(otherCalls, 'c')}
            </Section>
          </>
        )}
      </div>
      <div className={styles.reader}>
        {!sel && (
          <Empty
            title="Pick a transcript"
            sub="Interviews are grouped by show. Watchlist earnings calls are listed first, then every other company."
          />
        )}
        {sel && reading && <Spinner label="Opening…" />}
        {sel && !reading && !detail && readErr && (
          <>
            <h3>{sel.label}</h3>
            <p className={styles.err}>{readErr}</p>
          </>
        )}
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
  onRefresh,
  refreshing,
  note,
  children,
}: {
  folderKey: string
  label: string
  count: number
  open: boolean
  onToggle: () => void
  onRefresh?: () => void
  refreshing?: boolean
  note?: string
  children: ReactNode
}) {
  return (
    <div>
      <div className={styles.folderRow}>
        <button type="button" className={styles.folder} onClick={onToggle} aria-expanded={open}>
          <span>{open ? '▾' : '▸'}</span>
          {label}
          <em>{count}</em>
        </button>
        {open && onRefresh && (
          <button
            type="button"
            className={styles.refresh}
            disabled={refreshing}
            onClick={onRefresh}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>
      {open && note && <p className={styles.note}>{note}</p>}
      {open && <div className={styles.items}>{children}</div>}
    </div>
  )
}
