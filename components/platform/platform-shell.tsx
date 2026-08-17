"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { signOut } from "../../app/sign-out/actions";
import {
  canManagePlatformAccess,
  platformRoleLabel,
  type PlatformRoleValue,
} from "../../lib/platform/contracts";

type PlatformShellProps = {
  children: React.ReactNode;
  hasAgencyWorkspace: boolean;
  mfaVerified: boolean;
  role: PlatformRoleValue;
  userName: string;
};

const navigationGroups = [
  {
    label: "Platform",
    items: [{ href: "/platform", label: "Overview", glyph: "⌂" }],
  },
  {
    label: "Tenant operations",
    items: [
      { href: "/platform/agencies", label: "Agencies", glyph: "A" },
      { href: "/platform/identities", label: "Users & security", glyph: "U" },
    ],
  },
  {
    label: "Commercial",
    items: [
      { href: "/platform/billing", label: "Plans & billing", glyph: "₹" },
      { href: "/platform/usage", label: "Usage & limits", glyph: "↗" },
    ],
  },
  {
    label: "Reliability",
    items: [
      { href: "/platform/system", label: "System health", glyph: "●" },
      { href: "/platform/audit", label: "Audit log", glyph: "≡" },
    ],
  },
  {
    label: "Configuration",
    items: [{ href: "/platform/email", label: "Platform email", glyph: "@" }],
  },
] as const;

function isCurrentPath(pathname: string, href: string) {
  if (href === "/platform") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
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

export function PlatformShell({
  children,
  hasAgencyWorkspace,
  mfaVerified,
  role,
  userName,
}: PlatformShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const visibleNavigationGroups = canManagePlatformAccess(role)
    ? [
        ...navigationGroups,
        {
          label: "Governance",
          items: [
            {
              href: "/platform/access",
              label: "Platform access",
              glyph: "U",
            },
          ],
        },
      ]
    : navigationGroups;
  const visibleNavigation = visibleNavigationGroups.flatMap(
    (group) => group.items,
  );
  const currentArea =
    visibleNavigation.find((item) => isCurrentPath(pathname, item.href))?.label ||
    "Platform";

  useEffect(() => {
    if (!mobileOpen) return;

    const previousOverflow = document.body.style.overflow;
    const menuButton = menuButtonRef.current;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) || [],
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      menuButton?.focus();
    };
  }, [mobileOpen]);

  return (
    <div className="platform-shell">
      <aside
        className={`platform-sidebar${mobileOpen ? " is-open" : ""}`}
        id="platform-navigation"
        ref={sidebarRef}
      >
        <button
          className="platform-mobile-close"
          type="button"
          aria-label="Close platform navigation"
          ref={closeButtonRef}
          onClick={() => setMobileOpen(false)}
        >
          ×
        </button>
        <Link className="platform-logo" href="/platform" onClick={() => setMobileOpen(false)}>
          <span>A</span>
          <strong>AIOS</strong>
          <small>PLATFORM</small>
        </Link>
        <section className="platform-context" aria-label="Current administration context">
          <span aria-hidden="true">◆</span>
          <div>
            <small>CONTROL PLANE</small>
            <b>Platform administration</b>
          </div>
        </section>
        <nav aria-label="Platform navigation">
          {visibleNavigationGroups.map((group) => (
            <section className="platform-nav-group" key={group.label}>
              <p>{group.label.toUpperCase()}</p>
              {group.items.map((item) => (
                <Link
                  href={item.href}
                  key={item.href}
                  aria-current={
                    isCurrentPath(pathname, item.href) ? "page" : undefined
                  }
                  onClick={() => setMobileOpen(false)}
                >
                  <span aria-hidden="true">{item.glyph}</span>
                  {item.label}
                </Link>
              ))}
            </section>
          ))}
        </nav>
        <div className="platform-sidebar-footer">
          <div className="platform-boundary-signal">
            <i aria-hidden="true">●</i>
            Tenant data boundary enforced
          </div>
          {hasAgencyWorkspace ? (
            <Link className="platform-agency-switch" href="/choose-workspace">
              Switch operating context
            </Link>
          ) : (
            <p className="platform-agency-switch is-disabled">No agency membership</p>
          )}
          <div className="platform-account-row">
            <div className="platform-profile">
              <span>{initials(userName)}</span>
              <span>
                <b>{userName}</b>
                <small>{platformRoleLabel(role)}</small>
              </span>
            </div>
            <form action={signOut}>
              <button type="submit" className="platform-signout">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>
      <section className="platform-main">
        <header className="platform-global-header">
          <button
            className="platform-mobile-menu"
            type="button"
            aria-label={mobileOpen ? "Close platform navigation" : "Open platform navigation"}
            aria-controls="platform-navigation"
            aria-expanded={mobileOpen}
            ref={menuButtonRef}
            onClick={() => setMobileOpen((current) => !current)}
          >
            ☰
          </button>
          <div>
            <small>AIOS PLATFORM</small>
            <b>{currentArea}</b>
          </div>
          <div className="platform-header-actions">
            <Link
              className={`platform-mfa-chip ${mfaVerified ? "is-verified" : "needs-attention"}`}
              href={`/account/security?next=${encodeURIComponent(pathname)}`}
            >
              {mfaVerified ? "MFA verified" : "MFA required"}
            </Link>
            <span className="platform-role-chip">{platformRoleLabel(role)}</span>
            <i aria-hidden="true">{initials(userName)}</i>
          </div>
        </header>
        <div className="platform-route-content">{children}</div>
      </section>
      {mobileOpen ? (
        <button
          className="platform-mobile-scrim"
          type="button"
          aria-label="Close platform navigation"
          tabIndex={-1}
          onClick={() => setMobileOpen(false)}
        />
      ) : null}
    </div>
  );
}
