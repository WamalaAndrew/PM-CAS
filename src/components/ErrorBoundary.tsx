import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let errorMessage = "An unexpected error occurred.";
      let details = this.state.error?.message;

      try {
        if (details && details.startsWith("{")) {
          const parsed = JSON.parse(details);
          if (parsed.error) {
            errorMessage = "A database error occurred.";
            details = parsed.error;
          }
        }
      } catch (e) {
        // Not JSON
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-xl shadow-lg border border-red-100 p-6 space-y-4">
            <div className="flex items-center space-x-3 text-red-600">
              <AlertCircle className="w-8 h-8" />
              <h1 className="text-xl font-bold">Something went wrong</h1>
            </div>
            <p className="text-slate-600">
              {errorMessage}
            </p>
            {details && (
              <div className="bg-slate-100 p-3 rounded-md text-sm text-slate-700 font-mono overflow-auto max-h-40">
                {details}
              </div>
            )}
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}
