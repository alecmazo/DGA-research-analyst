export type PodcastFormat =
  | 'debate'
  | 'pre_mortem'
  | 'memo'
  | 'catalysts'
  | 'quick_hit'
  | 'roundup'
  | 'portfolio_roundup'

export const FORMAT_OPTIONS: { value: PodcastFormat; label: string }[] = [
  { value: 'debate', label: '⚔️ Debate (Bull vs Bear)' },
  { value: 'pre_mortem', label: '🪦 Pre-Mortem (it failed — why?)' },
  { value: 'memo', label: '📋 Investment Memo' },
  { value: 'catalysts', label: '📅 Catalysts Calendar' },
  { value: 'quick_hit', label: '⚡ Quick Hit (5 min)' },
  { value: 'roundup', label: '📰 Roundup (2-4 tickers)' },
  { value: 'portfolio_roundup', label: '🧰 Portfolio Roundup (5-35 tickers)' },
]

export type SavedReportRow = {
  ticker: string
  generated_at?: string | null
  claude_generated_at?: string | null
  rating?: string | null
  upside_pct?: number | null
}

export type PodcastScriptMeta = {
  ticker: string
  format?: string
  title?: string
  generated_at?: string
  winner?: string
  has_audio?: boolean
  script_cost_usd?: number | null
  audio_cost_usd?: number | null
  mode?: string
}

export type PodcastEpisode = {
  ticker: string
  title?: string
  format?: string
  duration_sec?: number
  generated_at?: string
  cost_usd?: number
  audio_url?: string
  dropbox_path?: string
}

export type ScriptTurn = {
  speaker?: string
  text?: string
  intensity?: string
}

export type ScriptSection = {
  id?: string
  turns?: ScriptTurn[]
}

export type PodcastScript = {
  ticker?: string
  tickers?: string[]
  format?: string
  episode_title?: string
  winner?: string
  generated_at?: string
  sections?: ScriptSection[]
  _alignment?: {
    episode_mode?: string
    bull_speaker?: string
    bear_speaker?: string
  }
}

export type ScriptPayload = {
  ok?: boolean
  script?: PodcastScript
  validation?: { stats?: Record<string, unknown>; warnings?: string[] }
  generated_at?: string
  script_cost_usd?: number | null
  audio_cost_usd?: number | null
  da_brief?: string
  alignment?: { roles?: Record<string, string> }
  error?: string
}

export type ScriptStatus = {
  status?: string
  stage?: string
  label?: string
  error?: string
  result?: ScriptPayload
}

export type AudioStatus = {
  status?: string
  stage?: string
  label?: string
  current?: number
  total?: number
  duration_sec?: number
  cost_usd?: number
  dropbox_path?: string
  title?: string
  generated_at?: string
  format?: string
}

export type VoiceConfig = {
  voices?: Record<string, string>
  available?: string[]
}

export type SpeedConfig = {
  speeds?: Record<string, Record<string, number>>
  intensities?: string[]
  speakers?: string[]
}

export type LabEngine = {
  has_report?: boolean
  configured?: boolean
  model?: string
  generated_at?: string
  text?: string
  provider?: string
  summary?: {
    rating?: string
    price_target?: number | null
    upside_pct?: number | null
  }
}

export type LabComparison = {
  ticker?: string
  engines?: Record<string, LabEngine>
  show?: string[]
  grok?: LabEngine
  alt?: LabEngine
}

export type LabStats = {
  total?: number
  grok_wins?: number
  claude_wins?: number
  ties?: number
  grok_win_pct?: number
  claude_win_pct?: number
  tie_pct?: number
  avg_target_delta_pct?: number | null
  target_delta_sign?: string
}

export type LabVote = {
  ticker?: string
  winner?: string
  note?: string
  voted_at?: string
}

export const SCRIPT_STAGE_PCT: Record<string, number> = {
  queued: 4,
  load: 10,
  classify: 20,
  da_research: 45,
  da_synth: 65,
  macro_pull: 30,
  bolton_screen: 50,
  script_gen: 80,
  persist: 95,
  done: 100,
  error: 0,
}

export function fmtWhen(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  let ago = ''
  if (mins < 60) ago = `${mins}m ago`
  else if (mins < 1440) ago = `${Math.round(mins / 60)}h ago`
  else ago = `${Math.round(mins / 1440)}d ago`
  const mo = d.toLocaleString('en-US', { month: 'short' })
  const day = d.getDate()
  const yr = d.getFullYear()
  const abs =
    yr === new Date().getFullYear()
      ? `${mo} ${day}`
      : `${mo} ${day} '${String(yr).slice(-2)}`
  return `${abs} · ${ago}`
}

export function displayTicker(tk: string, title?: string): string {
  if (tk.startsWith('ROUNDUP_')) {
    return '📰 ' + tk.replace('ROUNDUP_', '').split(',').join('·')
  }
  if (/^PORTFOLIO_\d+TICKERS_\d+$/i.test(tk)) {
    return title && !/^PORTFOLIO_\d+TICKERS_\d+$/i.test(title)
      ? title
      : 'Portfolio Roundup'
  }
  return tk
}
