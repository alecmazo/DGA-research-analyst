/** Folders on main that this desk actually calls.

Labels are the directory names. A branch moves only while a call is in
that folder. apps, assets, docs, mobile, mockups, packages, and tests are
on main and are not on this page's calls.
*/

import {
  leafPhase,
  normalizeLoadPath,
  rollupPhase,
  type FlowBox,
  type FlowNode,
  type LeafSnap,
  type Phase,
} from './loadFlow'

const NODE_W = 156
const NODE_H = 26
const GAP_X = 28
const GAP_Y = 8
const PAD = 16

/** id → path from the repo root. The label is the last segment. */
export const FOLDER_DIRS: Record<string, string> = {
  web: 'web',
  'gp-app': 'web/gp-app',
  api: 'api',
  domains: 'api/domains',
  credit: 'credit',
  merger_arb: 'merger_arb',
  scanner: 'merger_arb/scanner',
  data: 'api/data',
  podcast_intel: 'podcast_intel',
  podcast: 'podcast',
  stocks: 'stocks',
  'stock-financials': 'stock-financials',
  prompts: 'prompts',
  branding: 'branding',
  scripts: 'scripts',
}

export const REPO_ROOT: FlowNode = {
  id: 'web',
  label: 'web',
  hint: 'This site. The desk is web/gp-app.',
  children: [
    {
      id: 'gp-app',
      label: 'gp-app',
      hint: 'web/gp-app. React desk. Every call on this page starts here.',
      children: [
        {
          id: 'api',
          label: 'api',
          hint: 'FastAPI. api/server.py receives the HTTP call.',
          children: [
            {
              id: 'domains',
              label: 'domains',
              hint: 'api/domains. Credit, merger arb, financials, gurus, support, local, and planning.',
              children: [
                {
                  id: 'credit',
                  label: 'credit',
                  hint: 'credit/. domains/credit_analysis.py imports it.',
                  to: '/credit',
                },
                {
                  id: 'merger_arb',
                  label: 'merger_arb',
                  hint: 'merger_arb/. domains/merger_arb_analysis.py imports the deal math.',
                  to: '/merger-arb',
                  children: [
                    {
                      id: 'scanner',
                      label: 'scanner',
                      hint: 'merger_arb/scanner. Scan, candidates, and alerts.',
                      to: '/merger-arb',
                    },
                  ],
                },
                {
                  id: 'data',
                  label: 'data',
                  hint: 'api/data. GuruFocus lists, read by domains/gurufocus_watchlists.py.',
                  to: '/builder',
                },
              ],
            },
            {
              id: 'podcast_intel',
              label: 'podcast_intel',
              hint: 'Calls and shows. api/server.py imports podcast_intel/.',
              to: '/transcripts',
            },
            {
              id: 'podcast',
              label: 'podcast',
              hint: 'podcast/stings. Read when a podcast route builds or plays audio.',
              to: '/podcasts',
            },
            {
              id: 'stocks',
              label: 'stocks',
              hint: 'Saved notes and job files.',
              widget: 'reports',
            },
            {
              id: 'stock-financials',
              label: 'stock-financials',
              hint: 'SEC workbooks. The financials sync writes stock-financials/.',
              to: '/financials',
            },
            {
              id: 'prompts',
              label: 'prompts',
              hint: 'prompts/munger_core_context.md. Read when analyze runs.',
              to: '/munger',
            },
            {
              id: 'branding',
              label: 'branding',
              hint: 'Logos. Served from branding/.',
            },
          ],
        },
        {
          id: 'scripts',
          label: 'scripts',
          hint: 'scripts/ollama_desk.py on this Mac, port 8766. Captions read podcast_intel.',
          to: '/local',
        },
      ],
    },
  ],
}

const DESK = ['web', 'gp-app']
const API = ['web', 'gp-app', 'api']

function isScanner(path: string): boolean {
  return (
    path.startsWith('/api/merger-arb/scan') ||
    path.startsWith('/api/merger-arb/candidates') ||
    path.startsWith('/api/merger-arb/alerts')
  )
}

function isPodcastAsset(path: string): boolean {
  return (
    path.startsWith('/api/podcast/') &&
    (path.includes('/generate') || path.includes('/audio') || path.includes('/voice-sample'))
  )
}

function isNotePath(path: string): boolean {
  return (
    path.startsWith('/api/reports') ||
    path.startsWith('/api/report/') ||
    path === '/api/report' ||
    path.startsWith('/api/analyze') ||
    path.startsWith('/api/research') ||
    path.startsWith('/api/jobs') ||
    path.startsWith('/api/download/')
  )
}

/** Folders a single call enters, from the page out to the package. */
export function folderIds(path: string): string[] {
  const p = normalizeLoadPath(path)
  if (p.startsWith('ollama://captions')) return [...DESK, 'scripts']
  if (p.startsWith('ollama://ensure')) return [...DESK, 'scripts']
  if (p.startsWith('ollama://')) return [...DESK]
  if (p.startsWith('/branding/')) return [...API, 'branding']
  if (!p.startsWith('/api/')) return [...DESK]

  const ids = [...API]
  if (p.startsWith('/api/credit')) ids.push('domains', 'credit')
  else if (isScanner(p)) ids.push('domains', 'merger_arb', 'scanner')
  else if (p.startsWith('/api/merger-arb')) ids.push('domains', 'merger_arb')
  else if (p.startsWith('/api/financials/sync')) ids.push('domains', 'stock-financials')
  else if (p.startsWith('/api/financials')) ids.push('domains')
  else if (p.startsWith('/api/gurus')) ids.push('domains')
  else if (p.startsWith('/api/support')) ids.push('domains')
  else if (p.startsWith('/api/local')) ids.push('domains')
  else if (p.startsWith('/api/grok-bot')) ids.push('domains')
  else if (p.startsWith('/api/v2/gp/lp-planning') || p.startsWith('/api/v2/lp/planning')) ids.push('domains')
  else if (p.startsWith('/api/v2/builder/gurufocus')) ids.push('domains', 'data')
  else if (p.startsWith('/api/transcripts')) ids.push('podcast_intel')
  else if (isPodcastAsset(p)) ids.push('podcast')

  if (isNotePath(p)) ids.push('stocks')
  if (p.startsWith('/api/analyze') || p.startsWith('/api/research')) ids.push('prompts')
  return ids
}

function subtreeHeight(node: FlowNode): number {
  const kids = node.children || []
  if (!kids.length) return NODE_H
  const inner = kids.reduce((sum, kid) => sum + subtreeHeight(kid), 0)
  return Math.max(NODE_H, inner + GAP_Y * (kids.length - 1))
}

function place(node: FlowNode, hits: Map<string, LeafSnap[]>, depth: number, top: number): FlowBox {
  const children: FlowBox[] = []
  let cursor = top
  for (const kid of node.children || []) {
    children.push(place(kid, hits, depth + 1, cursor))
    cursor += subtreeHeight(kid) + GAP_Y
  }
  const own = hits.get(node.id) || []
  const ownPhases = own.map((leaf) => leafPhase(leaf))
  const phase = rollupPhase([...ownPhases, ...children.map((child) => child.phase)])
  const leaf = own.find((row) => row.inflight > 0) || own[own.length - 1] || null
  return {
    id: node.id,
    label: node.label,
    hint: node.hint,
    step: node.step,
    widget: node.widget,
    to: node.to,
    phase,
    refreshing: own.some((row) => row.inflight > 0 && leafPhase(row) === 'loaded'),
    leaf,
    failedLabels: [
      ...(ownPhases.includes('failed') ? [node.label] : []),
      ...children.flatMap((child) => child.failedLabels),
    ],
    x: PAD + depth * (NODE_W + GAP_X),
    y: top,
    w: NODE_W,
    h: NODE_H,
    children,
  }
}

function bounds(root: FlowBox): { width: number; height: number } {
  let maxX = 0
  let maxY = 0
  const walk = (box: FlowBox) => {
    maxX = Math.max(maxX, box.x + box.w)
    maxY = Math.max(maxY, box.y + box.h)
    box.children.forEach(walk)
  }
  walk(root)
  return { width: maxX + PAD, height: maxY + PAD }
}

export function buildRepoFlow(leaves: Record<string, LeafSnap> = {}): {
  root: FlowBox
  width: number
  height: number
} {
  const hits = new Map<string, LeafSnap[]>()
  for (const leaf of Object.values(leaves)) {
    if (!leaf || leafPhase(leaf) === 'idle') continue
    for (const id of folderIds(leaf.path || '')) {
      const list = hits.get(id)
      if (list) list.push(leaf)
      else hits.set(id, [leaf])
    }
  }
  const root = place(REPO_ROOT, hits, 0, PAD)
  return { root, ...bounds(root) }
}

/** Elbows between a folder and the folders it calls. */
export function repoLinks(box: FlowBox): { trunk: string; stubs: { id: string; d: string }[] } | null {
  const kids = box.children
  if (!kids.length) return null
  const x1 = box.x + box.w
  const y1 = box.y + box.h / 2
  const mid = x1 + GAP_X / 2
  if (kids.length === 1) {
    const kid = kids[0]
    const y2 = kid.y + kid.h / 2
    return {
      trunk: '',
      stubs: [{ id: kid.id, d: `M ${x1} ${y1} H ${mid} V ${y2} H ${kid.x}` }],
    }
  }
  const yTop = kids[0].y + kids[0].h / 2
  const yBot = kids[kids.length - 1].y + kids[kids.length - 1].h / 2
  return {
    trunk: `M ${x1} ${y1} H ${mid} M ${mid} ${yTop} V ${yBot}`,
    stubs: kids.map((kid) => {
      const y2 = kid.y + kid.h / 2
      return { id: kid.id, d: `M ${mid} ${y2} H ${kid.x}` }
    }),
  }
}

export function countFolderPhases(root: FlowBox): Record<Phase, number> {
  const counts: Record<Phase, number> = { idle: 0, loading: 0, loaded: 0, failed: 0 }
  const walk = (box: FlowBox) => {
    counts[box.phase] += 1
    box.children.forEach(walk)
  }
  walk(root)
  return counts
}
