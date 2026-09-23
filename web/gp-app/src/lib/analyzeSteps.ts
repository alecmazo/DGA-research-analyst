/** One motion for each Analyze step. The graphic swaps when the step id changes. */

export type AnalyzeStepId =
  | 'filings'
  | 'financials'
  | 'market'
  | 'write'
  | 'word'
  | 'deck'
  | 'upload'
  | 'done'

export const ANALYZE_STEP_LABEL: Record<AnalyzeStepId, string> = {
  filings: 'SEC filings',
  financials: 'Financials',
  market: 'Market',
  write: 'Writing',
  word: 'Word',
  deck: 'Slides',
  upload: 'Upload',
  done: 'Ready',
}

export function analyzeStepId(raw?: string | null): AnalyzeStepId | null {
  const s = String(raw || '').toLowerCase()
  if (!s) return null
  if (s.includes('sec') || s.includes('filing')) return 'filings'
  if (s.includes('financial')) return 'financials'
  if (s.includes('market')) return 'market'
  if (s.includes('render') || s.includes('word') || s.includes('docx')) return 'word'
  if (s.includes('gamma') || s.includes('deck') || s.includes('slide')) return 'deck'
  if (s.includes('upload') || s.includes('dropbox') || s.includes('drive')) return 'upload'
  if (s === 'done' || s.includes('complete') || s.includes('ready')) return 'done'
  if (
    s.includes('grok') ||
    s.includes('claude') ||
    s.includes('llm') ||
    s.includes('deepseek') ||
    s.includes('kimi') ||
    s.includes('writ')
  ) {
    return 'write'
  }
  return null
}
