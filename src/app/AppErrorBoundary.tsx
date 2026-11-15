import { Component, type ErrorInfo, type ReactNode } from "react";
import { AppFallbackScreen } from "@/components/patterns/AppFallbackScreen";

export interface AppErrorBoundaryProps {
  children: ReactNode;
  resetKey?: string;
  onGoHome?: () => void;
  onGoDocuments?: () => void;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };
  private lastLocationKey = AppErrorBoundary.getLocationKey();

  private static getLocationKey(): string {
    if (typeof window === "undefined") {
      return "";
    }
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return {
      error: error instanceof Error ? error : new Error("Unexpected error"),
    };
  }

  componentDidMount() {
    this.lastLocationKey = AppErrorBoundary.getLocationKey();
    window.addEventListener("hashchange", this.handleLocationChange);
    window.addEventListener("popstate", this.handleLocationChange);
  }

  componentDidUpdate(prevProps: AppErrorBoundaryProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.lastLocationKey = AppErrorBoundary.getLocationKey();
      this.setState({ error: null });
    }
  }

  componentWillUnmount() {
    window.removeEventListener("hashchange", this.handleLocationChange);
    window.removeEventListener("popstate", this.handleLocationChange);
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.lastLocationKey = AppErrorBoundary.getLocationKey();
    console.error("[okhub] unhandled render error", error, info);
  }

  private handleLocationChange = () => {
    const nextLocationKey = AppErrorBoundary.getLocationKey();
    if (nextLocationKey === this.lastLocationKey) {
      return;
    }
    this.lastLocationKey = nextLocationKey;
    if (this.state.error) {
      this.setState({ error: null });
    }
  };

  private handleRetry = () => {
    this.lastLocationKey = AppErrorBoundary.getLocationKey();
    this.setState({ error: null });
  };

  private handleGoHome = () => {
    this.setState({ error: null });
    if (this.props.onGoHome) {
      this.props.onGoHome();
      this.lastLocationKey = AppErrorBoundary.getLocationKey();
      return;
    }
    window.location.hash = "#/home";
    this.lastLocationKey = AppErrorBoundary.getLocationKey();
  };

  private handleGoDocuments = () => {
    this.setState({ error: null });
    this.props.onGoDocuments?.();
    this.lastLocationKey = AppErrorBoundary.getLocationKey();
  };

  render() {
    if (this.state.error) {
      return (
        <AppFallbackScreen
          kind="error"
          detail={this.state.error.message}
          onGoHome={this.handleGoHome}
          onGoDocuments={
            this.props.onGoDocuments ? this.handleGoDocuments : undefined
          }
          onRetry={this.handleRetry}
        />
      );
    }
    return this.props.children;
  }
}
