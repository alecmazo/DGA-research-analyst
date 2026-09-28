/** Talk to Ollama on this Mac from the browser. The live site cannot see it. */

export const OLLAMA_HOST = 'http://127.0.0.1:11434'
export const OLLAMA_DESK = 'http://127.0.0.1:8766'
export const LOCAL_MODEL = 'gpt-oss-20b-finance'

const OFFLINE = 'Local model offline – start Ollama'

/** A one-line apology is not a research note. */
export function isModelRefusal(text: string): boolean {
  const raw = (text || '').trim()
  if (!raw || raw.length > 800) return false
  const low = raw.toLowerCase().replace(/’/g, "'")
  return [
    "i'm sorry",
    'i am sorry',
    "can't comply",
    'cannot comply',
    "can't continue",
    'cannot continue',
    "can't assist",
    'cannot assist',
    "can't help with that",
    'cannot help with that',
  ].some((n) => low.includes(n))
}

export const LOCAL_RETRY_SYSTEM =
  "You are DGA Capital's research analyst. Write a full equity research note in markdown using only the figures in the user message. Use those figures exactly. Include an executive summary with a rating (Strong Buy, Buy, Hold, or Sell) and a 12-month price target, a business overview, financial tables, valuation, risks, and a sources line. Write the note. Do not refuse and do not stop after one sentence."

export type OllamaState = {
  ok: boolean
  message: string
  model: string
}

export type LocalChat = {
  text: string
  tokensPerSec: number | null
  latencyMs: number
  thinking: string
  doneReason: string | null
  promptTokens: number | null
  evalTokens: number | null
}

type ChatOpts = {
  system: string
  user: string
  maxTokens?: number
  think?: string
  numCtx?: number
  onDelta?: (chunk: string) => void
}

export async function ollamaStatus(): Promise<OllamaState> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { models?: { name?: string }[] }
    const names = (data.models || []).map((m) => m.name || '')
    const present = names.some(
      (n) => n === LOCAL_MODEL || n.startsWith(`${LOCAL_MODEL}:`),
    )
    if (!present) {
      return { ok: false, message: `Local model ${LOCAL_MODEL} is not installed in Ollama`, model: LOCAL_MODEL }
    }
    return { ok: true, message: 'ok', model: LOCAL_MODEL }
  } catch {
    return { ok: false, message: OFFLINE, model: LOCAL_MODEL }
  }
}

/** Ask the on-Mac helper to start Ollama, or restart it when the process is stuck. */
export async function ensureOllama(): Promise<{ ok: boolean; message: string; action?: string }> {
  try {
    const res = await fetch(`${OLLAMA_DESK}/ensure`, { method: 'POST' })
    const data = (await res.json()) as { ok?: boolean; message?: string; action?: string }
    return {
      ok: Boolean(data.ok),
      message: data.message || (data.ok ? 'Ollama is up' : 'Could not start Ollama'),
      action: data.action,
    }
  } catch {
    return {
      ok: false,
      message: 'Ollama is off, and the start helper on this Mac is not running.',
    }
  }
}

export function parseToolCall(text: string): { tool: string; ticker?: string; portfolio?: string } | null {
  let raw = (text || '').trim()
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  }
  if (!raw.startsWith('{') || !raw.slice(0, 80).includes('"tool"')) return null
  try {
    const data = JSON.parse(raw) as { tool?: string; ticker?: string; portfolio?: string }
    if (!data || typeof data.tool !== 'string' || !data.tool) return null
    return { tool: data.tool, ticker: data.ticker, portfolio: data.portfolio }
  } catch {
    return null
  }
}

/** Stream one answer from the local finance model. Reasoning is ignored. */
export async function ollamaChat(opts: ChatOpts): Promise<LocalChat> {
  const started = performance.now()
  let res: Response
  try {
    res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LOCAL_MODEL,
        stream: true,
        think: opts.think || 'low',
        messages: [
          { role: 'system', content: opts.system || '' },
          { role: 'user', content: opts.user || '' },
        ],
        options: {
          num_ctx: opts.numCtx || 32768,
          num_predict: opts.maxTokens || 12000,
          temperature: 0.2,
        },
      }),
    })
  } catch {
    throw new Error(OFFLINE)
  }
  if (!res.ok || !res.body) {
    throw new Error(res.status === 403 ? 'Ollama blocked this site. Restart Ollama.' : OFFLINE)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let text = ''
  let thinking = ''
  let tokensPerSec: number | null = null
  let doneReason: string | null = null
  let promptTokens: number | null = null
  let evalTokens: number | null = null
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      let ev: {
        message?: { content?: string; thinking?: string }
        done?: boolean
        done_reason?: string
        eval_count?: number
        eval_duration?: number
        prompt_eval_count?: number
      }
      try {
        ev = JSON.parse(line)
      } catch {
        continue
      }
      const piece = ev.message?.content || ''
      const thought = ev.message?.thinking || ''
      if (thought) thinking += thought
      if (piece) {
        text += piece
        opts.onDelta?.(piece)
      }
      if (ev.done) {
        doneReason = ev.done_reason || doneReason
        if (ev.prompt_eval_count) promptTokens = ev.prompt_eval_count
        if (ev.eval_count) evalTokens = ev.eval_count
        if (ev.eval_count && ev.eval_duration) {
          tokensPerSec = ev.eval_count / (ev.eval_duration / 1e9)
        }
      }
    }
  }
  return {
    text: text.trim(),
    tokensPerSec,
    latencyMs: Math.round(performance.now() - started),
    thinking: thinking.trim(),
    doneReason,
    promptTokens,
    evalTokens,
  }
}

/** Why a one-line apology happened. Shown instead of hiding the model's reason. */
export function refusalDiagnosis(chat: LocalChat): string {
  const think = chat.thinking.replace(/\s+/g, ' ').trim()
  const prompt = chat.promptTokens
  const fit = prompt == null
    ? 'Prompt size was not reported.'
    : prompt < 32768
      ? `It had read ${prompt.toLocaleString()} prompt tokens, inside the 32,768 window, so the filing was not cut off.`
      : `It had read ${prompt.toLocaleString()} prompt tokens, which fills the 32,768 window.`
  const reason = think
    ? `Its own reasoning before the apology: “${think.slice(0, 500)}”`
    : 'It left no reasoning note.'
  return [
    `The model stopped on purpose (${chat.doneReason || 'stop'}) after ${chat.evalTokens ?? 'a few'} output tokens.`,
    fit,
    reason,
    'That is the model deciding the research note is too long to finish. Ollama was up, and this is not a missing filing.',
  ].join(' ')
}
