import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Vector3 } from 'three'
import { panVector } from '../src/city/camera/frame.ts'
import { equityGlass, isStale, shownFootprint, shownHeight, tradingDaysSince } from '../src/city/metrics.ts'

const sized = {
  size: {
    height_by_market_cap: 64,
    height_by_position_value: 40,
    height_by_total_assets: null,
    footprint: 9,
    footprint_by_market_cap: 11,
    footprint_by_position_value: 8,
    footprint_by_total_assets: null,
  },
}

describe('city metrics', () => {
  it('uses the server height and a stub when the metric is missing', () => {
    assert.equal(shownHeight(sized, 'market_cap'), 64)
    assert.equal(shownHeight(sized, 'total_assets'), 8)
    assert.equal(shownFootprint(sized, 'market_cap'), 11)
    assert.equal(shownFootprint(sized, 'total_assets'), 9)
  })

  it('draws the equity glass from the server fraction', () => {
    const up = equityGlass(100, { side: 'up', fraction: 0.1 })
    assert.deepEqual(up, { y: 5, h: 10, below: false })
    const down = equityGlass(100, { side: 'down', fraction: 0.45 })
    assert.equal(down?.below, true)
    assert.equal(down?.h, 45)
    assert.equal(equityGlass(100, null), null)
  })

  it('marks a book older than two trading days as stale', () => {
    const now = new Date('2026-10-07T18:00:00Z')
    assert.equal(tradingDaysSince('2026-10-07', now), 0)
    assert.equal(isStale('2026-10-05', now), false)
    assert.equal(isStale('2026-10-02', now), true)
    assert.equal(isStale('14:02 UTC', now), false)
  })
})

describe('camera pan', () => {
  it('strafes to +x when the camera looks down -z', () => {
    const out = new Vector3()
    panVector(0, 0, -1, 1, 0, out)
    assert.ok(Math.abs(out.x) < 1e-6 && Math.abs(out.z + 1) < 1e-6)
    panVector(0, 0.4, -1, 0, 1, out)
    assert.ok(Math.abs(out.x - 1) < 1e-6, `right was ${out.x}`)
    assert.ok(Math.abs(out.y) < 1e-6)
    assert.ok(Math.abs(out.z) < 1e-6)
  })
})
