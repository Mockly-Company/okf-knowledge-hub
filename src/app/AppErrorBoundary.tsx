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

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return {
      error: error instanceof Error ? error : new Error("Unexpected error"),
    };
  }

  componentDidUpdate(prevProps: AppErrorBoundaryProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[okhub] unhandled render error", error, info);
  }

  private handleRetry = () => {
    this.setState({ error: null });
  };

  private handleGoHome = () => {
    this.setState({ error: null });
    if (this.props.onGoHome) {
      this.props.onGoHome();
      return;
    }
    window.location.hash = "#/home";
  };

  private handleGoDocuments = () => {
    this.setState({ error: null });
    this.props.onGoDocuments?.();
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
