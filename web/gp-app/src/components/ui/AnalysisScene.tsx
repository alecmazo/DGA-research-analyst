import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  getAnalysisScene,
  inferSceneEngine,
  subscribeAnalysisScene,
  type SceneEngine,
} from '@/lib/analysisScene'
import styles from './AnalysisScene.module.css'

const BASE = import.meta.env.BASE_URL || '/gp/'

type ScenePack = { still: string; video: string; kicker: string }

function scenePack(engine?: SceneEngine): ScenePack {
  const e = inferSceneEngine(engine, '')
  if (e === 'claude') {
    return {
      still: `${BASE}analysis-claude.jpg`,
      video: `${BASE}analysis-claude.mp4`,
      kicker: 'Claude',
    }
  }
  if (e === 'grok') {
    return {
      still: `${BASE}analysis-grok.jpg`,
      video: `${BASE}analysis-grok.mp4`,
      kicker: 'Grok',
    }
  }
  return {
    still: `${BASE}analysis-scene.jpg`,
    video: `${BASE}analysis-scene.mp4`,
    kicker: 'Behind the scenes',
  }
}

type Size = 'card' | 'fill' | 'float'

export function AnalysisScene({
  label = 'Working…',
  meta,
  size = 'card',
  engine,
  children,
}: {
  label?: string
  meta?: string
  size?: Size
  engine?: SceneEngine
  children?: ReactNode
}) {
  const pack = scenePack(engine)
  const [playing, setPlaying] = useState(false)
  const [reduce, setReduce] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduce(mq.matches)
    apply()
    mq.addEventListener?.('change', apply)
    return () => mq.removeEventListener?.('change', apply)
  }, [])

  useEffect(() => {
    setPlaying(false)
  }, [pack.video])

  return (
    <div
      className={`${styles.wrap} ${styles[size]}`}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className={styles.stage} aria-hidden>
        <img src={pack.still} alt="" className={`${styles.still} ${styles.stillA}`} />
        {!reduce && (
          <video
            key={pack.video}
            className={`${styles.video} ${playing ? styles.videoOn : ''}`}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster={pack.still}
            onPlaying={() => setPlaying(true)}
          >
            <source src={pack.video} type="video/mp4" />
          </video>
        )}
        <div className={styles.veil} />
      </div>
      <div className={styles.caption}>
        <div className={styles.kicker}>{pack.kicker}</div>
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

/** Desk-wide floating graphic while any LLM / agent job is running. */
export function AnalysisSceneHost() {
  const [job, setJob] = useState(getAnalysisScene)
  useEffect(() => subscribeAnalysisScene(setJob), [])
  if (!job) return null
  return createPortal(
    <div className={styles.floatHost}>
      <AnalysisScene
        size="float"
        label={job.label}
        meta={job.meta}
        engine={job.engine}
      />
    </div>,
    document.body,
  )
}
