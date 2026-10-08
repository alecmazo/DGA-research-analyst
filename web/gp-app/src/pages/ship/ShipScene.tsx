import { useEffect, useState } from 'react'
import { raindrops, seaPaint, wavePath } from './sea'
import { DRAW_ORDER, WASHES, type ShipPart, type WashRect } from './pins'
import { companyBands } from './washes'

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

function useSeaMotion(): boolean {
  const [motion, setMotion] = useState(true)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setMotion(!media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])
  return motion
}

function weightLabel(n: number): string {
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`
}

function namedRect(rects: WashRect[]): number {
  let best = 0
  let area = 0
  rects.forEach((rect, index) => {
    const next = rect.w * rect.h
    if (next > area) {
      area = next
      best = index
    }
  })
  return best
}

const RAIN = raindrops(48)

export function ShipScene({ t, sectors, active, hover, onSelect, onHover }: Props) {
  const paint = seaPaint(t)
  const motion = useSeaMotion()
  const byPart = new Map(sectors.map((sector) => [sector.part, sector]))
  const lit = hover || active
  const base = import.meta.env.BASE_URL
  const ship = `${base}ship/deck.png`
  const far = wavePath(430, 6 + paint.amp * 0.28, paint.freq * 0.85, 0.4, -1500, 2900, 900)
  const mid = wavePath(500, 10 + paint.amp * 0.62, paint.freq, 1.3, -1500, 2900, 900)
  const near = wavePath(590, 16 + paint.amp, paint.freq * 1.12, 2.2, -1500, 2900, 900)
  const frameClass = [
    'dga-ship-frame',
    lit ? 'is-dim' : '',
    motion ? '' : 'is-still',
  ].filter(Boolean).join(' ')

  return (
    <div className={frameClass}>
      <svg className="dga-ship-sea" viewBox="0 0 1400 788" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="dga-ship-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={paint.skyTop} />
            <stop offset="0.58" stopColor={paint.skyHigh} />
            <stop offset="1" stopColor={paint.skyHorizon} />
          </linearGradient>
          <linearGradient id="dga-ship-haze" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={paint.skyHorizon} stopOpacity="0" />
            <stop offset="1" stopColor={paint.lit} stopOpacity="0.55" />
          </linearGradient>
          <radialGradient id="dga-ship-sun" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor={paint.sun} stopOpacity={paint.sunOpacity} />
            <stop offset="0.45" stopColor={paint.sun} stopOpacity={paint.sunOpacity * 0.45} />
            <stop offset="1" stopColor={paint.sun} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="1400" height="560" fill="url(#dga-ship-sky)" />
        <circle cx="1040" cy={paint.sunY} r={paint.sunR * 3.4} fill="url(#dga-ship-sun)" />
        <g opacity={0.28 + (1 - paint.chop) * 0.35}>
          <ellipse cx="260" cy="150" rx="170" ry="28" fill={paint.cloud} />
          <ellipse cx="390" cy="138" rx="120" ry="22" fill={paint.cloud} />
          <ellipse cx="760" cy="118" rx="150" ry="20" fill={paint.cloud} opacity="0.75" />
        </g>
        <rect x="0" y="470" width="1400" height="90" fill="url(#dga-ship-haze)" />
        <g>
          {motion && (
            <animateTransform attributeName="transform" type="translate" from="0 0" to="-640 0" dur={`${(42 - paint.chop * 12).toFixed(0)}s`} repeatCount="indefinite" />
          )}
          <path d={far} fill={paint.deep} />
        </g>
        <g opacity="0.95">
          {motion && (
            <animateTransform attributeName="transform" type="translate" from="0 0" to="-820 0" dur={`${(28 - paint.chop * 10).toFixed(0)}s`} repeatCount="indefinite" />
          )}
          <path d={mid} fill={paint.mid} />
        </g>
        <g>
          {motion && (
            <animateTransform attributeName="transform" type="translate" from="0 0" to="-980 0" dur={`${(18 - paint.chop * 8).toFixed(0)}s`} repeatCount="indefinite" />
          )}
          <path d={near} fill={paint.lit} opacity={0.35 + paint.chop * 0.4} />
          <path d={near} fill={paint.deep} transform="translate(0 18)" />
        </g>
        {paint.rain > 0.04 && (
          <g stroke="#d5e4f2" strokeWidth="1.4" opacity={paint.rain * 0.55}>
            {motion && (
              <animateTransform attributeName="transform" type="translate" from="0 -40" to="-30 80" dur="1.4s" repeatCount="indefinite" />
            )}
            {RAIN.map((drop) => (
              <line key={`${drop.x1}-${drop.y1}`} x1={drop.x1} y1={drop.y1} x2={drop.x2} y2={drop.y2} />
            ))}
          </g>
        )}
      </svg>
      <div className="dga-ship-float" style={{ ['--ship' as string]: `url("${ship}")` }}>
        <img className="dga-ship-photo" alt="Deck ship at sea" src={ship} draggable={false} />
        <div
          className="dga-ship-grade"
          style={{
            background: `linear-gradient(to bottom, ${paint.skyHigh} 0%, transparent 42%, ${paint.deep} 100%)`,
            opacity: 0.28 + paint.chop * 0.22,
          }}
        />
        <div
          className="dga-ship-wet"
          style={{
            background: `linear-gradient(to bottom, transparent, ${paint.lit} 22%, ${paint.deep})`,
            opacity: 0.18 + paint.chop * 0.34,
          }}
        />
        <div
          className="dga-ship-washes"
          style={{
            maskImage: `url("${ship}")`,
            WebkitMaskImage: `url("${ship}")`,
            maskSize: '100% 100%',
            WebkitMaskSize: '100% 100%',
            maskRepeat: 'no-repeat',
            WebkitMaskRepeat: 'no-repeat',
            maskMode: 'alpha',
          }}
        >
          {DRAW_ORDER.map((part) => {
            const sector = byPart.get(part)
            if (!sector) return null
            const rects = WASHES[part]
            const labelAt = namedRect(rects)
            const bands = companyBands(sector.holdings)
            const across = (rect: WashRect) => rect.w >= rect.h * 1.25
            return rects.map((rect, index) => {
              const on = active === part
              const hot = hover === part
              return (
                <button
                  key={`${part}-${index}`}
                  type="button"
                  className={`dga-ship-wash${hot ? ' is-hot' : ''}${on ? ' is-on' : ''}`}
                  style={{
                    left: `${rect.x}%`,
                    top: `${rect.y}%`,
                    width: `${rect.w}%`,
                    height: `${rect.h}%`,
                    ['--wash' as string]: sector.color,
                  }}
                  aria-pressed={on}
                  aria-label={`${sector.name}, ${weightLabel(sector.weight_pct)}`}
                  tabIndex={index === labelAt ? 0 : -1}
                  onClick={() => onSelect(part)}
                  onMouseEnter={() => onHover(part)}
                  onMouseLeave={() => onHover(null)}
                  onFocus={() => onHover(part)}
                  onBlur={() => onHover(null)}
                >
                  <span className="dga-ship-stripes" style={{ flexDirection: across(rect) ? 'row' : 'column' }}>
                    {bands.map((band) => (
                      <i
                        key={band.symbol}
                        style={{
                          flexGrow: band.share,
                          flexBasis: 0,
                          flexShrink: 1,
                          ['--lift' as string]: `${Math.round(22 + (1 - band.share) * 48)}%`,
                        }}
                      />
                    ))}
                  </span>
                </button>
              )
            })
          })}
        </div>
        <div className="dga-ship-labels">
          {DRAW_ORDER.map((part) => {
            const sector = byPart.get(part)
            if (!sector) return null
            const rects = WASHES[part]
            const rect = rects[namedRect(rects)]
            if (Math.min(rect.w, rect.h) < 8) return null
            const bands = companyBands(sector.holdings).filter((band) => band.label)
            if (!bands.length) return null
            const tall = rect.h >= rect.w
            const box = tall
              ? { left: rect.x, top: rect.y + rect.h * 0.38, width: rect.w, height: rect.h * 0.58 }
              : { left: rect.x, top: rect.y, width: rect.w, height: rect.h }
            const on = active === part
            const hot = hover === part
            return (
              <span
                key={part}
                className={`dga-ship-label${tall ? ' is-tall' : ''}${hot ? ' is-hot' : ''}${on ? ' is-on' : ''}`}
                style={{
                  left: `${box.left}%`,
                  top: `${box.top}%`,
                  width: `${box.width}%`,
                  height: `${box.height}%`,
                }}
              >
                {bands.map((band) => (
                  <b key={band.symbol} className="dga-ship-co" style={{ ['--scale' as string]: String(band.scale) }}>
                    {band.symbol}
                  </b>
                ))}
              </span>
            )
          })}
        </div>
      </div>
      <div className="dga-ship-vignette" />
    </div>
  )
}
