import { redirect } from "next/navigation";

import { getPlatformAccessDirectory } from "../../actions/platform";
import { getPlatformOperatorInvitationDirectory } from "../../actions/platform-invitations";
import { PlatformAccessManager } from "../../../components/platform/platform-access-manager";
import { PlatformOperatorInvitations } from "../../../components/platform/platform-operator-invitations";
import { OperationalPageHeader } from "../../../components/ui/operational-page-header";
import {
  PlatformAuthorizationError,
  requirePlatformCapability,
} from "../../../lib/platform/authorization";

export default async function PlatformAccessPage() {
  try {
    await requirePlatformCapability("platform.access.manage");
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) {
      redirect("/access-denied/platform?reason=superadmin");
    }
    throw error;
  }
  const [directory, invitationDirectory] = await Promise.all([
    getPlatformAccessDirectory(),
    getPlatformOperatorInvitationDirectory(),
  ]);
  const pendingInvitations = invitationDirectory.invitations.filter(
    (invitation) => invitation.status === "pending",
  ).length;
  return (
    <main className="platform-page" id="main-content" tabIndex={-1}>
      <OperationalPageHeader
        section="Platform superadmin"
        title="Platform access"
        meta={`${directory.operators.length} operators · ${pendingInvitations} pending invitations`}
      />
      <div className="platform-content">
        <section className="platform-boundary" role="note">
          <strong>Platform roles never imply agency access</strong>
          <p>Superadmins manage the platform operator directory. Neither role creates an agency membership or bypasses tenant row-level security. Use platform admin for day-to-day health, registry, email, and audit work; reserve superadmin for granting or suspending platform authority.</p>
        </section>
        <PlatformOperatorInvitations initial={invitationDirectory} />
        <PlatformAccessManager initial={directory} />
      </div>
    </main>
  );
}
