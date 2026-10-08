import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { companyBands } from '../src/pages/ship/washes.ts'

describe('company washes', () => {
  it('puts the heaviest names in larger labeled stripes', () => {
    const bands = companyBands([
      { symbol: 'MSFT', weight_pct: 8 },
      { symbol: 'NVDA', weight_pct: 14 },
      { symbol: 'AAPL', weight_pct: 1 },
    ])
    assert.deepEqual(bands.map((band) => band.symbol), ['NVDA', 'MSFT', 'AAPL'])
    assert.equal(bands[0].label, true)
    assert.equal(bands[1].label, true)
    assert.equal(bands[2].label, false)
    assert.ok(bands[0].scale > bands[1].scale)
    assert.ok(Math.abs(bands[0].share - 14 / 23) < 1e-9)
  })

  it('leaves forty equal names as unlabeled stripes', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ symbol: `N${i}`, weight_pct: 1 }))
    const bands = companyBands(rows)
    assert.equal(bands.length, 40)
    assert.ok(bands.every((band) => !band.label))
    assert.ok(bands.every((band) => Math.abs(band.share - 0.025) < 1e-9))
  })

  it('uses equal unlabeled stripes when the weights sum to zero', () => {
    const bands = companyBands([
      { symbol: 'B', weight_pct: 0 },
      { symbol: 'A', weight_pct: 0 },
    ])
    assert.deepEqual(bands.map((band) => band.symbol), ['A', 'B'])
    assert.ok(bands.every((band) => !band.label && band.share === 0.5))
  })

  it('labels at most four names', () => {
    const rows = [20, 18, 16, 14, 13, 12].map((weight, i) => ({ symbol: `S${i}`, weight_pct: weight }))
    const bands = companyBands(rows)
    assert.equal(bands.filter((band) => band.label).length, 4)
    assert.equal(bands[4].label, false)
  })
})
