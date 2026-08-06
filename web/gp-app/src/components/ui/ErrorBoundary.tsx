import { Component, type ErrorInfo, type ReactNode } from 'react'
import styles from './ErrorBoundary.module.css'

type Props = { children: ReactNode; label?: string }
type State = { error: Error | null }

/** Catches render crashes so one broken tab doesn't blank the whole shell. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', this.props.label || 'page', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className={styles.box} role="alert">
          <h2 className={styles.title}>
            {this.props.label || 'This page'} hit an error
          </h2>
          <p className={styles.msg}>{this.state.error.message}</p>
          <button
            type="button"
            className={styles.btn}
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
