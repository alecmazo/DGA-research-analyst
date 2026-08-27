import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { getAnalysisScene, subscribeAnalysisScene } from '@/lib/analysisScene'
import styles from './AnalysisScene.module.css'

const BASE = import.meta.env.BASE_URL || '/gp/'
/** 15s palindrome loop of the exchange matching-engine backroom. */
const STILL_A = `${BASE}analysis-scene.jpg`
const VIDEO = `${BASE}analysis-scene.mp4`

type Size = 'card' | 'fill' | 'float'

export function AnalysisScene({
  label = 'Working…',
  meta,
  size = 'card',
  children,
}: {
  label?: string
  meta?: string
  size?: Size
  children?: ReactNode
}) {
  const [playing, setPlaying] = useState(false)
  const [reduce, setReduce] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduce(mq.matches)
    apply()
    mq.addEventListener?.('change', apply)
    return () => mq.removeEventListener?.('change', apply)
  }, [])

  return (
    <div
      className={`${styles.wrap} ${styles[size]}`}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className={styles.stage} aria-hidden>
        <img src={STILL_A} alt="" className={`${styles.still} ${styles.stillA}`} />
        {!reduce && (
          <video
            className={`${styles.video} ${playing ? styles.videoOn : ''}`}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster={STILL_A}
            onPlaying={() => setPlaying(true)}
          >
            <source src={VIDEO} type="video/mp4" />
          </video>
        )}
        <div className={styles.veil} />
      </div>
      <div className={styles.caption}>
        <div className={styles.kicker}>Behind the scenes</div>
        <div className={styles.head}>
          <span className={styles.dot} />
          <span className={styles.label}>{label}</span>
          {meta ? <span className={styles.meta}>{meta}</span> : null}
        </div>
        {children ? <div className={styles.extra}>{children}</div> : null}
      </div>
    </div>
  )
}

/** Desk-wide floating Vault graphic while any LLM / agent job is running. */
export function AnalysisSceneHost() {
  const [job, setJob] = useState(getAnalysisScene)
  useEffect(() => subscribeAnalysisScene(setJob), [])
  if (!job) return null
  return createPortal(
    <div className={styles.floatHost}>
      <AnalysisScene size="float" label={job.label} meta={job.meta} />
    </div>,
    document.body,
  )
}
