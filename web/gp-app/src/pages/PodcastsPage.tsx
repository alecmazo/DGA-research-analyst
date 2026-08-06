import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Empty, Spinner } from '@/components/ui/Empty'
import { api, apiBlob } from '@/lib/api'
import { pollJob } from '@/lib/jobs'
import { relativeTime } from '@/lib/format'
import { ScriptRender } from './podcasts/ScriptRender'
import {
  FORMAT_OPTIONS,
  SCRIPT_STAGE_PCT,
  displayTicker,
  fmtWhen,
  type AudioStatus,
  type LabComparison,
  type LabStats,
  type LabVote,
  type PodcastEpisode,
  type PodcastFormat,
  type PodcastScript,
  type PodcastScriptMeta,
  type SavedReportRow,
  type ScriptPayload,
  type ScriptStatus,
  type SpeedConfig,
  type VoiceConfig,
} from './podcasts/types'
import page from './page.module.css'
import styles from './PodcastsPage.module.css'

const TTS_MODELS = [
  { value: 'tts-1-hd', label: 'tts-1-hd (best, ~$0.50)' },
  { value: 'tts-1', label: 'tts-1 (good, ~$0.25)' },
  { value: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts (draft, ~$0.01)' },
]

const VOICE_BLURBS: Record<string, string> = {
  alloy: 'neutral, balanced',
  ash: 'rich, slightly raspy male',
  ballad: 'soft, melodic',
  coral: 'warm female',
  echo: 'warm, conversational male',
  fable: 'British male, storyteller cadence',
  nova: 'bright, energetic female',
  onyx: 'deep male, gravitas',
  sage: 'wise, measured',
  shimmer: 'soft, measured female',
  verse: 'expressive, modern',
}

const SPEAKER_LABELS: Record<string, string> = {
  opus: 'Opus (host) — sets up the show, runs the rounds, calls a winner',
  rock: 'Rock (Grok analyst) — British, punchy, contrarian',
  claudia: 'Claudia (Claude analyst) — female, measured, skeptic',
}

function bothReports(r: SavedReportRow) {
  return !!(r.generated_at && r.claude_generated_at)
}

function anyReport(r: SavedReportRow) {
  return !!(r.generated_at || r.claude_generated_at)
}

export function PodcastsPage() {
  const [reports, setReports] = useState<SavedReportRow[]>([])
  const [scripts, setScripts] = useState<PodcastScriptMeta[]>([])
  const [episodes, setEpisodes] = useState<PodcastEpisode[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [boot, setBoot] = useState(true)

  // ① Script
  const [format, setFormat] = useState<PodcastFormat>('debate')
  const [scriptTk, setScriptTk] = useState('')
  const [roundupSel, setRoundupSel] = useState<Set<string>>(new Set())
  const [scriptBusy, setScriptBusy] = useState(false)
  const [scriptProg, setScriptProg] = useState<{ label: string; pct: number } | null>(
    null,
  )
  const [scriptView, setScriptView] = useState<{
    script: PodcastScript
    warnings?: string[]
    daBrief?: string
    stats?: string
  } | null>(null)
  const [savedScriptKey, setSavedScriptKey] = useState('')

  // ② Audio
  const [audioTk, setAudioTk] = useState('')
  const [ttsModel, setTtsModel] = useState('tts-1-hd')
  const [audioBusy, setAudioBusy] = useState(false)
  const [audioProg, setAudioProg] = useState<{ label: string; pct: number } | null>(
    null,
  )
  const [player, setPlayer] = useState<{
    ticker: string
    format: string
    title: string
    meta: string
    src: string
  } | null>(null)
  const [rate, setRate] = useState(() => {
    try {
      return parseFloat(localStorage.getItem('dga_podcast_rate') || '1') || 1
    } catch {
      return 1
    }
  })
  const audioRef = useRef<HTMLAudioElement>(null)
  const [savedAudioKey, setSavedAudioKey] = useState('')

  // ③ Voice / speed
  const [voiceCfg, setVoiceCfg] = useState<VoiceConfig | null>(null)
  const [speedCfg, setSpeedCfg] = useState<SpeedConfig | null>(null)
  const [voiceStatus, setVoiceStatus] = useState('')
  const [speedStatus, setSpeedStatus] = useState('')
  const sampleRef = useRef<HTMLAudioElement>(null)

  // Lab
  const [labTk, setLabTk] = useState('')
  const [labData, setLabData] = useState<LabComparison | null>(null)
  const [labLoading, setLabLoading] = useState(false)
  const [labStats, setLabStats] = useState<LabStats | null>(null)
  const [labVotes, setLabVotes] = useState<LabVote[]>([])
  const [voteNote, setVoteNote] = useState('')
  const [voteWinner, setVoteWinner] = useState<string | null>(null)
  const [voteStatus, setVoteStatus] = useState('')
  const [runBusy, setRunBusy] = useState<string | null>(null)

  const refreshLists = useCallback(async () => {
    try {
      const [reps, sc, eps] = await Promise.all([
        api<SavedReportRow[]>('/api/reports').catch(() => []),
        api<{ scripts?: PodcastScriptMeta[] }>('/api/podcast/scripts').catch(() => ({
          scripts: [],
        })),
        api<{ episodes?: PodcastEpisode[] }>('/api/podcast/list').catch(() => ({
          episodes: [],
        })),
      ])
      setReports(Array.isArray(reps) ? reps : [])
      setScripts(sc.scripts || [])
      setEpisodes(eps.episodes || [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load podcast data')
    }
  }, [])

  const loadVoiceSpeed = useCallback(async () => {
    try {
      const [v, s] = await Promise.all([
        api<VoiceConfig>('/api/podcast/voice-config'),
        api<SpeedConfig>('/api/podcast/speed-config'),
      ])
      setVoiceCfg(v)
      setSpeedCfg(s)
    } catch {
      /* optional panels */
    }
  }, [])

  const loadLabMeta = useCallback(async () => {
    try {
      const [st, votes] = await Promise.all([
        api<LabStats>('/api/v2/lab/stats').catch(() => null),
        api<{ votes?: LabVote[] }>('/api/v2/lab/votes').catch(() => ({ votes: [] })),
      ])
      setLabStats(st)
      setLabVotes(votes.votes || [])
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      await Promise.all([refreshLists(), loadVoiceSpeed(), loadLabMeta()])
      setBoot(false)
    })()
  }, [refreshLists, loadVoiceSpeed, loadLabMeta])

  const eligibleBoth = useMemo(
    () => reports.filter(bothReports),
    [reports],
  )
  const eligibleAny = useMemo(() => reports.filter(anyReport), [reports])

  const isMulti = format === 'roundup' || format === 'portfolio_roundup'
  const maxPick = format === 'portfolio_roundup' ? 35 : 4
  const minPick = format === 'portfolio_roundup' ? 5 : 2
  const chipPool = format === 'portfolio_roundup' ? eligibleAny : eligibleBoth

  const syncTk = (tk: string) => {
    setScriptTk(tk)
    setAudioTk(tk)
  }

  // ── Script generation ──────────────────────────────────────────
  const onScriptDone = (payload: ScriptPayload) => {
    const sc = payload.script
    if (!sc) return
    if (payload.alignment?.roles && !sc._alignment) {
      sc._alignment = {
        episode_mode: payload.alignment.roles.episode_mode,
        bull_speaker: payload.alignment.roles.bull_speaker,
        bear_speaker: payload.alignment.roles.bear_speaker,
      }
    }
    if (payload.generated_at && !sc.generated_at) sc.generated_at = payload.generated_at
    const s = (payload.validation?.stats || {}) as Record<string, unknown>
    const scriptCost =
      payload.script_cost_usd != null && !Number.isNaN(Number(payload.script_cost_usd))
        ? ` · 💸 $${Number(payload.script_cost_usd).toFixed(2)}`
        : ''
    const audioCost =
      payload.audio_cost_usd != null
        ? ` · 🎧 $${Number(payload.audio_cost_usd).toFixed(2)}`
        : ''
    setScriptView({
      script: sc,
      warnings: payload.validation?.warnings,
      daBrief: payload.da_brief,
      stats: `${s.word_count || 0} words · ${s.approx_minutes || 0} min · ${s.turn_count || 0} turns · ${s.curse_count || 0} curses · winner: ${String(s.winner || '?').toUpperCase()}${scriptCost}${audioCost}`,
    })
    void refreshLists()
  }

  const pollScriptStatus = async (tickerKey: string) => {
    const t0 = Date.now()
    let idleSince: number | null = null
    return new Promise<void>((resolve) => {
      const tick = async () => {
        const elapsed = (Date.now() - t0) / 1000
        if (elapsed > 480) {
          setErr('Script timed out after 8 min — try Generate again.')
          setScriptBusy(false)
          setScriptProg(null)
          resolve()
          return
        }
        try {
          const d = await api<ScriptStatus>(
            `/api/podcast/${encodeURIComponent(tickerKey)}/script-status`,
          )
          if (d.stage === 'idle') {
            idleSince = idleSince || Date.now()
            if (Date.now() - idleSince > 30000) {
              setErr('Job not found (server restart?). Click Generate again.')
              setScriptBusy(false)
              setScriptProg(null)
              resolve()
              return
            }
          } else idleSince = null
          const pct =
            d.stage && SCRIPT_STAGE_PCT[d.stage] != null
              ? SCRIPT_STAGE_PCT[d.stage]
              : 50
          setScriptProg({ label: d.label || d.stage || 'Working…', pct })
          if (d.status === 'done' && d.result) {
            setScriptBusy(false)
            setScriptProg(null)
            onScriptDone(d.result)
            resolve()
            return
          }
          if (d.status === 'cancelled') {
            setScriptBusy(false)
            setScriptProg(null)
            setErr('Cancelled — generation stopped.')
            resolve()
            return
          }
          if (d.status === 'error') {
            setScriptBusy(false)
            setScriptProg(null)
            setErr(d.label || d.error || 'Generation failed')
            resolve()
            return
          }
        } catch {
          /* keep polling */
        }
        window.setTimeout(() => void tick(), 1500)
      }
      void tick()
    })
  }

  const generateScript = async () => {
    setErr(null)
    setScriptBusy(true)
    setScriptProg({ label: 'Starting…', pct: 4 })
    setScriptView(null)
    try {
      if (format === 'roundup') {
        const picks = Array.from(roundupSel)
        if (picks.length < 2 || picks.length > 4) {
          throw new Error('Pick 2–4 tickers for a Roundup.')
        }
        const r0 = await api<{ ok?: boolean; error?: string; ticker?: string }>(
          '/api/podcast-roundup/script',
          {
            method: 'POST',
            body: JSON.stringify({ tickers: picks }),
          },
        )
        if (!r0.ok) throw new Error(r0.error || 'Failed to start')
        const key =
          r0.ticker ||
          'ROUNDUP_' + picks.map((t) => t.toUpperCase()).join(',')
        await pollScriptStatus(key)
      } else if (format === 'portfolio_roundup') {
        const picks = Array.from(roundupSel)
        if (picks.length < 5 || picks.length > 35) {
          throw new Error('Pick 5–35 tickers for a Portfolio Roundup.')
        }
        const r0 = await api<{ ok?: boolean; error?: string; ticker?: string }>(
          '/api/podcast-portfolio-roundup/script',
          {
            method: 'POST',
            body: JSON.stringify({ tickers: picks }),
          },
        )
        if (!r0.ok) throw new Error(r0.error || 'Failed to start')
        const key = r0.ticker || 'PORTFOLIO_' + picks.length + 'TICKERS'
        await pollScriptStatus(key)
      } else {
        if (!scriptTk) throw new Error('Pick a ticker first.')
        const r0 = await api<{ ok?: boolean; error?: string }>(
          `/api/podcast/${encodeURIComponent(scriptTk)}/script?format=${encodeURIComponent(format)}`,
          { method: 'POST' },
        )
        if (!r0.ok) throw new Error(r0.error || 'Failed to start')
        await pollScriptStatus(scriptTk)
      }
    } catch (e) {
      setScriptBusy(false)
      setScriptProg(null)
      setErr(e instanceof Error ? e.message : 'Script failed')
    }
  }

  const loadSavedScript = async (raw: string) => {
    setSavedScriptKey(raw)
    if (!raw) return
    const [tk, fmt] = raw.includes('::') ? raw.split('::') : [raw, 'debate']
    setErr(null)
    try {
      const d = await api<ScriptPayload>(
        `/api/podcast/${encodeURIComponent(tk)}/script?format=${encodeURIComponent(fmt)}`,
      )
      if (!d.ok || !d.script) throw new Error(d.error || 'Failed')
      onScriptDone(d)
      syncTk(tk)
      setFormat((fmt as PodcastFormat) || 'debate')
      // surface player if audio exists
      const ep = episodes.find(
        (e) => e.ticker === tk && (e.format || 'debate') === fmt,
      )
      if (ep) showPlayer(tk, fmt, ep)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Load failed')
    }
  }

  // ── Audio ──────────────────────────────────────────────────────
  const showPlayer = (
    ticker: string,
    fmt: string,
    status?: Partial<PodcastEpisode & AudioStatus>,
  ) => {
    let epTitle =
      status?.title ||
      episodes.find((e) => e.ticker === ticker && (e.format || 'debate') === fmt)
        ?.title
    if (!epTitle || /^PORTFOLIO_\d+TICKERS_\d+$/i.test(epTitle)) {
      if (ticker.startsWith('PORTFOLIO_')) epTitle = 'Portfolio Roundup'
      else if (ticker.startsWith('ROUNDUP_'))
        epTitle =
          'Roundup · ' + ticker.replace('ROUNDUP_', '').split(',').join(' · ')
      else epTitle = `${ticker}: ${fmt}`
    }
    const parts: string[] = []
    if (status?.duration_sec) parts.push(`${Math.round(status.duration_sec)}s`)
    if (status?.cost_usd != null) parts.push(`$${Number(status.cost_usd).toFixed(3)}`)
    if (status?.dropbox_path) parts.push('Dropbox ✓')
    setPlayer({
      ticker,
      format: fmt,
      title: epTitle,
      meta: parts.length ? parts.join(' · ') : 'Ready',
      src: `/api/podcast/${encodeURIComponent(ticker)}/audio.mp3?format=${encodeURIComponent(fmt)}&t=${Date.now()}`,
    })
  }

  const generateAudio = async (overrideTk?: string, overrideFmt?: string) => {
    const tk = overrideTk || audioTk
    let fmt = overrideFmt || format
    if (tk.startsWith('PORTFOLIO_')) fmt = 'portfolio_roundup'
    else if (tk.startsWith('ROUNDUP_')) fmt = 'roundup'
    if (!tk) {
      setErr('Pick a ticker first.')
      return
    }
    setErr(null)
    setAudioBusy(true)
    setAudioProg({ label: 'Starting…', pct: 0 })
    setPlayer(null)
    try {
      const d = await api<{ ok?: boolean; error?: string }>(
        `/api/podcast/${encodeURIComponent(tk)}/generate?tts_model=${encodeURIComponent(ttsModel)}&format=${encodeURIComponent(fmt)}`,
        { method: 'POST' },
      )
      if (!d.ok) throw new Error(d.error || 'Failed to start')
      // poll status
      await new Promise<void>((resolve) => {
        const tick = async () => {
          try {
            const st = await api<AudioStatus>(
              `/api/podcast/${encodeURIComponent(tk)}/status?format=${encodeURIComponent(fmt)}`,
            )
            const pct =
              st.total && st.current
                ? Math.min(96, (st.current / st.total) * 95)
                : st.stage === 'queued'
                  ? 4
                  : st.stage === 'stitch'
                    ? 97
                    : 12
            setAudioProg({ label: st.label || st.stage || 'Working…', pct })
            if (st.status === 'done') {
              setAudioBusy(false)
              setAudioProg({ label: st.label || '✓ Done', pct: 100 })
              showPlayer(tk, fmt, { ...st, format: fmt })
              void refreshLists()
              resolve()
              return
            }
            if (st.status === 'error') {
              setAudioBusy(false)
              setAudioProg(null)
              setErr(st.label || 'Audio generation failed')
              resolve()
              return
            }
          } catch {
            /* keep */
          }
          window.setTimeout(() => void tick(), 1800)
        }
        void tick()
      })
    } catch (e) {
      setAudioBusy(false)
      setAudioProg(null)
      setErr(e instanceof Error ? e.message : 'Audio failed')
    }
  }

  const loadSavedAudio = (raw: string) => {
    setSavedAudioKey(raw)
    if (!raw) return
    const [tk, fmt] = raw.includes('::') ? raw.split('::') : [raw, 'debate']
    const ep = episodes.find(
      (e) => e.ticker === tk && (e.format || 'debate') === fmt,
    )
    syncTk(tk)
    showPlayer(tk, fmt, ep || { format: fmt })
  }

  useEffect(() => {
    const el = audioRef.current
    if (el) el.playbackRate = rate
  }, [rate, player])

  const setPlaybackRate = (r: number) => {
    setRate(r)
    try {
      localStorage.setItem('dga_podcast_rate', String(r))
    } catch {
      /* ignore */
    }
    if (audioRef.current) audioRef.current.playbackRate = r
  }

  const shareLink = async () => {
    if (!player) return
    try {
      const j = await api<{ ok?: boolean; url?: string; error?: string; detail?: string }>(
        `/api/podcast/${encodeURIComponent(player.ticker)}/share-link?format=${encodeURIComponent(player.format)}&ttl_hours=720`,
        { method: 'POST' },
      )
      if (!j.ok || !j.url) throw new Error(j.detail || j.error || 'Failed')
      try {
        await navigator.clipboard.writeText(j.url)
        alert(`Share link copied (30-day):\n\n${j.url}`)
      } catch {
        prompt('Share link (copy):', j.url)
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Share failed')
    }
  }

  const deleteAudio = async () => {
    if (!player) return
    if (!confirm('Delete this audio episode (MP3)? Script is kept.')) return
    try {
      await api(
        `/api/podcast/${encodeURIComponent(player.ticker)}?format=${encodeURIComponent(player.format)}&what=audio`,
        { method: 'DELETE' },
      )
      setPlayer(null)
      void refreshLists()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const renameScript = async (tk: string, fmt: string, current: string) => {
    const next = prompt('Rename this episode:', current)
    if (next === null) return
    const clean = next.trim()
    if (!clean) return
    try {
      await api(
        `/api/podcast/${encodeURIComponent(tk)}/title?format=${encodeURIComponent(fmt)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ title: clean }),
        },
      )
      if (scriptView?.script) {
        setScriptView({
          ...scriptView,
          script: { ...scriptView.script, episode_title: clean },
        })
      }
      void refreshLists()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Rename failed')
    }
  }

  const deleteScript = async (tk: string, fmt: string) => {
    if (!confirm('Delete this entire episode (script + audio if any)?')) return
    try {
      await api(
        `/api/podcast/${encodeURIComponent(tk)}?format=${encodeURIComponent(fmt)}&what=all`,
        { method: 'DELETE' },
      )
      setScriptView(null)
      setPlayer(null)
      void refreshLists()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  // ── Voice config ───────────────────────────────────────────────
  const saveVoices = async () => {
    if (!voiceCfg?.voices) return
    setVoiceStatus('Saving…')
    try {
      const d = await api<VoiceConfig>('/api/podcast/voice-config', {
        method: 'POST',
        body: JSON.stringify({ voices: voiceCfg.voices }),
      })
      setVoiceCfg(d)
      setVoiceStatus('✓ Saved')
    } catch (e) {
      setVoiceStatus(e instanceof Error ? e.message : 'Failed')
    }
  }

  const resetVoices = async () => {
    if (!confirm('Reset cast to defaults?')) return
    const d = await api<VoiceConfig>('/api/podcast/voice-config/reset', {
      method: 'POST',
    })
    setVoiceCfg(d)
    setVoiceStatus('✓ Reset')
  }

  const playSample = async (speaker: string, voice: string) => {
    try {
      const blob = await apiBlob(
        `/api/podcast/voice-sample?speaker=${encodeURIComponent(speaker)}&voice=${encodeURIComponent(voice)}`,
      )
      const url = URL.createObjectURL(blob)
      const el = sampleRef.current
      if (!el) return
      el.pause()
      el.src = url
      el.onended = () => URL.revokeObjectURL(url)
      await el.play()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Sample failed')
    }
  }

  const saveSpeeds = async () => {
    if (!speedCfg) return
    setSpeedStatus('Saving…')
    try {
      const d = await api<SpeedConfig>('/api/podcast/speed-config', {
        method: 'POST',
        body: JSON.stringify(speedCfg),
      })
      setSpeedCfg(d)
      setSpeedStatus('✓ Saved')
    } catch (e) {
      setSpeedStatus(e instanceof Error ? e.message : 'Failed')
    }
  }

  const resetSpeeds = async () => {
    if (!confirm('Reset speeds to defaults?')) return
    const d = await api<SpeedConfig>('/api/podcast/speed-config/reset', {
      method: 'POST',
    })
    setSpeedCfg(d)
    setSpeedStatus('✓ Reset')
  }

  // ── Lab compare ────────────────────────────────────────────────
  const labOrder = useMemo(() => {
    if (!labData) return [] as string[]
    const engines = labData.engines || {}
    if (labData.show?.length) return labData.show
    return ['grok', 'claude', 'deepseek', 'kimi'].filter((p) => {
      const e = engines[p] || {}
      return e.has_report || e.configured || p === 'grok'
    })
  }, [labData])

  const loadLab = async (tk: string) => {
    if (!tk) return
    setLabTk(tk)
    setLabLoading(true)
    setErr(null)
    setVoteWinner(null)
    setVoteNote('')
    setVoteStatus('')
    try {
      const data = await api<LabComparison>(
        `/api/reports/${encodeURIComponent(tk)}/comparison`,
      )
      setLabData(data)
      const existing = labVotes.find((v) => v.ticker === tk)
      if (existing) {
        setVoteWinner(existing.winner || null)
        setVoteNote(existing.note || '')
        setVoteStatus(`✓ Previously voted ${relativeTime(existing.voted_at)}`)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Compare failed')
      setLabData(null)
    } finally {
      setLabLoading(false)
    }
  }

  const runLabProvider = async (provider: string) => {
    if (!labTk) return
    setRunBusy(provider)
    try {
      const job = await api<{ job_id?: string }>(
        `/api/reports/${encodeURIComponent(labTk)}/compare?provider=${encodeURIComponent(provider)}`,
        { method: 'POST' },
      )
      if (!job.job_id) throw new Error('No job_id')
      await pollJob(job.job_id)
      await loadLab(labTk)
      void loadLabMeta()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Run failed')
    } finally {
      setRunBusy(null)
    }
  }

  const castVote = async (winner: string) => {
    if (!labData || !labTk) return
    const engines = labData.engines || {}
    const gs = engines.grok?.summary || {}
    const cs = engines.claude?.summary || labData.alt?.summary || {}
    try {
      await api('/api/v2/lab/vote', {
        method: 'POST',
        body: JSON.stringify({
          ticker: labTk,
          winner,
          note: voteNote || null,
          grok_target: gs.price_target ?? null,
          claude_target: cs.price_target ?? null,
          grok_upside: gs.upside_pct ?? null,
          claude_upside: cs.upside_pct ?? null,
        }),
      })
      setVoteWinner(winner)
      setVoteStatus(`✓ Vote saved · ${winner.toUpperCase()}`)
      void loadLabMeta()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Vote failed')
    }
  }

  const toggleRoundup = (tk: string) => {
    setRoundupSel((prev) => {
      const next = new Set(prev)
      if (next.has(tk)) next.delete(tk)
      else if (next.size < maxPick) next.add(tk)
      return next
    })
  }

  if (boot) {
    return (
      <div className={page.page}>
        <Spinner label="Loading podcast studio…" />
      </div>
    )
  }

  return (
    <div className={page.page}>
      <header className={styles.pageHead}>
        <h1 className={styles.h1}>Podcasts</h1>
        <p className={styles.sub}>
          Script and synthesize research podcasts from saved reports. Optional A/B
          compare of engines on any report.
        </p>
      </header>

      {err && (
        <div className={page.bannerErr}>
          {err}
          <button type="button" className={styles.dismiss} onClick={() => setErr(null)}>
            ×
          </button>
        </div>
      )}

      {/* ══ DGA HiTech Podcast ══ */}
      <section className={styles.pcCard}>
        <header className={styles.pcHead}>🎙️ DGA HiTech Podcast</header>

        {/* ① Script */}
        <div className={styles.pcSection}>
          <div className={styles.pcTitle}>① Script Generator</div>
          <div className={styles.pcDesc}>
            Pick a ticker with BOTH Grok + Claude reports. <strong>Kimi narrates</strong>{' '}
            (host); Rock = Grok analyst, Claudia = Claude analyst. Dialogue as chat
            bubbles. <strong>~$0.10–0.25 / script</strong>.
          </div>

          <div className={styles.pcRow}>
            <div className={styles.pcControls}>
              <label className={styles.field}>
                <span>Format</span>
                <select
                  className={`${styles.select} ${styles.selectFmt}`}
                  value={format}
                  onChange={(e) => {
                    setFormat(e.target.value as PodcastFormat)
                    setRoundupSel(new Set())
                  }}
                >
                  {FORMAT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {!isMulti && (
                <label className={styles.field} style={{ flex: 1 }}>
                  <span>Ticker</span>
                  <select
                    className={styles.select}
                    value={scriptTk}
                    onChange={(e) => syncTk(e.target.value)}
                  >
                    <option value="">
                      — select a ticker ({eligibleBoth.length} eligible) —
                    </option>
                    {eligibleBoth.map((r) => (
                      <option key={r.ticker} value={r.ticker}>
                        {r.ticker}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <Button
              variant="primary"
              disabled={scriptBusy}
              onClick={() => void generateScript()}
            >
              {scriptBusy ? '⏳ Working…' : '🎬 Generate script'}
            </Button>
          </div>

          {isMulti && (
            <div className={styles.roundupBox}>
              <div className={styles.roundupHdr}>
                <span>
                  {format === 'portfolio_roundup'
                    ? `🧰 Portfolio Roundup — click ${minPick}-${maxPick} tickers`
                    : `📰 Roundup — click ${minPick}-${maxPick} tickers`}
                </span>
                <span>
                  {roundupSel.size} / {maxPick} selected
                </span>
              </div>
              <div className={styles.chips}>
                {chipPool.map((r) => {
                  const on = roundupSel.has(r.ticker)
                  return (
                    <button
                      key={r.ticker}
                      type="button"
                      className={`${styles.chip} ${on ? styles.chipOn : ''}`}
                      onClick={() => toggleRoundup(r.ticker)}
                    >
                      {on ? '✓ ' : ''}
                      {r.ticker}
                    </button>
                  )
                })}
                {!chipPool.length && (
                  <span className={styles.muted}>No eligible tickers.</span>
                )}
              </div>
            </div>
          )}

          <div className={styles.orRow}>
            <span className={styles.orLabel}>Or</span>
            <select
              className={styles.orSelect}
              value={savedScriptKey}
              onChange={(e) => void loadSavedScript(e.target.value)}
            >
              <option value="">📂 Open a saved script… ({scripts.length})</option>
              {scripts.map((s) => {
                const fmtKey = s.format || 'debate'
                return (
                  <option key={`${s.ticker}::${fmtKey}`} value={`${s.ticker}::${fmtKey}`}>
                    {displayTicker(s.ticker, s.title)}
                    {s.winner ? ` · 🏆 ${s.winner.toUpperCase()}` : ''}
                    {s.has_audio ? ' · 🎧' : ''}
                    {s.script_cost_usd
                      ? ` · 💸 $${Number(s.script_cost_usd).toFixed(2)}`
                      : ''}
                    {' · '}
                    {fmtWhen(s.generated_at)}
                  </option>
                )
              })}
            </select>
          </div>

          {scriptProg && (
            <div className={styles.progress}>
              <div className={styles.progressLabel}>{scriptProg.label}</div>
              <div className={styles.progressTrack}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${scriptProg.pct}%` }}
                />
              </div>
            </div>
          )}

          {scriptView?.stats && (
            <div className={styles.stats}>{scriptView.stats}</div>
          )}

          {scriptView?.script && (
            <div className={styles.scriptBox}>
              <ScriptRender
                script={scriptView.script}
                warnings={scriptView.warnings}
                daBrief={scriptView.daBrief}
                onMakeAudio={(tk, fmt) => {
                  syncTk(tk)
                  setFormat(fmt as PodcastFormat)
                  void generateAudio(tk, fmt)
                }}
                onRename={renameScript}
                onDelete={(tk, fmt) => void deleteScript(tk, fmt)}
              />
            </div>
          )}
        </div>

        {/* ② Audio */}
        <div className={styles.pcSection}>
          <div className={styles.pcTitle}>② Audio Episode</div>
          <div className={styles.pcDesc}>
            Synthesizes dialogue with OpenAI TTS (voices in Cast below), music stings +
            disclaimer, Dropbox mirror. <strong>~$0.35–0.55 / episode</strong>.
          </div>

          <div className={styles.pcRow}>
            <div className={styles.pcControls}>
              <label className={styles.field} style={{ flex: 1 }}>
                <span>Ticker</span>
                <select
                  className={styles.select}
                  value={audioTk}
                  onChange={(e) => syncTk(e.target.value)}
                >
                  <option value="">
                    — select a ticker ({eligibleBoth.length} eligible) —
                  </option>
                  {eligibleBoth.map((r) => (
                    <option key={r.ticker} value={r.ticker}>
                      {r.ticker}
                    </option>
                  ))}
                  {/* include synthetic keys from scripts */}
                  {scripts
                    .filter(
                      (s) =>
                        s.ticker.startsWith('ROUNDUP_') ||
                        s.ticker.startsWith('PORTFOLIO_'),
                    )
                    .map((s) => (
                      <option key={s.ticker} value={s.ticker}>
                        {displayTicker(s.ticker, s.title)}
                      </option>
                    ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>TTS quality</span>
                <select
                  className={styles.select}
                  value={ttsModel}
                  onChange={(e) => setTtsModel(e.target.value)}
                >
                  {TTS_MODELS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <Button
              variant="primary"
              disabled={audioBusy}
              onClick={() => void generateAudio()}
            >
              {audioBusy ? '⏳ Generating…' : '🎧 Generate audio'}
            </Button>
          </div>

          <div className={styles.orRow}>
            <span className={styles.orLabel}>Or</span>
            <select
              className={styles.orSelect}
              value={savedAudioKey}
              onChange={(e) => loadSavedAudio(e.target.value)}
            >
              <option value="">🎧 Open a saved episode… ({episodes.length})</option>
              {episodes.map((e) => {
                const fmt = e.format || 'debate'
                return (
                  <option
                    key={`${e.ticker}::${fmt}`}
                    value={`${e.ticker}::${fmt}`}
                  >
                    {displayTicker(e.ticker, e.title)}
                    {e.duration_sec ? ` · ${Math.round(e.duration_sec)}s` : ''}
                    {e.cost_usd != null ? ` · $${Number(e.cost_usd).toFixed(2)}` : ''}
                    {' · '}
                    {fmtWhen(e.generated_at)}
                  </option>
                )
              })}
            </select>
          </div>

          {audioProg && (
            <div className={styles.progress}>
              <div className={styles.progressLabel}>{audioProg.label}</div>
              <div className={styles.progressTrack}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${audioProg.pct}%` }}
                />
              </div>
            </div>
          )}

          {player && (
            <div className={styles.player}>
              <div className={styles.playerTop}>
                <div className={styles.playerTitle}>🎙️ {player.title}</div>
                <button type="button" className={styles.playerBtn} onClick={() => void shareLink()}>
                  🔗 Share
                </button>
                <button
                  type="button"
                  className={styles.playerBtnDanger}
                  onClick={() => void deleteAudio()}
                >
                  🗑️
                </button>
              </div>
              <audio
                ref={audioRef}
                controls
                preload="metadata"
                src={player.src}
                style={{ width: '100%' }}
                onLoadedMetadata={() => {
                  if (audioRef.current) audioRef.current.playbackRate = rate
                }}
              />
              <div className={styles.speedRow}>
                <span className={styles.speedLbl}>SPEED</span>
                {[0.75, 1, 1.25, 1.5, 1.75, 2].map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={`${styles.speedBtn} ${rate === r ? styles.speedOn : ''}`}
                    onClick={() => setPlaybackRate(r)}
                  >
                    {r}×
                  </button>
                ))}
                <span className={styles.playerMeta}>{player.meta}</span>
              </div>
            </div>
          )}
        </div>

        {/* ③ Voice config */}
        <div className={`${styles.pcSection} ${styles.pcMuted}`}>
          <div className={styles.pcTitle}>
            ③ Voice configuration{' '}
            <span className={styles.pcTitleNote}>— applied at next audio generation</span>
          </div>
          <details className={styles.details}>
            <summary>🎭 Cast — pick the voice for each character</summary>
            <div className={styles.detailsBody}>
              <audio ref={sampleRef} style={{ display: 'none' }} />
              {!voiceCfg ? (
                <Spinner />
              ) : (
                <>
                  {Object.keys(voiceCfg.voices || {}).map((sp) => (
                    <div key={sp} className={styles.voiceRow}>
                      <div className={styles.voiceLbl}>
                        <strong>{sp}</strong>
                        <div className={styles.muted}>{SPEAKER_LABELS[sp] || ''}</div>
                      </div>
                      <select
                        className={styles.select}
                        value={voiceCfg.voices?.[sp] || ''}
                        onChange={(e) =>
                          setVoiceCfg({
                            ...voiceCfg,
                            voices: {
                              ...(voiceCfg.voices || {}),
                              [sp]: e.target.value,
                            },
                          })
                        }
                      >
                        {(voiceCfg.available || []).map((v) => (
                          <option key={v} value={v}>
                            {v}
                            {VOICE_BLURBS[v] ? ` — ${VOICE_BLURBS[v]}` : ''}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() =>
                          void playSample(sp, voiceCfg.voices?.[sp] || 'alloy')
                        }
                      >
                        ▶ Sample
                      </Button>
                    </div>
                  ))}
                  <div className={styles.cfgActions}>
                    <Button size="sm" variant="primary" onClick={() => void saveVoices()}>
                      💾 Save cast
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => void resetVoices()}>
                      ↺ Reset
                    </Button>
                    <span className={styles.muted}>{voiceStatus}</span>
                  </div>
                </>
              )}
            </div>
          </details>

          <details className={styles.details}>
            <summary>🎚 Voice speed — per-speaker × intensity</summary>
            <div className={styles.detailsBody}>
              {!speedCfg ? (
                <Spinner />
              ) : (
                <>
                  <div className={styles.tableWrap}>
                    <table className={styles.speedTable}>
                      <thead>
                        <tr>
                          <th>Speaker</th>
                          {(speedCfg.intensities || ['calm', 'normal', 'heated']).map(
                            (i) => (
                              <th key={i}>{i}</th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {(
                          speedCfg.speakers ||
                          Object.keys(speedCfg.speeds || {}) ||
                          []
                        ).map((sp) => (
                          <tr key={sp}>
                            <td>
                              <strong>{sp}</strong>
                            </td>
                            {(speedCfg.intensities || ['calm', 'normal', 'heated']).map(
                              (intensity) => (
                                <td key={intensity}>
                                  <input
                                    type="number"
                                    step="0.05"
                                    min="0.5"
                                    max="2"
                                    className={styles.speedInput}
                                    value={
                                      speedCfg.speeds?.[sp]?.[intensity] ?? 1
                                    }
                                    onChange={(e) => {
                                      const v = parseFloat(e.target.value)
                                      setSpeedCfg({
                                        ...speedCfg,
                                        speeds: {
                                          ...(speedCfg.speeds || {}),
                                          [sp]: {
                                            ...(speedCfg.speeds?.[sp] || {}),
                                            [intensity]: v,
                                          },
                                        },
                                      })
                                    }}
                                  />
                                </td>
                              ),
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className={styles.cfgActions}>
                    <Button size="sm" variant="primary" onClick={() => void saveSpeeds()}>
                      💾 Save
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => void resetSpeeds()}>
                      ↺ Reset
                    </Button>
                    <span className={styles.muted}>{speedStatus}</span>
                  </div>
                </>
              )}
            </div>
          </details>
        </div>
      </section>

      {/* ══ Lab: multi-engine compare ══ */}
      <div className={styles.labGrid}>
        <section className={styles.labCard} style={{ gridColumn: 'span 2' }}>
          <header className={styles.labHead}>Pick a ticker to compare</header>
          <div className={styles.labBody}>
            <div className={styles.labPick}>
              <label className={styles.field} style={{ flex: 1 }}>
                <span>Saved report</span>
                <select
                  className={styles.select}
                  value={labTk}
                  onChange={(e) => setLabTk(e.target.value)}
                >
                  <option value="">
                    — select a saved report ({reports.length} available) —
                  </option>
                  {reports.map((r) => (
                    <option key={r.ticker} value={r.ticker}>
                      {r.ticker}
                      {r.rating ? ` · ${r.rating}` : ''}
                      {r.upside_pct != null
                        ? ` · ${r.upside_pct >= 0 ? '+' : ''}${r.upside_pct.toFixed(1)}%`
                        : ''}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                variant="primary"
                disabled={!labTk || labLoading}
                onClick={() => void loadLab(labTk)}
              >
                {labLoading ? '…' : 'Load Comparison →'}
              </Button>
            </div>
            {labData && (
              <div className={styles.runBtns}>
                {['claude', 'deepseek', 'kimi']
                  .filter((p) => {
                    const e = labData.engines?.[p]
                    return e && !e.has_report && e.configured !== false
                  })
                  .map((p) => (
                    <Button
                      key={p}
                      size="sm"
                      variant="secondary"
                      disabled={runBusy === p}
                      onClick={() => void runLabProvider(p)}
                    >
                      {runBusy === p
                        ? `⏳ ${p}…`
                        : `⚡ Run ${p === 'deepseek' ? 'DeepSeek · live EDGAR' : p === 'kimi' ? 'Kimi' : 'Claude'}`}
                    </Button>
                  ))}
              </div>
            )}
          </div>
        </section>

        <section className={styles.labCard}>
          <header className={styles.labHead}>Leaderboard</header>
          <div className={styles.labBody}>
            {!labStats?.total ? (
              <div className={styles.muted}>
                No votes yet — load a comparison and cast one.
              </div>
            ) : (
              <>
                <div className={styles.lbTotal}>
                  <strong>{labStats.total}</strong> vote
                  {labStats.total !== 1 ? 's' : ''} cast
                </div>
                <div className={styles.lbBar}>
                  <div
                    className={styles.segGrok}
                    style={{ width: `${labStats.grok_win_pct || 0}%` }}
                  />
                  <div
                    className={styles.segTie}
                    style={{ width: `${labStats.tie_pct || 0}%` }}
                  />
                  <div
                    className={styles.segClaude}
                    style={{ width: `${labStats.claude_win_pct || 0}%` }}
                  />
                </div>
                <div className={styles.lbRow}>
                  <span>GROK</span>
                  <strong>
                    {labStats.grok_wins} · {labStats.grok_win_pct}%
                  </strong>
                </div>
                <div className={styles.lbRow}>
                  <span style={{ color: '#d97706' }}>CLAUDE</span>
                  <strong>
                    {labStats.claude_wins} · {labStats.claude_win_pct}%
                  </strong>
                </div>
                <div className={styles.lbRow}>
                  <span style={{ color: '#64748b' }}>TIE</span>
                  <strong>
                    {labStats.ties} · {labStats.tie_pct}%
                  </strong>
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      {labData && (
        <section className={styles.labCard} style={{ marginTop: 14 }}>
          <header className={styles.labHead}>
            <span>
              🔬 {labData.ticker}: {labOrder.map((p) => p.toUpperCase()).join(' · ')}
            </span>
          </header>
          {labOrder.filter((p) => labData.engines?.[p]?.has_report).length >= 2 && (
            <div className={styles.summaryStrip}>
              {labOrder
                .filter((p) => labData.engines?.[p]?.has_report)
                .map((p) => {
                  const s = labData.engines?.[p]?.summary || {}
                  return (
                    <div key={p}>
                      {p.toUpperCase()}: <strong>{s.rating || '—'}</strong> · target{' '}
                      <strong>
                        {s.price_target != null
                          ? `$${Number(s.price_target).toFixed(2)}`
                          : '—'}
                      </strong>{' '}
                      · upside{' '}
                      <strong>
                        {s.upside_pct != null
                          ? `${s.upside_pct >= 0 ? '+' : ''}${Number(s.upside_pct).toFixed(1)}%`
                          : '—'}
                      </strong>
                    </div>
                  )
                })}
            </div>
          )}
          <div
            className={styles.labPanes}
            style={{
              gridTemplateColumns: `repeat(${Math.max(2, labOrder.length)}, 1fr)`,
            }}
          >
            {labOrder.map((eng) => {
              const e = labData.engines?.[eng] || {}
              return (
                <div key={eng} className={styles.labPane}>
                  <div className={styles.paneHdr}>
                    <span className={`${styles.engBadge} ${styles[`eng_${eng}`] || ''}`}>
                      {eng.toUpperCase()}
                    </span>
                    <span className={styles.paneMeta}>
                      {e.model || eng} · {relativeTime(e.generated_at) || '—'}
                    </span>
                  </div>
                  <div className={styles.paneBody}>
                    {e.has_report && e.text ? (
                      <pre className={styles.md}>{e.text.slice(0, 12000)}</pre>
                    ) : (
                      <div className={styles.muted}>
                        No {eng.toUpperCase()} report yet
                        {eng === 'grok'
                          ? ' — run Analyze from the desk first.'
                          : ` — click Run ${eng.toUpperCase()} above.`}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className={styles.voteBar}>
            <strong>Which is better?</strong>
            {(['grok', 'tie', 'claude'] as const).map((w) => (
              <button
                key={w}
                type="button"
                className={`${styles.voteBtn} ${voteWinner === w ? styles.voteOn : ''} ${styles[`vote_${w}`]}`}
                onClick={() => void castVote(w)}
              >
                {w === 'tie' ? 'TIE' : `${w.toUpperCase()} WINS`}
              </button>
            ))}
            <input
              className={styles.voteNote}
              placeholder="One-line reason (optional)"
              value={voteNote}
              onChange={(e) => setVoteNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && voteWinner) void castVote(voteWinner)
              }}
            />
            {voteStatus && <span className={styles.voteStatus}>{voteStatus}</span>}
          </div>
        </section>
      )}

      {labVotes.length > 0 && (
        <section className={styles.labCard} style={{ marginTop: 14 }}>
          <header className={styles.labHead}>
            <span>Vote history</span>
            <span className={styles.muted}>{labVotes.length}</span>
          </header>
          <div className={styles.histList}>
            {labVotes.slice(0, 40).map((v, i) => (
              <div key={i} className={styles.histRow}>
                <strong
                  className={styles.histTk}
                  onClick={() => {
                    setLabTk(v.ticker || '')
                    void loadLab(v.ticker || '')
                  }}
                >
                  {v.ticker}
                </strong>
                <span
                  className={`${styles.histWin} ${
                    v.winner === 'grok'
                      ? styles.winGrok
                      : v.winner === 'claude'
                        ? styles.winClaude
                        : ''
                  }`}
                >
                  {(v.winner || '—').toUpperCase()}
                </span>
                <span className={styles.muted}>{relativeTime(v.voted_at)}</span>
                {v.note && <span className={styles.histNote}>{v.note}</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {!episodes.length && !scripts.length && !reports.length && (
        <Empty
          title="No podcast data yet"
          sub="Generate a dual-engine report on the Desk, then create a script here."
        />
      )}
    </div>
  )
}
