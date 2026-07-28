"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";

const storageKey = "aios.guided-setup.v1";
const storageEvent = "aios-guided-setup-change";

function subscribeToChecklist(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(storageEvent, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(storageEvent, callback);
  };
}

function checklistSnapshot() {
  return window.localStorage.getItem(storageKey) || "[]";
}

const setupSteps = [
  {
    id: "capture",
    title: "Choose how enquiries enter",
    detail: "Review your public lead form and response deadline.",
    href: "/settings/lead-capture",
    linkLabel: "Open lead capture",
  },
  {
    id: "workflow",
    title: "Define what qualified means",
    detail: "Review qualification evidence and follow-up playbooks.",
    href: "/settings/sales-workflows",
    linkLabel: "Open sales workflows",
  },
  {
    id: "aios",
    title: "Set AIOS authority",
    detail: "Choose autonomy, provider access and daily limits.",
    href: "/aios",
    linkLabel: "Open AIOS controls",
  },
  {
    id: "team",
    title: "Secure the operating team",
    detail: "Review roles, invitations and account security.",
    href: "/settings/team",
    linkLabel: "Open team access",
  },
];

export function SetupChecklist({ hasLead }: { hasLead: boolean }) {
  const snapshot = useSyncExternalStore(
    subscribeToChecklist,
    checklistSnapshot,
    () => "[]",
  );
  const reviewed = useMemo(() => {
    try {
      const parsed = JSON.parse(snapshot);
      return Array.isArray(parsed)
        ? parsed.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
    } catch {
      return [];
    }
  }, [snapshot]);

  const completed = useMemo(
    () => new Set([...reviewed, ...(hasLead ? ["first-lead"] : [])]),
    [hasLead, reviewed],
  );
  const completedCount = setupSteps.filter((step) =>
    completed.has(step.id),
  ).length;

  function toggle(id: string) {
    const next = reviewed.includes(id)
      ? reviewed.filter((value) => value !== id)
      : [...reviewed, id];
    window.localStorage.setItem(storageKey, JSON.stringify(next));
    window.dispatchEvent(new Event(storageEvent));
  }

  return (
    <section className="setup-checklist" aria-labelledby="setup-checklist-title">
      <header>
        <div>
          <p>START HERE</p>
          <h2 id="setup-checklist-title">Make AIOS fit your agency</h2>
          <span>
            Review these four controls before allowing routine automation.
          </span>
        </div>
        <div className="setup-progress" aria-label={`${completedCount} of 4 reviewed`}>
          <b>{completedCount}/4</b>
          <span>
            <i style={{ width: `${(completedCount / 4) * 100}%` }} />
          </span>
        </div>
      </header>
      <div className="setup-steps">
        {setupSteps.map((step, index) => {
          const isComplete = completed.has(step.id);
          return (
            <article className={isComplete ? "is-complete" : ""} key={step.id}>
              <button
                type="button"
                aria-label={`${isComplete ? "Mark incomplete" : "Mark reviewed"}: ${step.title}`}
                aria-pressed={isComplete}
                onClick={() => toggle(step.id)}
              >
                {isComplete ? "✓" : index + 1}
              </button>
              <div>
                <strong>{step.title}</strong>
                <span>{step.detail}</span>
                <Link href={step.href}>{step.linkLabel} →</Link>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
