import { useEffect, useState, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { getCachedUser } from '@/lib/auth'
import page from './page.module.css'
import styles from './SettingsPage.module.css'
import { DirectorySection } from './settings/DirectorySection'
import { FlowsSection } from './settings/FlowsSection'
import { HandoffSection } from './settings/HandoffSection'
import { SupportSection } from './settings/SupportSection'
import { ModelsSection } from './settings/ModelsSection'
import { ConnectionsSection } from './settings/ConnectionsSection'
import { PublishingSection } from './settings/PublishingSection'
import { SecuritySection } from './settings/SecuritySection'
import { UsersSection } from './settings/UsersSection'
import { SystemSection } from './settings/SystemSection'

const JUMP = [
  { id: 'set-users', label: 'Accounts' },
  { id: 'set-security', label: 'Security' },
  { id: 'set-models', label: 'Models' },
  { id: 'set-connections', label: 'Connections' },
  { id: 'set-publishing', label: 'Publishing' },
  { id: 'set-support', label: 'Support' },
  { id: 'set-handoff', label: 'Handoff' },
  { id: 'set-system', label: 'System' },
] as const

export function SettingsPage() {
  const [panel, setPanel] = useState<'office' | 'flows' | 'directories'>(() => {
    if (typeof window === 'undefined') return 'office'
    if (window.location.hash === '#set-flows') return 'flows'
    if (window.location.hash === '#set-directories') return 'directories'
    return 'office'
  })
  const [pending, setPending] = useState<string | null>(null)

  useEffect(() => {
    if (panel !== 'office' || !pending) return
    document.getElementById(pending)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setPending(null)
  }, [panel, pending])

  const openPanel = (e: MouseEvent<HTMLAnchorElement>, next: 'flows' | 'directories', hash: string) => {
    e.preventDefault()
    setPanel(next)
    setPending(null)
    try {
      history.replaceState(null, '', hash)
    } catch {
      /* ignore */
    }
  }

  const jumpTo = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault()
    setPanel('office')
    setPending(id)
    try {
      history.replaceState(null, '', `#${id}`)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className={`${page.page} ${styles.shell}`}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Admin</p>
          <h1 className={page.h1}>Settings</h1>
          <p className={page.sub}>
            Accounts, security, then the rest of the desk.
          </p>
        </div>
      </header>

      <nav className={styles.jump} role="navigation" aria-label="Settings sections">
        {!getCachedUser()?.demo_mode && (
          <Link to="/settings/offices">Offices</Link>
        )}
        <a
          href="#set-flows"
          aria-current={panel === 'flows' ? 'page' : undefined}
          onClick={(e) => openPanel(e, 'flows', '#set-flows')}
        >
          Flows
        </a>
        <a
          href="#set-directories"
          aria-current={panel === 'directories' ? 'page' : undefined}
          onClick={(e) => openPanel(e, 'directories', '#set-directories')}
        >
          Directories
        </a>
        {JUMP.map((j) => (
          <a key={j.id} href={`#${j.id}`} onClick={(e) => jumpTo(e, j.id)}>
            {j.label}
          </a>
        ))}
      </nav>

      {panel === 'flows' ? <FlowsSection /> : null}
      {panel === 'directories' ? <DirectorySection /> : null}
      {panel === 'office' ? (
      <>
      <h3 className={styles.groupHead} id="set-users">
        Accounts
      </h3>
      <div className={styles.grid}>
        <UsersSection />
      </div>

      <h3 className={styles.groupHead} id="set-security">
        Security
      </h3>
      <div className={styles.grid}>
        <SecuritySection />
      </div>

      <h3 className={styles.groupHead} id="set-models">
        Models · routing &amp; schedule
      </h3>
      <div className={styles.grid}>
        <ModelsSection />
      </div>

      <h3 className={styles.groupHead} id="set-connections">
        Data connections
      </h3>
      <div className={styles.grid}>
        <ConnectionsSection />
      </div>

      <h3 className={styles.groupHead} id="set-publishing">
        Publishing
      </h3>
      <div className={styles.grid}>
        <PublishingSection />
      </div>

      <h3 className={styles.groupHead} id="set-support">
        Support · fix trail
      </h3>
      <div className={styles.grid}>
        <SupportSection />
      </div>

      <h3 className={styles.groupHead} id="set-handoff">
        Agent continuity · handoff
      </h3>
      <div className={styles.grid}>
        <HandoffSection />
      </div>

      <h3 className={styles.groupHead} id="set-system">
        System
      </h3>
      <div className={styles.grid}>
        <SystemSection />
      </div>
      </>
      ) : null}
    </div>
  )
}
