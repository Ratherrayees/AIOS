"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { signOut } from "../../app/sign-out/actions";
import { getCurrentPlatformAccess } from "../../app/actions/platform";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";
import {
  loadWorkspaceContext,
  saveActiveWorkspace,
} from "../../lib/supabase/workspace-context";
import { AIOS_ACTION_CATALOG } from "../../lib/ai/autonomy";
import { summarizeApprovalAttention } from "../../lib/ai/approval-access";
import type {
  WorkspaceChoice,
  WorkspaceRole,
} from "../../lib/workspace/active-workspace";
import type { PlatformRole } from "../../lib/platform/authorization";
import { ModalBoundary } from "./modal-boundary";
import { ProductHelp } from "./product-help";

type SearchResult = {
  id: string;
  title: string;
  detail: string;
  kind: "Lead" | "Contact" | "Task";
  href: string;
};

type NavigationLink = {
  href: string;
  label: string;
  glyph: string;
  roles?: readonly WorkspaceRole[];
};

type NavigationGroup = {
  label: string;
  links: readonly NavigationLink[];
};

type WorkspaceLoadState = "loading" | "ready" | "empty" | "failed";

const bareRoutes = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/update-password",
  "/onboarding",
  "/auth/",
  "/lead/",
  "/proposal/",
  "/portal/",
  "/sandbox/",
  "/choose-workspace",
  "/account/",
  "/access-denied/",
  "/platform",
  "/platform/",
];

const navigation = [
  {
    label: "Today",
    links: [
      { href: "/", label: "Home", glyph: "⌂" },
      { href: "/inbox", label: "Inbox", glyph: "◌" },
      { href: "/tasks", label: "Tasks", glyph: "✓" },
    ],
  },
  {
    label: "Sales",
    links: [
      { href: "/leads", label: "Leads & pipeline", glyph: "◉" },
      { href: "/contacts", label: "Contacts", glyph: "◎" },
      { href: "/quotes", label: "Quotes", glyph: "Q" },
    ],
  },
  {
    label: "Travel",
    links: [
      { href: "/itineraries", label: "Itineraries", glyph: "I" },
      { href: "/trips", label: "Trips", glyph: "T" },
    ],
  },
  {
    label: "Operations",
    links: [
      {
        href: "/suppliers",
        label: "Suppliers",
        glyph: "S",
        roles: ["owner", "admin", "trip_designer", "operations", "finance"],
      },
      {
        href: "/finance",
        label: "Finance",
        glyph: "₹",
        roles: ["owner", "admin", "finance"],
      },
    ],
  },
  {
    label: "Intelligence",
    links: [
      {
        href: "/analytics",
        label: "Analytics",
        glyph: "↗",
        roles: ["owner", "admin", "sales", "operations", "finance"],
      },
      { href: "/knowledge", label: "Knowledge", glyph: "K" },
    ],
  },
  {
    label: "AIOS",
    links: [
      {
        href: "/aios/activity",
        label: "Activity",
        glyph: "✦",
        roles: ["owner", "admin", "operations", "finance"],
      },
      {
        href: "/aios/approvals",
        label: "Approvals",
        glyph: "✓",
        roles: ["owner", "admin", "operations", "finance"],
      },
      {
        href: "/aios/automations",
        label: "Automations",
        glyph: "A",
        roles: ["owner", "admin"],
      },
    ],
  },
  {
    label: "Administration",
    links: [
      {
        href: "/settings/team",
        label: "Team",
        glyph: "U",
        roles: ["owner", "admin"],
      },
      {
        href: "/settings/integrations",
        label: "Integrations",
        glyph: "↗",
        roles: ["owner", "admin"],
      },
      {
        href: "/settings/billing",
        label: "Plan & billing",
        glyph: "₹",
        roles: ["owner", "admin"],
      },
      {
        href: "/settings/lead-capture",
        label: "Lead capture",
        glyph: "+",
        roles: ["owner", "admin", "sales", "agent"],
      },
      {
        href: "/settings/sales-workflows",
        label: "Workflows",
        glyph: "W",
        roles: ["owner", "admin", "sales"],
      },
      { href: "/settings/security", label: "Security", glyph: "2" },
    ],
  },
] as const satisfies readonly NavigationGroup[];

const platformNavigation: NavigationGroup = {
  label: "Platform",
  links: [{ href: "/platform", label: "Switch to platform", glyph: "P" }],
};

function canSeeNavigationLink(
  link: NavigationLink,
  role: WorkspaceRole | null,
) {
  return !link.roles || (role ? link.roles.includes(role) : false);
}

function isBarePath(pathname: string) {
  return bareRoutes.some((route) =>
    route.endsWith("/") ? pathname.startsWith(route) : pathname === route,
  );
}

function isCurrentPath(pathname: string, href: string) {
  const route = href.split(/[?#]/)[0];
  if (route === "/") return pathname === "/";
  return pathname === route || pathname.startsWith(`${route}/`);
}

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "AI"
  );
}

function roleLabel(role: WorkspaceChoice["role"] | null) {
  const labels: Record<WorkspaceChoice["role"], string> = {
    owner: "Agency owner",
    admin: "Agency admin",
    sales: "Sales agent",
    trip_designer: "Trip designer",
    operations: "Operations",
    finance: "Finance",
    agent: "Travel coordinator",
    viewer: "Viewer",
  };
  return role ? labels[role] : "Team member";
}

function withWorkspaceTimeout<T>(operation: Promise<T>, timeoutMs = 10_000) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("Workspace context request timed out.")),
      timeoutMs,
    );
    operation.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function ApplicationShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const bare = isBarePath(pathname);
  const [workspace, setWorkspace] = useState<WorkspaceChoice | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceChoice[]>([]);
  const [workspaceLoadState, setWorkspaceLoadState] =
    useState<WorkspaceLoadState>("loading");
  const [workspaceReloadKey, setWorkspaceReloadKey] = useState(0);
  const [approvalReloadKey, setApprovalReloadKey] = useState(0);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [aiosOperatingMode, setAiosOperatingMode] = useState<
    "Manual" | "Assisted" | "Autopilot"
  >("Assisted");
  const [personalApprovalCount, setPersonalApprovalCount] = useState(0);
  const [platformRole, setPlatformRole] = useState<PlatformRole | null>(null);

  useEffect(() => {
    if (bare) return;
    let cancelled = false;
    void (async () => {
      const supabase = createSupabaseBrowserClient();
      const context = await withWorkspaceTimeout(
        loadWorkspaceContext(supabase),
      );
      if (cancelled) return;
      setWorkspace(context.active);
      setWorkspaces(context.workspaces);
      setWorkspaceLoadState(context.active ? "ready" : "empty");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) {
        setPlatformRole(null);
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setUserName(
        profile?.full_name?.trim() ||
          user.email?.split("@")[0] ||
          "Travel operator",
      );
      const platformAccess = await getCurrentPlatformAccess();
      if (cancelled) return;
      setPlatformRole(platformAccess?.role ?? null);
      if (context.active) {
        const [{ data: policyRows }, { data: approvalRows }] = await Promise.all([
          supabase
            .from("ai_autonomy_policies")
            .select("action, mode, approval_roles")
            .eq("organization_id", context.active.organization_id),
          supabase
            .from("approval_requests")
            .select("action, approver_id")
            .eq("organization_id", context.active.organization_id)
            .eq("status", "pending"),
        ]);
        if (cancelled) return;
        const overrides = new Map(
          (policyRows || []).map((policy) => [policy.action, policy.mode]),
        );
        const internalModes = AIOS_ACTION_CATALOG.filter(
          (item) => !item.hardApproval,
        ).map((item) => overrides.get(item.action) ?? item.defaultMode);
        setAiosOperatingMode(
          internalModes.every((mode) => mode === "observe")
            ? "Manual"
            : internalModes.every((mode) => mode === "auto")
              ? "Autopilot"
              : "Assisted",
        );
        setPersonalApprovalCount(
          summarizeApprovalAttention(approvalRows || [], {
            role: context.active.role,
            userId: user.id,
            approvalRolesByAction: Object.fromEntries(
              (policyRows || []).map((policy) => [
                policy.action,
                policy.approval_roles,
              ]),
            ),
          }).mine,
        );
      } else {
        setPersonalApprovalCount(0);
      }
    })().catch(() => {
      if (cancelled) return;
      setWorkspace(null);
      setWorkspaces([]);
      setWorkspaceMenuOpen(false);
      setWorkspaceLoadState("failed");
      setPersonalApprovalCount(0);
      setPlatformRole(null);
    });
    return () => {
      cancelled = true;
    };
  }, [approvalReloadKey, bare, pathname, workspaceReloadKey]);

  useEffect(() => {
    if (bare) return;
    const refreshApprovals = () => setApprovalReloadKey((current) => current + 1);
    window.addEventListener("focus", refreshApprovals);
    window.addEventListener("aios:approvals-changed", refreshApprovals);
    window.addEventListener("aios:mode-changed", refreshApprovals);
    return () => {
      window.removeEventListener("focus", refreshApprovals);
      window.removeEventListener("aios:approvals-changed", refreshApprovals);
      window.removeEventListener("aios:mode-changed", refreshApprovals);
    };
  }, [bare]);

  useEffect(() => {
    if (bare) return;
    const openSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, [bare, pathname]);

  useEffect(() => {
    if (!searchOpen || !workspace) return;
    const query = searchTerm.trim();
    if (query.length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setSearching(true);
        const supabase = createSupabaseBrowserClient();
        const pattern = `%${query.replace(/[\\%_(),.]/g, " ")}%`;
        const [{ data: deals }, { data: contacts }, { data: tasks }] =
          await Promise.all([
            supabase
              .from("deals")
              .select("id, title, destination")
              .eq("organization_id", workspace.organization_id)
              .ilike("title", pattern)
              .limit(6),
            supabase
              .from("contacts")
              .select("id, first_name, last_name, email")
              .eq("organization_id", workspace.organization_id)
              .ilike("first_name", pattern)
              .limit(6),
            supabase
              .from("tasks")
              .select("id, title, status")
              .eq("organization_id", workspace.organization_id)
              .ilike("title", pattern)
              .limit(6),
          ]);
        if (cancelled) return;
        setResults([
          ...(deals || []).map((deal) => ({
            id: deal.id,
            title: deal.title,
            detail: deal.destination || "Travel opportunity",
            kind: "Lead" as const,
            href: `/leads/${deal.id}`,
          })),
          ...(contacts || []).map((contact) => ({
            id: contact.id,
            title: [contact.first_name, contact.last_name]
              .filter(Boolean)
              .join(" "),
            detail: contact.email || "CRM contact",
            kind: "Contact" as const,
            href: "/contacts",
          })),
          ...(tasks || []).map((task) => ({
            id: task.id,
            title: task.title,
            detail: task.status.replace("_", " "),
            kind: "Task" as const,
            href: "/tasks",
          })),
        ]);
        setSearching(false);
      })().catch(() => {
        if (!cancelled) {
          setResults([]);
          setSearching(false);
        }
      });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchOpen, searchTerm, workspace]);

  const visibleNavigation = useMemo(() => {
    const tenantNavigation = navigation
        .map((group) => ({
          ...group,
          links: group.links.filter((link) =>
            canSeeNavigationLink(link, workspace?.role ?? null),
          ),
        }))
        .filter((group) => group.links.length > 0);
    return platformRole
      ? [...tenantNavigation, platformNavigation]
      : tenantNavigation;
  }, [platformRole, workspace?.role]);
  const pinnedNavigation = visibleNavigation.filter(
    (group) => group.label === "Today",
  );
  const scrollableNavigation = visibleNavigation.filter(
    (group) => group.label !== "Today",
  );

  function renderNavigationGroups(groups: typeof visibleNavigation) {
    return groups.map((group) => (
      <div key={group.label}>
        <p className="nav-heading">{group.label.toUpperCase()}</p>
        {group.links.map((link) => (
          <Link
            className={`nav-link${isCurrentPath(pathname, link.href) ? " selected" : ""}`}
            href={link.href}
            key={`${group.label}-${link.label}`}
            aria-label={link.label}
            aria-current={isCurrentPath(pathname, link.href) ? "page" : undefined}
            title={link.label}
            onClick={() => setMobileMenuOpen(false)}
          >
            <span className="nav-glyph" aria-hidden="true">
              {link.glyph}
            </span>
            <span>{link.label}</span>
            {link.href === "/aios/approvals" && personalApprovalCount > 0 ? (
              <span
                className="nav-attention-badge"
                aria-label={`${personalApprovalCount} approvals assigned to you`}
              >
                {personalApprovalCount > 99 ? "99+" : personalApprovalCount}
              </span>
            ) : null}
          </Link>
        ))}
      </div>
    ));
  }

  const currentArea = useMemo(() => {
    for (const group of visibleNavigation) {
      const link = group.links.find((candidate) =>
        isCurrentPath(pathname, candidate.href),
      );
      if (link) return `${group.label} / ${link.label}`;
    }
    return "Travel workspace";
  }, [pathname, visibleNavigation]);

  const canManageAios =
    workspace?.role === "owner" || workspace?.role === "admin";
  const canReviewApprovals =
    canManageAios ||
    workspace?.role === "operations" ||
    workspace?.role === "finance";
  const workspaceLabel =
    workspace?.name ??
    (workspaceLoadState === "loading"
      ? "Loading workspace"
      : workspaceLoadState === "failed"
        ? "Workspace unavailable"
        : "No workspace assigned");
  const workspaceStatus =
    workspaceLoadState === "ready"
      ? { label: "Live tenant workspace", symbol: "●" }
      : workspaceLoadState === "loading"
        ? { label: "Connecting workspace", symbol: "○" }
        : workspaceLoadState === "failed"
          ? { label: "Workspace connection failed", symbol: "!" }
          : { label: "No active workspace", symbol: "○" };

  if (bare) return children;

  function switchWorkspace(organizationId: string) {
    saveActiveWorkspace(organizationId, workspaces);
    setWorkspaceMenuOpen(false);
    window.location.reload();
  }

  function closeSearch() {
    setSearchOpen(false);
    setSearchTerm("");
    setResults([]);
  }

  return (
    <div className="app-shell crm-application-shell">
      <aside
        className={`sidebar crm-sidebar${mobileMenuOpen ? " is-open" : ""}`}
      >
        <div className="logo">
          <span className="logo-mark">A</span>
          <span>AIOS</span>
        </div>
        <div className="workspace-control">
          <button
            className="workspace-switcher"
            type="button"
            aria-expanded={workspaceMenuOpen}
            aria-haspopup="menu"
            disabled={workspaceLoadState !== "ready" || workspaces.length === 0}
            onClick={() => setWorkspaceMenuOpen((current) => !current)}
          >
            <span className="workspace-glyph">◆</span>
            <span>
              <small>TRAVEL WORKSPACE</small>
              <b>{workspaceLabel}</b>
            </span>
            <i aria-hidden="true">{workspaceMenuOpen ? "⌃" : "⌄"}</i>
          </button>
          {workspaceMenuOpen && workspaces.length > 0 ? (
            <div className="workspace-menu" role="menu">
              {workspaces.map((choice) => (
                <button
                  key={choice.organization_id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={
                    choice.organization_id === workspace?.organization_id
                  }
                  onClick={() => switchWorkspace(choice.organization_id)}
                >
                  <span>{choice.name}</span>
                  <small>{roleLabel(choice.role)}</small>
                </button>
              ))}
            </div>
          ) : null}
          {workspaceLoadState === "failed" ? (
            <button
              className="workspace-retry"
              type="button"
              onClick={() => {
                setWorkspaceLoadState("loading");
                setWorkspaceReloadKey((current) => current + 1);
              }}
            >
              Retry workspace
            </button>
          ) : null}
        </div>
        <nav aria-label="Daily CRM navigation" className="crm-pinned-navigation">
          {renderNavigationGroups(pinnedNavigation)}
        </nav>
        <nav aria-label="CRM navigation" className="crm-primary-navigation">
          {renderNavigationGroups(scrollableNavigation)}
        </nav>
        <div className="sidebar-footer">
          <div
            className={`secure is-${workspaceLoadState}`}
            aria-live="polite"
            aria-atomic="true"
          >
            <i>{workspaceStatus.symbol}</i> {workspaceStatus.label}
          </div>
          <form action={signOut}>
            <button className="profile" type="submit" title="Sign out">
              <span className="avatar rayees">{initials(userName || "AIOS")}</span>
              <span>
                <b>{userName || "Loading profile"}</b>
                <small>
                  {platformRole
                    ? `${roleLabel(workspace?.role ?? null)} · ${platformRole === "superadmin" ? "Platform superadmin" : "Platform admin"} · Sign out`
                    : `${roleLabel(workspace?.role ?? null)} · Sign out`}
                </small>
              </span>
            </button>
          </form>
        </div>
      </aside>

      <section className="workspace-main crm-workspace-main">
        <header className="header crm-global-header">
          <button
            className="crm-mobile-menu"
            type="button"
            aria-label="Open navigation"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((current) => !current)}
          >
            ☰
          </button>
          <div className="crm-location">
            <small>{workspace?.name || "AIOS"}</small>
            <b>{currentArea}</b>
          </div>
          <button
            className="global-search"
            type="button"
            onClick={() => setSearchOpen(true)}
          >
            <span>⌕</span>
            <span>Search leads, contacts and tasks…</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className="header-actions">
            {canManageAios ? (
              <Link className="crm-mode-chip" href="/aios/automations">
                <span aria-hidden="true">✦</span> AIOS: {aiosOperatingMode}
              </Link>
            ) : (
              <span
                className="crm-mode-chip"
                title="Workspace AI operating mode"
              >
                <span aria-hidden="true">✦</span> AIOS: {aiosOperatingMode}
              </span>
            )}
            {canReviewApprovals ? (
              <Link className="crm-approval-link" href="/aios/approvals">
                Approvals
                {personalApprovalCount > 0 ? (
                  <span aria-label={`${personalApprovalCount} assigned to you`}>
                    {personalApprovalCount > 99 ? "99+" : personalApprovalCount}
                  </span>
                ) : null}
              </Link>
            ) : null}
            <ProductHelp />
            <span className="avatar rayees" aria-hidden="true">
              {initials(userName || "AIOS")}
            </span>
          </div>
        </header>
        <div className="crm-application-content">{children}</div>
      </section>

      {mobileMenuOpen ? (
        <button
          className="crm-mobile-scrim"
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileMenuOpen(false)}
        />
      ) : null}

      {searchOpen ? (
        <ModalBoundary className="modal-layer" onClose={closeSearch}>
          <section
            className="command-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="crm-search-title"
            tabIndex={-1}
          >
            <header>
              <div>
                <b id="crm-search-title">Search workspace</b>
                <small>Leads, contacts and tasks</small>
              </div>
              <button
                type="button"
                onClick={closeSearch}
                aria-label="Close search"
              >
                ×
              </button>
            </header>
            <label className="command-input">
              <span aria-hidden="true">⌕</span>
              <input
                autoFocus
                value={searchTerm}
                onChange={(event) => {
                  const value = event.target.value;
                  setSearchTerm(value);
                  if (value.trim().length < 2) {
                    setResults([]);
                    setSearching(false);
                  }
                }}
                placeholder="Search by name or title"
                aria-label="Search workspace"
              />
              <kbd>ESC</kbd>
            </label>
            <div className="command-suggestions">
              <p>{searching ? "SEARCHING" : "RESULTS"}</p>
              {!searching && searchTerm.trim().length < 2 ? (
                <span className="crm-search-hint">
                  Type at least two characters.
                </span>
              ) : null}
              {!searching &&
              searchTerm.trim().length >= 2 &&
              results.length === 0 ? (
                <span className="crm-search-hint">
                  No matching workspace records.
                </span>
              ) : null}
              {results.map((result) => (
                <button
                  key={`${result.kind}-${result.id}`}
                  type="button"
                  onClick={() => {
                    closeSearch();
                    router.push(result.href);
                  }}
                >
                  <span>
                    {result.kind === "Lead"
                      ? "◉"
                      : result.kind === "Contact"
                        ? "◎"
                        : "✓"}
                  </span>
                  <span>
                    <b>{result.title}</b>
                    <small>{result.detail}</small>
                  </span>
                  <i>{result.kind}</i>
                </button>
              ))}
            </div>
          </section>
        </ModalBoundary>
      ) : null}
    </div>
  );
}
