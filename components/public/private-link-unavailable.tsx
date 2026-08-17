import Link from "next/link";

export function PrivateLinkUnavailable({
  kind,
}: {
  kind: "proposal" | "journey";
}) {
  const isProposal = kind === "proposal";
  return (
    <main className="private-link-page" id="main-content" tabIndex={-1}>
      <section>
        <div className="private-link-brand"><span>A</span> AIOS TRAVEL</div>
        <p>PRIVATE {isProposal ? "PROPOSAL" : "TRAVELLER VIEW"}</p>
        <h1>This private link is no longer available.</h1>
        <span>
          It may have expired, been replaced, or been revoked by the travel
          team. No customer or trip information has been disclosed.
        </span>
        <div>
          <b>What to do next</b>
          <small>
            Ask your travel advisor to send a new {isProposal ? "proposal" : "journey"} link.
          </small>
        </div>
        <Link href="/sign-in">Team member sign in</Link>
      </section>
    </main>
  );
}
