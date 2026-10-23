import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Empty'
import { Panel } from '@/components/ui/Panel'
import { ApiError, api, apiBlob } from '@/lib/api'
import { ollamaChat, ollamaStatus, shortModelLabel } from '@/lib/localOllama'
import page from './page.module.css'
import styles from './MemosPage.module.css'
import { ClientLetterPanel } from './memos/ClientLetterPanel'
import { useWriterModel, writerPayload } from './memos/WriterModelSelect'

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
  letter_date?: string | null
  published_accounts?: { fund_id: string; name: string }[]
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
  letter_date?: string | null
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

function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
}

function draftTag(letter: QlLetterSummary): string {
  const names = (letter.published_accounts || []).map((row) => row.name).filter(Boolean)
  if (names.length) return `Published · ${names.join(', ')}`
  if ((letter.status || '') === 'published') return 'Published'
  return 'Draft'
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

function emailMsg(em: {
  sent?: number
  skipped?: number
  errors?: unknown[]
  fallback?: boolean
} | null | undefined) {
  if (!em) return ''
  const failed = em.errors && em.errors.length ? `, ${em.errors.length} failed` : ''
  if (em.fallback && em.sent) {
    return ` Emailed you the letter. This account has no investor login.${failed}`
  }
  return (
    ` Emailed ${em.sent || 0} LP(s)` +
    (em.skipped ? ` (${em.skipped} skipped)` : '') +
    failed +
    '.'
  )
}

/** Poll agentic research job until done / error / timeout.

Quarterly-letter jobs are forced to a draft by ~4 minutes. This window is
8 minutes so the page still receives that draft (SUP_20261021_40e7622c
gave up at 6 minutes while the job was running). A missing job fails fast
instead of spinning until the same timeout message.
*/
async function pollAgentic(
  jobId: string,
  onTick?: (label: string, cost: number) => void,
  maxTries = 160,
): Promise<string> {
  let tries = 0
  let missing = 0
  while (tries < maxTries) {
    await new Promise((r) => setTimeout(r, 3000))
    tries++
    let j: AgenticJob
    try {
      j = await api<AgenticJob>(`/api/research/agentic/${encodeURIComponent(jobId)}`)
      missing = 0
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        missing += 1
        if (missing >= 4) throw new Error('generation dropped — try again')
      }
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
  const writer = useWriterModel()
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
  const [qlDate, setQlDate] = useState(todayIso)
  const [qlNote, setQlNote] = useState('')
  const [qlIntro, setQlIntro] = useState('')
  const [qlFunds, setQlFunds] = useState<QlFund[]>([])
  const [qlSections, setQlSections] = useState<Record<string, string>>({})
  const [qlCurrentId, setQlCurrentId] = useState<string | null>(null)
  const [qlPublished, setQlPublished] = useState<string[]>([])
  const [qlStatus, setQlStatus] = useState(
    'Choose an account, choose a model, generate, read, then save or send.',
  )
  const [qlFreshWarn, setQlFreshWarn] = useState<string | null>(null)
  const [qlSaved, setQlSaved] = useState<QlLetterSummary[]>([])
  const [qlFundsLoading, setQlFundsLoading] = useState(true)
  const [qlBusy, setQlBusy] = useState<string | null>(null) // which action is busy
  const [qlPreviewOpen, setQlPreviewOpen] = useState(false)
  const [qlOpeningId, setQlOpeningId] = useState<string | null>(null)
  const [qlPane, setQlPane] = useState('note')
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
      letter_date: qlDate,
      manual_note: qlNote,
      shared_intro_md: qlIntro,
      fund_sections: sections,
      scope_fund_ids: Object.keys(sections),
      status: qlPublished.length ? 'published' : 'draft',
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

  async function qlText(
    path: string,
    body: Record<string, unknown>,
    onTick?: (label: string, cost: number) => void,
  ): Promise<string> {
    const payload = writerPayload(writer.model)
    if (!payload) throw new Error('Choose a model.')
    if (payload.llm_provider === 'local') {
      const localName = payload.local_model || ''
      const health = await ollamaStatus(localName)
      if (!health.ok) throw new Error(health.message)
      onTick?.(`Writing with ${shortModelLabel(localName)}`, 0)
      const prep = await api<{
        ok?: boolean
        local?: boolean
        system?: string
        user?: string
        error?: string
      }>(path, {
        method: 'POST',
        body: JSON.stringify({ ...body, ...payload }),
      })
      if (!prep.ok || !prep.user) throw new Error(prep.error || 'Could not prepare this section')
      const chat = await ollamaChat({
        system: prep.system || '',
        user: prep.user,
        model: localName,
        maxTokens: 2500,
      })
      const text = (chat.text || '').trim()
      if (!text) throw new Error(`${shortModelLabel(localName)} returned an empty section.`)
      return text
    }
    const r = await api<{ ok?: boolean; job_id?: string; error?: string; detail?: string }>(path, {
      method: 'POST',
      body: JSON.stringify({ ...body, ...payload }),
    })
    if (!r.ok || !r.job_id) throw new Error(r.error || r.detail || 'could not start')
    return pollAgentic(r.job_id, onTick)
  }

  async function qlGenIntro() {
    if (!writer.model) {
      setQlStatus('Choose a model.')
      return
    }
    if (qlIntro.trim() && !window.confirm('Replace the shared intro with a fresh draft?')) return
    setQlBusy('intro')
    setQlPane('intro')
    setQlStatus(`Intro: writing with ${writer.label || 'the model you picked'}.`)
    try {
      const md = await qlText(
        '/api/research/quarterly-letter/intro',
        { year: qlYear },
        (label, cost) => setQlStatus(`Intro: ${label}  ·  $${cost.toFixed(2)}`),
      )
      setQlIntro(md)
      setQlStatus('Intro is ready. Edit it, then save or send.')
    } catch (e) {
      setQlStatus('Intro stopped. ' + (e instanceof Error ? e.message : e))
    } finally {
      setQlBusy(null)
    }
  }

  async function qlGenFund(fid: string, name: string, opts?: {
    force?: boolean
    rethrow?: boolean
    progressLabel?: string
    keepBusy?: boolean
  }) {
    if (!writer.model) {
      setQlStatus('Choose a model.')
      return
    }
    const cur = qlSections[fid] || ''
    if (!opts?.force && cur.trim() && !window.confirm(`Replace the ${name} section with a fresh draft?`))
      return
    setQlBusy(`fund:${fid}`)
    setQlPane(fid)
    setQlStatus(`Writing ${name}.`)
    try {
      const md = await qlText(
        '/api/research/quarterly-letter/fund-section',
        { fund_id: fid, year: qlYear },
        (label, cost) => {
          setQlStatus(`${opts?.progressLabel || name}: ${label}  ·  $${cost.toFixed(2)}`)
        },
      )
      setQlSections((prev) => ({ ...prev, [fid]: md }))
      setQlStatus(`${name} is ready. Read it, then save or send.`)
    } catch (e) {
      setQlStatus(`${name} stopped. ` + (e instanceof Error ? e.message : e))
      if (opts?.rethrow) throw e
    } finally {
      if (!opts?.keepBusy) setQlBusy(null)
    }
  }

  async function qlGenAll() {
    if (!writer.model) {
      setQlStatus('Choose a model.')
      return
    }
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
          keepBusy: true,
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
      void loadQlSaved()
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
      void loadQlSaved()
    } catch (e) {
      setQlStatus(`❌ ${name}: ` + (e instanceof Error ? e.message : e))
    } finally {
      setQlBusy(null)
    }
  }

  async function qlOpen(id: string) {
    setQlOpeningId(id)
    setQlCurrentId(id)
    setQlStatus('Opening…')
    try {
      const d = await api<{ letter?: QlLetter }>(
        `/api/quarterly-letter/${encodeURIComponent(id)}`,
      )
      const l = d.letter
      if (!l) return
      setQlCurrentId(l.id)
      if (l.year) setQlYear(l.year)
      setQlDate((l.letter_date || '').slice(0, 10) || todayIso())
      setQlNote(l.manual_note || '')
      setQlIntro(l.shared_intro_md || l.body_md || '')
      const secs = l.fund_sections || {}
      const next: Record<string, string> = {}
      qlFunds.forEach((f) => {
        next[f.fund_id] = ''
      })
      Object.keys(secs).forEach((fid) => {
        next[fid] = sectionMd(secs, fid)
      })
      setQlSections(next)
      const published = l.published_fund_ids || []
      setQlPublished(published)
      const focus =
        published.find((fid) => sectionMd(secs, fid).trim()) ||
        Object.keys(secs).find((fid) => sectionMd(secs, fid).trim()) ||
        'note'
      setQlPane(focus)
      setQlStatus(`Loaded "${l.title || l.id}".`)
    } catch (e) {
      setQlStatus('Could not open draft: ' + (e instanceof Error ? e.message : e))
    } finally {
      setQlOpeningId(null)
    }
  }

  const publishedSet = useMemo(() => new Set(qlPublished), [qlPublished])
  const qlSelected = qlFunds.find((f) => f.fund_id === qlPane) || null
  const filledFunds = qlFunds.filter((f) => (qlSections[f.fund_id] || '').trim())
  const previewFund = qlSelected || (filledFunds.length === 1 ? filledFunds[0] : null)
  const qlStep = qlBusy
    ? 3
    : qlSelected && (qlSections[qlSelected.fund_id] || '').trim()
      ? 4
      : qlSelected && writer.model
        ? 3
        : qlSelected
          ? 2
          : 1
  const qlSteps = ['Account', 'Model', 'Generate', 'Read', 'Save or send']

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
            Client letters and quarterly account memos. Pick the account, pick the model, then write.
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

      <ClientLetterPanel
        model={writer.model}
        modelLabel={writer.label}
        options={writer.options}
        onModel={writer.setModel}
        contextFundId={qlSelected?.fund_id || ''}
      />

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
              disabled={!!qlBusy || !writer.model}
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
          <div className={styles.flowBar}>
            <ol className={styles.flowSteps} aria-label="How an account memo is written">
              {qlSteps.map((label, i) => (
                <li key={label} className={qlStep === i + 1 ? styles.flowNow : undefined}>
                  {i + 1} {label}
                </li>
              ))}
            </ol>
          </div>
          <div className={qlStatus.includes('stopped') || qlStatus.startsWith('Choose') ? styles.statusBad : styles.status}>
            {qlStatus}
          </div>
          {qlFreshWarn && <div className={styles.freshWarn}>{qlFreshWarn}</div>}

          <div className={styles.letterDesk}>
            <nav className={styles.rail} aria-label="Letter sections">
              <button
                type="button"
                className={qlPane === 'note' ? styles.railOn : styles.railBtn}
                onClick={() => setQlPane('note')}
              >
                <span className={styles.railName}>Note from you</span>
                <span className={styles.railMeta}>{qlNote.trim() ? 'Draft' : 'Empty'}</span>
              </button>
              <button
                type="button"
                className={qlPane === 'intro' ? styles.railOn : styles.railBtn}
                onClick={() => setQlPane('intro')}
              >
                <span className={styles.railName}>Shared intro</span>
                <span className={styles.railMeta}>{qlIntro.trim() ? 'Draft' : 'Empty'}</span>
              </button>
              <div className={styles.railLabel}>Accounts</div>
              {qlFundsLoading ? (
                <div className={styles.muted}>Loading funds…</div>
              ) : !qlFunds.length ? (
                <div className={styles.muted}>No funds with live positions yet.</div>
              ) : (
                qlFunds.map((f) => {
                  const name = qlFundLabel(f)
                  const filled = (qlSections[f.fund_id] || '').trim()
                  const state = publishedSet.has(f.fund_id)
                    ? 'Published'
                    : filled
                      ? 'Draft'
                      : 'Empty'
                  return (
                    <button
                      key={f.fund_id}
                      type="button"
                      className={qlPane === f.fund_id ? styles.railOn : styles.railBtn}
                      onClick={() => setQlPane(f.fund_id)}
                    >
                      <span className={styles.railName}>{name}</span>
                      <span className={styles.railMeta}>
                        {state}
                        {!f.has_attribution ? ' · no YTD' : ''}
                      </span>
                    </button>
                  )
                })
              )}
            </nav>

            <div className={styles.editor}>
              <label className={styles.dateField}>
                <span>Date</span>
                <input
                  className={styles.dateInput}
                  type="date"
                  aria-label="Letter date"
                  value={qlDate}
                  onChange={(e) => setQlDate(e.target.value)}
                />
              </label>
              {qlOpeningId && <div className={styles.status}>Opening this letter…</div>}
              {qlPane === 'note' && (
                <>
                  <div className={styles.editorHead}>
                    <div>
                      <div className={styles.editorTitle}>Note from you</div>
                      <div className={styles.editorSub}>
                        Manual. Shared with every LP. Never written by the model.
                      </div>
                    </div>
                  </div>
                  <textarea
                    className={`${styles.textarea} ${styles.editorTa}`}
                    rows={14}
                    placeholder="A few words to your partners / LPs…"
                    value={qlNote}
                    onChange={(e) => setQlNote(e.target.value)}
                  />
                </>
              )}
              {qlPane === 'intro' && (
                <>
                  <div className={styles.editorHead}>
                    <div>
                      <div className={styles.editorTitle}>Shared intro</div>
                      <div className={styles.editorSub}>
                        Firm-wide. Every LP sees this. No account holdings.
                      </div>
                    </div>
                    <Button size="sm" disabled={!!qlBusy || !writer.model} onClick={() => void qlGenIntro()}>
                      {qlBusy === 'intro' ? 'Generating…' : 'Generate intro'}
                    </Button>
                  </div>
                  <textarea
                    className={`${styles.textarea} ${styles.editorTa}`}
                    rows={16}
                    placeholder="Generate the firm-wide opening, then edit…"
                    value={qlIntro}
                    onChange={(e) => setQlIntro(e.target.value)}
                  />
                </>
              )}
              {qlSelected && (
                <>
                  <div className={styles.editorHead}>
                    <div>
                      <div className={styles.editorTitle}>{qlFundLabel(qlSelected)}</div>
                      <div className={styles.editorSub}>
                        {qlSelected.fund_type === 'lp_fund'
                          ? 'LP fund. Shared with that fund’s investors.'
                          : 'Managed account. The holder of this account sees this.'}
                        {writer.label ? ` ${writer.label} writes this section.` : ' Choose a model, then generate.'}
                        {!qlSelected.has_attribution ? ' Upload a YTD file to cite trades.' : ''}
                        {publishedSet.has(qlSelected.fund_id) ? ' Published.' : ''}
                      </div>
                    </div>
                    <div className={styles.editorActions}>
                      <select
                        className={styles.select}
                        aria-label="Model"
                        value={writer.options.some((row) => row.id === writer.model) ? writer.model : ''}
                        disabled={!!qlBusy}
                        onChange={(e) => writer.setModel(e.target.value)}
                      >
                        <option value="">Choose a model</option>
                        {writer.options.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.label}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        disabled={!!qlBusy || !writer.model}
                        onClick={() => void qlGenFund(qlSelected.fund_id, qlFundLabel(qlSelected))}
                      >
                        {qlBusy === `fund:${qlSelected.fund_id}` ? 'Generating…' : 'Generate'}
                      </Button>
                      <Button
                        size="sm"
                        disabled={!!qlBusy}
                        onClick={() =>
                          void qlPublishFund(qlSelected.fund_id, qlFundLabel(qlSelected))
                        }
                      >
                        {qlBusy === `pub:${qlSelected.fund_id}` ? 'Publishing…' : 'Publish to LP'}
                      </Button>
                    </div>
                  </div>
                  <textarea
                    className={`${styles.textarea} ${styles.editorTa}`}
                    rows={16}
                    placeholder="Generate this account’s section, then edit…"
                    value={qlSections[qlSelected.fund_id] || ''}
                    onChange={(e) =>
                      setQlSections((prev) => ({
                        ...prev,
                        [qlSelected.fund_id]: e.target.value,
                      }))
                    }
                  />
                </>
              )}
            </div>
          </div>

          <div className={styles.draftsHead}>Saved drafts</div>
          {!qlSaved.length ? (
            <div className={styles.muted}>No saved drafts yet.</div>
          ) : (
            qlSaved.map((l) => (
              <button
                key={l.id}
                type="button"
                className={
                  qlOpeningId === l.id || qlCurrentId === l.id ? styles.draftOn : styles.draftRow
                }
                onClick={() => void qlOpen(l.id)}
              >
                <span className={styles.draftTitle}>{l.title || l.period || l.id}</span>
                <span className={styles.draftMeta}>
                  {draftTag(l)}
                  {' · '}
                  {l.letter_date || (l.updated_at || '').slice(0, 10)}
                </span>
              </button>
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
          payload={{
            year: qlYear,
            letter_date: qlDate,
            period: `YTD ${qlYear}`,
            title: `Quarterly Letter ${qlYear}`,
            manual_note: qlNote,
            shared_intro_md: qlIntro,
            fund_id: previewFund?.fund_id || '',
            fund_sections: collectSections(),
          }}
          accountName={previewFund ? qlFundLabel(previewFund) : ''}
          onClose={() => setQlPreviewOpen(false)}
        />
      )}
    </div>
  )
}

function QlPreviewModal({
  payload,
  accountName,
  onClose,
}: {
  payload: {
    year: number
    letter_date: string
    period: string
    title: string
    manual_note: string
    shared_intro_md: string
    fund_id: string
    fund_sections: Record<string, { md: string; name: string }>
  }
  accountName: string
  onClose: () => void
}) {
  const [html, setHtml] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    let alive = true
    void api<{ html?: string; detail?: string }>('/api/quarterly-letter/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
      .then((data) => {
        if (alive) setHtml(data.html || '')
      })
      .catch((e) => {
        if (alive) setErr(e instanceof Error ? e.message : 'Preview failed')
      })
    return () => {
      alive = false
    }
  }, [payload])
  const caption = accountName
    ? `This is the ${accountName} letter in the LP portal and in the email.`
    : 'Select an account to preview the letter that account receives. This is the shared opening.'
  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`${styles.modal} ${styles.modalWide}`} role="dialog" aria-modal="true">
        <div className={styles.modalHead} style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#0A1628' }}>Letter preview</span>
          <span className={styles.toolbarSpacer} />
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className={styles.previewFoot}>{caption}</p>
        {err ? (
          <div className={styles.statusBad}>{err}</div>
        ) : html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div className={styles.muted}>Opening the letter…</div>
        )}
      </div>
    </div>
  )
}

