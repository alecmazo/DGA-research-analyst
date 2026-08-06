import { useEffect, useState } from 'react'
import { Panel } from '@/components/ui/Panel'
import { Empty, Spinner } from '@/components/ui/Empty'
import { api } from '@/lib/api'
import { fmtUsd, relativeTime } from '@/lib/format'
import page from './page.module.css'
import styles from './list.module.css'

type Episode = {
  ticker?: string
  title?: string
  format?: string
  duration_sec?: number
  generated_at?: string
  cost_usd?: number
  audio_url?: string
}

export function PodcastsPage() {
  const [eps, setEps] = useState<Episode[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const d = await api<{ episodes?: Episode[] }>('/api/podcast/list')
        if (alive) setEps(d.episodes || [])
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : 'Failed')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className={page.page}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Studio</p>
          <h1 className={page.h1}>Podcasts</h1>
          <p className={page.sub}>DGA HiTech episodes — script, TTS, and audio archive.</p>
        </div>
      </header>
      {err && <div className={page.bannerErr}>{err}</div>}
      <Panel title="Episodes" badge={eps.length} flush>
        {loading ? (
          <Spinner />
        ) : !eps.length ? (
          <Empty title="No episodes" sub="Generate from a saved report in the legacy shell or API." />
        ) : (
          <ul className={styles.list}>
            {eps.map((e, i) => (
              <li key={`${e.ticker}-${e.format}-${i}`} className={styles.item}>
                <div className={styles.itemMain}>
                  <div className={styles.itemTitle}>{e.title || e.ticker}</div>
                  <div className={styles.itemMeta}>
                    <span className={styles.pill}>{e.ticker}</span>
                    <span>{e.format}</span>
                    {e.duration_sec != null && (
                      <span>{Math.round(e.duration_sec / 60)} min</span>
                    )}
                    <span>{relativeTime(e.generated_at)}</span>
                    {e.cost_usd != null && <span>{fmtUsd(e.cost_usd, 2)}</span>}
                  </div>
                </div>
                {e.audio_url && (
                  <audio className={styles.audio} controls preload="none" src={e.audio_url} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
