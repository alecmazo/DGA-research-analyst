import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { getCachedUser } from '@/lib/auth'
import { Button } from '@/components/ui/Button'
import page from './page.module.css'
import styles from './OfficesPage.module.css'

type Office = {
  id: string
  name: string
  contact_name: string
  email: string
  status: string
  slug?: string | null
  db_name?: string | null
  created_at?: string | null
}

type Payload = {
  live?: { name: string; status: string; db_name: string; service: string }
  offices?: Office[]
}

function slugify(name: string): string {
  let raw = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  raw = raw.replace(/_+/g, '_')
  if (raw && !/^[a-z]/.test(raw)) raw = `office_${raw}`
  return raw.slice(0, 31).replace(/_+$/g, '')
}

function when(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function statusWord(status: string): string {
  if (status === 'ready') return 'Database marked ready'
  if (status === 'held') return 'On hold'
  return 'Database not created'
}

function Setup({ dbName, email }: { dbName: string; email: string }) {
  const steps = [
    'This page stores the office name in DGA’s database only. It does not copy books, notes, or users.',
    `Create an empty Postgres database named ${dbName}. Do not add a schema or a tenant column to the DGA database.`,
    `Create a second web service from this same repo, branch main. Set its DATABASE_URL to ${dbName}. Leave DGA’s DATABASE_URL on the current service.`,
    'Start that service once. The app creates its own tables on the empty database. Books and notes start empty.',
    `On that service only, create the GP login for ${email || 'the contact email'}. That login does not exist on portfolio.dgacapital.com.`,
    'Give the service its own hostname. Logo and office name are settings in that database.',
    'Come back here and mark the office ready when that service answers. This site never opens their database.',
  ]
  return (
    <ol className={styles.steps}>
      {steps.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ol>
  )
}

export function OfficesPage() {
  const demo = !!getCachedUser()?.demo_mode
  const [data, setData] = useState<Payload | null>(null)
  const [err, setErr] = useState('')
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [contact, setContact] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

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

  const offices = data?.offices || []
  const focus = offices.find((o) => o.id === selected) || offices[0] || null
  const previewDb = slug ? `dga_${slug}` : 'dga_<name>'

  const addOffice = async () => {
    setBusy(true)
    setNotice('')
    setErr('')
    try {
      const res = await api<{ office: Office }>('/api/offices', {
        method: 'POST',
        body: JSON.stringify({
          name,
          contact_name: contact,
          email,
          slug,
        }),
      })
      setName('')
      setContact('')
      setEmail('')
      setSlug('')
      setSlugTouched(false)
      setSelected(res.office.id)
      setNotice(
        `${res.office.name} is on the list. Its database name is ${res.office.db_name}. Nothing was created in Postgres yet.`,
      )
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add the office')
    } finally {
      setBusy(false)
    }
  }

  const setStatus = async (office: Office, status: 'planned' | 'held' | 'ready') => {
    setErr('')
    try {
      await api(`/api/offices/${encodeURIComponent(office.id)}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      })
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update the office')
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
        Add an office here. Each office gets its own Postgres database and its own web service from this repo.
        This deployment stays DGA. Adding an office does not create the database and does not make a login on this site.
      </p>

      {demo && <p className={styles.warn}>This page is for the live office only.</p>}

      {!demo && (
        <>
          <section className={styles.live}>
            <div>
              <strong>{data?.live?.name || 'DGA Capital'}</strong>
              <span>Service {data?.live?.service || 'web'} · {data?.live?.db_name || 'this database'}</span>
            </div>
            <em>Live</em>
          </section>

          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault()
              void addOffice()
            }}
          >
            <h2>Add an office</h2>
            <div className={styles.fields}>
              <label>
                Office
                <input
                  value={name}
                  onChange={(e) => {
                    const next = e.target.value
                    setName(next)
                    if (!slugTouched) setSlug(slugify(next))
                  }}
                  autoComplete="off"
                  required
                />
              </label>
              <label>
                Contact
                <input value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="off" />
              </label>
              <label>
                Contact email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="off"
                  required
                />
              </label>
              <label>
                Database
                <input
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true)
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Database slug"
                />
              </label>
            </div>
            <p className={styles.dbHint}>Database name {previewDb}. The service that uses it is created later, not from this form.</p>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? 'Adding…' : 'Add office'}
            </Button>
          </form>

          {notice && <p className={styles.notice}>{notice}</p>}
          {err && <p className={styles.warn}>{err}</p>}

          <section className={styles.list}>
            <h2>Offices</h2>
            {offices.length === 0 ? (
              <p className={styles.empty}>No other offices yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Office</th>
                    <th>Contact</th>
                    <th>Database</th>
                    <th>Added</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {offices.map((office) => (
                    <tr
                      key={office.id}
                      className={focus?.id === office.id ? styles.picked : undefined}
                      onClick={() => setSelected(office.id)}
                    >
                      <td>{office.name}</td>
                      <td>
                        {office.contact_name || '—'}
                        <span className={styles.sub}>{office.email}</span>
                      </td>
                      <td>{office.db_name || '—'}</td>
                      <td>{when(office.created_at)}</td>
                      <td className={office.status === 'ready' ? styles.trial : styles.paused}>
                        {statusWord(office.status)}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {office.status === 'held' ? (
                          <button type="button" onClick={() => void setStatus(office, 'planned')}>
                            Resume
                          </button>
                        ) : (
                          <button type="button" onClick={() => void setStatus(office, 'held')}>
                            Hold
                          </button>
                        )}
                        {office.status === 'ready' ? (
                          <button type="button" onClick={() => void setStatus(office, 'planned')}>
                            Not ready
                          </button>
                        ) : (
                          <button type="button" onClick={() => void setStatus(office, 'ready')}>
                            Mark ready
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className={styles.form}>
            <h2>
              Separate database
              {focus ? ` · ${focus.name}` : ''}
            </h2>
            <p className={styles.dbHint}>
              One office, one database, one web service, same repo. DGA does not share this database.
            </p>
            <Setup dbName={focus?.db_name || previewDb} email={focus?.email || email} />
          </section>
        </>
      )}
    </div>
  )
}
