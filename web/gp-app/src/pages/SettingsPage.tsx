import { useEffect, useState, type MouseEvent } from 'react'
import page from './page.module.css'
import styles from './SettingsPage.module.css'
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
  { id: 'set-handoff', label: 'Handoff' },
  { id: 'set-support', label: 'Support' },
  { id: 'set-models', label: 'Models' },
  { id: 'set-connections', label: 'Connections' },
  { id: 'set-publishing', label: 'Publishing' },
  { id: 'set-security', label: 'Security' },
  { id: 'set-users', label: 'Users & Funds' },
  { id: 'set-system', label: 'System' },
] as const

export function SettingsPage() {
  const [panel, setPanel] = useState<'office' | 'flows'>(() =>
    typeof window !== 'undefined' && window.location.hash === '#set-flows' ? 'flows' : 'office',
  )
  const [pending, setPending] = useState<string | null>(null)

  useEffect(() => {
    if (panel !== 'office' || !pending) return
    document.getElementById(pending)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setPending(null)
  }, [panel, pending])

  const openFlows = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    setPanel('flows')
    setPending(null)
    try {
      history.replaceState(null, '', '#set-flows')
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
            Models, connections, users, and the production flow.
          </p>
        </div>
      </header>

      <nav className={styles.jump} role="navigation" aria-label="Settings sections">
        <a
          href="#set-flows"
          aria-current={panel === 'flows' ? 'page' : undefined}
          onClick={openFlows}
        >
          Flows
        </a>
        {JUMP.map((j) => (
          <a key={j.id} href={`#${j.id}`} onClick={(e) => jumpTo(e, j.id)}>
            {j.label}
          </a>
        ))}
      </nav>

      {panel === 'flows' ? <FlowsSection /> : null}
      {panel === 'office' ? (
      <>
      <h3 className={styles.groupHead} id="set-handoff">
        Agent continuity · handoff
      </h3>
      <div className={styles.grid}>
        <HandoffSection />
      </div>

      <h3 className={styles.groupHead} id="set-support">
        Support · fix trail
      </h3>
      <div className={styles.grid}>
        <SupportSection />
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

      <h3 className={styles.groupHead} id="set-security">
        Security
      </h3>
      <div className={styles.grid}>
        <SecuritySection />
      </div>

      <h3 className={styles.groupHead} id="set-users">
        Users &amp; funds
      </h3>
      <div className={styles.grid}>
        <UsersSection />
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
