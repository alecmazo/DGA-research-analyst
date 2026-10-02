import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { relativeTime } from '@/lib/format'
import { renderMd } from '@/lib/md'
import styles from './LocalPortfolioPage.module.css'

type Report = {
  id?: string
  portfolio?: string
  created_at?: string
  text?: string
}

/** Open a saved portfolio recommendation in its own window. */
export function openPortfolioReport(id: string) {
  const reportId = id.trim()
  if (!reportId) return
  const url = `/gp/local-portfolio?id=${encodeURIComponent(reportId)}`
  const win = window.open(
    url,
    `dga-portfolio-${reportId}`,
    'width=1180,height=900,menubar=no,toolbar=no,location=no,status=no',
  )
  if (!win) window.location.href = url
}

function stampOf(iso: string | undefined): string {
  if (!iso) return ''
  const when = new Date(iso)
  const abs = Number.isNaN(when.getTime()) ? '' : when.toLocaleString()
  const rel = relativeTime(iso)
  if (abs && rel) return `${abs} · ${rel}`
  return abs || rel
}

export function LocalPortfolioPage() {
  const [params] = useSearchParams()
  const id = (params.get('id') || '').trim()
  const [report, setReport] = useState<Report | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) {
      setReport(null)
      setErr('This window has no saved recommendation.')
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    setErr(null)
    void api<Report>(`/api/local/portfolio-reports/${encodeURIComponent(id)}`)
      .then((row) => {
        if (alive) setReport(row)
      })
      .catch((e) => {
        if (!alive) return
        setReport(null)
        setErr(e instanceof Error ? e.message : 'Could not open the recommendation')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [id])

  useEffect(() => {
    const name = report?.portfolio || 'Portfolio recommendation'
    document.title = `${name} · DGA`
  }, [report?.portfolio])

  const stamp = stampOf(report?.created_at)

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.title}>
          <span className={styles.prov}>local</span>
          <strong>{report?.portfolio || 'Portfolio recommendation'}</strong>
        </div>
        <div className={styles.actions}>
          {stamp && <span className={styles.when}>{stamp}</span>}
          <button type="button" className={styles.print} onClick={() => window.print()}>
            Print
          </button>
        </div>
      </header>
      <div className={styles.body}>
        {loading && <p className={styles.empty}>Loading recommendation…</p>}
        {err && <p className={styles.err}>{err}</p>}
        {!loading && !err && report?.text && (
          <article
            className={styles.md}
            dangerouslySetInnerHTML={{ __html: renderMd(report.text) }}
          />
        )}
        {!loading && !err && report && !report.text && (
          <p className={styles.empty}>This recommendation has no text.</p>
        )}
      </div>
    </div>
  )
}
