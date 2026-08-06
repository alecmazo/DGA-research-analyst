import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Empty'
import { Panel } from '@/components/ui/Panel'
import { api, apiBlob } from '@/lib/api'
import page from './page.module.css'
import styles from './MemosPage.module.css'

/* ── types ─────────────────────────────────────────────────────────── */

type FundOpt = {
  id: string
  name?: string
  legal_name?: string
  short_name?: string
}

type MemoRow = {
  id: string
  episode_title?: string
  source_format?: string
  assigned_fund_id?: string | null
  fund_name?: string | null
  gp_memo?: string | null
  generated_at?: string | null
  last_sent_at?: string | null
  last_sent_to?: string | null
  size_bytes?: number
}

type QlFund = {
  fund_id: string
  name?: string
  short_name?: string
  fund_type?: string
  has_positions?: boolean
  has_attribution?: boolean
}

type QlLetterSummary = {
  id: string
  title?: string
  period?: string
  status?: string
  updated_at?: string | null
}

type QlLetter = {
  id: string
  title?: string
  period?: string
  year?: number
  manual_note?: string | null
  shared_intro_md?: string | null
  body_md?: string | null
  fund_sections?: Record<string, { md?: string; name?: string } | string>
  published_fund_ids?: string[]
  status?: string
}

type AgenticJob = {
  ok?: boolean
  status?: string
  label?: string
  cost_usd?: number
  error?: string
  result?: { answer?: string }
}

type EmailMode = 'ad_hoc' | 'lp_list'

/* ── helpers ───────────────────────────────────────────────────────── */

function fundLabel(f: FundOpt) {
  return f.legal_name || f.name || f.short_name || f.id
}

function qlFundLabel(f: QlFund) {
  return f.short_name || f.name || f.fund_id
}

function sectionMd(
  secs: QlLetter['fund_sections'] | undefined,
  fid: string,
): string {
  if (!secs) return ''
  const s = secs[fid]
  if (!s) return ''
  if (typeof s === 'string') return s
  return s.md || ''
}

/** Lightweight markdown → safe HTML for QL preview (matches legacy _qlPreviewMd). */
function previewMd(text: string): string {
  const LINK = 'color:#2563eb;text-decoration:underline;font-weight:600;'
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(
      /^### (.+)$/gm,
      '<div style="font-size:12px;font-weight:800;color:#5BB8D4;letter-spacing:.6px;margin:14px 0 4px;text-transform:uppercase;">$1</div>',
    )
    .replace(
      /^## (.+)$/gm,
      '<div style="font-size:16px;font-weight:800;color:#0A1628;margin:16px 0 6px;">$1</div>',
    )
    .replace(
      /^# (.+)$/gm,
      '<div style="font-size:17px;font-weight:800;color:#0A1628;margin:16px 0 6px;">$1</div>',
    )
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      `<a href="$2" target="_blank" rel="noopener noreferrer" style="${LINK}">$1</a>`,
    )
    .replace(
      /^- (.+)$/gm,
      '<div style="padding:2px 0 2px 12px;border-left:2px solid #5BB8D4;margin:3px 0;">$1</div>',
    )
    .replace(/\n{2,}/g, '<div style="height:9px;"></div>')
    .replace(/\n/g, ' ')
}

function emailMsg(em: { sent?: number; skipped?: number; errors?: unknown[] } | null | undefined) {
  if (!em) return ''
  return (
    ` Emailed ${em.sent || 0} LP(s)` +
    (em.skipped ? ` (${em.skipped} skipped)` : '') +
    (em.errors && em.errors.length ? `, ${em.errors.length} failed` : '') +
    '.'
  )
}

/** Poll agentic research job until done / error / timeout. */
async function pollAgentic(
  jobId: string,
  onTick?: (label: string, cost: number) => void,
  maxTries = 120,
): Promise<string> {
  let tries = 0
  while (tries < maxTries) {
    await new Promise((r) => setTimeout(r, 3000))
    tries++
    let j: AgenticJob
    try {
      j = await api<AgenticJob>(`/api/research/agentic/${encodeURIComponent(jobId)}`)
    } catch {
      continue
    }
    onTick?.(j.label || 'working…', j.cost_usd || 0)
    if (j.status === 'done' && j.result) return j.result.answer || ''
    if (j.status === 'error') throw new Error(j.error || j.label || 'generation failed')
  }
  throw new Error('timed out — try again')
}

async function openPdfBlob(path: string) {
  const blob = await apiBlob(path)
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/* ── component ─────────────────────────────────────────────────────── */

export function MemosPage() {
  /* funds for filter + email */
  const [funds, setFunds] = useState<FundOpt[]>([])
  const [fundFilter, setFundFilter] = useState('')

  /* memos list */
  const [memos, setMemos] = useState<MemoRow[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listErr, setListErr] = useState<string | null>(null)
  const [diagText, setDiagText] = useState<string | null>(null)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [selftestBusy, setSelftestBusy] = useState(false)

  /* email modal */
  const [emailTarget, setEmailTarget] = useState<{
    id: string
    fundId: string
    title: string
  } | null>(null)
  const [emailMode, setEmailMode] = useState<EmailMode>('ad_hoc')
  const [emailTo, setEmailTo] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)

  /* quarterly letter */
  const [qlYear, setQlYear] = useState(new Date().getFullYear())
  const [qlNote, setQlNote] = useState('')
  const [qlIntro, setQlIntro] = useState('')
  const [qlFunds, setQlFunds] = useState<QlFund[]>([])
  const [qlSections, setQlSections] = useState<Record<string, string>>({})
  const [qlCurrentId, setQlCurrentId] = useState<string | null>(null)
  const [qlPublished, setQlPublished] = useState<string[]>([])
  const [qlStatus, setQlStatus] = useState(
    'A shared firm-wide intro + your note go to every LP. Each fund section is seen only by that fund/account\'s holders. Generate each piece, edit, then Save.',
  )
  const [qlFreshWarn, setQlFreshWarn] = useState<string | null>(null)
  const [qlSaved, setQlSaved] = useState<QlLetterSummary[]>([])
  const [qlFundsLoading, setQlFundsLoading] = useState(true)
  const [qlBusy, setQlBusy] = useState<string | null>(null) // which action is busy
  const [qlPreviewOpen, setQlPreviewOpen] = useState(false)
  const [pageErr, setPageErr] = useState<string | null>(null)

  const fundsById = useMemo(() => {
    const m = new Map<string, FundOpt>()
    funds.forEach((f) => m.set(f.id, f))
    return m
  }, [funds])

  /* ── load funds ── */
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const d = await api<FundOpt[] | { funds?: FundOpt[] }>('/api/fund/list')
        const list = (Array.isArray(d) ? d : d.funds || []).filter((f) => f && f.id)
        if (alive) setFunds(list)
      } catch {
        /* filter still works without names */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  /* ── memos list ── */
  const loadMemos = useCallback(async () => {
    setListLoading(true)
    setListErr(null)
    setDiagText(null)
    try {
      const url =
        '/api/memos' + (fundFilter ? `?fund_id=${encodeURIComponent(fundFilter)}` : '')
      const d = await api<{ memos?: MemoRow[] }>(url)
      setMemos(d.memos || [])
    } catch (e) {
      setMemos([])
      setListErr(e instanceof Error ? e.message : 'Failed to load memos')
    } finally {
      setListLoading(false)
    }
  }, [fundFilter])

  useEffect(() => {
    void loadMemos()
  }, [loadMemos])

  /* ── QL funds + drafts ── */
  const loadQlFunds = useCallback(async () => {
    setQlFundsLoading(true)
    try {
      const d = await api<{ funds?: QlFund[] }>('/api/quarterly-letter/funds')
      const withPos = (d.funds || []).filter((f) => f.has_positions)
      setQlFunds(withPos)
      setQlSections((prev) => {
        const next = { ...prev }
        withPos.forEach((f) => {
          if (next[f.fund_id] === undefined) next[f.fund_id] = ''
        })
        return next
      })
    } catch {
      setQlFunds([])
    } finally {
      setQlFundsLoading(false)
    }
  }, [])

  const loadQlSaved = useCallback(async () => {
    try {
      const d = await api<{ letters?: QlLetterSummary[] }>('/api/quarterly-letter/list')
      setQlSaved(d.letters || [])
    } catch {
      setQlSaved([])
    }
  }, [])

  useEffect(() => {
    void loadQlFunds()
    void loadQlSaved()
  }, [loadQlFunds, loadQlSaved])

  /* ── memo actions ── */
  async function viewPdf(id: string) {
    setViewingId(id)
    try {
      await openPdfBlob(`/api/memos/${encodeURIComponent(id)}/pdf`)
    } catch (e) {
      alert('Could not open PDF: ' + (e instanceof Error ? e.message : e))
    } finally {
      setViewingId(null)
    }
  }

  async function deleteMemo(id: string) {
    if (!window.confirm('Delete this memo permanently?')) return
    try {
      await api(`/api/memos/${encodeURIComponent(id)}`, { method: 'DELETE' })
      void loadMemos()
    } catch (e) {
      alert('Delete failed: ' + (e instanceof Error ? e.message : e))
    }
  }

  function openEmail(m: MemoRow) {
    setEmailTarget({
      id: m.id,
      fundId: m.assigned_fund_id || '',
      title: m.episode_title || 'Memo',
    })
    setEmailMode('ad_hoc')
    setEmailTo('')
    setEmailSubject(`DGA Capital · ${m.episode_title || 'Memo'}`)
  }

  async function sendEmail() {
    if (!emailTarget) return
    if (emailMode === 'ad_hoc' && !emailTo.trim()) {
      alert('Enter a recipient email.')
      return
    }
    setEmailBusy(true)
    try {
      const j = await api<{
        ok?: boolean
        sent?: number
        attempted?: number
        results?: Array<{ error?: string }>
        detail?: string
      }>(`/api/memos/${encodeURIComponent(emailTarget.id)}/email`, {
        method: 'POST',
        body: JSON.stringify({
          mode: emailMode,
          to_addr: emailTo.trim(),
          subject: emailSubject.trim(),
        }),
      })
      if (!j.ok) {
        const errs = (j.results || [])
          .map((x) => x.error)
          .filter(Boolean)
          .join('; ')
        throw new Error(errs || j.detail || 'Send failed')
      }
      alert(`✓ Sent to ${j.sent}/${j.attempted} recipient${j.attempted === 1 ? '' : 's'}.`)
      setEmailTarget(null)
      void loadMemos()
    } catch (e) {
      alert('Email failed: ' + (e instanceof Error ? e.message : e))
    } finally {
      setEmailBusy(false)
    }
  }

  async function runSelfTest() {
    setSelftestBusy(true)
    try {
      const d = await api<{
        logo_exists?: boolean
        pillow?: string
        render_ok?: boolean
        pdf_bytes?: number
        render_error?: string
      }>('/api/memos/selftest')
      const pillowOk = d.pillow && !String(d.pillow).startsWith('MISSING')
      const healthy = d.logo_exists && pillowOk && d.render_ok
      setPageErr(
        healthy
          ? null
          : `Memo pipeline: logo ${d.logo_exists ? 'ok' : 'MISSING'} · Pillow ${d.pillow} · render ${d.render_ok ? 'ok' : d.render_error || 'failed'}`,
      )
      try {
        await openPdfBlob('/api/memos/selftest?download=1')
      } catch {
        alert(
          `Self-test details:\n\nLogo: ${d.logo_exists ? 'found' : 'MISSING'}\nPillow: ${d.pillow}\nPDF: ${d.render_ok ? 'ok' : d.render_error || 'failed'}`,
        )
      }
    } catch (e) {
      setPageErr('Self-test failed: ' + (e instanceof Error ? e.message : e))
    } finally {
      setSelftestBusy(false)
    }
  }

  async function runDiag() {
    try {
      const dj = await api<{
        row_count?: number
        columns?: Array<{ column_name?: string; data_type?: string }>
        recent?: Array<{
          id?: string
          episode_title?: string
          bytes?: number
          generated_at?: string
        }>
        error?: string
      }>('/api/memos/_diag')
      const lines = [
        `row_count: ${dj.row_count != null ? dj.row_count : '(error)'}`,
        'columns:',
        ...(dj.columns || []).map((c) => `  • ${c.column_name} → ${c.data_type}`),
        '',
        `recent: ${(dj.recent || []).length || '(none)'}`,
        ...(dj.recent || []).map(
          (r) =>
            `  • ${r.id} · ${r.episode_title} · ${r.bytes}B · ${(r.generated_at || '').slice(0, 16)}`,
        ),
        '',
        dj.error ? `❌ error: ${dj.error}` : '✓ ok',
      ]
      setDiagText(lines.join('\n'))
    } catch (e) {
      setListErr('Diag failed: ' + (e instanceof Error ? e.message : e))
    }
  }

  /* ── quarterly letter ── */
  function collectSections(): Record<string, { md: string; name: string }> {
    const out: Record<string, { md: string; name: string }> = {}
    qlFunds.forEach((f) => {
      const v = (qlSections[f.fund_id] || '').trim()
      if (v) out[f.fund_id] = { md: v, name: qlFundLabel(f) }
    })
    return out
  }

  async function qlFreshnessWarn(fundIds: string[]) {
    setQlFreshWarn(null)
    const staleNames: string[] = []
    for (const fid of fundIds) {
      try {
        const c = await api<{
          flows_estimated?: boolean
          updated_at?: string
          result_json?: string | { flows_estimated?: boolean }
        }>(`/api/fund/account/${encodeURIComponent(fid)}/ytd-cache`)
        let flowsEst = !!c.flows_estimated
        try {
          const rj =
            typeof c.result_json === 'string'
              ? JSON.parse(c.result_json)
              : c.result_json
          if (rj && rj.flows_estimated) flowsEst = true
        } catch {
          /* ignore */
        }
        const upd = c.updated_at ? new Date(c.updated_at) : null
        const oldCache =
          !upd || Number.isNaN(upd.getTime()) || Date.now() - upd.getTime() > 48 * 3600 * 1000
        if (flowsEst || oldCache) {
          const f = qlFunds.find((x) => x.fund_id === fid)
          staleNames.push((f && qlFundLabel(f)) || fid)
        }
      } catch {
        /* health check only */
      }
    }
    if (staleNames.length) {
      setQlFreshWarn(
        `⚠ ${staleNames.join(', ')}: some balance months are estimated / data may be stale — sync SnapTrade before publishing.`,
      )
    }
  }

  async function qlPersist(): Promise<string | null> {
    const sections = collectSections()
    if (!qlNote.trim() && !qlIntro.trim() && !Object.keys(sections).length) return null
    const payload = {
      id: qlCurrentId,
      title: `Quarterly Letter ${qlYear}`,
      period: `YTD ${qlYear}`,
      year: qlYear,
      manual_note: qlNote,
      shared_intro_md: qlIntro,
      fund_sections: sections,
      scope_fund_ids: Object.keys(sections),
      status: 'draft',
    }
    const r = await api<{ ok?: boolean; id?: string; detail?: string }>(
      '/api/quarterly-letter/save',
      { method: 'POST', body: JSON.stringify(payload) },
    )
    if (!r.ok && !r.id) throw new Error(r.detail || 'save failed')
    const id = r.id || null
    if (id) setQlCurrentId(id)
    return id
  }

  async function qlGenIntro() {
    if (qlIntro.trim() && !window.confirm('Replace the shared intro with a fresh draft?')) return
    setQlBusy('intro')
    setQlStatus('Intro: starting…')
    try {
      const r = await api<{ ok?: boolean; job_id?: string; error?: string; detail?: string }>(
        '/api/research/quarterly-letter/intro',
        { method: 'POST', body: JSON.stringify({ year: qlYear }) },
      )
      if (!r.ok || !r.job_id) throw new Error(r.error || r.detail || 'could not start')
      const md = await pollAgentic(r.job_id, (label, cost) => {
        setQlStatus(`Intro: ${label}  ·  $${cost.toFixed(2)}`)
      })
      setQlIntro(md)
      setQlStatus('✓ Intro ready — edit freely.')
    } catch (e) {
      setQlStatus('❌ intro: ' + (e instanceof Error ? e.message : e))
    } finally {
      setQlBusy(null)
    }
  }

  async function qlGenFund(fid: string, name: string, opts?: {
    force?: boolean
    rethrow?: boolean
    progressLabel?: string
  }) {
    const cur = qlSections[fid] || ''
    if (!opts?.force && cur.trim() && !window.confirm(`Replace the ${name} section with a fresh draft?`))
      return
    setQlBusy(`fund:${fid}`)
    try {
      const r = await api<{ ok?: boolean; job_id?: string; error?: string; detail?: string }>(
        '/api/research/quarterly-letter/fund-section',
        { method: 'POST', body: JSON.stringify({ fund_id: fid, year: qlYear }) },
      )
      if (!r.ok || !r.job_id) throw new Error(r.error || r.detail || 'could not start')
      const md = await pollAgentic(r.job_id, (label, cost) => {
        setQlStatus(`${opts?.progressLabel || name}: ${label}  ·  $${cost.toFixed(2)}`)
      })
      setQlSections((prev) => ({ ...prev, [fid]: md }))
      setQlStatus(`✓ ${name} section ready.`)
    } catch (e) {
      setQlStatus(`❌ ${name}: ` + (e instanceof Error ? e.message : e))
      if (opts?.rethrow) throw e
    } finally {
      setQlBusy(null)
    }
  }

  async function qlGenAll() {
    if (!qlFunds.length) {
      setQlStatus('No funds with live positions yet.')
      return
    }
    const hasContent = qlFunds.some((f) => (qlSections[f.fund_id] || '').trim())
    if (
      hasContent &&
      !window.confirm('Some fund sections already have text. Regenerate ALL sections and replace them?')
    )
      return
    setQlBusy('genall')
    let done = 0
    let failed = 0
    for (let i = 0; i < qlFunds.length; i++) {
      const f = qlFunds[i]
      const name = qlFundLabel(f)
      setQlStatus(`✨ ${i + 1}/${qlFunds.length} — ${name}…`)
      try {
        await qlGenFund(f.fund_id, name, {
          force: true,
          rethrow: true,
          progressLabel: `(${i + 1}/${qlFunds.length}) ${name}`,
        })
        done++
      } catch {
        failed++
      }
    }
    setQlBusy(null)
    setQlStatus(
      `✓ Generated ${done}/${qlFunds.length} fund section(s)` +
        (failed ? ` · ${failed} failed — see above.` : '. Review, edit, then Save/Publish.'),
    )
  }

  async function qlSave() {
    setQlBusy('save')
    try {
      const id = await qlPersist()
      setQlStatus(
        id
          ? `✓ Saved (${Object.keys(collectSections()).length} fund section(s)).`
          : 'Nothing to save yet.',
      )
      void loadQlSaved()
    } catch (e) {
      setQlStatus('❌ ' + (e instanceof Error ? e.message : e))
    } finally {
      setQlBusy(null)
    }
  }

  async function qlPublishAll() {
    try {
      await qlFreshnessWarn(Object.keys(collectSections()))
    } catch {
      /* non-blocking */
    }
    if (!window.confirm('Publish ALL filled fund sections to every holding LP (and email them)?'))
      return
    setQlBusy('publish')
    try {
      const id = await qlPersist()
      if (!id) throw new Error('nothing to publish')
      const r = await api<{
        ok?: boolean
        published_fund_ids?: string[]
        email?: { sent?: number; skipped?: number; errors?: unknown[] }
        detail?: string
      }>(`/api/quarterly-letter/${encodeURIComponent(id)}/publish-all`, {
        method: 'POST',
        body: '{}',
      })
      if (!r.ok) throw new Error(r.detail || 'publish failed')
      setQlStatus(
        `📢 Published all ${(r.published_fund_ids || []).length} section(s).` +
          emailMsg(r.email),
      )
      setQlPublished(r.published_fund_ids || [])
    } catch (e) {
      setQlStatus('❌ ' + (e instanceof Error ? e.message : e))
    } finally {
      setQlBusy(null)
    }
  }

  async function qlPublishFund(fid: string, name: string) {
    if (!(qlSections[fid] || '').trim()) {
      setQlStatus(`Generate ${name}'s section before publishing it.`)
      return
    }
    try {
      await qlFreshnessWarn([fid])
    } catch {
      /* non-blocking */
    }
    if (!window.confirm(`Publish the ${name} section to its LP(s) and email them?`)) return
    setQlBusy(`pub:${fid}`)
    try {
      const id = await qlPersist()
      if (!id) throw new Error('nothing to publish')
      const r = await api<{
        ok?: boolean
        published_fund_ids?: string[]
        email?: { sent?: number; skipped?: number; errors?: unknown[] }
        detail?: string
      }>(`/api/quarterly-letter/${encodeURIComponent(id)}/publish-fund`, {
        method: 'POST',
        body: JSON.stringify({ fund_id: fid }),
      })
      if (!r.ok) throw new Error(r.detail || 'publish failed')
      setQlStatus(`📢 Published ${name}.` + emailMsg(r.email))
      setQlPublished(r.published_fund_ids || [])
    } catch (e) {
      setQlStatus(`❌ ${name}: ` + (e instanceof Error ? e.message : e))
    } finally {
      setQlBusy(null)
    }
  }

  async function qlOpen(id: string) {
    try {
      const d = await api<{ letter?: QlLetter }>(
        `/api/quarterly-letter/${encodeURIComponent(id)}`,
      )
      const l = d.letter
      if (!l) return
      setQlCurrentId(l.id)
      if (l.year) setQlYear(l.year)
      setQlNote(l.manual_note || '')
      setQlIntro(l.shared_intro_md || l.body_md || '')
      const secs = l.fund_sections || {}
      setQlSections((prev) => {
        const next = { ...prev }
        Object.keys(secs).forEach((fid) => {
          next[fid] = sectionMd(secs, fid)
        })
        return next
      })
      setQlPublished(l.published_fund_ids || [])
      setQlStatus(`Loaded "${l.title || l.id}".`)
    } catch (e) {
      setQlStatus('Could not open draft: ' + (e instanceof Error ? e.message : e))
    }
  }

  const publishedSet = useMemo(() => new Set(qlPublished), [qlPublished])

  const emailFundName = emailTarget?.fundId
    ? fundLabel(fundsById.get(emailTarget.fundId) || { id: emailTarget.fundId })
    : '(no fund assigned)'

  /* ── render ── */
  return (
    <div className={page.page}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Firm ops</p>
          <h1 className={page.h1}>DGA Capital Memos</h1>
          <p className={page.sub}>
            LP-ready investment memoranda and the quarterly letter composer.
          </p>
        </div>
        <div className={page.heroActions}>
          <Button
            size="sm"
            onClick={() => void runSelfTest()}
            disabled={selftestBusy}
            title="Verify the logo + table render in the memo PDF pipeline"
          >
            {selftestBusy ? 'Testing…' : '🔍 Logo self-test'}
          </Button>
          <select
            className={styles.select}
            value={fundFilter}
            onChange={(e) => setFundFilter(e.target.value)}
            aria-label="Filter memos by fund"
          >
            <option value="">All funds</option>
            {funds.map((f) => (
              <option key={f.id} value={f.id}>
                {fundLabel(f)}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={() => void loadMemos()}>
            ↻ Refresh
          </Button>
        </div>
      </header>

      {pageErr && <div className={page.bannerErr}>{pageErr}</div>}

      {/* ── Quarterly Letter ── */}
      <Panel
        title="🗒️ Quarterly Letter"
        badge="narrative · YTD review"
        action={
          <div className={styles.qlHeadActions}>
            <span className={styles.yearLabel}>Year</span>
            <input
              className={styles.yearInput}
              type="number"
              min={2020}
              max={2099}
              value={qlYear}
              onChange={(e) => setQlYear(parseInt(e.target.value, 10) || new Date().getFullYear())}
            />
            <Button
              size="sm"
              disabled={!!qlBusy}
              onClick={() => void qlGenAll()}
            >
              {qlBusy === 'genall' ? '✨ Generating…' : '✨ Generate all fund sections'}
            </Button>
            <Button size="sm" onClick={() => setQlPreviewOpen(true)}>
              👁 Preview
            </Button>
            <Button size="sm" disabled={!!qlBusy} onClick={() => void qlSave()}>
              {qlBusy === 'save' ? '💾 Saving…' : '💾 Save draft'}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!!qlBusy}
              onClick={() => void qlPublishAll()}
            >
              {qlBusy === 'publish' ? '📢 Publishing…' : '📢 Publish to all LPs'}
            </Button>
          </div>
        }
      >
        <div className={styles.composerBody}>
          <div className={styles.status}>{qlStatus}</div>
          {qlFreshWarn && <div className={styles.freshWarn}>{qlFreshWarn}</div>}

          <label className={styles.fieldLabel}>
            ① Note from you — manual, shared, never AI-written
          </label>
          <textarea
            className={styles.textarea}
            rows={3}
            placeholder="A few words to your partners / LPs…"
            value={qlNote}
            onChange={(e) => setQlNote(e.target.value)}
          />

          <div className={styles.fieldLabelRow}>
            <label className={styles.fieldLabel} style={{ marginBottom: 0 }}>
              ② Shared intro — firm-wide, every LP sees this
            </label>
            <Button
              size="sm"
              disabled={!!qlBusy}
              onClick={() => void qlGenIntro()}
            >
              {qlBusy === 'intro' ? '✨ Generating…' : '✨ Generate intro'}
            </Button>
          </div>
          <textarea
            className={styles.textarea}
            rows={8}
            placeholder="Generate the firm-wide market/strategy opening, then edit…"
            value={qlIntro}
            onChange={(e) => setQlIntro(e.target.value)}
          />

          <label className={styles.fieldLabel}>
            ③ Per-fund sections — each LP sees only the funds they hold
          </label>
          {qlFundsLoading ? (
            <div className={styles.muted}>Loading funds…</div>
          ) : !qlFunds.length ? (
            <div className={styles.muted}>No funds with live positions yet.</div>
          ) : (
            qlFunds.map((f) => {
              const name = qlFundLabel(f)
              const tag =
                f.fund_type === 'lp_fund'
                  ? 'LP fund (shared by all its LPs)'
                  : 'managed account'
              const busyThis = qlBusy === `fund:${f.fund_id}` || qlBusy === `pub:${f.fund_id}`
              return (
                <div key={f.fund_id} className={styles.fundCard}>
                  <div className={styles.fundHead}>
                    <span className={styles.fundName}>{name}</span>
                    <span className={styles.fundMeta}>
                      {tag}
                      {!f.has_attribution && (
                        <span className={styles.fundWarn}> · no YTD CSV on file</span>
                      )}
                    </span>
                    {publishedSet.has(f.fund_id) && (
                      <span className={styles.pubTag}>✓ published</span>
                    )}
                    <span className={styles.fundHeadSpacer} />
                    <Button
                      size="sm"
                      disabled={!!qlBusy}
                      onClick={() => void qlGenFund(f.fund_id, name)}
                    >
                      {busyThis && qlBusy === `fund:${f.fund_id}` ? '✨ …' : '✨ Generate'}
                    </Button>
                    <Button
                      size="sm"
                      disabled={!!qlBusy}
                      onClick={() => void qlPublishFund(f.fund_id, name)}
                    >
                      {qlBusy === `pub:${f.fund_id}` ? '📢 …' : '📢 Publish to LP'}
                    </Button>
                  </div>
                  <textarea
                    className={`${styles.textarea} ${styles.fundTa}`}
                    rows={6}
                    placeholder="Generate this fund’s section, then edit…"
                    value={qlSections[f.fund_id] || ''}
                    onChange={(e) =>
                      setQlSections((prev) => ({ ...prev, [f.fund_id]: e.target.value }))
                    }
                  />
                </div>
              )
            })
          )}

          <div className={styles.draftsHead}>Saved drafts</div>
          {!qlSaved.length ? (
            <div className={styles.muted}>No saved drafts yet.</div>
          ) : (
            qlSaved.map((l) => (
              <div
                key={l.id}
                className={styles.draftRow}
                onClick={() => void qlOpen(l.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') void qlOpen(l.id)
                }}
              >
                <span>
                  {l.title || l.period || l.id}{' '}
                  <span className={styles.draftMeta}>
                    · {l.status || ''} · {(l.updated_at || '').slice(0, 16).replace('T', ' ')}
                  </span>
                </span>
              </div>
            ))
          )}
        </div>
      </Panel>

      {/* ── Memos list ── */}
      <Panel title="📄 Memos" badge={listLoading ? '…' : memos.length} flush>
        {listLoading ? (
          <div className={styles.loadingPad}>
            <Spinner />
          </div>
        ) : listErr ? (
          <div className={styles.errorBox}>
            Failed to load memos: <strong>{listErr}</strong>
            <div className={styles.errorSub}>
              Check Railway logs for [memo] errors
            </div>
          </div>
        ) : diagText ? (
          <pre className={styles.diagPre}>{diagText}</pre>
        ) : !memos.length ? (
          <div className={styles.emptyWrap}>
            No memos yet. Generate a podcast in the LLM Lab and click{' '}
            <strong>📄 Export as DGA Memo</strong>.
            <div className={styles.emptyHint}>
              <Button size="sm" onClick={() => void runDiag()}>
                🔍 Run server diagnostic
              </Button>
            </div>
          </div>
        ) : (
          memos.map((m) => {
            const snip = (m.gp_memo || '').slice(0, 90)
            return (
              <div key={m.id} className={styles.memoRow}>
                <div>
                  <div className={styles.memoTitle}>{m.episode_title || 'Memo'}</div>
                  <div className={styles.memoMeta}>
                    {(m.generated_at || '').slice(0, 10)} · {m.source_format || 'memo'}
                    {m.fund_name ? (
                      <>
                        {' '}
                        · <strong>{m.fund_name}</strong>
                      </>
                    ) : (
                      <span style={{ color: '#94a3b8' }}> · unassigned</span>
                    )}
                    {' · '}
                    {m.last_sent_at ? (
                      <span className={styles.sentOk}>
                        📨 sent {(m.last_sent_at || '').slice(0, 10)}
                      </span>
                    ) : (
                      <span className={styles.sentNo}>not sent</span>
                    )}
                  </div>
                  {snip ? (
                    <div className={styles.memoNote}>
                      {snip}
                      {(m.gp_memo || '').length > 90 ? '…' : ''}
                    </div>
                  ) : null}
                </div>
                <div className={styles.memoActions}>
                  <Button
                    size="sm"
                    disabled={viewingId === m.id}
                    onClick={() => void viewPdf(m.id)}
                  >
                    {viewingId === m.id ? '⏳ Loading…' : '📄 View PDF'}
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => openEmail(m)}>
                    📨 Email
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => void deleteMemo(m.id)}>
                    🗑
                  </Button>
                </div>
              </div>
            )
          })
        )}
      </Panel>

      {/* ── Email modal ── */}
      {emailTarget && (
        <div
          className={styles.overlay}
          onClick={(e) => {
            if (e.target === e.currentTarget) setEmailTarget(null)
          }}
        >
          <div className={styles.modal} role="dialog" aria-modal="true">
            <div className={styles.modalHead}>
              <span>📨</span>
              <h3>Email DGA Memo</h3>
              <span className={styles.toolbarSpacer} />
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setEmailTarget(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className={styles.memoMeta} style={{ marginBottom: 14, fontWeight: 700 }}>
              {emailTarget.title}
            </div>

            <div className={styles.modeToggle}>
              <label className={styles.modeLbl}>
                <input
                  type="radio"
                  name="memo-email-mode"
                  checked={emailMode === 'ad_hoc'}
                  onChange={() => setEmailMode('ad_hoc')}
                />
                Single recipient
              </label>
              <label
                className={`${styles.modeLbl} ${!emailTarget.fundId ? styles.modeLblDisabled : ''}`}
                title={
                  !emailTarget.fundId
                    ? 'Assign this memo to a fund first to use this mode.'
                    : undefined
                }
              >
                <input
                  type="radio"
                  name="memo-email-mode"
                  checked={emailMode === 'lp_list'}
                  disabled={!emailTarget.fundId}
                  onChange={() => setEmailMode('lp_list')}
                />
                All LPs in assigned fund
              </label>
            </div>

            {emailMode === 'ad_hoc' ? (
              <>
                <label className={styles.fieldLabel}>Recipient email</label>
                <input
                  className={styles.input}
                  type="email"
                  placeholder="name@example.com"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                />
              </>
            ) : (
              <div className={styles.lpBanner}>
                Sending to all active LPs in <strong>{emailFundName}</strong>.
              </div>
            )}

            <label className={styles.fieldLabel}>Subject</label>
            <input
              className={styles.input}
              type="text"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
            />

            <div className={styles.modalActions}>
              <Button size="sm" onClick={() => setEmailTarget(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={emailBusy}
                onClick={() => void sendEmail()}
              >
                {emailBusy ? '⏳ Sending…' : '📨 Send'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── QL Preview modal ── */}
      {qlPreviewOpen && (
        <QlPreviewModal
          year={qlYear}
          note={qlNote}
          intro={qlIntro}
          sections={collectSections()}
          onClose={() => setQlPreviewOpen(false)}
        />
      )}
    </div>
  )
}

function QlPreviewModal({
  year,
  note,
  intro,
  sections,
  onClose,
}: {
  year: number
  note: string
  intro: string
  sections: Record<string, { md: string; name: string }>
  onClose: () => void
}) {
  const slist = Object.values(sections)
  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`${styles.modal} ${styles.modalWide}`} role="dialog" aria-modal="true">
        <div className={styles.modalHead} style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#0A1628' }}>👁 Letter preview</span>
          <span className={styles.toolbarSpacer} />
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div style={{ paddingTop: 8 }}>
          <div className={styles.previewKicker}>DGA Capital · YTD {year}</div>
          <div className={styles.previewTitle}>Quarterly Letter</div>
          {note.trim() ? (
            <div
              className={styles.previewNote}
              dangerouslySetInnerHTML={{ __html: previewMd(note) }}
            />
          ) : null}
          {intro.trim() ? (
            <div
              className={styles.previewBody}
              dangerouslySetInnerHTML={{ __html: previewMd(intro) }}
            />
          ) : null}
          {slist.length ? (
            slist.map((s, i) => (
              <div key={i} className={styles.previewSection}>
                <div className={styles.previewSectionName}>{s.name}</div>
                <div
                  className={styles.previewBody}
                  dangerouslySetInnerHTML={{ __html: previewMd(s.md) }}
                />
              </div>
            ))
          ) : (
            <div className={styles.muted} style={{ marginTop: 14 }}>
              No fund sections filled in yet.
            </div>
          )}
          <div className={styles.previewFoot}>
            GP preview — shows ALL filled sections. Each LP sees the note, intro, and only the
            sections for funds they hold.
          </div>
        </div>
      </div>
    </div>
  )
}

