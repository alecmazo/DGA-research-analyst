import styles from './Empty.module.css'

export function Empty({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className={styles.empty}>
      <div className={styles.title}>{title}</div>
      {sub && <div className={styles.sub}>{sub}</div>}
    </div>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className={styles.spinWrap}>
      <div className={styles.spin} />
      <span>{label}</span>
    </div>
  )
}
