"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "../../lib/supabase/browser";
import { loadWorkspaceContext } from "../../lib/supabase/workspace-context";
import type { WorkspaceRole } from "../../lib/workspace/active-workspace";

type SettingsLink = {
  href: string;
  label: string;
  roles: readonly WorkspaceRole[] | null;
};

const settingsLinks: readonly SettingsLink[] = [
  { href: "/settings/team", label: "Team", roles: ["owner", "admin"] },
  { href: "/settings/lead-capture", label: "Lead capture", roles: ["owner", "admin", "sales", "agent"] },
  { href: "/settings/sales-workflows", label: "Workflows", roles: ["owner", "admin", "sales"] },
  { href: "/settings/integrations", label: "Integrations", roles: ["owner", "admin"] },
  { href: "/settings/billing", label: "Plan & billing", roles: ["owner", "admin"] },
  { href: "/settings/security", label: "Security", roles: null },
];

export function SettingsNavigation() {
  const pathname = usePathname();
  const [role, setRole] = useState<WorkspaceRole | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      const supabase = createSupabaseBrowserClient();
      const { active } = await loadWorkspaceContext(supabase);
      setRole(active?.role ?? null);
    })()
      .catch(() => setRole(null))
      .finally(() => setReady(true));
  }, []);

  const visibleLinks = settingsLinks.filter(
    (link) => !link.roles || (role ? link.roles.includes(role) : false),
  );

  return (
    <nav
      className="settings-navigation"
      aria-label="Administration settings"
      aria-busy={!ready}
    >
      <span>Settings</span>
      <div>
        {(ready ? visibleLinks : []).map((link) => {
          const current = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link href={link.href} key={link.href} aria-current={current ? "page" : undefined}>
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
