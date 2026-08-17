import type { Metadata } from "next";
import Link from "next/link";

import { signOut } from "../../sign-out/actions";
import "./platform-access-denied.css";

export const metadata: Metadata = {
  title: "Platform access unavailable — AIOS",
  description: "A protected AIOS platform authority boundary.",
};

export default async function PlatformAccessDeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const requiresSuperadmin = reason === "superadmin";

  return (
    <main className="platform-denied-page" id="main-content" tabIndex={-1}>
      <section className="platform-denied-card">
        <Link className="platform-denied-brand" href="/">
          <span>A</span>
          <strong>AIOS</strong>
          <small>PLATFORM</small>
        </Link>
        <div className="platform-denied-symbol" aria-hidden="true">×</div>
        <p className="platform-denied-eyebrow">AUTHORITY BOUNDARY</p>
        <h1>
          {requiresSuperadmin
            ? "Superadmin authority is required."
            : "Platform access is not assigned."}
        </h1>
        <p className="platform-denied-copy">
          {requiresSuperadmin
            ? "This signed-in account cannot manage the platform operator directory. Other platform areas remain governed by its assigned role."
            : "This signed-in account does not have an active platform role. Agency owner or administrator access never grants platform authority."}
        </p>
        <div className="platform-denied-note" role="note">
          <strong>Tenant separation remains enforced</strong>
          <span>
            This boundary does not change agency membership or expose agency
            customer records.
          </span>
        </div>
        <div className="platform-denied-actions">
          <Link href={requiresSuperadmin ? "/platform" : "/"}>
            {requiresSuperadmin ? "Back to platform" : "Open my workspace"}
          </Link>
          <form action={signOut}>
            <button type="submit">Sign out</button>
          </form>
        </div>
      </section>
    </main>
  );
}
