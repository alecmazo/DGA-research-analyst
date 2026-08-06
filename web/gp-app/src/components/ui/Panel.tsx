import type { ReactNode } from 'react'
import styles from './Panel.module.css'

type Props = {
  title: string
  badge?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  flush?: boolean
}

export function Panel({ title, badge, action, children, className, flush }: Props) {
  return (
    <section className={`${styles.panel} ${className || ''}`}>
      <header className={styles.head}>
        <div className={styles.titleWrap}>
          <h2 className={styles.title}>{title}</h2>
          {badge != null && <span className={styles.badge}>{badge}</span>}
        </div>
        {action != null && <div className={styles.action}>{action}</div>}
      </header>
      <div className={flush ? styles.bodyFlush : styles.body}>{children}</div>
    </section>
  )
}
