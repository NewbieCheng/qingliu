import React from "react";
import { tStandalone } from "@/shared/i18n/core.js";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Unhandled application error", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main>
        <div className="card">
          <h1>{tStandalone("app.error_title")}</h1>
          <p className="muted">{this.state.error.message}</p>
          <button
            type="button"
            className="primary"
            onClick={() => window.location.reload()}
          >
            {tStandalone("common.reload")}
          </button>
        </div>
      </main>
    );
  }
}
