import { useEffect, useMemo, useState } from 'react'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import styles from './PodcastCleanup.module.css'

type ShowRow = {
  channel: string
  episodes: number
  bytes: number
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) {
    const kb = n / 1024
    return `${kb >= 10 ? Math.round(kb) : kb.toFixed(1)} KB`
  }
  const mb = n / (1024 * 1024)
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`
}

export function PodcastCleanup({ onChanged }: { onChanged: () => void }) {
  const [shows, setShows] = useState<ShowRow[]>([])
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  const load = async () => {
    setLoading(true)
    setErr('')
    try {
      const data = await api<{ shows?: ShowRow[] }>('/api/transcripts/cleanup')
      const rows = Array.isArray(data.shows) ? data.shows : []
      setShows(rows)
      setPicked({})
    } catch (e) {
      setShows([])
      setErr(e instanceof Error ? e.message : 'Could not list stored podcasts.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const selected = useMemo(
    () => shows.filter((row) => picked[row.channel]),
    [shows, picked],
  )
  const selectedBytes = selected.reduce((n, row) => n + (row.bytes || 0), 0)
  const allOn = shows.length > 0 && selected.length === shows.length

  const toggle = (channel: string) => {
    setPicked((cur) => ({ ...cur, [channel]: !cur[channel] }))
    setNote('')
  }

  const remove = async () => {
    if (!selected.length || busy) return
    const names = selected.map((row) => row.channel)
    const episodes = selected.reduce((n, row) => n + (row.episodes || 0), 0)
    const label = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
    const ok = window.confirm(
      `Delete the stored transcripts for ${label}? ${episodes} episode${episodes === 1 ? '' : 's'}, ${formatBytes(selectedBytes)}. Earnings calls stay.`,
    )
    if (!ok) return
    setBusy(true)
    setErr('')
    setNote('')
    try {
      const data = await api<{ episodes?: number; bytes?: number }>(
        '/api/transcripts/cleanup',
        { method: 'POST', body: JSON.stringify({ channels: names }) },
      )
      const n = data.episodes || 0
      setNote(
        n
          ? `Removed ${n} episode${n === 1 ? '' : 's'} (${formatBytes(data.bytes || 0)}).`
          : 'Nothing matched those shows.',
      )
      await load()
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not delete those shows.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Clean up stored podcasts" badge="Database">
      <p className={styles.hint}>
        Select stored shows. This removes their transcripts from the library and the
        database. Earnings calls are left alone.
      </p>
      {err && <p className={styles.err}>{err}</p>}
      {note && <p className={styles.note}>{note}</p>}
      {loading ? (
        <p className={styles.hint}>Checking stored shows…</p>
      ) : shows.length === 0 ? (
        <p className={styles.hint}>No podcast transcripts are stored.</p>
      ) : (
        <>
          <label className={styles.all}>
            <input
              type="checkbox"
              checked={allOn}
              onChange={() => {
                setNote('')
                if (allOn) setPicked({})
                else setPicked(Object.fromEntries(shows.map((row) => [row.channel, true])))
              }}
            />
            Select all
          </label>
          <ul className={styles.list}>
            {shows.map((row) => (
              <li key={row.channel}>
                <label className={styles.row}>
                  <input
                    type="checkbox"
                    checked={!!picked[row.channel]}
                    onChange={() => toggle(row.channel)}
                  />
                  <span className={styles.name}>{row.channel}</span>
                  <span className={styles.meta}>
                    {row.episodes} episode{row.episodes === 1 ? '' : 's'} · {formatBytes(row.bytes)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <Button
              variant="danger"
              size="sm"
              disabled={!selected.length || busy}
              onClick={() => void remove()}
            >
              {busy
                ? 'Deleting…'
                : selected.length
                  ? `Delete selected · ${formatBytes(selectedBytes)}`
                  : 'Delete selected'}
            </Button>
          </div>
        </>
      )}
    </Panel>
  )
}
