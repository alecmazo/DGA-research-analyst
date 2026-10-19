import { useMemo, type KeyboardEvent, type ReactNode } from 'react'
import styles from './DataTable.module.css'

export type DataColumn<T> = {
  id: string
  label: string
  sort?: string
  align?: 'left' | 'right'
  numeric?: boolean
  hideable?: boolean
  render: (row: T) => ReactNode
}

type Props<T> = {
  rows: T[]
  columns: DataColumn<T>[]
  rowKey: (row: T) => string
  sort?: string
  onSort?: (sort: string) => void
  selectedId?: string
  onSelect?: (row: T) => void
  hidden?: string[]
  onHiddenChange?: (ids: string[]) => void
  empty?: ReactNode
  footer?: ReactNode
}

function activeSort(sort: string | undefined) {
  const first = (sort || '').split(',')[0] || ''
  if (first.startsWith('-')) return { key: first.slice(1), desc: true }
  return { key: first, desc: false }
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  sort,
  onSort,
  selectedId,
  onSelect,
  hidden = [],
  onHiddenChange,
  empty,
  footer,
}: Props<T>) {
  const visible = useMemo(
    () => columns.filter((col) => !hidden.includes(col.id)),
    [columns, hidden],
  )
  const current = activeSort(sort)
  const hideable = columns.filter((col) => col.hideable !== false)

  const onKey = (event: KeyboardEvent<HTMLTableElement>) => {
    if (!onSelect || !rows.length) return
    const index = rows.findIndex((row) => rowKey(row) === selectedId)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const next = rows[Math.min(index + 1, rows.length - 1)] || rows[0]
      onSelect(next)
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      const prev = rows[Math.max(index - 1, 0)] || rows[0]
      onSelect(prev)
    }
    if (event.key === 'Enter' && index >= 0) {
      event.preventDefault()
      onSelect(rows[index])
    }
  }

  const toggleSort = (key: string) => {
    if (!onSort) return
    if (current.key === key) onSort(current.desc ? key : `-${key}`)
    else onSort(`-${key}`)
  }

  const toggleHidden = (id: string) => {
    if (!onHiddenChange) return
    onHiddenChange(hidden.includes(id) ? hidden.filter((item) => item !== id) : [...hidden, id])
  }

  return (
    <div className={styles.wrap}>
      {onHiddenChange && (
        <details className={styles.chooser}>
          <summary>Columns</summary>
          <div className={styles.menu}>
            {hideable.map((col) => (
              <label key={col.id}>
                <input
                  type="checkbox"
                  checked={!hidden.includes(col.id)}
                  onChange={() => toggleHidden(col.id)}
                />
                {col.label}
              </label>
            ))}
          </div>
        </details>
      )}
      <table className={styles.table} tabIndex={0} onKeyDown={onKey} aria-label="Deals">
        <thead>
          <tr>
            {visible.map((col) => (
              <th key={col.id} className={col.align === 'right' || col.numeric ? styles.right : undefined}>
                {col.sort && onSort ? (
                  <button type="button" className={styles.sort} onClick={() => toggleSort(col.sort || col.id)}>
                    {col.label}
                    {current.key === col.sort ? (current.desc ? ' ↓' : ' ↑') : ''}
                  </button>
                ) : (
                  col.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const id = rowKey(row)
            return (
              <tr
                key={id}
                className={styles.row}
                data-selected={selectedId === id ? '1' : '0'}
                onClick={() => onSelect?.(row)}
              >
                {visible.map((col) => (
                  <td
                    key={col.id}
                    className={`${col.align === 'right' || col.numeric ? styles.right : ''} ${col.numeric ? styles.num : ''}`}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            )
          })}
          {!rows.length && (
            <tr>
              <td colSpan={Math.max(visible.length, 1)}>{empty || 'No deals.'}</td>
            </tr>
          )}
        </tbody>
      </table>
      {footer}
    </div>
  )
}
