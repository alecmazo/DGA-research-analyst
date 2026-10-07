import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crestPath, pathYRange, seaPaint } from '../src/pages/ship/sea.ts'

describe('sea scale', () => {
  it('slides from glassy sun to a dark chop', () => {
    const perfect = seaPaint(1)
    const flat = seaPaint(0.6)
    const worst = seaPaint(0)
    assert.ok(perfect.amp < flat.amp)
    assert.ok(flat.amp < worst.amp)
    assert.ok(perfect.freq < worst.freq)
    assert.ok(perfect.sunY < flat.sunY)
    assert.ok(flat.sunY < worst.sunY)
    assert.equal(perfect.rain, 0)
    assert.equal(flat.rain, 0)
    assert.equal(worst.rain, 1)
    assert.ok(perfect.glitter > worst.glitter)
    assert.ok(perfect.displace < worst.displace)
    assert.ok(perfect.shade < worst.shade)
    const mid = seaPaint(0.5)
    assert.ok(mid.amp > perfect.amp && mid.amp < worst.amp)
    assert.ok(mid.sunY > perfect.sunY && mid.sunY < worst.sunY)
  })

  it('draws a taller crest when the sea is worse', () => {
    const calm = seaPaint(1)
    const storm = seaPaint(0)
    const calmRange = pathYRange(crestPath(520, calm.amp, calm.freq, 0.4))
    const stormRange = pathYRange(crestPath(520, storm.amp, storm.freq, 0.4))
    assert.ok(stormRange > calmRange * 3, `${stormRange} vs ${calmRange}`)
  })
})
