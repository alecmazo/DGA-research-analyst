import { Panel } from '@/components/ui/Panel'
import page from './page.module.css'

type Props = {
  kicker: string
  title: string
  sub: string
  bullets?: string[]
}

export function PlaceholderPage({ kicker, title, sub, bullets }: Props) {
  return (
    <div className={page.page}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>{kicker}</p>
          <h1 className={page.h1}>{title}</h1>
          <p className={page.sub}>{sub}</p>
        </div>
      </header>
      <Panel title="React migration" badge="Live shell">
        <div className={page.placeholder}>
          <p>
            This surface is mounted in the new React + TypeScript GP shell. Domain
            workflows continue to run on the Python FastAPI backend — next increments
            port interactive panels here with the same APIs.
          </p>
          {bullets && bullets.length > 0 && (
            <ul className={page.placeholderList}>
              {bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          <p>
            Prefer the polished Desk for live watchlist & pulse today. Legacy full
            terminal remains at{' '}
            <a href="/gp-legacy">/gp-legacy</a> during the cutover.
          </p>
        </div>
      </Panel>
    </div>
  )
}
