/** Hit targets on the photoreal plate. Percent of the 16:9 frame. Bow is to the right. */

export type ShipPart =
  | 'keel'
  | 'engine'
  | 'cargo'
  | 'staples'
  | 'bow'
  | 'stern'
  | 'midship'
  | 'bridge'
  | 'mast'
  | 'market'
  | 'deck'
  | 'aero'
  | 'hull'
  | 'anchor'
  | 'cabins'

export const DRAW_ORDER: ShipPart[] = [
  'stern',
  'staples',
  'deck',
  'cargo',
  'hull',
  'engine',
  'midship',
  'keel',
  'cabins',
  'bridge',
  'mast',
  'market',
  'aero',
  'anchor',
  'bow',
]

export const PINS: Record<ShipPart, { x: number; y: number }> = {
  stern: { x: 5.4, y: 61 },
  staples: { x: 8.2, y: 63 },
  deck: { x: 16.5, y: 51 },
  cargo: { x: 22, y: 58 },
  hull: { x: 28, y: 53 },
  engine: { x: 38, y: 40 },
  midship: { x: 48, y: 60 },
  keel: { x: 55, y: 66 },
  cabins: { x: 60, y: 52 },
  bridge: { x: 58, y: 41 },
  mast: { x: 52.6, y: 26 },
  market: { x: 65.5, y: 36.5 },
  aero: { x: 76, y: 50 },
  anchor: { x: 84.5, y: 62 },
  bow: { x: 94, y: 52 },
}
