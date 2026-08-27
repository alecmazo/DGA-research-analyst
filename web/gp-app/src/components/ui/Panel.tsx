import { useId, useState, type ReactNode } from 'react'
import styles from './Panel.module.css'

type Props = {
  title: string
  badge?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  flush?: boolean
  collapsible?: boolean
  defaultOpen?: boolean
}

export function Panel({
  title,
  badge,
  action,
  children,
  className,
  flush,
  collapsible = false,
  defaultOpen = true,
}: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()
  const showBody = !collapsible || open

  return (
    <section
      className={`${styles.panel} ${collapsible ? (open ? styles.open : styles.closed) : ''} ${className || ''}`}
      data-collapsible={collapsible ? '1' : undefined}
      data-expanded={collapsible ? (open ? '1' : '0') : undefined}
    >
      <header className={styles.head}>
        {collapsible ? (
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
          >
            <span className={styles.chev} aria-hidden>
              {open ? '▾' : '▸'}
            </span>
            <h2 className={styles.title}>{title}</h2>
            {badge != null && <span className={styles.badge}>{badge}</span>}
          </button>
        ) : (
          <div className={styles.titleWrap}>
            <h2 className={styles.title}>{title}</h2>
            {badge != null && <span className={styles.badge}>{badge}</span>}
          </div>
        )}
        {action != null && (
          <div className={styles.action} onClick={(e) => e.stopPropagation()}>
            {action}
          </div>
        )}
      </header>
      {showBody && (
        <div id={collapsible ? panelId : undefined} className={flush ? styles.bodyFlush : styles.body}>
          {children}
        </div>
      )}
    </section>
  )
}
