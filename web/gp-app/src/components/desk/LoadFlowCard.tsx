import { useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  buildFlow,
  countLeafPhases,
  flowLinks,
  getLoadSnapshot,
  subscribeLoadFlow,
  walkFlow,
  type FlowBox,
  type Phase,
} from '@/lib/loadFlow'
import styles from './LoadFlowCard.module.css'

const PHASE_WORD: Record<Phase, string> = {
  idle: 'Not started',
  loading: 'Loading',
  loaded: 'Loaded',
  failed: 'Failed',
}

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
  const bits = [box.label, PHASE_WORD[box.phase]]
  if (box.leaf?.path) bits.push(box.leaf.path)
  if (box.leaf?.ms != null && box.phase !== 'idle') bits.push(`${box.leaf.ms}ms`)
  if (box.phase === 'failed') {
    const why = box.leaf?.error || box.failedLabels.filter((label) => label !== box.label).join(', ')
    if (why) bits.push(why)
  } else if (box.refreshing) {
    bits.push('refreshing')
  } else if (box.hint) {
    bits.push(box.hint)
  }
  return bits.join(' · ')
}

function Edges({ box }: { box: FlowBox }) {
  const links = flowLinks(box)
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
        const labelX = box.x + (box.step ? 28 : 10)
        const cls = [styles.node, tone(box.phase)]
        if (box.refreshing) cls.push(styles.nodeRefresh)
        if (hot) cls.push(styles.nodeHot)
        return (
          <g key={box.id}>
            <g
              className={cls.join(' ')}
              role="button"
              tabIndex={0}
              data-flow-node={box.id}
              data-flow-phase={box.phase}
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
              <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={8} />
              {box.step ? (
                <>
                  <circle
                    className={styles.stepBubble}
                    cx={box.x + 14}
                    cy={box.y + box.h / 2}
                    r={8}
                  />
                  <text
                    className={styles.stepText}
                    x={box.x + 14}
                    y={box.y + 17}
                    textAnchor="middle"
                  >
                    {box.step}
                  </text>
                </>
              ) : null}
              <text x={labelX} y={box.y + 17}>
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

export function FlowBadge() {
  const snap = useSyncExternalStore(subscribeLoadFlow, getLoadSnapshot, getLoadSnapshot)
  const counts = countLeafPhases(snap.leaves)
  const text = counts.loading
    ? `${counts.loading} loading`
    : counts.failed
      ? `${counts.failed} failed`
      : counts.loaded
        ? `${counts.loaded} loaded`
        : 'Live'
  return <>{text}</>
}

export function LoadFlowCard() {
  const navigate = useNavigate()
  const snap = useSyncExternalStore(subscribeLoadFlow, getLoadSnapshot, getLoadSnapshot)
  const chart = buildFlow(snap.leaves)
  const [hotId, setHotId] = useState<string | null>(null)
  const counts = countLeafPhases(snap.leaves)
  let hot: FlowBox | null = null
  walkFlow(chart.root, (box) => {
    if (box.id === hotId) hot = box
  })
  const detail = hot
    ? detailLine(hot)
    : 'The site runs down from the center. Hollow has not started.'

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
          Loaded
        </span>
        <span className={styles.key}>
          <i className={`${styles.swatch} ${styles.loadSwatch}`} />
          Loading
        </span>
        <span className={styles.key}>
          <i className={`${styles.swatch} ${styles.badSwatch}`} />
          Failed
        </span>
        <span className={styles.key}>
          <i className={`${styles.swatch} ${styles.idleSwatch}`} />
          Not started
        </span>
        <span className={styles.counts}>
          {counts.loading} loading · {counts.loaded} loaded · {counts.failed} failed
        </span>
        <div className={styles.detail}>{detail}</div>
      </div>
      <div className={styles.scroll}>
        <svg
          className={styles.svg}
          width={chart.width}
          height={chart.height}
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          role="group"
          aria-label="Site load flow"
        >
          <Edges box={chart.root} />
          <Nodes boxes={[chart.root]} hotId={hotId} onHot={setHotId} onOpen={open} />
        </svg>
      </div>
    </div>
  )
}
