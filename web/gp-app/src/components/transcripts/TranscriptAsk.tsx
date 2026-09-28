import { useState } from 'react'
import { api } from '@/lib/api'
import { ollamaChat, ollamaStatus, LOCAL_MODEL } from '@/lib/localOllama'
import { renderMd } from '@/lib/md'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import styles from './TranscriptAsk.module.css'

type EngineId = 'local' | 'grok' | 'claude' | 'deepseek'

const ENGINES: { id: EngineId; label: string; via: string }[] = [
  {
    id: 'local',
    label: `Local · ${LOCAL_MODEL}`,
    via: `This Mac · Ollama · ${LOCAL_MODEL} · not an API call`,
  },
  { id: 'grok', label: 'Grok · grok-4.7', via: 'xAI API · grok-4.7' },
  { id: 'claude', label: 'Claude', via: 'Anthropic API' },
  { id: 'deepseek', label: 'DeepSeek', via: 'DeepSeek API' },
]

export function TranscriptAsk() {
  const [engine, setEngine] = useState<EngineId>('local')
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [used, setUsed] = useState('')

  const chosen = ENGINES.find((row) => row.id === engine) || ENGINES[0]

  const ask = async () => {
    const q = question.trim()
    if (q.length < 4) return
    setBusy(true)
    setErr(null)
    setAnswer('')
    try {
      if (engine === 'local') {
        const health = await ollamaStatus()
        if (!health.ok) throw new Error(health.message)
        const pack = await api<{ system?: string; user?: string }>(
          '/api/transcripts/ask-context',
          { method: 'POST', body: JSON.stringify({ question: q }) },
        )
        if (!pack.system || !pack.user) throw new Error('Could not load transcript excerpts')
        const chat = await ollamaChat({ system: pack.system, user: pack.user, maxTokens: 2500 })
        if (!chat.text) throw new Error('The local model returned an empty answer')
        setAnswer(chat.text)
        setUsed(chosen.via)
      } else {
        const data = await api<{ answer?: string; via?: string; model?: string; detail?: string }>(
          '/api/transcripts/ask',
          { method: 'POST', body: JSON.stringify({ question: q, provider: engine }) },
        )
        if (!data.answer) throw new Error(data.detail || 'No answer')
        setAnswer(data.answer)
        setUsed(data.model ? `${chosen.via} · ${data.model}` : chosen.via)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not answer')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Ask a question" badge={chosen.via}>
      <p className={styles.via}>Using {chosen.via}.</p>
      <div className={styles.row}>
        <label className={styles.lbl}>
          Engine
          <select
            value={engine}
            onChange={(e) => setEngine(e.target.value as EngineId)}
            disabled={busy}
            aria-label="Which engine answers"
          >
            {ENGINES.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={3}
        placeholder="What did BSX say about 2026 guidance?"
        disabled={busy}
        aria-label="Question"
      />
      <div className={styles.row}>
        <Button variant="primary" size="sm" disabled={busy || question.trim().length < 4} onClick={() => void ask()}>
          {busy ? 'Answering…' : 'Ask'}
        </Button>
      </div>
      {err && <p className={styles.err}>{err}</p>}
      {used && answer && <p className={styles.used}>Answered with {used}.</p>}
      {answer && (
        <div className={styles.answer} dangerouslySetInnerHTML={{ __html: renderMd(answer) }} />
      )}
    </Panel>
  )
}
