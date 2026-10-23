import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { api } from '@/lib/api'
import { ollamaChat, ollamaStatus, shortModelLabel } from '@/lib/localOllama'
import styles from '../MemosPage.module.css'
import { WriterModelSelect, writerPayload, type WriterOption } from './WriterModelSelect'

type Audience = { id: string; label: string; blurb?: string }
type Fund = {
  fund_id: string
  name?: string
  short_name?: string
  has_positions?: boolean
  has_attribution?: boolean
}
type LetterRow = { id: string; title?: string; status?: string; updated_at?: string | null; fund_name?: string }

const FALLBACK_AUDIENCES: Audience[] = [
  { id: 'retiree', label: 'Retiree', blurb: 'Someone living on this account.' },
  { id: 'school', label: 'School', blurb: 'A school that depends on this account.' },
  { id: 'principal', label: 'Family principal', blurb: 'The family principal who owns this capital.' },
  { id: 'foundation', label: 'Foundation', blurb: 'A foundation board.' },
  { id: 'trustee', label: 'Trustee', blurb: 'A trustee of this account.' },
]

function fundLabel(f: Fund) {
  return f.short_name || f.name || f.fund_id
}

function downloadLetter(title: string, body: string) {
  const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${title.replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '') || 'client-letter'}.md`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

type Props = {
  model: string
  modelLabel: string
  options: WriterOption[]
  onModel: (value: string) => void
  contextFundId?: string
}

export function ClientLetterPanel({ model, modelLabel, options, onModel, contextFundId }: Props) {
  const [audiences, setAudiences] = useState<Audience[]>(FALLBACK_AUDIENCES)
  const [audience, setAudience] = useState('')
  const [funds, setFunds] = useState<Fund[]>([])
  const [fundsLoaded, setFundsLoaded] = useState(false)
  const [fundId, setFundId] = useState('')
  const [picked, setPicked] = useState(false)
  const [body, setBody] = useState('')
  const [letterId, setLetterId] = useState<string | null>(null)
  const [fundName, setFundName] = useState('')
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState('Choose an audience, then the account this letter is about.')
  const [mailOn, setMailOn] = useState(false)
  const [mailDetail, setMailDetail] = useState('Mailing is not connected. The letter is saved. Copy it or download it.')
  const [gammaOn, setGammaOn] = useState(false)
  const [gammaDetail, setGammaDetail] = useState(
    'Presentation path is waiting on the Gamma key this server uses for research decks. The letter stands on its own.',
  )
  const [gammaUrl, setGammaUrl] = useState('')
  const [saved, setSaved] = useState<LetterRow[]>([])

  useEffect(() => {
    let alive = true
    void api<{
      audiences?: Audience[]
      mail_connected?: boolean
      mail_detail?: string
      presentation_connected?: boolean
      presentation_detail?: string
    }>('/api/client-letter/status')
      .then((data) => {
        if (!alive) return
        if (data.audiences?.length) setAudiences(data.audiences)
        setMailOn(!!data.mail_connected)
        if (data.mail_detail) setMailDetail(data.mail_detail)
        setGammaOn(!!data.presentation_connected)
        if (data.presentation_detail) setGammaDetail(data.presentation_detail)
      })
      .catch(() => {
        /* the menu still has the five audiences */
      })
    void api<{ funds?: Fund[] }>('/api/quarterly-letter/funds')
      .then((data) => {
        if (!alive) return
        setFunds(
          (data.funds || []).filter(
            (f) => f.fund_id && (f.has_positions || f.has_attribution),
          ),
        )
        setFundsLoaded(true)
      })
      .catch(() => {
        if (!alive) return
        setFunds([])
        setFundsLoaded(true)
      })
    void api<{ letters?: LetterRow[] }>('/api/client-letter/list')
      .then((data) => {
        if (alive) setSaved(data.letters || [])
      })
      .catch(() => {
        if (alive) setSaved([])
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (picked || !contextFundId) return
    setFundId(contextFundId)
  }, [contextFundId, picked])

  const audienceRow = audiences.find((row) => row.id === audience) || null
  const fund = funds.find((row) => row.fund_id === fundId) || null
  const step = busy ? 4 : body.trim() ? 5 : fundId && audience && model ? 4 : fundId && audience ? 3 : fundId ? 2 : audience ? 2 : 1

  async function reloadSaved() {
    try {
      const data = await api<{ letters?: LetterRow[] }>('/api/client-letter/list')
      setSaved(data.letters || [])
    } catch {
      /* the letter on screen still stands */
    }
  }

  async function persist(text: string, id: string | null, name: string): Promise<string | null> {
    const savedRow = await api<{ ok?: boolean; id?: string; error?: string; stored?: boolean }>(
      '/api/client-letter/save',
      {
        method: 'POST',
        body: JSON.stringify({
          id,
          fund_id: fundId,
          fund_name: name,
          audience,
          model: modelLabel || model,
          body: text,
        }),
      },
    )
    if (!savedRow.ok || !savedRow.id || savedRow.stored === false) {
      throw new Error(savedRow.error || 'Could not save the letter')
    }
    setLetterId(savedRow.id)
    return savedRow.id
  }

  async function write() {
    if (!audience) {
      setStatus('Choose an audience.')
      return
    }
    if (!fundId) {
      setStatus('Choose an account.')
      return
    }
    const payload = writerPayload(model)
    if (!payload) {
      setStatus('Choose a model.')
      return
    }
    const name = fund ? fundLabel(fund) : fundName || 'This account'
    setBusy('write')
    setGammaUrl('')
    setStatus(`Writing for ${name} with ${modelLabel || 'the model you picked'}.`)
    try {
      if (payload.llm_provider === 'local') {
        const localName = payload.local_model || ''
        const health = await ollamaStatus(localName)
        if (!health.ok) throw new Error(health.message)
        const prep = await api<{
          ok?: boolean
          local?: boolean
          system?: string
          user?: string
          fund_name?: string
          error?: string
        }>('/api/client-letter/draft', {
          method: 'POST',
          body: JSON.stringify({ fund_id: fundId, audience, year: new Date().getFullYear(), ...payload }),
        })
        if (!prep.ok || !prep.user) throw new Error(prep.error || 'Could not prepare the letter')
        const chat = await ollamaChat({
          system: prep.system || '',
          user: prep.user,
          model: localName,
          maxTokens: 2200,
        })
        const text = (chat.text || '').trim()
        if (!text) throw new Error(`${shortModelLabel(localName)} returned an empty letter.`)
        setBody(text)
        setFundName(prep.fund_name || name)
        const id = await persist(text, null, prep.fund_name || name)
        setStatus(id ? 'Saved. It goes out when you press Send.' : 'The letter is on screen.')
      } else {
        const drafted = await api<{
          ok?: boolean
          id?: string
          body?: string
          fund_name?: string
          emailed?: boolean
          stored?: boolean
          error?: string
        }>('/api/client-letter/draft', {
          method: 'POST',
          body: JSON.stringify({ fund_id: fundId, audience, year: new Date().getFullYear(), ...payload }),
        })
        if (!drafted.ok || !drafted.body) throw new Error(drafted.error || 'The model returned an empty letter.')
        setBody(drafted.body)
        setLetterId(drafted.id || null)
        setFundName(drafted.fund_name || name)
        setStatus(
          drafted.stored === false
            ? (drafted.error || 'The letter is on screen. It did not save.')
            : 'Saved. It goes out when you press Send.',
        )
      }
      void reloadSaved()
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'The letter stopped.')
    } finally {
      setBusy('')
    }
  }

  async function save() {
    const text = body.trim()
    if (!text) {
      setStatus('Write the letter first.')
      return
    }
    if (!audience || !fundId) {
      setStatus('Choose an audience and an account.')
      return
    }
    setBusy('save')
    try {
      const name = fund ? fundLabel(fund) : fundName
      await persist(text, letterId, name)
      setStatus('Saved. It goes out when you press Send.')
      void reloadSaved()
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy('')
    }
  }

  async function send() {
    if (!mailOn) {
      setStatus(mailDetail)
      return
    }
    setBusy('send')
    try {
      let id = letterId
      if (!id) {
        if (!body.trim()) throw new Error('Write the letter first.')
        id = await persist(body.trim(), null, fund ? fundLabel(fund) : fundName)
      } else if (body.trim()) {
        id = await persist(body.trim(), id, fund ? fundLabel(fund) : fundName)
      }
      if (!id) throw new Error('Save the letter first.')
      const sent = await api<{ ok?: boolean; sent?: number; detail?: string; fallback?: boolean }>(
        `/api/client-letter/${encodeURIComponent(id)}/send`,
        { method: 'POST', body: '{}' },
      )
      if (!sent.ok) throw new Error(sent.detail || 'The letter stayed on the desk.')
      const who = sent.fallback ? 'You have the letter. This account has no investor login.' : `Sent to ${sent.sent || 0}.`
      setStatus(who)
      void reloadSaved()
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Send stopped.')
    } finally {
      setBusy('')
    }
  }

  async function copy() {
    const text = body.trim()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setStatus('Copied.')
    } catch {
      setStatus('Select the letter and copy it from the page.')
    }
  }

  async function present() {
    if (!gammaOn) {
      setStatus(gammaDetail)
      return
    }
    setBusy('gamma')
    setStatus('Building the presentation.')
    try {
      let id = letterId
      if (!id) {
        if (!body.trim()) throw new Error('Save the letter first.')
        id = await persist(body.trim(), null, fund ? fundLabel(fund) : fundName)
      }
      if (!id) throw new Error('Save the letter first.')
      const started = await api<{ ok?: boolean; connected?: boolean; generation_id?: string; detail?: string; error?: string }>(
        `/api/client-letter/${encodeURIComponent(id)}/presentation`,
        { method: 'POST', body: '{}' },
      )
      if (!started.connected) {
        setStatus(started.detail || gammaDetail)
        return
      }
      if (!started.ok || !started.generation_id) throw new Error(started.error || started.detail || 'The presentation did not start.')
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        const polled = await api<{ ok?: boolean; status?: string; gamma_url?: string; error?: string }>(
          `/api/client-letter/${encodeURIComponent(id)}/presentation`,
        )
        if (polled.gamma_url) {
          setGammaUrl(polled.gamma_url)
          setStatus('The presentation is ready.')
          return
        }
        if (polled.status === 'failed') throw new Error(polled.error || 'The presentation stopped.')
      }
      setStatus('The presentation is still building. Open it from Gamma in a minute.')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'The presentation stopped.')
    } finally {
      setBusy('')
    }
  }

  async function openSaved(id: string) {
    try {
      const data = await api<{ letter?: { id: string; body?: string; audience?: string; fund_id?: string; fund_name?: string; gamma_url?: string } }>(
        `/api/client-letter/${encodeURIComponent(id)}`,
      )
      const letter = data.letter
      if (!letter) return
      setLetterId(letter.id)
      setBody(letter.body || '')
      if (letter.audience) setAudience(letter.audience)
      if (letter.fund_id) {
        setFundId(letter.fund_id)
        setPicked(true)
      }
      setFundName(letter.fund_name || '')
      setGammaUrl(letter.gamma_url || '')
      setStatus('Loaded the saved letter.')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not open the letter')
    }
  }

  const steps = ['Audience', 'Account', 'Model', 'Write', 'Read', 'Send']

  return (
    <Panel title="Client letter" badge="market · this account">
      <div className={styles.flowBar}>
        <ol className={styles.flowSteps} aria-label="How a client letter is written">
          {steps.map((label, i) => (
            <li key={label} className={step === i + 1 ? styles.flowNow : undefined}>
              {i + 1} {label}
            </li>
          ))}
        </ol>
        <WriterModelSelect model={model} options={options} onChange={onModel} disabled={!!busy} />
      </div>
      <p className={styles.editorSub}>
        One audience for this letter. The market story stays tied to the account you pick.
      </p>
      <div className={status.startsWith('Choose') || status.includes('stopped') || status.includes('empty') ? styles.statusBad : styles.status}>
        {status}
      </div>
      <div className={styles.letterDesk}>
        <nav className={styles.rail} aria-label="Audience and account">
          <label className={styles.modelPick}>
            <span className={styles.modelLbl}>Audience</span>
            <select
              className={styles.select}
              aria-label="Audience"
              value={audience}
              disabled={!!busy}
              onChange={(e) => setAudience(e.target.value)}
            >
              <option value="">Choose an audience</option>
              {audiences.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
          {audienceRow?.blurb && <p className={styles.railMeta}>{audienceRow.blurb}</p>}
          <div className={styles.railLabel}>Account</div>
          {!fundsLoaded ? (
            <div className={styles.muted}>Loading accounts…</div>
          ) : !funds.length ? (
            <div className={styles.muted}>Accounts with holdings show up here.</div>
          ) : (
            funds.map((row) => (
              <button
                key={row.fund_id}
                type="button"
                className={fundId === row.fund_id ? styles.railOn : styles.railBtn}
                onClick={() => {
                  setPicked(true)
                  setFundId(row.fund_id)
                  setFundName(fundLabel(row))
                }}
              >
                <span className={styles.railName}>{fundLabel(row)}</span>
              </button>
            ))
          )}
        </nav>
        <div className={styles.editor}>
          <div className={styles.editorHead}>
            <div>
              <div className={styles.editorTitle}>
                {fund ? fundLabel(fund) : fundName || 'Pick an account'}
                {audienceRow ? ` · ${audienceRow.label}` : ''}
              </div>
              <div className={styles.editorSub}>
                {modelLabel ? `${modelLabel} writes this letter.` : 'Choose a model, then write.'}
              </div>
            </div>
            <div className={styles.editorActions}>
              <Button size="sm" variant="primary" disabled={!!busy || !audience || !fundId || !model} onClick={() => void write()}>
                {busy === 'write' ? 'Writing…' : 'Write'}
              </Button>
              <Button size="sm" disabled={!!busy || !body.trim()} onClick={() => void save()}>
                {busy === 'save' ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
          <textarea
            className={`${styles.textarea} ${styles.editorTa}`}
            rows={16}
            aria-label="Client letter"
            placeholder="The letter lands here. Edit it, then save or send."
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className={styles.editorActions}>
            <Button size="sm" variant="primary" disabled={!!busy || !body.trim() || !mailOn} title={mailDetail} onClick={() => void send()}>
              {busy === 'send' ? 'Sending…' : 'Send'}
            </Button>
            <Button size="sm" disabled={!body.trim()} onClick={() => void copy()}>
              Copy
            </Button>
            <Button
              size="sm"
              disabled={!body.trim()}
              onClick={() => downloadLetter(fund ? `client-letter-${fundLabel(fund)}` : 'client-letter', body)}
            >
              Download
            </Button>
            <Button size="sm" disabled={!!busy || !body.trim() || !gammaOn} title={gammaDetail} onClick={() => void present()}>
              {busy === 'gamma' ? 'Building…' : 'Make this a presentation'}
            </Button>
          </div>
          <p className={styles.editorSub}>{mailDetail}</p>
          <p className={styles.editorSub}>{gammaDetail}</p>
          {gammaUrl && (
            <p className={styles.editorSub}>
              <a href={gammaUrl} target="_blank" rel="noopener noreferrer">Open the presentation</a>
            </p>
          )}
        </div>
      </div>
      <div className={styles.draftsHead}>Saved letters</div>
      {!saved.length ? (
        <div className={styles.muted}>No saved letters yet.</div>
      ) : (
        saved.map((row) => (
          <div
            key={row.id}
            className={styles.draftRow}
            role="button"
            tabIndex={0}
            onClick={() => void openSaved(row.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') void openSaved(row.id)
            }}
          >
            <span>
              {row.title || row.fund_name || row.id}{' '}
              <span className={styles.draftMeta}>
                · {row.status || 'draft'} · {(row.updated_at || '').slice(0, 16).replace('T', ' ')}
              </span>
            </span>
          </div>
        ))
      )}
    </Panel>
  )
}
