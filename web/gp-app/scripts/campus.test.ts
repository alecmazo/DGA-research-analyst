import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  frameDistance,
  buildingScale,
  facadeKind,
  layoutCampus,
  massTiers,
  MIN_ZOOM,
  type CampusSector,
} from '../src/pages/ship/campus.ts'

function sector(part: string, rows: [string, number | null][]): CampusSector {
  return {
    part,
    holdings: rows.map(([symbol, market_cap]) => ({ symbol, market_cap })),
  }
}

function overlaps(
  a: { x: number; z: number; w: number; d: number },
  b: { x: number; z: number; w: number; d: number },
): boolean {
  const x = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2)
  const z = Math.min(a.z + a.d / 2, b.z + b.d / 2) - Math.max(a.z - a.d / 2, b.z - b.d / 2)
  return x > 0.05 && z > 0.05
}

describe('campus scale', () => {
  it('keeps a missing market cap modest', () => {
    const missing = buildingScale(null)
    assert.deepEqual(missing, buildingScale(undefined))
    assert.deepEqual(missing, buildingScale(0))
    assert.deepEqual(missing, buildingScale(Number.NaN))
    assert.deepEqual(missing, buildingScale(-5))
    assert.equal(missing.height, 7.2)
    assert.ok(missing.height < buildingScale(5e11).height)
    assert.ok(missing.foot < buildingScale(5e11).foot)
  })

  it('grows with market cap on a log scale', () => {
    const small = buildingScale(1e9)
    const mid = buildingScale(1e11)
    const large = buildingScale(3e12)
    assert.ok(small.height < mid.height)
    assert.ok(mid.height < large.height)
    assert.ok(small.foot < large.foot)
    assert.ok(large.height / buildingScale(1e8).height < 12)
    assert.ok(large.height / buildingScale(1e8).height > 4)
    assert.ok(buildingScale(1e12).height / buildingScale(1e10).height < 3)
  })

  it('makes a bank much taller than a preferred', () => {
    const bank = buildingScale(2.5e11)
    const preferred = buildingScale(8e8)
    assert.ok(bank.height > preferred.height * 1.8)
    assert.ok(bank.foot > preferred.foot)
    assert.ok(preferred.height > buildingScale(null).height)
  })
})

describe('campus layout', () => {
  const book: CampusSector[] = [
    sector('bridge', [['NVDA', 3e12], ['MSFT', 3e12], ['AAPL', 2e12], ['SHOP', 8e10], ['NOW', 2e11], ['CRWD', 7e10]]),
    sector('bow', [['JPM', 6e11], ['GS', 1.5e11]]),
    sector('keel', [['NEE', 1.4e11]]),
    sector('deck', [['CAT', 1.6e11], ['DE', 1.1e11]]),
    sector('anchor', [['SPAXX', null]]),
    sector('stern', [['IBRX', 2e9], ['FNMA', null]]),
    sector('hull', [['LLY', 7e11]]),
    sector('staples', [['NKE', 1e11]]),
    sector('cabins', [['EQIX', 8e10]]),
    sector('aero', [['SPCX', null]]),
    sector('mast', [['NFLX', 3e11]]),
    sector('market', [['SPY', 6e11]]),
    sector('cargo', [['UBER', 1.5e11]]),
    sector('engine', [['XOM', 4e11]]),
    sector('midship', [['LIN', 2e11]]),
  ]

  it('places one building per company inside separated neighborhoods', () => {
    const layout = layoutCampus(book)
    const symbols = layout.buildings.map((row) => row.symbol).sort()
    const expected = book.flatMap((row) => row.holdings.map((holding) => holding.symbol)).sort()
    assert.deepEqual(symbols, expected)
    assert.equal(layout.blocks.length, 15)
    assert.ok(layout.bounds.maxX - layout.bounds.minX > layout.bounds.maxZ - layout.bounds.minZ)

    for (let i = 0; i < layout.buildings.length; i += 1) {
      for (let j = i + 1; j < layout.buildings.length; j += 1) {
        const a = layout.buildings[i]
        const b = layout.buildings[j]
        assert.equal(
          overlaps(
            { x: a.x, z: a.z, w: a.foot, d: a.depth },
            { x: b.x, z: b.z, w: b.foot, d: b.depth },
          ),
          false,
          `${a.symbol} overlaps ${b.symbol}`,
        )
      }
    }
    for (let i = 0; i < layout.blocks.length; i += 1) {
      for (let j = i + 1; j < layout.blocks.length; j += 1) {
        assert.equal(overlaps(layout.blocks[i], layout.blocks[j]), false)
      }
    }
  })

  it('keeps each building on its neighborhood pad and marks one landmark', () => {
    const layout = layoutCampus(book)
    for (const building of layout.buildings) {
      const block = layout.blocks.find((row) => row.part === building.part)
      assert.ok(block)
      assert.ok(building.x - building.foot / 2 >= block.x - block.w / 2 - 0.01)
      assert.ok(building.x + building.foot / 2 <= block.x + block.w / 2 + 0.01)
      assert.ok(building.z - building.depth / 2 >= block.z - block.d / 2 - 0.01)
      assert.ok(building.z + building.depth / 2 <= block.z + block.d / 2 + 0.01)
    }
    const bridge = layout.buildings.filter((row) => row.part === 'bridge')
    const marks = bridge.filter((row) => row.landmark)
    assert.equal(marks.length, 1)
    assert.equal(marks[0].height, Math.max(...bridge.map((row) => row.height)))
    const anchor = layout.buildings.find((row) => row.symbol === 'SPAXX')
    const nvda = layout.buildings.find((row) => row.symbol === 'NVDA')
    assert.ok(anchor && nvda && anchor.height < nvda.height)
  })

  it('drops an empty neighborhood and still places an unknown part', () => {
    const layout = layoutCampus([
      sector('bridge', [['NVDA', 1e12]]),
      sector('engine', []),
      sector('custom', [['ZZ', 1e9]]),
    ])
    assert.deepEqual(layout.blocks.map((row) => row.part).sort(), ['bridge', 'custom'])
    assert.equal(facadeKind('bridge'), 'glass')
    assert.equal(facadeKind('custom'), 'stone')
    assert.equal(facadeKind('anchor'), 'vault')
  })

  it('is stable', () => {
    assert.deepEqual(layoutCampus(book), layoutCampus(book))
  })

  it('stacks setbacks on the market-cap footprint without crossing a neighbor', () => {
    const layout = layoutCampus(book)
    for (const building of layout.buildings) {
      const tiers = massTiers(building.height, building.foot, building.depth, facadeKind(building.part))
      const sum = tiers.reduce((total, tier) => total + tier.h, 0)
      assert.ok(Math.abs(sum - building.height) < 0.08, building.symbol)
      assert.equal(tiers[0].role, 'plinth')
      assert.ok(tiers[0].foot <= building.foot * 1.081)
      const shafts = tiers.filter((tier) => tier.role === 'shaft')
      assert.ok(shafts.length >= 1)
      assert.ok(shafts[shafts.length - 1].foot <= shafts[0].foot + 0.001)
      if (building.height > 34 || facadeKind(building.part) === 'vault') {
        assert.ok(shafts.length >= 2)
        assert.ok(shafts[1].foot < shafts[0].foot)
      }
    }
    for (let i = 0; i < layout.buildings.length; i += 1) {
      for (let j = i + 1; j < layout.buildings.length; j += 1) {
        const a = layout.buildings[i]
        const b = layout.buildings[j]
        const pa = massTiers(a.height, a.foot, a.depth, facadeKind(a.part))[0]
        const pb = massTiers(b.height, b.foot, b.depth, facadeKind(b.part))[0]
        assert.equal(
          overlaps({ x: a.x, z: a.z, w: pa.foot, d: pa.depth }, { x: b.x, z: b.z, w: pb.foot, d: pb.depth }),
          false,
          `${a.symbol} plinth overlaps ${b.symbol}`,
        )
      }
    }
  })
})

describe('campus zoom', () => {
  it('frames a tower and stops outside the wall', () => {
    assert.equal(frameDistance(40), 36)
    assert.equal(frameDistance(10), 9)
    assert.equal(frameDistance(2), MIN_ZOOM)
    assert.equal(frameDistance(Number.NaN), 18)
    assert.ok(MIN_ZOOM < 7.2)
  })
})
