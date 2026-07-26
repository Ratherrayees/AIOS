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
