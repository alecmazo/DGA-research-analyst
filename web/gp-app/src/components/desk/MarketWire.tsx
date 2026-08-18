import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import styles from './deskWidgets.module.css'

export type WireItem = {
  title?: string
  url?: string
  publisher?: string
  feed?: string
  pub_ts?: number | null
}

type WireResp = {
  ok?: boolean
  as_of?: string
  items?: WireItem[]
  feeds_ok?: number
  feeds_total?: number
  note?: string
  cached?: boolean
}

function ageLabel(pubTs?: number | null): string {
  if (pubTs == null) return ''
  const sec = Math.max(0, Date.now() / 1000 - Number(pubTs))
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  return `${Math.floor(sec / 86400)}d`
}

export function MarketWire({ bare = false }: { bare?: boolean }) {
  const [data, setData] = useState<WireResp | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (force = false) => {
    setBusy(true)
    setErr(null)
    try {
      const q = force ? '&refresh=1' : ''
      const d = await api<WireResp>(`/api/v2/news/market-wire?limit=14${q}`)
      setData(d)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Wire unavailable')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
    const id = window.setInterval(() => void load(false), 5 * 60_000)
    return () => window.clearInterval(id)
  }, [load])

  const items = data?.items || []
  const body = (
    <div className={styles.wireEmbed}>
      <div className={styles.wireToolbar}>
        <span className={styles.wireHint}>
          {data?.as_of ? `as of ${data.as_of}` : busy ? 'Loading…' : '—'}
          {data?.feeds_ok != null && data?.feeds_total != null
            ? ` · ${data.feeds_ok}/${data.feeds_total} feeds`
            : ''}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => void load(true)}
        >
          {busy ? '…' : '↻'}
        </Button>
      </div>
      <div className={styles.wireList}>
        {err && <div className={styles.wireEmpty}>{err}</div>}
        {!err && !items.length && (
          <div className={styles.wireEmpty}>
            {busy
              ? 'Loading official + wire headlines…'
              : 'No high-signal items in the last 48h.'}
          </div>
        )}
        {items.map((it, i) => {
          const src = it.feed || it.publisher || 'Wire'
          const age = ageLabel(it.pub_ts)
          return (
            <a
              key={`${it.url || it.title || i}-${i}`}
              className={styles.wireRow}
              href={it.url || '#'}
              target="_blank"
              rel="noopener noreferrer"
            >
              <div className={styles.wireTitle}>{it.title || '—'}</div>
              <div className={styles.wireMeta}>
                <span className={styles.wireChip}>{src}</span>
                {age ? <span>{age} ago</span> : null}
              </div>
            </a>
          )
        })}
      </div>
      <div className={styles.wireFoot}>
        Fed · Treasury · BLS · SEC · Reuters · AP · BBC · NPR · NYT · WSJ
      </div>
    </div>
  )

  if (bare) return body
  return body
}
