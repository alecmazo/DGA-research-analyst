import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import styles from './TicketStatusDot.module.css'

const POLL_MS = 20_000

function labelFor(n: number): string {
  if (n === 1) return '1 open ticket'
  return `${n} open tickets`
}

export function TicketStatusDot() {
  const [n, setN] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const j = await api<{ ok?: boolean; open_count?: number }>(
        '/api/support/open-count',
      )
      if (typeof j.open_count === 'number') setN(j.open_count)
    } catch {
      /* keep last known; desk still works if the light fails */
    }
  }, [])

  useEffect(() => {
    void load()
    const t = window.setInterval(() => void load(), POLL_MS)
    const onVis = () => {
      if (document.visibilityState === 'visible') void load()
    }
    window.addEventListener('focus', load)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('dga-ticket-filed', load)
    return () => {
      window.clearInterval(t)
      window.removeEventListener('focus', load)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('dga-ticket-filed', load)
    }
  }, [load])

  const pending = n == null
  const hot = (n || 0) > 0
  const tip = pending ? 'Checking tickets…' : labelFor(n || 0)
  const tone = pending ? styles.wait : hot ? styles.hot : styles.ok

  return (
    <span
      className={`${styles.dot} ${tone}`}
      data-tip={tip}
      title={tip}
      role="status"
      aria-live="polite"
      aria-label={tip}
    />
  )
}
