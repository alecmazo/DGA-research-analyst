import { useCallback, useEffect, useState } from 'react'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { Button } from '@/components/ui/Button'
import { api, apiBlob } from '@/lib/api'
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
  instructions?: string
}

function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.cssText = 'position:fixed;left:-9999px;top:0'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  ta.remove()
}

export function HandoffSection() {
  const [pack, setPack] = useState<HandoffPack | null>(null)
  const [status, setStatus] = useState('')
  const [statusOk, setStatusOk] = useState(true)
  const [loading, setLoading] = useState(true)
  const [copyLabel, setCopyLabel] = useState('Copy briefing for next agent')
  const [dlBusy, setDlBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setStatus('')
    try {
      const d = await api<HandoffPack>('/api/continuity/handoff')
      setPack(d)
    } catch (e) {
      setPack(null)
      setStatusOk(false)
      setStatus(`Could not load briefing: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const briefing = async (): Promise<string> => {
    let text = pack?.paste_markdown || ''
    if (text) return text
    const d = await api<HandoffPack>('/api/continuity/handoff')
    setPack(d)
    return d.paste_markdown || ''
  }

  const copy = async () => {
    try {
      const text = await briefing()
      if (!text) {
        setStatusOk(false)
        setStatus('Nothing to copy.')
        return
      }
      await copyText(text)
      setStatusOk(true)
      setStatus(
        '✓ Copied. Paste this into the new Grok / Claude / Cursor chat — that agent will clone GitHub and read the docs plus the support fix trail. You do not need to open Terminal.',
      )
      setCopyLabel('✓ Copied briefing')
      setTimeout(() => setCopyLabel('Copy briefing for next agent'), 2800)
    } catch {
      setStatusOk(false)
      setStatus('Copy failed — try again, or Download package if you need a file copy of the briefing.')
    }
  }

  const downloadPackage = async () => {
    setDlBusy(true)
    try {
      const blob = await apiBlob('/api/continuity/package')
      const day = (pack?.generated_at || new Date().toISOString()).slice(0, 10)
      downloadBlob(blob, `dga-continuity-package-${day}.zip`)
      setStatusOk(true)
      setStatus(
        '✓ Downloaded the records zip (briefing + product log + version log). For a new agent, paste the copied briefing instead — GitHub has the live docs.',
      )
    } catch (e) {
      setStatusOk(false)
      setStatus(`Download failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setDlBusy(false)
    }
  }

  const badge = pack?.build || (loading ? '…' : 'ERR')

  return (
    <CollapsibleCard
      title="Continuity handoff"
      badge={badge}
      className={styles.span2}
      defaultOpen
      action={
        <Button size="sm" variant="ghost" onClick={() => void load()} title="Reload live briefing">
          ↻
        </Button>
      }
    >
      <p className={styles.hint}>
        Your only handoff step is <strong>Copy briefing for next agent</strong> →
        paste into the new chat. That agent clones GitHub, reads the live docs
        in the repo, and reviews the support fix trail. Do not open Terminal.
      </p>

      <ol className={styles.steps}>
        <li>
          Click <strong>Copy briefing for next agent</strong>.
        </li>
        <li>
          Paste it as the first message in the new Grok Build / Claude Code /
          Cursor chat.
        </li>
        <li>
          Stop. That agent clones{' '}
          <code>https://github.com/alecmazo/DGA-research-analyst</code> (or
          pulls <code>main</code>). If GitHub is locked, it will ask you to log
          in — then it continues. You do not clone.
        </li>
      </ol>

      <div className={styles.row} style={{ marginBottom: 10 }}>
        <Button size="sm" variant="primary" onClick={() => void copy()}>
          {copyLabel}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={dlBusy}
          title="Optional records zip — not required to start a new agent"
          onClick={() => void downloadPackage()}
        >
          {dlBusy ? 'Downloading…' : 'Download package'}
        </Button>
        {status && (
          <span className={statusOk ? styles.statusOk : styles.statusErr}>{status}</span>
        )}
      </div>
      <p className={styles.help}>
        <strong>Download package</strong> is optional. It saves a dated zip of
        the briefing + product log + version log for your records, or if you
        need a file copy of the briefing because clipboard is not available.
        It is <em>not</em> how a new agent or computer catches up — GitHub
        already has those docs, and they stay current there. Prefer copy/paste.
      </p>

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
            Generated {pack.generated_at || ''} · no secrets ·{' '}
            {pack.instructions ||
              'Briefing is short on purpose; product log is the long file.'}
          </span>
        </div>
      )}
      {!pack && !loading && (
        <div className={styles.statusErr}>Briefing unavailable. Try refresh.</div>
      )}
      <details className={styles.previewWrap}>
        <summary>Preview briefing (this is what you paste — the agent gets the repo)</summary>
        <pre className={styles.pre}>{pack?.paste_markdown || (loading ? 'Loading…' : '')}</pre>
      </details>
    </CollapsibleCard>
  )
}
