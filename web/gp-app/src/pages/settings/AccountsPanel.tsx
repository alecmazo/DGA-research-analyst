import { useCallback, useEffect, useState } from 'react'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import { getCachedUser } from '@/lib/auth'
import styles from '../SettingsPage.module.css'

type User = {
  lp_id: string
  name?: string
  email?: string
  role?: string
  demo_mode?: boolean
  must_change_password?: boolean
  has_password?: boolean
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

type Edit = {
  email: string
  pw: string
  requireChange: boolean
  fundChecks: Record<string, boolean>
  fundAliases: Record<string, string>
  acctChecks: Record<string, boolean>
  msg: string
  ok: boolean
}

function accountAssigned(ids: string[], account: AcctRow): boolean {
  const name = (account.account_name || account.fund_name || '').trim().toLowerCase()
  const short = (account.short_name || '').trim().toLowerCase()
  return ids.some((raw) => {
    const a = raw.trim().toLowerCase()
    return !!a && (a === name || (!!short && a === short))
  })
}

function minPassword(user: User): number {
  return user.demo_mode ? 6 : 8
}

function DemoLoginPanel() {
  const [login, setLogin] = useState<{ email?: string; password?: string } | null>(null)
  useEffect(() => {
    void api<{
      credentials?: { login?: { email?: string; password?: string } }
    }>('/api/v2/admin/demo/status')
      .then((d) => setLogin(d.credentials?.login || null))
      .catch(() => setLogin(null))
  }, [])
  if (!login?.email) return null
  return (
    <div className={styles.help} style={{ marginBottom: 12 }}>
      <div className={styles.fieldLabel} style={{ marginBottom: 4 }}>
        Prospect demo login
      </div>
      <div>
        Email <code>{login.email}</code>
        {' · '}
        Password <code>{login.password}</code>
      </div>
      <div className={styles.meta} style={{ marginTop: 4 }}>
        Public sandbox. Live books never appear in that session.
      </div>
    </div>
  )
}

export function AccountsPanel() {
  const me = getCachedUser()
  const [users, setUsers] = useState<User[]>([])
  const [funds, setFunds] = useState<FundRow[]>([])
  const [accts, setAccts] = useState<AcctRow[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPw, setNewPw] = useState('')
  const [newRole, setNewRole] = useState<'lp' | 'gp' | 'admin'>('lp')
  const [addMsg, setAddMsg] = useState('')
  const [err, setErr] = useState('')
  const [editState, setEditState] = useState<Record<string, Edit>>({})

  const load = useCallback(async () => {
    setErr('')
    try {
      const [uResp, overview] = await Promise.all([
        api<{ users?: User[] }>('/api/v2/admin/lp/list'),
        api<{ funds?: FundRow[]; managed_accounts?: AcctRow[] }>('/api/v2/lp/me/overview'),
      ])
      const list = uResp.users || []
      setUsers(list)
      setFunds(overview.funds || [])
      setAccts(overview.managed_accounts || [])
      const next: Record<string, Edit> = {}
      list.forEach((u) => {
        const fundChecks: Record<string, boolean> = {}
        const fundAliases: Record<string, string> = {}
        ;(overview.funds || []).forEach((f) => {
          const fname = f.fund_name || ''
          const memberships = u.fund_memberships || {}
          const key =
            Object.keys(memberships).find(
              (k) => k.trim().toLowerCase() === fname.trim().toLowerCase(),
            ) || ''
          fundChecks[fname] = !!key
          fundAliases[fname] = key ? memberships[key] || '' : ''
        })
        const acctChecks: Record<string, boolean> = {}
        ;(overview.managed_accounts || []).forEach((a) => {
          const aname = a.account_name || a.fund_name || ''
          acctChecks[aname] = accountAssigned(u.managed_account_ids || [], a)
        })
        next[u.lp_id] = {
          email: u.email || '',
          pw: '',
          requireChange: u.role === 'lp',
          fundChecks,
          fundAliases,
          acctChecks,
          msg: '',
          ok: false,
        }
      })
      setEditState(next)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load accounts')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const note = (lpId: string, msg: string, ok: boolean) => {
    setEditState((s) => ({
      ...s,
      [lpId]: { ...s[lpId], msg, ok },
    }))
  }

  const createAccount = async () => {
    if (!newName.trim() || !newEmail.trim() || !newPw.trim()) {
      setAddMsg('Name, email, and password are required.')
      return
    }
    if (newPw.length < 8) {
      setAddMsg('Password must be at least 8 characters.')
      return
    }
    try {
      await api('/api/v2/admin/lp/create', {
        method: 'POST',
        body: JSON.stringify({
          name: newName.trim(),
          email: newEmail.trim(),
          password: newPw.trim(),
          role: newRole,
          fund_memberships: {},
          managed_account_ids: [],
        }),
      })
      setAddMsg('Account created.')
      setNewName('')
      setNewEmail('')
      setNewPw('')
      setNewRole('lp')
      setTimeout(() => {
        setShowAdd(false)
        setAddMsg('')
        void load()
      }, 800)
    } catch (e) {
      setAddMsg(e instanceof Error ? e.message : 'Could not create the account')
    }
  }

  const saveEmail = async (u: User) => {
    const ed = editState[u.lp_id]
    if (!ed) return
    const next = ed.email.trim()
    if (!next || !next.includes('@')) {
      note(u.lp_id, 'Enter a valid email.', false)
      return
    }
    if (next === (u.email || '')) {
      note(u.lp_id, 'Email is unchanged.', true)
      return
    }
    try {
      await api('/api/v2/admin/lp/update-email', {
        method: 'POST',
        body: JSON.stringify({ lp_id: u.lp_id, new_email: next }),
      })
      note(u.lp_id, 'Email saved. They sign in with the new address.', true)
      if (me?.lp_id === u.lp_id) {
        try {
          const fresh = await api<User>('/api/auth/v2/me')
          localStorage.setItem('dga_v2_user', JSON.stringify(fresh))
        } catch {
          /* session still valid; the address updates on the next sign-in */
        }
      }
      setTimeout(() => void load(), 600)
    } catch (e) {
      note(u.lp_id, e instanceof Error ? e.message : 'Could not change email', false)
    }
  }

  const savePassword = async (u: User) => {
    const ed = editState[u.lp_id]
    if (!ed) return
    const pw = ed.pw.trim()
    const min = minPassword(u)
    if (pw.length < min) {
      note(u.lp_id, `Password must be at least ${min} characters.`, false)
      return
    }
    try {
      await api('/api/v2/admin/lp/set-password', {
        method: 'POST',
        body: JSON.stringify({
          lp_id: u.lp_id,
          new_password: pw,
          must_change: ed.requireChange && !u.demo_mode,
        }),
      })
      note(
        u.lp_id,
        ed.requireChange && !u.demo_mode
          ? 'Password set. They choose a new one on the next sign-in.'
          : 'Password set.',
        true,
      )
      setEditState((s) => ({ ...s, [u.lp_id]: { ...s[u.lp_id], pw: '' } }))
      setTimeout(() => void load(), 600)
    } catch (e) {
      note(u.lp_id, e instanceof Error ? e.message : 'Could not set password', false)
    }
  }

  const clearPassword = async (u: User) => {
    if (me?.lp_id === u.lp_id) return
    if (
      !confirm(
        `Remove the password for ${u.email || u.name || 'this account'}?\n\nThey stay on the list and cannot sign in until you set a new password.`,
      )
    )
      return
    try {
      await api('/api/v2/admin/lp/clear-password', {
        method: 'POST',
        body: JSON.stringify({ lp_id: u.lp_id }),
      })
      note(u.lp_id, 'Password removed. Set a new one before they can sign in.', true)
      setTimeout(() => void load(), 600)
    } catch (e) {
      note(u.lp_id, e instanceof Error ? e.message : 'Could not remove password', false)
    }
  }

  const saveAssignments = async (u: User) => {
    const ed = editState[u.lp_id]
    if (!ed) return
    const fm: Record<string, string> = {}
    Object.entries(ed.fundChecks).forEach(([fname, on]) => {
      if (on) fm[fname] = (ed.fundAliases[fname] || '').trim()
    })
    const checked = Object.entries(ed.acctChecks)
      .filter(([, on]) => on)
      .map(([n]) => n)
    const known = new Set(
      accts.flatMap((a) => {
        const name = (a.account_name || a.fund_name || '').trim().toLowerCase()
        const short = (a.short_name || '').trim().toLowerCase()
        return [name, short].filter(Boolean)
      }),
    )
    const ma = [...checked]
    for (const raw of u.managed_account_ids || []) {
      const a = raw.trim().toLowerCase()
      if (!a || known.has(a)) continue
      if (!ma.some((n) => n.toLowerCase() === a)) ma.push(raw)
    }
    try {
      await api('/api/v2/admin/lp/update-assignments', {
        method: 'POST',
        body: JSON.stringify({
          lp_id: u.lp_id,
          fund_memberships: fm,
          managed_account_ids: ma,
        }),
      })
      note(u.lp_id, 'Books saved.', true)
      setTimeout(() => void load(), 600)
    } catch (e) {
      note(u.lp_id, e instanceof Error ? e.message : 'Could not save books', false)
    }
  }

  const removeAccount = async (u: User) => {
    if (me?.lp_id === u.lp_id) return
    if (
      !confirm(
        `Remove the login for ${u.name || u.email || u.lp_id}?\n\nTheir fund records stay. The login is gone.`,
      )
    )
      return
    try {
      await api(`/api/auth/v2/user/${encodeURIComponent(u.lp_id)}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not remove the account')
    }
  }

  return (
    <CollapsibleCard
      title="Accounts"
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
          {showAdd ? 'Cancel' : 'Add account'}
        </Button>
      }
    >
      <p className={styles.hint}>
        One list for GP, admin, and LP logins. Change the email, set a password, or remove the
        password without deleting the account. An LP also gets the books they can see.
      </p>
      <DemoLoginPanel />
      {showAdd && (
        <div className={styles.addForm}>
          <div className={styles.addFormTitle}>New account</div>
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
                type="password"
                autoComplete="new-password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
              />
            </div>
            <div>
              <div className={styles.fieldLabel}>Role</div>
              <select
                className={styles.select}
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as 'lp' | 'gp' | 'admin')}
              >
                <option value="lp">LP — assigned books only</option>
                <option value="gp">GP — every fund and account</option>
                <option value="admin">Admin — same access as GP</option>
              </select>
            </div>
            <div>
              <Button size="sm" variant="primary" onClick={() => void createAccount()}>
                Create
              </Button>
              {addMsg && (
                <div className={styles.meta} style={{ marginTop: 4 }}>
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
          No accounts yet.
        </div>
      )}
      {users.map((u) => {
        const ed = editState[u.lp_id]
        const open = expanded === u.lp_id
        const self = me?.lp_id === u.lp_id
        const isLP = u.role === 'lp'
        const fKeys = Object.keys(u.fund_memberships || {})
        const aKeys = u.managed_account_ids || []
        const books =
          isLP
            ? [fKeys.length ? `${fKeys.length} fund${fKeys.length > 1 ? 's' : ''}` : '', aKeys.length ? `${aKeys.length} account${aKeys.length > 1 ? 's' : ''}` : '']
                .filter(Boolean)
                .join(' · ') || 'no books'
            : 'all books'
        return (
          <div key={u.lp_id}>
            <div className={styles.userRow}>
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <div className={styles.userName}>
                  {u.name || 'Account'}
                  {self ? ' · you' : ''}
                </div>
                <div className={styles.userEmail}>{u.email}</div>
              </div>
              <span className={styles.roleTag}>{ (u.role || 'lp').toUpperCase() }</span>
              {u.demo_mode && <span className={styles.roleTag}>DEMO</span>}
              {u.has_password === false && <span className={styles.roleTag}>NO PASSWORD</span>}
              {u.must_change_password && <span className={styles.roleTag}>MUST CHANGE</span>}
              <span className={styles.meta}>{books}</span>
              <Button size="sm" variant="secondary" onClick={() => setExpanded(open ? null : u.lp_id)}>
                {open ? 'Close' : 'Edit'}
              </Button>
              {!self && (
                <Button size="sm" variant="danger" onClick={() => void removeAccount(u)}>
                  Remove login
                </Button>
              )}
            </div>
            {open && ed && (
              <div className={styles.editPanel}>
                <div className={styles.fieldLabel}>Email</div>
                <div className={styles.row}>
                  <input
                    className={styles.input}
                    type="email"
                    style={{ width: 260 }}
                    value={ed.email}
                    onChange={(e) =>
                      setEditState((s) => ({
                        ...s,
                        [u.lp_id]: { ...s[u.lp_id], email: e.target.value },
                      }))
                    }
                  />
                  <Button size="sm" variant="secondary" onClick={() => void saveEmail(u)}>
                    Save email
                  </Button>
                </div>
                <div className={styles.fieldLabel} style={{ marginTop: 12 }}>
                  Password
                </div>
                <div className={styles.row}>
                  <input
                    className={styles.input}
                    type="password"
                    autoComplete="new-password"
                    placeholder={u.has_password === false ? 'Set a password' : 'New password'}
                    style={{ width: 220 }}
                    value={ed.pw}
                    onChange={(e) =>
                      setEditState((s) => ({
                        ...s,
                        [u.lp_id]: { ...s[u.lp_id], pw: e.target.value },
                      }))
                    }
                  />
                  {!u.demo_mode && (
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={ed.requireChange}
                        onChange={(e) =>
                          setEditState((s) => ({
                            ...s,
                            [u.lp_id]: { ...s[u.lp_id], requireChange: e.target.checked },
                          }))
                        }
                      />
                      Change on next sign-in
                    </label>
                  )}
                  <Button size="sm" variant="primary" onClick={() => void savePassword(u)}>
                    Set password
                  </Button>
                  {!self && u.has_password !== false && (
                    <Button size="sm" variant="danger" onClick={() => void clearPassword(u)}>
                      Remove password
                    </Button>
                  )}
                </div>
                {isLP && (
                  <>
                    <div className={styles.assignGrid} style={{ marginTop: 14 }}>
                      <div>
                        <div className={styles.assignHead}>Funds</div>
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
                                <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>{fname}</span>
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
                          <div className={styles.statusMuted}>No LP funds yet.</div>
                        )}
                      </div>
                      <div>
                        <div className={styles.assignHead}>Managed accounts</div>
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
                                <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>{aname}</span>
                              </div>
                            )
                          })
                        ) : (
                          <div className={styles.statusMuted}>No managed accounts yet.</div>
                        )}
                      </div>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => void saveAssignments(u)}>
                      Save books
                    </Button>
                  </>
                )}
                {ed.msg && (
                  <div className={ed.ok ? styles.statusOk : styles.statusErr} style={{ marginTop: 8 }}>
                    {ed.msg}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </CollapsibleCard>
  )
}
