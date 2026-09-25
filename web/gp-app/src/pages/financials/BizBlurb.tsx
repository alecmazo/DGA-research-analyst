import { useState } from 'react'
import styles from '../FinancialsPage.module.css'

export function BizBlurb({ text }: { text?: string | null }) {
  const [open, setOpen] = useState(false)
  const body = (text || '').trim()
  if (!body) return null
  return (
    <button
      type="button"
      className={styles.bizBtn}
      aria-expanded={open}
      title={open ? 'Show less' : 'Show the full description'}
      onClick={() => setOpen((v) => !v)}
    >
      <span className={open ? styles.bizSummaryOpen : styles.bizSummary}>{body}</span>
    </button>
  )
}
