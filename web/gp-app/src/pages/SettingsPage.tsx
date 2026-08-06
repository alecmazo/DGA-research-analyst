import { useEffect, useState } from 'react'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { Empty, Spinner } from '@/components/ui/Empty'
import { api } from '@/lib/api'
import { relativeTime } from '@/lib/format'
import page from './page.module.css'
import styles from './SettingsPage.module.css'

type VolumeCfg = {
  ok?: boolean
  enabled?: boolean
  configured?: boolean
  jobs?: Record<string, boolean>
  routes?: Record<string, string>
}

type Ticket = {
  id?: string
  status?: string
  description?: string
  created_at?: string
  fixed_summary?: string
}

export function SettingsPage() {
  const [vol, setVol] = useState<VolumeCfg | null>(null)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [build, setBuild] = useState('')
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })

  const load = async () => {
    setErr(null)
    try {
      const [v, t, b] = await Promise.all([
        api<VolumeCfg>('/api/config/volume-llm'),
        api<{ tickets?: Ticket[] }>('/api/support/tickets?limit=20'),
        api<{ build?: string }>('/api/build'),
      ])
      setVol(v)
      setTickets(t.tickets || [])
      setBuild(b.build || '')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Settings failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const saveVolume = async (enabled: boolean) => {
    try {
      const d = await api<VolumeCfg>('/api/config/volume-llm', {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      })
      setVol(d)
      setMsg(`Volume LLM ${enabled ? 'enabled' : 'disabled'}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    }
  }

  const changePassword = async () => {
    setMsg(null)
    setErr(null)
    if (pw.next.length < 8) {
      setErr('New password must be at least 8 characters')
      return
    }
    if (pw.next !== pw.confirm) {
      setErr('New passwords do not match')
      return
    }
    try {
      await api('/api/auth/v2/change-password', {
        method: 'POST',
        body: JSON.stringify({
          current_password: pw.current,
          new_password: pw.next,
        }),
      })
      setPw({ current: '', next: '', confirm: '' })
      setMsg('Password updated')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Password change failed')
    }
  }

  if (loading) return <Spinner label="Loading settings…" />

  return (
    <div className={page.page}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Admin</p>
          <h1 className={page.h1}>Settings</h1>
          <p className={page.sub}>Models, security, support tickets, and build identity.</p>
        </div>
      </header>
      {err && <div className={page.bannerErr}>{err}</div>}
      {msg && <div className={styles.ok}>{msg}</div>}

      <div className={styles.grid}>
        <Panel title="Build" badge="live">
          <code className={styles.code}>{build || '—'}</code>
          <p className={styles.hint}>
            React shell · legacy full terminal at <a href="/gp-legacy">/gp-legacy</a>
          </p>
        </Panel>

        <Panel title="Volume LLM" badge={vol?.enabled ? 'on' : 'off'}>
          <p className={styles.hint}>
            Route Daily Pulse / pulse / prioritize to cheaper engines when enabled.
          </p>
          <div className={styles.row}>
            <Button
              size="sm"
              variant={vol?.enabled ? 'secondary' : 'primary'}
              onClick={() => void saveVolume(true)}
            >
              Enable
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void saveVolume(false)}>
              Disable
            </Button>
          </div>
          {vol?.routes && (
            <pre className={styles.pre}>{JSON.stringify(vol.routes, null, 2)}</pre>
          )}
        </Panel>

        <Panel title="Change password">
          <div className={styles.form}>
            <label>
              Current
              <input
                type="password"
                value={pw.current}
                onChange={(e) => setPw({ ...pw, current: e.target.value })}
                autoComplete="current-password"
              />
            </label>
            <label>
              New
              <input
                type="password"
                value={pw.next}
                onChange={(e) => setPw({ ...pw, next: e.target.value })}
                autoComplete="new-password"
              />
            </label>
            <label>
              Confirm
              <input
                type="password"
                value={pw.confirm}
                onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                autoComplete="new-password"
              />
            </label>
            <Button variant="primary" size="sm" onClick={() => void changePassword()}>
              Update password
            </Button>
          </div>
        </Panel>
      </div>

      <Panel title="Support tickets" badge={tickets.length} flush>
        {!tickets.length ? (
          <Empty title="No tickets" />
        ) : (
          <ul className={styles.tickets}>
            {tickets.map((t) => (
              <li key={t.id}>
                <div className={styles.tHead}>
                  <code>{t.id}</code>
                  <span className={styles.status}>{t.status}</span>
                  <span className={styles.when}>{relativeTime(t.created_at)}</span>
                </div>
                <div className={styles.tdesc}>{t.description}</div>
                {t.fixed_summary && (
                  <div className={styles.fix}>{t.fixed_summary}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
