import { useState } from 'react'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { ApiError, api } from '@/lib/api'
import { trackLoad } from '@/lib/loadFlow'
import { OLLAMA_DESK } from '@/lib/localOllama'
import styles from './ShowFinder.module.css'

type ShowHit = {
  collection_id: string
  name: string
  author?: string
}

type EpisodeHit = {
  key: string
  title: string
  published?: string
  stored_id?: string
}

type PullResult = {
  ok?: boolean
  id?: string
  title?: string
  already?: boolean
  error?: string
  video_id?: string
}

function videoIdFrom(err: unknown): string {
  if (!(err instanceof ApiError) || err.status !== 404) return ''
  const body = err.body
  if (!body || typeof body !== 'object' || !('video_id' in body)) return ''
  const id = String((body as { video_id?: unknown }).video_id || '')
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : ''
}

/** YouTube blocks the server. The helper on this Mac can still read captions. */
async function macCaptions(videoId: string): Promise<string> {
  const done = trackLoad('ollama://captions')
  try {
    const res = await fetch(`${OLLAMA_DESK}/captions?v=${encodeURIComponent(videoId)}`)
    if (!res.ok) {
      done('fail', `HTTP ${res.status}`)
      return ''
    }
    const data = (await res.json()) as { ok?: boolean; text?: string }
    const text = typeof data.text === 'string' ? data.text : ''
    if (!data.ok || text.length < 800) {
      done('fail', 'No captions')
      return ''
    }
    done('ok')
    return text
  } catch {
    done('fail', 'Captions did not respond')
    return ''
  }
}

export function ShowFinder({ onOpen }: { onOpen: (id: string) => void }) {
  const [term, setTerm] = useState('')
  const [shows, setShows] = useState<ShowHit[]>([])
  const [show, setShow] = useState<ShowHit | null>(null)
  const [episodes, setEpisodes] = useState<EpisodeHit[]>([])
  const [busy, setBusy] = useState<'search' | 'episodes' | 'pull' | null>(null)
  const [pullKey, setPullKey] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')

  const search = async () => {
    const q = term.trim()
    if (q.length < 2) {
      setErr('Type at least two characters.')
      return
    }
    setBusy('search')
    setErr('')
    setNote('')
    setShow(null)
    setEpisodes([])
    try {
      const data = await api<{ shows?: ShowHit[] }>(
        `/api/transcripts/shows/search?q=${encodeURIComponent(q)}`,
      )
      const rows = Array.isArray(data.shows) ? data.shows : []
      setShows(rows)
      if (!rows.length) setNote('No shows matched that search.')
    } catch (e) {
      setShows([])
      setErr(e instanceof Error ? e.message : 'Show search did not respond.')
    } finally {
      setBusy(null)
    }
  }

  const openShow = async (next: ShowHit) => {
    setShow(next)
    setEpisodes([])
    setBusy('episodes')
    setErr('')
    setNote('')
    try {
      const data = await api<{ name?: string; author?: string; episodes?: EpisodeHit[] }>(
        `/api/transcripts/shows/${encodeURIComponent(next.collection_id)}/episodes`,
      )
      setEpisodes(Array.isArray(data.episodes) ? data.episodes : [])
      if (!data.episodes?.length) setNote('This feed has no recent episodes.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That show could not be opened.')
    } finally {
      setBusy(null)
    }
  }

  const pull = async (episode: EpisodeHit) => {
    if (!show) return
    if (episode.stored_id) {
      onOpen(episode.stored_id)
      setNote('Already in the library. Opened on the right.')
      return
    }
    setBusy('pull')
    setPullKey(episode.key)
    setErr('')
    setNote('Pulling the transcript…')
    const url = `/api/transcripts/shows/${encodeURIComponent(show.collection_id)}/pull`
    const store = (extra?: { captions: string; video_id: string }) =>
      api<PullResult>(url, {
        method: 'POST',
        body: JSON.stringify({ key: episode.key, ...extra }),
      })
    const opened = (data: PullResult) => {
      if (!data.id) throw new Error(data.error || 'That episode did not come back with a transcript.')
      setEpisodes((prev) =>
        prev.map((row) => (row.key === episode.key ? { ...row, stored_id: data.id } : row)),
      )
      setNote(data.already ? 'Already in the library. Opened on the right.' : 'Pulled in. Opened on the right.')
      onOpen(data.id)
    }
    try {
      opened(await store())
    } catch (e) {
      const videoId = videoIdFrom(e)
      if (!videoId) {
        setNote('')
        setErr(e instanceof Error ? e.message : 'Could not pull that episode.')
        return
      }
      setNote('Reading captions on this Mac…')
      try {
        const text = await macCaptions(videoId)
        if (!text) {
          setNote('')
          const message = e instanceof Error ? e.message : 'Could not pull that episode.'
          setErr(`${message} Captions were not read on this Mac. Start the local helper, then pull again.`)
          return
        }
        opened(await store({ captions: text, video_id: videoId }))
      } catch (second) {
        setNote('')
        setErr(second instanceof Error ? second.message : 'Could not pull that episode.')
      }
    } finally {
      setBusy(null)
      setPullKey('')
    }
  }

  return (
    <Panel title="Find a show">
      <p className={styles.hint}>
        Search uses Apple’s podcast directory for the RSS feed. Pull reads a
        transcript file from that feed, then the publisher’s transcript. When
        those are missing, YouTube captions are read on this Mac. Spotify does
        not offer a free transcript. Episodes already stored open immediately.
      </p>
      <form
        className={styles.search}
        onSubmit={(e) => {
          e.preventDefault()
          void search()
        }}
      >
        <input
          className={styles.input}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Show name"
          aria-label="Search shows"
        />
        <Button type="submit" variant="primary" size="sm" disabled={busy !== null}>
          {busy === 'search' ? 'Searching…' : 'Search'}
        </Button>
      </form>
      {err && <p className={styles.err}>{err}</p>}
      {note && <p className={styles.note}>{note}</p>}
      {shows.length > 0 && (
        <ul className={styles.shows}>
          {shows.map((row) => {
            const on = show?.collection_id === row.collection_id
            return (
              <li key={row.collection_id}>
                <button
                  type="button"
                  className={styles.show}
                  data-on={on ? '1' : '0'}
                  disabled={busy === 'episodes' || busy === 'pull'}
                  onClick={() => void openShow(row)}
                >
                  <strong>{row.name}</strong>
                  {row.author ? <span> · {row.author}</span> : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {show && episodes.length > 0 && (
        <ul className={styles.episodes}>
          {episodes.map((episode) => {
            const stored = Boolean(episode.stored_id)
            const pulling = busy === 'pull' && pullKey === episode.key
            return (
              <li key={episode.key} className={styles.episode}>
                <span className={styles.day}>{episode.published || '—'}</span>
                <span className={styles.title}>{episode.title}</span>
                <Button
                  size="sm"
                  variant={stored ? 'secondary' : 'primary'}
                  disabled={busy !== null}
                  onClick={() => void pull(episode)}
                >
                  {pulling ? 'Pulling…' : stored ? 'Open' : 'Pull in'}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
