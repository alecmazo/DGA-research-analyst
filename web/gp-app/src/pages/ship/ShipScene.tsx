import { plateMix } from './sea'
import { DRAW_ORDER, PINS, type ShipPart } from './pins'

export type ShipHolding = {
  symbol: string
  name: string
  weight_pct: number
  market_value: number | null
}

export type ShipSector = {
  id: string
  part: ShipPart
  name: string
  color: string
  weight_pct: number
  market_value: number | null
  rationale: string
  holdings: ShipHolding[]
}

type Props = {
  t: number
  sectors: ShipSector[]
  active: string | null
  hover: string | null
  onSelect: (part: string) => void
  onHover: (part: string | null) => void
}

const PLATES = [
  ['storm', 'storm.jpg'],
  ['flat', 'flat.jpg'],
  ['clear', 'clear.jpg'],
] as const

function weightLabel(n: number): string {
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`
}

export function ShipScene({ t, sectors, active, hover, onSelect, onHover }: Props) {
  const mix = plateMix(t)
  const opacity: Record<(typeof PLATES)[number][0], number> = {
    storm: mix.storm,
    flat: mix.flat,
    clear: mix.clear,
  }
  const byPart = new Map(sectors.map((sector) => [sector.part, sector]))
  const lit = hover || active
  const base = import.meta.env.BASE_URL

  return (
    <div className={lit ? 'dga-ship-frame is-dim' : 'dga-ship-frame'}>
      {PLATES.map(([id, file]) => (
        <img
          key={id}
          className="dga-ship-photo"
          alt={id === 'clear' ? 'Expedition ship at sea' : ''}
          src={`${base}ship/${file}`}
          style={{ opacity: opacity[id] }}
          draggable={false}
        />
      ))}
      <div className="dga-ship-vignette" />
      {DRAW_ORDER.map((part) => {
        const sector = byPart.get(part)
        if (!sector) return null
        const pin = PINS[part]
        const on = active === part
        const hot = hover === part
        return (
          <button
            key={part}
            type="button"
            className={`dga-ship-pin${hot ? ' is-hot' : ''}${on ? ' is-on' : ''}`}
            style={{
              left: `${pin.x}%`,
              top: `${pin.y}%`,
              ['--pin' as string]: sector.color,
            }}
            aria-pressed={on}
            aria-label={`${sector.name}, ${weightLabel(sector.weight_pct)}`}
            onClick={() => onSelect(part)}
            onMouseEnter={() => onHover(part)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(part)}
            onBlur={() => onHover(null)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect(part)
              }
            }}
          >
            <span className="dga-ship-pin-dot" />
            <span className="dga-ship-pin-pill">{weightLabel(sector.weight_pct)}</span>
            {(on || hot) && <span className="dga-ship-pin-name">{sector.name}</span>}
          </button>
        )
      })}
    </div>
  )
}
