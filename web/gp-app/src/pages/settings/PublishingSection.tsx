import { useCallback, useEffect, useState } from 'react'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import styles from '../SettingsPage.module.css'

type DiscCfg = {
  intro_enabled?: boolean
  outro_enabled?: boolean
  intro_text?: string
  outro_text?: string
  voice?: string
  ok?: boolean
  detail?: string
}

type Archived = {
  ticker: string
  rating?: string | null
}

const VOICES = [
  { value: 'alloy', label: 'alloy — neutral' },
  { value: 'echo', label: 'echo — calm male' },
  { value: 'onyx', label: 'onyx — deep male' },
  { value: 'nova', label: 'nova — bright female' },
  { value: 'shimmer', label: 'shimmer — soft female' },
  { value: 'ash', label: 'ash — rich male' },
  { value: 'sage', label: 'sage — measured female' },
  { value: 'fable', label: 'fable — British' },
]

function RssCard() {
  const feedUrl = `${window.location.origin}/api/podcast/rss.xml`
  const [copyLabel, setCopyLabel] = useState('📋')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(feedUrl)
      setCopyLabel('✓')
      setTimeout(() => setCopyLabel('📋'), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <CollapsibleCard title="📡 Podcast RSS" badge="LIVE" defaultOpen>
      <div className={styles.hint} style={{ marginBottom: 8 }}>
        Public feed for Apple / Spotify / Overcast.{' '}
        <strong style={{ color: '#92400e' }}>Counsel sign-off before submit.</strong>
      </div>
      <label className={styles.fieldLabel}>RSS URL</label>
      <div className={styles.rssRow}>
        <input className={styles.input} readOnly value={feedUrl} />
        <Button size="sm" variant="secondary" onClick={() => void copy()}>
          {copyLabel}
        </Button>
        <a
          href={feedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.pubLink}
          style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}
        >
          ▶ XML
        </a>
      </div>
      <div className={styles.pubLinks}>
        <a
          href="https://podcastsconnect.apple.com/"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.pubLink}
        >
          🍎 Apple
        </a>
        <a
          href="https://podcasters.spotify.com/"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.pubLink}
        >
          🟢 Spotify
        </a>
        <a
          href="https://podcasters.google.com/"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.pubLink}
        >
          📺 YT
        </a>
      </div>
      <div className={styles.help}>
        Set <code>PODCAST_RSS_ARTWORK_URL</code> (≥1400px square). Optional{' '}
        <code>PODCAST_RSS_TITLE</code> / <code>_DESCRIPTION</code> / <code>_AUTHOR</code>.
      </div>
    </CollapsibleCard>
  )
}

function DisclaimerCard() {
  const [cfg, setCfg] = useState<DiscCfg>({
    intro_enabled: true,
    outro_enabled: true,
    intro_text: '',
    outro_text: '',
    voice: 'alloy',
  })
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const c = await api<DiscCfg>('/api/podcast/disclaimer-config')
      setCfg({
        intro_enabled: !!c.intro_enabled,
        outro_enabled: !!c.outro_enabled,
        intro_text: c.intro_text || '',
        outro_text: c.outro_text || '',
        voice: c.voice || 'alloy',
      })
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const badge = (() => {
    if (cfg.intro_enabled && cfg.outro_enabled) return 'ON · intro + outro'
    if (cfg.intro_enabled || cfg.outro_enabled)
      return `PARTIAL · ${cfg.intro_enabled ? 'intro only' : 'outro only'}`
    return 'OFF — RISKY'
  })()

  const save = async () => {
    setBusy(true)
    setMsg('⏳ Saving…')
    try {
      const j = await api<DiscCfg>('/api/podcast/disclaimer-config', {
        method: 'POST',
        body: JSON.stringify(cfg),
      })
      if (j.ok === false) throw new Error(j.detail || 'Save failed')
      setMsg('✓ Saved — applies to next audio gen')
    } catch (e) {
      setMsg('❌ ' + (e instanceof Error ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    if (!confirm('Revert disclaimer to engine defaults?')) return
    try {
      await api('/api/podcast/disclaimer-config/reset', { method: 'POST' })
      await load()
      setMsg('Reverted to defaults')
    } catch (e) {
      alert('Reset failed: ' + (e instanceof Error ? e.message : e))
    }
  }

  return (
    <CollapsibleCard title="⚖️ Podcast disclaimer" badge={badge} defaultOpen>
      <div className={styles.hint} style={{ marginBottom: 8 }}>
        Audio intro/outro on next generate.{' '}
        <strong style={{ color: '#92400e' }}>Review with counsel before public RSS.</strong>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11 }}>
          <input
            type="checkbox"
            checked={!!cfg.intro_enabled}
            onChange={(e) => setCfg({ ...cfg, intro_enabled: e.target.checked })}
          />
          <strong>Intro</strong>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11 }}>
          <input
            type="checkbox"
            checked={!!cfg.outro_enabled}
            onChange={(e) => setCfg({ ...cfg, outro_enabled: e.target.checked })}
          />
          <strong>Outro</strong>
        </label>
      </div>
      <label className={styles.fieldLabel}>Intro text</label>
      <textarea
        className={styles.textarea}
        rows={2}
        value={cfg.intro_text || ''}
        maxLength={800}
        onChange={(e) => setCfg({ ...cfg, intro_text: e.target.value })}
      />
      <div className={styles.charCount}>{(cfg.intro_text || '').length}/800</div>
      <label className={styles.fieldLabel}>Outro text</label>
      <textarea
        className={styles.textarea}
        rows={2}
        value={cfg.outro_text || ''}
        maxLength={800}
        onChange={(e) => setCfg({ ...cfg, outro_text: e.target.value })}
      />
      <div className={styles.charCount}>{(cfg.outro_text || '').length}/800</div>
      <div className={styles.row} style={{ marginTop: 6 }}>
        <select
          className={styles.select}
          style={{ flex: 1, minWidth: 140 }}
          value={cfg.voice || 'alloy'}
          onChange={(e) => setCfg({ ...cfg, voice: e.target.value })}
        >
          {VOICES.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void save()}>
          💾 Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void reset()}>
          ↺ Defaults
        </Button>
        {msg && <span className={styles.statusMuted}>{msg}</span>}
      </div>
    </CollapsibleCard>
  )
}

function ArchivedCard() {
  const [rows, setRows] = useState<Archived[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const data = await api<Archived[]>('/api/reports/archived')
      setRows(Array.isArray(data) ? data : [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const restore = async (ticker: string) => {
    try {
      await api(`/api/reports/${encodeURIComponent(ticker)}/restore`, { method: 'POST' })
      await load()
    } catch {
      /* ignore */
    }
  }

  const restoreAll = async () => {
    if (!confirm('Restore all archived reports to Saved Reports?')) return
    try {
      await api('/api/reports/restore-all', { method: 'POST' })
      await load()
    } catch {
      /* ignore */
    }
  }

  return (
    <CollapsibleCard
      title="Archived Reports"
      badge={String(rows.length)}
      className={styles.span2}
      defaultOpen={false}
      action={
        <Button size="sm" variant="secondary" onClick={() => void restoreAll()}>
          ↩ Restore All
        </Button>
      }
    >
      {loading && <div className={styles.statusMuted}>Loading…</div>}
      {!loading && !rows.length && (
        <div className={styles.statusMuted}>
          No archived reports. Tickers you remove from Saved Reports appear here.
        </div>
      )}
      <div className={styles.chipRow}>
        {rows.map((r) => (
          <span key={r.ticker} className={styles.chip}>
            {r.ticker}
            {r.rating && (
              <span style={{ fontSize: 9, color: 'var(--brand-600)' }}>{r.rating}</span>
            )}
            <button
              type="button"
              title={`Restore ${r.ticker}`}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--brand-600)',
                fontSize: 11,
                padding: '0 2px',
              }}
              onClick={() => void restore(r.ticker)}
            >
              ↩
            </button>
          </span>
        ))}
      </div>
    </CollapsibleCard>
  )
}

export function PublishingSection() {
  return (
    <>
      <RssCard />
      <DisclaimerCard />
      <ArchivedCard />
    </>
  )
}
