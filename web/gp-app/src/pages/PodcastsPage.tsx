import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Empty, Spinner } from '@/components/ui/Empty'
import { api, apiBlob } from '@/lib/api'
import { useAnalysisScene } from '@/hooks/useAnalysisScene'
import { ScriptRender } from './podcasts/ScriptRender'
import { ChapterPlayer } from './podcasts/ChapterPlayer'
import { SogdDaily } from './podcasts/SogdDaily'
import {
  FORMAT_OPTIONS,
  SCRIPT_STAGE_PCT,
  displayTicker,
  fmtWhen,
  type AudioStatus,
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

const PODCAST_SHOWS = [
  { id: 'dga-hitech', label: 'DGA HiTech' },
  { id: 'systems-over-goals', label: 'Systems Over Goals Daily' },
] as const

const CAST = [
  {
    key: 'kimi',
    name: 'Kimi',
    role: 'Host',
    line: 'Opens the show, runs the rounds, and calls a winner.',
  },
  {
    key: 'rock',
    name: 'Rock',
    role: 'Grok analyst',
    line: 'Contrarian. Argues the long case from the Grok note.',
  },
  {
    key: 'claudia',
    name: 'Claudia',
    role: 'Claude analyst',
    line: 'Measured skeptic. Tests the thesis from the Claude note.',
  },
] as const

function voiceLabel(id: string) {
  if (!id) return ''
  return id.charAt(0).toUpperCase() + id.slice(1)
}

function bothReports(r: SavedReportRow) {
  return !!(r.generated_at && r.claude_generated_at)
}

function anyReport(r: SavedReportRow) {
  return !!(r.generated_at || r.claude_generated_at)
}

export function PodcastsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const roundupJob = useRef<string | null>(null)
  const scriptAnchor = useRef<HTMLDivElement>(null)
  const [reports, setReports] = useState<SavedReportRow[]>([])
  const [scripts, setScripts] = useState<PodcastScriptMeta[]>([])
  const [episodes, setEpisodes] = useState<PodcastEpisode[]>([])
  const [showId, setShowId] = useState<(typeof PODCAST_SHOWS)[number]['id']>('dga-hitech')
  const [feedCopied, setFeedCopied] = useState(false)
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
    episodeGuid?: string
    show?: string
    chapters?: { title: string; startTime: number }[]
    voiceUsed?: string
  } | null>(null)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [dropOver, setDropOver] = useState(false)
  const uploadInput = useRef<HTMLInputElement>(null)
  const [rate, setRate] = useState(() => {
    try {
      return parseFloat(localStorage.getItem('dga_podcast_rate') || '1') || 1
    } catch {
      return 1
    }
  })
  const audioRef = useRef<HTMLAudioElement>(null)
  const [savedAudioKey, setSavedAudioKey] = useState('')

  // ③ Cast
  const [voiceCfg, setVoiceCfg] = useState<VoiceConfig | null>(null)
  const [grokVoices, setGrokVoices] = useState<string[]>([])
  const [speedCfg, setSpeedCfg] = useState<SpeedConfig | null>(null)
  const [voiceStatus, setVoiceStatus] = useState('')
  const [speedStatus, setSpeedStatus] = useState('')
  const sampleRef = useRef<HTMLAudioElement>(null)
  const savedVoices = useRef<Record<string, string> | null>(null)

  useAnalysisScene(
    'podcast-script',
    scriptBusy,
    scriptProg?.label || 'Writing script…',
    scriptProg ? `${scriptProg.pct}%` : undefined,
  )
  useAnalysisScene(
    'podcast-audio',
    audioBusy,
    audioProg?.label || 'Mixing audio…',
    audioProg ? `${audioProg.pct}%` : undefined,
  )

  const refreshLists = useCallback(async () => {
    try {
      const [reps, sc, eps] = await Promise.all([
        api<SavedReportRow[]>('/api/reports').catch(() => []),
        api<{ scripts?: PodcastScriptMeta[] }>('/api/podcast/scripts').catch(() => ({
          scripts: [],
        })),
        api<{ episodes?: PodcastEpisode[] }>(
          `/api/podcast/list?show=${encodeURIComponent(showId)}`,
        ).catch(() => ({
          episodes: [],
        })),
      ])
      setReports(Array.isArray(reps) ? reps : [])
      setScripts(sc.scripts || [])
      setEpisodes(eps.episodes || [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load podcast data')
    }
  }, [showId])

  const loadVoiceSpeed = useCallback(async () => {
    try {
      const [v, s, listed] = await Promise.all([
        api<VoiceConfig>('/api/podcast/voice-config'),
        api<SpeedConfig>('/api/podcast/speed-config'),
        api<{ providers?: { provider: string; voices: string[] }[] }>(
          '/api/podcast/tts/voices',
        ).catch(() => ({ providers: [] })),
      ])
      setVoiceCfg(v)
      savedVoices.current = v.voices || null
      setSpeedCfg(s)
      const xai = (listed.providers || []).find((p) => p.provider === 'xai')
      setGrokVoices(xai?.voices?.length ? xai.voices : v.available || [])
    } catch {
      /* optional panels */
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      await Promise.all([refreshLists(), loadVoiceSpeed()])
      setBoot(false)
    })()
  }, [refreshLists, loadVoiceSpeed])

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
    const tk = String(sc.ticker || '')
    if (tk) {
      syncTk(tk)
      if (tk.startsWith('PORTFOLIO_')) setFormat('portfolio_roundup')
      else if (tk.startsWith('ROUNDUP_')) setFormat('roundup')
    }
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

  // Desk hands off with ?roundup=<job key>. Stay on this page and follow
  // that job until the script is on screen. A bare visit does not poll.
  useEffect(() => {
    const job = searchParams.get('roundup')
    if (!job) {
      roundupJob.current = null
      return
    }
    if (roundupJob.current === job) return
    roundupJob.current = job
    setFormat('portfolio_roundup')
    setErr(null)
    setScriptView(null)
    setScriptBusy(true)
    setScriptProg({ label: 'Portfolio Roundup started…', pct: 4 })
    window.setTimeout(() => {
      scriptAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
    void pollScriptStatus(job).finally(() => {
      if (roundupJob.current === job) roundupJob.current = null
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.delete('roundup')
        return next
      }, { replace: true })
    })
  }, [searchParams, setSearchParams])

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
    const listed = episodes.find(
      (item) => item.ticker === ticker && (item.format || 'debate') === fmt,
    )
    const audioUrl = status?.audio_url
    setPlayer({
      ticker,
      format: fmt,
      title: epTitle,
      meta: parts.length ? parts.join(' · ') : 'Ready',
      src: audioUrl
        ? `${audioUrl}${audioUrl.includes('?') ? '&' : '?'}t=${Date.now()}`
        : `/api/podcast/${encodeURIComponent(ticker)}/audio.mp3?format=${encodeURIComponent(fmt)}&t=${Date.now()}`,
      episodeGuid: status?.episode_guid || listed?.episode_guid || '',
      show: status?.show || listed?.show || showId,
      chapters: status?.chapters || listed?.chapters || [],
      voiceUsed: status?.voice_used || listed?.voice_used || '',
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
      await persistCast()
      const d = await api<{ ok?: boolean; error?: string }>(
        `/api/podcast/${encodeURIComponent(tk)}/generate?format=${encodeURIComponent(fmt)}`,
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
              setAudioProg(null)
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

  const episodeKey = (e: PodcastEpisode) =>
    e.episode_guid || `${e.ticker}::${e.format || 'debate'}`

  const loadSavedAudio = (raw: string) => {
    setSavedAudioKey(raw)
    if (!raw) return
    const ep = episodes.find((e) => episodeKey(e) === raw)
    if (!ep) return
    const fmt = ep.format || 'debate'
    syncTk(ep.ticker)
    showPlayer(ep.ticker, fmt, ep)
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

  const eraseEpisode = async (show: string, guid: string) => {
    if (!guid) return
    if (!window.confirm('Erase this episode? It leaves the feed.')) return
    try {
      await api(
        `/api/podcast/${encodeURIComponent(show)}/episodes/${encodeURIComponent(guid)}`,
        { method: 'DELETE' },
      )
      setPlayer(null)
      setSavedAudioKey('')
      void refreshLists()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erase failed')
    }
  }

  const uploadEpisode = async (file: File) => {
    setUploadBusy(true)
    setErr(null)
    try {
      const body = new FormData()
      body.append('file', file)
      await api(`/api/podcast/${encodeURIComponent(showId)}/episodes/upload`, {
        method: 'POST',
        body,
      })
      void refreshLists()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploadBusy(false)
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

  // ── Cast ───────────────────────────────────────────────────────
  const castPayload = () => {
    const voices = { ...(voiceCfg?.voices || {}) }
    if (voices.kimi) voices.opus = voices.kimi
    return voices
  }

  const persistCast = async () => {
    if (!voiceCfg?.voices) return
    const voices = castPayload()
    const prev = savedVoices.current
    const dirty =
      !prev ||
      CAST.some((c) => prev[c.key] !== voices[c.key]) ||
      prev.opus !== voices.opus
    if (!dirty) return
    const d = await api<VoiceConfig>('/api/podcast/voice-config', {
      method: 'POST',
      body: JSON.stringify({ voices }),
    })
    setVoiceCfg(d)
    savedVoices.current = d.voices || voices
    setVoiceStatus('Saved. The next episode uses this cast.')
  }

  const saveVoices = async () => {
    if (!voiceCfg?.voices) return
    setVoiceStatus('Saving…')
    try {
      const voices = castPayload()
      const d = await api<VoiceConfig>('/api/podcast/voice-config', {
        method: 'POST',
        body: JSON.stringify({ voices }),
      })
      setVoiceCfg(d)
      savedVoices.current = d.voices || voices
      setVoiceStatus('Saved. The next episode uses this cast.')
    } catch (e) {
      setVoiceStatus(e instanceof Error ? e.message : 'Failed')
    }
  }

  const setCastVoice = (speaker: string, voice: string) => {
    setVoiceCfg((cur) => {
      if (!cur) return cur
      const voices = { ...(cur.voices || {}), [speaker]: voice }
      if (speaker === 'kimi') voices.opus = voice
      return { ...cur, voices }
    })
    setVoiceStatus('')
  }

  const resetVoices = async () => {
    if (!confirm('Reset cast to defaults?')) return
    const d = await api<VoiceConfig>('/api/podcast/voice-config/reset', {
      method: 'POST',
    })
    setVoiceCfg(d)
    savedVoices.current = d.voices || null
    setVoiceStatus('Reset to Leo, Rex, and Ara.')
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

  const toggleRoundup = (tk: string) => {
    setRoundupSel((prev) => {
      const next = new Set(prev)
      if (next.has(tk)) next.delete(tk)
      else if (next.size < maxPick) next.add(tk)
      return next
    })
  }

  const feedUrl = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    return `${origin}/api/podcast/${showId}/rss.xml`
  }, [showId])

  const showEpisodes = useMemo(
    () => episodes.filter((e) => (e.show || 'dga-hitech') === showId),
    [episodes, showId],
  )

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
        <div>
          <h1 className={styles.h1}>Podcast studio</h1>
          <p className={styles.lede}>
            Write the script, cast Grok voices, then record. The feed stays with the show.
          </p>
        </div>
      </header>

      {err && (
        <div className={page.bannerErr}>
          {err}
          <button type="button" className={styles.dismiss} onClick={() => setErr(null)}>
            ×
          </button>
        </div>
      )}

      {/* ══ Show + feed ══ */}
      <section className={styles.pcCard}>
        <header className={styles.pcHead}>
          {showId === 'dga-hitech' ? 'DGA HiTech' : 'Systems Over Goals Daily'}
        </header>
        <div className={styles.showBar}>
          <div className={styles.showSwitch} role="tablist" aria-label="Podcast show">
            {PODCAST_SHOWS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={showId === s.id}
                className={showId === s.id ? styles.showBtnOn : styles.showBtn}
                onClick={() => setShowId(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className={styles.feedRow}>
            <span className={styles.feedLabel}>Feed</span>
            <code className={styles.feedUrl}>{feedUrl}</code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const text = feedUrl
                void navigator.clipboard.writeText(text).then(
                  () => {
                    setFeedCopied(true)
                    window.setTimeout(() => setFeedCopied(false), 1500)
                  },
                  () => setErr('Could not copy the feed URL'),
                )
              }}
            >
              {feedCopied ? 'Copied' : 'Copy feed'}
            </Button>
          </div>
          <p className={styles.pcDesc}>Spotify off. Apple off.</p>
          <div
            className={dropOver ? `${styles.dropZone} ${styles.dropZoneOn}` : styles.dropZone}
            role="button"
            tabIndex={0}
            aria-label="Drop an MP3 to add an episode"
            onClick={() => uploadInput.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                uploadInput.current?.click()
              }
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDropOver(true)
            }}
            onDragLeave={() => setDropOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDropOver(false)
              const file = e.dataTransfer.files?.[0]
              if (file) void uploadEpisode(file)
            }}
          >
            {uploadBusy ? 'Adding the episode…' : 'Drop an MP3 to add an episode'}
            <input
              ref={uploadInput}
              type="file"
              accept="audio/mpeg,.mp3"
              hidden
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void uploadEpisode(file)
                e.target.value = ''
              }}
            />
          </div>
        </div>

        {showId === 'systems-over-goals' && (
          <div className={styles.pcSection}>
            <SogdDaily
              episodes={showEpisodes}
              onErase={(guid) => void eraseEpisode(showId, guid)}
            />
          </div>
        )}

        {showId === 'dga-hitech' && (
        <>
        {/* ① Script */}
        <div className={styles.pcSection} ref={scriptAnchor}>
          <div className={styles.stepHead}>
            <span className={styles.stepNum}>1</span>
            <div>
              <div className={styles.pcTitle}>Script</div>
              <div className={styles.pcDesc}>
                Kimi hosts. Rock argues from the Grok note. Claudia argues from the Claude
                note. A company needs both reports.
              </div>
            </div>
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
              {scriptBusy ? 'Writing…' : 'Generate script'}
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

        {/* ② Cast */}
        <div className={styles.pcSection}>
          <div className={styles.stepHead}>
            <span className={styles.stepNum}>2</span>
            <div>
              <div className={styles.pcTitle}>Cast</div>
              <div className={styles.pcDesc}>
                Each character speaks with a Grok voice. Preview a line, then save.
                Recording uses the saved cast.
              </div>
            </div>
          </div>
          <audio ref={sampleRef} className={styles.sampleAudio} />
          {!voiceCfg ? (
            <Spinner />
          ) : (
            <>
              <div className={styles.castGrid}>
                {CAST.map((character) => {
                  const selected = voiceCfg.voices?.[character.key] || ''
                  const options = (grokVoices.length ? grokVoices : voiceCfg.available || [])
                  return (
                    <article key={character.key} className={styles.castCard}>
                      <div className={styles.castRole}>{character.role}</div>
                      <div className={styles.castName}>{character.name}</div>
                      <p className={styles.castLine}>{character.line}</p>
                      <label className={styles.field}>
                        <span>Grok voice</span>
                        <select
                          className={styles.select}
                          value={selected}
                          onChange={(e) => setCastVoice(character.key, e.target.value)}
                        >
                          {options.map((id) => (
                            <option key={id} value={id}>
                              {voiceLabel(id)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!selected}
                        onClick={() => void playSample(character.key, selected)}
                      >
                        Preview
                      </Button>
                    </article>
                  )
                })}
              </div>
              <div className={styles.cfgActions}>
                <Button size="sm" variant="primary" onClick={() => void saveVoices()}>
                  Save cast
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void resetVoices()}>
                  Reset
                </Button>
                <span className={styles.muted}>{voiceStatus}</span>
              </div>
            </>
          )}
          <details className={styles.details}>
            <summary>Pacing</summary>
            <div className={styles.detailsBody}>
              <p className={styles.pcDesc}>
                Intensity times each speaker’s baseline. The next recording uses the saved table.
              </p>
              {!speedCfg ? (
                <Spinner />
              ) : (
                <>
                  <div className={styles.tableWrap}>
                    <table className={styles.speedTable}>
                      <thead>
                        <tr>
                          <th>Speaker</th>
                          {(speedCfg.intensities || ['calm', 'normal', 'heated']).map((i) => (
                            <th key={i}>{i}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(speedCfg.speakers || Object.keys(speedCfg.speeds || []))
                          .filter((sp) => sp !== 'opus')
                          .map((sp) => (
                            <tr key={sp}>
                              <td>
                                <strong>{voiceLabel(sp)}</strong>
                              </td>
                              {(speedCfg.intensities || ['calm', 'normal', 'heated']).map(
                                (intensity) => (
                                  <td key={intensity}>
                                    <input
                                      type="number"
                                      step="0.05"
                                      min="0.85"
                                      max="1.2"
                                      className={styles.speedInput}
                                      value={speedCfg.speeds?.[sp]?.[intensity] ?? 1}
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
                      Save pacing
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => void resetSpeeds()}>
                      Reset
                    </Button>
                    <span className={styles.muted}>{speedStatus}</span>
                  </div>
                </>
              )}
            </div>
          </details>
        </div>

        {/* ③ Record */}
        <div className={styles.pcSection}>
          <div className={styles.stepHead}>
            <span className={styles.stepNum}>3</span>
            <div>
              <div className={styles.pcTitle}>Record</div>
              <div className={styles.pcDesc}>
                Mixes the open script with the saved cast, the music, and the compliance notice.
              </div>
            </div>
          </div>

          {voiceCfg && (
            <p className={styles.castNow}>
              {CAST.map(
                (c) => `${c.name} · ${voiceLabel(voiceCfg.voices?.[c.key] || '')}`,
              ).join('   ')}
            </p>
          )}

          <div className={styles.pcRow}>
            <label className={styles.field} style={{ flex: 1 }}>
              <span>Script</span>
              <select
                className={styles.select}
                value={audioTk ? `${audioTk}::${format}` : ''}
                onChange={(e) => {
                  const raw = e.target.value
                  if (!raw) {
                    syncTk('')
                    return
                  }
                  const [tk, fmt] = raw.split('::')
                  syncTk(tk)
                  setFormat((fmt as PodcastFormat) || 'debate')
                }}
              >
                <option value="">Open a script ({scripts.length})</option>
                {audioTk &&
                  !scripts.some(
                    (s) => s.ticker === audioTk && (s.format || 'debate') === format,
                  ) && (
                    <option value={`${audioTk}::${format}`}>
                      {displayTicker(audioTk)}
                    </option>
                  )}
                {scripts.map((s) => {
                  const fmtKey = s.format || 'debate'
                  return (
                    <option key={`${s.ticker}::${fmtKey}`} value={`${s.ticker}::${fmtKey}`}>
                      {displayTicker(s.ticker, s.title)}
                      {fmtKey !== 'debate' ? ` · ${fmtKey}` : ''}
                    </option>
                  )
                })}
              </select>
            </label>
            <Button
              variant="primary"
              disabled={audioBusy || !audioTk}
              onClick={() => void generateAudio()}
            >
              {audioBusy ? 'Recording…' : 'Record'}
            </Button>
          </div>

          <div className={styles.orRow}>
            <span className={styles.orLabel}>Library</span>
            <select
              className={styles.orSelect}
              value={savedAudioKey}
              onChange={(e) => loadSavedAudio(e.target.value)}
            >
              <option value="">Open a finished episode ({showEpisodes.length})</option>
              {showEpisodes.map((e) => {
                const fmt = e.format || 'debate'
                const key = episodeKey(e)
                return (
                  <option
                    key={key}
                    value={key}
                  >
                    {e.format === 'manual' && e.title ? e.title : displayTicker(e.ticker, e.title)}
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
                <div className={styles.playerTitle}>{player.title}</div>
                <button type="button" className={styles.playerBtn} onClick={() => void shareLink()}>
                  Share
                </button>
                <button
                  type="button"
                  className={styles.playerBtnDanger}
                  onClick={() => void deleteAudio()}
                >
                  Delete
                </button>
              </div>
              <ChapterPlayer
                audioRef={audioRef}
                src={player.src}
                chapters={player.chapters}
                voiceUsed={player.voiceUsed}
                onErase={
                  player.episodeGuid
                    ? () => void eraseEpisode(player.show || showId, player.episodeGuid || '')
                    : undefined
                }
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

        </>
        )}
      </section>

      {!episodes.length && !scripts.length && !reports.length && (
        <Empty
          title="No podcast data yet"
          sub="Generate a dual-engine report on the Desk, then create a script here."
        />
      )}
    </div>
  )
}
