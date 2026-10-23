import { useCallback, useEffect, useState } from 'react'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import { AccountsPanel } from './AccountsPanel'
import styles from '../SettingsPage.module.css'

/* ── Fund admin ───────────────────────────────────────────────── */

function FundAdmin() {
  const [options, setOptions] = useState<
    Array<{ id: string; name: string; short: string; type: string }>
  >([])
  const [rnId, setRnId] = useState('')
  const [rnName, setRnName] = useState('')
  const [rnShort, setRnShort] = useState('')
  const [rnMsg, setRnMsg] = useState('')
  const [cfName, setCfName] = useState('')
  const [cfShort, setCfShort] = useState('')
  const [cfType, setCfType] = useState('lp_fund')
  const [cfInception, setCfInception] = useState('')
  const [cfMgmt, setCfMgmt] = useState('1.5')
  const [cfCarry, setCfCarry] = useState('20')
  const [cfHurdle, setCfHurdle] = useState('8')
  const [cfMsg, setCfMsg] = useState('')

  const loadOptions = useCallback(async () => {
    try {
      const d = await api<{
        funds?: Array<{ fund_id: string; fund_name?: string; short_name?: string }>
        managed_accounts?: Array<{
          fund_id: string
          account_name?: string
          short_name?: string
        }>
      }>('/api/v2/lp/me/overview')
      const all = [
        ...(d.funds || []).map((f) => ({
          id: f.fund_id,
          name: f.fund_name || '',
          short: f.short_name || '',
          type: 'LP Fund',
        })),
        ...(d.managed_accounts || []).map((a) => ({
          id: a.fund_id,
          name: a.account_name || '',
          short: a.short_name || '',
          type: 'Managed Acct',
        })),
      ]
      setOptions(all)
    } catch {
      setOptions([])
    }
  }, [])

  useEffect(() => {
    void loadOptions()
  }, [loadOptions])

  const onSelect = (id: string) => {
    setRnId(id)
    const opt = options.find((o) => o.id === id)
    setRnName(opt?.name || '')
    setRnShort(opt?.short || '')
  }

  const rename = async () => {
    if (!rnId) {
      setRnMsg('Select a fund or account first.')
      return
    }
    if (!rnName.trim()) {
      setRnMsg('Full name is required.')
      return
    }
    if (rnShort.trim().length < 2) {
      setRnMsg('Short code must be ≥ 2 characters.')
      return
    }
    try {
      await api(`/api/v2/gp/fund/${encodeURIComponent(rnId)}/rename`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: rnName.trim(),
          short_name: rnShort.trim().toUpperCase(),
        }),
      })
      setRnMsg(`✅ Renamed to "${rnName.trim()}" (${rnShort.trim().toUpperCase()})`)
      await loadOptions()
    } catch (e) {
      setRnMsg('Error: ' + (e instanceof Error ? e.message : e))
    }
  }

  const create = async () => {
    if (!cfName.trim()) {
      setCfMsg('Fund name is required.')
      return
    }
    if (cfShort.trim().length < 2) {
      setCfMsg('Short code must be at least 2 characters.')
      return
    }
    try {
      const d = await api<{ created?: boolean }>('/api/v2/gp/fund/create', {
        method: 'POST',
        body: JSON.stringify({
          name: cfName.trim(),
          short_name: cfShort.trim().toUpperCase(),
          fund_type: cfType,
          inception_date: cfInception || '',
          mgmt_fee_pct: parseFloat(cfMgmt || '1.5') / 100,
          carry_pct: parseFloat(cfCarry || '20') / 100,
          hurdle_pct: parseFloat(cfHurdle || '8') / 100,
        }),
      })
      setCfMsg(
        d.created
          ? `✅ Created "${cfName.trim()}" (${cfShort.trim().toUpperCase()})`
          : `✓ Already exists: ${cfName.trim()}`,
      )
      setCfName('')
      setCfShort('')
      await loadOptions()
    } catch (e) {
      setCfMsg('Error: ' + (e instanceof Error ? e.message : e))
    }
  }

  return (
    <CollapsibleCard title="Fund Administration" badge="GP ONLY" className={styles.span2} defaultOpen={false}>
      <div className={styles.assignHead}>Rename</div>
      <div className={styles.formGrid} style={{ marginBottom: 12 }}>
        <div>
          <div className={styles.fieldLabel}>Select</div>
          <select
            className={styles.select}
            value={rnId}
            onChange={(e) => onSelect(e.target.value)}
          >
            <option value="">— fund or account —</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                [{o.type}] {o.name} ({o.short})
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className={styles.fieldLabel}>Full name</div>
          <input
            className={styles.input}
            value={rnName}
            onChange={(e) => setRnName(e.target.value)}
          />
        </div>
        <div>
          <div className={styles.fieldLabel}>Code</div>
          <input
            className={styles.input}
            value={rnShort}
            maxLength={12}
            style={{ textTransform: 'uppercase' }}
            onChange={(e) => setRnShort(e.target.value)}
          />
        </div>
        <div>
          <Button size="sm" variant="secondary" onClick={() => void rename()}>
            Rename
          </Button>
          {rnMsg && <div style={{ fontSize: 10, marginTop: 4 }}>{rnMsg}</div>}
        </div>
      </div>
      <hr style={{ border: 'none', borderTop: '1px solid var(--border-subtle)', marginBottom: 10 }} />
      <div className={styles.assignHead}>Create new</div>
      <div className={styles.hint} style={{ marginBottom: 8 }}>
        Set NAV on Fund tab after creation. Fees entered as percents (1.5 → 0.015).
      </div>
      <div className={styles.formGrid}>
        <div>
          <div className={styles.fieldLabel}>Full name</div>
          <input
            className={styles.input}
            placeholder="DGA Capital Fund IV, LP"
            value={cfName}
            onChange={(e) => setCfName(e.target.value)}
          />
        </div>
        <div>
          <div className={styles.fieldLabel}>Code</div>
          <input
            className={styles.input}
            placeholder="DGAF-IV"
            maxLength={12}
            style={{ textTransform: 'uppercase' }}
            value={cfShort}
            onChange={(e) => setCfShort(e.target.value)}
          />
        </div>
        <div>
          <div className={styles.fieldLabel}>Type</div>
          <select
            className={styles.select}
            value={cfType}
            onChange={(e) => setCfType(e.target.value)}
          >
            <option value="lp_fund">LP Fund</option>
            <option value="managed_account">Managed Account</option>
          </select>
        </div>
        <div>
          <div className={styles.fieldLabel}>Inception</div>
          <input
            className={styles.input}
            type="date"
            value={cfInception}
            onChange={(e) => setCfInception(e.target.value)}
          />
        </div>
        <div>
          <div className={styles.fieldLabel}>Mgmt %</div>
          <input
            className={styles.input}
            type="number"
            step={0.1}
            min={0}
            max={5}
            value={cfMgmt}
            onChange={(e) => setCfMgmt(e.target.value)}
          />
        </div>
        <div>
          <div className={styles.fieldLabel}>Carry %</div>
          <input
            className={styles.input}
            type="number"
            step={1}
            min={0}
            max={50}
            value={cfCarry}
            onChange={(e) => setCfCarry(e.target.value)}
          />
        </div>
        <div>
          <div className={styles.fieldLabel}>Hurdle %</div>
          <input
            className={styles.input}
            type="number"
            step={0.5}
            min={0}
            max={20}
            value={cfHurdle}
            onChange={(e) => setCfHurdle(e.target.value)}
          />
        </div>
        <div>
          <Button size="sm" variant="primary" onClick={() => void create()}>
            Create
          </Button>
          {cfMsg && <div style={{ fontSize: 10, marginTop: 4 }}>{cfMsg}</div>}
        </div>
      </div>
    </CollapsibleCard>
  )
}

export function UsersSection() {
  return (
    <>
      <AccountsPanel />
      <FundAdmin />
    </>
  )
}
