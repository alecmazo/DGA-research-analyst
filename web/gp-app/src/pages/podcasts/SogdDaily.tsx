import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import styles from '../PodcastsPage.module.css'
import { ChapterPlayer } from './ChapterPlayer'

type VoiceSetting = {
  provider: string
  voice: string
  speed?: number
  voice_mode?: string
  voice_override?: string
  rotate?: boolean
}
type ProviderVoices = { provider: string; voices: string[]; configured?: boolean }
type DailyRun = {
  id: number
  episode_date?: string | null
  started_at?: string | null
  finished_at?: string | null
  status?: string | null
  stage?: string | null
  error?: string | null
  cost_usd_total?: number | null
}
type TodayEpisode = {
  episode_guid?: string | null
  episode_title?: string | null
  status?: string | null
  published_at?: string | null
}
type DailyStatus = {
  voice: VoiceSetting
  voice_today?: string | null
  auto_publish: boolean
  auto_daily?: boolean
  cost_cap_usd: number
  month_spend_usd: number
  runs: DailyRun[]
  today: TodayEpisode | null
  error?: string
  run_state?: {
    stage_done?: string | null
    attempts?: number | null
    last_error?: string | null
    next_retry_at?: string | null
    status?: string | null
    stages?: { id: string; done: boolean }[]
  } | null
}

type Playable = {
  title?: string | null
  audio_url?: string | null
  episode_guid?: string | null
  generated_at?: string | null
  show_notes?: string | null
  voice_used?: string | null
  chapters?: { title: string; startTime: number; url?: string }[] | null
}

function EpisodeCard({ ep, onErase }: { ep: Playable; onErase?: (guid: string) => void }) {
  const guid = ep.episode_guid || ''
  return (
    <article className={styles.sogdEpisode}>
      {ep.title && <h3 className={styles.sogdEpisodeTitle}>{ep.title}</h3>}
      <ChapterPlayer
        src={ep.audio_url}
        chapters={ep.chapters}
        voiceUsed={ep.voice_used}
        className={styles.sogdAudio}
        onErase={guid && onErase ? () => onErase(guid) : undefined}
      />
      {ep.show_notes && <NoteBody text={ep.show_notes} />}
    </article>
  )
}

function NoteBody({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g)
  return (
    <p className={styles.sogdNotes}>
      {parts.map((part, i) =>
        part.startsWith('http') ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer">
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  )
}

const SAMPLE = 'This episode is AI-generated and AI-narrated. Here is the voice for Systems Over Goals Daily.'

function money(value: number | null | undefined): string {
  const n = Number(value || 0)
  return `$${n.toFixed(2)}`
}

function stageLabel(stage: string | null | undefined): string {
  switch ((stage || '').toLowerCase()) {
    case 'scout': return 'Searching'
    case 'lens': return 'Reading the stories'
    case 'script': return 'Writing'
    case 'tts':
    case 'tts_chunks': return 'Recording'
    case 'rank': return 'Choosing stories'
    case 'factcheck':
    case 'fact_check': return 'Checking facts'
    case 'assemble': return 'Assembling'
    case 'master': return 'Mastering'
    case 'upload': return 'Uploading'
    case 'publish': return 'Publishing'
    case 'notify': return 'Notifying'
    case 'failed_needs_attention': return 'Needs attention'
    default: return stage ? stage.replaceAll('_', ' ') : 'Working'
  }
}

function runSeconds(run: DailyRun, now: number): number | null {
  const start = Date.parse(run.started_at || '')
  if (!Number.isFinite(start)) return null
  const end = run.status === 'running' ? now : Date.parse(run.finished_at || '')
  if (!Number.isFinite(end)) return null
  return Math.max(0, Math.round((end - start) / 1000))
}

function formatElapsed(seconds: number | null): string {
  if (seconds == null) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m >= 60) {
    const h = Math.floor(m / 60)
    return `${h}h ${m % 60}m`
  }
  return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`
}

export function SogdDaily({
  episodes,
  onErase,
}: {
  episodes: Playable[]
  onErase?: (guid: string) => void
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [status, setStatus] = useState<DailyStatus | null>(null)
  const [providers, setProviders] = useState<ProviderVoices[]>([])
  const [voice, setVoice] = useState('kepler')
  const [voiceMode, setVoiceMode] = useState<'fixed' | 'rotate'>('fixed')
  const [holdVoice, setHoldVoice] = useState(false)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    const [daily, listed] = await Promise.all([
      api<DailyStatus>('/api/podcast/systems-over-goals/daily'),
      api<{ providers: ProviderVoices[] }>('/api/podcast/tts/voices'),
    ])
    setStatus(daily)
    const xai = (listed.providers || []).find((item) => item.provider === 'xai')
    setProviders(xai ? [xai] : [{ provider: 'xai', voices: ['kepler'] }])
    const names = xai?.voices || []
    const saved = daily.voice?.provider === 'xai' ? daily.voice.voice : 'kepler'
    setVoice(names.length && saved && !names.includes(saved) ? names[0] : saved || 'kepler')
    const mode = daily.voice?.voice_mode || (daily.voice?.rotate ? 'rotate' : 'fixed')
    setVoiceMode(mode === 'rotate' ? 'rotate' : 'fixed')
    setHoldVoice(!!daily.voice?.voice_override)
  }, [])

  useEffect(() => {
    void load().catch((err: Error) => setNote(err.message))
  }, [load])

  const running = (status?.runs || []).some((run) => run.status === 'running')

  useEffect(() => {
    if (!running) return
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    const poll = window.setInterval(() => {
      void load().catch(() => undefined)
    }, 5000)
    return () => {
      window.clearInterval(tick)
      window.clearInterval(poll)
    }
  }, [running, load])

  const voices = useMemo(() => {
    const row = providers.find((item) => item.provider === 'xai')
    return row?.voices?.length ? row.voices : ['kepler']
  }, [providers])

  useEffect(() => {
    if (voices.length && !voices.includes(voice)) setVoice(voices[0])
  }, [voices, voice])

  async function saveVoice() {
    setBusy('save')
    setNote('')
    try {
      await api('/api/podcast/systems-over-goals/voice', {
        method: 'PUT',
        body: JSON.stringify({
          provider: 'xai',
          voice,
          speed: 1,
          voice_mode: voiceMode,
          voice_override: voiceMode === 'rotate' && holdVoice ? voice : '',
        }),
      })
      setNote('Voice saved. The next episode uses it.')
      await load()
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy('')
    }
  }

  async function preview() {
    setBusy('preview')
    setNote('')
    try {
      const res = await api<{ audio_b64: string }>('/api/podcast/tts/preview', {
        method: 'POST',
        body: JSON.stringify({ provider: 'xai', voice, text: SAMPLE, speed: 1 }),
      })
      const binary = atob(res.audio_b64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }))
      if (audioRef.current) {
        audioRef.current.src = url
        await audioRef.current.play()
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Preview failed')
    } finally {
      setBusy('')
    }
  }

  async function generate() {
    const today = status?.today
    const blocked = !!today && !['failed', 'cost_cap_hit'].includes(today.status || '')
    if (blocked && !window.confirm('Replace today’s episode? This starts a new generation.')) return
    setBusy('generate')
    setNote('')
    try {
      await api('/api/podcast/systems-over-goals/generate-daily', {
        method: 'POST',
        body: JSON.stringify({ force: blocked, confirm: blocked ? 'replace' : undefined }),
      })
      setNote('Generation started. This page will show the run when it finishes.')
      window.setTimeout(() => void load().catch(() => undefined), 4000)
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not start')
    } finally {
      setBusy('')
    }
  }

  async function saveMode(automatic: boolean) {
    setStatus((current) => (current ? { ...current, auto_daily: automatic } : current))
    setNote(automatic
      ? 'Automatic daily is on. The scout still starts at 6:35 AM Pacific.'
      : 'Manual. Nothing is recorded until you press Generate today’s episode.')
    try {
      await api('/api/podcast/systems-over-goals/daily-settings', {
        method: 'PUT',
        body: JSON.stringify({ auto_daily: automatic }),
      })
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not save the mode')
      await load()
    }
  }

  async function publish() {
    setBusy('publish')
    setNote('')
    try {
      const res = await api<{ status?: string }>('/api/podcast/systems-over-goals/publish-daily', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      setNote(res.status === 'published' ? 'Published to the feed.' : 'Held until 7:00 AM Pacific.')
      await load()
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Publish failed')
    } finally {
      setBusy('')
    }
  }

  const cap = status?.cost_cap_usd ?? 40
  const spend = status?.month_spend_usd ?? 0
  const capped = spend >= cap || (status?.runs || []).some((run) => run.status === 'cost_cap_hit')
  const held = status?.today?.status === 'ready_pending'
  const live = (status?.runs || []).find((run) => run.status === 'running')

  return (
    <div className={styles.sogd}>
      <p className={styles.pcDesc}>
        {status?.auto_daily === false
          ? 'Manual. Press Generate today’s episode when you want one. The feed stays quiet until 7:00 AM Pacific.'
          : 'Automatic daily. The scout starts at 6:35 AM Pacific and the feed stays quiet until 7:00 AM Pacific.'}
        {' '}Directories stay off.
      </p>
      <div className={styles.sogdSpend}>
        This month {money(spend)} of {money(cap)}
        {status?.auto_publish ? ' · auto-publish on' : ' · auto-publish off'}
        {status?.auto_daily === false ? ' · manual' : ' · automatic daily'}
      </div>
      <div className={styles.sogdRow}>
        <label className={styles.field}>
          <span>Daily run</span>
          <select
            className={styles.select}
            aria-label="Daily run"
            value={status?.auto_daily === false ? 'manual' : 'automatic'}
            onChange={(e) => void saveMode(e.target.value === 'automatic')}
          >
            <option value="automatic">Automatic daily</option>
            <option value="manual">Manual</option>
          </select>
        </label>
      </div>
      {capped && (
        <div className={styles.sogdWarn}>
          The monthly cap stopped a run. Nothing from that run was published.
        </div>
      )}
      <div className={styles.sogdRow}>
        <label className={styles.field}>
          <span>Grok voice</span>
          <select className={styles.select} value={voice} onChange={(e) => setVoice(e.target.value)}>
            {voices.map((name) => (
              <option key={name} value={name}>
                {name.charAt(0).toUpperCase() + name.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Voice mode</span>
          <select
            className={styles.select}
            aria-label="Voice mode"
            value={voiceMode}
            onChange={(e) => setVoiceMode(e.target.value === 'rotate' ? 'rotate' : 'fixed')}
          >
            <option value="fixed">Fixed</option>
            <option value="rotate">Rotate</option>
          </select>
        </label>
        {voiceMode === 'rotate' && (
          <label className={styles.field}>
            <span>Use the dropdown voice today</span>
            <input
              type="checkbox"
              checked={holdVoice}
              aria-label="Use the dropdown voice today"
              onChange={(e) => setHoldVoice(e.target.checked)}
            />
          </label>
        )}
        <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void preview()}>
          {busy === 'preview' ? 'Playing…' : 'Preview'}
        </Button>
        <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void saveVoice()}>
          {busy === 'save' ? 'Saving…' : 'Save'}
        </Button>
        <Button size="sm" variant="primary" disabled={!!busy || capped && spend >= cap} onClick={() => void generate()}>
          {busy === 'generate' ? 'Starting…' : 'Generate today’s episode'}
        </Button>
        {held && (
          <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void publish()}>
            Publish
          </Button>
        )}
      </div>
      <audio ref={audioRef} className={styles.sogdAudio} controls />
      {voiceMode === 'rotate' && status?.voice_today && (
        <p className={styles.pcDesc}>Today’s voice is {status.voice_today}.</p>
      )}
      {note && <p className={styles.pcDesc}>{note}</p>}
      {live && (
        <p className={styles.pcDesc}>
          {stageLabel(live.stage)} · {formatElapsed(runSeconds(live, now))}
        </p>
      )}
      {status?.run_state && (
        <div className={styles.pcDesc}>
          <div>
            Stage {status.run_state.stage_done || 'not started'}
            {status.run_state.attempts ? ` · attempt ${status.run_state.attempts}` : ''}
            {status.run_state.next_retry_at ? ` · next retry ${status.run_state.next_retry_at}` : ''}
          </div>
          {!!status.run_state.stages?.length && (
            <div>
              {status.run_state.stages.map((item) => (
                <span key={item.id}>
                  {item.done ? '✓' : '·'} {stageLabel(item.id)}{' '}
                </span>
              ))}
            </div>
          )}
          {status.run_state.last_error && <div>{status.run_state.last_error}</div>}
        </div>
      )}
      {status?.today?.episode_title && (
        <p className={styles.pcDesc}>
          Today: {status.today.episode_title} · {status.today.status}
        </p>
      )}
      {!!status?.runs?.length && (
        <table className={styles.sogdTable}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Status</th>
              <th>Stage</th>
              <th>Time</th>
              <th>Cost</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {status.runs.map((run) => (
              <tr key={run.id}>
                <td>{(run.episode_date || '').slice(0, 10)}</td>
                <td>{run.status}</td>
                <td>{run.status === 'running' ? stageLabel(run.stage) : run.stage}</td>
                <td>{formatElapsed(runSeconds(run, now))}</td>
                <td>{run.status === 'failed' ? '—' : money(run.cost_usd_total)}</td>
                <td>{run.error || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {episodes.map((ep) => (
        <EpisodeCard key={ep.episode_guid || ep.title || ep.audio_url} ep={ep} onErase={onErase} />
      ))}
    </div>
  )
}
