"use client";

import { useState, useTransition } from "react";

import { acceptOrganizationInvitation } from "../../actions/team";
import { Button } from "../../../components/ui/button";
import { FormFeedback } from "../../../components/ui/form-field";
import { ACTIVE_WORKSPACE_STORAGE_KEY } from "../../../lib/workspace/active-workspace";

export function InviteAcceptance({ token }: { token: string }) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function accept() {
    if (pending) return;
    setError("");
    startTransition(async () => {
      try {
        const workspace = await acceptOrganizationInvitation({ token });
        window.localStorage.setItem(
          ACTIVE_WORKSPACE_STORAGE_KEY,
          workspace.organization_id,
        );
        window.location.replace("/");
      } catch (acceptanceError) {
        setError(
          acceptanceError instanceof Error
            ? acceptanceError.message
            : "This invitation could not be accepted.",
        );
      }
    });
  }

  return (
    <>
      {error && <FormFeedback tone="error">{error}</FormFeedback>}
      <Button
        type="button"
        fullWidth
        disabled={pending}
        onClick={accept}
      >
        {pending ? "Verifying access…" : "Accept secure invitation"}
      </Button>
    </>
  );
}
