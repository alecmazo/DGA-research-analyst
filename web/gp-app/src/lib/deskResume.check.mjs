import assert from 'node:assert/strict'
import {
  clearDeskMemory,
  pendingQueue,
  readDeskMemory,
  recentLocalNote,
  rememberDeskSave,
} from './deskResume.ts'

const now = Date.parse('2026-10-26T19:00:00Z')
const recent = '2026-10-26T17:00:00Z'
const old = '2026-10-19T17:00:00Z'
const models = ['gpt-oss-20b-finance', 'gemma']

assert.equal(recentLocalNote(recent, now), true)
assert.equal(recentLocalNote(old, now), false)
assert.equal(recentLocalNote('not-a-date', now), false)
assert.equal(recentLocalNote(new Date(now + 2 * 60 * 1000).toISOString(), now), true)
assert.equal(recentLocalNote(new Date(now + 10 * 60 * 1000).toISOString(), now), false)

const rows = [
  {
    ticker: 'aaa',
    local_views: [
      { model: 'gpt-oss-20b-finance', generated_at: recent },
      { model: 'gemma', generated_at: old },
    ],
  },
  { ticker: 'BBB', local_views: [], generated_at: recent },
  {
    ticker: 'CCC',
    local_views: [
      { model: 'gpt-oss-20b-finance:latest', generated_at: recent },
      { model: 'gemma', generated_at: recent },
    ],
  },
  { ticker: 'DDD', local_views: [{ model: 'gemma', generated_at: old }], generated_at: recent },
]

const first = pendingQueue(['AAA', 'BBB', 'CCC', 'DDD'], models, rows, new Set(), now)
assert.deepEqual(first.queue, [
  { tk: 'AAA', models: ['gemma'] },
  { tk: 'DDD', models },
])
assert.equal(first.skipped, 5)

const remembered = pendingQueue(
  ['AAA', 'BBB', 'CCC', 'DDD'],
  models,
  rows,
  new Set(['AAA|gemma']),
  now,
)
assert.deepEqual(remembered.queue, [{ tk: 'DDD', models }])
assert.equal(remembered.skipped, 6)

const memory = new Map()
const storage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, value),
  removeItem: (key) => memory.delete(key),
}
rememberDeskSave('spy', 'gemma', now, storage)
assert.deepEqual([...readDeskMemory(now, storage)], ['SPY|gemma'])
storage.setItem(
  'dga.local.deskRun',
  JSON.stringify({ startedAt: now - 9 * 60 * 60 * 1000, done: ['OLD|gemma'] }),
)
assert.equal(readDeskMemory(now, storage).size, 0)
rememberDeskSave('qqq', 'gemma', now, storage)
assert.deepEqual([...readDeskMemory(now, storage)], ['QQQ|gemma'])
clearDeskMemory(storage)
assert.equal(readDeskMemory(now, storage).size, 0)

console.log('desk resume checks passed')
