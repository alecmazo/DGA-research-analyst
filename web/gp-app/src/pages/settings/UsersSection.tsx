import { useCallback, useEffect, useState } from 'react'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import styles from '../SettingsPage.module.css'

type User = {
  lp_id: string
  name?: string
  email?: string
  role?: string
  demo_mode?: boolean
  must_change_password?: boolean
  fund_memberships?: Record<string, string>
  managed_account_ids?: string[]
}

type FundRow = {
  fund_id: string
  fund_name?: string
  short_name?: string
}

type AcctRow = {
  fund_id: string
  account_name?: string
  fund_name?: string
  short_name?: string
}

/* ── LP roster ────────────────────────────────────────────────── */

function LpRoster() {
  const [users, setUsers] = useState<User[]>([])
  const [funds, setFunds] = useState<FundRow[]>([])
  const [accts, setAccts] = useState<AcctRow[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPw, setNewPw] = useState('')
  const [addMsg, setAddMsg] = useState('')
  const [err, setErr] = useState('')
  const [editState, setEditState] = useState<
    Record<
      string,
      {
        email: string
        pw: string
        fundChecks: Record<string, boolean>
        fundAliases: Record<string, string>
        acctChecks: Record<string, boolean>
        saveMsg: string
      }
    >
  >({})

  const load = useCallback(async () => {
    setErr('')
    try {
      const [uResp, overview] = await Promise.all([
        api<{ users?: User[] }>('/api/v2/admin/lp/list'),
        api<{ funds?: FundRow[]; managed_accounts?: AcctRow[] }>('/api/v2/lp/me/overview'),
      ])
      const list = (uResp.users || []).filter((u) => u.role !== 'admin')
      setUsers(list)
      setFunds(overview.funds || [])
      setAccts(overview.managed_accounts || [])
      const next: typeof editState = {}
      list.forEach((u) => {
        const fundChecks: Record<string, boolean> = {}
        const fundAliases: Record<string, string> = {}
        ;(overview.funds || []).forEach((f) => {
          const fname = f.fund_name || ''
          fundChecks[fname] = fname in (u.fund_memberships || {})
          fundAliases[fname] = (u.fund_memberships || {})[fname] || ''
        })
        const acctChecks: Record<string, boolean> = {}
        ;(overview.managed_accounts || []).forEach((a) => {
          const aname = a.account_name || a.fund_name || ''
          acctChecks[aname] = (u.managed_account_ids || []).includes(aname)
        })
        next[u.lp_id] = {
          email: u.email || '',
          pw: '',
          fundChecks,
          fundAliases,
          acctChecks,
          saveMsg: '',
        }
      })
      setEditState(next)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load user list')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const createLp = async () => {
    if (!newName.trim() || !newEmail.trim() || !newPw.trim()) {
      setAddMsg('All fields required.')
      return
    }
    if (newPw.length < 6) {
      setAddMsg('Password must be ≥6 chars.')
      return
    }
    try {
      await api('/api/v2/admin/lp/create', {
        method: 'POST',
        body: JSON.stringify({
          name: newName.trim(),
          email: newEmail.trim(),
          password: newPw.trim(),
          fund_memberships: {},
          managed_account_ids: [],
        }),
      })
      setAddMsg('✅ Created — set their assignments below.')
      setNewName('')
      setNewEmail('')
      setNewPw('')
      setTimeout(() => {
        setShowAdd(false)
        setAddMsg('')
        void load()
      }, 1400)
    } catch (e) {
      setAddMsg('❌ ' + (e instanceof Error ? e.message : e))
    }
  }

  const removeLp = async (lpId: string, name: string) => {
    if (
      !confirm(
        `Remove LP account for "${name}"?\n\nThis will permanently delete their login. Their commitment data in the fund remains. This cannot be undone.`,
      )
    )
      return
    try {
      await api(`/api/auth/v2/user/${encodeURIComponent(lpId)}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      alert('Could not remove: ' + (e instanceof Error ? e.message : e))
    }
  }

  const saveLp = async (lpId: string, origEmail: string) => {
    const ed = editState[lpId]
    if (!ed) return
    const fm: Record<string, string> = {}
    Object.entries(ed.fundChecks).forEach(([fname, on]) => {
      if (on) fm[fname] = (ed.fundAliases[fname] || '').trim()
    })
    const ma = Object.entries(ed.acctChecks)
      .filter(([, on]) => on)
      .map(([n]) => n)

    setEditState((s) => ({
      ...s,
      [lpId]: { ...s[lpId], saveMsg: 'Saving…' },
    }))
    try {
      await api('/api/v2/admin/lp/update-assignments', {
        method: 'POST',
        body: JSON.stringify({
          lp_id: lpId,
          fund_memberships: fm,
          managed_account_ids: ma,
        }),
      })
      const newEmail = ed.email.trim()
      if (newEmail && newEmail !== origEmail) {
        await api('/api/v2/admin/lp/update-email', {
          method: 'POST',
          body: JSON.stringify({ lp_id: lpId, new_email: newEmail }),
        })
      }
      if (ed.pw.trim()) {
        await api('/api/v2/admin/lp/set-password', {
          method: 'POST',
          body: JSON.stringify({
            lp_id: lpId,
            new_password: ed.pw.trim(),
            must_change: true,
          }),
        })
      }
      setEditState((s) => ({
        ...s,
        [lpId]: { ...s[lpId], pw: '', saveMsg: '✅ Saved' },
      }))
      setTimeout(() => void load(), 1200)
    } catch (e) {
      setEditState((s) => ({
        ...s,
        [lpId]: {
          ...s[lpId],
          saveMsg: '❌ ' + (e instanceof Error ? e.message : e),
        },
      }))
    }
  }

  return (
    <CollapsibleCard
      title="LP User Management"
      badge={String(users.length)}
      className={styles.span2}
      defaultOpen
      action={
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setShowAdd((v) => !v)
            setAddMsg('')
          }}
        >
          {showAdd ? '✕ Cancel' : '+ Add LP'}
        </Button>
      }
    >
      {showAdd && (
        <div className={styles.addForm}>
          <div className={styles.addFormTitle}>NEW LP ACCOUNT</div>
          <div className={styles.formGrid}>
            <div>
              <div className={styles.fieldLabel}>Full name</div>
              <input
                className={styles.input}
                placeholder="Jane Smith"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div>
              <div className={styles.fieldLabel}>Email</div>
              <input
                className={styles.input}
                type="email"
                placeholder="jane@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
            <div>
              <div className={styles.fieldLabel}>Initial password</div>
              <input
                className={styles.input}
                placeholder="Temp (≥6)"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
              />
            </div>
            <div>
              <Button size="sm" variant="primary" onClick={() => void createLp()}>
                Create LP
              </Button>
              {addMsg && (
                <div style={{ fontSize: 10, marginTop: 4 }} className={styles.meta}>
                  {addMsg}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {err && <div className={styles.statusErr}>{err}</div>}
      {!users.length && !err && (
        <div className={styles.statusMuted} style={{ padding: 12 }}>
          No LP users yet.
        </div>
      )}
      {users.map((u) => {
        const isLP = u.role === 'lp'
        const fKeys = Object.keys(u.fund_memberships || {})
        const aKeys = u.managed_account_ids || []
        const summary =
          [fKeys.length ? `${fKeys.length} fund${fKeys.length > 1 ? 's' : ''}` : '', aKeys.length ? `${aKeys.length} acct${aKeys.length > 1 ? 's' : ''}` : '']
            .filter(Boolean)
            .join(' · ') || 'none'
        const ed = editState[u.lp_id]
        const open = expanded === u.lp_id
        return (
          <div key={u.lp_id}>
            <div className={styles.userRow}>
              <div style={{ flex: '0 0 220px', minWidth: 0 }}>
                <div className={styles.userName}>{u.name}</div>
                <div className={styles.userEmail}>{u.email}</div>
              </div>
              <span style={{ flex: 1 }} />
              <span
                className={styles.roleTag}
                style={
                  u.role === 'gp'
                    ? {
                        background: 'rgba(91,184,212,0.2)',
                        color: 'var(--brand-600)',
                      }
                    : { background: 'rgba(0,0,0,0.05)', color: 'var(--text-tertiary)' }
                }
              >
                {(u.role || '').toUpperCase()}
              </span>
              {u.must_change_password && (
                <span
                  className={styles.roleTag}
                  style={{
                    color: '#92400e',
                    background: 'rgba(251,191,36,0.15)',
                    border: '1px solid rgba(251,191,36,0.4)',
                  }}
                >
                  TEMP PW
                </span>
              )}
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{summary}</div>
              {isLP && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setExpanded(open ? null : u.lp_id)}
                  >
                    {open ? 'Close ▴' : 'Edit ▾'}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => void removeLp(u.lp_id, u.name || u.lp_id)}
                  >
                    ✕ Remove
                  </Button>
                </>
              )}
            </div>
            {isLP && open && ed && (
              <div className={styles.editPanel}>
                <div className={styles.assignGrid}>
                  <div>
                    <div className={styles.assignHead}>LP Funds</div>
                    {funds.length ? (
                      funds.map((f) => {
                        const fname = f.fund_name || ''
                        return (
                          <div key={f.fund_id} className={styles.checkRow}>
                            <input
                              type="checkbox"
                              checked={!!ed.fundChecks[fname]}
                              onChange={(e) =>
                                setEditState((s) => ({
                                  ...s,
                                  [u.lp_id]: {
                                    ...s[u.lp_id],
                                    fundChecks: {
                                      ...s[u.lp_id].fundChecks,
                                      [fname]: e.target.checked,
                                    },
                                  },
                                }))
                              }
                            />
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                flex: 1,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {fname}
                            </span>
                            <input
                              className={styles.aliasInput}
                              placeholder="alias"
                              value={ed.fundAliases[fname] || ''}
                              onChange={(e) =>
                                setEditState((s) => ({
                                  ...s,
                                  [u.lp_id]: {
                                    ...s[u.lp_id],
                                    fundAliases: {
                                      ...s[u.lp_id].fundAliases,
                                      [fname]: e.target.value,
                                    },
                                  },
                                }))
                              }
                            />
                          </div>
                        )
                      })
                    ) : (
                      <div className={styles.statusMuted}>No LP funds created yet.</div>
                    )}
                  </div>
                  <div>
                    <div className={styles.assignHead} style={{ color: '#b45309' }}>
                      Managed Accounts
                    </div>
                    {accts.length ? (
                      accts.map((a) => {
                        const aname = a.account_name || a.fund_name || ''
                        return (
                          <div key={a.fund_id} className={styles.checkRow}>
                            <input
                              type="checkbox"
                              checked={!!ed.acctChecks[aname]}
                              onChange={(e) =>
                                setEditState((s) => ({
                                  ...s,
                                  [u.lp_id]: {
                                    ...s[u.lp_id],
                                    acctChecks: {
                                      ...s[u.lp_id].acctChecks,
                                      [aname]: e.target.checked,
                                    },
                                  },
                                }))
                              }
                            />
                            <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>
                              {aname}
                            </span>
                            {a.short_name && (
                              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                                {a.short_name}
                              </span>
                            )}
                          </div>
                        )
                      })
                    ) : (
                      <div className={styles.statusMuted}>No managed accounts created yet.</div>
                    )}
                  </div>
                </div>
                <div
                  className={styles.row}
                  style={{
                    paddingTop: 12,
                    borderTop: '1px solid var(--border-subtle)',
                  }}
                >
                  <span className={styles.fieldLabel} style={{ margin: 0 }}>
                    Email
                  </span>
                  <input
                    className={styles.input}
                    type="email"
                    style={{ width: 220 }}
                    value={ed.email}
                    onChange={(e) =>
                      setEditState((s) => ({
                        ...s,
                        [u.lp_id]: { ...s[u.lp_id], email: e.target.value },
                      }))
                    }
                  />
                  <span className={styles.fieldLabel} style={{ margin: 0 }}>
                    Force Reset PW
                  </span>
                  <input
                    className={styles.input}
                    type="password"
                    placeholder="New temp password"
                    style={{ width: 180 }}
                    value={ed.pw}
                    onChange={(e) =>
                      setEditState((s) => ({
                        ...s,
                        [u.lp_id]: { ...s[u.lp_id], pw: e.target.value },
                      }))
                    }
                  />
                  <Button size="sm" variant="primary" onClick={() => void saveLp(u.lp_id, u.email || '')}>
                    Save Changes
                  </Button>
                  {ed.saveMsg && <span className={styles.meta}>{ed.saveMsg}</span>}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </CollapsibleCard>
  )
}

/* ── Admin roster ─────────────────────────────────────────────── */

function AdminRoster() {
  const [admins, setAdmins] = useState<User[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [pwExpand, setPwExpand] = useState<string | null>(null)
  const [pwInputs, setPwInputs] = useState<Record<string, string>>({})
  const [pwMsgs, setPwMsgs] = useState<Record<string, string>>({})
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPw, setNewPw] = useState('')
  const [demoMode, setDemoMode] = useState(false)
  const [addMsg, setAddMsg] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await api<{ users?: User[] }>('/api/v2/admin/lp/list')
      setAdmins((d.users || []).filter((u) => u.role === 'admin'))
    } catch {
      setAdmins([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const create = async () => {
    if (!newName.trim() || !newEmail.trim() || !newPw.trim()) {
      setAddMsg('All fields required.')
      return
    }
    if (newPw.length < 6) {
      setAddMsg('Password must be ≥6 chars.')
      return
    }
    try {
      await api('/api/auth/v2/admin/create', {
        method: 'POST',
        body: JSON.stringify({
          name: newName.trim(),
          email: newEmail.trim(),
          password: newPw.trim(),
          demo_mode: demoMode,
        }),
      })
      setAddMsg('✅ Admin account created — they can log in immediately.')
      setNewName('')
      setNewEmail('')
      setNewPw('')
      setDemoMode(false)
      setTimeout(() => {
        setShowAdd(false)
        setAddMsg('')
        void load()
      }, 1400)
    } catch (e) {
      setAddMsg('❌ ' + (e instanceof Error ? e.message : e))
    }
  }

  const remove = async (lpId: string, name: string) => {
    if (!confirm(`Remove admin account for "${name}"?\n\nThis cannot be undone.`)) return
    try {
      await api(`/api/auth/v2/user/${encodeURIComponent(lpId)}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      alert('Could not remove: ' + (e instanceof Error ? e.message : e))
    }
  }

  const setPassword = async (lpId: string) => {
    const pw = (pwInputs[lpId] || '').trim()
    if (!pw || pw.length < 8) {
      setPwMsgs((m) => ({ ...m, [lpId]: '≥ 8 characters required.' }))
      return
    }
    try {
      await api('/api/v2/admin/lp/set-password', {
        method: 'POST',
        body: JSON.stringify({ lp_id: lpId, new_password: pw, must_change: false }),
      })
      setPwMsgs((m) => ({ ...m, [lpId]: '✅ Password updated.' }))
      setPwInputs((p) => ({ ...p, [lpId]: '' }))
    } catch (e) {
      setPwMsgs((m) => ({
        ...m,
        [lpId]: '❌ ' + (e instanceof Error ? e.message : e),
      }))
    }
  }

  return (
    <CollapsibleCard
      title="Admin User Management"
      badge="GOD MODE"
      className={styles.span2}
      defaultOpen={false}
      action={
        <Button size="sm" variant="secondary" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? '✕ Cancel' : '+ Add Admin'}
        </Button>
      }
    >
      {showAdd && (
        <div className={styles.addForm}>
          <div className={styles.addFormTitle} style={{ color: '#c9a84c' }}>
            NEW ADMIN ACCOUNT
          </div>
          <div className={styles.hint} style={{ marginBottom: 8 }}>
            Full GP + LP access. For testing or trusted advisors.
          </div>
          <div className={styles.formGrid}>
            <div>
              <div className={styles.fieldLabel}>Full name</div>
              <input
                className={styles.input}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div>
              <div className={styles.fieldLabel}>Email</div>
              <input
                className={styles.input}
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
            <div>
              <div className={styles.fieldLabel}>Password</div>
              <input
                className={styles.input}
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
              />
            </div>
            <div>
              <Button size="sm" variant="primary" onClick={() => void create()}>
                Create Admin
              </Button>
              {addMsg && <div style={{ fontSize: 10, marginTop: 4 }}>{addMsg}</div>}
            </div>
            <div style={{ gridColumn: '1 / -1' }} className={styles.checkRow}>
              <input
                type="checkbox"
                id="admin-demo"
                checked={demoMode}
                onChange={(e) => setDemoMode(e.target.checked)}
              />
              <label htmlFor="admin-demo" style={{ fontSize: 10.5, cursor: 'pointer' }}>
                <strong>Demo Mode</strong> — anonymise LPs; read-only on admin writes
              </label>
            </div>
          </div>
        </div>
      )}
      {!admins.length && (
        <div className={styles.statusMuted} style={{ padding: 12 }}>
          No admin accounts yet.
        </div>
      )}
      {admins.map((u) => (
        <div key={u.lp_id}>
          <div className={styles.userRow}>
            <span className={styles.userName}>{u.name}</span>
            <span className={styles.userEmail}>{u.email}</span>
            {u.demo_mode && (
              <span
                className={styles.roleTag}
                style={{
                  background: 'rgba(91,184,212,0.12)',
                  color: 'var(--brand-600)',
                  border: '1px solid rgba(91,184,212,0.3)',
                }}
              >
                🎭 DEMO
              </span>
            )}
            <span
              className={styles.roleTag}
              style={{
                marginLeft: 'auto',
                background: 'rgba(201,168,76,0.15)',
                color: '#a88a3a',
                border: '1px solid rgba(201,168,76,0.3)',
              }}
            >
              ⚡ ADMIN
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPwExpand(pwExpand === u.lp_id ? null : u.lp_id)}
            >
              {pwExpand === u.lp_id ? 'Reset PW ▴' : 'Reset PW ▾'}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => void remove(u.lp_id, u.name || u.lp_id)}
            >
              REMOVE
            </Button>
          </div>
          {pwExpand === u.lp_id && (
            <div className={styles.editPanel}>
              <div className={styles.row}>
                <span className={styles.fieldLabel} style={{ margin: 0 }}>
                  New Password
                </span>
                <input
                  className={styles.input}
                  type="password"
                  placeholder="New password (≥8 chars)"
                  style={{ width: 200 }}
                  value={pwInputs[u.lp_id] || ''}
                  onChange={(e) =>
                    setPwInputs((p) => ({ ...p, [u.lp_id]: e.target.value }))
                  }
                />
                <Button size="sm" variant="primary" onClick={() => void setPassword(u.lp_id)}>
                  Set Password
                </Button>
                {pwMsgs[u.lp_id] && <span className={styles.meta}>{pwMsgs[u.lp_id]}</span>}
              </div>
            </div>
          )}
        </div>
      ))}
    </CollapsibleCard>
  )
}

/* ── Fund admin ───────────────────────────────────────────────── */

function FundAdmin() {
  const [options, setOptions] = useState<
    Array<{ id: string; name: string; short: string; type: string }>
  >([])
  const [rnId, setRnId] = useState('')
  const [rnName, setRnName] = useState('')
  const [rnShort, setRnShort] = useState('')
  const [rnMsg, setRnMsg] = useState('')
  const [cfName, setCfName] = useState('')
  const [cfShort, setCfShort] = useState('')
  const [cfType, setCfType] = useState('lp_fund')
  const [cfInception, setCfInception] = useState('')
  const [cfMgmt, setCfMgmt] = useState('1.5')
  const [cfCarry, setCfCarry] = useState('20')
  const [cfHurdle, setCfHurdle] = useState('8')
  const [cfMsg, setCfMsg] = useState('')

  const loadOptions = useCallback(async () => {
    try {
      const d = await api<{
        funds?: Array<{ fund_id: string; fund_name?: string; short_name?: string }>
        managed_accounts?: Array<{
          fund_id: string
          account_name?: string
          short_name?: string
        }>
      }>('/api/v2/lp/me/overview')
      const all = [
        ...(d.funds || []).map((f) => ({
          id: f.fund_id,
          name: f.fund_name || '',
          short: f.short_name || '',
          type: 'LP Fund',
        })),
        ...(d.managed_accounts || []).map((a) => ({
          id: a.fund_id,
          name: a.account_name || '',
          short: a.short_name || '',
          type: 'Managed Acct',
        })),
      ]
      setOptions(all)
    } catch {
      setOptions([])
    }
  }, [])

  useEffect(() => {
    void loadOptions()
  }, [loadOptions])

  const onSelect = (id: string) => {
    setRnId(id)
    const opt = options.find((o) => o.id === id)
    setRnName(opt?.name || '')
    setRnShort(opt?.short || '')
  }

  const rename = async () => {
    if (!rnId) {
      setRnMsg('Select a fund or account first.')
      return
    }
    if (!rnName.trim()) {
      setRnMsg('Full name is required.')
      return
    }
    if (rnShort.trim().length < 2) {
      setRnMsg('Short code must be ≥ 2 characters.')
      return
    }
    try {
      await api(`/api/v2/gp/fund/${encodeURIComponent(rnId)}/rename`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: rnName.trim(),
          short_name: rnShort.trim().toUpperCase(),
        }),
      })
      setRnMsg(`✅ Renamed to "${rnName.trim()}" (${rnShort.trim().toUpperCase()})`)
      await loadOptions()
    } catch (e) {
      setRnMsg('Error: ' + (e instanceof Error ? e.message : e))
    }
  }

  const create = async () => {
    if (!cfName.trim()) {
      setCfMsg('Fund name is required.')
      return
    }
    if (cfShort.trim().length < 2) {
      setCfMsg('Short code must be at least 2 characters.')
      return
    }
    try {
      const d = await api<{ created?: boolean }>('/api/v2/gp/fund/create', {
        method: 'POST',
        body: JSON.stringify({
          name: cfName.trim(),
          short_name: cfShort.trim().toUpperCase(),
          fund_type: cfType,
          inception_date: cfInception || '',
          mgmt_fee_pct: parseFloat(cfMgmt || '1.5') / 100,
          carry_pct: parseFloat(cfCarry || '20') / 100,
          hurdle_pct: parseFloat(cfHurdle || '8') / 100,
        }),
      })
      setCfMsg(
        d.created
          ? `✅ Created "${cfName.trim()}" (${cfShort.trim().toUpperCase()})`
          : `✓ Already exists: ${cfName.trim()}`,
      )
      setCfName('')
      setCfShort('')
      await loadOptions()
    } catch (e) {
      setCfMsg('Error: ' + (e instanceof Error ? e.message : e))
    }
  }

  return (
    <CollapsibleCard title="Fund Administration" badge="GP ONLY" className={styles.span2} defaultOpen={false}>
      <div className={styles.assignHead}>Rename</div>
      <div className={styles.formGrid} style={{ marginBottom: 12 }}>
        <div>
          <div className={styles.fieldLabel}>Select</div>
          <select
            className={styles.select}
            value={rnId}
            onChange={(e) => onSelect(e.target.value)}
          >
            <option value="">— fund or account —</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                [{o.type}] {o.name} ({o.short})
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className={styles.fieldLabel}>Full name</div>
          <input
            className={styles.input}
            value={rnName}
            onChange={(e) => setRnName(e.target.value)}
          />
        </div>
        <div>
          <div className={styles.fieldLabel}>Code</div>
          <input
            className={styles.input}
            value={rnShort}
            maxLength={12}
            style={{ textTransform: 'uppercase' }}
            onChange={(e) => setRnShort(e.target.value)}
          />
        </div>
        <div>
          <Button size="sm" variant="secondary" onClick={() => void rename()}>
            Rename
          </Button>
          {rnMsg && <div style={{ fontSize: 10, marginTop: 4 }}>{rnMsg}</div>}
        </div>
      </div>
      <hr style={{ border: 'none', borderTop: '1px solid var(--border-subtle)', marginBottom: 10 }} />
      <div className={styles.assignHead}>Create new</div>
      <div className={styles.hint} style={{ marginBottom: 8 }}>
        Set NAV on Fund tab after creation. Fees entered as percents (1.5 → 0.015).
      </div>
      <div className={styles.formGrid}>
        <div>
          <div className={styles.fieldLabel}>Full name</div>
          <input
            className={styles.input}
            placeholder="DGA Capital Fund IV, LP"
            value={cfName}
            onChange={(e) => setCfName(e.target.value)}
          />
        </div>
        <div>
          <div className={styles.fieldLabel}>Code</div>
          <input
            className={styles.input}
            placeholder="DGAF-IV"
            maxLength={12}
            style={{ textTransform: 'uppercase' }}
            value={cfShort}
            onChange={(e) => setCfShort(e.target.value)}
          />
        </div>
        <div>
          <div className={styles.fieldLabel}>Type</div>
          <select
            className={styles.select}
            value={cfType}
            onChange={(e) => setCfType(e.target.value)}
          >
            <option value="lp_fund">LP Fund</option>
            <option value="managed_account">Managed Account</option>
          </select>
        </div>
        <div>
          <div className={styles.fieldLabel}>Inception</div>
          <input
            className={styles.input}
            type="date"
            value={cfInception}
            onChange={(e) => setCfInception(e.target.value)}
          />
        </div>
        <div>
          <div className={styles.fieldLabel}>Mgmt %</div>
          <input
            className={styles.input}
            type="number"
            step={0.1}
            min={0}
            max={5}
            value={cfMgmt}
            onChange={(e) => setCfMgmt(e.target.value)}
          />
        </div>
        <div>
          <div className={styles.fieldLabel}>Carry %</div>
          <input
            className={styles.input}
            type="number"
            step={1}
            min={0}
            max={50}
            value={cfCarry}
            onChange={(e) => setCfCarry(e.target.value)}
          />
        </div>
        <div>
          <div className={styles.fieldLabel}>Hurdle %</div>
          <input
            className={styles.input}
            type="number"
            step={0.5}
            min={0}
            max={20}
            value={cfHurdle}
            onChange={(e) => setCfHurdle(e.target.value)}
          />
        </div>
        <div>
          <Button size="sm" variant="primary" onClick={() => void create()}>
            Create
          </Button>
          {cfMsg && <div style={{ fontSize: 10, marginTop: 4 }}>{cfMsg}</div>}
        </div>
      </div>
    </CollapsibleCard>
  )
}

export function UsersSection() {
  return (
    <>
      <LpRoster />
      <AdminRoster />
      <FundAdmin />
    </>
  )
}
