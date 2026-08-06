import { useCallback, useEffect, useState } from 'react'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import styles from '../SettingsPage.module.css'

type HandoffPack = {
  build?: string
  next_build_hint?: string
  git_sha?: string
  git_branch?: string
  git_subject?: string
  generated_at?: string
  paste_markdown?: string
  filename?: string
}

export function HandoffSection() {
  const [pack, setPack] = useState<HandoffPack | null>(null)
  const [status, setStatus] = useState('')
  const [statusOk, setStatusOk] = useState(true)
  const [loading, setLoading] = useState(true)
  const [copyLabel, setCopyLabel] = useState('Copy handoff for agent')

  const load = useCallback(async () => {
    setLoading(true)
    setStatus('')
    try {
      const d = await api<HandoffPack>('/api/continuity/handoff')
      setPack(d)
    } catch (e) {
      setPack(null)
      setStatusOk(false)
      setStatus(`Could not load handoff: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const copy = async () => {
    let text = pack?.paste_markdown || ''
    if (!text) {
      try {
        const d = await api<HandoffPack>('/api/continuity/handoff')
        setPack(d)
        text = d.paste_markdown || ''
      } catch {
        /* use existing */
      }
    }
    if (!text) {
      setStatusOk(false)
      setStatus('Nothing to copy.')
      return
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.cssText = 'position:fixed;left:-9999px;top:0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
      }
      setStatusOk(true)
      setStatus('✓ Copied — paste into Claude / Grok / Cursor on the other machine.')
      setCopyLabel('✓ Copied')
      setTimeout(() => setCopyLabel('Copy handoff for agent'), 2200)
    } catch {
      setStatusOk(false)
      setStatus('Copy failed — use Download .md or expand Preview.')
    }
  }

  const download = async () => {
    let p = pack
    if (!p?.paste_markdown) {
      try {
        p = await api<HandoffPack>('/api/continuity/handoff')
        setPack(p)
      } catch {
        /* fall through */
      }
    }
    const text = p?.paste_markdown || ''
    if (!text) {
      setStatusOk(false)
      setStatus('Nothing to download.')
      return
    }
    const name = p?.filename || 'dga-continuity-handoff.md'
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    setStatusOk(true)
    setStatus(`✓ Downloaded ${name}`)
  }

  const badge = pack?.build || (loading ? '…' : 'ERR')

  return (
    <CollapsibleCard
      title="Continuity handoff"
      badge={badge}
      className={styles.span2}
      defaultOpen
      action={
        <Button size="sm" variant="ghost" onClick={() => void load()} title="Reload pack from live server">
          ↻
        </Button>
      }
    >
      <p className={styles.hint}>
        Switching computers or AI tools (Grok Build ↔ Claude Code ↔ Cursor)? Click{' '}
        <strong>Copy handoff</strong>, then paste into the new agent. It includes the live UI build
        number, next-version rules, nav layout, and <code>CONTINUITY.md</code> so nothing is lost
        and UI numbers never go backwards.
      </p>
      <div className={styles.row} style={{ marginBottom: 10 }}>
        <Button size="sm" variant="primary" onClick={() => void copy()}>
          {copyLabel}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void download()}>
          Download .md
        </Button>
        {status && (
          <span className={statusOk ? styles.statusOk : styles.statusErr}>{status}</span>
        )}
      </div>
      {pack && (
        <div className={styles.meta} style={{ marginBottom: 8 }}>
          <strong>Live build:</strong> {pack.build || '—'} · <strong>Next hint:</strong>{' '}
          {pack.next_build_hint || '—'}
          {pack.git_sha
            ? ` · Git: ${(pack.git_branch || '')}@${pack.git_sha}${
                pack.git_subject ? ` — ${pack.git_subject}` : ''
              }`
            : ''}
          <br />
          <span className={styles.statusMuted}>
            Generated {pack.generated_at || ''} · no secrets included
          </span>
        </div>
      )}
      {!pack && !loading && (
        <div className={styles.statusErr}>Handoff pack unavailable. Try refresh.</div>
      )}
      <details className={styles.previewWrap}>
        <summary>Preview paste text</summary>
        <pre className={styles.pre}>{pack?.paste_markdown || (loading ? 'Loading…' : '')}</pre>
      </details>
    </CollapsibleCard>
  )
}
