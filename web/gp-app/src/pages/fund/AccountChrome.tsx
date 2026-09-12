import { Button } from '@/components/ui/Button'
import styles from './fund.module.css'

export type BookOption = {
  id: string
  label: string
  group: 'Managed' | 'LP Funds'
}

type DownloadKind = 'excel' | 'pdf' | 'word'

type Props = {
  backLabel: string
  onBack: () => void
  title: string
  currentId: string
  books?: BookOption[]
  onSelectBook?: (id: string) => void
  downloadBusy?: boolean
  onDownload?: (kind: DownloadKind) => void
  /** Formats offered. Word only when the API actually exists. */
  formats?: DownloadKind[]
}

export function AccountChrome({
  backLabel,
  onBack,
  title,
  currentId,
  books = [],
  onSelectBook,
  downloadBusy,
  onDownload,
  formats = ['excel', 'pdf'],
}: Props) {
  const managed = books.filter((b) => b.group === 'Managed')
  const funds = books.filter((b) => b.group === 'LP Funds')
  const showSwitch = books.length > 1 && typeof onSelectBook === 'function'

  return (
    <div className={styles.toolbar}>
      <Button variant="secondary" size="sm" onClick={onBack}>
        {backLabel}
      </Button>
      {showSwitch && (
        <select
          className={styles.pull}
          value={currentId}
          aria-label="Switch account"
          title="Open another account"
          onChange={(e) => onSelectBook(e.target.value)}
        >
          {managed.length ? (
            <optgroup label="Managed accounts">
              {managed.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </optgroup>
          ) : null}
          {funds.length ? (
            <optgroup label="LP funds">
              {funds.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      )}
      <h2 className={styles.detailTitle}>{title}</h2>
      {onDownload && formats.length ? (
        <div className={styles.toolbarRight}>
          <select
            className={styles.pull}
            value=""
            disabled={downloadBusy}
            aria-label="Download"
            onChange={(e) => {
              const v = e.target.value as DownloadKind
              e.currentTarget.value = ''
              if (v) onDownload(v)
            }}
          >
            <option value="" disabled>
              {downloadBusy ? 'Download…' : 'Download'}
            </option>
            {formats.includes('excel') && <option value="excel">Excel</option>}
            {formats.includes('pdf') && <option value="pdf">PDF</option>}
            {formats.includes('word') && <option value="word">Word</option>}
          </select>
        </div>
      ) : null}
    </div>
  )
}
