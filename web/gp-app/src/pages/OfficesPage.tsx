import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { getCachedUser } from '@/lib/auth'
import { Button } from '@/components/ui/Button'
import page from './page.module.css'
import styles from './OfficesPage.module.css'

type Trial = {
  id: string
  name: string
  contact_name: string
  email: string
  status: string
  created_at?: string | null
}

type Payload = {
  live?: { name: string; status: string; books: string }
  trials?: Trial[]
}

function when(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function OfficesPage() {
  const demo = !!getCachedUser()?.demo_mode
  const [data, setData] = useState<Payload | null>(null)
  const [err, setErr] = useState('')
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    if (demo) return
    setErr('')
    try {
      setData(await api<Payload>('/api/offices'))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load offices')
    }
  }, [demo])

  useEffect(() => {
    void load()
  }, [load])

  const openTrial = async () => {
    setBusy(true)
    setNotice('')
    setErr('')
    try {
      const res = await api<{ office: Trial }>('/api/offices', {
        method: 'POST',
        body: JSON.stringify({
          name,
          contact_name: contact,
          email,
          password,
        }),
      })
      setName('')
      setContact('')
      setEmail('')
      setPassword('')
      setNotice(
        `${res.office.name} can sign in at portfolio.dgacapital.com with ${res.office.email}. They see the sample workspace, not DGA books.`,
      )
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not open the trial')
    } finally {
      setBusy(false)
    }
  }

  const setStatus = async (office: Trial, status: 'trial' | 'paused') => {
    setErr('')
    try {
      await api(`/api/offices/${encodeURIComponent(office.id)}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      })
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update the trial')
    }
  }

  return (
    <div className={`${page.page} ${styles.page}`}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Settings</p>
          <h1 className={page.h1}>Family offices</h1>
        </div>
        <Link to="/settings" className={styles.back}>
          Back to settings
        </Link>
      </header>
      <p className={styles.lead}>
        Open a trial for an office that wants to use the desk. A trial signs into the sample workspace.
        It does not see DGA books, notes, or accounts. Trials share that sample desk until an office has its own database.
      </p>

      {demo && <p className={styles.warn}>This page is for the live office only.</p>}

      {!demo && (
        <>
          <section className={styles.live}>
            <div>
              <strong>{data?.live?.name || 'DGA Capital'}</strong>
              <span>{data?.live?.books || 'This database'}</span>
            </div>
            <em>Live</em>
          </section>

          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault()
              void openTrial()
            }}
          >
            <h2>Open a trial</h2>
            <div className={styles.fields}>
              <label>
                Office
                <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required />
              </label>
              <label>
                Contact
                <input value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="off" />
              </label>
              <label>
                Login email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="off"
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
              </label>
            </div>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? 'Opening…' : 'Open trial'}
            </Button>
          </form>

          {notice && <p className={styles.notice}>{notice}</p>}
          {err && <p className={styles.warn}>{err}</p>}

          <section className={styles.list}>
            <h2>Trials</h2>
            {(data?.trials || []).length === 0 ? (
              <p className={styles.empty}>No trials yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Office</th>
                    <th>Contact</th>
                    <th>Login</th>
                    <th>Opened</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(data?.trials || []).map((office) => (
                    <tr key={office.id}>
                      <td>{office.name}</td>
                      <td>{office.contact_name || '—'}</td>
                      <td>{office.email}</td>
                      <td>{when(office.created_at)}</td>
                      <td className={office.status === 'paused' ? styles.paused : styles.trial}>
                        {office.status === 'paused' ? 'Paused' : 'Trial'}
                      </td>
                      <td>
                        {office.status === 'paused' ? (
                          <button type="button" onClick={() => void setStatus(office, 'trial')}>
                            Resume
                          </button>
                        ) : (
                          <button type="button" onClick={() => void setStatus(office, 'paused')}>
                            Pause
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  )
}
