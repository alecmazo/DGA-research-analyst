import type { ReactNode } from 'react'
import type { MetricHistPoint, RankCard, RankCards } from './types'
import { rankColor, rkFmt } from './format'
import { HistBars } from './Sparkline'
import styles from '../FinancialsPage.module.css'

function PctBar({
  pct,
  col,
  title,
}: {
  pct: number | null | undefined
  col?: string
  title?: string
}) {
  if (pct == null) {
    return <div className={styles.pctBarEmpty} title={title || 'No comparison data'} />
  }
  return (
    <div
      className={styles.pctBarTrack}
      title={`${title || ''} · ${pct}th pct`}
    >
      <div
        className={styles.pctBarFill}
        style={{
          width: `${Math.max(3, Math.min(100, pct))}%`,
          background: col || '#94a3b8',
        }}
      />
    </div>
  )
}

function RankCardView({
  c,
  peerMeta,
  footer,
}: {
  c?: RankCard
  peerMeta?: { peer_count?: number; peer_scope?: string }
  footer?: ReactNode
}) {
  if (!c || !(c.metrics || []).length) return null
  const rank = c.rank
  const rc = rankColor(rank)
  const peerN = c.peer_count != null ? c.peer_count : peerMeta?.peer_count
  const peerScope = c.peer_scope || peerMeta?.peer_scope
  const peerNote = peerN
    ? `Vs Industry uses ${peerN} ${peerScope || 'peer'} names in the store (≥3 required per metric; blank if not).`
    : 'Vs Industry blank — no industry/sector peers with financials in the store yet.'

  return (
    <div className={styles.rankCard}>
      <div className={styles.rankHead}>
        <span className={styles.rankTitle}>{c.title}</span>
        <span className={styles.rankHeadSpacer} />
        <div className={styles.rankTrack}>
          <div
            className={styles.rankFill}
            style={{
              width: `${rank == null ? 0 : Math.min(100, rank * 10)}%`,
              background: rc,
            }}
          />
        </div>
        <span className={styles.rankScore} style={{ color: rc }} title="Mean of available Rating (own-history) percentiles">
          {rank == null ? '—' : rank}
          <span className={styles.rankOf}>/10</span>
        </span>
      </div>
      <div className={styles.rankHint}>
        Rating = vs this company&apos;s own history · Vs Industry = vs store peers ·{' '}
        {peerNote}
      </div>
      <div className={styles.rankColHead}>
        <span>Name</span>
        <span className={styles.r}>Current</span>
        <span title="Percentile vs this company's ≤12 fiscal years">Rating</span>
        <span title="Percentile vs industry/sector peers — blank if &lt;3 peers">
          Vs Industry
        </span>
      </div>
      {(c.metrics || []).map((m, i) => {
        const ratePct = m.hist_pct != null ? m.hist_pct : null
        const indPct = m.ind_pct != null ? m.ind_pct : null
        const tip = [
          m.note,
          ratePct != null
            ? `Rating: ${ratePct}th pct of own history`
            : 'Rating: blank (need multi-year history for this metric)',
          indPct != null
            ? `Industry: ${indPct}th pct of peers`
            : 'Industry: blank (need ≥3 peers with this metric)',
        ]
          .filter(Boolean)
          .join(' · ')
        return (
          <div key={i} className={styles.rankRow} title={tip}>
            <span className={styles.rankMetricName}>{m.name}</span>
            <span className={`${styles.rankMetricVal} tabular`}>
              {rkFmt(m.value, m.fmt)}
            </span>
            <PctBar pct={ratePct} col={m.hist_color} title="Own-history rating" />
            <PctBar pct={indPct} col={m.ind_color} title="Vs industry peers" />
          </div>
        )
      })}
      {footer}
    </div>
  )
}

export function RankCardsView({
  rc,
  metricHistory,
}: {
  rc?: RankCards | null
  metricHistory?: Record<string, MetricHistPoint[]>
}) {
  if (!rc) return null
  const meta = { peer_scope: rc.peer_scope, peer_count: rc.peer_count }
  const mh = metricHistory || {}
  const vrHist = mh.dga_value_rank || []
  const scoreHist = mh.dga_score || []
  const useVr = vrHist.length >= 2
  const spark = (
    <HistBars
      series={useVr ? vrHist : scoreHist}
      title={useVr ? 'DGA Value Rank /10 over time' : 'DGA Score over time'}
    />
  )
  const valueFooter =
    spark && (
      <div className={styles.rankHistFooter}>
        <div className={styles.rankHistLbl}>
          {useVr ? 'Value Rank history' : 'DGA Score history'}
        </div>
        {spark}
      </div>
    )

  const fs = (
    <RankCardView c={rc.financial_strength} peerMeta={meta} />
  )
  const pr = <RankCardView c={rc.profitability} peerMeta={meta} />
  const va = (
    <RankCardView c={rc.value} peerMeta={meta} footer={valueFooter} />
  )
  if (!fs && !pr && !va) return null
  return (
    <div className={styles.rankGrid}>
      <div>{fs}</div>
      <div className={styles.rankSpan2}>{va}</div>
      <div>{pr}</div>
    </div>
  )
}
