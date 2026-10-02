import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  getLoadSnapshot,
  resetLoadFlow,
  trackLoad,
  type FlowBox,
  type FlowNode,
} from '../src/lib/loadFlow.ts'
import { FOLDER_DIRS, REPO_ROOT, buildRepoFlow, folderIds } from '../src/lib/repoFlow.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

function labels(node: FlowNode, out: string[] = []): string[] {
  out.push(node.label)
  node.children?.forEach((child) => labels(child, out))
  return out
}

function find(node: FlowNode, id: string): FlowNode | null {
  if (node.id === id) return node
  for (const child of node.children || []) {
    const hit = find(child, id)
    if (hit) return hit
  }
  return null
}

describe('folder names', () => {
  it('uses the directory name, and that directory is on disk', () => {
    const seen = labels(REPO_ROOT)
    assert.deepEqual(seen, Object.keys(FOLDER_DIRS))
    for (const [id, rel] of Object.entries(FOLDER_DIRS)) {
      const node = find(REPO_ROOT, id)
      assert.ok(node, id)
      assert.equal(node.label, rel.split('/').pop())
      assert.ok(existsSync(resolve(ROOT, rel)), rel)
    }
  })
})

describe('folderIds', () => {
  it('follows the folder the route actually enters', () => {
    assert.deepEqual(folderIds('/api/watchlist'), ['web', 'gp-app', 'api'])
    assert.deepEqual(folderIds('/api/credit/issuers'), ['web', 'gp-app', 'api', 'domains', 'credit'])
    assert.deepEqual(folderIds('/api/merger-arb/deals'), [
      'web',
      'gp-app',
      'api',
      'domains',
      'merger_arb',
    ])
    assert.deepEqual(folderIds('/api/merger-arb/scan'), [
      'web',
      'gp-app',
      'api',
      'domains',
      'merger_arb',
      'scanner',
    ])
    assert.ok(folderIds('/api/merger-arb/candidates/1/add').includes('scanner'))
    assert.ok(!folderIds('/api/merger-arb/analysis/1').includes('scanner'))
    assert.deepEqual(folderIds('/api/transcripts'), ['web', 'gp-app', 'api', 'podcast_intel'])
    assert.ok(!folderIds('/api/transcripts').includes('domains'))
    assert.ok(folderIds('/api/financials/AAPL').includes('domains'))
    assert.ok(!folderIds('/api/financials/AAPL').includes('stock-financials'))
    assert.ok(folderIds('/api/financials/sync').includes('stock-financials'))
    assert.ok(folderIds('/api/gurus').includes('domains'))
    assert.ok(folderIds('/api/support/open-count').includes('domains'))
    assert.ok(!folderIds('/api/v2/builder/lists').includes('domains'))
    assert.ok(folderIds('/api/v2/builder/gurufocus').includes('data'))
    assert.ok(folderIds('/api/reports/AAPL').includes('stocks'))
    assert.ok(!folderIds('/api/reports/AAPL').includes('domains'))
    assert.ok(folderIds('/api/analyze').includes('prompts'))
    assert.ok(folderIds('/api/analyze').includes('stocks'))
    assert.deepEqual(folderIds('/api/podcast/AAPL/audio.mp3'), ['web', 'gp-app', 'api', 'podcast'])
    assert.deepEqual(folderIds('/api/podcast/scripts'), ['web', 'gp-app', 'api'])
    assert.deepEqual(folderIds('ollama://chat'), ['web', 'gp-app'])
    assert.deepEqual(folderIds('ollama://ensure'), ['web', 'gp-app', 'scripts'])
    assert.deepEqual(folderIds('/branding/dga_logo_small.png'), ['web', 'gp-app', 'api', 'branding'])
  })
})

describe('buildRepoFlow', () => {
  it('moves the credit branch while that call is in flight and leaves the others quiet', () => {
    resetLoadFlow()
    const done = trackLoad('/api/credit/issuers')
    const chart = buildRepoFlow(getLoadSnapshot().leaves)
    assert.equal(mustBox(chart.root, 'credit').phase, 'loading')
    assert.equal(mustBox(chart.root, 'domains').phase, 'loading')
    assert.equal(mustBox(chart.root, 'api').phase, 'loading')
    assert.equal(mustBox(chart.root, 'web').phase, 'loading')
    assert.equal(mustBox(chart.root, 'scanner').phase, 'idle')
    assert.equal(mustBox(chart.root, 'scripts').phase, 'idle')
    done('ok')
    const settled = buildRepoFlow(getLoadSnapshot().leaves)
    assert.equal(mustBox(settled.root, 'credit').phase, 'loaded')
    assert.equal(mustBox(settled.root, 'scanner').phase, 'idle')
    const quiet = buildRepoFlow({})
    assert.ok(quiet.width <= 1172, `chart is ${quiet.width}px, wider than the desk card`)
    assert.equal(mustBox(quiet.root, 'scanner').x > mustBox(quiet.root, 'merger_arb').x, true)
    resetLoadFlow()
  })
})

function findBox(box: FlowBox, id: string): FlowBox | null {
  if (box.id === id) return box
  for (const child of box.children) {
    const hit = findBox(child, id)
    if (hit) return hit
  }
  return null
}

function mustBox(box: FlowBox, id: string): FlowBox {
  const hit = findBox(box, id)
  if (!hit) throw new Error(`missing ${id}`)
  return hit
}
