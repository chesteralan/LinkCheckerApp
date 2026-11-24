import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** When this value changes (for example the route path), a shown error is cleared. */
  resetKey?: unknown
}

interface State {
  error: Error | null
  resetKey?: unknown
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey }
    }
    return null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div role="alert" className="flex flex-col items-center justify-center h-full p-6 text-center">
          <p className="text-destructive font-medium mb-1">Something went wrong</p>
          <p className="text-sm text-muted-foreground mb-3 max-w-md">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
