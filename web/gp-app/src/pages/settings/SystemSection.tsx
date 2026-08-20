import { useCallback, useEffect, useState } from 'react'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import { fmtUsd } from '@/lib/format'
import styles from '../SettingsPage.module.css'

function rwDur(s?: number | null): string {
  if (s == null) return '—'
  const n = s
  const d = Math.floor(n / 86400)
  const h = Math.floor((n % 86400) / 3600)
  const m = Math.floor((n % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}

/* ── Railway ──────────────────────────────────────────────────── */

function RailwayCard() {
  const [badge, setBadge] = useState('…')
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setErr('')
    try {
      const d = await api<Record<string, unknown>>('/api/admin/railway-usage')
      setData(d)
      setBadge(d.on_railway ? 'LIVE' : 'LOCAL')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load Railway usage')
      setData(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const c = (data?.cost || {}) as Record<string, number | undefined>
  const m = (data?.metrics || {}) as Record<string, number | undefined>
  const mem = (data?.memory || {}) as Record<string, number | undefined>
  const mh = (data?.memory_hygiene || {}) as Record<string, unknown>
  const env = (data?.env || {}) as Record<string, string | undefined>
  const act = (data?.activity || {}) as Record<string, unknown>
  const prices = (data?.prices || {}) as Record<string, number | undefined>
  const memPct = m.mem_pct != null ? Math.min(100, m.mem_pct) : null
  const barColor =
    memPct == null ? '#cbd5e1' : memPct > 85 ? '#dc2626' : memPct > 65 ? '#d97706' : '#2563eb'
  const janitor = (mh.janitor || {}) as Record<string, number | undefined>

  return (
    <CollapsibleCard
      title="🚂 Railway cost"
      badge={badge}
      defaultOpen
      action={
        <Button size="sm" variant="ghost" onClick={() => void load()}>
          ↻
        </Button>
      }
    >
      {err && <div className={styles.statusErr}>{err}</div>}
      {!data && !err && <div className={styles.statusMuted}>Loading live usage…</div>}
      {data && (
        <>
          <div className={styles.metricCards}>
            <div className={styles.metricCard}>
              <div className={styles.metricLbl}>Projected this month</div>
              <div className={styles.metricVal}>{fmtUsd(c.projected_month, 0)}</div>
              <div className={styles.metricSub}>≈ {fmtUsd(c.per_day, 2)}/day</div>
            </div>
            <div className={styles.metricCard}>
              <div className={styles.metricLbl}>Month-to-date</div>
              <div className={styles.metricVal}>{fmtUsd(c.month_to_date, 0)}</div>
              <div className={styles.metricSub}>
                {c.pct_elapsed != null
                  ? `${c.pct_elapsed}% of month · day ${c.day_of_month}/${c.days_in_month}`
                  : ''}
              </div>
            </div>
            <div className={styles.metricCard}>
              <div className={styles.metricLbl}>Remaining</div>
              <div className={styles.metricVal}>{fmtUsd(c.remaining_month, 0)}</div>
              <div className={styles.metricSub}>
                {c.days_in_month && c.day_of_month
                  ? `${c.days_in_month - c.day_of_month} days left`
                  : ''}
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
            <div>
              <div className={styles.assignHead}>Cost breakdown · est.</div>
              <div className={styles.kv}>
                <span>
                  Memory ·{' '}
                  {mem.billed_gb != null
                    ? `${mem.billed_gb.toFixed(2)} GB avg × $${prices.mem_gb_month || 10}`
                    : '—'}
                </span>
                <span className={styles.kvStrong}>{fmtUsd(c.memory_month, 0)}</span>
              </div>
              <div className={styles.kv}>
                <span>
                  CPU ·{' '}
                  {m.avg_vcpu != null
                    ? `${m.avg_vcpu.toFixed(3)} vCPU × $${prices.vcpu_month || 20}`
                    : '—'}
                </span>
                <span className={styles.kvStrong}>{fmtUsd(c.cpu_month, 0)}</span>
              </div>
              {c.base_month != null && (
                <div className={styles.kv}>
                  <span>Base plan</span>
                  <span>{fmtUsd(c.base_month, 0)}</span>
                </div>
              )}
              {c.included_credit != null && (
                <div className={styles.kv}>
                  <span>Included credit</span>
                  <span>−{fmtUsd(c.included_credit, 0)}</span>
                </div>
              )}
              <div className={styles.kv}>
                <span className={styles.kvStrong}>Projected total / month</span>
                <span className={styles.kvStrong}>{fmtUsd(c.projected_month, 0)}</span>
              </div>
            </div>
            <div>
              <div className={styles.assignHead}>Live container</div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  marginBottom: 3,
                }}
              >
                <span>Memory (now)</span>
                <span>
                  {m.mem_current_gb != null ? `${m.mem_current_gb.toFixed(2)} GB` : '—'}
                  {m.mem_limit_gb ? ` / ${m.mem_limit_gb} GB` : ''}
                  {memPct != null ? `  (${memPct}%)` : ''}
                </span>
              </div>
              <div className={styles.bar}>
                <div
                  className={styles.barFill}
                  style={{ width: `${memPct || 0}%`, background: barColor }}
                />
              </div>
              <div className={styles.kv}>
                <span>Memory · avg / peak</span>
                <span>
                  {mem.avg_gb != null ? mem.avg_gb.toFixed(2) : '—'} /{' '}
                  {mem.peak_gb != null ? mem.peak_gb.toFixed(2) : '—'} GB
                </span>
              </div>
              <div className={styles.kv}>
                <span>Avg vCPU (since boot)</span>
                <span>{m.avg_vcpu != null ? m.avg_vcpu.toFixed(3) : '—'}</span>
              </div>
              <div className={styles.kv}>
                <span>Process RSS</span>
                <span>{m.rss_gb != null ? `${m.rss_gb.toFixed(2)} GB` : '—'}</span>
              </div>
              <div className={styles.kv}>
                <span>Uptime</span>
                <span>{rwDur(m.uptime_seconds)}</span>
              </div>
              {env.service && (
                <div className={styles.kv}>
                  <span>Service / region</span>
                  <span>
                    {env.service}
                    {env.region ? ` · ${env.region}` : ''}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className={styles.help} style={{ marginTop: 14 }}>
            <strong style={{ color: '#0369a1' }}>Memory hygiene:</strong>{' '}
            {String(mh.job_entries || 0)} active job entries + {String(mh.cache_entries || 0)} cache
            entries in RAM. Janitor caps job stores to {String(mh.job_cap)} most-recent
            {janitor.runs
              ? ` · ${janitor.runs} sweeps, ${janitor.evicted} entries trimmed`
              : ' · first sweep pending'}
            .
            <br />
            <strong style={{ color: act.active ? '#166534' : '#92400e' }}>
              {act.active ? '● Active' : '○ Idle'}
            </strong>{' '}
            —{' '}
            {act.active
              ? 'background market sync running while in use.'
              : 'background market sync paused (near-zero idle).'}
          </div>
        </>
      )}
      <div className={styles.help}>
        Est. from cgroup × Railway rates. Override via <code>RAILWAY_PRICE_*</code> env.
      </div>
    </CollapsibleCard>
  )
}

/* ── Email ────────────────────────────────────────────────────── */

function EmailCard() {
  const [addr, setAddr] = useState('')
  const [result, setResult] = useState<{ data: unknown; ok: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const test = async () => {
    const to = addr.trim()
    if (!to || !to.includes('@')) {
      setResult({ data: { error: 'Enter a valid email address first.' }, ok: false })
      return
    }
    setBusy(true)
    try {
      const d = await api<{ ok?: boolean }>('/api/v2/gp/email-test', {
        method: 'POST',
        body: JSON.stringify({ to }),
      })
      setResult({ data: d, ok: d.ok === true })
    } catch (e) {
      setResult({ data: { error: e instanceof Error ? e.message : e }, ok: false })
    } finally {
      setBusy(false)
    }
  }

  const diag = async () => {
    setBusy(true)
    try {
      const d = await api<{ resend_test_send?: { ok?: boolean } }>('/api/v2/gp/email-diag')
      const ok = d?.resend_test_send?.ok === true
      setResult({ data: d, ok })
    } catch (e) {
      setResult({ data: { error: e instanceof Error ? e.message : e }, ok: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <CollapsibleCard title="Email diagnostics" badge="Resend" defaultOpen>
      <div className={styles.hint} style={{ marginBottom: 8 }}>
        Verify Resend config and delivery.
      </div>
      <div className={styles.row} style={{ marginBottom: 8 }}>
        <input
          className={styles.input}
          type="email"
          placeholder="recipient@example.com"
          style={{ flex: 1, minWidth: 140 }}
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
        />
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void test()}>
          📨 Test
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void diag()}>
          🔍 Diag
        </Button>
      </div>
      {result && (
        <div className={styles.diagBox}>
          <div
            className={styles.diagHead}
            style={{
              background: result.ok ? 'rgba(22,163,74,0.06)' : 'rgba(220,38,38,0.06)',
              color: result.ok ? '#16a34a' : '#dc2626',
            }}
          >
            {result.ok ? '✅ Success' : '❌ Failed'}
          </div>
          <pre className={styles.diagPre}>{JSON.stringify(result.data, null, 2)}</pre>
        </div>
      )}
    </CollapsibleCard>
  )
}

/* ── Demo ─────────────────────────────────────────────────────── */

function DemoCard() {
  const [statusHtml, setStatusHtml] = useState('—')
  const [nFunds, setNFunds] = useState(1)
  const [nManaged, setNManaged] = useState(2)
  const [wlCount, setWlCount] = useState(10)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await api<{
        seeded?: boolean
        registry?: { seeded_at?: string }
        credentials?: {
          gp?: { email?: string; password?: string }
          lp?: { email?: string; password?: string }
        }
      }>('/api/v2/admin/demo/status')
      if (d.seeded) {
        const c = d.credentials || {}
        let t = `● Seeded${
          d.registry?.seeded_at
            ? ' · ' + String(d.registry.seeded_at).slice(0, 16).replace('T', ' ') + ' UTC'
            : ''
        }`
        if (c.gp) {
          t += `\nGP: ${c.gp.email} / ${c.gp.password}`
          if (c.lp) t += `\nLP: ${c.lp.email} / ${c.lp.password}`
        }
        setStatusHtml(t)
      } else {
        setStatusHtml('○ Not seeded yet — click the button below.')
      }
    } catch (e) {
      setStatusHtml('Status unavailable: ' + (e instanceof Error ? e.message : e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const reseed = async () => {
    const nf = Math.max(1, Math.min(4, nFunds))
    const nm = Math.max(0, Math.min(6, nManaged))
    const wl = Math.max(0, Math.min(25, wlCount))
    if (
      !confirm(
        `Seed / reset the demo sandbox as ${nf} fund(s) + ${nm} managed account(s)?\n\nThis OVERRIDES any existing demo data. No real data is touched.`,
      )
    )
      return
    setBusy(true)
    setNote('')
    try {
      const d = await api<{
        fund_ids?: string[]
        managed_ids?: string[]
        watchlist?: number
        reports?: number
        warnings?: unknown[]
      }>('/api/v2/admin/demo/reseed', {
        method: 'POST',
        body: JSON.stringify({ n_funds: nf, n_managed: nm, wl_count: wl }),
      })
      setNote(
        `✓ Seeded ${d.fund_ids?.length || 0} fund(s), ${d.managed_ids?.length || 0} account(s), ${d.watchlist || 0} watchlist, ${d.reports || 0} reports` +
          (d.warnings?.length ? ` · ${d.warnings.length} warnings` : ''),
      )
      await load()
    } catch (e) {
      setNote('✗ ' + (e instanceof Error ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <CollapsibleCard title="🎭 Demo sandbox" badge="PROSPECTS" defaultOpen={false}>
      <div className={styles.hint} style={{ marginBottom: 6 }}>
        Synthetic fund + managed accounts for demos. Demo sessions never see real data.
      </div>
      <pre className={styles.mono} style={{ marginBottom: 6, whiteSpace: 'pre-wrap' }}>
        {statusHtml}
      </pre>
      <div className={styles.row} style={{ marginBottom: 6 }}>
        <label style={{ fontSize: 10.5, display: 'flex', alignItems: 'center', gap: 4 }}>
          LP funds
          <input
            className={styles.input}
            type="number"
            min={1}
            max={4}
            style={{ width: 48, height: 24 }}
            value={nFunds}
            onChange={(e) => setNFunds(parseInt(e.target.value, 10) || 1)}
          />
        </label>
        <label style={{ fontSize: 10.5, display: 'flex', alignItems: 'center', gap: 4 }}>
          Managed
          <input
            className={styles.input}
            type="number"
            min={0}
            max={6}
            style={{ width: 48, height: 24 }}
            value={nManaged}
            onChange={(e) => setNManaged(parseInt(e.target.value, 10) || 0)}
          />
        </label>
        <label style={{ fontSize: 10.5, display: 'flex', alignItems: 'center', gap: 4 }}>
          Watchlist
          <input
            className={styles.input}
            type="number"
            min={0}
            max={25}
            style={{ width: 48, height: 24 }}
            value={wlCount}
            onChange={(e) => setWlCount(parseInt(e.target.value, 10) || 0)}
          />
        </label>
      </div>
      <div className={styles.row}>
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void reseed()}>
          {busy ? '⏳ Seeding…' : '↻ Seed / Reset'}
        </Button>
        {note && <span className={styles.meta}>{note}</span>}
      </div>
    </CollapsibleCard>
  )
}

/* ── System info ──────────────────────────────────────────────── */

function SystemInfoCard() {
  const [build, setBuild] = useState('—')
  const [commit, setCommit] = useState('—')
  const [backend, setBackend] = useState('—')
  const [db, setDb] = useState('—')
  const [badge, setBadge] = useState('—')
  const [modelOut, setModelOut] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const rssUrl = `${window.location.origin}/api/podcast/rss.xml`

  useEffect(() => {
    ;(async () => {
      try {
        const j = await api<{ build?: string; commit_sha?: string }>('/api/build')
        setBuild(j.build || '—')
        setCommit(String(j.commit_sha || j.build || '—').slice(0, 12))
        setBackend('✓ reachable')
        setBadge('OK')
      } catch {
        setBackend('❌ unreachable')
        setBadge('DOWN')
      }
      try {
        const j = await api<{ database?: string; db_ok?: boolean }>('/api/diagnostics')
        setDb(
          j.database === 'connected' || j.db_ok
            ? '✓ connected'
            : `⚠ ${j.database || 'unknown'}`,
        )
      } catch {
        setDb('— (check failed)')
      }
    })()
  }, [])

  const modelCheck = async () => {
    setChecking(true)
    setModelOut('Querying Anthropic…')
    try {
      const j = await api<{
        configured_agentic_model?: string
        agentic_model_in_list?: boolean | null
        ping_ok?: boolean
        ping_reply?: string
        ping_resolved_model?: string
        ping_error?: string
        available_models?: string[]
        list_error?: string
      }>('/api/models/check')
      const lines = [
        `configured AGENTIC_MODEL: ${j.configured_agentic_model || '—'}`,
        `in models.list():        ${
          j.agentic_model_in_list === true
            ? '✓ YES'
            : j.agentic_model_in_list === false
              ? '❌ NO — not a valid API id'
              : '? (list failed)'
        }`,
        `ping:                    ${
          j.ping_ok
            ? `✓ "${j.ping_reply}" (resolved: ${j.ping_resolved_model || '?'})`
            : `❌ ${j.ping_error || 'failed'}`
        }`,
      ]
      if (j.available_models?.length) {
        lines.push('', 'available models:')
        j.available_models.forEach((m) => lines.push(`  • ${m}`))
      }
      if (j.list_error) lines.push('\nlist error: ' + j.list_error)
      setModelOut(lines.join('\n'))
    } catch (e) {
      setModelOut('Check failed: ' + (e instanceof Error ? e.message : e))
    } finally {
      setChecking(false)
    }
  }

  return (
    <CollapsibleCard title="🖥 System info" badge={badge} defaultOpen>
      <div className={styles.mono}>
        <div>
          Build: <strong>{build}</strong>
        </div>
        <div>
          Commit: <strong>{commit}</strong>
        </div>
        <div>
          Backend: <strong>{backend}</strong>
        </div>
        <div>
          DB: <strong>{db}</strong>
        </div>
        <div>
          RSS:{' '}
          <a href={rssUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#5BB8D4' }}>
            {rssUrl}
          </a>
        </div>
      </div>
      <div className={styles.footerBar} style={{ marginTop: 8, marginLeft: -4, marginRight: -4 }}>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            const w = window as Window & { startDGATour?: () => void }
            w.startDGATour?.()
          }}
        >
          🗺 Tour
        </Button>
        <span className={styles.statusMuted}>Replay onboarding</span>
      </div>
      <div className={styles.footerBar} style={{ marginLeft: -4, marginRight: -4 }}>
        <Button size="sm" variant="secondary" disabled={checking} onClick={() => void modelCheck()}>
          {checking ? '⏳ Checking…' : '🤖 Check model'}
        </Button>
        <span className={styles.statusMuted}>
          <code>AGENTIC_MODEL</code> live ping
        </span>
      </div>
      {modelOut && <pre className={styles.pre} style={{ marginTop: 8, maxHeight: 200 }}>{modelOut}</pre>}
    </CollapsibleCard>
  )
}

export function SystemSection() {
  return (
    <>
      <RailwayCard />
      <EmailCard />
      <DemoCard />
      <SystemInfoCard />
    </>
  )
}
