import { Button } from '@/components/ui/Button'
import type { Metric } from '../metrics'
import styles from './cityui.module.css'

const METRICS: { id: Metric; label: string }[] = [
  { id: 'market_cap', label: 'Market cap' },
  { id: 'position_value', label: 'Position' },
  { id: 'total_assets', label: 'Assets' },
]

type Props = {
  metric: Metric
  night: boolean
  flyover: boolean
  motionOn: boolean
  listOpen: boolean
  onMetric: (metric: Metric) => void
  onNight: (night: boolean) => void
  onFlyover: () => void
  onReset: () => void
  onMotion: () => void
  onList: () => void
}

export function Toolbar(props: Props) {
  return (
    <div className={styles.toolbar}>
      <Button size="sm" variant={props.flyover ? 'primary' : 'secondary'} onClick={props.onFlyover}>
        Flyover
      </Button>
      <div className={styles.segment} role="group" aria-label="Size metric">
        {METRICS.map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant={props.metric === item.id ? 'primary' : 'secondary'}
            aria-pressed={props.metric === item.id}
            onClick={() => props.onMetric(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <Button size="sm" variant="secondary" aria-pressed={!props.night} onClick={() => props.onNight(!props.night)}>
        {props.night ? 'Night' : 'Day'}
      </Button>
      <Button size="sm" variant="secondary" onClick={props.onReset}>Reset</Button>
      <Button size="sm" variant="secondary" onClick={props.onList} aria-expanded={props.listOpen}>
        List
      </Button>
      <Button size="sm" variant="secondary" onClick={props.onMotion}>
        Motion {props.motionOn ? 'on' : 'off'}
      </Button>
      <div className={styles.legend}>
        <span><i className={styles.swatch} style={{ background: '#3ee0ff' }} /> Managed</span>
        <span><i className={styles.swatch} style={{ background: '#f0c14a' }} /> LP fund</span>
        <span><i className={styles.swatch} style={{ background: '#8dffc0' }} /> Book equity</span>
        <span><i className={styles.swatch} style={{ background: '#ff6b7a' }} /> Negative book</span>
      </div>
    </div>
  )
}
