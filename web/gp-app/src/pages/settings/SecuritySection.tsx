import { useCallback, useEffect, useState } from 'react'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import { getCachedUser } from '@/lib/auth'
import styles from '../SettingsPage.module.css'

type MfaStatus = {
  enabled?: boolean
  encryption_ready?: boolean
  recovery_remaining?: number
}

type MfaSetup = {
  ok?: boolean
  detail?: string
  qr?: string
  secret?: string
}

type MfaEnable = {
  ok?: boolean
  detail?: string
  recovery_codes?: string[]
}

type MfaPhase = 'status' | 'setup' | 'recovery' | 'disable'

function MfaCard() {
  const [st, setSt] = useState<MfaStatus | null>(null)
  const [phase, setPhase] = useState<MfaPhase>('status')
  const [setup, setSetup] = useState<MfaSetup | null>(null)
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  const [recovery, setRecovery] = useState<string[]>([])
  const [disablePw, setDisablePw] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setErr('')
    setPhase('status')
    setRecovery([])
    setSetup(null)
    setCode('')
    setDisablePw('')
    try {
      const s = await api<MfaStatus>('/api/auth/v2/mfa/status')
      setSt(s)
    } catch {
      setSt(null)
      setErr('Could not load 2FA status.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const startSetup = async () => {
    setMsg('')
    setPhase('setup')
    try {
      const d = await api<MfaSetup>('/api/auth/v2/mfa/setup', {
        method: 'POST',
        body: '{}',
      })
      if (!d.ok) {
        setMsg(d.detail || 'Setup failed.')
        return
      }
      setSetup(d)
    } catch {
      setMsg('Setup failed.')
    }
  }

  const verify = async () => {
    if (code.trim().length < 6) {
      setMsg('Enter the 6-digit code.')
      return
    }
    try {
      const d = await api<MfaEnable>('/api/auth/v2/mfa/enable', {
        method: 'POST',
        body: JSON.stringify({ code: code.trim() }),
      })
      if (!d.ok || !d.recovery_codes) {
        setMsg(d.detail || "That code didn't match.")
        return
      }
      setRecovery(d.recovery_codes)
      setPhase('recovery')
      setSt((s) => (s ? { ...s, enabled: true } : { enabled: true }))
    } catch {
      setMsg('Verification failed.')
    }
  }

  const disable = async () => {
    if (!disablePw) {
      setMsg('Enter your password.')
      return
    }
    try {
      const d = await api<{ ok?: boolean; detail?: string }>('/api/auth/v2/mfa/disable', {
        method: 'POST',
        body: JSON.stringify({ password: disablePw }),
      })
      if (!d.ok) {
        setMsg(d.detail || 'Password incorrect.')
        return
      }
      await load()
    } catch {
      setMsg('Could not disable 2FA.')
    }
  }

  const badge = !st
    ? '…'
    : !st.encryption_ready
      ? 'UNAVAILABLE'
      : st.enabled
        ? 'ON'
        : 'OFF'

  return (
    <CollapsibleCard
      title="🔐 Two-Factor Auth"
      badge={badge}
      defaultOpen
      action={
        st?.encryption_ready ? (
          <Button
            size="sm"
            variant={st.enabled ? 'danger' : 'secondary'}
            onClick={() => {
              if (st.enabled) {
                setPhase('disable')
                setMsg('')
                setDisablePw('')
              } else {
                void startSetup()
              }
            }}
          >
            {st.enabled ? 'Disable' : 'Enable 2FA'}
          </Button>
        ) : null
      }
    >
      {err && <div className={styles.statusErr}>{err}</div>}
      {!st?.encryption_ready && !err && (
        <div className={styles.statusErr}>
          DATA_ENCRYPTION_KEY not set — 2FA can&apos;t be enabled until at-rest encryption is on.
        </div>
      )}

      {phase === 'status' && st?.encryption_ready && (
        <div className={styles.meta}>
          {st.enabled ? (
            <>
              <span className={styles.statusOk}>✓ Two-factor authentication is on.</span> You&apos;ll
              enter a 6-digit code at login.{' '}
              <span className={styles.statusMuted}>
                {st.recovery_remaining ?? 0} recovery code(s) remaining.
              </span>
            </>
          ) : (
            <>
              Protect your login with an authenticator app (Google Authenticator, Authy, 1Password).
              Required by Plaid before linking accounts. Click <strong>Enable 2FA</strong> to set it
              up.
            </>
          )}
        </div>
      )}

      {phase === 'setup' && setup && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {setup.qr && <img src={setup.qr} alt="QR" className={styles.qr} />}
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ marginBottom: 8, fontSize: 12 }}>
              1. Scan the QR with your authenticator app, or enter this key manually:
            </div>
            <code className={styles.mono} style={{ wordBreak: 'break-all' }}>
              {setup.secret}
            </code>
            <div style={{ margin: '12px 0 6px', fontSize: 12 }}>
              2. Enter the 6-digit code it shows:
            </div>
            <div className={styles.row}>
              <input
                className={styles.input}
                style={{ width: 120, textAlign: 'center', letterSpacing: 3 }}
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void verify()
                }}
              />
              <Button size="sm" variant="primary" onClick={() => void verify()}>
                Verify & Enable
              </Button>
            </div>
            {msg && <div className={styles.statusErr} style={{ marginTop: 6 }}>{msg}</div>}
          </div>
        </div>
      )}

      {phase === 'recovery' && (
        <div>
          <div className={styles.statusOk} style={{ marginBottom: 8 }}>
            ✓ Two-factor authentication is now ON.
          </div>
          <div style={{ marginBottom: 6, fontSize: 12 }}>
            Save these <strong>recovery codes</strong> somewhere safe — each works once if you lose
            your authenticator. They won&apos;t be shown again:
          </div>
          <div className={styles.recoveryBox}>
            {recovery.map((c) => (
              <div key={c}>{c}</div>
            ))}
          </div>
          <div className={styles.row} style={{ marginTop: 10 }}>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void navigator.clipboard?.writeText(recovery.join('\n'))}
            >
              📋 Copy codes
            </Button>
            <Button size="sm" variant="primary" onClick={() => void load()}>
              Done
            </Button>
          </div>
        </div>
      )}

      {phase === 'disable' && (
        <div>
          <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
            Enter your account password to turn <strong>OFF</strong> two-factor authentication:
          </div>
          <div className={styles.row}>
            <input
              className={styles.input}
              type="password"
              autoComplete="current-password"
              placeholder="Account password"
              style={{ width: 200 }}
              value={disablePw}
              onChange={(e) => setDisablePw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void disable()
              }}
            />
            <Button size="sm" variant="danger" onClick={() => void disable()}>
              Turn off 2FA
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void load()}>
              Cancel
            </Button>
          </div>
          {msg && <div className={styles.statusErr} style={{ marginTop: 6 }}>{msg}</div>}
        </div>
      )}
    </CollapsibleCard>
  )
}

function PasswordCard() {
  const user = getCachedUser()
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [build, setBuild] = useState('')

  useEffect(() => {
    void api<{ build?: string }>('/api/build')
      .then((b) => setBuild(b.build || ''))
      .catch(() => setBuild(''))
  }, [])

  const name = user?.name || 'GP'
  const email = user?.email || ''
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const initials = (
    (parts[0] || 'G')[0] + (parts[1] ? parts[1][0] : (parts[0] || 'P')[1] || 'P')
  ).toUpperCase()

  const save = async () => {
    setMsg('')
    if (!oldPw || !newPw || !confirm) {
      setOk(false)
      setMsg('Fill in all three fields.')
      return
    }
    if (newPw !== confirm) {
      setOk(false)
      setMsg('New passwords do not match.')
      return
    }
    if (newPw.length < 8) {
      setOk(false)
      setMsg('New password must be at least 8 characters.')
      return
    }
    if (newPw === oldPw) {
      setOk(false)
      setMsg('New password must be different from the current one.')
      return
    }
    setBusy(true)
    try {
      await api('/api/auth/v2/change-password', {
        method: 'POST',
        body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
      })
      setOk(true)
      setMsg('✓ Password updated — use it next time you sign in.')
      setOldPw('')
      setNewPw('')
      setConfirm('')
    } catch (e) {
      setOk(false)
      setMsg(e instanceof Error ? e.message : 'Could not change password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <CollapsibleCard title="🔑 Change password" badge="GP only" defaultOpen>
      <div className={styles.identity}>
        <div className={styles.avatar}>{initials}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>{name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
            {email || 'Signed-in GP account'}
          </div>
        </div>
      </div>
      <p className={styles.hint}>
        Update the password for <strong>your GP login</strong> (the email you use at the sign-in
        screen). Minimum 8 characters. This does not change LP passwords — reset those under Users
        &amp; Funds.
      </p>
      <label className={styles.fieldLabel}>Current password</label>
      <input
        className={styles.input}
        type="password"
        autoComplete="current-password"
        placeholder="Current password"
        style={{ marginBottom: 10 }}
        value={oldPw}
        onChange={(e) => setOldPw(e.target.value)}
      />
      <label className={styles.fieldLabel}>New password</label>
      <input
        className={styles.input}
        type="password"
        autoComplete="new-password"
        placeholder="New password (min 8 characters)"
        style={{ marginBottom: 10 }}
        value={newPw}
        onChange={(e) => setNewPw(e.target.value)}
      />
      <label className={styles.fieldLabel}>Confirm new password</label>
      <input
        className={styles.input}
        type="password"
        autoComplete="new-password"
        placeholder="Confirm new password"
        style={{ marginBottom: 12 }}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      <div className={styles.row}>
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void save()}>
          Save password
        </Button>
        {msg && (
          <span className={ok ? styles.statusOk : styles.statusErr}>{msg}</span>
        )}
      </div>
      <div className={styles.footerBar} style={{ marginTop: 12, marginLeft: -4, marginRight: -4 }}>
        <div style={{ fontSize: 9.5, color: 'var(--text-tertiary)', letterSpacing: 0.4 }}>
          Build: {build || '—'}
        </div>
      </div>
    </CollapsibleCard>
  )
}

export function SecuritySection() {
  return (
    <>
      <MfaCard />
      <PasswordCard />
    </>
  )
}
