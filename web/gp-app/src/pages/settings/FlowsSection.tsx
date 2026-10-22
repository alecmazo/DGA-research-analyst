import { LoadFlowCard } from '@/components/desk/LoadFlowCard'
import { RepoFlowCard } from '@/components/desk/RepoFlowCard'
import styles from './FlowsSection.module.css'

const REQUEST = [
  {
    title: 'Browser',
    body: 'portfolio.dgacapital.com. The GP shell is /gp. The sign-in token stays in this browser.',
  },
  {
    title: 'Railway web',
    body: 'One service. Nixpacks starts uvicorn. It serves the committed /gp build. Traffic waits for /health.',
  },
  {
    title: 'API',
    body: 'api/server.py plus the domain modules. One process, one office.',
  },
  {
    title: 'Data',
    body: 'Postgres holds the books, filings store, and notes. Quotes and headlines come from Yahoo. Filings come from EDGAR.',
  },
]

const SHIP = [
  { title: 'Edit', body: 'On this Mac, on main.' },
  { title: 'Build', body: 'npm run build in web/gp-app. Railway has no Node, so dist is committed.' },
  { title: 'Push', body: 'git push main. That deploys service web only.' },
  { title: 'Confirm', body: 'GET /api/build matches WEB_BUILD_VERSION. Postgres is not redeployed.' },
]

const FIXES: { done?: boolean; body: string }[] = [
  {
    body: 'Split the rest of api/server.py. It is about 46,000 lines and 361 routes. New work goes in a domain module, the way credit and the local model already do.',
  },
  {
    done: true,
    body: 'The desk shell is its own chunk. The city scene, gurus, and podcasts load in their own chunks.',
  },
  {
    body: 'Give Railway a Node build so the deploy builds the hashed files. Until then, every UI change commits dist.',
  },
  {
    done: true,
    body: 'A second office is a name in family_offices plus its own database.',
  },
  {
    done: true,
    body: 'Model engines are in Settings.',
  },
  {
    body: 'Move the office name and logo into settings. The same build runs for DGA and the next office. DGA stays the first office on that build.',
  },
  {
    done: true,
    body: 'Pandas, Yahoo, and EDGAR load on first use. A read path can answer before those libraries load. The health check still allows 300 seconds.',
  },
  {
    done: true,
    body: 'Ollama stays on this Mac at 127.0.0.1:11434. The production server leaves that socket on this Mac. The local-model page and the on-Mac assistant appear when this browser can reach Ollama or the local helper.',
  },
]

export function FlowsSection() {
  return (
    <div className={styles.wrap}>
      <section className={styles.block}>
        <h2>Production</h2>
        <p className={styles.lead}>
          How this site runs today, and the order of work before a second family office uses the same codebase.
        </p>

        <h3>A request</h3>
        <ol className={styles.lane}>
          {REQUEST.map((step, i) => (
            <li key={step.title}>
              {i > 0 && <span className={styles.arrow} aria-hidden="true">→</span>}
              <div className={styles.step}>
                <strong>{step.title}</strong>
                <span>{step.body}</span>
              </div>
            </li>
          ))}
        </ol>
        <p className={styles.note}>
          Local models stay on this Mac. The browser talks to Ollama at 127.0.0.1:11434.
        </p>

        <h3>A ship</h3>
        <ol className={styles.lane}>
          {SHIP.map((step, i) => (
            <li key={step.title}>
              {i > 0 && <span className={styles.arrow} aria-hidden="true">→</span>}
              <div className={styles.step}>
                <strong>{step.title}</strong>
                <span>{step.body}</span>
              </div>
            </li>
          ))}
        </ol>
        <p className={styles.note}>
          Sliw deploys only when the commit touches apps/sliw-agent, railway.toml, nixpacks.toml, the Procfile, or requirements.txt.
        </p>

        <h3>A second office</h3>
        <div className={styles.split}>
          <div className={styles.step}>
            <strong>Today</strong>
            <span>
              One deploy serves DGA from this database. A second office is a name in family_offices plus its own database. DGA's name and logo are written into the pages. A second login on this database sees these books and notes.
            </span>
          </div>
          <div className={styles.step}>
            <strong>Later</strong>
            <span>
              The same repository. The office name and logo move into settings. DGA takes that build first. One codebase serves every office.
            </span>
          </div>
        </div>

        <h3>Fix in this order</h3>
        <ol className={styles.fixes}>
          {FIXES.map((step) => (
            <li key={step.body} className={step.done ? styles.done : undefined}>
              {step.done ? <span className={styles.doneMark}>✓ Done</span> : null}
              {step.body}
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.block}>
        <h2>Load flow</h2>
        <p className={styles.lead}>
          Calls this browser has made since the page opened. Green has loaded, yellow is in flight, red failed, hollow has not started.
        </p>
        <div className={styles.well}>
          <LoadFlowCard />
        </div>
      </section>

      <section className={styles.block}>
        <h2>Repo flow</h2>
        <p className={styles.lead}>
          The same calls, grouped by folder on main. A branch moves while a call is in that folder.
        </p>
        <div className={`${styles.well} ${styles.repoWell}`}>
          <RepoFlowCard />
        </div>
      </section>
    </div>
  )
}
