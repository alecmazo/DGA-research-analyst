/** Plates follow the expedition hull. ViewBox 0 0 1400 800. Bow to the right. */

export type ShipPart =
  | 'keel'
  | 'engine'
  | 'cargo'
  | 'bow'
  | 'stern'
  | 'midship'
  | 'bridge'
  | 'mast'
  | 'deck'
  | 'hull'
  | 'anchor'
  | 'cabins'

export const DRAW_ORDER: ShipPart[] = [
  'keel',
  'engine',
  'cargo',
  'bow',
  'stern',
  'midship',
  'bridge',
  'mast',
  'deck',
  'hull',
  'anchor',
  'cabins',
]

/** Steel hull. Transom at the left, raked stem at the right, modest draft. */
export const HULL =
  'M214 452 L258 408 L392 390 C740 366 1010 360 1112 370 C1176 378 1218 408 1240 456 L1222 512 C1140 548 900 566 660 564 C400 562 276 544 232 512 L214 470 Z'

export const WATERLINE = 'M232 498 C480 508 860 504 1120 492 C1168 488 1204 492 1222 500'

export const PLATES: Record<ShipPart, { d: string; label: [number, number] }> = {
  keel: {
    d: 'M232 500 L1220 494 L1222 512 C1140 548 900 566 660 564 C400 562 276 544 232 512 Z',
    label: [700, 532],
  },
  engine: {
    d: 'M424 332 L440 228 H486 L504 332 Z',
    label: [464, 210],
  },
  cargo: {
    d: 'M676 338 H754 V404 H676 Z M760 330 H840 V404 H760 Z M846 346 H916 V404 H846 Z',
    label: [796, 318],
  },
  bow: {
    d: 'M1068 376 C1144 372 1204 400 1234 452 L1220 500 L1068 496 Z',
    label: [1156, 444],
  },
  stern: {
    d: 'M214 452 L258 408 L360 394 L360 500 L232 508 L214 470 Z',
    label: [286, 456],
  },
  midship: {
    d: 'M928 352 H986 V404 H928 Z M992 358 H1044 V404 H992 Z',
    label: [986, 340],
  },
  bridge: {
    d: 'M348 404 L348 318 C348 304 364 290 404 280 L548 272 L612 300 L612 398 Z',
    label: [478, 348],
  },
  mast: {
    d: 'M548 272 V156 H562 V272 Z M516 186 H594 V198 H516 Z M555 156 m-15 0 a15 15 0 1 0 30 0 a15 15 0 1 0 -30 0',
    label: [628, 176],
  },
  deck: {
    d: 'M978 400 V268 H992 V400 Z M984 276 L1124 328 L1118 340 L984 290 Z M1106 334 V392 H1116 V334 Z M1094 384 H1132 V398 H1094 Z',
    label: [1060, 292],
  },
  hull: {
    d: 'M624 392 L732 392 C732 406 700 412 678 406 C656 412 624 406 624 392 Z M746 388 L856 388 C856 404 824 410 800 404 C776 410 746 404 746 388 Z',
    label: [742, 424],
  },
  anchor: {
    d: 'M1168 486 m-7 0 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0 M1162 492 H1174 V548 H1162 Z M1146 536 C1162 566 1190 566 1206 536 L1198 532 C1188 552 1166 552 1156 532 Z',
    label: [1170, 576],
  },
  cabins: {
    d: 'M430 318 H548 V348 H430 Z',
    label: [488, 308],
  },
}
