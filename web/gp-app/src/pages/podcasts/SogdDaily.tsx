import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import styles from '../PodcastsPage.module.css'

type VoiceSetting = { provider: string; voice: string; speed?: number }
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
  auto_publish: boolean
  cost_cap_usd: number
  month_spend_usd: number
  runs: DailyRun[]
  today: TodayEpisode | null
  error?: string
}

type Playable = {
  title?: string | null
  audio_url?: string | null
  episode_guid?: string | null
  generated_at?: string | null
}

const SAMPLE = 'This episode is AI-generated and AI-narrated. Here is the voice for Systems Over Goals Daily.'

function money(value: number | null | undefined): string {
  const n = Number(value || 0)
  return `$${n.toFixed(2)}`
}

export function SogdDaily({ episodes }: { episodes: Playable[] }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [status, setStatus] = useState<DailyStatus | null>(null)
  const [providers, setProviders] = useState<ProviderVoices[]>([])
  const [voice, setVoice] = useState('kepler')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')

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
  }, [])

  useEffect(() => {
    void load().catch((err: Error) => setNote(err.message))
  }, [load])

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
        body: JSON.stringify({ provider: 'xai', voice, speed: 1 }),
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
        body: JSON.stringify({ force: blocked }),
      })
      setNote('Generation started. This page will show the run when it finishes.')
      window.setTimeout(() => void load().catch(() => undefined), 4000)
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not start')
    } finally {
      setBusy('')
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

  return (
    <div className={styles.sogd}>
      <p className={styles.pcDesc}>
        One episode a day. The scout starts at 6:35 AM Pacific and the feed stays
        quiet until 7:00 AM Pacific. Directories stay off.
      </p>
      <div className={styles.sogdSpend}>
        This month {money(spend)} of {money(cap)}
        {status?.auto_publish ? ' · auto-publish on' : ' · auto-publish off'}
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
      {note && <p className={styles.pcDesc}>{note}</p>}
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
              <th>Cost</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {status.runs.map((run) => (
              <tr key={run.id}>
                <td>{(run.episode_date || '').slice(0, 10)}</td>
                <td>{run.status}</td>
                <td>{run.stage}</td>
                <td>{money(run.cost_usd_total)}</td>
                <td>{run.error || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {episodes[0]?.audio_url && (
        <audio className={styles.sogdAudio} controls src={episodes[0].audio_url || undefined} />
      )}
    </div>
  )
}
