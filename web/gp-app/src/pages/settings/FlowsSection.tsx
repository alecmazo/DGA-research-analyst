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

const FIXES = [
  'Split api/server.py. It is about 46,000 lines and 361 routes. New work goes in a domain module, the way credit and the local model already do.',
  'Keep the first paint small. The desk shell is about 400 kB, and the city scene is a separate 585 kB chunk. Do not pull the city, gurus, or podcasts into the desk load.',
  'Give Railway a Node build so hashed files stop living in git. Until then, every UI change commits dist.',
  'One database is one office. There is no firm id. A second family office gets its own database, not a row in this one. Positions and notes would otherwise be visible across offices.',
  'Move the name, logo, and model engines into settings. The same build should run for DGA and for the next office. DGA stays the first office on the new build.',
  'Stop importing pandas, Yahoo, and EDGAR at process start. The health check allows 300 seconds because boot is heavy. Read paths should answer before those libraries load.',
  'Leave Ollama on this Mac. Production must not call 127.0.0.1:11434, and a sold office does not get the local-model page.',
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
          Local models never join that path. The browser on this Mac talks to Ollama at 127.0.0.1:11434. Railway cannot reach it.
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
              One deploy, one Postgres database, DGA written into the pages. A second login on this database sees these books and notes.
            </span>
          </div>
          <div className={styles.step}>
            <strong>Later</strong>
            <span>
              The same repository. Each office has its own database. Logo, name, and engines are settings. DGA is the office that takes the new build first. No fork per customer.
            </span>
          </div>
        </div>

        <h3>Fix in this order</h3>
        <ol className={styles.fixes}>
          {FIXES.map((line) => (
            <li key={line}>{line}</li>
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
