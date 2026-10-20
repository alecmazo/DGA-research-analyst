import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import {
  LOCAL_MODEL,
  LOCAL_MODEL_CHOICES,
  modelPicks,
  shortModelLabel,
  storeModelPicks,
} from '@/lib/localOllama'
import styles from './LocalModelPick.module.css'

let catalogOnce: Promise<string[]> | null = null

function localModelChoices(): Promise<string[]> {
  if (!catalogOnce) {
    catalogOnce = api<{ models?: string[] }>('/api/llm/models')
      .then((data) => {
        const list = (data.models || []).map((m) => m.trim()).filter(Boolean)
        return list.length ? list : LOCAL_MODEL_CHOICES
      })
      .catch(() => LOCAL_MODEL_CHOICES)
  }
  return catalogOnce
}

export function useLocalModelChoice(storageKey: string, multiple = false) {
  const [choices, setChoices] = useState<string[]>([])
  const [picked, setPicked] = useState<string[]>([])

  useEffect(() => {
    let alive = true
    void localModelChoices().then((list) => {
      if (!alive) return
      setChoices(list)
      setPicked(modelPicks(storageKey, list, multiple))
    })
    return () => {
      alive = false
    }
  }, [storageKey, multiple])

  const update = (next: string[]) => {
    const safe = next.length ? next : picked.length ? picked : [LOCAL_MODEL]
    setPicked(safe)
    storeModelPicks(storageKey, safe)
  }

  const toggle = (name: string) => {
    if (!multiple) {
      update([name])
      return
    }
    if (picked.includes(name)) {
      if (picked.length === 1) return
      update(picked.filter((m) => m !== name))
      return
    }
    update([...picked, name])
  }

  const ordered = choices.filter((m) => picked.includes(m))
  return {
    choices,
    picked: ordered.length ? ordered : picked,
    toggle,
  }
}

/** Advice for the Ask card. Grounded in the 19 Oct 2026 local-model check. */
const ASK_GUIDE: { match: string; label: string; use: string }[] = [
  {
    match: 'gpt-oss',
    label: 'GPT-oss',
    use: 'A term, or one figure from a filing. It was the best of the three at reading 8-K deal fields.',
  },
  {
    match: '26b',
    label: 'Gemma 26b',
    use: 'A longer answer: narrative, how a thesis fits, DCF drivers, or a portfolio review in prose.',
  },
  {
    match: '12b',
    label: 'Gemma 12b',
    use: 'A fast first pass: what changed, a short summary, one holding. It starts sooner than 26b.',
  },
]

const ASK_TASKS: { task: string; pick: string }[] = [
  { task: 'Narrative', pick: 'Gemma 26b. Gemma 12b if you want the shorter, faster read.' },
  { task: 'DCF', pick: 'Gemma 26b for the drivers and the story of the model. Do the multiplication yourself. On 19 Oct 2026 all three failed almost every spread calculation.' },
  { task: 'Reasoning', pick: 'Gemma 26b. It is the one with room to hold a longer argument.' },
  { task: 'Portfolio review', pick: 'Gemma 26b for the write-up. Gemma 12b for a quick pass on one name. The Portfolio card on this page already has the holdings in the prompt.' },
  { task: 'A term or a single figure', pick: 'GPT-oss.' },
]

function askUse(model: string): string {
  const m = model.toLowerCase()
  return ASK_GUIDE.find((row) => m.includes(row.match))?.use || 'No note for this model yet.'
}

type Props = {
  choices: string[]
  picked: string[]
  onToggle: (name: string) => void
  multiple?: boolean
  disabled?: boolean
  label?: string
  compact?: boolean
  /** Ask card only. One line for the selected model, plus a guide by question type. */
  guide?: boolean
}

export function LocalModelPick({
  choices,
  picked,
  onToggle,
  multiple = false,
  disabled = false,
  label = 'Model',
  compact = false,
  guide = false,
}: Props) {
  if (!choices.length) return null
  const current = picked[0] || choices[0]
  if (!multiple) {
    const select = (
      <label className={`${styles.single} ${compact ? styles.compact : ''}`}>
        {compact ? null : <span>{label}</span>}
        <select
          aria-label={label}
          value={choices.includes(current) ? current : choices[0]}
          disabled={disabled}
          onChange={(e) => onToggle(e.target.value)}
        >
          {choices.map((m) => (
            <option key={m} value={m}>
              {shortModelLabel(m)}
            </option>
          ))}
        </select>
      </label>
    )
    if (!guide) return select
    return (
      <div className={styles.wrap}>
        {select}
        <p className={styles.guideNow}>{askUse(current)}</p>
        <details className={styles.guide}>
          <summary>Which model for this question</summary>
          <ul>
            {ASK_TASKS.map((row) => (
              <li key={row.task}>
                <strong>{row.task}.</strong> {row.pick}
              </li>
            ))}
          </ul>
        </details>
      </div>
    )
  }
  return (
    <div className={styles.wrap}>
      <span className={styles.lbl}>{label}</span>
      <div className={styles.chips} role="group" aria-label={label}>
        {choices.map((m) => {
          const on = picked.includes(m)
          return (
            <button
              key={m}
              type="button"
              className={`${styles.chip} ${on ? styles.chipOn : ''}`}
              aria-pressed={on}
              title={m}
              disabled={disabled}
              onClick={() => onToggle(m)}
            >
              {shortModelLabel(m)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
