import Link from "next/link";

export default function NotFound() {
  return (
    <main className="recovery-page" id="main-content" tabIndex={-1}>
      <section>
        <p>AIOS NAVIGATION</p>
        <span aria-hidden="true">404</span>
        <h1>This route is not on the itinerary.</h1>
        <small>
          The page may have moved, or the link may no longer be available in
          your workspace.
        </small>
        <Link href="/">Return to command center</Link>
      </section>
    </main>
  );
}
