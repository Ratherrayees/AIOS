"use client";

import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
} from "react";

type IntegrationDrawerProps = {
  title: string;
  description: string;
  onRequestClose: () => void;
  children: ReactNode;
};

const focusableSelector = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "details > summary",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function IntegrationDrawer({
  title,
  description,
  onRequestClose,
  children,
}: IntegrationDrawerProps) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onRequestClose();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(focusableSelector),
    ).filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;
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

  function handleBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onRequestClose();
  }

  return (
    <div className="integration-drawer-layer" onMouseDown={handleBackdrop}>
      <section
        ref={panelRef}
        className="integration-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="integration-drawer-title"
        aria-describedby="integration-drawer-description"
        onKeyDown={handleKeyDown}
      >
        <header>
          <div>
            <p>Agency integration</p>
            <h2 id="integration-drawer-title">{title}</h2>
            <span id="integration-drawer-description">{description}</span>
          </div>
          <button ref={closeRef} type="button" onClick={onRequestClose} aria-label={`Close ${title} settings`}>
            ×
          </button>
        </header>
        <div className="integration-drawer-body">{children}</div>
      </section>
    </div>
  );
}
