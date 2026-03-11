import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children?: ReactNode;
    resetKey?: string;
    fullScreen?: boolean;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
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

    public componentDidUpdate(prevProps: Props) {
        if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
            this.setState({ hasError: false, error: null });
        }
    }

    public render() {
        if (this.state.hasError) {
            return (
                <div className={`${this.props.fullScreen ? 'min-h-screen' : ''} flex items-center justify-center p-4 bg-red-50 text-red-700`}>
                    <div className="w-full max-w-lg bg-white border border-red-200 rounded-2xl p-6 shadow-sm">
                        <h2 className="text-lg font-black mb-2">Se produjo un error en este modulo</h2>
                        <p className="text-sm font-medium text-red-600 mb-4">
                            Puedes reintentar esta pantalla o recargar la aplicacion.
                        </p>
                        <div className="flex items-center gap-2 mb-4">
                            <button
                                onClick={() => this.setState({ hasError: false, error: null })}
                                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-bold hover:bg-red-700 transition-colors"
                            >
                                Reintentar
                            </button>
                            <button
                                onClick={() => window.location.reload()}
                                className="px-4 py-2 rounded-lg border border-red-200 text-red-700 text-sm font-bold hover:bg-red-50 transition-colors"
                            >
                                Recargar app
                            </button>
                        </div>
                        <details className="whitespace-pre-wrap font-mono text-xs text-red-500 bg-red-50 p-3 rounded-lg">
                            {this.state.error?.toString()}
                        </details>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
