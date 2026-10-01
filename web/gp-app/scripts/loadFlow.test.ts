import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import {
  FLOW_ROOT,
  LEAF_IDS,
  buildFlow,
  findFlowBox,
  flowLinks,
  getLoadSnapshot,
  leafPhase,
  matchLeaf,
  resetLoadFlow,
  trackLoad,
  type FlowBox,
  type FlowNode,
} from '../src/lib/loadFlow.ts'

function ids(node: FlowNode, out: string[] = []): string[] {
  out.push(node.id)
  node.children?.forEach((child) => ids(child, out))
  return out
}

function must(box: FlowBox | null, label: string): FlowBox {
  if (!box) throw new Error(`missing ${label}`)
  return box
}

beforeEach(() => {
  resetLoadFlow()
})

describe('matchLeaf', () => {
  it('follows the boot, not a loose prefix', () => {
    assert.equal(matchLeaf('/api/auth/v2/me'), 'me')
    assert.equal(matchLeaf('/api/auth/v2/mfa/status'), 'settings')
    assert.equal(matchLeaf('/api/build'), 'build')
    assert.equal(matchLeaf('/api/financials/desk-notice'), 'sec')
    assert.equal(matchLeaf('/api/financials/metrics?tickers=AAPL'), 'metrics')
    assert.equal(matchLeaf('/api/financials/overnight'), 'settings')
    assert.equal(matchLeaf('/api/financials/AAPL/dashboard'), 'company')
    assert.equal(matchLeaf('/api/fund/list'), 'funds')
    assert.equal(matchLeaf('/api/fund/positions?fund_id=1'), 'positions')
    assert.equal(matchLeaf('/api/v2/gp/nav'), 'accountBook')
    assert.equal(matchLeaf('/api/v2/gp/email-test'), 'settings')
    assert.equal(matchLeaf('/api/local/reports'), 'localBooks')
    assert.equal(matchLeaf('/api/merger-arb/deals'), 'mergerArb')
    assert.equal(matchLeaf('/api/reports'), 'reports')
    assert.equal(matchLeaf('/api/reports/AAPL/valuation'), 'reportWindow')
    assert.equal(matchLeaf('/api/market/pulse?limit=8'), 'pulse')
    assert.equal(matchLeaf('/api/market/pulse?limit=8&merge=true&tickers=AAPL'), 'headlines')
    assert.equal(matchLeaf('/api/support/open-count'), 'tickets')
    assert.equal(matchLeaf('/api/support/tickets/1/update'), 'settings')
    assert.equal(matchLeaf('/api/jobs/abc'), 'analyze')
    assert.equal(matchLeaf('ollama://chat'), 'ollama')
    assert.equal(matchLeaf('https://example.com/api/watchlist?fresh=1'), 'watchlist')
    assert.equal(matchLeaf('/api/desk/window-email'), 'other')
  })
})

describe('trackLoad', () => {
  it('stays yellow until the first success, then green while a poll is still out', () => {
    const first = trackLoad('/api/watchlist')
    assert.equal(leafPhase(getLoadSnapshot().leaves.watchlist), 'loading')
    const second = trackLoad('/api/watchlist')
    first('ok')
    const mid = getLoadSnapshot().leaves.watchlist
    assert.equal(mid.inflight, 1)
    assert.equal(leafPhase(mid), 'loaded')
    second('ok')
    assert.equal(leafPhase(getLoadSnapshot().leaves.watchlist), 'loaded')
    assert.equal(getLoadSnapshot().leaves.watchlist.inflight, 0)
  })

  it('turns red when the last try failed and yellow again on a retry', () => {
    const fail = trackLoad('/api/build')
    fail('fail', 'HTTP 500')
    const leaf = getLoadSnapshot().leaves.build
    assert.equal(leafPhase(leaf), 'failed')
    assert.equal(leaf.error, 'HTTP 500')
    const retry = trackLoad('/api/build')
    assert.equal(leafPhase(getLoadSnapshot().leaves.build), 'loading')
    retry('ok')
    assert.equal(leafPhase(getLoadSnapshot().leaves.build), 'loaded')
    assert.equal(getLoadSnapshot().leaves.build.error, null)
  })

  it('ignores a second finish', () => {
    const done = trackLoad('/api/market/indices')
    done('ok')
    done('fail', 'late')
    assert.equal(leafPhase(getLoadSnapshot().leaves.indices), 'loaded')
    assert.equal(getLoadSnapshot().leaves.indices.inflight, 0)
  })
})

describe('buildFlow', () => {
  it('covers every leaf once and keeps the desk in stagger order', () => {
    const treeIds = ids(FLOW_ROOT)
    assert.equal(new Set(treeIds).size, treeIds.length)
    for (const id of LEAF_IDS) assert.ok(treeIds.includes(id), id)

    const chart = buildFlow({})
    assert.equal(findFlowBox(chart.root, 'other'), null)
    const order = [
      'watchlist',
      'indices',
      'tickets',
      'brief',
      'reports',
      'movers',
      'wire',
      'analyst',
      'strategist',
      'pulse',
      'sec',
    ]
    let previous = -1
    for (const id of order) {
      const box = must(findFlowBox(chart.root, id), id)
      assert.ok(box.y > previous, `${id} should sit below the previous desk step`)
      previous = box.y
    }
    const gp = must(findFlowBox(chart.root, 'gp'), 'gp')
    const session = must(findFlowBox(chart.root, 'session'), 'session')
    assert.equal(gp.y, session.y)
    assert.ok(gp.x < session.x)
  })

  it('paints the trunk from the calls underneath it', () => {
    trackLoad('/api/auth/v2/me')('ok')
    const loading = trackLoad('/api/watchlist')
    let chart = buildFlow(getLoadSnapshot().leaves)
    assert.equal(must(findFlowBox(chart.root, 'gp'), 'gp').phase, 'loading')
    assert.equal(must(findFlowBox(chart.root, 'desk'), 'desk').phase, 'loading')
    assert.equal(must(findFlowBox(chart.root, 'me'), 'me').phase, 'loaded')
    assert.equal(must(findFlowBox(chart.root, 'financials'), 'financials').phase, 'idle')
    loading('fail', 'aborted')
    chart = buildFlow(getLoadSnapshot().leaves)
    assert.equal(must(findFlowBox(chart.root, 'watchlist'), 'watchlist').phase, 'failed')
    assert.equal(must(findFlowBox(chart.root, 'gp'), 'gp').phase, 'failed')
    assert.deepEqual(must(findFlowBox(chart.root, 'desk'), 'desk').failedLabels, ['Watchlist'])
  })

  it('draws a vertical bus and a stub into each branch', () => {
    const desk = must(findFlowBox(buildFlow({}).root, 'desk'), 'desk')
    const links = flowLinks(desk)
    if (!links) throw new Error('desk has no links')
    assert.match(links.trunk, / V /)
    assert.equal(links.stubs.length, desk.children.length)
    for (const stub of links.stubs) {
      const child = desk.children.find((box) => box.id === stub.id)
      if (!child) throw new Error(stub.id)
      assert.ok(stub.d.endsWith(`H ${child.x}`))
    }
  })

  it('shows Other only after an unmatched call', () => {
    assert.equal(findFlowBox(buildFlow({}).root, 'other'), null)
    trackLoad('/api/not-a-real-route')('fail', 'HTTP 404')
    const other = must(findFlowBox(buildFlow(getLoadSnapshot().leaves).root, 'other'), 'other')
    assert.equal(other.phase, 'failed')
  })
})
