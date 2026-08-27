import { Panel } from '@/components/ui/Panel'
import { Empty } from '@/components/ui/Empty'
import { fmtPct, fmtPx, fmtUsd, pctClass } from '@/lib/format'
import type { FundPosition } from './types'
import styles from './fund.module.css'

export function FundPositionsTable({ rows }: { rows: FundPosition[] }) {
  const totalMv = rows.reduce((s, p) => s + (p.market_value || 0), 0)
  if (!rows.length) {
    return (
      <Panel title="Open Positions">
        <Empty title="No positions yet" sub="Holdings load from SnapTrade after a broker sync." />
      </Panel>
    )
  }
  return (
    <Panel title="Open Positions" badge={`${rows.length} · ${fmtUsd(totalMv)}`} flush>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Symbol</th>
              <th className="tabular">Qty</th>
              <th className="tabular">Avg Cost</th>
              <th className="tabular">Last</th>
              <th className="tabular">Mkt Value</th>
              <th className="tabular">Unreal.</th>
              <th className="tabular">Weight</th>
            </tr>
          </thead>
          <tbody>
            {[...rows]
              .sort((a, b) => (b.market_value || 0) - (a.market_value || 0))
              .map((p, i) => {
                const curPct =
                  p.market_weight_pct != null
                    ? p.market_weight_pct
                    : p.market_value && totalMv > 0
                      ? (p.market_value / totalMv) * 100
                      : p.weight_pct
                return (
                  <tr key={`${p.symbol}-${i}`}>
                    <td>
                      <span className={styles.tk} title={p.name || ''}>
                        {p.symbol || '—'}
                      </span>
                      {(p.asset_class === 'cash' ||
                        (p.symbol || '').toUpperCase() === 'CASH') && (
                        <span className={styles.pill}>CASH</span>
                      )}
                    </td>
                    <td className="tabular">{(p.total_qty || 0).toFixed(2)}</td>
                    <td className="tabular">
                      {p.avg_cost != null ? fmtUsd(p.avg_cost, 2) : '—'}
                    </td>
                    <td className="tabular">{fmtPx(p.last_price)}</td>
                    <td className="tabular">{fmtUsd(p.market_value)}</td>
                    <td className={`tabular ${pctClass(p.unrealized_gain)}`}>
                      {p.unrealized_gain != null ? fmtUsd(p.unrealized_gain) : '—'}
                    </td>
                    <td className="tabular">
                      {curPct != null ? fmtPct(curPct, 1).replace('+', '') : '—'}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
