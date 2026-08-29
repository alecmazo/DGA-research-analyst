import { useCallback, useEffect, useState } from 'react'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { Button } from '@/components/ui/Button'
import { api, apiBlob } from '@/lib/api'
import styles from '../SettingsPage.module.css'

type TrailEvent = {
  ts?: string
  actor?: string
  action?: string
  detail?: string
}

type Ticket = {
  id?: string
  status?: string
  description?: string
  created_at?: string
  fixed_at?: string
  active_tab?: string
  page_path?: string
  diagnosis?: string
  fix_trail?: TrailEvent[]
  has_screenshot?: boolean
  fixed_summary?: string
  created_by?: string
  created_by_email?: string
  context?: { role?: string; user?: string; name?: string; lp_id?: string }
}

function fmtPT(s?: string): string {
  if (!s) return '—'
  try {
    const d = new Date(String(s).replace(/\+00:00Z$/, 'Z'))
    if (Number.isNaN(d.getTime())) return String(s).slice(0, 16).replace('T', ' ')
    return (
      d.toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }) + ' PT'
    )
  } catch {
    return String(s).slice(0, 16).replace('T', ' ')
  }
}

function openSupport() {
  window.dispatchEvent(new Event('dga-open-support'))
  const w = window as Window & { openDGASupport?: () => void }
  if (typeof w.openDGASupport === 'function') w.openDGASupport()
}

export function SupportSection() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [openCount, setOpenCount] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const j = await api<{
        ok?: boolean
        tickets?: Ticket[]
        open_count?: number
      }>('/api/support/tickets?limit=30')
      setTickets(j.tickets || [])
      setOpenCount(j.open_count ?? null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load tickets')
      setTickets([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const viewShot = async (id: string) => {
    try {
      const blob = await apiBlob(`/api/support/tickets/${encodeURIComponent(id)}/screenshot`)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url)
        } catch {
          /* ignore */
        }
      }, 60_000)
    } catch {
      setErr('Screenshot unavailable')
    }
  }

  const markFixed = async (id: string) => {
    const summary =
      window.prompt('What fixed it? (short note for the trail)', 'Fixed in latest deploy') ||
      'Marked fixed'
    try {
      await api(`/api/support/tickets/${encodeURIComponent(id)}/update`, {
        method: 'POST',
        body: JSON.stringify({ status: 'fixed', fixed_summary: summary }),
      })
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Update failed')
    }
  }

  const badge =
    openCount != null ? `${openCount} open` : `${tickets.length} total`

  return (
    <CollapsibleCard
      title="🛟 Support tickets & fix trail"
      badge={badge}
      className={styles.span2}
      defaultOpen
      action={
        <div className={styles.row}>
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            ↻
          </Button>
          <Button size="sm" variant="primary" onClick={openSupport}>
            + File ticket
          </Button>
        </div>
      }
    >
      <p className={styles.hint}>
        Use <strong>🛟 Support</strong> (bottom-right) to file with auto-screenshot. LPs have the
        same button on their portal — they cannot see this list. Diagnosis runs in the background;
        ask the coding agent to <strong>fix ticket</strong>.
      </p>
      {err && <div className={styles.statusErr} style={{ marginBottom: 8 }}>{err}</div>}
      {loading && <div className={styles.statusMuted}>Loading…</div>}
      {!loading && !tickets.length && (
        <div className={styles.statusMuted}>
          No tickets yet. Use the 🛟 Support button (bottom-right) when something breaks.
        </div>
      )}
      <div style={{ maxHeight: 360, overflow: 'auto' }}>
        {tickets.map((t) => {
          const trail = (t.fix_trail || []).slice(-6).reverse()
          const open = t.status !== 'fixed' && t.status !== 'closed'
          return (
            <div key={t.id} className={styles.ticketCard}>
              <div className={styles.ticketHead}>
                <span className={styles.ticketId}>{t.id}</span>
                <span className={styles.ticketStatus}>{t.status}</span>
                {t.has_screenshot && t.id && (
                  <Button size="sm" variant="ghost" onClick={() => void viewShot(t.id!)}>
                    screenshot
                  </Button>
                )}
              </div>
              <div className={styles.ticketDesc}>{(t.description || '').slice(0, 240)}</div>
              <div className={styles.ticketMeta}>
                {(() => {
                  const ctx = t.context || {}
                  const role = String(ctx.role || '').toLowerCase()
                  const who =
                    ctx.name || t.created_by_email || ctx.user || t.created_by || ''
                  const tag = role === 'lp' ? 'LP' : role === 'gp' ? 'GP' : ''
                  return [tag, who].filter(Boolean).join(' · ')
                })()}
                {t.created_at ? ` · ${fmtPT(t.created_at)}` : ''}
                {t.fixed_at ? ` · fixed ${fmtPT(t.fixed_at)}` : ''}
                {t.active_tab ? ` · ${t.active_tab}` : ''}
                {t.page_path ? ` · ${t.page_path}` : ''}
              </div>
              {t.diagnosis && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#334155' }}>
                    Diagnosis
                  </summary>
                  <pre className={styles.pre} style={{ maxHeight: 180 }}>
                    {t.diagnosis}
                  </pre>
                </details>
              )}
              <div style={{ marginTop: 8 }}>
                <div
                  style={{
                    fontSize: 10.5,
                    fontWeight: 800,
                    letterSpacing: 0.6,
                    textTransform: 'uppercase',
                    color: '#94a3b8',
                    marginBottom: 2,
                  }}
                >
                  Fix trail (Pacific)
                </div>
                {trail.length ? (
                  trail.map((ev, i) => (
                    <div key={i} className={styles.trailLine}>
                      <strong>{fmtPT(ev.ts)}</strong> · {ev.actor} · <em>{ev.action}</em>
                      {ev.detail ? ` — ${String(ev.detail).slice(0, 180)}` : ''}
                    </div>
                  ))
                ) : (
                  <div className={styles.trailLine}>No trail events yet.</div>
                )}
              </div>
              {open && t.id ? (
                <div style={{ marginTop: 8 }}>
                  <Button size="sm" variant="secondary" onClick={() => void markFixed(t.id!)}>
                    Mark fixed
                  </Button>
                </div>
              ) : t.fixed_summary ? (
                <div style={{ marginTop: 6, fontSize: 11.5, color: '#166534' }}>
                  ✓ {t.fixed_summary}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </CollapsibleCard>
  )
}
