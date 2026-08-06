import { useId, useState, type ReactNode } from 'react'
import styles from './CollapsibleCard.module.css'

type Props = {
  title: string
  badge?: ReactNode
  action?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  className?: string
  flush?: boolean
  id?: string
}

export function CollapsibleCard({
  title,
  badge,
  action,
  children,
  defaultOpen = true,
  className,
  flush,
  id,
}: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()

  return (
    <section
      id={id}
      className={`${styles.card} ${open ? styles.open : styles.closed} ${className || ''}`}
      data-collapsible="1"
      data-expanded={open ? '1' : '0'}
    >
      <header className={styles.head}>
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
          <span className={styles.title}>{title}</span>
          {badge != null && <span className={styles.badge}>{badge}</span>}
        </button>
        {action != null && (
          <div className={styles.action} onClick={(e) => e.stopPropagation()}>
            {action}
          </div>
        )}
      </header>
      {open && (
        <div id={panelId} className={flush ? styles.bodyFlush : styles.body}>
          {children}
        </div>
      )}
    </section>
  )
}
