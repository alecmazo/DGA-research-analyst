/** Talk to Ollama on this Mac from the browser. The live site cannot see it. */

export const OLLAMA_HOST = 'http://127.0.0.1:11434'
export const LOCAL_MODEL = 'gpt-oss-20b-finance'

const OFFLINE = 'Local model offline – start Ollama'

export type OllamaState = {
  ok: boolean
  message: string
  model: string
}

export type LocalChat = {
  text: string
  tokensPerSec: number | null
  latencyMs: number
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
  let tokensPerSec: number | null = null
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      let ev: {
        message?: { content?: string }
        done?: boolean
        eval_count?: number
        eval_duration?: number
      }
      try {
        ev = JSON.parse(line)
      } catch {
        continue
      }
      const piece = ev.message?.content || ''
      if (piece) {
        text += piece
        opts.onDelta?.(piece)
      }
      if (ev.done && ev.eval_count && ev.eval_duration) {
        tokensPerSec = ev.eval_count / (ev.eval_duration / 1e9)
      }
    }
  }
  return {
    text: text.trim(),
    tokensPerSec,
    latencyMs: Math.round(performance.now() - started),
  }
}
