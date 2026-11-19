import { BRANCH_POINTS, DIRECTORY_UPDATED, MAC_TREE, REPO_TREE, type DirNode } from './directoryMap'
import styles from './DirectorySection.module.css'

function Tree({ nodes, depth = 0 }: { nodes: DirNode[]; depth?: number }) {
  return (
    <ul className={styles.tree} data-depth={depth}>
      {nodes.map((node) => (
        <li key={`${depth}-${node.name}`}>
          <div className={styles.row}>
            <code>{node.name}</code>
            <span>{node.note}</span>
          </div>
          {node.children?.length ? <Tree nodes={node.children} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  )
}

export function DirectorySection() {
  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <h2>Directories</h2>
        <p>
          One folder on this Mac: Desktop/DGA-Research-Analyst. mobile, scripts, web, and api are inside it. Updated {DIRECTORY_UPDATED}.
        </p>
      </header>

      <section className={styles.block} aria-label="On this Mac">
        <h3>On this Mac</h3>
        <Tree nodes={MAC_TREE} />
      </section>

      <section className={styles.block} aria-label="Inside the checkout">
        <h3>Inside the checkout</h3>
        <Tree nodes={REPO_TREE} />
      </section>

      <section className={styles.block} aria-label="Branches">
        <h3>Branches</h3>
        <ol className={styles.points}>
          {BRANCH_POINTS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </section>
    </div>
  )
}
