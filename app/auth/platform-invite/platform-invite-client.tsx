"use client";

import { useState, useTransition } from "react";

import {
  acceptPlatformOperatorInvitation,
  switchPlatformInvitationAccount,
} from "../../actions/platform-invitations";
import { Button } from "../../../components/ui/button";
import { FormFeedback } from "../../../components/ui/form-field";

export function PlatformInviteAcceptance() {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function accept() {
    if (pending) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await acceptPlatformOperatorInvitation();
        window.location.replace(result.destination);
      } catch (acceptanceError) {
        setError(
          acceptanceError instanceof Error
            ? acceptanceError.message
            : "This platform invitation could not be accepted.",
        );
      }
    });
  }

  return (
    <>
      {error ? <FormFeedback tone="error">{error}</FormFeedback> : null}
      <Button type="button" fullWidth disabled={pending} onClick={accept}>
        {pending ? "Activating protected access…" : "Accept platform access"}
      </Button>
      <form action={switchPlatformInvitationAccount}>
        <Button type="submit" variant="ghost" fullWidth disabled={pending}>
          Use a different account
        </Button>
      </form>
    </>
  );
}
