"use client";

import { type FormEvent, useState, useTransition } from "react";

import {
  getPlatformAgencyDetail,
  updateOrganizationLifecycle,
} from "../../app/actions/platform";
import {
  allowedOrganizationLifecycleTransitions,
  type OrganizationLifecycleStatus,
} from "../../lib/platform/contracts";
import { Button } from "../ui/button";
import { FormFeedback, FormField } from "../ui/form-field";

type AgencyDetail = Awaited<ReturnType<typeof getPlatformAgencyDetail>>;

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1).replace("_", " ");
}

export function PlatformAgencyLifecycle({
  initial,
}: {
  initial: AgencyDetail;
}) {
  const [detail, setDetail] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    tone: "error" | "success";
    message: string;
  } | null>(null);
  const transitions = allowedOrganizationLifecycleTransitions(
    detail.lifecycle.status as OrganizationLifecycleStatus,
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setFeedback(null);
    startTransition(async () => {
      try {
        await updateOrganizationLifecycle({
          organizationId: detail.organization.id,
          status: String(data.get("status")),
          reason: String(data.get("reason") || ""),
          confirmation: String(data.get("confirmation") || ""),
          expectedVersion: detail.lifecycle.version,
        });
        const refreshed = await getPlatformAgencyDetail({
          organizationId: detail.organization.id,
        });
        setDetail(refreshed);
        form.reset();
        setFeedback({
          tone: "success",
          message: `Agency lifecycle is now ${statusLabel(refreshed.lifecycle.status)}.`,
        });
      } catch (error) {
        setFeedback({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "Agency lifecycle could not be changed.",
        });
      }
    });
  }

  return (
    <section className="platform-lifecycle-workspace">
      {feedback ? <FormFeedback tone={feedback.tone}>{feedback.message}</FormFeedback> : null}
      <article className="platform-panel platform-panel-stack">
        <header>
          <div>
            <p>CURRENT LIFECYCLE</p>
            <h2>{statusLabel(detail.lifecycle.status)}</h2>
          </div>
          <span className={`platform-status-badge is-${detail.lifecycle.status}`}>
            Version {detail.lifecycle.version}
          </span>
        </header>
        <dl className="platform-fact-list">
          <div><dt>Last changed</dt><dd>{new Date(detail.lifecycle.updatedAt).toLocaleString("en-IN")}</dd></div>
          <div><dt>Recorded reason</dt><dd>{detail.lifecycle.reason || "Initial active state"}</dd></div>
        </dl>
      </article>

      {detail.canManageLifecycle ? (
        <article className="platform-panel platform-panel-stack">
          <header>
            <div>
              <p>CONTROLLED CHANGE</p>
              <h2>Change agency lifecycle</h2>
            </div>
          </header>
          {!detail.mfaVerified ? (
            <div className="platform-warning" role="alert">
              Verify multi-factor authentication before changing agency access.
            </div>
          ) : null}
          <form className="platform-lifecycle-form" onSubmit={submit}>
            <FormField label="Next state">
              <select name="status" required defaultValue="">
                <option value="" disabled>Select a valid transition</option>
                {transitions.map((status) => (
                  <option value={status} key={status}>{statusLabel(status)}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Operational reason">
              <textarea name="reason" required minLength={12} maxLength={500} placeholder="Explain why this change is required and who requested it." />
            </FormField>
            <FormField label={`Type “${detail.organization.name}” to confirm`}>
              <input name="confirmation" required autoComplete="off" />
            </FormField>
            <p className="platform-impact-note">
              Restricted, suspended, and archived states immediately remove the agency from active workspace resolution. Customer records are retained and platform roles still do not gain access.
            </p>
            <Button type="submit" disabled={pending || !detail.mfaVerified || transitions.length === 0}>
              {pending ? "Applying…" : "Apply lifecycle change"}
            </Button>
          </form>
        </article>
      ) : null}
    </section>
  );
}
