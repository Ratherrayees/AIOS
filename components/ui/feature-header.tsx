import Link from "next/link";

type FeatureHeaderLink = {
  href: string;
  label: string;
};

type FeatureHeaderProps = {
  links: FeatureHeaderLink[];
  ariaLabel?: string;
};

export function FeatureHeader({
  links,
  ariaLabel = "Related workspace areas",
}: FeatureHeaderProps) {
  return (
    <header className="ui-feature-header">
      <Link href="/" className="ui-feature-brand">
        <span aria-hidden="true">A</span>
        AIOS
      </Link>
      <nav aria-label={ariaLabel}>
        {links.map((link) => (
          <Link href={link.href} key={`${link.href}-${link.label}`}>
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
