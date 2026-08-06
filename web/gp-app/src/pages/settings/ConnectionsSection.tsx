import { useCallback, useEffect, useState } from 'react'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import { fmtUsd, fmtQty } from '@/lib/format'
import styles from '../SettingsPage.module.css'

/* ── shared types ─────────────────────────────────────────────── */

type ManagedAcct = {
  fund_id: string
  name?: string
  short_name?: string
  fund_type?: string
}

type Position = {
  symbol?: string
  name?: string
  quantity?: number | null
  market_value?: number | null
}

type SnapAccount = {
  account_id: string
  account_name?: string
  account_mask?: string
  brokerage?: string
  fund_id?: string | null
  connection_id?: string
  hidden?: boolean
  last_synced_at?: string
  positions?: Position[]
  total_value?: number | null
}

type PlaidAccount = { name?: string; mask?: string; value?: number | null }
type PlaidItem = {
  item_id: string
  institution?: string
  fund_id?: string | null
  last_synced_at?: string
  accounts?: PlaidAccount[]
}
type PlaidHoldings = {
  item_id: string
  positions?: Position[]
  total_value?: number | null
}

type PanelView = 'list' | 'debug' | 'activity' | 'ytd'

const PLAID_LT_KEY = 'dga_plaid_link_token'

type PlaidLinkHandler = {
  open: () => void
  destroy?: () => void
}
type PlaidFactory = {
  create: (cfg: {
    token: string
    receivedRedirectUri?: string
    onSuccess: (public_token: string) => void | Promise<void>
    onExit?: (err?: unknown) => void
  }) => PlaidLinkHandler
}

function loadPlaidScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    const w = window as Window & { Plaid?: PlaidFactory }
    if (w.Plaid) return resolve()
    const s = document.createElement('script')
    s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Plaid Link failed to load'))
    document.head.appendChild(s)
  })
}

function fmtAgo(iso?: string | null): { text: string; color: string; mins: number } | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000))
  const ago =
    mins < 60
      ? `${mins}m ago`
      : mins < 1440
        ? `${Math.floor(mins / 60)}h ${mins % 60}m ago`
        : `${Math.floor(mins / 1440)}d ago`
  const color = mins < 120 ? '#16a34a' : mins < 1440 ? '#d97706' : '#dc2626'
  return { text: ago, color, mins }
}

function AssignSelect({
  value,
  options,
  onChange,
}: {
  value?: string | null
  options: ManagedAcct[]
  onChange: (v: string) => void
}) {
  return (
    <select
      className={styles.select}
      style={{ fontSize: 11, height: 28, width: 'auto', minWidth: 140 }}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">— Not assigned —</option>
      {options.map((m) => (
        <option key={m.fund_id} value={m.fund_id}>
          {(m.short_name || m.name || m.fund_id) +
            (m.fund_type === 'lp_fund' ? ' (Fund)' : '')}
        </option>
      ))}
    </select>
  )
}

function PositionsTable({ positions, total }: { positions: Position[]; total?: number | null }) {
  if (!positions.length) return null
  return (
    <div style={{ marginTop: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 10.5,
          color: 'var(--text-secondary)',
          marginBottom: 4,
        }}
      >
        <span style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {positions.length} Holding{positions.length === 1 ? '' : 's'}
        </span>
        <span>
          Total <strong style={{ color: 'var(--text-primary)' }}>{fmtUsd(total, 0)}</strong>
        </span>
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        <table className={styles.posTable}>
          <tbody>
            {positions.map((p, i) => (
              <tr key={`${p.symbol}-${i}`}>
                <td style={{ fontWeight: 700 }}>{p.symbol || '—'}</td>
                <td
                  style={{
                    color: 'var(--text-tertiary)',
                    maxWidth: 140,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.name || ''}
                </td>
                <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                  {fmtQty(p.quantity, 4)}
                </td>
                <td>{fmtUsd(p.market_value, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── SnapTrade ────────────────────────────────────────────────── */

async function snapJson<T = Record<string, unknown>>(path: string, opts?: RequestInit): Promise<T> {
  try {
    return await api<T>(path, opts)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, detail: msg } as T
  }
}

async function runSnapSync(
  onTick?: (st: { stage?: string; my_elapsed_s: number; joined: boolean }) => void,
): Promise<Record<string, unknown>> {
  const s = await snapJson<{
    ok?: boolean
    async?: boolean
    detail?: string
    [k: string]: unknown
  }>('/api/snaptrade/sync', {
    method: 'POST',
    body: '{}',
  })
  if (!s.ok) throw new Error(String(s.detail || 'Sync failed to start'))
  if (!s.async) return s
  const t0 = Date.now()
  let joined: boolean | null = null
  while (Date.now() - t0 < 600_000) {
    await new Promise((r) => setTimeout(r, 3000))
    let st: {
      status?: string
      stage?: string
      elapsed_s?: number
      error?: string
      result?: Record<string, unknown>
    }
    try {
      st = await snapJson('/api/snaptrade/sync-status')
    } catch {
      continue
    }
    if (st.status === 'done') return st.result || { ok: true }
    if (st.status === 'error') throw new Error(st.error || 'Sync failed')
    if (joined === null) joined = (st.elapsed_s || 0) > (Date.now() - t0) / 1000 + 5
    onTick?.({
      stage: st.stage,
      joined: !!joined,
      my_elapsed_s: Math.round((Date.now() - t0) / 1000),
    })
  }
  throw new Error(
    'Sync exceeded 10 minutes — it was likely stuck; it will be cleaned up automatically. Try again, and if this repeats use 🔍 Diagnose.',
  )
}

function SnapTradePanel() {
  const [badge, setBadge] = useState('…')
  const [body, setBodyMsg] = useState<string | null>('Loading…')
  const [accounts, setAccounts] = useState<SnapAccount[]>([])
  const [managed, setManaged] = useState<ManagedAcct[]>([])
  const [configured, setConfigured] = useState(false)
  const [ready, setReady] = useState(false)
  const [view, setView] = useState<PanelView>('list')
  const [extraHtml, setExtraHtml] = useState<string | null>(null)
  const [syncLabel, setSyncLabel] = useState('↻ Sync')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setView('list')
    setExtraHtml(null)
    try {
      const st = await api<{
        configured?: boolean
        encryption_ready?: boolean
        connected_accounts?: number
      }>('/api/snaptrade/status')
      const ok = !!(st.configured && st.encryption_ready)
      setConfigured(!!st.configured)
      setReady(ok)
      setBadge(
        !st.configured ? 'NOT CONFIGURED' : st.connected_accounts ? 'CONNECTED' : 'READY',
      )
      if (!st.configured) {
        setBodyMsg(
          "SnapTrade isn't configured. Set SNAPTRADE_CLIENT_ID / SNAPTRADE_CONSUMER_KEY on Railway.",
        )
        setAccounts([])
        return
      }
      if (!st.encryption_ready) {
        setBodyMsg(
          'DATA_ENCRYPTION_KEY not set — linking disabled until at-rest encryption is on.',
        )
        setAccounts([])
        return
      }
      const ad = await api<{ accounts?: SnapAccount[]; managed_accounts?: ManagedAcct[] }>(
        '/api/snaptrade/accounts',
      )
      setAccounts(ad.accounts || [])
      setManaged(ad.managed_accounts || [])
      setBodyMsg(null)
    } catch {
      setBodyMsg('Could not load SnapTrade accounts.')
      setAccounts([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const connect = async () => {
    setBusy(true)
    try {
      const d = await snapJson<{ ok?: boolean; redirect_uri?: string; detail?: string }>(
        '/api/snaptrade/connect',
        { method: 'POST', body: '{}' },
      )
      if (!d.ok || !d.redirect_uri) {
        alert(d.detail || 'Could not start SnapTrade connection.')
        return
      }
      window.open(d.redirect_uri, '_blank')
      setBodyMsg('Finish linking Fidelity in the new tab, then click ↻ Sync to pull holdings.')
      ;(async () => {
        for (let round = 0; round < 3; round++) {
          try {
            const r = await runSnapSync()
            if (((r.synced as unknown[]) || []).length) {
              await load()
              return
            }
          } catch {
            /* retry */
          }
          await new Promise((res) => setTimeout(res, 10000))
        }
      })()
    } catch (e) {
      alert('SnapTrade connect failed: ' + (e instanceof Error ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  const sync = async () => {
    setBusy(true)
    setSyncLabel('↻ Syncing…')
    try {
      const r = await runSnapSync((st) => {
        setSyncLabel(
          `↻ ${st.stage || 'Syncing…'} ${st.my_elapsed_s}s${st.joined ? ' (joined running sync)' : ''}`,
        )
      })
      if (r.ok === false) alert('Sync failed: ' + String(r.detail || ''))
      else if ((r.errors as unknown[] | undefined)?.length) {
        const errors = r.errors as Array<{ account_id?: string; fund_id?: string; stage?: string; error?: string }>
        alert(
          `Synced ${((r.synced as unknown[]) || []).length} account(s).\n\n${errors.length} issue(s):\n` +
            errors
              .map(
                (e) =>
                  `• ${e.account_id || e.fund_id || e.stage || '?'}: ${e.error}`,
              )
              .join('\n'),
        )
      }
    } catch (e) {
      alert('Sync failed: ' + (e instanceof Error ? e.message : e))
    }
    setSyncLabel('↻ Sync')
    setBusy(false)
    await load()
  }

  const assign = async (accountId: string, fundId: string) => {
    try {
      await api('/api/snaptrade/assign', {
        method: 'POST',
        body: JSON.stringify({ account_id: accountId, fund_id: fundId || null }),
      })
    } catch (e) {
      alert('Assign failed: ' + (e instanceof Error ? e.message : e))
    }
  }

  const hide = async (accountId: string, hidden: boolean) => {
    try {
      await api('/api/snaptrade/hide', {
        method: 'POST',
        body: JSON.stringify({ account_id: accountId, hidden }),
      })
      await load()
    } catch (e) {
      alert((hidden ? 'Ignore' : 'Restore') + ' failed: ' + (e instanceof Error ? e.message : e))
    }
  }

  const removeConn = async (connectionId: string, brokerage: string, n: number) => {
    if (
      !confirm(
        `Remove the entire ${brokerage} connection?\n\nThis disconnects the brokerage and deletes ALL ${n ? n + ' ' : ''}account${n === 1 ? '' : 's'} under it. To hide just one account, use “Ignore” instead.\n\nThis cannot be undone.`,
      )
    )
      return
    try {
      await api('/api/snaptrade/remove', {
        method: 'POST',
        body: JSON.stringify({ connection_id: connectionId }),
      })
    } catch {
      /* ignore */
    }
    await load()
  }

  const debug = async () => {
    setView('debug')
    setExtraHtml('Reading raw SnapTrade response…')
    try {
      const d = await api('/api/snaptrade/debug')
      setExtraHtml(JSON.stringify(d, null, 2))
    } catch (e) {
      setExtraHtml('Diagnose failed: ' + (e instanceof Error ? e.message : e))
    }
  }

  const activity = async () => {
    setView('activity')
    setBusy(true)
    setExtraHtml('Pulling YTD transaction history from SnapTrade…')
    try {
      const s = await api<{
        ok?: boolean
        detail?: string
        synced?: Array<{ activities?: number }>
        errors?: Array<{ error?: string }>
        start_date?: string
        end_date?: string
      }>('/api/snaptrade/activities/sync', { method: 'POST', body: '{}' })
      if (!s.ok) throw new Error(s.detail || 'sync failed')
      const d = await api<{
        summary?: {
          buy_count?: number
          buy_value?: number
          sell_count?: number
          sell_value?: number
          net_external_flow?: number
        }
        activities?: Array<{
          trade_date?: string
          type?: string
          symbol?: string
          units?: number
          price?: number
          amount?: number
          account_name?: string
        }>
        count?: number
        year?: number
      }>('/api/snaptrade/activities')
      const sum = d.summary || {}
      const acts = d.activities || []
      const lines = [
        `${sum.buy_count || 0} buys · ${fmtUsd(sum.buy_value, 0)}  |  ${sum.sell_count || 0} sells · ${fmtUsd(sum.sell_value, 0)}  |  Net: ${fmtUsd(sum.net_external_flow, 0)}`,
        `${d.count || 0} in ${d.year || ''} · ${(s.synced || []).reduce((t, x) => t + (x.activities || 0), 0)} pulled (${s.start_date || ''}→${s.end_date || ''})`,
        '',
      ]
      if ((s.errors || []).length) {
        lines.push(`${s.errors!.length} account(s) errored: ${s.errors![0].error || ''}`)
        lines.push('')
      }
      acts.slice(0, 100).forEach((a) => {
        lines.push(
          `${a.trade_date || ''}  ${a.type || ''}  ${a.symbol || '—'}  qty=${a.units ?? ''}  ${a.amount != null ? fmtUsd(a.amount, 0) : ''}  ${a.account_name || ''}`,
        )
      })
      if (!acts.length) lines.push(`No activity in ${d.year || 'this year'}.`)
      setExtraHtml(lines.join('\n'))
    } catch (e) {
      setExtraHtml('Activity sync failed: ' + (e instanceof Error ? e.message : e))
    }
    setBusy(false)
  }

  const ytdTest = async () => {
    setView('ytd')
    setExtraHtml('Reconstructing Jan-1 values from trades + price history…')
    try {
      const ad = await api<{ accounts?: SnapAccount[]; managed_accounts?: ManagedAcct[] }>(
        '/api/snaptrade/accounts',
      )
      const accts = ad.accounts || []
      const mAccts = ad.managed_accounts || []
      const nameByFund: Record<string, string> = {}
      mAccts.forEach((m) => {
        nameByFund[m.fund_id] = m.short_name || m.name || m.fund_id
      })
      const fundIds = Array.from(
        new Set(accts.filter((a) => a.fund_id).map((a) => a.fund_id as string)),
      )
      if (!fundIds.length) {
        setExtraHtml('No accounts assigned to a fund yet — assign one, then run the test.')
        return
      }
      const rows: string[] = [
        'Fund | Jan-1 equity | Now equity | Recon YTD % | CSV YTD % | Diff | Priced?',
        '—'.repeat(40),
      ]
      for (const fid of fundIds) {
        const r = await api<{
          jan1_equity?: number
          now_equity?: number
          reconstructed_ytd_price_pct?: number
          csv_ytd_pct?: number
          diff_vs_csv?: number
          fully_priced?: boolean
        }>(`/api/snaptrade/ytd-reconstruct?fund_id=${encodeURIComponent(fid)}`)
        rows.push(
          `${nameByFund[fid] || fid} | ${fmtUsd(r.jan1_equity, 0)} | ${fmtUsd(r.now_equity, 0)} | ${
            r.reconstructed_ytd_price_pct != null
              ? r.reconstructed_ytd_price_pct.toFixed(2) + '%'
              : '—'
          } | ${r.csv_ytd_pct != null ? r.csv_ytd_pct.toFixed(2) + '%' : '—'} | ${
            r.diff_vs_csv != null ? r.diff_vs_csv.toFixed(2) : '—'
          } | ${r.fully_priced ? '✓' : 'partial'}`,
        )
      }
      setExtraHtml(rows.join('\n'))
    } catch (e) {
      setExtraHtml('YTD test failed: ' + (e instanceof Error ? e.message : e))
    }
  }

  const forceRefresh = async () => {
    setBusy(true)
    setBodyMsg('Asking SnapTrade to re-pull Fidelity…')
    try {
      const r = await snapJson<{
        ok?: boolean
        detail?: string
        errors?: Array<{ error?: string }>
        refreshed?: number
      }>('/api/snaptrade/refresh', { method: 'POST', body: '{}' })
      if (!r.ok) throw new Error(String(r.detail || 'refresh failed'))
      if ((r.errors || []).length) {
        const emsg = r.errors![0].error || ''
        if (/1141|real-time|already return|not enabled/i.test(emsg)) {
          setBodyMsg(
            'SnapTrade reports holdings are already real-time. Re-reading via Sync…',
          )
          setTimeout(() => void sync(), 1200)
        } else {
          setBodyMsg('SnapTrade refused the refresh: ' + emsg)
        }
        setBusy(false)
        return
      }
      setBodyMsg(
        `SnapTrade is re-pulling Fidelity (refreshed ${r.refreshed} connection). Auto-syncing shortly…`,
      )
      setTimeout(() => {
        setBusy(false)
        void sync()
      }, 50_000)
    } catch (e) {
      setBodyMsg('Force refresh failed: ' + (e instanceof Error ? e.message : e))
      setBusy(false)
    }
  }

  const visible = accounts.filter((a) => !a.hidden)
  const hidden = accounts.filter((a) => a.hidden)
  let maxSync: number | null = null
  accounts.forEach((a) => {
    if (a.last_synced_at) {
      const t = Date.parse(a.last_synced_at)
      if (!Number.isNaN(t) && (maxSync === null || t > maxSync)) maxSync = t
    }
  })
  const fresh =
    maxSync != null
      ? fmtAgo(new Date(maxSync).toISOString())
      : null

  const conns: Record<string, { brokerage: string; n: number }> = {}
  accounts.forEach((a) => {
    if (a.connection_id) {
      if (!conns[a.connection_id])
        conns[a.connection_id] = { brokerage: a.brokerage || 'connection', n: 0 }
      conns[a.connection_id].n++
    }
  })

  return (
    <CollapsibleCard title="🔗 Fidelity · SnapTrade" badge={badge} defaultOpen>
      <div className={styles.row} style={{ marginBottom: 8, gap: 5 }}>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void activity()}>
          📊 YTD
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void ytdTest()}>
          🧮 YTD Test
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void debug()}>
          🐞 Diag
        </Button>
        <Button size="sm" variant="secondary" disabled={busy || !ready} onClick={() => void forceRefresh()}>
          ⟳ Force
        </Button>
        <Button size="sm" variant="secondary" disabled={busy || !ready} onClick={() => void sync()}>
          {syncLabel}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={busy || !ready}
          style={{ marginLeft: 'auto' }}
          onClick={() => void connect()}
        >
          + Connect
        </Button>
      </div>

      {view !== 'list' && extraHtml != null ? (
        <div>
          <pre className={styles.pre} style={{ maxHeight: 380 }}>
            {extraHtml}
          </pre>
          <Button size="sm" variant="ghost" style={{ marginTop: 8 }} onClick={() => void load()}>
            ← Back
          </Button>
        </div>
      ) : body ? (
        <div className={configured && ready ? styles.statusMuted : styles.statusErr}>{body}</div>
      ) : (
        <>
          {fresh && (
            <div className={styles.row} style={{ marginBottom: 10, fontSize: 11 }}>
              <span
                className={styles.freshDot}
                style={{ background: fresh.color }}
              />
              <span>
                Holdings last synced{' '}
                <strong style={{ color: fresh.color }}>{fresh.text}</strong>
                {fresh.mins >= 1440 && (
                  <span style={{ color: '#dc2626' }}> · stale — click ↻ Sync</span>
                )}
              </span>
            </div>
          )}
          {!visible.length && (
            <div className={styles.statusMuted} style={{ marginBottom: 8 }}>
              {accounts.length
                ? 'All linked accounts are ignored. Restore one below.'
                : 'No accounts linked yet. Click + Connect, finish in the new tab, then ↻ Sync.'}
            </div>
          )}
          {visible.map((a) => (
            <div key={a.account_id} className={styles.acctCard}>
              <div className={styles.row} style={{ marginBottom: 6 }}>
                <span className={styles.acctTitle}>
                  {a.account_name || a.brokerage || 'Account'}{' '}
                  <span style={{ color: 'var(--text-tertiary)', fontWeight: 600 }}>
                    ••{a.account_mask || ''}
                  </span>
                </span>
                <span style={{ flex: 1 }} />
                <Button size="sm" variant="ghost" onClick={() => void hide(a.account_id, true)}>
                  Ignore
                </Button>
              </div>
              <div className={styles.row} style={{ marginBottom: 8, fontSize: 11 }}>
                <span>Assign to:</span>
                <AssignSelect
                  value={a.fund_id}
                  options={managed}
                  onChange={(v) => void assign(a.account_id, v)}
                />
              </div>
              {(a.positions || []).length ? (
                <PositionsTable positions={a.positions || []} total={a.total_value} />
              ) : (
                <div className={styles.statusMuted} style={{ marginTop: 6 }}>
                  No positions returned yet — click ↻ Sync once the connection finishes.
                </div>
              )}
              <div className={styles.statusMuted} style={{ marginTop: 6, fontSize: 10 }}>
                {a.brokerage || ''} · Last synced{' '}
                {a.last_synced_at
                  ? String(a.last_synced_at).slice(0, 16).replace('T', ' ')
                  : '—'}{' '}
                · read-only auto-import
              </div>
            </div>
          ))}
          {hidden.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-tertiary)' }}>
              <div
                style={{
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  marginBottom: 4,
                }}
              >
                {hidden.length} Ignored
              </div>
              {hidden.map((a) => (
                <div key={a.account_id} className={styles.row} style={{ padding: '4px 0' }}>
                  <span style={{ flex: 1 }}>
                    {a.account_name || a.brokerage || 'Account'} ••{a.account_mask || ''}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => void hide(a.account_id, false)}>
                    Restore
                  </Button>
                </div>
              ))}
            </div>
          )}
          {Object.keys(conns).length > 0 && (
            <div
              style={{
                marginTop: 10,
                borderTop: '1px solid var(--border-subtle)',
                paddingTop: 8,
              }}
            >
              {Object.entries(conns).map(([cid, c]) => (
                <Button
                  key={cid}
                  size="sm"
                  variant="danger"
                  style={{ marginRight: 6, marginBottom: 4 }}
                  onClick={() => void removeConn(cid, c.brokerage, c.n)}
                >
                  Remove {c.brokerage} connection ({c.n} account{c.n === 1 ? '' : 's'})
                </Button>
              ))}
            </div>
          )}
        </>
      )}
      <div className={styles.help}>
        Read-only holdings via SnapTrade. Creds stay on brokerage site. Needs{' '}
        <code>SNAPTRADE_*</code> + <code>DATA_ENCRYPTION_KEY</code>.
      </div>
    </CollapsibleCard>
  )
}

/* ── Plaid ────────────────────────────────────────────────────── */

function PlaidPanel() {
  const [badge, setBadge] = useState('…')
  const [msg, setMsg] = useState<string | null>('Loading…')
  const [items, setItems] = useState<PlaidItem[]>([])
  const [managed, setManaged] = useState<ManagedAcct[]>([])
  const [holdings, setHoldings] = useState<Record<string, PlaidHoldings>>({})
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const st = await api<{
        configured?: boolean
        encryption_ready?: boolean
        env?: string
      }>('/api/plaid/status')
      const ok = !!(st.configured && st.encryption_ready)
      setReady(ok)
      setBadge(!st.configured ? 'NOT CONFIGURED' : (st.env || 'sandbox').toUpperCase())
      if (!st.configured) {
        setMsg(
          "Plaid isn't configured. Set PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ENV on Railway.",
        )
        setItems([])
        return
      }
      if (!st.encryption_ready) {
        setMsg(
          'DATA_ENCRYPTION_KEY not set — linking disabled until at-rest encryption is on.',
        )
        setItems([])
        return
      }
      const id = await api<{ items?: PlaidItem[]; managed_accounts?: ManagedAcct[] }>(
        '/api/plaid/items',
      )
      setItems(id.items || [])
      setManaged(id.managed_accounts || [])
      if (!(id.items || []).length) {
        setMsg('No accounts linked yet. Click + Connect bank to link your brokerage.')
      } else {
        setMsg(null)
      }
      try {
        const hd = await api<{ items?: PlaidHoldings[] }>('/api/plaid/holdings')
        const map: Record<string, PlaidHoldings> = {}
        ;(hd.items || []).forEach((h) => {
          map[h.item_id] = h
        })
        setHoldings(map)
      } catch {
        setHoldings({})
      }
    } catch {
      setMsg('Could not load linked accounts.')
      setItems([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // OAuth resume (Fidelity etc.)
  useEffect(() => {
    if (!/oauth_state_id=/.test(window.location.search)) return
    const lt = localStorage.getItem(PLAID_LT_KEY)
    if (!lt) return
    ;(async () => {
      try {
        await loadPlaidScript()
        const Plaid = (window as Window & { Plaid?: PlaidFactory }).Plaid
        if (!Plaid) return
        Plaid.create({
          token: lt,
          receivedRedirectUri: window.location.href,
          onSuccess: async (public_token) => {
            await api('/api/plaid/exchange', {
              method: 'POST',
              body: JSON.stringify({ public_token }),
            })
            localStorage.removeItem(PLAID_LT_KEY)
            try {
              window.history.replaceState({}, '', window.location.pathname)
            } catch {
              /* ignore */
            }
            await load()
          },
          onExit: () => {
            localStorage.removeItem(PLAID_LT_KEY)
            try {
              window.history.replaceState({}, '', window.location.pathname)
            } catch {
              /* ignore */
            }
          },
        }).open()
      } catch {
        /* leave user on page */
      }
    })()
  }, [load])

  const connect = async () => {
    setBusy(true)
    try {
      await loadPlaidScript()
      const d = await api<{ ok?: boolean; link_token?: string; detail?: string }>(
        '/api/plaid/link-token',
        { method: 'POST', body: '{}' },
      )
      if (!d.ok || !d.link_token) {
        alert(d.detail || 'Could not start Plaid Link.')
        return
      }
      localStorage.setItem(PLAID_LT_KEY, d.link_token)
      const Plaid = (window as Window & { Plaid?: PlaidFactory }).Plaid
      if (!Plaid) throw new Error('Plaid not available')
      Plaid.create({
        token: d.link_token,
        onSuccess: async (public_token) => {
          setMsg('Linking… pulling first holdings snapshot.')
          try {
            await api('/api/plaid/exchange', {
              method: 'POST',
              body: JSON.stringify({ public_token }),
            })
          } catch (e) {
            alert(e instanceof Error ? e.message : 'Link exchange failed.')
          }
          localStorage.removeItem(PLAID_LT_KEY)
          await load()
        },
        onExit: (err) => {
          localStorage.removeItem(PLAID_LT_KEY)
          if (err) void load()
        },
      }).open()
    } catch (e) {
      alert('Plaid Link could not load: ' + (e instanceof Error ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  const syncItem = async (itemId: string) => {
    try {
      await api('/api/plaid/sync', {
        method: 'POST',
        body: JSON.stringify({ item_id: itemId }),
      })
    } catch {
      /* ignore */
    }
    await load()
  }

  const removeItem = async (itemId: string) => {
    if (!confirm('Disconnect this institution and delete its stored data?')) return
    try {
      await api('/api/plaid/remove', {
        method: 'POST',
        body: JSON.stringify({ item_id: itemId }),
      })
    } catch {
      /* ignore */
    }
    await load()
  }

  const assign = async (itemId: string, fundId: string) => {
    try {
      await api('/api/plaid/assign', {
        method: 'POST',
        body: JSON.stringify({ item_id: itemId, fund_id: fundId || null }),
      })
    } catch (e) {
      alert('Assign failed: ' + (e instanceof Error ? e.message : e))
    }
  }

  return (
    <CollapsibleCard
      title="🔗 Banks · Plaid"
      badge={badge}
      defaultOpen
      action={
        <Button size="sm" variant="primary" disabled={!ready || busy} onClick={() => void connect()}>
          + Connect bank
        </Button>
      }
    >
      {msg && !items.length ? (
        <div className={ready ? styles.statusMuted : styles.statusErr}>{msg}</div>
      ) : (
        items.map((it) => {
          const h = holdings[it.item_id]
          const positions = h?.positions || []
          return (
            <div key={it.item_id} className={styles.acctCard}>
              <div className={styles.row} style={{ marginBottom: 6 }}>
                <span className={styles.acctTitle}>{it.institution || 'Fidelity'}</span>
                <span style={{ flex: 1 }} />
                <Button size="sm" variant="secondary" onClick={() => void syncItem(it.item_id)}>
                  ↻ Sync
                </Button>
                <Button size="sm" variant="danger" onClick={() => void removeItem(it.item_id)}>
                  Remove
                </Button>
              </div>
              <div className={styles.row} style={{ marginBottom: 8, fontSize: 11 }}>
                <span>Assign to:</span>
                <AssignSelect
                  value={it.fund_id}
                  options={managed}
                  onChange={(v) => void assign(it.item_id, v)}
                />
              </div>
              {(it.accounts || []).map((a, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '3px 0',
                    fontSize: 11.5,
                  }}
                >
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {a.name || 'Account'}{' '}
                    <span style={{ color: 'var(--text-tertiary)' }}>••{a.mask || ''}</span>
                  </span>
                  <span style={{ fontWeight: 700 }}>{fmtUsd(a.value, 0)}</span>
                </div>
              ))}
              <PositionsTable positions={positions} total={h?.total_value} />
              <div className={styles.statusMuted} style={{ marginTop: 6, fontSize: 10 }}>
                Last synced{' '}
                {it.last_synced_at
                  ? String(it.last_synced_at).slice(0, 16).replace('T', ' ')
                  : '—'}{' '}
                · holdings shown read-only
              </div>
            </div>
          )
        })
      )}
      <div className={styles.help}>
        Non-Fidelity banks (Fidelity left Plaid Oct 2023). Needs <code>PLAID_*</code> +{' '}
        <code>DATA_ENCRYPTION_KEY</code>.
      </div>
    </CollapsibleCard>
  )
}

export function ConnectionsSection() {
  return (
    <>
      <SnapTradePanel />
      <PlaidPanel />
    </>
  )
}
