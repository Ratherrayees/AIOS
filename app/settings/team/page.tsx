"use client";

import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import {
  createOrganizationInvitation,
  revokeOrganizationInvitation,
  updateOrganizationMembershipRole,
  updateOrganizationMembershipStatus,
} from "../../actions/team";
import { Button } from "../../../components/ui/button";
import { DataTable } from "../../../components/ui/data-table";
import {
  EmptyState,
  LoadingState,
  StatusNotice,
} from "../../../components/ui/empty-state";
import { FeatureHeader } from "../../../components/ui/feature-header";
import {
  FormFeedback,
  FormField,
} from "../../../components/ui/form-field";
import { createSupabaseBrowserClient } from "../../../lib/supabase/browser";
import { loadWorkspaceContext } from "../../../lib/supabase/workspace-context";
import type { WorkspaceRole } from "../../../lib/workspace/active-workspace";
import "./team.css";

type MemberRow = {
  id: string;
  user_id: string;
  role: WorkspaceRole;
  status: "active" | "invited" | "suspended";
  created_at: string;
  name: string;
};

type InvitationRow = {
  id: string;
  organization_id: string;
  email: string;
  role: WorkspaceRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  expires_at: string;
  created_at: string;
  revoked_at?: string | null;
};

const roleOptions: { value: WorkspaceRole; label: string }[] = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Administrator" },
  { value: "sales", label: "Sales" },
  { value: "trip_designer", label: "Trip designer" },
  { value: "operations", label: "Operations" },
  { value: "finance", label: "Finance" },
  { value: "agent", label: "Agent" },
  { value: "viewer", label: "Viewer" },
];

function roleLabel(role: WorkspaceRole) {
  return roleOptions.find((option) => option.value === role)?.label ?? role;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function invitationDisplayStatus(invitation: InvitationRow) {
  if (
    invitation.status === "pending" &&
    new Date(invitation.expires_at).getTime() <= Date.now()
  ) {
    return "expired";
  }
  return invitation.status;
}

export default function TeamAccessPage() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("Travel workspace");
  const [workspaceRole, setWorkspaceRole] = useState<WorkspaceRole | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{
    tone: "error" | "success";
    message: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const canManage =
    workspaceRole === "owner" || workspaceRole === "admin";
  const canInviteOwner = workspaceRole === "owner";

  useEffect(() => {
    const load = async () => {
      const supabase = createSupabaseBrowserClient();
      const { active } = await loadWorkspaceContext(supabase);
      if (!active) {
        setLoading(false);
        return;
      }

      setOrganizationId(active.organization_id);
      setWorkspaceName(active.name);
      setWorkspaceRole(active.role);

      const { data: membershipRows, error: membershipError } = await supabase
        .from("memberships")
        .select("id, user_id, role, status, created_at")
        .eq("organization_id", active.organization_id)
        .order("created_at", { ascending: true });
      if (membershipError) throw membershipError;

      const memberIds = (membershipRows || []).map(
        (membership) => membership.user_id,
      );
      const { data: profileRows, error: profileError } = memberIds.length
        ? await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", memberIds)
        : { data: [], error: null };
      if (profileError) throw profileError;

      const profileNames = new Map(
        (profileRows || []).map((profile) => [
          profile.id,
          profile.full_name || "Team member",
        ]),
      );
      setMembers(
        (membershipRows || []).map((membership) => ({
          ...membership,
          name: profileNames.get(membership.user_id) || "Team member",
        })),
      );

      if (active.role === "owner" || active.role === "admin") {
        const { data: invitationRows, error: invitationError } = await supabase
          .from("organization_invitations")
          .select(
            "id, organization_id, email, role, status, expires_at, created_at, revoked_at",
          )
          .eq("organization_id", active.organization_id)
          .order("created_at", { ascending: false });
        if (invitationError) throw invitationError;
        setInvitations((invitationRows || []) as InvitationRow[]);
      }

      setLoading(false);
    };

    void load().catch(() => {
      setFeedback({
        tone: "error",
        message: "AIOS could not load workspace access controls.",
      });
      setLoading(false);
    });
  }, []);

  const activeMembers = useMemo(
    () => members.filter((member) => member.status === "active").length,
    [members],
  );
  const pendingInvitations = useMemo(
    () =>
      invitations.filter(
        (invitation) => invitationDisplayStatus(invitation) === "pending",
      ).length,
    [invitations],
  );

  function submitInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !canManage || pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const email = String(form.get("email") || "");
    const role = String(form.get("role") || "agent") as WorkspaceRole;

    startTransition(async () => {
      try {
        const invitation = await createOrganizationInvitation({
          organizationId,
          email,
          role,
        });
        setInvitations((current) => [
          invitation as InvitationRow,
          ...current,
        ]);
        formElement.reset();
        setFeedback({
          tone: "success",
          message:
            "Invitation recorded securely. Email delivery remains disabled until the verified Resend setup is completed.",
        });
      } catch (error) {
        setFeedback({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "AIOS could not create that invitation.",
        });
      }
    });
  }

  function revokeInvitation(invitation: InvitationRow) {
    if (!organizationId || pending) return;
    startTransition(async () => {
      try {
        const result = await revokeOrganizationInvitation({
          organizationId,
          invitationId: invitation.id,
        });
        setInvitations((current) =>
          current.map((item) =>
            item.id === invitation.id
              ? {
                  ...item,
                  status: "revoked",
                  revoked_at: result.revoked_at,
                }
              : item,
          ),
        );
        setFeedback({
          tone: "success",
          message: `Access invitation for ${invitation.email} was revoked.`,
        });
      } catch (error) {
        setFeedback({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "AIOS could not revoke that invitation.",
        });
      }
    });
  }

  function changeMemberRole(member: MemberRow, role: WorkspaceRole) {
    if (!organizationId || pending || role === member.role) return;
    if (
      (role === "owner" || member.role === "owner") &&
      !window.confirm(
        "Owner authority controls workspace access. Confirm this role change?",
      )
    ) {
      return;
    }

    startTransition(async () => {
      try {
        const result = await updateOrganizationMembershipRole({
          organizationId,
          membershipId: member.id,
          role,
        });
        setMembers((current) =>
          current.map((item) =>
            item.id === member.id ? { ...item, role: result.role } : item,
          ),
        );
        setFeedback({
          tone: "success",
          message: `${member.name} now has the ${roleLabel(result.role)} role.`,
        });
      } catch (error) {
        setFeedback({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "AIOS could not update that member role.",
        });
      }
    });
  }

  function changeMemberStatus(
    member: MemberRow,
    status: "active" | "suspended",
  ) {
    if (!organizationId || pending || status === member.status) return;
    if (
      status === "suspended" &&
      !window.confirm(
        `Suspend ${member.name}? They will immediately lose workspace access.`,
      )
    ) {
      return;
    }

    startTransition(async () => {
      try {
        const result = await updateOrganizationMembershipStatus({
          organizationId,
          membershipId: member.id,
          status,
        });
        setMembers((current) =>
          current.map((item) =>
            item.id === member.id ? { ...item, status: result.status } : item,
          ),
        );
        setFeedback({
          tone: "success",
          message:
            result.status === "active"
              ? `${member.name}'s workspace access was restored.`
              : `${member.name}'s workspace access was suspended.`,
        });
      } catch (error) {
        setFeedback({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "AIOS could not update that membership.",
        });
      }
    });
  }

  return (
    <main className="team-page" id="main-content" tabIndex={-1}>
      <FeatureHeader
        ariaLabel="Team access navigation"
        links={[
          { href: "/", label: "Command center" },
          { href: "/contacts", label: "Contacts" },
          { href: "/aios", label: "AIOS Control" },
          { href: "/settings/security", label: "Account Security" },
        ]}
      />

      <section className="team-hero">
        <div>
          <p>IDENTITY AND ACCESS</p>
          <h1>Humans stay accountable, even when AIOS is on auto.</h1>
          <span>
            Workspace membership, invitations, and authority boundaries are
            tenant-scoped and audit-ready.
          </span>
        </div>
        <div className="team-hero-stats" aria-label="Workspace access summary">
          <span>
            <b>{activeMembers}</b>
            active members
          </span>
          <span>
            <b>{pendingInvitations}</b>
            pending invites
          </span>
          <span>
            <b>{workspaceRole ? roleLabel(workspaceRole) : "—"}</b>
            your role
          </span>
        </div>
      </section>

      {feedback && (
        <div className="team-feedback">
          <FormFeedback tone={feedback.tone}>{feedback.message}</FormFeedback>
        </div>
      )}

      {loading ? (
        <LoadingState label="Loading secure workspace access" rows={4} />
      ) : !organizationId ? (
        <EmptyState
          title="No active workspace"
          description="This account needs an active tenant membership before team access can be managed."
        />
      ) : (
        <>
          <section className="team-section">
            <header className="team-section-heading">
              <div>
                <p>ACTIVE TENANT</p>
                <h2>{workspaceName}</h2>
              </div>
              <StatusNotice tone="info">
                Access is enforced by Supabase Row Level Security.
              </StatusNotice>
            </header>
            <DataTable<MemberRow>
              caption={`Members of ${workspaceName}`}
              columns={[
                {
                  key: "member",
                  header: "Member",
                  render: (member) => (
                    <div className="team-person">
                      <span aria-hidden="true">
                        {member.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <strong>{member.name}</strong>
                        <small>{member.user_id.slice(0, 8)}…</small>
                      </div>
                    </div>
                  ),
                },
                {
                  key: "role",
                  header: "Role",
                  render: (member) => {
                    const canEdit =
                      canManage &&
                      (workspaceRole === "owner" || member.role !== "owner");
                    return canEdit ? (
                      <select
                        className="team-member-role-select"
                        value={member.role}
                        disabled={pending}
                        aria-label={`Role for ${member.name}`}
                        onChange={(event) =>
                          changeMemberRole(
                            member,
                            event.target.value as WorkspaceRole,
                          )
                        }
                      >
                        {roleOptions
                          .filter(
                            (option) =>
                              canInviteOwner || option.value !== "owner",
                          )
                          .map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                      </select>
                    ) : (
                      <span className={`team-role team-role-${member.role}`}>
                        {roleLabel(member.role)}
                      </span>
                    );
                  },
                },
                {
                  key: "status",
                  header: "Status",
                  render: (member) => {
                    const canEdit =
                      canManage &&
                      (workspaceRole === "owner" || member.role !== "owner");
                    return (
                      <div className="team-status-control">
                        <span
                          className={`team-status team-status-${member.status}`}
                        >
                          {member.status}
                        </span>
                        {canEdit && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="small"
                            disabled={pending}
                            onClick={() =>
                              changeMemberStatus(
                                member,
                                member.status === "active"
                                  ? "suspended"
                                  : "active",
                              )
                            }
                          >
                            {member.status === "active" ? "Suspend" : "Restore"}
                          </Button>
                        )}
                      </div>
                    );
                  },
                },
                {
                  key: "joined",
                  header: "Joined",
                  align: "end",
                  render: (member) => formatDate(member.created_at),
                },
              ]}
              rows={members}
              getRowKey={(member) => member.id}
              emptyTitle="No team members yet"
              emptyDescription="Active workspace members will appear here."
            />
          </section>

          {canManage ? (
            <section className="team-management-grid">
              <article className="team-invite-card">
                <p>SECURE INVITATION</p>
                <h2>Invite a teammate</h2>
                <span>
                  AIOS stores only a one-way token hash. Sending and acceptance
                  remain unavailable until external email is configured.
                </span>
                <form onSubmit={submitInvitation}>
                  <FormField label="Work email">
                    <input
                      name="email"
                      type="email"
                      autoComplete="email"
                      placeholder="teammate@company.com"
                      maxLength={320}
                      required
                    />
                  </FormField>
                  <FormField label="Workspace role">
                    <select name="role" defaultValue="agent">
                      {roleOptions
                        .filter(
                          (option) =>
                            canInviteOwner || option.value !== "owner",
                        )
                        .map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                    </select>
                  </FormField>
                  <Button type="submit" disabled={pending}>
                    {pending ? "Recording…" : "Record invitation"}
                  </Button>
                </form>
                <small>
                  Owner invitations require an owner. Administrators cannot
                  grant or revoke owner authority.
                </small>
              </article>

              <article className="team-policy-card">
                <p>AIOS AUTHORITY BOUNDARY</p>
                <h2>Identity changes always need a human.</h2>
                <ul>
                  <li>AIOS may recommend a role, never assign one on its own.</li>
                  <li>External invitation delivery requires explicit action.</li>
                  <li>Every invitation state change writes an audit event.</li>
                  <li>Tenant isolation is enforced in the database, not UI state.</li>
                </ul>
              </article>
            </section>
          ) : (
            <section className="team-viewer-note">
              <span aria-hidden="true">i</span>
              <div>
                <h2>View-only team access</h2>
                <p>
                  Only workspace owners and administrators can create or revoke
                  invitations. AIOS cannot elevate this permission.
                </p>
              </div>
            </section>
          )}

          {canManage && (
            <section className="team-section">
              <header className="team-section-heading">
                <div>
                  <p>INVITATION LEDGER</p>
                  <h2>Pending and historical access requests</h2>
                </div>
              </header>
              <DataTable<InvitationRow>
                caption={`Access invitations for ${workspaceName}`}
                columns={[
                  {
                    key: "email",
                    header: "Email",
                    render: (invitation) => (
                      <strong>{invitation.email}</strong>
                    ),
                  },
                  {
                    key: "role",
                    header: "Role",
                    render: (invitation) => roleLabel(invitation.role),
                  },
                  {
                    key: "status",
                    header: "Status",
                    render: (invitation) => {
                      const status = invitationDisplayStatus(invitation);
                      return (
                        <span className={`team-status team-status-${status}`}>
                          {status}
                        </span>
                      );
                    },
                  },
                  {
                    key: "expiry",
                    header: "Expires",
                    render: (invitation) => formatDate(invitation.expires_at),
                  },
                  {
                    key: "action",
                    header: "Action",
                    align: "end",
                    render: (invitation) =>
                      invitationDisplayStatus(invitation) === "pending" ? (
                        <Button
                          variant="ghost"
                          size="small"
                          type="button"
                          disabled={pending}
                          onClick={() => revokeInvitation(invitation)}
                          aria-label={`Revoke invitation for ${invitation.email}`}
                        >
                          Revoke
                        </Button>
                      ) : (
                        <span className="team-no-action">—</span>
                      ),
                  },
                ]}
                rows={invitations}
                getRowKey={(invitation) => invitation.id}
                emptyTitle="No invitations recorded"
                emptyDescription="Create an internal invitation record when you are ready to add a teammate."
              />
            </section>
          )}
        </>
      )}
    </main>
  );
}
