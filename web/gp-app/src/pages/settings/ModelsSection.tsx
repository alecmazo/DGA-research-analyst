import { useCallback, useEffect, useState } from 'react'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import styles from '../SettingsPage.module.css'

type Rates = { input?: number; output?: number }

type Provider = {
  label?: string
  configured?: boolean
  model?: string
  rates_usd_per_mtok?: Rates
  live_search?: boolean
  base_url?: string
  key_env?: string
  note?: string
  master_enabled?: boolean
}

type Task = {
  id: string
  label?: string
  group?: string
  allowed?: string[]
  route?: string
  default?: string
  model_resolved?: string
  note?: string
}

type JobCfg = {
  enabled?: boolean
  hour?: number
  minute?: number
  next_run_secs?: number | null
}

type AutoSettings = {
  daily_brief?: JobCfg
  market_pulse?: JobCfg
  snaptrade_sync?: JobCfg
}

/** Task ids that can run on a Pacific schedule. */
const SCHEDULED_TASKS: Record<string, keyof AutoSettings> = {
  daily_brief: 'daily_brief',
  market_pulse: 'market_pulse',
}

const CLOCK_DEFAULTS: Record<keyof AutoSettings, { hour: number; minute: number }> = {
  daily_brief: { hour: 8, minute: 0 },
  market_pulse: { hour: 8, minute: 15 },
  snaptrade_sync: { hour: 6, minute: 0 },
}

function fmtClock(h?: number, m?: number) {
  return `${String(h ?? 0).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`
}

function fmtNext(cfg?: JobCfg) {
  if (!cfg?.enabled) return 'Off'
  const secs = cfg.next_run_secs
  if (secs == null) return '—'
  const h = Math.floor(secs / 3600)
  const min = Math.floor((secs % 3600) / 60)
  return h === 0 ? `in ${min}m` : `in ${h}h ${min}m`
}

function ScheduleControls({
  job,
  cfg,
  busy,
  onEnabled,
  onClock,
}: {
  job: keyof AutoSettings
  cfg?: JobCfg
  busy: boolean
  onEnabled: (on: boolean) => void
  onClock: (value: string) => void
}) {
  const d = CLOCK_DEFAULTS[job]
  return (
    <div className={styles.routeSched}>
      <label className={styles.routeAuto}>
        <input
          type="checkbox"
          checked={!!cfg?.enabled}
          disabled={busy}
          onChange={(e) => onEnabled(e.target.checked)}
        />
        Auto
      </label>
      <input
        type="time"
        className={styles.autoTime}
        value={fmtClock(cfg?.hour ?? d.hour, cfg?.minute ?? d.minute)}
        disabled={busy}
        onChange={(e) => onClock(e.target.value)}
        aria-label={`${job} Pacific time`}
      />
      <span className={styles.autoNext}>{fmtNext(cfg)}</span>
    </div>
  )
}

type Routing = {
  providers?: Record<string, Provider>
  tasks?: Task[]
  routes?: Record<string, string>
  groups?: string[]
  volume?: VolumeCfg
}

type VolumeCfg = {
  enabled?: boolean
  configured?: boolean
  model?: string
  jobs?: Record<string, boolean>
  task_routes?: Record<string, string>
  rates_usd_per_mtok?: Rates
  message?: string
}

const PROV_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  grok: { bg: '#e0f2fe', fg: '#0369a1', border: '#7dd3fc' },
  claude: { bg: '#f3e8ff', fg: '#6b21a8', border: '#d8b4fe' },
  kimi: { bg: '#dcfce7', fg: '#166534', border: '#86efac' },
  deepseek: { bg: '#e0e7ff', fg: '#3730a3', border: '#a5b4fc' },
}

const ORDER = ['grok', 'claude', 'kimi', 'deepseek'] as const

function rateLine(rates?: Rates): string {
  if (!rates || rates.input == null) return '—'
  return `$${Number(rates.input).toFixed(2)} / $${Number(rates.output ?? 0).toFixed(2)} MTok`
}

export function ModelsSection() {
  const [routing, setRouting] = useState<Routing | null>(null)
  const [vol, setVol] = useState<VolumeCfg | null>(null)
  const [auto, setAuto] = useState<AutoSettings>({})
  const [status, setStatus] = useState('Loading…')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setErr(null)
    try {
      let r: Routing | null = null
      let v: VolumeCfg | null = null
      try {
        r = await api<Routing>('/api/config/model-routing')
      } catch {
        /* optional mid-deploy */
      }
      try {
        v = await api<VolumeCfg>('/api/config/volume-llm')
      } catch {
        /* optional */
      }
      try {
        const a = await api<AutoSettings>('/api/automation/settings')
        setAuto(a || {})
      } catch {
        /* schedule is optional if routing loaded */
      }
      if (!r && !v) throw new Error('routing + volume endpoints failed')
      if (!r) r = { volume: v || undefined, providers: {}, tasks: [], routes: v?.task_routes || {} }
      if (!v) v = r.volume || {}
      setRouting(r)
      setVol(v)
      const en = !!v.enabled
      const cfg = !!v.configured
      const jobs = v.jobs || {}
      const nOn = Object.keys(jobs).filter((k) => jobs[k] !== false).length
      const nAll = Object.keys(jobs).length || 4
      const rates = v.rates_usd_per_mtok || {}
      const rateTxt =
        rates.input != null
          ? `Kimi $${Number(rates.input).toFixed(2)}/$${Number(rates.output ?? 0).toFixed(2)} MTok`
          : ''
      setStatus(
        (cfg ? `Kimi key · ${v.model || 'kimi-k3'}` : 'Kimi not configured') +
          (en ? ' · master ON' : ' · master OFF') +
          (rateTxt ? ` · ${rateTxt}` : ''),
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load model routing')
      setStatus('Could not load model routing')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setRoutingConfig = async (body: Record<string, unknown>) => {
    setBusy(true)
    setErr(null)
    try {
      try {
        await api('/api/config/model-routing', {
          method: 'POST',
          body: JSON.stringify(body),
        })
      } catch {
        await api('/api/config/volume-llm', {
          method: 'POST',
          body: JSON.stringify(body),
        })
      }
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Route save failed')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const onRouteChange = (taskId: string, provider: string) => {
    void setRoutingConfig({ routes: { [taskId]: provider } })
  }

  const patchAuto = async (job: keyof AutoSettings, patch: JobCfg) => {
    setBusy(true)
    setErr(null)
    try {
      const defs = CLOCK_DEFAULTS[job]
      const cur = auto[job] || {}
      const s = await api<AutoSettings>('/api/automation/settings', {
        method: 'POST',
        body: JSON.stringify({
          [job]: {
            enabled: patch.enabled ?? cur.enabled ?? true,
            hour: patch.hour ?? cur.hour ?? defs.hour,
            minute: patch.minute ?? cur.minute ?? defs.minute,
          },
        }),
      })
      try {
        const fresh = await api<AutoSettings>('/api/automation/settings')
        setAuto(fresh || s || {})
      } catch {
        setAuto(s || {})
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Schedule save failed')
    } finally {
      setBusy(false)
    }
  }

  const onClock = (job: keyof AutoSettings, value: string) => {
    const [hs, ms] = value.split(':')
    const hour = Math.max(0, Math.min(23, parseInt(hs || '0', 10) || 0))
    const minute = Math.max(0, Math.min(59, parseInt(ms || '0', 10) || 0))
    void patchAuto(job, { hour, minute })
  }

  const providers = routing?.providers || {}
  const tasks = (routing?.tasks || []).filter((t) => t.id !== 'prioritize')
  const jobs = vol?.jobs || {}
  const nOn = Object.keys(jobs).filter((k) => k !== 'prioritize' && jobs[k] !== false).length
  const nAll = Object.keys(jobs).filter((k) => k !== 'prioritize').length || 3
  const nTasks = Object.keys(routing?.routes || vol?.task_routes || {}).length
  const en = !!vol?.enabled
  const cfg = !!vol?.configured
  const grokOk = providers.grok?.configured
  const badge =
    !cfg && !grokOk
      ? 'CHECK KEYS'
      : `${nTasks || tasks.length} TASKS · KIMI ${nOn}/${nAll}`

  const groups: Record<string, Task[]> = {}
  tasks.forEach((t) => {
    const g = t.group || 'Other'
    if (!groups[g]) groups[g] = []
    groups[g].push(t)
  })
  const groupOrder = routing?.groups || ['Research', 'Desk', 'Agents', 'Media', 'Other']

  return (
    <CollapsibleCard
      title="🧠 Wired models & task routing"
      badge={badge}
      className={styles.span2}
      defaultOpen
      action={
        <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={busy}>
          ↻
        </Button>
      }
    >
      <p className={styles.hint}>
        Assign a model to each task. For Daily Pulse, tick <strong>Auto</strong> and
        set a Pacific time — that is the schedule (no separate Automation card). Market Pulse
        on the Desk is free public headlines (no model). Idea Generator is
        retired. Full reports + Agents: Grok · Claude · DeepSeek.
      </p>

      <div className={styles.provGrid}>
        {ORDER.map((id) => {
          const p = providers[id]
          if (!p) return null
          const c = PROV_COLORS[id] || { bg: '#f1f5f9', fg: '#475569', border: '#e2e8f0' }
          const ok = !!p.configured
          const master =
            (id === 'kimi' || id === 'deepseek') && p.master_enabled === false
              ? ' · master OFF'
              : ''
          return (
            <div
              key={id}
              className={styles.provCard}
              style={{ borderColor: c.border, background: c.bg }}
            >
              <div className={styles.provTop}>
                <span className={styles.provLabel} style={{ color: c.fg }}>
                  {p.label || id}
                </span>
                <span
                  className={styles.provKey}
                  style={{
                    background: ok ? 'rgba(22,163,74,0.15)' : 'rgba(220,38,38,0.12)',
                    color: ok ? '#166534' : '#991b1b',
                  }}
                >
                  {ok ? 'KEY SET' : 'NO KEY'}
                  {master}
                </span>
              </div>
              <div className={styles.provModel}>{p.model || '—'}</div>
              <div className={styles.provSub}>
                {rateLine(p.rates_usd_per_mtok)}
                {p.live_search ? ' · live search' : ''}
              </div>
              {p.base_url && (
                <div className={styles.provSub} style={{ color: '#94a3b8' }}>
                  {p.base_url}
                </div>
              )}
              {p.key_env && (
                <div className={styles.provSub} style={{ color: '#94a3b8' }}>
                  env {p.key_env}
                </div>
              )}
              {p.note && <div className={styles.provSub}>{p.note}</div>}
            </div>
          )
        })}
      </div>

      <div className={styles.row} style={{ marginBottom: 12 }}>
        <Button
          size="sm"
          variant="primary"
          disabled={!cfg || en || busy}
          onClick={() => void setRoutingConfig({ volume_enabled: true })}
        >
          Kimi master ON
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={!cfg || !en || busy}
          onClick={() => {
            if (
              !confirm(
                'Turn volume master OFF?\n\nDaily Pulse stays on DeepSeek (no Grok fallback). Market Pulse on the Desk is free headlines (no model).\nOther volume jobs may fall back to Grok.\nFull reports / agentic / podcasts are unchanged.',
              )
            )
              return
            void setRoutingConfig({ volume_enabled: false })
          }}
        >
          Kimi master OFF
        </Button>
        <span className={styles.statusMuted} style={{ flex: 1, minWidth: 180 }}>
          {status}
        </span>
      </div>

      {err && <div className={styles.statusErr} style={{ marginBottom: 8 }}>{err}</div>}

      <div
        style={{
          fontSize: 9.5,
          fontWeight: 800,
          letterSpacing: 0.7,
          textTransform: 'uppercase',
          color: '#94a3b8',
          marginBottom: 6,
        }}
      >
        Task → model
      </div>
      <div className={styles.routeTable}>
        {!tasks.length ? (
          <div style={{ padding: 12, fontSize: 11, color: '#94a3b8' }}>No tasks from server.</div>
        ) : (
          groupOrder.map((g) => {
            const list = groups[g]
            if (!list?.length) return null
            return (
              <div key={g}>
                <div className={styles.routeGroup}>{g}</div>
                {list.map((t) => {
                  const allowed = t.allowed || []
                  const route = t.route || t.default || allowed[0] || 'grok'
                  const single = allowed.length <= 1
                  const modelRes =
                    t.model_resolved || providers[route]?.model || '—'
                  const schedJob = SCHEDULED_TASKS[t.id]
                  const sched = schedJob ? auto[schedJob] : undefined
                  return (
                    <div
                      key={t.id}
                      className={`${styles.routeRow}${schedJob ? ` ${styles.routeRowSched}` : ''}`}
                    >
                      <div>
                        <div className={styles.routeTitle}>{t.label || t.id}</div>
                        <div className={styles.routeNote}>
                          <code>{modelRes}</code>
                          {t.note ? ` · ${t.note}` : ''}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        {single ? (
                          <>
                            <span style={{ fontSize: 11.5, fontWeight: 800 }}>{route}</span>
                            <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 6 }}>
                              locked
                            </span>
                          </>
                        ) : (
                          <select
                            className={styles.select}
                            style={{ minWidth: 120, height: 30, fontWeight: 700 }}
                            value={route}
                            disabled={busy}
                            onChange={(e) => onRouteChange(t.id, e.target.value)}
                          >
                            {allowed.map((a) => (
                              <option key={a} value={a}>
                                {a} — {providers[a]?.label || a}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      {schedJob ? (
                        <ScheduleControls
                          job={schedJob}
                          cfg={sched}
                          busy={busy}
                          onEnabled={(on) => void patchAuto(schedJob, { enabled: on })}
                          onClock={(v) => onClock(schedJob, v)}
                        />
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )
          })
        )}
        <div className={styles.routeGroup}>Integrations</div>
        <div className={`${styles.routeRow} ${styles.routeRowSched}`}>
          <div>
            <div className={styles.routeTitle}>SnapTrade Sync</div>
            <div className={styles.routeNote}>
              Fidelity → Positions &amp; NAV. No LLM — schedule only.
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: 11.5, fontWeight: 800 }}>—</span>
          </div>
          <ScheduleControls
            job="snaptrade_sync"
            cfg={auto.snaptrade_sync}
            busy={busy}
            onEnabled={(on) => void patchAuto('snaptrade_sync', { enabled: on })}
            onClock={(v) => onClock('snaptrade_sync', v)}
          />
        </div>
      </div>

      <div className={styles.help}>
        Keys (separate providers): <code>XAI_API_KEY</code>, <code>ANTHROPIC_API_KEY</code>,{' '}
        <code>KIMI_API_KEY</code> (Moonshot · <strong>Kimi K3</strong>),{' '}
        <code>DEEPSEEK_API_KEY</code>. Optional: <code>GROK_MODEL</code>, <code>CLAUDE_MODEL</code>,{' '}
        <code>KIMI_MODEL</code>, <code>AGENTIC_MODEL</code>. <strong>Kimi K3 ≠ DeepSeek</strong>.
        Agents / full reports: Grok · Claude · DeepSeek only (Kimi desk/podcast only).
      </div>
    </CollapsibleCard>
  )
}
