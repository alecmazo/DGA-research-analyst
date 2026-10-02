import { useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { getLoadSnapshot, subscribeLoadFlow, walkFlow, type FlowBox, type Phase } from '@/lib/loadFlow'
import { FOLDER_DIRS, buildRepoFlow, countFolderPhases, repoLinks } from '@/lib/repoFlow'
import styles from './RepoFlowCard.module.css'

const PHASE_WORD: Record<Phase, string> = {
  idle: 'Quiet',
  loading: 'Calling',
  loaded: 'Called',
  failed: 'Failed',
}

const QUIET =
  'Folders this desk calls on main. A branch moves while that call is in flight. Also on main, and not called from this page: apps, assets, docs, mobile, mockups, packages, tests.'

function tone(phase: Phase): string {
  if (phase === 'loaded') return styles.nodeOk
  if (phase === 'loading') return styles.nodeLoad
  if (phase === 'failed') return styles.nodeBad
  return styles.nodeIdle
}

function edgeTone(phase: Phase, live: boolean): string {
  const color =
    phase === 'loaded'
      ? styles.edgeOk
      : phase === 'loading'
        ? styles.edgeLoad
        : phase === 'failed'
          ? styles.edgeBad
          : styles.edgeIdle
  return live ? `${styles.edge} ${color} ${styles.edgeLive}` : `${styles.edge} ${color}`
}

function detailLine(box: FlowBox): string {
  const bits = [FOLDER_DIRS[box.id] || box.label, PHASE_WORD[box.phase]]
  if (box.leaf?.path) bits.push(box.leaf.path)
  if (box.leaf?.ms != null && box.phase !== 'idle') bits.push(`${box.leaf.ms}ms`)
  if (box.phase === 'failed') {
    const why = box.leaf?.error || box.failedLabels.filter((label) => label !== box.label).join(', ')
    if (why) bits.push(why)
  } else if (box.refreshing) {
    bits.push('calling')
  } else if (box.hint) {
    bits.push(box.hint)
  }
  return bits.join(' · ')
}

function Edges({ box }: { box: FlowBox }) {
  const links = repoLinks(box)
  const byId = new Map(box.children.map((child) => [child.id, child]))
  return (
    <g>
      {links?.trunk ? (
        <path d={links.trunk} className={edgeTone(box.phase, box.phase === 'loading')} />
      ) : null}
      {links?.stubs.map((stub) => {
        const child = byId.get(stub.id)
        if (!child) return null
        const live = child.phase === 'loading' || child.refreshing
        const phase = live ? 'loading' : child.phase
        return <path key={stub.id} d={stub.d} className={edgeTone(phase, live)} />
      })}
      {box.children.map((child) => (
        <Edges key={child.id} box={child} />
      ))}
    </g>
  )
}

function Nodes({
  boxes,
  hotId,
  onHot,
  onOpen,
}: {
  boxes: FlowBox[]
  hotId: string | null
  onHot: (id: string | null) => void
  onOpen: (box: FlowBox) => void
}) {
  return (
    <g>
      {boxes.map((box) => {
        const hot = hotId === box.id
        const cls = [styles.node, tone(box.phase)]
        if (box.refreshing) cls.push(styles.nodeRefresh)
        if (hot) cls.push(styles.nodeHot)
        return (
          <g key={box.id}>
            <g
              className={cls.join(' ')}
              role="button"
              tabIndex={0}
              data-repo-node={box.id}
              data-repo-phase={box.phase}
              aria-label={detailLine(box)}
              onMouseEnter={() => onHot(box.id)}
              onMouseLeave={() => onHot(null)}
              onFocus={() => onHot(box.id)}
              onBlur={() => onHot(null)}
              onClick={() => onOpen(box)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onOpen(box)
                }
              }}
            >
              <rect className={styles.nodeBody} x={box.x} y={box.y} width={box.w} height={box.h} rx={8} />
              <rect className={styles.cap} x={box.x + 6} y={box.y + 6} width={3} height={box.h - 12} rx={1} />
              <text x={box.x + 16} y={box.y + 17}>
                {box.label}
              </text>
            </g>
            <Nodes boxes={box.children} hotId={hotId} onHot={onHot} onOpen={onOpen} />
          </g>
        )
      })}
    </g>
  )
}

export function RepoFlowBadge() {
  const snap = useSyncExternalStore(subscribeLoadFlow, getLoadSnapshot, getLoadSnapshot)
  const counts = countFolderPhases(buildRepoFlow(snap.leaves).root)
  const text = counts.loading
    ? `${counts.loading} calling`
    : counts.failed
      ? `${counts.failed} failed`
      : counts.loaded
        ? `${counts.loaded} called`
        : 'Quiet'
  return <>{text}</>
}

export function RepoFlowCard() {
  const navigate = useNavigate()
  const snap = useSyncExternalStore(subscribeLoadFlow, getLoadSnapshot, getLoadSnapshot)
  const chart = buildRepoFlow(snap.leaves)
  const [hotId, setHotId] = useState<string | null>(null)
  const counts = countFolderPhases(chart.root)
  let hot: FlowBox | null = null
  walkFlow(chart.root, (box) => {
    if (box.id === hotId) hot = box
  })

  const open = (box: FlowBox) => {
    if (box.widget && typeof document !== 'undefined') {
      document
        .querySelector(`[data-desk-widget="${box.widget}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    if (box.to) navigate(box.to)
  }

  return (
    <div className={styles.frame}>
      <div className={styles.legend}>
        <span className={styles.key}>
          <i className={`${styles.swatch} ${styles.okSwatch}`} />
          Called
        </span>
        <span className={styles.key}>
          <i className={`${styles.swatch} ${styles.loadSwatch}`} />
          Calling
        </span>
        <span className={styles.key}>
          <i className={`${styles.swatch} ${styles.badSwatch}`} />
          Failed
        </span>
        <span className={styles.key}>
          <i className={`${styles.swatch} ${styles.idleSwatch}`} />
          Quiet
        </span>
        <span className={styles.counts}>
          {counts.loading} calling · {counts.loaded} called · {counts.failed} failed
        </span>
        <div className={styles.detail}>{hot ? detailLine(hot) : QUIET}</div>
      </div>
      <div className={styles.scroll}>
        <svg
          className={styles.svg}
          width={chart.width}
          height={chart.height}
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          role="group"
          aria-label="Repository folder flow"
        >
          <Edges box={chart.root} />
          <Nodes boxes={[chart.root]} hotId={hotId} onHot={setHotId} onOpen={open} />
        </svg>
      </div>
    </div>
  )
}
