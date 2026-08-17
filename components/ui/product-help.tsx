"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ModalBoundary } from "./modal-boundary";
import { JourneyRail } from "./workspace-guide";

const glossary = [
  {
    term: "Contact",
    definition: "A person or traveller your company knows.",
  },
  {
    term: "Lead",
    definition: "A specific sales opportunity for a contact.",
  },
  {
    term: "Trip",
    definition: "The operational journey created after a lead is won.",
  },
  {
    term: "Approval",
    definition: "A human decision required before a sensitive external effect.",
  },
  {
    term: "Knowledge",
    definition:
      "Human-reviewed evidence AIOS may answer from only when every material claim has a current visible citation.",
  },
];

const dailyLoop = [
  {
    label: "Start with attention",
    detail: "Home shows overdue work, replies, approvals, trips and payments.",
    href: "/",
    route: "/",
  },
  {
    label: "Answer travellers",
    detail: "Inbox keeps the conversation, traveller and next action together.",
    href: "/inbox",
    route: "/inbox",
  },
  {
    label: "Progress opportunities",
    detail: "Leads holds qualification, ownership, follow-up and sales stage.",
    href: "/leads",
    route: "/leads",
  },
  {
    label: "Plan the itinerary",
    detail: "Itineraries turns dates and preferences into a day-by-day plan.",
    href: "/itineraries",
    route: "/itineraries",
  },
  {
    label: "Price and propose",
    detail:
      "Quotes controls customer pricing, versions, approval and acceptance.",
    href: "/quotes",
    route: "/quotes",
  },
  {
    label: "Operate departures",
    detail:
      "Trips tracks travellers, services, documents, tasks and live risk.",
    href: "/trips",
    route: "/trips",
  },
  {
    label: "Reconcile money",
    detail:
      "Finance tracks receivables, payables, invoice evidence and settlements.",
    href: "/finance",
    route: "/finance",
  },
  {
    label: "Review AI decisions",
    detail: "AIOS shows what ran automatically and what needs human approval.",
    href: "/aios/approvals",
    route: "/aios/approvals",
  },
];

export function ProductHelp() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function closeGuide() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  if (
    [
      "/sign-in",
      "/sign-up",
      "/forgot-password",
      "/update-password",
      "/auth",
      "/lead/",
      "/onboarding",
    ].some((prefix) => pathname.startsWith(prefix))
  ) {
    return null;
  }

  return (
    <>
      <button
        className="ui-help-trigger"
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls="product-help"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">?</span>
        How AIOS works
      </button>
      {open ? (
        <ModalBoundary className="ui-help-layer" onClose={closeGuide}>
          <aside
            className="ui-help-drawer"
            id="product-help"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-help-title"
          >
            <header>
              <div>
                <p>AIOS FIELD GUIDE</p>
                <h2 id="product-help-title">How the CRM fits together</h2>
              </div>
              <button
                type="button"
                aria-label="Close product guide"
                onClick={closeGuide}
              >
                ×
              </button>
            </header>

            <section>
              <p className="ui-help-intro">
                The CRM records what is true. AIOS watches that work, proposes
                or performs allowed internal actions, and asks a human before
                sensitive external actions.
              </p>
              <JourneyRail />
            </section>

            <section>
              <p className="ui-help-section-title">Your daily operating loop</p>
              <ol className="ui-help-daily-loop">
                {dailyLoop.map((step, index) => {
                  const current =
                    step.route === "/"
                      ? pathname === "/"
                      : pathname.startsWith(step.route);
                  return (
                    <li
                      className={current ? "is-current" : ""}
                      key={step.label}
                    >
                      <span>{index + 1}</span>
                      <div>
                        <b>{step.label}</b>
                        <small>{step.detail}</small>
                      </div>
                      <Link
                        href={step.href}
                        aria-label={`Open ${step.label}`}
                        aria-current={current ? "page" : undefined}
                        onClick={() => setOpen(false)}
                      >
                        Open
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </section>

            <section>
              <p className="ui-help-section-title">Core records</p>
              <dl className="ui-help-glossary">
                {glossary.map((item) => (
                  <div key={item.term}>
                    <dt>{item.term}</dt>
                    <dd>{item.definition}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="ui-help-autonomy">
              <p className="ui-help-section-title">AIOS operating modes</p>
              <div>
                <b>Manual</b>
                <span>AI recommends. Your team performs every action.</span>
              </div>
              <div>
                <b>Assisted</b>
                <span>
                  AI prepares work and handles permitted internal tasks.
                </span>
              </div>
              <div>
                <b>Autopilot</b>
                <span>
                  AI runs permitted workflows and asks at approval gates.
                </span>
              </div>
            </section>

            <section className="ui-help-boundary">
              <b>Human authority is non-bypassable</b>
              <p>
                Customer or supplier messages, sharing, booking changes,
                payments and refunds remain approval-gated.
              </p>
            </section>

            <footer>
              <Link href="/aios/automations" onClick={() => setOpen(false)}>
                Open AIOS controls
              </Link>
              <Link href="/leads" onClick={() => setOpen(false)}>
                Start with a lead
              </Link>
            </footer>
          </aside>
        </ModalBoundary>
      ) : null}
    </>
  );
}
