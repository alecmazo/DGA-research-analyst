/** Sections on public/ship/deck.png. Percent of the 16:9 frame. Bow is to the right. */

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

export type WashRect = { x: number; y: number; w: number; h: number }

/** Big plates first so the tower, mast, and cranes stay on top. */
export const DRAW_ORDER: ShipPart[] = [
  'stern',
  'hull',
  'engine',
  'keel',
  'anchor',
  'staples',
  'midship',
  'cargo',
  'aero',
  'market',
  'bow',
  'cabins',
  'deck',
  'bridge',
  'mast',
]

export const WASHES: Record<ShipPart, WashRect[]> = {
  stern: [{ x: 3.6, y: 53.6, w: 13.2, h: 18.6 }],
  staples: [{ x: 17.0, y: 53.0, w: 9.0, h: 9.2 }],
  hull: [{ x: 15.4, y: 62.6, w: 22.4, h: 10.0 }],
  engine: [{ x: 37.8, y: 62.4, w: 11.4, h: 10.2 }],
  keel: [{ x: 49.2, y: 62.6, w: 18.4, h: 10.0 }],
  anchor: [{ x: 74.0, y: 63.0, w: 14.0, h: 9.0 }],
  midship: [{ x: 38.4, y: 51.0, w: 20.2, h: 9.6 }],
  cargo: [{ x: 59.0, y: 53.0, w: 15.0, h: 8.6 }],
  aero: [{ x: 74.2, y: 52.2, w: 8.4, h: 9.2 }],
  market: [{ x: 82.8, y: 52.2, w: 9.6, h: 7.8 }],
  bow: [{ x: 92.6, y: 54.0, w: 6.2, h: 8.6 }],
  cabins: [{ x: 35.0, y: 43.0, w: 28.8, h: 8.2 }],
  deck: [
    { x: 18.0, y: 37.0, w: 16.6, h: 15.6 },
    { x: 58.8, y: 36.4, w: 16.6, h: 16.2 },
  ],
  bridge: [{ x: 42.8, y: 26.8, w: 14.2, h: 16.4 }],
  mast: [{ x: 46.6, y: 14.8, w: 6.6, h: 12.2 }],
}
