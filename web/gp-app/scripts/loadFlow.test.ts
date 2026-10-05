import assert from 'node:assert/strict'
import fs from 'node:fs'
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
    assert.equal(matchLeaf('/api/credit/issuers'), 'credit')
    assert.equal(matchLeaf('/api/credit/issuers/0001/compute'), 'credit')
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
    let previousY = -1
    let previousX = -1
    for (const id of order) {
      const box = must(findFlowBox(chart.root, id), id)
      if (box.y === previousY) {
        assert.ok(box.x > previousX, `${id} should sit to the right of the previous desk step`)
      } else {
        assert.ok(box.y > previousY, `${id} should sit below the previous desk row`)
      }
      previousY = box.y
      previousX = box.x
    }
    const gp = must(findFlowBox(chart.root, 'gp'), 'gp')
    const session = must(findFlowBox(chart.root, 'session'), 'session')
    const podcasts = must(findFlowBox(chart.root, 'podcasts'), 'podcasts')
    const gurus = must(findFlowBox(chart.root, 'gurus'), 'gurus')
    const lab = must(findFlowBox(chart.root, 'lab'), 'lab')
    const credit = must(findFlowBox(chart.root, 'credit'), 'credit')
    const settings = must(findFlowBox(chart.root, 'settings'), 'settings')
    assert.ok(session.y > gp.y + gp.h)
    assert.ok(podcasts.y > gurus.y)
    assert.ok(Math.abs(podcasts.x + podcasts.w / 2 - (gp.x + gp.w / 2)) < 1)
    assert.ok(lab.children.some((kid) => kid.id === 'credit'))
    assert.ok(credit.y > lab.y)
    assert.ok(settings.y + settings.h < 1300, `settings is still below the card at y=${settings.y}`)
    assert.ok(chart.height < 1400, `chart is ${chart.width}×${chart.height}`)
    const kids = gp.children
    const left = Math.min(...kids.map((kid) => kid.x))
    const right = Math.max(...kids.map((kid) => kid.x + kid.w))
    const mid = (left + right) / 2
    assert.ok(Math.abs(gp.x + gp.w / 2 - mid) < 1)
    assert.ok(kids.every((kid) => kid.y >= gp.y + gp.h))
    assert.ok(chart.height > chart.width)
  })

  it('includes every page in the work, lab, and accounts menus', () => {
    const topbar = fs.readFileSync(
      new URL('../src/components/layout/Topbar.tsx', import.meta.url),
      'utf8',
    )
    const tos = [
      ...topbar.matchAll(/to:\s*'(\/[^']*)'/g),
      ...topbar.matchAll(/to="(\/[^"]*)"/g),
    ].map((match) => match[1])
    assert.ok(tos.includes('/credit'))
    const dest = new Set<string>()
    const walk = (node: FlowNode) => {
      if (node.to) dest.add(node.to)
      node.children?.forEach(walk)
    }
    walk(FLOW_ROOT)
    for (const to of tos) {
      if (to === '/') {
        assert.ok(ids(FLOW_ROOT).includes('desk'))
        continue
      }
      assert.ok(dest.has(to), to)
    }
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

  it('draws downward from the center into each branch', () => {
    const chart = buildFlow({})
    const desk = must(findFlowBox(chart.root, 'desk'), 'desk')
    const links = flowLinks(desk)
    if (!links) throw new Error('desk has no links')
    assert.match(links.trunk, / V /)
    assert.equal(links.stubs.length, desk.children.length)
    for (const stub of links.stubs) {
      const child = desk.children.find((box) => box.id === stub.id)
      if (!child) throw new Error(stub.id)
      assert.ok(child.y > desk.y)
      assert.ok(stub.d.endsWith(`V ${child.y}`), stub.d)
      assert.equal(stub.d.includes(`H ${child.x}`), false, stub.d)
    }
    const financials = must(findFlowBox(chart.root, 'financials'), 'financials')
    const row = flowLinks(financials)
    if (!row) throw new Error('financials has no links')
    assert.match(row.trunk, / V /)
    for (const stub of row.stubs) {
      const child = financials.children.find((box) => box.id === stub.id)
      if (!child) throw new Error(stub.id)
      assert.ok(stub.d.endsWith(`V ${child.y}`))
    }
    const boxes: FlowBox[] = []
    const walk = (box: FlowBox) => {
      boxes.push(box)
      box.children.forEach(walk)
    }
    walk(chart.root)
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const overlap =
          a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
        assert.equal(overlap, false, `${a.id} overlaps ${b.id}`)
      }
    }
  })

  it('shows Other only after an unmatched call', () => {
    assert.equal(findFlowBox(buildFlow({}).root, 'other'), null)
    trackLoad('/api/not-a-real-route')('fail', 'HTTP 404')
    const other = must(findFlowBox(buildFlow(getLoadSnapshot().leaves).root, 'other'), 'other')
    assert.equal(other.phase, 'failed')
  })
})
