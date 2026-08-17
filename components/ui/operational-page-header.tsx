import type { ReactNode } from "react";

type OperationalPageHeaderProps = {
  section: string;
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  contained?: boolean;
};

/** A compact, repeatable hierarchy for high-frequency CRM workspaces. */
export function OperationalPageHeader({
  section,
  title,
  meta,
  actions,
  contained = false,
}: OperationalPageHeaderProps) {
  return (
    <header className={`crm-page-title${contained ? " is-contained" : ""}`}>
      <div>
        <p>{section}</p>
        <div className="crm-page-title-line">
          <h1>{title}</h1>
          {meta ? <span>{meta}</span> : null}
        </div>
      </div>
      {actions ? <div className="crm-page-actions">{actions}</div> : null}
    </header>
  );
}
