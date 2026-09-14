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
  instructions?: string
}

type MdFile = { markdown?: string; filename?: string }

function downloadText(text: string, name: string) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
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
  const [copyLabel, setCopyLabel] = useState('1. Copy briefing for next agent')

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
        '✓ Copied the short briefing. Paste it into the new Grok / Claude / Cursor chat, then have that agent open docs/continuity/PRODUCT_LOG.md and CONTINUITY.md after git pull.',
      )
      setCopyLabel('✓ Copied briefing')
      setTimeout(() => setCopyLabel('1. Copy briefing for next agent'), 2800)
    } catch {
      setStatusOk(false)
      setStatus('Copy failed — use Download briefing instead.')
    }
  }

  const downloadBriefing = async () => {
    try {
      const text = await briefing()
      if (!text) {
        setStatusOk(false)
        setStatus('Nothing to download.')
        return
      }
      const name = pack?.filename || 'dga-agent-briefing.md'
      downloadText(text, name)
      setStatusOk(true)
      setStatus(`✓ Downloaded ${name} — give this file to the next agent.`)
    } catch (e) {
      setStatusOk(false)
      setStatus(`Download failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const downloadRemote = async (path: string, fallbackName: string) => {
    try {
      const d = await api<MdFile>(path)
      const text = d.markdown || ''
      if (!text) {
        setStatusOk(false)
        setStatus('File empty on this deploy.')
        return
      }
      const name = d.filename || fallbackName
      downloadText(text, name)
      setStatusOk(true)
      setStatus(`✓ Downloaded ${name}`)
    } catch (e) {
      setStatusOk(false)
      setStatus(`Download failed: ${e instanceof Error ? e.message : String(e)}`)
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
        Two layers so a new model does not burn its context window — and does not
        forget the product. The <strong>briefing</strong> is short (copy/paste).
        The <strong>product log</strong> is the encyclopedia of every desk, fund,
        mobile, and constraint. The <strong>version log</strong> is every{' '}
        <code>uiNNN</code> bump. Never decrease N.
      </p>

      <ol className={styles.steps}>
        <li>
          On the <em>new</em> computer: clone or <code>git pull origin main</code>, then{' '}
          <code>curl -s https://portfolio.dgacapital.com/api/build</code>.
        </li>
        <li>
          Click <strong>Copy briefing for next agent</strong> and paste it as the
          first message in Grok Build / Claude Code / Cursor.
        </li>
        <li>
          That briefing tells the agent to open{' '}
          <code>docs/continuity/PRODUCT_LOG.md</code> (every feature) and{' '}
          <code>CONTINUITY.md</code> (version log). Download those below if you
          are handing a zip to someone without git yet.
        </li>
        <li>
          After they ship: poll <code>/api/build</code> and confirm the new uiN
          is live. Desk ticket light goes green when the inbox is empty.
        </li>
      </ol>

      <div className={styles.row} style={{ marginBottom: 10 }}>
        <Button size="sm" variant="primary" onClick={() => void copy()}>
          {copyLabel}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void downloadBriefing()}>
          Download briefing
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            void downloadRemote('/api/continuity/product-log', 'DGA-PRODUCT-LOG.md')
          }
          title="Full categorized feature encyclopedia"
        >
          Download product log
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            void downloadRemote('/api/continuity/version-log', 'CONTINUITY.md')
          }
          title="uiNNN sequence — never decrease N"
        >
          Download version log
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
        <summary>Preview briefing (short — paste this, then open the product log)</summary>
        <pre className={styles.pre}>{pack?.paste_markdown || (loading ? 'Loading…' : '')}</pre>
      </details>
    </CollapsibleCard>
  )
}
