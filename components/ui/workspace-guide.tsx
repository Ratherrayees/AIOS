import Link from "next/link";

export type JourneyStage = "capture" | "qualify" | "propose" | "operate";
export type CapabilityTone =
  | "live"
  | "internal"
  | "approval"
  | "guided"
  | "planned";

type Capability = {
  label: string;
  tone: CapabilityTone;
};

const journeyStages: {
  id: JourneyStage;
  label: string;
  detail: string;
  href: string;
}[] = [
  {
    id: "capture",
    label: "Capture",
    detail: "Person and enquiry",
    href: "/settings/lead-capture",
  },
  {
    id: "qualify",
    label: "Qualify",
    detail: "Evidence and follow-up",
    href: "/?view=leads",
  },
  {
    id: "propose",
    label: "Propose",
    detail: "Quote and itinerary",
    href: "/quotes",
  },
  {
    id: "operate",
    label: "Operate",
    detail: "Confirmed trip delivery",
    href: "/trips",
  },
];

export function CapabilityBadge({ capability }: { capability: Capability }) {
  return (
    <span className={`ui-capability ui-capability-${capability.tone}`}>
      <i aria-hidden="true" />
      {capability.label}
    </span>
  );
}

export function JourneyRail({
  activeStage,
  compact = false,
}: {
  activeStage?: JourneyStage;
  compact?: boolean;
}) {
  return (
    <nav
      className={`ui-journey-rail ${compact ? "is-compact" : ""}`}
      aria-label="Customer journey"
    >
      {journeyStages.map((stage, index) => (
        <Link
          className={stage.id === activeStage ? "is-active" : ""}
          href={stage.href}
          key={stage.id}
          aria-current={stage.id === activeStage ? "step" : undefined}
        >
          <span>{index + 1}</span>
          <b>{stage.label}</b>
          {!compact && <small>{stage.detail}</small>}
        </Link>
      ))}
    </nav>
  );
}

export function WorkspaceGuide({
  eyebrow,
  title,
  purpose,
  nextAction,
  aiosRole,
  activeStage,
  capabilities,
  action,
}: {
  eyebrow: string;
  title: string;
  purpose: string;
  nextAction: string;
  aiosRole: string;
  activeStage?: JourneyStage;
  capabilities: Capability[];
  action?: { href: string; label: string };
}) {
  return (
    <section className="ui-workspace-guide" aria-labelledby="workspace-guide-title">
      <div className="ui-guide-heading">
        <div>
          <p>{eyebrow}</p>
          <h2 id="workspace-guide-title">{title}</h2>
        </div>
        <div className="ui-capability-list" aria-label="Feature capabilities">
          {capabilities.map((capability) => (
            <CapabilityBadge
              capability={capability}
              key={`${capability.tone}-${capability.label}`}
            />
          ))}
        </div>
      </div>
      <div className="ui-guide-grid">
        <div>
          <small>WHY THIS EXISTS</small>
          <strong>{purpose}</strong>
        </div>
        <div>
          <small>WHAT TO DO NEXT</small>
          <strong>{nextAction}</strong>
        </div>
        <div>
          <small>WHAT AIOS DOES HERE</small>
          <strong>{aiosRole}</strong>
        </div>
        {action ? (
          <Link className="ui-guide-action" href={action.href}>
            {action.label} <span aria-hidden="true">→</span>
          </Link>
        ) : null}
      </div>
      <JourneyRail activeStage={activeStage} compact />
    </section>
  );
}
