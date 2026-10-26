import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { fmtPct, fmtPx, relativeTime } from '@/lib/format'
import { renderMd } from '@/lib/md'
import { ollamaChat, shortModelLabel } from '@/lib/localOllama'
import { openReportWindow } from '@/lib/openWindows'
import { Button } from '@/components/ui/Button'
import styles from '@/pages/LocalPage.module.css'

type Side = {
  id: string
  label: string
  rating?: string | null
  price_target?: number | null
  upside_pct?: number | null
  generated_at?: string | null
  thesis?: string | null
}

type Pack = {
  ticker: string
  frontier: Side[]
  local: Side[]
  packet: string
}

const SYSTEM = `You compare saved equity notes. The user message is the only source.
Write markdown with these sections:
## Price targets
A table with source, rating, target, and upside. Then one sentence on the dollar gap between the frontier notes and the local notes.
## Thesis
Where the notes agree, then where they differ. Name the source. Stay with the growth, multiple, moat, and risk that the excerpts mention.
## Check next
Three bullets a portfolio manager can verify. Do not invent a new price target.`

function money(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '—'
  const n = Number(value)
  return fmtPx(n, n >= 100 ? 0 : 2)
}

function rangeLabel(name: string, rows: Side[]): string | null {
  const values = rows
    .map((row) => row.price_target)
    .filter((value): value is number => value != null && Number.isFinite(Number(value)))
    .map(Number)
  if (!values.length) return null
  const low = Math.min(...values)
  const high = Math.max(...values)
  if (low === high) return `${name} ${money(low)}`
  return `${name} ${money(low)}–${money(high)}`
}

function spreadLine(pack: Pack): string {
  const parts = [rangeLabel('Frontier', pack.frontier), rangeLabel('Local', pack.local)].filter(
    (part): part is string => Boolean(part),
  )
  const values = [...pack.frontier, ...pack.local]
    .map((row) => row.price_target)
    .filter((value): value is number => value != null && Number.isFinite(Number(value)))
    .map(Number)
  if (values.length >= 2) {
    const gap = Math.max(...values) - Math.min(...values)
    if (gap > 0) parts.push(`Widest gap ${money(gap)}`)
  }
  return parts.join(' · ')
}

function Column({
  title,
  rows,
  ticker,
  provider,
}: {
  title: string
  rows: Side[]
  ticker: string
  provider: 'frontier' | 'local'
}) {
  return (
    <div className={styles.compCol}>
      <div className={styles.compHead}>{title}</div>
      {rows.length === 0 && <p className={styles.meta}>No saved note.</p>}
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          className={styles.compRow}
          onClick={() =>
            openReportWindow(ticker, provider === 'local' ? 'local' : row.id, provider === 'local' ? row.id : undefined)
          }
        >
          <strong>{provider === 'local' ? shortModelLabel(row.label) : row.label}</strong>
          <span className={styles.compNums}>
            {row.rating || '—'} · {money(row.price_target)} · {fmtPct(row.upside_pct, 1)}
            {row.generated_at ? ` · ${relativeTime(row.generated_at)}` : ''}
          </span>
          {row.thesis && <span className={styles.compThesis}>{row.thesis}</span>}
        </button>
      ))}
    </div>
  )
}

export function LocalCompare({
  ticker,
  online,
  model,
}: {
  ticker: string
  online: boolean
  model: string
}) {
  const [tk, setTk] = useState(ticker)
  const [pack, setPack] = useState<Pack | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [explaining, setExplaining] = useState(false)
  const [explainErr, setExplainErr] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [answer, setAnswer] = useState('')

  useEffect(() => {
    setTk(ticker)
  }, [ticker])

  const show = async () => {
    const next = tk.trim().toUpperCase()
    if (!next) return
    setTk(next)
    setLoading(true)
    setErr(null)
    setAnswer('')
    setDraft('')
    setExplainErr(null)
    try {
      const data = await api<Pack>(`/api/local/compare/${encodeURIComponent(next)}`)
      setPack(data)
    } catch (e) {
      setPack(null)
      setErr(e instanceof Error ? e.message : 'Could not load the notes')
    } finally {
      setLoading(false)
    }
  }

  const explain = async () => {
    if (!pack?.packet || explaining) return
    setExplaining(true)
    setExplainErr(null)
    setAnswer('')
    setDraft('')
    try {
      const chat = await ollamaChat({
        system: SYSTEM,
        user: pack.packet,
        model,
        maxTokens: 1600,
        onDelta: (chunk) => setDraft((prev) => prev + chunk),
      })
      if (!chat.text.trim()) throw new Error(`${shortModelLabel(model)} returned no comparison.`)
      setAnswer(chat.text)
      setDraft('')
    } catch (e) {
      setExplainErr(e instanceof Error ? e.message : 'Could not compare the notes')
    } finally {
      setExplaining(false)
    }
  }

  const gap = pack ? spreadLine(pack) : ''

  return (
    <section className={`${styles.card} ${styles.tight}`}>
      <h2>Compare</h2>
      <p>
        Frontier notes and local notes for one company. The target and the thesis sit side by side.
        Explain differences asks {shortModelLabel(model)}, on this Mac, to read those excerpts and name the gaps.
      </p>
      <div className={styles.row}>
        <input
          value={tk}
          aria-label="Compare ticker"
          onChange={(e) => setTk(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void show()
          }}
        />
        <Button size="sm" variant="primary" disabled={loading || !tk.trim()} onClick={() => void show()}>
          {loading ? 'Loading…' : 'Show targets'}
        </Button>
        <Button
          size="sm"
          disabled={!online || explaining || loading || !pack?.packet}
          onClick={() => void explain()}
        >
          {explaining ? 'Reading the notes…' : 'Explain differences'}
        </Button>
      </div>
      {err && <p className={styles.warn}>{err}</p>}
      {pack && (
        <>
          {gap && <p className={styles.meta}>{gap}</p>}
          <div className={styles.comp}>
            <Column title="Frontier" rows={pack.frontier} ticker={pack.ticker} provider="frontier" />
            <Column title="Local" rows={pack.local} ticker={pack.ticker} provider="local" />
          </div>
        </>
      )}
      {explainErr && <p className={styles.warn}>{explainErr}</p>}
      {(draft || answer) && (
        <article
          className={styles.noteBody}
          dangerouslySetInnerHTML={{ __html: renderMd(draft || answer) }}
        />
      )}
    </section>
  )
}
