"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  type CapabilityTone,
  type JourneyStage,
  WorkspaceGuide,
} from "./workspace-guide";

type FeatureHeaderLink = {
  href: string;
  label: string;
};

type FeatureHeaderProps = {
  links: FeatureHeaderLink[];
  ariaLabel?: string;
};

type GuideDefinition = {
  match: (pathname: string) => boolean;
  eyebrow: string;
  title: string;
  purpose: string;
  nextAction: string;
  aiosRole: string;
  activeStage?: JourneyStage;
  capabilities: { label: string; tone: CapabilityTone }[];
  action?: { href: string; label: string };
};

const guides: GuideDefinition[] = [
  {
    match: (pathname) => pathname.startsWith("/leads/"),
    eyebrow: "SALES · OPPORTUNITY",
    title: "Turn an enquiry into a decision-ready opportunity.",
    purpose:
      "Keep the traveller, commercial plan, evidence and follow-up history together.",
    nextAction:
      "Record the latest evidence, complete required qualification and choose the next legal stage.",
    aiosRole:
      "AIOS can extract structured details, detect stalled work and prepare internal follow-ups.",
    activeStage: "qualify",
    capabilities: [
      { label: "Live CRM", tone: "live" },
      { label: "Evidence gated", tone: "guided" },
      { label: "Sharing needs approval", tone: "approval" },
    ],
    action: { href: "/?view=leads", label: "Open pipeline" },
  },
  {
    match: (pathname) => pathname === "/contacts",
    eyebrow: "SALES · PEOPLE",
    title: "One trusted record for every traveller and relationship.",
    purpose:
      "Contacts hold identity, preferences, consent, ownership and relationship history.",
    nextAction:
      "Create or find the person first, then connect their enquiry, conversation or trip.",
    aiosRole:
      "AIOS uses approved contact evidence as context but cannot silently merge or change identity.",
    activeStage: "capture",
    capabilities: [
      { label: "Live CRM", tone: "live" },
      { label: "Human-reviewed merges", tone: "approval" },
    ],
    action: { href: "/?view=leads", label: "Open opportunities" },
  },
  {
    match: (pathname) => pathname === "/inbox",
    eyebrow: "TODAY · COMMUNICATIONS",
    title: "Turn every conversation into owned, deadline-aware work.",
    purpose:
      "The Inbox records customer context, responsibility, priority and response deadlines.",
    nextAction:
      "Assign the conversation, set its response deadline and prepare a reviewed draft.",
    aiosRole:
      "AIOS detects SLA risk and may create internal tasks; it cannot send a message here.",
    capabilities: [
      { label: "Internal records", tone: "internal" },
      { label: "Outbound not connected", tone: "planned" },
      { label: "SLA automation", tone: "guided" },
    ],
    action: { href: "/tasks", label: "Open task queue" },
  },
  {
    match: (pathname) => pathname === "/tasks",
    eyebrow: "TODAY · EXECUTION",
    title: "Make every follow-up explicit, owned and finishable.",
    purpose:
      "Tasks are the shared execution queue for sales, communications and trip operations.",
    nextAction:
      "Work overdue and assigned items first; close tasks only when the outcome is recorded.",
    aiosRole:
      "AIOS can create or escalate eligible internal tasks according to workspace policy.",
    capabilities: [
      { label: "Live workflow", tone: "live" },
      { label: "Safe auto-actions", tone: "guided" },
    ],
    action: { href: "/aios", label: "Review automation policy" },
  },
  {
    match: (pathname) => pathname === "/quotes",
    eyebrow: "SALES · COMMERCIAL",
    title: "Build a proposal without losing pricing history.",
    purpose:
      "Quotes preserve revisions, internal cost and margin evidence for one opportunity.",
    nextAction:
      "Create a draft, review the internal margin, revise if needed, then request sharing approval.",
    aiosRole:
      "AIOS may prepare commercial context, but external sharing and price effects stay human-gated.",
    activeStage: "propose",
    capabilities: [
      { label: "Live drafts", tone: "live" },
      { label: "Internal costs", tone: "internal" },
      { label: "Sharing needs approval", tone: "approval" },
    ],
    action: { href: "/itineraries", label: "Open itinerary studio" },
  },
  {
    match: (pathname) => pathname === "/itineraries",
    eyebrow: "SALES · JOURNEY DESIGN",
    title: "Shape the journey before anything is booked or shared.",
    purpose:
      "Itineraries organize days, activities, collaboration and reusable planning patterns.",
    nextAction:
      "Complete the day plan, resolve readiness warnings and pair it with the commercial proposal.",
    aiosRole:
      "AIOS can prepare cited suggestions; each item still needs an explicit human application.",
    activeStage: "propose",
    capabilities: [
      { label: "Internal planning", tone: "internal" },
      { label: "AI suggestions", tone: "guided" },
      { label: "No booking", tone: "planned" },
    ],
    action: { href: "/quotes", label: "Open quotes" },
  },
  {
    match: (pathname) => pathname.startsWith("/trips"),
    eyebrow: "OPERATIONS · TRIP DELIVERY",
    title: "Operate a won journey from confirmation to completion.",
    purpose:
      "Trips coordinate travellers, internal bookings, documents, responsibilities and lifecycle evidence.",
    nextAction:
      "Resolve readiness gaps, confirm internal records and move the trip only when evidence is complete.",
    aiosRole:
      "AIOS will monitor operational risk; supplier contact, booking changes and payments require approval.",
    activeStage: "operate",
    capabilities: [
      { label: "Live operations", tone: "live" },
      { label: "Internal booking ledger", tone: "internal" },
      { label: "External effects gated", tone: "approval" },
    ],
    action: { href: "/itineraries", label: "Open journey design" },
  },
  {
    match: (pathname) => pathname === "/finance",
    eyebrow: "OPERATIONS · FINANCE",
    title: "Track every obligation without pretending to move money.",
    purpose:
      "Finance joins supplier terms, receivables, payables, due dates and settlement evidence in one tenant-scoped ledger.",
    nextAction:
      "Record the obligation, connect its trip or supplier, then reconcile only from evidence of what actually happened.",
    aiosRole:
      "AIOS can monitor due dates and surface risk; charges, payouts, refunds, invoices and contract acceptance stay human-controlled.",
    activeStage: "operate",
    capabilities: [
      { label: "Live ledger", tone: "live" },
      { label: "Immutable evidence", tone: "guided" },
      { label: "Money movement gated", tone: "approval" },
    ],
    action: { href: "/trips", label: "Open trip operations" },
  },
  {
    match: (pathname) => pathname === "/analytics",
    eyebrow: "INTELLIGENCE · PERFORMANCE",
    title: "Understand where attention becomes revenue.",
    purpose:
      "Analytics measures conversion, response discipline, stage velocity and source performance.",
    nextAction:
      "Choose a date range and segment, then investigate the weakest conversion or SLA signal.",
    aiosRole:
      "AIOS will surface cited anomalies; current metrics remain deterministic and tenant-scoped.",
    capabilities: [
      { label: "Live metrics", tone: "live" },
      { label: "No false FX totals", tone: "guided" },
    ],
    action: { href: "/?view=leads", label: "Open pipeline" },
  },
  {
    match: (pathname) => pathname === "/aios",
    eyebrow: "INTELLIGENCE · CONTROL PLANE",
    title: "Decide what AIOS may observe, propose, approve or automate.",
    purpose:
      "This is the authority, budget, provider, queue and human-review control plane.",
    nextAction:
      "Keep external effects approval-gated, review provider limits and clear work awaiting a human.",
    aiosRole:
      "AIOS follows these policies immediately before every tool or model action.",
    capabilities: [
      { label: "Human governed", tone: "approval" },
      { label: "Provider routed", tone: "live" },
      { label: "Durable jobs", tone: "guided" },
    ],
    action: { href: "/?view=leads", label: "Open lead pipeline" },
  },
  {
    match: (pathname) => pathname === "/settings/lead-capture",
    eyebrow: "ADMINISTRATION · INTAKE",
    title: "Control how public enquiries enter the CRM.",
    purpose:
      "Lead forms define ownership, attribution and the first-response promise before a submission arrives.",
    nextAction:
      "Create or review a form, preview it, then activate only the version your team is ready to service.",
    aiosRole:
      "AIOS begins after the governed capture endpoint creates the contact and opportunity.",
    activeStage: "capture",
    capabilities: [
      { label: "Public forms", tone: "live" },
      { label: "Rate limited", tone: "guided" },
    ],
    action: { href: "/settings/sales-workflows", label: "Define qualification" },
  },
  {
    match: (pathname) => pathname === "/settings/sales-workflows",
    eyebrow: "ADMINISTRATION · SALES RULES",
    title: "Define repeatable qualification and follow-up standards.",
    purpose:
      "Reusable checklists and playbooks make pipeline movement consistent across the team.",
    nextAction:
      "Define required evidence and an ordered internal follow-up sequence, then apply it from a lead.",
    aiosRole:
      "AIOS uses the same governed contracts and cannot bypass required qualification evidence.",
    activeStage: "qualify",
    capabilities: [
      { label: "Reusable rules", tone: "live" },
      { label: "Evidence gated", tone: "guided" },
    ],
    action: { href: "/?view=leads", label: "Apply to a lead" },
  },
  {
    match: (pathname) => pathname === "/settings/team",
    eyebrow: "ADMINISTRATION · ACCESS",
    title: "Give each teammate only the authority they need.",
    purpose:
      "Team Access controls workspace membership, operating roles and suspension.",
    nextAction:
      "Review active roles, remove unnecessary authority and protect the final owner.",
    aiosRole:
      "AIOS resolves responsibility only to active, authorized workspace members.",
    capabilities: [
      { label: "Role governed", tone: "live" },
      { label: "Owner protected", tone: "guided" },
    ],
    action: { href: "/settings/security", label: "Review account security" },
  },
  {
    match: (pathname) => pathname === "/settings/security",
    eyebrow: "ADMINISTRATION · SECURITY",
    title: "Strengthen the identity behind every sensitive action.",
    purpose:
      "Account Security manages multi-factor authentication and stronger session assurance.",
    nextAction:
      "Enroll and verify an authenticator before enforcing MFA-sensitive workflows.",
    aiosRole:
      "AIOS cannot use automation to bypass role or MFA requirements.",
    capabilities: [
      { label: "TOTP MFA", tone: "live" },
      { label: "Fail closed", tone: "guided" },
    ],
    action: { href: "/settings/team", label: "Review team roles" },
  },
];

const navigationGroups = [
  {
    label: "Today",
    links: [
      { href: "/", label: "Command center" },
      { href: "/inbox", label: "Inbox" },
      { href: "/tasks", label: "Tasks" },
    ],
  },
  {
    label: "Sales",
    links: [
      { href: "/?view=leads", label: "Lead pipeline" },
      { href: "/contacts", label: "Contacts" },
      { href: "/quotes", label: "Quotes" },
      { href: "/itineraries", label: "Itineraries" },
    ],
  },
  {
    label: "Operations",
    links: [
      { href: "/trips", label: "Trip Operations" },
      { href: "/finance", label: "Suppliers & Finance" },
    ],
  },
  {
    label: "Intelligence",
    links: [
      { href: "/aios", label: "AIOS Control" },
      { href: "/analytics", label: "Analytics" },
    ],
  },
  {
    label: "Admin",
    links: [
      { href: "/settings/lead-capture", label: "Lead capture" },
      { href: "/settings/sales-workflows", label: "Sales workflows" },
      { href: "/settings/team", label: "Team access" },
      { href: "/settings/security", label: "Security" },
    ],
  },
];

export function FeatureHeader({
  links,
  ariaLabel = "Related workspace areas",
}: FeatureHeaderProps) {
  const pathname = usePathname();
  const guide = guides.find((candidate) => candidate.match(pathname));

  return (
    <>
      <header className="ui-feature-header">
        <Link href="/" className="ui-feature-brand">
          <span aria-hidden="true">A</span>
          AIOS
        </Link>
        <nav className="ui-workspace-nav" aria-label="Primary workspace navigation">
          {navigationGroups.map((group) => (
            <details key={group.label}>
              <summary>{group.label}</summary>
              <div>
                {group.links.map((link) => (
                  <Link
                    href={link.href}
                    key={link.href}
                    aria-current={
                      link.href === pathname ||
                      (link.href !== "/" && pathname.startsWith(link.href))
                        ? "page"
                        : undefined
                    }
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </details>
          ))}
        </nav>
        <nav className="ui-related-nav" aria-label={ariaLabel}>
          {links.slice(0, 2).map((link) => (
            <Link href={link.href} key={`${link.href}-${link.label}`}>
              {link.label}
            </Link>
          ))}
        </nav>
      </header>
      {guide ? (
        <WorkspaceGuide
          eyebrow={guide.eyebrow}
          title={guide.title}
          purpose={guide.purpose}
          nextAction={guide.nextAction}
          aiosRole={guide.aiosRole}
          activeStage={guide.activeStage}
          capabilities={guide.capabilities}
          action={guide.action}
        />
      ) : null}
    </>
  );
}
