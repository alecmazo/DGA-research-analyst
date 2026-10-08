/** Footprints on the ground plane. y is up and is applied by the scene, not here.
 *  +x is east. +z points toward the opening camera. OrbitControls owns the drag.
 *  Height and footprint follow public market cap on a log scale. A missing cap
 *  is the modest building, never a guessed mega-cap.
 */

export type CampusHolding = {
  symbol: string
  market_cap?: number | null
}

export type CampusSector = {
  part: string
  holdings: CampusHolding[]
}

export type PlacedBuilding = {
  symbol: string
  part: string
  x: number
  z: number
  foot: number
  depth: number
  height: number
  landmark: boolean
}

export type PlacedBlock = {
  part: string
  x: number
  z: number
  w: number
  d: number
}

export type CampusLayout = {
  buildings: PlacedBuilding[]
  blocks: PlacedBlock[]
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
}

export const STREET = 18
export const GAP = 3.4
export const MARGIN = 7

const MODEST_HEIGHT = 7.2
const MODEST_FOOT = 5.4
const LOG_LO = 8
const LOG_HI = Math.log10(3e12)

/** Back row is the far side of the terrace. Front row sits toward the camera. */
export const NEIGHBORHOOD_ROWS: readonly (readonly string[])[] = [
  ['keel', 'engine', 'aero', 'deck', 'midship'],
  ['bridge', 'mast', 'market', 'cabins', 'stern'],
  ['bow', 'hull', 'staples', 'cargo', 'anchor'],
]

export type FacadeKind =
  | 'glass'
  | 'stone'
  | 'brick'
  | 'sand'
  | 'rose'
  | 'power'
  | 'industrial'
  | 'white'
  | 'vault'
  | 'copper'

const PART_FACADE: Record<string, FacadeKind> = {
  bridge: 'glass',
  mast: 'glass',
  bow: 'stone',
  market: 'stone',
  staples: 'brick',
  cargo: 'brick',
  midship: 'brick',
  cabins: 'sand',
  hull: 'rose',
  keel: 'power',
  engine: 'power',
  deck: 'industrial',
  aero: 'white',
  anchor: 'vault',
  stern: 'copper',
}

export function facadeKind(part: string): FacadeKind {
  return PART_FACADE[part] || 'stone'
}

export type MassTier = {
  y0: number
  h: number
  foot: number
  depth: number
  role: 'plinth' | 'shaft'
}

/** Closest orbit distance. Near enough to read a facade, still outside the wall. */
export const MIN_ZOOM = 3.4

/** Distance that fits one tower in the frame. */
export function frameDistance(height: number): number {
  if (!Number.isFinite(height) || height <= 0) return 18
  return Math.max(MIN_ZOOM, Math.min(36, height * 0.9))
}

/**
 * Stacked massing for one company. The plinth is only slightly wider than the
 * footprint from layoutCampus, so neighborhood gaps stay open.
 */
export function massTiers(height: number, foot: number, depth: number, kind: FacadeKind): MassTier[] {
  const safeH = Math.max(height, 1)
  const podiumH = Math.min(2.6, safeH * 0.34, Math.max(1.05, safeH * 0.16))
  const tiers: MassTier[] = [{
    y0: 0,
    h: podiumH,
    foot: foot * 1.08,
    depth: depth * 1.08,
    role: 'plinth',
  }]
  let y = podiumH
  let remain = Math.max(0, safeH - podiumH)
  let sx = foot
  let sz = depth
  const steps = kind === 'vault'
    ? (safeH > 28 ? 3 : 2)
    : safeH > 34 ? 3 : safeH > 18 ? 2 : 1
  const shrink = kind === 'glass' || kind === 'white' ? 0.74 : kind === 'vault' ? 0.8 : 0.86
  for (let i = 0; i < steps; i += 1) {
    const last = i === steps - 1
    const frac = i === 0 ? 0.58 : 0.62
    const slice = last ? remain : Math.max(0.45, Math.min(remain * frac, remain - 0.45))
    if (i > 0) {
      sx *= shrink
      sz *= shrink
    }
    tiers.push({ y0: y, h: slice, foot: sx, depth: sz, role: 'shaft' })
    y += slice
    remain = Math.max(0, remain - slice)
  }
  return tiers
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export function buildingScale(marketCap: number | null | undefined): { height: number; foot: number } {
  if (marketCap == null || !Number.isFinite(marketCap) || marketCap <= 0) {
    return { height: MODEST_HEIGHT, foot: MODEST_FOOT }
  }
  const t = clamp((Math.log10(marketCap) - LOG_LO) / (LOG_HI - LOG_LO), 0, 1)
  const eased = t ** 0.85
  return {
    height: 6.5 + eased * 46,
    foot: 4.6 + eased * 7.4,
  }
}

function slotOrder(cols: number, rows: number, n: number): { col: number; row: number }[] {
  const slots: { col: number; row: number; score: number }[] = []
  const center = (cols - 1) / 2
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      slots.push({ col, row, score: row * 100 + Math.abs(col - center) })
    }
  }
  slots.sort((a, b) => a.score - b.score || a.col - b.col)
  return slots.slice(0, n).map(({ col, row }) => ({ col, row }))
}

type DraftBuilding = {
  symbol: string
  height: number
  foot: number
  depth: number
  landmark: boolean
  lx: number
  lz: number
}

function draftBlock(holdings: CampusHolding[]): { w: number; d: number; buildings: DraftBuilding[] } {
  const scaled = holdings.map((holding) => {
    const size = buildingScale(holding.market_cap)
    return {
      symbol: holding.symbol,
      height: size.height,
      foot: size.foot,
      depth: size.foot * 0.86,
    }
  })
  scaled.sort((a, b) => b.height - a.height || a.symbol.localeCompare(b.symbol))
  const count = scaled.length
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  const cellX = Math.max(...scaled.map((row) => row.foot)) + GAP
  const cellZ = Math.max(...scaled.map((row) => row.depth)) + GAP
  const innerW = cols * cellX
  const innerD = rows * cellZ
  const slots = slotOrder(cols, rows, count)
  const buildings = scaled.map((row, index) => {
    const slot = slots[index]
    return {
      ...row,
      landmark: index === 0,
      lx: (slot.col + 0.5) * cellX - innerW / 2,
      lz: (slot.row + 0.5) * cellZ - innerD / 2,
    }
  })
  return {
    w: innerW + MARGIN * 2,
    d: innerD + MARGIN * 2,
    buildings,
  }
}

export function layoutCampus(sectors: CampusSector[]): CampusLayout {
  const byPart = new Map<string, CampusHolding[]>()
  for (const sector of sectors) {
    const holdings = (sector.holdings || []).filter((row) => row && row.symbol)
    if (!holdings.length || !sector.part) continue
    const prior = byPart.get(sector.part)
    if (prior) prior.push(...holdings)
    else byPart.set(sector.part, holdings.slice())
  }

  const used = new Set<string>()
  const rows: string[][] = []
  for (const plan of NEIGHBORHOOD_ROWS) {
    const present = plan.filter((part) => byPart.has(part))
    if (present.length) rows.push(present)
    present.forEach((part) => used.add(part))
  }
  const extra = [...byPart.keys()].filter((part) => !used.has(part)).sort()
  if (extra.length) rows.push(extra)

  const blocks: PlacedBlock[] = []
  const buildings: PlacedBuilding[] = []
  let cursorZ = 0
  for (const row of rows) {
    const drafts = row.map((part) => ({ part, ...draftBlock(byPart.get(part) || []) }))
    const rowW = drafts.reduce((sum, draft) => sum + draft.w, 0) + STREET * Math.max(0, drafts.length - 1)
    const rowD = Math.max(...drafts.map((draft) => draft.d))
    let cursorX = -rowW / 2
    const front = cursorZ + rowD
    for (const draft of drafts) {
      const cx = cursorX + draft.w / 2
      const cz = front - draft.d / 2
      blocks.push({ part: draft.part, x: cx, z: cz, w: draft.w, d: draft.d })
      for (const building of draft.buildings) {
        buildings.push({
          symbol: building.symbol,
          part: draft.part,
          x: cx + building.lx,
          z: cz + building.lz,
          foot: building.foot,
          depth: building.depth,
          height: building.height,
          landmark: building.landmark,
        })
      }
      cursorX += draft.w + STREET
    }
    cursorZ += rowD + STREET
  }

  if (blocks.length) {
    let minZ = Infinity
    let maxZ = -Infinity
    for (const block of blocks) {
      minZ = Math.min(minZ, block.z - block.d / 2)
      maxZ = Math.max(maxZ, block.z + block.d / 2)
    }
    const shift = (minZ + maxZ) / 2
    for (const block of blocks) block.z -= shift
    for (const building of buildings) building.z -= shift
  }

  const bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }
  if (blocks.length) {
    bounds.minX = Math.min(...blocks.map((block) => block.x - block.w / 2))
    bounds.maxX = Math.max(...blocks.map((block) => block.x + block.w / 2))
    bounds.minZ = Math.min(...blocks.map((block) => block.z - block.d / 2))
    bounds.maxZ = Math.max(...blocks.map((block) => block.z + block.d / 2))
  }
  return { buildings, blocks, bounds }
}
