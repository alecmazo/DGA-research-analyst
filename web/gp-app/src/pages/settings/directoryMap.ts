/** Settings → Directories. Update this file when a top-level folder moves or the Mac checkout path changes. */

export const DIRECTORY_UPDATED = '2026-11-19'

export type DirNode = {
  name: string
  note: string
  children?: DirNode[]
}

export const MAC_TREE: DirNode[] = [
  {
    name: '/Users/dplvideo/Desktop/DGA-Research-Analyst',
    note: 'The one folder. Open this.',
    children: [
      {
        name: 'mobile',
        note: 'The phone app.',
      },
      {
        name: 'scripts/ollama_desk.py',
        note: 'The restart helper. Leave this running on port 8766.',
      },
      {
        name: 'web/gp-app',
        note: 'The portal, including this Settings page.',
      },
      {
        name: 'api',
        note: 'The server the live site runs.',
      },
    ],
  },
]

export const REPO_TREE: DirNode[] = [
  {
    name: 'web',
    note: 'What the browser shows.',
    children: [
      { name: 'gp-app', note: 'The GP terminal at /gp. Settings is in here.' },
      { name: 'gp-app/dist', note: 'The built files Railway serves. The deploy commits these.' },
      { name: 'gp', note: 'The older HTML terminal. The React app is the one in use.' },
    ],
  },
  {
    name: 'mobile',
    note: 'The phone app. Installs come from TestFlight.',
  },
  {
    name: 'api',
    note: 'FastAPI. server.py holds the routes and the build id.',
  },
  {
    name: 'scripts',
    note: 'Helpers that run on this Mac. ollama_desk.py is the Ollama restart.',
  },
  {
    name: 'tests',
    note: 'Checks for the desk, the build id, and this map.',
  },
  {
    name: 'credit',
    note: 'Credit research.',
  },
  {
    name: 'merger_arb',
    note: 'Merger arbitrage.',
  },
  {
    name: 'podcast',
    note: 'Show audio and the daily script.',
  },
  {
    name: 'podcast_intel',
    note: 'Captions and the local research notes.',
  },
  {
    name: 'prompts',
    note: 'Model instructions.',
  },
  {
    name: 'stocks',
    note: 'Saved company notes. Generated reports stay out of git.',
  },
  {
    name: 'stock-financials',
    note: 'Filing workbooks.',
  },
  {
    name: 'ideas_cards',
    note: 'Idea card art.',
  },
  {
    name: 'apps',
    note: 'The other products that share this repo.',
    children: [
      { name: 'fund', note: 'Fund books and the schema.' },
      { name: 'sliw-agent', note: 'Edyta’s desk. A push does not deploy it unless that folder changes.' },
      { name: 'research', note: 'Placeholder. Research still lives at the repo root.' },
      { name: 'brief', note: 'Placeholder for the news app.' },
    ],
  },
  {
    name: 'packages',
    note: 'Shared libraries. Mostly reserved for later.',
  },
  {
    name: 'docs',
    note: 'Continuity notes and the handoff.',
  },
  {
    name: 'branding',
    note: 'Logos.',
  },
  {
    name: 'assets',
    note: 'Shared images.',
  },
  {
    name: 'mockups',
    note: 'Design trials. Not the live portal.',
  },
]

export const BRANCH_POINTS = [
  'A branch is a line of commits, not another folder. Open Desktop/DGA-Research-Analyst.',
  'main is the line the live portal runs. Pushing main deploys the site.',
  'A working branch uses that same folder. When the work ships, those commits join main and the extra name goes away.',
  'Folders under .grok/worktrees are agent copies. They are not the folder to open.',
]
