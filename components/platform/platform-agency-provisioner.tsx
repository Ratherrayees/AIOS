"use client";

import Link from "next/link";
import { type FormEvent, useState, useTransition } from "react";

import { provisionPlatformAgency } from "../../app/actions/platform";
import { Button } from "../ui/button";

type ProvisionedAgency = Awaited<ReturnType<typeof provisionPlatformAgency>>;

export function PlatformAgencyProvisioner({
  canProvision,
  mfaVerified,
  onProvisioned,
}: {
  canProvision: boolean;
  mfaVerified: boolean;
  onProvisioned?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [result, setResult] = useState<ProvisionedAgency | null>(null);
  const [slug, setSlug] = useState("");

  if (!canProvision) return null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    setResult(null);
    startTransition(async () => {
      try {
        const provisioned = await provisionPlatformAgency({
          name: form.get("name"),
          slug: form.get("slug"),
          ownerEmail: form.get("ownerEmail"),
          reason: form.get("reason"),
          confirmation: form.get("confirmation"),
        });
        setResult(provisioned);
        onProvisioned?.();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "The agency could not be provisioned.",
        );
      }
    });
  }

  return (
    <section className="platform-provisioner" aria-labelledby="agency-provisioning-title">
      <div>
        <p>SUPERADMIN ACTION</p>
        <h2 id="agency-provisioning-title">Provision an agency</h2>
        <span>Create an isolated tenant shell and its first owner invitation.</span>
      </div>
      {!open ? (
        <Button type="button" disabled={!mfaVerified} onClick={() => setOpen(true)}>
          Provision agency
        </Button>
      ) : null}
      {!mfaVerified ? (
        <small>Complete MFA before creating a tenant.</small>
      ) : null}
      {open ? (
        <form onSubmit={submit}>
          <label>
            Agency name
            <input name="name" required minLength={2} maxLength={120} autoComplete="organization" />
          </label>
          <label>
            Agency slug
            <input
              name="slug"
              required
              minLength={2}
              maxLength={120}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              placeholder="northstar-travel"
              value={slug}
              onChange={(event) => setSlug(event.target.value.toLowerCase())}
              autoCapitalize="none"
            />
          </label>
          <label>
            First owner email
            <input name="ownerEmail" type="email" required maxLength={320} autoComplete="email" />
          </label>
          <label className="platform-provisioner-wide">
            Provisioning reason
            <textarea name="reason" required minLength={12} maxLength={500} placeholder="Approved customer onboarding request…" />
          </label>
          <label className="platform-provisioner-wide">
            Type <b>{slug || "the exact agency slug"}</b> to confirm
            <input name="confirmation" required autoComplete="off" />
          </label>
          <p className="platform-impact-note platform-provisioner-wide">
            This creates platform metadata only. The tenant stays in provisioning state until reviewed and activated. Platform access does not become agency membership.
          </p>
          {error ? <p className="platform-form-error platform-provisioner-wide" role="alert">{error}</p> : null}
          {result ? (
            <div className="platform-provision-result platform-provisioner-wide" role="status">
              <b>Agency created in {result.lifecycleStatus} state.</b>
              <span>
                {result.invitationDelivery === "sent"
                  ? "The owner invitation was sent using platform email."
                  : "The invitation is recorded, but delivery is pending platform email availability."}
              </span>
              <Link href={`/platform/agencies/${result.organizationId}`}>Review agency</Link>
            </div>
          ) : null}
          <div className="platform-card-actions platform-provisioner-wide">
            <Button type="submit" disabled={pending}>{pending ? "Provisioning…" : "Create provisioning agency"}</Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
