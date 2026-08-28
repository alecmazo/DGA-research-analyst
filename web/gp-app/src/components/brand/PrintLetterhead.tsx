import styles from './PrintLetterhead.module.css'

const LOGO_SRC = '/branding/dga_logo_small.png'

type Props = {
  doc: string
  meta?: Array<string | null | undefined>
}

/** Screen-hidden DGA letterhead. Shown on browser print for reports, IC reviews, planning, and financials. */
export function PrintLetterhead({ doc, meta = [] }: Props) {
  const bits = meta.map((m) => (m || '').trim()).filter(Boolean)
  return (
    <>
      <div className={styles.mast} aria-hidden>
        <div>
          <img
            className={styles.logo}
            src={LOGO_SRC}
            alt="DGA Capital"
            width={120}
            height={34}
          />
          {doc ? <div className={styles.doc}>{doc}</div> : null}
        </div>
        <div className={styles.meta}>
          <div className={styles.conf}>Confidential</div>
          {bits.map((m, i) => (
            <div key={i}>{m}</div>
          ))}
        </div>
      </div>
      <div className={styles.accent} aria-hidden />
    </>
  )
}
