"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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
];

export function ProductHelp() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [open]);

  if (
    ["/sign-in", "/sign-up", "/forgot-password", "/update-password", "/auth", "/lead/", "/onboarding"].some(
      (prefix) => pathname.startsWith(prefix),
    )
  ) {
    return null;
  }

  return (
    <>
      <button
        className="ui-help-trigger"
        type="button"
        ref={triggerRef}
        aria-expanded={open}
        aria-controls="product-help"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">?</span>
        How AIOS works
      </button>
      {open ? (
        <div
          className="ui-help-layer"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setOpen(false);
          }}
        >
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
                ref={closeButtonRef}
                aria-label="Close product guide"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>

            <section>
              <p className="ui-help-intro">
                The CRM records what is true. AIOS watches that work, proposes or
                performs allowed internal actions, and asks a human before
                sensitive external actions.
              </p>
              <JourneyRail />
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
              <p className="ui-help-section-title">AIOS autonomy</p>
              <div>
                <b>Observe</b>
                <span>Read and surface risk. No changes.</span>
              </div>
              <div>
                <b>Assist</b>
                <span>Recommend the next action for a human.</span>
              </div>
              <div>
                <b>Approval</b>
                <span>Prepare the action and wait for a decision.</span>
              </div>
              <div>
                <b>Auto</b>
                <span>Execute eligible low-risk internal work.</span>
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
              <Link href="/aios" onClick={() => setOpen(false)}>
                Open AIOS controls
              </Link>
              <Link href="/?view=leads" onClick={() => setOpen(false)}>
                Start with a lead
              </Link>
            </footer>
          </aside>
        </div>
      ) : null}
    </>
  );
}
