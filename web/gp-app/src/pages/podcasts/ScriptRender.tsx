import type { PodcastScript } from './types'
import styles from '../PodcastsPage.module.css'

const BUBBLE: Record<string, { bg: string; name: string; label: string }> = {
  opus: { bg: '#f1f5f9', name: '#0A1628', label: 'OPUS (host)' },
  rock: { bg: '#fef3c7', name: '#b45309', label: 'ROCK 🇬🇧 (Grok)' },
  claudia: { bg: '#fce7f3', name: '#9d174d', label: 'CLAUDIA (Claude)' },
  alec: { bg: '#f1f5f9', name: '#0A1628', label: 'OPUS (host)' },
  alex: { bg: '#f1f5f9', name: '#0A1628', label: 'OPUS (host)' },
  claude: { bg: '#fce7f3', name: '#9d174d', label: 'CLAUDIA (Claude)' },
}

const INTENSITY: Record<string, string> = {
  calm: '🔉',
  normal: '',
  heated: '🔥',
}

const DEBATE_BADGES: Record<string, { bg: string; fg: string; label: string }> = {
  debate: { bg: '#dbeafe', fg: '#1e40af', label: '⚔️ DEBATE' },
  stress_test: { bg: '#fef3c7', fg: '#92400e', label: '🔬 STRESS TEST' },
  devils_advocate: { bg: '#fce7f3', fg: '#9d174d', label: "😈 DEVIL'S ADVOCATE" },
  spread: { bg: '#e0f2fe', fg: '#075985', label: '📏 THE SPREAD' },
  mixed: { bg: '#f1f5f9', fg: '#475569', label: '❓ MIXED SIGNALS' },
}

const FORMAT_BADGES: Record<string, { bg: string; fg: string; label: string }> = {
  memo: { bg: '#dbeafe', fg: '#1e40af', label: '📋 INVESTMENT MEMO' },
  catalysts: { bg: '#fef3c7', fg: '#92400e', label: '📅 CATALYSTS CALENDAR' },
  pre_mortem: { bg: '#fee2e2', fg: '#991b1b', label: '🪦 PRE-MORTEM' },
  quick_hit: { bg: '#fef9c3', fg: '#854d0e', label: '⚡ QUICK HIT' },
  roundup: { bg: '#e0f2fe', fg: '#075985', label: '📰 ROUNDUP' },
  portfolio_roundup: { bg: '#f3e8ff', fg: '#6b21a8', label: '🧰 PORTFOLIO ROUNDUP' },
}

function titleDisplay(script: PodcastScript): string {
  const t = (script.episode_title || '').trim()
  if (t && !/^PORTFOLIO_\d+TICKERS_\d+$/i.test(t)) return t
  if ((script.ticker || '').startsWith('PORTFOLIO_')) {
    const n = (script.tickers || []).length
    return n ? `${n} Tickers · Portfolio Roundup` : 'Portfolio Roundup'
  }
  if ((script.ticker || '').startsWith('ROUNDUP_')) {
    return 'Roundup · ' + (script.ticker || '').replace('ROUNDUP_', '').split(',').join(' · ')
  }
  return script.ticker || 'Episode'
}

type Props = {
  script: PodcastScript
  warnings?: string[]
  daBrief?: string
  onMakeAudio?: (ticker: string, format: string) => void
  onRename?: (ticker: string, format: string, current: string) => void
  onDelete?: (ticker: string, format: string) => void
}

export function ScriptRender({
  script,
  warnings,
  daBrief,
  onMakeAudio,
  onRename,
  onDelete,
}: Props) {
  const title = titleDisplay(script)
  const fmt = (script.format || 'debate').toLowerCase()
  const align = script._alignment || {}
  const genIso = script.generated_at || ''
  let when = ''
  if (genIso) {
    const dd = new Date(genIso)
    if (!Number.isNaN(dd.getTime())) {
      const mo = dd.toLocaleString('en-US', { month: 'short' })
      const day = dd.getDate()
      const yr = dd.getFullYear()
      when =
        yr === new Date().getFullYear()
          ? `${mo} ${day}`
          : `${mo} ${day} '${String(yr).slice(-2)}`
    }
  }

  return (
    <div className={styles.scriptView}>
      <div className={styles.scriptHead}>
        <div className={styles.scriptTitle}>
          <span>{title}</span>
          {when && <span className={styles.whenPill}>📅 {when}</span>}
          {onRename && (
            <button
              type="button"
              className={styles.iconGhost}
              title="Rename"
              onClick={() =>
                onRename(script.ticker || '', fmt, title)
              }
            >
              ✏️
            </button>
          )}
        </div>
        <div className={styles.scriptActions}>
          {onMakeAudio && (
            <button
              type="button"
              className={styles.btnDark}
              onClick={() => onMakeAudio(script.ticker || '', fmt)}
            >
              🎧 Make audio →
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className={styles.btnDangerOutline}
              onClick={() => onDelete(script.ticker || '', fmt)}
            >
              🗑️
            </button>
          )}
        </div>
      </div>

      <div className={styles.modeLine}>
        {fmt === 'debate' ? (
          <>
            {(() => {
              const mb =
                DEBATE_BADGES[align.episode_mode || 'debate'] ||
                DEBATE_BADGES.debate
              return (
                <span
                  className={styles.modeBadge}
                  style={{ background: mb.bg, color: mb.fg }}
                >
                  {mb.label}
                </span>
              )
            })()}
            {align.bull_speaker && align.bear_speaker && (
              <span>
                Bull: <strong className="pos">{align.bull_speaker.toUpperCase()}</strong>
                {' · '}
                Bear: <strong className="neg">{align.bear_speaker.toUpperCase()}</strong>
              </span>
            )}
            <span>
              🏆 Winner: <strong>{(script.winner || '?').toUpperCase()}</strong>
            </span>
          </>
        ) : (
          (() => {
            const fb = FORMAT_BADGES[fmt] || {
              bg: '#f1f5f9',
              fg: '#475569',
              label: fmt.toUpperCase(),
            }
            return (
              <span
                className={styles.modeBadge}
                style={{ background: fb.bg, color: fb.fg }}
              >
                {fb.label}
              </span>
            )
          })()
        )}
      </div>

      {warnings && warnings.length > 0 && (
        <div className={styles.warnBox}>⚠ {warnings.join(' · ')}</div>
      )}

      {daBrief && (
        <div className={styles.daBrief}>
          <div className={styles.daHead}>😈 DEVIL&apos;S ADVOCATE BRIEF</div>
          <pre className={styles.daBody}>{daBrief}</pre>
        </div>
      )}

      {(script.sections || []).map((sec, si) => (
        <div key={si}>
          <div className={styles.secLabel}>
            {(sec.id || '').replace(/_/g, ' ').toUpperCase()}
          </div>
          {(sec.turns || []).map((t, ti) => {
            const c =
              BUBBLE[(t.speaker || '').toLowerCase()] || BUBBLE.opus
            const icon = INTENSITY[(t.intensity || 'normal').toLowerCase()] || ''
            return (
              <div
                key={ti}
                className={styles.bubble}
                style={{ background: c.bg }}
              >
                <div className={styles.bubbleSpk} style={{ color: c.name }}>
                  {c.label}
                  {icon ? ` ${icon}` : ''}
                </div>
                <div className={styles.bubbleText}>{t.text}</div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
