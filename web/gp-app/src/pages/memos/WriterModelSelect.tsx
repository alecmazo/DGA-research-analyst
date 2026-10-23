import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import {
  LOCAL_MODEL_CHOICES,
  ollamaReachable,
  shortModelLabel,
} from '@/lib/localOllama'
import styles from '../MemosPage.module.css'

const KEY = 'dga.memo.writer.model'

const CLOUD = [
  { id: 'grok', label: 'Grok' },
  { id: 'claude', label: 'Claude' },
  { id: 'deepseek', label: 'DeepSeek' },
]

export type WriterOption = { id: string; label: string }

export function writerPayload(model: string): { llm_provider: string; local_model?: string } | null {
  if (!model) return null
  if (model.startsWith('local:')) {
    const local_model = model.slice('local:'.length)
    if (!local_model) return null
    return { llm_provider: 'local', local_model }
  }
  return { llm_provider: model }
}

export function useWriterModel() {
  const [model, setModelState] = useState(() => {
    try {
      return localStorage.getItem(KEY) || ''
    } catch {
      return ''
    }
  })
  const [localModels, setLocalModels] = useState<string[]>([])
  const [localOk, setLocalOk] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      const ok = await ollamaReachable()
      if (!alive) return
      setLocalOk(ok)
      if (!ok) {
        setModelState((cur) => (cur.startsWith('local:') ? '' : cur))
        return
      }
      try {
        const data = await api<{ models?: string[] }>('/api/llm/models')
        const list = (data.models || []).map((m) => m.trim()).filter(Boolean)
        if (alive) setLocalModels(list.length ? list : [...LOCAL_MODEL_CHOICES])
      } catch {
        if (alive) setLocalModels([...LOCAL_MODEL_CHOICES])
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!localOk || !localModels.length) return
    setModelState((cur) => {
      if (cur.startsWith('local:') && !localModels.some((m) => cur === `local:${m}`)) return ''
      return cur
    })
  }, [localOk, localModels])

  const setModel = (value: string) => {
    setModelState(value)
    try {
      localStorage.setItem(KEY, value)
    } catch {
      /* ignore */
    }
  }

  const options: WriterOption[] = [
    ...CLOUD,
    ...(localOk
      ? localModels.map((m) => ({
          id: `local:${m}`,
          label: `On this Mac · ${shortModelLabel(m)}`,
        }))
      : []),
  ]
  const label = options.find((row) => row.id === model)?.label || ''
  return { model, setModel, options, label, localOk }
}

export function WriterModelSelect({
  model,
  options,
  onChange,
  disabled,
}: {
  model: string
  options: WriterOption[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <label className={styles.modelPick}>
      <span className={styles.modelLbl}>Model</span>
      <select
        className={styles.select}
        aria-label="Model"
        value={options.some((row) => row.id === model) ? model : ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose a model</option>
        {options.map((row) => (
          <option key={row.id} value={row.id}>
            {row.label}
          </option>
        ))}
      </select>
    </label>
  )
}
