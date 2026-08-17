"use client";

import Link from "next/link";

type FeatureHeaderLink = {
  href: string;
  label: string;
};

type FeatureHeaderProps = {
  links: FeatureHeaderLink[];
  ariaLabel?: string;
};

/**
 * Operational pages now inherit their primary navigation from ApplicationShell.
 * This component remains as a deliberately small contextual shortcut row while
 * older feature modules are migrated; it no longer renders marketing copy,
 * workflow philosophy, or a second navigation architecture.
 */
export function FeatureHeader({
  links,
  ariaLabel = "Related workspace areas",
}: FeatureHeaderProps) {
  if (links.length === 0) return null;

  return (
    <nav className="ui-module-context-nav" aria-label={ariaLabel}>
      <span>Related</span>
      {links.slice(0, 3).map((link) => (
        <Link href={link.href} key={`${link.href}-${link.label}`}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
