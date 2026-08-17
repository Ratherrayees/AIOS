import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
};

export function EmptyState({
  title,
  description,
  action,
  compact = false,
}: EmptyStateProps) {
  return (
    <section
      className={`ui-empty-state${compact ? " ui-empty-state-compact" : ""}`}
      aria-label={title}
    >
      <span aria-hidden="true">+</span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {action}
    </section>
  );
}

export function StatusNotice({
  children,
  tone = "success",
}: {
  children: ReactNode;
  tone?: "success" | "info";
}) {
  return (
    <div className={`ui-status-notice ui-status-notice-${tone}`} role="status">
      <span aria-hidden="true">{tone === "success" ? "OK" : "i"}</span>
      {children}
    </div>
  );
}

export function LoadingState({
  label = "Loading",
  rows = 3,
}: {
  label?: string;
  rows?: number;
}) {
  return (
    <div className="ui-loading-state" role="status" aria-live="polite">
      <p>{label}</p>
      <div aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <span key={index} />
        ))}
      </div>
    </div>
  );
}

export function PermissionNotice({
  contained = false,
  description,
  title = "View-only access",
}: {
  contained?: boolean;
  description: string;
  title?: string;
}) {
  return (
    <section
      className={`ui-permission-notice${contained ? " is-contained" : ""}`}
      aria-label={title}
    >
      <span aria-hidden="true">View only</span>
      <div>
        <b>{title}</b>
        <p>{description}</p>
      </div>
    </section>
  );
}

export function ErrorState({
  description,
  onRetry,
  retryLabel = "Try again",
  title = "This workspace could not be loaded",
}: {
  description: string;
  onRetry?: () => void;
  retryLabel?: string;
  title?: string;
}) {
  return (
    <section className="ui-error-state" role="alert" aria-label={title}>
      <span aria-hidden="true">!</span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {onRetry ? (
        <button type="button" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </section>
  );
}
