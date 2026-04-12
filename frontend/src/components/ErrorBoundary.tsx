import { Component } from "react"

import type { ErrorInfo, ReactNode } from "react"

import * as Sentry from "@sentry/react"

import { ErrorFallback } from "./ErrorFallback"

interface Props {
  children: ReactNode

  /** Custom fallback UI. Overrides the default ErrorFallback. */

  fallback?: ReactNode

  /** Render as a compact inline alert suitable for wrapping subcomponents. */

  compact?: boolean

  title?: string

  description?: string

  /** Called when the error boundary resets via the "Prøv igen" button. */

  onReset?: () => void

  /**
   * If any entry in this array changes between renders, the boundary
   * automatically resets. Use this to recover when the underlying data
   * that caused the error has changed (e.g. after a successful refetch).
   */

  resetKeys?: ReadonlyArray<unknown>
}

interface State {
  hasError: boolean

  error: Error | null

  componentStack: string | null
}

function keysChanged(
  prev: ReadonlyArray<unknown> | undefined,

  next: ReadonlyArray<unknown> | undefined,
): boolean {
  if (prev === next) return false

  if (!prev || !next) return true

  if (prev.length !== next.length) return true

  for (let i = 0; i < prev.length; i++) {
    if (!Object.is(prev[i], next[i])) return true
  }

  return false
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, componentStack: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo)

    this.setState({ componentStack: errorInfo.componentStack ?? null })

    Sentry.captureException(error, {
      extra: { componentStack: errorInfo.componentStack },
    })
  }

  componentDidUpdate(prevProps: Props) {
    if (
      this.state.hasError &&
      keysChanged(prevProps.resetKeys, this.props.resetKeys)
    ) {
      this.resetState()
    }
  }

  resetState() {
    this.setState({ hasError: false, error: null, componentStack: null })
  }

  handleReset = () => {
    this.resetState()

    this.props.onReset?.()
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <ErrorFallback
          error={this.state.error}
          componentStack={this.state.componentStack}
          resetErrorBoundary={this.handleReset}
          compact={this.props.compact}
          title={this.props.title}
          description={this.props.description}
        />
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
