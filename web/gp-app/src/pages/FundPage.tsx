import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Empty, Spinner } from '@/components/ui/Empty'
import { api } from '@/lib/api'
import { fmtPct, fmtUsd, pctClass } from '@/lib/format'
import { LpDetail } from './fund/LpDetail'
import { ManagedDetail } from './fund/ManagedDetail'
import type {
  FundDetail,
  FundOverview,
  OverviewAcct,
  OverviewFund,
} from './fund/types'
import page from './page.module.css'
import styles from './fund/fund.module.css'

type Subtab = 'funds' | 'accts'

export function FundPage() {
  const [sub, setSub] = useState<Subtab>('accts')
  const [funds, setFunds] = useState<OverviewFund[]>([])
  const [accts, setAccts] = useState<OverviewAcct[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // Detail view
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<FundDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Inline NAV edit
  const [navOpen, setNavOpen] = useState<string | null>(null)
  const [navVal, setNavVal] = useState('')
  const [navDate, setNavDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [navBusy, setNavBusy] = useState(false)

  const loadOverview = useCallback(async () => {
    setErr(null)
    try {
      const d = await api<FundOverview>('/api/v2/lp/me/overview')
      setFunds(d.funds || [])
      setAccts(d.managed_accounts || [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load fund data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  const openDetail = async (fundId: string) => {
    setDetailLoading(true)
    setErr(null)
    try {
      const d = await api<FundDetail>(
        `/api/v2/gp/fund/${encodeURIComponent(fundId)}/detail`,
      )
      setDetail(d)
      setDetailId(fundId)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load detail')
    } finally {
      setDetailLoading(false)
    }
  }

  const submitNav = async (fundId: string, marketFallback?: number | null) => {
    setNavBusy(true)
    try {
      let amount: number | null = null
      const raw = navVal.trim()
      if (raw) {
        amount = Number(raw.replace(/[$,]/g, ''))
        if (Number.isNaN(amount)) throw new Error('Invalid NAV amount')
      } else if (marketFallback != null && marketFallback > 0) {
        amount = marketFallback
      } else {
        amount = 0
      }
      await api('/api/v2/gp/nav', {
        method: 'POST',
        body: JSON.stringify({
          fund_id: fundId,
          net_nav: amount,
          as_of_date: navDate,
        }),
      })
      setNavOpen(null)
      setNavVal('')
      await loadOverview()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'NAV save failed')
    } finally {
      setNavBusy(false)
    }
  }

  const purge = async (fundId: string, name: string) => {
    if (
      !confirm(
        `Permanently delete "${name}" and ALL its data?\n\nThis cannot be undone.`,
      )
    )
      return
    try {
      await api(`/api/v2/gp/fund/${encodeURIComponent(fundId)}/purge`, {
        method: 'DELETE',
      })
      if (detailId === fundId) {
        setDetailId(null)
        setDetail(null)
      }
      await loadOverview()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  if (detailId && detail) {
    const isAcct = detail.fund_type === 'managed_account'
    if (isAcct) {
      return (
        <ManagedDetail
          fundId={detailId}
          detail={detail}
          onBack={() => {
            setDetailId(null)
            setDetail(null)
            void loadOverview()
          }}
        />
      )
    }
    return (
      <LpDetail
        fundId={detailId}
        detail={detail}
        onBack={() => {
          setDetailId(null)
          setDetail(null)
          void loadOverview()
        }}
      />
    )
  }

  return (
    <div className={page.page}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Capital base</p>
          <h1 className={page.h1}>Accounts</h1>
          <p className={page.sub}>
            Managed accounts and LP funds — NAV, capital, and performance. Open a
            row for holdings, waterfall, attribution, and exports.
          </p>
        </div>
        <div className={styles.subtabs} role="tablist" aria-label="Account type">
          <button
            type="button"
            role="tab"
            aria-selected={sub === 'accts'}
            className={`${styles.subtab} ${sub === 'accts' ? styles.subtabOn : ''}`}
            onClick={() => setSub('accts')}
          >
            Managed <span className={styles.count}>{accts.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sub === 'funds'}
            className={`${styles.subtab} ${sub === 'funds' ? styles.subtabOn : ''}`}
            onClick={() => setSub('funds')}
          >
            LP Funds <span className={styles.count}>{funds.length}</span>
          </button>
        </div>
      </header>

      {err && <div className={page.bannerErr}>{err}</div>}
      {detailLoading && <Spinner label="Opening detail…" />}

      <div className={styles.kpiStrip}>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Managed accounts</div>
          <div className={styles.kpiVal}>{accts.length}</div>
          <div className={styles.kpiHint}>SMA / IRA books</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>LP Funds</div>
          <div className={styles.kpiVal}>{funds.length}</div>
          <div className={styles.kpiHint}>Active vehicles</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>View</div>
          <div className={styles.kpiVal}>{sub === 'accts' ? 'Managed' : 'Funds'}</div>
          <div className={styles.kpiHint}>Switch with the control above</div>
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading accounts…" />
      ) : sub === 'funds' ? (
        !funds.length ? (
          <Empty
            title="No LP funds yet"
            sub="Create one in Settings → Fund Administration."
          />
        ) : (
          <div className={styles.cardList}>
            {funds.map((f) => (
              <FundRow
                key={f.fund_id}
                name={f.fund_name || f.fund_id}
                badge={f.short_name || 'FUND'}
                nav={f.effective_nav ?? f.fund_nav}
                navSub={
                  f.fund_nav && f.fund_nav > 0 && f.fund_nav_as_of
                    ? `as of ${f.fund_nav_as_of}`
                    : f.market_nav && f.market_nav > 0
                      ? 'live market'
                      : 'no snapshot'
                }
                isAcct={false}
                lpCount={f.lp_count}
                committed={f.commitment}
                marketNav={f.market_nav}
                navOpen={navOpen === f.fund_id}
                navVal={navVal}
                navDate={navDate}
                navBusy={navBusy}
                onOpen={() => void openDetail(f.fund_id)}
                onToggleNav={() => {
                  setNavOpen((id) => (id === f.fund_id ? null : f.fund_id))
                  setNavVal('')
                }}
                onNavVal={setNavVal}
                onNavDate={setNavDate}
                onSaveNav={() => void submitNav(f.fund_id, f.market_nav)}
                onUseMarket={() => {
                  if (f.market_nav != null) setNavVal(String(f.market_nav))
                }}
                onPurge={() => void purge(f.fund_id, f.fund_name || f.fund_id)}
              />
            ))}
          </div>
        )
      ) : !accts.length ? (
        <Empty
          title="No managed accounts yet"
          sub="Create one in Settings → Fund Administration."
        />
      ) : (
        <div className={styles.cardList}>
          {accts.map((a) => {
            const usePos = a.ytd_pos_pct != null
            const ytd = usePos ? a.ytd_pos_pct : null
            return (
              <FundRow
                key={a.fund_id}
                name={a.account_name || a.fund_id}
                badge={a.short_name || 'SMA'}
                nav={a.nav}
                navSub={
                  a.nav_as_of
                    ? `as of ${a.nav_as_of}`
                    : a.market_nav && a.market_nav > 0
                      ? 'live market'
                      : 'no snapshot'
                }
                isAcct
                ytd={ytd}
                ytdLabel={usePos ? 'YTD · positions' : 'YTD'}
                marketNav={a.market_nav}
                navOpen={navOpen === a.fund_id}
                navVal={navVal}
                navDate={navDate}
                navBusy={navBusy}
                onOpen={() => void openDetail(a.fund_id)}
                onToggleNav={() => {
                  setNavOpen((id) => (id === a.fund_id ? null : a.fund_id))
                  setNavVal('')
                }}
                onNavVal={setNavVal}
                onNavDate={setNavDate}
                onSaveNav={() => void submitNav(a.fund_id, a.market_nav)}
                onUseMarket={() => {
                  if (a.market_nav != null) setNavVal(String(a.market_nav))
                }}
                onPurge={() => void purge(a.fund_id, a.account_name || a.fund_id)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function FundRow(props: {
  name: string
  badge: string
  nav?: number | null
  navSub: string
  isAcct: boolean
  lpCount?: number
  committed?: number | null
  ytd?: number | null
  ytdLabel?: string
  marketNav?: number | null
  navOpen: boolean
  navVal: string
  navDate: string
  navBusy: boolean
  onOpen: () => void
  onToggleNav: () => void
  onNavVal: (v: string) => void
  onNavDate: (v: string) => void
  onSaveNav: () => void
  onUseMarket: () => void
  onPurge: () => void
}) {
  return (
    <div className={`${styles.row} ${props.navOpen ? styles.rowNavOpen : ''}`}>
      <button type="button" className={styles.rowMain} onClick={props.onOpen}>
        <div className={styles.rowIdentity}>
          <div className={styles.rowName}>{props.name}</div>
          <span className={styles.rowBadge}>{props.badge}</span>
        </div>
        <div className={styles.rowMetrics}>
          <div className={styles.rowStat}>
            <span className={styles.rowStatLabel}>NAV</span>
            <span className={styles.rowStatVal}>{fmtUsd(props.nav)}</span>
            {props.navSub && props.navSub !== 'no snapshot' && (
              <span className={styles.rowStatSub}>{props.navSub}</span>
            )}
          </div>
          {props.isAcct && props.ytd != null && (
            <div className={styles.rowStat}>
              <span className={styles.rowStatLabel}>
                {props.ytdLabel || 'YTD'}
              </span>
              <span className={`${styles.rowStatVal} ${pctClass(props.ytd)}`}>
                {fmtPct(props.ytd)}
              </span>
            </div>
          )}
          {!props.isAcct && (
            <>
              <div className={styles.rowStat}>
                <span className={styles.rowStatLabel}>LPs</span>
                <span className={styles.rowStatVal}>{props.lpCount ?? '—'}</span>
              </div>
              <div className={styles.rowStat}>
                <span className={styles.rowStatLabel}>Committed</span>
                <span className={styles.rowStatVal}>
                  {fmtUsd(props.committed)}
                </span>
              </div>
            </>
          )}
        </div>
        <div className={styles.rowActions}>
          <span className={styles.view}>View →</span>
        </div>
      </button>
      <div className={styles.rowTools}>
        <button
          type="button"
          className={styles.iconBtn}
          title="Set NAV snapshot"
          onClick={(e) => {
            e.stopPropagation()
            props.onToggleNav()
          }}
        >
          ✎
        </button>
        <button
          type="button"
          className={styles.iconBtnDanger}
          title="Delete"
          onClick={(e) => {
            e.stopPropagation()
            props.onPurge()
          }}
        >
          ×
        </button>
      </div>
      {props.navOpen && (
        <div className={styles.navBar} onClick={(e) => e.stopPropagation()}>
          <span className={styles.navLbl}>NAV snapshot</span>
          <input
            className={styles.navInput}
            placeholder={props.nav != null ? fmtUsd(props.nav) : '0 = auto'}
            value={props.navVal}
            onChange={(e) => props.onNavVal(e.target.value)}
          />
          <input
            className={styles.navDate}
            type="date"
            value={props.navDate}
            onChange={(e) => props.onNavDate(e.target.value)}
          />
          <Button size="sm" variant="primary" disabled={props.navBusy} onClick={props.onSaveNav}>
            Save
          </Button>
          {props.marketNav != null && props.marketNav > 0 && (
            <Button size="sm" variant="secondary" onClick={props.onUseMarket}>
              ↺ {fmtUsd(props.marketNav)}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
