"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { saveAuthorizedAuthorityContext } from "../../app/actions/authority";
import {
  saveActiveWorkspace,
} from "../../lib/supabase/workspace-context";
import type { WorkspaceChoice } from "../../lib/workspace/active-workspace";

export function AuthorityWorkspaceChooser({
  hasPlatformAccess,
  workspaces,
}: {
  hasPlatformAccess: boolean;
  workspaces: WorkspaceChoice[];
}) {
  const router = useRouter();
  const [pendingChoice, setPendingChoice] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function enterPlatform() {
    if (pendingChoice) return;
    setPendingChoice("platform");
    setError("");
    try {
      await saveAuthorizedAuthorityContext({ authority: "platform" });
      router.push("/platform");
    } catch {
      setPendingChoice(null);
      setError(
        "AIOS could not open platform administration. Your access was not changed; try again.",
      );
    }
  }

  async function enterAgency(workspace: WorkspaceChoice) {
    if (pendingChoice) return;
    setPendingChoice(workspace.organization_id);
    setError("");
    try {
      await saveAuthorizedAuthorityContext({
        authority: "agency",
        organizationId: workspace.organization_id,
      });
      saveActiveWorkspace(workspace.organization_id, workspaces);
      router.push("/");
    } catch {
      setPendingChoice(null);
      setError(
        `AIOS could not open ${workspace.name}. Your access was not changed; try again.`,
      );
    }
  }

  return (
    <div aria-busy={Boolean(pendingChoice)}>
      {error ? (
        <p className="authority-choice-feedback" role="alert">
          {error}
        </p>
      ) : null}
      <div className="authority-choice-grid">
        {hasPlatformAccess ? (
          <button
            type="button"
            onClick={enterPlatform}
            className="authority-choice-card is-platform"
            disabled={Boolean(pendingChoice)}
          >
            <span>PLATFORM CONTROL PLANE</span>
            <strong>Platform administration</strong>
            <p>Agencies, system health, platform services, security, and audit.</p>
            <em>
              {pendingChoice === "platform" ? "Opening platform…" : "Enter platform →"}
            </em>
          </button>
        ) : null}
        {workspaces.map((workspace) => (
          <button
            type="button"
            className="authority-choice-card"
            key={workspace.organization_id}
            disabled={Boolean(pendingChoice)}
            onClick={() => enterAgency(workspace)}
          >
            <span>AGENCY WORKSPACE</span>
            <strong>{workspace.name}</strong>
            <p>{workspace.role.replace(/_/g, " ")} access to this agency’s CRM.</p>
            <em>
              {pendingChoice === workspace.organization_id
                ? "Opening workspace…"
                : "Enter agency →"}
            </em>
          </button>
        ))}
      </div>
    </div>
  );
}
