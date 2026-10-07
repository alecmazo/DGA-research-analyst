import { useId } from 'react'
import { DRAW_ORDER, HULL, PLATES, WATERLINE, type ShipPart } from './geometry'
import { crestPath, raindrops, seaPaint, wavePath } from './sea'

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

const RAIN = raindrops()

function weightLabel(n: number): string {
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`
}

export function ShipScene({ t, sectors, active, hover, onSelect, onHover }: Props) {
  const uid = useId().replace(/:/g, '')
  const paint = seaPaint(t)
  const byPart = new Map(sectors.map((sector) => [sector.part, sector]))
  const lit = hover || active
  const sky = `${uid}-sky`
  const sunGlow = `${uid}-sun`
  const steel = `${uid}-steel`
  const wet = `${uid}-wet`
  const glass = `${uid}-glass`
  const stack = `${uid}-stack`
  const sheen = `${uid}-sheen`
  const shade = `${uid}-shade`
  const house = `${uid}-house`

  return (
    <svg
      className={lit ? 'dga-ship-svg dim' : 'dga-ship-svg'}
      viewBox="0 0 1400 800"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Portfolio ship on the ocean"
      style={{ ['--dga-wx' as string]: String(paint.t) }}
    >
      <defs>
        <linearGradient id={sky} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={paint.skyTop} />
          <stop offset="48%" stopColor={paint.skyHigh} />
          <stop offset="100%" stopColor={paint.skyHorizon} />
        </linearGradient>
        <radialGradient id={sunGlow} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={paint.sun} stopOpacity="0.95" />
          <stop offset="40%" stopColor={paint.sun} stopOpacity="0.35" />
          <stop offset="100%" stopColor={paint.sun} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={steel} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fbfcfe" />
          <stop offset="16%" stopColor="#e4ebf2" />
          <stop offset="46%" stopColor="#b7c3cf" />
          <stop offset="78%" stopColor="#7d8b99" />
          <stop offset="100%" stopColor="#3d4954" />
        </linearGradient>
        <linearGradient id={wet} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6e342f" />
          <stop offset="55%" stopColor="#35161b" />
          <stop offset="100%" stopColor="#120a0d" />
        </linearGradient>
        <linearGradient id={house} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#e7eef4" />
          <stop offset="100%" stopColor="#c5d0da" />
        </linearGradient>
        <linearGradient id={glass} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f3fbff" />
          <stop offset="42%" stopColor="#8ec0d6" />
          <stop offset="100%" stopColor="#1a455c" />
        </linearGradient>
        <linearGradient id={stack} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#3e474f" />
          <stop offset="38%" stopColor="#f2f6f8" />
          <stop offset="100%" stopColor="#232a30" />
        </linearGradient>
        <linearGradient id={sheen} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.42" />
          <stop offset="42%" stopColor="#ffffff" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#041018" stopOpacity="0.28" />
        </linearGradient>
        <radialGradient id={shade} cx="50%" cy="40%" r="72%">
          <stop offset="62%" stopColor="#02060c" stopOpacity="0" />
          <stop offset="100%" stopColor="#02060c" stopOpacity="0.72" />
        </radialGradient>
        <filter id={`${uid}-cloud`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
      </defs>

      <rect width="1400" height="800" fill={`url(#${sky})`} />
      <circle cx="990" cy={paint.sunY} r={paint.sunR * 3.1} fill={`url(#${sunGlow})`} opacity={paint.sunOpacity} />
      <circle cx="990" cy={paint.sunY} r={paint.sunR} fill={paint.sun} opacity={Math.min(1, paint.sunOpacity)} />

      <g filter={`url(#${uid}-cloud)`} opacity={0.22 + paint.chop * 0.5}>
        {[
          [150, 140, 1],
          [460, 108, 1.2],
          [820, 150, 0.9],
          [1140, 118, 1.1],
        ].map(([x, y, s]) => (
          <g key={x} transform={`translate(${x} ${Number(y) + paint.chop * 28}) scale(${s})`}>
            <ellipse cx="0" cy="0" rx="70" ry="22" fill={paint.cloud} />
            <ellipse cx="42" cy="6" rx="48" ry="18" fill={paint.cloud} />
            <ellipse cx="-36" cy="8" rx="40" ry="16" fill={paint.cloud} />
          </g>
        ))}
      </g>

      <path d="M0 520 C220 486 380 504 520 522 L0 530 Z" fill={paint.deep} opacity={0.08 + paint.t * 0.22} />

      <g className="dga-ship-waves">
        <path d={wavePath(500, paint.amp * 0.55, paint.freq * 0.75, 0.15)} fill={paint.lit} />
        <path d={wavePath(545, paint.amp * 0.8, paint.freq, 1.05)} fill={paint.mid} />
        <path d={wavePath(690, paint.amp * 0.7, paint.freq * 0.85, 2.1)} fill={paint.deep} />
        <path
          d={crestPath(512, paint.amp * 0.5, paint.freq * 0.8, 0.3)}
          fill="none"
          stroke="#f7fbff"
          strokeWidth={1 + paint.whitecap * 1.8}
          strokeLinecap="round"
          opacity={0.08 + paint.whitecap * 0.5}
        />
      </g>

      {paint.glitter > 0.05 &&
        Array.from({ length: 12 }, (_, i) => (
          <ellipse
            key={i}
            cx={930 + i * 16}
            cy={548 + (i % 3) * 18 + paint.chop * 6}
            rx={8}
            ry={2.4}
            fill="#fff8e6"
            opacity={paint.glitter * (0.18 + (i % 4) * 0.1)}
          />
        ))}

      <g
        className="dga-ship-vessel"
        style={{
          ['--dga-bob' as string]: `${paint.bob.toFixed(2)}px`,
          ['--dga-roll' as string]: `${paint.roll.toFixed(2)}deg`,
        }}
      >
        <path d={HULL} fill={`url(#${steel})`} stroke="#24303a" strokeWidth="1.4" />
        <path d={PLATES.keel.d} fill={`url(#${wet})`} />
        <path d={WATERLINE} fill="none" stroke="#1c1412" strokeWidth="2.2" opacity="0.45" />

        <path d="M250 404 C560 378 900 366 1160 388" fill="none" stroke="#2a3642" strokeWidth="3" />
        <path d="M348 404 L348 318 C348 304 364 290 404 280 L548 272 L612 300 L612 398 Z" fill={`url(#${house})`} stroke="#24303a" strokeWidth="1.3" />
        <path d="M424 332 L440 228 H486 L504 332 Z" fill={`url(#${stack})`} stroke="#1c242c" strokeWidth="1" />
        <rect x="438" y="246" width="50" height="7" rx="1" fill="#c0392b" />
        <g className="dga-ship-smoke">
          <ellipse cx="462" cy="204" rx="14" ry="8" fill="#d5dee6" opacity={0.35 + paint.chop * 0.3} />
          <ellipse cx="446" cy="178" rx="20" ry="10" fill="#d5dee6" opacity={0.25 + paint.chop * 0.22} />
          <ellipse cx="430" cy="154" rx="16" ry="8" fill="#d5dee6" opacity="0.18" />
        </g>

        <g stroke="#24303a" strokeWidth="1.1" fill="#e7eef3">
          <path d="M548 272 V156 H562 V272 Z" />
          <path d="M516 186 H594 V198 H516 Z" />
          <circle cx="555" cy="156" r="15" />
        </g>
        <path d="M516 192 L470 300 M594 192 L650 292" fill="none" stroke="#5c6a76" strokeWidth="1" opacity="0.7" />
        <circle cx="555" cy="156" r="4.5" fill="#8ea0ae" />

        <g fill="#c5ced6" stroke="#24303a" strokeWidth="1.1">
          <path d="M978 400 V268 H992 V400 Z" />
          <path d="M984 276 L1124 328 L1118 340 L984 290 Z" />
          <path d="M1106 334 V392 H1116 V334 Z" />
          <path d="M1094 384 H1132 V398 H1094 Z" />
          <path d="M1110 360 L1102 430" fill="none" stroke="#24303a" />
        </g>

        <g stroke="#24303a" strokeWidth="1">
          <path d="M676 338 H754 L742 322 H688 Z" fill="#eef3f7" />
          <path d="M676 338 H754 V404 H676 Z" fill="#d5dee6" />
          <path d="M760 330 H840 L826 314 H774 Z" fill="#f7fafc" />
          <path d="M760 330 H840 V404 H760 Z" fill="#c9d3dc" />
          <path d="M846 346 H916 L904 332 H858 Z" fill="#e7eef3" />
          <path d="M846 346 H916 V404 H846 Z" fill="#d0dae3" />
        </g>

        <g>
          <path d="M624 392 L732 392 C732 406 700 412 678 406 C656 412 624 406 624 392 Z" fill="#e07a3a" stroke="#6a3018" strokeWidth="1" />
          <path d="M746 388 L856 388 C856 404 824 410 800 404 C776 410 746 404 746 388 Z" fill="#e07a3a" stroke="#6a3018" strokeWidth="1" />
          <path d="M678 392 V366 M800 388 V362" stroke="#5c6770" strokeWidth="2" />
        </g>

        <g fill="#2c343c" stroke="#1a2026" strokeWidth="1.1">
          <circle cx="1168" cy="486" r="7" />
          <rect x="1162" y="492" width="12" height="56" />
          <path d="M1146 536 C1162 566 1190 566 1206 536 L1198 532 C1188 552 1166 552 1156 532 Z" />
        </g>
        <path d="M1168 478 C1166 450 1178 436 1188 418" fill="none" stroke="#2c343c" strokeWidth="2.4" />

        {Array.from({ length: 12 }, (_, i) => {
          const x = 400 + i * 52
          return <circle key={x} cx={x} cy={458} r="4.6" fill="#10202c" stroke="#d5dee8" strokeWidth="1" />
        })}
        <text x="1088" y="456" fill="#1b2832" fontSize="14" fontWeight={700} letterSpacing="2.8">
          DGA
        </text>
        <circle cx="1232" cy="444" r="3" fill="#b7f0c2" />
        <circle cx="230" cy="440" r="3" fill="#ffb4a8" />

        {DRAW_ORDER.map((part) => {
          const sector = byPart.get(part)
          if (!sector) return null
          const plate = PLATES[part]
          const on = active === part
          const hot = hover === part
          return (
            <g
              key={part}
              className={`dga-ship-plate${hot ? ' is-hot' : ''}${on ? ' is-on' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={`${sector.name}, ${weightLabel(sector.weight_pct)}`}
              aria-pressed={on}
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
              <title>{`${sector.name} — ${weightLabel(sector.weight_pct)}`}</title>
              <path d={plate.d} fill={sector.color} />
              <path d={plate.d} fill={`url(#${sheen})`} pointerEvents="none" />
              <g pointerEvents="none">
                <rect
                  x={plate.label[0] - 22}
                  y={plate.label[1] - 11}
                  width={44}
                  height={16}
                  rx={8}
                  fill="rgba(6,12,20,0.78)"
                />
                <text
                  x={plate.label[0]}
                  y={plate.label[1] + 1}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize={11}
                  fontWeight={700}
                >
                  {weightLabel(sector.weight_pct)}
                </text>
              </g>
            </g>
          )
        })}

        <g pointerEvents="none">
          <rect x="392" y="308" width="26" height="14" rx="2" fill={`url(#${glass})`} stroke="#24303a" strokeWidth="0.7" />
          <rect x="424" y="304" width="26" height="14" rx="2" fill={`url(#${glass})`} stroke="#24303a" strokeWidth="0.7" />
          <rect x="456" y="302" width="26" height="14" rx="2" fill={`url(#${glass})`} stroke="#24303a" strokeWidth="0.7" />
          <rect x="488" y="304" width="26" height="14" rx="2" fill={`url(#${glass})`} stroke="#24303a" strokeWidth="0.7" />
          <rect x="520" y="308" width="22" height="13" rx="2" fill={`url(#${glass})`} stroke="#24303a" strokeWidth="0.7" />
          <rect x="392" y="336" width="18" height="12" rx="1.5" fill={`url(#${glass})`} stroke="#24303a" strokeWidth="0.6" />
          <rect x="416" y="336" width="18" height="12" rx="1.5" fill={`url(#${glass})`} stroke="#24303a" strokeWidth="0.6" />
          <rect x="440" y="336" width="18" height="12" rx="1.5" fill={`url(#${glass})`} stroke="#24303a" strokeWidth="0.6" />
        </g>

        <path
          d="M200 508 C110 498 40 514 -40 504"
          fill="none"
          stroke="#f7fbff"
          strokeWidth={1.6 + paint.spray * 4}
          opacity={0.2 + paint.spray * 0.45}
          strokeLinecap="round"
        />
      </g>

      <g pointerEvents="none">
        <path d={wavePath(518, paint.amp * 0.42, paint.freq * 0.7, 0.5)} fill={paint.mid} opacity={0.38 + paint.chop * 0.18} />
        <path
          d={crestPath(516, paint.amp * 0.4, paint.freq * 0.72, 0.45)}
          fill="none"
          stroke="#f7fbff"
          strokeWidth={1.2 + paint.whitecap * 2.4}
          strokeLinecap="round"
          opacity={0.2 + paint.whitecap * 0.55}
        />
      </g>

      <g className="dga-ship-rain" opacity={paint.rain} pointerEvents="none">
        {RAIN.map((drop) => (
          <line
            key={`${drop.x1}-${drop.y1}`}
            x1={drop.x1}
            y1={drop.y1}
            x2={drop.x2}
            y2={drop.y2}
            stroke="#d7e4ee"
            strokeWidth="1.15"
            strokeLinecap="round"
            opacity="0.5"
          />
        ))}
      </g>
      <rect width="1400" height="800" fill={`url(#${shade})`} opacity={0.12 + paint.shade * 0.55} pointerEvents="none" />
    </svg>
  )
}
