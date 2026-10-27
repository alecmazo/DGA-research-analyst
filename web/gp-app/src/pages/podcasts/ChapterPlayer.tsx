import { useEffect, useRef, useState, type RefObject } from 'react'
import styles from '../PodcastsPage.module.css'

export type ChapterMark = { title: string; startTime: number; url?: string }

type Props = {
  src?: string | null
  chapters?: ChapterMark[] | null
  audioRef?: RefObject<HTMLAudioElement | null>
  className?: string
  onLoadedMetadata?: () => void
  voiceUsed?: string | null
  onErase?: () => void
}

export function ChapterPlayer({
  src,
  chapters,
  audioRef,
  className,
  onLoadedMetadata,
  voiceUsed,
  onErase,
}: Props) {
  const localRef = useRef<HTMLAudioElement | null>(null)
  const ref = audioRef || localRef
  const [at, setAt] = useState(0)
  const rows = (chapters || []).filter((chapter) => chapter && chapter.title)
  let current = -1
  rows.forEach((chapter, index) => {
    if (chapter.startTime <= at + 0.05) current = index
  })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onTime = () => setAt(el.currentTime || 0)
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('seeked', onTime)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('seeked', onTime)
    }
  }, [ref, src])

  const seek = (start: number) => {
    const el = ref.current
    if (!el) return
    el.currentTime = start
    void el.play()
    setAt(start)
  }

  if (!src) return null

  return (
    <div>
      {voiceUsed ? <p className={styles.pcDesc}>Voice: {voiceUsed}</p> : null}
      <div className={styles.audioRow}>
        <audio
          ref={ref}
          className={className}
          controls
          preload="metadata"
          src={src}
          onLoadedMetadata={onLoadedMetadata}
        />
        {onErase && (
          <details className={styles.audioMenu}>
            <summary aria-label="Episode menu">⋮</summary>
            <div className={styles.audioMenuList} role="menu" aria-label="Episode menu">
              <button type="button" role="menuitem" onClick={() => onErase()}>
                Erase episode
              </button>
            </div>
          </details>
        )}
      </div>
      {rows.length > 0 && (
        <>
          <div className={styles.chapterNav}>
            <button
              type="button"
              aria-label="Previous chapter"
              disabled={current <= 0}
              onClick={() => seek(rows[Math.max(0, current - 1)].startTime)}
            >
              Previous
            </button>
            <button
              type="button"
              aria-label="Next chapter"
              disabled={current < 0 || current >= rows.length - 1}
              onClick={() => seek(rows[Math.min(rows.length - 1, current + 1)].startTime)}
            >
              Next
            </button>
          </div>
          <div className={styles.sogdChapters}>
            {rows.map((chapter, index) => (
              <button
                key={`${chapter.startTime}-${chapter.title}`}
                type="button"
                className={index === current ? `${styles.sogdChapter} ${styles.chapterOn}` : styles.sogdChapter}
                aria-current={index === current ? 'true' : undefined}
                aria-label={`Skip to ${chapter.title}`}
                onClick={() => seek(chapter.startTime)}
              >
                {chapter.title}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
