"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface State {
  failed: boolean;
}

/**
 * Keeps one failing dashboard widget (for example a slow or unavailable collection) from taking the
 * whole page down: the rest of the dashboard still renders and this card shows a short notice.
 */
export class WidgetBoundary extends Component<{ title: string; children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[dashboard] widget "${this.props.title}" failed`, error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex h-full min-h-28 items-center gap-3 rounded-[14px] border border-line bg-white p-5 text-[13px] text-muted">
        <AlertTriangle className="size-5 shrink-0 text-warning" aria-hidden />
        <span>
          <strong className="font-semibold text-ink">{this.props.title}</strong> could not be loaded. Refresh the page to try again.
        </span>
      </div>
    );
  }
}
